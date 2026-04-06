/**
 * Must match backend standup day logic (USER_TIMEZONE / VITE_USER_TIMEZONE).
 */
export function calendarDateKeyInTimezone(date, timeZone) {
  const tz = typeof timeZone === "string" && timeZone.trim() ? timeZone.trim() : "UTC";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }
}

export function standupTodayKey() {
  const tz = import.meta.env.VITE_USER_TIMEZONE || "UTC";
  return calendarDateKeyInTimezone(new Date(), tz);
}
