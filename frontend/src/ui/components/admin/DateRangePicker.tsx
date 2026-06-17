"use client";

type Props = {
  from: string;
  to: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
};

export function DateRangePicker({ from, to, onFromChange, onToChange }: Props) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs text-fg-secondary">
        <span>С</span>
        <input
          type="date"
          value={from}
          onChange={(e) => onFromChange(e.target.value)}
          className="rounded-md border border-border px-2 py-1.5 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-fg-secondary">
        <span>По</span>
        <input
          type="date"
          value={to}
          onChange={(e) => onToChange(e.target.value)}
          className="rounded-md border border-border px-2 py-1.5 text-sm"
        />
      </label>
    </div>
  );
}
