import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_DAILY_BUDGET_PER_PERSON,
  NotificationBudgetService,
  decideQuietHours,
  isOverBudget,
} from './notification-budget.service';

/**
 * TZ-1 Фаза 0 (daily-value-engine) — NotificationBudgetService unit-тесты.
 *
 * Покрываем:
 *   - Чистые хелперы decideQuietHours / isOverBudget (включая окно через полночь,
 *     байпасы critical/priority1, граничные значения лимита).
 *   - tryConsume: граница бюджета (limit-1 allowed, limit blocked), байпас
 *     critical, байпас priorityTier===1, тихие часы, opt-out, external user.
 *
 * Детерминизм: время и TZ передаются явно (Person.timezone='UTC', now —
 * фиксированный UTC), Prisma/cfg/metrics — моки. Без сети и без реальных часов.
 */

describe('decideQuietHours (pure)', () => {
  it('обычное окно [9..18): внутри → true, снаружи → false', () => {
    expect(decideQuietHours(10, 9, 18)).toBe(true);
    expect(decideQuietHours(9, 9, 18)).toBe(true);
    expect(decideQuietHours(18, 9, 18)).toBe(false); // верхняя граница исключена
    expect(decideQuietHours(8, 9, 18)).toBe(false);
  });

  it('окно через полночь [22..8): 23 и 2 → true, 12 → false', () => {
    expect(decideQuietHours(23, 22, 8)).toBe(true);
    expect(decideQuietHours(2, 22, 8)).toBe(true);
    expect(decideQuietHours(8, 22, 8)).toBe(false);
    expect(decideQuietHours(12, 22, 8)).toBe(false);
  });

  it('start === end → тихих часов нет', () => {
    expect(decideQuietHours(5, 10, 10)).toBe(false);
  });

  it('нечисловой час → false (не блокируем)', () => {
    expect(decideQuietHours(Number.NaN, 22, 8)).toBe(false);
  });
});

describe('isOverBudget (pure)', () => {
  it('limit-1 не превышен, limit превышен', () => {
    expect(isOverBudget(4, 5, false, 2)).toBe(false);
    expect(isOverBudget(5, 5, false, 2)).toBe(true);
    expect(isOverBudget(6, 5, false, 2)).toBe(true);
  });

  it('critical → никогда не превышен', () => {
    expect(isOverBudget(100, 5, true, 2)).toBe(false);
  });

  it('priorityTier===1 → никогда не превышен', () => {
    expect(isOverBudget(100, 5, false, 1)).toBe(false);
  });
});

