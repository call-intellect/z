/**
 * ТЗ 2026-06-06 knowledge-access-groups Фаза 5 (R8) — фокус-тесты на фильтр
 * контекста клона по правам СПРАШИВАЮЩЕГО.
 *
 * Тестируем приватные `loadPersonSubgraph` / `loadRoleSubgraph` через any-cast
 * (метод их вызывает 4 respond-метода; контракт фильтра одинаков для обоих
 * scope). Проверяем 4 режима гейта:
 *   - off       → buildAccessWhere/partition НЕ вызываются, reasoningBlocks = все;
 *   - shadow    → reasoningBlocks НЕ меняются + incAccessShadowDiff(denied);
 *   - enforce   → недоступные блоки отброшены из reasoningBlocks + incAccessDenied(denied)
 *                 + nested block в mentions-query содержит access-фрагмент;
 *   - bypass    → все блоки (partition/buildAccessWhere — короткое замыкание).
 *
 * DI: конструктор ClonesService позиционный (см. clones-conversations.controller.spec).
 * `accessResolver` инжектится `@Optional()` — здесь передаём мок как 9-й аргумент.
 */

import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { KnowledgeAccessContext, KnowledgeAccessResolver } from '../../rbac/knowledge-access-resolver.service';

import { ClonesService } from './clones.service';

const TENANT_ID = 'tenant-1';
const PERSON_ID = 'person-cuid-1';
const ROLE_ID = 'role-cuid-1';
const ENTITY_ID = 'entity-cuid-1';

type Enforcement = 'off' | 'shadow' | 'enforce';

const NON_BYPASS_CTX: KnowledgeAccessContext = {
  deptGroupIds: ['dept-logistics'],
  closedGroupIds: [],
  isBypass: false,
};
const BYPASS_CTX: KnowledgeAccessContext = {
  deptGroupIds: [],
  closedGroupIds: [],
  isBypass: true,
};

/** Два блока: b-open доступен, b-council закрыт от спрашивающего. */
const MENTION_ROWS = [{ blockId: 'b-open' }, { blockId: 'b-council' }];
const BLOCK_ROWS = [
  { id: 'b-open', name: 'open', trustedAnswer: null, evidence: [] },
  { id: 'b-council', name: 'council', trustedAnswer: null, evidence: [] },
];

function buildService(opts: {
  enforcement: Enforcement;
  accessCtx: KnowledgeAccessContext;
  scope: 'person' | 'role';
  /** Ф6 — строки decision.findMany для проверки фильтра проекций (по умолчанию пусто). */
  decisionRows?: Array<{
    id: string;
    statement: string | null;
    rationale: string | null;
    decidedAt: Date | null;
    sourceBlockIds: string[];
  }>;
}) {
  // Перехват where, переданного в ideaBlockEntity.findMany (для проверки nested block).
  let capturedMentionsWhere: Record<string, unknown> | null = null;

  const prisma = {
    person: {
      findUnique: vi.fn(async () => ({
        id: PERSON_ID,
        entityId: ENTITY_ID,
        knowledgeProfile: null,
      })),
      findMany: vi.fn(async () => [{ id: PERSON_ID, entityId: ENTITY_ID }]),
    },
    personRole: {
      findMany: vi.fn(async () => [{ personId: PERSON_ID }]),
    },
    ideaBlockEntity: {
      findMany: vi.fn(async (q: { where: Record<string, unknown> }) => {
        capturedMentionsWhere = q.where;
        return MENTION_ROWS;
      }),
    },
    ideaBlock: {
      findMany: vi.fn(async () => BLOCK_ROWS),
    },
    decision: {
      findMany: vi.fn(async () => opts.decisionRows ?? []),
    },
  } as unknown as PrismaService;

  // resolver: при enforce из двух блоков доступен только b-open (1 denied).
  const buildAccessWhere = vi.fn((_ctx: KnowledgeAccessContext) => ({
    AND: [{ blockAccess: { __access: true } }],
  }));
  const partitionBlockIdsByAccess = vi.fn(
    async (_ctx: KnowledgeAccessContext, ids: string[]) => {
      if (_ctx.isBypass) return { accessible: ids, denied: 0 };
      const accessible = ids.filter((id) => id !== 'b-council');
      return { accessible, denied: ids.length - accessible.length };
    },
  );
  const resolveAccessibleGroups = vi.fn(async () => opts.accessCtx);
  // Ф6 — фильтр проекций: проекция с b-council в sourceBlockIds недоступна.
  const partitionProjectionsByAccess = vi.fn(
    async (
      _ctx: KnowledgeAccessContext,
      items: Array<{ id: string; sourceBlockIds: string[] }>,
    ) => {
      if (_ctx.isBypass) {
        return { accessibleIds: new Set(items.map((i) => i.id)), denied: 0 };
      }
      const accessibleIds = new Set(
        items
          .filter((i) => !i.sourceBlockIds.includes('b-council'))
          .map((i) => i.id),
      );
      return { accessibleIds, denied: items.length - accessibleIds.size };
    },
  );
  const accessResolver = {
    buildAccessWhere,
    partitionBlockIdsByAccess,
    partitionProjectionsByAccess,
    resolveAccessibleGroups,
  } as unknown as KnowledgeAccessResolver;

  const incAccessDenied = vi.fn();
  const incAccessShadowDiff = vi.fn();
  const metrics = {
    incAccessDenied,
    incAccessShadowDiff,
  } as unknown as BusinessMetricsService;

  const cfg = {} as unknown as TypedConfigService;

  // Порядок аргументов конструктора (см. clones-conversations.controller.spec):
  // prisma, aiChatQuota, cfg, llm, metrics, personaBuilder, personaVersioning,
  // rbac, accessResolver (Ф5), embedder, dialog.
  const svc = new ClonesService(
    prisma,
    undefined as never,
    cfg,
    undefined as never,
    metrics,
    undefined as never,
    undefined as never,
    undefined as never,
    accessResolver,
    undefined as never,
    undefined as never,
  );

  return {
    svc,
    mocks: {
      buildAccessWhere,
      partitionBlockIdsByAccess,
      partitionProjectionsByAccess,
      incAccessDenied,
      incAccessShadowDiff,
    },
    getCapturedMentionsWhere: () => capturedMentionsWhere,
  };
}

