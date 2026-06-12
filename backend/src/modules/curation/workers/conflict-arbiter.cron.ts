import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  type DebateVerdict,
  MultiAgentDebateService,
} from '../../ai/services/multi-agent-debate.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { resourceTypeRu } from '../../pending-actions/resource-type-ru';
import type { ConflictResolutionDto } from '../dto/curation.dto';
import { ConflictService } from '../services/conflict.service';

/**
 * ConflictArbiterCron — Autonomy W1 «LLM-арбитр конфликтов» (2026-06-12,
 * ТЗ plans/tz/2026-06-11-autonomy-remove-manual-confirmations.md, Фаза W1).
 *
 * Переводит конфликты знаний (ConflictItem open) из «всегда человек» в HYBRID:
 * раз в сутки (02:00) ночной мульти-агентный дебат (`conflict-arbiter` в
 * MultiAgentDebateService — strict-critic / empathetic-supporter /
 * neutral-judge) выносит verdict по каждому открытому конфликту, и при
 * уверенном консенсусе конфликт авто-резолвится от имени владельца Org.
 *
 * Условия авто-резолва (Р1.1):
 *   - consensusType ∈ {unanimous, majority};
 *   - fallbackUsed === null (debate отработал штатно, без cost_cap /
 *     provider_unavailable);
 *   - decision ∈ {keep_old, accept_new, merge} (см. ниже);
 *   - средняя confidence голосов-победителей ≥
 *     `knowledge.curationConflictArbiterMinConfidence` (default 0.7).
 *
 * ВАЖНО (решение оркестратора): авто-резолвим ТОЛЬКО verdicts
 * keep_old | accept_new | merge. `evolving` НЕ авто-резолвим — для него
 * ConflictService.resolve требует evolvingMeta (existingValidUntil +
 * newValidFrom), а схема debate_vote_v1 (verdict + reasoning + confidence)
 * не имеет механизма передачи дат. `escalate` НЕ авто-резолвим по
 * определению — арбитр сам говорит «нужен человек». В обоих случаях конфликт
 * остаётся open и ждёт человека.
 *
 * Актор резолюции (Р1.2) — владелец Org (`Org.ownerId`). После каждого
 * авто-резолва владельцу уходит post-hoc `system.message` (не critical) —
 * Ф1.4: уведомление о факте, не запрос подтверждения.
 *
 * Гейт (Р1): `knowledge.curationConflictArbiterEnabled` — kill-switch,
 * default TRUE (Ship-On: фича выкатывается включённой). Реестр —
 * docs/operations/feature-flags.md.
 *
 * Метрика: `z_conflict_arbiter_total{verdict, outcome}`,
 * outcome ∈ auto_resolved | left_open | error.
 *
 * Cron-литерал в декораторе `'0 2 * * *'`.
 */
@Injectable()
export class ConflictArbiterCron {
  private readonly logger = new Logger(ConflictArbiterCron.name);

