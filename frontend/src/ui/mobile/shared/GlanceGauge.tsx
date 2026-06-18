import { cn } from "@/ui/shadcn/lib/utils";

function toneClass(percent: number | null): string {
  if (percent === null) return "text-fg-tertiary";
  if (percent >= 70) return "text-success";
  if (percent >= 40) return "text-warning";
  return "text-danger";
}

export function GlanceGauge({
  percent,
  label,
}: {
  percent: number | null;
  label?: string;
}) {
  const r = 40;
  const cx = 50;
  const cy = 50;
  const circumference = Math.PI * r;
  const clamped = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  const dash = (clamped / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg
        viewBox="0 0 100 56"
        className="h-12 w-24"
        role="img"
        aria-label={
          percent === null
            ? "Нет данных"
            : `Прогресс ${Math.round(clamped)} процентов`
        }
      >
        {}
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          className="text-border-subtle"
          stroke="currentColor"
          strokeWidth={8}
          strokeLinecap="round"
        />
        {}
        {percent !== null && (
          <path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            fill="none"
            className={toneClass(percent)}
            stroke="currentColor"
            strokeWidth={8}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
          />
        )}
      </svg>
      <div
        className={cn("text-lg font-semibold tabular-nums", toneClass(percent))}
      >
        {percent === null ? "нет данных" : `${Math.round(clamped)}%`}
      </div>
      {label && <div className="text-xs text-fg-tertiary">{label}</div>}
    </div>
  );
}
