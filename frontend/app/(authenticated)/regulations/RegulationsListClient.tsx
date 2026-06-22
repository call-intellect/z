'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import useSWR from 'swr';
import { toast } from 'sonner';
import {
  ArchiveRestore,
  CheckCircle2,
  ChevronDown,
  History,
  Quote,
  Replace,
  Search,
  Trash2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';

import { ApiError, humanizeApiError } from '@/api/api-error';
import {
  regulationsApi,
  type RegulationKindApi,
  type RegulationStatusApi,
  type RegulationsListResponseApi,
  type RegulationHistoryResponseApi,
} from '@/api/regulations.api';
import { useAuth } from '@/contexts/auth-context';
import {
  EXTRACTION_STATUS_LABEL,
  POLICY_SEVERITY_LABEL,
  REGULATION_CHANGE_SOURCE_LABEL,
  REGULATION_KIND_LABEL,
  REGULATION_STATUS_LABEL,
  hasNeedsAttention,
  isDraftExtraction,
  mapRegulationSources,
  mapVersionItem,
  type ExtractionStatus,
  type PolicySeverity,
  type RegulationDetail,
  type RegulationNeedsAttention,
  type RegulationStatus,
  mapRegulationDetail,
} from '@/domain/regulation';
import { ProcessTemplatesClient } from '@app/(authenticated)/processes/ProcessTemplatesClient';
import { Chip } from '@/ui/components/shared/Chip';
import { TrustBadge } from '@/ui/components/shared/TrustBadge';
import { ProvenancePreviewSnippet } from '@/ui/components/provenance/ProvenancePreviewSnippet';
import { mapPreviewToProvenanceRef } from '@/domain/provenance';
import { ConfirmDialog } from '@/ui/components/shared/ConfirmDialog';
import { useConfirmDialog } from '@/ui/components/shared/useConfirmDialog';
import { EmptyState } from '@/ui/components/shared/EmptyState';
import {
  CardCorrectionActions,
  type CorrectionField,
} from '@/ui/components/knowledge/CardCorrectionActions';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { cn } from '@/ui/shadcn/lib/utils';
import { glass, MODERN_PAGE_BG } from '@/ui/components/dashboard/modern';

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '@app/(admin)/admin/AdminStateViews';

/**
 * Master-detail для `/regulations` (SBA α-7, ТЗ 2026-05-26 §1).
 *
 * Левая колонка — список с фильтрами kind / status / search.
 * Правая колонка — детальная карточка: контент, шаги (для process),
 * severity (для policy), действия supersede/confirm, история версий.
 *
 * Действия supersede / confirm выполняются с проверкой RBAC на бэке —
 * если у пользователя нет прав, появится тост-ошибка.
 */
export function RegulationsListClient() {
  const { currentOrgId, isLoading: authLoading } = useAuth();
  if (authLoading) return <AdminLoading rows={4} />;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Вы не состоите ни в одной организации."
      />
    );
  }
  return <RegulationsListContent />;
}

const KIND_FILTERS: ReadonlyArray<{
  value: 'all' | RegulationKindApi;
  label: string;
}> = [
  { value: 'all', label: 'Все виды' },
  { value: 'regulation', label: 'Регламенты' },
  { value: 'process', label: 'Процессы' },
  { value: 'instruction', label: 'Инструкции' },
  { value: 'policy', label: 'Политики' },
];

/** Допустимые значения `?kind=` в URL (редирект `/policies` и т.п.). */
const KIND_FILTER_VALUES = new Set(KIND_FILTERS.map((f) => f.value));

type TopTab = 'regulations' | 'process-templates';

const TOP_TABS: ReadonlyArray<{ key: TopTab; label: string }> = [
  { key: 'regulations', label: 'Регламенты' },
  { key: 'process-templates', label: 'Шаблоны процессов' },
];

const STATUS_FILTERS: ReadonlyArray<{
  value: 'all' | RegulationStatusApi;
  label: string;
}> = [
  { value: 'all', label: 'Все статусы' },
  { value: 'active', label: 'Действующие' },
  { value: 'deprecated', label: 'Устаревшие' },
  { value: 'archived', label: 'В архиве' },
];

const STATUS_CHIP: Record<RegulationStatus, 'success' | 'warning' | 'sand'> = {
  active: 'success',
  deprecated: 'warning',
  archived: 'sand',
};

const SEVERITY_CHIP: Record<PolicySeverity, 'danger' | 'warning' | 'info'> = {
  blocking: 'danger',
  mandatory: 'warning',
  advisory: 'info',
};

/** Чип статуса извлечения (B2.2): exists=success, needed=warning, discussed=info. */
const EXTRACTION_CHIP: Record<
  ExtractionStatus,
  'success' | 'warning' | 'info'
> = {
  exists: 'success',
  needed: 'warning',
  discussed: 'info',
};

/**
 * Маркеры в тексте (B2.4). Литералы превращаются в цветные чипы:
 *   [требует уточнения] → warning, [конфликт] → danger, [изменено] → info.
 */
const CONTENT_MARKERS: ReadonlyArray<{
  literal: string;
  variant: 'warning' | 'danger' | 'info';
}> = [
  { literal: 'требует уточнения', variant: 'warning' },
  { literal: 'конфликт', variant: 'danger' },
  { literal: 'изменено', variant: 'info' },
];

