/**
 * ТЗ 2026-05-29 telegram-self-initiated-checkins Phase 4 / DoD:
 *   «CheckinResponseHandler.processSelfInitiated покрыт unit-тестами:
 *    успешный путь, low-parser-confidence (создаёт запись с curatorReview,
 *    не уходит в free_note), отсутствие Person, отсутствие Membership,
 *    закрытие pending notification, replace-сценарий.»
 *
 * markAsAnsweredByCheckin покрыт смежным spec'ом ниже:
 *   «помечает notification answered, не эмитит notification.responded».
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { CheckinResponseHandler } from './checkin-response.handler';

interface MockedHandler {
  handler: CheckinResponseHandler;
  prisma: {
    person: { findFirst: ReturnType<typeof vi.fn> };
    notification: { findMany: ReturnType<typeof vi.fn> };
    channelBinding: { findUnique: ReturnType<typeof vi.fn> };
  };
  parser: { parse: ReturnType<typeof vi.fn> };
  checkinService: {
    hasCompletedToday: ReturnType<typeof vi.fn>;
    upsertFromParser: ReturnType<typeof vi.fn>;
  };
  dashboard: { invalidateCache: ReturnType<typeof vi.fn> };
  metrics: {
    incDailyCheckinSkipped: ReturnType<typeof vi.fn>;
    incBotDailyCheckinSelf: ReturnType<typeof vi.fn>;
  };
  conversational: {
    sendNotification: ReturnType<typeof vi.fn>;
    markAsAnsweredByCheckin: ReturnType<typeof vi.fn>;
  };
  eventEmitter: { emit: ReturnType<typeof vi.fn> };
}

function build(): MockedHandler {
  const prisma = {
    person: { findFirst: vi.fn() },
    notification: { findMany: vi.fn().mockResolvedValue([]) },
    channelBinding: { findUnique: vi.fn() },
  };
  const parser = { parse: vi.fn() };
  const checkinService = {
    hasCompletedToday: vi.fn().mockResolvedValue(false),
    upsertFromParser: vi.fn().mockResolvedValue({ id: 'ci-1' }),
  };
  const dashboard = { invalidateCache: vi.fn() };
  const metrics = {
    incDailyCheckinSkipped: vi.fn(),
    incBotDailyCheckinSelf: vi.fn(),
  };
  const conversational = {
    sendNotification: vi.fn().mockResolvedValue({ id: 'n-ack' }),
    markAsAnsweredByCheckin: vi.fn().mockResolvedValue({ id: 'n-1' }),
  };
  const eventEmitter = { emit: vi.fn() };

  const handler = new CheckinResponseHandler(
    prisma as unknown as never,
    parser as unknown as never,
    checkinService as unknown as never,
    dashboard as unknown as never,
    metrics as unknown as never,
    conversational as unknown as never,
    eventEmitter as unknown as never,
  );

  return { handler, prisma, parser, checkinService, dashboard, metrics, conversational, eventEmitter };
}

describe('CheckinResponseHandler.processSelfInitiated', () => {
  let mock: MockedHandler;
  beforeEach(() => {
    mock = build();
  });

  it('успешный путь: morning + ok confidence → upsert source=self_initiated + sendNotification(checkin.ack) + event', async () => {
    mock.prisma.person.findFirst.mockResolvedValue({
      id: 'p-1',
      timezone: 'Europe/Moscow',
    });
    mock.parser.parse.mockResolvedValue({
      plans: [{ text: 'КП' }, { text: 'созвон' }, { text: 'отчёт' }],
      dones: [],
      blockers: [{ text: 'ТЗ не пришло', severity: 'medium' }],
      confidence: 0.9,
    });

    const r = await mock.handler.processSelfInitiated({
      tenantId: 't-1',
      userId: 'u-1',
      kind: 'morning',
      rawText: 'План на день: КП, созвон, отчёт. Блокер: ТЗ',
      originChannelBindingId: 'b-1',
    });

    expect(r.outcome).toBe('saved');
    expect(mock.checkinService.upsertFromParser).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'self_initiated',
        kind: 'morning',
        personId: 'p-1',
        notificationId: null,
      }),
    );
    expect(mock.conversational.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'checkin.ack',
        payload: expect.objectContaining({
          kind: 'morning',
          wasReplace: false,
          plansCount: 3,
          blockersCount: 1,
          lowParserConfidence: false,
        }),
      }),
    );
    expect(mock.eventEmitter.emit).toHaveBeenCalledWith(
      'checkin.created',
      expect.objectContaining({
        checkInId: 'ci-1',
        kind: 'morning',
      }),
    );
    expect(mock.metrics.incBotDailyCheckinSelf).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'morning', outcome: 'saved' }),
    );
    expect(mock.dashboard.invalidateCache).toHaveBeenCalledWith('t-1');
  });

  it('low parser confidence — создаёт запись (НЕ в free_note), outcome=low_parser_confidence_curator_review, lowParserConfidence=true', async () => {
    mock.prisma.person.findFirst.mockResolvedValue({
      id: 'p-1',
      timezone: 'Europe/Moscow',
    });
    mock.parser.parse.mockResolvedValue({
      plans: [],
      dones: [],
      blockers: [],
      confidence: 0.3,
    });
    const r = await mock.handler.processSelfInitiated({
      tenantId: 't-1',
      userId: 'u-1',
      kind: 'morning',
      rawText: 'размытый текст',
    });
    expect(r.outcome).toBe('low_parser_confidence_curator_review');
    expect(mock.checkinService.upsertFromParser).toHaveBeenCalled();
    expect(mock.conversational.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ lowParserConfidence: true }),
      }),
    );
  });

  it('отсутствие Person — outcome=no_person, никаких upsert/notifications', async () => {
    mock.prisma.person.findFirst.mockResolvedValue(null);
    const r = await mock.handler.processSelfInitiated({
      tenantId: 't-1',
      userId: 'u-1',
      kind: 'morning',
      rawText: 'план',
    });
    expect(r.outcome).toBe('no_person');
    expect(mock.checkinService.upsertFromParser).not.toHaveBeenCalled();
    expect(mock.conversational.sendNotification).not.toHaveBeenCalled();
  });

  it('закрытие pending checkin.prompt для (kind, dateLocal) — markAsAnsweredByCheckin зовётся, на чужом dateLocal — нет', async () => {
    mock.prisma.person.findFirst.mockResolvedValue({
      id: 'p-1',
      timezone: 'UTC',
    });
    mock.parser.parse.mockResolvedValue({
      plans: [],
      dones: [],
      blockers: [],
      confidence: 0.9,
    });
    // build dateLocal под UTC текущей даты
    const todayUtc = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    mock.prisma.notification.findMany.mockResolvedValue([
      {
        id: 'n-match',
        payload: { checkInKind: 'morning', dateLocal: todayUtc },
      },
      {
        id: 'n-other-day',
        payload: { checkInKind: 'morning', dateLocal: '2020-01-01' },
      },
      {
        id: 'n-other-kind',
        payload: { checkInKind: 'evening', dateLocal: todayUtc },
      },
    ]);

    await mock.handler.processSelfInitiated({
      tenantId: 't-1',
      userId: 'u-1',
      kind: 'morning',
      rawText: 'план',
    });

    expect(mock.conversational.markAsAnsweredByCheckin).toHaveBeenCalledTimes(1);
    expect(mock.conversational.markAsAnsweredByCheckin).toHaveBeenCalledWith({
      notificationId: 'n-match',
      userId: 'u-1',
      fromSelfInitiated: true,
    });
  });

  it('replace-сценарий: hasCompletedToday=true → wasReplace=true в payload', async () => {
    mock.prisma.person.findFirst.mockResolvedValue({
      id: 'p-1',
      timezone: 'UTC',
    });
    mock.parser.parse.mockResolvedValue({
      plans: [{ text: 'новый план' }],
      dones: [],
      blockers: [],
      confidence: 0.9,
    });
    mock.checkinService.hasCompletedToday.mockResolvedValue(true);

    await mock.handler.processSelfInitiated({
      tenantId: 't-1',
      userId: 'u-1',
      kind: 'morning',
      rawText: 'обновляю план',
    });

    expect(mock.conversational.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ wasReplace: true }),
      }),
    );
  });

  it('error path: parser падает → outcome=error + метрика error', async () => {
    mock.prisma.person.findFirst.mockResolvedValue({
      id: 'p-1',
      timezone: 'UTC',
    });
    mock.parser.parse.mockRejectedValue(new Error('LLM down'));
    const r = await mock.handler.processSelfInitiated({
      tenantId: 't-1',
      userId: 'u-1',
      kind: 'morning',
      rawText: 'план',
    });
    expect(r.outcome).toBe('error');
    expect(mock.metrics.incBotDailyCheckinSelf).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'error' }),
    );
  });

  it('originChannelBindingId резолвится: preferredChannelKinds=[telegram_bot]', async () => {
    mock.prisma.person.findFirst.mockResolvedValue({
      id: 'p-1',
      timezone: 'UTC',
    });
    mock.parser.parse.mockResolvedValue({
      plans: [],
      dones: [],
      blockers: [],
      confidence: 0.9,
    });
    mock.prisma.channelBinding.findUnique.mockResolvedValue({
      id: 'b-1',
      userId: 'u-1',
      channel: { tenantId: 't-1', kind: 'telegram_bot' },
    });
    await mock.handler.processSelfInitiated({
      tenantId: 't-1',
      userId: 'u-1',
      kind: 'morning',
      rawText: 'план',
      originChannelBindingId: 'b-1',
    });
    expect(mock.conversational.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        preferredChannelKinds: ['telegram_bot'],
      }),
    );
  });
});
