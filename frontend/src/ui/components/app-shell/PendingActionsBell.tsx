'use client';

/**
 * PendingActionsBell — глобальный колокольчик Action Center (Фаза B1).
 *
 * Иконка `Bell` + бейдж total + красная точка при наличии «срочных»
 * (urgent / конфликты). По клику — Popover со списком последних pending
 * (limit=8): на каждый — title, чип источника, severity-тон, «Открыть» и
 * «Отложить 1д» (snooze 24ч). Внизу «Смотреть все» → /actions.
 *
 * Монтируется в desktop top-bar (AppShell) и в мобильный Header.
 * Бейдж скрыт при total=0; запрос делается только при наличии orgId.
 *
 * Цвета — только парные токены (никаких text-white / жёстких hex).
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Clock, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/ui/shadcn/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/ui/shadcn/popover';
import { Badge } from '@/ui/shadcn/badge';
import { cn } from '@/ui/shadcn/lib/utils';

import { useAuth } from '@/contexts/auth-context';
import { usePendingActionsCount } from '@/hooks/usePendingActionsCount';
import { usePendingActions } from '@/hooks/usePendingActions';
import {
  formatPendingAge,
  pendingSeverityBadgeVariant,
  type PendingAction,
} from '@/domain/pending-action';

export function PendingActionsBell({ className }: { className?: string }) {
  const router = useRouter();
  const { currentOrgId } = useAuth();
  const [open, setOpen] = useState(false);

  const {
    total,
    hasUrgent,
    mutate: mutateCount,
  } = usePendingActionsCount(currentOrgId, Boolean(currentOrgId));

  // Список тянем только когда поповер открыт — экономим запросы.
  const { items, isLoading, error, snooze, mutate } = usePendingActions(
    currentOrgId,
    8,
    Boolean(currentOrgId) && open,
  );

  const badge = total > 99 ? '99+' : String(total);

  const handleOpen = (action: PendingAction) => {
    setOpen(false);
    router.push(action.actionUrl);
  };

  const handleSnooze = async (action: PendingAction) => {
    try {
      await snooze({
        source: action.source,
        resourceType: action.resourceType,
        resourceId: action.resourceId,
        hours: 24,
      });
      await mutateCount();
      toast.success('Отложено на 1 день.');
    } catch {
      toast.error('Не удалось отложить.');
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('relative', className)}
          aria-label={
            total > 0
              ? `Подтверждения: ${total}`
              : 'Подтверждения'
          }
        >
          <Bell size={18} />
          {total > 0 && (
            <span
              className={cn(
                'absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none',
                'bg-accent text-accent-fg',
              )}
              aria-hidden
            >
              {badge}
            </span>
          )}
          {hasUrgent && (
            <span
              className="absolute right-1 top-1 h-2 w-2 rounded-full bg-danger ring-2 ring-bg-surface"
              aria-hidden
            />
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <span className="text-sm font-semibold text-fg-primary">
            Подтверждения
          </span>
          {total > 0 && (
            <Badge variant="secondary">{badge}</Badge>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto">
          {isLoading && (
            <div className="px-4 py-6 text-center text-sm text-fg-tertiary">
              Загрузка…
            </div>
          )}

          {!isLoading && Boolean(error) && (
            <div className="px-4 py-6 text-center text-sm text-danger">
              Не удалось загрузить.
            </div>
          )}

          {!isLoading && !error && items.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-fg-tertiary">
              Всё разобрано
            </div>
          )}

          {!isLoading && !error && items.length > 0 && (
            <ul className="flex flex-col">
              {items.map((it) => (
                <li
                  key={`${it.source}:${it.resourceId}`}
                  className="border-b border-border-subtle px-4 py-3 last:border-b-0"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg-primary">
                        {it.title}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
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
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={() => handleOpen(it)}
                    >
                      <ExternalLink size={12} />
                      Открыть
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={() => void handleSnooze(it)}
                    >
                      <Clock size={12} />
                      Отложить 1д
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-border-subtle p-2">
          <Button
            variant="ghost"
            className="w-full justify-center text-sm"
            onClick={() => {
              setOpen(false);
              router.push('/actions');
            }}
          >
            Смотреть все
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
