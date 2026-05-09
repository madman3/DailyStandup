/**
 * Daily Standup — backend entry.
 * Webhook verifies Telegram's X-Telegram-Bot-Api-Secret-Token when TELEGRAM_WEBHOOK_SECRET is set.
 */
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import cron from "node-cron";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import session from "express-session";
import { standupDateKeyForInstant } from "./calendarDateKey.js";
import { buildPerDayPatches } from "./extractMessage.js";
import { parseStandupHybrid } from "./parseStandupHybrid.js";
import {
  generateTaskFollowUpQuestions,
  parseTaskFollowUpReply,
} from "./followUpTasks.js";
import {
  appendStandupHistory,
  mergeIntoDay,
  readState,
  setGeminiPaused,
} from "./stateStore.js";
import {
  geminiCircuitStatus,
  isGeminiCircuitOpen,
  openGeminiCircuit,
  resetGeminiCircuit,
} from "./geminiCircuit.js";
import { isQuotaExhaustedError } from "./geminiRetry.js";
import { formatStandupAckSummary } from "./standupReply.js";
import { sendTelegramMessage } from "./telegramSend.js";
import {
  clearPendingFollowUp,
  completeTodo,
  mergeTodosFromExtraction,
  setPendingFollowUp,
  updateTodoById,
} from "./todos.js";
import { isSheetsSyncConfigured, syncGoogleSheetJobs } from "./sheetsSync.js";
import { getPool, initLifeosDatabase, isPostgresMode } from "./lifeosDb.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const CLARIFY_MAX_LEN = 1200;

async function maybeSendTaskFollowUp(chatId, snippet) {
  if (!chatId) return;
  const state = await readState();
  if (state.geminiPaused || isGeminiCircuitOpen()) return;
  if (state.pendingFollowUp) return;
  const first = state.todos.find(
    (t) => t.status === "active" && t.needsClarification && !t.followUpSent
  );
  if (!first) return;
  const qs = await generateTaskFollowUpQuestions(first.title, snippet || "");
  if (qs.length === 0) {
    await updateTodoById(first.id, { followUpSent: true, needsClarification: false });
    await maybeSendTaskFollowUp(chatId, snippet);
    return;
  }
  const body = `📋 Task: ${first.title}\n\nA couple quick questions:\n${qs
    .map((q, i) => `${i + 1}) ${q}`)
    .join("\n")}\n\nReply in one message. Send /cancel to skip.`;
  await sendTelegramMessage(chatId, body);
  await updateTodoById(first.id, { followUpSent: true });
  await setPendingFollowUp({
    chatId,
    todoId: first.id,
    taskTitle: first.title,
    questionsSent: qs,
  });
}

async function handleClarificationReply(trimmed, chatId, dateKey) {
  const state = await readState();
  const p = state.pendingFollowUp;
  if (!p || p.chatId !== chatId || !p.todoId) {
    await clearPendingFollowUp();
    return;
  }
  const todo = state.todos.find((t) => t.id === p.todoId);
  if (!todo) {
    await clearPendingFollowUp();
    return;
  }
  const questions = p.questionsSent || [];
  try {
    const parsed = await parseTaskFollowUpReply(trimmed, todo.title, questions, dateKey);
    await updateTodoById(todo.id, {
      important: parsed.important,
      urgent: parsed.urgent,
      when: parsed.when,
      needsClarification: false,
      followUpSent: false,
    });
    await clearPendingFollowUp();
    await sendTelegramMessage(
      chatId,
      `Got it — saved priority for "${todo.title.slice(0, 120)}".`
    );
    await maybeSendTaskFollowUp(chatId, "");
  } catch (e) {
    console.error("clarification parse:", e);
    await sendTelegramMessage(
      chatId,
      "Could not read that reply — try again in a short message, or send /cancel."
    );
  }
}

function geminiDisabledByEnv() {
  return ["1", "true", "yes"].includes(process.env.GEMINI_DISABLE?.trim().toLowerCase() || "");
}

