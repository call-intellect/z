import { randomBytes, createHash } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { User } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DisposableEmailService } from '../mail/disposable-email.service';
import { MailService } from '../mail/mail.service';
import { OrgsService } from '../orgs/orgs.service';

import { AccountsRepository } from './accounts.repository';
import {
  CurrentPasswordInvalidError,
  DisposableEmailError,
  LoginInvalidError,
  ResetTokenInvalidError,
} from './exceptions/accounts-errors';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

/**
 * Бизнес-логика standalone-аккаунтов:
 *   - register (lead-style: temp-пароль на почту, mustChangePassword=true)
 *   - login (по email+password, выдача UserSession)
 *   - logout (отзыв UserSession)
 *   - forgot/reset password (verification token)
 *   - change password (требует текущий пароль; revoke остальных сессий)
 *   - update profile (name)
 *
 * Email везде нормализуется: `trim().toLowerCase()`. Это делает поиск
 * по уникальному `(email, signupSource)` детерминированным независимо
 * от того, как пользователь набрал «Alice@Z.app» / «alice@z.app».
 */

const TEMP_PASSWORD_BYTES = 9; // 9 bytes → 12 base64url-символов
const RESET_TOKEN_BYTES = 32; // 32 bytes → 43 base64url-символа
const RESET_TOKEN_TTL_MIN = 60;

export interface RegisterResult {
  status: 'ok';
  emailSent: boolean;
  emailError?: string;
}

export interface LoginResult {
  user: PublicUserDto;
  token: string;
  mustChangePassword: boolean;
}

export interface PublicUserDto {
  id: string;
  email: string;
  name: string;
  role: 'user' | 'admin';
  signupSource: 'crossmark' | 'standalone';
  mustChangePassword: boolean;
  createdAt: string;
}

