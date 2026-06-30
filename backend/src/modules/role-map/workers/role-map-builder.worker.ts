import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job } from 'bullmq';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import { type SpecialistRoutingJobData } from '../../core-queue/queues';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import {
  buildRoleMapExtractUserMessage,
  ROLE_MAP_EXTRACT_JSON_SCHEMA,
  ROLE_MAP_EXTRACT_SCHEMA_NAME,
  ROLE_MAP_EXTRACT_SYSTEM_PROMPT,
  ROLE_MAP_EXTRACT_TASK_TYPE,
  type RoleMapExtractBlock,
} from '../prompts/role-map-extract.prompt';
import { AuthorityBoundaryService } from '../services/authority-boundary.service';
import { DecisionPolicyService } from '../services/decision-policy.service';
import { InteractionService } from '../services/interaction.service';
import { RequiredKnowledgeService } from '../services/required-knowledge.service';
import { ResponsibilityElementService } from '../services/responsibility-element.service';
import { RoleMapBuilderService } from '../services/role-map-builder.service';
import { resolveRoleMapTenantTop } from '../utils/tenant-top';

@Injectable()
export class RoleMapBuilderWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RoleMapBuilderWorker.name);
  private timer: NodeJS.Timeout | null = null;

  static readonly SPECIALIST_NAME = '3-8-role-map-builder';
  static readonly AUTO_EXTRACT_MIN_CONFIDENCE = 0.7;
  static readonly BATCH_SIZE = 5;
  private static readonly RELEVANT_SIGNALS = new Set([
    'expertise',
    'competence',
    'methodology_step',
  ]);

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ResponsibilityElementService)
    private readonly responsibilities: ResponsibilityElementService,
    @Inject(AuthorityBoundaryService)
    private readonly authority: AuthorityBoundaryService,
    @Inject(RequiredKnowledgeService)
    private readonly knowledge: RequiredKnowledgeService,
    @Inject(DecisionPolicyService)
    private readonly decisions: DecisionPolicyService,
    @Inject(InteractionService)
    private readonly interactions: InteractionService,
    @Inject(RoleMapBuilderService)
    private readonly builder: RoleMapBuilderService,
  ) {}

  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  onModuleInit(): void {
    if (!this.cfg.roleMap.builderEnabled) {
      this.logger.debug(
        'RoleMapBuilderWorker: disabled (ROLE_MAP_BUILDER_ENABLED=false), таймер батчей не запускаю',
      );
      return;
    }
    this.timer = setInterval(() => {
      void this.flushExpiredBatches().catch((err) => {
        this.logger.debug(
          { err: err instanceof Error ? err.message : String(err) },
          'role-map-builder: ошибка flushExpiredBatches',
        );
      });
    }, 30_000);
    if (this.timer && typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async handle(job: Job<SpecialistRoutingJobData>): Promise<void> {
    if (!this.cfg.roleMap.builderEnabled) return;
    await this.pipe.job(SystemLogPipeline.KNOWLEDGE_GRAPH, 'role-map.builder', job, () =>
      this.process(job),
    );
  }

  private async process(job: Job<SpecialistRoutingJobData>): Promise<void> {
    const { blockId, tenantId, signalType } = job.data;
    if (!RoleMapBuilderWorker.RELEVANT_SIGNALS.has(signalType)) {
      this.metrics.incCoreSpecialistSkipped({
        specialist: RoleMapBuilderWorker.SPECIALIST_NAME,
        reason: 'signal_out_of_scope',
      });
      return;
    }

    const block = await this.prisma.ideaBlock.findUnique({
      where: { id_tenantId: { id: blockId, tenantId } },
      select: {
        id: true,
        tenantId: true,
        status: true,
        roleId: true,
        roleRelevant: true,
      },
    });
    if (!block) {
      this.metrics.incCoreSpecialistSkipped({
        specialist: RoleMapBuilderWorker.SPECIALIST_NAME,
        reason: 'block_not_found',
      });
      return;
    }
    if (block.tenantId !== tenantId) {
      this.metrics.incCoreSpecialistSkipped({
        specialist: RoleMapBuilderWorker.SPECIALIST_NAME,
        reason: 'tenant_mismatch',
      });
      return;
    }
    if (block.status !== 'canonical') {
      this.metrics.incCoreSpecialistSkipped({
        specialist: RoleMapBuilderWorker.SPECIALIST_NAME,
        reason: 'not_canonical',
      });
      return;
    }
    if (!block.roleId || !block.roleRelevant) {
      this.metrics.incCoreSpecialistSkipped({
        specialist: RoleMapBuilderWorker.SPECIALIST_NAME,
        reason: 'signal_out_of_scope',
      });
      return;
    }
    const roleId = block.roleId;

    const listKey = this.listKey(tenantId, roleId);
    const setKey = this.setKey(tenantId, roleId);
    const sinceKey = this.sinceKey(tenantId, roleId);
    const ttlSec = this.cfg.roleMap.batchTimeoutSeconds * 4;

    try {
      const added = await this.redis.client.sadd(setKey, blockId);
      if (added === 1) {
        await this.redis.client.rpush(listKey, blockId);
        await this.redis.client.expire(listKey, ttlSec);
        await this.redis.client.expire(setKey, ttlSec);
      }
      await this.redis.client.set(sinceKey, String(Date.now()), 'EX', ttlSec, 'NX');
    } catch (err) {
      this.logger.warn(
        {
          tenantId,
          roleId,
          blockId,
          err: err instanceof Error ? err.message : String(err),
        },
        'role-map-builder: Redis error при добавлении в батч',
      );
      return;
    }

    const size = await this.redis.client.llen(listKey);
    if (size >= RoleMapBuilderWorker.BATCH_SIZE) {
      await this.flushBatch({ tenantId, roleId });
    }
  }

  private async flushExpiredBatches(): Promise<void> {
    const pattern = `rolemap:since:*`;
    let cursor = '0';
    const expired: Array<{ tenantId: string; roleId: string }> = [];
    const timeoutMs = this.cfg.roleMap.batchTimeoutSeconds * 1000;
    do {
      const [next, keys] = await this.redis.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      for (const key of keys) {
        const sinceRaw = await this.redis.client.get(key);
        if (!sinceRaw) continue;
        const since = Number(sinceRaw);
        if (!Number.isFinite(since)) continue;
        if (Date.now() - since < timeoutMs) continue;
        const tail = key.substring('rolemap:since:'.length);
        const sep = tail.lastIndexOf(':');
        if (sep <= 0) continue;
        const tenantId = tail.substring(0, sep);
        const roleId = tail.substring(sep + 1);
        if (tenantId && roleId) expired.push({ tenantId, roleId });
      }
    } while (cursor !== '0');

    for (const { tenantId, roleId } of expired) {
      try {
        await this.flushBatch({ tenantId, roleId });
      } catch (err) {
        this.logger.warn(
          {
            tenantId,
            roleId,
            err: err instanceof Error ? err.message : String(err),
          },
          'role-map-builder: ошибка flushBatch для (tenant, role)',
        );
      }
    }
  }

  private async flushBatch(args: { tenantId: string; roleId: string }): Promise<void> {
    const listKey = this.listKey(args.tenantId, args.roleId);
    const setKey = this.setKey(args.tenantId, args.roleId);
    const sinceKey = this.sinceKey(args.tenantId, args.roleId);

    const multi = this.redis.client.multi();
    multi.lrange(listKey, 0, -1);
    multi.del(listKey);
    multi.del(setKey);
    multi.del(sinceKey);
    const results = await multi.exec();
    const blockIds = (results?.[0]?.[1] as string[] | undefined) ?? [];
    if (blockIds.length === 0) return;

    const tenantTop = resolveRoleMapTenantTop(args.tenantId);
    this.logger.debug(
      { tenantId: args.tenantId, roleId: args.roleId, batchSize: blockIds.length },
      'role-map-builder: flush batch',
    );

    let outcome: 'built' | 'skipped_below_threshold' | 'llm_error' | 'db_error' = 'built';

    const role = await this.prisma.role.findUnique({
      where: { id: args.roleId },
      include: {
        department: { select: { id: true, name: true } },
        jobDescriptions: {
          where: { deletedAt: null },
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });
    if (!role || role.tenantId !== args.tenantId || role.deletedAt) {
      this.metrics.incRoleMapBuilderRun({
        tenantTop,
        result: 'skipped_below_threshold',
      });
      return;
    }

    const blocks = await this.prisma.ideaBlock.findMany({
      where: {
        id: { in: blockIds },
        tenantId: args.tenantId,
        status: 'canonical',
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    if (blocks.length < 2) {
      this.metrics.incRoleMapBuilderRun({
        tenantTop,
        result: 'skipped_below_threshold',
      });
      await this.builder.recomputeCompleteness({
        tenantId: args.tenantId,
        roleId: args.roleId,
      });
      return;
    }

    const [knownRoles, knownDepts] = await Promise.all([
      this.prisma.role.findMany({
        where: { tenantId: args.tenantId, deletedAt: null },
        select: { id: true, name: true },
        take: 50,
      }),
      this.prisma.department.findMany({
        where: { tenantId: args.tenantId, deletedAt: null },
        select: { id: true, name: true },
        take: 50,
      }),
    ]);

    const promptBlocks: RoleMapExtractBlock[] = blocks.map((b) => ({
      id: b.id,
      signalType: b.signalType,
      text: b.trustedAnswer.slice(0, 400),
      createdAt: b.createdAt.toISOString(),
    }));

    const userMessage = buildRoleMapExtractUserMessage({
      role: {
        id: role.id,
        name: role.name,
        departmentName: role.department?.name ?? null,
      },
      jobDescriptionMd: role.jobDescriptions[0]?.contentMd ?? null,
      knownRoles,
      knownDepartments: knownDepts,
      blocks: promptBlocks,
    });

    const stop = this.metrics.startRoleMapExtractTimer();
    const guardOn = this.isPromptInjectionGuardEnabled();
    let parsedRaw: unknown;
    try {
      const result = await this.llm.call({
        taskType: ROLE_MAP_EXTRACT_TASK_TYPE,
        systemPrompt: guardOn
          ? withInjectionGuard(ROLE_MAP_EXTRACT_SYSTEM_PROMPT)
          : ROLE_MAP_EXTRACT_SYSTEM_PROMPT,
        userMessage: guardOn ? wrapUserData(userMessage) : userMessage,
        tenantId: args.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: ROLE_MAP_EXTRACT_SCHEMA_NAME,
          schema: ROLE_MAP_EXTRACT_JSON_SCHEMA,
          strict: true,
        },
        dataClass: 'sensitive',
        sourceRef: { type: 'role-map-builder', id: args.roleId },
      });
      parsedRaw = JSON.parse(result.text);
    } catch (err) {
      stop();
      this.metrics.incRoleMapBuilderRun({ tenantTop, result: 'llm_error' });
      this.logger.warn(
        {
          tenantId: args.tenantId,
          roleId: args.roleId,
          err: err instanceof Error ? err.message : String(err),
        },
        'role-map-builder: LLM/parse упал — пропускаю батч',
      );
      return;
    }
    stop();

    const parsed = parsedRaw as Partial<ExtractedRoleMap> | null;
    if (!parsed) {
      this.metrics.incRoleMapBuilderRun({ tenantTop, result: 'db_error' });
      return;
    }

    const knownRoleIds = new Set(knownRoles.map((r) => r.id));
    const knownDeptIds = new Set(knownDepts.map((d) => d.id));

    try {
      for (const r of parsed.responsibilities ?? []) {
        if (!r?.name || !r.kind) continue;
        if ((r.confidence ?? 0) < RoleMapBuilderWorker.AUTO_EXTRACT_MIN_CONFIDENCE) continue;
        await this.responsibilities.upsertByName({
          tenantId: args.tenantId,
          roleId: args.roleId,
          kind: r.kind,
          name: r.name,
          description: r.description ?? null,
          sourceBlockIds: filterValidEvidence(r.evidence, blockIds),
          confidence: r.confidence ?? null,
        });
      }
      for (const a of parsed.authority ?? []) {
        if (!a?.scope || !a.kind) continue;
        if ((a.confidence ?? 0) < RoleMapBuilderWorker.AUTO_EXTRACT_MIN_CONFIDENCE) continue;
        const approverRoleId =
          a.approverRoleId && knownRoleIds.has(a.approverRoleId) ? a.approverRoleId : null;
        await this.authority.upsertByScope({
          tenantId: args.tenantId,
          roleId: args.roleId,
          kind: a.kind,
          scope: a.scope,
          approverRoleId,
          thresholdsJson:
            a.thresholdRubles !== null && a.thresholdRubles !== undefined
              ? { rubles: a.thresholdRubles }
              : null,
          sourceBlockIds: filterValidEvidence(a.evidence, blockIds),
          confidence: a.confidence ?? null,
        });
      }
      for (const k of parsed.knowledge ?? []) {
        if (!k?.topic || !k.importance) continue;
        if ((k.confidence ?? 0) < RoleMapBuilderWorker.AUTO_EXTRACT_MIN_CONFIDENCE) continue;
        await this.knowledge.upsertByTopic({
          tenantId: args.tenantId,
          roleId: args.roleId,
          topic: k.topic,
          importance: k.importance,
          description: k.description ?? null,
          expectedLevel: k.expectedLevel ?? null,
          sourceBlockIds: filterValidEvidence(k.evidence, blockIds),
          confidence: k.confidence ?? null,
        });
      }
      for (const d of parsed.decision_policies ?? []) {
        if (!d?.name || !d.ruleDescription) continue;
        if ((d.confidence ?? 0) < RoleMapBuilderWorker.AUTO_EXTRACT_MIN_CONFIDENCE) continue;
        await this.decisions.upsertByName({
          tenantId: args.tenantId,
          roleId: args.roleId,
          name: d.name,
          ruleDescription: d.ruleDescription,
          conditionDescription: d.conditionDescription ?? null,
          sourceBlockIds: filterValidEvidence(d.evidence, blockIds),
          confidence: d.confidence ?? null,
        });
      }
      for (const i of parsed.interactions ?? []) {
        if (!i?.kind) continue;
        if ((i.confidence ?? 0) < RoleMapBuilderWorker.AUTO_EXTRACT_MIN_CONFIDENCE) continue;
        const counterpartRoleId =
          i.counterpartRoleId && knownRoleIds.has(i.counterpartRoleId) ? i.counterpartRoleId : null;
        const counterpartDepartmentId =
          i.counterpartDepartmentId && knownDeptIds.has(i.counterpartDepartmentId)
            ? i.counterpartDepartmentId
            : null;
        const counterpartExternal = i.counterpartExternal ?? null;
        if (!counterpartRoleId && !counterpartDepartmentId && !counterpartExternal) {
          continue;
        }
        await this.interactions.upsertByCounterpart({
          tenantId: args.tenantId,
          roleId: args.roleId,
          kind: i.kind,
          counterpartRoleId,
          counterpartDepartmentId,
          counterpartExternal,
          frequency: i.frequency ?? null,
          description: i.description ?? null,
          sourceBlockIds: filterValidEvidence(i.evidence, blockIds),
          confidence: i.confidence ?? null,
        });
      }
    } catch (err) {
      outcome = 'db_error';
      this.logger.warn(
        {
          tenantId: args.tenantId,
          roleId: args.roleId,
          err: err instanceof Error ? err.message : String(err),
        },
        'role-map-builder: ошибка upsert (DB)',
      );
    }

    this.metrics.incRoleMapBuilderRun({ tenantTop, result: outcome });

    try {
      await this.builder.recomputeCompleteness({
        tenantId: args.tenantId,
        roleId: args.roleId,
      });
    } catch (err) {
      this.logger.debug(
        {
          tenantId: args.tenantId,
          roleId: args.roleId,
          err: err instanceof Error ? err.message : String(err),
        },
        'role-map-builder: recomputeCompleteness упал (best-effort)',
      );
    }
  }

  private listKey(tenantId: string, roleId: string): string {
    return `rolemap:batch:${tenantId}:${roleId}`;
  }
  private setKey(tenantId: string, roleId: string): string {
    return `rolemap:batchset:${tenantId}:${roleId}`;
  }
  private sinceKey(tenantId: string, roleId: string): string {
    return `rolemap:since:${tenantId}:${roleId}`;
  }
}

interface ExtractedRoleMap {
  responsibilities: Array<{
    kind: 'outcome' | 'function' | 'activity';
    name: string;
    description: string;
    evidence: string[];
    confidence: number;
  }>;
  authority: Array<{
    kind: 'allowed' | 'requires_approval' | 'forbidden';
    scope: string;
    approverRoleId: string | null;
    thresholdRubles: number | null;
    evidence: string[];
    confidence: number;
  }>;
  knowledge: Array<{
    topic: string;
    description: string | null;
    importance: 'mandatory' | 'preferred' | 'nice_to_have';
    expectedLevel: 'beginner' | 'intermediate' | 'expert' | null;
    evidence: string[];
    confidence: number;
  }>;
  decision_policies: Array<{
    name: string;
    conditionDescription: string | null;
    ruleDescription: string;
    evidence: string[];
    confidence: number;
  }>;
  interactions: Array<{
    kind: string;
    counterpartRoleId: string | null;
    counterpartDepartmentId: string | null;
    counterpartExternal: string | null;
    frequency: 'daily' | 'weekly' | 'monthly' | 'ad_hoc' | null;
    description: string | null;
    evidence: string[];
    confidence: number;
  }>;
}

function filterValidEvidence(
  evidence: string[] | undefined | null,
  validBlockIds: string[],
): string[] {
  if (!evidence) return [];
  const valid = new Set(validBlockIds);
  const filtered = evidence.filter((id) => valid.has(id));
  return filtered.slice(0, 5);
}
