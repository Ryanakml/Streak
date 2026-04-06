"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UserButton, useUser } from "@clerk/nextjs";
import { useAction, useMutation, useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import type { Doc } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import {
  CalendarDays,
  ChartNoAxesColumn,
  Check,
  MessageSquare,
  MoonStar,
  MonitorCog,
  PencilLine,
  Plus,
  Sparkles,
  SunMedium,
  Trash2,
  UserCircle2,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AnimatedDock } from "@/components/ui/animated-dock";
import { useTheme } from "@/components/custom/theme-provider";

const DAYS = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
] as const;

const ONBOARDING_PERSONALITY = "brutal" as const;

type AppTab = "home" | "chat" | "stats" | "profile";
type HabitDoc = Doc<"habits">;
type CheckInDoc = Doc<"checkIns">;
type MessageDoc = Doc<"messages">;
type WorkoutLogDoc = Doc<"workoutLogs">;
type WeeklyReportDoc = Doc<"weeklyReports">;
type NotificationPermissionState = NotificationPermission | "unsupported";
type WeekCellState = "completed" | "missed" | "bonus" | "rest" | "scheduled";
type PressureState =
  | "rest"
  | "upcoming"
  | "due-soon"
  | "deadline-risk"
  | "logged"
  | "missed";

type HabitFormState = {
  name: string;
  targetDays: string[];
  scheduledTime: string;
  reminderTime: string;
  checkInDeadline: string;
  rules: string;
  motivation: string;
};

type HabitDetailFormState = HabitFormState & {
  isActive: boolean;
  fridayOverrideEnabled: boolean;
  fridayScheduledTime: string;
  fridayReminderTime: string;
  fridayCheckInDeadline: string;
};

const initialHabitForm: HabitFormState = {
  name: "",
  targetDays: ["mon", "wed", "fri", "sat"],
  scheduledTime: "17:00",
  reminderTime: "16:00",
  checkInDeadline: "18:30",
  rules: "Any workout 30+ mins",
  motivation: "",
};

function getHabitDetailInitialForm(habit: HabitDoc): HabitDetailFormState {
  return {
    name: habit.name,
    targetDays: habit.targetDays,
    scheduledTime: habit.scheduledTime,
    reminderTime: habit.reminderTime,
    checkInDeadline: habit.checkInDeadline,
    rules: habit.rules,
    motivation: habit.motivation,
    isActive: habit.isActive,
    fridayOverrideEnabled: Boolean(habit.schedules?.fri),
    fridayScheduledTime:
      habit.schedules?.fri?.scheduledTime ?? habit.scheduledTime,
    fridayReminderTime:
      habit.schedules?.fri?.reminderTime ?? habit.reminderTime,
    fridayCheckInDeadline:
      habit.schedules?.fri?.checkInDeadline ?? habit.checkInDeadline,
  };
}

function getTodayKey(date: Date) {
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][date.getDay()];
}

function formatToday(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatTime(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatMessageTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatWorkoutDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(timestamp));
}

function formatFullTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatWeekRange(weekStart: string, weekEnd: string) {
  const start = new Date(`${weekStart}T00:00:00`);
  const end = new Date(`${weekEnd}T00:00:00`);
  return `${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(start)} - ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(end)}`;
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function setTimeOnDate(referenceDate: Date, time: string) {
  const [hours, minutes] = time.split(":").map((value) => Number(value));
  const next = new Date(referenceDate);
  next.setHours(hours ?? 0, minutes ?? 0, 0, 0);
  return next;
}

function formatMinutesRemaining(minutes: number) {
  if (minutes <= 0) return "Now";
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (remainder === 0) return `${hours}h left`;
  return `${hours}h ${remainder}m left`;
}

function isReminderIntent(intent: string | undefined) {
  return (
    intent === "reminder_pre_workout" ||
    intent === "reminder_check_in" ||
    intent === "reminder_late_follow_up"
  );
}

function getReminderSeenKey(userId: string) {
  return `streak:lastReminderSeen:${userId}`;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

function getClerkSubscriptionTier(metadata: unknown): "free" | "pro" {
  if (
    metadata &&
    typeof metadata === "object" &&
    "subscriptionTier" in metadata &&
    (metadata as { subscriptionTier?: unknown }).subscriptionTier === "pro"
  ) {
    return "pro";
  }

  return "free";
}

function getStartOfWeek(date: Date) {
  const next = new Date(date);
  const day = next.getDay();
  const diff = (day + 6) % 7;
  next.setDate(next.getDate() - diff);
  next.setHours(0, 0, 0, 0);
  return next;
}

function toTitleDay(day: string) {
  return DAYS.find((entry) => entry.key === day)?.label ?? day;
}

function sortByTimestamp<T extends { timestamp: number }>(items: T[]) {
  return [...items].sort((left, right) => left.timestamp - right.timestamp);
}

function getCompletionSummary(
  checkIns: CheckInDoc[],
  habits: HabitDoc[],
  todayKey: string,
) {
  const scheduledToday = habits.filter(
    (habit) => habit.isActive && habit.targetDays.includes(todayKey),
  ).length;
  const completedToday = checkIns.filter(
    (entry) => entry.status === "completed",
  ).length;
  return { scheduledToday, completedToday };
}

function getWeeklyStats(allCheckIns: CheckInDoc[]) {
  const start = getStartOfWeek(new Date());
  const weekly = allCheckIns.filter(
    (entry) => new Date(entry.timestamp) >= start,
  );

  return {
    total: weekly.length,
    completed: weekly.filter((entry) => entry.status === "completed").length,
    missed: weekly.filter((entry) => entry.status === "missed").length,
    bonus: weekly.filter((entry) => entry.status === "bonus").length,
  };
}

function getWeekDays(date: Date) {
  const start = getStartOfWeek(date);
  return DAYS.map((day, index) => {
    const next = new Date(start);
    next.setDate(start.getDate() + index);
    return {
      key: day.key,
      label: day.label,
      date: next,
      dateKey: toDateKey(next),
    };
  });
}

function formatExerciseSummary(log: WorkoutLogDoc) {
  return log.exercises
    .slice(0, 3)
    .map((exercise) => {
      const parts = [exercise.name];
      if (exercise.sets && exercise.reps) {
        parts.push(`${exercise.sets}x${exercise.reps}`);
      } else if (exercise.duration) {
        parts.push(`${exercise.duration}m`);
      } else if (exercise.distance) {
        parts.push(`${exercise.distance}km`);
      }
      return parts.join(" ");
    })
    .join(", ");
}

function formatCheckInStatus(status: CheckInDoc["status"]) {
  if (status === "completed") return "Completed";
  if (status === "missed") return "Missed";
  return "Bonus";
}

function getWeeklyCellState(
  habit: HabitDoc,
  day: ReturnType<typeof getWeekDays>[number],
  weeklyCheckIns: CheckInDoc[],
  referenceDate: Date,
): WeekCellState {
  const checkIn = weeklyCheckIns.find(
    (entry) => entry.habitId === habit._id && entry.date === day.dateKey,
  );

  if (checkIn) {
    return checkIn.status;
  }

  const todayKey = toDateKey(referenceDate);
  if (habit.targetDays.includes(day.key) && day.dateKey === todayKey) {
    return "scheduled";
  }

  return "rest";
}

function WeekGrid({
  habit,
  weekDays,
  weeklyCheckIns,
  referenceDate,
}: {
  habit: HabitDoc;
  weekDays: ReturnType<typeof getWeekDays>;
  weeklyCheckIns: CheckInDoc[];
  referenceDate: Date;
}) {
  return (
    <div className="grid grid-cols-2 border-2 border-black sm:grid-cols-4 lg:grid-cols-7">
      {weekDays.map((day) => {
        const state = getWeeklyCellState(
          habit,
          day,
          weeklyCheckIns,
          referenceDate,
        );
        const label =
          state === "completed"
            ? "Done"
            : state === "missed"
              ? "Miss"
              : state === "bonus"
                ? "Bonus"
                : state === "scheduled"
                  ? "Due"
                  : "Rest";

        return (
          <div
            key={`${habit._id}-${day.dateKey}`}
            className={`border-b-2 border-r-2 border-black p-3 text-left lg:last:border-r-0 ${
              state === "missed"
                ? "bg-[#DF3B23] text-white"
                : state === "completed"
                  ? "bg-black text-white"
                  : state === "bonus"
                    ? "bg-secondary text-foreground"
                    : "bg-background text-foreground"
            }`}
          >
            <p
              className={`text-[10px] font-black uppercase tracking-[0.24em] ${
                state === "missed" || state === "completed"
                  ? "text-white/80"
                  : "text-muted-foreground"
              }`}
            >
              {day.label}
            </p>
            <div className="mt-3 inline-flex border-2 border-current px-2 py-1 text-[10px] font-black uppercase tracking-[0.18em]">
              {label}
            </div>
            <p
              className={`mt-4 text-xs uppercase tracking-[0.12em] ${
                state === "missed" || state === "completed"
                  ? "text-white"
                  : "text-muted-foreground"
              }`}
            >
              {formatWorkoutDate(day.date.getTime())}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function HabitComposerDialog({
  disabled,
  onCreate,
}: {
  disabled: boolean;
  onCreate: (form: HabitFormState) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<HabitFormState>(initialHabitForm);
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    setSaving(true);
    try {
      await onCreate(form);
      setForm(initialHabitForm);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <Button type="button" disabled={disabled}>
          <Plus />
          New Habit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-3xl">Create Habit</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Add another live habit. Limits are still enforced by your Convex
            user state.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="habit-name">Habit name</Label>
            <Input
              id="habit-name"
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Go to gym 4x/week"
            />
          </div>

          <div className="grid gap-3">
            <Label>Target days</Label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {DAYS.map((day) => {
                const checked = form.targetDays.includes(day.key);
                return (
                  <label
                    key={day.key}
                    className="flex items-center gap-3 border-2 border-black bg-background px-3 py-3 text-sm uppercase"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          targetDays: value
                            ? [...current.targetDays, day.key]
                            : current.targetDays.filter(
                                (entry) => entry !== day.key,
                              ),
                        }))
                      }
                    />
                    <span>{day.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="scheduled-time">Scheduled</Label>
              <Input
                id="scheduled-time"
                type="time"
                value={form.scheduledTime}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    scheduledTime: event.target.value,
                  }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="reminder-time">Reminder</Label>
              <Input
                id="reminder-time"
                type="time"
                value={form.reminderTime}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    reminderTime: event.target.value,
                  }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="deadline-time">Deadline</Label>
              <Input
                id="deadline-time"
                type="time"
                value={form.checkInDeadline}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    checkInDeadline: event.target.value,
                  }))
                }
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="habit-rules">What counts?</Label>
            <Input
              id="habit-rules"
              value={form.rules}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  rules: event.target.value,
                }))
              }
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="habit-motivation">Why does this matter?</Label>
            <Textarea
              id="habit-motivation"
              value={form.motivation}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  motivation: event.target.value,
                }))
              }
              className="min-h-28"
              placeholder="I am tired of quitting on myself."
            />
          </div>

          <Button
            type="button"
            disabled={
              saving ||
              !form.name.trim() ||
              !form.rules.trim() ||
              !form.motivation.trim() ||
              form.targetDays.length === 0
            }
            onClick={handleSubmit}
          >
            {saving ? "Saving..." : "Lock It In"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OnboardingFlow({
  userName,
  onComplete,
}: {
  userName: string;
  onComplete: (form: HabitFormState) => Promise<void>;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [form, setForm] = useState<HabitFormState>(initialHabitForm);
  const [saving, setSaving] = useState(false);

  async function finishOnboarding() {
    setSaving(true);
    try {
      await onComplete(form);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-6 py-10 text-foreground">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div className="space-y-3">
          <p className="brutal-meta">Streak Onboarding</p>
          <h1 className="text-4xl font-black uppercase tracking-[-0.08em] sm:text-6xl">
            {step === 1 && `Choose your coach, ${userName}.`}
            {step === 2 && "What habit are you building?"}
            {step === 3 && "Lock the first habit in."}
          </h1>
          <p className="max-w-2xl text-sm uppercase tracking-[0.12em] text-muted-foreground">
            This is the product flow foundation. Once onboarding is complete,
            the Home, Chat, and Profile tabs run from the same saved habit data.
          </p>
        </div>

        {step === 1 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-3xl">Choose Your Coach</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="brutal-alert p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-3">
                    <p className="text-2xl font-black uppercase tracking-[-0.05em]">
                      Brutal Mode
                    </p>
                    <p className="text-sm uppercase tracking-[0.12em] text-white/90">
                      No excuses. No fake encouragement. Just direct pressure
                      and consistency.
                    </p>
                  </div>
                  <Badge className="bg-white text-black">Default</Badge>
                </div>
              </div>

              <div className="border-2 border-dashed border-black bg-background p-6 text-sm uppercase tracking-[0.12em] text-muted-foreground">
                Coach Mode and other personalities can layer on later. Right now
                the app ships with the brutal coach only, exactly like your
                spec.
              </div>

              <div className="flex justify-end">
                <Button type="button" onClick={() => setStep(2)}>
                  Continue
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {step === 2 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-3xl">First Habit</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="grid gap-2">
                <Label htmlFor="onboarding-habit-name">Habit name</Label>
                <Input
                  id="onboarding-habit-name"
                  value={form.name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Go to gym 4x/week"
                />
              </div>

              <div className="grid gap-2 border-2 border-black bg-secondary p-4 text-sm uppercase tracking-[0.12em] text-muted-foreground">
                <p>Examples:</p>
                <p>Go to gym 4x/week</p>
                <p>No phone before 9am</p>
                <p>Read 30 mins daily</p>
              </div>

              <div className="flex justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep(1)}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  disabled={!form.name.trim()}
                  onClick={() => setStep(3)}
                >
                  Continue
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {step === 3 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-3xl">AI Clarification</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-6">
              <div className="border-2 border-black bg-secondary p-4 text-sm uppercase tracking-[0.12em] text-muted-foreground">
                Alright, so you want to build{" "}
                <span className="font-black text-foreground">{form.name}</span>.
                Lock down the days, timing, what counts, and why this actually
                matters.
              </div>

              <div className="grid gap-3">
                <Label>Which days?</Label>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {DAYS.map((day) => {
                    const checked = form.targetDays.includes(day.key);
                    return (
                      <label
                        key={day.key}
                        className="flex items-center gap-3 border-2 border-black bg-background px-3 py-3 text-sm uppercase"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) =>
                            setForm((current) => ({
                              ...current,
                              targetDays: value
                                ? [...current.targetDays, day.key]
                                : current.targetDays.filter(
                                    (entry) => entry !== day.key,
                                  ),
                            }))
                          }
                        />
                        <span>{day.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="grid gap-2">
                  <Label htmlFor="onboarding-scheduled">Target time</Label>
                  <Input
                    id="onboarding-scheduled"
                    type="time"
                    value={form.scheduledTime}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        scheduledTime: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="onboarding-reminder">Reminder</Label>
                  <Input
                    id="onboarding-reminder"
                    type="time"
                    value={form.reminderTime}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        reminderTime: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="onboarding-deadline">Deadline</Label>
                  <Input
                    id="onboarding-deadline"
                    type="time"
                    value={form.checkInDeadline}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        checkInDeadline: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="onboarding-rules">What counts as done?</Label>
                <Input
                  id="onboarding-rules"
                  value={form.rules}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      rules: event.target.value,
                    }))
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="onboarding-motivation">Why this habit?</Label>
                <Textarea
                  id="onboarding-motivation"
                  value={form.motivation}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      motivation: event.target.value,
                    }))
                  }
                  className="min-h-28"
                  placeholder="I'm tired of being skinny."
                />
              </div>

              <div className="brutal-alert p-4">
                <p className="text-sm font-black uppercase tracking-[0.25em] text-white">
                  Confirmation
                </p>
                <div className="mt-3 grid gap-2 text-sm uppercase tracking-[0.12em] text-white">
                  <p>
                    Target:{" "}
                    <span className="font-black text-white">{form.name}</span>
                  </p>
                  <p>
                    Days:{" "}
                    <span className="font-black text-white">
                      {form.targetDays.map(toTitleDay).join(" / ")}
                    </span>
                  </p>
                  <p>
                    Schedule:{" "}
                    <span className="font-black text-white">
                      {form.scheduledTime} with reminder at {form.reminderTime}
                    </span>
                  </p>
                </div>
              </div>

              <div className="flex justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStep(2)}
                >
                  Back
                </Button>
                <Button
                  type="button"
                  disabled={
                    saving ||
                    form.targetDays.length === 0 ||
                    !form.rules.trim() ||
                    !form.motivation.trim()
                  }
                  onClick={finishOnboarding}
                >
                  {saving ? "Saving..." : "Yes, Let’s Go"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </main>
  );
}

type HabitPressureSnapshot = {
  habit: HabitDoc;
  checkIn?: CheckInDoc;
  scheduledToday: boolean;
  state: PressureState;
  priority: number;
  nextTimeLabel: string;
  nextTimeValue: string;
  countdownLabel: string;
  headline: string;
  support: string;
  streakLabel: string;
  primaryActionLabel: string;
  chatPrompt: string;
  cardClassName: string;
  badgeClassName: string;
  panelClassName: string;
  panelToneClassName: string;
  emphasisClassName: string;
  countdownMinutes: number | null;
  deadlineProgress: number | null;
  urgencyLabel: string;
  isPrimaryCandidate: boolean;
};

function getPressurePriority(state: PressureState) {
  if (state === "missed") return 6;
  if (state === "deadline-risk") return 5;
  if (state === "due-soon") return 4;
  if (state === "upcoming") return 3;
  if (state === "logged") return 2;
  return 1;
}

function getHabitPressureSnapshot(
  habit: HabitDoc,
  todayKey: string,
  todayDate: string,
  todayCheckIns: CheckInDoc[],
  referenceDate: Date,
): HabitPressureSnapshot {
  const checkIn = todayCheckIns.find((entry) => entry.habitId === habit._id);
  const scheduledToday = habit.isActive && habit.targetDays.includes(todayKey);
  const reminderDate = setTimeOnDate(referenceDate, habit.reminderTime);
  const deadlineDate = setTimeOnDate(referenceDate, habit.checkInDeadline);
  const minutesToReminder = Math.ceil(
    (reminderDate.getTime() - referenceDate.getTime()) / 60000,
  );
  const minutesToDeadline = Math.ceil(
    (deadlineDate.getTime() - referenceDate.getTime()) / 60000,
  );
  const isOverdue =
    scheduledToday &&
    !checkIn &&
    minutesToDeadline <= 0 &&
    todayDate === toDateKey(referenceDate);
  const totalWindowMinutes = Math.max(
    1,
    Math.round((deadlineDate.getTime() - reminderDate.getTime()) / 60000),
  );
  const elapsedWindowMinutes = Math.min(
    totalWindowMinutes,
    Math.max(
      0,
      Math.round((referenceDate.getTime() - reminderDate.getTime()) / 60000),
    ),
  );
  const deadlineProgress = scheduledToday
    ? Math.min(
        100,
        Math.max(
          0,
          Math.round((elapsedWindowMinutes / totalWindowMinutes) * 100),
        ),
      )
    : null;

  let state: PressureState = "rest";
  if (checkIn?.status === "missed") {
    state = "missed";
  } else if (checkIn?.status === "completed" || checkIn?.status === "bonus") {
    state = "logged";
  } else if (!scheduledToday) {
    state = "rest";
  } else if (isOverdue || minutesToDeadline <= 45) {
    state = "deadline-risk";
  } else if (minutesToReminder <= 0 || minutesToDeadline <= 120) {
    state = "due-soon";
  } else {
    state = "upcoming";
  }

  const streakRisk =
    scheduledToday &&
    !checkIn &&
    habit.currentStreak > 0 &&
    (state === "due-soon" || state === "deadline-risk");

  const base = {
    nextTimeLabel: "Schedule",
    nextTimeValue: habit.scheduledTime,
    countdownLabel: "Later today",
    headline: "No pressure today.",
    support:
      "Rest day. Recover or log a bonus session if you still put work in.",
    streakLabel:
      habit.currentStreak > 0
        ? `Current streak ${habit.currentStreak} days`
        : "No streak running",
    primaryActionLabel: "Open chat",
    chatPrompt: `How am I doing with ${habit.name}?`,
    cardClassName: "bg-card text-foreground",
    badgeClassName: "bg-background text-foreground border-black",
    panelClassName: "border-black bg-background text-foreground",
    panelToneClassName: "text-foreground",
    emphasisClassName: "text-foreground",
    countdownMinutes: null,
    deadlineProgress: scheduledToday ? deadlineProgress : null,
    urgencyLabel: "No active clock",
    isPrimaryCandidate: scheduledToday || Boolean(checkIn),
  };

  if (state === "logged") {
    return {
      ...base,
      habit,
      checkIn,
      scheduledToday,
      state,
      priority: getPressurePriority(state),
      nextTimeLabel: "Logged",
      nextTimeValue: formatFullTime(
        checkIn?.timestamp ?? referenceDate.getTime(),
      ),
      countdownLabel:
        checkIn?.status === "bonus" ? "Bonus work banked" : "Target handled",
      headline:
        habit.currentStreak + 1 > 1
          ? `Chain protected. ${habit.name} is done.`
          : `${habit.name} is on the board.`,
      support:
        checkIn?.status === "bonus"
          ? "Extra work counts. Keep the standard tomorrow just as clean."
          : "You handled today's rep. Tomorrow still expects the same standard.",
      streakLabel:
        habit.currentStreak > 0
          ? `Streak rolling ${habit.currentStreak} days`
          : "First clean log on record",
      primaryActionLabel: "Review with coach",
      chatPrompt: `Give me the readout for ${habit.name} after today's log.`,
      cardClassName: "bg-black text-white",
      badgeClassName: "bg-white text-black border-white",
      panelClassName: "border-white/40 bg-white/10 text-white",
      panelToneClassName: "text-white",
      emphasisClassName: "text-white",
      countdownMinutes: null,
      deadlineProgress: 100,
      urgencyLabel: "Locked in",
      isPrimaryCandidate: true,
    };
  }

  if (state === "missed") {
    return {
      ...base,
      habit,
      checkIn,
      scheduledToday,
      state,
      priority: getPressurePriority(state),
      nextTimeLabel: "Miss recorded",
      nextTimeValue: checkIn
        ? formatFullTime(checkIn.timestamp)
        : habit.checkInDeadline,
      countdownLabel: "Deadline lost",
      headline: `${habit.name} slipped today.`,
      support:
        habit.currentStreak > 0
          ? `That broke a ${habit.currentStreak}-day run. Write the excuse in chat, then reset for the next slot.`
          : "You let today's slot go. Own it in chat and set up the next clean rep.",
      streakLabel:
        habit.bestStreak > 0
          ? `Best streak still ${habit.bestStreak} days`
          : "No clean run built yet",
      primaryActionLabel: "Explain the miss",
      chatPrompt: `I missed ${habit.name}. Help me reset the next rep.`,
      cardClassName: "bg-[#DF3B23] text-white",
      badgeClassName: "bg-white text-[#DF3B23] border-white",
      panelClassName: "border-[#D8B0A8] bg-[#F5E8E0] text-[#5A160D]",
      panelToneClassName: "text-[#5A160D]",
      emphasisClassName: "text-[#8D220F]",
      countdownMinutes: null,
      deadlineProgress: 100,
      urgencyLabel: "Window closed",
      isPrimaryCandidate: true,
    };
  }

  if (state === "deadline-risk") {
    return {
      ...base,
      habit,
      checkIn,
      scheduledToday,
      state,
      priority: getPressurePriority(state),
      nextTimeLabel: minutesToDeadline <= 0 ? "Past deadline" : "Deadline",
      nextTimeValue: habit.checkInDeadline,
      countdownLabel:
        minutesToDeadline <= 0
          ? "You are already late"
          : formatMinutesRemaining(minutesToDeadline),
      headline:
        minutesToDeadline <= 0
          ? `Deadline passed for ${habit.name}.`
          : `${habit.name} is about to cost you.`,
      support:
        minutesToDeadline <= 0
          ? "The slot is blown unless you own it now. Open chat and explain what happened."
          : "Stop scanning and log the session before this turns into a miss.",
      streakLabel: streakRisk
        ? `Streak at risk: ${habit.currentStreak} days`
        : base.streakLabel,
      primaryActionLabel:
        minutesToDeadline <= 0 ? "Own the miss" : "Log it now",
      chatPrompt:
        minutesToDeadline <= 0
          ? `I am late on ${habit.name}. Help me recover the next session.`
          : `I am close to missing ${habit.name}. Keep me focused.`,
      cardClassName: "bg-[#F2D6D1] text-foreground",
      badgeClassName: "bg-[#DF3B23] text-white border-[#DF3B23]",
      panelClassName: "border-[#DF3B23] bg-white text-foreground",
      panelToneClassName: "text-foreground",
      emphasisClassName: "text-[#DF3B23]",
      countdownMinutes: minutesToDeadline,
      deadlineProgress,
      urgencyLabel:
        minutesToDeadline <= 0 ? "Past deadline" : "Deadline clock running",
      isPrimaryCandidate: true,
    };
  }

  if (state === "due-soon") {
    return {
      ...base,
      habit,
      checkIn,
      scheduledToday,
      state,
      priority: getPressurePriority(state),
      nextTimeLabel: minutesToReminder <= 0 ? "Deadline" : "Reminder",
      nextTimeValue:
        minutesToReminder <= 0 ? habit.checkInDeadline : habit.reminderTime,
      countdownLabel:
        minutesToReminder <= 0
          ? formatMinutesRemaining(minutesToDeadline)
          : formatMinutesRemaining(Math.max(minutesToReminder, 0)),
      headline: `${habit.name} is live today.`,
      support:
        minutesToReminder <= 0
          ? "The reminder window is already open. Finish before the deadline starts squeezing."
          : "Your reminder window is here. Decide now before the deadline owns the day.",
      streakLabel: streakRisk
        ? `Streak at risk: ${habit.currentStreak} days`
        : base.streakLabel,
      primaryActionLabel: "Check in now",
      chatPrompt: `Keep me on track for ${habit.name} today.`,
      cardClassName: "bg-[#F4E9C9] text-foreground",
      badgeClassName: "bg-black text-white border-black",
      panelClassName: "border-black bg-white text-foreground",
      panelToneClassName: "text-foreground",
      emphasisClassName: "text-foreground",
      countdownMinutes:
        minutesToReminder <= 0 ? minutesToDeadline : minutesToReminder,
      deadlineProgress,
      urgencyLabel:
        minutesToReminder <= 0
          ? "Countdown to deadline"
          : "Reminder window opening",
      isPrimaryCandidate: true,
    };
  }

  if (state === "upcoming") {
    return {
      ...base,
      habit,
      checkIn,
      scheduledToday,
      state,
      priority: getPressurePriority(state),
      nextTimeLabel: "Reminder",
      nextTimeValue: habit.reminderTime,
      countdownLabel: formatMinutesRemaining(Math.max(minutesToReminder, 0)),
      headline: `${habit.name} is next up.`,
      support:
        "The slot is booked. Keep the day clean so you are ready when the reminder hits.",
      streakLabel: streakRisk
        ? `Streak at risk: ${habit.currentStreak} days`
        : base.streakLabel,
      primaryActionLabel: "Prep with coach",
      chatPrompt: `Set me up to hit ${habit.name} clean today.`,
      cardClassName: "bg-card text-foreground",
      badgeClassName: "bg-background text-foreground border-black",
      panelClassName: "border-black bg-background text-foreground",
      panelToneClassName: "text-foreground",
      emphasisClassName: "text-foreground",
      countdownMinutes: minutesToReminder,
      deadlineProgress,
      urgencyLabel: "Clock not hot yet",
      isPrimaryCandidate: true,
    };
  }

  return {
    ...base,
    habit,
    checkIn,
    scheduledToday,
    state,
    priority: getPressurePriority(state),
    panelToneClassName: "text-foreground",
    emphasisClassName: "text-foreground",
    countdownMinutes: null,
    deadlineProgress: null,
    urgencyLabel: "No active clock",
  };
}

function rankHabitSnapshots(
  left: HabitPressureSnapshot,
  right: HabitPressureSnapshot,
) {
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }
  if (left.scheduledToday !== right.scheduledToday) {
    return left.scheduledToday ? -1 : 1;
  }
  if (left.habit.currentStreak !== right.habit.currentStreak) {
    return right.habit.currentStreak - left.habit.currentStreak;
  }
  return left.habit.name.localeCompare(right.habit.name);
}

function PressureBadge({
  snapshot,
  subtle = false,
}: {
  snapshot: HabitPressureSnapshot;
  subtle?: boolean;
}) {
  return (
    <span
      className={`inline-flex border px-2 py-1 text-[10px] font-black uppercase tracking-[0.22em] ${
        subtle ? "border-current/40 bg-transparent" : snapshot.badgeClassName
      }`}
    >
      {snapshot.state === "rest"
        ? "Rest"
        : snapshot.state === "upcoming"
          ? "Up next"
          : snapshot.state === "due-soon"
            ? "Due soon"
            : snapshot.state === "deadline-risk"
              ? "Deadline risk"
              : snapshot.state === "logged"
                ? "Logged"
                : "Missed"}
    </span>
  );
}

function CountdownMeter({
  snapshot,
  compact = false,
}: {
  snapshot: HabitPressureSnapshot;
  compact?: boolean;
}) {
  if (snapshot.deadlineProgress === null) {
    return null;
  }

  return (
    <div className={`space-y-2 ${snapshot.panelToneClassName}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 text-[10px] font-black uppercase tracking-[0.24em]">
        <span>{snapshot.urgencyLabel}</span>
        <span className={snapshot.emphasisClassName}>
          {snapshot.countdownMinutes === null
            ? snapshot.countdownLabel
            : formatMinutesRemaining(snapshot.countdownMinutes)}
        </span>
      </div>
      <div
        className={`border border-current/20 ${compact ? "h-2" : "h-3"} bg-black/5`}
      >
        <div
          className={`h-full transition-all duration-500 ${
            snapshot.state === "missed" || snapshot.state === "deadline-risk"
              ? "bg-[#DF3B23]"
              : snapshot.state === "logged"
                ? "bg-black"
                : "bg-[#B88A12]"
          } ${snapshot.state === "missed" ? "animate-pulse" : ""}`}
          style={{ width: `${snapshot.deadlineProgress}%` }}
        />
      </div>
    </div>
  );
}

function SummaryStatusCard({
  snapshot,
  scheduledToday,
  completedToday,
  subscriptionTier,
  currentTime,
  onPrimaryAction,
}: {
  snapshot: HabitPressureSnapshot | null;
  scheduledToday: number;
  completedToday: number;
  subscriptionTier: "free" | "pro";
  currentTime: Date;
  onPrimaryAction: () => void;
}) {
  return (
    <div className="grid gap-6 md:grid-cols-[1.1fr_0.9fr]">
      <div className="space-y-3">
        <p className="brutal-meta">Streak</p>
        <h1 className="text-5xl font-black uppercase tracking-[-0.08em] sm:text-7xl">
          {formatToday(currentTime)}
        </h1>
        <p className="border-t-2 border-black pt-3 text-xl font-black uppercase tracking-[0.22em] text-muted-foreground">
          {formatTime(currentTime)}
        </p>
      </div>

      <div
        className={`grid gap-4 border-2 p-5 shadow-[6px_6px_0px_0px_rgba(26,24,20,1)] ${
          snapshot?.panelClassName ??
          "border-black bg-background text-foreground"
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-current/20 pb-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {snapshot ? <PressureBadge snapshot={snapshot} /> : null}
              <Badge className="bg-black text-white">
                {subscriptionTier.toUpperCase()}
              </Badge>
            </div>
            <p className="text-3xl font-black uppercase tracking-[-0.05em]">
              {snapshot ? snapshot.headline : "Nothing due today."}
            </p>
            {snapshot ? <CountdownMeter snapshot={snapshot} compact /> : null}
          </div>
          <div className="text-right">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] opacity-70">
              Daily status
            </p>
            <p className="mt-2 text-2xl font-black">
              {scheduledToday > 0
                ? `${completedToday}/${scheduledToday}`
                : "0/0"}
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-2">
            <p
              className={`text-sm uppercase tracking-[0.14em] opacity-80 ${snapshot?.panelToneClassName ?? ""}`}
            >
              {snapshot
                ? `${snapshot.habit.name} · ${snapshot.countdownLabel}`
                : "No target habit is scheduled. Use chat for bonus work or tomorrow's setup."}
            </p>
            <p
              className={`text-sm uppercase tracking-[0.12em] opacity-80 ${snapshot?.panelToneClassName ?? ""}`}
            >
              {snapshot?.support ??
                "No target habit is scheduled today. Use chat to plan ahead."}
            </p>
            {snapshot ? (
              <div
                className={`flex flex-wrap gap-3 text-xs font-black uppercase tracking-[0.18em] ${snapshot.panelToneClassName}`}
              >
                <span>
                  {snapshot.nextTimeLabel}: {snapshot.nextTimeValue}
                </span>
                <span>{snapshot.streakLabel}</span>
              </div>
            ) : null}
          </div>
          <Button
            type="button"
            variant={snapshot?.state === "logged" ? "outline" : "default"}
            onClick={onPrimaryAction}
          >
            {snapshot?.primaryActionLabel ?? "Open chat"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function HomeHabitCard({
  snapshot,
  isPrimary,
  pendingHabitId,
  onOpenChat,
  onMarkComplete,
  onLogMiss,
  onToggleActive,
  onDeleteHabit,
  onOpenDetail,
}: {
  snapshot: HabitPressureSnapshot;
  isPrimary: boolean;
  pendingHabitId: string | null;
  onOpenChat: () => void;
  onMarkComplete: (habit: HabitDoc) => Promise<void>;
  onLogMiss: (habit: HabitDoc) => Promise<void>;
  onToggleActive: (habit: HabitDoc) => Promise<void>;
  onDeleteHabit: (habit: HabitDoc) => Promise<void>;
  onOpenDetail: (habit: HabitDoc) => void;
}) {
  const { habit, checkIn, scheduledToday, state } = snapshot;
  const canMarkComplete =
    pendingHabitId !== habit._id &&
    !checkIn &&
    habit.isActive &&
    scheduledToday &&
    state !== "missed";

  return (
    <Card
      className={`${snapshot.cardClassName} ${
        isPrimary
          ? "border-[3px] shadow-[10px_10px_0px_0px_rgba(26,24,20,1)]"
          : scheduledToday
            ? "opacity-100"
            : "opacity-75"
      }`}
    >
      <CardHeader className="flex flex-col gap-4 border-b-2 border-current/15 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {isPrimary ? (
              <span className="text-[10px] font-black uppercase tracking-[0.28em] opacity-70">
                Primary target
              </span>
            ) : null}
            <PressureBadge snapshot={snapshot} subtle={!isPrimary} />
            <Badge variant="outline">
              {habit.isActive ? "Active" : "Paused"}
            </Badge>
          </div>
          <div className="space-y-2">
            <CardTitle className={`${isPrimary ? "text-4xl" : "text-3xl"}`}>
              {habit.name}
            </CardTitle>
            <p className="text-sm uppercase tracking-[0.12em] opacity-80">
              {snapshot.headline}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenDetail(habit)}
          >
            <PencilLine />
            Details
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onToggleActive(habit)}
            disabled={pendingHabitId === habit._id}
          >
            {habit.isActive ? "Pause" : "Resume"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => onDeleteHabit(habit)}
            disabled={pendingHabitId === habit._id}
          >
            <Trash2 />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="grid gap-6 p-6">
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className={`border-2 p-5 ${snapshot.panelClassName}`}>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] opacity-70">
              Today status
            </p>
            <p className="mt-3 text-3xl font-black uppercase tracking-[-0.05em]">
              {state === "logged"
                ? "Handled"
                : state === "missed"
                  ? "Missed"
                  : state === "deadline-risk"
                    ? "Move now"
                    : state === "due-soon"
                      ? "Window open"
                      : state === "upcoming"
                        ? "Queued up"
                        : "Off the clock"}
            </p>
            <p className="mt-3 text-sm uppercase tracking-[0.12em] opacity-80">
              {snapshot.support}
            </p>
            <div className="mt-4 flex flex-wrap gap-3 text-xs font-black uppercase tracking-[0.18em]">
              <span>
                {snapshot.nextTimeLabel}: {snapshot.nextTimeValue}
              </span>
              <span>{snapshot.countdownLabel}</span>
            </div>
            <div className="mt-4">
              <CountdownMeter snapshot={snapshot} />
            </div>
          </div>

          <div className="grid border-2 border-current/20 sm:grid-cols-3">
            <div className="border-b-2 border-r-0 border-current/20 p-4 sm:border-b-0 sm:border-r-2">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] opacity-70">
                Reminder
              </p>
              <p className="mt-3 text-2xl font-black">{habit.reminderTime}</p>
            </div>
            <div className="border-b-2 border-r-0 border-current/20 p-4 sm:border-b-0 sm:border-r-2">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] opacity-70">
                Deadline
              </p>
              <p className="mt-3 text-2xl font-black">
                {habit.checkInDeadline}
              </p>
            </div>
            <div className="p-4">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] opacity-70">
                Streak
              </p>
              <p className="mt-3 text-2xl font-black">
                {habit.currentStreak} days
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant={state === "logged" ? "outline" : "default"}
            disabled={!canMarkComplete}
            onClick={() => {
              if (
                state === "deadline-risk" &&
                snapshot.countdownMinutes !== null &&
                snapshot.countdownMinutes <= 0
              ) {
                return onLogMiss(habit);
              }
              return onMarkComplete(habit);
            }}
          >
            {state === "logged"
              ? "Already logged"
              : state === "missed"
                ? "Miss recorded"
                : snapshot.primaryActionLabel}
          </Button>
          <Button type="button" variant="outline" onClick={onOpenChat}>
            <MessageSquare />
            {state === "missed" ? "Reset in chat" : "Chat with coach"}
          </Button>
        </div>

        <div className="space-y-3 border-t-2 border-current/15 pt-5">
          <p className="text-sm uppercase tracking-[0.12em] opacity-80">
            <span className="mr-2 font-black text-current">Rules:</span>
            {habit.rules}
          </p>
          <p className="text-sm uppercase tracking-[0.12em] opacity-80">
            <span className="mr-2 font-black text-current">Motivation:</span>
            {habit.motivation}
          </p>
          <div className="flex flex-wrap gap-2">
            {habit.targetDays.map((day) => (
              <Badge key={`${habit._id}-${day}`} variant="outline">
                {toTitleDay(day)}
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function CoachContextRail({
  snapshot,
  onLoadPrompt,
}: {
  snapshot: HabitPressureSnapshot | null;
  onLoadPrompt: (value: string) => void;
}) {
  return (
    <div
      className={`grid gap-3 border-2 px-4 py-4 ${
        snapshot?.panelClassName ?? "border-black bg-secondary text-foreground"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="brutal-meta text-current">Coach context</p>
            {snapshot ? <PressureBadge snapshot={snapshot} /> : null}
          </div>
          <p
            className={`text-2xl font-black uppercase tracking-[-0.05em] ${snapshot?.panelToneClassName ?? ""}`}
          >
            {snapshot ? snapshot.habit.name : "No target habit today"}
          </p>
          <p
            className={`text-sm uppercase tracking-[0.12em] opacity-80 ${snapshot?.panelToneClassName ?? ""}`}
          >
            {snapshot?.support ??
              "Use this space for bonus logs, planning, or review."}
          </p>
        </div>
        {snapshot ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => onLoadPrompt(snapshot.chatPrompt)}
          >
            <Sparkles />
            Load prompt
          </Button>
        ) : null}
      </div>
      {snapshot ? (
        <div className="space-y-3">
          <div
            className={`flex flex-wrap gap-3 text-xs font-black uppercase tracking-[0.18em] ${snapshot.panelToneClassName}`}
          >
            <span>
              {snapshot.nextTimeLabel}: {snapshot.nextTimeValue}
            </span>
            <span>{snapshot.countdownLabel}</span>
            <span>{snapshot.streakLabel}</span>
          </div>
          <CountdownMeter snapshot={snapshot} compact />
        </div>
      ) : null}
    </div>
  );
}

function HomeTab({
  snapshots,
  primarySnapshot,
  pendingHabitId,
  onOpenChat,
  onMarkComplete,
  onLogMiss,
  onToggleActive,
  onDeleteHabit,
  onOpenDetail,
  canAddHabit,
  onCreateHabit,
}: {
  snapshots: HabitPressureSnapshot[];
  primarySnapshot: HabitPressureSnapshot | null;
  pendingHabitId: string | null;
  onOpenChat: () => void;
  onMarkComplete: (habit: HabitDoc) => Promise<void>;
  onLogMiss: (habit: HabitDoc) => Promise<void>;
  onToggleActive: (habit: HabitDoc) => Promise<void>;
  onDeleteHabit: (habit: HabitDoc) => Promise<void>;
  onOpenDetail: (habit: HabitDoc) => void;
  canAddHabit: boolean;
  onCreateHabit: (form: HabitFormState) => Promise<void>;
}) {
  const todayHabits = snapshots.filter((snapshot) => snapshot.scheduledToday);
  const orderedSnapshots = [...snapshots].sort(rankHabitSnapshots);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b-2 border-black pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="brutal-meta">Dashboard</p>
          <h2 className="text-4xl font-black uppercase tracking-[-0.08em]">
            Home
          </h2>
          <p className="mt-2 text-sm uppercase tracking-[0.12em] text-muted-foreground">
            Quick actions, current streaks, and today&apos;s targets.
          </p>
        </div>
        <HabitComposerDialog disabled={!canAddHabit} onCreate={onCreateHabit} />
      </div>

      {todayHabits.length === 0 ? (
        <Card className="bg-secondary">
          <CardContent className="flex flex-col gap-3 p-6">
            <p className="text-2xl font-black uppercase tracking-[-0.05em]">
              Rest Day
            </p>
            <p className="text-sm uppercase tracking-[0.12em] text-muted-foreground">
              No target habit is scheduled today. Use chat if you still train,
              or clean up tomorrow before it gets loose.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {orderedSnapshots.map((snapshot) => (
        <HomeHabitCard
          key={snapshot.habit._id}
          snapshot={snapshot}
          isPrimary={primarySnapshot?.habit._id === snapshot.habit._id}
          pendingHabitId={pendingHabitId}
          onOpenChat={onOpenChat}
          onMarkComplete={onMarkComplete}
          onLogMiss={onLogMiss}
          onToggleActive={onToggleActive}
          onDeleteHabit={onDeleteHabit}
          onOpenDetail={onOpenDetail}
        />
      ))}
    </div>
  );
}

function ChatTab({
  messages,
  primarySnapshot,
  budgetStatus,
  billingPending,
  errorMessage,
  input,
  setInput,
  sending,
  onSend,
  onQuickComplete,
  onQuickMiss,
  onUpgrade,
}: {
  messages: MessageDoc[];
  primarySnapshot: HabitPressureSnapshot | null;
  budgetStatus: {
    dailyMessageCount: number;
    dailyMessageCap: number | null;
    remainingMessages: number | null;
    limitReached: boolean;
    isUnlimited: boolean;
  } | null;
  billingPending: "free" | "pro" | null;
  errorMessage: string | null;
  input: string;
  setInput: (value: string) => void;
  sending: boolean;
  onSend: (content: string) => Promise<void>;
  onQuickComplete: () => Promise<void>;
  onQuickMiss: () => Promise<void>;
  onUpgrade: () => Promise<void>;
}) {
  const sortedMessages = sortByTimestamp(messages);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const limitReached = budgetStatus?.limitReached ?? false;
  const lastMessageId = sortedMessages[sortedMessages.length - 1]?._id ?? null;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end", behavior: "auto" });
  }, [lastMessageId, sortedMessages.length]);

  const quickActions = primarySnapshot
    ? primarySnapshot.state === "missed"
      ? [
          {
            key: "missed",
            label: "Own the miss",
            variant: "default" as const,
            onClick: onQuickMiss,
            icon: <MoonStar />,
          },
          {
            key: "review",
            label: "Reset with coach",
            variant: "outline" as const,
            onClick: async () => setInput(primarySnapshot.chatPrompt),
            icon: <Sparkles />,
          },
          {
            key: "done",
            label: "Mark done",
            variant: "outline" as const,
            onClick: onQuickComplete,
            icon: <Check />,
          },
        ]
      : primarySnapshot.state === "logged"
        ? [
            {
              key: "review",
              label: "Review today",
              variant: "default" as const,
              onClick: async () => setInput(primarySnapshot.chatPrompt),
              icon: <Sparkles />,
            },
            {
              key: "done",
              label: "Already logged",
              variant: "outline" as const,
              onClick: onQuickComplete,
              icon: <Check />,
            },
            {
              key: "skip",
              label: "Record miss",
              variant: "outline" as const,
              onClick: onQuickMiss,
              icon: <MoonStar />,
            },
          ]
        : [
            {
              key: "done",
              label:
                primarySnapshot.state === "deadline-risk"
                  ? "Log it now"
                  : "Mark today done",
              variant: "default" as const,
              onClick: onQuickComplete,
              icon: <Check />,
            },
            {
              key: "review",
              label:
                primarySnapshot.state === "upcoming"
                  ? "Prep with coach"
                  : "Ask coach",
              variant: "outline" as const,
              onClick: async () => setInput(primarySnapshot.chatPrompt),
              icon: <Sparkles />,
            },
            {
              key: "skip",
              label: "I skipped today",
              variant: "outline" as const,
              onClick: onQuickMiss,
              icon: <MoonStar />,
            },
          ]
    : [
        {
          key: "review",
          label: "Ask coach",
          variant: "default" as const,
          onClick: async () => setInput("How should I use today well?"),
          icon: <Sparkles />,
        },
      ];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="brutal-meta">Coach Log</p>
        <h2 className="text-4xl font-black uppercase tracking-[-0.08em]">
          Chat
        </h2>
        <p className="text-sm uppercase tracking-[0.12em] text-muted-foreground">
          Coach console for pressure, excuses, and readouts. Same habit state as
          Home, but built for decisions in real time.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 p-4">
          <CoachContextRail
            snapshot={primarySnapshot}
            onLoadPrompt={setInput}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 border-2 border-black bg-secondary px-4 py-3 text-sm uppercase tracking-[0.12em] text-muted-foreground">
            <span className="max-w-xl">
              {budgetStatus?.isUnlimited
                ? "Pro tier: unlimited daily coach messages."
                : `Daily budget: ${budgetStatus?.dailyMessageCount ?? 0}/${budgetStatus?.dailyMessageCap ?? 20}`}
            </span>
            <span className="text-lg font-black text-foreground">
              {budgetStatus?.isUnlimited
                ? "Unlimited"
                : `${budgetStatus?.remainingMessages ?? 20} left`}
            </span>
          </div>

          {limitReached ? (
            <div className="brutal-alert flex flex-col gap-3 p-4 text-sm uppercase tracking-[0.12em]">
              <p className="text-white">
                You burned through today&apos;s free chat budget. Read-only
                still works. Upgrade if you want more messages right now.
              </p>
              <div>
                <Button
                  type="button"
                  disabled={billingPending !== null}
                  onClick={() => void onUpgrade()}
                >
                  {billingPending === "pro" ? "Updating..." : "Upgrade to Pro"}
                </Button>
              </div>
            </div>
          ) : null}

          {errorMessage ? (
            <div className="brutal-alert p-4 text-sm uppercase tracking-[0.12em]">
              {errorMessage}
            </div>
          ) : null}

          <div className="max-h-112 overflow-y-auto border-2 border-black bg-background px-4 pr-1">
            {sortedMessages.length === 0 ? (
              <div className="border-b border-dashed border-black py-4 text-sm uppercase tracking-[0.12em] text-muted-foreground">
                No messages yet. Start clean, explain the miss, or force a plan
                before today drifts.
              </div>
            ) : null}

            {sortedMessages.map((message) => (
              <div
                key={message._id}
                className="border-b border-dashed border-black py-4 text-sm"
              >
                <div className="mb-2 flex flex-wrap items-center justify-between gap-4 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                  <span
                    className={
                      message.role === "ai"
                        ? "border border-black bg-black px-1 py-0.5 text-white"
                        : "border border-black px-1 py-0.5 text-black"
                    }
                  >
                    {message.role === "ai" ? "Coach" : "You"}
                  </span>
                  <span>{formatMessageTime(message.timestamp)}</span>
                </div>
                <p className="leading-7 text-foreground">{message.content}</p>
              </div>
            ))}
            <div ref={messagesEndRef} aria-hidden="true" />
          </div>

          <div className="flex flex-wrap gap-2">
            {quickActions.map((action) => (
              <Button
                key={action.key}
                type="button"
                variant={action.variant}
                disabled={sending || limitReached}
                onClick={() => void action.onClick()}
              >
                {action.icon}
                {action.label}
              </Button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              className="min-h-24"
              disabled={limitReached}
              placeholder={
                limitReached
                  ? "Daily free chat cap reached. Upgrade or wait for reset."
                  : primarySnapshot?.state === "missed"
                    ? "Own what happened and reset the next rep..."
                    : primarySnapshot?.state === "deadline-risk"
                      ? "Send the update before this gets worse..."
                      : "Type a message to your coach..."
              }
            />
            <Button
              type="button"
              disabled={sending || !input.trim() || limitReached}
              onClick={() => onSend(input)}
            >
              {sending ? "Sending..." : "Send"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatsTab({
  habits,
  checkIns,
  workoutLogs,
  latestReport,
  referenceDate,
  onOpenDetail,
}: {
  habits: HabitDoc[];
  checkIns: CheckInDoc[];
  workoutLogs: WorkoutLogDoc[];
  latestReport: WeeklyReportDoc | null;
  referenceDate: Date;
  onOpenDetail: (habit: HabitDoc) => void;
}) {
  const weekDays = getWeekDays(referenceDate);
  const weekStart = weekDays[0]?.date ?? referenceDate;
  const weekEnd = weekDays[6]?.date ?? referenceDate;
  const weekStartTs = weekStart.getTime();
  const weekEndTs = new Date(weekEnd).setHours(23, 59, 59, 999);
  const weeklyCheckIns = checkIns.filter(
    (entry) => entry.timestamp >= weekStartTs && entry.timestamp <= weekEndTs,
  );
  const activeHabits = habits.filter((habit) => habit.isActive);
  const bestStreak = Math.max(
    0,
    ...activeHabits.map((habit) => habit.bestStreak),
  );

  function getRecentLogsForHabit(habitId: HabitDoc["_id"]) {
    return workoutLogs
      .filter((log) => log.habitId === habitId)
      .sort((left, right) => {
        const leftCheckIn = checkIns.find(
          (entry) => entry._id === left.checkInId,
        );
        const rightCheckIn = checkIns.find(
          (entry) => entry._id === right.checkInId,
        );
        return (rightCheckIn?.timestamp ?? 0) - (leftCheckIn?.timestamp ?? 0);
      })
      .slice(0, 3);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="brutal-meta">Readout</p>
        <h2 className="text-4xl font-black uppercase tracking-[-0.08em]">
          Stats
        </h2>
        <p className="text-sm uppercase tracking-[0.12em] text-muted-foreground">
          Read-only weekly performance and recent workout logs from your live
          data.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">This Week</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <div className="border-2 border-black bg-background p-4">
            <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
              Active habits
            </p>
            <p className="mt-2 text-3xl font-black">{activeHabits.length}</p>
          </div>
          <div className="border-2 border-black bg-background p-4">
            <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
              Completed
            </p>
            <p className="mt-2 text-3xl font-black">
              {
                weeklyCheckIns.filter((entry) => entry.status === "completed")
                  .length
              }
            </p>
          </div>
          <div className="border-2 border-black bg-background p-4">
            <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
              Missed
            </p>
            <p className="mt-2 text-3xl font-black">
              {
                weeklyCheckIns.filter((entry) => entry.status === "missed")
                  .length
              }
            </p>
          </div>
          <div className="border-2 border-black bg-background p-4">
            <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
              Bonus
            </p>
            <p className="mt-2 text-3xl font-black">
              {
                weeklyCheckIns.filter((entry) => entry.status === "bonus")
                  .length
              }
            </p>
          </div>
          <div className="border-2 border-black bg-background p-4">
            <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
              Best streak
            </p>
            <p className="mt-2 text-3xl font-black">{bestStreak}</p>
          </div>
        </CardContent>
      </Card>

      {latestReport ? (
        <Card className="bg-secondary">
          <CardHeader>
            <CardTitle className="text-2xl">Latest Weekly Review</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-black text-white">
                {habits.find((habit) => habit._id === latestReport.habitId)
                  ?.name ?? "Habit review"}
              </Badge>
              <Badge variant="outline">
                {formatWeekRange(latestReport.weekStart, latestReport.weekEnd)}
              </Badge>
              <Badge variant="outline">
                {latestReport.actualCount}/{latestReport.targetCount}
              </Badge>
              <Badge variant="outline">Bonus {latestReport.bonusCount}</Badge>
              <Badge variant="outline">
                {Math.round(latestReport.completionRate)}%
              </Badge>
            </div>
            <p className="text-sm leading-6 text-foreground">
              {latestReport.aiRoast}
            </p>
            {latestReport.missedDaysReasons.length > 0 ? (
              <div className="border-2 border-black bg-background p-4 text-sm uppercase tracking-[0.12em] text-muted-foreground">
                {latestReport.missedDaysReasons
                  .slice(0, 3)
                  .map((entry) => `${entry.day}: ${entry.reason}`)
                  .join(" | ")}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {habits.map((habit) => {
        const habitCheckIns = weeklyCheckIns.filter(
          (entry) => entry.habitId === habit._id,
        );
        const completedCount = habitCheckIns.filter(
          (entry) => entry.status === "completed",
        ).length;
        const targetCount = weekDays.filter((day) =>
          habit.targetDays.includes(day.key),
        ).length;
        const recentLogs = getRecentLogsForHabit(habit._id);

        return (
          <Card key={habit._id}>
            <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-2">
                <CardTitle className="text-3xl">{habit.name}</CardTitle>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">Streak {habit.currentStreak}</Badge>
                  <Badge variant="outline">Best {habit.bestStreak}</Badge>
                  <Badge className="bg-black text-white">
                    {completedCount}/{targetCount} this week
                  </Badge>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenDetail(habit)}
              >
                <PencilLine />
                Details
              </Button>
            </CardHeader>
            <CardContent className="space-y-6">
              <WeekGrid
                habit={habit}
                weekDays={weekDays}
                weeklyCheckIns={weeklyCheckIns}
                referenceDate={referenceDate}
              />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm uppercase tracking-[0.25em] text-muted-foreground">
                    Recent workouts
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Bonus workouts are included here.
                  </p>
                </div>
                {recentLogs.length === 0 ? (
                  <div className="border-2 border-dashed border-black bg-background p-4 text-sm uppercase tracking-[0.12em] text-muted-foreground">
                    No workout logs yet for this habit.
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {recentLogs.map((log) => {
                      const checkIn = checkIns.find(
                        (entry) => entry._id === log.checkInId,
                      );
                      return (
                        <div
                          key={log._id}
                          className="border-2 border-black bg-background p-4"
                        >
                          <div className="flex items-center justify-between gap-4">
                            <p className="text-sm font-black uppercase tracking-[0.18em]">
                              {checkIn
                                ? formatWorkoutDate(checkIn.timestamp)
                                : "Unknown date"}
                            </p>
                            {checkIn ? (
                              <Badge variant="outline">{checkIn.status}</Badge>
                            ) : null}
                          </div>
                          <p className="mt-2 text-sm text-foreground">
                            {formatExerciseSummary(log)}
                          </p>
                          {log.notes ? (
                            <p className="mt-2 text-sm text-muted-foreground">
                              {log.notes}
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function HabitDetailPanel({
  open,
  habit,
  allCheckIns,
  allWorkoutLogs,
  referenceDate,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  habit: HabitDoc | null;
  allCheckIns: CheckInDoc[];
  allWorkoutLogs: WorkoutLogDoc[];
  referenceDate: Date;
  saving: boolean;
  onClose: () => void;
  onSave: (habit: HabitDoc, form: HabitDetailFormState) => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<HabitDetailFormState | null>(() =>
    habit ? getHabitDetailInitialForm(habit) : null,
  );

  if (!open || !habit || !form) {
    return null;
  }

  const currentHabit = habit;
  const currentForm = form;

  const weekDays = getWeekDays(referenceDate);
  const weekStart = weekDays[0]?.date ?? referenceDate;
  const weekEnd = weekDays[6]?.date ?? referenceDate;
  const weekStartTs = weekStart.getTime();
  const weekEndTs = new Date(weekEnd).setHours(23, 59, 59, 999);
  const habitCheckIns = allCheckIns
    .filter((entry) => entry.habitId === habit._id)
    .sort((left, right) => right.timestamp - left.timestamp);
  const weeklyCheckIns = habitCheckIns.filter(
    (entry) => entry.timestamp >= weekStartTs && entry.timestamp <= weekEndTs,
  );
  const recentLogs = allWorkoutLogs
    .filter((log) => log.habitId === habit._id)
    .sort((left, right) => {
      const leftCheckIn = allCheckIns.find(
        (entry) => entry._id === left.checkInId,
      );
      const rightCheckIn = allCheckIns.find(
        (entry) => entry._id === right.checkInId,
      );
      return (rightCheckIn?.timestamp ?? 0) - (leftCheckIn?.timestamp ?? 0);
    })
    .slice(0, 5);
  const recentHistory = habitCheckIns.slice(0, 8);

  async function handleSave() {
    await onSave(currentHabit, currentForm);
    setIsEditing(false);
  }

  function updateForm<K extends keyof HabitDetailFormState>(
    key: K,
    value: HabitDetailFormState[K],
  ) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="absolute inset-0 bg-[rgba(26,24,20,0.82)]"
        onClick={onClose}
        aria-label="Close habit detail"
      />
      <aside className="absolute right-0 top-0 h-full w-full max-w-2xl overflow-y-auto border-l-2 border-black bg-card p-6 shadow-[-8px_0px_0px_0px_rgba(26,24,20,1)]">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-3">
            <p className="brutal-meta">Habit Detail</p>
            <h2 className="text-4xl font-black uppercase tracking-[-0.08em]">
              {habit.name}
            </h2>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">
                {habit.isActive ? "Active" : "Paused"}
              </Badge>
              <Badge variant="outline">Streak {habit.currentStreak}</Badge>
              <Badge variant="outline">Best {habit.bestStreak}</Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsEditing((current) => !current)}
            >
              <PencilLine />
              {isEditing ? "Cancel edit" : "Edit"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={onClose}
            >
              <X />
            </Button>
          </div>
        </div>

        <div className="mt-6 grid gap-6">
          {isEditing ? (
            <Card className="bg-background">
              <CardHeader>
                <CardTitle className="text-2xl">Edit Habit</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-5">
                <div className="grid gap-2">
                  <Label htmlFor="detail-name">Habit name</Label>
                  <Input
                    id="detail-name"
                    value={form.name}
                    onChange={(event) => updateForm("name", event.target.value)}
                  />
                </div>

                <div className="grid gap-3">
                  <Label>Target days</Label>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {DAYS.map((day) => {
                      const checked = form.targetDays.includes(day.key);
                      return (
                        <label
                          key={day.key}
                          className="flex items-center gap-3 border-2 border-black bg-card px-3 py-3 text-sm uppercase"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(value) =>
                              updateForm(
                                "targetDays",
                                value
                                  ? [...form.targetDays, day.key]
                                  : form.targetDays.filter(
                                      (entry) => entry !== day.key,
                                    ),
                              )
                            }
                          />
                          <span>{day.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="grid gap-2">
                    <Label htmlFor="detail-scheduled-time">Scheduled</Label>
                    <Input
                      id="detail-scheduled-time"
                      type="time"
                      value={form.scheduledTime}
                      onChange={(event) =>
                        updateForm("scheduledTime", event.target.value)
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="detail-reminder-time">Reminder</Label>
                    <Input
                      id="detail-reminder-time"
                      type="time"
                      value={form.reminderTime}
                      onChange={(event) =>
                        updateForm("reminderTime", event.target.value)
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="detail-deadline-time">Deadline</Label>
                    <Input
                      id="detail-deadline-time"
                      type="time"
                      value={form.checkInDeadline}
                      onChange={(event) =>
                        updateForm("checkInDeadline", event.target.value)
                      }
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="detail-rules">What counts?</Label>
                  <Input
                    id="detail-rules"
                    value={form.rules}
                    onChange={(event) =>
                      updateForm("rules", event.target.value)
                    }
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="detail-motivation">Motivation</Label>
                  <Textarea
                    id="detail-motivation"
                    className="min-h-24"
                    value={form.motivation}
                    onChange={(event) =>
                      updateForm("motivation", event.target.value)
                    }
                  />
                </div>

                <label className="flex items-center gap-3 border-2 border-black bg-card px-4 py-3 text-sm uppercase">
                  <Checkbox
                    checked={form.isActive}
                    onCheckedChange={(value) =>
                      updateForm("isActive", Boolean(value))
                    }
                  />
                  <span>{form.isActive ? "Habit active" : "Habit paused"}</span>
                </label>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-xl">Friday Override</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4">
                    <label className="flex items-center gap-3 border-2 border-black bg-background px-4 py-3 text-sm uppercase">
                      <Checkbox
                        checked={form.fridayOverrideEnabled}
                        onCheckedChange={(value) =>
                          updateForm("fridayOverrideEnabled", Boolean(value))
                        }
                      />
                      <span>
                        {form.fridayOverrideEnabled
                          ? "Custom Friday schedule enabled"
                          : "Use default Friday schedule"}
                      </span>
                    </label>

                    {form.fridayOverrideEnabled ? (
                      <div className="grid gap-4 sm:grid-cols-3">
                        <div className="grid gap-2">
                          <Label htmlFor="friday-scheduled-time">
                            Friday scheduled
                          </Label>
                          <Input
                            id="friday-scheduled-time"
                            type="time"
                            value={form.fridayScheduledTime}
                            onChange={(event) =>
                              updateForm(
                                "fridayScheduledTime",
                                event.target.value,
                              )
                            }
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="friday-reminder-time">
                            Friday reminder
                          </Label>
                          <Input
                            id="friday-reminder-time"
                            type="time"
                            value={form.fridayReminderTime}
                            onChange={(event) =>
                              updateForm(
                                "fridayReminderTime",
                                event.target.value,
                              )
                            }
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor="friday-deadline-time">
                            Friday deadline
                          </Label>
                          <Input
                            id="friday-deadline-time"
                            type="time"
                            value={form.fridayCheckInDeadline}
                            onChange={(event) =>
                              updateForm(
                                "fridayCheckInDeadline",
                                event.target.value,
                              )
                            }
                          />
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                <div className="flex justify-end">
                  <Button
                    type="button"
                    disabled={
                      saving ||
                      !form.name.trim() ||
                      form.targetDays.length === 0 ||
                      !form.rules.trim() ||
                      !form.motivation.trim()
                    }
                    onClick={() => void handleSave()}
                  >
                    {saving ? "Saving..." : "Save changes"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card className="bg-background">
            <CardHeader>
              <CardTitle className="text-2xl">Schedule</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <div className="border-2 border-black bg-card p-4">
                <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
                  Default scheduled
                </p>
                <p className="mt-2 text-2xl font-black">
                  {habit.scheduledTime}
                </p>
              </div>
              <div className="border-2 border-black bg-card p-4">
                <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
                  Default reminder
                </p>
                <p className="mt-2 text-2xl font-black">{habit.reminderTime}</p>
              </div>
              <div className="border-2 border-black bg-card p-4">
                <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
                  Default deadline
                </p>
                <p className="mt-2 text-2xl font-black">
                  {habit.checkInDeadline}
                </p>
              </div>
              <div className="sm:col-span-3 border-2 border-black bg-card p-4">
                <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
                  Target days
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {habit.targetDays.map((day) => (
                    <Badge key={`${habit._id}-detail-${day}`} variant="outline">
                      {toTitleDay(day)}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="sm:col-span-3 border-2 border-black bg-card p-4">
                <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
                  Friday override
                </p>
                {habit.schedules?.fri ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <p className="text-lg font-black">
                      {habit.schedules.fri.scheduledTime}
                    </p>
                    <p className="text-lg font-black">
                      {habit.schedules.fri.reminderTime}
                    </p>
                    <p className="text-lg font-black">
                      {habit.schedules.fri.checkInDeadline}
                    </p>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Friday uses the default schedule.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-background">
            <CardHeader>
              <CardTitle className="text-2xl">Rules and Motivation</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="border-2 border-black bg-card p-4">
                <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
                  Rules
                </p>
                <p className="mt-2 text-sm uppercase tracking-[0.12em] text-foreground">
                  {habit.rules}
                </p>
              </div>
              <div className="border-2 border-black bg-card p-4">
                <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
                  Motivation
                </p>
                <p className="mt-2 text-sm uppercase tracking-[0.12em] text-foreground">
                  {habit.motivation}
                </p>
              </div>
              {!habit.isActive ? (
                <div className="brutal-alert p-4 text-sm uppercase tracking-[0.12em]">
                  This habit is paused. History stays intact, but reminders and
                  active scheduling are off until you resume it.
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="bg-background">
            <CardHeader>
              <CardTitle className="text-2xl">This Week</CardTitle>
            </CardHeader>
            <CardContent>
              <WeekGrid
                habit={currentHabit}
                weekDays={weekDays}
                weeklyCheckIns={weeklyCheckIns}
                referenceDate={referenceDate}
              />
            </CardContent>
          </Card>

          <Card className="bg-background">
            <CardHeader>
              <CardTitle className="text-2xl">Recent History</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {recentHistory.length === 0 ? (
                <div className="border-2 border-dashed border-black bg-card p-4 text-sm uppercase tracking-[0.12em] text-muted-foreground">
                  No check-ins yet for this habit.
                </div>
              ) : (
                recentHistory.map((entry) => (
                  <div
                    key={entry._id}
                    className="border-2 border-black bg-card p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-black uppercase tracking-[0.18em]">
                        {entry.date}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">
                          {formatCheckInStatus(entry.status)}
                        </Badge>
                        <Badge variant="outline">{entry.source}</Badge>
                      </div>
                    </div>
                    {entry.userReason ? (
                      <p className="mt-3 text-sm uppercase tracking-[0.12em] text-muted-foreground">
                        Reason: {entry.userReason}
                      </p>
                    ) : null}
                    {entry.conversationSummary ? (
                      <p className="mt-2 text-sm uppercase tracking-[0.12em] text-muted-foreground">
                        {entry.conversationSummary}
                      </p>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="bg-background">
            <CardHeader>
              <CardTitle className="text-2xl">Recent Workout Logs</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {recentLogs.length === 0 ? (
                <div className="border-2 border-dashed border-black bg-card p-4 text-sm uppercase tracking-[0.12em] text-muted-foreground">
                  No workout logs yet for this habit.
                </div>
              ) : (
                recentLogs.map((log) => {
                  const checkIn = allCheckIns.find(
                    (entry) => entry._id === log.checkInId,
                  );
                  return (
                    <div
                      key={log._id}
                      className="border-2 border-black bg-card p-4"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-black uppercase tracking-[0.18em]">
                          {checkIn
                            ? formatWorkoutDate(checkIn.timestamp)
                            : "Unknown date"}
                        </p>
                        {checkIn ? (
                          <Badge variant="outline">
                            {formatCheckInStatus(checkIn.status)}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm uppercase tracking-[0.12em] text-foreground">
                        {formatExerciseSummary(log)}
                      </p>
                      {log.notes ? (
                        <p className="mt-2 text-sm uppercase tracking-[0.12em] text-muted-foreground">
                          {log.notes}
                        </p>
                      ) : null}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>
      </aside>
    </div>
  );
}

function ProfileTab({
  email,
  tier,
  budgetStatus,
  weeklyStats,
  habits,
  checkIns,
  billingPending,
  notificationPermission,
  notificationsEnabled,
  notificationPending,
  onEnableNotifications,
  onBillingChange,
  theme,
  onToggleTheme,
}: {
  email: string;
  tier: "free" | "pro";
  budgetStatus: {
    dailyMessageCount: number;
    dailyMessageCap: number | null;
    remainingMessages: number | null;
    limitReached: boolean;
    isUnlimited: boolean;
  } | null;
  weeklyStats: ReturnType<typeof getWeeklyStats>;
  habits: HabitDoc[];
  checkIns: CheckInDoc[];
  billingPending: "free" | "pro" | null;
  notificationPermission: NotificationPermissionState;
  notificationsEnabled: boolean;
  notificationPending: boolean;
  onEnableNotifications: () => Promise<void>;
  onBillingChange: (tier: "free" | "pro") => Promise<void>;
  theme: "light" | "dark";
  onToggleTheme: () => void;
}) {
  const bestStreak = Math.max(0, ...habits.map((habit) => habit.bestStreak));

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="brutal-meta">Account File</p>
        <h2 className="text-4xl font-black uppercase tracking-[-0.08em]">
          Profile
        </h2>
        <p className="text-sm uppercase tracking-[0.12em] text-muted-foreground">
          Account controls, plan state, and the current progress readout.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <div className="space-y-2">
              <CardTitle className="text-2xl">Account</CardTitle>
              <p className="text-sm uppercase tracking-[0.12em] text-muted-foreground">
                {email}
              </p>
            </div>
            <UserButton />
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <div className="flex items-center justify-between border-2 border-black bg-background px-4 py-3 uppercase tracking-[0.12em]">
              <span>Current tier</span>
              <Badge className="bg-black text-white">
                {tier.toUpperCase()}
              </Badge>
            </div>
            <div className="flex items-center justify-between border-2 border-black bg-background px-4 py-3 uppercase tracking-[0.12em]">
              <span>Daily messages used</span>
              <span className="font-black text-foreground">
                {budgetStatus?.isUnlimited
                  ? "Unlimited"
                  : `${budgetStatus?.dailyMessageCount ?? 0}/${budgetStatus?.dailyMessageCap ?? 20}`}
              </span>
            </div>
            <div className="flex items-center justify-between border-2 border-black bg-background px-4 py-3 uppercase tracking-[0.12em]">
              <span>Messages remaining</span>
              <span className="font-black text-foreground">
                {budgetStatus?.isUnlimited
                  ? "Unlimited"
                  : (budgetStatus?.remainingMessages ?? 20)}
              </span>
            </div>
            <div className="flex items-center justify-between border-2 border-black bg-background px-4 py-3 uppercase tracking-[0.12em]">
              <span>Reminder notifications</span>
              <span className="font-black text-foreground">
                {notificationPermission === "unsupported"
                  ? "Unsupported"
                  : notificationsEnabled
                    ? "Enabled"
                    : notificationPermission === "denied"
                      ? "Blocked"
                      : "Disabled"}
              </span>
            </div>
            <div className="flex items-center justify-between border-2 border-black bg-background px-4 py-3 uppercase tracking-[0.12em]">
              <span>Theme mode</span>
              <span className="font-black text-foreground">{theme}</span>
            </div>
            <Button type="button" variant="outline" onClick={onToggleTheme}>
              {theme === "dark" ? <SunMedium /> : <MonitorCog />}
              {theme === "dark" ? "Switch to Light" : "Switch to Dark"}
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={billingPending !== null}
                onClick={() => onBillingChange("pro")}
              >
                {billingPending === "pro" ? "Updating..." : "Upgrade to Pro"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={billingPending !== null}
                onClick={() => onBillingChange("free")}
              >
                {billingPending === "free" ? "Updating..." : "Downgrade"}
              </Button>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={
                notificationPending || notificationPermission === "unsupported"
              }
              onClick={() => void onEnableNotifications()}
            >
              {notificationPending
                ? "Enabling..."
                : notificationsEnabled
                  ? "Notifications Enabled"
                  : notificationPermission === "denied"
                    ? "Notifications Blocked"
                    : "Enable Reminders"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Stats Readout</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="border-2 border-black bg-background p-4">
              <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
                Active habits
              </p>
              <p className="mt-2 text-3xl font-black">
                {habits.filter((habit) => habit.isActive).length}
              </p>
            </div>
            <div className="border-2 border-black bg-background p-4">
              <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
                Best streak
              </p>
              <p className="mt-2 text-3xl font-black">{bestStreak}</p>
            </div>
            <div className="border-2 border-black bg-background p-4">
              <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
                Week completed
              </p>
              <p className="mt-2 text-3xl font-black">
                {weeklyStats.completed}
              </p>
            </div>
            <div className="border-2 border-black bg-background p-4">
              <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
                Week missed
              </p>
              <p className="mt-2 text-3xl font-black">{weeklyStats.missed}</p>
            </div>
            <div className="border-2 border-black bg-background p-4">
              <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
                Bonus sessions
              </p>
              <p className="mt-2 text-3xl font-black">{weeklyStats.bonus}</p>
            </div>
            <div className="border-2 border-black bg-background p-4">
              <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">
                Total logs
              </p>
              <p className="mt-2 text-3xl font-black">{checkIns.length}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function DashboardShell() {
  const { user, isLoaded } = useUser();
  const { theme, toggleTheme } = useTheme();
  const searchParams = useSearchParams();
  const syncAttempted = useRef(false);
  const seededWelcome = useRef(false);
  const pushSyncAttempted = useRef(false);
  const [now, setNow] = useState(() => new Date());
  const [activeTab, setActiveTab] = useState<AppTab>("home");
  const [pendingHabitId, setPendingHabitId] = useState<string | null>(null);
  const [billingPending, setBillingPending] = useState<"free" | "pro" | null>(
    null,
  );
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [notificationPermission, setNotificationPermission] =
    useState<NotificationPermissionState>(
      typeof window === "undefined"
        ? "unsupported"
        : "Notification" in window
          ? window.Notification.permission
          : "unsupported",
    );
  const [notificationPending, setNotificationPending] = useState(false);
  const [lastSeenReminderTimestamp, setLastSeenReminderTimestamp] = useState(0);
  const [selectedHabitId, setSelectedHabitId] = useState<string | null>(null);
  const [detailSaving, setDetailSaving] = useState(false);
  const [chatErrorMessage, setChatErrorMessage] = useState<string | null>(null);

  const syncUser = useMutation(api.users.syncUser);
  const updateProfile = useMutation(api.users.updateProfile);
  const refreshDailyMessageBudget = useMutation(
    api.users.refreshDailyMessageBudget,
  );
  const createHabit = useMutation(api.habits.create);
  const updateHabit = useMutation(api.habits.update);
  const deleteHabit = useMutation(api.habits.remove);
  const createCheckIn = useMutation(api.checkIns.create);
  const createMessage = useMutation(api.messages.create);
  const sendChatMessage = useAction(api.chatAction.sendMessage);
  const subscribeToNotifications = useMutation(api.notifications.subscribe);

  const convexUser = useQuery(api.users.getCurrent, {});
  const notificationStatus = useQuery(
    api.notifications.getCurrentStatus,
    convexUser ? {} : "skip",
  );
  const messageBudgetStatus = useQuery(
    api.users.getMessageBudgetStatus,
    convexUser ? {} : "skip",
  );
  const todayKey = getTodayKey(now);
  const todayDate = toDateKey(now);
  const clerkTier = getClerkSubscriptionTier(user?.publicMetadata);
  const currentTimezone =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : undefined;
  const publicVapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  const habits = useQuery(
    api.habits.listByUser,
    convexUser ? { userId: convexUser._id, includeInactive: true } : "skip",
  );
  const todayCheckIns = useQuery(
    api.checkIns.listByUserDate,
    convexUser ? { userId: convexUser._id, date: todayDate } : "skip",
  );
  const allCheckIns = useQuery(
    api.checkIns.listByUser,
    convexUser ? { userId: convexUser._id } : "skip",
  );
  const workoutLogs = useQuery(
    api.workoutLogs.listByUser,
    convexUser ? { userId: convexUser._id } : "skip",
  );
  const weeklyReports = useQuery(
    api.weeklyReports.latestByUser,
    convexUser ? { userId: convexUser._id } : "skip",
  );
  const messages = useQuery(
    api.messages.listByUser,
    convexUser ? { userId: convexUser._id } : "skip",
  );

  const registerReminderWorker = useCallback(async () => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      throw new Error("Service workers are not supported");
    }

    return await navigator.serviceWorker.register("/reminder-sw.js");
  }, []);

  const syncBrowserSubscription = useCallback(async () => {
    if (
      !publicVapidKey ||
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !convexUser
    ) {
      return false;
    }

    const registration = await registerReminderWorker();
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicVapidKey),
      });
    }

    const serialized = subscription.toJSON();
    if (
      !serialized.endpoint ||
      !serialized.keys?.auth ||
      !serialized.keys?.p256dh
    ) {
      throw new Error("Push subscription is missing required keys");
    }

    await subscribeToNotifications({
      endpoint: serialized.endpoint,
      expirationTime: serialized.expirationTime ?? undefined,
      keys: {
        auth: serialized.keys.auth,
        p256dh: serialized.keys.p256dh,
      },
    });

    return true;
  }, [
    convexUser,
    publicVapidKey,
    registerReminderWorker,
    subscribeToNotifications,
  ]);

  useEffect(() => {
    if (
      !isLoaded ||
      !user ||
      convexUser !== null ||
      syncAttempted.current ||
      !user.primaryEmailAddress?.emailAddress
    ) {
      return;
    }

    syncAttempted.current = true;
    void syncUser({
      clerkId: user.id,
      email: user.primaryEmailAddress.emailAddress,
      firstName: user.firstName ?? undefined,
      lastName: user.lastName ?? undefined,
      timezone: currentTimezone,
      subscriptionTier: clerkTier,
      aiPersonality: ONBOARDING_PERSONALITY,
    }).catch(() => {
      syncAttempted.current = false;
    });
  }, [clerkTier, convexUser, currentTimezone, isLoaded, syncUser, user]);

  useEffect(() => {
    if (
      !isLoaded ||
      !user ||
      !convexUser ||
      !user.primaryEmailAddress?.emailAddress ||
      (convexUser.subscriptionTier === clerkTier &&
        convexUser.timezone === currentTimezone)
    ) {
      return;
    }

    void syncUser({
      clerkId: user.id,
      email: user.primaryEmailAddress.emailAddress,
      firstName: user.firstName ?? undefined,
      lastName: user.lastName ?? undefined,
      timezone: currentTimezone,
      subscriptionTier: clerkTier,
      aiPersonality: ONBOARDING_PERSONALITY,
    });
  }, [clerkTier, convexUser, currentTimezone, isLoaded, syncUser, user]);

  useEffect(() => {
    if (
      !convexUser ||
      !messages ||
      messages.length > 0 ||
      !convexUser.onboardingCompleted ||
      seededWelcome.current
    ) {
      return;
    }

    seededWelcome.current = true;
    const upcoming = habits?.find((habit) =>
      habit.targetDays.includes(todayKey),
    );
    void createMessage({
      userId: convexUser._id,
      habitId: upcoming?._id,
      role: "ai",
      content: upcoming
        ? `Morning. ${upcoming.name} is scheduled for ${upcoming.scheduledTime}. I'll be here when you either do it or dodge it.`
        : "No target habit is scheduled today. Use the day well anyway.",
      intent: "check_in",
    });
  }, [convexUser, createMessage, habits, messages, todayKey]);

  useEffect(() => {
    const requestedTab = searchParams.get("tab");
    if (
      requestedTab === "home" ||
      requestedTab === "chat" ||
      requestedTab === "stats" ||
      requestedTab === "profile"
    ) {
      setActiveTab(requestedTab);
    }
  }, [searchParams]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }

    setNotificationPermission(window.Notification.permission);
  }, []);

  useEffect(() => {
    if (
      !convexUser ||
      notificationPermission !== "granted" ||
      !publicVapidKey ||
      pushSyncAttempted.current
    ) {
      return;
    }

    pushSyncAttempted.current = true;
    void syncBrowserSubscription().catch(() => {
      pushSyncAttempted.current = false;
    });
  }, [
    convexUser,
    notificationPermission,
    publicVapidKey,
    syncBrowserSubscription,
  ]);

  useEffect(() => {
    if (!convexUser || typeof window === "undefined") {
      return;
    }

    const stored = window.localStorage.getItem(
      getReminderSeenKey(convexUser._id),
    );
    setLastSeenReminderTimestamp(stored ? Number(stored) || 0 : 0);
  }, [convexUser]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let intervalId: number | null = null;
    let timeoutId: number | null = null;

    const syncNow = () => {
      setNow(new Date());
    };

    const startMinuteTicker = () => {
      syncNow();

      const msUntilNextMinute = 60000 - (Date.now() % 60000);
      timeoutId = window.setTimeout(() => {
        syncNow();
        intervalId = window.setInterval(syncNow, 60000);
      }, msUntilNextMinute);
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        syncNow();
      }
    };

    const handleWindowFocus = () => {
      syncNow();
    };

    startMinuteTicker();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, []);

  useEffect(() => {
    if (!convexUser) {
      return;
    }

    void refreshDailyMessageBudget().catch(() => undefined);
  }, [convexUser, refreshDailyMessageBudget]);

  const resolvedHabits = useMemo(() => habits ?? [], [habits]);
  const resolvedTodayCheckIns = useMemo(
    () => todayCheckIns ?? [],
    [todayCheckIns],
  );
  const resolvedAllCheckIns = useMemo(() => allCheckIns ?? [], [allCheckIns]);
  const resolvedWorkoutLogs = useMemo(() => workoutLogs ?? [], [workoutLogs]);
  const resolvedWeeklyReports = useMemo(
    () => weeklyReports ?? [],
    [weeklyReports],
  );
  const resolvedMessages = useMemo(() => messages ?? [], [messages]);
  const resolvedMessageBudgetStatus = messageBudgetStatus ?? null;
  const latestWeeklyReport = resolvedWeeklyReports[0] ?? null;
  const selectedHabit =
    resolvedHabits.find((habit) => habit._id === selectedHabitId) ?? null;
  const reminderMessages = resolvedMessages.filter(
    (message) => message.role === "ai" && isReminderIntent(message.intent),
  );
  const latestReminderTimestamp =
    reminderMessages.length > 0
      ? Math.max(...reminderMessages.map((message) => message.timestamp))
      : 0;
  const hasUnreadReminder = latestReminderTimestamp > lastSeenReminderTimestamp;
  const notificationsEnabled =
    notificationPermission === "granted" &&
    (notificationStatus?.subscriptionCount ?? 0) > 0;
  const { scheduledToday, completedToday } = getCompletionSummary(
    resolvedTodayCheckIns,
    resolvedHabits,
    todayKey,
  );
  const habitSnapshots = useMemo(
    () =>
      resolvedHabits.map((habit) =>
        getHabitPressureSnapshot(
          habit,
          todayKey,
          todayDate,
          resolvedTodayCheckIns,
          now,
        ),
      ),
    [now, resolvedHabits, resolvedTodayCheckIns, todayDate, todayKey],
  );
  const primaryHabitSnapshot =
    [...habitSnapshots]
      .filter((snapshot) => snapshot.isPrimaryCandidate)
      .sort(rankHabitSnapshots)[0] ?? null;
  const weeklyStats = getWeeklyStats(resolvedAllCheckIns);
  const freeTierLimitReached =
    convexUser?.subscriptionTier !== "pro" && resolvedHabits.length >= 3;

  useEffect(() => {
    if (
      activeTab !== "chat" ||
      !convexUser ||
      latestReminderTimestamp === 0 ||
      typeof window === "undefined"
    ) {
      return;
    }

    window.localStorage.setItem(
      getReminderSeenKey(convexUser._id),
      String(latestReminderTimestamp),
    );
    setLastSeenReminderTimestamp(latestReminderTimestamp);
  }, [activeTab, convexUser, latestReminderTimestamp]);

  useEffect(() => {
    if (!selectedHabitId) {
      return;
    }

    const stillExists = resolvedHabits.some(
      (habit) => habit._id === selectedHabitId,
    );
    if (!stillExists) {
      setSelectedHabitId(null);
    }
  }, [resolvedHabits, selectedHabitId]);

  async function createHabitFromForm(form: HabitFormState) {
    if (!convexUser) return;

    await createHabit({
      userId: convexUser._id,
      name: form.name.trim(),
      targetDays: form.targetDays,
      scheduledTime: form.scheduledTime,
      reminderTime: form.reminderTime,
      checkInDeadline: form.checkInDeadline,
      rules: form.rules.trim(),
      motivation: form.motivation.trim(),
    });
  }

  async function completeOnboarding(form: HabitFormState) {
    if (!convexUser) return;

    const habitId = await createHabit({
      userId: convexUser._id,
      name: form.name.trim(),
      targetDays: form.targetDays,
      scheduledTime: form.scheduledTime,
      reminderTime: form.reminderTime,
      checkInDeadline: form.checkInDeadline,
      rules: form.rules.trim(),
      motivation: form.motivation.trim(),
    });

    await updateProfile({
      userId: convexUser._id,
      aiPersonality: ONBOARDING_PERSONALITY,
      onboardingCompleted: true,
    });

    await createMessage({
      userId: convexUser._id,
      habitId,
      role: "ai",
      content: `Locked in. ${form.name} is live now. Your reminder is ${form.reminderTime} and your deadline is ${form.checkInDeadline}. Don't make me repeat myself.`,
      intent: "check_in",
    });
  }

  async function logCheckInStatus(
    habit: HabitDoc | undefined,
    status: "completed" | "missed" | "bonus",
    source: "dashboard_quick" | "chat",
  ) {
    if (!convexUser || !habit) return;

    const existing = resolvedTodayCheckIns.find(
      (entry) => entry.habitId === habit._id,
    );
    if (existing) return;

    setPendingHabitId(habit._id);
    try {
      const aiResponse =
        status === "completed"
          ? `Logged ${habit.name}. Good. Now do it again on the next scheduled day.`
          : `Miss recorded for ${habit.name}. That's on you, not the calendar.`;

      await createCheckIn({
        habitId: habit._id,
        userId: convexUser._id,
        date: todayDate,
        status,
        source,
        aiResponse,
      });

      await updateHabit({
        id: habit._id,
        currentStreak: status === "completed" ? habit.currentStreak + 1 : 0,
        bestStreak:
          status === "completed"
            ? Math.max(habit.bestStreak, habit.currentStreak + 1)
            : habit.bestStreak,
      });
    } finally {
      setPendingHabitId(null);
    }
  }

  async function handleMarkComplete(habit: HabitDoc) {
    await logCheckInStatus(habit, "completed", "dashboard_quick");
  }

  async function handleLogMiss(habit: HabitDoc) {
    await logCheckInStatus(habit, "missed", "dashboard_quick");
  }

  async function handleToggleActive(habit: HabitDoc) {
    setPendingHabitId(habit._id);
    try {
      await updateHabit({ id: habit._id, isActive: !habit.isActive });
    } finally {
      setPendingHabitId(null);
    }
  }

  async function handleDeleteHabit(habit: HabitDoc) {
    setPendingHabitId(habit._id);
    try {
      await deleteHabit({ id: habit._id });
      if (selectedHabitId === habit._id) {
        setSelectedHabitId(null);
      }
    } finally {
      setPendingHabitId(null);
    }
  }

  async function handleSaveHabitDetail(
    habit: HabitDoc,
    form: HabitDetailFormState,
  ) {
    setDetailSaving(true);
    try {
      await updateHabit({
        id: habit._id,
        name: form.name.trim(),
        targetDays: form.targetDays,
        scheduledTime: form.scheduledTime,
        reminderTime: form.reminderTime,
        checkInDeadline: form.checkInDeadline,
        rules: form.rules.trim(),
        motivation: form.motivation.trim(),
        isActive: form.isActive,
        schedules: form.fridayOverrideEnabled
          ? {
              fri: {
                scheduledTime: form.fridayScheduledTime,
                reminderTime: form.fridayReminderTime,
                checkInDeadline: form.fridayCheckInDeadline,
              },
            }
          : {},
      });
    } finally {
      setDetailSaving(false);
    }
  }

  async function handleSendMessage(rawContent: string) {
    if (!convexUser) return;

    const content = rawContent.trim();
    if (!content) return;

    setChatSending(true);
    try {
      setChatErrorMessage(null);
      await sendChatMessage({
        content,
        source: "chat_input",
      });

      setChatInput("");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to send message right now.";
      if (message.includes("FREE_DAILY_MESSAGE_LIMIT_REACHED")) {
        setChatErrorMessage(
          "Daily free chat cap reached. Upgrade to Pro or wait for your local midnight reset.",
        );
        await refreshDailyMessageBudget().catch(() => undefined);
        return;
      }
      setChatErrorMessage("Unable to send message right now.");
    } finally {
      setChatSending(false);
    }
  }

  async function handleQuickComplete() {
    if (!convexUser) return;

    setChatSending(true);
    try {
      setChatErrorMessage(null);
      await sendChatMessage({
        content: "Yeah, I finished today's session.",
        source: "quick_complete",
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to send message right now.";
      if (message.includes("FREE_DAILY_MESSAGE_LIMIT_REACHED")) {
        setChatErrorMessage(
          "Daily free chat cap reached. Upgrade to Pro or wait for your local midnight reset.",
        );
        await refreshDailyMessageBudget().catch(() => undefined);
        return;
      }
      setChatErrorMessage("Unable to send message right now.");
    } finally {
      setChatSending(false);
    }
  }

  async function handleQuickMiss() {
    if (!convexUser) return;

    setChatSending(true);
    try {
      setChatErrorMessage(null);
      await sendChatMessage({
        content: "I skipped today.",
        source: "quick_miss",
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to send message right now.";
      if (message.includes("FREE_DAILY_MESSAGE_LIMIT_REACHED")) {
        setChatErrorMessage(
          "Daily free chat cap reached. Upgrade to Pro or wait for your local midnight reset.",
        );
        await refreshDailyMessageBudget().catch(() => undefined);
        return;
      }
      setChatErrorMessage("Unable to send message right now.");
    } finally {
      setChatSending(false);
    }
  }

  async function handleEnableNotifications() {
    if (
      typeof window === "undefined" ||
      !("Notification" in window) ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      setNotificationPermission("unsupported");
      return;
    }

    setNotificationPending(true);
    try {
      const permission =
        window.Notification.permission === "granted"
          ? "granted"
          : await window.Notification.requestPermission();

      setNotificationPermission(permission);
      if (permission !== "granted") {
        return;
      }

      await syncBrowserSubscription();
    } finally {
      setNotificationPending(false);
    }
  }

  async function handleBillingChange(nextTier: "free" | "pro") {
    setBillingPending(nextTier);
    try {
      const endpoint =
        nextTier === "pro" ? "/api/billing/upgrade" : "/api/billing/downgrade";

      const response = await fetch(endpoint, { method: "POST" });
      if (!response.ok) {
        throw new Error("Billing update failed");
      }

      await user?.reload();
      await refreshDailyMessageBudget().catch(() => undefined);
    } finally {
      setBillingPending(null);
    }
  }

  if (!isLoaded || convexUser === undefined || habits === undefined) {
    return (
      <main className="min-h-screen bg-background px-6 py-10 text-foreground">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-center border-2 border-black bg-card p-10 shadow-[8px_8px_0px_0px_rgba(26,24,20,1)]">
          <p className="text-sm uppercase tracking-[0.3em] text-muted-foreground">
            Loading dashboard
          </p>
        </div>
      </main>
    );
  }

  if (!convexUser) {
    return (
      <main className="min-h-screen bg-background px-6 py-10 text-foreground">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-center border-2 border-black bg-card p-10 shadow-[8px_8px_0px_0px_rgba(26,24,20,1)]">
          <p className="text-sm uppercase tracking-[0.3em] text-muted-foreground">
            Syncing your account
          </p>
        </div>
      </main>
    );
  }

  if (!convexUser.onboardingCompleted || resolvedHabits.length === 0) {
    return (
      <OnboardingFlow
        userName={convexUser.firstName ?? user?.firstName ?? "you"}
        onComplete={completeOnboarding}
      />
    );
  }

  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-28">
        <section className="border-2 border-black bg-card p-6 shadow-[8px_8px_0px_0px_rgba(26,24,20,1)] sm:p-8">
          <SummaryStatusCard
            snapshot={primaryHabitSnapshot}
            scheduledToday={scheduledToday}
            completedToday={completedToday}
            subscriptionTier={convexUser.subscriptionTier}
            currentTime={now}
            onPrimaryAction={() => setActiveTab("chat")}
          />
        </section>

        {activeTab === "home" ? (
          <HomeTab
            snapshots={habitSnapshots}
            primarySnapshot={primaryHabitSnapshot}
            pendingHabitId={pendingHabitId}
            onOpenChat={() => setActiveTab("chat")}
            onMarkComplete={handleMarkComplete}
            onLogMiss={handleLogMiss}
            onToggleActive={handleToggleActive}
            onDeleteHabit={handleDeleteHabit}
            onOpenDetail={(habit) => setSelectedHabitId(habit._id)}
            canAddHabit={!freeTierLimitReached}
            onCreateHabit={createHabitFromForm}
          />
        ) : null}

        {activeTab === "chat" ? (
          <ChatTab
            messages={resolvedMessages}
            primarySnapshot={primaryHabitSnapshot}
            budgetStatus={resolvedMessageBudgetStatus}
            billingPending={billingPending}
            errorMessage={chatErrorMessage}
            input={chatInput}
            setInput={setChatInput}
            sending={chatSending}
            onSend={handleSendMessage}
            onQuickComplete={handleQuickComplete}
            onQuickMiss={handleQuickMiss}
            onUpgrade={() => handleBillingChange("pro")}
          />
        ) : null}

        {activeTab === "stats" ? (
          <StatsTab
            habits={resolvedHabits}
            checkIns={resolvedAllCheckIns}
            workoutLogs={resolvedWorkoutLogs}
            latestReport={latestWeeklyReport}
            referenceDate={now}
            onOpenDetail={(habit) => setSelectedHabitId(habit._id)}
          />
        ) : null}

        {activeTab === "profile" ? (
          <ProfileTab
            email={convexUser.email}
            tier={convexUser.subscriptionTier}
            budgetStatus={resolvedMessageBudgetStatus}
            weeklyStats={weeklyStats}
            habits={resolvedHabits}
            checkIns={resolvedAllCheckIns}
            billingPending={billingPending}
            notificationPermission={notificationPermission}
            notificationsEnabled={notificationsEnabled}
            notificationPending={notificationPending}
            onEnableNotifications={handleEnableNotifications}
            onBillingChange={handleBillingChange}
            theme={theme}
            onToggleTheme={toggleTheme}
          />
        ) : null}
      </div>

      <HabitDetailPanel
        key={selectedHabit?._id ?? "no-habit"}
        open={Boolean(selectedHabit)}
        habit={selectedHabit}
        allCheckIns={resolvedAllCheckIns}
        allWorkoutLogs={resolvedWorkoutLogs}
        referenceDate={now}
        saving={detailSaving}
        onClose={() => setSelectedHabitId(null)}
        onSave={handleSaveHabitDetail}
      />

      <nav className="fixed inset-x-0 bottom-0 bg-transparent px-4 py-4">
        <AnimatedDock
          className="max-w-4xl"
          items={[
            {
              Icon: <CalendarDays className="size-5" />,
              label: "Home",
              active: activeTab === "home",
              onClick: () => setActiveTab("home"),
            },
            {
              Icon: <MessageSquare className="size-5" />,
              label: "Chat",
              active: activeTab === "chat",
              badge: hasUnreadReminder,
              onClick: () => setActiveTab("chat"),
            },
            {
              Icon: <ChartNoAxesColumn className="size-5" />,
              label: "Stats",
              active: activeTab === "stats",
              onClick: () => setActiveTab("stats"),
            },
            {
              Icon: <UserCircle2 className="size-5" />,
              label: "Profile",
              active: activeTab === "profile",
              onClick: () => setActiveTab("profile"),
            },
          ]}
        />
      </nav>
    </main>
  );
}
