'use client';

/**
 * Фаза A.2 — `/admin/prompts` главная страница (список шаблонов промптов).
 *
 * Фильтры: scope, status, meetingType + поиск.
 * Все строки на русском (memory `feedback_admin_ui_russian_only`).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Plus, Search } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import {
  adminPromptTemplatesApi,
  PROMPT_TASK_TYPES,
  PROMPT_TEMPLATE_SCOPES,
  PROMPT_TEMPLATE_STATUSES,
  type PromptTaskType,
  type PromptTemplateScope,
  type PromptTemplateStatus,
} from '@/api/admin-prompt-templates.api';
import {
  mapPromptTemplate,
  type PromptTemplateUi,
  taskTypeLabel,
  scopeLabel,
  statusLabel,
} from '@/domain/admin-prompt-template';
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

export function PromptsListClient() {

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<PromptTemplateUi[]>([]);
  const [scopeFilter, setScopeFilter] = useState<'all' | PromptTemplateScope>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | PromptTemplateStatus>('all');
  const [taskTypeFilter, setTaskTypeFilter] = useState<'all' | PromptTaskType>('all');
  const [search, setSearch] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminPromptTemplatesApi.list({
        ...(scopeFilter !== 'all' ? { scope: scopeFilter } : {}),
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(taskTypeFilter !== 'all' ? { taskType: taskTypeFilter } : {}),
        ...(search ? { search } : {}),
      });
      setItems(res.items.map(mapPromptTemplate));
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Не удалось загрузить шаблоны';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [scopeFilter, statusFilter, taskTypeFilter, search]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
            Шаблоны промптов
          </h1>
          <p className="text-sm text-fg-secondary">
            Конструктор промптов для AI-отчётов. Системные поставляются с Z, свои создаются под Org.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/prompts/experiments">
            <Button size="sm" variant="outline">
              A/B-эксперименты
            </Button>
          </Link>
          <Link href="/admin/prompts/new">
            <Button size="sm">
              <Plus size={14} className="mr-1" /> Создать шаблон
            </Button>
          </Link>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-tertiary" />
          <input
            type="text"
            placeholder="Поиск по названию или ключу"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-64 rounded-md border border-border-subtle bg-white pl-7 pr-3 text-sm"
          />
        </div>
        <Select
          value={scopeFilter}
          onValueChange={(v) => setScopeFilter(v as 'all' | PromptTemplateScope)}
        >
          <SelectTrigger className="h-9 w-44 bg-white text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все шаблоны</SelectItem>
            {PROMPT_TEMPLATE_SCOPES.map((s) => (
              <SelectItem key={s} value={s}>
                {scopeLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as 'all' | PromptTemplateStatus)}
        >
          <SelectTrigger className="h-9 w-40 bg-white text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            {PROMPT_TEMPLATE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {statusLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={taskTypeFilter}
          onValueChange={(v) => setTaskTypeFilter(v as 'all' | PromptTaskType)}
        >
          <SelectTrigger className="h-9 w-48 bg-white text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все виды отчёта</SelectItem>
            {PROMPT_TASK_TYPES.map((tt) => (
              <SelectItem key={tt} value={tt}>
                {taskTypeLabel(tt)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 text-sm text-fg-secondary">
          <Loader2 size={16} className="mr-2 animate-spin" /> Загружаем…
        </div>
      )}

      {error && !loading && (
        <div className="rounded-md border border-chip-danger-bg bg-chip-danger-bg p-3 text-sm text-chip-danger-fg">
          {error}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="rounded-md border border-dashed border-border-subtle p-8 text-center text-sm text-fg-secondary">
          У вас нет шаблонов под выбранные фильтры. Скопируйте системный или создайте с нуля.
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-white">
          <table className="w-full text-sm">
            <thead className="bg-bg-subtle text-xs uppercase text-fg-secondary">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Название</th>
                <th className="px-3 py-2 text-left font-medium">Вид</th>
                <th className="px-3 py-2 text-left font-medium">Тип встречи</th>
                <th className="px-3 py-2 text-left font-medium">Статус</th>
                <th className="px-3 py-2 text-left font-medium">Источник</th>
                <th className="px-3 py-2 text-right font-medium">Действия</th>
              </tr>
            </thead>
            <tbody>
              {items.map((tpl) => (
                <tr key={tpl.id} className="border-t border-border-subtle">
                  <td className="px-3 py-2">
                    <Link
                      href={`/admin/prompts/${encodeURIComponent(tpl.id)}`}
                      className="font-medium text-fg-primary hover:underline"
                    >
                      {tpl.name}
                    </Link>
                    <div className="text-xs text-fg-secondary">{tpl.key}</div>
                  </td>
                  <td className="px-3 py-2 text-fg-secondary">{tpl.taskTypeLabel}</td>
                  <td className="px-3 py-2 text-fg-secondary">
                    {tpl.meetingTypeLabel ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      variant="outline"
                      className={
                        tpl.statusColor === 'green'
                          ? 'border-chip-success-bg bg-chip-success-bg text-chip-success-fg'
                          : tpl.statusColor === 'amber'
                            ? 'border-chip-warning-bg bg-chip-warning-bg text-chip-warning-fg'
                            : 'border-border-subtle bg-bg-subtle text-fg-secondary'
                      }
                    >
                      {tpl.statusLabel}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-fg-secondary">{tpl.scopeLabel}</td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/admin/prompts/${encodeURIComponent(tpl.id)}`}
                      className="text-xs text-info hover:underline"
                    >
                      Открыть
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
