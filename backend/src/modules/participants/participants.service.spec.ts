import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { JwtService } from '../auth/services/jwt.service';
import type { LivekitService } from '../livekit/livekit.service';

import { ParticipantsService } from './participants.service';

const MEETING_ID = 'm1';

describe('ParticipantsService.join', () => {
  let prisma: {
    meeting: { findUnique: ReturnType<typeof vi.fn> };
    participant: {
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    person: { findMany: ReturnType<typeof vi.fn> };
    user: { findUnique: ReturnType<typeof vi.fn> };
  };
  let jwt: {
    signGuestSession: ReturnType<typeof vi.fn>;
    verifyGuestSession: ReturnType<typeof vi.fn>;
    guestSessionTtlSeconds: number;
  };
  let livekit: {
    ensureRoom: ReturnType<typeof vi.fn>;
    generateGuestToken: ReturnType<typeof vi.fn>;
    generateHostToken: ReturnType<typeof vi.fn>;
  };
  let cfg: TypedConfigService;

  beforeEach(() => {
    prisma = {
      meeting: {
        findUnique: vi.fn(async () => ({
          id: MEETING_ID,
          ownerId: 'owner1',
          status: 'active',
          endedAt: null,
        })),
      },
      participant: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
          id: 'new-guest',
          ...args.data,
        })),
        update: vi.fn(async (args: { data: Record<string, unknown> }) => ({ ...args.data })),
      },
      person: { findMany: vi.fn(async () => []) },
      user: { findUnique: vi.fn() },
    };
    jwt = {
      signGuestSession: vi.fn(() => 'guest-cookie-jwt'),
      verifyGuestSession: vi.fn(),
      guestSessionTtlSeconds: 86_400,
    };
    livekit = {
      ensureRoom: vi.fn(async () => null),
      generateGuestToken: vi.fn(async () => 'guest-token'),
      generateHostToken: vi.fn(async () => 'host-token'),
    };
    cfg = {
      livekit: { apiUrl: 'wss://livekit.example' },
    } as unknown as TypedConfigService;
  });

  function make(): ParticipantsService {
    return new ParticipantsService(
      prisma as unknown as PrismaService,
      jwt as unknown as JwtService,
      cfg,
      livekit as unknown as LivekitService,
    );
  }

  it('inviteToken: переиспользует pre-seeded Participant, не создаёт нового, ставит joined+joinedAt', async () => {
    prisma.participant.findUnique.mockResolvedValueOnce({
      id: 'p1',
      inviteToken: 't1',
      userId: 'u1',
      invitationStatus: 'invited',
      livekitIdentity: 'invitee:p1',
      name: 'Приглашённый',
      role: 'guest',
      meetingId: MEETING_ID,
    });

    const svc = make();
    const result = await svc.join({
      meetingId: MEETING_ID,
      userId: null,
      guestName: null,
      existingGuestCookie: null,
      inviteToken: 't1',
    });

    expect(prisma.participant.findUnique).toHaveBeenCalledWith({
      where: { inviteToken: 't1' },
    });
    expect(prisma.participant.create).not.toHaveBeenCalled();
    expect(prisma.participant.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { invitationStatus: 'joined', joinedAt: expect.any(Date) },
    });
    expect(result.livekitIdentity).toBe('invitee:p1');
    expect(result.participantId).toBe('p1');
    expect(result.livekit.token).toBe('guest-token');
    // Приглашённый заходит без новой guest-cookie.
    expect(result.guestSessionCookie).toBeUndefined();
  });

  it('inviteToken чужой встречи: не падаем, проваливаемся в обычный guest-флоу', async () => {
    prisma.participant.findUnique.mockResolvedValueOnce({
      id: 'p9',
      inviteToken: 't1',
      livekitIdentity: 'invitee:p9',
      name: 'Чужой',
      role: 'guest',
      meetingId: 'other-meeting',
    });

    const svc = make();
    const result = await svc.join({
      meetingId: MEETING_ID,
      userId: null,
      guestName: 'Гость',
      existingGuestCookie: null,
      inviteToken: 't1',
    });

    expect(prisma.participant.create).toHaveBeenCalledTimes(1);
    expect(result.role).toBe('guest');
    expect(result.livekitIdentity).toMatch(/^guest:/);
  });

  it('регресс: без inviteToken и без cookie с именем — создаётся новый guest как раньше', async () => {
    const svc = make();
    const result = await svc.join({
      meetingId: MEETING_ID,
      userId: null,
      guestName: 'Гость',
      existingGuestCookie: null,
      inviteToken: null,
    });

    expect(prisma.participant.findUnique).not.toHaveBeenCalled();
    expect(prisma.participant.create).toHaveBeenCalledTimes(1);
    const created = prisma.participant.create.mock.calls[0]?.[0] as {
      data: { role: string; livekitIdentity: string; name: string };
    };
    expect(created.data.role).toBe('guest');
    expect(created.data.name).toBe('Гость');
    expect(created.data.livekitIdentity).toMatch(/^guest:/);
    expect(result.role).toBe('guest');
    expect(result.guestSessionCookie).toBeDefined();
    expect(result.guestSessionCookie?.value).toBe('guest-cookie-jwt');
  });

  it('дедуп по personId: залогинен, pre-seed по personId (userId=null), вход без inviteToken → переиспущает строку, не плодит guest', async () => {
    // meeting с tenantId
    prisma.meeting.findUnique.mockResolvedValue({
      id: MEETING_ID, ownerId: 'owner1', status: 'active', endedAt: null, tenantId: 'org1',
    });
    // user u1 связан с Person pers1
    prisma.person.findMany.mockResolvedValueOnce([{ id: 'pers1' }]);
    // pre-seed invited по personId (userId null)
    prisma.participant.findFirst.mockResolvedValueOnce({
      id: 'p-inv', personId: 'pers1', userId: null, invitationStatus: 'invited',
      livekitIdentity: 'invitee:tok', name: 'Сотрудник', role: 'guest', meetingId: MEETING_ID,
    });

    const svc = make();
    const result = await svc.join({
      meetingId: MEETING_ID, userId: 'u1', guestName: 'Сотрудник',
      existingGuestCookie: null, inviteToken: null,
    });

    expect(result.participantId).toBe('p-inv');
    expect(prisma.participant.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ invitationStatus: 'joined' }) }),
    );
    expect(prisma.participant.create).not.toHaveBeenCalled(); // дубль не создан
  });

  it('нет pre-seed ни по userId, ни по personId → joinAsGuest создаёт нового', async () => {
    prisma.meeting.findUnique.mockResolvedValue({
      id: MEETING_ID, ownerId: 'owner1', status: 'active', endedAt: null, tenantId: 'org1',
    });
    prisma.person.findMany.mockResolvedValueOnce([]);
    prisma.participant.findFirst.mockResolvedValueOnce(null);

    const svc = make();
    await svc.join({
      meetingId: MEETING_ID, userId: 'u2', guestName: 'Гость',
      existingGuestCookie: null, inviteToken: null,
    });
    expect(prisma.participant.create).toHaveBeenCalled();
  });
});
