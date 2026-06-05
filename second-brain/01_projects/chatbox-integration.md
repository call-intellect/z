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
синк (BullMQ chatbox.sync + ручной POST .../sync)   ◄── realtime: webhook /webhooks/chatbox/:tenantId/:secret
   │  upsert по @@unique([tenantId, externalId])      └─ поллинг-фолбэк (cron hourly/daily)
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

- **Realtime** = webhook ChatBox + редкий поллинг-фолбэк (вебхуки теряются — добор поллингом). Режимы синка: `hourly` / `daily` / `realtime`.
- **Мост в knowledge-core** — лениво создаётся один `Source(type='chatbox', name='ChatBox')` на org; одна сессия → один `RawEvent` (идемпотентность по `idempotencyKey`, повтор не плодит).

## Ключевые сущности и связи

- **`ChatboxIntegration`** — конфиг org (один на org): `tokenEnc` (AES-256-GCM, никогда не plain в API), `workspaceId`, `syncMode`, `status`, `webhookSecret`/`webhookExternalId`, метки последних синков.
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
| Р3 | **Realtime = webhook + поллинг-фолбэк.** | Webhook даёт мгновенность, поллинг — надёжность (вебхуки теряются). |
| Р4 | **Менеджеры: автосвязка `Member.email` → `Person`** (по совпадению email в той же org), остаток — ручной маппинг в UI. | Единая карточка сотрудника; email — стабильный ключ. |

## Privacy / безопасность

- Токен шифруется (`CryptoService`, AES-256-GCM), никогда не в API-ответе/логе.
- Каждый запрос tenant-scoped (`TenantGuard` + RBAC-ресурс `chatbox`).
- `dataClass='sensitive'` на ingest — клиентская переписка.
- **super_admin НЕ получает bypass на чтение текста переписки** (`ChatboxMessage.text`) — отдельный privacy-инвариант (R12).
- Kill-switch `AdminSetting chatbox.enabled` (дефолт true; false → синк-кроны и webhook молча no-op).
- Feature-flag тарифа `feature.chatbox` (дефолт OFF) гейтит и API, и пункт меню.

## Границы MVP / что в vNext

**Входит:** API-клиент, CRUD интеграции, движок синка + сессии, cron + inbound webhook, мост в knowledge-core + LLM-summary, исходящая отправка текста, веб-просмотр чатов с бейджами, автосвязка/маппинг менеджеров.

**Не входит (vNext, см. ТЗ §«Не входит» и реестр [[../04_не-сделано/README|не-сделано]]):**
- Создание чата с нуля из Коры (`POST /chats` ChatBox) — только отправка в существующий.
- Скачивание медиа (image/audio/video/file) в S3 — храним только `*Url`.
- Отправка нетекстовых сообщений (апстрим поддерживает только `TEXT`).
- Двусторонний PATCH правок клиентов/кастомеров обратно в ChatBox (Кора read-only по ним).
- Связка `ChatboxCustomer` с `Person`/`Entity` графа (только менеджеры↔Person).
- Аналитические дашборды по чатам (SLA, метрики ответов).

[[../index|← index]]
