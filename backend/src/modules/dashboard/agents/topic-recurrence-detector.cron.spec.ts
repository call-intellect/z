/**
 * Unit-тесты `TopicRecurrenceDetectorCron` (Pulse Wave 6 §6.2).
 */
import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { TopicRecurrenceDetectorCron } from './topic-recurrence-detector.cron';

interface MockThemeBlock {
  blockId: string;
  block: { id: string; evidence: Array<{ rawEventId: string }> };
}

function buildCron(opts: {
  orgs: Array<{ id: string }>;
  themesByOrg?: Record<string, Array<{ id: string; name: string }>>;
  themeBlocksByTheme?: Record<string, MockThemeBlock[]>;
  decisionCountFn?: (args: {
    where: { sourceBlockIds: { hasSome: string[] } };
  }) => Promise<number>;
}): {
  cron: TopicRecurrenceDetectorCron;
  recurringCreate: ReturnType<typeof vi.fn>;
} {
  const recurringCreate = vi.fn();
  const orgFindMany = vi.fn(async () => opts.orgs);
  const themeFindMany = vi.fn(
    async (args: { where: { tenantId: string } }) =>
      opts.themesByOrg?.[args.where.tenantId] ?? [],
  );
  const themeBlockFindMany = vi.fn(
    async (args: { where: { themeId: string } }) =>
      opts.themeBlocksByTheme?.[args.where.themeId] ?? [],
  );
  const decisionCount = vi.fn(opts.decisionCountFn ?? (async () => 0));

  const prisma = {
    org: { findMany: orgFindMany },
    theme: { findMany: themeFindMany },
    themeIdeaBlock: { findMany: themeBlockFindMany },
    decision: { count: decisionCount },
    recurringTopic: { create: recurringCreate },
  } as unknown as PrismaService;

  return { cron: new TopicRecurrenceDetectorCron(prisma), recurringCreate };
}

describe('TopicRecurrenceDetectorCron.runOnce', () => {
  it('happy path: создаёт snapshot для Theme без implemented Decision', async () => {
    const themeBlocks: MockThemeBlock[] = Array.from({ length: 5 }, (_, i) => ({
      blockId: `b${i}`,
      block: {
        id: `b${i}`,
        evidence: [{ rawEventId: `re${i % 3}` }], // 3 разных rawEventId
      },
    }));

    const { cron, recurringCreate } = buildCron({
      orgs: [{ id: 'org1' }],
      themesByOrg: {
        org1: [{ id: 't1', name: 'Бэклог фронта' }],
      },
      themeBlocksByTheme: { t1: themeBlocks },
      decisionCountFn: async () => 0, // нет implemented Decision
    });

    const stats = await cron.runOnce();

    expect(stats.orgsProcessed).toBe(1);
    expect(stats.snapshotsCreated).toBe(1);
    const data = recurringCreate.mock.calls[0]?.[0].data;
    expect(data.themeId).toBe('t1');
    expect(data.themeName).toBe('Бэклог фронта');
    expect(data.mentionCount).toBe(5);
    expect(data.meetingCount).toBe(3);
    expect(data.hasImplementedDecision).toBe(false);
    expect(data.blockIdsJson.ids).toEqual([
      'b0',
      'b1',
      'b2',
      'b3',
      'b4',
    ]);
  });

  it('пропускает Theme с implemented Decision', async () => {
    const themeBlocks: MockThemeBlock[] = Array.from({ length: 5 }, (_, i) => ({
      blockId: `b${i}`,
      block: { id: `b${i}`, evidence: [] },
    }));
    const { cron, recurringCreate } = buildCron({
      orgs: [{ id: 'org1' }],
      themesByOrg: { org1: [{ id: 't1', name: 'Тема X' }] },
      themeBlocksByTheme: { t1: themeBlocks },
      decisionCountFn: async () => 1, // есть implemented
    });
    const stats = await cron.runOnce();
    expect(stats.snapshotsCreated).toBe(0);
    expect(recurringCreate).not.toHaveBeenCalled();
  });

  it('пропускает Theme с mentionCount < 5', async () => {
    const themeBlocks: MockThemeBlock[] = Array.from({ length: 4 }, (_, i) => ({
      blockId: `b${i}`,
      block: { id: `b${i}`, evidence: [] },
    }));
    const { cron, recurringCreate } = buildCron({
      orgs: [{ id: 'org1' }],
      themesByOrg: { org1: [{ id: 't1', name: 'Тема Y' }] },
      themeBlocksByTheme: { t1: themeBlocks },
    });
    const stats = await cron.runOnce();
    expect(stats.snapshotsCreated).toBe(0);
    expect(recurringCreate).not.toHaveBeenCalled();
  });

  it('no data: пустая Org не падает', async () => {
    const { cron, recurringCreate } = buildCron({
      orgs: [{ id: 'org-empty' }],
      themesByOrg: { 'org-empty': [] },
    });
    const stats = await cron.runOnce();
    expect(stats.orgsProcessed).toBe(1);
    expect(stats.snapshotsCreated).toBe(0);
    expect(stats.errors).toBe(0);
    expect(recurringCreate).not.toHaveBeenCalled();
  });
});
