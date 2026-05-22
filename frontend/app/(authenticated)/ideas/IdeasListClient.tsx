'use client';

import { useCallback, useEffect, useMemo, useState, type JSX } from 'react';
import Link from 'next/link';

import { ApiError } from '@/api/api-error';
import {
  ideasApi,
  type IdeaDetailApi,
  type IdeaKindApi,
  type IdeaListItemApi,
  type IdeaStatusApi,
  type IdeasListResponseApi,
} from '@/api/ideas.api';
import { useAuth } from '@/contexts/auth-context';

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../admin/AdminStateViews';

const IDEA_KIND_RU: Record<IdeaKindApi, string> = {
  internal: 'Внутренняя',
  client_request: 'От клиента',
};
const IDEA_STATUS_RU: Record<IdeaStatusApi, string> = {
  captured: 'Собрана',
  in_discussion: 'В обсуждении',
  accepted: 'Принята',
  in_progress: 'В работе',
  shipped: 'Выпущена',
  rejected: 'Отклонена',
  archived: 'В архиве',
};

const ALL_STATUSES: ReadonlyArray<IdeaStatusApi> = [
  'captured',
  'in_discussion',
  'accepted',
  'in_progress',
  'shipped',
  'rejected',
  'archived',
];

type TabKey = 'internal' | 'client' | 'mine';

