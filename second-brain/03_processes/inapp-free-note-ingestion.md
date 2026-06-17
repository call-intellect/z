---
name: inapp-free-note-ingestion
title: Свободная заметка через in-app (Concierge / страница «Уведомления»)
trigger_type: user_action
status_overall: implemented
last_audited: 2026-05-29
owners_human:
  - продакт conversational-каналов
related_plans:
  - plans/archive/2026-05-21-sba-alpha-1-channels-foundation.md
related_projects:
  - 01_projects/conversational-channels.md
  - 01_projects/concierge-agent.md
  - 01_projects/ingest-and-sources.md
---

# Свободная заметка через in-app (Concierge / страница «Уведомления»)

> **Как читать:** разделы 1–4 — для не-программиста. Раздел 5 — для разработчика. Номера шагов синхронизированы.

## 1. О чём это (бытовой рассказ)

Сотрудник работает внутри платформы Z и хочет быстро поделиться мыслью — фактом, идеей, наблюдением. Не открывая встречу, не заводя задачу, не переключаясь в Telegram. Прямо в карточке клиента или на любой другой странице — короткая заметка «договорился с клиентом X на пятницу, оплачивает услугу 12 уровня».

Этот процесс — про то, что эта заметка не теряется в чате и не пропадает в личных записях, а **сразу попадает в память компании**: становится сырым событием для графа знаний, проходит через тех же специалистов (агентов), что и встречи, обогащает карточки клиентов и проектов, может стать решением, идеей или сигналом-проблемой.

Ключевое отличие от Telegram-канала: **здесь цепочка дотянута до конца**. Сотрудник нажимает «Отправить» — заметка падает в `RawEvent`, дальше идёт по обычному конвейеру памяти. В Telegram-боте для свободной заметки эта же цепочка прерывается (см. [[telegram-inbox-ingestion]] раздел 8).

**Где именно сейчас живёт ввод:** на странице `/me/notifications` — карточка «Свободная заметка» с большим полем ввода. Плавающий значок Concierge (`ConciergeFloatingButton`) — это AI-помощник для вопросов и команд, в него можно писать свободно, но он не записывает текст напрямую как заметку, а интерпретирует как запрос. Прямого «отправить как заметку» в Concierge нет — это явный gap, см. раздел 8.

## 2. Что запускает (триггер)

- **Тип:** действие пользователя в браузере (нажатие «Отправить»).
- **Что инициирует:** сотрудник заполнил textarea на странице `/me/notifications` (карточка «Свободная заметка»).
- **Технический источник:** `POST /api/v1/me/notifications/free-note` с `X-Org-Id` и cookie-сессией.

## 3. Шаги процесса (общий список)

1. **Пользователь открывает страницу `/me/notifications`** и видит карточку с полем для свободной заметки.
2. **Пишет текст** (минимум 1 символ, максимум по схеме), нажимает «Отправить».
3. **Frontend вызывает REST-эндпоинт** с текущей Org в заголовке.
4. **Backend гарантирует наличие источника** `Source(type='conversational', name='Свободные заметки')` для этой Org (lazy-upsert).
5. **Создаётся `RawEvent`** через `IngestService.ingest(...)` — дедуп по checksum payload'а; payload `{ kind: 'free_note', userId, text, metadata }`.
6. **Сырое событие попадает в очередь `core.raw-events`** и обрабатывается обычным конвейером (как заметка после встречи): нарезка `IdeaBlock`, обогащение `Entity`/`Card`, передача специалистам Слоя 3.
7. **Frontend показывает toast «Заметка отправлена в память компании»** и очищает поле.

## 4. Что получается на выходе

- **В БД:** один `RawEvent(sourceId=<conversational source>, sourceExternalId=null)` с payload `{ kind: 'free_note', userId, text, metadata }`.
- **Дальше по pipeline:** `IdeaBlock`, может стать `Decision`, `Insight`, `Idea`, обновить `Card` (карточку клиента / проекта).
- **Видно пользователю:**
  - Сразу — toast в правом нижнем углу страницы `/me/notifications`.
  - Через ~минуту — в `/knowledge/blocks` (новый IdeaBlock).
  - В контексте сущностей — на карточках клиентов / проектов / решений, к которым специалисты привязали заметку.

## 5. Технический разрез (по шагам)

