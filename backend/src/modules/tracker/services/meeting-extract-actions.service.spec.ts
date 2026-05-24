import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';

import type { IntakeAutoTriageQueueService } from './intake-auto-triage-queue.service';
import { MeetingExtractActionsService } from './meeting-extract-actions.service';

interface MockPrisma {
  meeting: { findFirst: ReturnType<typeof vi.fn> };
  project: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  goal: { findMany: ReturnType<typeof vi.fn> };
  person: { findMany: ReturnType<typeof vi.fn> };
  intakeIssue: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
}

function mkService(opts?: {
  llmText?: string;
  llmReject?: boolean;
  existingIntake?: boolean;
}): {
  service: MeetingExtractActionsService;
  prisma: MockPrisma;
  llm: { call: ReturnType<typeof vi.fn> };
  metrics: {
    incAiMeetingActionsExtracted: ReturnType<typeof vi.fn>;
  };
  queue: { enqueue: ReturnType<typeof vi.fn> };
} {
  const prisma: MockPrisma = {
    meeting: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'm-1',
        tenantId: 'org-1',
        title: 'DEV — Спринт 21',
        type: 'standup',
        startedAt: new Date('2026-05-24T10:00:00Z'),
        endedAt: new Date('2026-05-24T10:30:00Z'),
        cardId: null,
        transcript: {
          turns: [
            {
              speaker: 'Сергей',
              text: 'Иванов, сделай отчёт к пятнице.',
              startSec: 0,
              endSec: 5,
            },
          ],
          roomChat: null,
        },
        aiResult: null,
      }),
    },
    project: {
      findMany: vi.fn().mockResolvedValue([
        { identifier: 'DEV', name: 'Команда разработки' },
      ]),
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: 'proj-dev' }),
    },
    goal: {
      findMany: vi.fn().mockResolvedValue([{ name: 'Запуск v2' }]),
    },
    person: {
      findMany: vi
        .fn()
        .mockImplementation(({ where }: { where: { name?: unknown } }) => {
          // resolveAssigneeId — фильтр по name.contains
          if (where.name) {
            return Promise.resolve([
              {
                id: 'p-iv',
                userId: 'user-ivanov',
                name: 'Иванов Сергей',
              },
            ]);
          }
          // loadOrgContext — общий список
          return Promise.resolve([
            { name: 'Иванов Сергей' },
            { name: 'Петров Олег' },
          ]);
        }),
    },
    intakeIssue: {
      findFirst: vi
        .fn()
        .mockResolvedValue(opts?.existingIntake ? { id: 'existing-1' } : null),
      create: vi
        .fn()
        .mockImplementation(async ({ data }) => ({
          id: `intake-${Math.random().toString(36).slice(2, 8)}`,
          ...data,
        })),
    },
  };

  const llmText =
    opts?.llmText ??
    JSON.stringify({
      tasks: [
        {
          title: 'Сделать отчёт',
          assignee: 'Иванов',
          dueDate: '2026-05-30',
          suggestedAssigneeHint: 'Иванов Сергей',
          suggestedDueDate: '2026-05-30',
          suggestedPriority: 'high',
          confidence: 0.95,
          sourceQuote: 'Иванов, сделай отчёт к пятнице.',
        },
      ],
    });

  const llm = {
    call: opts?.llmReject
      ? vi.fn().mockRejectedValue(new Error('LLM timeout'))
      : vi.fn().mockResolvedValue({
          text: llmText,
          modelUsed: 'deepseek:deepseek-chat',
          inputTokens: 100,
          outputTokens: 30,
          cachedTokens: 0,
          durationMs: 200,
        }),
  };

  const metrics = {
    incAiMeetingActionsExtracted: vi.fn(),
  };
  const queue = { enqueue: vi.fn().mockResolvedValue(undefined) };

  const service = new MeetingExtractActionsService(
    prisma as unknown as PrismaService,
    llm as unknown as LlmRouterService,
    metrics as unknown as BusinessMetricsService,
    queue as unknown as IntakeAutoTriageQueueService,
  );
  return { service, prisma, llm, metrics, queue };
}

