import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';
import { ProbeService } from '../../probe/probe.service';
import {
  CDM_CASE_INTERVIEW_JSON_SCHEMA,
  CDM_CASE_INTERVIEW_SCHEMA_NAME,
  CDM_CASE_INTERVIEW_SYSTEM_PROMPT,
  CDM_CASE_INTERVIEW_USER_TEMPLATE,
} from '../prompts/cdm-case-interview.prompt';

import { resolveProbeRecipients } from './probe-recipient.util';

/**
 * SBA γ-1 — Specialist37ProbeService.
 *
 * 3 probe-trigger'а специалиста 3.7 (SkillProfile):
 *
 *   1. `skill.profile_starved` — Person.relationship='employee' > 3 мес,
 *      reasoning-блоков < SKILL_MIN_OBSERVATIONS за последние 3 мес → probe
 *      direct manager'у (или admin fallback). «У сотрудника X не накапливается
 *      информация о принимаемых решениях — это нормально для роли?».
 *
 *   2. `skill.contradicting_traits` — новый trait противоречит существующему
 *      high-confidence trait того же профиля → probe direct manager'у.
 *      Вызывается из Specialist37Service после insert'а нового trait'а.
 *
 *   3. `skill.cdm_interview` (TZ clone-method Э3.1, R8) — CDM-интервью
 *      носителя: по свежему реальному кейсу (reasoning-блоку) LLM формулирует
 *      один не наводящий вопрос ретроспективного разбора (Critical Decision
 *      Method), адресат — САМ носитель. Ответ попадает в граф как
 *      high-priority reasoning (см. ProbeResponseHandler / SegmentBuilder).
 *
 * Best-effort: один упавший probe не валит остальные.
 */
@Injectable()
export class Specialist37ProbeService {
  private readonly logger = new Logger(Specialist37ProbeService.name);

