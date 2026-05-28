/**
 * Unit-тест для TourProgressService.
 *
 * Что проверяем:
 *   - get: вытаскивает tourProgress, нормализует мусор / пропуски / массивы.
 *   - update: merge — не теряет другие туры, не теряет другие поля у того же тура.
 *   - update: started_total инкрементируется только на первый PATCH (без completedAt/skipped).
 *   - update: completed_total инкрементируется только когда completedAt появляется впервые.
 *   - update: skipped_total инкрементируется только когда skipped:true появляется впервые.
 *   - reset: пишет пустой объект.
 *   - user_not_found → NotFoundException.
 */

import { NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';

import { TourProgressService } from './tour-progress.service';

function buildDeps(initial: unknown) {
  const userRecord = initial === undefined ? null : { tourProgress: initial };
  const findUnique = vi.fn(async () => userRecord);
  const update = vi.fn(async () => ({}));
  const prisma = {
    user: { findUnique, update },
  };
  const metrics = {
    incTourStarted: vi.fn(),
    incTourCompleted: vi.fn(),
    incTourSkipped: vi.fn(),
  };
  const svc = new TourProgressService(
    prisma as unknown as PrismaService,
    metrics as unknown as BusinessMetricsService,
  );
  return { svc, prisma, metrics, findUnique, update };
}

describe('TourProgressService.get', () => {
  it('возвращает пустой объект, если tourProgress = {}', async () => {
    const { svc } = buildDeps({});
    const res = await svc.get('u-1');
    expect(res).toEqual({});
  });

  it('нормализует мусор в БД (массив / скаляр / null) к {}', async () => {
    for (const garbage of [null, 'строка', 42, [], [1, 2]]) {
      const { svc } = buildDeps(garbage);
      expect(await svc.get('u-1')).toEqual({});
    }
  });

  it('возвращает только известные туры из миксованного payload', async () => {
    const { svc } = buildDeps({
      welcome: { completedAt: '2026-05-27T10:00:00.000Z', skipped: false },
      unknown_future_tour: { completedAt: '2030-01-01T00:00:00.000Z' },
      project: { skipped: true },
    });
    const res = await svc.get('u-1');
    expect(res).toEqual({
      welcome: { completedAt: '2026-05-27T10:00:00.000Z', skipped: false },
      project: { skipped: true },
    });
  });

  it('бросает NotFoundException если пользователь не найден', async () => {
    const { svc } = buildDeps(undefined);
    await expect(svc.get('u-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('TourProgressService.update', () => {
  beforeEach(() => vi.clearAllMocks());

  it('merge: добавляет welcome, не теряет project', async () => {
    const { svc, update, metrics } = buildDeps({
      project: { completedAt: '2026-05-20T00:00:00.000Z' },
    });
    const res = await svc.update('u-1', 'org-1', {
      tourId: 'welcome',
      completedAt: '2026-05-27T10:00:00.000Z',
    });
    expect(res).toEqual({
      project: { completedAt: '2026-05-20T00:00:00.000Z' },
      welcome: { completedAt: '2026-05-27T10:00:00.000Z' },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: {
        tourProgress: {
          project: { completedAt: '2026-05-20T00:00:00.000Z' },
          welcome: { completedAt: '2026-05-27T10:00:00.000Z' },
        },
      },
    });
    // completedAt появился впервые → completed_total +1, started — нет.
    expect(metrics.incTourCompleted).toHaveBeenCalledWith({
      tenant: 'org-1',
      tour_id: 'welcome',
    });
    expect(metrics.incTourStarted).not.toHaveBeenCalled();
    expect(metrics.incTourSkipped).not.toHaveBeenCalled();
  });

  it('первый PATCH без completedAt/skipped → started_total +1', async () => {
    const { svc, metrics } = buildDeps({});
    await svc.update('u-1', null, { tourId: 'welcome' });
    expect(metrics.incTourStarted).toHaveBeenCalledWith({
      tenant: 'none',
      tour_id: 'welcome',
    });
    expect(metrics.incTourCompleted).not.toHaveBeenCalled();
  });

  it('повторный PATCH с тем же completedAt → completed_total НЕ инкрементируется', async () => {
    const { svc, metrics } = buildDeps({
      welcome: { completedAt: '2026-05-27T10:00:00.000Z' },
    });
    await svc.update('u-1', null, {
      tourId: 'welcome',
      completedAt: '2026-05-27T11:00:00.000Z',
    });
    expect(metrics.incTourCompleted).not.toHaveBeenCalled();
  });

  it('skipped:true в первый раз → skipped_total +1', async () => {
    const { svc, metrics } = buildDeps({});
    await svc.update('u-1', 'org-7', { tourId: 'project', skipped: true });
    expect(metrics.incTourSkipped).toHaveBeenCalledWith({
      tenant: 'org-7',
      tour_id: 'project',
      at_step: 'unknown',
    });
  });

  it('skipped:true повторно → skipped_total НЕ инкрементируется', async () => {
    const { svc, metrics } = buildDeps({
      project: { skipped: true },
    });
    await svc.update('u-1', null, { tourId: 'project', skipped: true });
    expect(metrics.incTourSkipped).not.toHaveBeenCalled();
  });

  it('бросает NotFoundException если пользователь не найден', async () => {
    const { svc } = buildDeps(undefined);
    await expect(
      svc.update('u-1', null, { tourId: 'welcome' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('TourProgressService.reset', () => {
  it('пишет {} в tourProgress', async () => {
    const findUnique = vi.fn(async () => ({ id: 'u-1' }));
    const update = vi.fn(async () => ({}));
    const prisma = { user: { findUnique, update } };
    const metrics = {
      incTourStarted: vi.fn(),
      incTourCompleted: vi.fn(),
      incTourSkipped: vi.fn(),
    };
    const svc = new TourProgressService(
      prisma as unknown as PrismaService,
      metrics as unknown as BusinessMetricsService,
    );
    const res = await svc.reset('u-1');
    expect(res).toEqual({ ok: true });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: { tourProgress: {} },
    });
  });

  it('бросает NotFoundException если пользователь не найден', async () => {
    const findUnique = vi.fn(async () => null);
    const update = vi.fn();
    const prisma = { user: { findUnique, update } };
    const metrics = {
      incTourStarted: vi.fn(),
      incTourCompleted: vi.fn(),
      incTourSkipped: vi.fn(),
    };
    const svc = new TourProgressService(
      prisma as unknown as PrismaService,
      metrics as unknown as BusinessMetricsService,
    );
    await expect(svc.reset('u-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });
});
