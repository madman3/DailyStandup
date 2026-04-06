import { useState } from "react";
import { apiUrl } from "../api.js";
import { sortTodosForDisplay, todoPriorityBadges } from "../lib/todoSort.js";

export function TodoPanel({ todos, todayKey, accomplishments, onComplete }) {
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState(null);
  const sorted = sortTodosForDisplay(todos || []);

  async function complete(id) {
    setErr(null);
    setBusyId(id);
    try {
      const r = await fetch(apiUrl(`/api/todos/${encodeURIComponent(id)}/complete`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateKey: todayKey }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(data.error || `HTTP ${r.status}`);
      }
      onComplete?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to complete");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="panel todo-panel">
      <h2 className="panel-title">To-do</h2>
      <p className="muted small todo-panel-sub">
        Ordered by due date, then urgent, then important. Tasks from Telegram get priority
        questions there when needed.
      </p>
      {err && <div className="banner error">{err}</div>}

      {sorted.length === 0 ? (
        <p className="muted">No open tasks — mention tasks in your standup to add them.</p>
      ) : (
        <ul className="todo-list">
          {sorted.map((t) => (
            <li key={t.id} className="todo-row">
              <label className="todo-check">
                <input
                  type="checkbox"
                  disabled={busyId === t.id}
                  onChange={() => complete(t.id)}
                />
                <span className="todo-title">{t.title}</span>
              </label>
              <div className="todo-meta">
                {todoPriorityBadges(t).map((b) => (
                  <span key={b} className="pill todo-pill">
                    {b}
                  </span>
                ))}
                {t.needsClarification && (
                  <span className="pill todo-pill warn">Needs clarification</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <h3 className="todo-accomplishments-title">Today&apos;s accomplishments</h3>
      {!accomplishments?.length ? (
        <p className="muted small">Complete tasks above to list them here.</p>
      ) : (
        <ul className="accomplishment-list">
          {accomplishments.map((a) => (
            <li key={`${a.id}-${a.completedAt}`}>
              <span className="accomplishment-check">✓</span> {a.title}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
