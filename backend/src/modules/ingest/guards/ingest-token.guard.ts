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

export interface IngestRequestContext {
  tenantId: string | null;
  apiKeyId: string | null;
  source: 'org_key' | 'shared_secret';
}

export type RequestWithIngestContext = Request & {
  ingestContext?: IngestRequestContext;
};

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

    if (presented.startsWith('zik_')) {
      const apiKey = await this.apiKeys.resolveIngestKey(presented);
      if (!apiKey) {
        throw this.unauthorized('Невалидный или отозванный ingest-ключ');
      }
      if (!apiKey.tenantId) {
        throw this.unauthorized('Ingest-ключ без tenantId');
      }
      req.ingestContext = {
        tenantId: apiKey.tenantId,
        apiKeyId: apiKey.id,
        source: 'org_key',
      };
      void this.apiKeys.touchLastUsed(apiKey.id);
      void this.logApiAccess(apiKey.id, req).catch(() => undefined);
      return true;
    }

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

  private async logApiAccess(apiKeyId: string, req: Request): Promise<void> {
    await this.prisma.apiAccessLog.create({
      data: {
        apiKeyId,
        userId: null,
        route: `${req.method} ${(req as Request & { route?: { path?: string } }).route?.path ?? req.path}`,
        status: 0,
        durationMs: null,
        ipHash: null,
      },
    });
  }
}

function constantTimeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return timingSafeEqual(ba, bb);
}
