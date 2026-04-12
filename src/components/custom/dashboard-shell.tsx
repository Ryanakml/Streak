"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { UserButton, useUser } from "@clerk/nextjs";
import { useAction, useMutation, useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import type { Doc } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import {
  CalendarDays,
  ChartNoAxesColumn,
  Check,
  Ellipsis,
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
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
const IS_DEV_MODE = process.env.NODE_ENV !== "production";

type AppTab = "home" | "chat" | "stats" | "profile";
type StatsRangePreset = "30d" | "90d" | "365d" | "all";
type HabitDoc = Doc<"habits">;
type AgentTaskDoc = Doc<"agentTasks">;
type CheckInDoc = Doc<"checkIns">;
type HabitSkipDoc = Doc<"habitSkips">;
type MessageDoc = Doc<"messages">;
type ReminderDoc = Doc<"reminders">;
type ReminderRunDoc = Doc<"reminderRuns">;
type WorkoutLogDoc = Doc<"workoutLogs">;
type WeeklyReportDoc = Doc<"weeklyReports">;
type NotificationPermissionState = NotificationPermission | "unsupported";
type WeekCellState =
  | "completed"
  | "missed"
  | "bonus"
  | "rest"
  | "scheduled"
  | "skipped"
  | "rescheduled";
type WeekCellMetadata = {
  state: WeekCellState;
  label: string;
  title: string;
  isTargetDay: boolean;
};
type PressureState =
  | "rest"
  | "upcoming"
  | "due-soon"
  | "deadline-risk"
  | "logged"
  | "missed";
type HighlightAlertCard =
  | {
      kind: "habit";
      id: string;
      priority: number;
      label: string;
      title: string;
      support: string;
      meta: string[];
      actionLabel: string;
      toneClassName: string;
      toneTextClassName: string;
      badgeClassName: string;
      countLabel: string;
      snapshot: HabitPressureSnapshot;
    }
  | {
      kind: "task";
      id: string;
      priority: number;
      label: string;
      title: string;
      support: string;
      meta: string[];
      actionLabel: string;
      toneClassName: string;
      toneTextClassName: string;
      badgeClassName: string;
      countLabel: string;
      task: AgentTaskDoc;
    };

type HabitFormState = {
  name: string;
  targetDays: string[];
  scheduledTime: string;
  reminderTime: string;
  checkInDeadline: string;
  rules: string;
  motivation: string;
};

type TaskFormState = {
  title: string;
  date: string;
  time: string;
  reminderOffsetMinutes: string;
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

const initialTaskForm: TaskFormState = {
  title: "",
  date: "",
  time: "09:00",
  reminderOffsetMinutes: "30",
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
function formatClockFromHourMinute(time: string) {
  const [hoursRaw, minutesRaw] = time.split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return time;
  }

  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return formatTime(date);
}

function formatHourMinuteKey(timestamp: number) {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < breakpoint);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [breakpoint]);

  return isMobile;
}

function getScheduledTimeForDay(habit: HabitDoc, dayKey: string) {
  if (dayKey === "fri" && habit.schedules?.fri?.scheduledTime) {
    return habit.schedules.fri.scheduledTime;
  }

  return habit.scheduledTime;
}

function timeToMinutes(value: string) {
  const [hoursRaw, minutesRaw] = value.split(":");
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return 0;
  }

  return hours * 60 + minutes;
}

