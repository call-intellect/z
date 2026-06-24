---
title: ChatBox-интеграция — клиентские переписки из мессенджеров в память компании
status: living
covers: домен chatbox, синк ChatBox→Кора, сессии, мост в knowledge-core, исходящая отправка, маппинг менеджеров
date: 2026-06-05
relates_to:
  - plans/tz/2026-06-05-chatbox-integration.md
  - plans/analysis/2026-06-05-chatbox-integration-api-facts.md
---

# ChatBox-интеграция

> **Источник правды по контракту:** [`plans/tz/2026-06-05-chatbox-integration.md`](../../plans/tz/2026-06-05-chatbox-integration.md) (10 фаз) + факты API [`plans/analysis/2026-06-05-chatbox-integration-api-facts.md`](../../plans/analysis/2026-06-05-chatbox-integration-api-facts.md). Здесь — что работает по факту и почему так.
> Ветка `feature/chatbox-integration`. Затронутые архитектурные заметки: [[../02_architecture/module-map]] §«ChatBox-интеграция», [[../02_architecture/data-model]] §«ChatBox», [[ai-jobs]], [[workers-queues]], [[api-layer]], [[frontend-pages]].

## Что это и зачем (бизнес-смысл)

Переписки с клиентами в Telegram / MAX / WhatsApp / веб-виджете живут в стороннем сервисе **ChatBox** (`app.agent-lia.ru`, «Call Intellect: Чаты») и не попадают в «память компании» Коры — их нельзя анализировать LLM, искать, связывать с графом знаний, видеть в едином окне. Знания из диалогов теряются.

Решение: компания вводит токен ChatBox → Кора **зеркалит** (read-mostly) чаты/клиентов/менеджеров/сообщения в собственные таблицы, режет диалоги на сессии, скармливает их существующему pipeline `ingest → knowledge-core` для извлечения IdeaBlock/Entity, показывает чаты в вебе и даёт ответить клиенту из Коры. ChatBox остаётся источником правды о самих мессенджерах — Кора не подключает мессенджеры напрямую.

## Архитектура (домен `chatbox`)

Выделенный backend-домен `backend/src/modules/chatbox/` (а не запись в `Source.config`) — потому что чаты/сообщения/клиентов нужно типизированно хранить, фильтровать, показывать с бейджами и объединять клиента по мессенджерам. Образец модуля — `sources` (per-tenant config + AES-GCM шифрование секретов), точка входа AI — `IngestService.ingest` (не меняется).

### Поток данных

```
ChatBox API (app.agent-lia.ru)
   │  токен (AES-GCM в ChatboxIntegration.tokenEnc) + workspaceId
   ▼
синк (BullMQ chatbox.sync + ручной POST .../sync)   ◄── суточный cron (полночь) по AccessToken
   │  upsert по @@unique([tenantId, externalId])
   ▼
зеркало в БД (Channel / Customer / ChannelClient / Member / Chat / Message)
   │  сегментация по idle-gap (AdminSetting chatbox.session.idle_gap_hours, дефолт 12) ИЛИ CHAT_CLOSED
   ▼
ChatboxChatSession (seq, previousSessionId)
   │  analyze-worker: LLM-summary (taskType 'chatbox-summary') + подмешивание summary предыдущей сессии
   ▼
chatbox-ingest.service → RawEvent(sourceType='chatbox', dataClass='sensitive')
   ▼
knowledge-core (block-ingest подхватывает RawEvent сам, без изменений) → IdeaBlock + Entity + граф

Ответ менеджера: POST /chatbox/chats/:id/messages → ChatboxApiClient.sendMessage → ChatboxMessage(isOutboundFromKora=true)
```

- **Забор данных** = только суточный `chatbox-sync.cron.ts` (полночь) по AccessToken + ручной `POST .../sync`. Приём вебхуков убран 2026-06-19 (см. «Обновления» ниже). Поле `syncMode` оставлено, но по факту всегда `daily`.
- **Мост в knowledge-core** — лениво создаётся один `Source(type='chatbox', name='ChatBox')` на org; одна сессия → один `RawEvent` (идемпотентность по `idempotencyKey`, повтор не плодит).

## Ключевые сущности и связи

