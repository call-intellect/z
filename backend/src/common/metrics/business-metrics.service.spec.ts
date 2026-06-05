import { register } from 'prom-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BusinessMetricsService } from './business-metrics.service';

/**
 * Юнит на видимость «модели без цены»: `incLlmCostUnpriced` должен
 * инкрементировать счётчик `llm_cost_unpriced_total{provider,model}`.
 *
 * Это страховка ТЗ «LLM cost safety» Фаза 1 — costUsd=0 для модели без
 * цены не должен оставаться невидимым: каждый такой вызов виден в метрике.
 */
describe('BusinessMetricsService — llm_cost_unpriced_total', () => {
  let service: BusinessMetricsService;

  beforeEach(() => {
    // Сервис регистрируется в дефолтный prom-client registry.
    register.clear();
    service = new BusinessMetricsService();
    service.onModuleInit();
  });

  afterEach(() => {
    register.clear();
  });

  async function readUnpriced(
    provider: string,
    model: string,
  ): Promise<number> {
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
