'use client';

import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Download,
  Printer,
  Users,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import useSWR from 'swr';

import { ApiError, humanizeApiError } from '@/api/api-error';
import { valueRecapApi, type ValueRecapTeamApi } from '@/api/value-recap.api';
import { useAuth } from '@/contexts/auth-context';
import {
  chatHelpedText,
  decisionsThroughputText,
  prevMonthYm,
  reliabilityText,
  shiftPeriodYm,
  valueRecapFromApi,
  type ValueRecapDomain,
} from '@/domain/value-recap';
import {
  AiCard,
  CardTitle,
  CHART,
  GlassCard,
  GRAD,
  MODERN_PAGE_BG,
} from '@/ui/components/dashboard/modern';

/**
 * ТЗ-2 Ф6.C / S1.5 — клиентская витрина «Что сделала Кора».
 *
 * Источник: `GET /api/v1/dashboard/operations/value-recap?period=YYYY-MM`.
 *   - Селектор месяца (prev/next), по умолчанию прошлый месяц.
 *   - Ведущая ось «Снятая рутина» — твёрдые счётчики из payload.routine.
 *   - Слой «Команда лучше» — payload.team с бейджем «оценка» (estimate=true).
 *   - narrative в AiCard.
 *   - При первом показе snapshot с payload — POST .../opened (один раз).
 *   - Экспорт: «Скачать слайды» (download JSON) + «Печать / PDF» (window.print).
 *
 * Честность: «часы×ставка→₽» и «до Коры» НЕ показываем — только payload.
 */
