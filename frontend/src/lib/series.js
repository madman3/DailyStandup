/** Turn state.days into sorted rows for Recharts (date ascending). */
export function daysToSeries(days) {
  if (!days || typeof days !== "object") return [];
  return Object.keys(days)
    .sort()
    .map((date) => {
      const d = days[date] || {};
      const m = d.macros || {};
      return {
        date,
        label: date.slice(5),
        dailyScore: d.dailyScore ?? null,
        sleepHours: d.sleepHours ?? null,
        steps: d.steps ?? null,
        protein: m.protein ?? null,
        carbs: m.carbs ?? null,
        fat: m.fat ?? null,
        calories: m.calories ?? null,
        workout: d.workout ?? null,
        coachingInsight: d.coachingInsight ?? null,
        tasks: Array.isArray(d.tasks) ? d.tasks : [],
      };
    });
}

export function latestDayEntry(series) {
  if (!series.length) return null;
  return series[series.length - 1];
}
