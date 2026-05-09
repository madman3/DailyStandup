import { randomUUID } from "crypto";

/** Default shape; webhook + AI will fill `days` later. */
export const DEFAULT_STATE = {
  version: 2,
  days: {},
  todos: [],
  pendingFollowUp: null,
  standupHistory: [],
  geminiPaused: false,
  jobApplications: [],
};

export const STANDUP_HISTORY_MAX = 50;

function normTitle(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

const EMPTY_TODO_SORT = {
  priority: null,
  schedule: null,
  quick: null,
  backlog: null,
  unsorted: null,
};

function normalizeTodoRow(t) {
  if (!t || typeof t !== "object") return t;
  const row = { ...t };
  const s = row.sortOrder && typeof row.sortOrder === "object" ? row.sortOrder : {};
  row.sortOrder = { ...EMPTY_TODO_SORT, ...s };
  for (const k of Object.keys(EMPTY_TODO_SORT)) {
    const v = row.sortOrder[k];
    row.sortOrder[k] = v == null || Number.isNaN(Number(v)) ? null : Number(v);
  }
  return row;
}

/** Ensure version + days exist (older or hand-edited state may omit them). */
export function normalizeStateShape(state) {
  if (!state || typeof state !== "object") {
    return { ...DEFAULT_STATE };
  }
  return {
    ...DEFAULT_STATE,
    ...state,
    version: typeof state.version === "number" ? state.version : 1,
    geminiPaused: state.geminiPaused === true,
    days:
      typeof state.days === "object" && state.days !== null && !Array.isArray(state.days)
        ? { ...state.days }
        : {},
    todos: Array.isArray(state.todos) ? state.todos.map(normalizeTodoRow) : [],
    pendingFollowUp:
      state.pendingFollowUp && typeof state.pendingFollowUp === "object"
        ? state.pendingFollowUp
        : null,
    standupHistory: Array.isArray(state.standupHistory) ? state.standupHistory : [],
    jobApplications: Array.isArray(state.jobApplications) ? state.jobApplications : [],
  };
}

/** One-time migration: legacy per-day string tasks → global todos. */
export function migrateLegacyStateToV2(state) {
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
          sortOrder: { priority: null, schedule: null, quick: null, backlog: null, unsorted: null },
        });
      }
    }
  }
  return { ...state, version: 2, todos, pendingFollowUp: state.pendingFollowUp ?? null };
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
        if (mv != null && mv !== undefined) out.macros[mk] = mv;
      }
    } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
      out[k] = { ...(out[k] || {}), ...v };
    } else {
      out[k] = v;
    }
  }
  return out;
}
