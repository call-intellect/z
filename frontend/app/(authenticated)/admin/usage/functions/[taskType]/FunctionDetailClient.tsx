'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  FlaskConical,
  Loader2,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';

import { ApiError } from '@/api/api-error';
import {
  adminLlmRoutesApi,
  LLM_PROVIDERS,
  type LlmProvider,
  type LlmRouteProvider,
} from '@/api/admin-llm-routes.api';
import { adminFunctionsApi } from '@/api/admin-experiments.api';
import { adminUsageApi } from '@/api/admin-usage.api';
import {
  adminCallsLogFromApi,
  formatDurationMs,
  formatUsd,
} from '@/domain/admin-usage';
import {
  adminFunctionDetailFromApi,
  taskTypeLabel,
} from '@/domain/admin-experiment';
import { toast } from 'sonner';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/ui/shadcn/card';
import { Input } from '@/ui/shadcn/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
  AdminLoadingInline,
} from '../../../AdminStateViews';
import { useAdminQuery } from '../../../useAdminQuery';
import { ExperimentStartDialog } from '../../../experiments/ExperimentStartDialog';

export function FunctionDetailClient({ taskType }: { taskType: string }) {
  const [providers, setProviders] = useState<LlmRouteProvider[] | null>(null);
  const [isActive, setIsActive] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAbDialog, setShowAbDialog] = useState(false);

  const detailQ = useAdminQuery(
    `admin-fn:${taskType}`,
    async () => {
      const res = await adminFunctionsApi.detail(taskType);
      return adminFunctionDetailFromApi(res);
    },
    [taskType],
  );

  const callsQ = useAdminQuery(
    `admin-fn-calls:${taskType}`,
    async () => {
      const res = await adminUsageApi.getFunctionCalls(taskType, { limit: 10 });
      return adminCallsLogFromApi({ items: res.items, nextCursor: null });
    },
    [taskType],
  );

  // При загрузке detail — синхронизируем state редактирования.
  if (detailQ.data && providers === null) {
    setProviders(detailQ.data.providers as LlmRouteProvider[]);
    setIsActive(detailQ.data.isActive);
  }

  const handleSave = useCallback(async () => {
    if (!providers || providers.length === 0) {
      toast.error('Нужен хотя бы один provider');
      return;
    }
    setSaving(true);
    try {
      await adminLlmRoutesApi.upsert(taskType as never, {
        providers,
        isActive,
      });
      toast.success('Сохранено. Применится через ~60 секунд.');
      setDirty(false);
      detailQ.refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  }, [detailQ, isActive, providers, taskType]);

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/admin/usage/functions">
          <ArrowLeft size={14} /> К списку функций
        </Link>
      </Button>

      <header>
        <h1 className="text-2xl font-semibold">
          {taskTypeLabel(taskType)}
        </h1>
        <p className="text-sm text-fg-tertiary">
          <code className="rounded bg-bg-overlay px-1.5 py-0.5 font-mono text-xs">
            {taskType}
          </code>
        </p>
      </header>

      {detailQ.isLoading && <AdminLoading rows={4} />}
      {!detailQ.isLoading && detailQ.isForbidden && <AdminForbidden />}
      {!detailQ.isLoading && detailQ.error && (
        <AdminError message={detailQ.error} onRetry={detailQ.refetch} />
      )}

      {!detailQ.isLoading && detailQ.data && providers && (
        <>
          {/* Experiment status (если активен) */}
          {detailQ.data.experiment && (
            <Card className="border-accent/40 bg-accent-muted/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FlaskConical size={16} className="text-accent" />
                  Активный A/B-эксперимент
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div>
                  Model A: <code className="font-mono">{detailQ.data.experiment.modelA}</code>
                </div>
                <div>
                  Model B: <code className="font-mono">{detailQ.data.experiment.modelB}</code>
                </div>
                <div>
                  Split: {detailQ.data.experiment.splitPercent}% / {100 - detailQ.data.experiment.splitPercent}%
                </div>
                <Button asChild size="sm" variant="outline" className="mt-2">
                  <Link href={`/admin/experiments/${encodeURIComponent(taskType)}`}>
                    Перейти к эксперименту
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Provider chain */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Цепочка провайдеров</CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-xs text-fg-tertiary">Активна</span>
                <Switch
                  checked={isActive}
                  onCheckedChange={(v) => {
                    setIsActive(v);
                    setDirty(true);
                  }}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <ProviderEditor
                providers={providers}
                onChange={(next) => {
                  setProviders(next);
                  setDirty(true);
                }}
              />
              <div className="flex items-center justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAbDialog(true)}
                  disabled={detailQ.data.experiment !== null}
                >
                  <FlaskConical size={14} /> Запустить A/B
                </Button>
                <Button
                  size="sm"
                  onClick={() => void handleSave()}
                  disabled={!dirty || saving}
                >
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Сохранить
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Recent calls */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Последние 10 вызовов</CardTitle>
            </CardHeader>
            <CardContent>
              {callsQ.isLoading ? (
                <AdminLoadingInline />
              ) : callsQ.data && callsQ.data.items.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-fg-tertiary">
                      <tr>
                        <th className="px-2 py-1 text-left">Когда</th>
                        <th className="px-2 py-1 text-left">Модель</th>
                        <th className="px-2 py-1 text-right">In/Out</th>
                        <th className="px-2 py-1 text-right">Cost</th>
                        <th className="px-2 py-1 text-right">Latency</th>
                        <th className="px-2 py-1 text-left">Статус</th>
                        <th className="px-2 py-1"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {callsQ.data.items.map((c) => (
                        <tr
                          key={c.id}
                          className="border-t border-border-subtle"
                        >
                          <td className="px-2 py-1 text-fg-tertiary">
                            {c.createdAt.toLocaleString('ru-RU')}
                          </td>
                          <td className="px-2 py-1 font-mono">
                            {c.provider}:{c.model}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">
                            {c.inputTokens}/{c.outputTokens}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">
                            {formatUsd(c.costUsd)}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">
                            {formatDurationMs(c.durationMs)}
                          </td>
                          <td className="px-2 py-1">
                            {c.success ? (
                              <Badge variant="secondary">ok</Badge>
                            ) : (
                              <Badge variant="danger">fail</Badge>
                            )}
                          </td>
                          <td className="px-2 py-1 text-right">
                            <Link
                              href={`/admin/usage/functions/${encodeURIComponent(taskType)}/calls/${encodeURIComponent(c.id)}`}
                              className="text-accent hover:underline"
                            >
                              открыть
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-fg-tertiary">
                  За последнее время вызовов нет.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {showAbDialog && (
        <ExperimentStartDialog
          taskType={taskType}
          onClose={() => setShowAbDialog(false)}
          onStarted={() => {
            setShowAbDialog(false);
            detailQ.refetch();
          }}
        />
      )}
    </div>
  );
}

function ProviderEditor({
  providers,
  onChange,
}: {
  providers: LlmRouteProvider[];
  onChange: (next: LlmRouteProvider[]) => void;
}) {
  const [newProvider, setNewProvider] = useState<LlmProvider>('anthropic');
  const [newModel, setNewModel] = useState('');

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...providers];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target]!, next[idx]!];
    onChange(next);
  };

  const remove = (idx: number) => {
    onChange(providers.filter((_, i) => i !== idx));
  };

  const add = () => {
    onChange([
      ...providers,
      newModel
        ? { provider: newProvider, model: newModel }
        : { provider: newProvider },
    ]);
    setNewModel('');
  };

  return (
    <div>
      <ul className="space-y-1">
        {providers.length === 0 && (
          <li className="rounded-md border border-dashed border-border-subtle p-3 text-center text-xs text-fg-tertiary">
            Нет провайдеров. Добавьте хотя бы один.
          </li>
        )}
        {providers.map((p, idx) => (
          <li
            key={`${p.provider}-${idx}`}
            className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-card p-2 text-sm"
          >
            <Badge variant="secondary" className="text-[10px]">
              #{idx + 1}
            </Badge>
            <span className="font-mono text-xs">{p.provider}</span>
            {p.model && (
              <span className="text-[11px] text-fg-tertiary">model: {p.model}</span>
            )}
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                className="rounded p-1 text-fg-tertiary hover:bg-bg-overlay disabled:opacity-30"
                disabled={idx === 0}
                onClick={() => move(idx, -1)}
                aria-label="Выше"
              >
                <ArrowUp size={12} />
              </button>
              <button
                type="button"
                className="rounded p-1 text-fg-tertiary hover:bg-bg-overlay disabled:opacity-30"
                disabled={idx === providers.length - 1}
                onClick={() => move(idx, 1)}
                aria-label="Ниже"
              >
                <ArrowDown size={12} />
              </button>
              <button
                type="button"
                className="rounded p-1 text-fg-tertiary hover:bg-danger/15 hover:text-danger"
                onClick={() => remove(idx)}
                aria-label="Удалить"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Select
          value={newProvider}
          onValueChange={(v) => setNewProvider(v as LlmProvider)}
        >
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LLM_PROVIDERS.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="model (опционально)"
          value={newModel}
          onChange={(e) => setNewModel(e.target.value)}
          className="h-8 max-w-[260px] text-xs"
        />
        <Button size="sm" variant="secondary" onClick={add}>
          <Plus size={12} /> Добавить
        </Button>
      </div>
    </div>
  );
}
