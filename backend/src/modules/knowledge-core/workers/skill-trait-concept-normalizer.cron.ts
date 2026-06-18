import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { ProbeService } from '../../probe/probe.service';
import {
  SKILL_TRAIT_CONCEPT_NAME_JSON_SCHEMA,
  SKILL_TRAIT_CONCEPT_NAME_SCHEMA_NAME,
  SKILL_TRAIT_CONCEPT_NAME_SYSTEM_PROMPT,
  SKILL_TRAIT_CONCEPT_NAME_USER_TEMPLATE,
} from '../prompts/skill-trait-concept-name.prompt';
import { SkillTraitConceptService } from '../services/skill-trait-concept.service';

@Injectable()
export class SkillTraitConceptNormalizerCron {
  private readonly logger = new Logger(SkillTraitConceptNormalizerCron.name);
  private static readonly EMITTED_BY = 'skill-trait-concept-normalizer';
  private static readonly LOCK_TTL_SEC = 60 * 60;
  private static readonly MAX_CONCEPTS_PER_TENANT = 2_000;
  private static readonly PROBE_MIN_TRAITS_IN_CLUSTER = 5;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(SkillTraitConceptService)
    private readonly concepts: SkillTraitConceptService,
    @Inject(ProbeService) private readonly probe: ProbeService,
    @Optional()
    @Inject(EventEmitter2)
    private readonly eventEmitter: EventEmitter2 | null = null,
  ) {}

  @Cron('0 3 * * *')
  async sweep(): Promise<void> {
    try {
      const summary = await this.runOnce();
      this.logger.debug(summary, 'skill-trait-concept-normalizer.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'skill-trait-concept-normalizer.cron: непойманная ошибка',
      );
    }
  }

  async runOnce(): Promise<{
    tenantsScanned: number;
    tenantsLocked: number;
    clustersMerged: number;
    conceptsArchived: number;
    probesSent: number;
  }> {
    let tenantsScanned = 0;
    let tenantsLocked = 0;
    let clustersMerged = 0;
    let conceptsArchived = 0;
    let probesSent = 0;

    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });

    for (const org of orgs) {
      const lockKey = `skill-trait-concept-normalizer:lock:${org.id}`;
      let locked: boolean;
      try {
        const setRes = await this.redis.client.set(
          lockKey,
          '1',
          'EX',
          SkillTraitConceptNormalizerCron.LOCK_TTL_SEC,
          'NX',
        );
        locked = setRes === 'OK';
      } catch (err) {
        this.logger.warn(
          {
            tenantId: org.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'skill-trait-concept-normalizer: Redis lock упал — пропускаю Org',
        );
        continue;
      }
      if (!locked) {
        tenantsLocked++;
        continue;
      }
      tenantsScanned++;
      try {
        const res = await this.processTenant(org.id);
        clustersMerged += res.clustersMerged;
        conceptsArchived += res.conceptsArchived;
        probesSent += res.probesSent;
      } catch (err) {
        this.logger.warn(
          {
            tenantId: org.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'skill-trait-concept-normalizer: ошибка обработки Org — skip',
        );
      } finally {
        try {
          await this.redis.client.del(lockKey);
        } catch {}
      }
    }

    await this.refreshGauges();

    return {
      tenantsScanned,
      tenantsLocked,
      clustersMerged,
      conceptsArchived,
      probesSent,
    };
  }

  private async processTenant(tenantId: string): Promise<{
    clustersMerged: number;
    conceptsArchived: number;
    probesSent: number;
  }> {
    type RawConcept = {
      id: string;
      canonical_name: string;
      trait_count: number;
      variants: string[];
      embedding: number[] | null;
    };
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{
        id: string;
        canonical_name: string;
        trait_count: number;
        variants: string[];
        embedding_text: string | null;
      }>
    >(
      `SELECT id,
              "canonicalName" AS canonical_name,
              "traitCount"    AS trait_count,
              "variants",
              CASE WHEN "embedding" IS NULL THEN NULL ELSE "embedding"::text END AS embedding_text
         FROM "skill_trait_concepts"
        WHERE "tenantId" = $1
          AND "status" = 'active'
          AND "embedding" IS NOT NULL
        LIMIT ${SkillTraitConceptNormalizerCron.MAX_CONCEPTS_PER_TENANT}`,
      tenantId,
    );
    const concepts: RawConcept[] = rows.map((r) => ({
      id: r.id,
      canonical_name: r.canonical_name,
      trait_count: Number(r.trait_count),
      variants: Array.isArray(r.variants) ? r.variants : [],
      embedding: r.embedding_text ? parseVector(r.embedding_text) : null,
    }));

    if (concepts.length > 0) {
      try {
        const liveCounts = await this.prisma.skillTrait.groupBy({
          by: ['conceptId'],
          where: { conceptId: { in: concepts.map((c) => c.id) }, status: 'active' },
          _count: { _all: true },
        });
        const byConcept = new Map<string, number>();
        for (const lc of liveCounts) {
          if (lc.conceptId) byConcept.set(lc.conceptId, lc._count._all);
        }
        for (const c of concepts) c.trait_count = byConcept.get(c.id) ?? 0;
      } catch (err) {
        this.logger.debug(
          { tenantId, err: err instanceof Error ? err.message : String(err) },
          'skill-trait-concept-normalizer: live trait-count groupBy упал — использую денормализованный',
        );
      }
    }

    const threshold = this.cfg.skill.conceptMergeThreshold;
    const parents = new Map<string, string>();
    const find = (id: string): string => {
      let cur = id;
      while (parents.get(cur) && parents.get(cur) !== cur) cur = parents.get(cur)!;
      let walker = id;
      while (parents.get(walker) && parents.get(walker) !== cur) {
        const next = parents.get(walker)!;
        parents.set(walker, cur);
        walker = next;
      }
      return cur;
    };
    const union = (a: string, b: string) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parents.set(ra, rb);
    };
    for (const c of concepts) parents.set(c.id, c.id);

    for (let i = 0; i < concepts.length; i++) {
      const a = concepts[i];
      if (!a?.embedding) continue;
      for (let j = i + 1; j < concepts.length; j++) {
        const b = concepts[j];
        if (!b?.embedding) continue;
        const sim = cosineSimilarity(a.embedding, b.embedding);
        if (sim >= threshold) union(a.id, b.id);
      }
    }

    const clusters = new Map<string, RawConcept[]>();
    for (const c of concepts) {
      const root = find(c.id);
      const arr = clusters.get(root) ?? [];
      arr.push(c);
      clusters.set(root, arr);
    }

    let clustersMerged = 0;
    let probesSent = 0;

    for (const [, group] of clusters) {
      if (group.length < 2) continue;
      group.sort((a, b) => b.trait_count - a.trait_count);
      const target = group[0]!;
      const sources = group.slice(1);
      const variants = unique([
        target.canonical_name,
        ...target.variants,
        ...sources.flatMap((s) => [s.canonical_name, ...s.variants]),
      ]);
      let newCanonicalName: string | undefined;
      try {
        newCanonicalName = await this.askConceptName(tenantId, variants);
      } catch (err) {
        this.logger.debug(
          {
            tenantId,
            targetId: target.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'skill-trait-concept-normalizer: LLM concept-name упал — оставляю старое имя',
        );
      }
      const merged = await this.concepts.mergeConcepts({
        tenantId,
        sourceIds: sources.map((s) => s.id),
        targetId: target.id,
        ...(newCanonicalName ? { newCanonicalName } : {}),
      });
      if (!merged) {
        this.logger.debug(
          { tenantId, targetId: target.id, sourceIds: sources.map((s) => s.id) },
          'skill-trait-concept-normalizer: mergeConcepts вернул false — кластер не слит, пропускаю',
        );
        continue;
      }
      clustersMerged++;

      const totalTraits = group.reduce((acc, c) => acc + c.trait_count, 0);
      const uniqueNames = new Set(group.map((c) => c.canonical_name));
      if (
        uniqueNames.size > 1 &&
        totalTraits >= SkillTraitConceptNormalizerCron.PROBE_MIN_TRAITS_IN_CLUSTER
      ) {
        const sent = await this.emitProbe({
          tenantId,
          targetConceptId: target.id,
          previousNames: [...uniqueNames],
          newCanonicalName: newCanonicalName ?? target.canonical_name,
          totalTraits,
        });
        if (sent) probesSent++;
      }
    }

    const archiveCutoff = new Date(
      Date.now() - this.cfg.skill.conceptArchiveAfterMonths * 30 * 24 * 60 * 60 * 1000,
    );
    const archiveRes = await this.prisma.skillTraitConcept.updateMany({
      where: {
        tenantId,
        status: 'active',
        traits: { none: { status: 'active' } },
        lastSeenAt: { lt: archiveCutoff },
      },
      data: { status: 'archived' },
    });

    try {
      if (this.eventEmitter) {
        const candidates = await this.prisma.skillTraitConcept.findMany({
          where: {
            tenantId,
            status: 'active',
            traitCount: { gte: 3 },
          },
          select: { id: true },
          take: 500,
        });
        if (candidates.length > 0) {
          this.eventEmitter.emit('skill-trait-concept.normalized', {
            tenantId,
            conceptIds: candidates.map((c) => c.id),
          });
        }
      }
    } catch (err) {
      this.logger.debug(
        { tenantId, err: err instanceof Error ? err.message : String(err) },
        'skill-trait-concept-normalizer: эмит события failed — skip',
      );
    }

    return {
      clustersMerged,
      conceptsArchived: archiveRes.count,
      probesSent,
    };
  }

  private async askConceptName(tenantId: string, variants: string[]): Promise<string | undefined> {
    if (variants.length === 0) return undefined;
    const result = await this.llm.call({
      taskType: 'skill-trait-concept-name',
      systemPrompt: SKILL_TRAIT_CONCEPT_NAME_SYSTEM_PROMPT,
      userMessage: SKILL_TRAIT_CONCEPT_NAME_USER_TEMPLATE({ variants }),
      tenantId,
      responseFormat: {
        type: 'json_schema',
        name: SKILL_TRAIT_CONCEPT_NAME_SCHEMA_NAME,
        schema: SKILL_TRAIT_CONCEPT_NAME_JSON_SCHEMA,
        strict: true,
      },
      dataClass: 'internal',
    });
    try {
      const parsed = JSON.parse(result.text) as {
        canonicalName?: unknown;
        reasoning?: unknown;
      };
      if (typeof parsed.canonicalName === 'string' && parsed.canonicalName.trim()) {
        return parsed.canonicalName.trim().slice(0, 200);
      }
    } catch {}
    return undefined;
  }

  private async emitProbe(args: {
    tenantId: string;
    targetConceptId: string;
    previousNames: string[];
    newCanonicalName: string;
    totalTraits: number;
  }): Promise<boolean> {
    try {
      const admins = await this.prisma.membership.findMany({
        where: {
          orgId: args.tenantId,
          role: { in: ['owner', 'admin'] },
        },
        select: { userId: true },
        take: 20,
      });
      const recipients = admins.map((a) => a.userId).filter((u): u is string => !!u);
      if (recipients.length === 0) return false;

      const namesPreview = args.previousNames
        .slice(0, 5)
        .map((n) => `«${n}»`)
        .join(', ');
      const message = `Автоматически слиты ${args.previousNames.length} формулировки одного смыслового блока навыка (всего ${args.totalTraits} наблюдений у сотрудников): ${namesPreview}. Каноническое имя: «${args.newCanonicalName}». Проверь — корректно ли?`;

      await this.probe.suggest({
        tenantId: args.tenantId,
        emittedByService: SkillTraitConceptNormalizerCron.EMITTED_BY,
        reason: 'skill.concepts_merged',
        payload: {
          message,
          contextCardId: args.targetConceptId,
          contextCardKind: 'skill_trait_concept',
          contextCardTitle: args.newCanonicalName.slice(0, 100),
          actionUrl: `/admin/skill-trait-concepts/${args.targetConceptId}`,
          dataClass: 'internal',
        },
        recipientCandidates: recipients,
        priorityHint: 0.4,
        dataClass: 'internal',
      });
      return true;
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          targetConceptId: args.targetConceptId,
          err: err instanceof Error ? err.message : String(err),
        },
        'skill-trait-concept-normalizer: emitProbe упал — skip',
      );
      return false;
    }
  }

  private async refreshGauges(): Promise<void> {
    try {
      const rows = await this.prisma.skillTraitConcept.groupBy({
        by: ['status'],
        _count: { _all: true },
      });
      const all: Record<'active' | 'merged_into' | 'archived', number> = {
        active: 0,
        merged_into: 0,
        archived: 0,
      };
      for (const r of rows) {
        all[r.status] = r._count._all;
      }
      this.metrics.setSkillTraitConceptsTotal({ status: 'active', value: all.active });
      this.metrics.setSkillTraitConceptsTotal({
        status: 'merged_into',
        value: all.merged_into,
      });
      this.metrics.setSkillTraitConceptsTotal({
        status: 'archived',
        value: all.archived,
      });
    } catch (err) {
      this.logger.debug(
        { err: err instanceof Error ? err.message : String(err) },
        'skill-trait-concept-normalizer.refreshGauges: упал — skip',
      );
    }
  }
}

function parseVector(text: string): number[] | null {
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed[0] !== '[' || trimmed[trimmed.length - 1] !== ']') {
    return null;
  }
  try {
    const inner = trimmed.slice(1, -1);
    if (!inner) return [];
    return inner.split(',').map((s) => Number(s));
  } catch {
    return null;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function unique(arr: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of arr) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}
