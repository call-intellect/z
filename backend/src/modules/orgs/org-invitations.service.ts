import { createHash, randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { MembershipRole, OrgInvitation, Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PasswordService } from '../accounts/password.service';
import { ConversationalLinkCodeService } from '../conversational/link-code.service';
import { MailService } from '../mail/mail.service';
import {
  MEMBERSHIP_CREATED,
  type MembershipCreatedPayload,
} from '../messaging/messaging.events';
import { RbacService } from '../rbac/rbac.service';


const INVITATION_TOKEN_LEN = 40;
const MAGIC_TOKEN_LEN = 40;

export interface OrgInvitationDomain {
  id: string;
  orgId: string;
  orgName: string;
  email: string | null;
  role: MembershipRole;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
}

export interface OrgInvitationCreateResult extends OrgInvitationDomain {
  linkCode: string;
  magicLinkUrl: string;
  telegramDeepLink: string;
  manualShareUrl: string;
  qrCodeDataUrl: string | null;
}

export interface AcceptViaMagicLinkResult {
  orgId: string;
  userId: string;
  sessionToken: string;
  membership: { role: MembershipRole; joinedAt: string };
}

@Injectable()
export class OrgInvitationsService {
  private readonly logger = new Logger(OrgInvitationsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ConversationalLinkCodeService)
    private readonly linkCodes: ConversationalLinkCodeService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(EventEmitter2) private readonly events: EventEmitter2,
    @Inject(PasswordService) private readonly passwords: PasswordService,
  ) {}

  private emitMembershipCreated(payload: MembershipCreatedPayload): void {
    this.events.emit(MEMBERSHIP_CREATED, payload);
  }

  async createInvitation(input: {
    orgId: string;
    actorUserId: string;
    email?: string | null;
    name?: string | null;
    role: MembershipRole;
    personId?: string | null;
  }): Promise<OrgInvitationCreateResult> {
    const ctx = await this.rbac.loadContext(input.actorUserId, input.orgId);
    if (!ctx || (ctx.role !== 'owner' && ctx.role !== 'admin' && !ctx.isSuperAdmin)) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Приглашать сотрудников может только владелец или администратор компании',
        },
      });
    }

    let resolvedPerson: { email: string | null; name: string } | null = null;
    if (input.personId) {
      const person = await this.prisma.person.findUnique({
        where: { id: input.personId },
        select: {
          tenantId: true,
          deletedAt: true,
          userId: true,
          email: true,
          name: true,
        },
      });
      if (!person || person.tenantId !== input.orgId || person.deletedAt) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'person_not_found',
            message: 'Сотрудник не найден в этой компании',
          },
        });
      }
      resolvedPerson = { email: person.email, name: person.name };

      const existingByPerson = await this.prisma.orgInvitation.findFirst({
        where: {
          orgId: input.orgId,
          personId: input.personId,
          status: 'pending',
        },
      });
      if (existingByPerson) {
        throw new ConflictException({
          ok: false,
          error: {
            code: 'invitation_already_exists',
            message: 'Этому сотруднику уже отправлено активное приглашение',
          },
        });
      }
    }

    const effectiveEmail = input.email ?? resolvedPerson?.email ?? null;
    const effectiveName = input.name ?? resolvedPerson?.name ?? null;

    const normalizedEmail =
      typeof effectiveEmail === 'string' && effectiveEmail.trim().length > 0
        ? effectiveEmail.trim().toLowerCase()
        : null;
    const displayName =
      (effectiveName?.trim() ||
        (normalizedEmail ? normalizedEmail.split('@')[0] : null) ||
        'Сотрудник').slice(0, 120);

    let existingStandaloneUser: { id: string; name: string } | null = null;
    if (normalizedEmail) {
      const existing = await this.prisma.orgInvitation.findFirst({
        where: { orgId: input.orgId, email: normalizedEmail, status: 'pending' },
      });
      if (existing) {
        throw new ConflictException({
          ok: false,
          error: {
            code: 'invitation_already_exists',
            message: 'На эту электронную почту уже есть активное приглашение',
          },
        });
      }
      existingStandaloneUser = await this.prisma.user.findFirst({
        where: { email: normalizedEmail, signupSource: 'standalone', deletedAt: null },
        select: { id: true, name: true },
      });
      if (existingStandaloneUser) {
        const existingMembership = await this.prisma.membership.findUnique({
          where: { orgId_userId: { orgId: input.orgId, userId: existingStandaloneUser.id } },
        });
        if (existingMembership) {
          throw new ConflictException({
            ok: false,
            error: {
              code: 'already_member',
              message: 'Этот пользователь уже состоит в компании',
            },
          });
        }
      }
    }

    const ttlDays = this.cfg.invites.ttlDays;
    const ttlSec = ttlDays * 86_400;
    const token = nanoid(INVITATION_TOKEN_LEN);
    const magicToken = nanoid(MAGIC_TOKEN_LEN);
    const magicTokenHash = sha256Hex(magicToken);
    const expiresAt = new Date(Date.now() + ttlSec * 1000);

    const tempPassword =
      normalizedEmail && !existingStandaloneUser ? generateInviteTempPassword() : null;
    const tempPasswordHash = tempPassword ? await this.passwords.hash(tempPassword) : null;

    const linkCodeOwner =
      input.actorUserId;
    const { code: linkCode } = await this.linkCodes.generateInviteCode({
      userId: linkCodeOwner,
      ttlSec,
    });

    const invitation = await this.prisma.orgInvitation.create({
      data: {
        orgId: input.orgId,
        email: normalizedEmail,
        role: input.role,
        token,
        status: 'pending',
        invitedBy: input.actorUserId,
        expiresAt,
        linkCode,
        magicTokenHash,
        tempPasswordHash,
        personId: input.personId ?? null,
      },
      include: { org: { select: { name: true } }, inviter: { select: { name: true } } },
    });

    void this.prisma.org.updateMany({
      where: { id: input.orgId, teamInvitedAt: null },
      data: { teamInvitedAt: new Date() },
    });

    const magicLinkUrl = this.buildMagicLinkUrl(magicToken);
    const telegramDeepLink = this.buildTelegramDeepLink(linkCode);
    const manualShareUrl = magicLinkUrl;
    const qrCodeDataUrl = await this.tryBuildQrCode(magicLinkUrl);

    if (normalizedEmail) {
      const inviterName = invitation.inviter?.name ?? 'Руководитель';
      const sendResult = existingStandaloneUser
        ? await this.mail.sendInviteNotification({
            to: normalizedEmail,
            name: existingStandaloneUser.name || displayName,
            inviterName,
            orgName: invitation.org.name,
            loginUrl: this.buildLoginUrl(),
            magicLinkUrl,
            telegramDeepLink,
            ttlDays,
          })
        : await this.mail.sendInviteWithCredentials({
            to: normalizedEmail,
            name: displayName,
            inviterName,
            orgName: invitation.org.name,
            loginEmail: normalizedEmail,
            tempPassword: tempPassword as string,
            loginUrl: this.buildLoginUrl(),
            magicLinkUrl,
            telegramDeepLink,
            ttlDays,
          });
      if (!sendResult.ok) {
        this.logger.warn(
          {
            email: normalizedEmail,
            err: sendResult.error,
            existingUser: Boolean(existingStandaloneUser),
          },
          'createInvitation: ошибка отправки письма (инвайт сохранён, можно переслать вручную)',
        );
      }
    } else {
      this.logger.log(
        { orgId: input.orgId, invitationId: invitation.id },
        'createInvitation: email не указан, директор копирует ссылку вручную',
      );
    }

    this.metrics.incInviteCreated({ hasEmail: Boolean(normalizedEmail) });

    return {
      ...this.toDomain(invitation, invitation.org.name),
      linkCode,
      magicLinkUrl,
      telegramDeepLink,
      manualShareUrl,
      qrCodeDataUrl,
    };
  }

  async resendInvitation(
    orgId: string,
    invitationId: string,
    actorUserId: string,
  ): Promise<OrgInvitationCreateResult> {
    const ctx = await this.rbac.loadContext(actorUserId, orgId);
    if (!ctx || (ctx.role !== 'owner' && ctx.role !== 'admin' && !ctx.isSuperAdmin)) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Перевыпускать приглашение может только владелец или администратор',
        },
      });
    }
    const invite = await this.prisma.orgInvitation.findFirst({
      where: { id: invitationId, orgId },
      include: { org: { select: { name: true } }, inviter: { select: { name: true } } },
    });
    if (!invite) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'invitation_not_found', message: 'Приглашение не найдено' },
      });
    }
    if (invite.status === 'accepted') {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invitation_already_accepted',
          message: 'Это приглашение уже принято — повторно выпускать нечего',
        },
      });
    }

    const ttlDays = this.cfg.invites.ttlDays;
    const ttlSec = ttlDays * 86_400;
    const magicToken = nanoid(MAGIC_TOKEN_LEN);
    const magicTokenHash = sha256Hex(magicToken);
    const expiresAt = new Date(Date.now() + ttlSec * 1000);
    const { code: linkCode } = await this.linkCodes.generateInviteCode({
      userId: actorUserId,
      ttlSec,
    });

    const resendEmail = invite.email;
    const existingStandaloneUser = resendEmail
      ? await this.prisma.user.findFirst({
          where: { email: resendEmail, signupSource: 'standalone', deletedAt: null },
          select: { id: true, name: true },
        })
      : null;
    const tempPassword =
      resendEmail && !existingStandaloneUser ? generateInviteTempPassword() : null;
    const tempPasswordHash = tempPassword ? await this.passwords.hash(tempPassword) : null;

    const updated = await this.prisma.orgInvitation.update({
      where: { id: invitationId },
      data: {
        linkCode,
        linkCodeUsedAt: null,
        magicTokenHash,
        magicTokenUsedAt: null,
        tempPasswordHash,
        expiresAt,
        status: 'pending',
        reminderSentAt: null,
        directorNotifiedAt: null,
      },
      include: { org: { select: { name: true } }, inviter: { select: { name: true } } },
    });

    const magicLinkUrl = this.buildMagicLinkUrl(magicToken);
    const telegramDeepLink = this.buildTelegramDeepLink(linkCode);
    const qrCodeDataUrl = await this.tryBuildQrCode(magicLinkUrl);
    const displayName = updated.email
      ? (updated.email.split('@')[0] ?? 'Сотрудник')
      : 'Сотрудник';

    if (updated.email) {
      const inviterName = updated.inviter?.name ?? 'Руководитель';
      const sendResult = existingStandaloneUser
        ? await this.mail.sendInviteNotification({
            to: updated.email,
            name: existingStandaloneUser.name || displayName,
            inviterName,
            orgName: updated.org.name,
            loginUrl: this.buildLoginUrl(),
            magicLinkUrl,
            telegramDeepLink,
            ttlDays,
          })
        : await this.mail.sendInviteWithCredentials({
            to: updated.email,
            name: displayName,
            inviterName,
            orgName: updated.org.name,
            loginEmail: updated.email,
            tempPassword: tempPassword as string,
            loginUrl: this.buildLoginUrl(),
            magicLinkUrl,
            telegramDeepLink,
            ttlDays,
          });
      if (!sendResult.ok) {
        this.logger.warn(
          {
            email: updated.email,
            err: sendResult.error,
            existingUser: Boolean(existingStandaloneUser),
          },
          'resendInvitation: ошибка отправки письма',
        );
      }
    }

    return {
      ...this.toDomain(updated, updated.org.name),
      linkCode,
      magicLinkUrl,
      telegramDeepLink,
      manualShareUrl: magicLinkUrl,
      qrCodeDataUrl,
    };
  }

  async acceptInvitation(token: string, userId: string): Promise<{
    orgId: string;
    membership: { role: MembershipRole; joinedAt: string };
  }> {
    const invite = await this.prisma.orgInvitation.findUnique({
      where: { token },
      include: { org: true },
    });
    if (!invite) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'invitation_not_found', message: 'Приглашение не найдено' },
      });
    }
    if (invite.status !== 'pending') {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invitation_not_pending',
          message: `Приглашение в статусе ${invite.status}`,
        },
      });
    }
    if (invite.expiresAt.getTime() <= Date.now()) {
      await this.prisma.orgInvitation.update({
        where: { id: invite.id },
        data: { status: 'expired' },
      });
      this.metrics.incInviteExpired();
      throw new BadRequestException({
        ok: false,
        error: { code: 'invitation_expired', message: 'Срок действия приглашения истёк' },
      });
    }

    const existingMembership = await this.prisma.membership.findUnique({
      where: { orgId_userId: { orgId: invite.orgId, userId } },
    });
    if (existingMembership) {
      await this.prisma.orgInvitation.update({
        where: { id: invite.id },
        data: {
          status: 'accepted',
          acceptedAt: new Date(),
          acceptedByUserId: userId,
        },
      });
      this.metrics.incInviteAccepted({ path: 'password' });
      return {
        orgId: invite.orgId,
        membership: {
          role: existingMembership.role,
          joinedAt: existingMembership.joinedAt.toISOString(),
        },
      };
    }

    const membership = await this.prisma.$transaction(async (tx) =>
      this.acceptInsideTransaction({
        tx,
        invitationId: invite.id,
        userId,
        orgId: invite.orgId,
        role: invite.role,
        invitedBy: invite.invitedBy,
        personId: invite.personId,
      }),
    );

    this.rbac.invalidate(userId, invite.orgId);
    this.metrics.incInviteAccepted({ path: 'password' });
    this.emitMembershipCreated({ tenantId: invite.orgId, userId });

    return {
      orgId: invite.orgId,
      membership: {
        role: membership.role,
        joinedAt: membership.joinedAt.toISOString(),
      },
    };
  }

  async acceptViaMagicLink(input: {
    magicToken: string;
    issueSession: (args: {
      userId: string;
      email: string;
      role: 'user' | 'admin';
    }) => Promise<{ token: string }>;
    upsertUserByEmail: (args: {
      email: string;
      name: string;
      passwordHash?: string;
    }) => Promise<{ id: string; email: string; role: 'user' | 'admin' }>;
    createUserWithoutEmail: (args: { name: string; passwordHash?: string }) => Promise<{
      id: string;
      email: string;
      role: 'user' | 'admin';
    }>;
  }): Promise<AcceptViaMagicLinkResult> {
    const magicTokenHash = sha256Hex(input.magicToken);
    const invite = await this.prisma.orgInvitation.findUnique({
      where: { magicTokenHash },
      include: { org: { select: { name: true, id: true } } },
    });
    if (!invite) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'invitation_not_found', message: 'Ссылка приглашения не найдена' },
      });
    }
    if (invite.magicTokenUsedAt !== null) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'magic_link_already_used',
          message: 'Эта ссылка уже была использована — попросите перевыпустить приглашение',
        },
      });
    }
    if (invite.status !== 'pending') {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invitation_not_pending',
          message: `Приглашение в статусе ${invite.status}`,
        },
      });
    }
    if (invite.expiresAt.getTime() <= Date.now()) {
      await this.prisma.orgInvitation.update({
        where: { id: invite.id },
        data: { status: 'expired' },
      });
      this.metrics.incInviteExpired();
      throw new BadRequestException({
        ok: false,
        error: { code: 'invitation_expired', message: 'Срок действия приглашения истёк' },
      });
    }

    const displayName = invite.email
      ? (invite.email.split('@')[0] ?? 'Сотрудник')
      : 'Сотрудник';
    const passwordHash = invite.tempPasswordHash ?? undefined;
    const user = invite.email
      ? await input.upsertUserByEmail({ email: invite.email, name: displayName, passwordHash })
      : await input.createUserWithoutEmail({ name: displayName, passwordHash });

    const membership = await this.prisma.$transaction(async (tx) => {
      const m = await this.acceptInsideTransaction({
        tx,
        invitationId: invite.id,
        userId: user.id,
        orgId: invite.orgId,
        role: invite.role,
        invitedBy: invite.invitedBy,
        personId: invite.personId,
      });
      await tx.orgInvitation.update({
        where: { id: invite.id },
        data: { magicTokenUsedAt: new Date() },
      });
      return m;
    });

    this.rbac.invalidate(user.id, invite.orgId);
    this.emitMembershipCreated({ tenantId: invite.orgId, userId: user.id });

    const { token } = await input.issueSession({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    this.metrics.incInviteAccepted({ path: 'magic_link' });

    return {
      orgId: invite.orgId,
      userId: user.id,
      sessionToken: token,
      membership: {
        role: membership.role,
        joinedAt: membership.joinedAt.toISOString(),
      },
    };
  }

  async acceptViaPassword(input: {
    email: string;
    password: string;
    upsertUserByEmail: (args: {
      email: string;
      name: string;
      passwordHash: string;
    }) => Promise<{ id: string; email: string; role: 'user' | 'admin' }>;
    issueSession: (args: {
      userId: string;
      email: string;
      role: 'user' | 'admin';
    }) => Promise<{ token: string }>;
  }): Promise<AcceptViaMagicLinkResult | null> {
    const email = input.email.trim().toLowerCase();
    if (!email) return null;

    const candidates = await this.prisma.orgInvitation.findMany({
      where: { email, status: 'pending', tempPasswordHash: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    let invite: (typeof candidates)[number] | null = null;
    for (const candidate of candidates) {
      if (
        candidate.tempPasswordHash &&
        (await this.passwords.verify(candidate.tempPasswordHash, input.password))
      ) {
        invite = candidate;
        break;
      }
    }
    if (!invite || !invite.email || !invite.tempPasswordHash) return null;

    if (invite.expiresAt.getTime() <= Date.now()) {
      await this.prisma.orgInvitation.update({
        where: { id: invite.id },
        data: { status: 'expired' },
      });
      this.metrics.incInviteExpired();
      return null;
    }

    const displayName = invite.email.split('@')[0] ?? 'Сотрудник';
    const user = await input.upsertUserByEmail({
      email: invite.email,
      name: displayName,
      passwordHash: invite.tempPasswordHash,
    });

    const accepted = invite;
    const membership = await this.prisma.$transaction(async (tx) =>
      this.acceptInsideTransaction({
        tx,
        invitationId: accepted.id,
        userId: user.id,
        orgId: accepted.orgId,
        role: accepted.role,
        invitedBy: accepted.invitedBy,
        personId: accepted.personId,
      }),
    );

    this.rbac.invalidate(user.id, invite.orgId);
    this.metrics.incInviteAccepted({ path: 'password' });
    this.emitMembershipCreated({ tenantId: invite.orgId, userId: user.id });

    const { token } = await input.issueSession({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      orgId: invite.orgId,
      userId: user.id,
      sessionToken: token,
      membership: {
        role: membership.role,
        joinedAt: membership.joinedAt.toISOString(),
      },
    };
  }

  async listForOrg(orgId: string, actorUserId: string): Promise<OrgInvitationDomain[]> {
    const ctx = await this.rbac.loadContext(actorUserId, orgId);
    if (!ctx || (ctx.role !== 'owner' && ctx.role !== 'admin' && !ctx.isSuperAdmin)) {
      throw new ForbiddenException({ ok: false, error: { code: 'forbidden' } });
    }
    const invites = await this.prisma.orgInvitation.findMany({
      where: { orgId },
      include: { org: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return invites.map((i) => this.toDomain(i, i.org.name));
  }

  async revoke(orgId: string, invitationId: string, actorUserId: string): Promise<void> {
    const ctx = await this.rbac.loadContext(actorUserId, orgId);
    if (!ctx || (ctx.role !== 'owner' && ctx.role !== 'admin' && !ctx.isSuperAdmin)) {
      throw new ForbiddenException({ ok: false, error: { code: 'forbidden' } });
    }
    const invite = await this.prisma.orgInvitation.findFirst({
      where: { id: invitationId, orgId },
    });
    if (!invite) {
      throw new NotFoundException({ ok: false, error: { code: 'invitation_not_found' } });
    }
    if (invite.status !== 'pending') {
      throw new BadRequestException({
        ok: false,
        error: { code: 'invitation_not_pending' },
      });
    }
    await this.prisma.orgInvitation.update({
      where: { id: invitationId },
      data: { status: 'revoked' },
    });
  }

  async resetMemberTelegramBinding(input: {
    orgId: string;
    targetUserId: string;
    actorUserId: string;
  }): Promise<{ removed: number }> {
    const ctx = await this.rbac.loadContext(input.actorUserId, input.orgId);
    if (!ctx || (ctx.role !== 'owner' && ctx.role !== 'admin' && !ctx.isSuperAdmin)) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Сбрасывать привязку может только владелец или администратор',
        },
      });
    }
    const targetMembership = await this.prisma.membership.findUnique({
      where: { orgId_userId: { orgId: input.orgId, userId: input.targetUserId } },
    });
    if (!targetMembership) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'membership_not_found', message: 'Сотрудник не найден в этой компании' },
      });
    }

    const deleted = await this.prisma.channelBinding.deleteMany({
      where: {
        userId: input.targetUserId,
        channel: { kind: 'telegram_bot' },
      },
    });
    this.logger.log(
      { orgId: input.orgId, targetUserId: input.targetUserId, removed: deleted.count },
      'resetMemberTelegramBinding: привязки удалены',
    );
    return { removed: deleted.count };
  }

  private async acceptInsideTransaction(args: {
    tx: Prisma.TransactionClient;
    invitationId: string;
    userId: string;
    orgId: string;
    role: MembershipRole;
    invitedBy: string;
    personId: string | null;
  }): Promise<{ role: MembershipRole; joinedAt: Date }> {
    await args.tx.orgInvitation.update({
      where: { id: args.invitationId },
      data: {
        status: 'accepted',
        acceptedAt: new Date(),
        acceptedByUserId: args.userId,
      },
    });

    let personIdForMembership: string | null = null;
    if (args.personId) {
      const person = await args.tx.person.findUnique({
        where: { id: args.personId },
        select: { tenantId: true, userId: true, deletedAt: true },
      });
      if (
        person &&
        person.tenantId === args.orgId &&
        !person.deletedAt &&
        person.userId === null
      ) {
        await args.tx.person.update({
          where: { id: args.personId },
          data: { userId: args.userId },
        });
        personIdForMembership = args.personId;
      } else {
        this.logger.warn(
          { invitationId: args.invitationId, personId: args.personId },
          'acceptInsideTransaction: Person для линковки уже занят/удалён/из чужой Org — пропускаем',
        );
      }
    }

    return args.tx.membership.create({
      data: {
        orgId: args.orgId,
        userId: args.userId,
        role: args.role,
        invitedBy: args.invitedBy,
        personId: personIdForMembership,
      },
    });
  }

  private buildMagicLinkUrl(magicToken: string): string {
    const base = this.cfg.auth.publicFrontendUrl.replace(/\/+$/, '');
    return `${base}/invite/${magicToken}`;
  }

  private buildLoginUrl(): string {
    const base = this.cfg.auth.publicFrontendUrl.replace(/\/+$/, '');
    return `${base}/login`;
  }

  private buildTelegramDeepLink(linkCode: string): string {
    const username = this.cfg.invites.botUsername;
    return `https://t.me/${username}?start=${linkCode}`;
  }

  private async tryBuildQrCode(_url: string): Promise<string | null> {
    return null;
  }

  private toDomain(i: OrgInvitation, orgName: string): OrgInvitationDomain {
    return {
      id: i.id,
      orgId: i.orgId,
      orgName,
      email: i.email,
      role: i.role,
      status: i.status,
      invitedBy: i.invitedBy,
      createdAt: i.createdAt.toISOString(),
      expiresAt: i.expiresAt.toISOString(),
      acceptedAt: i.acceptedAt ? i.acceptedAt.toISOString() : null,
    };
  }
}

function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function generateInviteTempPassword(): string {
  return randomBytes(15).toString('base64url');
}
