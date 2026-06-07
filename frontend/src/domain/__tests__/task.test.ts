/**
 * Unit-тесты pickPrimaryTasks (ТЗ 2026-06-06 meeting-report-reliability-and-ui-honesty, Фаза 2 / S6-03).
 *
 * Проверяем, что теперь показываются ВСЕ извлечённые задачи:
 *   - fast + main (v2) объединяются (раньше «есть fast → только fast» прятало main),
 *   - дедуп по нормализованному заголовку (trim+lowercase), fast приоритетнее при дубле,
 *   - разные заголовки НЕ схлопываются,
 *   - fallback без fast сохранён (v2 + ручные null),
 *   - ручные задачи (extractorVersion: null) при наличии fast теперь тоже видны.
 */
import { describe, expect, it } from 'vitest';

import { normTaskTitle, pickPrimaryTasks, type TaskDomain } from '../task';

function makeTask(overrides: Partial<TaskDomain> = {}): TaskDomain {
  return {
    id: Math.random().toString(36).slice(2),
    meetingId: 'meeting_1',
    title: 'Задача',
    description: null,
    status: 'open',
    assignee: null,
    dueDate: null,
    sourceStartMs: null,
    sourceEndMs: null,
    sourceQuote: null,
    confidence: null,
    createdManually: false,
    createdAt: new Date('2026-06-06T00:00:00.000Z'),
    updatedAt: new Date('2026-06-06T00:00:00.000Z'),
    extractorVersion: null,
    ...overrides,
  };
}

describe('pickPrimaryTasks', () => {
  it('fast=1 + v2=5 без пересечения заголовков → 6 задач, fast первым', () => {
    const fast = makeTask({ id: 'fast_1', title: 'Fast задача', extractorVersion: 'fast' });
    const v2 = Array.from({ length: 5 }, (_, i) =>
      makeTask({ id: `v2_${i}`, title: `Main задача ${i}`, extractorVersion: 'v2' }),
    );

    const result = pickPrimaryTasks([...v2, fast]);

    expect(result).toHaveLength(6);
    expect(result[0]).toBe(fast);
    expect(result.slice(1)).toEqual(v2);
  });

  it('дедуп по нормализованному заголовку (регистр/пробелы) — дубль схлопнут к fast', () => {
    const fast = makeTask({
      id: 'fast_1',
      title: 'Набрать команду',
      extractorVersion: 'fast',
    });
    const v2Dup = makeTask({
      id: 'v2_dup',
      title: '  набрать команду ',
      extractorVersion: 'v2',
    });
    const v2Other = makeTask({
      id: 'v2_other',
      title: 'Запустить рекламу',
      extractorVersion: 'v2',
    });

    const result = pickPrimaryTasks([fast, v2Dup, v2Other]);

    // fast + (v2 минус дубль) = 2 задачи
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(fast);
    expect(result[1]).toBe(v2Other);
    // дублирующая v2-версия отброшена, осталась fast-версия заголовка
    expect(result.map((t) => t.id)).not.toContain('v2_dup');
  });

  it('разные заголовки НЕ схлопываются', () => {
    const fast = makeTask({ id: 'fast_1', title: 'Альфа', extractorVersion: 'fast' });
    const v2 = makeTask({ id: 'v2_1', title: 'Бета', extractorVersion: 'v2' });

    const result = pickPrimaryTasks([fast, v2]);

    expect(result).toHaveLength(2);
    expect(result.map((t) => t.title)).toEqual(['Альфа', 'Бета']);
  });

  it('нет fast, только v2 + null(ручная) → возвращаются все (fallback сохранён)', () => {
    const v2 = makeTask({ id: 'v2_1', title: 'V2 задача', extractorVersion: 'v2' });
    const manual = makeTask({
      id: 'manual_1',
      title: 'Ручная задача',
      extractorVersion: null,
      createdManually: true,
    });

    const result = pickPrimaryTasks([v2, manual]);

    expect(result).toHaveLength(2);
    expect(result.map((t) => t.id)).toEqual(['v2_1', 'manual_1']);
  });

  it('пустой массив → []', () => {
    expect(pickPrimaryTasks([])).toEqual([]);
  });

  it('ручная задача (extractorVersion: null) при наличии fast теперь ТОЖЕ показывается', () => {
    const fast = makeTask({ id: 'fast_1', title: 'Fast задача', extractorVersion: 'fast' });
    const manual = makeTask({
      id: 'manual_1',
      title: 'Ручная задача',
      extractorVersion: null,
      createdManually: true,
    });

    const result = pickPrimaryTasks([fast, manual]);

    // Раньше пряталась (был return только fast); теперь видна.
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(fast);
    expect(result.map((t) => t.id)).toContain('manual_1');
  });

  it('дедуп схлопывает разделитель тысяч: «…на 2 000» (main) ≡ «…на 2000» (fast) → 1 строка', () => {
    const fast = makeTask({
      id: 'fast_1',
      title: 'Сделать рассылку на 2000',
      extractorVersion: 'fast',
    });
    const v2Dup = makeTask({
      id: 'v2_dup',
      title: 'Сделать рассылку на 2 000',
      extractorVersion: 'v2',
    });

    const result = pickPrimaryTasks([fast, v2Dup]);

    // Дубль (отличается только разделителем тысяч) схлопнут к fast-версии.
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(fast);
    expect(result.map((t) => t.id)).not.toContain('v2_dup');
  });
});

describe('normTaskTitle', () => {
  it('разделитель тысяч схлопывается: «2 000» ≡ «2000»', () => {
    expect(normTaskTitle('Сделать рассылку на 2 000')).toBe(
      normTaskTitle('Сделать рассылку на 2000'),
    );
  });

  it('скобочное уточнение отбрасывается: «Набрать команду (3 чел)» ≡ «Набрать команду»', () => {
    expect(normTaskTitle('Набрать команду (3 чел)')).toBe(
      normTaskTitle('Набрать команду'),
    );
  });

  it('многоразрядное число без пробелов между цифрами: «1 000 000» → содержит «1000000»', () => {
    expect(normTaskTitle('1 000 000')).toContain('1000000');
  });

  it('NBSP как разделитель тысяч тоже схлопывается', () => {
    // «2 000» (неразрывный пробел) ≡ «2000»
    expect(normTaskTitle('Бюджет 2 000')).toBe(normTaskTitle('Бюджет 2000'));
  });

  it('negative: реально разные задачи НЕ схлопываются', () => {
    expect(normTaskTitle('50 сделок')).not.toBe(normTaskTitle('200 встреч'));
  });
});
