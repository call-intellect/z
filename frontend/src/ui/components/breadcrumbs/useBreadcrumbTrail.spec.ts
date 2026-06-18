/**
 * Юнит-тесты чистой функции-ядра buildBreadcrumbTrail (Ф1 ТЗ
 * 2026-06-17-cabinet-breadcrumbs-and-mobile-back, §3 «Негативные примеры»).
 * Покрывают 5 канонических сценариев, включая:
 *  - длина 1 (раздел верхнего уровня);
 *  - override родителя/листа;
 *  - fallback-метку типа вместо сырого id/slug;
 *  - parentHref-override для плоского-но-вложенного маршрута /issues/[id];
 *  - fallback без регистрации (/curation/xyz → «Запись», НЕ «xyz»).
 */
import { describe, expect, it } from 'vitest';

import type { BreadcrumbOverride } from './BreadcrumbContext';
import { buildBreadcrumbTrail } from './useBreadcrumbTrail';

function makeOverrides(
  entries: Array<[string, BreadcrumbOverride]> = [],
): ReadonlyMap<string, BreadcrumbOverride> {
  return new Map(entries);
}

describe('buildBreadcrumbTrail', () => {
  it('/projects (длина 1) → один элемент isCurrent, без href', () => {
    const trail = buildBreadcrumbTrail('/projects', makeOverrides());

    expect(trail).toHaveLength(1);
    expect(trail[0]).toEqual({ label: 'Проекты', href: undefined, isCurrent: true });
  });

  it('/projects/vkhod/board + override родителя → Проекты › VKHOD · Входящие › Доска', () => {
    const trail = buildBreadcrumbTrail(
      '/projects/vkhod/board',
      makeOverrides([['/projects/vkhod', { label: 'VKHOD · Входящие' }]]),
    );

    expect(trail).toHaveLength(3);

    expect(trail[0].label).toBe('Проекты');
    expect(trail[0].href).toBe('/projects');
    expect(trail[0].isCurrent).toBe(false);

    expect(trail[1].label).toBe('VKHOD · Входящие');
    expect(trail[1].href).toBe('/projects/vkhod');
    expect(trail[1].isCurrent).toBe(false);

    expect(trail[2].label).toBe('Доска');
    expect(trail[2].href).toBeUndefined();
    expect(trail[2].isCurrent).toBe(true);
  });

  it('динамический лист без override → fallback-метка типа (НЕ сырой id) + isLoading', () => {
    const trail = buildBreadcrumbTrail('/projects/vkhod/board', makeOverrides());

    // нет override → проект показывается как «Проект» (тип), не «vkhod»
    expect(trail).toHaveLength(3);
    expect(trail[1].label).toBe('Проект');
    expect(trail[1].label).not.toBe('vkhod');
    expect(trail[1].isLoading).toBe(true);
    expect(trail[1].href).toBe('/projects/vkhod');

    // самого сегмента 'vkhod' нет ни в одной метке
    expect(trail.some((item) => item.label === 'vkhod')).toBe(false);
  });

  it('/issues/<uuid> + parentHref-override → предпоследнее звено = parentLabel(parentHref), НЕ /issues', () => {
    const pathname = '/issues/7f3a-uuid';
    const trail = buildBreadcrumbTrail(
      pathname,
      makeOverrides([
        [
          pathname,
          {
            label: 'Добавить крошки',
            parentHref: '/projects/vkhod/board',
            parentLabel: 'VKHOD · Входящие',
          },
        ],
      ]),
    );

    expect(trail).toHaveLength(2);

    // предпоследнее звено замещено родителем из override
    expect(trail[0].label).toBe('VKHOD · Входящие');
    expect(trail[0].href).toBe('/projects/vkhod/board');
    expect(trail[0].href).not.toBe('/issues');
    expect(trail[0].isCurrent).toBe(false);

    // последнее звено — имя из override, current
    expect(trail[1].label).toBe('Добавить крошки');
    expect(trail[1].isCurrent).toBe(true);
    expect(trail[1].href).toBeUndefined();
  });

  it('/curation/xyz без регистрации → Курация(/curation) › Запись(current, fallback, НЕ "xyz")', () => {
    const trail = buildBreadcrumbTrail('/curation/xyz', makeOverrides());

    expect(trail).toHaveLength(2);

    expect(trail[0].label).toBe('Курация');
    expect(trail[0].href).toBe('/curation');
    expect(trail[0].isCurrent).toBe(false);

    expect(trail[1].label).toBe('Запись');
    expect(trail[1].label).not.toBe('xyz');
    expect(trail[1].isCurrent).toBe(true);
    expect(trail[1].href).toBeUndefined();
  });
});
