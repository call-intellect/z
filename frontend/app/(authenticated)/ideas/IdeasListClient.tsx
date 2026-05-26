'use client';

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Flame, Search, ThumbsUp } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import {
  ideasApi,
  type IdeaClusterApi,
  type IdeaKindApi,
  type IdeaStatusApi,
} from '@/api/ideas.api';
import { useAuth } from '@/contexts/auth-context';
import {
  IDEA_KIND_LABEL,
  IDEA_STATUS_CHIP,
  IDEA_STATUS_LABEL,
  IDEA_STATUS_TRANSITIONS,
  mapIdeaCluster,
  mapIdeaDetail,
  mapIdeaListItem,
  type IdeaCluster,
  type IdeaDetail,
  type IdeaListItem,
  type IdeaStatus,
} from '@/domain/idea';
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
} from '../admin/AdminStateViews';

type TabKey = 'all' | 'clusters' | 'mine';
type MineRole = 'author' | 'supporter';

/**
 * `/ideas` (SBA β-5, ТЗ 2026-05-26 §2) — реестр идей и запросов клиентов.
 *
 * Вкладки:
 *   - «Все идеи»    — master-detail с фильтрами kind / status / search.
 *   - «По кластерам» — список IdeaCluster + раскрытие идей внутри.
 *   - «Мои идеи»    — переключатель «Я автор / Я поддержал».
 */
export function IdeasListClient(): JSX.Element {
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
  return <IdeasContent />;
}

function IdeasContent(): JSX.Element {
  const [tab, setTab] = useState<TabKey>('all');
  const [selected, setSelected] = useState<IdeaDetail | null>(null);

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Идеи</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Идеи сотрудников и запросы клиентов, которые Кора зафиксировала из
          встреч и разговоров.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-border-subtle">
        {(['all', 'clusters', 'mine'] as TabKey[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTab(t);
              setSelected(null);
            }}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
              tab === t
                ? 'border-accent text-accent'
                : 'border-transparent text-fg-secondary hover:text-fg-primary',
            )}
          >
            {t === 'all'
              ? 'Все идеи'
              : t === 'clusters'
                ? 'По кластерам'
                : 'Мои идеи'}
          </button>
        ))}
      </div>

      {tab === 'all' && (
        <IdeasAllTab selected={selected} setSelected={setSelected} />
      )}
      {tab === 'clusters' && (
        <IdeasClustersTab selected={selected} setSelected={setSelected} />
      )}
      {tab === 'mine' && (
        <IdeasMineTab selected={selected} setSelected={setSelected} />
      )}
    </div>
  );
}

// ──────────────────────────── Вкладка «Все идеи» ────────────────────────────

const KIND_FILTERS: ReadonlyArray<{ value: 'all' | IdeaKindApi; label: string }> = [
  { value: 'all', label: 'Все виды' },
  { value: 'internal', label: 'Внутренние' },
  { value: 'client_request', label: 'Запросы клиентов' },
];

const ALL_STATUSES: ReadonlyArray<IdeaStatus> = [
  'captured',
  'in_discussion',
  'accepted',
  'in_progress',
  'shipped',
  'rejected',
  'archived',
];

function IdeasAllTab({
  selected,
  setSelected,
}: {
  selected: IdeaDetail | null;
  setSelected: (d: IdeaDetail | null) => void;
}) {
  const [kindFilter, setKindFilter] = useState<'all' | IdeaKindApi>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | IdeaStatus>('all');
  const [q, setQ] = useState('');
  const [qDebounced, setQDebounced] = useState('');
  const [items, setItems] = useState<IdeaListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const resp = await ideasApi.list({
        kind: kindFilter === 'all' ? undefined : kindFilter,
        status: statusFilter === 'all' ? undefined : statusFilter,
        q: qDebounced || undefined,
        page: 1,
        limit: 100,
      });
      setItems(resp.items.map(mapIdeaListItem));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'forbidden') {
        setForbidden(true);
      } else {
        setError(
          e instanceof ApiError ? e.message : 'Не удалось загрузить идеи',
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [kindFilter, statusFilter, qDebounced]);

  useEffect(() => {
    void load();
  }, [load]);

  if (forbidden) return <AdminForbidden />;
  if (error) return <AdminError message={error} onRetry={load} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-md flex-1">
          <Search
            className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-tertiary"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск по тексту идеи"
            className="pl-8"
          />
        </div>
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as 'all' | IdeaKindApi)}
          className="rounded-md border border-border-subtle bg-bg-card px-3 py-2 text-sm"
        >
          {KIND_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | IdeaStatus)}
          className="rounded-md border border-border-subtle bg-bg-card px-3 py-2 text-sm"
        >
          <option value="all">Любой статус</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {IDEA_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      <IdeasMasterDetail
        items={items}
        isLoading={isLoading}
        selected={selected}
        setSelected={setSelected}
        onListRefresh={load}
        emptyTitle="Идей пока нет"
        emptyDescription="Кора фиксирует идеи и запросы из ваших встреч и разговоров. Поговорите о новых функциях или улучшениях — они появятся здесь."
      />
    </div>
  );
}

