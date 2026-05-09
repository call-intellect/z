'use client';

type Props = {
  from: string;
  to: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
};

/**
 * Простой date-range picker. Только нативные `<input type="date">`.
 * Хранит даты в формате `YYYY-MM-DD` (локальное время).
 */
export function DateRangePicker({ from, to, onFromChange, onToChange }: Props) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        <span>С</span>
        <input
          type="date"
          value={from}
          onChange={(e) => onFromChange(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        <span>По</span>
        <input
          type="date"
          value={to}
          onChange={(e) => onToChange(e.target.value)}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
      </label>
    </div>
  );
}
