import { addDays, addMinutes } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { pickMemorySignal, selectMemorySnapshot } from "./agentMemory";

const LOOKAHEAD_DAYS = 7;
const REMINDER_MESSAGE_INTENT = {
  pre_workout: "reminder_pre_workout",
  check_in: "reminder_check_in",
  late_follow_up: "reminder_late_follow_up",
} as const;
const REMINDER_STAGE_ORDER = [
  "pre_workout",
  "check_in",
  "late_follow_up",
] as const;

type ReminderType = keyof typeof REMINDER_MESSAGE_INTENT;
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

type ReminderLanguageHint = "indonesian" | "english";
type ReminderDeliveryKind = "stage_reminder" | "completion_interrupt";
type ReminderTimelinePoint = "post" | "due" | "deadline";
type ReminderInteractionHistory =
  | "fresh"
  | "ghosting"
  | "hesitating"
  | "active_responder"
  | "promised_but_stalling"
  | "silent_completion";
type ReminderAgitationLevel = "low" | "medium" | "high";
type ReminderStageHistoryItem = {
  reminderType: ReminderType;
  timelinePoint: ReminderTimelinePoint;
  scheduledFor: number;
  sent: boolean;
  responseCode: "R" | "D";
  userMessageCount: number;
  userIntent: string | null;
  userSummary: string | null;
};

type ReminderRewriteContext = {
  deliveryKind: ReminderDeliveryKind;
  habitName: string;
  habitRules: string;
  motivation: string;
  reminderType: ReminderType;
  currentTimelinePoint: ReminderTimelinePoint;
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
  reminderRunState: ReminderRunState | null;
  todayPendingTypes: ReminderType[];
  todaySentTypes: ReminderType[];
  languageHint: ReminderLanguageHint;
  interactionHistory: ReminderInteractionHistory;
  responsePattern: string;
  stageHistory: ReminderStageHistoryItem[];
  lastUserResponseIntent: string | null;
  lastUserResponseSummary: string | null;
  isAggravated: boolean;
  agitationLevel: ReminderAgitationLevel;
  voiceDirectives: string[];
  styleSeed: number;
  completionStatus: "none" | "completed" | "bonus";
  completedAtLocalTime: string | null;
};

const REMINDER_RUN_STATE_VALIDATOR = v.union(
  v.literal("scheduled"),
  v.literal("pre_reminded"),
  v.literal("user_acknowledged"),
  v.literal("user_hesitant"),
  v.literal("ignored_once"),
  v.literal("completed"),
  v.literal("missed"),
  v.literal("rescheduled"),
  v.literal("skipped"),
);

type AuthenticatedUserCtx = {
  auth: {
    getUserIdentity(): Promise<{ subject: string } | null>;
  };
  db: {
    get(id: Id<"users">): Promise<Doc<"users"> | null>;
  };
};

async function requireIdentity(ctx: AuthenticatedUserCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");
  return identity;
}

async function requireOwnedUser(
  ctx: AuthenticatedUserCtx,
  userId: Id<"users">,
) {
  const identity = await requireIdentity(ctx);
  const user = await ctx.db.get(userId);
  if (!user || user.clerkId !== identity.subject) {
    throw new Error("Unauthorized");
  }
}

function getTimezone(user: Doc<"users">) {
  return user.timezone ?? "UTC";
}

function getDayKey(date: Date, timezone: string) {
  return formatInTimeZone(date, timezone, "EEE").toLowerCase().slice(0, 3);
}

function getDateKey(date: Date, timezone: string) {
  return formatInTimeZone(date, timezone, "yyyy-MM-dd");
}