describe('MeetingExtractActionsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('извлекает задачу из встречи и создаёт IntakeIssue с suggested* + enqueue auto-triage', async () => {
    const { service, prisma, llm, metrics, queue } = mkService();
    const created = await service.extract({
      tenantId: 'org-1',
      meetingId: 'm-1',
    });
    expect(llm.call).toHaveBeenCalledTimes(1);
    const callArgs = llm.call.mock.calls[0]?.[0] as { taskType: string };
    expect(callArgs.taskType).toBe('meeting-extract-actions');

    expect(prisma.intakeIssue.create).toHaveBeenCalledTimes(1);
    const createArg = prisma.intakeIssue.create.mock.calls[0]?.[0] as {
      data: {
        source: string;
        externalSource: string;
        externalId: string;
        suggestedAssigneeId: string | null;
        suggestedProjectId: string | null;
        suggestedPriority: string | null;
        extractedTitle: string;
      };
    };
    expect(createArg.data.source).toBe('meeting');
    expect(createArg.data.externalSource).toBe('meeting');
    expect(createArg.data.externalId).toMatch(/^mea_/);
    expect(createArg.data.suggestedAssigneeId).toBe('user-ivanov');
    expect(createArg.data.suggestedProjectId).toBe('proj-dev');
    expect(createArg.data.suggestedPriority).toBe('high');
    expect(createArg.data.extractedTitle).toBe('Сделать отчёт');

    expect(created).toHaveLength(1);
    expect(created[0]?.confidence).toBeCloseTo(0.95);

    expect(queue.enqueue).toHaveBeenCalledTimes(1);
    expect(metrics.incAiMeetingActionsExtracted).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'created', by: 1 }),
    );
  });

  it('idempotency — при существующем IntakeIssue с тем же externalId пропускает create', async () => {
    const { service, prisma, metrics } = mkService({ existingIntake: true });
    const created = await service.extract({
      tenantId: 'org-1',
      meetingId: 'm-1',
    });
    expect(prisma.intakeIssue.create).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
    expect(metrics.incAiMeetingActionsExtracted).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'skipped_idempotent' }),
    );
  });

  it('LLM упал → возвращает пустой массив, метрика llm_error', async () => {
    const { service, prisma, metrics } = mkService({ llmReject: true });
    const created = await service.extract({
      tenantId: 'org-1',
      meetingId: 'm-1',
    });
    expect(created).toEqual([]);
    expect(prisma.intakeIssue.create).not.toHaveBeenCalled();
    expect(metrics.incAiMeetingActionsExtracted).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'llm_error' }),
    );
  });

  it('LLM вернул пустой массив tasks → метрика llm_empty, ничего не создано', async () => {
    const { service, prisma, metrics } = mkService({
      llmText: JSON.stringify({ tasks: [] }),
    });
    const created = await service.extract({
      tenantId: 'org-1',
      meetingId: 'm-1',
    });
    expect(created).toEqual([]);
    expect(prisma.intakeIssue.create).not.toHaveBeenCalled();
    expect(metrics.incAiMeetingActionsExtracted).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'llm_empty' }),
    );
  });

  it('встреча не найдена в tenant — пропуск без вызова LLM', async () => {
    const { service, prisma, llm, metrics } = mkService();
    prisma.meeting.findFirst.mockResolvedValueOnce(null);
    const created = await service.extract({
      tenantId: 'org-1',
      meetingId: 'absent',
    });
    expect(created).toEqual([]);
    expect(llm.call).not.toHaveBeenCalled();
    // Метрика не должна быть инкрементирована — это просто отсутствие встречи
    expect(metrics.incAiMeetingActionsExtracted).not.toHaveBeenCalled();
  });

  it('clampConfidence: > 1 → 1, < 0 → 0 (без exception в БД-create)', async () => {
    const { service, prisma } = mkService({
      llmText: JSON.stringify({
        tasks: [
          {
            title: 'Задача с confidence > 1',
            assignee: null,
            dueDate: null,
            confidence: 1.5,
            sourceQuote: 'некая цитата',
          },
        ],
      }),
    });
    await service.extract({ tenantId: 'org-1', meetingId: 'm-1' });
    const createArg = prisma.intakeIssue.create.mock.calls[0]?.[0] as {
      data: { confidence: unknown };
    };
    // confidence хранится как Prisma.Decimal — у него есть .toString()
    expect(String(createArg.data.confidence)).toBe('1');
  });
});
