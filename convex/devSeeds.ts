import { action, internalQuery, mutation, query } from "./_generated/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { fromZonedTime } from "date-fns-tz";
import { internal } from "./_generated/api";

const PHASE1_SEED_PREFIX = "[Seed P1]";
const PHASE2_SEED_PREFIX = "[Seed P2]";
const PHASE3_SEED_PREFIX = "[Seed P3]";
const PHASE4_SEED_PREFIX = "[Seed P4]";
const PHASE5_SEED_PREFIX = "[Seed P5]";
const PHASE6_SEED_PREFIX = "[Seed P6]";

function dayKeyFromDateKey(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  return date
    .toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })
    .toLowerCase()
    .slice(0, 3);
}

function shiftDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function toTimestamp(dateKey: string, time: string) {
  return new Date(`${dateKey}T${time}:00.000Z`).getTime();
}

function toTimestampInTimezone(
  dateKey: string,
  time: string,
  timezone: string,
) {
  return fromZonedTime(`${dateKey}T${time}:00`, timezone).getTime();
}

async function deleteSeedData(
  ctx: MutationCtx,
  userId: Id<"users">,
  habitIds: Id<"habits">[],
) {
  const reminders = (await ctx.db
    .query("reminders")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect()) as Doc<"reminders">[];
  for (const reminder of reminders.filter((entry) =>
    habitIds.includes(entry.habitId),
  )) {
    await ctx.db.delete(reminder._id);
  }

  const reminderRuns = (await ctx.db
    .query("reminderRuns")
    .withIndex("by_user_date", (q) => q.eq("userId", userId))
    .collect()) as Doc<"reminderRuns">[];
  for (const reminderRun of reminderRuns.filter((entry) =>
    habitIds.includes(entry.habitId),
  )) {
    await ctx.db.delete(reminderRun._id);
  }

  const messages = (await ctx.db
    .query("messages")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect()) as Doc<"messages">[];
  for (const message of messages.filter(
    (entry) => entry.habitId && habitIds.includes(entry.habitId),
  )) {
    await ctx.db.delete(message._id);
  }
  const messageIds = messages
    .filter((entry) => entry.habitId && habitIds.includes(entry.habitId))
    .map((entry) => entry._id);

  const checkIns = (await ctx.db
    .query("checkIns")
    .withIndex("by_user_date", (q) => q.eq("userId", userId))
    .collect()) as Doc<"checkIns">[];
  const checkInIds = checkIns
    .filter((entry) => habitIds.includes(entry.habitId))
    .map((entry) => entry._id);

  const workoutLogGroups = (await Promise.all(
    habitIds.map((habitId) =>
      ctx.db
        .query("workoutLogs")
        .withIndex("by_habit", (q) => q.eq("habitId", habitId))
        .collect(),
    ),
  )) as Doc<"workoutLogs">[][];
  const workoutLogs = workoutLogGroups.flat();
  for (const workoutLog of workoutLogs.filter((entry) =>
    checkInIds.includes(entry.checkInId),
  )) {
    await ctx.db.delete(workoutLog._id);
  }

  for (const checkInId of checkInIds) {
    await ctx.db.delete(checkInId);
  }

  const habitSkips = (await ctx.db
    .query("habitSkips")
    .withIndex("by_user_date", (q) => q.eq("userId", userId))
    .collect()) as Doc<"habitSkips">[];
  for (const skip of habitSkips.filter((entry) =>
    habitIds.includes(entry.habitId),
  )) {
    await ctx.db.delete(skip._id);
  }

  const actionLogs = (await ctx.db
    .query("agentActionLogs")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect()) as Doc<"agentActionLogs">[];
  for (const log of actionLogs.filter(
    (entry) =>
      (entry.targetId && habitIds.map(String).includes(entry.targetId)) ||
      (entry.messageId && messageIds.includes(entry.messageId)),
  )) {
    await ctx.db.delete(log._id);
  }

  const pendingActions = (await ctx.db
    .query("agentPendingActions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect()) as Doc<"agentPendingActions">[];
  for (const pendingAction of pendingActions.filter(
    (entry) =>
      (entry.targetHabitId && habitIds.includes(entry.targetHabitId)) ||
      (entry.messageId && messageIds.includes(entry.messageId)),
  )) {
    await ctx.db.delete(pendingAction._id);
  }

  const episodes = (await ctx.db
    .query("agentEpisodes")
    .withIndex("by_user_date", (q) => q.eq("userId", userId))
    .collect()) as Doc<"agentEpisodes">[];
  for (const episode of episodes.filter(
    (entry) =>
      (entry.habitId && habitIds.includes(entry.habitId)) ||
      (entry.sourceMessageId && messageIds.includes(entry.sourceMessageId)),
  )) {
    await ctx.db.delete(episode._id);
  }

  const memories = (await ctx.db
    .query("agentMemory")
    .withIndex("by_user_scope", (q) => q.eq("userId", userId))
    .collect()) as Doc<"agentMemory">[];
  for (const memory of memories.filter(
    (entry) => entry.habitId && habitIds.includes(entry.habitId),
  )) {
    await ctx.db.delete(memory._id);
  }

  const weeklyReports = (await ctx.db
    .query("weeklyReports")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect()) as Doc<"weeklyReports">[];
  for (const weeklyReport of weeklyReports.filter((entry) =>
    habitIds.includes(entry.habitId),
  )) {
    await ctx.db.delete(weeklyReport._id);
  }

  for (const habitId of habitIds) {
    await ctx.db.delete(habitId);
  }
}

export const resetAgentEvaluationWorkspace = mutation({
  args: {
    email: v.optional(v.string()),
    clerkId: v.optional(v.string()),
    confirmation: v.literal("phase6-agent-eval-reset"),
  },
  handler: async (ctx, args) => {
    const user = await findUserFromArgs(ctx, args);

    if (!user) {
      throw new Error("Seed target user not found");
    }
    await requireSeedTargetAccess(ctx, user);

    const cleared = await clearUserWorkspace(ctx, user._id);

    return {
      userId: user._id,
      cleared,
    };
  },
});

export const seedMinimalGymReminderSmoke = mutation({
  args: {
    email: v.optional(v.string()),
    clerkId: v.optional(v.string()),
    today: v.string(),
    confirmation: v.literal("phase6-reminder-smoke"),
  },
  handler: async (ctx, args) => {
    const user = await findUserFromArgs(ctx, args);

    if (!user) {
      throw new Error("Seed target user not found");
    }
    await requireSeedTargetAccess(ctx, user);

    await clearUserWorkspace(ctx, user._id);

    const now = Date.now();
    const yesterday = shiftDateKey(args.today, -1);
    const twoDaysAgo = shiftDateKey(args.today, -2);
    const threeDaysAgo = shiftDateKey(args.today, -3);
    const todayDayKey = dayKeyFromDateKey(args.today);

    const gymHabitId = await ctx.db.insert("habits", {
      userId: user._id,
      name: "[Smoke] Gym",
      targetDays: [todayDayKey],
      scheduledTime: "18:30",
      reminderTime: "18:00",
      checkInDeadline: "21:00",
      rules: "Lift or cardio for at least 30 minutes.",
      motivation: "No excuses. Show up.",
      currentStreak: 0,
      bestStreak: 3,
      isActive: true,
      createdAt: now,
    });

    for (const seededCheckIn of [
      {
        date: threeDaysAgo,
        timestamp: toTimestamp(threeDaysAgo, "21:05"),
      },
      {
        date: twoDaysAgo,
        timestamp: toTimestamp(twoDaysAgo, "21:10"),
      },
      {
        date: yesterday,
        timestamp: toTimestamp(yesterday, "21:15"),
      },
    ]) {
      await ctx.db.insert("checkIns", {
        habitId: gymHabitId,
        userId: user._id,
        date: seededCheckIn.date,
        status: "missed",
        source: "chat",
        userReason: "capek atau malas",
        conversationSummary: "Seeded repeated gym miss",
        aiResponse: "Seed miss",
        timestamp: seededCheckIn.timestamp,
      });
    }

    const reminderRunId = await ctx.db.insert("reminderRuns", {
      userId: user._id,
      habitId: gymHabitId,
      date: args.today,
      state: "scheduled",
      userResponded: false,
      createdAt: now,
      updatedAt: now,
    });

    const reminderIds = await Promise.all(
      [
        {
          type: "pre_workout" as const,
          scheduledFor: now - 20 * 60 * 1000,
        },
        {
          type: "check_in" as const,
          scheduledFor: now - 10 * 60 * 1000,
        },
        {
          type: "late_follow_up" as const,
          scheduledFor: now - 5 * 60 * 1000,
        },
      ].map((reminder) =>
        ctx.db.insert("reminders", {
          habitId: gymHabitId,
          userId: user._id,
          date: args.today,
          scheduledFor: reminder.scheduledFor,
          type: reminder.type,
          sent: false,
        }),
      ),
    );

    return {
      userId: user._id,
      userEmail: user.email,
      today: args.today,
      habit: {
        id: gymHabitId,
        name: "[Smoke] Gym",
      },
      reminderRunId,
      reminderIds,
      seededCheckIns: [
        { date: threeDaysAgo },
        { date: twoDaysAgo },
        { date: yesterday },
      ],
    };
  },
});

export const seedPhase6ReminderMatrixCase = mutation({
  args: {
    email: v.optional(v.string()),
    clerkId: v.optional(v.string()),
    today: v.string(),
    scenarioId: v.string(),
    resetExisting: v.optional(v.boolean()),
    confirmation: v.literal("phase6-reminder-matrix"),
  },
  handler: async (ctx, args) => {
    const user = await findUserFromArgs(ctx, args);

    if (!user) {
      throw new Error("Seed target user not found");
    }
    await requireSeedTargetAccess(ctx, user);

    await clearUserWorkspace(ctx, user._id);

    const timezone = user.timezone ?? "UTC";
    const now = Date.now();
    const yesterday = shiftDateKey(args.today, -1);
    const twoDaysAgo = shiftDateKey(args.today, -2);
    const threeDaysAgo = shiftDateKey(args.today, -3);
    const todayDayKey = dayKeyFromDateKey(args.today);
    const habitName = `${PHASE6_SEED_PREFIX} ${args.scenarioId} Gym`;

    const habitId = await ctx.db.insert("habits", {
      userId: user._id,
      name: habitName,
      targetDays: [todayDayKey],
      scheduledTime: "18:30",
      reminderTime: "18:00",
      checkInDeadline: "21:00",
      rules: "Show up and finish one real session.",
      motivation: "You said you wanted brutal accountability. Here it is.",
      currentStreak: 0,
      bestStreak: 4,
      isActive: true,
      createdAt: now,
    });

    for (const seededCheckIn of [
      {
        date: threeDaysAgo,
        timestamp: toTimestampInTimezone(threeDaysAgo, "21:05", timezone),
      },
      {
        date: twoDaysAgo,
        timestamp: toTimestampInTimezone(twoDaysAgo, "21:10", timezone),
      },
      {
        date: yesterday,
        timestamp: toTimestampInTimezone(yesterday, "21:15", timezone),
      },
    ]) {
      await ctx.db.insert("checkIns", {
        habitId,
        userId: user._id,
        date: seededCheckIn.date,
        status: "missed",
        source: "chat",
        userReason: "malas lagi",
        conversationSummary: "Seeded repeated miss for reminder matrix",
        aiResponse: "Seed miss",
        timestamp: seededCheckIn.timestamp,
      });
    }

    const reminderRunId = await ctx.db.insert("reminderRuns", {
      userId: user._id,
      habitId,
      date: args.today,
      state: "scheduled",
      userResponded: false,
      createdAt: now,
      updatedAt: now,
    });

    const reminders = await Promise.all(
      [
        {
          type: "pre_workout" as const,
          scheduledFor: toTimestampInTimezone(args.today, "18:00", timezone),
        },
        {
          type: "check_in" as const,
          scheduledFor: toTimestampInTimezone(args.today, "18:30", timezone),
        },
        {
          type: "late_follow_up" as const,
          scheduledFor: toTimestampInTimezone(args.today, "21:05", timezone),
        },
      ].map((entry) =>
        ctx.db.insert("reminders", {
          habitId,
          userId: user._id,
          date: args.today,
          scheduledFor: entry.scheduledFor,
          type: entry.type,
          sent: false,
        }),
      ),
    );

    return {
      userId: user._id,
      userEmail: user.email,
      today: args.today,
      scenarioId: args.scenarioId,
      habit: {
        id: habitId,
        name: habitName,
      },
      reminderRunId,
      reminderIds: reminders,
    };
  },
});

export const recordPhase6ReminderResponse = mutation({
  args: {
    email: v.optional(v.string()),
    clerkId: v.optional(v.string()),
    habitName: v.string(),
    date: v.string(),
    stage: v.union(v.literal("post"), v.literal("due")),
    responseKind: v.union(v.literal("ack"), v.literal("excuse")),
    content: v.optional(v.string()),
    confirmation: v.literal("phase6-reminder-matrix"),
  },
  handler: async (ctx, args) => {
    const user = await findUserFromArgs(ctx, args);

    if (!user) {
      throw new Error("Seed target user not found");
    }
    await requireSeedTargetAccess(ctx, user);

    const habit = await findUserHabitByName(ctx, user._id, args.habitName);
    if (!habit) {
      throw new Error("Habit not found for reminder matrix response");
    }

    const reminders = ((await ctx.db
      .query("reminders")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()) as Doc<"reminders">[])
      .filter((entry) => entry.habitId === habit._id && entry.date === args.date)
      .sort((left, right) => left.scheduledFor - right.scheduledFor);
    const window = getReminderStageWindow({
      reminders,
      stage: args.stage,
    });
    const timestamp = Math.min(
      window.start + 60 * 1000,
      window.end,
    );
    const content =
      args.content ??
      (args.responseKind === "ack"
        ? `gue bakal beresin ${habit.name}`
        : `gue masih males ${habit.name} hari ini`);

    const messageId = await ctx.db.insert("messages", {
      userId: user._id,
      habitId: habit._id,
      role: "user",
      content,
      intent: args.responseKind === "ack" ? "question" : "excuse",
      timestamp,
    });

    await upsertSeedReminderRunState({
      ctx,
      userId: user._id,
      habitId: habit._id,
      date: args.date,
      state:
        args.responseKind === "ack"
          ? "user_acknowledged"
          : "user_hesitant",
      now: timestamp,
      userResponded: true,
      responseIntent: args.responseKind === "ack" ? "question" : "excuse",
      responseSummary: content,
    });

    return {
      messageId,
      habitId: habit._id,
      habitName: habit.name,
      timestamp,
      responseKind: args.responseKind,
    };
  },
});

export const recordPhase6ReminderCheckIn = mutation({
  args: {
    email: v.optional(v.string()),
    clerkId: v.optional(v.string()),
    habitName: v.string(),
    date: v.string(),
    stage: v.union(
      v.literal("post"),
      v.literal("due"),
      v.literal("deadline"),
    ),
    status: v.union(v.literal("completed"), v.literal("bonus")),
    confirmation: v.literal("phase6-reminder-matrix"),
  },
  handler: async (ctx, args) => {
    const user = await findUserFromArgs(ctx, args);

    if (!user) {
      throw new Error("Seed target user not found");
    }
    await requireSeedTargetAccess(ctx, user);

    const habit = await findUserHabitByName(ctx, user._id, args.habitName);
    if (!habit) {
      throw new Error("Habit not found for reminder matrix completion");
    }

    const existingCheckIns = ((await ctx.db
      .query("checkIns")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", user._id).eq("date", args.date),
      )
      .collect()) as Doc<"checkIns">[]).filter(
      (entry) => entry.habitId === habit._id,
    );
    if (existingCheckIns.length > 0) {
      return {
        status: "no_op",
        checkInId: existingCheckIns[0]._id,
      };
    }

    const reminders = ((await ctx.db
      .query("reminders")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()) as Doc<"reminders">[])
      .filter((entry) => entry.habitId === habit._id && entry.date === args.date)
      .sort((left, right) => left.scheduledFor - right.scheduledFor);
    const window = getReminderStageWindow({
      reminders,
      stage: args.stage,
    });
    const timestamp = Math.min(
      window.start + 2 * 60 * 1000,
      window.end,
    );
    const checkInId = await ctx.db.insert("checkIns", {
      habitId: habit._id,
      userId: user._id,
      date: args.date,
      status: args.status,
      source: "dashboard_quick",
      conversationSummary: "Seeded manual completion for reminder matrix",
      aiResponse: "[seed_manual_checkin]",
      timestamp,
    });

    if (args.status === "completed") {
      const nextStreak = habit.currentStreak + 1;
      await ctx.db.patch(habit._id, {
        currentStreak: nextStreak,
        bestStreak: Math.max(habit.bestStreak, nextStreak),
      });
    }

    await upsertSeedReminderRunState({
      ctx,
      userId: user._id,
      habitId: habit._id,
      date: args.date,
      state: "completed",
      now: timestamp,
      userResponded: false,
      responseIntent: "dashboard_quick",
      responseSummary: "Seeded completion before next reminder stage.",
    });

    return {
      status: "executed",
      checkInId,
      habitId: habit._id,
      habitName: habit.name,
      timestamp,
    };
  },
});

export const seedPhase6ReminderSentStage = mutation({
  args: {
    email: v.optional(v.string()),
    clerkId: v.optional(v.string()),
    habitName: v.string(),
    date: v.string(),
    type: v.union(
      v.literal("pre_workout"),
      v.literal("check_in"),
      v.literal("late_follow_up"),
    ),
    confirmation: v.literal("phase6-reminder-matrix"),
  },
  handler: async (ctx, args) => {
    const user = await findUserFromArgs(ctx, args);

    if (!user) {
      throw new Error("Seed target user not found");
    }
    await requireSeedTargetAccess(ctx, user);

    const habit = await findUserHabitByName(ctx, user._id, args.habitName);
    if (!habit) {
      throw new Error("Habit not found for reminder sent-stage seed");
    }

    const reminder = ((await ctx.db
      .query("reminders")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()) as Doc<"reminders">[]).find(
      (entry) =>
        entry.habitId === habit._id &&
        entry.date === args.date &&
        entry.type === args.type,
    );

    if (!reminder) {
      throw new Error("Reminder row not found for sent-stage seed");
    }

    await ctx.db.patch(reminder._id, { sent: true });

    const messageId = await ctx.db.insert("messages", {
      userId: user._id,
      habitId: habit._id,
      role: "ai",
      content: `[seed ${args.type} sent]`,
      intent:
        args.type === "pre_workout"
          ? "reminder_pre_workout"
          : args.type === "check_in"
            ? "reminder_check_in"
            : "reminder_late_follow_up",
      timestamp: reminder.scheduledFor,
    });

    return {
      messageId,
      reminderId: reminder._id,
      habitId: habit._id,
      habitName: habit.name,
      type: args.type,
    };
  },
});

export const processPhase6ReminderStage = action({
  args: {
    email: v.optional(v.string()),
    clerkId: v.optional(v.string()),
    habitName: v.string(),
    date: v.string(),
    type: v.union(
      v.literal("pre_workout"),
      v.literal("check_in"),
      v.literal("late_follow_up"),
    ),
    confirmation: v.literal("phase6-reminder-matrix"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    processed: number;
    reminderId?: Id<"reminders">;
    habitId: Id<"habits">;
    habitName: string;
    date: string;
    type: "pre_workout" | "check_in" | "late_follow_up";
    shouldSendPush?: boolean;
    skipped?: boolean;
    messageId?: Id<"messages">;
    checkInCreatedId?: Id<"checkIns">;
  }> => {
    const user = (await ctx.runQuery(internal.devSeeds.resolveSeedUser, {
      email: args.email,
      clerkId: args.clerkId,
    })) as Doc<"users"> | null;

    if (!user) {
      throw new Error("Seed target user not found");
    }
    await requireSeedTargetAccess(ctx, user);

    const habits = (await ctx.runQuery(internal.devSeeds.listSeedHabitsForUser, {
      userId: user._id,
    })) as Doc<"habits">[];
    const normalizedName = args.habitName.trim().toLowerCase();
    const habit =
      habits.find((entry) => entry.name.trim().toLowerCase() === normalizedName) ??
      habits.find((entry) =>
        entry.name.trim().toLowerCase().includes(normalizedName),
      ) ??
      (habits.length === 1 ? habits[0] : null) ??
      null;
    if (!habit) {
      throw new Error("Habit not found for reminder matrix processing");
    }

    const reminder: Doc<"reminders"> | undefined = ((await ctx.runQuery(
      internal.reminders.listDue,
      {
      before: Number.MAX_SAFE_INTEGER,
      },
    )) as Doc<"reminders">[]).find(
      (entry) =>
        entry.userId === user._id &&
        entry.habitId === habit._id &&
        entry.date === args.date &&
        entry.type === args.type &&
        !entry.sent,
    );

    if (!reminder) {
      return {
        processed: 0,
        habitId: habit._id,
        habitName: habit.name,
        date: args.date,
        type: args.type,
      };
    }

    const result = (await ctx.runAction(
      internal.notificationsAction.processSingleReminderDelivery,
      {
        reminderId: reminder._id,
        skipPushDelivery: true,
      },
    )) as
      | {
          processed?: number;
          shouldSendPush?: boolean;
          skipped?: boolean;
          messageId?: Id<"messages">;
          checkInCreatedId?: Id<"checkIns">;
        }
      | null;

    return {
      processed: result?.processed ?? 0,
      reminderId: reminder._id,
      habitId: habit._id,
      habitName: habit.name,
      date: args.date,
      type: args.type,
      shouldSendPush: Boolean(result?.shouldSendPush),
      skipped: Boolean(result?.skipped),
      messageId: result?.messageId,
      checkInCreatedId: result?.checkInCreatedId,
    };
  },
});

async function clearUserWorkspace(ctx: MutationCtx, userId: Id<"users">) {
  const habits = (await ctx.db
    .query("habits")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect()) as Doc<"habits">[];
  const habitIds = habits.map((habit) => habit._id);

  const reminders = (await ctx.db
    .query("reminders")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect()) as Doc<"reminders">[];
  const reminderRuns = (await ctx.db
    .query("reminderRuns")
    .withIndex("by_user_date", (q) => q.eq("userId", userId))
    .collect()) as Doc<"reminderRuns">[];
  const messages = (await ctx.db
    .query("messages")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect()) as Doc<"messages">[];
  const checkIns = (await ctx.db
    .query("checkIns")
    .withIndex("by_user_date", (q) => q.eq("userId", userId))
    .collect()) as Doc<"checkIns">[];
  const habitSkips = (await ctx.db
    .query("habitSkips")
    .withIndex("by_user_date", (q) => q.eq("userId", userId))
    .collect()) as Doc<"habitSkips">[];
  const actionLogs = (await ctx.db
    .query("agentActionLogs")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect()) as Doc<"agentActionLogs">[];
  const pendingActions = (await ctx.db
    .query("agentPendingActions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect()) as Doc<"agentPendingActions">[];
  const tasks = (await ctx.db
    .query("agentTasks")
    .withIndex("by_user_date", (q) => q.eq("userId", userId))
    .collect()) as Doc<"agentTasks">[];
  const episodes = (await ctx.db
    .query("agentEpisodes")
    .withIndex("by_user_date", (q) => q.eq("userId", userId))
    .collect()) as Doc<"agentEpisodes">[];
  const memories = (await ctx.db
    .query("agentMemory")
    .withIndex("by_user_scope", (q) => q.eq("userId", userId))
    .collect()) as Doc<"agentMemory">[];
  const weeklyReports = (await ctx.db
    .query("weeklyReports")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect()) as Doc<"weeklyReports">[];
  const modelRuns = (await ctx.db
    .query("agentModelRuns")
    .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
    .collect()) as Doc<"agentModelRuns">[];

  const checkInIds = checkIns.map((checkIn) => checkIn._id);
  const workoutLogGroups = (await Promise.all(
    habitIds.map((habitId) =>
      ctx.db
        .query("workoutLogs")
        .withIndex("by_habit", (q) => q.eq("habitId", habitId))
        .collect(),
    ),
  )) as Doc<"workoutLogs">[][];
  const workoutLogs = workoutLogGroups
    .flat()
    .filter((workoutLog) => checkInIds.includes(workoutLog.checkInId));

  for (const reminder of reminders) {
    await ctx.db.delete(reminder._id);
  }
  for (const reminderRun of reminderRuns) {
    await ctx.db.delete(reminderRun._id);
  }
  for (const actionLog of actionLogs) {
    await ctx.db.delete(actionLog._id);
  }
  for (const pendingAction of pendingActions) {
    await ctx.db.delete(pendingAction._id);
  }
  for (const episode of episodes) {
    await ctx.db.delete(episode._id);
  }
  for (const memory of memories) {
    await ctx.db.delete(memory._id);
  }
  for (const weeklyReport of weeklyReports) {
    await ctx.db.delete(weeklyReport._id);
  }
  for (const modelRun of modelRuns) {
    await ctx.db.delete(modelRun._id);
  }
  for (const habitSkip of habitSkips) {
    await ctx.db.delete(habitSkip._id);
  }
  for (const task of tasks) {
    await ctx.db.delete(task._id);
  }
  for (const workoutLog of workoutLogs) {
    await ctx.db.delete(workoutLog._id);
  }
  for (const checkIn of checkIns) {
    await ctx.db.delete(checkIn._id);
  }
  for (const message of messages) {
    await ctx.db.delete(message._id);
  }
  for (const habit of habits) {
    await ctx.db.delete(habit._id);
  }

  return {
    habits: habits.length,
    reminders: reminders.length,
    reminderRuns: reminderRuns.length,
    messages: messages.length,
    checkIns: checkIns.length,
    workoutLogs: workoutLogs.length,
    habitSkips: habitSkips.length,
    actionLogs: actionLogs.length,
    pendingActions: pendingActions.length,
    tasks: tasks.length,
    episodes: episodes.length,
    memories: memories.length,
    weeklyReports: weeklyReports.length,
    modelRuns: modelRuns.length,
  };
}

type SeedUserLookupArgs = {
  email?: string;
  clerkId?: string;
};

function requireSeedLookupArgs(args: SeedUserLookupArgs) {
  if (!args.email && !args.clerkId) {
    throw new Error("Seed target must include email or clerkId");
  }
}

function resolveUserFromLookup(
  users: Doc<"users">[],
  args: SeedUserLookupArgs,
) {
  return (
    users.find((entry) => args.clerkId && entry.clerkId === args.clerkId) ??
    users.find((entry) => args.email && entry.email === args.email) ??
    null
  );
}

async function requireSeedIdentity(ctx: MutationCtx | ActionCtx | QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthorized");
  }
  return identity;
}

async function requireSeedTargetAccess(
  ctx: MutationCtx | ActionCtx | QueryCtx,
  user: Doc<"users">,
) {
  const identity = await requireSeedIdentity(ctx);
  if (identity.subject !== user.clerkId) {
    throw new Error("Unauthorized");
  }
}

async function findUserFromArgs(ctx: MutationCtx, args: SeedUserLookupArgs) {
  requireSeedLookupArgs(args);
  const users = (await ctx.db.query("users").collect()) as Doc<"users">[];
  return resolveUserFromLookup(users, args);
}

async function findUserFromArgsInQuery(ctx: QueryCtx, args: SeedUserLookupArgs) {
  requireSeedLookupArgs(args);
  const users = (await ctx.db.query("users").collect()) as Doc<"users">[];
  return resolveUserFromLookup(users, args);
}

async function findUserHabitByName(
  ctx: MutationCtx | QueryCtx,
  userId: Id<"users">,
  habitName: string,
) {
  const habits = (await ctx.db
    .query("habits")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect()) as Doc<"habits">[];
  const normalizedName = habitName.trim().toLowerCase();

  return (
    habits.find(
      (habit) => habit.name.trim().toLowerCase() === normalizedName,
    ) ??
    habits.find((habit) =>
      habit.name.trim().toLowerCase().includes(normalizedName),
    ) ??
    (habits.length === 1 ? habits[0] : null) ??
    null
  );
}

function getReminderStageWindow(args: {
  reminders: Doc<"reminders">[];
  stage: "post" | "due" | "deadline";
}) {
  const pre = args.reminders.find((entry) => entry.type === "pre_workout") ?? null;
  const due = args.reminders.find((entry) => entry.type === "check_in") ?? null;
  const late =
    args.reminders.find((entry) => entry.type === "late_follow_up") ?? null;

  if (args.stage === "post") {
    if (!pre || !due) {
      throw new Error("Missing pre/due reminder rows for post-stage window");
    }
    return {
      start: pre.scheduledFor + 2 * 60 * 1000,
      end: due.scheduledFor - 60 * 1000,
    };
  }

  if (args.stage === "due") {
    if (!due || !late) {
      throw new Error("Missing due/late reminder rows for due-stage window");
    }
    return {
      start: due.scheduledFor + 2 * 60 * 1000,
      end: late.scheduledFor - 60 * 1000,
    };
  }

  if (!late) {
    throw new Error("Missing late reminder row for deadline-stage window");
  }

  return {
    start: late.scheduledFor + 2 * 60 * 1000,
    end: late.scheduledFor + 10 * 60 * 1000,
  };
}

async function upsertSeedReminderRunState(args: {
  ctx: MutationCtx;
  userId: Id<"users">;
  habitId: Id<"habits">;
  date: string;
  state: Doc<"reminderRuns">["state"];
  now: number;
  userResponded: boolean;
  responseIntent?: string;
  responseSummary?: string;
}) {
  const existing = await args.ctx.db
    .query("reminderRuns")
    .withIndex("by_user_habit_date", (q) =>
      q.eq("userId", args.userId)
        .eq("habitId", args.habitId)
        .eq("date", args.date),
    )
    .unique();

  if (existing) {
    await args.ctx.db.patch(existing._id, {
      state: args.state,
      userResponded: args.userResponded,
      responseIntent: args.responseIntent,
      responseSummary: args.responseSummary,
      updatedAt: args.now,
    });
    return existing._id;
  }

  return await args.ctx.db.insert("reminderRuns", {
    userId: args.userId,
    habitId: args.habitId,
    date: args.date,
    state: args.state,
    userResponded: args.userResponded,
    responseIntent: args.responseIntent,
    responseSummary: args.responseSummary,
    createdAt: args.now,
    updatedAt: args.now,
  });
}

async function clearUserDerivedMemory(ctx: MutationCtx, userId: Id<"users">) {
  const episodes = (await ctx.db
    .query("agentEpisodes")
    .withIndex("by_user_date", (q) => q.eq("userId", userId))
    .collect()) as Doc<"agentEpisodes">[];
  for (const episode of episodes) {
    await ctx.db.delete(episode._id);
  }

  const memories = (await ctx.db
    .query("agentMemory")
    .withIndex("by_user_scope", (q) => q.eq("userId", userId))
    .collect()) as Doc<"agentMemory">[];
  for (const memory of memories) {
    await ctx.db.delete(memory._id);
  }
}

async function clearAllUserTasks(ctx: MutationCtx, userId: Id<"users">) {
  const pendingTasks = (await ctx.db
    .query("agentTasks")
    .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "pending"))
    .collect()) as Doc<"agentTasks">[];

  const doneTasks = (await ctx.db
    .query("agentTasks")
    .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "done"))
    .collect()) as Doc<"agentTasks">[];

  const cancelledTasks = (await ctx.db
    .query("agentTasks")
    .withIndex("by_user_status", (q) =>
      q.eq("userId", userId).eq("status", "cancelled"),
    )
    .collect()) as Doc<"agentTasks">[];

  for (const task of [...pendingTasks, ...doneTasks, ...cancelledTasks]) {
    await ctx.db.delete(task._id);
  }
}

