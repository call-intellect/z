/**
 * backfill-task-source-type.ts (ТЗ 2026-06-11 chatbox-tasks Ф5/Ф7)
 *
 * Идемпотентно проставляет `Task.sourceType='meeting'` всем задачам, у которых
 * оно пустое/NULL.
 *
 * ВАЖНО — это safety no-op: колонка `Task.sourceType` имеет `@default("meeting")`,
 * поэтому при `prisma migrate deploy` все существующие строки уже получили
 * 'meeting'. Скрипт оставлен как страховка на случай, если миграция/insert обошли
 * default (например, raw-SQL), и для единообразия реестра prod-операций.
 *
 * Запуск (через агрегатор apply-prod-deploy.ts STEPS, phase=backfill,
 * skipBootstrap=true) или вручную:
 *   docker compose exec backend bun run scripts/backfill-task-source-type.ts
 *
 * Не использует Nest — прямой Prisma через createPrismaClient() (driver adapter
 * Prisma 7). Tenant-агностичен: трогает только пустой sourceType, ничего не
 * перетирает.
 */
import { createPrismaClient } from './_lib/prisma';

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  try {
    // Кандидаты: sourceType пустая строка (NULL невозможен — колонка NOT NULL с
    // default, но raw-insert мог оставить '').
    const res = await prisma.task.updateMany({
      where: { sourceType: '' },
      data: { sourceType: 'meeting' },
    });
    // eslint-disable-next-line no-console
    console.log(
      `backfill-task-source-type: updated=${res.count} (sourceType='' → 'meeting')`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('backfill-task-source-type FAILED:', err);
  process.exit(1);
});
