import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fromZonedTime } from "date-fns-tz";
import { SUITES, SUITE_IDS } from "./agent-eval-suite-catalog.mjs";

const DEFAULT_LIMIT_PER_COLLECTION = 50;
const DEFAULT_CONVEX_MAX_ATTEMPTS = 4;
const DEFAULT_RETRY_BASE_MS = 2500;
const DEFAULT_RETRY_MAX_MS = 20000;
const DEFAULT_RETRY_JITTER_MS = 400;
const DEFAULT_CASE_DELAY_MS = 1200;
const DEFAULT_SUITE_DELAY_MS = 2500;

const runtimeConfig = {
  convexMaxAttempts: DEFAULT_CONVEX_MAX_ATTEMPTS,
  retryBaseMs: DEFAULT_RETRY_BASE_MS,
  retryMaxMs: DEFAULT_RETRY_MAX_MS,
  retryJitterMs: DEFAULT_RETRY_JITTER_MS,
  caseDelayMs: DEFAULT_CASE_DELAY_MS,
  suiteDelayMs: DEFAULT_SUITE_DELAY_MS,
};

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    const isQuoted =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"));
    const value = isQuoted
      ? rawValue.replace(/^['"]|['"]$/g, "")
      : rawValue.split(" #")[0].trim();

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function normalizeEnvValue(key) {
  const value = process.env[key];
  if (!value) {
    return;
  }

  process.env[key] = value.trim();
}

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] ?? null;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function parseIntegerArg(flag, fallback) {
  const raw = getArg(flag);
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid integer for ${flag}: ${raw}`);
  }

  return parsed;
}

function sleepSync(ms) {
  if (ms <= 0) {
    return;
  }

  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function randomJitter(maxMs) {
  if (maxMs <= 0) {
    return 0;
  }

  return Math.floor(Math.random() * (maxMs + 1));
}

function isRetryableConvexFailure(detail) {
  const text = String(detail ?? "").toLowerCase();
  return (
    text.includes("429") ||
    text.includes("rate limit") ||
    text.includes("rate_limit") ||
    text.includes("quota exceeded") ||
    text.includes("fetch failed") ||
    text.includes("timed out") ||
    text.includes("timeout") ||
    text.includes("connection reset") ||
    text.includes("econnreset") ||
    text.includes("eai_again") ||
    text.includes("enotfound") ||
    text.includes("503") ||
    text.includes("502") ||
    text.includes("temporarily unavailable")
  );
}

function resolveRetryDelayMs(attempt) {
  const exponentialMs = runtimeConfig.retryBaseMs * 2 ** Math.max(0, attempt - 1);
  const baseDelayMs = Math.min(exponentialMs, runtimeConfig.retryMaxMs);
  return baseDelayMs + randomJitter(runtimeConfig.retryJitterMs);
}

function shiftDateKey(dateKey, days) {
  const date = new Date(`${dateKey}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseConvexJson(raw) {
  const trimmed = raw
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\u0000/g, "")
    .replace(/\r/g, "")
    .trim();
  if (!trimmed) {
    throw new Error("Empty output from convex run");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const firstObject = trimmed.indexOf("{");
    const firstArray = trimmed.indexOf("[");
    const starts = [firstObject, firstArray].filter((entry) => entry >= 0);
    const start = starts.length > 0 ? Math.min(...starts) : -1;
    const lastObject = trimmed.lastIndexOf("}");
    const lastArray = trimmed.lastIndexOf("]");
    const end = Math.max(lastObject, lastArray);

    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }

    throw new Error(`Unable to parse convex JSON output:\n${trimmed}`);
  }
}

function writeConvexParseDebugArtifact(fn, raw) {
  const safeFn = fn.replaceAll(":", "-");
  const timestamp = toIsoNow().replaceAll(":", "-").replaceAll(".", "-");
  const debugPath = path.join(
    "/tmp",
    `convex-parse-failure-${safeFn}-${timestamp}.txt`,
  );

  try {
    fs.writeFileSync(debugPath, raw, "utf8");
    return debugPath;
  } catch {
    return null;
  }
}

function runConvex({ fn, payload, identitySubject }) {
  const command = [
    "convex",
    "run",
    fn,
    JSON.stringify(payload),
    "--identity",
    JSON.stringify({ subject: identitySubject }),
    "--typecheck=disable",
    "--codegen=disable",
  ];
  let parseRetryCount = 0;

  for (let attempt = 1; attempt <= runtimeConfig.convexMaxAttempts; attempt += 1) {
    const run = spawnSync("npx", command, {
      env: { ...process.env, NO_COLOR: "1" },
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });

    if (run.error) {
      throw run.error;
    }

    if (run.status !== 0) {
      const detail = [run.stdout, run.stderr]
        .filter(Boolean)
        .join("\n")
        .trim();
      if (
        attempt < runtimeConfig.convexMaxAttempts &&
        isRetryableConvexFailure(detail)
      ) {
        const retryDelayMs = resolveRetryDelayMs(attempt);
        writeProgress(
          `[eval][retry] ${fn} attempt ${attempt}/${runtimeConfig.convexMaxAttempts} failed; retry in ${retryDelayMs}ms`,
        );
        sleepSync(retryDelayMs);
        continue;
      }

      throw new Error(`Convex run failed for ${fn}\n${detail}`);
    }

    try {
      return parseConvexJson(run.stdout);
    } catch (error) {
      parseRetryCount += 1;
      if (parseRetryCount > 1) {
        const debugPath = writeConvexParseDebugArtifact(fn, run.stdout);
        throw new Error(
          `Convex JSON parse failed for ${fn}${
            debugPath ? `\nRaw output saved to ${debugPath}` : ""
          }\n${error instanceof Error ? error.message : String(error)}`,
        );
      }

      writeProgress(`[eval][retry] ${fn} parse failed once; retrying once`);
      sleepSync(250);
    }
  }

  throw new Error(`Convex run failed for ${fn} after retry budget exhausted`);
}

function toIsoNow() {
  return new Date().toISOString();
}

function buildTemplateContext(today) {
  return {
    today,
    yesterday: shiftDateKey(today, -1),
    tomorrow: shiftDateKey(today, 1),
    dayAfterTomorrow: shiftDateKey(today, 2),
  };
}

function buildChatNowOverrideTs({
  suite,
  caseConfig,
  templateContext,
  timezone,
}) {
  const localTime =
    caseConfig.chatNowLocalTime ?? suite.chatNowLocalTime ?? null;

  if (!localTime) {
    return null;
  }

  const localDate = caseConfig.chatNowDate
    ? applyTemplates(caseConfig.chatNowDate, templateContext)
    : templateContext.today;

  return fromZonedTime(`${localDate} ${localTime}`, timezone).getTime();
}

function applyTemplates(value, context) {
  if (typeof value === "string") {
    let nextValue = value;
    for (const [key, templateValue] of Object.entries(context)) {
      nextValue = nextValue.replaceAll(`{{${key}}}`, templateValue);
    }
    return nextValue;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => applyTemplates(entry, context));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        applyTemplates(entry, context),
      ]),
    );
  }

  return value;
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === undefined || value === null) {
    return [];
  }

  return [value];
}

