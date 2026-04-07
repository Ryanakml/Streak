import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { internal } from "./_generated/api";

export const AGENT_EPISODE_TYPES = [
  "miss_with_reason",
  "completed_with_effort",
  "hesitation_detected",
  "schedule_changed",
  "habit_skipped",
  "reminder_ignored",
  "user_acknowledged",
  "recovered_after_prompt",
] as const;

export type AgentEpisodeType = (typeof AGENT_EPISODE_TYPES)[number];

type MemorySnapshot = {
  globalSummary: string | null;
  habitSummary: string | null;
  relevantEpisodes: Array<{
    type: string;
    summary: string;
    date: string;
    habitId: Id<"habits"> | null;
  }>;
};

function getTimezone(user: { timezone?: string }) {
  return user.timezone ?? "UTC";
}

function getDateKey(date: Date, timezone: string) {
  return formatInTimeZone(date, timezone, "yyyy-MM-dd");
}

function shiftDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function compareUpdatedDesc<T extends { updatedAt: number }>(left: T, right: T) {
  return right.updatedAt - left.updatedAt;
}

function compareEpisodeDesc(left: Doc<"agentEpisodes">, right: Doc<"agentEpisodes">) {
  if (left.date !== right.date) {
    return right.date.localeCompare(left.date);
  }
  return right.createdAt - left.createdAt;
}

function compareCheckInsDesc(left: Doc<"checkIns">, right: Doc<"checkIns">) {
  if (left.date !== right.date) {
    return right.date.localeCompare(left.date);
  }
  return right.timestamp - left.timestamp;
}

function repeatedReason(checkIns: Doc<"checkIns">[]) {
  const counts = new Map<string, number>();
  for (const checkIn of checkIns) {
    const reason = checkIn.userReason?.trim();
    if (!reason) continue;
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }

  const [reason, count] =
    [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];

  return reason && count >= 2 ? reason : null;
}

function buildGlobalMemorySummary(args: {
  habits: Doc<"habits">[];
  episodes: Doc<"agentEpisodes">[];
  checkIns: Doc<"checkIns">[];
  skips: Doc<"habitSkips">[];
}) {
  const recentMisses = args.checkIns.filter((entry) => entry.status === "missed");
  const topReason = repeatedReason(recentMisses);
  const skippedCount = args.skips.length;
  const recoveredCount = args.episodes.filter(
    (entry) => entry.type === "recovered_after_prompt",
  ).length;
  const slippingHabits = args.habits.filter((habit) => habit.currentStreak === 0).length;

  const signals: string[] = [];

  if (topReason) {
    signals.push(`Recent misses often come with the same reason: ${topReason}.`);
  }
  if (recoveredCount > 0) {
    signals.push(`There are recent recoveries after prompts, so follow-up can still work.`);
  }
  if (skippedCount > 0) {
    signals.push(`Planned skips happened recently, so distinguish intentional skip from failure.`);
  }
  if (slippingHabits > 0) {
    signals.push(`${slippingHabits} active habit is currently fragile or off-streak.`);
  }

  if (signals.length === 0) {
    return {
      summary: "No strong persistent pattern yet. Use structured state first, memory as secondary support.",
      confidence: 0.45,
    };
  }

  return {
    summary: signals.slice(0, 2).join(" "),
    confidence: Math.min(0.9, 0.55 + signals.length * 0.1),
  };
}

function buildHabitMemorySummary(args: {
  habit: Doc<"habits">;
  episodes: Doc<"agentEpisodes">[];
  checkIns: Doc<"checkIns">[];
  skips: Doc<"habitSkips">[];
}) {
  const recentMisses = args.checkIns.filter((entry) => entry.status === "missed");
  const recentCompletions = args.checkIns.filter(
    (entry) => entry.status === "completed",
  );
  const topReason = repeatedReason(recentMisses);
  const signals: string[] = [];

  if (args.habit.currentStreak >= 3) {
    signals.push(`Momentum is currently stable with a ${args.habit.currentStreak}-day streak.`);
  }

  if (recentMisses.length >= 2) {
    signals.push(`This habit has missed ${recentMisses.length} times in the recent window.`);
  }

  if (topReason) {
    signals.push(`Misses often come with the reason: ${topReason}.`);
  }

  if (args.episodes.some((entry) => entry.type === "recovered_after_prompt")) {
    signals.push(`This habit can recover after a direct prompt or reminder.`);
  }

  if (args.skips.length > 0) {
    signals.push(`Recent planned skips exist, so skip vs miss matters for this habit.`);
  }

  if (
    signals.length === 0 &&
    recentCompletions.length > 0 &&
    recentMisses.length === 0
  ) {
    signals.push("Recent execution is clean with no obvious warning pattern.");
  }

  return {
    summary: signals.slice(0, 2).join(" ") || "No stable habit-specific memory yet.",
    confidence: signals.length === 0 ? 0.4 : Math.min(0.9, 0.55 + signals.length * 0.1),
  };
}

