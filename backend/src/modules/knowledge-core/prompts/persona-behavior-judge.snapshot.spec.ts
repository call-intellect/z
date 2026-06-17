import { describe, expect, it } from 'vitest';

import {
  PERSONA_BEHAVIOR_JUDGE_JSON_SCHEMA,
  PERSONA_BEHAVIOR_JUDGE_SCHEMA_NAME,
  PERSONA_BEHAVIOR_JUDGE_SYSTEM_PROMPT,
  PERSONA_BEHAVIOR_JUDGE_USER_TEMPLATE,
} from './persona-behavior-judge.prompt';

describe('persona-behavior-judge — snapshot сборки промта', () => {
  it('system prompt стабилен (поведенческий ход + запреты + шкала score)', () => {
    expect(PERSONA_BEHAVIOR_JUDGE_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('system фиксирует оценку ТОЛЬКО поведенческого хода', () => {
    expect(PERSONA_BEHAVIOR_JUDGE_SYSTEM_PROMPT).toContain('ПОВЕДЕНЧЕСК');
    expect(PERSONA_BEHAVIOR_JUDGE_SYSTEM_PROMPT).toContain('оценивай ТОЛЬКО поведение');
  });

  it('system запрещает учитывать самоописания характера и стиль/длину текста', () => {
    expect(PERSONA_BEHAVIOR_JUDGE_SYSTEM_PROMPT).toContain('ЗАПРЕЩЕНО учитывать');
    expect(PERSONA_BEHAVIOR_JUDGE_SYSTEM_PROMPT).toContain('самоописания характера');
    expect(PERSONA_BEHAVIOR_JUDGE_SYSTEM_PROMPT).toContain('я осторожный');
    expect(PERSONA_BEHAVIOR_JUDGE_SYSTEM_PROMPT).toContain(
      'стиль и красоту текста, длину ответа, вежливость',
    );
    expect(PERSONA_BEHAVIOR_JUDGE_SYSTEM_PROMPT).toContain('Суждения о характере');
  });

  it('system фиксирует шкалу score (1.0 / 0.5 / 0.0) и запрет добра за уверенность', () => {
    expect(PERSONA_BEHAVIOR_JUDGE_SYSTEM_PROMPT).toContain('1.0 — ход по сути совпадает');
    expect(PERSONA_BEHAVIOR_JUDGE_SYSTEM_PROMPT).toContain('0.5 — частично совпадает');
    expect(PERSONA_BEHAVIOR_JUDGE_SYSTEM_PROMPT).toContain(
      '0.0 — противоположный или выдуманный ход',
    );
    expect(PERSONA_BEHAVIOR_JUDGE_SYSTEM_PROMPT).toContain('Запрет добра за уверенность');
  });

  it('system фиксирует «честный отказ при существовавшем ходе = 0.3»', () => {
    expect(PERSONA_BEHAVIOR_JUDGE_SYSTEM_PROMPT).toContain('честный отказ');
    expect(PERSONA_BEHAVIOR_JUDGE_SYSTEM_PROMPT).toContain('= 0.3');
    expect(PERSONA_BEHAVIOR_JUDGE_SYSTEM_PROMPT).toContain('лучше выдумки, но хуже попадания');
  });

  it('schema strict: required scoreA/scoreB/behaviorMatchA/behaviorMatchB, score 0..1', () => {
    expect(PERSONA_BEHAVIOR_JUDGE_SCHEMA_NAME).toBe('persona_behavior_judge_v1');
    const schema = PERSONA_BEHAVIOR_JUDGE_JSON_SCHEMA as {
      additionalProperties: boolean;
      required: string[];
      properties: {
        scoreA: { minimum: number; maximum: number };
        scoreB: { minimum: number; maximum: number };
      };
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['scoreA', 'scoreB', 'behaviorMatchA', 'behaviorMatchB']);
    expect(schema.properties.scoreA.minimum).toBe(0);
    expect(schema.properties.scoreA.maximum).toBe(1);
    expect(schema.properties.scoreB.minimum).toBe(0);
    expect(schema.properties.scoreB.maximum).toBe(1);
  });

  it('user prompt стабилен для типичного кейса (переменные в конце — cache-friendly)', () => {
    const user = PERSONA_BEHAVIOR_JUDGE_USER_TEMPLATE({
      roleName: 'Руководитель проектов',
      caseSituation: 'срыв срока по биллингу',
      actualMove:
        'Сразу пошёл к владельцу с двумя вариантами: режем scope или двигаем релиз; после решения урезали scope.',
      answerA: 'Я бы молча пересогласовал даты с командой и сообщил владельцу постфактум.',
      answerB:
        'Сначала эскалирую владельцу с 2 вариантами (резать scope или двигать дату), и только после решения режу функционал.',
    });
    expect(user).toMatchSnapshot('user');
  });
});
