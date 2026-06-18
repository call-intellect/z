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

@Injectable()
export class ConflictArbiterCron {
  private readonly logger = new Logger(ConflictArbiterCron.name);

  private static readonly AUTO_RESOLVABLE_VERDICTS: ReadonlySet<string> = new Set([
    'keep_old',
    'accept_new',
    'merge',
  ]);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConflictService) private readonly conflicts: ConflictService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(MultiAgentDebateService)
    private readonly debate: MultiAgentDebateService | null = null,
  ) {}

  @Cron('0 2 * * *')
  async runArbiter(): Promise<void> {
    try {
      const summary = await this.runForAllOrgs();
      this.logger.debug(summary, 'conflict-arbiter: проход завершён');
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
    if (this.cfg.curation.conflictArbiterEnabled !== true) {
      this.logger.debug(
        "conflict-arbiter: выключен kill-switch'ем (knowledge.curationConflictArbiterEnabled=false) — пропускаю проход",
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

    const verdict = await debate.judge({
      taskFamily: 'conflict-arbiter',
      taskType: 'debate-conflict-arbiter',
      tenantId,
      task: 'Конфликт знаний компании: существующее утверждение (existing) противоречит новому (new). Выбери исход: keep_old | accept_new | merge | evolving | escalate.',
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
        ? winningVotes.reduce((sum, v) => sum + v.confidence, 0) / winningVotes.length
        : 0;

    const isConsensus =
      verdict.consensusType === 'unanimous' || verdict.consensusType === 'majority';
    const autoResolvable = ConflictArbiterCron.AUTO_RESOLVABLE_VERDICTS.has(decision);

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
      this.logger.debug(
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
    this.logger.debug(
      {
        tenantId,
        conflictId: conflict.id,
        decision,
        consensusType: verdict.consensusType,
        avgConfidence,
      },
      'conflict-arbiter: конфликт авто-разрешён по консенсусу дебата',
    );

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

  private buildResolveReasoning(verdict: DebateVerdict): string {
    const neutral = verdict.votes.find(
      (v) => v.stance === 'neutral-judge' && v.verdict === verdict.decision,
    );
    const source = neutral ?? verdict.votes.find((v) => v.verdict === verdict.decision);
    const short = (source?.reasoning ?? '').slice(0, 400);
    return `[Кора-арбитр] consensus=${verdict.consensusType}; ${short}`;
  }

  private async notifyOwner(args: {
    tenantId: string;
    ownerId: string;
    conflict: { id: string; resourceType: string; existingId: string };
    decision: string;
    verdict: DebateVerdict;
    avgConfidence: number;
  }): Promise<void> {
    const { tenantId, ownerId, conflict, decision, verdict, avgConfidence } = args;
    const verdictRu: Record<string, string> = {
      keep_old: 'оставлено прежнее знание',
      accept_new: 'принято новое знание',
      merge: 'версии объединены',
    };
    const consensusRu =
      verdict.consensusType === 'unanimous' ? 'единогласно' : 'большинством голосов';
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
