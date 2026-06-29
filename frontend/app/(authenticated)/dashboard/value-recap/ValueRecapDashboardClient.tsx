"use client";

import {
  ArrowDownRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Download,
  ListChecks,
  Printer,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";

import { ApiError, humanizeApiError } from "@/api/api-error";
import { valueRecapApi, type ValueRecapTeamApi } from "@/api/value-recap.api";
import { useAuth } from "@/contexts/auth-context";
import { currentPeriod } from "@/domain/period";
import {
  chatHelpedText,
  decisionsThroughputText,
  formatPeriodYm,
  reliabilityText,
  valueRecapFromApi,
  type ValueRecapDecision,
  type ValueRecapDomain,
} from "@/domain/value-recap";
import {
  AiCard,
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
  MODERN_PAGE_BG,
  STATUS_TONE,
} from "@/ui/components/dashboard/modern";
import { PeriodNavigator } from "@/ui/components/dashboard/shared/PeriodNavigator";

export function ValueRecapDashboardClient({
  embedded = false,
}: {
  embedded?: boolean;
} = {}) {
  const { currentOrgId } = useAuth();
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);

  const swrKey = currentOrgId
    ? ["value-recap", currentOrgId, selectedPeriod ?? "__latest__"]
    : null;
  const { data, error, isLoading } = useSWR(
    swrKey,
    () => valueRecapApi.get(currentOrgId!, selectedPeriod ?? undefined),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const domain: ValueRecapDomain | null = data ? valueRecapFromApi(data) : null;

  const effectivePeriod = selectedPeriod ?? domain?.periodYm ?? "";
  const periodLabel = effectivePeriod ? formatPeriodYm(effectivePeriod) : "—";

  const openedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!currentOrgId || !domain || !domain.hasPayload) return;
    const key = `${currentOrgId}:${domain.id}`;
    if (openedRef.current.has(key)) return;
    openedRef.current.add(key);
    void valueRecapApi.markOpened(currentOrgId, domain.id).catch(() => {
      openedRef.current.delete(key);
    });
  }, [currentOrgId, domain]);

  const [exporting, setExporting] = useState(false);

  async function handleExportSlides() {
    if (!currentOrgId || !domain) return;
    setExporting(true);
    try {
      const { blob, filename } = await valueRecapApi.exportRecapPptx(
        currentOrgId,
        domain.id,
        domain.periodYm,
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      const msg = humanizeApiError(e, "Не удалось выгрузить слайды.");
      toast.error(msg);
    } finally {
      setExporting(false);
    }
  }

  function handlePrint() {
    if (typeof window !== "undefined") window.print();
  }

  const friendlyError = (() => {
    if (!error) return null;
    if (error instanceof ApiError && error.code === "forbidden") {
      return "Нет доступа к витрине (нужна роль coo / admin / owner).";
    }
    return error instanceof Error
      ? error.message
      : "Не удалось загрузить витрину.";
  })();

  const content = (
    <>
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            {!embedded && (
              <h1
                className="text-2xl font-semibold tracking-tight"
                style={{ color: CHART.text }}
              >
                Итоги месяца
              </h1>
            )}
            <p className="mt-1 text-sm" style={{ color: CHART.dim }}>
              Снятая рутина, дисциплина решений и улучшения команды за{" "}
              {periodLabel}.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <PeriodNavigator
              rhythm="month"
              value={effectivePeriod || currentPeriod("month")}
              latest={currentPeriod("month")}
              onChange={(p) => setSelectedPeriod(p)}
            />
            {domain?.hasPayload && (
              <>
                <button
                  type="button"
                  onClick={() => void handleExportSlides()}
                  disabled={exporting}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                  style={{
                    background: "var(--surface-inset)",
                    border: "1px solid var(--border-inset)",
                    color: CHART.text,
                  }}
                >
                  <Download size={14} />
                  {exporting ? "Готовим…" : "Скачать слайды"}
                </button>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium"
                  style={{
                    background: "var(--surface-inset)",
                    border: "1px solid var(--border-inset)",
                    color: CHART.text,
                  }}
                >
                  <Printer size={14} />
                  Печать / PDF
                </button>
              </>
            )}
          </div>
        </header>

        {isLoading && (
          <p className="text-sm" style={{ color: CHART.dim }}>
            Загрузка витрины…
          </p>
        )}

        {friendlyError && (
          <GlassCard>
            <p className="text-sm" style={{ color: CHART.red }}>
              {friendlyError}
            </p>
          </GlassCard>
        )}

        {}
        {!isLoading && !friendlyError && domain && !domain.hasPayload && (
          <EmptyMonthFootnote
            periodLabel={periodLabel}
            builtAt={domain.builtAt}
          />
        )}

        {!isLoading && !friendlyError && domain && domain.hasPayload && (
          <ValueRecapBody domain={domain} />
        )}
    </>
  );

  if (embedded) return content;

  return (
    <div style={{ background: MODERN_PAGE_BG, minHeight: "100vh" }}>
      <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-8">
        {content}
      </div>
    </div>
  );
}

