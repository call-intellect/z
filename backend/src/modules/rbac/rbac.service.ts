import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { CloneAccessGrant, MembershipRole, OrgVisibilityMode, Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

interface PolicyRule {
  role: MembershipRole;
  visibility: OrgVisibilityMode | '*';
  ownerMatch: 'self' | '*';
  obj: ResourceType;
  act: Action;
}

export const RESOURCE_TYPES = [
  'org',
  'meeting',
  'card',
  'task',
  'chapter',
  'highlight',
  'chat-message',
  'tag',
  'audit-log',
  'ai-usage',
  'block',
  'entity',
  'theme',
  'goal',
  'goal_key_result',
  'source',
  'person',
  'department',
  'role',
  'job-description',
  'skill',
  'document',
  'role-profile',
  'mission',
  'vision',
  'strategy',
  'process',
  'process-step',
  'regulation',
  'instruction',
  'policy',
  'tool',
  'metric',
  'decision',
  'prompt_template',
  'vendor',
  'event_card',
  'curation_item',
  'curation_decision',
  'conflict_item',
  'card_version',
  'curator_assignment',
  'completeness_slot',
  'chat_v2_conversation',
  'knowledge_profile',
  'insight',
  'idea',
  'probe_event',
  'skill_profile',
  'clone_persona',
  'skill_category',
  'process_template',
  'company_profile',
  'functional_domain',
  'maturity',
  'appointment',
  'kpi',
  'brand_voice',
  'experiment',
  'dashboard_operations',
  'dashboard_operations_temperature',
  'dashboard_operations_weekly',
  'daily_checkin',
  'personal_relation',
  'voice',
  'concierge',
  'orchestrator',
  'proactive_notification',
  'project',
  'issue',
  'cycle',
  'intake_issue',
  'team_template',
  'issue_webhook',
  'import_tracker',
  'activity_feed_item',
  'helpfulness_trait',
  'helpfulness_spotlight',
  'social_contribution_profile',
  'commitment',
  'board',
  'project_document',
  'sprint_hint',
  'table',
  'chatbox',
  'bitrix',
  'conversation',
  'message',
] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number];

export type Action = 'read' | 'write' | 'delete' | 'manage' | 'erase';

export interface CheckParams {
  userId: string;
  tenantId: string;
  obj: ResourceType;
  act: Action;
  resourceOwnerId?: string | null;
}

interface MembershipCacheEntry {
  role: MembershipRole;
  visibility: OrgVisibilityMode;
  isSuperAdmin: boolean;
  fetchedAt: number;
}

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_SIZE = 10_000;