async function processStandupPipeline(trimmed, atInstant, chatId, options = {}) {
  const { historySource, skipHistory } = options;
  const dateKey = standupDateKeyForInstant(atInstant);
  const atIso = atInstant.toISOString();
  const base = {
    lastRawText: trimmed.slice(0, 500),
    lastMessageAt: atIso,
  };

  const state = await readState();
  const paused = state.geminiPaused || geminiDisabledByEnv();
  const circuit = isGeminiCircuitOpen();

  if (paused || circuit) {
    await mergeIntoDay(dateKey, {
      ...base,
      aiParseSkipped: true,
    });
    if (!skipHistory) {
      const histSrc = historySource ?? (chatId ? "telegram" : "ingest");
      await appendStandupHistory({ text: trimmed, at: atIso, source: histSrc });
    }
    if (chatId) {
      let msg;
      if (paused) {
        msg = geminiDisabledByEnv()
          ? "Logged. GEMINI_DISABLE is on — message saved as text only."
          : "Logged. AI parsing is paused — message saved. Send /resume to parse with Gemini again.";
      } else {
        msg =
          "Logged. AI cool-down after quota/errors — message saved. Wait or send /resume, then replay with /api/replay if needed.";
      }
      await sendTelegramMessage(chatId, msg);
    }
    return;
  }

  try {
    const { extracted, completedTodoIds } = await parseStandupHybrid(trimmed, dateKey, state);
    resetGeminiCircuit();
    const { taskItems } = extracted;
    const perDay = buildPerDayPatches(extracted, dateKey);
    for (const [dk, patch] of Object.entries(perDay)) {
      const payload = { ...patch };
      if (dk === dateKey) {
        Object.assign(payload, base);
      }
      await mergeIntoDay(dk, payload);
    }
    await mergeTodosFromExtraction(taskItems, dateKey);
    for (const todoId of completedTodoIds) {
      try {
        await completeTodo(todoId, dateKey);
      } catch (ce) {
        console.error("completeTodo from standup:", ce);
      }
    }
    if (!skipHistory) {
      const histSrc = historySource ?? (chatId ? "telegram" : "ingest");
      await appendStandupHistory({ text: trimmed, at: atIso, source: histSrc });
    }
    if (chatId) {
      try {
        const summary = formatStandupAckSummary(extracted, perDay, dateKey);
        await sendTelegramMessage(chatId, summary);
      } catch (sendErr) {
        console.error("telegram standup reply failed:", sendErr);
      }
      await maybeSendTaskFollowUp(chatId, trimmed);
    }
  } catch (err) {
    if (isQuotaExhaustedError(err)) {
      openGeminiCircuit();
    }
    await mergeIntoDay(dateKey, {
      ...base,
      lastError: String(err.message),
    });
    throw err;
  }
}

async function processTelegramMessage(trimmed, atInstant, chatId) {
  const dateKey = standupDateKeyForInstant(atInstant);
  const lower = trimmed.toLowerCase();

  if (lower === "/cancel") {
    if (chatId) {
      const st = await readState();
      if (st.pendingFollowUp?.todoId) {
        await updateTodoById(st.pendingFollowUp.todoId, { followUpSent: false });
      }
      await clearPendingFollowUp();
      await sendTelegramMessage(chatId, "Cancelled — ask again anytime.");
    }
    return;
  }

  if (lower === "/pause") {
    if (chatId) {
      await setGeminiPaused(true);
      await sendTelegramMessage(
        chatId,
        "AI parsing paused. New standups save as text only (no Gemini). Send /resume when quota is OK."
      );
    }
    return;
  }

  if (lower === "/resume") {
    if (chatId) {
      await setGeminiPaused(false);
      resetGeminiCircuit();
      await sendTelegramMessage(
        chatId,
        "AI parsing resumed and quota cool-down cleared. Send a standup or use replay to re-parse."
      );
    }
    return;
  }

  if (lower === "/aistatus") {
    if (chatId) {
      const st = await readState();
      const circ = geminiCircuitStatus();
      await sendTelegramMessage(
        chatId,
        [
          `Paused: ${st.geminiPaused ? "yes (/resume)" : "no"}`,
          `Cool-down: ${circ.open ? `active until ${circ.openUntilIso}` : "none"}`,
          `GEMINI_DISABLE: ${geminiDisabledByEnv() ? "on" : "off"}`,
        ].join("\n")
      );
    }
    return;
  }

  const state = await readState();
  if (state.pendingFollowUp && chatId && state.pendingFollowUp.chatId === chatId) {
    if (trimmed.length >= CLARIFY_MAX_LEN) {
      if (state.pendingFollowUp.todoId) {
        await updateTodoById(state.pendingFollowUp.todoId, { followUpSent: false });
      }
      await clearPendingFollowUp();
      await sendTelegramMessage(
        chatId,
        "Got it — logging this as a full standup (previous questions set aside)."
      );
    } else {
      await handleClarificationReply(trimmed, chatId, dateKey);
      return;
    }
  }

  try {
    await processStandupPipeline(trimmed, atInstant, chatId);
  } catch (e) {
    console.error("processStandupPipeline:", e);
    if (chatId) {
      const msg = isQuotaExhaustedError(e)
        ? "Gemini quota/limit hit — your message is saved as text. Use /pause to stop parsing until tomorrow, or /resume after upgrading quota. Replay later: POST /api/replay."
        : "Sorry — I couldn’t parse that standup. Message text is saved; try again later or check the dashboard error.";
      await sendTelegramMessage(chatId, msg);
    }
  }
}

