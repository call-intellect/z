import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Specialist32CardHandler } from './specialist-3-2-card-handler.service';

/**
 * ТЗ 2026-05-25 clone-reliability-hardening, Фаза 4 — юнит-тесты
 * `Specialist32CardHandler.getCardsForQuery` (векторный поиск с fallback).
 *
 * Покрываемые сценарии:
 *   1. В БД 10+ embedding'ов, embed query даёт высокий similarity к Person A →
 *      Person A возвращается первым.
 *   2. В БД 3 embedding'а (меньше fallback threshold=5) → используется
 *      substring-match (старый код).
 *   3. Query слово, отсутствующее в category.name substring-ом, но
 *      семантически близкое (мок similarity 0.85 у Person B) → находит
 *      Person B. Это **ключевое улучшение** против старой substring-версии.
 */

interface FakeEmbeddingRow {
  id: string;
  person_id: string;
  category_name: string;
  confidence: 'low' | 'medium' | 'high';
  similarity: number;
}

interface FakePerson {
  id: string;
  tenantId: string;
  name: string;
  knowledgeProfile: {
    categories: Array<{
      name: string;
      confidence: 'low' | 'medium' | 'high';
      observationCount: number;
      sampleStatements: Array<{ quote: string; blockId: string }>;
    }>;
  } | null;
  deletedAt: Date | null;
  relationship: string;
}

function buildHandler(args: {
  embeddingsCount: number;
  vectorRows: FakeEmbeddingRow[];
  persons: FakePerson[];
  fallbackThreshold?: number;
  minMatchScore?: number;
  embedQueryResult?: number[] | null;
}) {
  const prisma = {
    personKnowledgeCategoryEmbedding: {
      count: vi.fn(async () => args.embeddingsCount),
    },
    person: {
      findMany: vi.fn(async ({ where }: any) => {
        // fallback substring-path вызывает с фильтрами relationship/deletedAt.
        // vector-path вызывает с id: { in }.
        if (where?.id?.in) {
          const ids = new Set<string>(where.id.in);
          return args.persons.filter((p) => ids.has(p.id));
        }
        return args.persons.filter(
          (p) =>
            p.deletedAt === null &&
            p.relationship === 'employee' &&
            p.tenantId === where.tenantId &&
            p.knowledgeProfile !== null,
        );
      }),
    },
    $queryRaw: vi.fn(async () => args.vectorRows),
  };
  const registry = {
    register: vi.fn(),
  };
  const cfg = {
    knowledgeClone: {
      embeddingFallbackThreshold: args.fallbackThreshold ?? 5,
      minMatchScore: args.minMatchScore ?? 1.0,
    },
  };
  const embeddings = {
    embedQuery: vi.fn(async () =>
      // Класс G2: дефолтный стаб-вектор теперь ровно EMBEDDING_DIMENSIONS (1536),
      // чтобы пройти guard размерности в knnByEmbedding (раньше длина мока была
      // не важна, теперь dim-guard активен). Сам similarity берётся из vectorRows.
      args.embedQueryResult === undefined
        ? new Array(1536).fill(0.01)
        : args.embedQueryResult,
    ),
  };
  const handler = new Specialist32CardHandler(
    prisma as any,
    registry as any,
    cfg as any,
    embeddings as any,
  );
  return { handler, prisma, embeddings, registry };
}

function makePerson(overrides: Partial<FakePerson> = {}): FakePerson {
  return {
    id: 'p1',
    tenantId: 't1',
    name: 'Person',
    knowledgeProfile: {
      categories: [
        {
          name: 'дефолтная категория',
          confidence: 'high',
          observationCount: 5,
          sampleStatements: [{ quote: 'я этим занимаюсь', blockId: 'b1' }],
        },
      ],
    },
    deletedAt: null,
    relationship: 'employee',
    ...overrides,
  };
}

