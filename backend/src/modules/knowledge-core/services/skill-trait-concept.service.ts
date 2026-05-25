import { Inject, Injectable, Logger } from '@nestjs/common';
import type { SkillTraitConcept } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import { KnowledgeEmbeddingService } from './embedding.service';

/**
 * ТЗ 2026-05-25 clone-reliability-hardening, Фаза 2 — SkillTraitConceptService.
 *
 * Автоматически нормализует «смысловые блоки навыка» — категории SkillTrait,
 * которые LLM придумывает эмерджентно. У разных сотрудников одна и та же
 * черта называется по-разному («осторожен с оценками сроков», «не любит
 * давать сроки без данных», «откладывает оценку») — каноничный концепт
 * должен быть один.
 *
 * Принятые решения (ОВ2):
 *   - Порог совпадения с существующим (`cfg.skill.conceptMatchThreshold`) = 0.85.
 *     similarity >= 0.85 → берём существующий, иначе создаём новый.
 *   - Порог слияния в cron-нормализаторе (`cfg.skill.conceptMergeThreshold`) = 0.92,
 *     выше потому что слияние деструктивно.
 *
 * Точка входа `findOrCreateConcept` вызывается из Specialist37Service.createNewTraitRaw
 * (синхронно после insert'а trait'а). Сервис best-effort — если embedding-сервис
 * упал, концепт всё равно создаётся (без embedding), а cron-нормализатор позже
 * его подхватит.
 */
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

  /**
   * Главная точка входа. Возвращает существующий или новый концепт для черты.
   *
   * Логика:
   *   1. Посчитать embedding строки `category. statement`.
   *   2. Top-1 концепт того же tenantId со status='active' по cosine.
   *   3. Если similarity >= cfg.skill.conceptMatchThreshold — вернуть найденный
   *      (+ добавить category в variants, обновить lastSeenAt, инкремент traitCount).
   *   4. Иначе — создать новый с canonicalName=category, embedding, variants=[category],
   *      traitCount=1.
   *   5. Best-effort: если embedding-сервис упал — создаём концепт без embedding.
   */
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

    // 1) Если embedding есть — ищем top-1 концепт по cosine.
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

    // 2) Fallback / эмбеддинг отсутствует — ищем точное совпадение по canonicalName
    //    (избежать дубля по unique-индексу).
    const exact = await this.prisma.skillTraitConcept.findUnique({
      where: {
        tenantId_canonicalName: { tenantId: args.tenantId, canonicalName: category },
      },
    });
    if (exact) {
      return this.attachTraitToConcept({ concept: exact, category });
    }

    // 3) Создаём новый концепт.
    try {
      const created = await this.prisma.skillTraitConcept.create({
        data: {
          tenantId: args.tenantId,
          canonicalName: category,
          variants: [category],
          status: 'active',
          traitCount: 1,
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
      // Гонка по unique([tenantId, canonicalName]) — повторно читаем существующий.
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

  /**
   * Пересчёт concept'а для одного trait'а. Используется бэкфилл-скриптом и
   * ручной правкой в админке.
   */
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

  /**
   * Используется cron-нормализатором и админ-API для ручного слияния.
   * Перепривязывает все SkillTrait слитых концептов к опорному, объединяет
   * variants и помечает источники как `merged_into`.
   */
  async mergeConcepts(args: {
    tenantId: string;
    sourceIds: string[]; // что сливаем (>= 1)
    targetId: string;     // куда сливаем
    newCanonicalName?: string; // от агента skill-trait-concept-name
    newDescription?: string;
  }): Promise<void> {
    const sourceIds = args.sourceIds.filter((id) => id !== args.targetId);
    if (sourceIds.length === 0) return;
    const target = await this.prisma.skillTraitConcept.findUnique({
      where: { id: args.targetId },
    });
    if (!target || target.tenantId !== args.tenantId || target.status !== 'active') {
      this.logger.warn(
        { tenantId: args.tenantId, targetId: args.targetId },
        'skill-trait-concept.mergeConcepts: target отсутствует/не-active/чужой tenant — skip',
      );
      return;
    }

    const sources = await this.prisma.skillTraitConcept.findMany({
      where: { id: { in: sourceIds }, tenantId: args.tenantId },
    });
    if (sources.length === 0) return;

    // Объединяем variants (целевой + все источники + опц. старое canonical).
    const variantSet = new Set<string>(target.variants);
    for (const v of target.variants) variantSet.add(v);
    for (const s of sources) {
      for (const v of s.variants) variantSet.add(v);
      variantSet.add(s.canonicalName);
    }
    const mergedVariants = [...variantSet].slice(0, 200);

    // Транзакция: перепривязка traits + апдейт target + пометка sources.
    try {
      await this.prisma.$transaction(async (tx) => {
        // Перепривязываем traits на target.
        await tx.skillTrait.updateMany({
          where: { conceptId: { in: sources.map((s) => s.id) } },
          data: { conceptId: target.id },
        });
        // Помечаем sources как merged_into.
        await tx.skillTraitConcept.updateMany({
          where: { id: { in: sources.map((s) => s.id) } },
          data: { status: 'merged_into', mergedIntoId: target.id, traitCount: 0 },
        });
        // Пересчитываем traitCount у target.
        const newCount = await tx.skillTrait.count({
          where: { conceptId: target.id, status: 'active' },
        });
        await tx.skillTraitConcept.update({
          where: { id: target.id },
          data: {
            variants: mergedVariants,
            traitCount: newCount,
            ...(args.newCanonicalName
              ? { canonicalName: args.newCanonicalName.slice(0, 200) }
              : {}),
            ...(args.newDescription !== undefined
              ? { description: args.newDescription.slice(0, 2_000) }
              : {}),
            lastSeenAt: new Date(),
          },
        });
      });
      this.metrics.incSkillTraitConceptsMerged();
    } catch (err) {
      this.logger.warn(
        {
          targetId: target.id,
          sources: sources.map((s) => s.id),
          err: err instanceof Error ? err.message : String(err),
        },
        'skill-trait-concept.mergeConcepts: транзакция упала',
      );
    }
  }

  // ─────────────────────────── private ───────────────────────────

  /**
   * Top-1 активный концепт по cosine-расстоянию embedding-а.
   * Возвращает null если ничего нет или ничего не прошло порог
   * `cfg.skill.conceptMatchThreshold`.
   */
  private async findClosestActiveConcept(args: {
    tenantId: string;
    embedding: number[];
  }): Promise<SkillTraitConcept | null> {
    const vec = `[${args.embedding.join(',')}]`;
    const threshold = this.cfg.skill.conceptMatchThreshold;
    // cosine_distance = 1 - similarity ⇒ similarity >= threshold
    // ⇔ distance <= 1 - threshold.
    const maxDistance = 1 - threshold;
    // pgvector cosine operator `<=>`. Limit 1.
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; distance: number }>
    >(
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

  /**
   * Привязка нового trait'а к существующему концепту:
   * +1 traitCount, добавить category в variants (если новая), lastSeenAt=now().
   */
  private async attachTraitToConcept(args: {
    concept: SkillTraitConcept;
    category: string;
  }): Promise<SkillTraitConcept> {
    const nextVariants = args.concept.variants.includes(args.category)
      ? args.concept.variants
      : [...args.concept.variants, args.category].slice(0, 200);
    try {
      const updated = await this.prisma.skillTraitConcept.update({
        where: { id: args.concept.id },
        data: {
          variants: nextVariants,
          traitCount: args.concept.traitCount + 1,
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
