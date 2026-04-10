import { formatInTimeZone } from "date-fns-tz";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { selectMemorySnapshot } from "./agentMemory";

const exerciseValidator = v.object({
  name: v.string(),
  sets: v.optional(v.number()),
  reps: v.optional(v.number()),
  weight: v.optional(v.number()),
  duration: v.optional(v.number()),
  distance: v.optional(v.number()),
});

function getDateKey(date: Date, timezone: string) {
  return formatInTimeZone(date, timezone, "yyyy-MM-dd");
}

function getTimeKey(date: Date, timezone: string) {
  return formatInTimeZone(date, timezone, "HH:mm");
}

function getLocalDateTimeLabel(date: Date, timezone: string) {
  return formatInTimeZone(date, timezone, "yyyy-MM-dd HH:mm");
}

function getTodayKey(date: Date, timezone: string) {
  return formatInTimeZone(date, timezone, "EEE").toLowerCase().slice(0, 3);
}

function shiftDateKey(date: Date, timezone: string, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return getDateKey(next, timezone);
}

function compareCheckInsDesc(left: Doc<"checkIns">, right: Doc<"checkIns">) {
  if (left.date !== right.date) {
    return right.date.localeCompare(left.date);
  }

  return right.timestamp - left.timestamp;
}

function buildHabitSummary(args: {
  habit: Doc<"habits">;
  allCheckIns: Doc<"checkIns">[];
  date: string;
  date7dStart: string;
  date30dStart: string;
  todayReminders: Doc<"reminders">[];
}) {
  const habitCheckIns = args.allCheckIns.filter(
    (checkIn) => checkIn.habitId === args.habit._id,
  );
  const sortedCheckIns = [...habitCheckIns].sort(compareCheckInsDesc);
  const checkInsLast7d = sortedCheckIns.filter(
    (checkIn) => checkIn.date >= args.date7dStart && checkIn.date <= args.date,
  );
  const checkInsLast30d = sortedCheckIns.filter(
    (checkIn) => checkIn.date >= args.date30dStart && checkIn.date <= args.date,
  );

  const completedLast7d = checkInsLast7d.filter(
    (checkIn) => checkIn.status === "completed",
  ).length;
  const missedLast7d = checkInsLast7d.filter(
    (checkIn) => checkIn.status === "missed",
  ).length;
  const bonusLast7d = checkInsLast7d.filter(
    (checkIn) => checkIn.status === "bonus",
  ).length;
  const completedLast30d = checkInsLast30d.filter(
    (checkIn) => checkIn.status === "completed",
  ).length;
  const missedLast30d = checkInsLast30d.filter(
    (checkIn) => checkIn.status === "missed",
  ).length;
  const bonusLast30d = checkInsLast30d.filter(
    (checkIn) => checkIn.status === "bonus",
  ).length;
  const lastCheckIn = sortedCheckIns[0] ?? null;
  const recentMissReasons = sortedCheckIns
    .filter((checkIn) => checkIn.status === "missed")
    .map(
      (checkIn) =>
        checkIn.userReason?.trim() ||
        checkIn.conversationSummary?.trim() ||
        null,
    )
    .filter((reason): reason is string => Boolean(reason))
    .slice(0, 3);
  const habitTodayReminders = args.todayReminders.filter(
    (reminder) => reminder.habitId === args.habit._id,
  );

  return {
    habitId: args.habit._id,
    habitName: args.habit.name,
    completedLast7d,
    missedLast7d,
    bonusLast7d,
    completionRateLast7d:
      checkInsLast7d.length > 0
        ? Math.round((completedLast7d / checkInsLast7d.length) * 100)
        : 0,
    completedLast30d,
    missedLast30d,
    bonusLast30d,
    completionRateLast30d:
      checkInsLast30d.length > 0
        ? Math.round((completedLast30d / checkInsLast30d.length) * 100)
        : 0,
    currentStreak: args.habit.currentStreak,
    bestStreak: args.habit.bestStreak,
    lastCheckInStatus: lastCheckIn?.status ?? null,
    lastCheckInDate: lastCheckIn?.date ?? null,
    recentMissReasons,
    todayReminderStatus: {
      hasAny: habitTodayReminders.length > 0,
      pendingTypes: habitTodayReminders
        .filter((reminder) => !reminder.sent)
        .map((reminder) => reminder.type),
      sentTypes: habitTodayReminders
        .filter((reminder) => reminder.sent)
        .map((reminder) => reminder.type),
    },
  };
}

