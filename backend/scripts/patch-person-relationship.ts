/**
 * Patch (SBA α-3) — backfill Person.relationship.
 *
 * Логика:
 *   - Person с активным Membership в той же Org → relationship='employee'.
 *   - Остальные → оставляем default 'external'.
 *
 * Запуск:
 *   bun run scripts/patch-person-relationship.ts          — реальный backfill
 *   bun run scripts/patch-person-relationship.ts --dry-run — только подсчёт
 *
 * Идемпотентно — повторный запуск перепроставит employee тем же лицам
 * (Membership неизменна → результат тот же).
 *
 * NB: «активное» Membership — это запись без отдельного статуса; модель
 * Membership в Z не имеет soft-delete полем. Считаем active = «существует».
 * Если в будущем Membership получит `revokedAt` — обновить фильтр.
 */

import { PrismaClient } from '@prisma/client';

const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 1000;

interface Counters {
  scanned: number;
  setEmployee: number;
  alreadyEmployee: number;
  externalKept: number;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const counters: Counters = {
    scanned: 0,
    setEmployee: 0,
    alreadyEmployee: 0,
    externalKept: 0,
  };

  try {
    /* eslint-disable no-console */
    console.log(
      `=== patch-person-relationship START (${DRY_RUN ? 'DRY-RUN' : 'REAL'}) ===`,
    );

    let cursorId: string | undefined = undefined;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const batch = await prisma.person.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          tenantId: true,
          userId: true,
          relationship: true,
        },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
      });
      if (batch.length === 0) break;

      for (const p of batch) {
        counters.scanned++;

        // Сотрудник = есть Membership в этой Org. Через Person.userId — если
        // приглашение принято, userId !== null и через Membership(orgId,userId)
        // мы можем найти запись.
        if (!p.userId) {
          // Без userId — приглашение не принято или Person не сотрудник.
          if (p.relationship === 'employee') {
            // Защитный кейс: ранее было employee, но userId=null. Не трогаем
            // (могло быть выставлено вручную через будущий API).
            counters.alreadyEmployee++;
          } else {
            counters.externalKept++;
          }
          continue;
        }

        const membership = await prisma.membership.findFirst({
          where: { orgId: p.tenantId, userId: p.userId },
          select: { id: true },
        });

        if (membership) {
          if (p.relationship === 'employee') {
            counters.alreadyEmployee++;
            continue;
          }
          counters.setEmployee++;
          if (!DRY_RUN) {
            await prisma.person.update({
              where: { id: p.id },
              data: { relationship: 'employee' },
            });
          }
        } else {
          counters.externalKept++;
        }
      }

      cursorId = batch[batch.length - 1]?.id;
      console.log(
        `  ...обработан батч до id=${cursorId}, всего отсканировано=${counters.scanned}`,
      );
      if (batch.length < BATCH_SIZE) break;
    }

    console.log('=== Итоги patch-person-relationship ===');
    console.log(`  scanned          : ${counters.scanned}`);
    console.log(`  setEmployee      : ${counters.setEmployee}`);
    console.log(`  alreadyEmployee  : ${counters.alreadyEmployee}`);
    console.log(`  externalKept     : ${counters.externalKept}`);
    console.log(`  mode             : ${DRY_RUN ? 'DRY-RUN' : 'REAL'}`);
    /* eslint-enable no-console */
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('patch-person-relationship FAILED:', err);
  process.exit(1);
});
