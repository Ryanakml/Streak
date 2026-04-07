import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type AuthCtx = QueryCtx | MutationCtx;

async function requireIdentity(ctx: AuthCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Unauthorized");
  }
  return identity;
}

async function getCurrentUser(ctx: AuthCtx) {
  const identity = await requireIdentity(ctx);
  const user = await ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
    .unique();

  if (!user) {
    throw new Error("User not found");
  }

  return user;
}

export const logModelRun = internalMutation({
  args: {
    userId: v.id("users"),
    habitId: v.optional(v.id("habits")),
    userMessageId: v.optional(v.id("messages")),
    aiMessageId: v.optional(v.id("messages")),
    userMessageContent: v.optional(v.string()),
    aiMessageContent: v.optional(v.string()),
    source: v.union(
      v.literal("chat"),
      v.literal("weekly_review"),
      v.literal("reminder"),
      v.literal("system"),
    ),
    purpose: v.string(),
    finalProvider: v.string(),
    finalModel: v.string(),
    fallbackDepth: v.number(),
    attempts: v.array(
      v.object({
        provider: v.string(),
        model: v.string(),
        attemptOrder: v.number(),
        status: v.union(v.literal("success"), v.literal("failed")),
        errorSummary: v.optional(v.string()),
      }),
    ),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentModelRuns", args);
  },
});

export const listRecentByUser = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("agentModelRuns")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(Math.min(Math.max(args.limit ?? 20, 1), 100));

    return rows;
  },
});

export const listMyRecent = query({
  args: {
    limit: v.optional(v.number()),
    source: v.optional(
      v.union(
        v.literal("chat"),
        v.literal("weekly_review"),
        v.literal("reminder"),
        v.literal("system"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const rows = await ctx.db
      .query("agentModelRuns")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(Math.min(Math.max(args.limit ?? 20, 1), 100));

    if (!args.source) {
      return rows;
    }

    return rows.filter((row) => row.source === args.source);
  },
});

export const listMyRecentExpanded = query({
  args: {
    limit: v.optional(v.number()),
    source: v.optional(
      v.union(
        v.literal("chat"),
        v.literal("weekly_review"),
        v.literal("reminder"),
        v.literal("system"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const rows = await ctx.db
      .query("agentModelRuns")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(Math.min(Math.max(args.limit ?? 20, 1), 100));

    const filtered = args.source
      ? rows.filter((row) => row.source === args.source)
      : rows;

    return await Promise.all(
      filtered.map(async (row) => {
        const legacyMessageId = row.userMessageId ?? row.messageId;
        const [userMessage, aiMessage] = await Promise.all([
          legacyMessageId ? ctx.db.get(legacyMessageId) : Promise.resolve(null),
          row.aiMessageId ? ctx.db.get(row.aiMessageId) : Promise.resolve(null),
        ]);

        return {
          ...row,
          userMessage: userMessage
            ? {
                id: userMessage._id,
                role: userMessage.role,
                intent: userMessage.intent ?? null,
                content: userMessage.content,
                timestamp: userMessage.timestamp,
              }
            : null,
          aiMessage: aiMessage
            ? {
                id: aiMessage._id,
                role: aiMessage.role,
                intent: aiMessage.intent ?? null,
                content: aiMessage.content,
                timestamp: aiMessage.timestamp,
              }
            : null,
        };
      }),
    );
  },
});

export const listMyRecentChatReplies = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const rows = await ctx.db
      .query("agentModelRuns")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(100);

    const replyRows = rows
      .filter(
        (row) =>
          row.source === "chat" &&
          (row.purpose === "coach_reply" || row.purpose === "operational_reply"),
      )
      .slice(0, Math.min(Math.max(args.limit ?? 10, 1), 50));

    return await Promise.all(
      replyRows.map(async (row) => {
        const legacyMessageId = row.userMessageId ?? row.messageId;
        const [userMessage, aiMessage] = await Promise.all([
          legacyMessageId ? ctx.db.get(legacyMessageId) : Promise.resolve(null),
          row.aiMessageId ? ctx.db.get(row.aiMessageId) : Promise.resolve(null),
        ]);

        const extractionRows = rows
          .filter(
            (candidate) =>
              candidate.source === "chat" &&
              (candidate.userMessageId ?? candidate.messageId) ===
                (row.userMessageId ?? row.messageId) &&
              (candidate.purpose === "chat_extraction" ||
                candidate.purpose === "operational_extraction"),
          )
          .sort((a, b) => a.createdAt - b.createdAt)
          .map((candidate) => ({
            purpose: candidate.purpose,
            finalProvider: candidate.finalProvider,
            finalModel: candidate.finalModel,
            fallbackDepth: candidate.fallbackDepth,
            attempts: candidate.attempts,
            createdAt: candidate.createdAt,
          }));

        return {
          runId: row._id,
          purpose: row.purpose,
          createdAt: row.createdAt,
          providerUsed: row.finalProvider,
          modelUsed: row.finalModel,
          fallbackDepth: row.fallbackDepth,
          attempts: row.attempts,
          userMessageContent:
            row.userMessageContent ?? userMessage?.content ?? null,
          aiMessageContent:
            row.aiMessageContent ?? aiMessage?.content ?? null,
          userMessage: userMessage
            ? {
                id: userMessage._id,
                content: userMessage.content,
                intent: userMessage.intent ?? null,
                timestamp: userMessage.timestamp,
              }
            : null,
          aiMessage: aiMessage
            ? {
                id: aiMessage._id,
                content: aiMessage.content,
                intent: aiMessage.intent ?? null,
                timestamp: aiMessage.timestamp,
              }
            : null,
          extractionRuns: extractionRows,
        };
      }),
    );
  },
});

export type AgentModelRunId = Id<"agentModelRuns">;
