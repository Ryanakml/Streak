import { formatInTimeZone } from "date-fns-tz";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

type ReminderType = "pre_workout" | "check_in" | "late_follow_up";
type CheckInStatus = "completed" | "missed" | "bonus";

const exerciseInputValidator = v.object({
  name: v.string(),
  sets: v.optional(v.number()),
  reps: v.optional(v.number()),
  weight: v.optional(v.number()),
  duration: v.optional(v.number()),
  distance: v.optional(v.number()),
});

function getTimezone(user: { timezone?: string }) {
  return user.timezone ?? "UTC";
}

function getDateKey(date: Date, timezone: string) {
  return formatInTimeZone(date, timezone, "yyyy-MM-dd");
}

function getDayKey(date: Date, timezone: string) {
  return formatInTimeZone(date, timezone, "EEE").toLowerCase().slice(0, 3);
}

function shiftDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function compareCheckInsDesc(left: Doc<"checkIns">, right: Doc<"checkIns">) {
  if (left.date !== right.date) {
    return right.date.localeCompare(left.date);
  }

  return right.timestamp - left.timestamp;
}

function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(":").map((part) => Number(part));
  return hours * 60 + minutes;
}

function minutesToTime(totalMinutes: number) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (normalized % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function shiftScheduleTimes(args: {
  scheduledTime: string;
  reminderTime: string;
  checkInDeadline: string;
  nextScheduledTime: string;
}) {
  const scheduledMinutes = timeToMinutes(args.scheduledTime);
  const reminderOffset = timeToMinutes(args.reminderTime) - scheduledMinutes;
  const deadlineOffset = timeToMinutes(args.checkInDeadline) - scheduledMinutes;
  const nextScheduledMinutes = timeToMinutes(args.nextScheduledTime);

  return {
    scheduledTime: args.nextScheduledTime,
    reminderTime: minutesToTime(nextScheduledMinutes + reminderOffset),
    checkInDeadline: minutesToTime(nextScheduledMinutes + deadlineOffset),
  };
}

function getScheduleForDay(habit: Doc<"habits">, dayKey: string) {
  if (dayKey === "fri" && habit.schedules?.fri) {
    return habit.schedules.fri;
  }

  return {
    scheduledTime: habit.scheduledTime,
    reminderTime: habit.reminderTime,
    checkInDeadline: habit.checkInDeadline,
  };
}

function buildRiskNote(args: {
  currentStreak: number;
  missedLast7d: number;
  completedLast7d: number;
  skipExists: boolean;
}) {
  if (args.skipExists) {
    return "intentionally skipped";
  }

  if (args.currentStreak >= 3) {
    return `protect ${args.currentStreak}-day streak`;
  }

  if (args.missedLast7d >= 2) {
    return "slipping lately";
  }

  if (args.completedLast7d >= 2) {
    return "stable momentum";
  }

  return "normal priority";
}

async function getExistingCheckInForHabit(args: {
  ctx: MutationCtx;
  userId: Id<"users">;
  habitId: Id<"habits">;
  date: string;
}) {
  const existingForDate = (await args.ctx.db
    .query("checkIns")
    .withIndex("by_user_date", (q) =>
      q.eq("userId", args.userId).eq("date", args.date),
    )
    .collect()) as Doc<"checkIns">[];

  return existingForDate.find((entry) => entry.habitId === args.habitId) ?? null;
}

export const getPendingActionForUser = internalQuery({
  args: { userId: v.id("users"), now: v.number() },
  handler: async (ctx, args) => {
    const pending = await ctx.db
      .query("agentPendingActions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const active = pending
      .filter((entry) => entry.expiresAt > args.now)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0];

    return active ?? null;
  },
});

export const executeLogCompletion = internalMutation({
  args: {
    userId: v.id("users"),
    habitId: v.id("habits"),
    date: v.string(),
    status: v.union(v.literal("completed"), v.literal("bonus")),
    reason: v.optional(v.string()),
    conversationSummary: v.optional(v.string()),
    workout: v.optional(
      v.object({
        exercises: v.array(exerciseInputValidator),
        notes: v.optional(v.string()),
      }),
    ),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const habit = await ctx.db.get(args.habitId);
    if (!habit || habit.userId !== args.userId) {
      throw new Error("Habit not found");
    }

    const existing = await getExistingCheckInForHabit({
      ctx,
      userId: args.userId,
      habitId: args.habitId,
      date: args.date,
    });

    if (existing) {
      return {
        status: "no_op" as const,
        habitId: args.habitId,
        habitName: habit.name,
        checkInId: existing._id,
        workoutLogId: undefined,
        checkInStatus: existing.status,
      };
    }

    const checkInId = await ctx.db.insert("checkIns", {
      habitId: args.habitId,
      userId: args.userId,
      date: args.date,
      status: args.status,
      source: "chat",
      userReason: args.reason,
      conversationSummary: args.conversationSummary,
      aiResponse: "[pending_ai_response]",
      timestamp: args.timestamp,
    });

    if (args.status === "completed") {
      const nextStreak = habit.currentStreak + 1;
      await ctx.db.patch(args.habitId, {
        currentStreak: nextStreak,
        bestStreak: Math.max(habit.bestStreak, nextStreak),
      });
    }

    let workoutLogId: Id<"workoutLogs"> | undefined;
    if (args.workout && args.workout.exercises.length > 0) {
      workoutLogId = await ctx.db.insert("workoutLogs", {
        habitId: args.habitId,
        checkInId,
        exercises: args.workout.exercises,
        notes: args.workout.notes,
      });
    }

    return {
      status: "executed" as const,
      habitId: args.habitId,
      habitName: habit.name,
      checkInId,
      workoutLogId,
      checkInStatus: args.status,
    };
  },
});

export const executeLogMiss = internalMutation({
  args: {
    userId: v.id("users"),
    habitId: v.id("habits"),
    date: v.string(),
    reason: v.optional(v.string()),
    conversationSummary: v.optional(v.string()),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const habit = await ctx.db.get(args.habitId);
    if (!habit || habit.userId !== args.userId) {
      throw new Error("Habit not found");
    }

    const existing = await getExistingCheckInForHabit({
      ctx,
      userId: args.userId,
      habitId: args.habitId,
      date: args.date,
    });

    if (existing) {
      return {
        status: "no_op" as const,
        habitId: args.habitId,
        habitName: habit.name,
        checkInId: existing._id,
        checkInStatus: existing.status,
      };
    }

    const checkInId = await ctx.db.insert("checkIns", {
      habitId: args.habitId,
      userId: args.userId,
      date: args.date,
      status: "missed",
      source: "chat",
      userReason: args.reason,
      conversationSummary: args.conversationSummary,
      aiResponse: "[pending_ai_response]",
      timestamp: args.timestamp,
    });

    await ctx.db.patch(args.habitId, {
      currentStreak: 0,
    });

    return {
      status: "executed" as const,
      habitId: args.habitId,
      habitName: habit.name,
      checkInId,
      checkInStatus: "missed" as CheckInStatus,
    };
  },
});

export const upsertPendingAction = internalMutation({
  args: {
    userId: v.id("users"),
    messageId: v.optional(v.id("messages")),
    intent: v.string(),
    actionType: v.string(),
    targetHabitId: v.optional(v.id("habits")),
    payload: v.any(),
    missingFields: v.array(v.string()),
    clarificationQuestion: v.string(),
    expiresAt: v.number(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentPendingActions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const latest = existing.sort((left, right) => right.updatedAt - left.updatedAt)[0];
    if (latest) {
      await ctx.db.patch(latest._id, {
        messageId: args.messageId,
        intent: args.intent,
        actionType: args.actionType,
        targetHabitId: args.targetHabitId,
        payload: args.payload,
        missingFields: args.missingFields,
        clarificationQuestion: args.clarificationQuestion,
        expiresAt: args.expiresAt,
        updatedAt: args.now,
      });
      return latest._id;
    }

    return await ctx.db.insert("agentPendingActions", {
      userId: args.userId,
      messageId: args.messageId,
      intent: args.intent,
      actionType: args.actionType,
      targetHabitId: args.targetHabitId,
      payload: args.payload,
      missingFields: args.missingFields,
      clarificationQuestion: args.clarificationQuestion,
      expiresAt: args.expiresAt,
      createdAt: args.now,
      updatedAt: args.now,
    });
  },
});

export const clearPendingAction = internalMutation({
  args: { id: v.id("agentPendingActions") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
    return args.id;
  },
});

export const logAction = internalMutation({
  args: {
    userId: v.id("users"),
    messageId: v.optional(v.id("messages")),
    intent: v.string(),
    actionType: v.string(),
    targetType: v.string(),
    targetId: v.optional(v.string()),
    status: v.union(
      v.literal("executed"),
      v.literal("clarification_requested"),
      v.literal("cancelled"),
      v.literal("no_op"),
      v.literal("failed"),
    ),
    inputSummary: v.string(),
    resultSummary: v.optional(v.string()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentActionLogs", args);
  },
});

export const executeRescheduleHabitTime = internalMutation({
  args: {
    userId: v.id("users"),
    habitId: v.id("habits"),
    targetDate: v.string(),
    targetTime: v.string(),
  },
  handler: async (ctx, args) => {
    const habit = await ctx.db.get(args.habitId);
    if (!habit || habit.userId !== args.userId) {
      throw new Error("Habit not found");
    }

    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const dayKey = getDayKey(new Date(`${args.targetDate}T12:00:00.000Z`), getTimezone(user));

    if (dayKey === "fri") {
      const baseSchedule = getScheduleForDay(habit, dayKey);
      const shifted = shiftScheduleTimes({
        scheduledTime: baseSchedule.scheduledTime,
        reminderTime: baseSchedule.reminderTime,
        checkInDeadline: baseSchedule.checkInDeadline,
        nextScheduledTime: args.targetTime,
      });

      await ctx.db.patch(args.habitId, {
        schedules: {
          ...habit.schedules,
          fri: shifted,
        },
      });
    } else {
      const shifted = shiftScheduleTimes({
        scheduledTime: habit.scheduledTime,
        reminderTime: habit.reminderTime,
        checkInDeadline: habit.checkInDeadline,
        nextScheduledTime: args.targetTime,
      });

      await ctx.db.patch(args.habitId, shifted);
    }

    await ctx.scheduler.runAfter(0, internal.reminders.refreshForHabit, {
      habitId: args.habitId,
    });

    const updatedHabit = await ctx.db.get(args.habitId);
    return {
      habitId: args.habitId,
      habitName: updatedHabit?.name ?? habit.name,
      targetDate: args.targetDate,
      targetTime: args.targetTime,
      dayKey,
    };
  },
});

export const executeSkipHabitForDate = internalMutation({
  args: {
    userId: v.id("users"),
    habitId: v.id("habits"),
    date: v.string(),
    reason: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const habit = await ctx.db.get(args.habitId);
    if (!habit || habit.userId !== args.userId) {
      throw new Error("Habit not found");
    }

    const existing = await ctx.db
      .query("habitSkips")
      .withIndex("by_habit_date", (q) =>
        q.eq("habitId", args.habitId).eq("date", args.date),
      )
      .unique();

    let skipId = existing?._id;
    let status: "executed" | "no_op" = "executed";

    if (existing) {
      status = "no_op";
      await ctx.db.patch(existing._id, {
        reason: args.reason ?? existing.reason,
      });
    } else {
      skipId = await ctx.db.insert("habitSkips", {
        userId: args.userId,
        habitId: args.habitId,
        date: args.date,
        reason: args.reason,
        createdBy: "agent",
        createdAt: args.now,
      });
    }

    await ctx.scheduler.runAfter(0, internal.reminders.refreshForHabit, {
      habitId: args.habitId,
    });

    return {
      skipId,
      habitId: args.habitId,
      habitName: habit.name,
      date: args.date,
      status,
    };
  },
});

export const getPlanForDate = internalQuery({
  args: {
    userId: v.id("users"),
    date: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const timezone = getTimezone(user);
    const planDate = new Date(`${args.date}T12:00:00.000Z`);
    const dayKey = getDayKey(planDate, timezone);
    const activeHabits = (await ctx.db
      .query("habits")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect()) as Doc<"habits">[];

    const habits = activeHabits.filter((habit) => habit.isActive);
    const checkInsForDate = (await ctx.db
      .query("checkIns")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", args.userId).eq("date", args.date),
      )
      .collect()) as Doc<"checkIns">[];
    const remindersForDate = (await ctx.db
      .query("reminders")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect()) as Doc<"reminders">[];
    const skipsForDate = (await ctx.db
      .query("habitSkips")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", args.userId).eq("date", args.date),
      )
      .collect()) as Doc<"habitSkips">[];
    const allCheckIns = (await ctx.db
      .query("checkIns")
      .withIndex("by_user_date", (q) => q.eq("userId", args.userId))
      .collect()) as Doc<"checkIns">[];
    const date7dStart = shiftDateKey(args.date, -6);
    const todayDate = getDateKey(new Date(args.now), timezone);

    const items = habits
      .filter((habit) => {
        const skipExists = skipsForDate.some((skip) => skip.habitId === habit._id);
        return habit.targetDays.includes(dayKey) || skipExists;
      })
      .map((habit) => {
        const schedule = getScheduleForDay(habit, dayKey);
        const checkIn =
          checkInsForDate.find((entry) => entry.habitId === habit._id) ?? null;
        const skip =
          skipsForDate.find((entry) => entry.habitId === habit._id) ?? null;
        const reminders = remindersForDate.filter(
          (entry) => entry.habitId === habit._id && entry.date === args.date,
        );
        const recentHabitCheckIns = allCheckIns
          .filter((entry) => entry.habitId === habit._id)
          .sort(compareCheckInsDesc);
        const checkInsLast7d = recentHabitCheckIns.filter(
          (entry) => entry.date >= date7dStart && entry.date <= args.date,
        );
        const missedLast7d = checkInsLast7d.filter(
          (entry) => entry.status === "missed",
        ).length;
        const completedLast7d = checkInsLast7d.filter(
          (entry) => entry.status === "completed",
        ).length;
        const isToday = args.date === todayDate;

        return {
          habitId: habit._id,
          habitName: habit.name,
          scheduledTime: schedule.scheduledTime,
          skipped: Boolean(skip),
          skipReason: skip?.reason ?? null,
          checkInStatus: checkIn?.status ?? null,
          reminderStatus: isToday
            ? {
                pendingTypes: reminders
                  .filter((entry) => !entry.sent)
                  .map((entry) => entry.type) as ReminderType[],
                sentTypes: reminders
                  .filter((entry) => entry.sent)
                  .map((entry) => entry.type) as ReminderType[],
              }
            : null,
          riskNote: buildRiskNote({
            currentStreak: habit.currentStreak,
            missedLast7d,
            completedLast7d,
            skipExists: Boolean(skip),
          }),
        };
      })
      .sort((left, right) => left.scheduledTime.localeCompare(right.scheduledTime));

    return {
      date: args.date,
      dayKey,
      items,
    };
  },
});
