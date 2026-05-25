/**
 * Golden-набор для агента `skill-trait-detect` (SBA γ-1, Specialist 3.7).
 *
 * Зачем:
 *   - Этот агент формулирует поведенческие черты сотрудника, которые
 *     показываются пользователю. Любой регресс качества формулировок
 *     («приговорный» стиль, пустые характеристики типа «ответственный»,
 *     отсутствие qualifier'а) подрывает доверие к продукту мгновенно.
 *   - Защита от случайной деградации после смены модели/промпта.
 *
 * Содержимое:
 *   - 20 валидных фикстур (LLM должен извлечь черту).
 *   - 5 отказных фикстур (LLM должен вернуть пустой sourceBlockIds).
 *
 * Режимы запуска:
 *   - Обычный: проверяет структуру фикстур + механику инвариантов на mock-ответах.
 *     `bun run test:unit -- skill-trait-detect-golden`
 *   - Реальный прогон через LLM: включается переменной окружения.
 *     `SKILL_TRAIT_DETECT_GOLDEN_REAL=1 bun run test`
 *     Не запускается на CI (дорого) — это эксперимент владельца.
 *
 * См. ТЗ: `plans/tz/2026-05-25-clone-reliability-hardening.md`, фаза 6.4.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SKILL_TRAIT_DETECT_JSON_SCHEMA,
  SKILL_TRAIT_DETECT_SYSTEM_PROMPT,
  SKILL_TRAIT_DETECT_USER_TEMPLATE,
} from '../../../src/modules/knowledge-core/prompts/skill-trait-detect.prompt';

interface FixtureQuote {
  blockId: string;
  quote: string;
  observedAt: string;
}

interface FixtureExpected {
  shouldExtract: boolean;
  reason?: string;
  categoryGloss?: string;
  categoryKeywords?: string[];
  statementContainsQualifier?: boolean;
  minObservations?: number;
  expectedConfidence?: 'low' | 'medium' | 'high';
  forbiddenWords?: string[];
}

interface FixtureData {
  fixtureId: string;
  category: 'valid' | 'reject';
  personName: string;
  personRole?: string | null;
  quotes: FixtureQuote[];
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

const REAL_RUN = process.env.SKILL_TRAIT_DETECT_GOLDEN_REAL === '1';

describe('skill-trait-detect — golden-набор', () => {
  it('собирается 25 фикстур (20 valid + 5 reject)', () => {
    expect(fixtures.length).toBe(25);
    const valid = fixtures.filter((f) => f.data.category === 'valid');
    const reject = fixtures.filter((f) => f.data.category === 'reject');
    expect(valid.length).toBe(20);
    expect(reject.length).toBe(5);
  });

  it('промпт и схема импортированы из модуля knowledge-core', () => {
    // Защита от случайного удаления экспортов промпта.
    expect(SKILL_TRAIT_DETECT_SYSTEM_PROMPT).toContain('knowledge-инженер');
    expect(SKILL_TRAIT_DETECT_JSON_SCHEMA).toHaveProperty('properties.statement');
    expect(typeof SKILL_TRAIT_DETECT_USER_TEMPLATE).toBe('function');
  });

  for (const f of fixtures) {
    it(`фикстура ${f.name}: структура валидна`, () => {
      const d = f.data;
      expect(d.fixtureId).toBeTruthy();
      expect(['valid', 'reject']).toContain(d.category);
      expect(d.quotes.length).toBeGreaterThanOrEqual(3);
      expect(d.expected).toBeTruthy();
      // У каждой цитаты — blockId, quote, валидная дата.
      for (const q of d.quotes) {
        expect(q.blockId).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(q.quote.length).toBeGreaterThan(0);
        expect(Number.isNaN(Date.parse(q.observedAt))).toBe(false);
      }
      // У валидных кейсов есть categoryKeywords + флаги, у отказных — shouldExtract=false.
      if (d.category === 'valid') {
        expect(d.expected.shouldExtract).toBe(true);
        expect(Array.isArray(d.expected.categoryKeywords)).toBe(true);
        expect(d.expected.categoryKeywords!.length).toBeGreaterThan(0);
      } else {
        expect(d.expected.shouldExtract).toBe(false);
      }
    });

    it(`фикстура ${f.name}: user-промпт собирается без ошибок`, () => {
      const user = SKILL_TRAIT_DETECT_USER_TEMPLATE({
        personName: f.data.personName,
        personRole: f.data.personRole ?? null,
        quotes: f.data.quotes,
      });
      expect(user).toContain(f.data.personName);
      // Промпт должен включать число цитат и их blockId.
      expect(user).toContain(String(f.data.quotes.length));
      for (const q of f.data.quotes) {
        expect(user).toContain(q.blockId);
      }
      expect(user.length).toBeGreaterThan(100);
    });

    it(`фикстура ${f.name}: даты идут по возрастанию (firstObserved <= lastConfirmed)`, () => {
      const dates = f.data.quotes
        .map((q) => Date.parse(q.observedAt))
        .filter((n) => !Number.isNaN(n));
      const min = Math.min(...dates);
      const max = Math.max(...dates);
      // Сама фикстура должна позволять корректно посчитать firstObservedAt/lastConfirmedAt.
      expect(max).toBeGreaterThanOrEqual(min);
    });
  }

  describe.skipIf(!REAL_RUN)('реальный прогон через LLM', () => {
    // Заглушка: реальный вызов через LlmRouter намеренно не подключён.
    // Включение этого блока — это эксперимент со своим бюджетом владельца.
    // Когда нужно прогнать — добавить здесь интеграцию с LlmRouterService и
    // прогнать каждую фикстуру через тот же путь, что и Specialist37Service,
    // затем сравнить ответ с инвариантами через checkInvariants ниже.
    it.todo('TODO: подключить реальный LlmRouterService для прогона на DeepSeek V4 Pro');
  });

  describe('инварианты ожиданий (mock-режим)', () => {
    /**
     * Проверка ответа LLM на соответствие инвариантам фикстуры.
     *
     * Возвращает { pass, failures } — пакет ошибок, а не первую.
     * Это нужно чтобы в реальном прогоне можно было увидеть все претензии сразу.
     */
    function checkInvariants(
      fixture: FixtureData,
      mockResponse: {
        category: string;
        statement: string;
        confidence: 'low' | 'medium' | 'high';
        sourceBlockIds: string[];
      },
    ): { pass: boolean; failures: string[] } {
      const failures: string[] = [];
      const exp = fixture.expected;

      // Forbidden words проверяем ВСЕГДА — даже для отказных кейсов
      // («приговорный» стиль не должен прорваться через путь отказа).
      if (Array.isArray(exp.forbiddenWords)) {
        const combined = (mockResponse.category + ' ' + mockResponse.statement).toLowerCase();
        for (const word of exp.forbiddenWords) {
          if (combined.includes(word.toLowerCase())) {
            failures.push(`Forbidden word "${word}" present`);
          }
        }
      }

      if (exp.shouldExtract === false) {
        if (mockResponse.sourceBlockIds.length > 0) {
          failures.push('Expected refusal (empty sourceBlockIds), got extraction');
        }
        return { pass: failures.length === 0, failures };
      }

      // Категория должна содержать хотя бы одно из ключевых слов (по подстроке).
      if (Array.isArray(exp.categoryKeywords)) {
        const combined = (mockResponse.category + ' ' + mockResponse.statement).toLowerCase();
        const matched = exp.categoryKeywords.some((kw) => combined.includes(kw.toLowerCase()));
        if (!matched) {
          failures.push(
            `No categoryKeyword matched. Expected one of [${exp.categoryKeywords.join(', ')}] in: "${mockResponse.category}" / "${mockResponse.statement}"`,
          );
        }
      }

      // Qualifier в statement: гипотезность формулировки.
      if (exp.statementContainsQualifier === true) {
        const qualifiers = [
          'похож',
          'склон',
          'в большинстве случаев',
          'часто',
          'как правило',
          'обычно',
        ];
        const has = qualifiers.some((q) =>
          mockResponse.statement.toLowerCase().includes(q),
        );
        if (!has) {
          failures.push(`No qualifier in statement: "${mockResponse.statement}"`);
        }
      }

      // Confidence: только если в фикстуре зафиксировано ожидание.
      if (exp.expectedConfidence && exp.expectedConfidence !== mockResponse.confidence) {
        failures.push(
          `Confidence mismatch: expected ${exp.expectedConfidence}, got ${mockResponse.confidence}`,
        );
      }

      // sourceBlockIds должны быть подмножеством входных blockId.
      const inputIds = new Set(fixture.quotes.map((q) => q.blockId));
      for (const id of mockResponse.sourceBlockIds) {
        if (!inputIds.has(id)) {
          failures.push(`sourceBlockId "${id}" not in fixture quotes`);
        }
      }

      // Длинные/короткие поля по JSON-схеме (минимальные требования).
      if (mockResponse.category.length < 3 || mockResponse.category.length > 200) {
        failures.push(`category length out of [3,200]: ${mockResponse.category.length}`);
      }
      if (mockResponse.statement.length < 10 || mockResponse.statement.length > 2000) {
        failures.push(`statement length out of [10,2000]: ${mockResponse.statement.length}`);
      }

      return { pass: failures.length === 0, failures };
    }

    function findFixture(idPart: string): FixtureData {
      const f = fixtures.find((x) => x.name.includes(idPart));
      if (!f) throw new Error(`Fixture matching "${idPart}" not found`);
      return f.data;
    }

    it('mock-ответ «правильный» проходит инварианты для фикстуры 01', () => {
      const fixture = findFixture('01');
      const result = checkInvariants(fixture, {
        category: 'осторожность с оценками сроков',
        statement:
          'Похоже, склонен откладывать коммит по срокам до сбора фактических данных — в большинстве случаев просит уточнить контекст.',
        confidence: 'medium',
        sourceBlockIds: ['f01-b1', 'f01-b2', 'f01-b3'],
      });
      expect(result.failures).toEqual([]);
      expect(result.pass).toBe(true);
    });

    it('mock-ответ с приговорным стилем валится на forbidden words', () => {
      const fixture = findFixture('01');
      const result = checkInvariants(fixture, {
        category: 'перфекционист',
        statement: 'Сергей — выдающийся аналитик, стремящийся к идеалу.',
        confidence: 'medium',
        sourceBlockIds: ['f01-b1', 'f01-b2', 'f01-b3'],
      });
      expect(result.pass).toBe(false);
      // Содержит «перфекционист» (category) и «выдающийся» (statement) — оба из forbiddenWords.
      const forbidden = result.failures.filter((m) => m.startsWith('Forbidden word'));
      expect(forbidden.length).toBeGreaterThanOrEqual(2);
      expect(forbidden.some((m) => m.includes('перфекционист'))).toBe(true);
      expect(forbidden.some((m) => m.includes('выдающийся'))).toBe(true);
    });

    it('mock-ответ без qualifier валится на проверке гипотезности', () => {
      const fixture = findFixture('02');
      const result = checkInvariants(fixture, {
        category: 'требует данных перед решением',
        statement: 'Алексей всегда принимает решения только на основе цифр и метрик.',
        confidence: 'medium',
        sourceBlockIds: ['f02-b1', 'f02-b2', 'f02-b3', 'f02-b4'],
      });
      expect(result.pass).toBe(false);
      expect(result.failures.some((m) => m.startsWith('No qualifier'))).toBe(true);
    });

    it('mock-отказ для reject-фикстуры проходит', () => {
      const reject = fixtures.find((f) => f.data.category === 'reject')!.data;
      const result = checkInvariants(reject, {
        category: 'недостаточно сигнала',
        statement: 'В цитатах нет reasoning — trait не извлекается.',
        confidence: 'low',
        sourceBlockIds: [], // пустой — это сигнал отказа
      });
      expect(result.failures).toEqual([]);
      expect(result.pass).toBe(true);
    });

    it('mock-«извлечение» для reject-фикстуры валится', () => {
      const reject = fixtures.find((f) => f.data.category === 'reject')!.data;
      const result = checkInvariants(reject, {
        category: 'дисциплинирован с commitments',
        statement: 'Похоже, склонна быстро брать задачи в работу.',
        confidence: 'low',
        sourceBlockIds: [reject.quotes[0]!.blockId],
      });
      expect(result.pass).toBe(false);
      expect(
        result.failures.some((m) =>
          m.includes('Expected refusal (empty sourceBlockIds)'),
        ),
      ).toBe(true);
    });

    it('mock-ответ с sourceBlockId вне входа валится', () => {
      const fixture = findFixture('03');
      const result = checkInvariants(fixture, {
        category: 'делегирует ранние оценки',
        statement: 'Похоже, склонна делегировать ранние оценки тимлиду.',
        confidence: 'medium',
        sourceBlockIds: ['some-other-block'], // не из фикстуры
      });
      expect(result.pass).toBe(false);
      expect(
        result.failures.some((m) => m.includes('not in fixture quotes')),
      ).toBe(true);
    });

    it('mock-ответ с неверным confidence валится', () => {
      const fixture = findFixture('01');
      const result = checkInvariants(fixture, {
        category: 'осторожность с оценками сроков',
        statement: 'Похоже, склонен просить данных перед оценкой сроков.',
        confidence: 'high', // ожидался medium
        sourceBlockIds: ['f01-b1', 'f01-b2', 'f01-b3'],
      });
      expect(result.pass).toBe(false);
      expect(
        result.failures.some((m) => m.startsWith('Confidence mismatch')),
      ).toBe(true);
    });
  });
});
