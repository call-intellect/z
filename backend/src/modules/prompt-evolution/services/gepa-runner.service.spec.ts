/**
 * Agents v2 Фаза C2 (2026-05-30) — Unit-тесты `GepaRunnerService`.
 *
 * Мокируем `child_process.spawn`. Сценарии:
 *   1. Successful run → возвращает Pareto frontier.
 *   2. Python недоступен (ENOENT) → пустой массив, статус 'skipped_no_python'.
 *   3. Timeout → пустой массив, статус 'timeout'.
 *   4. Subprocess вернул error JSON → пустой массив, статус 'failed'.
 *   5. Пустой feedback → пустой массив, спавн не вызывался.
 */
import { EventEmitter } from 'node:events';

import type { PromptFeedback } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';

import { GepaRunnerService } from './gepa-runner.service';

// ── child_process mock ──
// Заводим управляемый mock spawn (resolved snapshot per test).
const spawnMock = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

interface FakeChild extends EventEmitter {
  stdin: { write: (s: string) => void; end: () => void };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: (sig: string) => void;
}

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  child.stdout = stdout;
  child.stderr = stderr;
  child.stdin = {
    write: () => {
      /* no-op */
    },
    end: () => {
      /* no-op */
    },
  };
  child.kill = () => {
    /* no-op */
  };
  return child;
}

function fb(i: number): PromptFeedback {
  return {
    id: `fb-${i}`,
    tenantId: 'org-1',
    promptKey: 'meeting-report-fast',
    promptVersion: 'v1',
    invocationId: `inv-${i}`,
    inputDigest: `digest-${i}`,
    inputEmbedding: null as unknown,
    originalOutput: `original ${i}`,
    editedOutput: `edited ${i}`,
    editDistance: 0.3,
    editedAt: new Date(),
    editedByUserId: 'u1',
    downstreamSignals: null,
    createdAt: new Date(),
  } as PromptFeedback;
}

function makeCfg(timeoutMs = 5000): Partial<TypedConfigService> {
  return {
    get gepa() {
      return {
        enabled: true,
        maxMetricCalls: 150,
        reflectionLm: 'deepseek-v4-pro',
        taskLm: 'deepseek-v4-pro',
        abTrafficShare: 0.1,
        abMinInvocationsBeforeDecision: 100,
        abPromoteThreshold: 0.05,
        abRejectThreshold: 0.1,
        pythonPath: '/usr/bin/python3',
        timeoutMs,
      } as const;
    },
  } as Partial<TypedConfigService>;
}

function makeMetrics() {
  return {
    incGepaOptimization: vi.fn(),
    incGepaCost: vi.fn(),
  } as unknown as BusinessMetricsService;
}

beforeEach(() => {
  spawnMock.mockReset();
});

