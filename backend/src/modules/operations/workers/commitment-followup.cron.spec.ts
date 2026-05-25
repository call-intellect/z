import { describe, expect, it, vi } from 'vitest';

import { CommitmentFollowupCron } from './commitment-followup.cron';

/**
 * SBA β-8.2 — CommitmentFollowupCron unit-тесты.
 *
 * Покрываем:
 *   1. Master-flag COMMITMENT_FOLLOWUP_ENABLED=false → no-op.
 *   2. Фильтр по часовому поясу: если локальный час Org'а != targetHour → skip.
 *   3. Совпал час → вызывается findFollowupCandidates и sendFollowupForBlock
 *      на каждом блоке.
 *   4. Идемпотентность: повторный запуск с тем же now даст тот же результат
 *      (фактически — PromiseKeeper-сервис вернёт пустой список, т.к.
 *      статус уже 'asked').
 */
describe('CommitmentFollowupCron', () => {
  function build(overrides: {
    enabled?: boolean;
    targetHour?: number;
    orgs?: Array<{ id: string; timezone: string | null }>;
    followupCandidates?: Array<{
      id: string;
      tenantId: string;
      criticalQuestion: string;
      trustedAnswer: string;
      commitmentDueDate: Date | null;
      commitmentRecipientPersonId: string | null;
      authorUserIds: string[];
    }>;
    escalationCandidates?: Array<{
      id: string;
      tenantId: string;
      criticalQuestion: string;
      trustedAnswer: string;
      commitmentDueDate: Date | null;
      commitmentAskedAt: Date | null;
      authorUserIds: string[];
    }>;
    sendFollowupResult?: { sent: boolean };
    sendEscalationResult?: { sent: boolean };
  }) {
    const prisma = {
      org: {
        findMany: vi
          .fn()
          .mockResolvedValue(
            overrides.orgs ?? [{ id: 'org-1', timezone: 'UTC' }],
          ),
      },
    };
    const cfg = {
      betaOps: {
        commitmentFollowupEnabled: overrides.enabled ?? true,
        commitmentFollowupLocalHour: overrides.targetHour ?? 9,
      },
    };
    const keeper = {
      findFollowupCandidates: vi
        .fn()
        .mockResolvedValue(overrides.followupCandidates ?? []),
      findEscalationCandidates: vi
        .fn()
        .mockResolvedValue(overrides.escalationCandidates ?? []),
      sendFollowupForBlock: vi
        .fn()
        .mockResolvedValue(overrides.sendFollowupResult ?? { sent: true }),
      sendEscalationForBlock: vi
        .fn()
        .mockResolvedValue(overrides.sendEscalationResult ?? { sent: true }),
    };
    const cron = new CommitmentFollowupCron(
      prisma as never,
      cfg as never,
      keeper as never,
    );
    return { cron, prisma, cfg, keeper };
  }

  function utcHour(hour: number): Date {
    // 2026-05-20 ${hour}:00:00 UTC
    return new Date(Date.UTC(2026, 4, 20, hour, 0, 0, 0));
  }

  it('master-flag off → cron не дёргает БД', async () => {
    const { cron, prisma } = build({ enabled: false });
    await cron.run();
    expect(prisma.org.findMany).not.toHaveBeenCalled();
  });

  it('локальный час не совпал с targetHour → пропускаем Org', async () => {
    const { cron, keeper } = build({
      targetHour: 9,
      orgs: [{ id: 'org-1', timezone: 'UTC' }],
    });
    const stats = await cron.runOnce(utcHour(10)); // 10:00 UTC vs target 9
    expect(stats.orgsProcessed).toBe(0);
    expect(stats.orgsSkippedOutsideWindow).toBe(1);
    expect(keeper.findFollowupCandidates).not.toHaveBeenCalled();
  });

  it('локальный час совпал → followup отправляется на каждый блок', async () => {
    const { cron, keeper } = build({
      targetHour: 9,
      orgs: [{ id: 'org-1', timezone: 'UTC' }],
      followupCandidates: [
        {
          id: 'b1',
          tenantId: 'org-1',
          criticalQuestion: 'X',
          trustedAnswer: 'Y',
          commitmentDueDate: utcHour(0),
          commitmentRecipientPersonId: null,
          authorUserIds: ['u1'],
        },
      ],
    });
    const stats = await cron.runOnce(utcHour(9));
    expect(stats.orgsProcessed).toBe(1);
    expect(stats.followupsSent).toBe(1);
    expect(keeper.sendFollowupForBlock).toHaveBeenCalledOnce();
  });

  it('escalation отправляется отдельно', async () => {
    const { cron, keeper } = build({
      targetHour: 9,
      orgs: [{ id: 'org-1', timezone: 'UTC' }],
      escalationCandidates: [
        {
          id: 'b2',
          tenantId: 'org-1',
          criticalQuestion: 'X',
          trustedAnswer: 'Y',
          commitmentDueDate: utcHour(0),
          commitmentAskedAt: utcHour(0),
          authorUserIds: ['u1'],
        },
      ],
    });
    const stats = await cron.runOnce(utcHour(9));
    expect(stats.escalationsSent).toBe(1);
    expect(keeper.sendEscalationForBlock).toHaveBeenCalledOnce();
  });

  it('идемпотентность: при пустом candidates ничего не отправляется', async () => {
    const { cron, keeper } = build({
      targetHour: 9,
      orgs: [{ id: 'org-1', timezone: 'UTC' }],
    });
    const stats = await cron.runOnce(utcHour(9));
    expect(stats.followupsSent).toBe(0);
    expect(stats.escalationsSent).toBe(0);
    expect(keeper.sendFollowupForBlock).not.toHaveBeenCalled();
    expect(keeper.sendEscalationForBlock).not.toHaveBeenCalled();
  });
});