const app = express();
const PORT = process.env.PORT ?? 3001;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
const AUTH_COOKIE_NAME = "dash_auth";

// Allow the Vercel frontend (different origin) to send cookies to this API.
app.use(
  cors({
    origin: (origin, callback) => callback(null, true),
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD?.trim();
if (DASHBOARD_PASSWORD) {
  // Required for correctly setting `secure` cookies behind Fly's proxy.
  app.set("trust proxy", 1);

  const sessionSecret =
    process.env.DASHBOARD_SESSION_SECRET?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    WEBHOOK_SECRET ||
    "dev-dashboard-session-secret";
  const secureCookies = process.env.NODE_ENV === "production";
  const cookieOptions = {
    httpOnly: true,
    secure: secureCookies,
    sameSite: secureCookies ? "none" : "lax",
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
  };

  function parseCookies(req) {
    const raw = req.headers?.cookie;
    if (!raw) return {};
    const out = {};
    for (const part of raw.split(";")) {
      const [k, ...rest] = part.trim().split("=");
      if (!k) continue;
      out[k] = decodeURIComponent(rest.join("=") || "");
    }
    return out;
  }

  function hmac(value) {
    return crypto.createHmac("sha256", sessionSecret).update(value).digest("base64url");
  }

  function makeAuthCookieValue() {
    const expiresAt = String(Date.now() + 1000 * 60 * 60 * 24 * 30);
    const payload = `v1.${expiresAt}`;
    const sig = hmac(payload);
    return `${payload}.${sig}`;
  }

  function timingSafeEqualString(a, b) {
    const aa = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    if (aa.length !== bb.length) return false;
    return crypto.timingSafeEqual(aa, bb);
  }

  function hasValidAuthCookie(req) {
    const token = parseCookies(req)[AUTH_COOKIE_NAME];
    if (!token) return false;
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "v1") return false;
    const expiresAt = Number(parts[1]);
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;
    const payload = `${parts[0]}.${parts[1]}`;
    const expectedSig = hmac(payload);
    return timingSafeEqualString(parts[2], expectedSig);
  }

  app.use(
    session({
      name: "dash_session",
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: cookieOptions,
    })
  );

  app.post("/api/login", (req, res) => {
    const password = req.body?.password;
    if (typeof password !== "string" || password.trim() === "") {
      return res.status(400).json({ error: "Missing password" });
    }
    if (password !== DASHBOARD_PASSWORD) {
      return res.status(401).json({ error: "unauthorized" });
    }
    req.session.authenticated = true;
    req.session.save(() => {
      res.cookie(AUTH_COOKIE_NAME, makeAuthCookieValue(), cookieOptions);
      res.json({ ok: true });
    });
  });

  app.post("/api/logout", (req, res) => {
    req.session.destroy(() => {
      res.clearCookie("dash_session");
      res.clearCookie(AUTH_COOKIE_NAME);
      res.json({ ok: true });
    });
  });

  // Protect dashboard API endpoints from unauthenticated access.
  // Exempt Telegram/webhook and internal scripts that already use TELEGRAM_WEBHOOK_SECRET.
  app.use((req, res, next) => {
    if (req.method === "OPTIONS") return next();
    const p = req.path;
    const skip =
      p === "/health" ||
      p === "/" ||
      p === "/api/login" ||
      p === "/api/logout" ||
      p === "/webhook" ||
      p === "/api/ingest" ||
      p === "/api/jobs/sync" ||
      p === "/api/health-sync" ||
      p === "/api/replay" ||
      p === "/api/standup-history";
    if (skip) return next();
    if (req.session?.authenticated || hasValidAuthCookie(req)) return next();
    return res.status(401).json({ error: "unauthorized" });
  });
} else {
  console.warn("[dashboard-auth] DASHBOARD_PASSWORD is not set — dashboard API is unprotected.");
}

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
<li>Complete a todo: <code>POST /api/todos/:id/complete</code> with JSON <code>{"dateKey":"YYYY-MM-DD"}</code> (optional dateKey)</li>
<li>Replay a saved standup (no Telegram): <code>POST /api/replay</code> with JSON <code>{"index":0}</code> (0 = most recent) and the same secret header as ingest</li>
<li>Sync jobs from Google Sheet: <code>POST /api/jobs/sync</code> (same secret header) — also runs hourly when configured</li>
<li>List replay queue: <code>GET /api/standup-history</code> (same header)</li>
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
    const body = { error: "Could not read state" };
    if (process.env.NODE_ENV !== "production") {
      body.detail = err instanceof Error ? err.message : String(err);
    }
    res.status(500).json(body);
  }
});

