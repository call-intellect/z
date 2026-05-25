/**
 * Unit-тесты для `tasks-unified.ts` — единого builder'а tasks-промта
 * (F5, ТЗ 2026-05-24 §8).
 *
 * Проверяем три ключевых аспекта:
 *   1. Динамическая Zod-схема (`buildTaskItemSchemaUnified`) корректно
 *      собирается под опции (enriched / withConfidence / withSourceQuote /
 *      withFragmentBounds / useAssigneeRaw).
 *   2. Динамический LlmTool (`buildTasksToolUnified`) содержит правильные
 *      properties / required.
 *   3. System-промт (`buildTasksPromptUnified`) включает нужные блоки —
 *      CONFIDENCE_CALIBRATION при withConfidence, цитата при withSourceQuote,
 *      контекст организации в user при orgContext, и т.д.
 *
 * А также — обратная совместимость legacy экспортов:
 *   - `buildTasksPrompt` из `tasks.ts` собирает promt 1:1 с историческим.
 *   - `buildMeetingExtractActionsPrompt` сохраняет все ключевые поля и блоки.
 *   - `buildTasksStructuredPrompt` из `tasks-structured.ts` отдаёт
 *     «JSON only» инструкцию + assigneeRaw + sourceStartMs/EndMs.
 */

import { describe, expect, it } from 'vitest';

import { CONFIDENCE_CALIBRATION, type PromptInput } from './common';
import {
  buildMeetingExtractActionsPrompt,
  buildTasksPrompt,
  MEETING_EXTRACT_ACTIONS_SYSTEM,
  TASKS_SCHEMA,
  TASKS_TOOL,
  TASKS_TOOL_NAME,
} from './tasks';
import { buildTasksStructuredPrompt } from './tasks-structured';
import {
  buildTaskItemSchemaUnified,
  buildTasksPromptUnified,
  buildTasksSchemaUnified,
  buildTasksToolUnified,
  TASKS_UNIFIED_TOOL_NAME,
} from './tasks-unified';

const SAMPLE_INPUT: PromptInput = {
  meeting: {
    id: 'm-1',
    title: 'Sample',
    type: 'team',
    customPrompt: null,
  },
  dialog: [
    { speaker: 'Алиса', text: 'Привет', startSec: 0, endSec: 1 },
    { speaker: 'Боб', text: 'Здравствуй', startSec: 1.5, endSec: 3 },
  ],
};

