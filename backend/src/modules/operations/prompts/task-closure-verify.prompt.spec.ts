/**
 * Snapshot-тест промпта `task-closure-verify.prompt.ts` (TZ task-dedup,
 * 2026-06-16, Ф2).
 *
 * Фиксирует:
 *   - текст `TASK_CLOSURE_VERIFY_SYSTEM_PROMPT` (включая обёртку `withAsrNote`);
 *   - JSON-схему `TASK_CLOSURE_VERIFY_JSON_SCHEMA`;
 *   - сборку USER-шаблона (человеческий ярлык типа сигнала, не машинный код).
 *
 * Обновлять только при осознанном изменении: `bunx vitest --update`.
 */
import { describe, expect, it } from 'vitest';

import {
  TASK_CLOSURE_VERIFY_JSON_SCHEMA,
  TASK_CLOSURE_VERIFY_SYSTEM_PROMPT,
  TASK_CLOSURE_VERIFY_USER_TEMPLATE,
} from './task-closure-verify.prompt';

describe('task-closure-verify — snapshot сборки промпта', () => {
  it('system prompt стабилен', () => {
    expect(TASK_CLOSURE_VERIFY_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('JSON Schema стабильна', () => {
    expect(TASK_CLOSURE_VERIFY_JSON_SCHEMA).toMatchSnapshot('schema');
  });

  it('SYSTEM явно держит границу доверия к цитате (анти-инъекция)', () => {
    expect(TASK_CLOSURE_VERIFY_SYSTEM_PROMPT).toContain(
      'Граница доверия к цитате',
    );
    // Few-shot с попыткой подмены присутствует.
    expect(TASK_CLOSURE_VERIFY_SYSTEM_PROMPT).toContain('ПОПЫТКА ПОДМЕНЫ');
  });

  it('USER-шаблон подаёт человеческий ярлык сигнала, а не машинный код', () => {
    const user = TASK_CLOSURE_VERIFY_USER_TEMPLATE({
      task: { title: 'Отправить КП клиенту Бета' },
      signalLabel: 'задача выполнена',
      quote: 'КП собрал и отправил утром',
    });
    expect(user).toContain('Отправить КП клиенту Бета');
    expect(user).toContain('Тип сигнала из разговора: задача выполнена.');
    expect(user).toContain('КП собрал и отправил утром');
    // ни одного машинного кода сигнала в подаваемом тексте
    expect(user).not.toContain('task_completed');
    // ни одного машинного id (cuid-подобного) в подаваемом тексте
    expect(user).not.toMatch(/[a-z0-9]{20,}/);
  });
});
