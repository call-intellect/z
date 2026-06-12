import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { IntakeAutoTriageJobData } from '../queues';
import type { IssuesService } from '../services/issues.service';
import type { ProjectsService } from '../services/projects.service';

import { IntakeAutoTriageWorker } from './intake-auto-triage.worker';

interface MockPrisma {
  intakeIssue: {
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  project: {
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    /** W4 autonomy — резолв существующего дефолт-проекта «Входящие». */
    findFirst: ReturnType<typeof vi.fn>;
  };
  person: { findMany: ReturnType<typeof vi.fn> };
  goal: { findMany: ReturnType<typeof vi.fn> };
  issue: { findMany: ReturnType<typeof vi.fn> };
  /** W4 autonomy — владелец Org как fallback-исполнитель/владелец «Входящие». */
  org: { findUnique: ReturnType<typeof vi.fn> };
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
  projects: { create: ReturnType<typeof vi.fn> };
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
      // W4 autonomy — по умолчанию проекта «Входящие» в тенанте нет.
      findFirst: vi.fn().mockResolvedValue(null),
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
    org: {
      findUnique: vi.fn().mockResolvedValue({ ownerId: 'user-org-owner' }),
    },
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

  // W4 autonomy — штатный ProjectsService для создания «Входящие».
  const projects = {
    create: vi.fn().mockResolvedValue({ id: 'proj-inbox' }),
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
    projects as unknown as ProjectsService,
    cfg,
    metrics as unknown as BusinessMetricsService,
  );
  return { worker, prisma, llm, issues, projects, metrics };
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

  // W4 autonomy (2026-06-12) — авто-приём из ВСЕХ каналов, не только meeting.
  it('W4: telegram + confidence 0.8 + assignee и проект найдены → авто-приём (Issue создан)', async () => {
    const { worker, issues, projects, metrics } = mkWorker({
      intake: { source: 'telegram', externalSource: 'telegram' },
      llmText: JSON.stringify({
        suggestedProjectIdentifier: 'DEV',
        suggestedAssigneeHint: 'Иванов Сергей',
        suggestedGoalName: null,
        suggestedPriority: 'high',
        suggestedDueDate: '2026-06-20',
        suggestedLabels: [],
        confidence: 0.8,
      }),
    });
    await worker.process(
      jobOf({ tenantId: 'org-1', intakeIssueId: 'intake-1' }),
    );
    expect(issues.create).toHaveBeenCalledTimes(1);
    const createArg = issues.create.mock.calls[0];
    expect(createArg?.[0]).toBe('proj-dev');
    const dto = createArg?.[1] as { assigneeUserIds: string[] };
    // Substring-резолв по тенанту сработал — исполнитель найден, без fallback.
    expect(dto.assigneeUserIds).toEqual(['user-ivanov']);
    // Дефолт-проект не понадобился.
    expect(projects.create).not.toHaveBeenCalled();
    expect(metrics.incAiIntakeAutoAccepted).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'telegram',
        viaDefaultProject: 'false',
      }),
    );
    expect(metrics.incAiIntakeSuggested).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'auto_accepted', source: 'telegram' }),
    );
  });

  it('W4: telegram + исполнитель не выводится → Issue на владельца Org + пометка «уточните»', async () => {
    const { worker, prisma, issues } = mkWorker({
      intake: { source: 'telegram', externalSource: 'telegram' },
      llmText: JSON.stringify({
        suggestedProjectIdentifier: 'DEV',
        suggestedAssigneeHint: null,
        suggestedPriority: 'medium',
        suggestedLabels: [],
        confidence: 0.85,
      }),
    });
    // Никто не матчится по людям тенанта.
    prisma.person.findMany.mockResolvedValueOnce([]);
    await worker.process(
      jobOf({ tenantId: 'org-1', intakeIssueId: 'intake-1' }),
    );
    expect(prisma.org.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'org-1' } }),
    );
    expect(issues.create).toHaveBeenCalledTimes(1);
    const dto = issues.create.mock.calls[0]?.[1] as {
      assigneeUserIds: string[];
      description: string;
    };
    // Поля автора у IntakeIssue нет → fallback на владельца Org.
    expect(dto.assigneeUserIds).toEqual(['user-org-owner']);
    expect(dto.description).toContain(
      '⚠️ Кора: не удалось определить исполнителя — уточните',
    );
  });

  it('W4: suggestedProjectId null → создаётся дефолт-проект «Входящие» и Issue в нём', async () => {
    const { worker, prisma, issues, projects, metrics } = mkWorker({
      intake: { source: 'telegram', externalSource: 'telegram' },
      noProject: true,
      llmText: JSON.stringify({
        suggestedProjectIdentifier: null,
        suggestedAssigneeHint: 'Иванов Сергей',
        suggestedPriority: 'high',
        suggestedLabels: [],
        confidence: 0.9,
      }),
    });
    // autoAccept резолвит ownerId созданного проекта для createdBy.
    prisma.project.findUnique.mockResolvedValue({ ownerId: 'user-org-owner' });
    await worker.process(
      jobOf({ tenantId: 'org-1', intakeIssueId: 'intake-1' }),
    );
    // «Входящие» не существовал → создан через штатный ProjectsService.
    expect(projects.create).toHaveBeenCalledTimes(1);
    const projArgs = projects.create.mock.calls[0];
    expect(projArgs?.[0]).toEqual(
      expect.objectContaining({ name: 'Входящие' }),
    );
    expect(projArgs?.[1]).toBe('org-1'); // tenantId
    expect(projArgs?.[2]).toBe('user-org-owner'); // владелец Org
    expect(issues.create).toHaveBeenCalledTimes(1);
    expect(issues.create.mock.calls[0]?.[0]).toBe('proj-inbox');
    expect(metrics.incAiIntakeAutoAccepted).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'telegram',
        viaDefaultProject: 'true',
      }),
    );
  });

  it('W4: «Входящие» уже существует → переиспользуется без создания', async () => {
    const { worker, prisma, issues, projects } = mkWorker({
      intake: { source: 'telegram', externalSource: 'telegram' },
      noProject: true,
      llmText: JSON.stringify({
        suggestedProjectIdentifier: null,
        suggestedAssigneeHint: 'Иванов Сергей',
        suggestedLabels: [],
        confidence: 0.9,
      }),
    });
    prisma.project.findFirst.mockResolvedValue({ id: 'proj-inbox-existing' });
    prisma.project.findUnique.mockResolvedValue({ ownerId: 'user-org-owner' });
    await worker.process(
      jobOf({ tenantId: 'org-1', intakeIssueId: 'intake-1' }),
    );
    expect(projects.create).not.toHaveBeenCalled();
    expect(issues.create.mock.calls[0]?.[0]).toBe('proj-inbox-existing');
  });

  it('W4: confidence 0.6 < 0.75 → pending, без side-effect создания «Входящие»', async () => {
    const { worker, prisma, issues, projects, metrics } = mkWorker({
      intake: { source: 'telegram', externalSource: 'telegram' },
      noProject: true,
      llmText: JSON.stringify({
        suggestedProjectIdentifier: null,
        suggestedAssigneeHint: 'Иванов Сергей',
        suggestedLabels: [],
        confidence: 0.6,
      }),
    });
    await worker.process(
      jobOf({ tenantId: 'org-1', intakeIssueId: 'intake-1' }),
    );
    expect(issues.create).not.toHaveBeenCalled();
    expect(projects.create).not.toHaveBeenCalled();
    expect(prisma.org.findUnique).not.toHaveBeenCalled();
    expect(metrics.incAiIntakeAutoAccepted).not.toHaveBeenCalled();
    expect(metrics.incAiIntakeSuggested).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', source: 'telegram' }),
    );
  });

  // W4 регресс-негатив: для meeting исполнитель identity-резолвится upstream;
  // null там значит «не выводится» — fallback на владельца НЕ применяется.
  it('W4: meeting + assignee null → pending, без fallback на владельца Org', async () => {
    const { worker, prisma, issues, projects, metrics } = mkWorker({
      intake: { source: 'meeting', suggestedAssigneeId: null },
    });
    await worker.process(
      jobOf({ tenantId: 'org-1', intakeIssueId: 'intake-1' }),
    );
    expect(issues.create).not.toHaveBeenCalled();
    expect(projects.create).not.toHaveBeenCalled();
    expect(prisma.org.findUnique).not.toHaveBeenCalled();
    expect(metrics.incAiIntakeSuggested).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', source: 'meeting' }),
    );
  });

  // W4 идемпотентность: повторный прогон после уже созданного Issue — no-op
  // (гард createdIssueId в autoAccept сохранён).
  it('W4: повторный прогон с createdIssueId → Issue не создаётся повторно', async () => {
    const { worker, prisma, issues } = mkWorker({
      intake: {
        suggestedAssigneeId: 'user-ivanov',
        createdIssueId: 'issue-already-created',
        triagedAt: null,
      },
    });
    await worker.process(
      jobOf({ tenantId: 'org-1', intakeIssueId: 'intake-1' }),
    );
    expect(issues.create).not.toHaveBeenCalled();
    expect(prisma.intakeIssue.update).not.toHaveBeenCalled();
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

  // W4: для meeting fallback'ов нет (assignee приходит upstream); при
  // невыводимом assignee проект «Входящие» даже не резолвится → pending.
  it('meeting: confidence ≥ порога, но assignee не выводится и проекта нет → pending', async () => {
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
