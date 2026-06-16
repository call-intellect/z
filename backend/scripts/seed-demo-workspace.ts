import type { PrismaClient } from '@prisma/client';

import { runAllSeedSteps } from '../src/modules/onboarding/demo-data';
import { markAllDemoEntitiesForTenant } from '../src/modules/onboarding/demo-data/mark-demo';
import {
  createEmptyIdMap,
  type IdMap,
  type SeedContext,
} from '../src/modules/onboarding/demo-data/types';

import { createPrismaClient } from './_lib/prisma';

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

async function ensureOrgEligibleForDemoSeed(
  prisma: PrismaClient,
  tenantId: string,
  options: { force?: boolean },
): Promise<{ skip: boolean; reason?: string }> {
  const org = await prisma.org.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, demoWorkspaceSeededAt: true },
  });
  if (!org) {
    return { skip: true, reason: `Org ${tenantId} не найдена` };
  }
  if (org.demoWorkspaceSeededAt != null) {
    return {
      skip: true,
      reason: `Org ${tenantId} (${org.name}) уже сидирована демо-данными в ${org.demoWorkspaceSeededAt.toISOString()} — пропуск (идемпотентность)`,
    };
  }
  if (options.force) {
    console.warn(
      `⚠ --force: пропускаем проверку «свежей Org». Демо-данные могут пересечься с production-данными в ${tenantId}.`,
    );
    return { skip: false };
  }
  const [nonDemoPersons, nonDemoProjects] = await Promise.all([
    prisma.person.count({
      where: {
        tenantId,
        OR: [{ externalSource: null }, { externalSource: { not: 'demo' } }],
      },
    }),
    prisma.project.count({
      where: {
        tenantId,
        OR: [{ externalSource: null }, { externalSource: { not: 'demo' } }],
      },
    }),
  ]);
  if (nonDemoPersons > 0 || nonDemoProjects > 0) {
    return {
      skip: true,
      reason: `Org ${tenantId} (${org.name}) НЕ свежая: найдено ${nonDemoPersons} не-demo Person'ов и ${nonDemoProjects} не-demo Project'ов. Передайте --force чтобы переопределить (опасно).`,
    };
  }
  return { skip: false };
}

async function seedDemoWorkspace(
  prisma: PrismaClient,
  tenantId: string,
  ownerUserId: string,
  options: { force?: boolean } = {},
): Promise<{
  skipped?: boolean;
  reason?: string;
  [key: string]: number | string | boolean | undefined;
}> {
  const eligibility = await ensureOrgEligibleForDemoSeed(prisma, tenantId, options);
  if (eligibility.skip) {
    console.log(`⏭ ${eligibility.reason}`);
    return { skipped: true, reason: eligibility.reason };
  }
  const ids: IdMap = createEmptyIdMap();
  const ctx: SeedContext = { prisma, tenantId, ownerUserId };

  await runAllSeedSteps(ctx, ids, (step, i, total) => {
    console.log(`── [${i + 1}/${total}] ${step.label} (${step.key}) ──`);
  });

  const marked = await markAllDemoEntitiesForTenant(prisma, tenantId);
  console.log(`── externalSource='demo' проставлен: updated=${marked.updated} ──`);

  await prisma.org.update({
    where: { id: tenantId },
    data: { demoWorkspaceSeededAt: new Date() },
  });

  const stats = {
    departmentsCreated: Object.keys(ids.departments).length,
    personsCreated: Object.keys(ids.persons).length,
    projectsCreated: Object.keys(ids.projects).length,
    issuesCreated: Object.keys(ids.issues).length,
    meetingsCreated: Object.keys(ids.meetings).length,
    ideaBlocksCreated: Object.keys(ids.ideaBlocks).length,
    entitiesCreated: Object.keys(ids.entities).length,
    themesCreated: Object.keys(ids.themes).length,
    goalsCreated: Object.keys(ids.goals).length,
    clonesCreated: Object.keys(ids.skillProfiles).length,
    regulationsCreated: Object.keys(ids.regulations).length,
    ideasCreated: Object.keys(ids.ideas).length,
    documentsCreated: Object.keys(ids.documents).length,
    eventsCreated: Object.keys(ids.events).length,
    feedbackMessagesCreated: Object.keys(ids.feedbackMessages).length,
    experimentsCreated: Object.keys(ids.experiments).length,
    probeEventsCreated: Object.keys(ids.probeEvents).length,
  };

  console.log('\n=== Демо-воркспейс «ТехноСтрим» успешно создан ===');
  console.log(JSON.stringify(stats, null, 2));

  return stats;
}

