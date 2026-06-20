import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { TaskEvidenceLinkerService } from './task-evidence-linker.service';

interface FakeTask {
  id: string;
  meetingId: string;
  tenantId: string;
  sourceQuote: string | null;
  evidenceBlockIds: string[];
}

interface FakeEvidence {
  blockId: string;
  quote: string;
  meetingId: string;
  tenantId: string;
}

function buildPrisma(opts: {
  tasks: FakeTask[];
  evidence: FakeEvidence[];
}): { prisma: PrismaService; tasks: FakeTask[]; updateCalls: number } {
  const tasks = opts.tasks;
  const state = { updateCalls: 0 };
  const prisma = {
    task: {
      findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        const where = args.where;
        return tasks
          .filter(
            (t) =>
              t.meetingId === where['meetingId'] &&
              t.tenantId === where['tenantId'] &&
              t.evidenceBlockIds.length === 0 &&
              t.sourceQuote !== null,
          )
          .map((t) => ({ id: t.id, sourceQuote: t.sourceQuote }));
      }),
      updateMany: vi.fn(
        async (args: {
          where: { id: string; tenantId: string };
          data: { evidenceBlockIds: string[] };
        }) => {
          state.updateCalls += 1;
          const t = tasks.find((x) => x.id === args.where.id && x.tenantId === args.where.tenantId);
          if (!t || t.evidenceBlockIds.length > 0) return { count: 0 };
          t.evidenceBlockIds = args.data.evidenceBlockIds;
          return { count: 1 };
        },
      ),
    },
    ideaBlockEvidence: {
      findMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        const rawEvent = (args.where['rawEvent'] ?? {}) as {
          sourceExternalId?: string;
          tenantId?: string;
        };
        return opts.evidence
          .filter(
            (e) =>
              e.meetingId === rawEvent.sourceExternalId && e.tenantId === rawEvent.tenantId,
          )
          .map((e) => ({ blockId: e.blockId, quote: e.quote }));
      }),
    },
  } as unknown as PrismaService;
  return { prisma, tasks, updateCalls: state.updateCalls };
}

const TENANT = 'org-1';
const MEETING = 'meet-1';

describe('TaskEvidenceLinkerService', () => {
  it('матчит задачу к блоку, чья evidence.quote содержит sourceQuote', async () => {
    const tasks: FakeTask[] = [
      {
        id: 'task-1',
        meetingId: MEETING,
        tenantId: TENANT,
        sourceQuote: 'нужно подготовить квартальный отчёт',
        evidenceBlockIds: [],
      },
    ];
    const evidence: FakeEvidence[] = [
      {
        blockId: 'block-A',
        quote: 'Договорились, что нужно подготовить квартальный отчёт до пятницы',
        meetingId: MEETING,
        tenantId: TENANT,
      },
      {
        blockId: 'block-B',
        quote: 'Совсем другая тема про маркетинговый бюджет на следующий год',
        meetingId: MEETING,
        tenantId: TENANT,
      },
    ];
    const { prisma, tasks: store } = buildPrisma({ tasks, evidence });
    const svc = new TaskEvidenceLinkerService(prisma);

    const res = await svc.linkForMeeting({ tenantId: TENANT, meetingId: MEETING });

    expect(res.linked).toBe(1);
    expect(store[0]!.evidenceBlockIds).toEqual(['block-A']);
  });

  it('нет совпадения → evidenceBlockIds остаётся пустым (graceful)', async () => {
    const tasks: FakeTask[] = [
      {
        id: 'task-1',
        meetingId: MEETING,
        tenantId: TENANT,
        sourceQuote: 'совершенно уникальная фраза без пересечений',
        evidenceBlockIds: [],
      },
    ];
    const evidence: FakeEvidence[] = [
      {
        blockId: 'block-A',
        quote: 'Обсуждали логистику складов и сроки поставки оборудования',
        meetingId: MEETING,
        tenantId: TENANT,
      },
    ];
    const { prisma, tasks: store } = buildPrisma({ tasks, evidence });
    const svc = new TaskEvidenceLinkerService(prisma);

    const res = await svc.linkForMeeting({ tenantId: TENANT, meetingId: MEETING });

    expect(res.linked).toBe(0);
    expect(store[0]!.evidenceBlockIds).toEqual([]);
  });

  it('идемпотентность: второй прогон не трогает уже заполненную задачу', async () => {
    const tasks: FakeTask[] = [
      {
        id: 'task-1',
        meetingId: MEETING,
        tenantId: TENANT,
        sourceQuote: 'нужно подготовить квартальный отчёт',
        evidenceBlockIds: [],
      },
    ];
    const evidence: FakeEvidence[] = [
      {
        blockId: 'block-A',
        quote: 'Нужно подготовить квартальный отчёт до пятницы',
        meetingId: MEETING,
        tenantId: TENANT,
      },
    ];
    const { prisma, tasks: store } = buildPrisma({ tasks, evidence });
    const svc = new TaskEvidenceLinkerService(prisma);

    const first = await svc.linkForMeeting({ tenantId: TENANT, meetingId: MEETING });
    expect(first.linked).toBe(1);
    expect(store[0]!.evidenceBlockIds).toEqual(['block-A']);

    const updateMany = prisma.task.updateMany as unknown as ReturnType<typeof vi.fn>;
    const callsAfterFirst = updateMany.mock.calls.length;

    const second = await svc.linkForMeeting({ tenantId: TENANT, meetingId: MEETING });
    expect(second.linked).toBe(0);
    expect(store[0]!.evidenceBlockIds).toEqual(['block-A']);
    expect(updateMany.mock.calls.length).toBe(callsAfterFirst);
  });
});
