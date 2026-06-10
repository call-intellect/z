'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { ApiError } from '@/api/api-error';
import {
  insightsApi,
  type InsightDynamicApi,
  type InsightKindApi,
  type InsightSeverityApi,
  type InsightStatusApi,
  type InsightsChartResponseApi,
  type InsightsListResponseApi,
} from '@/api/insights.api';
import { useAuth } from '@/contexts/auth-context';
import {
  INSIGHT_DYNAMIC_LABEL,
  INSIGHT_DYNAMIC_TONE,
  INSIGHT_KIND_LABEL,
  INSIGHT_SEVERITY_LABEL,
  INSIGHT_SEVERITY_TONE,
  INSIGHT_STATUS_LABEL,
  INSIGHT_STATUS_TONE,
  mapInsightDetail,
  type InsightDetail,
} from '@/domain/insight';
import { Input } from '@/ui/shadcn/input';

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '@app/(admin)/admin/AdminStateViews';

/**
 * Master-detail для `/insights` (SBA β-4).
 *
 * Слева — chart-виджет stacked-bar + список сигналов с фильтрами.
 * Справа — детальная карточка: статус / острота / dynamicLabel / частота /
 * affected entities / related decisions / mitigation plan (editable для
 * owner/admin) / provenance / actions.
 */
export function InsightsListClient() {
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
  return <InsightsListContent />;
}

const KIND_FILTERS: ReadonlyArray<{
  value: 'all' | InsightKindApi;
  label: string;
}> = [
  { value: 'all', label: 'Все типы' },
  { value: 'problem', label: 'Проблемы' },
  { value: 'risk', label: 'Риски' },
  { value: 'blocker', label: 'Блокеры' },
  { value: 'inefficiency', label: 'Неэффективность' },
];

const SEVERITY_FILTERS: ReadonlyArray<{
  value: 'all' | InsightSeverityApi;
  label: string;
}> = [
  { value: 'all', label: 'Любая острота' },
  { value: 'critical', label: 'Критическая' },
  { value: 'high', label: 'Высокая' },
  { value: 'medium', label: 'Средняя' },
  { value: 'low', label: 'Низкая' },
];

const STATUS_FILTERS: ReadonlyArray<{
  value: 'all' | InsightStatusApi;
  label: string;
}> = [
  { value: 'all', label: 'Любой статус' },
  { value: 'active', label: 'Активные' },
  { value: 'mitigating', label: 'В работе' },
  { value: 'mitigated', label: 'Решённые' },
  { value: 'archived', label: 'В архиве' },
  { value: 'false_alarm', label: 'Ложные тревоги' },
];

const DYNAMIC_FILTERS: ReadonlyArray<{
  value: 'all' | InsightDynamicApi;
  label: string;
}> = [
  { value: 'all', label: 'Любая динамика' },
  { value: 'spike', label: 'Всплеск' },
  { value: 'growing', label: 'Растёт' },
  { value: 'stable', label: 'Стабильно' },
  { value: 'declining', label: 'Снижается' },
];

const KIND_COLORS: Record<InsightKindApi, string> = {
  problem: '#ef4444',
  risk: '#f59e0b',
  blocker: '#a855f7',
  inefficiency: '#3b82f6',
};

