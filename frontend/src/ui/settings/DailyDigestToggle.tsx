'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  notificationPreferencesApi,
  type NotificationPreferencesApi,
} from '@/api/notification-preferences.api';
import { Switch } from '@/ui/shadcn/switch';
import { toast } from '@/ui/shadcn/toast';

const DAILY_DIGEST_EVENT = 'operations.daily_digest';

/**
 * ТЗ coo-orphan-agents Ф8 — персональный тумблер «Ежедневная сводка компании».
 *
 * Ship-On: по умолчанию ВКЛючена (сводка доставляется), пользователь сам
 * отключает. Галочка ВКЛ ⇔ `operations.daily_digest` НЕ в `optOutEventTypes`.
 * При отключении сводка остаётся в кабинете (in_app) — это поясняем подписью.
 */
export function DailyDigestToggle() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [optOut, setOptOut] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const prefs: NotificationPreferencesApi =
          await notificationPreferencesApi.get();
        if (!cancelled) setOptOut(prefs.optOutEventTypes ?? []);
      } catch {
        // тихо — дефолт «включено» (пустой optOut)
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enabled = !optOut.includes(DAILY_DIGEST_EVENT);

  const onToggle = useCallback(
    async (next: boolean) => {
      const prev = optOut;
      const updated = next
        ? optOut.filter((e) => e !== DAILY_DIGEST_EVENT)
        : [...optOut.filter((e) => e !== DAILY_DIGEST_EVENT), DAILY_DIGEST_EVENT];
      setOptOut(updated); // оптимистично
      setBusy(true);
      try {
        await notificationPreferencesApi.update({ optOutEventTypes: updated });
      } catch {
        setOptOut(prev); // откат
        toast.error('Не удалось сохранить настройку');
      } finally {
        setBusy(false);
      }
    },
    [optOut],
  );

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-sm font-medium text-fg-primary">
          Ежедневная сводка компании
        </div>
        <p className="mt-1 text-xs text-fg-secondary">
          Получайте короткий итог дня в Telegram и почту. При отключении сводка
          всё равно доступна в кабинете.
        </p>
      </div>
      <div className="shrink-0">
        <Switch
          checked={enabled}
          disabled={loading || busy}
          onCheckedChange={(v) => void onToggle(v)}
          aria-label="Получать ежедневную сводку компании"
        />
      </div>
    </div>
  );
}
