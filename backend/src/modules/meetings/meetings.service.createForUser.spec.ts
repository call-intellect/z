import { ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import { MeetingNotFoundError, NotAuthorizedError } from '../../common/errors/domain-errors';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { JwtService } from '../auth/services/jwt.service';
import type { MeetingsBalanceService } from '../meetings-balance/meetings-balance.service';
import type { UsersService } from '../users/users.service';

import type { MeetingsRepository } from './meetings.repository';
import { MeetingsService } from './meetings.service';

interface ParticipantCreateArg {
  data: {
    meetingId: string;
    livekitIdentity: string;
    name: string;
    role: string;
    isRegisteredUser: boolean;
    userId?: string | null;
    personId?: string | null;
    invitationStatus?: string;
    inviteToken?: string;
    invitedAt?: Date;
  };
}

function makeService() {
  const participantCreate = vi.fn(async (_arg: ParticipantCreateArg) => ({}));

  const tx = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        name: where.id === 'host1' ? 'Хост' : `Пользователь ${where.id}`,
      })),
    },
    person: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        name: `Контакт ${where.id}`,
      })),
    },
    card: { findUnique: vi.fn(), update: vi.fn() },
    org: {
      findFirst: vi.fn(async () => ({ id: 'org1' })),
    },
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
    create: vi.fn(async ({ id }: { id: string }) => ({
      id,
      tenantId: 'org1',
      type: 'sync',
    })),
  } as unknown as MeetingsRepository;

  const metrics = {
    incMeetingCreated: vi.fn(),
  } as unknown as BusinessMetricsService;

  const balance = {
    consume: vi.fn(),
  } as unknown as MeetingsBalanceService;

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
  );

  return {
    svc,
    prisma,
    repository,
    metrics,
    tx,
    participantCreate,
    mail,
    conversational,
  };
}

