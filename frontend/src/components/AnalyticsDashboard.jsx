import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { proteinGoalGrams } from "../lib/goals.js";
import {
  buildProteinIntakeMonthGrid,
  buildWorkoutMonthGrid,
  CHART_WINDOW_DAYS,
  daysToSeries,
  formatChartAxisLabel,
  latestDayEntry,
} from "../lib/series";

/** @typedef {'dashboard' | 'health' | 'jobs' | 'data'} AppNavSection */

const COLORS = {
  score: "#818cf8",
  sleep: "#38bdf8",
  steps: "#4ade80",
  jobs: "#fbbf24",
  protein: "#c084fc",
  calories: "#94a3b8",
  caloriesBurn: "#f97316",
  calorieNet: "#a78bfa",
};

const CHART_GRID = "#27272a";
const CHART_FONT_SANS = '"Plus Jakarta Sans", system-ui, sans-serif';
const AXIS_TICK = {
  fill: "#a1a1aa",
  fontSize: 11,
  fontFamily: CHART_FONT_SANS,
};
const TOOLTIP = {
  contentStyle: {
    backgroundColor: "#0a0a0c",
    border: "1px solid #3f3f46",
    borderRadius: 10,
    boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
    fontFamily: CHART_FONT_SANS,
    fontSize: 14,
  },
  labelStyle: { color: "#e4e4e7", fontSize: 14, fontFamily: CHART_FONT_SANS },
  itemStyle: { color: "#e4e4e7", fontSize: 14, fontFamily: CHART_FONT_SANS },
};

