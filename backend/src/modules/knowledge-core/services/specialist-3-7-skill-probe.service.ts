import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ProbeService } from '../../probe/probe.service';

import { resolveProbeRecipients } from './probe-recipient.util';

/**
 * SBA γ-1 — Specialist37ProbeService.
 *
 * 2 probe-trigger'а специалиста 3.7 (SkillProfile) согласно sub-TZ §8:
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
 * Best-effort: один упавший probe не валит остальные.
 */
@Injectable()
export class Specialist37ProbeService {
  private readonly logger = new Logger(Specialist37ProbeService.name);

  static readonly SPECIALIST_NAME = '3-7-skill';
  /** Месяцев в employee, после которых проверяем starved-профиль. */
  private static readonly STARVED_MIN_TENURE_MONTHS = 3;
  /** Окно для подсчёта свежих reasoning-блоков. */
  private static readonly STARVED_FRESH_WINDOW_MONTHS = 3;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Optional() @Inject(ProbeService)
    private readonly probeService?: ProbeService,
  ) {}

  /**
   * Главный вход — вызывается из Specialist37Service.rebuildProfile в конце.
   * Проверяет два trigger'а для конкретного профиля.
   */
  async checkAndEmitProbes(args: {
    tenantId: string;
    profileId: string;
    personId: string;
    personName: string;
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
    actionUrl: string;
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
          contextCardId: args.profileId,
          contextCardKind: 'skill_profile',
          contextCardTitle: args.message.slice(0, 100),
          actionUrl: args.actionUrl,
          dataClass: 'internal',
        },
        recipientCandidates: [...args.recipients],
        priorityHint: 0.5,
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
