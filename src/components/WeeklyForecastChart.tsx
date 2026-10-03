import { useMemo } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import {
  FORECAST_CATEGORIES,
  FORECAST_CATEGORY_META,
  SNAPSHOT_DATE,
  TARGET_COLOR,
} from '../data/constants';
import type { ForecastCategory } from '../data/types';
import { formatDate, formatDayShort, formatUsd, formatUsdCompact } from '../lib/format';
import type { WeeklyForecastRow } from '../lib/metrics';
import ChartFigure from './ChartFigure';

const MONO = '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

/** Stack order, most confident category at the base of each bar. */
const STACK_ORDER: ForecastCategory[] = [...FORECAST_CATEGORIES].reverse();

interface ChartRow extends WeeklyForecastRow {
  /** Short axis label for the week, e.g. 'Aug 3'. */
  label: string;
  /** The quarter's revenue goal, drawn as the dashed line when it is known. */
  goal: number | undefined;
  /** Change vs the previous started week; null when there is none. */
  wowTotal: number | null;
  wowWeighted: number | null;
}

/** Category color at reduced opacity: the weighted twin reads as the same pipeline, discounted. */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function wowDelta(delta: number | null): string {
  if (delta === null) return 'first week';
  const rounded = Math.round(delta);
  if (rounded === 0) return 'flat WoW';
  return `${rounded > 0 ? '+' : '−'}${formatUsd(Math.abs(rounded))} WoW`;
}

function weekSource(row: WeeklyForecastRow): string {
  if (!row.hasStarted) return "Hasn't started yet";
  if (row.recordedAt) return `Snapshot recorded ${formatDate(row.recordedAt)}`;
  // Only the bucket containing the deterministic reporting snapshot is live;
  // a past week without a recording is reconstructed, not immutable history.
  return new Date(row.weekStart) <= SNAPSHOT_DATE && new Date(row.weekEnd) > SNAPSHOT_DATE
    ? 'Live book · moves with session edits'
    : 'Reconstructed from current book';
}

/** A four-color strip standing in for one stacked bar: solid = raw, faded = weighted. */
function StackSwatch({ faded }: { faded: boolean }) {
  return (
    <span className="flex h-2.5 w-8 overflow-hidden rounded-[1px]">
      {STACK_ORDER.map((category) => (
        <span
          key={category}
          className="h-full flex-1"
          style={{
            backgroundColor: withAlpha(FORECAST_CATEGORY_META[category].color, faded ? 0.5 : 1),
          }}
        />
      ))}
    </span>
  );
}

/**
 * Week-over-week pipeline for the quarter: per week a cluster of two stacked
 * bars — the raw open pipeline by forecast category (solid) beside the same
 * book weighted by close probability (faded) — with the quarter's revenue
 * goal as a dashed line across the whole axis. Weeks that have not begun
 * render as empty slots, so the axis always spans the quarter and a new
 * point appears as each week starts.
 *
 * Closed weeks come from recorded snapshots and the in-progress week from the
 * live book, a distinction the adjacent data table states outright: it decides whether a
 * week-over-week move is history or an edit made minutes ago.
 *
 * The goal line is optional: the weekly series and the summary are separate
 * queries, and a failed summary must not take the chart down with it — the
 * bars still render, only the dashed line and its legend entry sit out.
 */