/** BarChart’s default Tooltip cursor is a light band — looks white on dark backgrounds. */
const BAR_TOOLTIP = {
  ...TOOLTIP,
  cursor: { fill: "rgba(255, 255, 255, 0.06)" },
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const JOBS_CHART_WINDOW_DAYS = 30;

function dateKeyFromAppliedDate(raw, fallbackYear) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const yFallback = Number(fallbackYear);

  // YYYY/MM/DD
  let m = s.match(/^(\d{4})[\/](\d{1,2})[\/](\d{1,2})$/);
  if (m) {
    const y = Number(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    if (y >= 1900 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
  }

  // MM/DD[/YYYY]
  m = s.match(/^(\d{1,2})[\/](\d{1,2})(?:[\/](\d{4}))?$/);
  if (m) {
    const mm = Number(m[1]);
    const dd = Number(m[2]);
    const y = m[3] ? Number(m[3]) : yFallback;
    if (y >= 1900 && mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
  }

  // Month name + day (optionally year): "May 8", "May 8, 2026"
  m = s.match(/^([A-Za-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/);
  if (m) {
    const mon = m[1].slice(0, 3).toLowerCase();
    const monthMap = {
      jan: 1,
      feb: 2,
      mar: 3,
      apr: 4,
      may: 5,
      jun: 6,
      jul: 7,
      aug: 8,
      sep: 9,
      oct: 10,
      nov: 11,
      dec: 12,
    };
    const mm = monthMap[mon];
    const dd = Number(m[2]);
    const y = m[3] ? Number(m[3]) : yFallback;
    if (mm && y >= 1900 && dd >= 1 && dd <= 31) {
      return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    }
  }

  // Final fallback for fully qualified parseable strings.
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

function mergeJobsAppliedFromSheet(series, jobApplications, endDateKey) {
  const counts = new Map();
  const fallbackYear = Number(String(endDateKey || "").slice(0, 4)) || new Date().getFullYear();
  for (const row of Array.isArray(jobApplications) ? jobApplications : []) {
    const key =
      (typeof row?.appliedDateKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.appliedDateKey)
        ? row.appliedDateKey
        : null) || dateKeyFromAppliedDate(row?.appliedDate, fallbackYear);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return series.map((r) => {
    const fromSheet = counts.get(r.date);
    if (fromSheet != null) return { ...r, jobsApplied: fromSheet };
    return r;
  });
}

function MetricCard({ label, value, unit, sub }) {
  return (
    <div className="metric-stat">
      <div className="metric-label">{label}</div>
      <div className="metric-value">
        {value != null && value !== "" ? value : "—"}
        {unit && value != null && value !== "" && (
          <span className="metric-unit">{unit}</span>
        )}
      </div>
      {sub && <div className="metric-sub muted small">{sub}</div>}
    </div>
  );
}

function arcPath(cx, cy, r, startDeg, endDeg) {
  const toRad = (deg) => ((deg - 90) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(toRad(startDeg));
  const y1 = cy + r * Math.sin(toRad(startDeg));
  const x2 = cx + r * Math.cos(toRad(endDeg));
  const y2 = cy + r * Math.sin(toRad(endDeg));
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
}

function ProteinGaugeMetric({ grams, goal = 110 }) {
  const hasProtein = Number.isFinite(Number(grams));
  const protein = hasProtein ? Number(grams) : 0;
  const pct = goal > 0 ? (protein / goal) * 100 : 0;
  const bounded = Math.max(0, Math.min(100, pct));
  const sweep = 180 * (bounded / 100);
  const shown = hasProtein ? `${Math.round(protein)}g` : "—";

  return (
    <div className="metric-stat metric-stat--protein">
      <div className="metric-label">Protein</div>
      <div className="protein-gauge" aria-label={`Protein consumed ${shown} out of ${goal}g goal`}>
        <svg viewBox="0 0 200 120" role="img" aria-hidden="true">
          <path className="protein-gauge__track" d={arcPath(100, 100, 72, 270, 90)} />
          <path className="protein-gauge__fill" d={arcPath(100, 100, 72, 270, 270 + sweep)} />
        </svg>
        <div className="protein-gauge__value">{shown}</div>
      </div>
    </div>
  );
}

/** Top KPI strip — rendered in masthead above the sidebar + main pane. */
export function DashboardMetrics({ days, chartEndDate }) {
  const series = daysToSeries(days, {
    endDateKey: chartEndDate,
    windowDays: CHART_WINDOW_DAYS,
  });
  const latest = latestDayEntry(series);

  return (
    <section className="metrics-row" aria-label="Today’s metrics">
      <MetricCard label="Sleep" value={latest?.sleepHours} unit="h" />
      <MetricCard
        label="Steps"
        value={latest?.steps != null ? latest.steps.toLocaleString() : null}
        unit=""
      />
      <MetricCard
        label="Jobs applied (today)"
        value={latest?.jobsApplied != null ? String(latest.jobsApplied) : null}
        unit=""
        sub="Log applications in standup"
      />
      <MetricCard
        label="Workout"
        value={latest?.workout}
        unit=""
        sub="Log in Telegram"
      />
      <MetricCard
        label="Daily score"
        value={latest?.dailyScore}
        unit="/100"
        sub="AI estimate from your messages"
      />
      <ProteinGaugeMetric grams={latest?.protein} goal={110} />
    </section>
  );
}

function ChartShell({ title, children, empty }) {
  return (
    <div className="chart-block">
      <h3 className="chart-title">{title}</h3>
      {empty ? (
        <p className="muted small chart-empty">Not enough data yet.</p>
      ) : (
        <div className="chart-wrap">{children}</div>
      )}
    </div>
  );
}

/** Wispr-style month streak grid: weekday labels + intensity squares + legend. */
function StreakHeatmapChart({ title, subtitle, columns }) {
  const flat = columns.flatMap((col) => col);
  const inMonthCount = flat.filter((c) => c.inMonth).length;
  const inMonthCells = columns.flatMap((weekCol, weekIdx) =>
    weekCol
      .map((cell) => ({ ...cell, weekIdx }))
      .filter((cell) => cell.inMonth)
      .map((cell) => {
        const d = new Date(`${cell.dateKey}T00:00:00Z`);
        return { ...cell, dow: d.getUTCDay() };
      })
  );

  return (
    <div className="chart-block streak-heatmap-chart">
      <h3 className="chart-title">{title}</h3>
      {subtitle && <p className="muted small contribution-hint">{subtitle}</p>}
      <div className="streak-heatmap">
        <div className="streak-heatmap__dow" aria-hidden="true">
          {WEEKDAY_LABELS.map((d) => (
            <span key={d} className="streak-heatmap__dow-label">
              {d}
            </span>
          ))}
        </div>
        <div className="streak-heatmap__scroll">
          <div
            className="streak-heatmap__cells"
            role="img"
            aria-label={`${title}, ${inMonthCount} days in month`}
            style={{ "--streak-week-cols": String(columns.length) }}
          >
            {inMonthCells.map((cell) => (
              <div
                key={cell.dateKey}
                className={`streak-cell streak-cell--l${Math.max(1, Math.min(4, cell.level || 1))}`}
                title={formatChartAxisLabel(cell.dateKey)}
                style={{
                  gridColumn: `${cell.weekIdx + 1}`,
                  gridRow: `${cell.dow + 1}`,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function JobApplicationsPanel({ jobApplications, ready }) {
  const list = Array.isArray(jobApplications) ? jobApplications : [];
  return (
    <section className="panel job-applications-panel">
      <h2 className="panel-title">Job applications (Google Sheet)</h2>
      {!ready ? (
        <p className="muted small" style={{ marginBottom: 0 }}>
          Loading…
        </p>
      ) : !list.length ? (
        <p className="muted small" style={{ marginBottom: 0 }}>
          No rows synced yet. When your sheet is connected, applications appear here.
        </p>
      ) : (
        <>
          <p className="muted small" style={{ marginBottom: "0.75rem" }}>
            Synced from your sheet; backend refreshes hourly when configured.
          </p>
          <ul className="accomplishment-list" style={{ margin: 0 }}>
            {list.map((j) => (
              <li key={j.id} style={{ marginBottom: "0.5rem" }}>
                <strong>{j.company || "—"}</strong>
                {j.role ? ` · ${j.role}` : ""}
                {j.status ? (
                  <span className="pill" style={{ marginLeft: "0.35rem" }}>
                    {j.status}
                  </span>
                ) : null}
                {j.appliedDate ? (
                  <span className="muted small" style={{ marginLeft: "0.35rem" }}>
                    applied {j.appliedDate}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * @param {object} props
 * @param {Record<string, unknown> | null | undefined} props.days
 * @param {string} props.chartEndDate
 * @param {AppNavSection} props.section — `data` is not rendered here (handled in App).
 * @param {unknown[] | undefined} props.jobApplications
 * @param {boolean} [props.jobApplicationsReady]
 */
export function AnalyticsDashboard({
  days,
  chartEndDate,
  section,
  jobApplications,
  jobApplicationsReady = true,
}) {
  const proteinGoal = proteinGoalGrams();
  const series = daysToSeries(days, {
    endDateKey: chartEndDate,
    windowDays: CHART_WINDOW_DAYS,
  });
  const jobsBaseSeries = daysToSeries(days, {
    endDateKey: chartEndDate,
    windowDays: JOBS_CHART_WINDOW_DAYS,
  });
  const jobsSeries = mergeJobsAppliedFromSheet(jobsBaseSeries, jobApplications, chartEndDate);
  const hasAnyPoint = series.some(
    (r) =>
      r.dailyScore != null ||
      r.sleepHours != null ||
      r.steps != null ||
      r.jobsApplied != null ||
      r.protein != null ||
      r.calories != null ||
      r.caloriesBurned != null
  );

  const hasScore = series.some((r) => r.dailyScore != null);
  const hasSleep = series.some((r) => r.sleepHours != null);
  const hasSteps = series.some((r) => r.steps != null);
  const hasJobs = jobsSeries.some((r) => r.jobsApplied != null);
  const hasCalIntake = series.some((r) => r.calories != null);
  const hasCalBurned = series.some((r) => r.caloriesBurned != null);
  const hasCalorieNet = series.some((r) => r.calorieNet != null);
  const hasProtein = series.some((r) => r.protein != null);
  const hasCaloriesChart = hasCalIntake || hasCalBurned;

  const workoutGrid = chartEndDate ? buildWorkoutMonthGrid(chartEndDate, days || {}) : { title: "", columns: [] };
  const proteinHeatGrid = chartEndDate
    ? buildProteinIntakeMonthGrid(chartEndDate, days || {}, proteinGoal)
    : { title: "", columns: [] };

  const showHealthCharts = section === "health";
  const showJobsCharts = section === "jobs";
  const showDashboardCopy = section === "dashboard";

  return (
    <div className="analytics analytics--subnav">
      {showDashboardCopy && !hasAnyPoint && (
        <p className="muted dashboard-analytics-tip">
          Charts fill in as Gemini extracts sleep, steps, score, and macros from your standups. Open{" "}
          <strong>Health</strong> or <strong>Jobs</strong> for trends and tables.
        </p>
      )}

      {showHealthCharts && (
        <>
          {!hasAnyPoint && (
            <p className="muted">
              Charts fill in as Gemini extracts sleep, steps, score, and macros from your standups.
            </p>
          )}
          <p className="muted small chart-window-hint">
            Weekly line/bar charts use the last {CHART_WINDOW_DAYS} days (ending today). Streak grids show the full
            calendar month (Wispr-style heatmaps for workouts &amp; protein).
          </p>
          <div className="charts-grid">
            {workoutGrid.columns.length > 0 && (
              <StreakHeatmapChart
                title={`Workouts · ${workoutGrid.title}`}
                subtitle="Teal intensity = logged workout; lighter cells = rest or no entry (outside-month squares are muted)."
                columns={workoutGrid.columns}
              />
            )}

            {proteinHeatGrid.columns.length > 0 && (
              <StreakHeatmapChart
                title={`Protein intake · ${proteinHeatGrid.title}`}
                subtitle={`Shades show how close you got to ~${proteinGoal}g that day — More = at or above goal.`}
                columns={proteinHeatGrid.columns}
              />
            )}

            <ChartShell title="Sleep (hours)" empty={!hasSleep}>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: CHART_GRID }} tickLine={false} />
                  <YAxis tick={AXIS_TICK} width={36} axisLine={false} tickLine={false} />
                  <Tooltip {...TOOLTIP} />
                  <Line
                    type="monotone"
                    dataKey="sleepHours"
                    name="Sleep"
                    stroke={COLORS.sleep}
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: COLORS.sleep, strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartShell>

            <ChartShell title="Steps" empty={!hasSteps}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: CHART_GRID }} tickLine={false} />
                  <YAxis tick={AXIS_TICK} width={44} axisLine={false} tickLine={false} />
                  <Tooltip {...BAR_TOOLTIP} />
                  <Bar dataKey="steps" name="Steps" fill={COLORS.steps} radius={[6, 6, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            </ChartShell>

            <div className="chart-row-split">
              <ChartShell title="Calories: intake vs burned" empty={!hasCaloriesChart}>
                <>
                  <p className="muted small chart-inline-hint">
                    Same scale (kcal): food logged in vs active energy out per day.
                  </p>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                      <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: CHART_GRID }} tickLine={false} />
                      <YAxis tick={AXIS_TICK} width={48} axisLine={false} tickLine={false} />
                      <Tooltip {...TOOLTIP} />
                      <Line
                        type="monotone"
                        dataKey="calories"
                        name="Intake (kcal)"
                        stroke={COLORS.calories}
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: COLORS.calories, strokeWidth: 0 }}
                        activeDot={{ r: 5 }}
                        connectNulls
                      />
                      <Line
                        type="monotone"
                        dataKey="caloriesBurned"
                        name="Burned (kcal)"
                        stroke={COLORS.caloriesBurn}
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: COLORS.caloriesBurn, strokeWidth: 0 }}
                        activeDot={{ r: 5 }}
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </>
              </ChartShell>

              <ChartShell title="Net calories (deficit or surplus)" empty={!hasCalorieNet}>
                <>
                  <p className="muted small chart-inline-hint">
                    Intake − burned. Below the line = calorie deficit; above = surplus.
                  </p>
                  <ResponsiveContainer width="100%" height={240}>
                    <LineChart data={series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                      <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: CHART_GRID }} tickLine={false} />
                      <YAxis tick={AXIS_TICK} width={48} axisLine={false} tickLine={false} />
                      <Tooltip {...TOOLTIP} />
                      <ReferenceLine y={0} stroke="#52525b" strokeDasharray="4 4" />
                      <Line
                        type="monotone"
                        dataKey="calorieNet"
                        name="Net (kcal)"
                        stroke={COLORS.calorieNet}
                        strokeWidth={2.5}
                        dot={{ r: 3, fill: COLORS.calorieNet, strokeWidth: 0 }}
                        activeDot={{ r: 5 }}
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </>
              </ChartShell>
            </div>

            <ChartShell title={`Protein intake vs minimum (${proteinGoal}g / day)`} empty={!hasProtein}>
              <>
                <p className="muted small chart-inline-hint">
                  Bars = protein you logged; dashed line = daily minimum target (set{" "}
                  <code className="code-inline">VITE_PROTEIN_GOAL_GRAMS</code> if not {proteinGoal}g). Carbs and fat
                  are not charted here.
                </p>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                    <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: CHART_GRID }} tickLine={false} />
                    <YAxis tick={AXIS_TICK} width={44} axisLine={false} tickLine={false} />
                    <Tooltip {...BAR_TOOLTIP} />
                    <ReferenceLine
                      y={proteinGoal}
                      stroke="#71717a"
                      strokeDasharray="5 5"
                      label={{
                        value: `Min ${proteinGoal}g`,
                        fill: "#a1a1aa",
                        fontSize: 11,
                        fontFamily: CHART_FONT_SANS,
                        position: "insideTopRight",
                      }}
                    />
                    <Bar dataKey="protein" name="Protein (g)" fill={COLORS.protein} maxBarSize={40} radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </>
            </ChartShell>

            <ChartShell title="Daily score (AI)" empty={!hasScore}>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: CHART_GRID }} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={AXIS_TICK} width={36} axisLine={false} tickLine={false} />
                  <Tooltip {...TOOLTIP} />
                  <Line
                    type="monotone"
                    dataKey="dailyScore"
                    name="Score"
                    stroke={COLORS.score}
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: COLORS.score, strokeWidth: 0 }}
                    activeDot={{ r: 5 }}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartShell>
          </div>
        </>
      )}

      {showJobsCharts && (
        <>
          <p className="muted small chart-window-hint">
            Jobs bar chart uses the last {JOBS_CHART_WINDOW_DAYS} days (ending today). Sheet rows list every application
            synced from Google.
          </p>
          <div className="charts-grid charts-grid--jobs">
            <ChartShell title="Jobs applied" empty={!hasJobs}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={jobsSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: CHART_GRID }} tickLine={false} />
                  <YAxis tick={AXIS_TICK} width={44} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip {...BAR_TOOLTIP} />
                  <Bar
                    dataKey="jobsApplied"
                    name="Jobs applied"
                    fill={COLORS.jobs}
                    radius={[6, 6, 0, 0]}
                    maxBarSize={48}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartShell>
          </div>
          <JobApplicationsPanel jobApplications={jobApplications} ready={jobApplicationsReady} />
        </>
      )}
    </div>
  );
}
