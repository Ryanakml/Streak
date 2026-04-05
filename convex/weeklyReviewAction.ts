"use node";

import webpush from "web-push";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

type WeeklyReason = {
  day: string;
  reason: string;
};

type WeeklyPushPayload = {
  title: string;
  body: string;
  url: string;
  habitId: string;
  reminderType: "weekly_review";
};

type GenerationContext = {
  user: Doc<"users">;
  timezone: string;
  weekStart: string;
  weekEnd: string;
  dayKeys: Array<{ dateKey: string; day: string }>;
  habits: Doc<"habits">[];
  weeklyCheckIns: Doc<"checkIns">[];
  workoutLogs: Doc<"workoutLogs">[];
};

function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

function isExpiredSubscriptionError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { statusCode?: number };
  return candidate.statusCode === 404 || candidate.statusCode === 410;
}

function titleDay(day: string) {
  return {
    mon: "Mon",
    tue: "Tue",
    wed: "Wed",
    thu: "Thu",
    fri: "Fri",
    sat: "Sat",
    sun: "Sun",
  }[day] ?? day;
}

function normalizeReason(checkIn: Doc<"checkIns">) {
  if (checkIn.userReason?.trim()) {
    return checkIn.userReason.trim();
  }

  return checkIn.source === "auto_deadline" ? "deadline miss" : "no reason given";
}

function fallbackRoast(args: {
  habitName: string;
  targetCount: number;
  actualCount: number;
  bonusCount: number;
  completionRate: number;
  missedDaysReasons: WeeklyReason[];
}) {
  if (args.actualCount >= args.targetCount && args.targetCount > 0) {
    return `${args.habitName}: you actually hit the target. Good. The standard stays there now. ${
      args.bonusCount > 0 ? `Bonus work: ${args.bonusCount}.` : ""
    }`.trim();
  }

  const reasons =
    args.missedDaysReasons.length > 0
      ? args.missedDaysReasons
          .slice(0, 2)
          .map((entry) => `${entry.day}: ${entry.reason}`)
          .join("; ")
      : "No excuses were even logged.";

  return `${args.habitName}: ${args.actualCount}/${args.targetCount} with ${Math.round(
    args.completionRate,
  )}% completion. That's not momentum, that's leakage. ${reasons}`;
}

async function callGroqText(messages: Array<{ role: "system" | "user"; content: string }>) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY for weekly review generation");
  }

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.4,
      messages,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Groq request failed (${response.status}): ${body.slice(0, 400)}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("Groq weekly review response did not include message content");
  }

  return content;
}

async function generateRoast(args: {
  habit: Doc<"habits">;
  targetCount: number;
  actualCount: number;
  bonusCount: number;
  completionRate: number;
  missedDaysReasons: WeeklyReason[];
}) {
  try {
    const roast = await callGroqText([
      {
        role: "system",
        content:
          "You are the Streak coach. Write a concise weekly review roast in brutal, direct, data-grounded tone. Use 2 to 4 sentences. No emojis. No pep talk. No markdown bullets. Mention only facts provided.",
      },
      {
        role: "user",
        content: JSON.stringify({
          habitName: args.habit.name,
          targetCount: args.targetCount,
          actualCount: args.actualCount,
          bonusCount: args.bonusCount,
          completionRate: Math.round(args.completionRate),
          currentStreak: args.habit.currentStreak,
          bestStreak: args.habit.bestStreak,
          missedDaysReasons: args.missedDaysReasons,
          motivation: args.habit.motivation,
        }),
      },
    ]);

    return roast.trim();
  } catch {
    return fallbackRoast({
      habitName: args.habit.name,
      targetCount: args.targetCount,
      actualCount: args.actualCount,
      bonusCount: args.bonusCount,
      completionRate: args.completionRate,
      missedDaysReasons: args.missedDaysReasons,
    });
  }
}

function buildChatContent(args: {
  habitName: string;
  weekStart: string;
  weekEnd: string;
  targetCount: number;
  actualCount: number;
  bonusCount: number;
  completionRate: number;
  aiRoast: string;
}) {
  return [
    `Weekly review for ${args.habitName} (${args.weekStart} to ${args.weekEnd}).`,
    `Target ${args.targetCount}. Completed ${args.actualCount}. Bonus ${args.bonusCount}. Completion ${Math.round(args.completionRate)}%.`,
    args.aiRoast,
  ].join(" ");
}

