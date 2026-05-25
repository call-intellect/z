/**
 * Integration-тест AnalyzeWorker + PromptResolverService — Фаза A.1.
 *
 * Источник: plans/tz/2026-05-21-phase-A-prompt-registry-admin.md §13 A.1 DoD.
 *
 * Покрывает два главных пути:
 *
 *   1. Happy path через БД-шаблон: PromptResolver возвращает `db_system`,
 *      analyze.worker берёт systemPrompt + outputSchema из шаблона и сохраняет
 *      `promptTemplateVersionId` в AiResult.
 *
 *   2. Happy path через code-fallback: PromptResolver возвращает
 *      `code_fallback`, analyze.worker использует встроенный
 *      `getPromptForType(...)` 1:1 как до A.1 — НЕ сохраняет
 *      `promptTemplateVersionId` (поле остаётся NULL).
 *
 * Для side-by-side compatibility: путь code_fallback ОБЯЗАН вести себя
 * идентично историческому поведению analyze.worker (это критический риск из
 * ТЗ §15). Мы проверяем это косвенно через факт, что update(aiResult) НЕ
 * содержит promptTemplateVersionId.
 *
 * Реальный Postgres не нужен — все зависимости мокированы (PrismaService,
 * S3Service, LlmFallbackService и т.д.). Это «интеграция» в смысле
 * «AnalyzeWorker + PromptResolverService работают вместе через DI», а не
 * E2E с реальным БД.
 */

import type { AiResult, MeetingType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../src/common/config/index';
import type { BusinessMetricsService } from '../../src/common/metrics/business-metrics.service';
import type { PrismaService } from '../../src/common/prisma/prisma.service';
import type { RedisService } from '../../src/common/redis/redis.service';
import type { MeetingIngestAdapter } from '../../src/modules/ingest/adapters/meeting.adapter';
import type { MeetingsService } from '../../src/modules/meetings/meetings.service';
import type { S3Service } from '../../src/modules/recordings/s3.service';
import type { AiQueueService } from '../../src/modules/ai/ai-queue.service';
import type { AiUsageLogService } from '../../src/modules/ai/services/ai-usage-log.service';
import type { LlmFallbackService } from '../../src/modules/ai/services/llm-fallback.service';
import type { LlmCompleteOutput } from '../../src/modules/ai/services/llm.types';
import { PromptResolverService } from '../../src/modules/ai/services/prompt-resolver.service';
import { AnalyzeWorker } from '../../src/modules/ai/workers/analyze.worker';

interface FakeAiResultStore {
  current: AiResult;
  updates: Array<Record<string, unknown>>;
}

function buildEnv(args: {
  type: MeetingType;
  /** Список db-шаблонов, которые отдаёт mock prisma. Пустой → код фоллбэчит. */
  dbTemplates: Array<{
    orgId: string | null;
    meetingType: string | null;
    taskType: string;
    activeVersion: {
      id: string;
      systemPrompt: string;
      toolName: string | null;
      outputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
      sections?: Array<{
        id: string;
        versionId: string;
        key: string;
        title: string;
        instruction: string;
        outputType: string;
        required: boolean;
        maxTokens: number | null;
        order: number;
      }>;
    };
  }>;
  /** Мок ответа LLM на structured-вызов. */
  structuredLlmOutput: LlmCompleteOutput;
}): {
  worker: AnalyzeWorker;
  store: FakeAiResultStore;
  llmComplete: ReturnType<typeof vi.fn>;
} {
  const meetingId = 'm-int-1';
  const orgId = 'org-int-1';

  const store: FakeAiResultStore = {
    current: {
      id: 'ai-int-1',
      meetingId,
      meetingType: args.type,
      summary: '',
      structuredData: null,
      customOutputMd: null,
      followUpEmail: null,
      tasks: null,
      modelUsed: 'pending',
      summaryV2: null,
      summaryV2Model: null,
      summaryV2GeneratedAt: null,
      summaryFast: null,
      summaryFastModel: null,
      summaryFastGeneratedAt: null,
      promptTemplateVersionId: null,
      experimentGroup: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    updates: [],
  };

  const prisma = {
    meeting: {
      findUnique: vi.fn(async () => ({
        id: meetingId,
        tenantId: orgId,
        type: args.type,
        title: 'Integration Test Meeting',
        customPrompt: null,
        status: 'transcription_ready',
        transcript: { mergedS3Url: 'meetings/m-int-1/transcripts/merged.json' },
        aiResult: null,
      })),
      update: vi.fn(async () => undefined),
    },
    aiResult: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => store.current),
      update: vi.fn(async (input: { where: unknown; data: Record<string, unknown> }) => {
        store.updates.push(input.data);
        store.current = { ...store.current, ...(input.data as Partial<AiResult>) };
        return store.current;
      }),
    },
    promptTemplate: {
      findFirst: vi.fn(async (q: { where: { orgId: string | null; meetingType?: string | null; taskType: string } }) => {
        const found = args.dbTemplates.find(
          (t) =>
            t.orgId === q.where.orgId &&
            t.taskType === q.where.taskType &&
            // PromptResolverService делает 2 запроса:
            //  1) с `meetingType: <тип>` (точное совпадение по типу встречи);
            //  2) с `meetingType: null` (универсальный шаблон).
            // Мы соблюдаем эту семантику: ищем по тому, что прислал Prisma.
            t.meetingType === q.where.meetingType,
        );
        if (!found) return null;
        // Гарантируем наличие `sections` (mapper из БД использует .map по ним).
        return {
          ...found,
          activeVersion: {
            ...found.activeVersion,
            sections: found.activeVersion.sections ?? [],
          },
        };
      }),
    },
  } as unknown as PrismaService;

  const llmComplete = vi.fn();
  // Первый вызов — summary (plain). Второй — structured (по шаблону).
  llmComplete
    .mockResolvedValueOnce({
      text: '2-3 предложения о встрече.',
      inputTokens: 10,
      outputTokens: 5,
      model: 'claude-sonnet',
      provider: 'anthropic',
    } satisfies LlmCompleteOutput)
    .mockResolvedValueOnce(args.structuredLlmOutput);
  const llm = { complete: llmComplete } as unknown as LlmFallbackService;

  const promptResolver = new PromptResolverService(prisma);

  const worker = new AnalyzeWorker(
    { client: {} } as unknown as RedisService,
    prisma,
    llm,
    { record: vi.fn() } as unknown as AiUsageLogService,
    { enqueueNotify: vi.fn(), enqueueChapters: vi.fn(), enqueueTasksExtract: vi.fn(), enqueueTranscriptIndex: vi.fn(), enqueueCardRollup: vi.fn() } as unknown as AiQueueService,
    { transitionStatus: vi.fn() } as unknown as MeetingsService,
    {
      observeAiPipelineDuration: vi.fn(),
      incMeetingFailed: vi.fn(),
    } as unknown as BusinessMetricsService,
    { ai: {} } as unknown as TypedConfigService,
    { ingestMeeting: vi.fn(async () => null) } as unknown as MeetingIngestAdapter,
    promptResolver,
  );

  return { worker, store, llmComplete };
}

