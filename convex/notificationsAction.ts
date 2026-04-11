"use node";

import webpush from "web-push";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { buildTaskReminderErrorFallback } from "./taskReminders";
import { v } from "convex/values";
import { callModelTextWithFallbackTrace } from "./modelProvider";

type PushPayload = {
  kind: "habit_reminder" | "task_reminder";
  title: string;
  body: string;
  url: string;
  habitId?: string;
  taskId?: string;
  reminderType?: "pre_workout" | "check_in" | "late_follow_up";
};

type ReminderCopyRewrite = {
  chatContent: string;
  pushBody: string;
};

type ReminderRewriteContext = {
  deliveryKind: "stage_reminder" | "completion_interrupt";
  habitName: string;
  habitRules: string;
  motivation: string;
  reminderType: "pre_workout" | "check_in" | "late_follow_up";
  currentTimelinePoint: "post" | "due" | "deadline";
  reminderDate: string;
  scheduledTime: string;
  deadline: string;
  scheduledDeltaMinutes: number;
  deadlineDeltaMinutes: number;
  currentStreak: number;
  bestStreak: number;
  missedLast7d: number;
  lastCheckInStatus: string | null;
  recentMissReasons: string[];
  memorySignal: string | null;
  reminderRunState: string | null;
  todayPendingTypes: Array<"pre_workout" | "check_in" | "late_follow_up">;
  todaySentTypes: Array<"pre_workout" | "check_in" | "late_follow_up">;
  languageHint: "indonesian" | "english";
  interactionHistory:
    | "fresh"
    | "ghosting"
    | "hesitating"
    | "active_responder"
    | "promised_but_stalling"
    | "silent_completion";
  responsePattern: string;
  stageHistory: Array<{
    reminderType: "pre_workout" | "check_in" | "late_follow_up";
    timelinePoint: "post" | "due" | "deadline";
    scheduledFor: number;
    sent: boolean;
    responseCode: "R" | "D";
    userMessageCount: number;
    userIntent: string | null;
    userSummary: string | null;
  }>;
  lastUserResponseIntent: string | null;
  lastUserResponseSummary: string | null;
  isAggravated: boolean;
  agitationLevel: "low" | "medium" | "high";
  voiceDirectives: string[];
  styleSeed: number;
  completionStatus: "none" | "completed" | "bonus";
  completedAtLocalTime: string | null;
};

type TaskReminderRewriteContext = {
  taskTitle: string;
  taskDate: string;
  taskTime: string;
  offsetMinutes: number;
  languageHint: "indonesian" | "english";
};

function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    throw new Error(
      "Missing VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, or VAPID_SUBJECT",
    );
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
}

function isExpiredSubscriptionError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { statusCode?: number };
  return candidate.statusCode === 404 || candidate.statusCode === 410;
}

function parseJsonObject(content: string) {
  try {
    return JSON.parse(content) as unknown;
  } catch {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(content.slice(start, end + 1)) as unknown;
    }
    throw new Error("Unable to parse model JSON response");
  }
}

function coerceString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function looksLikeIndonesian(text: string) {
  const lowered = text.toLowerCase();
  const signals = [
    "gue",
    "lo",
    "aku",
    "kamu",
    "nggak",
    "ga ",
    "gak",
    "hari ini",
    "besok",
    "jadwal",
    "skip",
    "geser",
    "capek",
    "males",
    "alesan",
    "alasan",
    "beban",
    "cupu",
    "halah",
    "woy",
    "bro",
  ];
  return signals.some((signal) => lowered.includes(signal));
}

