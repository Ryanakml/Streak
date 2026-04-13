"use node";

import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { selectMemorySnapshot } from "./agentMemory";
import {
  callModelJsonWithFallbackTrace,
  callModelTextWithFallbackTrace,
  type ModelRunTrace,
} from "./modelProvider";
const CHAT_INTENTS = [
  "check_in",
  "completed",
  "missed",
  "question",
  "excuse",
  "bonus",
  "clarify_workout",
  "log_completion",
  "log_miss",
  "reschedule_habit_time",
  "reschedule_task_time",
  "skip_habit_for_date",
  "create_task",
  "mark_task_done",
  "add_task_reminder",
  "ask_today_plan",
  "ask_tomorrow_plan",
  "risk_scan",
  "simple_reschedule_suggestion",
  "schedule_update",
  "task_update",
  "planning",
] as const;

type ChatIntent = (typeof CHAT_INTENTS)[number];
type ChatClassification =
  | "completed"
  | "missed"
  | "question"
  | "excuse"
  | "bonus"
  | "clarify_workout";

type SendMessageClassification = ChatClassification | OperationalIntent;

type WorkoutPayload = {
  exercises: Array<{
    name: string;
    sets?: number;
    reps?: number;
    weight?: number;
    duration?: number;
    distance?: number;
  }>;
  notes?: string;
};

type QuestionFocus = "general" | "pattern" | "status" | "schedule";

type ChatExtractionResult = {
  classification: ChatClassification;
  habitName: string | null;
  shouldLogCheckIn: boolean;
  checkInStatus: "completed" | "missed" | "bonus" | null;
  questionFocus: QuestionFocus;
  reason: string | null;
  conversationSummary: string | null;
  needsWorkoutClarification: boolean;
  workout: WorkoutPayload | null;
};

type MessageSnapshot = Pick<
  Doc<"messages">,
  "_id" | "role" | "content" | "intent" | "timestamp" | "habitId"
>;

type HabitPerformanceSummary = {
  habitId: Id<"habits">;
  habitName: string;
  completedLast7d: number;
  missedLast7d: number;
  bonusLast7d: number;
  completionRateLast7d: number;
  completedLast30d: number;
  missedLast30d: number;
  bonusLast30d: number;
  completionRateLast30d: number;
  currentStreak: number;
  bestStreak: number;
  lastCheckInStatus: "completed" | "missed" | "bonus" | null;
  lastCheckInDate: string | null;
  recentMissReasons: string[];
  todayReminderStatus: {
    hasAny: boolean;
    pendingTypes: Array<"pre_workout" | "check_in" | "late_follow_up">;
    sentTypes: Array<"pre_workout" | "check_in" | "late_follow_up">;
  };
};

type ResponseMode =
  | "question"
  | "completion"
  | "miss"
  | "hesitation"
  | "clarify_workout"
  | "schedule_update"
  | "task_update"
  | "planning";

type OperationalIntent =
  | "log_completion"
  | "log_miss"
  | "reschedule_habit_time"
  | "reschedule_task_time"
  | "skip_habit_for_date"
  | "create_task"
  | "mark_task_done"
  | "add_task_reminder"
  | "ask_today_plan"
  | "ask_tomorrow_plan"
  | "risk_scan"
  | "simple_reschedule_suggestion";

type RequiredAction =
  | "log_completion"
  | "log_miss"
  | "reschedule_habit_time"
  | "reschedule_task_time"
  | "skip_habit_for_date"
  | "create_task"
  | "mark_task_done"
  | "add_task_reminder"
  | "ask_today_plan"
  | "ask_tomorrow_plan"
  | "risk_scan"
  | "simple_reschedule_suggestion"
  | null;

type OperationalRoute = {
  intent: OperationalIntent | null;
  requiredAction: RequiredAction;
  targetDate: string | null;
  targetTime: string | null;
  taskTitle: string | null;
  taskId: Id<"agentTasks"> | null;
  reminderOffsetMinutes: number | null;
  resolvedHabit: Doc<"habits"> | null;
  needsClarification: boolean;
  clarificationQuestion: string | null;
  missingFields: string[];
  payload: Record<string, string | number | null>;
};

type OperationalExtractionResult = {
  intent: OperationalIntent | null;
  habitName: string | null;
  targetDate: string | null;
  targetTime: string | null;
  taskTitle: string | null;
  taskId: Id<"agentTasks"> | null;
  reminderOffsetMinutes: number | null;
  continuePendingAction: boolean;
  supersedePendingAction: boolean;
  clarificationQuestion: string | null;
};

type ChatDecision = {
  intent: ChatIntent | OperationalIntent;
  mode: ResponseMode;
  requiredAction: RequiredAction;
  resolvedHabitId: Id<"habits"> | null;
  questionFocus: QuestionFocus;
  patternSummary: HabitPerformanceSummary | null;
  requiresClarification: boolean;
  clarificationQuestion: string | null;
  pendingActionId: Id<"agentPendingActions"> | null;
  duplicateCheckIn: boolean;
  loggedStatus: "completed" | "missed" | "bonus" | null;
  shouldLogCheckIn: boolean;
  targetDate: string | null;
  targetTime: string | null;
  taskTitle: string | null;
  plannerMode:
    | "today_plan"
    | "tomorrow_plan"
    | "risk_scan"
    | "simple_reschedule_suggestion"
    | null;
};

type CheckInStatus = "completed" | "missed" | "bonus";
type ReminderRunState =
  | "scheduled"
  | "pre_reminded"
  | "user_acknowledged"
  | "user_hesitant"
  | "ignored_once"
  | "completed"
  | "missed"
  | "rescheduled"
  | "skipped";

type CheckInExecutionResult = {
  status: "executed" | "no_op";
  habitName: string;
  checkInId: Id<"checkIns">;
  workoutLogId?: Id<"workoutLogs">;
  checkInStatus: CheckInStatus;
};

type PlannerItem = {
  itemType: "habit" | "task";
  itemId: string;
  title: string;
  scheduledTime: string | null;
  deadlineTime: string | null;
  status:
    | "pending"
    | "completed"
    | "missed"
    | "bonus"
    | "skipped"
    | "rescheduled"
    | "done"
    | "cancelled";
  riskNote: string;
  conflictWith: string[];
  itemDate: string;
  timingState:
    | "completed"
    | "missed"
    | "bonus"
    | "skipped"
    | "cancelled"
    | "done"
    | "unscheduled"
    | "upcoming"
    | "due_soon"
    | "overdue"
    | "deadline_passed";
  timingNote: string | null;
  minutesUntilScheduled: number | null;
  minutesUntilDeadline: number | null;
  minutesLateFromScheduled: number | null;
  minutesLateFromDeadline: number | null;
};

type PlannerPlan = {
  date: string;
  dayKey: string;
  items: PlannerItem[];
};

type RiskScanResult = {
  startDate: string;
  items: Array<{
    itemType: "habit" | "task";
    title: string;
    date: string;
    scheduledTime: string | null;
    reason: string;
    suggestion: string;
    score: number;
  }>;
};

type RescheduleSuggestionResult = {
  date: string;
  items: Array<{
    title: string;
    currentTime: string | null;
    suggestedTime: string | null;
    reason: string;
  }>;
};

type ResolvedTurn =
  | {
      kind: "operational_clarification";
      userIntent: OperationalIntent;
      requiredAction: RequiredAction;
      route: OperationalRoute;
      resolvedHabit: Doc<"habits"> | null;
      pendingActionToCancel: Doc<"agentPendingActions"> | null;
    }
  | {
      kind: "operational_execution";
      userIntent: OperationalIntent;
      requiredAction: RequiredAction;
      route: OperationalRoute;
      resolvedHabit: Doc<"habits"> | null;
      pendingActionToCancel: Doc<"agentPendingActions"> | null;
    }
  | {
      kind: "checkin_clarification";
      userIntent: "clarify_workout";
      requiredAction: "log_completion";
      resolvedHabit: Doc<"habits">;
      checkInStatus: "completed" | "bonus";
      extraction: ChatExtractionResult;
      pendingActionToCancel: Doc<"agentPendingActions"> | null;
    }
  | {
      kind: "checkin_execution";
      userIntent: "log_completion" | "log_miss";
      requiredAction: "log_completion" | "log_miss";
      resolvedHabit: Doc<"habits">;
      checkInStatus: CheckInStatus;
      extraction: ChatExtractionResult;
      workout: WorkoutPayload | null;
      pendingActionToCancel: Doc<"agentPendingActions"> | null;
    }
  | {
      kind: "duplicate_no_op";
      userIntent: "log_completion" | "log_miss";
      requiredAction: "log_completion" | "log_miss";
      resolvedHabit: Doc<"habits">;
      checkInStatus: CheckInStatus;
      extraction: ChatExtractionResult;
      pendingActionToCancel: Doc<"agentPendingActions"> | null;
    }
  | {
      kind: "conversation_only";
      userIntent: ChatIntent;
      requiredAction: null;
      resolvedHabit: Doc<"habits"> | null;
      extraction: ChatExtractionResult;
      pendingActionToCancel: Doc<"agentPendingActions"> | null;
    };

type ChatContext = {
  user: Doc<"users">;
  date: string;
  timezone: string;
  nowTs: number;
  nowIso: string;
  nowLocalTime: string;
  nowLocalDateTime: string;
  minutesIntoDay: number;
  todayDayKey: string;
  activeHabits: Doc<"habits">[];
  todayHabits: Doc<"habits">[];
  todayHabit: Doc<"habits"> | null;
  todayCheckIns: Doc<"checkIns">[];
  recentMessages: MessageSnapshot[];
  recentCheckIns: Doc<"checkIns">[];
  recentTasks: Doc<"agentTasks">[];
  recentAgentEpisodes: Doc<"agentEpisodes">[];
  agentMemories: Doc<"agentMemory">[];
  relevantEpisodes: Array<{
    type: string;
    summary: string;
    date: string;
    habitId: Id<"habits"> | null;
  }>;
  globalMemorySummary: string | null;
  habitMemorySummary: string | null;
  habitSummaries: HabitPerformanceSummary[];
  todayReminderStatus: HabitPerformanceSummary["todayReminderStatus"] | null;
  pendingClarificationHabitId: Id<"habits"> | null;
};

function normalizeIntent(intent: string | null | undefined): ChatIntent {
  if (intent && CHAT_INTENTS.includes(intent as ChatIntent)) {
    return intent as ChatIntent;
  }
  return "check_in";
}

function coerceString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function coerceFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isDateKey(value: string | null) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function isTimeKey(value: string | null) {
  return Boolean(value && /^\d{2}:\d{2}$/.test(value));
}

function timeToMinutes(time: string) {
  const [hours, minutes] = time.split(":").map((part) => Number(part));
  return hours * 60 + minutes;
}

