---
type: tz
status: deprecated
deprecated_at: 2026-05-23
deprecated_by: plans/tz/2026-05-23-sba-beta-1-telegram-max-zero-button-ripout.md
deprecated_reason: |
  Этот ТЗ — пред-альфа описание Telegram-канала сотрудника со slash-командами
  и кнопками. На β-1 вошла консолидированная версия (sba-beta-1-channels-telegram-max),
  а 2026-05-23 от кнопок и slash-команд отказались целиком в пользу zero-button
  (voice + document + LLM intent classify). Актуальный ТЗ — rip-out 2026-05-23.
feature: Telegram — двусторонний канал сотрудников Z
date: 2026-05-21
---

> **DEPRECATED 2026-05-23.** Содержимое не отражает текущий код. Актуальный ТЗ:
> `plans/tz/2026-05-23-sba-beta-1-telegram-max-zero-button-ripout.md`.

# ТЗ: Telegram-канал сотрудника (двусторонний транспорт)

> **Контекст для исполнителя:**
> - Стек backend — NestJS, PostgreSQL, Redis, Prisma; см. [`second-brain/02_architecture/module-map.md`](../../second-brain/02_architecture/module-map.md).
> - **Prisma: только `bun run prisma:push`**, никогда `migrate*` (skill `prisma-db-push-rules`). После правки моделей — `bun run prisma:generate`.
> - **ENV — только через `TypedConfigService`** / `env.schema.ts`, никаких `process.env.*` в коде.
> - **DTO-цепочки и Swagger обязательны** на всех новых эндпоинтах (skill `nestjs-rules`).
> - **TenantGuard** на админ-эндпоинтах: `tenantId` из `X-Org-Id` / `:orgId`.
> - **Casbin** — `backend/src/modules/rbac/policies/policy.csv` обновляется в одном PR со схемой.
> - **Секреты шифровать** `CryptoService` (AES-256-GCM, `CRYPTO_MASTER_KEY`).
> - Существующий ingest-конвейер: `IngestService.ingest(...)` → `RawEvent` → очередь `core.raw-events` (см. [`second-brain/01_projects/ingest-and-sources.md`](../../second-brain/01_projects/ingest-and-sources.md)) — переиспользуется, **не дублируем**.

---

## 1. Цель

После реализации в Z работает **единый Telegram-бот** как двусторонний транспорт между системой и каждым сотрудником: сотрудник присылает боту произвольный текст — он попадает в knowledge-core с корректной идентификацией (`User` + `Org`); любой backend-модуль Z может слать сотруднику текстовое сообщение через внутренний API.

Бот один на всю платформу. Компании сами ничего не настраивают. Привязка Telegram-аккаунта к сотруднику — через одноразовый код, который генерирует админ Org в карточке сотрудника.

---

## 2. Scope

### Входит

**А. Identity и привязка.**
- Один общий бот Z (`Z_TELEGRAM_BOT_TOKEN` в ENV).
- Генерация одноразового **link-кода** в админке Org для каждого сотрудника (`User` в составе Org).
- Команда `/start <код>` в боте → привязка `telegram_user_id` к `User`.
- Отвязка (admin-action и user-action `/unlink`).

**Б. Inbound — приём свободного текста.**
- Webhook Telegram → идентификация отправителя → запись в `RawEvent` через `IngestService.ingest(...)` с `tenantId = User.activeOrgId`.
- Только `message.text` (см. §«Не входит»).
- Идемпотентность по `update_id`.

**В. Outbound — отправка сообщений.**
- Внутренний API `TelegramOutboundService.sendText({ userId, text, idempotencyKey? })`, доступный любому backend-модулю Z через DI.
- Отправка через очередь BullMQ `telegram.outbound` с retry/backoff.
- Метрики и лог.

**Г. Безопасность.**
- Webhook-secret (`X-Telegram-Bot-Api-Secret-Token`) — timing-safe сравнение.
- Rate-limit на inbound per `telegram_user_id` (защита от спама).
- Если входящее от непривязанного TG-аккаунта — бот вежливо отвечает «пришлите команду `/start <код>`», в `RawEvent` ничего не пишем.

**Д. Админ-UI.**
- В карточке сотрудника (`/admin/users/:userId` или эквивалент в текущем admin-модуле Org):
  - кнопка «Выдать код для Telegram» → показывает код + срок жизни + копировать;
  - статус привязки (`telegram_username`, дата привязки) + кнопка «Отвязать».

