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

/**
 * Маска чувствительных полей в payload для аудит-лога.
 * Сейчас прячем `key`, `password`, `passwordHash`. Расширяемо.
 */
const SENSITIVE_FIELDS = new Set(['key', 'password', 'passwordHash']);

/**
 * Маппинг `<METHOD> /admin/api/v1/<route>` → `action` + `targetType`.
 * Если совпадения нет — fallback на `<method>:<path>`.
 */
function classifyAction(
  method: string,
  url: string,
): { action: string; targetType: string } | null {
  // Уберём query-string и завершающий slash.
  const path = url.split('?')[0]?.replace(/\/+$/, '') ?? '';

  // /admin/api/v1/integration-keys
  if (/\/admin\/api\/v1\/integration-keys\/?$/.test(path)) {
    if (method === 'POST') {
      return { action: 'create_integration_key', targetType: 'IntegrationKey' };
    }
  }
  // /admin/api/v1/integration-keys/:id
  if (/\/admin\/api\/v1\/integration-keys\/[^/]+\/?$/.test(path)) {
    if (method === 'DELETE') {
      return { action: 'revoke_integration_key', targetType: 'IntegrationKey' };
    }
  }
  // /admin/api/v1/meetings/:id/force-finish
  if (/\/admin\/api\/v1\/meetings\/[^/]+\/force-finish\/?$/.test(path)) {
    if (method === 'POST') {
      return { action: 'force_finish_meeting', targetType: 'Meeting' };
    }
  }
  // /admin/api/v1/meetings/:id/retry-ai
  if (/\/admin\/api\/v1\/meetings\/[^/]+\/retry-ai\/?$/.test(path)) {
    if (method === 'POST') {
      return { action: 'retry_ai_meeting', targetType: 'Meeting' };
    }
  }

  return null;
}

/**
 * Извлекает `targetId` из URL по индексу :id (после `meetings/` или
 * `integration-keys/`). Если не нашли — возвращает 'unknown'.
 */
function extractTargetIdFromPath(url: string): string {
  const path = url.split('?')[0] ?? '';
  const m = /\/(?:integration-keys|meetings)\/([^/?]+)/.exec(path);
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

/**
 * Пишет AdminAuditLog для НЕ-GET admin-действий после успешного ответа.
 *
 *   - actorId  → req.user.id (на момент пост-успешного выполнения).
 *   - action   → из таблицы classifyAction.
 *   - targetType → 'IntegrationKey' | 'Meeting' | 'Recording' | fallback.
 *   - targetId → req.params.id, либо из ответа (response.id),
 *                иначе 'unknown'.
 *   - payload  → req.body с замаскированными секретами.
 *
 * Ошибки записи — лог + игнор (аудит важен, но падать не должен).
 */
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

        // targetId — сначала params.id, потом из ответа, потом 'unknown'.
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