export const getChatContext = internalQuery({
  args: {
    clerkId: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();

    if (!user) {
      throw new Error("User not found");
    }

    const habits = await ctx.db
      .query("habits")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    const activeHabits = habits.filter((habit) => habit.isActive);
    const timezone = user.timezone ?? "UTC";
    const now = new Date(args.now);
    const date = getDateKey(now, timezone);
    const nowLocalTime = getTimeKey(now, timezone);
    const date7dStart = shiftDateKey(now, timezone, -6);
    const date30dStart = shiftDateKey(now, timezone, -29);
    const todayCheckIns = await ctx.db
      .query("checkIns")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", user._id).eq("date", date),
      )
      .collect();
    const allCheckIns = await ctx.db
      .query("checkIns")
      .withIndex("by_user_date", (q) => q.eq("userId", user._id))
      .collect();

    const recentMessagesDesc = await ctx.db
      .query("messages")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(12);

    const recentCheckIns = await ctx.db
      .query("checkIns")
      .withIndex("by_user_date", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(12);

    const allReminders = await ctx.db
      .query("reminders")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const todayReminders = allReminders.filter((reminder) => reminder.date === date);
    const recentEpisodes = await ctx.db
      .query("agentEpisodes")
      .withIndex("by_user_date", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(12);
    const memoryRows = await ctx.db
      .query("agentMemory")
      .withIndex("by_user_scope", (q) => q.eq("userId", user._id))
      .collect();

    const today = new Date(args.now);
    const todayKey = getTodayKey(today, timezone);
    const todayHabit =
      activeHabits.find((habit) => habit.targetDays.includes(todayKey)) ?? null;
    const latestMessage = recentMessagesDesc[0] ?? null;
    const habitSummaries = activeHabits.map((habit) =>
      buildHabitSummary({
        habit,
        allCheckIns,
        date,
        date7dStart,
        date30dStart,
        todayReminders,
      }),
    );
    const todayReminderStatus = todayHabit
      ? (habitSummaries.find((summary) => summary.habitId === todayHabit._id)
          ?.todayReminderStatus ?? {
          hasAny: false,
          pendingTypes: [],
          sentTypes: [],
        })
      : null;
    const memorySnapshot = selectMemorySnapshot({
      memories: memoryRows,
      episodes: recentEpisodes,
      habitId: todayHabit?._id ?? (activeHabits.length === 1 ? activeHabits[0]?._id : null),
    });

    return {
      user,
      date,
      timezone,
      nowTs: args.now,
      nowIso: now.toISOString(),
      nowLocalTime,
      nowLocalDateTime: getLocalDateTimeLabel(now, timezone),
      minutesIntoDay:
        Number.parseInt(nowLocalTime.slice(0, 2), 10) * 60 +
        Number.parseInt(nowLocalTime.slice(3, 5), 10),
      todayDayKey: todayKey,
      activeHabits,
      todayHabits: activeHabits.filter((habit) =>
        habit.targetDays.includes(todayKey),
      ),
      todayHabit,
      todayCheckIns,
      recentMessages: [...recentMessagesDesc].reverse(),
      recentCheckIns,
      recentAgentEpisodes: recentEpisodes,
      agentMemories: memoryRows,
      relevantEpisodes: memorySnapshot.relevantEpisodes,
      globalMemorySummary: memorySnapshot.globalSummary,
      habitMemorySummary: memorySnapshot.habitSummary,
      habitSummaries,
      todayReminderStatus,
      pendingClarificationHabitId:
        latestMessage?.role === "ai" &&
        latestMessage.intent === "clarify_workout" &&
        latestMessage.habitId
          ? latestMessage.habitId
          : null,
    };
  },
});

export const storeMessage = internalMutation({
  args: {
    userId: v.id("users"),
    habitId: v.optional(v.id("habits")),
    role: v.union(v.literal("user"), v.literal("ai")),
    content: v.string(),
    intent: v.optional(v.string()),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("messages", args);
  },
});

export const getStoredMessage = internalQuery({
  args: {
    id: v.id("messages"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const updateStoredMessage = internalMutation({
  args: {
    id: v.id("messages"),
    habitId: v.optional(v.id("habits")),
    intent: v.optional(v.string()),
    content: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {};
    if (args.habitId !== undefined) {
      patch.habitId = args.habitId;
    }
    if (args.intent !== undefined) {
      patch.intent = args.intent;
    }
    if (args.content !== undefined) {
      patch.content = args.content;
    }

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.id, patch);
    }
    return await ctx.db.get(args.id);
  },
});

export const updateCheckInAiResponse = internalMutation({
  args: {
    id: v.id("checkIns"),
    aiResponse: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      aiResponse: args.aiResponse,
    });
    return await ctx.db.get(args.id);
  },
});

export const persistChatResult = internalMutation({
  args: {
    userId: v.id("users"),
    habitId: v.optional(v.id("habits")),
    date: v.string(),
    aiContent: v.string(),
    aiIntent: v.string(),
    checkInStatus: v.optional(
      v.union(
        v.literal("completed"),
        v.literal("missed"),
        v.literal("bonus"),
      ),
    ),
    reason: v.optional(v.string()),
    conversationSummary: v.optional(v.string()),
    workout: v.optional(
      v.object({
        exercises: v.array(exerciseValidator),
        notes: v.optional(v.string()),
      }),
    ),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    let checkInCreatedId: Id<"checkIns"> | undefined;
    let workoutLogCreatedId: Id<"workoutLogs"> | undefined;

    if (args.habitId && args.checkInStatus) {
      const existingToday = await ctx.db
        .query("checkIns")
        .withIndex("by_user_date", (q) =>
          q.eq("userId", args.userId).eq("date", args.date),
        )
        .collect();

      const existingForHabit =
        existingToday.find((entry) => entry.habitId === args.habitId) ?? null;

      if (existingForHabit) {
        checkInCreatedId = existingForHabit._id;
      } else {
        checkInCreatedId = await ctx.db.insert("checkIns", {
          habitId: args.habitId,
          userId: args.userId,
          date: args.date,
          status: args.checkInStatus,
          source: "chat",
          userReason: args.reason,
          conversationSummary: args.conversationSummary,
          aiResponse: args.aiContent,
          timestamp: args.timestamp,
        });

        const habit = await ctx.db.get(args.habitId);
        if (habit) {
          if (args.checkInStatus === "completed") {
            const nextStreak = habit.currentStreak + 1;
            await ctx.db.patch(args.habitId, {
              currentStreak: nextStreak,
              bestStreak: Math.max(habit.bestStreak, nextStreak),
            });
          }

          if (args.checkInStatus === "missed") {
            await ctx.db.patch(args.habitId, {
              currentStreak: 0,
            });
          }
        }

        if (
          args.workout &&
          args.workout.exercises.length > 0 &&
          (args.checkInStatus === "completed" || args.checkInStatus === "bonus")
        ) {
          workoutLogCreatedId = await ctx.db.insert("workoutLogs", {
            habitId: args.habitId,
            checkInId: checkInCreatedId,
            exercises: args.workout.exercises,
            notes: args.workout.notes,
          });
        }
      }
    }

    const aiMessageId = await ctx.db.insert("messages", {
      userId: args.userId,
      habitId: args.habitId,
      role: "ai",
      content: args.aiContent,
      intent: args.aiIntent,
      timestamp: args.timestamp,
    });

    return {
      aiMessageId,
      checkInCreatedId,
      workoutLogCreatedId,
    };
  },
});
