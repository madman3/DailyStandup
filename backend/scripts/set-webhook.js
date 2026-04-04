/**
 * Registers Telegram webhook with optional secret_token (recommended).
 * Usage: from repo root, with .env filled:
 *   npm run register-webhook --workspace=backend
 *
 * Requires: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, PUBLIC_WEBHOOK_URL
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
const base = process.env.PUBLIC_WEBHOOK_URL?.trim()?.replace(/\/$/, "");

if (!token || !secret || !base) {
  console.error(
    "Missing env. Set in .env (repo root): TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, PUBLIC_WEBHOOK_URL"
  );
  process.exit(1);
}

const webhookUrl = `${base}/webhook`;
const apiUrl = `https://api.telegram.org/bot${token}/setWebhook`;

const body = new URLSearchParams({
  url: webhookUrl,
  secret_token: secret,
});

const res = await fetch(apiUrl, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: body.toString(),
});

const data = await res.json();
if (!data.ok) {
  console.error("setWebhook failed:", data);
  process.exit(1);
}

console.log("Webhook registered:", webhookUrl);
console.log("Telegram will send header X-Telegram-Bot-Api-Secret-Token on each request.");
