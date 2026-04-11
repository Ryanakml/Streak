import { internal } from "./_generated/api";
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

export const listByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireOwnedUser(ctx, args.userId);
    return await ctx.db
      .query("agentTasks")
      .withIndex("by_user_date", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const create = mutation({
  args: {
    userId: v.id("users"),
    title: v.string(),
    date: v.string(),
    time: v.string(),
    reminderOffsetMinutes: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    status: "executed" | "no_op";
    taskId: Id<"agentTasks">;
    title: string;
    date: string;
    time: string | null;
  }> => {
    await requireOwnedUser(ctx, args.userId);
    return await ctx.runMutation(internal.agentActions.createTask, {
      userId: args.userId,
      title: args.title,
      date: args.date,
      time: args.time,
      source: "manual",
      reminderOffsetMinutes: args.reminderOffsetMinutes ?? 30,
      now: Date.now(),
    });
  },
});

export const markDone = mutation({
  args: { taskId: v.id("agentTasks") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    status: "executed" | "no_op";
    taskId: Id<"agentTasks">;
    title: string;
    doneAt: number | null;
  }> => {
    const task = await ctx.db.get(args.taskId);
    if (!task) {
      throw new Error("Task not found");
    }

    await requireOwnedUser(ctx, task.userId);
    return await ctx.runMutation(internal.agentActions.markTaskDone, {
      userId: task.userId,
      taskId: task._id,
      now: Date.now(),
    });
  },
});