describe('buildTaskItemSchemaUnified', () => {
  it('legacy (3 поля) — title/assignee/dueDate, остальное падает на strict', () => {
    const schema = buildTaskItemSchemaUnified({});
    const ok = schema.safeParse({
      title: 'Сделать отчёт',
      assignee: 'Иванов',
      dueDate: '2026-05-30',
    });
    expect(ok.success).toBe(true);

    const fail = schema.safeParse({
      title: 'X',
      assignee: null,
      dueDate: null,
      suggestedPriority: 'high', // лишнее в legacy
    });
    expect(fail.success).toBe(false);
  });

  it('enriched=true → допускает suggested*-поля', () => {
    const schema = buildTaskItemSchemaUnified({ enriched: true });
    const ok = schema.safeParse({
      title: 'X',
      assignee: 'Иванов',
      dueDate: null,
      suggestedAssigneeHint: 'Иванов Сергей',
      suggestedDueDate: '2026-05-30',
      suggestedPriority: 'high',
    });
    expect(ok.success).toBe(true);

    const badPriority = schema.safeParse({
      title: 'X',
      assignee: null,
      dueDate: null,
      suggestedPriority: 'omg', // не в enum
    });
    expect(badPriority.success).toBe(false);
  });

  it('withConfidence=true → confidence required, диапазон [0,1]', () => {
    const schema = buildTaskItemSchemaUnified({ withConfidence: true });

    const noConfidence = schema.safeParse({
      title: 'X',
      assignee: null,
      dueDate: null,
    });
    expect(noConfidence.success).toBe(false);

    const negative = schema.safeParse({
      title: 'X',
      assignee: null,
      dueDate: null,
      confidence: -0.1,
    });
    expect(negative.success).toBe(false);

    const over = schema.safeParse({
      title: 'X',
      assignee: null,
      dueDate: null,
      confidence: 1.5,
    });
    expect(over.success).toBe(false);

    const ok = schema.safeParse({
      title: 'X',
      assignee: null,
      dueDate: null,
      confidence: 0.85,
    });
    expect(ok.success).toBe(true);
  });

  it('withSourceQuote=true → sourceQuote required, минимум 1 символ', () => {
    const schema = buildTaskItemSchemaUnified({ withSourceQuote: true });
    const noQuote = schema.safeParse({
      title: 'X',
      assignee: null,
      dueDate: null,
    });
    expect(noQuote.success).toBe(false);

    const emptyQuote = schema.safeParse({
      title: 'X',
      assignee: null,
      dueDate: null,
      sourceQuote: '',
    });
    expect(emptyQuote.success).toBe(false);

    const ok = schema.safeParse({
      title: 'X',
      assignee: null,
      dueDate: null,
      sourceQuote: 'некая цитата',
    });
    expect(ok.success).toBe(true);
  });

  it('useAssigneeRaw + withFragmentBounds — structured-контракт Task', () => {
    const schema = buildTaskItemSchemaUnified({
      useAssigneeRaw: true,
      withFragmentBounds: true,
      withSourceQuote: true,
      withConfidence: true,
    });
    const ok = schema.safeParse({
      title: 'X',
      description: 'детали',
      assigneeRaw: 'Серёжа',
      dueDate: '2026-05-30',
      sourceStartMs: 1000,
      sourceEndMs: 5000,
      sourceQuote: 'цитата',
      confidence: 0.7,
    });
    expect(ok.success).toBe(true);

    // assignee (без Raw) — лишнее в structured-варианте
    const fail = schema.safeParse({
      title: 'X',
      assignee: 'Иванов',
      sourceStartMs: 0,
      sourceEndMs: 1,
      sourceQuote: 'x',
      confidence: 0.5,
    });
    expect(fail.success).toBe(false);
  });
});

describe('buildTasksSchemaUnified (wrapped `{ tasks: [...] }`)', () => {
  it('валидирует объект с массивом', () => {
    const schema = buildTasksSchemaUnified({ enriched: true });
    const ok = schema.safeParse({
      tasks: [
        {
          title: 'X',
          assignee: null,
          dueDate: null,
          suggestedPriority: 'low',
        },
      ],
    });
    expect(ok.success).toBe(true);
  });

  it('падает на голом массиве (нужен объект-обёртка)', () => {
    const schema = buildTasksSchemaUnified({});
    const fail = schema.safeParse([
      { title: 'X', assignee: null, dueDate: null },
    ]);
    expect(fail.success).toBe(false);
  });
});

