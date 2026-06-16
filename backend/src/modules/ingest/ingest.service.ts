import { createHash } from 'node:crypto';

import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { type DataClass, Prisma, type RawEvent, type SourceType } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { CoreQueueService } from '../core-queue/core-queue.service';
import { EntitlementService } from '../entitlements/entitlement.service';
import { QuotaService } from '../quotas/quota.service';
import { S3Service } from '../recordings/s3.service';

const PAYLOAD_INLINE_LIMIT_BYTES = 10 * 1024 * 1024;

export interface IngestEventInput {
  tenantId: string;
  sourceId: string;
  sourceExternalId?: string | null;
  occurredAt: Date;
  payload: unknown;
  dataClass?: DataClass;
}

export interface IngestResult {
  rawEvent: RawEvent;
  idempotent: boolean;
}

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
    @Inject(EntitlementService) private readonly entitlements: EntitlementService,
    @Inject(QuotaService) private readonly quotas: QuotaService,
  ) {}

  async ingest(input: IngestEventInput): Promise<IngestResult> {
    const source = await this.prisma.source.findUnique({
      where: { id: input.sourceId },
    });
    if (!source) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'source_not_found', message: `Source ${input.sourceId} не найден` },
      });
    }
    if (source.tenantId !== input.tenantId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'source_tenant_mismatch',
          message: 'Source принадлежит другому tenant',
        },
      });
    }
    if (!source.isActive) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'source_inactive', message: 'Source отключён' },
      });
    }

    let payloadJson: string;
    try {
      payloadJson = JSON.stringify(input.payload);
    } catch (err) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'payload_not_serializable',
          message: `payload не сериализуется в JSON: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
    }
    if (payloadJson === undefined) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'payload_undefined', message: 'payload отсутствует или undefined' },
      });
    }
    const payloadChecksum = sha256Hex(payloadJson);
    const payloadSizeBytes = Buffer.byteLength(payloadJson, 'utf8');

    const occurredAtIso = input.occurredAt.toISOString();
    const dedupBasis = input.sourceExternalId ?? payloadChecksum;
    const idempotencyKey = sha256Hex(`${input.sourceId}:${dedupBasis}:${occurredAtIso}`);

    const existing = await this.prisma.rawEvent.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      this.logger.debug(
        {
          rawEventId: existing.id,
          sourceId: input.sourceId,
          sourceExternalId: input.sourceExternalId ?? null,
        },
        'ingest: идемпотентный возврат существующего RawEvent',
      );
      return { rawEvent: existing, idempotent: true };
    }

    try {
      const max = await this.entitlements.getQuota(input.tenantId, 'ingest_bytes_per_month');
      await this.quotas.checkAndIncrementOrg({
        tenantId: input.tenantId,
        quotaName: 'ingest_bytes_per_month',
        max,
        windowMs: 30 * 24 * 3600 * 1000,
        amount: payloadSizeBytes,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'QuotaExceededError') throw err;
      this.logger.warn(
        `IngestService.ingest: ingest_bytes_per_month check fail для ${input.tenantId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    const useS3 = payloadSizeBytes > PAYLOAD_INLINE_LIMIT_BYTES;
    const payloadS3Key = useS3 ? `raw-events/${input.tenantId}/${idempotencyKey}.json` : null;
    if (useS3 && payloadS3Key) {
      await this.s3.putJson(payloadS3Key, input.payload);
    }

    try {
      const created = await this.prisma.rawEvent.create({
        data: {
          tenantId: input.tenantId,
          sourceId: source.id,
          sourceType: source.type as SourceType,
          sourceExternalId: input.sourceExternalId ?? null,
          idempotencyKey,
          occurredAt: input.occurredAt,
          payloadStorage: useS3 ? 's3' : 'inline',
          payload: useS3 ? Prisma.JsonNull : (input.payload as Prisma.InputJsonValue),
          payloadS3Key,
          payloadChecksum,
          payloadSizeBytes,
          dataClass: input.dataClass ?? source.dataClass,
          processingStatus: 'received',
        },
      });
      await this.coreQueue.enqueueRawReceived(created.id).catch((err) => {
        this.logger.warn(
          { rawEventId: created.id, err: err instanceof Error ? err.message : String(err) },
          'ingest: enqueueRawReceived упал — RawEvent создан, job не поставлен',
        );
      });
      this.logger.log(
        {
          rawEventId: created.id,
          tenantId: created.tenantId,
          sourceType: created.sourceType,
          sourceId: created.sourceId,
          payloadStorage: created.payloadStorage,
          payloadSizeBytes: created.payloadSizeBytes,
        },
        'ingest: RawEvent создан',
      );
      return { rawEvent: created, idempotent: false };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existed = await this.prisma.rawEvent.findUnique({
          where: { idempotencyKey },
        });
        if (existed) {
          this.logger.debug(
            { rawEventId: existed.id },
            'ingest: P2002 race — возвращаем существующий RawEvent',
          );
          return { rawEvent: existed, idempotent: true };
        }
      }
      throw err;
    }
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
