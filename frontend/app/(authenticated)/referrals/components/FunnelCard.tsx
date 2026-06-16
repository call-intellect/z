"use client";

import {
  CreditCard,
  Filter,
  MousePointerClick,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";

import {
  funnelConversion,
  funnelPeriodLabel,
  type FunnelDomain,
  type FunnelPeriod,
  type FunnelRow,
} from "@/domain/referral";
import { CardTitle, GRAD, glass } from "@/ui/components/dashboard/modern";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select";

interface Props {
  funnel: FunnelDomain;
  period: FunnelPeriod;
  onPeriodChange: (p: FunnelPeriod) => void;
}

const STEP_VISUAL: Record<
  FunnelRow["key"],
  { icon: LucideIcon; grad: string }
> = {
  clicks: { icon: MousePointerClick, grad: GRAD.violet },
  signups: { icon: UserPlus, grad: GRAD.blue },
  firstPayments: { icon: CreditCard, grad: GRAD.teal },
  activeNow: { icon: Users, grad: GRAD.amber },
};

export function FunnelCard({ funnel, period, onPeriodChange }: Props) {
  const rows = funnelConversion(funnel);
  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <div style={glass()} className="p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle icon={<Filter className="h-4 w-4" />} grad={GRAD.violet}>
          Воронка партнёра
        </CardTitle>
        <Select
          value={period}
          onValueChange={(v) => onPeriodChange(v as FunnelPeriod)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={funnelPeriodLabel(period)} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="30d">{funnelPeriodLabel("30d")}</SelectItem>
            <SelectItem value="90d">{funnelPeriodLabel("90d")}</SelectItem>
            <SelectItem value="all">{funnelPeriodLabel("all")}</SelectItem>
          </SelectContent>
        </Select>
      </header>

      <p className="mt-1 text-xs text-fg-tertiary">
        От кликов по ссылке до активных клиентов сейчас.
      </p>

      <div className="mt-5 space-y-3">
        {rows.map((row, idx) => {
          const visual = STEP_VISUAL[row.key];
          const Icon = visual.icon;
          const widthPct =
            row.value > 0 ? Math.max((row.value / max) * 100, 6) : 0;

          return (
            <div key={row.key} className="flex items-center gap-3">
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
                style={{
                  background: visual.grad,
                  color: "oklch(0.99 0.005 280)",
                }}
                aria-hidden="true"
              >
                <Icon className="h-4 w-4" />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs uppercase tracking-wide text-fg-tertiary">
                    {row.label}
                  </span>
                  <span className="text-base font-semibold text-fg-primary">
                    {row.value.toLocaleString("ru-RU")}
                  </span>
                </div>

                {}
                <div
                  className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full"
                  style={{ background: "var(--surface-inset)" }}
                >
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${widthPct}%`, background: visual.grad }}
                  />
                </div>
              </div>

              <span className="w-24 shrink-0 text-right text-xs text-fg-secondary">
                {idx > 0 && row.conversionPercent !== null
                  ? `${row.conversionPercent}% от пред.`
                  : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
