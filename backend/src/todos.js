import { randomUUID } from "crypto";
import { mergeDayPatch, readState, writeState } from "./stateStore.js";

const QUADRANTS = ["priority", "schedule", "quick", "backlog", "unsorted"];

const EMPTY_SORT = {
  priority: null,
  schedule: null,
  quick: null,
  backlog: null,
  unsorted: null,
};

export function normalizeRestoredSortOrder(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const out = { ...EMPTY_SORT, ...s };
  for (const k of Object.keys(EMPTY_SORT)) {
    const v = out[k];
    out[k] = v == null || Number.isNaN(Number(v)) ? null : Number(v);
  }
  return out;
}

export function todoQuadrant(t) {
  const imp = t.important;
  const urg = t.urgent;
  if (imp === null || imp === undefined || urg === null || urg === undefined) {
    return "unsorted";
  }
  if (urg && imp) return "priority";
  if (imp && !urg) return "schedule";
  if (urg && !imp) return "quick";
  return "backlog";
}

function flagsForQuadrant(quadrant) {
  switch (quadrant) {
    case "priority":
      return { important: true, urgent: true };
    case "schedule":
      return { important: true, urgent: false };
    case "quick":
      return { important: false, urgent: true };
    case "backlog":
      return { important: false, urgent: false };
    case "unsorted":
      return { important: null, urgent: null };
    default:
      return null;
  }
}

function maxOrderInQuadrant(todos, quadrant, excludeId) {
  let m = -1;
  for (const t of todos) {
    if (t.status !== "active" || t.id === excludeId) continue;
    if (todoQuadrant(t) !== quadrant) continue;
    const o = t.sortOrder?.[quadrant];
    if (o != null && o > m) m = o;
  }
  return m;
}

function normTitle(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeIncomingTaskItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const title = String(raw.title || "")
    .trim()
    .slice(0, 500);
  if (!title) return null;
  let when = null;
  if (raw.when != null && raw.when !== "") {
    const s = String(raw.when).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) when = s;
  }
  const important = raw.important === true ? true : raw.important === false ? false : null;
  const urgent = raw.urgent === true ? true : raw.urgent === false ? false : null;
  const clarified = when != null || important !== null || urgent !== null;
  return {
    title,
    important,
    urgent,
    when,
    needsClarification: Boolean(raw.needsClarification) && !clarified,
  };
}

/**
 * Merge extracted task items into global `state.todos` (active only; match by normalized title).
 */
export async function mergeTodosFromExtraction(taskItems, dateKey) {
  const state = await readState();
  const todos = Array.isArray(state.todos) ? [...state.todos] : [];
  const items = Array.isArray(taskItems) ? taskItems.map(normalizeIncomingTaskItem).filter(Boolean) : [];

  for (const item of items) {
    const key = normTitle(item.title);
    const idx = todos.findIndex(
      (t) => t.status === "active" && normTitle(t.title) === key
    );
    if (idx >= 0) {
      const prev = todos[idx];
      const merged = {
        ...prev,
        title: item.title,
        important: item.important !== null ? item.important : prev.important,
        urgent: item.urgent !== null ? item.urgent : prev.urgent,
        when: item.when ?? prev.when,
        sourceDay: dateKey,
        sortOrder: prev.sortOrder || { ...EMPTY_SORT },
      };
      const clarified =
        merged.when != null || merged.important !== null || merged.urgent !== null;
      merged.needsClarification =
        Boolean(item.needsClarification || prev.needsClarification) && !clarified;
      todos[idx] = merged;
    } else {
      todos.push({
        id: randomUUID(),
        title: item.title,
        important: item.important,
        urgent: item.urgent,
        when: item.when,
        needsClarification: item.needsClarification,
        status: "active",
        sourceDay: dateKey,
        createdAt: new Date().toISOString(),
        followUpSent: false,
        sortOrder: { ...EMPTY_SORT },
      });
    }
  }

  state.todos = todos;
  state.version = Math.max(state.version || 1, 2);
  await writeState(state);
  return todos;
}

export async function updateTodoById(todoId, patch) {
  const state = await readState();
  const todos = Array.isArray(state.todos) ? [...state.todos] : [];
  const idx = todos.findIndex((t) => t.id === todoId);
  if (idx < 0) return null;
  const prev = todos[idx];
  const next = { ...prev, ...patch };
  if (patch.sortOrder && typeof patch.sortOrder === "object") {
    next.sortOrder = { ...(prev.sortOrder || { ...EMPTY_SORT }), ...patch.sortOrder };
  }
  todos[idx] = next;
  state.todos = todos;
  await writeState(state);
  return todos[idx];
}

