import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { seedChatNotifications } from '../../../scripts/demo-data/chat-notifications';
import { seedGoalsClones } from '../../../scripts/demo-data/goals-clones';
import { seedKnowledgeGraph } from '../../../scripts/demo-data/knowledge-graph';
import { seedMeetings } from '../../../scripts/demo-data/meetings';
import { seedOperations } from '../../../scripts/demo-data/operations';
import { seedOrgStructure } from '../../../scripts/demo-data/org-structure';
import { seedPolish } from '../../../scripts/demo-data/polish';
import { seedTracker } from '../../../scripts/demo-data/tracker';
import { createEmptyIdMap, type SeedContext } from '../../../scripts/demo-data/types';
import { PrismaService } from '../../common/prisma/prisma.service';

import type { WelcomePatchBody } from './dto/welcome-patch.dto';
import { humanize } from './onboarding-labels';

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** PATCH /orgs/:orgId/welcome — пошаговое сохранение ответов Блока A */
  async patchWelcome(args: {
    orgId: string;
    userId: string;
    body: WelcomePatchBody;
  }): Promise<{ ok: true }> {
    const { orgId, body } = args;
    await this.assertOrgExists(orgId);

    const data: Record<string, unknown> = {};
    if (body.teamSize !== undefined) data['teamSize'] = body.teamSize;
    if (body.industry !== undefined) data['industry'] = body.industry;
    if (body.painPoints !== undefined) data['painPoints'] = body.painPoints;
    if (body.currentStack !== undefined) data['currentStack'] = body.currentStack;
    if (body.plannedFeatures !== undefined) data['plannedFeatures'] = body.plannedFeatures;

    // companyInfoCompletedAt — ставим при первом сохранении industry
    if (body.industry !== undefined) {
      data['companyInfoCompletedAt'] = new Date();
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.org.update({ where: { id: orgId }, data });
    }

    return { ok: true };
  }

  /** POST /orgs/:orgId/welcome/complete — финал Блока A: создаём документ */
  async completeWelcome(args: {
    orgId: string;
    userId: string;
  }): Promise<{ ok: true; redirectTo: string }> {
    const { orgId, userId } = args;

    const org = await this.prisma.org.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        industry: true,
        teamSize: true,
        painPoints: true,
        currentStack: true,
        plannedFeatures: true,
      },
    });
    if (!org) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'org_not_found', message: 'Org не найдена' },
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, companyRole: true },
    });
    if (!user) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'user_not_found', message: 'Пользователь не найден' },
      });
    }

    // Ищем Person-запись пользователя в этой Org
    const person = await this.prisma.person.findFirst({
      where: { tenantId: orgId, userId, deletedAt: null },
      select: { id: true },
    });

    // Создаём документ «Знакомство с компанией» только если есть Person-запись
    if (person) {
      const content = this.buildWelcomeDocument({ org, user });
      await this.prisma.document.create({
        data: {
          tenantId: orgId,
          uploaderId: person.id,
          kind: 'text',
          name: 'Знакомство с компанией',
          mimeType: 'text/plain',
          originalSize: Buffer.byteLength(content, 'utf8'),
          inlineContent: Buffer.from(content, 'utf8'),
          status: 'uploaded',
        },
      });
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.org.update({ where: { id: orgId }, data: { welcomeCompletedAt: now } }),
      this.prisma.user.update({ where: { id: userId }, data: { profileCompletedAt: now } }),
    ]);

    return { ok: true, redirectTo: '/dashboard' };
  }

  /** POST /orgs/:orgId/setup/complete — все 6 шагов Блока B пройдены/пропущены */
  async completeSetup(args: { orgId: string }): Promise<{ ok: true }> {
    await this.assertOrgExists(args.orgId);
    await this.prisma.org.update({
      where: { id: args.orgId },
      data: { setupCompletedAt: new Date() },
    });
    return { ok: true };
  }

  /** PATCH /api/v1/users/me — обновление companyRole */
  async updateCompanyRole(args: { userId: string; companyRole: string }): Promise<{ ok: true }> {
    await this.prisma.user.update({
      where: { id: args.userId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { companyRole: args.companyRole as any },
    });
    return { ok: true };
  }

  private async assertOrgExists(orgId: string): Promise<void> {
    const org = await this.prisma.org.findUnique({ where: { id: orgId }, select: { id: true } });
    if (!org) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'org_not_found', message: 'Org не найдена' },
      });
    }
  }

  private buildWelcomeDocument(args: {
    org: {
      name: string;
      industry: string | null;
      teamSize: string | null;
      painPoints: string[];
      currentStack: string[];
      plannedFeatures: string[];
    };
    user: {
      name: string;
      companyRole: string | null;
    };
  }): string {
    const { org, user } = args;
    const date = new Date().toLocaleDateString('ru-RU');
    const roleLabel = user.companyRole ? humanize(user.companyRole) : 'Не указано';
    const industryLabel = org.industry ? humanize(org.industry) : 'Не указано';

    const painList =
      org.painPoints.map((p) => `- ${humanize(p)}`).join('\n') || '- Не указано';
    const stackList =
      org.currentStack.map((s) => `- ${humanize(s)}`).join('\n') || '- Не указано';
    const featureList =
      org.plannedFeatures.map((f) => `- ${humanize(f)}`).join('\n') || '- Не указано';

    return `Компания: ${org.name}
Сфера: ${industryLabel}
Размер: ${org.teamSize ?? 'Не указано'}

Заполнил: ${user.name} (${roleLabel}), ${date}

Главные боли:
${painList}

Сейчас работают на:
${stackList}

Главный интерес в Коре:
${featureList}
`;
  }

  /** POST /orgs/:orgId/demo-workspace — загрузка демо-данных «ТехноСтрим» */
  async seedDemoWorkspace(args: {
    orgId: string;
    userId: string;
  }): Promise<{
    ok: true;
    stats: Record<string, number>;
  }> {
    const { orgId, userId } = args;

    const org = await this.prisma.org.findUnique({
      where: { id: orgId },
      select: { id: true, welcomeCompletedAt: true, demoWorkspaceSeededAt: true },
    });
    if (!org) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'org_not_found', message: 'Org не найдена' },
      });
    }
    if (org.demoWorkspaceSeededAt) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'demo_already_seeded', message: 'Демо-данные уже загружены' },
      });
    }

    const ids = createEmptyIdMap();
    const ctx: SeedContext = { prisma: this.prisma, tenantId: orgId, ownerUserId: userId };

    this.logger.log(`Seeding demo workspace for org=${orgId}`);

    await seedOrgStructure(ctx, ids);
    await seedTracker(ctx, ids);
    await seedMeetings(ctx, ids);
    await seedKnowledgeGraph(ctx, ids);
    await seedGoalsClones(ctx, ids);
    await seedOperations(ctx, ids);
    await seedChatNotifications(ctx, ids);
    await seedPolish(ctx, ids);

    await this.prisma.org.update({
      where: { id: orgId },
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
    };

    this.logger.log(`Demo workspace seeded: ${JSON.stringify(stats)}`);
    return { ok: true, stats };
  }

  /** POST /orgs/:orgId/reset-demo — сброс демо-данных */
  async resetDemoWorkspace(args: { orgId: string }): Promise<{ ok: true }> {
    const { orgId } = args;
    this.logger.log(`Resetting demo workspace for org=${orgId}`);

    // Удаляем в порядке обратных зависимостей
    await this.prisma.issueActivity.deleteMany({ where: { tenantId: orgId, issue: { externalSource: 'demo' } } });
    await this.prisma.issueComment.deleteMany({ where: { issue: { project: { tenantId: orgId } } } });
    await this.prisma.issueChecklistItem.deleteMany({ where: { checklist: { tenantId: orgId, issue: { externalSource: 'demo' } } } });
    await this.prisma.issueChecklist.deleteMany({ where: { tenantId: orgId, issue: { externalSource: 'demo' } } });
    await this.prisma.issueLabel.deleteMany({ where: { issue: { project: { tenantId: orgId } } } });
    await this.prisma.issueAssignee.deleteMany({ where: { issue: { project: { tenantId: orgId } } } });
    await this.prisma.issueRelation.deleteMany({ where: { source: { project: { tenantId: orgId } } } });
    await this.prisma.sprintHint.deleteMany({ where: { tenantId: orgId } });
    await this.prisma.issue.deleteMany({ where: { tenantId: orgId, externalSource: 'demo' } });

    await this.prisma.meetingParticipantBehavior.deleteMany({ where: { tenantId: orgId } });
    await this.prisma.meetingBehaviorMetrics.deleteMany({ where: { meeting: { tenantId: orgId } } });
    await this.prisma.meetingQualityScore.deleteMany({ where: { meeting: { tenantId: orgId } } });
    await this.prisma.meetingChapter.deleteMany({ where: { meeting: { tenantId: orgId } } });
    await this.prisma.transcriptTrack.deleteMany({ where: { transcript: { meeting: { tenantId: orgId } } } });
    await this.prisma.transcript.deleteMany({ where: { meeting: { tenantId: orgId } } });
    await this.prisma.aiResult.deleteMany({ where: { meeting: { tenantId: orgId } } });
    await this.prisma.participant.deleteMany({ where: { meeting: { tenantId: orgId } } });
    await this.prisma.meeting.deleteMany({ where: { tenantId: orgId, roomName: { startsWith: 'demo-room-' } } });

    await this.prisma.themeIdeaBlock.deleteMany({ where: { theme: { tenantId: orgId } } });
    await this.prisma.themeEntity.deleteMany({ where: { theme: { tenantId: orgId } } });
    await this.prisma.ideaBlockLink.deleteMany({ where: { tenantId: orgId } });
    await this.prisma.entityLink.deleteMany({ where: { tenantId: orgId } });
    await this.prisma.ideaBlock.deleteMany({ where: { tenantId: orgId } });
    await this.prisma.entity.deleteMany({ where: { tenantId: orgId } });
    await this.prisma.theme.deleteMany({ where: { tenantId: orgId } });

    await this.prisma.goalAlignmentSnapshot.deleteMany({ where: { tenantId: orgId } });
    await this.prisma.goalTheme.deleteMany({ where: { goal: { tenantId: orgId } } });
    await this.prisma.goal.deleteMany({ where: { tenantId: orgId } });

    await this.prisma.executablePersona.deleteMany({ where: { tenantId: orgId } });
    await this.prisma.skillTrait.deleteMany({ where: { profile: { tenantId: orgId } } });
    await this.prisma.skillProfile.deleteMany({ where: { tenantId: orgId } });
    await this.prisma.cloneAccessGrant.deleteMany({ where: { tenantId: orgId } });

    await this.prisma.dailyCheckIn.deleteMany({ where: { tenantId: orgId } });
    await this.prisma.weeklyOperationsDigest.deleteMany({ where: { tenantId: orgId } });
    await this.prisma.dailyOperationsDigest.deleteMany({ where: { tenantId: orgId } });

    await this.prisma.chatV2Message.deleteMany({ where: { conversation: { tenantId: orgId } } });
    await this.prisma.chatV2Conversation.deleteMany({ where: { tenantId: orgId } });
    await this.prisma.notification.deleteMany({ where: { tenantId: orgId } });

    await this.prisma.recognition.deleteMany({ where: { tenantId: orgId } });
    await this.prisma.helpfulnessSpotlight.deleteMany({ where: { tenantId: orgId } });
    await this.prisma.card.deleteMany({ where: { tenantId: orgId } });
    await this.prisma.processStep.deleteMany({ where: { tenantId: orgId } });
    await this.prisma.process.deleteMany({ where: { tenantId: orgId } });
    await this.prisma.insight.deleteMany({ where: { tenantId: orgId } });
    await this.prisma.decision.deleteMany({ where: { tenantId: orgId } });

    await this.prisma.appointment.deleteMany({ where: { tenantId: orgId } });
    await this.prisma.person.deleteMany({ where: { tenantId: orgId } });
    await this.prisma.role.deleteMany({ where: { tenantId: orgId } });
    await this.prisma.department.deleteMany({ where: { tenantId: orgId } });
    await this.prisma.companyProfile.deleteMany({ where: { tenantId: orgId } });
    await this.prisma.functionalDomain.deleteMany({ where: { tenantId: orgId } });

    await this.prisma.projectDocument.deleteMany({ where: { tenantId: orgId } });
    await this.prisma.board.deleteMany({ where: { project: { tenantId: orgId } } });
    await this.prisma.issueState.deleteMany({ where: { tenantId: orgId } });
    await this.prisma.cycle.deleteMany({ where: { tenantId: orgId } });
    await this.prisma.label.deleteMany({ where: { project: { tenantId: orgId } } });
    await this.prisma.project.deleteMany({ where: { tenantId: orgId } });

    await this.prisma.org.update({
      where: { id: orgId },
      data: { demoWorkspaceSeededAt: null },
    });

    this.logger.log(`Demo workspace reset for org=${orgId}`);
    return { ok: true };
  }
}