export async function resetDemoWorkspace(prisma: PrismaClient, tenantId: string): Promise<void> {
  console.log(`Сброс демо-данных для tenant ${tenantId}...`);

  await prisma.issueActivity.deleteMany({ where: { tenantId, issue: { externalSource: 'demo' } } });
  await prisma.issueComment.deleteMany({
    where: { issue: { tenantId, externalSource: 'demo' } },
  });
  await prisma.issueChecklistItem.deleteMany({
    where: { checklist: { tenantId, issue: { externalSource: 'demo' } } },
  });
  await prisma.issueChecklist.deleteMany({
    where: { tenantId, issue: { externalSource: 'demo' } },
  });
  await prisma.issueLabel.deleteMany({ where: { issue: { project: { tenantId } } } });
  await prisma.issueAssignee.deleteMany({ where: { issue: { project: { tenantId } } } });
  await prisma.issueRelation.deleteMany({ where: { source: { project: { tenantId } } } });
  await prisma.sprintHint.deleteMany({ where: { tenantId } });
  await prisma.issue.deleteMany({ where: { tenantId, externalSource: 'demo' } });

  await prisma.meetingParticipantBehavior.deleteMany({ where: { tenantId } });
  await prisma.meetingBehaviorMetrics.deleteMany({ where: { meeting: { tenantId } } });
  await prisma.meetingQualityScore.deleteMany({ where: { meeting: { tenantId } } });
  await prisma.meetingChapter.deleteMany({ where: { meeting: { tenantId } } });
  await prisma.transcriptTrack.deleteMany({ where: { transcript: { meeting: { tenantId } } } });
  await prisma.transcript.deleteMany({ where: { meeting: { tenantId } } });
  await prisma.aiResult.deleteMany({ where: { meeting: { tenantId } } });
  await prisma.participant.deleteMany({ where: { meeting: { tenantId } } });
  await prisma.meeting.deleteMany({ where: { tenantId, roomName: { startsWith: 'demo-room-' } } });

  await prisma.themeIdeaBlock.deleteMany({ where: { theme: { tenantId } } });
  await prisma.themeEntity.deleteMany({ where: { theme: { tenantId } } });
  await prisma.ideaBlockLink.deleteMany({ where: { tenantId } });
  await prisma.entityLink.deleteMany({ where: { tenantId } });
  await prisma.ideaBlock.deleteMany({ where: { tenantId } });
  await prisma.entity.deleteMany({ where: { tenantId } });
  await prisma.theme.deleteMany({ where: { tenantId } });

  await prisma.goalAlignmentSnapshot.deleteMany({ where: { tenantId } });
  await prisma.goalTheme.deleteMany({ where: { goal: { tenantId } } });
  await prisma.goal.deleteMany({ where: { tenantId } });

  await prisma.executablePersona.deleteMany({ where: { tenantId } });
  await prisma.skillTrait.deleteMany({ where: { profile: { tenantId } } });
  await prisma.skillProfile.deleteMany({ where: { tenantId } });
  await prisma.cloneAccessGrant.deleteMany({ where: { tenantId } });

  await prisma.dailyCheckIn.deleteMany({ where: { tenantId } });
  await prisma.weeklyOperationsDigest.deleteMany({ where: { tenantId } });
  await prisma.dailyOperationsDigest.deleteMany({ where: { tenantId } });

  await prisma.chatV2Message.deleteMany({ where: { conversation: { tenantId } } });
  await prisma.chatV2Conversation.deleteMany({ where: { tenantId } });
  await prisma.notification.deleteMany({ where: { tenantId } });

  await prisma.recognition.deleteMany({ where: { tenantId } });
  await prisma.helpfulnessSpotlight.deleteMany({ where: { tenantId } });
  await prisma.userBadge.deleteMany({});
  await prisma.card.deleteMany({ where: { tenantId } });
  await prisma.processStep.deleteMany({ where: { tenantId } });
  await prisma.process.deleteMany({ where: { tenantId } });
  await prisma.insight.deleteMany({ where: { tenantId } });
  await prisma.decision.deleteMany({ where: { tenantId } });

  await prisma.appointment.deleteMany({ where: { tenantId } });
  await prisma.person.deleteMany({ where: { tenantId } });
  await prisma.role.deleteMany({ where: { tenantId } });
  await prisma.department.deleteMany({ where: { tenantId } });
  await prisma.companyProfile.deleteMany({ where: { tenantId } });
  await prisma.functionalDomain.deleteMany({ where: { tenantId } });

  await prisma.projectDocument.deleteMany({ where: { tenantId } });
  await prisma.board.deleteMany({ where: { project: { tenantId } } });
  await prisma.issueState.deleteMany({ where: { tenantId } });
  await prisma.cycle.deleteMany({ where: { tenantId } });
  await prisma.label.deleteMany({ where: { project: { tenantId } } });
  await prisma.project.deleteMany({ where: { tenantId } });

  await prisma.org.update({
    where: { id: tenantId },
    data: { demoWorkspaceSeededAt: null },
  });

  console.log('Демо-данные удалены.');
}

async function main() {
  const tenantId = getArg('tenant');
  const ownerUserId = getArg('owner');
  const reset = process.argv.includes('--reset');
  const force = process.argv.includes('--force');

  if (!tenantId) {
    console.error(
      'Usage: bun run scripts/seed-demo-workspace.ts --tenant <orgId> --owner <userId> [--reset] [--force]',
    );
    process.exit(1);
  }

  const prisma = createPrismaClient();

  try {
    if (reset) {
      await resetDemoWorkspace(prisma, tenantId);
    } else {
      if (!ownerUserId) {
        console.error('Error: --owner <userId> is required for seeding');
        process.exit(1);
      }
      await seedDemoWorkspace(prisma, tenantId, ownerUserId, { force });
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('seed-demo-workspace failed:', err);
    process.exit(1);
  });
}
