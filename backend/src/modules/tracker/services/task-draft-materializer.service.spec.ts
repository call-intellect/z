import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { AssigneeResolverService } from './assignee-resolver.service';
import type { IntakeAutoTriageQueueService } from './intake-auto-triage-queue.service';
import type { SkillRoutingService } from './skill-routing.service';
import type { TaskDedupService } from './task-dedup.service';
import {
  type MaterializeArgs,
  TaskDraftMaterializerService,
} from './task-draft-materializer.service';

const TENANT = 'tenant-1';

function makeDeps() {
  const create = vi.fn().mockResolvedValue({ id: 'new-1' });
  const findFirst = vi.fn().mockResolvedValue(null);
  const projectFindFirst = vi.fn().mockResolvedValue(null);
  const prisma = {
    intakeIssue: { findFirst, create },
    project: { findFirst: projectFindFirst },
  } as unknown as PrismaService;

  const evaluate = vi
    .fn()
    .mockResolvedValue({ verdict: 'nil', matchedIssueId: null });
  const taskDedup = { evaluate } as unknown as TaskDedupService;

  const resolve = vi.fn().mockResolvedValue({ kind: 'not_found' });
  const orgAssigneeResolver = { resolve } as unknown as AssigneeResolverService;

  const cfg = {
    taskRouting: { enabled: true, autoAssignMinConfidence: 0.7 },
    pendingActions: { intakeTtlDays: 30 },
  } as unknown as TypedConfigService;

  const enqueue = vi.fn().mockResolvedValue(undefined);
  const autoTriageQueue = {
    enqueue,
  } as unknown as IntakeAutoTriageQueueService;

  const incTaskDraftMaterialized = vi.fn();
  const incTaskSkillRoutingAssigned = vi.fn();
  const metrics = {
    incTaskDraftMaterialized,
    incTaskSkillRoutingAssigned,
  } as unknown as BusinessMetricsService;

  const suggestAssignee = vi.fn().mockResolvedValue([]);
  const skillRouting = {
    suggestAssignee,
  } as unknown as SkillRoutingService;

  const service = new TaskDraftMaterializerService(
    prisma,
    taskDedup,
    cfg,
    orgAssigneeResolver,
    skillRouting,
    autoTriageQueue,
    metrics,
  );

  return {
    service,
    create,
    findFirst,
    projectFindFirst,
    evaluate,
    resolve,
    enqueue,
    incTaskDraftMaterialized,
    suggestAssignee,
  };
}

function args(drafts: MaterializeArgs['drafts']): MaterializeArgs {
  return { tenantId: TENANT, channel: 'telegram', sourceId: 'conv-1', drafts };
}

