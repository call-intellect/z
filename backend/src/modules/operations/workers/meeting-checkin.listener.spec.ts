import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingCheckinListener } from './meeting-checkin.listener';

function makeDeps() {
  const prisma = {
    meeting: { findUnique: vi.fn() },
  };
  const cfg = {
    getDynamic: vi.fn(async (key: string): Promise<unknown> => {
      if (key === 'dayReport.enabled') return true;
      return undefined;
    }),
  };
  const entities = { resolveSubjectPersonId: vi.fn() };
  const collector = { assembleAndUpsert: vi.fn() };
  return { prisma, cfg, entities, collector };
}

function makeListener(deps: ReturnType<typeof makeDeps>) {
  return new MeetingCheckinListener(
    deps.prisma as never,
    deps.cfg as never,
    deps.entities as never,
    deps.collector as never,
  );
}

describe('MeetingCheckinListener', () => {
  let deps: ReturnType<typeof makeDeps>;
  let listener: MeetingCheckinListener;

  beforeEach(() => {
    deps = makeDeps();
    listener = makeListener(deps);
  });

  it('резолвит участников из транскрипта и зовёт сборщик дневного отчёта', async () => {
    deps.prisma.meeting.findUnique.mockResolvedValue({
      transcript: {
        turns: [
          {
            speaker: 'A',
            text: 'сегодня займусь релизом',
            startSec: 0,
            endSec: 1,
            speakerParticipantId: 'sp1',
          },
          { speaker: 'Гость', text: 'ок', startSec: 1, endSec: 2, speakerParticipantId: null },
        ],
      },
      startedAt: new Date('2026-06-21T09:00:00Z'),
      endedAt: null,
    });
    deps.entities.resolveSubjectPersonId.mockResolvedValue('pm');
    deps.collector.assembleAndUpsert.mockResolvedValue({
      persons: 1,
      morningUpserts: 1,
      eveningUpserts: 0,
    });

    await listener.onMeetingAiReady({ meetingId: 'm1', tenantId: 't1', type: 'standup' });

    expect(deps.entities.resolveSubjectPersonId).toHaveBeenCalledWith('t1', {
      speakerParticipantId: 'sp1',
    });
    expect(deps.collector.assembleAndUpsert).toHaveBeenCalledTimes(1);
    expect(deps.collector.assembleAndUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', dateLocal: '2026-06-21', personIds: ['pm'] }),
    );
  });

  it('kill-switch: при dayReport.enabled=false не читает встречу и не зовёт сборщик', async () => {
    deps.cfg.getDynamic.mockImplementation(async (key: string) => {
      if (key === 'dayReport.enabled') return false;
      return undefined;
    });

    await listener.onMeetingAiReady({ meetingId: 'm1', tenantId: 't1', type: 'standup' });

    expect(deps.prisma.meeting.findUnique).not.toHaveBeenCalled();
    expect(deps.collector.assembleAndUpsert).not.toHaveBeenCalled();
  });

  it('пустой транскрипт — без вызова сборщика', async () => {
    deps.prisma.meeting.findUnique.mockResolvedValue({
      transcript: { turns: [] },
      startedAt: new Date('2026-06-21T09:00:00Z'),
      endedAt: null,
    });

    await listener.onMeetingAiReady({ meetingId: 'm1', tenantId: 't1', type: 'standup' });

    expect(deps.entities.resolveSubjectPersonId).not.toHaveBeenCalled();
    expect(deps.collector.assembleAndUpsert).not.toHaveBeenCalled();
  });

  it('ни один участник не резолвится — без вызова сборщика', async () => {
    deps.prisma.meeting.findUnique.mockResolvedValue({
      transcript: {
        turns: [
          {
            speaker: 'A',
            text: 'сегодня займусь релизом',
            startSec: 0,
            endSec: 1,
            speakerParticipantId: 'sp1',
          },
        ],
      },
      startedAt: new Date('2026-06-21T09:00:00Z'),
      endedAt: null,
    });
    deps.entities.resolveSubjectPersonId.mockResolvedValue(null);

    await listener.onMeetingAiReady({ meetingId: 'm1', tenantId: 't1', type: 'standup' });

    expect(deps.collector.assembleAndUpsert).not.toHaveBeenCalled();
  });
});
