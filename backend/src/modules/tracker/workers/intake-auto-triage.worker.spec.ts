import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { IntakeAutoTriageJobData } from '../queues';
import type { IssuesService } from '../services/issues.service';

import { IntakeAutoTriageWorker } from './intake-auto-triage.worker';

interface MockPrisma {
  intakeIssue: {
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  project: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  person: { findMany: ReturnType<typeof vi.fn> };
  goal: { findMany: ReturnType<typeof vi.fn> };
  issue: { findMany: ReturnType<typeof vi.fn> };
}

interface MkOpts {
  intake?: Partial<{
    id: string;
    tenantId: string;
    source: string;
    triagedAt: Date | null;
    createdIssueId: string | null;
    rawContent: string;
    extractedTitle: string | null;
    extractedDescription: string | null;
    externalSource: string | null;
    externalId: string | null;
    suggestedAssigneeId: string | null;
    suggestedProjectId: string | null;
    suggestedGoalId: string | null;
  }>;
  llmText?: string;
  llmReject?: boolean;
  noProject?: boolean;
}

function mkWorker(opts?: MkOpts): {
  worker: IntakeAutoTriageWorker;
  prisma: MockPrisma;
  llm: { call: ReturnType<typeof vi.fn> };
  issues: { create: ReturnType<typeof vi.fn> };
  metrics: {
    incAiIntakeAutoAccepted: ReturnType<typeof vi.fn>;
    incAiIntakeSuggested: ReturnType<typeof vi.fn>;
  };
} {
  const intake = {
    id: 'intake-1',
    tenantId: 'org-1',
    source: 'meeting',
    triagedAt: null,
    createdIssueId: null,
    rawContent: 'Иванов, сделай отчёт к пятнице.',
    extractedTitle: 'Сделать отчёт',
    extractedDescription: 'Иванов, сделай отчёт к пятнице.',
    externalSource: 'meeting',
    externalId: 'mea_xxx',
    suggestedAssigneeId: null,
    suggestedProjectId: null,
    suggestedGoalId: null,
    ...(opts?.intake ?? {}),
  };

  const prisma: MockPrisma = {
    intakeIssue: {
      findFirst: vi.fn().mockResolvedValue(intake),
      update: vi
        .fn()
        .mockImplementation(async ({ data }) => ({ ...intake, ...data })),
    },
    project: {
      findMany: vi
        .fn()
        .mockResolvedValue(
          opts?.noProject
            ? []
            : [{ id: 'proj-dev', identifier: 'DEV', name: 'Команда разработки' }],
        ),
      findUnique: vi
        .fn()
        .mockResolvedValue(
          opts?.noProject ? null : { ownerId: 'user-owner' },
        ),
    },
    person: {
      findMany: vi
        .fn()
        .mockResolvedValue([
          { name: 'Иванов Сергей', userId: 'user-ivanov' },
        ]),
    },
    goal: { findMany: vi.fn().mockResolvedValue([]) },
    issue: { findMany: vi.fn().mockResolvedValue([]) },
  };

  const llmText =
    opts?.llmText ??
    JSON.stringify({
      suggestedProjectIdentifier: 'DEV',
      suggestedAssigneeHint: 'Иванов Сергей',
      suggestedGoalName: null,
      suggestedPriority: 'high',
      suggestedDueDate: '2026-05-30',
      suggestedLabels: [],
      confidence: 0.95,
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

  const issues = {
    create: vi.fn().mockResolvedValue({ id: 'issue-created-1' }),
  };

  const metrics = {
    incAiIntakeAutoAccepted: vi.fn(),
    incAiIntakeSuggested: vi.fn(),
  };

  const redis = { client: {} as unknown } as unknown as RedisService;

  // Ф3 (2026-06-07): порог авто-Issue читается из AdminSetting-крутилки
  // (cfg.tracker.autoAcceptConfidenceThreshold, дефолт 0.75).
  const cfg = {
    tracker: { autoAcceptConfidenceThreshold: 0.75 },
  } as unknown as TypedConfigService;

  const worker = new IntakeAutoTriageWorker(
    redis,
    prisma as unknown as PrismaService,
    llm as unknown as LlmRouterService,
    issues as unknown as IssuesService,
    cfg,
    metrics as unknown as BusinessMetricsService,
  );
  return { worker, prisma, llm, issues, metrics };
}

function jobOf(data: IntakeAutoTriageJobData): Job<IntakeAutoTriageJobData> {
  return {
    id: 'job-1',
    data,
    attemptsMade: 0,
  } as unknown as Job<IntakeAutoTriageJobData>;
}

describe('IntakeAutoTriageWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('confidence ≥ 0.92 + source=meeting + assignee → auto-create Issue + status=accepted', async () => {
    // Ф5.1: для meeting-источника исполнитель резолвится upstream по identity
    // участников встречи (meeting-extract-actions), а не substring по тенанту.
    // Поэтому identity-корректный userId приходит уже в intake.suggestedAssigneeId.
    const { worker, prisma, issues, metrics } = mkWorker({
      intake: { suggestedAssigneeId: 'user-ivanov' },
    });
    await worker.process(
      jobOf({ tenantId: 'org-1', intakeIssueId: 'intake-1' }),
    );
    expect(issues.create).toHaveBeenCalledTimes(1);
    const createArg = issues.create.mock.calls[0];
    expect(createArg?.[0]).toBe('proj-dev'); // projectId
    const dto = createArg?.[1] as {
      title: string;
      assigneeUserIds: string[];
      priority: string;
    };
    expect(dto.title).toBe('Сделать отчёт');
    expect(dto.assigneeUserIds).toEqual(['user-ivanov']);
    expect(dto.priority).toBe('high');

    const updateArg = prisma.intakeIssue.update.mock.calls[0]?.[0] as {
      data: { status: string; createdIssueId: string };
    };
    expect(updateArg.data.status).toBe('accepted');
    expect(updateArg.data.createdIssueId).toBe('issue-created-1');

    expect(metrics.incAiIntakeAutoAccepted).toHaveBeenCalledTimes(1);
    expect(metrics.incAiIntakeSuggested).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'auto_accepted' }),
    );
  });

  it('confidence < 0.92 → не создаёт Issue, обновляет только suggested*', async () => {
    const { worker, prisma, issues, metrics } = mkWorker({
      // Ф5.1: meeting-источник несёт identity-резолвнутый assignee upstream.
      intake: { suggestedAssigneeId: 'user-ivanov' },
      llmText: JSON.stringify({
        suggestedProjectIdentifier: 'DEV',
        suggestedAssigneeHint: 'Иванов Сергей',
        suggestedPriority: 'medium',
        suggestedDueDate: '2026-05-30',
        confidence: 0.55,
      }),
    });
    await worker.process(
      jobOf({ tenantId: 'org-1', intakeIssueId: 'intake-1' }),
    );
    expect(issues.create).not.toHaveBeenCalled();
    const updateArg = prisma.intakeIssue.update.mock.calls[0]?.[0] as {
      data: {
        suggestedAssigneeId: string | null;
        suggestedProjectId: string | null;
        suggestedPriority: string | null;
        status?: string;
      };
    };
    expect(updateArg.data.suggestedAssigneeId).toBe('user-ivanov');
    expect(updateArg.data.suggestedProjectId).toBe('proj-dev');
    expect(updateArg.data.suggestedPriority).toBe('medium');
    // status НЕ обновляется — остаётся pending.
    expect(updateArg.data.status).toBeUndefined();
    expect(metrics.incAiIntakeSuggested).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' }),
    );
  });

  it('source != meeting → даже при confidence ≥ 0.92 не создаёт Issue', async () => {
    const { worker, issues, metrics } = mkWorker({
      intake: { source: 'email' },
    });
    await worker.process(
      jobOf({ tenantId: 'org-1', intakeIssueId: 'intake-1' }),
    );
    expect(issues.create).not.toHaveBeenCalled();
    expect(metrics.incAiIntakeAutoAccepted).not.toHaveBeenCalled();
    expect(metrics.incAiIntakeSuggested).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' }),
    );
  });

  it('suggestedAssigneeId не разрешился → не auto-create', async () => {
    const { worker, prisma, issues, metrics } = mkWorker();
    // Отсутствие совпадений: person.findMany возвращает пустой
    prisma.person.findMany.mockResolvedValueOnce([]);
    await worker.process(
      jobOf({ tenantId: 'org-1', intakeIssueId: 'intake-1' }),
    );
    expect(issues.create).not.toHaveBeenCalled();
    expect(metrics.incAiIntakeSuggested).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' }),
    );
  });

  it('IntakeIssue уже triaged → skip + метрика skipped_already_triaged', async () => {
    const { worker, issues, llm, metrics } = mkWorker({
      intake: { triagedAt: new Date(), createdIssueId: 'old-issue' },
    });
    await worker.process(
      jobOf({ tenantId: 'org-1', intakeIssueId: 'intake-1' }),
    );
    expect(llm.call).not.toHaveBeenCalled();
    expect(issues.create).not.toHaveBeenCalled();
    expect(metrics.incAiIntakeSuggested).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'skipped_already_triaged' }),
    );
  });

  it('LLM упал → метрика llm_error + throw (BullMQ retry)', async () => {
    const { worker, issues } = mkWorker({ llmReject: true });
    await expect(
      worker.process(
        jobOf({ tenantId: 'org-1', intakeIssueId: 'intake-1' }),
      ),
    ).rejects.toThrow('LLM timeout');
    expect(issues.create).not.toHaveBeenCalled();
  });

  it('confidence ≥ 0.92, но проект не найден → fallback на pending', async () => {
    const { worker, issues, metrics } = mkWorker({ noProject: true });
    await worker.process(
      jobOf({ tenantId: 'org-1', intakeIssueId: 'intake-1' }),
    );
    expect(issues.create).not.toHaveBeenCalled();
    expect(metrics.incAiIntakeAutoAccepted).not.toHaveBeenCalled();
    expect(metrics.incAiIntakeSuggested).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending' }),
    );
  });

  // ТЗ B Фаза 4 — JSON-резилиенс: tryParseJson снимает ```json-обёртку,
  // раньше одиночный JSON.parse падал и триаж терялся молча.
  it('LLM вернул ```json-обёртку → триаж парсится (auto-accept), один вызов', async () => {
    const wrapped =
      '```json\n' +
      JSON.stringify({
        suggestedProjectIdentifier: 'DEV',
        suggestedAssigneeHint: 'Иванов Сергей',
        suggestedGoalName: null,
        suggestedPriority: 'high',
        suggestedDueDate: '2026-05-30',
        suggestedLabels: [],
        confidence: 0.95,
      }) +
      '\n```';
    const { worker, llm, issues, metrics } = mkWorker({
      intake: { suggestedAssigneeId: 'user-ivanov' },
      llmText: wrapped,
    });
    await worker.process(
      jobOf({ tenantId: 'org-1', intakeIssueId: 'intake-1' }),
    );
    // Валидный ответ с первой попытки → ровно один вызов LLM (break сразу).
    expect(llm.call).toHaveBeenCalledTimes(1);
    expect(issues.create).toHaveBeenCalledTimes(1);
    expect(metrics.incAiIntakeSuggested).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'auto_accepted' }),
    );
  });

  it('LLM дважды вернул мусор → pending без throw + метрика llm_error', async () => {
    const { worker, llm, issues, prisma, metrics } = mkWorker({
      llmText: 'это вообще не json, просто проза',
    });
    // Не должно бросить (LLM ответил, просто JSON битый дважды).
    await expect(
      worker.process(
        jobOf({ tenantId: 'org-1', intakeIssueId: 'intake-1' }),
      ),
    ).resolves.toBeUndefined();
    // Ретрай×2 → ровно два вызова LLM.
    expect(llm.call).toHaveBeenCalledTimes(2);
    expect(issues.create).not.toHaveBeenCalled();
    // IntakeIssue остаётся pending — suggested* не перезаписываем.
    expect(prisma.intakeIssue.update).not.toHaveBeenCalled();
    expect(metrics.incAiIntakeSuggested).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'llm_error' }),
    );
  });
});
