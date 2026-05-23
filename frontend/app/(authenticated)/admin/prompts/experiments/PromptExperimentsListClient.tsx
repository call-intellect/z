'use client';

/**
 * Фаза A.3 — `/admin/prompts/experiments` список A/B-экспериментов на промптах.
 *
 * Источник: ТЗ A §8.1.
 * Все строки на русском (memory `feedback_admin_ui_russian_only`).
 */

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/api/api-error';
import {
  type ExperimentStatusApi,
  type PromptExperimentApi,
  adminPromptExperimentsApi,
} from '@/api/admin-prompt-experiments.api';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';

const STATUS_LABELS: Record<ExperimentStatusApi, string> = {
  draft: 'Черновик',
  running: 'Запущен',
  stopped: 'Остановлен',
  completed: 'Завершён',
};

const STATUS_BADGE_CLASS: Record<ExperimentStatusApi, string> = {
  draft: 'bg-slate-100 text-slate-700',
  running: 'bg-emerald-100 text-emerald-700',
  stopped: 'bg-amber-100 text-amber-700',
  completed: 'bg-slate-100 text-slate-600',
};

export function PromptExperimentsListClient() {
  const [items, setItems] = useState<PromptExperimentApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | ExperimentStatusApi>('all');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminPromptExperimentsApi.list(
        statusFilter !== 'all' ? { status: statusFilter } : undefined,
      );
      setItems(res.items);
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : 'Не удалось загрузить эксперименты';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            A/B-эксперименты по промптам
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Сравните две версии шаблона на реальных встречах и выберите лучшую.
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/prompts/experiments/new">Создать эксперимент</Link>
        </Button>
      </header>

      <div className="mb-4 flex items-center gap-3">
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as 'all' | ExperimentStatusApi)}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            <SelectItem value="draft">Черновик</SelectItem>
            <SelectItem value="running">Запущен</SelectItem>
            <SelectItem value="stopped">Остановлен</SelectItem>
            <SelectItem value="completed">Завершён</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error ? (
        <div className="rounded-md border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800">
          {error}
          <Button variant="outline" size="sm" className="ml-3" onClick={() => void fetchData()}>
            Повторить
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className="text-sm text-slate-500">Загрузка эксперементов…</div>
      ) : items.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          Пока нет ни одного эксперимента. Создайте первый, чтобы сравнить
          две версии шаблона.
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((e) => (
            <li
              key={e.id}
              className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/admin/prompts/experiments/${e.id}`}
                      className="text-base font-semibold text-slate-900 hover:underline"
                    >
                      Эксперимент {e.id.slice(0, 8)}
                    </Link>
                    <Badge className={STATUS_BADGE_CLASS[e.status]}>
                      {STATUS_LABELS[e.status]}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Доля трафика на группу B: {e.splitPercent}% ·{' '}
                    {e.orgId ? `Org ${e.orgId.slice(0, 8)}` : 'Глобальный'}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 text-xs text-slate-500">
                  <div>Создан: {new Date(e.createdAt).toLocaleString('ru-RU')}</div>
                  {e.startedAt ? (
                    <div>Запущен: {new Date(e.startedAt).toLocaleString('ru-RU')}</div>
                  ) : null}
                  {e.endsAt ? (
                    <div>Окончание: {new Date(e.endsAt).toLocaleString('ru-RU')}</div>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
