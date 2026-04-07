import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Resolved path to backend/state.json (gitignored). */
export const STATE_PATH = path.join(__dirname, "../state.json");

/** Default shape; webhook + AI will fill `days` later. */
export const DEFAULT_STATE = {
  version: 2,
  days: {},
  todos: [],
  pendingFollowUp: null,
  standupHistory: [],
};

/** Ensure version + days exist (older or hand-edited state.json may omit them). */
export function normalizeStateShape(state) {
  if (!state || typeof state !== "object") {
    return { ...DEFAULT_STATE };
  }
  return {
    ...DEFAULT_STATE,
    ...state,
    version: typeof state.version === "number" ? state.version : 1,
    days:
      typeof state.days === "object" && state.days !== null && !Array.isArray(state.days)
        ? { ...state.days }
        : {},
    todos: Array.isArray(state.todos) ? state.todos : [],
    pendingFollowUp:
      state.pendingFollowUp && typeof state.pendingFollowUp === "object"
        ? state.pendingFollowUp
        : null,
    standupHistory: Array.isArray(state.standupHistory) ? state.standupHistory : [],
  };
}

function normTitle(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** One-time migration: legacy per-day string tasks → global todos. */
function migrateLegacyStateToV2(state) {
  const todos = Array.isArray(state.todos) ? [...state.todos] : [];
  const seen = new Set(
    todos.filter((t) => t && t.status === "active").map((t) => normTitle(t.title))
  );
  if (state.days && typeof state.days === "object") {
    for (const [dk, day] of Object.entries(state.days)) {
      const strings = day.tasks;
      if (!Array.isArray(strings)) continue;
      for (const t of strings) {
        if (typeof t !== "string" || !t.trim()) continue;
        const nt = normTitle(t);
        if (seen.has(nt)) continue;
        seen.add(nt);
        todos.push({
          id: randomUUID(),
          title: t.trim(),
          important: null,
          urgent: null,
          when: null,
          needsClarification: false,
          status: "active",
          sourceDay: dk,
          createdAt: new Date().toISOString(),
          followUpSent: false,
        });
      }
    }
  }
  return { ...state, version: 2, todos, pendingFollowUp: state.pendingFollowUp ?? null };
}

/**
 * Read persisted JSON. If the file is missing, create it with DEFAULT_STATE and return that.
 */
export async function readState() {
  try {
    const raw = await fs.readFile(STATE_PATH, "utf8");
    let state = normalizeStateShape(JSON.parse(raw));
    if (state.version < 2) {
      state = migrateLegacyStateToV2(state);
      await writeState(state);
    }
    return state;
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

const STANDUP_HISTORY_MAX = 50;

/** Append a processed standup text for later replay (e.g. after deploy). Keeps last N entries. */
export async function appendStandupHistory(entry) {
  const state = await readState();
  const hist = Array.isArray(state.standupHistory) ? [...state.standupHistory] : [];
  hist.push({
    id: randomUUID(),
    text: String(entry.text || "").slice(0, 2000),
    at: entry.at,
    source: entry.source || "unknown",
  });
  state.standupHistory = hist.slice(-STANDUP_HISTORY_MAX);
  state.version = Math.max(state.version || 1, 2);
  await writeState(state);
}

/**
 * Merge partial day fields: non-null overwrites; tasks concatenated and deduped; macros shallow-merge non-null.
 */
export function mergeDayPatch(prev, patch) {
  const out = { ...(prev && typeof prev === "object" ? prev : {}) };
  if (!patch || typeof patch !== "object") return out;
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) continue;
    if (k === "accomplishments" && Array.isArray(v)) {
      out.accomplishments = [...(out.accomplishments || []), ...v];
    } else if (k === "tasks" && Array.isArray(v)) {
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