async function runSubgraph(
  scope: 'person' | 'role',
  enforcement: Enforcement,
  accessCtx: KnowledgeAccessContext,
) {
  const built = buildService({ enforcement, accessCtx, scope });
  // any-cast приватного метода.
  const anySvc = built.svc as unknown as Record<string, (a: unknown) => Promise<{ reasoningBlocks: Array<{ id: string }> }>>;
  const method = scope === 'person' ? 'loadPersonSubgraph' : 'loadRoleSubgraph';
  const args =
    scope === 'person'
      ? { tenantId: TENANT_ID, personId: PERSON_ID, accessCtx, enforcement }
      : { tenantId: TENANT_ID, roleId: ROLE_ID, accessCtx, enforcement };
  const subgraph = await anySvc[method]!(args);
  return { ...built, subgraph };
}

describe.each(['person', 'role'] as const)(
  'ClonesService Ф5 knowledge-access — loadSubgraph (%s scope)',
  (scope) => {
    it('off → buildAccessWhere/partition НЕ вызываются, reasoningBlocks = все', async () => {
      const { subgraph, mocks } = await runSubgraph(scope, 'off', NON_BYPASS_CTX);
      expect(mocks.buildAccessWhere).not.toHaveBeenCalled();
      expect(mocks.partitionBlockIdsByAccess).not.toHaveBeenCalled();
      expect(mocks.incAccessDenied).not.toHaveBeenCalled();
      expect(mocks.incAccessShadowDiff).not.toHaveBeenCalled();
      expect(subgraph.reasoningBlocks.map((b) => b.id).sort()).toEqual([
        'b-council',
        'b-open',
      ]);
    });

    it('enforce → mentions nested block содержит access-фрагмент И недоступный блок отфильтрован + incAccessDenied', async () => {
      const { subgraph, mocks, getCapturedMentionsWhere } = await runSubgraph(
        scope,
        'enforce',
        NON_BYPASS_CTX,
      );
      // DB-фильтр: buildAccessWhere подмешан в nested block.
      expect(mocks.buildAccessWhere).toHaveBeenCalled();
      const where = getCapturedMentionsWhere();
      expect(where).not.toBeNull();
      expect(where!.block).toEqual(
        expect.objectContaining({
          tenantId: TENANT_ID,
          status: 'canonical',
          AND: [{ blockAccess: { __access: true } }],
        }),
      );
      // post-filter: b-council отброшен, остался только b-open.
      expect(subgraph.reasoningBlocks.map((b) => b.id)).toEqual(['b-open']);
      expect(mocks.partitionBlockIdsByAccess).toHaveBeenCalled();
      expect(mocks.incAccessDenied).toHaveBeenCalledWith({ surface: 'clone' }, 1);
      expect(mocks.incAccessShadowDiff).not.toHaveBeenCalled();
    });

    it('shadow → reasoningBlocks НЕ меняются + incAccessShadowDiff', async () => {
      const { subgraph, mocks, getCapturedMentionsWhere } = await runSubgraph(
        scope,
        'shadow',
        NON_BYPASS_CTX,
      );
      // shadow: НЕТ DB-фильтра в mentions.
      expect(mocks.buildAccessWhere).not.toHaveBeenCalled();
      const where = getCapturedMentionsWhere();
      expect(where!.block).toEqual(
        expect.objectContaining({ tenantId: TENANT_ID, status: 'canonical' }),
      );
      expect(where!.block).not.toHaveProperty('AND');
      // выдача НЕ меняется, только метрика расхождения.
      expect(subgraph.reasoningBlocks.map((b) => b.id).sort()).toEqual([
        'b-council',
        'b-open',
      ]);
      expect(mocks.partitionBlockIdsByAccess).toHaveBeenCalled();
      expect(mocks.incAccessShadowDiff).toHaveBeenCalledWith({ surface: 'clone' }, 1);
      expect(mocks.incAccessDenied).not.toHaveBeenCalled();
    });

    it('bypass (enforce) → все блоки, partition/buildAccessWhere короткое замыкание', async () => {
      const { subgraph, mocks } = await runSubgraph(scope, 'enforce', BYPASS_CTX);
      // accessEnforce ложно при isBypass → DB-фильтр не подмешивается.
      expect(mocks.buildAccessWhere).not.toHaveBeenCalled();
      // post-filter тоже короткое замыкание (bypass).
      expect(mocks.partitionBlockIdsByAccess).not.toHaveBeenCalled();
      expect(mocks.incAccessDenied).not.toHaveBeenCalled();
      expect(subgraph.reasoningBlocks.map((b) => b.id).sort()).toEqual([
        'b-council',
        'b-open',
      ]);
    });
  },
);

