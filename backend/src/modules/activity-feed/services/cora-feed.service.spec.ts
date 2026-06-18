import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { CoraFeedQuery } from '../dto/activity-feed.dto';

import { CoraFeedService } from './cora-feed.service';

describe('CoraFeedService', () => {
  describe('businessDaysBetween (чистая утилита)', () => {
    it('пн → пт = 4 рабочих дня', () => {
      const mon = new Date('2026-06-08T09:00:00.000Z');
      const fri = new Date('2026-06-12T09:00:00.000Z');
      expect(CoraFeedService.businessDaysBetween(mon, fri)).toBe(4);
    });

    it('пт → след. пн = 1 рабочий день (сб/вс не считаются)', () => {
      const fri = new Date('2026-06-12T09:00:00.000Z');
      const mon = new Date('2026-06-15T09:00:00.000Z');
      expect(CoraFeedService.businessDaysBetween(fri, mon)).toBe(1);
    });

    it('пт → след. пт = 5 рабочих дней', () => {
      const fri = new Date('2026-06-12T09:00:00.000Z');
      const nextFri = new Date('2026-06-19T09:00:00.000Z');
      expect(CoraFeedService.businessDaysBetween(fri, nextFri)).toBe(5);
    });

    it('то же время → 0', () => {
      const d = new Date('2026-06-12T09:00:00.000Z');
      expect(CoraFeedService.businessDaysBetween(d, d)).toBe(0);
    });
  });

  describe('open_question детектор', () => {
    let prisma: PrismaService;
    let svc: CoraFeedService;
    const NOW = new Date('2026-06-15T09:00:00.000Z');

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    });

    function buildPrisma(questions: Array<{ id: string; createdAt: Date }>) {
      return {
        ideaBlock: {
          findMany: vi.fn(async () =>
            questions.map((q) => ({
              id: q.id,
              name: `вопрос ${q.id}`,
              criticalQuestion: `Критический вопрос ${q.id}?`,
              createdAt: q.createdAt,
            })),
          ),
        },
        feedReadCursor: {
          findUnique: vi.fn(async () => null),
        },
      } as unknown as PrismaService;
    }

    function makeSvc(p: PrismaService) {
      return new CoraFeedService(p);
    }

    const query: CoraFeedQuery = {
      type: 'open_question',
      window: 'all',
      limit: 50,
    };

    it('вопрос, висящий 5 раб.дней без ответа → попадает в ленту', async () => {
      prisma = buildPrisma([{ id: 'q-old', createdAt: new Date('2026-06-08T09:00:00.000Z') }]);
      svc = makeSvc(prisma);
      (prisma as unknown as { ideaBlock: { count: ReturnType<typeof vi.fn> } }).ideaBlock.count =
        vi.fn(async () => 0);
      stubCounters(prisma);

      const res = await svc.getFeed({ tenantId: 't-1', userId: 'u-1', query });
      const oq = res.items.filter((i) => i.type === 'open_question');
      expect(oq).toHaveLength(1);
      expect(oq[0]!.id).toBe('open_question:q-old');
      expect(oq[0]!.analysis).toContain('5 раб');
    });

    it('свежий вопрос (1 раб.день) → НЕ попадает', async () => {
      prisma = buildPrisma([{ id: 'q-new', createdAt: new Date('2026-06-12T09:00:00.000Z') }]);
      svc = makeSvc(prisma);
      stubCounters(prisma);

      const res = await svc.getFeed({ tenantId: 't-1', userId: 'u-1', query });
      expect(res.items.filter((i) => i.type === 'open_question')).toHaveLength(0);
    });
  });

  describe('open_question — R9 askedByManager (спросил руководитель)', () => {
    const NOW = new Date('2026-06-15T09:00:00.000Z');
    const OLD = new Date('2026-06-08T09:00:00.000Z');

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    });

    function buildPrismaR9() {
      return {
        ideaBlock: {
          findMany: vi.fn(async () =>
            [
              { id: 'q-head', createdAt: OLD },
              { id: 'q-staff', createdAt: OLD },
              { id: 'q-noauthor', createdAt: OLD },
            ].map((q) => ({
              id: q.id,
              name: `вопрос ${q.id}`,
              criticalQuestion: `Критический вопрос ${q.id}?`,
              createdAt: q.createdAt,
            })),
          ),
        },
        ideaBlockEntity: {
          findMany: vi.fn(async () => [
            { blockId: 'q-head', entityId: 'e-head', role: 'subject' },
            { blockId: 'q-staff', entityId: 'e-staff', role: 'subject' },
          ]),
        },
        person: {
          findMany: vi.fn(async () => [
            { id: 'p-head', entityId: 'e-head' },
            { id: 'p-staff', entityId: 'e-staff' },
          ]),
        },
        department: {
          findMany: vi.fn(async () => [{ headPersonId: 'p-head' }]),
        },
        membership: {
          findMany: vi.fn(async () => []),
        },
        feedReadCursor: {
          findUnique: vi.fn(async () => null),
        },
      } as unknown as PrismaService;
    }

    const query: CoraFeedQuery = {
      type: 'open_question',
      window: 'all',
      limit: 50,
    };

    it('автор-глава отдела → true; автор-рядовой → false; без автора → false', async () => {
      const prisma = buildPrismaR9();
      stubCounters(prisma);
      const svc = new CoraFeedService(prisma);

      const res = await svc.getFeed({ tenantId: 't-1', userId: 'u-1', query });
      const byId = new Map(
        res.items
          .filter((i) => i.type === 'open_question')
          .map((i) => [i.id, i.payload?.askedByManager]),
      );
      expect(byId.get('open_question:q-head')).toBe(true);
      expect(byId.get('open_question:q-staff')).toBe(false);
      expect(byId.get('open_question:q-noauthor')).toBe(false);
    });

    it('автор-owner (Membership) → true даже без главы отдела', async () => {
      const prisma = buildPrismaR9();
      (
        prisma as unknown as {
          department: { findMany: ReturnType<typeof vi.fn> };
          membership: { findMany: ReturnType<typeof vi.fn> };
        }
      ).department.findMany = vi.fn(async () => []);
      (
        prisma as unknown as {
          membership: { findMany: ReturnType<typeof vi.fn> };
        }
      ).membership.findMany = vi.fn(async () => [{ personId: 'p-staff' }]);
      stubCounters(prisma);
      const svc = new CoraFeedService(prisma);

      const res = await svc.getFeed({ tenantId: 't-1', userId: 'u-1', query });
      const byId = new Map(
        res.items
          .filter((i) => i.type === 'open_question')
          .map((i) => [i.id, i.payload?.askedByManager]),
      );
      expect(byId.get('open_question:q-staff')).toBe(true);
      expect(byId.get('open_question:q-head')).toBe(false);
    });

    it('нет ни одной subject-связи → у всех askedByManager=false (не падает)', async () => {
      const prisma = buildPrismaR9();
      (
        prisma as unknown as {
          ideaBlockEntity: { findMany: ReturnType<typeof vi.fn> };
        }
      ).ideaBlockEntity.findMany = vi.fn(async () => []);
      stubCounters(prisma);
      const svc = new CoraFeedService(prisma);

      const res = await svc.getFeed({ tenantId: 't-1', userId: 'u-1', query });
      const oq = res.items.filter((i) => i.type === 'open_question');
      expect(oq).toHaveLength(3);
      expect(oq.every((i) => i.payload?.askedByManager === false)).toBe(true);
    });
  });

  describe('тип / severity / unread', () => {
    const NOW = new Date('2026-06-15T09:00:00.000Z');

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    });

    it('insight critical → severity=risk; decision stalled → risk; blocker recurring → risk', async () => {
      const prisma = {
        insight: {
          findMany: vi.fn(async () => [
            {
              id: 'ins-1',
              statement: 'Клиенты жалуются на скорость',
              severity: 'critical',
              dynamicLabel: 'growing',
              mitigationPlan: null,
              createdAt: NOW,
              lastObservedAt: NOW,
              sourceBlockIds: ['b1', 'b2', 'b3'],
            },
          ]),
          count: vi.fn(async () => 1),
        },
        decision: {
          findMany: vi.fn(async () => [
            {
              id: 'dec-1',
              statement: 'Перейти на новый CRM',
              text: null,
              status: 'approved',
              implementationStatus: 'stalled',
              linkedTaskCount: 0,
              deadline: null,
              actualOutcomes: null,
              createdAt: NOW,
            },
          ]),
          count: vi.fn(async () => 1),
        },
        blockerSynthesis: {
          findMany: vi.fn(async () => [
            {
              id: 'blk-1',
              representativeText: 'Нет доступа к проду',
              status: 'recurring',
              daysOpen: 9,
              businessImpactScore: 5,
              createdAt: NOW,
              updatedAt: NOW,
            },
          ]),
          count: vi.fn(async () => 1),
        },
        feedReadCursor: {
          findUnique: vi.fn(async () => ({
            lastSeenAt: new Date('2026-06-14T00:00:00.000Z'),
          })),
        },
      } as unknown as PrismaService;
      stubCounters(prisma);

      const svc = new CoraFeedService(prisma);
      const res = await svc.getFeed({
        tenantId: 't-1',
        userId: 'u-1',
        query: { type: 'all', window: 30, limit: 50 },
      });

      const ins = res.items.find((i) => i.type === 'insight');
      const dec = res.items.find((i) => i.type === 'decision');
      const blk = res.items.find((i) => i.type === 'blocker');
      expect(ins?.severity).toBe('risk');
      expect(ins?.analysis).toContain('упоминаний: 3');
      expect(ins?.analysis).toContain('плана реагирования нет');
      expect(dec?.severity).toBe('risk');
      expect(dec?.analysis).toContain('застряло');
      expect(blk?.severity).toBe('risk');
      expect(blk?.analysis).toContain('9 дн');

      expect(res.unreadCount).toBe(res.items.length);
      expect(res.items.every((i) => i.unread)).toBe(true);
    });

    it('запись старше курсора → unread=false', async () => {
      const old = new Date('2026-06-10T09:00:00.000Z');
      const prisma = {
        blockerSynthesis: {
          findMany: vi.fn(async () => [
            {
              id: 'blk-old',
              representativeText: 'Старый блокер',
              status: 'new',
              daysOpen: 2,
              businessImpactScore: 1,
              createdAt: old,
              updatedAt: old,
            },
          ]),
          count: vi.fn(async () => 1),
        },
        feedReadCursor: {
          findUnique: vi.fn(async () => ({
            lastSeenAt: new Date('2026-06-14T00:00:00.000Z'),
          })),
        },
      } as unknown as PrismaService;
      stubCounters(prisma);

      const svc = new CoraFeedService(prisma);
      const res = await svc.getFeed({
        tenantId: 't-1',
        userId: 'u-1',
        query: { type: 'blocker', window: 'all', limit: 50 },
      });
      expect(res.items).toHaveLength(1);
      expect(res.items[0]!.unread).toBe(false);
      expect(res.unreadCount).toBe(0);
    });
  });

  describe('markCoraSeen', () => {
    it('upsert курсора с lastSeenAt=now', async () => {
      const now = new Date('2026-06-15T12:00:00.000Z');
      const upsert = vi.fn(async () => ({ lastSeenAt: now }));
      const prisma = {
        feedReadCursor: { upsert },
      } as unknown as PrismaService;
      const svc = new CoraFeedService(prisma);
      const res = await svc.markCoraSeen({ tenantId: 't-1', userId: 'u-1', now });
      expect(res.ok).toBe(true);
      expect(res.lastSeenAt).toBe(now.toISOString());
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId_userId: { tenantId: 't-1', userId: 'u-1' } },
        }),
      );
    });
  });
});

function stubCounters(prisma: PrismaService): void {
  const p = prisma as unknown as Record<
    string,
    { count?: ReturnType<typeof vi.fn>; findMany?: ReturnType<typeof vi.fn> }
  >;
  const models = [
    'ideaBlock',
    'insight',
    'decision',
    'conflictItem',
    'blockerSynthesis',
    'activityFeedItem',
  ];
  for (const m of models) {
    if (!p[m]) p[m] = {};
    if (!p[m]!.count) p[m]!.count = vi.fn(async () => 0);
    if (!p[m]!.findMany) p[m]!.findMany = vi.fn(async () => []);
  }
  if (!p.ideaBlockLink) p.ideaBlockLink = {};
  (p.ideaBlockLink as unknown as { groupBy?: ReturnType<typeof vi.fn> }).groupBy ??= vi.fn(
    async () => [],
  );

  for (const m of ['ideaBlockEntity', 'person', 'department', 'membership']) {
    if (!p[m]) p[m] = {};
    if (!p[m]!.findMany) p[m]!.findMany = vi.fn(async () => []);
  }
}