describe('buildTasksToolUnified', () => {
  it('имя tool — единое значение TASKS_UNIFIED_TOOL_NAME', () => {
    const tool = buildTasksToolUnified({});
    expect(tool.name).toBe(TASKS_UNIFIED_TOOL_NAME);
    expect(tool.name).toBe('extract_tasks');
  });

  it('legacy options → required = [title, assignee, dueDate]', () => {
    const tool = buildTasksToolUnified({});
    const tasksArr = tool.input_schema.properties['tasks'] as {
      items: { required: string[]; properties: Record<string, unknown> };
    };
    expect(tasksArr.items.required).toEqual(
      expect.arrayContaining(['title', 'assignee', 'dueDate']),
    );
    expect(Object.keys(tasksArr.items.properties)).toEqual(
      expect.arrayContaining(['title', 'assignee', 'dueDate']),
    );
    // suggested* не должно быть в legacy-варианте
    expect(tasksArr.items.properties['suggestedAssigneeHint']).toBeUndefined();
  });

  it('enriched + withConfidence + withSourceQuote → confidence/sourceQuote required + suggested* properties', () => {
    const tool = buildTasksToolUnified({
      enriched: true,
      withConfidence: true,
      withSourceQuote: true,
    });
    const tasksArr = tool.input_schema.properties['tasks'] as {
      items: { required: string[]; properties: Record<string, unknown> };
    };
    expect(tasksArr.items.required).toEqual(
      expect.arrayContaining([
        'title',
        'assignee',
        'dueDate',
        'confidence',
        'sourceQuote',
      ]),
    );
    expect(tasksArr.items.properties['suggestedAssigneeHint']).toBeDefined();
    expect(tasksArr.items.properties['suggestedDueDate']).toBeDefined();
    expect(tasksArr.items.properties['suggestedPriority']).toBeDefined();
  });

  it('useAssigneeRaw → properties содержит assigneeRaw, не assignee', () => {
    const tool = buildTasksToolUnified({
      useAssigneeRaw: true,
      withFragmentBounds: true,
      withSourceQuote: true,
      withConfidence: true,
    });
    const tasksArr = tool.input_schema.properties['tasks'] as {
      items: { required: string[]; properties: Record<string, unknown> };
    };
    expect(tasksArr.items.properties['assigneeRaw']).toBeDefined();
    expect(tasksArr.items.properties['assignee']).toBeUndefined();
    expect(tasksArr.items.properties['sourceStartMs']).toBeDefined();
    expect(tasksArr.items.properties['sourceEndMs']).toBeDefined();
    expect(tasksArr.items.required).toEqual(
      expect.arrayContaining(['sourceStartMs', 'sourceEndMs']),
    );
  });
});

describe('buildTasksPromptUnified — system', () => {
  it('withConfidence=true → в system есть CONFIDENCE_CALIBRATION', () => {
    const out = buildTasksPromptUnified(SAMPLE_INPUT, { withConfidence: true });
    expect(out.system).toContain(CONFIDENCE_CALIBRATION);
    expect(out.system).toContain('Шкала confidence');
  });

  it('withConfidence=false → НЕТ CONFIDENCE_CALIBRATION', () => {
    const out = buildTasksPromptUnified(SAMPLE_INPUT, { withConfidence: false });
    expect(out.system).not.toContain('Шкала confidence');
  });

  it('withSourceQuote=true → блок про обязательную цитату', () => {
    const out = buildTasksPromptUnified(SAMPLE_INPUT, {
      withSourceQuote: true,
    });
    expect(out.system).toMatch(/sourceQuote/);
    expect(out.system).toMatch(/ОБЯЗАТЕЛЬНО/);
  });

  it('enriched=true → блок про suggested*-поля', () => {
    const out = buildTasksPromptUnified(SAMPLE_INPUT, { enriched: true });
    expect(out.system).toMatch(/suggestedAssigneeHint/);
    expect(out.system).toMatch(/suggestedDueDate/);
    expect(out.system).toMatch(/suggestedPriority/);
  });

  it('default (tool-use, без responseAsBareArray) → есть инструкция про tool', () => {
    const out = buildTasksPromptUnified(SAMPLE_INPUT, {});
    expect(out.system).toContain('Вызови инструмент');
    expect(out.system).toContain(TASKS_UNIFIED_TOOL_NAME);
    expect(out.system).not.toContain('Reply with valid JSON only');
  });

  it('responseAsBareArray=true → инструкция «JSON-массив, без markdown», БЕЗ tool', () => {
    const out = buildTasksPromptUnified(SAMPLE_INPUT, {
      responseAsBareArray: true,
    });
    expect(out.system).toContain('ТОЛЬКО валидный JSON-массив');
    expect(out.system).not.toContain('Вызови инструмент');
  });

  it('roomChat → withRoomChatNote применён', () => {
    const out = buildTasksPromptUnified(
      {
        ...SAMPLE_INPUT,
        roomChat: [
          {
            sentAt: '2026-05-24T10:00:00Z',
            authorName: 'Алиса',
            content: 'https://example.com/doc',
          },
        ],
      },
      {},
    );
    expect(out.system).toContain('Чат встречи');
  });
});