export default function WeeklyForecastChart({
  rows,
  goal,
}: {
  rows: WeeklyForecastRow[];
  goal?: number;
}) {
  const data = useMemo<ChartRow[]>(() => {
    let prevTotal: number | null = null;
    let prevWeighted: number | null = null;
    return rows.map((row) => {
      const entry: ChartRow = {
        ...row,
        label: formatDayShort(row.weekStart),
        goal,
        wowTotal: row.hasStarted && prevTotal !== null ? row.total - prevTotal : null,
        wowWeighted:
          row.hasStarted && prevWeighted !== null ? row.weightedTotal - prevWeighted : null,
      };
      // Only started weeks become the comparison point, so future slots
      // never break the delta chain.
      if (row.hasStarted) {
        prevTotal = row.total;
        prevWeighted = row.weightedTotal;
      }
      return entry;
    });
  }, [rows, goal]);

  return (
    <ChartFigure
      name="Week-over-week pipeline"
      summary={`Raw and probability-weighted pipeline by week in USD. WoW compares the previous started week. Future weeks have no values.${
        goal === undefined ? ' Revenue goal unavailable.' : ` Revenue goal ${formatUsd(goal)}.`
      }`}
      headers={[
        'Week (end exclusive)',
        'Source / state',
        ...FORECAST_CATEGORIES.flatMap((category) => [
          `${FORECAST_CATEGORY_META[category].label} raw (USD)`,
          `${FORECAST_CATEGORY_META[category].label} weighted (USD)`,
        ]),
        'Total pipeline (USD)',
        'Weighted forecast (USD)',
        'Total pipeline WoW (USD)',
        'Weighted forecast WoW (USD)',
        ...(goal === undefined ? [] : ['Revenue goal (USD)']),
      ]}
      rows={data.map((row) => [
        `${formatDate(row.weekStart)}–${formatDate(row.weekEnd)}`,
        weekSource(row),
        ...FORECAST_CATEGORIES.flatMap((category) =>
          row.hasStarted
            ? [formatUsd(row.raw[category]), formatUsd(row.weighted[category])]
            : ['Not started', 'Not started'],
        ),
        ...(row.hasStarted
          ? [
              formatUsd(row.total),
              formatUsd(row.weightedTotal),
              wowDelta(row.wowTotal),
              wowDelta(row.wowWeighted),
            ]
          : ['Not started', 'Not started', 'Not started', 'Not started']),
        ...(goal === undefined ? [] : [formatUsd(goal)]),
      ])}
    >
      <div>
        <div className="h-80 w-full" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              accessibilityLayer={false}
              margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
            >
              <CartesianGrid stroke="#1d1a18" vertical={false} />
              <XAxis
                dataKey="label"
                interval={0}
                tick={{ fontSize: 10, fill: '#8a8380', fontFamily: MONO }}
                tickLine={false}
                axisLine={{ stroke: '#1d1a18' }}
              />
              <YAxis
                tickFormatter={(value) => formatUsdCompact(Number(value))}
                tick={{ fontSize: 11, fill: '#8a8380', fontFamily: MONO }}
                tickLine={false}
                axisLine={false}
                width={64}
                domain={[0, 'auto']}
              />
              {/* Solid stack: the raw pipeline by forecast category, commit at the base. */}
              {STACK_ORDER.map((category) => (
                <Bar
                  key={`raw-${category}`}
                  dataKey={`raw.${category}`}
                  stackId="total"
                  fill={FORECAST_CATEGORY_META[category].color}
                  maxBarSize={16}
                  isAnimationActive={false}
                />
              ))}
              {/* Faded twin: the same book × each category's close probability. */}
              {STACK_ORDER.map((category) => (
                <Bar
                  key={`weighted-${category}`}
                  dataKey={`weighted.${category}`}
                  stackId="weighted"
                  fill={withAlpha(FORECAST_CATEGORY_META[category].color, 0.5)}
                  maxBarSize={16}
                  isAnimationActive={false}
                />
              ))}
              {goal !== undefined && (
                <Line
                  dataKey="goal"
                  stroke={TARGET_COLOR}
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-4 space-y-2">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
            <span className="flex items-center gap-2">
              <StackSwatch faded={false} />
              Total pipeline
            </span>
            <span className="flex items-center gap-2">
              <StackSwatch faded />
              Weighted forecast
            </span>
            {goal !== undefined && (
              <span className="flex items-center gap-2">
                <span
                  className="h-0 w-5 border-t-2 border-dashed"
                  style={{ borderColor: TARGET_COLOR }}
                />
                Revenue goal
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-[10px] text-granite">
            {FORECAST_CATEGORIES.map((category) => (
              <span key={category} className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-[1px]"
                  style={{ backgroundColor: FORECAST_CATEGORY_META[category].color }}
                />
                {FORECAST_CATEGORY_META[category].label}{' '}
                {Math.round(FORECAST_CATEGORY_META[category].weight * 100)}%
              </span>
            ))}
          </div>
        </div>
      </div>
    </ChartFigure>
  );
}