- **`ChatboxIntegration`** — конфиг org (один на org): `tokenEnc` (AES-256-GCM, никогда не plain в API), `workspaceId`, `syncMode` (де-факто всегда `daily`), `status`, метки последних синков. Колонки `webhookSecret`/`webhookExternalId` удалены 2026-06-19.
- **`ChatboxCustomer` ↔ `ChatboxChannelClient`** — **мультимессенджер-объединение клиента.** `Customer(1) ↔ ChannelClient(N)`: один человек, пишущий из Telegram и WhatsApp, — это один `Customer` с несколькими `ChannelClient`. Ключ объединения готовый (`customerId` от ChatBox) — не изобретаем склейку, переиспользуем апстрим.
- **`ChatboxChat` ↔ `ChatboxChatSession`** — чат зеркалится 1:1 (один `Chat` = один ChatBox `chat.id`), а для LLM режется на **сессии-сегменты**. Новая сессия при паузе > порога ИЛИ при `CHAT_CLOSED`; `previousSessionId` связывает сессии в цепочку; анализ учитывает summary предыдущих.
- **`ChatboxMessage`** — зеркало сообщений (sender/content типы, `*Url` медиа без скачивания, `isOutboundFromKora`).
- **`ChatboxMember`** — менеджер воркспейса; `linkedPersonId` (FK на `Person` Коры) + `linkMode` (auto/manual/none). В `Person` ничего не пишем — только читаем для автосвязки.
- **`ChatboxChannel`** — канал/мессенджер воркспейса; `channelType` хранится как **String** (ChatBox добавляет новые типы без нашего релиза; enum потребовал бы миграцию на каждый — неизвестный тип → бейдж «Другое»).

## Решения владельца (2026-06-05)

| # | Решение | Почему |
|---|---|---|
| Р1 | **Один ChatBox-workspace на org.** После ввода токена `GET /workspaces`, владелец выбирает один. `@@unique([tenantId])`. | Токен реселлерский (видит ~100 чужих воркспейсов) — тянуть всё опасно (утечка чужих данных). |
| Р2 | **Чаты — зеркало 1:1, сессии-сегменты для LLM** (новая сессия при паузе > порога ИЛИ `CHAT_CLOSED`, `previousSessionId`). | В ChatBox чат остаётся ACTIVE и копит сообщения сутками. «Новый чат на следующий день» моделируем сессией, а не новой записью — сохраняет связность треда. |
| Р3 | ~~**Realtime = webhook + поллинг-фолбэк.**~~ **Отменено 2026-06-19** — приём вебхуков убран, остался только суточный забор по AccessToken (вебхуки давали 403 при рассинхроне секрета, мгновенность не стоила операционной боли). | Было: webhook = мгновенность, поллинг = надёжность. Стало: суточного синка достаточно. |
| Р4 | **Менеджеры: автосвязка `Member.email` → `Person`** (по совпадению email в той же org), остаток — ручной маппинг в UI. | Единая карточка сотрудника; email — стабильный ключ. |

## Privacy / безопасность

- Токен шифруется (`CryptoService`, AES-256-GCM), никогда не в API-ответе/логе.
- Каждый запрос tenant-scoped (`TenantGuard` + RBAC-ресурс `chatbox`).
- `dataClass='sensitive'` на ingest — клиентская переписка.
- **super_admin НЕ получает bypass на чтение текста переписки** (`ChatboxMessage.text`) — отдельный privacy-инвариант (R12).
- Kill-switch `AdminSetting chatbox.enabled` (дефолт true; false → синк-крон молча no-op).
- Feature-flag тарифа `feature.chatbox` (дефолт OFF) гейтит и API, и пункт меню.

## Обновления (2026-06-08, ветка `chatboxFix`)

Доработки по факту использования (dev-прогон владельцем):

- **Тумблер AI-анализа per-integration.** Новое поле `ChatboxIntegration.analysisEnabled` (Boolean, **default false**, миграция `20260608200000_chatbox_analysis_enabled`). Крон анализа ([chatbox-analyze.cron.ts](../../backend/src/modules/chatbox/chatbox-analyze.cron.ts)) метёт сессии **только** для оргов с `analysisEnabled=true`. Смысл: синк зеркалит чаты всегда, но LLM (summary + мост в knowledge-core) не дёргается, пока владелец не включит анализ в UI. Тумблер в карточке «AI-анализ переписок» на странице интеграции.
- **Создание сотрудника из менеджера.** `POST /chatbox/members/:id/create-person` — создаёт `Person` из ChatBox-менеджера через `PersonsService.create` и привязывает (`linkMode='manual'`). Дедуп по email: если Person с таким email уже есть — связывает существующего, дубль не плодит. **Это ослабляет прежний инвариант «в Person ничего не пишем»** — теперь пишем, но только по явному действию владельца. UI — кнопка «Создать сотрудника» у несвязанных менеджеров.
- **Фикс контракта воркспейсов:** бэк отдаёт голый массив (фронт ждал `{workspaces}`); `listWorkspaces`/`upsert` теперь перебирают **все страницы** и оставляют только **OWNER/ADMIN** (реселлерский токен видит сотни чужих `USER`-воркспейсов).
- **Фикс лимита сообщений:** `ChatboxMessagesQuerySchema.limit` max 200→**500** (страница чата грузит весь тред).
- **Фикс jobId анализа:** `chatbox-analyze:${id}` → `chatbox-analyze-${id}` (BullMQ запрещает `:` в custom jobId).
- **UX чата:** лента — скролл-контейнер фикс. высоты (не скролл страницы), пометка отправителя (Клиент/Менеджер/ИИ-бот/Контроль) + имя, повышен контраст пузырей, экспорт переписки в `.txt`. Фильтр мессенджера в списке чатов — Select (был free-text).
- **Ссылка на профиль менеджера в сообщении:** `listMessages` резолвит `ChatboxMessage.senderExternalId` → `ChatboxMember.linkedPersonId` (батч, без N+1) и отдаёт `senderPersonId`; во фронте имя менеджера = ссылка на `/persons/[id]`. Клиент — пока без ссылки (у `ChatboxCustomer` нет страницы-профиля в Коре).

