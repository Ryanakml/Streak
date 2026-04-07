# Convex Backend Guide

This directory contains the Streak backend: schema, database functions, AI actions, reminder processing, push notification delivery, agent memory, verification seeds, and cron configuration.

The root README is the main project entry point. This file is a focused reference for developers working inside `convex/`.

## Directory Contents

| File | Purpose |
| --- | --- |
| `schema.ts` | Convex table definitions and indexes. |
| `users.ts` | Clerk-linked user sync, profile update, subscription tier sync, and daily message budget. |
| `habits.ts` | Habit CRUD and reminder refresh scheduling. |
| `checkIns.ts` | Habit completion, miss, and bonus logs. |
| `workoutLogs.ts` | Structured workout logs attached to check-ins. |
| `messages.ts` | Chat message queries and mutations. |
| `chat.ts` | Internal chat context and persistence helpers. |
| `chatAction.ts` | AI chat action, intent routing, response generation, and operational side effects. |
| `agentActions.ts` | Internal auditable actions such as log completion, log miss, reschedule, skip, planning, and risk scans. |
| `agentMemory.ts` | Agent episodes and rolling memory summaries. |
| `reminders.ts` | Reminder queue, reminder state machine, copy generation, and due reminder processing mutation. |
| `notifications.ts` | Browser push subscription storage and cleanup helpers. |
| `notificationsAction.ts` | Node action that sends web push notifications. |
| `weeklyReports.ts` | Weekly report queries and persistence. |
| `weeklyReviewAction.ts` | Weekly review generation and optional push delivery. |
| `crons.ts` | Scheduled jobs for reminders, weekly reviews, and memory refresh. |
| `devSeeds.ts` | Seed and verification helpers for the phased agent/reminder work. |
| `_generated/` | Generated Convex API and data model types. |

## Runtime Environment

Convex server actions read server-side environment variables from the Convex runtime. The local Next.js `.env.local` file is useful for the frontend and local helper scripts, but deployed Convex actions also need their own environment values configured.

Core backend variables:

- `CLERK_ISSUER_URL` or `CLERK_JWT_ISSUER_DOMAIN`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` as an issuer fallback in `auth.config.ts`
- `GROQ_API_KEY`
- `GEMINI_API_KEY`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`

Frontend and scripts also require:

- `NEXT_PUBLIC_CONVEX_URL`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`

## Scheduled Jobs

`crons.ts` registers three recurring jobs:

| Cron | Frequency | Target |
| --- | --- | --- |
| `process-due-reminders` | Every 1 minute | `internal.notificationsAction.processDueReminders` |
| `process-due-weekly-reviews` | Every 1 minute | `internal.weeklyReviewAction.processDueWeeklyReviews` |
| `process-daily-agent-memory` | Every 1 hour | `internal.agentMemory.processDailySummaries` |

## Reminder Model

The reminder system uses two different tables for different jobs:

- `reminders` is the delivery queue.
- `reminderRuns` is the state machine for one `habit x date`.

Reminder run states include:

- `scheduled`
- `pre_reminded`
- `user_acknowledged`
- `user_hesitant`
- `ignored_once`
- `completed`
- `missed`
- `rescheduled`
- `skipped`

This lets chat, reminder processing, skips, reschedules, completions, and auto-misses operate on the same source of truth.

## Chat And Agent Model

The chat action is more than a text reply path. It can:

- Persist user and AI messages.
- Classify completion, miss, excuse, question, bonus, and operational intents.
- Execute internal actions when the user asks to complete, miss, reschedule, skip, plan, or scan risk.
- Write check-ins and workout logs.
- Advance active reminder runs when a message is related to an in-flight reminder.
- Log actions to `agentActionLogs`.
- Write important events to `agentEpisodes`.
- Use rolling summaries from `agentMemory`.

Keep new side effects behind auditable internal mutations. Avoid hiding product state changes inside response wording.

## Weekly Reviews

Weekly reviews collect prior-week habit and check-in context, generate a coach summary, and store it in `weeklyReports`. The action can also send a push notification when subscriptions exist.

## Development Commands

From the repo root:

```bash
npx convex dev
npx convex codegen
npm run seed:phase4 -- --email user@example.com
npm run phase4:process-reminders -- --email user@example.com
```

The npm wrapper scripts in the root `package.json` load `.env.local` and call selected seed or verification helpers.

## Editing Notes

- Update `schema.ts` first when adding or changing tables.
- Regenerate Convex types after schema or function export changes.
- Keep ownership checks in user-facing queries and mutations.
- Keep cron-triggered work internal unless there is a deliberate public action wrapper.
- Do not treat `reminders` as durable state. Use `reminderRuns` for stateful product behavior.
- Do not commit secrets into environment files.