// ──────────────────────────── Вкладка «По кластерам» ────────────────────────

function IdeasClustersTab({
  selected,
  setSelected,
}: {
  selected: IdeaDetail | null;
  setSelected: (d: IdeaDetail | null) => void;
}) {
  const [clusters, setClusters] = useState<IdeaCluster[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const resp = await ideasApi.listClusters(1, 100);
      setClusters(resp.items.map(mapIdeaCluster));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'forbidden') {
        setForbidden(true);
      } else {
        setError(
          e instanceof ApiError ? e.message : 'Не удалось загрузить кластеры',
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (forbidden) return <AdminForbidden />;
  if (error) return <AdminError message={error} onRetry={load} />;

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div>
        {isLoading ? (
          <AdminLoading rows={4} />
        ) : clusters.length === 0 ? (
          <EmptyState
            title="Кластеров пока нет"
            description="Кластеры формируются автоматически, когда накапливается несколько похожих идей."
          />
        ) : (
          <ul className="space-y-2">
            {clusters.map((c) => (
              <ClusterRow
                key={c.id}
                cluster={c}
                isExpanded={expanded === c.id}
                onToggle={() => setExpanded(expanded === c.id ? null : c.id)}
                onSelectIdea={(detail) => setSelected(detail)}
                selectedIdeaId={selected?.id ?? null}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-border-subtle bg-bg-card p-5">
        {selected ? (
          <IdeaDetailPane
            idea={selected}
            onUpdated={(d) => setSelected(d)}
            onListChanged={load}
          />
        ) : (
          <p className="text-sm text-fg-tertiary">
            Раскройте кластер и выберите идею слева.
          </p>
        )}
      </div>
    </div>
  );
}

function ClusterRow({
  cluster,
  isExpanded,
  onToggle,
  onSelectIdea,
  selectedIdeaId,
}: {
  cluster: IdeaCluster;
  isExpanded: boolean;
  onToggle: () => void;
  onSelectIdea: (idea: IdeaDetail) => void;
  selectedIdeaId: string | null;
}) {
  const [ideas, setIdeas] = useState<IdeaListItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isExpanded || loaded) return;
    setLoading(true);
    ideasApi
      .list({ clusterId: cluster.id, page: 1, limit: 100 })
      .then((r) => {
        setIdeas(r.items.map(mapIdeaListItem));
        setLoaded(true);
      })
      .catch((e) => {
        toast.error(
          e instanceof ApiError ? e.message : 'Не удалось загрузить идеи',
        );
      })
      .finally(() => setLoading(false));
  }, [isExpanded, loaded, cluster.id]);

  const selectIdea = useCallback(async (id: string) => {
    try {
      const dto = await ideasApi.getById(id);
      onSelectIdea(mapIdeaDetail(dto));
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Не удалось загрузить деталь',
      );
    }
  }, [onSelectIdea]);

  return (
    <li className="rounded-lg border border-border-subtle bg-bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-overlay/40"
      >
        {isExpanded ? (
          <ChevronDown size={16} className="shrink-0 text-fg-tertiary" />
        ) : (
          <ChevronRight size={16} className="shrink-0 text-fg-tertiary" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-fg-primary">
            {cluster.name}
          </div>
          {cluster.description ? (
            <p className="mt-0.5 line-clamp-1 text-xs text-fg-tertiary">
              {cluster.description}
            </p>
          ) : null}
          <div className="mt-1 text-xs text-fg-tertiary">
            {cluster.ideaCount}{' '}
            {pluralize(cluster.ideaCount, 'идея', 'идеи', 'идей')} · вес{' '}
            {cluster.clusterWeight.toFixed(1)}
          </div>
        </div>
      </button>
      {isExpanded ? (
        <div className="border-t border-border-subtle">
          {loading ? (
            <AdminLoading rows={2} />
          ) : ideas.length === 0 ? (
            <p className="px-4 py-3 text-xs text-fg-tertiary">
              В этом кластере пока нет идей.
            </p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {ideas.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => void selectIdea(i.id)}
                    className={cn(
                      'flex w-full flex-col gap-1 px-4 py-2 text-left transition-colors',
                      selectedIdeaId === i.id
                        ? 'bg-accent/5'
                        : 'hover:bg-bg-overlay/40',
                    )}
                  >
                    <span className="line-clamp-2 text-sm text-fg-primary">
                      {i.statement}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-fg-tertiary">
                      <Chip variant={IDEA_STATUS_CHIP[i.status]} size="sm">
                        {IDEA_STATUS_LABEL[i.status]}
                      </Chip>
                      <span>· {i.supporterCount} поддержавших</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </li>
  );
}

// ──────────────────────────── Вкладка «Мои идеи» ────────────────────────────

function IdeasMineTab({
  selected,
  setSelected,
}: {
  selected: IdeaDetail | null;
  setSelected: (d: IdeaDetail | null) => void;
}) {
  const [role, setRole] = useState<MineRole>('author');
  const [items, setItems] = useState<IdeaListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const resp = await ideasApi.myIdeas({ role, page: 1, limit: 100 });
      setItems(resp.items.map(mapIdeaListItem));
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : 'Не удалось загрузить идеи',
      );
    } finally {
      setIsLoading(false);
    }
  }, [role]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <AdminError message={error} onRetry={load} />;

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(['author', 'supporter'] as MineRole[]).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setRole(r)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition',
              role === r
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border-subtle text-fg-secondary hover:border-border-strong',
            )}
          >
            {r === 'author' ? 'Я автор' : 'Я поддержал'}
          </button>
        ))}
      </div>

      <IdeasMasterDetail
        items={items}
        isLoading={isLoading}
        selected={selected}
        setSelected={setSelected}
        onListRefresh={load}
        emptyTitle={role === 'author' ? 'Вы пока не предлагали идей' : 'Вы пока никого не поддерживали'}
        emptyDescription="Когда Кора зафиксирует или вы поддержите идею — она появится в этом списке."
      />
    </div>
  );
}