/**
 * Move todo to a fixed Eisenhower tab (updates urgent/important + per-tab order).
 * @param {string} todoId
 * @param {string} quadrant - priority | schedule | quick | backlog | unsorted
 */
export async function moveTodoToQuadrant(todoId, quadrant) {
  if (!QUADRANTS.includes(quadrant)) {
    return { ok: false, error: "Invalid quadrant" };
  }
  const flags = flagsForQuadrant(quadrant);
  if (!flags) return { ok: false, error: "Invalid quadrant" };

  const state = await readState();
  const todos = [...state.todos];
  const idx = todos.findIndex((t) => t.id === todoId && t.status === "active");
  if (idx < 0) return { ok: false, error: "Todo not found" };

  const prev = todos[idx];
  const oldQ = todoQuadrant(prev);
  const sortOrder = { ...(prev.sortOrder || { ...EMPTY_SORT }) };
  sortOrder[oldQ] = null;

  const merged = {
    ...prev,
    important: flags.important,
    urgent: flags.urgent,
    sortOrder,
  };
  const newQ = todoQuadrant(merged);
  sortOrder[newQ] = maxOrderInQuadrant(todos, newQ, todoId) + 1;
  todos[idx] = { ...merged, sortOrder };
  state.todos = todos;
  await writeState(state);
  return { ok: true, todo: todos[idx] };
}

/**
 * Persist drag order within one tab (quadrant).
 * @param {string} quadrant
 * @param {string[]} orderedIds - full list of active todo ids in that quadrant, in order
 */
export async function reorderTodosInQuadrant(quadrant, orderedIds) {
  if (!QUADRANTS.includes(quadrant)) {
    return { ok: false, error: "Invalid quadrant" };
  }
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return { ok: false, error: "orderedIds required" };
  }
  const state = await readState();
  const todos = [...state.todos];
  const idSet = new Set(orderedIds);
  if (idSet.size !== orderedIds.length) {
    return { ok: false, error: "Duplicate ids" };
  }

  for (const id of orderedIds) {
    const t = todos.find((x) => x.id === id && x.status === "active");
    if (!t) return { ok: false, error: "Todo not found" };
    if (todoQuadrant(t) !== quadrant) return { ok: false, error: "Quadrant mismatch" };
  }

  const inQ = todos.filter((t) => t.status === "active" && todoQuadrant(t) === quadrant);
  if (inQ.length !== orderedIds.length) {
    return { ok: false, error: "Incomplete order list" };
  }

  for (let i = 0; i < orderedIds.length; i++) {
    const id = orderedIds[i];
    const tIdx = todos.findIndex((t) => t.id === id);
    const sortOrder = { ...(todos[tIdx].sortOrder || { ...EMPTY_SORT }) };
    sortOrder[quadrant] = i;
    todos[tIdx] = { ...todos[tIdx], sortOrder };
  }
  state.todos = todos;
  await writeState(state);
  return { ok: true };
}

export async function clearPendingFollowUp() {
  const state = await readState();
  state.pendingFollowUp = null;
  await writeState(state);
}

export async function setPendingFollowUp(payload) {
  const state = await readState();
  state.pendingFollowUp = payload;
  state.version = Math.max(state.version || 1, 2);
  await writeState(state);
}

/**
 * Mark todo done: remove from active list, append to day's accomplishments.
 */
export async function completeTodo(todoId, dateKey) {
  const state = await readState();
  const todos = Array.isArray(state.todos) ? [...state.todos] : [];
  const idx = todos.findIndex((t) => t.id === todoId && t.status === "active");
  if (idx < 0) return { ok: false, error: "Todo not found" };

  const todo = todos[idx];
  const completedAt = new Date().toISOString();
  todos.splice(idx, 1);
  state.todos = todos;

  const acc = {
    id: todo.id,
    title: todo.title,
    completedAt,
    important: todo.important !== undefined ? todo.important : null,
    urgent: todo.urgent !== undefined ? todo.urgent : null,
    when: todo.when !== undefined ? todo.when : null,
    needsClarification: Boolean(todo.needsClarification),
    sortOrder:
      todo.sortOrder && typeof todo.sortOrder === "object"
        ? { ...EMPTY_SORT, ...todo.sortOrder }
        : { ...EMPTY_SORT },
  };
  const prevDay = state.days[dateKey] || {};
  state.days[dateKey] = mergeDayPatch(prevDay, { accomplishments: [acc] });
  await writeState(state);
  return { ok: true, accomplishment: acc };
}

