interface ProgressBarProps {
  label: string;
  value: number;
  goal: number;
  /** Short qualifier shown next to the label, e.g. the partner scope. */
  hint?: string;
}

/**
 * Flat 1px progress bar. The fill snaps between bone (on track) and metric
 * green (goal reached) — color only for the state, matching the brand rules.
 */
export default function ProgressBar({ label, value, goal, hint }: ProgressBarProps) {
  const pct = goal > 0 ? Math.min(value / goal, 1) : 0;
  const reached = value >= goal;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-stone">
          {label}
          {hint && <span className="ml-2 text-granite">{hint}</span>}
        </p>
        <p className="font-mono text-xs tabular-nums text-bone">
          {value}/{goal}
        </p>
      </div>
      <div className="h-2 rounded-sm bg-carbon" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={goal}>
        <div
          className={`h-full rounded-sm transition-[width] duration-300 ${
            reached ? 'bg-metric' : 'bg-bone'
          }`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}
