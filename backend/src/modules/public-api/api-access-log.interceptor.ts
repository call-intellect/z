import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import { PrismaService } from '../../common/prisma/prisma.service';
import type { RequestWithApiKey } from '../api-keys/current-api-key.decorator';
import { IpHashingService } from '../security/ip-hashing.service';

@Injectable()
export class ApiAccessLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ApiAccessLogInterceptor.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IpHashingService) private readonly ipHasher: IpHashingService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const startedAt = Date.now();
    const req = ctx.switchToHttp().getRequest<RequestWithApiKey>();
    const route = req.originalUrl ?? req.url ?? '';
    return next.handle().pipe(
      tap({
        next: () => this.write(req, route, 200, startedAt),
        error: (err: unknown) => {
          const status =
            (err as { status?: number; getStatus?: () => number })?.status ??
            (err as { getStatus?: () => number })?.getStatus?.() ??
            500;
          this.write(req, route, status, startedAt);
        },
      }),
    );
  }

  private write(req: RequestWithApiKey, route: string, status: number, startedAt: number): void {
    const ip =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
      req.socket?.remoteAddress ??
      'unknown';
    const ipHash = this.ipHasher.hashIp(ip);
    void this.prisma.apiAccessLog
      .create({
        data: {
          apiKeyId: req.apiKey?.id ?? null,
          userId: req.apiUserId ?? null,
          route,
          status,
          durationMs: Date.now() - startedAt,
          ipHash,
        },
      })
      .catch((err: unknown) => {
        this.logger.debug(`ApiAccessLog: ${err instanceof Error ? err.message : String(err)}`);
      });
  }
}
