/**
 * POST /api/jobs/sync from your machine (same auth as the Telegram webhook).
 *
 * Requires in repo-root .env:
 *   TELEGRAM_WEBHOOK_SECRET
 *   VITE_API_URL or PUBLIC_WEBHOOK_URL (API base, no path, no /webhook)
 *   VITE_API_URL is tried first so the dashboard and this script stay aligned on Fly.
 *
 * Usage:
 *   npm run jobs:sync --workspace=backend
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
dotenv.config({ path: path.resolve(repoRoot, ".env") });

const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
const baseFromVite = process.env.VITE_API_URL?.trim();
const baseFromPublic = process.env.PUBLIC_WEBHOOK_URL?.trim();
const baseFromOther = process.env.API_BASE_URL?.trim();
const base = (
  baseFromVite ||
  baseFromPublic ||
  baseFromOther ||
  ""
).replace(/\/$/, "");

if (!secret) {
  console.error("Missing TELEGRAM_WEBHOOK_SECRET in .env");
  process.exit(1);
}
if (!base) {
  console.error("Set VITE_API_URL or PUBLIC_WEBHOOK_URL (API base URL, no trailing slash).");
  process.exit(1);
}

if (baseFromVite) {
  console.info("[jobs:sync] Using VITE_API_URL →", base);
} else if (baseFromPublic) {
  console.info("[jobs:sync] Using PUBLIC_WEBHOOK_URL →", base);
} else {
  console.info("[jobs:sync] Using API_BASE_URL →", base);
}

const url = `${base}/api/jobs/sync`;
console.info("[jobs:sync] POST", url);
const res = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Telegram-Bot-Api-Secret-Token": secret,
  },
  body: "{}",
});

const text = await res.text();
let json;
try {
  json = JSON.parse(text);
} catch {
  console.error("HTTP", res.status, text.slice(0, 500));
  process.exit(1);
}

console.log(JSON.stringify(json, null, 2));
if (!res.ok) process.exit(1);
