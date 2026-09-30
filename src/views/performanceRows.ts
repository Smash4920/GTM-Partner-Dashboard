import type { MetricBarRow } from '../components/MetricBars';
import { LOST_COLOR, STAGE_META, WON_COLOR } from '../data/constants';
import type { StageBreakdown } from '../data/DataProvider';
import { formatUsdCompact } from '../lib/format';

/**
 * Stage bars shared by Home and Partner Performance: the open stages of the
 * scoped breakdown, then the closed won/lost outcomes for the same scope
 * underneath them.
 */
export function stageRows(breakdown: StageBreakdown, outcomeScope: string): MetricBarRow[] {
  return [
    ...breakdown.stages.map((row) => ({
      label: STAGE_META[row.stage].label,
      value: row.value,
      displayValue: formatUsdCompact(row.value),
      secondary: `${row.count} open`,
      color: STAGE_META[row.stage].color,
    })),
    {
      label: `Won (${outcomeScope})`,
      value: breakdown.outcomes.wonValue,
      displayValue: formatUsdCompact(breakdown.outcomes.wonValue),
      secondary: `${breakdown.outcomes.wonCount} won`,
      color: WON_COLOR,
    },
    {
      label: `Lost (${outcomeScope})`,
      value: breakdown.outcomes.lostValue,
      displayValue: formatUsdCompact(breakdown.outcomes.lostValue),
      secondary: `${breakdown.outcomes.lostCount} lost`,
      color: LOST_COLOR,
      dimmed: true,
    },
  ];
}
