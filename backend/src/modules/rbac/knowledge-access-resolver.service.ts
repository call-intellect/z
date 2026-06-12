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
  private directCache = new Map<
    string,
    { value: { personId: string | null; isBypass: boolean; groupIds: string[] }; fetchedAt: number }
  >();

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
   * ТЗ 2026-06-10 meeting-visibility — ПРЯМЫЕ группы пользователя БЕЗ матрицы
   * видимости отделов (в отличие от resolveAccessibleGroups). Грант группе в
   * видео-видимости видит ТОЛЬКО прямой член, а не «кто видит группу по матрице».
   * Additive: НЕ меняет существующие методы. Своя кэш-карта, тот же TTL.
   * Возвращает { personId, isBypass, groupIds } где groupIds = ownDeptGroups ∪ closedGroups
   * (состояние ДО матрицы — строки 112-120 resolveAccessibleGroups НЕ применяются).
   */
  async resolveDirectGroupIds(args: { tenantId: string; userId: string }): Promise<{
    personId: string | null;
    isBypass: boolean;
    groupIds: string[];
  }> {
    const key = `${args.userId}:${args.tenantId}`;
    const cached = this.directCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.value;

    const rbacCtx = await this.rbac.loadContext(args.userId, args.tenantId);
    const isBypass =
      !!rbacCtx &&
      (rbacCtx.isSuperAdmin || rbacCtx.role === 'owner' || rbacCtx.role === 'admin');
    if (isBypass) {
      const value = { personId: null, isBypass: true, groupIds: [] as string[] };
      this.directCacheSet(key, value);
      return value;
    }

    const person = await this.prisma.person.findFirst({
      where: { tenantId: args.tenantId, userId: args.userId, deletedAt: null },
      select: { id: true, primaryDepartmentId: true },
    });
    if (!person) {
      const value = { personId: null, isBypass: false, groupIds: [] as string[] };
      this.directCacheSet(key, value);
      return value;
    }

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

    const groupIds = new Set<string>(deptGroups.map((g) => g.id));
    for (const m of memberships) {
      if (m.group.tenantId !== args.tenantId) continue; // tenant-guard
      if (m.group.isClosed) groupIds.add(m.groupId);
      else if (m.group.kind === 'department') groupIds.add(m.groupId); // ручной dept-override
    }
    // МАТРИЦУ НЕ применяем (в этом и смысл «прямых» групп).

    const value = { personId: person.id, isBypass: false, groupIds: [...groupIds] };
    this.directCacheSet(key, value);
    return value;
  }

  private directCacheSet(
    key: string,
    value: { personId: string | null; isBypass: boolean; groupIds: string[] },
  ): void {
    if (this.directCache.size >= CACHE_MAX_SIZE) {
      const firstKey = this.directCache.keys().next().value;
      if (firstKey) this.directCache.delete(firstKey);
    }
    this.directCache.set(key, { value, fetchedAt: Date.now() });
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

  /**
   * Ф4 — SQL-предикат доступа для raw-SQL поверхностей (search/cosine).
   * Алиас таблицы IdeaBlock в внешнем запросе ДОЛЖЕН быть `b`. pushParam —
   * функция surface'а, добавляющая параметр и возвращающая `$N`. Возвращает
   * AND-фрагмент (начинается с пробела+AND) или '' для bypass.
   */
  buildAccessSqlPredicate(
    ctx: KnowledgeAccessContext,
    pushParam: (v: unknown) => string,
  ): string {
    if (ctx.isBypass) return '';
    const pClosed = pushParam(ctx.closedGroupIds);
    const pDept = pushParam(ctx.deptGroupIds);
    return `
      AND NOT EXISTS (
        SELECT 1 FROM "IdeaBlockAccess" a JOIN "KnowledgeGroup" g ON a."groupId" = g.id
        WHERE a."blockId" = b.id AND g."isClosed" AND a."groupId" <> ALL(${pClosed}::text[])
      )
      AND (
        NOT EXISTS (
          SELECT 1 FROM "IdeaBlockAccess" a2 JOIN "KnowledgeGroup" g2 ON a2."groupId" = g2.id
          WHERE a2."blockId" = b.id AND g2.kind = 'department'
        )
        OR EXISTS (
          SELECT 1 FROM "IdeaBlockAccess" a3
          WHERE a3."blockId" = b.id AND a3."groupId" = ANY(${pDept}::text[])
        )
      )`;
  }

  /** Группы доступа набора блоков: blockId → [{groupId,isClosed,kind}]. */
  async loadBlockAccessGroups(
    blockIds: string[],
  ): Promise<Map<string, Array<{ groupId: string; isClosed: boolean; kind: string }>>> {
    const map = new Map<string, Array<{ groupId: string; isClosed: boolean; kind: string }>>();
    if (blockIds.length === 0) return map;
    const rows = await this.prisma.ideaBlockAccess.findMany({
      where: { blockId: { in: blockIds } },
      select: { blockId: true, groupId: true, group: { select: { isClosed: true, kind: true } } },
    });
    for (const r of rows) {
      const arr = map.get(r.blockId) ?? [];
      arr.push({ groupId: r.groupId, isClosed: r.group.isClosed, kind: r.group.kind });
      map.set(r.blockId, arr);
    }
    return map;
  }

  /**
   * Партиционирует blockIds на доступные/недоступные по ctx. bypass → все
   * доступны. Используется выходным шлюзом chat-v2 (enforce — фильтр, shadow —
   * счёт denied). Работает на МАЛЫХ наборах (topK) — post-filter, не для пула.
   */
  async partitionBlockIdsByAccess(
    ctx: KnowledgeAccessContext,
    blockIds: string[],
  ): Promise<{ accessible: string[]; denied: number }> {
    if (ctx.isBypass || blockIds.length === 0) {
      return { accessible: blockIds, denied: 0 };
    }
    const groupsMap = await this.loadBlockAccessGroups(blockIds);
    const accessible: string[] = [];
    let denied = 0;
    for (const id of blockIds) {
      const groups = groupsMap.get(id) ?? [];
      if (this.rbac.canAccessKnowledgeGroup(ctx, groups)) accessible.push(id);
      else denied++;
    }
    return { accessible, denied };
  }

  /**
   * Ф6 — партиция ПРОЕКЦИЙ по доступу спрашивающего. Группы проекции выводятся
   * ON-READ из её sourceBlockIds (union групп блоков-источников; строжайшее).
   * Проекция без sourceBlockIds или с блоками без групп → открыта всем.
   * bypass → все доступны. Один DB-запрос на страницу.
   */
  async partitionProjectionsByAccess(
    ctx: KnowledgeAccessContext,
    items: Array<{ id: string; sourceBlockIds: string[] }>,
  ): Promise<{ accessibleIds: Set<string>; denied: number }> {
    if (ctx.isBypass || items.length === 0) {
      return { accessibleIds: new Set(items.map((i) => i.id)), denied: 0 };
    }
    const allBlockIds = [...new Set(items.flatMap((i) => i.sourceBlockIds ?? []))];
    const groupsMap = await this.loadBlockAccessGroups(allBlockIds);
    const accessibleIds = new Set<string>();
    let denied = 0;
    for (const item of items) {
      // union групп всех блоков-источников проекции
      const projGroups: Array<{ groupId: string; isClosed: boolean; kind: string }> = [];
      const seen = new Set<string>();
      for (const bId of item.sourceBlockIds ?? []) {
        for (const g of groupsMap.get(bId) ?? []) {
          if (!seen.has(g.groupId)) { seen.add(g.groupId); projGroups.push(g); }
        }
      }
      if (this.rbac.canAccessKnowledgeGroup(ctx, projGroups)) accessibleIds.add(item.id);
      else denied++;
    }
    return { accessibleIds, denied };
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
