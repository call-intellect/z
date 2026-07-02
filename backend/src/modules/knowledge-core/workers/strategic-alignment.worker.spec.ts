import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import type { StrategicAlignmentJobData } from '../../core-queue/queues';

import { StrategicAlignmentWorker } from './strategic-alignment.worker';

const TENANT = 'org-1';
const GOAL = 'goal-1';

function makeWorker(args: { llmText?: string; llmThrows?: boolean }) {
  const themeLink = {
    theme: { id: 'theme-1', name: 'Тема', weight: '1', dynamic: 0.5, status: 'active' },
  };
  const snapshotCreate = vi.fn(async () => ({ id: 'snap-1', createdAt: new Date() }));
  const goalUpdate = vi.fn(async () => ({}));

  const prisma = {
    goal: {
      findUnique: vi.fn(async () => ({
        id: GOAL,
        tenantId: TENANT,
        name: 'Цель',
        description: null,
        targetDate: null,
        status: 'active',
        archivedAt: null,
        themes: [themeLink],
      })),
      update: goalUpdate,
    },
    org: {
      findUnique: vi.fn(async () => ({
        deletedAt: null,
        strategicAlignmentWindowDays: 30,
      })),
    },
    ideaBlock: {
      findMany: vi.fn(async () => [
        { signalType: 'decision', criticalQuestion: 'Q', trustedAnswer: 'A' },
      ]),
    },
    goalAlignmentSnapshot: { findFirst: vi.fn(async () => null) },
    $transaction: vi.fn(
      async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          goalAlignmentSnapshot: { create: snapshotCreate },
          goal: { update: goalUpdate },
        }),
    ),
  } as unknown as ConstructorParameters<typeof StrategicAlignmentWorker>[1];

  const call = vi.fn(async () => {
    if (args.llmThrows) throw new Error('upstream 503 timeout');
    return { text: args.llmText ?? '' };
  });
  const llm = { call } as unknown as ConstructorParameters<typeof StrategicAlignmentWorker>[2];

  const auditLog = vi.fn(async () => {});
  const audit = { log: auditLog } as unknown as ConstructorParameters<
    typeof StrategicAlignmentWorker
  >[3];

  const gate = {
    checkOrThrow: vi.fn(async () => {}),
  } as unknown as ConstructorParameters<typeof StrategicAlignmentWorker>[4];

  const incStrategicAlignmentParseSkip = vi.fn();
  const metrics = { incStrategicAlignmentParseSkip } as unknown as ConstructorParameters<
    typeof StrategicAlignmentWorker
  >[5];

  const redis = {} as unknown as ConstructorParameters<typeof StrategicAlignmentWorker>[0];
  const cfg = {
    aiFeatures: { promptInjectionGuardEnabled: false },
    getDynamic: vi.fn(async (_k: string, _e: unknown, fallback: unknown) => fallback),
  } as unknown as ConstructorParameters<typeof StrategicAlignmentWorker>[6];

  const worker = new StrategicAlignmentWorker(redis, prisma, llm, audit, gate, metrics, cfg);

  return {
    worker,
    call,
    snapshotCreate,
    auditLog,
    incStrategicAlignmentParseSkip,
  };
}

function runProcess(worker: StrategicAlignmentWorker) {
  const job = {
    data: { tenantId: TENANT, goalId: GOAL } satisfies StrategicAlignmentJobData,
  } as unknown as Job<StrategicAlignmentJobData>;
  return (worker as unknown as { process: (j: typeof job) => Promise<void> }).process(job);
}

describe('StrategicAlignmentWorker — устойчивость к битому JSON (P3)', () => {
  it('битый JSON → НЕ бросает, graceful skip + incStrategicAlignmentParseSkip', async () => {
    const { worker, snapshotCreate, incStrategicAlignmentParseSkip } = makeWorker({
      llmText: "Гениально! Вот ответ: {score: 80",
    });

    await expect(runProcess(worker)).resolves.toBeUndefined();

    expect(snapshotCreate).not.toHaveBeenCalled();
    expect(incStrategicAlignmentParseSkip).toHaveBeenCalledTimes(1);
  });

  it('пустой ответ → graceful skip с reason=empty', async () => {
    const { worker, snapshotCreate, incStrategicAlignmentParseSkip } = makeWorker({
      llmText: '   ',
    });

    await expect(runProcess(worker)).resolves.toBeUndefined();

    expect(snapshotCreate).not.toHaveBeenCalled();
    expect(incStrategicAlignmentParseSkip).toHaveBeenCalledWith({ reason: 'empty' });
  });

  it('валидный JSON, но не по схеме → graceful skip с reason=schema_mismatch', async () => {
    const { worker, snapshotCreate, incStrategicAlignmentParseSkip } = makeWorker({
      llmText: '{"foo": "bar", "baz": 1}',
    });

    await expect(runProcess(worker)).resolves.toBeUndefined();

    expect(snapshotCreate).not.toHaveBeenCalled();
    expect(incStrategicAlignmentParseSkip).toHaveBeenCalledWith({ reason: 'schema_mismatch' });
  });

  it('валидный ответ по схеме → snapshot создаётся (регресс)', async () => {
    const { worker, snapshotCreate, incStrategicAlignmentParseSkip } = makeWorker({
      llmText: '{"score": 64, "explanation": "Движение есть.", "signals": {"pro": ["a"], "contra": []}}',
    });

    await runProcess(worker);

    expect(snapshotCreate).toHaveBeenCalledTimes(1);
    expect(incStrategicAlignmentParseSkip).not.toHaveBeenCalled();
  });

  it('сам LLM-вызов бросает (сеть/таймаут) → throw сохранён (BullMQ-ретрай)', async () => {
    const { worker, snapshotCreate, incStrategicAlignmentParseSkip } = makeWorker({
      llmThrows: true,
    });

    await expect(runProcess(worker)).rejects.toThrow(/503|timeout/);

    expect(snapshotCreate).not.toHaveBeenCalled();
    expect(incStrategicAlignmentParseSkip).not.toHaveBeenCalled();
  });
});
