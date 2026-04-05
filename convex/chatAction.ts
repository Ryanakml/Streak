"use node";

import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const CHAT_INTENTS = [
  "check_in",
  "completed",
  "missed",
  "question",
  "excuse",
  "bonus",
  "clarify_workout",
] as const;

type ChatIntent = (typeof CHAT_INTENTS)[number];
type ChatClassification =
  | "completed"
  | "missed"
  | "question"
  | "excuse"
  | "bonus"
  | "clarify_workout";

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

type ChatExtractionResult = {
  classification: ChatClassification;
  habitName: string | null;
  shouldLogCheckIn: boolean;
  checkInStatus: "completed" | "missed" | "bonus" | null;
  reason: string | null;
  conversationSummary: string | null;
  needsWorkoutClarification: boolean;
  workout: WorkoutPayload | null;
};

type MessageSnapshot = Pick<
  Doc<"messages">,
  "_id" | "role" | "content" | "intent" | "timestamp" | "habitId"
>;

type ChatContext = {
  user: Doc<"users">;
  date: string;
  activeHabits: Doc<"habits">[];
  todayHabit: Doc<"habits"> | null;
  todayCheckIns: Doc<"checkIns">[];
  recentMessages: MessageSnapshot[];
  recentCheckIns: Doc<"checkIns">[];
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
      for (const key of ["sets", "reps", "weight", "duration", "distance"] as const) {
        const value = raw[key];
        if (typeof value === "number" && Number.isFinite(value)) {
          nextExercise[key] = value;
        }
      }
      return nextExercise;
    })
    .filter((exercise): exercise is WorkoutPayload["exercises"][number] => Boolean(exercise));

  if (exercises.length === 0) {
    return null;
  }

  const notes = coerceString(candidate.notes);
  return {
    exercises,
    notes: notes || undefined,
  };
}

function normalizeExtraction(value: unknown): ChatExtractionResult {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const classification = coerceString(candidate.classification) as ChatClassification;
  const checkInStatus = coerceString(candidate.checkInStatus) as
    | "completed"
    | "missed"
    | "bonus"
    | "";

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
    throw new Error("Unable to parse Groq JSON response");
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

async function callGroqJson(messages: Array<{ role: "system" | "user"; content: string }>) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY for Convex chat action");
  }

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.2,
      response_format: { type: "json_object" },
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

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Groq response did not include message content");
  }

  return content;
}

async function callGroqText(messages: Array<{ role: "system" | "user"; content: string }>) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GROQ_API_KEY for Convex chat action");
  }

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.5,
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

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Groq response did not include message content");
  }

  return content;
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
    pendingClarificationHabitId: input.context.pendingClarificationHabitId,
    todayHabit: input.context.todayHabit
      ? summarizeHabit(input.context.todayHabit)
      : null,
    activeHabits: input.context.activeHabits.map(summarizeHabit),
    todayCheckIns: input.context.todayCheckIns.map(summarizeCheckIn),
    recentMessages,
    userMessage: input.content,
  };

  const content = await callGroqJson([
    {
      role: "system",
      content:
        "You classify habit-coach chat messages into structured JSON only. " +
        "Return valid JSON with keys classification, habitName, shouldLogCheckIn, checkInStatus, reason, conversationSummary, needsWorkoutClarification, workout. " +
        "classification must be one of completed, missed, question, excuse, bonus, clarify_workout. " +
        "checkInStatus must be completed, missed, bonus, or null. " +
        "When the user says they completed a workout but does not provide enough workout detail to extract at least one exercise or cardio entry, set needsWorkoutClarification=true and shouldLogCheckIn=false. " +
        "When they answer a prior workout clarification with workout details, classify as clarify_workout and include workout. " +
        "For excuses or skips, set classification to missed or excuse and capture the reason. " +
        "On non-target days, a completed workout should usually be bonus. " +
        "Do not add markdown or prose.",
    },
    {
      role: "user",
      content: JSON.stringify(prompt),
    },
  ]);

  return normalizeExtraction(parseJsonObject(content));
}

