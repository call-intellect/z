/**
 * Snapshot-тест промта `axis-classify.prompt.ts`.
 *
 * Фиксирует:
 *   - текст `AXIS_CLASSIFY_SYSTEM_PROMPT`;
 *   - JSON-схему `AXIS_CLASSIFY_JSON_SCHEMA` (v2, русские temporal-ярлыки);
 *   - сборку USER через `AXIS_CLASSIFY_USER_TEMPLATE` (человеческий ярлык типа
 *     сигнала, без машинного кода — методология №3).
 *
 * Обновлять только при осознанном изменении: `bunx vitest --update`.
 * ТЗ 2026-06-16 (Прил. A2) — реконструирован по методологии (7 блоков).
 */
import { describe, expect, it } from 'vitest';

import {
  AXIS_CLASSIFY_JSON_SCHEMA,
  AXIS_CLASSIFY_SYSTEM_PROMPT,
  AXIS_CLASSIFY_USER_TEMPLATE,
  TEMPORAL_RU_TO_CODE,
} from './axis-classify.prompt';

describe('axis-classify — snapshot сборки промта', () => {
  it('system prompt стабилен', () => {
    expect(AXIS_CLASSIFY_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('JSON Schema стабилен', () => {
    expect(AXIS_CLASSIFY_JSON_SCHEMA).toMatchSnapshot('schema');
  });

  it('USER подаёт человеческий ярлык типа сигнала, а не код', () => {
    const user = AXIS_CLASSIFY_USER_TEMPLATE({
      blockName: 'Выбор подрядчика',
      signalType: 'decision',
      criticalQuestion: 'Какого подрядчика выбрали?',
      trustedAnswer: 'Решили работать с подрядчиком Б',
      tags: ['логистика'],
      domainWhitelist: [{ slug: 'ops', name: 'Операции' }],
      axesRequested: 'функциональную и временную',
    });
    expect(user).toContain('тип сигнала: принятое решение');
    expect(user).not.toContain('signalType=');
    expect(user).not.toContain('decision');
    expect(user).toMatchSnapshot('user');
  });

  it('обратный маппер русских temporal-ярлыков → код', () => {
    expect(TEMPORAL_RU_TO_CODE['постоянное']).toBe('temporal:permanent');
    expect(TEMPORAL_RU_TO_CODE['будущее']).toBe('temporal:future');
    expect(TEMPORAL_RU_TO_CODE['прошлое']).toBe('temporal:past');
  });
});