### Не входит (vNext)

- Уточняющие вопросы / state machine диалога — отдельное ТЗ. Канал должен быть «тупой трубой», умной логике место в `knowledge-core` и над ней.
- Голосовые сообщения, фото, файлы, стикеры, inline-кнопки. В MVP — **только текст**.
- Расписания «бот сам пишет в 18:00» — отдельное ТЗ (инициатором будет `notifications` / `digest`-модуль, вызывающий `TelegramOutboundService`).
- Полноценная привязка через обмен номером телефона (`request_contact`).
- Поддержка переключения между несколькими Org одного User'а в одном Telegram-аккаунте (пока — одна привязка = одна `activeOrgId`, см. §11).
- Сосуществование с per-Org Telegram-источником из [Фазы 10 ingest-and-sources](../../second-brain/01_projects/ingest-and-sources.md) — оба механизма параллельны, ничего из Фазы 10 не трогаем (см. §3).

---

## 3. Архитектурное решение

### 3.1 Почему отдельный модуль, а не Phase 10 `bot/telegram`

Phase 10 проектировалась как **per-Org адаптер**: каждая Org заводит своего бота (`Source.config.botToken`), webhook привязан к конкретному `Source.id`. Это другой use case (b2b: «компания подключает свой канал»).

Здесь же — **один общий сервисный бот Z**, идентификация по `telegram_user_id` → `TelegramAccount` → `User` → `Org`. Tenant определяется из identity, а не из URL. Поэтому это **отдельный модуль `employee-channel/telegram`**, а не вариант существующего адаптера.

При этом ingest-pipeline переиспользуется полностью: webhook бота вызывает `IngestService.ingest(...)`, передавая разрешённый `tenantId` и системный `Source` (см. §4.4).

### 3.2 Карта модулей

```
backend/src/modules/
  employee-channel/                    ← новый bounded-context
    telegram/
      telegram-bot.module.ts
      webhook/
        telegram-webhook.controller.ts ← POST /api/v1/employee-channel/telegram/webhook
        telegram-webhook.guard.ts      ← проверка X-Telegram-Bot-Api-Secret-Token
      identity/
        telegram-link.service.ts       ← генерация/проверка кода, привязка
        telegram-link.controller.ts    ← admin endpoints (/admin/employees/:userId/telegram-link)
      inbound/
        telegram-inbound.service.ts    ← message → IngestService.ingest
      outbound/
        telegram-outbound.service.ts   ← публичный DI API: sendText(...)
        telegram-outbound.processor.ts ← BullMQ consumer очереди telegram.outbound
        telegram-api.client.ts         ← thin wrapper над Bot API
      telegram.dto.ts
```

### 3.3 Поток inbound

```
Telegram → POST /api/v1/employee-channel/telegram/webhook
         → TelegramWebhookGuard (секрет)
         → TelegramWebhookController
            ├── update.message?.text == '/start <code>' → TelegramLinkService.linkByCode
            ├── update.message?.text == '/unlink'        → TelegramLinkService.unlinkByUser
            └── иначе → TelegramInboundService.handleText
                          ├── lookup TelegramAccount by from.id
                          │   ├── нет → reply «пришлите /start <код>», RETURN
                          │   └── есть → User → activeOrgId
                          ├── idempotency: UPSERT TelegramInboundUpdate(update_id) → если уже было, RETURN
                          └── IngestService.ingest({
                                tenantId, sourceId: systemTelegramSource(tenantId).id,
                                sourceExternalId: `tg:${chat.id}:${message.message_id}`,
                                occurredAt: new Date(message.date * 1000),
                                payload: { kind:'telegram_message', text, from:{userId, telegramUserId, username}, chatId },
                                dataClass: 'business'
                              })
```

### 3.4 Поток outbound

```
любой модуль Z → TelegramOutboundService.sendText({userId, text, idempotencyKey?})
              → проверка TelegramAccount для userId
                 ├── нет привязки → throw TelegramAccountNotLinkedError (вызывающий решает что делать)
                 └── есть → BullMQ enqueue {jobId: idempotencyKey ?? uuid()} в очередь 'telegram.outbound'
                        → TelegramOutboundProcessor → TelegramApiClient.sendMessage
                        → лог TelegramOutboundMessage (status=sent/failed, providerMessageId)
```

---

## 4. Технические изменения

### 4.1 База данных (Prisma)

Добавить три новые модели в `backend/prisma/schema.prisma`:

