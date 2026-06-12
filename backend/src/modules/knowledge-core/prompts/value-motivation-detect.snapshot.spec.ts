/**
 * Snapshot-тест сборки промта `value-motivation-detect.prompt.ts`
 * (TZ clone-method Э1.3 — детектор ценностей/мотивации из trade-off).
 *
 * ⚠ НЕ про качество LLM-вывода. Snapshot фиксирует:
 *   - текст `VALUE_MOTIVATION_DETECT_SYSTEM_PROMPT` (constant — guard от
 *     случайных правок жёстких правил: «ценность видна ТОЛЬКО в
 *     выборе-в-ущерб», запрет научного жаргона (Schwartz/SDT), запрет
 *     негативных формулировок и правило пустого результата должны быть
 *     стабильны; плюс SYSTEM cache-friendly — правка ломает prompt-кэш);
 *   - сборку `VALUE_MOTIVATION_DETECT_USER_TEMPLATE` для типичного входа.
 *
 * Обновлять только при осознанном изменении: `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import {
  VALUE_MOTIVATION_DETECT_JSON_SCHEMA,
  VALUE_MOTIVATION_DETECT_SCHEMA_NAME,
  VALUE_MOTIVATION_DETECT_SYSTEM_PROMPT,
  VALUE_MOTIVATION_DETECT_USER_TEMPLATE,
} from './value-motivation-detect.prompt';

describe('value-motivation-detect — snapshot сборки промта', () => {
  it('system prompt стабилен (trade-off инвариант + запрет жаргона + few-shots + EDGE_CASE_POLICY + ASR_NOTE)', () => {
    expect(VALUE_MOTIVATION_DETECT_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('system требует выбор-в-ущерб (trade-off) как единственный источник ценности', () => {
    expect(VALUE_MOTIVATION_DETECT_SYSTEM_PROMPT).toContain('УЩЕРБ');
    expect(VALUE_MOTIVATION_DETECT_SYSTEM_PROMPT).toContain('trade-off');
  });

  it('system запрещает научный жаргон (греп «Schwartz»)', () => {
    expect(VALUE_MOTIVATION_DETECT_SYSTEM_PROMPT).toContain('Schwartz');
    expect(VALUE_MOTIVATION_DETECT_SYSTEM_PROMPT).toContain(
      'ЗАПРЕЩЁН научный жаргон',
    );
  });

  it('system фиксирует правило пустого результата (нет trade-off → sourceBlockIds=[])', () => {
    expect(VALUE_MOTIVATION_DETECT_SYSTEM_PROMPT).toContain('Пустой результат');
    expect(VALUE_MOTIVATION_DETECT_SYSTEM_PROMPT).toContain('sourceBlockIds=[]');
  });

  it('system запрещает негативные формулировки (ценность всегда позитивно)', () => {
    expect(VALUE_MOTIVATION_DETECT_SYSTEM_PROMPT).toContain('не ценит');
    expect(VALUE_MOTIVATION_DETECT_SYSTEM_PROMPT).toContain('СТАВИТ ВЫШЕ');
  });

  it('system разводит revealed vs stated (заявленное ≠ проявленное)', () => {
    expect(VALUE_MOTIVATION_DETECT_SYSTEM_PROMPT).toContain(
      'Заявленное ≠ проявленное',
    );
  });

  it('schema strict: layer ∈ {value, motivation}, все поля required, additionalProperties=false', () => {
    const schema = VALUE_MOTIVATION_DETECT_JSON_SCHEMA as {
      additionalProperties: boolean;
      required: string[];
      properties: {
        layer: { enum: string[] };
        sourceBlockIds: { maxItems: number };
      };
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.layer.enum).toEqual(['value', 'motivation']);
    expect(schema.properties.sourceBlockIds.maxItems).toBe(50);
    expect(schema.required).toEqual([
      'layer',
      'category',
      'statement',
      'confidence',
      'sourceBlockIds',
      'firstObservedAt',
      'lastConfirmedAt',
    ]);
    expect(VALUE_MOTIVATION_DETECT_SCHEMA_NAME).toBe(
      'value_motivation_detect_v1',
    );
  });

  it('user prompt стабилен для 3 цитат (переменные в конце — cache-friendly)', () => {
    const user = VALUE_MOTIVATION_DETECT_USER_TEMPLATE({
      personName: 'Сергей',
      personRole: 'Руководитель разработки',
      quotes: [
        {
          blockId: 'b1',
          quote:
            'Давайте перенесём релиз, я не готов выпускать без нагрузочного теста — лучше неделя задержки, чем падение у клиентов.',
          observedAt: '2026-04-05T10:00:00.000Z',
        },
        {
          blockId: 'b2',
          quote:
            'Я тогда отказался выкатывать в пятницу — да, сорвали обещание продажам, зато выходные прошли без инцидентов.',
          observedAt: '2026-04-19T14:00:00.000Z',
        },
        {
          blockId: 'b3',
          quote:
            'Пусть фича выйдет позже, но с мониторингом — я не повезу клиентам сырое.',
          observedAt: '2026-05-18T11:00:00.000Z',
        },
      ],
    });
    expect(user).toMatchSnapshot('user');
    expect(user).toContain('Если решающего момента нет — sourceBlockIds: []');
  });
});
