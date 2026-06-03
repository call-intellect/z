import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ConversationalService } from '../../conversational/conversational.service';
import type { GoalsPulseService } from '../services/goals-pulse.service';

import { GoalsPulseCron } from './goals-pulse.cron';

/**
 * Goals OKR v2 (Фаза 4) — unit-тесты GoalsPulseCron.
 *
 *   - runOnce: doставка ролям owner/coo через eventType 'goals.pulse' c
 *     корректным payload (digestId/isoWeek/actionUrl), deliveredAt проставлен;
 *   - runOnce: при deliverToTelegram=false — генерация без доставки;
 *   - runOnce: уже существующий digest → не плодит (skippedAlreadyExists).
 */

type Fn = ReturnType<typeof vi.fn>;

const DIGEST = {
  id: 'd1',
  tenantId: 't1',
  isoWeek: '2026-W22',
  bodyMarkdown: 'тело',
  shortSummary: 'коротко',
  metrics: {
    achieved: 0,
    on_track: 1,
    at_risk: 0,
    stalled: 0,
    dropped: 0,
    total: 1,
    newThisWeek: 0,
  },
  llmTaskRouteId: 'prompt-v1+x',
  deliveredAt: null as string | null,
  createdAt: new Date().toISOString(),
};

function build(over: {
  orgs?: Array<{ tenantId: string }>;
  memberships?: Array<{ userId: string }>;
  existing?: typeof DIGEST | null;
}) {
  const prisma = {
    goal: { findMany: vi.fn(async () => over.orgs ?? [{ tenantId: 't1' }]) },
    membership: {
      findMany: vi.fn(async () => over.memberships ?? [{ userId: 'u1' }]),
    },
  } as unknown as PrismaService;

  const getStored: Fn = vi.fn(async () => over.existing ?? null);
  const getOrGenerate: Fn = vi.fn(async () => ({ ...DIGEST }));
  const markDelivered: Fn = vi.fn(async () => undefined);
  const pulse = {
    getStored,
    getOrGenerate,
    markDelivered,
  } as unknown as GoalsPulseService;

  const sendNotification: Fn = vi.fn(async () => ({ id: 'n1' }));
  const conversational = {
    sendNotification,
  } as unknown as ConversationalService;

  const metrics = {
    incGoalsPulseDelivered: vi.fn(),
    incGoalsPulseFailed: vi.fn(),
    incGoalsPulseGenerated: vi.fn(),
  } as unknown as BusinessMetricsService;

  const cfg = {} as unknown as TypedConfigService;

  const cron = new GoalsPulseCron(prisma, cfg, pulse, conversational, metrics);
  return {
    cron,
    sendNotification,
    getStored,
    getOrGenerate,
    markDelivered,
  };
}

describe('GoalsPulseCron', () => {
  const NOW = new Date('2026-06-01T06:00:00.000Z'); // понедельник

  it('runOnce: deliverToTelegram=true → шлёт goals.pulse owner/coo + markDelivered', async () => {
    const { cron, sendNotification, getOrGenerate, markDelivered } = build({});

    const stats = await cron.runOnce({ now: NOW, deliverToTelegram: true });

    expect(getOrGenerate).toHaveBeenCalledTimes(1);
    expect(sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        recipientUserId: 'u1',
        eventType: 'goals.pulse',
        dataClass: 'internal',
        payload: expect.objectContaining({
          digestId: 'd1',
          isoWeek: expect.stringMatching(/^\d{4}-W\d{2}$/),
          actionUrl: '/goals',
        }),
      }),
    );
    expect(markDelivered).toHaveBeenCalledTimes(1);
    expect(stats.notificationsSent).toBe(1);
    expect(stats.digestsGenerated).toBe(1);
  });

  it('runOnce: deliverToTelegram=false → генерирует, но не шлёт', async () => {
    const { cron, sendNotification, markDelivered } = build({});

    const stats = await cron.runOnce({ now: NOW, deliverToTelegram: false });

    expect(sendNotification).not.toHaveBeenCalled();
    expect(markDelivered).not.toHaveBeenCalled();
    expect(stats.notificationsSent).toBe(0);
    expect(stats.digestsGenerated).toBe(1);
  });

  it('runOnce: уже существующий digest → skippedAlreadyExists, без getOrGenerate', async () => {
    const { cron, getOrGenerate, getStored } = build({
      existing: { ...DIGEST, deliveredAt: new Date().toISOString() },
    });

    const stats = await cron.runOnce({ now: NOW, deliverToTelegram: true });

    expect(getStored).toHaveBeenCalledTimes(1);
    expect(getOrGenerate).not.toHaveBeenCalled();
    expect(stats.digestsSkippedAlreadyExists).toBe(1);
    expect(stats.digestsGenerated).toBe(0);
  });
});
