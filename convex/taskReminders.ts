import { addMinutes } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";

type AuthCtx = QueryCtx | MutationCtx;

type TaskReminderRewriteContext = {
  taskTitle: string;
  taskDate: string;
  taskTime: string;
  offsetMinutes: number;
  languageHint: "indonesian" | "english";
};

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

function getTimezone(user: Doc<"users">) {
  return user.timezone ?? "UTC";
}

function resolveTaskDueTimestamp(args: {
  date: string;
  time: string;
  timezone: string;
}) {
  return fromZonedTime(`${args.date}T${args.time}:00`, args.timezone).getTime();
}

function normalizeOffsetMinutes(offsetMinutes: number) {
  return Math.max(0, Math.round(offsetMinutes));
}

function looksLikeIndonesian(text: string) {
  const lowered = text.toLowerCase();
  const signals = [
    "beli",
    "telpon",
    "ingat",
    "besok",
    "nanti",
    "jam",
    "bayar",
    "kirim",
    "ambil",
    "urus",
    "bro",
  ];
  return signals.some((signal) => lowered.includes(signal));
}

function getLanguageHint(taskTitle: string) {
  return looksLikeIndonesian(taskTitle) ? "indonesian" : "english";
}

function buildPlaceholder(taskTitle: string) {
  return taskTitle.trim() ? `Oi. ${taskTitle.trim()}.` : "Oi.";
}

export function buildTaskReminderErrorFallback(
  languageHint: "indonesian" | "english",
) {
  return {
    chatContent:
      languageHint === "indonesian"
        ? "Oi. Maaf, ada kendala koneksi bentar pas mau nyusun kata-kata buat pengingatnya. Tapi intinya jangan lupa ya!"
        : "Oi. Sorry, having a quick connection hiccup while crafting your reminder. But essentially, don't forget!",
    pushBody:
      languageHint === "indonesian"
        ? "Jangan lupa tugasnya ya!"
        : "Don't forget your task!",
  };
}

async function getPendingTaskReminderByOffset(
  ctx: MutationCtx,
  args: {
    taskId: Id<"agentTasks">;
    offsetMinutes: number;
  },
) {
  const existing = (await ctx.db
    .query("taskReminders")
    .withIndex("by_task_sent", (q) =>
      q.eq("taskId", args.taskId).eq("sent", false),
    )
    .collect()) as Doc<"taskReminders">[];

  return (
    existing.find((entry) => entry.offsetMinutes === args.offsetMinutes) ?? null
  );
}

export const listByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireOwnedUser(ctx, args.userId);
    return await ctx.db
      .query("taskReminders")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const scheduleReminderForTask = internalMutation({
  args: {
    taskId: v.id("agentTasks"),
    userId: v.id("users"),
    offsetMinutes: v.number(),
    source: v.union(
      v.literal("default"),
      v.literal("chat"),
      v.literal("manual"),
    ),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.userId !== args.userId) {
      throw new Error("Task not found");
    }

    if (task.status !== "pending" || !task.time) {
      return {
        status: "no_op" as const,
        reminderId: null,
        scheduledFor: null,
      };
    }

    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const safeOffsetMinutes = normalizeOffsetMinutes(args.offsetMinutes);
    const scheduledFor = addMinutes(
      resolveTaskDueTimestamp({
        date: task.date,
        time: task.time,
        timezone: getTimezone(user),
      }),
      -safeOffsetMinutes,
    ).getTime();

    const existing = await getPendingTaskReminderByOffset(ctx, {
      taskId: task._id,
      offsetMinutes: safeOffsetMinutes,
    });

    if (existing) {
      if (
        existing.scheduledFor === scheduledFor &&
        existing.source === args.source
      ) {
        return {
          status: "no_op" as const,
          reminderId: existing._id,
          scheduledFor,
        };
      }

      await ctx.db.patch(existing._id, {
        scheduledFor,
        source: args.source,
        updatedAt: args.now,
      });

      return {
        status: "executed" as const,
        reminderId: existing._id,
        scheduledFor,
      };
    }

    const reminderId = await ctx.db.insert("taskReminders", {
      taskId: task._id,
      userId: args.userId,
      offsetMinutes: safeOffsetMinutes,
      scheduledFor,
      sent: false,
      source: args.source,
      createdAt: args.now,
      updatedAt: args.now,
    });

    return {
      status: "executed" as const,
      reminderId,
      scheduledFor,
    };
  },
});

