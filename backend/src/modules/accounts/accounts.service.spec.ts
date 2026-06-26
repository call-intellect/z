import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { RedisService } from '../../common/redis/redis.service';
import type { DisposableEmailService } from '../mail/disposable-email.service';
import type { MailService } from '../mail/mail.service';
import type { OrgInvitationsService } from '../orgs/org-invitations.service';
import type { OrgsService } from '../orgs/orgs.service';

import type { AccountsRepository } from './accounts.repository';
import { AccountsService } from './accounts.service';
import {
  DisposableEmailError,
  LoginInvalidError,
  MagicLinkInvalidError,
  MagicLinkRateLimitedError,
  ResetTokenInvalidError,
  CurrentPasswordInvalidError,
} from './exceptions/accounts-errors';
import type { PasswordService } from './password.service';
import type { SessionService } from './session.service';

function makeUser(
  over: Partial<{
    id: string;
    email: string;
    name: string;
    role: 'user' | 'admin';
    signupSource: 'crossmark' | 'standalone';
    passwordHash: string | null;
    mustChangePassword: boolean;
  }> = {},
) {
  return {
    id: 'u1',
    email: 'alice@example.com',
    name: 'Alice',
    role: 'user',
    signupSource: 'standalone',
    passwordHash: 'hash',
    mustChangePassword: false,
    createdAt: new Date('2026-01-01'),
    externalId: null,
    deletedAt: null,
    lastSeenAt: null,
    ...over,
  };
}

