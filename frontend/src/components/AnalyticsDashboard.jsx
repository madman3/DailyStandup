import { useEffect, useMemo, useState } from "react";
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
  mergeJobsAppliedFromSheet,
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

function MetricCard({ label, value, unit, sub, className }) {
  return (
    <div className={className ? `metric-stat ${className}` : "metric-stat"}>
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
export function DashboardMetrics({ days, selectedDate, jobApplications, chartEndDate }) {
  const latest = days?.[selectedDate] ?? null;
  const proteinGrams = latest?.macros?.protein ?? null;
  const metricsSeries = mergeJobsAppliedFromSheet(
    daysToSeries(days, { endDateKey: selectedDate, windowDays: CHART_WINDOW_DAYS }),
    jobApplications,
    chartEndDate ?? selectedDate
  );
  const selectedRow = metricsSeries.find((r) => r.date === selectedDate);
  const jobsApplied = selectedRow?.jobsApplied ?? null;

  return (
    <section className="metrics-row" aria-label="Today’s metrics">
      <MetricCard label="Active Calories" value={latest?.caloriesBurned} unit="kcal" />
      <MetricCard
        label="Steps"
        value={latest?.steps != null ? latest.steps.toLocaleString() : null}
        unit=""
      />
      <MetricCard
        label="Jobs"
        value={jobsApplied != null ? String(jobsApplied) : null}
        unit=""
      />
      <MetricCard
        className="metric-stat--workout-wide"
        label="Workout"
        value={latest?.workout}
        unit=""
      />
      <ProteinGaugeMetric grams={proteinGrams} goal={110} />
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

function paginationPages(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [1];
  if (current > 3) pages.push("…");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) {
    pages.push(p);
  }
  if (current < total - 2) pages.push("…");
  pages.push(total);
  return pages;
}

function JobApplicationsPanel({ jobApplications, ready }) {
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const list = useMemo(() => {
    if (!Array.isArray(jobApplications)) return [];
    return [...jobApplications].sort((a, b) => {
      // most recent first — sort by appliedDate descending
      const da = a.appliedDateKey || a.appliedDate || "";
      const db = b.appliedDateKey || b.appliedDate || "";
      return db.localeCompare(da);
    });
  }, [jobApplications]);

  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const paginated = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // reset to page 1 if data changes
  useEffect(() => {
    setPage(1);
  }, [jobApplications?.length]);

  return (
    <section className="panel job-applications-panel">
      <h2 className="panel-title">Applications</h2>
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
          <div className="jobs-table" role="table" aria-label="Applications">
            <div className="jobs-table__header" role="row">
              <span className="jobs-table__col--company" role="columnheader">
                Company
              </span>
              <span className="jobs-table__col--role" role="columnheader">
                Role
              </span>
              <span className="jobs-table__col--status" role="columnheader">
                Status
              </span>
              <span className="jobs-table__col--date" role="columnheader">
                Date
              </span>
            </div>

            {paginated.map((j) => {
              const rawStatus = typeof j.status === "string" ? j.status.trim() : "";
              const s = rawStatus.toLowerCase();
              const plainStatus = s === "rejected" || s === "filled";
              return (
                <div key={j.id} className="jobs-table__row" role="row">
                  <span className="jobs-table__col--company">{j.company || "—"}</span>
                  <span className="jobs-table__col--role">{j.role || "—"}</span>
                  <span className="jobs-table__col--status">
                    {plainStatus ? (
                      <span className="jobs-table__status--plain">{rawStatus}</span>
                    ) : rawStatus ? (
                      <span className="pill">{rawStatus}</span>
                    ) : null}
                  </span>
                  <span className="jobs-table__col--date">{j.appliedDate || "—"}</span>
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="jobs-pagination" aria-label="Pagination">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                ←
              </button>
              {paginationPages(page, totalPages).map((p, i) =>
                p === "…" ? (
                  <span key={`ellipsis-${i}`} className="jobs-pagination__ellipsis">
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    className={p === page ? "jobs-pagination__btn--active" : ""}
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </button>
                )
              )}
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
              >
                →
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * @param {object} props
 * @param {Record<string, unknown> | null | undefined} props.days
 * @param {string} props.chartEndDate — calendar “today” (YYYY-MM-DD); caps the date picker
 * @param {string} props.selectedDate — health metrics + masthead KPIs use this calendar day (YYYY-MM-DD)
 * @param {(key: string) => void} props.onSelectedDateChange
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
  selectedDate: selectedDateProp,
  onSelectedDateChange,
}) {
  const todayKey = chartEndDate;
  const selectedDate = selectedDateProp ?? chartEndDate;
  const proteinGoal = proteinGoalGrams();
  const seriesEndDate = section === "health" ? selectedDate : chartEndDate;
  const series = mergeJobsAppliedFromSheet(
    daysToSeries(days, {
      endDateKey: seriesEndDate,
      windowDays: CHART_WINDOW_DAYS,
    }),
    jobApplications,
    chartEndDate
  );
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

  const showHealthCharts = section === "health";
  const showJobsCharts = section === "jobs";
  const showDashboardCopy = section === "dashboard";

  const workoutGrid =
    showHealthCharts && selectedDate
      ? buildWorkoutMonthGrid(selectedDate, days || {})
      : { title: "", columns: [] };
  const proteinHeatGrid =
    showHealthCharts && selectedDate
      ? buildProteinIntakeMonthGrid(selectedDate, days || {}, proteinGoal)
      : { title: "", columns: [] };

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
          <div className="chart-hint-row chart-hint-row--end">
            <div className="date-picker-wrap">
              <span className="date-picker-display">
                {new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
              <button type="button" className="date-picker-btn" aria-label="Pick a date">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <rect x="1" y="3" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M1 7h14" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M5 1v3M11 1v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <input
                  type="date"
                  value={selectedDate}
                  max={todayKey}
                  onChange={(e) => e.target.value && onSelectedDateChange?.(e.target.value)}
                  aria-hidden="true"
                  tabIndex={-1}
                />
              </button>
            </div>
          </div>
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
                    Same scale (kcal): food logged in vs total energy burned per day (active + resting).
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
                    Intake − total energy burned (active + resting). Below the line = calorie deficit; above =
                    surplus.
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
          <div className="charts-grid charts-grid--jobs">
            <ChartShell title="Daily" empty={!hasJobs}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={jobsSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
                  <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: CHART_GRID }} tickLine={false} />
                  <YAxis tick={AXIS_TICK} width={44} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip {...BAR_TOOLTIP} />
                  <Bar
                    dataKey="jobsApplied"
                    name="Daily"
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