describe('buildTasksPromptUnified — user', () => {
  it('включает meta встречи + диалог', () => {
    const out = buildTasksPromptUnified(SAMPLE_INPUT, {});
    expect(out.user).toContain('Тип встречи: team');
    expect(out.user).toContain('Заголовок: Sample');
    expect(out.user).toContain('Диалог:');
    expect(out.user).toContain('Алиса');
    expect(out.user).toContain('Боб');
  });

  it('orgContext.projects → список проектов в user', () => {
    const out = buildTasksPromptUnified(SAMPLE_INPUT, {
      orgContext: {
        projects: [{ identifier: 'DEV', name: 'Команда разработки' }],
      },
    });
    expect(out.user).toContain('Проекты организации:');
    expect(out.user).toContain('DEV: Команда разработки');
  });

  it('orgContext.people → список сотрудников', () => {
    const out = buildTasksPromptUnified(SAMPLE_INPUT, {
      orgContext: {
        people: [{ name: 'Иванов Сергей', role: 'разработчик' }],
      },
    });
    expect(out.user).toContain('Сотрудники организации:');
    expect(out.user).toContain('Иванов Сергей (разработчик)');
  });

  it('meetingDateIso → строка «Дата встречи»', () => {
    const out = buildTasksPromptUnified(SAMPLE_INPUT, {
      meetingDateIso: '2026-05-24',
    });
    expect(out.user).toContain('Дата встречи: 2026-05-24');
  });

  it('withFragmentBounds=true → подпись «timestamps в формате»', () => {
    const out = buildTasksPromptUnified(SAMPLE_INPUT, {
      withFragmentBounds: true,
    });
    expect(out.user).toContain('Диалог (timestamps в формате [mm:ss-mm:ss]):');
  });

  it('responseAsBareArray=true → инструкция «Reply with valid JSON only» в user', () => {
    const out = buildTasksPromptUnified(SAMPLE_INPUT, {
      responseAsBareArray: true,
    });
    expect(out.user).toContain('Reply with valid JSON only');
  });
});

// ─────────────────── Legacy backward-compat ──────────────────────────────

describe('Legacy buildTasksPrompt (tasks.ts) — обратная совместимость', () => {
  it('возвращает system + user, system содержит инструкцию tool-use', () => {
    const out = buildTasksPrompt(SAMPLE_INPUT);
    expect(out.system).toContain('Вызови инструмент');
    expect(out.system).toContain(TASKS_TOOL_NAME);
    expect(out.user).toContain('Тип встречи: team');
    expect(out.user).toContain('Заголовок: Sample');
  });

  it('TASKS_TOOL_NAME = extract_tasks (единое имя из tasks-unified)', () => {
    expect(TASKS_TOOL_NAME).toBe('extract_tasks');
  });

  it('TASKS_TOOL.input_schema содержит обогащённые optional-поля', () => {
    const tasksArr = TASKS_TOOL.input_schema.properties['tasks'] as {
      items: { properties: Record<string, unknown>; required: string[] };
    };
    expect(tasksArr.items.properties['suggestedAssigneeHint']).toBeDefined();
    expect(tasksArr.items.properties['suggestedDueDate']).toBeDefined();
    expect(tasksArr.items.properties['suggestedPriority']).toBeDefined();
    expect(tasksArr.items.properties['confidence']).toBeDefined();
    expect(tasksArr.items.properties['sourceQuote']).toBeDefined();
    // Required — только legacy-набор (старые модели не сломаются)
    expect(tasksArr.items.required).toEqual(
      expect.arrayContaining(['title', 'assignee', 'dueDate']),
    );
    expect(tasksArr.items.required).not.toContain('confidence');
    expect(tasksArr.items.required).not.toContain('sourceQuote');
  });

  it('TASKS_SCHEMA принимает legacy-ответ (только 3 поля)', () => {
    const ok = TASKS_SCHEMA.safeParse({
      tasks: [
        { title: 'X', assignee: null, dueDate: null },
      ],
    });
    expect(ok.success).toBe(true);
  });

  it('TASKS_SCHEMA принимает enriched-ответ (8 полей)', () => {
    const ok = TASKS_SCHEMA.safeParse({
      tasks: [
        {
          title: 'X',
          assignee: 'Иванов',
          dueDate: '2026-05-30',
          suggestedAssigneeHint: 'Иванов Сергей',
          suggestedDueDate: '2026-05-30',
          suggestedPriority: 'high',
          confidence: 0.9,
          sourceQuote: 'некая цитата',
        },
      ],
    });
    expect(ok.success).toBe(true);
  });
});

