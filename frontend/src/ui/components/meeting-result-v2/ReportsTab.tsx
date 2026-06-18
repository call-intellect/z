'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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
import { toast } from 'sonner';
import { ConfirmDialog } from '@/ui/components/shared/ConfirmDialog';
import { Button } from '@/ui/components/shared/Button';
import { Modal } from '@/ui/components/shared/Modal';
import { cn } from '@/ui/shadcn/lib/utils';
import {
  structuredFieldLabel,
  isEmptyStructuredValue,
  StructuredFieldValue,
} from './structured-report';
import { ReportActions } from './ReportActions';

export type ReportsTabProps = {
  meetingId: string;
};

export function ReportsTab({ meetingId }: ReportsTabProps) {
  const { reports, isLoading, mutate } = useMeetingReports(meetingId);
  const { enabled: featureEnabled, tier, loading: entLoading } =
    useEntitlement('feature.multi_reports_per_meeting');
  const { max: tierLimit } = useQuota('multi_reports_limit_per_meeting');

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (reports.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    const stillThere = selectedId && reports.some((r) => r.id === selectedId);
    if (!stillThere) {
      const fromUrl = searchParams.get('report');
      const urlValid = fromUrl && reports.some((r) => r.id === fromUrl);
      const primary = reports.find((r) => r.kind === 'primary') ?? reports[0];
      setSelectedId(urlValid ? fromUrl : primary.id);
    }
  }, [reports, selectedId, searchParams]);

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

  const selectReport = (id: string) => {
    setSelectedId(id);
    const params = new URLSearchParams(searchParams.toString());
    params.set('report', id);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-fg-primary">Отчёты</h3>
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
        <div className="rounded-md border border-chip-warning-bg bg-chip-warning-bg px-3 py-2 text-sm text-chip-warning-fg">
          На вашем тарифе ({tier}) доступен только основной отчёт.{' '}
          <Link href="/settings/billing" className="font-medium underline">
            Перейти на Pro
          </Link>
          , чтобы создавать дополнительные отчёты по любому шаблону.
        </div>
      )}

      {isLoading && reports.length === 0 ? (
        <div className="text-sm text-fg-secondary">Загружаем отчёты…</div>
      ) : reports.length === 0 ? (
        <div className="rounded-md border border-border-subtle bg-bg-subtle px-3 py-6 text-center text-sm text-fg-secondary">
          У этой встречи пока нет отчётов.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            {reports.map((r) => (
              <ReportCard
                key={r.id}
                meetingId={meetingId}
                report={r}
                onMutate={mutate}
                active={r.id === selectedId}
                onSelect={() => selectReport(r.id)}
              />
            ))}
          </div>
          <ReportInlinePanel
            meetingId={meetingId}
            reportId={selectedId}
            reports={reports}
          />
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
    </div>
  );
}