describe('Integration: AnalyzeWorker + PromptResolverService', () => {
  it('happy path через БД-шаблон → AiResult.promptTemplateVersionId сохраняется', async () => {
    // В БД лежит system-шаблон для sales с активной версией.
    const { worker, store, llmComplete } = buildEnv({
      type: 'sales',
      dbTemplates: [
        {
          orgId: null, // system
          meetingType: 'sales',
          taskType: 'summary',
          activeVersion: {
            id: 'ver-db-sales',
            systemPrompt: 'Из БД: ты sales-ассистент...',
            toolName: 'extract_sales',
            outputSchema: {
              type: 'object',
              properties: {
                pain: { type: ['string', 'null'] },
                interest_level: { type: ['string', 'null'] },
                objections: { type: 'array', items: { type: 'string' } },
                budget: { type: ['string', 'null'] },
                decision_maker: { type: ['string', 'null'] },
                urgency: { type: ['string', 'null'] },
                next_step: { type: 'string' },
              },
              required: ['next_step'],
            },
          },
        },
      ],
      structuredLlmOutput: {
        text: '',
        inputTokens: 100,
        outputTokens: 50,
        model: 'claude-sonnet',
        provider: 'anthropic',
        toolCalls: [
          {
            name: 'extract_sales',
            input: {
              pain: 'долго закрываются сделки',
              interest_level: 'high',
              objections: [],
              budget: null,
              decision_maker: null,
              urgency: null,
              next_step: 'отправить КП',
            },
          },
        ],
      } satisfies LlmCompleteOutput,
    });

    await (
      worker as unknown as { process: (j: unknown) => Promise<void> }
    ).process({ data: { meetingId: 'm-int-1', attempt: 1 }, id: 'j-int-1' });

    // Поиск update'а с structuredData — он же должен содержать promptTemplateVersionId.
    const structuredUpdate = store.updates.find((u) => 'structuredData' in u);
    expect(structuredUpdate).toBeDefined();
    expect(structuredUpdate?.['promptTemplateVersionId']).toBe('ver-db-sales');

    // Проверим, что LLM-call был сделан с system-промптом ИЗ БД.
    const structuredCall = llmComplete.mock.calls[1]?.[0] as { system: { text: string } } | undefined;
    expect(structuredCall?.system.text).toContain('Из БД: ты sales-ассистент');
  });

  it('happy path через code-fallback → promptTemplateVersionId НЕ записывается', async () => {
    // БД пуста — должен сработать code-fallback.
    const { worker, store, llmComplete } = buildEnv({
      type: 'sales',
      dbTemplates: [],
      structuredLlmOutput: {
        text: '',
        inputTokens: 100,
        outputTokens: 50,
        model: 'claude-sonnet',
        provider: 'anthropic',
        toolCalls: [
          {
            name: 'extract_sales',
            input: {
              pain: null,
              interest_level: null,
              objections: [],
              budget: null,
              decision_maker: null,
              urgency: null,
              next_step: 'уточнить следующий шаг с клиентом',
            },
          },
        ],
      } satisfies LlmCompleteOutput,
    });

    await (
      worker as unknown as { process: (j: unknown) => Promise<void> }
    ).process({ data: { meetingId: 'm-int-1', attempt: 1 }, id: 'j-int-2' });

    const structuredUpdate = store.updates.find((u) => 'structuredData' in u);
    expect(structuredUpdate).toBeDefined();
    // Code-fallback: promptTemplateVersionId НЕ должен быть в update.
    expect(structuredUpdate).not.toHaveProperty('promptTemplateVersionId');

    // Проверим, что LLM-call был сделан с system-промптом из встроенного type-sales.ts —
    // он содержит фразу «продажная встреча» (см. type-sales.ts SYSTEM).
    const structuredCall = llmComplete.mock.calls[1]?.[0] as { system: { text: string } } | undefined;
    expect(structuredCall?.system.text).toContain('продажная встреча');
  });
});
