'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, Loader2 } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import {
  getExistingSubscription,
  getPermission,
  getVapidPublicKey,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
  type PushPermission,
} from '@/lib/pwa/push';
import { Button } from '@/ui/shadcn/button';
import { toast } from '@/ui/shadcn/toast';

type Status = 'loading' | 'idle' | 'busy';

/**
 * UI для подписки на web-push уведомления.
 *
 * Состояния:
 *  - unsupported     : браузер не поддерживает PushManager → disabled + объяснение
 *  - vapid-missing   : не сконфигурирован VAPID public key → disabled + TODO
 *  - default         : кнопка «Включить push»
 *  - granted+sub     : кнопка «Отключить push» + статус «Включены»
 *  - denied          : disabled + инструкция как разрешить в настройках браузера
 *  - busy            : спиннер
 */
export function PushSubscriptionToggle() {
  const [status, setStatus] = useState<Status>('loading');
  const [permission, setPermission] = useState<PushPermission>('default');
  const [hasSubscription, setHasSubscription] = useState(false);
  const supported = isPushSupported();
  const vapidKey = getVapidPublicKey();

  // Первичная синхронизация состояния
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!supported) {
        if (!cancelled) {
          setPermission('unsupported');
          setStatus('idle');
        }
        return;
      }
      const perm = getPermission();
      const sub = await getExistingSubscription();
      if (cancelled) return;
      setPermission(perm);
      setHasSubscription(Boolean(sub));
      setStatus('idle');
    })();
    return () => {
      cancelled = true;
    };
  }, [supported]);

  const onSubscribe = useCallback(async () => {
    setStatus('busy');
    try {
      await subscribeToPush();
      setPermission(getPermission());
      setHasSubscription(true);
      toast.success('Push-уведомления включены');
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Не удалось включить уведомления';
      toast.error(message);
    } finally {
      setStatus('idle');
    }
  }, []);

  const onUnsubscribe = useCallback(async () => {
    setStatus('busy');
    try {
      const ok = await unsubscribeFromPush();
      if (ok) {
        setHasSubscription(false);
        toast.success('Push-уведомления отключены');
      } else {
        toast.message('Активной подписки не было');
        setHasSubscription(false);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Не удалось отключить уведомления';
      toast.error(message);
    } finally {
      setStatus('idle');
    }
  }, []);

  // Не поддерживается браузером
  if (permission === 'unsupported') {
    return (
      <ToggleShell
        title="Push-уведомления"
        description="Ваш браузер не поддерживает push-уведомления. Откройте Кору в Chrome, Edge, Firefox или установите PWA на устройство."
        action={
          <Button variant="secondary" size="sm" disabled>
            <BellOff size={14} /> Недоступно
          </Button>
        }
      />
    );
  }

  // VAPID не настроен → graceful disable
  if (!vapidKey) {
    return (
      <ToggleShell
        title="Push-уведомления"
        description="Уведомления временно недоступны. Администратор ещё не настроил серверные ключи (VAPID)."
        action={
          <Button variant="secondary" size="sm" disabled>
            <BellOff size={14} /> Скоро
          </Button>
        }
      />
    );
  }

  // Запрещено в браузере
  if (permission === 'denied') {
    return (
      <ToggleShell
        title="Push-уведомления"
        description="Уведомления заблокированы в настройках браузера. Откройте настройки сайта, разрешите уведомления и обновите страницу."
        action={
          <Button variant="secondary" size="sm" disabled>
            <BellOff size={14} /> Заблокировано
          </Button>
        }
      />
    );
  }

  const isBusy = status === 'busy' || status === 'loading';

  if (hasSubscription && permission === 'granted') {
    return (
      <ToggleShell
        title="Push-уведомления"
        description="Кора будет присылать уведомления о новых задачах, упоминаниях и важных событиях."
        statusBadge={<span className="text-success">Включены</span>}
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void onUnsubscribe()}
            disabled={isBusy}
          >
            {isBusy ? <Loader2 size={14} className="animate-spin" /> : <BellOff size={14} />}
            Отключить
          </Button>
        }
      />
    );
  }

  return (
    <ToggleShell
      title="Push-уведомления"
      description="Получайте уведомления о новых задачах, упоминаниях и важных событиях, даже когда Кора закрыта."
      action={
        <Button
          variant="default"
          size="sm"
          onClick={() => void onSubscribe()}
          disabled={isBusy}
        >
          {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Bell size={14} />}
          Включить push
        </Button>
      }
    />
  );
}

function ToggleShell({
  title,
  description,
  action,
  statusBadge,
}: {
  title: string;
  description: string;
  action: React.ReactNode;
  statusBadge?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium text-fg-primary">
          {title}
          {statusBadge ? (
            <span className="text-xs font-normal">{statusBadge}</span>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-fg-secondary">{description}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}
