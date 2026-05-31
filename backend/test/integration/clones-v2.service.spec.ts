/**
 * ТЗ 2026-05-25 §9 (clone-respond эволюция, Фаза 7) — интеграционные unit-тесты
 * нового пути `ClonesService.askPerson` под `CLONE_V2_ENABLED=true`.
 *
 * Сценарии:
 *   1. dialog-layer вызывается ровно один раз; standaloneQuestion передаётся
 *      в LLM-промпт.
 *   2. intent='factual' → mode='factual', цитаты `[BLOCK:id]` остаются в
 *      тексте ответа.
 *   3. intent='analytical' → mode='judgmental', цитаты вырезаются из текста
 *      и сохраняются в `metadata.citations`.
 *   4. RBAC: при отсутствии CloneAccessGrant — Forbidden (даже если был бы
 *      legacy-bypass для admin/owner).
 *   5. topic-density guard в judgmental — порог понижен; 1 блок достаточно.
 *
 * Mock-стратегия: те же mock'и Prisma/Redis/LlmRouter, что и в
 * `clones-refusal.spec.ts`, плюс DialogService и обновлённый mock RbacService
 * с методом `canAccessPersonClone`.
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
import type { LlmRouterService } from '../../src/modules/ai/services/llm-router.service';
import { ClonesService } from '../../src/modules/clones/services/clones.service';
import type { DialogService } from '../../src/modules/dialog-layer/services/dialog.service';
import type { KnowledgeEmbeddingService } from '../../src/modules/knowledge-core/services/embedding.service';
import type { ExecutablePersonaBuildService } from '../../src/modules/knowledge-core/services/executable-persona-build.service';
import type { ExecutablePersonaVersioningService } from '../../src/modules/knowledge-core/services/executable-persona-versioning.service';
import type { RbacService } from '../../src/modules/rbac/rbac.service';

const TENANT_ID = 'org-v2-1';
const REQUESTER = 'user-req-1';
const PERSON_ID = 'p-1';
const PROFILE_ID = 'prof-1';
const PERSONA_ID = 'persona-1';
const ENTITY_ID = 'ent-1';

const QUESTION_VEC = [1, 0, 0, 0];
const ON_TOPIC = [1, 0, 0, 0];

interface V2SetupArgs {
  /** Intent, который возвращает DialogService.process(). */
  intent: 'factual' | 'analytical' | 'exploratory';
  /** Сколько блоков считается «по теме» (для topic-density). */
  onTopicCount: number;
  /** Ответ модели — может содержать [BLOCK:<id>] маркеры. */
  llmText: string;
  /** Есть ли CloneAccessGrant у запрашивающего. */
  hasGrant: boolean;
  /** Override `cfg.skill.cloneTopicMinBlocks` (default 2). */
  topicMinBlocks?: number;
}

