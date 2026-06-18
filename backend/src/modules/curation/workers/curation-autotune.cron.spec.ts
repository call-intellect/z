import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { AuditLogService } from '../../audit/audit-log.service';
import type { CurationSettingsDto } from '../dto/curation.dto';
import type { CurationService } from '../services/curation.service';

import { CurationAutotuneCron } from './curation-autotune.cron';

describe('CurationAutotuneCron (A2)', () => {
  let prisma: PrismaService;
  let curation: CurationService;
  let metrics: BusinessMetricsService;
  let audit: AuditLogService;
  let cron: CurationAutotuneCron;

  let getSettingsMock: ReturnType<typeof vi.fn>;
  let getProvisionalAuditStatsMock: ReturnType<typeof vi.fn>;
  let getOverrideStatsMock: ReturnType<typeof vi.fn>;
  let updateSettingsMock: ReturnType<typeof vi.fn>;
  let incKillSwitchMock: ReturnType<typeof vi.fn>;
  let incAdjustmentMock: ReturnType<typeof vi.fn>;
  let auditLogMock: ReturnType<typeof vi.fn>;

  function settings(over: Partial<CurationSettingsDto> = {}): CurationSettingsDto {
    return {
      autoThreshold: 0.85,
      deepReviewThreshold: 0.6,
      criticalTypes: ['regulation', 'process', 'decision'],
      itemExpiryDays: 30,
      autoThresholdByType: {},
      deepReviewThresholdByType: {},
      provisionalThreshold: 0.8,
      provisionalThresholdByType: {},
      aiVerifierEnabled: true,
      auditSampleRate: 0.05,
      autotuneEnabled: false,
      thresholdMin: 0.6,
      thresholdMax: 0.97,
      autotuneStep: 0.02,
      minDecisionsForAutotune: 20,
      maxProvisionalOverride: 0.2,
      ...over,
    };
  }

  beforeEach(() => {
    getSettingsMock = vi.fn();
    getProvisionalAuditStatsMock = vi.fn().mockResolvedValue({ items: [] });
    getOverrideStatsMock = vi.fn().mockResolvedValue({ items: [] });
    updateSettingsMock = vi.fn().mockImplementation(async () => settings());
    incKillSwitchMock = vi.fn();
    incAdjustmentMock = vi.fn();
    auditLogMock = vi.fn().mockResolvedValue(undefined);

    prisma = {
      org: { findMany: vi.fn().mockResolvedValue([{ id: 't-1' }]) },
    } as unknown as PrismaService;

    curation = {
      getSettings: getSettingsMock,
      getProvisionalAuditStats: getProvisionalAuditStatsMock,
      getOverrideStats: getOverrideStatsMock,
      updateSettings: updateSettingsMock,
    } as unknown as CurationService;

    metrics = {
      incCurationKillSwitch: incKillSwitchMock,
      incCurationAutotuneAdjustment: incAdjustmentMock,
    } as unknown as BusinessMetricsService;

    audit = { log: auditLogMock } as unknown as AuditLogService;

    cron = new CurationAutotuneCron(prisma, curation, metrics, audit);
  });

  it('kill-switch: высокий wrongRate + достаточно данных → provisionalThresholdByType=1.01 + audit', async () => {
    getSettingsMock.mockResolvedValue(settings());
    getProvisionalAuditStatsMock.mockResolvedValue({
      items: [
        {
          resourceType: 'regulation',
          auditDecided: 25,
          auditWrong: 10,
          provisionalWrongRate: 0.4,
        },
      ],
    });

    const res = await cron.runForOrg('t-1');

    expect(res.killSwitchTriggered).toBe(1);
    expect(updateSettingsMock).toHaveBeenCalledWith({
      tenantId: 't-1',
      patch: { provisionalThresholdByType: { regulation: 1.01 } },
    });
    expect(incKillSwitchMock).toHaveBeenCalledWith({ resourceType: 'regulation' });
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'curation.kill_switch' }),
    );
  });

  it('kill-switch: мало данных (auditDecided < min) → no-op', async () => {
    getSettingsMock.mockResolvedValue(settings());
    getProvisionalAuditStatsMock.mockResolvedValue({
      items: [
        {
          resourceType: 'regulation',
          auditDecided: 5,
          auditWrong: 5,
          provisionalWrongRate: 1.0,
        },
      ],
    });

    const res = await cron.runForOrg('t-1');
    expect(res.killSwitchTriggered).toBe(0);
    expect(updateSettingsMock).not.toHaveBeenCalled();
    expect(incKillSwitchMock).not.toHaveBeenCalled();
  });

  it('kill-switch идемпотентен: уже 1.01 → skip', async () => {
    getSettingsMock.mockResolvedValue(
      settings({ provisionalThresholdByType: { regulation: 1.01 } }),
    );
    getProvisionalAuditStatsMock.mockResolvedValue({
      items: [
        {
          resourceType: 'regulation',
          auditDecided: 25,
          auditWrong: 25,
          provisionalWrongRate: 1.0,
        },
      ],
    });

    const res = await cron.runForOrg('t-1');
    expect(res.killSwitchTriggered).toBe(0);
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it('autotuneEnabled=false → пороги НЕ двигаются (только kill-switch может)', async () => {
    getSettingsMock.mockResolvedValue(settings({ autotuneEnabled: false }));
    getOverrideStatsMock.mockResolvedValue({
      items: [{ resourceType: 'fact', totalDecided: 50, overrideRate: 0.0 }],
    });

    const res = await cron.runForOrg('t-1');
    expect(res.thresholdsAdjusted).toBe(0);
    expect(getOverrideStatsMock).not.toHaveBeenCalled();
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it('enabled + низкий override → опускает autoThresholdByType на step', async () => {
    getSettingsMock.mockResolvedValue(settings({ autotuneEnabled: true }));
    getOverrideStatsMock.mockResolvedValue({
      items: [{ resourceType: 'fact', totalDecided: 50, overrideRate: 0.0 }],
    });

    const res = await cron.runForOrg('t-1');
    expect(res.thresholdsAdjusted).toBe(1);
    expect(updateSettingsMock).toHaveBeenCalledWith({
      tenantId: 't-1',
      patch: { autoThresholdByType: { fact: 0.83 } },
    });
    expect(incAdjustmentMock).toHaveBeenCalledWith({
      resourceType: 'fact',
      direction: 'down',
    });
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'curation.autotune' }),
    );
  });

  it('enabled + высокий override → поднимает autoThresholdByType на step', async () => {
    getSettingsMock.mockResolvedValue(settings({ autotuneEnabled: true }));
    getOverrideStatsMock.mockResolvedValue({
      items: [{ resourceType: 'fact', totalDecided: 50, overrideRate: 0.5 }],
    });

    const res = await cron.runForOrg('t-1');
    expect(res.thresholdsAdjusted).toBe(1);
    expect(updateSettingsMock).toHaveBeenCalledWith({
      tenantId: 't-1',
      patch: { autoThresholdByType: { fact: 0.87 } },
    });
    expect(incAdjustmentMock).toHaveBeenCalledWith({
      resourceType: 'fact',
      direction: 'up',
    });
  });

  it('clamp по thresholdMax: на верхней границе не двигается (no-op)', async () => {
    getSettingsMock.mockResolvedValue(
      settings({
        autotuneEnabled: true,
        autoThresholdByType: { fact: 0.97 },
      }),
    );
    getOverrideStatsMock.mockResolvedValue({
      items: [{ resourceType: 'fact', totalDecided: 50, overrideRate: 0.5 }],
    });

    const res = await cron.runForOrg('t-1');
    expect(res.thresholdsAdjusted).toBe(0);
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it('инвариант auto ≥ deep: down не опускает ниже deep-порога типа', async () => {
    getSettingsMock.mockResolvedValue(
      settings({
        autotuneEnabled: true,
        thresholdMin: 0.5,
        autoThresholdByType: { fact: 0.71 },
        deepReviewThresholdByType: { fact: 0.7 },
      }),
    );
    getOverrideStatsMock.mockResolvedValue({
      items: [{ resourceType: 'fact', totalDecided: 50, overrideRate: 0.0 }],
    });

    const res = await cron.runForOrg('t-1');
    expect(res.thresholdsAdjusted).toBe(1);
    expect(updateSettingsMock).toHaveBeenCalledWith({
      tenantId: 't-1',
      patch: { autoThresholdByType: { fact: 0.7 } },
    });
  });

  it('мёртвая зона override (между 0.5*max и max) → no-op', async () => {
    getSettingsMock.mockResolvedValue(settings({ autotuneEnabled: true }));
    getOverrideStatsMock.mockResolvedValue({
      items: [{ resourceType: 'fact', totalDecided: 50, overrideRate: 0.15 }],
    });

    const res = await cron.runForOrg('t-1');
    expect(res.thresholdsAdjusted).toBe(0);
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it('мало данных для авто-подстройки (totalDecided < min) → no-op', async () => {
    getSettingsMock.mockResolvedValue(settings({ autotuneEnabled: true }));
    getOverrideStatsMock.mockResolvedValue({
      items: [{ resourceType: 'fact', totalDecided: 5, overrideRate: 0.0 }],
    });

    const res = await cron.runForOrg('t-1');
    expect(res.thresholdsAdjusted).toBe(0);
    expect(updateSettingsMock).not.toHaveBeenCalled();
  });

  it('runForAllOrgs агрегирует по Org и переживает ошибку одного', async () => {
    (prisma.org.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 't-1' },
      { id: 't-2' },
    ]);
    getSettingsMock.mockImplementation(async (tenantId: string) => {
      if (tenantId === 't-2') throw new Error('boom');
      return settings();
    });
    getProvisionalAuditStatsMock.mockResolvedValue({
      items: [
        {
          resourceType: 'regulation',
          auditDecided: 25,
          auditWrong: 25,
          provisionalWrongRate: 1.0,
        },
      ],
    });

    const res = await cron.runForAllOrgs();
    expect(res.scannedOrgs).toBe(2);
    expect(res.killSwitchTriggered).toBe(1);
  });
});
