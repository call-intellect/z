/**
 * Agents v2 Фаза 0.1 (2026-05-30) — Probe-Formulate без кнопок.
 *
 * Property test для `PROBE_FORMULATE_JSON_SCHEMA` / `PROBE_FORMULATE_SCHEMA_NAME`.
 * Проверяет, что:
 *   - схема НЕ требует поля `options` (убрано в v2);
 *   - в `properties` нет ключа `options`;
 *   - schema name обновлён до `probe_formulate_v2` (синхронизирован с UI/каналами,
 *     которые рисуют ответ как свободный ввод).
 *
 * Если придёт PR, возвращающий `options` в схему — этот тест упадёт и
 * вынудит автора осознанно обновить весь канал (frontend, telegram bot,
 * dispatcher worker), а не просто «откатить промпт».
 */
import { describe, expect, it } from 'vitest';

import {
  PROBE_FORMULATE_JSON_SCHEMA,
  PROBE_FORMULATE_SCHEMA_NAME,
  PROBE_FORMULATE_SYSTEM_PROMPT,
  PROBE_FORMULATE_USER_TEMPLATE,
} from './probe-formulate.prompt';

describe('probe-formulate prompt — v2 без options', () => {
  it('SCHEMA_NAME = probe_formulate_v2', () => {
    expect(PROBE_FORMULATE_SCHEMA_NAME).toBe('probe_formulate_v2');
  });

  it('JSON Schema требует ТОЛЬКО question', () => {
    const required = PROBE_FORMULATE_JSON_SCHEMA.required;
    expect(Array.isArray(required)).toBe(true);
    expect(required).toEqual(['question']);
    expect((required as string[]).includes('options')).toBe(false);
  });

  it('JSON Schema.properties не содержит options', () => {
    const properties = PROBE_FORMULATE_JSON_SCHEMA.properties as Record<
      string,
      unknown
    >;
    expect(properties).toBeDefined();
    expect(properties.options).toBeUndefined();
    expect(properties.question).toBeDefined();
  });

  it('SYSTEM_PROMPT упоминает «без вариантов ответа»', () => {
    // Регрессия: если кто-то вернёт «2-4 кнопки» в SYSTEM — тест упадёт.
    expect(PROBE_FORMULATE_SYSTEM_PROMPT).toContain('без вариантов ответа');
  });

  it('USER_TEMPLATE передаёт suggestedActions как КОНТЕКСТ, а не как варианты', () => {
    const user = PROBE_FORMULATE_USER_TEMPLATE({
      emittedByService: 'test',
      reason: 'demo',
      message: 'msg',
      suggestedActions: ['A', 'B'],
    });
    // Промпт должен прямо сказать модели «НЕ перечисляй их человеку».
    expect(user).toContain('НЕ перечисляй');
  });
});
