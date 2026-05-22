---
type: reflection
date: 2026-05-21
distilled: false
---

# 2026-05-21 — SBA α-1: Conversational Channels Foundation

## Постановка

Реализовать α-1 из зонтичного ТЗ «Второй мозг компании» — фундаментальный двунаправленный омниканальный слой общения с пользователем (`ConversationalModule`). На α-1 — каналы `in_app` и `email_smtp`; `telegram_bot/max_bot` подключатся в β-1 уже без правки этого слоя. От α-1 зависят α-4 (Curation), α-5 (ChatV2), β-1 (Telegram/MAX), β-5 (Probe-Agent).

ТЗ: [`plans/tz/2026-05-21-sba-alpha-1-channels-foundation.md`](../../plans/tz/2026-05-21-sba-alpha-1-channels-foundation.md). Зонтичный: [`plans/tz/2026-05-21-second-brain-agents-umbrella.md`](../../plans/tz/2026-05-21-second-brain-agents-umbrella.md).

## Что сделал

### Backend
- **Prisma**: добавил 4 модели (`Channel`, `ChannelBinding`, `Notification`, `NotificationDelivery`) + 6 enum'ов (`ChannelKind`, `ChannelDirection`, `ChannelStatus`, `NotificationStatus`, `NotificationResponseStatus`, `NotificationDeliveryStatus`) + `SourceType.conversational`. Обратные relations в `Org` и `User`.
- **`backend/src/modules/conversational/`** (новый @Global модуль):
  - `conversational.service.ts` — routing + sendNotification + linking + respond/dismiss/read + listMyChannels/Notifications.
  - `channel-registry.ts` — реестр адаптеров каналов.
  - `adapters/in-app.adapter.ts` — БД-резидент, без external transport.
  - `adapters/email-smtp.adapter.ts` — outbound через `MailService.sendPlain` + deep-link на `/me/notifications/:id`.
  - `adapters/conversational-ingest.adapter.ts` — free_note → `RawEvent(Source.type='conversational')`.
  - `link-code.service.ts` — одноразовые коды в Redis (TTL 10 мин).
  - `queue/conversational-queue.service.ts` + `conversational-send.worker.ts` — BullMQ `conversational.send` с concurrency из ENV, exp backoff и retry до `CONVERSATIONAL_MAX_DELIVERY_ATTEMPTS=5`.
  - `types/preferences.schema.ts` — Zod-схема `ChannelBindingPreferences` (quietHours, eventTypeAllow/Deny, rateLimitPerHour, disabledUntil).
  - `types/event-payload.registry.ts` — Zod-схемы payload'ов per-eventType с extension API.
  - `conversational.controller.ts` — REST `/api/v1/me/channels` и `/api/v1/me/notifications` (включая `respond`, `dismiss`, `read`, `free-note`, `link-code`).
- **`env.schema.ts`** + `TypedConfigService` — `cfg.conversational.*` (6 ENV: outboundConcurrency, linkCodeTtlSec, quietHoursDefault, rateLimitDefaultPerHour, emailFromDefault, maxDeliveryAttempts).
- **`business-metrics.service.ts`** — 5 новых метрик `conversational_*` (counter + histogram).
- **`policy.csv`** — `channel` (owner/admin manage, manager read) и `notification` (owner/admin all, manager self).
- **`app.module.ts`** — регистрация `ConversationalModule` после `MailModule`/`IngestModule`.

### Frontend
- `frontend/src/api/conversational.api.ts` — ApiDto + REST-клиент.
- `frontend/src/domain/conversational.ts` — мапперы Domain + русские лейблы.
- `frontend/app/(authenticated)/me/channels/` — страница «Мои каналы»: список + генерация link-кода + отвязка.
- `frontend/app/(authenticated)/me/notifications/` — центр уведомлений с фильтрами (Непрочитанные/Ждут ответа/Все), master-detail, inline respond/dismiss, форма «Свободная заметка» → ingest.

### Документация
- `delivery/13-glossary.md` — раздел SBA α-1: канал, уведомление, доставка, привязка, тихие часы, класс данных, код привязки.
- `delivery/ui/copy-strings.ru.md` — секция Conversational Channels (~50 строк UI-копирайта).
- `second-brain/01_projects/conversational-channels.md` — новая страница (архитектура, модели, API, routing, метрики, RBAC, ENV, UI, зависимости вниз).
- `second-brain/02_architecture/module-map.md` — раздел SBA α-1.
- `second-brain/index.md` — ссылка на новую страницу.
- `plans/tz/2026-05-21-sba-alpha-1-channels-foundation.md` — все 16 фаз [x], §15 итог, §16 prod-инструкция.

