# Streak

Streak is an AI accountability habit tracker. It combines a normal habit dashboard with an AI coach, reminders, push notifications, streak tracking, and weekly readouts so a user can define a habit, get pushed at the right time, log the result, and review the pattern later.

This README is written for two audiences:

- Users and product testers who want to understand what the app does.
- Developers who need to run, maintain, or extend the codebase.

## Product Guide

### What Streak Is For

Streak is built for people who do not just want a checkbox habit tracker. The core idea is:

- The user defines a habit with a schedule, reminder time, deadline, rules, and motivation.
- The app shows what is due today and what is at risk.
- The AI coach gives direct accountability through chat and reminders.
- The system logs completed, missed, bonus, skipped, and auto-missed habit outcomes.
- The backend keeps a stateful reminder journey per `habit x date`, so reminders can respond to what the user has already said or done.

### Current User Flow

1. Visit the landing page at `/`.
2. Sign in or sign up through Clerk.
3. Complete onboarding by choosing the current coach mode and creating the first habit.
4. Land on the dashboard at `/dashboard`.
5. Use the Home tab to see today's pressure state and quick actions.
6. Use the Chat tab to talk to the AI coach, log outcomes, explain misses, ask for planning help, or respond to reminders.
7. Use the Stats tab to review the current week, recent logs, streaks, misses, and weekly review output.
8. Use the Profile tab to manage account state, theme, notifications, and dev-mode billing tier.

### Main Screens

| Screen | Route | Purpose |
| --- | --- | --- |
| Landing | `/` | Public marketing and sign-in entry point. |
| Sign in | `/sign-in` | Clerk sign-in UI. |
| Sign up | `/sign-up` | Clerk sign-up UI. |
| Dashboard | `/dashboard` | Authenticated app shell with Home, Chat, Stats, and Profile tabs. |

### Habit Setup

Each habit stores:

- Name, such as `Go to gym 4x/week`.
- Target days, such as `mon`, `wed`, `fri`, and `sat`.
- Scheduled time, which is the intended habit time.
- Reminder time, which is when the app should nudge the user before the habit.
- Check-in deadline, which is when the app can treat the day as missed if the user does not log anything.
- Rules, which define what counts as a completed habit.
- Motivation, which gives the coach context.
- Current streak and best streak.
- Active or paused state.
- Optional Friday-specific schedule override.

### Home Tab

The Home tab is the fast operational view. It shows:

- Today's date and current time.
- Current plan tier.
- The primary habit that needs attention right now.
- Whether a habit is upcoming, due soon, at deadline risk, logged, missed, or on a rest day.
- Reminder time, deadline time, streak state, rules, and motivation.
- Quick actions to check in, mark a miss, pause or resume a habit, delete a habit, open details, or jump to chat.

Free-tier users are currently limited to 3 habits in the UI. Pro-tier users can add more.

### Chat Tab

The Chat tab is the AI coach console. It is connected to the same habit and reminder state that powers the dashboard.

The user can:

- Tell the coach they completed a habit.
- Say they skipped or missed a habit.
- Explain an excuse or hesitation.
- Ask about recent patterns.
- Ask for a plan or risk scan.
- Reschedule a future habit time through natural language.
- Skip a habit for a future date through natural language.
- Use quick actions such as "Mark today done" or "I skipped today".

The free tier currently has a daily chat budget of 20 messages per local day. Pro tier is treated as unlimited by the current code.

### Stats Tab

The Stats tab summarizes:

- Best active streak.
- Misses this week.
- Completed count this week.
- Bonus session count.
- Today focus state.
- Per-habit weekly grid.
- Recent workout logs.
- Latest weekly AI review, when one exists.

### Profile Tab

The Profile tab includes:

- Current user email.
- Current plan tier.
- Daily message usage.
- Remaining daily messages.
- Reminder notification status.
- Theme mode.
- Dev-mode upgrade and downgrade controls.
- Enable reminders button for browser push notifications.

### Reminders And Notifications

Streak creates reminder records for active habits and processes due reminders through Convex crons.

There are three reminder types:

- `pre_workout`: sent before the scheduled habit time.
- `check_in`: sent at the scheduled habit time.
- `late_follow_up`: sent after the check-in deadline and can auto-record a miss when appropriate.

