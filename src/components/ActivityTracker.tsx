import { MEETING_TYPES, MEETING_TYPE_META } from '../data/constants';
import type { MeetingType } from '../data/types';
import type { WeeklyActivityRow } from '../lib/metrics';
import { formatDate } from '../lib/format';

function formatWeek(row: WeeklyActivityRow, isCurrent: boolean): string {
  if (isCurrent) return 'This week';
  const start = formatDate(row.weekStart).replace(/, \d{4}$/, '');
  const end = formatDate(row.weekEnd).replace(/, \d{4}$/, '');
  return `${start}–${end}`;
}

/** Stacked weekly meeting volume, ready for a future Google Calendar feed. */
export default function ActivityTracker({ rows }: { rows: WeeklyActivityRow[] }) {
  const max = Math.max(...rows.map((row) => row.total), 1);

  return (
    <div>
      <div className="space-y-3">
        {rows.map((row, index) => (
          <div key={row.weekStart} className="grid grid-cols-[112px_1fr_42px] items-center gap-3">
            <span className="truncate font-mono text-[10px] uppercase tracking-[0.05em] text-granite">
              {formatWeek(row, index === rows.length - 1)}
            </span>
            <div className="h-5 rounded-sm bg-carbon" aria-label={`${row.total} meetings`}>
              <div
                className="flex h-full overflow-hidden rounded-sm"
                style={{ width: `${Math.max((row.total / max) * 100, row.total > 0 ? 3 : 0)}%` }}
              >
                {MEETING_TYPES.map((type: MeetingType) => {
                  const count = row.byType[type] ?? 0;
                  if (count === 0) return null;
                  return (
                    <span
                      key={type}
                      className="h-full"
                      style={{
                        width: `${(count / row.total) * 100}%`,
                        backgroundColor: MEETING_TYPE_META[type].color,
                      }}
                      title={`${MEETING_TYPE_META[type].fullLabel}: ${count}`}
                    />
                  );
                })}
              </div>
            </div>
            <span className="text-right font-mono text-xs tabular-nums text-bone">{row.total}</span>
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 border-t border-carbon pt-4">
        {MEETING_TYPES.map((type) => (
          <span
            key={type}
            className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.04em] text-granite"
          >
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: MEETING_TYPE_META[type].color }} />
            {MEETING_TYPE_META[type].label}
          </span>
        ))}
      </div>
    </div>
  );
}
