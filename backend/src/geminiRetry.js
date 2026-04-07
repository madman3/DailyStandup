/**
 * Shared Gemini error helpers and rate-limit backoff.
 * Free tier often returns 429 with "Please retry in Ns" — short sleeps are not enough.
 */

export function parseRetryDelayMs(err) {
  const msg = String(err?.message ?? err);
  const m1 = msg.match(/Please retry in ([\d.]+)s/i);
  if (m1) return Math.ceil(parseFloat(m1[1], 10) * 1000);
  const m2 = msg.match(/retryDelay["']:\s*["'](\d+)s/i);
  if (m2) return parseInt(m2[1], 10) * 1000;
  const m3 = msg.match(/retry in ([\d.]+)\s*s/i);
  if (m3) return Math.ceil(parseFloat(m3[1], 10) * 1000);
  return null;
}

export function isRateLimitError(err) {
  const msg = String(err?.message ?? err);
  return (
    msg.includes("429") ||
    msg.includes("Too Many Requests") ||
    msg.includes("quota") ||
    msg.includes("RESOURCE_EXHAUSTED")
  );
}

export function isModelNotFoundError(err) {
  const msg = String(err?.message ?? err);
  return msg.includes("404") && (msg.includes("not found") || msg.includes("Not Found"));
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait time before retrying after 429. Caps to avoid Telegram webhook timeouts (~60s total risk).
 */
export function rateLimitWaitMs(err, attempt) {
  const fromApi = parseRetryDelayMs(err);
  const fallback = 2000 * Math.min(attempt, 8);
  const base = fromApi ?? fallback;
  return Math.min(base + 500, 55000);
}
