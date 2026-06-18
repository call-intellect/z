import { describe, expect, it } from 'vitest';

import { BASE_SYSTEM_PROMPT } from './chat-v2.service';

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

  it('хвост «О компании» в стабильную часть НЕ входит (подмешивается отдельно)', () => {
    expect(BASE_SYSTEM_PROMPT).not.toContain('## О компании');
  });
});