describe('AccountsService', () => {
  let repo: {
    findStandaloneByEmail: ReturnType<typeof vi.fn>;
    findAnyByEmailCaseInsensitive: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    upsertStandalone: ReturnType<typeof vi.fn>;
    updatePassword: ReturnType<typeof vi.fn>;
    updateName: ReturnType<typeof vi.fn>;
    createVerificationToken: ReturnType<typeof vi.fn>;
    findVerificationToken: ReturnType<typeof vi.fn>;
    findVerificationTokenByHash: ReturnType<typeof vi.fn>;
    markVerificationTokenUsed: ReturnType<typeof vi.fn>;
  };
  let passwords: {
    hash: ReturnType<typeof vi.fn>;
    verify: ReturnType<typeof vi.fn>;
  };
  let sessions: {
    issue: ReturnType<typeof vi.fn>;
    revokeByJti: ReturnType<typeof vi.fn>;
    revokeAll: ReturnType<typeof vi.fn>;
    revokeAllExcept: ReturnType<typeof vi.fn>;
  };
  let mail: {
    sendTempPassword: ReturnType<typeof vi.fn>;
    sendPasswordReset: ReturnType<typeof vi.fn>;
  };
  let disposable: { isDisposable: ReturnType<typeof vi.fn> };
  let prisma: {
    $transaction: ReturnType<typeof vi.fn>;
    org: {
      findFirst: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
    };
    membership: {
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
    user: {
      findUnique: ReturnType<typeof vi.fn>;
    };
  };
  let orgs: { createForOwner: ReturnType<typeof vi.fn> };
  let cfg: TypedConfigService;
  let redis: { client: { incr: ReturnType<typeof vi.fn>; expire: ReturnType<typeof vi.fn> } };
  let metrics: {
    incMagicLinkRequest: ReturnType<typeof vi.fn>;
    incMagicLinkConsume: ReturnType<typeof vi.fn>;
    incBotLoginCommand: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    repo = {
      findStandaloneByEmail: vi.fn(),
      findAnyByEmailCaseInsensitive: vi.fn(),
      findById: vi.fn(),
      upsertStandalone: vi.fn(async () => makeUser()),
      updatePassword: vi.fn(async () => makeUser()),
      updateName: vi.fn(async () => makeUser({ name: 'Bob' })),
      createVerificationToken: vi.fn(),
      findVerificationToken: vi.fn(),
      findVerificationTokenByHash: vi.fn(),
      markVerificationTokenUsed: vi.fn(),
    };
    passwords = {
      hash: vi.fn(async () => 'hashed'),
      verify: vi.fn(async () => true),
    };
    sessions = {
      issue: vi.fn(async () => ({ session: { id: 's1', jti: 'jti-1' }, token: 'jwt' })),
      revokeByJti: vi.fn(),
      revokeAll: vi.fn(async () => 0),
      revokeAllExcept: vi.fn(async () => 0),
    };
    mail = {
      sendTempPassword: vi.fn(async () => ({ ok: true })),
      sendPasswordReset: vi.fn(async () => ({ ok: true })),
    };
    disposable = { isDisposable: vi.fn(() => false) };
    prisma = {
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(prisma)),
      org: {
        findFirst: vi.fn(async () => null),
        findUnique: vi.fn(async () => null),
      },
      membership: {
        findUnique: vi.fn(async () => null),
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'mem-1' })),
      },
      user: {
        findUnique: vi.fn(async () => ({ isSuperAdmin: false })),
      },
    };
    orgs = { createForOwner: vi.fn(async () => ({ id: 'org-1', name: 'Компания Alice' })) };
    cfg = {
      auth: { publicFrontendUrl: 'https://z.app' },
      invites: {
        magicLinkRateLimitPerHour: 5,
        magicLinkTtlMinutes: 15,
      },
      demo: { referenceOrgId: null as string | null },
    } as unknown as TypedConfigService;
    redis = {
      client: {
        incr: vi.fn(async () => 1),
        expire: vi.fn(async () => 1),
      },
    };
    metrics = {
      incMagicLinkRequest: vi.fn(),
      incMagicLinkConsume: vi.fn(),
      incBotLoginCommand: vi.fn(),
    };
  });

  function make(): AccountsService {
    return new AccountsService(
      prisma as unknown as PrismaService,
      repo as unknown as AccountsRepository,
      passwords as unknown as PasswordService,
      sessions as unknown as SessionService,
      mail as unknown as MailService,
      disposable as unknown as DisposableEmailService,
      cfg,
      orgs as unknown as OrgsService,
      redis as unknown as RedisService,
      metrics as unknown as BusinessMetricsService,
      {} as unknown as OrgInvitationsService,
    );
  }

  describe('register', () => {
    it('создаёт standalone-юзера, шлёт письмо с temp-паролем', async () => {
      const svc = make();
      const result = await svc.register({
        email: 'Alice@Example.com',
        name: 'Alice',
        consentDataProcessing: true,
      });

      expect(disposable.isDisposable).toHaveBeenCalledWith('alice@example.com');
      expect(passwords.hash).toHaveBeenCalled();
      expect(repo.upsertStandalone).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'alice@example.com',
          name: 'Alice',
          mustChangePassword: true,
        }),
        expect.anything(),
      );
      expect(mail.sendTempPassword).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'alice@example.com',
          name: 'Alice',
          loginUrl: 'https://z.app/login',
        }),
      );
      expect(result).toEqual({ status: 'ok', emailSent: true });
    });

    it('honeypot заполнен → silent ok без действий', async () => {
      const svc = make();
      const result = await svc.register({
        email: 'bot@spam.com',
        name: 'Bot',
        honeypot: 'submit',
        consentDataProcessing: true,
      });
      expect(result).toEqual({ status: 'ok', emailSent: true });
      expect(repo.upsertStandalone).not.toHaveBeenCalled();
      expect(mail.sendTempPassword).not.toHaveBeenCalled();
    });

    it('disposable email → DisposableEmailError', async () => {
      disposable.isDisposable.mockReturnValueOnce(true);
      const svc = make();
      await expect(
        svc.register({ email: 'a@mailinator.com', name: 'A', consentDataProcessing: true }),
      ).rejects.toBeInstanceOf(DisposableEmailError);
      expect(repo.upsertStandalone).not.toHaveBeenCalled();
    });

    it('ошибка SMTP → возвращает emailSent=false с error', async () => {
      mail.sendTempPassword.mockResolvedValueOnce({ ok: false, error: 'SMTP timeout' });
      const svc = make();
      const result = await svc.register({ email: 'a@b.c', name: 'A', consentDataProcessing: true });
      expect(result.emailSent).toBe(false);
      expect(result.emailError).toBe('SMTP timeout');
    });
  });

  describe('login', () => {
    it('успех: standalone-юзер с верным паролем → выдаёт сессию', async () => {
      repo.findStandaloneByEmail.mockResolvedValue(makeUser());
      passwords.verify.mockResolvedValue(true);

      const svc = make();
      const result = await svc.login({ email: 'alice@example.com', password: 'pw' });

      expect(result.user.id).toBe('u1');
      expect(result.token).toBe('jwt');
      expect(result.mustChangePassword).toBe(false);
      expect(sessions.issue).toHaveBeenCalled();
    });

    it('нет standalone-юзера → LoginInvalidError (даже если есть admin на email)', async () => {
      repo.findStandaloneByEmail.mockResolvedValue(null);
      const svc = make();
      await expect(svc.login({ email: 'admin@z.app', password: 'pw' })).rejects.toBeInstanceOf(
        LoginInvalidError,
      );
      expect(sessions.issue).not.toHaveBeenCalled();
    });

    it('неверный пароль → LoginInvalidError', async () => {
      repo.findStandaloneByEmail.mockResolvedValue(makeUser());
      passwords.verify.mockResolvedValue(false);
      const svc = make();
      await expect(svc.login({ email: 'a@b.c', password: 'wrong' })).rejects.toBeInstanceOf(
        LoginInvalidError,
      );
    });

    it('mustChangePassword=true → пробрасывается в результат', async () => {
      repo.findStandaloneByEmail.mockResolvedValue(makeUser({ mustChangePassword: true }));
      passwords.verify.mockResolvedValue(true);
      const svc = make();
      const result = await svc.login({ email: 'a@b.c', password: 'temp' });
      expect(result.mustChangePassword).toBe(true);
    });
  });

  it('logout: вызывает sessions.revokeByJti', async () => {
    const svc = make();
    await svc.logout('jti-xxx');
    expect(sessions.revokeByJti).toHaveBeenCalledWith('jti-xxx');
  });

  describe('forgotPassword', () => {
    it('юзера нет → silent ok, ничего не делаем', async () => {
      repo.findStandaloneByEmail.mockResolvedValue(null);
      const svc = make();
      await svc.forgotPassword('nobody@example.com');
      expect(repo.createVerificationToken).not.toHaveBeenCalled();
      expect(mail.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('юзер есть → создаёт verification token и шлёт письмо', async () => {
      repo.findStandaloneByEmail.mockResolvedValue(makeUser());
      const svc = make();
      await svc.forgotPassword('alice@example.com');

      expect(repo.createVerificationToken).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u1',
          purpose: 'password_reset',
        }),
      );
      expect(mail.sendPasswordReset).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'alice@example.com',
          expiresInMinutes: 60,
        }),
      );

      const sent = mail.sendPasswordReset.mock.calls[0]?.[0] as { resetUrl: string };
      expect(sent.resetUrl).toMatch(/^https:\/\/z\.app\/reset-password\?token=/);
    });

    it('сохраняет hash токена, а не raw', async () => {
      repo.findStandaloneByEmail.mockResolvedValue(makeUser());
      const svc = make();
      await svc.forgotPassword('alice@example.com');

      const created = repo.createVerificationToken.mock.calls[0]?.[0] as {
        tokenHash: string;
      };
      expect(created.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('resetPassword', () => {
    it('валидный токен → меняет пароль, помечает usedAt, отзывает все сессии', async () => {
      repo.findVerificationToken.mockResolvedValue({
        id: 't1',
        userId: 'u1',
        purpose: 'password_reset',
        tokenHash: 'hash',
        expiresAt: new Date(Date.now() + 600_000),
        usedAt: null,
      });

      const svc = make();
      await svc.resetPassword({ token: 'raw-token', newPassword: 'NewPass1' });

      expect(passwords.hash).toHaveBeenCalledWith('NewPass1');
      expect(repo.updatePassword).toHaveBeenCalledWith('u1', 'hashed', false, prisma);
      expect(repo.markVerificationTokenUsed).toHaveBeenCalledWith('t1', prisma);
      expect(sessions.revokeAll).toHaveBeenCalledWith('u1');
    });

    it('токен не найден → ResetTokenInvalidError', async () => {
      repo.findVerificationToken.mockResolvedValue(null);
      const svc = make();
      await expect(
        svc.resetPassword({ token: 'x', newPassword: 'NewPass1' }),
      ).rejects.toBeInstanceOf(ResetTokenInvalidError);
    });

    it('токен использован → ResetTokenInvalidError', async () => {
      repo.findVerificationToken.mockResolvedValue({
        id: 't1',
        userId: 'u1',
        purpose: 'password_reset',
        expiresAt: new Date(Date.now() + 100_000),
        usedAt: new Date(),
        tokenHash: 'h',
      });
      const svc = make();
      await expect(
        svc.resetPassword({ token: 'x', newPassword: 'NewPass1' }),
      ).rejects.toBeInstanceOf(ResetTokenInvalidError);
    });

    it('токен истёк → ResetTokenInvalidError', async () => {
      repo.findVerificationToken.mockResolvedValue({
        id: 't1',
        userId: 'u1',
        purpose: 'password_reset',
        expiresAt: new Date(Date.now() - 100),
        usedAt: null,
        tokenHash: 'h',
      });
      const svc = make();
      await expect(
        svc.resetPassword({ token: 'x', newPassword: 'NewPass1' }),
      ).rejects.toBeInstanceOf(ResetTokenInvalidError);
    });
  });

  describe('changePassword', () => {
    it('успех: меняет пароль, отзывает все сессии кроме текущей (если есть jti)', async () => {
      repo.findById.mockResolvedValue(makeUser());
      passwords.verify.mockResolvedValue(true);
      const svc = make();

      await svc.changePassword({
        userId: 'u1',
        currentJti: 'keep-jti',
        currentPassword: 'old',
        newPassword: 'NewPass1',
      });

      expect(passwords.verify).toHaveBeenCalledWith('hash', 'old');
      expect(repo.updatePassword).toHaveBeenCalledWith('u1', 'hashed', false);
      expect(sessions.revokeAllExcept).toHaveBeenCalledWith('u1', 'keep-jti');
      expect(sessions.revokeAll).not.toHaveBeenCalled();
    });

    it('без jti — отзывает все сессии (legacy)', async () => {
      repo.findById.mockResolvedValue(makeUser());
      passwords.verify.mockResolvedValue(true);
      const svc = make();

      await svc.changePassword({
        userId: 'u1',
        currentJti: null,
        currentPassword: 'old',
        newPassword: 'NewPass1',
      });

      expect(sessions.revokeAll).toHaveBeenCalledWith('u1');
      expect(sessions.revokeAllExcept).not.toHaveBeenCalled();
    });

    it('неверный текущий пароль → CurrentPasswordInvalidError', async () => {
      repo.findById.mockResolvedValue(makeUser());
      passwords.verify.mockResolvedValue(false);
      const svc = make();

      await expect(
        svc.changePassword({
          userId: 'u1',
          currentJti: 'x',
          currentPassword: 'wrong',
          newPassword: 'NewPass1',
        }),
      ).rejects.toBeInstanceOf(CurrentPasswordInvalidError);
    });

    it('юзера нет → CurrentPasswordInvalidError', async () => {
      repo.findById.mockResolvedValue(null);
      const svc = make();
      await expect(
        svc.changePassword({
          userId: 'ghost',
          currentJti: 'x',
          currentPassword: 'pw',
          newPassword: 'NewPass1',
        }),
      ).rejects.toBeInstanceOf(CurrentPasswordInvalidError);
    });
  });

  describe('requestMagicLink', () => {
    beforeEach(() => {
      mail.sendPasswordReset.mockResolvedValue({ ok: true });
    });

    it('юзера нет → silent ok, metric=user_not_found', async () => {
      repo.findStandaloneByEmail.mockResolvedValue(null);
      const svc = make();
      const r = await svc.requestMagicLink({ email: 'nobody@example.com' });
      expect(r.emailSent).toBe(false);
      expect(metrics.incMagicLinkRequest).toHaveBeenCalledWith({ outcome: 'user_not_found' });
    });

    it('юзер есть → создаёт token и шлёт письмо', async () => {
      repo.findStandaloneByEmail.mockResolvedValue(makeUser());
      const svc = make();
      const r = await svc.requestMagicLink({ email: 'alice@example.com' });
      expect(r.emailSent).toBe(true);
      expect(repo.createVerificationToken).toHaveBeenCalledWith(
        expect.objectContaining({ purpose: 'magic_link' }),
      );
      expect(mail.sendPasswordReset).toHaveBeenCalled();
      expect(metrics.incMagicLinkRequest).toHaveBeenCalledWith({ outcome: 'sent' });
    });

    it('rate-limit: >5/час → MagicLinkRateLimitedError', async () => {
      redis.client.incr.mockResolvedValueOnce(6);
      const svc = make();
      await expect(svc.requestMagicLink({ email: 'x@y.com' })).rejects.toBeInstanceOf(
        MagicLinkRateLimitedError,
      );
      expect(metrics.incMagicLinkRequest).toHaveBeenCalledWith({ outcome: 'rate_limited' });
    });
  });

  describe('consumeMagicLink', () => {
    it('валидный token → открывает сессию, помечает usedAt', async () => {
      repo.findVerificationTokenByHash.mockResolvedValue({
        id: 't1',
        userId: 'u1',
        purpose: 'magic_link',
        tokenHash: 'h',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      });
      repo.findById.mockResolvedValue(makeUser());

      const svc = make();
      const r = await svc.consumeMagicLink({ token: 'raw-token' });
      expect(r.token).toBe('jwt');
      expect(sessions.issue).toHaveBeenCalled();
      expect(repo.markVerificationTokenUsed).toHaveBeenCalledWith('t1', prisma);
      expect(metrics.incMagicLinkConsume).toHaveBeenCalledWith({ outcome: 'ok' });
    });

    it('token не существует → MagicLinkInvalidError, metric=invalid', async () => {
      repo.findVerificationTokenByHash.mockResolvedValue(null);
      const svc = make();
      await expect(svc.consumeMagicLink({ token: 'x' })).rejects.toBeInstanceOf(
        MagicLinkInvalidError,
      );
      expect(metrics.incMagicLinkConsume).toHaveBeenCalledWith({ outcome: 'invalid' });
    });

    it('wrong purpose → MagicLinkInvalidError', async () => {
      repo.findVerificationTokenByHash.mockResolvedValue({
        id: 't1',
        userId: 'u1',
        purpose: 'password_reset',
        tokenHash: 'h',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      });
      const svc = make();
      await expect(svc.consumeMagicLink({ token: 'x' })).rejects.toBeInstanceOf(
        MagicLinkInvalidError,
      );
    });

    it('уже использованный → metric=already_used', async () => {
      repo.findVerificationTokenByHash.mockResolvedValue({
        id: 't1',
        userId: 'u1',
        purpose: 'magic_link',
        tokenHash: 'h',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: new Date(),
      });
      const svc = make();
      await expect(svc.consumeMagicLink({ token: 'x' })).rejects.toBeInstanceOf(
        MagicLinkInvalidError,
      );
      expect(metrics.incMagicLinkConsume).toHaveBeenCalledWith({ outcome: 'already_used' });
    });

    it('истёкший → metric=expired', async () => {
      repo.findVerificationTokenByHash.mockResolvedValue({
        id: 't1',
        userId: 'u1',
        purpose: 'magic_link',
        tokenHash: 'h',
        expiresAt: new Date(Date.now() - 1),
        usedAt: null,
      });
      const svc = make();
      await expect(svc.consumeMagicLink({ token: 'x' })).rejects.toBeInstanceOf(
        MagicLinkInvalidError,
      );
      expect(metrics.incMagicLinkConsume).toHaveBeenCalledWith({ outcome: 'expired' });
    });
  });

  describe('requestMagicLinkForBot', () => {
    it('успех: создаёт verification token, возвращает URL и TTL, метрика ok', async () => {
      repo.findById.mockResolvedValue(makeUser());
      const svc = make();

      const r = await svc.requestMagicLinkForBot({ userId: 'u1' });

      expect(r.url).toMatch(/^https:\/\/z\.app\/accounts\/magic-link\/consume\?token=/);
      expect(r.ttlMinutes).toBe(15);
      expect(repo.createVerificationToken).toHaveBeenCalledWith(
        expect.objectContaining({
          purpose: 'magic_link',
          userId: 'u1',
        }),
      );
      expect(mail.sendPasswordReset).not.toHaveBeenCalled();
      expect(metrics.incBotLoginCommand).toHaveBeenCalledWith({ outcome: 'ok' });
    });

    it('user не найден: кидает Error, метрика user_not_found, token не создаётся', async () => {
      repo.findById.mockResolvedValue(null);
      const svc = make();

      await expect(svc.requestMagicLinkForBot({ userId: 'ghost' })).rejects.toThrow(/не найден/i);
      expect(repo.createVerificationToken).not.toHaveBeenCalled();
      expect(metrics.incBotLoginCommand).toHaveBeenCalledWith({
        outcome: 'user_not_found',
      });
    });

    it('URL формируется с обрезкой trailing-слешей publicFrontendUrl', async () => {
      repo.findById.mockResolvedValue(makeUser());
      cfg = {
        ...cfg,
        auth: { publicFrontendUrl: 'https://kora.example.com///' },
        invites: { magicLinkRateLimitPerHour: 5, magicLinkTtlMinutes: 15 },
      } as unknown as TypedConfigService;
      const svc = make();

      const r = await svc.requestMagicLinkForBot({ userId: 'u1' });

      expect(r.url).toMatch(/^https:\/\/kora\.example\.com\/accounts\/magic-link\/consume\?token=/);
    });
  });

  it('normalizeEmail: trim + lowercase', () => {
    expect(AccountsService.normalizeEmail('  Alice@Z.APP ')).toBe('alice@z.app');
  });

  it('hashToken: детерминирован, sha256 hex', () => {
    const a = AccountsService.hashToken('abc');
    const b = AccountsService.hashToken('abc');
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(AccountsService.hashToken('abd')).not.toBe(a);
  });

  it('generateTempPassword: достаточно длинный', () => {
    const pw = AccountsService.generateTempPassword();
    expect(pw.length).toBeGreaterThanOrEqual(10);
  });

  describe('register: demo-attach (shared-demo-org-model)', () => {
    it('cfg.demo.referenceOrgId=null → membership.create НЕ вызывается', async () => {
      const svc = make();
      await svc.register({
        email: 'newby@example.com',
        name: 'Newby',
        consentDataProcessing: true,
      });
      expect(prisma.membership.create).not.toHaveBeenCalled();
    });

    it('cfg.demo.referenceOrgId задан + Org валидна → membership.create("demo_observer")', async () => {
      (cfg as unknown as { demo: { referenceOrgId: string | null } }).demo.referenceOrgId =
        'demo-org-1';
      prisma.org.findUnique.mockResolvedValueOnce({
        id: 'demo-org-1',
        isReferenceDemo: true,
        deletedAt: null,
      });
      prisma.membership.findUnique.mockResolvedValueOnce(null);

      const svc = make();
      await svc.register({
        email: 'demo@example.com',
        name: 'Demo',
        consentDataProcessing: true,
      });
      expect(prisma.membership.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u1',
          orgId: 'demo-org-1',
          role: 'demo_observer',
        }),
      });
    });

    it('cfg.demo.referenceOrgId задан, но Org не isReferenceDemo → create НЕ вызывается (warn)', async () => {
      (cfg as unknown as { demo: { referenceOrgId: string | null } }).demo.referenceOrgId =
        'fake-org';
      prisma.org.findUnique.mockResolvedValueOnce({
        id: 'fake-org',
        isReferenceDemo: false,
        deletedAt: null,
      });
      const svc = make();
      await svc.register({
        email: 'x@example.com',
        name: 'X',
        consentDataProcessing: true,
      });
      expect(prisma.membership.create).not.toHaveBeenCalled();
    });

    it('membership уже существует → create НЕ вызывается (idempotent)', async () => {
      (cfg as unknown as { demo: { referenceOrgId: string | null } }).demo.referenceOrgId =
        'demo-org-1';
      prisma.org.findUnique.mockResolvedValueOnce({
        id: 'demo-org-1',
        isReferenceDemo: true,
        deletedAt: null,
      });
      prisma.membership.findUnique.mockResolvedValueOnce({ id: 'mem-existing' });
      const svc = make();
      await svc.register({
        email: 'again@example.com',
        name: 'Again',
        consentDataProcessing: true,
      });
      expect(prisma.membership.create).not.toHaveBeenCalled();
    });
  });

  describe('getMe: default membership prefers own org', () => {
    it('есть demo + owner → currentOrgRole=owner (своя орга первична)', async () => {
      repo.findById.mockResolvedValueOnce(makeUser({ id: 'u1' }));
      prisma.user.findUnique.mockResolvedValueOnce({ isSuperAdmin: false });
      prisma.membership.findFirst
        .mockResolvedValueOnce({ orgId: 'demo-org', role: 'demo_observer' })
        .mockResolvedValueOnce({ orgId: 'own-org', role: 'owner' });

      const svc = make();
      const me = await svc.getMe('u1');

      expect(me?.currentOrgRole).toBe('owner');
      expect(me?.currentOrgId).toBe('own-org');
    });

    it('нет demo, есть owner → currentOrgRole=owner', async () => {
      repo.findById.mockResolvedValueOnce(makeUser({ id: 'u1' }));
      prisma.user.findUnique.mockResolvedValueOnce({ isSuperAdmin: false });
      prisma.membership.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ orgId: 'own-org', role: 'owner' });

      const svc = make();
      const me = await svc.getMe('u1');

      expect(me?.currentOrgRole).toBe('owner');
      expect(me?.currentOrgId).toBe('own-org');
    });

    it('нет membership вообще → currentOrgRole=null, currentOrgId=null', async () => {
      repo.findById.mockResolvedValueOnce(makeUser({ id: 'u1' }));
      prisma.user.findUnique.mockResolvedValueOnce({ isSuperAdmin: false });
      prisma.membership.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

      const svc = make();
      const me = await svc.getMe('u1');

      expect(me?.currentOrgRole).toBeNull();
      expect(me?.currentOrgId).toBeNull();
    });
  });
});
