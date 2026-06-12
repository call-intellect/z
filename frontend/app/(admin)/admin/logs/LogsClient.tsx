'use client';

/**
 * LogsClient — `/admin/logs` (LoggingModule, 2026-06-01).
 *
 * Технические логи приложения (модель `SystemLog`). Только super_admin.
 * UI: период (Segmented) + статистика + топ модулей/endpoint'ов по ошибкам +
 * фильтры + серверная таблица + Drawer деталей + Drawer настроек.
 *
 * Эндпоинты: `/api/v1/platform/logs[/aggregates|/settings|/cleanup|/:id]`.
 *
 * ⚠️ Footgun: `dateFrom` периода вычисляется из «сейчас» — мемоизируем по
 * стабильному `period`, иначе ключ запроса меняется каждый рендер → бесконечный
 * рефетч → 429.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { logsApi } from '@/api/admin-logs.api';
import {
  CATEGORY_LABELS,
  CONTOUR_LABELS,
  LEVEL_LABELS,
  LOG_CATEGORIES,
  LOG_CONTOURS,
  LOG_LEVELS,
  LOG_PIPELINES,
  PIPELINE_LABELS,
  systemLogChainFromApi,
  systemLogListFromApi,
  systemLogRecordFromApi,
  type LoggingSettingsApi,
  type SystemLogAggregatesApi,
  type SystemLogCategory,
  type SystemLogChain,
  type SystemLogLevel,
  type SystemLogPipeline,
  type SystemLogRecord,
  type SystemLogRecordApi,
} from '@/domain/system-logs';
import { useLogStream } from '@/hooks/admin/useLogStream';
import { AdminSection } from '@/ui/components/admin/AdminSection';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent } from '@/ui/shadcn/card';
import { Input } from '@/ui/shadcn/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/ui/shadcn/sheet';
import { Switch } from '@/ui/shadcn/switch';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';

import { AdminError, AdminForbidden, AdminLoading } from '../AdminStateViews';
import { useAdminQuery } from '../useAdminQuery';
import { adminRootCrumb } from '@/ui/components/admin/brand';

const PAGE_SIZE = 50;
const ALL = '__all__';

type Period = 'today' | '24h' | '7d' | '30d';

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: 'today', label: 'Сегодня' },
  { value: '24h', label: '24ч' },
  { value: '7d', label: '7д' },
  { value: '30d', label: '30д' },
];

/** Цвет Badge по уровню. */
const LEVEL_CLASS: Record<SystemLogLevel, string> = {
  DEBUG: 'border-border-subtle bg-bg-overlay text-fg-tertiary',
  INFO: 'border-border-subtle bg-bg-overlay text-fg-secondary',
  WARN: 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  ERROR: 'border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400',
  FATAL: 'border-red-500/60 bg-red-500/20 text-red-700 dark:text-red-300',
};

/** Фон строки таблицы по уровню. */
function rowClass(level: SystemLogLevel): string {
  if (level === 'ERROR' || level === 'FATAL') return 'bg-red-500/5';
  if (level === 'WARN') return 'bg-amber-500/5';
  return '';
}

type Filters = {
  levelAtLeast: string;
  category: string;
  contour: string;
  pipeline: string;
  module: string;
  statusCode: string;
  requestId: string;
  search: string;
};

const EMPTY_FILTERS: Filters = {
  levelAtLeast: ALL,
  category: ALL,
  contour: ALL,
  pipeline: ALL,
  module: '',
  statusCode: '',
  requestId: '',
  search: '',
};

const LEVEL_ORDER: Record<SystemLogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
  FATAL: 50,
};

const LIVE_BUFFER_CAP = 300;