function minutesToTime(value: number) {
  const normalized = ((value % 1440) + 1440) % 1440;
  const hours = String(Math.floor(normalized / 60)).padStart(2, "0");
  const minutes = String(normalized % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function getBaseScheduleForDay(habit: HabitDoc, dayKey: string) {
  if (dayKey === "fri" && habit.schedules?.fri) {
    return {
      scheduledTime: habit.schedules.fri.scheduledTime,
      reminderTime: habit.schedules.fri.reminderTime,
      checkInDeadline: habit.schedules.fri.checkInDeadline,
    };
  }

  return {
    scheduledTime: habit.scheduledTime,
    reminderTime: habit.reminderTime,
    checkInDeadline: habit.checkInDeadline,
  };
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

function getEffectiveHabitScheduleForDate(args: {
  habit: HabitDoc;
  dayKey: string;
  dateKey: string;
  reminders: ReminderDoc[];
}) {
  const baseSchedule = getBaseScheduleForDay(args.habit, args.dayKey);
  const latestCheckInReminder = args.reminders
    .filter(
      (entry) =>
        entry.habitId === args.habit._id &&
        entry.date === args.dateKey &&
        entry.type === "check_in",
    )
    .sort((left, right) => right.scheduledFor - left.scheduledFor)[0];

  if (!latestCheckInReminder) {
    return {
      ...baseSchedule,
      isRescheduled: false,
    };
  }

  const nextScheduledTime = formatHourMinuteKey(
    latestCheckInReminder.scheduledFor,
  );
  if (nextScheduledTime === baseSchedule.scheduledTime) {
    return {
      ...baseSchedule,
      isRescheduled: false,
    };
  }

  return {
    ...shiftScheduleTimes({
      scheduledTime: baseSchedule.scheduledTime,
      reminderTime: baseSchedule.reminderTime,
      checkInDeadline: baseSchedule.checkInDeadline,
      nextScheduledTime,
    }),
    isRescheduled: true,
  };
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
    intent === "reminder_late_follow_up" ||
    intent === "task_reminder"
  );
}

function getTaskDueAt(task: AgentTaskDoc) {
  if (!task.time) {
    return null;
  }

  return new Date(`${task.date}T${task.time}:00`);
}

function isTaskOverdue(task: AgentTaskDoc, currentTime: Date) {
  const dueAt = getTaskDueAt(task);
  if (dueAt) {
    return dueAt.getTime() <= currentTime.getTime();
  }

  return task.date < toDateKey(currentTime);
}

function shouldKeepDoneTaskVisible(task: AgentTaskDoc, currentTime: Date) {
  if (task.status !== "done" || !task.doneAt) {
    return false;
  }

  return currentTime.getTime() - task.doneAt < 60 * 60 * 1000;
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

function getStatsRangeStartTimestamp(
  preset: StatsRangePreset,
  referenceDate: Date,
) {
  if (preset === "all") {
    return null;
  }

  const days = preset === "30d" ? 30 : preset === "90d" ? 90 : 365;
  const start = new Date(referenceDate);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return start.getTime();
}

function formatStatsRangeLabel(preset: StatsRangePreset) {
  if (preset === "all") {
    return "All time";
  }
  if (preset === "30d") {
    return "Last 30 days";
  }
  if (preset === "90d") {
    return "Last 90 days";
  }
  return "Last 365 days";
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
  weeklySkips: HabitSkipDoc[],
  weeklyReminderRuns: ReminderRunDoc[],
  weeklyReminders: ReminderDoc[],
): WeekCellMetadata {
  const checkIn = weeklyCheckIns.find(
    (entry) => entry.habitId === habit._id && entry.date === day.dateKey,
  );
  const skip = weeklySkips.find(
    (entry) => entry.habitId === habit._id && entry.date === day.dateKey,
  );
  const reminderRun = weeklyReminderRuns.find(
    (entry) => entry.habitId === habit._id && entry.date === day.dateKey,
  );
  const isTargetDay = habit.isActive && habit.targetDays.includes(day.key);
  const dateLabel = formatWorkoutDate(day.date.getTime());
  const defaultScheduledTime = getScheduledTimeForDay(habit, day.key);
  const defaultScheduledLabel = formatClockFromHourMinute(defaultScheduledTime);
  const latestCheckInReminder = weeklyReminders
    .filter(
      (entry) =>
        entry.habitId === habit._id &&
        entry.date === day.dateKey &&
        entry.type === "check_in",
    )
    .sort((left, right) => right.scheduledFor - left.scheduledFor)[0];
  const latestScheduledLabel = latestCheckInReminder
    ? formatFullTime(latestCheckInReminder.scheduledFor)
    : defaultScheduledLabel;
  const latestScheduledKey = latestCheckInReminder
    ? formatHourMinuteKey(latestCheckInReminder.scheduledFor)
    : defaultScheduledTime;
  const hasRescheduledTime = latestScheduledKey !== defaultScheduledTime;
  const scheduleTooltipDetails = `Default: ${defaultScheduledLabel}\nLatest: ${latestScheduledLabel}`;

  if (checkIn) {
    return {
      state: checkIn.status,
      label:
        checkIn.status === "completed"
          ? "Handled"
          : checkIn.status === "missed"
            ? "Missed"
            : "Bonus",
      title:
        checkIn.status === "completed"
          ? `${dateLabel}: Handled`
          : checkIn.status === "missed"
            ? `${dateLabel}: Missed`
            : `${dateLabel}: Bonus`,
      isTargetDay,
    };
  }

  if (skip || reminderRun?.state === "skipped") {
    return {
      state: "skipped",
      label: "Skipped",
      title: `${dateLabel}: Skipped`,
      isTargetDay,
    };
  }

  if (reminderRun?.state === "rescheduled") {
    return {
      state: "rescheduled",
      label: "Rescheduled",
      title: `${dateLabel}: Rescheduled\n${scheduleTooltipDetails}`,
      isTargetDay,
    };
  }

  if (isTargetDay) {
    return {
      state: hasRescheduledTime ? "rescheduled" : "scheduled",
      label: hasRescheduledTime ? "Rescheduled" : "Scheduled",
      title: hasRescheduledTime
        ? `${dateLabel}: Rescheduled\n${scheduleTooltipDetails}`
        : `${dateLabel}: Scheduled\n${scheduleTooltipDetails}`,
      isTargetDay,
    };
  }

  return {
    state: "rest",
    label: "Rest",
    title: `${dateLabel}: Rest day`,
    isTargetDay: false,
  };
}

function WeekGrid({
  habit,
  weekDays,
  weeklyCheckIns,
  weeklySkips,
  weeklyReminderRuns,
  weeklyReminders,
  referenceDate,
}: {
  habit: HabitDoc;
  weekDays: ReturnType<typeof getWeekDays>;
  weeklyCheckIns: CheckInDoc[];
  weeklySkips: HabitSkipDoc[];
  weeklyReminderRuns: ReminderRunDoc[];
  weeklyReminders: ReminderDoc[];
  referenceDate: Date;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {weekDays.map((day) => {
        const cell = getWeeklyCellState(
          habit,
          day,
          weeklyCheckIns,
          weeklySkips,
          weeklyReminderRuns,
          weeklyReminders,
        );
        const isToday = day.dateKey === toDateKey(referenceDate);
        const style =
          cell.state === "missed"
            ? "bg-[#DF3B23] text-white border-black"
            : cell.state === "completed"
              ? "bg-black text-white border-black"
              : cell.state === "bonus"
                ? "bg-[#F2E3BC] text-[#5C3B00] border-[#B7925A]"
                : cell.state === "skipped"
                  ? "bg-[#F7EFE1] text-[#7B5D3A] border-dashed border-[#B7925A]"
                  : cell.state === "rescheduled"
                    ? "bg-[#F7ECE8] text-[#9D6760] border-[#D6AAA2] opacity-75"
                    : cell.state === "scheduled"
                      ? "bg-[#E4DED1] text-[#4F4A42] border-[#8E8678]"
                      : "bg-background text-muted-foreground border-black/15";

        return (
          <div
            key={`${habit._id}-${day.dateKey}`}
            title={cell.title}
            aria-label={cell.title}
            className={`relative flex h-10 w-10 items-center justify-center border-2 uppercase font-bold ${style} ${isToday ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : ""}`}
          >
            <span
              className={`text-[10px] ${
                cell.state === "rescheduled"
                  ? "line-through decoration-[1.5px]"
                  : ""
              }`}
            >
              {day.label.charAt(0)}
            </span>
            {cell.isTargetDay &&
            (cell.state === "scheduled" ||
              cell.state === "rescheduled" ||
              cell.state === "skipped") ? (
              <span
                aria-hidden="true"
                className={`absolute bottom-1 left-1/2 h-1 w-4 -translate-x-1/2 ${
                  cell.state === "scheduled"
                    ? "bg-[#6E675B]"
                    : cell.state === "rescheduled"
                      ? "bg-[#C58B83]"
                      : "bg-[#B7925A]"
                }`}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function HabitComposerDialog({
  disabled,
  onCreate,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: {
  disabled: boolean;
  onCreate: (form: HabitFormState) => Promise<void>;
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [form, setForm] = useState<HabitFormState>(initialHabitForm);
  const [saving, setSaving] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = controlledOnOpenChange ?? setUncontrolledOpen;

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
      {trigger ? (
        <div onClick={() => !disabled && setOpen(true)}>{trigger}</div>
      ) : (
        <Button
          type="button"
          variant="default"
          className="bg-black text-white"
          onClick={() => setOpen(true)}
          disabled={disabled}
        >
          <Plus />
          New Habit
        </Button>
      )}
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

function TaskComposerDialog({
  disabled,
  onCreate,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: {
  disabled: boolean;
  onCreate: (form: TaskFormState) => Promise<void>;
  trigger: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [form, setForm] = useState<TaskFormState>(initialTaskForm);
  const [saving, setSaving] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = controlledOnOpenChange ?? setUncontrolledOpen;

  async function handleSubmit() {
    setSaving(true);
    try {
      await onCreate(form);
      setForm(initialTaskForm);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <div onClick={() => !disabled && setOpen(true)}>{trigger}</div>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-3xl">Create Task</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Keep it simple. One task, one time, one reminder.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="task-name">Task name</Label>
            <Input
              id="task-name"
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  title: event.target.value,
                }))
              }
              placeholder="Call mom"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="task-date">Date</Label>
              <Input
                id="task-date"
                type="date"
                value={form.date}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    date: event.target.value,
                  }))
                }
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="task-time">Time</Label>
              <Input
                id="task-time"
                type="time"
                value={form.time}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    time: event.target.value,
                  }))
                }
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="task-reminder">Reminder (minutes before)</Label>
            <Input
              id="task-reminder"
              type="number"
              min="0"
              value={form.reminderOffsetMinutes}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  reminderOffsetMinutes: event.target.value,
                }))
              }
            />
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              disabled={saving}
              onClick={() => void handleSubmit()}
            >
              {saving ? "Saving..." : "Create Task"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateItemMenu({
  disableHabitCreation,
  onCreateHabit,
  onCreateTask,
}: {
  disableHabitCreation: boolean;
  onCreateHabit: (form: HabitFormState) => Promise<void>;
  onCreateTask: (form: TaskFormState) => Promise<void>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [habitOpen, setHabitOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);

  function openHabitDialog() {
    setMenuOpen(false);
    setTimeout(() => setHabitOpen(true), 0);
  }

  function openTaskDialog() {
    setMenuOpen(false);
    setTimeout(() => setTaskOpen(true), 0);
  }

  return (
    <div className="ml-auto flex items-center">
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger className="inline-flex h-10 items-center gap-2 border-2 border-black bg-black px-5 py-2 text-sm font-medium uppercase tracking-[0.24em] text-white shadow-[4px_4px_0_0_#1a1a1a]">
          <Plus className="size-4" />
          New
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            onClick={openHabitDialog}
            disabled={disableHabitCreation}
          >
            New Habit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={openTaskDialog}>New Task</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <HabitComposerDialog
        disabled={disableHabitCreation}
        onCreate={onCreateHabit}
        open={habitOpen}
        onOpenChange={setHabitOpen}
        trigger={<span className="hidden" />}
      />
      <TaskComposerDialog
        disabled={false}
        onCreate={onCreateTask}
        open={taskOpen}
        onOpenChange={setTaskOpen}
        trigger={<span className="hidden" />}
      />
    </div>
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
                You will start with Brutal Mode. More coach styles can be added
                later.
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
  schedule: {
    scheduledTime: string;
    reminderTime: string;
    checkInDeadline: string;
    isRescheduled: boolean;
  };
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
  todayReminders: ReminderDoc[],
  referenceDate: Date,
): HabitPressureSnapshot {
  const checkIn = todayCheckIns.find((entry) => entry.habitId === habit._id);
  const scheduledToday = habit.isActive && habit.targetDays.includes(todayKey);
  const schedule = getEffectiveHabitScheduleForDate({
    habit,
    dayKey: todayKey,
    dateKey: todayDate,
    reminders: todayReminders,
  });
  const reminderDate = setTimeOnDate(referenceDate, schedule.reminderTime);
  const deadlineDate = setTimeOnDate(referenceDate, schedule.checkInDeadline);
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
    nextTimeValue: schedule.scheduledTime,
    countdownLabel: "Later today",
    headline: "No pressure today.",
    support:
      "Rest day. Recover or log a bonus session if you still put work in.",
    streakLabel:
      habit.currentStreak > 0
        ? `| Current streak ${habit.currentStreak} days 🔥`
        : "| No streak running",
    primaryActionLabel: "Open chat",
    chatPrompt: `How am I doing with ${habit.name}?`,
    cardClassName:
      "border-2 border-[#7E7868] bg-[#F1ECE2] text-[#5B5549] opacity-90",
    badgeClassName: "border-[#A59A84] bg-[#E2D8C4] text-[#5B5549]",
    panelClassName: "border-[#B8AE99] bg-[#FAF6EE] text-[#5B5549]",
    panelToneClassName: "text-[#6A6357]",
    emphasisClassName: "text-[#6A6357]",
    countdownMinutes: null,
    deadlineProgress: scheduledToday ? deadlineProgress : null,
    urgencyLabel: "No active clock",
    isPrimaryCandidate: scheduledToday || Boolean(checkIn),
    schedule,
  };

  if (state === "logged") {
    const isBonusLog = checkIn?.status === "bonus";
    return {
      ...base,
      habit,
      checkIn,
      scheduledToday,
      state,
      priority: getPressurePriority(state),
      nextTimeLabel: isBonusLog ? "Bonus logged" : "Logged",
      nextTimeValue: formatFullTime(
        checkIn?.timestamp ?? referenceDate.getTime(),
      ),
      countdownLabel: isBonusLog ? "Bonus work banked" : "Target handled",
      headline: isBonusLog
        ? `${habit.name} got extra work.`
        : habit.currentStreak + 1 > 1
          ? `Chain protected. ${habit.name} is done.`
          : `${habit.name} is on the board.`,
      support: isBonusLog
        ? "Extra work counts. It helps, but tomorrow still expects the actual standard."
        : "You handled today's rep. Tomorrow still expects the same standard.",
      streakLabel:
        habit.currentStreak > 0
          ? `| Streak rolling ${habit.currentStreak} days 🔥`
          : "| First clean log on record",
      primaryActionLabel: "Review with coach",
      chatPrompt: `Give me the readout for ${habit.name} after today's log.`,
      cardClassName: isBonusLog
        ? "bg-[#1B1404] text-[#FFF8E5]"
        : "bg-[#05120C] text-white",
      badgeClassName: isBonusLog
        ? "bg-[#A66A00] text-[#FFF8E5] border-[#A66A00]"
        : "bg-[#113A28] text-white border-[#113A28]",
      panelClassName: isBonusLog
        ? "border-[#A66A00] bg-[#2A1F07] text-[#FFF8E5]"
        : "border-[#113A28] bg-[#0A2418] text-white",
      panelToneClassName: isBonusLog ? "text-[#F4DCA1]" : "text-white/80",
      emphasisClassName: isBonusLog ? "text-[#F4B942]" : "text-[#4CAF50]",
      countdownMinutes: null,
      deadlineProgress: 100,
      urgencyLabel: isBonusLog ? "Extra work logged" : "Locked in",
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
        : schedule.checkInDeadline,
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
      nextTimeValue: schedule.checkInDeadline,
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
      cardClassName:
        "bg-background text-foreground border-[3px] border-[#DF3B23]",
      badgeClassName: "bg-[#DF3B23] text-white border-[#DF3B23]",
      panelClassName:
        "border-[2px] border-[#DF3B23] bg-background text-foreground",
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
        minutesToReminder <= 0
          ? schedule.checkInDeadline
          : schedule.reminderTime,
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
      cardClassName:
        "border-[3px] border-[#B87912] bg-[#FFF2CF] text-[#3B2604]",
      badgeClassName: "border-[#B87912] bg-[#F4B942] text-[#3B2604]",
      panelClassName:
        "border-[2px] border-[#D59A1A] bg-[#FFF8E7] text-[#3B2604]",
      panelToneClassName: "text-[#5C3B00]",
      emphasisClassName: "text-[#A05A00]",
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
      nextTimeValue: schedule.reminderTime,
      countdownLabel: formatMinutesRemaining(Math.max(minutesToReminder, 0)),
      headline: `${habit.name} is next up.`,
      support:
        "The slot is booked. Keep the day clean so you are ready when the reminder hits.",
      streakLabel: streakRisk
        ? `Streak at risk: ${habit.currentStreak} days`
        : base.streakLabel,
      primaryActionLabel: "Prep with coach",
      chatPrompt: `Set me up to hit ${habit.name} clean today.`,
      cardClassName: "border-2 border-[#D88A80] bg-[#F7DFDB] text-[#6A1F16]",
      badgeClassName: "border-[#D88A80] bg-[#EFA49A] text-[#6A1F16]",
      panelClassName: "border-[#D88A80] bg-[#FDF0ED] text-[#6A1F16]",
      panelToneClassName: "text-[#7C2A20]",
      emphasisClassName: "text-[#C64B3A]",
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

function isCompactHomeSnapshot(
  snapshot: HabitPressureSnapshot,
  isPrimary: boolean,
) {
  if (isUrgentHomeSnapshot(snapshot)) {
    return false;
  }

  if (isPrimary) {
    return false;
  }

  if (!snapshot.habit.isActive) {
    return true;
  }

  return (
    snapshot.state === "logged" ||
    snapshot.state === "rest" ||
    snapshot.state === "upcoming"
  );
}

function isUrgentHomeSnapshot(snapshot: HabitPressureSnapshot) {
  return (
    snapshot.state === "missed" ||
    snapshot.state === "deadline-risk" ||
    snapshot.state === "due-soon"
  );
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
      className={`inline-flex items-center border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.22em] ${
        subtle
          ? "border-current/35 bg-background/20 text-current"
          : `${snapshot.badgeClassName} shadow-[2px_2px_0px_0px_rgba(26,24,20,0.15)]`
      }`}
    >
      {snapshot.state === "rest"
        ? "Rest"
        : snapshot.state === "upcoming"
          ? "Queued"
          : snapshot.state === "due-soon"
            ? "Due soon"
            : snapshot.state === "deadline-risk"
              ? "Deadline risk"
              : snapshot.state === "logged"
                ? snapshot.checkIn?.status === "bonus"
                  ? "Bonus"
                  : "Logged"
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
        <span className="opacity-75">{snapshot.urgencyLabel}</span>
        <span className={snapshot.emphasisClassName}>
          {snapshot.countdownMinutes === null
            ? snapshot.countdownLabel
            : formatMinutesRemaining(snapshot.countdownMinutes)}
        </span>
      </div>
      <div
        className={`overflow-hidden border border-current/20 ${compact ? "h-2" : "h-3"} bg-black/5`}
      >
        <div
          className={`h-full transition-all duration-500 ${
            snapshot.state === "missed" || snapshot.state === "deadline-risk"
              ? "bg-[#DF3B23]"
              : snapshot.state === "logged"
                ? snapshot.checkIn?.status === "bonus"
                  ? "bg-[#A66A00]"
                  : "bg-[#113A28]"
                : snapshot.state === "upcoming"
                  ? "bg-[#C64B3A]"
                  : snapshot.state === "rest"
                    ? "bg-[#A59A84]"
                    : "bg-[#D59A1A]"
          } ${snapshot.state === "missed" ? "animate-pulse" : ""}`}
          style={{ width: `${snapshot.deadlineProgress}%` }}
        />
      </div>
    </div>
  );
}

function compareTaskScheduleAsc(left: AgentTaskDoc, right: AgentTaskDoc) {
  if (left.date !== right.date) {
    return left.date.localeCompare(right.date);
  }
  if ((left.time ?? "") !== (right.time ?? "")) {
    return (left.time ?? "").localeCompare(right.time ?? "");
  }
  return left._creationTime - right._creationTime;
}

function buildHighlightAlertCards(args: {
  snapshots: HabitPressureSnapshot[];
  tasks: AgentTaskDoc[];
  currentTime: Date;
}): HighlightAlertCard[] {
  const missed =
    [...args.snapshots]
      .filter((snapshot) => snapshot.state === "missed")
      .sort(rankHabitSnapshots)[0] ?? null;
  const overdue =
    [...args.snapshots]
      .filter(
        (snapshot) =>
          snapshot.state === "deadline-risk" &&
          (snapshot.countdownMinutes ?? 1) <= 0,
      )
      .sort(rankHabitSnapshots)[0] ?? null;
  const dueToday =
    [...args.snapshots]
      .filter(
        (snapshot) =>
          snapshot.state === "due-soon" ||
          (snapshot.state === "deadline-risk" &&
            (snapshot.countdownMinutes ?? 1) > 0),
      )
      .sort(rankHabitSnapshots)[0] ?? null;
  const pendingTasks = [...args.tasks]
    .filter(
      (task) =>
        task.status === "pending" ||
        shouldKeepDoneTaskVisible(task, args.currentTime),
    )
    .sort(compareTaskScheduleAsc);

  const cards: HighlightAlertCard[] = [];

  if (missed) {
    cards.push({
      kind: "habit",
      id: `missed-${missed.habit._id}`,
      priority: 4,
      label: "Missed",
      title: missed.headline,
      support: missed.support,
      meta: [missed.habit.name, missed.nextTimeLabel, missed.nextTimeValue],
      actionLabel: "Open chat",
      toneClassName: "bg-[#DF3B23] text-white border-[#BF2D19]",
      toneTextClassName: "text-white/90",
      badgeClassName: "border-white bg-white text-[#DF3B23]",
      countLabel: "Needs action",
      snapshot: missed,
    });
  }

  if (overdue) {
    cards.push({
      kind: "habit",
      id: `overdue-${overdue.habit._id}`,
      priority: 3,
      label: "Overdue",
      title: overdue.habit.name,
      support:
        overdue.countdownMinutes !== null && overdue.countdownMinutes <= 0
          ? "The deadline already passed. Either own the miss or lock the next rep."
          : overdue.support,
      meta: [
        overdue.nextTimeLabel,
        overdue.nextTimeValue,
        overdue.countdownLabel,
      ],
      actionLabel: "Handle now",
      toneClassName:
        "border-[3px] border-[#DF3B23] bg-background text-foreground",
      toneTextClassName: "text-foreground",
      badgeClassName: "border-[#DF3B23] bg-[#DF3B23] text-white",
      countLabel: "Past deadline",
      snapshot: overdue,
    });
  }

  if (dueToday) {
    cards.push({
      kind: "habit",
      id: `due-${dueToday.habit._id}`,
      priority: 2,
      label: "Due today",
      title: dueToday.habit.name,
      support: dueToday.support,
      meta: [
        dueToday.nextTimeLabel,
        dueToday.nextTimeValue,
        dueToday.countdownLabel,
      ],
      actionLabel: dueToday.primaryActionLabel,
      toneClassName:
        "border-[3px] border-[#B87912] bg-[#FFF2CF] text-[#3B2604]",
      toneTextClassName: "text-[#5C3B00]",
      badgeClassName: "border-[#B87912] bg-[#F4B942] text-[#3B2604]",
      countLabel: "Live today",
      snapshot: dueToday,
    });
  }

  pendingTasks.forEach((task) => {
    const taskDate = new Date(`${task.date}T00:00:00`);
    const taskTime = task.time ?? "No time set";
    const overdue =
      task.status === "pending" && isTaskOverdue(task, args.currentTime);
    const done = task.status === "done";
    cards.push({
      kind: "task",
      id: `task-${task._id}`,
      priority: 1,
      label: done ? "Done" : overdue ? "Late task" : "Task",
      title: task.title,
      support: done
        ? "Marked done. It stays here for a bit, then gets auto-cleared."
        : task.date === toDateKey(args.currentTime)
          ? `Due today${task.time ? ` at ${task.time}` : ""}. Still pending.`
          : `Queued for ${formatWorkoutDate(taskDate.getTime())}${task.time ? ` at ${task.time}` : ""}. Still pending.`,
      meta: [formatWorkoutDate(taskDate.getTime()), taskTime, task.source],
      actionLabel: "Open chat",
      toneClassName: done
        ? "border-black bg-black text-white"
        : overdue
          ? "border-[3px] border-[#DF3B23] bg-[#FBE1DC] text-[#6B1E15]"
          : "border-black/30 bg-background text-foreground",
      toneTextClassName: done
        ? "text-white/85"
        : overdue
          ? "text-[#6B1E15]"
          : "text-foreground",
      badgeClassName: done
        ? "border-white/20 bg-white text-black"
        : overdue
          ? "border-[#DF3B23] bg-[#DF3B23] text-white"
          : "border-black/30 bg-background text-foreground",
      countLabel: done
        ? "Done"
        : task.date === toDateKey(args.currentTime)
          ? "Today"
          : overdue
            ? "Overdue"
            : "Queued",
      task,
    });
  });

  return cards;
}

function SummaryStatusCard({
  snapshots,
  tasks,
  scheduledToday,
  completedToday,
  subscriptionTier,
  currentTime,
  onPrimaryAction,
  onTaskMarkDone,
}: {
  snapshots: HabitPressureSnapshot[];
  tasks: AgentTaskDoc[];
  scheduledToday: number;
  completedToday: number;
  subscriptionTier: "free" | "pro";
  currentTime: Date;
  onPrimaryAction: (card: HighlightAlertCard) => void;
  onTaskMarkDone: (task: AgentTaskDoc) => Promise<void>;
}) {
  const highlightCards = useMemo(
    () => buildHighlightAlertCards({ snapshots, tasks, currentTime }),
    [currentTime, snapshots, tasks],
  );
  const [frontCardIndex, setFrontCardIndex] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [exitDirection, setExitDirection] = useState<1 | -1 | 0>(0);
  const dragStateRef = useRef<{ pointerId: number; startX: number } | null>(
    null,
  );
  const exitTimerRef = useRef<number | null>(null);
  const wheelAccumulatorRef = useRef(0);
  const wheelGestureConsumedRef = useRef(false);
  const wheelIdleTimerRef = useRef<number | null>(null);
  const scrollLockTimerRef = useRef<number | null>(null);
  const isScrollLockedRef = useRef(false);
  const cardCount = highlightCards.length;
  const normalizedFrontIndex =
    cardCount === 0
      ? 0
      : ((frontCardIndex % cardCount) + cardCount) % cardCount;
  const orderedCards = useMemo(
    () =>
      cardCount === 0
        ? []
        : Array.from(
            { length: cardCount },
            (_, offset) =>
              highlightCards[(normalizedFrontIndex + offset) % cardCount],
          ),
    [cardCount, highlightCards, normalizedFrontIndex],
  );

  const triggerLoopShift = useCallback(
    (swipeDirection: 1 | -1) => {
      if (cardCount <= 1 || isExiting) return;
      setIsExiting(true);
      setExitDirection(swipeDirection);
      wheelAccumulatorRef.current = 0;
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current);
      }
      exitTimerRef.current = window.setTimeout(() => {
        // Always rotate forward so the top card moves to the very back.
        setFrontCardIndex((current) => current + 1);
        setDragOffset(0);
        setIsDragging(false);
        setIsExiting(false);
        setExitDirection(0);
      }, 180);
    },
    [cardCount, isExiting],
  );

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (cardCount <= 1 || isExiting) return;
      // Do not start drag when the pointer originates from an interactive
      // element (button, link, input, …) so that click handlers still fire.
      const interactiveTags = new Set([
        "BUTTON",
        "A",
        "INPUT",
        "SELECT",
        "TEXTAREA",
      ]);
      const isInteractive = event.nativeEvent
        .composedPath()
        .some((el) => el instanceof Element && interactiveTags.has(el.tagName));
      if (isInteractive) return;
      dragStateRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
      };
      setIsDragging(true);
      setDragOffset(0);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [cardCount, isExiting],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragStateRef.current) return;
      setDragOffset(event.clientX - dragStateRef.current.startX);
    },
    [],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragStateRef.current) return;
      const threshold = 64;
      if (dragOffset >= threshold) {
        triggerLoopShift(1);
      } else if (dragOffset <= -threshold) {
        triggerLoopShift(-1);
      } else {
        setDragOffset(0);
        setIsDragging(false);
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      dragStateRef.current = null;
    },
    [dragOffset, triggerLoopShift],
  );

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (cardCount <= 1 || isExiting || isScrollLockedRef.current) return;
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();

      if (wheelIdleTimerRef.current !== null) {
        window.clearTimeout(wheelIdleTimerRef.current);
      }
      wheelIdleTimerRef.current = window.setTimeout(() => {
        wheelAccumulatorRef.current = 0;
        wheelGestureConsumedRef.current = false;
      }, 140);

      if (wheelGestureConsumedRef.current) return;

      wheelAccumulatorRef.current += event.deltaX;
      const threshold = 72;
      if (wheelAccumulatorRef.current >= threshold) {
        isScrollLockedRef.current = true;
        wheelAccumulatorRef.current = 0;
        wheelGestureConsumedRef.current = true;
        triggerLoopShift(-1);
        if (scrollLockTimerRef.current !== null) {
          window.clearTimeout(scrollLockTimerRef.current);
        }
        scrollLockTimerRef.current = window.setTimeout(() => {
          isScrollLockedRef.current = false;
        }, 240);
      } else if (wheelAccumulatorRef.current <= -threshold) {
        isScrollLockedRef.current = true;
        wheelAccumulatorRef.current = 0;
        wheelGestureConsumedRef.current = true;
        triggerLoopShift(1);
        if (scrollLockTimerRef.current !== null) {
          window.clearTimeout(scrollLockTimerRef.current);
        }
        scrollLockTimerRef.current = window.setTimeout(() => {
          isScrollLockedRef.current = false;
        }, 240);
      }
    },
    [cardCount, isExiting, triggerLoopShift],
  );

  useEffect(() => {
    return () => {
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current);
      }
      if (wheelIdleTimerRef.current !== null) {
        window.clearTimeout(wheelIdleTimerRef.current);
      }
      if (scrollLockTimerRef.current !== null) {
        window.clearTimeout(scrollLockTimerRef.current);
      }
    };
  }, []);

  return (
    <div
      className={`grid gap-3 sm:gap-4 ${highlightCards.length > 0 ? "md:grid-cols-[0.85fr_1.15fr]" : "md:grid-cols-1"}`}
    >
      <div className="space-y-1.5 border-2 border-black bg-secondary p-3.5 shadow-[6px_6px_0px_0px_rgba(26,24,20,1)] sm:space-y-2 sm:p-5">
        <p className="brutal-meta">Streak</p>
        <h1 className="text-[clamp(1.75rem,7vw,3rem)] font-black uppercase tracking-[-0.08em] sm:text-[clamp(2rem,8vw,3.75rem)]">
          {formatToday(currentTime)}
        </h1>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t-2 border-black pt-2.5 sm:pt-3">
          <p className="text-sm font-black uppercase tracking-[0.22em] text-muted-foreground sm:text-base">
            {formatTime(currentTime)}
          </p>
          <Badge className="bg-black text-[10px] text-white sm:text-xs">
            {subscriptionTier.toUpperCase()}
          </Badge>
        </div>
      </div>

      {highlightCards.length > 0 ? (
        <div className="relative min-h-[300px] sm:min-h-[340px] md:min-h-[360px]">
          <div
            className={`absolute inset-0 h-full w-full touch-pan-y select-none ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onPointerLeave={handlePointerUp}
            onWheel={handleWheel}
          >
            {orderedCards.map((card, index) => {
              // Hide cards beyond the 2nd on mobile to save space
              const isHiddenOnMobile = index > 1;

              const translateX =
                index === 0
                  ? isExiting
                    ? exitDirection * 320
                    : dragOffset
                  : index * 16;
              const scale = index === 0 ? 1 : 0.985 - Math.min(index, 2) * 0.02;
              const opacity =
                index > 2 ? 0 : index === 0 ? 1 : 0.88 - index * 0.1;
              const zIndex = 50 - index;
              const transitionClass =
                index === 0
                  ? isDragging
                    ? "duration-0"
                    : isExiting
                      ? "duration-200"
                      : "duration-200"
                  : "duration-200";

              return (
                <div
                  key={card.id}
                  onClick={() => {
                    if (index > 0) {
                      setFrontCardIndex((current) => current + index);
                    }
                  }}
                  className={`absolute left-0 top-0 w-[calc(100%-1.25rem)] border-2 p-3.5 text-left shadow-[4px_4px_0px_0px_rgba(26,24,20,0.22)] transition-[transform,opacity] sm:w-[calc(100%-2.5rem)] sm:p-5 sm:shadow-[8px_8px_0px_0px_rgba(26,24,20,0.28)] ${transitionClass} ${index > 0 ? "cursor-pointer" : ""} ${card.toneClassName} ${isHiddenOnMobile ? "hidden sm:block" : ""}`}
                  style={{
                    transform: `translate3d(${translateX}px, 0, 0) scale(${scale})`,
                    zIndex,
                    opacity,
                  }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2.5 border-b-2 border-current/15 pb-2.5 sm:gap-4 sm:pb-4">
                    <div className="min-w-0 flex-1 space-y-1.5 sm:space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.22em] sm:px-2.5 sm:py-1 sm:text-[10px] ${card.badgeClassName}`}
                        >
                          {card.label}
                        </span>
                      </div>
                      <p className="text-[clamp(1.1rem,4.8vw,1.6rem)] font-black uppercase tracking-[-0.05em] sm:text-[clamp(1.35rem,6vw,1.875rem)]">
                        {card.title}
                      </p>
                      <p
                        className={`text-[9px] font-bold uppercase tracking-[0.18em] opacity-75 sm:hidden ${card.toneTextClassName}`}
                      >
                        {card.meta[0] ?? card.countLabel}
                      </p>
                    </div>
                    <div className="hidden w-full border-2 border-current/20 bg-background/35 p-3 text-left sm:block sm:min-w-[112px] sm:w-auto sm:text-right">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] opacity-80">
                        Today
                      </p>
                      <p className="mt-2 text-2xl font-black sm:text-3xl">
                        {scheduledToday > 0
                          ? `${completedToday}/${scheduledToday}`
                          : "0/0"}
                      </p>
                      <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.18em] opacity-70">
                        {card.countLabel}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-2.5 pt-2.5 sm:gap-4 sm:pt-4 lg:grid-cols-[1fr_auto] lg:items-end">
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2 border-2 border-current/20 bg-background/35 p-2 sm:hidden">
                        <div>
                          <p className="text-[8px] font-bold uppercase tracking-[0.18em] opacity-70">
                            Today
                          </p>
                          <p className="mt-0.5 text-lg font-black">
                            {scheduledToday > 0
                              ? `${completedToday}/${scheduledToday}`
                              : "0/0"}
                          </p>
                        </div>
                        <div>
                          <p className="text-[8px] font-bold uppercase tracking-[0.18em] opacity-70">
                            Status
                          </p>
                          <p className="mt-0.5 text-[10px] font-black uppercase tracking-[0.14em]">
                            {card.countLabel}
                          </p>
                        </div>
                      </div>
                      <p
                        className={`hidden text-[11px] font-bold uppercase tracking-[0.18em] opacity-80 sm:block ${card.toneTextClassName}`}
                      >
                        {card.meta.join(" · ")}
                      </p>
                      <p
                        className={`hidden max-w-2xl text-sm leading-5 opacity-90 sm:block sm:leading-6 ${card.toneTextClassName}`}
                      >
                        {card.support}
                      </p>
                      {card.kind === "habit" ? (
                        <div className="hidden sm:block">
                          <CountdownMeter snapshot={card.snapshot} compact />
                        </div>
                      ) : null}
                    </div>
                    <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
                      {card.kind === "task" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant={
                            card.task.status === "done"
                              ? "secondary"
                              : "default"
                          }
                          disabled={index !== 0 || card.task.status === "done"}
                          className="h-9 w-full sm:h-11 sm:w-auto"
                          onClick={(event) => {
                            event.stopPropagation();
                            void onTaskMarkDone(card.task);
                          }}
                        >
                          Mark done
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant={card.kind === "task" ? "outline" : "default"}
                        disabled={index !== 0}
                        className="h-9 w-full sm:h-11 sm:w-auto"
                        onClick={(event) => {
                          event.stopPropagation();
                          onPrimaryAction(card);
                        }}
                      >
                        {card.actionLabel}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
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
  const isLoggedCard = state === "logged";
  const detailSurfaceClassName =
    state === "missed"
      ? "border-[#F2A195]/35 bg-[#EA7D6B] text-[#FFF4ED]"
      : state === "deadline-risk"
        ? "border-[#F0B5AD]/40 bg-[#FBE1DC] text-[#6B1E15]"
        : "border-current/15 bg-background/40 text-current";
  const statusBadgeClassName = isLoggedCard
    ? checkIn?.status === "bonus"
      ? "border-[#F4DCA1]/60 bg-[#FFF8E5]/10 text-[#FFF8E5]"
      : "border-white/35 bg-white/10 text-white"
    : undefined;
  const canMarkComplete =
    pendingHabitId !== habit._id &&
    !checkIn &&
    habit.isActive &&
    scheduledToday &&
    state !== "missed";
  const compact = isCompactHomeSnapshot(snapshot, isPrimary);

  if (compact) {
    return (
      <Card
        className={`${snapshot.cardClassName} border-2 shadow-[6px_6px_0px_0px_rgba(26,24,20,0.12)]`}
      >
        <CardContent className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <PressureBadge snapshot={snapshot} subtle />
              <Badge variant="outline" className={statusBadgeClassName}>
                {habit.isActive ? "Active" : "Paused"}
              </Badge>
              {isPrimary ? (
                <span className="text-[10px] font-black uppercase tracking-[0.24em] text-muted-foreground">
                  Primary
                </span>
              ) : null}
            </div>
            <div className="space-y-1">
              <CardTitle className="text-2xl">{habit.name}</CardTitle>
              <p className="text-sm leading-6 opacity-85">{snapshot.support}</p>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] font-bold uppercase tracking-[0.18em]">
              <span className="border border-current/20 bg-background/30 px-2 py-1">
                {snapshot.nextTimeLabel}: {snapshot.nextTimeValue}
              </span>
              <span className="border border-current/20 bg-background/30 px-2 py-1">
                {snapshot.streakLabel}
              </span>
              {checkIn?.status === "bonus" ? (
                <span className="border border-current/20 bg-background/30 px-2 py-1">
                  Bonus logged
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex w-full items-center gap-2 md:w-auto md:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenDetail(habit)}
              className="min-h-11 flex-1 md:w-auto md:flex-none"
            >
              <PencilLine />
              Details
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger>
                <div className="inline-flex cursor-pointer items-center justify-center rounded-md border-2 border-black bg-background p-2 transition-colors hover:bg-accent hover:text-accent-foreground sm:size-11">
                  <Ellipsis />
                  <span className="sr-only">More actions</span>
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={onOpenChat} className="h-11">
                  <MessageSquare className="mr-2 size-4" />
                  Chat with agent
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => void onToggleActive(habit)}
                  disabled={pendingHabitId === habit._id}
                  className="h-11"
                >
                  <MoonStar className="mr-2 size-4" />
                  {habit.isActive ? "Pause tracking" : "Resume tracking"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>
    );
  }

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
            <Badge variant="outline" className={statusBadgeClassName}>
              {habit.isActive ? "Active" : "Paused"}
            </Badge>
          </div>
          <div className="space-y-2">
            <CardTitle
              className={
                isPrimary ? "text-3xl sm:text-4xl" : "text-2xl sm:text-3xl"
              }
            >
              {habit.name}
            </CardTitle>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] opacity-80">
              {snapshot.headline}
            </p>
          </div>
        </div>

        <div className="flex w-full items-center gap-2 sm:w-auto sm:flex-wrap sm:items-center">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenDetail(habit)}
            className="min-h-11 flex-1 sm:flex-none"
          >
            <PencilLine />
            Details
          </Button>
          <div className="sm:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger className="inline-flex">
                <Button type="button" variant="outline" size="icon-lg">
                  <Ellipsis />
                  <span className="sr-only">More actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem
                  onClick={() => void onToggleActive(habit)}
                  disabled={pendingHabitId === habit._id}
                >
                  {habit.isActive ? "Pause" : "Resume"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => void onDeleteHabit(habit)}
                  disabled={pendingHabitId === habit._id}
                >
                  Delete habit
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="hidden sm:flex sm:flex-wrap sm:items-center sm:gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onToggleActive(habit)}
              disabled={pendingHabitId === habit._id}
              className="min-h-11"
            >
              {habit.isActive ? "Pause" : "Resume"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-lg"
              onClick={() => onDeleteHabit(habit)}
              disabled={pendingHabitId === habit._id}
            >
              <Trash2 />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="grid gap-6 p-6">
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className={`border-2 p-5 ${snapshot.panelClassName}`}>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] opacity-70">
              Today status
            </p>
            <p className="mt-3 text-2xl font-black uppercase tracking-[-0.05em] sm:text-3xl">
              {state === "logged"
                ? checkIn?.status === "bonus"
                  ? "Bonus banked"
                  : "Handled"
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
            <p className="mt-3 text-sm leading-6 opacity-90">
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

          <details className="border-2 border-current/20 bg-background/35 p-4 sm:hidden">
            <summary className="cursor-pointer text-[11px] font-black uppercase tracking-[0.18em]">
              Schedule details
            </summary>
            <div className="mt-4 grid gap-3 text-sm">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-70">
                  Reminder
                </p>
                <p className="mt-1 text-xl font-black">
                  {snapshot.schedule.reminderTime}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-70">
                  Deadline
                </p>
                <p className="mt-1 text-xl font-black">
                  {snapshot.schedule.checkInDeadline}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-70">
                  Streak
                </p>
                <p className="mt-1 text-xl font-black">
                  {habit.currentStreak} days
                </p>
              </div>
            </div>
          </details>

          <div className="hidden border-2 border-current/20 sm:grid sm:grid-cols-3">
            <div className="border-b-2 border-r-0 border-current/20 p-4 sm:border-b-0 sm:border-r-2">
              <p className="text-xs font-bold text-muted-foreground uppercase opacity-80">
                Reminder
              </p>
              <p className="mt-3 text-2xl font-black">
                {snapshot.schedule.reminderTime}
              </p>
            </div>
            <div className="border-b-2 border-r-0 border-current/20 p-4 sm:border-b-0 sm:border-r-2">
              <p className="text-xs font-bold text-muted-foreground uppercase opacity-80">
                Deadline
              </p>
              <p className="mt-3 text-2xl font-black">
                {snapshot.schedule.checkInDeadline}
              </p>
            </div>
            <div className="p-4">
              <p className="text-xs font-bold text-muted-foreground uppercase opacity-80">
                Streak
              </p>
              <p className="mt-3 text-2xl font-black">
                {habit.currentStreak} days
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-start">
          <div className="flex flex-col gap-1.5">
            <Button
              type="button"
              size="lg"
              variant={state === "logged" ? "outline" : "default"}
              disabled={!canMarkComplete}
              className="w-full sm:w-auto"
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
                ? "Review Work"
                : state === "missed"
                  ? "Acknowledge Miss"
                  : "CHECK IN"}
            </Button>
            {state === "deadline-risk" &&
              snapshot.countdownMinutes !== null &&
              snapshot.countdownMinutes <= 0 && (
                <span className="text-[10px] font-bold text-[#DF3B23] uppercase tracking-wider">
                  Will count as miss
                </span>
              )}
          </div>
          <Button
            type="button"
            size="lg"
            variant="outline"
            onClick={onOpenChat}
            className="w-full sm:w-auto"
          >
            <MessageSquare />
            {state === "missed" ? "Reset in chat" : "Chat with coach"}
          </Button>
        </div>

        <details className="border-t-2 border-current/15 pt-5 sm:hidden">
          <summary className="cursor-pointer text-[11px] font-black uppercase tracking-[0.18em]">
            More context
          </summary>
          <div className="mt-4 space-y-3">
            <div className={`border-2 p-4 ${detailSurfaceClassName}`}>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-75">
                Rules
              </p>
              <p className="mt-2 text-sm leading-6 opacity-90">{habit.rules}</p>
            </div>
            <div className={`border-2 p-4 ${detailSurfaceClassName}`}>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-75">
                Motivation
              </p>
              <p className="mt-2 text-sm leading-6 opacity-90">
                {habit.motivation}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {habit.targetDays.map((day) => (
                <Badge
                  key={`${habit._id}-${day}`}
                  variant="outline"
                  className="border-current/45 bg-current/12 text-current"
                >
                  {toTitleDay(day)}
                </Badge>
              ))}
            </div>
          </div>
        </details>

        <div className="hidden space-y-3 border-t-2 border-current/15 pt-5 sm:block">
          <div className="grid gap-3 lg:grid-cols-2">
            <div className={`border-2 p-4 ${detailSurfaceClassName}`}>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-75">
                Rules
              </p>
              <p className="mt-2 text-sm leading-6 opacity-90">{habit.rules}</p>
            </div>
            <div className={`border-2 p-4 ${detailSurfaceClassName}`}>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-75">
                Motivation
              </p>
              <p className="mt-2 text-sm leading-6 opacity-90">
                {habit.motivation}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {habit.targetDays.map((day) => (
              <Badge
                key={`${habit._id}-${day}`}
                variant="outline"
                className="border-current/45 bg-current/12 text-current"
              >
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
    <div className="sticky top-0 z-40 -mx-4 mb-4 sm:-mx-5">
      <div
        className={`border-b-2 border-black px-3.5 py-3 shadow-[0px_4px_10px_0px_rgba(26,24,20,0.1)] sm:px-4 sm:py-4 ${
          snapshot?.panelClassName ??
          "border-black bg-secondary text-foreground"
        }`}
      >
        <div className="grid gap-2.5 sm:gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="min-w-0 space-y-1.5 sm:space-y-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="brutal-meta text-[10px] text-current sm:text-xs">
                Coach context
              </p>
              {snapshot ? (
                <div className="scale-90 origin-left sm:scale-100">
                  <PressureBadge snapshot={snapshot} />
                </div>
              ) : null}
            </div>
            <p
              className={`truncate text-lg font-black uppercase tracking-[-0.05em] sm:text-2xl ${snapshot?.panelToneClassName ?? ""}`}
            >
              {snapshot ? snapshot.habit.name : "No target habit today"}
            </p>
            <p
              className={`text-xs leading-5 opacity-85 sm:text-sm sm:leading-6 ${snapshot?.panelToneClassName ?? ""}`}
            >
              {snapshot?.support ??
                "Use this space for bonus logs, planning, or review."}
            </p>
          </div>
          <div className="flex flex-col gap-2.5 sm:gap-3 lg:items-end">
            {snapshot ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onLoadPrompt(snapshot.chatPrompt)}
                className="hidden h-9 w-full sm:flex sm:h-11 sm:w-auto"
              >
                <Sparkles className="size-4" />
                Load prompt
              </Button>
            ) : null}
            {snapshot ? (
              <div
                className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[9px] font-black uppercase tracking-[0.16em] sm:text-[11px] sm:tracking-[0.18em] ${snapshot.panelToneClassName}`}
              >
                <span className="border-b border-current/20 pb-0.5 sm:border-none sm:pb-0">
                  {snapshot.nextTimeLabel}: {snapshot.nextTimeValue}
                </span>
                <span className="border-b border-current/20 pb-0.5 sm:border-none sm:pb-0">
                  {snapshot.countdownLabel}
                </span>
                <span className="border-b border-current/20 pb-0.5 sm:border-none sm:pb-0">
                  {snapshot.streakLabel}
                </span>
              </div>
            ) : null}
          </div>
        </div>
        {snapshot ? (
          <div className="mt-3 border-t-2 border-current/15 pt-2.5 sm:mt-4 sm:pt-4">
            <div className="hidden sm:block">
              <CountdownMeter snapshot={snapshot} compact />
            </div>
            <div className="sm:hidden">
              <div className="h-1.5 w-full bg-current/10">
                <div
                  className="h-full bg-current transition-all duration-500"
                  style={{
                    width: `${Math.max(5, snapshot.deadlineProgress ?? 0)}%`,
                  }}
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>
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
  onCreateTask,
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
  onCreateTask: (form: TaskFormState) => Promise<void>;
}) {
  const orderedSnapshots = [...snapshots].sort(rankHabitSnapshots);
  const primaryId = primarySnapshot?.habit._id ?? null;
  const expandedSnapshots = orderedSnapshots.filter((snapshot) => {
    const isPrimary = snapshot.habit._id === primaryId;
    return (
      isUrgentHomeSnapshot(snapshot) ||
      !isCompactHomeSnapshot(snapshot, isPrimary)
    );
  });
  const compactSnapshots = orderedSnapshots.filter((snapshot) => {
    const isPrimary = snapshot.habit._id === primaryId;
    return (
      !isUrgentHomeSnapshot(snapshot) &&
      isCompactHomeSnapshot(snapshot, isPrimary)
    );
  });
  const hasExpanded = expandedSnapshots.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b-2 border-black pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="brutal-meta">Dashboard</p>
          <h2 className="text-3xl font-black uppercase tracking-[-0.08em] sm:text-4xl">
            Home
          </h2>
        </div>
        <CreateItemMenu
          disableHabitCreation={!canAddHabit}
          onCreateHabit={onCreateHabit}
          onCreateTask={onCreateTask}
        />
      </div>

      {!hasExpanded ? (
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

      {expandedSnapshots.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3 border-b-2 border-black pb-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-muted-foreground">
              Pressure board
            </p>
          </div>
          <div className="space-y-3">
            {expandedSnapshots.map((snapshot) => (
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
        </section>
      ) : null}

      {compactSnapshots.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3 border-b-2 border-black/50 pb-2">
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-muted-foreground">
              Safe states
            </p>
          </div>
          <div className="space-y-3">
            {compactSnapshots.map((snapshot) => (
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
        </section>
      ) : null}
    </div>
  );
}

function ChatTab({
  messages,
  primarySnapshot,
  budgetStatus,
  notificationPermission,
  notificationsEnabled,
  notificationPending,
  errorMessage,
  input,
  setInput,
  sending,
  upgradePending,
  onSend,
  onQuickComplete,
  onQuickMiss,
  onEnableNotifications,
  onUpgrade,
  canUpgrade,
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
  notificationPermission: NotificationPermissionState;
  notificationsEnabled: boolean;
  notificationPending: boolean;
  errorMessage: string | null;
  input: string;
  setInput: (value: string) => void;
  sending: boolean;
  upgradePending: boolean;
  onSend: (content: string) => Promise<void>;
  onQuickComplete: () => Promise<void>;
  onQuickMiss: () => Promise<void>;
  onEnableNotifications: () => Promise<void>;
  onUpgrade: () => Promise<void>;
  canUpgrade: boolean;
}) {
  const [optimisticUserMessage, setOptimisticUserMessage] = useState<{
    _id: string;
    role: "user";
    content: string;
    timestamp: number;
  } | null>(null);
  const [showFallbackHint, setShowFallbackHint] = useState(false);
  const renderedMessages = useMemo(() => {
    const base = sortByTimestamp(messages).map((message) => ({
      _id: String(message._id),
      role: message.role,
      content: message.content,
      intent: message.intent,
      timestamp: message.timestamp,
    }));

    if (!optimisticUserMessage) {
      return base;
    }

    const alreadyPersisted = base.some(
      (message) =>
        message.role === "user" &&
        message.content === optimisticUserMessage.content &&
        Math.abs(message.timestamp - optimisticUserMessage.timestamp) < 120000,
    );

    const shouldShowOptimistic = !alreadyPersisted;
    if (!shouldShowOptimistic) {
      return base;
    }

    return sortByTimestamp([...base, optimisticUserMessage]);
  }, [messages, optimisticUserMessage]);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const limitReached = budgetStatus?.limitReached ?? false;
  const lastMessageId =
    renderedMessages[renderedMessages.length - 1]?._id ?? null;

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop =
        scrollContainerRef.current.scrollHeight;
    }
  }, [lastMessageId, renderedMessages.length, sending]);

  useEffect(() => {
    const hintTimerId = sending
      ? window.setTimeout(() => {
          setShowFallbackHint(true);
        }, 4500)
      : window.setTimeout(() => {
          setShowFallbackHint(false);
        }, 0);

    return () => {
      window.clearTimeout(hintTimerId);
    };
  }, [sending]);

  const submitMessage = useCallback(() => {
    const content = input.trim();
    if (!content || sending || limitReached) {
      return;
    }

    const optimisticTimestamp = Date.now();
    setOptimisticUserMessage({
      _id: `optimistic-${optimisticTimestamp}`,
      role: "user",
      content,
      timestamp: optimisticTimestamp,
    });
    setInput("");
    void onSend(content).finally(() => {
      setOptimisticUserMessage(null);
    });
  }, [input, limitReached, onSend, sending, setInput]);

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

  const markdownComponents = useMemo(
    () => ({
      p: ({ children }: { children?: React.ReactNode }) => (
        <p className="leading-7">{children}</p>
      ),
      ul: ({ children }: { children?: React.ReactNode }) => (
        <ul className="my-2 list-disc pl-5">{children}</ul>
      ),
      ol: ({ children }: { children?: React.ReactNode }) => (
        <ol className="my-2 list-decimal pl-5">{children}</ol>
      ),
      li: ({ children }: { children?: React.ReactNode }) => (
        <li className="mb-1">{children}</li>
      ),
      strong: ({ children }: { children?: React.ReactNode }) => (
        <strong className="font-black">{children}</strong>
      ),
      em: ({ children }: { children?: React.ReactNode }) => (
        <em className="italic">{children}</em>
      ),
      code: ({ children }: { children?: React.ReactNode }) => (
        <code className="rounded-sm border border-black/20 bg-background/70 px-1 py-0.5 text-[0.9em]">
          {children}
        </code>
      ),
      pre: ({ children }: { children?: React.ReactNode }) => (
        <pre className="my-2 overflow-x-auto border border-black/20 bg-background/70 p-3 text-[0.95em]">
          {children}
        </pre>
      ),
      blockquote: ({ children }: { children?: React.ReactNode }) => (
        <blockquote className="my-2 border-l-4 border-black/40 pl-3 text-foreground/90">
          {children}
        </blockquote>
      ),
    }),
    [],
  );

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
        <CardContent className="space-y-4 p-4 sm:p-5">
          <CoachContextRail
            snapshot={primarySnapshot}
            onLoadPrompt={setInput}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 border-2 border-black bg-black px-4 py-3 text-sm text-white shadow-[4px_4px_0px_0px_rgba(26,24,20,1)]">
            <span className="max-w-xl text-[11px] font-bold uppercase tracking-[0.18em] text-white/80">
              {budgetStatus?.isUnlimited
                ? "Pro tier: unlimited daily coach messages."
                : `Daily budget: ${budgetStatus?.dailyMessageCount ?? 0}/${budgetStatus?.dailyMessageCap ?? 20}`}
            </span>
            <span className="text-lg font-black text-white">
              {budgetStatus?.isUnlimited
                ? "Unlimited"
                : `${budgetStatus?.remainingMessages ?? 20} left`}
            </span>
          </div>

          {!notificationsEnabled ? (
            <div className="flex flex-col gap-3 border-2 border-dashed border-[#C45D2A] bg-[#FCE4D6] px-4 py-3 text-sm text-[#5B2A14] shadow-[4px_4px_0px_0px_rgba(196,93,42,0.25)] sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7A3A1C]">
                {notificationPermission === "unsupported"
                  ? "Browser not supported for push reminders."
                  : notificationPermission === "denied"
                    ? "Notifications are blocked. Enable from browser settings to receive reminders."
                    : "Enable notifications so coach reminders reach your device in real time."}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="w-full border-[#A64A20] bg-[#F9D8C3] text-[#5B2A14] hover:bg-[#F3C4A8] sm:w-auto"
                disabled={
                  notificationPending ||
                  notificationPermission === "unsupported"
                }
                onClick={() => void onEnableNotifications()}
              >
                {notificationPending ? "Enabling..." : "Enable Notifications"}
              </Button>
            </div>
          ) : null}

          {limitReached && canUpgrade ? (
            <div className="brutal-alert flex flex-col gap-3 p-4 text-sm leading-relaxed">
              <p className="text-white">
                You burned through today&apos;s free chat budget. Read-only
                still works. Upgrade if you want more messages right now.
              </p>
              <div className="pt-1">
                <Button
                  type="button"
                  disabled={upgradePending}
                  onClick={() => void onUpgrade()}
                >
                  {upgradePending ? "Redirecting..." : "Upgrade to Pro"}
                </Button>
              </div>
            </div>
          ) : null}

          {errorMessage ? (
            <div className="brutal-alert p-4 text-sm leading-relaxed">
              {errorMessage}
            </div>
          ) : null}

          <div
            ref={scrollContainerRef}
            className="max-h-128 overflow-y-auto border-2 border-black bg-background px-3 py-2 sm:px-4"
          >
            {renderedMessages.length === 0 ? (
              <div className="border-b border-dashed border-black py-4 text-sm leading-relaxed text-muted-foreground">
                No messages yet. Start clean, explain the miss, or force a plan
                before today drifts.
              </div>
            ) : null}

            {renderedMessages.map((message) => {
              const isReminderMessage =
                message.role === "ai" && isReminderIntent(message.intent);

              return (
                <div
                  key={message._id}
                  className={`border-b border-dashed border-black py-3 text-sm ${
                    message.role === "ai" ? "pl-0 pr-0" : "pl-0 pr-0"
                  }`}
                >
                  <div
                    className={`${
                      message.role === "ai"
                        ? isReminderMessage
                          ? "mr-0 border-2 border-black/80 border-l-[5px] border-l-black bg-secondary/35 px-4 py-4 sm:mr-6"
                          : "mr-0 border-2 border-black bg-secondary px-4 py-4 shadow-[4px_4px_0px_0px_rgba(26,24,20,0.18)] sm:mr-6"
                        : "ml-0 border-2 border-black bg-background px-4 py-4 sm:ml-10"
                    }`}
                  >
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-4 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            message.role === "ai"
                              ? "border border-black bg-black px-2 py-1 text-white"
                              : "border border-black bg-white px-2 py-1 text-black"
                          }
                        >
                          {message.role === "ai" ? "Coach" : "You"}
                        </span>
                        {isReminderMessage ? (
                          <span className="border border-black/70 bg-background px-2 py-0.5 text-[10px] font-semibold normal-case tracking-[0.08em] text-foreground/80">
                            reminder
                          </span>
                        ) : null}
                      </div>
                      <span className="font-bold">
                        {formatMessageTime(message.timestamp)}
                      </span>
                    </div>
                    <div
                      className={
                        message.role === "ai"
                          ? isReminderMessage
                            ? "font-semibold italic text-foreground"
                            : "font-bold text-foreground"
                          : "text-foreground"
                      }
                    >
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkBreaks]}
                        components={markdownComponents}
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              );
            })}

            {sending ? (
              <div className="border-b border-dashed border-black py-3 text-sm">
                <div className="mr-0 border-2 border-black bg-secondary px-4 py-4 shadow-[4px_4px_0px_0px_rgba(26,24,20,0.18)] sm:mr-6">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-4 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                    <span className="border border-black bg-black px-2 py-1 text-white">
                      Coach
                    </span>
                    <span className="font-bold">Pending</span>
                  </div>
                  <div
                    className="flex items-center gap-2"
                    aria-live="polite"
                    aria-label="Waiting for coach reply"
                  >
                    <span className="h-2 w-2 animate-pulse rounded-full bg-foreground/80 [animation-delay:0ms]" />
                    <span className="h-2 w-2 animate-pulse rounded-full bg-foreground/80 [animation-delay:140ms]" />
                    <span className="h-2 w-2 animate-pulse rounded-full bg-foreground/80 [animation-delay:280ms]" />
                  </div>
                  {showFallbackHint ? (
                    <p className="mt-3 text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground"></p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="border-t-2 border-black/10 pt-1">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              Quick actions
            </p>
            <div className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 gap-2">
                {quickActions.slice(0, 1).map((action) => (
                  <Button
                    key={action.key}
                    type="button"
                    variant={action.variant}
                    disabled={sending || limitReached}
                    onClick={() => void action.onClick()}
                    className="h-10 flex-1 truncate px-3 text-xs sm:h-11 sm:flex-none sm:px-4 sm:text-sm"
                  >
                    {action.icon}
                    <span className="truncate">{action.label}</span>
                  </Button>
                ))}
                {quickActions.slice(1, 2).map((action) => (
                  <Button
                    key={action.key}
                    type="button"
                    variant={action.variant}
                    disabled={sending || limitReached}
                    onClick={() => void action.onClick()}
                    className="hidden h-10 flex-1 truncate px-3 text-xs sm:inline-flex sm:h-11 sm:flex-none sm:px-4 sm:text-sm"
                  >
                    {action.icon}
                    <span className="truncate">{action.label}</span>
                  </Button>
                ))}
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger>
                  <div className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-md border-2 border-black bg-background transition-colors hover:bg-accent hover:text-accent-foreground sm:h-11 sm:w-11">
                    <Ellipsis className="size-4" />
                    <span className="sr-only">More actions</span>
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {quickActions.map((action, idx) => (
                    <DropdownMenuItem
                      key={action.key}
                      onClick={() => void action.onClick()}
                      disabled={sending || limitReached}
                      className="h-11 cursor-pointer"
                    >
                      <div className="mr-2 opacity-70">{action.icon}</div>
                      <span className="font-medium">{action.label}</span>
                      {idx === 0 && (
                        <span className="ml-auto text-[10px] uppercase tracking-wider opacity-40">
                          Primary
                        </span>
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitMessage();
                }
              }}
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
              onClick={submitMessage}
            >
              {sending ? "Working..." : "Send"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function HistoryContent({
  historyRange,
  setHistoryRange,
  historyHabitId,
  setHistoryHabitId,
  activeHabits,
  historyWeeks,
  scrollAreaClassName,
}: {
  historyRange: StatsRangePreset;
  setHistoryRange: (range: StatsRangePreset) => void;
  historyHabitId: string;
  setHistoryHabitId: (id: string) => void;
  activeHabits: HabitDoc[];
  historyWeeks: {
    weekStartLabel: string;
    days: {
      dateKey: string;
      dayLabel: string;
      status:
        | "perfect"
        | "missed"
        | "rest"
        | "pending"
        | "future"
        | "inactive"
        | "skipped";
    }[];
  }[];
  scrollAreaClassName?: string;
}) {
  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {(
            [
              { key: "30d", label: "30D" },
              { key: "90d", label: "90D" },
              { key: "365d", label: "1Y" },
              { key: "all", label: "ALL" },
            ] as const
          ).map((preset) => (
            <Button
              key={preset.key}
              type="button"
              size="sm"
              variant={historyRange === preset.key ? "default" : "outline"}
              onClick={() => setHistoryRange(preset.key)}
            >
              {preset.label}
            </Button>
          ))}
        </div>

        <div className="grid gap-2">
          <Label
            htmlFor="stats-history-modal-habit"
            className="text-[10px] font-bold uppercase tracking-widest opacity-70"
          >
            Habit filter
          </Label>
          <select
            id="stats-history-modal-habit"
            value={historyHabitId}
            onChange={(event) => setHistoryHabitId(event.target.value)}
            className="h-9 min-w-40 border-2 border-black bg-background px-2 text-[10px] font-bold uppercase tracking-[0.08em]"
          >
            <option value="all">All active habits</option>
            {activeHabits.map((habit) => (
              <option key={habit._id} value={habit._id}>
                {habit.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-[8px] font-bold uppercase tracking-[0.18em] sm:text-[10px]">
        <span className="border-2 border-black bg-black px-2 py-0.5 text-white">
          Done
        </span>
        <span className="border-2 border-[#DF3B23] bg-[#DF3B23] px-2 py-0.5 text-white">
          Miss
        </span>
        <span className="border-2 border-black bg-background px-2 py-0.5">
          Live
        </span>
        <span className="border-2 border-[#F7EFE1] bg-[#F7EFE1] px-2 py-0.5 text-[#7B5D3A]">
          Skip
        </span>
      </div>

      <div className={`space-y-2 overflow-y-auto pr-1 ${scrollAreaClassName}`}>
        {historyWeeks.map((week, rowIndex) => (
          <div
            key={`${week.weekStartLabel}-${rowIndex}`}
            className="grid grid-cols-[auto_1fr] items-stretch gap-1.5 sm:gap-2"
          >
            <div className="flex w-10 items-center justify-center border-2 border-black bg-secondary px-0.5 text-[8px] font-black uppercase tracking-[0.1em] text-muted-foreground sm:w-14 sm:text-[10px] sm:tracking-[0.16em]">
              {week.weekStartLabel}
            </div>
            <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
              {week.days.map((entry) => {
                const style =
                  entry.status === "missed"
                    ? "bg-[#DF3B23] text-white border-black"
                    : entry.status === "perfect"
                      ? "bg-black text-white border-black"
                      : entry.status === "pending"
                        ? "bg-background text-foreground border-[3px] border-black"
                        : entry.status === "future"
                          ? "bg-background text-transparent border-dashed border-black/30"
                          : entry.status === "inactive"
                            ? "bg-background text-transparent border-dashed border-black/20 opacity-40"
                            : entry.status === "skipped"
                              ? "bg-[#F7EFE1] text-[#7B5D3A] border-[#B7925A]"
                              : "bg-secondary text-muted-foreground/80 border-black/20";

                return (
                  <div
                    key={entry.dateKey}
                    title={`${entry.dayLabel} ${entry.dateKey}`}
                    className={`grid min-h-10 border-2 p-1 text-center font-bold uppercase sm:min-h-12 sm:p-1.5 ${style}`}
                  >
                    <span className="text-[8px] sm:text-[9px]">
                      {entry.dayLabel.charAt(0)}
                    </span>
                    <span className="mt-auto text-[9px] sm:text-[10px]">
                      {entry.dateKey.slice(8)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatsTab({
  habits,
  checkIns,
  habitSkips,
  reminderRuns,
  reminders,
  workoutLogs,
  latestReport,
  referenceDate,
  onOpenDetail,
}: {
  habits: HabitDoc[];
  checkIns: CheckInDoc[];
  habitSkips: HabitSkipDoc[];
  reminderRuns: ReminderRunDoc[];
  reminders: ReminderDoc[];
  workoutLogs: WorkoutLogDoc[];
  latestReport: WeeklyReportDoc | null;
  referenceDate: Date;
  onOpenDetail: (habit: HabitDoc) => void;
}) {
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyRange, setHistoryRange] = useState<StatsRangePreset>("90d");
  const [historyHabitId, setHistoryHabitId] = useState<string>("all");
  const isMobile = useIsMobile();

  const weekDays = getWeekDays(referenceDate);
  const weekStart = weekDays[0]?.date ?? referenceDate;
  const weekEnd = weekDays[6]?.date ?? referenceDate;
  const weekStartTs = weekStart.getTime();
  const weekEndTs = new Date(weekEnd).setHours(23, 59, 59, 999);
  const weekDateKeys = new Set(weekDays.map((day) => day.dateKey));
  const weeklyCheckIns = checkIns.filter(
    (entry) => entry.timestamp >= weekStartTs && entry.timestamp <= weekEndTs,
  );
  const weeklySkips = habitSkips.filter((entry) =>
    weekDateKeys.has(entry.date),
  );
  const weeklyReminderRuns = reminderRuns.filter((entry) =>
    weekDateKeys.has(entry.date),
  );
  const weeklyReminders = reminders.filter((entry) =>
    weekDateKeys.has(entry.date),
  );
  const activeHabits = habits.filter((habit) => habit.isActive);
  const historyRangeStartTs = useMemo(
    () => getStatsRangeStartTimestamp(historyRange, referenceDate),
    [historyRange, referenceDate],
  );
  const historyHabits = useMemo(
    () =>
      historyHabitId === "all"
        ? activeHabits
        : activeHabits.filter((habit) => habit._id === historyHabitId),
    [activeHabits, historyHabitId],
  );
  const habitStartById = useMemo(() => {
    const map = new Map<string, number>();
    habits.forEach((habit) => {
      const start = new Date(habit.createdAt);
      start.setHours(0, 0, 0, 0);
      map.set(habit._id, start.getTime());
    });
    return map;
  }, [habits]);
  const checkInByHabitDate = useMemo(() => {
    const map = new Map<string, CheckInDoc>();
    checkIns.forEach((entry) => {
      const key = `${entry.habitId}:${entry.date}`;
      const current = map.get(key);
      if (!current || current.timestamp < entry.timestamp) {
        map.set(key, entry);
      }
    });
    return map;
  }, [checkIns]);
  const skipByHabitDate = useMemo(() => {
    const set = new Set<string>();
    habitSkips.forEach((entry) => {
      set.add(`${entry.habitId}:${entry.date}`);
    });
    return set;
  }, [habitSkips]);
  const reminderRunByHabitDate = useMemo(() => {
    const map = new Map<string, ReminderRunDoc["state"]>();
    reminderRuns.forEach((entry) => {
      map.set(`${entry.habitId}:${entry.date}`, entry.state);
    });
    return map;
  }, [reminderRuns]);
  const historyWeeksCount = useMemo(() => {
    if (historyRange === "30d") return 5;
    if (historyRange === "90d") return 13;
    if (historyRange === "365d") return 52;
    if (historyHabits.length === 0) return 8;

    let earliestStart = historyHabits[0]?.createdAt ?? Date.now();
    historyHabits.forEach((habit) => {
      if (habit.createdAt < earliestStart) {
        earliestStart = habit.createdAt;
      }
    });

    const earliestWeekStart = getStartOfWeek(new Date(earliestStart));
    const currentWeekStart = getStartOfWeek(referenceDate);
    const dayDiff = Math.floor(
      (currentWeekStart.getTime() - earliestWeekStart.getTime()) /
        (24 * 60 * 60 * 1000),
    );
    const weeks = Math.floor(dayDiff / 7) + 1;
    return Math.max(8, Math.min(weeks, 104));
  }, [historyHabits, historyRange, referenceDate]);
  const historyWeeks = useMemo(() => {
    const todayDateKey = toDateKey(referenceDate);
    const currentWeekStart = getStartOfWeek(referenceDate);

    const resolveHistoryDayStatus = (date: Date, dayKey: string) => {
      const dateKey = toDateKey(date);
      const dateTs = date.getTime();
      const isFuture = dateKey > todayDateKey;
      if (isFuture) return "future" as const;
      if (
        historyRangeStartTs !== null &&
        date.getTime() < historyRangeStartTs
      ) {
        return "rest" as const;
      }

      const scheduledHabits = historyHabits.filter((habit) => {
        const startTs = habitStartById.get(habit._id) ?? 0;
        if (dateTs < startTs) {
          return false;
        }
        return habit.targetDays.includes(dayKey);
      });

      const hasStartedHabitInScope = historyHabits.some((habit) => {
        const startTs = habitStartById.get(habit._id) ?? 0;
        return dateTs >= startTs;
      });

      if (!hasStartedHabitInScope) {
        return "inactive" as const;
      }

      if (scheduledHabits.length === 0) {
        return "rest" as const;
      }

      let hasMiss = false;
      let hasPending = false;
      let completed = 0;
      let skipped = 0;

      scheduledHabits.forEach((habit) => {
        const key = `${habit._id}:${dateKey}`;
        const checkIn = checkInByHabitDate.get(key);
        if (checkIn?.status === "missed") {
          hasMiss = true;
          return;
        }
        if (checkIn?.status === "completed" || checkIn?.status === "bonus") {
          completed += 1;
          return;
        }

        const isSkipped =
          skipByHabitDate.has(key) ||
          reminderRunByHabitDate.get(key) === "skipped";
        if (isSkipped) {
          skipped += 1;
          return;
        }

        hasPending = true;
      });

      if (hasMiss) return "missed" as const;
      if (hasPending) {
        return dateKey === todayDateKey
          ? ("pending" as const)
          : ("missed" as const);
      }
      if (completed > 0) return "perfect" as const;
      if (skipped === scheduledHabits.length && scheduledHabits.length > 0) {
        return "skipped" as const;
      }
      return "rest" as const;
    };

    return Array.from({ length: historyWeeksCount }, (_, index) => {
      const weekOffset = historyWeeksCount - index - 1;
      const weekStartDate = new Date(currentWeekStart);
      weekStartDate.setDate(currentWeekStart.getDate() - weekOffset * 7);
      weekStartDate.setHours(0, 0, 0, 0);

      const days = DAYS.map((day, dayIndex) => {
        const date = new Date(weekStartDate);
        date.setDate(weekStartDate.getDate() + dayIndex);
        const dateKey = toDateKey(date);

        return {
          date,
          dateKey,
          dayLabel: day.label,
          status: resolveHistoryDayStatus(date, day.key),
        };
      });

      return {
        weekStartLabel: formatWorkoutDate(weekStartDate.getTime()),
        days,
      };
    });
  }, [
    checkInByHabitDate,
    habitStartById,
    historyHabits,
    historyRangeStartTs,
    historyWeeksCount,
    referenceDate,
    reminderRunByHabitDate,
    skipByHabitDate,
  ]);
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

  const completedCount = weeklyCheckIns.filter(
    (entry) => entry.status === "completed",
  ).length;
  const missedCount = weeklyCheckIns.filter(
    (entry) => entry.status === "missed",
  ).length;
  const bonusCount = weeklyCheckIns.filter(
    (entry) => entry.status === "bonus",
  ).length;
  const totalWeeklyTarget = activeHabits.reduce(
    (acc, habit) => acc + habit.targetDays.length,
    0,
  );

  const completedJudgement =
    completedCount >= totalWeeklyTarget / 2 ? "Holding" : "Behind";
  const missedJudgement = missedCount === 0 ? "Clean" : "You broke it";
  const bonusJudgement = bonusCount > 0 ? "Pushed extra" : "Solid";

  const todayStr = toDateKey(referenceDate);
  const todayDayKey = getTodayKey(referenceDate);
  const todayCheckIns = weeklyCheckIns.filter((c) => c.date === todayStr);

  let missedTodayCount = 0;
  let pendingTodayCount = 0;

  activeHabits.forEach((habit) => {
    const snapshot = getHabitPressureSnapshot(
      habit,
      todayDayKey,
      todayStr,
      todayCheckIns,
      weeklyReminders,
      referenceDate,
    );
    if (
      snapshot.state === "missed" ||
      (snapshot.state === "deadline-risk" &&
        (snapshot.countdownMinutes ?? 1) <= 0)
    ) {
      missedTodayCount++;
    } else if (
      ["upcoming", "due-soon", "deadline-risk"].includes(snapshot.state)
    ) {
      pendingTodayCount++;
    }
  });

  const todayFocusLabel =
    missedTodayCount > 0
      ? `TODAY: ${missedTodayCount} MISS. FIX IT.`
      : pendingTodayCount > 0
        ? `TODAY: ${pendingTodayCount} PENDING.`
        : "TODAY: ALL CLEAR";

  let weekMisses = 0;

  const boxes = weekDays.map((day) => {
    const isFuture = day.dateKey > todayStr;
    const isToday = day.dateKey === todayStr;
    const dayTs = day.date.getTime();

    // Only include habits that existed on this day (guard for new users).
    const scheduled = activeHabits.filter((h) => {
      const startTs = habitStartById.get(h._id) ?? 0;
      if (dayTs < startTs) return false;
      return h.targetDays.includes(day.key);
    });

    // If no habit had started yet on this day, mark as inactive (not missed).
    const anyHabitStartedByDay = activeHabits.some((h) => {
      const startTs = habitStartById.get(h._id) ?? 0;
      return dayTs >= startTs;
    });
    if (!anyHabitStartedByDay) return { day, status: "inactive" as const };

    if (scheduled.length === 0) return { day, status: "rest" as const };

    let hasMiss = false;
    let hasPending = false;
    let completed = 0;

    scheduled.forEach((habit) => {
      const cellState = getWeeklyCellState(
        habit,
        day,
        weeklyCheckIns,
        weeklySkips,
        weeklyReminderRuns,
        weeklyReminders,
      ).state;
      if (cellState === "missed") hasMiss = true;
      else if (cellState === "scheduled") hasPending = true;
      else if (cellState === "completed" || cellState === "bonus") completed++;
    });

    if (isToday && missedTodayCount > 0) hasMiss = true;
    if (isFuture) return { day, status: "future" as const };
    if (!isToday && hasPending) hasMiss = true;

    if (hasMiss) {
      weekMisses++;
      return { day, status: "missed" as const };
    }
    if (isToday && hasPending) return { day, status: "pending" as const };
    if (completed === scheduled.length && scheduled.length > 0)
      return { day, status: "perfect" as const };
    return { day, status: "rest" as const };
  });

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="brutal-meta">Readout</p>
        <h2 className="text-4xl font-black uppercase tracking-[-0.08em]">
          Stats
        </h2>
        <p className="text-sm uppercase tracking-[0.12em] text-muted-foreground">
          System performance feedback and recent habit logs.
        </p>
        <div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsHistoryOpen(true)}
          >
            <CalendarDays />
            Open History
          </Button>
        </div>
      </div>

      {isMobile ? (
        <Drawer open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
          <DrawerContent className="max-h-[85vh]">
            <div className="mx-auto w-full max-w-sm">
              <DrawerHeader>
                <DrawerTitle className="text-2xl font-black uppercase tracking-[-0.05em]">
                  History Calendar
                </DrawerTitle>
                <DrawerDescription className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  MTWTFSS snapshot for{" "}
                  {formatStatsRangeLabel(historyRange).toLowerCase()}.
                </DrawerDescription>
              </DrawerHeader>
              <div className="px-4 pb-8">
                <HistoryContent
                  historyRange={historyRange}
                  setHistoryRange={setHistoryRange}
                  historyHabitId={historyHabitId}
                  setHistoryHabitId={setHistoryHabitId}
                  activeHabits={activeHabits}
                  historyWeeks={historyWeeks}
                  scrollAreaClassName="max-h-[50vh]"
                />
              </div>
            </div>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
          <DialogContent className="sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle className="text-3xl font-black uppercase tracking-[-0.05em]">
                History Calendar
              </DialogTitle>
              <DialogDescription className="text-sm font-bold uppercase tracking-[0.12em] text-muted-foreground">
                MTWTFSS snapshot for{" "}
                {formatStatsRangeLabel(historyRange).toLowerCase()}.
              </DialogDescription>
            </DialogHeader>
            <HistoryContent
              historyRange={historyRange}
              setHistoryRange={setHistoryRange}
              historyHabitId={historyHabitId}
              setHistoryHabitId={setHistoryHabitId}
              activeHabits={activeHabits}
              historyWeeks={historyWeeks}
              scrollAreaClassName="max-h-[58vh]"
            />
          </DialogContent>
        </Dialog>
      )}

      <div className="grid gap-6 border-b-2 border-black pb-8 pt-4 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-4">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Today Focus
          </p>
          <h3
            className={`text-4xl font-black uppercase tracking-[-0.05em] sm:text-5xl ${missedTodayCount > 0 ? "text-[#DF3B23]" : "text-foreground"}`}
          >
            {todayFocusLabel}
          </h3>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">
            This panel should answer the week in one glance: where you missed,
            where you are clean, and whether today is still salvageable.
          </p>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-7 gap-1 sm:gap-2">
            {boxes.map(({ day, status }) => {
              const isToday = day.dateKey === todayStr;
              const style =
                status === "missed"
                  ? "bg-[#DF3B23] text-white border-black shadow-[2px_2px_0px_0px_rgba(26,24,20,0.18)] sm:shadow-[4px_4px_0px_0px_rgba(26,24,20,0.18)]"
                  : status === "perfect"
                    ? "bg-black text-white border-black"
                    : status === "pending"
                      ? "bg-background text-foreground border-black border-[2px] sm:border-[3px]"
                      : status === "future"
                        ? "bg-background text-transparent border-dashed border-black/30"
                        : status === "inactive"
                          ? "bg-background text-transparent border-dashed border-black/15 opacity-40"
                          : "bg-secondary text-muted-foreground/70 border-black/20";

              const todayMarker = isToday
                ? "ring-[2px] ring-foreground ring-offset-1 ring-offset-background sm:ring-[3px] sm:ring-offset-2"
                : "";

              return (
                <div
                  key={day.dateKey}
                  className={`flex aspect-square flex-col items-center justify-center border-2 p-1 font-bold uppercase transition-transform hover:scale-105 sm:aspect-auto sm:min-h-20 sm:p-2 ${style} ${todayMarker}`}
                >
                  <div className="flex w-full items-start justify-between sm:mb-auto">
                    <span className="text-[8px] sm:text-[10px]">
                      {day.label.charAt(0)}
                    </span>
                    <span className="hidden text-[9px] opacity-70 sm:inline">
                      {day.dateKey.slice(8)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[8px] font-black tracking-tighter sm:mt-auto sm:text-xs sm:tracking-[0.16em]">
                    {status === "missed"
                      ? "MISS"
                      : status === "perfect"
                        ? "DONE"
                        : status === "pending"
                          ? "LIVE"
                          : status === "future" || status === "inactive"
                            ? "--"
                            : "REST"}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2 text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground sm:text-[11px] sm:tracking-[0.18em]">
            <span className="border-2 border-black bg-background px-2.5 py-1.5 sm:px-3 sm:py-2">
              Status:{" "}
              {weekMisses === 0
                ? "Clean"
                : `${weekMisses} miss${weekMisses > 1 ? "es" : ""}`}
            </span>
            <span className="border-2 border-black bg-background px-2.5 py-1.5 sm:px-3 sm:py-2">
              Pending: {pendingTodayCount}
            </span>
            <span className="border-2 border-black bg-background px-2.5 py-1.5 sm:px-3 sm:py-2">
              Missed: {missedTodayCount}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div
          className={`border-2 p-3 sm:p-5 ${missedCount > 0 ? "bg-background border-[#DF3B23] border-2 sm:border-[3px]" : "border-black bg-background"}`}
        >
          <p
            className={`line-clamp-1 text-[10px] sm:text-xs font-bold uppercase tracking-widest ${missedCount > 0 ? "text-[#DF3B23]" : "text-muted-foreground"}`}
          >
            Missed
          </p>
          <div className="flex flex-col">
            <p
              className={`mt-1 sm:mt-2 font-black ${missedCount > 0 ? "text-3xl sm:text-5xl text-[#DF3B23]" : "text-2xl sm:text-4xl text-foreground"}`}
            >
              {missedCount}
            </p>
            <p
              className={`mt-1 line-clamp-1 text-[8px] sm:text-[10px] font-bold uppercase tracking-widest ${missedCount > 0 ? "text-[#DF3B23]" : "text-muted-foreground"}`}
            >
              {missedCount > 0 ? missedJudgement : "Clean"}
            </p>
          </div>
        </div>

        <div className="border-2 border-black bg-background p-3 sm:p-5">
          <p className="line-clamp-1 text-[10px] sm:text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Best Streak
          </p>
          <div className="flex flex-col">
            <p className="mt-1 sm:mt-2 text-2xl sm:text-4xl font-black">
              {bestStreak}
            </p>
            <p className="mt-1 line-clamp-1 text-[8px] sm:text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Highest
            </p>
          </div>
        </div>

        <div className="border-2 border-black bg-background p-3 sm:p-5">
          <p className="line-clamp-1 text-[10px] sm:text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Completed
          </p>
          <div className="flex flex-col">
            <p className="mt-1 sm:mt-2 text-2xl sm:text-4xl font-black">
              {completedCount}
            </p>
            <p className="mt-1 line-clamp-1 text-[8px] sm:text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {completedJudgement}
            </p>
          </div>
        </div>

        <div className="border-2 border-black bg-background p-3 sm:p-5">
          <p className="line-clamp-1 text-[10px] sm:text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Bonus
          </p>
          <div className="flex flex-col">
            <p className="mt-1 sm:mt-2 text-2xl sm:text-4xl font-black">
              {bonusCount}
            </p>
            <p className="mt-1 line-clamp-1 text-[8px] sm:text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {bonusJudgement}
            </p>
          </div>
        </div>
      </div>

      {latestReport ? (
        <Card className="border-2 border-black bg-secondary shadow-[8px_8px_0px_0px_rgba(26,24,20,1)]">
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
                weeklySkips={weeklySkips}
                weeklyReminderRuns={weeklyReminderRuns}
                weeklyReminders={weeklyReminders}
                referenceDate={referenceDate}
              />

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm uppercase tracking-[0.25em] text-muted-foreground">
                    Recent habit logs
                  </p>
                </div>
                {recentLogs.length === 0 ? (
                  <div className="border-2 border-dashed border-black bg-background p-4 text-sm uppercase tracking-[0.12em] text-muted-foreground">
                    No recent logs yet for this habit.
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
  allHabitSkips,
  allReminderRuns,
  allReminders,
  allWorkoutLogs,
  referenceDate,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  habit: HabitDoc | null;
  allCheckIns: CheckInDoc[];
  allHabitSkips: HabitSkipDoc[];
  allReminderRuns: ReminderRunDoc[];
  allReminders: ReminderDoc[];
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
  const isMobile = useIsMobile();

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
  const weekDateKeys = new Set(weekDays.map((day) => day.dateKey));
  const habitCheckIns = allCheckIns
    .filter((entry) => entry.habitId === habit._id)
    .sort((left, right) => right.timestamp - left.timestamp);
  const weeklyCheckIns = habitCheckIns.filter(
    (entry) => entry.timestamp >= weekStartTs && entry.timestamp <= weekEndTs,
  );
  const weeklySkips = allHabitSkips.filter(
    (entry) => entry.habitId === habit._id && weekDateKeys.has(entry.date),
  );
  const weeklyReminderRuns = allReminderRuns.filter(
    (entry) => entry.habitId === habit._id && weekDateKeys.has(entry.date),
  );
  const weeklyReminders = allReminders.filter(
    (entry) => entry.habitId === habit._id && weekDateKeys.has(entry.date),
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

  const detailHeader = (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-3">
        <p className="brutal-meta">Habit Detail</p>
        <h2 className="text-3xl font-black uppercase tracking-[-0.08em] sm:text-4xl">
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
      <div className="hidden items-center gap-2 sm:flex">
        <Button
          type="button"
          variant="outline"
          onClick={() => setIsEditing((current) => !current)}
        >
          <PencilLine />
          {isEditing ? "Cancel edit" : "Edit"}
        </Button>
        <Button type="button" variant="outline" size="icon" onClick={onClose}>
          <X />
        </Button>
      </div>
    </div>
  );

  const detailBody = (
    <div className="mt-4 grid gap-4 sm:mt-6 sm:gap-6">
      <div className="flex gap-2 sm:hidden">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={() => setIsEditing((current) => !current)}
        >
          <PencilLine />
          {isEditing ? "Cancel" : "Edit"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          onClick={onClose}
        >
          <X />
        </Button>
      </div>

      <div className="grid gap-4 sm:gap-6">
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
                  onChange={(event) => updateForm("rules", event.target.value)}
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
              <p className="mt-2 text-2xl font-black">{habit.scheduledTime}</p>
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
                  <Badge
                    key={`${habit._id}-detail-${day}`}
                    variant="outline"
                    className="border-foreground/55 bg-foreground/12 text-foreground"
                  >
                    {toTitleDay(day)}
                  </Badge>
                ))}
              </div>
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
              weeklySkips={weeklySkips}
              weeklyReminderRuns={weeklyReminderRuns}
              weeklyReminders={weeklyReminders}
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
            <CardTitle className="text-2xl">Recent Logs</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {recentLogs.length === 0 ? (
              <div className="border-2 border-dashed border-black bg-card p-4 text-sm uppercase tracking-[0.12em] text-muted-foreground">
                No recent logs yet for this habit.
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
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
        <DrawerContent className="max-h-[88vh] border-2 border-black bg-card">
          <DrawerHeader className="px-4 pb-0 pt-2 text-left">
            <DrawerTitle className="sr-only">Habit Detail</DrawerTitle>
            <DrawerDescription className="sr-only">
              Habit detail and editing controls.
            </DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-2">
            {detailHeader}
            {detailBody}
          </div>
        </DrawerContent>
      </Drawer>
    );
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
        {detailHeader}
        {detailBody}
      </aside>
    </div>
  );
}

function ProfileTab({
  email,
  tier,
  aiDisabled,
  budgetStatus,
  weeklyStats,
  habits,
  checkIns,
  aiTogglePending,
  notificationPermission,
  notificationsEnabled,
  notificationPending,
  upgradePending,
  onEnableNotifications,
  onUpgrade,
  onToggleAiDisabled,
  theme,
  onToggleTheme,
  canUpgrade,
}: {
  email: string;
  tier: "free" | "pro";
  aiDisabled: boolean;
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
  aiTogglePending: boolean;
  notificationPermission: NotificationPermissionState;
  notificationsEnabled: boolean;
  notificationPending: boolean;
  upgradePending: boolean;
  onEnableNotifications: () => Promise<void>;
  onUpgrade: () => Promise<void>;
  onToggleAiDisabled: () => Promise<void>;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  canUpgrade: boolean;
}) {
  const activeHabits = habits.filter((habit) => habit.isActive);
  const bestStreak = Math.max(
    0,
    ...activeHabits.map((habit) => habit.bestStreak),
  );

  const completedCount = weeklyStats.completed;
  const missedCount = weeklyStats.missed;
  const bonusCount = weeklyStats.bonus;
  const totalWeeklyTarget = activeHabits.reduce(
    (acc, habit) => acc + habit.targetDays.length,
    0,
  );

  const completedJudgement =
    completedCount >= totalWeeklyTarget / 2 ? "Holding" : "Behind";
  const missedJudgement = missedCount === 0 ? "Clean" : "You broke it";
  const bonusJudgement = bonusCount > 0 ? "Pushed extra" : "Solid";

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

      <div className="grid gap-6 lg:grid-cols-[1fr_0.95fr]">
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
          <CardContent className="space-y-5 text-sm text-muted-foreground">
            <section className="space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
                Account and plan
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="border-2 border-black bg-background px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    Current tier
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-lg font-black text-foreground">
                      {tier.toUpperCase()}
                    </span>
                    <Badge className="bg-black text-white">Live</Badge>
                  </div>
                </div>
                <div className="border-2 border-black bg-background px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    AI mode
                  </p>
                  <p className="mt-2 text-lg font-black text-foreground">
                    {aiDisabled ? "Disabled" : "Enabled"}
                  </p>
                </div>
              </div>
              {canUpgrade ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={upgradePending}
                    onClick={() => void onUpgrade()}
                  >
                    {upgradePending ? "Redirecting..." : "Upgrade to Pro"}
                  </Button>
                </div>
              ) : null}
            </section>

            <section className="space-y-3 border-t-2 border-black pt-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
                Usage and system
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="border-2 border-black bg-background px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    Daily messages used
                  </p>
                  <p className="mt-2 text-lg font-black text-foreground">
                    {budgetStatus?.isUnlimited
                      ? "Unlimited"
                      : `${budgetStatus?.dailyMessageCount ?? 0}/${budgetStatus?.dailyMessageCap ?? 20}`}
                  </p>
                </div>
                <div className="border-2 border-black bg-background px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    Messages remaining
                  </p>
                  <p className="mt-2 text-lg font-black text-foreground">
                    {budgetStatus?.isUnlimited
                      ? "Unlimited"
                      : (budgetStatus?.remainingMessages ?? 20)}
                  </p>
                </div>
                <div className="border-2 border-black bg-background px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    Reminder notifications
                  </p>
                  <p className="mt-2 text-lg font-black text-foreground">
                    {notificationPermission === "unsupported"
                      ? "Unsupported"
                      : notificationsEnabled
                        ? "Enabled"
                        : notificationPermission === "denied"
                          ? "Blocked"
                          : "Disabled"}
                  </p>
                </div>
                <div className="border-2 border-black bg-background px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    Theme mode
                  </p>
                  <p className="mt-2 text-lg font-black text-foreground">
                    {theme}
                  </p>
                </div>
              </div>
            </section>

            <section className="space-y-3 border-t-2 border-black pt-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
                Controls
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={onToggleTheme}>
                  {theme === "dark" ? <SunMedium /> : <MonitorCog />}
                  {theme === "dark" ? "Switch to Light" : "Switch to Dark"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    notificationPending ||
                    notificationPermission === "unsupported"
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
              </div>
              {IS_DEV_MODE ? (
                <div className="border-2 border-dashed border-black bg-background p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    Dev tools
                  </p>
                  <div className="mt-3">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={aiTogglePending}
                      onClick={() => void onToggleAiDisabled()}
                    >
                      {aiTogglePending
                        ? "Saving..."
                        : aiDisabled
                          ? "Enable AI"
                          : "Disable AI"}
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Stats Readout</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-2">
            <div
              className={`border-2 p-3 sm:p-5 ${missedCount > 0 ? "bg-background border-[#DF3B23] border-2 sm:border-[3px]" : "border-black bg-background"}`}
            >
              <p
                className={`line-clamp-1 text-[10px] sm:text-xs font-bold uppercase tracking-widest ${missedCount > 0 ? "text-[#DF3B23]" : "text-muted-foreground"}`}
              >
                Missed
              </p>
              <div className="flex flex-col">
                <p
                  className={`mt-1 sm:mt-2 font-black ${missedCount > 0 ? "text-3xl sm:text-5xl text-[#DF3B23]" : "text-2xl sm:text-4xl text-foreground"}`}
                >
                  {missedCount}
                </p>
                <p
                  className={`mt-1 line-clamp-1 text-[8px] sm:text-[10px] font-bold uppercase tracking-widest ${missedCount > 0 ? "text-[#DF3B23]" : "text-muted-foreground"}`}
                >
                  {missedCount > 0 ? missedJudgement : "Clean"}
                </p>
              </div>
            </div>

            <div className="border-2 border-black bg-background p-3 sm:p-5">
              <p className="line-clamp-1 text-[10px] sm:text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Best Streak
              </p>
              <div className="flex flex-col">
                <p className="mt-1 sm:mt-2 text-2xl sm:text-4xl font-black">
                  {bestStreak}
                </p>
                <p className="mt-1 line-clamp-1 text-[8px] sm:text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Highest
                </p>
              </div>
            </div>

            <div className="border-2 border-black bg-background p-3 sm:p-5">
              <p className="line-clamp-1 text-[10px] sm:text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Completed
              </p>
              <div className="flex flex-col">
                <p className="mt-1 sm:mt-2 text-2xl sm:text-4xl font-black">
                  {completedCount}
                </p>
                <p className="mt-1 line-clamp-1 text-[8px] sm:text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {completedJudgement}
                </p>
              </div>
            </div>

            <div className="border-2 border-black bg-background p-3 sm:p-5">
              <p className="line-clamp-1 text-[10px] sm:text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Bonus
              </p>
              <div className="flex flex-col">
                <p className="mt-1 sm:mt-2 text-2xl sm:text-4xl font-black">
                  {bonusCount}
                </p>
                <p className="mt-1 line-clamp-1 text-[8px] sm:text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {bonusJudgement}
                </p>
              </div>
            </div>

            <div className="border-2 border-black bg-background p-3 sm:p-5">
              <p className="line-clamp-1 text-[10px] sm:text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Active
              </p>
              <div className="flex flex-col">
                <p className="mt-1 sm:mt-2 text-2xl sm:text-4xl font-black">
                  {activeHabits.length}
                </p>
                <p className="mt-1 line-clamp-1 text-[8px] sm:text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Habits
                </p>
              </div>
            </div>

            <div className="border-2 border-black bg-background p-3 sm:p-5">
              <p className="line-clamp-1 text-[10px] sm:text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Lifetime
              </p>
              <div className="flex flex-col">
                <p className="mt-1 sm:mt-2 text-2xl sm:text-4xl font-black">
                  {checkIns.length}
                </p>
                <p className="mt-1 line-clamp-1 text-[8px] sm:text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Logs
                </p>
              </div>
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
  const pushSyncAttempted = useRef(false);
  const [now, setNow] = useState(() => new Date());
  const [activeTab, setActiveTab] = useState<AppTab>("home");
  const [pendingHabitId, setPendingHabitId] = useState<string | null>(null);
  const [aiTogglePending, setAiTogglePending] = useState(false);
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
  const [upgradePending, setUpgradePending] = useState(false);

  const syncUser = useMutation(api.users.syncUser);
  const updateProfile = useMutation(api.users.updateProfile);
  const refreshDailyMessageBudget = useMutation(
    api.users.refreshDailyMessageBudget,
  );
  const createHabit = useMutation(api.habits.create);
  const updateHabit = useMutation(api.habits.update);
  const deleteHabit = useMutation(api.habits.remove);
  const createAgentTask = useMutation(api.agentTasks.create);
  const markAgentTaskDone = useMutation(api.agentTasks.markDone);
  const createCheckIn = useMutation(api.checkIns.create);
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
  const habitSkips = useQuery(
    api.habitSkips.listByUser,
    convexUser ? { userId: convexUser._id } : "skip",
  );
  const reminderRuns = useQuery(
    api.reminders.listRunsByUser,
    convexUser ? { userId: convexUser._id } : "skip",
  );
  const reminders = useQuery(
    api.reminders.listByUser,
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
  const agentTasks = useQuery(
    api.agentTasks.listByUser,
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
  const resolvedHabitSkips = useMemo(() => habitSkips ?? [], [habitSkips]);
  const resolvedReminderRuns = useMemo(
    () => reminderRuns ?? [],
    [reminderRuns],
  );
  const resolvedReminders = useMemo(() => reminders ?? [], [reminders]);
  const resolvedWorkoutLogs = useMemo(() => workoutLogs ?? [], [workoutLogs]);
  const resolvedWeeklyReports = useMemo(
    () => weeklyReports ?? [],
    [weeklyReports],
  );
  const resolvedMessages = useMemo(() => messages ?? [], [messages]);
  const resolvedAgentTasks = useMemo(() => agentTasks ?? [], [agentTasks]);
  const resolvedMessageBudgetStatus = messageBudgetStatus ?? null;
  const latestWeeklyReport = resolvedWeeklyReports[0] ?? null;
  const selectedHabit =
    resolvedHabits.find((habit: HabitDoc) => habit._id === selectedHabitId) ??
    null;
  const reminderMessages = resolvedMessages.filter(
    (message: MessageDoc) =>
      message.role === "ai" && isReminderIntent(message.intent),
  );
  const latestReminderTimestamp =
    reminderMessages.length > 0
      ? Math.max(
          ...reminderMessages.map((message: MessageDoc) => message.timestamp),
        )
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
      resolvedHabits.map((habit: HabitDoc) =>
        getHabitPressureSnapshot(
          habit,
          todayKey,
          todayDate,
          resolvedTodayCheckIns,
          resolvedReminders,
          now,
        ),
      ),
    [
      now,
      resolvedHabits,
      resolvedReminders,
      resolvedTodayCheckIns,
      todayDate,
      todayKey,
    ],
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
      (habit: HabitDoc) => habit._id === selectedHabitId,
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

    await updateProfile({
      userId: convexUser._id,
      aiPersonality: ONBOARDING_PERSONALITY,
      onboardingCompleted: true,
    });
  }

  async function createTaskFromForm(form: TaskFormState) {
    if (!convexUser) return;

    const reminderOffsetMinutes = Math.max(
      0,
      Number.parseInt(form.reminderOffsetMinutes, 10) || 30,
    );

    await createAgentTask({
      userId: convexUser._id,
      title: form.title.trim(),
      date: form.date,
      time: form.time,
      reminderOffsetMinutes,
    });
  }

  async function logCheckInStatus(
    habit: HabitDoc | undefined,
    status: "completed" | "missed" | "bonus",
    source: "dashboard_quick" | "chat",
  ) {
    if (!convexUser || !habit) return;

    const existing = resolvedTodayCheckIns.find(
      (entry: Doc<"checkIns">) => entry.habitId === habit._id,
    );
    if (existing) return;

    setPendingHabitId(habit._id);
    try {
      const aiResponse = `[dashboard_quick_${status}]`;

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
    if (typeof window !== "undefined" && navigator.vibrate) {
      navigator.vibrate([100, 50, 100]); // Haptic dopamine stamp
    }
    await logCheckInStatus(habit, "completed", "dashboard_quick");
  }

  async function handleLogMiss(habit: HabitDoc) {
    if (typeof window !== "undefined" && navigator.vibrate) {
      navigator.vibrate([200]); // Heavy single vibration for failure
    }
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

  async function handleMarkTaskDone(task: AgentTaskDoc) {
    await markAgentTaskDone({ taskId: task._id });
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
    setChatInput("");
    try {
      setChatErrorMessage(null);
      await sendChatMessage({
        content,
        source: "chat_input",
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to send message right now.";
      setChatInput(content);
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

  async function handleUpgrade() {
    setUpgradePending(true);

    try {
      const response = await fetch("/api/billing/upgrade", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: "{}",
      });

      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        reason?: string;
        url?: string;
      } | null;

      if (!response.ok || !payload?.url) {
        window.location.href = "/plans";
        return;
      }

      window.location.href = payload.url;
    } finally {
      setUpgradePending(false);
    }
  }

  async function handleToggleAiDisabled() {
    if (!convexUser) return;

    setAiTogglePending(true);
    try {
      await updateProfile({
        userId: convexUser._id,
        aiDisabled: !Boolean(convexUser.aiDisabled),
      });
    } finally {
      setAiTogglePending(false);
    }
  }

  function handleHighlightCardAction(card: HighlightAlertCard) {
    if (card.kind === "habit") {
      setChatInput(card.snapshot.chatPrompt);
    } else {
      const taskTime = card.task.time ? ` at ${card.task.time}` : "";
      setChatInput(
        `Help me execute this task: ${card.task.title} on ${card.task.date}${taskTime}.`,
      );
    }
    setActiveTab("chat");
  }

  if (
    !isLoaded ||
    convexUser === undefined ||
    habits === undefined ||
    habitSkips === undefined ||
    reminderRuns === undefined ||
    agentTasks === undefined
  ) {
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
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6 sm:py-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:gap-8">
        <section className="border-2 border-black bg-card p-3 shadow-[8px_8px_0px_0px_rgba(26,24,20,1)] sm:p-6 lg:p-8">
          <SummaryStatusCard
            snapshots={habitSnapshots}
            tasks={resolvedAgentTasks}
            scheduledToday={scheduledToday}
            completedToday={completedToday}
            subscriptionTier={convexUser.subscriptionTier}
            currentTime={now}
            onPrimaryAction={handleHighlightCardAction}
            onTaskMarkDone={handleMarkTaskDone}
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
            onCreateTask={createTaskFromForm}
          />
        ) : null}

        {activeTab === "chat" ? (
          <ChatTab
            messages={resolvedMessages}
            primarySnapshot={primaryHabitSnapshot}
            budgetStatus={resolvedMessageBudgetStatus}
            notificationPermission={notificationPermission}
            notificationsEnabled={notificationsEnabled}
            notificationPending={notificationPending}
            errorMessage={chatErrorMessage}
            input={chatInput}
            setInput={setChatInput}
            sending={chatSending}
            upgradePending={upgradePending}
            onSend={handleSendMessage}
            onQuickComplete={handleQuickComplete}
            onQuickMiss={handleQuickMiss}
            onEnableNotifications={handleEnableNotifications}
            onUpgrade={handleUpgrade}
            canUpgrade={convexUser.subscriptionTier !== "pro"}
          />
        ) : null}

        {activeTab === "stats" ? (
          <StatsTab
            habits={resolvedHabits}
            checkIns={resolvedAllCheckIns}
            habitSkips={resolvedHabitSkips}
            reminderRuns={resolvedReminderRuns}
            reminders={resolvedReminders}
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
            aiDisabled={Boolean(convexUser.aiDisabled)}
            budgetStatus={resolvedMessageBudgetStatus}
            weeklyStats={weeklyStats}
            habits={resolvedHabits}
            checkIns={resolvedAllCheckIns}
            aiTogglePending={aiTogglePending}
            notificationPermission={notificationPermission}
            notificationsEnabled={notificationsEnabled}
            notificationPending={notificationPending}
            upgradePending={upgradePending}
            onEnableNotifications={handleEnableNotifications}
            onUpgrade={handleUpgrade}
            onToggleAiDisabled={handleToggleAiDisabled}
            theme={theme}
            onToggleTheme={toggleTheme}
            canUpgrade={convexUser.subscriptionTier !== "pro"}
          />
        ) : null}
      </div>

      <HabitDetailPanel
        key={selectedHabit?._id ?? "no-habit"}
        open={Boolean(selectedHabit)}
        habit={selectedHabit}
        allCheckIns={resolvedAllCheckIns}
        allHabitSkips={resolvedHabitSkips}
        allReminderRuns={resolvedReminderRuns}
        allReminders={resolvedReminders}
        allWorkoutLogs={resolvedWorkoutLogs}
        referenceDate={now}
        saving={detailSaving}
        onClose={() => setSelectedHabitId(null)}
        onSave={handleSaveHabitDetail}
      />

      <nav
        className="fixed inset-x-0 bottom-0 z-[100] bg-transparent px-4 pt-4"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
      >
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
