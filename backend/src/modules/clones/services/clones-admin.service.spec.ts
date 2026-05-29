/**
 * ТЗ 2026-05-26 §8.2 — unit-тесты ClonesAdminService.
 *
 * Кейсы (см. §8.2):
 *  - createAccessGrant happy path (создаёт + notification + DTO).
 *  - createAccessGrant — user не в org → 400 user_not_in_org.
 *  - createAccessGrant — cloneRef не существует → 404 role_not_found.
 *  - createAccessGrant — идемпотентность поверх active → возвращает существующий,
 *    БЕЗ повторного INSERT и notification.
 *  - createAccessGrant — re-grant поверх revoked → удаляет старую, создаёт новую.
 *  - revokeAccessGrant happy path → revokedAt/revokedBy выставлены.
 *  - revokeAccessGrant — already_revoked → 400.
 *  - revokeAccessGrant — not found → 404.
 *  - extendAccessGrant happy path + revoked → 400 cannot_update_revoked.
 *  - getMyCloneAccess — отдаёт только активные.
 *
 * PrismaService полностью замокан — нас интересует поведение веток.
 */
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import type { CloneAccessGrant } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ConversationalService } from '../../conversational/conversational.service';

import { ClonesAdminService } from './clones-admin.service';

/**
 * Минимальный фабричный билдер для CloneAccessGrant — поля, которых нет
 * в нашем сервисе, заполняем заглушками с типом `as unknown as`.
 */
function buildGrant(over: Partial<CloneAccessGrant> = {}): CloneAccessGrant {
  return {
    id: 'grant-1',
    tenantId: 'org-1',
    // audit Б3 (2026-05-29): added field on CloneAccessGrant.
    externalSource: null,
    grantedToUserId: 'user-recipient',
    cloneType: 'role',
    cloneRefId: 'role-1',
    grantedById: 'admin-1',
    grantedAt: new Date('2026-05-26T10:00:00.000Z'),
    revokedAt: null,
    revokedBy: null,
    expiresAt: null,
    ...over,
  };
}

interface BuildOpts {
  membership?: { id: string } | null;
  role?: { id: string } | null;
  person?: { id: string } | null;
  existingGrant?: CloneAccessGrant | null;
  createdGrant?: CloneAccessGrant;
  updatedGrant?: CloneAccessGrant;
  user?: { name: string } | null;
  persona?: { publicName: string | null } | null;
  /** Кастомный мок findFirst для cloneAccessGrant (например, для getMyCloneAccess). */
  findManyGrants?: Array<{ cloneType: string; cloneRefId: string }>;
  /** Мок sendNotification: throw → fall into try/catch. */
  notificationThrows?: boolean;
}

