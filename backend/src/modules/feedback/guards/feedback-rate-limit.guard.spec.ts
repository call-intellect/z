/**
 * Unit-тесты для FeedbackRateLimitGuard.
 *
 * Покрытие:
 *   - <=5 INCR → пропускает
 *   - >5 INCR → 429 с русским сообщением про reset 00:00 UTC
 *   - проверяет, что ключ построен по UTC (формат feedback:ratelimit:{userId}:{YYYY-MM-DD})
 *   - EXPIRE 90000 (25 часов) проставлен на ключ
 *   - отсутствие req.user → 401
 *   - Redis-сбой (errors в pipeline.exec) → fail-open (true)
 *
 * Источник: plans/tz/2026-05-25-user-feedback-with-ai-clustering.md.
 */

import {
  HttpException,
  HttpStatus,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RedisService } from '../../../common/redis/redis.service';

import {
  FEEDBACK_DAILY_LIMIT,
  FEEDBACK_RATE_LIMIT_PREFIX,
  FEEDBACK_RATE_LIMIT_TTL_SECONDS,
  FeedbackRateLimitGuard,
  feedbackRateLimitKey,
} from './feedback-rate-limit.guard';

interface PipelineCall {
  type: 'incr' | 'expire';
  args: unknown[];
}

interface RedisStub {
  redis: RedisService;
  pipelineCalls: PipelineCall[];
  setIncrResult: (value: number | [Error | null, number]) => void;
}

function makeRedis(initialIncr: number | [Error | null, number] = 1): RedisStub {
  const pipelineCalls: PipelineCall[] = [];
  let incrResult: [Error | null, number | undefined] = Array.isArray(initialIncr)
    ? initialIncr
    : [null, initialIncr];

  const pipeline = () => {
    const ops: PipelineCall[] = [];
    const builder = {
      incr(key: string) {
        ops.push({ type: 'incr', args: [key] });
        return builder;
      },
      expire(key: string, ttl: number) {
        ops.push({ type: 'expire', args: [key, ttl] });
        return builder;
      },
      async exec() {
        pipelineCalls.push(...ops);
        return [incrResult, [null, 1] as [Error | null, number]];
      },
    };
    return builder;
  };

  const client = { pipeline } as unknown as RedisService['client'];
  return {
    redis: { client } as unknown as RedisService,
    pipelineCalls,
    setIncrResult: (value) => {
      incrResult = Array.isArray(value) ? value : [null, value];
    },
  };
}

function makeCtx(user: { id?: string } | null | undefined): ExecutionContext {
  const req = { user };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}) }),
  } as unknown as ExecutionContext;
}

describe('FeedbackRateLimitGuard', () => {
  beforeEach(() => {
    // фиксируем «текущий день» в UTC, чтобы ключ был детерминирован
    vi.useFakeTimers();
    // 2026-05-25 12:34:56 UTC
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 25, 12, 34, 56)));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('count=1 — пропускает (true), INCR + EXPIRE 90000 на корректном UTC-ключе', async () => {
    const stub = makeRedis(1);
    const guard = new FeedbackRateLimitGuard(stub.redis);

    await expect(guard.canActivate(makeCtx({ id: 'u-1' }))).resolves.toBe(true);

    expect(stub.pipelineCalls).toHaveLength(2);
    expect(stub.pipelineCalls[0]).toEqual({
      type: 'incr',
      args: [`${FEEDBACK_RATE_LIMIT_PREFIX}:u-1:2026-05-25`],
    });
    expect(stub.pipelineCalls[1]).toEqual({
      type: 'expire',
      args: [
        `${FEEDBACK_RATE_LIMIT_PREFIX}:u-1:2026-05-25`,
        FEEDBACK_RATE_LIMIT_TTL_SECONDS,
      ],
    });
    // sanity: 25 часов = 90000 секунд (как в ТЗ)
    expect(FEEDBACK_RATE_LIMIT_TTL_SECONDS).toBe(90000);
  });

  it('count=5 (ровно лимит) — пропускает', async () => {
    const stub = makeRedis(FEEDBACK_DAILY_LIMIT);
    const guard = new FeedbackRateLimitGuard(stub.redis);
    await expect(guard.canActivate(makeCtx({ id: 'u-1' }))).resolves.toBe(true);
  });

  it('count=6 — бросает HttpException 429 с русским сообщением про 00:00 UTC', async () => {
    const stub = makeRedis(FEEDBACK_DAILY_LIMIT + 1);
    const guard = new FeedbackRateLimitGuard(stub.redis);

    try {
      await guard.canActivate(makeCtx({ id: 'u-1' }));
      throw new Error('должно было кинуть HttpException');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      const e = err as HttpException;
      expect(e.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      const body = e.getResponse() as {
        ok?: boolean;
        error?: { code?: string; message?: string };
      };
      expect(body.ok).toBe(false);
      expect(body.error?.code).toBe('feedback_rate_limit');
      expect(body.error?.message).toContain('Лимит 5 сообщений в сутки');
      expect(body.error?.message).toContain('00:00 UTC');
    }
  });

  it('отсутствует req.user — 401 Unauthorized', async () => {
    const stub = makeRedis(1);
    const guard = new FeedbackRateLimitGuard(stub.redis);
    await expect(guard.canActivate(makeCtx(null))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(guard.canActivate(makeCtx({}))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('Redis INCR вернул error в pipeline.exec — fail-open (true)', async () => {
    const stub = makeRedis([new Error('redis down'), 0]);
    const guard = new FeedbackRateLimitGuard(stub.redis);
    await expect(guard.canActivate(makeCtx({ id: 'u-1' }))).resolves.toBe(true);
  });

  describe('feedbackRateLimitKey', () => {
    it('строит ключ в UTC, не в локальной TZ', () => {
      const key = feedbackRateLimitKey('user-x', new Date('2026-05-25T23:59:59Z'));
      expect(key).toBe(`${FEEDBACK_RATE_LIMIT_PREFIX}:user-x:2026-05-25`);
    });

    it('переходит на следующий день строго в 00:00 UTC', () => {
      const before = feedbackRateLimitKey('u', new Date('2026-05-25T23:59:59Z'));
      const after = feedbackRateLimitKey('u', new Date('2026-05-26T00:00:00Z'));
      expect(before).toBe(`${FEEDBACK_RATE_LIMIT_PREFIX}:u:2026-05-25`);
      expect(after).toBe(`${FEEDBACK_RATE_LIMIT_PREFIX}:u:2026-05-26`);
    });

    it('паддит месяц и день до 2 цифр (январь, 1-е число)', () => {
      const key = feedbackRateLimitKey('u', new Date('2026-01-01T05:00:00Z'));
      expect(key).toBe(`${FEEDBACK_RATE_LIMIT_PREFIX}:u:2026-01-01`);
    });
  });
});
