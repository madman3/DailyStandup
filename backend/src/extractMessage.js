import { GoogleGenerativeAI } from "@google/generative-ai";

const EXTRACTION_PROMPT = `You extract structured health and productivity data from a short daily standup message.
Return ONLY valid JSON with this exact shape (no markdown, no explanation):
{
  "sleepHours": number | null,
  "steps": number | null,
  "workout": string | null,
  "macros": { "protein": number | null, "carbs": number | null, "fat": number | null, "calories": number | null },
  "tasks": string[],
  "dailyScore": number | null,
  "coachingInsight": string | null
}
Rules:
- Use null for fields not mentioned. Use [] for tasks if none.
- workout: short phrase like "skipped", "legs day", "30 min run", or null.
- dailyScore: integer 0-100 summarizing the day described, or null if impossible to infer.
- coachingInsight: one short sentence of encouragement or advice, or null.
- Numbers must be JSON numbers, not strings.`;

function numOrNull(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, 500) : null;
}

export function normalizeExtractedPatch(raw) {
  if (!raw || typeof raw !== "object") return {};
  const m = raw.macros && typeof raw.macros === "object" ? raw.macros : {};
  let score = numOrNull(raw.dailyScore);
  if (score !== null) {
    score = Math.round(Math.max(0, Math.min(100, score)));
  }
  return {
    sleepHours: numOrNull(raw.sleepHours),
    steps: numOrNull(raw.steps),
    workout: strOrNull(raw.workout),
    macros: {
      protein: numOrNull(m.protein),
      carbs: numOrNull(m.carbs),
      fat: numOrNull(m.fat),
      calories: numOrNull(m.calories),
    },
    tasks: Array.isArray(raw.tasks) ? raw.tasks.map(String).filter(Boolean) : [],
    dailyScore: score,
    coachingInsight: strOrNull(raw.coachingInsight),
  };
}

function isRateLimitError(err) {
  const msg = String(err?.message ?? err);
  return (
    msg.includes("429") ||
    msg.includes("Too Many Requests") ||
    msg.includes("quota") ||
    msg.includes("RESOURCE_EXHAUSTED")
  );
}

function isModelNotFoundError(err) {
  const msg = String(err?.message ?? err);
  return msg.includes("404") && (msg.includes("not found") || msg.includes("Not Found"));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * gemini-1.5-flash was removed from the API (404). Defaults try current stable IDs.
 * Set GEMINI_MODEL in .env to pin one model.
 */
const DEFAULT_MODEL_FALLBACKS = ["gemini-2.5-flash-lite", "gemini-2.5-flash"];

export async function extractStandupFromMessage(userText) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set");
  }
  const envModel = process.env.GEMINI_MODEL?.trim();
  const modelsToTry = envModel ? [envModel] : DEFAULT_MODEL_FALLBACKS;

  const genAI = new GoogleGenerativeAI(apiKey);
  const prompt = `${EXTRACTION_PROMPT}\n\nMessage:\n${userText}`;
  let lastErr;

  modelLoop: for (const modelName of modelsToTry) {
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: "application/json",
      },
    });

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const parsed = JSON.parse(text);
        return normalizeExtractedPatch(parsed);
      } catch (err) {
        lastErr = err;
        if (isModelNotFoundError(err) && !envModel) {
          continue modelLoop;
        }
        if (isModelNotFoundError(err) && envModel) {
          throw err;
        }
        if (isRateLimitError(err) && attempt < 3) {
          await sleep(attempt === 1 ? 2000 : 5000);
          continue;
        }
        throw err;
      }
    }
  }

  throw lastErr ?? new Error("Gemini extraction failed");
}
