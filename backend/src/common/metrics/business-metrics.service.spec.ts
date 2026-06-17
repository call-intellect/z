import { register } from 'prom-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BusinessMetricsService } from './business-metrics.service';

describe('BusinessMetricsService — llm_cost_unpriced_total', () => {
  let service: BusinessMetricsService;

  beforeEach(() => {
    register.clear();
    service = new BusinessMetricsService();
    service.onModuleInit();
  });

  afterEach(() => {
    register.clear();
  });

  async function readUnpriced(provider: string, model: string): Promise<number> {
    const metrics = await register.getMetricsAsJSON();
    const metric = metrics.find((m) => m.name === 'llm_cost_unpriced_total');
    if (!metric) return 0;
    const row = metric.values.find(
      (v) => v.labels.provider === provider && v.labels.model === model,
    );
    return row?.value ?? 0;
  }

  it('инкрементирует счётчик для пары provider/model', async () => {
    expect(await readUnpriced('deepseek', 'mystery-model')).toBe(0);

    service.incLlmCostUnpriced({ provider: 'deepseek', model: 'mystery-model' });

    expect(await readUnpriced('deepseek', 'mystery-model')).toBe(1);
  });

  it('считает раздельно по разным моделям и накапливает повторы', async () => {
    service.incLlmCostUnpriced({ provider: 'deepseek', model: 'a' });
    service.incLlmCostUnpriced({ provider: 'deepseek', model: 'a' });
    service.incLlmCostUnpriced({ provider: 'openai', model: 'b' });

    expect(await readUnpriced('deepseek', 'a')).toBe(2);
    expect(await readUnpriced('openai', 'b')).toBe(1);
  });
});

describe('BusinessMetricsService — getLlmCacheHitRatio', () => {
  let service: BusinessMetricsService;

  beforeEach(() => {
    register.clear();
    service = new BusinessMetricsService();
    service.onModuleInit();
  });

  afterEach(() => {
    register.clear();
  });

  it('считает ratio = hits / total по провайдерам с подстрокой deepseek', async () => {
    for (let i = 0; i < 100; i++) {
      service.incLlmCall({ provider: 'deepseek-pro' });
      service.incLlmCall({ provider: 'deepseek-flash' });
    }
    for (let i = 0; i < 70; i++) {
      service.incLlmCacheHit({
        provider: 'deepseek-pro',
        model: 'm',
        taskType: 't',
      });
    }
    for (let i = 0; i < 50; i++) {
      service.incLlmCacheHit({
        provider: 'deepseek-flash',
        model: 'm',
        taskType: 't',
      });
    }
    for (let i = 0; i < 30; i++) {
      service.incLlmCall({ provider: 'openai' });
    }

    const snap = await service.getLlmCacheHitRatio('deepseek');
    expect(snap.hits).toBe(120);
    expect(snap.total).toBe(200);
    expect(snap.ratio).toBeCloseTo(0.6, 5);
  });

  it('total < minTotal → ratio === null (мало данных)', async () => {
    service.incLlmCall({ provider: 'deepseek-pro' });
    service.incLlmCacheHit({
      provider: 'deepseek-pro',
      model: 'm',
      taskType: 't',
    });

    const snap = await service.getLlmCacheHitRatio('deepseek');
    expect(snap.total).toBe(1);
    expect(snap.hits).toBe(1);
    expect(snap.ratio).toBeNull();
  });
});

describe('BusinessMetricsService — метрики ChatBox (Ф3)', () => {
  let service: BusinessMetricsService;

  beforeEach(() => {
    register.clear();
    service = new BusinessMetricsService();
    service.onModuleInit();
  });

  afterEach(() => {
    register.clear();
  });

  async function rows(name: string) {
    const metrics = await register.getMetricsAsJSON();
    return metrics.find((m) => m.name === name)?.values ?? [];
  }

  it('incChatboxSync — счётчик z_chatbox_syncs_total{scope,status}', async () => {
    service.incChatboxSync({ scope: 'incremental', status: 'success' });
    service.incChatboxSync({ scope: 'incremental', status: 'success' });
    service.incChatboxSync({ scope: 'full', status: 'failed' });

    const vals = await rows('z_chatbox_syncs_total');
    const ok = vals.find((v) => v.labels.scope === 'incremental' && v.labels.status === 'success');
    const fail = vals.find((v) => v.labels.scope === 'full' && v.labels.status === 'failed');
    expect(ok?.value).toBe(2);
    expect(fail?.value).toBe(1);
  });

  it('incChatboxAnalyze — счётчик z_chatbox_analyzes_total{status}', async () => {
    service.incChatboxAnalyze({ status: 'success' });
    service.incChatboxAnalyze({ status: 'failed' });
    service.incChatboxAnalyze({ status: 'failed' });

    const vals = await rows('z_chatbox_analyzes_total');
    expect(vals.find((v) => v.labels.status === 'success')?.value).toBe(1);
    expect(vals.find((v) => v.labels.status === 'failed')?.value).toBe(2);
  });

  it('setChatboxPendingSessions — gauge z_chatbox_pending_sessions', async () => {
    service.setChatboxPendingSessions(42);
    let vals = await rows('z_chatbox_pending_sessions');
    expect(vals[0]?.value).toBe(42);
    service.setChatboxPendingSessions(7);
    vals = await rows('z_chatbox_pending_sessions');
    expect(vals[0]?.value).toBe(7);
  });

  it('setChatboxLastSyncTs — gauge z_chatbox_last_sync_ts_seconds{scope}', async () => {
    service.setChatboxLastSyncTs({ scope: 'incremental', tsSeconds: 1700000000 });
    const vals = await rows('z_chatbox_last_sync_ts_seconds');
    expect(vals.find((v) => v.labels.scope === 'incremental')?.value).toBe(1700000000);
  });

  it('методы не бросают на «голом» сервисе без onModuleInit (Optional-safe)', () => {
    const bare = new BusinessMetricsService();
    expect(() => {
      bare.incChatboxSync({ scope: 'full', status: 'success' });
      bare.incChatboxAnalyze({ status: 'failed' });
      bare.setChatboxPendingSessions(1);
      bare.setChatboxLastSyncTs({ scope: 'full', tsSeconds: 1 });
    }).not.toThrow();
  });
});
