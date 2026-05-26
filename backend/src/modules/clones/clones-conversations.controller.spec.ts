/**
 * ТЗ 2026-05-26 §2.7 (Волна 2C) — controller + service tests для
 * `GET /api/v1/clones/conversations`.
 *
 * Тестируем оба слоя:
 *   1) Controller-уровень: `ClonesController.listMyCloneConversations`
 *      делегирует в `ClonesService.listMyCloneConversations` с правильными
 *      аргументами и возвращает результат как есть; 400 при отсутствии
 *      tenantId (от `requireTenant`).
 *   2) Service-уровень: `ClonesService.listMyCloneConversations` — happy path
 *      с двумя диалогами; 403 при отсутствии активного гранта; 404 при
 *      несуществующем `cloneRefId`; cursor pagination (51 диалог, limit=50).
 *
 * Логика моков:
 *   - ChatV2Conversation хранит clone-диалоги со `scope='card'` +
 *     `scopeRefId=cloneRefId` (см. `createCloneConversation`).
 *   - У `ChatV2Conversation` нет `deletedAt`/`messageCount`/`lastMessageAt` —
 *     spec проверяет именно фактический маппинг сервиса (updatedAt →
 *     lastMessageAt, `_count.messages` → messageCount, фильтр `status='active'`).
 */

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import type { RbacService } from '../rbac/rbac.service';

import { ClonesController } from './clones.controller';
import type { CloneConversationsListResponseDto } from './dto/clone-conversations.dto';
import { ClonesService } from './services/clones.service';

const sampleUser: CurrentUserPayload = {
  id: 'u-1',
  email: 'member@z.test',
  role: 'user',
};

const TENANT_ID = 'tenant-1';
const ROLE_ID = 'role-cuid-1';
const PERSON_ID = 'person-cuid-1';

// ───────────────────────────── controller layer ─────────────────────────────

function buildController(opts: {
  serviceImpl?: Partial<ClonesService>;
} = {}) {
  const svc = {
    listMyCloneConversations: vi.fn(
      async (): Promise<CloneConversationsListResponseDto> => ({
        items: [
          {
            id: 'conv-1',
            title: 'Как готовить отчёт',
            lastMessageAt: '2026-05-20T10:00:00.000Z',
            messageCount: 5,
            createdAt: '2026-05-19T10:00:00.000Z',
          },
        ],
        nextCursor: null,
      }),
    ),
    ...opts.serviceImpl,
  } as unknown as ClonesService;
  const ctrl = new ClonesController(svc);
  return { ctrl, svc };
}

