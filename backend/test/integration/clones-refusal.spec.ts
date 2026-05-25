/**
 * Интеграционный тест программного анти-deepfake клона (Фаза 1, DoD 1.6).
 *
 * Источник: plans/tz/2026-05-25-clone-reliability-hardening.md §1.3.
 *
 * Проверяемая гипотеза:
 *   `ClonesService.askPerson` ДО вызова модели сам по embedding'ам решает,
 *   достаточно ли в reasoning-блоках сотрудника материала «по теме» вопроса.
 *   Если меньше `cfg.skill.cloneTopicMinBlocks` блоков с близостью к вопросу
 *   ≥ `cfg.skill.cloneTopicSimilarityThreshold` — клон возвращает готовый
 *   текст-отказ и НЕ вызывает `LlmRouterService.call` (экономим деньги +
 *   блокируем дипфейк).
 *
 * Это «интеграция» в смысле «ClonesService + KnowledgeEmbeddingService
 * (моканный) + Prisma (моканный)», а не E2E с реальным БД — реальный Postgres
 * не нужен.
 *
 * Сценарии:
 *   1. Вопрос «как ты будешь продавать наш продукт» + 5 блоков с low
 *      similarity (< 0.70) → refused=true, refusalReason='topic_starved',
 *      фраза-отказ совпадает с константой, llm.call НЕ вызывался.
 *   2. Вопрос про оценку сроков + 3 блока high similarity (≥ 0.70) →
 *      refused undefined/false, llm.call вызван ровно один раз.
 *   3. Edge case: ровно 1 блок high similarity → refused=true (порог 2 —
 *      строгое неравенство «matched < required»).
 */

import {
  type ExecutablePersona,
  Prisma,
  type SkillProfile,
  type SkillTrait,
} from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../src/common/config/index';
import type { BusinessMetricsService } from '../../src/common/metrics/business-metrics.service';
import type { PrismaService } from '../../src/common/prisma/prisma.service';
import type { RedisService } from '../../src/common/redis/redis.service';
import type { LlmRouterService } from '../../src/modules/ai/services/llm-router.service';
import { ClonesService } from '../../src/modules/clones/services/clones.service';
import type { KnowledgeEmbeddingService } from '../../src/modules/knowledge-core/services/embedding.service';
import type { ExecutablePersonaBuildService } from '../../src/modules/knowledge-core/services/executable-persona-build.service';
import type { ExecutablePersonaVersioningService } from '../../src/modules/knowledge-core/services/executable-persona-versioning.service';
import type { RbacService } from '../../src/modules/rbac/rbac.service';

interface SetupArgs {
  /** ID блоков, считающихся «по теме» — для них вернётся вектор, близкий к question-вектору. */
  topicBlockIds: string[];
  /** ID всех блоков сотрудника в подграфе (в т.ч. off-topic). */
  allBlockIds: string[];
  /** Хочешь поменять матрицу cfg.skill — переопредели здесь. */
  cfgOverrides?: Partial<{
    cloneTopicSimilarityThreshold: number;
    cloneTopicMinBlocks: number;
    cloneAskPerUserPerDay: number;
  }>;
}

interface Setup {
  service: ClonesService;
  llmCall: ReturnType<typeof vi.fn>;
  incCloneAskRefused: ReturnType<typeof vi.fn>;
  incCloneAsk: ReturnType<typeof vi.fn>;
  embedQuery: ReturnType<typeof vi.fn>;
  chatV2MessageCreate: ReturnType<typeof vi.fn>;
}

const TENANT_ID = 'org-test-1';
const REQUESTER_USER_ID = 'user-admin-1';
const PERSON_ID = 'person-1';
const PROFILE_ID = 'profile-1';
const PERSONA_ID = 'persona-1';
const ENTITY_ID = 'entity-1';
const EMBED_DIM = 4;

/**
 * Векторы для embedQuery / IdeaBlock.embedding специально нормированы так,
 * чтобы cosine-близость было легко рассчитать вручную.
 *
 *   - QUESTION = [1, 0, 0, 0]
 *   - ON_TOPIC = [1, 0, 0, 0] → cosine = 1.0 (≥ 0.70 — «по теме»)
 *   - OFF_TOPIC = [0, 1, 0, 0] → cosine = 0   (< 0.70 — НЕ по теме)
 */
