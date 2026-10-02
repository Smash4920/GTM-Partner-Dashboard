import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import { formatUsd, formatUsdCompact } from '../lib/format';
import type { QuarterRevenueRow } from '../lib/metrics';
import ChartFigure from './ChartFigure';

const MONO = '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

/** Closed-won by quarter (metric green bars) against target (granite dashed line). */
export default function RevenueTrend({ data }: { data: QuarterRevenueRow[] }) {
  return (
    <ChartFigure
      name="Quarterly revenue vs. target"
      summary="Closed-won revenue compared with target for each fiscal quarter, in USD."
      headers={['Quarter', 'Closed-won (USD)', 'Target (USD)']}
      rows={data.map((row) => [row.quarter, formatUsd(row.closedWon), formatUsd(row.target)])}
    >
      <div className="h-72 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data}
            accessibilityLayer={false}
            margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
          >
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
    </ChartFigure>
  );
}
