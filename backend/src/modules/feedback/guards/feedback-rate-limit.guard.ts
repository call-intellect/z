/**
 * FeedbackRateLimitGuard — 5 сообщений в сутки на userId (окно UTC).
 *
 * Алгоритм (см. ТЗ § Rate-limit):
 *   - ключ: `feedback:ratelimit:{userId}:{YYYY-MM-DD-UTC}`
 *   - INCR + EXPIRE 90000 (25 часов) на этот ключ (atomically через pipeline)
 *   - если результат INCR > 5 → HttpException 429 с русским сообщением
 *     про reset в 00:00 UTC.
 *
 * Должен использоваться ПОСЛЕ CookieAuthGuard (требует req.user.id).
 *
 * Срабатывает только на POST /feedback — на GET'ах не используется (guard
 * подключён точечно на @Post в FeedbackUserController).
 *
 * Источник: plans/tz/2026-05-25-user-feedback-with-ai-clustering.md.
 */

import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { RedisService } from '../../../common/redis/redis.service';

/** Жёсткий лимит — 5 сообщений в сутки на пользователя. */
export const FEEDBACK_DAILY_LIMIT = 5;

/** TTL ключа в Redis — 25 часов (90 000 сек). С запасом, чтобы не было гонки
 * на полночь UTC: ключ следующих суток создаётся заново. */
export const FEEDBACK_RATE_LIMIT_TTL_SECONDS = 25 * 60 * 60;

/** Префикс Redis-ключа. */
export const FEEDBACK_RATE_LIMIT_PREFIX = 'feedback:ratelimit';

/**
 * Возвращает ключ Redis для счётчика лимита на сегодняшние сутки UTC.
 * Формат: `feedback:ratelimit:{userId}:{YYYY-MM-DD}` (UTC).
 *
 * Экспортируется, чтобы FeedbackService.getLimit мог читать тот же ключ.
 */
export function feedbackRateLimitKey(userId: string, now: Date = new Date()): string {
  const yyyy = now.getUTCFullYear().toString().padStart(4, '0');
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = now.getUTCDate().toString().padStart(2, '0');
  return `${FEEDBACK_RATE_LIMIT_PREFIX}:${userId}:${yyyy}-${mm}-${dd}`;
}

@Injectable()
export class FeedbackRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(FeedbackRateLimitGuard.name);

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user as { id?: string } | null | undefined;

    if (!user?.id) {
      // Guard должен идти после CookieAuthGuard. Если user не выставлен —
      // авторизация не прошла, кидаем 401 (а не молча пропускаем).
      throw new UnauthorizedException({
        ok: false,
        error: {
          code: 'cookie_missing',
          message: 'Требуется авторизация',
        },
      });
    }

    const key = feedbackRateLimitKey(user.id);

    // Атомарно: INCR + EXPIRE в одном round-trip. EXPIRE ставится каждый раз
    // — это безопасно (просто переустановит TTL). Альтернативно можно
    // ставить EXPIRE только при первом INCR (count === 1), но pipeline
    // дешевле, чем доп.if-логика, и нам важна гарантия наличия TTL.
    const pipeline = this.redis.client.pipeline();
    pipeline.incr(key);
    pipeline.expire(key, FEEDBACK_RATE_LIMIT_TTL_SECONDS);
    const results = await pipeline.exec();

    if (!results || results.length < 1) {
      this.logger.warn(
        { userId: user.id, key },
        'FeedbackRateLimitGuard: пустой результат pipeline — пропускаю',
      );
      return true;
    }

    const [incrErr, incrValue] = results[0] as [Error | null, number | undefined];
    if (incrErr) {
      // Redis недоступен — не блокируем пользователя (fail-open). Подробный
      // лог нужен, чтобы алёрты вылавливали такие случаи.
      this.logger.warn(
        { userId: user.id, key, err: incrErr.message },
        'FeedbackRateLimitGuard: Redis INCR упал — пропускаю проверку',
      );
      return true;
    }

    const count = typeof incrValue === 'number' ? incrValue : Number(incrValue);
    if (!Number.isFinite(count)) {
      this.logger.warn(
        { userId: user.id, key, incrValue },
        'FeedbackRateLimitGuard: некорректный счётчик — пропускаю',
      );
      return true;
    }

    if (count > FEEDBACK_DAILY_LIMIT) {
      throw new HttpException(
        {
          ok: false,
          error: {
            code: 'feedback_rate_limit',
            message:
              'Лимит 5 сообщений в сутки исчерпан. Следующая отправка доступна в 00:00 UTC.',
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