app.post("/api/health-sync", async (req, res) => {
  const sent = req.get("X-Telegram-Bot-Api-Secret-Token");
  if (!WEBHOOK_SECRET) {
    console.warn(
      "TELEGRAM_WEBHOOK_SECRET is not set — refusing /api/health-sync. Add it to .env."
    );
    return res.status(503).json({ error: "Webhook secret not configured" });
  }
  if (!sent || sent !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const body = req.body || {};
  const date = req.query.date || body.date;
  const parsed = new Date(date);
  if (!date || Number.isNaN(parsed.getTime())) {
    return res.status(400).json({ error: "Invalid date." });
  }
  const normalizedDate = parsed.toISOString().split("T")[0];

  const rawSleep = req.query.sleepHours ?? body.sleepHours;
  let sleepHours =
    rawSleep !== undefined && rawSleep !== null && rawSleep !== ""
      ? parseFloat(rawSleep)
      : undefined;

  if (sleepHours !== undefined) {
    if (isNaN(sleepHours)) {
      return res.status(400).json({ error: "Invalid sleepHours. Expected number 0-24." });
    }
    sleepHours = Math.round(sleepHours * 100) / 100;
    if (sleepHours < 0 || sleepHours > 24) {
      return res.status(400).json({ error: "Invalid sleepHours. Expected number 0-24." });
    }
  }

  const patch = {};
  const outMerged = {};

  if (sleepHours !== undefined) {
    patch.sleepHours = sleepHours;
    outMerged.sleepHours = sleepHours;
  }

  if (body.steps !== undefined) {
    const v = body.steps;
    if (!Number.isInteger(v) || v <= 0) {
      return res.status(400).json({ error: "Invalid steps. Expected positive integer." });
    }
    patch.steps = v;
    outMerged.steps = v;
  }

  try {
    await mergeIntoDay(normalizedDate, patch);
    res.status(200).json({ ok: true, date: normalizedDate, merged: outMerged });
  } catch (e) {
    console.error("health-sync:", e);
    res.status(500).json({ error: String(e.message) });
  }
});

app.post("/api/todos/:id/complete", async (req, res) => {
  const { id } = req.params;
  const dk =
    typeof req.body?.dateKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.body.dateKey.trim())
      ? req.body.dateKey.trim()
      : standupDateKeyForInstant(new Date());
  try {
    const result = await completeTodo(id, dk);
    if (!result.ok) {
      return res.status(404).json(result);
    }
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message) });
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
  if (process.env.NODE_ENV !== "production") {
    console.log(
      "[webhook] update_id=%s has_message=%s",
      update.update_id ?? "?",
      Boolean(update.message?.text ?? update.edited_message?.text)
    );
  }
  const msg = update.message ?? update.edited_message ?? update.channel_post;
  const text = msg?.text;
  const trimmed = text != null ? String(text).trim() : "";
  const atInstant =
    msg?.date != null && typeof msg.date === "number"
      ? new Date(msg.date * 1000)
      : new Date();
  const chatId = msg?.chat?.id;

  if (!trimmed) {
    return res.status(200).json({ ok: true, skipped: true });
  }

  try {
    await processTelegramMessage(trimmed, atInstant, chatId);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("webhook / Gemini / state:", err);
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
    await processStandupPipeline(trimmed, new Date(), null);
    return res.json({ ok: true });
  } catch (err) {
    console.error("ingest:", err);
    res.status(500).json({ error: "Gemini or state write failed", detail: String(err.message) });
  }
});