function minutesToTime(totalMinutes: number) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (normalized % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function shiftScheduleTimes(args: {
  scheduledTime: string;
  reminderTime: string;
  checkInDeadline: string;
  nextScheduledTime: string;
}) {
  const scheduledMinutes = timeToMinutes(args.scheduledTime);
  const reminderOffset = timeToMinutes(args.reminderTime) - scheduledMinutes;
  const deadlineOffset = timeToMinutes(args.checkInDeadline) - scheduledMinutes;
  const nextScheduledMinutes = timeToMinutes(args.nextScheduledTime);

  return {
    scheduledTime: args.nextScheduledTime,
    reminderTime: minutesToTime(nextScheduledMinutes + reminderOffset),
    checkInDeadline: minutesToTime(nextScheduledMinutes + deadlineOffset),
  };
}

function extractReminderOffsetMinutes(content: string) {
  const lowered = content.toLowerCase();
  const minuteMatch = lowered.match(/(\d+)\s*(menit|minute|minutes|min|m)\b/);
  if (minuteMatch) {
    return Math.max(0, Number(minuteMatch[1]));
  }

  if (
    lowered.includes("setengah jam") ||
    lowered.includes("half hour") ||
    lowered.includes("30 menit")
  ) {
    return 30;
  }

  return null;
}

function formatDuration(totalMinutes: number) {
  const safeMinutes = Math.max(0, totalMinutes);
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;

  if (hours === 0) {
    return `${minutes}m`;
  }

  if (minutes === 0) {
    return `${hours}j`;
  }

  return `${hours}j ${minutes}m`;
}

const INDONESIAN_NUMBER_WORDS: Record<string, number> = {
  nol: 0,
  satu: 1,
  dua: 2,
  tiga: 3,
  empat: 4,
  lima: 5,
  enam: 6,
  tujuh: 7,
  delapan: 8,
  sembilan: 9,
  sepuluh: 10,
  sebelas: 11,
  dua_belas: 12,
};

const TASK_COMPLETION_PHRASES = [
  "already",
  "done",
  "beres",
  "selesai",
  "kelar",
  "sudah",
  "udah",
  "just woke up",
  "just wake up",
  "woke up",
  "waking up",
  "baru bangun",
  "udah bangun",
  "sudah bangun",
  "bangun",
] as const;

const TASK_NEGATION_PHRASES = [
  "not doing",
  "not yet",
  "belum",
  "ga jadi",
  "gak jadi",
  "nggak jadi",
  "tidak jadi",
  "bukan",
  "dont",
  "don't",
  "not done",
  "belum selesai",
  "belum beres",
] as const;

function normalizeLooseText(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseLooseNumber(value: string) {
  const normalized = normalizeLooseText(value).replace(/\s+/g, "_");
  if (/^\d+$/.test(normalized)) {
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return INDONESIAN_NUMBER_WORDS[normalized] ?? null;
}

function parseClockHourWithPeriod(args: {
  hour: number;
  minute: number;
  period: string | null;
}) {
  if (args.hour < 0 || args.hour > 24 || args.minute < 0 || args.minute > 59) {
    return null;
  }

  let hours = args.hour % 24;
  const period = args.period?.toLowerCase() ?? null;
  if (period === "pagi") {
    if (hours === 12) {
      hours = 0;
    }
  } else if (period === "siang") {
    if (hours >= 1 && hours <= 11) {
      hours += 12;
    }
  } else if (period === "sore") {
    if (hours >= 1 && hours <= 6) {
      hours += 12;
    }
  } else if (period === "malam") {
    if (hours >= 1 && hours <= 11) {
      hours += 12;
    }
    if (hours === 12) {
      hours = 0;
    }
  }

  return `${hours.toString().padStart(2, "0")}:${args.minute
    .toString()
    .padStart(2, "0")}`;
}

function parseDeterministicTime(content: string) {
  const lowered = content.toLowerCase().replace(/\s+/g, " ").trim();
  const halfMatch = lowered.match(/\b(?:jam\s+)?setengah\s+([a-z0-9]+)\b/);
  if (halfMatch) {
    const rawHour = parseLooseNumber(halfMatch[1]);
    if (rawHour != null) {
      const adjustedHour = (rawHour + 23) % 24;
      return `${adjustedHour.toString().padStart(2, "0")}:30`;
    }
  }

  const jamMatch = lowered.match(
    /\bjam\s+(\d{1,2})(?:[:.](\d{1,2}))?\s*(pagi|siang|sore|malam)?\b/,
  );
  if (jamMatch) {
    const hour = Number(jamMatch[1]);
    const minute = jamMatch[2] ? Number(jamMatch[2]) : 0;
    return parseClockHourWithPeriod({
      hour,
      minute,
      period: jamMatch[3] ?? null,
    });
  }

  const englishMatch = lowered.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (englishMatch) {
    let hour = Number(englishMatch[1]);
    const minute = englishMatch[2] ? Number(englishMatch[2]) : 0;
    const period = englishMatch[3];
    if (period === "pm" && hour < 12) {
      hour += 12;
    }
    if (period === "am" && hour === 12) {
      hour = 0;
    }
    return `${hour.toString().padStart(2, "0")}:${minute
      .toString()
      .padStart(2, "0")}`;
  }

  return null;
}

function parseAmbiguousHourWithoutPeriod(content: string) {
  const lowered = content.toLowerCase().replace(/\s+/g, " ").trim();
  const match = lowered.match(
    /\bjam\s+(\d{1,2})(?:[:.](\d{1,2}))?(?!\s*(pagi|siang|sore|malam))\b/,
  );
  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }

  if (hour < 1 || hour > 11 || minute < 0 || minute > 59) {
    return null;
  }

  return {
    hour,
    minute,
  };
}

function inferDeterministicDate(content: string, context: ChatContext) {
  const lowered = normalizeLooseText(content);
  const currentHour = Number.parseInt(context.nowLocalTime.slice(0, 2), 10);

  if (
    lowered.includes("hari ini") ||
    lowered.includes("today") ||
    lowered.includes("malam ini") ||
    lowered.includes("pagi ini") ||
    lowered.includes("siang ini") ||
    lowered.includes("sore ini") ||
    lowered.includes("tonight")
  ) {
    return context.date;
  }

  if (lowered.includes("besok") || lowered.includes("tomorrow")) {
    return shiftDateKey(context.date, 1);
  }

  if (lowered.includes("nanti pagi")) {
    return currentHour < 12 ? context.date : shiftDateKey(context.date, 1);
  }

  if (lowered.includes("nanti siang")) {
    return currentHour < 15 ? context.date : shiftDateKey(context.date, 1);
  }

  if (lowered.includes("nanti sore")) {
    return currentHour < 18 ? context.date : shiftDateKey(context.date, 1);
  }

  if (lowered.includes("nanti malam")) {
    return context.date;
  }

  return null;
}

function hasDeterministicTimeCue(content: string) {
  const lowered = content.toLowerCase();
  return (
    lowered.includes("setengah") ||
    /\bjam\s+\d{1,2}/i.test(content) ||
    /\b\d{1,2}(:|\.)\d{2}\b/.test(content) ||
    /\b\d{1,2}\s*(am|pm)\b/i.test(content)
  );
}

function hasFutureSchedulingCue(content: string) {
  const lowered = normalizeLooseText(content);
  return (
    lowered.includes("nanti") ||
    lowered.includes("ntar") ||
    lowered.includes("later") ||
    lowered.includes("besok") ||
    lowered.includes("tomorrow")
  );
}

function resolveNextOccurrenceTime(args: {
  content: string;
  context: ChatContext;
  parsedTargetTime: string | null;
  parsedTargetDate: string | null;
}) {
  if (!args.parsedTargetTime) {
    return {
      targetTime: args.parsedTargetTime,
      targetDate: args.parsedTargetDate,
    };
  }

  const ambiguousHour = parseAmbiguousHourWithoutPeriod(args.content);
  if (!ambiguousHour || !hasFutureSchedulingCue(args.content)) {
    return {
      targetTime: args.parsedTargetTime,
      targetDate: args.parsedTargetDate,
    };
  }

  const explicitFutureDate =
    args.parsedTargetDate != null && args.parsedTargetDate !== args.context.date;
  if (explicitFutureDate) {
    return {
      targetTime: args.parsedTargetTime,
      targetDate: args.parsedTargetDate,
    };
  }

  const parsedMinutes = timeToMinutes(args.parsedTargetTime);
  if (parsedMinutes > args.context.minutesIntoDay) {
    return {
      targetTime: args.parsedTargetTime,
      targetDate: args.parsedTargetDate,
    };
  }

  const plusTwelveMinutes = parsedMinutes + 12 * 60;
  if (plusTwelveMinutes < 1440 && plusTwelveMinutes > args.context.minutesIntoDay) {
    return {
      targetTime: minutesToTime(plusTwelveMinutes),
      targetDate: args.parsedTargetDate ?? args.context.date,
    };
  }

  return {
    targetTime: args.parsedTargetTime,
    targetDate: args.parsedTargetDate ?? shiftDateKey(args.context.date, 1),
  };
}

function tokenizeTaskText(text: string) {
  return normalizeLooseText(text)
    .split(" ")
    .filter(
      (token) =>
        token.length >= 3 &&
        ![
          "task",
          "baru",
          "nanti",
          "hari",
          "today",
          "besok",
          "pagi",
          "siang",
          "sore",
          "malam",
        ].includes(token),
    );
}

function getTaskSemanticAliases(title: string) {
  const normalizedTitle = normalizeLooseText(title);
  const aliases = [normalizedTitle];

  if (normalizedTitle.includes("bangun") || normalizedTitle.includes("wake up")) {
    aliases.push(
      "waking up",
      "wake up",
      "woke up",
      "just wake up",
      "just woke up",
      "bangun",
      "baru bangun",
      "udah bangun",
      "sudah bangun",
    );
  }

  return aliases;
}

function isTaskCompletionLikeMessage(content: string) {
  const normalized = normalizeLooseText(content);
  const hasCompletionSignal = TASK_COMPLETION_PHRASES.some((phrase) =>
    normalized.includes(phrase),
  );
  const hasNegation = TASK_NEGATION_PHRASES.some((phrase) =>
    normalized.includes(phrase),
  );

  return hasCompletionSignal && !hasNegation;
}

function matchTaskFromRecentContext(args: {
  content: string;
  tasks: Doc<"agentTasks">[];
}) {
  const normalizedContent = normalizeLooseText(args.content);
  const contentTokens = tokenizeTaskText(args.content);
  let bestMatch: Doc<"agentTasks"> | null = null;
  let bestScore = 0;

  for (const task of args.tasks) {
    const aliases = getTaskSemanticAliases(task.title);
    const aliasMatch = aliases.find((alias) => normalizedContent.includes(alias));
    let score = aliasMatch ? aliasMatch.length + 10 : 0;

    const taskTokens = tokenizeTaskText(task.title);
    if (taskTokens.length > 0) {
      const overlap = taskTokens.filter((token) => contentTokens.includes(token));
      if (overlap.length === taskTokens.length) {
        score += overlap.length * 5;
      } else if (overlap.length > 0) {
        score += overlap.length * 2;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestMatch = task;
    }
  }

  return bestScore >= 10 ? bestMatch : null;
}

function applyDeterministicTaskChatGuard(args: {
  content: string;
  extraction: ChatExtractionResult;
  context: ChatContext;
}) {
  const matchedTask = matchTaskFromRecentContext({
    content: args.content,
    tasks: args.context.recentTasks,
  });
  if (!matchedTask || !isTaskCompletionLikeMessage(args.content)) {
    return args.extraction;
  }

  return {
    ...args.extraction,
    classification: "question" as const,
    habitName: null,
    shouldLogCheckIn: false,
    checkInStatus: null,
    questionFocus: "status" as const,
    needsWorkoutClarification: false,
    workout: null,
  };
}

function isHabitScheduledOnDay(habit: Doc<"habits"> | null, dayKey: string) {
  return Boolean(habit && habit.targetDays.includes(dayKey));
}

function getHabitScheduleForDay(habit: Doc<"habits">) {
  return {
    scheduledTime: habit.scheduledTime,
    reminderTime: habit.reminderTime,
    checkInDeadline: habit.checkInDeadline,
  };
}

function getRescheduledTimeFromRecentEpisodes(args: {
  episodes: Doc<"agentEpisodes">[];
  habitId: Id<"habits">;
  date: string;
  scheduleBaseline: number;
}) {
  for (const episode of args.episodes) {
    if (episode.type !== "schedule_changed") {
      continue;
    }
    if (episode.habitId !== args.habitId) {
      continue;
    }
    const episodeTs = episode.createdAt ?? episode._creationTime;
    if (episodeTs < args.scheduleBaseline) {
      continue;
    }
    const metadata =
      episode.metadata && typeof episode.metadata === "object"
        ? (episode.metadata as Record<string, unknown>)
        : null;
    const targetDate =
      metadata && typeof metadata.targetDate === "string"
        ? metadata.targetDate
        : null;
    const targetTime =
      metadata && typeof metadata.targetTime === "string"
        ? metadata.targetTime
        : null;
    if (targetDate === args.date && isTimeKey(targetTime)) {
      return targetTime;
    }
  }

  return null;
}

function summarizeCurrentTimeContext(context: ChatContext) {
  return {
    timezone: context.timezone,
    todayDate: context.date,
    nowTs: context.nowTs,
    nowIso: context.nowIso,
    nowLocalTime: context.nowLocalTime,
    nowLocalDateTime: context.nowLocalDateTime,
    minutesIntoDay: context.minutesIntoDay,
  };
}

function buildHabitTimeContext(
  context: ChatContext,
  habit: Doc<"habits"> | null,
) {
  if (!habit) {
    return null;
  }

  const baseSchedule = getHabitScheduleForDay(habit);
  const rescheduledTime = getRescheduledTimeFromRecentEpisodes({
    episodes: context.recentAgentEpisodes,
    habitId: habit._id,
    date: context.date,
    scheduleBaseline: habit.scheduleUpdatedAt ?? 0,
  });
  const schedule =
    rescheduledTime && isTimeKey(rescheduledTime)
      ? shiftScheduleTimes({
          scheduledTime: baseSchedule.scheduledTime,
          reminderTime: baseSchedule.reminderTime,
          checkInDeadline: baseSchedule.checkInDeadline,
          nextScheduledTime: rescheduledTime,
        })
      : baseSchedule;
  const existingCheckIn =
    context.todayCheckIns.find((entry) => entry.habitId === habit._id) ?? null;
  const scheduledToday = habit.targetDays.includes(context.todayDayKey);

  if (existingCheckIn) {
    return {
      scheduledToday,
      scheduledTime: schedule.scheduledTime,
      checkInDeadline: schedule.checkInDeadline,
      state: existingCheckIn.status,
      timingNote:
        existingCheckIn.status === "completed"
          ? "sudah selesai hari ini"
          : existingCheckIn.status === "bonus"
            ? "bonus sudah masuk hari ini"
            : "sudah miss hari ini",
      minutesUntilScheduled: null,
      minutesUntilDeadline: null,
      minutesLateFromScheduled: null,
      minutesLateFromDeadline: null,
    };
  }

  if (!scheduledToday) {
    return {
      scheduledToday: false,
      scheduledTime: schedule.scheduledTime,
      checkInDeadline: schedule.checkInDeadline,
      state: "not_scheduled_today" as const,
      timingNote: "ga terjadwal buat hari ini",
      minutesUntilScheduled: null,
      minutesUntilDeadline: null,
      minutesLateFromScheduled: null,
      minutesLateFromDeadline: null,
    };
  }

  const scheduledMinutes = timeToMinutes(schedule.scheduledTime);
  const deadlineMinutes = timeToMinutes(schedule.checkInDeadline);
  const minutesUntilScheduled = scheduledMinutes - context.minutesIntoDay;
  const minutesUntilDeadline = deadlineMinutes - context.minutesIntoDay;
  const minutesLateFromScheduled =
    minutesUntilScheduled < 0 ? Math.abs(minutesUntilScheduled) : null;
  const minutesLateFromDeadline =
    minutesUntilDeadline < 0 ? Math.abs(minutesUntilDeadline) : null;

  if (minutesUntilScheduled > 0) {
    return {
      scheduledToday: true,
      scheduledTime: schedule.scheduledTime,
      checkInDeadline: schedule.checkInDeadline,
      state:
        minutesUntilScheduled <= 60
          ? ("due_soon" as const)
          : ("upcoming" as const),
      timingNote: `mulai ${formatDuration(minutesUntilScheduled)} lagi`,
      minutesUntilScheduled,
      minutesUntilDeadline,
      minutesLateFromScheduled,
      minutesLateFromDeadline,
    };
  }

  if (minutesUntilDeadline < 0) {
    return {
      scheduledToday: true,
      scheduledTime: schedule.scheduledTime,
      checkInDeadline: schedule.checkInDeadline,
      state: "deadline_passed" as const,
      timingNote: `deadline ${schedule.checkInDeadline} sudah lewat ${formatDuration(
        Math.abs(minutesUntilDeadline),
      )}`,
      minutesUntilScheduled,
      minutesUntilDeadline,
      minutesLateFromScheduled,
      minutesLateFromDeadline,
    };
  }

  return {
    scheduledToday: true,
    scheduledTime: schedule.scheduledTime,
    checkInDeadline: schedule.checkInDeadline,
    state: "overdue" as const,
    timingNote: `sudah lewat ${formatDuration(
      Math.abs(minutesUntilScheduled),
    )} dari jam ${schedule.scheduledTime}, deadline ${formatDuration(
      minutesUntilDeadline,
    )} lagi`,
    minutesUntilScheduled,
    minutesUntilDeadline,
    minutesLateFromScheduled,
    minutesLateFromDeadline,
  };
}

function hasWorkoutMetrics(exercise: WorkoutPayload["exercises"][number]) {
  return (
    typeof exercise.sets === "number" ||
    typeof exercise.reps === "number" ||
    typeof exercise.weight === "number" ||
    typeof exercise.duration === "number" ||
    typeof exercise.distance === "number"
  );
}

function summarizeHabit(habit: Doc<"habits">) {
  return {
    id: habit._id,
    name: habit.name,
    targetDays: habit.targetDays,
    scheduledTime: habit.scheduledTime,
    reminderTime: habit.reminderTime,
    checkInDeadline: habit.checkInDeadline,
    rules: habit.rules,
    motivation: habit.motivation,
    currentStreak: habit.currentStreak,
    bestStreak: habit.bestStreak,
    isActive: habit.isActive,
  };
}

function summarizeCheckIn(checkIn: Doc<"checkIns">) {
  return {
    habitId: checkIn.habitId,
    date: checkIn.date,
    status: checkIn.status,
    source: checkIn.source,
    userReason: checkIn.userReason ?? null,
    conversationSummary: checkIn.conversationSummary ?? null,
    timestamp: checkIn.timestamp,
  };
}

function summarizePatternSummary(summary: HabitPerformanceSummary | null) {
  if (!summary) {
    return null;
  }

  return {
    habitName: summary.habitName,
    completedLast7d: summary.completedLast7d,
    missedLast7d: summary.missedLast7d,
    bonusLast7d: summary.bonusLast7d,
    completionRateLast7d: summary.completionRateLast7d,
    completedLast30d: summary.completedLast30d,
    missedLast30d: summary.missedLast30d,
    bonusLast30d: summary.bonusLast30d,
    completionRateLast30d: summary.completionRateLast30d,
    currentStreak: summary.currentStreak,
    bestStreak: summary.bestStreak,
    lastCheckInStatus: summary.lastCheckInStatus,
    lastCheckInDate: summary.lastCheckInDate,
    recentMissReasons: summary.recentMissReasons,
    todayReminderStatus: summary.todayReminderStatus,
  };
}

function summarizeStatSignal(summary: HabitPerformanceSummary | null) {
  if (!summary) {
    return null;
  }

  if (summary.missedLast7d >= 3) {
    return `${summary.habitName} missed ${summary.missedLast7d} times in the last 7 days.`;
  }

  if (summary.completedLast7d >= 4) {
    return `${summary.habitName} was completed ${summary.completedLast7d} times in the last 7 days.`;
  }

  if (summary.currentStreak >= 3) {
    return `${summary.habitName} is on a ${summary.currentStreak}-day streak.`;
  }

  if (summary.lastCheckInStatus && summary.lastCheckInDate) {
    return `The latest ${summary.habitName} result was ${summary.lastCheckInStatus} on ${summary.lastCheckInDate}.`;
  }

  return null;
}

function buildScheduleFactSignal(args: {
  decision: ChatDecision;
  context: ChatContext;
  resolvedHabit: Doc<"habits"> | null;
  resolvedHabitTimeContext: ReturnType<typeof buildHabitTimeContext>;
  todayHabit: Doc<"habits"> | null;
  todayHabitTimeContext: ReturnType<typeof buildHabitTimeContext>;
}) {
  if (args.decision.mode !== "question") {
    return null;
  }

  if (args.decision.questionFocus !== "schedule") {
    return null;
  }

  const targetHabit = args.resolvedHabit ?? args.todayHabit;
  const targetTiming =
    args.resolvedHabitTimeContext ?? args.todayHabitTimeContext;
  if (!targetHabit || !targetTiming) {
    return null;
  }

  if (
    !targetTiming.scheduledToday ||
    targetTiming.state === "not_scheduled_today"
  ) {
    return `${targetHabit.name} tidak terjadwal hari ini.`;
  }

  const reminderStatus = getHabitReminderStatus(args.context, targetHabit._id);
  const pendingLabel =
    reminderStatus && reminderStatus.pendingTypes.length > 0
      ? reminderStatus.pendingTypes.join(",")
      : "none";
  const sentLabel =
    reminderStatus && reminderStatus.sentTypes.length > 0
      ? reminderStatus.sentTypes.join(",")
      : "none";

  return `${targetHabit.name} jadwal ${targetTiming.scheduledTime}, deadline ${targetTiming.checkInDeadline}, reminder pending ${pendingLabel}, sent ${sentLabel}.`;
}

function getPrimaryQuestionSignal(args: {
  decision: ChatDecision;
  context: ChatContext;
  scheduleFactSignal: string | null;
}) {
  if (args.decision.mode !== "question") {
    return null;
  }

  if (args.decision.questionFocus === "schedule") {
    return args.scheduleFactSignal;
  }

  if (args.decision.questionFocus === "pattern") {
    return (
      args.context.habitMemorySummary ||
      args.context.relevantEpisodes[0]?.summary ||
      args.context.globalMemorySummary ||
      summarizeStatSignal(args.decision.patternSummary)
    );
  }

  if (args.decision.questionFocus === "status") {
    return (
      summarizeStatSignal(args.decision.patternSummary) ||
      args.context.habitMemorySummary ||
      args.context.relevantEpisodes[0]?.summary
    );
  }

  return (
    args.context.habitMemorySummary ||
    summarizeStatSignal(args.decision.patternSummary) ||
    args.context.relevantEpisodes[0]?.summary ||
    null
  );
}

function getStrongestEpisodeSignal(context: ChatContext) {
  const priorityOrder = [
    "reminder_ignored",
    "miss_with_reason",
    "recovered_after_prompt",
    "user_acknowledged",
    "hesitation_detected",
    "schedule_changed",
    "habit_skipped",
    "completed_with_effort",
  ];

  for (const type of priorityOrder) {
    const match = context.relevantEpisodes.find((entry) => entry.type === type);
    if (match?.summary) {
      return match.summary;
    }
  }

  return context.relevantEpisodes[0]?.summary ?? null;
}

function getSupportingQuestionSignal(args: {
  decision: ChatDecision;
  context: ChatContext;
}) {
  if (args.decision.mode !== "question") {
    return null;
  }

  if (args.decision.questionFocus === "schedule") {
    return null;
  }

  const statSignal = summarizeStatSignal(args.decision.patternSummary);
  const episodeSignal = getStrongestEpisodeSignal(args.context);
  const memorySignal =
    args.context.habitMemorySummary ?? args.context.globalMemorySummary;

  if (args.decision.questionFocus === "pattern") {
    return episodeSignal && episodeSignal !== memorySignal
      ? episodeSignal
      : statSignal;
  }

  return memorySignal && memorySignal !== statSignal
    ? memorySignal
    : episodeSignal;
}

function getHabitReminderStatus(
  context: ChatContext,
  habitId: Id<"habits"> | null,
) {
  if (!habitId) {
    return null;
  }

  return (
    context.habitSummaries.find((summary) => summary.habitId === habitId)
      ?.todayReminderStatus ?? null
  );
}

function buildEffectiveMemoryContext(
  context: ChatContext,
  habit: Doc<"habits"> | null,
): ChatContext {
  const snapshot = selectMemorySnapshot({
    memories: context.agentMemories,
    episodes: context.recentAgentEpisodes,
    habitId: habit?._id ?? null,
  });

  return {
    ...context,
    relevantEpisodes: snapshot.relevantEpisodes,
    globalMemorySummary: snapshot.globalSummary,
    habitMemorySummary: snapshot.habitSummary,
    todayReminderStatus:
      getHabitReminderStatus(context, habit?._id ?? null) ??
      context.todayReminderStatus,
  };
}

function getOperationalReturnClassification(
  resolvedTurn: Extract<
    ResolvedTurn,
    { kind: "operational_execution" | "operational_clarification" }
  >,
): SendMessageClassification {
  return resolvedTurn.userIntent;
}

function getResolvedReturnMode(args: {
  resolvedTurn: ResolvedTurn;
  decision?: ChatDecision | null;
}): ResponseMode {
  if (
    args.resolvedTurn.kind === "operational_execution" ||
    args.resolvedTurn.kind === "operational_clarification"
  ) {
    if (
      args.resolvedTurn.requiredAction === "create_task" ||
      args.resolvedTurn.requiredAction === "reschedule_task_time" ||
      args.resolvedTurn.requiredAction === "mark_task_done" ||
      args.resolvedTurn.requiredAction === "add_task_reminder"
    ) {
      return "task_update";
    }

    if (
      args.resolvedTurn.requiredAction === "ask_today_plan" ||
      args.resolvedTurn.requiredAction === "ask_tomorrow_plan" ||
      args.resolvedTurn.requiredAction === "risk_scan" ||
      args.resolvedTurn.requiredAction === "simple_reschedule_suggestion"
    ) {
      return "planning";
    }

    return "schedule_update";
  }

  if (args.resolvedTurn.kind === "checkin_clarification") {
    return "clarify_workout";
  }

  if (args.resolvedTurn.kind === "checkin_execution") {
    if (args.resolvedTurn.requiredAction === "log_miss") {
      return "miss";
    }
    return "completion";
  }

  if (args.resolvedTurn.kind === "duplicate_no_op") {
    return args.resolvedTurn.requiredAction === "log_miss"
      ? "miss"
      : "completion";
  }

  return args.decision?.mode ?? "question";
}

function buildReminderRunResponseSummary(args: {
  content: string;
  extraction: ChatExtractionResult;
}) {
  const summary =
    args.extraction.conversationSummary?.trim() ||
    args.extraction.reason?.trim() ||
    args.content.trim();

  return summary.slice(0, 240);
}

function shouldAdvanceConversationReminderRun(args: {
  context: ChatContext;
  habit: Doc<"habits"> | null;
  extraction: ChatExtractionResult;
}) {
  if (!args.habit) {
    return false;
  }

  if (!isHabitScheduledOnDay(args.habit, args.context.todayDayKey)) {
    return false;
  }

  const reminderStatus = getHabitReminderStatus(args.context, args.habit._id);
  if (!reminderStatus?.hasAny) {
    return false;
  }

  if (args.extraction.habitName) {
    return true;
  }

  if (args.context.pendingClarificationHabitId === args.habit._id) {
    return true;
  }

  if (args.context.todayHabits.length !== 1) {
    return false;
  }

  if (args.extraction.classification === "excuse") {
    return true;
  }

  if (args.extraction.classification === "question") {
    return Boolean(reminderStatus.sentTypes.length);
  }

  return false;
}

function buildReminderRunChatAdvance(args: {
  resolvedTurn: ResolvedTurn;
  context: ChatContext;
  resolvedHabit: Doc<"habits"> | null;
  extraction: ChatExtractionResult;
  content: string;
}) {
  const responseSummary = buildReminderRunResponseSummary({
    content: args.content,
    extraction: args.extraction,
  });

  if (
    args.resolvedTurn.kind === "operational_execution" &&
    args.resolvedTurn.resolvedHabit &&
    args.resolvedTurn.requiredAction === "reschedule_habit_time" &&
    args.resolvedTurn.route.targetDate
  ) {
    return {
      habitId: args.resolvedTurn.resolvedHabit._id,
      date: args.resolvedTurn.route.targetDate,
      state: "rescheduled" as ReminderRunState,
      responseIntent: args.resolvedTurn.userIntent,
      responseSummary,
    };
  }

  if (
    args.resolvedTurn.kind === "operational_execution" &&
    args.resolvedTurn.resolvedHabit &&
    args.resolvedTurn.requiredAction === "skip_habit_for_date" &&
    args.resolvedTurn.route.targetDate
  ) {
    return {
      habitId: args.resolvedTurn.resolvedHabit._id,
      date: args.resolvedTurn.route.targetDate,
      state: "skipped" as ReminderRunState,
      responseIntent: args.resolvedTurn.userIntent,
      responseSummary,
    };
  }

  if (
    (args.resolvedTurn.kind === "checkin_execution" ||
      args.resolvedTurn.kind === "duplicate_no_op") &&
    args.resolvedTurn.resolvedHabit
  ) {
    return {
      habitId: args.resolvedTurn.resolvedHabit._id,
      date: args.context.date,
      state:
        args.resolvedTurn.checkInStatus === "missed"
          ? ("missed" as ReminderRunState)
          : ("completed" as ReminderRunState),
      responseIntent: args.resolvedTurn.userIntent,
      responseSummary,
    };
  }

  if (
    args.resolvedTurn.kind === "conversation_only" &&
    shouldAdvanceConversationReminderRun({
      context: args.context,
      habit: args.resolvedHabit,
      extraction: args.extraction,
    })
  ) {
    if (args.extraction.classification === "excuse") {
      return {
        habitId: args.resolvedHabit!._id,
        date: args.context.date,
        state: "user_hesitant" as ReminderRunState,
        responseIntent: args.resolvedTurn.userIntent,
        responseSummary,
      };
    }

    if (args.extraction.classification === "question") {
      return {
        habitId: args.resolvedHabit!._id,
        date: args.context.date,
        state: "user_acknowledged" as ReminderRunState,
        responseIntent: args.resolvedTurn.userIntent,
        responseSummary,
      };
    }
  }

  return null;
}

function shiftDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function buildOperationalClarificationQuestion(
  actionType: RequiredAction,
  missingFields: string[],
) {
  if (missingFields.length === 0) {
    return null;
  }

  if (actionType === "reschedule_habit_time") {
    if (
      missingFields.includes("habit") &&
      missingFields.includes("date") &&
      missingFields.includes("time")
    ) {
      return "Habit apa yang mau digeser, untuk tanggal kapan, dan jam berapa?";
    }
    if (missingFields.includes("habit") && missingFields.includes("date")) {
      return "Habit apa yang mau digeser, dan untuk tanggal kapan?";
    }
    if (missingFields.includes("habit") && missingFields.includes("time")) {
      return "Habit apa yang mau digeser, dan mau dipindah ke jam berapa?";
    }
    if (missingFields.includes("date") && missingFields.includes("time")) {
      return "Untuk tanggal kapan, dan mau dipindah ke jam berapa?";
    }
    if (missingFields.includes("habit")) {
      return "Habit yang mau digeser yang mana?";
    }
    if (missingFields.includes("date")) {
      return "Untuk tanggal kapan?";
    }
    if (missingFields.includes("time")) {
      return "Mau dipindah ke jam berapa?";
    }
  }

  if (actionType === "skip_habit_for_date") {
    if (missingFields.includes("habit") && missingFields.includes("date")) {
      return "Habit apa yang mau di-skip, dan tanggal berapa?";
    }
    if (missingFields.includes("habit")) {
      return "Habit yang mau di-skip yang mana?";
    }
    if (missingFields.includes("date")) {
      return "Mau di-skip untuk tanggal kapan?";
    }
  }

  if (actionType === "create_task") {
    if (missingFields.includes("title") && missingFields.includes("date")) {
      return "Task apa yang mau ditambah, dan untuk kapan?";
    }
    if (missingFields.includes("title")) {
      return "Task apa yang mau ditambah?";
    }
    if (missingFields.includes("date")) {
      return "Task itu buat kapan?";
    }
  }

  return "Bikin jelas dulu.";
}

function getOperationalTargetType(actionType: string | null | undefined) {
  if (
    actionType === "ask_today_plan" ||
    actionType === "ask_tomorrow_plan" ||
    actionType === "risk_scan" ||
    actionType === "simple_reschedule_suggestion"
  ) {
    return "plan";
  }

  if (
    actionType === "create_task" ||
    actionType === "reschedule_task_time" ||
    actionType === "mark_task_done" ||
    actionType === "add_task_reminder"
  ) {
    return "task";
  }

  return "habit";
}

function normalizeWorkout(value: unknown): WorkoutPayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as {
    exercises?: unknown;
    notes?: unknown;
  };

  if (!Array.isArray(candidate.exercises)) {
    return null;
  }

  const exercises = candidate.exercises
    .map((exercise) => {
      if (!exercise || typeof exercise !== "object") {
        return null;
      }

      const raw = exercise as Record<string, unknown>;
      const name = coerceString(raw.name);
      if (!name) {
        return null;
      }

      const nextExercise: WorkoutPayload["exercises"][number] = { name };
      for (const key of [
        "sets",
        "reps",
        "weight",
        "duration",
        "distance",
      ] as const) {
        const value = raw[key];
        if (typeof value === "number" && Number.isFinite(value)) {
          nextExercise[key] = value;
        }
      }
      return nextExercise;
    })
    .filter((exercise): exercise is WorkoutPayload["exercises"][number] =>
      Boolean(exercise),
    );

  if (
    exercises.length === 0 ||
    !exercises.some((exercise) => hasWorkoutMetrics(exercise))
  ) {
    return null;
  }

  const notes = coerceString(candidate.notes);
  return {
    exercises,
    notes: notes || undefined,
  };
}

function normalizeMetricNumber(value: string) {
  const normalized = value.replace(",", ".").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractDeterministicWorkout(content: string): WorkoutPayload | null {
  const raw = content.trim();
  if (!raw) {
    return null;
  }

  const normalized = raw.toLowerCase();
  const genericOnly = [
    "leg",
    "legs",
    "upper body",
    "lower body",
    "cardio",
    "gym",
    "workout",
    "exercise",
    "latihan",
    "olahraga",
  ];
  if (genericOnly.includes(normalized)) {
    return null;
  }

  let sets: number | undefined;
  let reps: number | undefined;
  let duration: number | undefined;
  let distance: number | undefined;
  let weight: number | undefined;
  let firstMetricIndex = raw.length;

  const markFirstIndex = (matchIndex: number) => {
    if (matchIndex >= 0) {
      firstMetricIndex = Math.min(firstMetricIndex, matchIndex);
    }
  };

  const setsMatch = raw.match(/(\d+)\s*(set|sets)\b/i);
  if (setsMatch) {
    sets = Number(setsMatch[1]);
    markFirstIndex(setsMatch.index ?? raw.length);
  }

  const repsMatch = raw.match(/(\d+)\s*(rep|reps)\b/i);
  if (repsMatch) {
    reps = Number(repsMatch[1]);
    markFirstIndex(repsMatch.index ?? raw.length);
  }

  const compactSetRepMatch = raw.match(/(\d+)\s*x\s*(\d+)/i);
  if (compactSetRepMatch) {
    sets ??= Number(compactSetRepMatch[1]);
    reps ??= Number(compactSetRepMatch[2]);
    markFirstIndex(compactSetRepMatch.index ?? raw.length);
  }

  const durationMatch = raw.match(
    /(\d+(?:[.,]\d+)?)\s*(min|mins|minute|minutes|menit)\b/i,
  );
  if (durationMatch) {
    const parsed = normalizeMetricNumber(durationMatch[1]);
    if (parsed != null) {
      duration = parsed;
      markFirstIndex(durationMatch.index ?? raw.length);
    }
  }

  const distanceMatch = raw.match(/(\d+(?:[.,]\d+)?)\s*(km|kilometer|m)\b/i);
  if (distanceMatch) {
    const parsed = normalizeMetricNumber(distanceMatch[1]);
    if (parsed != null) {
      distance =
        distanceMatch[2].toLowerCase() === "m" ? parsed : parsed * 1000;
      markFirstIndex(distanceMatch.index ?? raw.length);
    }
  }

  const weightMatch = raw.match(/(\d+(?:[.,]\d+)?)\s*(kg|kgs)\b/i);
  if (weightMatch) {
    const parsed = normalizeMetricNumber(weightMatch[1]);
    if (parsed != null) {
      weight = parsed;
      markFirstIndex(weightMatch.index ?? raw.length);
    }
  }

  if (
    sets == null &&
    reps == null &&
    duration == null &&
    distance == null &&
    weight == null
  ) {
    return null;
  }

  let name = raw.slice(0, firstMetricIndex).trim();
  if (!name) {
    name = raw.trim();
  }
  name = name
    .replace(/[-,:]+$/g, "")
    .replace(/\b(today|hari ini|gue|saya|aku|done|udah|beres)\b/gi, "")
    .trim();

  if (!name) {
    return null;
  }

  const normalizedName = name.toLowerCase();
  if (genericOnly.includes(normalizedName)) {
    return null;
  }

  const exercise: WorkoutPayload["exercises"][number] = { name };
  if (sets != null) exercise.sets = sets;
  if (reps != null) exercise.reps = reps;
  if (duration != null) exercise.duration = duration;
  if (distance != null) exercise.distance = distance;
  if (weight != null) exercise.weight = weight;

  return {
    exercises: [exercise],
  };
}

function applyDeterministicWorkoutResolution(args: {
  content: string;
  extraction: ChatExtractionResult;
  pendingWorkoutHabit: Doc<"habits"> | null;
}) {
  const deterministicWorkout =
    args.extraction.workout ?? extractDeterministicWorkout(args.content);

  if (args.pendingWorkoutHabit) {
    if (
      args.extraction.classification !== "question" &&
      args.extraction.classification !== "missed"
    ) {
      return {
        ...args.extraction,
        classification: "clarify_workout" as const,
        habitName: args.pendingWorkoutHabit.name,
        shouldLogCheckIn: Boolean(deterministicWorkout),
        checkInStatus: null,
        needsWorkoutClarification: !deterministicWorkout,
        workout: deterministicWorkout,
      };
    }
  }

  if (
    (args.extraction.classification === "completed" ||
      args.extraction.classification === "bonus" ||
      args.extraction.classification === "clarify_workout") &&
    deterministicWorkout
  ) {
    return {
      ...args.extraction,
      shouldLogCheckIn: true,
      needsWorkoutClarification: false,
      workout: deterministicWorkout,
    };
  }

  return {
    ...args.extraction,
    workout: deterministicWorkout,
  };
}

function inferMissHesitationFromContent(content: string) {
  const lowered = content.toLowerCase();
  const finalMissSignals = [
    "gagal",
    "ga jadi",
    "gak jadi",
    "nggak jadi",
    "tidak jadi",
    "kelewat",
    "miss hari ini",
    "i missed",
    "missed",
    "didn't",
    "did not",
    "couldn't",
    "could not",
    "ga sempat",
    "gak sempat",
    "nggak sempat",
    "tidak sempat",
    "belum ngerjain",
    "belum dikerjain",
  ];
  const hesitationSignals = [
    "males",
    "malas",
    "capek",
    "too tired",
    "lazy",
    "belum mood",
    "nanti aja",
    "nanti",
  ];
  const hasFinalMissSignal = finalMissSignals.some((signal) =>
    lowered.includes(signal),
  );
  const hasHesitationSignal = hesitationSignals.some((signal) =>
    lowered.includes(signal),
  );

  if (hasFinalMissSignal) {
    return "missed" as const;
  }

  if (hasHesitationSignal) {
    return "excuse" as const;
  }

  return null;
}

function normalizeQuestionSafetyCheck(value: unknown) {
  const candidate =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};

  return {
    isVerificationQuestion: Boolean(candidate.isVerificationQuestion),
    suggestedQuestionFocus: (() => {
      const focus = coerceString(candidate.suggestedQuestionFocus);
      return focus === "pattern" ||
        focus === "status" ||
        focus === "schedule" ||
        focus === "general"
        ? (focus as QuestionFocus)
        : null;
    })(),
  };
}

function normalizeMissHesitationSafetyCheck(value: unknown) {
  const candidate =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const correctedClassification = coerceString(
    candidate.correctedClassification,
  );

  return {
    correctedClassification:
      correctedClassification === "missed" ||
      correctedClassification === "excuse"
        ? (correctedClassification as "missed" | "excuse")
        : null,
  };
}

function normalizeOperationalSafetyCheck(value: unknown) {
  const candidate =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const correctedIntent = coerceString(candidate.correctedIntent);

  return {
    correctedIntent:
      correctedIntent === "reschedule_habit_time" ||
      correctedIntent === "reschedule_task_time" ||
      correctedIntent === "skip_habit_for_date" ||
      correctedIntent === "create_task" ||
      correctedIntent === "mark_task_done" ||
      correctedIntent === "add_task_reminder" ||
      correctedIntent === "ask_today_plan" ||
      correctedIntent === "ask_tomorrow_plan" ||
      correctedIntent === "risk_scan" ||
      correctedIntent === "simple_reschedule_suggestion" ||
      correctedIntent === "none"
        ? correctedIntent
        : null,
    continuePendingAction: Boolean(candidate.continuePendingAction),
    supersedePendingAction: Boolean(candidate.supersedePendingAction),
    requiresClarification: Boolean(candidate.requiresClarification),
    clarificationQuestion:
      coerceString(candidate.clarificationQuestion) || null,
  };
}

async function applyQuestionSafetyResolution(args: {
  content: string;
  extraction: ChatExtractionResult;
  source: "chat_input" | "quick_complete" | "quick_miss";
  pendingWorkoutHabit: Doc<"habits"> | null;
  context: ChatContext;
}) {
  if (args.source !== "chat_input") {
    return { extraction: args.extraction, trace: null as ModelRunTrace | null };
  }

  if (args.pendingWorkoutHabit) {
    return { extraction: args.extraction, trace: null as ModelRunTrace | null };
  }

  if (
    args.extraction.classification !== "completed" &&
    args.extraction.classification !== "missed" &&
    args.extraction.classification !== "bonus"
  ) {
    return { extraction: args.extraction, trace: null as ModelRunTrace | null };
  }

  if (!args.content.includes("?")) {
    return { extraction: args.extraction, trace: null as ModelRunTrace | null };
  }

  const result = await callModelJsonWithTrace([
    {
      role: "system",
      content:
        "You are a safety checker for habit tracking. " +
        "Return valid JSON only with keys isVerificationQuestion and suggestedQuestionFocus. " +
        "isVerificationQuestion should be true only when the user's message is asking to verify, confirm, or check status/progress/streak, rather than reporting a result that should mutate data. " +
        "suggestedQuestionFocus must be one of pattern, status, schedule, general, or null. " +
        "A verification question can be blunt or informal and may still mention completion-like words. " +
        "Examples: 'Gue udah 10 hari streak gym kan?' -> true, pattern. " +
        "Example: 'Is my reading streak safe today?' -> true, status. " +
        "Example: 'Did I already finish gym today?' -> true, status. " +
        "Example: 'I already finished gym today squat 3x8 60kg' -> false, null. " +
        "Example: 'gue gagal gym hari ini karena ketiduran' -> false, null. " +
        "Do not add prose outside JSON.",
    },
    {
      role: "user",
      content: JSON.stringify({
        todayDate: args.context.date,
        timezone: args.context.timezone,
        currentTimeContext: summarizeCurrentTimeContext(args.context),
        userMessage: args.content,
      }),
    },
  ]);

  const check = normalizeQuestionSafetyCheck(parseJsonObject(result.content));
  if (!check.isVerificationQuestion) {
    return { extraction: args.extraction, trace: result.trace };
  }

  return {
    extraction: {
      ...args.extraction,
      classification: "question" as const,
      shouldLogCheckIn: false,
      checkInStatus: null,
      questionFocus:
        check.suggestedQuestionFocus ?? args.extraction.questionFocus,
      needsWorkoutClarification: false,
    },
    trace: result.trace,
  };
}

async function applyMissHesitationSafetyResolution(args: {
  content: string;
  extraction: ChatExtractionResult;
  source: "chat_input" | "quick_complete" | "quick_miss";
  pendingWorkoutHabit: Doc<"habits"> | null;
  context: ChatContext;
}) {
  if (args.source !== "chat_input") {
    return { extraction: args.extraction, trace: null as ModelRunTrace | null };
  }

  if (args.pendingWorkoutHabit) {
    return { extraction: args.extraction, trace: null as ModelRunTrace | null };
  }

  if (args.extraction.classification !== "excuse") {
    return { extraction: args.extraction, trace: null as ModelRunTrace | null };
  }

  const lexicalResolution = inferMissHesitationFromContent(args.content);
  if (lexicalResolution === "excuse") {
    return { extraction: args.extraction, trace: null as ModelRunTrace | null };
  }
  if (lexicalResolution === "missed") {
    return {
      extraction: {
        ...args.extraction,
        classification: "missed" as const,
        shouldLogCheckIn: true,
        checkInStatus: "missed" as const,
        needsWorkoutClarification: false,
      },
      trace: null as ModelRunTrace | null,
    };
  }

  const result = await callModelJsonWithTrace([
    {
      role: "system",
      content:
        "You are a safety checker that distinguishes final miss reports from hesitation. " +
        "Return valid JSON only with key correctedClassification. " +
        "correctedClassification must be one of missed, excuse, or null. " +
        "Return missed only when the user is clearly reporting that the habit already failed, was missed, was not done, or could not be completed for today. " +
        "Return excuse when the user is only resisting, hesitating, complaining, or sounding reluctant without finalizing failure. " +
        "Examples: 'gue gagal gym hari ini karena capek pulang kerja' -> missed. " +
        "Example: 'gue ga jadi gym hari ini' -> missed. " +
        "Example: 'i missed my workout today' -> missed. " +
        "Example: 'gue males gym hari ini' -> excuse. " +
        "Example: 'too tired for gym right now' -> excuse. " +
        "Do not add prose outside JSON.",
    },
    {
      role: "user",
      content: JSON.stringify({
        todayDate: args.context.date,
        timezone: args.context.timezone,
        currentTimeContext: summarizeCurrentTimeContext(args.context),
        userMessage: args.content,
      }),
    },
  ]);

  const check = normalizeMissHesitationSafetyCheck(
    parseJsonObject(result.content),
  );
  if (check.correctedClassification !== "missed") {
    return { extraction: args.extraction, trace: result.trace };
  }

  return {
    extraction: {
      ...args.extraction,
      classification: "missed" as const,
      shouldLogCheckIn: true,
      checkInStatus: "missed" as const,
      needsWorkoutClarification: false,
    },
    trace: result.trace,
  };
}

function applyMissKeywordGuard(args: {
  content: string;
  extraction: ChatExtractionResult;
  source: "chat_input" | "quick_complete" | "quick_miss";
}) {
  if (
    args.source !== "chat_input" ||
    args.extraction.classification !== "missed"
  ) {
    return args.extraction;
  }

  const lexicalResolution = inferMissHesitationFromContent(args.content);
  if (lexicalResolution !== "excuse") {
    return args.extraction;
  }

  return {
    ...args.extraction,
    classification: "excuse" as const,
    shouldLogCheckIn: false,
    checkInStatus: null,
    needsWorkoutClarification: false,
  };
}

async function applyOperationalSafetyResolution(args: {
  content: string;
  extraction: OperationalExtractionResult | null;
  chatExtraction: ChatExtractionResult;
  source: "chat_input" | "quick_complete" | "quick_miss";
  context: ChatContext;
  pendingAction: Doc<"agentPendingActions"> | null;
}) {
  if (args.source !== "chat_input" || !args.extraction) {
    return { extraction: args.extraction, trace: null as ModelRunTrace | null };
  }

  const riskyIntent = args.extraction.intent;
  if (
    riskyIntent !== "skip_habit_for_date" &&
    riskyIntent !== "reschedule_habit_time" &&
    riskyIntent !== "reschedule_task_time" &&
    riskyIntent !== "create_task" &&
    riskyIntent !== "mark_task_done" &&
    riskyIntent !== "add_task_reminder"
  ) {
    return { extraction: args.extraction, trace: null as ModelRunTrace | null };
  }

  const result = await callModelJsonWithTrace([
    {
      role: "system",
      content:
        "You are a mutation safety checker for habit and planner operations. " +
        "Return valid JSON only with keys correctedIntent, continuePendingAction, supersedePendingAction, requiresClarification, clarificationQuestion. " +
        "correctedIntent must be one of reschedule_habit_time, reschedule_task_time, skip_habit_for_date, create_task, mark_task_done, add_task_reminder, ask_today_plan, ask_tomorrow_plan, risk_scan, simple_reschedule_suggestion, or none. " +
        "continuePendingAction and supersedePendingAction must be booleans. " +
        "requiresClarification must be true only when the user clearly wants an operation but the target or scope is still ambiguous. " +
        "Use none when the message is only hesitation, excuse, failure report, or normal conversation rather than an operational mutation request. " +
        "If chatExtraction says excuse or missed, do not convert it into skip_habit_for_date unless the user is clearly issuing an explicit planner command rather than reporting reluctance or failure. " +
        "If there is a pendingAction and the user is simply answering the missing fields for that pending action, keep correctedIntent aligned with the pending action and set continuePendingAction=true. " +
        "If the user is clearly starting a different request than the pendingAction, set supersedePendingAction=true. " +
        "CRITICAL: If the user message is about completing a habit (e.g. 'done with github', 'beres gym') and habitName matches one of the activeHabits, you MUST set correctedIntent to 'none'. Do NOT use mark_task_done for habits. " +
        "simple_reschedule_suggestion is only for advisory requests about what should be moved. " +
        "If the user specifies the item that should be moved, or gives a concrete target date/time for that move, use reschedule_habit_time instead. " +
        "Examples: 'gue males gym hari ini' -> none. " +
        "Example: 'gue gagal gym hari ini karena capek' -> none. " +
        "Example: 'skip gym besok' -> skip_habit_for_date, false. " +
        "Example: 'skip semua besok' -> skip_habit_for_date, true, ask which habit should be skipped. " +
        "Example: 'geser gym' -> reschedule_habit_time, true. " +
        "Example: 'geser gym besok jam 9 malam' -> reschedule_habit_time, false. " +
        "Example: 'reschedule task tadi jadi jam 9 malam' -> reschedule_task_time, true when date is still missing. " +
        "Example: 'task tadi udah beres' -> mark_task_done, false when target task is clear from context. " +
        "Example: recentTasks contains 'bangun pagi', user='dude, i already waking up' -> mark_task_done, false. " +
        "Example: 'ingetin lagi task tadi 10 menit sebelumnya' -> add_task_reminder, false when target task is clear from context. " +
        "Example: 'yang paling enak digeser apa besok?' -> simple_reschedule_suggestion, false. " +
        "Example: pendingAction=create_task follow up client, user='besok jam 10 pagi' -> create_task, continuePendingAction=true, false. " +
        "Example: 'tambah task follow up client' -> create_task, true if timing is missing. " +
        "Do not add prose outside JSON.",
    },
    {
      role: "user",
      content: JSON.stringify({
        todayDate: args.context.date,
        timezone: args.context.timezone,
        currentTimeContext: summarizeCurrentTimeContext(args.context),
        activeHabits: args.context.activeHabits.map(summarizeHabit),
        chatExtraction: {
          classification: args.chatExtraction.classification,
          habitName: args.chatExtraction.habitName,
          checkInStatus: args.chatExtraction.checkInStatus,
          questionFocus: args.chatExtraction.questionFocus,
          reason: args.chatExtraction.reason,
          shouldLogCheckIn: args.chatExtraction.shouldLogCheckIn,
        },
        pendingAction: args.pendingAction
          ? {
              intent: args.pendingAction.intent,
              actionType: args.pendingAction.actionType,
              payload: args.pendingAction.payload ?? {},
              missingFields: args.pendingAction.missingFields,
              clarificationQuestion: args.pendingAction.clarificationQuestion,
            }
          : null,
        extractedIntent: args.extraction.intent,
        extractedHabitName: args.extraction.habitName,
        extractedTargetDate: args.extraction.targetDate,
        extractedTargetTime: args.extraction.targetTime,
        extractedTaskTitle: args.extraction.taskTitle,
        userMessage: args.content,
      }),
    },
  ]);

  const check = normalizeOperationalSafetyCheck(
    parseJsonObject(result.content),
  );
  if (!check.correctedIntent || check.correctedIntent === riskyIntent) {
    return {
      extraction: {
        ...args.extraction,
        continuePendingAction:
          check.continuePendingAction || args.extraction.continuePendingAction,
        supersedePendingAction:
          check.supersedePendingAction ||
          args.extraction.supersedePendingAction,
        clarificationQuestion:
          check.clarificationQuestion ?? args.extraction.clarificationQuestion,
      },
      trace: result.trace,
    };
  }

  return {
    extraction: {
      ...args.extraction,
      intent:
        check.correctedIntent === "none"
          ? null
          : (check.correctedIntent as OperationalIntent),
      continuePendingAction:
        check.continuePendingAction || args.extraction.continuePendingAction,
      supersedePendingAction:
        check.supersedePendingAction || args.extraction.supersedePendingAction,
      clarificationQuestion:
        check.clarificationQuestion ?? args.extraction.clarificationQuestion,
    },
    trace: result.trace,
  };
}

function normalizeExtraction(value: unknown): ChatExtractionResult {
  const candidate =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const classification = coerceString(
    candidate.classification,
  ) as ChatClassification;
  const checkInStatus = coerceString(candidate.checkInStatus) as
    | "completed"
    | "missed"
    | "bonus"
    | "";
  const questionFocus = coerceString(candidate.questionFocus) as QuestionFocus;

  return {
    classification:
      classification === "completed" ||
      classification === "missed" ||
      classification === "question" ||
      classification === "excuse" ||
      classification === "bonus" ||
      classification === "clarify_workout"
        ? classification
        : "question",
    habitName: coerceString(candidate.habitName) || null,
    shouldLogCheckIn: Boolean(candidate.shouldLogCheckIn),
    checkInStatus:
      checkInStatus === "completed" ||
      checkInStatus === "missed" ||
      checkInStatus === "bonus"
        ? checkInStatus
        : null,
    questionFocus:
      questionFocus === "pattern" ||
      questionFocus === "status" ||
      questionFocus === "schedule" ||
      questionFocus === "general"
        ? questionFocus
        : "general",
    reason: coerceString(candidate.reason) || null,
    conversationSummary: coerceString(candidate.conversationSummary) || null,
    needsWorkoutClarification: Boolean(candidate.needsWorkoutClarification),
    workout: normalizeWorkout(candidate.workout),
  };
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

  return cleaned || "Langsung ke inti. Eksekusi sekarang.";
}

const DIRECT_CUE_FRAGMENTS = [
  "jangan",
  "harus",
  "langsung",
  "alasan",
  "tidur sana",
  "mau",
];

function hasRequiredDirectCue(content: string) {
  const lowered = content.toLowerCase();
  return DIRECT_CUE_FRAGMENTS.some((fragment) =>
    lowered.includes(fragment.toLowerCase()),
  );
}

function looksEnglishDominant(text: string) {
  const lowered = text.toLowerCase();
  const indonesianSignals = [
    "gue",
    "lo",
    "aku",
    "kamu",
    "hari ini",
    "besok",
    "jangan",
    "langsung",
    "alasan",
    "jadwal",
    "sudah",
    "udah",
    "gagal",
    "kelewat",
    "tercatat",
  ];

  if (indonesianSignals.some((signal) => lowered.includes(signal))) {
    return false;
  }

  const englishSignals = [
    "you",
    "your",
    "today",
    "tomorrow",
    "missed",
    "get it done",
    "already",
    "deadline",
    "focus",
    "session",
    "move now",
    "don't",
  ];
  const englishHits = englishSignals.filter((signal) =>
    lowered.includes(signal),
  ).length;

  return englishHits >= 2;
}

function enforceReplyLanguage(args: {
  content: string;
  userMessage: string;
  mode: ResponseMode;
}) {
  if (
    !looksLikeIndonesian(args.userMessage) ||
    !looksEnglishDominant(args.content)
  ) {
    return args.content;
  }

  if (args.mode === "miss") {
    return "Hari ini miss. Jangan ulang alasan yang sama.";
  }

  if (args.mode === "hesitation") {
    return "Alasan doang. Jangan nunggu, langsung gerak sekarang.";
  }

  if (args.mode === "completion") {
    return "Sudah masuk. Jangan santai, lanjut konsisten.";
  }

  if (args.mode === "clarify_workout") {
    return "Detail latihannya apa? Tulis gerakan + set/reps/berat.";
  }

  return args.content;
}

function enforceDirectCueForStrictModes(args: {
  content: string;
  userMessage: string;
  mode: ResponseMode;
}) {
  if (args.mode !== "hesitation" && args.mode !== "miss") {
    return args.content;
  }

  if (hasRequiredDirectCue(args.content)) {
    return args.content;
  }

  const suffix = looksLikeIndonesian(args.userMessage)
    ? "Jangan cari alasan, langsung gerak."
    : "Move now.";
  return `${args.content} ${suffix}`
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .trim();
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
  ];
  return signals.some((signal) => lowered.includes(signal));
}

function buildModelUnavailableReply(userMessage: string) {
  if (looksLikeIndonesian(userMessage)) {
    return "Tunggu. ulangin bentar lagi, lagi malas mikir ni.";
  }

  return "Soo confuse cause a lot of things right now. Try again in a moment okey?.";
}

function findHabitByName(habits: Doc<"habits">[], habitName: string | null) {
  if (!habitName) {
    return null;
  }

  const normalized = habitName.toLowerCase();
  return (
    habits.find((habit) => habit.name.toLowerCase() === normalized) ??
    habits.find((habit) => habit.name.toLowerCase().includes(normalized)) ??
    habits.find((habit) => normalized.includes(habit.name.toLowerCase())) ??
    null
  );
}

async function callModelJsonWithTrace(
  messages: Array<{ role: "system" | "user"; content: string }>,
) {
  return await callModelJsonWithFallbackTrace(messages, {
    errorLabel: "Convex chat action JSON generation",
  });
}

async function callModelTextWithTrace(
  messages: Array<{ role: "system" | "user"; content: string }>,
) {
  return await callModelTextWithFallbackTrace(messages, {
    temperature: 0.5,
    errorLabel: "Convex chat action text generation",
  });
}

async function logModelTrace(args: {
  ctx: ActionCtx;
  userId: Id<"users">;
  habitId?: Id<"habits"> | null;
  userMessageId?: Id<"messages"> | null;
  aiMessageId?: Id<"messages"> | null;
  userMessageContent?: string | null;
  aiMessageContent?: string | null;
  source: "chat" | "weekly_review" | "reminder" | "system";
  purpose: string;
  trace: ModelRunTrace | null;
  createdAt: number;
}) {
  if (!args.trace) {
    return;
  }

  await args.ctx.runMutation(internal.agentModelRuns.logModelRun, {
    userId: args.userId,
    habitId: args.habitId ?? undefined,
    userMessageId: args.userMessageId ?? undefined,
    aiMessageId: args.aiMessageId ?? undefined,
    userMessageContent: args.userMessageContent ?? undefined,
    aiMessageContent: args.aiMessageContent ?? undefined,
    source: args.source,
    purpose: args.purpose,
    finalProvider: args.trace.finalProvider,
    finalModel: args.trace.finalModel,
    fallbackDepth: args.trace.fallbackDepth,
    inputTokens: args.trace.inputTokens,
    outputTokens: args.trace.outputTokens,
    estimatedCostUsd: args.trace.estimatedCostUsd,
    attempts: args.trace.attempts,
    createdAt: args.createdAt,
  });
}

async function extractChatOutcome(input: {
  content: string;
  source: "chat_input" | "quick_complete" | "quick_miss";
  context: ChatContext;
}) {
  const recentMessages = input.context.recentMessages
    .slice(-6)
    .map((message) => ({
      role: message.role,
      intent: normalizeIntent(message.intent),
      content: message.content,
      habitId: message.habitId ?? null,
    }));

  const prompt = {
    source: input.source,
    todayDate: input.context.date,
    timezone: input.context.timezone,
    currentTimeContext: summarizeCurrentTimeContext(input.context),
    todayDayKey: input.context.todayDayKey,
    pendingClarificationHabitId: input.context.pendingClarificationHabitId,
    todayHabits: input.context.todayHabits.map(summarizeHabit),
    todayHabit: input.context.todayHabit
      ? summarizeHabit(input.context.todayHabit)
      : null,
    activeHabits: input.context.activeHabits.map(summarizeHabit),
    todayCheckIns: input.context.todayCheckIns.map(summarizeCheckIn),
    recentTasks: input.context.recentTasks.slice(0, 5).map((t) => ({
      title: t.title,
      status: t.status,
      time: t.time,
    })),
    recentMessages,
    userMessage: input.content,
  };

  const result = await callModelJsonWithTrace([
    {
      role: "system",
      content:
        "You classify habit-coach chat messages into structured JSON only. " +
        "Return valid JSON with keys classification, habitName, shouldLogCheckIn, checkInStatus, questionFocus, reason, conversationSummary, needsWorkoutClarification, workout. " +
        "classification must be one of completed, missed, question, excuse, bonus, clarify_workout. " +
        "CRITICAL: Habit completions must be related to activeHabits only. If the user is obviously talking about finishing a one-off task from recentTasks, do not attach the message to any habit. Leave habitName null. " +
        "Use currentTimeContext when the user asks whether something is still safe today, already late, or already missed. " +
        "checkInStatus must be completed, missed, bonus, or null. " +
        "questionFocus must be one of general, pattern, status, schedule. " +
        "questionFocus=pattern means the user asks about trend, pattern, progress lately, what keeps happening, recurring issues, or why a habit has been slipping. " +
        "questionFocus=status means the user asks about current status, streak, whether they should do it today, or simple factual progress. " +
        "questionFocus=schedule means the question is specifically about timing or schedule. " +
        "questionFocus=general means a normal non-planner question that does not fit pattern, status, or schedule. " +
        "When the user says they completed a workout but does not provide enough workout detail to extract at least one specific exercise or cardio entry with a measurable detail like duration, distance, sets, reps, or weight, set needsWorkoutClarification=true and shouldLogCheckIn=false. " +
        "When they answer a prior workout clarification with enough workout details, classify as clarify_workout and include workout. " +
        "Generic body-part answers like leg, legs, upper body, lower body, cardio, gym, or workout are not enough detail yet. " +
        "If the user says they failed, missed, didn't do it, or couldn't complete it today, classify as missed, not skip. " +
        "If the user is planning a future skip like skip besok, skip Friday, atau gue mau skip besok, do not classify it as missed. Treat it as non-result chat with shouldLogCheckIn=false and checkInStatus=null. " +
        "For excuses or hesitation before a result is final, use excuse and capture the reason. " +
        "On non-target days, a completed workout should usually be bonus. " +
        "Examples: user='gue gagal gym hari ini karena ketiduran' -> classification='missed', checkInStatus='missed'. " +
        "Example: user='progress gym gue akhir-akhir ini gimana?' -> classification='question', questionFocus='pattern'. " +
        "Example: user='hari ini gue udah beres gym' -> classification='completed' unless workout detail is still missing and needsWorkoutClarification=true. " +
        "Example: user='dude, i already waking up' with recent task 'bangun pagi' -> classification='question', habitName=null. " +
        "Do not add markdown or prose.",
    },
    {
      role: "user",
      content: JSON.stringify(prompt),
    },
  ]);

  return {
    extraction: normalizeExtraction(parseJsonObject(result.content)),
    trace: result.trace,
  };
}

function normalizeOperationalExtraction(
  value: unknown,
): OperationalExtractionResult {
  const candidate =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const intent = coerceString(candidate.intent) as
    | OperationalIntent
    | "none"
    | "";

  return {
    intent:
      intent === "reschedule_habit_time" ||
      intent === "reschedule_task_time" ||
      intent === "skip_habit_for_date" ||
      intent === "create_task" ||
      intent === "mark_task_done" ||
      intent === "add_task_reminder" ||
      intent === "ask_today_plan" ||
      intent === "ask_tomorrow_plan" ||
      intent === "risk_scan" ||
      intent === "simple_reschedule_suggestion"
        ? intent
        : null,
    habitName: coerceString(candidate.habitName) || null,
    targetDate: coerceString(candidate.targetDate) || null,
    targetTime: coerceString(candidate.targetTime) || null,
    taskTitle:
      coerceString(candidate.taskTitle) ||
      coerceString(candidate.title) ||
      null,
    taskId: null,
    reminderOffsetMinutes:
      coerceFiniteNumber(candidate.reminderOffsetMinutes) ??
      extractReminderOffsetMinutes(
        coerceString(candidate.userMessage) || coerceString(candidate.content),
      ),
    continuePendingAction: Boolean(candidate.continuePendingAction),
    supersedePendingAction: Boolean(candidate.supersedePendingAction),
    clarificationQuestion:
      coerceString(candidate.clarificationQuestion) || null,
  };
}

function includesTaskRescheduleCue(content: string) {
  const lowered = content.toLowerCase();
  return (
    lowered.includes("task") ||
    lowered.includes("tadi") ||
    lowered.includes("yang tadi") ||
    lowered.includes("bukan github") ||
    lowered.includes("bukan habit")
  );
}

function findTaskByTitle(
  tasks: Doc<"agentTasks">[],
  title: string | null | undefined,
) {
  const normalizedTitle = title?.trim().toLowerCase();
  if (!normalizedTitle) {
    return null;
  }

  return (
    tasks.find((task) => task.title.trim().toLowerCase() === normalizedTitle) ??
    null
  );
}

function resolveRecentTaskForImplicitReschedule(args: {
  content: string;
  context: ChatContext;
  intent: OperationalIntent | null;
}) {
  const recentTaskUpdate = args.context.recentMessages
    .slice(-4)
    .some(
      (message) =>
        message.role === "ai" &&
        (message.intent === "task_update" ||
          message.intent === "create_task" ||
          message.intent === "task_reminder"),
    );
  const hasTaskCue =
    includesTaskRescheduleCue(args.content) ||
    args.content.toLowerCase().includes("selesai") ||
    args.content.toLowerCase().includes("done") ||
    args.content.toLowerCase().includes("beres");
  if (!recentTaskUpdate && !hasTaskCue) {
    return null;
  }

  const matchedTask =
    matchTaskFromRecentContext({
      content: args.content,
      tasks: args.context.recentTasks,
    }) ?? args.context.recentTasks[0] ?? null;
  if (!matchedTask) {
    return null;
  }

  if (
    args.intent !== "mark_task_done" &&
    matchedTask.status !== "pending"
  ) {
    return null;
  }

  return matchedTask;
}

function applyDeterministicScheduleOverride(args: {
  content: string;
  extraction: OperationalExtractionResult | null;
  context: ChatContext;
}) {
  if (!args.extraction?.intent) {
    return args.extraction;
  }

  if (
    args.extraction.intent !== "create_task" &&
    args.extraction.intent !== "reschedule_task_time" &&
    args.extraction.intent !== "reschedule_habit_time" &&
    args.extraction.intent !== "add_task_reminder"
  ) {
    return args.extraction;
  }

  const parsedTargetTime = parseDeterministicTime(args.content);
  const parsedTargetDate = inferDeterministicDate(args.content, args.context);
  const nextOccurrence = resolveNextOccurrenceTime({
    content: args.content,
    context: args.context,
    parsedTargetTime,
    parsedTargetDate,
  });
  return {
    ...args.extraction,
    targetTime:
      nextOccurrence.targetTime &&
      (hasDeterministicTimeCue(args.content) || !isTimeKey(args.extraction.targetTime))
        ? nextOccurrence.targetTime
        : args.extraction.targetTime,
    targetDate:
      nextOccurrence.targetDate != null
        ? nextOccurrence.targetDate
        : args.extraction.targetDate,
  };
}

function applyImplicitTaskCompletionOverride(args: {
  content: string;
  extraction: OperationalExtractionResult | null;
  context: ChatContext;
}) {
  const matchedTask = matchTaskFromRecentContext({
    content: args.content,
    tasks: args.context.recentTasks,
  });
  if (!matchedTask || !isTaskCompletionLikeMessage(args.content)) {
    return args.extraction;
  }

  if (
    args.extraction?.intent &&
    args.extraction.intent !== "mark_task_done"
  ) {
    return args.extraction;
  }

  return {
    intent: "mark_task_done",
    habitName: null,
    targetDate: matchedTask.date,
    targetTime: matchedTask.time ?? null,
    taskTitle: matchedTask.title,
    taskId: matchedTask._id,
    reminderOffsetMinutes: args.extraction?.reminderOffsetMinutes ?? null,
    continuePendingAction: false,
    supersedePendingAction: false,
    clarificationQuestion: null,
  } satisfies OperationalExtractionResult;
}

function applyDeterministicOperationalOverride(args: {
  content: string;
  extraction: OperationalExtractionResult | null;
  context: ChatContext;
  pendingAction: Doc<"agentPendingActions"> | null;
}) {
  if (args.extraction?.intent) {
    return args.extraction;
  }

  const lowered = args.content.toLowerCase();
  const hasSkipVerb = /\bskip\b/.test(lowered) || /\blewati\b/.test(lowered);
  if (!hasSkipVerb) {
    return args.extraction;
  }

  const targetDate = lowered.includes("besok")
    ? shiftDateKey(args.context.date, 1)
    : lowered.includes("hari ini")
      ? args.context.date
      : null;
  if (!targetDate) {
    return args.extraction;
  }

  const mentionedHabits = args.context.activeHabits.filter((habit) =>
    lowered.includes(habit.name.toLowerCase()),
  );
  const habitName =
    mentionedHabits.length === 1 ? mentionedHabits[0].name : null;

  return {
    intent: "skip_habit_for_date",
    habitName,
    targetDate,
    targetTime: null,
    taskTitle: null,
    taskId: null,
    reminderOffsetMinutes: null,
    continuePendingAction: false,
    supersedePendingAction: Boolean(args.pendingAction),
    clarificationQuestion:
      habitName == null && targetDate != null ? "Mau skip habit apa?" : null,
  } satisfies OperationalExtractionResult;
}

function applyRecentEntityOperationalOverride(args: {
  content: string;
  extraction: OperationalExtractionResult | null;
  context: ChatContext;
}) {
  if (!args.extraction) {
    return null;
  }

  const taskTargetableIntent =
    args.extraction.intent === "reschedule_habit_time" ||
    args.extraction.intent === "reschedule_task_time" ||
    args.extraction.intent === "mark_task_done" ||
    args.extraction.intent === "add_task_reminder";
  if (
    !taskTargetableIntent ||
    args.extraction.habitName ||
    args.extraction.taskTitle ||
    args.extraction.taskId
  ) {
    return args.extraction;
  }

  const recentTask = resolveRecentTaskForImplicitReschedule({
    content: args.content,
    context: args.context,
    intent: args.extraction.intent,
  });
  if (!recentTask) {
    return args.extraction;
  }

  return {
    ...args.extraction,
    intent:
      args.extraction.intent === "reschedule_habit_time"
        ? ("reschedule_task_time" as const)
        : args.extraction.intent,
    taskId: recentTask._id,
    taskTitle: args.extraction.taskTitle ?? recentTask.title,
    clarificationQuestion: args.extraction.clarificationQuestion,
  };
}

async function extractOperationalOutcome(input: {
  content: string;
  context: ChatContext;
  pendingAction: Doc<"agentPendingActions"> | null;
}) {
  const recentMessages = input.context.recentMessages
    .slice(-6)
    .map((message) => ({
      role: message.role,
      intent: normalizeIntent(message.intent),
      content: message.content,
      habitId: message.habitId ?? null,
    }));
  const prompt = {
    todayDate: input.context.date,
    timezone: input.context.timezone,
    currentTimeContext: summarizeCurrentTimeContext(input.context),
    todayHabit: input.context.todayHabit
      ? summarizeHabit(input.context.todayHabit)
      : null,
    activeHabits: input.context.activeHabits.map(summarizeHabit),
    pendingAction: input.pendingAction
      ? {
          intent: input.pendingAction.intent,
          actionType: input.pendingAction.actionType,
          targetHabitId: input.pendingAction.targetHabitId ?? null,
          payload: input.pendingAction.payload ?? {},
          missingFields: input.pendingAction.missingFields,
          clarificationQuestion: input.pendingAction.clarificationQuestion,
        }
      : null,
    recentMessages,
    recentTasks: input.context.recentTasks.slice(0, 6).map((task) => ({
      id: task._id,
      title: task.title,
      date: task.date,
      time: task.time ?? null,
      status: task.status,
      updatedAt: task.updatedAt,
    })),
    userMessage: input.content,
  };

  const result = await callModelJsonWithTrace([
    {
      role: "system",
      content:
        "You detect operational habit and secretary commands plus clarification follow-ups. " +
        "Return valid JSON only with keys intent, habitName, targetDate, targetTime, taskTitle, reminderOffsetMinutes, continuePendingAction, supersedePendingAction, clarificationQuestion. " +
        "intent must be one of reschedule_habit_time, reschedule_task_time, skip_habit_for_date, create_task, mark_task_done, add_task_reminder, ask_today_plan, ask_tomorrow_plan, risk_scan, simple_reschedule_suggestion, or none. " +
        "Use currentTimeContext when the user references relative timing like sekarang, nanti, masih sempat, kelewat, hari ini, or malam ini. " +
        "If the user asks to be reminded about a NEW activity or action, such as ingetin balik rumah, ingetin telpon mom, or remind me to X, you MUST classify this as intent create_task. The taskTitle must be the activity. Do NOT classify it as none (casual chat), and do NOT classify it as add_task_reminder unless the task already exists in the context. " +
        "When the user specifies a relative time such as setengah jam lagi, 1 jam dari sekarang, or in 45 minutes, you MUST do the math. Add that duration to currentTimeContext to calculate the exact targetTime in HH:mm format. Do NOT output the current time as targetTime. " +
        "If the user is creating a task purely as an immediate relative alarm, such as ingetin balik rumah setengah jam lagi, set reminderOffsetMinutes to 0 in the JSON output so the alarm rings exactly at the newly calculated targetTime instead of triggering prematurely based on a default offset. " +
        "ask_today_plan is only for requests about today's agenda, what's left today, what is not finished today, or today's remaining work. " +
        "ask_tomorrow_plan is only for requests about tomorrow's agenda or tomorrow's plan. " +
        "risk_scan is only for requests asking which item is most at risk, most likely to be missed, or most rawan kelewat. " +
        "simple_reschedule_suggestion is only for requests asking what should be shifted, what is easiest to move, or what should be rescheduled, without asking to mutate anything yet. " +
        "create_task is only for one-off tasks like review deck, call mom, pay bills, send invoice, or follow up client, and it is also the correct intent for new reminder requests about a brand-new activity. " +
        "reschedule_task_time is for moving a one-off task's date and/or time. Use it when the target is clearly a task from recent context (for example user says task tadi), not a habit. " +
        "mark_task_done is for explicitly marking a one-off task as finished, done, beres, kelar, selesai. " +
        "add_task_reminder is for explicitly asking to add or set another reminder for a one-off task. " +
        "none is for general questions that are not planner commands, not task creation, and not explicit habit operations. " +
        "targetDate must be yyyy-MM-dd or null. Resolve relative dates like hari ini and besok using todayDate. " +
        "targetTime must be HH:mm 24-hour format or null. Resolve phrases like jam 7 malam into exact time. " +
        "taskTitle must be a short clean task title or null. " +
        "reminderOffsetMinutes must be a number of minutes before the task time, or null if not provided. " +
        "skip_habit_for_date means an intentional planned skip. " +
        "CRITICAL: If the user says they are DONE, FINISHED, or have COMPLETED a habit (e.g., 'iam done with github today', 'udah beres gym'), you MUST set intent to 'none'. Habit completions are handled by a different specialized extractor. Only use mark_task_done for one-off tasks that are NOT in the activeHabits list. " +
        "Do not classify failure or missed-result reports like gagal, kelewat, ga jadi, tidak sempat, or miss hari ini as skip. Leave those as intent none so conversational logging can handle them. " +
        "Messages like skip besok or gue mau skip besok are still skip_habit_for_date even if the habit is missing and needs clarification. " +
        "Messages like skip gym besok are skip_habit_for_date, not missed. " +
        "Messages like gue gagal gym hari ini or gym kelewat hari ini are not skip_habit_for_date. " +
        "If there is a pendingAction and the user is clearly answering that clarification, set continuePendingAction=true. " +
        "If there is a pendingAction but the user clearly starts a different request or changes topic, set supersedePendingAction=true. " +
        "If the message is not an operational request, set intent to none. " +
        "Use habitName only when it matches the provided activeHabits. " +
        "If clarification is still needed, write one short clarificationQuestion. " +
        "When examples contain [CALCULATED_DATE] or [CALCULATED_TIME...], replace them with the correct mathematical result based on currentTimeContext. " +
        "Examples: user='hari ini apa yang belum beres?' -> intent='ask_today_plan'. " +
        "Example: user='besok gue ngapain aja?' -> intent='ask_tomorrow_plan'. " +
        "Example: user='mana yang paling rawan kelewat minggu ini?' -> intent='risk_scan'. " +
        "Example: user='yang paling enak digeser apa besok?' -> intent='simple_reschedule_suggestion'. " +
        "Example: user='besok review deck jam 9 pagi' -> intent='create_task', taskTitle='review deck', targetDate='tomorrow', targetTime='09:00'. " +
        "Example: user='ingetin balik rumah setengah jam lagi' -> intent='create_task', taskTitle='balik rumah', targetDate='[CALCULATED_DATE]', targetTime='[CALCULATED_TIME_PLUS_30_MINS]', reminderOffsetMinutes=0. " +
        "Example: user='ingetin beli susu set jam lagi' -> intent='create_task', taskTitle='beli susu', targetDate='[CALCULATED_DATE]', targetTime='[CALCULATED_TIME_PLUS_1_HOUR]', reminderOffsetMinutes=0. " +
        "Example: user='remind me to call mom in 15 minutes' -> intent='create_task', taskTitle='call mom', targetDate='[CALCULATED_DATE]', targetTime='[CALCULATED_TIME_PLUS_15_MINS]', reminderOffsetMinutes=0. " +
        "Example: user='ingetin balik rumah setengah jam lagi' -> intent='create_task', taskTitle='balik rumah', targetTime computed from currentTimeContext, reminderOffsetMinutes=0. " +
        "Example: user='reschedule task tadi ke jam 9 malam' -> intent='reschedule_task_time'. " +
        "Example: user='task review deck udah selesai' -> intent='mark_task_done'. " +
        "Example: recentTasks contains 'bangun pagi', user='dude, i already waking up' -> intent='mark_task_done'. " +
        "Example: user='ingetin lagi task tadi 10 menit sebelumnya' -> intent='add_task_reminder', reminderOffsetMinutes=10. " +
        "Example: user='berapa jarak bumi ke bulan?' -> intent='none'. " +
        "Do not add markdown or prose outside JSON.",
    },
    {
      role: "user",
      content: JSON.stringify(prompt),
    },
  ]);

  const extraction = normalizeOperationalExtraction(
    parseJsonObject(result.content),
  );
  return {
    extraction: {
      ...extraction,
      reminderOffsetMinutes:
        extraction.reminderOffsetMinutes ??
        extractReminderOffsetMinutes(input.content),
    },
    trace: result.trace,
  };
}

function buildOperationalRoute(input: {
  extraction: OperationalExtractionResult;
  context: ChatContext;
  pendingAction: Doc<"agentPendingActions"> | null;
}) {
  const pendingPayload = input.pendingAction?.payload as
    | Record<string, string | number | null>
    | undefined;
  const pendingHabitName =
    typeof pendingPayload?.habitName === "string"
      ? pendingPayload.habitName
      : null;
  const pendingTargetDate =
    typeof pendingPayload?.targetDate === "string"
      ? pendingPayload.targetDate
      : null;
  const pendingTargetTime =
    typeof pendingPayload?.targetTime === "string"
      ? pendingPayload.targetTime
      : null;
  const pendingTaskTitle =
    typeof pendingPayload?.taskTitle === "string"
      ? pendingPayload.taskTitle
      : null;
  const pendingReminderOffsetMinutes =
    typeof pendingPayload?.reminderOffsetMinutes === "number"
      ? pendingPayload.reminderOffsetMinutes
      : null;
  const pendingTaskId = pendingPayload?.taskId
    ? (pendingPayload.taskId as Id<"agentTasks">)
    : null;
  const extractedTargetDate = isDateKey(input.extraction.targetDate)
    ? input.extraction.targetDate
    : null;
  const extractedTargetTime = isTimeKey(input.extraction.targetTime)
    ? input.extraction.targetTime
    : null;
  const inferredPendingContinuation =
    Boolean(
      input.pendingAction &&
      !input.extraction.supersedePendingAction &&
      !input.extraction.continuePendingAction &&
      input.pendingAction.missingFields.some((field) => {
        if (field === "date") {
          return Boolean(extractedTargetDate);
        }
        if (field === "time") {
          return Boolean(extractedTargetTime);
        }
        if (field === "title") {
          return Boolean(input.extraction.taskTitle);
        }
        if (field === "habit") {
          return Boolean(input.extraction.habitName);
        }
        return false;
      }) &&
      !input.extraction.taskTitle &&
      !input.extraction.habitName,
    ) || false;
  const rawIntent =
    input.extraction.intent ??
    ((input.extraction.continuePendingAction || inferredPendingContinuation) &&
    input.pendingAction
      ? (input.pendingAction.intent as OperationalIntent)
      : null);
  const intent =
    rawIntent === "simple_reschedule_suggestion" &&
    (Boolean(input.extraction.habitName) || Boolean(extractedTargetTime))
      ? ("reschedule_habit_time" as const)
      : rawIntent;

  if (!intent) {
    return {
      route: {
        intent: null,
        requiredAction: null,
        targetDate: null,
        targetTime: null,
        taskTitle: null,
        taskId: null,
        reminderOffsetMinutes: null,
        resolvedHabit: null,
        needsClarification: false,
        clarificationQuestion: null,
        missingFields: [],
        payload: {},
      } satisfies OperationalRoute,
      supersededPendingAction:
        input.pendingAction && input.extraction.supersedePendingAction
          ? input.pendingAction
          : null,
    };
  }

  const fallbackHabit = input.pendingAction?.targetHabitId
    ? (input.context.activeHabits.find(
        (habit) => habit._id === input.pendingAction?.targetHabitId,
      ) ?? null)
    : null;
  const resolvedHabit =
    findHabitByName(input.context.activeHabits, input.extraction.habitName) ??
    fallbackHabit ??
    findHabitByName(input.context.activeHabits, pendingHabitName) ??
    (input.context.activeHabits.length === 1
      ? input.context.activeHabits[0]
      : null);
  const fallbackTask =
    input.extraction.taskId != null
      ? (input.context.recentTasks.find(
          (task) => task._id === input.extraction.taskId,
        ) ?? null)
      : pendingTaskId
        ? (input.context.recentTasks.find(
            (task) => task._id === pendingTaskId,
          ) ?? null)
        : null;
  const resolvedTask =
    findTaskByTitle(input.context.recentTasks, input.extraction.taskTitle) ??
    fallbackTask;

  const targetDate =
    extractedTargetDate ??
    (intent === "ask_today_plan"
      ? input.context.date
      : intent === "ask_tomorrow_plan"
        ? shiftDateKey(input.context.date, 1)
        : intent === "simple_reschedule_suggestion"
          ? shiftDateKey(input.context.date, 1)
          : null) ??
    (input.extraction.continuePendingAction || inferredPendingContinuation
      ? isDateKey(pendingTargetDate)
        ? pendingTargetDate
        : null
      : null);
  const targetTime =
    extractedTargetTime ??
    (input.extraction.continuePendingAction || inferredPendingContinuation
      ? isTimeKey(pendingTargetTime)
        ? pendingTargetTime
        : null
      : null);
  const taskTitle =
    input.extraction.taskTitle ??
    (input.extraction.continuePendingAction || inferredPendingContinuation
      ? pendingTaskTitle
      : null);
  const reminderOffsetMinutes =
    input.extraction.reminderOffsetMinutes ??
    (input.extraction.continuePendingAction || inferredPendingContinuation
      ? pendingReminderOffsetMinutes
      : null);

  const missingFields =
    intent === "reschedule_habit_time"
      ? [
          ...(resolvedHabit ? [] : ["habit"]),
          ...(targetDate ? [] : ["date"]),
          ...(targetTime ? [] : ["time"]),
        ]
      : intent === "reschedule_task_time"
        ? [
            ...(resolvedTask ? [] : ["task"]),
            ...(targetDate ? [] : ["date"]),
            ...(targetTime ? [] : ["time"]),
          ]
        : intent === "skip_habit_for_date"
          ? [
              ...(resolvedHabit ? [] : ["habit"]),
              ...(targetDate ? [] : ["date"]),
            ]
          : intent === "create_task"
            ? [
                ...(taskTitle ? [] : ["title"]),
                ...(targetDate ? [] : ["date"]),
                ...(targetTime ? [] : ["time"]),
              ]
            : intent === "mark_task_done"
              ? [...(resolvedTask ? [] : ["task"])]
              : intent === "add_task_reminder"
                ? resolvedTask
                  ? []
                  : [
                      ...(taskTitle ? [] : ["title"]),
                      ...(targetDate ? [] : ["date"]),
                      ...(targetTime ? [] : ["time"]),
                    ]
                : [];

  const clarificationQuestion =
    input.extraction.clarificationQuestion ??
    (intent === "reschedule_task_time" ||
    intent === "create_task" ||
    intent === "mark_task_done" ||
    intent === "add_task_reminder"
      ? null
      : buildOperationalClarificationQuestion(intent, missingFields));

  return {
    route: {
      intent,
      requiredAction: intent,
      targetDate,
      targetTime,
      taskTitle: taskTitle ?? resolvedTask?.title ?? null,
      taskId: resolvedTask?._id ?? null,
      reminderOffsetMinutes,
      resolvedHabit:
        intent === "ask_today_plan" ||
        intent === "ask_tomorrow_plan" ||
        intent === "risk_scan" ||
        intent === "simple_reschedule_suggestion" ||
        intent === "create_task" ||
        intent === "reschedule_task_time" ||
        intent === "mark_task_done" ||
        intent === "add_task_reminder"
          ? null
          : resolvedHabit,
      needsClarification: missingFields.length > 0,
      clarificationQuestion,
      missingFields,
      payload: {
        habitName: resolvedHabit?.name ?? null,
        targetDate,
        targetTime,
        taskTitle: taskTitle ?? resolvedTask?.title ?? null,
        taskId: resolvedTask?._id ?? null,
        reminderOffsetMinutes,
      },
    } satisfies OperationalRoute,
    supersededPendingAction:
      input.pendingAction &&
      input.extraction.supersedePendingAction &&
      !input.extraction.continuePendingAction
        ? input.pendingAction
        : null,
  };
}

function deriveCompletionStatus(args: {
  resolvedHabit: Doc<"habits"> | null;
  dayKey: string;
  extraction: ChatExtractionResult;
}) {
  if (args.extraction.checkInStatus === "completed") {
    return "completed" as const;
  }

  if (args.extraction.checkInStatus === "bonus") {
    return "bonus" as const;
  }

  return isHabitScheduledOnDay(args.resolvedHabit, args.dayKey)
    ? ("completed" as const)
    : ("bonus" as const);
}

function shouldTreatCompletionAsDuplicate(existing: Doc<"checkIns"> | null) {
  return Boolean(existing && existing.status !== "missed");
}

function resolveTurn(input: {
  context: ChatContext;
  extraction: ChatExtractionResult;
  operationalRoute: OperationalRoute;
  pendingAction: Doc<"agentPendingActions"> | null;
  continuingPendingAction: boolean;
  resolvedHabit: Doc<"habits"> | null;
  pendingWorkoutHabit: Doc<"habits"> | null;
}): ResolvedTurn {
  const pendingActionToCancel =
    input.pendingAction && !input.continuingPendingAction
      ? input.pendingAction
      : null;

  if (input.operationalRoute.intent) {
    if (input.operationalRoute.needsClarification) {
      return {
        kind: "operational_clarification",
        userIntent: input.operationalRoute.intent,
        requiredAction: input.operationalRoute.requiredAction,
        route: input.operationalRoute,
        resolvedHabit: input.operationalRoute.resolvedHabit,
        pendingActionToCancel,
      };
    }

    return {
      kind: "operational_execution",
      userIntent: input.operationalRoute.intent,
      requiredAction: input.operationalRoute.requiredAction,
      route: input.operationalRoute,
      resolvedHabit: input.operationalRoute.resolvedHabit,
      pendingActionToCancel,
    };
  }

  if (input.extraction.classification === "missed" && input.resolvedHabit) {
    const existingTodayCheckIn =
      input.context.todayCheckIns.find(
        (entry) => entry.habitId === input.resolvedHabit?._id,
      ) ?? null;

    if (existingTodayCheckIn) {
      return {
        kind: "duplicate_no_op",
        userIntent: "log_miss",
        requiredAction: "log_miss",
        resolvedHabit: input.resolvedHabit,
        checkInStatus: existingTodayCheckIn.status,
        extraction: input.extraction,
        pendingActionToCancel,
      };
    }

    return {
      kind: "checkin_execution",
      userIntent: "log_miss",
      requiredAction: "log_miss",
      resolvedHabit: input.resolvedHabit,
      checkInStatus: "missed",
      extraction: input.extraction,
      workout: null,
      pendingActionToCancel,
    };
  }

  if (
    input.extraction.classification === "clarify_workout" &&
    input.pendingWorkoutHabit
  ) {
    const workoutHabit = input.pendingWorkoutHabit;
    const completionStatus = deriveCompletionStatus({
      resolvedHabit: workoutHabit,
      dayKey: input.context.todayDayKey,
      extraction: input.extraction,
    });

    if (!input.extraction.workout) {
      return {
        kind: "checkin_clarification",
        userIntent: "clarify_workout",
        requiredAction: "log_completion",
        resolvedHabit: workoutHabit,
        checkInStatus: completionStatus,
        extraction: input.extraction,
        pendingActionToCancel,
      };
    }

    const existingTodayCheckIn =
      input.context.todayCheckIns.find(
        (entry) => entry.habitId === workoutHabit._id,
      ) ?? null;

    if (
      existingTodayCheckIn &&
      shouldTreatCompletionAsDuplicate(existingTodayCheckIn)
    ) {
      return {
        kind: "duplicate_no_op",
        userIntent: "log_completion",
        requiredAction: "log_completion",
        resolvedHabit: workoutHabit,
        checkInStatus: existingTodayCheckIn.status,
        extraction: input.extraction,
        pendingActionToCancel,
      };
    }

    return {
      kind: "checkin_execution",
      userIntent: "log_completion",
      requiredAction: "log_completion",
      resolvedHabit: workoutHabit,
      checkInStatus: completionStatus,
      extraction: input.extraction,
      workout: input.extraction.workout,
      pendingActionToCancel,
    };
  }

  if (
    (input.extraction.classification === "completed" ||
      input.extraction.classification === "bonus") &&
    input.resolvedHabit
  ) {
    const completionHabit = input.resolvedHabit;
    const completionStatus = deriveCompletionStatus({
      resolvedHabit: completionHabit,
      dayKey: input.context.todayDayKey,
      extraction: input.extraction,
    });

    if (input.extraction.needsWorkoutClarification) {
      return {
        kind: "checkin_clarification",
        userIntent: "clarify_workout",
        requiredAction: "log_completion",
        resolvedHabit: completionHabit,
        checkInStatus: completionStatus,
        extraction: input.extraction,
        pendingActionToCancel,
      };
    }

    const existingTodayCheckIn =
      input.context.todayCheckIns.find(
        (entry) => entry.habitId === completionHabit._id,
      ) ?? null;

    if (
      existingTodayCheckIn &&
      shouldTreatCompletionAsDuplicate(existingTodayCheckIn)
    ) {
      return {
        kind: "duplicate_no_op",
        userIntent: "log_completion",
        requiredAction: "log_completion",
        resolvedHabit: completionHabit,
        checkInStatus: existingTodayCheckIn.status,
        extraction: input.extraction,
        pendingActionToCancel,
      };
    }

    return {
      kind: "checkin_execution",
      userIntent: "log_completion",
      requiredAction: "log_completion",
      resolvedHabit: completionHabit,
      checkInStatus: completionStatus,
      extraction: input.extraction,
      workout: input.extraction.workout,
      pendingActionToCancel,
    };
  }

  return {
    kind: "conversation_only",
    userIntent: normalizeIntent(input.extraction.classification),
    requiredAction: null,
    resolvedHabit: input.resolvedHabit,
    extraction: input.extraction,
    pendingActionToCancel,
  };
}

async function generateCoachReply(input: {
  content: string;
  context: ChatContext;
  extraction: ChatExtractionResult;
  resolvedHabit: Doc<"habits"> | null;
  decision: ChatDecision;
  resolvedTurnKind?: ResolvedTurn["kind"];
  actionStatus?: "executed" | "no_op";
  workoutDetailStatus?: "accepted" | "needs_more_detail" | null;
}) {
  const resolvedHabitTimeContext = buildHabitTimeContext(
    input.context,
    input.resolvedHabit,
  );
  const todayHabitTimeContext = buildHabitTimeContext(
    input.context,
    input.context.todayHabit,
  );
  const scheduleFactSignal = buildScheduleFactSignal({
    decision: input.decision,
    context: input.context,
    resolvedHabit: input.resolvedHabit,
    resolvedHabitTimeContext,
    todayHabit: input.context.todayHabit,
    todayHabitTimeContext,
  });

  const prompt = {
    userMessage: input.content,
    currentTimeContext: summarizeCurrentTimeContext(input.context),
    resolvedTurnKind: input.resolvedTurnKind ?? null,
    mode: input.decision.mode,
    classification: input.extraction.classification,
    questionFocus: input.decision.questionFocus,
    reason: input.extraction.reason,
    conversationSummary: input.extraction.conversationSummary,
    requiresClarification: input.decision.requiresClarification,
    duplicateCheckIn: input.decision.duplicateCheckIn,
    loggedStatus: input.decision.loggedStatus,
    shouldLogCheckIn: input.decision.shouldLogCheckIn,
    actionStatus: input.actionStatus ?? null,
    workoutDetailStatus: input.workoutDetailStatus ?? null,
    resolvedHabit: input.resolvedHabit
      ? summarizeHabit(input.resolvedHabit)
      : null,
    resolvedHabitTimeContext,
    patternSummary: summarizePatternSummary(input.decision.patternSummary),
    primaryQuestionSignal: getPrimaryQuestionSignal({
      decision: input.decision,
      context: input.context,
      scheduleFactSignal,
    }),
    supportingQuestionSignal: getSupportingQuestionSignal({
      decision: input.decision,
      context: input.context,
    }),
    scheduleFactSignal,
    globalMemorySummary: input.context.globalMemorySummary,
    habitMemorySummary: input.context.habitMemorySummary,
    relevantEpisodes: input.context.relevantEpisodes,
    todayHabit: input.context.todayHabit
      ? summarizeHabit(input.context.todayHabit)
      : null,
    todayHabitTimeContext,
    todayCheckIns: input.context.todayCheckIns.map(summarizeCheckIn),
    todayReminderStatus: input.context.todayReminderStatus,
  };

  const result = await callModelTextWithTrace([
    {
      role: "system",
      content:
        "You are the Streak coach: blunt, concise, slightly brutal, never rambling. " +
        "Write 1 to 4 short sentences, no markdown, no emojis. " +
        "Reply in the same language and general tone as the user's message. If the user writes informal Indonesian, reply in informal Indonesian. Do not mix languages unless the user already did. " +
        "Voice must be cynical, sharp, and direct. Never sound like customer support. " +
        "Never use polite apology/request words such as maaf, silakan, tolong, mohon, or please. " +
        "Use mode to decide behavior. " +
        "If requiresClarification is true, ask specifically what workout they did so it can be logged. " +
        "If duplicateCheckIn is true, tell them today's result is already logged. " +
        "If resolvedTurnKind is checkin_execution, the result has already been recorded successfully. Never ask for more detail in that case. " +
        "If resolvedTurnKind is checkin_clarification, do not pretend anything was logged yet. " +
        "If workoutDetailStatus is needs_more_detail, ask for more detail and do not confirm success. " +
        "If actionStatus is no_op, acknowledge it was already logged instead of pretending a new mutation happened. " +
        "For completion mode, acknowledge the result with cynical buddy tone, then give side-eye or pressure to stay consistent. " +
        "For completion mode, do not use generic positive or admin closers such as fokus ke, jaga momentum, semangat, keep it up, tunggu jadwal berikutnya, langkah berikutnya, reset dan fokus, or sudah tercatat as a flat opener. " +
        "For miss mode, call out the miss, use at most one relevant pattern signal, and reset focus toward the next scheduled chance. " +
        "For hesitation mode, treat excuses as resistance, not as a logged miss, and push the smallest next action. " +
        "For miss and hesitation mode, include at least one direct cue word: jangan, harus, langsung, alasan, tidur sana, or mau. " +
        "For question mode, answer briefly and prioritize the most useful signal for the question. " +
        "Use currentTimeContext, resolvedHabitTimeContext, and todayHabitTimeContext to judge urgency. If the scheduled time already passed, say it plainly. If the deadline already passed, do not talk like there is still plenty of time left. " +
        "If questionFocus is pattern, lead with primaryQuestionSignal when it exists. Prefer repeated reasons, repeated misses, recovery-after-prompt, or reminder-ignore patterns over generic weekly counts. " +
        "If questionFocus is status, use the clearest current-state signal first, then at most one supporting memory clue. " +
        "If questionFocus is schedule, treat scheduleFactSignal and resolvedHabitTimeContext as the authoritative source for scheduledTime and checkInDeadline. " +
        "For schedule questions, do not derive or override exact times from habitMemorySummary, globalMemorySummary, relevantEpisodes, primaryQuestionSignal, or supportingQuestionSignal. " +
        "Use supportingQuestionSignal only if it adds one useful layer, not as a second paragraph. " +
        "For clarify_workout mode, ask for the missing workout details needed for logging. " +
        "Never dump raw numbers unless one short stat is the most relevant signal. " +
        "Only mention a pattern if the patternSummary clearly supports it. " +
        "Use globalMemorySummary, habitMemorySummary, relevantEpisodes, primaryQuestionSignal, and supportingQuestionSignal as lightweight cross-day memory. Mention them only if they clearly sharpen the reply, but for pattern questions they should usually beat generic stats. " +
        "If loggedStatus is bonus, acknowledge the extra work without claiming streak progress. " +
        "Do not mention reminders, weekly reviews, billing, or unsupported features.",
    },
    {
      role: "user",
      content: JSON.stringify(prompt),
    },
  ]);

  const brutalContent = enforceBrutalDiction(result.content);
  const languageAlignedContent = enforceReplyLanguage({
    content: brutalContent,
    userMessage: input.content,
    mode: input.decision.mode,
  });

  return {
    content: enforceDirectCueForStrictModes({
      content: languageAlignedContent,
      userMessage: input.content,
      mode: input.decision.mode,
    }),
    trace: result.trace,
  };
}

function getPatternSummary(
  context: ChatContext,
  resolvedHabit: Doc<"habits"> | null,
) {
  if (resolvedHabit) {
    const directMatch =
      context.habitSummaries.find(
        (summary) => summary.habitId === resolvedHabit._id,
      ) ?? null;
    if (directMatch) {
      return directMatch;
    }
  }

  if (context.todayHabit) {
    const todayMatch =
      context.habitSummaries.find(
        (summary) => summary.habitId === context.todayHabit?._id,
      ) ?? null;
    if (todayMatch) {
      return todayMatch;
    }
  }

  return context.habitSummaries.length === 1 ? context.habitSummaries[0] : null;
}

function buildChatDecision(input: {
  intent: ChatIntent | OperationalIntent;
  requiredAction: RequiredAction;
  extraction: ChatExtractionResult;
  resolvedHabit: Doc<"habits"> | null;
  context: ChatContext;
  requiresClarification: boolean;
  clarificationQuestion: string | null;
  pendingActionId: Id<"agentPendingActions"> | null;
  duplicateCheckIn: boolean;
  loggedStatus: "completed" | "missed" | "bonus" | null;
  targetDate: string | null;
  targetTime: string | null;
  taskTitle?: string | null;
}): ChatDecision {
  let mode: ResponseMode = "hesitation";

  if (input.requiresClarification) {
    mode =
      input.requiredAction === "reschedule_habit_time" ||
      input.requiredAction === "skip_habit_for_date"
        ? "schedule_update"
        : input.requiredAction === "create_task" ||
            input.requiredAction === "reschedule_task_time" ||
            input.requiredAction === "mark_task_done" ||
            input.requiredAction === "add_task_reminder"
          ? "task_update"
          : "clarify_workout";
  } else if (
    input.requiredAction === "ask_today_plan" ||
    input.requiredAction === "ask_tomorrow_plan" ||
    input.requiredAction === "risk_scan" ||
    input.requiredAction === "simple_reschedule_suggestion"
  ) {
    mode = "planning";
  } else if (
    input.requiredAction === "reschedule_habit_time" ||
    input.requiredAction === "skip_habit_for_date"
  ) {
    mode = "schedule_update";
  } else if (
    input.requiredAction === "create_task" ||
    input.requiredAction === "reschedule_task_time" ||
    input.requiredAction === "mark_task_done" ||
    input.requiredAction === "add_task_reminder"
  ) {
    mode = "task_update";
  } else if (input.extraction.classification === "question") {
    mode = "question";
  } else if (
    input.loggedStatus === "completed" ||
    input.loggedStatus === "bonus"
  ) {
    mode = "completion";
  } else if (input.loggedStatus === "missed") {
    mode = "miss";
  } else if (input.extraction.classification === "excuse") {
    mode = "hesitation";
  }

  return {
    intent: input.intent,
    mode,
    requiredAction: input.requiredAction,
    resolvedHabitId: input.resolvedHabit?._id ?? null,
    questionFocus: input.extraction.questionFocus,
    patternSummary: getPatternSummary(input.context, input.resolvedHabit),
    requiresClarification: input.requiresClarification,
    clarificationQuestion: input.clarificationQuestion,
    pendingActionId: input.pendingActionId,
    duplicateCheckIn: input.duplicateCheckIn,
    loggedStatus: input.loggedStatus,
    shouldLogCheckIn: input.extraction.shouldLogCheckIn,
    targetDate: input.targetDate,
    targetTime: input.targetTime,
    taskTitle: input.taskTitle ?? null,
    plannerMode:
      input.requiredAction === "ask_today_plan"
        ? "today_plan"
        : input.requiredAction === "ask_tomorrow_plan"
          ? "tomorrow_plan"
          : input.requiredAction === "risk_scan"
            ? "risk_scan"
            : input.requiredAction === "simple_reschedule_suggestion"
              ? "simple_reschedule_suggestion"
              : null,
  };
}

async function generateOperationalReply(input: {
  userMessage: string;
  context: ChatContext;
  decision: ChatDecision;
  habitName: string | null;
  actionResultSummary?: string | null;
  actionNoOpReason?:
    | "already_exists"
    | "not_scheduled_on_target_date"
    | "target_date_in_past"
    | "target_time_in_past"
    | null;
  plan?: PlannerPlan | null;
  risk?: RiskScanResult | null;
  suggestions?: RescheduleSuggestionResult | null;
  actionStatus: "executed" | "no_op";
}) {
  const prompt = {
    userMessage: input.userMessage,
    currentTimeContext: summarizeCurrentTimeContext(input.context),
    intent: input.decision.intent,
    requiredAction: input.decision.requiredAction,
    mode: input.decision.mode,
    habitName: input.habitName,
    targetDate: input.decision.targetDate,
    targetTime: input.decision.targetTime,
    taskTitle: input.decision.taskTitle,
    requiresClarification: input.decision.requiresClarification,
    clarificationQuestion: input.decision.clarificationQuestion,
    actionStatus: input.actionStatus,
    actionResultSummary: input.actionResultSummary ?? null,
    actionNoOpReason: input.actionNoOpReason ?? null,
    plan: input.plan,
    risk: input.risk,
    suggestions: input.suggestions,
  };

  const result = await callModelTextWithTrace([
    {
      role: "system",
      content:
        "You are the Streak coach: blunt, concise, slightly brutal, never rambling. " +
        "Keep it concise, natural, and useful. No markdown unless the reply is a planner list. " +
        "Reply in the same language as the user's message. If the user writes informal Indonesian, reply in informal Indonesian. Do not mix languages unless the user did. " +
        "Voice must stay cynical, direct, and strict. Never sound apologetic or overly polite. " +
        "Never use maaf, silakan, tolong, mohon, or please. " +
        "Use currentTimeContext plus plan item timingState and timingNote when available so you clearly distinguish upcoming, overdue, deadline-passed, and already-done items. " +
        "If requiresClarification is true, ask only for the missing fields. " +
        "For planner replies, use a short title and one flat line per item. " +
        "For risk_scan replies, return a short ranked list with at most 3 items. " +
        "For simple_reschedule_suggestion replies, give 1 to 3 realistic suggestions without pretending anything was changed. " +
        "For reschedule confirmation, clearly confirm the habit, date, and time. Give a short cynical nod or jibe. " +
        "For task reschedule confirmation, clearly confirm the task title, date, and time. " +
        "For skip confirmation, clearly confirm the skipped date without treating it like a miss. Don't sound too happy about it. " +
        "For create_task confirmation, clearly confirm the task title, date, and time if available. " +
        "For mark_task_done confirmation, clearly confirm the task is done and no longer pending. Give a small 'about time' or 'done finally' energy. " +
        "For add_task_reminder confirmation, clearly confirm the task title and the reminder offset if available. " +
        "If actionStatus is no_op, it means the task or habit is ALREADY done or not found in pending state. Don't confirm a new action. Instead, give a sharp, cynical nod or roast them for reporting something already in the books. Example: 'Udah dari tadi kali, telat lo lapornya.' or 'Udah masuk database, nggak usah diulang-ulang.' " +
        "If requiredAction is mark_task_done and actionStatus is no_op, prefer roasty wording like 'It was already done. You high?' adapted to the user's language. " +
        "If the user says 'already woke up' but the 'wake up' task is already done, point out your records are faster than their mouth. " +
        "If actionNoOpReason is not_scheduled_on_target_date, this overrides generic no_op wording. Explicitly say the habit is not scheduled on that date and no mutation was applied. " +
        "If actionNoOpReason is target_date_in_past, explicitly say reschedule was blocked because the requested date is already in the past. " +
        "If actionNoOpReason is target_time_in_past, explicitly say reschedule was blocked because the requested time has already passed. " +
        "Never suggest skip_habit_for_date wording when requiredAction is reschedule_habit_time. " +
        "Do not invent unsupported features or extra mutations.",
    },
    {
      role: "user",
      content: JSON.stringify(prompt),
    },
  ]);

  return {
    content: enforceBrutalDiction(result.content),
    trace: result.trace,
  };
}

export const sendMessage = action({
  args: {
    content: v.string(),
    nowOverrideTs: v.optional(v.number()),
    source: v.union(
      v.literal("chat_input"),
      v.literal("quick_complete"),
      v.literal("quick_miss"),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    userMessageId: Id<"messages">;
    aiMessageId: Id<"messages">;
    classification: SendMessageClassification;
    resolvedIntent: ChatIntent | OperationalIntent;
    responseMode: ResponseMode;
    checkInCreatedId?: Id<"checkIns">;
    workoutLogCreatedId?: Id<"workoutLogs">;
    requiresClarification: boolean;
    dailyMessageCount: number;
    remainingMessages: number | null;
    limitReached: boolean;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthorized");
    }

    const content = args.content.trim();
    if (!content) {
      throw new Error("Message content is required");
    }

    const now = args.nowOverrideTs ?? Date.now();
    const context = (await ctx.runQuery(internal.chat.getChatContext, {
      clerkId: identity.subject,
      now,
    })) as ChatContext;

    if (context.user.aiDisabled) {
      const userMessageId = (await ctx.runMutation(internal.chat.storeMessage, {
        userId: context.user._id,
        role: "user",
        content,
        intent: "check_in",
        timestamp: now,
      })) as Id<"messages">;

      const aiMessageId = (await ctx.runMutation(internal.chat.storeMessage, {
        userId: context.user._id,
        role: "ai",
        content:
          "AI is disabled for this dev account. No agent action, model call, reminder reply, or check-in automation will run until you enable it again.",
        intent: "question",
        timestamp: now,
      })) as Id<"messages">;

      return {
        userMessageId,
        aiMessageId,
        classification: "question",
        resolvedIntent: "question",
        responseMode: "question",
        requiresClarification: false,
        dailyMessageCount: context.user.dailyMessageCount,
        remainingMessages: null,
        limitReached: false,
      };
    }

    const pendingAction = (await ctx.runQuery(
      internal.agentActions.getPendingActionForUser,
      {
        userId: context.user._id,
        now,
      },
    )) as Doc<"agentPendingActions"> | null;

    const budget = (await ctx.runMutation(
      internal.users.consumeDailyMessageBudget,
      {
        userId: context.user._id,
        now,
      },
    )) as {
      consumed: boolean;
      dailyMessageCount: number;
      remainingMessages: number | null;
      limitReached: boolean;
    };

    if (!budget.consumed) {
      throw new Error("FREE_DAILY_MESSAGE_LIMIT_REACHED");
    }

    const userMessageId = (await ctx.runMutation(internal.chat.storeMessage, {
      userId: context.user._id,
      role: "user",
      content,
      intent: "check_in",
      timestamp: now,
    })) as Id<"messages">;

    const [chatExtractionResult, operationalExtractionResult] =
      await Promise.all([
        extractChatOutcome({
          content,
          source: args.source,
          context,
        }),
        args.source === "chat_input"
          ? extractOperationalOutcome({
              content,
              context,
              pendingAction,
            })
          : Promise.resolve(null),
      ]);

    const pendingHabit =
      context.pendingClarificationHabitId != null
        ? (context.activeHabits.find(
            (habit) => habit._id === context.pendingClarificationHabitId,
          ) ?? null)
        : null;
    const missHesitationSafetyResult =
      await applyMissHesitationSafetyResolution({
        content,
        extraction: applyDeterministicWorkoutResolution({
          content,
          extraction: chatExtractionResult.extraction,
          pendingWorkoutHabit: pendingHabit,
        }),
        source: args.source,
        context,
        pendingWorkoutHabit: pendingHabit,
      });
    const questionSafetyResult = await applyQuestionSafetyResolution({
      content,
      extraction: missHesitationSafetyResult.extraction,
      source: args.source,
      context,
      pendingWorkoutHabit: pendingHabit,
    });
    const extraction = applyDeterministicTaskChatGuard({
      content,
      context,
      extraction: applyMissKeywordGuard({
        content,
        extraction: questionSafetyResult.extraction,
        source: args.source,
      }),
    });
    const explicitHabit = findHabitByName(
      context.activeHabits,
      extraction.habitName,
    );

    // [FIX] Logical Fallacy: Habit Hijacking.
    // If the last message was a task reminder (habitID unset) and the user didn't explicitly name a habit,
    // and we have an operational intent for a task, we should NOT force resolve to a default habit.
    // This prevents "I'm done" from marking a single active habit (like 'github') when replying to a task.
    const lastMessageWasTaskReminder =
      context.recentMessages.length > 0 &&
      context.recentMessages[context.recentMessages.length - 1].role === "ai" &&
      context.recentMessages[context.recentMessages.length - 1].intent ===
        "task_reminder" &&
      !context.recentMessages[context.recentMessages.length - 1].habitId;

    const emptyOperationalRoute: OperationalRoute = {
      intent: null,
      requiredAction: null,
      targetDate: null,
      targetTime: null,
      taskTitle: null,
      taskId: null,
      reminderOffsetMinutes: null,
      resolvedHabit: null,
      needsClarification: false,
      clarificationQuestion: null,
      missingFields: [],
      payload: {},
    };
    const operationalSafetyResult = await applyOperationalSafetyResolution({
      content,
      extraction: operationalExtractionResult?.extraction ?? null,
      chatExtraction: extraction,
      source: args.source,
      context,
      pendingAction,
    });
    const deterministicOperationalExtraction =
      applyDeterministicScheduleOverride({
        content,
        extraction: applyDeterministicOperationalOverride({
          content,
          extraction: operationalSafetyResult.extraction ?? null,
          context,
          pendingAction,
        }),
        context,
      });
    const operationalExtraction = applyImplicitTaskCompletionOverride({
      content,
      extraction: applyRecentEntityOperationalOverride({
        content,
        extraction: deterministicOperationalExtraction,
        context,
      }),
      context,
    });
    const matchedTaskFromContext = matchTaskFromRecentContext({
      content,
      tasks: context.recentTasks,
    });
    const shouldSuppressDefaultHabit =
      (!explicitHabit &&
        matchedTaskFromContext != null &&
        (operationalExtraction?.intent !== null ||
          extraction.classification === "question" ||
          isTaskCompletionLikeMessage(content))) ||
      (lastMessageWasTaskReminder &&
        !explicitHabit &&
        operationalExtraction?.intent !== null);

    const resolvedHabit =
      explicitHabit ??
      pendingHabit ??
      (shouldSuppressDefaultHabit
        ? null
        : ((context.todayHabits.length === 1 ? context.todayHabits[0] : null) ??
          (context.activeHabits.length === 1
            ? context.activeHabits[0]
            : null)));
    const operationalRoute = operationalExtraction
      ? (buildOperationalRoute({
          extraction: operationalExtraction,
          context,
          pendingAction,
        }).route as OperationalRoute)
      : emptyOperationalRoute;
    const continuingPendingAction = Boolean(
      pendingAction &&
      operationalExtraction?.continuePendingAction &&
      !operationalExtraction?.supersedePendingAction,
    );

    await logModelTrace({
      ctx,
      userId: context.user._id,
      habitId: pendingHabit?._id ?? undefined,
      userMessageId,
      userMessageContent: content,
      source: "chat",
      purpose: "chat_extraction",
      trace: chatExtractionResult.trace,
      createdAt: now,
    });

    if (missHesitationSafetyResult.trace) {
      await logModelTrace({
        ctx,
        userId: context.user._id,
        habitId: pendingHabit?._id ?? undefined,
        userMessageId,
        userMessageContent: content,
        source: "chat",
        purpose: "miss_hesitation_safety_check",
        trace: missHesitationSafetyResult.trace,
        createdAt: now,
      });
    }

    if (questionSafetyResult.trace) {
      await logModelTrace({
        ctx,
        userId: context.user._id,
        habitId: pendingHabit?._id ?? undefined,
        userMessageId,
        userMessageContent: content,
        source: "chat",
        purpose: "question_safety_check",
        trace: questionSafetyResult.trace,
        createdAt: now,
      });
    }

    if (operationalExtractionResult?.trace) {
      await logModelTrace({
        ctx,
        userId: context.user._id,
        habitId: pendingAction?.targetHabitId ?? undefined,
        userMessageId,
        userMessageContent: content,
        source: "chat",
        purpose: "operational_extraction",
        trace: operationalExtractionResult.trace,
        createdAt: now,
      });
    }

    if (operationalSafetyResult.trace) {
      await logModelTrace({
        ctx,
        userId: context.user._id,
        habitId: pendingAction?.targetHabitId ?? undefined,
        userMessageId,
        userMessageContent: content,
        source: "chat",
        purpose: "operational_safety_check",
        trace: operationalSafetyResult.trace,
        createdAt: now,
      });
    }
    const resolvedTurn = resolveTurn({
      context,
      extraction,
      operationalRoute,
      pendingAction,
      continuingPendingAction,
      resolvedHabit,
      pendingWorkoutHabit: pendingHabit,
    });
    const effectiveHabit = resolvedTurn.resolvedHabit;
    const effectiveMemoryContext = buildEffectiveMemoryContext(
      context,
      effectiveHabit,
    );

    if (resolvedTurn.pendingActionToCancel) {
      await ctx.runMutation(internal.agentActions.logAction, {
        userId: context.user._id,
        messageId: resolvedTurn.pendingActionToCancel.messageId,
        intent: resolvedTurn.pendingActionToCancel.intent,
        actionType: resolvedTurn.pendingActionToCancel.actionType,
        targetType: getOperationalTargetType(
          resolvedTurn.pendingActionToCancel.actionType,
        ),
        targetId: resolvedTurn.pendingActionToCancel.targetHabitId,
        status: "cancelled",
        inputSummary: "pending action superseded by newer user request",
        resultSummary: content,
        createdAt: now,
      });

      await ctx.runMutation(internal.agentActions.clearPendingAction, {
        id: resolvedTurn.pendingActionToCancel._id,
      });
    }

    if (resolvedTurn.kind === "operational_clarification") {
      await ctx.runMutation(internal.chat.updateStoredMessage, {
        id: userMessageId,
        habitId: resolvedTurn.resolvedHabit?._id,
        intent: resolvedTurn.userIntent,
      });

      const pendingActionId = (await ctx.runMutation(
        internal.agentActions.upsertPendingAction,
        {
          userId: context.user._id,
          messageId: userMessageId,
          intent: resolvedTurn.userIntent,
          actionType: resolvedTurn.requiredAction ?? resolvedTurn.userIntent,
          targetHabitId: resolvedTurn.resolvedHabit?._id,
          payload: resolvedTurn.route.payload,
          missingFields: resolvedTurn.route.missingFields,
          clarificationQuestion:
            resolvedTurn.route.clarificationQuestion ?? "Bikin jelas dulu.",
          expiresAt: now + 24 * 60 * 60 * 1000,
          now,
        },
      )) as Id<"agentPendingActions">;

      const clarificationExtraction: ChatExtractionResult = {
        classification: "question",
        habitName: resolvedTurn.resolvedHabit?.name ?? null,
        shouldLogCheckIn: false,
        checkInStatus: null,
        questionFocus: "general",
        reason: null,
        conversationSummary: null,
        needsWorkoutClarification: false,
        workout: null,
      };
      const decision = buildChatDecision({
        intent: resolvedTurn.userIntent,
        requiredAction: resolvedTurn.requiredAction,
        extraction: clarificationExtraction,
        resolvedHabit: resolvedTurn.resolvedHabit,
        context: effectiveMemoryContext,
        requiresClarification: true,
        clarificationQuestion: resolvedTurn.route.clarificationQuestion,
        pendingActionId,
        duplicateCheckIn: false,
        loggedStatus: null,
        targetDate: resolvedTurn.route.targetDate,
        targetTime: resolvedTurn.route.targetTime,
        taskTitle: resolvedTurn.route.taskTitle,
      });

      const operationalReplyResult = (await generateOperationalReply({
        userMessage: content,
        context: effectiveMemoryContext,
        decision,
        habitName: resolvedTurn.resolvedHabit?.name ?? null,
        actionStatus: "executed",
      }).catch(() =>
        Promise.resolve({
          content: buildModelUnavailableReply(content),
          trace: null,
        }),
      )) ?? { content: null, trace: null };
      const aiContent =
        operationalReplyResult.content ?? buildModelUnavailableReply(content);

      await ctx.runMutation(internal.agentActions.logAction, {
        userId: context.user._id,
        messageId: userMessageId,
        intent: resolvedTurn.userIntent,
        actionType: resolvedTurn.requiredAction ?? resolvedTurn.userIntent,
        targetType: getOperationalTargetType(resolvedTurn.requiredAction),
        targetId: resolvedTurn.resolvedHabit?._id,
        status: "clarification_requested",
        inputSummary: content,
        resultSummary: aiContent,
        createdAt: now,
      });

      const aiMessageId = (await ctx.runMutation(internal.chat.storeMessage, {
        userId: context.user._id,
        habitId: resolvedTurn.resolvedHabit?._id,
        role: "ai",
        content: aiContent,
        intent: resolvedTurn.userIntent,
        timestamp: now,
      })) as Id<"messages">;

      await logModelTrace({
        ctx,
        userId: context.user._id,
        habitId: resolvedTurn.resolvedHabit?._id,
        userMessageId,
        aiMessageId,
        userMessageContent: content,
        aiMessageContent: aiContent,
        source: "chat",
        purpose: "operational_reply",
        trace: operationalReplyResult.trace,
        createdAt: now,
      });

      return {
        userMessageId,
        aiMessageId,
        classification: getOperationalReturnClassification(resolvedTurn),
        resolvedIntent: resolvedTurn.userIntent,
        responseMode: getResolvedReturnMode({ resolvedTurn, decision }),
        requiresClarification: true,
        dailyMessageCount: budget.dailyMessageCount,
        remainingMessages: budget.remainingMessages,
        limitReached: budget.limitReached,
      };
    }

    if (resolvedTurn.kind === "operational_execution") {
      await ctx.runMutation(internal.chat.updateStoredMessage, {
        id: userMessageId,
        habitId: resolvedTurn.resolvedHabit?._id,
        intent: resolvedTurn.userIntent,
      });

      let habitName: string | null = resolvedTurn.resolvedHabit?.name ?? null;
      let actionStatus: "executed" | "no_op" = "executed";
      let actionNoOpReason:
        | "already_exists"
        | "not_scheduled_on_target_date"
        | "target_date_in_past"
        | "target_time_in_past"
        | null = null;
      let actionResultSummary = "";
      let plan: PlannerPlan | null = null;
      let risk: RiskScanResult | null = null;
      let suggestions: RescheduleSuggestionResult | null = null;
      let taskId: Id<"agentTasks"> | null = null;

      if (resolvedTurn.requiredAction === "reschedule_habit_time") {
        const result = (await ctx.runMutation(
          internal.agentActions.executeRescheduleHabitTime,
          {
            userId: context.user._id,
            habitId: resolvedTurn.resolvedHabit!._id,
            targetDate: resolvedTurn.route.targetDate!,
            targetTime: resolvedTurn.route.targetTime!,
          },
        )) as {
          status: "executed" | "no_op";
          reason:
            | "not_scheduled_on_target_date"
            | "target_date_in_past"
            | "target_time_in_past"
            | null;
          habitName: string;
          targetDate: string;
          targetTime: string;
        };
        habitName = result.habitName;
        actionStatus = result.status;
        actionNoOpReason = result.reason;
        actionResultSummary =
          result.status === "no_op"
            ? result.reason === "not_scheduled_on_target_date"
              ? `reschedule ignored because habit is not scheduled on ${result.targetDate}`
              : result.reason === "target_date_in_past"
                ? `reschedule blocked because ${result.targetDate} is in the past`
                : result.reason === "target_time_in_past"
                  ? `reschedule blocked because ${result.targetDate} ${result.targetTime} is already past`
                  : `reschedule no-op for ${result.targetDate}`
            : `rescheduled to ${result.targetDate} ${result.targetTime}`;
      } else if (resolvedTurn.requiredAction === "skip_habit_for_date") {
        const result = (await ctx.runMutation(
          internal.agentActions.executeSkipHabitForDate,
          {
            userId: context.user._id,
            habitId: resolvedTurn.resolvedHabit!._id,
            date: resolvedTurn.route.targetDate!,
            reason: undefined,
            now,
          },
        )) as {
          habitName: string;
          date: string;
          status: "executed" | "no_op";
          reason: "already_exists" | "not_scheduled_on_target_date" | null;
        };
        habitName = result.habitName;
        actionStatus = result.status;
        actionNoOpReason = result.reason;
        actionResultSummary =
          result.status === "no_op"
            ? result.reason === "not_scheduled_on_target_date"
              ? `skip ignored because habit is not scheduled on ${result.date}`
              : `skip already existed for ${result.date}`
            : `skip created for ${result.date}`;
      } else if (resolvedTurn.requiredAction === "create_task") {
        const result = (await ctx.runMutation(
          internal.agentActions.createTask,
          {
            userId: context.user._id,
            title: resolvedTurn.route.taskTitle!,
            date: resolvedTurn.route.targetDate!,
            time: resolvedTurn.route.targetTime!,
            source: "chat",
            reminderOffsetMinutes:
              resolvedTurn.route.reminderOffsetMinutes ?? 30,
            now,
          },
        )) as {
          status: "executed" | "no_op";
          taskId: Id<"agentTasks">;
          title: string;
          date: string;
          time: string | null;
        };
        actionStatus = result.status;
        taskId = result.taskId;
        actionResultSummary =
          result.status === "no_op"
            ? `task already existed for ${result.date}`
            : `task created for ${result.date}${result.time ? ` ${result.time}` : ""}`;
      } else if (resolvedTurn.requiredAction === "reschedule_task_time") {
        const result = (await ctx.runMutation(
          internal.agentActions.executeRescheduleTaskTime,
          {
            userId: context.user._id,
            taskId: resolvedTurn.route.taskId!,
            targetDate: resolvedTurn.route.targetDate!,
            targetTime: resolvedTurn.route.targetTime!,
            now,
          },
        )) as {
          status: "executed" | "no_op";
          taskId: Id<"agentTasks">;
          title: string;
          date: string;
          time: string | null;
        };
        actionStatus = result.status;
        taskId = result.taskId;
        actionResultSummary =
          result.status === "no_op"
            ? `task schedule already set to ${result.date}${result.time ? ` ${result.time}` : ""}`
            : `task rescheduled to ${result.date}${result.time ? ` ${result.time}` : ""}`;
      } else if (resolvedTurn.requiredAction === "mark_task_done") {
        const result = (await ctx.runMutation(
          internal.agentActions.markTaskDone,
          {
            userId: context.user._id,
            taskId: resolvedTurn.route.taskId!,
            now,
          },
        )) as {
          status: "executed" | "no_op";
          taskId: Id<"agentTasks">;
          title: string;
          doneAt: number | null;
        };
        actionStatus = result.status;
        taskId = result.taskId;
        actionResultSummary =
          result.status === "no_op"
            ? `${result.title} was already done`
            : `${result.title} marked done`;
      } else if (resolvedTurn.requiredAction === "add_task_reminder") {
        const reminderOffsetMinutes =
          resolvedTurn.route.reminderOffsetMinutes ?? 30;

        if (!resolvedTurn.route.taskId) {
          const created = (await ctx.runMutation(
            internal.agentActions.createTask,
            {
              userId: context.user._id,
              title: resolvedTurn.route.taskTitle!,
              date: resolvedTurn.route.targetDate!,
              time: resolvedTurn.route.targetTime!,
              source: "chat",
              reminderOffsetMinutes,
              now,
            },
          )) as {
            status: "executed" | "no_op";
            taskId: Id<"agentTasks">;
            title: string;
            date: string;
            time: string | null;
          };
          taskId = created.taskId;

          const reminder = (await ctx.runMutation(
            internal.agentActions.addTaskReminder,
            {
              userId: context.user._id,
              taskId: created.taskId,
              offsetMinutes: reminderOffsetMinutes,
              now,
            },
          )) as {
            status: "executed" | "no_op";
            taskId: Id<"agentTasks">;
            title: string;
            scheduledFor: number | null;
            offsetMinutes: number;
          };
          actionStatus =
            created.status === "executed" || reminder.status === "executed"
              ? "executed"
              : "no_op";
          actionResultSummary =
            created.status === "executed"
              ? `task created and reminder added ${reminder.offsetMinutes} minutes before`
              : `task reminder added ${reminder.offsetMinutes} minutes before`;
        } else {
          const result = (await ctx.runMutation(
            internal.agentActions.addTaskReminder,
            {
              userId: context.user._id,
              taskId: resolvedTurn.route.taskId,
              offsetMinutes: reminderOffsetMinutes,
              now,
            },
          )) as {
            status: "executed" | "no_op";
            taskId: Id<"agentTasks">;
            title: string;
            scheduledFor: number | null;
            offsetMinutes: number;
          };
          actionStatus = result.status;
          taskId = result.taskId;
          actionResultSummary =
            result.status === "no_op"
              ? `task reminder already set ${result.offsetMinutes} minutes before`
              : `task reminder added ${result.offsetMinutes} minutes before`;
        }
      } else if (
        resolvedTurn.requiredAction === "ask_today_plan" ||
        resolvedTurn.requiredAction === "ask_tomorrow_plan"
      ) {
        plan = await ctx.runQuery(internal.agentActions.getPlanForDate, {
          userId: context.user._id,
          date: resolvedTurn.route.targetDate!,
          now,
        });
        actionResultSummary = `returned ${plan?.items.length ?? 0} plan items`;
      } else if (resolvedTurn.requiredAction === "risk_scan") {
        risk = await ctx.runQuery(internal.agentActions.getRiskScan, {
          userId: context.user._id,
          date: resolvedTurn.route.targetDate ?? context.date,
          now,
        });
        actionResultSummary = `returned ${risk?.items.length ?? 0} risk items`;
      } else if (
        resolvedTurn.requiredAction === "simple_reschedule_suggestion"
      ) {
        suggestions = await ctx.runQuery(
          internal.agentActions.getSimpleRescheduleSuggestions,
          {
            userId: context.user._id,
            date:
              resolvedTurn.route.targetDate ?? shiftDateKey(context.date, 1),
            now,
          },
        );
        actionResultSummary = `returned ${suggestions?.items.length ?? 0} suggestions`;
      }

      if (continuingPendingAction && pendingAction) {
        await ctx.runMutation(internal.agentActions.clearPendingAction, {
          id: pendingAction._id,
        });
      }

      const executionExtraction: ChatExtractionResult = {
        classification: "question",
        habitName,
        shouldLogCheckIn: false,
        checkInStatus: null,
        questionFocus: "general",
        reason: null,
        conversationSummary: null,
        needsWorkoutClarification: false,
        workout: null,
      };
      const decision = buildChatDecision({
        intent: resolvedTurn.userIntent,
        requiredAction: resolvedTurn.requiredAction,
        extraction: executionExtraction,
        resolvedHabit: resolvedTurn.resolvedHabit,
        context: effectiveMemoryContext,
        requiresClarification: false,
        clarificationQuestion: null,
        pendingActionId: null,
        duplicateCheckIn: false,
        loggedStatus: null,
        targetDate: resolvedTurn.route.targetDate,
        targetTime: resolvedTurn.route.targetTime,
        taskTitle: resolvedTurn.route.taskTitle,
      });

      const operationalReplyResult = (await generateOperationalReply({
        userMessage: content,
        context: effectiveMemoryContext,
        decision,
        habitName,
        actionResultSummary,
        actionNoOpReason,
        plan,
        risk,
        suggestions,
        actionStatus,
      }).catch(() =>
        Promise.resolve({
          content: buildModelUnavailableReply(content),
          trace: null,
        }),
      )) ?? { content: buildModelUnavailableReply(content), trace: null };
      const aiContent =
        operationalReplyResult.content ?? buildModelUnavailableReply(content);

      await ctx.runMutation(internal.agentActions.logAction, {
        userId: context.user._id,
        messageId: userMessageId,
        intent: resolvedTurn.userIntent,
        actionType: resolvedTurn.requiredAction ?? resolvedTurn.userIntent,
        targetType: getOperationalTargetType(resolvedTurn.requiredAction),
        targetId: taskId ?? resolvedTurn.resolvedHabit?._id,
        status: actionStatus,
        inputSummary: content,
        resultSummary: actionResultSummary || aiContent,
        createdAt: now,
      });

      if (
        resolvedTurn.requiredAction === "skip_habit_for_date" &&
        resolvedTurn.resolvedHabit &&
        resolvedTurn.route.targetDate &&
        actionStatus === "executed"
      ) {
        await ctx.runMutation(internal.agentMemory.recordEpisode, {
          userId: context.user._id,
          habitId: resolvedTurn.resolvedHabit._id,
          date: context.date,
          type: "habit_skipped",
          summary: `${resolvedTurn.resolvedHabit.name} was intentionally skipped for ${resolvedTurn.route.targetDate}.`,
          metadata: {
            targetDate: resolvedTurn.route.targetDate,
          },
          sourceMessageId: userMessageId,
          createdAt: now,
        });
      }

      const aiMessageId = (await ctx.runMutation(internal.chat.storeMessage, {
        userId: context.user._id,
        habitId: resolvedTurn.resolvedHabit?._id,
        role: "ai",
        content: aiContent,
        intent:
          resolvedTurn.requiredAction === "ask_today_plan" ||
          resolvedTurn.requiredAction === "ask_tomorrow_plan" ||
          resolvedTurn.requiredAction === "risk_scan" ||
          resolvedTurn.requiredAction === "simple_reschedule_suggestion"
            ? "planning"
            : resolvedTurn.requiredAction === "create_task" ||
                resolvedTurn.requiredAction === "reschedule_task_time" ||
                resolvedTurn.requiredAction === "mark_task_done" ||
                resolvedTurn.requiredAction === "add_task_reminder"
              ? "task_update"
              : "schedule_update",
        timestamp: now,
      })) as Id<"messages">;

      await logModelTrace({
        ctx,
        userId: context.user._id,
        habitId: resolvedTurn.resolvedHabit?._id,
        userMessageId,
        aiMessageId,
        userMessageContent: content,
        aiMessageContent: aiContent,
        source: "chat",
        purpose: "operational_reply",
        trace: operationalReplyResult.trace,
        createdAt: now,
      });

      const reminderRunAdvance =
        actionStatus === "executed"
          ? buildReminderRunChatAdvance({
              resolvedTurn,
              context: effectiveMemoryContext,
              resolvedHabit: resolvedTurn.resolvedHabit,
              extraction: executionExtraction,
              content,
            })
          : null;

      if (reminderRunAdvance) {
        await ctx.runMutation(internal.reminders.advanceReminderRun, {
          userId: context.user._id,
          habitId: reminderRunAdvance.habitId,
          date: reminderRunAdvance.date,
          state: reminderRunAdvance.state,
          now,
          userResponded: true,
          responseIntent: reminderRunAdvance.responseIntent,
          responseSummary: reminderRunAdvance.responseSummary,
        });
      }

      return {
        userMessageId,
        aiMessageId,
        classification: getOperationalReturnClassification(resolvedTurn),
        resolvedIntent: resolvedTurn.userIntent,
        responseMode: getResolvedReturnMode({ resolvedTurn, decision }),
        requiresClarification: false,
        dailyMessageCount: budget.dailyMessageCount,
        remainingMessages: budget.remainingMessages,
        limitReached: budget.limitReached,
      };
    }

    const baseResolvedHabit =
      resolvedTurn.kind === "conversation_only"
        ? resolvedTurn.resolvedHabit
        : resolvedTurn.resolvedHabit;
    const baseExtraction = resolvedTurn.extraction;
    const loggedStatus =
      resolvedTurn.kind === "checkin_clarification" ||
      resolvedTurn.kind === "checkin_execution" ||
      resolvedTurn.kind === "duplicate_no_op"
        ? resolvedTurn.checkInStatus
        : null;
    const decision = buildChatDecision({
      intent: resolvedTurn.userIntent,
      requiredAction: resolvedTurn.requiredAction,
      extraction: {
        ...baseExtraction,
        shouldLogCheckIn:
          resolvedTurn.kind === "checkin_execution" ||
          resolvedTurn.kind === "duplicate_no_op",
      },
      resolvedHabit: baseResolvedHabit,
      context: effectiveMemoryContext,
      requiresClarification: resolvedTurn.kind === "checkin_clarification",
      clarificationQuestion: null,
      pendingActionId: null,
      duplicateCheckIn: resolvedTurn.kind === "duplicate_no_op",
      loggedStatus,
      targetDate: context.date,
      targetTime: null,
    });

    const userIntent =
      resolvedTurn.kind === "conversation_only"
        ? resolvedTurn.userIntent
        : resolvedTurn.userIntent;
    await ctx.runMutation(internal.chat.updateStoredMessage, {
      id: userMessageId,
      habitId: baseResolvedHabit?._id,
      intent: userIntent,
    });

    let checkInExecutionResult: CheckInExecutionResult | null = null;
    if (resolvedTurn.kind === "checkin_execution") {
      if (resolvedTurn.requiredAction === "log_miss") {
        checkInExecutionResult = (await ctx.runMutation(
          internal.agentActions.executeLogMiss,
          {
            userId: context.user._id,
            habitId: resolvedTurn.resolvedHabit._id,
            date: context.date,
            reason: resolvedTurn.extraction.reason ?? undefined,
            conversationSummary:
              resolvedTurn.extraction.conversationSummary ?? undefined,
            timestamp: now,
          },
        )) as CheckInExecutionResult;
      } else {
        checkInExecutionResult = (await ctx.runMutation(
          internal.agentActions.executeLogCompletion,
          {
            userId: context.user._id,
            habitId: resolvedTurn.resolvedHabit._id,
            date: context.date,
            status:
              resolvedTurn.checkInStatus === "bonus" ? "bonus" : "completed",
            reason: resolvedTurn.extraction.reason ?? undefined,
            conversationSummary:
              resolvedTurn.extraction.conversationSummary ?? undefined,
            workout:
              resolvedTurn.workout && resolvedTurn.workout.exercises.length > 0
                ? resolvedTurn.workout
                : undefined,
            timestamp: now,
          },
        )) as CheckInExecutionResult;
      }
    }

    const coachReplyResult = await generateCoachReply({
      content,
      context: effectiveMemoryContext,
      extraction: {
        ...baseExtraction,
        shouldLogCheckIn:
          resolvedTurn.kind === "checkin_execution" ||
          resolvedTurn.kind === "duplicate_no_op",
      },
      resolvedHabit: baseResolvedHabit,
      decision,
      resolvedTurnKind: resolvedTurn.kind,
      actionStatus:
        resolvedTurn.kind === "duplicate_no_op"
          ? "no_op"
          : checkInExecutionResult?.status,
      workoutDetailStatus:
        resolvedTurn.kind === "checkin_clarification"
          ? "needs_more_detail"
          : resolvedTurn.kind === "checkin_execution" &&
              resolvedTurn.requiredAction === "log_completion"
            ? "accepted"
            : null,
    });
    const aiContent = coachReplyResult.content;

    if (checkInExecutionResult?.status === "executed") {
      await ctx.runMutation(internal.chat.updateCheckInAiResponse, {
        id: checkInExecutionResult.checkInId,
        aiResponse: aiContent,
      });
    }

    if (
      resolvedTurn.kind === "checkin_execution" ||
      resolvedTurn.kind === "duplicate_no_op"
    ) {
      await ctx.runMutation(internal.agentActions.logAction, {
        userId: context.user._id,
        messageId: userMessageId,
        intent: resolvedTurn.userIntent,
        actionType: resolvedTurn.requiredAction,
        targetType: "habit",
        targetId: resolvedTurn.resolvedHabit._id,
        status:
          resolvedTurn.kind === "duplicate_no_op"
            ? "no_op"
            : (checkInExecutionResult?.status ?? "executed"),
        inputSummary: content,
        resultSummary:
          resolvedTurn.kind === "duplicate_no_op"
            ? "check-in already existed for that habit/date"
            : `logged ${resolvedTurn.checkInStatus}`,
        createdAt: now,
      });
    }

    const aiIntent: ChatIntent =
      resolvedTurn.kind === "checkin_clarification"
        ? "clarify_workout"
        : resolvedTurn.kind === "checkin_execution" ||
            resolvedTurn.kind === "duplicate_no_op"
          ? resolvedTurn.checkInStatus
          : normalizeIntent(baseExtraction.classification);
    const aiMessageId = (await ctx.runMutation(internal.chat.storeMessage, {
      userId: context.user._id,
      habitId: baseResolvedHabit?._id,
      role: "ai",
      content: aiContent,
      intent: aiIntent,
      timestamp: now,
    })) as Id<"messages">;

    await logModelTrace({
      ctx,
      userId: context.user._id,
      habitId: baseResolvedHabit?._id,
      userMessageId,
      aiMessageId,
      userMessageContent: content,
      aiMessageContent: aiContent,
      source: "chat",
      purpose: "coach_reply",
      trace: coachReplyResult.trace,
      createdAt: now,
    });

    const reminderRunAdvance = buildReminderRunChatAdvance({
      resolvedTurn,
      context: effectiveMemoryContext,
      resolvedHabit: baseResolvedHabit,
      extraction: baseExtraction,
      content,
    });

    if (reminderRunAdvance) {
      await ctx.runMutation(internal.reminders.advanceReminderRun, {
        userId: context.user._id,
        habitId: reminderRunAdvance.habitId,
        date: reminderRunAdvance.date,
        state: reminderRunAdvance.state,
        now,
        userResponded: true,
        responseIntent: reminderRunAdvance.responseIntent,
        responseSummary: reminderRunAdvance.responseSummary,
      });
    }

    const reminderStatus = getHabitReminderStatus(
      effectiveMemoryContext,
      baseResolvedHabit?._id ?? null,
    );
    const hasSentReminderToday = Boolean(reminderStatus?.sentTypes.length);

    if (
      resolvedTurn.kind === "checkin_execution" &&
      resolvedTurn.requiredAction === "log_miss"
    ) {
      await ctx.runMutation(internal.agentMemory.recordEpisode, {
        userId: context.user._id,
        habitId: resolvedTurn.resolvedHabit._id,
        date: context.date,
        type: "miss_with_reason",
        summary: resolvedTurn.extraction.reason?.trim()
          ? `${resolvedTurn.resolvedHabit.name} missed with reason: ${resolvedTurn.extraction.reason.trim()}`
          : `${resolvedTurn.resolvedHabit.name} was missed.`,
        metadata: {
          status: "missed",
          reason: resolvedTurn.extraction.reason,
          reminderSentToday: hasSentReminderToday,
        },
        sourceMessageId: userMessageId,
        createdAt: now,
      });
    }

    if (
      resolvedTurn.kind === "checkin_execution" &&
      resolvedTurn.requiredAction === "log_completion"
    ) {
      await ctx.runMutation(internal.agentMemory.recordEpisode, {
        userId: context.user._id,
        habitId: resolvedTurn.resolvedHabit._id,
        date: context.date,
        type: hasSentReminderToday
          ? "recovered_after_prompt"
          : "completed_with_effort",
        summary: `${resolvedTurn.resolvedHabit.name} completed with concrete workout detail.`,
        metadata: {
          status: resolvedTurn.checkInStatus,
          workout: resolvedTurn.workout,
          reminderSentToday: hasSentReminderToday,
        },
        sourceMessageId: userMessageId,
        createdAt: now,
      });
    }

    if (
      resolvedTurn.kind === "conversation_only" &&
      resolvedTurn.extraction.classification === "excuse" &&
      baseResolvedHabit
    ) {
      await ctx.runMutation(internal.agentMemory.recordEpisode, {
        userId: context.user._id,
        habitId: baseResolvedHabit._id,
        date: context.date,
        type: hasSentReminderToday
          ? "user_acknowledged"
          : "hesitation_detected",
        summary: resolvedTurn.extraction.reason?.trim()
          ? `${baseResolvedHabit.name} hesitation: ${resolvedTurn.extraction.reason.trim()}`
          : `${baseResolvedHabit.name} hesitation detected.`,
        metadata: {
          reason: resolvedTurn.extraction.reason,
          reminderSentToday: hasSentReminderToday,
        },
        sourceMessageId: userMessageId,
        createdAt: now,
      });
    }

    return {
      userMessageId,
      aiMessageId,
      classification:
        resolvedTurn.kind === "checkin_clarification"
          ? "clarify_workout"
          : baseExtraction.classification,
      resolvedIntent: userIntent,
      responseMode: getResolvedReturnMode({ resolvedTurn, decision }),
      checkInCreatedId: checkInExecutionResult?.checkInId,
      workoutLogCreatedId: checkInExecutionResult?.workoutLogId,
      requiresClarification: resolvedTurn.kind === "checkin_clarification",
      dailyMessageCount: budget.dailyMessageCount,
      remainingMessages: budget.remainingMessages,
      limitReached: budget.limitReached,
    };
  },
});
