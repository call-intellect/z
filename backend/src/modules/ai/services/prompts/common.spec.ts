import { describe, expect, it } from 'vitest';

import {
  EDGE_CASE_POLICY,
  Z_GLOBAL_PREAMBLE,
  withEdgeCasePolicy,
  withZPreamble,
} from './common';

describe('withZPreamble', () => {
  const SYSTEM = 'Ты — knowledge-инженер. Извлеки сущности.';

  it('добавляет preamble в начало system-промпта', () => {
    const out = withZPreamble(SYSTEM);
    expect(out.startsWith(Z_GLOBAL_PREAMBLE)).toBe(true);
    expect(out).toContain(SYSTEM);
    expect(out.indexOf(Z_GLOBAL_PREAMBLE)).toBeLessThan(out.indexOf(SYSTEM));
  });

  it('preamble упоминает Z / Кора / русский / injection-guard', () => {
    expect(Z_GLOBAL_PREAMBLE).toContain('Z');
    expect(Z_GLOBAL_PREAMBLE).toContain('Кора');
    expect(Z_GLOBAL_PREAMBLE).toContain('русском');
    // Ссылка на маркеры USER_DATA_BEGIN — защита от prompt-injection.
    expect(Z_GLOBAL_PREAMBLE).toContain('USER_DATA_BEGIN');
    expect(Z_GLOBAL_PREAMBLE.toLowerCase()).toContain('игнорируй');
  });

  it('preamble и system разделены пустой строкой', () => {
    const out = withZPreamble('BODY');
    expect(out).toBe(`${Z_GLOBAL_PREAMBLE}\n\nBODY`);
  });
});

describe('withEdgeCasePolicy', () => {
  const SYSTEM = 'Ты — knowledge-инженер. Извлеки решение из блока.';

  it('добавляет политику в конец system-промпта', () => {
    const out = withEdgeCasePolicy(SYSTEM);
    expect(out.startsWith(SYSTEM)).toBe(true);
    expect(out).toContain(EDGE_CASE_POLICY);
    expect(out.indexOf(EDGE_CASE_POLICY)).toBeGreaterThan(0);
  });

  it('политика покрывает три ключевых кейса (пустой/противоречие/относительные сроки)', () => {
    expect(EDGE_CASE_POLICY).toContain('Пустой');
    expect(EDGE_CASE_POLICY).toContain('недостаточно сигнала');
    expect(EDGE_CASE_POLICY).toContain('Противоречие');
    expect(EDGE_CASE_POLICY).toContain('confidence');
    expect(EDGE_CASE_POLICY).toContain('Относительные сроки');
    expect(EDGE_CASE_POLICY).toContain('ISO-8601');
    expect(EDGE_CASE_POLICY).toContain('meetingDateIso');
  });

  it('двойной вызов не теряет тело system (хоть и не идемпотентен по содержанию)', () => {
    const once = withEdgeCasePolicy(SYSTEM);
    const twice = withEdgeCasePolicy(once);
    expect(twice).toContain(SYSTEM);
    // Политика повторилась — это ожидаемо (helper не самоидемпотентен), но
    // система не сломалась. Зафиксируем поведение тестом, чтобы случайная
    // оптимизация в виде «уберём дубль» не прошла без явного решения.
    const count = twice.split(EDGE_CASE_POLICY).length - 1;
    expect(count).toBe(2);
  });
});
