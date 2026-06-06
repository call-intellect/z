import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

import { RbacService } from './rbac.service';

/** Контекст доступа пользователя к знаниям (группы). */
export interface KnowledgeAccessContext {
  /** Доступные department-группы: свои ∪ видимые через матрицу. */
  deptGroupIds: string[];
  /** Закрытые группы (leadership/council/personal), где user — член. */
  closedGroupIds: string[];
  /** owner/admin/super_admin — обходят фильтр целиком. */
  isBypass: boolean;
}

interface CacheEntry { ctx: KnowledgeAccessContext; fetchedAt: number; }
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_SIZE = 10_000;

@Injectable()
export class KnowledgeAccessResolver {
  private readonly logger = new Logger(KnowledgeAccessResolver.name);
  private cache = new Map<string, CacheEntry>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  /**
   * Резолвит группы пользователя. Алгоритм (ТЗ §«Правило доступа»):
   *   isBypass = super_admin | owner | admin (через RbacService.loadContext).
   *   department-группы: из Person.primaryDepartmentId ∪ активных PersonRole.role.departmentId
   *     ∪ активных Appointment.departmentId ∪ headOfDepartments ∪ ручных KnowledgeGroupMember(dept).
   *   deptGroupIds = свои ∪ {visibleGroupId | GroupVisibilityPolicy.subjectGroupId ∈ свои}.
   *   closedGroupIds = KnowledgeGroupMember(personId, group.isClosed=true).
   */
  async resolveAccessibleGroups(args: {
    tenantId: string;
    userId: string;
  }): Promise<KnowledgeAccessContext> {
    const key = `${args.userId}:${args.tenantId}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.ctx;

    const rbacCtx = await this.rbac.loadContext(args.userId, args.tenantId);
    const isBypass =
      !!rbacCtx &&
      (rbacCtx.isSuperAdmin || rbacCtx.role === 'owner' || rbacCtx.role === 'admin');
    if (isBypass) {
      const ctx = { deptGroupIds: [], closedGroupIds: [], isBypass: true };
      this.cacheSet(key, ctx);
      return ctx;
    }

    // Person пользователя в этой Org.
    const person = await this.prisma.person.findFirst({
      where: { tenantId: args.tenantId, userId: args.userId, deletedAt: null },
      select: { id: true, primaryDepartmentId: true },
    });
    if (!person) {
      const ctx = { deptGroupIds: [], closedGroupIds: [], isBypass: false };
      this.cacheSet(key, ctx);
      return ctx;
    }

    // departmentId-ы пользователя.
    const deptIds = new Set<string>();
    if (person.primaryDepartmentId) deptIds.add(person.primaryDepartmentId);
    const [personRoles, appointments, headOf] = await Promise.all([
      this.prisma.personRole.findMany({
        where: { tenantId: args.tenantId, personId: person.id, validTo: null },
        select: { role: { select: { departmentId: true } } },
      }),
      this.prisma.appointment.findMany({
        where: { tenantId: args.tenantId, personId: person.id, status: 'active', validTo: null },
        select: { departmentId: true },
      }),
      this.prisma.department.findMany({
        where: { tenantId: args.tenantId, headPersonId: person.id, deletedAt: null },
        select: { id: true },
      }),
    ]);
    for (const pr of personRoles) if (pr.role?.departmentId) deptIds.add(pr.role.departmentId);
    for (const ap of appointments) if (ap.departmentId) deptIds.add(ap.departmentId);
    for (const d of headOf) deptIds.add(d.id);

    // Группы пользователя: department-группы по deptIds + членство (любые группы).
    const [deptGroups, memberships] = await Promise.all([
      deptIds.size > 0
        ? this.prisma.knowledgeGroup.findMany({
            where: { tenantId: args.tenantId, kind: 'department', refId: { in: [...deptIds] } },
            select: { id: true },
          })
        : Promise.resolve([] as { id: string }[]),
      this.prisma.knowledgeGroupMember.findMany({
        where: { personId: person.id },
        select: { groupId: true, group: { select: { kind: true, isClosed: true, tenantId: true } } },
      }),
    ]);

    const ownDeptGroupIds = new Set<string>(deptGroups.map((g) => g.id));
    const closedGroupIds = new Set<string>();
    for (const m of memberships) {
      if (m.group.tenantId !== args.tenantId) continue; // tenant-guard
      if (m.group.isClosed) closedGroupIds.add(m.groupId);
      else if (m.group.kind === 'department') ownDeptGroupIds.add(m.groupId); // ручной dept-override
    }

    // Матрица: subjectGroup ∈ свои → +visibleGroup.
    const deptGroupIds = new Set<string>(ownDeptGroupIds);
    if (ownDeptGroupIds.size > 0) {
      const policies = await this.prisma.groupVisibilityPolicy.findMany({
        where: { tenantId: args.tenantId, subjectGroupId: { in: [...ownDeptGroupIds] } },
        select: { visibleGroupId: true },
      });
      for (const p of policies) deptGroupIds.add(p.visibleGroupId);
    }

    const ctx: KnowledgeAccessContext = {
      deptGroupIds: [...deptGroupIds],
      closedGroupIds: [...closedGroupIds],
      isBypass: false,
    };
    this.cacheSet(key, ctx);
    return ctx;
  }

  /**
   * Prisma where-фрагмент для IdeaBlock.findMany при enforce. Каноничное правило:
   *   - НЕ нарушает закрытость: нет blockAccess-строки (closed-группа НЕ из моих closed).
   *   - dept: нет dept-группы на блоке ИЛИ есть dept-группа из моих доступных.
   * Для isBypass — пустой фильтр {} (видит всё).
   */
  buildAccessWhere(ctx: KnowledgeAccessContext): Prisma.IdeaBlockWhereInput {
    if (ctx.isBypass) return {};
    return {
      AND: [
        {
          blockAccess: {
            none: { group: { isClosed: true }, groupId: { notIn: ctx.closedGroupIds } },
          },
        },
        {
          OR: [
            { blockAccess: { none: { group: { kind: 'department' } } } },
            { blockAccess: { some: { groupId: { in: ctx.deptGroupIds } } } },
          ],
        },
      ],
    };
  }

  invalidate(userId: string, tenantId: string): void {
    this.cache.delete(`${userId}:${tenantId}`);
  }
  invalidateAll(): void { this.cache.clear(); }

  private cacheSet(key: string, ctx: KnowledgeAccessContext): void {
    if (this.cache.size >= CACHE_MAX_SIZE) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, { ctx, fetchedAt: Date.now() });
  }
}
