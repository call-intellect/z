import { z } from 'zod';

export const PROVENANCE_ENTITY_TYPES = [
  'decision',
  'issue',
  'task',
  'regulation',
  'instruction',
  'block',
  'notification',
] as const;

export const ProvenanceEntityTypeSchema = z.enum(PROVENANCE_ENTITY_TYPES);

export const ProvenanceSourceRefDto = z.object({
  type: z.string(),
  refId: z.string().nullable(),
  label: z.string(),
  deepLink: z.string().nullable(),
});

export const ProvenanceNodeDto = z.object({
  blockId: z.string(),
  rawEventId: z.string(),
  source: ProvenanceSourceRefDto,
  quote: z.string(),
  attribution: z.enum(['quoted', 'inferred']),
  startMs: z.number().nullable(),
  endMs: z.number().nullable(),
  occurredAt: z.string().nullable(),
  confidence: z.number().nullable(),
  accessFiltered: z.boolean(),
});

export const ProvenanceResponseDto = z.object({
  nodes: z.array(ProvenanceNodeDto),
  coverage: z.object({
    blocks: z.number(),
    meetings: z.number(),
  }),
});

export type ProvenanceResponse = z.infer<typeof ProvenanceResponseDto>;
