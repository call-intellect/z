import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { TaskDedupService } from './task-dedup.service';
import {
  type MaterializeArgs,
  TaskDraftMaterializerService,
} from './task-draft-materializer.service';

interface StoredIssue {
  id: string;
  data: Record<string, unknown>;
}

function makeStatefulDeps(
  dedupVerdict: { verdict: string; matchedIssueId: string | null } = {
    verdict: 'different',
    matchedIssueId: null,
  },
) {
  const store: StoredIssue[] = [];
  let seq = 0;

  const findFirst = vi.fn(
    async ({
      where,
    }: {
      where: { tenantId: string; externalSource: string; externalId: string };
    }) => {
      const hit = store.find(
        (s) =>
          s.data.tenantId === where.tenantId &&
          s.data.externalSource === where.externalSource &&
          s.data.externalId === where.externalId,
      );
      return hit ? { id: hit.id } : null;
    },
  );

  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    seq += 1;
    const id = `issue-${seq}`;
    store.push({ id, data });
    return { id };
  });

  const projectFindFirst = vi.fn().mockResolvedValue(null);

  const prisma = {
    intakeIssue: { findFirst, create },
    project: { findFirst: projectFindFirst },
  } as unknown as PrismaService;

  const evaluate = vi.fn().mockResolvedValue(dedupVerdict);
  const taskDedup = { evaluate } as unknown as TaskDedupService;

  const cfg = {
    taskRouting: { enabled: false, autoAssignMinConfidence: 0.7 },
    pendingActions: { intakeTtlDays: 14 },
  } as unknown as TypedConfigService;

  const metrics = {
    incTaskDraftMaterialized: vi.fn(),
    incTaskSkillRoutingAssigned: vi.fn(),
  } as unknown as BusinessMetricsService;

  const service = new TaskDraftMaterializerService(
    prisma,
    taskDedup,
    cfg,
    undefined,
    undefined,
    undefined,
    metrics,
  );

  return { service, store, findFirst, create, projectFindFirst, evaluate };
}

function lastData(store: StoredIssue[]): Record<string, unknown> {
  const last = store.at(-1);
  if (!last) throw new Error('store is empty');
  return last.data;
}

describe('TaskDraftMaterializerService — stateful интеграция', () => {
  beforeEach(() => vi.clearAllMocks());

  it('happy path (chat): создаёт один IntakeIssue с корректными полями', async () => {
    const { service, store, create } = makeStatefulDeps();

    const result = await service.materialize({
      tenantId: 't1',
      channel: 'telegram',
      sourceId: 'conv-1',
      sourceTitle: 'Переписка',
      drafts: [
        {
          title: 'Сделать лендинг',
          sourceQuote: 'я докручу лендинг к пятнице',
          subtasks: [{ title: 'текст' }, { title: 'макет' }],
          sourceBlockId: 'b1',
        },
      ],
    } satisfies MaterializeArgs);

    expect(create).toHaveBeenCalledTimes(1);
    expect(store).toHaveLength(1);
    const data = lastData(store);
    expect(data.source).toBe('telegram');
    expect(data.externalSource).toBe('telegram');
    expect(data.status).toBe('pending');
    expect(data.meetingId).toBeNull();
    expect(data.checklistJson).toEqual([
      { items: [{ text: 'текст' }, { text: 'макет' }] },
    ]);
    expect(data.sourceBlockIds).toEqual(['b1']);
    expect(result).toHaveLength(1);
  });

  it('idempotency on retry: повтор того же draft не создаёт дубль', async () => {
    const { service, store, create } = makeStatefulDeps();

    const args: MaterializeArgs = {
      tenantId: 't1',
      channel: 'telegram',
      sourceId: 'conv-1',
      sourceTitle: 'Переписка',
      drafts: [
        {
          title: 'Сделать лендинг',
          sourceQuote: 'я докручу лендинг к пятнице',
          sourceBlockId: 'b1',
        },
      ],
    };

    const first = await service.materialize(args);
    expect(first).toHaveLength(1);
    expect(store).toHaveLength(1);

    const second = await service.materialize(args);
    expect(create).toHaveBeenCalledTimes(1);
    expect(store).toHaveLength(1);
    expect(second).toEqual([]);
  });

  it('meeting channel: meetingId прокидывается из sourceId', async () => {
    const { service, store } = makeStatefulDeps();

    await service.materialize({
      tenantId: 't1',
      channel: 'meeting',
      sourceId: 'm-1',
      sourceTitle: 'Встреча',
      drafts: [{ title: 'Подготовить отчёт', sourceBlockId: 'b1' }],
    });

    expect(lastData(store).meetingId).toBe('m-1');
  });

  it('dedup-suggest: verdict=same проставляет suggestedDuplicateOfIssueId', async () => {
    const { service, store } = makeStatefulDeps({
      verdict: 'same',
      matchedIssueId: 'iss-9',
    });

    await service.materialize({
      tenantId: 't1',
      channel: 'telegram',
      sourceId: 'conv-1',
      drafts: [{ title: 'Похожая задача', sourceBlockId: 'b1' }],
    });

    expect(lastData(store).suggestedDuplicateOfIssueId).toBe('iss-9');
  });

  it('без subtasks: checklistJson = Prisma.JsonNull', async () => {
    const { service, store } = makeStatefulDeps();

    await service.materialize({
      tenantId: 't1',
      channel: 'telegram',
      sourceId: 'conv-1',
      drafts: [{ title: 'Без чек-листа', sourceBlockId: 'b1' }],
    });

    expect(lastData(store).checklistJson).toBe(Prisma.JsonNull);
  });
});
