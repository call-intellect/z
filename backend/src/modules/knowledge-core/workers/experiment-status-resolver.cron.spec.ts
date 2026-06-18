/**
 * G4 (CONFIRMED, MED) — condition-UPDATE авто-перехода статуса эксперимента.
 *
 * `resolveStatusesForOrg` переводит статус ТОЛЬКО через
 * `updateMany({ where: { id, status: <прочитанный> } })` (эталон
 * fact-supersede.service.ts). Защита от гонки cron ↔ параллельный handler:
 *   - count > 0 → переход применён, updated++;
 *   - count === 0 → статус уже сменился параллельно → пропуск (updated не растёт).
 *
 * Все зависимости мокированы; гоняем приватный resolveStatusesForOrg напрямую.
 */
import type { Experiment } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { ExperimentStatusResolverCron } from './experiment-status-resolver.cron';

function makeExperiment(overrides: Partial<Experiment> = {}): Experiment {
  return {
    id: 'exp-1',
    tenantId: 'org-1',
    name: 'Эксперимент',
    hypothesisText: 'гипотеза',
    status: 'running',
    currentResult: 'есть результат',
    // running → completed требует ≥1 lesson.
    lessonsJson: [{ text: 'урок', type: 'what_worked' }],
    startedAt: new Date(Date.now() - 24 * 3600 * 1000),
    completedAt: null,
    confidence: 0.9 as unknown as Experiment['confidence'],
    ...overrides,
  } as unknown as Experiment;
}

function makeCron(args: {
  candidates: Experiment[];
  updateManyCount: number;
}): {
  cron: ExperimentStatusResolverCron;
  updateMany: ReturnType<typeof vi.fn>;
} {
  const updateMany = vi.fn().mockResolvedValue({ count: args.updateManyCount });
  const prisma = {
    experiment: {
      findMany: vi.fn().mockResolvedValue(args.candidates),
      update: vi.fn(),
      updateMany,
    },
  };
  const cfg = {
    experiments: { autoStatusTransitionEnabled: true },
  };
  const probes = {} as never;
  const metrics = {} as never;
  const cron = new ExperimentStatusResolverCron(
    prisma as never,
    cfg as never,
    probes,
    metrics,
  );
  return { cron, updateMany };
}

describe('ExperimentStatusResolverCron.resolveStatusesForOrg — G4 condition-UPDATE', () => {
  it('running→completed: updateMany c guard по текущему статусу, count>0 → updated=1', async () => {
    const { cron, updateMany } = makeCron({
      candidates: [makeExperiment({ status: 'running' })],
      updateManyCount: 1,
    });
    const updated = await (
      cron as unknown as {
        resolveStatusesForOrg: (t: string) => Promise<number>;
      }
    ).resolveStatusesForOrg('org-1');

    expect(updated).toBe(1);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'exp-1', status: 'running' }),
        data: expect.objectContaining({ status: 'completed' }),
      }),
    );
  });

  it('гонка: статус уже сменился (count===0) → abort, updated=0', async () => {
    const { cron, updateMany } = makeCron({
      candidates: [makeExperiment({ status: 'running' })],
      updateManyCount: 0,
    });
    const updated = await (
      cron as unknown as {
        resolveStatusesForOrg: (t: string) => Promise<number>;
      }
    ).resolveStatusesForOrg('org-1');

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updated).toBe(0);
  });

  it('низкая confidence (<0.7) → переход не делается, updateMany не вызывается', async () => {
    const { cron, updateMany } = makeCron({
      candidates: [
        makeExperiment({
          status: 'running',
          confidence: 0.5 as unknown as Experiment['confidence'],
        }),
      ],
      updateManyCount: 1,
    });
    const updated = await (
      cron as unknown as {
        resolveStatusesForOrg: (t: string) => Promise<number>;
      }
    ).resolveStatusesForOrg('org-1');

    expect(updated).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
