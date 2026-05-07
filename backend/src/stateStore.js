import { randomUUID } from "crypto";
import {
  insertStandupHistoryRow,
  getDayJson,
  getLegacyStatePath,
  isPostgresMode,
  loadFullStateFromDb,
  mergeDayPayload,
  replaceFullStateInDb,
  trimStandupHistory,
  upsertSetting,
} from "./lifeosDb.js";
import {
  DEFAULT_STATE,
  STANDUP_HISTORY_MAX,
  mergeDayPatch,
  migrateLegacyStateToV2,
  normalizeStateShape,
} from "./stateModel.js";

/** Legacy JSON path (SQLite / Postgres migrations may still read once). */
export const STATE_PATH = getLegacyStatePath();

export { DEFAULT_STATE, normalizeStateShape, mergeDayPatch };

export async function readState() {
  let state = await loadFullStateFromDb();
  if (state.version < 2) {
    state = migrateLegacyStateToV2(state);
    await replaceFullStateInDb(state);
  }
  return state;
}

export async function writeState(state) {
  await replaceFullStateInDb(state);
}

export async function setGeminiPaused(paused) {
  await upsertSetting("gemini_paused", paused ? "true" : "false");
  return Boolean(paused);
}

export async function appendStandupHistory(entry) {
  const id = randomUUID();
  const text = String(entry.text || "").slice(0, 2000);
  const at = entry.at;
  const source = entry.source || "unknown";
  const count = Number(await insertStandupHistoryRow({ id, text, at, source }));
  if (count > STANDUP_HISTORY_MAX) {
    await trimStandupHistory(STANDUP_HISTORY_MAX);
  }
}

export async function mergeIntoDay(dateKey, patch) {
  const raw = await getDayJson(dateKey);
  let prev = {};
  if (raw) {
    try {
      prev = JSON.parse(raw);
    } catch {
      prev = {};
    }
  }
  const merged = mergeDayPatch(prev, patch);
  if (!patch.lastError) delete merged.lastError;
  await mergeDayPayload(dateKey, JSON.stringify(merged));
  return merged;
}

export { isPostgresMode };