The app also tracks `reminderRuns`, which are the state machine for a single `habit x date`. Current states include:

- `scheduled`
- `pre_reminded`
- `user_acknowledged`
- `user_hesitant`
- `ignored_once`
- `completed`
- `missed`
- `rescheduled`
- `skipped`

This is important because reminders are not just static queue items. A later reminder can react differently if the user already acknowledged the habit, hesitated, completed it, skipped it, or rescheduled it.

Push notifications use:

- Browser service worker: `public/reminder-sw.js`
- Frontend VAPID public key: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- Convex server VAPID keys: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`

### Billing Status

Billing is currently dev-mode only.

- Clerk public metadata stores `subscriptionTier`.
- Convex syncs that tier into `users.subscriptionTier`.
- The frontend and Convex gating logic read the Convex-backed user record.
- `/api/billing/upgrade` sets Clerk public metadata to `pro`.
- `/api/billing/downgrade` sets Clerk public metadata to `free`.

The intended future migration path is documented in `docs/upnext/billing-migration.md`.

### Current Product Status

The Phase 4 verification result says the stateful reminder conversation behavior is functionally passing:

- `reminderRuns` is the source of truth for reminder state.
- `reminders` acts as a delivery queue.
- Chat can advance active reminder journeys.
- Completion, skip, miss, and reschedule flows are synced with the reminder state.
- Remaining Phase 4 gaps are mainly verification-tooling cleanup, not core product behavior.

See `docs/phase/phase-4-verification-results.md` for the detailed verification notes.

## Developer Guide

### Tech Stack

| Area | Tooling |
| --- | --- |
| App framework | Next.js `16.2.2` with App Router |
| React | React `19.2.4` |
| Language | TypeScript |
| Auth | Clerk |
| Backend/database | Convex |
| AI providers | Gemini, Groq, and DigitalOcean Inference fallback for server-side actions |
| Styling | Tailwind CSS v4, custom UI components, Base UI, shadcn-style component structure |
| Animation | GSAP, Framer Motion, Motion |
| Push notifications | `web-push`, service worker, Push API |
| Package manager | npm, because `package-lock.json` is present |

### Next.js Version Warning

This repo has an `AGENTS.md` warning for Next.js. Before changing Next.js code, read the relevant guide in:

```txt
node_modules/next/dist/docs/
```

Important installed-version notes already confirmed from the local docs:

- This app uses the App Router under `src/app`.
- Pages are exposed through `page.tsx` files.
- Route Handlers are implemented through `route.ts` files under `src/app`.
- Next.js 16 uses `proxy.ts` terminology instead of old Middleware terminology.
- This repo has a single proxy file at `src/proxy.ts`, which protects `/dashboard`.
- Environment files are loaded from the project root, not from `src`.

### Repository Map

```txt
.
+-- README.md
+-- AGENTS.md
+-- package.json
+-- next.config.ts
+-- src
|   +-- app
|   |   +-- page.tsx
|   |   +-- layout.tsx
|   |   +-- (auth)
|   |   +-- (protected)
|   |   +-- api
|   +-- components
|   |   +-- custom
|   |   +-- ui
|   +-- lib
|   +-- proxy.ts
+-- convex
|   +-- schema.ts
|   +-- users.ts
|   +-- habits.ts
|   +-- checkIns.ts
|   +-- reminders.ts
|   +-- notifications.ts
|   +-- notificationsAction.ts
|   +-- chat.ts
|   +-- chatAction.ts
|   +-- agentActions.ts
|   +-- agentMemory.ts
|   +-- weeklyReports.ts
|   +-- weeklyReviewAction.ts
|   +-- crons.ts
|   +-- _generated
+-- public
|   +-- logo.svg
|   +-- reminder-sw.js
+-- scripts
+-- docs
```

### Key Frontend Files

| File | Purpose |
| --- | --- |
| `src/app/layout.tsx` | Root layout. Wraps Clerk, Convex, theme provider, metadata, and global CSS. |
| `src/app/page.tsx` | Public landing page entry. |
| `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx` | Clerk sign-in page. |
| `src/app/(auth)/sign-up/[[...sign-up]]/page.tsx` | Clerk sign-up page. |
| `src/app/(protected)/dashboard/page.tsx` | Auth-protected dashboard route. |
| `src/proxy.ts` | Clerk request proxy for `/dashboard`. |
| `src/components/custom/dashboard-shell.tsx` | Main authenticated app UI and client-side orchestration. |
| `src/components/custom/landing.tsx` | Public landing page component. |
| `src/components/custom/convex-client-provider.tsx` | Connects Convex React client to Clerk auth. |
| `src/lib/convex.ts` | Creates `ConvexReactClient` from `NEXT_PUBLIC_CONVEX_URL`. |
| `public/reminder-sw.js` | Service worker for push reminder display and notification click routing. |

### Key Convex Files

| File | Purpose |
| --- | --- |
| `convex/schema.ts` | Database schema and indexes. |
| `convex/users.ts` | Clerk-to-Convex user sync, profile update, and daily message budget. |
| `convex/habits.ts` | Habit CRUD and reminder refresh scheduling. |
| `convex/checkIns.ts` | Completion, miss, and bonus check-in records. |
| `convex/workoutLogs.ts` | Structured workout logs attached to check-ins. |
| `convex/messages.ts` | Stored chat messages. |
| `convex/chat.ts` | Internal chat context and persistence helpers. |
| `convex/chatAction.ts` | AI chat action, intent handling, operational commands, and side effects. |
| `convex/agentActions.ts` | Auditable internal operational actions such as log completion, log miss, reschedule, skip, and planning helpers. |
| `convex/agentMemory.ts` | Agent episodes and rolling memory summaries. |
| `convex/reminders.ts` | Reminder queue, reminder run state machine, reminder copy, and due reminder processing mutation. |
| `convex/notifications.ts` | Push subscription CRUD. |
| `convex/notificationsAction.ts` | Node action that sends web push notifications. |
| `convex/weeklyReports.ts` | Weekly report data access and persistence. |
| `convex/weeklyReviewAction.ts` | Weekly review generation and optional push delivery. |
| `convex/crons.ts` | Convex cron jobs for reminders, weekly reviews, and daily memory refresh. |
| `convex/devSeeds.ts` | Verification and demo seed helpers. |

### Prerequisites

You need:

- Node.js compatible with Next.js 16 and React 19.
- npm.
- Clerk project credentials.
- Convex project/deployment credentials.
- Gemini and/or Groq API keys for primary AI behavior.
- Optional DigitalOcean Inference key for third-stage fallback when Gemini and Groq are unavailable or rate-limited.
- VAPID keys if you want real push notification delivery.

### Environment Setup

Start from the example file:

```bash
cp .env.example .env.local
```

Fill in the values that apply to your local setup.

| Variable | Used by | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Next.js and Convex auth config fallback | Public Clerk key. |
| `CLERK_SECRET_KEY` | Next.js API routes | Needed for Clerk server APIs such as dev billing routes. |
| `CLERK_ISSUER_URL` | Convex auth | Preferred issuer for Convex JWT validation. |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex auth | Supported fallback name used by `convex/auth.config.ts`. |
| `CLERK_WEBHOOK_SECRET` | Future Clerk webhook work | Present in the example file, not a core current path. |
| `CONVEX_DEPLOYMENT` | Convex CLI | Convex deployment identifier. |
| `NEXT_PUBLIC_CONVEX_URL` | Next.js frontend and scripts | Required by `src/lib/convex.ts` and verification scripts. |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | Future/site integrations | Present in the example file. |
| `GROQ_API_KEY` | Convex actions | Used by chat and weekly review actions. |
| `GEMINI_API_KEY` | Convex actions | Used by chat and weekly review actions. |
| `DIGITALOCEAN_MODEL_ACCESS_KEY` | Convex actions | Optional third fallback provider key for chat and weekly review generation. |
| `DIGITALOCEAN_INFERENCE_MODEL` | Convex actions | Optional override for the DigitalOcean fallback model. Current verified model is `llama3.3-70b-instruct`. |
| `DIGITALOCEAN_INFERENCE_BASE_URL` | Convex actions | Optional override for the DigitalOcean OpenAI-compatible inference endpoint. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Browser client | Used when subscribing the browser to push notifications. |
| `VAPID_PUBLIC_KEY` | Convex Node actions | Used by `web-push`. Should match the public browser key. |
| `VAPID_PRIVATE_KEY` | Convex Node actions | Server-side VAPID private key. |
| `VAPID_SUBJECT` | Convex Node actions | Usually a `mailto:` contact. |
| `NEXT_PUBLIC_BILLING_MODE` | Billing migration marker | Current example value is `clerk_dev`. |
| `POLAR_ACCESS_TOKEN` | Future Polar migration | Not required by current dev billing routes. |
| `POLAR_ORGANIZATION_ID` | Future Polar migration | Not required by current dev billing routes. |
| `POLAR_WEBHOOK_SECRET` | Future Polar migration | Not required by current dev billing routes. |

Do not commit real secrets. Next.js loads `.env.local` from the project root. Convex server-side runtime variables also need to be configured for the Convex deployment that runs the actions.

### Install And Run

Install dependencies:

```bash
npm install
```

Run Convex in one terminal:

```bash
npx convex dev
```

Run Next.js in another terminal:

```bash
npm run dev
```

Open:

```txt
http://localhost:3000
```

### Available Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js dev server. |
| `npm run build` | Build the Next.js app. |
| `npm run start` | Start the production Next.js server after a build. |
| `npm run lint` | Run ESLint. |
| `npm run seed:phase1` | Run Phase 1 verification seed helper. |
| `npm run seed:phase2` | Run Phase 2 verification seed helper. |
| `npm run seed:phase3` | Run Phase 3 verification seed helper. |
| `npm run seed:phase4` | Run Phase 4 verification seed helper. |
| `npm run seed:phase5` | Run Phase 5 verification seed helper. |
| `npm run phase3:process-reminders` | Process Phase 3 reminder verification helper. |
| `npm run phase3:refresh-memory` | Refresh Phase 3 memory verification helper. |
| `npm run phase4:process-reminders` | Process Phase 4 reminder verification helper. |
| `npm run phase5:process-reminders` | Process Phase 5 reminder verification helper. |

The verification helper scripts load `.env.local` and require `NEXT_PUBLIC_CONVEX_URL`. Seed scripts usually also require a target user, for example:

```bash
npm run seed:phase4 -- --email user@example.com
```

### Architecture Flows

#### Auth And User Sync

1. Clerk authenticates the user.
2. `src/proxy.ts` protects `/dashboard`.
3. `src/app/(protected)/dashboard/page.tsx` calls `auth.protect()`.
4. `DashboardShell` reads the Clerk user.
5. `api.users.syncUser` creates or updates the Convex `users` record.
6. Convex functions validate ownership by comparing the Convex user record to the authenticated Clerk subject.

#### Habit Creation And Reminder Refresh

1. The user creates or updates a habit.
2. `convex/habits.ts` writes the habit.
3. Schedule-affecting changes enqueue `internal.reminders.refreshForHabit`.
4. `convex/reminders.ts` rebuilds future reminder queue entries for the habit.
5. Skipped and closed `reminderRuns` are respected so closed days do not get re-opened accidentally.

#### Reminder Processing

1. `convex/crons.ts` runs `process-due-reminders` every minute.
2. `convex/notificationsAction.ts` loads due reminders through `internal.reminders.listDue`.
3. Each reminder is processed through `internal.reminders.processReminder`.
4. Processing can create an AI message, advance `reminderRuns`, create an auto-miss check-in, or skip push delivery.
5. If push should be sent, the action loads `pushSubscriptions` and sends browser push notifications with `web-push`.
6. Expired push subscriptions are cleaned up.

#### Chat And Agent Actions

1. The user sends a chat message from the Chat tab.
2. `DashboardShell` calls `api.chatAction.sendMessage`.
3. `convex/chatAction.ts` assembles context from habits, messages, check-ins, reminders, memory, and agent action data.
4. The action classifies intent and decides whether to answer only or execute an operational side effect.
5. Operational side effects go through internal action helpers, such as completion, miss, reschedule, skip, task creation, risk scan, or plan lookup.
6. Messages, check-ins, workout logs, reminder run state, action logs, episodes, and memory are persisted as needed.

#### Weekly Reviews

1. `convex/crons.ts` runs `process-due-weekly-reviews` every minute.
2. `convex/weeklyReviewAction.ts` gathers weekly context.
3. The action generates or falls back to a weekly coach review.
4. The result is stored in `weeklyReports`.
5. If appropriate, a push notification can be sent to the user.

#### Billing Tier Sync

1. Dev billing routes update Clerk public metadata.
2. `DashboardShell` reloads the Clerk user.
3. The frontend sync path updates Convex `users.subscriptionTier`.
4. Convex message-budget checks and dashboard gating read the Convex user record.

Keep this contract when replacing dev billing with Polar later.

### Data Model Overview

| Table | Purpose |
| --- | --- |
| `users` | Clerk-linked user profile, timezone, coach mode, plan tier, and chat budget. |
| `habits` | Habit definitions, schedule, rules, motivation, streaks, and active state. |
| `checkIns` | Logged outcomes for a habit on a date. |
| `workoutLogs` | Structured workout detail connected to check-ins. |
| `messages` | User and AI chat messages. |
| `reminders` | Delivery queue for reminder events. |
| `reminderRuns` | Stateful reminder journey for a single `habit x date`. |
| `pushSubscriptions` | Browser push endpoints and keys. |
| `weeklyReports` | Generated weekly review summaries. |
| `agentActionLogs` | Audit trail for operational agent actions. |
| `habitSkips` | Explicit skipped dates. |
| `agentPendingActions` | Clarification-required actions waiting for user input. |
| `agentTasks` | Lightweight planner task records. |
| `agentEpisodes` | Important events used by agent memory. |
| `agentMemory` | Rolling global or habit-specific memory summaries. |

### Verification Docs

Detailed verification notes live under `docs/phase`.

Useful current files:

- `docs/phase/phase-4-verification-results.md`
- `docs/phase/phase-4-verification-test-plan.md`
- `docs/phase/phase-3-verification-results.md`
- `docs/upnext/billing-migration.md`

### Development Rules

- Use npm for dependency changes because the repo has `package-lock.json`.
- Do not manually edit `convex/_generated` unless you are intentionally updating generated output.
- After changing Convex schema or function exports, run `npx convex codegen` or keep `npx convex dev` running so generated types stay current.
- Before touching Next.js routing, proxy, route handlers, environment handling, or config, read the matching local Next docs under `node_modules/next/dist/docs`.
- Keep browser-exposed secrets behind the `NEXT_PUBLIC_` rule. Anything without that prefix is server-only from the browser's perspective.
- Keep billing provider details isolated at API/webhook boundaries. Product gating should continue to read Clerk metadata synced into Convex.

### Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `Missing NEXT_PUBLIC_CONVEX_URL` | Frontend cannot create the Convex client. | Set `NEXT_PUBLIC_CONVEX_URL` in `.env.local` and restart `npm run dev`. |
| Dashboard stays on account sync | Clerk user exists but Convex `users` record is missing or sync failed. | Check Clerk auth state, Convex dev logs, and `api.users.syncUser`. |
| Convex auth fails | Clerk issuer is missing or incorrect. | Set `CLERK_ISSUER_URL` or `CLERK_JWT_ISSUER_DOMAIN` for the Convex deployment. |
| Chat fails | AI provider key missing, provider quota exhausted, or Convex action error. | Check `GEMINI_API_KEY`, `GROQ_API_KEY`, optional `DIGITALOCEAN_MODEL_ACCESS_KEY`, and Convex logs. |
| Free chat cap error | Free user hit the 20-message local-day limit. | Wait for local-day reset or use the dev Pro upgrade route. |
| Notifications stay disabled | Browser permission, service worker, Push API, or VAPID key issue. | Check browser support, permission state, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, and Convex VAPID env values. |
| Reminders do not send | Convex crons, queue data, or push subscriptions are missing. | Check `reminders`, `reminderRuns`, `pushSubscriptions`, and `process-due-reminders` logs. |
| Dev billing does not update | Clerk server API or metadata reload failed. | Check `CLERK_SECRET_KEY`, route handler logs, and whether `user.reload()` completed. |
