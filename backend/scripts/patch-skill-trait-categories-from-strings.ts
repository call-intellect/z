/**
 * Patch (SBA γ-1 доделки) — миграция SkillTrait.category (legacy string)
 * → SkillTraitCategory FK.
 *
 * Логика:
 *   1. Для каждого Org:
 *      a. SELECT DISTINCT category FROM SkillTrait WHERE category IS NOT NULL
 *         AND categoryId IS NULL AND profile.tenantId = <org>.
 *      b. Для каждой уникальной строки:
 *          - slug = slugify(name).
 *          - UPSERT SkillTraitCategory(tenantId, name, slug).
 *          - UPDATE SkillTrait SET categoryId = newCategory.id
 *            WHERE category = <name> AND categoryId IS NULL AND profileId IN (...).
 *   2. Лог: N categories created, M traits linked.
 *
 * Идемпотентно: повторный запуск увидит уже привязанные traits и пропустит.
 * Не перезаписывает admin-edited записи — UPSERT идёт по уникальному (tenantId, slug),
 * без перезаписи name/description у существующих категорий.
 *
 * Запуск:
 *   bun run scripts/patch-skill-trait-categories-from-strings.ts
 *   bun run scripts/patch-skill-trait-categories-from-strings.ts --dry-run
 */

import { PrismaClient } from '@prisma/client';

import { SkillTraitCategoryService } from '../src/modules/skills/services/skill-trait-categories.service';

const DRY_RUN = process.argv.includes('--dry-run');

interface OrgCounters {
  orgId: string;
  uniqueCategoriesFound: number;
  categoriesCreated: number;
  categoriesReused: number;
  traitsLinked: number;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  // Локальный slugify — берём из SkillTraitCategoryService.prototype.slugify
  // через instance с заглушками (нам нужна только чистая функция).
  const slugifyHelper = new SkillTraitCategoryService(
    prisma as never,
    { log: () => Promise.resolve() } as never,
    { setSkillCategoriesTotal: () => undefined } as never,
  );

  const counters: OrgCounters[] = [];

  try {
    /* eslint-disable no-console */
    console.log(
      `=== patch-skill-trait-categories-from-strings START (${DRY_RUN ? 'DRY-RUN' : 'REAL'}) ===`,
    );

    const orgs = await prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    console.log(`Найдено орг'ов: ${orgs.length}`);

    for (const org of orgs) {
      const orgCounters: OrgCounters = {
        orgId: org.id,
        uniqueCategoriesFound: 0,
        categoriesCreated: 0,
        categoriesReused: 0,
        traitsLinked: 0,
      };

      // Уникальные не-пустые legacy строки.
      const raw = await prisma.skillTrait.findMany({
        where: {
          categoryId: null,
          category: { not: '' },
          profile: { tenantId: org.id },
        },
        select: { category: true },
        distinct: ['category'],
      });
      const uniqueNames = [
        ...new Set(raw.map((r) => r.category.trim()).filter(Boolean)),
      ];
      orgCounters.uniqueCategoriesFound = uniqueNames.length;

      for (const name of uniqueNames) {
        const slug = slugifyHelper.slugify(name);
        let categoryId: string | null = null;

        if (DRY_RUN) {
          orgCounters.categoriesCreated++; // условно — для оценки
          continue;
        }

        try {
          const existing = await prisma.skillTraitCategory.findUnique({
            where: { tenantId_slug: { tenantId: org.id, slug } },
            select: { id: true },
          });
          if (existing) {
            categoryId = existing.id;
            orgCounters.categoriesReused++;
          } else {
            const created = await prisma.skillTraitCategory.create({
              data: {
                tenantId: org.id,
                name,
                slug,
              },
              select: { id: true },
            });
            categoryId = created.id;
            orgCounters.categoriesCreated++;
          }
        } catch (err) {
          // Race: возможна параллельная вставка — повторный read.
          console.warn(
            `[org ${org.id}] upsert категории "${name}" (slug=${slug}) упал, retry-read:`,
            err instanceof Error ? err.message : String(err),
          );
          const retry = await prisma.skillTraitCategory.findUnique({
            where: { tenantId_slug: { tenantId: org.id, slug } },
            select: { id: true },
          });
          if (retry) {
            categoryId = retry.id;
            orgCounters.categoriesReused++;
          } else {
            continue;
          }
        }

        // Линк traits батчем 500.
        const BATCH = 500;
        let totalLinked = 0;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const linkBatch = await prisma.skillTrait.updateMany({
            where: {
              categoryId: null,
              category: name,
              profile: { tenantId: org.id },
            },
            data: { categoryId },
          });
          totalLinked += linkBatch.count;
          if (linkBatch.count < BATCH) break;
        }
        orgCounters.traitsLinked += totalLinked;
      }

      counters.push(orgCounters);
      console.log(
        `  [${org.id}] uniqueCategories=${orgCounters.uniqueCategoriesFound} created=${orgCounters.categoriesCreated} reused=${orgCounters.categoriesReused} traitsLinked=${orgCounters.traitsLinked}`,
      );
    }

    const totals = counters.reduce(
      (acc, c) => ({
        uniqueCategoriesFound:
          acc.uniqueCategoriesFound + c.uniqueCategoriesFound,
        categoriesCreated: acc.categoriesCreated + c.categoriesCreated,
        categoriesReused: acc.categoriesReused + c.categoriesReused,
        traitsLinked: acc.traitsLinked + c.traitsLinked,
      }),
      {
        uniqueCategoriesFound: 0,
        categoriesCreated: 0,
        categoriesReused: 0,
        traitsLinked: 0,
      },
    );

    console.log('=== Итоги patch-skill-trait-categories-from-strings ===');
    console.log(`  orgsProcessed         : ${counters.length}`);
    console.log(`  uniqueCategoriesFound : ${totals.uniqueCategoriesFound}`);
    console.log(`  categoriesCreated     : ${totals.categoriesCreated}`);
    console.log(`  categoriesReused      : ${totals.categoriesReused}`);
    console.log(`  traitsLinked          : ${totals.traitsLinked}`);
    console.log(`  mode                  : ${DRY_RUN ? 'DRY-RUN' : 'REAL'}`);
    /* eslint-enable no-console */
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('patch-skill-trait-categories-from-strings FAILED:', err);
  process.exit(1);
});
