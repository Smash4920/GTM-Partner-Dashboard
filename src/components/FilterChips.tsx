export interface ChipOption<T extends string> {
  id: T;
  label: string;
  /** Tooltip text, used to explain what a slice means. */
  title?: string;
}

interface FilterChipsProps<T extends string> {
  options: ChipOption<T>[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  size?: 'sm' | 'xs';
}

/** Mono uppercase chip row for slicing a panel or the whole view. */
export default function FilterChips<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'sm',
}: FilterChipsProps<T>) {
  const padding = size === 'xs' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]';
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          title={option.title}
          aria-pressed={value === option.id}
          className={`rounded border font-mono uppercase tracking-[0.06em] transition-colors duration-150 ${padding} ${
            value === option.id
              ? 'border-ash bg-carbon text-bone'
              : 'border-transparent text-granite hover:text-stone'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
