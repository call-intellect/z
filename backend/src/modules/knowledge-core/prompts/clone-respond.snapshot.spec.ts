/**
 * Snapshot-тест сборки промта `clone-respond.prompt.ts`.
 *
 * Фаза 1 «clone reliability hardening» — DoD 1.5.
 *
 * ⚠ НЕ про качество LLM-вывода. Snapshot фиксирует:
 *   - текст `CLONE_RESPOND_SYSTEM_PROMPT_BASE` (constant — guard от
 *     случайных правок жёстких правил формулировок: пункт 6 анти-deepfake
 *     должен быть стабилен, иначе плывёт ожидаемая фраза-отказ);
 *   - сборку `CLONE_RESPOND_USER_TEMPLATE` для типичного входа
 *     (3 reasoning-блока, summary профиля знаний, 2 решения).
 *
 * Обновлять только при осознанном изменении: `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import {
  CLONE_RESPOND_SYSTEM_PROMPT_BASE,
  CLONE_RESPOND_USER_TEMPLATE,
} from './clone-respond.prompt';

describe('clone-respond — snapshot сборки промта', () => {
  it('system prompt стабилен (правила 1-7, включая анти-deepfake пункт 6)', () => {
    expect(CLONE_RESPOND_SYSTEM_PROMPT_BASE).toMatchSnapshot('system');
  });

  it('user prompt стабилен для типичного входа (3 reasoning, 2 decisions, summary)', () => {
    const user = CLONE_RESPOND_USER_TEMPLATE({
      question: 'Как ты подходишь к оценке сроков на новую фичу?',
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
});
