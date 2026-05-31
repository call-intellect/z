import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/typed-config.service';
import type { QuotaService } from '../quotas/quota.service';
import type { RbacService } from '../rbac/rbac.service';

import { AiChatQuotaService } from './ai-chat-quota.service';

function makeCfg(
  overrides: Partial<{
    dailyLimitAdmin: number;
    dailyLimitMember: number;
    adminRoles: string[];
  }> = {},
): TypedConfigService {
  return {
    aiChatQuota: {
      dailyLimitAdmin: overrides.dailyLimitAdmin ?? 50,
      dailyLimitMember: overrides.dailyLimitMember ?? 20,
      adminRoles: overrides.adminRoles ?? ['owner', 'admin', 'coo'],
    },
  } as unknown as TypedConfigService;
}

function makeQuota(
  opts: {
    checkAndIncrement?: (input: {
      userId: string;
      quotaName: string;
      max: number;
      windowMs: number;
    }) => Promise<{ ok: true; current: number; remaining: number }>;
    peek?: (input: {
      userId: string;
      quotaName: string;
      windowMs: number;
    }) => Promise<number>;
  } = {},
): QuotaService {
  return {
    checkAndIncrement: vi.fn(
      opts.checkAndIncrement ??
        (async (input) => ({
          ok: true as const,
          current: 1,
          remaining: Math.max(0, input.max - 1),
        })),
    ),
    peek: vi.fn(opts.peek ?? (async () => 0)),
  } as unknown as QuotaService;
}

function makeRbac(role: string | null): RbacService {
  return {
    getMembershipRole: vi.fn(async () => role),
  } as unknown as RbacService;
}

describe('AiChatQuotaService.tryConsume', () => {
  it('admin-роль (owner) → лимит 50', async () => {
    const quota = makeQuota();
    const svc = new AiChatQuotaService(quota, makeRbac('owner'), makeCfg());
    const r = await svc.tryConsume({ tenantId: 'org1', userId: 'u1' });
    expect(r.limit).toBe(50);
    expect(r.role).toBe('owner');
    expect(quota.checkAndIncrement).toHaveBeenCalledWith({
      userId: 'u1',
      quotaName: 'ai_chat_messages_per_day',
      max: 50,
      windowMs: 24 * 60 * 60 * 1000,
    });
  });

  it('member-роль (manager) → лимит 20', async () => {
    const quota = makeQuota();
    const svc = new AiChatQuotaService(quota, makeRbac('manager'), makeCfg());
    const r = await svc.tryConsume({ tenantId: 'org1', userId: 'u2' });
    expect(r.limit).toBe(20);
    expect(r.role).toBe('manager');
    expect(quota.checkAndIncrement).toHaveBeenCalledWith({
      userId: 'u2',
      quotaName: 'ai_chat_messages_per_day',
      max: 20,
      windowMs: 24 * 60 * 60 * 1000,
    });
  });

  it('роль null → fallback на member-лимит', async () => {
    const quota = makeQuota();
    const svc = new AiChatQuotaService(quota, makeRbac(null), makeCfg());
    const r = await svc.tryConsume({ tenantId: 'org1', userId: 'u3' });
    expect(r.limit).toBe(20);
    expect(r.role).toBe('member');
  });
});

describe('AiChatQuotaService.getUsage', () => {
  it('без инкремента возвращает dailyUsed из quota.peek', async () => {
    const quota = makeQuota({ peek: async () => 7 });
    const svc = new AiChatQuotaService(quota, makeRbac('owner'), makeCfg());
    const r = await svc.getUsage({ tenantId: 'org1', userId: 'u1' });
    expect(r).toEqual({ dailyUsed: 7, dailyLimit: 50, role: 'owner' });
    expect(quota.peek).toHaveBeenCalledWith({
      userId: 'u1',
      quotaName: 'ai_chat_messages_per_day',
      windowMs: 24 * 60 * 60 * 1000,
    });
  });
});
