import { type Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { RedisService } from '../../common/redis/redis.service';
import type { TaskExtractionService } from '../ai/services/task-extraction.service';

import { ChatboxAnalyzeWorker } from './chatbox-analyze.worker';
import type { ChatboxIngestService } from './chatbox-ingest.service';
import type { CrossSourceTaskDedupeService } from './cross-source-task-dedupe.service';
import type { ChatboxAnalyzeJobData } from './queue/chatbox-analyze.queue';

describe('ChatboxAnalyzeWorker', () => {
  let prismaMock: {
    chatboxChatSession: {
      updateMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
  let ingestMock: {
    generateSummary: ReturnType<typeof vi.fn>;
    ingestSession: ReturnType<typeof vi.fn>;
  };
  let worker: ChatboxAnalyzeWorker;

  const job = {
    id: 'chatbox-analyze:s1',
    data: { tenantId: 't1', sessionId: 's1' } satisfies ChatboxAnalyzeJobData,
  } as unknown as Job<ChatboxAnalyzeJobData>;

  beforeEach(() => {
    prismaMock = {
      chatboxChatSession: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({}),
      },
    };
    ingestMock = {
      generateSummary: vi.fn(),
      ingestSession: vi.fn(),
    };

    worker = new ChatboxAnalyzeWorker(
      {} as unknown as RedisService,
      prismaMock as unknown as PrismaService,
      ingestMock as unknown as ChatboxIngestService,
    );
  });

  it('успешный путь: summary persist + done + rawEventId + analyzedAt', async () => {
    ingestMock.generateSummary.mockResolvedValue('s');
    ingestMock.ingestSession.mockResolvedValue({ rawEventId: 'r' });

    await worker.process(job);

    expect(prismaMock.chatboxChatSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1', tenantId: 't1' },
        data: { analysisStatus: 'analyzing' },
      }),
    );
    expect(prismaMock.chatboxChatSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1', tenantId: 't1' },
        data: { summary: 's' },
      }),
    );
    expect(prismaMock.chatboxChatSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1', tenantId: 't1' },
        data: expect.objectContaining({
          analysisStatus: 'done',
          rawEventId: 'r',
          analyzedAt: expect.any(Date),
        }),
      }),
    );
  });

  it('summary=null → summary НЕ пишется, но done выставляется', async () => {
    ingestMock.generateSummary.mockResolvedValue(null);
    ingestMock.ingestSession.mockResolvedValue({ rawEventId: 'r' });

    await worker.process(job);

    expect(prismaMock.chatboxChatSession.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { summary: expect.anything() } }),
    );
    expect(prismaMock.chatboxChatSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ analysisStatus: 'done' }),
      }),
    );
  });

  it('ingestSession=null (открытая) → НЕ помечает done, не падает', async () => {
    ingestMock.generateSummary.mockResolvedValue(null);
    ingestMock.ingestSession.mockResolvedValue(null);

    await expect(worker.process(job)).resolves.toBeUndefined();

    expect(prismaMock.chatboxChatSession.update).not.toHaveBeenCalled();
  });

  it('ingestSession бросает → analysisStatus=failed + rethrow', async () => {
    ingestMock.generateSummary.mockResolvedValue(null);
    ingestMock.ingestSession.mockRejectedValue(new Error('boom'));

    await expect(worker.process(job)).rejects.toThrow('boom');

    expect(prismaMock.chatboxChatSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 's1', tenantId: 't1' },
        data: { analysisStatus: 'failed' },
      }),
    );
  });
});

