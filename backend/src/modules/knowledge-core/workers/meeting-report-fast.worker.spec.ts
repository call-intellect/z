import { describe, expect, it, vi } from 'vitest';

import { MeetingReportFastWorker } from './meeting-report-fast.worker';

function buildWorker(): {
  worker: MeetingReportFastWorker;
  upsert: ReturnType<typeof vi.fn>;
  qualityUpsert: ReturnType<typeof vi.fn>;
  meetingUpdate: ReturnType<typeof vi.fn>;
} {
  const qualityUpsert = vi.fn(async () => ({}));
  const meetingUpdate = vi.fn(async () => ({}));
  const prisma = {
    aiResult: {
      upsert: vi.fn(async () => ({})),
    },
    $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        meeting: { update: meetingUpdate },
        meetingQualityScore: { upsert: qualityUpsert },
      }),
    ),
  };

  const worker = new MeetingReportFastWorker(
    {} as never,
    prisma as never,
    {} as never,
    {} as never,
    undefined,
  );

  return {
    worker,
    upsert: prisma.aiResult.upsert,
    qualityUpsert,
    meetingUpdate,
  };
}

function qualityScore(): Record<string, unknown> {
  return {
    overallScore: 72,
    categories: {
      preparation: 70,
      structure: 75,
      clarity: 70,
      outcomes: 80,
      engagement: 65,
    },
    recommendations: [
      { text: 'Озвучить повестку в первые 5 минут.', severity: 'info', category: 'preparation' },
    ],
    strengths: ['Конкретные итоги.'],
  };
}

/**
 * Б32 [K6] — при деградации провайдера внутренний цикл (MAX_LLM_RETRIES+1 = 3
 * дорогих LLM-вызова) исчерпывается без валидного вывода. РАНЬШЕ воркер бросал
 * исключение «чтобы BullMQ зачёл attempt» → attempts=5 на очереди давали ×3
 * вызова на КАЖДУЮ попытку = до 15 дорогих вызовов на одну встречу. Теперь
 * статус 'failed' записан, job ЗАВЕРШАЕТСЯ без throw → ровно ≤3 LLM-вызова.
 */
describe('MeetingReportFastWorker.process — Б32 ограничение дорогих LLM-вызовов', () => {
  function buildProcessWorker(routerCall: ReturnType<typeof vi.fn>): {
    worker: MeetingReportFastWorker;
    meetingUpdate: ReturnType<typeof vi.fn>;
    routerCall: ReturnType<typeof vi.fn>;
  } {
    const meetingUpdate = vi.fn(async () => ({}));
    const prisma = {
      meeting: {
        findUnique: vi.fn(async () => ({
          id: 'm-1',
          tenantId: 't-1',
          deletedAt: null,
          ownerId: 'owner-1',
          type: 'team',
          title: null,
          startedAt: new Date('2026-06-16T10:00:00.000Z'),
          transcript: {
            turns: [
              { speaker: 'Алиса', text: 'Привет, начнём', startSec: 0, endSec: 2 },
            ],
          },
          aiResult: null,
        })),
        update: meetingUpdate,
      },
    };
    const router = { call: routerCall };
    const participantContext = { loadForMeeting: vi.fn(async () => []) };
    const worker = new MeetingReportFastWorker(
      {} as never, // redis
      prisma as never,
      router as never,
      participantContext as never,
      undefined, // events @Optional
      undefined, // metrics @Optional
      undefined, // meetingTitle @Optional
    );
    return { worker, meetingUpdate, routerCall };
  }

  it('провайдер всегда отдаёт мусор → ровно 3 LLM-вызова, process НЕ бросает, статус failed', async () => {
    // Router всегда возвращает невалидный ответ (ни tool_calls, ни JSON).
    const routerCall = vi.fn(async () => ({
      text: 'это не JSON',
      toolCalls: undefined,
      modelUsed: 'deepseek:v4',
      providerUsed: 'deepseek',
      tier: 'fast',
    }));
    const { worker, meetingUpdate } = buildProcessWorker(routerCall);

    // НЕ должно бросить (раньше бросало).
    await expect(
      (worker as any).process({ id: 'job-1', data: { meetingId: 'm-1' } }),
    ).resolves.toBeUndefined();

    // Ровно MAX_LLM_RETRIES+1 = 3 дорогих вызова, не больше.
    expect(routerCall).toHaveBeenCalledTimes(3);

    // Финальный статус failed записан в БД.
    const failedCall = meetingUpdate.mock.calls.find(
      (c) =>
        (c[0] as { data?: { reportFastStatus?: string } })?.data
          ?.reportFastStatus === 'failed',
    );
    expect(failedCall).toBeDefined();
  });
});

