import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

import { DomainError } from '../errors/domain-errors';

interface ErrorPayload {
  ok: false;
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}

interface MappedError {
  status: number;
  payload: ErrorPayload;
  /** stack — только в логи, не в HTTP-ответ. */
  logStack?: string;
  /** дополнительный контекст для логов (не уходит клиенту). */
  logDetails?: Record<string, unknown>;
}

/**
 * Единый фильтр ошибок.
 *
 * Маппинг:
 *   - `DomainError`                 → `httpStatus` + `code`/`message` доменной ошибки.
 *   - `Prisma.PrismaClientKnownRequestError`:
 *       P2002 (unique violation)    → 409 `db_unique_violation`
 *       P2025 (record not found)    → 404 `db_not_found`
 *       прочие                      → 500 `db_error` («Ошибка базы данных»)
 *   - `ZodError`                    → 400 `validation_failed` + `details: error.flatten()`
 *   - `HttpException` (Nest, ZodPipe BadRequest и т.п.)
 *                                   → пробрасывает status; формат ответа — наш.
 *   - всё остальное                 → 500 `internal_error`.
 *
 * Каждая ошибка логируется через `PinoLogger` (nestjs-pino), stack уходит
 * только в лог. Клиенту отдаётся `{ ok:false, error:{ code, message, requestId } }`.
 */
@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = this.extractRequestId(request);

    const mapped = this.toMapped(exception, requestId);

    // Логируем сразу всё в одном объекте — pino корректно его сериализует.
    const logBindings: Record<string, unknown> = {
      method: request.method,
      url: request.url,
      status: mapped.status,
      code: mapped.payload.error.code,
      requestId,
    };
    if (mapped.logDetails) {
      logBindings['errorDetails'] = mapped.logDetails;
    }
    if (mapped.logStack) {
      logBindings['stack'] = mapped.logStack;
    }

    const logMessage = `${mapped.payload.error.message} ${JSON.stringify(logBindings)}`;
    if (mapped.status >= 500) {
      this.logger.error(logMessage);
    } else {
      this.logger.warn(logMessage);
    }

    // Если ответ уже отправлен (например, `HmacGuard` короткозамкнул
    // идемпотентный ответ ДО `return false`, и Nest бросил `ForbiddenException`),
    // повторно слать заголовки нельзя — они уже улетели в сокет.
    if (response.headersSent) {
      return;
    }

    response.status(mapped.status).json(mapped.payload);
  }

  // ────────────────────────── маппинг ──────────────────────────────────

  private toMapped(exception: unknown, requestId: string | undefined): MappedError {
    if (exception instanceof DomainError) {
      return this.fromDomainError(exception, requestId);
    }

    if (exception instanceof ZodError) {
      return this.fromZodError(exception, requestId);
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrismaKnownError(exception, requestId);
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception, requestId);
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      payload: {
        ok: false,
        error: {
          code: 'internal_error',
          message: 'Внутренняя ошибка сервера',
          requestId,
        },
      },
      logStack: exception instanceof Error ? exception.stack : undefined,
    };
  }

  private fromDomainError(err: DomainError, requestId: string | undefined): MappedError {
    return {
      status: err.httpStatus,
      payload: {
        ok: false,
        error: {
          code: err.code,
          message: err.message,
          requestId,
        },
      },
      logDetails: err.details,
    };
  }

  private fromZodError(err: ZodError, requestId: string | undefined): MappedError {
    return {
      status: HttpStatus.BAD_REQUEST,
      payload: {
        ok: false,
        error: {
          code: 'validation_failed',
          message: 'Невалидные данные',
          requestId,
          details: err.flatten(),
        },
      },
    };
  }

  private fromPrismaKnownError(
    err: Prisma.PrismaClientKnownRequestError,
    requestId: string | undefined,
  ): MappedError {
    switch (err.code) {
      case 'P2002':
        return {
          status: HttpStatus.CONFLICT,
          payload: {
            ok: false,
            error: {
              code: 'db_unique_violation',
              message: 'Нарушение уникальности',
              requestId,
            },
          },
          logDetails: { prismaCode: err.code, meta: err.meta },
        };
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          payload: {
            ok: false,
            error: {
              code: 'db_not_found',
              message: 'Запись не найдена',
              requestId,
            },
          },
          logDetails: { prismaCode: err.code, meta: err.meta },
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          payload: {
            ok: false,
            error: {
              code: 'db_error',
              message: 'Ошибка базы данных',
              requestId,
            },
          },
          logStack: err.stack,
          logDetails: { prismaCode: err.code, meta: err.meta },
        };
    }
  }

  private fromHttpException(
    err: HttpException,
    requestId: string | undefined,
  ): MappedError {
    const status = err.getStatus();
    const res = err.getResponse();

    // Если внутрь уже завернули наш формат `{ ok:false, error:{...} }`
    // (например, ZodValidationPipe бросает BadRequestException с таким payload) —
    // отдадим как есть, добавив requestId.
    if (this.isErrorPayload(res)) {
      return {
        status,
        payload: { ...res, error: { ...res.error, requestId } },
      };
    }

    let message: string;
    let details: unknown;

    if (typeof res === 'string') {
      message = res;
    } else if (typeof res === 'object' && res !== null) {
      const obj = res as { message?: string | string[]; error?: string };
      const raw = obj.message ?? obj.error;
      message = Array.isArray(raw) ? raw.join('; ') : raw ?? err.message;
      // Полезный массив сообщений class-validator-а отдадим как details.
      if (Array.isArray(obj.message)) {
        details = obj.message;
      }
    } else {
      message = err.message;
    }

    const payload: ErrorPayload = {
      ok: false,
      error: {
        code: this.statusToCode(status),
        message,
        requestId,
      },
    };
    if (details !== undefined) {
      payload.error.details = details;
    }

    return { status, payload };
  }

  // ────────────────────────── helpers ──────────────────────────────────

  private isErrorPayload(value: unknown): value is ErrorPayload {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as { ok?: unknown; error?: unknown };
    if (v.ok !== false) return false;
    if (typeof v.error !== 'object' || v.error === null) return false;
    return true;
  }

  private statusToCode(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'bad_request';
      case HttpStatus.UNAUTHORIZED:
        return 'unauthorized';
      case HttpStatus.FORBIDDEN:
        return 'forbidden';
      case HttpStatus.NOT_FOUND:
        return 'not_found';
      case HttpStatus.CONFLICT:
        return 'conflict';
      case HttpStatus.GONE:
        return 'gone';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'unprocessable_entity';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'rate_limited';
      default:
        return status >= 500 ? 'internal_error' : 'http_error';
    }
  }

  private extractRequestId(request: Request): string | undefined {
    // RequestIdMiddleware всегда выставляет `req.id` ДО фильтра,
    // но на всякий случай поддержим и заголовок.
    if (typeof request.id === 'string' && request.id.length > 0) {
      return request.id;
    }
    const headerId = request.header('x-request-id');
    return headerId ?? undefined;
  }
}