function enforceBrutalDiction(content: string) {
  const cleaned = content
    .replace(/\bmaaf\b/gi, "")
    .replace(/\bsilakan\b/gi, "langsung")
    .replace(/\btolong\b/gi, "langsung")
    .replace(/\bmohon\b/gi, "")
    .replace(/\bplease\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();

  return cleaned;
}

function buildReminderErrorFallback(
  languageHint: ReminderRewriteContext["languageHint"],
) {
  return languageHint === "indonesian"
    ? {
        chatContent: "Broooo",
        pushBody: "Broooo",
      }
    : {
        chatContent: "Dudeeee",
        pushBody: "Dudeeee",
      };
}

function getReminderOpeningStyle(styleSeed: number) {
  const variants = [
    "Start with disbelief or accusation.",
    "Start by calling out the clock or the shrinking window.",
    "Start like a nagging friend who is already annoyed.",
    "Start with a dry joke, then pivot into pressure.",
    "Start short and cold like a verdict.",
    "Start with buddy energy, then turn the screw immediately.",
  ] as const;

  return variants[Math.abs(styleSeed) % variants.length];
}

function getReminderPersonaFrame(context: ReminderRewriteContext) {
  if (context.deliveryKind === "completion_interrupt") {
    return "sarcastic_respect";
  }
  if (context.currentTimelinePoint === "post") {
    return "buddy_nag";
  }
  if (context.currentTimelinePoint === "due") {
    return "pressure_now";
  }
  return "cold_verdict";
}

async function rewriteReminderCopy(args: { context: ReminderRewriteContext }) {
  const contextSample = [
    args.context.habitName,
    args.context.memorySignal,
    ...args.context.recentMissReasons,
  ]
    .filter(Boolean)
    .join(" ");
  const languageHint = looksLikeIndonesian(contextSample)
    ? "indonesian"
    : args.context.languageHint;
  const fallback = buildReminderErrorFallback(languageHint);
  const openingStyle = getReminderOpeningStyle(args.context.styleSeed);
  const personaFrame = getReminderPersonaFrame(args.context);
  const result = await callModelTextWithFallbackTrace(
    [
      {
        role: "system",
        content:
          "You are Streak, the aggressive buddy inside a brutal habit tracker. " +
          "Construct the message from raw facts only. Do not paraphrase a template, do not mirror previous reminder wording, and do not default to the same sentence skeleton. " +
          "Return valid JSON with keys chatContent and pushBody. " +
          "chatContent: 1 to 2 sharp sentences for in-app AI chat. " +
          "pushBody: 1 short sentence for push notification. " +
          "The voice must feel human, informal, cynical, and alive. Think aggressive buddy, not customer support. " +
          "Never start with the habit name. Never use the mechanical pattern 'habit name + time + status'. " +
          "Vary openings aggressively: questions, accusations, nagging one-liners, dry jokes, cold verdicts. " +
          "Pick one dominant language mode only: Indo-first or English-first. Slang mixing is allowed, nonsense token mixing is forbidden. " +
          "If languageHint is Indonesian, use natural Indo-English slang, not formal Indonesian. " +
          "Use at least one direct buddy cue or command word when it fits: bro, dude, yooo, gerak, gas, fix, langsung, udah, move, akhirnya, jangan. " +
          "Use the context fields directly: currentTimelinePoint, interactionHistory, responsePattern, recentMissReasons, lastUserResponseSummary, voiceDirectives, openingStyle, personaFrame, and completionStatus. " +
          "Stage rules are strict. " +
          "POST or buddy_nag: wake-up energy, nagging pressure, shrinking window, repeated excuse callout. No cold final verdict and no fake celebration. " +
          "DUE or pressure_now: impatient, demanding, now-or-never. Call out silence, broken promises, hesitation. No future-looking closer like next session or next time. " +
          "DEADLINE with completionStatus none or cold_verdict: cynical, punishing, emotionally sharp. End with a jab or verdict, not plain information. No motivational wrap-up, no therapist framing, no focus on next time. " +
          "completion_interrupt or sarcastic_respect: they barely saved themselves. Give side-eye, sarcastic respect, zero pending-action language. Never say gerak, move, langsung kerjain, ayo mulai, do it now, or anything that implies the task is still pending. " +
          "If interactionHistory says ghosting or promised_but_stalling, call out the silence or empty talk. " +
          "If recentMissReasons exist, weaponize one reason naturally. " +
          "If the user has repeated misses, sound more fed up and personal. " +
          "If they already responded before, reference that energy so it feels like the same conversation, not a fresh template. " +
          "Use contractions, slang, and imperfect spoken rhythm. Some lines can be fragments. " +
          "Do not sound therapeutic, formal, generic, repetitive, or like a system summary. " +
          "Never use maaf, silakan, tolong, mohon, or please. " +
          "Forbidden closers and filler phrases: fokus ke, jaga momentum, semangat, keep it up, tunggu jadwal berikutnya, setidaknya kamu melakukannya, langkah berikutnya, reset dan fokus. " +
          "Do not invent unsupported state changes or product features. " +
          "Never mention templates, styleSeed, or JSON in the output.",
      },
      {
        role: "user",
        content: JSON.stringify({
          languageHint,
          openingStyle,
          personaFrame,
          facts: {
            deliveryKind: args.context.deliveryKind,
            habitName: args.context.habitName,
            habitRules: args.context.habitRules,
            motivation: args.context.motivation,
            reminderType: args.context.reminderType,
            currentTimelinePoint: args.context.currentTimelinePoint,
            reminderDate: args.context.reminderDate,
            scheduledTime: args.context.scheduledTime,
            deadline: args.context.deadline,
            scheduledDeltaMinutes: args.context.scheduledDeltaMinutes,
            deadlineDeltaMinutes: args.context.deadlineDeltaMinutes,
            currentStreak: args.context.currentStreak,
            bestStreak: args.context.bestStreak,
            missedLast7d: args.context.missedLast7d,
            lastCheckInStatus: args.context.lastCheckInStatus,
            recentMissReasons: args.context.recentMissReasons,
            memorySignal: args.context.memorySignal,
            reminderRunState: args.context.reminderRunState,
            todayPendingTypes: args.context.todayPendingTypes,
            todaySentTypes: args.context.todaySentTypes,
            interactionHistory: args.context.interactionHistory,
            responsePattern: args.context.responsePattern,
            stageHistory: args.context.stageHistory,
            lastUserResponseIntent: args.context.lastUserResponseIntent,
            lastUserResponseSummary: args.context.lastUserResponseSummary,
            isAggravated: args.context.isAggravated,
            agitationLevel: args.context.agitationLevel,
            voiceDirectives: args.context.voiceDirectives,
            completionStatus: args.context.completionStatus,
            completedAtLocalTime: args.context.completedAtLocalTime,
          },
        }),
      },
    ],
    {
      temperature: 0.72,
      errorLabel: "Reminder copy rewrite",
    },
  );

  const parsed = parseJsonObject(result.content) as {
    chatContent?: unknown;
    pushBody?: unknown;
  };
  const chatContent = enforceBrutalDiction(coerceString(parsed.chatContent));
  const pushBody = enforceBrutalDiction(coerceString(parsed.pushBody));

  return {
    chatContent: chatContent || fallback.chatContent,
    pushBody: pushBody || fallback.pushBody,
  } satisfies ReminderCopyRewrite;
}

async function rewriteTaskReminderCopy(args: {
  context: TaskReminderRewriteContext;
}) {
  const fallback = buildTaskReminderErrorFallback(args.context.languageHint);
  const result = await callModelTextWithFallbackTrace(
    [
      {
        role: "system",
        content:
          "You write one-off task reminder copy for an in-app AI buddy. " +
          "Return valid JSON only with keys chatContent and pushBody. " +
          "chatContent is 1 to 2 sentences. pushBody is 1 short sentence. " +
          "The voice must feel human, specific to the task title, and slightly cynical or nagging. " +
          "Do not sound formal, generic, motivational, or like customer support. " +
          "Do not hardcode a template structure. Vary the opening. " +
          "If languageHint is indonesian, use natural informal Indonesian with light slang. " +
          "Mention the task title naturally and make the reminder feel contextual to that task. " +
          "Do not invent extra product features or fake state changes. " +
          "Never use maaf, silakan, tolong, mohon, or please.",
      },
      {
        role: "user",
        content: JSON.stringify(args.context),
      },
    ],
    {
      temperature: 0.6,
      errorLabel: "Task reminder rewrite",
    },
  );

  try {
    const parsed = parseJsonObject(result.content) as Record<string, unknown>;
    const chatContent = enforceBrutalDiction(coerceString(parsed.chatContent));
    const pushBody = enforceBrutalDiction(coerceString(parsed.pushBody));

    if (!chatContent || !pushBody) {
      return fallback;
    }

    return {
      chatContent,
      pushBody,
    };
  } catch (error) {
    console.error("Failed to parse task reminder rewrite", error);
    return fallback;
  }
}

type ReminderDeliveryResult = {
  shouldSendPush: boolean;
  skipped?: boolean;
  userId?: Id<"users">;
  reminderType?: "pre_workout" | "check_in" | "late_follow_up";
  messageId?: Id<"messages">;
  checkInCreatedId?: Id<"checkIns">;
  payload?: PushPayload & {
    rewriteContext?: ReminderRewriteContext;
    taskRewriteContext?: TaskReminderRewriteContext;
  };
};

async function finalizeReminderDelivery(
  ctx: ActionCtx,
  result: ReminderDeliveryResult,
  skipPushDelivery: boolean,
) {
  let pushed = 0;
  let cleanedUp = 0;
  let resolvedPayload = result.payload ?? null;

  if (
    result.messageId &&
    resolvedPayload &&
    result.payload?.rewriteContext &&
    result.reminderType &&
    result.shouldSendPush
  ) {
    try {
      const rewritten = await rewriteReminderCopy({
        context: result.payload.rewriteContext,
      });

      await ctx.runMutation(internal.chat.updateStoredMessage, {
        id: result.messageId,
        content: rewritten.chatContent,
      });
      if (result.checkInCreatedId) {
        await ctx.runMutation(internal.chat.updateCheckInAiResponse, {
          id: result.checkInCreatedId,
          aiResponse: rewritten.chatContent,
        });
      }

      resolvedPayload = {
        ...resolvedPayload,
        body: rewritten.pushBody,
      };
    } catch (error) {
      const languageHint = result.payload.rewriteContext.languageHint;
      const fallback = buildReminderErrorFallback(languageHint);
      await ctx.runMutation(internal.chat.updateStoredMessage, {
        id: result.messageId,
        content: fallback.chatContent,
      });
      if (result.checkInCreatedId) {
        await ctx.runMutation(internal.chat.updateCheckInAiResponse, {
          id: result.checkInCreatedId,
          aiResponse: fallback.chatContent,
        });
      }
      resolvedPayload = {
        ...resolvedPayload,
        body: fallback.pushBody,
      };
      console.error("Failed to rewrite reminder copy dynamically", error);
    }
  }

  if (
    result.messageId &&
    resolvedPayload &&
    result.payload?.taskRewriteContext &&
    result.shouldSendPush
  ) {
    try {
      const rewritten = await rewriteTaskReminderCopy({
        context: result.payload.taskRewriteContext,
      });

      await ctx.runMutation(internal.chat.updateStoredMessage, {
        id: result.messageId,
        content: rewritten.chatContent,
      });

      resolvedPayload = {
        ...resolvedPayload,
        body: rewritten.pushBody,
      };
    } catch (error) {
      const languageHint = result.payload.taskRewriteContext.languageHint;
      const fallback = buildTaskReminderErrorFallback(languageHint);
      await ctx.runMutation(internal.chat.updateStoredMessage, {
        id: result.messageId,
        content: fallback.chatContent,
      });
      resolvedPayload = {
        ...resolvedPayload,
        body: fallback.pushBody,
      };
      console.error("Failed to rewrite task reminder copy dynamically", error);
    }
  }

  if (
    !skipPushDelivery &&
    result.shouldSendPush &&
    result.userId &&
    resolvedPayload
  ) {
    const subscriptions = await ctx.runQuery(
      internal.notifications.listByUserId,
      {
        userId: result.userId,
      },
    );

    const payload = JSON.stringify(resolvedPayload as PushPayload);
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

        console.error("Failed to send push notification", error);
      }
    }
  }

  return {
    pushed,
    cleanedUp,
    resolvedPayload,
  };
}

