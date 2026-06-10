/**
 * Тесты для интеграции `participants` в tasks-промпты
 * (ТЗ 2026-05-25 hard-participant-identification, Фаза 3).
 *
 * Проверяем:
 *   1. `buildTasksPromptUnified` с непустым `participants` → system содержит
 *      инструкцию про assigneeUserId, user — блок со списком участников.
 *   2. Без participants → ни system, ни user не содержат блок (legacy-режим).
 *   3. `buildTaskItemSchemaUnified` с participants → схема включает
 *      `assigneeUserId`.
 *   4. `buildTasksToolUnified` с participants → JSON Schema содержит
 *      `assigneeUserId: ['string','null']`.
 */
import { describe, expect, it } from 'vitest';

import type { DialogTurn, PromptInput } from './common';
import type { AiParticipantContext } from './participant-context';
import {
  buildTaskItemSchemaUnified,
  buildTasksPromptUnified,
  buildTasksToolUnified,
} from './tasks-unified';

const DIALOG: DialogTurn[] = [
  { speaker: 'Анна', text: 'Сделаю отчёт к пятнице', startSec: 0, endSec: 5 },
];

const INPUT: PromptInput = {
  meeting: { id: 'm-1', title: 'Test', type: 'standup' },
  dialog: DIALOG,
};

const PARTICIPANTS: AiParticipantContext[] = [
  {
    livekitIdentity: 'host:user_anna',
    displayName: 'Анна',
    userId: 'user_anna',
    fullName: 'Анна Иванова',
    role: 'host',
  },
];

describe('buildTasksPromptUnified — participants', () => {
  it('с participants → system содержит правила assigneeUserId', () => {
    const { system, user } = buildTasksPromptUnified(INPUT, {
      useAssigneeRaw: true,
      participants: PARTICIPANTS,
    });
    expect(system).toContain('assigneeUserId');
    expect(system).toContain('Правила идентификации');
    expect(user).toContain('Участники этой встречи');
    expect(user).toContain('user_anna');
  });

  it('без participants → блока в user нет', () => {
    const { system, user } = buildTasksPromptUnified(INPUT, {
      useAssigneeRaw: true,
    });
    expect(user).not.toContain('Участники этой встречи');
    expect(system).not.toContain('assigneeUserId');
  });

  it('participants=[] (пустой массив) → ведёт себя как без participants', () => {
    const { system, user } = buildTasksPromptUnified(INPUT, {
      useAssigneeRaw: true,
      participants: [],
    });
    expect(user).not.toContain('Участники этой встречи');
    expect(system).not.toContain('assigneeUserId');
  });
});

describe('buildTaskItemSchemaUnified — assigneeUserId', () => {
  it('с participants → схема валидирует объект с assigneeUserId=string', () => {
    const schema = buildTaskItemSchemaUnified({
      useAssigneeRaw: true,
      withConfidence: true,
      withSourceQuote: true,
      withFragmentBounds: true,
      participants: PARTICIPANTS,
    });
    const ok = schema.safeParse({
      title: 't',
      assigneeRaw: 'Анна',
      assigneeUserId: 'user_anna',
      sourceStartMs: 0,
      sourceEndMs: 100,
      sourceQuote: 'отчёт',
      confidence: 0.9,
    });
    expect(ok.success).toBe(true);
  });

  it('без participants → assigneeUserId не пропускается (strict)', () => {
    const schema = buildTaskItemSchemaUnified({
      useAssigneeRaw: true,
      withConfidence: true,
      withSourceQuote: true,
      withFragmentBounds: true,
    });
    const res = schema.safeParse({
      title: 't',
      assigneeRaw: 'Анна',
      assigneeUserId: 'user_anna', // лишнее поле в strict
      sourceStartMs: 0,
      sourceEndMs: 100,
      sourceQuote: 'отчёт',
      confidence: 0.9,
    });
    expect(res.success).toBe(false);
  });

  it('с participants, assigneeUserId=null допустим', () => {
    const schema = buildTaskItemSchemaUnified({
      useAssigneeRaw: true,
      withConfidence: true,
      withSourceQuote: true,
      withFragmentBounds: true,
      participants: PARTICIPANTS,
    });
    const ok = schema.safeParse({
      title: 't',
      assigneeRaw: null,
      assigneeUserId: null,
      sourceStartMs: 0,
      sourceEndMs: 100,
      sourceQuote: 'q',
      confidence: 0.5,
    });
    expect(ok.success).toBe(true);
  });
});

describe('buildTasksToolUnified — JSON Schema', () => {
  it('с participants → properties содержит assigneeUserId', () => {
    const tool = buildTasksToolUnified({
      useAssigneeRaw: true,
      withConfidence: true,
      participants: PARTICIPANTS,
    });
    const tasksProp =
      (tool.input_schema as unknown as {
        properties: { tasks: { items: { properties: Record<string, unknown> } } };
      }).properties.tasks.items.properties;
    expect(tasksProp).toHaveProperty('assigneeUserId');
  });

  it('без participants → properties НЕ содержит assigneeUserId', () => {
    const tool = buildTasksToolUnified({
      useAssigneeRaw: true,
      withConfidence: true,
    });
    const tasksProp =
      (tool.input_schema as unknown as {
        properties: { tasks: { items: { properties: Record<string, unknown> } } };
      }).properties.tasks.items.properties;
    expect(tasksProp).not.toHaveProperty('assigneeUserId');
  });
});
