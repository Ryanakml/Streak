import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";
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
const resetExisting = getArg("--no-reset") ? false : true;

const client = new ConvexHttpClient(convexUrl);
const result = await client.mutation("devSeeds:seedCase4Verification", {
  email: email ?? undefined,
  clerkId: clerkId ?? undefined,
  today,
  resetExisting,
  confirmation: "case4-verification",
});

console.log(JSON.stringify(result, null, 2));
console.log("\nNext:");
console.log(
  `- Run full replay: node scripts/replay-case4-verification.mjs --email ${
    email ?? result.email
  } --today ${today}`,
);
console.log(
  `- Or inspect snapshot later: npx convex run devSeeds:getCase4VerificationSnapshot '{"email":"${
    email ?? result.email
  }"}' --typecheck=disable --codegen=disable`,
);
