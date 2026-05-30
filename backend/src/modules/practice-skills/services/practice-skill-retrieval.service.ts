import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PracticeSkill } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { KnowledgeEmbeddingService } from '../../knowledge-core/services/embedding.service';

/**
 * Agents v2 Фаза C1 (2026-05-30) — PracticeSkillRetrievalService.
 *
 * Используется в `ClonesService` (как legacy `askPerson`/`askRole`, так и
 * `askPersonV2`/`askRoleV2`) перед вызовом `callCloneRespond`:
 *   1. Embed user question (через KnowledgeEmbeddingService).
 *   2. KNN top-K PracticeSkill для (tenantId, scope, scopeRefId), cosine ≥
 *      cfg.practiceSkills.knnRetrievalThreshold (default 0.78), без archived/deprecated.
 *   3. Для каждого результата:
 *        - status='shadow' — добавляем с вероятностью trafficShare (deterministic
 *          hash(conversationId + skillId)), чтобы один и тот же диалог
 *          стабильно либо видит, либо не видит skill.
 *        - status='active' — берём всегда.
 *   4. Pinned skill'ы (admin: «📌 Закрепить») идут первыми.
 *
 * За мастер-флагом `cfg.practiceSkills.enabled`. При false retrieval не делает
 * embed-вызовов и сразу возвращает пустой массив — стоимость нулевая.
 */
@Injectable()
export class PracticeSkillRetrievalService {
  private readonly logger = new Logger(PracticeSkillRetrievalService.name);

  /** Дефолтный topK retrieval'а. Если в промпт уйдёт больше — потеряется фокус. */
  private static readonly DEFAULT_TOP_K = 3;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embedder: KnowledgeEmbeddingService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  /**
   * Главный entry-point retrieval'а для clone-respond.
   *
   * При `enabled=false` или эмбеддинг-фейле возвращает [] (НЕ кидает) — это
   * горячий путь Clone API, любая ошибка retrieval'а не должна валить ответ
   * клона.
   */
  async retrieveForCloneRespond(args: {
    tenantId: string;
    scope: 'person' | 'role' | 'org';
    scopeRefId: string;
    question: string;
    /** Идентификатор диалога для deterministic shadow sampling. */
    conversationId: string | null;
    topK?: number;
  }): Promise<PracticeSkill[]> {
    if (!this.cfg.practiceSkills.enabled) return [];
    const trimmed = args.question.trim();
    if (trimmed.length === 0) return [];

    let queryVec: number[] | null;
    try {
      queryVec = await this.embedder.embedQuery(trimmed);
    } catch (err) {
      this.logger.debug(
        `practice-skills.retrieval: embedQuery failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
    if (!queryVec) return [];

    const topK = args.topK ?? PracticeSkillRetrievalService.DEFAULT_TOP_K;
    // Запрашиваем больше, чем topK — нам ещё фильтровать shadow sampling.
    const limit = Math.max(topK * 4, 8);
    const minDistance = 1 - this.cfg.practiceSkills.knnRetrievalThreshold;

    let candidateIds: string[];
    try {
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{ id: string; dist: number }>
      >(
        `SELECT id, ("triggerEmbedding" <=> $1::vector) AS dist
           FROM "practice_skills"
          WHERE "triggerEmbedding" IS NOT NULL
            AND "tenantId" = $2
            AND "scope"::text = $3
            AND "scopeRefId" = $4
            AND "status"::text NOT IN ('archived', 'deprecated')
            AND ("triggerEmbedding" <=> $1::vector) <= $5
          ORDER BY dist ASC
          LIMIT ${limit}`,
        `[${queryVec.join(',')}]`,
        args.tenantId,
        args.scope,
        args.scopeRefId,
        minDistance,
      );
      candidateIds = rows.map((r) => r.id);
    } catch (err) {
      this.logger.debug(
        `practice-skills.retrieval: KNN query failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
    if (candidateIds.length === 0) return [];

    const candidates = await this.prisma.practiceSkill.findMany({
      where: { id: { in: candidateIds } },
    });
    // Сохраняем порядок KNN (Prisma findMany его не гарантирует).
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const ordered = candidateIds
      .map((id) => byId.get(id))
      .filter((s): s is PracticeSkill => Boolean(s));

    // Shadow sampling.
    const conversationKey = args.conversationId ?? 'no_conversation';
    const sampled = ordered.filter((skill) => {
      if (skill.status === 'active') return true;
      if (skill.status === 'shadow') {
        return this.deterministicShouldInclude(
          conversationKey,
          skill.id,
          skill.trafficShare,
        );
      }
      // archived/deprecated уже отсеяли в SQL — defensive.
      return false;
    });

    // Pinned first.
    sampled.sort((a, b) => {
      if (a.pinned === b.pinned) return 0;
      return a.pinned ? -1 : 1;
    });

    const result = sampled.slice(0, topK);
    if (result.length > 0) {
      try {
        this.metrics.incPracticeSkillsRetrievalHit({ scope: args.scope });
      } catch {
        /* observability — не критичный путь */
      }
    }
    return result;
  }

  /**
   * Записывает SkillUsage для каждого retrieved skill'а после успешного
   * persist'а ответа клона. `wasUsed=true` означает, что skill попал в промпт
   * (на старте Фазы C1 любой возвращённый из retrieveForCloneRespond — попадает).
   *
   * Best-effort: ошибки логируются, но НЕ пробрасываются — это уже постфактум,
   * после ответа клона.
   */
  async recordUsages(args: {
    tenantId: string;
    conversationId: string;
    messageId: string;
    skills: ReadonlyArray<{ id: string; status: string }>;
  }): Promise<void> {
    if (args.skills.length === 0) return;
    try {
      await this.prisma.skillUsage.createMany({
        data: args.skills.map((s) => ({
          tenantId: args.tenantId,
          practiceSkillId: s.id,
          conversationId: args.conversationId,
          messageId: args.messageId,
          wasUsed: true,
          outcome: 'pending',
        })),
        skipDuplicates: true,
      });
      // Денормализованный lastUsed.
      const now = new Date();
      await this.prisma.practiceSkill.updateMany({
        where: { id: { in: args.skills.map((s) => s.id) } },
        data: { lastUsed: now },
      });
      // Метрики.
      for (const s of args.skills) {
        const statusLabel = s.status === 'active' ? 'active' : 'shadow';
        try {
          this.metrics.incPracticeSkillsRun({ status: statusLabel });
        } catch {
          /* observability */
        }
      }
    } catch (err) {
      this.logger.warn(
        `practice-skills.recordUsages: failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Deterministic-bucketing: хеш(conversationId+skillId) → [0,1), сравнивается
   * с trafficShare. Свойства:
   *   - Один и тот же (conversation, skill) всегда даёт одинаковый результат
   *     (диалог стабилен).
   *   - Разные skill'ы внутри одного conversation независимы (другой хеш).
   *   - Не требует Redis / persistence.
   */
  private deterministicShouldInclude(
    conversationKey: string,
    skillId: string,
    trafficShare: number,
  ): boolean {
    if (trafficShare <= 0) return false;
    if (trafficShare >= 1) return true;
    const h = createHash('sha256')
      .update(`${conversationKey}:${skillId}`)
      .digest();
    // Берём первые 4 байта как uint32 → нормализуем в [0,1).
    const u32 = h.readUInt32BE(0);
    const norm = u32 / 0x1_0000_0000;
    return norm < trafficShare;
  }
}
