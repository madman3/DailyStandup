/** Default chart window: rolling calendar days ending "today" (matches standup day key). */
export const CHART_WINDOW_DAYS = 7;

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

/** X-axis labels like "May 5" (not MM-DD). Uses full month name. */
export function formatChartAxisLabel(ymd) {
  const parts = String(ymd || "").split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return String(ymd || "");
  return MONTH_LABEL.format(new Date(Date.UTC(y, m - 1, d)));
}

function addCalendarDays(ymd, delta) {
  const parts = String(ymd || "").split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return ymd;
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/** Non-empty workout text that isn't an explicit rest/skip counts as a workout day. */
export function dayCountsAsWorkout(workout) {
  if (workout == null || workout === "") return false;
  const s = String(workout).trim().toLowerCase();
  if (!s) return false;
  if (/^(no|none|n\/a|na|—|-)$/.test(s)) return false;
  if (/(^|\b)(skip|skipped|rest day|rest|off day|no workout)(\b|$)/.test(s)) return false;
  return true;
}

/**
 * Protein at or above goal AND net kcal &lt; 0 (deficit).
 * Missing intake, burn, or protein → not met.
 */
export function dayMetProteinAndDeficit(day, proteinGoal) {
  if (!day || typeof day !== "object") return false;
  const macros = day.macros || {};
  const p = macros.protein;
  const intake = macros.calories;
  const burned = day.caloriesBurned;
  if (p == null || proteinGoal <= 0) return false;
  if (intake == null || burned == null) return false;
  const net = intake - burned;
  return p >= proteinGoal && net < 0;
}

function rowForDate(days, date) {
  const day = days[date] || {};
  const macros = day.macros || {};
  const intake = macros.calories ?? null;
  const burned = day.caloriesBurned ?? null;
  let calorieNet = null;
  if (intake != null && burned != null) {
    calorieNet = intake - burned;
  }
  return {
    date,
    label: formatChartAxisLabel(date),
    dailyScore: day.dailyScore ?? null,
    sleepHours: day.sleepHours ?? null,
    steps: day.steps ?? null,
    jobsApplied: day.jobsApplied ?? null,
    protein: macros.protein ?? null,
    carbs: macros.carbs ?? null,
    fat: macros.fat ?? null,
    calories: intake,
    caloriesBurned: burned,
    calorieNet,
    workout: day.workout ?? null,
    coachingInsight: day.coachingInsight ?? null,
  };
}

/**
 * @param {Record<string, object>|undefined} days - state.days
 * @param {{ endDateKey?: string, windowDays?: number }} [options]
 *   - If `endDateKey` is set (YYYY-MM-DD), builds a fixed window of `windowDays` ending on that date.
 *   - Missing days appear as nulls so the chart still shows the full week.
 *   - If `endDateKey` is omitted, falls back to all keys in `days` (legacy).
 */
export function daysToSeries(days, options = {}) {
  if (!days || typeof days !== "object") return [];

  const { endDateKey, windowDays = CHART_WINDOW_DAYS } = options;

  if (endDateKey && /^\d{4}-\d{2}-\d{2}$/.test(endDateKey) && windowDays >= 1) {
    const keys = [];
    for (let i = -(windowDays - 1); i <= 0; i++) {
      keys.push(addCalendarDays(endDateKey, i));
    }
    return keys.map((date) => rowForDate(days, date));
  }

  return Object.keys(days)
    .sort()
    .map((date) => rowForDate(days, date));
}

export function latestDayEntry(series) {
  if (!series.length) return null;
  return series[series.length - 1];
}

function dateKeyFromAppliedDate(raw, fallbackYear) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const yFallback = Number(fallbackYear);

  // YYYY/MM/DD
  let m = s.match(/^(\d{4})[\/](\d{1,2})[\/](\d{1,2})$/);
  if (m) {
    const y = Number(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    if (y >= 1900 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
  }

  // MM/DD[/YYYY]
  m = s.match(/^(\d{1,2})[\/](\d{1,2})(?:[\/](\d{4}))?$/);
  if (m) {
    const mm = Number(m[1]);
    const dd = Number(m[2]);
    const y = m[3] ? Number(m[3]) : yFallback;
    if (y >= 1900 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
  }

  // Month name + day (optionally year): "May 8", "May 8, 2026"
  m = s.match(/^([A-Za-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/);
  if (m) {
    const mon = m[1].slice(0, 3).toLowerCase();
    const monthMap = {
      jan: 1,
      feb: 2,
      mar: 3,
      apr: 4,
      may: 5,
      jun: 6,
      jul: 7,
      aug: 8,
      sep: 9,
      oct: 10,
      nov: 11,
      dec: 12,
    };
    const mm = monthMap[mon];
    const dd = Number(m[2]);
    const y = m[3] ? Number(m[3]) : yFallback;
    if (mm && y >= 1900 && dd >= 1 && dd <= 31) {
      return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
  }

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

/** Overlay per-day job counts from the synced sheet onto chart/stat series rows. */
export function mergeJobsAppliedFromSheet(series, jobApplications, endDateKey) {
  const counts = new Map();
  const fallbackYear = Number(String(endDateKey || "").slice(0, 4)) || new Date().getFullYear();
  for (const row of Array.isArray(jobApplications) ? jobApplications : []) {
    const key =
      (typeof row?.appliedDateKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.appliedDateKey)
        ? row.appliedDateKey
        : null) || dateKeyFromAppliedDate(row?.appliedDate, fallbackYear);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return series.map((r) => {
    const fromSheet = counts.get(r.date);
    if (fromSheet != null) return { ...r, jobsApplied: fromSheet };
    return r;
  });
}

/**
 * Heatmap intensity 0–4 for Wispr-style streak charts (0 = padding / outside month).
 * @typedef {{ dateKey: string, inMonth: boolean, level: number }} StreakMonthCell
 */

/**
 * Month grid for workouts: intensity by activity (rest logged = mid tier).
 * @returns {{ title: string, columns: Array<Array<StreakMonthCell>> }}
 */
export function buildWorkoutMonthGrid(endDateKey, days) {
  return buildContributionMonthGrid(endDateKey, days, null, "workout");
}

/**
 * Protein logged vs daily goal (shade = how close you got that day).
 * @returns {{ title: string, columns: Array<Array<StreakMonthCell>> }}
 */
export function buildProteinIntakeMonthGrid(endDateKey, days, proteinGoal) {
  return buildContributionMonthGrid(endDateKey, days, proteinGoal, "proteinGrams");
}

function workoutLevel(day) {
  if (!day) return 1;
  if (dayCountsAsWorkout(day.workout)) return 4;
  const w = day.workout;
  if (w != null && String(w).trim() !== "") return 2;
  return 1;
}

/** @returns {number} level 1–4 for in-month days with protein data */
function proteinGramLevel(day, proteinGoal) {
  const g = proteinGoal > 0 ? proteinGoal : 110;
  const macros = day?.macros || {};
  const p = macros.protein;
  if (p == null) return 1;
  const ratio = p / g;
  if (ratio < 0.25) return 1;
  if (ratio < 0.55) return 2;
  if (ratio < 1) return 3;
  return 4;
}

function buildContributionMonthGrid(endDateKey, days, proteinGoal, mode) {
  if (!endDateKey || !/^\d{4}-\d{2}-\d{2}$/.test(endDateKey)) {
    return { title: "", columns: [] };
  }
  const parts = endDateKey.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const goal = proteinGoal ?? 110;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const first = new Date(Date.UTC(y, m - 1, 1));
  const gridStart = new Date(first);
  gridStart.setUTCDate(gridStart.getUTCDate() - gridStart.getUTCDay());
  const lastMonthDay = new Date(Date.UTC(y, m - 1, lastDay));
  const gridEnd = new Date(lastMonthDay);
  gridEnd.setUTCDate(gridEnd.getUTCDate() + (6 - gridEnd.getUTCDay()));

  const title = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 15)));

  const columns = [];
  const d = new Date(gridStart);
  while (d <= gridEnd) {
    const col = [];
    for (let r = 0; r < 7; r++) {
      const dateKey = d.toISOString().slice(0, 10);
      const inMonth = d.getUTCMonth() === m - 1 && d.getUTCFullYear() === y;
      const day = days?.[dateKey];
      /** @type {number} */
      let level = 0;

      if (!inMonth) {
        level = 0;
      } else if (mode === "workout") {
        level = workoutLevel(day);
      } else if (mode === "proteinGrams") {
        level = proteinGramLevel(day, goal);
      }

      col.push({ dateKey, inMonth, level });
      d.setUTCDate(d.getUTCDate() + 1);
    }
    columns.push(col);
  }

  return { title, columns };
}
