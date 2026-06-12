import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';

import { ReportIngestListener } from './report-ingest.listener';
import type { ReportIngestAdapter } from './report.adapter';

/**
 * Юнит-тесты ReportIngestListener (Фаза 2 «отчёт встречи → граф»,
 * ТЗ 2026-06-11-report-to-graph-phase2.md §4).
 *
 * Покрытие:
 *   1. Событие → adapter.ingestReport ровно один раз.
 *   2. Kill-switch REPORT_INGEST_ENABLED=false → adapter НЕ вызывается.
 *   3. throw в ingestReport НЕ пробрасывается (best-effort).
 *   4. Событие без meetingId → skip.
 */
describe('ReportIngestListener', () => {
  let cfg: TypedConfigService;
  let adapter: ReportIngestAdapter;
  let listener: ReportIngestListener;
  let ingestReport: ReturnType<typeof vi.fn>;

  const makeCfg = (reportIngestEnabled: boolean) =>
    ({
      knowledgeCore: { reportIngestEnabled },
    }) as unknown as TypedConfigService;

  beforeEach(() => {
    ingestReport = vi.fn().mockResolvedValue({ idempotent: false });
    adapter = { ingestReport } as unknown as ReportIngestAdapter;
    cfg = makeCfg(true);
    listener = new ReportIngestListener(cfg, adapter);
  });

  it('kill-switch ON: событие → ingestReport(meetingId) ровно один раз', async () => {
    await listener.handleReportFastReady({
      meetingId: 'm1',
      tenantId: 'org_1',
      status: 'ready',
    });
    expect(ingestReport).toHaveBeenCalledTimes(1);
    expect(ingestReport).toHaveBeenCalledWith('m1');
  });

  it('status=partial тоже обрабатывается (listener не различает ready/partial)', async () => {
    await listener.handleReportFastReady({
      meetingId: 'm1',
      tenantId: 'org_1',
      status: 'partial',
    });
    expect(ingestReport).toHaveBeenCalledTimes(1);
  });

  it('kill-switch OFF (REPORT_INGEST_ENABLED=false): adapter НЕ вызывается', async () => {
    listener = new ReportIngestListener(makeCfg(false), adapter);
    await listener.handleReportFastReady({
      meetingId: 'm1',
      tenantId: 'org_1',
      status: 'ready',
    });
    expect(ingestReport).not.toHaveBeenCalled();
  });

  it('throw в ingestReport НЕ пробрасывается (best-effort)', async () => {
    ingestReport.mockRejectedValue(new Error('boom'));
    await expect(
      listener.handleReportFastReady({
        meetingId: 'm1',
        tenantId: 'org_1',
        status: 'ready',
      }),
    ).resolves.toBeUndefined();
    expect(ingestReport).toHaveBeenCalledTimes(1);
  });

  it('событие без meetingId → skip (adapter не вызывается)', async () => {
    await listener.handleReportFastReady({
      meetingId: '',
      tenantId: 'org_1',
      status: 'ready',
    });
    expect(ingestReport).not.toHaveBeenCalled();
  });
});