describe('TaskDraftMaterializerService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('создаёт IntakeIssue из черновика с чек-листом', async () => {
    const { service, create } = makeDeps();

    const result = await service.materialize(
      args([
        {
          title: 'Сделать лендинг',
          sourceQuote: 'я докручу лендинг к пятнице',
          subtasks: [{ title: 'текст' }, { title: 'макет' }],
        },
      ]),
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT,
          status: 'pending',
          source: 'telegram',
          externalSource: 'telegram',
          extractedTitle: 'Сделать лендинг',
          checklistJson: [{ items: [{ text: 'текст' }, { text: 'макет' }] }],
        }),
        select: { id: true },
      }),
    );
    expect(result).toEqual([
      { id: 'new-1', title: 'Сделать лендинг', confidence: null },
    ]);
  });

  it('идемпотентность: при существующем IntakeIssue не создаёт дубль', async () => {
    const { service, create, findFirst } = makeDeps();
    findFirst.mockResolvedValueOnce({ id: 'existing-1' });

    const result = await service.materialize(
      args([{ title: 'Повторная задача' }]),
    );

    expect(create).not.toHaveBeenCalled();
    expect(result).toHaveLength(0);
  });

  it('дедуп-suggest: verdict=same проставляет suggestedDuplicateOfIssueId', async () => {
    const { service, create, evaluate } = makeDeps();
    evaluate.mockResolvedValueOnce({ verdict: 'same', matchedIssueId: 'iss-9' });

    await service.materialize(
      args([{ title: 'Похожая задача', suggestedAssigneeHint: 'Иван' }]),
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ suggestedDuplicateOfIssueId: 'iss-9' }),
      }),
    );
  });

  it('пустой title пропускается', async () => {
    const { service, create } = makeDeps();

    const result = await service.materialize(args([{ title: '   ' }]));

    expect(create).not.toHaveBeenCalled();
    expect(result).toHaveLength(0);
  });

  it('без subtasks checklistJson = Prisma.JsonNull', async () => {
    const { service, create } = makeDeps();

    await service.materialize(
      args([{ title: 'Без чек-листа', suggestedAssigneeHint: 'Иван' }]),
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ checklistJson: Prisma.JsonNull }),
      }),
    );
  });

  it('meeting_report + report_<ulid> → meetingId = голый ulid', async () => {
    const { service, create } = makeDeps();

    await service.materialize({
      tenantId: TENANT,
      channel: 'meeting_report',
      sourceId: 'report_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      drafts: [{ title: 'Задача из отчёта' }],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ meetingId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }),
      }),
    );
  });

  it('meeting + ulid → meetingId = sourceId (регресс)', async () => {
    const { service, create } = makeDeps();

    await service.materialize({
      tenantId: TENANT,
      channel: 'meeting',
      sourceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      drafts: [{ title: 'Задача из транскрипта' }],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ meetingId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }),
      }),
    );
  });

  it('meeting_report + невалидный ulid → meetingId = null (не падать)', async () => {
    const { service, create } = makeDeps();

    await service.materialize({
      tenantId: TENANT,
      channel: 'meeting_report',
      sourceId: 'report_notulid',
      drafts: [{ title: 'Задача с плохим id' }],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ meetingId: null }),
      }),
    );
  });

  it('Ф2: meeting_report + hint-гость (не резолвится) → assignee=null, ownerHintRaw=hint, skill-routing НЕ зван', async () => {
    const { service, create, suggestAssignee } = makeDeps();

    await service.materialize({
      tenantId: TENANT,
      channel: 'meeting_report',
      sourceId: 'report_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      drafts: [{ title: 'Задача Романа', suggestedAssigneeHint: 'Роман' }],
    });

    expect(suggestAssignee).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          suggestedAssigneeId: null,
          ownerHintRaw: 'Роман',
        }),
      }),
    );
  });

  it('Ф2: meeting_report + hint-сотрудник (резолвится) → assignee=userId, ownerHintRaw=null', async () => {
    const { service, create, resolve, suggestAssignee } = makeDeps();
    resolve.mockResolvedValueOnce({ kind: 'resolved', userId: 'user-sergey' });

    await service.materialize({
      tenantId: TENANT,
      channel: 'meeting_report',
      sourceId: 'report_01ARZ3NDEKTSV4RRFFQ69G5FAV',
      drafts: [{ title: 'Задача Сергея', suggestedAssigneeHint: 'Сергей' }],
    });

    expect(suggestAssignee).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          suggestedAssigneeId: 'user-sergey',
          ownerHintRaw: null,
        }),
      }),
    );
  });

  it('Ф2: не-встречный канал (chatbox) → skill-routing ВЫЗВАН (регресс не-meeting поведения)', async () => {
    const { service, suggestAssignee } = makeDeps();

    await service.materialize({
      tenantId: TENANT,
      channel: 'chatbox',
      sourceId: 'conv-1',
      drafts: [{ title: 'Задача из чата', suggestedAssigneeHint: 'кто-нибудь' }],
    });

    expect(suggestAssignee).toHaveBeenCalledTimes(1);
  });

  it('chatbox → meetingId = null (регресс)', async () => {
    const { service, create } = makeDeps();

    await service.materialize({
      tenantId: TENANT,
      channel: 'chatbox',
      sourceId: 'conv-1',
      drafts: [{ title: 'Задача из чата' }],
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ meetingId: null }),
      }),
    );
  });
});