/**
 * Ф6 (R12) — фильтр ПРОЕКЦИЙ (decisions) в контексте клона по доступу
 * спрашивающего. Decisions грузятся только в loadPersonSubgraph.
 */
describe('ClonesService Ф6 knowledge-access — decisions в loadPersonSubgraph', () => {
  const FIXED = new Date('2026-01-01');
  const DECISION_ROWS = [
    { id: 'd-open', statement: 'открытое', rationale: null, decidedAt: FIXED, sourceBlockIds: ['b-open'] },
    { id: 'd-council', statement: 'закрытое', rationale: null, decidedAt: FIXED, sourceBlockIds: ['b-council'] },
  ];

  async function runPerson(enforcement: Enforcement, accessCtx: KnowledgeAccessContext) {
    const built = buildService({
      enforcement,
      accessCtx,
      scope: 'person',
      decisionRows: DECISION_ROWS,
    });
    const anySvc = built.svc as unknown as Record<
      string,
      (a: unknown) => Promise<{ decisions: Array<{ id: string }> }>
    >;
    const subgraph = await anySvc.loadPersonSubgraph!({
      tenantId: TENANT_ID,
      personId: PERSON_ID,
      accessCtx,
      enforcement,
    });
    return { ...built, subgraph };
  }

  it('off → все decisions, partitionProjectionsByAccess НЕ вызывается', async () => {
    const { subgraph, mocks } = await runPerson('off', NON_BYPASS_CTX);
    expect(subgraph.decisions.map((d) => d.id).sort()).toEqual(['d-council', 'd-open']);
    expect(mocks.partitionProjectionsByAccess).not.toHaveBeenCalled();
  });

  it('enforce → недоступный decision (d-council) убран + incAccessDenied(clone)', async () => {
    const { subgraph, mocks } = await runPerson('enforce', NON_BYPASS_CTX);
    expect(subgraph.decisions.map((d) => d.id)).toEqual(['d-open']);
    expect(mocks.partitionProjectionsByAccess).toHaveBeenCalled();
    expect(mocks.incAccessDenied).toHaveBeenCalledWith({ surface: 'clone' }, 1);
  });

  it('shadow → все decisions + incAccessShadowDiff(clone)', async () => {
    const { subgraph, mocks } = await runPerson('shadow', NON_BYPASS_CTX);
    expect(subgraph.decisions.map((d) => d.id).sort()).toEqual(['d-council', 'd-open']);
    expect(mocks.incAccessShadowDiff).toHaveBeenCalledWith({ surface: 'clone' }, 1);
  });

  it('bypass (enforce) → все decisions, partition не зовётся', async () => {
    const { subgraph, mocks } = await runPerson('enforce', BYPASS_CTX);
    expect(subgraph.decisions.map((d) => d.id).sort()).toEqual(['d-council', 'd-open']);
    expect(mocks.partitionProjectionsByAccess).not.toHaveBeenCalled();
  });
});

