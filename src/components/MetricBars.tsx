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
  if (rows.length === 0) {
    return <p className="text-sm text-granite">No data</p>;
  }
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.label} className="flex items-center gap-3">
          <span
            className={`w-28 shrink-0 truncate text-xs sm:w-40 sm:text-sm ${
              row.dimmed ? 'text-granite' : 'text-bone'
            }`}
            title={row.label}
          >
            {row.label}
          </span>
          <span className="relative h-5 flex-1 rounded-sm bg-carbon">
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
            {row.displayValue}
          </span>
          {row.secondary !== undefined && (
            <span className="hidden w-28 shrink-0 text-right font-mono text-[10px] uppercase tracking-[0.06em] text-granite tabular-nums md:inline-block">
              {row.secondary}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
