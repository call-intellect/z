import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Specialist32CardHandler } from './specialist-3-2-card-handler.service';

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

  it("сценарий 1: 10+ embedding'ов, высокий similarity → Person A первым", async () => {
    const personA = makePerson({
      id: 'pA',
      name: 'Маша',
      knowledgeProfile: {
        categories: [
          {
            name: 'биллинг и платёжные шлюзы',
            confidence: 'high',
            observationCount: 8,
            sampleStatements: [{ quote: 'я интегрировала Stripe в проекте Y', blockId: 'b1' }],
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
    expect(res[0]?.id).toBe('pA');
    expect(res[0]?.title).toContain('Маша');
    expect(res[0]?.sourceBlockIds).toContain('b1');
    expect(res[1]?.id).toBe('pB');
  });

  it("сценарий 2: 3 embedding'а (меньше threshold=5) → substring fallback", async () => {
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

    const res = await handler.getCardsForQuery({
      tenantId: 't1',
      query: 'кто понимает биллинг',
      candidateBlockIds: [],
      limit: 5,
    });

    expect(embeddings.embedQuery).not.toHaveBeenCalled();
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
            sampleStatements: [{ quote: 'настраивал pipeline в GitLab', blockId: 'b2' }],
          },
        ],
      },
    });

    const { handler, embeddings } = buildHandler({
      embeddingsCount: 20,
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
    expect(res.length).toBeGreaterThanOrEqual(1);
    expect(res[0]?.id).toBe('pA');
    expect(res[0]?.title).toContain('Маша');
    const petya = res.find((r) => r.id === 'pB');
    expect(petya).toBeUndefined();
  });
});
