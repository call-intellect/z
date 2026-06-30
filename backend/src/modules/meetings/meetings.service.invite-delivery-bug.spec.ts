import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { JwtService } from '../auth/services/jwt.service';
import type { MeetingsBalanceService } from '../meetings-balance/meetings-balance.service';
import type { UsersService } from '../users/users.service';

import type { MeetingsRepository } from './meetings.repository';
import { MeetingsService } from './meetings.service';

function makeService(personRow: Record<string, unknown>) {
  const participantCreate = vi.fn(async () => ({}));
  const personFindUnique = vi.fn(
    async (_arg: { where: { id: string }; select: Record<string, boolean> }) => personRow,
  );

  const tx = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        name: where.id === 'host1' ? 'Хост' : `Пользователь ${where.id}`,
        email: where.id === 'host1' ? 'host@example.com' : `${where.id}@example.com`,
      })),
    },
    person: { findUnique: personFindUnique },
    card: { findUnique: vi.fn(), update: vi.fn() },
    org: { findFirst: vi.fn(async () => ({ id: 'org1' })) },
    membership: { findFirst: vi.fn() },
    participant: { create: participantCreate },
  };

  const prisma = {
    membership: { findMany: vi.fn(async () => []) },
    org: { updateMany: vi.fn(async () => ({ count: 0 })) },
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<void>) => {
      await cb(tx);
    }),
  } as unknown as PrismaService;

  const repository = {
    create: vi.fn(async ({ id }: { id: string }) => ({ id, tenantId: 'org1', type: 'sync' })),
  } as unknown as MeetingsRepository;

  const metrics = { incMeetingCreated: vi.fn() } as unknown as BusinessMetricsService;
  const balance = { consume: vi.fn() } as unknown as MeetingsBalanceService;
  const cfg = {
    auth: { publicFrontendUrl: 'https://app.kora.test' },
  } as unknown as TypedConfigService;

  const mail = {
    sendMeetingInvite: vi.fn(
      async (_arg: { to: string; hostName: string; meetingTitle: string; joinUrl: string }) => ({
        ok: true,
      }),
    ),
  };
  const conversational = {
    sendNotification: vi.fn(
      async (_arg: {
        tenantId: string;
        recipientUserId: string;
        eventType: string;
        payload: { joinUrl: string; meetingTitle: string; hostName: string };
        preferredChannelKinds: string[];
      }) => ({}),
    ),
  };

  const svc = new MeetingsService(
    prisma,
    repository,
    {} as unknown as UsersService,
    {} as unknown as JwtService,
    cfg,
    metrics,
    balance,
    mail as never,
    conversational as never,
    { assertCanView: vi.fn(async () => ({})) } as never,
    {} as never,
    {} as never,
  );

  return { svc, mail, conversational, personFindUnique };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('Доставка приглашений: приглашённый-Person (как шлёт фронт: personId + email:null)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('почта: personId + email:null, у Person есть email → письмо уходит на person.email', async () => {
    const { svc, mail, personFindUnique } = makeService({
      id: 'p1',
      name: 'Внешний Контакт',
      email: 'real-person@example.com',
      userId: 'u-linked',
    });

    await svc.createForUser(
      {
        type: 'sync' as never,
        title: 'Тест почты на Person',
        invitees: [{ personId: 'p1', email: null, sendVia: ['email'] }],
      },
      'host1',
    );
    await flushMicrotasks();

    expect(personFindUnique).toHaveBeenCalledTimes(1);
    expect(personFindUnique.mock.calls[0]![0]).toEqual({
      where: { id: 'p1' },
      select: { name: true, email: true, userId: true },
    });
    expect(mail.sendMeetingInvite).toHaveBeenCalledTimes(1);
    expect(mail.sendMeetingInvite.mock.calls[0]![0].to).toBe('real-person@example.com');
  });

  it('telegram: personId с привязанным person.userId + sendVia[telegram] → sendNotification на person.userId', async () => {
    const { svc, conversational } = makeService({
      id: 'p1',
      name: 'Внешний Контакт',
      email: 'real-person@example.com',
      userId: 'u-linked-with-telegram',
    });

    await svc.createForUser(
      {
        type: 'sync' as never,
        title: 'Тест telegram на Person',
        invitees: [{ personId: 'p1', email: null, sendVia: ['telegram'] }],
      },
      'host1',
    );
    await flushMicrotasks();

    expect(conversational.sendNotification).toHaveBeenCalledTimes(1);
    expect(conversational.sendNotification.mock.calls[0]![0].recipientUserId).toBe(
      'u-linked-with-telegram',
    );
  });

  it('КОНТРАСТ (рабочий путь): userId + email + sendVia[email,telegram] → уходят и письмо, и telegram', async () => {
    const { svc, mail, conversational } = makeService({ id: 'p-unused', name: 'не используется' });

    await svc.createForUser(
      {
        type: 'sync' as never,
        title: 'Тест рабочего пути',
        invitees: [{ userId: 'u-guest', email: 'guest@example.com', sendVia: ['email', 'telegram'] }],
      },
      'host1',
    );
    await flushMicrotasks();

    expect(mail.sendMeetingInvite).toHaveBeenCalledTimes(1);
    expect(mail.sendMeetingInvite.mock.calls[0]![0].to).toBe('guest@example.com');
    expect(conversational.sendNotification).toHaveBeenCalledTimes(1);
    expect(conversational.sendNotification.mock.calls[0]![0].recipientUserId).toBe('u-guest');
  });
});
