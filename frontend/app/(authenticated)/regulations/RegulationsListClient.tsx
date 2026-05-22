'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError } from '@/api/api-error';
import {
  regulationsApi,
  type RegulationKindApi,
  type RegulationStatusApi,
  type RegulationsListResponseApi,
} from '@/api/regulations.api';
import { useAuth } from '@/contexts/auth-context';
import {
  POLICY_SEVERITY_LABEL,
  REGULATION_KIND_LABEL,
  REGULATION_STATUS_LABEL,
  type RegulationDetail,
  mapRegulationDetail,
} from '@/domain/regulation';
import { Input } from '@/ui/shadcn/input';

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../admin/AdminStateViews';

/**
 * Master-detail для `/regulations` (SBA α-7).
 *
 * Левая колонка — список (фильтры kind / status / scope / search).
 * Правая колонка — детальная карточка (markdown render statement,
 * список шагов для process, действия supersede/confirm).
 *
 * Действия supersede / confirm выполняются с проверкой RBAC на бэке —
 * если у пользователя нет прав, появится тост-ошибка (через apiClient).
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
  { value: 'all', label: 'Все' },
  { value: 'regulation', label: 'Регламенты' },
  { value: 'process', label: 'Процессы' },
  { value: 'policy', label: 'Политики' },
  { value: 'standard', label: 'Стандарты' },
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

function RegulationsListContent() {
  const [data, setData] = useState<RegulationsListResponseApi | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [q, setQ] = useState('');
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
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const dto = await regulationsApi.list({
        ...(q.trim() ? { q: q.trim() } : {}),
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
  }, [q, kindFilter, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDetail = useCallback(async () => {
    if (!selected) return;
    setDetailLoading(true);
    setDetailError(null);
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
    setActionMsg(null);
    try {
      await regulationsApi.confirm(selected.id, { kind: selected.kind });
      setActionMsg('Актуальность подтверждена.');
      await loadDetail();
    } catch (e) {
      setActionMsg(
        e instanceof ApiError
          ? `Ошибка: ${e.message}`
          : 'Не удалось подтвердить.',
      );
    }
  }, [selected, loadDetail]);

  const groupedItems = useMemo(() => data?.items ?? [], [data]);

  if (isLoading && !data) return <AdminLoading rows={6} />;
  if (forbidden) return <AdminForbidden />;
  if (error) return <AdminError message={error} onRetry={load} />;
  if (!data) return null;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Регламенты, процессы, политики</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Всего: {data.total}. Показано: {data.items.length}.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap gap-2">
        {KIND_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setKindFilter(f.value)}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              kindFilter === f.value
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-border-subtle text-fg-secondary hover:border-border-strong'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск по названию или содержанию"
          className="max-w-md"
        />
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

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {/* Левая колонка: список */}
        <div>
          {groupedItems.length === 0 ? (
            <p className="text-sm text-fg-tertiary">
              Ничего не найдено. Регламенты автоматически появятся, когда
              специалист 3.1 (Регламенты) обработает свежие встречи.
            </p>
          ) : (
            <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-bg-card">
              {groupedItems.map((r) => {
                const isSelected =
                  selected?.id === r.id && selected.kind === r.kind;
                return (
                  <li key={`${r.kind}:${r.id}`}>
                    <button
                      type="button"
                      onClick={() => setSelected({ id: r.id, kind: r.kind })}
                      className={`flex w-full items-start justify-between px-4 py-3 text-left ${
                        isSelected ? 'bg-accent/5' : 'hover:bg-bg-hover'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <span className="rounded bg-bg-muted px-2 py-0.5 text-xs text-fg-secondary">
                            {REGULATION_KIND_LABEL[r.kind]}
                          </span>
                          <span className="truncate">{r.name}</span>
                        </div>
                        <div className="mt-1 truncate text-xs text-fg-tertiary">
                          {r.statement ?? '—'}
                        </div>
                        <div className="mt-1 text-xs text-fg-tertiary">
                          {REGULATION_STATUS_LABEL[r.status]}
                          {r.scope ? ` · ${r.scope}` : ''}
                          {r.kind === 'policy' && r.severity
                            ? ` · ${POLICY_SEVERITY_LABEL[r.severity]}`
                            : ''}
                        </div>
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
            <article className="space-y-3">
              <header>
                <div className="flex items-center gap-2 text-xs text-fg-secondary">
                  <span className="rounded bg-bg-muted px-2 py-0.5">
                    {REGULATION_KIND_LABEL[detail.kind]}
                  </span>
                  <span>{REGULATION_STATUS_LABEL[detail.status]}</span>
                  {detail.scope ? <span>· {detail.scope}</span> : null}
                  {detail.kind === 'policy' && detail.severity ? (
                    <span>· {POLICY_SEVERITY_LABEL[detail.severity]}</span>
                  ) : null}
                </div>
                <h2 className="mt-2 text-lg font-semibold">{detail.name}</h2>
              </header>

              {detail.statement ? (
                <p className="whitespace-pre-wrap text-sm text-fg-primary">
                  {detail.statement}
                </p>
              ) : null}

              {detail.contentMd && detail.contentMd !== detail.statement ? (
                <details>
                  <summary className="cursor-pointer text-xs text-fg-secondary">
                    Полное содержание
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap rounded bg-bg-muted p-3 text-xs">
                    {detail.contentMd}
                  </pre>
                </details>
              ) : null}

              {detail.steps && detail.steps.length > 0 ? (
                <section>
                  <h3 className="mt-4 text-sm font-medium">Шаги процесса</h3>
                  <ol className="mt-2 space-y-2">
                    {detail.steps.map((s) => (
                      <li key={s.id} className="rounded border border-border-subtle p-2 text-xs">
                        <div className="font-medium">
                          {s.order}. {s.name}
                        </div>
                        {s.description ? (
                          <div className="mt-1 text-fg-secondary">
                            {s.description}
                          </div>
                        ) : null}
                        {s.slaMinutes ? (
                          <div className="mt-1 text-fg-tertiary">
                            SLA: {s.slaMinutes} мин.
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}

              <section className="text-xs text-fg-tertiary">
                <div>
                  Подтверждено:{' '}
                  {detail.lastConfirmedAt
                    ? detail.lastConfirmedAt.toLocaleDateString('ru-RU')
                    : '—'}
                </div>
                <div>
                  Источники:{' '}
                  {detail.sourceBlockIds.length > 0
                    ? `${detail.sourceBlockIds.length} блок(ов) знаний`
                    : '—'}
                </div>
                {detail.confidence !== null ? (
                  <div>
                    Уверенность извлечения:{' '}
                    {(detail.confidence * 100).toFixed(0)}%
                  </div>
                ) : null}
              </section>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleConfirm}
                  className="rounded-md border border-border-subtle bg-bg-muted px-3 py-1.5 text-xs hover:bg-bg-hover"
                >
                  Подтвердить актуальность
                </button>
              </div>

              {actionMsg ? (
                <p className="mt-2 text-xs text-fg-secondary">{actionMsg}</p>
              ) : null}
            </article>
          )}
        </div>
      </div>
    </div>
  );
}
