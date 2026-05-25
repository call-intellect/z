---
type: tz
status: ready
feature: β-9 — Глобальный Telegram-бот + GitHub-style приглашения сотрудников
phase: beta-9
date: 2026-05-25
parent: plans/tz/2026-05-22-final-roadmap.md
related:
  - second-brain/01_projects/conversational-channels.md §«Продуктовые принципы каналов (утверждены 2026-05-25)»
  - second-brain/01_projects/conversational-channels.md §«Conversational Channels β-1 — Telegram + MAX adapters»
  - plans/archive/2026-05-23-sba-beta-1-telegram-max-zero-button-ripout.md (β-1 zero-button, реализован)
  - backend/src/modules/conversational/link-code.service.ts
  - backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts
  - backend/src/modules/orgs/org-invitations.service.ts
  - backend/src/modules/mail/mail.templates.ts
  - backend/prisma/schema.prisma (модели Channel, ChannelBinding, OrgInvitation, Membership, UserVerificationToken)
---

# β-9 — Глобальный Telegram-бот + GitHub-style приглашения сотрудников

## 1. Цель и контекст

Сейчас Telegram-бот настраивается per-tenant: каждая компания регистрирует своего бота у `@BotFather` (официального бота Telegram для регистрации других ботов), главный администратор Z прокладывает токен через CLI-скрипт `setup:telegram-bot`. Это нереально для нашей ЦА (директор-собственник + 5–20 сотрудников, часто без технического бэкграунда) и распыляет операционную нагрузку.

Параллельно процесс приглашения сотрудника в компанию в Z даёт **только письмо с временным паролем для веб-кабинета** (`mail.templates.ts:13` — `REGISTER_TEMP_PASSWORD_TEMPLATE`). Привязка к Telegram-боту — отдельный ручной шаг через `/me/channels`, который сотрудник делает уже после входа.

Этим ТЗ закрываем три продуктовых разрыва одним проходом:

1. **Один глобальный бот `@kora_bot` на всю платформу.** Главный администратор Z настраивает его в админ-панели (внутренней админке Z), все компании-клиенты пользуются этим ботом без действий со своей стороны.
2. **Приглашение сотрудника как в GitHub** — одно письмо содержит magic-link (одноразовую ссылку-вход) в кабинет + deep-link (ссылку для прямого открытия бота с pre-генерированным кодом привязки). Сотрудник кликает — и попадает либо в веб-кабинет, либо в бот, без логина/пароля.
3. **Поддержка сотрудников без электронной почты.** Линейный персонал (продавцы, повара, мастера) может работать только через Telegram: директор копирует ссылку приглашения и пересылает руками. Вход в веб-кабинет — через команду в бот.

Все продуктовые решения подтверждены владельцем 2026-05-25 (диалог с архитектором, см. §3). Источник принципов — `second-brain/01_projects/conversational-channels.md` §«Продуктовые принципы каналов».

## 2. Scope

**Входит:**

Слой данных:
- Расслабление обязательности `Channel.tenantId` для `kind='telegram_bot'`: поле становится опциональным; уникальность переключается с `(tenantId, kind)` на условную «`tenantId IS NULL AND kind='telegram_bot' → не более одной строки`» через partial-index.
- Добавление поля `OrgInvitation.linkCode` (одноразовый код для прямой привязки Telegram из письма приглашения) + `OrgInvitation.linkCodeExpiresAt`.
- Расширение enum `VerificationPurpose` значением `magic_link` (или подтверждение существующего, если уже есть — проверить при реализации).
- Расширение enum `ChannelStatus` значением `global_disabled` (когда главный администратор Z выключил глобального бота для всех клиентов).
- TTL `OrgInvitation` 7 дней → 14 дней (изменение константы в коде).

