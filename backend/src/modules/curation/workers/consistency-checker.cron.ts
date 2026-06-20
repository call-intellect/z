import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { ProbeService } from '../../probe/probe.service';

interface ViolationRow {
  entityId: string;
  entityType: string;
  entityName?: string | null;
}

const RULE_IDS = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'] as const;
type RuleId = (typeof RULE_IDS)[number];

const RULE_DESCRIPTIONS: Record<RuleId, string> = {
  R1: 'Документ не привязан ни к одному процессу',
  R2: 'Шаг процесса не создаёт ни одного результата',
  R3: 'У шага процесса не назначен ответственный',
  R4: 'У роли есть зона ответственности без привязки к задачам',
  R5: 'Зона ответственности без измеримой метрики',
  R6: 'У компании не заполнены миссия, видение и стратегия',
};

const ENTITY_TYPE_WORD_RU: Record<string, string> = {
  document: 'документ',
  process_step: 'шаг процесса',
  role: 'роль',
  responsibility: 'зона ответственности',
  metric: 'метрика',
  company_profile: 'профиль компании',
};

function entityTypeWordRu(entityType: string): string {
  return ENTITY_TYPE_WORD_RU[entityType] ?? entityType;
}

@Injectable()
export class ConsistencyCheckerService {
  private readonly logger = new Logger(ConsistencyCheckerService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(ProbeService)
    private readonly probe?: ProbeService,
  ) {}