export const shiftPendingRemindersForTask = internalMutation({
  args: {
    taskId: v.id("agentTasks"),
    userId: v.id("users"),
    targetDate: v.string(),
    targetTime: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new Error("User not found");
    }

    const reminders = (await ctx.db
      .query("taskReminders")
      .withIndex("by_task_sent", (q) =>
        q.eq("taskId", args.taskId).eq("sent", false),
      )
      .collect()) as Doc<"taskReminders">[];
    const dueAt = resolveTaskDueTimestamp({
      date: args.targetDate,
      time: args.targetTime,
      timezone: getTimezone(user),
    });

    for (const reminder of reminders) {
      await ctx.db.patch(reminder._id, {
        scheduledFor: addMinutes(dueAt, -reminder.offsetMinutes).getTime(),
        updatedAt: args.now,
      });
    }

    return reminders.length;
  },
});

export const clearPendingForTask = internalMutation({
  args: { taskId: v.id("agentTasks") },
  handler: async (ctx, args) => {
    const reminders = (await ctx.db
      .query("taskReminders")
      .withIndex("by_task_sent", (q) =>
        q.eq("taskId", args.taskId).eq("sent", false),
      )
      .collect()) as Doc<"taskReminders">[];

    for (const reminder of reminders) {
      await ctx.db.delete(reminder._id);
    }

    return reminders.length;
  },
});

export const deleteTaskIfDone = internalMutation({
  args: { taskId: v.id("agentTasks") },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task || task.status !== "done") {
      return { deleted: false };
    }

    const reminders = (await ctx.db
      .query("taskReminders")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .collect()) as Doc<"taskReminders">[];

    for (const reminder of reminders) {
      await ctx.db.delete(reminder._id);
    }

    await ctx.db.delete(args.taskId);
    return { deleted: true };
  },
});

export const listDue = internalQuery({
  args: { before: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("taskReminders")
      .withIndex("by_scheduled", (q) =>
        q.eq("sent", false).lte("scheduledFor", args.before),
      )
      .collect();
  },
});

export const processReminder = internalMutation({
  args: { reminderId: v.id("taskReminders") },
  handler: async (ctx, args) => {
    const reminder = await ctx.db.get(args.reminderId);
    if (!reminder || reminder.sent) {
      return null;
    }

    const task = await ctx.db.get(reminder.taskId);
    const user = await ctx.db.get(reminder.userId);
    if (!task || !user || task.status !== "pending" || !task.time) {
      await ctx.db.patch(reminder._id, {
        sent: true,
        updatedAt: Date.now(),
      });
      return null;
    }

    if (user.aiDisabled) {
      await ctx.db.patch(reminder._id, {
        sent: true,
        updatedAt: Date.now(),
      });
      return {
        shouldSendPush: false,
        skipped: true,
      };
    }

    const placeholder = buildPlaceholder(task.title);
    const messageId = await ctx.db.insert("messages", {
      userId: user._id,
      role: "ai",
      content: placeholder,
      intent: "task_reminder",
      timestamp: reminder.scheduledFor,
    });

    await ctx.db.patch(reminder._id, {
      sent: true,
      updatedAt: Date.now(),
    });

    return {
      shouldSendPush: true,
      userId: user._id,
      messageId,
      payload: {
        kind: "task_reminder" as const,
        title: "Task Reminder",
        body: placeholder,
        url: "/dashboard?tab=chat",
        taskId: task._id,
        taskRewriteContext: {
          taskTitle: task.title,
          taskDate: task.date,
          taskTime: task.time,
          offsetMinutes: reminder.offsetMinutes,
          languageHint: getLanguageHint(task.title),
        } satisfies TaskReminderRewriteContext,
      },
    };
  },
});
