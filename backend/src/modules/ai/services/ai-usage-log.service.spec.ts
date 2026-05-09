import { describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { AiUsageLogService } from './ai-usage-log.service';

function makeServices(): {
  service: AiUsageLogService;
  create: ReturnType<typeof vi.fn>;
  addCost: ReturnType<typeof vi.fn>;
} {
  const create = vi.fn(async () => undefined);
  const addCost = vi.fn();
  const prisma = {
    aiUsageLog: { create },
  } as unknown as PrismaService;
  const metrics = {
    addAiCostUsd: addCost,
  } as unknown as BusinessMetricsService;

  return { service: new AiUsageLogService(prisma, metrics), create, addCost };
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
      costUsd: 0.001050,
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
    expect(addCost).toHaveBeenCalledWith(0.001050);
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
    const svc = new AiUsageLogService(prisma, metrics);

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
    ).resolves.toBeUndefined();
  });
});
