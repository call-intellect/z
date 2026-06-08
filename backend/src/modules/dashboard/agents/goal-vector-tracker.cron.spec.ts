/**
 * Unit-тесты `GoalVectorTrackerCron` (Pulse Wave 6 §6.6).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';

import {
  GoalVectorTrackerCron,
  chooseAttributionField,
  computeWeekStart,
} from './goal-vector-tracker.cron';

interface CommitmentRow {
  id: string;
  name: string;
  commitmentStatus: 'fulfilled' | 'missed';
  commitmentAuthorPersonId: string | null;
  commitmentAuthor: { id: string; name: string } | null;
  commitmentRecipientPersonId: string | null;
  commitmentRecipient: { id: string; name: string } | null;
}

interface BuildOpts {
  orgs?: Array<{ id: string; name: string }>;
  goals?: Array<{ id: string; name: string; description: string }>;
  ideas?: Array<{
    id: string;
    name: string;
    entities: Array<{
      role: string | null;
      entity: { persons: Array<{ id: string; name: string }> } | null;
    }>;
  }>;
  /** Commitment-строки (kept/broken) для второго запроса collectArtefacts. */
  commits?: CommitmentRow[];
  /** Покрытие commitmentAuthorPersonId (0..1) для resolveAttributionField. */
  authorCoverage?: number;
  /** AdminSetting goals.author_coverage_min (default 0.6). */
  authorCoverageMin?: number;
  llmResult?: { text: string; modelUsed: string };
  llmThrow?: Error;
}

function buildCron(opts: BuildOpts): {
  cron: GoalVectorTrackerCron;
  llmCall: ReturnType<typeof vi.fn>;
  contributionUpsert: ReturnType<typeof vi.fn>;
  setCoverage: ReturnType<typeof vi.fn>;
} {
  const orgs = opts.orgs ?? [{ id: 'org-1', name: 'ACME' }];
  const goals = opts.goals ?? [];
  const ideas = opts.ideas ?? [];
  const commits = opts.commits ?? [];
  const coverage = opts.authorCoverage ?? 1;

  const orgFindMany = vi.fn(async () => orgs);
  const goalFindMany = vi.fn(async () => goals);
  const ideaBlockFindMany = vi.fn(
    async (args: { where: { signalType: string } }) => {
      if (args.where.signalType === 'idea') return ideas;
      if (args.where.signalType === 'commitment') return commits;
      return [];
    },
  );
  // resolveAttributionField: total count, then withAuthor count.
  const TOTAL = 10;
  const ideaBlockCount = vi.fn(
    async (args: { where: { commitmentAuthorPersonId?: unknown } }) => {
      if (args.where.commitmentAuthorPersonId) {
        return Math.round(coverage * TOTAL);
      }
      return TOTAL;
    },
  );
  const issueFindMany = vi.fn(async () => []);
  const personFindMany = vi.fn(async () => []);
  const contributionUpsert = vi.fn(async () => ({}));

  const prisma = {
    org: { findMany: orgFindMany },
    goal: { findMany: goalFindMany },
    ideaBlock: { findMany: ideaBlockFindMany, count: ideaBlockCount },
    issue: { findMany: issueFindMany },
    person: { findMany: personFindMany },
    personGoalContribution: { upsert: contributionUpsert },
  } as unknown as PrismaService;

  const cfg = {
    getDynamic: vi.fn(async () => opts.authorCoverageMin ?? 0.6),
  } as unknown as TypedConfigService;
  const setCoverage = vi.fn();
  const metrics = {
    setCommitmentAuthorCoverageRatio: setCoverage,
  } as unknown as BusinessMetricsService;

  const llmCall = vi.fn(async () => {
    if (opts.llmThrow) throw opts.llmThrow;
    return (
      opts.llmResult ?? {
        text: JSON.stringify({
          persons: [
            {
              personId: 'p1',
              proScore: 2.5,
              contraScore: 0.5,
              netScore: 2.0,
              signals: [
                { kind: 'idea', refId: 'i1', direction: 'pro' },
              ],
            },
          ],
        }),
        modelUsed: 'deepseek:deepseek-v4-flash',
        inputTokens: 50,
        outputTokens: 100,
        cachedTokens: 0,
        durationMs: 300,
      }
    );
  });
  const llm = { call: llmCall } as unknown as LlmRouterService;

  return {
    cron: new GoalVectorTrackerCron(prisma, llm, cfg, metrics),
    llmCall,
    contributionUpsert,
    setCoverage,
  };
}

