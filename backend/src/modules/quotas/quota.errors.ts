import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 429 Too Many Requests с понятным телом и `Retry-After` (в секундах).
 *
 * Использование:
 *   throw new QuotaExceededError('chat_requests_per_day', retryAfterSec);
 *
 * `AllExceptionsFilter` сохраняет 429 + сериализует тело.
 */
export class QuotaExceededError extends HttpException {
  constructor(
    public readonly quotaName: string,
    public readonly retryAfterSeconds: number,
    public readonly max?: number,
  ) {
    super(
      {
        ok: false,
        error: {
          code: 'quota_exceeded',
          message: `Превышен лимит ${quotaName}`,
          quotaName,
          retryAfterSeconds,
          max: max ?? null,
        },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