Backend-логика:
- `ConversationalLinkCodeService` расширяется методом `generateInviteCode(userId, orgId, ttlDays=14)` — отдельный класс кодов длительного хранения; ключ Redis `conv:invite:telegram_bot:<code>` → `userId`.
- `OrgInvitationsService.createInvitation` — генерит и привязывает `linkCode` к приглашению, передаёт его в шаблон письма.
- `OrgInvitationsService.acceptInvitation` — обогащается путём «принять без пароля по magic-link»; при первом клике создаётся `User`, `Membership` и `UserVerificationToken(purpose='magic_link')` сразу прожигается, сессия открывается без формы.
- Новый сервис `AccountsService.requestMagicLink(email | botUserId)` — выдаёт одноразовую ссылку на 15 минут для повторного входа.
- Telegram-адаптер: команда `/login` (новая, единственное исключение из правила «zero-button» — она безопасна, не несёт user-input) → выдаёт сотруднику одноразовую ссылку для входа в веб-кабинет.
- `TelegramBotChannelAdapter` находит привязку по `(externalId)` без знания tenantId; tenantId выводит из `User → Membership.orgId`.
- Webhook URL: `POST /api/v1/webhooks/telegram-bot` (без `:tenantId`). Старый URL `/webhooks/telegram-bot/:tenantId` оставляем работающим 30 дней как deprecated path для безопасной миграции.
- Валидация «один пользователь = одна компания» в `OrgInvitationsService.acceptInvitation` и `MembershipsService.create` — если у пользователя уже есть `Membership` с другим `orgId` → `ConflictException` с понятным русским сообщением.
- Cron `org-invitation-reminders.cron`: на 7-й день после `createdAt` (если не accepted и не revoked) — повторное письмо сотруднику + повторный probe директору на 14-й день.

Главная админка Z (внутренняя):
- Новая страница `/admin/system/telegram-bot` (видна только super-admin) с полями: токен бота (зашифрован через существующий `CryptoService`), webhook-secret (`X-Telegram-Bot-Api-Secret-Token`), глобальный выключатель (on/off), редактируемые шаблоны сообщений (приветствие после привязки, отказ привязки, текст для бывших сотрудников), индикатор статуса webhook (доходит ли до нас Telegram).
- Раздел «Привязки сотрудников» — список всех `ChannelBinding(kind='telegram_bot')` по всем клиентам с фильтрами (компания / статус / время последнего сообщения). **Текст сообщений не отображается** (продуктовый принцип №1).
- Кнопка «Перенастроить webhook» — вызывает Telegram API `setWebhook` с актуальным URL.

Кабинет компании-клиента (директор):
- На странице «Сотрудники» — кнопка «Пригласить»: модальное окно с полями имя, должность, роль, электронная почта (опц.). Если почта пуста — после создания приглашения система показывает диалог «Скопировать ссылку для отправки сотруднику вручную» с кнопкой копирования и QR-кодом.
- Карточка сотрудника показывает три статуса привязки бота: «не привязан» / «привязан, активен» / «бот заблокирован сотрудником».
- Кнопка «Отправить приглашение заново» — выпускает новый `linkCode` (старое прожигается) и повторно шлёт письмо.
- Кнопка «Сбросить привязку Telegram» — для случая «сотрудник сменил телефон, не помнит пароль, не имеет почты» (см. §5 в продуктовом решении).

Шаблоны писем:
- Новый шаблон `INVITE_GITHUB_STYLE_TEMPLATE` — magic-link + deep-link в бот в одном письме. На русском, без английских слов (правило `feedback_admin_ui_russian_only.md`).
- Старый `REGISTER_TEMP_PASSWORD_TEMPLATE` помечается deprecated, остаётся работающим для обратной совместимости (внутренние/программные регистрации без OrgInvitation).
- Новый шаблон `INVITE_REMINDER_TEMPLATE` (на 7-й день) — короткое напоминание «вы ещё не приняли».
- Новый шаблон `INVITE_DIRECTOR_TIMEOUT_TEMPLATE` (на 14-й день, директору) — «сотрудник Иван не принял, перевыпустить?».

**Не входит:**
- Бот для не-сотрудников (внешний мир — клиенты компании, поставщики). Откладываем до отдельного ТЗ «CRM-функционал в боте». Сейчас на незнакомца от незнакомого `externalId` бот отвечает «Вы не привязаны к компании, попросите ссылку у руководителя» и игнорирует дальше.
- Групповые чаты компании (бот в общем чате отдела). Откладываем — см. продуктовый принцип №6.
- Двухфакторная авторизация (`2FA`). Magic-link сам по себе двухфакторный (что-то-имеешь = почта/Telegram), полноценный второй фактор — отдельная задача безопасности.
- Smart-CRM-функции бота (распознавание клиента по контексту). Откладываем.
- Миграция MAX-бота на глобальный режим. MAX остаётся per-tenant — это решение только про Telegram. Если в будущем потребуется — отдельное ТЗ по аналогии.
- Привязка по номеру телефона / SMS. Не в этой итерации.

## 3. Принятые решения

