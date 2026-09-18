interface KpiTileProps {
  label: string;
  value: string;
  sub?: string;
  delta?: { text: string; positive: boolean };
}

/** Metric tile: mono uppercase label, large flat-400 value, quiet delta line. */
export default function KpiTile({ label, value, sub, delta }: KpiTileProps) {
  return (
    <div className="rounded-card border border-carbon p-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-stone">{label}</p>
      <p className="mt-3 text-2xl leading-none tracking-tight text-bone tabular-nums">{value}</p>
      {(delta || sub) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {delta && (
            <span
              className={`font-mono text-[11px] ${delta.positive ? 'text-metric' : 'text-signal'}`}
            >
              {delta.positive ? '▲' : '▼'} {delta.text}
            </span>
          )}
          {sub && <span className="text-xs text-granite">{sub}</span>}
        </div>
      )}
    </div>
  );
}
