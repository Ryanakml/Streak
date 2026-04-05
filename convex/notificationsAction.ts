"use node";

import webpush from "web-push";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

type PushPayload = {
  title: string;
  body: string;
  url: string;
  habitId: string;
  reminderType: "pre_workout" | "check_in" | "late_follow_up";
};

function configureWebPush() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    throw new Error("Missing VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, or VAPID_SUBJECT");
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

export const processDueReminders = internalAction({
  args: { before: v.optional(v.number()) },
  handler: async (ctx, args) => {
    configureWebPush();

    const dueReminders = await ctx.runQuery(internal.reminders.listDue, {
      before: args.before ?? Date.now(),
    });

    let processed = 0;
    let pushed = 0;
    let cleanedUp = 0;

    for (const reminder of dueReminders) {
      const result = await ctx.runMutation(internal.reminders.processReminder, {
        reminderId: reminder._id,
      });

      if (!result) {
        continue;
      }

      processed += 1;
      if (!result.shouldSendPush || !result.userId || !result.payload) {
        continue;
      }

      const subscriptions = await ctx.runQuery(internal.notifications.listByUserId, {
        userId: result.userId,
      });

      const payload = JSON.stringify(result.payload as PushPayload);
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

    return { processed, pushed, cleanedUp };
  },
});
