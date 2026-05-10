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
 * SuperAdminAuditInterceptor (Z-Admin Фаза 7).
 *
 * Пишет запись в `SuperAdminAccessLog` для каждого drill-down действия
 * super_admin'а. Используется для compliance: super_admin технически видит
 * чужие данные, и каждое такое чтение/запись должно быть зафиксировано.
 *
 * Поведение:
 *   - fire-and-forget: ошибки записи не блокируют ответ;
 *   - sanitized body: чувствительные поля маскируются (`SENSITIVE_FIELDS`);
 *   - `accessedTenantId` берётся из заголовка `X-Org-Id` (если есть) или
 *     из query.tenantId / params.orgId / body.tenantId. NULL = глобальный
 *     уровень (нет конкретной Org).
 *
 * Подключение: `@UseInterceptors(SuperAdminAuditInterceptor)` на контроллере
 * под `SuperAdminGuard` — пишем для всех методов (GET тоже — это требование
 * compliance, не аудит изменений).
 */
const SENSITIVE_FIELDS = new Set([
  'key',
  'password',
  'passwordHash',
  'token',
  'secret',
  'secretHash',
  'apiKey',
]);

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

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    return undefined;
  }
}

function pickTenantId(req: Request): string | null {
  const headerVal = req.headers['x-org-id'];
  if (typeof headerVal === 'string' && headerVal.trim().length > 0) {
    return headerVal.trim();
  }
  const params = (req as Request & { params?: Record<string, string> }).params;
  if (params?.orgId && typeof params.orgId === 'string') {
    return params.orgId;
  }
  const query = (req as Request & { query?: Record<string, unknown> }).query;
  if (query) {
    const t = query['tenantId'];
    const o = query['orgId'];
    if (typeof t === 'string' && t.length > 0) return t;
    if (typeof o === 'string' && o.length > 0) return o;
  }
  const body = (req as Request & { body?: Record<string, unknown> }).body;
  if (body) {
    const t = body['tenantId'];
    const o = body['orgId'];
    if (typeof t === 'string' && t.length > 0) return t;
    if (typeof o === 'string' && o.length > 0) return o;
  }
  return null;
}

@Injectable()
export class SuperAdminAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(SuperAdminAuditInterceptor.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = ctx.switchToHttp().getRequest<Request>();

    return next.handle().pipe(
      tap(() => {
        const actorId = request.user?.id;
        if (!actorId) return;

        const accessedTenantId = pickTenantId(request);

        const route = request.originalUrl.split('?')[0] ?? request.originalUrl;
        const params: Record<string, unknown> = {
          query: maskPayload(request.query) ?? {},
          ...(request.method !== 'GET'
            ? { body: maskPayload(request.body) ?? {} }
            : {}),
        };

        const data: Prisma.SuperAdminAccessLogUncheckedCreateInput = {
          superAdminUserId: actorId,
          accessedTenantId,
          route,
          method: request.method,
        };
        const paramsJson = toJson(params);
        if (paramsJson !== undefined) {
          data.params = paramsJson;
        }

        void this.prisma.superAdminAccessLog
          .create({ data })
          .catch((err) => {
            this.logger.warn(
              {
                err: err instanceof Error ? err.message : String(err),
                actorId,
                route,
              },
              'SuperAdminAuditInterceptor: запись лога не удалась',
            );
          });
      }),
    );
  }
}