async function clearAllUserConversationState(
  ctx: MutationCtx,
  userId: Id<"users">,
) {
  const messages = (await ctx.db
    .query("messages")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect()) as Doc<"messages">[];
  const messageIds = new Set(messages.map((message) => message._id));

  for (const message of messages) {
    await ctx.db.delete(message._id);
  }

  const actionLogs = (await ctx.db
    .query("agentActionLogs")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect()) as Doc<"agentActionLogs">[];
  for (const log of actionLogs) {
    await ctx.db.delete(log._id);
  }

  const pendingActions = (await ctx.db
    .query("agentPendingActions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect()) as Doc<"agentPendingActions">[];
  for (const pendingAction of pendingActions) {
    await ctx.db.delete(pendingAction._id);
  }

  const modelRuns = (await ctx.db
    .query("agentModelRuns")
    .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
    .collect()) as Doc<"agentModelRuns">[];
  for (const modelRun of modelRuns) {
    await ctx.db.delete(modelRun._id);
  }

  const episodes = (await ctx.db
    .query("agentEpisodes")
    .withIndex("by_user_date", (q) => q.eq("userId", userId))
    .collect()) as Doc<"agentEpisodes">[];
  for (const episode of episodes.filter(
    (entry) => entry.sourceMessageId && messageIds.has(entry.sourceMessageId),
  )) {
    await ctx.db.delete(episode._id);
  }
}

export const resolveSeedUser = internalQuery({
  args: {
    email: v.optional(v.string()),
    clerkId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    requireSeedLookupArgs(args);
    const users = (await ctx.db.query("users").collect()) as Doc<"users">[];
    return resolveUserFromLookup(users, args);
  },
});

export const listSeedHabitsForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return (await ctx.db
      .query("habits")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect()) as Doc<"habits">[];
  },
});

