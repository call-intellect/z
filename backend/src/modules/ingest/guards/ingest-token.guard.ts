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
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ApiKeysService } from '../../api-keys/api-keys.service';

/**
 * Контекст ingest-запроса. Кладётся в `req.ingestContext` после успешной
 * авторизации. В контроллере (`IngestController`) tenantId берётся отсюда —
 * `body.tenantId` из запроса игнорируется или должен совпасть.
 */
export interface IngestRequestContext {
  /** Org, к которой привязан ключ. Для shared-secret режима — null. */
  tenantId: string | null;
  /** ApiKey.id (только для per-Org ключа); для shared-secret — null. */
  apiKeyId: string | null;
  /** Источник авторизации: 'org_key' (per-Org `zik_*`) или 'shared_secret'. */
  source: 'org_key' | 'shared_secret';
}

export type RequestWithIngestContext = Request & {
  ingestContext?: IngestRequestContext;
};

/**
 * Guard для POST /api/v1/ingest и других ingest-эндпоинтов.
 *
 * Поддерживает ДВА режима авторизации:
 *
 *   1. **Per-Org ApiKey** (Фаза 10) — `Authorization: Bearer zik_*`.
 *      Резолвится через `ApiKeysService.resolveIngestKey`. Проверки:
 *      существует, не отозван, scope='ingest', tenantId есть.
 *      Контекст: `{ tenantId, apiKeyId, source: 'org_key' }`.
 *      Параллельно пишется `ApiAccessLog` (lastUsedAt + аудит).
 *
 *   2. **Shared-secret** (Фаза 1) — `Authorization: Bearer <INGEST_INTERNAL_TOKEN>`.
 *      Используется только in-process backend-cron'ами (например,
 *      `email-fetch.cron` шага 6). Контекст:
 *      `{ tenantId: null, apiKeyId: null, source: 'shared_secret' }`.
 *
 * Если ENV `INGEST_INTERNAL_TOKEN` пустой и переданный токен не `zik_*` —
 * 503 (намеренно: DevOps должен явно сгенерировать токен перед deploy).
 */
@Injectable()
export class IngestTokenGuard implements CanActivate {
  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ApiKeysService) private readonly apiKeys: ApiKeysService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<RequestWithIngestContext>();
    const header = req.headers.authorization;
    if (!header || !header.toLowerCase().startsWith('bearer ')) {
      throw this.unauthorized('Требуется заголовок Authorization: Bearer ...');
    }
    const presented = header.slice(7).trim();
    if (presented.length === 0) {
      throw this.unauthorized('Пустой Bearer-токен');
    }

    // ── Режим 1: per-Org ApiKey (zik_*) ──
    if (presented.startsWith('zik_')) {
      const apiKey = await this.apiKeys.resolveIngestKey(presented);
      if (!apiKey) {
        throw this.unauthorized('Невалидный или отозванный ingest-ключ');
      }
      if (!apiKey.tenantId) {
        // По бизнес-правилу ingest-ключ обязан иметь tenantId. Если его нет —
        // считаем ключ невалидным.
        throw this.unauthorized('Ingest-ключ без tenantId');
      }
      req.ingestContext = {
        tenantId: apiKey.tenantId,
        apiKeyId: apiKey.id,
        source: 'org_key',
      };
      // Fire-and-forget: lastUsedAt + ApiAccessLog. Не блокируем запрос.
      void this.apiKeys.touchLastUsed(apiKey.id);
      void this.logApiAccess(apiKey.id, req).catch(() => undefined);
      return true;
    }

    // ── Режим 2: shared-secret (INGEST_INTERNAL_TOKEN) ──
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
    if (!constantTimeStringEqual(presented, expected)) {
      throw this.unauthorized('Невалидный ingest-токен');
    }
    req.ingestContext = {
      tenantId: null,
      apiKeyId: null,
      source: 'shared_secret',
    };
    return true;
  }

  private unauthorized(message: string): UnauthorizedException {
    return new UnauthorizedException({
      ok: false,
      error: { code: 'invalid_ingest_token', message },
    });
  }

  /**
   * Запись в `ApiAccessLog`. Не блокирует запрос — ошибки заглушены caller'ом.
   */
  private async logApiAccess(
    apiKeyId: string,
    req: Request,
  ): Promise<void> {
    await this.prisma.apiAccessLog.create({
      data: {
        apiKeyId,
        userId: null,
        route: `${req.method} ${(req as Request & { route?: { path?: string } }).route?.path ?? req.path}`,
        status: 0, // 0 = до выполнения handler'а; финальный status неизвестен здесь.
        durationMs: null,
        ipHash: null,
      },
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
