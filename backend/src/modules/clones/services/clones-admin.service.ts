import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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

/**
 * ТЗ 2026-05-26 (clone-access-grant-admin-api) — admin CRUD для
 * `CloneAccessGrant` + user-эндпоинт `/me/clone-access`.
 *
 * Контракт см. §2–§5 ТЗ. Главное:
 *   - createAccessGrant: валидация member-of-org + cloneRef + идемпотентность
 *     (active grant → возврат существующего без notification; revoked → re-grant
 *     с физическим удалением старой revoked-записи); создание + notification
 *     внутри транзакции.
 *   - revokeAccessGrant: soft-revoke (выставление revokedAt / revokedBy),
 *     idempotent: повторный revoke → 400 already_revoked.
 *   - extendAccessGrant: обновление expiresAt; 400 cannot_update_revoked.
 *   - listAccessGrants: batch-enrichment (cloneLabel, userName, userEmail).
 *   - listAccessGrantsByClone: список грантов на конкретного клона (для
 *     страницы «Управление доступом»).
 *   - getMyCloneAccess: только id-ы активных грантов текущего user'а (без
 *     enrichment — фронт сам мапит).
 *
 * Все тексты ошибок — на русском.
 */
@Injectable()
export class ClonesAdminService {
  private readonly logger = new Logger(ClonesAdminService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService,
  ) {}

  // ─────────────────────────── CREATE ───────────────────────────

  async createAccessGrant(args: {
    tenantId: string;
    actorUserId: string;
    dto: CreateAccessGrantDto;
  }): Promise<AccessGrantDto> {
    const { tenantId, actorUserId, dto } = args;

    // 1. Получатель — member текущего тенанта?
    const member = await this.prisma.membership.findFirst({
      where: { orgId: tenantId, userId: dto.grantedToUserId },
      select: { id: true },
    });
    if (!member) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'user_not_in_org',
          message:
            'Нельзя выдать грант пользователю, не состоящему в организации',
        },
      });
    }

    // 2. cloneRefId существует в этом тенанте?
    await this.assertCloneRefExists(tenantId, dto.cloneType, dto.cloneRefId);

    // 3. Идемпотентность.
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
      // Активный грант уже есть — возвращаем его, без повторного INSERT
      // и без повторной нотификации (см. §3.2).
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

    // 4. Транзакция: create новый grant либо re-grant поверх revoked.
    // audit В15 (2026-05-29): при re-grant используем UPDATE по существующей
    // строке (revokedAt=null, revokedById=null, grantedById=новый actor,
    // expiresAt=новое значение, grantedAt=now) вместо DELETE+CREATE.
    // Прежняя схема создавала новый id, audit-trail revocation'а терялся
    // безвозвратно — в БД нельзя было реконструировать кто и когда отозвал
    // доступ перед re-grant. UPDATE сохраняет grantId стабильным,
    // а revokedAt/revokedById в истории CloneAccessAudit (через триггер /
    // вручную писаный лог) остаются как факт.
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    const grantedAtIso = new Date().toISOString();

    const created = await this.prisma.$transaction(async (tx) => {
      if (existing && existing.revokedAt !== null) {
        // re-grant: воскрешаем запись без потери id и истории.
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

    // 5. Notification — вне транзакции, но всё равно с try/catch, чтобы упавший
    //    канал не откатывал уже созданный грант (см. §11 Q1 — атомарность важна,
    //    но grant важнее notification: пользователь получит доступ даже если
    //    нотификация не дойдёт).
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
            expiresAt: created.expiresAt
              ? created.expiresAt.toISOString()
              : null,
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

  // ─────────────────────────── REVOKE ───────────────────────────

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

  // ─────────────────────────── EXTEND ───────────────────────────

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

  // ─────────────────────────── LIST (admin) ───────────────────────────

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
      // revoked OR expired
      where.OR = [
        { revokedAt: { not: null } },
        { expiresAt: { lte: now } },
      ];
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

  // ─────────────────────────── LIST per-clone ───────────────────────────

  async listAccessGrantsByClone(args: {
    tenantId: string;
    cloneType: 'person' | 'role';
    cloneRefId: string;
    includeInactive: boolean;
  }): Promise<AccessGrantListResponseDto> {
    const { tenantId, cloneType, cloneRefId, includeInactive } = args;
    const now = new Date();

    // Сначала проверим, что cloneRefId существует в этом тенанте (404 иначе —
    // см. §3.3 ТЗ, чтобы admin не «прозванивал» чужие id).
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

  // ─────────────────────────── /me/clone-access ───────────────────────────

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

  // ─────────────────────────── helpers ───────────────────────────

  /**
   * Бросает 404, если cloneRefId не существует в этом тенанте (см. §3.2 шаг 2).
   * Для cloneType='role' — проверяем `Role.deletedAt IS NULL`.
   * Для cloneType='person' — проверяем `Person.deletedAt IS NULL` (если поле
   * есть; в текущей схеме у Person нет deletedAt — фильтр по tenantId).
   */
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
    // cloneType === 'person'
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

  /**
   * Резолвит человекочитаемое имя клона:
   *   - role: ExecutablePersona.publicName активной role-persona; fallback Role.name.
   *   - person: Person.name.
   * null — если клон не найден (для notification cloneLabel будет fallback'нут на id).
   */
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
      // Невозможно — enrichMany всегда возвращает по одной записи на вход.
      throw new Error('enrichOne: пустой enrichMany результат');
    }
    return list;
  }

  /**
   * Batch-enrichment: один запрос на cloneLabel'ы (person + role + persona) и
   * один на user-имена. Избегаем N+1.
   */
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
        : Promise.resolve(
            [] as Array<{ scopeRefId: string | null; publicName: string | null }>,
          ),
      userIds.size > 0
        ? this.prisma.user.findMany({
            where: { id: { in: Array.from(userIds) } },
            select: { id: true, name: true, email: true },
          })
        : Promise.resolve(
            [] as Array<{ id: string; name: string; email: string }>,
          ),
    ]);

    const personById = new Map(persons.map((p) => [p.id, p]));
    const roleById = new Map(roles.map((r) => [r.id, r]));
    const personaByRoleId = new Map(
      rolePersonas
        .filter((p) => p.scopeRefId !== null)
        .map((p) => [p.scopeRefId as string, p]),
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
