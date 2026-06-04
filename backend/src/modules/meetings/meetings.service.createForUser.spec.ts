/**
 * meeting-identity-and-clones-attribution (2026-06-04, Фаза 2.1) — unit-тесты
 * для `MeetingsService.createForUser` в части pre-seed приглашённых.
 *
 * Покрытие:
 *   - invitees с {userId, sendVia:['email']} → создан Participant приглашённого
 *     с invitationStatus:'invited', truthy inviteToken, isRegisteredUser:true,
 *     userId:'u1', livekitIdentity начинается с 'invitee:'.
 *   - регресс: без invitees создаётся только host-participant (как раньше).
 *
 * Сеть/время не используются: $transaction/tx замоканы, nanoid реальный
 * (детерминированно truthy), Date реальный (значение не проверяем).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
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

  // tx: внутри транзакции вызываются user/person/org/membership/participant.
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
      // resolveDefaultTenant: владелец Org найден → tenant = 'org1'.
      findFirst: vi.fn(async () => ({ id: 'org1' })),
    },
    membership: { findFirst: vi.fn() },
    participant: { create: participantCreate },
  };

  const prisma = {
    // consumeMeetingFromBalance: возвращаем 0 membership'ов → ранний return.
    membership: { findMany: vi.fn(async () => []) },
    // side-effect онбординга после транзакции.
    org: { updateMany: vi.fn(async () => ({ count: 0 })) },
    $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<void>) => {
      await cb(tx);
    }),
  } as unknown as PrismaService;

  const repository = {
    // meetings.create возвращает «созданную» встречу.
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

  const svc = new MeetingsService(
    prisma,
    repository,
    {} as unknown as UsersService,
    {} as unknown as JwtService,
    {} as unknown as TypedConfigService,
    metrics,
    balance,
  );

  return { svc, prisma, repository, metrics, tx, participantCreate };
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

    // 2 вызова: host + приглашённый.
    expect(participantCreate).toHaveBeenCalledTimes(2);

    // Находим вызов для приглашённого (role:'guest').
    const inviteeCall = participantCreate.mock.calls.find(
      ([arg]) => arg.data.role === 'guest',
    );
    expect(inviteeCall).toBeTruthy();
    const data = inviteeCall![0].data;

    expect(data.invitationStatus).toBe('invited');
    expect(data.inviteToken).toBeTruthy();
    expect(typeof data.inviteToken).toBe('string');
    expect(data.isRegisteredUser).toBe(true);
    expect(data.userId).toBe('u1');
    expect(data.personId).toBeNull();
    expect(data.livekitIdentity.startsWith('invitee:')).toBe(true);
    // livekitIdentity несёт inviteToken (совместимость с Ф0.4 joinAsInvited).
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

    // Только host-participant, приглашённый-дубль не создан.
    expect(participantCreate).toHaveBeenCalledTimes(1);
    expect(participantCreate.mock.calls[0]![0].data.role).toBe('host');
  });
});