async function generateCoachReply(input: {
  content: string;
  context: ChatContext;
  extraction: ChatExtractionResult;
  resolvedHabit: Doc<"habits"> | null;
  requiresClarification: boolean;
  duplicateCheckIn: boolean;
  loggedStatus: "completed" | "missed" | "bonus" | null;
}) {
  const prompt = {
    userMessage: input.content,
    classification: input.extraction.classification,
    reason: input.extraction.reason,
    conversationSummary: input.extraction.conversationSummary,
    requiresClarification: input.requiresClarification,
    duplicateCheckIn: input.duplicateCheckIn,
    loggedStatus: input.loggedStatus,
    resolvedHabit: input.resolvedHabit ? summarizeHabit(input.resolvedHabit) : null,
    todayHabit: input.context.todayHabit
      ? summarizeHabit(input.context.todayHabit)
      : null,
    todayCheckIns: input.context.todayCheckIns.map(summarizeCheckIn),
  };

  const content = await callGroqText([
    {
      role: "system",
      content:
        "You are the Streak coach: blunt, concise, slightly brutal, never rambling. " +
        "Write 1 to 4 short sentences, no markdown, no emojis. " +
        "If requiresClarification is true, ask specifically what workout they did so it can be logged. " +
        "If duplicateCheckIn is true, tell them today's result is already logged. " +
        "If loggedStatus is completed, acknowledge it and push them toward the next session. " +
        "If loggedStatus is missed, call out the miss and reset focus. " +
        "If loggedStatus is bonus, acknowledge the bonus workout without claiming streak progress. " +
        "If classification is question, answer briefly using the habit context only. " +
        "Do not mention reminders, weekly reviews, billing, or unsupported features.",
    },
    {
      role: "user",
      content: JSON.stringify(prompt),
    },
  ]);

  return content.trim();
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
    classification: ChatClassification;
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

    const budget = (await ctx.runMutation(internal.users.consumeDailyMessageBudget, {
      userId: context.user._id,
      now,
    })) as {
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
      habitId: context.pendingClarificationHabitId ?? context.todayHabit?._id,
      role: "user",
      content,
      intent: "check_in",
      timestamp: now,
    })) as Id<"messages">;

    const extraction = await extractChatOutcome({
      content,
      source: args.source,
      context,
    });

    const explicitHabit = findHabitByName(context.activeHabits, extraction.habitName);
    const pendingHabit =
      context.pendingClarificationHabitId != null
        ? (context.activeHabits.find(
            (habit) => habit._id === context.pendingClarificationHabitId,
          ) ?? null)
        : null;
    const resolvedHabit =
      explicitHabit ??
      pendingHabit ??
      context.todayHabit ??
      (context.activeHabits.length === 1 ? context.activeHabits[0] : null);

    const requiresClarification =
      extraction.needsWorkoutClarification &&
      (extraction.classification === "completed" ||
        extraction.classification === "bonus");

    let checkInStatus = extraction.checkInStatus;
    if (
      extraction.classification === "clarify_workout" &&
      extraction.workout &&
      pendingHabit
    ) {
      checkInStatus =
        context.todayHabit?._id === pendingHabit._id ? "completed" : "bonus";
    }

    if (!resolvedHabit) {
      checkInStatus = null;
    }

    if (requiresClarification) {
      checkInStatus = null;
    }

    if (
      extraction.classification === "question" ||
      extraction.classification === "clarify_workout"
    ) {
      if (!checkInStatus) {
        extraction.shouldLogCheckIn = false;
      }
    }

    const duplicateCheckIn =
      Boolean(extraction.shouldLogCheckIn && checkInStatus) &&
      Boolean(
        resolvedHabit &&
          context.todayCheckIns.some((entry) => entry.habitId === resolvedHabit._id),
      );

    const aiIntent: ChatIntent = requiresClarification
      ? "clarify_workout"
      : extraction.classification === "clarify_workout" && checkInStatus
        ? checkInStatus
        : normalizeIntent(extraction.classification);

    const reply = await generateCoachReply({
      content,
      context,
      extraction,
      resolvedHabit,
      requiresClarification,
      duplicateCheckIn,
      loggedStatus: checkInStatus,
    });

    const persisted = (await ctx.runMutation(internal.chat.persistChatResult, {
      userId: context.user._id,
      habitId: resolvedHabit?._id,
      date: context.date,
      aiContent: reply,
      aiIntent,
      checkInStatus:
        extraction.shouldLogCheckIn && checkInStatus && !duplicateCheckIn
          ? checkInStatus
          : undefined,
      reason: extraction.reason ?? undefined,
      conversationSummary: extraction.conversationSummary ?? undefined,
      workout:
        extraction.workout && extraction.workout.exercises.length > 0
          ? extraction.workout
          : undefined,
      timestamp: now,
    })) as {
      aiMessageId: Id<"messages">;
      checkInCreatedId?: Id<"checkIns">;
      workoutLogCreatedId?: Id<"workoutLogs">;
    };

    return {
      userMessageId,
      aiMessageId: persisted.aiMessageId,
      classification: extraction.classification,
      checkInCreatedId: persisted.checkInCreatedId,
      workoutLogCreatedId: persisted.workoutLogCreatedId,
      requiresClarification,
      dailyMessageCount: budget.dailyMessageCount,
      remainingMessages: budget.remainingMessages,
      limitReached: budget.limitReached,
    };
  },
});