function ValueRecapBody({ domain }: { domain: ValueRecapDomain }) {
  const showDeltas = !domain.isBaseline;
  return (
    <div className="space-y-6">
      {}
      <VerdictBar domain={domain} />

      {}
      {domain.narrative && (
        <AiCard title="Сводка месяца от Коры" text={domain.narrative} />
      )}

      {domain.isBaseline && (
        <GlassCard>
          <p className="text-sm" style={{ color: CHART.dim }}>
            Первый месяц — не с чем сравнивать.
          </p>
        </GlassCard>
      )}

      {}
      <GlassCard>
        <CardTitle icon={<ChevronRight size={16} />} grad={GRAD.teal}>
          Снятая рутина — что Кора сделала за вас
        </CardTitle>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {domain.routineCells.map((cell) => (
            <div
              key={cell.key}
              className="rounded-xl p-4"
              style={{ background: "var(--surface-inset)" }}
            >
              <div
                className="text-[28px] font-semibold leading-none tracking-tight"
                style={{ color: CHART.text }}
              >
                {cell.value}
              </div>
              <div className="mt-1.5 text-xs" style={{ color: CHART.dim }}>
                {cell.label}
              </div>
              {showDeltas && cell.deltaText && (
                <div
                  className="mt-1 inline-flex items-center gap-1 text-[11px]"
                  style={{
                    color: cell.deltaTone === "down" ? CHART.amber : CHART.mint,
                  }}
                >
                  {cell.deltaTone === "down" ? (
                    <ArrowDownRight size={11} />
                  ) : (
                    <ArrowUpRight size={11} />
                  )}
                  {cell.deltaText}
                </div>
              )}
            </div>
          ))}
        </div>
      </GlassCard>

      {}
      {domain.team && <TeamLayer team={domain.team} />}

      {}
      <DecisionsBlock domain={domain} />
    </div>
  );
}

function VerdictBar({ domain }: { domain: ValueRecapDomain }) {
  const builtAtText = domain.builtAt
    ? domain.builtAt.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
      })
    : null;
  return (
    <GlassCard>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{
              background: CHART.mint,
              boxShadow: "0 0 12px oklch(0.85 0.15 165 / 0.8)",
            }}
          />
          <div>
            <div
              className="text-sm font-semibold"
              style={{ color: CHART.text }}
            >
              {domain.periodLabel} — последний завершённый месяц с данными.
            </div>
            {builtAtText && (
              <div className="mt-0.5 text-xs" style={{ color: CHART.faint }}>
                Отчёт сформирован Корой автоматически {builtAtText}
              </div>
            )}
          </div>
        </div>
        <span
          className="inline-flex items-center gap-1.5 self-start rounded-full px-2.5 py-1 text-[11px] font-medium sm:self-auto"
          style={{
            color: CHART.blue,
            background: "oklch(0.7 0.16 245 / 0.14)",
          }}
        >
          готов к показу совету
        </span>
      </div>
    </GlassCard>
  );
}

