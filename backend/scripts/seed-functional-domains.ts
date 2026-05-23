/**
 * SBA α-9 wave 3 — seed скрипт для FunctionalDomain.
 *
 * Поведение:
 *   - Без аргумента — сидим 8 базовых доменов для каждой Org в БД.
 *   - С аргументом `--tenant <orgId>` — только для одной Org.
 *   - С аргументом `--industry <slug>` — дополнительно создаются per-industry домены.
 *
 * Безопасный seed (skill `safe-seed-rules`):
 *   - Только INSERT через `upsert`-логику (по `(tenantId, slug)`).
 *   - Существующие записи (даже отредактированные admin'ом) НЕ обновляются.
 *   - `isSystem=true` — пометка «seed»; пользовательские домены создаются
 *     через REST API с `isSystem=false`.
 *
 * Запуск:
 *   bun run scripts/seed-functional-domains.ts
 *   bun run scripts/seed-functional-domains.ts --tenant <orgId>
 *   bun run scripts/seed-functional-domains.ts --tenant <orgId> --industry saas
 */

import { PrismaClient } from '@prisma/client';

import {
  BASE_FUNCTIONAL_DOMAINS,
  INDUSTRY_DOMAIN_TEMPLATES,
  type IndustrySlug,
} from '../src/modules/company-foundation/services/functional-domain.seeds';

const prisma = new PrismaClient();

interface Stats {
  orgsScanned: number;
  baseCreated: number;
  baseSkipped: number;
  industryCreated: number;
  industrySkipped: number;
}

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return undefined;
}

async function seedForTenant(args: {
  tenantId: string;
  industry?: IndustrySlug;
}): Promise<{
  baseCreated: number;
  baseSkipped: number;
  industryCreated: number;
  industrySkipped: number;
}> {
  let baseCreated = 0;
  let baseSkipped = 0;
  let industryCreated = 0;
  let industrySkipped = 0;

  // 1. Базовые 8.
  for (const it of BASE_FUNCTIONAL_DOMAINS) {
    const exists = await prisma.functionalDomain.findUnique({
      where: { tenantId_slug: { tenantId: args.tenantId, slug: it.slug } },
    });
    if (exists) {
      baseSkipped++;
      continue;
    }
    await prisma.functionalDomain.create({
      data: {
        tenantId: args.tenantId,
        name: it.name,
        slug: it.slug,
        description: it.description ?? null,
        iconName: it.iconName ?? null,
        order: it.order ?? 0,
        isSystem: true,
      },
    });
    baseCreated++;
  }

  // 2. Per-industry надстройка.
  if (args.industry) {
    const tpl = INDUSTRY_DOMAIN_TEMPLATES[args.industry];
    if (tpl) {
      const baseRows = await prisma.functionalDomain.findMany({
        where: {
          tenantId: args.tenantId,
          slug: { in: BASE_FUNCTIONAL_DOMAINS.map((b) => b.slug) },
        },
        select: { id: true, slug: true },
      });
      const idBySlug = new Map(baseRows.map((r) => [r.slug, r.id]));
      for (const it of tpl) {
        const exists = await prisma.functionalDomain.findUnique({
          where: { tenantId_slug: { tenantId: args.tenantId, slug: it.slug } },
        });
        if (exists) {
          industrySkipped++;
          continue;
        }
        const parentId = it.parentSlug ? idBySlug.get(it.parentSlug) ?? null : null;
        await prisma.functionalDomain.create({
          data: {
            tenantId: args.tenantId,
            name: it.name,
            slug: it.slug,
            description: it.description ?? null,
            iconName: it.iconName ?? null,
            parentDomainId: parentId,
            order: it.order ?? 10,
            isSystem: true,
          },
        });
        industryCreated++;
      }
    }
  }

  return { baseCreated, baseSkipped, industryCreated, industrySkipped };
}

async function main(): Promise<void> {
  const tenantArg = getArg('tenant');
  const industryArg = getArg('industry') as IndustrySlug | undefined;

  if (industryArg && !INDUSTRY_DOMAIN_TEMPLATES[industryArg]) {
    // eslint-disable-next-line no-console
    console.error(
      `Неизвестная industry: ${industryArg}. Доступны: ${Object.keys(INDUSTRY_DOMAIN_TEMPLATES).join(', ')}`,
    );
    process.exit(1);
  }

  const stats: Stats = {
    orgsScanned: 0,
    baseCreated: 0,
    baseSkipped: 0,
    industryCreated: 0,
    industrySkipped: 0,
  };

  /* eslint-disable no-console */
  console.log(
    `=== seed-functional-domains START (tenant=${tenantArg ?? 'ALL'}, industry=${industryArg ?? 'none'}) ===`,
  );

  const tenantIds: string[] = [];
  if (tenantArg) {
    const org = await prisma.org.findUnique({
      where: { id: tenantArg },
      select: { id: true },
    });
    if (!org) {
      console.error(`Org ${tenantArg} не найдена`);
      process.exit(1);
    }
    tenantIds.push(org.id);
  } else {
    const orgs = await prisma.org.findMany({ select: { id: true } });
    for (const o of orgs) tenantIds.push(o.id);
  }

  for (const tId of tenantIds) {
    stats.orgsScanned++;
    const r = await seedForTenant({ tenantId: tId, industry: industryArg });
    stats.baseCreated += r.baseCreated;
    stats.baseSkipped += r.baseSkipped;
    stats.industryCreated += r.industryCreated;
    stats.industrySkipped += r.industrySkipped;
    console.log(
      `  org=${tId}: base ${r.baseCreated} created / ${r.baseSkipped} skipped, industry ${r.industryCreated}/${r.industrySkipped}`,
    );
  }

  console.log('=== Итоги seed-functional-domains ===');
  console.log(`  orgsScanned     : ${stats.orgsScanned}`);
  console.log(`  baseCreated     : ${stats.baseCreated}`);
  console.log(`  baseSkipped     : ${stats.baseSkipped}`);
  console.log(`  industryCreated : ${stats.industryCreated}`);
  console.log(`  industrySkipped : ${stats.industrySkipped}`);
  console.log('=== seed-functional-domains DONE ===');
  /* eslint-enable no-console */
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-functional-domains FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
