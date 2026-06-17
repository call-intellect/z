import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { CloneAccessGrant, Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { RbacService } from '../../rbac/rbac.service';
import type {
  AccessGrantDto,
  AccessGrantListQueryDto,
  AccessGrantListResponseDto,
  AccessGrantUserSummaryDto,
  CreateAccessGrantDto,
  MyCloneAccessResponseDto,
  UpdateAccessGrantDto,
} from '../dto/clone-access-grant.dto';

@Injectable()
export class ClonesAdminService {
  private readonly logger = new Logger(ClonesAdminService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
  ) {}

  async createAccessGrant(args: {
    tenantId: string;
    actorUserId: string;
    dto: CreateAccessGrantDto;
  }): Promise<AccessGrantDto> {
    const { tenantId, actorUserId, dto } = args;

    const member = await this.prisma.membership.findFirst({
      where: { orgId: tenantId, userId: dto.grantedToUserId },
      select: { id: true },
    });
    if (!member) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'user_not_in_org',
          message: 'Нельзя выдать грант пользователю, не состоящему в организации',
        },
      });
    }

    await this.assertCloneRefExists(tenantId, dto.cloneType, dto.cloneRefId);

    const existing = await this.prisma.cloneAccessGrant.findUnique({
      where: {
        tenantId_grantedToUserId_cloneType_cloneRefId: {
          tenantId,
          grantedToUserId: dto.grantedToUserId,
          cloneType: dto.cloneType,
          cloneRefId: dto.cloneRefId,
        },
      },
    });

    if (existing && existing.revokedAt === null) {
      this.logger.log(
        {
          tenantId,
          grantId: existing.id,
          grantedToUserId: dto.grantedToUserId,
          cloneType: dto.cloneType,
        },
        'createAccessGrant: idempotent replay — активный грант уже существует',
      );
      return this.enrichOne(existing);
    }

    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    const grantedAtIso = new Date().toISOString();

    const created = await this.prisma.$transaction(async (tx) => {
      if (existing && existing.revokedAt !== null) {
        return tx.cloneAccessGrant.update({
          where: { id: existing.id },
          data: {
            grantedById: actorUserId,
            grantedAt: new Date(),
            expiresAt,
            revokedAt: null,
            revokedBy: null,
          },
        });
      }

      return tx.cloneAccessGrant.create({
        data: {
          tenantId,
          grantedToUserId: dto.grantedToUserId,
          cloneType: dto.cloneType,
          cloneRefId: dto.cloneRefId,
          grantedById: actorUserId,
          expiresAt,
        },
      });
    });

    try {
      const [cloneLabel, grantedByUser] = await Promise.all([
        this.resolveCloneLabel(tenantId, dto.cloneType, dto.cloneRefId),
        this.prisma.user.findUnique({
          where: { id: actorUserId },
          select: { name: true },
        }),
      ]);
      await this.conversational.sendNotification({
        tenantId,
        recipientUserId: dto.grantedToUserId,
        eventType: 'clone.access_granted',
        payload: {
          schemaVersion: 1,
          body: {
            cloneType: dto.cloneType,
            cloneRefId: dto.cloneRefId,
            cloneLabel: cloneLabel ?? dto.cloneRefId,
            grantedByUserId: actorUserId,
            grantedByName: grantedByUser?.name ?? '',
            grantedAt: grantedAtIso,
            expiresAt: created.expiresAt ? created.expiresAt.toISOString() : null,
          },
        },
        dataClass: 'internal',
      });
    } catch (err) {
      this.logger.warn(
        {
          tenantId,
          grantId: created.id,
          recipientUserId: dto.grantedToUserId,
          err: err instanceof Error ? err.message : String(err),
        },
        'createAccessGrant: не удалось отправить уведомление clone.access_granted (грант сохранён)',
      );
    }

    return this.enrichOne(created);
  }

  async requestAccess(args: {
    tenantId: string;
    requesterUserId: string;
    cloneType: 'person' | 'role';
    cloneRefId: string;
  }): Promise<{ ok: true } | { ok: false; reason: string }> {
    const { tenantId, requesterUserId, cloneType, cloneRefId } = args;

    await this.assertCloneRefExists(tenantId, cloneType, cloneRefId);

    const existing = await this.prisma.cloneAccessGrant.findUnique({
      where: {
        tenantId_grantedToUserId_cloneType_cloneRefId: {
          tenantId,
          grantedToUserId: requesterUserId,
          cloneType,
          cloneRefId,
        },
      },
    });
    if (existing && existing.revokedAt === null) {
      return { ok: false, reason: 'already_granted' };
    }

    const adminMemberships = await this.prisma.membership.findMany({
      where: { orgId: tenantId, role: { in: ['owner', 'admin'] } },
      select: { userId: true },
    });
    if (adminMemberships.length === 0) {
      this.logger.warn(
        { tenantId, cloneType, cloneRefId, requesterUserId },
        'requestAccess: в тенанте нет admin/owner — некому отправить notification',
      );
      return { ok: false, reason: 'no_admins' };
    }

    const [cloneLabel, requester] = await Promise.all([
      this.resolveCloneLabel(tenantId, cloneType, cloneRefId),
      this.prisma.user.findUnique({
        where: { id: requesterUserId },
        select: { name: true, email: true },
      }),
    ]);
    const requestedAt = new Date().toISOString();
    await Promise.allSettled(
      adminMemberships.map((m) =>
        this.conversational.sendNotification({
          tenantId,
          recipientUserId: m.userId,
          eventType: 'clone.access_requested',
          payload: {
            schemaVersion: 1,
            body: {
              cloneType,
              cloneRefId,
              cloneLabel: cloneLabel ?? cloneRefId,
              requesterUserId,
              requesterName: requester?.name ?? '',
              requesterEmail: requester?.email ?? '',
              requestedAt,
            },
          },
          dataClass: 'internal',
        }),
      ),
    );

    return { ok: true };
  }

  async revokeAccessGrant(args: {
    tenantId: string;
    actorUserId: string;
    id: string;
  }): Promise<AccessGrantDto> {
    const grant = await this.prisma.cloneAccessGrant.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
    });
    if (!grant) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'not_found', message: 'Грант не найден' },
      });
    }
    if (grant.revokedAt !== null) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'already_revoked',
          message: 'Этот грант уже отозван',
        },
      });
    }

    const updated = await this.prisma.cloneAccessGrant.update({
      where: { id: grant.id },
      data: { revokedAt: new Date(), revokedBy: args.actorUserId },
    });
    return this.enrichOne(updated);
  }

  async extendAccessGrant(args: {
    tenantId: string;
    id: string;
    dto: UpdateAccessGrantDto;
  }): Promise<AccessGrantDto> {
    const grant = await this.prisma.cloneAccessGrant.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
    });
    if (!grant) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'not_found', message: 'Грант не найден' },
      });
    }
    if (grant.revokedAt !== null) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'cannot_update_revoked',
          message: 'Нельзя изменить отозванный грант',
        },
      });
    }

    const expiresAt = args.dto.expiresAt ? new Date(args.dto.expiresAt) : null;
    const updated = await this.prisma.cloneAccessGrant.update({
      where: { id: grant.id },
      data: { expiresAt },
    });
    return this.enrichOne(updated);
  }

  async listAccessGrants(args: {
    tenantId: string;
    query: AccessGrantListQueryDto;
  }): Promise<AccessGrantListResponseDto> {
    const { tenantId, query } = args;
    const now = new Date();

    const where: Prisma.CloneAccessGrantWhereInput = { tenantId };
    if (query.grantedToUserId) where.grantedToUserId = query.grantedToUserId;
    if (query.grantedById) where.grantedById = query.grantedById;
    if (query.cloneType) where.cloneType = query.cloneType;
    if (query.cloneRefId) where.cloneRefId = query.cloneRefId;

    if (query.isActive === true) {
      Object.assign(where, RbacService.buildActiveGrantWhere(now));
    } else if (query.isActive === false) {
      where.OR = [{ revokedAt: { not: null } }, { expiresAt: { lte: now } }];
    }

    const [total, rows] = await Promise.all([
      this.prisma.cloneAccessGrant.count({ where }),
      this.prisma.cloneAccessGrant.findMany({
        where,
        orderBy: [{ grantedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    const items = await this.enrichMany(tenantId, rows);

    return {
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async listAccessGrantsByClone(args: {
    tenantId: string;
    cloneType: 'person' | 'role';
    cloneRefId: string;
    includeInactive: boolean;
  }): Promise<AccessGrantListResponseDto> {
    const { tenantId, cloneType, cloneRefId, includeInactive } = args;
    const now = new Date();

    await this.assertCloneRefExists(tenantId, cloneType, cloneRefId);

    const where: Prisma.CloneAccessGrantWhereInput = {
      tenantId,
      cloneType,
      cloneRefId,
    };
    if (!includeInactive) {
      Object.assign(where, RbacService.buildActiveGrantWhere(now));
    }

    const rows = await this.prisma.cloneAccessGrant.findMany({
      where,
      orderBy: [{ grantedAt: 'desc' }, { id: 'desc' }],
    });
    const items = await this.enrichMany(tenantId, rows);

    return {
      items,
      total: items.length,
      page: 1,
      pageSize: items.length,
    };
  }

  async getMyCloneAccess(args: {
    tenantId: string;
    userId: string;
  }): Promise<MyCloneAccessResponseDto> {
    const now = new Date();
    const grants = await this.prisma.cloneAccessGrant.findMany({
      where: {
        tenantId: args.tenantId,
        grantedToUserId: args.userId,
        ...RbacService.buildActiveGrantWhere(now),
      },
      select: { cloneType: true, cloneRefId: true },
    });
    const personClones: string[] = [];
    const roleClones: string[] = [];
    for (const g of grants) {
      if (g.cloneType === 'person') personClones.push(g.cloneRefId);
      else if (g.cloneType === 'role') roleClones.push(g.cloneRefId);
    }
    return {
      personClones,
      roleClones,
      fetchedAt: now.toISOString(),
    };
  }

  private async assertCloneRefExists(
    tenantId: string,
    cloneType: 'person' | 'role',
    cloneRefId: string,
  ): Promise<void> {
    if (cloneType === 'role') {
      const role = await this.prisma.role.findFirst({
        where: { id: cloneRefId, tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!role) {
        throw new NotFoundException({
          ok: false,
          error: { code: 'role_not_found', message: 'Роль не найдена' },
        });
      }
      return;
    }
    const person = await this.prisma.person.findFirst({
      where: { id: cloneRefId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!person) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'person_not_found', message: 'Сотрудник не найден' },
      });
    }
  }

  private async resolveCloneLabel(
    tenantId: string,
    cloneType: 'person' | 'role',
    cloneRefId: string,
  ): Promise<string | null> {
    if (cloneType === 'role') {
      const persona = await this.prisma.executablePersona.findFirst({
        where: {
          tenantId,
          scope: 'role',
          scopeRefId: cloneRefId,
          status: 'active',
        },
        select: { publicName: true },
      });
      if (persona?.publicName) return persona.publicName;
      const role = await this.prisma.role.findFirst({
        where: { id: cloneRefId, tenantId },
        select: { name: true },
      });
      return role?.name ?? null;
    }
    const person = await this.prisma.person.findFirst({
      where: { id: cloneRefId, tenantId },
      select: { name: true },
    });
    return person?.name ?? null;
  }

  private async enrichOne(grant: CloneAccessGrant): Promise<AccessGrantDto> {
    const [list] = await this.enrichMany(grant.tenantId, [grant]);
    if (!list) {
      throw new Error('enrichOne: пустой enrichMany результат');
    }
    return list;
  }

  private async enrichMany(
    tenantId: string,
    grants: CloneAccessGrant[],
  ): Promise<AccessGrantDto[]> {
    if (grants.length === 0) return [];

    const now = new Date();
    const personIds = new Set<string>();
    const roleIds = new Set<string>();
    const userIds = new Set<string>();

    for (const g of grants) {
      if (g.cloneType === 'person') personIds.add(g.cloneRefId);
      else if (g.cloneType === 'role') roleIds.add(g.cloneRefId);
      userIds.add(g.grantedToUserId);
      userIds.add(g.grantedById);
      if (g.revokedBy) userIds.add(g.revokedBy);
    }

    const [persons, roles, rolePersonas, users] = await Promise.all([
      personIds.size > 0
        ? this.prisma.person.findMany({
            where: { id: { in: Array.from(personIds) }, tenantId },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as Array<{ id: string; name: string }>),
      roleIds.size > 0
        ? this.prisma.role.findMany({
            where: { id: { in: Array.from(roleIds) }, tenantId },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as Array<{ id: string; name: string }>),
      roleIds.size > 0
        ? this.prisma.executablePersona.findMany({
            where: {
              tenantId,
              scope: 'role',
              scopeRefId: { in: Array.from(roleIds) },
              status: 'active',
            },
            select: { scopeRefId: true, publicName: true },
          })
        : Promise.resolve([] as Array<{ scopeRefId: string | null; publicName: string | null }>),
      userIds.size > 0
        ? this.prisma.user.findMany({
            where: { id: { in: Array.from(userIds) } },
            select: { id: true, name: true, email: true },
          })
        : Promise.resolve([] as Array<{ id: string; name: string; email: string }>),
    ]);

    const personById = new Map(persons.map((p) => [p.id, p]));
    const roleById = new Map(roles.map((r) => [r.id, r]));
    const personaByRoleId = new Map(
      rolePersonas.filter((p) => p.scopeRefId !== null).map((p) => [p.scopeRefId as string, p]),
    );
    const userById = new Map(users.map((u) => [u.id, u]));

    return grants.map((g) => {
      let cloneLabel = g.cloneRefId;
      if (g.cloneType === 'role') {
        const persona = personaByRoleId.get(g.cloneRefId);
        if (persona?.publicName) {
          cloneLabel = persona.publicName;
        } else {
          const role = roleById.get(g.cloneRefId);
          if (role) cloneLabel = role.name;
        }
      } else if (g.cloneType === 'person') {
        const person = personById.get(g.cloneRefId);
        if (person) cloneLabel = person.name;
      }

      const grantedToUser = userById.get(g.grantedToUserId);
      const grantedByUser = userById.get(g.grantedById);
      const revokedByUser = g.revokedBy ? userById.get(g.revokedBy) : null;

      const isActive = RbacService.isGrantActive(g, now);
      let inactiveReason: 'revoked' | 'expired' | null = null;
      if (!isActive) {
        if (g.revokedAt !== null) inactiveReason = 'revoked';
        else if (g.expiresAt !== null && g.expiresAt.getTime() <= now.getTime())
          inactiveReason = 'expired';
      }

      const grantedTo: AccessGrantUserSummaryDto = {
        userId: g.grantedToUserId,
        userName: grantedToUser?.name ?? '',
        userEmail: grantedToUser?.email,
      };
      const grantedBy: AccessGrantUserSummaryDto = {
        userId: g.grantedById,
        userName: grantedByUser?.name ?? '',
      };
      const revokedBy: AccessGrantUserSummaryDto | null =
        g.revokedBy && revokedByUser
          ? { userId: g.revokedBy, userName: revokedByUser.name }
          : g.revokedBy
            ? { userId: g.revokedBy, userName: '' }
            : null;

      return {
        id: g.id,
        cloneType: g.cloneType as 'person' | 'role',
        cloneRefId: g.cloneRefId,
        cloneLabel,
        grantedTo,
        grantedBy,
        grantedAt: g.grantedAt.toISOString(),
        expiresAt: g.expiresAt ? g.expiresAt.toISOString() : null,
        revokedAt: g.revokedAt ? g.revokedAt.toISOString() : null,
        revokedBy,
        isActive,
        inactiveReason,
      };
    });
  }
}
