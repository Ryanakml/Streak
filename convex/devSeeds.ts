import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";

const PHASE1_SEED_PREFIX = "[Seed P1]";
const PHASE2_SEED_PREFIX = "[Seed P2]";

function dayKeyFromDateKey(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  return date
    .toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })
    .toLowerCase()
    .slice(0, 3);
}

function shiftDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function toTimestamp(dateKey: string, time: string) {
  return new Date(`${dateKey}T${time}:00.000Z`).getTime();
}

async function deleteSeedData(
  ctx: MutationCtx,
  userId: Id<"users">,
  habitIds: Id<"habits">[],
) {
  const reminders = (await ctx.db
    .query("reminders")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect()) as Doc<"reminders">[];
  for (const reminder of reminders.filter((entry) =>
    habitIds.includes(entry.habitId),
  )) {
    await ctx.db.delete(reminder._id);
  }

  const messages = (await ctx.db
    .query("messages")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect()) as Doc<"messages">[];
  for (const message of messages.filter(
    (entry) => entry.habitId && habitIds.includes(entry.habitId),
  )) {
    await ctx.db.delete(message._id);
  }
  const messageIds = messages
    .filter((entry) => entry.habitId && habitIds.includes(entry.habitId))
    .map((entry) => entry._id);

  const checkIns = (await ctx.db
    .query("checkIns")
    .withIndex("by_user_date", (q) => q.eq("userId", userId))
    .collect()) as Doc<"checkIns">[];
  const checkInIds = checkIns
    .filter((entry) => habitIds.includes(entry.habitId))
    .map((entry) => entry._id);

  const workoutLogGroups = (await Promise.all(
    habitIds.map((habitId) =>
      ctx.db
        .query("workoutLogs")
        .withIndex("by_habit", (q) => q.eq("habitId", habitId))
        .collect(),
    ),
  )) as Doc<"workoutLogs">[][];
  const workoutLogs = workoutLogGroups.flat();
  for (const workoutLog of workoutLogs.filter((entry) =>
    checkInIds.includes(entry.checkInId),
  )) {
    await ctx.db.delete(workoutLog._id);
  }

  for (const checkInId of checkInIds) {
    await ctx.db.delete(checkInId);
  }

  const habitSkips = (await ctx.db
    .query("habitSkips")
    .withIndex("by_user_date", (q) => q.eq("userId", userId))
    .collect()) as Doc<"habitSkips">[];
  for (const skip of habitSkips.filter((entry) =>
    habitIds.includes(entry.habitId),
  )) {
    await ctx.db.delete(skip._id);
  }

  const actionLogs = (await ctx.db
    .query("agentActionLogs")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect()) as Doc<"agentActionLogs">[];
  for (const log of actionLogs.filter(
    (entry) =>
      (entry.targetId && habitIds.map(String).includes(entry.targetId)) ||
      (entry.messageId && messageIds.includes(entry.messageId)),
  )) {
    await ctx.db.delete(log._id);
  }

  const pendingActions = (await ctx.db
    .query("agentPendingActions")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect()) as Doc<"agentPendingActions">[];
  for (const pendingAction of pendingActions.filter(
    (entry) =>
      (entry.targetHabitId && habitIds.includes(entry.targetHabitId)) ||
      (entry.messageId && messageIds.includes(entry.messageId)),
  )) {
    await ctx.db.delete(pendingAction._id);
  }

  for (const habitId of habitIds) {
    await ctx.db.delete(habitId);
  }
}

async function findUserFromArgs(
  ctx: MutationCtx,
  args: { email?: string; clerkId?: string },
) {
  const users = (await ctx.db.query("users").collect()) as Doc<"users">[];
  return (
    users.find((entry) => args.clerkId && entry.clerkId === args.clerkId) ??
    users.find((entry) => args.email && entry.email === args.email) ??
    null
  );
}

