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

/**
 * 1–2 short questions to pin down important / urgent / when (Eisenhower + deadline).
 */
export async function generateTaskFollowUpQuestions(taskTitle, userMessageSnippet) {
  const prompt = `The user mentioned a task in a daily standup. You need 1–2 short follow-up questions (like a thoughtful coach) to pin down:
- whether it is IMPORTANT (strategic / high impact),
- whether it is URGENT (must happen very soon),
- WHEN it should be done (date or rough timeframe).

Task: ${JSON.stringify(taskTitle)}
Their message (snippet): ${JSON.stringify((userMessageSnippet || "").slice(0, 1500))}

Return ONLY valid JSON: { "questions": string[] }
Rules:
- questions: 1 or 2 items, each one concise question the user can answer in one short reply.
- If priority is already obvious from the message, return { "questions": [] }.
- Do not repeat the task title as a question.`;

  const raw = await generateJson(prompt);
  const questions = Array.isArray(raw.questions)
    ? raw.questions.map((q) => String(q).trim()).filter(Boolean).slice(0, 2)
    : [];
  return questions;
}

/**
 * Parse the user's reply into structured priority fields.
 */
export async function parseTaskFollowUpReply(
  replyText,
  taskTitle,
  questionsAsked,
  calendarTodayIso
) {
  const todayHint =
    calendarTodayIso && /^\d{4}-\d{2}-\d{2}$/.test(calendarTodayIso)
      ? `Calendar "today" for this user: ${calendarTodayIso}. Use this if they say "today" or "tomorrow".`
      : "";
  const prompt = `The user replied to follow-up questions about a task. Extract priority fields.

Task: ${JSON.stringify(taskTitle)}
Questions they were asked: ${JSON.stringify(questionsAsked)}
Their reply: ${JSON.stringify((replyText || "").slice(0, 2000))}
${todayHint}

Return ONLY valid JSON:
{
  "important": true | false | null,
  "urgent": true | false | null,
  "when": "YYYY-MM-DD" | null
}
Rules:
- Use null if you cannot infer from the reply.
- "when" must be ISO date YYYY-MM-DD if they gave a specific date; if they said "today" use today's date conceptually — use the best single date if possible, else null.
- Numbers must be JSON booleans or null, not strings.`;

  const raw = await generateJson(prompt);
  return {
    important: raw.important === true ? true : raw.important === false ? false : null,
    urgent: raw.urgent === true ? true : raw.urgent === false ? false : null,
    when:
      raw.when != null && String(raw.when).trim() && /^\d{4}-\d{2}-\d{2}$/.test(String(raw.when).trim())
        ? String(raw.when).trim()
        : null,
  };
}