const QUESTION_VEC = [1, 0, 0, 0];
const ON_TOPIC_VEC = [1, 0, 0, 0];
const OFF_TOPIC_VEC = [0, 1, 0, 0];

function vectorToPgText(v: number[]): string {
  return `[${v.join(',')}]`;
}

function setup(args: SetupArgs): Setup {
  // ── Prisma mock ────────────────────────────────────────────────
  const skillTraits: SkillTrait[] = Array.from({ length: 3 }, (_, i) => ({
    id: `trait-${i + 1}`,
    profileId: PROFILE_ID,
    tenantId: TENANT_ID,
    category: `category-${i + 1}`,
    statement: `statement-${i + 1}`,
    confidence: 'high' as const,
    observationCount: 6,
    sourceBlockIds: args.allBlockIds.slice(0, 2),
    firstObservedAt: new Date('2026-04-01'),
    lastConfirmedAt: new Date('2026-05-20'),
    status: 'active' as const,
    misleadingReason: null,
    misleadingFlaggedByUserId: null,
    misleadingFlaggedAt: null,
    embedding: null,
    categoryId: null,
    supersededById: null,
    supersededAt: null,
    createdAt: new Date('2026-04-01'),
    updatedAt: new Date('2026-05-20'),
    metadata: null,
  })) as unknown as SkillTrait[];

  const profile: SkillProfile & {
    person: {
      id: string;
      name: string;
      userId: string | null;
      relationship: string;
    };
    traits: SkillTrait[];
  } = {
    id: PROFILE_ID,
    personId: PERSON_ID,
    tenantId: TENANT_ID,
    status: 'active',
    buildVersion: 1,
    lastBuildAt: new Date('2026-05-20'),
    rebuildReason: null,
    createdAt: new Date('2026-04-01'),
    updatedAt: new Date('2026-05-20'),
    person: {
      id: PERSON_ID,
      name: 'Тестовый сотрудник',
      userId: 'user-employee-1',
      relationship: 'employee',
    },
    traits: skillTraits,
  } as unknown as SkillProfile & {
    person: {
      id: string;
      name: string;
      userId: string | null;
      relationship: string;
    };
    traits: SkillTrait[];
  };

  const persona: ExecutablePersona = {
    id: PERSONA_ID,
    tenantId: TENANT_ID,
    profileId: PROFILE_ID,
    scope: 'person',
    scopeRefId: PERSON_ID,
    version: 1,
    status: 'active',
    personaPrompt: 'Ты — внимательный и осторожный инженер.',
    snapshotAt: new Date('2026-05-22'),
    builtFromTraitsCount: 3,
    builtFromBlocksCount: args.allBlockIds.length,
    createdAt: new Date('2026-05-22'),
    updatedAt: new Date('2026-05-22'),
  } as unknown as ExecutablePersona;

  // Маршрутизация $queryRaw — отдаём embedding-строки только для «on-topic».
  const queryRaw = vi.fn(async (..._args: unknown[]) => {
    const onTopic = args.topicBlockIds;
    const offTopic = args.allBlockIds.filter(
      (id) => !args.topicBlockIds.includes(id),
    );
    return [
      ...onTopic.map((id) => ({ id, emb: vectorToPgText(ON_TOPIC_VEC) })),
      ...offTopic.map((id) => ({ id, emb: vectorToPgText(OFF_TOPIC_VEC) })),
    ];
  });

  const chatV2ConversationCreate = vi.fn(async () => ({
    id: 'conv-1',
    tenantId: TENANT_ID,
  }));
  const chatV2MessageCreate = vi.fn(async (input: { data: { role: string } }) => ({
    id:
      input.data.role === 'assistant'
        ? 'msg-assistant-1'
        : 'msg-user-1',
  }));

  const prisma = {
    skillProfile: {
      findUnique: vi.fn(async () => profile),
    },
    executablePersona: {
      findFirst: vi.fn(async () => persona),
    },
    person: {
      findUnique: vi.fn(async () => ({
        id: PERSON_ID,
        entityId: ENTITY_ID,
        knowledgeProfile: null,
      })),
    },
    ideaBlockEntity: {
      findMany: vi.fn(async () =>
        args.allBlockIds.map((id) => ({ blockId: id })),
      ),
    },
    ideaBlock: {
      findMany: vi.fn(async () =>
        args.allBlockIds.map((id) => ({
          id,
          name: `Block ${id}`,
          trustedAnswer: `Текст рассуждения для ${id}`,
          evidence: [{ quote: `Цитата ${id}`, rawEventId: null, sourceTimestamp: null }],
        })),
      ),
    },
    decision: {
      findMany: vi.fn(async () => []),
    },
    chatV2Conversation: {
      create: chatV2ConversationCreate,
      findFirst: vi.fn(async () => null),
    },
    chatV2Message: {
      create: chatV2MessageCreate,
    },
    $queryRaw: queryRaw,
  } as unknown as PrismaService;

  // ── Redis mock (rate-limit обходим — incr возвращает 1) ──────
  const redis = {
    client: {
      incr: vi.fn(async () => 1),
      expire: vi.fn(async () => 1),
    },
  } as unknown as RedisService;

  // ── TypedConfigService mock ──────────────────────────────────
  const cfg = {
    skill: {
      cloneAskPerUserPerDay: args.cfgOverrides?.cloneAskPerUserPerDay ?? 100,
      cloneTopicSimilarityThreshold:
        args.cfgOverrides?.cloneTopicSimilarityThreshold ?? 0.7,
      cloneTopicMinBlocks: args.cfgOverrides?.cloneTopicMinBlocks ?? 2,
    },
  } as unknown as TypedConfigService;

  // ── LlmRouter mock — НЕ должен вызываться в отказных сценариях ──
  const llmCall = vi.fn(async () => ({
    text: 'Это ответ от модели (если её вызвали).',
    modelUsed: 'deepseek:deepseek-v4-flash',
    inputTokens: 100,
    outputTokens: 50,
    cachedTokens: 0,
    durationMs: 200,
    tier: 'primary' as const,
  }));
  const llm = { call: llmCall } as unknown as LlmRouterService;

  // ── BusinessMetrics mock ─────────────────────────────────────
  const incCloneAskRefused = vi.fn();
  const incCloneAsk = vi.fn();
  const incCloneAskByOwner = vi.fn();
  const metrics = {
    incCloneAskRefused,
    incCloneAsk,
    incCloneAskByOwner,
    incSkillTraitsMarkedMisleading: vi.fn(),
  } as unknown as BusinessMetricsService;

  // ── Persona services (не должны быть нужны для refused-пути,
  // но askPerson вызывает personaBuilder.buildForProfile, только если
  // findFirst вернул null. У нас findFirst возвращает persona — пропускаем).
  const personaBuilder = {
    buildForProfile: vi.fn(),
  } as unknown as ExecutablePersonaBuildService;
  const personaVersioning = {
    triggerRebuild: vi.fn(),
  } as unknown as ExecutablePersonaVersioningService;

  // ── RBAC mock — owner-admin, всегда разрешает ─────────────────
  const rbac = {
    check: vi.fn(async () => true),
    loadContext: vi.fn(async () => ({ isSuperAdmin: false, role: 'admin' as const })),
  } as unknown as RbacService;

  // ── Embedder mock — embedQuery возвращает фиксированный вектор.
  const embedQuery = vi.fn(async () => QUESTION_VEC);
  const embedder = {
    embedQuery,
  } as unknown as KnowledgeEmbeddingService;

  const service = new ClonesService(
    prisma,
    redis,
    cfg,
    llm,
    metrics,
    personaBuilder,
    personaVersioning,
    rbac,
    embedder,
  );

  return {
    service,
    llmCall,
    incCloneAskRefused,
    incCloneAsk,
    embedQuery,
    chatV2MessageCreate,
  };
}

