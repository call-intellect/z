/**
 * Snapshot-тест сборки промта `knowledge-clone-extract.prompt.ts`.
 *
 * ⚠ НЕ про качество LLM-вывода. Snapshot фиксирует:
 *   - текст `KNOWLEDGE_CLONE_EXTRACT_SYSTEM_PROMPT` (guard, что
 *     `withPeopleHypothesisGuard` оборачивает SYSTEM снаружи, а `withAsrNote`
 *     дописывает ASR-ноту внутри);
 *   - текст user из `KNOWLEDGE_CLONE_EXTRACT_USER_TEMPLATE` (signalType
 *     подаётся человеческим ярлыком, не кодом).
 *
 * Обновлять только при осознанном изменении: `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import {
  KNOWLEDGE_CLONE_EXTRACT_SYSTEM_PROMPT,
  KNOWLEDGE_CLONE_EXTRACT_USER_TEMPLATE,
} from './knowledge-clone-extract.prompt';

describe('knowledge-clone-extract — snapshot сборки промта', () => {
  it('system prompt стабилен (включает PEOPLE_HYPOTHESIS_NOTE + ASR_NOTE)', () => {
    expect(KNOWLEDGE_CLONE_EXTRACT_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('system содержит гипотезу-о-человеке (withPeopleHypothesisGuard)', () => {
    expect(KNOWLEDGE_CLONE_EXTRACT_SYSTEM_PROMPT).toContain('ГИПОТЕЗА');
  });

  it('system содержит ASR-ноту (withAsrNote)', () => {
    expect(KNOWLEDGE_CLONE_EXTRACT_SYSTEM_PROMPT).toContain(
      'автоматического распознавания речи',
    );
  });

  it('user prompt стабилен и подаёт человеческий ярлык signalType', () => {
    const user = KNOWLEDGE_CLONE_EXTRACT_USER_TEMPLATE({
      personName: 'Сергей Маслов',
      blocks: [
        {
          blockId: 'blk-001',
          name: 'Устройство конвейера обработки знаний',
          signalType: 'expertise',
          criticalQuestion: 'Как устроен конвейер обработки знаний?',
          trustedAnswer: 'Поблочное извлечение через специалистов графа.',
          tags: ['knowledge-core', 'pipeline'],
          relatedEntityIds: ['ent-1'],
          createdAt: '2026-06-01T10:00:00.000Z',
          quotes: ['Сергей: специалисты разбирают блоки параллельно.'],
        },
        {
          blockId: 'blk-002',
          name: 'Переговоры с поставщиком',
          signalType: 'experience',
          criticalQuestion: 'Как договорились с поставщиком?',
          trustedAnswer: 'Сбили цену на 15% за счёт объёма.',
          tags: ['vendor'],
          relatedEntityIds: [],
          createdAt: '2026-05-20T09:00:00.000Z',
          quotes: [],
        },
      ],
    });
    expect(user).toMatchSnapshot('user');
  });
});