describe('ChatboxAnalyzeWorker.extractTasks', () => {
  function makeCfg(enabled: boolean): TypedConfigService {
    return {
      get aiFeatures() {
        return { chatboxTaskExtractionEnabled: enabled };
      },
    } as unknown as TypedConfigService;
  }

  interface PrismaOverrides {
    existingTask?: { id: string } | null;
    existingSource?: { id: string } | null;
    session?: { id: string; chatId: string } | null;
    chat?: {
      id: string;
      externalId: string;
      customerExternalId: string | null;
      responsibleExternalId: string | null;
    } | null;
    messages?: Array<{
      senderType: string;
      senderName: string | null;
      text: string | null;
      contentType: string;
    }>;
    member?: { name: string | null; linkedPersonId: string | null } | null;
    person?: { userId: string | null; name: string | null } | null;
    customer?: { name: string | null } | null;
    membership?: { userId: string } | null;
  }

  function makePrisma(o: PrismaOverrides) {
    return {
      task: {
        findFirst: vi.fn(async () => o.existingTask ?? null),
      },
      taskSource: {
        findFirst: vi.fn(async () => o.existingSource ?? null),
      },
      chatboxChatSession: {
        findFirst: vi.fn(async () =>
          o.session === undefined ? { id: 's1', chatId: 'chat-1' } : o.session,
        ),
      },
      chatboxChat: {
        findFirst: vi.fn(async () =>
          o.chat === undefined
            ? {
                id: 'chat-1',
                externalId: 'ext-chat',
                customerExternalId: 'cust-1',
                responsibleExternalId: 'mgr-1',
              }
            : o.chat,
        ),
      },
      chatboxMessage: {
        findMany: vi.fn(
          async () =>
            o.messages ?? [
              {
                senderType: 'CLIENT',
                senderName: 'Клиент',
                text: 'Хочу скидку',
                contentType: 'TEXT',
              },
              {
                senderType: 'USER',
                senderName: 'Менеджер',
                text: 'Сделаю расчёт',
                contentType: 'TEXT',
              },
            ],
        ),
      },
      chatboxMember: {
        findUnique: vi.fn(async () =>
          o.member === undefined ? { name: 'Иван Менеджер', linkedPersonId: 'person-1' } : o.member,
        ),
      },
      person: {
        findFirst: vi.fn(async () =>
          o.person === undefined ? { userId: 'user-mgr', name: 'Иван Менеджер' } : o.person,
        ),
      },
      chatboxCustomer: {
        findUnique: vi.fn(async () =>
          o.customer === undefined ? { name: 'ООО Ромашка' } : o.customer,
        ),
      },
      membership: {
        findFirst: vi.fn(async () =>
          o.membership === undefined ? { userId: 'owner-user' } : o.membership,
        ),
      },
    };
  }

  function makeWorker(
    prisma: ReturnType<typeof makePrisma>,
    opts: {
      enabled: boolean;
      extracted?: unknown[];
      dedupe?: { created: number; linked: number };
      withDeps?: boolean;
    },
  ) {
    const extractor = {
      extractTasks: vi.fn(async () => opts.extracted ?? []),
    } as unknown as TaskExtractionService;
    const dedupeProcess = vi.fn(async () => opts.dedupe ?? { created: 0, linked: 0 });
    const dedupe = {
      processCandidates: dedupeProcess,
    } as unknown as CrossSourceTaskDedupeService;
    const ingest = {
      generateSummary: vi.fn(async () => null),
      ingestSession: vi.fn(async () => ({ rawEventId: 'r1' })),
    } as unknown as ChatboxIngestService;

    const useDeps = opts.withDeps ?? true;
    const worker = new ChatboxAnalyzeWorker(
      {} as unknown as RedisService,
      prisma as unknown as PrismaService,
      ingest,
      useDeps ? extractor : undefined,
      useDeps ? dedupe : undefined,
      makeCfg(opts.enabled),
    );
    return { worker, extractor, dedupe, dedupeProcess };
  }

  it('закрытая сессия с поручением → ≥1 задача через дедуп, менеджер=ответственный', async () => {
    const prisma = makePrisma({});
    const { worker, extractor, dedupeProcess } = makeWorker(prisma, {
      enabled: true,
      extracted: [{ title: 'Сделать расчёт', sourceQuote: 'Сделаю расчёт', confidence: 0.9 }],
      dedupe: { created: 1, linked: 0 },
    });

    await worker.extractTasks('t1', 's1');

    expect(extractor.extractTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        meetingId: 'chat-1',
        tenantId: 't1',
        meeting: expect.objectContaining({ id: 'chat-1', type: 'chatbox' }),
      }),
    );
    expect(dedupeProcess).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          title: 'Сделать расчёт',
          assigneeUserId: 'user-mgr',
          assigneeRaw: 'Иван Менеджер',
        }),
      ],
      expect.objectContaining({
        tenantId: 't1',
        sessionId: 's1',
        chatId: 'chat-1',
        ownerUserId: 'user-mgr',
      }),
    );
  });

  it('флаг OFF → задачи не извлекаются (extractTasks разборщика не звался)', async () => {
    const prisma = makePrisma({});
    const { worker, extractor, dedupeProcess } = makeWorker(prisma, { enabled: false });

    await worker.extractTasks('t1', 's1');

    expect(extractor.extractTasks).not.toHaveBeenCalled();
    expect(dedupeProcess).not.toHaveBeenCalled();
    expect(prisma.task.findFirst).not.toHaveBeenCalled();
  });

  it('повторный анализ (есть Task.sourceChatSessionId) → no-op (идемпотентность)', async () => {
    const prisma = makePrisma({ existingTask: { id: 'existing' } });
    const { worker, extractor } = makeWorker(prisma, { enabled: true });

    await worker.extractTasks('t1', 's1');

    expect(extractor.extractTasks).not.toHaveBeenCalled();
  });

  it('повторный анализ (есть TaskSource) → no-op (идемпотентность)', async () => {
    const prisma = makePrisma({ existingSource: { id: 'ts-existing' } });
    const { worker, extractor } = makeWorker(prisma, { enabled: true });

    await worker.extractTasks('t1', 's1');

    expect(extractor.extractTasks).not.toHaveBeenCalled();
  });

  it('реплики клиента не назначаются: менеджер без Person.userId → assigneeUserId=null', async () => {
    const prisma = makePrisma({ member: { name: 'Аноним-менеджер', linkedPersonId: null } });
    const { worker, dedupeProcess } = makeWorker(prisma, {
      enabled: true,
      extracted: [{ title: 'Перезвонить', sourceQuote: 'позвоню', confidence: 0.8 }],
      dedupe: { created: 1, linked: 0 },
    });

    await worker.extractTasks('t1', 's1');

    expect(dedupeProcess).toHaveBeenCalledWith(
      [expect.objectContaining({ assigneeUserId: null, assigneeRaw: 'Аноним-менеджер' })],
      expect.objectContaining({ ownerUserId: 'owner-user' }),
    );
  });

  it('разборщик не нашёл задач → дедуп не звался', async () => {
    const prisma = makePrisma({});
    const { worker, dedupeProcess } = makeWorker(prisma, { enabled: true, extracted: [] });

    await worker.extractTasks('t1', 's1');

    expect(dedupeProcess).not.toHaveBeenCalled();
  });
});

