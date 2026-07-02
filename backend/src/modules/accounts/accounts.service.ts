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

const TEMP_PASSWORD_BYTES = 9;
const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_TTL_MIN = 60;

const MAGIC_LINK_TOKEN_BYTES = 32;
const MAGIC_LINK_REDIS_KEY_PREFIX = 'magic-link:request:';

export interface MagicLinkRequestResult {
  status: 'ok';
  emailSent: boolean;
  emailError?: string;
}

export interface BotMagicLinkResult {
  url: string;
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
  isSuperAdmin: boolean;
  currentOrgRole: 'owner' | 'admin' | 'manager' | 'coo' | 'hr_partner' | 'demo_observer' | null;
  currentOrgId: string | null;
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
      const existingOwned = await tx.org.findFirst({
        where: { ownerId: user.id, deletedAt: null },
      });
      if (!existingOwned) {
        await this.orgs.createForOwner({ name: orgName, ownerId: user.id }, tx);
      }

      const demoOrgId = this.cfg.demo.referenceOrgId;
      if (demoOrgId) {
        const demoOrg = await tx.org.findUnique({
          where: { id: demoOrgId },
          select: { id: true, isReferenceDemo: true, deletedAt: true },
        });
        if (demoOrg && demoOrg.isReferenceDemo && !demoOrg.deletedAt) {
          const exists = await tx.membership.findUnique({
            where: { orgId_userId: { orgId: demoOrgId, userId: user.id } },
            select: { id: true },
          });
          if (!exists) {
            await tx.membership.create({
              data: {
                userId: user.id,
                orgId: demoOrgId,
                role: 'demo_observer',
                invitedBy: null,
                joinedAt: new Date(),
              },
            });
          }
        } else {
          this.logger.warn(
            { demoOrgId, found: !!demoOrg, isRef: demoOrg?.isReferenceDemo },
            'register: ZDEMO_ORG_ID указан, но Org не найдена/не эталонная — пропускаем demo-attach',
          );
        }
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
      this.logger.warn({ email, err: sendResult.error }, 'register: ошибка отправки письма');
      return {
        status: 'ok',
        emailSent: false,
        emailError: sendResult.error ?? 'unknown',
      };
    }