```prisma
model TelegramAccount {
  id               String   @id @default(uuid()) @db.Uuid
  userId           String   @unique @db.Uuid
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  telegramUserId   BigInt   @unique         // from.id Telegram (int64)
  telegramUsername String?                  // @username, без @, может меняться
  telegramChatId   BigInt                   // chat.id (для private = telegramUserId, но храним явно)
  languageCode     String?
  linkedAt         DateTime @default(now())
  linkedByCodeId   String?  @db.Uuid        // какой код использовался
  lastSeenAt       DateTime?
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@index([telegramUserId])
}

model TelegramLinkCode {
  id          String   @id @default(uuid()) @db.Uuid
  tenantId    String   @db.Uuid             // Org, в которой выдан код
  org         Org      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  userId      String   @db.Uuid             // кому предназначен
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  codeHash    String                        // bcrypt/sha256 от кода (сырой код не храним)
  expiresAt   DateTime                      // now() + 7d (см. §9)
  consumedAt  DateTime?
  consumedByTelegramUserId BigInt?
  createdAt   DateTime @default(now())
  createdBy   String   @db.Uuid             // админ, выдавший код
  revokedAt   DateTime?

  @@index([tenantId, userId])
  @@index([expiresAt])
}

model TelegramInboundUpdate {   // только для идемпотентности webhook
  updateId   BigInt   @id       // Telegram update.update_id (уникален на бот)
  receivedAt DateTime @default(now())

  @@index([receivedAt])
}

model TelegramOutboundMessage {
  id                String   @id @default(uuid()) @db.Uuid
  tenantId          String   @db.Uuid
  userId            String   @db.Uuid
  telegramAccountId String?  @db.Uuid       // null если в момент enqueue accountId был известен, но к моменту send уже отвязан
  idempotencyKey    String   @unique        // = jobId
  text              String   @db.Text
  status            String                  // 'queued' | 'sent' | 'failed'
  providerMessageId BigInt?                 // Telegram message_id
  error             String?  @db.Text
  enqueuedAt        DateTime @default(now())
  sentAt            DateTime?

  @@index([tenantId, userId])
  @@index([status])
}
```

Расширить:
- `User`: `telegramAccount TelegramAccount?` (back-relation), `telegramLinkCodes TelegramLinkCode[]`.
- `Org`: `telegramLinkCodes TelegramLinkCode[]`.

**Хранение системного `Source`:** для каждой Org при первом inbound из Telegram lazy-upsert
`Source { type: 'employee_telegram', name: 'Telegram (сотрудники)', config: { managed: 'platform' } }`.
Это новое значение enum `SourceType` (или текстовое поле — смотри как реализовано в существующем `Source`).

После правки моделей: `bun run prisma:push && bun run prisma:generate`.

### 4.2 Новые эндпоинты

| Method | URL | Auth | Назначение |
|---|---|---|---|
| `POST` | `/api/v1/employee-channel/telegram/webhook` | `TelegramWebhookGuard` (секрет в header) | приём updates от Telegram |
| `POST` | `/api/v1/admin/employees/:userId/telegram-link` | `CookieAuthGuard + TenantGuard + RBAC employee.telegram.link` | сгенерировать одноразовый код, вернуть `{ code, expiresAt, deepLink }` |
| `DELETE` | `/api/v1/admin/employees/:userId/telegram-link` | same | отозвать активные коды + отвязать аккаунт |
| `GET` | `/api/v1/admin/employees/:userId/telegram-link` | same | статус: `{ linked: bool, telegramUsername?, linkedAt?, activeCode?: {expiresAt} }` |
| `POST` | `/api/v1/admin/telegram/test-send` | `CookieAuthGuard + TenantGuard + RBAC org.admin` | отладочный outbound: `{ userId, text }` → enqueue, вернуть `idempotencyKey` |

Все DTO — через `nestjs-zod`, Swagger обязателен.

**Deep-link формат:** `https://t.me/<bot_username>?start=<code>` — генерируется на backend, отдаётся в ответе для удобства копи-пейста.

### 4.3 Очередь BullMQ

- `telegram.outbound` — добавить в `backend/src/modules/core-queue/queues.ts`.
- Дефолтные `JobsOptions`: `attempts: 5`, `backoff: { type: 'exponential', delay: 5_000 }`, `removeOnComplete: { age: 7*86400, count: 10_000 }`.
- Consumer регистрируется в **процессе воркеров** (`backend/src/workers/main.ts`), **не в HTTP-процессе**.
- При 429 от Telegram (`retry_after`) — respect и `Job.moveToDelayed`.

