/**
 * In-memory cooldown after quota exhaustion so we don't hammer Gemini all night.
 * Resets on process restart, successful parse, or /resume.
 */

let openUntil = 0;

function cooldownMs() {
  const n = Number(process.env.GEMINI_COOLDOWN_MS);
  return Number.isFinite(n) && n > 0 ? n : 30 * 60 * 1000;
}

export function isGeminiCircuitOpen() {
  return Date.now() < openUntil;
}

export function openGeminiCircuit() {
  openUntil = Date.now() + cooldownMs();
}

export function resetGeminiCircuit() {
  openUntil = 0;
}

export function geminiCircuitStatus() {
  const open = isGeminiCircuitOpen();
  return {
    open,
    openUntilIso: open && openUntil > 0 ? new Date(openUntil).toISOString() : null,
    cooldownMs: cooldownMs(),
  };
}
