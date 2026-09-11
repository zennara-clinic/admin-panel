/**
 * The period picker for metrics pages: This month · Last 90 days · All time,
 * plus an optional custom from–to. One look everywhere, one meaning
 * everywhere (see lib/ranges.ts).
 */
import { CalendarRange } from "lucide-react";
import { METRIC_RANGES, type MetricRange } from "./lib/ranges";

export function RangeSwitch({ value, onChange, custom, onCustom, seed }: {
  value: MetricRange;
  onChange: (range: MetricRange) => void;
  /** The custom window when one is active; null otherwise. Omit `onCustom` to hide Custom. */
  custom?: { startDate: string; endDate: string } | null;
  /** Receives the new custom window, or null when a preset takes over. */
  onCustom?: (window: { startDate: string; endDate: string } | null) => void;
  /** Dates Custom opens with (normally the period currently shown). */
  seed?: { startDate: string; endDate: string };
}) {
  const on = (r: MetricRange) => !custom && value === r;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label="Period" className="flex rounded-(--radius-btn) border border-border bg-sage p-0.5">
        {METRIC_RANGES.map((r) => (
          <button key={r} type="button" role="radio" aria-checked={on(r)}
            onClick={() => { onCustom?.(null); onChange(r); }}
            className={`whitespace-nowrap rounded-[10px] px-3 py-1.5 text-[12.5px] font-bold transition-colors ${
              on(r) ? "bg-surface text-primary shadow-[0_1px_3px_rgba(3,47,34,0.12)]" : "text-ink3 hover:text-ink"}`}>
            {r}
          </button>
        ))}
        {onCustom && (
          <button type="button" role="radio" aria-checked={!!custom} title="Pick your own dates"
            onClick={() => { const next = custom ?? seed; if (next) onCustom(next); }}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-[10px] px-3 py-1.5 text-[12.5px] font-bold transition-colors ${
              custom ? "bg-surface text-primary shadow-[0_1px_3px_rgba(3,47,34,0.12)]" : "text-ink3 hover:text-ink"}`}>
            <CalendarRange size={13} aria-hidden />Custom
          </button>
        )}
      </div>
      {custom && onCustom && (
        <div className="flex items-center gap-1.5">
          <input type="date" aria-label="From" value={custom.startDate} max={custom.endDate}
            onChange={(e) => e.target.value && onCustom({ ...custom, startDate: e.target.value })}
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-[12px] outline-none focus:border-gold-dark" />
          <span className="text-ink3">→</span>
          <input type="date" aria-label="To" value={custom.endDate} min={custom.startDate}
            onChange={(e) => e.target.value && onCustom({ ...custom, endDate: e.target.value })}
            className="rounded-lg border border-border bg-surface px-2 py-1.5 text-[12px] outline-none focus:border-gold-dark" />
        </div>
      )}
    </div>
  );
}