// ──────────────────────────── Master-detail ────────────────────────────────

function IdeasMasterDetail({
  items,
  isLoading,
  selected,
  setSelected,
  onListRefresh,
  emptyTitle,
  emptyDescription,
}: {
  items: IdeaListItem[];
  isLoading: boolean;
  selected: IdeaDetail | null;
  setSelected: (d: IdeaDetail | null) => void;
  onListRefresh: () => Promise<void> | void;
  emptyTitle: string;
  emptyDescription: string;
}) {
  const sorted = useMemo(
    () => [...items].sort((a, b) => b.weight - a.weight),
    [items],
  );

  const selectIdea = useCallback(async (id: string) => {
    try {
      const dto = await ideasApi.getById(id);
      setSelected(mapIdeaDetail(dto));
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Не удалось загрузить деталь',
      );
    }
  }, [setSelected]);

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div>
        {isLoading ? (
          <AdminLoading rows={4} />
        ) : sorted.length === 0 ? (
          <EmptyState title={emptyTitle} description={emptyDescription} />
        ) : (
          <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-bg-card">
            {sorted.map((i) => {
              const isSelected = selected?.id === i.id;
              return (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => void selectIdea(i.id)}
                    className={cn(
                      'flex w-full flex-col gap-1.5 px-4 py-3 text-left transition',
                      isSelected ? 'bg-accent/5' : 'hover:bg-bg-overlay/40',
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Chip variant="info" size="sm">
                        {IDEA_KIND_LABEL[i.kind]}
                      </Chip>
                      <Chip variant={IDEA_STATUS_CHIP[i.status]} size="sm">
                        {IDEA_STATUS_LABEL[i.status]}
                      </Chip>
                      <span className="ml-auto inline-flex items-center gap-1 text-xs text-fg-tertiary">
                        <Flame size={12} />
                        {i.weight.toFixed(1)} · {i.supporterCount}
                      </span>
                    </div>
                    <span className="line-clamp-2 text-sm font-medium text-fg-primary">
                      {i.statement}
                    </span>
                    <span className="text-xs text-fg-tertiary">
                      Впервые {i.firstProposedAt.toLocaleDateString('ru-RU')} ·
                      Последнее {i.lastDiscussedAt.toLocaleDateString('ru-RU')}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-border-subtle bg-bg-card p-5">
        {selected ? (
          <IdeaDetailPane
            idea={selected}
            onUpdated={(d) => setSelected(d)}
            onListChanged={onListRefresh}
          />
        ) : (
          <p className="text-sm text-fg-tertiary">
            Выберите идею слева, чтобы увидеть подробности.
          </p>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────── Деталь идеи ──────────────────────────────────

function IdeaDetailPane({
  idea,
  onUpdated,
  onListChanged,
}: {
  idea: IdeaDetail;
  onUpdated: (d: IdeaDetail) => void;
  onListChanged: () => Promise<void> | void;
}) {
  const [statusDialog, setStatusDialog] = useState<IdeaStatus | null>(null);
  const [statusReason, setStatusReason] = useState('');

  const refreshIdea = useCallback(async () => {
    try {
      const fresh = await ideasApi.getById(idea.id);
      onUpdated(mapIdeaDetail(fresh));
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Не удалось обновить идею',
      );
    }
  }, [idea.id, onUpdated]);

  const handleSupport = useCallback(async () => {
    try {
      const r = await ideasApi.support(idea.id);
      toast.success('Вы поддержали идею');
      await refreshIdea();
      await onListChanged();
      void r;
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Не удалось поддержать',
      );
    }
  }, [idea.id, refreshIdea, onListChanged]);

  const handleChangeStatus = useCallback(async () => {
    if (!statusDialog) return;
    try {
      await ideasApi.changeStatus(
        idea.id,
        statusDialog,
        statusReason.trim() || null,
      );
      toast.success(`Статус изменён: ${IDEA_STATUS_LABEL[statusDialog]}`);
      setStatusReason('');
      await refreshIdea();
      await onListChanged();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'forbidden') {
        toast.error('Изменять статус могут только owner / admin');
      } else {
        toast.error(
          e instanceof ApiError ? e.message : 'Не удалось изменить статус',
        );
      }
      throw e;
    }
  }, [idea.id, statusDialog, statusReason, refreshIdea, onListChanged]);

  const transitions = IDEA_STATUS_TRANSITIONS[idea.status];

  return (
    <article className="space-y-4">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Chip variant="info" size="sm">
            {IDEA_KIND_LABEL[idea.kind]}
          </Chip>
          <Chip variant={IDEA_STATUS_CHIP[idea.status]} size="sm">
            {IDEA_STATUS_LABEL[idea.status]}
          </Chip>
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-fg-tertiary">
            <Flame size={14} />
            вес {idea.weight.toFixed(1)}
          </span>
        </div>
        <h2 className="text-lg font-semibold">{idea.statement}</h2>
        {idea.rationale ? (
          <p className="text-sm text-fg-secondary">
            <span className="font-medium text-fg-primary">Обоснование: </span>
            {idea.rationale}
          </p>
        ) : null}
      </header>

      <section>
        <h3 className="mb-1.5 text-sm font-medium text-fg-primary">
          Поддерживают ({idea.supporters.length})
        </h3>
        {idea.supporters.length === 0 ? (
          <p className="text-xs text-fg-tertiary">Пока никто.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5 text-xs">
            {idea.supporters.map((s) => (
              <li
                key={`${s.kind}:${s.entityId}`}
                className="rounded-md bg-bg-overlay/60 px-2 py-1 text-fg-secondary"
              >
                {s.kind === 'person' ? 'Сотрудник' : 'Клиент'} ·{' '}
                <span className="text-fg-tertiary">
                  {s.entityId.slice(0, 8)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="text-xs text-fg-tertiary">
        Источников: {idea.sourceBlockIds.length} · Уверенность AI:{' '}
        {(idea.confidence * 100).toFixed(0)}%
      </section>

      {idea.statusReason ? (
        <section className="rounded-md border border-border-subtle bg-bg-overlay/30 p-3">
          <h4 className="mb-1 text-xs font-medium uppercase tracking-wider text-fg-tertiary">
            Причина последнего изменения статуса
          </h4>
          <p className="text-sm text-fg-secondary">{idea.statusReason}</p>
        </section>
      ) : null}

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-fg-primary">Действия</h3>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={() => void handleSupport()}
          >
            <ThumbsUp className="mr-1.5 h-3.5 w-3.5" />
            Поддержать
          </Button>
          {transitions.map((s) => (
            <Button
              key={s}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setStatusDialog(s)}
            >
              {IDEA_STATUS_LABEL[s]}
            </Button>
          ))}
        </div>
        {transitions.length === 0 ? (
          <p className="text-xs text-fg-tertiary">
            Это терминальный статус — изменить нельзя.
          </p>
        ) : null}
      </section>

      <ConfirmDialog
        open={statusDialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setStatusDialog(null);
            setStatusReason('');
          }
        }}
        title={
          statusDialog
            ? `Изменить статус: ${IDEA_STATUS_LABEL[statusDialog]}`
            : ''
        }
        description={
          <div className="space-y-2">
            <p>Опишите причину изменения (опционально):</p>
            <textarea
              value={statusReason}
              onChange={(e) => setStatusReason(e.target.value)}
              maxLength={1000}
              rows={3}
              className="w-full rounded-md border border-input bg-background p-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="Например: одобрено на встрече..."
              autoFocus
            />
          </div>
        }
        confirmLabel="Подтвердить"
        onConfirm={handleChangeStatus}
      />
    </article>
  );
}

function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