describe('ClonesController.listMyCloneConversations', () => {
  it('GET /clones/conversations — делегирует в сервис со всеми параметрами', async () => {
    const { ctrl, svc } = buildController();
    const out = await ctrl.listMyCloneConversations(
      { cloneType: 'role', cloneRefId: ROLE_ID, limit: 50 },
      sampleUser,
      TENANT_ID,
    );
    expect(svc.listMyCloneConversations).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      requesterUserId: 'u-1',
      cloneType: 'role',
      cloneRefId: ROLE_ID,
      limit: 50,
      cursor: undefined,
    });
    expect(out.items).toHaveLength(1);
    expect(out.nextCursor).toBeNull();
  });

  it('GET /clones/conversations — пробрасывает cursor', async () => {
    const { ctrl, svc } = buildController();
    await ctrl.listMyCloneConversations(
      {
        cloneType: 'person',
        cloneRefId: PERSON_ID,
        limit: 20,
        cursor: 'conv-cursor-x',
      },
      sampleUser,
      TENANT_ID,
    );
    const call = (svc.listMyCloneConversations as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    expect(call.cursor).toBe('conv-cursor-x');
    expect(call.cloneType).toBe('person');
    expect(call.limit).toBe(20);
  });

  it('GET /clones/conversations — 400 BadRequest если tenantId отсутствует', async () => {
    const { ctrl } = buildController();
    await expect(
      ctrl.listMyCloneConversations(
        { cloneType: 'role', cloneRefId: ROLE_ID, limit: 50 },
        sampleUser,
        undefined,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ───────────────────────────── service layer ─────────────────────────────

/**
 * Создаёт ClonesService с минимально достаточными мок-зависимостями.
 * Остальные ~10 dependency'ев — заглушки (метод не использует их в
 * `listMyCloneConversations`).
 */
function buildService(opts: {
  roleExists?: boolean;
  personExists?: boolean;
  hasAccess?: boolean;
  conversations?: Array<{
    id: string;
    title: string | null;
    updatedAt: Date;
    createdAt: Date;
    _count: { messages: number };
  }>;
  cloneV2Enabled?: boolean;
}) {
  const roleFindFirst = vi.fn(
    async () => (opts.roleExists !== false ? { id: ROLE_ID } : null),
  );
  const personFindFirst = vi.fn(
    async () => (opts.personExists !== false ? { id: PERSON_ID } : null),
  );
  const conversationFindMany = vi.fn(async () => opts.conversations ?? []);

  const prisma = {
    role: { findFirst: roleFindFirst },
    person: { findFirst: personFindFirst },
    chatV2Conversation: { findMany: conversationFindMany },
  } as unknown as PrismaService;

  const rbac = {
    canAccessPersonClone: vi.fn(async () => ({
      allowed: opts.hasAccess ?? true,
      relation: opts.hasAccess === false ? ('none' as const) : ('grant' as const),
    })),
    canAccessRoleClone: vi.fn(async () => ({
      allowed: opts.hasAccess ?? true,
      relation: opts.hasAccess === false ? ('none' as const) : ('grant' as const),
    })),
  } as unknown as RbacService;

  // cfg.cloneV2.enabled читается через `isCloneV2Enabled()` private —
  // дефолт true чтобы RBAC v2 ходил в `canAccessRoleClone`.
  const cfg = {
    cloneV2: { enabled: opts.cloneV2Enabled ?? true },
  } as unknown as TypedConfigService;

  // Остальные зависимости — undefined; метод их не трогает.
  const svc = new ClonesService(
    prisma,
    undefined as never,
    cfg,
    undefined as never,
    undefined as never,
    undefined as never,
    undefined as never,
    rbac,
    undefined as never,
    undefined as never,
  );
  return { svc, prisma, rbac, mocks: { roleFindFirst, personFindFirst, conversationFindMany } };
}

describe('ClonesService.listMyCloneConversations', () => {
  it('happy path: грант есть + 2 диалога → 200 + items=2 + nextCursor=null', async () => {
    const now = new Date('2026-05-20T10:00:00.000Z');
    const yesterday = new Date('2026-05-19T10:00:00.000Z');
    const { svc, mocks } = buildService({
      hasAccess: true,
      conversations: [
        {
          id: 'conv-1',
          title: 'Свежий диалог',
          updatedAt: now,
          createdAt: yesterday,
          _count: { messages: 7 },
        },
        {
          id: 'conv-2',
          title: null,
          updatedAt: yesterday,
          createdAt: yesterday,
          _count: { messages: 1 },
        },
      ],
    });

    const out = await svc.listMyCloneConversations({
      tenantId: TENANT_ID,
      requesterUserId: 'u-1',
      cloneType: 'role',
      cloneRefId: ROLE_ID,
      limit: 50,
    });

    expect(out.items).toHaveLength(2);
    expect(out.nextCursor).toBeNull();
    expect(out.items[0]).toEqual({
      id: 'conv-1',
      title: 'Свежий диалог',
      lastMessageAt: now.toISOString(),
      messageCount: 7,
      createdAt: yesterday.toISOString(),
    });
    expect(out.items[1]!.title).toBeNull();
    expect(out.items[1]!.messageCount).toBe(1);

    // findMany — проверяем фильтры и порядок (scope='card' + scopeRefId).
    expect(mocks.conversationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT_ID,
          userId: 'u-1',
          scope: 'card',
          scopeRefId: ROLE_ID,
          status: 'active',
        }),
        orderBy: { updatedAt: 'desc' },
        take: 51, // limit + 1
      }),
    );
  });

  it('403: нет активного гранта → ForbiddenException', async () => {
    const { svc } = buildService({ hasAccess: false });
    await expect(
      svc.listMyCloneConversations({
        tenantId: TENANT_ID,
        requesterUserId: 'u-1',
        cloneType: 'role',
        cloneRefId: ROLE_ID,
        limit: 50,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404: role не существует → NotFoundException (role_not_found)', async () => {
    const { svc } = buildService({ roleExists: false });
    await expect(
      svc.listMyCloneConversations({
        tenantId: TENANT_ID,
        requesterUserId: 'u-1',
        cloneType: 'role',
        cloneRefId: ROLE_ID,
        limit: 50,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404: person не существует → NotFoundException (person_not_found)', async () => {
    const { svc } = buildService({ personExists: false });
    await expect(
      svc.listMyCloneConversations({
        tenantId: TENANT_ID,
        requesterUserId: 'u-1',
        cloneType: 'person',
        cloneRefId: PERSON_ID,
        limit: 50,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('pagination: 51 диалог при limit=50 → items=50 + nextCursor=<last id>', async () => {
    const baseDate = new Date('2026-05-20T00:00:00.000Z').getTime();
    const conversations = Array.from({ length: 51 }, (_, i) => ({
      id: `conv-${i}`,
      title: `D${i}`,
      updatedAt: new Date(baseDate - i * 1000),
      createdAt: new Date(baseDate - i * 1000),
      _count: { messages: i },
    }));
    const { svc, mocks } = buildService({
      hasAccess: true,
      conversations,
    });

    const out = await svc.listMyCloneConversations({
      tenantId: TENANT_ID,
      requesterUserId: 'u-1',
      cloneType: 'role',
      cloneRefId: ROLE_ID,
      limit: 50,
    });

    expect(out.items).toHaveLength(50);
    expect(out.nextCursor).toBe('conv-49'); // последний из 50 (slice 0..49)
    // take должно быть limit + 1 = 51
    expect(mocks.conversationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 51 }),
    );
  });

  it('pagination: запрос с cursor добавляет cursor + skip:1', async () => {
    const { svc, mocks } = buildService({
      hasAccess: true,
      conversations: [],
    });
    await svc.listMyCloneConversations({
      tenantId: TENANT_ID,
      requesterUserId: 'u-1',
      cloneType: 'role',
      cloneRefId: ROLE_ID,
      limit: 50,
      cursor: 'conv-49',
    });
    expect(mocks.conversationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: 'conv-49' },
        skip: 1,
      }),
    );
  });
});