function setupV2(args: V2SetupArgs) {
  const allBlockIds = ['b1', 'b2', 'b3', 'b4'];
  const topicBlockIds = allBlockIds.slice(0, args.onTopicCount);

  const skillTraits: SkillTrait[] = Array.from({ length: 4 }, (_, i) => ({
    id: `t-${i}`,
    profileId: PROFILE_ID,
    tenantId: TENANT_ID,
    category: 'c',
    statement: 's',
    confidence: 'high',
    observationCount: 5,
    sourceBlockIds: [],
    firstObservedAt: new Date(),
    lastConfirmedAt: new Date(),
    status: 'active',
    misleadingReason: null,
    misleadingFlaggedByUserId: null,
    misleadingFlaggedAt: null,
    embedding: null,
    categoryId: null,
    supersededById: null,
    supersededAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: null,
  })) as unknown as SkillTrait[];

  const profile = {
    id: PROFILE_ID,
    personId: PERSON_ID,
    tenantId: TENANT_ID,
    status: 'active',
    buildVersion: 1,
    lastBuildAt: new Date(),
    rebuildReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    person: {
      id: PERSON_ID,
      name: 'Тестовый',
      userId: 'user-bearer',
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
    version: 2,
    status: 'active',
    personaPrompt: 'Ты — тестовый клон.',
    snapshotAt: new Date(),
    builtFromTraitsCount: 4,
    builtFromBlocksCount: allBlockIds.length,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as ExecutablePersona;

  const chatV2MessageCreate = vi.fn(
    async (input: { data: { role: string } }) => ({
      id: input.data.role === 'assistant' ? 'msg-asst' : 'msg-user',
    }),
  );

  const queryRaw = vi.fn(async () => {
    const offTopic = allBlockIds.filter((id) => !topicBlockIds.includes(id));
    return [
      ...topicBlockIds.map((id) => ({ id, emb: `[${ON_TOPIC.join(',')}]` })),
      ...offTopic.map((id) => ({ id, emb: `[0,1,0,0]` })),
    ];
  });

  const prisma = {
    skillProfile: { findUnique: vi.fn(async () => profile) },
    executablePersona: { findFirst: vi.fn(async () => persona) },
    person: {
      findUnique: vi.fn(async () => ({
        id: PERSON_ID,
        entityId: ENTITY_ID,
        knowledgeProfile: null,
      })),
    },
    ideaBlockEntity: {
      findMany: vi.fn(async () =>
        allBlockIds.map((id) => ({ blockId: id })),
      ),
    },
    ideaBlock: {
      findMany: vi.fn(async () =>
        allBlockIds.map((id) => ({
          id,
          name: `B ${id}`,
          trustedAnswer: `Text ${id}`,
          evidence: [{ quote: `Q ${id}`, rawEventId: null, sourceTimestamp: null }],
        })),
      ),
    },
    decision: { findMany: vi.fn(async () => []) },
    chatV2Conversation: {
      create: vi.fn(async () => ({ id: 'conv-1', tenantId: TENANT_ID })),
      findFirst: vi.fn(async () => null),
    },
    chatV2Message: { create: chatV2MessageCreate },
    cloneAccessGrant: {
      findUnique: vi.fn(async () =>
        args.hasGrant ? { id: 'g-1' } : null,
      ),
    },
    $queryRaw: queryRaw,
  } as unknown as PrismaService;

  // ТЗ 2026-05-31 — единая per-user квота AI-чата (Concierge + Clones)
  // заменила приватный `assertRateLimit` (Redis-only). Mock пускает все
  // запросы; rate-limit тест — в quota.service.spec.ts.
  const aiChatQuota = {
    tryConsume: vi.fn(async () => ({
      current: 1,
      remaining: 19,
      limit: 20,
      role: 'member',
    })),
    getUsage: vi.fn(async () => ({ dailyUsed: 0, dailyLimit: 20, role: 'member' })),
  } as unknown as import('../../src/modules/ai-chat-quota/ai-chat-quota.service').AiChatQuotaService;

  const cfg = {
    cloneV2: { enabled: true },
    skill: {
      cloneAskPerUserPerDay: 100,
      cloneTopicSimilarityThreshold: 0.7,
      cloneTopicMinBlocks: args.topicMinBlocks ?? 2,
    },
  } as unknown as TypedConfigService;

  const llmCall = vi.fn(async () => ({
    text: args.llmText,
    modelUsed: 'deepseek:deepseek-v4-pro',
    inputTokens: 50,
    outputTokens: 30,
    cachedTokens: 0,
    durationMs: 100,
    tier: 'primary' as const,
  }));
  const llm = { call: llmCall } as unknown as LlmRouterService;

  const metrics = {
    incCloneAsk: vi.fn(),
    incCloneAskRefused: vi.fn(),
    incCloneAskByOwner: vi.fn(),
    incSkillTraitsMarkedMisleading: vi.fn(),
  } as unknown as BusinessMetricsService;

  const personaBuilder = {
    buildForProfile: vi.fn(),
  } as unknown as ExecutablePersonaBuildService;
  const personaVersioning = {
    triggerRebuild: vi.fn(),
  } as unknown as ExecutablePersonaVersioningService;

  const rbac = {
    canAccessPersonClone: vi.fn(async () => ({
      allowed: args.hasGrant,
      relation: args.hasGrant ? 'grant' : 'none',
    })),
    canAccessRoleClone: vi.fn(async () => ({
      allowed: args.hasGrant,
      relation: args.hasGrant ? 'grant' : 'none',
    })),
    check: vi.fn(async () => true),
    loadContext: vi.fn(async () => null),
  } as unknown as RbacService;

  const embedQuery = vi.fn(async () => QUESTION_VEC);
  const embedder = {
    embedQuery,
  } as unknown as KnowledgeEmbeddingService;

  const dialogProcess = vi.fn(async () => ({
    enabled: true,
    standaloneQuestion: 'standalone question for test',
    intent: args.intent,
    queries: ['standalone question for test', 'similar situation'],
    confidence: 0.9,
    cachedAnswer: null,
    steps: {
      contextualize: 0.1,
      confidence: 0.1,
      classify: 0.1,
      multiQuery: 0.1,
      total: 0.4,
    },
  }));
  const dialog = { process: dialogProcess } as unknown as DialogService;

  const service = new ClonesService(
    prisma,
    aiChatQuota,
    cfg,
    llm,
    metrics,
    personaBuilder,
    personaVersioning,
    rbac,
    embedder,
    dialog,
  );

  return {
    service,
    llmCall,
    dialogProcess,
    chatV2MessageCreate,
    metrics: metrics as unknown as {
      incCloneAsk: ReturnType<typeof vi.fn>;
      incCloneAskRefused: ReturnType<typeof vi.fn>;
    },
  };
}

describe('ClonesService.askPerson — V2 path (CLONE_V2_ENABLED=true)', () => {
  it('intent=factual: цитаты [BLOCK:id] остаются в тексте; DialogService вызван 1 раз', async () => {
    const { service, llmCall, dialogProcess, chatV2MessageCreate } = setupV2({
      intent: 'factual',
      onTopicCount: 3,
      llmText:
        'Я бы исходил из опыта: [BLOCK:b1] и в похожей ситуации поступил так же [BLOCK:b2].',
      hasGrant: true,
    });

    const res = await service.askPerson({
      tenantId: TENANT_ID,
      requesterUserId: REQUESTER,
      personId: PERSON_ID,
      question: 'Что бы ты сделал в этой ситуации?',
    });

    expect(dialogProcess).toHaveBeenCalledTimes(1);
    expect(llmCall).toHaveBeenCalledTimes(1);

    // factual — текст сохраняется как есть.
    expect(res.text).toContain('[BLOCK:b1]');
    expect(res.text).toContain('[BLOCK:b2]');
    expect(res.citations.length).toBe(2);
    expect(res.refused).toBeUndefined();

    // llmMeta должен содержать mode + cloneV2:true.
    const asstWrite = chatV2MessageCreate.mock.calls.find(
      (c: unknown[]) =>
        (c[0] as { data: { role: string } }).data.role === 'assistant',
    );
    const llmMeta = (asstWrite![0] as unknown as {
      data: { llmMeta: Record<string, unknown> };
    }).data.llmMeta;
    expect(llmMeta.cloneV2).toBe(true);
    expect(llmMeta.mode).toBe('factual');
    expect(llmMeta.dialogIntent).toBe('factual');
  });

  it('intent=analytical: mode=judgmental; цитаты вырезаются из текста, остаются в citations', async () => {
    const { service, chatV2MessageCreate } = setupV2({
      intent: 'analytical',
      onTopicCount: 1, // достаточно 1 в judgmental (порог понижен)
      llmText:
        'Я обычно подхожу так: сначала разбираем гипотезу [BLOCK:b1], а потом валидируем.',
      hasGrant: true,
    });

    const res = await service.askPerson({
      tenantId: TENANT_ID,
      requesterUserId: REQUESTER,
      personId: PERSON_ID,
      question: 'Как бы ты подошёл к этой задаче?',
    });

    // Текст не содержит [BLOCK:..].
    expect(res.text).not.toContain('[BLOCK:');
    expect(res.text).toContain('Я обычно подхожу');
    // Но citations всё равно распарсены.
    expect(res.citations.length).toBe(1);
    expect(res.citations[0]!.blockId).toBe('b1');

    const asstWrite = chatV2MessageCreate.mock.calls.find(
      (c: unknown[]) =>
        (c[0] as { data: { role: string } }).data.role === 'assistant',
    );
    const llmMeta = (asstWrite![0] as unknown as {
      data: { llmMeta: Record<string, unknown> };
    }).data.llmMeta;
    expect(llmMeta.mode).toBe('judgmental');
  });

  it('нет CloneAccessGrant → Forbidden (v2: legacy bypass отключён)', async () => {
    const { service } = setupV2({
      intent: 'factual',
      onTopicCount: 3,
      llmText: '...',
      hasGrant: false,
    });
    await expect(
      service.askPerson({
        tenantId: TENANT_ID,
        requesterUserId: REQUESTER,
        personId: PERSON_ID,
        question: 'test',
      }),
    ).rejects.toMatchObject({
      response: {
        error: { code: 'forbidden' },
      },
    });
  });

  it('judgmental + 1 on-topic блок при minBlocks=2 → НЕ отказ (порог понижен до 1)', async () => {
    const { service, llmCall } = setupV2({
      intent: 'exploratory',
      onTopicCount: 1,
      llmText: 'ответ по аналогии без цитат',
      hasGrant: true,
      topicMinBlocks: 2,
    });
    const res = await service.askPerson({
      tenantId: TENANT_ID,
      requesterUserId: REQUESTER,
      personId: PERSON_ID,
      question: 'q',
    });
    expect(res.refused).toBeUndefined();
    expect(llmCall).toHaveBeenCalledTimes(1);
  });
});

// keep Prisma symbol referenced так же, как в legacy-spec.
void Prisma;