function InsightsListContent() {
  const [data, setData] = useState<InsightsListResponseApi | null>(null);
  const [chart, setChart] = useState<InsightsChartResponseApi | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [q, setQ] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | InsightKindApi>('all');
  const [severityFilter, setSeverityFilter] = useState<
    'all' | InsightSeverityApi
  >('all');
  const [statusFilter, setStatusFilter] = useState<'all' | InsightStatusApi>(
    'all',
  );
  const [dynamicFilter, setDynamicFilter] = useState<'all' | InsightDynamicApi>(
    'all',
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InsightDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [mitigationDraft, setMitigationDraft] = useState<string>('');

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const [list, chartDto] = await Promise.all([
        insightsApi.list({
          ...(q.trim() ? { q: q.trim() } : {}),
          ...(kindFilter !== 'all' ? { kind: kindFilter } : {}),
          ...(severityFilter !== 'all' ? { severity: severityFilter } : {}),
          ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
          ...(dynamicFilter !== 'all'
            ? { dynamic_label: dynamicFilter }
            : {}),
          limit: 50,
        }),
        insightsApi.chart(30),
      ]);
      setData(list);
      setChart(chartDto);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'forbidden') {
        setForbidden(true);
      } else {
        setError(e instanceof ApiError ? e.message : 'Ошибка загрузки');
      }
    } finally {
      setIsLoading(false);
    }
  }, [q, kindFilter, severityFilter, statusFilter, dynamicFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDetail = useCallback(async () => {
    if (!selectedId) return;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const dto = await insightsApi.get(selectedId);
      const mapped = mapInsightDetail(dto);
      setDetail(mapped);
      setMitigationDraft(mapped.mitigationPlan ?? '');
    } catch (e) {
      setDetailError(e instanceof ApiError ? e.message : 'Ошибка загрузки');
    } finally {
      setDetailLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    if (selectedId) void loadDetail();
    else {
      setDetail(null);
      setMitigationDraft('');
    }
  }, [selectedId, loadDetail]);

  const handleChangeStatus = useCallback(
    async (newStatus: InsightStatusApi) => {
      if (!selectedId) return;
      setActionMsg(null);
      try {
        await insightsApi.changeStatus(selectedId, { newStatus });
        setActionMsg(
          `Статус изменён на «${INSIGHT_STATUS_LABEL[newStatus]}».`,
        );
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

  const handleChangeSeverity = useCallback(
    async (newSeverity: InsightSeverityApi) => {
      if (!selectedId) return;
      setActionMsg(null);
      try {
        await insightsApi.changeSeverity(selectedId, { newSeverity });
        setActionMsg(
          `Острота изменена на «${INSIGHT_SEVERITY_LABEL[newSeverity]}».`,
        );
        await Promise.all([load(), loadDetail()]);
      } catch (e) {
        setActionMsg(
          e instanceof ApiError
            ? `Ошибка: ${e.message}`
            : 'Не удалось изменить остроту.',
        );
      }
    },
    [selectedId, load, loadDetail],
  );

  const handleSaveMitigation = useCallback(async () => {
    if (!selectedId) return;
    const trimmed = mitigationDraft.trim();
    if (!trimmed) return;
    setActionMsg(null);
    try {
      await insightsApi.setMitigation(selectedId, { mitigationPlan: trimmed });
      setActionMsg('План реагирования обновлён.');
      await Promise.all([load(), loadDetail()]);
    } catch (e) {
      setActionMsg(
        e instanceof ApiError
          ? `Ошибка: ${e.message}`
          : 'Не удалось сохранить план реагирования.',
      );
    }
  }, [selectedId, mitigationDraft, load, loadDetail]);

  const items = useMemo(() => data?.items ?? [], [data]);

  if (isLoading && !data) return <AdminLoading rows={6} />;
  if (forbidden) return <AdminForbidden />;
  if (error) return <AdminError message={error} onRetry={load} />;
  if (!data) return null;

  return (
    <div className="mx-auto w-full max-w-7xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Радар сигналов</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Повторяющиеся проблемы, риски, блокеры и неэффективности компании.
          Всего: {data.total}. Показано: {items.length}.
        </p>
      </header>

      {chart ? <InsightsChart chart={chart} /> : null}

      <div className="mt-6 mb-3 flex flex-wrap gap-2">
        {KIND_FILTERS.map((f) => (
          <FilterChip
            key={f.value}
            active={kindFilter === f.value}
            label={f.label}
            onClick={() => setKindFilter(f.value)}
          />
        ))}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {SEVERITY_FILTERS.map((f) => (
          <FilterChip
            key={f.value}
            active={severityFilter === f.value}
            label={f.label}
            onClick={() => setSeverityFilter(f.value)}
          />
        ))}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <FilterChip
            key={f.value}
            active={statusFilter === f.value}
            label={f.label}
            onClick={() => setStatusFilter(f.value)}
          />
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {DYNAMIC_FILTERS.map((f) => (
          <FilterChip
            key={f.value}
            active={dynamicFilter === f.value}
            label={f.label}
            onClick={() => setDynamicFilter(f.value)}
          />
        ))}
      </div>

      <div className="mb-4">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск по сути сигнала или плану реагирования"
          className="max-w-md"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Левая колонка — список */}
        <aside className="space-y-2">
          {items.length === 0 ? (
            <div className="rounded-md border border-border-subtle p-6 text-center text-sm text-fg-tertiary">
              Сигналов не найдено.
            </div>
          ) : (
            items.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => setSelectedId(it.id)}
                className={`block w-full rounded-md border p-3 text-left transition ${
                  selectedId === it.id
                    ? 'border-accent bg-accent/5'
                    : 'border-border-subtle hover:border-border-strong'
                }`}
              >
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge tone={INSIGHT_SEVERITY_TONE[it.severity]}>
                    {INSIGHT_SEVERITY_LABEL[it.severity]}
                  </Badge>
                  <Badge tone={INSIGHT_DYNAMIC_TONE[it.dynamicLabel]}>
                    {INSIGHT_DYNAMIC_LABEL[it.dynamicLabel]}
                  </Badge>
                  <span className="text-xs text-fg-tertiary">
                    {INSIGHT_KIND_LABEL[it.kind]}
                  </span>
                </div>
                <p className="line-clamp-2 text-sm font-medium text-fg-primary">
                  {it.statement}
                </p>
                <p className="mt-1 text-xs text-fg-tertiary">
                  Частота {formatPercent(it.frequencyScore)} · Упоминаний:{' '}
                  {it.sourceBlocksCount}
                </p>
              </button>
            ))
          )}
        </aside>

        {/* Правая колонка — детали */}
        <section>
          {!selectedId ? (
            <div className="rounded-md border border-border-subtle p-8 text-center text-sm text-fg-tertiary">
              Выберите сигнал слева, чтобы увидеть детали.
            </div>
          ) : detailLoading ? (
            <AdminLoading rows={4} />
          ) : detailError ? (
            <AdminError message={detailError} onRetry={loadDetail} />
          ) : detail ? (
            <InsightDetailView
              detail={detail}
              actionMsg={actionMsg}
              mitigationDraft={mitigationDraft}
              onMitigationChange={setMitigationDraft}
              onSaveMitigation={handleSaveMitigation}
              onChangeStatus={handleChangeStatus}
              onChangeSeverity={handleChangeSeverity}
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function FilterChip({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs transition ${
        active
          ? 'border-accent bg-accent/10 text-accent'
          : 'border-border-subtle text-fg-secondary hover:border-border-strong'
      }`}
    >
      {label}
    </button>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: 'neutral' | 'info' | 'warning' | 'success' | 'danger';
  children: React.ReactNode;
}) {
  const cls =
    tone === 'danger'
      ? 'bg-chip-danger-bg text-chip-danger-fg'
      : tone === 'warning'
        ? 'bg-chip-warning-bg text-chip-warning-fg'
        : tone === 'success'
          ? 'bg-chip-success-bg text-chip-success-fg'
          : tone === 'info'
            ? 'bg-chip-info-bg text-chip-info-fg'
            : 'bg-bg-subtle text-fg-secondary';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}
    >
      {children}
    </span>
  );
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function InsightsChart({ chart }: { chart: InsightsChartResponseApi }) {
  // Простой stacked bar chart на SVG. labels = недели; для каждой недели
  // — стек из 4 kind'ов.
  const labels = chart.labels;
  const series = chart.series;
  if (labels.length === 0 || series.length === 0) {
    return (
      <div className="rounded-md border border-border-subtle p-4 text-sm text-fg-tertiary">
        Данных по динамике пока нет.
      </div>
    );
  }
  // Suma по неделе.
  const weekTotals = labels.map((_, i) =>
    series.reduce((acc, s) => acc + (s.counts[i] ?? 0), 0),
  );
  const maxTotal = Math.max(1, ...weekTotals);
  const W_PER_BAR = 28;
  const H = 120;
  const PAD = 20;
  const chartW = W_PER_BAR * labels.length;

  return (
    <div className="rounded-md border border-border-subtle p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-fg-primary">
          Новые сигналы за {labels.length} недель
        </h2>
        <div className="flex flex-wrap gap-2 text-[10px] text-fg-secondary">
          {series.map((s) => (
            <span key={s.kind} className="inline-flex items-center gap-1">
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={{ backgroundColor: KIND_COLORS[s.kind] }}
              />
              {INSIGHT_KIND_LABEL[s.kind]}
            </span>
          ))}
        </div>
      </header>
      <div className="overflow-x-auto">
        <svg
          width={chartW + PAD * 2}
          height={H + PAD * 2}
          className="text-fg-tertiary"
        >
          {/* Y axis labels — простые */}
          <text x={0} y={PAD} fontSize="10" fill="currentColor">
            {maxTotal}
          </text>
          <text x={0} y={H + PAD} fontSize="10" fill="currentColor">
            0
          </text>
          {labels.map((_, i) => {
            let accY = 0;
            const x = PAD + i * W_PER_BAR + 4;
            return (
              <g key={i}>
                {series.map((s) => {
                  const count = s.counts[i] ?? 0;
                  if (count === 0) return null;
                  const h = (count / maxTotal) * H;
                  const y = PAD + H - accY - h;
                  accY += h;
                  return (
                    <rect
                      key={s.kind}
                      x={x}
                      y={y}
                      width={W_PER_BAR - 8}
                      height={h}
                      fill={KIND_COLORS[s.kind]}
                      rx={2}
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function InsightDetailView({
  detail,
  actionMsg,
  mitigationDraft,
  onMitigationChange,
  onSaveMitigation,
  onChangeStatus,
  onChangeSeverity,
}: {
  detail: InsightDetail;
  actionMsg: string | null;
  mitigationDraft: string;
  onMitigationChange: (v: string) => void;
  onSaveMitigation: () => Promise<void>;
  onChangeStatus: (s: InsightStatusApi) => Promise<void>;
  onChangeSeverity: (s: InsightSeverityApi) => Promise<void>;
}) {
  return (
    <div className="space-y-4 rounded-md border border-border-subtle p-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={INSIGHT_SEVERITY_TONE[detail.severity]}>
            Острота: {INSIGHT_SEVERITY_LABEL[detail.severity]}
          </Badge>
          <Badge tone={INSIGHT_STATUS_TONE[detail.status]}>
            {INSIGHT_STATUS_LABEL[detail.status]}
          </Badge>
          <Badge tone={INSIGHT_DYNAMIC_TONE[detail.dynamicLabel]}>
            Динамика: {INSIGHT_DYNAMIC_LABEL[detail.dynamicLabel]}
          </Badge>
          <span className="text-xs text-fg-tertiary">
            {INSIGHT_KIND_LABEL[detail.kind]}
          </span>
        </div>
        <h2 className="text-lg font-semibold leading-snug text-fg-primary">
          {detail.statement}
        </h2>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <Stat label="Частота за 30 дней">
          {formatPercent(detail.frequencyScore)}
        </Stat>
        <Stat label="Динамика 7д / 30д">
          {detail.dynamicScore.toFixed(2)}×
        </Stat>
        <Stat label="Упоминаний">{detail.sourceBlocksCount}</Stat>
        <Stat label="Уверенность">{formatPercent(detail.confidence)}</Stat>
      </div>

      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase text-fg-tertiary">
          Затронуты
        </h3>
        {detail.affectedEntityIds.length === 0 ? (
          <p className="text-xs text-fg-tertiary">Сущности не выявлены.</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {detail.affectedEntityIds.map((id) => (
              <span
                key={id}
                className="rounded bg-fg-tertiary/10 px-2 py-0.5 text-xs text-fg-secondary"
              >
                {id.slice(0, 12)}
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase text-fg-tertiary">
          Возможные причины (решения)
        </h3>
        {detail.relatedDecisionIds.length === 0 ? (
          <p className="text-xs text-fg-tertiary">
            Связанных решений не найдено.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {detail.relatedDecisionIds.map((id) => (
              <Link
                key={id}
                href={`/decisions/${id}`}
                className="rounded bg-chip-info-bg px-2 py-0.5 text-xs text-chip-info-fg hover:opacity-90"
              >
                Решение {id.slice(0, 8)}
              </Link>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase text-fg-tertiary">
          План реагирования
        </h3>
        <textarea
          value={mitigationDraft}
          onChange={(e) => onMitigationChange(e.target.value)}
          rows={4}
          placeholder="Как планируете реагировать на сигнал?"
          className="w-full rounded border border-border-subtle bg-bg-primary p-2 text-sm focus:border-accent focus:outline-none"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void onSaveMitigation();
            }}
            className="rounded bg-accent px-3 py-1 text-xs font-medium text-accent-fg hover:opacity-90"
            disabled={
              mitigationDraft.trim().length === 0 ||
              mitigationDraft === (detail.mitigationPlan ?? '')
            }
          >
            Сохранить план
          </button>
        </div>
      </div>

      <div>
        <h3 className="mb-1 text-xs font-semibold uppercase text-fg-tertiary">
          Источники
        </h3>
        <p className="text-xs text-fg-secondary">
          {detail.sourceBlockIds.length} блок(а/ов) из встреч и документов.
          Первое упоминание: {new Date(detail.firstObservedAt).toLocaleDateString('ru-RU')}.
          Последнее: {new Date(detail.lastObservedAt).toLocaleDateString('ru-RU')}.
        </p>
      </div>

      <div className="border-t border-border-subtle pt-3">
        <h3 className="mb-2 text-xs font-semibold uppercase text-fg-tertiary">
          Действия
        </h3>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['active', 'Вернуть в активные'],
              ['mitigating', 'Взять в работу'],
              ['mitigated', 'Отметить решённым'],
              ['archived', 'Архивировать'],
              ['false_alarm', 'Ложная тревога'],
            ] as ReadonlyArray<readonly [InsightStatusApi, string]>
          )
            .filter(([s]) => s !== detail.status)
            .map(([s, label]) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  void onChangeStatus(s);
                }}
                className="rounded border border-border-subtle px-3 py-1 text-xs text-fg-secondary hover:border-border-strong"
              >
                {label}
              </button>
            ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {(
            [
              ['low', 'Низкая'],
              ['medium', 'Средняя'],
              ['high', 'Высокая'],
              ['critical', 'Критическая'],
            ] as ReadonlyArray<readonly [InsightSeverityApi, string]>
          )
            .filter(([s]) => s !== detail.severity)
            .map(([s, label]) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  void onChangeSeverity(s);
                }}
                className="rounded border border-dashed border-border-subtle px-3 py-1 text-xs text-fg-tertiary hover:border-border-strong"
              >
                Острота: {label}
              </button>
            ))}
        </div>
        {actionMsg ? (
          <p className="mt-2 text-xs text-fg-secondary">{actionMsg}</p>
        ) : null}
      </div>
    </div>
  );
}

function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded bg-fg-tertiary/5 p-2">
      <div className="text-[10px] uppercase text-fg-tertiary">{label}</div>
      <div className="text-sm font-medium text-fg-primary">{children}</div>
    </div>
  );
}
