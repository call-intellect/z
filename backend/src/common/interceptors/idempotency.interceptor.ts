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

        void this.prisma.crossmarkIdempotency
          .create({
            data: {
              key,
              responseHash: requestHash,
              responseBody: this.toJson(body),
              httpStatus,
            },
          })
          .catch(() => {});
      }),
    );
  }

  private toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (value === undefined || value === null) return Prisma.JsonNull;
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}