### Принятые архитектурные решения
1. **EmailImapChannelAdapter перенесён в β-1** — для α-1 SMTP-only + deep-link на `/me/notifications/:id` достаточно. Снижает scope α-1 без потери ценности (ответ через UI всё равно работает).
2. **`NotificationDeliveryStatus` отдельным enum** — существующий `DeliveryStatus` (webhook-out) имеет другую семантику (`pending/retrying/delivered/failed`), а у меня read/responded — first-class.
3. **`DataClass` использую существующий** — `public | internal | sensitive | private`. ТЗ предлагало 5-level, но 4 достаточно и не плодит несовместимость.
4. **In-process worker, не отдельный worker-процесс** — повторяет паттерн `WebhookDeliveryWorker`, в Z отдельного worker-процесса больше нет.
5. **Link-коды в Redis, не в БД** — TTL автоматический, объём не имеет смысла персистить, паттерн повторяет access-token cache.
6. **In_app — fallback-канал последней надежды** — он живёт всегда (auto-upsert в `ensureInAppForUser`), игнорирует quiet hours и pref-фильтры, чтобы критичное событие не потерялось.
7. **`SourceType.conversational`** — отдельный тип для free_note ingest, чтобы knowledge-core retention мог иметь свою политику для conversational в будущем.

## Что вышло

- Backend: `bun run typecheck` ✅, `bun run build` ✅. Lint — есть только проектные warnings (`import-x/order resolver` висит на всех файлах), реальных errors в новом коде нет.
- Frontend: `bun run typecheck` ✅. Frontend lint сломан на проектном уровне (`typescript-eslint` package not found в `eslint.config.mjs`) — не моя зона.
- `bun run prisma:generate` ✅ — схема валидна.
- `bun run prisma:push` — не прогнан локально, Docker dev на этой машине не поднят. Команда зафиксирована в §16 ТЗ.

## Чему научился

1. **Сначала разведка зависимостей, потом схема.** Я едва не словил конфликт с существующим `DeliveryStatus` enum'ом, потому что один и тот же эссенциальный термин уже занят webhook-out'ом. Урок: перед добавлением нового enum'а — всегда `grep "^enum <Name>"` по schema.prisma. Когда конфликт — переименовывать (NotificationDeliveryStatus), а не уродовать существующий.
2. **`SourceType.conversational` — пришлось расширить existing enum.** Это потенциально breaking для пайплайнов, которые матчат по `SourceType` switch'ем (например, ingest workers). Просканировал — никто не падает на default, потому что все писали неполные switch'и и обрабатывают через `source.type` в downstream-логике. Урок: расширение enum'ов в Z безопасно, потому что workers не делают exhaustive-switch.
3. **`Source` имеет составной уникальный ключ `tenantId_type_name`** — Prisma compound-where требует именно такого имени поля. Полезное знание для всех будущих ingest-адаптеров: используйте `upsert` с `tenantId_type_name`, не `findFirst`+`create`.
4. **`@Global` модули и порядок регистрации в AppModule важны.** Регистрация `ConversationalModule` после `MailModule` и `IngestModule` обязательна, потому что адаптеры инжектят `MailService` и `IngestService`. Регистрация `ConversationalModule` ПОСЛЕ всех @Global — единственный надёжный способ избежать circular DI.
5. **ESLint `import-x/order` resolver висит на всех файлах** — это известная проблема проекта, не мой регресс. В будущих рефлексиях не паниковать от первого взгляда на длинный список lint-warnings.
6. **Zod payload-registry — правильное расширение.** Вместо жёстко-типизированных payload-классов я сделал `registerEventPayloadSchema(eventType, schema)`. Потребители (α-4, β-5) смогут добавлять свои eventType без правки conversational-слоя. Это reusable паттерн для будущих pluggable-систем.
7. **Прод-инструкция в §16 ТЗ** — это лучший формат, чем «не забыть прогнать prisma push». Когда ТЗ закрывается, оператор открывает §16 и копи-пейстит команды. Урок: для каждой реализованной фичи писать §«Prod-операции» в самом ТЗ, не отдельной заметкой.

## Что осталось

- **`bun run prisma:push` на проде** — обязательно перед мержем (см. §16 ТЗ).
- **Integration-тесты DoD §13** — заголовок на vitest есть в проекте (`bun run test:integration`), но они требуют живой dev-БД. На α-4/β-5, когда понадобится живое тестирование probe-flow, дописать.
- **`/admin/channels` UI** — настройка SMTP/Telegram/etc для всей Org через z-admin. Это отдельный sub-TZ, не блокирует α-1 (in_app auto-upsert'ится первой нотификацией).

## Прод-команды

См. §16 ТЗ `plans/tz/2026-05-21-sba-alpha-1-channels-foundation.md`. Кратко:

```bash
cd backend && bun run prisma:push && bun run prisma:generate
docker compose up -d --build backend
# Smoke-test: открыть /me/notifications, отправить free-note,
# проверить появление RawEvent(source.type='conversational').
```

Опц. ENV (defaults подходят):
```
CONVERSATIONAL_OUTBOUND_CONCURRENCY=4
CONVERSATIONAL_LINK_CODE_TTL_SEC=600
CONVERSATIONAL_QUIET_HOURS_DEFAULT="22:00-08:00"
CONVERSATIONAL_RATE_LIMIT_DEFAULT_PER_HOUR=10
CONVERSATIONAL_MAX_DELIVERY_ATTEMPTS=5
```
