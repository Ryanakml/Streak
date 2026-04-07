import { formatInTimeZone } from "date-fns-tz";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

type ReminderType = "pre_workout" | "check_in" | "late_follow_up";
type CheckInStatus = "completed" | "missed" | "bonus";
type ReminderRunState = Doc<"reminderRuns">["state"];
type PlannerItemStatus =
  | "pending"
  | "completed"
  | "missed"
  | "bonus"
  | "skipped"
  | "rescheduled"
  | "done"
  | "cancelled";
type PlannerItem = {
  itemType: "habit" | "task";
  itemId: string;
  title: string;
  scheduledTime: string | null;
  status: PlannerItemStatus;
  riskNote: string;
  conflictWith: string[];
  itemDate: string;
};
type RiskScanItem = {
  itemType: "habit" | "task";
  title: string;
  date: string;
  scheduledTime: string | null;
  reason: string;
  suggestion: string;
  score: number;
};
type RescheduleSuggestionItem = {
  title: string;
  currentTime: string | null;
  suggestedTime: string | null;
  reason: string;
};

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

function isHabitScheduledOnDay(habit: Doc<"habits">, dayKey: string) {
  return habit.targetDays.includes(dayKey);
}

function isHabitRelevantForDate(args: {
  habit: Doc<"habits">;
  dayKey: string;
  checkIn: Doc<"checkIns"> | null;
  skip: Doc<"habitSkips"> | null;
  reminderRun: Doc<"reminderRuns"> | null;
  reminders: Doc<"reminders">[];
}) {
  return (
    isHabitScheduledOnDay(args.habit, args.dayKey) ||
    Boolean(args.checkIn) ||
    Boolean(args.skip) ||
    Boolean(args.reminderRun) ||
    args.reminders.length > 0
  );
}

