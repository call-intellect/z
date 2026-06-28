import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import {
  NotAuthorizedError,
  ParticipantNotFoundError,
  ParticipantRenameForbiddenError,
} from '../../common/errors/domain-errors';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { JwtService } from '../auth/services/jwt.service';
import type { MeetingsBalanceService } from '../meetings-balance/meetings-balance.service';
import type { UsersService } from '../users/users.service';

import type { MeetingsRepository } from './meetings.repository';
import { MeetingsService } from './meetings.service';

interface ParticipantRow {
  id: string;
  meetingId: string;
  name: string;
  isRegisteredUser: boolean;
}

function makeService(args: {
  meetingHostUserId?: string | null;
  participantRow?: ParticipantRow | null;
}) {
  const participantFindFirst = vi.fn(async () => args.participantRow ?? null);
  const participantUpdate = vi.fn(
    async ({ where, data }: { where: { id: string }; data: { name: string } }) => ({
      id: where.id,
      meetingId: args.participantRow?.meetingId ?? 'm-1',
      name: data.name,
      isRegisteredUser: args.participantRow?.isRegisteredUser ?? false,
    }),
  );

  const prisma = {
    participant: {
      findFirst: participantFindFirst,
      update: participantUpdate,
    },
  } as unknown as PrismaService;

  const repository = {
    findByIdWithOwnerAndParticipants: vi.fn(async () =>
      args.meetingHostUserId === null
        ? null
        : {
            id: 'm-1',
            ownerId: args.meetingHostUserId ?? 'u-host',
            participants: [],
          },
    ),
  } as unknown as MeetingsRepository;

  const metrics = {
    incParticipantRenamed: vi.fn(),
  } as unknown as BusinessMetricsService;

  const svc = new MeetingsService(
    prisma,
    repository,
    {} as unknown as UsersService,
    {} as unknown as JwtService,
    {} as unknown as TypedConfigService,
    metrics,
    {} as unknown as MeetingsBalanceService,
    {} as never,
    {} as never,
    { assertCanView: vi.fn(async () => ({})) } as never,
    {} as never,
    {} as never,
  );

  return { svc, prisma, repository, metrics, participantFindFirst, participantUpdate };
}

describe('MeetingsService.renameParticipant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('хост переименовывает гостя → имя обновлено, метрика инкрементирована, trim применён', async () => {
    const { svc, metrics, participantUpdate } = makeService({
      meetingHostUserId: 'u-host',
      participantRow: {
        id: 'p-1',
        meetingId: 'm-1',
        name: 'Гость 1',
        isRegisteredUser: false,
      },
    });

    const result = await svc.renameParticipant({
      meetingId: 'm-1',
      participantId: 'p-1',
      newName: '  Иван Петров  ',
      actorUserId: 'u-host',
    });

    expect(result.name).toBe('Иван Петров');
    expect(participantUpdate).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: { name: 'Иван Петров' },
    });
    expect(metrics.incParticipantRenamed).toHaveBeenCalledTimes(1);
  });

  it('не хост → NotAuthorizedError (через getForUser), update НЕ вызывается', async () => {
    const { svc, participantUpdate, metrics } = makeService({
      meetingHostUserId: 'u-host',
      participantRow: {
        id: 'p-1',
        meetingId: 'm-1',
        name: 'Гость 1',
        isRegisteredUser: false,
      },
    });

    await expect(
      svc.renameParticipant({
        meetingId: 'm-1',
        participantId: 'p-1',
        newName: 'Х',
        actorUserId: 'u-stranger',
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
    expect(participantUpdate).not.toHaveBeenCalled();
    expect(metrics.incParticipantRenamed).not.toHaveBeenCalled();
  });

  it('participantId не найден → ParticipantNotFoundError', async () => {
    const { svc, participantUpdate } = makeService({
      meetingHostUserId: 'u-host',
      participantRow: null,
    });

    await expect(
      svc.renameParticipant({
        meetingId: 'm-1',
        participantId: 'p-nope',
        newName: 'Х',
        actorUserId: 'u-host',
      }),
    ).rejects.toBeInstanceOf(ParticipantNotFoundError);
    expect(participantUpdate).not.toHaveBeenCalled();
  });

  it('participantId из чужой встречи → findFirst по {id, meetingId} возвращает null → ParticipantNotFoundError', async () => {
    const { svc, participantFindFirst, participantUpdate } = makeService({
      meetingHostUserId: 'u-host',
      participantRow: null,
    });

    await expect(
      svc.renameParticipant({
        meetingId: 'm-1',
        participantId: 'p-from-other-meeting',
        newName: 'Х',
        actorUserId: 'u-host',
      }),
    ).rejects.toBeInstanceOf(ParticipantNotFoundError);

    expect(participantFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'p-from-other-meeting', meetingId: 'm-1' },
      }),
    );
    expect(participantUpdate).not.toHaveBeenCalled();
  });

  it('isRegisteredUser=true → ParticipantRenameForbiddenError', async () => {
    const { svc, participantUpdate, metrics } = makeService({
      meetingHostUserId: 'u-host',
      participantRow: {
        id: 'p-1',
        meetingId: 'm-1',
        name: 'Старое имя из User.name',
        isRegisteredUser: true,
      },
    });

    await expect(
      svc.renameParticipant({
        meetingId: 'm-1',
        participantId: 'p-1',
        newName: 'Что-то',
        actorUserId: 'u-host',
      }),
    ).rejects.toBeInstanceOf(ParticipantRenameForbiddenError);
    expect(participantUpdate).not.toHaveBeenCalled();
    expect(metrics.incParticipantRenamed).not.toHaveBeenCalled();
  });
});
