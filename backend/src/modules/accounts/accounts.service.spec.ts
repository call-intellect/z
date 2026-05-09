import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { DisposableEmailService } from '../mail/disposable-email.service';
import type { MailService } from '../mail/mail.service';

import type { AccountsRepository } from './accounts.repository';
import { AccountsService } from './accounts.service';
import {
  DisposableEmailError,
  LoginInvalidError,
  ResetTokenInvalidError,
  CurrentPasswordInvalidError,
} from './exceptions/accounts-errors';
import type { PasswordService } from './password.service';
import type { SessionService } from './session.service';

function makeUser(over: Partial<{
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  signupSource: 'crossmark' | 'standalone';
  passwordHash: string | null;
  mustChangePassword: boolean;
}> = {}) {
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
  let prisma: { $transaction: ReturnType<typeof vi.fn> };
  let cfg: TypedConfigService;

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
    };
    cfg = {
      auth: { publicFrontendUrl: 'https://z.app' },
    } as unknown as TypedConfigService;
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
    );
  }

  // ─────────────────────────── register ──────────────────────────

  describe('register', () => {
    it('создаёт standalone-юзера, шлёт письмо с temp-паролем', async () => {
      const svc = make();
      const result = await svc.register({ email: 'Alice@Example.com', name: 'Alice' });

      expect(disposable.isDisposable).toHaveBeenCalledWith('alice@example.com');
      expect(passwords.hash).toHaveBeenCalled();
      expect(repo.upsertStandalone).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'alice@example.com',
          name: 'Alice',
          mustChangePassword: true,
        }),
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
      });
      expect(result).toEqual({ status: 'ok', emailSent: true });
      expect(repo.upsertStandalone).not.toHaveBeenCalled();
      expect(mail.sendTempPassword).not.toHaveBeenCalled();
    });

    it('disposable email → DisposableEmailError', async () => {
      disposable.isDisposable.mockReturnValueOnce(true);
      const svc = make();
      await expect(svc.register({ email: 'a@mailinator.com', name: 'A' })).rejects.toBeInstanceOf(
        DisposableEmailError,
      );
      expect(repo.upsertStandalone).not.toHaveBeenCalled();
    });

    it('ошибка SMTP → возвращает emailSent=false с error', async () => {
      mail.sendTempPassword.mockResolvedValueOnce({ ok: false, error: 'SMTP timeout' });
      const svc = make();
      const result = await svc.register({ email: 'a@b.c', name: 'A' });
      expect(result.emailSent).toBe(false);
      expect(result.emailError).toBe('SMTP timeout');
    });
  });

  // ─────────────────────────── login ────────────────────────────

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

  // ─────────────────────────── logout ───────────────────────────

  it('logout: вызывает sessions.revokeByJti', async () => {
    const svc = make();
    await svc.logout('jti-xxx');
    expect(sessions.revokeByJti).toHaveBeenCalledWith('jti-xxx');
  });

  // ─────────────────────────── forgot password ──────────────────

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
      // hash — sha256 hex = 64 символа
      expect(created.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  // ─────────────────────────── reset password ───────────────────

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
      await expect(svc.resetPassword({ token: 'x', newPassword: 'NewPass1' })).rejects.toBeInstanceOf(
        ResetTokenInvalidError,
      );
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
      await expect(svc.resetPassword({ token: 'x', newPassword: 'NewPass1' })).rejects.toBeInstanceOf(
        ResetTokenInvalidError,
      );
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
      await expect(svc.resetPassword({ token: 'x', newPassword: 'NewPass1' })).rejects.toBeInstanceOf(
        ResetTokenInvalidError,
      );
    });
  });

  // ─────────────────────────── change password ──────────────────

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

  // ─────────────────────────── helpers ──────────────────────────

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
});
