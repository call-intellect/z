/**
 * Snapshot-тест сборки промта `skill-trait-detect.prompt.ts`.
 *
 * ⚠ НЕ про качество LLM-вывода. Snapshot фиксирует:
 *   - текст `SKILL_TRAIT_DETECT_SYSTEM_PROMPT` (constant — guard от
 *     случайных правок жёстких правил формулировок; включает
 *     `withEdgeCasePolicy` в конце);
 *   - текст user, который собирает `SKILL_TRAIT_DETECT_USER_TEMPLATE`
 *     для фикстуры с тремя reasoning-цитатами.
 *
 * Обновлять только при осознанном изменении: `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import {
  SKILL_TRAIT_DETECT_SYSTEM_PROMPT,
  SKILL_TRAIT_DETECT_USER_TEMPLATE,
} from './skill-trait-detect.prompt';

describe('skill-trait-detect — snapshot сборки промта', () => {
  it('system prompt стабилен (жёсткие правила формулировок + EDGE_CASE_POLICY + ASR_NOTE)', () => {
    expect(SKILL_TRAIT_DETECT_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  // C1 agent-chain-overhaul (2026-06-07) — ASR-нота применена ко ВСЕМ
  // извлекающим промптам (восстановление искажённых ASR чисел/имён по контексту).
  it('system содержит ASR-ноту (withAsrNote)', () => {
    expect(SKILL_TRAIT_DETECT_SYSTEM_PROMPT).toContain(
      'автоматического распознавания речи',
    );
  });

  it('user prompt стабилен для 3 reasoning-цитат Сергея', () => {
    const user = SKILL_TRAIT_DETECT_USER_TEMPLATE({
      personName: 'Сергей',
      personRole: 'backend',
      quotes: [
        {
          blockId: 'b1',
          quote:
            'Давайте не закладывать срок пока не посмотрим, как ведёт себя нагрузка в стейдже — я обжигался на оценках без замеров.',
          observedAt: '2026-04-05T10:00:00Z',
        },
        {
          blockId: 'b2',
          quote:
            'Я бы не давал сроки на этот эпик, пока не разберём контракт с биллингом — там может вылезти неделя.',
          observedAt: '2026-04-19T14:00:00Z',
        },
        {
          blockId: 'b3',
          quote: 'Можно прикинуть, но я не хочу комиттиться — слишком много допущений.',
          observedAt: '2026-05-18T11:30:00Z',
        },
      ],
    });
    expect(user).toMatchSnapshot('user');
  });
});
