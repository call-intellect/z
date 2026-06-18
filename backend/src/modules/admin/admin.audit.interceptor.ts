import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { type Observable, tap } from 'rxjs';

import { PrismaService } from '../../common/prisma/prisma.service';

const SENSITIVE_FIELDS = new Set(['key', 'password', 'passwordHash']);

function classifyAction(
  method: string,
  url: string,
): { action: string; targetType: string } | null {
  const path = url.split('?')[0]?.replace(/\/+$/, '') ?? '';

  if (/\/admin\/api\/v1\/integration-keys\/?$/.test(path)) {
    if (method === 'POST') {
      return { action: 'create_integration_key', targetType: 'IntegrationKey' };
    }
  }
  if (/\/admin\/api\/v1\/integration-keys\/[^/]+\/?$/.test(path)) {
    if (method === 'DELETE') {
      return { action: 'revoke_integration_key', targetType: 'IntegrationKey' };
    }
  }
  if (/\/admin\/api\/v1\/meetings\/[^/]+\/force-finish\/?$/.test(path)) {
    if (method === 'POST') {
      return { action: 'force_finish_meeting', targetType: 'Meeting' };
    }
  }
  if (/\/admin\/api\/v1\/meetings\/[^/]+\/retry-ai\/?$/.test(path)) {
    if (method === 'POST') {
      return { action: 'retry_ai_meeting', targetType: 'Meeting' };
    }
  }

  if (/\/api\/v1\/admin\/clones\/access-grants\/?$/.test(path)) {
    if (method === 'POST') {
      return { action: 'grant_clone_access', targetType: 'CloneAccessGrant' };
    }
  }
  if (/\/api\/v1\/admin\/clones\/access-grants\/[^/]+\/?$/.test(path)) {
    if (method === 'DELETE') {
      return { action: 'revoke_clone_access', targetType: 'CloneAccessGrant' };
    }
    if (method === 'PATCH') {
      return { action: 'extend_clone_access', targetType: 'CloneAccessGrant' };
    }
  }

  return null;
}

function extractTargetIdFromPath(url: string): string {
  const path = url.split('?')[0] ?? '';
  const m = /\/(?:integration-keys|meetings|access-grants)\/([^/?]+)/.exec(path);
  return m?.[1] ?? 'unknown';
}

function maskPayload(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(maskPayload);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_FIELDS.has(k)) {
      out[k] = '***';
    } else if (v !== null && typeof v === 'object') {
      out[k] = maskPayload(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  if (value === undefined || value === null) {
    return {} as Prisma.InputJsonValue;
  }
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    return {} as Prisma.InputJsonValue;
  }
}

@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AdminAuditInterceptor.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = ctx.switchToHttp().getRequest<Request>();

    return next.handle().pipe(
      tap((responseBody) => {
        if (request.method === 'GET') return;

        const classified = classifyAction(request.method, request.originalUrl);
        if (!classified) return;

        const actorId = request.user?.id;
        if (!actorId) return;

        const params = (request.params ?? {}) as Record<string, string>;
        let targetId = params['id'];
        if (!targetId) {
          targetId = extractTargetIdFromPath(request.originalUrl);
        }
        if ((!targetId || targetId === 'unknown') && responseBody) {
          const body = responseBody as Record<string, unknown>;
          if (typeof body['id'] === 'string') {
            targetId = body['id'] as string;
          }
        }

        const payload = maskPayload(request.body);

        void this.prisma.adminAuditLog
          .create({
            data: {
              actorId,
              action: classified.action,
              targetType: classified.targetType,
              targetId: targetId || 'unknown',
              payload: toJson(payload),
            },
          })
          .catch((err) => {
            this.logger.warn(
              {
                err: err instanceof Error ? err.message : String(err),
                action: classified.action,
                actorId,
              },
              'AdminAuditInterceptor: запись аудит-лога не удалась',
            );
          });
      }),
    );
  }
}