function matchesExpected(actualValue, expectedValue) {
  const candidates = normalizeList(expectedValue);
  if (candidates.length === 0) {
    return true;
  }

  return candidates.some((candidate) => candidate === actualValue);
}

function formatExpectedValue(value) {
  return JSON.stringify(value);
}

function normalizeContainsList(values) {
  return normalizeList(values)
    .map((entry) => String(entry))
    .filter(Boolean);
}

function detectFragmentHits(contentNormalized, fragments) {
  const hits = [];

  for (const fragment of fragments) {
    const normalizedFragment = String(fragment).toLowerCase();
    if (!normalizedFragment) {
      continue;
    }
    if (contentNormalized.includes(normalizedFragment)) {
      hits.push(fragment);
    }
  }

  return [...new Set(hits)];
}

function evaluateChatExpectation(caseConfig, actual) {
  const failures = [];
  const expected = caseConfig.expect ?? {};

  const hardKeys = [
    "classification",
    "resolvedIntent",
    "responseMode",
    "requiresClarification",
  ];

  for (const key of hardKeys) {
    if (expected[key] === undefined) {
      continue;
    }

    if (!matchesExpected(actual[key], expected[key])) {
      failures.push(
        `${key} expected=${formatExpectedValue(expected[key])} actual=${formatExpectedValue(actual[key])}`,
      );
    }
  }

  return { failures, considerations: [] };
}

function evaluateAiContentExpectation(caseConfig, aiContent) {
  const failures = [];
  const considerations = [];
  const expected = caseConfig.expect ?? {};
  const aiContentNormalized = String(aiContent ?? "").toLowerCase();

  for (const fragment of normalizeContainsList(expected.aiMustContain)) {
    if (!aiContentNormalized.includes(fragment.toLowerCase())) {
      failures.push(`aiMustContain missing "${fragment}"`);
    }
  }

  for (const fragment of normalizeContainsList(expected.aiShouldContain)) {
    if (!aiContentNormalized.includes(fragment.toLowerCase())) {
      considerations.push(`aiShouldContain missing "${fragment}"`);
    }
  }

  for (const group of normalizeList(expected.aiMustContainAnyOf)) {
    const alternatives = normalizeContainsList(group);
    if (alternatives.length === 0) {
      continue;
    }

    const hasAny = alternatives.some((fragment) =>
      aiContentNormalized.includes(fragment.toLowerCase()),
    );
    if (!hasAny) {
      failures.push(
        `aiMustContainAnyOf missing one of ${JSON.stringify(alternatives)}`,
      );
    }
  }

  for (const fragment of normalizeContainsList(expected.aiMustNotContain)) {
    if (aiContentNormalized.includes(fragment.toLowerCase())) {
      failures.push(`aiMustNotContain hit "${fragment}"`);
    }
  }

  return { failures, considerations };
}

function evaluateVibeCheck(caseConfig, actual) {
  const expected = caseConfig.expect ?? {};
  const vibeCheck = expected.vibeCheck ?? null;
  if (!vibeCheck) {
    return { failures: [], considerations: [], result: null };
  }

  const profile = vibeCheck.profile ?? "brutal";
  const aiContent = String(actual.aiContent ?? "");
  const aiContentNormalized = aiContent.toLowerCase();

  const bannedPoliteWords = normalizeContainsList(
    vibeCheck.bannedPoliteWords ??
      (profile === "brutal" ? ["maaf", "silakan", "tolong"] : []),
  );
  const softWords = normalizeContainsList(
    vibeCheck.softWords ?? ["mohon", "please"],
  );
  const directCueAnyOf = normalizeContainsList(
    vibeCheck.directCueAnyOf ?? ["jangan", "harus", "langsung", "tidur sana"],
  );
  const roboticFragments = normalizeContainsList(
    vibeCheck.roboticFragments ?? [],
  );
  const bannedClosers = normalizeContainsList(vibeCheck.bannedClosers ?? []);
  const pendingActionCommands = normalizeContainsList(
    vibeCheck.pendingActionCommands ?? [
      "gerak",
      "move",
      "langsung kerjain",
      "ayo mulai",
      "do it now",
      "langsung gas",
      "kerjain sekarang",
      "langsung mulai",
    ],
  );
  const deadlineStingAnyOf = normalizeContainsList(
    vibeCheck.deadlineStingAnyOf ?? [],
  );
  const forbidPendingCommands = Boolean(vibeCheck.forbidPendingCommands);
  const requireDeadlineSting = Boolean(vibeCheck.requireDeadlineSting);
  const requireDirectLanguage = Boolean(
    vibeCheck.requireDirectLanguage ?? profile === "brutal",
  );
  const minScore = Number(
    Number.isFinite(Number(vibeCheck.minScore))
      ? Number(vibeCheck.minScore)
      : 70,
  );

  const bannedHits = detectFragmentHits(aiContentNormalized, bannedPoliteWords);
  const softHits = detectFragmentHits(aiContentNormalized, softWords);
  const roboticHits = detectFragmentHits(aiContentNormalized, roboticFragments);
  const bannedCloserHits = detectFragmentHits(aiContentNormalized, bannedClosers);
  const pendingCommandHits = detectFragmentHits(
    aiContentNormalized,
    pendingActionCommands,
  );
  const hasDirectCue =
    directCueAnyOf.length === 0
      ? true
      : directCueAnyOf.some((fragment) =>
          aiContentNormalized.includes(String(fragment).toLowerCase()),
        );
  const hasDeadlineSting =
    deadlineStingAnyOf.length === 0
      ? true
      : deadlineStingAnyOf.some((fragment) =>
          aiContentNormalized.includes(String(fragment).toLowerCase()),
        );

  let brutalityScore = 100;
  brutalityScore -= bannedHits.length * 45;
  brutalityScore -= softHits.length * 15;
  brutalityScore -= roboticHits.length * 12;
  brutalityScore -= bannedCloserHits.length * 18;
  if (forbidPendingCommands && pendingCommandHits.length > 0) {
    brutalityScore -= pendingCommandHits.length * 25;
  }
  if (requireDeadlineSting && !hasDeadlineSting) {
    brutalityScore -= 20;
  }
  if (requireDirectLanguage && !hasDirectCue) {
    brutalityScore -= 20;
  }
  brutalityScore = Math.max(0, Math.min(100, brutalityScore));

  const failures = [];
  const considerations = [];

  if (bannedHits.length > 0) {
    failures.push(
      `vibeCheck banned polite words found=${JSON.stringify(bannedHits)}`,
    );
  }

  if (bannedCloserHits.length > 0) {
    failures.push(
      `vibeCheck banned closers found=${JSON.stringify(bannedCloserHits)}`,
    );
  }

  if (forbidPendingCommands && pendingCommandHits.length > 0) {
    failures.push(
      `vibeCheck pending-action commands found=${JSON.stringify(pendingCommandHits)}`,
    );
  }

  if (requireDirectLanguage && !hasDirectCue) {
    failures.push(
      `vibeCheck missing direct cue from=${JSON.stringify(directCueAnyOf)}`,
    );
  }

  if (requireDeadlineSting && !hasDeadlineSting) {
    failures.push(
      `vibeCheck missing deadline sting from=${JSON.stringify(deadlineStingAnyOf)}`,
    );
  }

  if (roboticHits.length > 0) {
    considerations.push(
      `vibeCheck robotic fragments detected=${JSON.stringify(roboticHits)}`,
    );
  }

  if (brutalityScore < minScore) {
    failures.push(
      `vibeCheck brutalityScore ${brutalityScore} < minScore ${minScore}`,
    );
  }

  if (softHits.length > 0 && failures.length === 0) {
    considerations.push(
      `vibeCheck soft words detected=${JSON.stringify(softHits)}`,
    );
  }

  return {
    failures,
    considerations,
    result: {
      enabled: true,
      profile,
      brutalityScore,
      minScore,
      requireDirectLanguage,
      directCueAnyOf,
      hasDirectCue,
      bannedPoliteWords,
      bannedHits,
      softWords,
      softHits,
      bannedClosers,
      bannedCloserHits,
      roboticFragments,
      roboticHits,
      pendingActionCommands,
      pendingCommandHits,
      forbidPendingCommands,
      deadlineStingAnyOf,
      hasDeadlineSting,
      requireDeadlineSting,
      pass: failures.length === 0,
    },
  };
}