describe('ClonesService.askPerson — программный анти-deepfake (Фаза 1)', () => {
  it('сценарий 1: 5 off-topic блоков (low similarity) → refused=true, llm.call НЕ вызывался', async () => {
    const allBlockIds = ['b1', 'b2', 'b3', 'b4', 'b5'];
    const { service, llmCall, incCloneAskRefused, chatV2MessageCreate } = setup({
      allBlockIds,
      topicBlockIds: [], // ни один не на тему
    });

    const result = await service.askPerson({
      tenantId: TENANT_ID,
      requesterUserId: REQUESTER_USER_ID,
      personId: PERSON_ID,
      question: 'Как ты будешь продавать наш продукт?',
    });

    expect(result.refused).toBe(true);
    expect(result.refusalReason).toBe('topic_starved');
    expect(result.text).toBe(ClonesService.TOPIC_STARVED_REFUSAL_TEXT);
    expect(result.citations).toEqual([]);
    expect(result.mode).toBe('clone_style');

    // Главная гарантия: модель НЕ позвали.
    expect(llmCall).not.toHaveBeenCalled();

    // Метрика отказа инкрементнута ровно один раз с reason='topic_starved'.
    expect(incCloneAskRefused).toHaveBeenCalledTimes(1);
    expect(incCloneAskRefused).toHaveBeenCalledWith({ reason: 'topic_starved' });

    // Сообщение записано в chatV2Message с refused-маркером в llmMeta.
    const assistantWrite = chatV2MessageCreate.mock.calls.find(
      (call: unknown[]) =>
        (call[0] as { data: { role: string } }).data.role === 'assistant',
    );
    expect(assistantWrite).toBeDefined();
    const data = (assistantWrite![0] as {
      data: { text: string; llmMeta: { refused: boolean; refusalReason: string } };
    }).data;
    expect(data.text).toBe(ClonesService.TOPIC_STARVED_REFUSAL_TEXT);
    expect(data.llmMeta.refused).toBe(true);
    expect(data.llmMeta.refusalReason).toBe('topic_starved');
  });

  it('сценарий 2: 3 on-topic блока (high similarity) → обычный ответ, llm.call вызван', async () => {
    const allBlockIds = ['b1', 'b2', 'b3'];
    const { service, llmCall, incCloneAskRefused } = setup({
      allBlockIds,
      topicBlockIds: allBlockIds, // все три на тему
    });

    const result = await service.askPerson({
      tenantId: TENANT_ID,
      requesterUserId: REQUESTER_USER_ID,
      personId: PERSON_ID,
      question: 'Как ты оцениваешь сроки на новые фичи?',
    });

    expect(result.refused).toBeUndefined();
    expect(result.refusalReason).toBeUndefined();
    expect(result.text).toBe('Это ответ от модели (если её вызвали).');
    expect(result.mode).toBe('clone_style');

    // Модель должна быть позвана ровно один раз.
    expect(llmCall).toHaveBeenCalledTimes(1);

    // Метрика отказа НЕ инкрементируется в happy-path.
    expect(incCloneAskRefused).not.toHaveBeenCalled();
  });

  it('сценарий 3: ровно 1 on-topic блок (порог 2 — строгое неравенство) → refused=true', async () => {
    const allBlockIds = ['b1', 'b2', 'b3'];
    const { service, llmCall, incCloneAskRefused } = setup({
      allBlockIds,
      topicBlockIds: ['b1'], // только один из трёх на тему
    });

    const result = await service.askPerson({
      tenantId: TENANT_ID,
      requesterUserId: REQUESTER_USER_ID,
      personId: PERSON_ID,
      question: 'Что ты думаешь об одной конкретной редкой теме?',
    });

    expect(result.refused).toBe(true);
    expect(result.refusalReason).toBe('topic_starved');
    expect(result.text).toBe(ClonesService.TOPIC_STARVED_REFUSAL_TEXT);

    // Модель не позвана.
    expect(llmCall).not.toHaveBeenCalled();

    expect(incCloneAskRefused).toHaveBeenCalledTimes(1);
    expect(incCloneAskRefused).toHaveBeenCalledWith({ reason: 'topic_starved' });
  });
});

// Чтобы Prisma не вылетела на `Prisma.join` при модульной загрузке файла.
void Prisma;
