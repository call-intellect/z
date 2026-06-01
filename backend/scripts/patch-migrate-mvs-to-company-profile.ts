/**
 * SBA α-9 wave 3 — patch-migrate Mission/Vision/Strategy → CompanyProfile.
 *
 * Логика:
 *   - Для каждой Org с не-null Mission/Vision/Strategy:
 *     - Upsert CompanyProfile с tenantId.
 *     - Если в Mission есть `contentMd` — переносим в `missionJson`
 *       (только если `missionJson` пуст; admin-edited не перезаписываем).
 *     - То же для Vision/Strategy.
 *   - Mission/Vision/Strategy в БД ОСТАЮТСЯ (deprecated, не удаляются).
 *
 * Запуск:
 *   bun run scripts/patch-migrate-mvs-to-company-profile.ts            (dry-run, по умолчанию)
 *   bun run scripts/patch-migrate-mvs-to-company-profile.ts --apply    (реальная миграция)
 *
 * Идемпотентно: повторный запуск ничего не делает, если данные уже мигрированы.
 *
 * NB: безопасный seed-rules — НЕ перезаписываем existing JSON-поля
 * (administrator мог уже отредактировать через UI после первой миграции).
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';
import { tableExists } from './_lib/schema-guards';

const APPLY = process.argv.includes('--apply');
const prisma = createPrismaClient();

interface Counters {
  orgsScanned: number;
  profilesCreated: number;
  missionsMigrated: number;
  missionsSkippedFilled: number;
  visionsMigrated: number;
  visionsSkippedFilled: number;
  strategiesMigrated: number;
  strategiesSkippedFilled: number;
  orgsNoMvs: number;
}

async function main(): Promise<void> {
  const counters: Counters = {
    orgsScanned: 0,
    profilesCreated: 0,
    missionsMigrated: 0,
    missionsSkippedFilled: 0,
    visionsMigrated: 0,
    visionsSkippedFilled: 0,
    strategiesMigrated: 0,
    strategiesSkippedFilled: 0,
    orgsNoMvs: 0,
  };

  /* eslint-disable no-console */
  console.log(
    `=== patch-migrate-mvs-to-company-profile START (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===`,
  );

  // Guard: legacy-модели Mission/Vision/Strategy планово удаляются после
  // переноса в CompanyProfile. Если их таблиц уже нет — обращение к
  // prisma.mission/vision/strategy упало бы. Выходим чисто.
  const [hasMission, hasVision, hasStrategy] = await Promise.all([
    tableExists(prisma, 'Mission'),
    tableExists(prisma, 'Vision'),
    tableExists(prisma, 'Strategy'),
  ]);
  if (!hasMission && !hasVision && !hasStrategy) {
    console.log(
      'Таблицы Mission/Vision/Strategy удалены — миграция в CompanyProfile применена ранее, обновление не требуется.',
    );
    return;
  }

  const orgs = await prisma.org.findMany({ select: { id: true } });
  for (const org of orgs) {
    counters.orgsScanned++;

    const [mission, vision, strategy, existingProfile] = await Promise.all([
      prisma.mission.findFirst({
        where: { tenantId: org.id },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.vision.findFirst({
        where: { tenantId: org.id },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.strategy.findFirst({
        where: { tenantId: org.id },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.companyProfile.findUnique({ where: { tenantId: org.id } }),
    ]);

    if (!mission && !vision && !strategy && !existingProfile) {
      counters.orgsNoMvs++;
      continue;
    }

    let profile = existingProfile;
    if (!profile) {
      if (APPLY) {
        profile = await prisma.companyProfile.create({
          data: { tenantId: org.id },
        });
      } else {
        // dry-run — представим виртуальный профиль с пустыми JSON.
        profile = {
          id: '(dry-run)',
          tenantId: org.id,
          displayName: null,
          missionJson: null,
          visionJson: null,
          strategyJson: null,
          targetMarketIds: [],
          maturityScore: null,
          lastMaturityCalcAt: null,
          stage: null,
          sourceBlockIds: [],
          confidence: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }
      counters.profilesCreated++;
    }

    const updateData: Prisma.CompanyProfileUpdateInput = {};

    if (mission) {
      if (isJsonFilled(profile.missionJson)) {
        counters.missionsSkippedFilled++;
      } else {
        updateData.missionJson = {
          contentMd: mission.contentMd,
          horizon: mission.horizon,
          ...(mission.targetDate
            ? { targetDate: mission.targetDate.toISOString() }
            : {}),
        } satisfies Prisma.InputJsonValue;
        counters.missionsMigrated++;
      }
    }
    if (vision) {
      if (isJsonFilled(profile.visionJson)) {
        counters.visionsSkippedFilled++;
      } else {
        updateData.visionJson = {
          contentMd: vision.contentMd,
          ...(vision.horizonYears !== null
            ? { horizonYears: vision.horizonYears }
            : {}),
          ...(vision.targetDate
            ? { targetDate: vision.targetDate.toISOString() }
            : {}),
        } satisfies Prisma.InputJsonValue;
        counters.visionsMigrated++;
      }
    }
    if (strategy) {
      if (isJsonFilled(profile.strategyJson)) {
        counters.strategiesSkippedFilled++;
      } else {
        updateData.strategyJson = {
          contentMd: strategy.contentMd,
          markets: jsonAsStringArray(strategy.markets),
          bets: jsonAsStringArray(strategy.bets),
          horizon: strategy.horizon,
          ...(strategy.targetDate
            ? { targetDate: strategy.targetDate.toISOString() }
            : {}),
        } satisfies Prisma.InputJsonValue;
        counters.strategiesMigrated++;
      }
    }

    if (Object.keys(updateData).length > 0 && APPLY) {
      await prisma.companyProfile.update({
        where: { tenantId: org.id },
        data: updateData,
      });
    }
  }

  console.log('=== Итоги patch-migrate-mvs-to-company-profile ===');
  console.log(`  mode                    : ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`  orgsScanned             : ${counters.orgsScanned}`);
  console.log(`  orgsNoMvs               : ${counters.orgsNoMvs}`);
  console.log(`  profilesCreated         : ${counters.profilesCreated}`);
  console.log(`  missionsMigrated        : ${counters.missionsMigrated}`);
  console.log(`  missionsSkippedFilled   : ${counters.missionsSkippedFilled}`);
  console.log(`  visionsMigrated         : ${counters.visionsMigrated}`);
  console.log(`  visionsSkippedFilled    : ${counters.visionsSkippedFilled}`);
  console.log(`  strategiesMigrated      : ${counters.strategiesMigrated}`);
  console.log(`  strategiesSkippedFilled : ${counters.strategiesSkippedFilled}`);
  if (!APPLY) {
    console.log('\n  Чтобы применить миграцию — перезапусти с флагом --apply');
  }
  /* eslint-enable no-console */
}

function isJsonFilled(json: Prisma.JsonValue | null): boolean {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return false;
  const obj = json as Record<string, unknown>;
  const v = obj.contentMd;
  return typeof v === 'string' && v.trim().length > 0;
}

function jsonAsStringArray(json: Prisma.JsonValue): string[] {
  if (!json || !Array.isArray(json)) return [];
  return json.filter((v): v is string => typeof v === 'string');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('patch-migrate-mvs-to-company-profile FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
