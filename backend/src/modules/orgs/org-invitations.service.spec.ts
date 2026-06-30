import { ConflictException, NotFoundException } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import argon2 from 'argon2';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { PasswordService } from '../accounts/password.service';
import type { ConversationalLinkCodeService } from '../conversational/link-code.service';
import type { MailService } from '../mail/mail.service';
import type { RbacService } from '../rbac/rbac.service';

import { OrgInvitationsService } from './org-invitations.service';

const cfg: TypedConfigService = {
  auth: { publicFrontendUrl: 'https://kora.app' },
  invites: {
    botUsername: 'kora_bot',
    ttlDays: 14,
    reminderDays: 7,
    magicLinkTtlMinutes: 15,
    magicLinkRateLimitPerHour: 5,
    inactiveBindingDays: 30,
  },
  argon: { memoryKb: 8, iterations: 1, parallelism: 1 },
} as unknown as TypedConfigService;

describe('OrgInvitationsService (β-9)', () => {
  let prisma: {
    orgInvitation: {
      findFirst: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    user: { findFirst: ReturnType<typeof vi.fn> };
    membership: {
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
    person: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    channelBinding: { deleteMany: ReturnType<typeof vi.fn> };
    org: { updateMany: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let mail: {
    sendInviteWithCredentials: ReturnType<typeof vi.fn>;
    sendInviteNotification: ReturnType<typeof vi.fn>;
    sendInviteReminder: ReturnType<typeof vi.fn>;
    sendInviteDirectorTimeout: ReturnType<typeof vi.fn>;
  };
  let rbac: {
    loadContext: ReturnType<typeof vi.fn>;
    invalidate: ReturnType<typeof vi.fn>;
  };
  let linkCodes: { generateInviteCode: ReturnType<typeof vi.fn> };
  let metrics: {
    incInviteCreated: ReturnType<typeof vi.fn>;
    incInviteAccepted: ReturnType<typeof vi.fn>;
    incInviteExpired: ReturnType<typeof vi.fn>;
    incInviteReminderSent: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    prisma = {
      orgInvitation: {
        findFirst: vi.fn(async () => null),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(async () => ({})),
        findMany: vi.fn(async () => []),
      },
      user: { findFirst: vi.fn(async () => null) },
      membership: {
        findUnique: vi.fn(async () => null),
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({
          role: 'manager',
          joinedAt: new Date('2026-05-25'),
        })),
      },
      person: { findUnique: vi.fn(), update: vi.fn() },
      channelBinding: { deleteMany: vi.fn(async () => ({ count: 0 })) },
      org: { updateMany: vi.fn(async () => ({ count: 1 })) },
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
    };
    mail = {
      sendInviteWithCredentials: vi.fn(async () => ({ ok: true })),
      sendInviteNotification: vi.fn(async () => ({ ok: true })),
      sendInviteReminder: vi.fn(async () => ({ ok: true })),
      sendInviteDirectorTimeout: vi.fn(async () => ({ ok: true })),
    };
    rbac = {
      loadContext: vi.fn(async () => ({ role: 'owner', isSuperAdmin: false })),
      invalidate: vi.fn(),
    };
    linkCodes = {
      generateInviteCode: vi.fn(async () => ({ code: 'abcd1234abcd1234', ttlSec: 14 * 86_400 })),
    };
    metrics = {
      incInviteCreated: vi.fn(),
      incInviteAccepted: vi.fn(),
      incInviteExpired: vi.fn(),
      incInviteReminderSent: vi.fn(),
    };
  });

  function make(): OrgInvitationsService {
    return new OrgInvitationsService(
      prisma as unknown as PrismaService,
      mail as unknown as MailService,
      rbac as unknown as RbacService,
      cfg,
      linkCodes as unknown as ConversationalLinkCodeService,
      metrics as unknown as BusinessMetricsService,
      { emit: vi.fn() } as unknown as EventEmitter2,
      new PasswordService(cfg),
    );
  }

  describe('createInvitation', () => {
    it('создаёт приглашение без email (manualShareUrl + linkCode)', async () => {
      prisma.orgInvitation.create.mockResolvedValue({
        id: 'inv-1',
        orgId: 'org-1',
        email: null,
        role: 'manager',
        status: 'pending',
        invitedBy: 'u-actor',
        createdAt: new Date('2026-05-25'),
        expiresAt: new Date('2026-06-08'),
        acceptedAt: null,
        org: { name: 'ООО Ромашка' },
        inviter: { name: 'Иван' },
      });

      const svc = make();
      const result = await svc.createInvitation({
        orgId: 'org-1',
        actorUserId: 'u-actor',
        email: null,
        name: 'Линейный сотрудник',
        role: 'manager',
      });

      expect(result.email).toBeNull();
      expect(result.linkCode).toBe('abcd1234abcd1234');
      expect(result.magicLinkUrl).toMatch(/^https:\/\/kora\.app\/invite\/[\w-]+$/);
      expect(result.telegramDeepLink).toBe('https://t.me/kora_bot?start=abcd1234abcd1234');
      expect(result.manualShareUrl).toBe(result.magicLinkUrl);
      expect(mail.sendInviteWithCredentials).not.toHaveBeenCalled();
      expect(metrics.incInviteCreated).toHaveBeenCalledWith({ hasEmail: false });
    });

    it('создаёт приглашение с email и шлёт письмо', async () => {
      prisma.orgInvitation.create.mockResolvedValue({
        id: 'inv-2',
        orgId: 'org-1',
        email: 'ivan@example.com',
        role: 'manager',
        status: 'pending',
        invitedBy: 'u-actor',
        createdAt: new Date('2026-05-25'),
        expiresAt: new Date('2026-06-08'),
        acceptedAt: null,
        org: { name: 'ООО Ромашка' },
        inviter: { name: 'Иван' },
      });

      const svc = make();
      const result = await svc.createInvitation({
        orgId: 'org-1',
        actorUserId: 'u-actor',
        email: 'Ivan@Example.com',
        role: 'manager',
      });

      expect(result.email).toBe('ivan@example.com');
      expect(mail.sendInviteWithCredentials).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'ivan@example.com',
          orgName: 'ООО Ромашка',
          inviterName: 'Иван',
          loginEmail: 'ivan@example.com',
          ttlDays: 14,
        }),
      );
      const createCall = prisma.orgInvitation.create.mock.calls[0]?.[0] as
        | { data: { tempPasswordHash: string | null } }
        | undefined;
      const stored = createCall?.data.tempPasswordHash;
      expect(stored).toMatch(/^\$argon2id\$/);
      const mailCall = mail.sendInviteWithCredentials.mock.calls[0]?.[0] as
        | { tempPassword: string }
        | undefined;
      const sentPassword = mailCall?.tempPassword ?? '';
      expect(sentPassword.length).toBeGreaterThanOrEqual(20);
      expect(await argon2.verify(stored as string, sentPassword)).toBe(true);
      expect(metrics.incInviteCreated).toHaveBeenCalledWith({ hasEmail: true });
    });

    it('пользователь уже существует → НЕ генерит пароль, шлёт уведомление', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u-existing', name: 'Айназ' });
      prisma.orgInvitation.create.mockResolvedValue({
        id: 'inv-x',
        orgId: 'org-1',
        email: 'ainaz@example.com',
        role: 'manager',
        status: 'pending',
        invitedBy: 'u-actor',
        createdAt: new Date('2026-06-30'),
        expiresAt: new Date('2026-07-14'),
        acceptedAt: null,
        org: { name: 'ООО Ромашка' },
        inviter: { name: 'Иван' },
      });

      const svc = make();
      const result = await svc.createInvitation({
        orgId: 'org-1',
        actorUserId: 'u-actor',
        email: 'Ainaz@Example.com',
        role: 'manager',
      });

      expect(result.email).toBe('ainaz@example.com');
      expect(mail.sendInviteNotification).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'ainaz@example.com', name: 'Айназ', orgName: 'ООО Ромашка' }),
      );
      expect(mail.sendInviteWithCredentials).not.toHaveBeenCalled();
      const createCall = prisma.orgInvitation.create.mock.calls[0]?.[0] as
        | { data: { tempPasswordHash: string | null } }
        | undefined;
      expect(createCall?.data.tempPasswordHash).toBeNull();
    });

    it('пользователь уже состоит в компании → Conflict (already_member)', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'u-existing', name: 'Айназ' });
      prisma.membership.findUnique.mockResolvedValueOnce({ id: 'mem-1' });
      const svc = make();
      await expect(
        svc.createInvitation({
          orgId: 'org-1',
          actorUserId: 'u-actor',
          email: 'ainaz@example.com',
          role: 'manager',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.orgInvitation.create).not.toHaveBeenCalled();
    });

    it('owner/admin only — manager-у запрещено', async () => {
      rbac.loadContext.mockResolvedValueOnce({ role: 'manager', isSuperAdmin: false });
      const svc = make();
      await expect(
        svc.createInvitation({
          orgId: 'org-1',
          actorUserId: 'u-manager',
          email: 'x@y.com',
          role: 'manager',
        }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('по personId: берёт email/имя из карточки и сохраняет personId', async () => {
      prisma.person.findUnique.mockResolvedValue({
        tenantId: 'org-1',
        deletedAt: null,
        userId: null,
        email: 'Petr@Example.com',
        name: 'Пётр Петров',
      });
      prisma.orgInvitation.create.mockResolvedValue({
        id: 'inv-p',
        orgId: 'org-1',
        email: 'petr@example.com',
        role: 'manager',
        status: 'pending',
        invitedBy: 'u-actor',
        createdAt: new Date('2026-06-03'),
        expiresAt: new Date('2026-06-17'),
        acceptedAt: null,
        org: { name: 'ООО Ромашка' },
        inviter: { name: 'Иван' },
      });

      const svc = make();
      const result = await svc.createInvitation({
        orgId: 'org-1',
        actorUserId: 'u-actor',
        role: 'manager',
        personId: 'p-1',
      });

      expect(result.email).toBe('petr@example.com');
      expect(prisma.orgInvitation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            personId: 'p-1',
            email: 'petr@example.com',
          }),
        }),
      );
    });

    it('по personId: отклоняет карточку из чужой Org (400)', async () => {
      prisma.person.findUnique.mockResolvedValue({
        tenantId: 'org-2',
        deletedAt: null,
        userId: null,
        email: 'x@y.com',
        name: 'Чужой',
      });
      const svc = make();
      await expect(
        svc.createInvitation({
          orgId: 'org-1',
          actorUserId: 'u-actor',
          role: 'manager',
          personId: 'p-foreign',
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(prisma.orgInvitation.create).not.toHaveBeenCalled();
    });

    it('по personId: отклоняет несуществующую карточку (400)', async () => {
      prisma.person.findUnique.mockResolvedValue(null);
      const svc = make();
      await expect(
        svc.createInvitation({
          orgId: 'org-1',
          actorUserId: 'u-actor',
          role: 'manager',
          personId: 'p-missing',
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('по personId: дедуп — повторное приглашение тому же сотруднику → Conflict', async () => {
      prisma.person.findUnique.mockResolvedValue({
        tenantId: 'org-1',
        deletedAt: null,
        userId: null,
        email: null,
        name: 'Линейный без почты',
      });
      prisma.orgInvitation.findFirst.mockResolvedValueOnce({ id: 'inv-existing' });
      const svc = make();
      await expect(
        svc.createInvitation({
          orgId: 'org-1',
          actorUserId: 'u-actor',
          role: 'manager',
          personId: 'p-1',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.orgInvitation.create).not.toHaveBeenCalled();
    });
  });

  describe('acceptViaMagicLink', () => {
    const futureExpire = new Date(Date.now() + 7 * 86_400_000);

    it('успешный путь: создаёт User+Membership, выдаёт сессию', async () => {
      prisma.orgInvitation.findUnique.mockResolvedValue({
        id: 'inv-1',
        orgId: 'org-1',
        email: 'ivan@example.com',
        role: 'manager',
        status: 'pending',
        invitedBy: 'u-actor',
        expiresAt: futureExpire,
        magicTokenUsedAt: null,
        magicTokenHash: 'hash',
        personId: null,
        org: { id: 'org-1', name: 'ООО Ромашка' },
      });

      const svc = make();
      const upsertUserByEmail = vi.fn(async () => ({
        id: 'u-new',
        email: 'ivan@example.com',
        role: 'user' as const,
      }));
      const createUserWithoutEmail = vi.fn();
      const issueSession = vi.fn(async () => ({ token: 'jwt-token' }));

      const result = await svc.acceptViaMagicLink({
        magicToken: 'raw-token',
        issueSession,
        upsertUserByEmail,
        createUserWithoutEmail,
      });

      expect(result.userId).toBe('u-new');
      expect(result.orgId).toBe('org-1');
      expect(result.sessionToken).toBe('jwt-token');
      expect(upsertUserByEmail).toHaveBeenCalledWith({
        email: 'ivan@example.com',
        name: 'ivan',
      });
      expect(createUserWithoutEmail).not.toHaveBeenCalled();
      expect(prisma.membership.create).toHaveBeenCalled();
      expect(metrics.incInviteAccepted).toHaveBeenCalledWith({ path: 'magic_link' });
    });

    it('без email: создаёт «безпочтового» User', async () => {
      prisma.orgInvitation.findUnique.mockResolvedValue({
        id: 'inv-1',
        orgId: 'org-1',
        email: null,
        role: 'manager',
        status: 'pending',
        invitedBy: 'u-actor',
        expiresAt: futureExpire,
        magicTokenUsedAt: null,
        magicTokenHash: 'hash',
        personId: null,
        org: { id: 'org-1', name: 'ООО Ромашка' },
      });

      const svc = make();
      const createUserWithoutEmail = vi.fn(async () => ({
        id: 'u-without-email',
        email: '',
        role: 'user' as const,
      }));
      const upsertUserByEmail = vi.fn();

      await svc.acceptViaMagicLink({
        magicToken: 'raw-token',
        issueSession: vi.fn(async () => ({ token: 'jwt' })),
        upsertUserByEmail,
        createUserWithoutEmail,
      });

      expect(createUserWithoutEmail).toHaveBeenCalledWith({ name: 'Сотрудник' });
      expect(upsertUserByEmail).not.toHaveBeenCalled();
    });

    it('multi-org: вступает в новую Org, даже если уже состоит в другой', async () => {
      prisma.orgInvitation.findUnique.mockResolvedValue({
        id: 'inv-1',
        orgId: 'org-1',
        email: 'ivan@example.com',
        role: 'manager',
        status: 'pending',
        invitedBy: 'u-actor',
        expiresAt: futureExpire,
        magicTokenUsedAt: null,
        magicTokenHash: 'hash',
        personId: null,
        org: { id: 'org-1', name: 'Новая Org' },
      });
      prisma.membership.findFirst.mockResolvedValueOnce({
        orgId: 'org-old',
        userId: 'u-existing',
        org: { name: 'Старая Org' },
      });

      const svc = make();
      const upsertUserByEmail = vi.fn(async () => ({
        id: 'u-existing',
        email: 'ivan@example.com',
        role: 'user' as const,
      }));
      const issueSession = vi.fn(async () => ({ token: 'jwt-multi' }));

      const result = await svc.acceptViaMagicLink({
        magicToken: 'raw',
        issueSession,
        upsertUserByEmail,
        createUserWithoutEmail: vi.fn(),
      });

      expect(result.orgId).toBe('org-1');
      expect(result.sessionToken).toBe('jwt-multi');
      expect(prisma.membership.create).toHaveBeenCalled();
    });

    it('NotFound для несуществующего magic-token', async () => {
      prisma.orgInvitation.findUnique.mockResolvedValue(null);
      const svc = make();
      await expect(
        svc.acceptViaMagicLink({
          magicToken: 'never-was',
          issueSession: vi.fn(),
          upsertUserByEmail: vi.fn(),
          createUserWithoutEmail: vi.fn(),
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('acceptViaPassword', () => {
    const futureExpire = new Date(Date.now() + 7 * 86_400_000);

    async function makeCandidate(
      password: string,
      over: Record<string, unknown> = {},
    ): Promise<Record<string, unknown>> {
      const tempPasswordHash = await new PasswordService(cfg).hash(password);
      return {
        id: 'inv-1',
        orgId: 'org-1',
        email: 'new@example.com',
        role: 'manager',
        status: 'pending',
        invitedBy: 'u-actor',
        expiresAt: futureExpire,
        tempPasswordHash,
        personId: null,
        ...over,
      };
    }

    it('верный temp-пароль → провижинит User+Membership, выдаёт сессию', async () => {
      prisma.orgInvitation.findMany.mockResolvedValue([await makeCandidate('temp-pw')]);
      const svc = make();
      const upsertUserByEmail = vi.fn(async () => ({
        id: 'u-new',
        email: 'new@example.com',
        role: 'user' as const,
      }));
      const issueSession = vi.fn(async () => ({ token: 'jwt-pw' }));

      const result = await svc.acceptViaPassword({
        email: 'New@Example.com',
        password: 'temp-pw',
        upsertUserByEmail,
        issueSession,
      });

      expect(result?.sessionToken).toBe('jwt-pw');
      expect(result?.orgId).toBe('org-1');
      expect(upsertUserByEmail).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'new@example.com' }),
      );
      expect(prisma.membership.create).toHaveBeenCalled();
      expect(metrics.incInviteAccepted).toHaveBeenCalledWith({ path: 'password' });
    });

    it('неверный пароль → null, ничего не провижинит', async () => {
      prisma.orgInvitation.findMany.mockResolvedValue([await makeCandidate('temp-pw')]);
      const svc = make();
      const upsertUserByEmail = vi.fn();

      const result = await svc.acceptViaPassword({
        email: 'new@example.com',
        password: 'WRONG',
        upsertUserByEmail,
        issueSession: vi.fn(),
      });

      expect(result).toBeNull();
      expect(upsertUserByEmail).not.toHaveBeenCalled();
      expect(prisma.membership.create).not.toHaveBeenCalled();
    });

    it('нет pending-инвайтов с temp-паролем → null', async () => {
      prisma.orgInvitation.findMany.mockResolvedValue([]);
      const svc = make();

      const result = await svc.acceptViaPassword({
        email: 'new@example.com',
        password: 'temp-pw',
        upsertUserByEmail: vi.fn(),
        issueSession: vi.fn(),
      });

      expect(result).toBeNull();
    });

    it('инвайт истёк → null, помечает expired', async () => {
      prisma.orgInvitation.findMany.mockResolvedValue([
        await makeCandidate('temp-pw', { expiresAt: new Date(Date.now() - 1000) }),
      ]);
      const svc = make();

      const result = await svc.acceptViaPassword({
        email: 'new@example.com',
        password: 'temp-pw',
        upsertUserByEmail: vi.fn(),
        issueSession: vi.fn(),
      });

      expect(result).toBeNull();
      expect(metrics.incInviteExpired).toHaveBeenCalled();
    });
  });

  describe('resendInvitation', () => {
    it('перевыпускает linkCode + magicToken, шлёт письмо', async () => {
      prisma.orgInvitation.findFirst.mockResolvedValue({
        id: 'inv-1',
        orgId: 'org-1',
        email: 'ivan@example.com',
        role: 'manager',
        status: 'pending',
        org: { name: 'ООО Ромашка' },
        inviter: { name: 'Иван' },
      });
      prisma.orgInvitation.update.mockResolvedValue({
        id: 'inv-1',
        orgId: 'org-1',
        email: 'ivan@example.com',
        role: 'manager',
        status: 'pending',
        invitedBy: 'u-actor',
        createdAt: new Date('2026-05-25'),
        expiresAt: new Date('2026-06-08'),
        acceptedAt: null,
        org: { name: 'ООО Ромашка' },
        inviter: { name: 'Иван' },
      });

      const svc = make();
      const result = await svc.resendInvitation('org-1', 'inv-1', 'u-actor');

      expect(linkCodes.generateInviteCode).toHaveBeenCalled();
      expect(mail.sendInviteWithCredentials).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'ivan@example.com' }),
      );
      expect(result.linkCode).toBe('abcd1234abcd1234');
      const updateCall = prisma.orgInvitation.update.mock.calls.find(
        (c: unknown[]) =>
          (c[0] as { data?: { tempPasswordHash?: unknown } }).data?.tempPasswordHash,
      );
      const stored = (updateCall?.[0] as { data: { tempPasswordHash: string } } | undefined)?.data
        .tempPasswordHash;
      expect(stored).toMatch(/^\$argon2id\$/);
    });

    it('NotFound если приглашение не существует', async () => {
      prisma.orgInvitation.findFirst.mockResolvedValue(null);
      const svc = make();
      await expect(svc.resendInvitation('org-1', 'missing', 'u-actor')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