Все 12 — из продуктового диалога 2026-05-25 (вопросы пользователя + ответы архитектора, утверждено владельцем):

1. **Главный администратор настраивает бота из админской панели.** CLI-скрипт `setup:telegram-bot` остаётся как резервный путь («сломалась веб-админка — есть план Б»).
2. **Главный администратор видит метаданные привязок по всем клиентам, но не содержимое переписки.** Жёсткое продуктовое обещание клиенту, отражается в Договоре оферты.
3. **Приглашать сотрудников могут только владелец (`owner`) и администратор (`admin`) компании-клиента.** Руководитель отдела (`team_lead`) и обычный сотрудник — не могут. Снять ограничение можно будет позже, когда появится спрос.
4. **Электронная почта опциональна.** Если её нет — директор получает ссылку для ручной отправки + QR-код. Вход в веб-кабинет такому сотруднику — через бот командой `/login`.
5. **Magic-link вместо паролей по умолчанию.** Старый шаблон `REGISTER_TEMP_PASSWORD_TEMPLATE` помечается deprecated. Постоянный пароль — опция в настройках профиля.
6. **Срок жизни приглашения — 14 дней.** Напоминания: на 7-й день сотруднику, на 14-й день директору.
7. **Уволили сотрудника:** одно прощальное сообщение от бота «Вы отключены от компании [Название]», дальше молчим. Данные сотрудника за период работы — архивируются, не удаляются.
8. **Сменил телефон/Telegram:** сам через кабинет «Отвязать → Привязать заново». Если потерял всё — директор жмёт «Сбросить привязку».
9. **Заблокировал бота:** в кабинете директора жёлтый значок «Бот заблокирован». Уведомления копятся в веб-«Входящих» + на почту, если есть. Через 30 дней неактивности — карточка переходит в «неактивен».
10. **По умолчанию в бот летят:** задачи на меня со сроком сегодня/завтра, пробы (короткие AI-уточнения), упоминания меня. Дайджесты/отчёты — выключены, включаются галочкой. Тихие часы 22:00–08:00, срочное всё равно идёт.
11. **На MVP — только личка, без групповых чатов.** Групповые чаты — отдельная фича по запросу.
12. **Бот не пишет первым незнакомым людям.** Внешний мир (не-сотрудники) может только написать сам; бот спрашивает «вы кто?», заявка попадает в кабинет директора на подтверждение.

Дополнительные технические решения:

13. **Один пользователь = одна активная компания (`Org`).** Реализуется как валидация в сервисе, не как `UNIQUE` в БД. Модель `Membership` остаётся many-to-many для будущей гибкости. При попытке принять второе приглашение → `ConflictException` «Вы уже состоите в компании [Название старой Org]. Чтобы перейти в новую — попросите администратора старой исключить вас».
14. **Глобальный канал — одна строка в таблице `Channel` с `tenantId IS NULL` и `kind='telegram_bot'`.** Заводится миграционным скриптом при первом push'е. Существующие per-tenant Telegram-каналы — миграция переносит их `ChannelBinding`-и на глобальный канал, удаляет per-tenant `Channel`-записи (с уведомлением в лог). Per-tenant токены не теряются — записываются в системные настройки как «архив миграции».
15. **`linkCode` приглашения хранится в Redis, а не только в БД.** В БД `OrgInvitation.linkCode` — для аудита и перевыпуска. В Redis `conv:invite:telegram_bot:<code>` → `userId` с TTL 14 дней — для горячего пути ботом.
16. **Сообщения бота сотруднику после увольнения** — отдельный шаблон в админ-настройках, редактируется главным администратором.

## 4. Зависимости

- α-1 (`done`) — `ConversationalService`, `ChannelBinding`, `Notification` / `NotificationDelivery`.
- β-1 (`done`) — `TelegramBotChannelAdapter`, intent classification, link-code базовый.
- `orgs` (`done`) — `OrgInvitationsService`, `MembershipsService`.
- `mail` (`done`) — `MailService` для отправки писем.
- `accounts` (`done`) — `AccountsService.register`, сессии, `passwordHash` опциональный.
- `rbac` (`done`) — роли `owner` / `admin` / `manager` / `user`.
- `common/crypto` (`done`) — `CryptoService.encrypt` (AES-256-GCM) для хранения токена бота в БД.

## 5. Изменение схемы базы данных

