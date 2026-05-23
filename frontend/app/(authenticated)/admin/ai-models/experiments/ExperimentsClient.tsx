'use client';

/**
 * Фаза A.4 — `/admin/ai-models/experiments` — список A/B-экспериментов
 * на уровне моделей. Отдельно от prompt-экспериментов (там же на той же странице).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Play, Square } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import {
  adminAiModelsApi,
  type ModelExperimentApi,
} from '@/api/admin-ai-models.api';
import { useToast } from '@/contexts/toast-context';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

export function ExperimentsClient() {
  const { addToast } = useToast();
  const [items, setItems] = useState<ModelExperimentApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminAiModelsApi.experimentsList();
      setItems(res.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleStop = async (id: string) => {
    try {
      await adminAiModelsApi.experimentStop(id);
      addToast({ type: 'success', message: 'Эксперимент остановлен' });
      await refresh();
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Не удалось остановить',
      });
    }
  };

  const handleStart = async (id: string) => {
    try {
      await adminAiModelsApi.experimentStart(id);
      addToast({ type: 'success', message: 'Эксперимент запущен' });
      await refresh();
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Не удалось запустить',
      });
    }
  };

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6">
        <Link
          href="/admin/ai-models"
          className="mb-2 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={12} /> К моделям агентов
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          A/B-эксперименты моделей
        </h1>
        <p className="text-sm text-slate-600">
          Сравнение control vs variant на части трафика. Запуск — со страницы
          конкретного агента, через «Переключить основную модель» с долей &lt; 100%.
        </p>
      </header>

      {loading && (
        <div className="flex items-center justify-center py-16 text-sm text-slate-500">
          <Loader2 size={16} className="mr-2 animate-spin" /> Загружаем…
        </div>
      )}
      {error && <div className="text-sm text-red-700">{error}</div>}
      {!loading && items.length === 0 && (
        <div className="rounded-md border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
          Нет активных экспериментов.
        </div>
      )}

      <div className="space-y-3">
        {items.map((exp) => (
          <div
            key={exp.id}
            className="rounded-lg border border-slate-200 bg-white p-4"
          >
            <div className="mb-2 flex items-center gap-3">
              <code className="font-mono text-xs text-slate-700">{exp.taskType}</code>
              <Badge variant="outline" className="text-[10px]">
                {exp.status === 'draft'
                  ? 'черновик'
                  : exp.status === 'running'
                    ? 'идёт'
                    : exp.status === 'stopped'
                      ? 'остановлен'
                      : 'завершён'}
              </Badge>
              <div className="ml-auto flex gap-1">
                {exp.status === 'draft' && (
                  <Button size="sm" variant="secondary" onClick={() => void handleStart(exp.id)}>
                    <Play size={11} /> Старт
                  </Button>
                )}
                {exp.status === 'running' && (
                  <Button size="sm" variant="ghost" onClick={() => void handleStop(exp.id)}>
                    <Square size={11} /> Стоп
                  </Button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-slate-500">Контроль</div>
                <div className="font-medium text-slate-900">
                  {exp.controlProvider} / {exp.controlModel}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Вариант ({exp.splitPercent}% трафика)</div>
                <div className="font-medium text-slate-900">
                  {exp.variantProvider} / {exp.variantModel}
                </div>
              </div>
            </div>
            {exp.notes && <div className="mt-2 text-xs text-slate-600">{exp.notes}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