  async runForAllOrgs(): Promise<{
    scannedOrgs: number;
    violationsTotal: number;
    perRule: Record<RuleId, number>;
  }> {
    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    const perRule: Record<RuleId, number> = {
      R1: 0,
      R2: 0,
      R3: 0,
      R4: 0,
      R5: 0,
      R6: 0,
    };
    let violationsTotal = 0;

    for (const org of orgs) {
      try {
        const owners = await this.findOwnerCandidates(org.id);
        for (const ruleId of RULE_IDS) {
          let rows: ViolationRow[] = [];
          try {
            rows = await this.executeRule(ruleId, org.id);
          } catch (err) {
            this.logger.warn(
              {
                tenantId: org.id,
                rule: ruleId,
                err: err instanceof Error ? err.message : String(err),
              },
              'consistency-checker: ошибка выполнения правила — пропускаю',
            );
            continue;
          }
          for (const v of rows) {
            const isFirstTime = await this.dedupAcquire(org.id, ruleId, v.entityId);
            if (!isFirstTime) continue;
            this.metrics.incConsistencyViolation({ rule: ruleId });
            perRule[ruleId] += 1;
            violationsTotal += 1;
            await this.emitProbe({
              tenantId: org.id,
              rule: ruleId,
              violation: v,
              ownerCandidates: owners,
            });
          }
        }
      } catch (err) {
        this.logger.warn(
          {
            tenantId: org.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'consistency-checker: ошибка обработки Org — пропускаю',
        );
      }
    }

    return {
      scannedOrgs: orgs.length,
      violationsTotal,
      perRule,
    };
  }

  private async executeRule(rule: RuleId, tenantId: string): Promise<ViolationRow[]> {
    switch (rule) {
      case 'R1':
        return this.ruleR1ArtifactsWithoutSourceProcess(tenantId);
      case 'R2':
        return this.ruleR2ProcessStepsWithoutOutput(tenantId);
      case 'R3':
        return this.ruleR3ProcessStepsWithoutOwnerRole(tenantId);
      case 'R4':
        return this.ruleR4ResponsibilityWithoutLink(tenantId);
      case 'R5':
        return this.ruleR5ResponsibilityWithoutMetric(tenantId);
      case 'R6':
        return this.ruleR6CompanyProfileMissingMVS(tenantId);
    }
  }

  private async ruleR1ArtifactsWithoutSourceProcess(tenantId: string): Promise<ViolationRow[]> {
    const docs = await this.prisma.document.findMany({
      where: { tenantId },
      select: { id: true, name: true },
      take: 1000,
    });
    if (docs.length === 0) return [];
    const docIds = docs.map((d) => d.id);
    const links = await this.prisma.entityLink.findMany({
      where: {
        tenantId,
        toEntityId: { in: docIds },
        toType: 'document',
        relationType: 'produces',
        status: 'active',
        deletedAt: null,
      },
      select: { toEntityId: true },
    });
    const linkedSet = new Set(links.map((l) => l.toEntityId));
    return docs
      .filter((d) => !linkedSet.has(d.id))
      .map((d) => ({
        entityId: d.id,
        entityType: 'document',
        entityName: d.name,
      }));
  }

  private async ruleR2ProcessStepsWithoutOutput(tenantId: string): Promise<ViolationRow[]> {
    const steps = await this.prisma.processStep.findMany({
      where: { tenantId },
      select: { id: true, name: true },
      take: 1000,
    });
    if (steps.length === 0) return [];
    const ids = steps.map((s) => s.id);
    const links = await this.prisma.entityLink.findMany({
      where: {
        tenantId,
        fromEntityId: { in: ids },
        fromType: 'process_step',
        relationType: 'produces',
        status: 'active',
        deletedAt: null,
      },
      select: { fromEntityId: true },
    });
    const have = new Set(links.map((l) => l.fromEntityId));
    return steps
      .filter((s) => !have.has(s.id))
      .map((s) => ({
        entityId: s.id,
        entityType: 'process_step',
        entityName: s.name,
      }));
  }

  private async ruleR3ProcessStepsWithoutOwnerRole(tenantId: string): Promise<ViolationRow[]> {
    const steps = await this.prisma.processStep.findMany({
      where: { tenantId },
      select: { id: true, name: true },
      take: 1000,
    });
    if (steps.length === 0) return [];
    const ids = steps.map((s) => s.id);
    const links = await this.prisma.entityLink.findMany({
      where: {
        tenantId,
        toEntityId: { in: ids },
        toType: 'process_step',
        relationType: { in: ['responsible_for', 'owned_by'] },
        fromType: 'role',
        status: 'active',
        deletedAt: null,
      },
      select: { toEntityId: true },
    });
    const have = new Set(links.map((l) => l.toEntityId));
    return steps
      .filter((s) => !have.has(s.id))
      .map((s) => ({
        entityId: s.id,
        entityType: 'process_step',
        entityName: s.name,
      }));
  }

  private async ruleR4ResponsibilityWithoutLink(tenantId: string): Promise<ViolationRow[]> {
    const elements = await this.prisma.responsibilityElement.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
      take: 1000,
    });
    if (elements.length === 0) return [];
    const ids = elements.map((e) => e.id);
    const links = await this.prisma.entityLink.findMany({
      where: {
        tenantId,
        fromEntityId: { in: ids },
        fromType: 'responsibility_element',
        relationType: 'responsible_for',
        status: 'active',
        deletedAt: null,
      },
      select: { fromEntityId: true },
    });
    const have = new Set(links.map((l) => l.fromEntityId));
    return elements
      .filter((e) => !have.has(e.id))
      .map((e) => ({
        entityId: e.id,
        entityType: 'responsibility_element',
        entityName: e.name,
      }));
  }

  private async ruleR5ResponsibilityWithoutMetric(tenantId: string): Promise<ViolationRow[]> {
    const elements = await this.prisma.responsibilityElement.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, name: true },
      take: 1000,
    });
    if (elements.length === 0) return [];
    const ids = elements.map((e) => e.id);
    const links = await this.prisma.entityLink.findMany({
      where: {
        tenantId,
        fromEntityId: { in: ids },
        fromType: 'responsibility_element',
        toType: 'metric',
        relationType: 'measured_by',
        status: 'active',
        deletedAt: null,
      },
      select: { fromEntityId: true },
    });
    const have = new Set(links.map((l) => l.fromEntityId));
    return elements
      .filter((e) => !have.has(e.id))
      .map((e) => ({
        entityId: e.id,
        entityType: 'responsibility_element',
        entityName: e.name,
      }));
  }

  private async ruleR6CompanyProfileMissingMVS(tenantId: string): Promise<ViolationRow[]> {
    const cp = await this.prisma.companyProfile.findUnique({
      where: { tenantId },
      select: {
        id: true,
        displayName: true,
        missionJson: true,
        visionJson: true,
        strategyJson: true,
      },
    });
    if (!cp) return [];
    if (cp.missionJson === null && cp.visionJson === null && cp.strategyJson === null) {
      return [
        {
          entityId: cp.id,
          entityType: 'company_profile',
          entityName: cp.displayName ?? null,
        },
      ];
    }
    return [];
  }

  private async dedupAcquire(tenantId: string, rule: RuleId, entityId: string): Promise<boolean> {
    const ttl = await this.cfg.getDynamic<number>(
      'curation.consistencyCheckerDedupTtlSeconds',
      'CONSISTENCY_CHECKER_DEDUP_TTL_SECONDS',
      14_400,
    );
    const key = `consistency:dedup:${tenantId}:${rule}:${this.hash(entityId)}`;
    try {
      const res = await this.redis.client.set(key, '1', 'EX', ttl, 'NX');
      return res !== null;
    } catch (err) {
      this.logger.warn(
        {
          tenantId,
          rule,
          err: err instanceof Error ? err.message : String(err),
        },
        'consistency-checker: Redis SETNX упал — продолжаю без дедупа',
      );
      return true;
    }
  }

  private hash(v: string): string {
    return createHash('sha1').update(v).digest('hex').slice(0, 16);
  }

  private async findOwnerCandidates(tenantId: string): Promise<string[]> {
    const rows = await this.prisma.membership.findMany({
      where: {
        orgId: tenantId,
        role: { in: ['owner', 'admin'] },
      },
      select: { userId: true },
      take: 10,
    });
    return rows.map((r) => r.userId);
  }

  private async emitProbe(args: {
    tenantId: string;
    rule: RuleId;
    violation: ViolationRow;
    ownerCandidates: string[];
  }): Promise<void> {
    if (!this.probe) {
      this.logger.debug(
        { rule: args.rule },
        'consistency-checker: ProbeService недоступен — probe пропущен',
      );
      return;
    }
    if (args.ownerCandidates.length === 0) return;
    const ruleDescription = RULE_DESCRIPTIONS[args.rule];
    const entityName = args.violation.entityName || entityTypeWordRu(args.violation.entityType);
    try {
      await this.probe.suggest({
        tenantId: args.tenantId,
        emittedByService: 'curation.consistency_checker',
        reason: `consistency_violation.${args.rule}`,
        payload: {
          message: `${ruleDescription}: «${entityName}»`,
          kind: 'consistency_violation',
          severity: 'medium',
          rule: args.rule,
          entityId: args.violation.entityId,
          entityType: args.violation.entityType,
          contextCardId: args.violation.entityId,
          contextCardKind: args.violation.entityType,
          actionUrl: `/curation?consistency=${args.rule}&entityId=${encodeURIComponent(args.violation.entityId)}`,
        },
        recipientCandidates: args.ownerCandidates,
        priorityHint: 0.4,
        dataClass: 'internal',
      });
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          rule: args.rule,
          entityId: args.violation.entityId,
          err: err instanceof Error ? err.message : String(err),
        },
        'consistency-checker: ошибка ProbeService.suggest — пропускаю',
      );
    }
  }
}

