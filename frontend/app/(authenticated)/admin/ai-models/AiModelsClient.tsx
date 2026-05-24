'use client';

/**
 * Фаза A.4 — `/admin/ai-models` главная страница.
 *
 * Таблица всех `taskType`-ов с цепочкой primary/secondary/tertiary.
 * Группировка по: AI-конвейер встреч / База знаний / Паритет с конкурентами.
 * Источник данных — `adminAiModelsApi.list()` (новый API).
 *
 * Все строки на русском (memory `feedback_admin_ui_russian_only`).
 *
 * Связанные страницы:
 *   - `/admin/ai-models/[taskType]` — детальная карточка с метриками и audit.
 *   - `/admin/ai-models/experiments` — A/B-эксперименты на моделях.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Loader2, Search } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import {
  AI_MODELS_GROUPS,
  adminAiModelsApi,
  type AiModelGroup,
} from '@/api/admin-ai-models.api';
import { mapTaskTypeRoute, type TaskTypeRouteUi } from '@/domain/admin-ai-model';
import { toast } from 'sonner';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';

export function AiModelsClient() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<TaskTypeRouteUi[]>([]);
  const [groupFilter, setGroupFilter] = useState<'all' | AiModelGroup>('all');
  const [search, setSearch] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminAiModelsApi.list({
        ...(groupFilter !== 'all' ? { group: groupFilter } : {}),
        ...(search ? { search } : {}),
      });
      setItems(res.items.map(mapTaskTypeRoute));
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Не удалось загрузить модели';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [groupFilter, search]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const grouped = useMemo(() => {
    const map = new Map<string, TaskTypeRouteUi[]>();
    for (const it of items) {
      const list = map.get(it.group) ?? [];
      list.push(it);
      map.set(it.group, list);
    }
    return Array.from(map.entries());
  }, [items]);

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Модели агентов
          </h1>
          <p className="text-sm text-slate-600">
            Цепочка моделей primary → secondary → tertiary для каждого AI-агента.
            Источник дефолтов — playbook §2.1.
          </p>
        </div>
        <Link href="/admin/ai-models/experiments">
          <Button variant="secondary" size="sm">
            A/B-эксперименты
          </Button>
        </Link>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Поиск по taskType"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-64 rounded-md border border-slate-200 bg-white pl-7 pr-3 text-sm"
          />
        </div>
        <Select
          value={groupFilter}
          onValueChange={(v) => setGroupFilter(v as 'all' | AiModelGroup)}
        >
          <SelectTrigger className="h-9 w-56 bg-white text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все группы</SelectItem>
            {AI_MODELS_GROUPS.map((g) => (
              <SelectItem key={g} value={g}>
                {g === 'ai-pipeline'
                  ? 'AI-конвейер встреч'
                  : g === 'knowledge-core'
                    ? 'База знаний'
                    : 'Паритет с конкурентами'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 text-sm text-slate-500">
          <Loader2 size={16} className="mr-2 animate-spin" /> Загружаем…
        </div>
      )}

      {error && !loading && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="rounded-md border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
          Пока нет ни одной записи. Запустите{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5 font-mono">
            bun run scripts/seed-llm-task-routes-default.ts
          </code>{' '}
          на проде, чтобы применить дефолтные цепочки из playbook §2.1.
        </div>
      )}

      {grouped.map(([group, list]) => (
        <section key={group} className="mb-8">
          <h2 className="mb-3 text-base font-semibold text-slate-900">
            {list[0]?.groupLabel ?? group}
            <span className="ml-2 text-xs font-normal text-slate-500">
              {list.length} агентов
            </span>
          </h2>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Задача</th>
                  <th className="px-3 py-2 text-left font-medium">Основная</th>
                  <th className="px-3 py-2 text-left font-medium">Запасная</th>
                  <th className="px-3 py-2 text-left font-medium">Локальная</th>
                  <th className="w-24 px-3 py-2 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {list.map((row) => (
                  <tr key={row.taskType} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <code className="font-mono text-xs text-slate-700">{row.taskType}</code>
                    </td>
                    <td className="px-3 py-2">
                      <TierBadge color="green" label="primary" entry={row.primary} />
                    </td>
                    <td className="px-3 py-2">
                      <TierBadge color="orange" label="secondary" entry={row.secondary} />
                    </td>
                    <td className="px-3 py-2">
                      <TierBadge color="gray" label="tertiary" entry={row.tertiary} />
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Link
                        href={`/admin/ai-models/${encodeURIComponent(row.taskType)}`}
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                      >
                        Подробно <ExternalLink size={11} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

function TierBadge({
  color,
  label,
  entry,
}: {
  color: 'green' | 'orange' | 'gray';
  label: string;
  entry: TaskTypeRouteUi['primary'];
}) {
  if (!entry) {
    return (
      <span className="text-xs text-slate-400">— не задана —</span>
    );
  }
  const colorClass =
    color === 'green'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : color === 'orange'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-slate-100 text-slate-600 border-slate-200';
  return (
    <div className="flex flex-col gap-1">
      <Badge variant="outline" className={`w-fit border ${colorClass} text-[10px]`}>
        {label}
      </Badge>
      <div className="text-xs">
        <span className="font-medium text-slate-900">{entry.providerLabel}</span>
        {entry.model && (
          <span className="ml-1 text-slate-500">/ {entry.model}</span>
        )}
      </div>
    </div>
  );
}
