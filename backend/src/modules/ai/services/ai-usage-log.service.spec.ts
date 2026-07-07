import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { CurrencyRateService } from '../../admin/economics/currency-rate.service';

import { AiUsageLogService, truncatePreview } from './ai-usage-log.service';

function makeCfg(previewMaxBytes?: number): TypedConfigService {
  return {
    getDynamic: vi.fn(async (_key: string, _envKey: unknown, fallback: unknown) =>
      previewMaxBytes ?? fallback,
    ),
  } as unknown as TypedConfigService;
}

function makeCurrencyRate(rate: number): CurrencyRateService {
  return {
    getCurrentUsdRubRate: vi.fn(async () => rate),
  } as unknown as CurrencyRateService;
}

function makeServices(
  previewMaxBytes?: number,
  currencyRate?: CurrencyRateService,
): {
  service: AiUsageLogService;
  create: ReturnType<typeof vi.fn>;
  addCost: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn(async () => ({ id: 'log-1' }));
  const addCost = vi.fn();
  const prisma = {
    aiUsageLog: { create },
  } as unknown as PrismaService;
  const metrics = {
    addAiCostUsd: addCost,
  } as unknown as BusinessMetricsService;

  return {
    service: new AiUsageLogService(prisma, metrics, makeCfg(previewMaxBytes), currencyRate),
    create,
    addCost,
  };
}

describe('AiUsageLogService.record', () => {
  it('пишет AiUsageLog с decimal-cost', async () => {
    const { service, create, addCost } = makeServices();
    await service.record({
      meetingId: 'm-1',
      agentType: 'summary',
      jobId: 'j-1',
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.00105,
      durationMs: 800,
      success: true,
    });
    expect(create).toHaveBeenCalledOnce();
    const call = create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(call.data['meetingId']).toBe('m-1');
    expect(call.data['agentType']).toBe('summary');
    expect(call.data['provider']).toBe('anthropic');
    expect(call.data['inputTokens']).toBe(100);
    expect(call.data['outputTokens']).toBe(50);
    expect(call.data['success']).toBe(true);
    expect(addCost).toHaveBeenCalledWith(0.00105);
  });

  it('костов 0 → не инкрементит метрику', async () => {
    const { service, addCost } = makeServices();
    await service.record({
      meetingId: 'm-1',
      agentType: 'transcribe',
      model: 'v3_rnnt',
      provider: 'vox',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      durationMs: 5000,
      success: true,
    });
    expect(addCost).not.toHaveBeenCalled();
  });

  it('фейл записи в БД не пробрасывается', async () => {
    const create = vi.fn(async () => {
      throw new Error('db down');
    });
    const prisma = {
      aiUsageLog: { create },
    } as unknown as PrismaService;
    const metrics = { addAiCostUsd: vi.fn() } as unknown as BusinessMetricsService;
    const svc = new AiUsageLogService(prisma, metrics, makeCfg());

    await expect(
      svc.record({
        agentType: 'summary',
        model: 'm',
        provider: 'anthropic',
        costUsd: 0,
        durationMs: 1,
        success: false,
        errorText: 'x',
      }),
    ).resolves.toBeNull();
  });

  it('усекает превью по лимиту из getDynamic', async () => {
    const { service, create } = makeServices(4);
    await service.record({
      agentType: 'summary',
      model: 'm',
      provider: 'deepseek',
      costUsd: 0,
      durationMs: 1,
      success: true,
      requestPreview: 'abcdefgh',
      responsePreview: 'ABCDEFGH',
    });
    const call = create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(call.data['requestPreview']).toBe('abcd');
    expect(call.data['responsePreview']).toBe('ABCD');
  });

  it('считает costRub через CurrencyRateService', async () => {
    const { service, create } = makeServices(undefined, makeCurrencyRate(90));
    await service.record({
      agentType: 'summary',
      model: 'm',
      provider: 'anthropic',
      costUsd: 1,
      durationMs: 1,
      success: true,
    });
    const call = create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    const costRub = call.data['costRub'] as { toFixed: (n: number) => string };
    expect(costRub.toFixed(4)).toBe('90.0000');
  });

  it('сбой CurrencyRateService не роняет запись, costRub отсутствует', async () => {
    const currencyRate = {
      getCurrentUsdRubRate: vi.fn(async () => {
        throw new Error('fx down');
      }),
    } as unknown as CurrencyRateService;
    const { service, create } = makeServices(undefined, currencyRate);

    await expect(
      service.record({
        agentType: 'summary',
        model: 'm',
        provider: 'anthropic',
        costUsd: 1,
        durationMs: 1,
        success: true,
      }),
    ).resolves.toBe('log-1');
    const call = create.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(call.data['costRub']).toBeUndefined();
  });
});

describe('truncatePreview', () => {
  it('режет строку длиннее лимита по байтам', () => {
    expect(truncatePreview('abcdefgh', 4)).toBe('abcd');
  });

  it('не трогает строку короче лимита', () => {
    expect(truncatePreview('abc', 4)).toBe('abc');
  });

  it('режет по байтам, а не по символам (utf-8)', () => {
    expect(truncatePreview('аб', 2)).toBe('а');
  });

  it('null/undefined → null', () => {
    expect(truncatePreview(null, 4)).toBeNull();
    expect(truncatePreview(undefined, 4)).toBeNull();
  });
});