  static readonly SPECIALIST_NAME = '3-7-skill';
  /** TZ clone-method Э3.1 — reason CDM-интервью носителя. */
  static readonly CDM_INTERVIEW_REASON = 'skill.cdm_interview';
  /** Месяцев в employee, после которых проверяем starved-профиль. */
  private static readonly STARVED_MIN_TENURE_MONTHS = 3;
  /** Окно для подсчёта свежих reasoning-блоков. */
  private static readonly STARVED_FRESH_WINDOW_MONTHS = 3;
  /** Э3.1 — окно «свежего кейса» для CDM-вопроса (дней). */
  private static readonly CDM_CASE_WINDOW_DAYS = 30;
  /** Э3.1 — сколько последних reasoning-блоков идёт в кейс (top-цитаты). */
  private static readonly CDM_MAX_CASE_BLOCKS = 3;
  /**
   * Б21 — статусы ProbeEvent, означающие, что вопрос РЕАЛЬНО ушёл получателю
   * (pending = поставлен в доставку, dispatched = доставлен). Бюджет и cooldown
   * CDM считаем только по ним. Недоставочные статусы (dropped_dedup,
   * dropped_rate_limit, dropped_cold_start, dropped_dataclass_gate,
   * dropped_low_value, queued_digest, routed_to_digest, suppressed_stale,
   * expired) в бюджет/cooldown НЕ входят — иначе deferrable-CDM при исчерпанном
   * бюджете получателя копит queued_digest-строки и реальный вопрос не задаётся
   * никогда.
   */
  private static readonly CDM_DELIVERED_STATUSES = [
    'pending',
    'dispatched',
  ] as const;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService)
    private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Optional() @Inject(ProbeService)
    private readonly probeService?: ProbeService,
  ) {}

  /**
   * Главный вход — вызывается из Specialist37Service.rebuildProfile в конце.
   * Проверяет trigger'ы для конкретного профиля.
   */
  async checkAndEmitProbes(args: {
    tenantId: string;
    profileId: string;
    personId: string;
    personName: string;
    /** Э3.1 — Entity{type=person} носителя (Person.entityId), для выборки кейсов. */
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
    // TZ clone-method Э3.1 — CDM-интервью носителя (best-effort, как starved).
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

  /**
   * Probe: новый trait противоречит существующему high-confidence trait.
   * Вызывается вручную из Specialist37Service при KNN-merge verdict='supersedes'
   * или при явном конфликте формулировок (в γ-1 — placeholder, тонкая логика
   * детекта противоречий — γ+).
   */
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

  // ─────────────────────── triggers ───────────────────────

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

    const tenureMs =
      Specialist37ProbeService.STARVED_MIN_TENURE_MONTHS * 30 * 24 * 60 * 60 * 1000;
    if (Date.now() - person.createdAt.getTime() < tenureMs) return;

    if (!person.entityId) return;

    // Считаем свежие reasoning-блоки.
    const freshSince = new Date(
      Date.now() -
        Specialist37ProbeService.STARVED_FRESH_WINDOW_MONTHS *
          30 *
          24 *
          60 *
          60 *
          1000,
    );
    const freshCount = await this.prisma.ideaBlockEntity.count({
      where: {
        entityId: person.entityId,
        role: 'subject',
        block: {
          tenantId: args.tenantId,
          status: 'canonical',
          signalType: { in: ['reasoning', 'rationale', 'decision_basis'] },
          createdAt: { gte: freshSince },
        },
      },
    });
    // Порог — общий SKILL_MIN_OBSERVATIONS (default 5).
    // Если меньше — пинаем direct manager'а.
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

  /**
   * TZ clone-method Э3.1 (R8) — CDM-интервью носителя роли.
   *
   * Кора сама задаёт носителю до `knowledge.cdmInterviewMaxQuestions`
   * (default 5) не наводящих вопросов по его РЕАЛЬНЫМ свежим кейсам
   * (Critical Decision Method: «почему выбрали этот вариант», «что
   * насторожило», «какие альтернативы отвергли»). Ответ (текст/голос —
   * голос транскрибируется probe-системой) попадает в граф как
   * высокоприоритетный reasoning-источник и кормит детекторы Э1/Э2.
   *
   * Гейты:
   *   - kill-switch `cfg.skill.cdmInterviewEnabled` (ON);
   *   - адресат — САМ носитель (subject): нужен Person.userId, иначе skip
   *     (CDM-вопрос менеджеру не адресуем — отвечает только носитель);
   *   - лимит вопросов на профиль (привязка — JSON-path по
   *     payload.contextCardId: отдельной колонки у ProbeEvent нет);
   *   - cooldown `knowledge.cdmInterviewCooldownDays` (default 7) — иначе
   *     все вопросы ушли бы за один день;
   *   - нет свежих reasoning-кейсов за 30 дней → skip.
   *
   * Best-effort: ошибка LLM → skip с warn (не валит rebuild).
   */
  async checkCdmInterview(args: {
    tenantId: string;
    profileId: string;
    personId: string;
    personName: string;
    entityId: string | null;
  }): Promise<void> {
    if (!this.cfg.skill.cdmInterviewEnabled) return;
    if (!this.probeService) return;

    // Адресат — сам носитель: без userId спросить некого.
    const person = await this.prisma.person.findUnique({
      where: { id: args.personId },
      select: { userId: true, entityId: true },
    });
    if (!person?.userId) return;
    const entityId = args.entityId ?? person.entityId;
    if (!entityId) return;

    // Лимит вопросов на профиль.
    const maxQuestions = await this.cfg.getDynamic<number>(
      'knowledge.cdmInterviewMaxQuestions',
      undefined,
      5,
    );
    const asked = await this.prisma.probeEvent.count({
      where: {
        tenantId: args.tenantId,
        reason: Specialist37ProbeService.CDM_INTERVIEW_REASON,
        // Б21 — только реально доставленные probe тратят бюджет вопросов.
        status: { in: [...Specialist37ProbeService.CDM_DELIVERED_STATUSES] },
        payload: { path: ['contextCardId'], equals: args.profileId },
      },
    });
    if (asked >= maxQuestions) return;

    // Cooldown: не чаще 1 вопроса в N дней на носителя.
    const cooldownDays = await this.cfg.getDynamic<number>(
      'knowledge.cdmInterviewCooldownDays',
      undefined,
      7,
    );
    const lastAsked = await this.prisma.probeEvent.findFirst({
      where: {
        tenantId: args.tenantId,
        reason: Specialist37ProbeService.CDM_INTERVIEW_REASON,
        // Б21 — cooldown отсчитываем от реально доставленного вопроса.
        status: { in: [...Specialist37ProbeService.CDM_DELIVERED_STATUSES] },
        payload: { path: ['contextCardId'], equals: args.profileId },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (
      lastAsked &&
      Date.now() - lastAsked.createdAt.getTime() <
        cooldownDays * 24 * 60 * 60 * 1000
    ) {
      return;
    }

    // Самый свежий кейс носителя — top-цитаты последних reasoning-блоков.
    const caseQuotes = await this.loadFreshCaseQuotes({
      tenantId: args.tenantId,
      entityId,
    });
    if (caseQuotes.length === 0) return;

    // LLM cdm-case-interview → один не наводящий вопрос (best-effort).
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

  /**
   * Э3.1 — top-цитаты последних reasoning-блоков носителя за
   * CDM_CASE_WINDOW_DAYS (паттерн выборки subject-reasoning как в
   * Specialist37Service.loadSubjectReasoningBlocks, но без embeddings —
   * хватает 1–3 последних блоков и их quotes).
   */
  private async loadFreshCaseQuotes(args: {
    tenantId: string;
    entityId: string;
  }): Promise<Array<{ quote: string; observedAt: string }>> {
    const since = new Date(
      Date.now() -
        Specialist37ProbeService.CDM_CASE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );
    const mentions = await this.prisma.ideaBlockEntity.findMany({
      where: {
        entityId: args.entityId,
        role: 'subject',
        block: {
          tenantId: args.tenantId,
          status: 'canonical',
          signalType: { in: ['reasoning', 'rationale', 'decision_basis'] },
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

  /**
   * Э3.1 — LLM `cdm-case-interview` (json_schema strict). Возвращает null
   * при провале LLM / пустом ответе (skip, best-effort). Injection-guard —
   * как в Specialist37Service (цитаты исходно из транскриптов).
   */
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
      if (
        typeof parsed.question === 'string' &&
        parsed.question.trim().length > 0
      ) {
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

  // ─────────────────────── recipients ───────────────────────

  /**
   * Находит получателей probe.
   *
   * ТЗ 2026-05-25 «clone-reliability-hardening» Фаза 3 — переадресация:
   *   1. Глава primary-отдела сотрудника (`Department.headPersonId`), если
   *      это не сам субъект.
   *   2. Fallback — owner/admin Org.
   *
   * (До Фазы 3 здесь искались manager'ы по `Membership.role='manager'` в том
   * же отделе. С появлением явного `Department.headPersonId` это поле стало
   * единственным источником истины — оно editable из админки и не зависит
   * от RBAC-роли в Z.)
   */
  private async findRecipients(args: {
    tenantId: string;
    personId: string;
  }): Promise<string[]> {
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

  // ─────────────────────── emit ───────────────────────

  private async emit(args: {
    tenantId: string;
    profileId: string;
    reason: string;
    message: string;
    recipients: readonly string[];
    suggestedActions?: readonly string[];
    /** Э3.1 — готовый вопрос (dispatcher отдаёт его КАК ЕСТЬ для CDM). */
    suggestedQuestion?: string;
    /** Override человеческого title карточки (default — message.slice(0,100)). */
    contextCardTitle?: string;
    actionUrl?: string;
    /** Override priorityHint (default 0.5). */
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
          suggestedActions: args.suggestedActions
            ? [...args.suggestedActions]
            : undefined,
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
