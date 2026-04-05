import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";

const missedReasonValidator = v.object({
  day: v.string(),
  reason: v.string(),
});

type AuthCtx = QueryCtx | MutationCtx;

async function requireIdentity(ctx: AuthCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");
  return identity;
}

async function requireOwnedUser(ctx: AuthCtx, userId: Id<"users">) {
  const identity = await requireIdentity(ctx);
  const user = await ctx.db.get(userId);
  if (!user || user.clerkId !== identity.subject) {
    throw new Error("Unauthorized");
  }
}

function getTimezone(user: { timezone?: string }) {
  return user.timezone ?? "UTC";
}

function getPreviousWeekWindow(now: number, timezone: string) {
  const zonedNow = toZonedTime(now, timezone);
  const day = zonedNow.getDay();
  const diffToMonday = (day + 6) % 7;
  const currentWeekMonday = new Date(zonedNow);
  currentWeekMonday.setDate(zonedNow.getDate() - diffToMonday);
  currentWeekMonday.setHours(0, 0, 0, 0);

  const previousWeekMonday = new Date(currentWeekMonday);
  previousWeekMonday.setDate(currentWeekMonday.getDate() - 7);

  const previousWeekSunday = new Date(previousWeekMonday);
  previousWeekSunday.setDate(previousWeekMonday.getDate() + 6);
  previousWeekSunday.setHours(23, 59, 59, 999);

  return {
    weekStart: formatInTimeZone(previousWeekMonday, timezone, "yyyy-MM-dd"),
    weekEnd: formatInTimeZone(previousWeekSunday, timezone, "yyyy-MM-dd"),
    dayKeys: Array.from({ length: 7 }, (_, index) => {
      const next = new Date(previousWeekMonday);
      next.setDate(previousWeekMonday.getDate() + index);
      return {
        dateKey: formatInTimeZone(next, timezone, "yyyy-MM-dd"),
        day: formatInTimeZone(next, timezone, "EEE").toLowerCase().slice(0, 3),
      };
    }),
  };
}

export const listByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireOwnedUser(ctx, args.userId);
    return await ctx.db
      .query("weeklyReports")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const latestByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireOwnedUser(ctx, args.userId);
    const reports = await ctx.db
      .query("weeklyReports")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    return reports.sort((left, right) =>
      right.weekStart.localeCompare(left.weekStart),
    );
  },
});

export const create = mutation({
  args: {
    userId: v.id("users"),
    habitId: v.id("habits"),
    weekStart: v.string(),
    weekEnd: v.string(),
    targetCount: v.number(),
    actualCount: v.number(),
    bonusCount: v.number(),
    completionRate: v.number(),
    aiRoast: v.string(),
    missedDaysReasons: v.array(missedReasonValidator),
  },
  handler: async (ctx, args) => {
    await requireOwnedUser(ctx, args.userId);
    return await ctx.db.insert("weeklyReports", args);
  },
});

export const remove = mutation({
  args: { id: v.id("weeklyReports") },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.id);
    if (!report) throw new Error("Weekly report not found");
    await requireOwnedUser(ctx, report.userId);
    await ctx.db.delete(args.id);
    return args.id;
  },
});

export const getGenerationCandidates = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const users = await ctx.db.query("users").collect();
    const candidates = [];

    for (const user of users) {
      const timezone = getTimezone(user);
      const zonedNow = toZonedTime(args.now, timezone);
      const isSunday = zonedNow.getDay() === 0;
      const isNinePm = zonedNow.getHours() === 21 && zonedNow.getMinutes() < 5;
      if (!isSunday || !isNinePm) {
        continue;
      }

      const habits = await ctx.db
        .query("habits")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();

      const activeHabits = habits.filter((habit) => habit.isActive);
      if (activeHabits.length === 0) {
        continue;
      }

      const window = getPreviousWeekWindow(args.now, timezone);
      candidates.push({
        userId: user._id,
        weekStart: window.weekStart,
      });
    }

    return candidates;
  },
});

export const getGenerationContext = internalQuery({
  args: {
    userId: v.id("users"),
    weekStart: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const timezone = getTimezone(user);
    const window = getPreviousWeekWindow(args.now, timezone);
    const habits = await ctx.db
      .query("habits")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    const activeHabits = habits.filter((habit) => habit.isActive);
    const allCheckIns = await ctx.db
      .query("checkIns")
      .withIndex("by_user_date", (q) => q.eq("userId", args.userId))
      .collect();
    const weeklyCheckIns = allCheckIns.filter(
      (entry) => entry.date >= window.weekStart && entry.date <= window.weekEnd,
    );

    const workoutLogs = await Promise.all(
      activeHabits.map((habit) =>
        ctx.db
          .query("workoutLogs")
          .withIndex("by_habit", (q) => q.eq("habitId", habit._id))
          .collect(),
      ),
    );

    return {
      user,
      timezone,
      weekStart: window.weekStart,
      weekEnd: window.weekEnd,
      dayKeys: window.dayKeys,
      habits: activeHabits,
      weeklyCheckIns,
      workoutLogs: workoutLogs.flat(),
    };
  },
});

export const upsertGeneratedReport = internalMutation({
  args: {
    userId: v.id("users"),
    habitId: v.id("habits"),
    weekStart: v.string(),
    weekEnd: v.string(),
    targetCount: v.number(),
    actualCount: v.number(),
    bonusCount: v.number(),
    completionRate: v.number(),
    aiRoast: v.string(),
    missedDaysReasons: v.array(missedReasonValidator),
    chatContent: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("weeklyReports")
      .withIndex("by_user_habit_week", (q) =>
        q
          .eq("userId", args.userId)
          .eq("habitId", args.habitId)
          .eq("weekStart", args.weekStart),
      )
      .unique();

    let reportId = existing?._id;
    let chatMessageId = null;
    const wasCreated = !existing;
    if (existing) {
      await ctx.db.patch(existing._id, {
        weekEnd: args.weekEnd,
        targetCount: args.targetCount,
        actualCount: args.actualCount,
        bonusCount: args.bonusCount,
        completionRate: args.completionRate,
        aiRoast: args.aiRoast,
        missedDaysReasons: args.missedDaysReasons,
      });
    } else {
      reportId = await ctx.db.insert("weeklyReports", {
        userId: args.userId,
        habitId: args.habitId,
        weekStart: args.weekStart,
        weekEnd: args.weekEnd,
        targetCount: args.targetCount,
        actualCount: args.actualCount,
        bonusCount: args.bonusCount,
        completionRate: args.completionRate,
        aiRoast: args.aiRoast,
        missedDaysReasons: args.missedDaysReasons,
      });
      chatMessageId = await ctx.db.insert("messages", {
        userId: args.userId,
        habitId: args.habitId,
        role: "ai",
        content: args.chatContent,
        intent: "weekly_review",
        timestamp: Date.now(),
      });
    }

    return { reportId, chatMessageId, wasCreated };
  },
});