describe('NotificationBudgetService.tryConsume', () => {
  /**
   * Билдер мока. ledgerSentCount — текущее значение sentCount у upsert'нутой
   * записи (имитирует уже потраченное за день). prefs — то, что вернёт
   * findFirst по in_app binding.preferences.
   */
  function build(overrides: {
    person?: { id: string; timezone: string | null } | null;
    ledgerSentCount?: number;
    limit?: number;
    quietStart?: number;
    quietEnd?: number;
    prefs?: Record<string, unknown> | null;
  }) {
    const person =
      overrides.person === undefined
        ? { id: 'p1', timezone: 'UTC' }
        : overrides.person;

    const updateLedger = vi.fn().mockResolvedValue({});
    const prisma = {
      person: {
        findFirst: vi.fn().mockResolvedValue(person),
      },
      channelBinding: {
        findFirst: vi.fn().mockResolvedValue(
          overrides.prefs === undefined
            ? null
            : { preferences: overrides.prefs },
        ),
      },
      notificationBudgetLedger: {
        update: updateLedger,
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          notificationBudgetLedger: {
            upsert: vi.fn().mockResolvedValue({
              id: 'led1',
              sentCount: overrides.ledgerSentCount ?? 0,
              byTrigger: {},
            }),
            update: updateLedger,
          },
        };
        return fn(tx);
      }),
    };

    const cfg = {
      getDynamic: vi.fn(async (key: string, _env?: string, def?: unknown) => {
        if (key === 'notifications.daily_budget.per_person') {
          return overrides.limit ?? DEFAULT_DAILY_BUDGET_PER_PERSON;
        }
        if (key === 'notifications.quiet_hours.start') {
          return overrides.quietStart ?? 22;
        }
        if (key === 'notifications.quiet_hours.end') {
          return overrides.quietEnd ?? 8;
        }
        return def;
      }),
    };

    const metrics = {
      incNotificationBudgetConsumed: vi.fn(),
      incNotificationBudgetBlocked: vi.fn(),
      incNotificationDeferredToDigest: vi.fn(),
    };

    const svc = new NotificationBudgetService(
      prisma as never,
      cfg as never,
      metrics as never,
    );
    return { svc, prisma, cfg, metrics, updateLedger };
  }

  /** 2026-06-08 12:00:00 UTC — вне тихих часов 22..8. */
  function noonUtc(): Date {
    return new Date(Date.UTC(2026, 5, 8, 12, 0, 0, 0));
  }
  /** 2026-06-08 23:00:00 UTC — внутри тихих часов 22..8. */
  function nightUtc(): Date {
    return new Date(Date.UTC(2026, 5, 8, 23, 0, 0, 0));
  }

  it('external user (нет Person) → allowed, бюджет не трогаем', async () => {
    const { svc, prisma } = build({ person: null });
    const res = await svc.tryConsume({
      tenantId: 't1',
      recipientUserId: 'u1',
      eventType: 'checkin.prompt',
    });
    expect(res.allowed).toBe(true);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('бюджет: при sentCount=limit-1 → allowed + consumed-метрика', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(noonUtc());
    try {
      const { svc, metrics, updateLedger } = build({
        ledgerSentCount: 4,
        limit: 5,
      });
      const res = await svc.tryConsume({
        tenantId: 't1',
        recipientUserId: 'u1',
        eventType: 'checkin.prompt',
      });
      expect(res.allowed).toBe(true);
      expect(updateLedger).toHaveBeenCalledOnce();
      expect(metrics.incNotificationBudgetConsumed).toHaveBeenCalledWith({
        trigger: 'checkin.prompt',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('бюджет: при sentCount=limit → blocked budget_exceeded + deferred-метрика', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(noonUtc());
    try {
      const { svc, metrics, updateLedger } = build({
        ledgerSentCount: 5,
        limit: 5,
      });
      const res = await svc.tryConsume({
        tenantId: 't1',
        recipientUserId: 'u1',
        eventType: 'checkin.prompt',
      });
      expect(res.allowed).toBe(false);
      expect(res.reason).toBe('budget_exceeded');
      expect(updateLedger).not.toHaveBeenCalled();
      expect(metrics.incNotificationBudgetBlocked).toHaveBeenCalledWith({
        reason: 'budget_exceeded',
      });
      expect(metrics.incNotificationDeferredToDigest).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('critical → байпас бюджета даже при превышении', async () => {
    const { svc } = build({ ledgerSentCount: 100, limit: 5 });
    const res = await svc.tryConsume({
      tenantId: 't1',
      recipientUserId: 'u1',
      eventType: 'system.message',
      critical: true,
    });
    expect(res.allowed).toBe(true);
  });

  it('priorityTier===1 → байпас бюджета даже при превышении', async () => {
    const { svc } = build({ ledgerSentCount: 100, limit: 5 });
    const res = await svc.tryConsume({
      tenantId: 't1',
      recipientUserId: 'u1',
      eventType: 'system.message',
      priorityTier: 1,
    });
    expect(res.allowed).toBe(true);
  });

  it('тихие часы: фиксируем системное время на ночь → blocked quiet_hours', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(nightUtc());
    try {
      const { svc, metrics } = build({});
      const res = await svc.tryConsume({
        tenantId: 't1',
        recipientUserId: 'u1',
        eventType: 'checkin.prompt',
      });
      expect(res.allowed).toBe(false);
      expect(res.reason).toBe('quiet_hours');
      expect(metrics.incNotificationBudgetBlocked).toHaveBeenCalledWith({
        reason: 'quiet_hours',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('днём (вне тихих часов) → не блокируется по quiet_hours', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(noonUtc());
    try {
      const { svc } = build({ ledgerSentCount: 0, limit: 5 });
      const res = await svc.tryConsume({
        tenantId: 't1',
        recipientUserId: 'u1',
        eventType: 'checkin.prompt',
      });
      expect(res.allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('opt-out этого eventType → blocked opted_out (даже днём)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(noonUtc());
    try {
      const { svc, metrics } = build({
        prefs: { notificationOptOutEventTypes: ['checkin.prompt'] },
      });
      const res = await svc.tryConsume({
        tenantId: 't1',
        recipientUserId: 'u1',
        eventType: 'checkin.prompt',
      });
      expect(res.allowed).toBe(false);
      expect(res.reason).toBe('opted_out');
      expect(metrics.incNotificationBudgetBlocked).toHaveBeenCalledWith({
        reason: 'opted_out',
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