export const processSingleReminderDelivery = internalAction({
  args: {
    reminderId: v.id("reminders"),
    skipPushDelivery: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (!args.skipPushDelivery) {
      configureWebPush();
    }

    const result = (await ctx.runMutation(internal.reminders.processReminder, {
      reminderId: args.reminderId,
    })) as ReminderDeliveryResult | null;

    if (!result) {
      return { processed: 0, pushed: 0, cleanedUp: 0 };
    }

    const delivery = await finalizeReminderDelivery(
      ctx,
      result,
      Boolean(args.skipPushDelivery),
    );

    return {
      processed: 1,
      pushed: delivery.pushed,
      cleanedUp: delivery.cleanedUp,
      skipped: Boolean(result.skipped),
      shouldSendPush: Boolean(result.shouldSendPush),
      userId: result.userId,
      reminderType: result.reminderType,
      messageId: result.messageId,
      checkInCreatedId: result.checkInCreatedId,
      payload: delivery.resolvedPayload,
    };
  },
});

export const processSingleTaskReminderDelivery = internalAction({
  args: {
    reminderId: v.id("taskReminders"),
    skipPushDelivery: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (!args.skipPushDelivery) {
      configureWebPush();
    }

    const result = (await ctx.runMutation(
      internal.taskReminders.processReminder,
      {
        reminderId: args.reminderId,
      },
    )) as ReminderDeliveryResult | null;

    if (!result) {
      return { processed: 0, pushed: 0, cleanedUp: 0 };
    }

    const delivery = await finalizeReminderDelivery(
      ctx,
      result,
      Boolean(args.skipPushDelivery),
    );

    return {
      processed: 1,
      pushed: delivery.pushed,
      cleanedUp: delivery.cleanedUp,
      skipped: Boolean(result.skipped),
      shouldSendPush: Boolean(result.shouldSendPush),
      userId: result.userId,
      messageId: result.messageId,
      payload: delivery.resolvedPayload,
    };
  },
});

