import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";

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

export const listByHabit = query({
  args: { habitId: v.id("habits") },
  handler: async (ctx, args) => {
    const habit = await ctx.db.get(args.habitId);
    if (!habit) return [];
    await requireOwnedUser(ctx, habit.userId);

    return await ctx.db
      .query("checkIns")
      .withIndex("by_habit", (q) => q.eq("habitId", args.habitId))
      .collect();
  },
});

export const getRecent = query({
  args: { habitId: v.id("habits"), limit: v.number() },
  handler: async (ctx, args) => {
    const habit = await ctx.db.get(args.habitId);
    if (!habit) return [];
    await requireOwnedUser(ctx, habit.userId);

    const checkIns = await ctx.db
      .query("checkIns")
      .withIndex("by_habit", (q) => q.eq("habitId", args.habitId))
      .order("desc")
      .take(args.limit);

    return checkIns;
  },
});

export const listByUserDate = query({
  args: { userId: v.id("users"), date: v.string() },
  handler: async (ctx, args) => {
    await requireOwnedUser(ctx, args.userId);
    return await ctx.db
      .query("checkIns")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", args.userId).eq("date", args.date),
      )
      .collect();
  },
});

export const listByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireOwnedUser(ctx, args.userId);
    return await ctx.db
      .query("checkIns")
      .withIndex("by_user_date", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const create = mutation({
  args: {
    habitId: v.id("habits"),
    userId: v.id("users"),
    date: v.string(),
    status: v.union(
      v.literal("completed"),
      v.literal("missed"),
      v.literal("bonus"),
    ),
    source: v.union(
      v.literal("dashboard_quick"),
      v.literal("chat"),
      v.literal("auto_deadline"),
    ),
    userReason: v.optional(v.string()),
    conversationSummary: v.optional(v.string()),
    aiResponse: v.string(),
    timestamp: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnedUser(ctx, args.userId);
    return await ctx.db.insert("checkIns", {
      ...args,
      timestamp: args.timestamp ?? Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("checkIns"),
    status: v.optional(
      v.union(v.literal("completed"), v.literal("missed"), v.literal("bonus")),
    ),
    source: v.optional(
      v.union(
        v.literal("dashboard_quick"),
        v.literal("chat"),
        v.literal("auto_deadline"),
      ),
    ),
    userReason: v.optional(v.string()),
    conversationSummary: v.optional(v.string()),
    aiResponse: v.optional(v.string()),
    timestamp: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const checkIn = await ctx.db.get(args.id);
    if (!checkIn) throw new Error("Check-in not found");
    await requireOwnedUser(ctx, checkIn.userId);

    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (key !== "id" && value !== undefined) patch[key] = value;
    }

    await ctx.db.patch(args.id, patch);
    return await ctx.db.get(args.id);
  },
});

export const remove = mutation({
  args: { id: v.id("checkIns") },
  handler: async (ctx, args) => {
    const checkIn = await ctx.db.get(args.id);
    if (!checkIn) throw new Error("Check-in not found");
    await requireOwnedUser(ctx, checkIn.userId);
    await ctx.db.delete(args.id);
    return args.id;
  },
});
