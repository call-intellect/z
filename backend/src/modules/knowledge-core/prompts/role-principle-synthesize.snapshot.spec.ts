import { describe, expect, it } from 'vitest';

import {
  ROLE_PRINCIPLE_SYNTHESIZE_JSON_SCHEMA,
  ROLE_PRINCIPLE_SYNTHESIZE_SYSTEM_PROMPT,
  ROLE_PRINCIPLE_SYNTHESIZE_USER_TEMPLATE,
} from './role-principle-synthesize.prompt';

describe('role-principle-synthesize — snapshot сборки промта', () => {
  it('system prompt стабилен (инвариант процесса + запрет диагностики + few-shots + EDGE_CASE_POLICY + ASR_NOTE)', () => {
    expect(ROLE_PRINCIPLE_SYNTHESIZE_SYSTEM_PROMPT).toMatchSnapshot('system');
  });

  it('system содержит запрет негативно-диагностической лексики (греп «избегает»)', () => {
    expect(ROLE_PRINCIPLE_SYNTHESIZE_SYSTEM_PROMPT).toContain('избегает');
    expect(ROLE_PRINCIPLE_SYNTHESIZE_SYSTEM_PROMPT).toContain('ЖЁСТКИЙ ЗАПРЕТ');
  });

  it('system фиксирует инвариант «правило ПРОЦЕССА, не черта человека»', () => {
    expect(ROLE_PRINCIPLE_SYNTHESIZE_SYSTEM_PROMPT).toContain('ПРОЦЕСС');
    expect(ROLE_PRINCIPLE_SYNTHESIZE_SYSTEM_PROMPT).toContain('не черта');
  });

  it('schema требует sourceBlockIds minItems 2 (минимум 2 наблюдения на принцип)', () => {
    const schema = ROLE_PRINCIPLE_SYNTHESIZE_JSON_SCHEMA as {
      properties: {
        principles: {
          items: {
            required: string[];
            properties: {
              sourceBlockIds: { minItems: number; maxItems: number };
            };
          };
        };
      };
    };
    const items = schema.properties.principles.items;
    expect(items.properties.sourceBlockIds.minItems).toBe(2);
    expect(items.properties.sourceBlockIds.maxItems).toBe(50);
    expect(items.required).toEqual([
      'situation',
      'statement',
      'sourceBlockIds',
      'observationCount',
      'confidence',
    ]);
  });

  it('user prompt стабилен для 2 групп цитат (переменные в конце — cache-friendly)', () => {
    const user = ROLE_PRINCIPLE_SYNTHESIZE_USER_TEMPLATE({
      roleName: 'Руководитель проектов',
      groups: [
        {
          label: 'Когда поплыл срок по биллингу, я сразу пошёл к владельцу',
          quotes: [
            {
              blockId: 'b1',
              quote:
                'Когда поплыл срок по биллингу, я сразу пошёл к владельцу с двумя вариантами: режем scope или двигаем релиз.',
              observedAt: '2026-04-05T10:00:00.000Z',
            },
            {
              blockId: 'b2',
              quote:
                'Я не люблю молча пересогласовывать даты — сначала эскалация с вариантами, потом уже резать функционал.',
              observedAt: '2026-04-19T14:00:00.000Z',
            },
          ],
        },
        {
          label: 'Выбирая подрядчика, я всегда прошу пилот',
          quotes: [
            {
              blockId: 'b3',
              quote:
                'Выбирая подрядчика, я всегда прошу пилот на маленьком куске — обещания в презентациях ничего не стоят.',
              observedAt: '2026-05-02T09:30:00.000Z',
            },
            {
              blockId: 'b4',
              quote: 'Сначала пилот на 5% трафика, потом раскатка — так мы ловим сюрпризы дёшево.',
              observedAt: '2026-05-18T11:00:00.000Z',
            },
          ],
        },
      ],
    });
    expect(user).toMatchSnapshot('user');
  });
});
