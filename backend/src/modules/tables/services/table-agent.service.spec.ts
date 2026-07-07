import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';

import { TableAgentService } from './table-agent.service';

describe('TableAgentService', () => {
  const TENANT = 'org-1';

  let call: ReturnType<typeof vi.fn>;
  let llm: LlmRouterService;
  let prisma: PrismaService;
  let svc: TableAgentService;

  function reply(obj: unknown) {
    return {
      text: JSON.stringify(obj),
      modelUsed: 'deepseek:deepseek-v4-pro',
      inputTokens: 1,
      outputTokens: 1,
      cachedTokens: 0,
      durationMs: 1,
    };
  }

  beforeEach(() => {
    call = vi.fn();
    llm = { call } as unknown as LlmRouterService;
    prisma = {} as unknown as PrismaService;
    svc = new TableAgentService(llm, prisma);
  });

  it('(a) happy-path: ≥3 колонки, ровно одна isPrimary, валидные типы', async () => {
    const draft = {
      name: 'Клиенты',
      description: 'Учёт клиентов',
      icon: '💼',
      entitySync: { type: 'org' },
      properties: [
        { name: 'Название', type: 'text', isPrimary: true },
        { name: 'Телефон', type: 'phone', isPrimary: false },
        { name: 'Сумма', type: 'currency', isPrimary: false },
      ],
    };
    call
      .mockResolvedValueOnce(reply(draft))
      .mockResolvedValueOnce(reply(draft))
      .mockResolvedValueOnce(reply(draft));

    const out = await svc.inferSchemaFromText({
      tenantId: TENANT,
      userPrompt: 'таблица клиентов с телефоном и суммой сделки',
    });

    expect(call).toHaveBeenCalledTimes(2);
    expect(out.name).toBe('Клиенты');
    expect(out.entitySync).toEqual({ type: 'org' });
    expect(out.properties.length).toBeGreaterThanOrEqual(3);
    expect(out.properties.filter((p) => p.isPrimary)).toHaveLength(1);
    for (const p of out.properties) {
      expect(['text', 'phone', 'currency']).toContain(p.type);
    }
    const firstCallArg = call.mock.calls[0]?.[0];
    expect(firstCallArg).toMatchObject({
      taskType: 'table-infer-schema',
      responseFormat: { type: 'json_object' },
      tenantId: TENANT,
    });
  });

  it('(b) hallucinated column type: невалидный type заменён на text', async () => {
    const schema = {
      name: 'Тест',
      entitySync: null,
      properties: [
        { name: 'Имя', type: 'text', isPrimary: true },
        { name: 'Магия', type: 'magic', isPrimary: false },
      ],
    };
    call
      .mockResolvedValueOnce(reply(schema))
      .mockResolvedValueOnce(reply(schema))
      .mockResolvedValueOnce(reply(schema));

    const out = await svc.inferSchemaFromText({
      tenantId: TENANT,
      userPrompt: 'тестовая таблица с магией',
    });

    const types = out.properties.map((p) => p.type);
    expect(types).not.toContain('magic');
    const magicCol = out.properties.find((p) => p.name === 'Магия');
    expect(magicCol?.type).toBe('text');
  });

  it('(c) no entity match: entitySync.type вне available -> null', async () => {
    const draft = {
      name: 'Проекты',
      entitySync: { type: 'project' },
      properties: [{ name: 'Название', type: 'text', isPrimary: true }],
    };
    call
      .mockResolvedValueOnce(reply(draft))
      .mockResolvedValueOnce(reply(draft))
      .mockResolvedValueOnce(reply(draft));

    const out = await svc.inferSchemaFromText({
      tenantId: TENANT,
      userPrompt: 'таблица проектов',
    });

    expect(out.entitySync).toBeNull();
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls.some((c) => c[0]?.taskType === 'table-entity-check')).toBe(false);
  });

  it('(d) инвариант: 0 primary в ответе -> ровно одна isPrimary', async () => {
    const schema = {
      name: 'Бюджет',
      entitySync: null,
      properties: [
        { name: 'Статья', type: 'text', isPrimary: false },
        { name: 'Сумма', type: 'currency', isPrimary: false },
      ],
    };
    call
      .mockResolvedValueOnce(reply(schema))
      .mockResolvedValueOnce(reply(schema))
      .mockResolvedValueOnce(reply(schema));

    const out = await svc.inferSchemaFromText({
      tenantId: TENANT,
      userPrompt: 'таблица бюджета',
    });

    const primaries = out.properties.filter((p) => p.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(out.properties[0]?.isPrimary).toBe(true);
  });

  it('(e) невалидный JSON на pass-1 -> BadRequestException (R1: 3 ретрая при cfg=undefined)', async () => {
    call.mockResolvedValueOnce({
      text: 'это не json вовсе',
      modelUsed: 'deepseek:deepseek-v4-pro',
      inputTokens: 1,
      outputTokens: 1,
      cachedTokens: 0,
      durationMs: 1,
    });

    await expect(
      svc.inferSchemaFromText({
        tenantId: TENANT,
        userPrompt: 'что-то',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(call).toHaveBeenCalledTimes(3);
  });

  it('(R1) happy-retry: DRAFT падает один раз, со второй попытки — успех', async () => {
    const draft = {
      name: 'Клиенты',
      entitySync: null,
      properties: [{ name: 'Название', type: 'text', isPrimary: true }],
    };
    call
      .mockResolvedValueOnce({
        text: 'не json',
        modelUsed: 'deepseek:deepseek-v4-pro',
        inputTokens: 1,
        outputTokens: 1,
        cachedTokens: 0,
        durationMs: 1,
      })
      .mockResolvedValueOnce(reply(draft))
      .mockResolvedValueOnce(reply(draft))
      .mockResolvedValueOnce(reply(draft));

    const out = await svc.inferSchemaFromText({
      tenantId: TENANT,
      userPrompt: 'таблица клиентов',
    });

    expect(out.name).toBe('Клиенты');
    const draftCalls = call.mock.calls.filter((c) => c[0]?.taskType === 'table-infer-schema');
    expect(draftCalls).toHaveLength(2);
    expect(call).toHaveBeenCalledTimes(3);
  });
});

describe('TableAgentService — Document-to-Table (Фаза 4)', () => {
  const TENANT = 'org-1';

  function reply(obj: unknown) {
    return {
      text: JSON.stringify(obj),
      modelUsed: 'deepseek:deepseek-v4-pro',
      inputTokens: 1,
      outputTokens: 1,
      cachedTokens: 0,
      durationMs: 1,
    };
  }

  describe('inferSchemaFromTabular', () => {
    it('число колонок = числу headers (маппинг сохранён по порядку)', async () => {
      const call = vi.fn();
      const llm = { call } as unknown as LlmRouterService;
      const prisma = {} as unknown as PrismaService;
      const svc = new TableAgentService(llm, prisma);

      const draft = {
        name: 'Клиенты',
        entitySync: { type: 'org' },
        properties: [
          { name: 'Название', type: 'text', isPrimary: true },
          { name: 'Сумма', type: 'currency', isPrimary: false },
        ],
      };
      call
        .mockResolvedValueOnce(reply(draft))
        .mockResolvedValueOnce(reply(draft))
        .mockResolvedValueOnce(reply(draft));

      const out = await svc.inferSchemaFromTabular({
        tenantId: TENANT,
        headers: ['Название', 'Сумма', 'Стадия'],
        sampleRows: [['ООО Ромашка', '100000', 'Переговоры']],
      });

      expect(out.properties).toHaveLength(3);
      expect(out.properties.map((p) => p.name)).toEqual(['Название', 'Сумма', 'Стадия']);
      expect(out.properties[2]?.type).toBe('text');
      expect(out.properties.filter((p) => p.isPrimary)).toHaveLength(1);
      expect(out.properties[0]?.isPrimary).toBe(true);
    });

    it('(R4) misfire date: LLM навязал Результат:date, данные — текст → text', async () => {
      const call = vi.fn();
      const llm = { call } as unknown as LlmRouterService;
      const prisma = {} as unknown as PrismaService;
      const svc = new TableAgentService(llm, prisma);

      const schema = {
        name: 'Встречи',
        entitySync: null,
        properties: [
          { name: 'Формулировка', type: 'text', isPrimary: true },
          { name: 'Результат', type: 'date', isPrimary: false },
        ],
      };
      call
        .mockResolvedValueOnce(reply(schema))
        .mockResolvedValueOnce(reply(schema))
        .mockResolvedValueOnce(reply(schema));

      const out = await svc.inferSchemaFromTabular({
        tenantId: TENANT,
        headers: ['Формулировка', 'Результат'],
        sampleRows: [
          ['Вопрос 1', 'Конверсия выросла на 18 процентов'],
          ['Вопрос 2', 'Договорились о встрече'],
          ['Вопрос 3', 'Клиент отказался'],
        ],
      });

      const result = out.properties.find((p) => p.name === 'Результат');
      expect(result?.type).toBe('text');
    });

    it('(R4) не ломает валидное: даты остаются date, суммы — currency', async () => {
      const call = vi.fn();
      const llm = { call } as unknown as LlmRouterService;
      const prisma = {} as unknown as PrismaService;
      const svc = new TableAgentService(llm, prisma);

      const schema = {
        name: 'Сделки',
        entitySync: null,
        properties: [
          { name: 'Дата', type: 'date', isPrimary: true },
          { name: 'Сумма', type: 'currency', isPrimary: false },
        ],
      };
      call
        .mockResolvedValueOnce(reply(schema))
        .mockResolvedValueOnce(reply(schema))
        .mockResolvedValueOnce(reply(schema));

      const out = await svc.inferSchemaFromTabular({
        tenantId: TENANT,
        headers: ['Дата', 'Сумма'],
        sampleRows: [
          ['2026-05-28', '450000'],
          ['2026-06-01', '1200000'],
          ['2026-06-05', '300000'],
        ],
      });

      expect(out.properties.find((p) => p.name === 'Дата')?.type).toBe('date');
      expect(out.properties.find((p) => p.name === 'Сумма')?.type).toBe('currency');
    });

    it('(R4) longtext upgrade: длинные значения text (≥50% >80 симв) → longtext', async () => {
      const call = vi.fn();
      const llm = { call } as unknown as LlmRouterService;
      const prisma = {} as unknown as PrismaService;
      const svc = new TableAgentService(llm, prisma);

      const schema = {
        name: 'Заметки',
        entitySync: null,
        properties: [{ name: 'Текст', type: 'text', isPrimary: true }],
      };
      call
        .mockResolvedValueOnce(reply(schema))
        .mockResolvedValueOnce(reply(schema))
        .mockResolvedValueOnce(reply(schema));

      const long = 'А'.repeat(120);
      const out = await svc.inferSchemaFromTabular({
        tenantId: TENANT,
        headers: ['Текст'],
        sampleRows: [[long], [long], ['короткое']],
      });

      expect(out.properties[0]?.type).toBe('longtext');
    });

    it('(R2) дополняет options select-колонки значением «Отказ» из данных', async () => {
      const call = vi.fn();
      const llm = { call } as unknown as LlmRouterService;
      const prisma = {} as unknown as PrismaService;
      const svc = new TableAgentService(llm, prisma);

      const schema = {
        name: 'Воронка',
        entitySync: null,
        properties: [
          { name: 'Клиент', type: 'text', isPrimary: true },
          {
            name: 'Стадия',
            type: 'selectSingle',
            isPrimary: false,
            config: {
              options: [{ id: 'opt-1', name: 'Лид', color: 'info' }],
            },
          },
        ],
      };
      call
        .mockResolvedValueOnce(reply(schema))
        .mockResolvedValueOnce(reply(schema))
        .mockResolvedValueOnce(reply(schema));

      const out = await svc.inferSchemaFromTabular({
        tenantId: TENANT,
        headers: ['Клиент', 'Стадия'],
        sampleRows: [
          ['A', 'Лид'],
          ['B', 'Переговоры'],
          ['C', 'Отказ'],
        ],
      });

      const stage = out.properties.find((p) => p.name === 'Стадия');
      const opts = (stage?.config?.options ?? []) as Array<{
        id: string;
        name: string;
        color: string;
      }>;
      const refusal = opts.find((o) => o.name === 'Отказ');
      expect(refusal).toBeDefined();
      expect(refusal?.id).toMatch(/^opt-\d+$/);
      expect(['info', 'warning', 'success', 'danger', 'neutral']).toContain(refusal?.color);
      const lead = opts.find((o) => o.name === 'Лид');
      expect(lead).toEqual({ id: 'opt-1', name: 'Лид', color: 'info' });
    });

    it('(R2) потолок 30: 31 distinct → options не дополняются', async () => {
      const call = vi.fn();
      const llm = { call } as unknown as LlmRouterService;
      const prisma = {} as unknown as PrismaService;
      const svc = new TableAgentService(llm, prisma);

      const schema = {
        name: 'Справочник',
        entitySync: null,
        properties: [
          {
            name: 'Код',
            type: 'selectSingle',
            isPrimary: true,
            config: { options: [{ id: 'opt-1', name: 'X', color: 'info' }] },
          },
        ],
      };
      call
        .mockResolvedValueOnce(reply(schema))
        .mockResolvedValueOnce(reply(schema))
        .mockResolvedValueOnce(reply(schema));

      const rows = Array.from({ length: 31 }, (_v, i) => [`код-${i}`]);
      const out = await svc.inferSchemaFromTabular({
        tenantId: TENANT,
        headers: ['Код'],
        sampleRows: rows,
      });

      const opts = (out.properties[0]?.config?.options ?? []) as unknown[];
      expect(opts).toHaveLength(1);
    });

    it('(R2) case-insensitive: «Лид» и «лид » → одна опция, не дубль', async () => {
      const call = vi.fn();
      const llm = { call } as unknown as LlmRouterService;
      const prisma = {} as unknown as PrismaService;
      const svc = new TableAgentService(llm, prisma);

      const schema = {
        name: 'Воронка',
        entitySync: null,
        properties: [
          {
            name: 'Стадия',
            type: 'selectSingle',
            isPrimary: true,
            config: { options: [] },
          },
        ],
      };
      call
        .mockResolvedValueOnce(reply(schema))
        .mockResolvedValueOnce(reply(schema))
        .mockResolvedValueOnce(reply(schema));

      const out = await svc.inferSchemaFromTabular({
        tenantId: TENANT,
        headers: ['Стадия'],
        sampleRows: [['Лид'], ['лид ']],
      });

      const opts = (out.properties[0]?.config?.options ?? []) as Array<{
        name: string;
      }>;
      expect(opts).toHaveLength(1);
    });
  });

  describe('findSimilarTables', () => {
    it('cosine ≥ 0.85 даёт кандидата; embeddings возвращают похожие вектора', async () => {
      const embed = vi.fn();
      const embeddings = { embed } as unknown as {
        embed: (texts: string[]) => Promise<number[][]>;
      };
      embed.mockResolvedValueOnce([
        [1, 0, 0],
        [0.99, 0.01, 0],
      ]);
      const prisma = {
        table: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'tbl-1',
              name: 'Клиенты',
              properties: [{ name: 'Название' }, { name: 'Сумма' }],
            },
          ]),
        },
      } as unknown as PrismaService;
      const cfg = {
        getDynamic: vi.fn().mockResolvedValue(0.85),
      } as unknown as TypedConfigService;

      const svc = new TableAgentService(
        {} as unknown as LlmRouterService,
        prisma,
        embeddings as never,
        cfg,
      );

      const out = await svc.findSimilarTables({
        tenantId: TENANT,
        schema: {
          name: 'Клиенты',
          description: null,
          icon: null,
          entitySync: { type: 'org' },
          properties: [
            { name: 'Название', type: 'text', isPrimary: true },
            { name: 'Сумма', type: 'currency', isPrimary: false },
          ],
        },
      });

      expect(out).toHaveLength(1);
      expect(out[0]?.tableId).toBe('tbl-1');
      expect(out[0]?.cosine).toBeGreaterThanOrEqual(0.85);
    });

    it('разные вектора → []', async () => {
      const embed = vi.fn();
      const embeddings = { embed } as unknown as {
        embed: (texts: string[]) => Promise<number[][]>;
      };
      embed.mockResolvedValueOnce([
        [1, 0, 0],
        [0, 1, 0],
      ]);
      const prisma = {
        table: {
          findMany: vi
            .fn()
            .mockResolvedValue([
              { id: 'tbl-2', name: 'Риски', properties: [{ name: 'Описание' }] },
            ]),
        },
      } as unknown as PrismaService;
      const cfg = {
        getDynamic: vi.fn().mockResolvedValue(0.85),
      } as unknown as TypedConfigService;

      const svc = new TableAgentService(
        {} as unknown as LlmRouterService,
        prisma,
        embeddings as never,
        cfg,
      );

      const out = await svc.findSimilarTables({
        tenantId: TENANT,
        schema: {
          name: 'Клиенты',
          description: null,
          icon: null,
          entitySync: null,
          properties: [{ name: 'Название', type: 'text', isPrimary: true }],
        },
      });

      expect(out).toEqual([]);
    });

    it('(R3) без embeddings: Jaccard всё равно работает (идентичные колонки → кандидат)', async () => {
      const prisma = {
        table: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'tbl-9',
              name: 'Клиенты (копия)',
              properties: [{ name: 'Название' }],
            },
          ]),
        },
      } as unknown as PrismaService;
      const svc = new TableAgentService({} as unknown as LlmRouterService, prisma);
      const out = await svc.findSimilarTables({
        tenantId: TENANT,
        schema: {
          name: 'Клиенты',
          description: null,
          icon: null,
          entitySync: null,
          properties: [{ name: 'Название', type: 'text', isPrimary: true }],
        },
      });
      expect(out).toHaveLength(1);
      expect(out[0]?.tableId).toBe('tbl-9');
      expect(out[0]?.cosine).toBeCloseTo(1, 5);
    });

    it('(R3) без embeddings + нет таблиц → []', async () => {
      const prisma = {
        table: { findMany: vi.fn().mockResolvedValue([]) },
      } as unknown as PrismaService;
      const svc = new TableAgentService({} as unknown as LlmRouterService, prisma);
      const out = await svc.findSimilarTables({
        tenantId: TENANT,
        schema: {
          name: 'Клиенты',
          description: null,
          icon: null,
          entitySync: null,
          properties: [{ name: 'Название', type: 'text', isPrimary: true }],
        },
      });
      expect(out).toEqual([]);
    });

    it('(R3) Jaccard-сигнал: идентичные колонки + низкий cosine → кандидат', async () => {
      const embed = vi.fn();
      const embeddings = { embed } as unknown as {
        embed: (texts: string[]) => Promise<number[][]>;
      };
      embed.mockResolvedValueOnce([
        [1, 0, 0],
        [0, 1, 0],
      ]);
      const prisma = {
        table: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'tbl-ideas',
              name: 'Идеи и бэклог',
              properties: [
                { name: 'Формулировка' },
                { name: 'Источник' },
                { name: 'Приоритет' },
                { name: 'Ответственный' },
                { name: 'Статус' },
              ],
            },
          ]),
        },
      } as unknown as PrismaService;
      const cfg = {
        getDynamic: vi.fn((_key: string, _scope: unknown, def: number) => Promise.resolve(def)),
      } as unknown as TypedConfigService;

      const svc = new TableAgentService(
        {} as unknown as LlmRouterService,
        prisma,
        embeddings as never,
        cfg,
      );

      const out = await svc.findSimilarTables({
        tenantId: TENANT,
        schema: {
          name: 'Запросы и пожелания',
          description: null,
          icon: null,
          entitySync: null,
          properties: [
            { name: 'Формулировка', type: 'text', isPrimary: true },
            { name: 'Источник', type: 'text', isPrimary: false },
            { name: 'Приоритет', type: 'text', isPrimary: false },
            { name: 'Ответственный', type: 'text', isPrimary: false },
            { name: 'Статус', type: 'status', isPrimary: false },
          ],
        },
      });

      expect(out).toHaveLength(1);
      expect(out[0]?.name).toBe('Идеи и бэклог');
      expect(out[0]?.cosine).toBeCloseTo(1, 5);
    });

    it('(R3) истинно-негатив: непохожие колонки + низкий cosine → []', async () => {
      const embed = vi.fn();
      const embeddings = { embed } as unknown as {
        embed: (texts: string[]) => Promise<number[][]>;
      };
      embed.mockResolvedValueOnce([
        [1, 0, 0],
        [0, 1, 0],
      ]);
      const prisma = {
        table: {
          findMany: vi
            .fn()
            .mockResolvedValue([
              { id: 'tbl-x', name: 'Риски', properties: [{ name: 'Описание' }] },
            ]),
        },
      } as unknown as PrismaService;
      const cfg = {
        getDynamic: vi.fn((_key: string, _scope: unknown, def: number) => Promise.resolve(def)),
      } as unknown as TypedConfigService;

      const svc = new TableAgentService(
        {} as unknown as LlmRouterService,
        prisma,
        embeddings as never,
        cfg,
      );

      const out = await svc.findSimilarTables({
        tenantId: TENANT,
        schema: {
          name: 'Клиенты',
          description: null,
          icon: null,
          entitySync: null,
          properties: [{ name: 'Название', type: 'text', isPrimary: true }],
        },
      });

      expect(out).toEqual([]);
    });

    it('(R3) высокий cosine (≥0.85) при низком Jaccard → кандидат остаётся', async () => {
      const embed = vi.fn();
      const embeddings = { embed } as unknown as {
        embed: (texts: string[]) => Promise<number[][]>;
      };
      embed.mockResolvedValueOnce([
        [1, 0, 0],
        [0.99, 0.01, 0],
      ]);
      const prisma = {
        table: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 'tbl-sem',
              name: 'Похожая по смыслу',
              properties: [{ name: 'Описание' }, { name: 'Комментарий' }],
            },
          ]),
        },
      } as unknown as PrismaService;
      const cfg = {
        getDynamic: vi.fn((_key: string, _scope: unknown, def: number) => Promise.resolve(def)),
      } as unknown as TypedConfigService;

      const svc = new TableAgentService(
        {} as unknown as LlmRouterService,
        prisma,
        embeddings as never,
        cfg,
      );

      const out = await svc.findSimilarTables({
        tenantId: TENANT,
        schema: {
          name: 'Клиенты',
          description: null,
          icon: null,
          entitySync: null,
          properties: [
            { name: 'Название', type: 'text', isPrimary: true },
            { name: 'Сумма', type: 'currency', isPrimary: false },
          ],
        },
      });

      expect(out).toHaveLength(1);
      expect(out[0]?.tableId).toBe('tbl-sem');
      expect(out[0]?.cosine).toBeGreaterThanOrEqual(0.85);
    });
  });

  describe('linkRowsToEntities', () => {
    it('совпадение по canonicalName (без учёта регистра) → entityId; без — null', async () => {
      const findMany = vi
        .fn()
        .mockResolvedValue([{ id: 'ent-1', canonicalName: 'ООО Ромашка', aliases: [] }]);
      const prisma = {
        entity: { findMany },
      } as unknown as PrismaService;
      const svc = new TableAgentService({} as unknown as LlmRouterService, prisma);

      const out = await svc.linkRowsToEntities({
        tenantId: TENANT,
        entitySync: { type: 'org' },
        primaryValues: ['ооо ромашка', 'Неизвестная'],
      });

      expect(out.entityIds).toEqual(['ent-1', null]);
      expect(out.linkedCount).toBe(1);
      expect(findMany).toHaveBeenCalledTimes(1);
    });

    it('совпадение по alias без учёта регистра → entityId', async () => {
      const findMany = vi.fn().mockResolvedValue([
        {
          id: 'ent-7',
          canonicalName: 'Бета',
          aliases: ['Beta LLC', 'ООО Бета'],
        },
      ]);
      const prisma = {
        entity: { findMany },
      } as unknown as PrismaService;
      const svc = new TableAgentService({} as unknown as LlmRouterService, prisma);

      const out = await svc.linkRowsToEntities({
        tenantId: TENANT,
        entitySync: { type: 'org' },
        primaryValues: ['beta llc'],
      });

      expect(out.entityIds).toEqual(['ent-7']);
      expect(out.linkedCount).toBe(1);
    });

    it('entitySync=null → ничего не линкуем, БД не дёргаем', async () => {
      const findMany = vi.fn();
      const prisma = {
        entity: { findMany },
      } as unknown as PrismaService;
      const svc = new TableAgentService({} as unknown as LlmRouterService, prisma);

      const out = await svc.linkRowsToEntities({
        tenantId: TENANT,
        entitySync: null,
        primaryValues: ['ООО Ромашка'],
      });

      expect(out.entityIds).toEqual([null]);
      expect(out.linkedCount).toBe(0);
      expect(findMany).not.toHaveBeenCalled();
    });

    it('одинаковые имена → один batch-запрос, все привязаны', async () => {
      const findMany = vi
        .fn()
        .mockResolvedValue([{ id: 'ent-9', canonicalName: 'Бета', aliases: [] }]);
      const prisma = {
        entity: { findMany },
      } as unknown as PrismaService;
      const svc = new TableAgentService({} as unknown as LlmRouterService, prisma);

      const out = await svc.linkRowsToEntities({
        tenantId: TENANT,
        entitySync: { type: 'org' },
        primaryValues: ['Бета', 'бета', 'Бета'],
      });

      expect(out.entityIds).toEqual(['ent-9', 'ent-9', 'ent-9']);
      expect(out.linkedCount).toBe(3);
      expect(findMany).toHaveBeenCalledTimes(1);
    });

    it('только пустые primary-значения → БД не дёргаем', async () => {
      const findMany = vi.fn();
      const prisma = {
        entity: { findMany },
      } as unknown as PrismaService;
      const svc = new TableAgentService({} as unknown as LlmRouterService, prisma);

      const out = await svc.linkRowsToEntities({
        tenantId: TENANT,
        entitySync: { type: 'org' },
        primaryValues: ['', '   ', null],
      });

      expect(out.entityIds).toEqual([null, null, null]);
      expect(out.linkedCount).toBe(0);
      expect(findMany).not.toHaveBeenCalled();
    });
  });
});