**Не сделано (vNext):** профиль/страница клиента (`ChatboxCustomer`) — сейчас клиент в сообщении только имя+бейдж, кликнуть некуда (нет роута карточки клиента).

## Обновления (2026-06-19, приём вебхуков убран)

ТЗ — [[../../plans/tz/2026-06-19-chatbox-remove-webhooks]]. Полностью удалён webhook-контур ChatBox: единственный способ забора — суточный `chatbox-sync.cron.ts` (полночь) по AccessToken.

- **Удалено:** `chatbox-webhook.controller.ts` (приёмник `POST /webhooks/chatbox/:tenantId/:secret`), методы `reconcileWebhook`/`ensureWebhook`/`removeWebhook`/`buildWebhookUrl` в `chatbox-integration.service.ts`, методы `createWebhook`/`deleteWebhook`/`listWebhooks` + интерфейс `ChatboxApiWebhook` в API-клиенте.
- **БД:** миграция `20260619120000_chatbox_remove_webhooks` дропает колонки `webhookSecret`/`webhookExternalId` и нормализует legacy `syncMode` (`hourly`/`realtime`) → `daily`. Enum `ChatboxSyncMode` и поле `syncMode` оставлены (де-факто только `daily`).
- **Прод-чистка:** `scripts/backfill-chatbox-unregister-webhooks.ts` снимает уже зарегистрированные вебхуки на стороне ChatBox через API (находит по URL `/api/v1/webhooks/chatbox/` или описанию «Кора»), идемпотентно, не падает на ошибке отдельного орга. Зарегистрирован в `apply-prod-deploy.ts` STEPS (`backfill`).
- **Причина:** вебхуки давали постоянный 403 `chatbox_webhook_invalid_secret` при рассинхроне секрета URL ↔ БД (кейс «Ооо луа»), а суточного забора по токену достаточно — мгновенность не стоила операционной боли. Фронт не менялся (визард и так хардкодит `daily`, realtime в UI не предлагался).

## Обновления (2026-06-23, клиенты переписки → Customer, а не Person)

ТЗ — [[../../plans/tz/2026-06-23-chatbox-customer-vs-manager-split]]. Клиент переписки — покупатель, а не сотрудник: он связывается с `Customer`/`Entity{type=customer}` графа знаний, а не с `Person`. Менеджеры (`ChatboxMember → Person`) НЕ менялись.

- **Клиент = `Customer`.** На ингесте сессии клиент авто-резолвится в `Customer`/`Entity{customer}` через `EntityResolutionService.findOrCreateCustomerEntity` (дедуп `externalCrmId` → strong-id → name); менеджер-исполнитель остаётся `Person`.
- **Колонки связки.** `ChatboxCustomer.linkedCustomerId` (FK → `Customer`) и `ChatboxChannelClient.linkedContactEntityId` (FK → `Entity`-контакт). Старый `linkedPersonId` — **DEPRECATED** (drop — vNext). Миграция `20260623071903_chatbox_customer_model` (новая модель `Customer` + enum `CustomerStatus` + ALTER chatbox-таблиц), см. [[../02_architecture/data-model]] §«Customer».
- **Сервис/эндпоинт.** `ChatboxCustomersService` переведён с `Person` на `Customer`: `createCustomerAndLink` / `linkCustomer(customerId)`, DTO отдаёт `linkedCustomer`. Эндпоинт `POST /chatbox/customers/:id/create-customer` (был `create-person`).
- **Справочник клиентов.** Read-only API `/api/v1/customers` (модуль `customers`, зеркало `vendors`) + страница `/customers` + пункт «Клиенты» в сайдбаре. FE-пикер клиента в `/chats` переключён на клиентов Коры. См. [[api-layer]], [[frontend-pages]].
- **Backfill.** `scripts/backfill-chatbox-customers-from-person.ts` переносит ChatBox-клиентов `Person{external}` → `Customer` (идемпотентно, зарегистрирован в `apply-prod-deploy.ts` STEPS `phase:'backfill'`).