export function selectRelevantEpisodes(args: {
  episodes: Doc<"agentEpisodes">[];
  habitId?: Id<"habits"> | null;
  limit?: number;
}) {
  const limit = args.limit ?? 3;
  const sameHabit = args.habitId
    ? args.episodes.filter((entry) => entry.habitId === args.habitId)
    : [];
  const global = args.episodes.filter((entry) => !entry.habitId);
  const mixed = [...sameHabit, ...global].sort(compareEpisodeDesc);
  return mixed.slice(0, limit).map((entry) => ({
    type: entry.type,
    summary: entry.summary,
    date: entry.date,
    habitId: entry.habitId ?? null,
  }));
}

export function selectMemorySnapshot(args: {
  memories: Doc<"agentMemory">[];
  episodes: Doc<"agentEpisodes">[];
  habitId?: Id<"habits"> | null;
}) : MemorySnapshot {
  const globalSummary =
    args.memories
      .filter((entry) => entry.scope === "global")
      .sort(compareUpdatedDesc)[0]?.summary ?? null;
  const habitSummary =
    (args.habitId
      ? args.memories
          .filter(
            (entry) => entry.scope === "habit" && entry.habitId === args.habitId,
          )
          .sort(compareUpdatedDesc)[0]?.summary
      : null) ?? null;

  return {
    globalSummary,
    habitSummary,
    relevantEpisodes: selectRelevantEpisodes({
      episodes: args.episodes,
      habitId: args.habitId,
      limit: 3,
    }),
  };
}

export function pickMemorySignal(snapshot: MemorySnapshot) {
  return (
    snapshot.habitSummary ||
    snapshot.relevantEpisodes[0]?.summary ||
    snapshot.globalSummary ||
    null
  );
}

export const recordEpisode = internalMutation({
  args: {
    userId: v.id("users"),
    habitId: v.optional(v.id("habits")),
    date: v.string(),
    type: v.string(),
    summary: v.string(),
    metadata: v.any(),
    sourceMessageId: v.optional(v.id("messages")),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentEpisodes")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", args.userId).eq("date", args.date),
      )
      .collect();

    const duplicate = existing.find(
      (entry) =>
        entry.type === args.type &&
        entry.habitId === args.habitId &&
        entry.sourceMessageId === args.sourceMessageId &&
        entry.summary === args.summary,
    );

    if (duplicate) {
      return duplicate._id;
    }

    return await ctx.db.insert("agentEpisodes", args);
  },
});

export const upsertMemory = internalMutation({
  args: {
    userId: v.id("users"),
    scope: v.union(v.literal("global"), v.literal("habit")),
    habitId: v.optional(v.id("habits")),
    summary: v.string(),
    confidence: v.number(),
    updatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const candidates = await ctx.db
      .query("agentMemory")
      .withIndex("by_user_scope", (q) =>
        q.eq("userId", args.userId).eq("scope", args.scope),
      )
      .collect();

    const existing =
      candidates.find((entry) => entry.habitId === args.habitId) ?? null;

    if (existing) {
      await ctx.db.patch(existing._id, {
        summary: args.summary,
        confidence: args.confidence,
        updatedAt: args.updatedAt,
      });
      return existing._id;
    }

    return await ctx.db.insert("agentMemory", args);
  },
});

