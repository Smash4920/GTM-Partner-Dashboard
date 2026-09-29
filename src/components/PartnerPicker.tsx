import { PARTNER_TIER_META, PARTNER_TYPE_META } from '../data/constants';
import type { Partner } from '../data/types';

/**
 * Demo presentation selector standing in for a partner-scoped view. It is not
 * a security boundary: in production this view sits behind partner SSO with
 * server-enforced row access, and the picker does not exist.
 */
export default function PartnerPicker({
  partners,
  value,
  onChange,
}: {
  partners: Partner[];
  value: string;
  onChange: (partnerId: string) => void;
}) {
  const sorted = [...partners].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <label className="flex items-center gap-2">
      <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-granite">
        Viewing as
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded border border-ash bg-carbon px-3 py-1.5 text-sm text-bone focus:border-signal focus:outline-none"
      >
        {sorted.map((partner) => (
          <option key={partner.id} value={partner.id}>
            {partner.name} — {PARTNER_TIER_META[partner.tier].label}{' '}
            {PARTNER_TYPE_META[partner.type]}
          </option>
        ))}
      </select>
    </label>
  );
}
