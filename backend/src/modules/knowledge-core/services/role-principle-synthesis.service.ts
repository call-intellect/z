import { Inject, Injectable, Logger } from '@nestjs/common';
import { type SkillConfidence, Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { SKILL_SUBJECT_SIGNAL_TYPES } from '../constants/skill-signal-types';
import {
  ROLE_PRINCIPLE_SYNTHESIZE_JSON_SCHEMA,
  ROLE_PRINCIPLE_SYNTHESIZE_SCHEMA_NAME,
  ROLE_PRINCIPLE_SYNTHESIZE_SYSTEM_PROMPT,
  ROLE_PRINCIPLE_SYNTHESIZE_USER_TEMPLATE,
} from '../prompts/role-principle-synthesize.prompt';

import { KnowledgeEmbeddingService } from './embedding.service';

@Injectable()
export class RolePrincipleSynthesisService {
  private readonly logger = new Logger(RolePrincipleSynthesisService.name);

  static readonly METRIC_TYPE = 'role_principle';
  private static readonly GROUP_SIMILARITY_THRESHOLD = 0.78;
  private static readonly MAX_BLOCKS_PER_SYNTHESIS = 200;
  private static readonly MAX_GROUPS_PER_SYNTHESIS = 8;
  private static readonly MAX_QUOTES_PER_GROUP = 10;
  private static readonly MAX_SOURCE_BLOCK_IDS = 50;
  private static readonly DIAGNOSTIC_STOP_MARKERS: readonly string[] = [
    'избегает',
    'не решает сам',
    'не способен',
    'боится',
    'ленив',
    'безответствен',
    'некомпетент',
    'слаб',
  ];

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embedder: KnowledgeEmbeddingService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async synthesizeForRole(args: {
    tenantId: string;
    roleId: string;
  }): Promise<{ created: number; merged: number; skipped: string | null }> {
    const role = await this.prisma.role.findUnique({
      where: { id: args.roleId },
      select: { id: true, name: true, tenantId: true, deletedAt: true },
    });
    if (!role || role.tenantId !== args.tenantId || role.deletedAt) {
      return { created: 0, merged: 0, skipped: 'role_not_found' };
    }

    const [personRoleRows, appointmentRows] = await Promise.all([
      this.prisma.personRole.findMany({
        where: { tenantId: args.tenantId, roleId: args.roleId, validTo: null },
        select: { personId: true },
      }),
      this.prisma.appointment.findMany({
        where: {
          tenantId: args.tenantId,
          roleId: args.roleId,
          validTo: null,
          status: { in: ['active', 'acting'] },
        },
        select: { personId: true },
      }),
    ]);
    const personIds = [...new Set([...personRoleRows, ...appointmentRows].map((r) => r.personId))];
    if (personIds.length === 0) {
      return { created: 0, merged: 0, skipped: 'no_persons' };
    }

    const persons = await this.prisma.person.findMany({
      where: {
        tenantId: args.tenantId,
        id: { in: personIds },
        relationship: 'employee',
        deletedAt: null,
        entityId: { not: null },
      },
      select: { entityId: true },
    });
    const entityIds = persons
      .map((p) => p.entityId)
      .filter((id): id is string => typeof id === 'string');
    if (entityIds.length === 0) {
      return { created: 0, merged: 0, skipped: 'no_entities' };
    }

    const lookbackMs = this.cfg.skill.lookbackMonths * 30 * 24 * 60 * 60 * 1000;
    const since = new Date(Date.now() - lookbackMs);
    const mentions = await this.prisma.ideaBlockEntity.findMany({
      where: {
        entityId: { in: entityIds },
        role: 'subject',
        block: {
          tenantId: args.tenantId,
          status: 'canonical',
          signalType: { in: [...SKILL_SUBJECT_SIGNAL_TYPES] },
          createdAt: { gte: since },
        },
      },
      select: { blockId: true },
      take: RolePrincipleSynthesisService.MAX_BLOCKS_PER_SYNTHESIS,
    });
    const blockIds = [...new Set(mentions.map((m) => m.blockId))];

    const minObs = await this.cfg.getDynamic<number>(
      'knowledge.rolePrincipleMinObservations',
      undefined,
      5,
    );
    if (blockIds.length < minObs) {
      return { created: 0, merged: 0, skipped: 'below_threshold' };
    }

    const rows = await this.prisma.ideaBlock.findMany({
      where: { id: { in: blockIds } },
      select: {
        id: true,
        name: true,
        trustedAnswer: true,
        createdAt: true,
        evidence: { select: { quote: true }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
    });
    const embeddings = await this.loadEmbeddings(rows.map((b) => b.id));
    const blocks = rows.map((b) => ({
      blockId: b.id,
      quote: b.evidence[0]?.quote ?? b.trustedAnswer ?? b.name,
      observedAt: b.createdAt.toISOString(),
      embedding: embeddings.get(b.id) ?? null,
    }));

    const groups = this.groupBlocksBySimilarity(blocks)
      .filter((g) => g.length >= 2)
      .slice(0, RolePrincipleSynthesisService.MAX_GROUPS_PER_SYNTHESIS);
    if (groups.length === 0) {
      return { created: 0, merged: 0, skipped: 'no_groups' };
    }

    const promptGroups = groups.map((g) => ({
      label: (g[0]?.quote ?? '').slice(0, 60),
      quotes: g.slice(0, RolePrincipleSynthesisService.MAX_QUOTES_PER_GROUP).map((b) => ({
        blockId: b.blockId,
        quote: b.quote,
        observedAt: b.observedAt,
      })),
    }));
    const inputIds = new Set(blocks.map((b) => b.blockId));

    let drafts: PrincipleDraft[];
    try {
      const result = await this.llm.call({
        taskType: 'role-principle-synthesize',
        systemPrompt: ROLE_PRINCIPLE_SYNTHESIZE_SYSTEM_PROMPT,
        userMessage: ROLE_PRINCIPLE_SYNTHESIZE_USER_TEMPLATE({
          roleName: role.name,
          groups: promptGroups,
        }),
        tenantId: args.tenantId,
        responseFormat: {
          type: 'json_schema',
          name: ROLE_PRINCIPLE_SYNTHESIZE_SCHEMA_NAME,
          schema: ROLE_PRINCIPLE_SYNTHESIZE_JSON_SCHEMA,
          strict: true,
        },
        sourceRef: { type: 'role_principle', id: args.roleId },
        dataClass: 'internal',
        maxTokens: 8_000,
      });
      if (result.modelUsed) {
        this.metrics.incCoreSpecialistLlmTokens({
          type: RolePrincipleSynthesisService.METRIC_TYPE,
          model: result.modelUsed,
          tier: result.tier ?? 'primary',
          tokens: (result.inputTokens ?? 0) + (result.outputTokens ?? 0),
        });
      }
      drafts = this.parseAndValidate(result.text, inputIds, args.roleId);
    } catch (err) {
      this.logger.warn(
        {
          roleId: args.roleId,
          err: err instanceof Error ? err.message : String(err),
        },
        'role-principle-synthesis: LLM/парс упал — skip роли',
      );
      return { created: 0, merged: 0, skipped: 'llm_error' };
    }

    const dedupThreshold = await this.cfg.getDynamic<number>(
      'knowledge.rolePrincipleDedupThreshold',
      undefined,
      0.85,
    );
    let created = 0;
    let merged = 0;
    for (const draft of drafts) {
      try {
        const outcome = await this.upsertPrinciple({
          tenantId: args.tenantId,
          roleId: args.roleId,
          draft,
          dedupThreshold,
        });
        if (outcome === 'created') {
          created++;
          this.metrics.incRolePrincipleSynthesized({ outcome: 'created' });
        } else if (outcome === 'merged') {
          merged++;
          this.metrics.incRolePrincipleSynthesized({ outcome: 'merged' });
        }
      } catch (err) {
        this.logger.warn(
          {
            roleId: args.roleId,
            situation: draft.situation,
            err: err instanceof Error ? err.message : String(err),
          },
          'role-principle-synthesis: upsert принципа упал — пропускаю',
        );
      }
    }

    return { created, merged, skipped: null };
  }

  private parseAndValidate(
    text: string,
    inputIds: ReadonlySet<string>,
    roleId: string,
  ): PrincipleDraft[] {
    const parsed: unknown = JSON.parse(text);
    const principles = (parsed as { principles?: unknown }).principles;
    if (!Array.isArray(principles)) {
      throw new Error('role-principle-synthesize: нет массива principles');
    }

    const out: PrincipleDraft[] = [];
    for (const raw of principles) {
      const obj = raw as Record<string, unknown>;
      const situation = typeof obj.situation === 'string' ? obj.situation.trim() : '';
      const statement = typeof obj.statement === 'string' ? obj.statement.trim() : '';
      if (!situation || !statement) {
        this.logger.warn(
          { roleId },
          'role-principle-synthesis: пустой situation/statement — отбрасываю',
        );
        continue;
      }

      const sourceBlockIds = Array.isArray(obj.sourceBlockIds)
        ? obj.sourceBlockIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : [];
      const uniqueIds = [...new Set(sourceBlockIds)];
      const isSubset = uniqueIds.every((id) => inputIds.has(id));
      if (!isSubset || uniqueIds.length < 2) {
        this.logger.warn(
          { roleId, situation, sourceBlockIds: uniqueIds },
          'role-principle-synthesis: sourceBlockIds не подмножество входных или < 2 — отбрасываю',
        );
        continue;
      }

      const lower = statement.toLowerCase();
      const marker = RolePrincipleSynthesisService.DIAGNOSTIC_STOP_MARKERS.find((m) =>
        lower.includes(m),
      );
      if (marker) {
        this.logger.warn(
          { roleId, situation, marker },
          'role-principle-synthesis: диагностическая лексика в statement — отбрасываю (rejected_guard)',
        );
        this.metrics.incRolePrincipleSynthesized({
          outcome: 'rejected_guard',
        });
        continue;
      }

      const confidence: SkillConfidence =
        obj.confidence === 'low' || obj.confidence === 'medium' || obj.confidence === 'high'
          ? obj.confidence
          : 'low';

      out.push({
        situation,
        statement,
        sourceBlockIds: uniqueIds.slice(0, RolePrincipleSynthesisService.MAX_SOURCE_BLOCK_IDS),
        confidence,
      });
    }
    return out;
  }

  private async upsertPrinciple(args: {
    tenantId: string;
    roleId: string;
    draft: PrincipleDraft;
    dedupThreshold: number;
  }): Promise<'created' | 'merged'> {
    const embedding = await this.embedder.embedQuery(
      `${args.draft.situation}. ${args.draft.statement}`.slice(0, 2_000),
    );

    if (embedding) {
      const existing = await this.findClosestActivePrinciple({
        tenantId: args.tenantId,
        roleId: args.roleId,
        embedding,
        threshold: args.dedupThreshold,
      });
      if (existing) {
        await this.mergeIntoExisting({ existing, draft: args.draft, embedding });
        return 'merged';
      }
    }

    await this.createNewPrincipleRaw({
      tenantId: args.tenantId,
      roleId: args.roleId,
      draft: args.draft,
      embedding,
    });
    return 'created';
  }

  private async findClosestActivePrinciple(args: {
    tenantId: string;
    roleId: string;
    embedding: number[];
    threshold: number;
  }): Promise<{
    id: string;
    sourceBlockIds: string[];
    observationCount: number;
    confidence: SkillConfidence;
  } | null> {
    const vec = `[${args.embedding.join(',')}]`;
    const maxDistance = 1 - args.threshold;
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string; distance: number }>>(
      `SELECT id, ("embedding" <=> $1::vector) AS distance
         FROM "role_principles"
        WHERE "tenantId" = $2
          AND "roleId" = $3
          AND "status" = 'active'
          AND "embedding" IS NOT NULL
        ORDER BY "embedding" <=> $1::vector ASC
        LIMIT 1`,
      vec,
      args.tenantId,
      args.roleId,
    );
    const top = rows[0];
    if (!top) return null;
    if (typeof top.distance !== 'number' || top.distance > maxDistance) {
      return null;
    }
    const found = await this.prisma.rolePrinciple.findUnique({
      where: { id: top.id },
      select: {
        id: true,
        sourceBlockIds: true,
        observationCount: true,
        confidence: true,
      },
    });
    return found ?? null;
  }

  private async mergeIntoExisting(args: {
    existing: {
      id: string;
      sourceBlockIds: string[];
      observationCount: number;
      confidence: SkillConfidence;
    };
    draft: PrincipleDraft;
    embedding: number[];
  }): Promise<void> {
    const union = new Set([...args.existing.sourceBlockIds, ...args.draft.sourceBlockIds]);
    const cappedIds = [...union].slice(0, RolePrincipleSynthesisService.MAX_SOURCE_BLOCK_IDS);
    const evidenceLevel = await this.confidenceFromDistinctDays(
      [...union],
      args.existing.confidence,
    );
    const confidence = this.maxConfidence(args.existing.confidence, evidenceLevel);
    const vec = `[${args.embedding.join(',')}]`;
    await this.prisma.$transaction(async (tx) => {
      await tx.rolePrinciple.update({
        where: { id: args.existing.id },
        data: {
          sourceBlockIds: cappedIds,
          observationCount: union.size,
          confidence,
          statement: args.draft.statement.slice(0, 2_000),
          lastSynthesizedAt: new Date(),
        },
      });
      await tx.$executeRawUnsafe(
        `UPDATE "role_principles" SET "embedding" = $1::vector WHERE "id" = $2`,
        vec,
        args.existing.id,
      );
    });
  }

  private async createNewPrincipleRaw(args: {
    tenantId: string;
    roleId: string;
    draft: PrincipleDraft;
    embedding: number[] | null;
  }): Promise<void> {
    const confidence = await this.confidenceFromDistinctDays(args.draft.sourceBlockIds, 'low');
    const created = await this.prisma.rolePrinciple.create({
      data: {
        tenantId: args.tenantId,
        roleId: args.roleId,
        situation: args.draft.situation.slice(0, 200),
        statement: args.draft.statement.slice(0, 2_000),
        sourceBlockIds: args.draft.sourceBlockIds,
        observationCount: args.draft.sourceBlockIds.length,
        confidence,
        status: 'active',
        lastSynthesizedAt: new Date(),
      },
    });
    if (args.embedding) {
      const vec = `[${args.embedding.join(',')}]`;
      try {
        await this.prisma.$executeRawUnsafe(
          `UPDATE "role_principles" SET "embedding" = $1::vector WHERE "id" = $2`,
          vec,
          created.id,
        );
      } catch (err) {
        this.logger.warn(
          {
            roleId: args.roleId,
            principleId: created.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'role-principle-synthesis.createNewPrincipleRaw: запись embedding упала — откатываю принцип (иначе active без вектора невидим дедупу → дубль)',
        );
        try {
          await this.prisma.rolePrinciple.delete({ where: { id: created.id } });
        } catch {}
      }
    }
  }

  private maxConfidence(a: SkillConfidence, b: SkillConfidence): SkillConfidence {
    const RANK: Record<SkillConfidence, number> = { low: 0, medium: 1, high: 2 };
    return RANK[a] >= RANK[b] ? a : b;
  }

  private async confidenceFromDistinctDays(
    blockIds: string[],
    fallback: SkillConfidence,
  ): Promise<SkillConfidence> {
    if (blockIds.length === 0) return fallback;
    try {
      const blocks = await this.prisma.ideaBlock.findMany({
        where: { id: { in: blockIds } },
        select: { createdAt: true },
      });
      if (blocks.length === 0) return fallback;
      const distinctDays = new Set(blocks.map((b) => b.createdAt.toISOString().slice(0, 10))).size;
      return distinctDays >= 4 ? 'high' : distinctDays >= 2 ? 'medium' : 'low';
    } catch (err) {
      this.logger.debug(
        { err: err instanceof Error ? err.message : String(err) },
        'role-principle-synthesis.confidenceFromDistinctDays: пересчёт из дат упал — fallback',
      );
      return fallback;
    }
  }

  private async loadEmbeddings(blockIds: string[]): Promise<Map<string, number[]>> {
    if (blockIds.length === 0) return new Map();
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ id: string; emb: string | null }>
      >`SELECT "id", "embedding"::text AS "emb" FROM "IdeaBlock" WHERE "id" IN (${Prisma.join(blockIds)}) AND "embedding" IS NOT NULL`;
      const map = new Map<string, number[]>();
      for (const r of rows) {
        if (!r.emb) continue;
        const inner = r.emb.replace(/^\[|\]$/g, '');
        if (!inner) continue;
        const vec = inner.split(',').map((s) => Number(s));
        if (vec.every((n) => Number.isFinite(n))) {
          map.set(r.id, vec);
        }
      }
      return map;
    } catch (err) {
      this.logger.debug(
        { err: err instanceof Error ? err.message : String(err) },
        'role-principle-synthesis.loadEmbeddings: упал — fallback на пустую мапу',
      );
      return new Map();
    }
  }

  private groupBlocksBySimilarity<T extends { embedding: number[] | null }>(blocks: T[]): T[][] {
    const threshold = RolePrincipleSynthesisService.GROUP_SIMILARITY_THRESHOLD;
    const groups: T[][] = [];
    for (const block of blocks) {
      if (!block.embedding) {
        groups.push([block]);
        continue;
      }
      let placed = false;
      for (const g of groups) {
        const head = g[0];
        if (!head || !head.embedding) continue;
        const sim = cosineSimilarity(block.embedding, head.embedding);
        if (sim >= threshold) {
          g.push(block);
          placed = true;
          break;
        }
      }
      if (!placed) groups.push([block]);
    }
    return groups.sort((a, b) => b.length - a.length);
  }
}

interface PrincipleDraft {
  situation: string;
  statement: string;
  sourceBlockIds: string[];
  confidence: SkillConfidence;
}

function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < n; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    dot += va * vb;
    magA += va * va;
    magB += vb * vb;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
