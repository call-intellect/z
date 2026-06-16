import { z } from 'zod';

export const BRAND_VOICE_TONE_DIMENSIONS = [
  'formal',
  'technical',
  'casual',
  'energetic',
  'authoritative',
  'friendly',
  'playful',
  'minimalist',
  'expressive',
  'inclusive',
] as const;

export type BrandVoiceToneDimension = (typeof BRAND_VOICE_TONE_DIMENSIONS)[number];

const ToneSchema = z
  .object({
    formal: z.number().min(0).max(1).optional(),
    technical: z.number().min(0).max(1).optional(),
    casual: z.number().min(0).max(1).optional(),
    energetic: z.number().min(0).max(1).optional(),
    authoritative: z.number().min(0).max(1).optional(),
    friendly: z.number().min(0).max(1).optional(),
    playful: z.number().min(0).max(1).optional(),
    minimalist: z.number().min(0).max(1).optional(),
    expressive: z.number().min(0).max(1).optional(),
    inclusive: z.number().min(0).max(1).optional(),
  })
  .strict();

export type BrandVoiceTone = z.infer<typeof ToneSchema>;

const ValueItemSchema = z
  .object({
    value: z.string().trim().min(1).max(120),
    weight: z.number().min(0).max(1),
    exampleBlockIds: z.array(z.string().min(1).max(64)).max(20).default([]),
  })
  .strict();

const TabooItemSchema = z
  .object({
    phrase: z.string().trim().min(1).max(200),
    alternative: z.string().trim().min(1).max(200).optional(),
    reason: z.string().trim().min(1).max(500),
  })
  .strict();

export type BrandVoiceValueItem = z.infer<typeof ValueItemSchema>;
export type BrandVoiceTabooItem = z.infer<typeof TabooItemSchema>;

export const UpdateBrandVoiceProfileSchema = z
  .object({
    tone: ToneSchema.nullable().optional(),
    values: z.array(ValueItemSchema).max(20).nullable().optional(),
    taboos: z.array(TabooItemSchema).max(50).nullable().optional(),
    exampleArtifactIds: z.array(z.string().min(1).max(64)).max(50).optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Хотя бы одно поле должно быть указано',
  });
export type UpdateBrandVoiceProfileDto = z.infer<typeof UpdateBrandVoiceProfileSchema>;

export interface BrandVoiceProfileDto {
  id: string;
  tenantId: string;
  tone: BrandVoiceTone | null;
  values: BrandVoiceValueItem[] | null;
  taboos: BrandVoiceTabooItem[] | null;
  exampleArtifactIds: string[];
  version: number;
  lastBuiltAt: string | null;
  builderAgentVersion: string | null;
  completeness: number;
  corpusSize: number;
  belowCorpusThreshold: boolean;
  minCorpusSize: number;
  createdAt: string;
  updatedAt: string;
}

export interface RebuildBrandVoiceResponseDto {
  ok: true;
  enqueued: boolean;
  reason: string;
}

export interface BrandVoiceArtifactDto {
  id: string;
  name: string;
  mimeType: string;
  status: string;
  useCases: string[];
  createdAt: string;
}
