import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiUrl } from "../api.js";
import {
  TODO_TABS,
  recentAccomplishmentsFromDays,
  sortTodosInQuadrant,
  todoQuadrant,
} from "../lib/todoQuadrant.js";

function authHeaders(authToken) {
  const h = { "Content-Type": "application/json" };
  if (authToken) h.Authorization = `Bearer ${authToken}`;
  return h;
}

/**
 * @param {object} props
 * @param {import('../lib/todoQuadrant.js').TodoQuadrant} props.activeTab
 */
function SortableTodoRow({
  todo,
  busyId,
  menuOpen,
  onToggleMenu,
  onContextMenu,
  onComplete,
  moveToQuadrant,
}) {
  const q = todoQuadrant(todo);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: todo.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={
        "todo-row todo-row--sortable" + (isDragging ? " todo-row--dragging" : "")
      }
      data-dragging={isDragging ? "true" : undefined}
      onContextMenu={onContextMenu}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="todo-drag-handle"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <div className="todo-content">
        <div className="todo-check">
          <input
            type="checkbox"
            className="todo-checkbox-hit"
            disabled={busyId === todo.id}
            aria-label={`Mark done: ${todo.title}`}
            onChange={() => onComplete(todo.id)}
          />
          <span className="todo-title">{todo.title}</span>
        </div>
        {todo.needsClarification ? (
          <div className="todo-meta">
            <span className="pill todo-pill warn">Needs clarification</span>
          </div>
        ) : null}
      </div>
      <div className="todo-row-actions" data-todo-menu-root>
        <button
          type="button"
          className="todo-row-menu-btn"
          aria-label="Task actions"
          aria-expanded={menuOpen}
          onClick={(e) => {
            e.stopPropagation();
            onToggleMenu();
          }}
        >
          ⋮
        </button>
        {menuOpen && (
          <ul className="todo-move-menu" role="menu" onClick={(ev) => ev.stopPropagation()}>
            <li className="todo-move-menu__title">Move to…</li>
            {TODO_TABS.filter((tab) => tab.id !== q).map((tab) => (
              <li key={tab.id} role="none">
                <button
                  type="button"
                  role="menuitem"
                  className="todo-move-menu__item"
                  onClick={() => moveToQuadrant(todo.id, tab.id)}
                >
                  {tab.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/**
 * @param {object} props
 * @param {import('../lib/todoQuadrant.js').RecentAccomplishment} props.accomplishment
 * @param {boolean} props.menuOpen
 * @param {boolean} props.busyRestore
 * @param {() => void} props.onToggleMenu
 * @param {(a: import('../lib/todoQuadrant.js').RecentAccomplishment) => void} props.onRestore
 */
function RecentDoneRow({ accomplishment: a, menuOpen, busyRestore, onToggleMenu, onRestore }) {
  return (
    <li className={"todo-recent-done-item" + (menuOpen ? " todo-recent-done-item--menu-open" : "")}>
      <span className="todo-recent-done-check" aria-hidden>
        ✓
      </span>
      <div className="todo-recent-done-main">
        <span className="todo-recent-done-title-text">{a.title}</span>
        <span className="todo-recent-done-date muted small">
          {a.completedAt ? new Date(a.completedAt).toLocaleString() : ""}
        </span>
      </div>
      <div className="todo-recent-done-actions" data-todo-menu-root>
        <button
          type="button"
          className="todo-row-menu-btn"
          aria-label="Completed task actions"
          aria-expanded={menuOpen}
          onClick={(e) => {
            e.stopPropagation();
            onToggleMenu();
          }}
        >
          ⋮
        </button>
        {menuOpen ? (
          <ul className="todo-move-menu" role="menu" onClick={(ev) => ev.stopPropagation()}>
            <li role="none">
              <button
                type="button"
                role="menuitem"
                className="todo-move-menu__item"
                disabled={busyRestore}
                onClick={() => onRestore(a)}
              >
                {busyRestore ? "Restoring…" : "Undo"}
              </button>
            </li>
          </ul>
        ) : null}
      </div>
    </li>
  );
}

/**
 * @param {object} props
 * @param {unknown[]} props.todos
 * @param {Record<string, { accomplishments?: unknown[] }> | undefined} props.days
 * @param {string} props.todayKey
 * @param {() => void} [props.onComplete]
 * @param {string} [props.authToken]
 */
export function TodoPanel({ todos, days, todayKey, onComplete, authToken }) {
  const [busyId, setBusyId] = useState(null);
  const [busyRestoreKey, setBusyRestoreKey] = useState(null);
  const [err, setErr] = useState(null);
  const [reflection, setReflection] = useState(null);
  const [activeTab, setActiveTab] = useState(/** @type {import('../lib/todoQuadrant.js').TodoQuadrant} */ ("priority"));
  const [menuForId, setMenuForId] = useState(null);
  /** Recently completed row menu (`id-completedAt`). */
  const [recentMenuKey, setRecentMenuKey] = useState(/** @type {string | null} */ (null));
  const [items, setItems] = useState(() => sortTodosInQuadrant(todos || [], "priority"));

  const tabCounts = useMemo(() => {
    const c = {};
    for (const tab of TODO_TABS) {
      c[tab.id] = sortTodosInQuadrant(todos || [], tab.id).length;
    }
    return c;
  }, [todos]);

  const listForTab = useMemo(
    () => sortTodosInQuadrant(todos || [], activeTab),
    [todos, activeTab]
  );

  useEffect(() => {
    setItems(listForTab);
  }, [listForTab]);

  const recentDone = useMemo(() => recentAccomplishmentsFromDays(days, 7), [days]);

  useEffect(() => {
    let cancelled = false;
    setReflection(null);
    (async () => {
      try {
        const r = await fetch(
          apiUrl(`/api/daily-reflection?date=${encodeURIComponent(todayKey)}`),
          {
            credentials: "include",
            headers: authHeaders(authToken),
          }
        );
        if (!r.ok) return;
        const data = await r.json().catch(() => null);
        if (cancelled || !data || typeof data.content !== "string" || !data.content.trim()) return;
        if (data.type !== "quote" && data.type !== "reflection") return;
        setReflection({
          type: data.type,
          content: data.content.trim(),
          attribution:
            data.attribution != null && String(data.attribution).trim() !== ""
              ? String(data.attribution).trim()
              : null,
        });
      } catch {
        /* silent — no reflection UI */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [todayKey, authToken]);

  const refresh = useCallback(() => onComplete?.(), [onComplete]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    function closeMenu(e) {
      const el = e.target;
      if (el instanceof Element && el.closest("[data-todo-menu-root]")) return;
      setMenuForId(null);
      setRecentMenuKey(null);
    }
    document.addEventListener("click", closeMenu);
    return () => document.removeEventListener("click", closeMenu);
  }, []);

  async function complete(id) {
    setErr(null);
    setBusyId(id);
    try {
      const r = await fetch(apiUrl(`/api/todos/${encodeURIComponent(id)}/complete`), {
        method: "POST",
        credentials: "include",
        headers: authHeaders(authToken),
        body: JSON.stringify({ dateKey: todayKey }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(data.error || `HTTP ${r.status}`);
      }
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to complete");
    } finally {
      setBusyId(null);
    }
  }

  async function restoreAccomplishment(a) {
    const key = `${a.id ?? "noid"}-${a.completedAt}`;
    setErr(null);
    setBusyRestoreKey(key);
    try {
      const r = await fetch(apiUrl("/api/todos/restore-accomplishment"), {
        method: "POST",
        credentials: "include",
        headers: authHeaders(authToken),
        body: JSON.stringify({
          id: a.id != null ? String(a.id) : "",
          dateKey: a.dateKey,
          title: a.title,
          completedAt: a.completedAt,
        }),
      });
      const ct = r.headers.get("content-type") || "";
      const data =
        ct.includes("application/json") ? await r.json().catch(() => ({})) : {};
      if (!r.ok) {
        if (r.status === 404 && !data.error) {
          throw new Error(
            "HTTP 404: the request likely hit the static site, not the API. Set VITE_API_URL to your backend origin (e.g. https://your-app.fly.dev), rebuild the frontend, and redeploy."
          );
        }
        throw new Error(data.error || data.reason || `HTTP ${r.status}`);
      }
      setRecentMenuKey(null);
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not restore task");
    } finally {
      setBusyRestoreKey(null);
    }
  }

  async function moveToQuadrant(todoId, quadrant) {
    setErr(null);
    setMenuForId(null);
    setRecentMenuKey(null);
    try {
      const r = await fetch(apiUrl(`/api/todos/${encodeURIComponent(todoId)}`), {
        method: "PATCH",
        credentials: "include",
        headers: authHeaders(authToken),
        body: JSON.stringify({ quadrant }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(data.error || `HTTP ${r.status}`);
      }
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to move task");
    }
  }

  async function persistOrder(orderedIds) {
    const r = await fetch(apiUrl("/api/todos/reorder"), {
      method: "POST",
      credentials: "include",
      headers: authHeaders(authToken),
      body: JSON.stringify({ quadrant: activeTab, orderedIds }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const hint =
        r.status === 404
          ? " (404: redeploy the API, or set VITE_API_URL to your backend and rebuild the frontend if the API is on another host.)"
          : "";
      throw new Error((data.error || `HTTP ${r.status}`) + hint);
    }
    refresh();
  }

  async function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((t) => t.id === active.id);
    const newIndex = items.findIndex((t) => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(items, oldIndex, newIndex);
    setItems(reordered);
    setErr(null);
    try {
      await persistOrder(reordered.map((t) => t.id));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save order");
      setItems(sortTodosInQuadrant(todos || [], activeTab));
    }
  }

  return (
    <section className="panel todo-panel">
      <h2 className="panel-title">To-do</h2>
      {reflection ? (
        <div className="todo-reflection">
          <p className="todo-reflection__content">
            {reflection.type === "quote" ? `"${reflection.content}"` : reflection.content}
          </p>
          {reflection.attribution && (
            <span className="todo-reflection__attribution">— {reflection.attribution}</span>
          )}
        </div>
      ) : null}

      <div className="todo-tab-bar" role="tablist" aria-label="Task quadrants">
        {TODO_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? "todo-tab todo-tab--active" : "todo-tab"}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
            <span className="todo-tab__count">{tabCounts[tab.id] ?? 0}</span>
          </button>
        ))}
      </div>

      {err && <div className="banner error">{err}</div>}

      {items.length === 0 ? (
        <p className="muted todo-tab-empty">No tasks in this tab.</p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={items.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            <ul className="todo-list todo-list--tabbed">
              {items.map((t) => (
                <SortableTodoRow
                  key={t.id}
                  todo={t}
                  busyId={busyId}
                  menuOpen={menuForId === t.id}
                  onToggleMenu={() => {
                    setRecentMenuKey(null);
                    setMenuForId(menuForId === t.id ? null : t.id);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setRecentMenuKey(null);
                    setMenuForId(menuForId === t.id ? null : t.id);
                  }}
                  onComplete={complete}
                  moveToQuadrant={moveToQuadrant}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      <h3 className="todo-recent-done-title">Recently completed</h3>
      <p className="muted small todo-recent-done-hint">
        Last 7 days only — still stored after that. Hover a row and use ⋮ → Undo to put a task back on your list (opens in
        Unsorted).
      </p>
      {recentDone.length === 0 ? (
        <p className="muted small">No completions in the last week.</p>
      ) : (
        <ul className="todo-recent-done-list">
          {recentDone.map((a) => {
            const rk = `${a.id}-${a.completedAt}`;
            return (
              <RecentDoneRow
                key={rk}
                accomplishment={a}
                menuOpen={recentMenuKey === rk}
                busyRestore={busyRestoreKey === rk}
                onToggleMenu={() => {
                  setMenuForId(null);
                  setRecentMenuKey(recentMenuKey === rk ? null : rk);
                }}
                onRestore={restoreAccomplishment}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}
