'use client';

/**
 * Кнопка «Включить утренние напоминания» + установка PWA.
 *
 * ТЗ 2026-06-11 mobile-cora-exec-manager, Ф0. Вызывает `subscribeToPush`
 * (`src/lib/pwa/push.ts`). Разделяет три платформенных пути:
 *   - iOS Safari: нет `beforeinstallprompt` → инструкция «Поделиться → На
 *     экран Домой» (push работает только из установленного PWA на iOS 16.4+).
 *   - Android/Chrome: ловим `beforeinstallprompt`, показываем плашку установки.
 *   - Остальное (десктоп-браузеры): просто запрос разрешения на уведомления.
 *
 * VAPID-ключи — prod-ENV (не наша забота: при отсутствии `subscribeToPush`
 * кинет понятную русскую ошибку, ловим в toast). Голосового/звукового вывода
 * нет — только текст.
 */

import { useEffect, useState } from 'react';
import { Bell, Share, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/ui/shadcn/button';
import {
  getPermission,
  isPushSupported,
  subscribeToPush,
} from '@/lib/pwa/push';

/**
 * Минимальный тип события установки PWA (Chrome/Android). В lib.dom его нет,
 * объявляем локально — не трогаем глобальные типы.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // iPad на iPadOS 13+ выдаёт себя за Mac — добавляем проверку touch.
  const iOsUa = /iPad|iPhone|iPod/.test(ua);
  const iPadOs = ua.includes('Macintosh') && navigator.maxTouchPoints > 1;
  return iOsUa || iPadOs;
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari-специфичный флаг
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function EnableMorningRemindersButton() {
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [granted, setGranted] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    setGranted(getPermission() === 'granted');

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () =>
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  async function handleEnable() {
    if (!isPushSupported()) {
      // На iOS web-push доступен только из установленного на экран «Домой» PWA.
      if (isIos() && !isStandalone()) {
        setShowIosHint(true);
        return;
      }
      toast.error('Уведомления не поддерживаются этим браузером.');
      return;
    }

    setBusy(true);
    try {
      await subscribeToPush();
      setGranted(true);
      toast.success('Утренние напоминания включены.');
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Не удалось включить напоминания.';
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  async function handleInstall() {
    if (!installEvent) return;
    try {
      await installEvent.prompt();
      await installEvent.userChoice;
    } finally {
      setInstallEvent(null);
    }
  }

  if (granted) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-chip-success-bg px-3 py-2 text-sm text-chip-success-fg">
        <CheckCircle2 size={16} aria-hidden />
        <span>Утренние напоминания включены</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={handleEnable} disabled={busy} size="sm">
          <Bell size={16} aria-hidden />
          {busy ? 'Включаем…' : 'Включить утренние напоминания'}
        </Button>
        {installEvent ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleInstall}
          >
            Установить приложение
          </Button>
        ) : null}
      </div>

      {showIosHint ? (
        <div className="flex items-start gap-2 rounded-md bg-chip-info-bg px-3 py-2 text-sm text-chip-info-fg">
          <Share size={16} className="mt-0.5 shrink-0" aria-hidden />
          <p>
            Чтобы получать напоминания на iPhone/iPad, добавьте Кору на экран
            «Домой»: нажмите «Поделиться», затем «На экран „Домой“», откройте
            Кору из иконки и снова включите напоминания.
          </p>
        </div>
      ) : null}
    </div>
  );
}
