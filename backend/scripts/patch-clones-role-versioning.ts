/**
 * Clones=Roles Фаза 1 (2026-05-25) — backfill versioning-полей для
 * существующих `ExecutablePersona(scope='role', status='active')`.
 *
 * Что делает (идемпотентно):
 *   1. Берёт все `ExecutablePersona(scope='role', status='active')` с
 *      `roleVersion IS NULL`.
 *   2. Для каждой:
 *        roleVersion           = 1
 *        currentBearerPersonId = NULL  (компания назначит руками)
 *        succeedsPersonaId     = NULL
 *        publicName            = 'Клон <Role.name> v1' (берём Role.name по
 *                                 scopeRefId; если Role не нашли —
 *                                 'Клон роли v1' с warning).
 *   3. `scope='person'` записи НЕ трогает (legacy, остаются как есть).
 *
 * Безопасность (skill safe-seed-rules):
 *   - WHERE roleVersion IS NULL — повторный запуск не перезаписывает данные.
 *   - `--dry-run` — печатает обновления, не пишет.
 *
 * Запуск:
 *   cd backend
 *   bun run scripts/patch-clones-role-versioning.ts
 *   bun run scripts/patch-clones-role-versioning.ts --dry-run
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

// Prisma 7: driver adapter обязателен. URL из env (bun грузит .env).
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
});

interface CliOptions {
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  return {
    dryRun: argv.includes('--dry-run'),
  };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log(`=== patch-clones-role-versioning START (dry-run=${opts.dryRun}) ===`);

  // Берём все role-scope активные personas без roleVersion.
  // Используем raw query — Prisma-модель уже знает новое поле, но в
  // raw'е удобнее агрегировать с Role одним JOIN'ом.
  const candidates = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      tenantId: string;
      scopeRefId: string | null;
      roleName: string | null;
    }>
  >(
    `
      SELECT p.id, p."tenantId", p."scopeRefId",
             r.name AS "roleName"
      FROM "executable_personas" p
      LEFT JOIN "Role" r ON r.id = p."scopeRefId"
      WHERE p.scope = 'role'
        AND p.status = 'active'
        AND p."roleVersion" IS NULL
    `,
  );

  console.log(`Найдено кандидатов: ${candidates.length}`);
  if (candidates.length === 0) {
    console.log('Нечего обновлять — skip.');
    return;
  }

  let updated = 0;
  let warnedNoRole = 0;

  for (const cand of candidates) {
    const roleName = cand.roleName?.trim();
    const publicName = roleName
      ? `Клон ${roleName} v1`
      : 'Клон роли v1';
    if (!roleName) {
      warnedNoRole++;
      console.warn(
        `[warn] persona ${cand.id} scopeRefId=${cand.scopeRefId ?? '<null>'} — Role не найдена; ставим публичное имя '${publicName}'`,
      );
    }

    if (opts.dryRun) {
      console.log(
        `[dry-run] persona=${cand.id} → roleVersion=1, publicName='${publicName}', currentBearerPersonId=null, succeedsPersonaId=null`,
      );
      continue;
    }

    await prisma.executablePersona.update({
      where: { id: cand.id },
      data: {
        roleVersion: 1,
        publicName,
        currentBearerPersonId: null,
        succeedsPersonaId: null,
      },
    });
    updated++;
  }

  console.log(
    `\nИТОГО: candidates=${candidates.length}, updated=${updated}, warnedNoRole=${warnedNoRole}`,
  );
}

main()
  .catch((err) => {
    console.error('patch-clones-role-versioning FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    console.log('=== patch-clones-role-versioning DONE ===');
  });
