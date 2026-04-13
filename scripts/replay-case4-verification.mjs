import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";
import { spawnSync } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";

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

function getArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] ?? null;
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

function runConvex({ fn, payload, identitySubject }) {
  const command = [
    "convex",
    "run",
    "--env-file",
    ".env.local",
    fn,
    JSON.stringify(payload),
    "--identity",
    JSON.stringify({ subject: identitySubject }),
    "--typecheck=disable",
    "--codegen=disable",
  ];

  const run = spawnSync("npx", command, {
    cwd: rootDir,
    env: { ...process.env, NO_COLOR: "1" },
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  if (run.error) {
    throw run.error;
  }

  if (run.status !== 0) {
    const detail = [run.stdout, run.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`Convex run failed for ${fn}\n${detail}`);
  }

  return parseConvexJson(run.stdout);
}

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
loadEnvFile(path.join(rootDir, ".env.local"));

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) {
  throw new Error("Missing NEXT_PUBLIC_CONVEX_URL in environment");
}

const email = getArg("--email");
const clerkId = getArg("--clerk-id");
if (!email && !clerkId) {
  throw new Error("Pass --email <user@email> or --clerk-id <clerk_user_id>");
}

const today = getArg("--today") ?? new Date().toISOString().slice(0, 10);

const client = new ConvexHttpClient(convexUrl);
const seed = await client.mutation("devSeeds:seedCase4Verification", {
  email: email ?? undefined,
  clerkId: clerkId ?? undefined,
  today,
  resetExisting: true,
  confirmation: "case4-verification",
});

const identitySubject = seed.clerkId;
if (!identitySubject) {
  throw new Error("Missing clerkId from seed response");
}

const results = {
  seed,
  createTaskChat: runConvex({
    fn: "chatAction:sendMessage",
    identitySubject,
    payload: {
      content: "task baru, bangun pagi nanti pagi jam 8",
      nowOverrideTs: seed.replayMoments.createTaskAt,
      source: "chat_input",
    },
  }),
  reminderProcessing: await client.action("devSeeds:processTaskReminderSmoke", {
    email: seed.email,
    clerkId: seed.clerkId,
    before: seed.replayMoments.processRemindersBefore,
    confirmation: "task-reminder-smoke",
  }),
  lateWakeChat: runConvex({
    fn: "chatAction:sendMessage",
    identitySubject,
    payload: {
      content: "dude, i already waking up",
      nowOverrideTs: seed.replayMoments.lateWakeCheckAt,
      source: "chat_input",
    },
  }),
  askTodayPlan: runConvex({
    fn: "chatAction:sendMessage",
    identitySubject,
    payload: {
      content: "hari ini ada apa aja?",
      nowOverrideTs: seed.replayMoments.askPlanAt,
      source: "chat_input",
    },
  }),
  duplicateWakeChat: runConvex({
    fn: "chatAction:sendMessage",
    identitySubject,
    payload: {
      content: "gua udah bangun lagi",
      nowOverrideTs: seed.replayMoments.duplicateWakeCheckAt,
      source: "chat_input",
    },
  }),
  snapshot: await client.query("devSeeds:getCase4VerificationSnapshot", {
    email: seed.email,
    clerkId: seed.clerkId,
  }),
};

console.log(JSON.stringify(results, null, 2));
console.log("\nExpected:");
console.log("- Task 'bangun pagi' should exist and end with status 'done'.");
console.log("- Habit 'github' should remain untouched.");
console.log("- The late wake-up chat should resolve through task completion, not GitHub habit logging.");
console.log("- The plan reply should show no fake bentrok between 08:00 wake-up task and 23:00 github habit.");
console.log("- The final wake-up repeat should roast because the task is already done.");
