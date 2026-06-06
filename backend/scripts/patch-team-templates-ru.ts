/**
 * Tracker A5 — one-off patch script (русификация ролей шаблона продаж).
 *
 * Применяет к УЖЕ засеянным записям `TeamTemplate` те же две замены, что
 * внесены в исходник сидов (`src/modules/tracker/seed/team-templates-data.ts`):
 *   - «Специалист по квалификации (SDR)» → «Специалист по квалификации»
 *   - «Квалифицирует входящие заявки по BANT/CHAMP»
 *       → «Квалифицирует входящие заявки по методике квалификации»
 *
 * `definition` — JSON-колонка с `{ roles[], states[], ... }`, admin-editable.
 * Замена сургичная и строковая: сериализуем JSON, делаем replaceAll по двум
 * подстрокам и парсим обратно. Затрагиваются ТОЛЬКО эти две подстроки —
 * любые другие admin-правки сохраняются как есть.
 *
 * Покрываем все записи (без фильтра по tenantId): системные (tenantId=null)
 * и любые tenant-копии шаблона.
 *
 * Запуск:
 *   bun run scripts/patch-team-templates-ru.ts
 *   bun run scripts/patch-team-templates-ru.ts --dry-run   # только посчитать
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - При повторном запуске старых подстрок уже нет → 0 patched.
 *   - Можно запускать многократно — итог один и тот же.
 *
 * Регистрация: apply-prod-deploy.ts (phase: 'patch', skipBootstrap: true).
 * После пуша на прод запустить ВРУЧНУЮ один раз (через агрегатор или напрямую):
 *   bun run scripts/patch-team-templates-ru.ts
 */

import { Prisma } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const REPLACEMENTS: Array<[string, string]> = [
  ['Специалист по квалификации (SDR)', 'Специалист по квалификации'],
  [
    'Квалифицирует входящие заявки по BANT/CHAMP',
    'Квалифицирует входящие заявки по методике квалификации',
  ],
];

const DRY_RUN = process.argv.includes('--dry-run');

interface PatchStats {
  scanned: number;
  patched: number;
  alreadyOk: number;
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(
    `=== patch-team-templates-ru START${DRY_RUN ? ' (dry-run)' : ''} ===`,
  );

  const stats: PatchStats = { scanned: 0, patched: 0, alreadyOk: 0 };

  const templates = await prisma.teamTemplate.findMany({
    select: { id: true, definition: true },
  });
  // eslint-disable-next-line no-console
  console.log(`TeamTemplate в БД: ${templates.length}`);

  for (const tpl of templates) {
    stats.scanned++;
    const original = JSON.stringify(tpl.definition);
    let json = original;
    for (const [oldStr, newStr] of REPLACEMENTS) {
      json = json.split(oldStr).join(newStr);
    }

    if (json === original) {
      stats.alreadyOk++;
      continue;
    }

    stats.patched++;
    if (DRY_RUN) {
      // eslint-disable-next-line no-console
      console.log(`[dry-run] would patch ${tpl.id}`);
      continue;
    }

    await prisma.teamTemplate.update({
      where: { id: tpl.id },
      data: { definition: JSON.parse(json) as Prisma.InputJsonValue },
    });
    // eslint-disable-next-line no-console
    console.log(`[patch] ${tpl.id}`);
  }

  // eslint-disable-next-line no-console
  console.log(
    `scanned=${stats.scanned}, patched=${stats.patched}, already_ok=${stats.alreadyOk}`,
  );
  // eslint-disable-next-line no-console
  console.log(`=== patch-team-templates-ru DONE${DRY_RUN ? ' (dry-run)' : ''} ===`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('patch-team-templates-ru FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
