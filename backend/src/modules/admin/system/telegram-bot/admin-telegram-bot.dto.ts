import { z } from 'zod';

/**
 * DTO для главной админки Z — управление глобальным Telegram-ботом (β-9, Phase 4).
 *
 * Доступ — только super-admin (см. ТЗ §10, RBAC ResourceType `system_telegram_bot`).
 * Контракт описан в plans/tz/2026-05-25-telegram-bot-global-and-invites.md §7.
 *
 * Главные продуктовые ограничения (см. second-brain/01_projects/conversational-channels.md):
 *   - токен бота никогда не возвращается в plain — только `tokenIsSet` + `tokenLastChars`;
 *   - содержимое переписки сотрудников НЕ доступно (см. принцип №1 продукта);
 *   - список привязок отдаёт только метаданные (см. принцип №2).
 */

// ────────────────────────── GET /admin/system/telegram-bot ──────────────

export const TelegramBotSettingsResponseSchema = z.object({
  /** Есть ли вообще глобальный канал (создан миграцией / админом). */
  channelExists: z.boolean(),
  /** ID глобального канала (для логов; в UI не показываем). */
  channelId: z.string().nullable(),
  /** Установлен ли токен (расшифрованный botToken не пустой). */
  tokenIsSet: z.boolean(),
  /**
   * Последние 4 символа токена для визуального подтверждения
   * («тот ли это бот?»). Никогда не возвращаем полный токен.
   */
  tokenLastChars: z.string().nullable(),
  /** Webhook URL, который мы сейчас зарегистрировали бы в Telegram. */
  webhookUrl: z.string(),
  /** Есть ли webhook-секрет (используется при verify входящих webhook'ов). */
  webhookSecretIsSet: z.boolean(),
  /** Имя бота (`@kora_bot` без `@`) — для построения deep-link в письмах. */
  botUsername: z.string().nullable(),
  /** Статус глобального канала: active | global_disabled | broken | disabled. */
  status: z.enum(['active', 'disabled', 'broken', 'global_disabled']),
  /** Причина broken-статуса (если есть). */
  brokenReason: z.string().nullable(),
  /** Шаблоны сообщений бота (см. §2 ТЗ — редактируются админом). */
  templates: z.object({
    welcome: z.string(),
    notLinked: z.string(),
    employeeOffboarded: z.string(),
    orgFrozen: z.string(),
  }),
  updatedAt: z.string(),
});
export type TelegramBotSettingsResponseDto = z.infer<
  typeof TelegramBotSettingsResponseSchema
>;

// ────────────────────────── PUT /admin/system/telegram-bot/token ────────

export const UpdateTokenSchema = z.object({
  /**
   * Bot token формата `<bot_id>:<secret>` (выдаёт @BotFather). 10..200 символов,
   * без пробелов. На сервере шифруется AES-256-GCM перед записью в БД.
   */
  token: z
    .string()
    .min(10, 'Токен слишком короткий')
    .max(200, 'Токен слишком длинный')
    .regex(/^\d+:[A-Za-z0-9_-]+$/, 'Ожидаемый формат: <bot_id>:<secret>'),
});
export type UpdateTokenDto = z.infer<typeof UpdateTokenSchema>;

// ────────────────────────── PUT /admin/system/telegram-bot/webhook ──────

export const ResetWebhookSchema = z.object({
  /**
   * Опциональный override URL. Если не задан — используется computed URL
   * (`<APP_PUBLIC_URL>/api/v1/webhooks/telegram-bot`).
   */
  webhookUrl: z.string().url().optional(),
});
export type ResetWebhookDto = z.infer<typeof ResetWebhookSchema>;

// ────────────────────────── PUT /admin/system/telegram-bot/templates ────

export const UpdateTemplatesSchema = z.object({
  welcome: z.string().min(1).max(2000).optional(),
  notLinked: z.string().min(1).max(2000).optional(),
  employeeOffboarded: z.string().min(1).max(2000).optional(),
  orgFrozen: z.string().min(1).max(2000).optional(),
});
export type UpdateTemplatesDto = z.infer<typeof UpdateTemplatesSchema>;

// ────────────────────────── PUT /admin/system/telegram-bot/status ───────

export const UpdateStatusSchema = z.object({
  status: z.enum(['active', 'global_disabled']),
});
export type UpdateStatusDto = z.infer<typeof UpdateStatusSchema>;

// ────────────────────────── GET /admin/system/telegram-bot/bindings ─────

/**
 * Статус привязки сотрудника к глобальному боту. Виден главному админу Z,
 * но содержимое сообщений никогда не доступно (продуктовый принцип №1).
 *
 *   - linked         — verified, всё работает.
 *   - pending        — binding есть, но не верифицирован (на практике редкий случай).
 *   - no_membership  — пользователь привязал бот, но не состоит ни в одной Org.
 *   - bot_blocked    — мы получали ошибку «bot was blocked by the user».
 *   - inactive       — нет входящих > 30 дней.
 */
export type BindingStatus =
  | 'linked'
  | 'pending'
  | 'no_membership'
  | 'bot_blocked'
  | 'inactive';

export const ListBindingsQuerySchema = z.object({
  orgId: z.string().min(1).max(64).optional(),
  status: z
    .enum(['linked', 'pending', 'no_membership', 'bot_blocked', 'inactive'])
    .optional(),
  /** 1-based page (для совместимости с UI). */
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListBindingsQueryDto = z.infer<typeof ListBindingsQuerySchema>;

export const BindingRowSchema = z.object({
  id: z.string(),
  orgId: z.string().nullable(),
  orgName: z.string().nullable(),
  userId: z.string(),
  userEmail: z.string().nullable(),
  userName: z.string().nullable(),
  status: z.enum([
    'linked',
    'pending',
    'no_membership',
    'bot_blocked',
    'inactive',
  ]),
  linkedAt: z.string().nullable(),
  lastInboundAt: z.string().nullable(),
  inboundCount: z.number().int(),
  outboundCount: z.number().int(),
});
export type BindingRowDto = z.infer<typeof BindingRowSchema>;

export const BindingsPageSchema = z.object({
  items: z.array(BindingRowSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type BindingsPageDto = z.infer<typeof BindingsPageSchema>;
