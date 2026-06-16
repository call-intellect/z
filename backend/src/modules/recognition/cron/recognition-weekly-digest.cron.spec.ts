import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RecognitionService } from '../services/recognition.service';

import { RecognitionWeeklyDigestCron } from './recognition-weekly-digest.cron';

function mkCron(opts: {
  members: Array<{ userId: string; orgId: string }>;
  snapshots: Record<string, Record<string, number> | null>;
}): {
  cron: RecognitionWeeklyDigestCron;
  recognition: { enqueueFormulate: ReturnType<typeof vi.fn> };
} {
  const prisma = {
    membership: { findMany: vi.fn().mockResolvedValue(opts.members) },
    contributionSnapshot: {
      findUnique: vi
        .fn()
        .mockImplementation(
          async ({ where }: { where: { userId: string } }) => opts.snapshots[where.userId] ?? null,
        ),
    },
  };
  const recognition = {
    enqueueFormulate: vi.fn().mockResolvedValue({ jobId: 'job-1' }),
  };
  const cron = new RecognitionWeeklyDigestCron(
    prisma as unknown as PrismaService,
    recognition as unknown as RecognitionService,
  );
  return { cron, recognition };
}

describe('RecognitionWeeklyDigestCron', () => {
  beforeEach(() => vi.clearAllMocks());

  it('не шлёт пустых благодарностей (snapshot пустой)', async () => {
    const { cron, recognition } = mkCron({
      members: [{ userId: 'u-1', orgId: 'org-1' }],
      snapshots: {
        'u-1': {
          thanksReceivedWeek: 0,
          helpfulComments: 0,
          ideasInDevelopment: 0,
          thanksReceived: 0,
          probeQuestionsAnswered: 0,
        },
      },
    });
    await cron.run();
    expect(recognition.enqueueFormulate).not.toHaveBeenCalled();
  });

  it('эмитит weekly_summary когда есть значимая активность', async () => {
    const { cron, recognition } = mkCron({
      members: [{ userId: 'u-1', orgId: 'org-1' }],
      snapshots: {
        'u-1': {
          thanksReceivedWeek: 2,
          helpfulComments: 5,
          ideasInDevelopment: 1,
          thanksReceived: 5,
          probeQuestionsAnswered: 3,
        },
      },
    });
    await cron.run();
    const calls = recognition.enqueueFormulate.mock.calls;
    const types = calls.map((c) => (c[0] as { type: string }).type);
    expect(types).toContain('weekly_summary');
  });

  it('флагает unrecognized_high_contributor (helpful≥10, thanks=0)', async () => {
    const { cron, recognition } = mkCron({
      members: [{ userId: 'u-1', orgId: 'org-1' }],
      snapshots: {
        'u-1': {
          thanksReceivedWeek: 0,
          helpfulComments: 15,
          ideasInDevelopment: 0,
          thanksReceived: 0,
          probeQuestionsAnswered: 0,
        },
      },
    });
    await cron.run();
    const calls = recognition.enqueueFormulate.mock.calls;
    const types = calls.map((c) => (c[0] as { type: string }).type);
    expect(types).toContain('thanks_helpfulness');
    expect(types).toContain('weekly_summary');
  });

  it('skipping member без snapshot', async () => {
    const { cron, recognition } = mkCron({
      members: [{ userId: 'u-no-snap', orgId: 'org-1' }],
      snapshots: {},
    });
    await cron.run();
    expect(recognition.enqueueFormulate).not.toHaveBeenCalled();
  });
});
