import { z } from 'zod';

import { SIGNAL_TYPE_VALUES } from '../../prompts/block-ingest.prompt';

export const SearchRequestSchema = z.object({
  query: z.string().trim().min(1).max(500),
  signalTypes: z.array(z.enum(SIGNAL_TYPE_VALUES)).max(SIGNAL_TYPE_VALUES.length).optional(),
  entityIds: z.array(z.string().min(1)).max(50).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export type SearchRequestDto = z.infer<typeof SearchRequestSchema>;

export interface BlockSearchItemDto {
  id: string;
  name: string;
  criticalQuestion: string;
  trustedAnswer: string;
  signalType: string;
  tags: string[];
  confidence: number;
  evidenceCount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface EvidenceItemDto {
  id: string;
  rawEventId: string;
  sourceType: string;
  sourceTimestamp: string | null;
  quote: string;
  startMs: number | null;
  endMs: number | null;
}

export interface EntityItemDto {
  id: string;
  type: string;
  canonicalName: string;
  aliases: string[];
  mentionsCount: number;
  metadata: Record<string, unknown> | null;
}

export interface SearchResultItemDto {
  block: BlockSearchItemDto;
  evidence: EvidenceItemDto[];
  entities: EntityItemDto[];
  scores: {
    cosine: number;
    bm25: number;
    combined: number;
  };
}

export interface SearchResultsDto {
  results: SearchResultItemDto[];
  tookMs: number;
}
