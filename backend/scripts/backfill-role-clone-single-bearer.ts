/**
 * Раздел 7 (2026-06-16) «один человек = один клон должности» — one-off backfill.
 * Источник: plans/tz/2026-06-16-clone-agents-prompt-revision.md §7.6.
 *
 * Приводит существующие клоны ролей к новой модели:
 *   A. ДЕДУП active-дублей (последствие гонки Б13): на роль оставляем одну
 *      active (свежайшую по roleVersion/snapshotAt), остальные → `frozen`.
 *      Нужно, чтобы встал partial-unique индекс executable_personas_one_active_per_role.
 *   B. ЧИТАЕМОСТЬ бывших (Р3/Р5): существующие scope='role' `superseded` → `frozen`
 *      (снимки бывших носителей доступны для вопросов навсегда). Легаси-стабы
 *      `pending_rebuild` → `superseded` (они промежуточные, не показываем).
 *   C. ПЕРЕСБОРКА агрегатов в single-bearer (Р1/Р2): старые агрегатные клоны роли
 *      (собранные dedupe по нескольким людям) у которых `currentBearerPersonId IS NULL`
 *      (старый buildForRole его не проставлял — Б12) пересобираем через
 *      ExecutablePersonaBuildService.buildForRole — он заморозит агрегат и создаст
 *      новую active из профиля ЕДИНСТВЕННОГО текущего носителя.
 *
 * **Idempotent.** A: повторно нет >1 active. B: повторно нет superseded/pending.
 * C: пересобираем только active с currentBearerPersonId=null — после пересборки
 * новая active несёт bearer → следующий прогон её пропускает. Нет носителя/мало
 * traits → buildForRole вернёт null, агрегат остаётся (cron доберёт).
 *
 * Запуск:
 *   bun run scripts/backfill-role-clone-single-bearer.ts --dry-run
 *   bun run scripts/backfill-role-clone-single-bearer.ts
 *   bun run scripts/backfill-role-clone-single-bearer.ts --tenant=<orgId>
 *   bun run scripts/backfill-role-clone-single-bearer.ts --skip-rebuild  (только A+B, без LLM)
 */

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { ExecutablePersonaBuildService } from '../src/modules/knowledge-core/services/executable-persona-build.service';

import { createPrismaClient } from './_lib/prisma';
import { silenceRedisShutdownNoise } from './_lib/silence-redis-shutdown';

interface Options {
  tenantId?: string;
  dryRun: boolean;
  skipRebuild: boolean;
}

function parseArgs(argv: string[]): Options {
  const tenantArg = argv.find((a) => a.startsWith('--tenant='));
  const opts: Options = {
    dryRun: argv.includes('--dry-run'),
    skipRebuild: argv.includes('--skip-rebuild'),
  };
  if (tenantArg) {
    const v = tenantArg.split('=')[1];
    if (v) opts.tenantId = v;
  }
  return opts;
}

