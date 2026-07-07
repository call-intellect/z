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

describe('BusinessMetricsService — метрики извлекающего слоя (Ф12a)', () => {
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

  it('incMeetingSkeleton — kc_meeting_skeleton_total{tenant_top,outcome}', async () => {
    service.incMeetingSkeleton({ tenantTop: 'b1', outcome: 'built' });
    service.incMeetingSkeleton({ tenantTop: 'b1', outcome: 'built' });
    service.incMeetingSkeleton({ tenantTop: 'b1', outcome: 'empty' });
    service.incMeetingSkeleton({ tenantTop: 'b2', outcome: 'failed' });

    const vals = await rows('kc_meeting_skeleton_total');
    const built = vals.find(
      (v) => v.labels.tenant_top === 'b1' && v.labels.outcome === 'built',
    );
    const empty = vals.find(
      (v) => v.labels.tenant_top === 'b1' && v.labels.outcome === 'empty',
    );
    const failed = vals.find(
      (v) => v.labels.tenant_top === 'b2' && v.labels.outcome === 'failed',
    );
    expect(built?.value).toBe(2);
    expect(empty?.value).toBe(1);
    expect(failed?.value).toBe(1);
  });

  it('incBlockGleaningRounds/Blocks — счётчики += rounds/count', async () => {
    service.incBlockGleaningRounds({ tenantTop: 'b1', rounds: 2 });
    service.incBlockGleaningRounds({ tenantTop: 'b1', rounds: 3 });
    service.incBlockGleaningBlocks({ tenantTop: 'b1', count: 5 });

    const roundsVals = await rows('kc_block_gleaning_rounds_total');
    const blocksVals = await rows('kc_block_gleaning_blocks_total');
    expect(roundsVals.find((v) => v.labels.tenant_top === 'b1')?.value).toBe(5);
    expect(blocksVals.find((v) => v.labels.tenant_top === 'b1')?.value).toBe(5);
  });

  it('gleaning rounds/blocks с нулём/отрицательным — no-op', async () => {
    service.incBlockGleaningRounds({ tenantTop: 'b1', rounds: 0 });
    service.incBlockGleaningBlocks({ tenantTop: 'b1', count: 0 });

    expect(await rows('kc_block_gleaning_rounds_total')).toEqual([]);
    expect(await rows('kc_block_gleaning_blocks_total')).toEqual([]);
  });

  it('incBlockOverlapDedup — счётчик += count', async () => {
    service.incBlockOverlapDedup({ tenantTop: 'b1', count: 3 });
    service.incBlockOverlapDedup({ tenantTop: 'b1', count: 2 });
    service.incBlockOverlapDedup({ tenantTop: 'b1', count: 0 });

    const vals = await rows('kc_block_overlap_dedup_total');
    expect(vals.find((v) => v.labels.tenant_top === 'b1')?.value).toBe(5);
  });

  it('методы Ф12a не бросают на «голом» сервисе (Optional-safe)', () => {
    const bare = new BusinessMetricsService();
    expect(() => {
      bare.incMeetingSkeleton({ tenantTop: 'x', outcome: 'built' });
      bare.incBlockGleaningRounds({ tenantTop: 'x', rounds: 1 });
      bare.incBlockGleaningBlocks({ tenantTop: 'x', count: 1 });
      bare.incBlockOverlapDedup({ tenantTop: 'x', count: 1 });
    }).not.toThrow();
  });
});

describe('BusinessMetricsService — Пакет D (F-9 / F-8 / Ф3)', () => {
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

  it('F-9: setRawEventStuck выставляет gauge raw_event_stuck_gauge{tenant,source_type}', async () => {
    service.setRawEventStuck({ tenant: 't1', sourceType: 'meeting', count: 4 });
    const vals = await rows('raw_event_stuck_gauge');
    expect(
      vals.find((v) => v.labels.tenant === 't1' && v.labels.source_type === 'meeting')?.value,
    ).toBe(4);
  });

  it('F-9: resetRawEventStuck обнуляет ряды gauge (разгруженный бэклог → absent)', async () => {
    service.setRawEventStuck({ tenant: 't1', sourceType: 'meeting', count: 4 });
    service.resetRawEventStuck();
    const vals = await rows('raw_event_stuck_gauge');
    expect(vals).toHaveLength(0);
  });

  it('F-8: incCombinedParseFailed инкрементит combined_parse_failed_total{tenant,source_type}', async () => {
    service.incCombinedParseFailed({ tenant: 't1', sourceType: 'chatbox' });
    service.incCombinedParseFailed({ tenant: 't1', sourceType: 'chatbox' });
    const vals = await rows('combined_parse_failed_total');
    expect(
      vals.find((v) => v.labels.tenant === 't1' && v.labels.source_type === 'chatbox')?.value,
    ).toBe(2);
  });

  it('Ф3: observeEntityMergeConfidenceGap пишет в гистограмму entity_merge_confidence_gap', async () => {
    service.observeEntityMergeConfidenceGap(0.03);
    service.observeEntityMergeConfidenceGap(0.4);
    service.observeEntityMergeConfidenceGap(-1);
    const vals = await rows('entity_merge_confidence_gap');
    const count = vals.find(
      (v) => (v as { metricName?: string }).metricName === 'entity_merge_confidence_gap_count',
    )?.value;
    expect(count).toBe(2);
  });
});

describe('BusinessMetricsService — experiment_tasks_extracted_total', () => {
  let service: BusinessMetricsService;

  beforeEach(() => {
    register.clear();
    service = new BusinessMetricsService();
    service.onModuleInit();
  });

  afterEach(() => {
    register.clear();
  });

  async function readTasks(tenantTop: string, surface: string): Promise<number> {
    const metrics = await register.getMetricsAsJSON();
    const metric = metrics.find((m) => m.name === 'experiment_tasks_extracted_total');
    if (!metric) return 0;
    const row = metric.values.find(
      (v) => v.labels.tenant_top === tenantTop && v.labels.surface === surface,
    );
    return row?.value ?? 0;
  }

  it('инкрементит счётчик по tenant_top × surface', async () => {
    expect(await readTasks('org', 'meeting')).toBe(0);

    service.incExperimentTaskExtracted({ tenantTop: 'org', surface: 'meeting', count: 1 });

    expect(await readTasks('org', 'meeting')).toBe(1);
  });

  it('count:0 — no-op', async () => {
    service.incExperimentTaskExtracted({ tenantTop: 'org', surface: 'ingest', count: 0 });

    expect(await readTasks('org', 'ingest')).toBe(0);
  });
});