**Проверено по фактическому состоянию `schema.prisma` 2026-05-25.** Текущие enum-значения: `ChannelStatus { active, disabled, broken }`, `VerificationPurpose { password_reset, account_restore }`. К ним добавляются недостающие значения.

```prisma
// Channel: tenantId становится опциональным
model Channel {
  id           String           @id @default(cuid())
  tenantId     String?          // было: String (required). Теперь nullable — для глобальных каналов.
  kind         ChannelKind
  direction    ChannelDirection
  config       Json             @default("{}")
  status       ChannelStatus    @default(active)
  maxDataClass DataClass        @default(internal)
  brokenReason String?
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt

  org      Org?             @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  bindings ChannelBinding[]

  // Внимание: старый @@unique([tenantId, kind]) ОСТАВЛЯЕМ для per-tenant строк
  // (Postgres трактует NULL ≠ NULL, поэтому несколько глобальных строк с tenantId IS NULL
  // НЕ конфликтуют между собой). Уникальность ровно одного глобального канала на `kind`
  // обеспечивает PARTIAL UNIQUE INDEX, добавленный в `postgres-init.sql` (Prisma пока
  // не поддерживает partial unique декларативно).

  @@unique([tenantId, kind])
  @@index([tenantId, kind])
  @@index([tenantId, status])
  @@map("channels")
}

// OrgInvitation: добавляем поля для magic-link и Telegram deep-link
model OrgInvitation {
  // existing fields…
  linkCode            String?    @unique  // одноразовый код для бота (hex(12) от ConversationalLinkCodeService)
  linkCodeUsedAt      DateTime?            // когда код прожгли (привязка Telegram состоялась)
  magicTokenHash      String?    @unique   // sha256 magic-link-токена (по аналогии с UserVerificationToken.tokenHash)
  magicTokenUsedAt    DateTime?
  reminderSentAt      DateTime?            // когда отправили напоминание на 7-й день
  directorNotifiedAt  DateTime?            // когда уведомили директора на 14-й день
}

// ChannelStatus — расширяем существующий enum
enum ChannelStatus {
  active
  disabled
  broken
  global_disabled  // NEW — только для глобального Telegram-канала (kill-switch главного админа)
}

// VerificationPurpose — расширяем существующий enum
enum VerificationPurpose {
  password_reset
  account_restore
  magic_link   // NEW — одноразовый вход без пароля
  invite_accept // NEW — magic-token, приклеенный к OrgInvitation
}
```

Дополнительный raw-SQL — добавить в `backend/scripts/postgres-init.sql` (применяется через существующий `bun run apply-postgres-init`):
```sql
-- β-9: ровно одна запись глобального канала на kind (tenantId IS NULL).
CREATE UNIQUE INDEX IF NOT EXISTS "channels_global_unique"
  ON "channels" ("kind")
  WHERE "tenantId" IS NULL;
```

## 6. Patch / миграция данных

**One-off скрипт** `backend/scripts/migrate-telegram-channels-to-global.ts` (правила `safe-seed-rules.md` — отдельный patch-скрипт, не часть seed):

1. Прочитать все `Channel` где `kind='telegram_bot'`, `tenantId IS NOT NULL`.
2. Если их 0 — создать одну запись глобального канала (`tenantId=NULL`, `config={}`), вывести инструкцию «настройте токен в админ-панели».
3. Если ровно 1 — переименовать её в глобальную: `UPDATE channels SET tenantId=NULL WHERE id=…`, перенести `config` (токен бота) на глобальный канал, **сохранить старый `tenantId` в `config.legacyTenantId`** для аудита.
4. Если >1 — выбрать самый свежий (`updatedAt DESC`), сделать его глобальным, остальные пометить `status='broken'` с `brokenReason='migrated-to-global'`. В лог — список migrated `tenantId` с указанием «токены сохранены в `config.legacyTokens[]` для ручного разбора главным администратором».
5. Все `ChannelBinding` где `channelId` указывал на старые per-tenant Telegram-каналы — `UPDATE channel_bindings SET channelId=<global_channel_id>`.
6. Логировать каждый шаг (`logger.log`), не молчать.

Запуск: `bun run backend/scripts/migrate-telegram-channels-to-global.ts`. Идемпотентен (повторный запуск ничего не ломает).

## 7. REST API

Новые/изменённые эндпоинты (все DTO через `nestjs-zod`, Swagger обязателен):