async function main(opts: Options): Promise<void> {
  console.log(
    `=== backfill-role-clone-single-bearer START (dryRun=${opts.dryRun}, ` +
      `tenant=${opts.tenantId ?? '<all>'}, skipRebuild=${opts.skipRebuild}) ===`,
  );

  const baseWhere = {
    scope: 'role' as const,
    ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
  };

  // Лёгкий pre-check ДО подъёма AppModule: есть ли вообще role-клоны.
  const preCheck = createPrismaClient();
  try {
    const total = await preCheck.executablePersona.count({ where: baseWhere });
    if (total === 0) {
      console.log('backfill-role-clone-single-bearer: role-клонов нет — backfill не требуется.');
      return;
    }
    console.log(`backfill-role-clone-single-bearer: всего role-персон ${total}`);
  } finally {
    await preCheck.$disconnect();
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const prisma = app.get(PrismaService);
    const builder = app.get(ExecutablePersonaBuildService);

    // ── A. Дедуп active-дублей на роль (оставить свежайшую, остальные → frozen).
    const activeRows = await prisma.executablePersona.findMany({
      where: { ...baseWhere, status: 'active' },
      select: { id: true, scopeRefId: true, roleVersion: true, snapshotAt: true },
      orderBy: [{ roleVersion: 'desc' }, { snapshotAt: 'desc' }],
    });
    const byRole = new Map<string, string>(); // scopeRefId → id «победителя» (первый по orderBy)
    const dupIds: string[] = [];
    for (const r of activeRows) {
      const key = r.scopeRefId ?? '';
      if (!byRole.has(key)) byRole.set(key, r.id);
      else dupIds.push(r.id);
    }
    if (dupIds.length > 0) {
      console.log(`A. дублей active найдено: ${dupIds.length} → frozen`);
      if (!opts.dryRun) {
        const res = await prisma.executablePersona.updateMany({
          where: { id: { in: dupIds }, status: 'active' },
          data: { status: 'frozen' },
        });
        console.log(`A. заморожено: ${res.count}`);
      }
    } else {
      console.log('A. дублей active нет.');
    }

    // ── B. superseded → frozen (читаемость бывших); pending_rebuild → superseded.
    if (!opts.dryRun) {
      const supRes = await prisma.executablePersona.updateMany({
        where: { ...baseWhere, status: 'superseded' },
        data: { status: 'frozen' },
      });
      const pendRes = await prisma.executablePersona.updateMany({
        where: { ...baseWhere, status: 'pending_rebuild' },
        data: { status: 'superseded' },
      });
      console.log(`B. superseded→frozen: ${supRes.count}; pending_rebuild→superseded: ${pendRes.count}`);
    } else {
      const supCnt = await prisma.executablePersona.count({
        where: { ...baseWhere, status: 'superseded' },
      });
      const pendCnt = await prisma.executablePersona.count({
        where: { ...baseWhere, status: 'pending_rebuild' },
      });
      console.log(`B. (dry) superseded→frozen: ${supCnt}; pending_rebuild→superseded: ${pendCnt}`);
    }

    // ── C. Пересборка агрегатов single-bearer'ом (active с currentBearerPersonId=null).
    if (opts.skipRebuild) {
      console.log('C. пропущено (--skip-rebuild): single-bearer пересоберёт weekly cron.');
    } else {
      const aggregates = await prisma.executablePersona.findMany({
        where: { ...baseWhere, status: 'active', currentBearerPersonId: null },
        select: { id: true, tenantId: true, scopeRefId: true },
      });
      console.log(`C. агрегатов к пересборке (bearer=null): ${aggregates.length}`);
      let rebuilt = 0;
      let skipped = 0;
      for (const agg of aggregates) {
        if (!agg.scopeRefId) {
          skipped++;
          continue;
        }
        if (opts.dryRun) {
          rebuilt++;
          continue;
        }
        try {
          const built = await builder.buildForRole({
            tenantId: agg.tenantId,
            roleId: agg.scopeRefId,
            triggerReason: 'manual',
          });
          if (built) rebuilt++;
          else skipped++;
          if ((rebuilt + skipped) % 25 === 0) {
            console.log(`C. progress: rebuilt=${rebuilt}, skipped=${skipped}/${aggregates.length}`);
          }
        } catch (err) {
          skipped++;
          console.warn(
            `C. [error] roleId=${agg.scopeRefId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      console.log(`C. DONE: rebuilt=${rebuilt}, skipped=${skipped} (skipped — нет носителя/мало traits, cron доберёт)`);
    }

    console.log('=== backfill-role-clone-single-bearer DONE ===');
  } finally {
    await app.close();
  }
}

const opts = parseArgs(process.argv.slice(2));
silenceRedisShutdownNoise();
main(opts)
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('backfill-role-clone-single-bearer FAILED:', err);
    process.exit(1);
  });