function getValueAtPath(value, pathExpression) {
  return String(pathExpression)
    .split(".")
    .filter(Boolean)
    .reduce((current, key) => {
      if (current === null || current === undefined) {
        return undefined;
      }

      return current[key];
    }, value);
}

function compareValues(actualValue, comparator, expectedValue) {
  switch (comparator) {
    case "equals":
      return actualValue === expectedValue;
    case "gte":
      return Number(actualValue) >= Number(expectedValue);
    case "lte":
      return Number(actualValue) <= Number(expectedValue);
    case "includes":
      return String(actualValue ?? "")
        .toLowerCase()
        .includes(String(expectedValue).toLowerCase());
    case "one_of":
      return normalizeList(expectedValue).includes(actualValue);
    default:
      throw new Error(`Unsupported comparator "${comparator}"`);
  }
}

function evaluateResultExpectations(expectations, actualResult) {
  const failures = [];
  const checks = [];

  for (const expectation of expectations ?? []) {
    const comparator = expectation.comparator ?? "equals";
    const actualValue = getValueAtPath(actualResult, expectation.path);
    const pass = compareValues(actualValue, comparator, expectation.value);
    checks.push({
      path: expectation.path,
      comparator,
      expected: expectation.value,
      actual: actualValue,
      pass,
    });

    if (!pass) {
      failures.push(
        `resultExpect ${expectation.path} ${comparator} ${formatExpectedValue(expectation.value)} actual=${formatExpectedValue(actualValue)}`,
      );
    }
  }

  return { failures, checks };
}

function parseSuiteSelection(rawSuiteSelection) {
  if (!rawSuiteSelection || rawSuiteSelection === "all") {
    return SUITE_IDS;
  }

  const suiteIds = rawSuiteSelection
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (suiteIds.length === 0) {
    throw new Error("No suite ids provided");
  }

  for (const suiteId of suiteIds) {
    if (!SUITES[suiteId]) {
      throw new Error(
        `Unknown --suite value "${suiteId}". Available suites: ${SUITE_IDS.join(", ")}`,
      );
    }
  }

  return suiteIds;
}

function buildLookupArgs({ email, clerkId }) {
  return {
    email: email ?? undefined,
    clerkId: clerkId ?? undefined,
  };
}

function parseCaseSelection(rawCaseSelection) {
  if (!rawCaseSelection) {
    return null;
  }

  const caseIds = rawCaseSelection
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return caseIds.length > 0 ? caseIds : null;
}

function expandCaseSelectionWithDependencies(suite, selectedCaseIds) {
  if (!selectedCaseIds || selectedCaseIds.length === 0) {
    return null;
  }

  const caseById = new Map(
    suite.cases.map((caseConfig) => [caseConfig.id, caseConfig]),
  );
  const selectedSet = new Set(selectedCaseIds);
  const visiting = new Set();

  function visit(caseId) {
    if (visiting.has(caseId)) {
      throw new Error(`Circular case dependency detected at "${caseId}"`);
    }

    if (!selectedSet.has(caseId)) {
      selectedSet.add(caseId);
    }

    const caseConfig = caseById.get(caseId);
    if (!caseConfig) {
      throw new Error(
        `Unknown case id "${caseId}" for suite. Available cases: ${suite.cases
          .map((entry) => entry.id)
          .join(", ")}`,
      );
    }

    const dependencies = normalizeList(caseConfig.dependsOn).filter(Boolean);
    if (dependencies.length === 0) {
      return;
    }

    visiting.add(caseId);
    for (const dependencyCaseId of dependencies) {
      visit(dependencyCaseId);
    }
    visiting.delete(caseId);
  }

  for (const caseId of selectedCaseIds) {
    visit(caseId);
  }

  return suite.cases
    .map((caseConfig) => caseConfig.id)
    .filter((caseId) => selectedSet.has(caseId));
}

function writeProgress(message) {
  process.stderr.write(`${message}\n`);
}

function normalizePathToReportJson(rawPath) {
  const resolved = path.resolve(rawPath);
  if (resolved.endsWith(".json")) {
    return resolved;
  }

  if (resolved.endsWith(".md")) {
    const jsonCandidate = resolved.slice(0, -3) + ".json";
    if (fs.existsSync(jsonCandidate)) {
      return jsonCandidate;
    }
  }

  throw new Error(
    `Cannot resolve JSON report path from "${rawPath}". Pass .json report path directly or matching .md/.json pair.`,
  );
}

function loadJsonFromFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function buildFailedCaseSelectionFromReport(report) {
  if (Array.isArray(report.suiteReports)) {
    const selections = {};

    for (const suiteReport of report.suiteReports) {
      const failingCaseIds = (suiteReport.caseResults ?? [])
        .filter((caseResult) => caseResult.pass === false)
        .map((caseResult) => caseResult.id);

      if (failingCaseIds.length > 0) {
        selections[suiteReport.suiteId] = failingCaseIds;
      }
    }

    return selections;
  }

  if (report.suiteId && Array.isArray(report.caseResults)) {
    const failingCaseIds = report.caseResults
      .filter((caseResult) => caseResult.pass === false)
      .map((caseResult) => caseResult.id);
    return failingCaseIds.length > 0
      ? { [report.suiteId]: failingCaseIds }
      : {};
  }

  throw new Error(
    "Unsupported report shape for --rerun-failed-from. Expected suite report JSON or aggregate report JSON.",
  );
}

function formatErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function getEvaluationSnapshot({
  identitySubject,
  baseLookupArgs,
  suite,
  limitPerCollection,
}) {
  return runConvex({
    fn: "devSeeds:getAgentEvaluationSnapshot",
    identitySubject,
    payload: {
      ...baseLookupArgs,
      seedPrefixes: suite.seed.seedPrefixes ?? [],
      includeAllHabits: false,
      includeNonHabitMessages: true,
      limitPerCollection,
    },
  });
}

function resolveBeforeOffsetMinutes(actionConfig) {
  if (typeof actionConfig.beforeOffsetMinutes === "number") {
    return actionConfig.beforeOffsetMinutes;
  }

  if (
    actionConfig.args &&
    typeof actionConfig.args.beforeOffsetMinutes === "number"
  ) {
    return actionConfig.args.beforeOffsetMinutes;
  }

  return null;
}

