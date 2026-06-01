/**
 * Clones=Roles Фаза 5 (2026-05-25) — backfill `dataClass='internal'` для
 * существующих `ExecutablePersona(scope='role')`.
 *
 * Что делает (идемпотентно):
 *   1. Берёт все `ExecutablePersona(scope='role')` где `dataClass != 'internal'`.
 *   2. Обновляет `dataClass='internal'` (Клон роли — это shared-знание Org,
 *      не личные данные сотрудника).
 *   3. `scope='person'` записи НЕ трогает (для них derive продолжает работать
 *      на уровне сервиса).
 *
 * Безопасность (skill safe-seed-rules):
 *   - WHERE dataClass != 'internal' — повторный запуск skip'ает уже обновлённые.
 *   - `--dry-run` — печатает обновления, не пишет.
 *
 * Запуск:
 *   cd backend
 *   bun run scripts/patch-clones-dataclass-update.ts
 *   bun run scripts/patch-clones-dataclass-update.ts --dry-run
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

import { columnExists } from './_lib/schema-guards';

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
  console.log(
    `=== patch-clones-dataclass-update START (dry-run=${opts.dryRun}) ===`,
  );

  // Guard: колонка ExecutablePersona.dataClass удалена из схемы (теперь
  // dataClass выводится политикой, фиксируется в dataClassAudit). Этот
  // one-time backfill от 2026-05-25 устарел — выходим чисто.
  if (!(await columnExists(prisma, 'executable_personas', 'dataClass'))) {
    console.log(
      'ExecutablePersona.dataClass удалён из схемы — backfill применён ранее / неактуален, обновление не требуется.',
    );
    await prisma.$disconnect();
    return;
  }

  // Берём role-scope personas с dataClass != 'internal'.
  const candidates = await prisma.executablePersona.findMany({
    where: {
      scope: 'role',
      NOT: { dataClass: 'internal' },
    },
    select: {
      id: true,
      tenantId: true,
      scopeRefId: true,
      dataClass: true,
      status: true,
    },
  });

  console.log(`Кандидатов: ${candidates.length}`);
  if (candidates.length === 0) {
    console.log('Все role-personas уже dataClass=internal — нет работы. END.');
    await prisma.$disconnect();
    return;
  }

  let updated = 0;
  for (const c of candidates) {
    console.log(
      `  persona=${c.id} tenant=${c.tenantId} role=${c.scopeRefId ?? '(null)'}: dataClass ${c.dataClass} → internal`,
    );
    if (!opts.dryRun) {
      await prisma.executablePersona.update({
        where: { id: c.id },
        data: { dataClass: 'internal' },
      });
      updated += 1;
    }
  }

  console.log(
    `=== patch-clones-dataclass-update END (updated=${updated}, dry-run=${opts.dryRun}) ===`,
  );
  await prisma.$disconnect();
}

main().catch(async (err: unknown) => {
  console.error('patch-clones-dataclass-update FATAL:', err);
  await prisma.$disconnect();
  process.exit(1);
});
