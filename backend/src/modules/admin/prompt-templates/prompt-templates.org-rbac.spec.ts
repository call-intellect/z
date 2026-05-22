/**
 * Фаза A.3 — Integration-тест на расширенную RBAC + entitlement-логику
 * AdminPromptTemplatesService.
 *
 * Покрытие (DoD A.3):
 *   1) Org-admin может создать scope=org для своей Org (есть feature) — OK.
 *   2) Org-admin без feature.custom_prompt_templates → 403.
 *   3) Org-admin пытается создать scope=org для ЧУЖОЙ Org → 403.
 *   4) Org-admin пытается создать scope=system → 403 system_scope_super_admin_only.
 *   5) Лимит prompt_templates_per_org enforced (current = limit → 403).
 */

import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { EntitlementService } from '../../entitlements/entitlement.service';

import { AdminPromptTemplatesService } from './prompt-templates.service';

function buildPrismaMock(): {
  prisma: PrismaService;
  templates: Map<string, Record<string, unknown>>;
  setCurrentCount: (n: number) => void;
} {
  const templates = new Map<string, Record<string, unknown>>();
  let currentCount = 0;
  const prisma = {
    promptTemplate: {
      findFirst: vi.fn(async () => null),
      findUnique: vi.fn(async (args: { where: { id: string } }) =>
        templates.get(args.where.id) ?? null,
      ),
      create: vi.fn(
        async ({ data }: { data: Record<string, unknown> }) => {
          const t = { id: `t-${templates.size + 1}`, ...data };
          templates.set(t.id as string, t);
          return t;
        },
      ),
      count: vi.fn(async () => currentCount),
      update: vi.fn(async () => ({})),
    },
    promptTemplateVersion: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'v-1' })),
    },
    promptTemplateSection: {
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        promptTemplate: {
          create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
            const t = { id: `t-${templates.size + 1}`, ...data };
            templates.set(t.id as string, t);
            return t;
          }),
          update: vi.fn(async () => ({})),
        },
        promptTemplateVersion: {
          create: vi.fn(async () => ({ id: 'v-1' })),
        },
        promptTemplateSection: {
          createMany: vi.fn(async () => ({ count: 0 })),
        },
      }),
    ),
  } as unknown as PrismaService;
  return {
    prisma,
    templates,
    setCurrentCount: (n: number) => {
      currentCount = n;
    },
  };
}

function buildEntitlementMock(args: { feature?: boolean; quota?: number }) {
  return {
    hasFeature: vi.fn(async () => args.feature ?? true),
    getQuota: vi.fn(async () => args.quota ?? 10),
  } as unknown as EntitlementService;
}

describe('AdminPromptTemplatesService — A.3 RBAC + entitlement', () => {
  it('Org-admin БЕЗ feature.custom_prompt_templates → 403', async () => {
    const { prisma } = buildPrismaMock();
    const ent = buildEntitlementMock({ feature: false });
    const svc = new AdminPromptTemplatesService(prisma, ent);
    await expect(
      svc.create(
        {
          scope: 'org',
          orgId: 'org-1',
          key: 'my-tpl',
          name: 'Мой шаблон',
          taskType: 'summary',
        },
        'u-1',
        { userId: 'u-1', isSuperAdmin: false, ownedOrgIds: ['org-1'] },
      ),
    ).rejects.toMatchObject({
      response: { error: { code: 'feature_not_available' } },
    });
  });

  it('Org-admin не может scope=system', async () => {
    const { prisma } = buildPrismaMock();
    const ent = buildEntitlementMock({});
    const svc = new AdminPromptTemplatesService(prisma, ent);
    await expect(
      svc.create(
        {
          scope: 'system',
          key: 'sys-tpl',
          name: 'Системный',
          taskType: 'summary',
        },
        'u-1',
        { userId: 'u-1', isSuperAdmin: false, ownedOrgIds: ['org-1'] },
      ),
    ).rejects.toMatchObject({
      response: { error: { code: 'system_scope_super_admin_only' } },
    });
  });

  it('Org-admin не может создать для ЧУЖОЙ Org', async () => {
    const { prisma } = buildPrismaMock();
    const ent = buildEntitlementMock({});
    const svc = new AdminPromptTemplatesService(prisma, ent);
    await expect(
      svc.create(
        {
          scope: 'org',
          orgId: 'org-other',
          key: 'tpl',
          name: 'Чужая',
          taskType: 'summary',
        },
        'u-1',
        { userId: 'u-1', isSuperAdmin: false, ownedOrgIds: ['org-1'] },
      ),
    ).rejects.toMatchObject({
      response: { error: { code: 'no_access_to_org' } },
    });
  });

  it('Лимит prompt_templates_per_org enforced', async () => {
    const { prisma, setCurrentCount } = buildPrismaMock();
    setCurrentCount(10);
    const ent = buildEntitlementMock({ feature: true, quota: 10 });
    const svc = new AdminPromptTemplatesService(prisma, ent);
    await expect(
      svc.create(
        {
          scope: 'org',
          orgId: 'org-1',
          key: 'tpl-11',
          name: '11-й',
          taskType: 'summary',
        },
        'u-1',
        { userId: 'u-1', isSuperAdmin: false, ownedOrgIds: ['org-1'] },
      ),
    ).rejects.toMatchObject({
      response: { error: { code: 'org_template_quota_exceeded' } },
    });
  });

  it('assertCanMutate — Org-admin не может править system шаблон', () => {
    const { prisma } = buildPrismaMock();
    const ent = buildEntitlementMock({});
    const svc = new AdminPromptTemplatesService(prisma, ent);
    expect(() =>
      svc.assertCanMutate(
        { scope: 'system', orgId: null },
        { userId: 'u-1', isSuperAdmin: false, ownedOrgIds: ['org-1'] },
      ),
    ).toThrow();
    try {
      svc.assertCanMutate(
        { scope: 'system', orgId: null },
        { userId: 'u-1', isSuperAdmin: false, ownedOrgIds: ['org-1'] },
      );
    } catch (e) {
      expect((e as { response: { error: { code: string } } }).response.error.code).toBe(
        'system_template_super_admin_only',
      );
    }
  });

  it('assertCanMutate — super_admin может всё', () => {
    const { prisma } = buildPrismaMock();
    const ent = buildEntitlementMock({});
    const svc = new AdminPromptTemplatesService(prisma, ent);
    expect(() =>
      svc.assertCanMutate(
        { scope: 'system', orgId: null },
        { userId: 'super', isSuperAdmin: true, ownedOrgIds: [] },
      ),
    ).not.toThrow();
  });
});