function normAccTitle(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function idLookupKey(todoId) {
  if (todoId == null) return null;
  const s = String(todoId).trim();
  if (s === "" || s === "undefined") return null;
  return s;
}

/**
 * @param {object} state
 * @param {string | undefined} todoId
 * @param {string | undefined} preferredDateKey
 * @param {{ title?: string, completedAt?: string }} [hints] from client (fallback when id missing / mismatch)
 */
export function findAccomplishmentEntry(state, todoId, preferredDateKey, hints) {
  const idKey = idLookupKey(todoId);
  const daysOrder = [];
  const allKeys = Object.keys(state.days || {});
  if (typeof preferredDateKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(preferredDateKey)) {
    daysOrder.push(preferredDateKey);
  }
  for (const dk of allKeys.sort()) {
    if (!daysOrder.includes(dk)) daysOrder.push(dk);
  }

  if (idKey) {
    for (const dk of daysOrder) {
      const accs = Array.isArray(state.days[dk]?.accomplishments) ? state.days[dk].accomplishments : [];
      const i = accs.findIndex((a) => a && String(a.id) === idKey);
      if (i >= 0) return { dateKey: dk, acc: accs[i], index: i };
    }
  }

  const title = hints?.title;
  const completedAt = hints?.completedAt;
  if (typeof title === "string" && title.trim() && typeof completedAt === "string" && completedAt.trim()) {
    const nt = normAccTitle(title);
    for (const dk of daysOrder) {
      const accs = Array.isArray(state.days[dk]?.accomplishments) ? state.days[dk].accomplishments : [];
      const i = accs.findIndex(
        (a) =>
          a &&
          normAccTitle(a.title) === nt &&
          String(a.completedAt || "").trim() === completedAt.trim()
      );
      if (i >= 0) return { dateKey: dk, acc: accs[i], index: i };
    }
  }

  return null;
}

/**
 * Remove a day's accomplishment and put the task back on the active list (same id/title).
 * Optional preferredDateKey narrows search; otherwise scans all days.
 * Optional hints.title + hints.completedAt match legacy rows or id mismatches.
 */
export async function restoreTodoFromAccomplishment(todoId, preferredDateKey, hints) {
  const state = await readState();
  const todos = Array.isArray(state.todos) ? [...state.todos] : [];
  const idKey = idLookupKey(todoId);
  if (
    idKey &&
    todos.some((t) => t && t.status === "active" && String(t.id) === idKey)
  ) {
    return { ok: false, error: "Todo already active" };
  }

  const found = findAccomplishmentEntry(state, todoId, preferredDateKey, hints);
  if (!found) return { ok: false, error: "Accomplishment not found" };

  const { dateKey, acc, index } = found;
  const restoredId = acc.id != null && String(acc.id).trim() !== "" ? String(acc.id) : randomUUID();
  if (todos.some((t) => t && t.status === "active" && String(t.id) === restoredId)) {
    return { ok: false, error: "Todo already active" };
  }

  const day = state.days[dateKey] || {};
  const accs = [...(day.accomplishments || [])];
  accs.splice(index, 1);
  state.days[dateKey] = { ...day, accomplishments: accs };

  const important = acc.important !== undefined ? acc.important : null;
  const urgent = acc.urgent !== undefined ? acc.urgent : null;
  const when = acc.when !== undefined ? acc.when : null;

  todos.push({
    id: restoredId,
    title: String(acc.title || "").slice(0, 500),
    important,
    urgent,
    when: when != null && when !== "" ? when : null,
    needsClarification: Boolean(acc.needsClarification),
    status: "active",
    sourceDay: dateKey,
    createdAt: acc.completedAt || new Date().toISOString(),
    followUpSent: false,
    sortOrder: normalizeRestoredSortOrder(acc.sortOrder),
  });
  state.todos = todos;
  state.version = Math.max(state.version || 1, 2);
  await writeState(state);
  return { ok: true, dateKey };
}
