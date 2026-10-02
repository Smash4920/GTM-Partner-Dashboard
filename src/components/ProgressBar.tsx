import ChartFigure from './ChartFigure';

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
  const reached = goal > 0 && value >= goal;
  const missing = hint === 'No certification data';
  const summary = missing
    ? hint
    : goal <= 0
      ? 'No goal set'
      : `${value} of ${goal}; ${Math.round((value / goal) * 100)}% of goal. ${
          value > goal ? 'Goal exceeded' : reached ? 'Goal reached' : 'Below goal'
        }`;

  return (
    <ChartFigure name={label} summary={summary}>
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-stone">
            {label}
            {hint && <span className="ml-2 text-granite">{hint}</span>}
          </p>
          {!missing && (
            <p className="font-mono text-xs tabular-nums text-bone">
              {value}/{goal}
            </p>
          )}
        </div>
        <div
          className="h-2 rounded-sm bg-carbon"
          {...(goal > 0 && !missing
            ? {
                role: 'progressbar',
                'aria-label': label,
                'aria-valuenow': Math.min(value, goal),
                'aria-valuemin': 0,
                'aria-valuemax': goal,
                'aria-valuetext': summary,
              }
            : { 'aria-hidden': true })}
        >
          <div
            className={`h-full rounded-sm transition-[width] duration-300 ${
              reached ? 'bg-metric' : 'bg-bone'
            }`}
            style={{ width: `${pct * 100}%` }}
          />
        </div>
        {goal <= 0 && <p className="text-xs text-granite">No goal set</p>}
      </div>
    </ChartFigure>
  );
}
