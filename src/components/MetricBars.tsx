import ChartFigure from './ChartFigure';

export interface MetricBarRow {
  label: string;
  value: number;
  displayValue: string;
  secondary?: string;
  color: string;
  dimmed?: boolean;
}

/**
 * Horizontal metric bars for funnels, stage progressions, and breakdowns.
 * Flat 1px-radius tracks, inline colors so no dynamic class generation.
 */
export default function MetricBars({ rows }: { rows: MetricBarRow[] }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <ChartFigure
      name="Metric breakdown"
      summary={`${rows.length} categories with values and comparisons. Dollar values are USD; other values are counts unless day units are specified. Days are calendar days unless marked business days.`}
    >
      {rows.length === 0 && <p className="text-sm text-granite">No data</p>}
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.label} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span
              className={`w-28 shrink-0 text-xs sm:w-40 sm:text-sm ${
                row.dimmed ? 'text-granite' : 'text-bone'
              }`}
            >
              {row.label}
            </span>
            <span className="relative h-5 flex-1 rounded-sm bg-carbon" aria-hidden="true">
              <span
                className="absolute inset-y-0 left-0 rounded-sm"
                style={{
                  width: `${Math.max((row.value / max) * 100, row.value > 0 ? 2 : 0)}%`,
                  backgroundColor: row.color,
                  opacity: row.dimmed ? 0.4 : 1,
                }}
              />
            </span>
            <span
              className={`w-20 shrink-0 text-right text-sm tabular-nums ${
                row.dimmed ? 'text-granite' : 'text-bone'
              }`}
            >
              {row.displayValue === '—' ? (
                <>
                  <span aria-hidden="true">—</span> No data
                </>
              ) : (
                <span>{row.displayValue}</span>
              )}
              {row.displayValue.startsWith('$') && (
                <span className="sr-only"> ({row.value} USD)</span>
              )}
            </span>
            {row.secondary !== undefined && (
              <span className="w-full text-right font-mono text-[10px] uppercase tracking-[0.06em] text-granite tabular-nums md:w-28 md:shrink-0">
                {row.secondary}
              </span>
            )}
          </li>
        ))}
      </ul>
    </ChartFigure>
  );
}
