import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  type CardSpecialistHandler,
  type CardSpecialistResult,
  CardSpecialistRegistry,
} from '../../chat-v2/services/card-specialist-registry.service';

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
  ) {}

  onModuleInit(): void {
    this.registry.register(Specialist32CardHandler.SPECIALIST_NAME, this);
    this.logger.log(
      `Specialist32CardHandler зарегистрирован как '${Specialist32CardHandler.SPECIALIST_NAME}' в CardSpecialistRegistry`,
    );
  }

  async getCardsForQuery(args: {
    tenantId: string;
    query: string;
    candidateBlockIds: readonly string[];
    limit: number;
  }): Promise<readonly CardSpecialistResult[]> {
    try {
      if (args.limit <= 0) return [];
      const tokens = extractTokens(args.query);
      if (tokens.length === 0) return [];

      // На β-2 — простой поиск: Person, у которых knowledgeProfile содержит
      // одну из категорий по text-match. JSON-containment в pg удобнее
      // делать через raw SQL, но на β-2 — простой fetch + in-memory match.
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
        'Specialist32CardHandler.getCardsForQuery упал — возвращаю []',
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
