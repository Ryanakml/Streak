/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as agentActions from "../agentActions.js";
import type * as agentMemory from "../agentMemory.js";
import type * as agentModelRuns from "../agentModelRuns.js";
import type * as agentTasks from "../agentTasks.js";
import type * as chat from "../chat.js";
import type * as chatAction from "../chatAction.js";
import type * as checkIns from "../checkIns.js";
import type * as crons from "../crons.js";
import type * as devSeeds from "../devSeeds.js";
import type * as habitSkips from "../habitSkips.js";
import type * as habits from "../habits.js";
import type * as messages from "../messages.js";
import type * as modelProvider from "../modelProvider.js";
import type * as notifications from "../notifications.js";
import type * as notificationsAction from "../notificationsAction.js";
import type * as reminders from "../reminders.js";
import type * as users from "../users.js";
import type * as weeklyReports from "../weeklyReports.js";
import type * as weeklyReviewAction from "../weeklyReviewAction.js";
import type * as workoutLogs from "../workoutLogs.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  agentActions: typeof agentActions;
  agentMemory: typeof agentMemory;
  agentModelRuns: typeof agentModelRuns;
  agentTasks: typeof agentTasks;
  chat: typeof chat;
  chatAction: typeof chatAction;
  checkIns: typeof checkIns;
  crons: typeof crons;
  devSeeds: typeof devSeeds;
  habitSkips: typeof habitSkips;
  habits: typeof habits;
  messages: typeof messages;
  modelProvider: typeof modelProvider;
  notifications: typeof notifications;
  notificationsAction: typeof notificationsAction;
  reminders: typeof reminders;
  users: typeof users;
  weeklyReports: typeof weeklyReports;
  weeklyReviewAction: typeof weeklyReviewAction;
  workoutLogs: typeof workoutLogs;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
