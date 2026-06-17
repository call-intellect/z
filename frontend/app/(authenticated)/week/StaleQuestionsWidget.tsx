"use client";

import { Clock } from "lucide-react";
import useSWR from "swr";

import { probeControlApi } from "@/api/cora-feed.api";
import { useAuth } from "@/contexts/auth-context";
import {
  probeControlViewFromApi,
  type ProbeControlItem,
} from "@/domain/cora-feed";
import {
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
} from "@/ui/components/dashboard/modern";

const STALE_THRESHOLD_DAYS = 3;

const PROBE_WINDOW_DAYS = 30;
const PROBE_LIMIT = 60;

export function StaleQuestionsWidget() {
  const { currentOrgId, currentOrgRole } = useAuth();

  const canControl =
    currentOrgRole === "owner" ||
    currentOrgRole === "admin" ||
    currentOrgRole === "coo";

  const swrKey =
    canControl && currentOrgId
      ? (["week-stale-questions", currentOrgId] as const)
      : null;

  const { data, error, isLoading } = useSWR(
    swrKey,
    async ([, orgId]) => {
      const dto = await probeControlApi.list(orgId, {
        window: PROBE_WINDOW_DAYS,
        limit: PROBE_LIMIT,
      });
      return probeControlViewFromApi(dto);
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  if (!canControl) return null;

  const stale = (data?.items ?? [])
    .filter((q) => q.waitingDays >= STALE_THRESHOLD_DAYS)
    .sort((a, b) => b.waitingDays - a.waitingDays);

  return (
    <GlassCard>
      <CardTitle icon={<Clock size={16} />} grad={GRAD.amber}>
        Висят без ответа ≥3 дней
      </CardTitle>
      <p className="mt-1 text-sm" style={{ color: CHART.dim }}>
        Вопросы Коры, которые провисели у людей три и более дней. Мягко
        напомните или снимите вопрос, если он уже неактуален.
      </p>

      {isLoading ? (
        <p className="mt-4 text-sm" style={{ color: CHART.dim }}>
          Загрузка…
        </p>
      ) : error ? (
        <p className="mt-4 text-sm" style={{ color: CHART.red }}>
          {error instanceof Error
            ? error.message
            : "Не удалось загрузить вопросы Коры."}
        </p>
      ) : stale.length === 0 ? (
        <p className="mt-4 text-sm" style={{ color: CHART.dim }}>
          Нет вопросов, висящих ≥3 дней — команда отвечает Коре вовремя.
        </p>
      ) : (
        <StaleTable rows={stale} />
      )}
    </GlassCard>
  );
}

function StaleTable({ rows }: { rows: ProbeControlItem[] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead>
          <tr
            className="border-b border-border-subtle text-xs"
            style={{ color: CHART.faint }}
          >
            <th className="py-2 pr-3 font-medium">Вопрос</th>
            <th className="py-2 pr-3 font-medium">Кому</th>
            <th className="whitespace-nowrap py-2 pr-3 font-medium">Висит</th>
            <th className="py-2 font-medium">Статус</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((q) => (
            <tr
              key={q.notificationId}
              className="border-b border-border-subtle/50 last:border-0"
            >
              <td
                className="max-w-md py-2.5 pr-3 align-top"
                style={{ color: CHART.text }}
              >
                <span className="line-clamp-2">{q.question}</span>
              </td>
              <td
                className="py-2.5 pr-3 align-top"
                style={{ color: CHART.dim }}
              >
                {q.recipientName ?? "—"}
              </td>
              <td className="whitespace-nowrap py-2.5 pr-3 align-top">
                <span className="tabular-nums" style={{ color: CHART.amber }}>
                  {q.waitingDays} дн
                </span>
              </td>
              <td className="whitespace-nowrap py-2.5 align-top">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${STATE_CHIP[q.stateTone]}`}
                >
                  {q.stateIcon} {q.stateLabel}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATE_CHIP: Record<ProbeControlItem["stateTone"], string> = {
  info: "bg-chip-info-bg text-chip-info-fg",
  warning: "bg-chip-warning-bg text-chip-warning-fg",
  danger: "bg-chip-danger-bg text-chip-danger-fg",
};
