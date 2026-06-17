import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/index';
import type { CryptoService } from '../../common/crypto/crypto.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { JwtService } from '../auth/services/jwt.service';

import type { BitrixApiClient } from './bitrix-api.client';
import { BitrixIntegrationService } from './bitrix-integration.service';

function makeService(updateManyResult: { count: number }): {
  service: BitrixIntegrationService;
  updateMany: ReturnType<typeof vi.fn>;
} {
  const updateMany = vi.fn().mockResolvedValue(updateManyResult);
  const prisma = { bitrixIntegration: { updateMany } };
  const service = new BitrixIntegrationService(
    prisma as unknown as PrismaService,
    {} as unknown as CryptoService,
    {} as unknown as BitrixApiClient,
    {} as unknown as JwtService,
    {} as unknown as TypedConfigService,
  );
  return { service, updateMany };
}

describe('BitrixIntegrationService.setAnalysisEnabled', () => {
  it('обновляет analysisEnabled и возвращает новое значение', async () => {
    const { service, updateMany } = makeService({ count: 1 });
    const res = await service.setAnalysisEnabled('t1', false);
    expect(res).toEqual({ ok: true, analysisEnabled: false });
    expect(updateMany).toHaveBeenCalledWith({
      where: { tenantId: 't1' },
      data: { analysisEnabled: false },
    });
  });

  it('нет интеграции (count=0) → NotFoundException', async () => {
    const { service } = makeService({ count: 0 });
    await expect(service.setAnalysisEnabled('t1', true)).rejects.toBeInstanceOf(NotFoundException);
  });
});
