import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  type CardSpecialistHandler,
  type CardSpecialistResult,
  CardSpecialistRegistry,
} from '../../chat-v2/services/card-specialist-registry.service';

import { KnowledgeEmbeddingService } from './embedding.service';

/**
 * SBA β-2 — обработчик CardSpecialistRegistry для Specialist 3.2
 * (Knowledge Clone). См. §5.6 контракта зонтичного.
 *
 * Регистрирует себя в `CardSpecialistRegistry` через `onModuleInit`.
 * Запрашивается `ChatV2Service` при выборе релевантных карточек для
 * query: возвращает Person'ов, чей `knowledgeProfile` содержит категории,
 * текстово близкие к query (на β-2 — простой substring/word match;
 * embedding-based search — γ+).
 *
 * Контракт:
 *   - метод НЕ должен бросать — на любую ошибку возвращаем `[]` и логируем.
 *   - tenant isolation: запрос всегда фильтруется по `tenantId`.
 *   - `confidence` — derived из confidence категорий, попавших в overlap.
 */
@Injectable()
export class Specialist32CardHandler
  implements OnModuleInit, CardSpecialistHandler
{
  private readonly logger = new Logger(Specialist32CardHandler.name);
  static readonly SPECIALIST_NAME = '3-2-knowledge-clone';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CardSpecialistRegistry)
    private readonly registry: CardSpecialistRegistry,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(KnowledgeEmbeddingService)
    private readonly embeddings: KnowledgeEmbeddingService,
  ) {}

  onModuleInit(): void {
    this.registry.register(Specialist32CardHandler.SPECIALIST_NAME, this);
    this.logger.log(
      `Specialist32CardHandler зарегистрирован как '${Specialist32CardHandler.SPECIALIST_NAME}' в CardSpecialistRegistry`,
    );
  }

  /**
   * ТЗ 2026-05-25 Фаза 4 — векторный поиск с fallback на substring-match.
   *
   * Алгоритм:
   *   1. Считаем количество embedding-строк per Org. Если меньше
   *      `cfg.knowledgeClone.embeddingFallbackThreshold` — fallback на
   *      substring-match (страховка пока бэкфилл не прошёл).
   *   2. Иначе — embedQuery(args.query) → pgvector cosine KNN по
   *      `person_knowledge_category_embeddings` с join на persons (фильтр
   *      relationship='employee' + deletedAt IS NULL).
   *   3. Группировка по personId, агрегация
   *      `score = sum(similarity * confidenceWeight[confidence])`.
   *   4. Только Person'ы с `score >= cfg.knowledgeClone.minMatchScore`.
   *   5. Top N по score → читаем JSON `Person.knowledgeProfile` и
   *      собираем CardSpecialistResult.
   */
  async getCardsForQuery(args: {
    tenantId: string;
    query: string;
    candidateBlockIds: readonly string[];
    limit: number;
  }): Promise<readonly CardSpecialistResult[]> {
    try {
      if (args.limit <= 0) return [];
      const trimmed = args.query.trim();
      if (trimmed.length === 0) return [];

      // 1. Сколько embedding-строк есть в этой Org?
      let embeddingsCount = 0;
      try {
        embeddingsCount = await this.prisma.personKnowledgeCategoryEmbedding.count(
          {
            where: { tenantId: args.tenantId },
          },
        );
      } catch (err) {
        this.logger.warn(
          {
            tenantId: args.tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'Specialist32CardHandler: count embeddings упал — fallback на substring',
        );
      }

      const threshold = this.cfg.knowledgeClone.embeddingFallbackThreshold;
      if (embeddingsCount < threshold) {
        return this.getCardsForQueryFallback(args);
      }

      // 2. Векторный путь.
      let queryVec: number[] | null;
      try {
        queryVec = await this.embeddings.embedQuery(trimmed);
      } catch (err) {
        this.logger.warn(
          {
            tenantId: args.tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'Specialist32CardHandler: embedQuery упал — fallback на substring',
        );
        return this.getCardsForQueryFallback(args);
      }
      if (!queryVec || queryVec.length === 0) {
        return this.getCardsForQueryFallback(args);
      }

      const vecLiteral = `[${queryVec.join(',')}]`;
      const sqlLimit = args.limit * 3;
      let rows: Array<{
        id: string;
        person_id: string;
        category_name: string;
        confidence: string;
        similarity: number;
      }> = [];
      try {
        rows = await this.prisma.$queryRaw<typeof rows>`
          SELECT pkce.id, pkce."personId" AS person_id, pkce."categoryName" AS category_name,
                 pkce.confidence,
                 1 - (pkce.embedding <=> ${vecLiteral}::vector) AS similarity
          FROM person_knowledge_category_embeddings pkce
          JOIN persons p ON p.id = pkce."personId"
          WHERE pkce."tenantId" = ${args.tenantId}
            AND p.relationship = 'employee'
            AND p."deletedAt" IS NULL
            AND pkce.embedding IS NOT NULL
          ORDER BY pkce.embedding <=> ${vecLiteral}::vector
          LIMIT ${sqlLimit}
        `;
      } catch (err) {
        this.logger.warn(
          {
            tenantId: args.tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'Specialist32CardHandler: pgvector query упал — fallback на substring',
        );
        return this.getCardsForQueryFallback(args);
      }

      if (rows.length === 0) return [];

      // 3. Группировка по personId.
      const confidenceWeight: Record<string, number> = {
        low: 1,
        medium: 2,
        high: 3,
      };
      const perPerson = new Map<
        string,
        {
          score: number;
          topCategories: Array<{
            name: string;
            confidence: 'low' | 'medium' | 'high';
            similarity: number;
          }>;
        }
      >();
      for (const r of rows) {
        const conf =
          r.confidence === 'low' || r.confidence === 'medium' || r.confidence === 'high'
            ? r.confidence
            : 'low';
        const w = confidenceWeight[conf] ?? 1;
        const similarity = typeof r.similarity === 'number' ? r.similarity : 0;
        const contribution = similarity * w;
        const cur = perPerson.get(r.person_id);
        if (cur) {
          cur.score += contribution;
          cur.topCategories.push({
            name: r.category_name,
            confidence: conf,
            similarity,
          });
        } else {
          perPerson.set(r.person_id, {
            score: contribution,
            topCategories: [
              { name: r.category_name, confidence: conf, similarity },
            ],
          });
        }
      }

      // 4. Фильтр по minMatchScore.
      const minScore = this.cfg.knowledgeClone.minMatchScore;
      const aggregated = [...perPerson.entries()]
        .filter(([, v]) => v.score >= minScore)
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, args.limit);

      if (aggregated.length === 0) return [];

      // 5. Загружаем профили найденных Person'ов.
      const personIds = aggregated.map(([id]) => id);
      const persons = await this.prisma.person.findMany({
        where: { id: { in: personIds } },
        select: {
          id: true,
          name: true,
          knowledgeProfile: true,
        },
      });
      const byId = new Map(persons.map((p) => [p.id, p]));

      const out: CardSpecialistResult[] = [];
      for (const [personId, agg] of aggregated) {
        const person = byId.get(personId);
        if (!person) continue;
        const profile = person.knowledgeProfile as
          | KnowledgeProfileLike
          | null
          | undefined;
        if (!profile || !Array.isArray(profile.categories)) continue;

        // Имена топ-категорий по similarity (для текста и sourceBlockIds).
        const topCategoryNames = new Set(
          agg.topCategories
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, 3)
            .map((c) => c.name.trim().toLowerCase()),
        );
        const matches: CategoryMatch[] = [];
        for (const c of profile.categories) {
          if (!c || typeof c.name !== 'string') continue;
          if (!topCategoryNames.has(c.name.trim().toLowerCase())) continue;
          const conf =
            c.confidence === 'low' || c.confidence === 'medium' || c.confidence === 'high'
              ? c.confidence
              : 'low';
          const sampleStatements: Array<{ quote: string; blockId: string }> = [];
          if (Array.isArray(c.sampleStatements)) {
            for (const s of c.sampleStatements.slice(0, 3)) {
              if (
                s &&
                typeof s.quote === 'string' &&
                typeof s.blockId === 'string'
              ) {
                sampleStatements.push({ quote: s.quote, blockId: s.blockId });
              }
            }
          }
          matches.push({
            name: c.name,
            confidence: conf,
            observationCount:
              typeof c.observationCount === 'number' ? c.observationCount : 1,
            sampleStatements,
            score: 0, // не используется для текста
          });
        }
        if (matches.length === 0) continue;

        const sourceBlockIds = collectSourceBlockIds(matches);
        const confidence = confidenceForMatches(matches);
        const text = formatSummaryText(person.name, matches);
        out.push({
          id: person.id,
          type: 'knowledge_profile',
          title: `Профиль знаний: ${person.name}`,
          text,
          sourceBlockIds,
          confidence,
        });
      }
      return out;
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'Specialist32CardHandler.getCardsForQuery упал — возвращаю []',
      );
      return [];
    }
  }

  /**
   * ТЗ 2026-05-25 Фаза 4 — fallback substring-match (исходный алгоритм β-2).
   * Используется когда embedding-индекс ещё не наполнен (порог
   * `cfg.knowledgeClone.embeddingFallbackThreshold`).
   *
   * Логика остаётся прежней: load Person'ов с knowledgeProfile, токенизация
   * запроса, substring-match по category.name, score по confidence-весам.
   */
  async getCardsForQueryFallback(args: {
    tenantId: string;
    query: string;
    candidateBlockIds: readonly string[];
    limit: number;
  }): Promise<readonly CardSpecialistResult[]> {
    try {
      if (args.limit <= 0) return [];
      const tokens = extractTokens(args.query);
      if (tokens.length === 0) return [];

      const persons = await this.prisma.person.findMany({
        where: {
          tenantId: args.tenantId,
          deletedAt: null,
          relationship: 'employee',
          knowledgeProfile: { not: Prisma.JsonNull },
        },
        select: {
          id: true,
          name: true,
          knowledgeProfile: true,
        },
        take: 300,
      });

      const results: Array<{ result: CardSpecialistResult; score: number }> = [];
      for (const p of persons) {
        const profile = p.knowledgeProfile as
          | KnowledgeProfileLike
          | null
          | undefined;
        if (!profile || !Array.isArray(profile.categories)) continue;
        const matches = matchCategories(profile.categories, tokens);
        if (matches.length === 0) continue;
        const topMatch = matches[0];
        if (!topMatch) continue;
        const sourceBlockIds = collectSourceBlockIds(matches);
        const confidence = confidenceForMatches(matches);
        const text = formatSummaryText(p.name, matches);
        results.push({
          score: topMatch.score,
          result: {
            id: p.id,
            type: 'knowledge_profile',
            title: `Профиль знаний: ${p.name}`,
            text,
            sourceBlockIds,
            confidence,
          },
        });
      }

      results.sort((a, b) => b.score - a.score);
      return results.slice(0, args.limit).map((r) => r.result);
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'Specialist32CardHandler.getCardsForQueryFallback упал — возвращаю []',
      );
      return [];
    }
  }
}