export const getDailySummaryCandidates = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const users = await ctx.db.query("users").collect();
    const memories = await ctx.db.query("agentMemory").collect();

    return users
      .filter((user) => {
        if (user.aiDisabled) {
          return false;
        }

        const timezone = getTimezone(user);
        const localNow = toZonedTime(args.now, timezone);
        if (localNow.getHours() !== 2) {
          return false;
        }
        const today = getDateKey(localNow, timezone);
        const latestGlobal = memories
          .filter((entry) => entry.userId === user._id && entry.scope === "global")
          .sort(compareUpdatedDesc)[0];
        if (!latestGlobal) {
          return true;
        }
        return getDateKey(new Date(latestGlobal.updatedAt), timezone) !== today;
      })
      .map((user) => user._id);
  },
});

export const getDailySummaryContext = internalQuery({
  args: { userId: v.id("users"), now: v.number() },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const timezone = getTimezone(user);
    const today = getDateKey(new Date(args.now), timezone);
    const startDate = shiftDateKey(today, -13);
    const habits = (await ctx.db
      .query("habits")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect()) as Doc<"habits">[];
    const activeHabits = habits.filter((habit) => habit.isActive);
    const episodes = (await ctx.db
      .query("agentEpisodes")
      .withIndex("by_user_date", (q) => q.eq("userId", args.userId))
      .collect()) as Doc<"agentEpisodes">[];
    const recentEpisodes = episodes.filter(
      (entry) => entry.date >= startDate && entry.date <= today,
    );
    const checkIns = (await ctx.db
      .query("checkIns")
      .withIndex("by_user_date", (q) => q.eq("userId", args.userId))
      .collect()) as Doc<"checkIns">[];
    const recentCheckIns = checkIns.filter(
      (entry) => entry.date >= startDate && entry.date <= today,
    );
    const skips = (await ctx.db
      .query("habitSkips")
      .withIndex("by_user_date", (q) => q.eq("userId", args.userId))
      .collect()) as Doc<"habitSkips">[];
    const recentSkips = skips.filter(
      (entry) => entry.date >= startDate && entry.date <= today,
    );

    return {
      user,
      today,
      activeHabits,
      recentEpisodes,
      recentCheckIns,
      recentSkips,
    };
  },
});

export const refreshUserSummaries = internalAction({
  args: {
    userId: v.id("users"),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const context = (await ctx.runQuery(
      internal.agentMemory.getDailySummaryContext,
      {
        userId: args.userId,
        now,
      },
    )) as {
      user: Doc<"users">;
      today: string;
      activeHabits: Doc<"habits">[];
      recentEpisodes: Doc<"agentEpisodes">[];
      recentCheckIns: Doc<"checkIns">[];
      recentSkips: Doc<"habitSkips">[];
    };

    if (context.user.aiDisabled) {
      return {
        userId: args.userId,
        habitsProcessed: 0,
      };
    }

    const globalSummary = buildGlobalMemorySummary({
      habits: context.activeHabits,
      episodes: context.recentEpisodes,
      checkIns: context.recentCheckIns,
      skips: context.recentSkips,
    });
    await ctx.runMutation(internal.agentMemory.upsertMemory, {
      userId: args.userId,
      scope: "global",
      summary: globalSummary.summary,
      confidence: globalSummary.confidence,
      updatedAt: now,
    });

    for (const habit of context.activeHabits) {
      const habitSummary = buildHabitMemorySummary({
        habit,
        episodes: context.recentEpisodes.filter(
          (entry) => entry.habitId === habit._id,
        ),
        checkIns: context.recentCheckIns
          .filter((entry) => entry.habitId === habit._id)
          .sort(compareCheckInsDesc)
          .slice(0, 10),
        skips: context.recentSkips.filter((entry) => entry.habitId === habit._id),
      });

      await ctx.runMutation(internal.agentMemory.upsertMemory, {
        userId: args.userId,
        scope: "habit",
        habitId: habit._id,
        summary: habitSummary.summary,
        confidence: habitSummary.confidence,
        updatedAt: now,
      });
    }

    return {
      userId: args.userId,
      habitsProcessed: context.activeHabits.length,
    };
  },
});

export const processDailySummaries = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const candidates = (await ctx.runQuery(
      internal.agentMemory.getDailySummaryCandidates,
      {
        now,
      },
    )) as Id<"users">[];

    for (const userId of candidates) {
      await ctx.runAction(internal.agentMemory.refreshUserSummaries, {
        userId,
        now,
      });
    }

    return { processedUsers: candidates.length };
  },
});