/** Recent standup texts (for replay). Same auth as webhook. */
app.get("/api/standup-history", verifyTelegramWebhookSecret, async (_req, res) => {
  try {
    const state = await readState();
    const hist = Array.isArray(state.standupHistory) ? state.standupHistory : [];
    const entries = [...hist]
      .reverse()
      .slice(0, 20)
      .map((h) => ({
        id: h.id,
        at: h.at,
        source: h.source,
        preview: String(h.text || "").slice(0, 200),
      }));
    res.json({ count: hist.length, entries });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message) });
  }
});

/** Re-run extraction on a previously stored message (uses original timestamp for day keys). */
app.post("/api/replay", verifyTelegramWebhookSecret, async (req, res) => {
  const raw = req.body?.index;
  const index = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  try {
    const state = await readState();
    const hist = Array.isArray(state.standupHistory) ? state.standupHistory : [];
    if (hist.length === 0) {
      return res.status(400).json({
        error: "No stored standups yet. Send at least one successful standup first.",
      });
    }
    const i = hist.length - 1 - index;
    if (i < 0 || i >= hist.length) {
      return res.status(400).json({ error: "Invalid index" });
    }
    const entry = hist[i];
    await processStandupPipeline(entry.text, new Date(entry.at), null, {
      historySource: "replay",
      skipHistory: true,
    });
    res.json({
      ok: true,
      replayed: { at: entry.at, index, preview: String(entry.text || "").slice(0, 120) },
    });
  } catch (e) {
    console.error("replay:", e);
    res.status(500).json({ error: String(e.message) });
  }
});

app.post("/api/jobs/sync", verifyTelegramWebhookSecret, async (_req, res) => {
  try {
    const out = await syncGoogleSheetJobs();
    if (out.skipped) {
      return res.status(503).json(out);
    }
    if (out.error) {
      return res.status(400).json(out);
    }
    res.json(out);
  } catch (e) {
    console.error("jobs sync:", e);
    res.status(500).json({ error: String(e.message) });
  }
});

async function bootstrap() {
  try {
    await initLifeosDatabase();
  } catch (err) {
    console.error("[lifeosDb] init failed:", err);
    process.exit(1);
  }

  if (isPostgresMode()) {
    const pool = await getPool();
    process.once("SIGTERM", () => {
      pool
        .end()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
  }

  app.listen(PORT, () => {
    console.log(`Backend listening on port ${PORT}`);
    if (isSheetsSyncConfigured()) {
      cron.schedule("0 * * * *", () => {
        syncGoogleSheetJobs().catch((e) => console.error("[sheets cron]", e));
      });
      syncGoogleSheetJobs().catch((e) => console.error("[sheets] initial sync", e));
    } else {
      console.log("[sheets] Sheet sync off — set GOOGLE_SHEET_ID + service account env vars.");
    }
  });
}

bootstrap();
