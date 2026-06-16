/* eslint-disable no-console */

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { SkillTraitConceptService } from '../src/modules/knowledge-core/services/skill-trait-concept.service';
import { SkillTraitConceptNormalizerCron } from '../src/modules/knowledge-core/workers/skill-trait-concept-normalizer.cron';

interface BackfillStats {
  orgsScanned: number;
  traitsProcessed: number;
  conceptsCreated: number;
  conceptsReused: number;
  failed: number;
}

async function main(): Promise<void> {
  console.log('=== skill-trait-concepts-backfill START ===');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const prisma = app.get(PrismaService);
    const concepts = app.get(SkillTraitConceptService);
    const cron = app.get(SkillTraitConceptNormalizerCron);

    const orgs = await prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
    });

    const stats: BackfillStats = {
      orgsScanned: 0,
      traitsProcessed: 0,
      conceptsCreated: 0,
      conceptsReused: 0,
      failed: 0,
    };

    for (const org of orgs) {
      stats.orgsScanned++;
      const traits = await prisma.skillTrait.findMany({
        where: {
          conceptId: null,
          status: 'active',
          profile: { tenantId: org.id },
        },
        select: { id: true, category: true, statement: true },
      });
      console.log(
        `[org=${org.id}] ${org.name ?? '(без имени)'}: traits без conceptId = ${traits.length}`,
      );
      let createdInOrg = 0;
      let reusedInOrg = 0;
      for (const t of traits) {
        try {
          const beforeCount = await prisma.skillTraitConcept.count({
            where: { tenantId: org.id, status: 'active' },
          });
          const concept = await concepts.findOrCreateConcept({
            tenantId: org.id,
            category: t.category,
            statement: t.statement,
          });
          if (!concept) {
            stats.failed++;
            continue;
          }
          const afterCount = await prisma.skillTraitConcept.count({
            where: { tenantId: org.id, status: 'active' },
          });
          if (afterCount > beforeCount) {
            createdInOrg++;
            stats.conceptsCreated++;
          } else {
            reusedInOrg++;
            stats.conceptsReused++;
          }
          await prisma.skillTrait.update({
            where: { id: t.id },
            data: { conceptId: concept.id },
          });
          stats.traitsProcessed++;
        } catch (err) {
          stats.failed++;
          console.warn(
            `[org=${org.id}] trait=${t.id} — ошибка: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      console.log(
        `[org=${org.id}] обработано traits=${traits.length}, новых концептов=${createdInOrg}, переиспользовано=${reusedInOrg}`,
      );
    }

    console.log('=== Запускаю cron-нормализатор после бэкфилла ===');
    try {
      const cronSummary = await cron.runOnce();
      console.log('cron-нормализатор:', cronSummary);
    } catch (err) {
      console.warn(
        `cron-нормализатор после бэкфилла упал: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    console.log(
      `=== skill-trait-concepts-backfill DONE: orgs=${stats.orgsScanned}, traits=${stats.traitsProcessed}, новых концептов=${stats.conceptsCreated}, переиспользовано=${stats.conceptsReused}, failed=${stats.failed} ===`,
    );
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('skill-trait-concepts-backfill FAILED:', err);
    process.exit(1);
  });
