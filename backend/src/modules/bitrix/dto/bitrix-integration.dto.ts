import type { BitrixIntegrationStatus } from '@prisma/client';
import { z } from 'zod';

/**
 * DTO модуля Bitrix24-интеграции.
 * ТЗ: plans/tz/2026-06-09-bitrix24-integration-install.md.
 *
 * Контракт приватности: токены НИКОГДА не возвращаются plain — в read-ответе
 * только `hasTokens: boolean`. Запросы — Zod-валидация через ZodValidationPipe.
 */

/**
 * Домен портала Bitrix24. Нормализуем: срезаем схему/слэши/пробелы, в нижний
 * регистр. Допускаем поддомены *.bitrix24.* и кастомные домены (box) — поэтому
 * проверяем только общий вид hostname с точкой, без привязки к bitrix24.*.
 */
export const BitrixDomainSchema = z
  .string()
  .trim()
  .min(3)
  .max(253)
  .transform((v) =>
    v
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .toLowerCase(),
  )
  .refine((v) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)+$/.test(v), {
    message: 'Некорректный домен портала Bitrix24',
  });

/** Query `GET /bitrix/integration/authorize-url?domain=` */
export const BitrixAuthorizeUrlQuerySchema = z.object({
  domain: BitrixDomainSchema,
});
export type BitrixAuthorizeUrlQueryDto = z.infer<
  typeof BitrixAuthorizeUrlQuerySchema
>;

/** Тело `POST /bitrix/integration/claim` — привязать pending-установку к org. */
export const BitrixClaimSchema = z.object({
  memberId: z.string().trim().min(1),
});
export type BitrixClaimDto = z.infer<typeof BitrixClaimSchema>;

/** Тело `PATCH /bitrix/integration/analysis` — тумблер AI-анализа диалогов. */
export const BitrixAnalysisToggleSchema = z.object({
  enabled: z.boolean(),
});
export type BitrixAnalysisToggleDto = z.infer<typeof BitrixAnalysisToggleSchema>;

/**
 * Тело `PATCH /bitrix/integration/users/:externalId/link` — ручное сопоставление
 * Bitrix-сотрудника с Person Коры (как ChatBox-менеджеры). Режимы:
 *   - `link`   — привязать к существующему Person (`personId` обязателен);
 *   - `unlink` — снять связку (linkMode='manual', чтобы автосвязка не вернула);
 *   - `create` — создать карточку Person по имени/email сотрудника и привязать.
 */
export const BitrixUserLinkSchema = z
  .object({
    mode: z.enum(['link', 'unlink', 'create']),
    personId: z.string().trim().min(1).optional(),
  })
  .refine((v) => v.mode !== 'link' || !!v.personId, {
    message: 'personId обязателен для mode=link',
    path: ['personId'],
  });
export type BitrixUserLinkDto = z.infer<typeof BitrixUserLinkSchema>;

/** Bitrix-сотрудник для UI сопоставления. */
export interface BitrixUserDto {
  externalId: string;
  name: string | null;
  email: string | null;
  position: string | null;
  active: boolean;
  linkMode: 'none' | 'auto' | 'manual';
  linkedPersonId: string | null;
  linkedPersonName: string | null;
}

/** Кандидат Person для селекта связки. */
export interface BitrixPersonOptionDto {
  id: string;
  name: string | null;
  email: string | null;
}

/** Ответ `GET /bitrix/integration/users` — список сотрудников + кандидаты Person. */
export interface BitrixUsersResponseDto {
  users: BitrixUserDto[];
  personCandidates: BitrixPersonOptionDto[];
}

/**
 * Сериализованная интеграция для UI. БЕЗ токенов — только `hasTokens`.
 */
export interface BitrixIntegrationResponseDto {
  id: string;
  portalDomain: string;
  status: BitrixIntegrationStatus;
  scope: string | null;
  hasTokens: boolean;
  lastError: string | null;
  accessExpiresAt: string | null;
  lastConnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Ответ `GET /bitrix/integration/status` — для стеклянной страницы источника. */
export interface BitrixStatusResponseDto {
  integration: BitrixIntegrationResponseDto;
  analysisEnabled: boolean;
  lastFullSyncAt: string | null;
  lastIncrementalSyncAt: string | null;
  counts: {
    users: number;
    dialogs: number;
    sessions: number;
    contacts: number;
    companies: number;
    deals: number;
    leads: number;
    notes: number;
  };
  sessionsByStatus: {
    pending: number;
    analyzing: number;
    done: number;
    failed: number;
  };
}