describe('ChatboxAnalyzeWorker.resolveOwnerUserId fallback owner→admin→any', () => {
  function makeRoleAwarePrisma(byRole: Record<string, string | null>, anyMember: string | null) {
    return {
      task: { findFirst: vi.fn(async () => null) },
      taskSource: { findFirst: vi.fn(async () => null) },
      chatboxChatSession: {
        findFirst: vi.fn(async () => ({ id: 's1', chatId: 'chat-1' })),
      },
      chatboxChat: {
        findFirst: vi.fn(async () => ({
          id: 'chat-1',
          externalId: 'ext-chat',
          customerExternalId: null,
          responsibleExternalId: null,
        })),
      },
      chatboxMessage: {
        findMany: vi.fn(async () => [
          { senderType: 'CLIENT', senderName: 'Клиент', text: 'Хочу скидку', contentType: 'TEXT' },
        ]),
      },
      chatboxMember: { findUnique: vi.fn(async () => null) },
      person: { findFirst: vi.fn(async () => null) },
      chatboxCustomer: { findUnique: vi.fn(async () => null) },
      membership: {
        findFirst: vi.fn(async (args: { where?: { role?: string } }) => {
          const role = args.where?.role;
          if (role === undefined) {
            return anyMember === null ? null : { userId: anyMember };
          }
          const userId = byRole[role] ?? null;
          return userId === null ? null : { userId };
        }),
      },
    };
  }

  function makeWorkerWithMetrics(
    prisma: ReturnType<typeof makeRoleAwarePrisma>,
    extracted: unknown[],
  ) {
    const extractor = {
      extractTasks: vi.fn(async () => extracted),
    } as unknown as TaskExtractionService;
    const dedupeProcess = vi.fn(async () => ({ created: extracted.length, linked: 0 }));
    const dedupe = {
      processCandidates: dedupeProcess,
    } as unknown as CrossSourceTaskDedupeService;
    const ingest = {
      generateSummary: vi.fn(async () => null),
      ingestSession: vi.fn(async () => ({ rawEventId: 'r1' })),
    } as unknown as ChatboxIngestService;
    const incChatboxTasksOwnerMissing = vi.fn();
    const metrics = {
      incChatboxTasksOwnerMissing,
    } as unknown as BusinessMetricsService;
    const cfg = {
      get aiFeatures() {
        return { chatboxTaskExtractionEnabled: true };
      },
    } as unknown as TypedConfigService;

    const worker = new ChatboxAnalyzeWorker(
      {} as unknown as RedisService,
      prisma as unknown as PrismaService,
      ingest,
      extractor,
      dedupe,
      cfg,
      metrics,
    );
    return { worker, dedupeProcess, incChatboxTasksOwnerMissing };
  }

  it('нет owner, есть admin → owner=admin.userId, задачи создаются', async () => {
    const prisma = makeRoleAwarePrisma({ owner: null, admin: 'admin-user' }, 'admin-user');
    const { worker, dedupeProcess, incChatboxTasksOwnerMissing } = makeWorkerWithMetrics(prisma, [
      { title: 'Перезвонить', sourceQuote: 'позвоню', confidence: 0.8 },
    ]);

    await worker.extractTasks('t1', 's1');

    expect(dedupeProcess).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ ownerUserId: 'admin-user' }),
    );
    expect(incChatboxTasksOwnerMissing).not.toHaveBeenCalled();
  });

  it('нет owner/admin, есть обычный member → owner=member.userId, задачи создаются', async () => {
    const prisma = makeRoleAwarePrisma({ owner: null, admin: null }, 'member-user');
    const { worker, dedupeProcess, incChatboxTasksOwnerMissing } = makeWorkerWithMetrics(prisma, [
      { title: 'Перезвонить', sourceQuote: 'позвоню', confidence: 0.8 },
    ]);

    await worker.extractTasks('t1', 's1');

    expect(dedupeProcess).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ ownerUserId: 'member-user' }),
    );
    expect(incChatboxTasksOwnerMissing).not.toHaveBeenCalled();
  });

  it('Org без участников → метрика incChatboxTasksOwnerMissing, задачи НЕ создаются (видимый сигнал)', async () => {
    const prisma = makeRoleAwarePrisma({ owner: null, admin: null }, null);
    const { worker, dedupeProcess, incChatboxTasksOwnerMissing } = makeWorkerWithMetrics(prisma, [
      { title: 'Перезвонить', sourceQuote: 'позвоню', confidence: 0.8 },
    ]);

    await worker.extractTasks('t1', 's1');

    expect(incChatboxTasksOwnerMissing).toHaveBeenCalledTimes(1);
    expect(dedupeProcess).not.toHaveBeenCalled();
  });
});