/**
 * Оглавление тела регламента (Ф5b): вытаскивает заголовки `## …` из markdown.
 * id синхронизированы с теми, что `ContentMarkdown` проставляет на `<h2>`
 * (`kb-h-0`, `kb-h-1`, …) — клик по пункту скроллит к соответствующему h2.
 */
function extractToc(md: string): { id: string; text: string }[] {
  const out: { id: string; text: string }[] = [];
  const re = /^##\s+(.+)$/gm;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(md)) !== null) {
    const text = m[1].trim();
    out.push({ id: `kb-h-${i}`, text });
    i++;
  }
  return out;
}

function RegulationsListContent() {
  const { currentOrgRole } = useAuth();
  const canApplyDirectly = ['owner', 'admin'].includes(currentOrgRole ?? '');
  const canWrite = canApplyDirectly;
  const { ask, dialog: confirmDialog } = useConfirmDialog();
  const searchParams = useSearchParams();
  // `?kind=policy` (редирект с `/policies`) приземляется на нужный фильтр.
  const initialKind = useMemo<'all' | RegulationKindApi>(() => {
    const raw = searchParams.get('kind');
    return raw && KIND_FILTER_VALUES.has(raw as 'all' | RegulationKindApi)
      ? (raw as 'all' | RegulationKindApi)
      : 'all';
  }, [searchParams]);
  const [topTab, setTopTab] = useState<TopTab>('regulations');
  const [data, setData] = useState<RegulationsListResponseApi | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [kindFilter, setKindFilter] =
    useState<'all' | RegulationKindApi>(initialKind);
  const [statusFilter, setStatusFilter] =
    useState<'all' | RegulationStatusApi>('all');
  const [deletedFilter, setDeletedFilter] = useState(false);
  const [selected, setSelected] = useState<{
    id: string;
    kind: RegulationKindApi;
  } | null>(null);
  const [detail, setDetail] = useState<RegulationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<RegulationHistoryResponseApi | null>(
    null,
  );
  const [historyLoading, setHistoryLoading] = useState(false);
  const [supersedeOpen, setSupersedeOpen] = useState(false);
  const [supersedeTargetId, setSupersedeTargetId] = useState('');
  // C3: provenance-аккордеон раскрывается лениво по клику.
  const [sourcesOpen, setSourcesOpen] = useState(false);
  // Ф5b: ширина читаемой колонки в новой раскладке ('read' — узкая с TOC,
  // 'wide' — широкая без правой колонки).
  const [widthMode, setWidthMode] = useState<'read' | 'wide'>('read');

  // Debounce поиска (300 мс).
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const dto = await regulationsApi.list({
        ...(qDebounced ? { q: qDebounced } : {}),
        ...(kindFilter !== 'all' ? { kind: kindFilter } : {}),
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(deletedFilter ? { deleted: true } : {}),
        limit: 50,
      });
      setData(dto);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'forbidden') {
        setForbidden(true);
      } else {
        setError(humanizeApiError(e, 'Ошибка загрузки'));
      }
    } finally {
      setIsLoading(false);
    }
  }, [qDebounced, kindFilter, statusFilter, deletedFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDetail = useCallback(async () => {
    if (!selected) return;
    setDetailLoading(true);
    setDetailError(null);
    setHistory(null);
    setHistoryOpen(false);
    setSourcesOpen(false);
    try {
      const dto = await regulationsApi.get(selected.id, selected.kind);
      setDetail(mapRegulationDetail(dto));
    } catch (e) {
      setDetailError(humanizeApiError(e, 'Ошибка загрузки'));
    } finally {
      setDetailLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    if (selected) void loadDetail();
    else setDetail(null);
  }, [selected, loadDetail]);

  const handleConfirm = useCallback(async () => {
    if (!selected) return;
    try {
      await regulationsApi.confirm(selected.id, { kind: selected.kind });
      toast.success('Актуальность подтверждена');
      await loadDetail();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'forbidden') {
        toast.error('Изменять регламенты могут только owner / admin');
      } else {
        toast.error(
          humanizeApiError(e, 'Не удалось подтвердить'),
        );
      }
    }
  }, [selected, loadDetail]);

  const handleSupersede = useCallback(async () => {
    if (!selected) return;
    const targetId = supersedeTargetId.trim();
    if (!targetId) {
      toast.error('Укажите идентификатор новой версии');
      return;
    }
    try {
      await regulationsApi.supersede(selected.id, {
        kind: selected.kind,
        supersededByRegulationId: targetId,
      });
      toast.success('Запись заменена новой версией');
      setSupersedeTargetId('');
      await loadDetail();
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'forbidden') {
        toast.error('Изменять регламенты могут только owner / admin');
      } else {
        toast.error(
          humanizeApiError(e, 'Не удалось заменить запись'),
        );
      }
      throw e;
    }
  }, [selected, supersedeTargetId, loadDetail, load]);

  const handleDelete = useCallback(async () => {
    if (!selected) return;
    const ok = await ask({
      title: 'Удалить регламент?',
      description: 'Восстановить можно в течение 30 дней.',
      confirmLabel: 'Удалить',
      destructive: true,
    });
    if (!ok) return;
    try {
      await regulationsApi.remove(selected.id, { kind: selected.kind });
      toast.success('Регламент удалён');
      setSelected(null);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'forbidden') {
        toast.error('Удалять регламенты могут только owner / admin');
      } else {
        toast.error(humanizeApiError(e, 'Не удалось удалить'));
      }
    }
  }, [selected, ask, load]);

  const handleRestore = useCallback(async () => {
    if (!selected) return;
    try {
      await regulationsApi.restore(selected.id, { kind: selected.kind });
      toast.success('Регламент восстановлен');
      setSelected(null);
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'forbidden') {
        toast.error('Восстанавливать регламенты могут только owner / admin');
      } else {
        toast.error(humanizeApiError(e, 'Не удалось восстановить'));
      }
    }
  }, [selected, load]);

  const toggleHistory = useCallback(async () => {
    if (!selected) return;
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    setHistoryOpen(true);
    if (history) return;
    setHistoryLoading(true);
    try {
      const dto = await regulationsApi.history(selected.id, selected.kind);
      setHistory(dto);
    } catch (e) {
      toast.error(
        humanizeApiError(e, 'Не удалось загрузить историю'),
      );
    } finally {
      setHistoryLoading(false);
    }
  }, [selected, history, historyOpen]);

  const groupedItems = useMemo(() => data?.items ?? [], [data]);

  // Чипы-счётчики (C4): summary живёт отдельно от фильтрованного списка.
  const summarySwr = useSWR(
    'regulations-summary',
    () => regulationsApi.getSummary(),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const summary = summarySwr.data ?? null;

  // «Недавно оцифровано» (C4): топ-8 из уже загруженного списка по updatedAt.
  const recentItems = useMemo(() => {
    return [...groupedItems]
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      )
      .slice(0, 8);
  }, [groupedItems]);

  // Ф5b: оглавление тела открытой записи для правой TOC-колонки.
  const toc = useMemo(
    () => extractToc(detail?.contentMd ?? ''),
    [detail?.contentMd],
  );

  if (isLoading && !data) return <AdminLoading rows={6} />;
  if (forbidden) return <AdminForbidden />;
  if (error) return <AdminError message={error} onRetry={load} />;
  if (!data) return null;

  // Ф5b: общее число записей. В summary нет агрегата — складываем по видам;
  // пока summary грузится, опираемся на total текущего (нефильтрованного) списка.
  const summaryTotal = summary
    ? summary.regulations +
      summary.processTemplates +
      summary.instructions +
      summary.policies
    : data.total;

  // ── Переиспользуемые фрагменты JSX (общие для старой и новой раскладок) ──

  // Блок списка записей (без внешней обёртки-колонки).
  const listBlock =
    groupedItems.length === 0 ? (
      <EmptyState
        title="Регламентов пока нет"
        description="Кора автоматически создаёт регламенты, процессы и политики из ваших встреч. Накопятся первые обсуждения — они появятся здесь."
      />
    ) : (
      <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-bg-card">
        {groupedItems.map((r) => {
          const isSelected =
            selected?.id === r.id && selected.kind === r.kind;
          const stepsCount =
            r.kind === 'process' && 'steps' in r ? null : null;
          void stepsCount;
          return (
            <li key={`${r.kind}:${r.id}`}>
              <button
                type="button"
                onClick={() => setSelected({ id: r.id, kind: r.kind })}
                className={cn(
                  'flex w-full flex-col gap-1 px-4 py-3 text-left transition',
                  isSelected ? 'bg-accent/5' : 'hover:bg-bg-overlay/40',
                )}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <Chip variant="info" size="sm">
                    {REGULATION_KIND_LABEL[r.kind]}
                  </Chip>
                  <LifecycleChip
                    status={r.status}
                    extractionStatus={r.extractionStatus ?? null}
                  />
                  {r.kind === 'policy' && r.severity ? (
                    <Chip variant={SEVERITY_CHIP[r.severity]} size="sm">
                      {POLICY_SEVERITY_LABEL[r.severity]}
                    </Chip>
                  ) : null}
                  <TrustBadge tier={r.trustTier} size="sm" />
                </div>
                {r.extractionStatus ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-fg-tertiary">
                      Извлечение:
                    </span>
                    <Chip
                      variant={EXTRACTION_CHIP[r.extractionStatus]}
                      size="sm"
                    >
                      {EXTRACTION_STATUS_LABEL[r.extractionStatus]}
                    </Chip>
                  </div>
                ) : null}
                <div className="truncate text-sm font-medium text-fg-primary">
                  {r.name}
                </div>
                {r.statement ? (
                  <div className="line-clamp-2 text-xs text-fg-tertiary">
                    {r.statement}
                  </div>
                ) : null}
                <div className="text-xs text-fg-tertiary">
                  {r.scope ? `Область: ${r.scope} · ` : ''}
                  Обновлено{' '}
                  {new Date(r.updatedAt).toLocaleDateString('ru-RU')}
                </div>
              </button>
              <ProvenancePreviewSnippet
                preview={mapPreviewToProvenanceRef(
                  r.previewQuote,
                  r.previewSourceRef,
                )}
                className="mt-1 px-4 pb-3"
              />
            </li>
          );
        })}
      </ul>
    );

  // Фильтры: поиск + статус (над списком).
  const filtersBlock = (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative max-w-md flex-1">
        <Search
          className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-tertiary"
          aria-hidden
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск по названию или содержанию"
          className="pl-8"
        />
      </div>
      <select
        value={statusFilter}
        onChange={(e) =>
          setStatusFilter(e.target.value as 'all' | RegulationStatusApi)
        }
        className="rounded-md border border-border-subtle bg-bg-card px-3 py-2 text-sm"
      >
        {STATUS_FILTERS.map((f) => (
          <option key={f.value} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
      {canWrite ? (
        <Button
          type="button"
          variant={deletedFilter ? 'default' : 'outline'}
          size="sm"
          onClick={() => {
            setSelected(null);
            setDeletedFilter((v) => !v);
          }}
        >
          {deletedFilter ? 'Показаны удалённые' : 'Удалённые'}
        </Button>
      ) : null}
    </div>
  );

  // Блок детали записи (вся условная цепочка состояний).
  const detailBlock = !selected ? (
    <p className="text-sm text-fg-tertiary">
      Выберите запись слева, чтобы увидеть подробности и историю версий.
    </p>
  ) : detailLoading ? (
    <AdminLoading rows={3} />
  ) : detailError ? (
    <AdminError message={detailError} onRetry={loadDetail} />
  ) : !detail ? null : (
    <article className="space-y-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Chip variant="info" size="sm">
            {REGULATION_KIND_LABEL[detail.kind]}
          </Chip>
          <LifecycleChip
            status={detail.status}
            extractionStatus={detail.extractionStatus}
          />
          {detail.kind === 'policy' && detail.severity ? (
            <Chip variant={SEVERITY_CHIP[detail.severity]} size="sm">
              {POLICY_SEVERITY_LABEL[detail.severity]}
            </Chip>
          ) : null}
          <TrustBadge tier={detail.trustTier} size="sm" />
        </div>
        {detail.extractionStatus ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-bg-overlay/30 px-2.5 py-1.5">
            <span className="text-xs text-fg-secondary">
              Статус извлечения:
            </span>
            <Chip
              variant={EXTRACTION_CHIP[detail.extractionStatus]}
              size="sm"
            >
              {EXTRACTION_STATUS_LABEL[detail.extractionStatus]}
            </Chip>
            {isDraftExtraction(detail.extractionStatus) ? (
              <span className="text-xs text-fg-tertiary">
                Это черновик — запись ещё обсуждается и пока не действует.
              </span>
            ) : null}
          </div>
        ) : null}
        <h2 className="text-lg font-semibold">{detail.name}</h2>
        <dl className="grid grid-cols-1 gap-1 text-xs text-fg-tertiary sm:grid-cols-2">
          {detail.scope ? (
            <div>
              <dt className="inline text-fg-secondary">Область: </dt>
              <dd className="inline">{detail.scope}</dd>
            </div>
          ) : null}
          <div>
            <dt className="inline text-fg-secondary">Подтверждено: </dt>
            <dd className="inline">
              {detail.lastConfirmedAt
                ? detail.lastConfirmedAt.toLocaleDateString('ru-RU')
                : '—'}
            </dd>
          </div>
          {detail.confidence !== null ? (
            <div>
              <dt className="inline text-fg-secondary">
                Уверенность извлечения:{' '}
              </dt>
              <dd className="inline">
                {(detail.confidence * 100).toFixed(0)}%
              </dd>
            </div>
          ) : null}
        </dl>
      </header>

      <NeedsAttentionBadge needsAttention={detail.needsAttention} />

      {/* C3: provenance-аккордеон — дословные цитаты-источники. */}
      <SourcesAccordion
        regulationId={detail.id}
        kind={detail.kind}
        count={detail.sourceBlockIds.length}
        open={sourcesOpen}
        onToggle={() => setSourcesOpen((v) => !v)}
      />

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-fg-primary">Содержание</h3>
        {detail.statement && detail.statement !== detail.contentMd ? (
          <p className="text-sm font-medium text-fg-primary">
            {detail.statement}
          </p>
        ) : null}
        {detail.contentMd ? (
          <ContentMarkdown text={detail.contentMd} />
        ) : detail.statement ? null : (
          <p className="text-sm text-fg-tertiary">Текст пока не заполнен.</p>
        )}
      </section>

      {detail.steps && detail.steps.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-fg-primary">
            Шаги процесса
          </h3>
          <ol className="space-y-2">
            {detail.steps.map((s) => (
              <li
                key={s.id}
                className="rounded-md border border-border-subtle p-3 text-xs"
              >
                <div className="text-sm font-medium text-fg-primary">
                  {s.order}. {s.name}
                </div>
                {s.description ? (
                  <p className="mt-1 text-fg-secondary">{s.description}</p>
                ) : null}
                {s.slaMinutes ? (
                  <p className="mt-1 text-fg-tertiary">
                    SLA: ≈ {formatMinutes(s.slaMinutes)}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-fg-primary">Действия</h3>
        <div className="flex flex-wrap gap-2">
          {deletedFilter ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleConfirm()}
            >
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
              Подтвердить актуальность
            </Button>
          )}
          {deletedFilter ? null : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSupersedeOpen(true)}
            >
              <Replace className="mr-1.5 h-4 w-4" />
              Заменить новой версией
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void toggleHistory()}
          >
            <History className="mr-1.5 h-4 w-4" />
            {historyOpen ? 'Скрыть историю' : 'История версий'}
          </Button>
          {canWrite && deletedFilter ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleRestore()}
            >
              <ArchiveRestore className="mr-1.5 h-4 w-4" />
              Восстановить
            </Button>
          ) : null}
          {canWrite && !deletedFilter ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-danger hover:text-danger"
              onClick={() => void handleDelete()}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              Удалить
            </Button>
          ) : null}
          {deletedFilter ? null : (
          <CardCorrectionActions
            fields={buildRegulationCorrectionFields(detail)}
            canApplyDirectly={canApplyDirectly}
            trustTier={detail.trustTier}
            onCorrect={(values, reason) =>
              regulationsApi
                .correct(detail.id, {
                  kind: detail.kind,
                  correctedPayload: values,
                  ...(reason ? { reason } : {}),
                })
                .then((r) => ({ applied: r.applied }))
            }
            onDispute={(reason) =>
              regulationsApi
                .dispute(detail.id, {
                  kind: detail.kind,
                  ...(reason ? { reason } : {}),
                })
                .then(() => undefined)
            }
            onDone={() => {
              void loadDetail();
              void load();
            }}
          />
          )}
        </div>
      </section>

      {historyOpen ? (
        <section className="rounded-md border border-border-subtle bg-bg-overlay/20 p-3">
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-tertiary">
            История изменений
          </h4>
          {historyLoading ? (
            <AdminLoading rows={2} />
          ) : !history || history.items.length === 0 ? (
            <p className="text-xs text-fg-tertiary">История пуста.</p>
          ) : (
            <ol className="space-y-2">
              {history.items.map(mapVersionItem).map((v) => (
                <li
                  key={v.id}
                  className="border-l-2 border-border-subtle pl-3"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium text-fg-primary">
                      Версия {v.version}
                    </span>
                    <span className="text-xs font-normal text-fg-tertiary">
                      · {v.createdAt.toLocaleDateString('ru-RU')}
                    </span>
                    {v.source ? (
                      <Chip variant="lavender" size="sm">
                        {REGULATION_CHANGE_SOURCE_LABEL[v.source]}
                      </Chip>
                    ) : null}
                  </div>
                  {v.changeReason ? (
                    <p className="mt-0.5 text-xs text-fg-secondary">
                      <span className="font-medium text-fg-primary">
                        Причина изменения:{' '}
                      </span>
                      {v.changeReason}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : null}
    </article>
  );

  // Диалог замены версией — общий для обеих раскладок.
  const supersedeDialog = (
    <ConfirmDialog
      open={supersedeOpen}
      onOpenChange={(open) => {
        setSupersedeOpen(open);
        if (!open) setSupersedeTargetId('');
      }}
      title="Заменить новой версией"
      description={
        <div className="space-y-2">
          <p>
            Текущая запись будет помечена как устаревшая, а новая — указанная
            по идентификатору — займёт её место.
          </p>
          <Input
            value={supersedeTargetId}
            onChange={(e) => setSupersedeTargetId(e.target.value)}
            placeholder="Идентификатор новой версии"
            autoFocus
          />
        </div>
      }
      confirmLabel="Заменить"
      onConfirm={handleSupersede}
    />
  );

  // Гейт раскладки (Ф5b, kill-switch): дефолт — новая раскладка; пока summary
  // грузится — тоже новая (redesignEnabled !== false). false → аварийный
  // fallback на старую master-detail раскладку.
  const redesignEnabled = summary?.redesignEnabled !== false;

  if (!redesignEnabled) {
    return (
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <header className="mb-4">
          <h1 className="text-2xl font-semibold">База знаний компании</h1>
          <p className="mt-1 text-sm text-fg-secondary">
            Кора оцифровала из ваших встреч и обсуждений.
            {topTab === 'regulations' ? ` Найдено: ${data.total}.` : ''}
          </p>
        </header>

        {/* Верхний переключатель: регламенты vs шаблоны процессов (C2). */}
        <div
          role="tablist"
          aria-label="Раздел"
          className="mb-5 flex flex-wrap gap-1 border-b border-border-subtle"
        >
          {TOP_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={topTab === t.key}
              onClick={() => setTopTab(t.key)}
              className={cn(
                '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition',
                topTab === t.key
                  ? 'border-accent text-accent'
                  : 'border-transparent text-fg-secondary hover:text-fg-primary',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {topTab === 'process-templates' ? (
          <ProcessTemplatesClient />
        ) : (
          <>
            {summary ? (
            <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-secondary">
              <span className="text-fg-tertiary">В базе:</span>
              <Chip variant="info" size="sm">
                Регламенты: {summary.regulations}
              </Chip>
              <Chip variant="lavender" size="sm">
                Процессы: {summary.processTemplates}
              </Chip>
              <Chip variant="sand" size="sm">
                Инструкции: {summary.instructions}
              </Chip>
              <Chip variant="warning" size="sm">
                Политики: {summary.policies}
              </Chip>
              {summary.weekDelta > 0 ? (
                <Chip variant="success" size="sm">
                  +{summary.weekDelta} за неделю
                </Chip>
              ) : null}
            </div>
          ) : null}

          {recentItems.length > 0 ? (
            <section className="mb-5">
              <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-fg-tertiary">
                Недавно оцифровано
              </h2>
              <ul className="flex flex-wrap gap-2">
                {recentItems.map((r) => {
                  const isSelected =
                    selected?.id === r.id && selected.kind === r.kind;
                  return (
                    <li key={`recent:${r.kind}:${r.id}`}>
                      <button
                        type="button"
                        onClick={() =>
                          setSelected({ id: r.id, kind: r.kind })
                        }
                        className={cn(
                          'flex max-w-[18rem] items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-left text-xs transition',
                          isSelected
                            ? 'border-accent bg-accent/5'
                            : 'border-border-subtle bg-bg-card hover:border-border-strong',
                        )}
                      >
                        <Chip
                          variant={
                            isDraftExtraction(r.extractionStatus ?? null)
                              ? 'sand'
                              : 'success'
                          }
                          size="sm"
                        >
                          {isDraftExtraction(r.extractionStatus ?? null)
                            ? 'черновик'
                            : 'готово'}
                        </Chip>
                        <span className="truncate text-fg-primary">
                          {r.name}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <div className="mb-3 flex flex-wrap gap-2">
        {KIND_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => {
              if (f.value === 'process') {
                setSelected(null);
                setTopTab('process-templates');
                return;
              }
              setKindFilter(f.value);
            }}
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition',
              kindFilter === f.value
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border-subtle text-fg-secondary hover:border-border-strong',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mb-4">{filtersBlock}</div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {/* Левая колонка: список */}
        <div>{listBlock}</div>

        {/* Правая колонка: деталь */}
        <div className="rounded-lg border border-border-subtle bg-bg-card p-5">
          {detailBlock}
        </div>
      </div>

      {supersedeDialog}
      {confirmDialog}
        </>
      )}
      </div>
    );
  }

  // ── НОВАЯ раскладка (Ф5b): дерево слева · читаемая колонка · TOC справа ──

  const TREE_TYPES: {
    kind: RegulationKindApi;
    label: string;
    icon: string;
    count: number;
  }[] = [
    {
      kind: 'regulation',
      label: 'Регламенты',
      icon: '📕',
      count: summary?.regulations ?? 0,
    },
    {
      kind: 'process',
      label: 'Процессы',
      icon: '🔄',
      count: summary?.processTemplates ?? 0,
    },
    {
      kind: 'instruction',
      label: 'Инструкции',
      icon: '📋',
      count: summary?.instructions ?? 0,
    },
    {
      kind: 'policy',
      label: 'Политики',
      icon: '🛡️',
      count: summary?.policies ?? 0,
    },
  ];

  return (
    <div style={{ background: MODERN_PAGE_BG, minHeight: '100vh' }}>
      {/* Верхняя строка: заголовок + тумблер ширины */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold text-fg-primary">
            База знаний компании
          </h1>
          <p className="text-sm text-fg-tertiary">
            Кора оцифровала из ваших встреч и обсуждений.
          </p>
        </div>
        <div
          role="group"
          aria-label="Ширина колонки"
          className="inline-flex rounded-xl border border-border-subtle p-1"
          style={glass()}
        >
          {(['read', 'wide'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setWidthMode(m)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm transition',
                widthMode === m
                  ? 'bg-accent/15 text-fg-primary'
                  : 'text-fg-tertiary hover:text-fg-primary',
              )}
            >
              {m === 'read' ? 'Чтение' : 'Широкий'}
            </button>
          ))}
        </div>
      </div>

      {/* 3-зонная оболочка на всю ширину */}
      <div
        className="grid items-start gap-4 px-6 pb-12"
        style={{
          gridTemplateColumns:
            widthMode === 'wide'
              ? '280px minmax(0,1fr)'
              : '280px minmax(0,1fr) 264px',
        }}
      >
        {/* ЛЕВО — дерево */}
        <aside
          style={glass()}
          className="sticky top-4 self-start rounded-2xl p-3"
        >
          <h3 className="mb-2 px-2 text-[11px] font-bold uppercase tracking-[0.14em] text-fg-tertiary">
            База знаний
          </h3>
          {/* Вся база */}
          <button
            type="button"
            onClick={() => {
              setKindFilter('all');
              setSelected(null);
              setTopTab('regulations');
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-sm transition',
              topTab === 'regulations' && kindFilter === 'all' && !selected
                ? 'bg-accent/15 text-fg-primary'
                : 'text-fg-secondary hover:bg-bg-overlay/40',
            )}
          >
            <span>📚</span>
            <span className="flex-1 text-left">Вся база</span>
            <span className="rounded-full bg-bg-overlay/50 px-2 text-xs text-fg-tertiary">
              {summaryTotal}
            </span>
          </button>
          {/* Типы */}
          {TREE_TYPES.map((t) => (
            <button
              key={t.kind}
              type="button"
              onClick={() => {
                if (t.kind === 'process') {
                  setSelected(null);
                  setTopTab('process-templates');
                  return;
                }
                setKindFilter(t.kind);
                setSelected(null);
                setTopTab('regulations');
              }}
              className={cn(
                'mt-0.5 flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-sm transition',
                t.kind === 'process'
                  ? topTab === 'process-templates'
                    ? 'bg-accent/15 text-fg-primary'
                    : 'text-fg-secondary hover:bg-bg-overlay/40'
                  : topTab === 'regulations' && kindFilter === t.kind
                    ? 'bg-accent/15 text-fg-primary'
                    : 'text-fg-secondary hover:bg-bg-overlay/40',
                t.count === 0 && 'opacity-60',
              )}
            >
              <span>{t.icon}</span>
              <span className="flex-1 text-left">{t.label}</span>
              <span className="rounded-full bg-bg-overlay/50 px-2 text-xs text-fg-tertiary">
                {t.count}
              </span>
            </button>
          ))}
          {/* Шаблоны процессов — сведены сюда (без отдельной верхней вкладки) */}
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setTopTab('process-templates');
            }}
            className={cn(
              'mt-0.5 flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-sm transition',
              topTab === 'process-templates'
                ? 'bg-accent/15 text-fg-primary'
                : 'text-fg-secondary hover:bg-bg-overlay/40',
            )}
          >
            <span>🧩</span>
            <span className="flex-1 text-left">Шаблоны процессов</span>
          </button>
          <p className="mt-2 px-2 text-[11px] leading-snug text-fg-tertiary">
            Пустые типы Кора заполнит, как только их обсудят на встречах или
            вы загрузите вручную.
          </p>
          <Link
            href="/documents"
            className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong px-3 py-2 text-sm text-fg-secondary transition hover:text-fg-primary"
          >
            ＋ Загрузить вручную
          </Link>
        </aside>

        {/* ЦЕНТР — читаемая колонка */}
        <main style={glass()} className="min-h-[70vh] rounded-2xl">
          {topTab === 'process-templates' ? (
            <div className="p-5">
              <ProcessTemplatesClient />
            </div>
          ) : selected ? (
            <div
              className="mx-auto p-6"
              style={{ maxWidth: widthMode === 'wide' ? 980 : 720 }}
            >
              {detailBlock}
            </div>
          ) : (
            <div className="p-5">
              <div className="mb-3 text-sm text-fg-tertiary">
                Найдено: {data.total}
              </div>
              {filtersBlock}
              <div className="mt-3">{listBlock}</div>
            </div>
          )}
        </main>

        {/* ПРАВО — TOC (скрыт в режиме «Широкий») */}
        {widthMode !== 'wide' && (
          <aside
            style={glass()}
            className="sticky top-4 self-start rounded-2xl p-4"
          >
            {selected && detail && toc.length > 0 ? (
              <>
                <h4 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-fg-tertiary">
                  На этой странице
                </h4>
                <nav className="space-y-0.5">
                  {toc.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() =>
                        document
                          .getElementById(h.id)
                          ?.scrollIntoView({
                            behavior: 'smooth',
                            block: 'start',
                          })
                      }
                      className="block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-sm text-fg-secondary transition hover:bg-bg-overlay/40 hover:text-fg-primary"
                    >
                      {h.text}
                    </button>
                  ))}
                </nav>
              </>
            ) : (
              <p className="text-xs text-fg-tertiary">
                Выберите карточку слева — здесь появится оглавление и
                источник.
              </p>
            )}
          </aside>
        )}
      </div>

      {supersedeDialog}
      {confirmDialog}
    </div>
  );
}

const NEEDS_ATTENTION_REASONS: ReadonlyArray<{
  key: keyof RegulationNeedsAttention;
  label: string;
}> = [
  { key: 'missingOwner', label: 'Не назначен владелец' },
  { key: 'missingSteps', label: 'Не описаны шаги' },
  { key: 'unclearScope', label: 'Не указана область действия' },
];

function NeedsAttentionBadge({
  needsAttention,
}: {
  needsAttention: RegulationNeedsAttention;
}) {
  if (!hasNeedsAttention(needsAttention)) return null;
  const reasons = NEEDS_ATTENTION_REASONS.filter(
    (r) => needsAttention[r.key],
  );
  return (
    <section className="rounded-md border border-chip-warning-fg/30 bg-chip-warning-bg px-3 py-2.5">
      <h3 className="flex items-center gap-1.5 text-sm font-medium text-chip-warning-fg">
        <span aria-hidden>⚠️</span>
        Требует внимания
      </h3>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {reasons.map((r) => (
          <li key={r.key}>
            <Chip variant="warning" size="sm">
              {r.label}
            </Chip>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Lifecycle-чип записи (B2.3).
 *
 * Если статус извлечения ∈ {needed, discussed} — запись ещё не действует,
 * вместо lifecycle «Действует» показываем «Черновик/обсуждается». Это не
 * новый lifecycle-enum, а гейт поверх `extractionStatus` (см. ТЗ B2.3).
 */
function LifecycleChip({
  status,
  extractionStatus,
}: {
  status: RegulationStatus;
  extractionStatus: ExtractionStatus | null;
}) {
  if (isDraftExtraction(extractionStatus)) {
    return (
      <Chip variant="sand" size="sm">
        Черновик/обсуждается
      </Chip>
    );
  }
  return (
    <Chip variant={STATUS_CHIP[status]} size="sm">
      {REGULATION_STATUS_LABEL[status]}
    </Chip>
  );
}

/**
 * Provenance-аккордеон (C3).
 *
 * Заголовок-disclosure показывает число источников; по раскрытию лениво
 * грузит дословные цитаты через `regulationsApi.getSources` (SWR с ключом
 * только когда `open` — пока не раскрыт, запроса нет). Каждая цитата ведёт
 * на встречу-источник, если она известна.
 */
function SourcesAccordion({
  regulationId,
  kind,
  count,
  open,
  onToggle,
}: {
  regulationId: string;
  kind: RegulationKindApi;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  const swr = useSWR(
    open ? ['regulation-sources', regulationId, kind] : null,
    async () =>
      mapRegulationSources(await regulationsApi.getSources(regulationId, kind)),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const sources = swr.data;

  return (
    <section className="rounded-md border border-border-subtle bg-bg-overlay/20">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-sm font-medium text-fg-primary">
          <Quote className="h-4 w-4 text-fg-tertiary" aria-hidden />
          Источники
          <span className="text-xs font-normal text-fg-tertiary">
            · {count}
          </span>
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-fg-tertiary transition-transform',
            open ? 'rotate-180' : '',
          )}
          aria-hidden
        />
      </button>
      {open ? (
        <div className="border-t border-border-subtle px-3 py-2">
          {swr.isLoading ? (
            <AdminLoading rows={2} />
          ) : swr.error ? (
            <p className="text-xs text-fg-tertiary">
              Не удалось загрузить источники.
            </p>
          ) : !sources || sources.length === 0 ? (
            <p className="text-xs text-fg-tertiary">
              Дословные цитаты-источники пока недоступны.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {sources.map((s) => (
                <li
                  key={s.blockId}
                  className="border-l-2 border-border-subtle pl-3"
                >
                  <blockquote className="text-sm text-fg-secondary">
                    «{s.quote}»
                  </blockquote>
                  {s.meeting ? (
                    <Link
                      href={s.deepLink ?? `/meetings/${s.meeting.id}`}
                      className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                    >
                      {s.meeting.title}
                      <span className="text-fg-tertiary">
                        · {s.meeting.date.toLocaleDateString('ru-RU')}
                      </span>
                      {s.startMs !== null ? (
                        <span className="text-fg-tertiary">
                          · перейти к моменту
                        </span>
                      ) : null}
                    </Link>
                  ) : (
                    <span className="mt-1 block text-xs text-fg-tertiary">
                      Источник встречи неизвестен
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Разбор строки на сегменты по маркерам (B2.4).
 *
 * Литералы `[требует уточнения]`, `[конфликт]`, `[изменено]` (регистр и
 * пробелы внутри скобок не важны) превращаются в цветные чипы; остальной
 * текст остаётся как есть.
 */
type MarkerSegment =
  | { kind: 'text'; value: string }
  | { kind: 'marker'; value: string; variant: 'warning' | 'danger' | 'info' };

export function parseContentMarkers(text: string): MarkerSegment[] {
  const segments: MarkerSegment[] = [];
  // Захватываем любые скобки [...] — внутри ищем известный маркер.
  const re = /\[([^\]]+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const inner = m[1].trim().toLowerCase();
    const found = CONTENT_MARKERS.find((c) => c.literal === inner);
    if (!found) continue; // неизвестная скобка — оставляем как обычный текст
    if (m.index > last) {
      segments.push({ kind: 'text', value: text.slice(last, m.index) });
    }
    segments.push({
      kind: 'marker',
      value: m[0].slice(1, -1).trim(),
      variant: found.variant,
    });
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    segments.push({ kind: 'text', value: text.slice(last) });
  }
  return segments;
}

/**
 * Рендер contentMd как markdown (react-markdown@10 + rehype-sanitize@6 —
 * тот же стек, что в `MeetingSummaryRender`) с подсветкой маркеров (B2.4).
 *
 * Маркеры вырезаются из текста ДО markdown-рендера и показываются строкой
 * чипов сверху, чтобы не зависеть от того, как markdown разобьёт абзацы.
 */
function ContentMarkdown({ text }: { text: string }) {
  const segments = useMemo(() => parseContentMarkers(text), [text]);
  const markers = segments.filter(
    (s): s is Extract<MarkerSegment, { kind: 'marker' }> => s.kind === 'marker',
  );
  // Текст без маркер-литералов — чтобы [требует уточнения] не дублировался.
  const cleanText = useMemo(
    () =>
      segments
        .map((s) => (s.kind === 'text' ? s.value : ''))
        .join('')
        .trim(),
    [segments],
  );

  // Ф5b: счётчик `## …` заголовков — id `kb-h-N` синхронизированы с extractToc,
  // чтобы клики в правой TOC-колонке скроллили к нужному заголовку. Сбрасываем
  // на каждый рендер (порядок обхода h2 у react-markdown стабилен).
  let h2Index = 0;

  return (
    <div className="space-y-2">
      {markers.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {markers.map((mk, i) => (
            <Chip key={`${mk.value}-${i}`} variant={mk.variant} size="sm">
              {mk.value}
            </Chip>
          ))}
        </div>
      ) : null}
      <div className="prose prose-sm max-w-none text-sm text-fg-primary [&>*]:my-2">
        <ReactMarkdown
          rehypePlugins={[rehypeSanitize]}
          components={{
            h2: ({ node: _node, ...props }) => (
              <h2 id={`kb-h-${h2Index++}`} {...props} />
            ),
          }}
        >
          {cleanText || text}
        </ReactMarkdown>
      </div>
    </div>
  );
}

/**
 * Поля формы «Исправить» зависят от вида записи.
 *  - regulation/standard    → название + суть + полный текст.
 *  - process/instruction    → название + описание (хранится в contentMd детали).
 *  - policy                 → название + текст политики (contentMd).
 */
function buildRegulationCorrectionFields(
  detail: RegulationDetail,
): CorrectionField[] {
  const name: CorrectionField = {
    key: 'name',
    label: 'Название',
    value: detail.name,
  };
  if (detail.kind === 'process' || detail.kind === 'instruction') {
    return [
      name,
      {
        key: 'description',
        label: 'Описание',
        value: detail.contentMd ?? '',
        multiline: true,
      },
    ];
  }
  if (detail.kind === 'policy') {
    return [
      name,
      {
        key: 'contentMd',
        label: 'Текст политики',
        value: detail.contentMd ?? '',
        multiline: true,
      },
    ];
  }
  // regulation | standard
  return [
    name,
    {
      key: 'statement',
      label: 'Суть',
      value: detail.statement ?? '',
      multiline: true,
    },
    {
      key: 'contentMd',
      label: 'Полный текст',
      value: detail.contentMd ?? '',
      multiline: true,
    },
  ];
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min} мин`;
  const hours = Math.floor(min / 60);
  const rem = min % 60;
  if (rem === 0) return `${hours} ч`;
  return `${hours} ч ${rem} мин`;
}
