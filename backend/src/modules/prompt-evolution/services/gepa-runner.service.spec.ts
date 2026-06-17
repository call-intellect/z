import type { PromptFeedback } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';

import { GepaRunnerService } from './gepa-runner.service';

const fetchMock = vi.fn();

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
        serviceUrl: 'http://gepa:8000',
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

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GepaRunnerService', () => {
  it('1) successful → возвращает Pareto frontier candidates', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        pareto_frontier: [
          {
            text: 'You are concise and helpful.',
            metrics: { accuracy: 0.91, cost: 0.05 },
            traces: [{ step: 1, note: 'reflect' }],
          },
        ],
        cost_usd: 12.5,
      }),
    );

    const cfg = makeCfg();
    const metrics = makeMetrics();
    const svc = new GepaRunnerService(cfg as TypedConfigService, metrics);

    const result = await svc.runOptimization({
      promptKey: 'meeting-report-fast',
      feedback: [fb(1), fb(2), fb(3)],
      seedPrompt: 'You are helpful.',
      tenantTop: 't000',
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.text).toContain('concise');
    expect(result.candidates[0]!.metrics).toEqual({ accuracy: 0.91, cost: 0.05 });
    expect(result.costUsd).toBe(12.5);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://gepa:8000/optimize');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).seed_prompt).toBe('You are helpful.');

    expect(metrics.incGepaOptimization).toHaveBeenCalledWith({
      promptKey: 'meeting-report-fast',
      status: 'success',
    });
    expect(metrics.incGepaCost).toHaveBeenCalledWith({
      tenantTop: 't000',
      costUsd: 12.5,
    });
  });

  it('2) сервис недоступен (fetch failed) → status=skipped_no_python', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    const cfg = makeCfg();
    const metrics = makeMetrics();
    const svc = new GepaRunnerService(cfg as TypedConfigService, metrics);

    const result = await svc.runOptimization({
      promptKey: 'meeting-report-fast',
      feedback: [fb(1)],
      seedPrompt: 'seed',
    });

    expect(result.candidates).toEqual([]);
    expect(metrics.incGepaOptimization).toHaveBeenCalledWith({
      promptKey: 'meeting-report-fast',
      status: 'skipped_no_python',
    });
  });

  it('3) timeout (AbortController) → status=timeout', async () => {
    fetchMock.mockImplementationOnce(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        }),
    );

    const cfg = makeCfg(50);
    const metrics = makeMetrics();
    const svc = new GepaRunnerService(cfg as TypedConfigService, metrics);

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

  it('4) сервис вернул error JSON → status=failed', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        error: 'GEPA не установлен (ImportError)',
        pareto_frontier: [],
      }),
    );

    const cfg = makeCfg();
    const metrics = makeMetrics();
    const svc = new GepaRunnerService(cfg as TypedConfigService, metrics);

    const result = await svc.runOptimization({
      promptKey: 'meeting-report-fast',
      feedback: [fb(1)],
      seedPrompt: 'seed',
    });

    expect(result.candidates).toEqual([]);
    expect(metrics.incGepaOptimization).toHaveBeenCalledWith({
      promptKey: 'meeting-report-fast',
      status: 'failed',
    });
  });

  it('5) пустой feedback → пустой массив, fetch не вызывался', async () => {
    const cfg = makeCfg();
    const metrics = makeMetrics();
    const svc = new GepaRunnerService(cfg as TypedConfigService, metrics);

    const result = await svc.runOptimization({
      promptKey: 'meeting-report-fast',
      feedback: [],
      seedPrompt: 'seed',
    });
    expect(result.candidates).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
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
    expect(fetchMock).not.toHaveBeenCalled();
    expect(metrics.incGepaOptimization).toHaveBeenCalledWith({
      promptKey: 'meeting-report-fast',
      status: 'failed',
    });
  });
});
