import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { RolePrincipleSynthesisService } from '../services/role-principle-synthesis.service';

import { RolePrincipleSynthesisCron } from './role-principle-synthesis.cron';

type SynthResult = {
  created: number;
  merged: number;
  skipped: string | null;
};

function buildCron(opts: {
  rolesByOrg: Record<string, string[]>;
  resultFor: (roleId: string) => SynthResult;
}) {
  const orgIds = Object.keys(opts.rolesByOrg);

  const roleFindMany = vi.fn(async (args: { where: { tenantId: string }; take?: number }) => {
    const ids = opts.rolesByOrg[args.where.tenantId] ?? [];
    const sliced = typeof args.take === 'number' ? ids.slice(0, args.take) : ids;
    return sliced.map((id) => ({ id }));
  });

  const prisma = {
    org: {
      findMany: vi.fn(async () => orgIds.map((id) => ({ id }))),
    },
    role: { findMany: roleFindMany },
    rolePrinciple: { count: vi.fn(async () => 0) },
  } as unknown as PrismaService;

  const redis = {
    client: {
      set: vi.fn(async () => 'OK'),
      del: vi.fn(async () => 1),
    },
  } as unknown as RedisService;

  const cfg = {
    rolePrinciples: { synthesisEnabled: true },
  } as unknown as TypedConfigService;

  const setRolePrinciplesActiveTotal = vi.fn();
  const metrics = {
    setRolePrinciplesActiveTotal,
  } as unknown as BusinessMetricsService;

  const synthesizeForRole = vi.fn(async (args: { roleId: string }) => opts.resultFor(args.roleId));
  const synthesis = {
    synthesizeForRole,
  } as unknown as RolePrincipleSynthesisService;

  const cron = new RolePrincipleSynthesisCron(prisma, redis, cfg, metrics, synthesis);

  return { cron, mocks: { synthesizeForRole, roleFindMany } };
}

describe('RolePrincipleSynthesisCron Б11 — бюджет не жгут skip-роли', () => {
  it('Org с пустыми ролями (no_persons) НЕ тратит бюджет → роли следующей Org синтезируются', async () => {
    const empties = Array.from({ length: 150 }, (_, i) => `empty-${i}`);
    const reals = ['real-1', 'real-2', 'real-3'];
    const { cron, mocks } = buildCron({
      rolesByOrg: { 'org-empty': empties, 'org-real': reals },
      resultFor: (roleId) =>
        roleId.startsWith('real')
          ? { created: 1, merged: 0, skipped: null }
          : { created: 0, merged: 0, skipped: 'no_persons' },
    });

    const summary = await cron.runOnce();

    expect(summary.created).toBe(3);
    for (const r of reals) {
      expect(mocks.synthesizeForRole).toHaveBeenCalledWith(expect.objectContaining({ roleId: r }));
    }
  });

  it('created/merged и llm_error тратят бюджет; pre-LLM skip — нет (бюджет = число реальных вызовов)', async () => {
    const roles = Array.from({ length: 100 }, (_, i) => `r-${i}`);
    const { cron, mocks } = buildCron({
      rolesByOrg: { 'org-1': roles },
      resultFor: (roleId) => {
        const n = Number(roleId.split('-')[1]);
        if (n < 30) return { created: 1, merged: 0, skipped: null };
        if (n < 60) return { created: 0, merged: 0, skipped: 'below_threshold' };
        return { created: 0, merged: 0, skipped: 'llm_error' };
      },
    });

    const summary = await cron.runOnce();

    expect(mocks.synthesizeForRole).toHaveBeenCalledTimes(100);
    expect(summary.rolesProcessed).toBe(100);
    expect(summary.created).toBe(30);
    expect(summary.skipped).toBe(70);
  });

  it('бюджет ограничивает число РЕАЛЬНЫХ вызовов: 130 created-ролей → ровно 100 вызовов (cap)', async () => {
    const roles = Array.from({ length: 130 }, (_, i) => `r-${i}`);
    const { cron, mocks } = buildCron({
      rolesByOrg: { 'org-1': roles },
      resultFor: () => ({ created: 1, merged: 0, skipped: null }),
    });

    const summary = await cron.runOnce();

    expect(mocks.synthesizeForRole).toHaveBeenCalledTimes(100);
    expect(summary.created).toBe(100);
  });
});
