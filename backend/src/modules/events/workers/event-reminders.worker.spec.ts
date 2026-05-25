import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { ConversationalService } from '../../conversational/conversational.service';
import type { MailService } from '../../mail/mail.service';

import { EventRemindersWorker } from './event-reminders.worker';

/**
 * Calendar MVP Phase P2 (2026-05-25) — email-канал для напоминаний.
 *
 * Покрываем три ключевые ветки:
 *   1. reminder.userId задан → User с email → MailService.sendPlain
 *      вызван с правильным to/subject/text + метрика +1.
 *   2. reminder.userId задан → User БЕЗ email (пустая строка) →
 *      sendPlain НЕ вызван, sentAt всё равно проставляется (warn-skip).
 *   3. reminder.userId=null + два участника (User с email + Person БЕЗ email)
 *      → один send + один skip.
 *
 * BullMQ Worker не поднимаем — дергаем приватный `process` через cast.
 */

interface BaseMocks {
  prisma: PrismaService;
  conversational: ConversationalService;
  metrics: BusinessMetricsService;
  redis: RedisService;
  mail: MailService;
  cfg: TypedConfigService;
  sendPlain: ReturnType<typeof vi.fn>;
  incCalendarReminderSent: ReturnType<typeof vi.fn>;
  eventReminderUpdate: ReturnType<typeof vi.fn>;
  sendNotification: ReturnType<typeof vi.fn>;
}

function buildMocks(opts: {
  reminder: unknown;
  userById?: Record<string, { id: string; name: string; email: string } | null>;
}): BaseMocks {
  const eventReminderFindUnique = vi.fn(async () => opts.reminder);
  const eventReminderUpdate = vi.fn(async () => undefined);
  const userFindUnique = vi.fn(async (q: { where: { id: string } }) => {
    return opts.userById?.[q.where.id] ?? null;
  });
  const prisma = {
    eventReminder: {
      findUnique: eventReminderFindUnique,
      update: eventReminderUpdate,
    },
    user: { findUnique: userFindUnique },
  } as unknown as PrismaService;

  const sendNotification = vi.fn(async () => undefined);
  const conversational = { sendNotification } as unknown as ConversationalService;

  const incCalendarReminderSent = vi.fn();
  const metrics = {
    incCalendarReminderSent,
  } as unknown as BusinessMetricsService;

  const sendPlain = vi.fn(async () => ({ ok: true }));
  const mail = { sendPlain } as unknown as MailService;

  const cfg = {
    auth: { publicFrontendUrl: 'https://app.kora.test' },
  } as unknown as TypedConfigService;

  const redis = { client: {} } as unknown as RedisService;

  return {
    prisma,
    conversational,
    metrics,
    redis,
    mail,
    cfg,
    sendPlain,
    incCalendarReminderSent,
    eventReminderUpdate,
    sendNotification,
  };
}

function makeReminder(args: {
  channel: 'email' | 'telegram' | 'push';
  userId: string | null;
  participants?: Array<{
    user?: { id: string; name: string; email: string };
    person?: { id: string; name: string; email: string };
  }>;
}): unknown {
  return {
    id: 'rem-1',
    eventId: 'evt-1',
    channel: args.channel,
    userId: args.userId,
    offsetMin: 15,
    sentAt: null,
    event: {
      id: 'evt-1',
      tenantId: 'org-1',
      title: 'Дейли-стендап',
      // На 30 минут вперёд от now, чтобы formatRelative дал «через ~30 минут».
      startAt: new Date(Date.now() + 30 * 60_000),
      location: 'Zoom #1',
      timezone: 'Europe/Moscow',
      deletedAt: null,
      participants: (args.participants ?? []).map((p, i) => ({
        userId: p.user?.id ?? null,
        personId: p.person?.id ?? null,
        user: p.user
          ? { id: p.user.id, name: p.user.name, email: p.user.email }
          : null,
        person: p.person
          ? { id: p.person.id, name: p.person.name, email: p.person.email }
          : null,
        _i: i,
      })),
    },
  };
}