export const seedPhase1Verification = mutation({
  args: {
    email: v.optional(v.string()),
    clerkId: v.optional(v.string()),
    today: v.string(),
    resetExisting: v.optional(v.boolean()),
    createDueReminders: v.optional(v.boolean()),
    confirmation: v.literal("phase1-verification"),
  },
  handler: async (ctx, args) => {
    const user = await findUserFromArgs(ctx, args);

    if (!user) {
      throw new Error("Seed target user not found");
    }

    const existingSeedHabits = (await ctx.db
      .query("habits")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()) as Doc<"habits">[];
    const seedHabits = existingSeedHabits.filter((habit) =>
      habit.name.startsWith(PHASE1_SEED_PREFIX),
    );

    if (args.resetExisting !== false && seedHabits.length > 0) {
      await deleteSeedData(
        ctx,
        user._id,
        seedHabits.map((habit) => habit._id),
      );
    }

    const now = Date.now();
    const readHabitId = await ctx.db.insert("habits", {
      userId: user._id,
      name: `${PHASE1_SEED_PREFIX} Read Book`,
      targetDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      scheduledTime: "19:00",
      reminderTime: "18:45",
      checkInDeadline: "22:00",
      rules: "Read 10 pages minimum.",
      motivation: "Build a daily reading streak.",
      currentStreak: 6,
      bestStreak: 8,
      isActive: true,
      createdAt: now,
    });

    const gymHabitId = await ctx.db.insert("habits", {
      userId: user._id,
      name: `${PHASE1_SEED_PREFIX} Gym`,
      targetDays: ["mon", "wed", "fri", "sat"],
      scheduledTime: "19:05",
      reminderTime: "18:40",
      checkInDeadline: "21:30",
      rules: "Lift or cardio for at least 30 minutes.",
      motivation: "Stop being weak.",
      currentStreak: 0,
      bestStreak: 3,
      isActive: true,
      createdAt: now,
    });

    const readSeedDates = Array.from({ length: 6 }, (_, index) =>
      shiftDateKey(args.today, -(index + 1)),
    ).reverse();
    for (const date of readSeedDates) {
      await ctx.db.insert("checkIns", {
        habitId: readHabitId,
        userId: user._id,
        date,
        status: "completed",
        source: "chat",
        userReason: undefined,
        conversationSummary: "Seeded phase 1 streak completion",
        aiResponse: "Seed completion",
        timestamp: toTimestamp(date, "19:10"),
      });
    }

    const gymCompletedDate = shiftDateKey(args.today, -6);
    await ctx.db.insert("checkIns", {
      habitId: gymHabitId,
      userId: user._id,
      date: gymCompletedDate,
      status: "completed",
      source: "chat",
      conversationSummary: "Seeded phase 1 gym completion",
      aiResponse: "Seed completion",
      timestamp: toTimestamp(gymCompletedDate, "19:40"),
    });

    const gymMissDateA = shiftDateKey(args.today, -3);
    await ctx.db.insert("checkIns", {
      habitId: gymHabitId,
      userId: user._id,
      date: gymMissDateA,
      status: "missed",
      source: "chat",
      userReason: "capek pulang kerja",
      conversationSummary: "Seeded phase 1 gym miss",
      aiResponse: "Seed miss",
      timestamp: toTimestamp(gymMissDateA, "21:35"),
    });

    const gymMissDateB = shiftDateKey(args.today, -1);
    await ctx.db.insert("checkIns", {
      habitId: gymHabitId,
      userId: user._id,
      date: gymMissDateB,
      status: "missed",
      source: "chat",
      userReason: "hujan/malas berangkat",
      conversationSummary: "Seeded phase 1 repeated gym miss",
      aiResponse: "Seed miss",
      timestamp: toTimestamp(gymMissDateB, "21:35"),
    });

    const createdReminders: Array<{
      id: Id<"reminders">;
      habitName: string;
      type: "pre_workout" | "check_in" | "late_follow_up";
      date: string;
    }> = [];

    if (args.createDueReminders !== false) {
      const remindersToCreate = [
        {
          habitId: readHabitId,
          habitName: `${PHASE1_SEED_PREFIX} Read Book`,
          type: "pre_workout" as const,
          scheduledFor: now - 4 * 60 * 1000,
        },
        {
          habitId: readHabitId,
          habitName: `${PHASE1_SEED_PREFIX} Read Book`,
          type: "check_in" as const,
          scheduledFor: now - 3 * 60 * 1000,
        },
        {
          habitId: gymHabitId,
          habitName: `${PHASE1_SEED_PREFIX} Gym`,
          type: "pre_workout" as const,
          scheduledFor: now - 2 * 60 * 1000,
        },
        {
          habitId: gymHabitId,
          habitName: `${PHASE1_SEED_PREFIX} Gym`,
          type: "late_follow_up" as const,
          scheduledFor: now - 1 * 60 * 1000,
        },
      ];

      for (const reminder of remindersToCreate) {
        const reminderId = await ctx.db.insert("reminders", {
          habitId: reminder.habitId,
          userId: user._id,
          date: args.today,
          scheduledFor: reminder.scheduledFor,
          type: reminder.type,
          sent: false,
        });
        createdReminders.push({
          id: reminderId,
          habitName: reminder.habitName,
          type: reminder.type,
          date: args.today,
        });
      }
    }

    return {
      userId: user._id,
      userEmail: user.email,
      today: args.today,
      habits: [
        {
          id: readHabitId,
          name: `${PHASE1_SEED_PREFIX} Read Book`,
          expectedDayKeyToday: dayKeyFromDateKey(args.today),
          currentStreak: 6,
          summary: "High-streak / on-track contrast habit",
        },
        {
          id: gymHabitId,
          name: `${PHASE1_SEED_PREFIX} Gym`,
          expectedDayKeyToday: dayKeyFromDateKey(args.today),
          currentStreak: 0,
          summary: "Frequent-miss / hesitation contrast habit",
        },
      ],
      reminders: createdReminders,
      suggestedChatCases: [
        `Progress ${PHASE1_SEED_PREFIX} Read Book gue minggu ini gimana?`,
        `Gue kayaknya skip ${PHASE1_SEED_PREFIX} Gym lagi hari ini.`,
        `Gue udah 10 hari streak ${PHASE1_SEED_PREFIX} Read Book kan?`,
      ],
    };
  },
});