describe('MeetingsService.createForUser — pre-seed приглашённых (Фаза 2.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invitees:[{userId:"u1", sendVia:["email"]}] → создан Participant приглашённого с invited/inviteToken/isRegisteredUser', async () => {
    const { svc, participantCreate } = makeService();

    await svc.createForUser(
      {
        type: 'sync' as never,
        title: 'Встреча с приглашённым',
        invitees: [{ userId: 'u1', sendVia: ['email'] }],
      },
      'host1',
    );

    expect(participantCreate).toHaveBeenCalledTimes(2);

    const inviteeCall = participantCreate.mock.calls.find(([arg]) => arg.data.role === 'guest');
    expect(inviteeCall).toBeTruthy();
    const data = inviteeCall![0].data;

    expect(data.invitationStatus).toBe('invited');
    expect(data.inviteToken).toBeTruthy();
    expect(typeof data.inviteToken).toBe('string');
    expect(data.isRegisteredUser).toBe(true);
    expect(data.userId).toBe('u1');
    expect(data.personId).toBeNull();
    expect(data.livekitIdentity.startsWith('invitee:')).toBe(true);
    expect(data.livekitIdentity).toBe(`invitee:${data.inviteToken}`);
    expect(data.invitedAt).toBeInstanceOf(Date);
    expect(data.name).toBe('Пользователь u1');
  });

  it('регресс: без invitees создаётся только host-participant', async () => {
    const { svc, participantCreate } = makeService();

    await svc.createForUser(
      {
        type: 'sync' as never,
        title: 'Встреча без приглашённых',
      },
      'host1',
    );

    expect(participantCreate).toHaveBeenCalledTimes(1);
    const data = participantCreate.mock.calls[0]![0].data;
    expect(data.role).toBe('host');
    expect(data.livekitIdentity).toBe('host:host1');
    expect(data.invitationStatus).toBeUndefined();
  });

  it('Ф7A knowledge-access — closedGroupKind пробрасывается в meetings.create', async () => {
    const { svc, repository } = makeService();

    await svc.createForUser(
      {
        type: 'sync' as never,
        title: 'Совет директоров',
        closedGroupKind: 'council',
      },
      'host1',
    );

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ closedGroupKind: 'council' }),
      expect.anything(),
    );
  });

  it('Ф7A knowledge-access — без флага в data уходит closedGroupKind:null', async () => {
    const { svc, repository } = makeService();

    await svc.createForUser({ type: 'sync' as never, title: 'Обычная' }, 'host1');

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ closedGroupKind: null }),
      expect.anything(),
    );
  });

  it('Фаза 3 — доставка: email-инвайт с адресом → MailService.sendMeetingInvite с joinUrl(?inv=)', async () => {
    const { svc, mail, participantCreate } = makeService();

    await svc.createForUser(
      {
        type: 'sync' as never,
        title: 'Планёрка',
        invitees: [{ userId: 'u1', email: 'nastya@example.com', sendVia: ['email'] }],
      },
      'host1',
    );

    await Promise.resolve();
    await Promise.resolve();

    const inviteeCall = participantCreate.mock.calls.find(([arg]) => arg.data.role === 'guest');
    const token = inviteeCall![0].data.inviteToken;

    expect(mail.sendMeetingInvite).toHaveBeenCalledTimes(1);
    const arg = mail.sendMeetingInvite.mock.calls[0]![0];
    expect(arg.to).toBe('nastya@example.com');
    expect(arg.hostName).toBe('Хост');
    expect(arg.meetingTitle).toBe('Планёрка');
    expect(arg.joinUrl.startsWith('https://app.kora.test/m/')).toBe(true);
    expect(arg.joinUrl).toContain(`?inv=${token}`);
  });

  it('Фаза 3 — доставка: telegram-инвайт с userId → sendNotification(eventType:"meeting.invite")', async () => {
    const { svc, conversational } = makeService();

    await svc.createForUser(
      {
        type: 'sync' as never,
        title: 'Ретро',
        invitees: [{ userId: 'u2', sendVia: ['telegram'] }],
      },
      'host1',
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(conversational.sendNotification).toHaveBeenCalledTimes(1);
    const arg = conversational.sendNotification.mock.calls[0]![0];
    expect(arg.eventType).toBe('meeting.invite');
    expect(arg.recipientUserId).toBe('u2');
    expect(arg.tenantId).toBe('org1');
    expect(arg.payload.meetingTitle).toBe('Ретро');
    expect(arg.payload.hostName).toBe('Хост');
    expect(arg.payload.joinUrl).toContain('?inv=');
    expect(arg.preferredChannelKinds).toEqual(['telegram_bot', 'email_smtp', 'in_app']);
  });

  it('invitee.userId === host → пропускается (не дублирует хоста)', async () => {
    const { svc, participantCreate } = makeService();

    await svc.createForUser(
      {
        type: 'sync' as never,
        title: 'Самоприглашение',
        invitees: [{ userId: 'host1', sendVia: [] }],
      },
      'host1',
    );

    expect(participantCreate).toHaveBeenCalledTimes(1);
    expect(participantCreate.mock.calls[0]![0].data.role).toBe('host');
  });
});

interface MeetingRow {
  id: string;
  ownerId: string;
  tenantId: string;
  title: string;
  status: string;
  owner: { name: string };
  participants: Array<{ userId: string | null; personId: string | null }>;
}

function makeAddInviteesService(args: { meeting?: MeetingRow | null }) {
  const participantCreate = vi.fn(async (_arg: ParticipantCreateArg) => ({}));
  const txMock = {
    participant: { create: participantCreate },
    user: { findUnique: vi.fn(async () => ({ name: 'U2', email: 'u2@x.ru' })) },
    person: { findUnique: vi.fn(async () => ({ name: 'P2' })) },
  };

  const prisma = {
    $transaction: vi.fn(async (cb: (t: typeof txMock) => Promise<void>) => {
      await cb(txMock);
    }),
  } as unknown as PrismaService;

  const repository = {
    findByIdWithOwnerAndParticipants: vi.fn(async () => args.meeting ?? null),
  } as unknown as MeetingsRepository;

  const cfg = {
    auth: { publicFrontendUrl: 'https://app.kora.test' },
  } as unknown as TypedConfigService;

  const mail = { sendMeetingInvite: vi.fn(async () => undefined) } as never;
  const conversational = {
    sendNotification: vi.fn(async () => undefined),
  } as never;

  const svc = new MeetingsService(
    prisma,
    repository,
    {} as unknown as UsersService,
    {} as unknown as JwtService,
    cfg,
    {} as unknown as BusinessMetricsService,
    {} as unknown as MeetingsBalanceService,
    mail,
    conversational,
    { assertCanView: vi.fn(async () => ({})) } as never,
  );

  return { svc, participantCreate };
}

