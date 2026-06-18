import { describe, expect, it } from 'vitest';

import {
  EXECUTABLE_PERSONA_COMPILE_V2_PROMPT_NAME,
  EXECUTABLE_PERSONA_COMPILE_V2_SYSTEM_PROMPT,
  EXECUTABLE_PERSONA_COMPILE_V2_USER_TEMPLATE,
} from './executable-persona-compile.prompt';

const trait = (over: {
  category: string;
  statement: string;
  confidence?: string;
  observationCount?: number;
}) => ({
  confidence: 'high',
  observationCount: 5,
  ...over,
});

describe('executable-persona-compile v2 — snapshot сборки промта', () => {
  it('system prompt стабилен', () => {
    expect(EXECUTABLE_PERSONA_COMPILE_V2_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('system перечисляет все 5 секций выхода', () => {
    expect(EXECUTABLE_PERSONA_COMPILE_V2_SYSTEM_PROMPT).toContain('Мой подход к решениям');
    expect(EXECUTABLE_PERSONA_COMPILE_V2_SYSTEM_PROMPT).toContain(
      'Что я ставлю выше при конфликте приоритетов',
    );
    expect(EXECUTABLE_PERSONA_COMPILE_V2_SYSTEM_PROMPT).toContain(
      'Мои принципы в типовых ситуациях',
    );
    expect(EXECUTABLE_PERSONA_COMPILE_V2_SYSTEM_PROMPT).toContain(
      'Типовые ситуации → как я действую',
    );
    expect(EXECUTABLE_PERSONA_COMPILE_V2_SYSTEM_PROMPT).toContain('Как я веду процесс');
  });

  it('system фиксирует инвариант «ПРАВИЛО ПРОЦЕССА, не ярлык» (Personality Illusion)', () => {
    expect(EXECUTABLE_PERSONA_COMPILE_V2_SYSTEM_PROMPT).toContain('ПРАВИЛО ПРОЦЕССА');
    expect(EXECUTABLE_PERSONA_COMPILE_V2_SYSTEM_PROMPT).toContain('ярлык');
    expect(EXECUTABLE_PERSONA_COMPILE_V2_SYSTEM_PROMPT).toContain('Personality Illusion');
  });

  it('system требует гипотезный тон', () => {
    expect(EXECUTABLE_PERSONA_COMPILE_V2_SYSTEM_PROMPT).toContain('обычно');
    expect(EXECUTABLE_PERSONA_COMPILE_V2_SYSTEM_PROMPT).toContain('как правило');
    expect(EXECUTABLE_PERSONA_COMPILE_V2_SYSTEM_PROMPT).toContain('в большинстве случаев');
  });

  it('system задаёт длину 300–1200 слов и запрет выдумывать', () => {
    expect(EXECUTABLE_PERSONA_COMPILE_V2_SYSTEM_PROMPT).toContain('300');
    expect(EXECUTABLE_PERSONA_COMPILE_V2_SYSTEM_PROMPT).toContain('1200');
    expect(EXECUTABLE_PERSONA_COMPILE_V2_SYSTEM_PROMPT).toContain('НЕ выдумывать');
  });

  it('user prompt стабилен для полного входа (все 5 блоков)', () => {
    const user = EXECUTABLE_PERSONA_COMPILE_V2_USER_TEMPLATE({
      personName: 'Анна Иванова',
      personRole: 'Руководитель проектов',
      traits: [
        trait({
          category: 'решения',
          statement: 'обычно сначала собирает данные по 2–3 источникам, потом решает',
        }),
        trait({
          category: 'оценки сроков',
          statement: 'не даёт оценку срока без декомпозиции на задачи',
          confidence: 'medium',
          observationCount: 3,
        }),
      ],
      values: [
        trait({
          category: 'качество vs скорость',
          statement: 'при дедлайне выбирает качество, а не скорость',
        }),
      ],
      motivations: [
        trait({
          category: 'автономия',
          statement: 'берётся охотнее за задачи, где сам выбирает способ',
          confidence: 'medium',
          observationCount: 2,
        }),
      ],
      principles: [
        {
          situation: 'срыв срока',
          statement: 'сначала эскалирует владельцу с 2 вариантами, потом режет scope',
          observationCount: 4,
          confidence: 'high',
        },
      ],
      practiceSkills: [
        {
          trigger: 'клиент возражает на цену enterprise',
          steps: [
            { order: 1, action: 'выслушать возражение до конца' },
            { order: 2, action: 'назвать ценность, не скидку' },
          ],
          redFlags: ['не давить', 'не обещать кастом без оценки'],
        },
      ],
      processMarkers: [
        trait({
          category: 'варианты',
          statement: 'обычно перед рекомендацией перечисляет варианты и критерий выбора',
        }),
      ],
    });
    expect(user).toMatchSnapshot('user-full');
  });

  it('пустые блоки НЕ рендерятся вовсе (ни заголовка, ни «(нет)») — деградация к v1', () => {
    const user = EXECUTABLE_PERSONA_COMPILE_V2_USER_TEMPLATE({
      personName: 'Анна Иванова',
      personRole: null,
      traits: [
        trait({
          category: 'решения',
          statement: 'обычно сначала собирает данные, потом решает',
        }),
      ],
      values: [],
      motivations: [],
      principles: [],
      practiceSkills: [],
      processMarkers: [],
    });
    expect(user).toContain('Черты подхода (1)');
    expect(user).not.toContain('Ценности');
    expect(user).not.toContain('Мотивация');
    expect(user).not.toContain('Принципы роли');
    expect(user).not.toContain('Процедуры');
    expect(user).not.toContain('Маркеры процесса');
    expect(user).not.toContain('(нет)');
    expect(user).toMatchSnapshot('user-traits-only');
  });

  it('у процедур без redFlags строка «Чего не делать» опускается', () => {
    const user = EXECUTABLE_PERSONA_COMPILE_V2_USER_TEMPLATE({
      personName: 'Анна',
      personRole: null,
      traits: [],
      values: [],
      motivations: [],
      principles: [],
      practiceSkills: [
        {
          trigger: 'возражение на цену',
          steps: [{ order: 1, action: 'назвать ценность' }],
          redFlags: [],
        },
      ],
      processMarkers: [],
    });
    expect(user).toContain('Когда: возражение на цену');
    expect(user).not.toContain('Чего не делать');
  });

  it('имя промпта — v2', () => {
    expect(EXECUTABLE_PERSONA_COMPILE_V2_PROMPT_NAME).toBe('executable_persona_compile_v2');
  });
});
