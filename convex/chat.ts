import { formatInTimeZone } from "date-fns-tz";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";

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

function getTodayKey(date: Date, timezone: string) {
  return formatInTimeZone(date, timezone, "EEE").toLowerCase().slice(0, 3);
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
    const date = getDateKey(new Date(args.now), timezone);
    const todayCheckIns = await ctx.db
      .query("checkIns")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", user._id).eq("date", date),
      )
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

    const today = new Date(args.now);
    const todayKey = getTodayKey(today, timezone);
    const todayHabit =
      activeHabits.find((habit) => habit.targetDays.includes(todayKey)) ?? null;
    const latestMessage = recentMessagesDesc[0] ?? null;

    return {
      user,
      date,
      activeHabits,
      todayHabit,
      todayCheckIns,
      recentMessages: [...recentMessagesDesc].reverse(),
      recentCheckIns,
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
