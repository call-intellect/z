/**
 * Snapshot-тест промта `task-dedupe.prompt.ts`.
 *
 * Фиксирует:
 *   - текст `TASK_DEDUPE_SYSTEM_PROMPT` (включая обёртку `withAsrNote`);
 *   - JSON-схему `TASK_DEDUPE_JSON_SCHEMA`.
 *
 * Обновлять только при осознанном изменении: `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import {
  TASK_DEDUPE_JSON_SCHEMA,
  TASK_DEDUPE_SYSTEM_PROMPT,
} from './task-dedupe.prompt';

describe('task-dedupe — snapshot сборки промта', () => {
  it('system prompt стабилен', () => {
    expect(TASK_DEDUPE_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('JSON Schema стабилен', () => {
    expect(TASK_DEDUPE_JSON_SCHEMA).toMatchSnapshot('schema');
  });
});
