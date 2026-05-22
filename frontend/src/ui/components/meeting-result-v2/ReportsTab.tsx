'use client';

/**
 * Вкладка «Отчёты» страницы результата встречи (Фаза E §8).
 *
 * Содержит:
 *   - список карточек отчётов (primary первым, бейдж «Основной»);
 *   - кнопку «+ Добавить отчёт» (disabled, если у Org нет фичи
 *     `feature.multi_reports_per_meeting`);
 *   - модалку выбора шаблона (tabs «Системные» / «Мои шаблоны») и кнопку
 *     «Сгенерировать»;
 *   - просмотр полного отчёта в drawer'е (модалка с output);
 *   - SWR-polling каждые 5 сек пока есть pending/running.
 */

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { meetingReportsApi } from '@/api/meeting-reports.api';
import {
  reportStatusLabel,
  type ReportListItemDomain,
} from '@/domain/meeting-report';
import {
  useAvailableReportTemplates,
  useMeetingReports,
} from '@/hooks/use-meeting-reports';
import { useEntitlement, useQuota } from '@/hooks/useEntitlement';
import { Button } from '@/ui/components/shared/Button';
import { Modal } from '@/ui/components/shared/Modal';

export type ReportsTabProps = {
  meetingId: string;
};

export function ReportsTab({ meetingId }: ReportsTabProps) {
  const { reports, isLoading, mutate } = useMeetingReports(meetingId);
  const { enabled: featureEnabled, tier, loading: entLoading } =
    useEntitlement('feature.multi_reports_per_meeting');
  const { max: tierLimit } = useQuota('multi_reports_limit_per_meeting');

  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const additionalCount = useMemo(
    () => reports.filter((r) => r.kind === 'additional').length,
    [reports],
  );

  const limitReached = tierLimit > 0 && additionalCount >= tierLimit;
  const addDisabled = !featureEnabled || entLoading || limitReached;

  const addTooltip = !featureEnabled
    ? 'Доступно на Pro / Business / Enterprise'
    : limitReached
      ? `На вашем тарифе доступно ${tierLimit} дополнительных отчётов на встречу`
      : '';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-900">Отчёты</h3>
        <span title={addTooltip}>
          <Button
            variant="primary"
            size="sm"
            disabled={addDisabled}
            onClick={() => setCreateOpen(true)}
          >
            + Добавить отчёт
          </Button>
        </span>
      </div>

      {!featureEnabled && !entLoading && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          На вашем тарифе ({tier}) доступен только основной отчёт.{' '}
          <Link href="/settings/billing" className="font-medium underline">
            Перейти на Pro
          </Link>
          , чтобы создавать дополнительные отчёты по любому шаблону.
        </div>
      )}

      {isLoading && reports.length === 0 ? (
        <div className="text-sm text-slate-500">Загружаем отчёты…</div>
      ) : reports.length === 0 ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
          У этой встречи пока нет отчётов.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {reports.map((r) => (
            <ReportCard
              key={r.id}
              meetingId={meetingId}
              report={r}
              onMutate={mutate}
              onOpen={() => setDetailId(r.id)}
            />
          ))}
        </div>
      )}

      <AddReportDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        meetingId={meetingId}
        onCreated={() => {
          setCreateOpen(false);
          mutate();
        }}
      />

      <ReportDetailDialog
        meetingId={meetingId}
        reportId={detailId}
        onClose={() => setDetailId(null)}
      />
    </div>
  );
}

// ──────────────────────────── Card ────────────────────────────