function runActionInvocation({
  actionConfig,
  identitySubject,
  baseLookupArgs,
  templateContext,
}) {
  const templatedConfig = applyTemplates(actionConfig, templateContext);
  const args = { ...(templatedConfig.args ?? {}) };
  const beforeOffsetMinutes = resolveBeforeOffsetMinutes(templatedConfig);

  delete args.beforeOffsetMinutes;

  const payload = {
    ...baseLookupArgs,
    ...args,
  };

  if (templatedConfig.confirmation) {
    payload.confirmation = templatedConfig.confirmation;
  }

  if (typeof beforeOffsetMinutes === "number") {
    payload.before = Date.now() + beforeOffsetMinutes * 60 * 1000;
  }

  return {
    invocation: {
      fn: templatedConfig.fn,
      payload,
    },
    result: runConvex({
      fn: templatedConfig.fn,
      identitySubject,
      payload,
    }),
  };
}

function normalizeText(value) {
  return String(value ?? "").trim().toLowerCase();
}

function matchesIncludes(actualValue, expectedValue) {
  if (!expectedValue) {
    return true;
  }

  return normalizeText(actualValue).includes(normalizeText(expectedValue));
}

function getMatchingHabitIds(snapshot, habitIncludes) {
  if (!habitIncludes) {
    return null;
  }

  return snapshot.habits
    .filter((habit) => matchesIncludes(habit.name, habitIncludes))
    .map((habit) => habit._id);
}

function recordAssertion({
  assertion,
  pass,
  matchedCount,
  detail,
  actual,
  expected,
}) {
  return {
    type: assertion.type,
    pass,
    matchedCount,
    detail,
    actual: actual ?? null,
    expected: expected ?? null,
  };
}

function evaluateSingleAssertion(assertion, snapshot) {
  const habitIds = getMatchingHabitIds(snapshot, assertion.habitIncludes);
  const matchesHabit = (habitId) =>
    !habitIds || habitIds.some((candidate) => candidate === habitId);
  const matchesState = (value, expected, expectedOneOf) => {
    if (expected !== undefined) {
      return value === expected;
    }

    if (expectedOneOf !== undefined) {
      return normalizeList(expectedOneOf).includes(value);
    }

    return true;
  };

  switch (assertion.type) {
    case "check_in_exists": {
      const matches = snapshot.checkIns.filter((checkIn) => {
        return (
          matchesHabit(checkIn.habitId) &&
          (!assertion.date || checkIn.date === assertion.date) &&
          (!assertion.source || checkIn.source === assertion.source) &&
          matchesState(checkIn.status, assertion.status, assertion.statusOneOf)
        );
      });

      return recordAssertion({
        assertion,
        pass: matches.length > 0,
        matchedCount: matches.length,
        detail:
          matches.length > 0
            ? "Matching check-in found."
            : "Expected matching check-in was not found.",
      });
    }

    case "workout_log_exists": {
      const checkInsById = new Map(
        snapshot.checkIns.map((checkIn) => [String(checkIn._id), checkIn]),
      );
      const matches = snapshot.workoutLogs.filter((workoutLog) => {
        if (!matchesHabit(workoutLog.habitId)) {
          return false;
        }

        if (!assertion.date) {
          return true;
        }

        const linkedCheckIn = checkInsById.get(String(workoutLog.checkInId));
        return linkedCheckIn?.date === assertion.date;
      });

      return recordAssertion({
        assertion,
        pass: matches.length > 0,
        matchedCount: matches.length,
        detail:
          matches.length > 0
            ? "Workout log found."
            : "Expected workout log was not found.",
      });
    }

    case "action_log_exists": {
      const matches = snapshot.actionLogs.filter((log) => {
        return (
          (!assertion.actionType || log.actionType === assertion.actionType) &&
          (!assertion.status || log.status === assertion.status) &&
          (!assertion.intent || log.intent === assertion.intent) &&
          (!assertion.habitIncludes ||
            (log.targetId &&
              habitIds?.some((habitId) => String(habitId) === String(log.targetId)))) &&
          (!assertion.inputSummaryIncludes ||
            matchesIncludes(log.inputSummary, assertion.inputSummaryIncludes)) &&
          (!assertion.resultSummaryIncludes ||
            matchesIncludes(log.resultSummary, assertion.resultSummaryIncludes))
        );
      });

      return recordAssertion({
        assertion,
        pass: matches.length > 0,
        matchedCount: matches.length,
        detail:
          matches.length > 0
            ? "Matching action log found."
            : "Expected action log was not found.",
      });
    }

    case "habit_skip_exists": {
      const matches = snapshot.habitSkips.filter((skip) => {
        return (
          matchesHabit(skip.habitId) &&
          (!assertion.date || skip.date === assertion.date)
        );
      });

      return recordAssertion({
        assertion,
        pass: matches.length > 0,
        matchedCount: matches.length,
        detail:
          matches.length > 0
            ? "Matching habit skip found."
            : "Expected habit skip was not found.",
      });
    }

    case "task_exists": {
      const matches = snapshot.tasks.filter((task) => {
        return (
          (!assertion.titleIncludes ||
            matchesIncludes(task.title, assertion.titleIncludes)) &&
          (!assertion.date || task.date === assertion.date) &&
          (!assertion.time || task.time === assertion.time) &&
          (!assertion.status || task.status === assertion.status)
        );
      });

      return recordAssertion({
        assertion,
        pass: matches.length > 0,
        matchedCount: matches.length,
        detail:
          matches.length > 0
            ? "Matching task found."
            : "Expected task was not found.",
      });
    }

    case "pending_action_exists": {
      const matches = snapshot.pendingActions.filter((pendingAction) => {
        return (
          (!assertion.actionType ||
            pendingAction.actionType === assertion.actionType) &&
          (!assertion.intent || pendingAction.intent === assertion.intent) &&
          (!assertion.habitIncludes ||
            (pendingAction.targetHabitId &&
              habitIds?.some((habitId) => habitId === pendingAction.targetHabitId))) &&
          (!assertion.missingFieldsIncludes ||
            normalizeList(assertion.missingFieldsIncludes).every((field) =>
              pendingAction.missingFields.includes(field),
            ))
        );
      });

      return recordAssertion({
        assertion,
        pass: matches.length > 0,
        matchedCount: matches.length,
        detail:
          matches.length > 0
            ? "Matching pending action found."
            : "Expected pending action was not found.",
      });
    }

    case "pending_action_count": {
      const actualCount = snapshot.pendingActions.length;
      const expectedCount =
        assertion.equals ?? assertion.value ?? assertion.count ?? 0;
      return recordAssertion({
        assertion,
        pass: actualCount === expectedCount,
        matchedCount: actualCount,
        detail: `Pending action count actual=${actualCount} expected=${expectedCount}`,
        actual: actualCount,
        expected: expectedCount,
      });
    }

    case "episode_exists": {
      const matches = snapshot.episodes.filter((episode) => {
        return (
          (!assertion.episodeType || episode.type === assertion.episodeType) &&
          (!assertion.date || episode.date === assertion.date) &&
          (!assertion.habitIncludes || matchesHabit(episode.habitId)) &&
          (!assertion.summaryIncludes ||
            matchesIncludes(episode.summary, assertion.summaryIncludes))
        );
      });

      return recordAssertion({
        assertion,
        pass: matches.length > 0,
        matchedCount: matches.length,
        detail:
          matches.length > 0
            ? "Matching episode found."
            : "Expected episode was not found.",
      });
    }

    case "memory_exists": {
      const matches = snapshot.memories.filter((memory) => {
        return (
          (!assertion.scope || memory.scope === assertion.scope) &&
          (!assertion.habitIncludes || matchesHabit(memory.habitId)) &&
          (!assertion.summaryIncludes ||
            matchesIncludes(memory.summary, assertion.summaryIncludes))
        );
      });

      return recordAssertion({
        assertion,
        pass: matches.length > 0,
        matchedCount: matches.length,
        detail:
          matches.length > 0
            ? "Matching memory found."
            : "Expected memory was not found.",
      });
    }

    case "reminder_run_state": {
      const matches = snapshot.reminderRuns.filter((run) => {
        return (
          matchesHabit(run.habitId) &&
          (!assertion.date || run.date === assertion.date) &&
          matchesState(run.state, assertion.state, assertion.stateOneOf) &&
          (!assertion.responseIntent ||
            run.responseIntent === assertion.responseIntent)
        );
      });

      return recordAssertion({
        assertion,
        pass: matches.length > 0,
        matchedCount: matches.length,
        detail:
          matches.length > 0
            ? "Matching reminder run found."
            : "Expected reminder run state was not found.",
      });
    }

    case "weekly_report_exists": {
      const matches = snapshot.weeklyReports.filter((report) => {
        return (
          (!assertion.weekStart || report.weekStart === assertion.weekStart) &&
          (!assertion.weekEnd || report.weekEnd === assertion.weekEnd) &&
          (!assertion.habitIncludes || matchesHabit(report.habitId))
        );
      });

      return recordAssertion({
        assertion,
        pass: matches.length > 0,
        matchedCount: matches.length,
        detail:
          matches.length > 0
            ? "Matching weekly report found."
            : "Expected weekly report was not found.",
      });
    }

    case "model_run_exists": {
      const matches = snapshot.modelRuns.filter((run) => {
        return (
          (!assertion.source || run.source === assertion.source) &&
          (!assertion.purpose || run.purpose === assertion.purpose) &&
          (!assertion.habitIncludes || matchesHabit(run.habitId))
        );
      });

      return recordAssertion({
        assertion,
        pass: matches.length > 0,
        matchedCount: matches.length,
        detail:
          matches.length > 0
            ? "Matching model run found."
            : "Expected model run was not found.",
      });
    }

    default:
      throw new Error(`Unsupported assertion type "${assertion.type}"`);
  }
}

