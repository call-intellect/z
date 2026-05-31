'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, History, Replace, Search } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import {
  regulationsApi,
  type RegulationKindApi,
  type RegulationStatusApi,
  type RegulationsListResponseApi,
  type RegulationHistoryResponseApi,
} from '@/api/regulations.api';
import { useAuth } from '@/contexts/auth-context';
import {
  POLICY_SEVERITY_LABEL,
  REGULATION_KIND_LABEL,
  REGULATION_STATUS_LABEL,
  type PolicySeverity,
  type RegulationDetail,
  type RegulationStatus,
  mapRegulationDetail,
} from '@/domain/regulation';
import { Chip } from '@/ui/components/shared/Chip';
import { ConfirmDialog } from '@/ui/components/shared/ConfirmDialog';
import { EmptyState } from '@/ui/components/shared/EmptyState';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { cn } from '@/ui/shadcn/lib/utils';

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
        description="Вы не состоите ни в одной Org."
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
  { value: 'regulation', label: 'Правила и стандарты' },
  { value: 'process', label: 'Процессы и инструкции' },
  { value: 'policy', label: 'Политики и положения' },
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

function RegulationsListContent() {
  const [data, setData] = useState<RegulationsListResponseApi | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | RegulationKindApi>('all');
  const [statusFilter, setStatusFilter] =
    useState<'all' | RegulationStatusApi>('all');
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
        limit: 50,
      });
      setData(dto);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'forbidden') {
        setForbidden(true);
      } else {
        setError(e instanceof ApiError ? e.message : 'Ошибка загрузки');
      }
    } finally {
      setIsLoading(false);
    }
  }, [qDebounced, kindFilter, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDetail = useCallback(async () => {
    if (!selected) return;
    setDetailLoading(true);
    setDetailError(null);
    setHistory(null);
    setHistoryOpen(false);
    try {
      const dto = await regulationsApi.get(selected.id, selected.kind);
      setDetail(mapRegulationDetail(dto));
    } catch (e) {
      setDetailError(e instanceof ApiError ? e.message : 'Ошибка загрузки');
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
          e instanceof ApiError ? e.message : 'Не удалось подтвердить',
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
          e instanceof ApiError ? e.message : 'Не удалось заменить запись',
        );
      }
      throw e;
    }
  }, [selected, supersedeTargetId, loadDetail, load]);

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
        e instanceof ApiError ? e.message : 'Не удалось загрузить историю',
      );
    } finally {
      setHistoryLoading(false);
    }
  }, [selected, history, historyOpen]);

  const groupedItems = useMemo(() => data?.items ?? [], [data]);

  if (isLoading && !data) return <AdminLoading rows={6} />;
  if (forbidden) return <AdminForbidden />;
  if (error) return <AdminError message={error} onRetry={load} />;
  if (!data) return null;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">
          Правила, процессы и политики
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Документы, которые Кора извлекла из ваших встреч и обсуждений.
          Всего: {data.total}. Показано: {data.items.length}.
        </p>
      </header>

      <div className="mb-3 flex flex-wrap gap-2">
        {KIND_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setKindFilter(f.value)}
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

      <div className="mb-4 flex flex-wrap items-center gap-3">
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
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {/* Левая колонка: список */}
        <div>
          {groupedItems.length === 0 ? (
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
                        isSelected
                          ? 'bg-accent/5'
                          : 'hover:bg-bg-overlay/40',
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Chip variant="info" size="sm">
                          {REGULATION_KIND_LABEL[r.kind]}
                        </Chip>
                        <Chip variant={STATUS_CHIP[r.status]} size="sm">
                          {REGULATION_STATUS_LABEL[r.status]}
                        </Chip>
                        {r.kind === 'policy' && r.severity ? (
                          <Chip
                            variant={SEVERITY_CHIP[r.severity]}
                            size="sm"
                          >
                            {POLICY_SEVERITY_LABEL[r.severity]}
                          </Chip>
                        ) : null}
                      </div>
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
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Правая колонка: деталь */}
        <div className="rounded-lg border border-border-subtle bg-bg-card p-5">
          {!selected ? (
            <p className="text-sm text-fg-tertiary">
              Выберите запись слева, чтобы увидеть подробности и историю
              версий.
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
                  <Chip variant={STATUS_CHIP[detail.status]} size="sm">
                    {REGULATION_STATUS_LABEL[detail.status]}
                  </Chip>
                  {detail.kind === 'policy' && detail.severity ? (
                    <Chip variant={SEVERITY_CHIP[detail.severity]} size="sm">
                      {POLICY_SEVERITY_LABEL[detail.severity]}
                    </Chip>
                  ) : null}
                </div>
                <h2 className="text-lg font-semibold">{detail.name}</h2>
                <dl className="grid grid-cols-1 gap-1 text-xs text-fg-tertiary sm:grid-cols-2">
                  {detail.scope ? (
                    <div>
                      <dt className="inline text-fg-secondary">Область: </dt>
                      <dd className="inline">{detail.scope}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt className="inline text-fg-secondary">
                      Подтверждено:{' '}
                    </dt>
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
                  <div>
                    <dt className="inline text-fg-secondary">Источников: </dt>
                    <dd className="inline">{detail.sourceBlockIds.length}</dd>
                  </div>
                </dl>
              </header>

              <section className="space-y-2">
                <h3 className="text-sm font-medium text-fg-primary">
                  Содержание
                </h3>
                {detail.statement ? (
                  <p className="whitespace-pre-wrap text-sm text-fg-primary">
                    {detail.statement}
                  </p>
                ) : null}
                {detail.contentMd && detail.contentMd !== detail.statement ? (
                  <details className="rounded-md border border-border-subtle bg-bg-overlay/30 p-3">
                    <summary className="cursor-pointer text-xs text-fg-secondary">
                      Полный текст
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap text-xs text-fg-primary">
                      {detail.contentMd}
                    </pre>
                  </details>
                ) : null}
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
                          <p className="mt-1 text-fg-secondary">
                            {s.description}
                          </p>
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
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleConfirm()}
                  >
                    <CheckCircle2 className="mr-1.5 h-4 w-4" />
                    Подтвердить актуальность
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSupersedeOpen(true)}
                  >
                    <Replace className="mr-1.5 h-4 w-4" />
                    Заменить новой версией
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void toggleHistory()}
                  >
                    <History className="mr-1.5 h-4 w-4" />
                    {historyOpen ? 'Скрыть историю' : 'История версий'}
                  </Button>
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
                    <p className="text-xs text-fg-tertiary">
                      История пуста.
                    </p>
                  ) : (
                    <ol className="space-y-2">
                      {history.items.map((v) => (
                        <li
                          key={v.id}
                          className="border-l-2 border-border-subtle pl-3"
                        >
                          <div className="text-xs font-medium text-fg-primary">
                            Версия {v.version}{' '}
                            <span className="font-normal text-fg-tertiary">
                              ·{' '}
                              {new Date(v.createdAt).toLocaleDateString(
                                'ru-RU',
                              )}
                            </span>
                          </div>
                          {v.changeReason ? (
                            <p className="text-xs text-fg-secondary">
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
          )}
        </div>
      </div>

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
              Текущая запись будет помечена как устаревшая, а новая —
              указанная по идентификатору — займёт её место.
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
    </div>
  );
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min} мин`;
  const hours = Math.floor(min / 60);
  const rem = min % 60;
  if (rem === 0) return `${hours} ч`;
  return `${hours} ч ${rem} мин`;
}
