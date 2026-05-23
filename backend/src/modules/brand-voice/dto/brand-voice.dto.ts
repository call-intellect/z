import { z } from 'zod';

/**
 * SBA β-7 — DTO для `/api/v1/brand-voice`.
 *
 * `BrandVoiceProfile` хранит:
 *   - tone — 10 осей тона (formal, technical, casual, energetic, ...);
 *   - values — ценности бренда с весами;
 *   - taboos — фразы, которые нельзя использовать;
 *   - exampleArtifactIds — Document.id'ы (useCases includes 'brand_corpus'),
 *     которые послужили опорой при извлечении.
 *
 * JSON-форма позволяет расширять структуру без alter table; валидация
 * происходит в сервисе/zod при PATCH.
 */

// ─────────────────────────── 10 осей тона ──────────────────────────────

/**
 * 10 канонических осей тона. Каждая — число в [0,1]. Все оси опциональны;
 * экстрактор заполняет тот набор, который смог уверенно оценить.
 */
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

export type BrandVoiceToneDimension =
  (typeof BRAND_VOICE_TONE_DIMENSIONS)[number];

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

// ─────────────────────────── values + taboos ───────────────────────────

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

// ─────────────────────────── PATCH body ────────────────────────────────

export const UpdateBrandVoiceProfileSchema = z
  .object({
    tone: ToneSchema.nullable().optional(),
    values: z.array(ValueItemSchema).max(20).nullable().optional(),
    taboos: z.array(TabooItemSchema).max(50).nullable().optional(),
    exampleArtifactIds: z
      .array(z.string().min(1).max(64))
      .max(50)
      .optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Хотя бы одно поле должно быть указано',
  });
export type UpdateBrandVoiceProfileDto = z.infer<
  typeof UpdateBrandVoiceProfileSchema
>;

// ─────────────────────────── response DTO ──────────────────────────────

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
  /** 0..1, доля заполненных секций (tone/values/taboos/examples). */
  completeness: number;
  /** Сколько Document'ов с useCases includes 'brand_corpus' в Org. */
  corpusSize: number;
  /**
   * Если корпус ниже порога BRAND_VOICE_MIN_CORPUS_SIZE — extractor пропустит
   * Org, и профиль останется пустым. Frontend подсвечивает этот статус.
   */
  belowCorpusThreshold: boolean;
  /** Порог, ниже которого корпус считается недостаточным. */
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
