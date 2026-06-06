'use client';

/**
 * `/actions` — Action Center: «Требует вашего подтверждения» (Фаза B1).
 *
 * Список pending-подтверждений пользователя из четырёх источников
 * (карточки знаний / конфликты / задачи из встреч / вопросы Коры) с
 * фильтром по источнику, deep-link «Открыть» и «Отложить» (1д/3д/7д).
 *
 * Цвета — только парные токены (chip-* / bg-* + text-*-fg). Состояния
 * loading / error / empty покрыты.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Clock, ExternalLink, Inbox } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/ui/shadcn/button';
import { Badge } from '@/ui/shadcn/badge';
import { Tabs, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/shadcn/dropdown-menu';

import { useAuth } from '@/contexts/auth-context';
import { usePendingActions } from '@/hooks/usePendingActions';
import { usePendingActionsCount } from '@/hooks/usePendingActionsCount';
import {
  formatPendingAge,
  pendingSeverityBadgeVariant,
  PENDING_SOURCE_LABEL,
  type PendingAction,
  type PendingActionSource,
} from '@/domain/pending-action';

type SourceFilter = 'all' | PendingActionSource;

const FILTER_TABS: { value: SourceFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'curation', label: PENDING_SOURCE_LABEL.curation },
  { value: 'conflict', label: PENDING_SOURCE_LABEL.conflict },
  { value: 'intake', label: PENDING_SOURCE_LABEL.intake },
  { value: 'probe', label: PENDING_SOURCE_LABEL.probe },
];

const SNOOZE_OPTIONS: { hours: number; label: string }[] = [
  { hours: 24, label: 'На 1 день' },
  { hours: 72, label: 'На 3 дня' },
  { hours: 168, label: 'На 7 дней' },
];

export function ActionsClient() {
  const router = useRouter();
  const { currentOrgId } = useAuth();
  const [filter, setFilter] = useState<SourceFilter>('all');

  const { items, isLoading, error, snooze, confirm } = usePendingActions(
    currentOrgId,
    50,
    Boolean(currentOrgId),
  );
  const { mutate: mutateCount } = usePendingActionsCount(
    currentOrgId,
    Boolean(currentOrgId),
  );

  const filtered = useMemo<PendingAction[]>(
    () =>
      filter === 'all'
        ? items
        : items.filter((it) => it.source === filter),
    [items, filter],
  );

  const handleOpen = (action: PendingAction) => {
    router.push(action.actionUrl);
  };

  const handleSnooze = async (action: PendingAction, hours: number) => {
    try {
      await snooze({
        source: action.source,
        resourceType: action.resourceType,
        resourceId: action.resourceId,
        hours,
      });
      await mutateCount();
      toast.success('Отложено.');
    } catch {
      toast.error('Не удалось отложить.');
    }
  };

  const handleConfirm = async (action: PendingAction) => {
    try {
      await confirm(action);
      await mutateCount();
      toast.success('Подтверждено.');
    } catch {
      toast.error('Не удалось подтвердить.');
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
          Требует вашего подтверждения
        </h1>
        <p className="mt-1 text-sm text-fg-tertiary">
          Карточки знаний, конфликты, задачи из встреч и вопросы Коры,
          которые ждут вашего решения.
        </p>
        <p className="mt-1 text-xs text-fg-tertiary">
          «Открыть» ведёт туда, где можно ответить или решить. Вопросы Коры
          также приходят в ваши каналы (Telegram, почта) — ответить можно и
          там.
        </p>
      </header>

      <Tabs
        value={filter}
        onValueChange={(v) => setFilter(v as SourceFilter)}
        className="mb-4"
      >
        <TabsList className="flex flex-wrap">
          {FILTER_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isLoading && (
        <div className="rounded-lg border border-border-subtle bg-bg-surface px-4 py-10 text-center text-sm text-fg-tertiary">
          Загрузка…
        </div>
      )}

      {!isLoading && Boolean(error) && (
        <div className="rounded-lg border border-danger/30 bg-danger/15 px-4 py-10 text-center text-sm text-danger">
          Не удалось загрузить подтверждения. Попробуйте обновить страницу.
        </div>
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border-subtle bg-bg-surface px-4 py-12 text-center">
          <Inbox size={32} className="text-fg-tertiary" />
          <div>
            <p className="text-sm font-medium text-fg-primary">
              Всё разобрано
            </p>
            <p className="mt-1 text-sm text-fg-tertiary">
              Сейчас ничего не ждёт вашего подтверждения.
            </p>
          </div>
        </div>
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <ul className="flex flex-col gap-2">
          {filtered.map((it) => (
            <li
              key={`${it.source}:${it.resourceId}`}
              className="rounded-lg border border-border-subtle bg-bg-surface p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-fg-primary">
                    {it.title}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge variant={pendingSeverityBadgeVariant(it.severity)}>
                      {it.sourceLabel}
                    </Badge>
                    {it.severity === 'urgent' && (
                      <Badge variant="danger">Срочно</Badge>
                    )}
                    <span className="text-xs text-fg-tertiary">
                      {formatPendingAge(it.ageDays)}
                    </span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {it.canQuickConfirm && (
                    <Button
                      size="sm"
                      className="gap-1 bg-success text-success-fg hover:bg-success/90"
                      onClick={() => void handleConfirm(it)}
                    >
                      <Check size={14} />
                      Подтвердить
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() => handleOpen(it)}
                  >
                    <ExternalLink size={14} />
                    Открыть
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="ghost" className="gap-1">
                        <Clock size={14} />
                        Отложить
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {SNOOZE_OPTIONS.map((opt) => (
                        <DropdownMenuItem
                          key={opt.hours}
                          onSelect={() => void handleSnooze(it, opt.hours)}
                        >
                          {opt.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
