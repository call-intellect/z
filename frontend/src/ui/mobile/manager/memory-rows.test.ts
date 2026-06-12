/**
 * Юнит-тесты чистой логики экрана «Память» (мобайл, ТЗ B5/Ф6).
 *
 * Покрытие: тон статуса → парный chip-токен, русский лейбл, формат даты ru
 * (decidedAt с фолбэком на createdAt), подпись-источник, маппинг карточки.
 */

import { describe, expect, it } from 'vitest';

import type { DecisionListItem } from '@/domain/decision';
import {
  decidedDateLabel,
  memoryCard,
  sourceLabel,
  statusChipTone,
  statusLabel,
} from './memory-rows';

function decision(over: Partial<DecisionListItem> = {}): DecisionListItem {
  return {
    id: 'd1',
    statement: 'Переходим на недельные спринты',
    status: 'approved',
    decidedByPersonIds: [],
    decidedAt: new Date('2026-06-11T10:00:00Z'),
    deadline: null,
    supersedesId: null,
    affectsEntityIds: [],
    confidence: null,
    trustTier: 'human',
    updatedAt: new Date('2026-06-11T10:00:00Z'),
    createdAt: new Date('2026-05-01T08:00:00Z'),
    ...over,
  };
}

describe('statusChipTone', () => {
  it('approved/implemented → success', () => {
    expect(statusChipTone('approved')).toBe('success');
    expect(statusChipTone('implemented')).toBe('success');
  });

  it('rejected → danger (error маппится на доступный chip-danger)', () => {
    expect(statusChipTone('rejected')).toBe('danger');
  });

  it('proposed → info, cancelled/superseded → neutral', () => {
    expect(statusChipTone('proposed')).toBe('info');
    expect(statusChipTone('cancelled')).toBe('neutral');
    expect(statusChipTone('superseded')).toBe('neutral');
  });

  it('legacy rolled_back → warning', () => {
    expect(statusChipTone('rolled_back')).toBe('warning');
  });
});

describe('statusLabel', () => {
  it('русский лейбл статуса', () => {
    expect(statusLabel('approved')).toBe('Принятое');
    expect(statusLabel('superseded')).toBe('Заменено');
  });
});

describe('decidedDateLabel', () => {
  it('берёт decidedAt в коротком русском формате', () => {
    const label = decidedDateLabel(decision());
    expect(label).toContain('2026');
    expect(label).toMatch(/июн/);
  });

  it('фолбэк на createdAt, если decidedAt = null', () => {
    const label = decidedDateLabel(decision({ decidedAt: null }));
    expect(label).toMatch(/ма[йя]/);
    expect(label).toContain('2026');
  });
});

describe('sourceLabel', () => {
  it('decidedAt есть → «Зафиксировано»', () => {
    expect(sourceLabel(decision())).toBe('Зафиксировано');
  });

  it('decidedAt отсутствует → «В памяти с»', () => {
    expect(sourceLabel(decision({ decidedAt: null }))).toBe('В памяти с');
  });
});

describe('memoryCard', () => {
  it('маппит решение в карточку ленты', () => {
    const card = memoryCard(
      decision({ id: 'x', statement: 'Сменить поставщика', status: 'implemented' }),
    );
    expect(card.id).toBe('x');
    expect(card.statement).toBe('Сменить поставщика');
    expect(card.statusLabel).toBe('Реализованное');
    expect(card.statusTone).toBe('success');
    expect(card.sourceLabel).toBe('Зафиксировано');
    expect(card.dateLabel).toMatch(/2026/);
  });
});
