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
import { KnowledgeAccessResolver } from '../rbac/knowledge-access-resolver.service';
import { RbacService } from '../rbac/rbac.service';
import { S3Service } from '../recordings/s3.service';

import { IngestEventSchema, type IngestEventDto } from './dto/ingest-event.dto';
import type { IngestResponseDto, RawEventResponseDto } from './dto/raw-event.dto';
import { IngestTokenGuard, type RequestWithIngestContext } from './guards/ingest-token.guard';
import { IngestService } from './ingest.service';

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
    const ctxTenantId = req.ingestContext?.tenantId ?? null;
    let effectiveTenantId: string;
    if (ctxTenantId) {
      if (body.tenantId && body.tenantId !== ctxTenantId) {
        throw new ForbiddenException({
          ok: false,
          error: {
            code: 'tenant_mismatch',
            message: 'body.tenantId не совпадает с tenantId, привязанным к ingest-ключу',
          },
        });
      }
      effectiveTenantId = ctxTenantId;
    } else {
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

@ApiExcludeController()
@Controller('api/v1/raw-events')
@UseGuards(CookieAuthGuard, TenantGuard)
export class RawEventsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(RbacService) private readonly rbac: RbacService,
    @Inject(KnowledgeAccessResolver)
    private readonly accessResolver: KnowledgeAccessResolver,
  ) {}

  private async viewerHasBlockAccess(
    tenantId: string,
    userId: string,
    rawEventId: string,
  ): Promise<boolean> {
    const evidence = await this.prisma.ideaBlockEvidence.findMany({
      where: { rawEventId, block: { tenantId } },
      select: { blockId: true },
      take: 500,
    });
    const blockIds = [...new Set(evidence.map((e) => e.blockId))];
    if (blockIds.length === 0) return false;
    const ctx = await this.accessResolver.resolveAccessibleGroups({ tenantId, userId });
    const { accessible } = await this.accessResolver.partitionBlockIdsByAccess(ctx, blockIds);
    return accessible.length > 0;
  }

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
    const isPrivileged =
      ctx?.isSuperAdmin === true || ctx?.role === 'owner' || ctx?.role === 'admin';
    if (!isPrivileged) {
      const hasBlockAccess = await this.viewerHasBlockAccess(tenantId, user.id, event.id);
      if (!hasBlockAccess) {
        throw new ForbiddenException({
          ok: false,
          error: { code: 'forbidden', message: 'Нет доступа к источнику' },
        });
      }
      const fragment: RawEventResponseDto = {
        id: event.id,
        tenantId: event.tenantId,
        sourceId: event.sourceId,
        sourceType: event.sourceType,
        sourceExternalId: event.sourceExternalId,
        idempotencyKey: event.idempotencyKey,
        occurredAt: event.occurredAt.toISOString(),
        receivedAt: event.receivedAt.toISOString(),
        payloadStorage: event.payloadStorage,
        payload: null,
        payloadS3Key: null,
        payloadDownloadUrl: null,
        payloadChecksum: event.payloadChecksum,
        payloadSizeBytes: event.payloadSizeBytes,
        dataClass: event.dataClass,
        processingStatus: event.processingStatus,
        processingError: event.processingError,
        processedAt: event.processedAt?.toISOString() ?? null,
      };
      return { rawEvent: fragment };
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