async function buildPhase5VerificationSnapshot(ctx: QueryCtx, userId: Id<"users">) {
  const habits = ((await ctx.db
      .query("habits")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()) as Doc<"habits">[])
    .filter((habit) => habit.name.startsWith(PHASE5_SEED_PREFIX))
    .sort((left, right) => left.name.localeCompare(right.name));

  const habitIds = new Set(habits.map((habit) => habit._id));
  const habitIdStrings = new Set(habits.map((habit) => String(habit._id)));

  const tasks = ((await ctx.db
      .query("agentTasks")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .collect()) as Doc<"agentTasks">[])
    .filter(
      (task) =>
        task.title.startsWith(PHASE5_SEED_PREFIX) || task.source === "chat",
    )
    .sort((left, right) => {
      if (left.date !== right.date) return left.date.localeCompare(right.date);
      if ((left.time ?? "") !== (right.time ?? "")) {
        return (left.time ?? "").localeCompare(right.time ?? "");
      }
      return left._creationTime - right._creationTime;
    });

  const reminderRuns = ((await ctx.db
      .query("reminderRuns")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .collect()) as Doc<"reminderRuns">[])
    .filter((run) => habitIds.has(run.habitId))
    .sort((left, right) => {
      if (left.date !== right.date) return left.date.localeCompare(right.date);
      return String(left.habitId).localeCompare(String(right.habitId));
    });

  const reminders = ((await ctx.db
      .query("reminders")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()) as Doc<"reminders">[])
    .filter((reminder) => habitIds.has(reminder.habitId))
    .sort((left, right) => left.scheduledFor - right.scheduledFor);

  const messages = ((await ctx.db
      .query("messages")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()) as Doc<"messages">[])
    .filter((message) => !message.habitId || habitIds.has(message.habitId))
    .sort((left, right) => left.timestamp - right.timestamp);
  const messageIds = new Set(messages.map((message) => message._id));

  const checkIns = ((await ctx.db
      .query("checkIns")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .collect()) as Doc<"checkIns">[])
    .filter((checkIn) => habitIds.has(checkIn.habitId))
    .sort((left, right) => {
      if (left.date !== right.date) return left.date.localeCompare(right.date);
      return left.timestamp - right.timestamp;
    });

  const actionLogs = ((await ctx.db
      .query("agentActionLogs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()) as Doc<"agentActionLogs">[])
    .filter(
      (log) =>
        (log.messageId && messageIds.has(log.messageId)) ||
        (log.targetId && habitIdStrings.has(log.targetId)),
    )
    .sort((left, right) => left.createdAt - right.createdAt);

  const habitSkips = ((await ctx.db
      .query("habitSkips")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .collect()) as Doc<"habitSkips">[])
    .filter((skip) => habitIds.has(skip.habitId))
    .sort((left, right) => left.date.localeCompare(right.date));

  const pendingActions = ((await ctx.db
      .query("agentPendingActions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()) as Doc<"agentPendingActions">[])
    .filter(
      (pendingAction) =>
        (pendingAction.targetHabitId && habitIds.has(pendingAction.targetHabitId)) ||
        (pendingAction.messageId && messageIds.has(pendingAction.messageId)),
    )
    .sort((left, right) => left.createdAt - right.createdAt);

  return {
    habits,
    tasks,
    reminderRuns,
    reminders,
    messages,
    checkIns,
    actionLogs,
    habitSkips,
    pendingActions,
  };
}

export const getPhase5VerificationSnapshotForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await buildPhase5VerificationSnapshot(ctx, args.userId);
  },
});

export const getPhase5VerificationSnapshot = query({
  args: {
    email: v.optional(v.string()),
    clerkId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await findUserFromArgsInQuery(ctx, args);

    if (!user) {
      throw new Error("Seed target user not found");
    }
    await requireSeedTargetAccess(ctx, user);

    const snapshot = await buildPhase5VerificationSnapshot(ctx, user._id);

    return {
      userId: user._id,
      userEmail: user.email,
      snapshot,
    };
  },
});

function matchesSeedPrefix(value: string, prefixes: string[]) {
  if (prefixes.length === 0) {
    return true;
  }

  return prefixes.some((prefix) => value.startsWith(prefix));
}

function applyCollectionLimit<T>(rows: T[], limit: number | null) {
  if (!limit || rows.length <= limit) {
    return rows;
  }

  return rows.slice(-limit);
}

export const getAgentEvaluationSnapshot = query({
  args: {
    email: v.optional(v.string()),
    clerkId: v.optional(v.string()),
    seedPrefixes: v.optional(v.array(v.string())),
    includeAllHabits: v.optional(v.boolean()),
    includeNonHabitMessages: v.optional(v.boolean()),
    limitPerCollection: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await findUserFromArgsInQuery(ctx, args);

    if (!user) {
      throw new Error("Seed target user not found");
    }
    await requireSeedTargetAccess(ctx, user);

    const seedPrefixes = (args.seedPrefixes ?? [])
      .map((entry) => entry.trim())
      .filter(Boolean);
    const includeAllHabits =
      args.includeAllHabits ?? seedPrefixes.length === 0;
    const includeNonHabitMessages = args.includeNonHabitMessages ?? true;
    const normalizedLimit =
      args.limitPerCollection && args.limitPerCollection > 0
        ? Math.min(Math.floor(args.limitPerCollection), 1000)
        : null;

    const habits = ((await ctx.db
      .query("habits")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()) as Doc<"habits">[])
      .filter((habit) =>
        includeAllHabits ? true : matchesSeedPrefix(habit.name, seedPrefixes),
      )
      .sort((left, right) => left.name.localeCompare(right.name));
    const habitIds = new Set(habits.map((habit) => habit._id));
    const habitIdStrings = new Set(habits.map((habit) => String(habit._id)));

    const reminders = applyCollectionLimit(
      ((await ctx.db
        .query("reminders")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect()) as Doc<"reminders">[])
        .filter((reminder) =>
          includeAllHabits ? true : habitIds.has(reminder.habitId),
        )
        .sort((left, right) => left.scheduledFor - right.scheduledFor),
      normalizedLimit,
    );

    const reminderRuns = applyCollectionLimit(
      ((await ctx.db
        .query("reminderRuns")
        .withIndex("by_user_date", (q) => q.eq("userId", user._id))
        .collect()) as Doc<"reminderRuns">[])
        .filter((run) => (includeAllHabits ? true : habitIds.has(run.habitId)))
        .sort((left, right) => {
          if (left.date !== right.date) return left.date.localeCompare(right.date);
          if (left.habitId !== right.habitId) {
            return String(left.habitId).localeCompare(String(right.habitId));
          }
          return left.updatedAt - right.updatedAt;
        }),
      normalizedLimit,
    );

    const checkIns = applyCollectionLimit(
      ((await ctx.db
        .query("checkIns")
        .withIndex("by_user_date", (q) => q.eq("userId", user._id))
        .collect()) as Doc<"checkIns">[])
        .filter((checkIn) =>
          includeAllHabits ? true : habitIds.has(checkIn.habitId),
        )
        .sort((left, right) => {
          if (left.date !== right.date) return left.date.localeCompare(right.date);
          if (left.habitId !== right.habitId) {
            return String(left.habitId).localeCompare(String(right.habitId));
          }
          return left.timestamp - right.timestamp;
        }),
      normalizedLimit,
    );

    const workoutLogs = applyCollectionLimit(
      ((await ctx.db.query("workoutLogs").collect()) as Doc<"workoutLogs">[])
        .filter((log) => {
          if (includeAllHabits) {
            return true;
          }

          return habitIds.has(log.habitId);
        })
        .sort((left, right) =>
          String(left.checkInId).localeCompare(String(right.checkInId)),
        ),
      normalizedLimit,
    );

    const messages = applyCollectionLimit(
      ((await ctx.db
        .query("messages")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect()) as Doc<"messages">[])
        .filter((message) => {
          if (includeAllHabits) {
            return true;
          }

          if (message.habitId) {
            return habitIds.has(message.habitId);
          }

          return includeNonHabitMessages;
        })
        .sort((left, right) => left.timestamp - right.timestamp),
      normalizedLimit,
    );
    const messageIds = new Set(messages.map((message) => message._id));

    const actionLogs = applyCollectionLimit(
      ((await ctx.db
        .query("agentActionLogs")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect()) as Doc<"agentActionLogs">[])
        .filter((log) => {
          if (includeAllHabits) {
            return true;
          }

          return (
            (log.messageId && messageIds.has(log.messageId)) ||
            (log.targetId && habitIdStrings.has(log.targetId))
          );
        })
        .sort((left, right) => left.createdAt - right.createdAt),
      normalizedLimit,
    );

    const pendingActions = applyCollectionLimit(
      ((await ctx.db
        .query("agentPendingActions")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect()) as Doc<"agentPendingActions">[])
        .filter((pendingAction) => {
          if (includeAllHabits) {
            return true;
          }

          return (
            (pendingAction.targetHabitId &&
              habitIds.has(pendingAction.targetHabitId)) ||
            (pendingAction.messageId && messageIds.has(pendingAction.messageId))
          );
        })
        .sort((left, right) => left.updatedAt - right.updatedAt),
      normalizedLimit,
    );

    const tasks = applyCollectionLimit(
      ((await ctx.db
        .query("agentTasks")
        .withIndex("by_user_date", (q) => q.eq("userId", user._id))
        .collect()) as Doc<"agentTasks">[])
        .sort((left, right) => {
          if (left.date !== right.date) return left.date.localeCompare(right.date);
          if ((left.time ?? "") !== (right.time ?? "")) {
            return (left.time ?? "").localeCompare(right.time ?? "");
          }
          return left.createdAt - right.createdAt;
        }),
      normalizedLimit,
    );

    const habitSkips = applyCollectionLimit(
      ((await ctx.db
        .query("habitSkips")
        .withIndex("by_user_date", (q) => q.eq("userId", user._id))
        .collect()) as Doc<"habitSkips">[])
        .filter((skip) => (includeAllHabits ? true : habitIds.has(skip.habitId)))
        .sort((left, right) => {
          if (left.date !== right.date) return left.date.localeCompare(right.date);
          if (left.habitId !== right.habitId) {
            return String(left.habitId).localeCompare(String(right.habitId));
          }
          return left.createdAt - right.createdAt;
        }),
      normalizedLimit,
    );

    const episodes = applyCollectionLimit(
      ((await ctx.db
        .query("agentEpisodes")
        .withIndex("by_user_date", (q) => q.eq("userId", user._id))
        .collect()) as Doc<"agentEpisodes">[])
        .filter((episode) => {
          if (includeAllHabits) {
            return true;
          }

          return (
            (episode.habitId && habitIds.has(episode.habitId)) ||
            (episode.sourceMessageId && messageIds.has(episode.sourceMessageId))
          );
        })
        .sort((left, right) => {
          if (left.date !== right.date) return left.date.localeCompare(right.date);
          return left.createdAt - right.createdAt;
        }),
      normalizedLimit,
    );

    const memories = applyCollectionLimit(
      ((await ctx.db
        .query("agentMemory")
        .withIndex("by_user_scope", (q) => q.eq("userId", user._id))
        .collect()) as Doc<"agentMemory">[])
        .filter((memory) =>
          memory.scope === "global"
            ? true
            : includeAllHabits
              ? true
              : Boolean(memory.habitId && habitIds.has(memory.habitId)),
        )
        .sort((left, right) => left.updatedAt - right.updatedAt),
      normalizedLimit,
    );

    const weeklyReports = applyCollectionLimit(
      ((await ctx.db
        .query("weeklyReports")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect()) as Doc<"weeklyReports">[])
        .filter((report) => (includeAllHabits ? true : habitIds.has(report.habitId)))
        .sort((left, right) => {
          if (left.weekStart !== right.weekStart) {
            return left.weekStart.localeCompare(right.weekStart);
          }
          return String(left.habitId).localeCompare(String(right.habitId));
        }),
      normalizedLimit,
    );

    const modelRuns = applyCollectionLimit(
      ((await ctx.db
        .query("agentModelRuns")
        .withIndex("by_user_createdAt", (q) => q.eq("userId", user._id))
        .collect()) as Doc<"agentModelRuns">[])
        .filter((run) => {
          if (includeAllHabits) {
            return true;
          }

          return (
            (run.habitId && habitIds.has(run.habitId)) ||
            (run.userMessageId && messageIds.has(run.userMessageId)) ||
            (run.aiMessageId && messageIds.has(run.aiMessageId))
          );
        })
        .sort((left, right) => left.createdAt - right.createdAt),
      normalizedLimit,
    ).map((run) => ({
      _id: run._id,
      _creationTime: run._creationTime,
      aiMessageId: run.aiMessageId,
      createdAt: run.createdAt,
      estimatedCostUsd: run.estimatedCostUsd,
      fallbackDepth: run.fallbackDepth,
      finalModel: run.finalModel,
      finalProvider: run.finalProvider,
      habitId: run.habitId,
      purpose: run.purpose,
      source: run.source,
      userMessageId: run.userMessageId,
      userId: run.userId,
    }));

    return {
      user: {
        id: user._id,
        email: user.email,
        clerkId: user.clerkId,
        timezone: user.timezone ?? "UTC",
      },
      filters: {
        seedPrefixes,
        includeAllHabits,
        includeNonHabitMessages,
        limitPerCollection: normalizedLimit,
      },
      counts: {
        habits: habits.length,
        reminders: reminders.length,
        reminderRuns: reminderRuns.length,
        checkIns: checkIns.length,
        workoutLogs: workoutLogs.length,
        messages: messages.length,
        actionLogs: actionLogs.length,
        pendingActions: pendingActions.length,
        tasks: tasks.length,
        habitSkips: habitSkips.length,
        episodes: episodes.length,
        memories: memories.length,
        weeklyReports: weeklyReports.length,
        modelRuns: modelRuns.length,
      },
      snapshot: {
        habits,
        reminders,
        reminderRuns,
        checkIns,
        workoutLogs,
        messages,
        actionLogs,
        pendingActions,
        tasks,
        habitSkips,
        episodes,
        memories,
        weeklyReports,
        modelRuns,
      },
    };
  },
});

export const seedPhase1Verification = mutation({
  args: {
    email: v.optional(v.string()),
    clerkId: v.optional(v.string()),
    today: v.string(),
    resetExisting: v.optional(v.boolean()),
    createDueReminders: v.optional(v.boolean()),
    confirmation: v.literal("phase1-verification"),
  },
  handler: async (ctx, args) => {
    const user = await findUserFromArgs(ctx, args);

    if (!user) {
      throw new Error("Seed target user not found");
    }
    await requireSeedTargetAccess(ctx, user);

    const existingSeedHabits = (await ctx.db
      .query("habits")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()) as Doc<"habits">[];
    const seedHabits = existingSeedHabits.filter((habit) =>
      habit.name.startsWith(PHASE1_SEED_PREFIX),
    );

    if (args.resetExisting !== false && seedHabits.length > 0) {
      await deleteSeedData(
        ctx,
        user._id,
        seedHabits.map((habit) => habit._id),
      );
    }

    const now = Date.now();
    const readHabitId = await ctx.db.insert("habits", {
      userId: user._id,
      name: `${PHASE1_SEED_PREFIX} Read Book`,
      targetDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      scheduledTime: "19:00",
      reminderTime: "18:45",
      checkInDeadline: "22:00",
      rules: "Read 10 pages minimum.",
      motivation: "Build a daily reading streak.",
      currentStreak: 6,
      bestStreak: 8,
      isActive: true,
      createdAt: now,
    });

    const gymHabitId = await ctx.db.insert("habits", {
      userId: user._id,
      name: `${PHASE1_SEED_PREFIX} Gym`,
      targetDays: ["mon", "wed", "fri", "sat"],
      scheduledTime: "19:05",
      reminderTime: "18:40",
      checkInDeadline: "21:30",
      rules: "Lift or cardio for at least 30 minutes.",
      motivation: "Stop being weak.",
      currentStreak: 0,
      bestStreak: 3,
      isActive: true,
      createdAt: now,
    });

    const readSeedDates = Array.from({ length: 6 }, (_, index) =>
      shiftDateKey(args.today, -(index + 1)),
    ).reverse();
    for (const date of readSeedDates) {
      await ctx.db.insert("checkIns", {
        habitId: readHabitId,
        userId: user._id,
        date,
        status: "completed",
        source: "chat",
        userReason: undefined,
        conversationSummary: "Seeded phase 1 streak completion",
        aiResponse: "Seed completion",
        timestamp: toTimestamp(date, "19:10"),
      });
    }

    const gymCompletedDate = shiftDateKey(args.today, -6);
    await ctx.db.insert("checkIns", {
      habitId: gymHabitId,
      userId: user._id,
      date: gymCompletedDate,
      status: "completed",
      source: "chat",
      conversationSummary: "Seeded phase 1 gym completion",
      aiResponse: "Seed completion",
      timestamp: toTimestamp(gymCompletedDate, "19:40"),
    });

    const gymMissDateA = shiftDateKey(args.today, -3);
    await ctx.db.insert("checkIns", {
      habitId: gymHabitId,
      userId: user._id,
      date: gymMissDateA,
      status: "missed",
      source: "chat",
      userReason: "capek pulang kerja",
      conversationSummary: "Seeded phase 1 gym miss",
      aiResponse: "Seed miss",
      timestamp: toTimestamp(gymMissDateA, "21:35"),
    });

    const gymMissDateB = shiftDateKey(args.today, -1);
    await ctx.db.insert("checkIns", {
      habitId: gymHabitId,
      userId: user._id,
      date: gymMissDateB,
      status: "missed",
      source: "chat",
      userReason: "hujan/malas berangkat",
      conversationSummary: "Seeded phase 1 repeated gym miss",
      aiResponse: "Seed miss",
      timestamp: toTimestamp(gymMissDateB, "21:35"),
    });

    const createdReminders: Array<{
      id: Id<"reminders">;
      habitName: string;
      type: "pre_workout" | "check_in" | "late_follow_up";
      date: string;
    }> = [];

    if (args.createDueReminders !== false) {
      const remindersToCreate = [
        {
          habitId: readHabitId,
          habitName: `${PHASE1_SEED_PREFIX} Read Book`,
          type: "pre_workout" as const,
          scheduledFor: now - 4 * 60 * 1000,
        },
        {
          habitId: readHabitId,
          habitName: `${PHASE1_SEED_PREFIX} Read Book`,
          type: "check_in" as const,
          scheduledFor: now - 3 * 60 * 1000,
        },
        {
          habitId: gymHabitId,
          habitName: `${PHASE1_SEED_PREFIX} Gym`,
          type: "pre_workout" as const,
          scheduledFor: now - 2 * 60 * 1000,
        },
        {
          habitId: gymHabitId,
          habitName: `${PHASE1_SEED_PREFIX} Gym`,
          type: "late_follow_up" as const,
          scheduledFor: now - 1 * 60 * 1000,
        },
      ];

      for (const reminder of remindersToCreate) {
        const reminderId = await ctx.db.insert("reminders", {
          habitId: reminder.habitId,
          userId: user._id,
          date: args.today,
          scheduledFor: reminder.scheduledFor,
          type: reminder.type,
          sent: false,
        });
        createdReminders.push({
          id: reminderId,
          habitName: reminder.habitName,
          type: reminder.type,
          date: args.today,
        });
      }
    }

    return {
      userId: user._id,
      userEmail: user.email,
      today: args.today,
      habits: [
        {
          id: readHabitId,
          name: `${PHASE1_SEED_PREFIX} Read Book`,
          expectedDayKeyToday: dayKeyFromDateKey(args.today),
          currentStreak: 6,
          summary: "High-streak / on-track contrast habit",
        },
        {
          id: gymHabitId,
          name: `${PHASE1_SEED_PREFIX} Gym`,
          expectedDayKeyToday: dayKeyFromDateKey(args.today),
          currentStreak: 0,
          summary: "Frequent-miss / hesitation contrast habit",
        },
      ],
      reminders: createdReminders,
      suggestedChatCases: [
        `Progress ${PHASE1_SEED_PREFIX} Read Book gue minggu ini gimana?`,
        `Gue kayaknya skip ${PHASE1_SEED_PREFIX} Gym lagi hari ini.`,
        `Gue udah 10 hari streak ${PHASE1_SEED_PREFIX} Read Book kan?`,
      ],
    };
  },
});

export const seedPhase2Verification = mutation({
  args: {
    email: v.optional(v.string()),
    clerkId: v.optional(v.string()),
    today: v.string(),
    resetExisting: v.optional(v.boolean()),
    confirmation: v.literal("phase2-verification"),
  },
  handler: async (ctx, args) => {
    const user = await findUserFromArgs(ctx, args);

    if (!user) {
      throw new Error("Seed target user not found");
    }
    await requireSeedTargetAccess(ctx, user);

    const existingHabits = (await ctx.db
      .query("habits")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()) as Doc<"habits">[];
    const seedHabits = existingHabits.filter((habit) =>
      habit.name.startsWith(PHASE2_SEED_PREFIX),
    );

    if (args.resetExisting !== false && seedHabits.length > 0) {
      await deleteSeedData(
        ctx,
        user._id,
        seedHabits.map((habit) => habit._id),
      );
    }

    const now = Date.now();
    const tomorrow = shiftDateKey(args.today, 1);

    const readHabitId = await ctx.db.insert("habits", {
      userId: user._id,
      name: `${PHASE2_SEED_PREFIX} Read Book`,
      targetDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      scheduledTime: "07:00",
      reminderTime: "06:30",
      checkInDeadline: "09:30",
      rules: "Read 10 pages minimum.",
      motivation: "Keep the streak clean.",
      currentStreak: 5,
      bestStreak: 7,
      isActive: true,
      createdAt: now,
    });

    const gymHabitId = await ctx.db.insert("habits", {
      userId: user._id,
      name: `${PHASE2_SEED_PREFIX} Gym`,
      targetDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      scheduledTime: "07:30",
      reminderTime: "07:00",
      checkInDeadline: "10:30",
      schedules: {
        fri: {
          scheduledTime: "07:30",
          reminderTime: "07:00",
          checkInDeadline: "10:30",
        },
      },
      rules: "Lift or cardio for at least 30 minutes.",
      motivation: "Stop negotiating with yourself.",
      currentStreak: 1,
      bestStreak: 4,
      isActive: true,
      createdAt: now,
    });

    const readDates = [
      shiftDateKey(args.today, -5),
      shiftDateKey(args.today, -4),
      shiftDateKey(args.today, -3),
      shiftDateKey(args.today, -2),
      shiftDateKey(args.today, -1),
    ];
    for (const date of readDates) {
      await ctx.db.insert("checkIns", {
        habitId: readHabitId,
        userId: user._id,
        date,
        status: "completed",
        source: "chat",
        conversationSummary: "Seeded phase 2 reading completion",
        aiResponse: "Seed completion",
        timestamp: toTimestamp(date, "20:10"),
      });
    }

    const gymCompleteDate = shiftDateKey(args.today, -5);
    await ctx.db.insert("checkIns", {
      habitId: gymHabitId,
      userId: user._id,
      date: gymCompleteDate,
      status: "completed",
      source: "chat",
      conversationSummary: "Seeded phase 2 gym completion",
      aiResponse: "Seed completion",
      timestamp: toTimestamp(gymCompleteDate, "18:45"),
    });

    const gymMissDate = shiftDateKey(args.today, -2);
    await ctx.db.insert("checkIns", {
      habitId: gymHabitId,
      userId: user._id,
      date: gymMissDate,
      status: "missed",
      source: "chat",
      userReason: "capek pulang kerja",
      conversationSummary: "Seeded phase 2 gym miss",
      aiResponse: "Seed miss",
      timestamp: toTimestamp(gymMissDate, "21:10"),
    });

    const seededReminders: Array<{
      id: Id<"reminders">;
      habitName: string;
      type: "pre_workout" | "check_in";
      date: string;
      sent: boolean;
    }> = [];

    for (const reminder of [
      {
        habitId: readHabitId,
        habitName: `${PHASE2_SEED_PREFIX} Read Book`,
        date: args.today,
        scheduledFor: now + 60 * 60 * 1000,
        type: "pre_workout" as const,
        sent: true,
      },
      {
        habitId: gymHabitId,
        habitName: `${PHASE2_SEED_PREFIX} Gym`,
        date: args.today,
        scheduledFor: now + 90 * 60 * 1000,
        type: "pre_workout" as const,
        sent: false,
      },
      {
        habitId: gymHabitId,
        habitName: `${PHASE2_SEED_PREFIX} Gym`,
        date: tomorrow,
        scheduledFor: now + 26 * 60 * 60 * 1000,
        type: "pre_workout" as const,
        sent: false,
      },
    ]) {
      const reminderId = await ctx.db.insert("reminders", {
        habitId: reminder.habitId,
        userId: user._id,
        date: reminder.date,
        scheduledFor: reminder.scheduledFor,
        type: reminder.type,
        sent: reminder.sent,
      });
      seededReminders.push({
        id: reminderId,
        habitName: reminder.habitName,
        type: reminder.type,
        date: reminder.date,
        sent: reminder.sent,
      });
    }

    return {
      userId: user._id,
      userEmail: user.email,
      today: args.today,
      tomorrow,
      habits: [
        {
          id: readHabitId,
          name: `${PHASE2_SEED_PREFIX} Read Book`,
          purpose: "planner contrast + ambiguity guard",
        },
        {
          id: gymHabitId,
          name: `${PHASE2_SEED_PREFIX} Gym`,
          purpose: "reschedule + skip + risk-note target",
          fridayOverride: "07:30 / 07:00 / 10:30",
        },
      ],
      reminders: seededReminders,
      suggestedChatCases: [
        `hari ini gue ngapain aja?`,
        `besok gue ngapain aja?`,
        `geser ${PHASE2_SEED_PREFIX} Gym`,
        `besok jam 7 malam`,
        `skip ${PHASE2_SEED_PREFIX} Gym besok`,
        `skip besok`,
        `hari ini gue udah beres ${PHASE2_SEED_PREFIX} Gym`,
      ],
    };
  },
});

export const seedPhase3Verification = mutation({
  args: {
    email: v.optional(v.string()),
    clerkId: v.optional(v.string()),
    today: v.string(),
    resetExisting: v.optional(v.boolean()),
    createDueReminders: v.optional(v.boolean()),
    confirmation: v.literal("phase3-verification"),
  },
  handler: async (ctx, args) => {
    const user = await findUserFromArgs(ctx, args);

    if (!user) {
      throw new Error("Seed target user not found");
    }
    await requireSeedTargetAccess(ctx, user);

    const existingHabits = (await ctx.db
      .query("habits")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()) as Doc<"habits">[];
    const seedHabits = existingHabits.filter((habit) =>
      habit.name.startsWith(PHASE3_SEED_PREFIX),
    );

    if (args.resetExisting !== false && seedHabits.length > 0) {
      await deleteSeedData(
        ctx,
        user._id,
        seedHabits.map((habit) => habit._id),
      );
    }

    if (args.resetExisting !== false) {
      await clearUserDerivedMemory(ctx, user._id);
    }

    const now = Date.now();
    const tomorrow = shiftDateKey(args.today, 1);

    const readHabitId = await ctx.db.insert("habits", {
      userId: user._id,
      name: `${PHASE3_SEED_PREFIX} Read Book`,
      targetDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      scheduledTime: "20:00",
      reminderTime: "19:30",
      checkInDeadline: "22:30",
      rules: "Read 10 pages minimum.",
      motivation: "Build a reading habit that survives low-energy nights.",
      currentStreak: 2,
      bestStreak: 5,
      isActive: true,
      createdAt: now,
    });

    const gymHabitId = await ctx.db.insert("habits", {
      userId: user._id,
      name: `${PHASE3_SEED_PREFIX} Gym`,
      targetDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      scheduledTime: "18:30",
      reminderTime: "18:00",
      checkInDeadline: "21:00",
      rules: "Lift or cardio for at least 30 minutes.",
      motivation: "Stop letting the day bully the habit.",
      currentStreak: 0,
      bestStreak: 4,
      isActive: true,
      createdAt: now,
    });

    const meditateHabitId = await ctx.db.insert("habits", {
      userId: user._id,
      name: `${PHASE3_SEED_PREFIX} Meditate`,
      targetDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      scheduledTime: "06:30",
      reminderTime: "06:10",
      checkInDeadline: "08:00",
      rules: "Sit quietly for at least 10 minutes.",
      motivation: "Make mornings less chaotic.",
      currentStreak: 1,
      bestStreak: 3,
      isActive: true,
      createdAt: now,
    });

    for (const date of [
      shiftDateKey(args.today, -2),
      shiftDateKey(args.today, -1),
    ]) {
      await ctx.db.insert("checkIns", {
        habitId: readHabitId,
        userId: user._id,
        date,
        status: "completed",
        source: "chat",
        conversationSummary: "Seeded phase 3 reading completion",
        aiResponse: "Seed completion",
        timestamp: toTimestamp(date, "20:15"),
      });
    }

    await ctx.db.insert("checkIns", {
      habitId: gymHabitId,
      userId: user._id,
      date: shiftDateKey(args.today, -6),
      status: "missed",
      source: "chat",
      userReason: "capek pulang kerja",
      conversationSummary: "Seeded phase 3 gym miss",
      aiResponse: "Seed miss",
      timestamp: toTimestamp(shiftDateKey(args.today, -6), "21:10"),
    });
    await ctx.db.insert("checkIns", {
      habitId: gymHabitId,
      userId: user._id,
      date: shiftDateKey(args.today, -5),
      status: "completed",
      source: "chat",
      conversationSummary: "Seeded phase 3 gym recovery",
      aiResponse: "Seed completion",
      timestamp: toTimestamp(shiftDateKey(args.today, -5), "19:05"),
    });
    await ctx.db.insert("checkIns", {
      habitId: gymHabitId,
      userId: user._id,
      date: shiftDateKey(args.today, -3),
      status: "missed",
      source: "chat",
      userReason: "capek pulang kerja",
      conversationSummary: "Seeded phase 3 repeated gym miss",
      aiResponse: "Seed miss",
      timestamp: toTimestamp(shiftDateKey(args.today, -3), "21:10"),
    });

    await ctx.db.insert("checkIns", {
      habitId: meditateHabitId,
      userId: user._id,
      date: shiftDateKey(args.today, -1),
      status: "completed",
      source: "chat",
      conversationSummary: "Seeded phase 3 meditate completion",
      aiResponse: "Seed completion",
      timestamp: toTimestamp(shiftDateKey(args.today, -1), "06:50"),
    });

    const seededReminders: Array<{
      id: Id<"reminders">;
      habitName: string;
      type: "pre_workout" | "check_in" | "late_follow_up";
      date: string;
      sent: boolean;
      scheduledFor: number;
    }> = [];

    if (args.createDueReminders !== false) {
      for (const reminder of [
        {
          habitId: readHabitId,
          habitName: `${PHASE3_SEED_PREFIX} Read Book`,
          date: args.today,
          scheduledFor: now - 90 * 60 * 1000,
          type: "pre_workout" as const,
          sent: true,
        },
        {
          habitId: readHabitId,
          habitName: `${PHASE3_SEED_PREFIX} Read Book`,
          date: args.today,
          scheduledFor: now + 180 * 60 * 1000,
          type: "check_in" as const,
          sent: false,
        },
        {
          habitId: gymHabitId,
          habitName: `${PHASE3_SEED_PREFIX} Gym`,
          date: args.today,
          scheduledFor: now - 2 * 60 * 1000,
          type: "pre_workout" as const,
          sent: false,
        },
        {
          habitId: gymHabitId,
          habitName: `${PHASE3_SEED_PREFIX} Gym`,
          date: args.today,
          scheduledFor: now - 1 * 60 * 1000,
          type: "late_follow_up" as const,
          sent: false,
        },
        {
          habitId: meditateHabitId,
          habitName: `${PHASE3_SEED_PREFIX} Meditate`,
          date: tomorrow,
          scheduledFor: now + 26 * 60 * 60 * 1000,
          type: "pre_workout" as const,
          sent: false,
        },
      ]) {
        const reminderId = await ctx.db.insert("reminders", {
          habitId: reminder.habitId,
          userId: user._id,
          date: reminder.date,
          scheduledFor: reminder.scheduledFor,
          type: reminder.type,
          sent: reminder.sent,
        });
        seededReminders.push({
          id: reminderId,
          habitName: reminder.habitName,
          type: reminder.type,
          date: reminder.date,
          sent: reminder.sent,
          scheduledFor: reminder.scheduledFor,
        });
      }
    }

    return {
      userId: user._id,
      userEmail: user.email,
      today: args.today,
      tomorrow,
      habits: [
        {
          id: readHabitId,
          name: `${PHASE3_SEED_PREFIX} Read Book`,
          purpose: "recovery after reminder + memory-influenced reminder copy",
        },
        {
          id: gymHabitId,
          name: `${PHASE3_SEED_PREFIX} Gym`,
          purpose: "repeated-miss memory + reminder_ignored path",
        },
        {
          id: meditateHabitId,
          name: `${PHASE3_SEED_PREFIX} Meditate`,
          purpose: "chat miss_with_reason path",
        },
      ],
      reminders: seededReminders,
      suggestedChatCases: [
        `gue gagal ${PHASE3_SEED_PREFIX} Meditate hari ini karena ketiduran`,
        `geser ${PHASE3_SEED_PREFIX} Read Book besok jam 9 malam`,
        `gue males ${PHASE3_SEED_PREFIX} Read Book hari ini`,
        `hari ini gue udah beres ${PHASE3_SEED_PREFIX} Read Book`,
        `pattern ${PHASE3_SEED_PREFIX} Gym akhir-akhir ini gimana?`,
      ],
    };
  },
});

export const processPhase3DueReminders = action({
  args: {
    email: v.optional(v.string()),
    clerkId: v.optional(v.string()),
    before: v.optional(v.number()),
    confirmation: v.literal("phase3-verification"),
  },
  handler: async (ctx, args) => {
    const user = (await ctx.runQuery(internal.devSeeds.resolveSeedUser, {
      email: args.email,
      clerkId: args.clerkId,
    })) as Doc<"users"> | null;

    if (!user) {
      throw new Error("Seed target user not found");
    }
    await requireSeedTargetAccess(ctx, user);

    const dueReminders = (await ctx.runQuery(internal.reminders.listDue, {
      before: args.before ?? Date.now(),
    })) as Doc<"reminders">[];

    const userDue = dueReminders.filter((entry) => entry.userId === user._id);
    const results: Array<{
      reminderId: Id<"reminders">;
      type: "pre_workout" | "check_in" | "late_follow_up";
      shouldSendPush: boolean;
      skipped: boolean;
      checkInCreatedId?: Id<"checkIns">;
    }> = [];

    for (const reminder of userDue) {
      const result = (await ctx.runAction(
        internal.notificationsAction.processSingleReminderDelivery,
        {
          reminderId: reminder._id,
          skipPushDelivery: true,
        },
      )) as {
        processed?: number;
        shouldSendPush?: boolean;
        skipped?: boolean;
        checkInCreatedId?: Id<"checkIns">;
      } | null;

      if (!result?.processed) {
        continue;
      }

      results.push({
        reminderId: reminder._id,
        type: reminder.type,
        shouldSendPush: Boolean(result.shouldSendPush),
        skipped: Boolean(result.skipped),
        checkInCreatedId: result.checkInCreatedId,
      });
    }

    return {
      userId: user._id,
      processed: results.length,
      results,
    };
  },
});

export const refreshPhase3MemorySummaries = action({
  args: {
    email: v.optional(v.string()),
    clerkId: v.optional(v.string()),
    now: v.optional(v.number()),
    confirmation: v.literal("phase3-verification"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ userId: Id<"users">; habitsProcessed: number }> => {
    const user = (await ctx.runQuery(internal.devSeeds.resolveSeedUser, {
      email: args.email,
      clerkId: args.clerkId,
    })) as Doc<"users"> | null;

    if (!user) {
      throw new Error("Seed target user not found");
    }
    await requireSeedTargetAccess(ctx, user);

    return await ctx.runAction(internal.agentMemory.refreshUserSummaries, {
      userId: user._id,
      now: args.now,
    });
  },
});

export const seedPhase4Verification = mutation({
  args: {
    email: v.optional(v.string()),
    clerkId: v.optional(v.string()),
    today: v.string(),
    resetExisting: v.optional(v.boolean()),
    confirmation: v.literal("phase4-verification"),
  },
  handler: async (ctx, args) => {
    const user = await findUserFromArgs(ctx, args);

    if (!user) {
      throw new Error("Seed target user not found");
    }
    await requireSeedTargetAccess(ctx, user);

    const existingHabits = (await ctx.db
      .query("habits")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()) as Doc<"habits">[];
    const seedHabits = existingHabits.filter((habit) =>
      habit.name.startsWith(PHASE4_SEED_PREFIX),
    );

    if (args.resetExisting !== false && seedHabits.length > 0) {
      await deleteSeedData(
        ctx,
        user._id,
        seedHabits.map((habit) => habit._id),
      );
    }

    if (args.resetExisting !== false) {
      await clearUserDerivedMemory(ctx, user._id);
    }

    const now = Date.now();
    const tomorrow = shiftDateKey(args.today, 1);
    const dayAfterTomorrow = shiftDateKey(args.today, 2);

    const gymHabitId = await ctx.db.insert("habits", {
      userId: user._id,
      name: `${PHASE4_SEED_PREFIX} Gym`,
      targetDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      scheduledTime: "18:30",
      reminderTime: "18:00",
      checkInDeadline: "21:00",
      rules: "Lift or cardio for at least 30 minutes.",
      motivation: "Stop letting the day bully the habit.",
      currentStreak: 0,
      bestStreak: 4,
      isActive: true,
      createdAt: now,
    });

    const readHabitId = await ctx.db.insert("habits", {
      userId: user._id,
      name: `${PHASE4_SEED_PREFIX} Read Book`,
      targetDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      scheduledTime: "20:00",
      reminderTime: "19:30",
      checkInDeadline: "22:30",
      rules: "Read 10 pages minimum.",
      motivation: "Build a reading habit that survives low-energy nights.",
      currentStreak: 2,
      bestStreak: 5,
      isActive: true,
      createdAt: now,
    });

    const meditateHabitId = await ctx.db.insert("habits", {
      userId: user._id,
      name: `${PHASE4_SEED_PREFIX} Meditate`,
      targetDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      scheduledTime: "06:30",
      reminderTime: "06:10",
      checkInDeadline: "08:00",
      rules: "Sit quietly for at least 10 minutes.",
      motivation: "Keep the morning from turning feral.",
      currentStreak: 1,
      bestStreak: 3,
      isActive: true,
      createdAt: now,
    });

    const journalHabitId = await ctx.db.insert("habits", {
      userId: user._id,
      name: `${PHASE4_SEED_PREFIX} Journal`,
      targetDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      scheduledTime: "21:00",
      reminderTime: "20:30",
      checkInDeadline: "23:00",
      rules: "Write a short daily reflection.",
      motivation: "Close the day without mental leftovers.",
      currentStreak: 0,
      bestStreak: 2,
      isActive: true,
      createdAt: now,
    });

    await ctx.db.insert("checkIns", {
      habitId: readHabitId,
      userId: user._id,
      date: shiftDateKey(args.today, -1),
      status: "completed",
      source: "chat",
      conversationSummary: "Seeded phase 4 reading completion",
      aiResponse: "Seed completion",
      timestamp: now - 24 * 60 * 60 * 1000,
    });

    await ctx.db.insert("checkIns", {
      habitId: meditateHabitId,
      userId: user._id,
      date: shiftDateKey(args.today, -1),
      status: "completed",
      source: "chat",
      conversationSummary: "Seeded phase 4 meditate completion",
      aiResponse: "Seed completion",
      timestamp: now - 24 * 60 * 60 * 1000 + 15 * 60 * 1000,
    });

    await ctx.db.insert("habitSkips", {
      userId: user._id,
      habitId: gymHabitId,
      date: dayAfterTomorrow,
      reason: "travel day",
      createdBy: "agent",
      createdAt: now,
    });

    const seededRuns: Array<{
      id: Id<"reminderRuns">;
      habitName: string;
      date: string;
      state: Doc<"reminderRuns">["state"];
      userResponded: boolean;
    }> = [];
    const seededReminders: Array<{
      id: Id<"reminders">;
      habitName: string;
      type: "pre_workout" | "check_in" | "late_follow_up";
      date: string;
      sent: boolean;
      scheduledFor: number;
    }> = [];

    const insertRun = async (args: {
      habitId: Id<"habits">;
      habitName: string;
      date: string;
      state: Doc<"reminderRuns">["state"];
      userResponded?: boolean;
      responseIntent?: string;
      responseSummary?: string;
    }) => {
      const id = await ctx.db.insert("reminderRuns", {
        userId: user._id,
        habitId: args.habitId,
        date: args.date,
        state: args.state,
        userResponded: args.userResponded ?? false,
        responseIntent: args.responseIntent,
        responseSummary: args.responseSummary,
        createdAt: now,
        updatedAt: now,
      });

      seededRuns.push({
        id,
        habitName: args.habitName,
        date: args.date,
        state: args.state,
        userResponded: args.userResponded ?? false,
      });
    };

    const insertReminder = async (args: {
      habitId: Id<"habits">;
      habitName: string;
      date: string;
      type: "pre_workout" | "check_in" | "late_follow_up";
      scheduledFor: number;
      sent?: boolean;
    }) => {
      const id = await ctx.db.insert("reminders", {
        habitId: args.habitId,
        userId: user._id,
        date: args.date,
        scheduledFor: args.scheduledFor,
        type: args.type,
        sent: args.sent ?? false,
      });

      seededReminders.push({
        id,
        habitName: args.habitName,
        type: args.type,
        date: args.date,
        sent: args.sent ?? false,
        scheduledFor: args.scheduledFor,
      });
    };

    await insertRun({
      habitId: gymHabitId,
      habitName: `${PHASE4_SEED_PREFIX} Gym`,
      date: args.today,
      state: "scheduled",
    });
    await insertRun({
      habitId: readHabitId,
      habitName: `${PHASE4_SEED_PREFIX} Read Book`,
      date: args.today,
      state: "scheduled",
    });
    await insertRun({
      habitId: meditateHabitId,
      habitName: `${PHASE4_SEED_PREFIX} Meditate`,
      date: args.today,
      state: "scheduled",
    });
    await insertRun({
      habitId: journalHabitId,
      habitName: `${PHASE4_SEED_PREFIX} Journal`,
      date: tomorrow,
      state: "scheduled",
    });
    await insertRun({
      habitId: gymHabitId,
      habitName: `${PHASE4_SEED_PREFIX} Gym`,
      date: dayAfterTomorrow,
      state: "skipped",
    });

    for (const reminder of [
      {
        habitId: gymHabitId,
        habitName: `${PHASE4_SEED_PREFIX} Gym`,
        date: args.today,
        type: "pre_workout" as const,
        scheduledFor: now - 30 * 60 * 1000,
      },
      {
        habitId: gymHabitId,
        habitName: `${PHASE4_SEED_PREFIX} Gym`,
        date: args.today,
        type: "check_in" as const,
        scheduledFor: now - 20 * 60 * 1000,
      },
      {
        habitId: gymHabitId,
        habitName: `${PHASE4_SEED_PREFIX} Gym`,
        date: args.today,
        type: "late_follow_up" as const,
        scheduledFor: now - 10 * 60 * 1000,
      },
      {
        habitId: readHabitId,
        habitName: `${PHASE4_SEED_PREFIX} Read Book`,
        date: args.today,
        type: "pre_workout" as const,
        scheduledFor: now - 15 * 60 * 1000,
      },
      {
        habitId: readHabitId,
        habitName: `${PHASE4_SEED_PREFIX} Read Book`,
        date: args.today,
        type: "check_in" as const,
        scheduledFor: now + 75 * 60 * 1000,
      },
      {
        habitId: readHabitId,
        habitName: `${PHASE4_SEED_PREFIX} Read Book`,
        date: args.today,
        type: "late_follow_up" as const,
        scheduledFor: now + 165 * 60 * 1000,
      },
      {
        habitId: meditateHabitId,
        habitName: `${PHASE4_SEED_PREFIX} Meditate`,
        date: args.today,
        type: "pre_workout" as const,
        scheduledFor: now - 12 * 60 * 1000,
      },
      {
        habitId: meditateHabitId,
        habitName: `${PHASE4_SEED_PREFIX} Meditate`,
        date: args.today,
        type: "check_in" as const,
        scheduledFor: now + 90 * 60 * 1000,
      },
      {
        habitId: meditateHabitId,
        habitName: `${PHASE4_SEED_PREFIX} Meditate`,
        date: args.today,
        type: "late_follow_up" as const,
        scheduledFor: now + 180 * 60 * 1000,
      },
      {
        habitId: journalHabitId,
        habitName: `${PHASE4_SEED_PREFIX} Journal`,
        date: tomorrow,
        type: "pre_workout" as const,
        scheduledFor: now + 26 * 60 * 60 * 1000,
      },
      {
        habitId: journalHabitId,
        habitName: `${PHASE4_SEED_PREFIX} Journal`,
        date: tomorrow,
        type: "check_in" as const,
        scheduledFor: now + 27 * 60 * 60 * 1000,
      },
      {
        habitId: journalHabitId,
        habitName: `${PHASE4_SEED_PREFIX} Journal`,
        date: tomorrow,
        type: "late_follow_up" as const,
        scheduledFor: now + 29 * 60 * 60 * 1000,
      },
    ]) {
      await insertReminder(reminder);
    }

    return {
      userId: user._id,
      userEmail: user.email,
      today: args.today,
      tomorrow,
      dayAfterTomorrow,
      habits: [
        {
          id: gymHabitId,
          name: `${PHASE4_SEED_PREFIX} Gym`,
          purpose: "silent reminder progression to auto-miss",
        },
        {
          id: readHabitId,
          name: `${PHASE4_SEED_PREFIX} Read Book`,
          purpose: "hesitation then completion after reminder",
        },
        {
          id: meditateHabitId,
          name: `${PHASE4_SEED_PREFIX} Meditate`,
          purpose: "acknowledgement after reminder",
        },
        {
          id: journalHabitId,
          name: `${PHASE4_SEED_PREFIX} Journal`,
          purpose: "future-date reschedule or skip target",
        },
      ],
      reminderRuns: seededRuns,
      reminders: seededReminders,
      suggestedCommands: [
        `npm run phase4:process-reminders -- --email ${user.email} --habit "${PHASE4_SEED_PREFIX} Gym"`,
        `npm run phase4:process-reminders -- --email ${user.email} --habit "${PHASE4_SEED_PREFIX} Read Book" --types pre_workout`,
        `npm run phase4:process-reminders -- --email ${user.email} --habit "${PHASE4_SEED_PREFIX} Meditate" --types pre_workout`,
      ],
      suggestedChatCases: [
        `gue males ${PHASE4_SEED_PREFIX} Read Book hari ini`,
        `pattern ${PHASE4_SEED_PREFIX} Meditate akhir-akhir ini gimana?`,
        `hari ini gue udah beres ${PHASE4_SEED_PREFIX} Read Book`,
        `geser ${PHASE4_SEED_PREFIX} Journal besok jam 9 malam`,
        `skip ${PHASE4_SEED_PREFIX} Journal besok`,
      ],
    };
  },
});

export const processPhase4DueReminders = action({
  args: {
    email: v.optional(v.string()),
    clerkId: v.optional(v.string()),
    before: v.optional(v.number()),
    date: v.optional(v.string()),
    habitName: v.optional(v.string()),
    limit: v.optional(v.number()),
    types: v.optional(
      v.array(
        v.union(
          v.literal("pre_workout"),
          v.literal("check_in"),
          v.literal("late_follow_up"),
        ),
      ),
    ),
    confirmation: v.literal("phase4-verification"),
  },
  handler: async (ctx, args) => {
    const user = (await ctx.runQuery(internal.devSeeds.resolveSeedUser, {
      email: args.email,
      clerkId: args.clerkId,
    })) as Doc<"users"> | null;

    if (!user) {
      throw new Error("Seed target user not found");
    }
    await requireSeedTargetAccess(ctx, user);

    const dueReminders = (await ctx.runQuery(internal.reminders.listDue, {
      before: args.before ?? Date.now(),
    })) as Doc<"reminders">[];
    const habits = (await ctx.runQuery(internal.devSeeds.listSeedHabitsForUser, {
      userId: user._id,
    })) as Doc<"habits">[];

    const normalizedHabitName = args.habitName?.trim().toLowerCase() ?? null;
    const habitNameById = new Map(habits.map((habit) => [habit._id, habit.name]));
    const matchingHabitIds = normalizedHabitName
      ? habits
          .filter((habit) => {
            const candidate = habit.name.trim().toLowerCase();
            return (
              candidate === normalizedHabitName ||
              candidate.includes(normalizedHabitName)
            );
          })
          .map((habit) => habit._id)
      : null;

    const filtered = dueReminders
      .filter((entry) => entry.userId === user._id)
      .filter((entry) => (args.date ? entry.date === args.date : true))
      .filter((entry) =>
        args.types?.length ? args.types.includes(entry.type) : true,
      )
      .filter((entry) =>
        matchingHabitIds?.length ? matchingHabitIds.includes(entry.habitId) : true,
      )
      .sort((left, right) => left.scheduledFor - right.scheduledFor)
      .slice(0, args.limit && args.limit > 0 ? args.limit : undefined);

    const results: Array<{
      reminderId: Id<"reminders">;
      habitName: string;
      date: string;
      type: "pre_workout" | "check_in" | "late_follow_up";
      shouldSendPush: boolean;
      skipped: boolean;
      messageId?: Id<"messages">;
      checkInCreatedId?: Id<"checkIns">;
    }> = [];

    for (const reminder of filtered) {
      const result = (await ctx.runAction(
        internal.notificationsAction.processSingleReminderDelivery,
        {
          reminderId: reminder._id,
          skipPushDelivery: true,
        },
      )) as {
        processed?: number;
        shouldSendPush?: boolean;
        skipped?: boolean;
        messageId?: Id<"messages">;
        checkInCreatedId?: Id<"checkIns">;
      } | null;

      if (!result?.processed) {
        continue;
      }

      results.push({
        reminderId: reminder._id,
        habitName: habitNameById.get(reminder.habitId) ?? "[unknown habit]",
        date: reminder.date,
        type: reminder.type,
        shouldSendPush: Boolean(result.shouldSendPush),
        skipped: Boolean(result.skipped),
        messageId: result.messageId,
        checkInCreatedId: result.checkInCreatedId,
      });
    }

    return {
      userId: user._id,
      processed: results.length,
      filters: {
        before: args.before ?? Date.now(),
        date: args.date ?? null,
        habitName: args.habitName ?? null,
        types: args.types ?? [],
        limit: args.limit ?? null,
      },
      results,
    };
  },
});

export const seedPhase5Verification = mutation({
  args: {
    email: v.optional(v.string()),
    clerkId: v.optional(v.string()),
    today: v.string(),
    resetExisting: v.optional(v.boolean()),
    confirmation: v.literal("phase5-verification"),
  },
  handler: async (ctx, args) => {
    const user = await findUserFromArgs(ctx, args);

    if (!user) {
      throw new Error("Seed target user not found");
    }
    await requireSeedTargetAccess(ctx, user);

    const existingHabits = (await ctx.db
      .query("habits")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()) as Doc<"habits">[];
    const seedHabits = existingHabits.filter((habit) =>
      habit.name.startsWith(PHASE5_SEED_PREFIX),
    );

    if (args.resetExisting !== false && seedHabits.length > 0) {
      await deleteSeedData(
        ctx,
        user._id,
        seedHabits.map((habit) => habit._id),
      );
    }

    if (args.resetExisting !== false) {
      await clearAllUserTasks(ctx, user._id);
      await clearAllUserConversationState(ctx, user._id);
      await clearUserDerivedMemory(ctx, user._id);
    }

    const now = Date.now();
    const yesterday = shiftDateKey(args.today, -1);
    const twoDaysAgo = shiftDateKey(args.today, -2);
    const threeDaysAgo = shiftDateKey(args.today, -3);
    const fiveDaysAgo = shiftDateKey(args.today, -5);
    const tomorrow = shiftDateKey(args.today, 1);
    const todayDayKey = dayKeyFromDateKey(args.today);
    const tomorrowDayKey = dayKeyFromDateKey(tomorrow);

    const gymHabitId = await ctx.db.insert("habits", {
      userId: user._id,
      name: `${PHASE5_SEED_PREFIX} Gym`,
      targetDays: [todayDayKey],
      scheduledTime: "18:30",
      reminderTime: "18:00",
      checkInDeadline: "21:00",
      rules: "Lift or cardio for at least 30 minutes.",
      motivation: "Stop letting capek jadi alasan otomatis.",
      currentStreak: 0,
      bestStreak: 4,
      isActive: true,
      createdAt: now,
    });

    const readHabitId = await ctx.db.insert("habits", {
      userId: user._id,
      name: `${PHASE5_SEED_PREFIX} Read Book`,
      targetDays: [tomorrowDayKey],
      scheduledTime: "20:00",
      reminderTime: "19:30",
      checkInDeadline: "22:30",
      rules: "Read 10 pages minimum.",
      motivation: "Keep the reading habit alive on busy nights.",
      currentStreak: 2,
      bestStreak: 5,
      isActive: true,
      createdAt: now,
    });

    const meditateHabitId = await ctx.db.insert("habits", {
      userId: user._id,
      name: `${PHASE5_SEED_PREFIX} Meditate`,
      targetDays: [todayDayKey],
      scheduledTime: "06:30",
      reminderTime: "06:10",
      checkInDeadline: "08:00",
      rules: "Sit quietly for at least 10 minutes.",
      motivation: "Keep the morning stable.",
      currentStreak: 4,
      bestStreak: 6,
      isActive: true,
      createdAt: now,
    });

    const journalHabitId = await ctx.db.insert("habits", {
      userId: user._id,
      name: `${PHASE5_SEED_PREFIX} Journal`,
      targetDays: [tomorrowDayKey],
      scheduledTime: "21:00",
      reminderTime: "20:30",
      checkInDeadline: "23:00",
      rules: "Write a short daily reflection.",
      motivation: "Close the day cleanly.",
      currentStreak: 1,
      bestStreak: 3,
      isActive: true,
      createdAt: now,
    });

    for (const seededCheckIn of [
      {
        habitId: gymHabitId,
        date: fiveDaysAgo,
        status: "missed" as const,
        userReason: "capek pulang kerja",
        conversationSummary: "Seeded phase 5 gym miss",
        aiResponse: "Seed miss",
        timestamp: toTimestamp(fiveDaysAgo, "21:10"),
      },
      {
        habitId: gymHabitId,
        date: threeDaysAgo,
        status: "missed" as const,
        userReason: "capek pulang kerja",
        conversationSummary: "Seeded phase 5 repeated gym miss",
        aiResponse: "Seed miss",
        timestamp: toTimestamp(threeDaysAgo, "21:20"),
      },
      {
        habitId: gymHabitId,
        date: yesterday,
        status: "missed" as const,
        userReason: "capek pulang kerja",
        conversationSummary: "Seeded phase 5 latest gym miss",
        aiResponse: "Seed miss",
        timestamp: toTimestamp(yesterday, "21:05"),
      },
      {
        habitId: readHabitId,
        date: yesterday,
        status: "completed" as const,
        userReason: undefined,
        conversationSummary: "Seeded phase 5 reading completion",
        aiResponse: "Seed completion",
        timestamp: toTimestamp(yesterday, "20:15"),
      },
      {
        habitId: meditateHabitId,
        date: args.today,
        status: "completed" as const,
        userReason: undefined,
        conversationSummary: "Seeded phase 5 meditate completion",
        aiResponse: "Seed completion",
        timestamp: toTimestamp(args.today, "06:45"),
      },
      {
        habitId: journalHabitId,
        date: twoDaysAgo,
        status: "completed" as const,
        userReason: undefined,
        conversationSummary: "Seeded phase 5 journal completion",
        aiResponse: "Seed completion",
        timestamp: toTimestamp(twoDaysAgo, "21:10"),
      },
    ]) {
      await ctx.db.insert("checkIns", {
        habitId: seededCheckIn.habitId,
        userId: user._id,
        date: seededCheckIn.date,
        status: seededCheckIn.status,
        source: "chat",
        userReason: seededCheckIn.userReason,
        conversationSummary: seededCheckIn.conversationSummary,
        aiResponse: seededCheckIn.aiResponse,
        timestamp: seededCheckIn.timestamp,
      });
    }

    const insertedRuns: Array<{
      id: Id<"reminderRuns">;
      habitName: string;
      date: string;
      state: Doc<"reminderRuns">["state"];
    }> = [];
    const insertedReminders: Array<{
      id: Id<"reminders">;
      habitName: string;
      date: string;
      type: "pre_workout" | "check_in" | "late_follow_up";
      sent: boolean;
    }> = [];
    const insertedTasks: Array<{
      id: Id<"agentTasks">;
      title: string;
      date: string;
      time: string | null;
      status: Doc<"agentTasks">["status"];
    }> = [];

    const insertRun = async (input: {
      habitId: Id<"habits">;
      habitName: string;
      date: string;
      state: Doc<"reminderRuns">["state"];
      userResponded?: boolean;
      responseIntent?: string;
      responseSummary?: string;
    }) => {
      const id = await ctx.db.insert("reminderRuns", {
        userId: user._id,
        habitId: input.habitId,
        date: input.date,
        state: input.state,
        userResponded: input.userResponded ?? false,
        responseIntent: input.responseIntent,
        responseSummary: input.responseSummary,
        createdAt: now,
        updatedAt: now,
      });
      insertedRuns.push({
        id,
        habitName: input.habitName,
        date: input.date,
        state: input.state,
      });
    };

    const insertReminder = async (input: {
      habitId: Id<"habits">;
      habitName: string;
      date: string;
      type: "pre_workout" | "check_in" | "late_follow_up";
      scheduledFor: number;
      sent?: boolean;
    }) => {
      const id = await ctx.db.insert("reminders", {
        habitId: input.habitId,
        userId: user._id,
        date: input.date,
        scheduledFor: input.scheduledFor,
        type: input.type,
        sent: input.sent ?? false,
      });
      insertedReminders.push({
        id,
        habitName: input.habitName,
        date: input.date,
        type: input.type,
        sent: input.sent ?? false,
      });
    };

    const insertTask = async (input: {
      title: string;
      date: string;
      time?: string;
      status?: Doc<"agentTasks">["status"];
    }) => {
      const id = await ctx.db.insert("agentTasks", {
        userId: user._id,
        title: input.title,
        date: input.date,
        time: input.time,
        status: input.status ?? "pending",
        source: "chat",
        createdAt: now,
        updatedAt: now,
      });
      insertedTasks.push({
        id,
        title: input.title,
        date: input.date,
        time: input.time ?? null,
        status: input.status ?? "pending",
      });
    };

    await insertRun({
      habitId: gymHabitId,
      habitName: `${PHASE5_SEED_PREFIX} Gym`,
      date: args.today,
      state: "user_hesitant",
      userResponded: true,
      responseIntent: "excuse",
      responseSummary: "Masih kelihatan resist dan gampang kelewat.",
    });
    await insertRun({
      habitId: readHabitId,
      habitName: `${PHASE5_SEED_PREFIX} Read Book`,
      date: args.today,
      state: "scheduled",
    });
    await insertRun({
      habitId: meditateHabitId,
      habitName: `${PHASE5_SEED_PREFIX} Meditate`,
      date: args.today,
      state: "completed",
      userResponded: true,
      responseIntent: "log_completion",
      responseSummary: "Meditasi hari ini sudah selesai.",
    });
    await insertRun({
      habitId: readHabitId,
      habitName: `${PHASE5_SEED_PREFIX} Read Book`,
      date: tomorrow,
      state: "scheduled",
    });
    await insertRun({
      habitId: journalHabitId,
      habitName: `${PHASE5_SEED_PREFIX} Journal`,
      date: tomorrow,
      state: "scheduled",
    });

    for (const reminder of [
      {
        habitId: gymHabitId,
        habitName: `${PHASE5_SEED_PREFIX} Gym`,
        date: args.today,
        type: "pre_workout" as const,
        scheduledFor: now - 20 * 60 * 1000,
        sent: true,
      },
      {
        habitId: gymHabitId,
        habitName: `${PHASE5_SEED_PREFIX} Gym`,
        date: args.today,
        type: "check_in" as const,
        scheduledFor: now + 30 * 60 * 1000,
      },
      {
        habitId: gymHabitId,
        habitName: `${PHASE5_SEED_PREFIX} Gym`,
        date: args.today,
        type: "late_follow_up" as const,
        scheduledFor: now + 120 * 60 * 1000,
      },
      {
        habitId: readHabitId,
        habitName: `${PHASE5_SEED_PREFIX} Read Book`,
        date: tomorrow,
        type: "pre_workout" as const,
        scheduledFor: now + 24 * 60 * 60 * 1000 + 30 * 60 * 1000,
      },
      {
        habitId: readHabitId,
        habitName: `${PHASE5_SEED_PREFIX} Read Book`,
        date: tomorrow,
        type: "check_in" as const,
        scheduledFor: now + 25 * 60 * 60 * 1000 + 30 * 60 * 1000,
      },
      {
        habitId: journalHabitId,
        habitName: `${PHASE5_SEED_PREFIX} Journal`,
        date: tomorrow,
        type: "pre_workout" as const,
        scheduledFor: now + 25 * 60 * 60 * 1000,
      },
    ]) {
      await insertReminder(reminder);
    }

    await insertTask({
      title: `${PHASE5_SEED_PREFIX} Send Invoice`,
      date: args.today,
      time: "18:15",
    });
    await insertTask({
      title: `${PHASE5_SEED_PREFIX} Admin Cleanup`,
      date: args.today,
    });
    await insertTask({
      title: `${PHASE5_SEED_PREFIX} Review Deck`,
      date: tomorrow,
      time: "20:00",
    });
    await insertTask({
      title: `${PHASE5_SEED_PREFIX} Call Mom`,
      date: tomorrow,
      time: "21:00",
    });

    return {
      userId: user._id,
      userEmail: user.email,
      today: args.today,
      tomorrow,
      habits: [
        { id: gymHabitId, name: `${PHASE5_SEED_PREFIX} Gym`, purpose: "today risk habit" },
        { id: readHabitId, name: `${PHASE5_SEED_PREFIX} Read Book`, purpose: "tomorrow plan habit" },
        { id: meditateHabitId, name: `${PHASE5_SEED_PREFIX} Meditate`, purpose: "today completed habit" },
        { id: journalHabitId, name: `${PHASE5_SEED_PREFIX} Journal`, purpose: "tomorrow late habit" },
      ],
      reminderRuns: insertedRuns,
      reminders: insertedReminders,
      tasks: insertedTasks,
      suggestedChatCases: [
        "hari ini apa yang belum beres?",
        "besok gue ngapain aja?",
        "mana yang paling rawan kelewat minggu ini?",
        "yang paling enak digeser apa besok?",
        `besok review retro jam 9 pagi`,
        `telepon ibu jam 8 malam besok`,
        `tambah task ${PHASE5_SEED_PREFIX} follow up client`,
      ],
    };
  },
});

export const processPhase5DueReminders = action({
  args: {
    email: v.optional(v.string()),
    clerkId: v.optional(v.string()),
    before: v.optional(v.number()),
    date: v.optional(v.string()),
    habitName: v.optional(v.string()),
    limit: v.optional(v.number()),
    types: v.optional(
      v.array(
        v.union(
          v.literal("pre_workout"),
          v.literal("check_in"),
          v.literal("late_follow_up"),
        ),
      ),
    ),
    confirmation: v.literal("phase5-verification"),
  },
  handler: async (ctx, args) => {
    const user = (await ctx.runQuery(internal.devSeeds.resolveSeedUser, {
      email: args.email,
      clerkId: args.clerkId,
    })) as Doc<"users"> | null;

    if (!user) {
      throw new Error("Seed target user not found");
    }
    await requireSeedTargetAccess(ctx, user);

    const dueReminders = (await ctx.runQuery(internal.reminders.listDue, {
      before: args.before ?? Date.now(),
    })) as Doc<"reminders">[];
    const habits = (await ctx.runQuery(internal.devSeeds.listSeedHabitsForUser, {
      userId: user._id,
    })) as Doc<"habits">[];

    const normalizedHabitName = args.habitName?.trim().toLowerCase() ?? null;
    const habitNameById = new Map(habits.map((habit) => [habit._id, habit.name]));
    const matchingHabitIds = normalizedHabitName
      ? habits
          .filter((habit) => {
            const candidate = habit.name.trim().toLowerCase();
            return candidate === normalizedHabitName || candidate.includes(normalizedHabitName);
          })
          .map((habit) => habit._id)
      : null;

    const filtered = dueReminders
      .filter((entry) => entry.userId === user._id)
      .filter((entry) => (args.date ? entry.date === args.date : true))
      .filter((entry) => (args.types?.length ? args.types.includes(entry.type) : true))
      .filter((entry) =>
        matchingHabitIds?.length ? matchingHabitIds.includes(entry.habitId) : true,
      )
      .sort((left, right) => left.scheduledFor - right.scheduledFor)
      .slice(0, args.limit && args.limit > 0 ? args.limit : undefined);

    const results: Array<{
      reminderId: Id<"reminders">;
      habitName: string;
      date: string;
      type: "pre_workout" | "check_in" | "late_follow_up";
      shouldSendPush: boolean;
      skipped: boolean;
      messageId?: Id<"messages">;
      checkInCreatedId?: Id<"checkIns">;
    }> = [];

    for (const reminder of filtered) {
      const result = (await ctx.runAction(
        internal.notificationsAction.processSingleReminderDelivery,
        {
          reminderId: reminder._id,
          skipPushDelivery: true,
        },
      )) as {
        processed?: number;
        shouldSendPush?: boolean;
        skipped?: boolean;
        messageId?: Id<"messages">;
        checkInCreatedId?: Id<"checkIns">;
      } | null;

      if (!result?.processed) {
        continue;
      }

      results.push({
        reminderId: reminder._id,
        habitName: habitNameById.get(reminder.habitId) ?? "[unknown habit]",
        date: reminder.date,
        type: reminder.type,
        shouldSendPush: Boolean(result.shouldSendPush),
        skipped: Boolean(result.skipped),
        messageId: result.messageId,
        checkInCreatedId: result.checkInCreatedId,
      });
    }

    return {
      userId: user._id,
      processed: results.length,
      filters: {
        before: args.before ?? Date.now(),
        date: args.date ?? null,
        habitName: args.habitName ?? null,
        types: args.types ?? [],
        limit: args.limit ?? null,
      },
      results,
    };
  },
});

const UI_SEED_PREFIX = "[Seed UI]";

function addMinutes(timeStr: string, minutes: number) {
  const [h, m] = timeStr.split(":").map(Number);
  const totalMin = (h ?? 0) * 60 + (m ?? 0) + minutes;
  const normalizedMin = ((totalMin % 1440) + 1440) % 1440;
  const newH = Math.floor(normalizedMin / 60);
  const newM = normalizedMin % 60;
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}

export const seedUIDemo = mutation({
  args: {
    email: v.optional(v.string()),
    clerkId: v.optional(v.string()),
    today: v.string(), // "YYYY-MM-DD"
    localTime: v.string(), // "HH:MM"
    resetExisting: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await findUserFromArgs(ctx, args);
    if (!user) {
      throw new Error("Seed target user not found");
    }
    await requireSeedTargetAccess(ctx, user);

    const existingHabits = (await ctx.db
      .query("habits")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()) as Doc<"habits">[];
    const seedHabits = existingHabits.filter((h) =>
      h.name.startsWith(UI_SEED_PREFIX),
    );

    if (args.resetExisting !== false && seedHabits.length > 0) {
      await deleteSeedData(
        ctx,
        user._id,
        seedHabits.map((h) => h._id),
      );
    }

    const now = Date.now();
    const yesterday = shiftDateKey(args.today, -1);
    const twoDaysAgo = shiftDateKey(args.today, -2);
    const threeDaysAgo = shiftDateKey(args.today, -3);
    const fourDaysAgo = shiftDateKey(args.today, -4);
    const fiveDaysAgo = shiftDateKey(args.today, -5);
    const tomorrowKey = dayKeyFromDateKey(shiftDateKey(args.today, 1));
    const allDays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

    const makeHabit = async (
      name: string,
      targetDays: string[],
      schOffset: number,
      remOffset: number,
      dlOffset: number,
      options?: {
        currentStreak?: number;
        bestStreak?: number;
        isActive?: boolean;
        rules?: string;
        motivation?: string;
      },
    ) => {
      return await ctx.db.insert("habits", {
        userId: user._id,
        name: `${UI_SEED_PREFIX} ${name}`,
        targetDays,
        scheduledTime: addMinutes(args.localTime, schOffset),
        reminderTime: addMinutes(args.localTime, remOffset),
        checkInDeadline: addMinutes(args.localTime, dlOffset),
        rules: options?.rules ?? "UI demonstration habit",
        motivation: options?.motivation ?? "To review frontend states before they happen live",
        currentStreak: options?.currentStreak ?? 0,
        bestStreak: options?.bestStreak ?? 0,
        isActive: options?.isActive ?? true,
        createdAt: now,
      });
    };

    const makeCheckIn = async (
      habitId: Id<"habits">,
      date: string,
      status: "completed" | "missed" | "bonus",
      tsOffsetMins: number,
    ) => {
      return await ctx.db.insert("checkIns", {
        habitId,
        userId: user._id,
        date,
        status,
        source: "chat",
        conversationSummary: `Seeded UI Demo ${status}`,
        aiResponse: `Seeded ${status}`,
        timestamp: toTimestamp(date, addMinutes(args.localTime, tsOffsetMins)),
      });
    };

    const makeWorkoutLog = async (
      habitId: Id<"habits">,
      checkInId: Id<"checkIns">,
      exercises: Doc<"workoutLogs">["exercises"],
      notes?: string,
    ) => {
      return await ctx.db.insert("workoutLogs", {
        habitId,
        checkInId,
        exercises,
        notes,
      });
    };

    const makeMessage = async (
      role: "user" | "ai",
      content: string,
      tsOffsetMins: number,
      intent?: string,
      habitId?: Id<"habits">,
    ) => {
      return await ctx.db.insert("messages", {
        userId: user._id,
        habitId,
        role,
        content,
        intent,
        timestamp: toTimestamp(args.today, addMinutes(args.localTime, tsOffsetMins)),
      });
    };

    await makeHabit("Upcoming", allDays, 120, 100, 240, {
      currentStreak: 5,
      bestStreak: 10,
    });

    const dueSoonHabit = await makeHabit("Due Soon", allDays, -10, -30, 90, {
      currentStreak: 12,
      bestStreak: 20,
    });

    const deadlineRiskHabit = await makeHabit(
      "Deadline Risk",
      allDays,
      -60,
      -90,
      30,
      {
        currentStreak: 100,
        bestStreak: 100,
      },
    );

    const overdueHabit = await makeHabit("Overdue", allDays, -180, -200, -10, {
      currentStreak: 3,
      bestStreak: 5,
    });

    const loggedHabit = await makeHabit(
      "Logged Today",
      allDays,
      -60,
      -90,
      120,
      {
        currentStreak: 1,
        bestStreak: 1,
      },
    );
    const loggedTodayCheckIn = await makeCheckIn(
      loggedHabit,
      args.today,
      "completed",
      -15,
    );

    const missedHabit = await makeHabit(
      "Missed Today",
      allDays,
      -300,
      -320,
      -120,
      {
        currentStreak: 0,
        bestStreak: 14,
      },
    );
    await makeCheckIn(missedHabit, args.today, "missed", -110);

    const restHabit = await makeHabit("Rest Day", [tomorrowKey], 0, -30, 120, {
      currentStreak: 10,
      bestStreak: 10,
    });

    const bonusHabit = await makeHabit(
      "Bonus Action",
      [tomorrowKey],
      0,
      -30,
      120,
      {
        currentStreak: 0,
        bestStreak: 0,
      },
    );
    const bonusTodayCheckIn = await makeCheckIn(
      bonusHabit,
      args.today,
      "bonus",
      -5,
    );

    await makeHabit("Paused Habit", [dayKeyFromDateKey(args.today)], -45, -75, 60, {
      currentStreak: 7,
      bestStreak: 18,
      isActive: false,
      rules: "Paused on purpose for profile and detail panel review",
      motivation: "Confirm paused state styling and copy",
    });

    const dueSoonRecent = await makeCheckIn(
      dueSoonHabit,
      yesterday,
      "completed",
      -25,
    );
    await makeCheckIn(deadlineRiskHabit, threeDaysAgo, "completed", -35);
    await makeCheckIn(deadlineRiskHabit, fourDaysAgo, "completed", -50);
    await makeCheckIn(overdueHabit, twoDaysAgo, "missed", -70);
    await makeCheckIn(missedHabit, fiveDaysAgo, "missed", -80);
    await makeCheckIn(restHabit, yesterday, "completed", -40);

    await makeWorkoutLog(
      loggedHabit,
      loggedTodayCheckIn,
      [
        { name: "Back squat", sets: 4, reps: 6, weight: 100 },
        { name: "RDL", sets: 3, reps: 8, weight: 80 },
      ],
      "Seeded heavy lower-body session",
    );
    await makeWorkoutLog(
      dueSoonHabit,
      dueSoonRecent,
      [{ name: "Tempo run", duration: 28, distance: 5 }],
      "Seeded cardio log for stats rail",
    );
    await makeWorkoutLog(
      bonusHabit,
      bonusTodayCheckIn,
      [{ name: "Mobility flow", duration: 20 }],
      "Bonus session that should stay visible in stats",
    );

    await makeMessage(
      "ai",
      "Reminder fired. The window is already open. Either log the work or admit you missed it.",
      -95,
      "check_in",
      deadlineRiskHabit,
    );
    await makeMessage(
      "user",
      "Gue baru selesai squat sama RDL tadi.",
      -18,
      "completed",
      loggedHabit,
    );
    await makeMessage(
      "ai",
      "Logged. Good. That counts. Keep the next rep just as clean.",
      -17,
      "completed",
      loggedHabit,
    );
    await makeMessage(
      "user",
      "Besok gue mesti ngapain aja?",
      -9,
      "ask_tomorrow_plan",
      dueSoonHabit,
    );
    await makeMessage(
      "ai",
      "Tomorrow plan: Rest Day is the only scheduled item. Bonus work is optional, not a free excuse to drift.",
      -8,
      "planning",
      restHabit,
    );
    await makeMessage(
      "ai",
      "Weekly review for [Seed UI] Missed Today: 4/7. You leaked two sessions for the same weak reason. Fix the pattern before it becomes your identity.",
      -2,
      "weekly_review",
      missedHabit,
    );

    const weekStart = shiftDateKey(args.today, -6);
    await ctx.db.insert("weeklyReports", {
      userId: user._id,
      habitId: missedHabit,
      weekStart,
      weekEnd: args.today,
      targetCount: 7,
      actualCount: 4,
      bonusCount: 1,
      completionRate: 57,
      aiRoast:
        "You hit 4 out of 7 and still found time to miss the same habit twice. The pattern is obvious. The discipline is not.",
      missedDaysReasons: [
        { day: "Tue", reason: "late start" },
        { day: "Thu", reason: "ignored the reminder" },
      ],
    });

    return {
      userId: user._id,
      today: args.today,
      localTime: args.localTime,
      habitsCreated: 9,
      messagesCreated: 6,
      workoutLogsCreated: 3,
      weeklyReportsCreated: 1,
      message:
        "Successfully seeded home, chat, stats, and profile-supporting UI review states.",
    };
  },
});
