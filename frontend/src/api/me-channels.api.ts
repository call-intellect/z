/**
 * β-9 / Phase 6 (2026-05-25) — фасад API над `conversational.api.ts`,
 * сфокусированный на кабинете сотрудника `/me/channels` и
 * `/me/notifications-telegram`.
 *
 * Зачем отдельный модуль:
 *   - `conversational.api.ts` оставлен общим для всех каналов (Org-уровень,
 *     in-app, MAX). Здесь — узкие Telegram-специфичные хелперы (deep-link,
 *     normalize preferences для UI) + место для `resetTelegramBinding`,
 *     когда backend его добавит.
 *
 * Слоистая модель frontend (см. `feedback_admin_ui_russian_only` и правило
 * слоёв): тут ApiDto → re-export сырых вызовов. DomainModel — в
 * `src/domain/me-channels.ts`.
 */

import { apiClient } from './api-client';

export {
  listMyChannels,
  generateLinkCode,
  updateBindingPreferences,
  unlinkChannelBinding,
  type ChannelEntryApi,
  type ChannelBindingApi,
  type ChannelBindingPreferencesApi,
  type ChannelKindApi,
  type LinkCodeKindApi,
} from './conversational.api';

/**
 * Сгенерировать deep-link на Telegram-бота, который сразу при `/start`
 * прожжёт `linkCode`. Username берётся из ENV; по умолчанию `kora_bot`.
 */
export function buildTelegramDeepLink(
  linkCode: string,
  botUsername?: string | null,
): string {
  const username = (
    botUsername || process.env.NEXT_PUBLIC_KORA_BOT_USERNAME || 'kora_bot'
  )
    .replace(/^@/, '')
    .trim();
  return `https://t.me/${username}?start=${encodeURIComponent(linkCode)}`;
}

/**
 * β-9 / Phase 6 — статус ответа сервера на запрос «Сбросить привязку
 * Telegram». Если эндпоинт ещё не реализован на бэкенде, фронт ловит
 * 404 и показывает понятное сообщение пользователю.
 */
export type ResetTelegramBindingResultApi = {
  ok: true;
  /** Сколько привязок было удалено (0 — если их и так не было). */
  removed: number;
};

/**
 * β-9 / Phase 6 — «Сбросить привязку Telegram» из кабинета сотрудника
 * (сценарий «сменил телефон, не помнит пароль»). Backend-эндпоинт
 * `POST /api/v1/me/channels/telegram_bot/reset` пока НЕ реализован —
 * ждём Wave 2. На фронте вызов оформлен, чтобы быть готовым подцепить.
 *
 * Пока бэк отвечает 404 — `ApiError.code='not_implemented'` (либо иной);
 * вызывающий UI ловит и показывает сообщение «Перепривязка скоро будет
 * доступна — попросите руководителя сбросить вас через карточку
 * сотрудника».
 */
export async function resetTelegramBinding(): Promise<ResetTelegramBindingResultApi> {
  return apiClient.post<ResetTelegramBindingResultApi>(
    '/api/v1/me/channels/telegram_bot/reset',
    {},
  );
}
