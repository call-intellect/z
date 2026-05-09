import { createHash } from 'node:crypto';

import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { type Observable, tap } from 'rxjs';

import { PrismaService } from '../prisma/prisma.service';


/**
 * Сохраняет ответ Crossmark-endpoint'а, если в guard'е установлен
 * `req.idempotencyKey` (значит, ключ ещё не виделся ранее, и контроллер
 * выполнился).
 *
 * Записывает в `crossmark_idempotency`:
 *   - `key`          — заголовок `X-Idempotency-Key`;
 *   - `responseHash` — sha256 от тела ЗАПРОСА (для сравнения при повторе);
 *   - `responseBody` — тело ответа (отдадим как есть при повторе);
 *   - `httpStatus`   — статус ответа на момент сохранения.
 *
 * При ошибках сохранения — лог + игнор (на следующий повтор будет не-конфликт
 * с тем же hash, так что флоу не сломается).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = ctx.switchToHttp().getRequest<Request>();
    const response = ctx.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      tap((body) => {
        const key = request.idempotencyKey;
        if (!key) return;

        const rawBody = request.rawBody ?? Buffer.alloc(0);
        const requestHash = createHash('sha256').update(rawBody).digest('hex');
        const httpStatus = response.statusCode;

        // fire-and-forget: не блокируем ответ на запись.
        void this.prisma.crossmarkIdempotency
          .create({
            data: {
              key,
              responseHash: requestHash,
              responseBody: this.toJson(body),
              httpStatus,
            },
          })
          .catch(() => {
            // Свободно игнорируем: если ключ уже создан гонкой, P2002 — это
            // фактически тот же ответ. На следующем повторе guard короткозамкнёт.
          });
      }),
    );
  }

  private toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (value === undefined || value === null) return Prisma.JsonNull;
    // Гарантируем, что значение JSON-сериализуемо (выкинет на циклах /
    // bigint / функции — что и нужно).
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
