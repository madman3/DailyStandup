/**
 * Daily Standup — backend entry.
 * Webhook verifies Telegram's X-Telegram-Bot-Api-Secret-Token when TELEGRAM_WEBHOOK_SECRET is set.
 */
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { standupDateKeyForInstant } from "./calendarDateKey.js";
import { buildPerDayPatches, extractStandupFromMessage } from "./extractMessage.js";
import {
  generateTaskFollowUpQuestions,
  parseTaskFollowUpReply,
} from "./followUpTasks.js";
import { mergeIntoDay, readState } from "./stateStore.js";
import { formatStandupAckSummary, generateStandupChatReply } from "./standupReply.js";
import { sendTelegramMessage } from "./telegramSend.js";
import {
  clearPendingFollowUp,
  completeTodo,
  mergeTodosFromExtraction,
  setPendingFollowUp,
  updateTodoById,
} from "./todos.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const CLARIFY_MAX_LEN = 1200;

async function maybeSendTaskFollowUp(chatId, snippet) {
  if (!chatId) return;
  const state = await readState();
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

async function processStandupPipeline(trimmed, atInstant, chatId) {
  const dateKey = standupDateKeyForInstant(atInstant);
  const atIso = atInstant.toISOString();
  const base = {
    lastRawText: trimmed.slice(0, 500),
    lastMessageAt: atIso,
  };
  try {
    const extracted = await extractStandupFromMessage(trimmed, dateKey);
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
    if (chatId) {
      try {
        const summary = formatStandupAckSummary(extracted, perDay, dateKey);
        let replyText = summary;
        const aiReply = await generateStandupChatReply(trimmed, summary);
        if (aiReply) replyText = aiReply;
        await sendTelegramMessage(chatId, replyText);
      } catch (sendErr) {
        console.error("telegram standup reply failed:", sendErr);
      }
      await maybeSendTaskFollowUp(chatId, trimmed);
    }
  } catch (err) {
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
      await sendTelegramMessage(
        chatId,
        "Sorry — I couldn’t save that standup. Please try again in a moment."
      );
    }
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
<li>Complete a todo: <code>POST /api/todos/:id/complete</code> with JSON <code>{"dateKey":"YYYY-MM-DD"}</code> (optional dateKey)</li>
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

app.listen(PORT, () => {
  console.log(`Backend listening on port ${PORT}`);
});
