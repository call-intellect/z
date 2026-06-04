import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ConversationalService } from '../../conversational/conversational.service';

import { CurationService } from './curation.service';
import type { CuratorRoutingService } from './curator-routing.service';

/**
 * A0 «лестница доверия» (2026-06-02) — юнит-тесты пер-типовых порогов triage'а.
 *
 * Проверяют:
 *   1. Пониженный autoThresholdByType[type] → авто-канонизация при confidence,
 *      который при ГЛОБАЛЬНОМ пороге ушёл бы в review.
 *   2. Отсутствие пер-типа → fallback на глобальный порог (поведение как раньше).
 *   3. triageReason содержит фактически применённые пороги + глобальные.
 */
describe('CurationService — пер-типовые пороги triage (A0)', () => {
  let prisma: PrismaService;
  let cfg: TypedConfigService;
  let metrics: BusinessMetricsService;
  let conversational: ConversationalService;
  let routing: CuratorRoutingService;
  let svc: CurationService;

  let orgFindUniqueMock: ReturnType<typeof vi.fn>;
  let cardVersionFindFirstMock: ReturnType<typeof vi.fn>;
  let cardVersionCreateMock: ReturnType<typeof vi.fn>;
  let curationItemCreateMock: ReturnType<typeof vi.fn>;
  let resolveCuratorsMock: ReturnType<typeof vi.fn>;
  let sendNotificationMock: ReturnType<typeof vi.fn>;

  /** Готовит мок Org.curationSettings (то, что лежит в БД). */
  function setOrgSettings(settings: Record<string, unknown> | null) {
    orgFindUniqueMock.mockResolvedValue({ curationSettings: settings });
  }

  beforeEach(() => {
    orgFindUniqueMock = vi.fn();
    cardVersionFindFirstMock = vi.fn().mockResolvedValue(null);
    cardVersionCreateMock = vi
      .fn()
      .mockImplementation(async () => ({ id: 'cv-1' }));
    curationItemCreateMock = vi
      .fn()
      .mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'ci-1',
        ...data,
        status: 'pending',
        expiresAt: null,
        createdAt: new Date(),
      }));
    resolveCuratorsMock = vi.fn().mockResolvedValue([]);
    sendNotificationMock = vi.fn().mockResolvedValue(undefined);

    prisma = {
      org: { findUnique: orgFindUniqueMock },
      cardVersion: {
        findFirst: cardVersionFindFirstMock,
        create: cardVersionCreateMock,
      },
      curationItem: { create: curationItemCreateMock },
    } as unknown as PrismaService;

    cfg = {
      curation: {
        autoThresholdDefault: 0.85,
        deepReviewThresholdDefault: 0.6,
        criticalTypesDefault: ['regulation', 'process', 'decision'],
        itemExpiryDays: 30,
      },
    } as unknown as TypedConfigService;

    metrics = {
      incCurationAutoCanonical: vi.fn(),
      incCurationItem: vi.fn(),
    } as unknown as BusinessMetricsService;

    conversational = {
      sendNotification: sendNotificationMock,
    } as unknown as ConversationalService;

    routing = {
      resolveCurators: resolveCuratorsMock,
    } as unknown as CuratorRoutingService;

    svc = new CurationService(
      prisma,
      cfg,
      metrics,
      conversational,
      routing,
      null,
      null,
    );
  });

  it('пониженный autoThresholdByType → авто-канонизация там, где глобальный порог ушёл бы в review', async () => {
    // Глобальный auto=0.85; для типа 'note' понижаем до 0.7.
    setOrgSettings({
      autoThreshold: 0.85,
      deepReviewThreshold: 0.6,
      autoThresholdByType: { note: 0.7 },
    });

    const res = await svc.triage({
      tenantId: 't-1',
      resourceType: 'note',
      resourceId: 'r-1',
      confidence: 0.75, // < 0.85 (глобальный) но >= 0.7 (пер-тип)
      proposedPayload: { text: 'hi' },
      conflictSignal: 'none',
    });

    expect(res.decision).toBe('auto');
    expect(res.cardVersionId).toBe('cv-1');
    expect(curationItemCreateMock).not.toHaveBeenCalled();
  });

  it('тот же confidence без пер-типа → fallback на глобальный порог → review (light)', async () => {
    setOrgSettings({
      autoThreshold: 0.85,
      deepReviewThreshold: 0.6,
      // Нет autoThresholdByType — поведение как раньше.
    });

    const res = await svc.triage({
      tenantId: 't-1',
      resourceType: 'note',
      resourceId: 'r-2',
      confidence: 0.75, // < 0.85 глобальный, и >= 0.6 deep → light
      proposedPayload: { text: 'hi' },
      conflictSignal: 'none',
    });

    expect(res.decision).toBe('light');
    expect(res.curationItemId).toBe('ci-1');
    expect(cardVersionCreateMock).not.toHaveBeenCalled();
  });

  it('пер-типовый порог применяется только к своему типу; другой тип идёт через глобальный', async () => {
    setOrgSettings({
      autoThreshold: 0.85,
      deepReviewThreshold: 0.6,
      autoThresholdByType: { note: 0.7 },
    });

    const res = await svc.triage({
      tenantId: 't-1',
      resourceType: 'fact', // нет override → глобальный 0.85
      resourceId: 'r-3',
      confidence: 0.75,
      proposedPayload: {},
      conflictSignal: 'none',
    });

    expect(res.decision).toBe('light');
  });

  it('triageReason фиксирует применённые пороги (с учётом override) и глобальные', async () => {
    setOrgSettings({
      autoThreshold: 0.85,
      deepReviewThreshold: 0.6,
      autoThresholdByType: { note: 0.7 },
      deepReviewThresholdByType: { note: 0.5 },
    });

    await svc.triage({
      tenantId: 't-1',
      resourceType: 'note',
      resourceId: 'r-4',
      confidence: 0.55, // >= 0.5 (deep пер-тип) и < 0.7 (auto пер-тип) → light
      proposedPayload: {},
      conflictSignal: 'none',
    });

    expect(curationItemCreateMock).toHaveBeenCalledTimes(1);
    const call = curationItemCreateMock.mock.calls[0]![0] as {
      data: { triageReason: Record<string, unknown> };
    };
    const reason = call.data.triageReason;
    expect(reason.autoThreshold).toBe(0.7);
    expect(reason.deepReviewThreshold).toBe(0.5);
    expect(reason.autoThresholdGlobal).toBe(0.85);
    expect(reason.deepThresholdGlobal).toBe(0.6);
  });

  it('criticalTypes всегда идут в deep вне зависимости от пер-типового порога', async () => {
    setOrgSettings({
      autoThreshold: 0.85,
      deepReviewThreshold: 0.6,
      autoThresholdByType: { regulation: 0.1 }, // даже сильно пониженный
    });

    const res = await svc.triage({
      tenantId: 't-1',
      resourceType: 'regulation', // critical
      resourceId: 'r-5',
      confidence: 0.99,
      proposedPayload: {},
      conflictSignal: 'none',
    });

    expect(res.decision).toBe('deep');
  });
});