| # | Шаг | Что делает технически | Где живёт код | Очередь / cron / эндпоинт | Записывает в БД | Статус |
|---|---|---|---|---|---|---|
| 1 | Открытие страницы | Next.js App Router рендерит `/me/notifications` → `NotificationsClient` загружает уведомления через `listMyNotifications` | `frontend/app/(authenticated)/me/notifications/NotificationsClient.tsx:1` | `GET /api/v1/me/notifications` | — | ✅ |
| 2 | Ввод текста | Компонент `FreeNoteCard` (та же страница, локальный state) | `frontend/app/(authenticated)/me/notifications/NotificationsClient.tsx:390` | — | — | ✅ |
| 3 | REST-вызов | `createFreeNote(orgId, text)` через `apiClient.post`, заголовок `X-Org-Id` | `frontend/src/api/conversational.api.ts:205` → `POST /api/v1/me/notifications/free-note`; контроллер: `backend/src/modules/conversational/conversational.controller.ts:252..275` | `POST /api/v1/me/notifications/free-note` | (через шаг 5) | ✅ |
| 4 | Lazy-upsert Source | `ConversationalIngestAdapter.ensureSource(tenantId)` создаёт/находит `Source(type='conversational', name='Свободные заметки', dataClass='internal', isActive=true)`; уникальность по `@@unique([tenantId, type, name])` | `backend/src/modules/conversational/adapters/conversational-ingest.adapter.ts:127..147` | inline в REST handler | `Source` (только на первой заметке Org) | ✅ |
| 5 | RawEvent ingest | `ConversationalIngestAdapter.ingestFreeNote(...)` → `IngestService.ingest({ sourceId, sourceExternalId: null, occurredAt, payload, dataClass: 'internal' })`; дедуп через `payloadChecksum` в IngestService | `backend/src/modules/conversational/adapters/conversational-ingest.adapter.ts:38..69`, `backend/src/modules/ingest/ingest.service.ts` | прямой вызов IngestService | `RawEvent` | ✅ |
| 6 | Pipeline графа | `IngestService` ставит RawEvent в `core.raw-events`, далее `BlockIngestWorker` нарезает `IdeaBlock`, специалисты 3-1..3-7 обогащают граф | `backend/src/modules/knowledge-core/...` | очередь `core.raw-events` → дальше по [[raw-event-to-graph]] | `IdeaBlock`, `Entity`, `Card` (через специалистов) | ✅ |
| 7 | Toast + очистка | `toast.success('Заметка отправлена в память компании.')`, `setText('')`, ре-валидация SWR-ключа списка уведомлений | `frontend/app/(authenticated)/me/notifications/NotificationsClient.tsx:407` | — | — | ✅ |

### 5.1 Структура данных

```
User: textarea «Свободная заметка»
  ↓ POST /api/v1/me/notifications/free-note { text, metadata? }
ConversationalController.createFreeNote
  ↓
ConversationalIngestAdapter.ingestFreeNote
  ├── ensureSource(tenantId) → Source(type='conversational', name='Свободные заметки')
  └── IngestService.ingest({ tenantId, sourceId, sourceExternalId: null, payload, dataClass: 'internal' })
       ↓ payload = { kind: 'free_note', userId, text, metadata }
       ↓ дедуп по payloadChecksum
RawEvent
  ↓ core.raw-events
BlockIngestWorker → IdeaBlock
  ↓ специалисты 3-1..3-7
Card / Decision / Insight / Idea (обогащается граф знаний)
```

### 5.2 LLM-вызовы внутри процесса

Внутри REST-цепочки LLM нет — это «тонкий» ingest. Все LLM-вызовы происходят дальше, в [[raw-event-to-graph]] (`block-ingest`, `entity-extract`) и в специалистах Слоя 3.

## 6. Точки отказа и наблюдаемость

**Prometheus метрики:**
- `conversational_inbound_total{kind='in_app', type='free_note'}` — не инкрементится для REST-пути (адаптер вызывается напрямую, минуя `ConversationalService.dispatchInbound`). Это известный пробел в наблюдаемости — см. раздел 8.
- Дальше по pipeline — стандартные `raw_event_*` / `block_ingest_*` метрики knowledge-core.

**BullMQ очереди:**
- `core.raw-events` — обработка ingest'нутого `RawEvent`.

