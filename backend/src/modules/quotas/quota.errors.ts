import { HttpException, HttpStatus } from '@nestjs/common';

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
