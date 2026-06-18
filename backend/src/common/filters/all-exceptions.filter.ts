import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { Prisma, SystemLogCategory } from '@prisma/client';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

import type { WriteLogInput } from '../../modules/logging/log.constants';
import { LogService } from '../../modules/logging/log.service';
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
  logStack?: string;
  logDetails?: Record<string, unknown>;
}

@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(@Optional() @Inject(LogService) private readonly logService?: LogService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = this.extractRequestId(request);

    const mapped = this.toMapped(exception, requestId);

    this.writeSystemLog(exception, request, mapped.status);

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
    } else if (mapped.status === 404) {
      this.logger.debug(logMessage);
    } else {
      this.logger.warn(logMessage);
    }

    if (response.headersSent) {
      return;
    }

    response.status(mapped.status).json(mapped.payload);
  }

  private writeSystemLog(exception: unknown, request: Request, status: number): void {
    if (!this.logService) return;
    const r = request as Request & {
      user?: { id?: string; role?: string } | null;
      tenantId?: string;
    };
    const path = request.originalUrl ?? request.url;
    const ua = request.headers['user-agent'];

    const input: WriteLogInput = {
      level:
        status >= 500
          ? 'ERROR'
          : status === 401 || status === 403 || status === 429
            ? 'WARN'
            : 'DEBUG',
      category:
        status >= 500
          ? SystemLogCategory.REQUEST
          : status === 401
            ? SystemLogCategory.AUTH
            : status === 403 || status === 429
              ? SystemLogCategory.SECURITY
              : SystemLogCategory.REQUEST,
      module: 'http',
      action: 'error_response',
      message: `${request.method} ${path} → ${status}`,
      method: request.method,
      path,
      statusCode: status,
      ip: request.ip,
      ...(ua ? { userAgent: String(ua) } : {}),
      ...(r.user?.id ? { userId: r.user.id } : {}),
      ...(r.user?.role ? { userRole: r.user.role } : {}),
      ...(r.tenantId ? { orgId: r.tenantId } : {}),
      ...(status >= 500 ? { error: exception } : {}),
    };
    this.logService.write(input);
  }

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

  private fromHttpException(err: HttpException, requestId: string | undefined): MappedError {
    const status = err.getStatus();
    const res = err.getResponse();

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
      message = Array.isArray(raw) ? raw.join('; ') : (raw ?? err.message);
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
    if (typeof request.id === 'string' && request.id.length > 0) {
      return request.id;
    }
    const headerId = request.header('x-request-id');
    return headerId ?? undefined;
  }
}
