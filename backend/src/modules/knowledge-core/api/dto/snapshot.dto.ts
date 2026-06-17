import { z } from 'zod';

import { SIGNAL_TYPE_VALUES } from '../../prompts/block-ingest.prompt';

import type { BlockSearchItemDto, EntityItemDto, EvidenceItemDto } from './search.dto';

export const SnapshotQueryRawSchema = z.object({
  at: z
    .string()
    .min(1, 'at обязателен')
    .refine((v) => !Number.isNaN(Date.parse(v)), 'at должен быть ISO8601'),
  entityId: z.string().min(1).optional(),
  signalTypes: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => {
      if (v === undefined) return undefined;
      const arr = Array.isArray(v) ? v.flatMap((s) => s.split(',')) : v.split(',');
      const trimmed = arr.map((s) => s.trim()).filter((s) => s.length > 0);
      return trimmed.length > 0 ? trimmed : undefined;
    })
    .pipe(z.array(z.enum(SIGNAL_TYPE_VALUES)).max(SIGNAL_TYPE_VALUES.length).optional()),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export type SnapshotQueryDto = z.infer<typeof SnapshotQueryRawSchema>;

export interface SnapshotServiceArgs {
  tenantId: string;
  userId: string;
  at: Date;
  entityId?: string;
  signalTypes?: string[];
  limit: number;
}

export interface SnapshotBlockItemDto {
  block: BlockSearchItemDto;
  evidence: EvidenceItemDto[];
  entities: EntityItemDto[];
}

export interface SnapshotEntityLinkDto {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  fromType: string | null;
  toType: string | null;
  relationType: string;
  validFrom: string;
  validUntil: string | null;
}

export interface SnapshotResponseDto {
  asOf: string;
  blocks: SnapshotBlockItemDto[];
  entityLinks: SnapshotEntityLinkDto[];
  truncated: boolean;
  tookMs: number;
}