/** Совпадает ли пришедшая по WS запись с текущими фильтрами (клиентская проверка). */
function matchesFilters(r: SystemLogRecord, f: Filters): boolean {
  if (f.levelAtLeast !== ALL && LEVEL_ORDER[r.level] < LEVEL_ORDER[f.levelAtLeast as SystemLogLevel]) {
    return false;
  }
  if (f.category !== ALL && r.category !== f.category) return false;
  if (f.contour !== ALL && r.contour !== f.contour) return false;
  if (f.pipeline !== ALL && r.pipeline !== f.pipeline) return false;
  if (f.module.trim() && r.module !== f.module.trim()) return false;
  if (f.statusCode.trim() && String(r.statusCode ?? '') !== f.statusCode.trim()) return false;
  if (f.requestId.trim() && r.requestId !== f.requestId.trim()) return false;
  if (f.search.trim()) {
    const q = f.search.trim().toLowerCase();
    const hay = `${r.message} ${r.action ?? ''} ${r.errorMessage ?? ''}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

export function LogsClient() {
  const [period, setPeriod] = useState<Period>('24h');
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<SystemLogRecord | null>(null);
  const [chainTrace, setChainTrace] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [live, setLive] = useState(false);
  const [liveItems, setLiveItems] = useState<SystemLogRecord[]>([]);

  // Live-стрим по WebSocket (без поллинга). Входящие фильтруем клиентски и
  // префиксуем к буферу (cap LIVE_BUFFER_CAP, дедуп по id).
  const onLiveLogs = useCallback(
    (incoming: SystemLogRecordApi[]) => {
      setLiveItems((prev) => {
        const matched = incoming
          .map(systemLogRecordFromApi)
          .filter((r) => matchesFilters(r, filters));
        if (matched.length === 0) return prev;
        const seen = new Set(prev.map((p) => p.id));
        const fresh = matched.filter((r) => !seen.has(r.id));
        if (fresh.length === 0) return prev;
        return [...fresh.reverse(), ...prev].slice(0, LIVE_BUFFER_CAP);
      });
    },
    [filters],
  );
  const { connected: liveConnected } = useLogStream(live, onLiveLogs);

  // Смена фильтров/периода или переключение Live — очищаем live-буфер.
  useEffect(() => {
    setLiveItems([]);
  }, [filters, period, live]);

  // ⚠️ Мемоизируем dateFrom по period — НЕ по каждому рендеру (иначе беск. рефетч).
  const dateFrom = useMemo(() => fromForPeriod(period), [period]);

  const updateFilter = useCallback(
    <K extends keyof Filters>(key: K, value: Filters[K]) => {
      setFilters((s) => ({ ...s, [key]: value }));
      setPage(0); // любое изменение фильтра сбрасывает страницу
    },
    [],
  );

  // ── список ──
  const listParams = useMemo(
    () => ({
      dateFrom,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      ...(filters.levelAtLeast !== ALL ? { levelAtLeast: filters.levelAtLeast } : {}),
      ...(filters.category !== ALL ? { category: filters.category } : {}),
      ...(filters.contour !== ALL ? { contour: filters.contour } : {}),
      ...(filters.pipeline !== ALL ? { pipeline: filters.pipeline } : {}),
      ...(filters.module.trim() ? { module: filters.module.trim() } : {}),
      ...(filters.statusCode.trim() ? { statusCode: Number(filters.statusCode) } : {}),
      ...(filters.requestId.trim() ? { requestId: filters.requestId.trim() } : {}),
      ...(filters.search.trim() ? { search: filters.search.trim() } : {}),
    }),
    [dateFrom, page, filters],
  );

  const listKey = useMemo(() => JSON.stringify(listParams), [listParams]);
  const listQ = useAdminQuery(
    `logs-list:${listKey}`,
    () => logsApi.list(listParams).then(systemLogListFromApi),
    [listKey],
  );

  // ── агрегаты ──
  const aggParams = useMemo(() => ({ dateFrom }), [dateFrom]);
  const aggQ = useAdminQuery<SystemLogAggregatesApi>(
    `logs-agg:${dateFrom}`,
    () => logsApi.aggregates(aggParams),
    [dateFrom],
  );

  const list = listQ.data;
  const agg = aggQ.data;
  const totalPages = list ? Math.max(1, Math.ceil(list.total / PAGE_SIZE)) : 1;

  // Отображаемые строки: в Live-режиме префиксуем live-буфер к текущей странице
  // (дедуп по id), иначе — как пришло с сервера.
  const rows = useMemo<SystemLogRecord[]>(() => {
    const base = list?.items ?? [];
    if (!live || liveItems.length === 0) return base;
    const seen = new Set(base.map((b) => b.id));
    return [...liveItems.filter((r) => !seen.has(r.id)), ...base];
  }, [live, liveItems, list]);

  if (listQ.isForbidden || aggQ.isForbidden) {
    return (
      <AdminSection title="Технические логи">
        <AdminForbidden />
      </AdminSection>
    );
  }

  return (
    <AdminSection
      breadcrumbs={[
        adminRootCrumb(),
        { label: 'Логи' },
      ]}
      title="Технические логи"
      description="Операционная диагностика приложения. Поиск, фильтры, агрегаты и runtime-настройки логирования."
      actions={
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            value={period}
            onValueChange={(v) => {
              if (v) {
                setPeriod(v as Period);
                setPage(0);
              }
            }}
          >
            {PERIODS.map((p) => (
              <ToggleGroupItem key={p.value} value={p.value} className="text-xs">
                {p.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button
            variant={live ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setLive((v) => !v);
              setPage(0);
            }}
            title="Стрим логов по WebSocket без обновления страницы"
          >
            <span
              className={`mr-1.5 inline-block h-2 w-2 rounded-full ${
                live ? (liveConnected ? 'animate-pulse bg-emerald-400' : 'bg-amber-400') : 'bg-fg-tertiary'
              }`}
            />
            {live ? (liveConnected ? 'Live' : 'Подключение…') : 'Live'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={live}
            onClick={() => {
              listQ.refetch();
              aggQ.refetch();
            }}
          >
            Обновить
          </Button>
          <Button variant="default" size="sm" onClick={() => setSettingsOpen(true)}>
            Настройки
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Статистика */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Записей за период" value={agg ? fmt(agg.total) : '—'} />
          <StatCard
            label="Ошибок (ERROR+FATAL)"
            value={agg ? fmt(agg.errorCount) : '—'}
            tone="error"
          />
          <StatCard
            label="Предупреждений (WARN)"
            value={agg ? fmt(agg.warnCount) : '—'}
            tone="warn"
          />
          <StatCard
            label="Ср. время ответа, мс"
            value={agg?.avgRequestDurationMs != null ? Math.round(agg.avgRequestDurationMs).toString() : '—'}
          />
        </div>

        {/* Топы по ошибкам */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <TopCard
            title="Топ модулей по ошибкам"
            rows={(agg?.topErrorModules ?? []).map((r) => ({
              label: r.module ?? '—',
              count: r.count,
            }))}
          />
          <TopCard
            title="Записей по контурам (за период)"
            rows={Object.entries(agg?.byPipeline ?? {})
              .sort((a, b) => b[1] - a[1])
              .map(([key, count]) => ({
                label: PIPELINE_LABELS[key as SystemLogPipeline] ?? key,
                count,
              }))}
          />
        </div>

        {/* Фильтры */}
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <FilterSelect
              label="Уровень ≥"
              value={filters.levelAtLeast}
              onChange={(v) => updateFilter('levelAtLeast', v)}
              options={LOG_LEVELS.map((l) => ({ value: l, label: LEVEL_LABELS[l] }))}
            />
            <FilterSelect
              label="Категория"
              value={filters.category}
              onChange={(v) => updateFilter('category', v)}
              options={LOG_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
            />
            <FilterSelect
              label="Контур (процесс)"
              value={filters.pipeline}
              onChange={(v) => updateFilter('pipeline', v)}
              options={LOG_PIPELINES.map((p) => ({ value: p, label: PIPELINE_LABELS[p] }))}
            />
            <FilterSelect
              label="Зона (роль)"
              value={filters.contour}
              onChange={(v) => updateFilter('contour', v)}
              options={LOG_CONTOURS.map((c) => ({ value: c, label: CONTOUR_LABELS[c] }))}
            />
            <LabeledInput
              label="Модуль"
              value={filters.module}
              onChange={(v) => updateFilter('module', v)}
              placeholder="например, http"
            />
            <LabeledInput
              label="Статус"
              value={filters.statusCode}
              onChange={(v) => updateFilter('statusCode', v.replace(/[^\d]/g, ''))}
              placeholder="500"
              width="w-24"
            />
            <LabeledInput
              label="requestId"
              value={filters.requestId}
              onChange={(v) => updateFilter('requestId', v)}
              placeholder="abc123"
            />
            <LabeledInput
              label="Поиск по сообщению"
              value={filters.search}
              onChange={(v) => updateFilter('search', v)}
              placeholder="текст ошибки…"
              width="w-64"
            />
            <Button variant="ghost" size="sm" onClick={() => { setFilters(EMPTY_FILTERS); setPage(0); }}>
              Сбросить
            </Button>
          </CardContent>
        </Card>

        {/* Таблица */}
        {listQ.isLoading && !list ? <AdminLoading rows={8} /> : null}
        {listQ.error ? (
          <AdminError message={listQ.error} onRetry={() => listQ.refetch()} />
        ) : null}
        {list && !listQ.error ? (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
                    <tr>
                      <th className="px-3 py-2 text-left">Время</th>
                      <th className="px-3 py-2 text-left">Уровень</th>
                      <th className="px-3 py-2 text-left">Категория</th>
                      <th className="hidden px-3 py-2 text-left lg:table-cell">Контур</th>
                      <th className="px-3 py-2 text-left">Модуль</th>
                      <th className="hidden px-3 py-2 text-left xl:table-cell">Цепочка</th>
                      <th className="px-3 py-2 text-left">Сообщение</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((it) => (
                      <tr
                        key={it.id}
                        className={`cursor-pointer border-t border-border-subtle align-top hover:bg-bg-overlay/60 ${rowClass(it.level)}`}
                        onClick={() => setSelected(it)}
                      >
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-fg-tertiary">
                          {it.createdAt.toLocaleString('ru-RU')}
                        </td>
                        <td className="px-3 py-2">
                          <Badge className={LEVEL_CLASS[it.level]}>{LEVEL_LABELS[it.level]}</Badge>
                        </td>
                        <td className="px-3 py-2 text-xs">{CATEGORY_LABELS[it.category]}</td>
                        <td className="hidden px-3 py-2 text-xs text-fg-tertiary lg:table-cell">
                          {it.pipeline ? PIPELINE_LABELS[it.pipeline] : '—'}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{it.module ?? '—'}</td>
                        <td className="hidden px-3 py-2 xl:table-cell">
                          {it.traceId ? (
                            <button
                              type="button"
                              className="font-mono text-[11px] text-accent hover:underline"
                              onClick={(e) => {
                                e.stopPropagation();
                                setChainTrace(it.traceId);
                              }}
                              title="Показать всю цепочку"
                            >
                              {it.traceId}
                            </button>
                          ) : (
                            <span className="text-fg-tertiary">—</span>
                          )}
                        </td>
                        <td className="max-w-[420px] px-3 py-2">
                          <div className="flex items-center gap-2">
                            {it.statusCode != null ? (
                              <Badge variant="secondary">{it.statusCode}</Badge>
                            ) : null}
                            <span className="truncate text-xs">{it.message}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-3 py-8 text-center text-sm text-fg-tertiary">
                          Записей нет
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* Пагинация */}
        {list && list.total > PAGE_SIZE ? (
          <div className="flex items-center justify-between text-xs text-fg-secondary">
            <span>
              Всего {fmt(list.total)} · страница {page + 1} из {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                Назад
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page + 1 >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Вперёд
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <LogDetailsDrawer
        record={selected}
        onClose={() => setSelected(null)}
        onShowChain={(t) => setChainTrace(t)}
      />
      <ChainDrawer traceId={chainTrace} onClose={() => setChainTrace(null)} />
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => {
          listQ.refetch();
          aggQ.refetch();
        }}
      />
    </AdminSection>
  );
}

// ───────────────────────────── helpers ───────────────────────────────

function fromForPeriod(period: Period): string {
  const now = new Date();
  if (period === 'today') {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  const hours = period === '24h' ? 24 : period === '7d' ? 24 * 7 : 24 * 30;
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function fmt(n: number): string {
  return new Intl.NumberFormat('ru-RU').format(n);
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'error' | 'warn';
}) {
  const valueClass =
    tone === 'error'
      ? 'text-red-600 dark:text-red-400'
      : tone === 'warn'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-fg-primary';
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-fg-tertiary">{label}</div>
        <div className={`mt-1 text-2xl font-semibold ${valueClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function TopCard({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; count: number }>;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-2 text-xs uppercase tracking-wide text-fg-tertiary">{title}</div>
        {rows.length === 0 ? (
          <div className="text-xs text-fg-tertiary">Нет ошибок за период.</div>
        ) : (
          <ul className="space-y-1">
            {rows.map((r, i) => (
              <li key={`${r.label}-${i}`} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate font-mono">{r.label}</span>
                <Badge variant="secondary">{r.count}</Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex min-w-[150px] flex-col gap-1 text-xs text-fg-secondary">
      <span>{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Все" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Все</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  width = 'w-40',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  width?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 text-xs text-fg-secondary ${width}`}>
      <span>{label}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

// ───────────────────────────── Drawer: детали ─────────────────────────

function LogDetailsDrawer({
  record,
  onClose,
  onShowChain,
}: {
  record: SystemLogRecord | null;
  onClose: () => void;
  onShowChain: (traceId: string) => void;
}) {
  return (
    <Sheet open={record !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {record ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Badge className={LEVEL_CLASS[record.level]}>{LEVEL_LABELS[record.level]}</Badge>
                <span className="text-sm">{CATEGORY_LABELS[record.category]}</span>
              </SheetTitle>
              <SheetDescription>{record.createdAt.toLocaleString('ru-RU')}</SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-4 text-sm">
              <div className="rounded-md border border-border-subtle p-3">
                <div className="text-xs text-fg-tertiary">Сообщение</div>
                <div className="mt-1 break-words">{record.message}</div>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <Field
                  label="Контур (процесс)"
                  value={record.pipeline ? PIPELINE_LABELS[record.pipeline] : null}
                />
                <Field label="Зона (роль)" value={record.contour ? CONTOUR_LABELS[record.contour] : null} />
                <Field label="Модуль" value={record.module} mono />
                <Field label="Action" value={record.action} mono />
                <Field label="Метод" value={record.method} mono />
                <Field label="Статус" value={record.statusCode?.toString() ?? null} />
                <Field label="Длительность, мс" value={record.durationMs?.toString() ?? null} />
                <Field label="Путь" value={record.path} mono />
                <Field label="userId" value={record.userId} mono />
                <Field label="Роль" value={record.userRole} />
                <Field label="orgId" value={record.orgId} mono />
                <Field label="IP" value={record.ip} mono />
                <Field label="environment" value={record.environment} />
                <Field label="instanceId" value={record.instanceId} mono />
                <Field label="traceId" value={record.traceId} mono />
              </dl>

              <div className="flex items-center gap-2">
                <span className="text-xs text-fg-tertiary">requestId:</span>
                <code className="rounded bg-bg-overlay px-1.5 py-0.5 text-xs">
                  {record.requestId ?? '—'}
                </code>
                {record.requestId ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard?.writeText(record.requestId ?? '');
                    }}
                  >
                    Копировать
                  </Button>
                ) : null}
              </div>

              {record.traceId ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-fg-tertiary">traceId:</span>
                  <code className="rounded bg-bg-overlay px-1.5 py-0.5 text-xs">
                    {record.traceId}
                  </code>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => onShowChain(record.traceId as string)}
                  >
                    Показать всю цепочку
                  </Button>
                </div>
              ) : null}

              {record.errorName || record.errorMessage || record.errorStack ? (
                <div className="rounded-md border border-red-500/40 bg-red-500/5 p-3">
                  <div className="text-xs font-semibold text-red-600 dark:text-red-400">
                    {record.errorName ?? 'Error'}
                  </div>
                  {record.errorMessage ? (
                    <div className="mt-1 break-words text-xs">{record.errorMessage}</div>
                  ) : null}
                  {record.errorStack ? (
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-bg-overlay p-2 text-[11px]">
                      {record.errorStack}
                    </pre>
                  ) : null}
                </div>
              ) : null}

              {record.details != null ? (
                <div className="rounded-md border border-border-subtle p-3">
                  <div className="mb-1 text-xs text-fg-tertiary">details</div>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-bg-overlay p-2 text-[11px]">
                    {JSON.stringify(record.details, null, 2)}
                  </pre>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

// ───────────────────────────── Drawer: цепочка ────────────────────────

/**
 * Вид «Цепочка» — все логи одного `traceId` по времени (timeline). Показывает
 * всю последовательность стадий одного действия (встреча → S3 → транскрипция →
 * AI → граф): вызовы, длительности, результаты и ошибки в одном месте.
 */
function ChainDrawer({
  traceId,
  onClose,
}: {
  traceId: string | null;
  onClose: () => void;
}) {
  const chainQ = useAdminQuery<SystemLogChain | null>(
    `logs-chain:${traceId ?? ''}`,
    () => (traceId ? logsApi.chain(traceId).then(systemLogChainFromApi) : Promise.resolve(null)),
    [traceId],
  );
  const chain = chainQ.data;
  const t0 = chain?.items[0]?.createdAt.getTime() ?? 0;

  return (
    <Sheet open={traceId !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-sm">
            Цепочка вызовов
            <code className="rounded bg-bg-overlay px-1.5 py-0.5 text-xs">{traceId}</code>
          </SheetTitle>
          <SheetDescription>
            {chain ? `${fmt(chain.total)} записей · по времени` : 'Загрузка…'}
          </SheetDescription>
        </SheetHeader>

        {chainQ.isLoading && !chain ? (
          <div className="mt-4"><AdminLoading rows={8} /></div>
        ) : chainQ.error ? (
          <div className="mt-4"><AdminError message={chainQ.error} onRetry={() => chainQ.refetch()} /></div>
        ) : chain && chain.items.length > 0 ? (
          <ol className="mt-4 space-y-0">
            {chain.items.map((it, i) => {
              const prev = i > 0 ? chain.items[i - 1] : null;
              const pipelineChanged = !prev || prev.pipeline !== it.pipeline;
              const deltaMs = it.createdAt.getTime() - t0;
              return (
                <li key={it.id} className="relative border-l-2 border-border-subtle pl-4">
                  {pipelineChanged ? (
                    <div className="mb-1 mt-3 flex items-center gap-2">
                      <Badge variant="secondary" className="text-[11px]">
                        {it.pipeline ? PIPELINE_LABELS[it.pipeline] : 'Без контура'}
                      </Badge>
                    </div>
                  ) : null}
                  <div
                    className={`mb-1 rounded-md border border-border-subtle p-2 text-xs ${rowClass(it.level)}`}
                  >
                    <div className="flex items-center gap-2">
                      <Badge className={LEVEL_CLASS[it.level]}>{LEVEL_LABELS[it.level]}</Badge>
                      <span className="font-mono text-[11px] text-fg-tertiary">
                        +{(deltaMs / 1000).toFixed(2)}s
                      </span>
                      {it.module ? (
                        <span className="font-mono text-[11px] text-fg-secondary">{it.module}</span>
                      ) : null}
                      {it.durationMs != null ? (
                        <span className="text-[11px] text-fg-tertiary">{it.durationMs} мс</span>
                      ) : null}
                    </div>
                    <div className="mt-1 break-words">{it.message}</div>
                    {it.errorMessage ? (
                      <div className="mt-1 break-words text-[11px] text-red-600 dark:text-red-400">
                        {it.errorName ?? 'Error'}: {it.errorMessage}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="mt-6 text-center text-sm text-fg-tertiary">Записей цепочки нет.</div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex flex-col">
      <dt className="text-fg-tertiary">{label}</dt>
      <dd className={mono ? 'font-mono break-all' : 'break-words'}>{value ?? '—'}</dd>
    </div>
  );
}

// ───────────────────────────── Drawer: настройки ──────────────────────

function SettingsDrawer({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const settingsQ = useAdminQuery<LoggingSettingsApi>(
    `logs-settings:${open}`,
    () => logsApi.getSettings(),
    [open],
  );
  const [draft, setDraft] = useState<LoggingSettingsApi | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const current = draft ?? settingsQ.data;

  const patch = <K extends keyof LoggingSettingsApi>(key: K, value: LoggingSettingsApi[K]) => {
    if (!current) return;
    setDraft({ ...current, [key]: value });
  };

  const save = async () => {
    if (!current) return;
    setBusy(true);
    setFeedback(null);
    try {
      await logsApi.updateSettings(current);
      setFeedback('Настройки применены.');
      setDraft(null);
      onSaved();
    } catch {
      setFeedback('Не удалось сохранить настройки.');
    } finally {
      setBusy(false);
    }
  };

  const runCleanup = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      const res = await logsApi.cleanup();
      setFeedback(
        res.skipped
          ? 'Очистка пропущена (выполняется на другом инстансе).'
          : `Удалено записей: ${res.deleted}.`,
      );
      onSaved();
    } catch {
      setFeedback('Не удалось запустить очистку.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) { onClose(); setDraft(null); setFeedback(null); } }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Настройки логирования</SheetTitle>
          <SheetDescription>Применяются ко всем инстансам без перезапуска.</SheetDescription>
        </SheetHeader>

        {settingsQ.isLoading && !current ? (
          <div className="mt-4"><AdminLoading rows={6} /></div>
        ) : current ? (
          <div className="mt-4 space-y-4 text-sm">
            <SwitchRow label="Логирование в БД" checked={current.dbLoggingEnabled} onChange={(v) => patch('dbLoggingEnabled', v)} />
            <SwitchRow label="Стек-трейсы" checked={current.logStackTraces} onChange={(v) => patch('logStackTraces', v)} />
            <SwitchRow label="Логировать успешные запросы" checked={current.logSuccessfulRequests} onChange={(v) => patch('logSuccessfulRequests', v)} />
            <SwitchRow label="Тело запроса (request body)" checked={current.requestBodyLogging} onChange={(v) => patch('requestBodyLogging', v)} />
            <SwitchRow label="Тело ответа (response body)" checked={current.responseBodyLogging} onChange={(v) => patch('responseBodyLogging', v)} />

            <label className="flex flex-col gap-1 text-xs text-fg-secondary">
              <span>Минимальный уровень</span>
              <Select value={current.minLevel} onValueChange={(v) => patch('minLevel', v as SystemLogLevel)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LOG_LEVELS.map((l) => (
                    <SelectItem key={l} value={l}>{LEVEL_LABELS[l]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>

            <NumberRow label="Размер пачки (batchSize)" value={current.batchSize} onChange={(v) => patch('batchSize', v)} />
            <NumberRow label="Интервал flush, мс" value={current.flushIntervalMs} onChange={(v) => patch('flushIntervalMs', v)} />
            <NumberRow label="Макс. буфер" value={current.maxBufferSize} onChange={(v) => patch('maxBufferSize', v)} />
            <NumberRow label="Хранить дней (retention)" value={current.retentionDays} onChange={(v) => patch('retentionDays', v)} />
            <NumberRow label="Порог медленного запроса, мс" value={current.slowRequestThresholdMs} onChange={(v) => patch('slowRequestThresholdMs', v)} />

            <TagsRow
              label="Категории (пусто = все)"
              values={current.enabledCategories}
              all={LOG_CATEGORIES as readonly string[]}
              labelOf={(c) => CATEGORY_LABELS[c as SystemLogCategory] ?? c}
              onToggle={(cat) => {
                const has = current.enabledCategories.includes(cat as SystemLogCategory);
                patch(
                  'enabledCategories',
                  (has
                    ? current.enabledCategories.filter((c) => c !== cat)
                    : [...current.enabledCategories, cat as SystemLogCategory]),
                );
              }}
            />

            <label className="flex flex-col gap-1 text-xs text-fg-secondary">
              <span>Отключённые модули (через запятую)</span>
              <Input
                value={current.disabledModules.join(', ')}
                onChange={(e) =>
                  patch(
                    'disabledModules',
                    e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                  )
                }
                placeholder="http, billing"
              />
            </label>

            {feedback ? <div className="text-xs text-fg-secondary">{feedback}</div> : null}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button size="sm" disabled={busy} onClick={() => void save()}>
                Сохранить и применить
              </Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void runCleanup()}>
                Очистить по retention
              </Button>
            </div>
          </div>
        ) : settingsQ.isForbidden ? (
          <div className="mt-4"><AdminForbidden /></div>
        ) : (
          <div className="mt-4"><AdminError message={settingsQ.error ?? 'Ошибка'} onRetry={() => settingsQ.refetch()} /></div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function SwitchRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-fg-secondary">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function NumberRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs text-fg-secondary">
      <span>{label}</span>
      <Input
        type="number"
        className="w-32"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function TagsRow({
  label,
  values,
  all,
  onToggle,
  labelOf,
}: {
  label: string;
  values: string[];
  all: readonly string[];
  onToggle: (v: string) => void;
  labelOf?: (v: string) => string;
}) {
  return (
    <div className="flex flex-col gap-1 text-xs text-fg-secondary">
      <span>{label}</span>
      <div className="flex flex-wrap gap-1">
        {all.map((c) => {
          const active = values.includes(c);
          return (
            <button
              key={c}
              type="button"
              onClick={() => onToggle(c)}
              className={`rounded border px-2 py-0.5 text-[11px] ${active ? 'border-accent bg-accent/10 text-accent' : 'border-border-subtle text-fg-tertiary'}`}
            >
              {labelOf ? labelOf(c) : c}
            </button>
          );
        })}
      </div>
    </div>
  );
}