/**
 * ТЗ 2026-06-08 (Ф6/G) — clone-respond hardening.
 *
 * G.1: judgmental-режим больше НЕ понижает анти-дипфейк-порог — при
 *      requiredBlocksOverride=null берётся cfg.skill.cloneTopicMinBlocks (=2),
 *      и при <2 reasoning-блоках (cosine≥0.70) клон отказывает так же, как
 *      в factual (refused=true, topic_starved), а не отвечает по 1 блоку.
 * G.2: parseCitations парсит `[DECISION:id]` наравне с `[BLOCK:id]`.
 *
 * Приватные методы тестируем через any-cast; сервис конструируем с
 * минимальными моками (cfg.skill + embedder), как в соседних spec.
 */
describe('ClonesService Ф6 (G) — clone-respond hardening', () => {
  type AssertTopicDensityArgs = {
    question: string;
    reasoningBlocks: ReadonlyArray<{ id: string; text: string }>;
    requiredBlocksOverride?: number | null;
  };
  type AssertTopicDensityResult = {
    refused: boolean;
    matchedBlocks: number;
    requiredBlocks: number;
    similarityThreshold: number;
  };
  type CloneSubgraphLike = {
    reasoningBlocks: Array<{
      id: string;
      text: string;
      meetingId: string | null;
      meetingTitle: string | null;
      startMs: number | null;
      endMs: number | null;
      snippet: string | null;
    }>;
    knowledgeProfileSummary: string | null;
    decisions: Array<{ id: string; statement: string; rationale: string | null }>;
  };
  type CitationLike = { blockId: string; snippet?: string };

  function buildBareService(opts?: {
    embedQuery?: () => Promise<number[] | null>;
  }) {
    const cfg = {
      skill: {
        cloneTopicMinBlocks: 2,
        cloneTopicSimilarityThreshold: 0.7,
      },
    } as unknown as TypedConfigService;
    const embedder = {
      embedQuery: vi.fn(opts?.embedQuery ?? (async () => [0.1, 0.2, 0.3])),
    } as unknown as never;
    // Порядок: prisma, aiChatQuota, cfg, llm, metrics, personaBuilder,
    // personaVersioning, rbac, accessResolver, embedder, dialog.
    const svc = new ClonesService(
      undefined as never,
      undefined as never,
      cfg,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      embedder,
      undefined as never,
    );
    return svc;
  }

  function block(id: string) {
    return {
      id,
      text: `текст блока ${id}`,
      meetingId: null,
      meetingTitle: null,
      startMs: null,
      endMs: null,
      snippet: null,
    };
  }

  describe('G.1 — assertTopicDensity единый порог для judgmental/factual', () => {
    it('requiredBlocksOverride=null → requiredBlocks = cfg.cloneTopicMinBlocks (2), а не 1', async () => {
      const svc = buildBareService();
      const assert = (svc as unknown as {
        assertTopicDensity: (a: AssertTopicDensityArgs) => Promise<AssertTopicDensityResult>;
      }).assertTopicDensity.bind(svc);

      const res = await assert({
        question: 'как ты подходишь к найму?',
        reasoningBlocks: [block('b1')], // всего 1 блок
        requiredBlocksOverride: null, // judgmental-путь после G.1
      });

      expect(res.requiredBlocks).toBe(2);
      // 1 < 2 → отказ (topic_starved), а не ответ по одному блоку.
      expect(res.refused).toBe(true);
    });

    it('2+ блоков по теме (cosine≥0.70) при том же пороге → НЕ отказ', async () => {
      // embedder возвращает тот же вектор, что и блоки → cosine=1 ≥ 0.70.
      const svc = buildBareService();
      // мокаем загрузку embedding'ов блоков (приватный loadBlockEmbeddings).
      (svc as unknown as {
        loadBlockEmbeddings: (ids: string[]) => Promise<Map<string, number[]>>;
      }).loadBlockEmbeddings = async (ids: string[]) =>
        new Map(ids.map((id) => [id, [0.1, 0.2, 0.3]]));

      const assert = (svc as unknown as {
        assertTopicDensity: (a: AssertTopicDensityArgs) => Promise<AssertTopicDensityResult>;
      }).assertTopicDensity.bind(svc);

      const res = await assert({
        question: 'как ты подходишь к найму?',
        reasoningBlocks: [block('b1'), block('b2')],
        requiredBlocksOverride: null,
      });

      expect(res.requiredBlocks).toBe(2);
      expect(res.matchedBlocks).toBeGreaterThanOrEqual(2);
      expect(res.refused).toBe(false);
    });
  });

  describe('G.2 — parseCitations парсит [DECISION:id]', () => {
    function emptySubgraph(): CloneSubgraphLike {
      return { reasoningBlocks: [], knowledgeProfileSummary: null, decisions: [] };
    }

    function parse(svc: ClonesService, text: string, subgraph: CloneSubgraphLike) {
      return (svc as unknown as {
        parseCitations: (t: string, s: CloneSubgraphLike) => CitationLike[];
      }).parseCitations(text, subgraph);
    }

    it('вход с [DECISION:id] (есть в subgraph.decisions) → id в citations + snippet=statement', () => {
      const svc = buildBareService();
      const subgraph = emptySubgraph();
      subgraph.decisions = [
        { id: 'dec-1', statement: 'Перешли на недельные спринты', rationale: null },
      ];

      const out = parse(svc, 'Решение принято [DECISION:dec-1].', subgraph);

      const ids = out.map((c) => c.blockId);
      expect(ids).toContain('dec-1');
      const dec = out.find((c) => c.blockId === 'dec-1');
      expect(dec?.snippet).toBe('Перешли на недельные спринты');
    });

    it('Б20 — вход с [DECISION:id] которого НЕТ в subgraph → НЕ засчитывается (призрак не обходит grounding-гейт)', () => {
      const svc = buildBareService();
      const out = parse(svc, 'См. [DECISION:ghost].', emptySubgraph());
      // Раздел 8 Б20: ghost-DECISION (нет в subgraph) не должен попадать в
      // citations, иначе isUngrounded увидит citations.length>0 и пропустит
      // галлюцинацию. По аналогии с BLOCK-веткой.
      expect(out.map((c) => c.blockId)).not.toContain('ghost');
      expect(out).toHaveLength(0);
    });

    it('вход с [BLOCK:id] работает как раньше', () => {
      const svc = buildBareService();
      const subgraph = emptySubgraph();
      subgraph.reasoningBlocks = [
        {
          ...block('blk-1'),
          meetingId: 'm-1',
          meetingTitle: 'Планёрка',
          snippet: 'сниппет',
        },
      ];

      const out = parse(svc, 'Как обсуждали [BLOCK:blk-1].', subgraph);

      const cit = out.find((c) => c.blockId === 'blk-1');
      expect(cit).toBeDefined();
      expect(cit?.snippet).toBe('сниппет');
    });

    it('дедуп одинаковых id (BLOCK и DECISION с общим seen)', () => {
      const svc = buildBareService();
      const subgraph = emptySubgraph();
      subgraph.reasoningBlocks = [block('dup')];
      subgraph.decisions = [{ id: 'dup', statement: 'дубль', rationale: null }];

      // 'dup' встречается и как BLOCK (дважды), и как DECISION → один раз в out.
      const out = parse(
        svc,
        '[BLOCK:dup] и снова [BLOCK:dup] и [DECISION:dup]',
        subgraph,
      );

      const dupCount = out.filter((c) => c.blockId === 'dup').length;
      expect(dupCount).toBe(1);
    });
  });
});
