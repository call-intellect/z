'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Loader2,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';

import { ApiError } from '@/api/api-error';
import {
  adminLlmRoutesApi,
  LLM_PROVIDERS,
  LLM_TASK_TYPES,
  type LlmProvider,
  type LlmRouteApi,
  type LlmRouteProvider,
  type LlmTaskType,
} from '@/api/admin-llm-routes.api';
import { useToast } from '@/contexts/toast-context';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';
import { cn } from '@/ui/shadcn/lib/utils';

const TASK_LABEL: Record<LlmTaskType, string> = {
  summary: 'Summary',
  chapters: 'Chapters',
  tasks: 'Tasks',
  chat: 'Chat',
  'regenerate-section': 'Regenerate section',
  'custom-prompt': 'Custom prompt',
  'follow-up': 'Follow-up',
  'clip-title': 'Clip title',
};

type RouteState = {
  providers: LlmRouteProvider[];
  isActive: boolean;
  dirty: boolean;
  saving: boolean;
};

export function AiModelsClient() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [routes, setRoutes] = useState<Record<LlmTaskType, RouteState>>(() =>
    initialEmpty(),
  );

  const fetchRoutes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminLlmRoutesApi.list();
      const map = initialEmpty();
      for (const r of res.items) {
        if (LLM_TASK_TYPES.includes(r.taskType)) {
          map[r.taskType] = {
            providers: r.providers,
            isActive: r.isActive,
            dirty: false,
            saving: false,
          };
        }
      }
      setRoutes(map);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить роуты');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchRoutes();
  }, [fetchRoutes]);

  const updateRoute = useCallback(
    (taskType: LlmTaskType, patch: Partial<RouteState>) => {
      setRoutes((prev) => ({
        ...prev,
        [taskType]: { ...prev[taskType], ...patch, dirty: true },
      }));
    },
    [],
  );

  const handleSave = async (taskType: LlmTaskType) => {
    const state = routes[taskType];
    if (state.providers.length === 0) {
      addToast({ type: 'error', message: 'Нужен хотя бы один provider' });
      return;
    }
    setRoutes((prev) => ({
      ...prev,
      [taskType]: { ...prev[taskType], saving: true },
    }));
    try {
      await adminLlmRoutesApi.upsert(taskType, {
        providers: state.providers,
        isActive: state.isActive,
      });
      setRoutes((prev) => ({
        ...prev,
        [taskType]: { ...prev[taskType], dirty: false, saving: false },
      }));
      addToast({
        type: 'success',
        message: 'Сохранено. Применится через ~60 секунд (cache).',
      });
    } catch (e) {
      setRoutes((prev) => ({
        ...prev,
        [taskType]: { ...prev[taskType], saving: false },
      }));
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Не удалось сохранить',
      });
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          AI Models — маршрутизация LLM
        </h1>
        <p className="text-sm text-slate-600">
          На каждый тип задачи — порядок провайдеров (fallback). Если первый недоступен —
          используется следующий.
        </p>
      </header>

      {loading && (
        <div className="flex items-center justify-center py-16 text-sm text-slate-500">
          <Loader2 size={16} className="mr-2 animate-spin" /> Загружаем...
        </div>
      )}

      {error && !loading && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && (
        <ul className="space-y-3">
          {LLM_TASK_TYPES.map((taskType) => (
            <RouteCard
              key={taskType}
              taskType={taskType}
              state={routes[taskType]}
              onUpdate={(patch) => updateRoute(taskType, patch)}
              onSave={() => void handleSave(taskType)}
            />
          ))}
        </ul>
      )}

      {/* Метрики */}
      <div className="mt-8 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">Метрики dispatch</h2>
        <p className="mt-1 text-xs text-slate-600">
          Метрика <code className="rounded bg-slate-100 px-1 py-0.5 font-mono">llm_router_dispatch_total{`{task_type}`}</code>
          {' '}доступна в Prometheus. Полные дашборды — в Grafana.
        </p>
        <a
          href="/grafana"
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
        >
          Открыть Grafana <ExternalLink size={11} />
        </a>
      </div>
    </div>
  );
}

function RouteCard({
  taskType,
  state,
  onUpdate,
  onSave,
}: {
  taskType: LlmTaskType;
  state: RouteState;
  onUpdate: (patch: Partial<RouteState>) => void;
  onSave: () => void;
}) {
  const [newProvider, setNewProvider] = useState<LlmProvider>('anthropic');

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...state.providers];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    onUpdate({ providers: next });
  };

  const remove = (idx: number) => {
    onUpdate({ providers: state.providers.filter((_, i) => i !== idx) });
  };

  const add = () => {
    if (state.providers.some((p) => p.provider === newProvider)) return;
    onUpdate({ providers: [...state.providers, { provider: newProvider }] });
  };

  const availableNew = useMemo(
    () =>
      LLM_PROVIDERS.filter(
        (p) => !state.providers.some((sp) => sp.provider === p),
      ),
    [state.providers],
  );

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-3">
        <h3 className="text-base font-semibold text-slate-900">
          {TASK_LABEL[taskType]}
        </h3>
        <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
          {taskType}
        </code>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-slate-600">Активен</span>
          <Switch
            checked={state.isActive}
            onCheckedChange={(v) => onUpdate({ isActive: v })}
          />
        </div>
      </div>

      <ul className="space-y-1">
        {state.providers.length === 0 && (
          <li className="rounded-md border border-dashed border-slate-200 p-3 text-center text-xs text-slate-500">
            Нет провайдеров. Добавьте хотя бы один.
          </li>
        )}
        {state.providers.map((p, idx) => (
          <li
            key={`${p.provider}-${idx}`}
            className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 text-sm"
          >
            <Badge variant="secondary" className="text-[10px]">
              #{idx + 1}
            </Badge>
            <span className="font-mono text-xs text-slate-900">{p.provider}</span>
            {p.model && (
              <span className="text-[11px] text-slate-500">model: {p.model}</span>
            )}
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                className={cn(
                  'rounded p-1 text-slate-500 hover:bg-slate-200 disabled:opacity-30',
                )}
                disabled={idx === 0}
                onClick={() => move(idx, -1)}
                aria-label="Выше"
              >
                <ArrowUp size={12} />
              </button>
              <button
                type="button"
                className={cn(
                  'rounded p-1 text-slate-500 hover:bg-slate-200 disabled:opacity-30',
                )}
                disabled={idx === state.providers.length - 1}
                onClick={() => move(idx, 1)}
                aria-label="Ниже"
              >
                <ArrowDown size={12} />
              </button>
              <button
                type="button"
                className="rounded p-1 text-slate-500 hover:bg-red-100 hover:text-red-600"
                onClick={() => remove(idx)}
                aria-label="Удалить"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex items-center gap-2">
        {availableNew.length > 0 && (
          <>
            <Select
              value={newProvider}
              onValueChange={(v) => setNewProvider(v as LlmProvider)}
            >
              <SelectTrigger className="h-8 w-48 bg-white text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableNew.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="secondary" onClick={add}>
              <Plus size={12} /> Добавить provider
            </Button>
          </>
        )}
        <Button
          size="sm"
          className="ml-auto"
          onClick={onSave}
          disabled={!state.dirty || state.saving}
        >
          {state.saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          Сохранить
        </Button>
      </div>
    </li>
  );
}

function initialEmpty(): Record<LlmTaskType, RouteState> {
  const r = {} as Record<LlmTaskType, RouteState>;
  for (const t of LLM_TASK_TYPES) {
    r[t] = { providers: [], isActive: true, dirty: false, saving: false };
  }
  return r;
}
