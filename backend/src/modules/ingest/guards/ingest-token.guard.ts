import { timingSafeEqual } from 'node:crypto';

import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { TypedConfigService } from '../../../common/config/index';

/**
 * Guard для POST /api/v1/ingest.
 *
 * Простой shared-secret из ENV `INGEST_INTERNAL_TOKEN`. Используется только
 * адаптерами, которые живут вне backend-процесса (telegram/email/IMAP-listener).
 * In-process meeting-adapter напрямую вызывает `IngestService.ingest` и сюда
 * не приходит.
 *
 *   - Заголовок: `Authorization: Bearer <INGEST_INTERNAL_TOKEN>`.
 *   - Если токен в ENV не настроен (пустая строка) — endpoint возвращает 503.
 *     Это намеренно: на Фазе 1 мы хотим чтобы DevOps явно сгенерировал
 *     длинный токен (40+ символов) перед прод-деплоем.
 *   - Сравнение через `timingSafeEqual` (защита от timing-атак).
 *
 * Полноценное per-Org API-key управление для внешних адаптеров — задача
 * Фазы 10 (когда придут реальные внешние адаптеры).
 */
@Injectable()
export class IngestTokenGuard implements CanActivate {
  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const expected = this.cfg.ingest.internalToken;
    if (!expected || expected.length < 16) {
      throw new ServiceUnavailableException({
        ok: false,
        error: {
          code: 'ingest_token_not_configured',
          message:
            'INGEST_INTERNAL_TOKEN не настроен — обратитесь к DevOps. Длина токена 40+ символов.',
        },
      });
    }

    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw this.unauthorized('Требуется заголовок Authorization: Bearer ...');
    }
    const presented = header.slice(7).trim();
    if (presented.length === 0) {
      throw this.unauthorized('Пустой Bearer-токен');
    }
    if (!constantTimeStringEqual(presented, expected)) {
      throw this.unauthorized('Невалидный ingest-токен');
    }
    return true;
  }

  private unauthorized(message: string): UnauthorizedException {
    return new UnauthorizedException({
      ok: false,
      error: { code: 'invalid_ingest_token', message },
    });
  }
}

function constantTimeStringEqual(a: string, b: string): boolean {
  // timingSafeEqual требует одинаковую длину буферов; иначе бросает.
  // Чтобы не утечь длину через try/catch, сравниваем длины отдельно — но
  // даже это допустимо: длина токена не секретна (она задана конфигом).
  if (a.length !== b.length) return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return timingSafeEqual(ba, bb);
}
