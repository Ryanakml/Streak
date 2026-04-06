import { addDays, addMinutes } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { v } from "convex/values";

const LOOKAHEAD_DAYS = 7;
const REMINDER_MESSAGE_INTENT = {
  pre_workout: "reminder_pre_workout",
  check_in: "reminder_check_in",
  late_follow_up: "reminder_late_follow_up",
} as const;

type ReminderType = keyof typeof REMINDER_MESSAGE_INTENT;

type AuthenticatedUserCtx = {
  auth: {
    getUserIdentity(): Promise<{ subject: string } | null>;
  };
  db: {
    get(id: Id<"users">): Promise<Doc<"users"> | null>;
  };
};

async function requireIdentity(ctx: AuthenticatedUserCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");
  return identity;
}

async function requireOwnedUser(
  ctx: AuthenticatedUserCtx,
  userId: Id<"users">,
) {
  const identity = await requireIdentity(ctx);
  const user = await ctx.db.get(userId);
  if (!user || user.clerkId !== identity.subject) {
    throw new Error("Unauthorized");
  }
}

function getTimezone(user: Doc<"users">) {
  return user.timezone ?? "UTC";
}

function getDayKey(date: Date, timezone: string) {
  return formatInTimeZone(date, timezone, "EEE").toLowerCase().slice(0, 3);
}

function getDateKey(date: Date, timezone: string) {
  return formatInTimeZone(date, timezone, "yyyy-MM-dd");
}

function getDaySchedule(habit: Doc<"habits">, dayKey: string) {
  if (dayKey === "fri" && habit.schedules?.fri) {
    return habit.schedules.fri;
  }

  return {
    scheduledTime: habit.scheduledTime,
    reminderTime: habit.reminderTime,
    checkInDeadline: habit.checkInDeadline,
  };
}

function toTimestamp(dateKey: string, time: string, timezone: string) {
  return fromZonedTime(`${dateKey}T${time}:00`, timezone).getTime();
}

function shiftDateKey(date: Date, timezone: string, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return getDateKey(next, timezone);
}

function buildReminderPayloads(
  habit: Doc<"habits">,
  user: Doc<"users">,
  skippedDates: Set<string>,
) {
  const timezone = getTimezone(user);
  const now = Date.now();
  const reminders: Array<{
    date: string;
    scheduledFor: number;
    type: ReminderType;
  }> = [];

  for (let dayOffset = 0; dayOffset < LOOKAHEAD_DAYS; dayOffset += 1) {
    const anchor = addDays(new Date(now), dayOffset);
    const date = getDateKey(anchor, timezone);
    const dayKey = getDayKey(anchor, timezone);
    if (skippedDates.has(date)) {
      continue;
    }
    if (!habit.targetDays.includes(dayKey)) {
      continue;
    }

    const schedule = getDaySchedule(habit, dayKey);
    const preWorkout = toTimestamp(date, schedule.reminderTime, timezone);
    const checkIn = toTimestamp(date, schedule.scheduledTime, timezone);
    const lateFollowUp = addMinutes(
      new Date(toTimestamp(date, schedule.checkInDeadline, timezone)),
      5,
    ).getTime();

    for (const entry of [
      { date, scheduledFor: preWorkout, type: "pre_workout" as const },
      { date, scheduledFor: checkIn, type: "check_in" as const },
      { date, scheduledFor: lateFollowUp, type: "late_follow_up" as const },
    ]) {
      if (entry.scheduledFor > now) {
        reminders.push(entry);
      }
    }
  }

  return reminders;
}

function compareCheckInsDesc(left: Doc<"checkIns">, right: Doc<"checkIns">) {
  if (left.date !== right.date) {
    return right.date.localeCompare(left.date);
  }

  return right.timestamp - left.timestamp;
}

function summarizeMissTrend(missedLast7d: number) {
  if (missedLast7d >= 4) {
    return "You've been leaking this habit all week.";
  }

  if (missedLast7d >= 2) {
    return "This habit has been wobbling lately.";
  }

  return "";
}

function summarizeStreak(currentStreak: number) {
  if (currentStreak >= 7) {
    return `You're on a ${currentStreak}-day streak. Don't get cute now.`;
  }

  if (currentStreak >= 3) {
    return `You're on a ${currentStreak}-day run. Keep it clean.`;
  }

  return "";
}

