import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
