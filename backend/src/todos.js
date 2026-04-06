import { randomUUID } from "crypto";
import { mergeDayPatch, readState, writeState } from "./stateStore.js";

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
  todos[idx] = { ...todos[idx], ...patch };
  state.todos = todos;
  await writeState(state);
  return todos[idx];
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
  };
  const prevDay = state.days[dateKey] || {};
  state.days[dateKey] = mergeDayPatch(prevDay, { accomplishments: [acc] });
  await writeState(state);
  return { ok: true, accomplishment: acc };
}
