import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { Request } from 'express';

import { MyDailyBriefController } from './my-daily-brief.controller';

/**
 * TZ-1 Фаза 2 (daily-value-engine) — unit-тесты `/me/daily-brief`, `/me/knows-who`.
 *
 * Главный инвариант — self-scope (Р8): personId резолвится сервером из сессии,
 * не из query/param. Чужой бриф открыть нельзя (404). knows-who исключает себя.
 */
describe('MyDailyBriefController', () => {
  const req = { user: { id: 'user-1' } } as unknown as Request;

  function make(over: {
    commitments?: Record<string, unknown>;
    briefs?: Record<string, unknown>;
    knowsWho?: Record<string, unknown>;
  } = {}) {
    const commitments = over.commitments ?? {
      resolveSelfPerson: vi.fn().mockResolvedValue({ id: 'person-mine' }),
    };
    const briefs = over.briefs ?? {
      getForPerson: vi.fn().mockResolvedValue(null),
      markOpened: vi.fn().mockResolvedValue(true),
    };
    const knowsWho = over.knowsWho ?? {
      findExpertsForBlocker: vi.fn().mockResolvedValue([]),
    };
    const ctrl = new MyDailyBriefController(
      commitments as never,
      briefs as never,
      knowsWho as never,
    );
    return { ctrl, commitments, briefs, knowsWho };
  }

  describe('getBrief', () => {
    it('self-scope: getForPerson вызывается с resolved selfPersonId, не из query', async () => {
      const { ctrl, briefs, commitments } = make();
      await ctrl.getBrief('org1', req, { date: '2026-06-08' });
      expect(commitments.resolveSelfPerson).toHaveBeenCalledWith({
        tenantId: 'org1',
        userId: 'user-1',
      });
      expect(briefs.getForPerson).toHaveBeenCalledWith({
        tenantId: 'org1',
        personId: 'person-mine',
        dateLocal: '2026-06-08',
      });
    });

    it('нет Person → пустой бриф 200 (graceful)', async () => {
      const { ctrl, briefs } = make({
        commitments: {
          resolveSelfPerson: vi.fn().mockRejectedValue(
            new ForbiddenException({
              ok: false,
              error: { code: 'no_person', message: 'нет Person' },
            }),
          ),
        },
      });
      const res = await ctrl.getBrief('org1', req, { date: '2026-06-08' });
      expect(res.id).toBeNull();
      expect(res.counts).toEqual({
        tasks: 0,
        promises: 0,
        blockers: 0,
        promisedToMe: 0,
      });
      expect(briefs.getForPerson).not.toHaveBeenCalled();
    });

    it('нет tenantId → BadRequest', async () => {
      const { ctrl } = make();
      await expect(
        ctrl.getBrief(undefined, req, { date: '2026-06-08' }),
      ).rejects.toThrow();
    });
  });

  describe('markOpened', () => {
    it('markOpened вызывается с resolved selfPersonId (self-scope)', async () => {
      const { ctrl, briefs } = make();
      await ctrl.markOpened('org1', req, 'brief-1');
      expect(briefs.markOpened).toHaveBeenCalledWith({
        tenantId: 'org1',
        personId: 'person-mine',
        briefId: 'brief-1',
      });
    });

    it('чужой/несуществующий бриф (markOpened=false) → 404', async () => {
      const { ctrl } = make({
        briefs: {
          getForPerson: vi.fn(),
          markOpened: vi.fn().mockResolvedValue(false),
        },
      });
      await expect(ctrl.markOpened('org1', req, 'brief-x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('нет Person → 404 (чужой бриф не открыть)', async () => {
      const { ctrl } = make({
        commitments: {
          resolveSelfPerson: vi.fn().mockRejectedValue(
            new ForbiddenException({
              ok: false,
              error: { code: 'no_person', message: 'нет Person' },
            }),
          ),
        },
      });
      await expect(ctrl.markOpened('org1', req, 'brief-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('knows-who', () => {
    it('передаёт excludePersonId = self (исключаем себя из носителей)', async () => {
      const { ctrl, knowsWho } = make();
      await ctrl.knowsWhoEndpoint('org1', req, {
        blockId: 'block-1',
        limit: 3,
      } as never);
      expect(knowsWho.findExpertsForBlocker).toHaveBeenCalledWith({
        tenantId: 'org1',
        blockId: 'block-1',
        blockerText: undefined,
        excludePersonId: 'person-mine',
        topK: 3,
      });
    });

    it('маппит экспертов в DTO', async () => {
      const { ctrl } = make({
        knowsWho: {
          findExpertsForBlocker: vi.fn().mockResolvedValue([
            {
              personId: 'e1',
              name: 'Иван',
              confidence: 0.82,
              topCategories: ['Платежи'],
            },
          ]),
        },
      });
      const res = await ctrl.knowsWhoEndpoint('org1', req, {
        q: 'как настроить платежи',
        limit: 3,
      } as never);
      expect(res.experts).toEqual([
        {
          personId: 'e1',
          name: 'Иван',
          confidence: 0.82,
          topCategories: ['Платежи'],
        },
      ]);
    });
  });
});
