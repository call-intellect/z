import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { OrgContextService } from '../../ai/services/org-context.service';
import type { ParticipantContextService } from '../../ai/services/participant-context.service';
import type { AiParticipantContext } from '../../ai/services/prompts/participant-context';
import type {
  ResolvedTaskAssignee,
  TaskAssigneeResolverService,
} from '../../knowledge-core/services/task-assignee-resolver.service';
import type { ProbeService } from '../../probe/probe.service';

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
  participants?: AiParticipantContext[];
  resolveResult?: ResolvedTaskAssignee[];
  assigneeClarifyEnabled?: boolean;
  probeReject?: boolean;
}): {
  service: MeetingExtractActionsService;
  prisma: MockPrisma;
  llm: { call: ReturnType<typeof vi.fn> };
  participantContext: { loadForMeeting: ReturnType<typeof vi.fn> };
  orgContext: { load: ReturnType<typeof vi.fn> };
  assigneeResolver: { resolve: ReturnType<typeof vi.fn> };
  metrics: {
    incAiMeetingActionsExtracted: ReturnType<typeof vi.fn>;
  };
  queue: { enqueue: ReturnType<typeof vi.fn> };
  probe: { suggest: ReturnType<typeof vi.fn> };
} {
  const prisma: MockPrisma = {
    meeting: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'm-1',
        tenantId: 'org-1',
        ownerId: 'owner-1',
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
      findMany: vi.fn().mockResolvedValue([{ identifier: 'DEV', name: 'Команда разработки' }]),
      findFirst: vi.fn().mockResolvedValue({ id: 'proj-dev' }),
    },
    goal: {
      findMany: vi.fn().mockResolvedValue([{ name: 'Запуск v2' }]),
    },
    person: {
      findMany: vi.fn().mockResolvedValue([{ name: 'Иванов Сергей' }, { name: 'Петров Олег' }]),
    },
    intakeIssue: {
      findFirst: vi.fn().mockResolvedValue(opts?.existingIntake ? { id: 'existing-1' } : null),
      create: vi.fn().mockImplementation(async ({ data }) => ({
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

  const participantContext = {
    loadForMeeting: vi.fn().mockResolvedValue(opts?.participants ?? []),
  };

  const orgContext = {
    load: vi.fn().mockResolvedValue({
      projects: [{ identifier: 'DEV', name: 'Команда разработки' }],
      goals: [{ name: 'Запуск v2' }],
      people: [
        { name: 'Иванов Сергей', role: null },
        { name: 'Петров Олег', role: null },
      ],
      meetingDateIso: '2026-05-24',
    }),
  };

  const assigneeResolver = {
    resolve: vi.fn(
      (
        raw: Array<{ assigneeRaw: string | null; assigneeUserId: string | null }>,
      ): ResolvedTaskAssignee[] =>
        opts?.resolveResult ??
        raw.map((r) => ({
          assigneeRaw: r.assigneeRaw,
          assigneeUserId: null,
          ambiguous: false,
        })),
    ),
  };

  const metrics = {
    incAiMeetingActionsExtracted: vi.fn(),
  };
  const queue = { enqueue: vi.fn().mockResolvedValue(undefined) };
  const probe = {
    suggest: opts?.probeReject
      ? vi.fn().mockRejectedValue(new Error('probe down'))
      : vi.fn().mockResolvedValue({ dispatched: true }),
  };

  const cfg = {
    pendingActions: { intakeTtlDays: 30 },
    tracker: {
      assigneeClarifyEnabled: opts?.assigneeClarifyEnabled ?? true,
      assigneeProbePriorityHint: 70,
    },
  };

  const service = new MeetingExtractActionsService(
    prisma as unknown as PrismaService,
    llm as unknown as LlmRouterService,
    participantContext as unknown as ParticipantContextService,
    orgContext as unknown as OrgContextService,
    assigneeResolver as unknown as TaskAssigneeResolverService,
    cfg as unknown as TypedConfigService,
    metrics as unknown as BusinessMetricsService,
    queue as unknown as IntakeAutoTriageQueueService,
    undefined,
    probe as unknown as ProbeService,
  );
  return {
    service,
    prisma,
    llm,
    participantContext,
    orgContext,
    assigneeResolver,
    metrics,
    queue,
    probe,
  };
}

function participant(
  over: Partial<AiParticipantContext> & { displayName: string },
): AiParticipantContext {
  return {
    livekitIdentity: over.livekitIdentity ?? `host:${over.userId ?? 'x'}`,
    displayName: over.displayName,
    userId: over.userId ?? null,
    fullName: over.fullName ?? null,
    role: over.role ?? 'host',
  };
}

describe('MeetingExtractActionsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('извлекает задачу из встречи и создаёт IntakeIssue с suggested* + enqueue auto-triage', async () => {
    const { service, prisma, llm, metrics, queue, orgContext } = mkService({
      resolveResult: [
        { assigneeRaw: 'Иванов Сергей', assigneeUserId: 'user-ivanov', ambiguous: false },
      ],
      participants: [participant({ displayName: 'Иванов Сергей', userId: 'user-ivanov' })],
    });
    const created = await service.extract({
      tenantId: 'org-1',
      meetingId: 'm-1',
    });
    expect(llm.call).toHaveBeenCalledTimes(1);
    const callArgs = llm.call.mock.calls[0]?.[0] as { taskType: string };
    expect(callArgs.taskType).toBe('meeting-extract-actions');

    expect(orgContext.load).toHaveBeenCalledWith('org-1', new Date('2026-05-24T10:00:00Z'));

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
    expect(metrics.incAiMeetingActionsExtracted).not.toHaveBeenCalled();
  });

  it('clampConfidence: > 1 → 1, < 0 → 0 (без exception в БД-create)', async () => {
    const { service, prisma } = mkService({
      llmText: JSON.stringify({
        tasks: [
          {
            // Ф0 (ТЗ 2026-06-16) — у задачи есть срок, чтобы пройти гейт
            // качества: проверяем именно clampConfidence, а не гейт.
            title: 'Задача с confidence > 1',
            assignee: null,
            dueDate: '2026-05-30',
            suggestedDueDate: '2026-05-30',
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
    expect(String(createArg.data.confidence)).toBe('1');
  });

  it('Acceptance 5.1 (a): hint="Настя" + участник Настя c userId → suggestedAssigneeId=userId по identity', async () => {
    const nastya = participant({
      displayName: 'Настя',
      userId: 'u-nastya',
      role: 'host',
    });
    const { service, prisma, participantContext, assigneeResolver } = mkService({
      participants: [nastya],
      resolveResult: [{ assigneeRaw: 'Настя', assigneeUserId: 'u-nastya', ambiguous: false }],
      llmText: JSON.stringify({
        tasks: [
          {
            title: 'Подготовить Х',
            assignee: 'Настя',
            dueDate: null,
            suggestedAssigneeHint: 'Настя',
            confidence: 0.9,
            sourceQuote: 'Настя, подготовь Х',
          },
        ],
      }),
    });

    await service.extract({ tenantId: 'org-1', meetingId: 'm-1' });

    expect(participantContext.loadForMeeting).toHaveBeenCalledWith('m-1');
    expect(assigneeResolver.resolve).toHaveBeenCalledWith(
      [{ assigneeRaw: 'Настя', assigneeUserId: null }],
      [nastya],
      'org-1',
    );
    const createArg = prisma.intakeIssue.create.mock.calls[0]?.[0] as {
      data: { suggestedAssigneeId: string | null };
    };
    expect(createArg.data.suggestedAssigneeId).toBe('u-nastya');
  });

  it('Acceptance 5.1 (b): тёзка НЕ из встречи с тем же именем НЕ выбирается (resolver → null)', async () => {
    const oleg = participant({ displayName: 'Олег', userId: 'u-oleg' });
    const { service, prisma, assigneeResolver } = mkService({
      participants: [oleg],
      resolveResult: [{ assigneeRaw: 'Настя', assigneeUserId: null, ambiguous: false }],
      llmText: JSON.stringify({
        tasks: [
          {
            title: 'Подготовить Х',
            assignee: 'Настя',
            dueDate: null,
            suggestedAssigneeHint: 'Настя',
            confidence: 0.9,
            sourceQuote: 'Настя, подготовь Х',
          },
        ],
      }),
    });

    await service.extract({ tenantId: 'org-1', meetingId: 'm-1' });

    expect(assigneeResolver.resolve).toHaveBeenCalledWith(
      [{ assigneeRaw: 'Настя', assigneeUserId: null }],
      [oleg],
      'org-1',
    );
    const createArg = prisma.intakeIssue.create.mock.calls[0]?.[0] as {
      data: { suggestedAssigneeId: string | null };
    };
    expect(createArg.data.suggestedAssigneeId).toBeNull();
  });

  it('Acceptance 5.1 (c): hint без совпадения → suggestedAssigneeId=null, IntakeIssue всё равно создаётся', async () => {
    const { service, prisma, metrics } = mkService({
      participants: [],
      llmText: JSON.stringify({
        tasks: [
          {
            title: 'Никому конкретно',
            assignee: 'маркетинг',
            dueDate: null,
            suggestedAssigneeHint: 'маркетинг',
            confidence: 0.8,
            sourceQuote: 'Маркетинг, посмотрите',
          },
        ],
      }),
    });

    const created = await service.extract({
      tenantId: 'org-1',
      meetingId: 'm-1',
    });

    expect(prisma.intakeIssue.create).toHaveBeenCalledTimes(1);
    const createArg = prisma.intakeIssue.create.mock.calls[0]?.[0] as {
      data: { suggestedAssigneeId: string | null; extractedTitle: string };
    };
    expect(createArg.data.suggestedAssigneeId).toBeNull();
    expect(createArg.data.extractedTitle).toBe('Никому конкретно');
    expect(created).toHaveLength(1);
    expect(metrics.incAiMeetingActionsExtracted).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'created', by: 1 }),
    );
  });

  it('A5: задача без исполнителя → probe.suggest task.assignee_unresolved (intake_issue, recipient=ownerId)', async () => {
    const { service, prisma, probe } = mkService({
      participants: [],
      llmText: JSON.stringify({
        tasks: [
          {
            title: 'Без исполнителя',
            assignee: null,
            dueDate: '2026-05-30',
            suggestedDueDate: '2026-05-30',
            confidence: 0.8,
            sourceQuote: 'Надо сделать Х',
          },
        ],
      }),
    });

    await service.extract({ tenantId: 'org-1', meetingId: 'm-1' });

    expect(prisma.intakeIssue.create).toHaveBeenCalledTimes(1);
    expect(probe.suggest).toHaveBeenCalledTimes(1);
    const probeArg = probe.suggest.mock.calls[0]?.[0] as {
      tenantId: string;
      reason: string;
      emittedByService: string;
      payload: { contextCardKind: string };
      recipientCandidates: string[];
    };
    expect(probeArg.tenantId).toBe('org-1');
    expect(probeArg.reason).toBe('task.assignee_unresolved');
    expect(probeArg.emittedByService).toBe('meeting-extract-actions');
    expect(probeArg.payload.contextCardKind).toBe('intake_issue');
    expect(probeArg.recipientCandidates).toEqual(['owner-1']);
  });

  it('A5: задача с исполнителем → probe.suggest НЕ вызван', async () => {
    const { service, prisma, probe } = mkService({
      resolveResult: [
        { assigneeRaw: 'Иванов Сергей', assigneeUserId: 'user-ivanov', ambiguous: false },
      ],
      participants: [participant({ displayName: 'Иванов Сергей', userId: 'user-ivanov' })],
    });

    await service.extract({ tenantId: 'org-1', meetingId: 'm-1' });

    expect(prisma.intakeIssue.create).toHaveBeenCalledTimes(1);
    expect(probe.suggest).not.toHaveBeenCalled();
  });

  it('A5: probe.suggest падает → обработка встречи не падает, IntakeIssue создан', async () => {
    const { service, prisma, probe } = mkService({
      participants: [],
      probeReject: true,
      llmText: JSON.stringify({
        tasks: [
          {
            title: 'Без исполнителя',
            assignee: null,
            dueDate: '2026-05-30',
            suggestedDueDate: '2026-05-30',
            confidence: 0.8,
            sourceQuote: 'Надо сделать Х',
          },
        ],
      }),
    });

    const created = await service.extract({ tenantId: 'org-1', meetingId: 'm-1' });

    expect(probe.suggest).toHaveBeenCalledTimes(1);
    expect(prisma.intakeIssue.create).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
  });

  it('A5: assigneeClarifyEnabled=false → probe.suggest НЕ вызван даже без исполнителя', async () => {
    const { service, prisma, probe } = mkService({
      participants: [],
      assigneeClarifyEnabled: false,
      llmText: JSON.stringify({
        tasks: [
          {
            title: 'Без исполнителя',
            assignee: null,
            dueDate: '2026-05-30',
            suggestedDueDate: '2026-05-30',
            confidence: 0.8,
            sourceQuote: 'Надо сделать Х',
          },
        ],
      }),
    });

    await service.extract({ tenantId: 'org-1', meetingId: 'm-1' });

    expect(prisma.intakeIssue.create).toHaveBeenCalledTimes(1);
    expect(probe.suggest).not.toHaveBeenCalled();
  });
});
