/**
 * Tracker Project Overview (2026-05-27) — DTO для
 * `GET /api/v1/projects/:projectId/integrations-status`.
 *
 * Часть 3 «Приложения» из plans/tz/2026-05-27-tracker-project-overview.md.
 * Состояние каждой интеграции — best-effort: если соответствующего модуля
 * нет, поле = null/false/0 (UI рендерит карточку «Не настроено»).
 */

export interface IntegrationEmailToTaskDto {
  enabled: boolean;
  /** `${alias}@${MAIL_INBOX_DOMAIN}` — null если выключено. */
  alias: string | null;
}

export interface IntegrationTelegramSubscriptionDto {
  /** Подписка проекта на Telegram-уведомления у текущего пользователя. */
  isActive: boolean;
  /** У текущего пользователя есть привязка к Telegram-аккаунту. */
  telegramLinked: boolean;
}

export interface IntegrationLastImportDto {
  source: string;
  completedAt: string;
}

export interface IntegrationsStatusResponseDto {
  emailToTask: IntegrationEmailToTaskDto;
  telegramSubscription: IntegrationTelegramSubscriptionDto;
  webhooksCount: number;
  lastImport: IntegrationLastImportDto | null;
}
