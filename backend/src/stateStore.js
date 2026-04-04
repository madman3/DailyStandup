import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Resolved path to backend/state.json (gitignored). */
export const STATE_PATH = path.join(__dirname, "../state.json");

/** Default shape; webhook + AI will fill `days` later. */
export const DEFAULT_STATE = {
  version: 1,
  days: {},
};

/** Ensure version + days exist (older or hand-edited state.json may omit them). */
export function normalizeStateShape(state) {
  if (!state || typeof state !== "object") {
    return { ...DEFAULT_STATE };
  }
  return {
    ...DEFAULT_STATE,
    ...state,
    days:
      typeof state.days === "object" && state.days !== null && !Array.isArray(state.days)
        ? { ...state.days }
        : {},
  };
}

/**
 * Read persisted JSON. If the file is missing, create it with DEFAULT_STATE and return that.
 */
export async function readState() {
  try {
    const raw = await fs.readFile(STATE_PATH, "utf8");
    return normalizeStateShape(JSON.parse(raw));
  } catch (e) {
    if (e.code === "ENOENT") {
      const initial = JSON.stringify(DEFAULT_STATE, null, 2);
      await fs.writeFile(STATE_PATH, initial, "utf8");
      return JSON.parse(initial);
    }
    throw e;
  }
}

export async function writeState(state) {
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf8");
}

/**
 * Merge partial day fields: non-null overwrites; tasks concatenated and deduped; macros shallow-merge non-null.
 */
export function mergeDayPatch(prev, patch) {
  const out = { ...(prev && typeof prev === "object" ? prev : {}) };
  if (!patch || typeof patch !== "object") return out;
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) continue;
    if (k === "tasks" && Array.isArray(v)) {
      const merged = [...(out.tasks || []), ...v.map(String)];
      out.tasks = [...new Set(merged.filter(Boolean))];
    } else if (k === "macros" && typeof v === "object" && v !== null) {
      out.macros = { ...(out.macros || {}) };
      for (const [mk, mv] of Object.entries(v)) {
        if (mv !== null && mv !== undefined) out.macros[mk] = mv;
      }
    } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      out[k] = { ...(out[k] || {}), ...v };
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Merge patch into state.days[dateKey] (YYYY-MM-DD) and persist. */
export async function mergeIntoDay(dateKey, patch) {
  const state = await readState();
  const prev = state.days[dateKey] || {};
  const merged = mergeDayPatch(prev, patch);
  if (!patch.lastError) delete merged.lastError;
  state.days[dateKey] = merged;
  await writeState(state);
  return merged;
}
