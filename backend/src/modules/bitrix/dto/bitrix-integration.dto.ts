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
