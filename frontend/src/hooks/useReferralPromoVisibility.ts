'use client';

/**
 * useReferralPromoVisibility — вычисляет, нужно ли показывать
 * `<ReferralPromoStrip />` на текущей странице.
 *
 * ТЗ: plans/tz/2026-05-31-referrals-cabinet-revamp.md §8.3a.
 *
 * Логика:
 *   1. Страница должна быть в whitelist (главная и «продуктовые» разделы).
 *   2. Не на blacklist-странице (`/referrals`, `/admin/**`, `/onboarding/**`,
 *      `/login`, `/signup`, `/settings/**`, `/chat/**`).
 *   3. Пользователь не нажимал «крестик» последние 30 дней
 *      (localStorage `z.referralPromo.dismissedAt`).
 *   4. У пользователя ещё нет Referral-профиля (`referralsApi.getMe()` → null).
 *      Кэшируем результат на 24 часа в localStorage, чтобы не дёргать API
 *      на каждой странице.
 *   5. Tenant не в paywall-режиме (status !== 'DEMO').
 *
 * Возвращает `{ visible, role }` — компонент сам решает, рендерить ли.
 *
 * Whitelist реализован как массив `{ path, mode: 'exact' | 'prefix' }`. Это
 * позволяет показывать баннер на `/dashboard/...`, но прятать на
 * `/meetings/<id>/result` (только `/meetings` exact — список встреч).
 */

import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { referralsApi } from '@/api/referrals.api';
import { useSubscription } from '@/hooks/useSubscription';
import { useEffectiveOrgRole, type EffectiveOrgRole } from './useEffectiveOrgRole';

// ── ключи localStorage ──
const LS_DISMISSED_AT = 'z.referralPromo.dismissedAt';
const LS_HAS_PROFILE = 'z.referralPromo.hasProfile';
const LS_HAS_PROFILE_CHECKED_AT = 'z.referralPromo.hasProfileCheckedAt';

const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 дней
const PROFILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 часа

type WhitelistEntry = { path: string; mode: 'exact' | 'prefix' };

/**
 * Whitelist путей, на которых показывается промо-полоса (ТЗ §8.3a
 * «Где показывается»).
 *
 *   - `'/'` — exact-only: только главная.
 *   - `/dashboard`, `/activity-feed`, `/goals`, `/insights`, `/tracker` —
 *     prefix: разрешены вложенные страницы (например, `/dashboard/<view>`).
 *   - `/clones`, `/persons`, `/entities`, `/themes`, `/meetings` — exact:
 *     только списки. На детальных страницах (диалог с клоном, результат
 *     встречи) баннер прячем — там сфокусированный workflow.
 */
const WHITELIST: WhitelistEntry[] = [
  { path: '/', mode: 'exact' },
  { path: '/dashboard', mode: 'prefix' },
  { path: '/activity-feed', mode: 'prefix' },
  { path: '/goals', mode: 'prefix' },
  { path: '/insights', mode: 'prefix' },
  { path: '/tracker', mode: 'prefix' },
  { path: '/clones', mode: 'exact' },
  { path: '/persons', mode: 'exact' },
  { path: '/entities', mode: 'exact' },
  { path: '/themes', mode: 'exact' },
  { path: '/meetings', mode: 'exact' },
];

/**
 * Blacklist префиксов — даже если попали в whitelist, эти страницы
 * перекрывают (например, `/settings/subscription` не должен показывать
 * промо: там и так paywall-контент).
 */
const BLACKLIST_PREFIXES = [
  '/referrals',
  '/admin',
  '/onboarding',
  '/settings',
  '/chat',
  '/login',
  '/signup',
];

function matchesWhitelist(pathname: string): boolean {
  for (const entry of WHITELIST) {
    if (entry.mode === 'exact' && pathname === entry.path) return true;
    if (entry.mode === 'prefix') {
      if (pathname === entry.path) return true;
      if (pathname.startsWith(`${entry.path}/`)) return true;
    }
  }
  return false;
}

function matchesBlacklist(pathname: string): boolean {
  for (const prefix of BLACKLIST_PREFIXES) {
    if (pathname === prefix) return true;
    if (pathname.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

function readDismissedAt(): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LS_DISMISSED_AT);
    if (!raw) return null;
    const ts = Date.parse(raw);
    return Number.isFinite(ts) ? ts : null;
  } catch {
    return null;
  }
}

