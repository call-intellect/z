/**
 * Goals OKR v2 (2026-06-02, Фаза 2) — Golden-набор для агента `goal-extract`
 * (Specialist 3-14, Goals).
 *
 * Зачем:
 *   - Агент решает «цель / не цель» и формулирует outcome. Любой регресс
 *     (плодёж псевдоцелей из output, потеря числа, неверный горизонт) подрывает
 *     доверие к авто-добыче целей.
 *   - Защита от деградации после смены модели/промпта.
 *
 * Содержимое:
 *   - 10 валидных фикстур (реальные цели: с числом, качественные, sprint, retention,
 *     выручка, …) — LLM должен вернуть isGoal=true.
 *   - 5 отказных фикстур (вопрос, болтовня, частная задача-output, благодарность,
 *     абстрактное пожелание) — LLM должен вернуть isGoal=false.
 *
 * Режимы запуска:
 *   - Обычный: проверяет структуру фикстур + сборку USER-промпта + механику
 *     инвариантов на mock-ответах.
 *   - Реальный прогон через LLM: env-гейт GOAL_EXTRACT_GOLDEN_REAL=1 (TODO-скип,
 *     как у skill-trait-detect-golden — это эксперимент со своим бюджетом).
 *
 * См. ТЗ: `plans/tz/2026-06-02-goals-okr-v2.md`, Фаза 2.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  GOAL_EXTRACT_JSON_SCHEMA,
  GOAL_EXTRACT_SYSTEM_PROMPT,
  GOAL_EXTRACT_USER_TEMPLATE,
} from '../../../src/modules/knowledge-core/prompts/goal-extract.prompt';

interface FixtureExpected {
  isGoal: boolean;
  reason?: string;
  /** Хотя бы одно из этих слов должно встретиться в statement/description (для valid). */
  statementKeywords?: string[];
  expectedHorizon?: string;
  hasMeasurable?: boolean;
  /** Слова, которых НЕ должно быть (анти-output / анти-канцелярит). */
  forbiddenWords?: string[];
}

interface FixtureData {
  fixtureId: string;
  category: 'valid' | 'reject';
  blockName: string;
  criticalQuestion: string;
  trustedAnswer: string;
  signalType: string;
  tags: string[];
  evidenceQuotes: string[];
  expected: FixtureExpected;
}

const FIXTURES_DIR = join(__dirname, 'fixtures');

const fixtures: { name: string; data: FixtureData }[] = readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => ({
    name: f,
    data: JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf-8')) as FixtureData,
  }));

const REAL_RUN = process.env.GOAL_EXTRACT_GOLDEN_REAL === '1';

