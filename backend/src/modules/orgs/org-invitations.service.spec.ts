import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { ConversationalLinkCodeService } from '../conversational/link-code.service';
import type { MailService } from '../mail/mail.service';
import type { RbacService } from '../rbac/rbac.service';

import { OrgInvitationsService } from './org-invitations.service';

/**
 * β-9 (2026-05-25) — спецификация OrgInvitationsService после расширения
 * GitHub-style flow'ом. Покрытие:
 *   - createInvitation: без email и с email,
 *   - acceptViaMagicLink: успешный путь,
 *   - валидация «один user = одна Org» (Conflict при втором Membership),
 *   - resendInvitation: новый linkCode + magicToken.
 */

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
    $transaction: ReturnType<typeof vi.fn>;
  };
  let mail: {
    sendInviteGithubStyle: ReturnType<typeof vi.fn>;
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
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
    };
    mail = {
      sendInviteGithubStyle: vi.fn(async () => ({ ok: true })),
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
    );
  }

  // ─────────────────────────── createInvitation ──────────────────

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
      expect(result.magicLinkUrl).toMatch(/^https:\/\/kora\.app\/invitations\/accept\?token=/);
      expect(result.telegramDeepLink).toBe('https://t.me/kora_bot?start=abcd1234abcd1234');
      expect(result.manualShareUrl).toBe(result.magicLinkUrl);
      // Письмо не шлём, если email пуст.
      expect(mail.sendInviteGithubStyle).not.toHaveBeenCalled();
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
      expect(mail.sendInviteGithubStyle).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'ivan@example.com',
          orgName: 'ООО Ромашка',
          inviterName: 'Иван',
          ttlDays: 14,
        }),
      );
      expect(metrics.incInviteCreated).toHaveBeenCalledWith({ hasEmail: true });
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
  });

  // ─────────────────────────── acceptViaMagicLink ─────────────────

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

    it('Conflict при уже существующем Membership в другой Org', async () => {
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

      await expect(
        svc.acceptViaMagicLink({
          magicToken: 'raw',
          issueSession: vi.fn(),
          upsertUserByEmail,
          createUserWithoutEmail: vi.fn(),
        }),
      ).rejects.toBeInstanceOf(ConflictException);
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

  // ─────────────────────────── resendInvitation ───────────────────

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
      expect(mail.sendInviteGithubStyle).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'ivan@example.com' }),
      );
      expect(result.linkCode).toBe('abcd1234abcd1234');
    });

    it('NotFound если приглашение не существует', async () => {
      prisma.orgInvitation.findFirst.mockResolvedValue(null);
      const svc = make();
      await expect(
        svc.resendInvitation('org-1', 'missing', 'u-actor'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