export function ValueRecapDashboardClient() {
  const { currentOrgId } = useAuth();
  const [period, setPeriod] = useState<string>(() => prevMonthYm());

  const swrKey =
    currentOrgId ? ['value-recap', currentOrgId, period] : null;
  const { data, error, isLoading } = useSWR(
    swrKey,
    () => valueRecapApi.get(currentOrgId!, period),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const domain: ValueRecapDomain | null = data
    ? valueRecapFromApi(data)
    : null;

  // markOpened — один раз на (orgId, snapshotId) при наличии payload.
  const openedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!currentOrgId || !domain || !domain.hasPayload) return;
    const key = `${currentOrgId}:${domain.id}`;
    if (openedRef.current.has(key)) return;
    openedRef.current.add(key);
    void valueRecapApi.markOpened(currentOrgId, domain.id).catch(() => {
      // Отметка просмотра — не критично; молча игнорируем.
      openedRef.current.delete(key);
    });
  }, [currentOrgId, domain]);

  const [exporting, setExporting] = useState(false);

  async function handleExportSlides() {
    if (!currentOrgId || !domain) return;
    setExporting(true);
    try {
      const res = await valueRecapApi.exportRecap(currentOrgId, domain.id, 'slides');
      const blob = new Blob([JSON.stringify(res, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kora-value-recap-${res.periodYm}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      const msg =
        humanizeApiError(e, 'Не удалось выгрузить слайды.');
      toast.error(msg);
    } finally {
      setExporting(false);
    }
  }

  function handlePrint() {
    if (typeof window !== 'undefined') window.print();
  }

  const friendlyError = (() => {
    if (!error) return null;
    if (error instanceof ApiError && error.code === 'forbidden') {
      return 'Нет доступа к витрине (нужна роль coo / admin / owner).';
    }
    return error instanceof Error ? error.message : 'Не удалось загрузить витрину.';
  })();

  return (
    <div style={{ background: MODERN_PAGE_BG, minHeight: '100vh' }}>
      <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-8">
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1
              className="text-2xl font-semibold tracking-tight"
              style={{ color: CHART.text }}
            >
              Что Кора сделала
            </h1>
            <p className="mt-1 text-sm" style={{ color: CHART.dim }}>
              Снятая рутина и улучшения команды за {domain?.periodLabel ?? '—'}.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <PeriodSelector
              periodLabel={domain?.periodLabel ?? period}
              onPrev={() => setPeriod((p) => shiftPeriodYm(p, -1))}
              onNext={() => setPeriod((p) => shiftPeriodYm(p, 1))}
            />
            {domain?.hasPayload && (
              <>
                <button
                  type="button"
                  onClick={() => void handleExportSlides()}
                  disabled={exporting}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                  style={{
                    background: 'oklch(1 0 0 / 0.06)',
                    border: '1px solid oklch(1 0 0 / 0.1)',
                    color: CHART.text,
                  }}
                >
                  <Download size={14} />
                  Скачать слайды
                </button>
                <button
                  type="button"
                  onClick={handlePrint}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium"
                  style={{
                    background: 'oklch(1 0 0 / 0.06)',
                    border: '1px solid oklch(1 0 0 / 0.1)',
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

        {!isLoading && !friendlyError && domain && !domain.hasPayload && (
          <GlassCard>
            <p className="text-sm" style={{ color: CHART.dim }}>
              Витрина появится после первого месяца работы.
            </p>
          </GlassCard>
        )}

        {!isLoading && !friendlyError && domain && domain.hasPayload && (
          <ValueRecapBody domain={domain} />
        )}
      </div>
    </div>
  );
}

function ValueRecapBody({ domain }: { domain: ValueRecapDomain }) {
  const showDeltas = !domain.isBaseline;
  return (
    <div className="space-y-6">
      {domain.isBaseline && (
        <GlassCard>
          <p className="text-sm" style={{ color: CHART.dim }}>
            Первый месяц — не с чем сравнивать.
          </p>
        </GlassCard>
      )}

      {/* Ведущая ось — твёрдые счётчики «снятой рутины». */}
      <GlassCard>
        <CardTitle icon={<ChevronRight size={16} />} grad={GRAD.teal}>
          Снятая рутина
        </CardTitle>
        <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {domain.routineCells.map((cell) => (
            <div
              key={cell.key}
              className="rounded-xl p-4"
              style={{ background: 'oklch(1 0 0 / 0.04)' }}
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
                    color: cell.deltaTone === 'down' ? CHART.amber : CHART.mint,
                  }}
                >
                  {cell.deltaTone === 'down' ? (
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

      {/* Второй слой — «Команда лучше» (soft, с бейджем «оценка»). */}
      {domain.team && <TeamLayer team={domain.team} />}

      {/* Человекочитаемая сводка. */}
      {domain.narrative && (
        <AiCard title="Сводка месяца" text={domain.narrative} />
      )}
    </div>
  );
}

function TeamLayer({ team }: { team: ValueRecapTeamApi }) {
  const items: { label: string; value: string }[] = [
    { label: 'Надёжность обещаний', value: reliabilityText(team) },
    { label: 'Чат помог', value: chatHelpedText(team) },
    { label: 'Решения доведены', value: decisionsThroughputText(team) },
  ];
  return (
    <GlassCard>
      <div className="flex items-center justify-between gap-3">
        <CardTitle icon={<Users size={16} />} grad={GRAD.blue}>
          Команда лучше
        </CardTitle>
        {/* team.estimate=true — это всегда «оценка», не KPI. */}
        <span
          className="rounded-full px-2.5 py-1 text-[11px] font-medium"
          style={{ color: CHART.amber, background: 'oklch(0.84 0.16 80 / 0.14)' }}
        >
          оценка
        </span>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {items.map((it) => (
          <div
            key={it.label}
            className="rounded-xl p-4"
            style={{ background: 'oklch(1 0 0 / 0.04)' }}
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

function PeriodSelector({
  periodLabel,
  onPrev,
  onNext,
}: {
  periodLabel: string;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-xl p-1"
      style={{
        background: 'oklch(1 0 0 / 0.06)',
        border: '1px solid oklch(1 0 0 / 0.1)',
      }}
    >
      <button
        type="button"
        onClick={onPrev}
        aria-label="Предыдущий месяц"
        className="grid h-7 w-7 place-items-center rounded-lg"
        style={{ color: CHART.dim }}
      >
        <ChevronLeft size={16} />
      </button>
      <span
        className="min-w-[120px] text-center text-xs font-medium"
        style={{ color: CHART.text }}
      >
        {periodLabel}
      </span>
      <button
        type="button"
        onClick={onNext}
        aria-label="Следующий месяц"
        className="grid h-7 w-7 place-items-center rounded-lg"
        style={{ color: CHART.dim }}
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