## Групповые чаты (2026-06-24)

ТЗ — [[../../plans/tz/2026-06-24-chatbox-group-chats]]. Полная поддержка чатов с несколькими клиентами в одном треде.

- **Детекция `isGroup`.** `syncMessages` выставляет `ChatboxChat.isGroup=true`, если в чате >1 различного CLIENT `senderExternalId` (производный флаг, миграция `20260624160000_chatbox_chat_is_group`, см. [[../02_architecture/data-model]] §ChatboxChat). Backfill не нужен — детекция проставляет при ближайшем синке.
- **Участники с именами/ролями.** `getChat` (`GET /chatbox/chats/:id`) отдаёт `participants[]` (`{externalId, role, name, messageCount}`): имена резолвятся из зеркал `ChatboxChannelClient`/`ChatboxMember` по `senderExternalId`, роли из `ChatboxSenderType` (CLIENT→client / USER→manager / ASSISTANT→assistant / QUALITY_CONTROL→quality_control). `listMessages` тоже резолвит `senderName` из зеркал (per-message `sender.name` у ChatBox — NULL).
- **Go-forward авто-контакты.** `ChatboxCustomersService.autoLinkChannelClients` (вызов из `syncChannelClients`): каждый channel-client → `Entity{type=person}` (контакт) + `EntityLink(works_at)` к аккаунту-Customer (через `customerId`→`linkedCustomerId`→`Customer.entityId`), проставляет `ChatboxChannelClient.linkedContactEntityId`. Идемпотентно.
- **UI.** Бейдж «Группа» в списке `/chats` и шапке диалога; в шапке детальной — список участников (имя + роль + кол-во сообщений); в переписке — резолвленные имена отправителей.
- **vNext:** пофименная атрибуция сообщений группы в граф/задачи (`ingestSession`) — заглушка [[../../plans/tz/2026-06-24-chatbox-group-graph-attribution]].

## Границы MVP / что в vNext

**Входит:** API-клиент, CRUD интеграции, движок синка + сессии, суточный cron забора по AccessToken, мост в knowledge-core + LLM-summary (гейт `analysisEnabled`), исходящая отправка текста, веб-просмотр чатов с бейджами, автосвязка/маппинг менеджеров + создание Person из менеджера, связка клиента переписки с `Customer`/`Entity{customer}` графа (2026-06-23).

**Не входит (vNext, см. ТЗ §«Не входит» и реестр [[../04_не-сделано/README|не-сделано]]):**
- Создание чата с нуля из Коры (`POST /chats` ChatBox) — только отправка в существующий.
- Скачивание медиа (image/audio/video/file) в S3 — храним только `*Url`.
- Отправка нетекстовых сообщений (апстрим поддерживает только `TEXT`).
- Двусторонний PATCH правок клиентов/кастомеров обратно в ChatBox (Кора read-only по ним).
- ~~Связка `ChatboxCustomer` с `Person`/`Entity` графа (только менеджеры↔Person).~~ **Сделано 2026-06-23** — клиент связывается с `Customer`/`Entity{customer}` (`linkedCustomerId`), менеджер — с `Person`. См. §«Обновления (2026-06-23…)».
- Аналитические дашборды по чатам (SLA, метрики ответов).

## Задачи из переписки в триаже + fallback владельца (2026-06-22, ТЗ tasks-subsystem-unified-fix B2/B3)

- **B2 — единый триаж:** задачи из чата (`Task`) видны в триаже `/intake` (read-union in-memory) + промоут `Task→Issue` на triage. `Task` остаётся пред-слоем — это объединение НА ЧТЕНИЕ, без дубль-записи (полная унификация `Task`/`Issue` отложена). Kill-switch `tracker.chatboxTasksInTriageEnabled` (ON).
- **B3 — fallback владельца переписочной задачи:** `chatbox-analyze` ищет владельца owner→admin→any + метрика `z_chatbox_tasks_owner_missing_total` (владелец не нашёлся ни на одном шаге).
- **B4 — флаг извлечения задач вынесен в AdminSetting** (meeting-to-tracker-and-models-unified-fix B4, 2026-06-22): `chatbox.taskExtraction.enabled` (registry+seed, kill-switch ON; ENV `CHATBOX_TASK_EXTRACTION_ENABLED` — fallback). Выкл → переписка по-прежнему мостится в граф, но action items в `Task` не извлекаются. См. [[../../docs/operations/feature-flags]].
- ТЗ [`2026-06-22-tasks-subsystem-unified-fix`](../../plans/tz/2026-06-22-tasks-subsystem-unified-fix.md) (Блок B) + [`meeting-to-tracker-and-models-unified-fix`](../../plans/tz/2026-06-22-meeting-to-tracker-and-models-unified-fix.md) B4. Триаж — [[tracker]].

[[../index|← index]]
