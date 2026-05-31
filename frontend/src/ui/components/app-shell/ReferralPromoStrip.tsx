'use client';

/**
 * ReferralPromoStrip — sticky-плашка в AppShell, приглашающая пользователя
 * стать партнёром реферальной программы.
 *
 * ТЗ: plans/tz/2026-05-31-referrals-cabinet-revamp.md §8.3a.
 *
 * Архитектура:
 *   - Видимость и роль вычисляет `useReferralPromoVisibility` —
 *     pathname-whitelist + paywall + dismiss-TTL 30 дней + кэш profile-fetch
 *     (24 ч). Здесь компонент просто рендерит результат.
 *   - Трекинг: один impression на сессию (sessionStorage), клик на CTA,
 *     dismiss — все три события идут в `POST /api/v1/referrals/me/promo-event`.
 *   - Mobile (≤640px): прячем длинный «хвост» текста через `hidden sm:inline`,
 *     CTA сжимается до стрелки.
 *
 * Стиль: парные цветовые токены `bg-emerald-50` / `text-emerald-900`, кнопка
 * на `bg-emerald-600` / `text-emerald-50` (парный токен, контраст ≥ 4.5:1) —
 * приглушённое «доходное зелёное», чтобы не конкурировать с `PaywallBanner`
 * (тревожный `warning`), но было заметно сразу под ним.
 */

import Link from 'next/link';
import { ArrowRight, X } from 'lucide-react';
import { useCallback, useEffect } from 'react';

import { referralsApi } from '@/api/referrals.api';
import { useReferralPromoVisibility } from '@/hooks/useReferralPromoVisibility';

const LS_DISMISSED_AT = 'z.referralPromo.dismissedAt';
const SS_IMPRESSION_AT = 'z.referralPromo.impressionSentAt';

const COPY = {
  owner: {
    bold: 'Пригласи 3 руководителя в Кору — отбей свою подписку с запасом.',
    tail: ' 20 000 ₽ × 3 = 60 000 ₽ в месяц возвращается тебе.',
    emoji: '🎁',
  },
  member: {
    bold: 'Расскажи о Коре в другой компании — заработай 20 000 ₽/мес с каждого активного клиента.',
    tail: '',
    emoji: '💼',
  },
} as const;

/**
 * Безопасный fire-and-forget — события трекинга не должны валить UI и не
 * требуют await/обработки ошибок: backend на ошибку маршрутизации сам
 * вернёт 204, инфраструктурные 5xx нам неважны.
 */
function trackSafe(
  type: 'impression' | 'click' | 'dismissed',
  role: 'owner' | 'member',
): void {
  void referralsApi.trackPromoEvent({ type, role }).catch(() => {
    /* ignore */
  });
}

export function ReferralPromoStrip() {
  const { visible, role } = useReferralPromoVisibility();

  // Impression — один раз за сессию вкладки. sessionStorage сбрасывается при
  // закрытии вкладки, поэтому новый день / новая сессия даст новый
  // impression (это сходится с метрикой в Prometheus).
  useEffect(() => {
    if (!visible) return;
    if (typeof window === 'undefined') return;
    try {
      if (window.sessionStorage.getItem(SS_IMPRESSION_AT)) return;
      window.sessionStorage.setItem(SS_IMPRESSION_AT, new Date().toISOString());
      trackSafe('impression', role);
    } catch {
      // sessionStorage недоступен — пропускаем без ретрая, не критично.
    }
  }, [visible, role]);

  const handleClick = useCallback(() => {
    trackSafe('click', role);
  }, [role]);

  const handleDismiss = useCallback(() => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(LS_DISMISSED_AT, new Date().toISOString());
      } catch {
        /* ignore */
      }
      // Сообщаем хуку видимости — спрятать без перезагрузки.
      window.dispatchEvent(new CustomEvent('z:referralPromo:dismissed'));
    }
    trackSafe('dismissed', role);
  }, [role]);

  if (!visible) return null;

  const copy = COPY[role];

  return (
    <div
      className="border-b border-emerald-200/70 bg-emerald-50 px-4 py-2 text-emerald-900"
      data-testid="referral-promo-strip"
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 text-sm">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="text-base leading-none">
            {copy.emoji}
          </span>
          <p className="min-w-0 truncate sm:whitespace-normal">
            <strong className="font-semibold">{copy.bold}</strong>
            {copy.tail ? (
              <span className="hidden sm:inline">{copy.tail}</span>
            ) : null}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Link
            href="/referrals"
            onClick={handleClick}
            className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-emerald-50 transition hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 focus-visible:ring-offset-emerald-50"
            data-testid="referral-promo-cta"
          >
            <span className="hidden sm:inline">Получить ссылку</span>
            <ArrowRight size={16} aria-hidden="true" />
            <span className="sr-only sm:hidden">Получить ссылку</span>
          </Link>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Скрыть приглашение"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-emerald-900/70 transition hover:bg-emerald-100 hover:text-emerald-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            data-testid="referral-promo-dismiss"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