interface ListState {
  data: IdeasListResponseApi | null;
  isLoading: boolean;
  error: string | null;
  forbidden: boolean;
}

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
  const [tab, setTab] = useState<TabKey>('internal');
  const [statusFilter, setStatusFilter] = useState<'all' | IdeaStatusApi>('all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<IdeaDetailApi | null>(null);
  const [list, setList] = useState<ListState>({
    data: null,
    isLoading: true,
    error: null,
    forbidden: false,
  });

  const fetchList = useCallback(async (): Promise<void> => {
    setList((s) => ({ ...s, isLoading: true, error: null, forbidden: false }));
    try {
      let resp: IdeasListResponseApi;
      if (tab === 'mine') {
        resp = await ideasApi.myIdeas({
          role: 'author',
          page: 1,
          limit: 100,
        });
      } else {
        resp = await ideasApi.list({
          kind: tab === 'internal' ? 'internal' : 'client_request',
          status: statusFilter === 'all' ? undefined : statusFilter,
          q: q.trim() || undefined,
          page: 1,
          limit: 100,
        });
      }
      setList({ data: resp, isLoading: false, error: null, forbidden: false });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'forbidden') {
          setList({
            data: null,
            isLoading: false,
            error: null,
            forbidden: true,
          });
          return;
        }
        setList({
          data: null,
          isLoading: false,
          error: e.message,
          forbidden: false,
        });
        return;
      }
      setList({
        data: null,
        isLoading: false,
        error: e instanceof Error ? e.message : String(e),
        forbidden: false,
      });
    }
  }, [tab, statusFilter, q]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const selectIdea = useCallback(
    async (item: IdeaListItemApi): Promise<void> => {
      try {
        const detail = await ideasApi.getById(item.id);
        setSelected(detail);
      } catch (e) {
        setSelected(null);
        // eslint-disable-next-line no-console
        console.warn('ideas.getById failed', e);
      }
    },
    [],
  );

  const onChangeStatus = useCallback(
    async (newStatus: IdeaStatusApi, reason: string): Promise<void> => {
      if (!selected) return;
      try {
        await ideasApi.changeStatus(selected.id, newStatus, reason || null);
        const fresh = await ideasApi.getById(selected.id);
        setSelected(fresh);
        await fetchList();
      } catch (e) {
        alert(`Не удалось изменить статус: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [selected, fetchList],
  );

  const onSupport = useCallback(
    async (): Promise<void> => {
      if (!selected) return;
      try {
        await ideasApi.support(selected.id);
        const fresh = await ideasApi.getById(selected.id);
        setSelected(fresh);
        await fetchList();
      } catch (e) {
        alert(`Не удалось поддержать: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [selected, fetchList],
  );

  const onWithdraw = useCallback(
    async (): Promise<void> => {
      if (!selected) return;
      if (!confirm('Отозвать вашу идею? Она уйдёт в архив.')) return;
      try {
        await ideasApi.withdraw(selected.id);
        const fresh = await ideasApi.getById(selected.id);
        setSelected(fresh);
        await fetchList();
      } catch (e) {
        alert(`Не удалось отозвать: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [selected, fetchList],
  );

  if (list.forbidden) {
    return (
      <AdminForbidden
        title="Нет доступа"
        description="У вас нет прав на просмотр идей."
      />
    );
  }
  if (list.error) {
    return <AdminError message={list.error} onRetry={fetchList} />;
  }

  const items = list.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Идеи</h1>

      <div className="flex flex-wrap items-center gap-2">
        {(['internal', 'client', 'mine'] as TabKey[]).map((t) => (
          <button
            key={t}
            type="button"
            className={`rounded-md border px-3 py-1.5 text-sm ${
              tab === t
                ? 'border-blue-500 bg-blue-50 font-medium text-blue-700'
                : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
            }`}
            onClick={() => {
              setTab(t);
              setSelected(null);
            }}
          >
            {t === 'internal'
              ? 'Внутренние'
              : t === 'client'
                ? 'От клиентов'
                : 'Мои'}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | IdeaStatusApi)}
            className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-sm"
          >
            <option value="all">Любой статус</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {IDEA_STATUS_RU[s]}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск…"
            className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_2fr]">
        {/* List */}
        <div className="rounded-md border border-neutral-200 bg-white">
          {list.isLoading ? (
            <AdminLoading rows={4} />
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-sm text-neutral-500">
              {tab === 'mine' ? 'У вас нет идей.' : 'Идей пока нет.'}
            </div>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {items.map((i) => (
                <li
                  key={i.id}
                  className={`cursor-pointer p-3 hover:bg-neutral-50 ${
                    selected?.id === i.id ? 'bg-blue-50' : ''
                  }`}
                  onClick={() => void selectIdea(i)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 text-sm font-medium text-neutral-900">
                      {i.statement.length > 100
                        ? `${i.statement.slice(0, 100)}…`
                        : i.statement}
                    </div>
                    <div className="text-xs text-neutral-500">
                      вес {i.weight.toFixed(1)}
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-neutral-500">
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5">
                      {IDEA_KIND_RU[i.kind]}
                    </span>
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5">
                      {IDEA_STATUS_RU[i.status]}
                    </span>
                    <span>{i.supporterCount} поддержавших</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Detail */}
        <div className="rounded-md border border-neutral-200 bg-white p-4">
          {!selected ? (
            <div className="p-8 text-center text-sm text-neutral-500">
              Выберите идею слева
            </div>
          ) : (
            <IdeaDetailPane
              idea={selected}
              onChangeStatus={onChangeStatus}
              onSupport={onSupport}
              onWithdraw={onWithdraw}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function IdeaDetailPane(props: {
  idea: IdeaDetailApi;
  onChangeStatus: (newStatus: IdeaStatusApi, reason: string) => Promise<void>;
  onSupport: () => Promise<void>;
  onWithdraw: () => Promise<void>;
}): JSX.Element {
  const { idea, onChangeStatus, onSupport, onWithdraw } = props;
  const [reason, setReason] = useState('');
  const isAuthor = useMemo(() => {
    // Реальная проверка авторства — на сервере; здесь просто показываем кнопку.
    return true;
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-xs uppercase tracking-wide text-neutral-500">
          {IDEA_KIND_RU[idea.kind]} · {IDEA_STATUS_RU[idea.status]} · вес{' '}
          {idea.weight.toFixed(1)}
        </div>
        <h2 className="mt-1 text-xl font-semibold">{idea.statement}</h2>
        {idea.rationale ? (
          <p className="mt-2 text-sm text-neutral-700">{idea.rationale}</p>
        ) : null}
      </div>

      <div>
        <div className="text-sm font-medium text-neutral-700">
          Поддержавшие ({idea.supporters.length})
        </div>
        <ul className="mt-1 flex flex-wrap gap-2 text-xs">
          {idea.supporters.map((s) => (
            <li
              key={`${s.kind}:${s.entityId}`}
              className="rounded bg-neutral-100 px-2 py-1"
            >
              {s.kind === 'person' ? 'Сотрудник' : 'Клиент'} · {s.entityId.slice(0, 8)}
            </li>
          ))}
        </ul>
      </div>

      {idea.statusReason ? (
        <div>
          <div className="text-sm font-medium text-neutral-700">
            Причина последнего изменения статуса
          </div>
          <p className="mt-1 text-sm text-neutral-600">{idea.statusReason}</p>
        </div>
      ) : null}

      <div className="border-t border-neutral-100 pt-4">
        <div className="text-sm font-medium text-neutral-700">Действия</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Причина (опц.)"
            className="flex-1 rounded-md border border-neutral-200 bg-white px-2 py-1 text-sm"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {(['in_discussion', 'accepted', 'in_progress', 'shipped', 'rejected'] as IdeaStatusApi[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void onChangeStatus(s, reason)}
              disabled={idea.status === s}
              className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
            >
              → {IDEA_STATUS_RU[s]}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void onSupport()}
            className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
          >
            Поддержать
          </button>
          {isAuthor ? (
            <button
              type="button"
              onClick={() => void onWithdraw()}
              className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              Отозвать
            </button>
          ) : null}
        </div>
      </div>

      <div className="border-t border-neutral-100 pt-3 text-xs text-neutral-500">
        Кластер: {idea.clusterId ? <Link href={`/idea-clusters/${idea.clusterId}`} className="text-blue-600 underline">{idea.clusterId.slice(0, 8)}</Link> : '—'}
        {' · '}Источников: {idea.sourceBlockIds.length}
        {' · '}Уверенность: {(idea.confidence * 100).toFixed(0)}%
      </div>
    </div>
  );
}
