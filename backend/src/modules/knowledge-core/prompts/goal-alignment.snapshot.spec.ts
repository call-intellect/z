/**
 * Snapshot-тест промпта `goal-alignment.prompt.ts` (ТЗ 2026-06-16, пачка 6).
 *
 * Фиксирует:
 *   - текст `GOAL_ALIGNMENT_SYSTEM_PROMPT` (standalone, шкала score встроена в тело);
 *   - JSON-схему `GOAL_ALIGNMENT_JSON_SCHEMA`;
 *   - сборку system+user через `buildGoalAlignmentMessages` (тип сигнала в
 *     user-билдере подаётся ярлыком через `signalTypeLabel`, без `[${signalType}]`).
 *
 * Обновлять только при осознанном изменении:
 *   bunx vitest run -u src/modules/knowledge-core/prompts/goal-alignment.snapshot.spec.ts
 */
import { describe, expect, it } from 'vitest';

import {
  buildGoalAlignmentMessages,
  GOAL_ALIGNMENT_JSON_SCHEMA,
  GOAL_ALIGNMENT_SYSTEM_PROMPT,
} from './goal-alignment.prompt';

describe('goal-alignment — snapshot сборки промпта', () => {
  it('system prompt стабилен', () => {
    expect(GOAL_ALIGNMENT_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('JSON Schema стабильна', () => {
    expect(GOAL_ALIGNMENT_JSON_SCHEMA).toMatchSnapshot('schema');
  });

  it('USER подаёт тип сигнала ярлыком', () => {
    const { userMessage } = buildGoalAlignmentMessages({
      goalName: 'Выйти на 100 платящих клиентов к концу квартала',
      goalDescription: 'Платный тариф, привлечение клиентов',
      daysUntilTarget: 30,
      windowDays: 30,
      themes: [
        { id: 'theme_1', name: 'Платные подписки', weight: 0.8, dynamic: 'growing' },
      ],
      blocks: [
        {
          signalType: 'decision',
          criticalQuestion: 'Запускаем ли платный тариф?',
          trustedAnswer: 'Да, запустили платный тариф.',
        },
        {
          signalType: 'risk',
          criticalQuestion: 'Хватит ли бюджета на рекламу?',
          trustedAnswer: 'Бюджет ограничен.',
        },
      ],
    });
    expect(userMessage).toMatchSnapshot('user');
  });
});