describe('MeetingReportFastWorker.writeSummary — S6-01 upsert', () => {
  it('пишет через upsert по meetingId', async () => {
    const { worker, upsert } = buildWorker();
    await (worker as any).writeSummary({
      meetingId: 'm-1',
      meetingType: 'sales',
      markdown: 'Привет мир',
      modelUsed: 'deepseek:v4',
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { meetingId: 'm-1' },
        update: expect.objectContaining({ summaryFast: 'Привет мир' }),
      }),
    );
  });

  it('идемпотентность: два вызова → upsert вызван дважды, без create-пути (нет гонки)', async () => {
    const { worker, upsert } = buildWorker();
    const args = {
      meetingId: 'm-1',
      meetingType: 'sales',
      markdown: 'Привет мир',
      modelUsed: 'deepseek:v4',
    };
    await (worker as any).writeSummary(args);
    await (worker as any).writeSummary(args);
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it('пустой markdown → early return, upsert НЕ вызван', async () => {
    const { worker, upsert } = buildWorker();
    await (worker as any).writeSummary({
      meetingId: 'm-1',
      meetingType: 'sales',
      markdown: '   ',
      modelUsed: 'deepseek:v4',
    });
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('MeetingReportFastWorker.writeQualityScore — Доводка 2 (каноничная таблица)', () => {
  it('валидный quality_score → upsert MeetingQualityScore (маппинг 5 категорий) + qualityScoreStatus=ready', async () => {
    const { worker, qualityUpsert, meetingUpdate } = buildWorker();
    await (worker as any).writeQualityScore({
      meetingId: 'm-1',
      tenantId: 't-1',
      qualityScore: qualityScore(),
    });
    expect(meetingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'm-1' },
        data: expect.objectContaining({ qualityScoreStatus: 'ready' }),
      }),
    );
    expect(qualityUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { meetingId: 'm-1' },
        create: expect.objectContaining({
          meetingId: 'm-1',
          tenantId: 't-1',
          overallScore: 72,
          preparationScore: 70,
          structureScore: 75,
          clarityScore: 70,
          outcomesScore: 80,
          engagementScore: 65,
        }),
      }),
    );
  });

  it('quality_score без overallScore → skip (ни upsert, ни meeting.update)', async () => {
    const { worker, qualityUpsert, meetingUpdate } = buildWorker();
    const bad = qualityScore();
    delete (bad as Record<string, unknown>).overallScore;
    await (worker as any).writeQualityScore({
      meetingId: 'm-1',
      tenantId: 't-1',
      qualityScore: bad,
    });
    expect(qualityUpsert).not.toHaveBeenCalled();
    expect(meetingUpdate).not.toHaveBeenCalled();
  });

  it('quality_score null → skip', async () => {
    const { worker, qualityUpsert, meetingUpdate } = buildWorker();
    await (worker as any).writeQualityScore({
      meetingId: 'm-1',
      tenantId: 't-1',
      qualityScore: null,
    });
    expect(qualityUpsert).not.toHaveBeenCalled();
    expect(meetingUpdate).not.toHaveBeenCalled();
  });
});