function ReportCard({
  meetingId,
  report,
  onMutate,
  active,
  onSelect,
}: {
  meetingId: string;
  report: ReportListItemDomain;
  onMutate: () => void;
  active: boolean;
  onSelect: () => void;
}) {
  const isPrimary = report.kind === 'primary';
  const isFailed = report.status === 'failed';
  const isInProgress = report.status === 'pending' || report.status === 'running';

  const [busy, setBusy] = useState(false);

  const [removeOpen, setRemoveOpen] = useState(false);

  const onRegenerate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await meetingReportsApi.regenerate(meetingId, report.id);
      onMutate();
    } catch (e) {
      console.error('regenerate failed', e);
      toast.error('Не удалось запустить регенерацию. Попробуйте позже.');
    } finally {
      setBusy(false);
    }
  };

  const onRemove = () => {
    if (isPrimary) return;
    if (busy) return;
    setRemoveOpen(true);
  };

  const performRemove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await meetingReportsApi.remove(meetingId, report.id);
      onMutate();
    } catch (e) {
      console.error('remove failed', e);
      toast.error('Не удалось удалить отчёт.');
      throw e;
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      className={cn(
        'rounded-lg border bg-bg-card p-4 shadow-sm transition-colors',
        active
          ? 'border-accent ring-1 ring-accent'
          : 'border-border-subtle hover:border-border',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="block w-full text-left"
      >
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="truncate text-sm font-semibold text-fg-primary">
                {report.templateName}
              </h4>
              {isPrimary && (
                <span
                  title="Сгенерирован автоматически по типу встречи"
                  className="inline-flex items-center rounded-full bg-chip-info-bg px-2 py-0.5 text-xs font-medium text-chip-info-fg"
                >
                  Основной
                </span>
              )}
            </div>
            <div className="mt-1 text-xs text-fg-secondary">
              {formatDate(report.createdAt)} ·{' '}
              <span
                className={
                  isFailed
                    ? 'text-danger'
                    : isInProgress
                      ? 'text-warning'
                      : 'text-fg-secondary'
                }
              >
                {reportStatusLabel(report.status)}
              </span>
            </div>
          </div>
        </header>

        {report.outputPreview && (
          <p className="mt-3 line-clamp-3 text-sm text-fg-secondary">
            {report.outputPreview}
          </p>
        )}
      </button>

      {isFailed && report.errorMessage && (
        <p className="mt-3 text-sm text-danger">
          {report.errorMessage === 'cost_limit'
            ? 'Отчёт получился слишком дорогим — генерация прервана.'
            : `Ошибка: ${report.errorMessage}`}
        </p>
      )}

      {!isPrimary && (
        <footer className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            loading={busy}
            disabled={isInProgress}
            onClick={onRegenerate}
          >
            Перегенерировать
          </Button>
          <Button
            variant="ghost"
            size="sm"
            loading={busy}
            disabled={isInProgress}
            onClick={onRemove}
          >
            Удалить
          </Button>
        </footer>
      )}

      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title="Удалить отчёт?"
        description="Это действие нельзя отменить."
        confirmLabel="Удалить"
        destructive
        onConfirm={performRemove}
      />
    </article>
  );
}

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
      <div className="mb-3 flex gap-2 border-b border-border-subtle">
        <button
          type="button"
          onClick={() => setTab('system')}
          className={
            tab === 'system'
              ? 'border-b-2 border-accent px-3 py-1.5 text-sm font-medium text-accent'
              : 'border-b-2 border-transparent px-3 py-1.5 text-sm text-fg-secondary hover:text-fg-primary'
          }
        >
          Системные
        </button>
        <button
          type="button"
          onClick={() => setTab('org')}
          className={
            tab === 'org'
              ? 'border-b-2 border-accent px-3 py-1.5 text-sm font-medium text-accent'
              : 'border-b-2 border-transparent px-3 py-1.5 text-sm text-fg-secondary hover:text-fg-primary'
          }
        >
          Мои шаблоны
        </button>
      </div>

      <div className="max-h-[400px] overflow-y-auto">
        {isLoading ? (
          <div className="py-6 text-center text-sm text-fg-secondary">
            Загружаем шаблоны…
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-6 text-center text-sm text-fg-secondary">
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
                      ? 'w-full rounded-md border-2 border-accent bg-chip-info-bg p-3 text-left'
                      : 'w-full rounded-md border border-border-subtle bg-bg-card p-3 text-left hover:border-border'
                  }
                >
                  <div className="text-sm font-semibold text-fg-primary">
                    {t.name}
                  </div>
                  {t.description && (
                    <div className="mt-1 line-clamp-2 text-xs text-fg-secondary">
                      {t.description}
                    </div>
                  )}
                  <div className="mt-2 text-xs text-fg-tertiary">
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
        <div className="mt-3 rounded-md bg-chip-danger-bg px-3 py-2 text-sm text-chip-danger-fg">
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

function ReportInlinePanel({
  meetingId,
  reportId,
  reports,
}: {
  meetingId: string;
  reportId: string | null;
  reports: ReportListItemDomain[];
}) {
  const report = reports.find((r) => r.id === reportId) ?? null;
  const isReady = report?.status === 'ready';

  const [data, setData] = useState<Awaited<
    ReturnType<typeof meetingReportsApi.detail>
  > | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!reportId || !isReady) {
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
  }, [meetingId, reportId, isReady]);

  if (!report) {
    return (
      <div className="rounded-lg border border-border-subtle bg-bg-card p-6 text-sm text-fg-secondary">
        Выберите отчёт слева, чтобы открыть его здесь.
      </div>
    );
  }

  if (!isReady) {
    return (
      <div className="rounded-lg border border-border-subtle bg-bg-card p-6 text-sm text-fg-secondary">
        {report.status === 'failed'
          ? 'Этот отчёт не удалось сформировать.'
          : 'Отчёт ещё готовится — откроется, как только будет готов.'}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border-subtle bg-bg-card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-base font-semibold text-fg-primary">
          {data?.templateName ?? report.templateName}
        </h4>
        {data && (
          <ReportActions output={data.output} title={data.templateName} />
        )}
      </div>
      {loading ? (
        <div className="py-6 text-center text-sm text-fg-secondary">
          Загружаем отчёт…
        </div>
      ) : !data ? (
        <div className="py-6 text-center text-sm text-fg-secondary">
          Не удалось загрузить отчёт.
        </div>
      ) : (
        <ReportOutputRenderer output={data.output} />
      )}
    </div>
  );
}

function ReportOutputRenderer({ output }: { output: unknown | null }) {
  if (output === null || output === undefined) {
    return <div className="text-sm text-fg-secondary">Пустой отчёт.</div>;
  }
  if (typeof output !== 'object') {
    return <p className="text-sm text-fg-secondary">{String(output)}</p>;
  }
  const entries = Object.entries(output as Record<string, unknown>).filter(
    ([, v]) => !isEmptyStructuredValue(v),
  );
  if (entries.length === 0) {
    return <div className="text-sm text-fg-secondary">Пустой отчёт.</div>;
  }
  return (
    <div className="flex flex-col gap-4">
      {entries.map(([key, value]) => (
        <section key={key}>
          <h5 className="mb-1 text-sm font-semibold text-fg-primary">
            {structuredFieldLabel(key)}
          </h5>
          <div className="text-sm text-fg-secondary">
            <StructuredFieldValue value={value} />
          </div>
        </section>
      ))}
    </div>
  );
}

function formatDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${yyyy} в ${hh}:${mi}`;
}
