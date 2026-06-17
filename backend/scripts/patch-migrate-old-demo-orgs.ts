import { createPrismaClient } from './_lib/prisma';
import { resetDemoWorkspace } from './seed-demo-workspace';

const prisma = createPrismaClient();

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  // eslint-disable-next-line no-console
  console.log(`=== patch-migrate-old-demo-orgs START (dryRun=${dryRun}) ===`);

  const demoOrgId = process.env['ZDEMO_ORG_ID'];
  if (!demoOrgId) {
    // eslint-disable-next-line no-console
    console.warn(
      '[warn] ZDEMO_ORG_ID не задан в ENV — миграция не подключит наблюдателей. Сначала запусти patch-create-reference-demo-org.ts и положи ZDEMO_ORG_ID в .env.',
    );
  }

  const oldDemoOrgs = await prisma.org.findMany({
    where: {
      demoWorkspaceSeededAt: { not: null },
      isReferenceDemo: false,
      deletedAt: null,
    },
    select: { id: true, name: true, ownerId: true },
  });

  // eslint-disable-next-line no-console
  console.log(`[count] Старых «копий ТехноСтрим»: ${oldDemoOrgs.length}`);
  if (oldDemoOrgs.length === 0) {
    // eslint-disable-next-line no-console
    console.log('[skip] Нечего мигрировать — выходим.');
    return;
  }

  let cleaned = 0;
  let skippedAlive = 0;
  let attachedObservers = 0;
  let observerSkipped = 0;

  for (const org of oldDemoOrgs) {
    const realMeetings = await prisma.meeting.count({
      where: {
        tenantId: org.id,
        roomName: { not: { startsWith: 'demo-room-' } },
      },
    });
    const realPersons = await prisma.person.count({
      where: {
        tenantId: org.id,
        OR: [{ externalSource: null }, { externalSource: { not: 'demo' } }],
      },
    });
    if (realMeetings > 0 || realPersons > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[skip-alive] Org ${org.id} (${org.name}): найдено ${realMeetings} реальных meetings + ${realPersons} реальных persons — НЕ трогаем`,
      );
      skippedAlive++;
      continue;
    }

    if (dryRun) {
      // eslint-disable-next-line no-console
      console.log(
        `[dry-run] Будет очищена Org ${org.id} (${org.name}); owner=${org.ownerId} прикреплён к эталону`,
      );
      continue;
    }

    // eslint-disable-next-line no-console
    console.log(`[cleanup] Org ${org.id} (${org.name})...`);
    await resetDemoWorkspace(prisma, org.id);
    cleaned++;

    if (demoOrgId) {
      try {
        const exists = await prisma.membership.findUnique({
          where: { orgId_userId: { orgId: demoOrgId, userId: org.ownerId } },
          select: { id: true },
        });
        if (!exists) {
          await prisma.membership.create({
            data: {
              userId: org.ownerId,
              orgId: demoOrgId,
              role: 'demo_observer',
              invitedBy: null,
              joinedAt: new Date(),
            },
          });
          attachedObservers++;
        } else {
          observerSkipped++;
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[err] Не удалось прикрепить owner=${org.ownerId} к эталону:`, err);
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log('\n=== STATS ===');
  // eslint-disable-next-line no-console
  console.log(`  Очищено Org:                        ${cleaned}`);
  // eslint-disable-next-line no-console
  console.log(`  Пропущено (обжитые):                ${skippedAlive}`);
  // eslint-disable-next-line no-console
  console.log(`  Owner'ов прикреплено наблюдателями: ${attachedObservers}`);
  // eslint-disable-next-line no-console
  console.log(`  Уже были наблюдателями:             ${observerSkipped}`);
  // eslint-disable-next-line no-console
  console.log('=== patch-migrate-old-demo-orgs DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('patch-migrate-old-demo-orgs FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });
