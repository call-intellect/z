---
type: tz
status: in_progress
feature: Перевод Telegram-канала Z на проксирование через telegram.crossmark.ru
phase: ops-tg-proxy
date: 2026-05-26
parent: plans/tz/2026-05-25-telegram-bot-global-and-invites.md
related:
  - second-brain/01_projects/conversational-channels.md §«Conversational Channels β-1 — Telegram + MAX adapters»
  - plans/tz/2026-05-25-telegram-bot-global-and-invites.md (β-9 — глобальный бот, основа на которой строится)
  - plans/archive/2026-05-21-sba-beta-1-channels-telegram-max.md (β-1, базовый адаптер)
  - plans/archive/2026-05-23-sba-beta-1-telegram-max-zero-button-ripout.md (zero-button)
  - backend/src/modules/conversational/adapters/telegram-bot/telegram-api-client.ts
  - backend/src/modules/conversational/adapters/telegram-bot/telegram-webhooks.controller.ts
  - backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts
  - backend/src/modules/admin/system/telegram-bot/admin-telegram-bot.service.ts
  - backend/src/modules/ingest/adapters/telegram/telegram.service.ts
  - backend/src/modules/ingest/adapters/telegram/telegram.controller.ts
  - backend/src/modules/destinations/senders/telegram-bot.sender.ts
  - backend/scripts/setup-telegram-bot.ts
  - backend/src/common/config/env.schema.ts (TELEGRAM_BOT_API_BASE)
  - https://telegram.crossmark.ru/guide
  - https://telegram.crossmark.ru/docs
---

# ТЗ: Перевод Telegram-канала Z на проксирование через telegram.crossmark.ru

> **Тип:** ops/инфра + бэкенд-рефакторинг. Внешний пользовательский функционал
> не меняется (бот ведёт себя так же); меняется только транспорт «Z ↔ Telegram».

## 1. Цель и контекст

Z работает в дата-центре Новосибирска. Прямые исходящие к `api.telegram.org`
и входящие webhook'и от Telegram нестабильны/недоступны (региональные
блокировки, asymmetric reachability). До сих пор это было прикрыто
переменной окружения `TELEGRAM_BOT_API_BASE` (override base URL), но
ни один продакшен-инстанс не имеет рабочего прозрачного канала к
Telegram изнутри ДЦ.

Решение — пустить весь Telegram-трафик через сервис-прокси
**`https://telegram.crossmark.ru`** (далее — «прокси»):

- **Outbound** (Z → Telegram): все вызовы Bot API уходят в прокси, прокси
  ретранслирует в `api.telegram.org` со своей инфраструктуры (доступной к
  Telegram). Прокси прозрачный — каждый метод и каждый Content-Type, включая
  `multipart/form-data` (для отправки файлов).
- **Inbound** (Telegram → Z): прокси регистрирует у Telegram свой URL
  `https://telegram.crossmark.ru/webhook/<secret>`, принимает Update от
  Telegram и форвардит его на наш `targetWebhookUrl`, проставляя
  `X-Telegram-Bot-Api-Secret-Token`. Прокси гарантирует до 3 ретраев с
  возрастающей задержкой на не-2xx ответах нашего бэкенда.
- **Файлы** (`getFile` → download binary): URL вида
  `https://telegram.crossmark.ru/file/bot<token>/<file_path>` — drop-in для
  `https://api.telegram.org/file/...`.
- **Управление ботом в прокси:** веб-админка прокси либо JSON-API (`POST
  /auth/login` → JWT, далее `POST /api/bots` для регистрации бота с
  токеном и `targetWebhookUrl`).

Документация: [telegram.crossmark.ru/guide](https://telegram.crossmark.ru/guide),
[/docs](https://telegram.crossmark.ru/docs) (Swagger UI после логина).

> **Дисклеймер о название.** `crossmark` в URL прокси — публично доступный
> сервис, который мы используем как инфраструктуру. Это **другой**
> «Crossmark», не тот, что описан в
> [second-brain/01_projects/crossmark-integration.md](../../second-brain/01_projects/crossmark-integration.md)
> (видеосервис, встраивающий Z по API). Совпадение бренда — внешнее.

### 1.1. Почему «не привязываемся к текущей реализации»

Минимальная правка (поменять `TELEGRAM_BOT_API_BASE`) технически работает,
но оставляет несколько долгов:

1. `TelegramApiClient.downloadFile` строит URL руками — он повторяет
   `apiBase` корректно, но это случайность; намеренно отдельный
   `cfg.telegramBot.fileBase` сейчас не задан.
2. Регистрация webhook'а у Telegram (`setWebhook`) сейчас идёт прямо от
   нас (через прокси, который ретранслирует на `api.telegram.org`). После
   перехода прокси сам должен дёргать `setWebhook` со своей стороны (URL
   webhook'а должен указывать на прокси-роут, а не на нас). Иначе мы
   просим Telegram стучаться в нас напрямую — а нас оттуда не видно.
3. Управление токеном бота сейчас живёт **только** в `Channel.config`
   нашего канала. После перевода — прокси тоже должен знать токен (он
   делает запросы к Telegram от нашего имени). Появляется второй
   keeper-of-secret → нужен явный процесс регистрации бота в прокси.
4. CLI-скрипт `setup-telegram-bot.ts` бьёт `setWebhook` напрямую — это
   ломается, если он не имеет своего пути до Telegram.
5. Параллельная (и сейчас никем не используемая в проде глобального
   бота) ветка `backend/src/modules/ingest/adapters/telegram/*` — это
   другой Telegram-flow (Source/RawEvent ingest). Он тоже бьёт
   `api.telegram.org` напрямую — на проде сломан.
6. Метрики и логи ничего не различают «трансферный сбой между нами и
   прокси» vs «Telegram вернул ошибку через прокси». Это критично для
   on-call: при инциденте мы не понимаем, кого винить.
7. Документация в `second-brain/` ничего не говорит про прокси, и при
   потере оператора знание исчезает.

Поэтому план — **переписать транспортный слой Telegram сразу как
proxy-aware**, без переходных хаков. Конечный пользовательский функционал
бота (β-1 zero-button + β-9 глобальный бот) не меняется.

## 2. Scope

**Входит:**

Backend (Z):

- Полная замена транспорта в `TelegramApiClient`:
  - Новый базовый URL `cfg.telegramProxy.apiBase` (по умолчанию
    `https://telegram.crossmark.ru`) для всех Bot API-вызовов.
  - Явный отдельный `cfg.telegramProxy.fileBase` (обычно равен `apiBase`,
    но выделен в код — на случай разнесённого CDN для файлов).
  - Опциональный header `User-Agent: KoraBackend/<ver>` и
    `X-Request-Id: <reqId>` для трассируемости.
- Удаление `setWebhook` / `deleteWebhook` из ответственности нашего
  бэкенда (`TelegramApiClient.setWebhook/deleteWebhook` помечаются как
  deprecated и используются только legacy-скриптом `setup-telegram-bot.ts`
  через ENV-флаг `LEGACY_TELEGRAM_DIRECT=true`; в норме — не вызываются).
  Регистрация webhook'а у Telegram — обязанность прокси.
- Новый сервис `TelegramProxyAdminClient` — тонкий REST-клиент к админ-API
  прокси (`/auth/login`, `/api/bots`, `/api/bots/:id`, опционально
  `/api/bots/:id/deliveries` для просмотра логов доставок).
  - Автологин: при первом обращении делает `POST /auth/login`
    с `TELEGRAM_PROXY_ADMIN_EMAIL` + `TELEGRAM_PROXY_ADMIN_PASSWORD`,
    кэширует JWT в Redis с TTL = `(exp - 60s)` (без RW-state в процессе,
    чтобы воркер и HTTP-нода не дрались).
  - Re-login на `401` (один раз на запрос).
- Обновление `AdminTelegramBotService` (`/admin/system/telegram-bot`):
  - Кнопка «Перенастроить webhook» меняет роль: не дёргает `setWebhook`,
    а вызывает `TelegramProxyAdminClient.upsertBot({ token,
    webhookSecret, targetWebhookUrl })`. Прокси сам пойдёт в Telegram.
  - Новые поля в UI: текущий статус регистрации в прокси (`registered:
    bool`, `proxyBotId: string`, `lastDeliveryAt: datetime?`,
    `lastTelegramWebhookInfo: {url, has_custom_certificate,
    pending_update_count, last_error_message}`).
  - Получение `webhookInfo` теперь через прокси (drop-in через apiBase).
- Унификация двух Telegram-веток:
  - `backend/src/modules/ingest/adapters/telegram/*` переписывается на тот
    же `TelegramApiClient` (либо удаляется и переезжает на
    `TelegramBotChannelAdapter`, если функционально равны — см. §3
    «Принятые решения»).
  - `backend/src/modules/destinations/senders/telegram-bot.sender.ts`
    переходит на тот же `TelegramApiClient` (сейчас, по beat-у в
    skeleton'е, имеет свой `send` — проверить).
- Кэш `Channel.config` в `TelegramWebhooksController.findGlobalChannel`
  получает invalidation по событию `channel.updated` (через Redis
  pub/sub `conversational:channel:updated:telegram_bot`), чтобы смена
  токена/секрета в админке поднималась воркерами/HTTP-нодами без
  рестарта.
- Метрики:
  - `telegram_proxy_request_total{api_method, outcome}` —
    `outcome ∈ ok|proxy_5xx|proxy_4xx|telegram_5xx|telegram_4xx|network`.
  - `telegram_proxy_request_duration_seconds{api_method}` — histogram.
  - `telegram_proxy_admin_login_total{outcome}` — `outcome ∈ ok|invalid_creds|network`.
  - `telegram_proxy_admin_bot_upsert_total{outcome}` — `outcome ∈ ok|conflict|invalid|network`.
  - `telegram_webhook_received_total{source}` — `source ∈ proxy|direct|unknown` (для контроля, не пришёл ли кто прямо через `api.telegram.org` мимо прокси).
- Логирование:
  - Каждый outbound-вызов: `{tg_method, status, durationMs, errorCode?}` через pino.
  - Каждый inbound webhook: `{updateId, source, hasSecretHeader, ok}`.
- Health-check:
  - `/health` агрегирует новый `telegram_proxy_health` — пытается
    `GET https://telegram.crossmark.ru/` (HEAD) каждые 30с (in-process
    bull cron) и кэширует результат в `telegramProxyHealthy: bool` для
    `/health`. Не блокирует readiness (Telegram — non-critical
    dependency).

Frontend (Z):

- `app/(admin)/admin/system/telegram-bot/page.tsx`:
  - Подсказка «Бот зарегистрирован в прокси на: \<URL прокси\>» с
    индикатором (зелёный / жёлтый / красный) актуального статуса.
  - Кнопка «Перерегистрировать в прокси» (вызывает обновлённый
    `PUT /admin/system/telegram-bot/webhook`).
  - Кнопка «Проверить прокси сейчас» (вызывает новый `POST
    /admin/system/telegram-bot/ping`, который дёргает прокси `/healthz`
    или `/auth/login` с правильными кредами и возвращает выпускной отчёт).
  - Раздел «Последние доставки webhook'ов» (опционально, фаза 5) —
    список из прокси `/api/bots/:id/deliveries` (если этот endpoint
    существует у прокси). Если нет — секцию скрываем.

Конфигурация и эксплуатация:

- ENV-переменные (см. §9).
- Документация в `second-brain/01_projects/conversational-channels.md`
  расширяется разделом «Транспорт через telegram.crossmark.ru».
- Раздел Troubleshooting в `docs/operations/`.

**Не входит:**

- Перенос MAX-бота (он живёт в своей стране, у нас работает прямой канал
  до `platform-api.max.ru`; если потребуется — отдельное ТЗ).
- Замена самой `Channel.config`-схемы (формат остаётся, добавляются только
  необязательные поля `proxyBotId`, `proxyRegisteredAt`).
- Развёртывание self-hosted экземпляра прокси (рассматриваем как
  бэкап-вариант; будет отдельное ТЗ если решим перейти на self-hosted).
- Отказ от шифрования токена в `Channel.config` — он остаётся через
  `CryptoService`.
- Новые продуктовые фичи бота (это чисто транспорт).
- Миграция legacy CLI-скрипта `setup-telegram-bot.ts` на прокси —
  оставляем как legacy fallback (см. §3).

## 3. Принятые решения

1. **Используем публичный hosted-экземпляр `telegram.crossmark.ru`, не
   self-hosted.** Причина: time-to-market. Self-hosted появится отдельным
   ТЗ когда (а) появится явный SLA-инцидент или (б) служба безопасности
   потребует контроля над инфрой. До этого момента — экономим на
   эксплуатации.
2. **Один аккаунт прокси на весь Z, один зарегистрированный бот.** Это
   согласуется с β-9 (один глобальный бот `@kora_bot`). Регистрация
   через веб-админку прокси разово, дальше всё через нашу
   `/admin/system/telegram-bot`.
3. **Кредениалы аккаунта прокси хранятся в `ENV`, не в `Channel.config`.**
   Причина: это оперативный секрет уровня инфры (как ключ S3 или
   `DATABASE_URL`), не уровня бизнес-настроек tenant'а. Тот же admin
   потом может ротировать пароль прокси без захода в код.
4. **JWT прокси кешируется в Redis (`tg:proxy:admin:jwt`) с TTL ≈ срок
   жизни токена − 60с.** Не в process-memory: иначе разные ноды/воркеры
   будут спамить логин. На `401` — один re-login per request, дальше
   пробрасываем как ошибку.
5. **`TELEGRAM_BOT_API_BASE` остаётся, но дефолт меняется на прокси.**
   Это даёт гибкость: dev может выставить `https://api.telegram.org`
   локально, если у него есть доступ. Прод — всегда прокси.
6. **`X-Telegram-Bot-Api-Secret-Token` остаётся единственным механизмом
   аутентификации входящего webhook'а от прокси.** Дополнительной
   аутентификации «прокси сам себя представляет» не вводим — она была бы
   приятной, но прокси (на основе доступной документации) её не
   предоставляет. Это компромисс безопасности: если злоумышленник
   получит `webhookSecret`, он сможет писать нам мусор от имени
   Telegram. Митигация: `webhookSecret` — 256-битный, ротируется при
   каждом «Перерегистрировать в прокси», sha256-хэш логируется (не сам
   секрет).
7. **Идемпотентность outbound:** Telegram Bot API не имеет
   `Idempotency-Key`. Наш `ConversationalSendWorker` уже различает
   transient/final ошибки и ретраит экспоненциально; прокси добавляет
   свои 3 ретрая → возможны двойные доставки при network-flap.
   Митигация: в `SenderMessage` добавляем `deliveryId` (уже есть как
   `NotificationDelivery.id`), и при повторе на одной и той же
   `Delivery` мы пере-`sendMessage` — Telegram сам сделает duplicate
   detection только если мы используем `disable_notification` или нет.
   На MVP — принимаем редкие дубликаты как known issue, фиксируем в
   `code-pitfalls.md`. Если станет проблемой — закладываем de-dup на
   уровне adapter'а через Redis `tg:sent:delivery:<id>` с TTL 24ч.
8. **`setMyCommands` мы по-прежнему дёргаем сами через прокси (drop-in).**
   Прокси на это смотрит как на обычный proxy-call, особой обработки не
   нужно. В `TelegramBotChannelAdapter.onModuleInit` это уже происходит
   — кода не трогаем, только URL поменяется.
9. **`setWebhook` ровно один раз настраивается прокси при регистрации
   бота.** Дальнейшие изменения (например, ротация
   `webhookSecret`) идут через `PUT /api/bots/:id`, а уже прокси сам
   решит, нужно ли заново звать `setWebhook` у Telegram. Этим
   избавляемся от race condition «два бэкенда дёргают setWebhook
   параллельно».
10. **Ingest-ветка (`modules/ingest/adapters/telegram/*`) и
    destinations-sender (`modules/destinations/senders/telegram-bot.sender.ts`)
    переводим на тот же `TelegramApiClient`.** Аргумент: единая точка
    транспорта — один контроль качества (метрики, ретраи, throttling).
    Дублирующиеся реализации `callBotApi` удаляем. Если ingest-ветка
    окажется в проде не-востребованной (по `git blame` + проверке Source
    в БД) — удаляем её целиком в этой же итерации.
11. **Поддерживаем deprecated direct mode.** Если установить
    `TELEGRAM_PROXY_ENABLED=false` (явный override), `TelegramApiClient`
    бьёт `api.telegram.org` напрямую (старое поведение), и
    `setWebhook` дёргает наш бэкенд. Нужно для (а) локального dev'а с
    тестовым ботом и (б) аварийного rollback'а если прокси упадёт
    надолго. По умолчанию `true` в проде.
12. **TelegramProxyAdminClient не использует cron автообновления JWT.**
    Re-login происходит ленитьно: первый запрос проверяет TTL в Redis,
    если меньше 60с — заранее обновляет. Это убирает «нолевой» сбой
    после рестарта прокси без перерасхода ресурсов.
13. **Прокси-аккаунт регистрируется руками один раз** через веб-форму
    `https://telegram.crossmark.ru/register`. Автоматизация регистрации
    через CLI — out of scope (не нашли публичного `/auth/register`-эндпоинта
    в Swagger guide; если найдётся — добавим в Фазе 7 как nice-to-have).
14. **Тип Update от прокси идентичен Telegram Update.** Прокси заявляет
    «forwards body as-is» — наша Zod-схема `TelegramUpdate` не меняется.
    На случай если прокси добавит обёртку — выносим парсинг в
    `parseProxyWebhookBody(raw)`, чтобы было одно место правки.

## 4. Зависимости

- β-9 (`done`) — глобальный бот, `Channel(tenantId IS NULL,
  kind='telegram_bot')`. Основа для регистрации в прокси.
- α-1 (`done`) — `ConversationalService`, `ChannelBinding`, очередь
  `conversational.send` и `ConversationalSendWorker`.
- `common/crypto` (`done`) — `CryptoService.encrypt` для шифрования
  токена бота в `Channel.config` (без изменений).
- `common/redis` (`done`) — для кэша JWT и кэша `Channel` invalidation.
- `common/metrics` (`done`) — `BusinessMetricsService` для новых
  метрик.
- Внешний сервис: `telegram.crossmark.ru` живой и доступен из ДЦ
  Новосибирска (предполагаем; проверяем в Фазе 1 пингом из staging).

## 5. Изменение схемы базы данных

Минимальное. Добавляются опциональные поля в `Channel.config`-JSON
(без миграции схемы Prisma, т.к. `Channel.config` — `Json`):

```typescript
// shape Channel.config для kind='telegram_bot'
type TelegramBotChannelConfig = {
  botToken: string;                  // encrypted via CryptoService
  webhookSecret: string;             // 256-bit hex
  // NEW:
  proxyBotId?: string;               // ID бота в прокси (из POST /api/bots → id)
  proxyRegisteredAt?: string;        // ISO timestamp последнего upsert в прокси
  proxyLastSyncError?: string | null;// если последний upsert упал — текст ошибки
  // legacy (для отката):
  legacyTenantId?: string;           // оставлено от β-9
};
```

Никакого `prisma:push` не требуется. Поля валидируются Zod-схемой
`telegramBotChannelConfigSchema` в коде адаптера (она уже есть, нужно
расширить).

## 6. Patch / миграция данных

One-off скрипт **`backend/scripts/patch-telegram-register-in-proxy.ts`** —
регистрирует уже-настроенного глобального бота в прокси. Идемпотентен.

Логика:
1. `createPrismaClient()` из `_lib/prisma.ts`.
2. Найти `Channel WHERE tenantId IS NULL AND kind='telegram_bot'`. Если
   нет → лог «глобального бота нет, настройте его в админке, потом
   запустите снова», `exit 0`.
3. Прочитать `config.botToken` (decrypt) и `config.webhookSecret`.
4. Логин в прокси через `TELEGRAM_PROXY_ADMIN_EMAIL/PASSWORD`.
5. `GET /api/bots?token=<masked>` или `GET /api/bots` + локальная
   фильтрация — найти, существует ли уже бот с этим токеном.
6. Если нет — `POST /api/bots` с `{ token, secret_token, target_url:
   <Z public URL>/api/v1/webhooks/telegram-bot }`. Сохранить `id` в
   `Channel.config.proxyBotId`, `proxyRegisteredAt = now()`.
7. Если есть — `PUT /api/bots/:id` с теми же полями (drift-correction).
8. Логировать каждый шаг.
9. Запуск: `docker compose exec backend bun run scripts/patch-telegram-register-in-proxy.ts`.

Регистрируется в агрегаторе `backend/scripts/apply-prod-deploy.ts` с
`phase: 'patch'`, `skipBootstrap: true` (на свежем выкате прокси-бота
ещё нет → канал создаётся через админку → скрипт запускается вручную
после).

## 7. REST API

Новые / изменённые эндпоинты (все DTO через `nestjs-zod`, Swagger
обязателен):

| Метод | Путь | Назначение | Доступ |
|---|---|---|---|
| `GET` | `/api/v1/admin/system/telegram-bot` | (existing) — расширяется полями `proxyBotId`, `proxyRegisteredAt`, `proxyHealthy`, `proxyWebhookInfo` | super-admin |
| `PUT` | `/api/v1/admin/system/telegram-bot/webhook` | (existing) — переводится на вызов `TelegramProxyAdminClient.upsertBot` вместо `setWebhook` напрямую | super-admin |
| `POST` | `/api/v1/admin/system/telegram-bot/ping` | (NEW) — синхронный пинг прокси (`GET /healthz` или `getMe` через прокси), возвращает diagnostic-объект | super-admin |
| `GET` | `/api/v1/admin/system/telegram-bot/deliveries` | (NEW, опц.) — последние 100 доставок из прокси (если прокси отдаёт `/api/bots/:id/deliveries`) | super-admin |
| `POST` | `/api/v1/webhooks/telegram-bot` | (existing) — без изменений. Просто теперь источник — прокси, не Telegram напрямую. | публичный (verify `X-Telegram-Bot-Api-Secret-Token`) |
| `POST` | `/api/v1/webhooks/telegram-bot/:tenantId` | (existing legacy) — без изменений. После 30 дней удаляем. | публичный |

Изменений в публичных эндпоинтах для users/кабинета директора — **нет**.

## 8. BullMQ worker'ы и cron'ы

Новые:

- `telegram-proxy-health.cron` — раз в 30 секунд (`@Cron('*/30 * * *
  * *')`), один лидер по `bull-locker:tg-proxy-health` (через
  существующий `ProcessLeaderService` или Redis SETNX с TTL).
  Делает `fetch(${cfg.telegramProxy.apiBase}/`, HEAD, 5с timeout)`,
  пишет результат в Redis `tg:proxy:healthy` с TTL 70с (на 2 пропуска
  cron'а). Метрика `telegram_proxy_health_check_total{outcome}`.

Существующие — без изменений:

- `ConversationalSendWorker` (он по-прежнему вызывает
  `TelegramBotChannelAdapter.send`, который под капотом
  `TelegramApiClient.sendMessage` — base URL уже прокси).
- `TelegramDigestCron` — тот же путь.

## 9. ENV переменные

Новые:

| Имя | Тип | Default | Назначение |
|---|---|---|---|
| `TELEGRAM_PROXY_ENABLED` | boolean | `true` | Главный switch. `false` — bypass прокси, прямой `api.telegram.org`. Аварийный rollback. |
| `TELEGRAM_PROXY_API_BASE` | URL | `https://telegram.crossmark.ru` | Базовый URL прокси (для outbound Bot API). |
| `TELEGRAM_PROXY_FILE_BASE` | URL | `https://telegram.crossmark.ru` | База для `/file/bot<token>/<path>` (обычно совпадает с `apiBase`). |
| `TELEGRAM_PROXY_ADMIN_EMAIL` | string | — (required) | Email учётки прокси. |
| `TELEGRAM_PROXY_ADMIN_PASSWORD` | secret string | — (required) | Пароль учётки. Логируется в маске. |
| `TELEGRAM_PROXY_ADMIN_JWT_PREFETCH_SEC` | int | `60` | За сколько секунд до `exp` обновлять JWT. |
| `TELEGRAM_PROXY_REQUEST_TIMEOUT_MS` | int | `15000` | Timeout каждого вызова к прокси. |
| `TELEGRAM_PROXY_HEALTH_INTERVAL_SEC` | int | `30` | Интервал health-check'а прокси. |

Изменяемые:

| Имя | Было | Стало | Комментарий |
|---|---|---|---|
| `TELEGRAM_BOT_API_BASE` | `https://api.telegram.org` (default) | `https://telegram.crossmark.ru` (default, **если** `TELEGRAM_PROXY_ENABLED=true`) | Совместимость: если выставлен явно — побеждает явно выставленное. |

Все правки идут в `backend/src/common/config/env.schema.ts` и
`typed-config.service.ts`. Согласно правилам Z, в коде использовать
только `cfg.telegramProxy.*` / `cfg.telegramBot.*`, никаких прямых
`process.env`.

## 10. Frontend

`frontend/src/api/admin-system-telegram-bot.api.ts` и
`frontend/src/domain/admin-telegram-bot.ts` (слои ApiDto → DomainModel
→ UiModel по `frontend-rules`):

- DTO расширяется полями `proxyHealthy`, `proxyBotId`, `proxyRegisteredAt`,
  `proxyLastSyncError`, `proxyWebhookInfo`.
- `useTelegramBotSettings` (SWR) автоматически перерисовывает UI.

Страница `app/(admin)/admin/system/telegram-bot/page.tsx`:

- Карточка «Прокси»:
  - Зелёный/жёлтый/красный индикатор (по `proxyHealthy`).
  - Текст: «Бот зарегистрирован в прокси: \<маска токена\> →
    \<targetWebhookUrl\>».
  - Кнопка «Перерегистрировать в прокси» (`PUT /webhook`).
  - Кнопка «Проверить прокси сейчас» (`POST /ping`) с инлайн-результатом.
- Карточка «Webhook у Telegram» (через прокси):
  - `getWebhookInfo` (через apiBase прокси) — показывает
    `pending_update_count`, `last_error_message`, `last_error_date`.
- Карточка «Последние доставки» (Фаза 5, опционально):
  - Таблица из 100 записей с `update_id`, `delivered_at`,
    `http_status`, `attempts`, `latency_ms`.

UI весь на русском, по правилам `feedback_admin_ui_russian_only`.

## 11. Фазы реализации

**Фаза 1 — Конфиг и фундамент (полдня).** ✅

- Расширить `env.schema.ts` новыми ENV (см. §9).
- Добавить `cfg.telegramProxy.*` в `TypedConfigService`.
- Создать заглушку `TelegramProxyAdminClient` (только `login`).
- `cd backend && bun run typecheck && bun run test:unit` — должно
  собираться без изменения поведения.
- Деплой staging со включённым `TELEGRAM_PROXY_ENABLED=true`, ручной
  smoke: `getMe` через прокси (curl от worker'а).

**Фаза 2 — Outbound через прокси (1 день).** ✅

- В `TelegramApiClient` заменить `cfg.telegramBot.apiBase` на
  приоритет: `if (cfg.telegramProxy.enabled) cfg.telegramProxy.apiBase
  else cfg.telegramBot.apiBase`. Аналогично для `downloadFile` →
  `fileBase`.
- Добавить новые метрики (`telegram_proxy_request_*`).
- Unit-тесты `telegram-api-client.spec.ts`: проверить, что при `enabled`
  все URL'ы строятся через прокси; при `enabled=false` — старое
  поведение.
- Тестовая отправка `sendMessage` с тестовым ботом → проверить, что
  пришло в Telegram-чат.

**Фаза 3 — Admin-клиент прокси и регистрация бота (1.5 дня).** ✅

- Реализовать `TelegramProxyAdminClient`:
  - `login()` → JWT, кэш в Redis.
  - `upsertBot({ token, secretToken, targetUrl })`.
  - `getBot({ token })` (для поиска существующего).
  - `getDeliveries({ botId, limit })` (опц.).
- Переписать `AdminTelegramBotService.resetWebhook` на использование
  `TelegramProxyAdminClient.upsertBot` вместо `setWebhook`.
- Скрипт `patch-telegram-register-in-proxy.ts` (см. §6).
- Регистрация в `apply-prod-deploy.ts`.
- Unit-тесты.

**Фаза 4 — Inbound + Webhook secret rotation (полдня).** ✅

- Убедиться, что `TelegramWebhooksController` принимает webhook от
  прокси с правильным `X-Telegram-Bot-Api-Secret-Token` (теоретически
  без правок, но добавить интеграционный тест с моковым прокси).
- При ротации `webhookSecret` через `/admin/.../webhook` — `upsertBot`
  с новым secret'ом, затем pub/sub `channel:updated` для invalidation
  кэша `findGlobalChannel`.
- Integration-тест.

**Фаза 5 — Frontend и observability (1 день).** ✅

- Расширить DTO/Domain/UI в admin-странице (см. §10).
- Добавить кнопку «Проверить прокси сейчас» + `POST /ping` endpoint.
- Health-cron + `/health` dependency status.
- Dashboard в Grafana (если есть стандартный) — добавить новые метрики.

**Фаза 6 — Унификация ingest и destinations (1 день).** ✅

- Проверить, используется ли `modules/ingest/adapters/telegram/*` в
  продакшене (`SELECT count(*) FROM sources WHERE adapter='telegram'`).
  - Если 0 → **удалить** модуль целиком (включая
    `migrate-telegram-channels-back.ts` если он не нужен после удаления
    легаси).
  - Если >0 → переписать `TelegramAdapterService` на использование
    `TelegramApiClient` (только base URL, ретраи, throttling).
- `modules/destinations/senders/telegram-bot.sender.ts` — переписать
  `send` на `TelegramApiClient.sendMessage` (если он сейчас бьёт API
  напрямую).
- Тесты.

**Фаза 7 — Документация, прод-выкат и smoke (полдня).** 🟨 (документация — да, прод-выкат — за оператором)

- Обновить `second-brain/01_projects/conversational-channels.md` —
  раздел «Транспорт через telegram.crossmark.ru».
- Создать `docs/operations/telegram-via-proxy.md` (диагностика,
  rollback, ротация пароля прокси, ротация webhook-secret).
- Обновить `docs/operations/prod-deploy-log.md` — Шаг 1 (новые ENV),
  Шаг 6 (новый patch-скрипт), Шаг 12 (smoke grep на новые метрики).
- Выкат на прод, smoke-тест: отправить себе уведомление через
  глобального бота, проверить inbound (написать /start, получить
  привет).
- Рефлексия в `second-brain/05_история/`.

**Итого:** 5–6 рабочих дней одного разработчика. С обзорами и
непредвиденным — 1.5 недели календарных.

## 12. Команды сборки и проверки

После каждой фазы:

- `docker compose exec backend bun run typecheck`
- `docker compose exec backend bun run lint`
- `docker compose exec backend bun run test:unit`
- `cd frontend && bun run typecheck && bun run lint`

Перед merge финальной фазы:

- `docker compose exec backend bun run test:integration`
- `docker compose exec backend bun run test:e2e`
- `docker compose exec backend bun run build`
- `cd frontend && bun run build`

Smoke-чек (ручной, после выката на staging):

1. `curl -sf https://telegram.crossmark.ru/` → 200.
2. Логин в админку Z → `/admin/system/telegram-bot` → нажать «Проверить
   прокси сейчас» → ожидаем зелёный.
3. Из dev-Telegram-аккаунта написать боту `/start` → в Z приходит
   `dispatchInbound`, в Redis `tg:bot:rps:*` инкрементируется при
   ответе.
4. В Grafana — увидеть spike `telegram_proxy_request_total{outcome='ok'}`.

## 13. Откат (rollback)

**Сценарий А — прокси упал, бот не отвечает.**
1. В `/admin/system/telegram-bot` нажать «Выключить бота» (kill-switch,
   `ChannelStatus='global_disabled'` — есть с β-9). Бот замолкает для
   всех. Inbound webhook'и при этом всё равно вернут 404 (по существующей
   логике), Telegram сам через несколько попыток прекратит спамить.
2. Если задача — продолжать отправку, но через прямой канал (есть
   доступ к Telegram из бэкенда): выставить `TELEGRAM_PROXY_ENABLED=false`
   в ENV, рестартнуть backend и worker. Outbound пойдёт прямо в
   `api.telegram.org`. Inbound webhook от Telegram при этом не дойдёт
   (Telegram стучится в прокси) — нужно либо ручной `setWebhook` на
   прямой URL Z через CLI `setup-telegram-bot.ts --token=… --webhook=…`,
   либо смириться, что бот «слепо-глухой» на исходящие до восстановления
   прокси.

**Сценарий Б — прокси неправильно регистрирует webhook.**
1. Запустить `patch-telegram-register-in-proxy.ts` повторно (он
   идемпотентен).
2. Если не помогло — зайти в админку прокси
   (https://telegram.crossmark.ru), руками править `target_url`.

**Сценарий В — код провалился, нужно откатить релиз.**
1. `git revert` коммита и `docker compose up -d --build backend
   worker`.
2. Скрипт `patch-telegram-register-in-proxy.ts` остаётся применённым в
   проде, но без нового кода он просто игнорируется (поля
   `proxyBotId`/`proxyRegisteredAt` в `Channel.config` не читаются
   старым кодом, не мешают).

## 14. Открытые вопросы (для разработчика на этапе реализации)

1. **Точный путь и формат `POST /api/bots` в прокси.** На основании
   `/guide` понятен принцип (token + targetUrl), но конкретные поля
   запроса (`name`, `description`, `target_url` vs `webhook_url` vs
   `webhookUrl`, требуется ли `secret_token` или генерируется прокси)
   нужно проверить через Swagger UI прокси на этапе Фазы 3 (зайти на
   https://telegram.crossmark.ru/docs после регистрации аккаунта).
2. **Существует ли у прокси endpoint логов доставок** (`/api/bots/:id/deliveries`)?
   Если да — реализуем Фазу 5 секцию «Последние доставки»; если нет —
   убираем из UI без замены.
3. **TTL JWT прокси** — не указан в публичном гайде; в Фазе 1 при
   первом успешном логине декодировать payload (без верификации) и
   взять `exp` оттуда. Если `exp` отсутствует — по умолчанию
   `TELEGRAM_PROXY_ADMIN_JWT_PREFETCH_SEC = ttl_default - 60` где
   `ttl_default = 3600`.
4. **Поведение прокси при ротации `secret_token` без вызова
   `setWebhook`.** Если прокси сам не дёргает `setWebhook` у Telegram
   при `PUT /api/bots/:id`, нам нужно делать это самим через drop-in
   `setWebhook`. Уточняется в Фазе 3 экспериментом.
5. **Rate-limit прокси.** Не объявлен публично. На Фазе 2 — измерить
   на staging, выставить `cfg.telegramProxy.maxRps` если потребуется.
   Сейчас наш собственный `cfg.telegramBot.globalRps=25` остаётся как
   верхний потолок.
6. **CIDR прокси для allowlist на firewall'е Z.** Не публично известен.
   Решение: либо принимать webhook от любого источника (как сейчас, с
   проверкой `secret_token`), либо в Фазе 7 связаться с владельцем
   прокси за списком IP. На MVP — оставить без allowlist'а; пометить
   как тех-долг.
7. **`getFile` через прокси возвращает `file_path` в формате
   `<тот же путь>` или `<уже подменённый на прокси>`?** Проверить
   экспериментом в Фазе 2 (загрузить голосовое в тестовый бот, увидеть
   ответ `getFile`). Влияет на `downloadFile`-логику.

## 15. Критерии готовности (DoD)

- [ ] Все outbound-вызовы Bot API идут через прокси (проверяемо в
      Grafana — `telegram_proxy_request_total > 0`, `direct_telegram_request_total = 0`).
- [ ] Все inbound webhook'и приходят с `X-Telegram-Bot-Api-Secret-Token`,
      timing-safe верификация проходит.
- [ ] `/admin/system/telegram-bot` показывает зелёный статус прокси и
      позволяет кнопкой «Перерегистрировать» обновить регистрацию.
- [ ] Health-cron работает и обновляет `tg:proxy:healthy`.
- [ ] Patch-скрипт `patch-telegram-register-in-proxy.ts` зарегистрирован
      в `apply-prod-deploy.ts` и идемпотентен.
- [ ] Дев-канал получает /start, бот отвечает приветствием.
- [ ] Дев-канал получает sendMessage от бота при `notification.send`.
- [ ] `bun run typecheck/lint/test:unit/test:integration` — всё зелёное.
- [ ] Документация в `second-brain` обновлена.
- [ ] `docs/operations/prod-deploy-log.md` Шаги 1/6 обновлены.

## 16. Риски и митигации

| Риск | Вероятность | Влияние | Митигация |
|---|---|---|---|
| Прокси упал на >30 минут | Low | High (бот молчит) | Kill-switch + rollback на direct mode (см. §13). Health-cron алерт. |
| Прокси изменил API без warning | Med | Med (наш клиент ломается) | E2E-тест на staging раз в сутки (`telegram-proxy-e2e.cron`, опц.). |
| Утечка `webhookSecret` | Low | High (mock-инжекция) | Ротация по кнопке. 256-bit. Логи только sha256. |
| Утечка пароля прокси-аккаунта | Low | High (злоумышленник может перерегистрировать бота с подменённым `target_url`) | Хранение только в ENV-секрете (vault); ротация раз в квартал. Мониторинг `proxyRegisteredAt` — алерт при изменении не нами. |
| Двойная доставка outbound из-за ретраев прокси + наших | Med | Low (annoying, не критично) | Принимаем как known issue. В Фазе 7 → ТЗ на dedup если жалоб >5/мес. |
| Прокси задерживает inbound, наш cron-обработчик не успевает | Low | Med | `pending_update_count` мониторим в `getWebhookInfo` — алерт >50. |

## 17. Итог

**Реализовано (2026-05-26):**

- Фазы 1–6 — закрыты, `typecheck` / `lint` / тесты модулей зелёные.
- Backend: новый раздел `cfg.telegramProxy.*` в TypedConfig, `TelegramProxyAdminClient` (login/upsertBot/getBotByToken/apiRequest с retry-on-401/ping), переписан `TelegramApiClient` на `resolveApiBase()` с классификацией `outcome` для proxy-метрик, переписаны `AdminTelegramBotService.resetWebhook` (через `upsertBot`), `TelegramBotSender` и `TelegramAdapterService` (ingest) — на единый `TelegramApiClient`. Удалён дублирующий `callBotApi`.
- Inbound: `TelegramWebhooksController` теперь подписан на Redis pub/sub `conversational:channel:updated:telegram_bot` — кэш `globalChannelCache` сбрасывается без рестарта при ротации secret'а.
- Observability: метрики `telegram_proxy_request_*` (counter + histogram, outcome ∈ ok/proxy_4xx/proxy_5xx/telegram_4xx/telegram_5xx/network), `telegram_proxy_health_check_total{outcome}`. Health-cron каждые `TELEGRAM_PROXY_HEALTH_INTERVAL_SEC` (default 30с) пингует прокси, пишет `tg:proxy:healthy` в Redis. Лидер-выбор по `SET NX EX`.
- Admin API: `POST /api/v1/admin/system/telegram-bot/ping` (синхронный пинг), `GET ...` расширен полем `proxy: { enabled, apiBase, healthy, botId, registeredAt, lastSyncError }`.
- Frontend: новая секция «Прокси telegram.crossmark.ru» в `/admin/system/telegram-bot` (traffic-light + apiBase + botId + кнопка «Проверить прокси сейчас»). Тип `TelegramBotProxyStatusDomain` с computed `trafficLight: green|yellow|red|gray`.
- Patch-скрипт `backend/scripts/patch-telegram-register-in-proxy.ts` (идемпотентный) + регистрация в `apply-prod-deploy.ts` (phase: patch, skipBootstrap).
- Документация: `second-brain/01_projects/conversational-channels.md` — новый раздел «Транспорт Telegram через прокси». `docs/operations/prod-deploy-log.md` Шаг 1 (новые ENV), Шаг 6.11 (patch-скрипт), Шаг 12 (smoke-проверка прокси-метрик и health-cron).
- Тесты: 11 (`TelegramProxyAdminClient`) + 8 (`TelegramApiClient` proxy mode) + 5 (resetWebhook proxy/legacy + token_not_set + channel_not_configured) + 4 (`TelegramWebhooksController` pub/sub invalidation + onModuleDestroy). Всё зелёное в `bun run typecheck && lint && test:unit` в рамках telegram-bot модулей. Прежние тесты не сломаны.

**Что осталось (Фаза 7 — оператору):**

- Зарегистрировать аккаунт на https://telegram.crossmark.ru/register (один раз).
- Положить `TELEGRAM_PROXY_ADMIN_EMAIL/PASSWORD` в `.env` прода (см. Шаг 1).
- Запустить `docker compose exec backend bun run scripts/patch-telegram-register-in-proxy.ts` (Шаг 6.11) — он зарегистрирует уже-настроенного `@kora_bot` в прокси.
- Smoke по Шагу 12: проверить, что в админке зелёный индикатор прокси, метрики `telegram_proxy_request_total{outcome='ok'}` растут на каждом outbound, в Redis есть `tg:proxy:healthy=1`.

**Открытые вопросы (см. §14).** На исследование оператора при первом
прогоне на staging:

- Точная форма body `POST /api/bots` в прокси — наш клиент шлёт `{ token, secret_token, target_url }`, парсит ответ либерально (`id|_id|bot_id`, `target_url|targetUrl|webhook_url`). Если прокси отвергнет — точку правки концентрируем в `TelegramProxyAdminClient.upsertBot` и `parseBotInfo`.
- TTL JWT прокси — клиент декодирует `exp` без верификации; если поле отсутствует — кэшируется на 10 минут.
- Поведение прокси при ротации `secret_token` через `PUT /api/bots/:id` — вызывает ли он сам `setWebhook` у Telegram. Если нет — нужна ручная подстраховка.
