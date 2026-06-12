'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, humanizeApiError } from '@/api/api-error';
import {
  decisionsApi,
  type DeadlineFilterApi,
  type DecisionStatusApi,
  type DecisionsListResponseApi,
} from '@/api/decisions.api';
import { useAuth } from '@/contexts/auth-context';
import {
  DECISION_STATUS_LABEL,
  DECISION_STATUS_TONE,
  type DecisionDetail,
  type DecisionSupersedeChain,
  mapDecisionDetail,
  mapDecisionSupersedeChain,
} from '@/domain/decision';
import { TrustBadge } from '@/ui/components/shared/TrustBadge';
import { CardCorrectionActions } from '@/ui/components/knowledge/CardCorrectionActions';
import { Input } from '@/ui/shadcn/input';

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '@app/(admin)/admin/AdminStateViews';

/**
 * Master-detail для `/decisions` (SBA β-3).
 *
 * Левая колонка — список (фильтры status / deadline / search).
 * Правая колонка — детальная карточка:
 *   - statement (h2), status badge, supersedes-цепочка
 *   - rationale (markdown как pre-wrap, на β-3 без markdown-рендера)
 *   - alternatives table
 *   - affects (entity chips — на β-3 показываем id-строки; маппинг на имена γ+)
 *   - provenance (sourceBlockIds count)
 *   - timeline для evolving (validFrom → validUntil)
 *   - actualOutcomes
 *   - Actions: Отметить как реализованным / Заменить новой версией / Отменить
 *
 * Действия supersede / changeStatus / setOutcomes выполняются с проверкой
 * RBAC на бэке — если у пользователя нет прав, появится сообщение об ошибке.
 */
export function DecisionsListClient({
  initialSelectedId,
}: { initialSelectedId?: string } = {}) {
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
  return <DecisionsListContent initialSelectedId={initialSelectedId} />;
}

const STATUS_FILTERS: ReadonlyArray<{
  value: 'all' | DecisionStatusApi;
  label: string;
}> = [
  { value: 'all', label: 'Все статусы' },
  { value: 'proposed', label: 'Предложенные' },
  { value: 'approved', label: 'Принятые' },
  { value: 'implemented', label: 'Реализованные' },
  { value: 'rejected', label: 'Отклонённые' },
  { value: 'cancelled', label: 'Отменённые' },
  { value: 'superseded', label: 'Заменённые' },
];

const DEADLINE_FILTERS: ReadonlyArray<{
  value: 'all' | DeadlineFilterApi;
  label: string;
}> = [
  { value: 'all', label: 'Все сроки' },
  { value: 'overdue', label: 'Просроченные' },
  { value: 'upcoming', label: 'Предстоящие' },
];