**Логи:**
- `ConversationalIngestAdapter` (DEBUG: `ingestFreeNote tenantId=... rawEventId=... idempotent=...`).
- `IngestService` (стандарт ingest-пути).

**Известные грабли:**
- `sourceExternalId=null` означает дедуп только по checksum payload'а. Две идентичные заметки от одного юзера в одну секунду схлопнутся в один RawEvent. Это сознательное решение в адаптере (комментарий `backend/src/modules/conversational/adapters/conversational-ingest.adapter.ts:13..21`).
- `X-Org-Id` обязателен — без него `requireTenant` бросит 400 (`tenant_required`).

**Кнопки админки:**
- Нет специальной — заметка падает в общий поток RawEvent, видна в `/admin/platform/workers` → очередь `core.raw-events`.
- Источник `Свободные заметки` появится в `/admin/sources` (если страница есть; см. [[01_projects/ingest-and-sources]]).

## 7. Связанные процессы

- [[telegram-inbox-ingestion]] — параллельный канал ввода. **Важное расхождение:** в in-app цепочка дотянута до конца (REST → ingest), в Telegram `free_note` обработчик не зарегистрирован (handler не подписан в `ConversationalModule`).
- [[raw-event-to-graph]] — то, что происходит дальше с RawEvent.
- [[email-to-task]] — параллельный канал ввода с другим терминалом (задача, не граф знаний).
- [[notification-dispatch]] — обратное направление: исходящие уведомления из платформы пользователю.

## 8. Расхождения «задумано vs реализовано»

**Реализовано полностью:**
- Цепочка REST → RawEvent → core.raw-events → IdeaBlock работает на проде.
- Источник `Свободные заметки` единый per-Org (lazy-upsert).
- Идемпотентность через `payloadChecksum`.

**Не реализовано (gap):**
- **Concierge как точка ввода свободной заметки.** `ConciergeFloatingButton` / `ConciergeChat` (см. `frontend/src/ui/concierge/`) — это AI-помощник для вопросов и команд (SBA γ-2), не «отправить как заметку». Если пользователь напишет в Concierge «договорился с клиентом X на пятницу», заметка пройдёт через chat-v2 / agent-router, ответит модель, но в `RawEvent(kind='free_note')` это **не** превратится. Это противоречит бытовому ожиданию «плавающий значок — главная точка ввода» (см. `feedback_concierge_entry_visible_button`). Минимальный фикс: добавить кнопку «Сохранить как заметку» в подсказках Concierge с вызовом того же `POST /me/notifications/free-note`.
- **Метрика `conversational_inbound_total{kind='in_app', type='free_note'}`** не инкрементится: REST-эндпоинт вызывает адаптер напрямую, минуя `ConversationalService.dispatchInbound` (который дёрнул бы `incConversationalInbound`). Прямое сравнение объёма «in-app vs Telegram free_note» по Prometheus сейчас невозможно. Фикс: либо вызвать `dispatchInbound({type: 'free_note', ...})` после ingest, либо инкрементить метрику в самом адаптере.

**Реализовано иначе, чем в ТЗ:**
- В ТЗ α-1 предполагалось, что in-app free_note идёт по тому же пути `subscribeInbound('free_note', ...)` что и Telegram. На практике для in-app сделали короткий путь — REST вызывает `ConversationalIngestAdapter` напрямую. Это правильно (нет смысла гонять через очередь handler'ов), но создало неравенство между каналами: Telegram до сих пор ждёт регистрации handler'а (см. [[telegram-inbox-ingestion]] раздел 8).

**Реализовано, не описано в ТЗ:**
- Lazy-upsert `Source(type='conversational', name='Свободные заметки')` — каноничное имя зашито в коде (`ConversationalIngestAdapter.DEFAULT_SOURCE_NAME`). В ТЗ не было — добавилось в реализации α-1 как «один Source на канал per Org».

## 9. История изменений процесса

| Дата | Что изменилось | Коммит/рефлексия |
|---|---|---|
| 2026-05-29 | Карточка создана. Зафиксирован gap «Concierge ≠ free-note» и метрика. | этот документ |
| ~2026-05-21 | SBA α-1 — `POST /me/notifications/free-note`, `ConversationalIngestAdapter` | plans/archive/2026-05-21-sba-alpha-1-channels-foundation.md |
