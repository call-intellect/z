import type { AiResult, MeetingType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { MeetingsService } from '../../meetings/meetings.service';
import type { S3Service } from '../../recordings/s3.service';
import type { AiQueueService } from '../ai-queue.service';
import type { AiUsageLogService } from '../services/ai-usage-log.service';
import type { LlmFallbackService } from '../services/llm-fallback.service';
import type { LlmCompleteOutput } from '../services/llm.types';

import { AnalyzeWorker } from './analyze.worker';

interface BuildArgs {
  type: MeetingType;
  customPrompt?: string | null;
  llmComplete: ReturnType<typeof vi.fn>;
}

function buildWorker(args: BuildArgs): {
  worker: AnalyzeWorker;
  aiResultUpdate: ReturnType<typeof vi.fn>;
  enqueueNotify: ReturnType<typeof vi.fn>;
  transitionStatus: ReturnType<typeof vi.fn>;
} {
  const meetingId = 'm-1';
  const meetingFindUnique = vi.fn(async () => ({
    id: meetingId,
    type: args.type,
    title: 'Sample',
    customPrompt: args.customPrompt ?? null,
    status: 'transcription_ready',
    transcript: { mergedS3Url: 'meetings/m-1/transcripts/merged.json' },
    aiResult: null,
  }));

  const aiResultFindUnique = vi.fn(async () => null);
  const aiResultCreate = vi.fn(
    async (_args: unknown): Promise<AiResult> => ({
      id: 'ai-1',
      meetingId,
      meetingType: args.type,
      summary: '',
      structuredData: null,
      customOutputMd: null,
      followUpEmail: null,
      tasks: null,
      modelUsed: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  );
  const aiResultUpdate = vi.fn(
    async (input: { data: Record<string, unknown> }): Promise<AiResult> => ({
      id: 'ai-1',
      meetingId,
      meetingType: args.type,
      summary: (input.data['summary'] as string) ?? '',
      structuredData: (input.data['structuredData'] as object | null) ?? null,
      customOutputMd: (input.data['customOutputMd'] as string | null) ?? null,
      followUpEmail: (input.data['followUpEmail'] as string | null) ?? null,
      tasks: (input.data['tasks'] as object | null) ?? null,
      modelUsed: (input.data['modelUsed'] as string) ?? 'm',
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  );

  const prisma = {
    meeting: { findUnique: meetingFindUnique },
    aiResult: {
      findUnique: aiResultFindUnique,
      create: aiResultCreate,
      update: aiResultUpdate,
    },
  } as unknown as PrismaService;

  const transitionStatus = vi.fn(async () => undefined);
  const meetings = { transitionStatus } as unknown as MeetingsService;

  const getJson = vi.fn(async () => ({
    turns: [
      { speaker: 'Alice', text: 'Привет', startSec: 0, endSec: 1 },
      { speaker: 'Bob', text: 'Здравствуй', startSec: 1.5, endSec: 3 },
    ],
  }));
  const s3 = { getJson } as unknown as S3Service;

  const llm = { complete: args.llmComplete } as unknown as LlmFallbackService;
  const usage = { record: vi.fn() } as unknown as AiUsageLogService;
  const enqueueNotify = vi.fn(async () => undefined);
  const queue = { enqueueNotify } as unknown as AiQueueService;
  const metrics = {
    observeAiPipelineDuration: vi.fn(),
    incMeetingFailed: vi.fn(),
  } as unknown as BusinessMetricsService;
  const cfg = { ai: {} } as unknown as TypedConfigService;
  const redis = { client: {} } as unknown as RedisService;

  const worker = new AnalyzeWorker(
    redis,
    prisma,
    s3,
    llm,
    usage,
    queue,
    meetings,
    metrics,
    cfg,
  );

  return { worker, aiResultUpdate, enqueueNotify, transitionStatus };
}

function makeLlmOutput(text: string, toolCalls?: Array<{ name: string; input: unknown }>): LlmCompleteOutput {
  return {
    text,
    inputTokens: 100,
    outputTokens: 50,
    model: 'claude-sonnet-4-6',
    provider: 'anthropic',
    ...(toolCalls ? { toolCalls } : {}),
  };
}

describe('AnalyzeWorker.process', () => {
  it('sales (без customPrompt) → summary + structured + follow-up', async () => {
    const llmComplete = vi.fn();
    // 1) summary
    llmComplete.mockResolvedValueOnce(makeLlmOutput('2-3 предложения о встрече.'));
    // 2) structured (sales) — tool_use с валидным JSON
    llmComplete.mockResolvedValueOnce(
      makeLlmOutput('', [
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
      ]),
    );
    // 3) follow-up
    llmComplete.mockResolvedValueOnce(
      makeLlmOutput('', [
        {
          name: 'extract_follow_up',
          input: { subject: 'Спасибо', body: 'Уважаемый ...' },
        },
      ]),
    );

    const { worker, aiResultUpdate, enqueueNotify, transitionStatus } = buildWorker({
      type: 'sales',
      llmComplete,
    });
    await (
      worker as unknown as { process: (j: unknown) => Promise<void> }
    ).process({ data: { meetingId: 'm-1', attempt: 1 }, id: 'j' });

    // transitions: transcription_ready→ai_processing, ai_processing→ai_ready
    expect(transitionStatus).toHaveBeenCalledWith('m-1', 'ai_processing', expect.any(Object));
    expect(transitionStatus).toHaveBeenCalledWith('m-1', 'ai_ready', expect.any(Object));
    // 3 update'а: summary, structured, follow-up.
    expect(aiResultUpdate).toHaveBeenCalledTimes(3);
    expect(enqueueNotify).toHaveBeenCalledWith('m-1');

    // Проверяем, что structured был сохранён.
    const calls = aiResultUpdate.mock.calls.map((c) => c[0]?.data ?? c[0]);
    const structuredCall = calls.find(
      (d: Record<string, unknown> | undefined) => d?.['structuredData'] !== undefined,
    );
    expect(structuredCall).toBeDefined();
  });

  it('customPrompt → customOutputMd, structuredData=null, для team дополнительно tasks', async () => {
    const llmComplete = vi.fn();
    // 1) summary
    llmComplete.mockResolvedValueOnce(makeLlmOutput('Краткое резюме.'));
    // 2) custom — обычный текст, без tool_use
    llmComplete.mockResolvedValueOnce(
      makeLlmOutput('# Отчёт\n\n- пункт 1\n- пункт 2'),
    );
    // 3) tasks — t.k. type=team нужен tasks-промпт.
    llmComplete.mockResolvedValueOnce(
      makeLlmOutput('', [
        {
          name: 'extract_tasks',
          input: {
            tasks: [
              { title: 'починить баг', assignee: 'Боб', dueDate: null },
            ],
          },
        },
      ]),
    );

    const { worker, aiResultUpdate, transitionStatus } = buildWorker({
      type: 'team',
      customPrompt: 'Сделай краткий отчёт в формате Markdown',
      llmComplete,
    });
    await (
      worker as unknown as { process: (j: unknown) => Promise<void> }
    ).process({ data: { meetingId: 'm-1', attempt: 1 }, id: 'j' });

    expect(llmComplete).toHaveBeenCalledTimes(3);
    expect(transitionStatus).toHaveBeenCalledWith('m-1', 'ai_ready', expect.any(Object));
    // Удостоверимся, что есть update с customOutputMd.
    const calls = aiResultUpdate.mock.calls.map((c) => c[0]?.data ?? c[0]);
    const custom = calls.find(
      (d: Record<string, unknown> | undefined) =>
        typeof d?.['customOutputMd'] === 'string' && (d?.['customOutputMd'] as string).length > 0,
    );
    expect(custom).toBeDefined();
    // tasks update тоже произошёл.
    const tasksUpd = calls.find(
      (d: Record<string, unknown> | undefined) => Array.isArray(d?.['tasks']),
    );
    expect(tasksUpd).toBeDefined();
  });
});
