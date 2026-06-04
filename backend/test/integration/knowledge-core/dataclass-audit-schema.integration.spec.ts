/**
 * Ф8 «код ↔ схема: dataClassAudit + машинный гард класса» (2026-06-04).
 * Источник: plans/tz/2026-06-04-razblokirovka-konveyera.md §Ф8.
 *
 * МАШИННЫЙ ГАРД КЛАССА «код↔схема». tsc СТРУКТУРНО слеп к лишнему ключу
 * `dataClassAudit` внутри `create({ data })` (Prisma generic `Subset<T,Args>`),
 * поэтому `insight.create({ ..., dataClassAudit })` проходил typecheck, но падал
 * в рантайме (`42703 column "dataClassAudit" does not exist`), пока поля не было
 * в схеме. Единственный способ поймать такой регресс — прогнать `create` против
 * РЕАЛЬНОГО Postgres. Мок убил бы смысл гарда (он именно про реальную БД и
 * tsc-слепоту), поэтому здесь — живой PrismaClient на dev-стеке.
 *
 * Что проверяем:
 *   1. `insight.create({ ..., dataClassAudit })` проходит и значение читается.
 *   2. `decision.create({ ..., dataClassAudit })` проходит и значение читается.
 *   3. Запрос snapshotVersionDrift-cron'а по insights/decimals
 *      (`SELECT ... "dataClassAudit"->>'policyVersion' FROM insights/decisions`)
 *      не бросает (колонка существует).
 *   4. (негативный контроль) попытка вставить НЕсуществующий ключ в `data`
 *      падает в рантайме — демонстрирует, что tsc этого не ловит, а тест ловит.
 *
 * Если dev-стек недоступен (CI без docker) — все тесты файла skip'аются.
 */
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  checkDbAvailable,
  closePrismaClient,
  getPrismaClient,
} from './db-availability';

const PREFIX = 'kc-dca-schema-spec';

interface Ctx {
  dbReady: boolean;
  ownerUserId: string;
  orgId: string;
}

const ctx: Ctx = {
  dbReady: false,
  ownerUserId: `${PREFIX}-user`,
  orgId: `${PREFIX}-org`,
};

/** Образец audit-объекта (как пишет DataClassPolicyService.derive().audit). */
const SAMPLE_AUDIT = {
  policyVersion: 'integration_v1',
  resolvedClass: 'internal',
  sources: [{ sourceId: 'blk-1', sourceKind: 'idea_block', dataClass: 'internal' }],
  decidedBy: 'test',
} as const;

async function cleanup(): Promise<void> {
  const prisma = await getPrismaClient();
  await prisma.insight
    .deleteMany({ where: { tenantId: ctx.orgId } })
    .catch(() => undefined);
  await prisma.decision
    .deleteMany({ where: { tenantId: ctx.orgId } })
    .catch(() => undefined);
  await prisma.membership
    .deleteMany({ where: { userId: ctx.ownerUserId } })
    .catch(() => undefined);
  await prisma.org
    .deleteMany({ where: { id: ctx.orgId } })
    .catch(() => undefined);
  await prisma.user
    .deleteMany({ where: { id: ctx.ownerUserId } })
    .catch(() => undefined);
}

beforeAll(async () => {
  ctx.dbReady = await checkDbAvailable();
  if (!ctx.dbReady) return;

  const prisma = await getPrismaClient();
  await cleanup();
  // Org требует существующего User (Org.ownerId → User).
  await prisma.user.create({
    data: {
      id: ctx.ownerUserId,
      email: `${PREFIX}@test.local`,
      name: `DCA Owner ${PREFIX}`,
    },
  });
  await prisma.org.create({
    data: {
      id: ctx.orgId,
      name: `${PREFIX} Org`,
      slug: PREFIX,
      ownerId: ctx.ownerUserId,
      visibilityMode: 'open',
    },
  });
  await prisma.membership.create({
    data: { orgId: ctx.orgId, userId: ctx.ownerUserId, role: 'owner' },
  });
});

afterAll(async () => {
  if (ctx.dbReady) await cleanup();
  await closePrismaClient();
});

