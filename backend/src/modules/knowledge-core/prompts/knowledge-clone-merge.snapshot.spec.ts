/**
 * Snapshot-тест сборки промта `knowledge-clone-merge.prompt.ts`.
 *
 * ⚠ НЕ про качество LLM-вывода. Snapshot фиксирует:
 *   - текст `KNOWLEDGE_CLONE_MERGE_SYSTEM_PROMPT` (guard, что весь SYSTEM
 *     обёрнут в `withPeopleHypothesisGuard` — merge тоже оценка человека —
 *     и что `withAsrNote` НЕ добавлена: вход структурный JSON);
 *   - текст user из `KNOWLEDGE_CLONE_MERGE_USER_TEMPLATE`.
 *
 * Обновлять только при осознанном изменении: `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import {
  KNOWLEDGE_CLONE_MERGE_SYSTEM_PROMPT,
  KNOWLEDGE_CLONE_MERGE_USER_TEMPLATE,
} from './knowledge-clone-merge.prompt';

describe('knowledge-clone-merge — snapshot сборки промта', () => {
  it('system prompt стабилен (включает PEOPLE_HYPOTHESIS_NOTE)', () => {
    expect(KNOWLEDGE_CLONE_MERGE_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('system содержит гипотезу-о-человеке (withPeopleHypothesisGuard)', () => {
    expect(KNOWLEDGE_CLONE_MERGE_SYSTEM_PROMPT).toContain('ГИПОТЕЗА');
  });

  it('system НЕ содержит ASR-ноту (вход — структурные JSON-профили)', () => {
    expect(KNOWLEDGE_CLONE_MERGE_SYSTEM_PROMPT).not.toContain(
      'автоматического распознавания речи',
    );
  });

  it('user prompt стабилен', () => {
    const user = KNOWLEDGE_CLONE_MERGE_USER_TEMPLATE({
      personName: 'Сергей Маслов',
      nowIso: '2026-06-16T12:00:00.000Z',
      oldProfileJson:
        '{"categories":[{"name":"Переговоры с поставщиками","confidence":"medium","observationCount":3}],"experienceHighlights":[]}',
      newDraftJson:
        '{"categories":[{"name":"Переговоры с поставщиками","confidence":"medium","observationCount":2}],"experienceHighlights":[]}',
    });
    expect(user).toMatchSnapshot('user');
  });
});
