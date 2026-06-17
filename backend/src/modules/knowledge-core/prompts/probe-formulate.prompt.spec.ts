import { describe, expect, it } from 'vitest';

import {
  PROBE_FORMULATE_JSON_SCHEMA,
  PROBE_FORMULATE_SCHEMA_NAME,
  PROBE_FORMULATE_SYSTEM_PROMPT,
  PROBE_FORMULATE_USER_TEMPLATE,
} from './probe-formulate.prompt';

describe('probe-formulate prompt — v3 (Фаза 1)', () => {
  it('SCHEMA_NAME = probe_formulate_v3', () => {
    expect(PROBE_FORMULATE_SCHEMA_NAME).toBe('probe_formulate_v3');
  });

  it('JSON Schema требует ТОЛЬКО question (без options)', () => {
    const required = PROBE_FORMULATE_JSON_SCHEMA.required;
    expect(Array.isArray(required)).toBe(true);
    expect(required).toEqual(['question']);
    const properties = PROBE_FORMULATE_JSON_SCHEMA.properties as Record<string, unknown>;
    expect(properties.options).toBeUndefined();
    expect(properties.question).toBeDefined();
  });

  it('SYSTEM стабилен (тип string, без интерполяции) и задаёт правила', () => {
    expect(typeof PROBE_FORMULATE_SYSTEM_PROMPT).toBe('string');
    expect(PROBE_FORMULATE_SYSTEM_PROMPT).not.toContain('${');
    expect(PROBE_FORMULATE_SYSTEM_PROMPT).toContain('Без вариантов ответа');
    expect(PROBE_FORMULATE_SYSTEM_PROMPT).toContain('Чистый русский');
  });

  it('USER подаёт reasonLabel и НЕ содержит машинных кодов', () => {
    const user = PROBE_FORMULATE_USER_TEMPLATE({
      reasonLabel: 'решение просрочено',
      message: 'Решение "Перейти на нового подрядчика" просрочено.',
      suggestedActions: ['Уточнить статус', 'Назначить ответственного'],
      contextCard: { kind: 'Решение', title: 'Новый подрядчик' },
    });
    expect(user).toContain('Тип ситуации: решение просрочено');
    expect(user).toContain('Объект: Решение «Новый подрядчик»');
    expect(user).not.toContain('decision.overdue');
    expect(user).not.toContain('3-3-decisions');
    expect(user).not.toContain('Источник: специалист');
    expect(user).not.toContain('Причина:');
    expect(user).toContain('НЕ перечисляй');
    expect(user).toContain('probe_formulate_v3');
  });

  it('USER без объекта и без подсказок не падает', () => {
    const user = PROBE_FORMULATE_USER_TEMPLATE({
      reasonLabel: 'требуется уточнение',
      message: 'msg',
      suggestedActions: [],
    });
    expect(user).toContain('Тип ситуации: требуется уточнение');
    expect(user).not.toContain('Объект:');
    expect(user).not.toContain('Служебная подсказка');
  });
});
