/**
 * Snapshot-тест промпта `task-dedup-arbiter.prompt.ts` (TZ task-dedup, 2026-06-16).
 *
 * Фиксирует:
 *   - текст `TASK_DEDUP_ARBITER_SYSTEM_PROMPT` (включая обёртку `withAsrNote`);
 *   - JSON-схему `TASK_DEDUP_ARBITER_JSON_SCHEMA`;
 *   - сборку USER-шаблона (человеческие заголовки, NIL-инструкция при пустом
 *     списке).
 *
 * Обновлять только при осознанном изменении: `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import {
  TASK_DEDUP_ARBITER_JSON_SCHEMA,
  TASK_DEDUP_ARBITER_SYSTEM_PROMPT,
  TASK_DEDUP_ARBITER_USER_TEMPLATE,
} from './task-dedup-arbiter.prompt';

describe('task-dedup-arbiter — snapshot сборки промпта', () => {
  it('system prompt стабилен', () => {
    expect(TASK_DEDUP_ARBITER_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('JSON Schema стабильна', () => {
    expect(TASK_DEDUP_ARBITER_JSON_SCHEMA).toMatchSnapshot('schema');
  });

  it('verdict-enum начинается с nil (защита от «лепим к top-1»)', () => {
    const verdict = (
      TASK_DEDUP_ARBITER_JSON_SCHEMA.properties as Record<
        string,
        { enum?: string[] }
      >
    ).verdict;
    expect(verdict?.enum?.[0]).toBe('nil');
  });

  it('USER-шаблон подаёт человеческие заголовки и нумерует похожие', () => {
    const user = TASK_DEDUP_ARBITER_USER_TEMPLATE({
      candidate: { title: 'Подготовить смету по проекту X' },
      similar: [{ title: 'Согласовать договор' }, { title: 'Свести смету по X' }],
    });
    expect(user).toContain('Подготовить смету по проекту X');
    expect(user).toContain('1. «Согласовать договор»');
    expect(user).toContain('2. «Свести смету по X»');
    // ни одного машинного id в подаваемом тексте
    expect(user).not.toMatch(/[a-z0-9]{20,}/);
  });

  it('USER-шаблон при пустом списке требует nil', () => {
    const user = TASK_DEDUP_ARBITER_USER_TEMPLATE({
      candidate: { title: 'Любая задача' },
      similar: [],
    });
    expect(user).toContain('verdict="nil"');
  });
});
