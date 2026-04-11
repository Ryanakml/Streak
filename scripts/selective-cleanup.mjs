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

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
loadEnvFile(path.join(rootDir, ".env.local"));

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) {
  throw new Error("Missing NEXT_PUBLIC_CONVEX_URL in environment");
}

const targetEmail = getArg("--keep-email");
if (!targetEmail) {
  throw new Error("Please specify the user to KEEP with --keep-email <email>");
}

const client = new ConvexHttpClient(convexUrl);

console.log(
  `Starting selective cleanup. Keeping user with Email: ${targetEmail}`,
);

try {
  const result = await client.mutation("devSeeds:selectiveCleanupUsers", {
    keepEmail: targetEmail,
    confirmation: "selective-cleanup-v1",
  });

  console.log("Cleanup Results:");
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error("Cleanup failed:", error.message);
}
