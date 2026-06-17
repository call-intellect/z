import { z } from 'zod';

/**
 * DTO модуля Regulations (SBA α-7). REST API `/api/v1/regulations` —
 * единый список Regulation / Process / Policy с фильтром `kind`.
 *
 * Под капотом — 3 отдельные Prisma-таблицы (`Regulation`, `Process`, `Policy`),
 * расширенные in-place из Фазы 0b. UI/клиент работает с ними как с единым
 * списком (см. план α-7, решение по §14.1).
 *
 * Все user-facing строки — на русском.
 */

export const RegulationKindSchema = z.enum([
  'regulation',
  'process',
  'policy',
  'standard',
  // A12 (Волна 6) — «Инструкция»: пошаговое «как сделать X» для одной роли.
  // Хранится в отдельной таблице `instructions` (см. RegulationsService.list).
  'instruction',
]);
export type RegulationKindDto = z.infer<typeof RegulationKindSchema>;

/**
 * A12 — статус существования карточки знаний (для instruction; на будущее —
 * и для прочих kind). Стабильные API-коды (англ.), маппинг из русских ярлыков
 * LLM см. `EXTRACTION_STATUS_RU_TO_API` в ai/services/prompts/common.
 */
export const ExtractionStatusSchema = z.enum(['exists', 'needed', 'discussed']);
export type ExtractionStatusDto = z.infer<typeof ExtractionStatusSchema>;

/**
 * Status — общий для Regulation/Process/Policy (Prisma enum `ProcessStatus`).
 * `active` соответствует «canonical» в терминах Слоя 4 (триаж одобрил).
 */
export const RegulationStatusSchema = z.enum([
  'active',
  'deprecated',
  'archived',
]);
export type RegulationStatusDto = z.infer<typeof RegulationStatusSchema>;

export const PolicySeverityDtoSchema = z.enum([
  'advisory',
  'mandatory',
  'blocking',
]);
export type PolicySeverityDto = z.infer<typeof PolicySeverityDtoSchema>;

export const TrustTierSchema = z.enum(['auto', 'provisional', 'human']);
export type TrustTierDto = z.infer<typeof TrustTierSchema>;

// ─────────────────────────── Query / Filters ─────────────────────────

export const ListRegulationsQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  kind: RegulationKindSchema.optional(),
  status: RegulationStatusSchema.optional(),
  scope: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListRegulationsQuery = z.infer<typeof ListRegulationsQuerySchema>;

export const GetRegulationParamsSchema = z.object({
  kind: RegulationKindSchema,
});
export type GetRegulationParamsQuery = z.infer<typeof GetRegulationParamsSchema>;

export const SupersedeRegulationBodySchema = z.object({
  kind: RegulationKindSchema,
  supersededByRegulationId: z.string().min(1).max(60),
});
export type SupersedeRegulationBody = z.infer<typeof SupersedeRegulationBodySchema>;

export const ConfirmRegulationBodySchema = z.object({
  kind: RegulationKindSchema,
});
export type ConfirmRegulationBody = z.infer<typeof ConfirmRegulationBodySchema>;

// ── Action Center E1 «поправить карточку знаний» (2026-06-04) ──
// «Это неверно» (dispute) — флаг без правки → обучающий сигнал misleading.
export const DisputeRegulationBodySchema = z
  .object({
    kind: RegulationKindSchema,
    reason: z.string().trim().max(2000).optional(),
  })
  .strict();
export type DisputeRegulationBody = z.infer<typeof DisputeRegulationBodySchema>;

// «Исправить» (correct) — правка текста. owner/admin → сразу новая версия;
// read-only → предложение в очередь курации. Поля валидны под нужный kind.
export const CorrectRegulationBodySchema = z
  .object({
    kind: RegulationKindSchema,
    correctedPayload: z
      .object({
        name: z.string().trim().min(1).max(300).optional(),
        contentMd: z.string().trim().min(1).max(20000).optional(),
        statement: z.string().trim().min(1).max(8000).optional(),
        description: z.string().trim().min(1).max(20000).optional(),
      })
      .refine((p) => Object.values(p).some((v) => v !== undefined), {
        message: 'Нужно изменить хотя бы одно поле',
      }),
    reason: z.string().trim().max(2000).optional(),
  })
  .strict();