function getDaySchedule(habit: Doc<"habits">) {
  return {
    scheduledTime: habit.scheduledTime,
    reminderTime: habit.reminderTime,
    checkInDeadline: habit.checkInDeadline,
  };
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

function isTimeKey(value: string | null | undefined) {
  if (!value) {
    return false;
  }
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
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

function hashReminderSeed(seed: string) {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function looksLikeIndonesianText(text: string) {
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
    "bangsat",
    "bro",
    "woy",
  ];
  return signals.some((signal) => lowered.includes(signal));
}

function detectReminderLanguageHint(parts: Array<string | null | undefined>) {
  const sample = parts.filter(Boolean).join(" ").trim();
  if (!sample) {
    return "english" satisfies ReminderLanguageHint;
  }

  return looksLikeIndonesianText(sample)
    ? ("indonesian" satisfies ReminderLanguageHint)
    : ("english" satisfies ReminderLanguageHint);
}

function getTimelinePoint(reminderType: ReminderType): ReminderTimelinePoint {
  if (reminderType === "pre_workout") {
    return "post";
  }
  if (reminderType === "check_in") {
    return "due";
  }
  return "deadline";
}

function getAgitationLevel(args: {
  missedLast7d: number;
  currentStreak: number;
  reminderRunState: ReminderRunState | null;
}) {
  if (
    args.missedLast7d >= 4 ||
    args.reminderRunState === "user_hesitant" ||
    args.reminderRunState === "ignored_once"
  ) {
    return "high" satisfies ReminderAgitationLevel;
  }

  if (args.missedLast7d >= 2 || args.currentStreak >= 3) {
    return "medium" satisfies ReminderAgitationLevel;
  }

  return "low" satisfies ReminderAgitationLevel;
}

function getReminderVoiceDirectives(args: {
  deliveryKind: ReminderDeliveryKind;
  reminderType: ReminderType;
  interactionHistory: ReminderInteractionHistory;
  agitationLevel: ReminderAgitationLevel;
  recentMissReasons: string[];
  currentStreak: number;
}) {
  const directives = new Set<string>();

  if (args.deliveryKind === "completion_interrupt") {
    directives.add("side_eye_respect");
    directives.add("keep_it_short");
    directives.add("no_pending_action_commands");
    directives.add("barely_saved_it");
  } else if (args.reminderType === "pre_workout") {
    directives.add("clock_callout");
    directives.add("buddy_nag");
    directives.add("anticipatory_pressure");
  } else if (args.reminderType === "check_in") {
    directives.add("short_impatient");
    directives.add("demand_action");
    directives.add("now_or_never");
  } else {
    directives.add("cold_verdict");
    directives.add("final_cutoff");
    directives.add("no_soft_closing");
  }

  if (args.interactionHistory === "ghosting") {
    directives.add("call_out_silence");
  }
  if (args.interactionHistory === "hesitating") {
    directives.add("call_out_resistance");
  }
  if (args.interactionHistory === "promised_but_stalling") {
    directives.add("call_out_empty_talk");
  }
  if (args.interactionHistory === "silent_completion") {
    directives.add("respect_with_side_eye");
  }
  if (args.agitationLevel === "high") {
    directives.add("turn_up_heat");
  }
  if (args.currentStreak >= 3) {
    directives.add("protect_streak");
  }
  if (args.recentMissReasons.length > 0) {
    directives.add("weaponize_last_excuse");
  }

  return [...directives];
}

function toTimestamp(dateKey: string, time: string, timezone: string) {
  return fromZonedTime(`${dateKey}T${time}:00`, timezone).getTime();
}

function shiftDateKey(date: Date, timezone: string, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return getDateKey(next, timezone);
}

function buildReminderPayloads(args: {
  targets: ReturnType<typeof buildReminderTargets>;
  skippedDates: Set<string>;
  runStates: Map<string, ReminderRunState>;
  now: number;
  timezone: string;
}) {
  const reminders: Array<{
    date: string;
    scheduledFor: number;
    type: ReminderType;
  }> = [];

  for (const target of args.targets) {
    if (args.skippedDates.has(target.date)) {
      continue;
    }

    const runState = args.runStates.get(target.date);
    if (isClosedReminderRunState(runState)) {
      continue;
    }

    const preWorkout = toTimestamp(
      target.date,
      target.schedule.reminderTime,
      args.timezone,
    );
    const checkIn = toTimestamp(
      target.date,
      target.schedule.scheduledTime,
      args.timezone,
    );
    const lateFollowUp = addMinutes(
      new Date(
        toTimestamp(
          target.date,
          target.schedule.checkInDeadline,
          args.timezone,
        ),
      ),
      5,
    ).getTime();

    for (const entry of [
      {
        date: target.date,
        scheduledFor: preWorkout,
        type: "pre_workout" as const,
      },
      { date: target.date, scheduledFor: checkIn, type: "check_in" as const },
      {
        date: target.date,
        scheduledFor: lateFollowUp,
        type: "late_follow_up" as const,
      },
    ]) {
      if (entry.scheduledFor > args.now) {
        reminders.push(entry);
      }
    }
  }

  return reminders;
}

function buildReminderTargets(args: {
  habit: Doc<"habits">;
  user: Doc<"users">;
  scheduleOverrides: Map<string, string>;
}) {
  const timezone = getTimezone(args.user);
  const now = Date.now();
  const targets: Array<{
    date: string;
    schedule: ReturnType<typeof getDaySchedule>;
  }> = [];

  for (let dayOffset = 0; dayOffset < LOOKAHEAD_DAYS; dayOffset += 1) {
    const anchor = addDays(new Date(now), dayOffset);
    const date = getDateKey(anchor, timezone);
    const dayKey = getDayKey(anchor, timezone);
    if (!args.habit.targetDays.includes(dayKey)) {
      continue;
    }

    const baseSchedule = getDaySchedule(args.habit);
    const overrideTime = args.scheduleOverrides.get(date);
    const schedule =
      overrideTime && isTimeKey(overrideTime)
        ? shiftScheduleTimes({
            scheduledTime: baseSchedule.scheduledTime,
            reminderTime: baseSchedule.reminderTime,
            checkInDeadline: baseSchedule.checkInDeadline,
            nextScheduledTime: overrideTime,
          })
        : baseSchedule;

    targets.push({
      date,
      schedule,
    });
  }

  return targets;
}

function compareCheckInsDesc(left: Doc<"checkIns">, right: Doc<"checkIns">) {
  if (left.date !== right.date) {
    return right.date.localeCompare(left.date);
  }

  return right.timestamp - left.timestamp;
}

function isClosedReminderRunState(
  state: ReminderRunState | null | undefined,
): state is "completed" | "missed" | "skipped" {
  return state === "completed" || state === "missed" || state === "skipped";
}

function isOutcomeReminderRunState(
  state: ReminderRunState | null | undefined,
): state is "completed" | "missed" {
  return state === "completed" || state === "missed";
}

function resolveReminderRunStateForSchedule(args: {
  existingState: ReminderRunState | null;
  desiredState: "scheduled" | "skipped";
}) {
  if (!args.existingState) {
    return args.desiredState;
  }

  if (isOutcomeReminderRunState(args.existingState)) {
    return args.existingState;
  }

  if (args.desiredState === "skipped") {
    return "skipped" as const;
  }

  return args.existingState;
}

function resolveReminderRunStateForRuntime(args: {
  existingState: ReminderRunState | null;
  nextState: ReminderRunState;
}) {
  if (!args.existingState) {
    return args.nextState;
  }

  if (isOutcomeReminderRunState(args.existingState)) {
    return args.existingState;
  }

  if (isOutcomeReminderRunState(args.nextState)) {
    return args.nextState;
  }

  if (args.existingState === "skipped") {
    return "skipped" as const;
  }

  return args.nextState;
}

async function getReminderRun(args: {
  ctx: MutationCtx;
  userId: Id<"users">;
  habitId: Id<"habits">;
  date: string;
}) {
  return await args.ctx.db
    .query("reminderRuns")
    .withIndex("by_user_habit_date", (q) =>
      q
        .eq("userId", args.userId)
        .eq("habitId", args.habitId)
        .eq("date", args.date),
    )
    .unique();
}

async function syncReminderRunForSchedule(args: {
  ctx: MutationCtx;
  userId: Id<"users">;
  habitId: Id<"habits">;
  date: string;
  desiredState: "scheduled" | "skipped";
  now: number;
}) {
  const existing = await getReminderRun(args);
  const state = resolveReminderRunStateForSchedule({
    existingState: existing?.state ?? null,
    desiredState: args.desiredState,
  });

  if (existing) {
    if (existing.state !== state) {
      await args.ctx.db.patch(existing._id, {
        state,
        updatedAt: args.now,
      });
    }
    return {
      id: existing._id,
      state,
    };
  }

  const id = await args.ctx.db.insert("reminderRuns", {
    userId: args.userId,
    habitId: args.habitId,
    date: args.date,
    state,
    userResponded: false,
    createdAt: args.now,
    updatedAt: args.now,
  });

  return { id, state };
}

async function advanceReminderRunState(args: {
  ctx: MutationCtx;
  userId: Id<"users">;
  habitId: Id<"habits">;
  date: string;
  nextState: ReminderRunState;
  now: number;
  lastReminderType?: ReminderType;
  lastMessageId?: Id<"messages">;
  userResponded?: boolean;
  responseIntent?: string;
  responseSummary?: string;
  completionAcknowledgedAt?: number;
}) {
  const existing = await getReminderRun(args);
  const state = resolveReminderRunStateForRuntime({
    existingState: existing?.state ?? null,
    nextState: args.nextState,
  });

  if (existing) {
    const patch: Partial<Doc<"reminderRuns">> = {
      state,
      updatedAt: args.now,
    };

    if (args.lastReminderType !== undefined) {
      patch.lastReminderType = args.lastReminderType;
    }
    if (args.lastMessageId !== undefined) {
      patch.lastMessageId = args.lastMessageId;
    }
    if (args.userResponded !== undefined) {
      patch.userResponded = args.userResponded;
    }
    if (args.responseIntent !== undefined) {
      patch.responseIntent = args.responseIntent;
    }
    if (args.responseSummary !== undefined) {
      patch.responseSummary = args.responseSummary;
    }
    if (args.completionAcknowledgedAt !== undefined) {
      patch.completionAcknowledgedAt = args.completionAcknowledgedAt;
    }

    await args.ctx.db.patch(existing._id, patch);
    return {
      id: existing._id,
      state,
    };
  }

  const id = await args.ctx.db.insert("reminderRuns", {
    userId: args.userId,
    habitId: args.habitId,
    date: args.date,
    state,
    lastReminderType: args.lastReminderType,
    lastMessageId: args.lastMessageId,
    userResponded: args.userResponded ?? false,
    responseIntent: args.responseIntent,
    responseSummary: args.responseSummary,
    completionAcknowledgedAt: args.completionAcknowledgedAt,
    createdAt: args.now,
    updatedAt: args.now,
  });

  return { id, state };
}

function buildReminderContext(args: {
  habit: Doc<"habits">;
  reminder: Doc<"reminders">;
  reminderRunState: ReminderRunState | null;
  allCheckIns: Doc<"checkIns">[];
  todayReminders: Doc<"reminders">[];
  timezone: string;
  memorySignal: string | null;
}) {
  const habitCheckIns = args.allCheckIns
    .filter((checkIn) => checkIn.habitId === args.habit._id)
    .sort(compareCheckInsDesc);
  const date7dStart = shiftDateKey(
    new Date(args.reminder.scheduledFor),
    args.timezone,
    -6,
  );
  const checkInsLast7d = habitCheckIns.filter(
    (checkIn) =>
      checkIn.date >= date7dStart && checkIn.date <= args.reminder.date,
  );
  const missedLast7d = checkInsLast7d.filter(
    (checkIn) => checkIn.status === "missed",
  ).length;
  const lastCheckIn = habitCheckIns[0] ?? null;
  const recentMissReasons = habitCheckIns
    .filter((checkIn) => checkIn.status === "missed")
    .map(
      (checkIn) =>
        checkIn.userReason?.trim() ||
        checkIn.conversationSummary?.trim() ||
        null,
    )
    .filter((reason): reason is string => Boolean(reason))
    .slice(0, 2);
  const habitTodayReminders = args.todayReminders.filter(
    (reminder) => reminder.habitId === args.habit._id,
  );

  return {
    habitName: args.habit.name,
    habitRules: args.habit.rules,
    motivation: args.habit.motivation,
    currentStreak: args.habit.currentStreak,
    bestStreak: args.habit.bestStreak,
    missedLast7d,
    lastCheckInStatus: lastCheckIn?.status ?? null,
    recentMissReasons,
    memorySignal: args.memorySignal,
    reminderRunState: args.reminderRunState,
    todayReminderStatus: {
      pendingTypes: habitTodayReminders
        .filter((reminder) => !reminder.sent)
        .map((reminder) => reminder.type),
      sentTypes: habitTodayReminders
        .filter((reminder) => reminder.sent)
        .map((reminder) => reminder.type),
    },
  };
}

function buildReminderStageHistory(args: {
  reminder: Doc<"reminders">;
  todayReminders: Doc<"reminders">[];
  habitMessages: Doc<"messages">[];
}) {
  const reminderByType = new Map(
    args.todayReminders.map((entry) => [entry.type, entry]),
  );
  const currentIndex = REMINDER_STAGE_ORDER.indexOf(args.reminder.type);
  const history: ReminderStageHistoryItem[] = [];

  for (let index = 0; index < currentIndex; index += 1) {
    const reminderType = REMINDER_STAGE_ORDER[index];
    const stageReminder = reminderByType.get(reminderType);
    if (!stageReminder) {
      continue;
    }

    const nextReminder =
      reminderByType.get(REMINDER_STAGE_ORDER[index + 1]) ?? args.reminder;
    const responses = args.habitMessages
      .filter((message) => message.role === "user")
      .filter(
        (message) =>
          message.timestamp >= stageReminder.scheduledFor &&
          message.timestamp < nextReminder.scheduledFor,
      )
      .sort((left, right) => left.timestamp - right.timestamp);
    const lastResponse = responses.at(-1) ?? null;

    history.push({
      reminderType,
      timelinePoint: getTimelinePoint(reminderType),
      scheduledFor: stageReminder.scheduledFor,
      sent: stageReminder.sent,
      responseCode: responses.length > 0 ? "R" : "D",
      userMessageCount: responses.length,
      userIntent: lastResponse?.intent ?? null,
      userSummary: lastResponse?.content?.trim() ?? null,
    });
  }

  return history;
}

function getReminderInteractionHistory(args: {
  deliveryKind: ReminderDeliveryKind;
  reminderType: ReminderType;
  reminderRunState: ReminderRunState | null;
  stageHistory: ReminderStageHistoryItem[];
  completionStatus: "none" | "completed" | "bonus";
}) {
  const respondedCount = args.stageHistory.filter(
    (entry) => entry.responseCode === "R",
  ).length;

  if (args.deliveryKind === "completion_interrupt") {
    return respondedCount === 0
      ? ("silent_completion" satisfies ReminderInteractionHistory)
      : ("active_responder" satisfies ReminderInteractionHistory);
  }

  if (args.reminderRunState === "user_hesitant") {
    return "hesitating" satisfies ReminderInteractionHistory;
  }

  if (respondedCount === 0) {
    return args.stageHistory.length === 0
      ? ("fresh" satisfies ReminderInteractionHistory)
      : ("ghosting" satisfies ReminderInteractionHistory);
  }

  if (
    args.reminderType === "late_follow_up" &&
    args.completionStatus === "none"
  ) {
    return "promised_but_stalling" satisfies ReminderInteractionHistory;
  }

  return "active_responder" satisfies ReminderInteractionHistory;
}

function buildReminderPlaceholder() {
  return {
    title: "Streak",
    body: "[pending_reminder_generation]",
    content: "[pending_reminder_generation]",
  };
}

function formatReminderLocalTime(timestamp: number, timezone: string) {
  return formatInTimeZone(new Date(timestamp), timezone, "HH:mm");
}

function buildReminderRewriteContext(args: {
  deliveryKind: ReminderDeliveryKind;
  habit: Doc<"habits">;
  reminder: Doc<"reminders">;
  schedule: ReturnType<typeof getDaySchedule>;
  reminderContext: ReturnType<typeof buildReminderContext>;
  reminderRunState: ReminderRunState | null;
  todayReminders: Doc<"reminders">[];
  habitMessages: Doc<"messages">[];
  timezone: string;
  completionCheckIn?: Doc<"checkIns"> | null;
}) {
  const scheduledAt = toTimestamp(
    args.reminder.date,
    args.schedule.scheduledTime,
    args.timezone,
  );
  const deadlineAt = toTimestamp(
    args.reminder.date,
    args.schedule.checkInDeadline,
    args.timezone,
  );
  const stageHistory = buildReminderStageHistory({
    reminder: args.reminder,
    todayReminders: args.todayReminders,
    habitMessages: args.habitMessages,
  });
  const lastUserResponse =
    stageHistory
      .slice()
      .reverse()
      .find((entry) => entry.userSummary || entry.userIntent) ?? null;
  const completionStatus =
    args.completionCheckIn?.status === "bonus"
      ? "bonus"
      : args.completionCheckIn?.status === "completed"
        ? "completed"
        : "none";
  const interactionHistory = getReminderInteractionHistory({
    deliveryKind: args.deliveryKind,
    reminderType: args.reminder.type,
    reminderRunState: args.reminderRunState,
    stageHistory,
    completionStatus,
  });
  const responsePattern =
    stageHistory.length > 0
      ? stageHistory.map((entry) => entry.responseCode).join("-")
      : "fresh";
  const agitationLevel = getAgitationLevel({
    missedLast7d: args.reminderContext.missedLast7d,
    currentStreak: args.reminderContext.currentStreak,
    reminderRunState: args.reminderRunState,
  });
  const styleSeed = hashReminderSeed(
    [
      args.deliveryKind,
      args.reminder.type,
      args.reminder.date,
      args.habit.name,
      responsePattern,
      interactionHistory,
      completionStatus,
      agitationLevel,
      args.reminderContext.recentMissReasons[0] ?? "",
    ].join("|"),
  );
  const languageHint = detectReminderLanguageHint([
    args.habit.name,
    args.reminderContext.memorySignal,
    args.reminderContext.motivation,
    ...args.reminderContext.recentMissReasons,
    ...args.habitMessages.slice(-2).map((message) => message.content),
  ]);

  return {
    deliveryKind: args.deliveryKind,
    habitName: args.habit.name,
    habitRules: args.reminderContext.habitRules,
    motivation: args.reminderContext.motivation,
    reminderType: args.reminder.type,
    currentTimelinePoint: getTimelinePoint(args.reminder.type),
    reminderDate: args.reminder.date,
    scheduledTime: args.schedule.scheduledTime,
    deadline: args.schedule.checkInDeadline,
    scheduledDeltaMinutes: Math.round(
      (scheduledAt - args.reminder.scheduledFor) / 60000,
    ),
    deadlineDeltaMinutes: Math.round(
      (deadlineAt - args.reminder.scheduledFor) / 60000,
    ),
    currentStreak: args.reminderContext.currentStreak,
    bestStreak: args.reminderContext.bestStreak,
    missedLast7d: args.reminderContext.missedLast7d,
    lastCheckInStatus: args.reminderContext.lastCheckInStatus,
    recentMissReasons: args.reminderContext.recentMissReasons,
    memorySignal: args.reminderContext.memorySignal,
    reminderRunState: args.reminderRunState,
    todayPendingTypes: args.reminderContext.todayReminderStatus.pendingTypes,
    todaySentTypes: args.reminderContext.todayReminderStatus.sentTypes,
    languageHint,
    interactionHistory,
    responsePattern,
    stageHistory,
    lastUserResponseIntent: lastUserResponse?.userIntent ?? null,
    lastUserResponseSummary: lastUserResponse?.userSummary ?? null,
    isAggravated:
      agitationLevel === "high" || args.reminderContext.missedLast7d >= 3,
    agitationLevel,
    voiceDirectives: getReminderVoiceDirectives({
      deliveryKind: args.deliveryKind,
      reminderType: args.reminder.type,
      interactionHistory,
      agitationLevel,
      recentMissReasons: args.reminderContext.recentMissReasons,
      currentStreak: args.reminderContext.currentStreak,
    }),
    styleSeed,
    completionStatus,
    completedAtLocalTime: args.completionCheckIn
      ? formatReminderLocalTime(args.completionCheckIn.timestamp, args.timezone)
      : null,
  } satisfies ReminderRewriteContext;
}

export const listByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireOwnedUser(ctx, args.userId);
    return await ctx.db
      .query("reminders")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const listRunsByUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireOwnedUser(ctx, args.userId);
    return await ctx.db
      .query("reminderRuns")
      .withIndex("by_user_date", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const listScheduled = query({
  args: { before: v.number(), sent: v.boolean() },
  handler: async (ctx, args) => {
    await requireIdentity(ctx);
    return await ctx.db
      .query("reminders")
      .withIndex("by_scheduled", (q) =>
        q.eq("sent", args.sent).lte("scheduledFor", args.before),
      )
      .collect();
  },
});

export const create = mutation({
  args: {
    habitId: v.id("habits"),
    userId: v.id("users"),
    date: v.string(),
    scheduledFor: v.number(),
    type: v.union(
      v.literal("pre_workout"),
      v.literal("check_in"),
      v.literal("late_follow_up"),
    ),
    sent: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireOwnedUser(ctx, args.userId);
    return await ctx.db.insert("reminders", {
      ...args,
      sent: args.sent ?? false,
    });
  },
});

export const markSent = mutation({
  args: { id: v.id("reminders"), sent: v.boolean() },
  handler: async (ctx, args) => {
    const reminder = await ctx.db.get(args.id);
    if (!reminder) throw new Error("Reminder not found");
    await requireOwnedUser(ctx, reminder.userId);
    await ctx.db.patch(args.id, { sent: args.sent });
    return await ctx.db.get(args.id);
  },
});

export const remove = mutation({
  args: { id: v.id("reminders") },
  handler: async (ctx, args) => {
    const reminder = await ctx.db.get(args.id);
    if (!reminder) throw new Error("Reminder not found");
    await requireOwnedUser(ctx, reminder.userId);
    await ctx.db.delete(args.id);
    return args.id;
  },
});

export const refreshForHabit = internalMutation({
  args: { habitId: v.id("habits") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const habit = await ctx.db.get(args.habitId);
    if (!habit) {
      return { created: 0, deleted: 0 };
    }

    const pendingReminders = await ctx.db
      .query("reminders")
      .withIndex("by_habit", (q) =>
        q.eq("habitId", args.habitId).eq("sent", false),
      )
      .collect();

    for (const reminder of pendingReminders) {
      await ctx.db.delete(reminder._id);
    }

    if (!habit.isActive) {
      return { created: 0, deleted: pendingReminders.length };
    }

    const user = await ctx.db.get(habit.userId);
    if (!user) {
      return { created: 0, deleted: pendingReminders.length };
    }

    const habitSkips = await ctx.db
      .query("habitSkips")
      .withIndex("by_habit_date", (q) => q.eq("habitId", args.habitId))
      .collect();
    const skippedDates = new Set(habitSkips.map((skip) => skip.date));
    const existingRuns = await ctx.db
      .query("reminderRuns")
      .withIndex("by_habit_date", (q) => q.eq("habitId", args.habitId))
      .collect();
    const runStates = new Map(
      existingRuns.map((run) => [run.date, run.state as ReminderRunState]),
    );
    const scheduleChangedEpisodes = await ctx.db
      .query("agentEpisodes")
      .withIndex("by_user_habit_date", (q) =>
        q.eq("userId", user._id).eq("habitId", habit._id),
      )
      .collect();
    const scheduleBaseline = habit.scheduleUpdatedAt ?? 0;

    const scheduleOverrides = new Map<string, string>();
    for (const episode of scheduleChangedEpisodes.sort(
      (left, right) => right.createdAt - left.createdAt,
    )) {
      if (episode.type !== "schedule_changed") {
        continue;
      }
      if (episode.createdAt < scheduleBaseline) {
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
      if (!targetDate || !targetTime || !isTimeKey(targetTime)) {
        continue;
      }
      if (!scheduleOverrides.has(targetDate)) {
        scheduleOverrides.set(targetDate, targetTime);
      }
    }

    const targets = buildReminderTargets({
      habit,
      user,
      scheduleOverrides,
    });

    for (const target of targets) {
      const syncedRun = await syncReminderRunForSchedule({
        ctx,
        userId: user._id,
        habitId: habit._id,
        date: target.date,
        desiredState: skippedDates.has(target.date) ? "skipped" : "scheduled",
        now,
      });
      runStates.set(target.date, syncedRun.state);
    }

    const nextReminders = buildReminderPayloads({
      targets,
      skippedDates,
      runStates,
      now,
      timezone: getTimezone(user),
    });
    for (const reminder of nextReminders) {
      await ctx.db.insert("reminders", {
        habitId: habit._id,
        userId: user._id,
        date: reminder.date,
        scheduledFor: reminder.scheduledFor,
        type: reminder.type,
        sent: false,
      });
    }

    return { created: nextReminders.length, deleted: pendingReminders.length };
  },
});

export const clearForHabit = internalMutation({
  args: { habitId: v.id("habits") },
  handler: async (ctx, args) => {
    const pendingReminders = await ctx.db
      .query("reminders")
      .withIndex("by_habit", (q) =>
        q.eq("habitId", args.habitId).eq("sent", false),
      )
      .collect();

    for (const reminder of pendingReminders) {
      await ctx.db.delete(reminder._id);
    }

    return { deleted: pendingReminders.length };
  },
});

export const listDue = internalQuery({
  args: { before: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("reminders")
      .withIndex("by_scheduled", (q) =>
        q.eq("sent", false).lte("scheduledFor", args.before),
      )
      .collect();
  },
});

export const processReminder = internalMutation({
  args: { reminderId: v.id("reminders") },
  handler: async (ctx, args) => {
    const reminder = await ctx.db.get(args.reminderId);
    if (!reminder || reminder.sent) {
      return null;
    }

    const habit = await ctx.db.get(reminder.habitId);
    const user = await ctx.db.get(reminder.userId);
    if (!habit || !user) {
      await ctx.db.patch(reminder._id, { sent: true });
      return null;
    }

    if (user.aiDisabled) {
      await ctx.db.patch(reminder._id, { sent: true });
      return {
        shouldSendPush: false,
        skipped: true,
      };
    }

    const existingCheckIns = await ctx.db
      .query("checkIns")
      .withIndex("by_user_date", (q) =>
        q.eq("userId", reminder.userId).eq("date", reminder.date),
      )
      .collect();
    const skip = await ctx.db
      .query("habitSkips")
      .withIndex("by_habit_date", (q) =>
        q.eq("habitId", reminder.habitId).eq("date", reminder.date),
      )
      .unique();
    const reminderRun = await getReminderRun({
      ctx,
      userId: reminder.userId,
      habitId: reminder.habitId,
      date: reminder.date,
    });

    const existingCheckIn =
      existingCheckIns.find((entry) => entry.habitId === reminder.habitId) ??
      null;

    if (existingCheckIn) {
      if (
        existingCheckIn.status === "missed" ||
        reminderRun?.completionAcknowledgedAt
      ) {
        await advanceReminderRunState({
          ctx,
          userId: reminder.userId,
          habitId: reminder.habitId,
          date: reminder.date,
          nextState:
            existingCheckIn.status === "missed" ? "missed" : "completed",
          now: reminder.scheduledFor,
        });
        await ctx.db.patch(reminder._id, { sent: true });
        return {
          shouldSendPush: false,
          skipped: true,
        };
      }

      const timezone = getTimezone(user);
      const allCheckIns = await ctx.db
        .query("checkIns")
        .withIndex("by_user_date", (q) => q.eq("userId", reminder.userId))
        .collect();
      const recentEpisodes = await ctx.db
        .query("agentEpisodes")
        .withIndex("by_user_date", (q) => q.eq("userId", reminder.userId))
        .order("desc")
        .take(12);
      const memoryRows = await ctx.db
        .query("agentMemory")
        .withIndex("by_user_scope", (q) => q.eq("userId", reminder.userId))
        .collect();
      const todayReminders = await ctx.db
        .query("reminders")
        .withIndex("by_user", (q) => q.eq("userId", reminder.userId))
        .collect();
      const habitMessages = (await ctx.db
        .query("messages")
        .withIndex("by_habit", (q) => q.eq("habitId", habit._id))
        .collect()) as Doc<"messages">[];
      const schedule = getDaySchedule(habit);
      const memorySnapshot = selectMemorySnapshot({
        memories: memoryRows,
        episodes: recentEpisodes,
        habitId: habit._id,
      });
      const todayRemindersForDate = todayReminders.filter(
        (entry) => entry.date === reminder.date,
      );
      const reminderContext = buildReminderContext({
        habit,
        reminder,
        reminderRunState: reminderRun?.state ?? null,
        allCheckIns,
        todayReminders: todayRemindersForDate,
        timezone,
        memorySignal: pickMemorySignal(memorySnapshot),
      });
      const rewriteContext = buildReminderRewriteContext({
        deliveryKind: "completion_interrupt",
        habit,
        reminder,
        schedule,
        reminderContext,
        reminderRunState: reminderRun?.state ?? null,
        todayReminders: todayRemindersForDate,
        habitMessages,
        timezone,
        completionCheckIn: existingCheckIn,
      });
      const placeholder = buildReminderPlaceholder();
      const messageId = await ctx.db.insert("messages", {
        userId: user._id,
        habitId: habit._id,
        role: "ai",
        content: placeholder.content,
        intent: REMINDER_MESSAGE_INTENT[reminder.type],
        timestamp: reminder.scheduledFor,
      });

      await advanceReminderRunState({
        ctx,
        userId: reminder.userId,
        habitId: reminder.habitId,
        date: reminder.date,
        nextState: "completed",
        now: reminder.scheduledFor,
        lastReminderType: reminder.type,
        lastMessageId: messageId,
        completionAcknowledgedAt: reminder.scheduledFor,
      });
      await ctx.db.patch(reminder._id, { sent: true });
      return {
        shouldSendPush: true,
        userId: user._id,
        reminderType: reminder.type,
        messageId,
        payload: {
          kind: "habit_reminder",
          title: placeholder.title,
          body: placeholder.body,
          url: "/dashboard?tab=chat",
          habitId: habit._id,
          reminderType: reminder.type,
          rewriteContext,
        },
      };
    }

    if (skip) {
      await advanceReminderRunState({
        ctx,
        userId: reminder.userId,
        habitId: reminder.habitId,
        date: reminder.date,
        nextState: "skipped",
        now: reminder.scheduledFor,
      });
      await ctx.db.patch(reminder._id, { sent: true });
      return {
        shouldSendPush: false,
        skipped: true,
      };
    }

    if (isClosedReminderRunState(reminderRun?.state ?? null)) {
      await ctx.db.patch(reminder._id, { sent: true });
      return {
        shouldSendPush: false,
        skipped: true,
      };
    }

    const timezone = getTimezone(user);
    const allCheckIns = await ctx.db
      .query("checkIns")
      .withIndex("by_user_date", (q) => q.eq("userId", reminder.userId))
      .collect();
    const recentEpisodes = await ctx.db
      .query("agentEpisodes")
      .withIndex("by_user_date", (q) => q.eq("userId", reminder.userId))
      .order("desc")
      .take(12);
    const memoryRows = await ctx.db
      .query("agentMemory")
      .withIndex("by_user_scope", (q) => q.eq("userId", reminder.userId))
      .collect();
    const todayReminders = await ctx.db
      .query("reminders")
      .withIndex("by_user", (q) => q.eq("userId", reminder.userId))
      .collect();
    const habitMessages = (await ctx.db
      .query("messages")
      .withIndex("by_habit", (q) => q.eq("habitId", habit._id))
      .collect()) as Doc<"messages">[];
    const schedule = getDaySchedule(habit);
    const memorySnapshot = selectMemorySnapshot({
      memories: memoryRows,
      episodes: recentEpisodes,
      habitId: habit._id,
    });
    const reminderContext = buildReminderContext({
      habit,
      reminder,
      reminderRunState: reminderRun?.state ?? null,
      allCheckIns,
      todayReminders: todayReminders.filter(
        (entry) => entry.date === reminder.date,
      ),
      timezone,
      memorySignal: pickMemorySignal(memorySnapshot),
    });
    const todayRemindersForDate = todayReminders.filter(
      (entry) => entry.date === reminder.date,
    );
    const rewriteContext = buildReminderRewriteContext({
      deliveryKind: "stage_reminder",
      habit,
      reminder,
      schedule,
      reminderContext,
      reminderRunState: reminderRun?.state ?? null,
      todayReminders: todayRemindersForDate,
      habitMessages,
      timezone,
      completionCheckIn: null,
    });
    const placeholder = buildReminderPlaceholder();

    const aiContent = placeholder.content;
    let checkInCreatedId: Id<"checkIns"> | undefined;

    if (reminder.type === "late_follow_up") {
      checkInCreatedId = await ctx.db.insert("checkIns", {
        habitId: habit._id,
        userId: user._id,
        date: reminder.date,
        status: "missed",
        source: "auto_deadline",
        userReason: "No response by deadline",
        conversationSummary: `Automatic miss after ${schedule.checkInDeadline} deadline`,
        aiResponse: aiContent,
        timestamp: reminder.scheduledFor,
      });

      await ctx.db.patch(habit._id, { currentStreak: 0 });
      await ctx.runMutation(internal.agentMemory.recordEpisode, {
        userId: user._id,
        habitId: habit._id,
        date: reminder.date,
        type: "reminder_ignored",
        summary: `${habit.name} was ignored until deadline and became an automatic miss.`,
        metadata: {
          reminderType: reminder.type,
          deadline: schedule.checkInDeadline,
        },
        createdAt: reminder.scheduledFor,
      });
    }

    const messageId = await ctx.db.insert("messages", {
      userId: user._id,
      habitId: habit._id,
      role: "ai",
      content: aiContent,
      intent: REMINDER_MESSAGE_INTENT[reminder.type],
      timestamp: reminder.scheduledFor,
    });

    await advanceReminderRunState({
      ctx,
      userId: user._id,
      habitId: habit._id,
      date: reminder.date,
      nextState:
        reminder.type === "late_follow_up"
          ? "missed"
          : reminder.type === "pre_workout"
            ? "pre_reminded"
            : reminderRun?.state === "user_acknowledged" ||
                reminderRun?.state === "user_hesitant"
              ? reminderRun.state
              : "ignored_once",
      now: reminder.scheduledFor,
      lastReminderType: reminder.type,
      lastMessageId: messageId,
    });

    await ctx.db.patch(reminder._id, { sent: true });

    return {
      shouldSendPush: true,
      userId: user._id,
      reminderType: reminder.type,
      messageId,
      checkInCreatedId,
      payload: {
        kind: "habit_reminder",
        title: placeholder.title,
        body: placeholder.body,
        url: "/dashboard?tab=chat",
        habitId: habit._id,
        reminderType: reminder.type,
        rewriteContext,
      },
    };
  },
});

export const advanceReminderRun = internalMutation({
  args: {
    userId: v.id("users"),
    habitId: v.id("habits"),
    date: v.string(),
    state: REMINDER_RUN_STATE_VALIDATOR,
    now: v.number(),
    userResponded: v.optional(v.boolean()),
    responseIntent: v.optional(v.string()),
    responseSummary: v.optional(v.string()),
    completionAcknowledgedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await advanceReminderRunState({
      ctx,
      userId: args.userId,
      habitId: args.habitId,
      date: args.date,
      nextState: args.state,
      now: args.now,
      userResponded: args.userResponded,
      responseIntent: args.responseIntent,
      responseSummary: args.responseSummary,
      completionAcknowledgedAt: args.completionAcknowledgedAt,
    });
  },
});
