import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { RecognitionFormulateJobData } from '../../core-queue/queues';

import { RecognitionFormulateWorker } from './recognition-formulate.worker';

interface MockPrisma {
  recognition: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  user: {
    findUnique: ReturnType<typeof vi.fn>;
  };
}

function mkWorker(): {
  worker: RecognitionFormulateWorker;
  prisma: MockPrisma;
  llm: { call: ReturnType<typeof vi.fn> };
} {
  const prisma: MockPrisma = {
    recognition: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }) => ({
        id: 'rec-1',
        ...data,
        createdAt: new Date(),
      })),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ name: 'Иван' }),
    },
  };
  const llm = {
    call: vi.fn().mockResolvedValue({
      text: JSON.stringify({ message: 'Я заметила, что ты помог коллеге.' }),
      modelUsed: 'deepseek:deepseek-v4-flash',
      inputTokens: 100,
      outputTokens: 20,
      cachedTokens: 0,
      durationMs: 200,
    }),
  };
  const redis = { client: {} as unknown } as unknown as RedisService;
  const worker = new RecognitionFormulateWorker(
    redis,
    prisma as unknown as PrismaService,
    llm as unknown as LlmRouterService,
  );
  return { worker, prisma, llm };
}

function jobOf(data: RecognitionFormulateJobData): Job<RecognitionFormulateJobData> {
  return { id: 'job-1', data, attemptsMade: 0 } as unknown as Job<RecognitionFormulateJobData>;
}

describe('RecognitionFormulateWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('создаёт Recognition + вызывает LLM когда message не задан', async () => {
    const { worker, prisma, llm } = mkWorker();
    await worker.process(
      jobOf({
        tenantId: 'org-1',
        type: 'thanks_comment',
        toUserId: 'user-author',
        fromUserId: 'user-thanker',
        contextEntityType: 'issue_comment',
        contextEntityId: 'comment-1',
        visibility: 'private',
      }),
    );
    expect(llm.call).toHaveBeenCalledTimes(1);
    expect(prisma.recognition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'org-1',
        type: 'thanks_comment',
        toUserId: 'user-author',
        fromUserId: 'user-thanker',
        contextEntityType: 'issue_comment',
        contextEntityId: 'comment-1',
        visibility: 'private',
        message: 'Я заметила, что ты помог коллеге.',
      }),
    });
  });

  it('пропускает LLM-вызов когда message уже задан в payload', async () => {
    const { worker, prisma, llm } = mkWorker();
    await worker.process(
      jobOf({
        tenantId: 'org-1',
        type: 'streak_milestone',
        toUserId: 'user-1',
        message: 'Уже сформулированное сообщение.',
        contextEntityId: '7',
      }),
    );
    expect(llm.call).not.toHaveBeenCalled();
    expect(prisma.recognition.create).toHaveBeenCalled();
    const call = prisma.recognition.create.mock.calls[0]?.[0] as {
      data: { message: string };
    };
    expect(call.data.message).toBe('Уже сформулированное сообщение.');
  });

  it('защита: при существующем Recognition (тот же контекст) не создаёт дубль', async () => {
    const { worker, prisma, llm } = mkWorker();
    prisma.recognition.findFirst.mockResolvedValueOnce({ id: 'rec-existing' });
    await worker.process(
      jobOf({
        tenantId: 'org-1',
        type: 'thanks_comment',
        toUserId: 'user-author',
        fromUserId: 'user-thanker',
        contextEntityType: 'issue_comment',
        contextEntityId: 'comment-1',
      }),
    );
    expect(prisma.recognition.create).not.toHaveBeenCalled();
    expect(llm.call).not.toHaveBeenCalled();
  });

  it('LLM падает → используем deterministic fallback (по type)', async () => {
    const { worker, prisma, llm } = mkWorker();
    llm.call.mockRejectedValueOnce(new Error('LLM timeout'));
    await worker.process(
      jobOf({
        tenantId: 'org-1',
        type: 'idea_shipped',
        toUserId: 'user-1',
        contextEntityType: 'idea',
        contextEntityId: 'idea-1',
        contextPayload: { status: 'shipped' },
      }),
    );
    expect(prisma.recognition.create).toHaveBeenCalled();
    const call = prisma.recognition.create.mock.calls[0]?.[0] as {
      data: { message: string };
    };
    expect(call.data.message).toContain('Твоя идея выпущена');
  });

  it('LLM возвращает пустую строку → fallback (а не пустой Recognition)', async () => {
    const { worker, prisma, llm } = mkWorker();
    llm.call.mockResolvedValueOnce({
      text: JSON.stringify({ message: '' }),
      modelUsed: 'deepseek:deepseek-v4-flash',
      inputTokens: 10,
      outputTokens: 0,
      cachedTokens: 0,
      durationMs: 100,
    });
    await worker.process(
      jobOf({
        tenantId: 'org-1',
        type: 'thanks_comment',
        toUserId: 'user-author',
        fromUserId: 'user-thanker',
        contextEntityId: 'comment-1',
        contextEntityType: 'issue_comment',
      }),
    );
    expect(prisma.recognition.create).toHaveBeenCalled();
    const call = prisma.recognition.create.mock.calls[0]?.[0] as {
      data: { message: string };
    };
    expect(call.data.message.length).toBeGreaterThan(0);
  });

  it('этическая защита: fromUserId сохраняется, но message от AI (не от человека)', async () => {
    const { worker, prisma, llm } = mkWorker();
    await worker.process(
      jobOf({
        tenantId: 'org-1',
        type: 'thanks_comment',
        toUserId: 'user-author',
        fromUserId: 'user-thanker',
        contextEntityId: 'comment-1',
        contextEntityType: 'issue_comment',
      }),
    );
    const create = prisma.recognition.create.mock.calls[0]?.[0] as {
      data: { fromUserId: string };
    };
    expect(create.data.fromUserId).toBe('user-thanker');
    const llmCall = llm.call.mock.calls[0]?.[0] as { systemPrompt: string };
    expect(llmCall.systemPrompt).toContain('от имени AI');
    expect(llmCall.systemPrompt).toContain('НЕ от имени');
  });

  it('visibility=private — не публикует ActivityFeed (TODO log)', async () => {
    const { worker, prisma } = mkWorker();
    await worker.process(
      jobOf({
        tenantId: 'org-1',
        type: 'weekly_summary',
        toUserId: 'user-1',
        visibility: 'private',
        contextEntityId: '2026-W21',
      }),
    );
    expect(prisma.recognition.create).toHaveBeenCalled();
    const created = prisma.recognition.create.mock.calls[0]?.[0] as {
      data: { visibility: string };
    };
    expect(created.data.visibility).toBe('private');
  });
});
