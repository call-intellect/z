import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ProviderSmokeTestCron } from '../economics/provider-smoke-test.cron';

import { AdminSmokeTestService } from './smoke-test.service';

describe('AdminSmokeTestService', () => {
  const findUnique = vi.fn();
  const findMany = vi.fn();
  const testProvider = vi.fn();

  const prisma = {
    llmProvider: { findUnique, findMany },
  } as unknown as PrismaService;
  const cron = { testProvider } as unknown as ProviderSmokeTestCron;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runForProvider: success → status=ok, latencyMs из durationSeconds', async () => {
    findUnique.mockResolvedValueOnce({
      id: 'p1',
      name: 'deepseek',
      isActive: true,
      deletedAt: null,
    });
    testProvider.mockResolvedValueOnce({
      provider: 'deepseek',
      success: true,
      durationSeconds: 0.234,
    });

    const svc = new AdminSmokeTestService(prisma, cron);
    const r = await svc.runForProvider('deepseek', 'user-1');
    expect(r.status).toBe('ok');
    expect(r.provider).toBe('deepseek');
    expect(r.latencyMs).toBe(234);
    expect(r.error).toBeUndefined();
  });

  it('runForProvider: fail → status=fail, error прокинут', async () => {
    findUnique.mockResolvedValueOnce({
      id: 'p1',
      name: 'deepseek',
      isActive: true,
      deletedAt: null,
    });
    testProvider.mockResolvedValueOnce({
      provider: 'deepseek',
      success: false,
      durationSeconds: 1.5,
      error: 'connection refused',
    });

    const svc = new AdminSmokeTestService(prisma, cron);
    const r = await svc.runForProvider('deepseek', 'user-1');
    expect(r.status).toBe('fail');
    expect(r.latencyMs).toBe(1500);
    expect(r.error).toBe('connection refused');
  });

  it('runForProvider: 404, если провайдер удалён (deletedAt != null)', async () => {
    findUnique.mockResolvedValueOnce({
      id: 'p1',
      name: 'ghost',
      isActive: false,
      deletedAt: new Date(),
    });

    const svc = new AdminSmokeTestService(prisma, cron);
    await expect(svc.runForProvider('ghost', null)).rejects.toBeInstanceOf(NotFoundException);
    expect(testProvider).not.toHaveBeenCalled();
  });

  it('runForProvider: 404, если провайдер не найден', async () => {
    findUnique.mockResolvedValueOnce(null);
    const svc = new AdminSmokeTestService(prisma, cron);
    await expect(svc.runForProvider('nope', null)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('runForAllActive: параллельно вызывает testProvider для каждого активного провайдера', async () => {
    findMany.mockResolvedValueOnce([
      { name: 'anthropic' },
      { name: 'deepseek' },
      { name: 'ollama' },
    ]);
    testProvider
      .mockResolvedValueOnce({ provider: 'anthropic', success: true, durationSeconds: 0.1 })
      .mockResolvedValueOnce({ provider: 'deepseek', success: true, durationSeconds: 0.2 })
      .mockResolvedValueOnce({
        provider: 'ollama',
        success: false,
        durationSeconds: 0.3,
        error: 'timeout',
      });

    const svc = new AdminSmokeTestService(prisma, cron);
    const res = await svc.runForAllActive('user-1');
    expect(res).toHaveLength(3);
    expect(res.map((r) => r.provider)).toEqual(['anthropic', 'deepseek', 'ollama']);
    expect(res[0]!.status).toBe('ok');
    expect(res[2]!.status).toBe('fail');
    expect(res[2]!.error).toBe('timeout');
    expect(testProvider).toHaveBeenCalledTimes(3);
  });

  it('runForAllActive: пустой массив, если активных нет', async () => {
    findMany.mockResolvedValueOnce([]);
    const svc = new AdminSmokeTestService(prisma, cron);
    const res = await svc.runForAllActive(null);
    expect(res).toEqual([]);
    expect(testProvider).not.toHaveBeenCalled();
  });

  it('runForAllActive: один testProvider бросил исключение → fail с error, остальные ok', async () => {
    findMany.mockResolvedValueOnce([{ name: 'a' }, { name: 'b' }]);
    testProvider
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ provider: 'b', success: true, durationSeconds: 0.05 });

    const svc = new AdminSmokeTestService(prisma, cron);
    const res = await svc.runForAllActive('user-1');
    expect(res).toHaveLength(2);
    expect(res[0]!.status).toBe('fail');
    expect(res[0]!.error).toBe('boom');
    expect(res[1]!.status).toBe('ok');
  });

  it('getHistory: возвращает последние записи в порядке от новых к старым', async () => {
    findUnique.mockResolvedValue({
      id: 'p1',
      name: 'deepseek',
      isActive: true,
      deletedAt: null,
    });
    testProvider.mockImplementation(async () => ({
      provider: 'deepseek',
      success: true,
      durationSeconds: 0.1,
    }));

    const svc = new AdminSmokeTestService(prisma, cron);
    await svc.runForProvider('deepseek', 'user-1');
    await svc.runForProvider('deepseek', 'user-1');
    await svc.runForProvider('deepseek', 'user-1');

    const h = svc.getHistory(2);
    expect(h).toHaveLength(2);
    expect(h.every((r) => r.provider === 'deepseek')).toBe(true);
  });
});
