import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  MembershipRole,
  Org,
  OrgVisibilityMode,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';

/**
 * Бизнес-сервис Org / Membership.
 *
 * Слой DomainModel — простые DTO-объекты с camelCase, без внутренних полей
 * Prisma. Отдаются наружу через `OrgsController`.
 */

export interface OrgDomain {
  id: string;
  name: string;
  slug: string;
  visibilityMode: OrgVisibilityMode;
  tier: 'basic' | 'pro' | 'enterprise';
  ownerId: string;
  createdAt: string;
}

export interface MembershipDomain {
  userId: string;
  email: string;
  name: string;
  role: MembershipRole;
  joinedAt: string;
  invitedBy: string | null;
}

const SLUG_RANDOM_LEN = 6;

@Injectable()
export class OrgsService {
  private readonly logger = new Logger(OrgsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  /**
   * Создать Org + Membership(owner) для текущего юзера.
   * Используется и в endpoint'е POST /orgs, и в хуке регистрации.
   */
  async createForOwner(
    input: { name: string; ownerId: string },
    tx?: Prisma.TransactionClient,
  ): Promise<Org> {
    const client = tx ?? this.prisma;
    const slug = await this.generateUniqueSlug(input.name, client);
    const org = await client.org.create({
      data: {
        name: input.name.trim(),
        slug,
        ownerId: input.ownerId,
        visibilityMode: 'open',
        tier: 'basic',
      },
    });
    await client.membership.create({
      data: {
        orgId: org.id,
        userId: input.ownerId,
        role: 'owner',
        invitedBy: null,
      },
    });
    this.rbac.invalidate(input.ownerId, org.id);
    return org;
  }

  /** Список Org текущего юзера. */
  async listForUser(userId: string): Promise<OrgDomain[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, org: { deletedAt: null } },
      include: { org: true },
      orderBy: { joinedAt: 'asc' },
    });
    return memberships.map((m) => this.toOrgDomain(m.org));
  }

  /** Получить Org по id, если у юзера есть membership. */
  async getById(orgId: string, userId: string): Promise<OrgDomain> {
    const ctx = await this.rbac.loadContext(userId, orgId);
    if (!ctx) throw new ForbiddenException({ ok: false, error: { code: 'no_membership' } });
    const org = await this.prisma.org.findFirst({
      where: { id: orgId, deletedAt: null },
    });
    if (!org) throw new NotFoundException({ ok: false, error: { code: 'org_not_found' } });
    return this.toOrgDomain(org);
  }

  /** Обновить Org (name / visibilityMode). Только owner. */
  async update(
    orgId: string,
    userId: string,
    patch: { name?: string; visibilityMode?: OrgVisibilityMode },
  ): Promise<OrgDomain> {
    const canManage = await this.rbac.canManageOrg(userId, orgId);
    if (!canManage) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Только владелец Org может менять настройки' },
      });
    }

    const data: Prisma.OrgUpdateInput = {};
    if (patch.name !== undefined) data.name = patch.name.trim();
    if (patch.visibilityMode !== undefined) data.visibilityMode = patch.visibilityMode;

    const updated = await this.prisma.org.update({
      where: { id: orgId },
      data,
    });
    // Инвалидируем кэш всех membership'ов этой Org (visibilityMode мог поменяться).
    this.rbac.invalidateAll();
    return this.toOrgDomain(updated);
  }

  /** Список членов Org. Доступно member'у любой роли. */
  async listMembers(orgId: string, userId: string): Promise<MembershipDomain[]> {
    const ctx = await this.rbac.loadContext(userId, orgId);
    if (!ctx) throw new ForbiddenException({ ok: false, error: { code: 'no_membership' } });

    const members = await this.prisma.membership.findMany({
      where: { orgId },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    return members.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      name: m.user.name,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
      invitedBy: m.invitedBy,
    }));
  }

  /** Сменить роль участника. Только owner/admin. */
  async updateMember(
    orgId: string,
    actorUserId: string,
    targetUserId: string,
    newRole: MembershipRole,
  ): Promise<MembershipDomain> {
    const ctx = await this.rbac.loadContext(actorUserId, orgId);
    if (!ctx || (ctx.role !== 'owner' && ctx.role !== 'admin' && !ctx.isSuperAdmin)) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden' },
      });
    }
    // Только owner может назначать owner-роль.
    if (newRole === 'owner' && ctx.role !== 'owner' && !ctx.isSuperAdmin) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'only_owner_can_promote_owner' },
      });
    }
    const target = await this.prisma.membership.findUnique({
      where: { orgId_userId: { orgId, userId: targetUserId } },
      include: { user: true },
    });
    if (!target) {
      throw new NotFoundException({ ok: false, error: { code: 'membership_not_found' } });
    }
    // Защищаем последнего owner'а — нельзя понизить.
    if (target.role === 'owner' && newRole !== 'owner') {
      const owners = await this.prisma.membership.count({
        where: { orgId, role: 'owner' },
      });
      if (owners <= 1) {
        throw new BadRequestException({
          ok: false,
          error: { code: 'cannot_demote_last_owner' },
        });
      }
    }
    const updated = await this.prisma.membership.update({
      where: { orgId_userId: { orgId, userId: targetUserId } },
      data: { role: newRole },
      include: { user: true },
    });
    this.rbac.invalidate(targetUserId, orgId);
    return {
      userId: updated.userId,
      email: updated.user.email,
      name: updated.user.name,
      role: updated.role,
      joinedAt: updated.joinedAt.toISOString(),
      invitedBy: updated.invitedBy,
    };
  }

  /** Удалить участника из Org. Только owner/admin. */
  async removeMember(
    orgId: string,
    actorUserId: string,
    targetUserId: string,
  ): Promise<void> {
    const ctx = await this.rbac.loadContext(actorUserId, orgId);
    if (!ctx || (ctx.role !== 'owner' && ctx.role !== 'admin' && !ctx.isSuperAdmin)) {
      throw new ForbiddenException({ ok: false, error: { code: 'forbidden' } });
    }
    const target = await this.prisma.membership.findUnique({
      where: { orgId_userId: { orgId, userId: targetUserId } },
    });
    if (!target) {
      throw new NotFoundException({ ok: false, error: { code: 'membership_not_found' } });
    }
    if (target.role === 'owner') {
      const owners = await this.prisma.membership.count({
        where: { orgId, role: 'owner' },
      });
      if (owners <= 1) {
        throw new BadRequestException({
          ok: false,
          error: { code: 'cannot_remove_last_owner' },
        });
      }
    }
    await this.prisma.membership.delete({
      where: { orgId_userId: { orgId, userId: targetUserId } },
    });
    this.rbac.invalidate(targetUserId, orgId);
  }

  // ─────────────────────────── helpers ──────────────────────────────

  private toOrgDomain(o: Org): OrgDomain {
    return {
      id: o.id,
      name: o.name,
      slug: o.slug,
      visibilityMode: o.visibilityMode,
      tier: o.tier,
      ownerId: o.ownerId,
      createdAt: o.createdAt.toISOString(),
    };
  }

  private async generateUniqueSlug(
    name: string,
    client: Prisma.TransactionClient | PrismaService,
  ): Promise<string> {
    const base = slugify(name) || 'org';
    for (let attempt = 0; attempt < 5; attempt++) {
      const suffix = randomBytes(SLUG_RANDOM_LEN).toString('hex').slice(0, 6);
      const slug = `${base}-${suffix}`;
      const exists = await client.org.findUnique({ where: { slug } });
      if (!exists) return slug;
    }
    throw new ConflictException({
      ok: false,
      error: { code: 'slug_collision', message: 'Не удалось сгенерировать уникальный slug' },
    });
  }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/giu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
