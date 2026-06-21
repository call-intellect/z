import { Inject, Injectable, Logger } from '@nestjs/common';
import { type ProbeStatus } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { applyInputGuards } from '../../ai/services/prompts/common';
import {
  SUBJECT_MEMORY_JUDGE_JSON_SCHEMA,
  SUBJECT_MEMORY_JUDGE_SCHEMA_NAME,
  SUBJECT_MEMORY_JUDGE_SYSTEM_PROMPT,
  SUBJECT_MEMORY_JUDGE_USER_TEMPLATE,
} from '../prompts/subject-memory-judge.prompt';

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const WORSENED_EPSILON = 0.1;

const BAD_PROBE_STATUSES: readonly ProbeStatus[] = ['expired'];

interface ActivationRule {
  id: string;
  tenantId: string;
  kind: string;
  contextText: string;
  ruleText: string;
  confirmCount: number;
  refuteCount: number;
  confidence: unknown;
  canaryAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class SubjectMemoryActivationService {
  private readonly logger = new Logger(SubjectMemoryActivationService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async promoteShadowRules(): Promise<{ promoted: number; rejected: number }> {
    if (!this.cfg.subjectMemory.enabled) return { promoted: 0, rejected: 0 };

    const ttlDays = this.cfg.subjectMemory.ttlDays;
    const rules = await this.prisma.subjectMemory.findMany({
      where: {
        status: 'shadow',
        confirmCount: { gte: this.cfg.subjectMemory.shadowToCanaryMinConfirm },
      },
      take: 100,
      orderBy: { createdAt: 'asc' },
    });

    let promoted = 0;
    let rejected = 0;
    for (const rule of rules) {
      try {
        const approved = await this.judgeEnsemble(rule);
        if (!approved) {
          rejected++;
          continue;
        }
        const now = new Date();
        await this.prisma.subjectMemory.update({
          where: { id: rule.id },
          data: {
            status: 'canary',
            canaryAt: now,
            staleAfter: new Date(now.getTime() + ttlDays * MS_PER_DAY),
          },
        });
        promoted++;
      } catch (err) {
        this.logger.warn(
          {
            id: rule.id,
            tenantId: rule.tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'subject-memory-activation: promote одного правила упал — пропускаю (fail-open)',
        );
      }
    }

    this.logger.debug(
      { scanned: rules.length, promoted, rejected },
      'subject-memory-activation: promoteShadowRules завершён',
    );
    return { promoted, rejected };
  }

  private async judgeEnsemble(rule: ActivationRule): Promise<boolean> {
    const models = this.cfg.subjectMemory.judgeModels;
    const quorum = this.cfg.subjectMemory.judgeQuorum;
    if (models.length === 0 || quorum <= 0) return false;

    const guardOn = this.cfg.aiFeatures?.promptInjectionGuardEnabled !== false;
    const guarded = applyInputGuards(
      SUBJECT_MEMORY_JUDGE_SYSTEM_PROMPT,
      SUBJECT_MEMORY_JUDGE_USER_TEMPLATE({
        kind: rule.kind,
        contextText: rule.contextText,
        ruleText: rule.ruleText,
      }),
      { enabled: guardOn, injection: true },
    );

    let approvals = 0;
    for (let i = 0; i < quorum; i++) {
      const model = models[i % models.length];
      try {
        const result = await this.llm.call({
          taskType: 'subject-memory-judge',
          systemPrompt: guarded.system,
          userMessage: guarded.user,
          tenantId: rule.tenantId,
          model,
          responseFormat: {
            type: 'json_schema',
            name: SUBJECT_MEMORY_JUDGE_SCHEMA_NAME,
            schema: SUBJECT_MEMORY_JUDGE_JSON_SCHEMA,
            strict: true,
          },
          sourceRef: { type: 'subject-memory-judge', id: rule.id },
          dataClass: 'internal',
        });
        const parsed = JSON.parse(result.text) as { approve?: unknown };
        if (parsed.approve === true) approvals++;
      } catch (err) {
        this.logger.debug(
          {
            id: rule.id,
            model,
            err: err instanceof Error ? err.message : String(err),
          },
          'subject-memory-activation: голос judge упал — считаю «против» (fail-open)',
        );
      }
    }

    return approvals === quorum;
  }

  async evaluateCanaryRules(): Promise<{
    activated: number;
    rolledBack: number;
  }> {
    if (!this.cfg.subjectMemory.enabled) return { activated: 0, rolledBack: 0 };

    const windowMs =
      this.cfg.subjectMemory.canaryRollbackWindowHours * MS_PER_HOUR;
    const cutoff = new Date(Date.now() - windowMs);
    const rules = await this.prisma.subjectMemory.findMany({
      where: { status: 'canary', canaryAt: { lte: cutoff } },
      take: 100,
      orderBy: { canaryAt: 'asc' },
    });

    let activated = 0;
    let rolledBack = 0;
    for (const rule of rules) {
      try {
        if (rule.refuteCount > rule.confirmCount) {
          await this.prisma.subjectMemory.update({
            where: { id: rule.id },
            data: { status: 'rolled_back' },
          });
          this.metrics.incSubjectMemoryRuleRolledBack({
            cause: 'refute_exceeds_confirm',
          });
          rolledBack++;
          continue;
        }

        const worsened = await this.measureRollbackWorsened(rule);
        if (worsened) {
          await this.prisma.subjectMemory.update({
            where: { id: rule.id },
            data: { status: 'rolled_back' },
          });
          this.metrics.incSubjectMemoryRuleRolledBack({
            cause: 'metric_worsened',
          });
          rolledBack++;
          continue;
        }

        await this.prisma.subjectMemory.update({
          where: { id: rule.id },
          data: { status: 'active' },
        });
        this.metrics.incSubjectMemoryRuleActivated();
        activated++;
      } catch (err) {
        this.logger.warn(
          {
            id: rule.id,
            tenantId: rule.tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'subject-memory-activation: evaluate одного правила упал — пропускаю (fail-open)',
        );
      }
    }

    this.logger.debug(
      { scanned: rules.length, activated, rolledBack },
      'subject-memory-activation: evaluateCanaryRules завершён',
    );
    return { activated, rolledBack };
  }

  async measureRollbackWorsened(rule: {
    tenantId: string;
    canaryAt: Date | null;
  }): Promise<boolean> {
    if (!rule.canaryAt) return false;
    try {
      const windowMs =
        this.cfg.subjectMemory.canaryRollbackWindowHours * MS_PER_HOUR;
      const canaryMs = rule.canaryAt.getTime();
      const beforeStart = new Date(canaryMs - windowMs);
      const beforeEnd = rule.canaryAt;
      const afterStart = rule.canaryAt;
      const afterEnd = new Date(Math.min(canaryMs + windowMs, Date.now()));

      const beforeRate = await this.badProbeRate(
        rule.tenantId,
        beforeStart,
        beforeEnd,
      );
      const afterRate = await this.badProbeRate(
        rule.tenantId,
        afterStart,
        afterEnd,
      );

      return afterRate > beforeRate + WORSENED_EPSILON;
    } catch (err) {
      this.logger.debug(
        {
          tenantId: rule.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'subject-memory-activation: measureRollbackWorsened упал — не откатываю (консервативно)',
      );
      return false;
    }
  }

  private async badProbeRate(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<number> {
    const total = await this.prisma.probeEvent.count({
      where: { tenantId, createdAt: { gte: from, lt: to } },
    });
    if (total === 0) return 0;
    const bad = await this.prisma.probeEvent.count({
      where: {
        tenantId,
        createdAt: { gte: from, lt: to },
        status: { in: [...BAD_PROBE_STATUSES] },
      },
    });
    return bad / total;
  }

  async decayStaleRules(): Promise<{ decayed: number; superseded: number }> {
    if (!this.cfg.subjectMemory.enabled) return { decayed: 0, superseded: 0 };

    const ttlDays = this.cfg.subjectMemory.ttlDays;
    const now = new Date();
    const ttlCutoff = new Date(now.getTime() - ttlDays * MS_PER_DAY);
    const rules = await this.prisma.subjectMemory.findMany({
      where: {
        status: { in: ['shadow', 'canary', 'active'] },
        OR: [
          { staleAfter: { lt: now } },
          { staleAfter: null, createdAt: { lt: ttlCutoff } },
        ],
      },
      take: 100,
      orderBy: { createdAt: 'asc' },
    });

    let decayed = 0;
    let superseded = 0;
    for (const rule of rules) {
      try {
        if (rule.refuteCount > rule.confirmCount) {
          await this.prisma.subjectMemory.update({
            where: { id: rule.id },
            data: { status: 'superseded' },
          });
          superseded++;
          continue;
        }
        await this.prisma.subjectMemory.update({
          where: { id: rule.id },
          data: {
            confidence: Math.max(0, Number(rule.confidence) - 0.1),
            staleAfter: new Date(Date.now() + ttlDays * MS_PER_DAY),
          },
        });
        decayed++;
      } catch (err) {
        this.logger.warn(
          {
            id: rule.id,
            tenantId: rule.tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'subject-memory-activation: decay одного правила упал — пропускаю (fail-open)',
        );
      }
    }

    this.logger.debug(
      { scanned: rules.length, decayed, superseded },
      'subject-memory-activation: decayStaleRules завершён',
    );
    return { decayed, superseded };
  }
}
