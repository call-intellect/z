import { describe, expect, it } from 'vitest';

import { CHAPTERS_JSON_SCHEMA } from './prompts/chapters';
import { toOpenAiStrictSchema } from './strict-json-schema.util';

type JsonObj = Record<string, unknown>;

/**
 * Рекурсивно проверяет, что КАЖДЫЙ объектный узел схемы strict-совместим:
 * additionalProperties === false и required перечисляет все ключи properties.
 * Возвращает список путей-нарушителей (пусто = всё ок).
 */
function findStrictViolations(schema: unknown, path = '$'): string[] {
  if (Array.isArray(schema)) {
    return schema.flatMap((item, i) =>
      findStrictViolations(item, `${path}[${i}]`),
    );
  }
  if (!schema || typeof schema !== 'object') return [];
  const node = schema as JsonObj;
  const out: string[] = [];

  const typeField = node['type'];
  const isObjectNode =
    typeField === 'object' ||
    (Array.isArray(typeField) && typeField.includes('object')) ||
    'properties' in node;

  if (isObjectNode) {
    if (node['additionalProperties'] !== false) {
      out.push(`${path}: additionalProperties != false`);
    }
    const props = (node['properties'] as JsonObj | undefined) ?? {};
    const required = (node['required'] as string[] | undefined) ?? [];
    for (const key of Object.keys(props)) {
      if (!required.includes(key)) {
        out.push(`${path}: '${key}' missing from required`);
      }
    }
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === '$schema' || key === 'required' || key === 'type') continue;
    out.push(...findStrictViolations(value, `${path}.${key}`));
  }
  return out;
}

describe('toOpenAiStrictSchema', () => {
  it('добавляет отсутствующее в required поле (.nullable().optional())', () => {
    // Воспроизводит лог: chapters_response → Missing 'summary'.
    const raw = {
      type: 'object',
      properties: {
        chapters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              summary: { type: ['string', 'null'] },
            },
            required: ['title'],
          },
        },
      },
      required: ['chapters'],
    };
    const strict = toOpenAiStrictSchema(raw) as JsonObj;
    const item = (
      ((strict['properties'] as JsonObj)['chapters'] as JsonObj)['items'] as JsonObj
    );
    expect(item['additionalProperties']).toBe(false);
    expect(item['required']).toEqual(['title', 'summary']);
  });

  it('закрывает free-form объект (metadata) additionalProperties:false', () => {
    // Воспроизводит лог: IdeaBlocks → metadata 'additionalProperties' required false.
    const raw = {
      type: 'object',
      properties: { metadata: { type: 'object' } },
      required: ['metadata'],
    };
    const strict = toOpenAiStrictSchema(raw) as JsonObj;
    const meta = (strict['properties'] as JsonObj)['metadata'] as JsonObj;
    expect(meta['additionalProperties']).toBe(false);
    expect(meta['required']).toEqual([]);
    expect(meta['properties']).toEqual({});
  });

  it('рекурсивно нормализует $defs / anyOf / items', () => {
    const raw = {
      $defs: {
        Inner: { type: 'object', properties: { a: { type: 'string' } } },
      },
      type: 'object',
      properties: {
        list: { type: 'array', items: { type: 'object', properties: { b: { type: 'number' } } } },
        choice: {
          anyOf: [
            { type: 'object', properties: { c: { type: 'boolean' } } },
            { type: 'null' },
          ],
        },
      },
    };
    const strict = toOpenAiStrictSchema(raw);
    expect(findStrictViolations(strict)).toEqual([]);
  });

  it('не мутирует исходную схему', () => {
    const raw: JsonObj = {
      type: 'object',
      properties: { x: { type: 'string' } },
    };
    const snapshot = JSON.parse(JSON.stringify(raw));
    toOpenAiStrictSchema(raw);
    expect(raw).toEqual(snapshot);
  });

  it('реальная CHAPTERS_JSON_SCHEMA становится полностью strict-совместимой', () => {
    expect(findStrictViolations(CHAPTERS_JSON_SCHEMA).length).toBeGreaterThan(0);
    const strict = toOpenAiStrictSchema(CHAPTERS_JSON_SCHEMA);
    expect(findStrictViolations(strict)).toEqual([]);
  });
});