### 4.4 Системный Source

При первом inbound для tenantId — lazy-upsert одного `Source` per Org:
```
type: 'employee_telegram'
name: 'Telegram (сотрудники)'
config: { managed: 'platform' }   // botToken НЕ хранится здесь, он один на всю Z в ENV
isActive: true
```
Если `SourceType` — enum: добавить значение `employee_telegram`. Иначе — текстовое.

### 4.5 Frontend (admin)

В существующей карточке сотрудника (`frontend/app/(authenticated)/(admin)/...employees/[userId]/page.tsx` или эквивалент — найти текущий путь в `admin`/`orgs` модулях):
- секция **«Telegram-канал»**:
  - если **не привязан** + нет активного кода: кнопка «Выдать код для Telegram» → диалог с кодом + сроком + кнопкой «Скопировать deep-link» + инструкцией «передайте сотруднику ссылку или код, ссылка откроет бота с уже подставленным кодом»;
  - если **есть активный код** (не использован, не истёк): показать оставшееся время и кнопки «Скопировать» / «Отозвать»;
  - если **привязан**: `@username` + дата привязки + кнопка «Отвязать» (с confirm).
- Тексты — **только на русском** (см. feedback_admin_ui_russian_only).
- Слой `api/employee-channel.api.ts` + маппер в `domain/`.

---

## 5. Identity-флоу (детально)

### 5.1 Генерация кода (админ)

`TelegramLinkService.issueCode({ tenantId, userId, issuerUserId })`:
1. Сначала **отозвать** все активные (не consumed, не expired, не revoked) коды этого `userId` — кодов может быть только один активный.
2. Сгенерировать `code` — короткая человекочитаемая строка, **6–8 символов**, алфавит без неоднозначных (без `0/O`, `1/I/l`). Пример: `K7HX4P`.
3. Сохранить `codeHash = sha256(code + Z_TELEGRAM_LINK_CODE_PEPPER)`. Сырой код **возвращается единожды** в ответе и больше не доступен.
4. TTL — **7 дней** (`Z_TELEGRAM_LINK_CODE_TTL_HOURS` в ENV, default 168).

### 5.2 Привязка (`/start <code>` в боте)

`TelegramLinkService.consumeCode({ code, telegram: { userId, chatId, username, languageCode } })`:
1. Найти `TelegramLinkCode` по `codeHash`. Если нет / `expiresAt < now` / уже `consumedAt` / `revokedAt` — ответить пользователю «Код недействителен или истёк, попросите новый у администратора».
2. Проверить: на этот же `telegram.userId` уже нет другого `TelegramAccount`. Если есть и принадлежит другому `User` — ответить «Этот Telegram уже привязан к другому сотруднику. Сначала отвяжите его».
3. Внутри одной транзакции:
   - `TelegramAccount` upsert (`userId`, `telegramUserId`, `telegramUsername`, `telegramChatId`, `languageCode`, `linkedByCodeId = code.id`).
   - `TelegramLinkCode.consumedAt = now(), consumedByTelegramUserId = telegram.userId`.
4. Ответ боту: «Готово, привязали к {User.displayName} в {Org.name}. Можно присылать сообщения сюда же».

### 5.3 Отвязка

- `/unlink` от пользователя или `DELETE /admin/.../telegram-link` от админа: удалить `TelegramAccount` (cascade на back-relation User), отозвать все активные коды этого `userId`.
- Удаление **не** удаляет уже принятые `RawEvent` — это иммутабельная история.

---

## 6. ENV

Добавить в `backend/src/common/config/env.schema.ts` (Zod):