function readProfileCache(): { hasProfile: boolean; fresh: boolean } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LS_HAS_PROFILE);
    const checkedAt = window.localStorage.getItem(LS_HAS_PROFILE_CHECKED_AT);
    if (raw === null || checkedAt === null) return null;
    const ts = Date.parse(checkedAt);
    if (!Number.isFinite(ts)) return null;
    const fresh = Date.now() - ts < PROFILE_CACHE_TTL_MS;
    return { hasProfile: raw === 'true', fresh };
  } catch {
    return null;
  }
}

function writeProfileCache(hasProfile: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_HAS_PROFILE, hasProfile ? 'true' : 'false');
    window.localStorage.setItem(
      LS_HAS_PROFILE_CHECKED_AT,
      new Date().toISOString(),
    );
  } catch {
    // localStorage может быть недоступен (private mode / quota) — игнорируем,
    // повторим в следующий монтаж.
  }
}

export type UseReferralPromoVisibilityResult = {
  visible: boolean;
  role: EffectiveOrgRole;
};

export function useReferralPromoVisibility(): UseReferralPromoVisibilityResult {
  const pathname = usePathname() ?? '/';
  const role = useEffectiveOrgRole();
  const { status, loading: subLoading } = useSubscription();

  // Дисмисс из localStorage — читаем один раз на mount, дальше держим в state.
  // Это даёт мгновенный re-render после клика по крестику без зависимости от
  // storage-events.
  const [dismissedFresh, setDismissedFresh] = useState<boolean>(false);
  useEffect(() => {
    const ts = readDismissedAt();
    setDismissedFresh(ts !== null && Date.now() - ts < DISMISS_TTL_MS);
  }, []);

  // Слушаем глобальное событие dismiss (диспатчит сама полоса), чтобы скрыть
  // её без перезагрузки страницы.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => setDismissedFresh(true);
    window.addEventListener('z:referralPromo:dismissed', handler);
    return () =>
      window.removeEventListener('z:referralPromo:dismissed', handler);
  }, []);

  // Profile-cache: если кэш свежий — используем без сети. Если stale/empty —
  // дёрнем API и положим в кэш.
  const [hasProfile, setHasProfile] = useState<boolean | null>(() => {
    const cached = readProfileCache();
    if (cached && cached.fresh) return cached.hasProfile;
    return null;
  });

  // Pathname/role/sub-зависимые проверки делаем синхронно — но прежде чем
  // дёргать API, отсеиваем заведомо невидимые случаи, чтобы не плодить
  // лишних запросов.
  const pathPassesWhitelist = useMemo(
    () => matchesWhitelist(pathname),
    [pathname],
  );
  const pathPassesBlacklist = useMemo(
    () => matchesBlacklist(pathname),
    [pathname],
  );
  const eligibleByPath = pathPassesWhitelist && !pathPassesBlacklist;

  useEffect(() => {
    // Не нужно тянуть профиль, если страница и так не подходит.
    if (!eligibleByPath) return;
    if (subLoading) return;
    if (status === 'DEMO') return;
    if (dismissedFresh) return;
    if (hasProfile !== null) return; // уже знаем (из кэша или прошлого fetch'а)

    let cancelled = false;
    void (async () => {
      try {
        const profile = await referralsApi.getMe();
        if (cancelled) return;
        const value = profile !== null;
        setHasProfile(value);
        writeProfileCache(value);
      } catch {
        if (cancelled) return;
        // API упал — fail-safe: считаем, что профиль есть, чтобы не дёргать
        // пользователя баннером при проблемах сети.
        setHasProfile(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eligibleByPath, subLoading, status, dismissedFresh, hasProfile]);

  const visible = useMemo(() => {
    if (!eligibleByPath) return false;
    if (subLoading) return false;
    if (status === 'DEMO') return false;
    if (dismissedFresh) return false;
    if (hasProfile === null) return false; // ждём fetch
    if (hasProfile === true) return false; // у юзера уже есть профиль
    return true;
  }, [eligibleByPath, subLoading, status, dismissedFresh, hasProfile]);

  return { visible, role };
}