describe('Legacy buildMeetingExtractActionsPrompt (tasks.ts) — обратная совместимость', () => {
  it('system содержит обогащённые блоки + калибровку confidence', () => {
    const out = buildMeetingExtractActionsPrompt(SAMPLE_INPUT, {});
    expect(out.system).toContain('suggestedAssigneeHint');
    expect(out.system).toContain('suggestedPriority');
    expect(out.system).toContain('sourceQuote');
    expect(out.system).toContain('Шкала confidence');
  });

  it('orgContext + meetingDateIso корректно прокидываются в user', () => {
    const out = buildMeetingExtractActionsPrompt(SAMPLE_INPUT, {
      meetingDateIso: '2026-05-24',
      projects: [{ identifier: 'DEV', name: 'Команда разработки' }],
      goals: [{ name: 'Запуск v2' }],
      people: [{ name: 'Иванов Сергей' }],
    });
    expect(out.user).toContain('Дата встречи: 2026-05-24');
    expect(out.user).toContain('Проекты организации:');
    expect(out.user).toContain('DEV: Команда разработки');
    expect(out.user).toContain('Активные цели:');
    expect(out.user).toContain('Запуск v2');
    expect(out.user).toContain('Сотрудники организации:');
    expect(out.user).toContain('Иванов Сергей');
  });

  it('MEETING_EXTRACT_ACTIONS_SYSTEM-константа — синхронна с builder', () => {
    expect(MEETING_EXTRACT_ACTIONS_SYSTEM).toContain('suggestedAssigneeHint');
    expect(MEETING_EXTRACT_ACTIONS_SYSTEM).toContain('Шкала confidence');
  });
});

describe('Legacy buildTasksStructuredPrompt (tasks-structured.ts) — обратная совместимость', () => {
  it('system содержит structured-поля + tool-use инструкцию (T7-F6: убрали bare-array)', () => {
    const out = buildTasksStructuredPrompt({
      meeting: { id: 'm-1', type: 'team', title: 'Sample' },
      dialog: SAMPLE_INPUT.dialog,
    });
    // structured-контракт Task: assigneeRaw + description вместо assignee
    expect(out.system).toContain('assigneeRaw');
    expect(out.system).toContain('description');
    // привязка к фрагменту
    expect(out.system).toContain('sourceStartMs');
    expect(out.system).toContain('sourceEndMs');
    // обязательная цитата + confidence
    expect(out.system).toContain('sourceQuote');
    expect(out.system).toContain('confidence');
    expect(out.system).toContain('Шкала confidence');
    // T7-F6: теперь builder использует unified tool-use, а не bare-array.
    // Раньше тут была "ТОЛЬКО валидный JSON-массив" (responseAsBareArray:true).
    // Теперь caller (TaskExtractionService) пробрасывает responseFormat:json_schema
    // и парсит { tasks: [...] } обёртку.
    expect(out.system).toContain(TASKS_UNIFIED_TOOL_NAME);
    expect(out.system).not.toContain('ТОЛЬКО валидный JSON-массив');
  });

  it('user не содержит legacy «Reply with valid JSON only» (T7-F6)', () => {
    const out = buildTasksStructuredPrompt({
      meeting: { id: 'm-1', type: 'team', title: 'Sample' },
      dialog: SAMPLE_INPUT.dialog,
    });
    // T7-F6: эта инструкция была частью responseAsBareArray:true пути,
    // который мы убрали (структурный strict JSON Schema надёжнее).
    expect(out.user).not.toContain('Reply with valid JSON only');
    // user всё ещё содержит meta встречи и диалог.
    expect(out.user).toContain('Тип встречи: team');
    expect(out.user).toContain('Заголовок: Sample');
  });
});
