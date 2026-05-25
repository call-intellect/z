'use client';

import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import { clonesApi } from '@/api/clones.api';
import { Button } from '@/ui/shadcn/button';

/**
 * Фаза 5 «clone reliability hardening» — кнопка «Обновить клона сейчас».
 *
 * Вызывает `POST /api/v1/clones/persons/:personId/persona/snapshot`
 * (`clonesApi.triggerManualPersonaSnapshot`). После успешного клика
 * блокирует себя на 60 секунд и показывает toast «Клон обновляется».
 *
 * Используется:
 *   - На странице `/me/clone` — крупная кнопка в шапке.
 *   - На странице `/persons/[id]/skill-profile` — компактная кнопка
 *     (variant='compact'), доступна только при canMarkMisleading=true.
 *   - В шапке диалога с клоном — иконка-only (variant='iconOnly').
 *
 * Подсказка под кнопкой «Последнее обновление: …» рендерится снаружи —
 * этот компонент знает только про клик.
 */
export type RebuildCloneButtonVariant = 'default' | 'compact' | 'iconOnly';

export function RebuildCloneButton({
  orgId,
  personId,
  variant = 'default',
  onRebuildScheduled,
  disabled,
}: {
  orgId: string;
  personId: string;
  variant?: RebuildCloneButtonVariant;
  /** Колбэк после успешного триггера (для invalidate SWR-кэшей и т.п.). */
  onRebuildScheduled?: () => void;
  /** Внешний disabled — например, нет прав. */
  disabled?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [now, setNow] = useState<number>(Date.now());

  // Тикер для рендера обратного отсчёта.
  useEffect(() => {
    if (!cooldownUntil) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => clearInterval(timer);
  }, [cooldownUntil]);

  const cooldownActive = cooldownUntil !== null && now < cooldownUntil;
  const cooldownLeftSec = cooldownActive
    ? Math.max(0, Math.ceil((cooldownUntil! - now) / 1000))
    : 0;
  const isDisabled = disabled || pending || cooldownActive;

  async function handleClick() {
    if (isDisabled) return;
    setPending(true);
    try {
      await clonesApi.triggerManualPersonaSnapshot(orgId, personId);
      toast.success('Клон обновляется. Это займёт около минуты.');
      setCooldownUntil(Date.now() + 60_000);
      onRebuildScheduled?.();
    } catch (err) {
      const message =
        err instanceof ApiError
          ? (err.payload?.message ?? err.message)
          : 'Не удалось запустить обновление клона. Попробуйте позже.';
      toast.error(message);
    } finally {
      setPending(false);
    }
  }

  if (variant === 'iconOnly') {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={isDisabled}
        onClick={() => void handleClick()}
        title={
          cooldownActive
            ? `Доступно через ${cooldownLeftSec} с`
            : 'Обновить клона сейчас'
        }
        aria-label="Обновить клона"
        data-testid="rebuild-clone-icon"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
      </Button>
    );
  }

  if (variant === 'compact') {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isDisabled}
        onClick={() => void handleClick()}
        data-testid="rebuild-clone-compact"
      >
        {pending ? (
          <Loader2 className="mr-2 h-3 w-3 animate-spin" />
        ) : (
          <RefreshCw className="mr-2 h-3 w-3" />
        )}
        {cooldownActive
          ? `Доступно через ${cooldownLeftSec} с`
          : 'Обновить клона'}
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      disabled={isDisabled}
      onClick={() => void handleClick()}
      data-testid="rebuild-clone-button"
    >
      {pending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <RefreshCw className="mr-2 h-4 w-4" />
      )}
      {cooldownActive
        ? `Доступно через ${cooldownLeftSec} с`
        : 'Обновить клона'}
    </Button>
  );
}

/**
 * Подсказка «Последнее обновление: {дата} …» — Intl.RelativeTimeFormat ru-RU.
 * Если `lastBuildAt` null — показывает «Клон ещё не собирался».
 */
export function formatLastBuildHint(lastBuildAt: string | null): string {
  if (!lastBuildAt) {
    return 'Последнее обновление: клон ещё не собирался. Если ваш стиль работы недавно изменился — нажмите.';
  }
  const built = new Date(lastBuildAt);
  if (Number.isNaN(built.getTime())) {
    return 'Последнее обновление: неизвестно. Если ваш стиль работы недавно изменился — нажмите.';
  }
  const diffMs = built.getTime() - Date.now();
  const diffMin = Math.round(diffMs / 60_000);
  const diffHour = Math.round(diffMs / 3_600_000);
  const diffDay = Math.round(diffMs / (3_600_000 * 24));
  const rtf = new Intl.RelativeTimeFormat('ru-RU', { numeric: 'auto' });
  let relative: string;
  if (Math.abs(diffMin) < 60) {
    relative = rtf.format(diffMin, 'minute');
  } else if (Math.abs(diffHour) < 24) {
    relative = rtf.format(diffHour, 'hour');
  } else {
    relative = rtf.format(diffDay, 'day');
  }
  return `Последнее обновление: ${relative}. Если ваш стиль работы недавно изменился — нажмите.`;
}