export const processDueReminders = internalAction({
  args: {
    before: v.optional(v.number()),
    skipPushDelivery: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (!args.skipPushDelivery) {
      configureWebPush();
    }

    const dueReminders = await ctx.runQuery(internal.reminders.listDue, {
      before: args.before ?? Date.now(),
    });
    const dueTaskReminders = await ctx.runQuery(
      internal.taskReminders.listDue,
      {
        before: args.before ?? Date.now(),
      },
    );

    let processed = 0;
    let pushed = 0;
    let cleanedUp = 0;

    for (const reminder of dueReminders) {
      const delivery = (await ctx.runAction(
        internal.notificationsAction.processSingleReminderDelivery,
        {
          reminderId: reminder._id,
          skipPushDelivery: args.skipPushDelivery,
        },
      )) as {
        processed: number;
        pushed: number;
        cleanedUp: number;
      };

      processed += delivery.processed;
      pushed += delivery.pushed;
      cleanedUp += delivery.cleanedUp;
    }

    for (const reminder of dueTaskReminders) {
      const delivery = (await ctx.runAction(
        internal.notificationsAction.processSingleTaskReminderDelivery,
        {
          reminderId: reminder._id,
          skipPushDelivery: args.skipPushDelivery,
        },
      )) as {
        processed: number;
        pushed: number;
        cleanedUp: number;
      };

      processed += delivery.processed;
      pushed += delivery.pushed;
      cleanedUp += delivery.cleanedUp;
    }

    return { processed, pushed, cleanedUp };
  },
});