@Injectable()
export class RbacService implements OnModuleInit {
  private readonly logger = new Logger(RbacService.name);
  private policies: PolicyRule[] = [];
  private membershipCache = new Map<string, MembershipCacheEntry>();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.policies = this.loadPolicies();
    this.logger.log(`RbacService готов: загружено ${this.policies.length} правил`);
  }

  static buildActiveGrantWhere(now: Date): Prisma.CloneAccessGrantWhereInput {
    return {
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    };
  }

  static isGrantActive(
    grant: Pick<CloneAccessGrant, 'revokedAt' | 'expiresAt'>,
    now: Date,
  ): boolean {
    if (grant.revokedAt !== null) return false;
    if (grant.expiresAt !== null && grant.expiresAt.getTime() <= now.getTime()) {
      return false;
    }
    return true;
  }

  async check(params: CheckParams): Promise<boolean> {
    const ctx = await this.loadContext(params.userId, params.tenantId);
    if (ctx === null) {
      return false;
    }
    if (ctx.isSuperAdmin) return true;

    return this.evaluate({
      role: ctx.role,
      visibility: ctx.visibility,
      obj: params.obj,
      act: params.act,
      isSelfOwner:
        params.resourceOwnerId !== undefined &&
        params.resourceOwnerId !== null &&
        params.resourceOwnerId === params.userId,
    });
  }

  async canRead(
    userId: string,
    tenantId: string,
    obj: ResourceType,
    resourceOwnerId?: string | null,
  ): Promise<boolean> {
    return this.check({
      userId,
      tenantId,
      obj,
      act: 'read',
      resourceOwnerId: resourceOwnerId ?? null,
    });
  }

  async canWrite(
    userId: string,
    tenantId: string,
    obj: ResourceType,
    resourceOwnerId?: string | null,
  ): Promise<boolean> {
    return this.check({
      userId,
      tenantId,
      obj,
      act: 'write',
      resourceOwnerId: resourceOwnerId ?? null,
    });
  }

  async canManageOrg(userId: string, orgId: string): Promise<boolean> {
    const ctx = await this.loadContext(userId, orgId);
    if (ctx === null) return false;
    if (ctx.isSuperAdmin) return true;
    return ctx.role === 'owner';
  }

  async canViewDirectorDashboard(userId: string, orgId: string): Promise<boolean> {
    const ctx = await this.loadContext(userId, orgId);
    if (ctx === null) return false;
    if (ctx.isSuperAdmin) return true;
    return ctx.role === 'owner' || ctx.role === 'admin';
  }

  async canViewOperationsDashboard(userId: string, orgId: string): Promise<boolean> {
    const ctx = await this.loadContext(userId, orgId);
    if (ctx === null) return false;
    if (ctx.isSuperAdmin) return true;
    return ctx.role === 'owner' || ctx.role === 'admin' || ctx.role === 'coo';
  }

  async canViewEmployeeFullCard(args: {
    viewerUserId: string;
    employeePersonId: string;
    tenantId: string;
  }): Promise<boolean> {
    const person = await this.prisma.person.findFirst({
      where: {
        id: args.employeePersonId,
        tenantId: args.tenantId,
        deletedAt: null,
      },
      select: { userId: true, analyticsOptIn: true },
    });
    if (!person) return false;
    if (person.userId !== null && person.userId === args.viewerUserId) {
      return true;
    }
    const ctx = await this.loadContext(args.viewerUserId, args.tenantId);
    if (ctx === null) return false;
    if (ctx.isSuperAdmin) return true;
    const role = ctx.role;
    if (role === 'owner' || role === 'admin' || role === 'coo') return true;
    if (role === 'hr_partner') return person.analyticsOptIn === true;
    return false;
  }

  canAccessKnowledgeGroup(
    ctx: { deptGroupIds: string[]; closedGroupIds: string[]; isBypass: boolean },
    blockGroups: Array<{ groupId: string; isClosed: boolean; kind: string }>,
  ): boolean {
    if (ctx.isBypass) return true;
    const closed = blockGroups.filter((g) => g.isClosed);
    if (closed.length > 0) {
      return closed.every((g) => ctx.closedGroupIds.includes(g.groupId));
    }
    const dept = blockGroups.filter((g) => g.kind === 'department');
    if (dept.length === 0) return true;
    return dept.some((g) => ctx.deptGroupIds.includes(g.groupId));
  }

  canMutate(role: MembershipRole): boolean {
    return role !== 'demo_observer';
  }

  async getMembershipRole(tenantId: string, userId: string): Promise<string | null> {
    const m = await this.prisma.membership.findUnique({
      where: { orgId_userId: { orgId: tenantId, userId } },
      select: { role: true },
    });
    return m?.role ?? null;
  }

  async loadContext(userId: string, tenantId: string): Promise<MembershipCacheEntry | null> {
    const key = `${userId}:${tenantId}`;
    const cached = this.membershipCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached;
    }

    const [user, membership] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { isSuperAdmin: true },
      }),
      this.prisma.membership.findUnique({
        where: { orgId_userId: { orgId: tenantId, userId } },
        select: { role: true, org: { select: { visibilityMode: true } } },
      }),
    ]);

    if (!user) return null;
    if (user.isSuperAdmin) {
      const org =
        membership?.org ??
        (await this.prisma.org.findUnique({
          where: { id: tenantId },
          select: { visibilityMode: true },
        }));
      const entry: MembershipCacheEntry = {
        role: membership?.role ?? 'admin',
        visibility: org?.visibilityMode ?? 'open',
        isSuperAdmin: true,
        fetchedAt: Date.now(),
      };
      this.cacheSet(key, entry);
      return entry;
    }

    if (!membership) return null;

    const entry: MembershipCacheEntry = {
      role: membership.role,
      visibility: membership.org.visibilityMode,
      isSuperAdmin: false,
      fetchedAt: Date.now(),
    };
    this.cacheSet(key, entry);
    return entry;
  }

  async canAccessPersonClone(args: {
    tenantId: string;
    requesterUserId: string;
    personId: string;
    cloneV2Enabled: boolean;
  }): Promise<{
    allowed: boolean;
    relation: 'owner_admin' | 'self' | 'manager' | 'grant' | 'none';
  }> {
    const personTenant = await this.prisma.person.findUnique({
      where: { id: args.personId },
      select: { tenantId: true },
    });
    if (!personTenant || personTenant.tenantId !== args.tenantId) {
      return { allowed: false, relation: 'none' };
    }
    if (args.cloneV2Enabled) {
      const grant = await this.prisma.cloneAccessGrant.findFirst({
        where: {
          tenantId: args.tenantId,
          grantedToUserId: args.requesterUserId,
          cloneType: 'person',
          cloneRefId: args.personId,
          ...RbacService.buildActiveGrantWhere(new Date()),
        },
        select: { id: true },
      });
      return grant ? { allowed: true, relation: 'grant' } : { allowed: false, relation: 'none' };
    }
    return this.canAccessPersonCloneLegacy(args);
  }

  async canAccessRoleClone(args: {
    tenantId: string;
    requesterUserId: string;
    roleId: string;
    cloneV2Enabled: boolean;
  }): Promise<{ allowed: boolean; relation: 'grant' | 'role_read' | 'none' }> {
    const roleTenant = await this.prisma.role.findUnique({
      where: { id: args.roleId },
      select: { tenantId: true },
    });
    if (!roleTenant || roleTenant.tenantId !== args.tenantId) {
      return { allowed: false, relation: 'none' };
    }
    if (args.cloneV2Enabled) {
      const grant = await this.prisma.cloneAccessGrant.findFirst({
        where: {
          tenantId: args.tenantId,
          grantedToUserId: args.requesterUserId,
          cloneType: 'role',
          cloneRefId: args.roleId,
          ...RbacService.buildActiveGrantWhere(new Date()),
        },
        select: { id: true },
      });
      return grant ? { allowed: true, relation: 'grant' } : { allowed: false, relation: 'none' };
    }
    const allowed = await this.check({
      userId: args.requesterUserId,
      tenantId: args.tenantId,
      obj: 'role',
      act: 'read',
      resourceOwnerId: null,
    });
    return allowed
      ? { allowed: true, relation: 'role_read' }
      : { allowed: false, relation: 'none' };
  }

  private async canAccessPersonCloneLegacy(args: {
    tenantId: string;
    requesterUserId: string;
    personId: string;
  }): Promise<{
    allowed: boolean;
    relation: 'owner_admin' | 'self' | 'manager' | 'none';
  }> {
    const adminAllowed = await this.check({
      userId: args.requesterUserId,
      tenantId: args.tenantId,
      obj: 'knowledge_profile',
      act: 'read',
      resourceOwnerId: null,
    });
    if (adminAllowed) {
      const ctx = await this.loadContext(args.requesterUserId, args.tenantId);
      const role = ctx?.isSuperAdmin ? 'owner' : ctx?.role;
      if (role === 'owner' || role === 'admin') {
        return { allowed: true, relation: 'owner_admin' };
      }
    }
    const target = await this.prisma.person.findUnique({
      where: { id: args.personId },
      select: {
        id: true,
        userId: true,
        primaryDepartmentId: true,
        tenantId: true,
      },
    });
    if (!target || target.tenantId !== args.tenantId) {
      return { allowed: false, relation: 'none' };
    }
    if (target.userId && target.userId === args.requesterUserId) {
      return { allowed: true, relation: 'self' };
    }
    if (target.primaryDepartmentId) {
      const requesterPerson = await this.prisma.person.findFirst({
        where: {
          tenantId: args.tenantId,
          userId: args.requesterUserId,
          deletedAt: null,
        },
        select: { id: true, primaryDepartmentId: true },
      });
      if (requesterPerson?.primaryDepartmentId === target.primaryDepartmentId) {
        const isManager = await this.prisma.membership.findFirst({
          where: {
            orgId: args.tenantId,
            userId: args.requesterUserId,
            role: 'manager',
          },
          select: { id: true },
        });
        if (isManager) return { allowed: true, relation: 'manager' };
      }
    }
    return { allowed: false, relation: 'none' };
  }

  invalidate(userId: string, tenantId: string): void {
    this.membershipCache.delete(`${userId}:${tenantId}`);
  }

  invalidateAll(): void {
    this.membershipCache.clear();
  }

  private cacheSet(key: string, entry: MembershipCacheEntry): void {
    if (this.membershipCache.size >= CACHE_MAX_SIZE) {
      const firstKey = this.membershipCache.keys().next().value;
      if (firstKey) this.membershipCache.delete(firstKey);
    }
    this.membershipCache.set(key, entry);
  }

  private evaluate(args: {
    role: MembershipRole;
    visibility: OrgVisibilityMode;
    obj: ResourceType;
    act: Action;
    isSelfOwner: boolean;
  }): boolean {
    for (const p of this.policies) {
      if (p.role !== args.role) continue;
      if (p.visibility !== '*' && p.visibility !== args.visibility) continue;
      if (p.obj !== args.obj) continue;
      if (p.act !== args.act) continue;
      if (p.ownerMatch === 'self' && !args.isSelfOwner) continue;
      return true;
    }
    return false;
  }

  private loadPolicies(): PolicyRule[] {
    const path = join(__dirname, 'policies', 'policy.csv');
    const raw = readFileSync(path, 'utf8');
    const result: PolicyRule[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const parts = trimmed.split(',').map((s) => s.trim());
      if (parts.length < 6) continue;
      const [tag, role, visibility, ownerMatch, obj, act] = parts;
      if (tag !== 'p') continue;
      if (!role || !visibility || !ownerMatch || !obj || !act) continue;
      if (!isMembershipRole(role)) continue;
      if (visibility !== '*' && !isVisibility(visibility)) continue;
      if (ownerMatch !== 'self' && ownerMatch !== '*') continue;
      if (!isResourceType(obj)) continue;
      if (!isAction(act)) continue;
      result.push({
        role,
        visibility: visibility as OrgVisibilityMode | '*',
        ownerMatch,
        obj,
        act,
      });
    }
    return result;
  }
}

function isMembershipRole(s: string): s is MembershipRole {
  return (
    s === 'owner' ||
    s === 'admin' ||
    s === 'manager' ||
    s === 'coo' ||
    s === 'hr_partner' ||
    s === 'demo_observer'
  );
}
function isVisibility(s: string): s is OrgVisibilityMode {
  return s === 'open' || s === 'strict';
}
function isResourceType(s: string): s is ResourceType {
  return (RESOURCE_TYPES as readonly string[]).includes(s);
}
function isAction(s: string): s is Action {
  return s === 'read' || s === 'write' || s === 'delete' || s === 'manage' || s === 'erase';
}
