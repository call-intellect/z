import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { type Observable, tap } from 'rxjs';

import { LogSettingsService } from './log-settings.service';
import { SystemLogCategory, SystemLogContour } from './log.constants';
import { LogService } from './log.service';

type ReqUser = { id?: string; role?: string; isSuperAdmin?: boolean } | null;

/**
 * LoggingModule — глобальный интерсептор УСПЕШНЫХ и ДОЛГИХ запросов.
 *
 * Пишет только при включённом `logSuccessfulRequests` ИЛИ если запрос медленный
 * (slow). 4xx/5xx НЕ пишет — их фиксирует `AllExceptionsFilter` (нет двойной
 * записи). См. plans/tz/2026-06-01-logging-module.md §7.
 */
@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  constructor(
    private readonly logs: LogService,
    private readonly settings: LogSettingsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest<Request & { user?: ReqUser; tenantId?: string }>();
    const response = http.getResponse<Response>();
    const startedAt = Date.now();

    return next.handle().pipe(
      tap((data) => {
        const cfg = this.settings.get();
        const duration = Date.now() - startedAt;
        const isSlow =
          cfg.slowRequestThresholdMs > 0 && duration >= cfg.slowRequestThresholdMs;

        if (!cfg.logSuccessfulRequests && !isSlow) return;

        const user = request.user ?? null;
        const status = response.statusCode;
        const method = request.method;
        const path = request.originalUrl ?? request.url;

        const details: Record<string, unknown> = {};
        if (cfg.requestBodyLogging && request.body !== undefined) {
          details['requestBody'] = request.body;
        }
        if (cfg.responseBodyLogging && data !== undefined) {
          details['responseBody'] = data;
        }

        this.logs.write({
          level: isSlow ? 'WARN' : 'INFO',
          category: SystemLogCategory.REQUEST,
          contour: this.resolveContour(request, user),
          module: 'http',
          action: isSlow ? 'slow_request' : 'request',
          message: `${method} ${path} ${status}`,
          method,
          path,
          statusCode: status,
          durationMs: duration,
          ip: request.ip,
          ...(request.headers['user-agent']
            ? { userAgent: String(request.headers['user-agent']) }
            : {}),
          ...(user?.id ? { userId: user.id } : {}),
          ...(user?.role ? { userRole: user.role } : {}),
          ...(request.tenantId ? { orgId: request.tenantId } : {}),
          ...(Object.keys(details).length > 0 ? { details } : {}),
        });
      }),
    );
  }

  /** Контур по пути/роли (адаптация домена Коры). */
  private resolveContour(
    request: Request,
    user: ReqUser,
  ): SystemLogContour {
    const path = (request.originalUrl ?? request.url ?? '').toLowerCase();
    if (path.startsWith('/api/v1/admin') || path.startsWith('/api/v1/platform')) {
      return SystemLogContour.SUPERADMIN;
    }
    if (user?.isSuperAdmin) return SystemLogContour.SUPERADMIN;
    if (path.includes('/guest') || path.startsWith('/api/public')) {
      return SystemLogContour.PUBLIC;
    }
    if (!user) return SystemLogContour.PUBLIC;
    if (user.role === 'admin') return SystemLogContour.ORG_ADMIN;
    return SystemLogContour.MEMBER;
  }
}
