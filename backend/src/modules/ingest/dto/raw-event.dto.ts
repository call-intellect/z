import type {
  DataClass,
  RawEventPayloadStorage,
  RawEventProcessingStatus,
  SourceType,
} from '@prisma/client';

/**
 * DomainModel представления `RawEvent` для отдачи через API.
 * Сериализуется в JSON напрямую (Date → ISO-строки).
 */
export interface RawEventResponseDto {
  id: string;
  tenantId: string;
  sourceId: string;
  sourceType: SourceType;
  sourceExternalId: string | null;
  idempotencyKey: string;
  occurredAt: string;
  receivedAt: string;
  payloadStorage: RawEventPayloadStorage;
  /**
   * Inline-payload, если `payloadStorage = inline`. Для `s3` — `null`,
   * клиент должен использовать `payloadDownloadUrl` (presigned).
   */
  payload: unknown | null;
  payloadS3Key: string | null;
  /** Если `payloadStorage = s3` — presigned URL на скачивание (TTL дефолтный). */
  payloadDownloadUrl: string | null;
  payloadChecksum: string;
  payloadSizeBytes: number;
  dataClass: DataClass;
  processingStatus: RawEventProcessingStatus;
  processingError: string | null;
  processedAt: string | null;
}

/**
 * Краткий ответ POST /api/v1/ingest.
 *
 *   - `idempotent = true` — клиент повторил вызов с тем же `idempotencyKey`,
 *     был возвращён существующий `RawEvent`.
 *   - `idempotent = false` — событие создано впервые.
 */
export interface IngestResponseDto {
  rawEventId: string;
  idempotent: boolean;
}