describe('EventRemindersWorker.process — email-канал (Phase P2)', () => {
  it('reminder.userId задан → User с email → sendPlain вызван и метрика +1', async () => {
    const reminder = makeReminder({
      channel: 'email',
      userId: 'user-1',
    });
    const m = buildMocks({
      reminder,
      userById: {
        'user-1': { id: 'user-1', name: 'Иван Иванов', email: 'ivan@example.com' },
      },
    });
    const worker = new EventRemindersWorker(
      m.redis,
      m.prisma,
      m.conversational,
      m.metrics,
      m.mail,
      m.cfg,
    );
    await (worker as unknown as { process: (j: unknown) => Promise<void> }).process({
      data: { reminderId: 'rem-1' },
      id: 'job-1',
    });

    expect(m.sendPlain).toHaveBeenCalledTimes(1);
    const call = m.sendPlain.mock.calls[0]?.[0] as {
      to: string;
      subject: string;
      text: string;
      template?: string;
    };
    expect(call.to).toBe('ivan@example.com');
    expect(call.subject).toContain('Напоминание: Дейли-стендап');
    expect(call.text).toContain('Здравствуйте, Иван Иванов');
    expect(call.text).toContain('Дейли-стендап');
    expect(call.text).toContain('Zoom #1');
    expect(call.text).toContain('https://app.kora.test/events/evt-1');
    expect(call.template).toBe('event-reminder');

    expect(m.incCalendarReminderSent).toHaveBeenCalledWith({
      tenant: 'org-1',
      channel: 'email',
      success: true,
    });
    expect(m.eventReminderUpdate).toHaveBeenCalledWith({
      where: { id: 'rem-1' },
      data: { sentAt: expect.any(Date) },
    });
  });

  it('reminder.userId задан → User БЕЗ email → skip с warn, sendPlain НЕ вызван, sentAt всё равно ставится', async () => {
    const reminder = makeReminder({
      channel: 'email',
      userId: 'user-2',
    });
    const m = buildMocks({
      reminder,
      userById: {
        // Пустая строка эквивалентна отсутствию (после normalizeEmail).
        'user-2': { id: 'user-2', name: 'Пётр', email: '' },
      },
    });
    const worker = new EventRemindersWorker(
      m.redis,
      m.prisma,
      m.conversational,
      m.metrics,
      m.mail,
      m.cfg,
    );
    await (worker as unknown as { process: (j: unknown) => Promise<void> }).process({
      data: { reminderId: 'rem-1' },
      id: 'job-2',
    });

    expect(m.sendPlain).not.toHaveBeenCalled();
    // skip — метрику доставки не инкрементируем.
    expect(m.incCalendarReminderSent).not.toHaveBeenCalled();
    // sentAt всё равно проставляется (чтобы не зациклиться).
    expect(m.eventReminderUpdate).toHaveBeenCalledWith({
      where: { id: 'rem-1' },
      data: { sentAt: expect.any(Date) },
    });
  });

  it('reminder.userId=null + 2 participant (User с email + Person без email) → 1 send + 1 skip', async () => {
    const reminder = makeReminder({
      channel: 'email',
      userId: null,
      participants: [
        {
          user: { id: 'user-A', name: 'Анна', email: 'anna@example.com' },
        },
        {
          person: { id: 'person-B', name: 'Борис из СпортМастера', email: '' },
        },
      ],
    });
    const m = buildMocks({ reminder });
    const worker = new EventRemindersWorker(
      m.redis,
      m.prisma,
      m.conversational,
      m.metrics,
      m.mail,
      m.cfg,
    );
    await (worker as unknown as { process: (j: unknown) => Promise<void> }).process({
      data: { reminderId: 'rem-1' },
      id: 'job-3',
    });

    expect(m.sendPlain).toHaveBeenCalledTimes(1);
    const call = m.sendPlain.mock.calls[0]?.[0] as { to: string; text: string };
    expect(call.to).toBe('anna@example.com');
    expect(call.text).toContain('Здравствуйте, Анна');

    // Только Анне инкрементнули метрику успеха; Борис — skip.
    expect(m.incCalendarReminderSent).toHaveBeenCalledTimes(1);
    expect(m.incCalendarReminderSent).toHaveBeenCalledWith({
      tenant: 'org-1',
      channel: 'email',
      success: true,
    });

    expect(m.eventReminderUpdate).toHaveBeenCalledWith({
      where: { id: 'rem-1' },
      data: { sentAt: expect.any(Date) },
    });
  });

  it('MailService.sendPlain вернул ok=false → метрика success=false, sentAt всё равно ставится', async () => {
    const reminder = makeReminder({
      channel: 'email',
      userId: 'user-3',
    });
    const m = buildMocks({
      reminder,
      userById: {
        'user-3': { id: 'user-3', name: 'Сергей', email: 'sergey@example.com' },
      },
    });
    // Эмулируем ошибку SMTP.
    (m.sendPlain as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      error: 'smtp_timeout',
    });

    const worker = new EventRemindersWorker(
      m.redis,
      m.prisma,
      m.conversational,
      m.metrics,
      m.mail,
      m.cfg,
    );
    await (worker as unknown as { process: (j: unknown) => Promise<void> }).process({
      data: { reminderId: 'rem-1' },
      id: 'job-4',
    });

    expect(m.sendPlain).toHaveBeenCalledTimes(1);
    expect(m.incCalendarReminderSent).toHaveBeenCalledWith({
      tenant: 'org-1',
      channel: 'email',
      success: false,
    });
    // sentAt всё равно ставим, чтобы reminder не дёргался каждую минуту;
    // BullMQ retry'и решаются на уровне самой ошибки, но `process` сам по себе
    // не должен бросать — иначе job упадёт и Worker не дойдёт до update.
    expect(m.eventReminderUpdate).toHaveBeenCalledWith({
      where: { id: 'rem-1' },
      data: { sentAt: expect.any(Date) },
    });
  });
});
