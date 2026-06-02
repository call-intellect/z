/**
 * Backfill системных Smart-таблиц (Smart-tables Фаза 0).
 *
 * Задача: для каждой существующей `Org` создать недостающие системные таблицы
 * по каталогу `SYSTEM_TABLES_CATALOG` (10 шаблонов, ПУСТЫЕ — без строк). Новые
 * Org получают эти таблицы автоматически в `OrgsService.createForOwner` через
 * `TablesAutoProvisionService`; этот скрипт — для уже-существующих Org.
 *
 * Запуск:
 *   bun run scripts/backfill-system-tables.ts
 *
 * Идемпотентен: для каждого шаблона делаем findFirst({ tenantId, systemKey }) и
 * создаём только отсутствующие. Повторный запуск ничего не ломает.
 *
 * См. safe-seed-rules: не делаем mass updateMany, создаём только недостающее.
 */

import { Prisma } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';
import { SYSTEM_TABLES_CATALOG } from '../src/modules/tables/templates/system-tables.catalog';

const prisma = createPrismaClient();

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('=== backfill-system-tables START ===');

  const orgs = await prisma.org.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, ownerId: true },
    orderBy: { createdAt: 'asc' },
  });
  // eslint-disable-next-line no-console
  console.log(`Активных Org: ${orgs.length}`);

  let tablesCreated = 0;
  let tablesSkipped = 0;
  let orgsTouched = 0;

  for (const org of orgs) {
    let createdForOrg = 0;
    for (const tpl of SYSTEM_TABLES_CATALOG) {
      const existing = await prisma.table.findFirst({
        where: { tenantId: org.id, systemKey: tpl.systemKey },
        select: { id: true },
      });
      if (existing) {
        tablesSkipped++;
        continue;
      }

      const table = await prisma.table.create({
        data: {
          tenantId: org.id,
          name: tpl.name,
          icon: tpl.icon,
          isSystem: true,
          systemKey: tpl.systemKey,
          entitySync: tpl.entitySync
            ? (tpl.entitySync as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          createdBy: org.ownerId,
        },
        select: { id: true },
      });

      for (let i = 0; i < tpl.properties.length; i++) {
        const p = tpl.properties[i]!;
        await prisma.tableProperty.create({
          data: {
            tableId: table.id,
            name: p.name,
            type: p.type,
            config: (p.config ?? {}) as Prisma.InputJsonValue,
            isPrimary: p.isPrimary ?? false,
            order: new Prisma.Decimal((i + 1) * 1000),
          },
        });
      }

      tablesCreated++;
      createdForOrg++;
    }
    if (createdForOrg > 0) {
      orgsTouched++;
      // eslint-disable-next-line no-console
      console.log(
        `  + Org "${org.name}" (${org.id}): создано ${createdForOrg} системных таблиц`,
      );
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `Таблиц создано: ${tablesCreated}, пропущено (уже было): ${tablesSkipped}; затронуто Org: ${orgsTouched}`,
  );
  // eslint-disable-next-line no-console
  console.log('=== backfill-system-tables DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('backfill-system-tables FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