interface MockCtx {
  prisma: {
    membership: { findFirst: ReturnType<typeof vi.fn> };
    role: { findFirst: ReturnType<typeof vi.fn> };
    person: { findFirst: ReturnType<typeof vi.fn> };
    cloneAccessGrant: {
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
    };
    user: { findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
    executablePersona: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
  sendNotification: ReturnType<typeof vi.fn>;
}

function build(opts: BuildOpts = {}): {
  svc: ClonesAdminService;
  ctx: MockCtx;
} {
  // Внутренние помощники для transactional client.
  const createMock = vi.fn(async (_args: { data: Record<string, unknown> }) =>
    opts.createdGrant ?? buildGrant(),
  );
  const deleteMock = vi.fn(async (_args: { where: { id: string } }) =>
    buildGrant(),
  );

  // audit В15 (2026-05-29): re-grant теперь через UPDATE существующей row,
  // а не DELETE+CREATE. Mock'у нужен .update.
  const updateMock = vi.fn(async () => opts.updatedGrant ?? buildGrant());
  const txClient = {
    cloneAccessGrant: {
      create: createMock,
      delete: deleteMock,
      update: updateMock,
    },
  };

  const prisma = {
    membership: {
      findFirst: vi.fn(async () => opts.membership ?? null),
    },
    role: {
      findFirst: vi.fn(async () => opts.role ?? null),
      findMany: vi.fn(async () => []),
    },
    person: {
      findFirst: vi.fn(async () => opts.person ?? null),
      findMany: vi.fn(async () => []),
    },
    cloneAccessGrant: {
      findUnique: vi.fn(async () => opts.existingGrant ?? null),
      findFirst: vi.fn(async () => opts.existingGrant ?? null),
      findMany: vi.fn(async () => opts.findManyGrants ?? []),
      create: createMock,
      delete: deleteMock,
      update: vi.fn(async () => opts.updatedGrant ?? buildGrant()),
      count: vi.fn(async () => 0),
    },
    user: {
      findUnique: vi.fn(async () => opts.user ?? { name: 'admin name' }),
      findMany: vi.fn(async () => [
        { id: 'user-recipient', name: 'Получатель', email: 'r@x' },
        { id: 'admin-1', name: 'Админ', email: 'a@x' },
      ]),
    },
    executablePersona: {
      findFirst: vi.fn(async () => opts.persona ?? null),
      findMany: vi.fn(async () => []),
    },
    $transaction: vi.fn(async (fn: (tx: typeof txClient) => Promise<unknown>) =>
      fn(txClient),
    ),
  };

  const sendNotification = opts.notificationThrows
    ? vi.fn(async () => {
        throw new Error('notification down');
      })
    : vi.fn(async () => ({ id: 'notif-1' }));

  const conv = { sendNotification } as unknown as ConversationalService;
  const svc = new ClonesAdminService(prisma as unknown as PrismaService, conv);

  return {
    svc,
    ctx: { prisma, sendNotification },
  };
}

describe('ClonesAdminService.createAccessGrant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: создаёт грант, отправляет notification и возвращает DTO', async () => {
    const created = buildGrant({ id: 'grant-new' });
    const { svc, ctx } = build({
      membership: { id: 'm1' },
      role: { id: 'role-1' },
      createdGrant: created,
      persona: { publicName: 'Клон Маркетолога v3' },
    });

    const dto = await svc.createAccessGrant({
      tenantId: 'org-1',
      actorUserId: 'admin-1',
      dto: {
        grantedToUserId: 'user-recipient',
        cloneType: 'role',
        cloneRefId: 'role-1',
        expiresAt: null,
      },
    });

    // Проверки.
    expect(ctx.prisma.membership.findFirst).toHaveBeenCalledOnce();
    expect(ctx.prisma.role.findFirst).toHaveBeenCalledOnce();
    expect(ctx.prisma.cloneAccessGrant.findUnique).toHaveBeenCalledOnce();
    expect(ctx.prisma.$transaction).toHaveBeenCalledOnce();
    expect(ctx.sendNotification).toHaveBeenCalledOnce();
    const callArg = ctx.sendNotification.mock.calls[0]![0] as Record<string, unknown>;
    expect(callArg.eventType).toBe('clone.access_granted');
    expect(callArg.recipientUserId).toBe('user-recipient');
    expect(dto.id).toBe('grant-new');
    expect(dto.cloneType).toBe('role');
    expect(dto.isActive).toBe(true);
  });

  it('400 user_not_in_org — получатель не member', async () => {
    const { svc } = build({ membership: null, role: { id: 'role-1' } });
    await expect(
      svc.createAccessGrant({
        tenantId: 'org-1',
        actorUserId: 'admin-1',
        dto: {
          grantedToUserId: 'user-recipient',
          cloneType: 'role',
          cloneRefId: 'role-1',
          expiresAt: null,
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404 role_not_found — cloneRefId роль не существует', async () => {
    const { svc } = build({ membership: { id: 'm1' }, role: null });
    await expect(
      svc.createAccessGrant({
        tenantId: 'org-1',
        actorUserId: 'admin-1',
        dto: {
          grantedToUserId: 'user-recipient',
          cloneType: 'role',
          cloneRefId: 'role-missing',
          expiresAt: null,
        },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404 person_not_found — cloneType=person + Person не найден', async () => {
    const { svc } = build({ membership: { id: 'm1' }, person: null });
    await expect(
      svc.createAccessGrant({
        tenantId: 'org-1',
        actorUserId: 'admin-1',
        dto: {
          grantedToUserId: 'user-recipient',
          cloneType: 'person',
          cloneRefId: 'person-missing',
          expiresAt: null,
        },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('идемпотентность: active grant уже есть → возвращает его без повторного create / notification', async () => {
    const existing = buildGrant({ id: 'grant-old' });
    const { svc, ctx } = build({
      membership: { id: 'm1' },
      role: { id: 'role-1' },
      existingGrant: existing,
    });

    const dto = await svc.createAccessGrant({
      tenantId: 'org-1',
      actorUserId: 'admin-1',
      dto: {
        grantedToUserId: 'user-recipient',
        cloneType: 'role',
        cloneRefId: 'role-1',
        expiresAt: null,
      },
    });

    expect(dto.id).toBe('grant-old');
    // Транзакция и notification не должны вызываться.
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
    expect(ctx.sendNotification).not.toHaveBeenCalled();
  });

  it('audit В15: re-grant поверх revoked — UPDATE существующей row (id стабилен), без DELETE+CREATE', async () => {
    const revoked = buildGrant({
      id: 'grant-revoked',
      revokedAt: new Date('2026-05-25T00:00:00.000Z'),
      revokedBy: 'admin-x',
    });
    // updatedGrant — то, что возвращает tx.update; id сохраняется.
    const updated = buildGrant({ id: 'grant-revoked', revokedAt: null });
    const { svc, ctx } = build({
      membership: { id: 'm1' },
      role: { id: 'role-1' },
      existingGrant: revoked,
      updatedGrant: updated,
    });

    const dto = await svc.createAccessGrant({
      tenantId: 'org-1',
      actorUserId: 'admin-1',
      dto: {
        grantedToUserId: 'user-recipient',
        cloneType: 'role',
        cloneRefId: 'role-1',
        expiresAt: null,
      },
    });

    expect(dto.id).toBe('grant-revoked');
    expect(ctx.prisma.$transaction).toHaveBeenCalledOnce();
    // sendNotification — да, это считается новым выданным доступом.
    expect(ctx.sendNotification).toHaveBeenCalledOnce();
  });

  it('грант сохраняется, даже если notification упал (try/catch + warn)', async () => {
    const created = buildGrant({ id: 'grant-fresh' });
    const { svc } = build({
      membership: { id: 'm1' },
      role: { id: 'role-1' },
      createdGrant: created,
      notificationThrows: true,
    });

    const dto = await svc.createAccessGrant({
      tenantId: 'org-1',
      actorUserId: 'admin-1',
      dto: {
        grantedToUserId: 'user-recipient',
        cloneType: 'role',
        cloneRefId: 'role-1',
        expiresAt: null,
      },
    });

    expect(dto.id).toBe('grant-fresh');
  });
});

describe('ClonesAdminService.revokeAccessGrant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: выставляет revokedAt / revokedBy', async () => {
    const existing = buildGrant({ id: 'grant-1' });
    const updated = buildGrant({
      id: 'grant-1',
      revokedAt: new Date('2026-05-26T11:00:00.000Z'),
      revokedBy: 'admin-1',
    });
    const { svc, ctx } = build({ existingGrant: existing, updatedGrant: updated });

    const dto = await svc.revokeAccessGrant({
      tenantId: 'org-1',
      actorUserId: 'admin-1',
      id: 'grant-1',
    });

    expect(dto.revokedAt).not.toBeNull();
    expect(dto.isActive).toBe(false);
    expect(dto.inactiveReason).toBe('revoked');
    expect(ctx.prisma.cloneAccessGrant.update).toHaveBeenCalledOnce();
  });

  it('400 already_revoked — повторный revoke', async () => {
    const existing = buildGrant({
      id: 'grant-1',
      revokedAt: new Date('2026-05-25T00:00:00.000Z'),
      revokedBy: 'admin-x',
    });
    const { svc } = build({ existingGrant: existing });

    await expect(
      svc.revokeAccessGrant({
        tenantId: 'org-1',
        actorUserId: 'admin-1',
        id: 'grant-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404 not_found — гранта нет в этом тенанте', async () => {
    const { svc } = build({ existingGrant: null });
    await expect(
      svc.revokeAccessGrant({
        tenantId: 'org-1',
        actorUserId: 'admin-1',
        id: 'grant-missing',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ClonesAdminService.extendAccessGrant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: обновляет expiresAt', async () => {
    const existing = buildGrant({ id: 'grant-1' });
    const updated = buildGrant({
      id: 'grant-1',
      expiresAt: new Date('2026-12-31T00:00:00.000Z'),
    });
    const { svc } = build({ existingGrant: existing, updatedGrant: updated });

    const dto = await svc.extendAccessGrant({
      tenantId: 'org-1',
      id: 'grant-1',
      dto: { expiresAt: '2026-12-31T00:00:00.000Z' },
    });
    expect(dto.expiresAt).toBe('2026-12-31T00:00:00.000Z');
  });

  it('400 cannot_update_revoked — нельзя править отозванный', async () => {
    const existing = buildGrant({
      id: 'grant-1',
      revokedAt: new Date('2026-05-25T00:00:00.000Z'),
      revokedBy: 'admin-x',
    });
    const { svc } = build({ existingGrant: existing });

    await expect(
      svc.extendAccessGrant({
        tenantId: 'org-1',
        id: 'grant-1',
        dto: { expiresAt: null },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ClonesAdminService.getMyCloneAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('возвращает только активные id-ы (фильтр revoked/expired — на уровне where)', async () => {
    const { svc, ctx } = build({
      findManyGrants: [
        { cloneType: 'role', cloneRefId: 'role-1' },
        { cloneType: 'person', cloneRefId: 'person-2' },
        { cloneType: 'role', cloneRefId: 'role-3' },
      ],
    });

    const out = await svc.getMyCloneAccess({
      tenantId: 'org-1',
      userId: 'user-1',
    });

    expect(out.roleClones).toEqual(['role-1', 'role-3']);
    expect(out.personClones).toEqual(['person-2']);
    expect(out.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Проверяем что where содержит active-filter.
    const call = ctx.prisma.cloneAccessGrant.findMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
    };
    expect(call.where.revokedAt).toBeNull();
    expect(call.where.OR).toBeDefined();
  });
});
