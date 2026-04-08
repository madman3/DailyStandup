import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  isModelNotFoundError,
  isRateLimitError,
  rateLimitWaitMs,
  sleep,
} from "./geminiRetry.js";

const DEFAULT_MODEL_FALLBACKS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];

async function generateJson(prompt) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set");
  }
  const envModel = process.env.GEMINI_MODEL?.trim();
  const modelsToTry = envModel ? [envModel] : DEFAULT_MODEL_FALLBACKS;
  const genAI = new GoogleGenerativeAI(apiKey);
  let lastErr;

  modelLoop: for (const modelName of modelsToTry) {
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: { responseMimeType: "application/json" },
    });

    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        return JSON.parse(text);
      } catch (err) {
        lastErr = err;
        if (isModelNotFoundError(err) && !envModel) continue modelLoop;
        if (isModelNotFoundError(err) && envModel) throw err;
        if (isRateLimitError(err)) {
          if (attempt < 5) {
            await sleep(rateLimitWaitMs(err, attempt));
            continue;
          }
          if (!envModel) continue modelLoop;
        }
        throw err;
      }
    }
  }
  throw lastErr ?? new Error("Gemini JSON call failed");
}

function dayBits(patch) {
  if (!patch || typeof patch !== "object") return [];
  const b = [];
  if (patch.steps != null) b.push(`${Number(patch.steps).toLocaleString()} steps`);
  if (patch.jobsApplied != null) b.push(`${patch.jobsApplied} job${patch.jobsApplied === 1 ? "" : "s"} applied`);
  if (patch.sleepHours != null) b.push(`${patch.sleepHours}h sleep`);
  if (patch.workout) b.push(`workout: ${patch.workout}`);
  if (patch.dailyScore != null) b.push(`score ${patch.dailyScore}/100`);
  const m = patch.macros || {};
  if (m.calories != null) b.push(`intake ${m.calories} kcal`);
  if (patch.caloriesBurned != null) b.push(`burned ${patch.caloriesBurned} kcal`);
  if (m.calories != null && patch.caloriesBurned != null) {
    const net = m.calories - patch.caloriesBurned;
    b.push(
      net < 0
        ? `net ${net} kcal (deficit)`
        : net > 0
          ? `net +${net} kcal (surplus)`
          : "net 0 kcal"
    );
  }
  const mx = [];
  if (m.protein != null) mx.push(`protein ${m.protein}g`);
  if (m.carbs != null) mx.push(`carbs ${m.carbs}g`);
  if (m.fat != null) mx.push(`fat ${m.fat}g`);
  if (mx.length) b.push(mx.join(", "));
  return b;
}

/**
 * Fallback copy when the chat model is skipped or fails.
 */
export function formatStandupAckSummary(extracted, perDay, primaryDateKey) {
  const lines = [];
  const keys = Object.keys(perDay || {}).sort();
  for (const dk of keys) {
    const bits = dayBits(perDay[dk]);
    if (bits.length) {
      lines.push(`• ${dk}: ${bits.join(" · ")}`);
    }
  }
  if (extracted?.taskItems?.length) {
    const titles = extracted.taskItems.map((t) => t.title).filter(Boolean).slice(0, 6);
    if (titles.length) lines.push(`• Tasks: ${titles.join("; ")}`);
  }
  if (extracted?.coachingInsight) {
    lines.push(`• ${String(extracted.coachingInsight).slice(0, 220)}`);
  }
  if (lines.length === 0) {
    return `Logged (${primaryDateKey}). I didn’t catch numbers or tasks in that message — try adding steps, sleep, or macros.`;
  }
  return `Logged:\n${lines.join("\n")}`;
}

/**
 * Short conversational Telegram reply (Gemini). Returns null on failure.
 * Set STANDUP_REPLY_MODE=simple to skip and use formatStandupAckSummary only.
 */
export async function generateStandupChatReply(userText, summaryForModel) {
  if (process.env.STANDUP_REPLY_MODE?.trim().toLowerCase() === "simple") {
    return null;
  }
  if (["1", "true", "yes"].includes(process.env.SKIP_STANDUP_CHAT_REPLY?.trim().toLowerCase())) {
    return null;
  }
  const prompt = `You reply on Telegram right after the user's daily standup was saved to their dashboard.

User message:
${JSON.stringify((userText || "").slice(0, 4000))}

What was saved (structured summary for you):
${JSON.stringify((summaryForModel || "").slice(0, 3500))}

Return ONLY valid JSON: { "reply": string }

Rules for "reply":
- One or two short sentences, under 420 characters.
- Sound human, warm, and specific—like a supportive coach, not a robot listing data.
- Briefly reflect what they actually logged (steps, sleep, tasks, etc.) when relevant.
- If almost nothing was extracted, still be kind and suggest they can add numbers next time.
- Plain text only. No markdown. At most one emoji.`;

  try {
    const raw = await generateJson(prompt);
    const reply = typeof raw?.reply === "string" ? raw.reply.trim() : "";
    if (!reply) return null;
    return reply.slice(0, 900);
  } catch {
    return null;
  }
}
