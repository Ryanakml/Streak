import { formatInTimeZone } from "date-fns-tz";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";

const FREE_DAILY_MESSAGE_CAP = 20;

async function requireIdentity(ctx: MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");
  return identity;
}

async function upsertUser(
  ctx: MutationCtx,
  args: {
    clerkId: string;
    email: string;
    firstName?: string;
    lastName?: string;
    timezone?: string;
    aiPersonality?: "brutal";
    aiDisabled?: boolean;
    subscriptionTier?: "free" | "pro";
    onboardingCompleted?: boolean;
    dailyMessageCount?: number;
    lastMessageReset?: number;
  },
) {
  const existing = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
    .unique();

  if (existing) {
    await ctx.db.patch(existing._id, {
      clerkId: args.clerkId,
      email: args.email,
      firstName: args.firstName ?? existing.firstName,
      lastName: args.lastName ?? existing.lastName,
      timezone: args.timezone ?? existing.timezone,
      aiPersonality: args.aiPersonality ?? existing.aiPersonality,
      aiDisabled: args.aiDisabled ?? existing.aiDisabled ?? false,
      subscriptionTier: args.subscriptionTier ?? existing.subscriptionTier,
      onboardingCompleted:
        args.onboardingCompleted ?? existing.onboardingCompleted,
      dailyMessageCount: args.dailyMessageCount ?? existing.dailyMessageCount,
      lastMessageReset: args.lastMessageReset ?? existing.lastMessageReset,
    });
    return existing._id;
  }

  return await ctx.db.insert("users", {
    clerkId: args.clerkId,
    email: args.email,
    firstName: args.firstName,
    lastName: args.lastName,
    timezone: args.timezone,
    aiPersonality: args.aiPersonality ?? "brutal",
    aiDisabled: args.aiDisabled ?? false,
    subscriptionTier: args.subscriptionTier ?? "free",
    onboardingCompleted: args.onboardingCompleted ?? false,
    dailyMessageCount: args.dailyMessageCount ?? 0,
    lastMessageReset: args.lastMessageReset ?? Date.now(),
  });
}

function getTimezone(user: { timezone?: string }) {
  return user.timezone ?? "UTC";
}

function getLocalDateKey(timestamp: number, timezone: string) {
  return formatInTimeZone(timestamp, timezone, "yyyy-MM-dd");
}

function getNormalizedBudgetState(
  user: {
    timezone?: string;
    dailyMessageCount: number;
    lastMessageReset: number;
    subscriptionTier: "free" | "pro";
  },
  now: number,
) {
  const timezone = getTimezone(user);
  const isSameLocalDay =
    getLocalDateKey(user.lastMessageReset, timezone) ===
    getLocalDateKey(now, timezone);
  const dailyMessageCount = isSameLocalDay ? user.dailyMessageCount : 0;
  const isUnlimited = user.subscriptionTier === "pro";
  const remainingMessages = isUnlimited
    ? null
    : Math.max(0, FREE_DAILY_MESSAGE_CAP - dailyMessageCount);

  return {
    timezone,
    isSameLocalDay,
    dailyMessageCount,
    dailyMessageCap: isUnlimited ? null : FREE_DAILY_MESSAGE_CAP,
    remainingMessages,
    limitReached: !isUnlimited && dailyMessageCount >= FREE_DAILY_MESSAGE_CAP,
    isUnlimited,
  };
}

function toBudgetStatus(
  user: {
    timezone?: string;
    dailyMessageCount: number;
    lastMessageReset: number;
    subscriptionTier: "free" | "pro";
  },
  now: number,
) {
  const normalized = getNormalizedBudgetState(user, now);
  return {
    dailyMessageCount: normalized.dailyMessageCount,
    dailyMessageCap: normalized.dailyMessageCap,
    remainingMessages: normalized.remainingMessages,
    limitReached: normalized.limitReached,
    isUnlimited: normalized.isUnlimited,
    timezone: normalized.timezone,
    subscriptionTier: user.subscriptionTier,
    lastMessageReset: user.lastMessageReset,
  };
}

export const getCurrent = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    return await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
  },
});