function DecisionsListContent({
  initialSelectedId,
}: { initialSelectedId?: string }) {
  const { currentOrgRole } = useAuth();
  const canApplyDirectly = ['owner', 'admin'].includes(currentOrgRole ?? '');
  const [data, setData] = useState<DecisionsListResponseApi | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | DecisionStatusApi>(
    'all',
  );
  const [deadlineFilter, setDeadlineFilter] = useState<'all' | DeadlineFilterApi>(
    'all',
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId ?? null,
  );
  const [detail, setDetail] = useState<DecisionDetail | null>(null);
  const [chain, setChain] = useState<DecisionSupersedeChain | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const dto = await decisionsApi.list({
        ...(q.trim() ? { q: q.trim() } : {}),
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(deadlineFilter !== 'all'
          ? { deadline_filter: deadlineFilter }
          : {}),
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
  }, [q, statusFilter, deadlineFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDetail = useCallback(async () => {
    if (!selectedId) return;
    setDetailLoading(true);
    setDetailError(null);
    setChain(null);
    try {
      const [detailDto, chainDto] = await Promise.all([
        decisionsApi.get(selectedId),
        decisionsApi.supersedeChain(selectedId),
      ]);
      setDetail(mapDecisionDetail(detailDto));
      setChain(mapDecisionSupersedeChain(chainDto));
    } catch (e) {
      setDetailError(humanizeApiError(e, 'Ошибка загрузки'));
    } finally {
      setDetailLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    if (selectedId) void loadDetail();
    else {
      setDetail(null);
      setChain(null);
    }
  }, [selectedId, loadDetail]);

  const handleChangeStatus = useCallback(
    async (newStatus: DecisionStatusApi) => {
      if (!selectedId) return;
      setActionMsg(null);
      try {
        await decisionsApi.changeStatus(selectedId, { newStatus });
        setActionMsg(`Статус изменён на «${DECISION_STATUS_LABEL[newStatus]}».`);
        await Promise.all([load(), loadDetail()]);
      } catch (e) {
        setActionMsg(
          e instanceof ApiError
            ? `Ошибка: ${e.message}`
            : 'Не удалось изменить статус.',
        );
      }
    },
    [selectedId, load, loadDetail],
  );

  const groupedItems = useMemo(() => data?.items ?? [], [data]);

  if (isLoading && !data) return <AdminLoading rows={6} />;
  if (forbidden) return <AdminForbidden />;
  if (error) return <AdminError message={error} onRetry={load} />;
  if (!data) return null;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Решения</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Реестр решений компании с обоснованием, альтернативами и историей
          версий. Всего: {data.total}. Показано: {data.items.length}.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setStatusFilter(f.value)}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              statusFilter === f.value
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
          placeholder="Поиск по сути, обоснованию или результату"
          className="max-w-md"
        />
        <select
          value={deadlineFilter}
          onChange={(e) =>
            setDeadlineFilter(e.target.value as 'all' | DeadlineFilterApi)
          }
          className="rounded-md border border-border-subtle bg-bg-card px-3 py-2 text-sm"
        >
          {DEADLINE_FILTERS.map((f) => (
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
              Решений пока нет. Они появятся автоматически, когда специалист
              3.3 обработает встречи и документы.
            </p>
          ) : (
            <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-bg-card">
              {groupedItems.map((d) => {
                const isSelected = selectedId === d.id;
                const overdue =
                  d.deadline &&
                  new Date(d.deadline) < new Date() &&
                  d.status !== 'implemented' &&
                  d.status !== 'cancelled' &&
                  d.status !== 'rejected' &&
                  d.status !== 'superseded';
                return (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(d.id)}
                      className={`flex w-full items-start justify-between px-4 py-3 text-left ${
                        isSelected ? 'bg-accent/5' : 'hover:bg-bg-hover'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <StatusBadge status={d.status} />
                          <TrustBadge tier={d.trustTier} size="sm" />
                          <span className="truncate">{d.statement}</span>
                        </div>
                        <div className="mt-1 text-xs text-fg-tertiary">
                          {d.decidedAt
                            ? new Date(d.decidedAt).toLocaleDateString('ru-RU')
                            : 'дата не указана'}
                          {d.deadline ? (
                            <span className={overdue ? 'ml-2 text-error' : 'ml-2'}>
                              · срок {new Date(d.deadline).toLocaleDateString('ru-RU')}
                              {overdue ? ' (просрочено)' : ''}
                            </span>
                          ) : null}
                          {d.supersedesId ? (
                            <span className="ml-2 text-fg-secondary">
                              · заменяет
                            </span>
                          ) : null}
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
          {!selectedId ? (
            <p className="text-sm text-fg-tertiary">
              Выберите решение слева, чтобы увидеть обоснование, альтернативы и
              цепочку версий.
            </p>
          ) : detailLoading ? (
            <AdminLoading rows={3} />
          ) : detailError ? (
            <AdminError message={detailError} onRetry={loadDetail} />
          ) : !detail ? null : (
            <article className="space-y-4">
              <header>
                <div className="flex items-center gap-2 text-xs text-fg-secondary">
                  <StatusBadge status={detail.status} />
                  <TrustBadge tier={detail.trustTier} size="sm" />
                  {detail.decidedAt ? (
                    <span>
                      Принято {detail.decidedAt.toLocaleDateString('ru-RU')}
                    </span>
                  ) : null}
                  {detail.deadline ? (
                    <span>· Срок {detail.deadline.toLocaleDateString('ru-RU')}</span>
                  ) : null}
                </div>
                <h2 className="mt-2 text-lg font-semibold">{detail.statement}</h2>
              </header>

              {chain && (chain.ancestors.length > 0 || chain.descendants.length > 0) ? (
                <section className="rounded border border-border-subtle bg-bg-muted/40 p-3">
                  <h3 className="text-xs font-medium text-fg-secondary">
                    Цепочка версий
                  </h3>
                  {chain.ancestors.length > 0 ? (
                    <div className="mt-2">
                      <div className="text-xs text-fg-tertiary">
                        Предыдущие версии:
                      </div>
                      <ul className="mt-1 space-y-1 text-xs">
                        {chain.ancestors.map((a) => (
                          <li key={a.id}>
                            <button
                              type="button"
                              onClick={() => setSelectedId(a.id)}
                              className="text-left text-accent hover:underline"
                            >
                              {a.statement.slice(0, 80)}…
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {chain.descendants.length > 0 ? (
                    <div className="mt-2">
                      <div className="text-xs text-fg-tertiary">
                        Заменено на:
                      </div>
                      <ul className="mt-1 space-y-1 text-xs">
                        {chain.descendants.map((d2) => (
                          <li key={d2.id}>
                            <button
                              type="button"
                              onClick={() => setSelectedId(d2.id)}
                              className="text-left text-accent hover:underline"
                            >
                              {d2.statement.slice(0, 80)}…
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {detail.rationale ? (
                <section>
                  <h3 className="text-sm font-medium">Обоснование</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-fg-primary">
                    {detail.rationale}
                  </p>
                </section>
              ) : null}

              {detail.alternatives.length > 0 ? (
                <section>
                  <h3 className="text-sm font-medium">Рассмотренные альтернативы</h3>
                  <ul className="mt-2 space-y-2 text-xs">
                    {detail.alternatives.map((a, i) => (
                      <li
                        key={i}
                        className="rounded border border-border-subtle p-2"
                      >
                        <div className="font-medium">{a.option}</div>
                        {a.reasonRejected ? (
                          <div className="mt-1 text-fg-secondary">
                            Почему отвергнуто: {a.reasonRejected}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {detail.affectsEntityIds.length > 0 ? (
                <section>
                  <h3 className="text-sm font-medium">На что влияет</h3>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {detail.affectsEntityIds.map((id) => (
                      <span
                        key={id}
                        className="rounded bg-bg-muted px-2 py-0.5 text-xs text-fg-secondary"
                      >
                        {id.slice(0, 12)}
                      </span>
                    ))}
                  </div>
                </section>
              ) : null}

              {detail.validFrom || detail.validUntil ? (
                <section className="text-xs text-fg-secondary">
                  <h3 className="text-sm font-medium text-fg-primary">
                    Действительно
                  </h3>
                  <div className="mt-1">
                    {detail.validFrom
                      ? `с ${detail.validFrom.toLocaleDateString('ru-RU')}`
                      : 'с — не указано'}
                    {detail.validUntil
                      ? ` до ${detail.validUntil.toLocaleDateString('ru-RU')}`
                      : detail.status === 'superseded'
                      ? ' (заменено)'
                      : ''}
                  </div>
                </section>
              ) : null}

              {detail.actualOutcomes ? (
                <section>
                  <h3 className="text-sm font-medium">Фактический результат</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-fg-primary">
                    {detail.actualOutcomes}
                  </p>
                </section>
              ) : null}

              <section className="text-xs text-fg-tertiary">
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
                {detail.status !== 'implemented' &&
                detail.status !== 'cancelled' ? (
                  <button
                    type="button"
                    onClick={() => handleChangeStatus('implemented')}
                    className="rounded-md border border-border-subtle bg-bg-muted px-3 py-1.5 text-xs hover:bg-bg-hover"
                  >
                    Отметить как реализованным
                  </button>
                ) : null}
                {detail.status !== 'cancelled' &&
                detail.status !== 'rejected' &&
                detail.status !== 'superseded' ? (
                  <button
                    type="button"
                    onClick={() => handleChangeStatus('cancelled')}
                    className="rounded-md border border-border-subtle bg-bg-muted px-3 py-1.5 text-xs hover:bg-bg-hover"
                  >
                    Отменить решение
                  </button>
                ) : null}
                <CardCorrectionActions
                  fields={[
                    {
                      key: 'statement',
                      label: 'Суть решения',
                      value: detail.statement,
                      multiline: true,
                    },
                    {
                      key: 'rationale',
                      label: 'Обоснование',
                      value: detail.rationale ?? '',
                      multiline: true,
                    },
                  ]}
                  canApplyDirectly={canApplyDirectly}
                  trustTier={detail.trustTier}
                  onCorrect={(values, reason) =>
                    decisionsApi
                      .correct(detail.id, {
                        correctedPayload: values,
                        ...(reason ? { reason } : {}),
                      })
                      .then((r) => ({ applied: r.applied }))
                  }
                  onDispute={(reason) =>
                    decisionsApi
                      .dispute(detail.id, { ...(reason ? { reason } : {}) })
                      .then(() => undefined)
                  }
                  onDone={() => {
                    void load();
                    void loadDetail();
                  }}
                />
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

function StatusBadge({ status }: { status: DecisionStatusApi }) {
  const label = DECISION_STATUS_LABEL[status];
  const tone = DECISION_STATUS_TONE[status];
  const cls = (() => {
    switch (tone) {
      case 'success':
        return 'bg-success/10 text-success';
      case 'error':
        return 'bg-error/10 text-error';
      case 'warning':
        return 'bg-warning/10 text-warning';
      case 'info':
        return 'bg-info/10 text-info';
      default:
        return 'bg-bg-muted text-fg-secondary';
    }
  })();
  return (
    <span className={`rounded px-2 py-0.5 text-xs ${cls}`}>{label}</span>
  );
}
