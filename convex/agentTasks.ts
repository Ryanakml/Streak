import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";

async function requireIdentity(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");
  return identity;
}

async function requireOwnedUser(ctx: QueryCtx, userId: Id<"users">) {
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