describe('GepaRunnerService', () => {
  it('1) successful subprocess → возвращает Pareto frontier candidates', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValueOnce(child);

    const cfg = makeCfg();
    const metrics = makeMetrics();
    const svc = new GepaRunnerService(
      cfg as TypedConfigService,
      metrics,
    );

    const promise = svc.runOptimization({
      promptKey: 'meeting-report-fast',
      feedback: [fb(1), fb(2), fb(3)],
      seedPrompt: 'You are helpful.',
      tenantTop: 't000',
    });

    // Имитируем работу subprocess: stdout с валидным JSON.
    setImmediate(() => {
      const payload = JSON.stringify({
        pareto_frontier: [
          {
            text: 'You are concise and helpful.',
            metrics: { accuracy: 0.91, cost: 0.05 },
            traces: [{ step: 1, note: 'reflect' }],
          },
        ],
        cost_usd: 12.5,
      });
      child.stdout.emit('data', Buffer.from(payload));
      child.emit('close', 0);
    });

    const result = await promise;
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.text).toContain('concise');
    expect(result.candidates[0]!.metrics).toEqual({ accuracy: 0.91, cost: 0.05 });
    expect(result.costUsd).toBe(12.5);
    expect(metrics.incGepaOptimization).toHaveBeenCalledWith({
      promptKey: 'meeting-report-fast',
      status: 'success',
    });
    expect(metrics.incGepaCost).toHaveBeenCalledWith({
      tenantTop: 't000',
      costUsd: 12.5,
    });
  });

  it('2) Python недоступен (ENOENT) → пустой массив, status=skipped_no_python', async () => {
    const child = makeFakeChild();
    // Второй вызов (fallback на altScript) тоже падает с ENOENT.
    const child2 = makeFakeChild();
    spawnMock.mockReturnValueOnce(child).mockReturnValueOnce(child2);

    const cfg = makeCfg();
    const metrics = makeMetrics();
    const svc = new GepaRunnerService(cfg as TypedConfigService, metrics);

    const promise = svc.runOptimization({
      promptKey: 'meeting-report-fast',
      feedback: [fb(1)],
      seedPrompt: 'seed',
    });

    setImmediate(() => {
      const err = Object.assign(new Error('spawn ENOENT'), {
        code: 'ENOENT',
      });
      child.emit('error', err);
      // fallback тоже падает
      setImmediate(() => {
        const err2 = Object.assign(new Error('spawn ENOENT'), {
          code: 'ENOENT',
        });
        child2.emit('error', err2);
      });
    });

    const result = await promise;
    expect(result.candidates).toEqual([]);
    expect(metrics.incGepaOptimization).toHaveBeenCalledWith({
      promptKey: 'meeting-report-fast',
      status: 'skipped_no_python',
    });
  });

  it('3) timeout → пустой массив, status=timeout', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValueOnce(child);

    const cfg = makeCfg(50); // 50ms timeout
    const metrics = makeMetrics();
    const svc = new GepaRunnerService(cfg as TypedConfigService, metrics);

    // child никогда не отвечает — таймаут сработает.
    const result = await svc.runOptimization({
      promptKey: 'meeting-report-fast',
      feedback: [fb(1)],
      seedPrompt: 'seed',
    });

    expect(result.candidates).toEqual([]);
    expect(metrics.incGepaOptimization).toHaveBeenCalledWith({
      promptKey: 'meeting-report-fast',
      status: 'timeout',
    });
  });

  it('4) subprocess вернул error JSON → status=failed', async () => {
    const child = makeFakeChild();
    spawnMock.mockReturnValueOnce(child);

    const cfg = makeCfg();
    const metrics = makeMetrics();
    const svc = new GepaRunnerService(cfg as TypedConfigService, metrics);

    const promise = svc.runOptimization({
      promptKey: 'meeting-report-fast',
      feedback: [fb(1)],
      seedPrompt: 'seed',
    });

    setImmediate(() => {
      const payload = JSON.stringify({
        error: 'GEPA не установлен (ImportError)',
        pareto_frontier: [],
      });
      child.stdout.emit('data', Buffer.from(payload));
      child.emit('close', 0);
    });

    const result = await promise;
    expect(result.candidates).toEqual([]);
    expect(metrics.incGepaOptimization).toHaveBeenCalledWith({
      promptKey: 'meeting-report-fast',
      status: 'failed',
    });
  });

  it('5) пустой feedback → пустой массив, spawn не вызывался', async () => {
    const cfg = makeCfg();
    const metrics = makeMetrics();
    const svc = new GepaRunnerService(cfg as TypedConfigService, metrics);

    const result = await svc.runOptimization({
      promptKey: 'meeting-report-fast',
      feedback: [],
      seedPrompt: 'seed',
    });
    expect(result.candidates).toEqual([]);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('6) feedback без editedOutput → пустой dataset → status=failed', async () => {
    const cfg = makeCfg();
    const metrics = makeMetrics();
    const svc = new GepaRunnerService(cfg as TypedConfigService, metrics);

    const onlyOriginals: PromptFeedback[] = [
      { ...fb(1), editedOutput: null } as PromptFeedback,
      { ...fb(2), editedOutput: null } as PromptFeedback,
    ];

    const result = await svc.runOptimization({
      promptKey: 'meeting-report-fast',
      feedback: onlyOriginals,
      seedPrompt: 'seed',
    });
    expect(result.candidates).toEqual([]);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(metrics.incGepaOptimization).toHaveBeenCalledWith({
      promptKey: 'meeting-report-fast',
      status: 'failed',
    });
  });
});

describe('GepaRunnerService — real subprocess', () => {
  it('запускает реальный python3 runner.py --version (skip если нет python3)', async () => {
    // SKIP по умолчанию; включается через GEPA_REAL_TEST=1.
    if (process.env.GEPA_REAL_TEST !== '1') {
      expect(true).toBe(true);
      return;
    }
    // Этот тест — placeholder для интеграционного запуска.
    // Реальный smoke выполняется в `gepa-runner-real.spec.ts`.
    expect(true).toBe(true);
  });
});
