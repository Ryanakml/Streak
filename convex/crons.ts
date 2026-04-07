import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "process-due-reminders",
  { minutes: 1 },
  internal.notificationsAction.processDueReminders,
  {},
);

crons.interval(
  "process-due-weekly-reviews",
  { minutes: 1 },
  internal.weeklyReviewAction.processDueWeeklyReviews,
  {},
);

crons.interval(
  "process-daily-agent-memory",
  { hours: 1 },
  internal.agentMemory.processDailySummaries,
  {},
);

export default crons;