describe('Ф8 — dataClassAudit на Insight/Decision (машинный гард код↔схема)', () => {
  it.skipIf(!ctx.dbReady)(
    'insight.create({ ..., dataClassAudit }) — проходит и значение сохраняется',
    async () => {
      const prisma = await getPrismaClient();
      const created = await prisma.insight.create({
        data: {
          tenantId: ctx.orgId,
          kind: 'problem',
          statement: 'Клиенты жалуются на медленную загрузку отчётов',
          severity: 'medium',
          // ← ключевой ключ: до Ф8 ронял рантайм при зелёном tsc.
          dataClassAudit: SAMPLE_AUDIT,
        },
        select: { id: true, dataClassAudit: true },
      });
      expect(created.id).toBeTruthy();
      expect(created.dataClassAudit).toMatchObject({
        policyVersion: 'integration_v1',
      });
    },
  );

  it.skipIf(!ctx.dbReady)(
    'decision.create({ ..., dataClassAudit }) — проходит и значение сохраняется',
    async () => {
      const prisma = await getPrismaClient();
      const created = await prisma.decision.create({
        data: {
          tenantId: ctx.orgId,
          statement: 'Переходим на еженедельные планёрки',
          rationale: 'Чтобы быстрее ловить блокеры',
          // ← ключевой ключ: до Ф8 ронял рантайм при зелёном tsc.
          dataClassAudit: SAMPLE_AUDIT,
        },
        select: { id: true, dataClassAudit: true },
      });
      expect(created.id).toBeTruthy();
      expect(created.dataClassAudit).toMatchObject({
        policyVersion: 'integration_v1',
      });
    },
  );

  it.skipIf(!ctx.dbReady)(
    'snapshotVersionDrift-запрос по insights/decisions не бросает (колонка существует)',
    async () => {
      const prisma = await getPrismaClient();
      // Тот же raw-SQL, что в dataclass-audit-snapshot.cron.ts::snapshotVersionDrift.
      // До Ф8 падал 42703 (column "dataClassAudit" does not exist).
      const run = prisma.$queryRaw<Array<{ tenantId: string; cnt: bigint }>>`
        SELECT "tenantId", COUNT(*)::bigint as cnt
        FROM (
          SELECT "tenantId", "dataClassAudit"->>'policyVersion' as v
          FROM insights WHERE "dataClassAudit" IS NOT NULL
          UNION ALL
          SELECT "tenantId", "dataClassAudit"->>'policyVersion' as v
          FROM decisions WHERE "dataClassAudit" IS NOT NULL
        ) t
        WHERE v IS NOT NULL AND v <> ${'current_v'}
        GROUP BY "tenantId"
      `;
      await expect(run).resolves.toBeInstanceOf(Array);
    },
  );

  it.skipIf(!ctx.dbReady)(
    'count({ where: { dataClassAudit: { not: null } } }) по insights/decisions не бросает ValidationError',
    async () => {
      const prisma = await getPrismaClient();
      // Тот же запрос, что snapshotPresentRatio-cron делает per kind. Cron гоняет
      // его через нетипизированный `any`-делегат с сырым `{ not: null }`; в
      // типизированном вызове для Json-колонки эквивалент — `Prisma.DbNull`
      // (фильтр «не database NULL»). До Ф8 любая из форм бросала
      // ValidationError, т.к. колонки не было вовсе.
      await expect(
        prisma.insight.count({
          where: { dataClassAudit: { not: Prisma.DbNull } },
        }),
      ).resolves.toBeTypeOf('number');
      await expect(
        prisma.decision.count({
          where: { dataClassAudit: { not: Prisma.DbNull } },
        }),
      ).resolves.toBeTypeOf('number');
    },
  );

  it.skipIf(!ctx.dbReady)(
    'НЕГАТИВНЫЙ КОНТРОЛЬ: несуществующий ключ в data ловит ИМЕННО рантайм (не tsc)',
    async () => {
      const prisma = await getPrismaClient();
      // tsc эту строку не пропустил бы при литеральном ключе, поэтому строим
      // объект динамически (как это происходит при дрейфе схемы / опечатке в
      // поле, которое потом удалили). Демонстрируем: гард = рантайм-тест.
      const badData: Record<string, unknown> = {
        tenantId: ctx.orgId,
        kind: 'problem',
        statement: 'строка для негативного контроля',
        // поле, которого в схеме НЕТ — Prisma бросит на валидации:
        nonexistentColumnZzz: { foo: 'bar' },
      };
      await expect(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        prisma.insight.create({ data: badData as any }),
      ).rejects.toThrow();
    },
  );
});
