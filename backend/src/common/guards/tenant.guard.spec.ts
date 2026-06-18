import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { TenantGuard } from '../../modules/rbac/guards/tenant.guard';
import type { KnowledgeAccessResolver } from '../../modules/rbac/knowledge-access-resolver.service';
import type { RbacService } from '../../modules/rbac/rbac.service';
import type { TypedConfigService } from '../config/index';
import type { PrismaService } from '../prisma/prisma.service';

interface ReqShape {
  user?: { id?: string } | null;
  headers?: Record<string, string | undefined>;
  params?: Record<string, string>;
  body?: Record<string, unknown>;
  tenantId?: string;
}

function buildExecCtx(req: ReqShape): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    getHandler: () => ({}) as never,
    getClass: () => ({}) as never,
    getType: () => 'http',
    getArgs: () => [],
    getArgByIndex: () => ({}) as never,
    switchToRpc: () => ({}) as never,
    switchToWs: () => ({}) as never,
  } as unknown as ExecutionContext;
}

function buildGuard(opts: { hasMembership?: boolean; manyMemberships?: number }): {
  guard: TenantGuard;
  prisma: PrismaService;
  rbac: RbacService;
} {
  const rbac = {
    loadContext: vi.fn(async () => {
      if (opts.hasMembership === false) return null;
      return {
        role: 'owner',
        visibility: 'open',
        isSuperAdmin: false,
        fetchedAt: Date.now(),
      };
    }),
  } as unknown as RbacService;

  const prisma = {
    membership: {
      findMany: vi.fn(async () => {
        const n = opts.manyMemberships ?? 1;
        if (n === 0) return [];
        if (n === 1) return [{ orgId: 't-default' }];
        return [{ orgId: 't-a' }, { orgId: 't-b' }];
      }),
    },
  } as unknown as PrismaService;

  const cfg = {
    knowledgeAccess: { enforcement: 'off' as const },
  } as unknown as TypedConfigService;
  const accessResolver = {
    resolveAccessibleGroups: vi.fn(async () => ({
      deptGroupIds: [],
      closedGroupIds: [],
      isBypass: false,
    })),
  } as unknown as KnowledgeAccessResolver;

  return { guard: new TenantGuard(prisma, rbac, cfg, accessResolver), prisma, rbac };
}

describe('TenantGuard', () => {
  it('использует уже-выставленный req.tenantId (из middleware с X-Org-Id)', async () => {
    const { guard } = buildGuard({ hasMembership: true });
    const req: ReqShape = {
      user: { id: 'u-1' },
      headers: { 'x-org-id': 't-from-header' },
      tenantId: 't-from-header',
    };
    await expect(guard.canActivate(buildExecCtx(req))).resolves.toBe(true);
    expect(req.tenantId).toBe('t-from-header');
  });

  it('использует req.tenantId (из middleware с URL :orgId)', async () => {
    const { guard } = buildGuard({ hasMembership: true });
    const req: ReqShape = {
      user: { id: 'u-1' },
      headers: {},
      tenantId: 't-from-url',
    };
    await guard.canActivate(buildExecCtx(req));
    expect(req.tenantId).toBe('t-from-url');
  });

  it('использует req.tenantId (из middleware с body.tenantId)', async () => {
    const { guard } = buildGuard({ hasMembership: true });
    const req: ReqShape = {
      user: { id: 'u-1' },
      headers: {},
      tenantId: 't-from-body',
    };
    await guard.canActivate(buildExecCtx(req));
    expect(req.tenantId).toBe('t-from-body');
  });

  it('использует req.tenantId (из middleware с body.orgId как алиасом)', async () => {
    const { guard } = buildGuard({ hasMembership: true });
    const req: ReqShape = {
      user: { id: 'u-1' },
      headers: {},
      tenantId: 't-from-body-orgid',
    };
    await guard.canActivate(buildExecCtx(req));
    expect(req.tenantId).toBe('t-from-body-orgid');
  });

  it('Единственный membership используется как дефолт', async () => {
    const { guard } = buildGuard({ hasMembership: true, manyMemberships: 1 });
    const req: ReqShape = {
      user: { id: 'u-1' },
      headers: {},
    };
    await guard.canActivate(buildExecCtx(req));
    expect(req.tenantId).toBe('t-default');
  });

  it('Несколько membership без явного X-Org-Id → ForbiddenException tenant_required', async () => {
    const { guard } = buildGuard({ hasMembership: false, manyMemberships: 2 });
    const req: ReqShape = {
      user: { id: 'u-1' },
      headers: {},
    };
    await expect(guard.canActivate(buildExecCtx(req))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('Нет user (CookieAuthGuard не отработал) → ForbiddenException no_user', async () => {
    const { guard } = buildGuard({ hasMembership: true });
    const req: ReqShape = { headers: {} };
    await expect(guard.canActivate(buildExecCtx(req))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('user без membership → ForbiddenException no_membership', async () => {
    const { guard } = buildGuard({ hasMembership: false, manyMemberships: 1 });
    const req: ReqShape = {
      user: { id: 'u-1' },
      headers: { 'x-org-id': 't-no-access' },
    };
    await expect(guard.canActivate(buildExecCtx(req))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('Пустой X-Org-Id → fallback на URL/body/единственный membership', async () => {
    const { guard } = buildGuard({ hasMembership: true, manyMemberships: 1 });
    const req: ReqShape = {
      user: { id: 'u-1' },
      headers: { 'x-org-id': '   ' },
    };
    await guard.canActivate(buildExecCtx(req));
    expect(req.tenantId).toBe('t-default');
  });

  it('Никаких источников tenant + 0 memberships → ForbiddenException', async () => {
    const { guard } = buildGuard({ hasMembership: false, manyMemberships: 0 });
    const req: ReqShape = {
      user: { id: 'u-1' },
      headers: {},
    };
    await expect(guard.canActivate(buildExecCtx(req))).rejects.toBeInstanceOf(ForbiddenException);
  });
});
