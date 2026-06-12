import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { CheckinIngestService } from '../services/checkin-ingest.service';

import { CheckinGraphIngestListener } from './checkin-graph-ingest.listener';

/**
 * Детерминированные unit-тесты CheckinGraphIngestListener (ТЗ
 * 2026-06-10-daily-checkin-to-graph-bridge, Фаза 3).
 *
 * Проверяем:
 *  - флаг ON → ingestCheckin вызван с (tenantId, checkInId); метрика ok/skipped;
 *  - флаг OFF → ingestCheckin НЕ вызван, метрика skipped (R1, kill-switch);
 *  - брошенная ошибка ingestCheckin НЕ пробрасывается (best-effort, R9),
 *    метрика error.
 */

const EVENT = {
  tenantId: 't1',
  checkInId: 'ci1',
  personId: 'p1',
  kind: 'evening' as const,
  rawText: 'отчёт',
};

function makeListener(opts: {
  enabled: boolean;
  ingestCheckin?: ReturnType<typeof vi.fn>;
}): {
  listener: CheckinGraphIngestListener;
  ingestCheckin: ReturnType<typeof vi.fn>;
  incCheckinGraphIngest: ReturnType<typeof vi.fn>;
} {
  const cfg = {
    betaOps: { checkinGraphIngestEnabled: opts.enabled },
  } as unknown as TypedConfigService;
  const ingestCheckin =
    opts.ingestCheckin ?? vi.fn().mockResolvedValue({ rawEventId: 're1' });
  const ingestService = { ingestCheckin } as unknown as CheckinIngestService;
  const incCheckinGraphIngest = vi.fn();
  const metrics = {
    incCheckinGraphIngest,
  } as unknown as BusinessMetricsService;
  const listener = new CheckinGraphIngestListener(cfg, ingestService, metrics);
  return { listener, ingestCheckin, incCheckinGraphIngest };
}

describe('CheckinGraphIngestListener.onCheckinCreated', () => {
  it('флаг ON + res непустой → ingestCheckin(tenantId, checkInId), метрика ok', async () => {
    const { listener, ingestCheckin, incCheckinGraphIngest } = makeListener({
      enabled: true,
    });

    await listener.onCheckinCreated(EVENT);

    expect(ingestCheckin).toHaveBeenCalledWith('t1', 'ci1');
    expect(incCheckinGraphIngest).toHaveBeenCalledWith({ result: 'ok' });
  });

  it('флаг ON + res=null (пустой чек-ин) → метрика skipped', async () => {
    const { listener, ingestCheckin, incCheckinGraphIngest } = makeListener({
      enabled: true,
      ingestCheckin: vi.fn().mockResolvedValue(null),
    });

    await listener.onCheckinCreated(EVENT);

    expect(ingestCheckin).toHaveBeenCalledWith('t1', 'ci1');
    expect(incCheckinGraphIngest).toHaveBeenCalledWith({ result: 'skipped' });
  });

  it('флаг OFF → ingestCheckin НЕ вызван, метрика skipped (kill-switch)', async () => {
    const { listener, ingestCheckin, incCheckinGraphIngest } = makeListener({
      enabled: false,
    });

    await listener.onCheckinCreated(EVENT);

    expect(ingestCheckin).not.toHaveBeenCalled();
    expect(incCheckinGraphIngest).toHaveBeenCalledWith({ result: 'skipped' });
  });

  it('ingestCheckin бросает → не пробрасывается (best-effort), метрика error', async () => {
    const { listener, incCheckinGraphIngest } = makeListener({
      enabled: true,
      ingestCheckin: vi.fn().mockRejectedValue(new Error('block-ingest down')),
    });

    await expect(listener.onCheckinCreated(EVENT)).resolves.toBeUndefined();
    expect(incCheckinGraphIngest).toHaveBeenCalledWith({ result: 'error' });
  });
});
