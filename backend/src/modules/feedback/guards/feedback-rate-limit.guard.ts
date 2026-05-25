/**
 * FeedbackRateLimitGuard — 5 сообщений в сутки на userId (окно UTC).
 *
 * Алгоритм (см. ТЗ § Rate-limit):
 *   - ключ: `feedback:ratelimit:{userId}:{YYYY-MM-DD-UTC}`
 *   - INCR + EXPIRE 90000 (25 часов)
 *   - если >5 → ThrottlerException 429 с сообщением про reset в 00:00 UTC.
 *
 * Должен использоваться ПОСЛЕ CookieAuthGuard (требует req.user.id).
 *
 * Каркас — Фаза 1: только класс + DI. Логика — Фаза 2.
 */

import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import { RedisService } from '../../../common/redis/redis.service';

@Injectable()
export class FeedbackRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(FeedbackRateLimitGuard.name);

  constructor(@Inject(RedisService) private readonly redis: RedisService) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async canActivate(_ctx: ExecutionContext): Promise<boolean> {
    throw new Error(
      'FeedbackRateLimitGuard.canActivate not implemented (фаза 2)',
    );
  }
}