function buildReminderContext(args: {
  habit: Doc<"habits">;
  reminder: Doc<"reminders">;
  allCheckIns: Doc<"checkIns">[];
  todayReminders: Doc<"reminders">[];
  timezone: string;
}) {
  const habitCheckIns = args.allCheckIns
    .filter((checkIn) => checkIn.habitId === args.habit._id)
    .sort(compareCheckInsDesc);
  const date7dStart = shiftDateKey(
    new Date(args.reminder.scheduledFor),
    args.timezone,
    -6,
  );
  const checkInsLast7d = habitCheckIns.filter(
    (checkIn) =>
      checkIn.date >= date7dStart && checkIn.date <= args.reminder.date,
  );
  const missedLast7d = checkInsLast7d.filter(
    (checkIn) => checkIn.status === "missed",
  ).length;
  const lastCheckIn = habitCheckIns[0] ?? null;
  const recentMissReasons = habitCheckIns
    .filter((checkIn) => checkIn.status === "missed")
    .map(
      (checkIn) =>
        checkIn.userReason?.trim() ||
        checkIn.conversationSummary?.trim() ||
        null,
    )
    .filter((reason): reason is string => Boolean(reason))
    .slice(0, 2);
  const habitTodayReminders = args.todayReminders.filter(
    (reminder) => reminder.habitId === args.habit._id,
  );

  return {
    habitName: args.habit.name,
    currentStreak: args.habit.currentStreak,
    missedLast7d,
    lastCheckInStatus: lastCheckIn?.status ?? null,
    recentMissReasons,
    todayReminderStatus: {
      pendingTypes: habitTodayReminders
        .filter((reminder) => !reminder.sent)
        .map((reminder) => reminder.type),
      sentTypes: habitTodayReminders
        .filter((reminder) => reminder.sent)
        .map((reminder) => reminder.type),
    },
  };
}

function buildReminderCopy(params: {
  habit: Doc<"habits">;
  type: ReminderType;
  scheduledTime: string;
  deadline: string;
  context: ReturnType<typeof buildReminderContext>;
}) {
  const streakSignal = summarizeStreak(params.context.currentStreak);
  const missSignal = summarizeMissTrend(params.context.missedLast7d);
  const recentReason = params.context.recentMissReasons[0] ?? "";

  if (params.type === "pre_workout") {
    const bodyLead =
      streakSignal ||
      missSignal ||
      `${params.habit.name} is coming up. You ready or already making excuses?`;
    const contentTail = recentReason
      ? `Last time you used: ${recentReason}. Not again.`
      : "Be ready before the excuses start talking.";

    return {
      title: "Streak",
      body: bodyLead,
      content: `${params.habit.name} starts at ${params.scheduledTime}. ${contentTail}`,
    };
  }

  if (params.type === "check_in") {
    const bodyLead =
      params.context.lastCheckInStatus === "missed"
        ? `${params.habit.name} is up. Don't repeat the last miss.`
        : `It's check-in time for ${params.habit.name}. Did you do it?`;
    const contentTail =
      missSignal ||
      streakSignal ||
      "Answer clean: did you do it or are you dodging it?";

    return {
      title: "Streak",
      body: bodyLead,
      content: `It's ${params.scheduledTime}. ${contentTail}`,
    };
  }

  const lateLead =
    missSignal ||
    streakSignal ||
    `${params.habit.name} is past the ${params.deadline} deadline. That's an automatic miss.`;
  const lateTail = recentReason
    ? `Pattern says the same excuse keeps showing up: ${recentReason}.`
    : "You let the deadline win this round.";

  return {
    title: "Streak",
    body: lateLead,
    content: `It's past ${params.deadline}. ${params.habit.name} is an automatic miss unless you already logged it. ${lateTail}`,
  };
}

export const listByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireOwnedUser(ctx, args.userId);
    return await ctx.db
      .query("reminders")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const listScheduled = query({
  args: { before: v.number(), sent: v.boolean() },
  handler: async (ctx, args) => {
    await requireIdentity(ctx);
    return await ctx.db
      .query("reminders")
      .withIndex("by_scheduled", (q) =>
        q.eq("sent", args.sent).lte("scheduledFor", args.before),
      )
      .collect();
  },
});

export const create = mutation({
  args: {
    habitId: v.id("habits"),
    userId: v.id("users"),
    date: v.string(),
    scheduledFor: v.number(),
    type: v.union(
      v.literal("pre_workout"),
      v.literal("check_in"),
      v.literal("late_follow_up"),
    ),
    sent: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireOwnedUser(ctx, args.userId);
    return await ctx.db.insert("reminders", {
      ...args,
      sent: args.sent ?? false,
    });
  },
});

export const markSent = mutation({
  args: { id: v.id("reminders"), sent: v.boolean() },
  handler: async (ctx, args) => {
    const reminder = await ctx.db.get(args.id);
    if (!reminder) throw new Error("Reminder not found");
    await requireOwnedUser(ctx, reminder.userId);
    await ctx.db.patch(args.id, { sent: args.sent });
    return await ctx.db.get(args.id);
  },
});

export const remove = mutation({
  args: { id: v.id("reminders") },
  handler: async (ctx, args) => {
    const reminder = await ctx.db.get(args.id);
    if (!reminder) throw new Error("Reminder not found");
    await requireOwnedUser(ctx, reminder.userId);
    await ctx.db.delete(args.id);
    return args.id;
  },
});

