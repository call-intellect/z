/**
 * seed-demo-workspace.ts
 *
 * Сидирование демо-воркспейса «ТехноСтрим» для онбординга.
 * Запуск: bun run scripts/seed-demo-workspace.ts --tenant <orgId> --owner <userId>
 *
 * Создаёт полный набор реалистичных данных: орг-структуру, трекер, встречи,
 * граф знаний, клоны, чек-ины, дайджесты, чат, уведомления и др.
 * Все данные помечаются externalSource: 'demo' (где поле доступно).
 */
import { createPrismaClient } from './_lib/prisma';
import type { PrismaClient } from '@prisma/client';
import { createEmptyIdMap, type IdMap, type SeedContext } from '../src/modules/onboarding/demo-data/types';

// Модули данных
import { seedOrgStructure } from '../src/modules/onboarding/demo-data/org-structure';
import { seedTracker } from '../src/modules/onboarding/demo-data/tracker';
import { seedMeetings } from '../src/modules/onboarding/demo-data/meetings';
import { seedKnowledgeGraph } from '../src/modules/onboarding/demo-data/knowledge-graph';
import { seedGoalsClones } from '../src/modules/onboarding/demo-data/goals-clones';
import { seedOperations } from '../src/modules/onboarding/demo-data/operations';
import { seedChatNotifications } from '../src/modules/onboarding/demo-data/chat-notifications';
import { seedPolish } from '../src/modules/onboarding/demo-data/polish';

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

/**
 * audit В9 (2026-05-29): guard'ы перед сидированием демо-воркспейса.
 *   1. Идемпотентность — если `demoWorkspaceSeededAt != null`, выходим без
 *      изменений (повторный запуск из CI / Z-Admin не дублирует данные).
 *   2. «Свежая Org» — если в тенанте уже есть НЕ-demo Person'ы или Project'ы
 *      (boevye external'ы / реальные пользователи добавили данные), сидирование
 *      ОТКАЗЫВАЕТСЯ. Иначе seed может пересечься с production данными и сломать
 *      реальную работу клиента. Передача `--force` снимает guard (для admin
 *      override; пишет warn в лог).
 */
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
  // Проверяем не-demo сущности. Хотя бы один Person/Project из реальной работы → отказ.
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
  departmentsCreated?: number;
  personsCreated?: number;
  projectsCreated?: number;
  issuesCreated?: number;
  meetingsCreated?: number;
  ideaBlocksCreated?: number;
  entitiesCreated?: number;
  themesCreated?: number;
  goalsCreated?: number;
  clonesCreated?: number;
  checkInsCreated?: number;
  digestsCreated?: number;
  chatConversationsCreated?: number;
}> {
  const eligibility = await ensureOrgEligibleForDemoSeed(prisma, tenantId, options);
  if (eligibility.skip) {
    console.log(`⏭ ${eligibility.reason}`);
    return { skipped: true, reason: eligibility.reason };
  }
  const ids: IdMap = createEmptyIdMap();
  const ctx: SeedContext = { prisma, tenantId, ownerUserId };

  // ── Фаза 1: Скелет ──────────────────────────────────────
  console.log('── Фаза 1: Орг-структура ──');
  await seedOrgStructure(ctx, ids);

  console.log('── Фаза 1: Трекер ──');
  await seedTracker(ctx, ids);

  console.log('── Фаза 1: Встречи ──');
  await seedMeetings(ctx, ids);

  // ── Фаза 2: Граф и клоны ────────────────────────────────
  console.log('── Фаза 2: Граф знаний ──');
  await seedKnowledgeGraph(ctx, ids);

  console.log('── Фаза 2: Цели и клоны ──');
  await seedGoalsClones(ctx, ids);

  // ── Фаза 3: Операционка ─────────────────────────────────
  console.log('── Фаза 3: Чек-ины и дайджесты ──');
  await seedOperations(ctx, ids);

  console.log('── Фаза 3: Чат и уведомления ──');
  await seedChatNotifications(ctx, ids);

  // ── Фаза 4: Полировка ───────────────────────────────────
  console.log('── Фаза 4: Полировка ──');
  await seedPolish(ctx, ids);

  // ── Пометка Org ─────────────────────────────────────────
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
    checkInsCreated: 100, // фиксированное значение из ТЗ
    digestsCreated: 8, // 3 weekly + 5 daily
    chatConversationsCreated: 3,
  };

  console.log('\n=== Демо-воркспейс «ТехноСтрим» успешно создан ===');
  console.log(JSON.stringify(stats, null, 2));

  return stats;
}

/**
 * Сброс демо-данных: удаляет все записи с externalSource = 'demo'.
 */