export const seedPhase2Verification = mutation({
  args: {
    email: v.optional(v.string()),
    clerkId: v.optional(v.string()),
    today: v.string(),
    resetExisting: v.optional(v.boolean()),
    confirmation: v.literal("phase2-verification"),
  },
  handler: async (ctx, args) => {
    const user = await findUserFromArgs(ctx, args);

    if (!user) {
      throw new Error("Seed target user not found");
    }

    const existingHabits = (await ctx.db
      .query("habits")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect()) as Doc<"habits">[];
    const seedHabits = existingHabits.filter((habit) =>
      habit.name.startsWith(PHASE2_SEED_PREFIX),
    );

    if (args.resetExisting !== false && seedHabits.length > 0) {
      await deleteSeedData(
        ctx,
        user._id,
        seedHabits.map((habit) => habit._id),
      );
    }

    const now = Date.now();
    const tomorrow = shiftDateKey(args.today, 1);

    const readHabitId = await ctx.db.insert("habits", {
      userId: user._id,
      name: `${PHASE2_SEED_PREFIX} Read Book`,
      targetDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      scheduledTime: "07:00",
      reminderTime: "06:30",
      checkInDeadline: "09:30",
      rules: "Read 10 pages minimum.",
      motivation: "Keep the streak clean.",
      currentStreak: 5,
      bestStreak: 7,
      isActive: true,
      createdAt: now,
    });

    const gymHabitId = await ctx.db.insert("habits", {
      userId: user._id,
      name: `${PHASE2_SEED_PREFIX} Gym`,
      targetDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      scheduledTime: "07:30",
      reminderTime: "07:00",
      checkInDeadline: "10:30",
      schedules: {
        fri: {
          scheduledTime: "07:30",
          reminderTime: "07:00",
          checkInDeadline: "10:30",
        },
      },
      rules: "Lift or cardio for at least 30 minutes.",
      motivation: "Stop negotiating with yourself.",
      currentStreak: 1,
      bestStreak: 4,
      isActive: true,
      createdAt: now,
    });

    const readDates = [
      shiftDateKey(args.today, -5),
      shiftDateKey(args.today, -4),
      shiftDateKey(args.today, -3),
      shiftDateKey(args.today, -2),
      shiftDateKey(args.today, -1),
    ];
    for (const date of readDates) {
      await ctx.db.insert("checkIns", {
        habitId: readHabitId,
        userId: user._id,
        date,
        status: "completed",
        source: "chat",
        conversationSummary: "Seeded phase 2 reading completion",
        aiResponse: "Seed completion",
        timestamp: toTimestamp(date, "20:10"),
      });
    }

    const gymCompleteDate = shiftDateKey(args.today, -5);
    await ctx.db.insert("checkIns", {
      habitId: gymHabitId,
      userId: user._id,
      date: gymCompleteDate,
      status: "completed",
      source: "chat",
      conversationSummary: "Seeded phase 2 gym completion",
      aiResponse: "Seed completion",
      timestamp: toTimestamp(gymCompleteDate, "18:45"),
    });

    const gymMissDate = shiftDateKey(args.today, -2);
    await ctx.db.insert("checkIns", {
      habitId: gymHabitId,
      userId: user._id,
      date: gymMissDate,
      status: "missed",
      source: "chat",
      userReason: "capek pulang kerja",
      conversationSummary: "Seeded phase 2 gym miss",
      aiResponse: "Seed miss",
      timestamp: toTimestamp(gymMissDate, "21:10"),
    });

    const seededReminders: Array<{
      id: Id<"reminders">;
      habitName: string;
      type: "pre_workout" | "check_in";
      date: string;
      sent: boolean;
    }> = [];

    for (const reminder of [
      {
        habitId: readHabitId,
        habitName: `${PHASE2_SEED_PREFIX} Read Book`,
        date: args.today,
        scheduledFor: now + 60 * 60 * 1000,
        type: "pre_workout" as const,
        sent: true,
      },
      {
        habitId: gymHabitId,
        habitName: `${PHASE2_SEED_PREFIX} Gym`,
        date: args.today,
        scheduledFor: now + 90 * 60 * 1000,
        type: "pre_workout" as const,
        sent: false,
      },
      {
        habitId: gymHabitId,
        habitName: `${PHASE2_SEED_PREFIX} Gym`,
        date: tomorrow,
        scheduledFor: now + 26 * 60 * 60 * 1000,
        type: "pre_workout" as const,
        sent: false,
      },
    ]) {
      const reminderId = await ctx.db.insert("reminders", {
        habitId: reminder.habitId,
        userId: user._id,
        date: reminder.date,
        scheduledFor: reminder.scheduledFor,
        type: reminder.type,
        sent: reminder.sent,
      });
      seededReminders.push({
        id: reminderId,
        habitName: reminder.habitName,
        type: reminder.type,
        date: reminder.date,
        sent: reminder.sent,
      });
    }

    return {
      userId: user._id,
      userEmail: user.email,
      today: args.today,
      tomorrow,
      habits: [
        {
          id: readHabitId,
          name: `${PHASE2_SEED_PREFIX} Read Book`,
          purpose: "planner contrast + ambiguity guard",
        },
        {
          id: gymHabitId,
          name: `${PHASE2_SEED_PREFIX} Gym`,
          purpose: "reschedule + skip + risk-note target",
          fridayOverride: "07:30 / 07:00 / 10:30",
        },
      ],
      reminders: seededReminders,
      suggestedChatCases: [
        `hari ini gue ngapain aja?`,
        `besok gue ngapain aja?`,
        `geser ${PHASE2_SEED_PREFIX} Gym`,
        `besok jam 7 malam`,
        `skip ${PHASE2_SEED_PREFIX} Gym besok`,
        `skip besok`,
        `hari ini gue udah beres ${PHASE2_SEED_PREFIX} Gym`,
      ],
    };
  },
});