function buildRiskNote(args: {
  currentStreak: number;
  missedLast7d: number;
  completedLast7d: number;
  skipExists: boolean;
  reminderRunState?: ReminderRunState | null;
}) {
  if (args.skipExists) {
    return "intentionally skipped";
  }

  if (args.reminderRunState === "user_hesitant") {
    return "already showing resistance";
  }

  if (args.reminderRunState === "ignored_once") {
    return "already ignored once";
  }

  if (args.reminderRunState === "rescheduled") {
    return "recently rescheduled";
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

function compareTasksDesc(
  left: Pick<Doc<"agentTasks">, "date" | "_creationTime">,
  right: Pick<Doc<"agentTasks">, "date" | "_creationTime">,
) {
  if (left.date !== right.date) {
    return right.date.localeCompare(left.date);
  }

  return right._creationTime - left._creationTime;
}

function comparePlannerItems(left: PlannerItem, right: PlannerItem) {
  if (left.scheduledTime && right.scheduledTime) {
    const delta = timeToMinutes(left.scheduledTime) - timeToMinutes(right.scheduledTime);
    if (delta !== 0) {
      return delta;
    }
  } else if (left.scheduledTime) {
    return -1;
  } else if (right.scheduledTime) {
    return 1;
  }

  return left.title.localeCompare(right.title);
}

function getTaskRiskNote(task: Pick<Doc<"agentTasks">, "status" | "time">) {
  if (task.status === "done") {
    return "already done";
  }

  if (task.status === "cancelled") {
    return "cancelled";
  }

  if (!task.time) {
    return "needs a real time slot";
  }

  return "pending task";
}

function findConflictMap(items: PlannerItem[]) {
  const conflictMap = new Map<string, string[]>();
  const timedPendingItems = items.filter(
    (item) => item.scheduledTime && item.status === "pending",
  );

  for (let index = 0; index < timedPendingItems.length; index += 1) {
    const current = timedPendingItems[index];
    const currentMinutes = timeToMinutes(current.scheduledTime!);

    for (let nextIndex = index + 1; nextIndex < timedPendingItems.length; nextIndex += 1) {
      const next = timedPendingItems[nextIndex];
      const nextMinutes = timeToMinutes(next.scheduledTime!);

      if (nextMinutes - currentMinutes > 60) {
        break;
      }

      const currentConflicts = conflictMap.get(current.itemId) ?? [];
      currentConflicts.push(next.title);
      conflictMap.set(current.itemId, currentConflicts);

      const nextConflicts = conflictMap.get(next.itemId) ?? [];
      nextConflicts.push(current.title);
      conflictMap.set(next.itemId, nextConflicts);
    }
  }

  return conflictMap;
}

function applyConflictHints(items: PlannerItem[]) {
  const conflictMap = findConflictMap(items);

  return items.map((item) => ({
    ...item,
    conflictWith: conflictMap.get(item.itemId) ?? [],
  }));
}

function buildConflictReason(item: PlannerItem) {
  if (item.conflictWith.length === 0) {
    return null;
  }

  return `conflicts with ${item.conflictWith[0]}`;
}

function buildSuggestionTime(time: string | null, offsetMinutes: number) {
  if (!time) {
    return null;
  }

  return minutesToTime(timeToMinutes(time) + offsetMinutes);
}

function rankRiskScore(args: {
  item: PlannerItem;
  today: string;
  tomorrow: string;
}) {
  let score = 0;

  if (args.item.itemDate === args.today) {
    score += 4;
  } else if (args.item.itemDate === args.tomorrow) {
    score += 3;
  }

  if (args.item.status === "pending") {
    score += 2;
  }

  if (
    args.item.riskNote.includes("slipping") ||
    args.item.riskNote.includes("ignored") ||
    args.item.riskNote.includes("resistance")
  ) {
    score += 2;
  }

  if (args.item.conflictWith.length > 0) {
    score += 2;
  }

  if (args.item.itemType === "task" && !args.item.scheduledTime) {
    score += 1;
  }

  return score;
}

async function loadPlannerState(
  ctx: QueryCtx,
  userId: Id<"users">,
) {
  const user = await ctx.db.get(userId);
  if (!user) {
    throw new Error("User not found");
  }

  const [
    activeHabits,
    allCheckIns,
    allReminders,
    allSkips,
    allReminderRuns,
    allTasks,
  ] = await Promise.all([
    ctx.db
      .query("habits")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect(),
    ctx.db
      .query("checkIns")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .collect(),
    ctx.db
      .query("reminders")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect(),
    ctx.db
      .query("habitSkips")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .collect(),
    ctx.db
      .query("reminderRuns")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .collect(),
    ctx.db
      .query("agentTasks")
      .withIndex("by_user_date", (q) => q.eq("userId", userId))
      .collect(),
  ]);

  return {
    user,
    timezone: getTimezone(user),
    habits: (activeHabits as Doc<"habits">[]).filter((habit) => habit.isActive),
    checkIns: allCheckIns as Doc<"checkIns">[],
    reminders: allReminders as Doc<"reminders">[],
    skips: allSkips as Doc<"habitSkips">[],
    reminderRuns: allReminderRuns as Doc<"reminderRuns">[],
    tasks: (allTasks as Doc<"agentTasks">[]).sort(compareTasksDesc),
  };
}

function buildPlanForDate(args: {
  state: Awaited<ReturnType<typeof loadPlannerState>>;
  date: string;
  now: number;
}) {
  const planDate = new Date(`${args.date}T12:00:00.000Z`);
  const dayKey = getDayKey(planDate, args.state.timezone);
  const date7dStart = shiftDateKey(args.date, -6);
  const todayDate = getDateKey(new Date(args.now), args.state.timezone);
  const checkInsForDate = args.state.checkIns.filter((entry) => entry.date === args.date);
  const remindersForDate = args.state.reminders.filter((entry) => entry.date === args.date);
  const skipsForDate = args.state.skips.filter((entry) => entry.date === args.date);
  const reminderRunsForDate = args.state.reminderRuns.filter(
    (entry) => entry.date === args.date,
  );

  const habitItems = args.state.habits
    .map((habit) => {
      const schedule = getScheduleForDay(habit, dayKey);
      const checkIn =
        checkInsForDate.find((entry) => entry.habitId === habit._id) ?? null;
      const skip =
        skipsForDate.find((entry) => entry.habitId === habit._id) ?? null;
      const reminders = remindersForDate.filter(
        (entry) => entry.habitId === habit._id,
      );
      const reminderRun =
        reminderRunsForDate.find((entry) => entry.habitId === habit._id) ?? null;
      const recentHabitCheckIns = args.state.checkIns
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
      const baseRiskNote = buildRiskNote({
        currentStreak: habit.currentStreak,
        missedLast7d,
        completedLast7d,
        skipExists: Boolean(skip),
        reminderRunState: reminderRun?.state ?? null,
      });

      let status: PlannerItemStatus = "pending";
      if (skip) {
        status = "skipped";
      } else if (checkIn?.status) {
        status = checkIn.status;
      } else if (reminderRun?.state === "rescheduled") {
        status = "rescheduled";
      } else if (reminderRun?.state === "missed") {
        status = "missed";
      } else if (reminderRun?.state === "completed") {
        status = "completed";
      }

      const item = {
        itemType: "habit" as const,
        itemId: habit._id,
        title: habit.name,
        scheduledTime: schedule.scheduledTime,
        status,
        riskNote:
          isToday && reminders.some((entry) => !entry.sent)
            ? `${baseRiskNote}; reminder still pending`
            : baseRiskNote,
        conflictWith: [],
        itemDate: args.date,
        skipped: Boolean(skip),
        skipReason: skip?.reason ?? null,
        checkInStatus: checkIn?.status ?? null,
        reminderState: reminderRun?.state ?? null,
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
      };

      return {
        item,
        isRelevant: isHabitRelevantForDate({
          habit,
          dayKey,
          checkIn,
          skip,
          reminderRun,
          reminders,
        }),
      };
    });
  const filteredHabitItems = habitItems
    .filter((entry) => entry.isRelevant)
    .map((entry) => entry.item);

  const taskItems = args.state.tasks
    .filter((task) => task.date === args.date)
    .map((task) => ({
      itemType: "task" as const,
      itemId: task._id,
      title: task.title,
      scheduledTime: task.time ?? null,
      status: task.status as PlannerItemStatus,
      riskNote: getTaskRiskNote(task),
      conflictWith: [],
      itemDate: args.date,
    }));

  const items = applyConflictHints([...filteredHabitItems, ...taskItems]).sort(
    comparePlannerItems,
  );

  return {
    date: args.date,
    dayKey,
    items: items.map((item) => {
      const conflictReason = buildConflictReason(item);
      return {
        ...item,
        riskNote: conflictReason ?? item.riskNote,
      };
    }),
  };
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

export const createTask = internalMutation({
  args: {
    userId: v.id("users"),
    title: v.string(),
    date: v.string(),
    time: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const normalizedTitle = args.title.trim();
    if (!normalizedTitle) {
      throw new Error("Task title is required");
    }

    const existing = (await ctx.db
      .query("agentTasks")
      .withIndex("by_user_date_status", (q) =>
        q.eq("userId", args.userId).eq("date", args.date).eq("status", "pending"),
      )
      .collect()) as Doc<"agentTasks">[];

    const duplicate =
      existing.find(
        (task) =>
          task.title.toLowerCase() === normalizedTitle.toLowerCase() &&
          (task.time ?? null) === (args.time ?? null),
      ) ?? null;

    if (duplicate) {
      return {
        status: "no_op" as const,
        taskId: duplicate._id,
        title: duplicate.title,
        date: duplicate.date,
        time: duplicate.time ?? null,
      };
    }

    const taskId = await ctx.db.insert("agentTasks", {
      userId: args.userId,
      title: normalizedTitle,
      date: args.date,
      time: args.time,
      status: "pending",
      source: "chat",
      createdAt: args.now,
      updatedAt: args.now,
    });

    return {
      status: "executed" as const,
      taskId,
      title: normalizedTitle,
      date: args.date,
      time: args.time ?? null,
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
    const state = await loadPlannerState(ctx, args.userId);
    return buildPlanForDate({ state, date: args.date, now: args.now });
  },
});

export const getRiskScan = internalQuery({
  args: {
    userId: v.id("users"),
    date: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const state = await loadPlannerState(ctx, args.userId);
    const today = args.date;
    const tomorrow = shiftDateKey(args.date, 1);
    const riskItems: RiskScanItem[] = [];

    for (let offset = 0; offset < 7; offset += 1) {
      const date = shiftDateKey(args.date, offset);
      const plan = buildPlanForDate({ state, date, now: args.now });

      for (const item of plan.items) {
        if (item.status !== "pending" && item.status !== "rescheduled") {
          continue;
        }

        const score = rankRiskScore({
          item,
          today,
          tomorrow,
        });
        const reason = item.conflictWith.length
          ? `bentrok sama ${item.conflictWith[0]}`
          : item.riskNote;
        const suggestion =
          item.itemType === "task"
            ? item.scheduledTime
              ? `Kunci slot ini dan jangan numpuk item lain di sekitar ${item.scheduledTime}.`
              : "Kasih jam yang jelas biar ga tenggelam."
            : item.scheduledTime
              ? `Siapkan ruang buat ${item.title} sekitar ${item.scheduledTime}.`
              : "Kasih slot yang jelas buat habit ini.";

        riskItems.push({
          itemType: item.itemType,
          title: item.title,
          date,
          scheduledTime: item.scheduledTime,
          reason,
          suggestion,
          score,
        });
      }
    }

    return {
      startDate: args.date,
      items: riskItems
        .sort((left, right) => {
          if (right.score !== left.score) {
            return right.score - left.score;
          }
          if (left.date !== right.date) {
            return left.date.localeCompare(right.date);
          }
          return (left.scheduledTime ?? "99:99").localeCompare(
            right.scheduledTime ?? "99:99",
          );
        })
        .slice(0, 3),
    };
  },
});

export const getSimpleRescheduleSuggestions = internalQuery({
  args: {
    userId: v.id("users"),
    date: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const state = await loadPlannerState(ctx, args.userId);
    const plan = buildPlanForDate({ state, date: args.date, now: args.now });
    const suggestions: RescheduleSuggestionItem[] = [];

    const taskConflicts = plan.items.filter(
      (item) =>
        item.itemType === "task" &&
        item.status === "pending" &&
        item.conflictWith.length > 0,
    );

    for (const item of taskConflicts) {
      suggestions.push({
        title: item.title,
        currentTime: item.scheduledTime,
        suggestedTime: buildSuggestionTime(item.scheduledTime, 60),
        reason: `bentrok sama ${item.conflictWith[0]}`,
      });
    }

    if (suggestions.length === 0) {
      const untimedTask = plan.items.find(
        (item) =>
          item.itemType === "task" &&
          item.status === "pending" &&
          !item.scheduledTime,
      );

      if (untimedTask) {
        suggestions.push({
          title: untimedTask.title,
          currentTime: null,
          suggestedTime: "09:00",
          reason: "belum punya slot yang jelas",
        });
      }
    }

    if (suggestions.length === 0) {
      const riskHabit = plan.items.find(
        (item) =>
          item.itemType === "habit" &&
          item.status === "pending" &&
          (item.riskNote.includes("slipping") ||
            item.riskNote.includes("ignored") ||
            item.riskNote.includes("resistance")),
      );

      if (riskHabit) {
        suggestions.push({
          title: riskHabit.title,
          currentTime: riskHabit.scheduledTime,
          suggestedTime: buildSuggestionTime(riskHabit.scheduledTime, -60),
          reason: riskHabit.riskNote,
        });
      }
    }

    return {
      date: args.date,
      items: suggestions.slice(0, 3),
    };
  },
});
