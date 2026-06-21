import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingCheckinListener } from './meeting-checkin.listener';

function makeDeps() {
  const prisma = {
    meeting: { findUnique: vi.fn() },
    person: { findMany: vi.fn() },
  };
  const cfg = {
    getDynamic: vi.fn(async (key: string): Promise<unknown> => {
      if (key === 'daySignals.enabled') return true;
      if (key === 'daySignals.detectThreshold') return 0.7;
      return undefined;
    }),
  };
  const extractor = { extractFromMeeting: vi.fn() };
  const detector = { detect: vi.fn() };
  const checkins = { upsertFromDaySignal: vi.fn() };
  const metrics = { incDaySignalBelowGate: vi.fn() };
  return { prisma, cfg, extractor, detector, checkins, metrics };
}

function makeListener(deps: ReturnType<typeof makeDeps>) {
  return new MeetingCheckinListener(
    deps.prisma as never,
    deps.cfg as never,
    deps.metrics as never,
    deps.extractor as never,
    deps.detector as never,
    deps.checkins as never,
  );
}

describe('MeetingCheckinListener', () => {
  let deps: ReturnType<typeof makeDeps>;
  let listener: MeetingCheckinListener;

  beforeEach(() => {
    deps = makeDeps();
    listener = makeListener(deps);
  });

  it('создаёт morning-чек-ин из плана участника-сотрудника', async () => {
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
    deps.extractor.extractFromMeeting.mockResolvedValue([
      {
        personId: 'pm',
        text: 'сегодня займусь релизом',
        source: 'meeting',
        occurredAt: new Date('2026-06-21T09:00:00Z'),
      },
    ]);
    deps.prisma.person.findMany.mockResolvedValue([{ id: 'pm', timezone: 'Europe/Moscow' }]);
    deps.detector.detect.mockResolvedValue({
      hasPlan: true,
      plan: { items: [{ text: 'релиз' }] },
      hasReport: false,
      report: { dones: [], blockers: [] },
      isPersonalNonWork: false,
      confidence: 0.9,
    });

    await listener.onMeetingAiReady({ meetingId: 'm1', tenantId: 't1', type: 'standup' });

    expect(deps.checkins.upsertFromDaySignal).toHaveBeenCalledTimes(1);
    expect(deps.checkins.upsertFromDaySignal).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'meeting', kind: 'morning', personId: 'pm' }),
    );
    expect(deps.metrics.incDaySignalBelowGate).not.toHaveBeenCalled();
  });

  it('kill-switch: при daySignals.enabled=false не читает встречу и не пишет чек-ин', async () => {
    deps.cfg.getDynamic.mockImplementation(async (key: string) => {
      if (key === 'daySignals.enabled') return false;
      if (key === 'daySignals.detectThreshold') return 0.7;
      return undefined;
    });

    await listener.onMeetingAiReady({ meetingId: 'm1', tenantId: 't1', type: 'standup' });

    expect(deps.prisma.meeting.findUnique).not.toHaveBeenCalled();
    expect(deps.checkins.upsertFromDaySignal).not.toHaveBeenCalled();
  });

  it('below-gate: confidence ниже порога — инкремент метрики, без upsert', async () => {
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
    deps.extractor.extractFromMeeting.mockResolvedValue([
      {
        personId: 'pm',
        text: 'сегодня займусь релизом',
        source: 'meeting',
        occurredAt: new Date('2026-06-21T09:00:00Z'),
      },
    ]);
    deps.prisma.person.findMany.mockResolvedValue([{ id: 'pm', timezone: 'Europe/Moscow' }]);
    deps.detector.detect.mockResolvedValue({
      hasPlan: true,
      plan: { items: [{ text: 'релиз' }] },
      hasReport: false,
      report: { dones: [], blockers: [] },
      isPersonalNonWork: false,
      confidence: 0.4,
    });

    await listener.onMeetingAiReady({ meetingId: 'm1', tenantId: 't1', type: 'standup' });

    expect(deps.checkins.upsertFromDaySignal).not.toHaveBeenCalled();
    expect(deps.metrics.incDaySignalBelowGate).toHaveBeenCalledTimes(1);
  });

  it('пустой транскрипт после извлечения — без upsert', async () => {
    deps.prisma.meeting.findUnique.mockResolvedValue({
      transcript: {
        turns: [
          {
            speaker: 'A',
            text: 'привет',
            startSec: 0,
            endSec: 1,
            speakerParticipantId: 'sp1',
          },
        ],
      },
      startedAt: new Date('2026-06-21T09:00:00Z'),
      endedAt: null,
    });
    deps.extractor.extractFromMeeting.mockResolvedValue([]);

    await listener.onMeetingAiReady({ meetingId: 'm1', tenantId: 't1', type: 'standup' });

    expect(deps.checkins.upsertFromDaySignal).not.toHaveBeenCalled();
    expect(deps.metrics.incDaySignalBelowGate).not.toHaveBeenCalled();
  });
});
