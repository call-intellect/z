/**
 * CRIT-3 (см. plans/analysis/2026-05-22-code-reality-deltas.md §CRIT-3).
 *
 * Гейт-скрипт для перевода `Meeting.tenantId` из NULLABLE в NOT NULL.
 * Запускается ПЕРЕД деплоем новой схемы (где `tenantId String` без `?`).
 *
 * Логика:
 *   1. Прогоняет backfill повторно (для подстраховки — основной backfill
 *      сделан в `backfill-orgs-fase0.ts`). Идемпотентен.
 *   2. Проверяет: 0 строк `Meeting.tenantId IS NULL` → можно делать
 *      `bun run prisma:push` с новой NOT NULL-схемой.
 *   3. Если остались NULL-строки — печатает их id+ownerId+title и
 *      завершается с exit code 1 (миграция блокируется до ручного решения).
 *
 * Запуск (на проде, до prisma:push):
 *   cd backend && bun run scripts/tighten-meeting-tenant-not-null.ts
 *
 * Идемпотентен — повторный запуск безопасен.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function backfillStep(): Promise<number> {
  // Берём всех активных юзеров с их personal Org.
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { id: true, ownedOrgs: { select: { id: true } } },
  });

  let updated = 0;
  for (const u of users) {
    const orgId = u.ownedOrgs[0]?.id;
    if (!orgId) continue;
    const res = await prisma.meeting.updateMany({
      where: { ownerId: u.id, tenantId: null },
      data: { tenantId: orgId },
    });
    updated += res.count;
  }
  return updated;
}

async function listOrphans(): Promise<
  Array<{ id: string; title: string; ownerId: string; createdAt: Date }>
> {
  return prisma.meeting.findMany({
    where: { tenantId: null, deletedAt: null },
    select: { id: true, title: true, ownerId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('=== tighten-meeting-tenant-not-null START ===');

  const backfilled = await backfillStep();
  // eslint-disable-next-line no-console
  console.log(`Defensive backfill: обновлено ${backfilled} строк.`);

  const orphans = await listOrphans();
  if (orphans.length === 0) {
    // eslint-disable-next-line no-console
    console.log('OK: Meeting.tenantId IS NULL — 0 строк.');
    // eslint-disable-next-line no-console
    console.log('Можно безопасно применять prisma:push с NOT NULL-схемой.');
    return;
  }

  // eslint-disable-next-line no-console
  console.error(
    `FAIL: остались ${orphans.length} строк Meeting.tenantId IS NULL.`,
  );
  for (const m of orphans) {
    // eslint-disable-next-line no-console
    console.error(
      `  - meeting=${m.id} owner=${m.ownerId} createdAt=${m.createdAt.toISOString()} title="${m.title}"`,
    );
  }
  // eslint-disable-next-line no-console
  console.error(
    'Действие: либо проставить tenantId руками, либо мягко удалить (deletedAt) ' +
      'эти legacy-встречи без владельца в Org. После этого повторить запуск.',
  );
  process.exit(1);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('tighten-meeting-tenant-not-null FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
