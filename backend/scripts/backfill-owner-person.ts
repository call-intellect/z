/**
 * Backfill Person для владельцев Org без Person (2026-06-04, Ф9).
 *
 * Контекст:
 *   ТЗ `plans/tz/2026-06-04-razblokirovka-konveyera.md` (Ф9). Исторически
 *   `OrgsService.createForOwner` создавал Membership(owner) БЕЗ personId и не
 *   создавал Person владельца (`Person.userId` линковался только при accept'е
 *   приглашения). Следствия для существующих Org:
 *     - `GET /me/promises` отдаёт 403 (`CommitmentsService.resolveSelfPerson`
 *       не находит Person);
 *     - дамп мысли уходит в legacy-ветку без Document/provenance.
 *
 *   Этот backfill создаёт Person для всех Membership, у которых нет ни
 *   `personId`, ни Person по (orgId, userId), и проставляет membership.personId.
 *   Логика повторяет `PersonsService.ensurePersonForUser` шаг 3 (создание
 *   минимальной карточки с relationship='employee', name/email из User),
 *   но автономна (на голом prisma — агрегатор apply-prod-deploy запускает
 *   скрипт как дочерний процесс, без Nest DI).
 *
 * Идемпотентность:
 *   - Membership с уже проставленным personId → skip.
 *   - Membership, у которого уже есть Person по (tenantId, userId) →
 *     только проставляем personId (Person не дублируем).
 *   - Создание Person устойчиво к P2002 на (tenantId, email, deletedAt):
 *     при конфликте линкуем существующую безличную карточку с тем же email.
 *   Повторный прогон → 0 созданий, 0 обновлений.
 *
 * Запуск:
 *   docker compose exec backend bun run scripts/backfill-owner-person.ts          # dry-run
 *   docker compose exec backend bun run scripts/backfill-owner-person.ts --apply   # запись
 *
 * Регистрация: backend/scripts/apply-prod-deploy.ts (phase: 'backfill', skipBootstrap).
 */

import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';

export interface Stats {
  membershipsScanned: number;
  personsCreated: number;
  personsLinked: number;
  membershipsUpdated: number;
}

const BATCH_SIZE = 200;

/**
 * Гарантирует Person для (tenantId, userId) и возвращает её id (или null в
 * dry-run, если карточки ещё нет). Повторяет логику ensurePersonForUser, но
 * на автономном prisma-клиенте.
 */
async function ensurePerson(
  prisma: PrismaClient,
  args: { tenantId: string; userId: string; personId: string | null },
  apply: boolean,
  stats: Stats,
): Promise<string | null> {
  // 1. Membership уже ссылается на Person — ничего создавать не нужно.
  if (args.personId) return args.personId;

  // 2. Person по (tenantId, userId) уже есть — просто привяжем её к membership.
  const existing = await prisma.person.findFirst({
    where: { tenantId: args.tenantId, userId: args.userId, deletedAt: null },
    select: { id: true },
  });
  if (existing) return existing.id;

  // 3. Создаём минимальную Person с name/email из User.
  const user = await prisma.user.findUnique({
    where: { id: args.userId },
    select: { email: true, name: true },
  });
  const email = user?.email ?? '';

  if (!apply) {
    console.log(
      `[DRY-RUN] would create Person tenantId=${args.tenantId} userId=${args.userId} email=${email}`,
    );
    stats.personsCreated++;
    return null;
  }

  try {
    const created = await prisma.person.create({
      data: {
        tenantId: args.tenantId,
        userId: args.userId,
        name: user?.name ?? '',
        email,
        relationship: 'employee',
      },
      select: { id: true },
    });
    stats.personsCreated++;
    return created.id;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      // Гонка — Person уже создана по userId.
      const raced = await prisma.person.findFirst({
        where: { tenantId: args.tenantId, userId: args.userId, deletedAt: null },
        select: { id: true },
      });
      if (raced) return raced.id;
      // Безличный контакт с тем же email — линкуем его к user'у.
      if (email) {
        const byEmail = await prisma.person.findFirst({
          where: { tenantId: args.tenantId, email, deletedAt: null },
          select: { id: true, userId: true },
        });
        if (byEmail && byEmail.userId === null) {
          await prisma.person.update({
            where: { id: byEmail.id },
            data: { userId: args.userId },
          });
          stats.personsLinked++;
          return byEmail.id;
        }
      }
    }
    throw err;
  }
}

/**
 * Чистая функция backfill — для импорта в unit-тесте (мок-PrismaClient).
 * При `apply=false` (dry-run) считает кандидатов, но ничего не пишет.
 */
export async function backfillOwnerPerson(
  prisma: PrismaClient,
  opts: { apply: boolean },
): Promise<Stats> {
  const stats: Stats = {
    membershipsScanned: 0,
    personsCreated: 0,
    personsLinked: 0,
    membershipsUpdated: 0,
  };

  console.log(
    `=== backfill-owner-person START (apply=${opts.apply}, batch=${BATCH_SIZE}) ===`,
  );

  // Курсорная пагинация по Membership без personId. Берём все роли (owner и
  // прочие): любому участнику без Person полезна карточка для атрибуции; на
  // практике корень — именно owner, но ограничивать незачем.
  let cursorId: string | undefined = undefined;
  while (true) {
    const batch: {
      id: string;
      orgId: string;
      userId: string;
      personId: string | null;
    }[] = await prisma.membership.findMany({
      where: { personId: null },
      select: { id: true, orgId: true, userId: true, personId: true },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
    });

    if (batch.length === 0) break;

    for (const m of batch) {
      stats.membershipsScanned++;
      const personId = await ensurePerson(
        prisma,
        { tenantId: m.orgId, userId: m.userId, personId: m.personId },
        opts.apply,
        stats,
      );

      if (opts.apply) {
        if (!personId) continue; // не должно случаться в apply, но безопасно.
        await prisma.membership.update({
          where: { id: m.id },
          data: { personId },
        });
      } else {
        // dry-run: personId может быть null (карточка ещё не создана) —
        // считаем планируемое действие.
        console.log(
          `[DRY-RUN] would set membership ${m.id}.personId=${personId ?? '<new>'}`,
        );
      }
      stats.membershipsUpdated++;
    }

    cursorId = batch[batch.length - 1]?.id;
    if (batch.length < BATCH_SIZE) break;
  }

  console.log('=== Итоги backfill-owner-person ===');
  console.log(`  membershipsScanned : ${stats.membershipsScanned}`);
  console.log(`  personsCreated     : ${stats.personsCreated}`);
  console.log(`  personsLinked      : ${stats.personsLinked}`);
  console.log(`  membershipsUpdated : ${stats.membershipsUpdated}`);
  console.log(`  mode               : ${opts.apply ? 'APPLY' : 'DRY-RUN'}`);

  return stats;
}

// CLI-враппер.
if (require.main === module) {
  const apply = process.argv.includes('--apply');
  const prisma = createPrismaClient();
  backfillOwnerPerson(prisma, { apply })
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('backfill-owner-person FAILED:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
