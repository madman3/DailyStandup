/**
 * Daily Standup — backend entry.
 * Webhook verifies Telegram's X-Telegram-Bot-Api-Secret-Token when TELEGRAM_WEBHOOK_SECRET is set.
 */
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { extractStandupFromMessage } from "./extractMessage.js";
import { mergeIntoDay, readState } from "./stateStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

/** Append to messageLog, run Gemini, merge. On AI failure, still save message + lastError. */
async function processStandupText(trimmed, source = "app") {
  const dateKey = new Date().toISOString().slice(0, 10);
  const state = await readState();
  const prev = state.days[dateKey] || {};
  const messageLog = [
    ...(prev.messageLog || []),
    { text: trimmed.slice(0, 2000), at: new Date().toISOString(), source },
  ];
  const base = {
    lastRawText: trimmed.slice(0, 500),
    lastMessageAt: new Date().toISOString(),
    messageLog,
  };
  try {
    const extracted = await extractStandupFromMessage(trimmed);
    const patch = { ...extracted, ...base };
    await mergeIntoDay(dateKey, patch);
  } catch (err) {
    await mergeIntoDay(dateKey, {
      ...base,
      lastError: String(err.message),
    });
    throw err;
  }
}

const app = express();
const PORT = process.env.PORT ?? 3001;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function verifyTelegramWebhookSecret(req, res, next) {
  if (!WEBHOOK_SECRET) {
    console.warn(
      "TELEGRAM_WEBHOOK_SECRET is not set — refusing /webhook. Add it to .env and run register-webhook."
    );
    return res.status(503).json({ error: "Webhook secret not configured" });
  }
  const sent = req.get("X-Telegram-Bot-Api-Secret-Token");
  if (sent !== WEBHOOK_SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

app.get("/", (_req, res) => {
  res.type("html").send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Daily Standup API</title></head><body>
<p>This is the API server, not the dashboard.</p>
<ul>
<li><a href="/health">GET /health</a> — health check</li>
<li><a href="/api/state">GET /api/state</a> — dashboard JSON</li>
<li>Local test (no Telegram): <code>POST /api/ingest</code> with JSON <code>{"text":"..."}</code> and header <code>X-Telegram-Bot-Api-Secret-Token</code> (same as webhook)</li>
<li>Dashboard (dev): run <code>npm run dev --workspace=frontend</code> then open <a href="http://localhost:5173">http://localhost:5173</a></li>
</ul>
</body></html>`);
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/state", async (_req, res) => {
  try {
    const state = await readState();
    res.json(state);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not read state" });
  }
});

/** Debug: Telegram webhook URL + last error (uses server-side bot token only). */
app.get("/api/telegram-status", async (_req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    return res.status(503).json({ ok: false, error: "TELEGRAM_BOT_TOKEN not set" });
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

app.post("/webhook", verifyTelegramWebhookSecret, async (req, res) => {
  const update = req.body;
  console.log(
    "[webhook] update_id=%s has_message=%s",
    update.update_id ?? "?",
    Boolean(update.message?.text ?? update.edited_message?.text)
  );
  const text =
    update.message?.text ?? update.edited_message?.text ?? update.channel_post?.text;
  const trimmed = text != null ? String(text).trim() : "";

  if (!trimmed) {
    return res.status(200).json({ ok: true, skipped: true });
  }

  try {
    await processStandupText(trimmed, "telegram");
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("webhook / Gemini / state:", err);
    // Still 200 so Telegram does not retry storms on model or parse errors.
    return res.status(200).json({ ok: true, loggedError: true });
  }
});

/** Same pipeline as Telegram, for local testing without ngrok (requires same secret header). */
app.post("/api/ingest", verifyTelegramWebhookSecret, async (req, res) => {
  const trimmed = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!trimmed) {
    return res.status(400).json({ error: "Missing or empty body.text" });
  }
  try {
    await processStandupText(trimmed, "ingest");
    return res.json({ ok: true });
  } catch (err) {
    console.error("ingest:", err);
    return res.status(500).json({ error: "Gemini or state write failed", detail: String(err.message) });
  }
});

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
