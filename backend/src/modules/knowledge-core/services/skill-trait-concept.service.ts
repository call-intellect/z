import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type SkillTraitConcept } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import { KnowledgeEmbeddingService } from './embedding.service';

@Injectable()
export class SkillTraitConceptService {
  private readonly logger = new Logger(SkillTraitConceptService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embedder: KnowledgeEmbeddingService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async findOrCreateConcept(args: {
    tenantId: string;
    category: string;
    statement: string;
  }): Promise<SkillTraitConcept | null> {
    const category = args.category.trim().slice(0, 200);
    if (!category) return null;
    const statement = args.statement.trim().slice(0, 2_000);

    let embedding: number[] | null = null;
    try {
      embedding = await this.embedder.embedQuery(`${category}. ${statement}`);
    } catch (err) {
      this.logger.debug(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'skill-trait-concept.findOrCreateConcept: embedding упал — продолжу без него',
      );
    }

    if (embedding) {
      try {
        const matched = await this.findClosestActiveConcept({
          tenantId: args.tenantId,
          embedding,
        });
        if (matched) {
          return this.attachTraitToConcept({
            concept: matched,
            category,
          });
        }
      } catch (err) {
        this.logger.warn(
          {
            tenantId: args.tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'skill-trait-concept.findOrCreateConcept: cosine-search упал — fallback к exact name',
        );
      }
    }

    const exact = await this.prisma.skillTraitConcept.findUnique({
      where: {
        tenantId_canonicalName: { tenantId: args.tenantId, canonicalName: category },
      },
    });
    if (exact) {
      return this.attachTraitToConcept({ concept: exact, category });
    }

    try {
      const created = await this.prisma.skillTraitConcept.create({
        data: {
          tenantId: args.tenantId,
          canonicalName: category,
          variants: [category],
          status: 'active',
          traitCount: 0,
        },
      });
      if (embedding) {
        try {
          const vec = `[${embedding.join(',')}]`;
          await this.prisma.$executeRawUnsafe(
            `UPDATE "skill_trait_concepts" SET "embedding" = $1::vector WHERE "id" = $2`,
            vec,
            created.id,
          );
        } catch (err) {
          this.logger.debug(
            {
              conceptId: created.id,
              err: err instanceof Error ? err.message : String(err),
            },
            'skill-trait-concept.findOrCreateConcept: пропись embedding упала — best-effort',
          );
        }
      }
      return created;
    } catch (err) {
      this.logger.debug(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'skill-trait-concept.findOrCreateConcept: insert упал (вероятно гонка) — повторное чтение',
      );
      const fallback = await this.prisma.skillTraitConcept.findUnique({
        where: {
          tenantId_canonicalName: {
            tenantId: args.tenantId,
            canonicalName: category,
          },
        },
      });
      return fallback ?? null;
    }
  }

  async recomputeConceptForTrait(traitId: string): Promise<SkillTraitConcept | null> {
    const trait = await this.prisma.skillTrait.findUnique({
      where: { id: traitId },
      select: {
        id: true,
        category: true,
        statement: true,
        profile: { select: { tenantId: true } },
      },
    });
    if (!trait?.profile?.tenantId) return null;
    const concept = await this.findOrCreateConcept({
      tenantId: trait.profile.tenantId,
      category: trait.category,
      statement: trait.statement,
    });
    if (!concept) return null;
    try {
      await this.prisma.skillTrait.update({
        where: { id: trait.id },
        data: { conceptId: concept.id },
      });
    } catch (err) {
      this.logger.warn(
        {
          traitId: trait.id,
          conceptId: concept.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'skill-trait-concept.recomputeConceptForTrait: update упал — skip',
      );
    }
    return concept;
  }

  async mergeConcepts(args: {
    tenantId: string;
    sourceIds: string[];
    targetId: string;
    newCanonicalName?: string;
    newDescription?: string;
  }): Promise<boolean> {
    const sourceIds = args.sourceIds.filter((id) => id !== args.targetId);
    if (sourceIds.length === 0) return false;
    const target = await this.prisma.skillTraitConcept.findUnique({
      where: { id: args.targetId },
    });
    if (!target || target.tenantId !== args.tenantId || target.status !== 'active') {
      this.logger.warn(
        { tenantId: args.tenantId, targetId: args.targetId },
        'skill-trait-concept.mergeConcepts: target отсутствует/не-active/чужой tenant — skip',
      );
      return false;
    }

    const sources = await this.prisma.skillTraitConcept.findMany({
      where: { id: { in: sourceIds }, tenantId: args.tenantId },
    });
    if (sources.length === 0) return false;

    const variantSet = new Set<string>(target.variants);
    for (const v of target.variants) variantSet.add(v);
    for (const s of sources) {
      for (const v of s.variants) variantSet.add(v);
      variantSet.add(s.canonicalName);
    }
    const mergedVariants = [...variantSet].slice(0, 200);

    const desiredName = args.newCanonicalName?.slice(0, 200);
    const mergeIds = new Set<string>([target.id, ...sources.map((s) => s.id)]);
    let canonicalName = desiredName;
    if (desiredName && desiredName !== target.canonicalName) {
      const collision = await this.prisma.skillTraitConcept.findFirst({
        where: { tenantId: args.tenantId, canonicalName: desiredName },
        select: { id: true },
      });
      if (collision && !mergeIds.has(collision.id)) {
        this.logger.debug(
          {
            tenantId: args.tenantId,
            targetId: target.id,
            desiredName,
            collisionId: collision.id,
          },
          'skill-trait-concept.mergeConcepts: новое имя занято другим концептом — оставляю опорное',
        );
        canonicalName = undefined;
      }
    }

    const runMerge = async (useName: string | undefined): Promise<void> => {
      await this.prisma.$transaction(async (tx) => {
        await tx.skillTrait.updateMany({
          where: { conceptId: { in: sources.map((s) => s.id) } },
          data: { conceptId: target.id },
        });
        await tx.skillTraitConcept.updateMany({
          where: { id: { in: sources.map((s) => s.id) } },
          data: { status: 'merged_into', mergedIntoId: target.id, traitCount: 0 },
        });
        const newCount = await tx.skillTrait.count({
          where: { conceptId: target.id, status: 'active' },
        });
        await tx.skillTraitConcept.update({
          where: { id: target.id },
          data: {
            variants: mergedVariants,
            traitCount: newCount,
            ...(useName ? { canonicalName: useName } : {}),
            ...(args.newDescription !== undefined
              ? { description: args.newDescription.slice(0, 2_000) }
              : {}),
            lastSeenAt: new Date(),
          },
        });
      });
    };

    try {
      try {
        await runMerge(canonicalName);
      } catch (err) {
        if (
          canonicalName &&
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          this.logger.warn(
            {
              targetId: target.id,
              desiredName: canonicalName,
            },
            'skill-trait-concept.mergeConcepts: P2002 на имени — retry без смены имени',
          );
          await runMerge(undefined);
        } else {
          throw err;
        }
      }
      this.metrics.incSkillTraitConceptsMerged();
      return true;
    } catch (err) {
      this.logger.warn(
        {
          targetId: target.id,
          sources: sources.map((s) => s.id),
          err: err instanceof Error ? err.message : String(err),
        },
        'skill-trait-concept.mergeConcepts: транзакция упала',
      );
      return false;
    }
  }

  async recomputeTraitCount(conceptId: string): Promise<number | null> {
    try {
      const count = await this.countActiveTraits(conceptId);
      await this.prisma.skillTraitConcept.update({
        where: { id: conceptId },
        data: { traitCount: count },
      });
      return count;
    } catch (err) {
      this.logger.debug(
        {
          conceptId,
          err: err instanceof Error ? err.message : String(err),
        },
        'skill-trait-concept.recomputeTraitCount: update упал — skip',
      );
      return null;
    }
  }

  private async countActiveTraits(conceptId: string): Promise<number> {
    return this.prisma.skillTrait.count({
      where: { conceptId, status: 'active' },
    });
  }

  private async findClosestActiveConcept(args: {
    tenantId: string;
    embedding: number[];
  }): Promise<SkillTraitConcept | null> {
    const vec = `[${args.embedding.join(',')}]`;
    const threshold = this.cfg.skill.conceptMatchThreshold;
    const maxDistance = 1 - threshold;
    const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string; distance: number }>>(
      `SELECT id, ("embedding" <=> $1::vector) AS distance
         FROM "skill_trait_concepts"
        WHERE "tenantId" = $2
          AND "status" = 'active'
          AND "embedding" IS NOT NULL
        ORDER BY "embedding" <=> $1::vector ASC
        LIMIT 1`,
      vec,
      args.tenantId,
    );
    const top = rows[0];
    if (!top) return null;
    if (typeof top.distance !== 'number' || top.distance > maxDistance) {
      return null;
    }
    return this.prisma.skillTraitConcept.findUnique({ where: { id: top.id } });
  }

  private async attachTraitToConcept(args: {
    concept: SkillTraitConcept;
    category: string;
  }): Promise<SkillTraitConcept> {
    const nextVariants = args.concept.variants.includes(args.category)
      ? args.concept.variants
      : [...args.concept.variants, args.category].slice(0, 200);
    const activeCount = await this.countActiveTraits(args.concept.id);
    try {
      const updated = await this.prisma.skillTraitConcept.update({
        where: { id: args.concept.id },
        data: {
          variants: nextVariants,
          traitCount: activeCount,
          lastSeenAt: new Date(),
        },
      });
      return updated;
    } catch (err) {
      this.logger.debug(
        {
          conceptId: args.concept.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'skill-trait-concept.attachTraitToConcept: update упал — возвращаю текущий',
      );
      return args.concept;
    }
  }
}
