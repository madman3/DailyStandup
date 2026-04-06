/** Default chart window: rolling calendar days ending "today" (matches standup day key). */
export const CHART_WINDOW_DAYS = 7;

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

function rowForDate(days, date) {
  const day = days[date] || {};
  const macros = day.macros || {};
  return {
    date,
    label: date.slice(5),
    dailyScore: day.dailyScore ?? null,
    sleepHours: day.sleepHours ?? null,
    steps: day.steps ?? null,
    protein: macros.protein ?? null,
    carbs: macros.carbs ?? null,
    fat: macros.fat ?? null,
    calories: macros.calories ?? null,
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
