import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

async function requireIdentity(ctx: any) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");
  return identity;
}

async function requireOwnedUser(ctx: any, userId: any) {
  const identity = await requireIdentity(ctx);
  const user = await ctx.db.get(userId);
  if (!user || user.clerkId !== identity.subject) {
    throw new Error("Unauthorized");
  }
}

export const listByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireOwnedUser(ctx, args.userId);
    return await ctx.db
      .query("messages")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const listByHabit = query({
  args: { habitId: v.id("habits") },
  handler: async (ctx, args) => {
    const habit = await ctx.db.get(args.habitId);
    if (!habit) return [];
    await requireOwnedUser(ctx, habit.userId);
    return await ctx.db
      .query("messages")
      .withIndex("by_habit", (q) => q.eq("habitId", args.habitId))
      .collect();
  },
});

export const create = mutation({
  args: {
    userId: v.id("users"),
    habitId: v.optional(v.id("habits")),
    role: v.union(v.literal("user"), v.literal("ai")),
    content: v.string(),
    intent: v.optional(v.string()),
    timestamp: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnedUser(ctx, args.userId);
    return await ctx.db.insert("messages", {
      ...args,
      timestamp: args.timestamp ?? Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("messages") },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.id);
    if (!message) throw new Error("Message not found");
    await requireOwnedUser(ctx, message.userId);
    await ctx.db.delete(args.id);
    return args.id;
  },
});