function evaluateAssertions(assertions, snapshot) {
  const results = [];
  const failures = [];

  for (const assertion of assertions ?? []) {
    const result = evaluateSingleAssertion(assertion, snapshot);
    results.push(result);
    if (!result.pass) {
      failures.push(`${assertion.type}: ${result.detail}`);
    }
  }

  return { failures, results };
}

function evaluateDeltaCounts(deltaCounts, countsBefore, countsAfter) {
  const failures = [];
  const checks = [];

  for (const [key, expectedDelta] of Object.entries(deltaCounts ?? {})) {
    const before = Number(countsBefore[key] ?? 0);
    const after = Number(countsAfter[key] ?? 0);
    const actualDelta = after - before;
    const pass = actualDelta === expectedDelta;
    checks.push({
      key,
      before,
      after,
      expectedDelta,
      actualDelta,
      pass,
    });

    if (!pass) {
      failures.push(
        `deltaCounts ${key} expected=${expectedDelta} actual=${actualDelta} (before=${before} after=${after})`,
      );
    }
  }

  return { failures, checks };
}

function buildSuiteSummary(caseResults) {
  const total = caseResults.length;
  const passed = caseResults.filter((result) => result.pass).length;
  const failed = total - passed;
  const withConsiderations = caseResults.filter(
    (result) => result.considerations.length > 0,
  ).length;
  const hardPassRate = total === 0 ? 0 : Number(((passed / total) * 100).toFixed(1));

  return {
    total,
    passed,
    failed,
    withConsiderations,
    hardPassRate,
    releaseGatePass: failed === 0 && hardPassRate >= 95,
  };
}

function extractOperationAiContent(operationResult, snapshotAfter) {
  const candidateIds = [];

  if (operationResult?.messageId) {
    candidateIds.push(String(operationResult.messageId));
  }
  if (operationResult?.aiMessageId) {
    candidateIds.push(String(operationResult.aiMessageId));
  }
  if (Array.isArray(operationResult?.results)) {
    for (const entry of operationResult.results) {
      if (entry?.messageId) {
        candidateIds.push(String(entry.messageId));
      }
      if (entry?.aiMessageId) {
        candidateIds.push(String(entry.aiMessageId));
      }
    }
  }

  const uniqueIds = [...new Set(candidateIds)];
  if (uniqueIds.length === 0) {
    return "";
  }

  const contentById = new Map(
    snapshotAfter.messages.map((message) => [String(message._id), message.content]),
  );

  return uniqueIds
    .map((id) => contentById.get(id) ?? "")
    .filter(Boolean)
    .join("\n");
}

function createCaseDescriptor(caseResult) {
  if (caseResult.caseType === "operation") {
    return `operation ${caseResult.operation.fn}`;
  }

  return caseResult.input;
}