export type CorrectRegulationBody = z.infer<typeof CorrectRegulationBodySchema>;

// ─────────────────────────── Response DTOs ───────────────────────────

export interface RegulationListItemDto {
  id: string;
  kind: RegulationKindDto;
  name: string;
  statement: string | null;
  /** Только для kind='regulation': 'regulation' | 'standard'. */
  category: 'regulation' | 'standard' | null;
  /** Только для kind='policy'. */
  severity: PolicySeverityDto | null;
  scope: string | null;
  status: RegulationStatusDto;
  ownerPersonId: string | null;
  confidence: number | null;
  /**
   * A12 (Волна 6) — статус существования. Заполняется только для
   * kind='instruction' (выводится из Instruction.status: active→exists,
   * deprecated→discussed). Для остальных kind — null.
   */
  extractionStatus?: ExtractionStatusDto | null;
  /** A12 — роль-владелец инструкции (Instruction.forRole). Для остальных kind — null. */
  forRole?: string | null;
  /** Уровень доверия актуальной версии карточки (лестница доверия A1). */
  trustTier: TrustTierDto;
  lastConfirmedAt: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface ProcessStepDto {
  id: string;
  order: number;
  name: string;
  description: string | null;
  slaMinutes: number | null;
}

export interface RegulationDetailDto extends RegulationListItemDto {
  contentMd: string;
  sourceBlockIds: string[];
  personSubjectIds: string[];
  currentVersionId: string | null;
  /** Только для kind='process'. */
  steps?: ProcessStepDto[];
  /** Только для kind='regulation': self-relation на предыдущую версию. */
  supersedesId?: string | null;
}

export interface ListRegulationsResponse {
  items: RegulationListItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface RegulationVersionItemDto {
  id: string;
  version: number;
  previousVersionId: string | null;
  payload: Record<string, unknown>;
  changeReason: string | null;
  createdAt: string;
  createdByUserId: string | null;
}

export interface RegulationHistoryResponse {
  items: RegulationVersionItemDto[];
}

// ─────────────────────────── C3 — provenance (sources) ───────────────
//
// `GET /api/v1/regulations/:id/sources?kind=` — цитаты-первоисточники карточки
// (хаб «Оцифровано», провенанс). Цепочка: <card>.sourceBlockIds[] → IdeaBlock →
// IdeaBlockEvidence (quote) → RawEvent → Meeting (best-effort title/date).
//
// Один блок может иметь несколько evidence (из разных встреч/чатов) —
// возвращаем по записи на каждую цитату (гранулярность evidence), а не
// агрегируем по блоку: так UI показывает каждую отдельную ссылку «откуда взято».

/** Встреча-источник цитаты (если evidence ссылается на RawEvent типа meeting). */
export interface RegulationSourceMeetingDto {
  id: string;
  title: string;
  /** ISO-дата встречи (startedAt → createdAt → sourceTimestamp evidence). */
  date: string;
}

export interface RegulationSourceItemDto {
  /** id IdeaBlock'а, к которому относится цитата. */
  blockId: string;
  /** Текстовая цитата-первоисточник (IdeaBlockEvidence.quote). */
  quote: string;
  /** Встреча-источник или null (для не-meeting источников / неразрешённой встречи). */
  meeting: RegulationSourceMeetingDto | null;
}

export interface RegulationSourcesResponse {
  items: RegulationSourceItemDto[];
}

// ─────────────────────────── C4 — summary (сводка хаба) ──────────────
//
// `GET /api/v1/regulations/summary` — счётчики 4 типов карточек + недельный
// прирост (карточки всех типов, созданные за последние 7 дней). Доступ — как у
// list (read на любой из 4 типов), чтобы read-доступ к хабу давал и сводку.

export interface RegulationSummaryResponse {
  regulations: number;
  processes: number;
  instructions: number;
  policies: number;
  /** Суммарно создано карточек всех 4 типов за последние 7 дней. */
  weekDelta: number;
  /** Ф5 — kill-switch редизайна раздела (`knowledge_base.redesign.enabled`,
   *  дефолт ON). Едет на фронт: true → новая раскладка, false → прежняя. */
  redesignEnabled: boolean;
}
