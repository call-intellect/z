import { describe, expect, it } from 'vitest';

import {
  classifyBlockerStatus,
  computeBusinessImpact,
  daysBetween,
  DEFAULT_BLOCKER_IMPACT_WEIGHTS,
  normalizeBlockerText,
} from './blocker-synthesis.scoring';

describe('blocker-synthesis.scoring', () => {
  describe('computeBusinessImpact', () => {
    it('база × число блоков (без спец-сигналов, daysOpen=0)', () => {
      expect(
        computeBusinessImpact(
          {
            blockCount: 3,
            touchesCustomer: false,
            touchesDeadline: false,
            touchesCommitment: false,
            daysOpen: 0,
          },
          DEFAULT_BLOCKER_IMPACT_WEIGHTS,
        ),
      ).toBe(3);
    });

    it('блокер клиента/дедлайна/обещания тяжелее бытового', () => {
      const plain = computeBusinessImpact(
        {
          blockCount: 1,
          touchesCustomer: false,
          touchesDeadline: false,
          touchesCommitment: false,
          daysOpen: 0,
        },
        DEFAULT_BLOCKER_IMPACT_WEIGHTS,
      );
      const heavy = computeBusinessImpact(
        {
          blockCount: 1,
          touchesCustomer: true,
          touchesDeadline: true,
          touchesCommitment: true,
          daysOpen: 0,
        },
        DEFAULT_BLOCKER_IMPACT_WEIGHTS,
      );
      expect(plain).toBe(1);
      expect(heavy).toBe(10);
      expect(heavy).toBeGreaterThan(plain);
    });

    it('хроника (daysOpen) добавляет вес', () => {
      expect(
        computeBusinessImpact(
          {
            blockCount: 1,
            touchesCustomer: false,
            touchesDeadline: false,
            touchesCommitment: false,
            daysOpen: 4,
          },
          DEFAULT_BLOCKER_IMPACT_WEIGHTS,
        ),
      ).toBe(3);
    });

    it('мусорные/отрицательные значения трактуются безопасно (blockCount=0 → 1)', () => {
      expect(
        computeBusinessImpact(
          {
            blockCount: -5,
            touchesCustomer: false,
            touchesDeadline: false,
            touchesCommitment: false,
            daysOpen: -10,
          },
          DEFAULT_BLOCKER_IMPACT_WEIGHTS,
        ),
      ).toBe(1);
    });
  });

  describe('classifyBlockerStatus', () => {
    it('впервые сегодня → new', () => {
      expect(
        classifyBlockerStatus({
          firstSeen: '2026-06-08',
          today: '2026-06-08',
          seenToday: true,
        }),
      ).toBe('new');
    });

    it('упоминался раньше и сегодня → recurring', () => {
      expect(
        classifyBlockerStatus({
          firstSeen: '2026-06-04',
          today: '2026-06-08',
          seenToday: true,
        }),
      ).toBe('recurring');
    });

    it('не упоминался сегодня → resolved', () => {
      expect(
        classifyBlockerStatus({
          firstSeen: '2026-06-04',
          today: '2026-06-08',
          seenToday: false,
        }),
      ).toBe('resolved');
    });

    it('блокер 4 дня подряд → recurring с daysOpen=4', () => {
      const status = classifyBlockerStatus({
        firstSeen: '2026-06-04',
        today: '2026-06-08',
        seenToday: true,
      });
      expect(status).toBe('recurring');
      expect(daysBetween('2026-06-04', '2026-06-08')).toBe(4);
    });
  });

  describe('daysBetween', () => {
    it('тот же день = 0', () => {
      expect(daysBetween('2026-06-08', '2026-06-08')).toBe(0);
    });
    it('считает календарную разницу', () => {
      expect(daysBetween('2026-06-01', '2026-06-08')).toBe(7);
    });
    it('обратный порядок / мусор → 0', () => {
      expect(daysBetween('2026-06-08', '2026-06-01')).toBe(0);
      expect(daysBetween('bad', '2026-06-08')).toBe(0);
    });
  });

  describe('normalizeBlockerText', () => {
    it('нижний регистр + схлоп пробелов + срез пунктуации', () => {
      expect(normalizeBlockerText('  Жду  ДОСТУП к API!! ')).toBe('жду доступ к api');
    });
    it('одинаковые по сути блокеры дают одинаковый ключ', () => {
      const a = normalizeBlockerText('Жду доступ к базе.');
      const b = normalizeBlockerText('жду   доступ к базе');
      expect(a).toBe(b);
    });
    it('пустой ввод → пустая строка', () => {
      expect(normalizeBlockerText('')).toBe('');
    });
  });
});