function buildSuiteMarkdownReport(report) {
  const lines = [];
  lines.push(`# Agent Eval Report: ${report.suiteId}`);
  lines.push("");
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- User: ${report.user.email} (${report.user.clerkId})`);
  lines.push(`- Suite description: ${report.suiteDescription}`);
  lines.push(`- Cases passed: ${report.summary.passed}/${report.summary.total}`);
  lines.push(`- Cases failed: ${report.summary.failed}`);
  lines.push(`- Cases with considerations: ${report.summary.withConsiderations}`);
  lines.push(`- Hard pass rate: ${report.summary.hardPassRate}%`);
  lines.push(
    `- Release gate: ${report.summary.releaseGatePass ? "GO" : "NO-GO"}`,
  );
  lines.push("");
  lines.push("## Case Results");
  lines.push("");

  for (const result of report.caseResults) {
    lines.push(`### ${result.id}`);
    lines.push(`- Type: ${result.caseType}`);
    lines.push(`- Prompt/Action: ${createCaseDescriptor(result)}`);
    lines.push(`- Pass: ${result.pass ? "yes" : "no"}`);

    if (result.classification !== null) {
      lines.push(`- classification: ${result.classification}`);
      lines.push(`- resolvedIntent: ${result.resolvedIntent}`);
      lines.push(`- responseMode: ${result.responseMode}`);
      lines.push(
        `- requiresClarification: ${String(result.requiresClarification)}`,
      );
    }

    if (result.failures.length > 0) {
      lines.push(`- Failures: ${result.failures.join(" | ")}`);
    }

    if (result.considerations.length > 0) {
      lines.push(`- Considerations: ${result.considerations.join(" | ")}`);
    }

    if (result.vibeCheck) {
      lines.push(
        `- Vibe check: ${result.vibeCheck.pass ? "pass" : "fail"} (score=${result.vibeCheck.brutalityScore}, min=${result.vibeCheck.minScore}, profile=${result.vibeCheck.profile})`,
      );
      if (result.vibeCheck.bannedHits.length > 0) {
        lines.push(
          `- Vibe banned hits: ${JSON.stringify(result.vibeCheck.bannedHits)}`,
        );
      }
      if (result.vibeCheck.roboticHits.length > 0) {
        lines.push(
          `- Vibe robotic hits: ${JSON.stringify(result.vibeCheck.roboticHits)}`,
        );
      }
      lines.push(
        `- Vibe direct cue: ${result.vibeCheck.hasDirectCue ? "yes" : "no"} from ${JSON.stringify(result.vibeCheck.directCueAnyOf)}`,
      );
    }

    if (result.resultExpectationChecks.length > 0) {
      const checks = result.resultExpectationChecks.map(
        (check) =>
          `${check.path} ${check.comparator} ${formatExpectedValue(check.expected)} actual=${formatExpectedValue(check.actual)} pass=${check.pass ? "yes" : "no"}`,
      );
      lines.push(`- Result expectations: ${checks.join(" | ")}`);
    }

    if (result.assertionResults.length > 0) {
      const assertionText = result.assertionResults.map(
        (assertion) =>
          `${assertion.type}: ${assertion.pass ? "pass" : "fail"} (${assertion.detail})`,
      );
      lines.push(`- Assertions: ${assertionText.join(" | ")}`);
    }

    if (result.deltaChecks.length > 0) {
      const deltaText = result.deltaChecks.map(
        (check) =>
          `${check.key}: expected ${check.expectedDelta}, actual ${check.actualDelta}, pass=${check.pass ? "yes" : "no"}`,
      );
      lines.push(`- Delta counts: ${deltaText.join(" | ")}`);
    }

    lines.push(`- Counts before: ${JSON.stringify(result.countsBefore)}`);
    lines.push(`- Counts after: ${JSON.stringify(result.countsAfter)}`);

    if (result.aiContent) {
      lines.push(`- AI: ${result.aiContent}`);
    } else {
      lines.push(`- Operation result: ${JSON.stringify(result.operationResult)}`);
    }

    lines.push("");
  }

  lines.push("## Final Snapshot Counts");
  lines.push("");
  for (const [key, value] of Object.entries(report.finalSnapshotCounts)) {
    lines.push(`- ${key}: ${value}`);
  }
  lines.push("");
  lines.push(`- Raw JSON report: ${report.jsonPath}`);

  return `${lines.join("\n")}\n`;
}

