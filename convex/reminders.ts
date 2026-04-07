import { addDays, addMinutes } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { pickMemorySignal, selectMemorySnapshot } from "./agentMemory";

const LOOKAHEAD_DAYS = 7;
const REMINDER_MESSAGE_INTENT = {
  pre_workout: "reminder_pre_workout",
  check_in: "reminder_check_in",
  late_follow_up: "reminder_late_follow_up",
} as const;

type ReminderType = keyof typeof REMINDER_MESSAGE_INTENT;
type ReminderRunState =
  | "scheduled"
  | "pre_reminded"
  | "user_acknowledged"
  | "user_hesitant"
  | "ignored_once"
  | "completed"
  | "missed"
  | "rescheduled"
  | "skipped";

const REMINDER_RUN_STATE_VALIDATOR = v.union(
  v.literal("scheduled"),
  v.literal("pre_reminded"),
  v.literal("user_acknowledged"),
  v.literal("user_hesitant"),
  v.literal("ignored_once"),
  v.literal("completed"),
  v.literal("missed"),
  v.literal("rescheduled"),
  v.literal("skipped"),
);

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
  args: {
    targets: ReturnType<typeof buildReminderTargets>;
    skippedDates: Set<string>;
    runStates: Map<string, ReminderRunState>;
    now: number;
    timezone: string;
  },
) {
  const reminders: Array<{
    date: string;
    scheduledFor: number;
    type: ReminderType;
  }> = [];

  for (const target of args.targets) {
    if (args.skippedDates.has(target.date)) {
      continue;
    }

    const runState = args.runStates.get(target.date);
    if (isClosedReminderRunState(runState)) {
      continue;
    }

    const preWorkout = toTimestamp(
      target.date,
      target.schedule.reminderTime,
      args.timezone,
    );
    const checkIn = toTimestamp(
      target.date,
      target.schedule.scheduledTime,
      args.timezone,
    );
    const lateFollowUp = addMinutes(
      new Date(
        toTimestamp(target.date, target.schedule.checkInDeadline, args.timezone),
      ),
      5,
    ).getTime();

    for (const entry of [
      { date: target.date, scheduledFor: preWorkout, type: "pre_workout" as const },
      { date: target.date, scheduledFor: checkIn, type: "check_in" as const },
      {
        date: target.date,
        scheduledFor: lateFollowUp,
        type: "late_follow_up" as const,
      },
    ]) {
      if (entry.scheduledFor > args.now) {
        reminders.push(entry);
      }
    }
  }

  return reminders;
}

