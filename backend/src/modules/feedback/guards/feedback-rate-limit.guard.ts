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

export const FEEDBACK_DAILY_LIMIT = 5;

export const FEEDBACK_RATE_LIMIT_TTL_SECONDS = 25 * 60 * 60;

export const FEEDBACK_RATE_LIMIT_PREFIX = 'feedback:ratelimit';

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
      throw new UnauthorizedException({
        ok: false,
        error: {
          code: 'cookie_missing',
          message: 'Требуется авторизация',
        },
      });
    }

    const key = feedbackRateLimitKey(user.id);

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
            message: 'Лимит 5 сообщений в сутки исчерпан. Следующая отправка доступна в 00:00 UTC.',
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
