import { Inject, Injectable, Logger } from '@nestjs/common';
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

/**
 * ТЗ 2026-05-25 clone-reliability-hardening, Фаза 2 —
 * SkillTraitConceptNormalizerCron.
 *
 * Расписание: `0 3 * * *` (раз в сутки в 03:00) — за час до decay-cron'а в
 * 05:00, чтобы нормализация попадала в текущий день.
 *
 * Per-tenant Redis-замок с TTL 1 час (защита от двух одновременных проходов).
 *
 * Алгоритм для каждой Org:
 *   1. Загрузить все активные концепты с embedding.
 *   2. Union-find кластеризация: для каждой пары (i, j) считаем cosine —
 *      similarity >= cfg.skill.conceptMergeThreshold (0.92) → union.
 *   3. Для каждого кластера из 2+ концептов:
 *      - выбрать опорный с max traitCount;
 *      - вызвать LLM `skill-trait-concept-name` — получить новое каноническое
 *        имя; при ошибке оставить старое опорного;
 *      - merge остальных в опорный через SkillTraitConceptService.mergeConcepts.
 *   4. Архивировать концепты без активных traits старше `cfg.skill.conceptArchiveAfterMonths`.
 *   5. Метрики: skill_trait_concepts_total{status} (gauge) +
 *      skill_trait_concepts_merged_total (counter).
 *   6. Probe-event `skill.concepts_merged` — если в слитом кластере были
 *      концепты с разными canonicalName и совокупно ≥ 5 traits.
 */
@Injectable()
export class SkillTraitConceptNormalizerCron {
  private readonly logger = new Logger(SkillTraitConceptNormalizerCron.name);
  private static readonly EMITTED_BY = 'skill-trait-concept-normalizer';
  private static readonly LOCK_TTL_SEC = 60 * 60; // 1 час
  private static readonly MAX_CONCEPTS_PER_TENANT = 2_000;
  /** Минимум traits в слитом кластере для probe-event'а. */
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
  ) {}

  @Cron('0 3 * * *')
  async sweep(): Promise<void> {
    try {
      const summary = await this.runOnce();
      this.logger.log(summary, 'skill-trait-concept-normalizer.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'skill-trait-concept-normalizer.cron: непойманная ошибка',
      );
    }
  }

  /** Public — для ручного запуска из backfill-скрипта / админ-эндпоинта. */
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
      let locked = false;
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
        } catch {
          // ignore — TTL подчистит сам
        }
      }
    }

    // Глобальные gauge'и по всем Org.
    await this.refreshGauges();

    return {
      tenantsScanned,
      tenantsLocked,
      clustersMerged,
      conceptsArchived,
      probesSent,
    };
  }

  // ─────────────────────────── per-tenant ───────────────────────────

  private async processTenant(tenantId: string): Promise<{
    clustersMerged: number;
    conceptsArchived: number;
    probesSent: number;
  }> {
    // 1) Загрузить активные концепты с embedding.
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

    // 2) Union-find кластеризация.
    const threshold = this.cfg.skill.conceptMergeThreshold;
    const parents = new Map<string, string>();
    const find = (id: string): string => {
      let cur = id;
      while (parents.get(cur) && parents.get(cur) !== cur) cur = parents.get(cur)!;
      // path compression
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

    // Группируем по корню.
    const clusters = new Map<string, RawConcept[]>();
    for (const c of concepts) {
      const root = find(c.id);
      const arr = clusters.get(root) ?? [];
      arr.push(c);
      clusters.set(root, arr);
    }

    let clustersMerged = 0;
    let probesSent = 0;

    // 3) Для каждого кластера из 2+ концептов — слить.
    for (const [, group] of clusters) {
      if (group.length < 2) continue;
      // Опорный — с max traitCount.
      group.sort((a, b) => b.trait_count - a.trait_count);
      const target = group[0]!;
      const sources = group.slice(1);
      const variants = unique([
        target.canonical_name,
        ...target.variants,
        ...sources.flatMap((s) => [s.canonical_name, ...s.variants]),
      ]);
      // Каноническое имя — спросить агент. На ошибке оставим текущее опорное.
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
      await this.concepts.mergeConcepts({
        tenantId,
        sourceIds: sources.map((s) => s.id),
        targetId: target.id,
        ...(newCanonicalName ? { newCanonicalName } : {}),
      });
      clustersMerged++;

      // Probe-event: если canonicalName-ы различались и совокупный traitCount ≥ 5.
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

    // 4) Архивация концептов без активных traits старше N месяцев.
    const archiveCutoff = new Date(
      Date.now() -
        this.cfg.skill.conceptArchiveAfterMonths * 30 * 24 * 60 * 60 * 1000,
    );
    const archiveRes = await this.prisma.skillTraitConcept.updateMany({
      where: {
        tenantId,
        status: 'active',
        traitCount: 0,
        lastSeenAt: { lt: archiveCutoff },
      },
      data: { status: 'archived' },
    });

    return {
      clustersMerged,
      conceptsArchived: archiveRes.count,
      probesSent,
    };
  }

  /** Спрашивает LLM-агент `skill-trait-concept-name` — короткое каноническое имя. */
  private async askConceptName(
    tenantId: string,
    variants: string[],
  ): Promise<string | undefined> {
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
    } catch {
      // парсинг упал — fallback
    }
    return undefined;
  }

  /**
   * Probe-event: «Мы автоматически слили N разных названий в один смысловой
   * блок — проверь, что новое имя адекватно».
   * Получатели — глава отдела субъекта или админы (через resolveProbeRecipients).
   * Так как probe не привязан к конкретному Person — берём всех админов.
   */
  private async emitProbe(args: {
    tenantId: string;
    targetConceptId: string;
    previousNames: string[];
    newCanonicalName: string;
    totalTraits: number;
  }): Promise<boolean> {
    try {
      // Получателей выбираем как admins организации.
      // (resolveProbeRecipients требует Person — здесь концепт не привязан к
      // конкретному человеку, поэтому берём admins напрямую.)
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

      const namesPreview = args.previousNames.slice(0, 5).map((n) => `«${n}»`).join(', ');
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

  /** Обновить gauge skill_trait_concepts_total{status} по всем Org. */
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

// ────────────────────────── helpers ──────────────────────────

/** Парсит pgvector textual представление вида `[0.1,0.2,...]`. */
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

