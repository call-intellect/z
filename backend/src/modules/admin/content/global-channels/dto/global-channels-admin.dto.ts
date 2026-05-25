/**
 * Admin-redesign Фаза 5 — DTO для `GlobalChannelsAdminController`.
 *
 * Глобальные каналы — `Channel` с `tenantId IS NULL`. Один на kind
 * (partial unique index `channels_global_unique` в postgres-init.sql).
 *
 * `secrets` приходят отдельным полем — сервис их зашифрует через
 * `CryptoService` перед записью в `config`. Возвращаем `config` без секретов.
 */

import { ChannelDirection, ChannelKind, ChannelStatus, DataClass } from '@prisma/client';
import { z } from 'zod';

const ChannelKindSchema = z.nativeEnum(ChannelKind);
const ChannelDirectionSchema = z.nativeEnum(ChannelDirection);
const ChannelStatusSchema = z.nativeEnum(ChannelStatus);
const DataClassSchema = z.nativeEnum(DataClass);

/**
 * Конфиг канала без секретов. Свободная JSON-структура, специфичная для
 * kind (например для telegram_bot: `{ botUsername: '@kora_bot' }`).
 */
const PublicConfigSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

const SecretsSchema = z.record(z.string(), z.string());

export const CreateGlobalChannelSchema = z.object({
  kind: ChannelKindSchema,
  direction: ChannelDirectionSchema,
  config: PublicConfigSchema.optional(),
  secrets: SecretsSchema.optional(),
  status: ChannelStatusSchema.optional(),
  maxDataClass: DataClassSchema.optional(),
});
export type CreateGlobalChannelDto = z.infer<typeof CreateGlobalChannelSchema>;

export const UpdateGlobalChannelSchema = z
  .object({
    direction: ChannelDirectionSchema.optional(),
    config: PublicConfigSchema.optional(),
    secrets: SecretsSchema.optional(),
    status: ChannelStatusSchema.optional(),
    maxDataClass: DataClassSchema.optional(),
    brokenReason: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'необходимо указать хотя бы одно поле',
  });
export type UpdateGlobalChannelDto = z.infer<typeof UpdateGlobalChannelSchema>;