export const refreshForHabit = internalMutation({
  args: { habitId: v.id("habits") },
  handler: async (ctx, args) => {
    const habit = await ctx.db.get(args.habitId);
    if (!habit) {
      return { created: 0, deleted: 0 };
    }

    const pendingReminders = await ctx.db
      .query("reminders")
      .withIndex("by_habit", (q) =>
        q.eq("habitId", args.habitId).eq("sent", false),
      )
      .collect();

    for (const reminder of pendingReminders) {
      await ctx.db.delete(reminder._id);
    }

    if (!habit.isActive) {
      return { created: 0, deleted: pendingReminders.length };
    }

    const user = await ctx.db.get(habit.userId);
    if (!user) {
      return { created: 0, deleted: pendingReminders.length };
    }

    const habitSkips = await ctx.db
      .query("habitSkips")
      .withIndex("by_habit_date", (q) => q.eq("habitId", args.habitId))
      .collect();
    const skippedDates = new Set(
      habitSkips.map((skip) => skip.date),
    );

    const nextReminders = buildReminderPayloads(habit, user, skippedDates);
    for (const reminder of nextReminders) {
      await ctx.db.insert("reminders", {
        habitId: habit._id,
        userId: user._id,
        date: reminder.date,
        scheduledFor: reminder.scheduledFor,
        type: reminder.type,
        sent: false,
      });
    }

    return { created: nextReminders.length, deleted: pendingReminders.length };
  },
});

export const clearForHabit = internalMutation({
  args: { habitId: v.id("habits") },
  handler: async (ctx, args) => {
    const pendingReminders = await ctx.db
      .query("reminders")
      .withIndex("by_habit", (q) =>
        q.eq("habitId", args.habitId).eq("sent", false),
      )
      .collect();

    for (const reminder of pendingReminders) {
      await ctx.db.delete(reminder._id);
    }

    return { deleted: pendingReminders.length };
  },
});

export const listDue = internalQuery({
  args: { before: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("reminders")
      .withIndex("by_scheduled", (q) =>
        q.eq("sent", false).lte("scheduledFor", args.before),
      )
      .collect();
  },
});

export const processReminder = internalMutation({
  args: { reminderId: v.id("reminders") },
  handler: async (ctx, args) => {
    const reminder = await ctx.db.get(args.reminderId);
    if (!reminder || reminder.sent) {
      return null;
    }

    const habit = await ctx.db.get(reminder.habitId);
    const user = await ctx.db.get(reminder.userId);
    if (!habit || !user) {
      await ctx.db.patch(reminder._id, { sent: true });
      return null;
    }

    const existingCheckIns = await ctx.db
      .query("checkIns")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", reminder.userId).eq("date", reminder.date),
      )
      .collect();
    const skip = await ctx.db
      .query("habitSkips")
      .withIndex("by_habit_date", (q) =>
        q.eq("habitId", reminder.habitId).eq("date", reminder.date),
      )
      .unique();

    const existingCheckIn =
      existingCheckIns.find((entry) => entry.habitId === reminder.habitId) ??
      null;

    if (existingCheckIn || skip) {
      await ctx.db.patch(reminder._id, { sent: true });
      return {
        shouldSendPush: false,
        skipped: true,
      };
    }

    const timezone = getTimezone(user);
    const allCheckIns = await ctx.db
      .query("checkIns")
      .withIndex("by_user_date", (q) => q.eq("userId", reminder.userId))
      .collect();
    const todayReminders = await ctx.db
      .query("reminders")
      .withIndex("by_user", (q) => q.eq("userId", reminder.userId))
      .collect();
    const dayKey = getDayKey(
      new Date(reminder.scheduledFor),
      timezone,
    );
    const schedule = getDaySchedule(habit, dayKey);
    const reminderContext = buildReminderContext({
      habit,
      reminder,
      allCheckIns,
      todayReminders: todayReminders.filter(
        (entry) => entry.date === reminder.date,
      ),
      timezone,
    });
    const copy = buildReminderCopy({
      habit,
      type: reminder.type,
      scheduledTime: schedule.scheduledTime,
      deadline: schedule.checkInDeadline,
      context: reminderContext,
    });

    let aiContent = copy.content;
    let checkInCreatedId: Id<"checkIns"> | undefined;

    if (reminder.type === "late_follow_up") {
      checkInCreatedId = await ctx.db.insert("checkIns", {
        habitId: habit._id,
        userId: user._id,
        date: reminder.date,
        status: "missed",
        source: "auto_deadline",
        userReason: "No response by deadline",
        conversationSummary: `Automatic miss after ${schedule.checkInDeadline} deadline`,
        aiResponse: copy.content,
        timestamp: reminder.scheduledFor,
      });

      await ctx.db.patch(habit._id, { currentStreak: 0 });
      aiContent = `${copy.content} Reset and show up on the next scheduled day.`;
    }

    const messageId = await ctx.db.insert("messages", {
      userId: user._id,
      habitId: habit._id,
      role: "ai",
      content: aiContent,
      intent: REMINDER_MESSAGE_INTENT[reminder.type],
      timestamp: reminder.scheduledFor,
    });

    await ctx.db.patch(reminder._id, { sent: true });

    return {
      shouldSendPush: true,
      userId: user._id,
      reminderType: reminder.type,
      messageId,
      checkInCreatedId,
      payload: {
        title: copy.title,
        body: copy.body,
        url: "/dashboard?tab=chat",
        habitId: habit._id,
        reminderType: reminder.type,
      },
    };
  },
});
