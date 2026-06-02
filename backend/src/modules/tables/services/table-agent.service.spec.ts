import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';

import { TableAgentService } from './table-agent.service';

/**
 * Unit-тесты `TableAgentService` (Smart-tables Text-to-Schema, Фаза 1).
 *
 * LLMRouter.call() мокается через vi.fn() с mockResolvedValueOnce для 3
 * последовательных pass'ов (draft / architect / entity-check). Prisma не
 * используется (getAvailableSyncTypes на Фазе 1 не ходит в БД).
 *
 * Случаи (из ТЗ §8):
 *  (a) успешный happy-path — ≥3 колонки, ровно одна isPrimary, валидные типы.
 *  (b) hallucinated column type — невалидный 'magic' отброшен/заменён на text.
 *  (c) no entity match — entitySync.type вне available -> null.
 *  (d) инвариант: 0 primary в ответе LLM -> ровно одна isPrimary на выходе.
 *  (e) невалидный JSON на pass-1 -> BadRequestException.
 */
describe('TableAgentService', () => {
  const TENANT = 'org-1';

  let call: ReturnType<typeof vi.fn>;
  let llm: LlmRouterService;
  let prisma: PrismaService;
  let svc: TableAgentService;

  /** Хелпер: мок-ответ LlmRouter (только text важен). */
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
      .mockResolvedValueOnce(reply(draft)) // pass1 draft
      .mockResolvedValueOnce(reply(draft)) // pass2 architect
      .mockResolvedValueOnce(reply(draft)); // pass3 entity-check

    const out = await svc.inferSchemaFromText({
      tenantId: TENANT,
      userPrompt: 'таблица клиентов с телефоном и суммой сделки',
    });

    expect(call).toHaveBeenCalledTimes(3);
    expect(out.name).toBe('Клиенты');
    expect(out.entitySync).toEqual({ type: 'org' });
    expect(out.properties.length).toBeGreaterThanOrEqual(3);
    expect(out.properties.filter((p) => p.isPrimary)).toHaveLength(1);
    for (const p of out.properties) {
      expect(['text', 'phone', 'currency']).toContain(p.type);
    }
    // Проверим cache-friendly contract: json_object responseFormat.
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
    // Невалидный 'magic' заменён на 'text'.
    const magicCol = out.properties.find((p) => p.name === 'Магия');
    expect(magicCol?.type).toBe('text');
  });

  it('(c) no entity match: entitySync.type вне available -> null', async () => {
    const draft = {
      name: 'Проекты',
      entitySync: { type: 'project' }, // нет такого типа
      properties: [{ name: 'Название', type: 'text', isPrimary: true }],
    };
    // entity-check вернул всё равно 'project' (галлюцинация) — бэкенд обязан
    // обнулить, т.к. 'project' не входит в availableSyncTypes.
    call
      .mockResolvedValueOnce(reply(draft))
      .mockResolvedValueOnce(reply(draft))
      .mockResolvedValueOnce(reply(draft));

    const out = await svc.inferSchemaFromText({
      tenantId: TENANT,
      userPrompt: 'таблица проектов',
    });

    expect(out.entitySync).toBeNull();
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
    // Первая колонка стала primary.
    expect(out.properties[0]?.isPrimary).toBe(true);
  });

  it('(e) невалидный JSON на pass-1 -> BadRequestException', async () => {
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
    // Только pass-1 был вызван (фейл до architect/entity).
    expect(call).toHaveBeenCalledTimes(1);
  });
});

/**
 * Document-to-Table (Фаза 4) — inferSchemaFromTabular / findSimilarTables /
 * linkRowsToEntities.
 */
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

      // LLM вернул только 2 колонки, а headers — 3 → выравнивание дополнит до 3.
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
      // Имена строго по заголовкам файла.
      expect(out.properties.map((p) => p.name)).toEqual([
        'Название',
        'Сумма',
        'Стадия',
      ]);
      // Третья (отсутствовавшая у LLM) колонка — text.
      expect(out.properties[2]?.type).toBe('text');
      // Ровно одна isPrimary.
      expect(out.properties.filter((p) => p.isPrimary)).toHaveLength(1);
      expect(out.properties[0]?.isPrimary).toBe(true);
    });
  });

  describe('findSimilarTables', () => {
    it('cosine ≥ 0.85 даёт кандидата; embeddings возвращают похожие вектора', async () => {
      const embed = vi.fn();
      const embeddings = { embed } as unknown as {
        embed: (texts: string[]) => Promise<number[][]>;
      };
      // ОДИН batch-вызов: [proposed, existing] — вектора почти одинаковые.
      embed.mockResolvedValueOnce([
        [1, 0, 0], // предложенная (индекс 0)
        [0.99, 0.01, 0], // существующая (индекс 1)
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
      // ОДИН batch-вызов: [proposed, existing] — ортогональны → cosine 0.
      embed.mockResolvedValueOnce([
        [1, 0, 0],
        [0, 1, 0],
      ]);
      const prisma = {
        table: {
          findMany: vi.fn().mockResolvedValue([
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

    it('без embeddings (Optional не внедрён) → []', async () => {
      const svc = new TableAgentService(
        {} as unknown as LlmRouterService,
        {} as unknown as PrismaService,
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
  });

  describe('linkRowsToEntities', () => {
    it('совпадение по canonicalName (без учёта регистра) → entityId; без — null', async () => {
      const findMany = vi.fn().mockResolvedValue([
        { id: 'ent-1', canonicalName: 'ООО Ромашка', aliases: [] },
      ]);
      const prisma = {
        entity: { findMany },
      } as unknown as PrismaService;
      const svc = new TableAgentService(
        {} as unknown as LlmRouterService,
        prisma,
      );

      const out = await svc.linkRowsToEntities({
        tenantId: TENANT,
        entitySync: { type: 'org' },
        // регистр отличается от canonicalName — матч всё равно обязан сработать.
        primaryValues: ['ооо ромашка', 'Неизвестная'],
      });

      expect(out.entityIds).toEqual(['ent-1', null]);
      expect(out.linkedCount).toBe(1);
      // Один batch-запрос на весь набор (не N+1).
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
      const svc = new TableAgentService(
        {} as unknown as LlmRouterService,
        prisma,
      );

      const out = await svc.linkRowsToEntities({
        tenantId: TENANT,
        entitySync: { type: 'org' },
        // совпадение с alias, но в другом регистре.
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
      const svc = new TableAgentService(
        {} as unknown as LlmRouterService,
        prisma,
      );

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
      const findMany = vi.fn().mockResolvedValue([
        { id: 'ent-9', canonicalName: 'Бета', aliases: [] },
      ]);
      const prisma = {
        entity: { findMany },
      } as unknown as PrismaService;
      const svc = new TableAgentService(
        {} as unknown as LlmRouterService,
        prisma,
      );

      const out = await svc.linkRowsToEntities({
        tenantId: TENANT,
        entitySync: { type: 'org' },
        primaryValues: ['Бета', 'бета', 'Бета'],
      });

      expect(out.entityIds).toEqual(['ent-9', 'ent-9', 'ent-9']);
      expect(out.linkedCount).toBe(3);
      // Один batch-запрос на весь импорт (не per-value).
      expect(findMany).toHaveBeenCalledTimes(1);
    });

    it('только пустые primary-значения → БД не дёргаем', async () => {
      const findMany = vi.fn();
      const prisma = {
        entity: { findMany },
      } as unknown as PrismaService;
      const svc = new TableAgentService(
        {} as unknown as LlmRouterService,
        prisma,
      );

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
