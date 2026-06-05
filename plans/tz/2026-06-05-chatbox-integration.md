---
type: tz
status: ready-to-implement
feature: chatbox-integration
date: 2026-06-05
owner: Tozix (владелец)
relates_to:
  - plans/analysis/2026-06-05-chatbox-integration-api-facts.md
---

> Анализ/факты API: `plans/analysis/2026-06-05-chatbox-integration-api-facts.md` (карта эндпоинтов, схемы, enum'ы, реальные данные, маппинг на код). · Статус согласования решений: 2026-06-05.

# ТЗ: Интеграция Коры с ChatBox (app.agent-lia.ru / «Call Intellect: Чаты»)

## Принцип
Кора **зеркалит** (read-mostly) клиентские переписки из внешнего сервиса ChatBox в собственные таблицы, анализирует их LLM через существующий pipeline `ingest → knowledge-core`, показывает в вебе и позволяет писать ответ от имени менеджера обратно через ChatBox API. ChatBox остаётся источником правды о самих мессенджерах; Кора не подключает мессенджеры напрямую. **Не оптимизировать «по-своему»**: модель данных и точки интеграции выбраны под текущую архитектуру (модуль-образец `sources`, контракт `IngestService.ingest`), отклонения — только через возврат владельцу.

## Цель + Зачем
**Болезненное состояние:** переписки с клиентами в Telegram/MAX/WhatsApp/виджете живут в стороннем ChatBox и не попадают в «память компании» Коры — их нельзя анализировать LLM, искать, связывать с графом знаний, видеть в едином окне. Знания из диалогов теряются.

**Что даёт решение:** компания вводит токен ChatBox → Кора тянет чаты/клиентов/менеджеров/сообщения, объединяет идентичности клиента по мессенджерам (готовый `customerId` ChatBox), режет диалоги на сессии и скармливает их knowledge-core для извлечения IdeaBlock/Entity, показывает чаты в вебе и даёт отвечать клиенту из Коры.

**Метрика успеха (проверяемо):** после подключения интеграции и ручного «синхронизировать всё» в БД Коры присутствуют ≥1 `ChatboxChat`, ≥1 `ChatboxMessage`, ≥1 `ChatboxChatSession` со `analysisStatus='done'` и созданный `RawEvent(sourceType='chatbox')`; в веб-интерфейсе `/chats` отображается список чатов с бейджем типа мессенджера; отправка ответа из Коры возвращает 200 и появляется как `ChatboxMessage(isOutboundFromKora=true)`.

---

## REALITY-CHECK (фактический статус кода на 2026-06-05)

| Что | Статус | Вывод для ТЗ |
|---|---|---|
| Модуль `sources` (`backend/src/modules/sources/*`) | **есть, рабочий** — per-tenant config с AES-GCM шифрованием секретов (`encryptSecrets`/`sanitizeConfigForRead`), RBAC `source`, EntitlementService-гейтинг | **Образец** для нашего модуля. Но ChatBox требует много типизированных таблиц → НЕ кладём в `Source.config`, делаем выделенный домен `chatbox`. Конфиг интеграции (token+workspaceId) — отдельная модель `ChatboxIntegration`, шифрование токена тем же `CryptoService`. |
| `IngestService.ingest({tenantId, sourceId, sourceExternalId, occurredAt, payload, dataClass})` (`backend/src/modules/ingest/ingest.service.ts:81`) | **есть, рабочий** — идемпотентность по `idempotencyKey=sha256(sourceId+':'+(sourceExternalId??checksum)+':'+occurredAtIso)`, публикует job `core.raw-events` | **Точка входа AI-анализа.** Сессия чата → один `RawEvent(sourceType='chatbox', sourceExternalId=sessionId)`. |
| `enum SourceType` (`schema.prisma:225`) | значения `meeting/chat/phone_call/bot/email/web_form/external/conversational/tracker_event`. `chat` **объявлен, но не используется адаптерами** | Добавляем новое значение `chatbox` (явность, без коллизий с зарезервированным `chat`). |
| `conversational` модуль (`backend/src/modules/conversational/*`) | **есть** — внутренние чек-ины сотрудников (telegram/max боты, free-note bridge) | **НЕ переиспользовать** — другой домен (внутренние, не клиентские CRM-чаты). |
| Sidebar nav (`frontend/src/ui/components/app-shell/Sidebar.tsx`) | группы `NavGroup→NavSubgroup→NavItem`, есть `gateFeature/comingSoon/badgeCount`; `/chat` и `/chat-v2` заняты «Помощником компании» | Новая группа «Чаты» на route `/chats` (НЕ `/chat`). Сборка групп — массив в теле `Sidebar()`. |
| Webhook-приёмник (образец `max-webhooks.controller.ts`) | **есть** — `@ApiExcludeController`, `POST :tenantId/:secret`, `timingSafeEqual`, всегда `HttpCode(200)` | Наш inbound-webhook от ChatBox по тому же паттерну. |
| ENV `PUBLIC_HOST_URL` (`env.schema.ts:393`), `CRYPTO_MASTER_KEY` (`:392`) | **есть** | Используем для регистрации вебхука в ChatBox и шифрования токена. |
| `AdminSetting` модель (`schema.prisma:8946`) | **есть** (super_admin, history+audit) | Порог idle-gap сессий → `AdminSetting`, не ENV/хардкод. |
| CryptoModule (`backend/src/common/crypto`, @Global) | **есть** — AES-256-GCM | Шифрование токена. |

Завышения scope нет — фича строится «с нуля» в новом домене, но плотно опирается на готовые `sources`/`ingest`/`crypto`/RBAC. Висящих контрактов фронт↔бэк не найдено.

---

## Принятые решения владельца (2026-06-05) — не пересматривать

| # | Решение | Обоснование (Почему) |
|---|---|---|
| Р1 | **Один ChatBox-workspace на org Коры.** После ввода токена — `GET /workspaces`, владелец выбирает один. Конфиг = `tokenEnc` + `workspaceId`. | Токен реселлерский (видит ~100 чужих воркспейсов) — тянуть всё опасно (утечка чужих данных). `@@unique([tenantId])` на `ChatboxIntegration`. |
| Р2 | **Чаты — зеркало 1:1** (один `ChatboxChat` = один ChatBox `chat.id`), сообщения дозагружаются инкрементально. **Сессии-сегменты** (`ChatboxChatSession`) для LLM: новая сессия при паузе > порога (`AdminSetting chatbox.session.idle_gap_hours`, дефолт 12) ИЛИ при `CHAT_CLOSED`; `previousSessionId` связывает; анализ учитывает summary предыдущих сессий. | В ChatBox чат остаётся ACTIVE и копит сообщения сутками (подтверждено на данных). «Новый чат на следующий день» владельца моделируем сессией, а не новой записью чата — сохраняет связность и не дробит тред. |
| Р3 | **Realtime = webhook ChatBox + поллинг-фолбэк.** Режимы синка: `hourly` / `daily` / `realtime`. В `realtime` регистрируем webhook на `PUBLIC_HOST_URL`, плюс редкий поллинг (добор пропусков). | Backend публично доступен (подтверждено). Webhook даёт мгновенность, поллинг — надёжность (вебхуки теряются). |
| Р4 | **Менеджеры: автосвязка `Member.email` → `Person` Коры** (по совпадению email в той же org), остаток — ручной маппинг в UI. | Единая карточка сотрудника в Коре; email — стабильный ключ. Ручная донастройка для несовпавших. |

---

## Доказательство выбора (свод; полная таблица — в файле фактов)

| Критерий | A: выделенный домен `chatbox` (выбран) | B: всё в `Source.config` + generic RawEvent |
|---|---|---|
| Типизированное хранение чатов/сообщений/клиентов | ✓ нормальные таблицы, индексы, FK | ✗ JSON-каша в config, нет запросов/индексов |
| Веб-просмотр чатов с фильтрами/бейджами | ✓ прямые запросы по `@@index` | ✗ невозможно эффективно |
| Мультимессенджер-объединение клиента | ✓ FK `customerId`→`ChatboxCustomer` (готовый ключ ChatBox) | ✗ ручная склейка |
| Сессии-сегменты для анализа | ✓ модель `ChatboxChatSession` + `previousSessionId` | ✗ негде хранить |
| Переиспользование AI-pipeline | ✓ сессия→`RawEvent(sourceType=chatbox)`→knowledge-core | ✓ (одинаково) |
| Объём кода | ⚠️ больше моделей | ✓ меньше, но не решает задачу |

**Вывод:** A. B ломается на веб-просмотре и объединении клиентов — это ядро требований. **Объединение клиента по мессенджерам не изобретаем** — ChatBox уже даёт `Customer(1)↔ChannelClient(N)` через `customerId` (challenge-loop: «решаем корень, не симптом» — корень уже решён апстримом, переиспользуем).

---

## Scope

### Входит
- Новый backend-домен `backend/src/modules/chatbox/`: типизированный API-клиент ChatBox, CRUD интеграции, движок синка (BullMQ), маппер→сессии, inbound-webhook, исходящая отправка, мост в ingest.
- Prisma-модели домена + enum'ы + миграция + `SourceType.chatbox` + ключ `AdminSetting`.
- Frontend: пункт меню «Чаты»→«Интеграции»→«Чат бокс»; страница настроек интеграции; просмотр чатов (`/chats`) с бейджами мессенджеров и ответом менеджера; UI маппинга менеджеров.
- Автосвязка менеджеров по email + ручной маппинг.
- Регистрация скриптов в `apply-prod-deploy.ts`, prod-deploy-log, обновление second-brain.

### Не входит (vNext, явные заглушки)
- Создание чата с нуля из Коры (`POST /chats` ChatBox) — **не входит**, только отправка в существующий чат. → vNext.
- Медиа-файлы (image/audio/video/file) проксирование/скачивание в S3 — храним только `*Url` из ChatBox, не качаем. → vNext.
- Отправка нетекстовых сообщений (ChatBox `SendMessageDto` сейчас поддерживает только `TEXT`). → ограничение апстрима.
- Двусторонняя синхронизация правок клиентов/кастомеров обратно в ChatBox (PATCH) — Кора read-only по этим сущностям. → vNext.
- Связывание `ChatboxCustomer` с `Person`/`Entity` графа Коры — **не входит** (только менеджеры↔Person). → vNext.
- Аналитические дашборды по чатам (метрики ответов, SLA) — → vNext.

### Граничные контракты с другими доменами
- `IngestService` — **используем как есть**, не меняем сигнатуру. Передаём `Source(type='chatbox')` (создаётся лениво, один на org).
- `knowledge-core` block-ingest worker — **не трогаем**; он сам подхватит `RawEvent`. Для chatbox-payload нужен парсер-нормализатор внутри нашего адаптера (строит transcript), но извлечение IdeaBlock — на стороне knowledge-core без изменений.
- `Person` — только **чтение** для автосвязки по email; `ChatboxMember.linkedPersonId` — наш FK, в `Person` ничего не пишем.
- `llm-router.service.ts` — используем для генерации summary сессии (`taskType` новый, см. Фаза 5), без изменений роутера.

---

## Контракт данных (дословные Prisma-сниппеты)

> Все модели tenant-scoped: первое поле бизнес-индекса — `tenantId`. Номера строк schema.prisma даны на момент написания — **перед правкой перечитать** (якоря: `model Source` ~2885, `model AdminSetting` ~8946, `enum SourceType` ~225). HNSW/GIN-индексы здесь не нужны (полнотекст по сообщениям — vNext).

### Enum'ы (добавить в schema.prisma рядом с прочими enum, после `enum DataClass`)
```prisma
/// ChatBox-интеграция — режим синхронизации.
enum ChatboxSyncMode {
  hourly
  daily
  realtime // webhook + редкий поллинг-фолбэк
}

/// ChatBox-интеграция — состояние подключения.
enum ChatboxIntegrationStatus {
  connected
  error
  disconnected
}

/// Зеркало ChatBox Chat.status.
enum ChatboxChatStatus {
  active
  closed
}

/// Зеркало ChatBox Message.sender.type.
enum ChatboxSenderType {
  CLIENT
  USER
  ASSISTANT
  QUALITY_CONTROL
}

/// Зеркало ChatBox Message.content.type.
enum ChatboxContentType {
  TEXT
  IMAGE
  AUDIO
  VIDEO
  VIDEO_NOTE
  FILE
  VOICE
  COMMAND
}

/// Статус LLM-анализа сессии чата.
enum ChatboxSessionAnalysisStatus {
  pending
  analyzing
  done
  failed
}

/// Способ связи менеджера ChatBox с Person Коры.
enum ChatboxMemberLinkMode {
  auto   // совпал email
  manual // выбрано вручную
  none   // не связан
}
```
> **Тип мессенджера (channelType) хранить как `String`, НЕ enum** — ChatBox добавляет новые типы (`EXT_MAX`, `WHATSAPP_WHAPI`…) без нашего релиза; enum потребовал бы миграцию на каждый. Валидный набор известных типов + дисплей-маппинг — в коде (`chatbox-channel-type.ts`), неизвестный → бейдж «Другое».

### Модели (добавить блоком в конец schema.prisma)
```prisma
/// ChatBox: конфиг интеграции org с app.agent-lia.ru. Один на org (Р1).
model ChatboxIntegration {
  id             String                   @id @default(cuid())
  tenantId       String                   @unique
  /// AES-256-GCM (CryptoService). Никогда не возвращается plain в API.
  tokenEnc       String                   @db.Text
  workspaceId    String                   // ChatBox workspace UUID
  workspaceName  String?
  syncMode       ChatboxSyncMode          @default(daily)
  status         ChatboxIntegrationStatus @default(connected)
  lastError      String?                  @db.Text
  /// ChatBox webhook id (если syncMode=realtime), для снятия при отключении.
  webhookExternalId String?
  /// path-secret нашего inbound-webhook (как у max-webhooks). Генерится при создании.
  webhookSecret  String?
  lastFullSyncAt        DateTime?
  lastIncrementalSyncAt DateTime?
  createdAt      DateTime                 @default(now())
  updatedAt      DateTime                 @updatedAt

  org Org @relation(fields: [tenantId], references: [id], onDelete: Cascade)
}

/// ChatBox: канал (мессенджер) воркспейса.
model ChatboxChannel {
  id          String   @id @default(cuid())
  tenantId    String
  externalId  String   // ChatBox channel UUID
  channelType String   // CHAT_WIDGET|TELEGRAM|EXT_MAX|... (String, см. примечание)
  title       String
  description String?  @db.Text
  isActive    Boolean  @default(true)
  raw         Json?
  syncedAt    DateTime @default(now())
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  org Org @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, externalId])
  @@index([tenantId])
}

/// ChatBox: унифицированный контакт (Customer). Ключ объединения клиента по мессенджерам.
model ChatboxCustomer {
  id            String   @id @default(cuid())
  tenantId      String
  externalId    String   // ChatBox Customer UUID
  name          String?
  phone         String?
  email         String?
  externalCrmId String?  // Customer.externalId (из чужой CRM)
  raw           Json?
  syncedAt      DateTime @default(now())
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  org     Org                     @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  clients ChatboxChannelClient[]

  @@unique([tenantId, externalId])
  @@index([tenantId])
}

/// ChatBox: identity клиента в конкретном мессенджере (ChannelClient).
model ChatboxChannelClient {
  id                 String   @id @default(cuid())
  tenantId           String
  externalId         String   // ChatBox ChannelClient UUID
  customerExternalId String?  // ChatBox Customer UUID (для связки)
  customerId         String?  // FK → ChatboxCustomer.id
  channelType        String
  channelExternalId  String?  // ChatBox channel UUID
  messengerUserId    String?  // ChannelClient.externalId (id в мессенджере, напр. tg user id)
  name               String?
  phone              String?
  email              String?
  avatarUrl          String?  @db.Text
  isBlocked          Boolean  @default(false)
  raw                Json?
  syncedAt           DateTime @default(now())
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  org      Org              @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  customer ChatboxCustomer? @relation(fields: [customerId], references: [id], onDelete: SetNull)

  @@unique([tenantId, externalId])
  @@index([tenantId, customerId])
}

/// ChatBox: менеджер (Member воркспейса). Связь с Person Коры — Р4.
model ChatboxMember {
  id             String                @id @default(cuid())
  tenantId       String
  externalId     String                // ChatBox Member id
  email          String?
  name           String?
  role           String?
  linkedPersonId String?               // FK → Person.id (наш, в Person не пишем)
  linkMode       ChatboxMemberLinkMode @default(none)
  raw            Json?
  syncedAt       DateTime              @default(now())
  createdAt      DateTime              @default(now())
  updatedAt      DateTime              @updatedAt

  org Org @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, externalId])
  @@index([tenantId, linkedPersonId])
}

/// ChatBox: чат (тред). Зеркало 1:1 (Р2).
model ChatboxChat {
  id                  String            @id @default(cuid())
  tenantId            String
  externalId          String            // ChatBox Chat UUID
  channelExternalId   String            // ChatBox channel UUID (денорм для бейджа)
  channelType         String            // денорм тип мессенджера
  clientExternalId    String?           // ChatBox ChannelClient UUID
  customerExternalId  String?           // ChatBox Customer UUID (денорм)
  responsibleExternalId String?         // ChatBox Member id
  status              ChatboxChatStatus @default(active)
  externalCreatedAt   DateTime
  externalUpdatedAt   DateTime
  lastMessageAt       DateTime?
  messageCount        Int               @default(0)
  raw                 Json?
  syncedAt            DateTime          @default(now())
  createdAt           DateTime          @default(now())
  updatedAt           DateTime          @updatedAt

  org      Org                  @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  sessions ChatboxChatSession[]
  messages ChatboxMessage[]

  @@unique([tenantId, externalId])
  @@index([tenantId, customerExternalId])
  @@index([tenantId, lastMessageAt])
  @@index([tenantId, status])
}

/// ChatBox: сессия-сегмент чата для LLM-анализа (Р2).
model ChatboxChatSession {
  id                String                       @id @default(cuid())
  tenantId          String
  chatId            String                       // FK → ChatboxChat.id
  seq               Int                          // 1,2,3... внутри чата
  previousSessionId String?                      // FK self
  startedAt         DateTime
  endedAt           DateTime?                    // null = открытая (последняя)
  messageCount      Int                          @default(0)
  analysisStatus    ChatboxSessionAnalysisStatus @default(pending)
  /// LLM-summary сессии (для подмешивания в анализ следующих сессий).
  summary           String?                      @db.Text
  /// RawEvent, порождённый этой сессией (мост в knowledge-core).
  rawEventId        String?
  analyzedAt        DateTime?
  createdAt         DateTime                     @default(now())
  updatedAt         DateTime                     @updatedAt

  org  Org         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  chat ChatboxChat @relation(fields: [chatId], references: [id], onDelete: Cascade)

  @@unique([tenantId, chatId, seq])
  @@index([tenantId, analysisStatus])
}

/// ChatBox: сообщение. Зеркало.
model ChatboxMessage {
  id                String             @id @default(cuid())
  tenantId          String
  chatId            String             // FK → ChatboxChat.id
  sessionId         String?            // FK → ChatboxChatSession.id (проставляется маппером)
  externalId        String             // ChatBox Message UUID
  senderType        ChatboxSenderType
  senderExternalId  String?
  senderName        String?
  contentType       ChatboxContentType @default(TEXT)
  text              String?            @db.Text
  imageUrl          String?            @db.Text
  fileUrl           String?            @db.Text
  audioUrl          String?            @db.Text
  videoUrl          String?            @db.Text
  externalCreatedAt DateTime
  /// true — отправлено из Коры через ChatBox API (Фаза 6).
  isOutboundFromKora Boolean           @default(false)
  raw               Json?
  createdAt         DateTime           @default(now())

  org  Org         @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  chat ChatboxChat @relation(fields: [chatId], references: [id], onDelete: Cascade)

  @@unique([tenantId, externalId])
  @@index([tenantId, chatId, externalCreatedAt])
  @@index([tenantId, sessionId])
}
```
> К `model Org` (schema.prisma:2192) добавить обратные связи: `chatboxIntegration ChatboxIntegration?` и при необходимости массивы (Prisma требует обратную сторону отношения). Перечитать блок Org перед правкой.

### `SourceType` — добавить значение
```prisma
enum SourceType {
  // ...существующие...
  /// ChatBox-интеграция: сессия клиентского чата → RawEvent → knowledge-core.
  chatbox
}
```

### AdminSetting (seed) — порог сессий
Ключ `chatbox.session.idle_gap_hours`, тип number, дефолт `12`. Сидится `seed-admin-setting-chatbox.ts` (идемпотентно). Читается через сервис AdminSetting (не ENV, не хардкод).

---

## ENV (env.schema.ts) — добавить
```ts
// ChatBox integration (ТЗ 2026-06-05)
CHATBOX_API_BASE_URL: z.string().url().default('https://app.agent-lia.ru'),
```
- `PUBLIC_HOST_URL` (уже есть, `:393`) — база для URL вебхука, который регистрируем в ChatBox.
- `CRYPTO_MASTER_KEY` (уже есть) — шифрование токена. Никаких `process.env.*` — только `TypedConfigService`.

---

## Контракт API Коры (Zod-DTO + Swagger; коды ошибок machine-readable)

Базовый префикс `/api/v1`. Guard'ы как в `sources.controller.ts`: `@UseGuards(CookieAuthGuard, TenantGuard)`, RBAC-ресурс `chatbox`, `@CurrentOrg() tenantId`. Формат ошибок — `{ ok:false, error:{ code, message } }`.

| Метод | Путь | Назначение | RBAC act | Коды ошибок |
|---|---|---|---|---|
| GET | `/chatbox/integration` | текущая интеграция org (без plain-токена) | read | — |
| POST | `/chatbox/integration/workspaces` | по введённому токену вернуть список воркспейсов ChatBox (для выбора). Тело `{token}` | manage | `chatbox_token_invalid` |
| PUT | `/chatbox/integration` | создать/обновить интеграцию `{token?, workspaceId, syncMode}` | manage | `chatbox_token_invalid`, `chatbox_workspace_not_found` |
| DELETE | `/chatbox/integration` | отключить (снять webhook, isActive→disconnected) | delete | — |
| POST | `/chatbox/integration/sync` | ручной синк `{scope: 'all'\|'customers'\|'managers'\|'chats'}` → ставит BullMQ job, возвращает `{jobId}` | manage | `chatbox_not_configured` |
| GET | `/chatbox/integration/sync/status` | статус последних синков (`lastFullSyncAt`, счётчики) | read | — |
| GET | `/chatbox/chats` | список чатов (фильтры `status`, `channelType`, `customerExternalId`, пагинация) | read | — |
| GET | `/chatbox/chats/:id` | чат + клиент(unified) + менеджер + сессии | read | `chatbox_chat_not_found` |
| GET | `/chatbox/chats/:id/messages` | сообщения чата (пагинация, order) | read | `chatbox_chat_not_found` |
| POST | `/chatbox/chats/:id/messages` | отправить от менеджера `{text}` → ChatBox API | write | `chatbox_chat_not_found`, `chatbox_send_failed` |
| GET | `/chatbox/members` | менеджеры + текущая связка с Person | read | — |
| PUT | `/chatbox/members/:id/link` | ручной маппинг `{personId\|null}` | manage | `chatbox_member_not_found`, `person_not_found` |
| POST | `/webhooks/chatbox/:tenantId/:secret` | **inbound webhook ChatBox** (`@ApiExcludeController`, без cookie-auth, всегда 200) | — | — |

**Privacy-инвариант:** эндпоинты чтения сообщений/чатов проверяют членство пользователя в org через `TenantGuard`+RBAC, но **super_admin не получает bypass на чтение переписки** (`ChatboxMessage.text`). Реализация: в сервисе для message/chat-read не вызывать super-admin bypass; явный тест-предикат в acceptance Фазы 8.

### Машинный контракт ingest-payload (Фаза 5)
`RawEvent.payload` для сессии (`sourceType='chatbox'`, `sourceExternalId=<sessionId>`, `occurredAt=session.endedAt ?? lastMessageAt`, `dataClass='sensitive'`):
```json
{
  "kind": "chatbox_chat_session",
  "chatExternalId": "e88610cb-...",
  "sessionId": "<cuid>",
  "sessionSeq": 2,
  "channelType": "TELEGRAM_PRIVATE",
  "customer": { "externalId": "da4b...", "name": "Arsenii" },
  "responsible": { "externalId": "277f...", "name": "Никита", "personId": "<cuid|null>" },
  "previousSessionSummary": "Клиент спрашивал про подресурсы кортов...",
  "messages": [
    { "at": "2026-06-04T12:23:53Z", "from": "client", "name": "Arsenii", "text": "..." },
    { "at": "2026-06-04T12:28:06Z", "from": "manager", "name": "Никита", "text": "..." }
  ]
}
```
- `dataClass='sensitive'` — клиентская переписка.
- `from` нормализуем: `CLIENT→client`, `USER/ASSISTANT/QUALITY_CONTROL→manager`/`assistant` (по `senderType`).

---

## Идемпотентность (acceptance-критерий для каждого скрипта/синка)
- Все upsert'ы маппера — по `@@unique([tenantId, externalId])` (повторный синк = no-op для неизменённых).
- `seed-admin-setting-chatbox.ts` — повторный прогон не дублирует ключ.
- Ingest сессии — повтор даёт тот же `idempotencyKey` (по `sourceExternalId=sessionId`), `RawEvent` не дублируется.
- Webhook-обработка — `MESSAGE_CREATED` дедуп по `ChatboxMessage.@@unique([tenantId, externalId])`.

## Feature-flag
Вся фича за флагом-фичей тарифа `feature.chatbox` (по образцу `featureForType` в `sources.controller.ts`), дефолт OFF. Пункт меню гейтится `gateFeature: 'feature.chatbox'`. Kill-switch: `AdminSetting chatbox.enabled` (дефолт true; false — синк-кроны и webhook молча no-op).

---

## Границы фичи
- ✅ Always: зеркалить read-only из ChatBox; шифровать токен; tenant-scope на каждом запросе; идемпотентные upsert'ы; возвращать 200 на webhook.
- ⚠️ Ask first: менять сигнатуру `IngestService.ingest`; вводить новый `signalType` в knowledge-core; качать медиа в S3; писать что-либо обратно в ChatBox кроме отправки текста в существующий чат.
- 🚫 Never: класть plain-токен в API-ответ/лог; `new PrismaClient()` в скриптах (только `createPrismaClient()`); `process.env.*` (только `TypedConfigService`); `prisma db push` для коммита (только версионируемые миграции); super_admin bypass на чтение `ChatboxMessage.text`; `git add -A`.

---

## Фазы (dependency-ordered)

**Граф зависимостей:** Ф1 → Ф2 → Ф3 → (Ф4 ∥ Ф5 ∥ Ф6) → Ф7 → Ф8 → Ф9 → Ф10.
Ф4/Ф5/Ф6 зависят только от Ф3 (маппер+клиент) и независимы между собой → одна волна. Ф7/Ф8 (фронт) зависят от Ф2/Ф6/Ф9 (контракты API готовы после Ф6 и Ф9 соответственно — Ф8 идёт после Ф9, т.к. маппинг менеджеров).

### Фаза 1 — Схема БД и enum'ы
- **Цель:** все модели/enum'ы домена + `SourceType.chatbox` + обратные связи в `Org` + AdminSetting-ключ.
- **Файлы:** `backend/prisma/schema.prisma` (модели/enum выше; перечитать `model Org:2192`, `enum SourceType:225`), новая миграция `prisma/migrations/*`, `backend/scripts/seed-admin-setting-chatbox.ts` (образец — `scripts/seed-admin-setting-daily-digest.ts`), регистрация в `apply-prod-deploy.ts` `STEPS` (`phase:'seed-base'`).
- **Что НЕ входит:** сервисы, контроллеры, воркеры.
- **Команды/контракт:** `bun run prisma:migrate -- --name chatbox_integration` → ревью SQL → `bun run prisma:generate`.
- **Acceptance:**
  - `grep -c "model Chatbox" backend/prisma/schema.prisma` == 8.
  - `grep -n "chatbox" backend/prisma/schema.prisma` содержит значение enum `SourceType`.
  - `bun run prisma:generate` без ошибок; `bun run typecheck` зелёный.
  - Миграция применяется на чистой БД (`prisma migrate deploy` в migrate-контейнере) идемпотентно.
  - `seed-admin-setting-chatbox.ts` дважды подряд → один ключ (idempotent).
- **Закрывает:** инфраструктуру для R1–R12.

### Фаза 2 — API-клиент ChatBox + CRUD интеграции
- **Цель:** типизированный клиент (`ChatboxApiClient`) + `ChatboxIntegrationService` (шифрование токена, выбор воркспейса) + контроллер `GET/PUT/DELETE /chatbox/integration` + `POST /chatbox/integration/workspaces`.
- **Файлы (новые):** `backend/src/modules/chatbox/chatbox.module.ts`, `chatbox-api.client.ts` (fetch к `CHATBOX_API_BASE_URL`, Bearer-токен, методы: `listWorkspaces`, `listChannels`, `listChats`, `getChat`, `listMessages`, `sendMessage`, `listChannelClients`, `listCustomers`, `listMembers`, `createWebhook`, `deleteWebhook`), `chatbox-integration.service.ts`, `chatbox-integration.controller.ts`, `dto/chatbox-integration.dto.ts` (Zod). Образцы: `sources.controller.ts`, `sources.service.ts` (encrypt/sanitize), `max-api-client.ts`.
- **Контракт клиента:** все ответы — типизированы по схемам из файла фактов; пагинация `limit/offset/order/search`; таймаут; ошибки маппятся в коды (`chatbox_token_invalid` при 401).
- **Что НЕ входит:** синк-воркеры, маппер, фронт.
- **Acceptance:**
  - RBAC-ресурс `chatbox` добавлен в `policies/policy.csv` (owner: read/write/delete/manage; admin: read/write/manage; manager: read).
  - `POST /chatbox/integration/workspaces` с валидным токеном (тестовый из файла фактов) возвращает непустой список (integration-тест с реальным API ИЛИ замоканный клиент в unit + один ручной smoke).
  - `GET /chatbox/integration` никогда не содержит plain-токен (grep ответа: нет подстроки токена; `tokenEnc` не сериализуется).
  - `bun run typecheck && bun run lint && bun run build` зелёные.
- **Закрывает:** R1, R2.

### Фаза 3 — Движок синка + маппер + сессии
- **Цель:** upsert ChatBox→Кора для всех сущностей; сегментация сообщений на сессии (idle-gap из AdminSetting); BullMQ-очередь `chatbox.sync` + воркер; ручные эндпоинты синка.
- **Файлы (новые):** `chatbox-sync.service.ts` (методы `syncMembers/syncChannels/syncCustomers/syncChannelClients/syncChats/syncMessages(chatId)/fullSync/incrementalSync`), `chatbox-session.service.ts` (сегментация + проставление `sessionId` сообщениям), `queue/chatbox-sync.queue.ts` + `queue/chatbox-sync.worker.ts` (процесс `src/workers/main.ts`), эндпоинты `POST /chatbox/integration/sync`, `GET .../sync/status`. Образец очереди — любой существующий BullMQ-воркер; `jobId` формат `chatbox:<tenantId>:<scope>:<occurredAtIso>` (дедуп).
- **Сегментация (точный алгоритм):** сообщения чата по `externalCreatedAt asc`; если разрыв с предыдущим > `idle_gap_hours` ИЛИ предыдущая сессия закрыта (`CHAT_CLOSED`) → новая `ChatboxChatSession(seq+1, previousSessionId=prev.id)`, у prev ставим `endedAt`. Последняя сессия `endedAt=null` (открытая). Идемпотентно при повторном синке.
- **Что НЕ входит:** ingest в knowledge-core (Ф5), webhook (Ф4), отправка (Ф6), фронт.
- **Acceptance:**
  - Ручной `POST /chatbox/integration/sync {scope:'all'}` на тестовом воркспейсе (`246c3062-...`) → в БД ≥1 ChatboxChat, ≥1 ChatboxMessage, ≥1 ChatboxChannelClient с непустым `customerId`, ≥1 ChatboxChatSession.
  - Повторный синк не создаёт дублей (кол-во строк не растёт) — idempotent.
  - unit-тест сегментатора: вход с разрывом >порога → 2 сессии с корректным `previousSessionId`; вход без разрыва → 1 сессия.
  - typecheck/lint/build зелёные; `bunx vitest run` новых spec зелёный.
- **Закрывает:** R3, R4, R5, R10.

### Фаза 4 — Cron-планировщик + inbound webhook (realtime)
- **Цель:** `@Cron` раскладывает incremental-sync по org согласно `syncMode` (hourly/daily); в `realtime` при сохранении интеграции регистрируем webhook ChatBox; inbound-контроллер принимает события и ставит точечный синк.
- **Файлы (новые):** `chatbox-sync.cron.ts` (`@Cron` ежечасно/ежедневно; фильтр по `syncMode`, kill-switch `chatbox.enabled`), `chatbox-webhook.controller.ts` (`@ApiExcludeController`, `POST /webhooks/chatbox/:tenantId/:secret`, `timingSafeEqual`, всегда 200 — образец `max-webhooks.controller.ts`), регистрация/снятие webhook в `chatbox-integration.service` (`PUT`/`DELETE`).
- **Webhook URL:** `${PUBLIC_HOST_URL}/api/v1/webhooks/chatbox/${tenantId}/${webhookSecret}`, события `['CHAT_CREATED','CHAT_CLOSED','MESSAGE_CREATED','MESSAGE_UPDATED','CHANNEL_CLIENT_CREATED']`.
- **realtime-фолбэк:** в `realtime` поллинг тоже идёт, но реже (раз в час) — добор пропущенных вебхуков.
- **Что НЕ входит:** ingest/LLM, фронт.
- **Acceptance:**
  - `PUT /chatbox/integration {syncMode:'realtime'}` → в ChatBox создан webhook (проверка `GET .../webhooks` через клиент); `DELETE` снимает.
  - `POST /webhooks/chatbox/:tenantId/:badsecret` → 403 (но тело 200-семантика для валидных); валидный `MESSAGE_CREATED` → ставится job, после обработки сообщение в БД.
  - Cron зарегистрирован (`grep '@Cron' chatbox-sync.cron.ts`); kill-switch выключает синк.
  - typecheck/lint/build + spec зелёные.
- **Закрывает:** R3 (realtime), R11.

### Фаза 5 — Мост в knowledge-core + summary сессии
- **Цель:** закрытую сессию (или дневной flush открытой) превращать в `RawEvent(sourceType='chatbox')` через `IngestService.ingest`; генерировать LLM-summary сессии (`llm-router`, новый `taskType: 'chatbox_session_summary'`), подмешивать summary предыдущей сессии в анализ.
- **Файлы (новые):** `chatbox-ingest.service.ts` (строит payload по контракту выше, лениво создаёт `Source(type='chatbox', name='ChatBox')` на org, вызывает `ingest`), `chatbox-analyze.worker.ts` (берёт сессии `analysisStatus='pending'` с `endedAt!=null`, генерит summary, ставит `done`/`failed`, проставляет `rawEventId`). Регистрация `taskType` в роутере (без изменения логики роутера — добавить маршрут через seed `seed-llm-task-routes-default.ts` или admin).
- **Prompt caching:** SYSTEM-промпт summary стабильный; переменная переписка — в конце user-сообщения (раздел обязателен по правилам).
- **LLM:** primary DeepSeek/OpenAI-proxy (`deepseek-v4-flash` для summary — дёшево). Anthropic не использовать.
- **Что НЕ входит:** изменение block-ingest worker (он подхватывает RawEvent сам); фронт.
- **Acceptance:**
  - После синка тестового воркспейса хотя бы одна сессия → `analysisStatus='done'`, `summary` непустой, `rawEventId` заполнен, соответствующий `RawEvent(sourceType='chatbox', dataClass='sensitive')` существует.
  - Повторный прогон анализа той же сессии не плодит `RawEvent` (idempotencyKey стабилен).
  - typecheck/lint/build + spec зелёные.
- **Закрывает:** R6.

### Фаза 6 — Исходящая отправка (ответ менеджера)
- **Цель:** `POST /chatbox/chats/:id/messages {text}` → `ChatboxApiClient.sendMessage` → при успехе сохранить `ChatboxMessage(isOutboundFromKora=true)` (реконсиляция остального — синком/вебхуком).
- **Файлы:** метод в `chatbox-integration.service`/новый `chatbox-chats.service.ts`, эндпоинт в контроллере чатов. RBAC act `write`.
- **Что НЕ входит:** создание нового чата (`POST /chats`) — vNext; нетекстовые типы.
- **Acceptance:**
  - Отправка в существующий ACTIVE-чат тестового воркспейса → 200, в БД появляется `ChatboxMessage(isOutboundFromKora=true, senderType='USER')`.
  - Ошибка ChatBox API → код `chatbox_send_failed`, ничего не пишем в БД.
  - typecheck/lint/build + spec зелёные.
- **Закрывает:** R7.

### Фаза 7 — Frontend: меню + страница интеграции
- **Цель:** группа меню «Чаты»→«Интеграции»→«Чат бокс»; страница `/chats/integrations/chatbox`: ввод токена → выбор воркспейса (из `POST workspaces`) → сохранение, выбор режима синка, кнопки ручного синка (клиенты/менеджеры/чаты), после сохранения токена — предложение «Синхронизировать всё».
- **Файлы:** `frontend/src/ui/components/app-shell/Sidebar.tsx` (новый `NavGroup` «Чаты» с `gateFeature:'feature.chatbox'`, route `/chats`, подгруппа «Интеграции» → пункт «Чат бокс» `/chats/integrations/chatbox`), `frontend/app/(authenticated)/chats/integrations/chatbox/page.tsx` + client, `frontend/src/api/chatbox.api.ts` (через `api-client.ts`), `frontend/src/domain/chatbox.ts` (ApiDto→DomainModel). Слои ApiDto→DomainModel→UiModel, SWR.
- **Что НЕ входит:** просмотр чатов (Ф8), маппинг менеджеров UI (Ф9).
- **Acceptance:**
  - Пункт меню виден; на тарифе без `feature.chatbox` — замок + редирект на `/settings/billing`.
  - Сценарий: ввод тестового токена → список воркспейсов → выбор `246c3062` → сохранение → кнопка «Синхронизировать всё» ставит job (toast с подтверждением).
  - UI только на русском; парные токены `bg-*/text-*-fg`, без `text-white`/hex.
  - `bun run typecheck && bun run lint && bun run build` (frontend) зелёные.
- **Закрывает:** R1, R8, R9.

### Фаза 8 — Frontend: просмотр чатов + ответ менеджера
- **Цель:** `/chats` — список чатов с бейджем типа мессенджера (MAX/WhatsApp/Telegram/виджет/«Другое»), единая карточка клиента (иконки всех мессенджеров клиента по `customerExternalId`), менеджер, последнее сообщение; деталка чата — лента сообщений + сессии (с пометкой связи с предыдущей) + поле ответа (Ф6).
- **Файлы:** `frontend/app/(authenticated)/chats/page.tsx` + client, `chats/[id]/page.tsx` + client, компоненты бейджей мессенджеров (`chatbox-channel-type.ts` маппинг тип→иконка/лейбл), доп. методы в `chatbox.api.ts`.
- **Что НЕ входит:** маппинг менеджеров (Ф9), аналитика.
- **Acceptance:**
  - Список показывает чаты с корректными бейджами; клиент с >1 мессенджером показывает несколько иконок.
  - Деталка: сообщения в хронологии, видна сегментация на сессии; отправка ответа работает (Ф6) и появляется в ленте.
  - Privacy: под super_admin сообщения чужой org не читаются (ручной/тестовый предикат).
  - typecheck/lint/build зелёные.
- **Закрывает:** R8, R7 (UI-часть), R12.

### Фаза 9 — Связка менеджеров с Person
- **Цель:** автосвязка `ChatboxMember.email` → `Person` той же org при синке менеджеров (`linkMode='auto'`); ручной маппинг `PUT /chatbox/members/:id/link {personId|null}` (`linkMode='manual'/'none'`); UI-секция маппинга.
- **Файлы:** логика автосвязки в `chatbox-sync.service.syncMembers`, эндпоинт в контроллере, UI на странице интеграции или отдельной вкладке.
- **Что НЕ входит:** запись в Person; связка клиентов.
- **Acceptance:**
  - Синк менеджеров: member с email, совпавшим с Person.email → `linkedPersonId` заполнен, `linkMode='auto'`.
  - `PUT .../link {personId}` ставит `manual`; `{personId:null}` → `none`.
  - typecheck/lint/build + spec зелёные.
- **Закрывает:** R4.

### Фаза 10 — Прод-выкат, e2e, документация
- **Цель:** регистрация всех скриптов в `apply-prod-deploy.ts`; обновление `docs/operations/prod-deploy-log.md` (Шаги 1 ENV, 4 schema, 7 seed, 12 smoke очередей/Swagger); обновление second-brain (module-map, data-model, ai-jobs, workers-queues, api-layer, frontend-pages, реестр не-сделанного для vNext); e2e happy-path.
- **Acceptance:**
  - `apply-prod-deploy.ts` содержит `seed-admin-setting-chatbox.ts`; прогон агрегатора idempotent.
  - prod-deploy-log обновлён по затронутым шагам; second-brain — по таблице производных заметок.
  - e2e: подключение→синк→анализ→просмотр→ответ зелёный (или задокументированный ручной smoke).
- **Закрывает:** DoD, vNext-учёт.

---

## Требования (трассировка)
- **R1** Когда владелец вводит валидный токен, система shall показать список воркспейсов и сохранить выбранный (`tokenEnc`+`workspaceId`), один на org.
- **R2** Если токен невалиден, система shall вернуть `chatbox_token_invalid` и не сохранять интеграцию.
- **R3** Когда наступает период синка (hourly/daily) или приходит webhook (realtime), система shall дозагрузить новые чаты/сообщения идемпотентно.
- **R4** Когда синкаются менеджеры, система shall автосвязать по email с Person и дать ручной маппинг.
- **R5** Система shall хранить внешние идентификаторы: chat/message/channelClient/channel/customer/workspace.
- **R6** Когда сессия закрыта, система shall создать `RawEvent(sourceType='chatbox')` и LLM-summary, учитывающий предыдущие сессии.
- **R7** Когда менеджер отправляет ответ из Коры, система shall доставить его через ChatBox API и сохранить как outbound.
- **R8** Система shall показывать чаты в вебе с типом мессенджера и единой карточкой клиента по мессенджерам.
- **R9** Когда сохранён токен, система shall предложить синхронизировать все данные; кнопки ручного синка (клиенты/менеджеры/чаты) shall ставить соответствующий job.
- **R10** Система shall сегментировать чат на сессии по паузе > `chatbox.session.idle_gap_hours`.
- **R11** Если backend недоступен для webhook, система shall добирать данные поллингом (фолбэк).
- **R12** Система shall запрещать super_admin чтение текста переписки.

---

## Pre-mortem / Риски
- **Токен реселлерский (видит чужие воркспейсы).** Митигирование: жёстко один `workspaceId` на org; все запросы к ChatBox только в рамках сохранённого `workspaceId`; в UI выбора воркспейсов не светить чужие данные дольше выбора.
- **Объём данных (воркспейс `МФЦ-Финанс` — 8412 чатов).** Митигирование: пагинация, инкрементальный синк по `updatedAt`, full-sync — фоновый job с прогрессом; не тянуть все сообщения всех чатов разом (только обновлённые чаты).
- **Потеря вебхуков.** Митигирование: поллинг-фолбэк (R11).
- **Новые типы мессенджеров.** Митигирование: `channelType` как String + дисплей-fallback «Другое».
- **PII в переписке.** `dataClass='sensitive'`; privacy-инвариант (R12); токен зашифрован.
- **Rate limit ChatBox API.** Митигирование: backoff в клиенте; синк через очередь с ограничением конкуренции.

## Ревью-аспекты (для strict-production-review-gate)
Tenant-изоляция на каждом запросе; отсутствие plain-токена в логах/ответах; идемпотентность upsert/ingest/seed; корректность сегментатора (граничные паузы); 200 на webhook при любой внутренней ошибке (кроме 403 secret); отсутствие super_admin bypass на чтение переписки; нет `process.env.*`/`new PrismaClient()`/`prisma db push`.

## DoD
- `bun run typecheck` (вкл. `.spec`) / `lint` / `build` зелёные (backend и frontend).
- `bunx vitest run` новых spec зелёный.
- Версионируемая миграция в `prisma/migrations/` + `prisma:generate`.
- Скрипты в `apply-prod-deploy.ts` `STEPS`, идемпотентны.
- `docs/operations/prod-deploy-log.md` обновлён по затронутым шагам (1 ENV, 4 schema, 7 seed, 12 smoke).
- second-brain обновлён по таблице производных заметок (module-map, data-model, ai-jobs, workers-queues, api-layer, frontend-pages, frontend-contexts-hooks; новый `01_projects/chatbox-integration.md`; реестр `04_не-сделано` — vNext).
- Рефлексия в `second-brain/05_история/`.

## Итог

**Реализовано целиком (2026-06-05, ветка `feature/chatbox-integration`, 11 коммитов).** Все 10 фаз закрыты:
- Ф1 schema (8 моделей + 7 enum + SourceType.chatbox + миграция `20260605120000_chatbox_integration` + seed AdminSetting) — миграция применена на дев-БД, seed идемпотентен (live).
- Ф2 API-клиент + CRUD интеграции (токен AES-GCM) — 12 тестов + живой smoke (224 воркспейса, 401→chatbox_token_invalid).
- Ф3 движок синка + сегментация сессий + BullMQ — живой fullSync (49 чатов, 1325 сообщений, 144 сессии, 44/45 клиентов с customerId), идемпотентно; e2e очередь→воркер (job completed).
- Ф4 cron (hourly/daily) + inbound webhook + регистрация — живой roundtrip webhook create→list→delete.
- Ф5 мост в knowledge-core (RawEvent sourceType=chatbox, dataClass=sensitive) + LLM-summary — живой ingest закрытой сессии → RawEvent, идемпотентно (LLM-summary best-effort, в dev без LLM-ключа не верифицирован живьём — покрыт юнит-тестами).
- Ф6 backend-API чатов + исходящая отправка + privacy-гейт R12 — живой read-smoke (49 чатов, голосовые); отправку реальному клиенту НЕ слали (нужно разрешение владельца), покрыта юнит-тестами.
- Ф7 фронт меню «Чаты» + страница интеграции — frontend build зелёный.
- Ф8 фронт просмотр чатов + бейджи мессенджеров + ответ — build зелёный (роуты /chats, /chats/[id]).
- Ф9 автосвязка менеджеров по email (живая проверка: Person по email → linkMode=auto) + UI маппинга.
- Ф10 prod-deploy-log + second-brain + рефлексия.

**Тесты:** 64 unit-теста модуля chatbox зелёные; backend typecheck/build зелёные; frontend build зелёный.

**Осталось / не входило (vNext, в реестре `04_не-сделано`):** создание чата из Коры, скачивание медиа в S3, отправка нетекстовых сообщений, двусторонний PATCH клиентов, связка ChatboxCustomer↔Person/Entity графа, аналитические дашборды по чатам. LLM-summary и реальная отправка ответа — реализованы, но живьём не прогонялись в dev (нет LLM-ключа / не шлём реальным клиентам без разрешения).

**Не запушено** — ждёт подтверждения владельца.