async function pushWeeklyReview(
  ctx: any,
  args: {
    userId: Doc<"users">["_id"];
    habitId: Doc<"habits">["_id"];
    habitName: string;
  },
) {
  if (!configureWebPush()) {
    return { pushed: 0, cleanedUp: 0 };
  }

  const subscriptions = await ctx.runQuery(internal.notifications.listByUserId, {
    userId: args.userId,
  });

  let pushed = 0;
  let cleanedUp = 0;
  const payload = JSON.stringify({
    title: "Weekly review ready",
    body: `${args.habitName} just got graded. Open Chat and read the damage.`,
    url: "/dashboard?tab=chat",
    habitId: args.habitId,
    reminderType: "weekly_review",
  } satisfies WeeklyPushPayload);

  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          expirationTime: subscription.expirationTime ?? null,
          keys: subscription.keys,
        },
        payload,
      );
      pushed += 1;
    } catch (error) {
      if (isExpiredSubscriptionError(error)) {
        await ctx.runMutation(internal.notifications.removeByEndpoint, {
          endpoint: subscription.endpoint,
        });
        cleanedUp += 1;
        continue;
      }

      console.error("Failed to send weekly review push", error);
    }
  }

  return { pushed, cleanedUp };
}

async function generateReportsForUser(
  ctx: any,
  args: {
    userId: Doc<"users">["_id"];
    now: number;
  },
) {
  const context = (await ctx.runQuery(internal.weeklyReports.getGenerationContext, {
    userId: args.userId,
    weekStart: "",
    now: args.now,
  })) as GenerationContext;

  let createdReports = 0;
  let pushed = 0;
  let cleanedUp = 0;

  for (const habit of context.habits) {
    const habitCheckIns = context.weeklyCheckIns.filter((entry) => entry.habitId === habit._id);
    const completedCheckIns = habitCheckIns.filter((entry) => entry.status === "completed");
    const bonusCheckIns = habitCheckIns.filter((entry) => entry.status === "bonus");
    const missedDaysReasons = habitCheckIns
      .filter((entry) => entry.status === "missed")
      .map((entry) => {
        const dayKey = context.dayKeys.find((day) => day.dateKey === entry.date)?.day ?? "";
        return {
          day: titleDay(dayKey),
          reason: normalizeReason(entry),
        };
      });
    const targetCount = context.dayKeys.filter((day) => habit.targetDays.includes(day.day)).length;
    const actualCount = completedCheckIns.length;
    const bonusCount = bonusCheckIns.length;
    const completionRate = targetCount > 0 ? (actualCount / targetCount) * 100 : 0;
    const aiRoast = await generateRoast({
      habit,
      targetCount,
      actualCount,
      bonusCount,
      completionRate,
      missedDaysReasons,
    });
    const chatContent = buildChatContent({
      habitName: habit.name,
      weekStart: context.weekStart,
      weekEnd: context.weekEnd,
      targetCount,
      actualCount,
      bonusCount,
      completionRate,
      aiRoast,
    });

    const result = await ctx.runMutation(internal.weeklyReports.upsertGeneratedReport, {
      userId: context.user._id,
      habitId: habit._id,
      weekStart: context.weekStart,
      weekEnd: context.weekEnd,
      targetCount,
      actualCount,
      bonusCount,
      completionRate,
      aiRoast,
      missedDaysReasons,
      chatContent,
    });

    if (!result.wasCreated) {
      continue;
    }

    createdReports += 1;

    const pushResult = await pushWeeklyReview(ctx, {
      userId: context.user._id,
      habitId: habit._id,
      habitName: habit.name,
    });
    pushed += pushResult.pushed;
    cleanedUp += pushResult.cleanedUp;
  }

  return {
    userId: context.user._id,
    timezone: context.timezone,
    weekStart: context.weekStart,
    weekEnd: context.weekEnd,
    createdReports,
    pushed,
    cleanedUp,
  };
}

export const processDueWeeklyReviews = internalAction({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const candidates = await ctx.runQuery(internal.weeklyReports.getGenerationCandidates, { now });

    const results = [];
    let processedUsers = 0;
    let createdReports = 0;
    let pushed = 0;
    let cleanedUp = 0;

    for (const candidate of candidates) {
      const result = await generateReportsForUser(ctx, {
        userId: candidate.userId,
        now,
      });
      processedUsers += 1;
      createdReports += result.createdReports;
      pushed += result.pushed;
      cleanedUp += result.cleanedUp;
      results.push(result);
    }

    return {
      processedUsers,
      createdReports,
      pushed,
      cleanedUp,
      results,
    };
  },
});

export const runNow = action({
  args: { now: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<{
    userId: Doc<"users">["_id"];
    timezone: string;
    weekStart: string;
    weekEnd: string;
    createdReports: number;
    pushed: number;
    cleanedUp: number;
  }> => {
    const user = await ctx.runQuery(api.users.getCurrent, {});
    if (!user) {
      throw new Error("Unauthorized");
    }

    return await generateReportsForUser(ctx, {
      userId: user._id,
      now: args.now ?? Date.now(),
    });
  },
});