function buildReminderTargets(
  habit: Doc<"habits">,
  user: Doc<"users">,
) {
  const timezone = getTimezone(user);
  const now = Date.now();
  const targets: Array<{
    date: string;
    schedule: ReturnType<typeof getDaySchedule>;
  }> = [];

  for (let dayOffset = 0; dayOffset < LOOKAHEAD_DAYS; dayOffset += 1) {
    const anchor = addDays(new Date(now), dayOffset);
    const date = getDateKey(anchor, timezone);
    const dayKey = getDayKey(anchor, timezone);
    if (!habit.targetDays.includes(dayKey)) {
      continue;
    }

    targets.push({
      date,
      schedule: getDaySchedule(habit, dayKey),
    });
  }

  return targets;
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

function isClosedReminderRunState(
  state: ReminderRunState | null | undefined,
): state is "completed" | "missed" | "skipped" {
  return state === "completed" || state === "missed" || state === "skipped";
}

function isOutcomeReminderRunState(
  state: ReminderRunState | null | undefined,
): state is "completed" | "missed" {
  return state === "completed" || state === "missed";
}

function resolveReminderRunStateForSchedule(args: {
  existingState: ReminderRunState | null;
  desiredState: "scheduled" | "skipped";
}) {
  if (!args.existingState) {
    return args.desiredState;
  }

  if (isOutcomeReminderRunState(args.existingState)) {
    return args.existingState;
  }

  if (args.desiredState === "skipped") {
    return "skipped" as const;
  }

  return args.existingState;
}

function resolveReminderRunStateForRuntime(args: {
  existingState: ReminderRunState | null;
  nextState: ReminderRunState;
}) {
  if (!args.existingState) {
    return args.nextState;
  }

  if (isOutcomeReminderRunState(args.existingState)) {
    return args.existingState;
  }

  if (isOutcomeReminderRunState(args.nextState)) {
    return args.nextState;
  }

  if (args.existingState === "skipped") {
    return "skipped" as const;
  }

  return args.nextState;
}

async function getReminderRun(args: {
  ctx: MutationCtx;
  userId: Id<"users">;
  habitId: Id<"habits">;
  date: string;
}) {
  return await args.ctx.db
    .query("reminderRuns")
    .withIndex("by_user_habit_date", (q) =>
      q.eq("userId", args.userId).eq("habitId", args.habitId).eq("date", args.date),
    )
    .unique();
}

async function syncReminderRunForSchedule(args: {
  ctx: MutationCtx;
  userId: Id<"users">;
  habitId: Id<"habits">;
  date: string;
  desiredState: "scheduled" | "skipped";
  now: number;
}) {
  const existing = await getReminderRun(args);
  const state = resolveReminderRunStateForSchedule({
    existingState: existing?.state ?? null,
    desiredState: args.desiredState,
  });

  if (existing) {
    if (existing.state !== state) {
      await args.ctx.db.patch(existing._id, {
        state,
        updatedAt: args.now,
      });
    }
    return {
      id: existing._id,
      state,
    };
  }

  const id = await args.ctx.db.insert("reminderRuns", {
    userId: args.userId,
    habitId: args.habitId,
    date: args.date,
    state,
    userResponded: false,
    createdAt: args.now,
    updatedAt: args.now,
  });

  return { id, state };
}

async function advanceReminderRunState(args: {
  ctx: MutationCtx;
  userId: Id<"users">;
  habitId: Id<"habits">;
  date: string;
  nextState: ReminderRunState;
  now: number;
  lastReminderType?: ReminderType;
  lastMessageId?: Id<"messages">;
  userResponded?: boolean;
  responseIntent?: string;
  responseSummary?: string;
}) {
  const existing = await getReminderRun(args);
  const state = resolveReminderRunStateForRuntime({
    existingState: existing?.state ?? null,
    nextState: args.nextState,
  });

  if (existing) {
    const patch: Partial<Doc<"reminderRuns">> = {
      state,
      updatedAt: args.now,
    };

    if (args.lastReminderType !== undefined) {
      patch.lastReminderType = args.lastReminderType;
    }
    if (args.lastMessageId !== undefined) {
      patch.lastMessageId = args.lastMessageId;
    }
    if (args.userResponded !== undefined) {
      patch.userResponded = args.userResponded;
    }
    if (args.responseIntent !== undefined) {
      patch.responseIntent = args.responseIntent;
    }
    if (args.responseSummary !== undefined) {
      patch.responseSummary = args.responseSummary;
    }

    await args.ctx.db.patch(existing._id, patch);
    return {
      id: existing._id,
      state,
    };
  }

  const id = await args.ctx.db.insert("reminderRuns", {
    userId: args.userId,
    habitId: args.habitId,
    date: args.date,
    state,
    lastReminderType: args.lastReminderType,
    lastMessageId: args.lastMessageId,
    userResponded: args.userResponded ?? false,
    responseIntent: args.responseIntent,
    responseSummary: args.responseSummary,
    createdAt: args.now,
    updatedAt: args.now,
  });

  return { id, state };
}

function buildReminderContext(args: {
  habit: Doc<"habits">;
  reminder: Doc<"reminders">;
  reminderRunState: ReminderRunState | null;
  allCheckIns: Doc<"checkIns">[];
  todayReminders: Doc<"reminders">[];
  timezone: string;
  memorySignal: string | null;
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
    memorySignal: args.memorySignal,
    reminderRunState: args.reminderRunState,
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
  const memorySignal = params.context.memorySignal ?? "";
  const runState = params.context.reminderRunState;

  if (params.type === "pre_workout") {
    const bodyLead =
      runState === "rescheduled"
        ? `${params.habit.name} already got moved. Good. Now actually show up.`
        : memorySignal ||
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
      runState === "user_acknowledged"
        ? `You already responded on ${params.habit.name}. Good. Now finish the rep.`
        : runState === "user_hesitant"
          ? `You already flinched on ${params.habit.name}. Do the smallest clean version now.`
          : memorySignal ||
            (params.context.lastCheckInStatus === "missed"
              ? `${params.habit.name} is up. Don't repeat the last miss.`
              : `It's check-in time for ${params.habit.name}. Did you do it?`);
    const contentTail =
      runState === "user_acknowledged"
        ? "You don't need another debate. Just log the result clean."
        : runState === "user_hesitant"
          ? "Start with 5-10 minutes or one clean set, then answer honestly."
          : missSignal ||
            streakSignal ||
            memorySignal ||
            "Answer clean: did you do it or are you dodging it?";

    return {
      title: "Streak",
      body: bodyLead,
      content: `It's ${params.scheduledTime}. ${contentTail}`,
    };
  }

  const lateLead =
    runState === "user_acknowledged"
      ? `${params.habit.name} was acknowledged but still died at the ${params.deadline} deadline.`
      : runState === "user_hesitant"
        ? `${params.habit.name} stayed stuck in hesitation until the ${params.deadline} deadline.`
        : memorySignal ||
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
    const now = Date.now();
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
    const skippedDates = new Set(habitSkips.map((skip) => skip.date));
    const existingRuns = await ctx.db
      .query("reminderRuns")
      .withIndex("by_habit_date", (q) => q.eq("habitId", args.habitId))
      .collect();
    const runStates = new Map(
      existingRuns.map((run) => [run.date, run.state as ReminderRunState]),
    );
    const targets = buildReminderTargets(habit, user);

    for (const target of targets) {
      const syncedRun = await syncReminderRunForSchedule({
        ctx,
        userId: user._id,
        habitId: habit._id,
        date: target.date,
        desiredState: skippedDates.has(target.date) ? "skipped" : "scheduled",
        now,
      });
      runStates.set(target.date, syncedRun.state);
    }

    const nextReminders = buildReminderPayloads({
      targets,
      skippedDates,
      runStates,
      now,
      timezone: getTimezone(user),
    });
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

    if (user.aiDisabled) {
      await ctx.db.patch(reminder._id, { sent: true });
      return {
        shouldSendPush: false,
        skipped: true,
      };
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
    const reminderRun = await getReminderRun({
      ctx,
      userId: reminder.userId,
      habitId: reminder.habitId,
      date: reminder.date,
    });

    const existingCheckIn =
      existingCheckIns.find((entry) => entry.habitId === reminder.habitId) ??
      null;

    if (existingCheckIn) {
      await advanceReminderRunState({
        ctx,
        userId: reminder.userId,
        habitId: reminder.habitId,
        date: reminder.date,
        nextState: existingCheckIn.status === "missed" ? "missed" : "completed",
        now: reminder.scheduledFor,
      });
      await ctx.db.patch(reminder._id, { sent: true });
      return {
        shouldSendPush: false,
        skipped: true,
      };
    }

    if (skip) {
      await advanceReminderRunState({
        ctx,
        userId: reminder.userId,
        habitId: reminder.habitId,
        date: reminder.date,
        nextState: "skipped",
        now: reminder.scheduledFor,
      });
      await ctx.db.patch(reminder._id, { sent: true });
      return {
        shouldSendPush: false,
        skipped: true,
      };
    }

    if (isClosedReminderRunState(reminderRun?.state ?? null)) {
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
    const recentEpisodes = await ctx.db
      .query("agentEpisodes")
      .withIndex("by_user_date", (q) => q.eq("userId", reminder.userId))
      .order("desc")
      .take(12);
    const memoryRows = await ctx.db
      .query("agentMemory")
      .withIndex("by_user_scope", (q) => q.eq("userId", reminder.userId))
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
    const memorySnapshot = selectMemorySnapshot({
      memories: memoryRows,
      episodes: recentEpisodes,
      habitId: habit._id,
    });
    const reminderContext = buildReminderContext({
      habit,
      reminder,
      reminderRunState: reminderRun?.state ?? null,
      allCheckIns,
      todayReminders: todayReminders.filter(
        (entry) => entry.date === reminder.date,
      ),
      timezone,
      memorySignal: pickMemorySignal(memorySnapshot),
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
      aiContent = `${copy.content} Reset and show up on the next scheduled day.`;
      checkInCreatedId = await ctx.db.insert("checkIns", {
        habitId: habit._id,
        userId: user._id,
        date: reminder.date,
        status: "missed",
        source: "auto_deadline",
        userReason: "No response by deadline",
        conversationSummary: `Automatic miss after ${schedule.checkInDeadline} deadline`,
        aiResponse: aiContent,
        timestamp: reminder.scheduledFor,
      });

      await ctx.db.patch(habit._id, { currentStreak: 0 });
      await ctx.runMutation(internal.agentMemory.recordEpisode, {
        userId: user._id,
        habitId: habit._id,
        date: reminder.date,
        type: "reminder_ignored",
        summary: `${habit.name} was ignored until deadline and became an automatic miss.`,
        metadata: {
          reminderType: reminder.type,
          deadline: schedule.checkInDeadline,
        },
        createdAt: reminder.scheduledFor,
      });
    }

    const messageId = await ctx.db.insert("messages", {
      userId: user._id,
      habitId: habit._id,
      role: "ai",
      content: aiContent,
      intent: REMINDER_MESSAGE_INTENT[reminder.type],
      timestamp: reminder.scheduledFor,
    });

    await advanceReminderRunState({
      ctx,
      userId: user._id,
      habitId: habit._id,
      date: reminder.date,
      nextState:
        reminder.type === "late_follow_up"
          ? "missed"
          : reminder.type === "pre_workout"
            ? "pre_reminded"
            : reminderRun?.state === "user_acknowledged" ||
                reminderRun?.state === "user_hesitant"
              ? reminderRun.state
              : "ignored_once",
      now: reminder.scheduledFor,
      lastReminderType: reminder.type,
      lastMessageId: messageId,
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

export const advanceReminderRun = internalMutation({
  args: {
    userId: v.id("users"),
    habitId: v.id("habits"),
    date: v.string(),
    state: REMINDER_RUN_STATE_VALIDATOR,
    now: v.number(),
    userResponded: v.optional(v.boolean()),
    responseIntent: v.optional(v.string()),
    responseSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await advanceReminderRunState({
      ctx,
      userId: args.userId,
      habitId: args.habitId,
      date: args.date,
      nextState: args.state,
      now: args.now,
      userResponded: args.userResponded,
      responseIntent: args.responseIntent,
      responseSummary: args.responseSummary,
    });
  },
});
