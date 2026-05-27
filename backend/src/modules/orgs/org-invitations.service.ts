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
import type { MembershipRole, OrgInvitation, Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConversationalLinkCodeService } from '../conversational/link-code.service';
import { MailService } from '../mail/mail.service';
import { RbacService } from '../rbac/rbac.service';

/**
 * Сервис приглашений в Org.
 *
 * β-9 (2026-05-25) — GitHub-style flow:
 *   - email теперь опционален; если не задан, директор копирует
 *     `manualShareUrl` + `linkCode` руками.
 *   - Создание (createInvitation) — только owner/admin. Генерится
 *     одноразовый `linkCode` (через `ConversationalLinkCodeService`,
 *     длинный TTL = `invites.ttlDays * 86400`) для прямой привязки
 *     Telegram-бота из письма + `magicTokenHash` (sha256 от случайного
 *     nanoid(40)) для одноразового входа без пароля.
 *   - Принятие (acceptViaMagicLink) — без auth: проверяем magicToken,
 *     создаём/находим User, добавляем Membership, открываем сессию.
 *   - Принятие (acceptInvitation) — старый путь по token, для уже
 *     авторизованных пользователей (backward-compat).
 *   - Перевыпуск (resend) — новый `linkCode` + `magicTokenHash`, повторное
 *     письмо.
 *   - Валидация «один user = одна Org» — при создании Membership.
 *
 * См. plans/tz/2026-05-25-telegram-bot-global-and-invites.md §7 и §11,
 * second-brain/01_projects/conversational-channels.md §«Продуктовые
 * принципы каналов» (принципы 2, 3, 4).
 */

const INVITATION_TOKEN_LEN = 40;
const MAGIC_TOKEN_LEN = 40;

export interface OrgInvitationDomain {
  id: string;
  orgId: string;
  orgName: string;
  /** β-9: nullable — может не быть электронной почты у линейного персонала. */
  email: string | null;
  role: MembershipRole;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
}

/**
 * Результат `createInvitation` / `resendInvitation` — кроме domain-полей,
 * возвращает «горячие» поля для UI директора: deep-link бота, magic-link
 * URL (для копирования вручную при отсутствии электронной почты) и
 * QR-код (data-url base64 PNG, либо null если генерация невозможна).
 */
export interface OrgInvitationCreateResult extends OrgInvitationDomain {
  linkCode: string;
  magicLinkUrl: string;
  telegramDeepLink: string;
  manualShareUrl: string;
  qrCodeDataUrl: string | null;
}

