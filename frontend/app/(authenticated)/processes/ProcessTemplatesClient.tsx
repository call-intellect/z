'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, humanizeApiError } from '@/api/api-error';
import {
  crossFunctionalApi,
  processesApi,
  type CrossFunctionalFrictionReportApi,
  type CrossFunctionalProcessListItemApi,
  type ProcessTemplateStatusApi,
} from '@/api/processes.api';
import { useAuth } from '@/contexts/auth-context';
import { useConfirmDialog } from '@/ui/components/shared/useConfirmDialog';
import {
  PROCESS_HANDOFF_KIND_LABEL,
  PROCESS_TEMPLATE_STATUS_LABEL,
  PROCESS_TEMPLATE_VERSION_SOURCE_LABEL,
  mapProcessTemplateDetail,
  mapProcessTemplatesList,
  type ProcessTemplateDetail,
  type ProcessTemplateListItem,
} from '@/domain/process-template';
import { Input } from '@/ui/shadcn/input';

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '@app/(admin)/admin/AdminStateViews';

const STATUS_FILTERS: ReadonlyArray<{
  value: 'all' | ProcessTemplateStatusApi;
  label: string;
}> = [
  { value: 'all', label: 'Все статусы' },
  { value: 'active', label: 'Действующие' },
  { value: 'deprecated', label: 'Устаревшие' },
  { value: 'archived', label: 'Архив' },
];

type DetailTab = 'steps' | 'decisions' | 'handoffs' | 'versions' | 'completeness';

const TABS: ReadonlyArray<{ key: DetailTab; label: string }> = [
  { key: 'steps', label: 'Шаги' },
  { key: 'decisions', label: 'Решения' },
  { key: 'handoffs', label: 'Хэндоффы' },
  { key: 'versions', label: 'Версии' },
  { key: 'completeness', label: 'Полнота' },
];

type TopTab = 'local' | 'cross-functional';

const TOP_TABS: ReadonlyArray<{ key: TopTab; label: string }> = [
  { key: 'local', label: 'Локальные' },
  { key: 'cross-functional', label: 'Сквозные' },
];

const SEVERITY_LABEL: Record<'low' | 'medium' | 'high', string> = {
  low: 'Низкая',
  medium: 'Средняя',
  high: 'Высокая',
};

const SEVERITY_COLOR: Record<'low' | 'medium' | 'high', string> = {
  low: 'bg-chip-success-bg text-chip-success-fg',
  medium: 'bg-chip-warning-bg text-chip-warning-fg',
  high: 'bg-chip-danger-bg text-chip-danger-fg',
};

export function ProcessTemplatesClient() {
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
  return <ProcessTemplatesShell />;
}

