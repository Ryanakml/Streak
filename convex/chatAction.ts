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
  "skip_habit_for_date",
  "create_task",
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

type SendMessageClassification =
  | ChatClassification
  | OperationalIntent;

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
  | "skip_habit_for_date"
  | "create_task"
  | "ask_today_plan"
  | "ask_tomorrow_plan"
  | "risk_scan"
  | "simple_reschedule_suggestion";

type RequiredAction =
  | "log_completion"
  | "log_miss"
  | "reschedule_habit_time"
  | "skip_habit_for_date"
  | "create_task"
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
  resolvedHabit: Doc<"habits"> | null;
  needsClarification: boolean;
  clarificationQuestion: string | null;
  missingFields: string[];
  payload: Record<string, string | null>;
};

type OperationalExtractionResult = {
  intent: OperationalIntent | null;
  habitName: string | null;
  targetDate: string | null;
  targetTime: string | null;
  taskTitle: string | null;
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
  todayDayKey: string;
  activeHabits: Doc<"habits">[];
  todayHabits: Doc<"habits">[];
  todayHabit: Doc<"habits"> | null;
  todayCheckIns: Doc<"checkIns">[];
  recentMessages: MessageSnapshot[];
  recentCheckIns: Doc<"checkIns">[];
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

function isHabitScheduledOnDay(habit: Doc<"habits"> | null, dayKey: string) {
  return Boolean(habit && habit.targetDays.includes(dayKey));
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

function getPrimaryQuestionSignal(args: {
  decision: ChatDecision;
  context: ChatContext;
}) {
  if (args.decision.mode !== "question") {
    return null;
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

  const statSignal = summarizeStatSignal(args.decision.patternSummary);
  const episodeSignal = getStrongestEpisodeSignal(args.context);
  const memorySignal = args.context.habitMemorySummary ?? args.context.globalMemorySummary;

  if (args.decision.questionFocus === "pattern") {
    return episodeSignal && episodeSignal !== memorySignal
      ? episodeSignal
      : statSignal;
  }

  return memorySignal && memorySignal !== statSignal ? memorySignal : episodeSignal;
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
    if (args.resolvedTurn.requiredAction === "create_task") {
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
    if (missingFields.includes("habit") && missingFields.includes("date") && missingFields.includes("time")) {
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

  if (actionType === "create_task") {
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

  const durationMatch = raw.match(/(\d+(?:[.,]\d+)?)\s*(min|mins|minute|minutes|menit)\b/i);
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
    todayDayKey: input.context.todayDayKey,
    pendingClarificationHabitId: input.context.pendingClarificationHabitId,
    todayHabits: input.context.todayHabits.map(summarizeHabit),
    todayHabit: input.context.todayHabit
      ? summarizeHabit(input.context.todayHabit)
      : null,
    activeHabits: input.context.activeHabits.map(summarizeHabit),
    todayCheckIns: input.context.todayCheckIns.map(summarizeCheckIn),
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
      intent === "skip_habit_for_date" ||
      intent === "create_task" ||
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
    continuePendingAction: Boolean(candidate.continuePendingAction),
    supersedePendingAction: Boolean(candidate.supersedePendingAction),
    clarificationQuestion:
      coerceString(candidate.clarificationQuestion) || null,
  };
}

async function extractOperationalOutcome(input: {
  content: string;
  context: ChatContext;
  pendingAction: Doc<"agentPendingActions"> | null;
}) {
  const prompt = {
    todayDate: input.context.date,
    timezone: input.context.user.timezone ?? "UTC",
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
    userMessage: input.content,
  };

  const result = await callModelJsonWithTrace([
    {
      role: "system",
      content:
        "You detect operational habit and secretary commands plus clarification follow-ups. " +
        "Return valid JSON only with keys intent, habitName, targetDate, targetTime, taskTitle, continuePendingAction, supersedePendingAction, clarificationQuestion. " +
        "intent must be one of reschedule_habit_time, skip_habit_for_date, create_task, ask_today_plan, ask_tomorrow_plan, risk_scan, simple_reschedule_suggestion, or none. " +
        "ask_today_plan is only for requests about today's agenda, what's left today, what is not finished today, or today's remaining work. " +
        "ask_tomorrow_plan is only for requests about tomorrow's agenda or tomorrow's plan. " +
        "risk_scan is only for requests asking which item is most at risk, most likely to be missed, or most rawan kelewat. " +
        "simple_reschedule_suggestion is only for requests asking what should be shifted, what is easiest to move, or what should be rescheduled, without asking to mutate anything yet. " +
        "create_task is only for one-off tasks like review deck, call mom, pay bills, send invoice, or follow up client. " +
        "none is for general questions that are not planner commands, not task creation, and not explicit habit operations. " +
        "targetDate must be yyyy-MM-dd or null. Resolve relative dates like hari ini and besok using todayDate. " +
        "targetTime must be HH:mm 24-hour format or null. Resolve phrases like jam 7 malam into exact time. " +
        "taskTitle must be a short clean task title or null. " +
        "skip_habit_for_date means an intentional planned skip. " +
        "Do not classify failure or missed-result reports like gagal, kelewat, ga jadi, tidak sempat, or miss hari ini as skip. Leave those as intent none so conversational logging can handle them. " +
        "Messages like skip besok or gue mau skip besok are still skip_habit_for_date even if the habit is missing and needs clarification. " +
        "Messages like skip gym besok are skip_habit_for_date, not missed. " +
        "Messages like gue gagal gym hari ini or gym kelewat hari ini are not skip_habit_for_date. " +
        "If there is a pendingAction and the user is clearly answering that clarification, set continuePendingAction=true. " +
        "If there is a pendingAction but the user clearly starts a different request or changes topic, set supersedePendingAction=true. " +
        "If the message is not an operational request, set intent to none. " +
        "Use habitName only when it matches the provided activeHabits. " +
        "If clarification is still needed, write one short clarificationQuestion. " +
        "Examples: user='hari ini apa yang belum beres?' -> intent='ask_today_plan'. " +
        "Example: user='besok gue ngapain aja?' -> intent='ask_tomorrow_plan'. " +
        "Example: user='mana yang paling rawan kelewat minggu ini?' -> intent='risk_scan'. " +
        "Example: user='yang paling enak digeser apa besok?' -> intent='simple_reschedule_suggestion'. " +
        "Example: user='besok review deck jam 9 pagi' -> intent='create_task', taskTitle='review deck', targetDate='tomorrow', targetTime='09:00'. " +
        "Example: user='berapa jarak bumi ke bulan?' -> intent='none'. " +
        "Do not add markdown or prose outside JSON.",
    },
    {
      role: "user",
      content: JSON.stringify(prompt),
    },
  ]);

  return {
    extraction: normalizeOperationalExtraction(parseJsonObject(result.content)),
    trace: result.trace,
  };
}

function buildOperationalRoute(input: {
  extraction: OperationalExtractionResult;
  context: ChatContext;
  pendingAction: Doc<"agentPendingActions"> | null;
}) {
  const pendingPayload = input.pendingAction?.payload as
    | Record<string, string | null>
    | undefined;
  const intent =
    input.extraction.intent ??
    (input.extraction.continuePendingAction && input.pendingAction
      ? (input.pendingAction.intent as OperationalIntent)
      : null);

  if (!intent) {
    return {
      route: {
        intent: null,
        requiredAction: null,
        targetDate: null,
        targetTime: null,
        taskTitle: null,
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

  const fallbackHabit =
    input.pendingAction?.targetHabitId
      ? (input.context.activeHabits.find(
          (habit) => habit._id === input.pendingAction?.targetHabitId,
        ) ?? null)
      : null;
  const resolvedHabit =
    findHabitByName(input.context.activeHabits, input.extraction.habitName) ??
    fallbackHabit ??
    findHabitByName(input.context.activeHabits, pendingPayload?.habitName ?? null) ??
    (input.context.activeHabits.length === 1 ? input.context.activeHabits[0] : null);

  const targetDate =
    input.extraction.targetDate ??
    (intent === "ask_today_plan"
      ? input.context.date
      : intent === "ask_tomorrow_plan"
        ? shiftDateKey(input.context.date, 1)
        : intent === "simple_reschedule_suggestion"
        ? shiftDateKey(input.context.date, 1)
        : null) ??
    (input.extraction.continuePendingAction
      ? pendingPayload?.targetDate ?? null
      : null);
  const targetTime =
    input.extraction.targetTime ??
    (input.extraction.continuePendingAction
      ? pendingPayload?.targetTime ?? null
      : null);
  const taskTitle =
    input.extraction.taskTitle ??
    (input.extraction.continuePendingAction
      ? pendingPayload?.taskTitle ?? null
      : null);

  const missingFields =
    intent === "reschedule_habit_time"
      ? [
          ...(resolvedHabit ? [] : ["habit"]),
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
            ]
        : [];

  return {
    route: {
      intent,
      requiredAction: intent,
      targetDate,
      targetTime,
      taskTitle,
      resolvedHabit:
        intent === "ask_today_plan" ||
        intent === "ask_tomorrow_plan" ||
        intent === "risk_scan" ||
        intent === "simple_reschedule_suggestion" ||
        intent === "create_task"
          ? null
          : resolvedHabit,
      needsClarification: missingFields.length > 0,
      clarificationQuestion:
        input.extraction.clarificationQuestion ||
        buildOperationalClarificationQuestion(intent, missingFields),
      missingFields,
      payload: {
        habitName: resolvedHabit?.name ?? null,
        targetDate,
        targetTime,
        taskTitle,
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

function resolveTurn(input: {
  context: ChatContext;
  extraction: ChatExtractionResult;
  operationalRoute: OperationalRoute;
  pendingAction: Doc<"agentPendingActions"> | null;
  continuingPendingAction: boolean;
  resolvedHabit: Doc<"habits"> | null;
  pendingWorkoutHabit: Doc<"habits"> | null;
}) : ResolvedTurn {
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
    const duplicate = input.context.todayCheckIns.some(
      (entry) => entry.habitId === input.resolvedHabit?._id,
    );

    if (duplicate) {
      return {
        kind: "duplicate_no_op",
        userIntent: "log_miss",
        requiredAction: "log_miss",
        resolvedHabit: input.resolvedHabit,
        checkInStatus: "missed",
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

  if (input.extraction.classification === "clarify_workout" && input.pendingWorkoutHabit) {
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

    const duplicate = input.context.todayCheckIns.some(
      (entry) => entry.habitId === workoutHabit._id,
    );

    if (duplicate) {
      return {
        kind: "duplicate_no_op",
        userIntent: "log_completion",
        requiredAction: "log_completion",
        resolvedHabit: workoutHabit,
        checkInStatus: completionStatus,
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

    const duplicate = input.context.todayCheckIns.some(
      (entry) => entry.habitId === completionHabit._id,
    );

    if (duplicate) {
      return {
        kind: "duplicate_no_op",
        userIntent: "log_completion",
        requiredAction: "log_completion",
        resolvedHabit: completionHabit,
        checkInStatus: completionStatus,
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
  const prompt = {
    userMessage: input.content,
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
    patternSummary: summarizePatternSummary(input.decision.patternSummary),
    primaryQuestionSignal: getPrimaryQuestionSignal({
      decision: input.decision,
      context: input.context,
    }),
    supportingQuestionSignal: getSupportingQuestionSignal({
      decision: input.decision,
      context: input.context,
    }),
    globalMemorySummary: input.context.globalMemorySummary,
    habitMemorySummary: input.context.habitMemorySummary,
    relevantEpisodes: input.context.relevantEpisodes,
    todayHabit: input.context.todayHabit
      ? summarizeHabit(input.context.todayHabit)
      : null,
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
        "Use mode to decide behavior. " +
        "If requiresClarification is true, ask specifically what workout they did so it can be logged. " +
        "If duplicateCheckIn is true, tell them today's result is already logged. " +
        "If resolvedTurnKind is checkin_execution, the result has already been recorded successfully. Never ask for more detail in that case. " +
        "If resolvedTurnKind is checkin_clarification, do not pretend anything was logged yet. " +
        "If workoutDetailStatus is needs_more_detail, ask for more detail and do not confirm success. " +
        "If actionStatus is no_op, acknowledge it was already logged instead of pretending a new mutation happened. " +
        "For completion mode, acknowledge the result and push toward the next concrete action. " +
        "For miss mode, call out the miss, use at most one relevant pattern signal, and reset focus toward the next scheduled chance. " +
        "For hesitation mode, treat excuses as resistance, not as a logged miss, and push the smallest next action. " +
        "For question mode, answer briefly and prioritize the most useful signal for the question. " +
        "If questionFocus is pattern, lead with primaryQuestionSignal when it exists. Prefer repeated reasons, repeated misses, recovery-after-prompt, or reminder-ignore patterns over generic weekly counts. " +
        "If questionFocus is status, use the clearest current-state signal first, then at most one supporting memory clue. " +
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

  return {
    content: result.content.trim(),
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
        : input.requiredAction === "create_task"
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
  } else if (input.requiredAction === "create_task") {
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

function buildPlannerReply(input: {
  intent: "ask_today_plan" | "ask_tomorrow_plan";
  plan: PlannerPlan;
}) {
  const title =
    input.intent === "ask_today_plan"
      ? "Plan hari ini:"
      : "Plan besok:";

  if (input.plan.items.length === 0) {
    return `${title} ga ada item aktif yang perlu lo kerjain. Jangan buang harinya.`;
  }

  const lines = input.plan.items.map((item) => {
    const prefix = item.scheduledTime ? `${item.scheduledTime} ` : "";

    if (item.status === "skipped") {
      return `- ${prefix}${item.title}: skip sengaja.`;
    }

    if (item.status === "completed" || item.status === "done") {
      return `- ${prefix}${item.title}: sudah kelar.`;
    }

    if (item.status === "missed") {
      return `- ${prefix}${item.title}: sudah miss.`;
    }

    if (item.status === "bonus") {
      return `- ${prefix}${item.title}: bonus sudah masuk.`;
    }

    if (item.status === "cancelled") {
      return `- ${prefix}${item.title}: dibatalin.`;
    }

    return `- ${prefix}${item.title}: ${item.riskNote}.`;
  });

  return [title, ...lines].join("\n");
}

function buildRiskScanReply(input: { risk: RiskScanResult }) {
  if (input.risk.items.length === 0) {
    return "Yang rawan minggu ini belum kelihatan parah. Tetap jaga ritme aja.";
  }

  const lines = input.risk.items.map((item, index) => {
    const timing = item.scheduledTime
      ? `${item.date} ${item.scheduledTime}`
      : item.date;
    return `${index + 1}. ${item.title} (${timing}): ${item.reason}. ${item.suggestion}`;
  });

  return ["Paling rawan minggu ini:", ...lines].join("\n");
}

function buildRescheduleSuggestionReply(input: {
  suggestions: RescheduleSuggestionResult;
}) {
  if (input.suggestions.items.length === 0) {
    return "Besok belum ada bentrok yang cukup jelas buat digeser. Schedule-nya masih aman.";
  }

  const lines = input.suggestions.items.map((item) => {
    if (item.currentTime && item.suggestedTime) {
      return `- ${item.title}: dari ${item.currentTime} ke ${item.suggestedTime} karena ${item.reason}.`;
    }

    if (item.suggestedTime) {
      return `- ${item.title}: kasih slot ${item.suggestedTime} karena ${item.reason}.`;
    }

    return `- ${item.title}: ini yang paling enak digeser karena ${item.reason}.`;
  });

  return ["Yang paling enak digeser besok:", ...lines].join("\n");
}

function fallbackOperationalReply(input: {
  decision: ChatDecision;
  habitName: string | null;
  plan?: PlannerPlan | null;
  risk?: RiskScanResult | null;
  suggestions?: RescheduleSuggestionResult | null;
}) {
  if (input.decision.requiresClarification && input.decision.clarificationQuestion) {
    return input.decision.clarificationQuestion;
  }

  if (
    input.decision.requiredAction === "ask_today_plan" ||
    input.decision.requiredAction === "ask_tomorrow_plan"
  ) {
    return buildPlannerReply({
      intent: input.decision.requiredAction,
      plan: input.plan ?? { date: "", items: [], dayKey: "" },
    });
  }

  if (input.decision.requiredAction === "risk_scan") {
    return buildRiskScanReply({
      risk: input.risk ?? { startDate: "", items: [] },
    });
  }

  if (input.decision.requiredAction === "simple_reschedule_suggestion") {
    return buildRescheduleSuggestionReply({
      suggestions: input.suggestions ?? { date: "", items: [] },
    });
  }

  if (input.decision.requiredAction === "reschedule_habit_time") {
    return `${input.habitName ?? "Habit"} gue geser ke ${input.decision.targetTime} untuk ${input.decision.targetDate}.`;
  }

  if (input.decision.requiredAction === "skip_habit_for_date") {
    return `${input.habitName ?? "Habit"} gue tandai skip untuk ${input.decision.targetDate}. Jangan pura-pura lupa besoknya.`;
  }

  if (input.decision.requiredAction === "create_task") {
    const timing = input.decision.targetTime
      ? ` jam ${input.decision.targetTime}`
      : "";
    return `${input.decision.taskTitle ?? "Task"} gue masukin untuk ${input.decision.targetDate}${timing}.`;
  }

  return null;
}

async function generateOperationalReply(input: {
  userMessage: string;
  decision: ChatDecision;
  habitName: string | null;
  plan?: PlannerPlan | null;
  risk?: RiskScanResult | null;
  suggestions?: RescheduleSuggestionResult | null;
  actionStatus: "executed" | "no_op";
}) {
  const prompt = {
    userMessage: input.userMessage,
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
    plan: input.plan,
    risk: input.risk,
    suggestions: input.suggestions,
  };

  const result = await callModelTextWithTrace([
    {
      role: "system",
      content:
        "You write short operational habit assistant replies. " +
        "Keep it concise, natural, and useful. No markdown unless the reply is a planner list. " +
        "Reply in the same language as the user's message. If the user writes informal Indonesian, reply in informal Indonesian. Do not mix languages unless the user did. " +
        "If requiresClarification is true, ask only for the missing fields. " +
        "For planner replies, use a short title and one flat line per item. " +
        "For risk_scan replies, return a short ranked list with at most 3 items. " +
        "For simple_reschedule_suggestion replies, give 1 to 3 realistic suggestions without pretending anything was changed. " +
        "For reschedule confirmation, clearly confirm the habit, date, and time. " +
        "For skip confirmation, clearly confirm the skipped date without treating it like a miss. " +
        "For create_task confirmation, clearly confirm the task title, date, and time if available. " +
        "If actionStatus is no_op, say it was already set/logged instead of pretending something changed. " +
        "Do not invent unsupported features or extra mutations.",
    },
    {
      role: "user",
      content: JSON.stringify(prompt),
    },
  ]);

  return {
    content: result.content.trim(),
    trace: result.trace,
  };
}

export const sendMessage = action({
  args: {
    content: v.string(),
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

    const now = Date.now();
    const context = (await ctx.runQuery(internal.chat.getChatContext, {
      clerkId: identity.subject,
      now,
    })) as ChatContext;
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
      habitId:
        context.pendingClarificationHabitId ??
        (context.todayHabits.length === 1 ? context.todayHabits[0]?._id : undefined),
      role: "user",
      content,
      intent: "check_in",
      timestamp: now,
    })) as Id<"messages">;

    const [chatExtractionResult, operationalExtractionResult] = await Promise.all([
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
    const extraction = applyDeterministicWorkoutResolution({
      content,
      extraction: chatExtractionResult.extraction,
      pendingWorkoutHabit: pendingHabit,
    });
    const explicitHabit = findHabitByName(
      context.activeHabits,
      extraction.habitName,
    );
    const resolvedHabit =
      explicitHabit ??
      pendingHabit ??
      (context.todayHabits.length === 1 ? context.todayHabits[0] : null) ??
      (context.activeHabits.length === 1 ? context.activeHabits[0] : null);
    const emptyOperationalRoute: OperationalRoute = {
      intent: null,
      requiredAction: null,
      targetDate: null,
      targetTime: null,
      taskTitle: null,
      resolvedHabit: null,
      needsClarification: false,
      clarificationQuestion: null,
      missingFields: [],
      payload: {},
    };
    const operationalExtraction = operationalExtractionResult?.extraction ?? null;
    const operationalRoute = operationalExtraction
      ? buildOperationalRoute({
          extraction: operationalExtraction,
          context,
          pendingAction,
        }).route as OperationalRoute
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

      const operationalReplyResult =
        (await generateOperationalReply({
          userMessage: content,
          decision,
          habitName: resolvedTurn.resolvedHabit?.name ?? null,
          actionStatus: "executed",
        }).catch(() =>
          Promise.resolve({
            content: fallbackOperationalReply({
              decision,
              habitName: resolvedTurn.resolvedHabit?.name ?? null,
            }),
            trace: null,
          }),
        )) ?? { content: null, trace: null };
      const aiContent =
        operationalReplyResult.content ??
        resolvedTurn.route.clarificationQuestion ??
        "Bikin jelas dulu.";

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
          habitName: string;
          targetDate: string;
          targetTime: string;
        };
        habitName = result.habitName;
        actionResultSummary = `rescheduled to ${result.targetDate} ${result.targetTime}`;
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
        };
        habitName = result.habitName;
        actionStatus = result.status;
        actionResultSummary =
          result.status === "no_op"
            ? `skip already existed for ${result.date}`
            : `skip created for ${result.date}`;
      } else if (resolvedTurn.requiredAction === "create_task") {
        const result = (await ctx.runMutation(internal.agentActions.createTask, {
          userId: context.user._id,
          title: resolvedTurn.route.taskTitle!,
          date: resolvedTurn.route.targetDate!,
          time: resolvedTurn.route.targetTime ?? undefined,
          now,
        })) as {
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
            date: resolvedTurn.route.targetDate ?? shiftDateKey(context.date, 1),
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

      const operationalReplyResult =
        (await generateOperationalReply({
          userMessage: content,
          decision,
          habitName,
          plan,
          risk,
          suggestions,
          actionStatus,
        }).catch(() =>
          Promise.resolve({
            content: fallbackOperationalReply({
              decision,
              habitName,
              plan,
              risk,
              suggestions,
            }),
            trace: null,
          }),
        )) ?? { content: "Selesai.", trace: null };
      const aiContent = operationalReplyResult.content ?? "Selesai.";

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
        resolvedTurn.requiredAction === "reschedule_habit_time" &&
        resolvedTurn.resolvedHabit &&
        resolvedTurn.route.targetDate &&
        resolvedTurn.route.targetTime &&
        actionStatus === "executed"
      ) {
        await ctx.runMutation(internal.agentMemory.recordEpisode, {
          userId: context.user._id,
          habitId: resolvedTurn.resolvedHabit._id,
          date: context.date,
          type: "schedule_changed",
          summary: `${resolvedTurn.resolvedHabit.name} rescheduled to ${resolvedTurn.route.targetTime} for ${resolvedTurn.route.targetDate}.`,
          metadata: {
            targetDate: resolvedTurn.route.targetDate,
            targetTime: resolvedTurn.route.targetTime,
          },
          sourceMessageId: userMessageId,
          createdAt: now,
        });
      }

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
            : resolvedTurn.requiredAction === "create_task"
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

      const reminderRunAdvance = buildReminderRunChatAdvance({
        resolvedTurn,
        context: effectiveMemoryContext,
        resolvedHabit: resolvedTurn.resolvedHabit,
        extraction: executionExtraction,
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
            : checkInExecutionResult?.status ?? "executed",
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
        summary:
          resolvedTurn.extraction.reason?.trim()
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
        type: hasSentReminderToday ? "recovered_after_prompt" : "completed_with_effort",
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
        type: hasSentReminderToday ? "user_acknowledged" : "hesitation_detected",
        summary:
          resolvedTurn.extraction.reason?.trim()
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
