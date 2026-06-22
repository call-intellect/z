import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import { ProbeService } from '../../probe/probe.service';
import { SKILL_SUBJECT_SIGNAL_TYPES } from '../constants/skill-signal-types';
import {
  CDM_CASE_INTERVIEW_JSON_SCHEMA,
  CDM_CASE_INTERVIEW_SCHEMA_NAME,
  CDM_CASE_INTERVIEW_SYSTEM_PROMPT,
  CDM_CASE_INTERVIEW_USER_TEMPLATE,
} from '../prompts/cdm-case-interview.prompt';

import { resolveProbeRecipients } from './probe-recipient.util';

@Injectable()
export class Specialist37ProbeService {
  private readonly logger = new Logger(Specialist37ProbeService.name);

  static readonly SPECIALIST_NAME = '3-7-skill';
  static readonly CDM_INTERVIEW_REASON = 'skill.cdm_interview';
  private static readonly STARVED_MIN_TENURE_MONTHS = 3;
  private static readonly STARVED_FRESH_WINDOW_MONTHS = 3;
  private static readonly CDM_CASE_WINDOW_DAYS = 30;
  private static readonly CDM_MAX_CASE_BLOCKS = 3;
  private static readonly CDM_DELIVERED_STATUSES = ['pending', 'dispatched'] as const;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService)
    private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Optional()
    @Inject(ProbeService)
    private readonly probeService?: ProbeService,
  ) {}

  async checkAndEmitProbes(args: {
    tenantId: string;
    profileId: string;
    personId: string;
    personName: string;
    entityId?: string | null;
  }): Promise<void> {
    try {
      await this.checkProfileStarved(args);
    } catch (err) {
      this.logger.debug(
        {
          profileId: args.profileId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-7-probe.checkProfileStarved: упал — skip',
      );
    }
    try {
      await this.checkCdmInterview({
        tenantId: args.tenantId,
        profileId: args.profileId,
        personId: args.personId,
        personName: args.personName,
        entityId: args.entityId ?? null,
      });
    } catch (err) {
      this.logger.debug(
        {
          profileId: args.profileId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-7-probe.checkCdmInterview: упал — skip',
      );
    }
  }

  async emitContradictingTraits(args: {
    tenantId: string;
    profileId: string;
    personId: string;
    personName: string;
    newTraitId: string;
    existingTraitId: string;
    existingStatement: string;
    newStatement: string;
  }): Promise<void> {
    const recipients = await this.findRecipients({
      tenantId: args.tenantId,
      personId: args.personId,
    });
    if (recipients.length === 0) return;

    const message = `У сотрудника ${args.personName} новая черта в навыковом профиле противоречит существующей. Старая: «${args.existingStatement.slice(0, 120)}». Новая: «${args.newStatement.slice(0, 120)}». Что это — изменение со временем или ошибка?`;
    await this.emit({
      tenantId: args.tenantId,
      profileId: args.profileId,
      reason: 'skill.contradicting_traits',
      message,
      recipients,
      suggestedActions: ['Это эволюция со временем', 'Старая черта неверна — пометить'],
      actionUrl: `/persons/${args.personId}/skill-profile`,
    });
  }

  private async checkProfileStarved(args: {
    tenantId: string;
    profileId: string;
    personId: string;
    personName: string;
  }): Promise<void> {
    const person = await this.prisma.person.findUnique({
      where: { id: args.personId },
      select: { id: true, createdAt: true, entityId: true, relationship: true },
    });
    if (!person || person.relationship !== 'employee') return;

    const tenureMs = Specialist37ProbeService.STARVED_MIN_TENURE_MONTHS * 30 * 24 * 60 * 60 * 1000;
    if (Date.now() - person.createdAt.getTime() < tenureMs) return;

    if (!person.entityId) return;

    const freshSince = new Date(
      Date.now() - Specialist37ProbeService.STARVED_FRESH_WINDOW_MONTHS * 30 * 24 * 60 * 60 * 1000,
    );
    const freshCount = await this.prisma.ideaBlockEntity.count({
      where: {
        entityId: person.entityId,
        role: 'subject',
        block: {
          tenantId: args.tenantId,
          status: 'canonical',
          signalType: { in: [...SKILL_SUBJECT_SIGNAL_TYPES] },
          createdAt: { gte: freshSince },
        },
      },
    });
    if (freshCount >= 5) return;

    const recipients = await this.findRecipients({
      tenantId: args.tenantId,
      personId: args.personId,
    });
    if (recipients.length === 0) return;

    const message = `У сотрудника ${args.personName} не накапливается информация о принимаемых решениях за последние 3 месяца (нашли только ${freshCount} обсуждений «почему я так решил»). Это нормально для его роли?`;
    await this.emit({
      tenantId: args.tenantId,
      profileId: args.profileId,
      reason: 'skill.profile_starved',
      message,
      recipients,
      suggestedActions: ['Это нормально для роли', 'Нужно больше обсуждений «почему»'],
      actionUrl: `/persons/${args.personId}/skill-profile`,
    });
  }

  async checkCdmInterview(args: {
    tenantId: string;
    profileId: string;
    personId: string;
    personName: string;
    entityId: string | null;
  }): Promise<void> {
    if (!this.cfg.skill.cdmInterviewEnabled) return;
    if (!this.probeService) return;

    const person = await this.prisma.person.findUnique({
      where: { id: args.personId },
      select: { userId: true, entityId: true },
    });
    if (!person?.userId) return;
    const entityId = args.entityId ?? person.entityId;
    if (!entityId) return;

    const maxQuestions = await this.cfg.getDynamic<number>(
      'knowledge.cdmInterviewMaxQuestions',
      undefined,
      5,
    );
    const asked = await this.prisma.probeEvent.count({
      where: {
        tenantId: args.tenantId,
        reason: Specialist37ProbeService.CDM_INTERVIEW_REASON,
        status: { in: [...Specialist37ProbeService.CDM_DELIVERED_STATUSES] },
        payload: { path: ['contextCardId'], equals: args.profileId },
      },
    });
    if (asked >= maxQuestions) return;

    const cooldownDays = await this.cfg.getDynamic<number>(
      'knowledge.cdmInterviewCooldownDays',
      undefined,
      7,
    );
    const lastAsked = await this.prisma.probeEvent.findFirst({
      where: {
        tenantId: args.tenantId,
        reason: Specialist37ProbeService.CDM_INTERVIEW_REASON,
        status: { in: [...Specialist37ProbeService.CDM_DELIVERED_STATUSES] },
        payload: { path: ['contextCardId'], equals: args.profileId },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (
      lastAsked &&
      Date.now() - lastAsked.createdAt.getTime() < cooldownDays * 24 * 60 * 60 * 1000
    ) {
      return;
    }

    const caseQuotes = await this.loadFreshCaseQuotes({
      tenantId: args.tenantId,
      entityId,
    });
    if (caseQuotes.length === 0) return;

    const question = await this.formulateCdmQuestion({
      tenantId: args.tenantId,
      profileId: args.profileId,
      personName: args.personName,
      caseQuotes,
    });
    if (!question) return;

    const caseContext = caseQuotes[0]?.quote.slice(0, 160);
    const message = caseContext
      ? `${question}\n\nКейс из недавнего обсуждения: «${caseContext}»`
      : question;
    await this.emit({
      tenantId: args.tenantId,
      profileId: args.profileId,
      reason: Specialist37ProbeService.CDM_INTERVIEW_REASON,
      message,
      recipients: [person.userId],
      suggestedQuestion: question,
      contextCardTitle: 'Разбор кейса для клона роли',
      priorityHint: 0.4,
    });
  }

  private async loadFreshCaseQuotes(args: {
    tenantId: string;
    entityId: string;
  }): Promise<Array<{ quote: string; observedAt: string }>> {
    const since = new Date(
      Date.now() - Specialist37ProbeService.CDM_CASE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const mentions = await this.prisma.ideaBlockEntity.findMany({
      where: {
        entityId: args.entityId,
        role: 'subject',
        block: {
          tenantId: args.tenantId,
          status: 'canonical',
          signalType: { in: [...SKILL_SUBJECT_SIGNAL_TYPES] },
          createdAt: { gte: since },
        },
      },
      select: { blockId: true },
      take: 20,
    });
    const blockIds = [...new Set(mentions.map((m) => m.blockId))];
    if (blockIds.length === 0) return [];

    const blocks = await this.prisma.ideaBlock.findMany({
      where: { id: { in: blockIds } },
      select: {
        id: true,
        name: true,
        trustedAnswer: true,
        createdAt: true,
        evidence: { select: { quote: true }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
      take: Specialist37ProbeService.CDM_MAX_CASE_BLOCKS,
    });
    return blocks
      .map((b) => ({
        quote: (b.evidence[0]?.quote ?? b.trustedAnswer ?? b.name ?? '').trim(),
        observedAt: b.createdAt.toISOString(),
      }))
      .filter((q) => q.quote.length > 0);
  }

  private async formulateCdmQuestion(args: {
    tenantId: string;
    profileId: string;
    personName: string;
    caseQuotes: ReadonlyArray<{ quote: string; observedAt: string }>;
  }): Promise<string | null> {
    const guardOn = this.cfg.aiFeatures?.promptInjectionGuardEnabled !== false;
    const rawUser = CDM_CASE_INTERVIEW_USER_TEMPLATE({
      personName: args.personName,
      roleName: null,
      caseQuotes: args.caseQuotes,
    });
    try {
      const result = await this.llm.call({
        taskType: 'cdm-case-interview',
        systemPrompt: guardOn
          ? withInjectionGuard(CDM_CASE_INTERVIEW_SYSTEM_PROMPT)
          : CDM_CASE_INTERVIEW_SYSTEM_PROMPT,
        userMessage: guardOn ? wrapUserData(rawUser) : rawUser,
        tenantId: args.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: CDM_CASE_INTERVIEW_SCHEMA_NAME,
          schema: CDM_CASE_INTERVIEW_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'skill_profile', id: args.profileId },
        dataClass: 'internal',
      });
      const parsed = JSON.parse(result.text) as { question?: unknown };
      if (typeof parsed.question === 'string' && parsed.question.trim().length > 0) {
        return parsed.question.trim().slice(0, 500);
      }
      this.logger.warn(
        { profileId: args.profileId },
        'specialist-3-7-probe.formulateCdmQuestion: пустой question — skip',
      );
      return null;
    } catch (err) {
      this.logger.warn(
        {
          profileId: args.profileId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-7-probe.formulateCdmQuestion: LLM упал — skip (best-effort)',
      );
      return null;
    }
  }

  private async findRecipients(args: { tenantId: string; personId: string }): Promise<string[]> {
    try {
      return await resolveProbeRecipients({
        prisma: this.prisma,
        tenantId: args.tenantId,
        subjectPersonId: args.personId,
        subjectAddressingEnabled: this.cfg.probe.subjectAddressingEnabled,
      });
    } catch (err) {
      this.logger.debug(
        {
          personId: args.personId,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-7-probe.findRecipients: lookup упал',
      );
      return [];
    }
  }

  private async emit(args: {
    tenantId: string;
    profileId: string;
    reason: string;
    message: string;
    recipients: readonly string[];
    suggestedActions?: readonly string[];
    suggestedQuestion?: string;
    contextCardTitle?: string;
    actionUrl?: string;
    priorityHint?: number;
  }): Promise<void> {
    if (!this.probeService) {
      this.logger.debug(
        { profileId: args.profileId, reason: args.reason },
        'specialist-3-7-probe.emit: ProbeService недоступен — skip',
      );
      return;
    }
    try {
      await this.probeService.suggest({
        tenantId: args.tenantId,
        emittedByService: Specialist37ProbeService.SPECIALIST_NAME,
        reason: args.reason,
        payload: {
          message: args.message,
          suggestedActions: args.suggestedActions ? [...args.suggestedActions] : undefined,
          suggestedQuestion: args.suggestedQuestion,
          contextCardId: args.profileId,
          contextCardKind: 'skill_profile',
          contextCardTitle: args.contextCardTitle ?? args.message.slice(0, 100),
          actionUrl: args.actionUrl,
          dataClass: 'internal',
        },
        recipientCandidates: [...args.recipients],
        priorityHint: args.priorityHint ?? 0.5,
        dataClass: 'internal',
      });
      this.metrics.incCoreSpecialistProbeEvent({
        type: 'skill_trait',
        reason: args.reason,
      });
    } catch (err) {
      this.logger.warn(
        {
          profileId: args.profileId,
          reason: args.reason,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-7-probe.emit: ProbeService.suggest упал',
      );
    }
  }
}
