/**
 * Backfill graph-driven строк системных Smart-таблиц (Smart-tables Фаза 2).
 *
 * Для каждой существующей Org проходит по системным таблицам с
 * `entitySync.autoCreate=true` и наполняет их строками по «живым» Entity
 * соответствующих классов (resolveEntityTypes). Новые Org получают синк
 * автоматически по событиям графа; этот скрипт — для уже-существующих Org и
 * уже-накопленного графа.
 *
 * Запуск:
 *   docker compose exec backend bun run scripts/backfill-table-entity-sync.ts
 *
 * Идемпотентен:
 *   - пропускает Entity, у которых в таблице уже есть строка;
 *   - конфликт-резолвер: ручную строку (entityId=null) с совпадающим
 *     primary/email сливает с Entity, а не дублирует.
 *
 * См. safe-seed-rules: не делаем mass updateMany; создаём только недостающее.
 */

import { Prisma } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';
import {
  parseEntitySync,
  resolveEntityTypes,
} from '../src/modules/tables/services/entity-sync.util';

const prisma = createPrismaClient();

interface PropLite {
  id: string;
  config: Prisma.JsonValue;
}

function entityAttributeOf(p: PropLite): string | null {
  const cfg = (p.config as Record<string, unknown> | null) ?? {};
  if (cfg['source'] !== 'entity') return null;
  const attr = cfg['entityAttribute'];
  return typeof attr === 'string' && attr.length > 0 ? attr : null;
}

function entityValue(
  entity: {
    canonicalName: string;
    email: string | null;
    phone: string | null;
    domain: string | null;
    inn: string | null;
    ogrn: string | null;
    metadata: Prisma.JsonValue | null;
  },
  attribute: string,
): unknown {
  switch (attribute) {
    case 'canonicalName':
      return entity.canonicalName;
    case 'email':
      return entity.email;
    case 'phone':
      return entity.phone;
    case 'domain':
      return entity.domain;
    case 'inn':
      return entity.inn;
    case 'ogrn':
      return entity.ogrn;
    default: {
      const meta = (entity.metadata as Record<string, unknown> | null) ?? null;
      return meta && attribute in meta ? meta[attribute] : null;
    }
  }
}

function buildEntityCells(
  props: PropLite[],
  entity: Parameters<typeof entityValue>[0],
): Record<string, unknown> {
  const cells: Record<string, unknown> = {};
  for (const p of props) {
    const attr = entityAttributeOf(p);
    if (!attr) continue;
    const v = entityValue(entity, attr);
    if (v !== null && v !== undefined && v !== '') cells[p.id] = v;
  }
  return cells;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}
function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('=== backfill-table-entity-sync START ===');

  const orgs = await prisma.org.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });
  // eslint-disable-next-line no-console
  console.log(`Активных Org: ${orgs.length}`);

  let rowsCreated = 0;
  let rowsMerged = 0;
  let tablesTouched = 0;

  for (const org of orgs) {
    const tables = await prisma.table.findMany({
      where: {
        tenantId: org.id,
        deletedAt: null,
        archivedAt: null,
        entitySync: { not: Prisma.JsonNull },
      },
      include: { properties: { select: { id: true, config: true } } },
    });

    for (const table of tables) {
      const sync = parseEntitySync(table.entitySync);
      if (!sync?.autoCreate) continue;
      const types = resolveEntityTypes(sync);
      if (types.length === 0) continue;

      const entities = await prisma.entity.findMany({
        where: {
          tenantId: org.id,
          type: { in: types as never[] },
          mergedIntoId: null,
        },
        orderBy: { createdAt: 'asc' },
      });
      if (entities.length === 0) continue;

      // Уже привязанные строки → пропускаем.
      const existingRows = await prisma.tableRow.findMany({
        where: {
          tableId: table.id,
          entityId: { in: entities.map((e) => e.id) },
          deletedAt: null,
        },
        select: { entityId: true },
      });
      const linked = new Set(
        existingRows.map((r) => r.entityId).filter((id): id is string => !!id),
      );

      // Ручные строки (для конфликт-резолвера).
      const manualRows = await prisma.tableRow.findMany({
        where: {
          tableId: table.id,
          tenantId: org.id,
          entityId: null,
          deletedAt: null,
          archivedAt: null,
        },
        select: { id: true, cells: true },
      });
      const primaryProp = table.properties.find(
        (p) => entityAttributeOf(p) === 'canonicalName',
      );
      const emailProp = table.properties.find(
        (p) => entityAttributeOf(p) === 'email',
      );

      const lastRow = await prisma.tableRow.findFirst({
        where: { tableId: table.id, deletedAt: null },
        orderBy: { order: 'desc' },
        select: { order: true },
      });
      let order = (lastRow ? Number(lastRow.order.toString()) : 0) + 1;

      let createdForTable = 0;

      for (const entity of entities) {
        if (linked.has(entity.id)) continue;
        const cells = buildEntityCells(table.properties, entity);

        // Конфликт-резолвер: ручная строка с совпадающим primary/email.
        const nameKey = norm(entity.canonicalName);
        const emailKey = norm(entity.email ?? '');
        const conflict = manualRows.find((r) => {
          const c = (r.cells as Record<string, unknown>) ?? {};
          if (
            primaryProp &&
            nameKey.length > 0 &&
            norm(cellText(c[primaryProp.id])) === nameKey
          ) {
            return true;
          }
          if (
            emailProp &&
            emailKey.length > 0 &&
            norm(cellText(c[emailProp.id])) === emailKey
          ) {
            return true;
          }
          return false;
        });

        if (conflict) {
          const mergedCells = {
            ...((conflict.cells as Record<string, unknown>) ?? {}),
            ...cells,
          };
          await prisma.tableRow.update({
            where: { id: conflict.id },
            data: {
              entityId: entity.id,
              cells: mergedCells as Prisma.InputJsonValue,
            },
          });
          // Не дать той же ручной строке слиться повторно.
          conflict.entityId = entity.id as never;
          manualRows.splice(manualRows.indexOf(conflict), 1);
          linked.add(entity.id);
          rowsMerged++;
          continue;
        }

        await prisma.tableRow.create({
          data: {
            tableId: table.id,
            tenantId: org.id,
            cells: cells as Prisma.InputJsonValue,
            entityId: entity.id,
            order: new Prisma.Decimal(order++),
            createdBy: 'system',
          },
        });
        rowsCreated++;
        createdForTable++;
        linked.add(entity.id);
      }

      if (createdForTable > 0) tablesTouched++;
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `Строк создано: ${rowsCreated}, слито с ручными: ${rowsMerged}; затронуто таблиц: ${tablesTouched}`,
  );
  // eslint-disable-next-line no-console
  console.log('=== backfill-table-entity-sync DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('backfill-table-entity-sync FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
