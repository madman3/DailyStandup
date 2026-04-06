/**
 * YYYY-MM-DD for a given instant in an IANA timezone (e.g. America/Los_Angeles).
 * Falls back to UTC if the zone is missing or invalid.
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

/** Day bucket for standups: uses USER_TIMEZONE (or UTC). */
export function standupDateKeyForInstant(at) {
  const tz = process.env.USER_TIMEZONE?.trim();
  return calendarDateKeyInTimezone(at, tz || "UTC");
}
