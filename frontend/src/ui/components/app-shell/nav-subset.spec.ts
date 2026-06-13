/**
 * Гард Ф6 (D4) 2026-06-11 — инвариант «mobile ⊆ desktop».
 *
 * Мобильный нижний навбар (`TrackerBottomNav`) и «ежедневные» пункты десктоп-
 * сайдбара берутся из ОДНОГО источника `PRIMARY_NAV_ITEMS`. Этот тест
 * фиксирует: каждый href из мобильного навбара достижим в десктоп-навигации —
 * либо точным совпадением, либо покрытием matchPrefix (`/me` покрывает
 * `/me/inbox` и `/me/check-ins`). Если кто-то добавит мобильный пункт без
 * десктоп-аналога — тест упадёт.
 */
import { describe, expect, it } from 'vitest';

import { PRIMARY_NAV_ITEMS } from './primary-nav';
import {
  DESKTOP_NAV_HREFS,
  getDesktopNavRefs,
  isDesktopNavReachable,
} from './nav-config';

describe('навигация — mobile ⊆ desktop (Ф6)', () => {
  it('каждый href нижнего навбара достижим в десктоп-сайдбаре', () => {
    const unreachable = PRIMARY_NAV_ITEMS.filter(
      (item) => !isDesktopNavReachable(item.href),
    ).map((item) => item.href);
    expect(unreachable).toEqual([]);
  });

  it('конкретные ежедневные пункты покрыты десктопом (exact или matchPrefix)', () => {
    // exact-совпадения (новое меню Ф0: ритмы + работа)
    expect(DESKTOP_NAV_HREFS).toContain('/projects');
    expect(DESKTOP_NAV_HREFS).toContain('/week');
    expect(DESKTOP_NAV_HREFS).toContain('/me');
    // /actions достижим через топ-бар «Требует вас»
    expect(isDesktopNavReachable('/actions')).toBe(true);
    // покрытие через matchPrefix '/me'
    expect(isDesktopNavReachable('/me/inbox')).toBe(true);
    expect(isDesktopNavReachable('/me/check-ins')).toBe(true);
  });

  it('десктоп-союз непустой и без дублей по href', () => {
    const refs = getDesktopNavRefs();
    expect(refs.length).toBeGreaterThan(0);
    const hrefs = refs.map((r) => r.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
