import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { formatInTimeZone } from "date-fns-tz";
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
  return user;
}

function getDateKey(date: Date, timezone: string) {
  return formatInTimeZone(date, timezone, "yyyy-MM-dd");
}

export const listByUser = query({
  args: { userId: v.id("users"), includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await requireOwnedUser(ctx, args.userId);
    const habits = await ctx.db
      .query("habits")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    if (args.includeInactive) return habits;
    return habits.filter((habit) => habit.isActive);
  },
});

export const get = query({
  args: { id: v.id("habits") },
  handler: async (ctx, args) => {
    const habit = await ctx.db.get(args.id);
    if (!habit) return null;
    await requireOwnedUser(ctx, habit.userId);
    return habit;
  },
});

export const create = mutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    targetDays: v.array(v.string()),
    scheduledTime: v.string(),
    reminderTime: v.string(),
    checkInDeadline: v.string(),
    schedules: v.optional(
      v.object({
        fri: v.optional(
          v.object({
            scheduledTime: v.string(),
            reminderTime: v.string(),
            checkInDeadline: v.string(),
          }),
        ),
      }),
    ),
    rules: v.string(),
    motivation: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnedUser(ctx, args.userId);
    const now = Date.now();
    const habitId = await ctx.db.insert("habits", {
      ...args,
      currentStreak: 0,
      bestStreak: 0,
      isActive: true,
      createdAt: now,
      scheduleUpdatedAt: now,
    });

    await ctx.scheduler.runAfter(0, internal.reminders.refreshForHabit, {
      habitId,
    });

    return habitId;
  },
});

export const update = mutation({
  args: {
    id: v.id("habits"),
    name: v.optional(v.string()),
    targetDays: v.optional(v.array(v.string())),
    scheduledTime: v.optional(v.string()),
    reminderTime: v.optional(v.string()),
    checkInDeadline: v.optional(v.string()),
    schedules: v.optional(
      v.object({
        fri: v.optional(
          v.object({
            scheduledTime: v.string(),
            reminderTime: v.string(),
            checkInDeadline: v.string(),
          }),
        ),
      }),
    ),
    rules: v.optional(v.string()),
    motivation: v.optional(v.string()),
    currentStreak: v.optional(v.number()),
    bestStreak: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const habit = await ctx.db.get(args.id);
    if (!habit) throw new Error("Habit not found");
    const owner = await requireOwnedUser(ctx, habit.userId);

    const scheduleFieldsChanged =
      args.targetDays !== undefined ||
      args.scheduledTime !== undefined ||
      args.reminderTime !== undefined ||
      args.checkInDeadline !== undefined ||
      args.schedules !== undefined;

    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      if (key !== "id" && value !== undefined) patch[key] = value;
    }
    if (scheduleFieldsChanged) {
      patch.scheduleUpdatedAt = Date.now();
    }

    await ctx.db.patch(args.id, patch);
    const nextHabit = await ctx.db.get(args.id);

    if (scheduleFieldsChanged) {
      const today = getDateKey(new Date(), owner.timezone ?? "UTC");
      const relatedEpisodes = await ctx.db
        .query("agentEpisodes")
        .withIndex("by_user_habit_date", (q) =>
          q.eq("userId", owner._id).eq("habitId", args.id),
        )
        .collect();

      for (const episode of relatedEpisodes) {
        if (episode.type !== "schedule_changed") {
          continue;
        }
        const metadata =
          episode.metadata && typeof episode.metadata === "object"
            ? (episode.metadata as Record<string, unknown>)
            : null;
        const targetDate =
          metadata && typeof metadata.targetDate === "string"
            ? metadata.targetDate
            : null;
        if (targetDate && targetDate >= today) {
          await ctx.db.delete(episode._id);
        }
      }

      await ctx.scheduler.runAfter(0, internal.reminders.refreshForHabit, {
        habitId: args.id,
      });
    }

    return nextHabit;
  },
});

export const remove = mutation({
  args: { id: v.id("habits") },
  handler: async (ctx, args) => {
    const habit = await ctx.db.get(args.id);
    if (!habit) throw new Error("Habit not found");
    await requireOwnedUser(ctx, habit.userId);
    await ctx.scheduler.runAfter(0, internal.reminders.clearForHabit, {
      habitId: args.id,
    });
    await ctx.db.delete(args.id);
    return args.id;
  },
});
