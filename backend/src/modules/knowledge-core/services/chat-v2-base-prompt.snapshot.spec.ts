import { describe, expect, it } from 'vitest';

import { BASE_SYSTEM_PROMPT, resolveBaseSystemPrompt } from './chat-v2.service';

describe('chat-v2 единый промпт-ответчик — snapshot', () => {
  it('BASE_SYSTEM_PROMPT стабилен', () => {
    expect(BASE_SYSTEM_PROMPT).toMatchSnapshot('base-system-prompt');
  });

  it('содержит ключевые секции методологии', () => {
    expect(BASE_SYSTEM_PROMPT).toContain('## Роль');
    expect(BASE_SYSTEM_PROMPT).toContain('## Границы — только дела компании');
    expect(BASE_SYSTEM_PROMPT).toContain('## Примеры (плохо → хорошо)');
    expect(BASE_SYSTEM_PROMPT).toContain('## Самопроверка перед ответом');
    expect(BASE_SYSTEM_PROMPT).toContain('## Запреты');
    expect(BASE_SYSTEM_PROMPT).toContain('Цепочка рассуждения к факту');
    expect(BASE_SYSTEM_PROMPT).toContain('Противоречащий факт');
    expect(BASE_SYSTEM_PROMPT).toContain('Данные из таблиц');
  });

  it('Ф10 (R12) — описывает структуру памяти и режимы ответа по классу', () => {
    expect(BASE_SYSTEM_PROMPT).toContain('## Как устроена память компании');
    expect(BASE_SYSTEM_PROMPT).toContain('Источники-объекты');
    expect(BASE_SYSTEM_PROMPT).toContain('Карта тем');
    expect(BASE_SYSTEM_PROMPT).toContain('Итоги периодов');
    expect(BASE_SYSTEM_PROMPT).toContain('## Режим ответа по форме результата');
    expect(BASE_SYSTEM_PROMPT).toContain('[ИСТОЧНИК:');
  });

  it('хвост «О компании» в стабильную часть НЕ входит (подмешивается отдельно)', () => {
    expect(BASE_SYSTEM_PROMPT).not.toContain('## О компании');
  });

  it('recall-to-99 Ф1 — правило 4 ассертивно (дефолт), правило 7 структурно, самопроверка усилена', () => {
    expect(BASE_SYSTEM_PROMPT).toContain('Отвечай при основании');
    expect(BASE_SYSTEM_PROMPT).not.toContain('Честно про пустоту');
    expect(BASE_SYSTEM_PROMPT).toContain('Структура и полнота');
    expect(BASE_SYSTEM_PROMPT).toContain('включи ВСЕ существенные факты');
    expect(BASE_SYSTEM_PROMPT).toContain(
      'Ответ структурен и включает все существенные факты из контекста по вопросу?',
    );
  });

  it('recall-to-99 Ф1 — resolveBaseSystemPrompt(true) ассертивен, (false) откатывает правило 4', () => {
    const assertive = resolveBaseSystemPrompt(true);
    expect(assertive).toContain('Отвечай при основании');
    expect(assertive).not.toContain('Честно про пустоту');

    const legacy = resolveBaseSystemPrompt(false);
    expect(legacy).toContain('Честно про пустоту');
    expect(legacy).not.toContain('Отвечай при основании');
  });

  it('recall-to-99 Ф6 — правило 4 запрещает выдуманный статус/провенанс, но ассертивность жива', () => {
    const assertive = resolveBaseSystemPrompt(true);
    expect(assertive).toContain('не додумывай итог');
    expect(assertive).toContain('Не придумывай провенанс');
    expect(assertive).toContain('уверенно назови НАЙДЕННОЕ');
    expect(assertive).toContain(
      'Не приписал ли я статус «готово/завершено/решено/не блокирует/доволен»',
    );

    const legacy = resolveBaseSystemPrompt(false);
    expect(legacy).toContain('Честно про пустоту');
    expect(legacy).not.toContain('не додумывай итог');
  });
});