describe('Specialist32CardHandler.getCardsForQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('сценарий 1: 10+ embedding\'ов, высокий similarity → Person A первым', async () => {
    const personA = makePerson({
      id: 'pA',
      name: 'Маша',
      knowledgeProfile: {
        categories: [
          {
            name: 'биллинг и платёжные шлюзы',
            confidence: 'high',
            observationCount: 8,
            sampleStatements: [
              { quote: 'я интегрировала Stripe в проекте Y', blockId: 'b1' },
            ],
          },
        ],
      },
    });
    const personB = makePerson({
      id: 'pB',
      name: 'Петя',
      knowledgeProfile: {
        categories: [
          {
            name: 'фронтенд',
            confidence: 'medium',
            observationCount: 3,
            sampleStatements: [{ quote: 'верстаю формы', blockId: 'b2' }],
          },
        ],
      },
    });

    const { handler, embeddings } = buildHandler({
      embeddingsCount: 12,
      vectorRows: [
        {
          id: 'e1',
          person_id: 'pA',
          category_name: 'биллинг и платёжные шлюзы',
          confidence: 'high',
          similarity: 0.92,
        },
        // Петя — высокий similarity (0.7*medium-weight=1.4 ≥ 1.0),
        // чтобы пройти minMatchScore и проверить порядок.
        {
          id: 'e2',
          person_id: 'pB',
          category_name: 'фронтенд',
          confidence: 'medium',
          similarity: 0.7,
        },
      ],
      persons: [personA, personB],
    });

    const res = await handler.getCardsForQuery({
      tenantId: 't1',
      query: 'кто разбирается в Stripe',
      candidateBlockIds: [],
      limit: 5,
    });

    expect(embeddings.embedQuery).toHaveBeenCalledOnce();
    expect(res).toHaveLength(2);
    // Маша (0.92*3=2.76) > Петя (0.7*2=1.4).
    expect(res[0]?.id).toBe('pA');
    expect(res[0]?.title).toContain('Маша');
    expect(res[0]?.sourceBlockIds).toContain('b1');
    expect(res[1]?.id).toBe('pB');
  });

  it('сценарий 2: 3 embedding\'а (меньше threshold=5) → substring fallback', async () => {
    const personA = makePerson({
      id: 'pA',
      name: 'Маша',
      knowledgeProfile: {
        categories: [
          {
            name: 'биллинг и платёжные шлюзы',
            confidence: 'high',
            observationCount: 8,
            sampleStatements: [{ quote: 'Stripe', blockId: 'b1' }],
          },
        ],
      },
    });

    const { handler, embeddings, prisma } = buildHandler({
      embeddingsCount: 3,
      vectorRows: [],
      persons: [personA],
    });

    // Запрос содержит «биллинг» — substring совпадёт.
    const res = await handler.getCardsForQuery({
      tenantId: 't1',
      query: 'кто понимает биллинг',
      candidateBlockIds: [],
      limit: 5,
    });

    // Не должны были звать embedQuery (мы пошли в fallback).
    expect(embeddings.embedQuery).not.toHaveBeenCalled();
    // $queryRaw тоже не звали.
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(res).toHaveLength(1);
    expect(res[0]?.id).toBe('pA');
  });

  it('G2: вектор неверной размерности → substring fallback (pgvector SQL не вызван, не 500)', async () => {
    const personA = makePerson({
      id: 'pA',
      name: 'Маша',
      knowledgeProfile: {
        categories: [
          {
            name: 'биллинг и платёжные шлюзы',
            confidence: 'high',
            observationCount: 8,
            sampleStatements: [{ quote: 'Stripe', blockId: 'b1' }],
          },
        ],
      },
    });
    // embeddingsCount ≥ threshold → пошли бы в вектор, но guard отвергнет вектор
    // (3 ≠ 1536) → деградация на substring. Запрос содержит «биллинг» → совпадёт.
    const { handler, prisma, embeddings } = buildHandler({
      embeddingsCount: 20,
      vectorRows: [],
      persons: [personA],
      embedQueryResult: [0.1, 0.2, 0.3],
    });

    const res = await handler.getCardsForQuery({
      tenantId: 't1',
      query: 'кто понимает биллинг',
      candidateBlockIds: [],
      limit: 5,
    });

    expect(embeddings.embedQuery).toHaveBeenCalledOnce();
    // pgvector SQL НЕ звался — guard отверг вектор до запроса.
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    // Substring-fallback нашёл Машу.
    expect(res).toHaveLength(1);
    expect(res[0]?.id).toBe('pA');
  });

  it('сценарий 3: семантически близкий запрос без substring → находит Person B (ключевое улучшение)', async () => {
    // У Маши категория «биллинг и платёжные шлюзы» — substring «Stripe» НЕ
    // совпадёт по буквам. Старая версия не нашла бы её. Векторный поиск —
    // находит за счёт high similarity.
    const personA = makePerson({
      id: 'pA',
      name: 'Маша',
      knowledgeProfile: {
        categories: [
          {
            name: 'биллинг и платёжные шлюзы',
            confidence: 'high',
            observationCount: 8,
            sampleStatements: [
              {
                quote: 'я интегрировала платёжный шлюз в проекте Y',
                blockId: 'b1',
              },
            ],
          },
        ],
      },
    });
    const personB = makePerson({
      id: 'pB',
      name: 'Петя',
      knowledgeProfile: {
        categories: [
          {
            name: 'инфраструктура CI/CD',
            confidence: 'medium',
            observationCount: 4,
            sampleStatements: [
              { quote: 'настраивал pipeline в GitLab', blockId: 'b2' },
            ],
          },
        ],
      },
    });

    const { handler, embeddings } = buildHandler({
      embeddingsCount: 20,
      // Высокий similarity для категории Маши даже при отсутствии substring.
      vectorRows: [
        {
          id: 'e1',
          person_id: 'pA',
          category_name: 'биллинг и платёжные шлюзы',
          confidence: 'high',
          similarity: 0.85,
        },
        {
          id: 'e2',
          person_id: 'pB',
          category_name: 'инфраструктура CI/CD',
          confidence: 'medium',
          similarity: 0.2,
        },
      ],
      persons: [personA, personB],
    });

    const res = await handler.getCardsForQuery({
      tenantId: 't1',
      query: 'кто разбирается в Stripe',
      candidateBlockIds: [],
      limit: 5,
    });

    expect(embeddings.embedQuery).toHaveBeenCalledOnce();
    // Маша должна найтись несмотря на отсутствие substring «stripe» в
    // имени её категории. Это и есть ключевое улучшение.
    expect(res.length).toBeGreaterThanOrEqual(1);
    expect(res[0]?.id).toBe('pA');
    expect(res[0]?.title).toContain('Маша');
    // Петя не должен попасть в результат — score 0.2*2=0.4 < minMatchScore=1.0.
    const petya = res.find((r) => r.id === 'pB');
    expect(petya).toBeUndefined();
  });
});