function baseMeeting(overrides: Partial<MeetingRow> = {}): MeetingRow {
  return {
    id: 'm-1',
    ownerId: 'u-host',
    tenantId: 'org1',
    title: 'Планёрка',
    status: 'active',
    owner: { name: 'Хост' },
    participants: [],
    ...overrides,
  };
}

describe('MeetingsService.addInvitees (B5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('actor ≠ ownerId → NotAuthorizedError, create НЕ вызван', async () => {
    const { svc, participantCreate } = makeAddInviteesService({
      meeting: baseMeeting({ ownerId: 'u-host' }),
    });

    await expect(
      svc.addInvitees('m-1', [{ userId: 'u2', sendVia: ['telegram'] }], 'u-stranger'),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
    expect(participantCreate).not.toHaveBeenCalled();
  });

  it('встреча не найдена → MeetingNotFoundError', async () => {
    const { svc, participantCreate } = makeAddInviteesService({ meeting: null });

    await expect(
      svc.addInvitees('m-nope', [{ userId: 'u2', sendVia: [] }], 'u-host'),
    ).rejects.toBeInstanceOf(MeetingNotFoundError);
    expect(participantCreate).not.toHaveBeenCalled();
  });

  it('status=completed → ConflictException (meeting_not_joinable), create НЕ вызван', async () => {
    const { svc, participantCreate } = makeAddInviteesService({
      meeting: baseMeeting({ status: 'completed' }),
    });

    await expect(
      svc.addInvitees('m-1', [{ userId: 'u2', sendVia: [] }], 'u-host'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(participantCreate).not.toHaveBeenCalled();
  });

  it('успех: status=active, новый invitee {userId} → create с invited, { added:1, skipped:0 }', async () => {
    const { svc, participantCreate } = makeAddInviteesService({
      meeting: baseMeeting({ status: 'active', participants: [] }),
    });

    const result = await svc.addInvitees(
      'm-1',
      [{ userId: 'u2', sendVia: ['telegram'] }],
      'u-host',
    );

    expect(result).toEqual({ added: 1, skipped: 0 });
    expect(participantCreate).toHaveBeenCalledTimes(1);
    expect(participantCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          invitationStatus: 'invited',
          userId: 'u2',
          role: 'guest',
        }),
      }),
    );
  });

  it('идемпотентность: участник {userId:u2} уже есть → create НЕ вызван, { added:0, skipped:1 }', async () => {
    const { svc, participantCreate } = makeAddInviteesService({
      meeting: baseMeeting({
        status: 'active',
        participants: [{ userId: 'u2', personId: null }],
      }),
    });

    const result = await svc.addInvitees(
      'm-1',
      [{ userId: 'u2', sendVia: ['telegram'] }],
      'u-host',
    );

    expect(result).toEqual({ added: 0, skipped: 1 });
    expect(participantCreate).not.toHaveBeenCalled();
  });

  it('host как invitee {userId:actor} → skipped, не создаётся', async () => {
    const { svc, participantCreate } = makeAddInviteesService({
      meeting: baseMeeting({ status: 'active', ownerId: 'u-host', participants: [] }),
    });

    const result = await svc.addInvitees(
      'm-1',
      [{ userId: 'u-host', sendVia: ['telegram'] }],
      'u-host',
    );

    expect(result).toEqual({ added: 0, skipped: 1 });
    expect(participantCreate).not.toHaveBeenCalled();
  });

  it('personId-дедуп: участник {personId:p2} уже есть → skipped', async () => {
    const { svc, participantCreate } = makeAddInviteesService({
      meeting: baseMeeting({
        status: 'active',
        participants: [{ userId: null, personId: 'p2' }],
      }),
    });

    const result = await svc.addInvitees('m-1', [{ personId: 'p2', sendVia: [] }], 'u-host');

    expect(result).toEqual({ added: 0, skipped: 1 });
    expect(participantCreate).not.toHaveBeenCalled();
  });
});
