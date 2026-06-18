import type {
  DataClass,
  RawEventPayloadStorage,
  RawEventProcessingStatus,
  SourceType,
} from '@prisma/client';

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
  payload: unknown | null;
  payloadS3Key: string | null;
  payloadDownloadUrl: string | null;
  payloadChecksum: string;
  payloadSizeBytes: number;
  dataClass: DataClass;
  processingStatus: RawEventProcessingStatus;
  processingError: string | null;
  processedAt: string | null;
}

export interface IngestResponseDto {
  rawEventId: string;
  idempotent: boolean;
}