/**
 * Результат `acceptViaMagicLink` — открытая сессия для нового User'а.
 */
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
  ) {}

  async createInvitation(input: {
    orgId: string;
    actorUserId: string;
    /** β-9: опционально. Если пусто — письмо не шлём, возвращаем `manualShareUrl`. */
    email?: string | null;
    /** Имя сотрудника — для шаблона письма и Person. Если не передано — берём localpart email'а. */
    name?: string | null;
    role: MembershipRole;
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

    const normalizedEmail =
      typeof input.email === 'string' && input.email.trim().length > 0
        ? input.email.trim().toLowerCase()
        : null;
    const displayName =
      (input.name?.trim() ||
        (normalizedEmail ? normalizedEmail.split('@')[0] : null) ||
        'Сотрудник').slice(0, 120);

    // Проверим — нет ли уже pending инвайта на этот email в эту Org.
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
      // Проверим — может, уже member.
      const userByEmail = await this.prisma.user.findFirst({
        where: { email: normalizedEmail, deletedAt: null },
      });
      if (userByEmail) {
        const existingMembership = await this.prisma.membership.findUnique({
          where: { orgId_userId: { orgId: input.orgId, userId: userByEmail.id } },
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

    // β-10: одноразовый пароль для credentials-onboarding. Генерируем только
    // для email-инвайтов — линейный персонал без почты получает только magic-link.
    const tempPassword = normalizedEmail ? generateInviteTempPassword() : null;
    const tempPasswordHash = tempPassword ? sha256Hex(tempPassword) : null;

    // β-9: linkCode для прямой привязки Telegram — кладём в Redis с тем же TTL
    // через ConversationalLinkCodeService.generateInviteCode (отдельный namespace
    // `conv:invite:telegram_bot:<code>`).
    const linkCodeOwner =
      input.actorUserId; /* пользователь, чей invite — для аудита; реальный приглашаемый user'а пока нет */
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
      },
      include: { org: { select: { name: true } }, inviter: { select: { name: true } } },
    });

    const magicLinkUrl = this.buildMagicLinkUrl(magicToken);
    const telegramDeepLink = this.buildTelegramDeepLink(linkCode);
    const manualShareUrl = magicLinkUrl; // одна ссылка, директор её и копирует
    const qrCodeDataUrl = await this.tryBuildQrCode(magicLinkUrl);

    // Письмо — только если есть email.
    if (normalizedEmail && tempPassword) {
      // β-10: credentials-onboarding — письмо с логином и одноразовым паролем.
      const sendResult = await this.mail.sendInviteWithCredentials({
        to: normalizedEmail,
        name: displayName,
        inviterName: invitation.inviter?.name ?? 'Руководитель',
        orgName: invitation.org.name,
        loginEmail: normalizedEmail,
        tempPassword,
        loginUrl: this.buildLoginUrl(),
        magicLinkUrl,
        telegramDeepLink,
        ttlDays,
      });
      if (!sendResult.ok) {
        this.logger.warn(
          { email: normalizedEmail, err: sendResult.error },
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

  /**
   * β-9 — перевыпуск приглашения: новый `linkCode` + `magicTokenHash`,
   * старый `linkCode` теряет TTL и письмо отправляется заново.
   */
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

    // β-10: регенерируем tempPassword вместе с magicToken для email-инвайтов.
    const resendEmail = invite.email;
    const tempPassword = resendEmail ? generateInviteTempPassword() : null;
    const tempPasswordHash = tempPassword ? sha256Hex(tempPassword) : null;

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

    if (updated.email && tempPassword) {
      // β-10: credentials-onboarding — письмо с новым одноразовым паролем.
      const sendResult = await this.mail.sendInviteWithCredentials({
        to: updated.email,
        name: displayName,
        inviterName: updated.inviter?.name ?? 'Руководитель',
        orgName: updated.org.name,
        loginEmail: updated.email,
        tempPassword,
        loginUrl: this.buildLoginUrl(),
        magicLinkUrl,
        telegramDeepLink,
        ttlDays,
      });
      if (!sendResult.ok) {
        this.logger.warn(
          { email: updated.email, err: sendResult.error },
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

  /**
   * Старый путь: принять приглашение уже авторизованным пользователем.
   * Используется когда пользователь вошёл в кабинет и кликнул accept-кнопку.
   *
   * β-9: добавлена валидация «один user = одна Org».
   */
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

    // Если уже member — просто помечаем accepted (идемпотентно).
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

    // β-9: валидация «один user = одна Org».
    await this.assertNoOtherActiveMembership({
      userId,
      targetOrgId: invite.orgId,
    });

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

    return {
      orgId: invite.orgId,
      membership: {
        role: membership.role,
        joinedAt: membership.joinedAt.toISOString(),
      },
    };
  }

  /**
   * β-9 — принять приглашение по magic-link (один клик из письма).
   *
   * Алгоритм:
   *   1. Найти OrgInvitation по sha256(magicToken).
   *   2. Проверить, что не использован и не протух.
   *   3. Найти или создать User (по email если есть — upsert; иначе
   *      создаём без email).
   *   4. Валидировать «один user = одна Org» — если у user'а уже есть
   *      другой активный Membership → ConflictException.
   *   5. В транзакции: создать Membership, прожечь magicTokenUsedAt,
   *      статус accepted.
   *   6. Открыть сессию — НЕ здесь (контроллер вызывает SessionService).
   *      Возвращаем userId/orgId и пусть caller выдаст cookie.
   */
  async acceptViaMagicLink(input: {
    magicToken: string;
    issueSession: (args: {
      userId: string;
      email: string;
      role: 'user' | 'admin';
    }) => Promise<{ token: string }>;
    /**
     * β-10: `passwordHash` — sha256(tempPassword) из OrgInvitation (если есть).
     * Callback должен использовать его вместо генерации нового пароля,
     * чтобы пользователь смог войти с паролем из письма.
     */
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

    // Найти или создать User. Если у приглашения есть email — upsert по нему;
    // иначе создаём «безпочтовый» аккаунт.
    const displayName = invite.email
      ? (invite.email.split('@')[0] ?? 'Сотрудник')
      : 'Сотрудник';
    // β-10: передаём tempPasswordHash из приглашения, чтобы пользователь
    // смог войти с паролем из письма (mustChangePassword=true в callback'е).
    const passwordHash = invite.tempPasswordHash ?? undefined;
    const user = invite.email
      ? await input.upsertUserByEmail({ email: invite.email, name: displayName, passwordHash })
      : await input.createUserWithoutEmail({ name: displayName, passwordHash });

    // β-9 — валидация «один user = одна Org».
    await this.assertNoOtherActiveMembership({
      userId: user.id,
      targetOrgId: invite.orgId,
    });

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

  /**
   * β-9 — сброс привязки Telegram для сотрудника (директор за него,
   * например при смене телефона). Удаляет все `ChannelBinding`-и
   * сотрудника в данной Org для глобального Telegram-канала.
   *
   * Используется эндпоинтом `DELETE /api/v1/orgs/:orgId/members/:userId/telegram-binding`.
   */
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
    // Проверим, что target — действительно член этой Org.
    const targetMembership = await this.prisma.membership.findUnique({
      where: { orgId_userId: { orgId: input.orgId, userId: input.targetUserId } },
    });
    if (!targetMembership) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'membership_not_found', message: 'Сотрудник не найден в этой компании' },
      });
    }

    // Удаляем все привязки Telegram (kind='telegram_bot') этого user'а.
    // Глобальный канал и per-tenant каналы — лучше захватить оба варианта.
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

  // ─────────────────────────── helpers ──────────────────────────────

  /**
   * β-9 — «Один user = одна Org» валидация. Проверяет, что у пользователя
   * нет другого активного `Membership` в Org, отличной от целевой.
   * При наличии — `ConflictException` с понятным русским сообщением.
   *
   * Реализуется на уровне сервиса (не БД), потому что Membership остаётся
   * many-to-many для будущей гибкости. См. ТЗ §3 решение 13 и
   * second-brain/01_projects/conversational-channels.md §«Продуктовые
   * принципы каналов» (принцип 4).
   */
  private async assertNoOtherActiveMembership(input: {
    userId: string;
    targetOrgId: string;
  }): Promise<void> {
    const otherMembership = await this.prisma.membership.findFirst({
      where: {
        userId: input.userId,
        orgId: { not: input.targetOrgId },
        org: { deletedAt: null },
      },
      include: { org: { select: { name: true } } },
    });
    if (otherMembership) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'already_in_another_org',
          message:
            `Вы уже состоите в компании «${otherMembership.org.name}». ` +
            'Чтобы перейти в новую — попросите администратора старой исключить вас.',
        },
      });
    }
  }

  /**
   * Общая логика accept: обновить статус OrgInvitation + создать Membership.
   * Используется acceptInvitation (старый путь) и acceptViaMagicLink (β-9).
   */
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

    // Линковка Person ↔ User (Фаза 0a §10).
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
    // β-9: путь `/invite/<token>` — публичный (без auth), под существующий
    // frontend route `app/invite/[token]/page.tsx`. НЕ путать с авторизованным
    // `/invitations/[token]` для legacy-flow (там нужен уже залогиненный юзер).
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

  /**
   * QR-код для magicLinkUrl. На β-9 — fallback no-op (возвращаем null),
   * библиотека генерации QR не в зависимостях бэка (директор пользуется
   * текстовой ссылкой `manualShareUrl`). Frontend (Wave 3) построит QR
   * через клиентскую библиотеку. Если в `backend/package.json` появится
   * `qrcode` — можно подключить здесь без изменения сигнатуры.
   */
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

/** Утилита: sha256 hex, как в `AccountsService.hashToken`. */
function sha256Hex(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * β-10: одноразовый пароль для credentials-onboarding в письме.
 * 9 байт → 12 base64url-символов. Та же логика, что `AccountsService.generateTempPassword`,
 * вынесена сюда чтобы избежать циклической зависимости AccountsService↔OrgInvitationsService.
 */
function generateInviteTempPassword(): string {
  return randomBytes(9).toString('base64url');
}
