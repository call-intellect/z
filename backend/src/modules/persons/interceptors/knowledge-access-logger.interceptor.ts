import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { type Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { IpHashingService } from '../../security/ip-hashing.service';

/**
 * Pulse Wave 4 §4.2 — пишет `KnowledgeAccessLog` для view-событий на
 *   `/api/v1/persons/:id/{pulse|knowledge-profile|skill-profile|appointments|contributions}`.
 *
 * Поведение:
 *   - Срабатывает только на успешный ответ (`tap.next`); 4xx/5xx не пишутся.
 *   - Не пишет, если viewer `req.user.id` === владелец карточки (`Person.userId`).
 *   - Best-effort: ошибки записи логируются на DEBUG, но запрос не валят.
 *   - Если URL не относится к одному из «view»-разделов карточки — пропуск.
 *
 * Привязан к `PersonsController` через `@UseInterceptors(...)`.
 */
@Injectable()
export class KnowledgeAccessLoggerInterceptor implements NestInterceptor {
  private readonly logger = new Logger(KnowledgeAccessLoggerInterceptor.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IpHashingService) private readonly ipHasher: IpHashingService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<
      Request & { user?: { id?: string }; tenantId?: string }
    >();
    const personId =
      typeof (req.params as { id?: string } | undefined)?.id === 'string'
        ? ((req.params as { id?: string }).id as string)
        : null;
    const url = req.originalUrl ?? req.url ?? '';
    const section = this.extractSection(url);

    return next.handle().pipe(
      tap({
        next: () => {
          if (!section || !personId) return;
          const viewerUserId = req.user?.id;
          const tenantId = req.tenantId;
          if (!viewerUserId || !tenantId) return;
          const ipHash = this.safeIpHash(req);
          void this.writeLog({
            tenantId,
            viewerUserId,
            viewedPersonId: personId,
            sectionAccessed: section,
            ipHash,
          });
        },
      }),
    );
  }

  private async writeLog(args: {
    tenantId: string;
    viewerUserId: string;
    viewedPersonId: string;
    sectionAccessed: string;
    ipHash: string | null;
  }): Promise<void> {
    try {
      // Self-view не логируем — нужна Person.userId.
      const person = await this.prisma.person.findFirst({
        where: { id: args.viewedPersonId, tenantId: args.tenantId },
        select: { userId: true },
      });
      if (!person) return;
      if (person.userId && person.userId === args.viewerUserId) return;

      await this.prisma.knowledgeAccessLog.create({
        data: {
          tenantId: args.tenantId,
          viewerUserId: args.viewerUserId,
          viewedPersonId: args.viewedPersonId,
          sectionAccessed: args.sectionAccessed,
          ipHash: args.ipHash,
        },
      });
    } catch (err) {
      this.logger.debug(
        `KnowledgeAccessLog: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private extractSection(url: string): string | null {
    // Берём только path-часть, чтобы query-параметры не сбивали матч.
    const path = url.split('?')[0] ?? '';
    if (path.endsWith('/pulse')) return 'pulse';
    if (path.endsWith('/knowledge-profile')) return 'knowledge_profile';
    if (path.endsWith('/skill-profile')) return 'skill_profile';
    if (path.endsWith('/appointments')) return 'appointments';
    if (path.endsWith('/contributions')) return 'contributions';
    return null;
  }

  private safeIpHash(req: Request): string | null {
    try {
      const xff = (req.headers['x-forwarded-for'] as string | undefined)
        ?.split(',')[0]
        ?.trim();
      const ip = xff ?? req.socket?.remoteAddress ?? null;
      if (!ip) return null;
      return this.ipHasher.hashIp(ip);
    } catch {
      return null;
    }
  }
}