  /**
   * Verdicts, которые можно авто-резолвить через ConflictService.resolve без
   * дополнительных данных. evolving (нужен evolvingMeta с датами) и escalate
   * (явный запрос человека) сюда НЕ входят — конфликт остаётся open.
   */
  private static readonly AUTO_RESOLVABLE_VERDICTS: ReadonlySet<string> =
    new Set(['keep_old', 'accept_new', 'merge']);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConflictService) private readonly conflicts: ConflictService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    /**
     * Debate — @Optional по образцу CurationService: в worker-процессе без
     * AiModule зависимость null → конфликты безопасно остаются open (ждут
     * человека), как до W1.
     */
    @Optional()
    @Inject(MultiAgentDebateService)
    private readonly debate: MultiAgentDebateService | null = null,
  ) {}

  @Cron('0 2 * * *')
  async runArbiter(): Promise<void> {
    try {
      const summary = await this.runForAllOrgs();
      this.logger.log(summary, 'conflict-arbiter: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'conflict-arbiter: непойманная ошибка',
      );
    }
  }

  async runForAllOrgs(): Promise<{
    enabled: boolean;
    scannedOrgs: number;
    autoResolved: number;
    leftOpen: number;
    skipped: number;
    errors: number;
  }> {
    // Гейт Р1 — kill-switch (default TRUE, Ship-On). OFF → ни одного вызова
    // дебата, конфликты остаются на человеке (поведение до W1).
    if (this.cfg.curation.conflictArbiterEnabled !== true) {
      this.logger.log(
        'conflict-arbiter: выключен kill-switch\'ем (knowledge.curationConflictArbiterEnabled=false) — пропускаю проход',
      );
      return {
        enabled: false,
        scannedOrgs: 0,
        autoResolved: 0,
        leftOpen: 0,
        skipped: 0,
        errors: 0,
      };
    }
    if (!this.debate) {
      this.logger.warn(
        'conflict-arbiter: MultiAgentDebateService недоступен (процесс без AiModule) — конфликты остаются open',
      );
      return {
        enabled: true,
        scannedOrgs: 0,
        autoResolved: 0,
        leftOpen: 0,
        skipped: 0,
        errors: 0,
      };
    }

    // Только Org'и, у которых есть открытые конфликты.
    const tenants = await this.prisma.conflictItem.findMany({
      where: { status: 'open' },
      distinct: ['tenantId'],
      select: { tenantId: true },
    });

    let autoResolved = 0;
    let leftOpen = 0;
    let skipped = 0;
    let errors = 0;

    for (const { tenantId } of tenants) {
      try {
        const res = await this.runForOrg(tenantId);
        autoResolved += res.autoResolved;
        leftOpen += res.leftOpen;
        skipped += res.skipped;
        errors += res.errors;
      } catch (err) {
        errors += 1;
        this.logger.warn(
          {
            tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'conflict-arbiter: ошибка обработки Org — пропускаю',
        );
      }
    }

    return {
      enabled: true,
      scannedOrgs: tenants.length,
      autoResolved,
      leftOpen,
      skipped,
      errors,
    };
  }

  /**
   * Проход по одному Org: батч старейших open-конфликтов → дебат → авто-резолв
   * при уверенном консенсусе. Ошибка одного конфликта не валит sweep
   * (try/catch на конфликт, outcome='error').
   */
  async runForOrg(tenantId: string): Promise<{
    autoResolved: number;
    leftOpen: number;
    skipped: number;
    errors: number;
  }> {
    const out = { autoResolved: 0, leftOpen: 0, skipped: 0, errors: 0 };
    if (!this.debate) return out;

    const batchSize = this.cfg.curation.conflictArbiterBatchSize ?? 20;
    const minConfidence = this.cfg.curation.conflictArbiterMinConfidence ?? 0.7;

    // Р1.2 — актор резолюции: владелец Org.
    const org = await this.prisma.org.findUnique({
      where: { id: tenantId },
      select: { ownerId: true },
    });
    if (!org?.ownerId) {
      this.logger.warn(
        { tenantId },
        'conflict-arbiter: Org не найден или без ownerId — пропускаю Org',
      );
      return out;
    }
    const ownerId = org.ownerId;

    const conflicts = await this.prisma.conflictItem.findMany({
      where: { tenantId, status: 'open' },
      orderBy: { createdAt: 'asc' },
      take: batchSize,
    });

    for (const conflict of conflicts) {
      try {
        const result = await this.processOneConflict({
          tenantId,
          ownerId,
          minConfidence,
          conflict,
        });
        out[result] += 1;
      } catch (err) {
        out.errors += 1;
        this.metrics.incConflictArbiter({
          verdict: 'unknown',
          outcome: 'error',
        });
        this.logger.warn(
          {
            tenantId,
            conflictId: conflict.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'conflict-arbiter: ошибка обработки конфликта — пропускаю (конфликт остаётся open)',
        );
      }
    }

    return out;
  }

  // ─────────────────────────── private ──────────────────────────────────

  private async processOneConflict(args: {
    tenantId: string;
    ownerId: string;
    minConfidence: number;
    conflict: {
      id: string;
      resourceType: string;
      existingId: string;
      newId: string;
      relationType: string;
      detectedBy: string;
      evidence: unknown;
    };
  }): Promise<'autoResolved' | 'leftOpen' | 'skipped'> {
    const { tenantId, ownerId, minConfidence, conflict } = args;
    const debate = this.debate as MultiAgentDebateService;

    // Материал дела: payload'ы последних версий обеих карточек.
    const [existingVersion, newVersion] = await Promise.all([
      this.latestCardVersion(tenantId, conflict.resourceType, conflict.existingId),
      this.latestCardVersion(tenantId, conflict.resourceType, conflict.newId),
    ]);
    if (!existingVersion || !newVersion) {
      this.logger.warn(
        {
          tenantId,
          conflictId: conflict.id,
          existingFound: Boolean(existingVersion),
          newFound: Boolean(newVersion),
        },
        'conflict-arbiter: нет CardVersion одной из карточек — пропускаю конфликт',
      );
      return 'skipped';
    }

    // Переменные данные дела уходят в USER-message дебата (task / candidates /
    // contextBlocks → MultiAgentDebateService.buildUserMessage); SYSTEM каждого
    // stance стабилен — cache-friendly.
    const verdict = await debate.judge({
      taskFamily: 'conflict-arbiter',
      taskType: 'debate-conflict-arbiter',
      tenantId,
      task:
        'Конфликт знаний компании: существующее утверждение (existing) противоречит новому (new). Выбери исход: keep_old | accept_new | merge | evolving | escalate.',
      candidates: [
        {
          role: 'existing',
          resourceType: conflict.resourceType,
          payload: existingVersion.payload,
        },
        {
          role: 'new',
          resourceType: conflict.resourceType,
          payload: newVersion.payload,
        },
      ],
      contextBlocks: [
        {
          relationType: conflict.relationType,
          detectedBy: conflict.detectedBy,
          evidence: conflict.evidence,
        },
      ],
    });

    const decision = verdict.decision;
    const winningVotes = verdict.votes.filter((v) => v.verdict === decision);
    const avgConfidence =
      winningVotes.length > 0
        ? winningVotes.reduce((sum, v) => sum + v.confidence, 0) /
          winningVotes.length
        : 0;

    const isConsensus =
      verdict.consensusType === 'unanimous' ||
      verdict.consensusType === 'majority';
    const autoResolvable =
      ConflictArbiterCron.AUTO_RESOLVABLE_VERDICTS.has(decision);

    if (
      !isConsensus ||
      verdict.fallbackUsed !== null ||
      !autoResolvable ||
      avgConfidence < minConfidence
    ) {
      this.metrics.incConflictArbiter({
        verdict: decision,
        outcome: 'left_open',
      });
      this.logger.log(
        {
          tenantId,
          conflictId: conflict.id,
          decision,
          consensusType: verdict.consensusType,
          fallbackUsed: verdict.fallbackUsed,
          avgConfidence,
          minConfidence,
        },
        'conflict-arbiter: нет уверенного консенсуса (или verdict не авто-резолвится) — конфликт остаётся open',
      );
      return 'leftOpen';
    }

    // Уверенный консенсус → авто-резолв от имени владельца Org.
    const reasoning = this.buildResolveReasoning(verdict);
    await this.conflicts.resolve({
      tenantId,
      conflictId: conflict.id,
      reviewerUserId: ownerId,
      resolution: decision as ConflictResolutionDto,
      reasoning,
    });
    this.metrics.incConflictArbiter({
      verdict: decision,
      outcome: 'auto_resolved',
    });
    this.logger.log(
      {
        tenantId,
        conflictId: conflict.id,
        decision,
        consensusType: verdict.consensusType,
        avgConfidence,
      },
      'conflict-arbiter: конфликт авто-разрешён по консенсусу дебата',
    );

    // Ф1.4 — post-hoc уведомление владельца (не critical): факт, не запрос.
    await this.notifyOwner({
      tenantId,
      ownerId,
      conflict,
      decision,
      verdict,
      avgConfidence,
    });

    return 'autoResolved';
  }

  private async latestCardVersion(
    tenantId: string,
    resourceType: string,
    resourceId: string,
  ): Promise<{ payload: unknown } | null> {
    return this.prisma.cardVersion.findFirst({
      where: { tenantId, resourceType, resourceId },
      orderBy: { version: 'desc' },
      select: { payload: true },
    });
  }

  /**
   * Reasoning резолюции: маркер арбитра + consensus + краткое обоснование
   * нейтрального арбитра (если его голос за победивший verdict; иначе —
   * первый голос-победитель).
   */
  private buildResolveReasoning(verdict: DebateVerdict): string {
    const neutral = verdict.votes.find(
      (v) => v.stance === 'neutral-judge' && v.verdict === verdict.decision,
    );
    const source =
      neutral ?? verdict.votes.find((v) => v.verdict === verdict.decision);
    const short = (source?.reasoning ?? '').slice(0, 400);
    return `[Кора-арбитр] consensus=${verdict.consensusType}; ${short}`;
  }

  /** Post-hoc system.message владельцу Org — best-effort (ошибка → warn). */
  private async notifyOwner(args: {
    tenantId: string;
    ownerId: string;
    conflict: { id: string; resourceType: string; existingId: string };
    decision: string;
    verdict: DebateVerdict;
    avgConfidence: number;
  }): Promise<void> {
    const { tenantId, ownerId, conflict, decision, verdict, avgConfidence } =
      args;
    const verdictRu: Record<string, string> = {
      keep_old: 'оставлено прежнее знание',
      accept_new: 'принято новое знание',
      merge: 'версии объединены',
    };
    const consensusRu =
      verdict.consensusType === 'unanimous'
        ? 'единогласно'
        : 'большинством голосов';
    try {
      await this.conversational.sendNotification({
        tenantId,
        recipientUserId: ownerId,
        eventType: 'system.message',
        payload: {
          title: 'Кора разрешила конфликт знаний',
          body: `Два утверждения по карточке «${resourceTypeRu(conflict.resourceType)}» противоречили друг другу. Совет арбитров Коры решил ${consensusRu}: ${verdictRu[decision] ?? decision} (уверенность ${avgConfidence.toFixed(2)}).`,
          severity: 'info',
          actionUrl: `/curation/conflicts/${conflict.id}`,
        },
        dataClass: 'internal',
        contextCardId: conflict.existingId,
        critical: false,
      });
    } catch (err) {
      this.logger.warn(
        {
          tenantId,
          conflictId: conflict.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'conflict-arbiter: ошибка post-hoc уведомления владельца — резолюция уже применена',
      );
    }
  }
}
