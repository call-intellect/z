import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request as ExpressRequest } from 'express';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';
import { S3Service } from '../recordings/s3.service';

import { IngestEventSchema, type IngestEventDto } from './dto/ingest-event.dto';
import type { IngestResponseDto, RawEventResponseDto } from './dto/raw-event.dto';
import {
  IngestTokenGuard,
  type RequestWithIngestContext,
} from './guards/ingest-token.guard';
import { IngestService } from './ingest.service';

/**
 * HTTP API для knowledge-core ingest pipeline.
 *
 *   - `POST /api/v1/ingest` — внешние адаптеры (telegram/email/IMAP, Фаза 10).
 *     Защищён `IngestTokenGuard` (shared secret в ENV `INGEST_INTERNAL_TOKEN`).
 *     In-process meeting-adapter сюда не ходит — он дёргает `IngestService`
 *     напрямую.
 *   - `GET /api/v1/raw-events/:id` — отладочный endpoint. Доступен `owner`/
 *     `admin` той же Org, которой принадлежит `RawEvent`. Под `CookieAuthGuard +
 *     TenantGuard`.
 */
@ApiExcludeController()
@Controller('api/v1/ingest')
@UseGuards(IngestTokenGuard)
export class IngestController {
  constructor(@Inject(IngestService) private readonly ingest: IngestService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(IngestEventSchema)) body: IngestEventDto,
    @Req() req: RequestWithIngestContext,
  ): Promise<IngestResponseDto> {
    // Per-Org ApiKey фиксирует tenantId: body.tenantId должен совпасть либо
    // отсутствовать. Shared-secret режим — body.tenantId обязателен (как раньше).
    const ctxTenantId = req.ingestContext?.tenantId ?? null;
    let effectiveTenantId: string;
    if (ctxTenantId) {
      if (body.tenantId && body.tenantId !== ctxTenantId) {
        throw new ForbiddenException({
          ok: false,
          error: {
            code: 'tenant_mismatch',
            message:
              'body.tenantId не совпадает с tenantId, привязанным к ingest-ключу',
          },
        });
      }
      effectiveTenantId = ctxTenantId;
    } else {
      // shared-secret режим — body.tenantId обязателен.
      effectiveTenantId = body.tenantId;
    }

    const result = await this.ingest.ingest({
      tenantId: effectiveTenantId,
      sourceId: body.sourceId,
      sourceExternalId: body.sourceExternalId ?? null,
      occurredAt: new Date(body.occurredAt),
      payload: body.payload,
      dataClass: body.dataClass,
    });
    return {
      rawEventId: result.rawEvent.id,
      idempotent: result.idempotent,
    };
  }
}

/**
 * Отладочный endpoint просмотра `RawEvent` по id.
 * Под `CookieAuthGuard + TenantGuard`. Доступ — только owner/admin Org.
 */
@ApiExcludeController()
@Controller('api/v1/raw-events')
@UseGuards(CookieAuthGuard, TenantGuard)
export class RawEventsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get(':id')
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @Req() req: ExpressRequest & { tenantId?: string },
  ): Promise<{ rawEvent: RawEventResponseDto }> {
    const event = await this.prisma.rawEvent.findUnique({ where: { id } });
    if (!event) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'raw_event_not_found' },
      });
    }
    const tenantId = req.tenantId;
    if (!tenantId || event.tenantId !== tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'foreign_tenant', message: 'RawEvent принадлежит другой Org' },
      });
    }
    const ctx = await this.rbac.loadContext(user.id, tenantId);
    const allowed =
      ctx?.isSuperAdmin === true || ctx?.role === 'owner' || ctx?.role === 'admin';
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Только owner/admin Org может смотреть raw events' },
      });
    }

    let payloadDownloadUrl: string | null = null;
    if (event.payloadStorage === 's3' && event.payloadS3Key) {
      const presigned = await this.s3.presignGet(event.payloadS3Key);
      payloadDownloadUrl = presigned.url;
    }

    const dto: RawEventResponseDto = {
      id: event.id,
      tenantId: event.tenantId,
      sourceId: event.sourceId,
      sourceType: event.sourceType,
      sourceExternalId: event.sourceExternalId,
      idempotencyKey: event.idempotencyKey,
      occurredAt: event.occurredAt.toISOString(),
      receivedAt: event.receivedAt.toISOString(),
      payloadStorage: event.payloadStorage,
      payload: event.payloadStorage === 'inline' ? (event.payload as unknown) : null,
      payloadS3Key: event.payloadS3Key,
      payloadDownloadUrl,
      payloadChecksum: event.payloadChecksum,
      payloadSizeBytes: event.payloadSizeBytes,
      dataClass: event.dataClass,
      processingStatus: event.processingStatus,
      processingError: event.processingError,
      processedAt: event.processedAt?.toISOString() ?? null,
    };
    return { rawEvent: dto };
  }
}
