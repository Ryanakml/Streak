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

const client = new ConvexHttpClient(convexUrl);
const result = await client.mutation("devSeeds:seedTaskReminderSmoke", {
  email: email ?? undefined,
  clerkId: clerkId ?? undefined,
  today: getArg("--today") ?? undefined,
  baseTime: getArg("--base-time") ?? undefined,
  confirmation: "task-reminder-smoke",
});

console.log(JSON.stringify(result, null, 2));
