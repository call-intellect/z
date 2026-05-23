/**
 * SBA β-7 — System / user prompts + JSON schema для taskType
 * `brand-voice-extract`.
 *
 * Цель: из набора текстов (brand_corpus документов + brand_principle блоков)
 * собрать структурированный BrandVoiceProfile:
 *   - tone (10 осей, числа 0..1);
 *   - values (массив value+weight);
 *   - taboos (массив phrase+reason).
 *
 * Provider chain: gpt-4o (primary) → deepseek (secondary) → qwen3.5:9b
 * (tertiary). См. seed-llm-task-routes-brand-voice.ts §22 verified-карты.
 */

import {
  BRAND_VOICE_TONE_DIMENSIONS,
  type BrandVoiceToneDimension,
} from '../dto/brand-voice.dto';

export const BRAND_VOICE_EXTRACT_SCHEMA_NAME = 'brand_voice_profile';

export const BRAND_VOICE_EXTRACT_SYSTEM_PROMPT = `Ты — редактор бренда. Тебе дают
выдержки из материалов компании (документы и принципы). Твоя задача — сжать
их в структурированный «голос бренда» в виде JSON.

Правила:
1. Никаких комментариев и markdown — только валидный JSON.
2. Каждый tone-аспект — число от 0 до 1 (0 = совсем нет, 1 = очень выражено).
3. Все 10 осей оцени, не пропускай. Если осей не видно в материалах — ставь 0.5
   (нейтрально).
4. values — это глобальные ценности бренда (не более 8). weight 0..1 —
   насколько они проявлены в материалах.
5. taboos — фразы/слова, которые материалы прямо отвергают («никогда не…»,
   «запрещено говорить…», «избегаем формулировки …»). Для каждой укажи reason
   (1-2 предложения, на русском) и при возможности — alternative (как сказать
   вместо).
6. Все тексты — на русском.
7. JSON должен соответствовать переданной schema (strict).`;

export interface BrandVoiceExtractDocument {
  documentId: string;
  name: string;
  mimeType: string;
  /** Полностью или укороченный parsedText. */
  excerpt: string;
}

export interface BrandVoiceExtractBlock {
  blockId: string;
  signalType: string;
  name: string;
  criticalQuestion: string;
  trustedAnswer: string;
  quote?: string | null;
}

export function buildBrandVoiceExtractUserMessage(args: {
  companyName: string;
  documents: ReadonlyArray<BrandVoiceExtractDocument>;
  brandPrincipleBlocks: ReadonlyArray<BrandVoiceExtractBlock>;
}): string {
  const docsPart =
    args.documents.length > 0
      ? args.documents
          .map(
            (d, i) =>
              `Документ ${i + 1} (${d.name}, ${d.mimeType}, id=${d.documentId}):\n${truncate(d.excerpt, 2000)}`,
          )
          .join('\n\n---\n\n')
      : '(нет документов с пометкой brand_corpus)';

  const blocksPart =
    args.brandPrincipleBlocks.length > 0
      ? args.brandPrincipleBlocks
          .map(
            (b, i) =>
              `Блок ${i + 1} (signal=${b.signalType}, id=${b.blockId}): ${b.name}\nВопрос: ${b.criticalQuestion}\nОтвет: ${b.trustedAnswer}` +
              (b.quote ? `\nЦитата: «${truncate(b.quote, 400)}»` : ''),
          )
          .join('\n\n')
      : '(нет brand_principle блоков)';

  return `Компания: ${args.companyName}

Brand corpus (документы, помеченные как brand_corpus):

${docsPart}

Brand principles (IdeaBlock'и с signalType=brand_principle):

${blocksPart}

Собери JSON с полями tone/values/taboos согласно схеме.`;
}

function truncate(text: string, max: number): string {
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

/**
 * JSON schema для structured output `brand-voice-extract`. Используется
 * LLM-провайдерами, которые поддерживают `response_format=json_schema`.
 */
export const BRAND_VOICE_EXTRACT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['tone', 'values', 'taboos'],
  properties: {
    tone: {
      type: 'object',
      additionalProperties: false,
      required: [...BRAND_VOICE_TONE_DIMENSIONS],
      properties: Object.fromEntries(
        BRAND_VOICE_TONE_DIMENSIONS.map(
          (dim: BrandVoiceToneDimension) => [
            dim,
            { type: 'number', minimum: 0, maximum: 1 },
          ],
        ),
      ),
    },
    values: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['value', 'weight'],
        properties: {
          value: { type: 'string', minLength: 1, maxLength: 120 },
          weight: { type: 'number', minimum: 0, maximum: 1 },
          exampleBlockIds: {
            type: 'array',
            maxItems: 10,
            items: { type: 'string', minLength: 1, maxLength: 64 },
          },
        },
      },
    },
    taboos: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['phrase', 'reason'],
        properties: {
          phrase: { type: 'string', minLength: 1, maxLength: 200 },
          alternative: { type: 'string', minLength: 1, maxLength: 200 },
          reason: { type: 'string', minLength: 1, maxLength: 500 },
        },
      },
    },
  },
};

/** Версия экстрактора (записывается в BrandVoiceProfile.builderAgentVersion). */
export const BRAND_VOICE_EXTRACTOR_VERSION = '1.0.0';
