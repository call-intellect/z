import { describe, expect, it } from 'vitest';

import {
  CLONE_RESPOND_SYSTEM_PROMPT_BASE,
  CLONE_RESPOND_USER_TEMPLATE,
  buildCloneRespondSystemPrompt,
} from './clone-respond.prompt';

describe('clone-respond — snapshot сборки промта', () => {
  it('system prompt стабилен (правила 1-8, включая анти-deepfake пункт 6 и частичный пробел пункт 8 — TZ clone-method Э0.1)', () => {
    expect(CLONE_RESPOND_SYSTEM_PROMPT_BASE).toMatchSnapshot('system');
  });

  it('user prompt стабилен для типичного входа (role+bearer+persona, 3 reasoning, 2 decisions, summary)', () => {
    const user = CLONE_RESPOND_USER_TEMPLATE({
      question: 'Как ты подходишь к оценке сроков на новую фичу?',
      roleName: 'Маркетолог',
      bearerName: 'Анна Петрова',
      personaPrompt:
        '— фокус на performance-маркетинге, ROI считаю в когортах\n— тон: спокойный, цифры важнее эмоций',
      subgraph: {
        reasoningBlocks: [
          {
            id: 'block-1',
            text: 'Давайте не закладывать срок пока не посмотрим, как ведёт себя нагрузка в стейдже — я обжигался на оценках без замеров.',
          },
          {
            id: 'block-2',
            text: 'Я бы не давал сроки на этот эпик, пока не разберём контракт с биллингом — там может вылезти неделя.',
          },
          {
            id: 'block-3',
            text: 'Можно прикинуть, но я не хочу комиттиться — слишком много допущений.',
          },
        ],
        knowledgeProfileSummary:
          'оценка сроков (high); работа с биллингом (medium); нагрузочные тесты (medium)',
        decisions: [
          {
            id: 'decision-1',
            statement: 'Перевести систему биллинга на новый API только после нагрузочных тестов',
            rationale: 'риск сюрприза в проде слишком велик без замеров',
          },
          {
            id: 'decision-2',
            statement: 'Перенести релиз фичи на неделю',
            rationale: null,
          },
        ],
      },
    });
    expect(user).toMatchSnapshot('user');
  });

  it('buildCloneRespondSystemPrompt(factual) — стабильный SYSTEM без переменных данных', () => {
    const sys = buildCloneRespondSystemPrompt({ mode: 'factual' });
    expect(sys).not.toContain('Маркетолог');
    expect(sys).not.toContain('Анна Петрова');
    expect(sys).not.toContain('{{roleName}}');
    expect(sys).not.toContain('{{bearerName}}');
    expect(sys).toMatchSnapshot('system-factual');
  });

  it('buildCloneRespondSystemPrompt(judgmental) — стабильный SYSTEM рассуждающего режима', () => {
    const sys = buildCloneRespondSystemPrompt({ mode: 'judgmental' });
    expect(sys).not.toContain('{{roleName}}');
    expect(sys).not.toContain('{{bearerName}}');
    expect(sys).toMatchSnapshot('system-judgmental');
  });

  it('CLONE_RESPOND_USER_TEMPLATE — подставляет дефолты роли/носителя/persona при null/пустых', () => {
    const user = CLONE_RESPOND_USER_TEMPLATE({
      question: 'Тестовый вопрос',
      roleName: null,
      bearerName: '   ',
      personaPrompt: '',
      subgraph: {
        reasoningBlocks: [],
        knowledgeProfileSummary: null,
        decisions: [],
      },
    });
    expect(user).toContain('Должность (роль): сотрудника');
    expect(user).toContain('Текущий носитель должности: текущий носитель этой роли');
    expect(user).toContain('(persona-prompt не задан)');
    expect(user).toMatchSnapshot('user-with-defaults');
  });
});
