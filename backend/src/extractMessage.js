import { GoogleGenerativeAI } from "@google/generative-ai";

const EXTRACTION_PROMPT = `You extract structured health and productivity data from a daily standup message.
Return ONLY valid JSON with this exact shape (no markdown, no explanation):
{
  "sleepHours": number | null,
  "steps": number | null,
  "workout": string | null,
  "macros": { "protein": number | null, "carbs": number | null, "fat": number | null, "calories": number | null },
  "metricsByDate": {
    "YYYY-MM-DD": {
      "sleepHours": number | null,
      "steps": number | null,
      "workout": string | null,
      "macros": { "protein": number | null, "carbs": number | null, "fat": number | null, "calories": number | null },
      "dailyScore": number | null,
      "coachingInsight": string | null
    }
  },
  "taskItems": [
    {
      "title": string,
      "important": true | false | null,
      "urgent": true | false | null,
      "when": "YYYY-MM-DD" | null,
      "needsClarification": boolean
    }
  ],
  "dailyScore": number | null,
  "coachingInsight": string | null
}
Rules:
- CRITICAL — Multiple dates: If the user mentions different metrics for different days (e.g. "2880 steps today and 11300 on Apr 4" or "yesterday 8k steps"), you MUST put each metric under the correct calendar key inside metricsByDate. Use one object per date (YYYY-MM-DD). Do NOT put every number under "today" only.
- "today" / "this morning" / no date: map those metrics to the Reference calendar date provided below (same as top-level sleepHours/steps/etc. for a single-day message).
- If everything clearly refers to one day only, you may use {} for metricsByDate and fill the top-level sleepHours, steps, etc. instead.
- Use null for fields not mentioned. Use {} for metricsByDate if nothing is tied to specific dates. Use [] for taskItems if none.
- taskItems: each distinct task the user mentioned for the future / backlog (not things already done unless they imply follow-up work).
- Eisenhower-style: "important" = high impact or strategic; "urgent" = time-sensitive or must happen very soon; "when" = deadline date YYYY-MM-DD if they gave one or you can infer a specific date.
- needsClarification: true if you are not confident about important AND urgent AND when for this task (you would ask 1–2 follow-up questions). false if the message already makes priority clear enough.
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

function normalizeTaskItem(el) {
  if (!el || typeof el !== "object") return null;
  const title = String(el.title || "")
    .trim()
    .slice(0, 500);
  if (!title) return null;
  let when = null;
  if (el.when != null && el.when !== "") {
    const s = String(el.when).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) when = s;
  }
  const clarified = when != null || el.important !== null || el.urgent !== null;
  const needsClarification = Boolean(el.needsClarification) && !clarified;
  return {
    title,
    important: el.important === true ? true : el.important === false ? false : null,
    urgent: el.urgent === true ? true : el.urgent === false ? false : null,
    when,
    needsClarification,
  };
}

function taskItemsFromLegacyTasks(rawTasks) {
  if (!Array.isArray(rawTasks)) return [];
  return rawTasks
    .map((t) =>
      typeof t === "string" && t.trim()
        ? {
            title: t.trim(),
            important: null,
            urgent: null,
            when: null,
            needsClarification: false,
          }
        : null
    )
    .filter(Boolean);
}

function normalizeMacros(m) {
  const x = m && typeof m === "object" ? m : {};
  return {
    protein: numOrNull(x.protein),
    carbs: numOrNull(x.carbs),
    fat: numOrNull(x.fat),
    calories: numOrNull(x.calories),
  };
}

/** Normalize one day's worth of metrics (used for top-level and metricsByDate values). */
export function normalizeDayMetricsPartial(raw) {
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
    macros: normalizeMacros(m),
    dailyScore: score,
    coachingInsight: strOrNull(raw.coachingInsight),
  };
}

function dayHasAnyMetric(p) {
  if (!p || typeof p !== "object") return false;
  if (
    p.sleepHours != null ||
    p.steps != null ||
    p.workout != null ||
    p.dailyScore != null ||
    (p.coachingInsight && String(p.coachingInsight).trim())
  ) {
    return true;
  }
  const m = p.macros || {};
  return [m.protein, m.carbs, m.fat, m.calories].some((x) => x != null);
}

function normalizeMetricsByDate(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const [dk, val] of Object.entries(raw)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) continue;
    const p = normalizeDayMetricsPartial(val);
    if (dayHasAnyMetric(p)) out[dk] = p;
  }
  return out;
}

/**
 * Build one merge patch per calendar day. Primary day (message "today") also gets top-level
 * fields and task titles when metricsByDate did not already set those fields.
 */
export function buildPerDayPatches(extracted, primaryDateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(primaryDateKey)) {
    return { [primaryDateKey]: {} };
  }
  const byDate = extracted.metricsByDate && typeof extracted.metricsByDate === "object"
    ? extracted.metricsByDate
    : {};
  const normalizedDays = {};
  for (const [dk, val] of Object.entries(byDate)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) continue;
    if (val && typeof val === "object" && dayHasAnyMetric(val)) normalizedDays[dk] = val;
  }

  const top = {
    sleepHours: extracted.sleepHours,
    steps: extracted.steps,
    workout: extracted.workout,
    macros: extracted.macros,
    dailyScore: extracted.dailyScore,
    coachingInsight: extracted.coachingInsight,
  };

  const dates = new Set([primaryDateKey, ...Object.keys(normalizedDays)]);
  const out = {};

  for (const dk of dates) {
    if (dk !== primaryDateKey && !normalizedDays[dk]) continue;

    let patch = {};
    if (normalizedDays[dk]) {
      patch = { ...normalizedDays[dk] };
    }

    if (dk === primaryDateKey) {
      for (const field of ["sleepHours", "steps", "workout", "dailyScore", "coachingInsight"]) {
        const tv = top[field];
        if (tv != null && tv !== "" && (patch[field] == null || patch[field] === undefined)) {
          patch[field] = tv;
        }
      }
      if (top.macros) {
        patch.macros = { ...(patch.macros || {}) };
        for (const [mk, mv] of Object.entries(top.macros)) {
          if (mv != null && mv !== undefined && patch.macros[mk] == null) {
            patch.macros[mk] = mv;
          }
        }
      }
      if (Array.isArray(extracted.tasks) && extracted.tasks.length) {
        patch.tasks = extracted.tasks;
      }
    }

    out[dk] = patch;
  }

  return out;
}

export function normalizeExtractedPatch(raw) {
  if (!raw || typeof raw !== "object") return {};
  const m = raw.macros && typeof raw.macros === "object" ? raw.macros : {};
  let score = numOrNull(raw.dailyScore);
  if (score !== null) {
    score = Math.round(Math.max(0, Math.min(100, score)));
  }
  let taskItems = Array.isArray(raw.taskItems)
    ? raw.taskItems.map(normalizeTaskItem).filter(Boolean)
    : [];
  if (taskItems.length === 0 && Array.isArray(raw.tasks) && raw.tasks.length) {
    taskItems = taskItemsFromLegacyTasks(raw.tasks);
  }
  const tasks = taskItems.map((t) => t.title);
  return {
    sleepHours: numOrNull(raw.sleepHours),
    steps: numOrNull(raw.steps),
    workout: strOrNull(raw.workout),
    macros: normalizeMacros(m),
    metricsByDate: normalizeMetricsByDate(raw.metricsByDate),
    tasks,
    taskItems,
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

export async function extractStandupFromMessage(userText, calendarTodayKey) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not set");
  }
  const envModel = process.env.GEMINI_MODEL?.trim();
  const modelsToTry = envModel ? [envModel] : DEFAULT_MODEL_FALLBACKS;

  const genAI = new GoogleGenerativeAI(apiKey);
  const ref =
    calendarTodayKey && /^\d{4}-\d{2}-\d{2}$/.test(String(calendarTodayKey).trim())
      ? `\n\nReference calendar date for "today" / "this morning" (map relative dates to YYYY-MM-DD using this): ${String(calendarTodayKey).trim()}`
      : "";
  const prompt = `${EXTRACTION_PROMPT}${ref}\n\nMessage:\n${userText}`;
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
