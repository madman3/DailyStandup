import {
  extractStandupFromMessage,
  normalizeExtractedPatch,
} from "./extractMessage.js";

function normTitle(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function numOrLocal(v) {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Fast path: numbers + simple phrases. No LLM.
 * Returns a raw object suitable for normalizeExtractedPatch.
 */
export function extractRuleBasedStandup(text, _calendarTodayKey) {
  const t = String(text || "");
  const lower = t.toLowerCase();
  const out = {
    sleepHours: null,
    steps: null,
    jobsApplied: null,
    workout: null,
    caloriesBurned: null,
    macros: { protein: null, carbs: null, fat: null, calories: null },
    metricsByDate: {},
    taskItems: [],
    dailyScore: null,
  };

  let matchedRegions = [];

  const reSteps = /(\d[\d,]*)\s*steps?\b/gi;
  let m;
  while ((m = reSteps.exec(t)) !== null) {
    const n = numOrLocal(m[1]);
    if (n != null) out.steps = n;
    matchedRegions.push([m.index, m.index + m[0].length]);
  }

  const reSleepH = /(\d+(?:\.\d+)?)\s*h(?:ours?)?(?:\s+of)?\s*sleep|sleep(?:\s*(?:was|about|:))?\s*(\d+(?:\.\d+)?)\s*h/gi;
  while ((m = reSleepH.exec(t)) !== null) {
    const n = numOrLocal(m[1] || m[2]);
    if (n != null) out.sleepHours = n;
    matchedRegions.push([m.index, m.index + m[0].length]);
  }

  const reSleepBare = /\b(\d+(?:\.\d+)?)\s*hours?\s+sleep\b/gi;
  while ((m = reSleepBare.exec(t)) !== null) {
    const n = numOrLocal(m[1]);
    if (n != null) out.sleepHours = n;
    matchedRegions.push([m.index, m.index + m[0].length]);
  }

  const reJobs =
    /(\d+)\s*jobs?\s+applied|applied\s*(?:to\s*)?(\d+)\s*jobs?|(\d+)\s*applications?\b/gi;
  while ((m = reJobs.exec(t)) !== null) {
    const n = numOrLocal(m[1] || m[2] || m[3]);
    if (n != null) out.jobsApplied = n;
    matchedRegions.push([m.index, m.index + m[0].length]);
  }

  const reBurn =
    /(?:burn(?:ed)?|burned)\s+(\d[\d,]*)\s*(?:kcal|cal)?|(\d[\d,]*)\s*(?:kcal|cal)\s*(?:burned|out)/gi;
  while ((m = reBurn.exec(t)) !== null) {
    const n = numOrLocal(m[1] || m[2]);
    if (n != null) out.caloriesBurned = n;
    matchedRegions.push([m.index, m.index + m[0].length]);
  }

  const reIntake = /(\d[\d,]*)\s*(?:kcal|cal)\s*(?:intake|eaten|food)|intake\s+(\d[\d,]*)/gi;
  while ((m = reIntake.exec(t)) !== null) {
    const n = numOrLocal(m[1] || m[2]);
    if (n != null) out.macros.calories = n;
    matchedRegions.push([m.index, m.index + m[0].length]);
  }

  const reProtein = /(\d+(?:\.\d+)?)\s*g\s*protein|protein\s+(\d+(?:\.\d+)?)\s*g/gi;
  while ((m = reProtein.exec(t)) !== null) {
    const n = numOrLocal(m[1] || m[2]);
    if (n != null) out.macros.protein = n;
    matchedRegions.push([m.index, m.index + m[0].length]);
  }

  const reWorkoutSkip = /\b(no\s+workout|rest\s+day|skipped\s+(?:the\s+)?(?:gym|workout))\b/i;
  if (reWorkoutSkip.test(t)) {
    out.workout = "skipped";
    const mm = reWorkoutSkip.exec(t);
    if (mm) matchedRegions.push([mm.index, mm.index + mm[0].length]);
  }

  const ruleNorm = normalizeExtractedPatch(out);
  const anyMetric =
    ruleNorm.steps != null ||
    ruleNorm.sleepHours != null ||
    ruleNorm.jobsApplied != null ||
    ruleNorm.caloriesBurned != null ||
    ruleNorm.workout != null ||
    Object.values(ruleNorm.macros || {}).some((x) => x != null);

  return { raw: out, normalized: ruleNorm, anyMetric, matchedRegions };
}

function stripMatchedRegions(text, regions) {
  if (!regions.length) return text;
  const sorted = [...regions].sort((a, b) => a[0] - b[0]);
  let out = "";
  let cursor = 0;
  for (const [a, b] of sorted) {
    if (a > cursor) out += text.slice(cursor, a);
    cursor = Math.max(cursor, b);
  }
  out += text.slice(cursor);
  return out.replace(/\s+/g, " ").trim();
}

const MULTIDAY_CUES =
  /\b(yesterday|last\s+night|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}\/\d{1,2}|two\s+days\s+ago)\b/i;

function shouldCallLlm(text, rule) {
  if (MULTIDAY_CUES.test(text)) return true;

  const stripped = stripMatchedRegions(text, rule.matchedRegions);
  const rest = stripped.length;

  if (!rule.anyMetric && text.trim().length > 8) return true;

  if (rest > 28) return true;

  if (/\b(task|todo|need\s+to|remember\s+to|deadline|apply|interview)\b/i.test(text) && rest > 10) {
    return true;
  }

  return false;
}

function mergeRuleAndLlm(ruleNorm, llmNorm) {
  if (!llmNorm) return ruleNorm;
  const out = { ...llmNorm };
  const nums = ["sleepHours", "steps", "jobsApplied", "caloriesBurned"];
  for (const k of nums) {
    if (ruleNorm[k] != null) out[k] = ruleNorm[k];
  }
  if (ruleNorm.workout != null) out.workout = ruleNorm.workout;

  const rm = ruleNorm.macros || {};
  const lm = { ...(out.macros || {}) };
  for (const mk of ["protein", "carbs", "fat", "calories"]) {
    if (rm[mk] != null) lm[mk] = rm[mk];
  }
  out.macros = lm;

  const byTitle = new Map();
  for (const item of llmNorm.taskItems || []) {
    if (item?.title) byTitle.set(normTitle(item.title), item);
  }
  for (const item of ruleNorm.taskItems || []) {
    if (item?.title) byTitle.set(normTitle(item.title), item);
  }
  out.taskItems = [...byTitle.values()];

  const mbd = { ...(llmNorm.metricsByDate || {}) };
  for (const [dk, val] of Object.entries(ruleNorm.metricsByDate || {})) {
    if (!mbd[dk]) mbd[dk] = val;
  }
  out.metricsByDate = mbd;

  if (ruleNorm.dailyScore != null) out.dailyScore = ruleNorm.dailyScore;
  return out;
}

/**
 * Infer completed todos from natural language (no LLM).
 */
export function inferCompletedTodoIds(text, todos) {
  const lower = text.toLowerCase();
  if (!/\b(done|finished|completed|check(?:ed)?\s*off|wrapped\s+up|knocked\s+out)\b/i.test(lower)) {
    return [];
  }
  const active = (todos || []).filter((t) => t && t.status === "active");
  const ids = [];
  for (const t of active) {
    const words = normTitle(t.title)
      .split(" ")
      .filter((w) => w.length > 2);
    if (words.length === 0) continue;
    const hits = words.filter((w) => lower.includes(w)).length;
    const need = Math.min(2, Math.max(1, Math.ceil(words.length / 2)));
    if (hits >= need) ids.push(t.id);
  }
  return ids;
}

/**
 * Rule-based parse first; call Gemini only when heuristics say it's needed.
 */
export async function parseStandupHybrid(userText, calendarTodayKey, _state) {
  const rule = extractRuleBasedStandup(userText, calendarTodayKey);
  const needsLlm = shouldCallLlm(userText, rule);
  let usedLlm = false;
  let llmNorm = null;

  if (needsLlm) {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (apiKey) {
      llmNorm = await extractStandupFromMessage(userText, calendarTodayKey);
      usedLlm = true;
    }
  }

  const extracted = mergeRuleAndLlm(rule.normalized, llmNorm);
  const completedTodoIds = inferCompletedTodoIds(userText, _state?.todos || []);

  return { extracted, usedLlm, completedTodoIds };
}
