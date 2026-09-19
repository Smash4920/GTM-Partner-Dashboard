import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatUsdCompact } from '../lib/format';
import type { QuarterRevenueRow } from '../lib/metrics';

const MONO = '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

/** Closed-won by quarter (metric green bars) against target (granite dashed line). */
export default function RevenueTrend({ data }: { data: QuarterRevenueRow[] }) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="#1d1a18" vertical={false} />
          <XAxis
            dataKey="quarter"
            tick={{ fontSize: 11, fill: '#8a8380', fontFamily: MONO }}
            tickLine={false}
            axisLine={{ stroke: '#1d1a18' }}
          />
          <YAxis
            tickFormatter={(value) => formatUsdCompact(Number(value))}
            tick={{ fontSize: 11, fill: '#8a8380', fontFamily: MONO }}
            tickLine={false}
            axisLine={false}
            width={64}
          />
          <Tooltip
            formatter={(value) => formatUsdCompact(Number(value))}
            contentStyle={{
              background: '#1d1a18',
              border: '1px solid #3d3a39',
              borderRadius: 3,
              fontSize: 12,
              color: '#eeeeee',
            }}
            labelStyle={{
              color: '#b8b3b0',
              fontSize: 11,
              fontFamily: MONO,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
            itemStyle={{ color: '#eeeeee', fontSize: 12, padding: 0 }}
            cursor={{ fill: 'rgba(238, 96, 24, 0.06)' }}
          />
          <Legend
            wrapperStyle={{
              fontSize: 11,
              fontFamily: MONO,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: '#8a8380',
            }}
            iconType="plainline"
            iconSize={12}
          />
          {/* Animation off: the chart must render fully on first paint for static captures. */}
          <Bar
            dataKey="closedWon"
            name="Closed-won"
            fill="#a0ca92"
            radius={[3, 3, 0, 0]}
            maxBarSize={40}
            isAnimationActive={false}
          />
          <Line
            dataKey="target"
            name="Target"
            stroke="#8a8380"
            strokeDasharray="4 4"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
