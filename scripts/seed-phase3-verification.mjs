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

const today = getArg("--today") ?? new Date().toISOString().slice(0, 10);
const resetExisting = getArg("--no-reset") ? false : true;
const createDueReminders = getArg("--no-reminders") ? false : true;

const client = new ConvexHttpClient(convexUrl);
const result = await client.mutation("devSeeds:seedPhase3Verification", {
  email: email ?? undefined,
  clerkId: clerkId ?? undefined,
  today,
  resetExisting,
  createDueReminders,
  confirmation: "phase3-verification",
});

console.log(JSON.stringify(result, null, 2));
console.log("\nNext:");
console.log("- Process due reminders with npm run phase3:process-reminders -- --email your@email.com");
console.log("- Run the chat cases in docs/phase/phase-3-verification-test-plan.md");
console.log("- Refresh summaries with npm run phase3:refresh-memory -- --email your@email.com");