export const getMessageBudgetStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (!user) {
      return null;
    }

    return toBudgetStatus(user, Date.now());
  },
});

export const getByClerkId = query({
  args: { clerkId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    return await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();
  },
});

export const syncUser = mutation({
  args: {
    clerkId: v.string(),
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    timezone: v.optional(v.string()),
    aiPersonality: v.optional(v.literal("brutal")),
    aiDisabled: v.optional(v.boolean()),
    subscriptionTier: v.optional(v.union(v.literal("free"), v.literal("pro"))),
    onboardingCompleted: v.optional(v.boolean()),
    dailyMessageCount: v.optional(v.number()),
    lastMessageReset: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    if (identity.subject !== args.clerkId) {
      throw new Error("Unauthorized");
    }
    return await upsertUser(ctx, args);
  },
});

export const updateProfile = mutation({
  args: {
    userId: v.id("users"),
    aiPersonality: v.optional(v.literal("brutal")),
    aiDisabled: v.optional(v.boolean()),
    subscriptionTier: v.optional(v.union(v.literal("free"), v.literal("pro"))),
    onboardingCompleted: v.optional(v.boolean()),
    dailyMessageCount: v.optional(v.number()),
    lastMessageReset: v.optional(v.number()),
    timezone: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const user = await ctx.db.get(args.userId);
    if (!user || user.clerkId !== identity.subject) {
      throw new Error("Unauthorized");
    }

    await ctx.db.patch(args.userId, {
      aiPersonality: args.aiPersonality ?? user.aiPersonality,
      aiDisabled: args.aiDisabled ?? user.aiDisabled ?? false,
      subscriptionTier: args.subscriptionTier ?? user.subscriptionTier,
      onboardingCompleted: args.onboardingCompleted ?? user.onboardingCompleted,
      dailyMessageCount: args.dailyMessageCount ?? user.dailyMessageCount,
      lastMessageReset: args.lastMessageReset ?? user.lastMessageReset,
      timezone: args.timezone ?? user.timezone,
      firstName: args.firstName ?? user.firstName,
      lastName: args.lastName ?? user.lastName,
      email: args.email ?? user.email,
    });

    return await ctx.db.get(args.userId);
  },
});

export const refreshDailyMessageBudget = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();

    if (!user) {
      throw new Error("User not found");
    }

    const now = Date.now();
    const normalized = getNormalizedBudgetState(user, now);

    if (!normalized.isSameLocalDay) {
      await ctx.db.patch(user._id, {
        dailyMessageCount: 0,
        lastMessageReset: now,
      });

      const nextUser = await ctx.db.get(user._id);
      if (!nextUser) {
        throw new Error("User not found");
      }

      return toBudgetStatus(nextUser, now);
    }

    return toBudgetStatus(user, now);
  },
});

export const consumeDailyMessageBudget = internalMutation({
  args: {
    userId: v.id("users"),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const normalized = getNormalizedBudgetState(user, args.now);

    if (normalized.isUnlimited) {
      return {
        consumed: true,
        ...toBudgetStatus(user, args.now),
      };
    }

    if (normalized.limitReached) {
      if (!normalized.isSameLocalDay) {
        await ctx.db.patch(user._id, {
          dailyMessageCount: 0,
          lastMessageReset: args.now,
        });
      }

      const nextUser = await ctx.db.get(user._id);
      if (!nextUser) {
        throw new Error("User not found");
      }

      return {
        consumed: false,
        ...toBudgetStatus(nextUser, args.now),
      };
    }

    const nextCount = normalized.dailyMessageCount + 1;
    await ctx.db.patch(user._id, {
      dailyMessageCount: nextCount,
      lastMessageReset: args.now,
    });

    return {
      consumed: true,
      dailyMessageCount: nextCount,
      dailyMessageCap: FREE_DAILY_MESSAGE_CAP,
      remainingMessages: Math.max(0, FREE_DAILY_MESSAGE_CAP - nextCount),
      limitReached: nextCount >= FREE_DAILY_MESSAGE_CAP,
      isUnlimited: false,
      timezone: normalized.timezone,
      subscriptionTier: user.subscriptionTier,
      lastMessageReset: args.now,
    };
  },
});
