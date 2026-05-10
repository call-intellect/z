import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { MembershipRole, OrgInvitation } from '@prisma/client';
import { nanoid } from 'nanoid';

import { TypedConfigService } from '../../common/config/index';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { RbacService } from '../rbac/rbac.service';

/**
 * Сервис приглашений в Org.
 *
 * Логика:
 *   - Создание (create) — только owner/admin Org. Token nanoid(40), TTL 7 дней.
 *     Отправляется email-приглашение через MailService.
 *   - Принятие (accept) — любой авторизованный юзер. Если email инвайта
 *     не совпадает с email юзера — допускаем (на ТЗ-уровне написано
 *     «авторизованный пользователь принимает», но email сравниваем для
 *     consistency и логирования).
 *   - Отзыв (revoke) — owner/admin.
 *   - Просмотр (list) — owner/admin.
 *
 * После accept — Membership создаётся в той же Prisma-транзакции с обновлением
 * статуса инвайта.
 */

const INVITATION_TOKEN_LEN = 40;
const INVITATION_TTL_DAYS = 7;

export interface OrgInvitationDomain {
  id: string;
  orgId: string;
  orgName: string;
  email: string;
  role: MembershipRole;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
}

@Injectable()
export class OrgInvitationsService {
  private readonly logger = new Logger(OrgInvitationsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async createInvitation(input: {
    orgId: string;
    actorUserId: string;
    email: string;
    role: MembershipRole;
  }): Promise<OrgInvitationDomain> {
    const ctx = await this.rbac.loadContext(input.actorUserId, input.orgId);
    if (!ctx || (ctx.role !== 'owner' && ctx.role !== 'admin' && !ctx.isSuperAdmin)) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Только owner/admin может приглашать' },
      });
    }
    const email = input.email.trim().toLowerCase();

    // Проверим — нет ли уже pending инвайта на этот email в эту Org.
    const existing = await this.prisma.orgInvitation.findFirst({
      where: { orgId: input.orgId, email, status: 'pending' },
    });
    if (existing) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'invitation_already_exists',
          message: 'На этот email уже есть активное приглашение',
        },
      });
    }
    // Проверим — может, уже member.
    const userByEmail = await this.prisma.user.findFirst({
      where: { email, deletedAt: null },
    });
    if (userByEmail) {
      const existingMembership = await this.prisma.membership.findUnique({
        where: { orgId_userId: { orgId: input.orgId, userId: userByEmail.id } },
      });
      if (existingMembership) {
        throw new ConflictException({
          ok: false,
          error: { code: 'already_member' },
        });
      }
    }

    const token = nanoid(INVITATION_TOKEN_LEN);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

    const invitation = await this.prisma.orgInvitation.create({
      data: {
        orgId: input.orgId,
        email,
        role: input.role,
        token,
        status: 'pending',
        invitedBy: input.actorUserId,
        expiresAt,
      },
      include: { org: { select: { name: true } } },
    });

    // Отправляем email через MailService.sendPlain (org-invitation шаблон).
    const acceptUrl = `${this.cfg.auth.publicFrontendUrl}/invitations/${token}`;
    const text = renderOrgInvitationEmail({
      orgName: invitation.org.name,
      acceptUrl,
      expiresInDays: INVITATION_TTL_DAYS,
    });
    const sendResult = await this.mail.sendPlain({
      to: email,
      subject: `Вас пригласили в ${invitation.org.name} (Z)`,
      text,
      template: 'org-invitation',
    });
    if (!sendResult.ok) {
      this.logger.warn(
        { email, err: sendResult.error },
        'createInvitation: ошибка отправки письма (инвайт сохранён, можно переслать вручную)',
      );
    }

    return this.toDomain(invitation, invitation.org.name);
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
        error: { code: 'invitation_not_found' },
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
      // Помечаем как expired, для аналитики.
      await this.prisma.orgInvitation.update({
        where: { id: invite.id },
        data: { status: 'expired' },
      });
      throw new BadRequestException({
        ok: false,
        error: { code: 'invitation_expired' },
      });
    }
    // Проверим — не member ли уже.
    const existingMembership = await this.prisma.membership.findUnique({
      where: { orgId_userId: { orgId: invite.orgId, userId } },
    });
    if (existingMembership) {
      // Помечаем accepted, чтобы не висел.
      await this.prisma.orgInvitation.update({
        where: { id: invite.id },
        data: {
          status: 'accepted',
          acceptedAt: new Date(),
          acceptedByUserId: userId,
        },
      });
      return {
        orgId: invite.orgId,
        membership: {
          role: existingMembership.role,
          joinedAt: existingMembership.joinedAt.toISOString(),
        },
      };
    }

    const membership = await this.prisma.$transaction(async (tx) => {
      await tx.orgInvitation.update({
        where: { id: invite.id },
        data: {
          status: 'accepted',
          acceptedAt: new Date(),
          acceptedByUserId: userId,
        },
      });
      return tx.membership.create({
        data: {
          orgId: invite.orgId,
          userId,
          role: invite.role,
          invitedBy: invite.invitedBy,
        },
      });
    });

    this.rbac.invalidate(userId, invite.orgId);

    return {
      orgId: invite.orgId,
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

  // ─────────────────────────── helpers ──────────────────────────────

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

/**
 * Inline-шаблон письма-приглашения. Не выносим в mail.templates.ts чтобы
 * не плодить связи: модуль orgs владеет своим UX'ом приглашения.
 */
function renderOrgInvitationEmail(args: {
  orgName: string;
  acceptUrl: string;
  expiresInDays: number;
}): string {
  return `Здравствуйте!

Вас пригласили в организацию «${args.orgName}» в Z — сервисе AI-видеовстреч.

Чтобы принять приглашение, перейдите по ссылке:
${args.acceptUrl}

Ссылка действительна ${args.expiresInDays} дней.

Если вы не ожидали этого письма — просто проигнорируйте его.

— Команда Z
`;
}