    return { status: 'ok', emailSent: true };
  }

  async login(
    input: { email: string; password: string },
    meta: { userAgent?: string | null; ip?: string | null } = {},
  ): Promise<LoginResult> {
    const email = AccountsService.normalizeEmail(input.email);

    const user = await this.repo.findStandaloneByEmail(email);

    if (!user || !user.passwordHash) {
      const viaInvite = await this.tryLoginViaInvitation(email, input.password, meta);
      if (viaInvite) return viaInvite;
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

    if (this.passwords.needsRehash(user.passwordHash)) {
      try {
        const rehashed = await this.passwords.hash(input.password);
        await this.repo.updatePassword(user.id, rehashed, user.mustChangePassword);
      } catch (err) {
        this.logger.warn({ userId: user.id, err }, 'login: lazy rehash failed');
      }
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

  async logout(jti: string): Promise<void> {
    await this.sessions.revokeByJti(jti);
  }

  async deleteAccount(userId: string): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, deletedAt: true },
    });
    if (!user) {
      return { ok: true };
    }

    await this.prisma.$transaction(async (tx) => {
      if (!user.deletedAt) {
        await tx.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });
      }
      await tx.pushToken.deleteMany({ where: { userId } });
      await tx.channelBinding.deleteMany({ where: { userId } });
      await tx.conversationMember.deleteMany({ where: { userId } });
      await tx.userSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    this.logger.log({ userId }, 'deleteAccount: аккаунт помечен удалённым, контактные точки очищены');
    return { ok: true };
  }

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

    await this.sessions.revokeAll(found.userId);
  }

  async requestMagicLink(input: { email: string }): Promise<MagicLinkRequestResult> {
    const normalized = AccountsService.normalizeEmail(input.email);

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

  async requestMagicLinkForBot(input: { userId: string }): Promise<BotMagicLinkResult> {
    const user = await this.repo.findById(input.userId);
    if (!user) {
      this.metrics.incBotLoginCommand({ outcome: 'user_not_found' });
      throw new Error(`requestMagicLinkForBot: user ${input.userId} не найден (binding stale)`);
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

  async issueLoginUrl(userId: string): Promise<{ url: string }> {
    const user = await this.repo.findById(userId);
    if (!user) {
      throw new Error(`issueLoginUrl: user ${userId} не найден`);
    }
    const rawToken = randomBytes(MAGIC_LINK_TOKEN_BYTES).toString('base64url');
    const tokenHash = AccountsService.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + this.cfg.invites.magicLinkTtlMinutes * 60_000);
    await this.repo.createVerificationToken({
      userId: user.id,
      tokenHash,
      purpose: 'magic_link',
      expiresAt,
    });
    return {
      url:
        `${this.cfg.auth.publicFrontendUrl.replace(/\/+$/, '')}` +
        `/accounts/magic-link/consume?token=${rawToken}`,
    };
  }

  async issueSession(
    userId: string,
    meta: { userAgent?: string | null; ip?: string | null } = {},
  ): Promise<string> {
    const user = await this.repo.findById(userId);
    if (!user) {
      throw new Error(`issueSession: user ${userId} не найден`);
    }
    const { token } = await this.sessions.issue({
      userId: user.id,
      email: user.email,
      role: user.role,
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
    });
    return token;
  }

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

  async acceptInvitationMagicLink(
    input: { magicToken: string },
    meta: { userAgent?: string | null; ip?: string | null } = {},
  ): Promise<MagicLinkConsumeResult> {
    const result = await this.orgInvitations.acceptViaMagicLink({
      magicToken: input.magicToken,
      upsertUserByEmail: async (args) => {
        const user = await this.findOrCreateStandaloneForInvite(args);
        return { id: user.id, email: user.email, role: user.role };
      },
      createUserWithoutEmail: async (args) => {
        const passwordHash =
          args.passwordHash ?? (await this.passwords.hash(AccountsService.generateTempPassword()));
        for (let attempt = 0; attempt < 3; attempt++) {
          const placeholderEmail = `noemail-${randomBytes(16).toString('hex')}@kora.local`;
          try {
            const user = await this.repo.upsertStandalone({
              email: placeholderEmail,
              name: args.name,
              passwordHash,
              mustChangePassword: true,
            });
            return { id: user.id, email: user.email, role: user.role };
          } catch (err) {
            const code = err instanceof Error ? (err as Error & { code?: string }).code : undefined;
            if (code === 'P2002' && attempt < 2) {
              this.logger.warn(
                `createUserWithoutEmail: коллизия placeholder email на попытке ${attempt + 1} — retry`,
              );
              continue;
            }
            throw err;
          }
        }
        throw new Error('createUserWithoutEmail: все 3 попытки коллизии исчерпаны');
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
      throw new MagicLinkInvalidError();
    }
    this.metrics.incInviteAccepted({ path: 'magic_link' });
    return {
      user: this.toPublicUser(user),
      token: result.sessionToken,
    };
  }

  async changePassword(input: {
    userId: string;
    currentJti: string | null;
    currentPassword: string;
    newPassword: string;
  }): Promise<void> {
    const user = await this.repo.findById(input.userId);
    if (!user || !user.passwordHash) {
      throw new CurrentPasswordInvalidError();
    }
    const ok = await this.passwords.verify(user.passwordHash, input.currentPassword);
    if (!ok) throw new CurrentPasswordInvalidError();

    const newHash = await this.passwords.hash(input.newPassword);
    await this.repo.updatePassword(user.id, newHash, false);

    if (input.currentJti) {
      await this.sessions.revokeAllExcept(user.id, input.currentJti);
    } else {
      await this.sessions.revokeAll(user.id);
    }
  }

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

  async updateProfile(userId: string, name: string): Promise<PublicUserDto> {
    const user = await this.repo.updateName(userId, name.trim());
    return this.toPublicUser(user);
  }

  async getMe(userId: string, activeOrgId?: string | null): Promise<PublicUserDto | null> {
    const user = await this.repo.findById(userId);
    if (!user) return null;
    const activeMembership = activeOrgId
      ? await this.prisma.membership.findFirst({
          where: { userId, orgId: activeOrgId, org: { deletedAt: null } },
          select: { orgId: true, role: true },
        })
      : null;
    const [fresh, demoMembership, firstOwnedMembership] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { isSuperAdmin: true },
      }),
      this.prisma.membership.findFirst({
        where: { userId, role: 'demo_observer', org: { deletedAt: null } },
        select: { orgId: true, role: true },
      }),
      this.prisma.membership.findFirst({
        where: { userId, role: { not: 'demo_observer' }, org: { deletedAt: null } },
        orderBy: { joinedAt: 'asc' },
        select: { orgId: true, role: true },
      }),
    ]);
    const defaultMembership = activeMembership ?? firstOwnedMembership ?? demoMembership;
    return {
      ...this.toPublicUser(user),
      isSuperAdmin: fresh?.isSuperAdmin === true,
      currentOrgRole: defaultMembership?.role ?? null,
      currentOrgId: defaultMembership?.orgId ?? null,
    };
  }

  private async findOrCreateStandaloneForInvite(args: {
    email: string;
    name: string;
    passwordHash?: string;
  }): Promise<User> {
    const existing = await this.repo.findStandaloneByEmail(args.email);
    if (existing) return existing;
    const passwordHash =
      args.passwordHash ?? (await this.passwords.hash(AccountsService.generateTempPassword()));
    return this.repo.upsertStandalone({
      email: args.email,
      name: args.name,
      passwordHash,
      mustChangePassword: true,
    });
  }

  private async tryLoginViaInvitation(
    email: string,
    password: string,
    meta: { userAgent?: string | null; ip?: string | null },
  ): Promise<LoginResult | null> {
    const result = await this.orgInvitations.acceptViaPassword({
      email,
      password,
      upsertUserByEmail: async (args) => {
        const user = await this.findOrCreateStandaloneForInvite(args);
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
    if (!result) return null;

    const user = await this.repo.findById(result.userId);
    if (!user) return null;

    return {
      user: this.toPublicUser(user),
      token: result.sessionToken,
      mustChangePassword: user.mustChangePassword,
    };
  }

  private toPublicUser(user: User): PublicUserDto {
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
    return randomBytes(TEMP_PASSWORD_BYTES).toString('base64url');
  }

  static hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