describe('goal-extract — golden-набор', () => {
  it('собирается 15 фикстур (10 valid + 5 reject)', () => {
    expect(fixtures.length).toBe(15);
    const valid = fixtures.filter((f) => f.data.category === 'valid');
    const reject = fixtures.filter((f) => f.data.category === 'reject');
    expect(valid.length).toBe(10);
    expect(reject.length).toBe(5);
  });

  it('промпт и схема импортированы из модуля knowledge-core', () => {
    expect(GOAL_EXTRACT_SYSTEM_PROMPT).toContain('knowledge-инженер');
    expect(GOAL_EXTRACT_SYSTEM_PROMPT).toContain('outcome');
    expect(GOAL_EXTRACT_JSON_SCHEMA).toHaveProperty('properties.isGoal');
    expect(GOAL_EXTRACT_JSON_SCHEMA).toHaveProperty('properties.horizon');
    expect(typeof GOAL_EXTRACT_USER_TEMPLATE).toBe('function');
  });

  for (const f of fixtures) {
    it(`фикстура ${f.name}: структура валидна`, () => {
      const d = f.data;
      expect(d.fixtureId).toBeTruthy();
      expect(['valid', 'reject']).toContain(d.category);
      expect(d.evidenceQuotes.length).toBeGreaterThanOrEqual(1);
      expect(d.expected).toBeTruthy();
      if (d.category === 'valid') {
        expect(d.expected.isGoal).toBe(true);
      } else {
        expect(d.expected.isGoal).toBe(false);
      }
    });

    it(`фикстура ${f.name}: user-промпт собирается без ошибок`, () => {
      const user = GOAL_EXTRACT_USER_TEMPLATE({
        blockName: f.data.blockName,
        criticalQuestion: f.data.criticalQuestion,
        trustedAnswer: f.data.trustedAnswer,
        signalType: f.data.signalType,
        tags: f.data.tags,
        evidenceQuotes: f.data.evidenceQuotes,
      });
      expect(user).toContain(f.data.blockName);
      expect(user).toContain('goal_extract_v1');
      for (const q of f.data.evidenceQuotes) {
        expect(user).toContain(q);
      }
      expect(user.length).toBeGreaterThan(50);
    });
  }

  describe.skipIf(!REAL_RUN)('реальный прогон через LLM', () => {
    it.todo('TODO: подключить реальный LlmRouterService для прогона goal-extract');
  });

  describe('инварианты ожиданий (mock-режим)', () => {
    interface MockExtract {
      isGoal: boolean;
      statement: string;
      description: string | null;
      horizon: string;
      measurable: { name: string } | null;
      confidence: number;
    }

    function checkInvariants(
      fixture: FixtureData,
      mock: MockExtract,
    ): { pass: boolean; failures: string[] } {
      const failures: string[] = [];
      const exp = fixture.expected;

      // Forbidden words — всегда (даже на reject-пути не должно прорваться).
      if (Array.isArray(exp.forbiddenWords)) {
        const combined = (
          mock.statement +
          ' ' +
          (mock.description ?? '')
        ).toLowerCase();
        for (const w of exp.forbiddenWords) {
          if (combined.includes(w.toLowerCase())) {
            failures.push(`Forbidden word "${w}" present`);
          }
        }
      }

      // isGoal должен совпасть с ожиданием.
      if (mock.isGoal !== exp.isGoal) {
        failures.push(`isGoal mismatch: expected ${exp.isGoal}, got ${mock.isGoal}`);
      }

      if (exp.isGoal === false) {
        // На отказе — больше ничего не проверяем (statement = «недостаточно сигнала»).
        return { pass: failures.length === 0, failures };
      }

      // statement должен содержать хотя бы одно ключевое слово (outcome-фокус).
      if (Array.isArray(exp.statementKeywords)) {
        const combined = (
          mock.statement +
          ' ' +
          (mock.description ?? '')
        ).toLowerCase();
        const matched = exp.statementKeywords.some((kw) =>
          combined.includes(kw.toLowerCase()),
        );
        if (!matched) {
          failures.push(
            `No statementKeyword matched. Expected one of [${exp.statementKeywords.join(', ')}] in: "${mock.statement}" / "${mock.description ?? ''}"`,
          );
        }
      }

      if (exp.expectedHorizon && exp.expectedHorizon !== mock.horizon) {
        failures.push(
          `Horizon mismatch: expected ${exp.expectedHorizon}, got ${mock.horizon}`,
        );
      }

      if (exp.hasMeasurable === true && mock.measurable === null) {
        failures.push('Expected measurable KR, got null');
      }
      if (exp.hasMeasurable === false && mock.measurable !== null) {
        failures.push('Expected no measurable, got one');
      }

      // statement length по схеме (min 3).
      if (mock.statement.length < 3) {
        failures.push(`statement too short: ${mock.statement.length}`);
      }

      return { pass: failures.length === 0, failures };
    }

    function findFixture(idPart: string): FixtureData {
      const f = fixtures.find((x) => x.name.includes(idPart));
      if (!f) throw new Error(`Fixture matching "${idPart}" not found`);
      return f.data;
    }

    it('valid-фикстура с числом: правильный mock-ответ проходит', () => {
      const fixture = findFixture('01');
      const result = checkInvariants(fixture, {
        isGoal: true,
        statement: 'Провести 100 встреч с клиентами за квартал',
        description: 'рост воронки продаж с 20 до 100 встреч',
        horizon: 'quarterly',
        measurable: { name: 'Встречи' },
        confidence: 0.85,
      });
      expect(result.failures).toEqual([]);
      expect(result.pass).toBe(true);
    });

    it('valid-фикстура: output-формулировка валится на forbidden words', () => {
      const fixture = findFixture('01');
      const result = checkInvariants(fixture, {
        isGoal: true,
        // «сделать» — output, попадает в forbiddenWords фикстуры 01.
        statement: 'Сделать фичу для встреч',
        description: null,
        horizon: 'quarterly',
        measurable: { name: 'Встречи' },
        confidence: 0.6,
      });
      expect(result.pass).toBe(false);
      expect(result.failures.some((x) => x.startsWith('Forbidden word'))).toBe(
        true,
      );
    });

    it('reject-фикстура: mock-отказ (isGoal=false) проходит', () => {
      const reject = fixtures.find((f) => f.data.category === 'reject')!.data;
      const result = checkInvariants(reject, {
        isGoal: false,
        statement: 'недостаточно сигнала',
        description: null,
        horizon: 'quarterly',
        measurable: null,
        confidence: 0.1,
      });
      expect(result.failures).toEqual([]);
      expect(result.pass).toBe(true);
    });

    it('reject-фикстура: ложное извлечение (isGoal=true) валится', () => {
      const reject = fixtures.find((f) => f.data.category === 'reject')!.data;
      const result = checkInvariants(reject, {
        isGoal: true,
        statement: 'Какая-то выдуманная цель',
        description: null,
        horizon: 'quarterly',
        measurable: null,
        confidence: 0.6,
      });
      expect(result.pass).toBe(false);
      expect(result.failures.some((x) => x.startsWith('isGoal mismatch'))).toBe(
        true,
      );
    });

    it('valid-фикстура: неверный горизонт валится', () => {
      const fixture = findFixture('03'); // sprint-фокус
      const result = checkInvariants(fixture, {
        isGoal: true,
        statement: 'Закрыть 5 демо за спринт',
        description: null,
        horizon: 'annual', // ожидался sprint
        measurable: { name: 'Демо' },
        confidence: 0.6,
      });
      expect(result.pass).toBe(false);
      expect(result.failures.some((x) => x.startsWith('Horizon mismatch'))).toBe(
        true,
      );
    });
  });
});
