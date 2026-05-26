/**
 * Seed для таблицы OrgRetentionPolicy (Фаза 11 knowledge-core).
 *
 * Создаёт политику ретеншена для каждой Org, у которой её ещё нет.
 * Дефолты — в схеме (rawEventDays=2555, archivedBlockDays=365, chatMessageDays=90,
 * auditLogDays=730, archivedBlockAction='archive_then_delete'). Скрипт ничего
 * не перезаписывает — admin мог изменить значения через UI/API, мы их не трогаем.
 *
 * Идемпотентность: per-Org check (`findUnique by tenantId`) перед `create`.
 * Можно запускать сколько угодно раз.
 *
 * Запуск:
 *   bun run scripts/seed-retention-policies.ts
 */

import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('=== seed-retention-policies START ===');

  const orgs = await prisma.org.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
  });
  // eslint-disable-next-line no-console
  console.log(`найдено Org (без deletedAt): ${orgs.length}`);

  let created = 0;
  let skipped = 0;

  for (const org of orgs) {
    const existing = await prisma.orgRetentionPolicy.findUnique({
      where: { tenantId: org.id },
    });
    if (existing) {
      skipped += 1;
      continue;
    }
    await prisma.orgRetentionPolicy.create({
      data: { tenantId: org.id },
    });
    created += 1;
    // eslint-disable-next-line no-console
    console.log(`[created] ${org.id} — ${org.name}`);
  }

  // eslint-disable-next-line no-console
  console.log(`created: ${created}, skipped: ${skipped}`);
  // eslint-disable-next-line no-console
  console.log('=== seed-retention-policies DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-retention-policies FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });
