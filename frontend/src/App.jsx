import { useEffect, useState } from "react";
import { apiUrl } from "./api.js";
import { AnalyticsDashboard, DashboardMetrics } from "./components/AnalyticsDashboard.jsx";
import { TodoPanel } from "./components/TodoPanel.jsx";
import { standupTodayKey } from "./lib/calendarDateKey.js";

/** @typedef {'dashboard' | 'health' | 'jobs' | 'data'} AppNavSection */

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "health", label: "Health" },
  { id: "jobs", label: "Jobs" },
  { id: "data", label: "Data" },
];

export default function App() {
  const [navSection, setNavSection] = useState(/** @type {AppNavSection} */ ("dashboard"));
  const [data, setData] = useState(null);
  const [telegram, setTelegram] = useState(null);
  const [err, setErr] = useState(null);
  const [lastFetch, setLastFetch] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [passwordInput, setPasswordInput] = useState("");
  const [loginErr, setLoginErr] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const stateRes = await fetch(apiUrl("/api/state"), { credentials: "include" });
        if (stateRes.status === 401) {
          if (!cancelled) {
            setNeedsAuth(true);
            setData(null);
            setTelegram(null);
            setErr(null);
          }
          return;
        }
        if (!stateRes.ok) throw new Error(`state HTTP ${stateRes.status}`);
        const json = await stateRes.json();

        const tgRes = await fetch(apiUrl("/api/telegram-status"), { credentials: "include" });
        if (tgRes.status === 401) {
          if (!cancelled) {
            setNeedsAuth(true);
            setData(null);
            setTelegram(null);
            setErr(null);
          }
          return;
        }
        const tgJson = await tgRes.json();
        if (!cancelled) {
          setNeedsAuth(false);
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
  }, [refreshTick]);

  const todayKey = standupTodayKey();
  const tzLabel = import.meta.env.VITE_USER_TIMEZONE?.trim() || "UTC";
  const today = data?.days?.[todayKey] ?? null;
  const dayKeys = data?.days ? Object.keys(data.days).sort().reverse() : [];
  const tgResult = telegram?.result;
  const tgOk = telegram?.ok === true;

  async function login(e) {
    e?.preventDefault?.();
    setLoginErr(null);
    const password = passwordInput;
    try {
      const r = await fetch(apiUrl("/api/login"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        setLoginErr(json.error || `Login failed (HTTP ${r.status})`);
        return;
      }
      setPasswordInput("");
      setNeedsAuth(false);
      setRefreshTick((t) => t + 1);
    } catch (err2) {
      setLoginErr(err2 instanceof Error ? err2.message : "Login failed");
    }
  }

  if (needsAuth) {
    return (
      <div className="app">
        <header className="header">
          <h1>Daily Standup</h1>
          <p className="muted">Sign in to view your data.</p>
        </header>
        <section className="panel">
          <h2 className="panel-title">Unlock dashboard</h2>
          <form onSubmit={login} style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <input
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder="Password"
              autoFocus
              style={{ flex: 1 }}
            />
            <button type="submit" style={{ whiteSpace: "nowrap" }}>
              Unlock
            </button>
          </form>
          {loginErr && <div className="banner error" style={{ marginTop: "0.75rem" }}>{loginErr}</div>}
        </section>
      </div>
    );
  }

  return (
    <div className="app app-shell">
      <div className="app-shell__masthead">
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
          <div className="banner error app-shell__banner">
            Cannot reach API: {err}. Local: run backend on port 3001. Production: set{" "}
            <code>VITE_API_URL</code> to your Fly.io URL.
          </div>
        )}

        <DashboardMetrics days={data?.days} chartEndDate={todayKey} />
      </div>

      <div className="app-shell__nav-row">
        <aside className="app-sidebar">
          <nav className="app-nav" aria-label="Primary">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={
                  navSection === item.id ? "app-nav__btn app-nav__btn--active" : "app-nav__btn"
                }
                aria-current={navSection === item.id ? "page" : undefined}
                onClick={() => setNavSection(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        <div className="app-main">
          {navSection === "dashboard" && data && (
            <TodoPanel
              todos={data.todos}
              todayKey={todayKey}
              accomplishments={today?.accomplishments}
              onComplete={() => setRefreshTick((t) => t + 1)}
            />
          )}

          {navSection === "dashboard" && (
            <AnalyticsDashboard section="dashboard" days={data?.days} chartEndDate={todayKey} />
          )}

          {(navSection === "health" || navSection === "jobs") && (
            <AnalyticsDashboard
              section={navSection}
              days={data?.days}
              chartEndDate={todayKey}
              jobApplications={data?.jobApplications}
              jobApplicationsReady={Boolean(data) || Boolean(err)}
            />
          )}

          {navSection === "data" && (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
