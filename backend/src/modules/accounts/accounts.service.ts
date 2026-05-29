import { randomBytes, createHash } from 'node:crypto';

import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import type { User } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { DisposableEmailService } from '../mail/disposable-email.service';
import { MailService } from '../mail/mail.service';
import { OrgInvitationsService } from '../orgs/org-invitations.service';
import { OrgsService } from '../orgs/orgs.service';

import { AccountsRepository } from './accounts.repository';
import {
  CurrentPasswordInvalidError,
  DisposableEmailError,
  LoginInvalidError,
  MagicLinkInvalidError,
  MagicLinkRateLimitedError,
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

// β-9 (2026-05-25)
const MAGIC_LINK_TOKEN_BYTES = 32; // 32 байта → 43 base64url-символа
const MAGIC_LINK_REDIS_KEY_PREFIX = 'magic-link:request:';

export interface MagicLinkRequestResult {
  /** Всегда `'ok'` — для защиты от user enumeration. Письмо могло не отправиться. */
  status: 'ok';
  emailSent: boolean;
  emailError?: string;
}

/**
 * β-9 / Phase 6 (2026-05-25) — magic-link для команды `/login` в боте.
 * В отличие от обычного `requestMagicLink` отдаёт raw-токен и готовый URL
 * наружу (без отправки письма) — бот доставит ссылку в чат сам.
 *
 * Safe-by-design: вызывать ТОЛЬКО когда отправитель уже verified в
 * `ChannelBinding` (см. `TelegramBotChannelAdapter.requireVerifiedBinding`).
 * Никаких HTTP-эндпоинтов — internal-only, иначе разрушит защиту от
 * user enumeration базового `requestMagicLink`.
 */
export interface BotMagicLinkResult {
  /** Полный URL вида `${publicFrontendUrl}/accounts/magic-link/consume?token=…`. */
  url: string;
  /** TTL в минутах (для текста сообщения боту). */
  ttlMinutes: number;
}

export interface MagicLinkConsumeResult {
  user: PublicUserDto;
  token: string;
}

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
  /** Z-Admin (super_admin) — true только у владельцев продукта. (Фаза 7) */
  isSuperAdmin: boolean;
  /**
   * Роль в первой Org (если их несколько — берётся первая по joinedAt asc).
   * `null` если пользователь не в Org. Используется фронтом для гейта
   * раздела «Админка Org» (`/settings/admin/*`). (Фаза 7)
   */
  currentOrgRole: 'owner' | 'admin' | 'manager' | 'coo' | null;
  /** ID первой Org (для удобства фронта). null если не в Org. (Фаза 7) */
  currentOrgId: string | null;
  /** Когда user завершил Блок A онбординга. null = не прошёл. */
  profileCompletedAt: string | null;
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
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(OrgInvitationsService)
    private readonly orgInvitations: OrgInvitationsService,
  ) {}

  // ─────────────────────────── register ─────────────────────────

  /**
   * Lead-style регистрация. honeypot заполнен → silent ok без действий.
   * Сохраняет phone, флаги согласия и реферральную ссылку.
   */
  async register(input: {
    email: string;
    name: string;
    phone?: string;
    companyName?: string;
    honeypot?: string;
    ref?: string;
    consentDataProcessing: boolean;
    consentMarketing?: boolean;
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
          phone: input.phone ?? undefined,
          passwordHash,
          mustChangePassword: true,
          consentDataProcessing: input.consentDataProcessing,
          consentMarketing: input.consentMarketing ?? false,
          consentAcceptedAt: new Date(),
          signupRef: input.ref?.trim(),
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

  // ─────────────────────────── magic-link (β-9) ─────────────────

  /**
   * β-9 (2026-05-25) — выдать magic-link для входа без пароля.
   *
   * Поведение:
   *   - Если standalone-юзера на этот email нет — silent ok (защита от
   *     user enumeration), metric outcome='user_not_found'.
   *   - Rate-limit по email через Redis: `magic-link:request:<email>` =
   *     счётчик с TTL 1 час. При превышении `MAGIC_LINK_RATE_LIMIT_PER_HOUR`
   *     → `MagicLinkRateLimitedError`.
   *   - Создаёт `UserVerificationToken(purpose='magic_link')` с TTL
   *     `MAGIC_LINK_TTL_MINUTES`, шлёт письмо со ссылкой
   *     `/accounts/magic-link/consume?token=<raw>`.
   */
  async requestMagicLink(input: { email: string }): Promise<MagicLinkRequestResult> {
    const normalized = AccountsService.normalizeEmail(input.email);

    // Rate-limit (по email, не по IP — IP тоже стоит, но это уровень
    // controller-throttler; здесь дополнительная per-email защита).
    const ttlSec = 3600;
    const limit = this.cfg.invites.magicLinkRateLimitPerHour;
    const key = `${MAGIC_LINK_REDIS_KEY_PREFIX}${normalized}`;
    const current = await this.redis.client.incr(key);
    if (current === 1) {
      await this.redis.client.expire(key, ttlSec);
    }
    if (current > limit) {
      this.metrics.incMagicLinkRequest({ outcome: 'rate_limited' });
      throw new MagicLinkRateLimitedError();
    }

    const user = await this.repo.findStandaloneByEmail(normalized);
    if (!user) {
      this.metrics.incMagicLinkRequest({ outcome: 'user_not_found' });
      this.logger.log(
        { email: normalized },
        'requestMagicLink: standalone-аккаунт не найден, silent ok',
      );
      return { status: 'ok', emailSent: false };
    }

    const rawToken = randomBytes(MAGIC_LINK_TOKEN_BYTES).toString('base64url');
    const tokenHash = AccountsService.hashToken(rawToken);
    const ttlMin = this.cfg.invites.magicLinkTtlMinutes;
    const expiresAt = new Date(Date.now() + ttlMin * 60_000);

    await this.repo.createVerificationToken({
      userId: user.id,
      tokenHash,
      purpose: 'magic_link',
      expiresAt,
    });

    const magicLinkUrl =
      `${this.cfg.auth.publicFrontendUrl.replace(/\/+$/, '')}` +
      `/accounts/magic-link/consume?token=${rawToken}`;
    // Переиспользуем sendPasswordReset как «общую ссылку входа» — название
    // шаблона deprecated, но логика идентичная (одноразовая ссылка с TTL).
    const sendResult = await this.mail.sendPasswordReset({
      to: user.email,
      name: user.name,
      resetUrl: magicLinkUrl,
      expiresInMinutes: ttlMin,
    });
    if (!sendResult.ok) {
      this.logger.warn(
        { email: normalized, err: sendResult.error },
        'requestMagicLink: ошибка отправки письма',
      );
      this.metrics.incMagicLinkRequest({ outcome: 'sent' });
      return { status: 'ok', emailSent: false, emailError: sendResult.error ?? 'unknown' };
    }

    this.metrics.incMagicLinkRequest({ outcome: 'sent' });
    return { status: 'ok', emailSent: true };
  }

  /**
   * β-9 / Phase 6 (2026-05-25) — выдать magic-link через Telegram-бот по
   * команде `/login`. Возвращает raw-токен в URL — caller (бот) сам
   * доставит ссылку в чат пользователю.
   *
   * **Internal-only**: НЕТ HTTP-эндпоинта, метод дёргается ТОЛЬКО из
   * `TelegramBotChannelAdapter` после `requireVerifiedBinding`. Без письма,
   * без rate-limit (anti-spam уже на уровне адаптера через verified-binding
   * + регулярный Telegram-rate-limit пользователя), без silent-ok на
   * «user not found» — здесь user обязан существовать.
   *
   * @throws Error если пользователя по `userId` нет (binding stale,
   *   директор удалил аккаунт после привязки бота).
   */
  async requestMagicLinkForBot(input: {
    userId: string;
  }): Promise<BotMagicLinkResult> {
    const user = await this.repo.findById(input.userId);
    if (!user) {
      this.metrics.incBotLoginCommand({ outcome: 'user_not_found' });
      throw new Error(
        `requestMagicLinkForBot: user ${input.userId} не найден (binding stale)`,
      );
    }

    const rawToken = randomBytes(MAGIC_LINK_TOKEN_BYTES).toString('base64url');
    const tokenHash = AccountsService.hashToken(rawToken);
    const ttlMin = this.cfg.invites.magicLinkTtlMinutes;
    const expiresAt = new Date(Date.now() + ttlMin * 60_000);

    await this.repo.createVerificationToken({
      userId: user.id,
      tokenHash,
      purpose: 'magic_link',
      expiresAt,
    });

    const url =
      `${this.cfg.auth.publicFrontendUrl.replace(/\/+$/, '')}` +
      `/accounts/magic-link/consume?token=${rawToken}`;

    this.metrics.incBotLoginCommand({ outcome: 'ok' });
    this.logger.log(
      { userId: user.id, ttlMin },
      'requestMagicLinkForBot: magic-link выпущен через Telegram-бот',
    );
    return { url, ttlMinutes: ttlMin };
  }

  /**
   * β-9 (2026-05-25) — прожечь magic-link и открыть сессию.
   *
   * Возвращает `{ user, token }` — caller (controller) выставит cookie.
   */
  async consumeMagicLink(
    input: { token: string },
    meta: { userAgent?: string | null; ip?: string | null } = {},
  ): Promise<MagicLinkConsumeResult> {
    const tokenHash = AccountsService.hashToken(input.token);
    const found = await this.repo.findVerificationTokenByHash(tokenHash);
    if (!found || found.purpose !== 'magic_link') {
      this.metrics.incMagicLinkConsume({ outcome: 'invalid' });
      throw new MagicLinkInvalidError();
    }
    if (found.usedAt !== null) {
      this.metrics.incMagicLinkConsume({ outcome: 'already_used' });
      throw new MagicLinkInvalidError();
    }
    if (found.expiresAt.getTime() <= Date.now()) {
      this.metrics.incMagicLinkConsume({ outcome: 'expired' });
      throw new MagicLinkInvalidError();
    }

    const user = await this.repo.findById(found.userId);
    if (!user) {
      this.metrics.incMagicLinkConsume({ outcome: 'invalid' });
      throw new MagicLinkInvalidError();
    }

    await this.prisma.$transaction(async (tx) => {
      await this.repo.markVerificationTokenUsed(found.id, tx);
    });

    const { token } = await this.sessions.issue({
      userId: user.id,
      email: user.email,
      role: user.role,
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
    });

    this.metrics.incMagicLinkConsume({ outcome: 'ok' });
    return {
      user: this.toPublicUser(user),
      token,
    };
  }

  // ─────────────────────────── invite accept (β-9) ──────────────

  /**
   * β-9 (2026-05-25) — принять приглашение по magic-token из письма.
   * Без auth, одноразовый токен. Под капотом — `OrgInvitationsService.acceptViaMagicLink`
   * с callback'ами:
   *   - `upsertUserByEmail` — для приглашений с email,
   *   - `createUserWithoutEmail` — для приглашений без email (линейный персонал).
   *     Генерим placeholder-email `noemail-<cuid>@kora.local`, потому что
   *     `User.email` в схеме required; пользователь сможет позже заменить
   *     его на настоящий через профиль.
   *   - `issueSession` — выдаёт обычную UserSession (cookie-based).
   *
   * Транзакция и валидация «один user = одна Org» — внутри `OrgInvitationsService`.
   */
  async acceptInvitationMagicLink(
    input: { magicToken: string },
    meta: { userAgent?: string | null; ip?: string | null } = {},
  ): Promise<MagicLinkConsumeResult> {
    const result = await this.orgInvitations.acceptViaMagicLink({
      magicToken: input.magicToken,
      upsertUserByEmail: async (args) => {
        // β-10: если в инвайте есть tempPasswordHash (β-10+), используем его напрямую
        // (пользователь знает пароль из письма). Иначе генерируем новый — legacy-путь.
        const passwordHash = args.passwordHash
          ?? await this.passwords.hash(AccountsService.generateTempPassword());
        const user = await this.repo.upsertStandalone({
          email: args.email,
          name: args.name,
          passwordHash,
          mustChangePassword: true,
        });
        return { id: user.id, email: user.email, role: user.role };
      },
      createUserWithoutEmail: async (args) => {
        // No-email: placeholder-пароль (пользователь задаст через setInitialPassword).
        const passwordHash = args.passwordHash
          ?? await this.passwords.hash(AccountsService.generateTempPassword());
        const placeholderEmail = `noemail-${randomBytes(12).toString('hex')}@kora.local`;
        const user = await this.repo.upsertStandalone({
          email: placeholderEmail,
          name: args.name,
          passwordHash,
          mustChangePassword: true,
        });
        return { id: user.id, email: user.email, role: user.role };
      },
      issueSession: async (args) => {
        const { token } = await this.sessions.issue({
          userId: args.userId,
          email: args.email,
          role: args.role,
          userAgent: meta.userAgent ?? null,
          ip: meta.ip ?? null,
        });
        return { token };
      },
    });

    const user = await this.repo.findById(result.userId);
    if (!user) {
      // не должно случиться — User создан в callback'е внутри acceptViaMagicLink
      throw new MagicLinkInvalidError();
    }
    this.metrics.incInviteAccepted({ path: 'magic_link' });
    return {
      user: this.toPublicUser(user),
      token: result.sessionToken,
    };
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

  // ─────────────────── set initial password (no-email / β-10) ──

  /**
   * β-10 (2026-05-27) — установка пароля без знания «старого» пароля.
   * Разрешено только если `mustChangePassword=true` (иначе ForbiddenException).
   * Используется для no-email пользователей (placeholder @kora.local), которые
   * вошли через magic-link и не знают своего placeholder-пароля.
   */
  async setInitialPassword(input: {
    userId: string;
    newPassword: string;
    currentJti: string | null;
  }): Promise<void> {
    const user = await this.repo.findById(input.userId);
    if (!user || !user.mustChangePassword) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Установка начального пароля недоступна для этого аккаунта',
        },
      });
    }
    const newHash = await this.passwords.hash(input.newPassword);
    await this.repo.updatePassword(user.id, newHash, false);

    if (input.currentJti) {
      await this.sessions.revokeAllExcept(user.id, input.currentJti);
    } else {
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
    // Догружаем флаг super_admin + первую membership-роль
    // (Фаза 7 — нужно для гейта Z-Admin / Org-Admin на фронте).
    const [fresh, firstMembership] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { isSuperAdmin: true },
      }),
      this.prisma.membership.findFirst({
        where: { userId, org: { deletedAt: null } },
        orderBy: { joinedAt: 'asc' },
        select: { orgId: true, role: true },
      }),
    ]);
    return {
      ...this.toPublicUser(user),
      isSuperAdmin: fresh?.isSuperAdmin === true,
      currentOrgRole: firstMembership?.role ?? null,
      currentOrgId: firstMembership?.orgId ?? null,
    };
  }

  // ─────────────────────────── helpers ──────────────────────────

  private toPublicUser(user: User): PublicUserDto {
    // Дефолтные значения для новых полей (isSuperAdmin/currentOrgRole/currentOrgId).
    // getMe() их перезаписывает; updateProfile/login возвращают значения,
    // которые догружаются в caller'ах либо остаются `false/null` —
    // фронт всё равно делает refresh().
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      signupSource: user.signupSource,
      mustChangePassword: user.mustChangePassword,
      createdAt: user.createdAt.toISOString(),
      isSuperAdmin: false,
      currentOrgRole: null,
      currentOrgId: null,
      profileCompletedAt: user.profileCompletedAt ? user.profileCompletedAt.toISOString() : null,
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
