/**
 * Snapshot-тест сборки промта `cdm-case-interview.prompt.ts`
 * (TZ clone-method Э3.1 — CDM-интервью носителя роли).
 *
 * ⚠ НЕ про качество LLM-вывода. Snapshot фиксирует:
 *   - текст `CDM_CASE_INTERVIEW_SYSTEM_PROMPT` (constant — guard от
 *     случайных правок жёстких правил: 4 направления CDM, запрет наводящих
 *     вопросов, запрет вариантов ответа/кнопок, few-shot с антипримером
 *     должны быть стабильны; плюс SYSTEM cache-friendly — правка ломает
 *     prompt-кэш);
 *   - сборку `CDM_CASE_INTERVIEW_USER_TEMPLATE` для типичного входа.
 *
 * Обновлять только при осознанном изменении: `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import {
  CDM_CASE_INTERVIEW_JSON_SCHEMA,
  CDM_CASE_INTERVIEW_SCHEMA_NAME,
  CDM_CASE_INTERVIEW_SYSTEM_PROMPT,
  CDM_CASE_INTERVIEW_USER_TEMPLATE,
} from './cdm-case-interview.prompt';

describe('cdm-case-interview — snapshot сборки промта', () => {
  it('system prompt стабилен (4 направления CDM + запрет наводящих + few-shot с антипримером)', () => {
    expect(CDM_CASE_INTERVIEW_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('system перечисляет направления CDM («почему выбрали», «насторожило», «альтернативы», «что бы изменило»)', () => {
    expect(CDM_CASE_INTERVIEW_SYSTEM_PROMPT).toContain('почему выбрали');
    expect(CDM_CASE_INTERVIEW_SYSTEM_PROMPT).toContain('насторожило');
    expect(CDM_CASE_INTERVIEW_SYSTEM_PROMPT).toContain('альтернативы');
    expect(CDM_CASE_INTERVIEW_SYSTEM_PROMPT).toContain(
      'что могло бы изменить решение',
    );
  });

  it('system запрещает наводящие вопросы (без подсказки ответа, без да/нет)', () => {
    expect(CDM_CASE_INTERVIEW_SYSTEM_PROMPT).toContain('НЕ наводящий');
    expect(CDM_CASE_INTERVIEW_SYSTEM_PROMPT).toContain(
      'подсказки «правильного» ответа',
    );
    expect(CDM_CASE_INTERVIEW_SYSTEM_PROMPT).toContain('да/нет');
    // Антипример наводящего «вы ведь … верно?» присутствует как few-shot.
    expect(CDM_CASE_INTERVIEW_SYSTEM_PROMPT).toContain('АНТИПРИМЕР');
    expect(CDM_CASE_INTERVIEW_SYSTEM_PROMPT).toContain('Вы ведь');
  });

  it('system запрещает варианты ответа и кнопки (только открытый вопрос, текст/голос)', () => {
    expect(CDM_CASE_INTERVIEW_SYSTEM_PROMPT).toContain(
      'НИКАКИХ вариантов ответа, кнопок',
    );
    expect(CDM_CASE_INTERVIEW_SYSTEM_PROMPT).toContain(
      'свободным текстом или голосом',
    );
  });

  it('schema strict: question(10..500) + cdmAngle ∈ 4 направления, additionalProperties=false', () => {
    const schema = CDM_CASE_INTERVIEW_JSON_SCHEMA as {
      additionalProperties: boolean;
      required: string[];
      properties: {
        question: { minLength: number; maxLength: number };
        cdmAngle: { enum: string[] };
      };
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['question', 'cdmAngle']);
    expect(schema.properties.question.minLength).toBe(10);
    expect(schema.properties.question.maxLength).toBe(500);
    expect(schema.properties.cdmAngle.enum).toEqual([
      'why_chosen',
      'what_alerted',
      'alternatives_rejected',
      'what_would_change',
    ]);
    expect(CDM_CASE_INTERVIEW_SCHEMA_NAME).toBe('cdm_case_interview_v1');
  });

  it('user prompt стабилен для 2 цитат кейса (переменные в конце — cache-friendly)', () => {
    const user = CDM_CASE_INTERVIEW_USER_TEMPLATE({
      personName: 'Сергей',
      roleName: 'Руководитель разработки',
      caseQuotes: [
        {
          quote:
            'Давайте перенесём релиз, я не готов выпускать без нагрузочного теста — лучше неделя задержки, чем падение у клиентов.',
          observedAt: '2026-06-01T10:00:00.000Z',
        },
        {
          quote:
            'Я тогда отказался выкатывать в пятницу — да, сорвали обещание продажам, зато выходные прошли без инцидентов.',
          observedAt: '2026-05-28T14:00:00.000Z',
        },
      ],
    });
    expect(user).toMatchSnapshot('user');
    expect(user).toContain('Сергей');
    expect(user).toContain('не наводящий вопрос');
  });

  it('user prompt без roleName — без скобок должности', () => {
    const user = CDM_CASE_INTERVIEW_USER_TEMPLATE({
      personName: 'Анна',
      roleName: null,
      caseQuotes: [
        { quote: 'Выбрал вариант с подрядчиком', observedAt: '2026-06-02T09:00:00.000Z' },
      ],
    });
    // Первая строка — ровно «Сотрудник: Анна.» (без скобок должности).
    expect(user.split('\n')[0]).toBe('Сотрудник: Анна.');
  });
});