function buildAggregateMarkdownReport(report) {
  const lines = [];
  lines.push("# Agent Eval Aggregate Report");
  lines.push("");
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- User: ${report.user.email} (${report.user.clerkId})`);
  lines.push(`- Suites executed: ${report.summary.suiteCount}`);
  lines.push(`- Cases passed: ${report.summary.passed}/${report.summary.total}`);
  lines.push(`- Cases failed: ${report.summary.failed}`);
  lines.push(`- Hard pass rate: ${report.summary.hardPassRate}%`);
  lines.push(
    `- Release gate: ${report.summary.releaseGatePass ? "GO" : "NO-GO"}`,
  );
  lines.push("");
  lines.push("## Suite Summaries");
  lines.push("");
  lines.push("| Suite | Pass | Fail | Pass Rate | Report |");
  lines.push("| --- | ---: | ---: | ---: | --- |");

  for (const suiteReport of report.suiteReports) {
    lines.push(
      `| ${suiteReport.suiteId} | ${suiteReport.summary.passed} | ${suiteReport.summary.failed} | ${suiteReport.summary.hardPassRate}% | ${suiteReport.markdownPath} |`,
    );
  }

  const failingCases = report.suiteReports.flatMap((suiteReport) =>
    suiteReport.caseResults
      .filter((caseResult) => !caseResult.pass)
      .map((caseResult) => ({
        suiteId: suiteReport.suiteId,
        caseId: caseResult.id,
        failures: caseResult.failures,
      })),
  );

  lines.push("");
  lines.push("## Failing Cases");
  lines.push("");

  if (failingCases.length === 0) {
    lines.push("- None");
  } else {
    for (const failure of failingCases) {
      lines.push(
        `- ${failure.suiteId} / ${failure.caseId}: ${failure.failures.join(" | ")}`,
      );
    }
  }

  lines.push("");
  lines.push(`- Raw JSON report: ${report.jsonPath}`);
  return `${lines.join("\n")}\n`;
}

function buildAggregateSummary(suiteReports) {
  const total = suiteReports.reduce(
    (sum, suiteReport) => sum + suiteReport.summary.total,
    0,
  );
  const passed = suiteReports.reduce(
    (sum, suiteReport) => sum + suiteReport.summary.passed,
    0,
  );
  const failed = total - passed;
  const hardPassRate = total === 0 ? 0 : Number(((passed / total) * 100).toFixed(1));

  return {
    suiteCount: suiteReports.length,
    total,
    passed,
    failed,
    hardPassRate,
    releaseGatePass:
      failed === 0 && hardPassRate >= 95 && suiteReports.length > 0,
  };
}

function writeReportFiles({ rootDir, baseName, jsonReport, markdownReport }) {
  const outputDir = path.join(rootDir, "docs", "temp", "agent-evals");
  fs.mkdirSync(outputDir, { recursive: true });

  const jsonPath = path.join(outputDir, `${baseName}.json`);
  const markdownPath = path.join(outputDir, `${baseName}.md`);

  fs.writeFileSync(jsonPath, `${JSON.stringify(jsonReport, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, markdownReport, "utf8");

  return { jsonPath, markdownPath };
}

function executeCase({
  caseConfig,
  suite,
  identitySubject,
  baseLookupArgs,
  templateContext,
  limitPerCollection,
  timezone,
}) {
  const beforeActionResults = [];
  for (const beforeAction of caseConfig.beforeActions ?? []) {
    beforeActionResults.push(
      runActionInvocation({
        actionConfig: beforeAction,
        identitySubject,
        baseLookupArgs,
        templateContext,
      }),
    );
  }

  const snapshotBeforeEnvelope = getEvaluationSnapshot({
    identitySubject,
    baseLookupArgs,
    suite,
    limitPerCollection,
  });
  const countsBefore = snapshotBeforeEnvelope.counts;

  let chatResult = null;
  let operationResult = null;
  let input = null;
  let operation = null;
  let executionError = null;

  try {
    if (caseConfig.operation) {
      const operationRun = runActionInvocation({
        actionConfig: caseConfig.operation,
        identitySubject,
        baseLookupArgs,
        templateContext,
      });
      operationResult = operationRun.result;
      operation = operationRun.invocation;
    } else {
      input = applyTemplates(caseConfig.input, templateContext);
      chatResult = runConvex({
        fn: "chatAction:sendMessage",
        identitySubject,
        payload: {
          content: input,
          nowOverrideTs: buildChatNowOverrideTs({
            suite,
            caseConfig,
            templateContext,
            timezone,
          }) ?? undefined,
          source: "chat_input",
        },
      });
    }
  } catch (error) {
    executionError = formatErrorMessage(error);
  }

  const afterActionResults = [];
  for (const afterAction of caseConfig.afterActions ?? []) {
    afterActionResults.push(
      runActionInvocation({
        actionConfig: afterAction,
        identitySubject,
        baseLookupArgs,
        templateContext,
      }),
    );
  }

  const snapshotAfterEnvelope = getEvaluationSnapshot({
    identitySubject,
    baseLookupArgs,
    suite,
    limitPerCollection,
  });
  const snapshotAfter = snapshotAfterEnvelope.snapshot;
  const countsAfter = snapshotAfterEnvelope.counts;

  let aiContent = "";
  if (chatResult?.aiMessageId) {
    const aiMessage = snapshotAfter.messages.find(
      (message) => message._id === chatResult.aiMessageId,
    );
    aiContent = aiMessage?.content ?? "";
  } else if (operationResult) {
    aiContent = extractOperationAiContent(operationResult, snapshotAfter);
  }

  const failures = [];
  const considerations = [];
  if (executionError) {
    failures.push(`execution_error: ${executionError}`);
  }
  const resultExpectationEvaluation = evaluateResultExpectations(
    applyTemplates(caseConfig.resultExpect ?? [], templateContext),
    operationResult,
  );
  failures.push(...resultExpectationEvaluation.failures);

  if (chatResult) {
    const chatEvaluation = evaluateChatExpectation(caseConfig, {
      ...chatResult,
      aiContent,
    });
    failures.push(...chatEvaluation.failures);
    considerations.push(...chatEvaluation.considerations);
  }

  const contentEvaluation = evaluateAiContentExpectation(caseConfig, aiContent);
  failures.push(...contentEvaluation.failures);
  considerations.push(...contentEvaluation.considerations);

  let vibeCheck = null;
  if (aiContent) {
    const vibeEvaluation = evaluateVibeCheck(caseConfig, {
      ...(chatResult ?? {}),
      aiContent,
    });
    failures.push(...vibeEvaluation.failures);
    considerations.push(...vibeEvaluation.considerations);
    vibeCheck = vibeEvaluation.result;
  }

  const assertionEvaluation = evaluateAssertions(
    applyTemplates(caseConfig.assertions ?? [], templateContext),
    snapshotAfter,
  );
  failures.push(...assertionEvaluation.failures);

  const deltaEvaluation = evaluateDeltaCounts(
    applyTemplates(caseConfig.deltaCounts ?? {}, templateContext),
    countsBefore,
    countsAfter,
  );
  failures.push(...deltaEvaluation.failures);

  return {
    id: caseConfig.id,
    caseType: caseConfig.operation ? "operation" : "chat",
    input,
    operation,
    operationResult,
    chatResult,
    aiContent,
    pass: failures.length === 0,
    failures,
    considerations,
    assertionResults: assertionEvaluation.results,
    resultExpectationChecks: resultExpectationEvaluation.checks,
    deltaChecks: deltaEvaluation.checks,
    countsBefore,
    countsAfter,
    beforeActionResults,
    afterActionResults,
    classification: chatResult?.classification ?? null,
    resolvedIntent: chatResult?.resolvedIntent ?? null,
    responseMode: chatResult?.responseMode ?? null,
    requiresClarification: chatResult?.requiresClarification ?? null,
    vibeCheck,
    messageTimeline: snapshotAfter.messages,
  };
}

function executeSuite({
  suiteId,
  suite,
  selectedCaseIdsForSuite,
  identitySubject,
  baseLookupArgs,
  targetUser,
  templateContext,
  noSeed,
  preserveWorkspace,
  limitPerCollection,
  rootDir,
  fileStamp,
}) {
  let seedResult = null;
  if (!noSeed) {
    let resetWorkspaceResult = null;
    if (!preserveWorkspace) {
      writeProgress(`[eval] ${suiteId} -> reset workspace`);
      resetWorkspaceResult = runConvex({
        fn: "devSeeds:resetAgentEvaluationWorkspace",
        identitySubject,
        payload: {
          ...baseLookupArgs,
          confirmation: "phase6-agent-eval-reset",
        },
      });
    }

    writeProgress(`[eval] ${suiteId} -> seed`);
    seedResult = runConvex({
      fn: suite.seed.fn,
      identitySubject,
      payload: {
        ...baseLookupArgs,
        today: templateContext.today,
        resetExisting: suite.seed.resetExisting !== false,
        confirmation: suite.seed.confirmation,
        ...applyTemplates(suite.seed.extraArgs ?? {}, templateContext),
      },
    });
    seedResult = {
      resetWorkspaceResult,
      seed: seedResult,
    };
  }

  const preActionResults = [];
  for (const preAction of suite.preActions ?? []) {
    preActionResults.push(
      runActionInvocation({
        actionConfig: preAction,
        identitySubject,
        baseLookupArgs,
        templateContext,
      }),
    );
  }

  const casesToRun = selectedCaseIdsForSuite
    ? suite.cases.filter((caseConfig) =>
        selectedCaseIdsForSuite.includes(caseConfig.id),
      )
    : suite.cases;

  if (casesToRun.length === 0) {
    throw new Error(
      `No cases selected for suite ${suiteId}. Available cases: ${suite.cases
        .map((caseConfig) => caseConfig.id)
        .join(", ")}`,
    );
  }

  const caseResults = [];
  for (const [caseIndex, caseConfig] of casesToRun.entries()) {
    writeProgress(`[eval] ${suiteId} -> ${caseConfig.id}`);
    caseResults.push(
      executeCase({
        caseConfig,
        suite,
        identitySubject,
        baseLookupArgs,
        templateContext,
        limitPerCollection,
        timezone: targetUser.timezone ?? "UTC",
      }),
    );

    const isLastCase = caseIndex === casesToRun.length - 1;
    if (!isLastCase && runtimeConfig.caseDelayMs > 0) {
      writeProgress(
        `[eval] ${suiteId} -> cooldown ${runtimeConfig.caseDelayMs}ms before next case`,
      );
      sleepSync(runtimeConfig.caseDelayMs);
    }
  }

  const finalSnapshotEnvelope = getEvaluationSnapshot({
    identitySubject,
    baseLookupArgs,
    suite,
    limitPerCollection,
  });
  const summary = buildSuiteSummary(caseResults);
  const generatedAt = toIsoNow();

  const suiteReport = {
    suiteId,
    suiteDescription: suite.description,
    generatedAt,
    today: templateContext.today,
    user: {
      id: targetUser._id,
      clerkId: targetUser.clerkId,
      email: targetUser.email,
      subscriptionTier: targetUser.subscriptionTier,
      timezone: targetUser.timezone,
    },
    seedResult,
    preActionResults,
    caseResults,
    summary,
    snapshotFilters: finalSnapshotEnvelope.filters,
    finalSnapshotCounts: finalSnapshotEnvelope.counts,
    finalSnapshot: finalSnapshotEnvelope.snapshot,
  };

  const reportFiles = writeReportFiles({
    rootDir,
    baseName: `${suiteId}-${fileStamp}`,
    jsonReport: suiteReport,
    markdownReport: buildSuiteMarkdownReport({
      ...suiteReport,
      jsonPath: path.join(
        rootDir,
        "docs",
        "temp",
        "agent-evals",
        `${suiteId}-${fileStamp}.json`,
      ),
    }),
  });

  return {
    ...suiteReport,
    ...reportFiles,
  };
}

function main() {
  const rootDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );

  loadEnvFile(path.join(rootDir, ".env.local"));
  normalizeEnvValue("CONVEX_DEPLOYMENT");
  normalizeEnvValue("NEXT_PUBLIC_CONVEX_URL");
  normalizeEnvValue("NEXT_PUBLIC_CONVEX_SITE_URL");

  if (hasFlag("--list-suites")) {
    console.log(
      JSON.stringify(
        {
          suites: SUITE_IDS.map((suiteId) => ({
            id: suiteId,
            description: SUITES[suiteId].description,
            caseCount: SUITES[suiteId].cases.length,
            seedFn: SUITES[suiteId].seed.fn,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  const suiteIds = parseSuiteSelection(getArg("--suite") ?? "all");
  const selectedCaseIds = parseCaseSelection(getArg("--case"));
  const rerunFailedFrom = getArg("--rerun-failed-from");
  const email = getArg("--email");
  const clerkId = getArg("--clerk-id");
  const identitySubject = getArg("--identity-subject");
  const today = getArg("--today") ?? new Date().toISOString().slice(0, 10);
  const noSeed = hasFlag("--no-seed");
  const preserveWorkspace = hasFlag("--preserve-workspace");
  const limitPerCollection = parseIntegerArg(
    "--limit-per-collection",
    DEFAULT_LIMIT_PER_COLLECTION,
  );
  runtimeConfig.convexMaxAttempts = parseIntegerArg(
    "--convex-max-attempts",
    DEFAULT_CONVEX_MAX_ATTEMPTS,
  );
  runtimeConfig.retryBaseMs = parseIntegerArg(
    "--retry-base-ms",
    DEFAULT_RETRY_BASE_MS,
  );
  runtimeConfig.retryMaxMs = parseIntegerArg(
    "--retry-max-ms",
    DEFAULT_RETRY_MAX_MS,
  );
  runtimeConfig.retryJitterMs = parseIntegerArg(
    "--retry-jitter-ms",
    DEFAULT_RETRY_JITTER_MS,
  );
  runtimeConfig.caseDelayMs = parseIntegerArg(
    "--case-delay-ms",
    DEFAULT_CASE_DELAY_MS,
  );
  runtimeConfig.suiteDelayMs = parseIntegerArg(
    "--suite-delay-ms",
    DEFAULT_SUITE_DELAY_MS,
  );

  if (!email && !clerkId) {
    throw new Error("Pass --email <user@email> or --clerk-id <clerk_user_id>");
  }

  if (!identitySubject) {
    throw new Error("Pass --identity-subject <clerk_user_id>");
  }

  if (selectedCaseIds && rerunFailedFrom) {
    throw new Error("Do not combine --case with --rerun-failed-from.");
  }

  if (selectedCaseIds && suiteIds.length !== 1) {
    throw new Error("Use --case only when exactly one suite is selected.");
  }

  let effectiveSuiteIds = suiteIds;
  let suiteCaseSelection = {};

  if (rerunFailedFrom) {
    const reportJsonPath = normalizePathToReportJson(rerunFailedFrom);
    const reportPayload = loadJsonFromFile(reportJsonPath);
    const failedSelection = buildFailedCaseSelectionFromReport(reportPayload);
    const selectedSuiteSet = new Set(effectiveSuiteIds);
    suiteCaseSelection = Object.fromEntries(
      Object.entries(failedSelection).filter(([suiteId]) =>
        selectedSuiteSet.has(suiteId),
      ),
    );

    for (const [suiteId, caseIds] of Object.entries(suiteCaseSelection)) {
      suiteCaseSelection[suiteId] = expandCaseSelectionWithDependencies(
        SUITES[suiteId],
        caseIds,
      );
    }

    const candidateSuiteIds = Object.keys(suiteCaseSelection);
    if (candidateSuiteIds.length === 0) {
      throw new Error(
        `No failing cases found in selected suites from ${reportJsonPath}`,
      );
    }

    effectiveSuiteIds = candidateSuiteIds;
    writeProgress(
      `[eval] rerun-failed-from active -> suites=${effectiveSuiteIds.join(", ")}`,
    );
  } else if (selectedCaseIds && suiteIds.length === 1) {
    suiteCaseSelection = {
      [suiteIds[0]]: expandCaseSelectionWithDependencies(
        SUITES[suiteIds[0]],
        selectedCaseIds,
      ),
    };
  }

  const targetUser = runConvex({
    fn: "users:getCurrent",
    identitySubject,
    payload: {},
  });
  if (!targetUser?._id) {
    throw new Error("Unable to resolve current user for identity");
  }

  const baseLookupArgs = buildLookupArgs({ email, clerkId });
  const templateContext = buildTemplateContext(today);
  const fileStamp = toIsoNow().replaceAll(":", "-").replaceAll(".", "-");

  const suiteReports = [];
  for (const [suiteIndex, suiteId] of effectiveSuiteIds.entries()) {
    suiteReports.push(
      executeSuite({
        suiteId,
        suite: SUITES[suiteId],
        selectedCaseIdsForSuite: suiteCaseSelection[suiteId] ?? null,
        identitySubject,
        baseLookupArgs,
        targetUser,
      templateContext,
      noSeed,
      preserveWorkspace,
      limitPerCollection,
        rootDir,
        fileStamp,
      }),
    );

    const isLastSuite = suiteIndex === effectiveSuiteIds.length - 1;
    if (!isLastSuite && runtimeConfig.suiteDelayMs > 0) {
      writeProgress(
        `[eval] suite cooldown ${runtimeConfig.suiteDelayMs}ms before next suite`,
      );
      sleepSync(runtimeConfig.suiteDelayMs);
    }
  }

  const aggregateSummary = buildAggregateSummary(suiteReports);
  let aggregatePaths = null;

  if (suiteReports.length > 1) {
    const aggregateReport = {
      generatedAt: toIsoNow(),
      today,
      user: {
        id: targetUser._id,
        clerkId: targetUser.clerkId,
        email: targetUser.email,
        subscriptionTier: targetUser.subscriptionTier,
        timezone: targetUser.timezone,
      },
      suiteReports: suiteReports.map((suiteReport) => ({
        suiteId: suiteReport.suiteId,
        summary: suiteReport.summary,
        jsonPath: suiteReport.jsonPath,
        markdownPath: suiteReport.markdownPath,
        caseResults: suiteReport.caseResults,
      })),
      summary: aggregateSummary,
    };

    aggregatePaths = writeReportFiles({
      rootDir,
      baseName: `agent-eval-all-${fileStamp}`,
      jsonReport: aggregateReport,
      markdownReport: buildAggregateMarkdownReport({
        ...aggregateReport,
        jsonPath: path.join(
          rootDir,
          "docs",
          "temp",
          "agent-evals",
          `agent-eval-all-${fileStamp}.json`,
        ),
      }),
    });
  }

  console.log(
    JSON.stringify(
      {
        generatedAt: toIsoNow(),
        suiteIds: effectiveSuiteIds,
        summary: aggregateSummary,
        suiteReports: suiteReports.map((suiteReport) => ({
          suiteId: suiteReport.suiteId,
          summary: suiteReport.summary,
          jsonPath: suiteReport.jsonPath,
          markdownPath: suiteReport.markdownPath,
        })),
        aggregateReport: aggregatePaths,
      },
      null,
      2,
    ),
  );
}

main();
