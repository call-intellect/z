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
  MOBILE_EXEC_TABS,
  MOBILE_MANAGER_TABS,
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

  // A11.2 — расширение гарда на мобильные табы (нижний навбар по роли).
  // Инвариант «mobile-tabs ⊆ desktop»: каждый href из EXEC- и MANAGER-набора
  // достижим в десктоп-навигации. Защищает от паритет-долга вроде «Память→/chat».
  it('каждый href EXEC-табов достижим в десктоп-навигации', () => {
    const unreachable = MOBILE_EXEC_TABS.filter(
      (tab) => !isDesktopNavReachable(tab.href),
    ).map((tab) => tab.href);
    expect(unreachable).toEqual([]);
  });

  it('каждый href MANAGER-табов достижим в десктоп-навигации', () => {
    const unreachable = MOBILE_MANAGER_TABS.filter(
      (tab) => !isDesktopNavReachable(tab.href),
    ).map((tab) => tab.href);
    expect(unreachable).toEqual([]);
  });

  it('паритет «Память»: EXEC-таб «Память» ведёт на /memory (как десктоп)', () => {
    const memoryTab = MOBILE_EXEC_TABS.find((tab) => tab.label === 'Память');
    expect(memoryTab?.href).toBe('/memory');
    expect(DESKTOP_NAV_HREFS).toContain('/memory');
  });

  // ТЗ 2026-06-15 — «Ваши предложения» (/feedback) вернули в меню (секция
  // «Система») после редизайна Ф0, где пункт выпал. Гард, чтобы он снова не
  // «потерялся» при следующем редизайне.
  it('«Ваши предложения» (/feedback) присутствует в десктоп-навигации', () => {
    expect(DESKTOP_NAV_HREFS).toContain('/feedback');
    expect(isDesktopNavReachable('/feedback')).toBe(true);
  });
});
