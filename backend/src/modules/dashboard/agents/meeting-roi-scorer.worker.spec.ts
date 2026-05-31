/**
 * Pulse Wave 6 §6.3 — MeetingRoiScorerWorker (unit).
 *
 * Проверяем чистую формулу + защиту от деления на 0. LLM не используется
 * (worker детерминистический), BullMQ не поднимаем — вызываем `process(job)`
 * напрямую.
 */

import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';

import { MeetingRoiScorerWorker } from './meeting-roi-scorer.worker';

interface Counters {
  decisions: number;
  commitments: number;
  tasks: number;
  rawEventIds?: string[];
  evidenceBlockIds?: string[];
  commitmentBlocks?: number;
}

interface HarnessOpts {
  meeting: Record<string, unknown> | null;
  counters?: Counters;
}

interface WorkerHarness {
  worker: MeetingRoiScorerWorker;
  meetingUpdate: ReturnType<typeof vi.fn>;
}

function buildHarness(opts: HarnessOpts): WorkerHarness {
  const meetingUpdate = vi.fn(async () => ({}));

  const decisionsCount = opts.counters?.decisions ?? 0;
  const tasksCount = opts.counters?.tasks ?? 0;
  // Эмулируем цепочку countCommitments: rawEvent → evidence → ideaBlock.count.
  // Если commitments==0 — возвращаем 0 rawEvents (короткий путь).
  const commitmentBlocks = opts.counters?.commitments ?? 0;
  const rawEventIds =
    commitmentBlocks > 0 ? opts.counters?.rawEventIds ?? ['re-1'] : [];
  const evidenceBlockIds =
    commitmentBlocks > 0
      ? opts.counters?.evidenceBlockIds ?? ['b-1', 'b-2', 'b-3', 'b-4', 'b-5']
      : [];

  const prisma = {
    meeting: {
      findUnique: vi.fn(async () => opts.meeting),
      update: meetingUpdate,
    },
    decision: {
      count: vi.fn(async () => decisionsCount),
    },
    task: {
      count: vi.fn(async () => tasksCount),
    },
    rawEvent: {
      findMany: vi.fn(async () => rawEventIds.map((id) => ({ id }))),
    },
    ideaBlockEvidence: {
      findMany: vi.fn(async () =>
        evidenceBlockIds.map((blockId) => ({ blockId })),
      ),
    },
    ideaBlock: {
      count: vi.fn(async () => commitmentBlocks),
    },
  } as unknown as PrismaService;

  const redis = { client: {} } as unknown as RedisService;

  const worker = new MeetingRoiScorerWorker(redis, prisma);
  return { worker, meetingUpdate };
}

function buildMeeting(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'm-1',
    tenantId: 'org-1',
    durationMs: 60 * 60 * 1000, // 60 минут
    startedAt: new Date('2026-05-31T10:00:00Z'),
    endedAt: new Date('2026-05-31T11:00:00Z'),
    _count: { participants: 3 },
    ...overrides,
  };
}

const JOB = {
  id: 'j-1',
  data: { meetingId: 'm-1' },
  opts: { attempts: 3 },
  attemptsMade: 0,
} as unknown as Parameters<MeetingRoiScorerWorker['process']>[0];

describe('MeetingRoiScorerWorker.process', () => {
  it('happy: meeting 60min × 3 participants × {2 decisions, 5 commitments, 3 tasks} → roiScore=18.000', async () => {
    const h = buildHarness({
      meeting: buildMeeting(),
      counters: { decisions: 2, commitments: 5, tasks: 3 },
    });

    await h.worker.process(JOB);

    // numerator = 2*10 + 5*5 + 3*3 = 54
    // denominator = 3 participants * 1 hour = 3
    // roiScore = 54 / 3 = 18.000
    expect(h.meetingUpdate).toHaveBeenCalledTimes(1);
    const arg = h.meetingUpdate.mock.calls[0]?.[0] as {
      where: { id: string };
      data: { roiScore: Prisma.Decimal; roiScoreAt: Date };
    };
    expect(arg.where.id).toBe('m-1');
    expect(arg.data.roiScore.toString()).toBe('18');
    expect(arg.data.roiScoreAt).toBeInstanceOf(Date);
  });

  it('zero duration: roiScore=0 (защита от деления на 0)', async () => {
    const h = buildHarness({
      meeting: buildMeeting({
        durationMs: 0,
        startedAt: null,
        endedAt: null,
      }),
      counters: { decisions: 5, commitments: 5, tasks: 5 },
    });

    await h.worker.process(JOB);

    expect(h.meetingUpdate).toHaveBeenCalledTimes(1);
    const arg = h.meetingUpdate.mock.calls[0]?.[0] as {
      data: { roiScore: Prisma.Decimal };
    };
    expect(arg.data.roiScore.toString()).toBe('0');
  });

  it('empty meeting: 0 decisions/commitments/tasks → roiScore=0', async () => {
    const h = buildHarness({
      meeting: buildMeeting(),
      counters: { decisions: 0, commitments: 0, tasks: 0 },
    });

    await h.worker.process(JOB);

    expect(h.meetingUpdate).toHaveBeenCalledTimes(1);
    const arg = h.meetingUpdate.mock.calls[0]?.[0] as {
      data: { roiScore: Prisma.Decimal };
    };
    expect(arg.data.roiScore.toString()).toBe('0');
  });

  it('meeting не найден — silent skip без update', async () => {
    const h = buildHarness({ meeting: null });
    await h.worker.process(JOB);
    expect(h.meetingUpdate).not.toHaveBeenCalled();
  });

  it('0 участников трактуем как 1 (защита от деления на 0)', async () => {
    const h = buildHarness({
      meeting: buildMeeting({ _count: { participants: 0 } }),
      counters: { decisions: 1, commitments: 0, tasks: 0 },
    });

    await h.worker.process(JOB);

    // numerator = 1*10 = 10; denominator = 1 * 1h = 1; roiScore = 10.
    const arg = h.meetingUpdate.mock.calls[0]?.[0] as {
      data: { roiScore: Prisma.Decimal };
    };
    expect(arg.data.roiScore.toString()).toBe('10');
  });
});
