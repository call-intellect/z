/**
 * Аудит-баг Б1 (класс K7) — машинный гард на tx-safety слияния сущностей.
 *
 * Корень бага: `catch(P2002)` ВНУТРИ интерактивной Prisma `$transaction`
 * абортит всю транзакцию (PostgreSQL 25P02 — после любой ошибки SQL все
 * последующие запросы в той же tx отвергаются). Из-за этого перенос
 * mention'ов / рёбер, упавший на unique-конфликте, ловился catch'ем, но
 * дальнейшие операции в той же tx (обновление intoEntity, fromEntity →
 * merged_into) уже не выполнялись → слияние применялось частично/откатывалось.
 *
 * Фикс (поведение-сохраняющий) заменил `try update / catch(P2002) → delete`
 * на предварительную проверку `findUnique` по целевому unique-ключу и
 * УСЛОВНУЮ ветку delete/update — БЕЗ опоры на исключение.
 *
 * Тест проверяет ПОВЕДЕНИЕ (порядок/ветвление), а не «не упало»:
 *   - конфликт уже есть на стороне target → идём по ветке delete дубля-источника
 *     и НЕ вызываем update конфликтного ключа (раньше он кидал P2002);
 *   - конфликта нет (findUnique → null) → выполняется обычный update.
 *
 * PrismaService мокается; `$transaction(cb)` эмулируется callback'ом, который
 * получает «tx» с тем же контрактом (шарим vi.fn-методы напрямую) — приём
 * как в entity-link.service.spec.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { EntityMergeService } from './entity-merge.service';

const FROM_ID = 'ent-from';
const INTO_ID = 'ent-into';
const TENANT = 'org-1';

function makeMocks() {
  // entity.findUnique вызывается и ВНЕ tx (загрузка from/into), и через tx —
  // в mergeManually tx.entity нужен только для update. Делаем общий мок.
  const entityFindUnique = vi.fn();
  const entityUpdate = vi.fn().mockResolvedValue({});

  const ideaBlockEntityFindMany = vi.fn();
  const ideaBlockEntityFindUnique = vi.fn();
  const ideaBlockEntityUpdate = vi.fn().mockResolvedValue({});
  const ideaBlockEntityDelete = vi.fn().mockResolvedValue({});

  const entityLinkFindMany = vi.fn().mockResolvedValue([]);
  const entityLinkFindUnique = vi.fn();
  const entityLinkUpdate = vi.fn().mockResolvedValue({});
  const entityLinkDelete = vi.fn().mockResolvedValue({});

  const tx = {
    entity: { findUnique: entityFindUnique, update: entityUpdate },
    ideaBlockEntity: {
      findMany: ideaBlockEntityFindMany,
      findUnique: ideaBlockEntityFindUnique,
      update: ideaBlockEntityUpdate,
      delete: ideaBlockEntityDelete,
    },
    entityLink: {
      findMany: entityLinkFindMany,
      findUnique: entityLinkFindUnique,
      update: entityLinkUpdate,
      delete: entityLinkDelete,
    },
  };

  const transaction = vi.fn(
    async (cb: (t: unknown) => Promise<unknown>): Promise<unknown> => cb(tx),
  );

  const prisma = {
    $transaction: transaction,
    // entity.findUnique вне tx (загрузка from/into).
    entity: { findUnique: entityFindUnique },
  } as unknown as PrismaService;

  return {
    prisma,
    transaction,
    entityFindUnique,
    entityUpdate,
    ideaBlockEntityFindMany,
    ideaBlockEntityFindUnique,
    ideaBlockEntityUpdate,
    ideaBlockEntityDelete,
    entityLinkFindMany,
    entityLinkFindUnique,
    entityLinkUpdate,
    entityLinkDelete,
  };
}

function entityRow(id: string) {
  return {
    id,
    tenantId: TENANT,
    type: 'person',
    canonicalName: id,
    aliases: [],
    mergedIntoId: null,
    mentionsCount: 1,
  };
}

describe('EntityMergeService.mergeManually — tx-safety (Б1)', () => {
  let svc: EntityMergeService;
  let m: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    m = makeMocks();
    svc = new EntityMergeService(
      m.prisma,
      // llm и cfg в mergeManually не задействованы.
      null as never,
      undefined,
    );
    // Загрузка from/into ВНЕ tx (Promise.all): from, потом into.
    m.entityFindUnique.mockImplementation(async (arg: { where: { id: string } }) => {
      const id = arg.where.id;
      if (id === FROM_ID) return entityRow(FROM_ID);
      if (id === INTO_ID) return entityRow(INTO_ID);
      return null;
    });
  });

  it('конфликт на target → delete дубля-источника, БЕЗ update конфликтного ключа', async () => {
    // Один mention на блоке blk-1 у from-сущности.
    m.ideaBlockEntityFindMany.mockResolvedValueOnce([
      { blockId: 'blk-1', entityId: FROM_ID },
    ]);
    // На стороне target пара (blk-1, into) уже существует → конфликт.
    m.ideaBlockEntityFindUnique.mockResolvedValueOnce({
      blockId: 'blk-1',
      entityId: INTO_ID,
    });

    await svc.mergeManually({
      tenantId: TENANT,
      fromEntityId: FROM_ID,
      intoEntityId: INTO_ID,
      byUserId: 'user-1',
    });

    // 1. Pre-check на ЦЕЛЕВУЮ пару (blockId, intoEntityId) выполнен.
    expect(m.ideaBlockEntityFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { blockId_entityId: { blockId: 'blk-1', entityId: INTO_ID } },
      }),
    );
    // 2. Пошли по ветке delete дубля-источника (from-запись).
    expect(m.ideaBlockEntityDelete).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { blockId_entityId: { blockId: 'blk-1', entityId: FROM_ID } },
      }),
    );
    // 3. Падающий ранее update конфликтного mention НЕ вызван.
    expect(m.ideaBlockEntityUpdate).not.toHaveBeenCalled();
    // 4. Транзакция дошла до финальных обновлений (slияние применилось целиком,
    //    а не оборвалось на абортнутой tx): intoEntity + fromEntity → merged_into.
    expect(m.entityUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: FROM_ID } }),
    );
    expect(m.entityUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: INTO_ID } }),
    );
  });

  it('нет конфликта (findUnique → null) → обычный update переноса', async () => {
    m.ideaBlockEntityFindMany.mockResolvedValueOnce([
      { blockId: 'blk-2', entityId: FROM_ID },
    ]);
    // Целевой пары нет.
    m.ideaBlockEntityFindUnique.mockResolvedValueOnce(null);

    await svc.mergeManually({
      tenantId: TENANT,
      fromEntityId: FROM_ID,
      intoEntityId: INTO_ID,
      byUserId: 'user-1',
    });

    expect(m.ideaBlockEntityFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { blockId_entityId: { blockId: 'blk-2', entityId: INTO_ID } },
      }),
    );
    // Перенос mention обычным update (from → into).
    expect(m.ideaBlockEntityUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { blockId_entityId: { blockId: 'blk-2', entityId: FROM_ID } },
        data: { entityId: INTO_ID },
      }),
    );
    // Дубль не удаляли.
    expect(m.ideaBlockEntityDelete).not.toHaveBeenCalled();
  });

  it('findUnique целевой пары вызывается ДО update переноса (порядок)', async () => {
    const order: string[] = [];
    m.ideaBlockEntityFindMany.mockResolvedValueOnce([
      { blockId: 'blk-3', entityId: FROM_ID },
    ]);
    m.ideaBlockEntityFindUnique.mockImplementationOnce(async () => {
      order.push('findUnique');
      return null;
    });
    m.ideaBlockEntityUpdate.mockImplementationOnce(async () => {
      order.push('update');
      return {};
    });

    await svc.mergeManually({
      tenantId: TENANT,
      fromEntityId: FROM_ID,
      intoEntityId: INTO_ID,
      byUserId: 'user-1',
    });

    expect(order).toEqual(['findUnique', 'update']);
  });
});