| Метод | Путь | Назначение | Доступ |
|---|---|---|---|
| `GET` | `/api/v1/admin/system/telegram-bot` | Получить текущие настройки бота (без секретов) | super-admin |
| `PUT` | `/api/v1/admin/system/telegram-bot/token` | Установить/обновить токен бота | super-admin |
| `PUT` | `/api/v1/admin/system/telegram-bot/webhook` | Перенастроить webhook | super-admin |
| `PUT` | `/api/v1/admin/system/telegram-bot/templates` | Редактировать шаблоны сообщений бота | super-admin |
| `PUT` | `/api/v1/admin/system/telegram-bot/status` | Включить/выключить бота глобально | super-admin |
| `GET` | `/api/v1/admin/system/telegram-bot/bindings` | Список привязок по всем клиентам с фильтрами | super-admin |
| `POST` | `/api/v1/accounts/magic-link/request` | Запросить magic-link на электронную почту | публичный (rate-limit) |
| `POST` | `/api/v1/accounts/magic-link/consume` | Прожечь magic-link, открыть сессию | публичный (одноразовый) |
| `POST` | `/api/v1/orgs/:orgId/invitations` | (existing) — расширяется: возвращает `linkCode` и `manualShareUrl` для случая без почты | owner / admin |
| `POST` | `/api/v1/orgs/:orgId/invitations/:id/resend` | Перевыпустить ссылку приглашения | owner / admin |
| `POST` | `/api/v1/me/channels/telegram_bot/reset` | Сбросить мою привязку Telegram (для смены телефона) | self |
| `DELETE` | `/api/v1/orgs/:orgId/members/:userId/telegram-binding` | Сбросить привязку сотрудника (директор за него) | owner / admin |
| `POST` | `/api/v1/webhooks/telegram-bot` | (новый) — глобальный webhook без `:tenantId`. Старый `/webhooks/telegram-bot/:tenantId` сохраняется на 30 дней как deprecated. | публичный (verify `X-Telegram-Bot-Api-Secret-Token`) |

## 8. BullMQ worker'ы и cron'ы

Новые:

- `org-invitation-reminders.cron` — раз в час, ищет:
  - `OrgInvitation` где `status='pending'`, `createdAt < now() - 7d`, `reminderSentAt IS NULL` → отправляет напоминание сотруднику, ставит `reminderSentAt=now()`.
  - `OrgInvitation` где `status='pending'`, `createdAt < now() - 14d`, `directorNotifiedAt IS NULL` → отправляет уведомление директору (через `ConversationalService.sendNotification`), ставит `directorNotifiedAt=now()`.
- `channel-binding-inactivity.cron` — раз в день, ищет `ChannelBinding` где `verifiedAt IS NOT NULL`, последнее входящее сообщение `< now() - 30d`, статус привязки `bot_blocked` → переводит карточку сотрудника в `inactive`, шлёт уведомление директору.

Существующий `ConversationalSendWorker` — без изменений (он не знает про tenantId канала).

## 9. LlmTaskType регистрация

Нет новых.

## 10. RBAC ResourceType

Расширения существующих:

- `system_telegram_bot` — новый ResourceType, доступ только `is_super_admin=true`. Действия: `read` / `write_token` / `write_webhook` / `write_templates` / `toggle` / `read_bindings`.
- `org_invitation` — уже есть, расширяем действиями `resend` / `reset_member_binding` для `owner` / `admin`.

## 11. Метрики Prometheus

- `invite_created_total{has_email}` — counter; `has_email ∈ true|false`.
- `invite_accepted_total{path}` — counter; `path ∈ magic_link|password|telegram_first`.
- `invite_reminder_sent_total{day}` — counter; `day ∈ 7|14`.
- `invite_expired_total` — counter (истекли без accept).
- `magic_link_request_total{outcome}` — `sent|rate_limited|user_not_found`.
- `magic_link_consume_total{outcome}` — `ok|expired|already_used|invalid`.
- `telegram_bot_global_webhook_received_total{type}` — counter (после миграции на глобальный путь).
- `telegram_bot_unknown_sender_total` — counter (написал незнакомый `externalId`).

## 12. Frontend

Главная админка Z (super-admin, существующая `app/(admin)/admin/system/...`):
- Новая страница `/admin/system/telegram-bot` — настройки бота + список привязок.
- Все строки UI на русском (правило `feedback_admin_ui_russian_only.md`). Английские слова, если технически неизбежны (например — токен, webhook), пишутся в скобках русским пояснением при первом упоминании.

