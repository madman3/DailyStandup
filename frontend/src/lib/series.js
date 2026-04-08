/** Default chart window: rolling calendar days ending "today" (matches standup day key). */
export const CHART_WINDOW_DAYS = 7;

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** X-axis labels like "May 5" (not MM-DD). */
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

/**
 * GitHub-style month grid: columns = weeks, rows = Sun–Sat.
 * @returns {{ title: string, columns: Array<Array<{ dateKey: string, inMonth: boolean, workout: boolean }>> }}
 */
export function buildWorkoutMonthGrid(endDateKey, days) {
  return buildContributionMonthGrid(endDateKey, days, null, "workout");
}

/**
 * Same layout; `active` = protein goal + calorie deficit that day.
 */
export function buildGoalsMonthGrid(endDateKey, days, proteinGoal) {
  return buildContributionMonthGrid(endDateKey, days, proteinGoal, "goals");
}

function buildContributionMonthGrid(endDateKey, days, proteinGoal, mode) {
  if (!endDateKey || !/^\d{4}-\d{2}-\d{2}$/.test(endDateKey)) {
    return { title: "", columns: [] };
  }
  const parts = endDateKey.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
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
      let active = false;
      if (inMonth && day) {
        if (mode === "workout") {
          active = dayCountsAsWorkout(day.workout);
        } else {
          active = dayMetProteinAndDeficit(day, proteinGoal ?? 150);
        }
      }
      col.push({ dateKey, inMonth, active });
      d.setUTCDate(d.getUTCDate() + 1);
    }
    columns.push(col);
  }

  return { title, columns };
}
