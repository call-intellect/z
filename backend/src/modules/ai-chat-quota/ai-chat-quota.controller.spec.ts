/**
 * ТЗ 2026-05-31 (ai-chat-quota-unified-per-user) §Фаза 5 — controller-spec.
 *
 * Тестируем тонкий controller-слой `AiChatQuotaController.getMyQuota`:
 *   1. admin (role='owner', limit 50) — делегирует в сервис и возвращает
 *      результат как есть.
 *   2. member (role='manager', limit 20) — то же поведение, лимит из сервиса.
 *   3. tenantId отсутствует → BadRequestException (code='tenant_required').
 *
 * Сервис мокается полностью (его собственные кейсы покрыты
 * `ai-chat-quota.service.spec.ts`).
 */

import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { CurrentUserPayload } from '../auth/decorators/current-user.decorator';

import { AiChatQuotaService } from './ai-chat-quota.service';
import { AiChatQuotaController } from './ai-chat-quota.controller';

const sampleUser: CurrentUserPayload = {
  id: 'u-1',
  email: 'member@z.test',
  role: 'user',
};

const TENANT_ID = 'tenant-1';

function buildController(opts: {
  getUsage?: (input: {
    tenantId: string;
    userId: string;
  }) => Promise<{ dailyUsed: number; dailyLimit: number; role: string }>;
} = {}) {
  const svc = {
    getUsage: vi.fn(
      opts.getUsage ??
        (async () => ({ dailyUsed: 3, dailyLimit: 50, role: 'owner' })),
    ),
  } as unknown as AiChatQuotaService;
  const ctrl = new AiChatQuotaController(svc);
  return { ctrl, svc };
}

describe('AiChatQuotaController.getMyQuota', () => {
  it('admin (role=owner, limit=50): делегирует в сервис и возвращает результат', async () => {
    const { ctrl, svc } = buildController({
      getUsage: async () => ({ dailyUsed: 12, dailyLimit: 50, role: 'owner' }),
    });
    const out = await ctrl.getMyQuota(sampleUser, TENANT_ID);
    expect(svc.getUsage).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      userId: 'u-1',
    });
    expect(out).toEqual({ dailyUsed: 12, dailyLimit: 50, role: 'owner' });
  });

  it('member (role=manager, limit=20): тот же путь, лимит из сервиса', async () => {
    const { ctrl, svc } = buildController({
      getUsage: async () => ({ dailyUsed: 7, dailyLimit: 20, role: 'manager' }),
    });
    const out = await ctrl.getMyQuota(sampleUser, TENANT_ID);
    expect(svc.getUsage).toHaveBeenCalledWith({
      tenantId: TENANT_ID,
      userId: 'u-1',
    });
    expect(out).toEqual({ dailyUsed: 7, dailyLimit: 20, role: 'manager' });
  });

  it('tenantId отсутствует → BadRequestException (tenant_required), сервис не вызывается', async () => {
    const { ctrl, svc } = buildController();
    await expect(
      ctrl.getMyQuota(sampleUser, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(svc.getUsage).not.toHaveBeenCalled();
  });
});