Кабинет директора-клиента (существующий `app/(authenticated)/team/...`):
- Кнопка «Пригласить сотрудника» — новое модальное окно с полями + опциональной почтой.
- Карточка сотрудника — статус привязки бота + кнопки «Перевыпустить ссылку», «Сбросить привязку Telegram».
- После создания приглашения без почты — модальное окно «Скопировать ссылку для отправки сотруднику» с QR-кодом.

Кабинет сотрудника:
- Страница `/me/channels` — статус «Telegram привязан» с кнопкой «Отвязать».
- Уже существующая страница `/me/profile` — добавляется секция «Уведомления в Telegram» с 6–8 галочками (по умолчанию: задачи, пробы, упоминания включены; дайджесты, групповые обсуждения, рекомендации выключены).

UI строится по правилам `frontend-rules.md`: слои `ApiDto → DomainModel → UiModel`, единый `apiClient`.

## 13. ENV переменные

- `KORA_BOT_USERNAME=@kora_bot` — имя бота для построения deep-link `https://t.me/<KORA_BOT_USERNAME>?start=<code>`. Без `@` в значении.
- `INVITE_TTL_DAYS=14` — срок жизни приглашения.
- `INVITE_REMINDER_DAYS=7` — на какой день отправить повтор сотруднику.
- `MAGIC_LINK_TTL_MINUTES=15` — TTL одноразовой ссылки входа.
- `MAGIC_LINK_RATE_LIMIT_PER_HOUR=5` — защита от спама запросами magic-link на одну почту.
- `INACTIVE_BINDING_DAYS=30` — через сколько дней привязка с заблокированным ботом помечает сотрудника `inactive`.

Существующие `TELEGRAM_BOT_API_BASE`, `TELEGRAM_BOT_GLOBAL_RPS`, `CONVERSATIONAL_LINK_CODE_TTL_SEC` — не меняются.

## 14. Шаблоны писем

Новый `INVITE_GITHUB_STYLE_TEMPLATE` (черновик, окончательный текст — на этапе реализации после согласования с UX-копирайтером):
```
Здравствуйте, {{name}}!

{{inviterName}} приглашает вас в компанию «{{orgName}}» в Коре —
память вашей компании, которая помнит за всю команду.

Зайти в кабинет одним кликом:
{{magicLinkUrl}}

Получать задачи и писать заметки прямо из мессенджера —
откройте нашего бота:
{{telegramDeepLink}}

Ссылка действует {{ttlDays}} дней. Если вы не ждёте такого
приглашения — просто проигнорируйте это письмо.

— Команда Коры
```

Новый `INVITE_REMINDER_TEMPLATE` (7-й день, сотруднику):
```
Здравствуйте, {{name}}!

Неделю назад {{inviterName}} пригласил вас в компанию
«{{orgName}}» в Коре. Ссылка действует ещё 7 дней.

Войти в кабинет:
{{magicLinkUrl}}

Открыть бота:
{{telegramDeepLink}}

— Команда Коры
```

Новый `INVITE_DIRECTOR_TIMEOUT_TEMPLATE` (14-й день, директору):
```
Здравствуйте, {{directorName}}!

Сотрудник {{employeeName}} ({{employeeEmail}}) так и не принял
приглашение в «{{orgName}}». Ссылка истекла сегодня.

Перевыпустить приглашение или удалить карточку —
в разделе «Сотрудники» вашего кабинета:
{{teamPageUrl}}

— Команда Коры
```

Существующий `REGISTER_TEMP_PASSWORD_TEMPLATE` — помечается deprecated в комментарии, но остаётся работающим (используется системными/программными регистрациями вне OrgInvitation, например при импорте из внешних источников).

## 15. Фазы реализации

**Фаза 1 — Схема и миграция (полдня).**
- Изменить `Channel.tenantId` на nullable, добавить partial unique index в `apply-postgres-init`.
- Добавить поля в `OrgInvitation`, расширить `ChannelStatus`.
- `bun run prisma:push` (правило `prisma-db-push-rules.md` — никаких `migrate`).
- `bun run prisma:generate`.
- Скрипт `migrate-telegram-channels-to-global.ts`, smoke-проверка на dev-БД.

