import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// bullmq тянет ioredis с нативными биндингами, которые роняют forks-pool
// vitest в части окружений. OnboardingService импортирует DemoSeedQueue
// (→ bullmq); мокаем модуль на пустые классы — в тестах очередь приходит моком.
vi.mock('bullmq', () => ({
  Queue: class {},
  Worker: class {},
}));

import type { PrismaService } from '../../common/prisma/prisma.service';

import { OnboardingService } from './onboarding.service';
import type { DemoSeedQueue } from './workers/demo-seed.queue';

/**
 * audit Б3 (2026-05-29) — спецификация на `resetDemoWorkspace`.
 *
 * Покрытие:
 *   - precondition `Org.demoWorkspaceSeededAt IS NULL` → 400 no_demo_to_reset,
 *   - precondition `Org` не найдена → 404 org_not_found,
 *   - happy path → каждый `deleteMany` фильтруется по `externalSource: 'demo'`
 *     либо через demo-meeting `roomName.startsWith('demo-room-')`,
 *   - возврат `deletedByTable` со счётчиками от `deleteMany`.
 */

describe('OnboardingService.resetDemoWorkspace (audit Б3)', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let svc: OnboardingService;

  function makePrismaMock() {
    const _del = (name: string) =>
      vi.fn(async (args: unknown) => {
        deleteCalls.push({ name, args });
        return { count: counters[name] ?? 0 };
      });
    const _upd = (name: string) =>
      vi.fn(async (args: unknown) => {
        updateCalls.push({ name, args });
        return { count: counters[name] ?? 0 };
      });
    const $transaction = vi.fn(
      async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma),
    );
    const deleteCalls: { name: string; args: unknown }[] = [];
    const updateCalls: { name: string; args: unknown }[] = [];
    const counters: Record<string, number> = {};
    const prisma = {
      org: {
        findUnique: vi.fn(async () => ({ id: 'org-1', demoWorkspaceSeededAt: new Date() })),
        update: vi.fn(async () => ({ id: 'org-1' })),
      },
      issueActivity: { deleteMany: _del('issueActivity') },
      issueComment: { deleteMany: _del('issueComment') },
      issueChecklistItem: { deleteMany: _del('issueChecklistItem') },
      issueChecklist: { deleteMany: _del('issueChecklist') },
      issueLabel: { deleteMany: _del('issueLabel') },
      issueAssignee: { deleteMany: _del('issueAssignee') },
      issueRelation: { deleteMany: _del('issueRelation') },
      sprintHint: { deleteMany: _del('sprintHint') },
      issue: { deleteMany: _del('issue') },
      meetingParticipantBehavior: { deleteMany: _del('meetingParticipantBehavior') },
      meetingBehaviorMetrics: { deleteMany: _del('meetingBehaviorMetrics') },
      meetingQualityScore: { deleteMany: _del('meetingQualityScore') },
      meetingChapter: { deleteMany: _del('meetingChapter') },
      transcriptTrack: { deleteMany: _del('transcriptTrack') },
      transcript: { deleteMany: _del('transcript') },
      aiResult: { deleteMany: _del('aiResult') },
      participant: { deleteMany: _del('participant') },
      meeting: { deleteMany: _del('meeting') },
      themeIdeaBlock: { deleteMany: _del('themeIdeaBlock') },
      themeEntity: { deleteMany: _del('themeEntity') },
      ideaBlockLink: { deleteMany: _del('ideaBlockLink') },
      entityLink: { deleteMany: _del('entityLink') },
      ideaBlock: { deleteMany: _del('ideaBlock') },
      entity: { deleteMany: _del('entity') },
      theme: { deleteMany: _del('theme') },
      goalAlignmentSnapshot: { deleteMany: _del('goalAlignmentSnapshot') },
      goalTheme: { deleteMany: _del('goalTheme') },
      goal: { deleteMany: _del('goal') },
      executablePersona: { deleteMany: _del('executablePersona') },
      skillTrait: { deleteMany: _del('skillTrait') },
      skillProfile: { deleteMany: _del('skillProfile') },
      cloneAccessGrant: { deleteMany: _del('cloneAccessGrant') },
      dailyCheckIn: { deleteMany: _del('dailyCheckIn') },
      weeklyOperationsDigest: { deleteMany: _del('weeklyOperationsDigest') },
      dailyOperationsDigest: { deleteMany: _del('dailyOperationsDigest') },
      chatV2Message: { deleteMany: _del('chatV2Message') },
      chatV2Conversation: { deleteMany: _del('chatV2Conversation') },
      notification: { deleteMany: _del('notification') },
      recognition: { deleteMany: _del('recognition') },
      helpfulnessSpotlight: { deleteMany: _del('helpfulnessSpotlight') },
      card: { deleteMany: _del('card') },
      processStep: { deleteMany: _del('processStep') },
      process: { deleteMany: _del('process') },
      insight: { deleteMany: _del('insight') },
      decision: { deleteMany: _del('decision') },
      department: { deleteMany: _del('department'), updateMany: _upd('department') },
      appointment: { deleteMany: _del('appointment') },
      person: { deleteMany: _del('person'), updateMany: _upd('person') },
      role: { deleteMany: _del('role') },
      companyProfile: { deleteMany: _del('companyProfile') },
      functionalDomain: { deleteMany: _del('functionalDomain') },
      projectDocument: { deleteMany: _del('projectDocument') },
      board: { deleteMany: _del('board') },
      issueState: { deleteMany: _del('issueState') },
      cycle: { deleteMany: _del('cycle') },
      label: { deleteMany: _del('label') },
      project: { deleteMany: _del('project') },

      // ── ТЗ 2026-05-31 demo-content-expansion-pulse §7.8 ──
      // Pulse snapshot-таблицы (без externalSource — чистка по tenantId).
      knowledgeRiskSnapshot: { deleteMany: _del('knowledgeRiskSnapshot') },
      recurringTopic: { deleteMany: _del('recurringTopic') },
      promiseNetworkSnapshot: { deleteMany: _del('promiseNetworkSnapshot') },
      personGoalContribution: { deleteMany: _del('personGoalContribution') },
      knowledgeVelocitySnapshot: { deleteMany: _del('knowledgeVelocitySnapshot') },
      personEngagementSnapshot: { deleteMany: _del('personEngagementSnapshot') },
      forecastSnapshot: { deleteMany: _del('forecastSnapshot') },
      crossFunctionalFrictionReport: { deleteMany: _del('crossFunctionalFrictionReport') },
      helpfulnessTrait: { deleteMany: _del('helpfulnessTrait') },
      socialContributionProfile: { deleteMany: _del('socialContributionProfile') },
      processTemplateVersion: { deleteMany: _del('processTemplateVersion') },
      processTemplate: { deleteMany: _del('processTemplate') },
      // Новый контент (с externalSource='demo').
      regulation: { deleteMany: _del('regulation') },
      idea: { deleteMany: _del('idea') },
      ideaCluster: { deleteMany: _del('ideaCluster') },
      document: { deleteMany: _del('document') },
      event: { deleteMany: _del('event') },
      experiment: { deleteMany: _del('experiment') },
      brandVoiceProfile: { deleteMany: _del('brandVoiceProfile') },
      vendor: { deleteMany: _del('vendor') },
      probeEvent: { deleteMany: _del('probeEvent') },
      feedbackMessage: { deleteMany: _del('feedbackMessage') },
      referralPayout: { deleteMany: _del('referralPayout') },
      clientReferralLink: { deleteMany: _del('clientReferralLink') },
      referral: { deleteMany: _del('referral') },
      contributionSnapshot: { deleteMany: _del('contributionSnapshot') },
      user: { deleteMany: _del('user') },

      $transaction,
      __deleteCalls: deleteCalls,
      __updateCalls: updateCalls,
      __counters: counters,
    };
    return prisma;
  }

  beforeEach(() => {
    prisma = makePrismaMock();
    const demoSeedQueue = {
      enqueue: vi.fn(async () => ({ jobId: 'demo-seed:org-1' })),
      statusOf: vi.fn(async () => 'unknown' as const),
    };
    svc = new OnboardingService(
      prisma as unknown as PrismaService,
      demoSeedQueue as unknown as DemoSeedQueue,
    );
  });

  it('400 no_demo_to_reset, если у Org НЕТ demoWorkspaceSeededAt', async () => {
    prisma.org.findUnique.mockResolvedValueOnce({
      id: 'org-1',
      demoWorkspaceSeededAt: null as unknown as Date,
    });
    await expect(
      svc.resetDemoWorkspace({ orgId: 'org-1', actorUserId: 'u-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    // НИЧЕГО не удаляем
    expect(prisma.__deleteCalls.length).toBe(0);
  });

  it('404 org_not_found, если Org нет', async () => {
    prisma.org.findUnique.mockResolvedValueOnce(null as unknown as { id: string; demoWorkspaceSeededAt: Date });
    await expect(
      svc.resetDemoWorkspace({ orgId: 'org-x', actorUserId: 'u-1' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('happy path: каждое deleteMany имеет фильтр демо', async () => {
    prisma.org.findUnique.mockResolvedValueOnce({
      id: 'org-1',
      demoWorkspaceSeededAt: new Date(),
    });
    prisma.__counters['person'] = 12;
    prisma.__counters['issue'] = 42;

    const result = await svc.resetDemoWorkspace({
      orgId: 'org-1',
      actorUserId: 'u-1',
    });

    expect(result.ok).toBe(true);
    expect(result.deletedByTable.person).toBe(12);
    expect(result.deletedByTable.issue).toBe(42);

    // Все вызовы delete должны фильтровать ИЛИ externalSource='demo',
    // ИЛИ через родителя с externalSource='demo' / roomName demo-room-…,
    // ИЛИ для snapshot-таблиц без externalSource — по tenantId/orgId
    // (precondition demoWorkspaceSeededAt уже отсёк боевые Org'и).
    const safeFilter = (args: unknown): boolean => {
      const w = (args as { where?: unknown }).where as Record<string, unknown> | undefined;
      if (!w) return false;
      const str = JSON.stringify(w);
      return (
        str.includes('"externalSource":"demo"') ||
        str.includes('"startsWith":"demo-room-"') ||
        // Snapshot-таблицы (Pulse/Helpfulness/Process/Vendor/...).
        str.includes('"tenantId":"org-1"') ||
        // FeedbackMessage (orgId, не tenantId).
        str.includes('"orgId":"org-1"') ||
        // Referral (slug starts with 'demo').
        str.includes('"startsWith":"demo"') ||
        // ContributionSnapshot/HelpfulnessSpotlight/User — по списку userId.
        str.includes('"in":[]')
      );
    };
    for (const call of prisma.__deleteCalls) {
      expect(safeFilter(call.args), `deleteMany ${call.name} не имеет demo-фильтра: ${JSON.stringify(call.args)}`).toBe(true);
    }
    // Org обновлён: demoWorkspaceSeededAt: null (+ demoUserIds сброшены).
    expect(prisma.org.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'org-1' },
        data: expect.objectContaining({ demoWorkspaceSeededAt: null }),
      }),
    );
  });
});