@Injectable()
export class ConsistencyCheckerCron {
  private readonly logger = new Logger(ConsistencyCheckerCron.name);

  constructor(
    @Inject(ConsistencyCheckerService)
    private readonly checker: ConsistencyCheckerService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  @Cron('0 */4 * * *')
  async runScheduled(): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'curation.consistencyCheckerEnabled',
      'CONSISTENCY_CHECKER_ENABLED',
      true,
    );
    if (!enabled) {
      this.logger.debug('consistency-checker: выключен через ENV — пропуск');
      return;
    }
    const startedAt = Date.now();
    try {
      const summary = await this.checker.runForAllOrgs();
      const seconds = (Date.now() - startedAt) / 1000;
      this.metrics.observeConsistencyCheckerDuration(seconds);
      this.logger.debug(
        { ...summary, durationSeconds: seconds },
        'consistency-checker: проход завершён',
      );
    } catch (err) {
      const seconds = (Date.now() - startedAt) / 1000;
      this.metrics.observeConsistencyCheckerDuration(seconds);
      this.logger.error(
        {
          err: err instanceof Error ? err.message : String(err),
          durationSeconds: seconds,
        },
        'consistency-checker: непойманная ошибка',
      );
    }
  }

  static get cronExpression(): string {
    return '0 */4 * * *';
  }
}