**Фаза 2 — Backend: глобальный канал и webhook (1 день).**
- Создание глобального `Channel` через seed-incremental.
- Новый эндпоинт `POST /api/v1/webhooks/telegram-bot` без `:tenantId`.
- Адаптер: лукап `ChannelBinding` без знания tenantId.
- Старый эндпоинт `/webhooks/telegram-bot/:tenantId` остаётся, но переадресует на новый (deprecation 30 дней).
- Unit-тесты адаптера.

**Фаза 3 — Backend: magic-link и приглашения (1.5 дня).**
- `AccountsService.requestMagicLink` / `consumeMagicLink`.
- Расширение `OrgInvitationsService.createInvitation` (linkCode, magicTokenHash, опциональная почта).
- `OrgInvitationsService.acceptViaMagicLink` — новый метод.
- Валидация «один пользователь = одна Org».
- Контракт `POST /api/v1/orgs/:orgId/invitations` обогащается полями ответа `linkCode`, `manualShareUrl`, `qrCodeDataUrl`.
- Cron `org-invitation-reminders.cron`.
- Шаблоны писем.
- Unit/integration-тесты.

**Фаза 4 — Главная админка Z (1 день).**
- Страница `/admin/system/telegram-bot` (frontend).
- Эндпоинты `/admin/system/telegram-bot/*` (backend).
- Список привязок с фильтрами.
- Тест-сценарий ручной: сменить токен, перенастроить webhook, отключить бота — смотрим в Telegram, что бот перестал отвечать.

**Фаза 5 — Кабинет директора (1.5 дня).**
- Новый модал «Пригласить сотрудника».
- Карточка сотрудника со статусом привязки и действиями.
- Модал «Скопировать ссылку + QR» для приглашения без почты.
- E2E-тест сценария «директор пригласил 3 сотрудников: с почтой, без почты, повторное приглашение».

**Фаза 6 — Команда `/login` в боте + кабинет сотрудника (1 день).**
- Адаптер: обработка `/login` (выпускает magic-link через бот).
- Страница `/me/channels` — статус, отвязать.
- Страница `/me/profile` — секция уведомлений с 6–8 галочками.
- Unit-тесты.

**Фаза 7 — Smoke на проде + рефлексия (полдня).**
- Документация для главного администратора Z (как настроить бота через админ-панель).
- `SMOKE.md` обновляется под глобальный режим.
- Рефлексия в `second-brain/05_история/`.

**Итого:** 7–8 рабочих дней одного разработчика. С учётом обзоров и непредвиденного — 2 недели календарных.

## 16. Команды сборки и проверки

После каждой фазы:
- `cd backend && bun run typecheck`
- `cd backend && bun run lint`
- `cd backend && bun run test:unit`
- `cd frontend && bun run typecheck`
- `cd frontend && bun run lint`

Перед merge финальной фазы:
- `cd backend && bun run test:integration`
- `cd backend && bun run test:e2e`
- `cd backend && bun run build`
- `cd frontend && bun run build`

## 17. Откат (rollback)

Если на проде после деплоя что-то пошло не так:

1. Глобальный выключатель в `/admin/system/telegram-bot` → «Выключить бота» (`ChannelStatus.global_disabled`). Бот замолкает для всех клиентов.
2. Скрипт `migrate-telegram-channels-back.ts` (написать в фазе 1 как пару к forward-миграции) — возвращает per-tenant каналы из `config.legacyTenantId` + `config.legacyTokens[]`.
3. Откат кода — обычным `git revert` + `bun run prisma:push` (вернётся к старой схеме).

## 18. Открытые вопросы (для разработчика на этапе реализации)

1. **Как разместить globally-unique constraint в Prisma-схеме** — `@@unique([tenantId, kind])` в Postgres c NULL рассматривается как «NULL не равен NULL», поэтому уникальность через partial index в raw-SQL. Уточнить, что Prisma-валидация не сломается на двух глобальных каналах (она пропустит, БД отвергнет).
2. **`@BotFather` username бота** — на момент написания ТЗ владелец не назвал финальное имя бота. Условно `@kora_bot`. На фазе 7 поменять в `ENV` на финальное.
3. **Дизайн QR-кода в модале «Скопировать ссылку»** — использовать существующую библиотеку (проверить `frontend/package.json`) или добавить новую (например, `qrcode`). Решение в фазе 5.
4. **Параллельный режим со старыми per-tenant ботами в течение deprecation-окна** — нужна ли заставить старые webhook URL-ы автоматически 301-редиректить на новый, или просто принять и обработать? На фазе 2 — взять «принять и обработать с предупреждением в лог».
