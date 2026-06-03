/**
 * Unit-тесты доменного маппера Action Center (Фаза B1).
 *
 * Проверяем:
 *   - RU-лейблы источников,
 *   - тон severity через парные токены (urgent → danger, normal → accent),
 *   - badge-variant severity,
 *   - маппинг count (включая защиту от отсутствующих ключей).
 */
import { describe, expect, it } from 'vitest';

import {
  formatPendingAge,
  mapPendingAction,
  mapPendingActionsCount,
  pendingSeverityBadgeVariant,
  pendingSeverityToneClass,
  samePendingAction,
  PENDING_SOURCE_CHIP,
  PENDING_SOURCE_LABEL,
} from '../pending-action';
import type {
  PendingActionItemApi,
  PendingActionsCountApi,
} from '@/api/pending-actions.api';

function makeItem(
  overrides: Partial<PendingActionItemApi> = {},
): PendingActionItemApi {
  return {
    source: 'curation',
    resourceType: 'idea_block',
    resourceId: 'blk_1',
    title: 'Уточнить факт о клиенте',
    severity: 'normal',
    ageDays: 2,
    actionUrl: '/cards/blk_1',
    canQuickConfirm: true,
    ...overrides,
  };
}

describe('mapPendingAction', () => {
  it('маппит поля и проставляет RU-лейбл источника', () => {
    const d = mapPendingAction(makeItem({ source: 'conflict' }));
    expect(d.source).toBe('conflict');
    expect(d.sourceLabel).toBe('Конфликт');
    expect(d.resourceId).toBe('blk_1');
    expect(d.actionUrl).toBe('/cards/blk_1');
    expect(d.canQuickConfirm).toBe(true);
  });

  it('каждый источник имеет RU-лейбл и chip-вариант', () => {
    (['curation', 'conflict', 'intake', 'probe'] as const).forEach((s) => {
      expect(PENDING_SOURCE_LABEL[s]).toBeTruthy();
      expect(PENDING_SOURCE_CHIP[s]).toBeTruthy();
      const d = mapPendingAction(makeItem({ source: s }));
      expect(d.sourceLabel).toBe(PENDING_SOURCE_LABEL[s]);
    });
  });

  it('RU-лейблы без латиницы', () => {
    Object.values(PENDING_SOURCE_LABEL).forEach((label) => {
      expect(label).not.toMatch(/[A-Za-z]/);
    });
  });
});

describe('pendingSeverityToneClass', () => {
  it('urgent → danger-тон (парные токены)', () => {
    const cls = pendingSeverityToneClass('urgent');
    expect(cls).toContain('text-danger');
    expect(cls).toContain('bg-danger');
    expect(cls).not.toContain('text-white');
  });

  it('normal → accent-тон (парные токены)', () => {
    const cls = pendingSeverityToneClass('normal');
    expect(cls).toContain('text-accent');
    expect(cls).toContain('bg-accent');
    expect(cls).not.toContain('text-white');
  });
});

describe('pendingSeverityBadgeVariant', () => {
  it('urgent → danger, normal → secondary', () => {
    expect(pendingSeverityBadgeVariant('urgent')).toBe('danger');
    expect(pendingSeverityBadgeVariant('normal')).toBe('secondary');
  });
});

describe('formatPendingAge', () => {
  it('0 дней → сегодня, иначе "X дн."', () => {
    expect(formatPendingAge(0)).toBe('сегодня');
    expect(formatPendingAge(3)).toBe('3 дн.');
    expect(formatPendingAge(-1)).toBe('сегодня');
  });
});

describe('samePendingAction (B4 — оптимистичное удаление)', () => {
  it('совпадает по (source, resourceId)', () => {
    expect(
      samePendingAction(
        { source: 'curation', resourceId: 'ci-1' },
        { source: 'curation', resourceId: 'ci-1' },
      ),
    ).toBe(true);
  });

  it('различает по source', () => {
    expect(
      samePendingAction(
        { source: 'curation', resourceId: 'ci-1' },
        { source: 'probe', resourceId: 'ci-1' },
      ),
    ).toBe(false);
  });

  it('различает по resourceId', () => {
    expect(
      samePendingAction(
        { source: 'curation', resourceId: 'ci-1' },
        { source: 'curation', resourceId: 'ci-2' },
      ),
    ).toBe(false);
  });

  it('удаляет только подтверждённый item из списка', () => {
    const list = [
      { source: 'curation' as const, resourceId: 'a' },
      { source: 'curation' as const, resourceId: 'b' },
      { source: 'probe' as const, resourceId: 'a' },
    ];
    const target = { source: 'curation' as const, resourceId: 'a' };
    const rest = list.filter((it) => !samePendingAction(it, target));
    expect(rest.map((r) => `${r.source}:${r.resourceId}`)).toEqual([
      'curation:b',
      'probe:a',
    ]);
  });
});

describe('mapPendingActionsCount', () => {
  it('маппит total и bySource', () => {
    const api: PendingActionsCountApi = {
      total: 7,
      bySource: { curation: 2, conflict: 1, intake: 3, probe: 1 },
    };
    const d = mapPendingActionsCount(api);
    expect(d.total).toBe(7);
    expect(d.bySource.intake).toBe(3);
  });

  it('подставляет 0 при отсутствующих ключах bySource', () => {
    const api = {
      total: 0,
      bySource: {},
    } as unknown as PendingActionsCountApi;
    const d = mapPendingActionsCount(api);
    expect(d.bySource.curation).toBe(0);
    expect(d.bySource.conflict).toBe(0);
    expect(d.bySource.intake).toBe(0);
    expect(d.bySource.probe).toBe(0);
  });
});
