'use client';

/**
 * Фаза A.4 — детальная карточка `/admin/ai-models/[taskType]`.
 *
 * Компоненты:
 *   - <TaskTypeDetailsCard /> — шапка + цепочка provider'ов.
 *   - <TaskTypeMetricsWidget /> — графики cost/latency/success/% fallback.
 *   - История переключений (audit log).
 *   - Модалка <SwitchPrimaryModal /> — переключение primary с опцией A/B.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import {
  AI_MODELS_PROVIDERS,
  adminAiModelsApi,
  type AiModelTier,
  type ProviderInTierApi,
  type RouteChangeApi,
  type TaskTypeMetricsApi,
  type TaskTypeRouteApi,
} from '@/api/admin-ai-models.api';
import {
  formatCostRub,
  formatLatency,
  formatPercent,
  mapTaskTypeRoute,
  tierLabel,
  type TaskTypeRouteUi,
} from '@/domain/admin-ai-model';
import { useToast } from '@/contexts/toast-context';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

interface Props {
  taskType: string;
}

export function TaskTypeDetailsClient({ taskType }: Props) {
  const { addToast } = useToast();
  const [route, setRoute] = useState<TaskTypeRouteUi | null>(null);
  const [metrics, setMetrics] = useState<TaskTypeMetricsApi | null>(null);
  const [history, setHistory] = useState<RouteChangeApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'24h' | '7d' | '30d'>('7d');
  const [error, setError] = useState<string | null>(null);
  const [switchOpen, setSwitchOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [detail, m, h] = await Promise.all([
        adminAiModelsApi.detail(taskType),
        adminAiModelsApi.metrics(taskType, period),
        adminAiModelsApi.history(taskType),
      ]);
      setRoute(mapTaskTypeRoute(detail));
      setMetrics(m);
      setHistory(h.items);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Не удалось загрузить';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [taskType, period]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRemoveProvider = async (entry: ProviderInTierApi) => {
    if (!confirm(`Удалить ${entry.providerName} из tier=${entry.tier}?`)) return;
    try {
      await adminAiModelsApi.removeProvider(taskType, entry.id);
      addToast({ type: 'success', message: 'Провайдер удалён' });
      await refresh();
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Не удалось удалить',
      });
    }
  };

  if (loading && !route) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-slate-500">
        <Loader2 size={16} className="mr-2 animate-spin" /> Загружаем…
      </div>
    );
  }
  if (error) {
    return <div className="text-sm text-red-700">{error}</div>;
  }
  if (!route) return null;

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6">
        <Link
          href="/admin/ai-models"
          className="mb-2 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={12} /> Назад к списку
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          <code className="font-mono">{route.taskType}</code>
        </h1>
        <p className="text-sm text-slate-600">{route.groupLabel}</p>
      </header>

      {/* Цепочка моделей */}
      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Цепочка моделей</h2>
          <Button size="sm" onClick={() => setSwitchOpen(true)}>
            Переключить основную
          </Button>
        </div>
        <div className="space-y-2">
          {route.chain.length === 0 && (
            <div className="text-xs text-slate-500">Пусто — примените seed дефолтов.</div>
          )}
          {route.chain.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3"
            >
              <Badge
                variant="outline"
                className={`w-fit ${
                  entry.tierColor === 'green'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : entry.tierColor === 'orange'
                      ? 'border-amber-200 bg-amber-50 text-amber-700'
                      : 'border-slate-200 bg-slate-100 text-slate-600'
                }`}
              >
                {tierLabel(entry.tier)}
              </Badge>
              <span className="text-sm font-medium text-slate-900">
                {entry.providerLabel}
              </span>
              {entry.model && (
                <span className="text-xs text-slate-500">/ {entry.model}</span>
              )}
              <span className="text-[10px] text-slate-400">priority={entry.priority}</span>
              {entry.editedByAdmin && (
                <Badge variant="secondary" className="text-[10px]">
                  ручная правка
                </Badge>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto text-xs text-red-600 hover:bg-red-50"
                onClick={() => void handleRemoveProvider(entry)}
              >
                Удалить
              </Button>
            </div>
          ))}
        </div>
      </section>

      {/* Метрики per-tier */}
      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Метрики</h2>
          <div className="flex gap-1">
            {(['24h', '7d', '30d'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`rounded px-2 py-1 text-xs ${
                  period === p
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {p === '24h' ? '24ч' : p === '7d' ? '7 дней' : '30 дней'}
              </button>
            ))}
          </div>
        </div>
        {metrics ? (
          <MetricsTable metrics={metrics} />
        ) : (
          <div className="text-xs text-slate-500">Нет данных за выбранный период.</div>
        )}
      </section>

      {/* Audit log */}
      <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-base font-semibold text-slate-900">История изменений</h2>
        {history.length === 0 ? (
          <div className="text-xs text-slate-500">История пуста.</div>
        ) : (
          <ul className="space-y-2">
            {history.map((h) => (
              <li
                key={h.id}
                className="rounded-md border border-slate-100 bg-slate-50 p-2 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-slate-500">
                    {new Date(h.createdAt).toLocaleString('ru-RU')}
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {h.changeType}
                  </Badge>
                  {h.tier && (
                    <span className="text-[10px] text-slate-500">{tierLabel(h.tier as AiModelTier)}</span>
                  )}
                </div>
                {h.reason && <div className="mt-1 text-slate-700">{h.reason}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {switchOpen && (
        <SwitchPrimaryModal
          taskType={taskType}
          currentPrimary={route.primary?.providerName ?? null}
          onClose={() => setSwitchOpen(false)}
          onDone={() => {
            setSwitchOpen(false);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function MetricsTable({ metrics }: { metrics: TaskTypeMetricsApi }) {
  return (
    <div className="overflow-hidden rounded border border-slate-100">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Уровень</th>
            <th className="px-3 py-2 text-right font-medium">Вызовов</th>
            <th className="px-3 py-2 text-right font-medium">Успех</th>
            <th className="px-3 py-2 text-right font-medium">Латентность p95</th>
            <th className="px-3 py-2 text-right font-medium">Стоимость</th>
          </tr>
        </thead>
        <tbody>
          {(['primary', 'secondary', 'tertiary'] as const).map((t) => {
            const row = metrics.perTier[t];
            return (
              <tr key={t} className="border-t border-slate-100">
                <td className="px-3 py-2">{tierLabel(t)}</td>
                <td className="px-3 py-2 text-right">{row.calls}</td>
                <td className="px-3 py-2 text-right">{formatPercent(row.successRate)}</td>
                <td className="px-3 py-2 text-right">{formatLatency(row.p95LatencyMs)}</td>
                <td className="px-3 py-2 text-right">{formatCostRub(row.costUsd)}</td>
              </tr>
            );
          })}
          <tr className="border-t-2 border-slate-200 bg-slate-50 font-medium">
            <td className="px-3 py-2">Итого</td>
            <td className="px-3 py-2 text-right">{metrics.totals.calls}</td>
            <td className="px-3 py-2 text-right">
              {metrics.totals.calls > 0
                ? formatPercent(metrics.totals.successCalls / metrics.totals.calls)
                : '—'}
            </td>
            <td className="px-3 py-2 text-right text-xs text-slate-500">
              fallback: {formatPercent(metrics.totals.fallbackRate)}
            </td>
            <td className="px-3 py-2 text-right">{formatCostRub(metrics.totals.totalCostUsd)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function SwitchPrimaryModal({
  taskType,
  currentPrimary,
  onClose,
  onDone,
}: {
  taskType: string;
  currentPrimary: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { addToast } = useToast();
  const [providerName, setProviderName] = useState<typeof AI_MODELS_PROVIDERS[number]>(
    'openai-via-proxy',
  );
  const [model, setModel] = useState('gpt-5.5');
  const [reason, setReason] = useState('');
  const [abPercent, setAbPercent] = useState(100);
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (reason.length < 3) {
      addToast({ type: 'error', message: 'Опишите причину (минимум 3 символа)' });
      return;
    }
    setBusy(true);
    try {
      await adminAiModelsApi.switchPrimary(taskType, {
        providerName,
        model,
        reason,
        ...(abPercent < 100 ? { abSplitPercent: abPercent, abDurationDays: days } : {}),
      });
      addToast({
        type: 'success',
        message: abPercent < 100 ? 'A/B-эксперимент запущен' : 'Основная модель переключена',
      });
      onDone();
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Не удалось переключить',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
        <h3 className="mb-3 text-base font-semibold text-slate-900">
          Переключить основную модель
        </h3>
        <p className="mb-3 text-xs text-slate-500">
          Текущая: <code className="font-mono">{currentPrimary ?? '— не задана —'}</code>
        </p>
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-slate-700">Провайдер</span>
            <select
              value={providerName}
              onChange={(e) =>
                setProviderName(e.target.value as typeof AI_MODELS_PROVIDERS[number])
              }
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
            >
              {AI_MODELS_PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-slate-700">Модель</span>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-700">Доля трафика на новую модель, %</span>
            <input
              type="number"
              min={1}
              max={100}
              value={abPercent}
              onChange={(e) => setAbPercent(Math.max(1, Math.min(100, Number(e.target.value))))}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
            />
            <span className="text-[10px] text-slate-500">
              Если меньше 100 — будет создан A/B-эксперимент.
            </span>
          </label>
          {abPercent < 100 && (
            <label className="block">
              <span className="text-xs text-slate-700">Длительность A/B-эксперимента, дней</span>
              <input
                type="number"
                min={1}
                max={30}
                value={days}
                onChange={(e) => setDays(Math.max(1, Math.min(30, Number(e.target.value))))}
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
              />
            </label>
          )}
          <label className="block">
            <span className="text-xs text-slate-700">Причина переключения*</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
              placeholder="Например: DeepSeek превысил лимит → переключаем на GPT-5.5"
            />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button size="sm" onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : 'Применить'}
          </Button>
        </div>
      </div>
    </div>
  );
}
