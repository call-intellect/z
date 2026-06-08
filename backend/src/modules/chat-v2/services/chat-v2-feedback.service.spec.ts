import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ChatV2FeedbackService } from './chat-v2-feedback.service';

/**
 * TZ-1 Фаза 5 (daily-value-engine) — unit-тесты ChatV2FeedbackService.
 *
 * Mock Prisma/cfg/metrics. Покрываем:
 *   1. setFeedback — upsert идемпотентен (повторный вызов перезаписывает один и
 *      тот же messageId), проверка владения, только assistant-сообщения.
 *   2. clearFeedback — снимает оценку, проверка владения.
 *   3. getChatUsageStats — type-guard citations в SQL + дедуп ретраев в SQL +
 *      скрытие helped-rate при rated<min; self-scope без userId → пусто.
 *   4. негативные пути: чужое сообщение → 404; user-сообщение → 403; disabled.
 */
describe('ChatV2FeedbackService', () => {
  function buildCfg(overrides: Record<string, unknown> = {}) {
    return {
      getDynamic: vi.fn(async (key: string, _env: string, def: unknown) =>
        key in overrides ? overrides[key] : def,
      ),
    };
  }

  function buildMetrics() {
    return {
      incChatV2Feedback: vi.fn(),
      setChatAnsweredWithCitation: vi.fn(),
    };
  }

  function buildService(opts: {
    message?: {
      role: string;
      conversation: { tenantId: string; userId: string } | null;
    } | null;
    rawRow?: Record<string, bigint | number>;
    cfgOverrides?: Record<string, unknown>;
  }) {
    const update = vi.fn(async () => ({ id: 'm1' }));
    const queryRaw = vi.fn(async () => [opts.rawRow ?? {}]);
    const prisma = {
      chatV2Message: {
        findUnique: vi.fn(async () => opts.message ?? null),
        update,
      },
      $queryRaw: queryRaw,
    };
    const metrics = buildMetrics();
    const svc = new ChatV2FeedbackService(
      prisma as never,
      buildCfg(opts.cfgOverrides) as never,
      metrics as never,
    );
    return { svc, prisma, metrics, update, queryRaw };
  }

  const ownMessage = {
    role: 'assistant',
    conversation: { tenantId: 't1', userId: 'u1' },
  };

  describe('setFeedback', () => {
    it('ставит оценку на свой assistant-ответ + метрика', async () => {
      const { svc, update, metrics } = buildService({ message: ownMessage });
      const res = await svc.setFeedback({
        tenantId: 't1',
        userId: 'u1',
        messageId: 'm1',
        helpful: 'up',
      });
      expect(res).toEqual({ messageId: 'm1', helpful: 'up' });
      expect(update).toHaveBeenCalledTimes(1);
      expect(metrics.incChatV2Feedback).toHaveBeenCalledWith({ reaction: 'up' });
    });

    it('идемпотентность: повторный вызов перезаписывает тот же messageId', async () => {
      const { svc, update } = buildService({ message: ownMessage });
      await svc.setFeedback({ tenantId: 't1', userId: 'u1', messageId: 'm1', helpful: 'up' });
      await svc.setFeedback({ tenantId: 't1', userId: 'u1', messageId: 'm1', helpful: 'down' });
      expect(update).toHaveBeenCalledTimes(2);
      // оба апдейта — по where {id:'m1'} (нет дублей строк).
      for (const call of update.mock.calls) {
        const arg = (call as unknown[])[0] as { where: { id: string } };
        expect(arg.where.id).toBe('m1');
      }
    });

    it('чужое сообщение (другой userId) → 404', async () => {
      const { svc } = buildService({
        message: { role: 'assistant', conversation: { tenantId: 't1', userId: 'OTHER' } },
      });
      await expect(
        svc.setFeedback({ tenantId: 't1', userId: 'u1', messageId: 'm1', helpful: 'up' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('сообщение другой Org → 404', async () => {
      const { svc } = buildService({
        message: { role: 'assistant', conversation: { tenantId: 'OTHER', userId: 'u1' } },
      });
      await expect(
        svc.setFeedback({ tenantId: 't1', userId: 'u1', messageId: 'm1', helpful: 'up' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('user-сообщение нельзя оценивать → 403', async () => {
      const { svc } = buildService({
        message: { role: 'user', conversation: { tenantId: 't1', userId: 'u1' } },
      });
      await expect(
        svc.setFeedback({ tenantId: 't1', userId: 'u1', messageId: 'm1', helpful: 'up' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('kill-switch off → 403', async () => {
      const { svc } = buildService({
        message: ownMessage,
        cfgOverrides: { 'chat_v2.feedback.enabled': false },
      });
      await expect(
        svc.setFeedback({ tenantId: 't1', userId: 'u1', messageId: 'm1', helpful: 'up' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('clearFeedback', () => {
    it('снимает оценку на своём сообщении', async () => {
      const { svc, update } = buildService({ message: ownMessage });
      const res = await svc.clearFeedback({ tenantId: 't1', userId: 'u1', messageId: 'm1' });
      expect(res).toEqual({ messageId: 'm1', cleared: true });
      expect(update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { helpful: null, helpfulAt: null, helpfulComment: null },
      });
    });

    it('чужое сообщение → 404', async () => {
      const { svc } = buildService({
        message: { role: 'assistant', conversation: { tenantId: 't1', userId: 'OTHER' } },
      });
      await expect(
        svc.clearFeedback({ tenantId: 't1', userId: 'u1', messageId: 'm1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getChatUsageStats', () => {
    it('считает stats из агрегированной SQL-строки; helped виден при rated>=min', async () => {
      const { svc, queryRaw, metrics } = buildService({
        rawRow: {
          asked: 30n,
          answered: 28n,
          answered_with_citation: 20n,
          rated: 12n,
          helped_up: 9n,
        },
      });
      const stats = await svc.getChatUsageStats({
        tenantId: 't1',
        from: new Date('2026-05-01'),
        to: new Date('2026-05-31'),
        scope: 'org',
      });
      expect(stats.asked).toBe(30);
      expect(stats.answered).toBe(28);
      expect(stats.answeredWithCitation).toBe(20);
      expect(stats.rated).toBe(12);
      expect(stats.helpedUp).toBe(9);
      expect(stats.helpedRatePercent).toBe(75); // 9/12
      expect(stats.helpedRateHidden).toBe(false);
      expect(metrics.setChatAnsweredWithCitation).toHaveBeenCalledWith({
        mode: 'org',
        value: 20,
      });
      // SQL содержит type-guard citations-массива. Первый аргумент
      // tagged-template `$queryRaw` — это TemplateStringsArray (массив частей).
      const firstCall = (queryRaw.mock.calls as unknown[][])[0] ?? [];
      const sqlParts = Array.isArray(firstCall[0]) ? (firstCall[0] as string[]) : [];
      const joined = sqlParts.join(' ');
      expect(joined).toContain("jsonb_typeof");
      expect(joined).toContain('jsonb_array_length');
      // дедуп ретраев присутствует в SQL.
      expect(joined).toContain('gap_seconds');
    });

    it('rated<min → helped-rate скрыт', async () => {
      const { svc } = buildService({
        rawRow: {
          asked: 10n,
          answered: 9n,
          answered_with_citation: 6n,
          rated: 4n,
          helped_up: 4n,
        },
        cfgOverrides: { 'chat_v2.feedback.min_rated': 10 },
      });
      const stats = await svc.getChatUsageStats({
        tenantId: 't1',
        from: new Date('2026-05-01'),
        to: new Date('2026-05-31'),
        scope: 'org',
      });
      expect(stats.helpedRatePercent).toBeNull();
      expect(stats.helpedRateHidden).toBe(true);
    });

    it('self-scope без userId → пустая статистика, без обращения к БД', async () => {
      const { svc, queryRaw } = buildService({});
      const stats = await svc.getChatUsageStats({
        tenantId: 't1',
        from: new Date('2026-05-01'),
        to: new Date('2026-05-31'),
        scope: 'self',
        userId: null,
      });
      expect(stats.asked).toBe(0);
      expect(stats.answered).toBe(0);
      expect(queryRaw).not.toHaveBeenCalled();
    });
  });
});
