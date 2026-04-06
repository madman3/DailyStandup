import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_WINDOW_DAYS, daysToSeries, latestDayEntry } from "../lib/series";

const COLORS = {
  score: "#818cf8",
  sleep: "#38bdf8",
  steps: "#4ade80",
  protein: "#c084fc",
  carbs: "#fb923c",
  fat: "#f472b6",
  calories: "#94a3b8",
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
    <div className="metric-card">
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

export function AnalyticsDashboard({ days, chartEndDate }) {
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
      r.protein != null ||
      r.carbs != null ||
      r.fat != null
  );

  const hasScore = series.some((r) => r.dailyScore != null);
  const hasSleep = series.some((r) => r.sleepHours != null);
  const hasSteps = series.some((r) => r.steps != null);
  const hasMacros = series.some(
    (r) => r.protein != null || r.carbs != null || r.fat != null || r.calories != null
  );

  return (
    <div className="analytics">
      <section className="metrics-row">
        <MetricCard
          label="Daily score"
          value={latest?.dailyScore}
          unit="/100"
          sub="AI estimate from your messages"
        />
        <MetricCard label="Sleep" value={latest?.sleepHours} unit="h" />
        <MetricCard
          label="Steps"
          value={latest?.steps != null ? latest.steps.toLocaleString() : null}
          unit=""
        />
        <MetricCard
          label="Workout"
          value={latest?.workout}
          unit=""
          sub={latest?.workout ? undefined : "Log in Telegram"}
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
        <ChartShell title="Score trend" empty={!hasScore}>
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

        <ChartShell title="Macros (g)" empty={!hasMacros}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: CHART_GRID }} tickLine={false} />
              <YAxis tick={AXIS_TICK} width={44} axisLine={false} tickLine={false} />
              <Tooltip {...BAR_TOOLTIP} />
              <Legend wrapperStyle={{ color: "#a1a1aa", fontSize: 12, paddingTop: 8 }} />
              <Bar dataKey="protein" name="Protein (g)" fill={COLORS.protein} maxBarSize={28} radius={[4, 4, 0, 0]} />
              <Bar dataKey="carbs" name="Carbs (g)" fill={COLORS.carbs} maxBarSize={28} radius={[4, 4, 0, 0]} />
              <Bar dataKey="fat" name="Fat (g)" fill={COLORS.fat} maxBarSize={28} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartShell>

        <ChartShell title="Calories (if logged)" empty={!series.some((r) => r.calories != null)}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
              <XAxis dataKey="label" tick={AXIS_TICK} axisLine={{ stroke: CHART_GRID }} tickLine={false} />
              <YAxis tick={AXIS_TICK} width={48} axisLine={false} tickLine={false} />
              <Tooltip {...TOOLTIP} />
              <Line
                type="monotone"
                dataKey="calories"
                name="Calories"
                stroke={COLORS.calories}
                strokeWidth={2.5}
                dot={{ r: 3, fill: COLORS.calories, strokeWidth: 0 }}
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
