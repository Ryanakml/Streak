import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";

const exerciseValidator = v.object({
  name: v.string(),
  sets: v.optional(v.number()),
  reps: v.optional(v.number()),
  weight: v.optional(v.number()),
  duration: v.optional(v.number()),
  distance: v.optional(v.number()),
});

type AuthCtx = QueryCtx | MutationCtx;

async function requireIdentity(ctx: AuthCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");
  return identity;
}

async function requireOwnedHabit(ctx: AuthCtx, habitId: Id<"habits">) {
  const identity = await requireIdentity(ctx);
  const habit = await ctx.db.get(habitId);
  if (!habit) throw new Error("Habit not found");
  const user = await ctx.db.get(habit.userId);
  if (!user || user.clerkId !== identity.subject) {
    throw new Error("Unauthorized");
  }
  return habit;
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
    await requireOwnedHabit(ctx, args.habitId);
    return await ctx.db
      .query("workoutLogs")
      .withIndex("by_habit", (q) => q.eq("habitId", args.habitId))
      .collect();
  },
});

export const listByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireOwnedUser(ctx, args.userId);
    const habits = await ctx.db
      .query("habits")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const logs = await Promise.all(
      habits.map((habit) =>
        ctx.db
          .query("workoutLogs")
          .withIndex("by_habit", (q) => q.eq("habitId", habit._id))
          .collect(),
      ),
    );

    return logs.flat();
  },
});

export const create = mutation({
  args: {
    habitId: v.id("habits"),
    checkInId: v.id("checkIns"),
    exercises: v.array(exerciseValidator),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOwnedHabit(ctx, args.habitId);
    return await ctx.db.insert("workoutLogs", args);
  },
});

export const update = mutation({
  args: {
    id: v.id("workoutLogs"),
    exercises: v.optional(v.array(exerciseValidator)),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const log = await ctx.db.get(args.id);
    if (!log) throw new Error("Workout log not found");
    await requireOwnedHabit(ctx, log.habitId);

    const patch: Record<string, unknown> = {};
    if (args.exercises !== undefined) patch.exercises = args.exercises;
    if (args.notes !== undefined) patch.notes = args.notes;

    await ctx.db.patch(args.id, patch);
    return await ctx.db.get(args.id);
  },
});

export const remove = mutation({
  args: { id: v.id("workoutLogs") },
  handler: async (ctx, args) => {
    const log = await ctx.db.get(args.id);
    if (!log) throw new Error("Workout log not found");
    await requireOwnedHabit(ctx, log.habitId);
    await ctx.db.delete(args.id);
    return args.id;
  },
});
