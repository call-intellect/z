import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../common/prisma/prisma.service';

import { runAllSeedSteps } from './demo-data';
import {
  DEMO_EXTERNAL_SOURCE,
  markAllDemoEntitiesForTenant,
} from './demo-data/mark-demo';
import { createEmptyIdMap, type SeedContext } from './demo-data/types';
import type { WelcomePatchBody } from './dto/welcome-patch.dto';
import { humanize } from './onboarding-labels';

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

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

    // ТЗ 2026-06-01-demo-shared-org-model: больше не копируем демо в каждую
    // Org. Новый user получает membership(demo_observer) к эталонной демо-Org
    // (см. AccountsService.register). После welcome — сразу /dashboard.
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
      select: {
        id: true,
        welcomeCompletedAt: true,
        demoWorkspaceSeededAt: true,
        isReferenceDemo: true,
      },
    });
    if (!org) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'org_not_found', message: 'Org не найдена' },
      });
    }
    // ТЗ 2026-06-01-demo-shared-org-model §4.2: seed разрешён только для
    // эталонной демо-Org (isReferenceDemo=true). Защита от случайного вызова
    // на боевой Org — никаких 35-табличных вставок поверх живых данных.
    if (!org.isReferenceDemo) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'not_reference_org',
          message: 'Seed разрешён только для эталонной демо-Org (isReferenceDemo=true).',
        },
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

    // ТЗ 2026-06-01-demo-shared-org-model §4.7: список 23 модулей живёт в
    // `demo-data/index.ts` (DEMO_SEED_STEPS) — единый источник правды для
    // HTTP-эндпоинта, CLI и patch-скриптов.
    await runAllSeedSteps(ctx, ids);

    // audit Б3 (2026-05-29) — пробегаемся по всем tenant-scoped моделям и
    // проставляем `externalSource = 'demo'` свежесозданным записям.
    // Это безопаснее, чем добавлять флаг в каждую seed-функцию (35+ мест).
    // `resetDemoWorkspace` потом удаляет только записи с этим флагом —
    // боевые остаются.
    const marked = await markAllDemoEntitiesForTenant(this.prisma, orgId);
    this.logger.log(
      `Demo workspace marked externalSource='${DEMO_EXTERNAL_SOURCE}': updated=${marked.updated}`,
    );

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

  /**
   * POST /orgs/:orgId/reset-demo — сброс демо-данных.
   *
   * audit Б3 (2026-05-29):
   *   1. Precondition: `Org.demoWorkspaceSeededAt` НЕ null. Без этого вызов
   *      на боевой Org мгновенно бы стирал реальные данные (catastrophic data
   *      loss). Теперь — `BadRequest no_demo_to_reset`.
   *   2. Все `deleteMany` фильтруются по `externalSource = 'demo'` (или
   *      каскадно через demo-meeting / demo-issue / project с
   *      externalSource='demo'). `markAllDemoEntitiesForTenant` в seed-flow
   *      ставит этот флаг свежим данным.
   *   3. Всё завёрнуто в `$transaction` (timeout 30 секунд) — на половинном
   *      падении Org не остаётся в полуубитом состоянии.
   *   4. `actorUserId` логируется для post-mortem.
   */
  async resetDemoWorkspace(args: {
    orgId: string;
    actorUserId: string;
  }): Promise<{ ok: true; deletedByTable: Record<string, number> }> {
    const { orgId, actorUserId } = args;
    const org = await this.prisma.org.findUnique({
      where: { id: orgId },
      select: { id: true, demoWorkspaceSeededAt: true, isReferenceDemo: true },
    });
    if (!org) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'org_not_found', message: 'Org не найдена' },
      });
    }
    // ТЗ 2026-06-01-demo-shared-org-model §4.2: reset разрешён только для
    // эталонной демо-Org. Если кто-то дёрнет эндпоинт на боевой Org — 400,
    // никакого 35-табличного deleteMany по живым данным.
    if (!org.isReferenceDemo) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'not_reference_org',
          message: 'Reset разрешён только для эталонной демо-Org (isReferenceDemo=true).',
        },
      });
    }
    if (!org.demoWorkspaceSeededAt) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'no_demo_to_reset',
          message:
            'В этой компании нет загруженных демо-данных. ' +
            'Удалять боевые записи через этот эндпоинт нельзя.',
        },
      });
    }

    this.logger.warn(
      { orgId, actorUserId },
      'org.demo_reset: начинаем удаление demo-данных',
    );

    const DEMO = DEMO_EXTERNAL_SOURCE;
    const tenantId = orgId;

    // Семантика фильтров:
    //   - tenantId + externalSource='demo' — для верхнеуровневых моделей с
    //     externalSource (см. demo-data/mark-demo.ts).
    //   - Каскадные модели (комментарии/relations/labels/assignees/track/
    //     activity/themeIdeaBlock/etc) идут через родителя, у которого
    //     externalSource='demo' (issue/checklist/theme/skillProfile/meeting).
    //   - Meeting — через roomName startsWith 'demo-room-' (так seed работает
    //     с явным ID). Дополнительно externalSource не нужен.
    //   - GoalTheme и ChatV2Message — junction-таблицы без tenantId, чистятся
    //     через FK на demo-parent.
    const deletedByTable: Record<string, number> = {};
    const remember = (name: string, res: { count: number }): void => {
      deletedByTable[name] = (deletedByTable[name] ?? 0) + res.count;
    };

    await this.prisma.$transaction(
      async (tx) => {
        remember('issueActivity', await tx.issueActivity.deleteMany({
          where: { tenantId, issue: { externalSource: DEMO } },
        }));
        remember('issueComment', await tx.issueComment.deleteMany({
          where: { issue: { tenantId, externalSource: DEMO } },
        }));
        remember('issueChecklistItem', await tx.issueChecklistItem.deleteMany({
          where: { checklist: { tenantId, issue: { externalSource: DEMO } } },
        }));
        remember('issueChecklist', await tx.issueChecklist.deleteMany({
          where: { tenantId, issue: { externalSource: DEMO } },
        }));
        remember('issueLabel', await tx.issueLabel.deleteMany({
          where: { issue: { tenantId, externalSource: DEMO } },
        }));
        remember('issueAssignee', await tx.issueAssignee.deleteMany({
          where: { issue: { tenantId, externalSource: DEMO } },
        }));
        remember('issueRelation', await tx.issueRelation.deleteMany({
          where: { source: { tenantId, externalSource: DEMO } },
        }));
        remember('sprintHint', await tx.sprintHint.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));
        remember('issue', await tx.issue.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));

        // Meeting — через roomName 'demo-room-…' (seed выставляет явный ID).
        remember('meetingParticipantBehavior', await tx.meetingParticipantBehavior.deleteMany({
          where: { tenantId, meeting: { roomName: { startsWith: 'demo-room-' } } },
        }));
        remember('meetingBehaviorMetrics', await tx.meetingBehaviorMetrics.deleteMany({
          where: { meeting: { tenantId, roomName: { startsWith: 'demo-room-' } } },
        }));
        remember('meetingQualityScore', await tx.meetingQualityScore.deleteMany({
          where: { meeting: { tenantId, roomName: { startsWith: 'demo-room-' } } },
        }));
        remember('meetingChapter', await tx.meetingChapter.deleteMany({
          where: { meeting: { tenantId, roomName: { startsWith: 'demo-room-' } } },
        }));
        remember('transcriptTrack', await tx.transcriptTrack.deleteMany({
          where: {
            transcript: { meeting: { tenantId, roomName: { startsWith: 'demo-room-' } } },
          },
        }));
        remember('transcript', await tx.transcript.deleteMany({
          where: { meeting: { tenantId, roomName: { startsWith: 'demo-room-' } } },
        }));
        remember('aiResult', await tx.aiResult.deleteMany({
          where: { meeting: { tenantId, roomName: { startsWith: 'demo-room-' } } },
        }));
        remember('participant', await tx.participant.deleteMany({
          where: { meeting: { tenantId, roomName: { startsWith: 'demo-room-' } } },
        }));
        remember('meeting', await tx.meeting.deleteMany({
          where: { tenantId, roomName: { startsWith: 'demo-room-' } },
        }));

        // Knowledge graph
        remember('themeIdeaBlock', await tx.themeIdeaBlock.deleteMany({
          where: { theme: { tenantId, externalSource: DEMO } },
        }));
        remember('themeEntity', await tx.themeEntity.deleteMany({
          where: { theme: { tenantId, externalSource: DEMO } },
        }));
        // ideaBlockLink / entityLink — junction-таблицы БЕЗ externalSource.
        // DEMO-org → все записи демо (precondition demoWorkspaceSeededAt +
        // SubscriptionGuard блокирует реальные мутации). Чистим по tenantId.
        remember('ideaBlockLink', await tx.ideaBlockLink.deleteMany({
          where: { tenantId },
        }));
        remember('entityLink', await tx.entityLink.deleteMany({
          where: { tenantId },
        }));
        remember('ideaBlock', await tx.ideaBlock.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));
        remember('entity', await tx.entity.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));
        remember('theme', await tx.theme.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));

        // Goals
        remember('goalAlignmentSnapshot', await tx.goalAlignmentSnapshot.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));
        remember('goalTheme', await tx.goalTheme.deleteMany({
          where: { goal: { tenantId, externalSource: DEMO } },
        }));
        remember('goal', await tx.goal.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));

        // Skill / Persona
        remember('executablePersona', await tx.executablePersona.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));
        remember('skillTrait', await tx.skillTrait.deleteMany({
          where: { profile: { tenantId, externalSource: DEMO } },
        }));
        remember('skillProfile', await tx.skillProfile.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));
        remember('cloneAccessGrant', await tx.cloneAccessGrant.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));

        // Check-ins / digests
        remember('dailyCheckIn', await tx.dailyCheckIn.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));
        remember('weeklyOperationsDigest', await tx.weeklyOperationsDigest.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));
        remember('dailyOperationsDigest', await tx.dailyOperationsDigest.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));

        // Chat / notifications
        remember('chatV2Message', await tx.chatV2Message.deleteMany({
          where: { conversation: { tenantId, externalSource: DEMO } },
        }));
        remember('chatV2Conversation', await tx.chatV2Conversation.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));
        remember('notification', await tx.notification.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));

        // Org/process/cards
        remember('recognition', await tx.recognition.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));
        remember('helpfulnessSpotlight', await tx.helpfulnessSpotlight.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));
        remember('card', await tx.card.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));
        remember('processStep', await tx.processStep.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));
        remember('process', await tx.process.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));
        remember('insight', await tx.insight.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));
        remember('decision', await tx.decision.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));

        // Org structure — снять headPersonId перед удалением Person,
        // иначе FK Restrict не даст удалить.
        await tx.department.updateMany({
          where: { tenantId, externalSource: DEMO },
          data: { headPersonId: null },
        });
        remember('appointment', await tx.appointment.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));
        remember('person', await tx.person.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));
        remember('role', await tx.role.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));
        remember('department', await tx.department.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));
        remember('companyProfile', await tx.companyProfile.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));
        remember('functionalDomain', await tx.functionalDomain.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));

        // Tracker scaffolding
        remember('projectDocument', await tx.projectDocument.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));
        remember('board', await tx.board.deleteMany({
          where: { project: { tenantId, externalSource: DEMO } },
        }));
        remember('issueState', await tx.issueState.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));
        remember('cycle', await tx.cycle.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));
        remember('label', await tx.label.deleteMany({
          where: { project: { tenantId, externalSource: DEMO } },
        }));
        remember('project', await tx.project.deleteMany({
          where: { tenantId, externalSource: DEMO },
        }));

        // ── ТЗ 2026-05-31 demo-content-expansion-pulse §7.8 ──
        //
        // Pulse snapshot-таблицы НЕ имеют externalSource → чистим по
        // tenantId. Это безопасно: precondition `demoWorkspaceSeededAt`
        // выше уже отсёк боевые Org'и.
        remember('knowledgeRiskSnapshot', await tx.knowledgeRiskSnapshot.deleteMany({
          where: { tenantId },
        }));
        remember('recurringTopic', await tx.recurringTopic.deleteMany({
          where: { tenantId },
        }));
        remember('promiseNetworkSnapshot', await tx.promiseNetworkSnapshot.deleteMany({
          where: { tenantId },
        }));
        remember('personGoalContribution', await tx.personGoalContribution.deleteMany({
          where: { tenantId },
        }));
        remember('knowledgeVelocitySnapshot', await tx.knowledgeVelocitySnapshot.deleteMany({
          where: { tenantId },
        }));
        remember('personEngagementSnapshot', await tx.personEngagementSnapshot.deleteMany({
          where: { tenantId },
        }));
        remember('forecastSnapshot', await tx.forecastSnapshot.deleteMany({
          where: { tenantId },
        }));
        remember('crossFunctionalFrictionReport', await tx.crossFunctionalFrictionReport.deleteMany({
          where: { tenantId },
        }));

        // Helpfulness / Contribution — tenantId-фильтр (без externalSource).
        remember('helpfulnessTrait', await tx.helpfulnessTrait.deleteMany({
          where: { tenantId },
        }));
        remember('socialContributionProfile', await tx.socialContributionProfile.deleteMany({
          where: { tenantId },
        }));

        // ProcessTemplate (вместе с ProcessTemplateVersion):
        remember('processTemplateVersion', await tx.processTemplateVersion.deleteMany({
          where: { tenantId },
        }));
        remember('processTemplate', await tx.processTemplate.deleteMany({
          where: { tenantId },
        }));

        // Новый контент (Demo Content Expansion): эти модели НЕ имеют колонки
        // externalSource → чистим по tenantId. Безопасно: precondition
        // demoWorkspaceSeededAt + SubscriptionGuard гарантируют, что в DEMO-org
        // все эти записи демо (реальные создать нельзя).
        remember('regulation', await tx.regulation.deleteMany({
          where: { tenantId },
        }));
        remember('idea', await tx.idea.deleteMany({
          where: { tenantId },
        }));
        remember('ideaCluster', await tx.ideaCluster.deleteMany({
          where: { tenantId },
        }));
        remember('document', await tx.document.deleteMany({
          where: { tenantId },
        }));

        // Calendar — EventReminder и EventParticipant каскадятся через Event.
        remember('event', await tx.event.deleteMany({
          where: { tenantId },
        }));

        // Experiments / BrandVoice / Vendors / ProbeEvents.
        remember('experiment', await tx.experiment.deleteMany({
          where: { tenantId },
        }));
        remember('brandVoiceProfile', await tx.brandVoiceProfile.deleteMany({
          where: { tenantId },
        }));
        remember('vendor', await tx.vendor.deleteMany({
          where: { tenantId },
        }));
        remember('probeEvent', await tx.probeEvent.deleteMany({
          where: { tenantId },
        }));

        // Feedback (FeedbackTopic — глобальный, не трогаем; FeedbackItem —
        // каскад через FeedbackMessage).
        remember('feedbackMessage', await tx.feedbackMessage.deleteMany({
          where: { orgId: tenantId },
        }));

        // Referrals — Referral принадлежит ownerUser. Удаляем ТОЛЬКО если
        // это «демо-Referral», т.е. slug начинается с 'demo' (сидим в
        // seedReferrals именно так).
        remember('referralPayout', await tx.referralPayout.deleteMany({
          where: { clientReferralLink: { tenantId } },
        }));
        remember('clientReferralLink', await tx.clientReferralLink.deleteMany({
          where: { tenantId },
        }));
        remember('referral', await tx.referral.deleteMany({
          where: { slug: { startsWith: 'demo' } },
        }));

        // ── Демо-User'ы: список в Org.demoUserIds. ──
        // Сначала отвязать Person.userId (FK SetNull), потом удалить User'ы.
        const orgRow = await tx.org.findUnique({
          where: { id: orgId },
          select: { demoUserIds: true },
        });
        const demoUserIds = orgRow?.demoUserIds ?? [];
        if (demoUserIds.length > 0) {
          await tx.person.updateMany({
            where: { tenantId, userId: { in: demoUserIds } },
            data: { userId: null },
          });
          remember('contributionSnapshot', await tx.contributionSnapshot.deleteMany({
            where: { userId: { in: demoUserIds } },
          }));
          remember('helpfulnessSpotlight', await tx.helpfulnessSpotlight.deleteMany({
            where: { tenantId, helperUserId: { in: demoUserIds } },
          }));
          remember('user', await tx.user.deleteMany({
            where: { id: { in: demoUserIds } },
          }));
        }

        await tx.org.update({
          where: { id: orgId },
          data: { demoWorkspaceSeededAt: null, demoUserIds: { set: [] } },
        });
      },
      { timeout: 60_000 },
    );

    this.logger.warn(
      { orgId, actorUserId, deletedByTable },
      'org.demo_reset: завершено успешно',
    );
    return { ok: true, deletedByTable };
  }
}
