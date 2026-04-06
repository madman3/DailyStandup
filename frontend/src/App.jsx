import { useEffect, useState } from "react";
import { apiUrl } from "./api.js";
import { AnalyticsDashboard } from "./components/AnalyticsDashboard.jsx";
import { standupTodayKey } from "./lib/calendarDateKey.js";

export default function App() {
  const [data, setData] = useState(null);
  const [telegram, setTelegram] = useState(null);
  const [err, setErr] = useState(null);
  const [lastFetch, setLastFetch] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [stateRes, tgRes] = await Promise.all([
          fetch(apiUrl("/api/state")),
          fetch(apiUrl("/api/telegram-status")),
        ]);
        if (!stateRes.ok) throw new Error(`state HTTP ${stateRes.status}`);
        const json = await stateRes.json();
        const tgJson = await tgRes.json();
        if (!cancelled) {
          setData(json);
          setTelegram(tgJson);
          setErr(null);
          setLastFetch(new Date());
        }
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "Failed to load");
        }
      }
    }

    load();
    const id = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const todayKey = standupTodayKey();
  const tzLabel = import.meta.env.VITE_USER_TIMEZONE?.trim() || "UTC";
  const today = data?.days?.[todayKey] ?? null;
  const dayKeys = data?.days ? Object.keys(data.days).sort().reverse() : [];
  const tgResult = telegram?.result;
  const tgOk = telegram?.ok === true;

  return (
    <div className="app">
      <header className="header">
        <h1>Daily Standup</h1>
        <p className="muted">
          Personal analytics · synced every 5s
          {lastFetch && (
            <>
              {" "}
              · last update {lastFetch.toLocaleTimeString()}
            </>
          )}
        </p>
      </header>

      {err && (
        <div className="banner error">
          Cannot reach API: {err}. Local: run backend on port 3001. Production: set{" "}
          <code>VITE_API_URL</code> to your Railway URL.
        </div>
      )}

      <AnalyticsDashboard days={data?.days} />

      <section className="panel">
        <h2>
          Today ({todayKey}, {tzLabel})
        </h2>
        {!data && !err && <p className="muted">Loading…</p>}
        {data && !today && (
          <p className="muted">
            No entry for this calendar day yet. Days with data:{" "}
            {dayKeys.length ? dayKeys.join(", ") : "none"}.
          </p>
        )}
        {today?.lastError && (
          <div className="banner error">
            Gemini / parse error (message still saved): {today.lastError}
          </div>
        )}
        {today?.messageLog?.length > 0 && (
          <div className="messages">
            <h3>Raw message log</h3>
            <ul>
              {today.messageLog.map((m, i) => (
                <li key={`${m.at}-${i}`}>
                  <span className="muted small">{m.at}</span>{" "}
                  <span className="pill">{m.source}</span>
                  <div>{m.text}</div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <details className="panel details-debug">
        <summary>Telegram webhook &amp; debug</summary>
        {!telegram && !err && <p className="muted">Loading…</p>}
        {telegram && !tgOk && (
          <p className="banner error">
            {telegram.error || "Could not load Telegram status (token missing?)."}
          </p>
        )}
        {tgOk && tgResult && (
          <ul className="tg-status">
            <li>
              <strong>Webhook URL</strong>:{" "}
              {tgResult.url ? (
                <code>{tgResult.url}</code>
              ) : (
                <span className="warn">empty — run register-webhook with ngrok URL</span>
              )}
            </li>
            <li>
              <strong>Pending updates</strong>: {tgResult.pending_update_count ?? 0}
            </li>
            {(tgResult.last_error_message || tgResult.last_error_date) && (
              <li className="warn">
                <strong>Last Telegram error</strong>: {tgResult.last_error_message || "—"}
              </li>
            )}
          </ul>
        )}
        <p className="muted small">
          Backend logs <code>[webhook] update_id=…</code> when Telegram POSTs to{" "}
          <code>/webhook</code>.
        </p>
      </details>

      <details className="panel details-debug">
        <summary>Raw state JSON</summary>
        {data?.days && Object.keys(data.days).length > 0 ? (
          <pre className="mono">{JSON.stringify(data.days, null, 2)}</pre>
        ) : (
          <p className="muted">No days in state yet.</p>
        )}
      </details>
    </div>
  );
}