@Injectable()
export class AccountsService {
  private readonly logger = new Logger(AccountsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AccountsRepository) private readonly repo: AccountsRepository,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(DisposableEmailService) private readonly disposable: DisposableEmailService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(OrgsService) private readonly orgs: OrgsService,
  ) {}

  // ─────────────────────────── register ─────────────────────────

  /**
   * Lead-style регистрация. honeypot заполнен → silent ok без действий.
   */
  async register(input: {
    email: string;
    name: string;
    companyName?: string;
    honeypot?: string;
  }): Promise<RegisterResult> {
    if (input.honeypot && input.honeypot.length > 0) {
      // Бот заполнил скрытое поле. Возвращаем «успех», но ничего не делаем.
      this.logger.warn({ email: input.email }, 'register: honeypot triggered');
      return { status: 'ok', emailSent: true };
    }

    const email = AccountsService.normalizeEmail(input.email);
    const name = input.name.trim();

    if (this.disposable.isDisposable(email)) {
      throw new DisposableEmailError();
    }

    const tempPassword = AccountsService.generateTempPassword();
    const passwordHash = await this.passwords.hash(tempPassword);

    // В одной Prisma-транзакции:
    //   1) upsert юзера (idempotency через (email, signupSource)).
    //   2) если у юзера ещё нет owned Org — создать персональный Org +
    //      Membership(owner). Если уже есть (повторная регистрация на
    //      тот же email) — пропустить.
    const orgName = (input.companyName?.trim() || `Компания ${name}`).slice(0, 120);
    await this.prisma.$transaction(async (tx) => {
      const user = await this.repo.upsertStandalone(
        {
          email,
          name,
          passwordHash,
          mustChangePassword: true,
        },
        tx,
      );
      // Идемпотентность: создаём Org только если у юзера ещё нет своих.
      const existingOwned = await tx.org.findFirst({
        where: { ownerId: user.id, deletedAt: null },
      });
      if (!existingOwned) {
        await this.orgs.createForOwner({ name: orgName, ownerId: user.id }, tx);
      }
    });

    const loginUrl = `${this.cfg.auth.publicFrontendUrl}/login`;
    const sendResult = await this.mail.sendTempPassword({
      to: email,
      name,
      tempPassword,
      loginUrl,
    });

    if (!sendResult.ok) {
      this.logger.warn(
        { email, err: sendResult.error },
        'register: ошибка отправки письма',
      );
      return {
        status: 'ok',
        emailSent: false,
        emailError: sendResult.error ?? 'unknown',
      };
    }

    return { status: 'ok', emailSent: true };
  }

  // ─────────────────────────── login ────────────────────────────

  async login(
    input: { email: string; password: string },
    meta: { userAgent?: string | null; ip?: string | null } = {},
  ): Promise<LoginResult> {
    const email = AccountsService.normalizeEmail(input.email);

    // Сначала ищем именно standalone-аккаунт. Если его нет, но есть admin
    // или crossmark на этом email — всё равно отвечаем тем же `LoginInvalidError`.
    const user = await this.repo.findStandaloneByEmail(email);

    if (!user || !user.passwordHash) {
      // Защита от user enumeration: тратим время на verify с фейковым hash.
      await this.passwords.verify(
        '$argon2id$v=19$m=19456,t=2,p=1$YWJjZGVmZ2hpams$dGVzdHRlc3R0ZXN0dGVzdA',
        input.password,
      );
      throw new LoginInvalidError();
    }

    const ok = await this.passwords.verify(user.passwordHash, input.password);
    if (!ok) {
      throw new LoginInvalidError();
    }

    const { token } = await this.sessions.issue({
      userId: user.id,
      email: user.email,
      role: user.role,
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
    });

    return {
      user: this.toPublicUser(user),
      token,
      mustChangePassword: user.mustChangePassword,
    };
  }

  // ─────────────────────────── logout ───────────────────────────

  async logout(jti: string): Promise<void> {
    await this.sessions.revokeByJti(jti);
  }

  // ─────────────────────────── forgot password ──────────────────

  /**
   * Всегда возвращает успех — защита от user enumeration. Если standalone-
   * аккаунта на email нет, ничего не делаем.
   */
  async forgotPassword(email: string): Promise<void> {
    const normalized = AccountsService.normalizeEmail(email);
    const user = await this.repo.findStandaloneByEmail(normalized);
    if (!user) {
      this.logger.log(
        { email: normalized },
        'forgotPassword: standalone-аккаунт не найден, тихо игнорим',
      );
      return;
    }

    const rawToken = randomBytes(RESET_TOKEN_BYTES).toString('base64url');
    const tokenHash = AccountsService.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MIN * 60_000);

    await this.repo.createVerificationToken({
      userId: user.id,
      tokenHash,
      purpose: 'password_reset',
      expiresAt,
    });

    const resetUrl = `${this.cfg.auth.publicFrontendUrl}/reset-password?token=${rawToken}`;
    await this.mail.sendPasswordReset({
      to: user.email,
      name: user.name,
      resetUrl,
      expiresInMinutes: RESET_TOKEN_TTL_MIN,
    });
  }

  // ─────────────────────────── reset password ───────────────────

  async resetPassword(input: { token: string; newPassword: string }): Promise<void> {
    const tokenHash = AccountsService.hashToken(input.token);
    const found = await this.repo.findVerificationToken(tokenHash, 'password_reset');
    if (!found) throw new ResetTokenInvalidError();
    if (found.usedAt !== null) throw new ResetTokenInvalidError();
    if (found.expiresAt.getTime() <= Date.now()) throw new ResetTokenInvalidError();

    const newHash = await this.passwords.hash(input.newPassword);

    await this.prisma.$transaction(async (tx) => {
      await this.repo.updatePassword(found.userId, newHash, false, tx);
      await this.repo.markVerificationTokenUsed(found.id, tx);
    });

    // Отзываем все активные сессии после смены пароля.
    await this.sessions.revokeAll(found.userId);
  }

  // ─────────────────────────── change password (logged in) ──────

  async changePassword(input: {
    userId: string;
    currentJti: string | null;
    currentPassword: string;
    newPassword: string;
  }): Promise<void> {
    const user = await this.repo.findById(input.userId);
    if (!user || !user.passwordHash) {
      // Технически — пользователь должен существовать (cookie проверена),
      // но защищаем.
      throw new CurrentPasswordInvalidError();
    }
    const ok = await this.passwords.verify(user.passwordHash, input.currentPassword);
    if (!ok) throw new CurrentPasswordInvalidError();

    const newHash = await this.passwords.hash(input.newPassword);
    await this.repo.updatePassword(user.id, newHash, false);

    // Текущая сессия остаётся, остальные — отозваны.
    if (input.currentJti) {
      await this.sessions.revokeAllExcept(user.id, input.currentJti);
    } else {
      // Если jti отсутствует (legacy session), отзываем все —
      // пользователю придётся зайти заново.
      await this.sessions.revokeAll(user.id);
    }
  }

  // ─────────────────────────── profile ──────────────────────────

  async updateProfile(userId: string, name: string): Promise<PublicUserDto> {
    const user = await this.repo.updateName(userId, name.trim());
    return this.toPublicUser(user);
  }

  async getMe(userId: string): Promise<PublicUserDto | null> {
    const user = await this.repo.findById(userId);
    if (!user) return null;
    return this.toPublicUser(user);
  }

  // ─────────────────────────── helpers ──────────────────────────

  private toPublicUser(user: User): PublicUserDto {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      signupSource: user.signupSource,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt.toISOString(),
    };
  }

  static normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  static generateTempPassword(): string {
    // 9 байт base64url ≈ 12 символов; набор включает буквы и цифры — удобно для письма.
    return randomBytes(TEMP_PASSWORD_BYTES).toString('base64url');
  }

  static hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
