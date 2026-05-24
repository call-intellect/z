/**
 * Controller-level integration тест для FeedController (Wave 2 Поток D).
 *
 * Не поднимает full NestJS-app (без БД), но создаёт контроллер с
 * мокнутыми зависимостями и проверяет, что:
 *   - GET /api/v1/feed — делегирует svc.getFeed с tenantId, userId и
 *     загруженным userTeamIds / userRoleIds через loadUserScope.
 *   - POST /api/v1/feed/:id/react — делегирует svc.react с userId и body.
 *   - POST /api/v1/feed/:id/dismiss — делегирует svc.dismiss.
 *   - Tenant_required — BadRequest, если X-Org-Id не определён.
 *   - Forbidden — если RbacService.canRead вернул false.
 */

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RbacService } from '../../rbac/rbac.service';
import type { ActivityFeedService } from '../services/activity-feed.service';
import type {
  FeedItemDto,
  ListFeedQuery,
  ReactBody,
} from '../dto/activity-feed.dto';

import { FeedController } from './feed.controller';

const sampleUser: CurrentUserPayload = {
  id: 'u-1',
  email: 'employee@z.test',
  role: 'user',
};

function makeDto(over: Partial<FeedItemDto> = {}): FeedItemDto {
  return {
    id: 'i-1',
    tenantId: 't-1',
    feedType: 'insight',
    sourceType: 'ai_agent',
    sourceAgentName: 'insights_radar',
    sourceUserId: null,
    relatedEntityType: null,
    relatedEntityId: null,
    title: 'Test',
    summary: null,
    iconType: null,
    severity: 'normal',
    status: 'emitted',
    visibility: 'public_org',
    visibilityScope: null,
    targetUserId: null,
    targetChannel: null,
    teamId: null,
    projectId: null,
    goalId: null,
    reactions: { thanks: [], votes: [] },
    expiresAt: null,
    emittedAt: '2026-05-24T10:00:00.000Z',
    deliveredAt: null,
    seenAt: null,
    respondedAt: null,
    actionedAt: null,
    ...over,
  };
}

function build(opts: { canRead?: boolean } = {}) {
  const svc = {
    getFeed: vi.fn(async () => ({
      items: [makeDto()],
      total: 1,
      page: 1,
      limit: 50,
      totalPages: 1,
    })),
    react: vi.fn(async () =>
      makeDto({ reactions: { thanks: ['u-1'], votes: [] } }),
    ),
    markSeen: vi.fn(async () => makeDto({ status: 'seen' })),
    markResponded: vi.fn(async () => makeDto({ status: 'responded' })),
    dismiss: vi.fn(async () => makeDto({ status: 'dismissed' })),
  } as unknown as ActivityFeedService;

  const rbac = {
    canRead: vi.fn(async () => opts.canRead ?? true),
    canWrite: vi.fn(async () => true),
  } as unknown as RbacService;

  const prisma = {
    membership: {
      findMany: vi.fn(async () => [{ role: 'manager' }]),
    },
    appointment: {
      findMany: vi.fn(async () => [{ departmentId: 'dep-1' }]),
    },
  } as unknown as PrismaService;

  const ctrl = new FeedController(svc, rbac, prisma);
  return { ctrl, svc, rbac, prisma };
}

const baseQuery: ListFeedQuery = {
  scopedToMe: true,
  page: 1,
  limit: 50,
};

describe('FeedController', () => {
  it('GET /api/v1/feed — делегирует getFeed с userTeamIds и userRoleIds', async () => {
    const { ctrl, svc } = build();
    const out = await ctrl.listAll(baseQuery, sampleUser, 't-1');
    expect(svc.getFeed).toHaveBeenCalledWith({
      tenantId: 't-1',
      userId: 'u-1',
      userTeamIds: ['dep-1'],
      userRoleIds: ['manager'],
      query: baseQuery,
    });
    expect(out.items).toHaveLength(1);
  });

  it('GET /api/v1/feed/:type — добавляет feedType в query', async () => {
    const { ctrl, svc } = build();
    await ctrl.listByType('insight', baseQuery, sampleUser, 't-1');
    const call = (svc.getFeed as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.query.feedType).toBe('insight');
  });

  it('GET /api/v1/feed/:type — невалидный тип → BadRequest', async () => {
    const { ctrl } = build();
    await expect(
      ctrl.listByType('not-a-type', baseQuery, sampleUser, 't-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('POST /api/v1/feed/:id/react — пробрасывает userId и reaction в сервис', async () => {
    const { ctrl, svc } = build();
    const body: ReactBody = { reaction: 'thanks' };
    const out = await ctrl.react('i-1', body, sampleUser, 't-1');
    expect(svc.react).toHaveBeenCalledWith({
      tenantId: 't-1',
      itemId: 'i-1',
      userId: 'u-1',
      reaction: 'thanks',
    });
    expect(out.ok).toBe(true);
    expect(out.item.reactions.thanks).toEqual(['u-1']);
  });

  it('POST /api/v1/feed/:id/dismiss — делегирует svc.dismiss с userId', async () => {
    const { ctrl, svc } = build();
    const out = await ctrl.dismiss('i-1', sampleUser, 't-1');
    expect(svc.dismiss).toHaveBeenCalledWith({
      tenantId: 't-1',
      itemId: 'i-1',
      userId: 'u-1',
    });
    expect(out.item.status).toBe('dismissed');
  });

  it('Tenant_required — если CurrentOrg возвращает undefined', async () => {
    const { ctrl } = build();
    await expect(
      ctrl.listAll(baseQuery, sampleUser, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('Forbidden — если RbacService.canRead вернул false', async () => {
    const { ctrl } = build({ canRead: false });
    await expect(
      ctrl.listAll(baseQuery, sampleUser, 't-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