| Переменная | Тип | Default | Описание |
|---|---|---|---|
| `Z_TELEGRAM_BOT_TOKEN` | string (>= 30 chars), **secret** | — (required если фича включена) | токен сервисного бота Z |
| `Z_TELEGRAM_BOT_USERNAME` | string | — | username бота без `@`; для формирования deep-link |
| `Z_TELEGRAM_WEBHOOK_SECRET` | string (>= 32) | — | секрет webhook, проверяется в `X-Telegram-Bot-Api-Secret-Token` |
| `Z_TELEGRAM_LINK_CODE_PEPPER` | string (>= 32) | — | pepper для хеша кода (отдельно от пользовательских паролей) |
| `Z_TELEGRAM_LINK_CODE_TTL_HOURS` | number | `168` (7 дней) | TTL одноразового кода |
| `Z_TELEGRAM_OUTBOUND_RATE_PER_SEC` | number | `25` | глобальный rate-limit на отправку (Telegram Bot API лимит — 30/сек, оставляем запас) |
| `Z_TELEGRAM_INBOUND_RATE_PER_MIN_PER_USER` | number | `60` | inbound rate-limit на одного `telegramUserId` |
| `Z_TELEGRAM_FEATURE_ENABLED` | boolean | `false` | глобальный kill-switch фичи (при `false` webhook возвращает 503, outbound throw'ит `TelegramFeatureDisabledError`) |

**Регистрация webhook у Telegram** — отдельным one-off скриптом `backend/scripts/setup-telegram-webhook.ts`: вызывает `setWebhook` с публичным URL backend'а + `secret_token`. Запускается вручную при деплое.

---

## 7. RBAC

Новые `ResourceType` и actions в `backend/src/modules/rbac/policies/policy.csv`:

- `employee.telegram.link` — generate/revoke/view-status кодов и аккаунтов сотрудника. Default: `owner`, `admin` Org. `member` — нет.
- Webhook эндпоинт **не идёт через Casbin**, у него собственный `TelegramWebhookGuard`.

---

## 8. Безопасность

1. **Webhook-secret** — timing-safe compare (`crypto.timingSafeEqual`); короткий 401 без подробностей при несовпадении.
2. **Никаких бизнес-данных в боте до привязки.** На любое сообщение от непривязанного `telegram.userId` (кроме `/start <code>`) — нейтральный ответ, **без** упоминаний имён/организаций.
3. **Один Telegram-аккаунт = один сотрудник.** Нельзя привязать один TG к двум разным User одновременно.
4. **Коды** — хешируются (sha256 + pepper), сырой код виден один раз при выдаче. Активный код у `userId` всегда максимум один.
5. **`TelegramAccount.telegramUsername`** обновлять при каждом inbound (username в Telegram меняется), но идентификация — только по `telegramUserId`.
6. **Rate-limit inbound** через Redis: ключ `tg:rl:<telegramUserId>:<minute_bucket>`, лимит — `Z_TELEGRAM_INBOUND_RATE_PER_MIN_PER_USER`. Превышение → `429`-эквивалент (но Telegram не ретраит на 429, поэтому возвращаем `200` + ничего не делаем + молчим, чтобы не открывать канал для спама ответами).
7. **Outbound `text`** — не интерполировать пользовательский ввод без экранирования. По умолчанию `parse_mode` НЕ задаём (plain text, безопасно).
8. **Webhook IP-фильтр (опционально):** Telegram публикует диапазоны (`149.154.160.0/20`, `91.108.4.0/22`); если перед backend есть proxy с возможностью фильтра — задокументировать в `infra/`.

---

## 9. Логирование и метрики

Pino-логи (без PII в полях; текст сообщения логировать **только** на DEBUG, не на INFO):
- `telegram.webhook.received` — `{ updateId, hasText }`
- `telegram.link.issued` — `{ tenantId, userId, codeId }`
- `telegram.link.consumed` — `{ tenantId, userId, telegramUserId }`
- `telegram.link.rejected` — `{ reason }`
- `telegram.inbound.ingested` — `{ tenantId, userId, rawEventId }`
- `telegram.outbound.enqueued|sent|failed` — `{ tenantId, userId, jobId, status, error? }`

Prometheus-метрики (`backend/src/common/metrics`):
- `telegram_inbound_total{kind="text|link|unlink|rejected"}`
- `telegram_outbound_total{status="sent|failed|retried"}`
- `telegram_outbound_duration_ms` histogram
- `telegram_link_codes_active` gauge

---

## 10. Критерии готовности (DoD)

- [ ] `bun run typecheck && bun run lint && bun run build` — зелёные на backend и frontend.
- [ ] Юнит-тесты: `TelegramLinkService` (issue/consume/expire/revoke/conflict), `TelegramInboundService` (идемпотентность `update_id`, отказ для непривязанных, успешный путь), `TelegramOutboundService` (enqueue + проброс ошибки `NotLinked`).
- [ ] Integration-тест: webhook → `RawEvent` создан, повторный тот же `update_id` → ровно одна запись.
- [ ] Smoke `backend/scripts/smoke-telegram-channel.ts` — ручная проверка с реальным ботом в dev (по аналогии с `smoke-ingest-fase1.ts`).
- [ ] Swagger `/api/docs` показывает все новые эндпоинты.
- [ ] Метрики и логи отдаются.
- [ ] Frontend: карточка сотрудника показывает выдачу кода / статус / отвязку, тексты на русском.
- [ ] `policy.csv` дополнен, RBAC-тест проходит.
- [ ] ENV-переменные добавлены в `env.schema.ts` (с дефолтами / required-маркерами), в `.env.example` и в `docs/` (если есть deploy-инструкция).
- [ ] Second Brain обновлён: новая заметка [`second-brain/01_projects/employee-channel-telegram.md`](../../second-brain/01_projects/employee-channel-telegram.md); обновлены [`02_architecture/data-model.md`](../../second-brain/02_architecture/data-model.md), [`02_architecture/module-map.md`](../../second-brain/02_architecture/module-map.md), [`01_projects/api-layer.md`](../../second-brain/01_projects/api-layer.md), [`01_projects/admin.md`](../../second-brain/01_projects/admin.md), [`01_projects/workers-queues.md`](../../second-brain/01_projects/workers-queues.md); ссылка в [`second-brain/index.md`](../../second-brain/index.md).
- [ ] Скрипт `setup-telegram-webhook.ts` запускается и регистрирует webhook у Telegram (проверка через `getWebhookInfo`).

---

## 11. Риски и открытые вопросы

1. **Один User в нескольких Org.** В Z есть membership «один User — много Org». Сейчас TZ предполагает `User.activeOrgId` для разрешения tenant'а inbound. Если у сотрудника несколько Org — в MVP отправляем в `activeOrgId`; команда переключения Org из Telegram — vNext (например, `/org <slug>`).
2. **Webhook reliability.** Telegram повторно шлёт update только при не-2xx. Делаем idempotency по `update_id`, но любой `throw` после успешного `IngestService.ingest` приведёт к дубликату на повторе — поэтому idempotency-запись `TelegramInboundUpdate` создавать **до** ingest (или в одной транзакции).
3. **Лимит 30 msg/sec на бота.** Outbound-rate-limit в очереди обязателен. Для bulk-рассылок (если появятся) — отдельный sub-механизм.
4. **Кража кода.** Код передаётся out-of-band (админ сотруднику). Минимизируем риск: TTL 7 дней, длина 6–8 символов из ограниченного алфавита (≈ 2 млрд комбинаций для 8 симв.), активен максимум один на `userId`, после использования отзывается. Брутфорс по hash защищён pepper'ом + rate-limit на эндпоинт `consume` (если решим публиковать) — но `/start <code>` идёт через webhook, лимит уже есть на уровне inbound-rate.
5. **Глобальный bot-token.** Утечка `Z_TELEGRAM_BOT_TOKEN` = захват всех сотрудников. Хранить только в secret-менеджере прод-окружения; в repo — никогда. В случае ротации — переинициализация webhook'а.
6. **Phase 10 vs новый модуль.** Не путать в админке: per-Org `Source(type=bot/telegram)` остаётся для b2b-кейсов («компания подключает свой бот»), а карточка сотрудника управляет только глобальным каналом. Тексты в UI должны быть однозначными.

---

## 12. Фазы реализации

- [ ] **Фаза 1 — Схема и identity.**
  Prisma-модели, `TelegramLinkService` (issue/consume/revoke), admin endpoints + RBAC, юнит-тесты. Без бота.
- [ ] **Фаза 2 — Webhook + inbound.**
  `telegram-bot.module.ts`, `TelegramApiClient` (минимум: `sendMessage`, `setWebhook`, `getMe`), `TelegramWebhookController` + guard, `TelegramInboundService` → `IngestService.ingest`, идемпотентность, rate-limit, smoke с реальным ботом.
- [ ] **Фаза 3 — Outbound.**
  Очередь `telegram.outbound`, `TelegramOutboundService` (DI API), processor в worker-процессе, лог `TelegramOutboundMessage`, метрики, `/admin/telegram/test-send`.
- [ ] **Фаза 4 — Frontend admin.**
  Секция «Telegram-канал» в карточке сотрудника (выдача кода, статус, отвязка), русский UI.
- [ ] **Фаза 5 — Second Brain + ENV + deploy-скрипт.**
  Заметки в `second-brain/`, `setup-telegram-webhook.ts`, `.env.example`, обновление `index.md`.

---

## 13. Итог

_Заполняется по факту реализации: что вошло, что осталось, ссылки на коммиты и smoke-логи._