function TeamLayer({ team }: { team: ValueRecapTeamApi }) {
  const items: { label: string; value: string }[] = [
    { label: "Надёжность обещаний", value: reliabilityText(team) },
    { label: "Чат помог", value: chatHelpedText(team) },
    { label: "Решения доведены", value: decisionsThroughputText(team) },
  ];
  return (
    <GlassCard>
      <div className="flex items-center justify-between gap-3">
        <CardTitle icon={<Users size={16} />} grad={GRAD.blue}>
          Команда лучше
        </CardTitle>
        {}
        <span
          className="rounded-full px-2.5 py-1 text-[11px] font-medium"
          style={{
            color: CHART.amber,
            background: "oklch(0.84 0.16 80 / 0.14)",
          }}
        >
          оценка Коры, не точная метрика
        </span>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {items.map((it) => (
          <div
            key={it.label}
            className="rounded-xl p-4"
            style={{ background: "var(--surface-inset)" }}
          >
            <div className="text-xs" style={{ color: CHART.dim }}>
              {it.label}
            </div>
            <div
              className="mt-1 text-base font-semibold"
              style={{ color: CHART.text }}
            >
              {it.value}
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

function DecisionsBlock({ domain }: { domain: ValueRecapDomain }) {
  const { decisions, decisionBreakdown: bd, team } = domain;
  const total = team?.decisionsTotal ?? decisions.length;
  const throughputPercent = team
    ? Math.round(team.decisionsThroughputPercent)
    : 0;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
      {}
      <GlassCard>
        <CardTitle icon={<ListChecks size={16} />} grad={GRAD.blue}>
          Решения месяца
        </CardTitle>
        {decisions.length === 0 ? (
          <p className="mt-4 text-sm" style={{ color: CHART.dim }}>
            — За месяц решений не зафиксировано.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr
                  style={{ color: CHART.faint }}
                  className="text-left text-xs"
                >
                  <th className="pb-3 font-medium">Решение</th>
                  <th className="pb-3 font-medium">Статус</th>
                  <th className="pb-3 text-right font-medium">Доведено</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((d) => (
                  <tr
                    key={d.id}
                    style={{ borderTop: "1px solid var(--border-inset)" }}
                  >
                    <td className="py-3 pr-3" style={{ color: CHART.text }}>
                      {d.statement}
                    </td>
                    <td className="py-3 pr-3">
                      <DecisionStatusChip decision={d} />
                    </td>
                    <td className="py-3">
                      <DecisionProgress decision={d} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {}
      <GlassCard
        glow
        className="flex flex-col items-center justify-center text-center"
        style={{
          background:
            "linear-gradient(180deg, var(--chip-success-bg), transparent), var(--glass-surface)",
          borderColor: "var(--chip-success-fg)",
        }}
      >
        <div className="text-xs" style={{ color: CHART.faint }}>
          Главный итог дисциплины
        </div>
        {decisions.length === 0 && total === 0 ? (
          <div className="mt-3 text-sm" style={{ color: CHART.dim }}>
            — Решений за месяц нет
          </div>
        ) : (
          <>
            <div
              className="mt-2 text-[56px] font-semibold leading-none"
              style={{ color: CHART.teal }}
            >
              {bd.done}
            </div>
            <div className="mt-2 text-sm" style={{ color: CHART.dim }}>
              из {total} решений доведено до внедрения
            </div>
            <div className="mt-1 text-xs" style={{ color: CHART.faint }}>
              {throughputPercent}% доведения
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <BreakdownChip tone="ok" count={bd.done} label="внедрено" />
              <BreakdownChip
                tone="info"
                count={bd.inProgress}
                label="в работе"
              />
              <BreakdownChip
                tone="warning"
                count={bd.stalled + bd.notStarted}
                label="застряло"
              />
            </div>
          </>
        )}
      </GlassCard>
    </div>
  );
}

function decisionToneStyle(tone: "ok" | "info" | "warning"): {
  c: string;
  bg: string;
} {
  if (tone === "ok") return STATUS_TONE.ok;
  if (tone === "warning") return STATUS_TONE.warning;
  return { c: CHART.blue, bg: "oklch(0.7 0.16 245 / 0.14)" };
}

function DecisionStatusChip({ decision }: { decision: ValueRecapDecision }) {
  const tone = decisionToneStyle(decision.statusTone);
  const Icon =
    decision.statusTone === "ok"
      ? CheckCircle2
      : decision.statusTone === "info"
        ? Clock3
        : ArrowDownRight;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
      style={{ color: tone.c, background: tone.bg }}
    >
      <Icon size={12} />
      {decision.statusLabel}
    </span>
  );
}

function DecisionProgress({ decision }: { decision: ValueRecapDecision }) {
  const fill =
    decision.progressTone === "teal"
      ? GRAD.teal
      : decision.progressTone === "warn"
        ? CHART.amber
        : CHART.red;
  return (
    <div className="flex items-center justify-end gap-2.5">
      <div
        className="h-1.5 w-24 overflow-hidden rounded-full"
        style={{ background: "var(--surface-inset-strong)" }}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${decision.throughputPercent}%`, background: fill }}
        />
      </div>
      <span
        className="min-w-[34px] text-right text-xs"
        style={{ color: CHART.dim }}
      >
        {decision.throughputPercent}%
      </span>
    </div>
  );
}

function BreakdownChip({
  tone,
  count,
  label,
}: {
  tone: "ok" | "info" | "warning";
  count: number;
  label: string;
}) {
  const t = decisionToneStyle(tone);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
      style={{ color: t.c, background: t.bg }}
    >
      {count} {label}
    </span>
  );
}

function EmptyMonthFootnote({
  periodLabel,
  builtAt,
}: {
  periodLabel: string;
  builtAt: Date | null;
}) {
  const startedText = builtAt
    ? builtAt.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })
    : null;
  return (
    <GlassCard style={{ borderColor: "oklch(0.7 0.16 245 / 0.2)" }}>
      <CardTitle icon={<Clock3 size={16} />} grad={GRAD.blue}>
        Месяц ещё собирается
      </CardTitle>
      <p className="mt-3 text-sm" style={{ color: CHART.dim }}>
        {startedText
          ? `Кора начала собирать данные ${startedText}. `
          : "Кора ещё собирает данные за этот период. "}
        Первый полный отчёт за {periodLabel} появится, когда месяц завершится.
      </p>
      <p className="mt-2 text-xs" style={{ color: CHART.faint }}>
        Переключитесь стрелками на последний завершённый месяц, чтобы увидеть
        готовый отчёт.
      </p>
    </GlassCard>
  );
}