function ReportCard({
  meetingId,
  report,
  onMutate,
  onOpen,
}: {
  meetingId: string;
  report: ReportListItemDomain;
  onMutate: () => void;
  onOpen: () => void;
}) {
  const isPrimary = report.kind === 'primary';
  const isReady = report.status === 'ready';
  const isFailed = report.status === 'failed';
  const isInProgress = report.status === 'pending' || report.status === 'running';

  const [busy, setBusy] = useState(false);

  const onRegenerate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await meetingReportsApi.regenerate(meetingId, report.id);
      onMutate();
    } catch (e) {
      console.error('regenerate failed', e);
      alert('Не удалось запустить регенерацию. Попробуйте позже.');
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async () => {
    if (isPrimary) return;
    const ok = window.confirm(
      'Удалить отчёт? Это действие нельзя отменить.',
    );
    if (!ok) return;
    if (busy) return;
    setBusy(true);
    try {
      await meetingReportsApi.remove(meetingId, report.id);
      onMutate();
    } catch (e) {
      console.error('remove failed', e);
      alert('Не удалось удалить отчёт.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="truncate text-sm font-semibold text-slate-900">
              {report.templateName}
            </h4>
            {isPrimary && (
              <span
                title="Сгенерирован автоматически по типу встречи"
                className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700"
              >
                Основной
              </span>
            )}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {formatDate(report.createdAt)} ·{' '}
            <span
              className={
                isFailed
                  ? 'text-red-600'
                  : isInProgress
                    ? 'text-amber-600'
                    : 'text-slate-500'
              }
            >
              {reportStatusLabel(report.status)}
            </span>
          </div>
        </div>
      </header>

      {report.outputPreview && (
        <p className="mt-3 line-clamp-3 text-sm text-slate-700">
          {report.outputPreview}
        </p>
      )}
      {isFailed && report.errorMessage && (
        <p className="mt-3 text-sm text-red-600">
          {report.errorMessage === 'cost_limit'
            ? 'Отчёт получился слишком дорогим — генерация прервана.'
            : `Ошибка: ${report.errorMessage}`}
        </p>
      )}

      <footer className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={!isReady}
          onClick={onOpen}
        >
          Открыть
        </Button>
        {!isPrimary && (
          <Button
            variant="ghost"
            size="sm"
            loading={busy}
            disabled={isInProgress}
            onClick={onRegenerate}
          >
            Перегенерировать
          </Button>
        )}
        {!isPrimary && (
          <Button
            variant="ghost"
            size="sm"
            loading={busy}
            disabled={isInProgress}
            onClick={onRemove}
          >
            Удалить
          </Button>
        )}
      </footer>
    </article>
  );
}

// ──────────────────────────── Add dialog ────────────────────────────

function AddReportDialog({
  open,
  onClose,
  meetingId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  meetingId: string;
  onCreated: () => void;
}) {
  const { templates, isLoading } = useAvailableReportTemplates(
    meetingId,
    open,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'system' | 'org'>('system');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(
    () => templates.filter((t) => t.scope === tab),
    [templates, tab],
  );

  const onSubmit = async () => {
    if (!selectedId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await meetingReportsApi.create(meetingId, selectedId);
      onCreated();
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : 'Не удалось создать отчёт';
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busy) {
          setSelectedId(null);
          setError(null);
          onClose();
        }
      }}
      title="Выберите шаблон для нового отчёта"
      className="max-w-2xl"
    >
      <div className="mb-3 flex gap-2 border-b border-slate-200">
        <button
          type="button"
          onClick={() => setTab('system')}
          className={
            tab === 'system'
              ? 'border-b-2 border-blue-600 px-3 py-1.5 text-sm font-medium text-blue-700'
              : 'border-b-2 border-transparent px-3 py-1.5 text-sm text-slate-500 hover:text-slate-900'
          }
        >
          Системные
        </button>
        <button
          type="button"
          onClick={() => setTab('org')}
          className={
            tab === 'org'
              ? 'border-b-2 border-blue-600 px-3 py-1.5 text-sm font-medium text-blue-700'
              : 'border-b-2 border-transparent px-3 py-1.5 text-sm text-slate-500 hover:text-slate-900'
          }
        >
          Мои шаблоны
        </button>
      </div>

      <div className="max-h-[400px] overflow-y-auto">
        {isLoading ? (
          <div className="py-6 text-center text-sm text-slate-500">
            Загружаем шаблоны…
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-6 text-center text-sm text-slate-500">
            {tab === 'org'
              ? 'У вашей организации пока нет своих шаблонов.'
              : 'Системные шаблоны не найдены.'}
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {filtered.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className={
                    selectedId === t.id
                      ? 'w-full rounded-md border-2 border-blue-500 bg-blue-50 p-3 text-left'
                      : 'w-full rounded-md border border-slate-200 bg-white p-3 text-left hover:border-slate-300'
                  }
                >
                  <div className="text-sm font-semibold text-slate-900">
                    {t.name}
                  </div>
                  {t.description && (
                    <div className="mt-1 line-clamp-2 text-xs text-slate-500">
                      {t.description}
                    </div>
                  )}
                  <div className="mt-2 text-xs text-slate-400">
                    {t.meetingType
                      ? `для типа ${t.meetingType}`
                      : 'универсальный'}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button
          variant="ghost"
          size="md"
          onClick={onClose}
          disabled={busy}
        >
          Отмена
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={onSubmit}
          loading={busy}
          disabled={!selectedId}
        >
          Сгенерировать
        </Button>
      </div>
    </Modal>
  );
}

// ─────────────────────────── Detail dialog ───────────────────────────

function ReportDetailDialog({
  meetingId,
  reportId,
  onClose,
}: {
  meetingId: string;
  reportId: string | null;
  onClose: () => void;
}) {
  // Используем напрямую api без SWR — модалка живёт коротко.
  const [data, setData] = useState<Awaited<
    ReturnType<typeof meetingReportsApi.detail>
  > | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!reportId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    meetingReportsApi
      .detail(meetingId, reportId)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [meetingId, reportId]);

  return (
    <Modal
      open={reportId !== null}
      onClose={onClose}
      title={data?.templateName ?? 'Отчёт'}
      className="max-w-3xl"
    >
      {loading ? (
        <div className="py-6 text-center text-sm text-slate-500">
          Загружаем отчёт…
        </div>
      ) : !data ? (
        <div className="py-6 text-center text-sm text-slate-500">
          Не удалось загрузить отчёт.
        </div>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto">
          <ReportOutputRenderer output={data.output} />
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Закрыть
        </Button>
      </div>
    </Modal>
  );
}

/**
 * Динамический рендер JSON-output: верхний уровень — пары «ключ: значение».
 * Строки выводим как параграф, массивы — как список, объекты — как pre.
 * Это безопасный fallback: у разных шаблонов структура разная, и UI не
 * знает о ней заранее (ТЗ §11 «Несогласованность output-schema»).
 */
function ReportOutputRenderer({ output }: { output: unknown | null }) {
  if (output === null || output === undefined) {
    return <div className="text-sm text-slate-500">Пустой отчёт.</div>;
  }
  if (typeof output !== 'object') {
    return <p className="text-sm text-slate-700">{String(output)}</p>;
  }
  const entries = Object.entries(output as Record<string, unknown>);
  if (entries.length === 0) {
    return <div className="text-sm text-slate-500">Пустой отчёт.</div>;
  }
  return (
    <div className="flex flex-col gap-4">
      {entries.map(([key, value]) => (
        <section key={key}>
          <h5 className="mb-1 text-sm font-semibold text-slate-900">{key}</h5>
          {renderValue(value)}
        </section>
      ))}
    </div>
  );
}

function renderValue(value: unknown) {
  if (value === null || value === undefined) {
    return <p className="text-sm text-slate-400">—</p>;
  }
  if (typeof value === 'string') {
    return <p className="whitespace-pre-wrap text-sm text-slate-700">{value}</p>;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return <p className="text-sm text-slate-700">{String(value)}</p>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <p className="text-sm text-slate-400">пусто</p>;
    }
    return (
      <ul className="list-inside list-disc text-sm text-slate-700">
        {value.map((v, i) => (
          <li key={i}>
            {typeof v === 'string' || typeof v === 'number' ? (
              String(v)
            ) : (
              <pre className="overflow-x-auto text-xs">
                {JSON.stringify(v, null, 2)}
              </pre>
            )}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-xs text-slate-700">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function formatDate(d: Date): string {
  // Простая локальная дата без зависимостей: 12.05.2026 в 14:30
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yyyy} в ${hh}:${mi}`;
}
