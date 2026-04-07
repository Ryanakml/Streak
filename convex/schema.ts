import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    email: v.string(),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    timezone: v.optional(v.string()),
    aiPersonality: v.literal("brutal"),
    subscriptionTier: v.union(v.literal("free"), v.literal("pro")),
    onboardingCompleted: v.boolean(),
    dailyMessageCount: v.number(),
    lastMessageReset: v.number(),
  }).index("by_clerk_id", ["clerkId"]),

  habits: defineTable({
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
    currentStreak: v.number(),
    bestStreak: v.number(),
    isActive: v.boolean(),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  checkIns: defineTable({
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
    timestamp: v.number(),
  })
    .index("by_habit", ["habitId"])
    .index("by_user_date", ["userId", "date"]),

  workoutLogs: defineTable({
    habitId: v.id("habits"),
    checkInId: v.id("checkIns"),
    exercises: v.array(
      v.object({
        name: v.string(),
        sets: v.optional(v.number()),
        reps: v.optional(v.number()),
        weight: v.optional(v.number()),
        duration: v.optional(v.number()),
        distance: v.optional(v.number()),
      }),
    ),
    notes: v.optional(v.string()),
  }).index("by_habit", ["habitId"]),

  messages: defineTable({
    userId: v.id("users"),
    habitId: v.optional(v.id("habits")),
    role: v.union(v.literal("user"), v.literal("ai")),
    content: v.string(),
    intent: v.optional(v.string()),
    timestamp: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_habit", ["habitId"]),

  reminders: defineTable({
    habitId: v.id("habits"),
    userId: v.id("users"),
    date: v.string(),
    scheduledFor: v.number(),
    type: v.union(
      v.literal("pre_workout"),
      v.literal("check_in"),
      v.literal("late_follow_up"),
    ),
    sent: v.boolean(),
  })
    .index("by_user", ["userId"])
    .index("by_habit", ["habitId", "sent"])
    .index("by_scheduled", ["sent", "scheduledFor"]),

  pushSubscriptions: defineTable({
    userId: v.id("users"),
    endpoint: v.string(),
    expirationTime: v.optional(v.number()),
    keys: v.object({
      auth: v.string(),
      p256dh: v.string(),
    }),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_endpoint", ["endpoint"]),

  weeklyReports: defineTable({
    userId: v.id("users"),
    habitId: v.id("habits"),
    weekStart: v.string(),
    weekEnd: v.string(),
    targetCount: v.number(),
    actualCount: v.number(),
    bonusCount: v.number(),
    completionRate: v.number(),
    aiRoast: v.string(),
    missedDaysReasons: v.array(
      v.object({
        day: v.string(),
        reason: v.string(),
      }),
    ),
  })
    .index("by_user", ["userId"])
    .index("by_user_habit_week", ["userId", "habitId", "weekStart"]),

  agentActionLogs: defineTable({
    userId: v.id("users"),
    messageId: v.optional(v.id("messages")),
    intent: v.string(),
    actionType: v.string(),
    targetType: v.string(),
    targetId: v.optional(v.string()),
    status: v.union(
      v.literal("executed"),
      v.literal("clarification_requested"),
      v.literal("cancelled"),
      v.literal("no_op"),
      v.literal("failed"),
    ),
    inputSummary: v.string(),
    resultSummary: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  habitSkips: defineTable({
    userId: v.id("users"),
    habitId: v.id("habits"),
    date: v.string(),
    reason: v.optional(v.string()),
    createdBy: v.union(v.literal("agent"), v.literal("user")),
    createdAt: v.number(),
  })
    .index("by_user_date", ["userId", "date"])
    .index("by_habit_date", ["habitId", "date"]),

  agentPendingActions: defineTable({
    userId: v.id("users"),
    messageId: v.optional(v.id("messages")),
    intent: v.string(),
    actionType: v.string(),
    targetHabitId: v.optional(v.id("habits")),
    payload: v.any(),
    missingFields: v.array(v.string()),
    clarificationQuestion: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  agentEpisodes: defineTable({
    userId: v.id("users"),
    habitId: v.optional(v.id("habits")),
    date: v.string(),
    type: v.string(),
    summary: v.string(),
    metadata: v.any(),
    sourceMessageId: v.optional(v.id("messages")),
    createdAt: v.number(),
  })
    .index("by_user_date", ["userId", "date"])
    .index("by_user_habit_date", ["userId", "habitId", "date"]),

  agentMemory: defineTable({
    userId: v.id("users"),
    scope: v.union(v.literal("global"), v.literal("habit")),
    habitId: v.optional(v.id("habits")),
    summary: v.string(),
    confidence: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_scope", ["userId", "scope"])
    .index("by_user_habit_scope", ["userId", "habitId", "scope"]),
});
