import { describe, expect, it } from 'vitest';

import {
  PROCESS_MARKER_DETECT_JSON_SCHEMA,
  PROCESS_MARKER_DETECT_SCHEMA_NAME,
  PROCESS_MARKER_DETECT_SYSTEM_PROMPT,
  PROCESS_MARKER_DETECT_USER_TEMPLATE,
} from './process-marker-detect.prompt';

describe('process-marker-detect — snapshot сборки промта', () => {
  it('system prompt стабилен (конструктивные оси + запрет оценочных + few-shots + EDGE_CASE_POLICY + ASR_NOTE)', () => {
    expect(PROCESS_MARKER_DETECT_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('system перечисляет конструктивные оси (что человек ДЕЛАЕТ)', () => {
    expect(PROCESS_MARKER_DETECT_SYSTEM_PROMPT).toContain('перечисляет критерии');
    expect(PROCESS_MARKER_DETECT_SYSTEM_PROMPT).toContain('наблюдаемое ДЕЙСТВИЕ процесса');
  });

  it('system содержит ЖЁСТКИЙ ЗАПРЕТ оценочных осей («избегает решений» / «не решает сам» / «нерешителен»)', () => {
    expect(PROCESS_MARKER_DETECT_SYSTEM_PROMPT).toContain('ЖЁСТКИЙ ЗАПРЕТ');
    const forbidden = ['избегает решений', 'не решает сам', 'нерешителен'];
    for (const phrase of forbidden) {
      expect(PROCESS_MARKER_DETECT_SYSTEM_PROMPT).toContain(phrase);
      const lines = PROCESS_MARKER_DETECT_SYSTEM_PROMPT.split('\n').filter((l) =>
        l.includes(phrase),
      );
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(
          line.includes('НИКОГДА не выводи') ||
            line.includes('НЕ извлекать') ||
            line.includes('запрещённой оценочной оси'),
        ).toBe(true);
      }
    }
  });

  it('system НЕ содержит латинских осей-приговоров (avoidant/dependent)', () => {
    expect(PROCESS_MARKER_DETECT_SYSTEM_PROMPT).not.toContain('avoidant');
    expect(PROCESS_MARKER_DETECT_SYSTEM_PROMPT).not.toContain('dependent');
  });

  it('system фиксирует правило пустого результата (нет приёма / только оценочная ось → sourceBlockIds=[])', () => {
    expect(PROCESS_MARKER_DETECT_SYSTEM_PROMPT).toContain('Пустой результат');
    expect(PROCESS_MARKER_DETECT_SYSTEM_PROMPT).toContain('sourceBlockIds=[]');
  });

  it('system требует гипотезный тон с qualifier и повторяемость приёма', () => {
    expect(PROCESS_MARKER_DETECT_SYSTEM_PROMPT).toContain('похоже,');
    expect(PROCESS_MARKER_DETECT_SYSTEM_PROMPT).toContain('ПОВТОРЯТЬСЯ');
  });

  it('schema strict: БЕЗ поля layer (слой фиксирован детектором), все поля required, additionalProperties=false', () => {
    const schema = PROCESS_MARKER_DETECT_JSON_SCHEMA as {
      additionalProperties: boolean;
      required: string[];
      properties: Record<string, unknown> & {
        sourceBlockIds: { maxItems: number };
      };
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.layer).toBeUndefined();
    expect(schema.required).not.toContain('layer');
    expect(schema.properties.sourceBlockIds.maxItems).toBe(50);
    expect(schema.required).toEqual([
      'category',
      'statement',
      'confidence',
      'sourceBlockIds',
      'firstObservedAt',
      'lastConfirmedAt',
    ]);
    expect(PROCESS_MARKER_DETECT_SCHEMA_NAME).toBe('process_marker_detect_v1');
  });

  it('user prompt стабилен для 3 цитат (переменные в конце — cache-friendly)', () => {
    const user = PROCESS_MARKER_DETECT_USER_TEMPLATE({
      personName: 'Сергей',
      personRole: 'Руководитель разработки',
      quotes: [
        {
          blockId: 'b1',
          quote:
            'Прежде чем оценивать срок, давайте посмотрим замеры нагрузки — без данных это гадание.',
          observedAt: '2026-04-05T10:00:00.000Z',
        },
        {
          blockId: 'b2',
          quote: 'Я не буду оценивать этот эпик, пока не увижу метрики прошлого квартала.',
          observedAt: '2026-04-19T14:00:00.000Z',
        },
        {
          blockId: 'b3',
          quote: 'Покажите цифры по конверсии — тогда скажу, сколько займёт доработка.',
          observedAt: '2026-05-18T11:00:00.000Z',
        },
      ],
    });
    expect(user).toMatchSnapshot('user');
    expect(user).toContain('Если повторяемого приёма нет — sourceBlockIds: []');
  });
});
