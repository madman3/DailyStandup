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
  buildGoalsMonthGrid,
  buildWorkoutMonthGrid,
  CHART_WINDOW_DAYS,
  daysToSeries,
  formatChartAxisLabel,
  latestDayEntry,
} from "../lib/series";

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
const AXIS_TICK = { fill: "#a1a1aa", fontSize: 11 };
const TOOLTIP = {
  contentStyle: {
    backgroundColor: "#0a0a0c",
    border: "1px solid #3f3f46",
    borderRadius: 10,
    boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
  },
  labelStyle: { color: "#e4e4e7" },
  itemStyle: { color: "#e4e4e7" },
};

/** BarChart’s default Tooltip cursor is a light band — looks white on dark backgrounds. */
const BAR_TOOLTIP = {
  ...TOOLTIP,
  cursor: { fill: "rgba(255, 255, 255, 0.06)" },
};

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

function ContributionMonthChart({ title, subtitle, columns }) {
  const flat = columns.flatMap((col) => col);
  return (
    <div className="chart-block">
      <h3 className="chart-title">{title}</h3>
      <p className="muted small contribution-hint">{subtitle}</p>
      <div className="contribution-grid-outer">
        <div
          className="contribution-grid"
          role="img"
          aria-label={`${title} for ${flat.filter((c) => c.inMonth).length} days in view`}
        >
          {flat.map((cell) => {
            const tip = cell.inMonth ? formatChartAxisLabel(cell.dateKey) : "";
            let cls = "contribution-cell";
            if (!cell.inMonth) cls += " contribution-cell--muted";
            else if (cell.active) cls += " contribution-cell--on";
            else cls += " contribution-cell--off";
            return (
              <div
                key={cell.dateKey}
                className={cls}
                title={tip || undefined}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function AnalyticsDashboard({ days, chartEndDate }) {
  const proteinGoal = proteinGoalGrams();
  const series = daysToSeries(days, {
    endDateKey: chartEndDate,
    windowDays: CHART_WINDOW_DAYS,
  });
  const latest = latestDayEntry(series);
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
  const hasJobs = series.some((r) => r.jobsApplied != null);
  const hasCalIntake = series.some((r) => r.calories != null);
  const hasCalBurned = series.some((r) => r.caloriesBurned != null);
  const hasCalorieNet = series.some((r) => r.calorieNet != null);
  const hasProtein = series.some((r) => r.protein != null);
  const hasCaloriesChart = hasCalIntake || hasCalBurned;

  const workoutGrid = chartEndDate ? buildWorkoutMonthGrid(chartEndDate, days || {}) : { title: "", columns: [] };
  const goalsGrid = chartEndDate
    ? buildGoalsMonthGrid(chartEndDate, days || {}, proteinGoal)
    : { title: "", columns: [] };

  return (
    <div className="analytics">
      <section className="metrics-row">
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
          sub={latest?.jobsApplied != null ? undefined : "Log applications in standup"}
        />
        <MetricCard
          label="Workout"
          value={latest?.workout}
          unit=""
          sub={latest?.workout ? undefined : "Log in Telegram"}
        />
        {latest?.calories != null && (
          <MetricCard
            label="Intake (kcal)"
            value={latest.calories.toLocaleString()}
            unit=""
            sub="Food / logged calories"
          />
        )}
        {latest?.caloriesBurned != null && (
          <MetricCard
            label="Burned (kcal)"
            value={latest.caloriesBurned.toLocaleString()}
            unit=""
            sub="Active energy out"
          />
        )}
        {latest?.calorieNet != null && (
          <MetricCard
            label="Net kcal (today)"
            value={latest.calorieNet > 0 ? `+${latest.calorieNet}` : String(latest.calorieNet)}
            unit=""
            sub={
              latest.calorieNet < 0
                ? "Deficit (intake − burn)"
                : latest.calorieNet > 0
                  ? "Surplus"
                  : "Maintenance"
            }
          />
        )}
        <MetricCard
          label="Daily score"
          value={latest?.dailyScore}
          unit="/100"
          sub="AI estimate from your messages"
        />
      </section>

      {latest?.coachingInsight && (
        <div className="insight-card">
          <div className="insight-label">Coaching insight</div>
          <p className="insight-text">{latest.coachingInsight}</p>
        </div>
      )}

      {!hasAnyPoint && (
        <p className="muted">
          Charts fill in as Gemini extracts sleep, steps, score, and macros from your standups.
        </p>
      )}

      <p className="muted small chart-window-hint">
        Trends show the last {CHART_WINDOW_DAYS} calendar days (ending today). Days without a log
        appear as gaps.
      </p>

      <div className="charts-grid">
        {workoutGrid.columns.length > 0 && (
          <ContributionMonthChart
            title={`Workouts · ${workoutGrid.title}`}
            subtitle="Green = logged a workout (rest/skip days stay dark)."
            columns={workoutGrid.columns}
          />
        )}

        {goalsGrid.columns.length > 0 && (
          <ContributionMonthChart
            title={`Protein + deficit · ${goalsGrid.title}`}
            subtitle={`Green = protein ≥ ${proteinGoal}g and net calories below zero (same day).`}
            columns={goalsGrid.columns}
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

        <ChartShell title="Jobs applied" empty={!hasJobs}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
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
              <code className="code-inline">VITE_PROTEIN_GOAL_GRAMS</code> if not {proteinGoal}g). Carbs and fat are
              not charted here.
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
    </div>
  );
}
