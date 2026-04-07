import fs from "node:fs";
import path from "node:path";
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
    const value = line
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");

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

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
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

const minutesAheadRaw = getArg("--minutes-ahead");
const minutesAhead = minutesAheadRaw ? Number(minutesAheadRaw) : 0;
const before =
  Date.now() +
  Math.max(0, Number.isFinite(minutesAhead) ? minutesAhead : 0) * 60 * 1000;

const habitName = getArg("--habit");
const date = getArg("--date");
const limitRaw = getArg("--limit");
const limit =
  limitRaw && Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : undefined;
const typesRaw = getArg("--types");
const types = typesRaw
  ? typesRaw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  : undefined;

const client = new ConvexHttpClient(convexUrl);
const result = await client.action("devSeeds:processPhase5DueReminders", {
  email: email ?? undefined,
  clerkId: clerkId ?? undefined,
  before,
  date: date ?? undefined,
  habitName: habitName ?? undefined,
  limit,
  types:
    types?.length
      ? types.map((entry) => {
          if (
            entry !== "pre_workout" &&
            entry !== "check_in" &&
            entry !== "late_follow_up"
          ) {
            throw new Error(`Unsupported reminder type: ${entry}`);
          }
          return entry;
        })
      : undefined,
  confirmation: "phase5-verification",
});

console.log(JSON.stringify(result, null, 2));