function ProcessTemplatesShell() {
  const [topTab, setTopTab] = useState<TopTab>('local');
  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Шаблоны процессов</h1>
          <p className="mt-1 text-sm text-fg-secondary">
            «Локальные» — все шаблоны. «Сквозные» — те, что проходят через
            несколько отделов, с трекером слабых мест между командами.
          </p>
        </div>
      </header>
      <nav className="mb-6 flex gap-2 border-b border-border-subtle">
        {TOP_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setTopTab(tab.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
              topTab === tab.key
                ? 'border-accent text-accent'
                : 'border-transparent text-fg-secondary hover:text-fg-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      {topTab === 'local' ? <LocalContent /> : <CrossFunctionalContent />}
    </div>
  );
}

function LocalContent() {
  const [items, setItems] = useState<ProcessTemplateListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] =
    useState<'all' | ProcessTemplateStatusApi>('all');
  const [completenessMin, setCompletenessMin] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProcessTemplateDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('steps');
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { ask, dialog: confirmDialog } = useConfirmDialog();

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const dto = await processesApi.list({
        ...(q.trim() ? { q: q.trim() } : {}),
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(completenessMin != null ? { completenessMin } : {}),
        limit: 50,
      });
      const mapped = mapProcessTemplatesList(dto);
      setItems(mapped.items);
      setTotal(mapped.total);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'forbidden') {
        setForbidden(true);
      } else {
        setError(humanizeApiError(e, 'Ошибка загрузки'));
      }
    } finally {
      setIsLoading(false);
    }
  }, [q, statusFilter, completenessMin]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDetail = useCallback(async () => {
    if (!selectedId) return;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const dto = await processesApi.get(selectedId);
      setDetail(mapProcessTemplateDetail(dto));
    } catch (e) {
      setDetailError(humanizeApiError(e, 'Ошибка загрузки'));
    } finally {
      setDetailLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    if (selectedId) {
      void loadDetail();
    } else {
      setDetail(null);
    }
  }, [selectedId, loadDetail]);

  const handleCreate = useCallback(async () => {
    const name = window.prompt('Имя нового шаблона процесса (черновик):');
    if (!name) return;
    setCreating(true);
    setActionMsg(null);
    try {
      const dto = await processesApi.create({ name: name.trim() });
      setActionMsg(`Черновик создан: ${dto.name}.`);
      await load();
      setSelectedId(dto.id);
    } catch (e) {
      setActionMsg(
        e instanceof ApiError ? `Ошибка: ${e.message}` : 'Не удалось создать.',
      );
    } finally {
      setCreating(false);
    }
  }, [load]);

  const handleArchive = useCallback(async () => {
    if (!selectedId) return;
    const ok = await ask({
      title: 'Архивировать шаблон процесса?',
      confirmLabel: 'Архивировать',
      destructive: true,
    });
    if (!ok) return;
    setActionMsg(null);
    try {
      await processesApi.remove(selectedId);
      setActionMsg('Шаблон перемещён в архив.');
      setSelectedId(null);
      await load();
    } catch (e) {
      setActionMsg(
        e instanceof ApiError
          ? `Ошибка: ${e.message}`
          : 'Не удалось архивировать.',
      );
    }
  }, [ask, selectedId, load]);

  const groupedItems = useMemo(() => items, [items]);

  if (isLoading && items.length === 0) return <AdminLoading rows={6} />;
  if (forbidden) return <AdminForbidden />;
  if (error) return <AdminError message={error} onRetry={load} />;

  return (
    <div>
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-fg-secondary">
            Всего: {total}. Показано: {items.length}. Автоматически собираются
            из встреч и документов (процесс-детектор).
          </p>
        </div>
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="rounded-md border border-accent bg-accent/10 px-3 py-2 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
        >
          {creating ? 'Создаём…' : 'Создать вручную'}
        </button>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск по названию или сводке"
          className="max-w-md"
        />
        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as 'all' | ProcessTemplateStatusApi)
          }
          className="rounded-md border border-border-subtle bg-bg-card px-3 py-2 text-sm"
        >
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <select
          value={completenessMin == null ? '' : String(completenessMin)}
          onChange={(e) => {
            const v = e.target.value;
            setCompletenessMin(v ? Number(v) : null);
          }}
          className="rounded-md border border-border-subtle bg-bg-card px-3 py-2 text-sm"
        >
          <option value="">Любая полнота</option>
          <option value="0.25">≥ 25%</option>
          <option value="0.5">≥ 50%</option>
          <option value="0.75">≥ 75%</option>
        </select>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_2fr]">
        {/* Левая колонка: список */}
        <div>
          {groupedItems.length === 0 ? (
            <p className="text-sm text-fg-tertiary">
              Шаблонов процессов пока нет. Они появятся автоматически, когда
              process-detector обработает свежие встречи. Можно создать вручную.
            </p>
          ) : (
            <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-bg-card">
              {groupedItems.map((t) => {
                const isSelected = selectedId === t.id;
                const pct = Math.round(t.completeness * 100);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      className={`flex w-full items-start justify-between px-4 py-3 text-left ${
                        isSelected ? 'bg-accent/5' : 'hover:bg-bg-hover'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <span className="rounded bg-bg-muted px-2 py-0.5 text-xs text-fg-secondary">
                            {PROCESS_TEMPLATE_STATUS_LABEL[t.status]}
                          </span>
                          <span className="truncate">{t.name}</span>
                        </div>
                        {t.summary ? (
                          <div className="mt-1 truncate text-xs text-fg-tertiary">
                            {t.summary}
                          </div>
                        ) : null}
                        <div className="mt-1 text-xs text-fg-tertiary">
                          Полнота: {pct}% · Шагов: {t.stepsCount} · Решений:{' '}
                          {t.decisionPointsCount} · Хэндоффов: {t.handoffsCount}
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
              Выберите шаблон слева, чтобы увидеть детали (шаги, решения,
              хэндоффы, версии, полноту).
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
                    {PROCESS_TEMPLATE_STATUS_LABEL[detail.status]}
                  </span>
                  {detail.category ? <span>· {detail.category}</span> : null}
                  {detail.scope ? <span>· {detail.scope}</span> : null}
                </div>
                <h2 className="mt-2 text-lg font-semibold">{detail.name}</h2>
                {detail.summary ? (
                  <p className="mt-1 text-sm text-fg-secondary">
                    {detail.summary}
                  </p>
                ) : null}
              </header>

              <nav className="flex flex-wrap gap-1 border-b border-border-subtle">
                {TABS.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`-mb-px border-b-2 px-3 py-1.5 text-xs transition ${
                      activeTab === tab.key
                        ? 'border-accent text-accent'
                        : 'border-transparent text-fg-secondary hover:text-fg-primary'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>

              {activeTab === 'steps' && (
                <StepsTab detail={detail} />
              )}
              {activeTab === 'decisions' && (
                <DecisionsTab detail={detail} />
              )}
              {activeTab === 'handoffs' && (
                <HandoffsTab detail={detail} />
              )}
              {activeTab === 'versions' && (
                <VersionsTab templateId={detail.id} />
              )}
              {activeTab === 'completeness' && (
                <CompletenessTab detail={detail} />
              )}

              <div className="mt-4 flex flex-wrap gap-2 border-t border-border-subtle pt-4">
                <button
                  type="button"
                  onClick={handleArchive}
                  className="rounded-md border border-border-subtle bg-bg-muted px-3 py-1.5 text-xs hover:bg-bg-hover"
                >
                  Архивировать
                </button>
              </div>

              {actionMsg ? (
                <p className="mt-2 text-xs text-fg-secondary">{actionMsg}</p>
              ) : null}
            </article>
          )}
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}

// ─────────────────────────── Cross-Functional ─────────────────────

function CrossFunctionalContent() {
  const [items, setItems] = useState<CrossFunctionalProcessListItemApi[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const dto = await crossFunctionalApi.list({
        ...(q.trim() ? { q: q.trim() } : {}),
        limit: 100,
      });
      setItems(dto.items);
      setTotal(dto.total);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'forbidden') {
        setForbidden(true);
      } else {
        setError(humanizeApiError(e, 'Ошибка загрузки'));
      }
    } finally {
      setIsLoading(false);
    }
  }, [q]);

  useEffect(() => {
    void load();
  }, [load]);

  if (forbidden) return <AdminForbidden />;
  if (error) return <AdminError message={error} onRetry={load} />;
  if (isLoading && items.length === 0) return <AdminLoading rows={4} />;

  return (
    <div>
      <p className="mb-4 text-sm text-fg-secondary">
        Всего сквозных процессов: {total}. Показаны те, у которых
        `crossFunctionalScore ≥ порога` (детектор пересчитывается при
        изменении шаблона). Цифра справа — активные friction-отчёты.
      </p>
      <div className="mb-4">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск по сквозным шаблонам"
          className="max-w-md"
        />
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_2fr]">
        <div>
          {items.length === 0 ? (
            <p className="text-sm text-fg-tertiary">
              Сквозных шаблонов пока нет. Они появятся автоматически, как
              только в шагах будут owner'ы из разных отделов.
            </p>
          ) : (
            <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-bg-card">
              {items.map((t) => {
                const isSelected = selectedId === t.id;
                const scorePct =
                  t.crossFunctionalScore == null
                    ? '—'
                    : `${Math.round(t.crossFunctionalScore * 100)}%`;
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      className={`flex w-full items-start justify-between gap-3 px-4 py-3 text-left ${
                        isSelected ? 'bg-accent/5' : 'hover:bg-bg-hover'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">
                          {t.name}
                        </div>
                        {t.summary ? (
                          <div className="mt-1 truncate text-xs text-fg-tertiary">
                            {t.summary}
                          </div>
                        ) : null}
                        <div className="mt-1 text-xs text-fg-tertiary">
                          Сквозность: {scorePct}
                          {t.activeFrictionCount > 0
                            ? ` · ${t.activeFrictionCount} активных friction`
                            : ''}
                        </div>
                      </div>
                      {t.activeFrictionCount > 0 ? (
                        <span className="rounded bg-chip-danger-bg px-2 py-0.5 text-xs font-medium text-chip-danger-fg">
                          {t.activeFrictionCount}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="rounded-lg border border-border-subtle bg-bg-card p-5">
          {!selectedId ? (
            <p className="text-sm text-fg-tertiary">
              Выберите сквозной шаблон слева, чтобы увидеть отчёты по
              слабым местам между командами.
            </p>
          ) : (
            <CrossFunctionalFrictionPanel
              templateId={selectedId}
              onResolved={() => load()}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function CrossFunctionalFrictionPanel({
  templateId,
  onResolved,
}: {
  templateId: string;
  onResolved: () => void;
}) {
  const [reports, setReports] = useState<CrossFunctionalFrictionReportApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [includeResolved, setIncludeResolved] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const { ask, dialog: confirmDialog } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const dto = await crossFunctionalApi.listFriction(templateId, {
        includeResolved,
      });
      setReports(dto.items);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [templateId, includeResolved]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleResolve = useCallback(
    async (reportId: string) => {
      const ok = await ask({
        title: 'Закрыть friction-отчёт?',
        confirmLabel: 'Закрыть',
      });
      if (!ok) return;
      setActionMsg(null);
      try {
        await crossFunctionalApi.resolveFriction(reportId);
        setActionMsg('Отчёт закрыт.');
        await load();
        onResolved();
      } catch (e) {
        setActionMsg(
          e instanceof ApiError
            ? `Ошибка: ${e.message}`
            : 'Не удалось закрыть.',
        );
      }
    },
    [ask, load, onResolved],
  );

  return (
    <div className="space-y-3">
      <header className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">Friction-отчёты</h3>
        <label className="flex items-center gap-2 text-xs text-fg-secondary">
          <input
            type="checkbox"
            checked={includeResolved}
            onChange={(e) => setIncludeResolved(e.target.checked)}
          />
          Показывать закрытые
        </label>
      </header>
      {loading ? (
        <AdminLoading rows={2} />
      ) : err ? (
        <p className="text-sm text-fg-tertiary">Ошибка: {err}</p>
      ) : reports.length === 0 ? (
        <p className="text-sm text-fg-tertiary">
          У этого сквозного процесса нет открытых friction-отчётов.
        </p>
      ) : (
        <ul className="space-y-2">
          {reports.map((r) => (
            <li
              key={r.id}
              className="rounded border border-border-subtle p-3 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${SEVERITY_COLOR[r.severity]}`}
                >
                  {SEVERITY_LABEL[r.severity]}
                </span>
                {r.resolvedAt ? (
                  <span className="text-xs text-fg-tertiary">
                    Закрыт {new Date(r.resolvedAt).toLocaleDateString('ru-RU')}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleResolve(r.id)}
                    className="rounded-md border border-border-subtle bg-bg-muted px-2 py-1 text-xs hover:bg-bg-hover"
                  >
                    Закрыть
                  </button>
                )}
              </div>
              <div className="mt-2 whitespace-pre-line text-sm text-fg-primary">
                {r.description}
              </div>
              {r.recommendedAction ? (
                <div className="mt-2 text-xs text-fg-secondary">
                  Что делать: {r.recommendedAction}
                </div>
              ) : null}
              {r.involvedDepartmentIds.length > 0 ? (
                <div className="mt-1 text-xs text-fg-tertiary">
                  Вовлечены отделы: {r.involvedDepartmentIds.join(', ')}
                </div>
              ) : null}
              {r.sourceBlockIds.length > 0 ? (
                <div className="mt-1 text-xs text-fg-tertiary">
                  Источников (блоков): {r.sourceBlockIds.length}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {actionMsg ? (
        <p className="text-xs text-fg-secondary">{actionMsg}</p>
      ) : null}
      {confirmDialog}
    </div>
  );
}

// ─────────────────────────── tabs (existing) ────────────────────────

function StepsTab({ detail }: { detail: ProcessTemplateDetail }) {
  const steps = detail.currentVersion?.definition.steps ?? [];
  if (steps.length === 0) {
    return (
      <p className="text-sm text-fg-tertiary">
        У шаблона пока нет шагов. Когда process-detector обработает свежие
        блоки, шаги появятся автоматически как новая версия.
      </p>
    );
  }
  return (
    <ol className="space-y-2">
      {steps.map((s) => (
        <li
          key={s.order}
          className="rounded border border-border-subtle p-2 text-xs"
        >
          <div className="font-medium">
            {s.order}. {s.name}
          </div>
          {s.description ? (
            <div className="mt-1 text-fg-secondary">{s.description}</div>
          ) : null}
          <div className="mt-1 flex flex-wrap gap-2 text-fg-tertiary">
            {s.inputArtifact ? <span>Вход: {s.inputArtifact}</span> : null}
            {s.outputArtifact ? <span>Выход: {s.outputArtifact}</span> : null}
            {s.ownerRoleId ? <span>Owner: {s.ownerRoleId}</span> : null}
            {s.slaMinutes ? <span>SLA: {s.slaMinutes} мин.</span> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function DecisionsTab({ detail }: { detail: ProcessTemplateDetail }) {
  if (detail.decisionPoints.length === 0) {
    return (
      <p className="text-sm text-fg-tertiary">
        В шаблоне нет точек принятия решений.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {detail.decisionPoints.map((dp) => (
        <li
          key={dp.id}
          className="rounded border border-border-subtle p-2 text-xs"
        >
          <div className="font-medium">
            {dp.order}. {dp.name}
          </div>
          {dp.condition ? (
            <div className="mt-1 text-fg-secondary">Условие: {dp.condition}</div>
          ) : null}
          {dp.branches.length > 0 ? (
            <div className="mt-1 text-fg-tertiary">
              Ветви:{' '}
              {dp.branches.map((b) => b.name).join(' · ')}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function HandoffsTab({ detail }: { detail: ProcessTemplateDetail }) {
  const all = [
    ...detail.handoffsFrom.map((h) => ({ ...h, direction: 'out' as const })),
    ...detail.handoffsTo.map((h) => ({ ...h, direction: 'in' as const })),
  ];
  if (all.length === 0) {
    return (
      <p className="text-sm text-fg-tertiary">
        У шаблона нет связанных хэндоффов с другими процессами или ролями.
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {all.map((h) => (
        <li
          key={`${h.direction}-${h.id}`}
          className="rounded border border-border-subtle p-2 text-xs"
        >
          <div className="font-medium">
            {h.direction === 'out' ? 'Исходящий' : 'Входящий'} ·{' '}
            {PROCESS_HANDOFF_KIND_LABEL[h.kind]}
          </div>
          {h.payloadDescription ? (
            <div className="mt-1 text-fg-secondary">{h.payloadDescription}</div>
          ) : null}
          {h.expectedSlaHours ? (
            <div className="mt-1 text-fg-tertiary">
              SLA: {h.expectedSlaHours} ч.
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function VersionsTab({ templateId }: { templateId: string }) {
  const [versions, setVersions] = useState<
    Array<{
      id: string;
      version: number;
      source: string;
      changeNote: string | null;
      createdAt: string;
    }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setErr(null);
    processesApi
      .listVersions(templateId)
      .then((dto) => {
        if (canceled) return;
        setVersions(
          dto.items.map((v) => ({
            id: v.id,
            version: v.version,
            source: v.source,
            changeNote: v.changeNote,
            createdAt: v.createdAt,
          })),
        );
      })
      .catch((e) => {
        if (!canceled) setErr(e instanceof ApiError ? e.message : String(e));
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [templateId]);

  if (loading) return <AdminLoading rows={2} />;
  if (err) return <p className="text-sm text-fg-tertiary">Ошибка: {err}</p>;
  if (versions.length === 0) {
    return <p className="text-sm text-fg-tertiary">История версий пуста.</p>;
  }
  return (
    <ul className="space-y-2">
      {versions.map((v) => (
        <li key={v.id} className="rounded border border-border-subtle p-2 text-xs">
          <div className="font-medium">Версия {v.version}</div>
          <div className="mt-1 text-fg-tertiary">
            Источник:{' '}
            {PROCESS_TEMPLATE_VERSION_SOURCE_LABEL[
              v.source as keyof typeof PROCESS_TEMPLATE_VERSION_SOURCE_LABEL
            ] ?? v.source}
            {' · '}
            {new Date(v.createdAt).toLocaleString('ru-RU')}
          </div>
          {v.changeNote ? (
            <div className="mt-1 text-fg-secondary">{v.changeNote}</div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function CompletenessTab({ detail }: { detail: ProcessTemplateDetail }) {
  const pct = Math.round(detail.completeness * 100);
  return (
    <div className="space-y-2 text-xs">
      <div className="text-sm font-medium">Полнота шаблона: {pct}%</div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-bg-muted">
        <div
          className="h-full bg-accent transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-fg-secondary">
        <li>Шагов в текущей версии: {detail.stepsCount}</li>
        <li>Точек принятия решений: {detail.decisionPointsCount}</li>
        <li>
          Хэндоффов: исходящих {detail.handoffsFrom.length}, входящих{' '}
          {detail.handoffsTo.length}
        </li>
        <li>
          Источников (Idea-блоков): {detail.sourceBlockIds.length}
        </li>
        <li>
          Подтверждено:{' '}
          {detail.lastConfirmedAt
            ? detail.lastConfirmedAt.toLocaleDateString('ru-RU')
            : '—'}
        </li>
      </ul>
      <p className="mt-2 text-fg-tertiary">
        Полнота пересчитывается ежедневно (cron) и при изменениях шаблона.
        Когда у шагов нет владельцев или артефактов — приходят probe-уведомления.
      </p>
    </div>
  );
}
