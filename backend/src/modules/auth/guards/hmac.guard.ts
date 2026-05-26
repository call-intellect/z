import { createHash } from 'node:crypto';

import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';

import {
  IdempotencyConflictError,
  IntegrationKeyInvalidError,
} from '../../../common/errors/domain-errors';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { HmacService } from '../services/hmac.service';


/**
 * Guard для Crossmark-интеграционных endpoint'ов.
 *
 * Заголовки:
 *   - `Authorization: Bearer <plainKey>` — сырой ключ интеграции;
 *   - `X-Crossmark-Signature: <hex>`     — HMAC-SHA256 от `${ts}.${rawBody}`;
 *   - `X-Crossmark-Timestamp: <unix_s>`  — Unix-timestamp в секундах;
 *   - `X-Idempotency-Key: <opaque>`      — опционально для не-GET запросов.
 *
 * Поток:
 *   1. Достаём `plainKey`, ищем `IntegrationKey.keyHash = sha256(plain)` (не revoked).
 *   2. Проверяем подпись через `HmacService.verify` на `req.rawBody`.
 *   3. Кладём `req.partner = { id, partnerName }`.
 *   4. Если `X-Idempotency-Key` присутствует и метод не GET:
 *      - запись по ключу есть и hash тела совпадает с сохранённым → отдаём
 *        сохранённый ответ напрямую (короткое замыкание перед контроллером);
 *      - запись есть, но hash тела отличается → `IdempotencyConflictError`;
 *      - записи нет → `req.idempotencyKey = key` для последующего сохранения
 *        в `IdempotencyInterceptor` после успешного ответа.
 */
@Injectable()
export class HmacGuard implements CanActivate {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(HmacService) private readonly hmac: HmacService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest<Request>();
    const response = ctx.switchToHttp().getResponse<Response>();

    // 1. Сырой ключ из Authorization.
    const plainKey = this.extractBearer(request.headers['authorization']);
    if (!plainKey) {
      throw new IntegrationKeyInvalidError('authorization_missing');
    }

    // 2. Поиск IntegrationKey по hash.
    const keyHash = this.hmac.hashKey(plainKey);
    const integrationKey = await this.prisma.integrationKey.findFirst({
      where: { keyHash, revokedAt: null },
    });
    if (!integrationKey) {
      throw new IntegrationKeyInvalidError('not_found_or_revoked');
    }

    // 3. Проверка подписи на rawBody.
    const rawBody = request.rawBody ?? Buffer.alloc(0);
    const signature = this.headerString(request.headers['x-crossmark-signature']);
    const timestamp = this.headerString(request.headers['x-crossmark-timestamp']);
    if (!signature || !timestamp) {
      throw new IntegrationKeyInvalidError('signature_or_timestamp_missing');
    }

    const ok = this.hmac.verify({
      body: rawBody,
      signature,
      timestamp,
      key: plainKey,
    });
    if (!ok) {
      throw new IntegrationKeyInvalidError('signature_mismatch');
    }

    // 4. Партнёр на request.
    request.partner = {
      id: integrationKey.id,
      partnerName: integrationKey.partnerName,
    };

    // 5. Idempotency (только для не-GET).
    const idempKey = this.headerString(request.headers['x-idempotency-key']);
    if (idempKey && request.method !== 'GET') {
      const requestHash = this.bodyHash(rawBody);
      const existing = await this.prisma.crossmarkIdempotency.findUnique({
        where: { key: idempKey },
      });
      if (existing) {
        if (existing.responseHash !== requestHash) {
          throw new IdempotencyConflictError(idempKey);
        }
        // Короткое замыкание: возвращаем сохранённый ответ напрямую.
        response.status(existing.httpStatus).json(existing.responseBody);
        return false;
      }
      request.idempotencyKey = idempKey;
    }

    return true;
  }

  private extractBearer(header: string | string[] | undefined): string | undefined {
    const value = this.headerString(header);
    if (!value) return undefined;
    const match = /^Bearer\s+(.+)$/.exec(value);
    return match?.[1]?.trim();
  }

  private headerString(header: string | string[] | undefined): string | undefined {
    if (header === undefined) return undefined;
    if (Array.isArray(header)) return header[0];
    return header;
  }

  private bodyHash(body: Buffer): string {
    return createHash('sha256').update(body).digest('hex');
  }
}