interface KnowledgeProfileLike {
  categories?: Array<{
    name?: string;
    confidence?: string;
    observationCount?: number;
    sampleStatements?: Array<{ quote?: string; blockId?: string }>;
  }>;
}

interface CategoryMatch {
  name: string;
  confidence: 'low' | 'medium' | 'high';
  observationCount: number;
  sampleStatements: Array<{ quote: string; blockId: string }>;
  score: number;
}

function extractTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[\s,.;:!?()«»"'-]+/u)
    .filter((t) => t.length >= 3);
}

function matchCategories(
  categories: KnowledgeProfileLike['categories'],
  tokens: readonly string[],
): CategoryMatch[] {
  if (!categories) return [];
  const out: CategoryMatch[] = [];
  for (const c of categories) {
    if (!c || typeof c.name !== 'string') continue;
    const nameLower = c.name.toLowerCase();
    const matchedTokens = tokens.filter((t) => nameLower.includes(t));
    if (matchedTokens.length === 0) continue;
    const confidence =
      c.confidence === 'low' || c.confidence === 'medium' || c.confidence === 'high'
        ? c.confidence
        : 'low';
    const score =
      matchedTokens.length * (confidence === 'high' ? 3 : confidence === 'medium' ? 2 : 1);
    const sampleStatements: Array<{ quote: string; blockId: string }> = [];
    if (Array.isArray(c.sampleStatements)) {
      for (const s of c.sampleStatements.slice(0, 3)) {
        if (
          s &&
          typeof s.quote === 'string' &&
          typeof s.blockId === 'string'
        ) {
          sampleStatements.push({ quote: s.quote, blockId: s.blockId });
        }
      }
    }
    out.push({
      name: c.name,
      confidence,
      observationCount:
        typeof c.observationCount === 'number' ? c.observationCount : 1,
      sampleStatements,
      score,
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

function collectSourceBlockIds(matches: readonly CategoryMatch[]): string[] {
  const out = new Set<string>();
  for (const m of matches) {
    for (const s of m.sampleStatements) {
      if (s.blockId) out.add(s.blockId);
    }
  }
  return [...out].slice(0, 20);
}

function confidenceForMatches(matches: readonly CategoryMatch[]): number {
  if (matches.length === 0) return 0.5;
  const top = matches[0];
  if (!top) return 0.5;
  const weights: Record<string, number> = { low: 0.55, medium: 0.7, high: 0.85 };
  return weights[top.confidence] ?? 0.55;
}

function formatSummaryText(
  personName: string,
  matches: readonly CategoryMatch[],
): string {
  const top3 = matches.slice(0, 3);
  const lines = top3.map((m) => {
    return `• ${m.name} (уверенность: ${confidenceRu(m.confidence)}, наблюдений: ${m.observationCount})`;
  });
  return [`${personName} разбирается в:`, ...lines].join('\n');
}

function confidenceRu(c: 'low' | 'medium' | 'high'): string {
  switch (c) {
    case 'high':
      return 'высокая';
    case 'medium':
      return 'средняя';
    default:
      return 'низкая';
  }
}
