import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type AuthCtx = QueryCtx | MutationCtx;

function roundUsd(value: number) {
  return Number(value.toFixed(10));
}

function buildAccumulatedCostMap(
  rows: Array<{
    _id: Id<"agentModelRuns">;
    estimatedCostUsd?: number;
  }>,
) {
  const accumulatedById = new Map<Id<"agentModelRuns">, number>();
  let running = 0;
  for (const row of rows) {
    running += row.estimatedCostUsd ?? 0;
    accumulatedById.set(row._id, roundUsd(running));
  }
  return accumulatedById;
}

async function hydrateAccumulatedTotals<
  TRow extends {
    _id: Id<"agentModelRuns">;
    accumulatedTotalCostUsd?: number;
  },
>(ctx: QueryCtx, userId: Id<"users">, rows: TRow[]) {
  const needsHydration = rows.some(
    (row) => row.accumulatedTotalCostUsd === undefined,
  );
  if (!needsHydration) {
    return rows;
  }

  const allRowsAsc = await ctx.db
    .query("agentModelRuns")
    .withIndex("by_user_createdAt", (q) => q.eq("userId", userId))
    .collect();
  const accumulatedById = buildAccumulatedCostMap(allRowsAsc);

  return rows.map((row) => ({
    ...row,
    accumulatedTotalCostUsd:
      row.accumulatedTotalCostUsd ?? accumulatedById.get(row._id) ?? 0,
  }));
}

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
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    estimatedCostUsd: v.optional(v.number()),
    accumulatedTotalCostUsd: v.optional(v.number()),
    attempts: v.array(
      v.object({
        provider: v.string(),
        model: v.string(),
        attemptOrder: v.number(),
        status: v.union(v.literal("success"), v.literal("failed")),
        errorSummary: v.optional(v.string()),
        inputTokens: v.optional(v.number()),
        outputTokens: v.optional(v.number()),
        estimatedCostUsd: v.optional(v.number()),
      }),
    ),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const currentCost = args.estimatedCostUsd ?? 0;
    const latestRun = await ctx.db
      .query("agentModelRuns")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", args.userId))
      .order("desc")
      .first();

    let previousAccumulated = latestRun?.accumulatedTotalCostUsd;
    if (previousAccumulated === undefined) {
      const rows = await ctx.db
        .query("agentModelRuns")
        .withIndex("by_user_createdAt", (q) => q.eq("userId", args.userId))
        .collect();
      previousAccumulated = rows.reduce(
        (sum, row) => sum + (row.estimatedCostUsd ?? 0),
        0,
      );
    }

    return await ctx.db.insert("agentModelRuns", {
      ...args,
      accumulatedTotalCostUsd: roundUsd(
        (previousAccumulated ?? 0) + currentCost,
      ),
    });
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

    return await hydrateAccumulatedTotals(ctx, args.userId, rows);
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
    const hydratedRows = await hydrateAccumulatedTotals(ctx, user._id, rows);

    if (!args.source) {
      return hydratedRows;
    }

    return hydratedRows.filter((row) => row.source === args.source);
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
    const hydratedRows = await hydrateAccumulatedTotals(ctx, user._id, rows);

    const filtered = args.source
      ? hydratedRows.filter((row) => row.source === args.source)
      : hydratedRows;

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
    const hydratedRows = await hydrateAccumulatedTotals(ctx, user._id, rows);

    const replyRows = hydratedRows
      .filter(
        (row) =>
          row.source === "chat" &&
          (row.purpose === "coach_reply" ||
            row.purpose === "operational_reply"),
      )
      .slice(0, Math.min(Math.max(args.limit ?? 10, 1), 50));

    return await Promise.all(
      replyRows.map(async (row) => {
        const legacyMessageId = row.userMessageId ?? row.messageId;
        const [userMessage, aiMessage] = await Promise.all([
          legacyMessageId ? ctx.db.get(legacyMessageId) : Promise.resolve(null),
          row.aiMessageId ? ctx.db.get(row.aiMessageId) : Promise.resolve(null),
        ]);

        const extractionRows = hydratedRows
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
          aiMessageContent: row.aiMessageContent ?? aiMessage?.content ?? null,
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

export const backfillMyAccumulatedTotalCost = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    const rows = await ctx.db
      .query("agentModelRuns")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", user._id))
      .collect();

    let running = 0;
    let updated = 0;
    for (const row of rows) {
      running += row.estimatedCostUsd ?? 0;
      const accumulatedTotalCostUsd = roundUsd(running);
      if (row.accumulatedTotalCostUsd !== accumulatedTotalCostUsd) {
        await ctx.db.patch(row._id, { accumulatedTotalCostUsd });
        updated += 1;
      }
    }

    return {
      updated,
      totalRuns: rows.length,
      totalCostUsd: roundUsd(running),
    };
  },
});

export type AgentModelRunId = Id<"agentModelRuns">;
