import { useMemo } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { FORECAST_CATEGORIES, FORECAST_CATEGORY_META, TARGET_COLOR } from '../data/constants';
import type { ForecastCategory } from '../data/types';
import { formatDayShort, formatUsdCompact } from '../lib/format';
import type { WeeklyForecastRow } from '../lib/metrics';

const MONO = '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

/** Stack order, most confident category at the base of each bar. */
const STACK_ORDER: ForecastCategory[] = [...FORECAST_CATEGORIES].reverse();

interface ChartRow extends WeeklyForecastRow {
  /** Short axis label for the week, e.g. 'Aug 3'. */
  label: string;
  /** The quarter's revenue goal, drawn as the dashed line. */
  goal: number;
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

const TOOLTIP_STYLE: React.CSSProperties = {
  background: '#1d1a18',
  border: '1px solid #3d3a39',
  borderRadius: 3,
  fontSize: 12,
  color: '#eeeeee',
  padding: '8px 10px',
};

function WowDelta({ delta }: { delta: number | null }) {
  if (delta === null) {
    return <span style={{ color: '#8a8380' }}>first week</span>;
  }
  const rounded = Math.round(delta);
  if (rounded === 0) {
    return <span style={{ color: '#8a8380' }}>flat WoW</span>;
  }
  const up = rounded > 0;
  return (
    <span style={{ color: up ? '#a0ca92' : '#ee6018' }}>
      {up ? '+' : '−'}
      {formatUsdCompact(Math.abs(rounded))} WoW
    </span>
  );
}

interface TooltipEntry {
  payload?: ChartRow;
}

function WeekTooltip({ active, payload }: { active?: boolean; payload?: TooltipEntry[] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  if (!row.hasStarted) {
    return (
      <div style={TOOLTIP_STYLE}>
        <p
          style={{
            fontFamily: MONO,
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: '#b8b3b0',
          }}
        >
          Week of {row.label}
        </p>
        <p style={{ marginTop: 4, color: '#8a8380' }}>Hasn't started yet.</p>
      </div>
    );
  }
  const valueStyle: React.CSSProperties = {
    float: 'right',
    marginLeft: 16,
    fontVariantNumeric: 'tabular-nums',
  };
  return (
    <div style={TOOLTIP_STYLE}>
      <p
        style={{
          fontFamily: MONO,
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: '#b8b3b0',
        }}
      >
        Week of {row.label}
      </p>
      <p style={{ marginTop: 6 }}>
        Total pipeline
        <span style={valueStyle}>{formatUsdCompact(row.total)}</span>
      </p>
      <p style={{ marginTop: 2, color: '#8a8380', fontSize: 11 }}>
        <WowDelta delta={row.wowTotal} />
      </p>
      <p style={{ marginTop: 6 }}>
        Weighted forecast
        <span style={valueStyle}>{formatUsdCompact(row.weightedTotal)}</span>
      </p>
      <p style={{ marginTop: 2, color: '#8a8380', fontSize: 11 }}>
        <WowDelta delta={row.wowWeighted} />
      </p>
      <p style={{ marginTop: 6, borderTop: '1px solid #3d3a39', paddingTop: 6, color: '#8a8380' }}>
        Revenue goal
        <span style={valueStyle}>{formatUsdCompact(row.goal)}</span>
      </p>
      <p style={{ marginTop: 4, fontSize: 11, color: '#8a8380' }}>
        {row.recordedAt
          ? `Snapshot recorded ${formatDayShort(row.recordedAt)}`
          : 'Live book · moves with edits'}
      </p>
    </div>
  );
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
 * live book, a distinction the tooltip states outright: it decides whether a
 * week-over-week move is history or an edit made minutes ago.
 */
export default function WeeklyForecastChart({
  rows,
  goal,
}: {
  rows: WeeklyForecastRow[];
  goal: number;
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
    <div>
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
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
            <Tooltip content={<WeekTooltip />} cursor={{ fill: 'rgba(238, 96, 24, 0.06)' }} />
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
            <Line
              dataKey="goal"
              stroke={TARGET_COLOR}
              strokeDasharray="4 4"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
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
          <span className="flex items-center gap-2">
            <span
              className="h-0 w-5 border-t-2 border-dashed"
              style={{ borderColor: TARGET_COLOR }}
            />
            Revenue goal
          </span>
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
  );
}
