"use client";

import { History } from "lucide-react";

import { formatRubles } from "@/domain/billing";
import {
  payoutStatusColor,
  payoutStatusLabel,
  type ReferralPayoutDomain,
  type ReferralPayoutStatus,
} from "@/domain/referral";
import {
  GRAD,
  STATUS_TONE,
  ModernTable,
  glass,
  type ModernTableColumn,
} from "@/ui/components/dashboard/modern";

interface Props {
  payouts: ReferralPayoutDomain[];
}

export function PayoutsTable({ payouts }: Props) {
  if (payouts.length === 0) {
    return (
      <div style={glass()} className="p-6">
        <div className="flex items-center gap-2.5">
          <span
            className="grid h-8 w-8 place-items-center rounded-xl"
            style={{ background: GRAD.violet, color: "oklch(0.99 0.005 280)" }}
            aria-hidden="true"
          >
            <History className="h-4 w-4" />
          </span>
          <h3 className="text-[15px] font-semibold">История начислений</h3>
        </div>
        <p className="mt-3 text-sm" style={{ color: "var(--text-secondary)" }}>
          Начисления появятся, когда твои клиенты сделают первую оплату.
        </p>
      </div>
    );
  }

  const columns: ModernTableColumn<ReferralPayoutDomain>[] = [
    {
      header: "Период",
      cell: (p) => (
        <span className="font-mono" style={{ color: "var(--text-primary)" }}>
          {p.periodMonth}
        </span>
      ),
    },
    {
      header: "Сумма",
      cell: (p) => (
        <span className="font-medium" style={{ color: "var(--text-primary)" }}>
          {formatRubles(p.amountKopecks)}
        </span>
      ),
    },
    {
      header: "Статус",
      cell: (p) => (
        <span className="flex items-center gap-2">
          <PayoutStatusPill status={p.status} />
          {p.voidReason && (
            <span className="text-xs" style={{ color: "var(--text-tertiary)" }}>
              {p.voidReason}
            </span>
          )}
        </span>
      ),
    },
    {
      header: "Создано",
      cell: (p) => (
        <span style={{ color: "var(--text-secondary)" }}>
          {p.createdAt.toLocaleDateString("ru-RU")}
        </span>
      ),
    },
    {
      header: "Выплачено",
      cell: (p) => (
        <span style={{ color: "var(--text-secondary)" }}>
          {p.paidAt?.toLocaleDateString("ru-RU") ?? "—"}
        </span>
      ),
    },
  ];

  return (
    <ModernTable<ReferralPayoutDomain>
      title="История начислений"
      titleIcon={<History className="h-4 w-4" />}
      titleGrad={GRAD.violet}
      columns={columns}
      rows={payouts}
      getKey={(p) => p.id}
    />
  );
}

function PayoutStatusPill({ status }: { status: ReferralPayoutStatus }) {
  const tone = STATUS_TONE[toneFromColor(payoutStatusColor(status))];
  return (
    <span
      className="rounded-full px-3 py-1 text-xs font-medium"
      style={{ color: tone.c, background: tone.bg }}
    >
      {payoutStatusLabel(status)}
    </span>
  );
}

function toneFromColor(
  c: "green" | "amber" | "red",
): "ok" | "warning" | "risk" {
  if (c === "green") return "ok";
  if (c === "amber") return "warning";
  return "risk";
}