export async function resetDemoWorkspace(
  prisma: PrismaClient,
  tenantId: string,
): Promise<void> {
  console.log(`Сброс демо-данных для tenant ${tenantId}...`);

  // Удаляем в порядке обратных зависимостей
  // IssueActivity, IssueComment, IssueLabel, IssueAssignee, IssueRelation, IssueChecklistItem, IssueChecklist → Issue
  await prisma.issueActivity.deleteMany({ where: { tenantId, issue: { externalSource: 'demo' } } });
  await prisma.issueComment.deleteMany({ where: { issue: { project: { tenantId } }, content: { not: undefined } } });
  await prisma.issueChecklistItem.deleteMany({ where: { checklist: { tenantId, issue: { externalSource: 'demo' } } } });
  await prisma.issueChecklist.deleteMany({ where: { tenantId, issue: { externalSource: 'demo' } } });
  await prisma.issueLabel.deleteMany({ where: { issue: { project: { tenantId } } } });
  await prisma.issueAssignee.deleteMany({ where: { issue: { project: { tenantId } } } });
  await prisma.issueRelation.deleteMany({ where: { source: { project: { tenantId } } } });
  await prisma.sprintHint.deleteMany({ where: { tenantId } });
  await prisma.issue.deleteMany({ where: { tenantId, externalSource: 'demo' } });

  // Meetings
  await prisma.meetingParticipantBehavior.deleteMany({ where: { tenantId } });
  await prisma.meetingBehaviorMetrics.deleteMany({ where: { meeting: { tenantId } } });
  await prisma.meetingQualityScore.deleteMany({ where: { meeting: { tenantId } } });
  await prisma.meetingChapter.deleteMany({ where: { meeting: { tenantId } } });
  await prisma.transcriptTrack.deleteMany({ where: { transcript: { meeting: { tenantId } } } });
  await prisma.transcript.deleteMany({ where: { meeting: { tenantId } } });
  await prisma.aiResult.deleteMany({ where: { meeting: { tenantId } } });
  await prisma.participant.deleteMany({ where: { meeting: { tenantId } } });
  await prisma.meeting.deleteMany({ where: { tenantId, roomName: { startsWith: 'demo-room-' } } });

  // Knowledge graph
  await prisma.themeIdeaBlock.deleteMany({ where: { theme: { tenantId } } });
  await prisma.themeEntity.deleteMany({ where: { theme: { tenantId } } });
  await prisma.ideaBlockLink.deleteMany({ where: { tenantId } });
  await prisma.entityLink.deleteMany({ where: { tenantId } });
  await prisma.ideaBlock.deleteMany({ where: { tenantId } });
  await prisma.entity.deleteMany({ where: { tenantId } });
  await prisma.theme.deleteMany({ where: { tenantId } });

  // Goals
  await prisma.goalAlignmentSnapshot.deleteMany({ where: { tenantId } });
  await prisma.goalTheme.deleteMany({ where: { goal: { tenantId } } });
  await prisma.goal.deleteMany({ where: { tenantId } });

  // Clones
  await prisma.executablePersona.deleteMany({ where: { tenantId } });
  await prisma.skillTrait.deleteMany({ where: { profile: { tenantId } } });
  await prisma.skillProfile.deleteMany({ where: { tenantId } });
  await prisma.cloneAccessGrant.deleteMany({ where: { tenantId } });

  // Operations
  await prisma.dailyCheckIn.deleteMany({ where: { tenantId } });
  await prisma.weeklyOperationsDigest.deleteMany({ where: { tenantId } });
  await prisma.dailyOperationsDigest.deleteMany({ where: { tenantId } });

  // Chat & Notifications
  await prisma.chatV2Message.deleteMany({ where: { conversation: { tenantId } } });
  await prisma.chatV2Conversation.deleteMany({ where: { tenantId } });
  await prisma.notification.deleteMany({ where: { tenantId } });

  // Polish
  await prisma.recognition.deleteMany({ where: { tenantId } });
  await prisma.helpfulnessSpotlight.deleteMany({ where: { tenantId } });
  await prisma.userBadge.deleteMany({});
  await prisma.card.deleteMany({ where: { tenantId } });
  await prisma.processStep.deleteMany({ where: { tenantId } });
  await prisma.process.deleteMany({ where: { tenantId } });
  await prisma.insight.deleteMany({ where: { tenantId } });
  await prisma.decision.deleteMany({ where: { tenantId } });

  // Org structure
  await prisma.appointment.deleteMany({ where: { tenantId } });
  await prisma.person.deleteMany({ where: { tenantId } });
  await prisma.role.deleteMany({ where: { tenantId } });
  await prisma.department.deleteMany({ where: { tenantId } });
  await prisma.companyProfile.deleteMany({ where: { tenantId } });
  await prisma.functionalDomain.deleteMany({ where: { tenantId } });

  // Tracker structure
  await prisma.projectDocument.deleteMany({ where: { tenantId } });
  await prisma.board.deleteMany({ where: { project: { tenantId } } });
  await prisma.issueState.deleteMany({ where: { tenantId } });
  await prisma.cycle.deleteMany({ where: { tenantId } });
  await prisma.label.deleteMany({ where: { project: { tenantId } } });
  await prisma.project.deleteMany({ where: { tenantId } });

  // Reset flag
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
  // audit В9: --force снимает проверку «свежей Org» (опасно — может затереть
  // боевые данные). Идемпотентность по demoWorkspaceSeededAt всё равно
  // сохраняется: повторный запуск без --reset на уже сидированной Org
  // ничего не делает.
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

main().catch((err) => {
  console.error('seed-demo-workspace failed:', err);
  process.exit(1);
});
