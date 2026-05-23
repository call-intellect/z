import { describe, expect, it } from 'vitest';

import {
  CreateExperimentBodySchema,
  ListExperimentsQuerySchema,
  TransitionExperimentBodySchema,
  UpdateExperimentBodySchema,
} from './experiments.dto';

describe('experiments.dto', () => {
  describe('ListExperimentsQuerySchema', () => {
    it('применяет defaults page=1/limit=50', () => {
      const parsed = ListExperimentsQuerySchema.parse({});
      expect(parsed.page).toBe(1);
      expect(parsed.limit).toBe(50);
    });
    it('coerce строковые page/limit в числа', () => {
      const parsed = ListExperimentsQuerySchema.parse({
        page: '3',
        limit: '20',
      });
      expect(parsed.page).toBe(3);
      expect(parsed.limit).toBe(20);
    });
    it('отвергает неизвестный status', () => {
      const res = ListExperimentsQuerySchema.safeParse({ status: 'wat' });
      expect(res.success).toBe(false);
    });
  });

  describe('CreateExperimentBodySchema', () => {
    it('требует name + hypothesisText', () => {
      const res = CreateExperimentBodySchema.safeParse({});
      expect(res.success).toBe(false);
    });
    it('принимает минимальный body с дефолтным status', () => {
      const res = CreateExperimentBodySchema.safeParse({
        name: 'Тестовый эксперимент',
        hypothesisText: 'Проверяем гипотезу',
      });
      expect(res.success).toBe(true);
    });
    it('режет name > 120 символов', () => {
      const res = CreateExperimentBodySchema.safeParse({
        name: 'x'.repeat(200),
        hypothesisText: 'h',
      });
      expect(res.success).toBe(false);
    });
  });

  describe('UpdateExperimentBodySchema', () => {
    it('принимает массив уроков c корректными type', () => {
      const res = UpdateExperimentBodySchema.safeParse({
        lessons: [
          { text: 'Сработало', type: 'what_worked' },
          { text: 'Не сработало', type: 'what_failed' },
          { text: 'В следующий раз', type: 'next_time' },
        ],
      });
      expect(res.success).toBe(true);
    });
    it('отвергает невалидный type урока', () => {
      const res = UpdateExperimentBodySchema.safeParse({
        lessons: [{ text: 'x', type: 'maybe_worked' }],
      });
      expect(res.success).toBe(false);
    });
  });

  describe('TransitionExperimentBodySchema', () => {
    it('принимает only allowed transitions (running/completed/dropped/paused)', () => {
      for (const to of [
        'running',
        'completed',
        'dropped',
        'paused',
      ] as const) {
        expect(
          TransitionExperimentBodySchema.safeParse({ to }).success,
        ).toBe(true);
      }
    });
    it('отвергает hypothesis в transition (это начальный статус)', () => {
      const res = TransitionExperimentBodySchema.safeParse({
        to: 'hypothesis',
      });
      expect(res.success).toBe(false);
    });
  });
});
