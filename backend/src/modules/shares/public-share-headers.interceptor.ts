import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { type Observable, tap } from 'rxjs';

/**
 * Глобально-локальный интерцептор для публичных share-эндпоинтов.
 * Ставит заголовки безопасности до того, как Nest сериализует payload.
 *
 *   - `Referrer-Policy: no-referrer`
 *   - `X-Robots-Tag: noindex, nofollow, noarchive`
 *   - `Cache-Control: private, no-store`
 */
@Injectable()
export class PublicShareHeadersInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = ctx.switchToHttp().getResponse<Response>();
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    response.setHeader('Cache-Control', 'private, no-store');
    return next.handle().pipe(tap(() => undefined));
  }
}
