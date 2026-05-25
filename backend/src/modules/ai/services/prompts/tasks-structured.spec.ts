/**
 * Тесты для `buildTasksStructuredJsonSchema` — динамической сборки JSON Schema
 * для strict-провайдеров (OpenAI/DeepSeek `response_format: json_schema strict`).
 *
 * ТЗ 2026-05-25 hard-participant-identification (закрытие vNext-gap).
 *
 * Проверяем:
 *   1. Без participants (undefined / null / []) — `assigneeUserId` не присутствует
 *      в JSON Schema (legacy-поведение, обратная совместимость).
 *   2. С непустым participants — `assigneeUserId` присутствует как
 *      nullable string.
 *   3. Базовая структура schema (object с properties.tasks: array of object)
 *      сохраняется во всех вариантах.
 *   4. Snapshot — без participants и с одним участником.
 */
import { describe, expect, it } from 'vitest';

import type { AiParticipantContext } from './participant-context';
import { buildTasksStructuredJsonSchema } from './tasks-structured';

const PARTICIPANTS: AiParticipantContext[] = [
  {
    livekitIdentity: 'host:user_anna',
    displayName: 'Анна',
    userId: 'user_anna',
    fullName: 'Анна Иванова',
    role: 'host',
  },
];

/**
 * Достаёт properties одного task'а из верхнеуровневой schema
 * `{ properties: { tasks: { items: { properties: ... } } } }`.
 */
function extractTaskItemProperties(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  const root = schema as {
    properties?: {
      tasks?: { items?: { properties?: Record<string, unknown> } };
    };
  };
  const props = root.properties?.tasks?.items?.properties;
  if (!props) {
    throw new Error('Invalid schema shape: tasks.items.properties not found');
  }
  return props;
}

describe('buildTasksStructuredJsonSchema', () => {
  it('без participants (undefined) — assigneeUserId отсутствует', () => {
    const schema = buildTasksStructuredJsonSchema();
    const props = extractTaskItemProperties(schema);
    expect(props).not.toHaveProperty('assigneeUserId');
    // sanity: базовые поля structured-пути на месте
    expect(props).toHaveProperty('title');
    expect(props).toHaveProperty('assigneeRaw');
    expect(props).toHaveProperty('sourceStartMs');
    expect(props).toHaveProperty('sourceQuote');
    expect(props).toHaveProperty('confidence');
  });

  it('с participants=null — assigneeUserId отсутствует', () => {
    const schema = buildTasksStructuredJsonSchema(null);
    const props = extractTaskItemProperties(schema);
    expect(props).not.toHaveProperty('assigneeUserId');
  });

  it('с participants=[] (пустой массив) — assigneeUserId отсутствует', () => {
    const schema = buildTasksStructuredJsonSchema([]);
    const props = extractTaskItemProperties(schema);
    expect(props).not.toHaveProperty('assigneeUserId');
  });

  it('с непустым participants — assigneeUserId присутствует', () => {
    const schema = buildTasksStructuredJsonSchema(PARTICIPANTS);
    const props = extractTaskItemProperties(schema);
    expect(props).toHaveProperty('assigneeUserId');
  });

  it('assigneeUserId — nullable string (type включает "null")', () => {
    const schema = buildTasksStructuredJsonSchema(PARTICIPANTS);
    const props = extractTaskItemProperties(schema);
    const field = props['assigneeUserId'] as {
      type?: unknown;
      anyOf?: Array<{ type?: string }>;
    };
    // zod v4 может сериализовать nullable как `type: ["string", "null"]`
    // или как `anyOf: [{type:'string'}, {type:'null'}]`. Поддерживаем обе формы.
    const isNullableString =
      (Array.isArray(field.type) && field.type.includes('null') && field.type.includes('string')) ||
      (Array.isArray(field.anyOf) &&
        field.anyOf.some((s) => s.type === 'string') &&
        field.anyOf.some((s) => s.type === 'null'));
    expect(isNullableString).toBe(true);
  });

  it('верхнеуровневая структура { tasks: array } сохраняется', () => {
    const schema = buildTasksStructuredJsonSchema(PARTICIPANTS) as {
      type?: string;
      properties?: { tasks?: { type?: string } };
      required?: string[];
    };
    expect(schema.type).toBe('object');
    expect(schema.properties?.tasks?.type).toBe('array');
    expect(schema.required).toContain('tasks');
  });

  it('snapshot — без participants', () => {
    const schema = buildTasksStructuredJsonSchema();
    expect(schema).toMatchSnapshot('json-schema-no-participants');
  });

  it('snapshot — с одним участником', () => {
    const schema = buildTasksStructuredJsonSchema(PARTICIPANTS);
    expect(schema).toMatchSnapshot('json-schema-with-participants');
  });
});