describe('computeWeekStart', () => {
  it('возвращает понедельник 00:00 UTC для среды', () => {
    const wed = new Date('2026-05-27T15:30:00Z');
    const ws = computeWeekStart(wed);
    expect(ws.toISOString()).toBe('2026-05-25T00:00:00.000Z');
  });
  it('возвращает тот же понедельник для понедельника', () => {
    const mon = new Date('2026-05-25T05:00:00Z');
    const ws = computeWeekStart(mon);
    expect(ws.toISOString()).toBe('2026-05-25T00:00:00.000Z');
  });
  it('воскресенье → предыдущий понедельник', () => {
    const sun = new Date('2026-05-31T23:59:00Z');
    const ws = computeWeekStart(sun);
    expect(ws.toISOString()).toBe('2026-05-25T00:00:00.000Z');
  });
});

describe('GoalVectorTrackerCron.runOnce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-31T00:00:00Z'));
  });

  it('happy path: вызывает LLM и upsert-ит контрибьюшен', async () => {
    const { cron, llmCall, contributionUpsert } = buildCron({
      orgs: [{ id: 'org-1', name: 'ACME' }],
      goals: [
        { id: 'g1', name: 'Запустить продукт', description: 'Запуск Q3.' },
      ],
      ideas: [
        {
          id: 'i1',
          name: 'Идея запуска бета',
          entities: [
            {
              role: 'subject',
              entity: { persons: [{ id: 'p1', name: 'Иван' }] },
            },
          ],
        },
      ],
    });

    const stats = await cron.runOnce();

    expect(stats.orgsProcessed).toBe(1);
    expect(stats.goalsProcessed).toBe(1);
    expect(stats.contributionsUpserted).toBe(1);
    expect(stats.parseErrors).toBe(0);
    expect(stats.errors).toBe(0);

    expect(llmCall).toHaveBeenCalledOnce();
    const callArg = llmCall.mock.calls[0]?.[0] as {
      taskType: string;
      tenantId: string;
      userMessage: string;
    };
    expect(callArg.taskType).toBe('goal-vector-tracker');
    expect(callArg.tenantId).toBe('org-1');
    expect(callArg.userMessage).toContain('Запустить продукт');
    expect(callArg.userMessage).toContain('artefacts');

    expect(contributionUpsert).toHaveBeenCalledOnce();
    const upsertArg = contributionUpsert.mock.calls[0]?.[0];
    expect(upsertArg.where.tenantId_personId_goalId_weekStart.personId).toBe('p1');
    expect(upsertArg.where.tenantId_personId_goalId_weekStart.goalId).toBe('g1');
  });

  it('LLM вернул невалидный JSON → parseErrors++ и upsert не вызывается', async () => {
    const { cron, contributionUpsert } = buildCron({
      orgs: [{ id: 'org-1', name: 'ACME' }],
      goals: [{ id: 'g1', name: 'Цель', description: 'Описание' }],
      ideas: [
        {
          id: 'i1',
          name: 'Идея',
          entities: [
            {
              role: 'subject',
              entity: { persons: [{ id: 'p1', name: 'Иван' }] },
            },
          ],
        },
      ],
      llmResult: {
        text: 'это не JSON, мусор',
        modelUsed: 'deepseek:flash',
      },
    });

    const stats = await cron.runOnce();
    expect(stats.parseErrors).toBe(1);
    expect(stats.contributionsUpserted).toBe(0);
    expect(stats.errors).toBe(0);
    expect(contributionUpsert).not.toHaveBeenCalled();
  });

  it('нет goals → LLM не вызывается, snapshots=0', async () => {
    const { cron, llmCall, contributionUpsert } = buildCron({
      orgs: [{ id: 'org-1', name: 'ACME' }],
      goals: [],
    });
    const stats = await cron.runOnce();
    expect(stats.orgsProcessed).toBe(1);
    expect(stats.goalsProcessed).toBe(0);
    expect(stats.contributionsUpserted).toBe(0);
    expect(llmCall).not.toHaveBeenCalled();
    expect(contributionUpsert).not.toHaveBeenCalled();
  });

  it('нет артефактов у Goal → LLM не вызывается', async () => {
    const { cron, llmCall } = buildCron({
      orgs: [{ id: 'org-1', name: 'ACME' }],
      goals: [{ id: 'g1', name: 'Цель', description: 'Описание' }],
      ideas: [], // нет идей
    });
    const stats = await cron.runOnce();
    expect(stats.goalsProcessed).toBe(1);
    expect(stats.contributionsUpserted).toBe(0);
    expect(stats.parseErrors).toBe(0);
    expect(llmCall).not.toHaveBeenCalled();
  });

  it('покрытие author >= порога → атрибуция по АВТОРУ (commitmentAuthor)', async () => {
    const { cron, llmCall } = buildCron({
      orgs: [{ id: 'org-1', name: 'ACME' }],
      goals: [{ id: 'g1', name: 'Цель', description: 'Описание' }],
      authorCoverage: 0.9, // >= 0.6
      commits: [
        {
          id: 'c1',
          name: 'Обещание сделать отчёт',
          commitmentStatus: 'fulfilled',
          commitmentAuthorPersonId: 'author-1',
          commitmentAuthor: { id: 'author-1', name: 'Автор' },
          commitmentRecipientPersonId: 'recip-1',
          commitmentRecipient: { id: 'recip-1', name: 'Адресат' },
        },
      ],
    });

    await cron.runOnce();

    const userMessage = (
      llmCall.mock.calls[0]?.[0] as { userMessage: string }
    ).userMessage;
    // Артефакт commitment должен атрибутироваться автору, не адресату.
    expect(userMessage).toContain('author-1');
    expect(userMessage).not.toContain('recip-1');
  });

  it('покрытие author < порога → fallback на адресата (commitmentRecipient)', async () => {
    const { cron, llmCall, setCoverage } = buildCron({
      orgs: [{ id: 'org-1', name: 'ACME' }],
      goals: [{ id: 'g1', name: 'Цель', description: 'Описание' }],
      authorCoverage: 0.3, // < 0.6 → fallback
      commits: [
        {
          id: 'c1',
          name: 'Обещание с NULL-автором',
          commitmentStatus: 'missed',
          commitmentAuthorPersonId: null,
          commitmentAuthor: null,
          commitmentRecipientPersonId: 'recip-1',
          commitmentRecipient: { id: 'recip-1', name: 'Адресат' },
        },
      ],
    });

    await cron.runOnce();

    // Метрика покрытия должна быть выставлена.
    expect(setCoverage).toHaveBeenCalledWith(
      expect.objectContaining({ value: expect.closeTo(0.3, 5) }),
    );
    const userMessage = (
      llmCall.mock.calls[0]?.[0] as { userMessage: string }
    ).userMessage;
    // Fallback: обещание с NULL-автором атрибутируется адресату (не выброшено).
    expect(userMessage).toContain('recip-1');
  });

  it('LLM throw → errors++ остальные не валятся', async () => {
    const { cron, contributionUpsert } = buildCron({
      orgs: [{ id: 'org-1', name: 'ACME' }],
      goals: [{ id: 'g1', name: 'Цель', description: 'Описание' }],
      ideas: [
        {
          id: 'i1',
          name: 'Идея',
          entities: [
            {
              role: 'subject',
              entity: { persons: [{ id: 'p1', name: 'Иван' }] },
            },
          ],
        },
      ],
      llmThrow: new Error('LLM down'),
    });
    const stats = await cron.runOnce();
    expect(stats.errors).toBe(1);
    expect(stats.contributionsUpserted).toBe(0);
    expect(contributionUpsert).not.toHaveBeenCalled();
  });
});

describe('chooseAttributionField (ТЗ-1 Ф3.D.1)', () => {
  it('покрытие >= порога → author', () => {
    expect(chooseAttributionField(0.6, 0.6)).toBe('author');
    expect(chooseAttributionField(0.9, 0.6)).toBe('author');
    expect(chooseAttributionField(1, 0.6)).toBe('author');
  });
  it('покрытие < порога → recipient (fallback)', () => {
    expect(chooseAttributionField(0.59, 0.6)).toBe('recipient');
    expect(chooseAttributionField(0, 0.6)).toBe('recipient');
    expect(chooseAttributionField(0.3, 0.6)).toBe('recipient');
  });
});
