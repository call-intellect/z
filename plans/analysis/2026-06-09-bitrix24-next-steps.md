# Bitrix24 — план дальнейшей разработки (после установки)

> Контекст: установка интеграции + жизненный цикл токена реализованы
> ([ТЗ](../tz/2026-06-09-bitrix24-integration-install.md)). Этот документ — backlog
> следующих этапов: от подключения портала к реальной **памяти компании из CRM**.
> Каждый этап оформляется отдельным ТЗ в `plans/tz/` перед кодом.

## Где сейчас (фундамент готов)
- `BitrixIntegration` (per-org, `memberId`-ключ, шифрованные токены, refresh-on-demand).
- `BitrixApiClient.callMethod(clientEndpoint, accessToken, method, params)` +
  `getValidAccessToken()` (refresh + retry уже есть на уровне токена).
- Оба способа установки (OAuth-коннект + ONAPPINSTALL/claim), kill-switch, RBAC, фича.

## Этап 1 — Синк CRM-данных в knowledge-core (главный)
**Цель:** зеркалить сущности Bitrix в граф знаний, как делает `chatbox` для чатов.

- **Модели-зеркала** (по образцу `Chatbox*`): `BitrixContact`, `BitrixCompany`,
  `BitrixDeal`, `BitrixUser` — `tenantId + externalId @@unique`, `raw Json`,
  `syncedAt`. Либо маппинг сразу в общие `Source`/`RawEvent` (предпочтительно —
  переиспользует pipeline `ingest → IdeaBlock + Entity`).
- **API-методы**: `crm.contact.list`, `crm.company.list`, `crm.deal.list`,
  `user.get` — постранично (`start`/`next`, по 50). Обёртка `callMethodList()`
  поверх `callMethod` с прокачкой курсора `next` и `total`.
- **Слой синка**: `bitrix-sync.service.ts` + очередь `bitrix.sync`
  (BullMQ, по образцу `chatbox-sync.queue`) + `@Cron` (full раз в сутки) +
  ручной триггер `POST /api/v1/bitrix/integration/sync`.
- **Refresh-on-401 на уровне REST**: сейчас refresh завязан на `accessExpiresAt`;
  добавить повтор `callMethod` при `BitrixApiError.isTokenExpired` (proactive +
  reactive).
- **Мост в knowledge-core**: контакт/компания → `Entity`; сделка/история →
  `IdeaBlock`/`RawEvent` (учесть `dataClass`/tenant-изоляцию).
- **Статусы синка**: `lastFullSyncAt`/`lastIncrementalSyncAt`/счётчики в
  `BitrixIntegration` (добавить поля) + `GET .../sync/status` (как chatbox).

## Этап 2 — Инкрементальный синк через события Bitrix
- `event.bind` на `OnCrmContactUpdate`/`OnCrmDealUpdate`/`OnCrmCompanyUpdate` →
  наш handler (расширить `bitrix-install.controller` или отдельный
  `bitrix-event.controller`) → точечный incremental-добор в очередь (дедуп по
  jobId, как chatbox webhook).
- Регистрация `event.bind` при подключении/claim (reconcile, как
  `reconcileWebhook` в chatbox).

## Этап 3 — placement-виджеты (присутствие Коры в Bitrix)
- `placement.bind` (`CRM_DEAL_DETAIL_TAB`, `CRM_CONTACT_DETAIL_TAB`) →
  iframe-страница Коры с памятью/инсайтами по карточке. Требует app с UI.

## Этап 4 — Готовность к публикации в Маркете
- Финализировать `scope` (минимум `crm,user,profile`; добавить по мере фич).
- Заполнить партнёрский кабинет: handler URL = `/bitrix/install`, install event →
  `/api/v1/bitrix/install/event`, redirect_uri → `/api/v1/bitrix/oauth/callback`.
- Чек-лист модерации: иконки/описание/политика, обработка trial/PAYMENT_REQUIRED
  (`BitrixApiError` уже различает коды), корректный `ONAPPUNINSTALL`.

## Этап 5 (опц.) — Self-hosted (box) Bitrix
- Box использует собственный OAuth-сервер (не `oauth.bitrix.info`).
  `BITRIX_OAUTH_BASE_URL` уже вынесен в ENV → доработка: per-integration
  oauth-эндпоинт (из `server_endpoint`), а не глобальный.

## Открытые вопросы к владельцу (перед Этапом 1)
- Какие сущности CRM в приоритете для «памяти компании» (сделки vs контакты vs
  активности/звонки)?
- Глубина истории при первом импорте (всё / последние N месяцев)?
- Нужен ли двусторонний поток (Кора → Bitrix) или только чтение в память.
