import { cn } from "@/ui/shadcn/lib/utils";

export type StatusTone = "ok" | "warn" | "danger" | "neutral";

const TONE_DOT: Record<StatusTone, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  danger: "bg-danger",
  neutral: "bg-fg-tertiary",
};

const TONE_LABEL: Record<StatusTone, string> = {
  ok: "в норме",
  warn: "требует внимания",
  danger: "тревога",
  neutral: "нет данных",
};

export function StatusDot({
  tone,
  className,
}: {
  tone: StatusTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
        TONE_DOT[tone],
        className,
      )}
      role="img"
      aria-label={TONE_LABEL[tone]}
    />
  );
}
