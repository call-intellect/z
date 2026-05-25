---
date: 2026-05-25
feature: β-9 — глобальный Telegram-бот + GitHub-style приглашения
type: reflection
distilled: false
related:
  - plans/tz/2026-05-25-telegram-bot-global-and-invites.md
  - second-brain/01_projects/conversational-channels.md §«Продуктовые принципы каналов»
commits:
  - 82af541 docs(second-brain): продуктовые принципы каналов + β-9 раздел
  - d011831 feat(channels,orgs,accounts): β-9 backend (Phase 1+2+3)
  - 913dd1e feat(ui,admin,me): β-9 UI (Phase 4+5+6)
---

# β-9 — оркестрация 4-волновая (schema → backend → UI → smoke)

## Что было поставлено

Пользователь сначала отыграл продуктовое обсуждение (12 вопросов о
Telegram-боте, приглашениях, multi-tenancy), потом сказал «теперь ты как
оркестратор берёшь ТЗ, отдаёшь агентам, отвечаешь на вопросы». Поручено:

- Закрыть Telegram-бот в **глобальную** модель (один бот на всю платформу
  Кора, не per-tenant как раньше).
- GitHub-style приглашения сотрудников: одно письмо = magic-link для
  кабинета + deep-link для бота. Email опциональный (для линейного
  персонала).
- Главная админка Z (super-admin) — управление токеном, webhook,
  шаблонами, статусом.
- Кабинет директора: модал «Пригласить сотрудника» + карточка со статусом
  привязки.
- Кабинет сотрудника: «Мои каналы» + настройки уведомлений Telegram.
- Команда `/login` в боте → magic-link на 15 минут.
- Валидация «один пользователь = одна Org» на уровне сервиса.
- Принцип «приватность переписки клиента — святое»: super-admin не читает
  содержимое сообщений.

## Как решал — 4 волны

### Wave 1 — Schema + миграции (я сам, без агентов)

[`backend/prisma/schema.prisma`](../../backend/prisma/schema.prisma):
- `Channel.tenantId` → `String?` (nullable для глобальных каналов).
- `ChannelStatus.global_disabled` — kill-switch.
- `VerificationPurpose.magic_link` + `invite_accept`.
- `OrgInvitation.email` → `String?`; добавлены `linkCode`, `linkCodeUsedAt`,
  `magicTokenHash`, `magicTokenUsedAt`, `reminderSentAt`,
  `directorNotifiedAt`.

[`backend/scripts/postgres-init.sql`](../../backend/scripts/postgres-init.sql):
- Partial unique index `channels_global_unique ON channels(kind) WHERE tenantId IS NULL`
  — гарантирует ровно одну глобальную запись на kind (Prisma не умеет
  partial unique декларативно).

[`backend/scripts/migrate-telegram-channels-to-global.ts`](../../backend/scripts/migrate-telegram-channels-to-global.ts)
+ парный rollback — 5 case-split'ов A..E с dry-run, сохранением legacy
токенов в `config.legacyTokens[]`.

Verify: `bun run prisma:generate` ok.

### Wave 2 — Backend параллельно (2 агента, общий коммит)

Стратегия: Phase 1 в одиночку не пройдёт typecheck (sruct.prisma меняет
обязательность, а backend ожидает required). Поэтому объединил Phase 1+2+3
в один зелёный коммит. Запустил **двух параллельных general-purpose
агентов** на разных модулях:

- **Agent A — Phase 2 (глобальный канал, webhook, telegram-bot.adapter)**:
  `backend/src/modules/conversational/adapters/telegram-bot/**`,
  `setup-telegram-bot.ts`, `seed-global-channels.ts`, метрики.
- **Agent B — Phase 3 (orgs/accounts/mail для magic-link + invites)**:
  `backend/src/modules/orgs/**`, `accounts/**`, `mail/**`, `config/**`,
  cron, шаблоны писем.

Распределение зоны: разные модули, общий файл только
`business-metrics.service.ts` (оба добавили counter'ы). Сделал факт-чек
после агентов: `grep` на 6 ключевых имён метрик подтвердил что оба блока
on board без перетирания.

**Добавил сам**: `AccountsController.acceptInvitationMagicLink` endpoint
(Agent B оставил callback-based `acceptViaMagicLink`, нужен HTTP-обёртка
для frontend Wave 3). + `accountsService.acceptInvitationMagicLink` метод
с placeholder email для случая без почты (`noemail-<cuid>@kora.local`).

Verify: typecheck 0 errors, 133 теста зелёные (12 файлов). **Commit
`d011831`**, 31 файл, 3727+/281−.

### Wave 3 — UI параллельно (3 агента) + один backend-фикс

Запустил **трёх параллельных агентов** на разных слоях фронтенда:

- **Agent C — Phase 4 (super-admin)**: новая страница
  `/admin/system/telegram-bot` + backend модуль
  `backend/src/modules/admin/system/telegram-bot/` (6 эндпоинтов,
  SuperAdminGuard, 7 unit-тестов).
- **Agent D — Phase 5 (кабинет директора)**: модал «Пригласить» в
  `/settings/organization`, модал «Скопировать ссылку» с QR через
  api.qrserver.com (TODO заменить на local lib).
- **Agent E — Phase 6 (кабинет сотрудника + /login)**: TelegramCard в
  `/me/channels`, страница `/me/notifications-telegram` с 7 галочками + тихими
  часами. Backend `/login` команда в telegram-bot.adapter +
  `requestMagicLinkForBot` internal метод.

**Критичная находка Agent D**: backend `buildMagicLinkUrl` строил
`/invitations/accept?token=`, а frontend route `app/(authenticated)/invitations/[token]/`.
URL mismatch → magic-link 404'нулся бы + был бы в authenticated layout
(требовал бы логин до того, как пользователь его получил).

**Фикс сам** (2-line change + новый route):
1. Backend: `buildMagicLinkUrl` → `/invite/<magicToken>`.
2. Frontend: создал новый **публичный** route `app/invite/[token]/` без
   `(authenticated)` группы. Клиент дёргает
   `POST /accounts/invitations/accept-magic` (Wave 2), Set-Cookie открывает
   сессию.
3. Обновил тест `org-invitations.service.spec.ts` под новый формат URL.

Verify: backend typecheck 0, frontend typecheck 0, 127 тестов зелёные (10
файлов). **Commit `913dd1e`**.

### Wave 4 — SMOKE.md + рефлексия (я сам)

Обновил `backend/src/modules/conversational/adapters/telegram-bot/SMOKE.md`
под глобальный режим: новые шаги (`/login`, GitHub-style приглашение,
незнакомый отправитель, kill-switch), команды миграции, два пути setup
(CLI и админ-панель), новые метрики, rollback-инструкция.

## Что вышло

- 7 фаз ТЗ закрыты в 4 волны.
- 3 коммита: `82af541` (принципы), `d011831` (backend), `913dd1e` (UI).
- Suite: 127 тестов зелёные в фокусных папках, backend+frontend typecheck
  0 errors.
- 9 новых эндпоинтов + 6 новых cron-блоков + 8 новых метрик Прометея.
- 3 новых шаблона писем (русский, без английских слов, по правилу
  `feedback_admin_ui_russian_only`).
- 8 новых ENV под группой `cfg.invites`.
- Параллельных сессий было ≥1 (другая сессия закоммитила за время моей
  работы `e53bdeb feat(admin): Фаза 0 — фундамент редизайна админки`).
  Их работа не пересекалась с моей по модулям, кроме `admin.module.ts`
  (там Agent C добавил регистрацию `AdminTelegramBotController` — мы оба
  попали в один коммит другой сессии без конфликта).

## Чему научился

### 1. Объединять волны под единый зелёный typecheck
Phase 1 (schema) изолированно ломает backend (типы Channel меняют
обязательность). Сначала хотел три отдельных коммита, но решил объединить
Phase 1+2+3 в один зелёный коммит после двух параллельных агентов. Это
требовало пропустить запуск typecheck между Wave 1 и Wave 2 (известно
что красный), и проверять только после Wave 2. Правило: **если фаза
А делает api-breaking, и фаза Б фиксит usage, коммитить вместе с зелёной
verify, не порознь.**

### 2. Параллельные агенты на одном файле метрик — добавлять блоки в РАЗНЫЕ места класса
`business-metrics.service.ts` тронули и Agent A, и Agent B. Edit-инструмент
работает с снапшотом — если оба прочитали файл, потом оба написали Edit,
могли перетереть. Здесь обошлось, потому что Edit'ы были в РАЗНЫЕ места
класса (один в конец, другой в середину). Правило: **в промпте агенту
явно указывать «добавляй блок в конец класса, не в середину»** для
безопасности параллельной правки.

### 3. URL contract между frontend и backend — единая точка истины
Я **сам** написал ТЗ с URL `/invitations/accept?token=`, не сверив с
существующим frontend route. Agent D обнаружил mismatch на этапе UI.
Можно было найти раньше — `grep -r '/invitations' frontend/` за 5 секунд.
Правило: **при написании ТЗ для URL — обязательно grep'нуть существующие
routes на frontend перед фиксацией.** Это в `core-engineering-standards`
надо добавить как чек-лист.

### 4. Циклы зависимостей решаются callback-инверсией
Agent B в `acceptViaMagicLink` использовал callback-параметры
(`upsertUserByEmail`, `createUserWithoutEmail`, `issueSession`) вместо
прямого импорта `AccountsService` — чтобы избежать цикла
OrgsModule ↔ AccountsModule. Это **более чистый паттерн чем
forwardRef**: сервис остаётся pure, а композиция случается в endpoint.
Я добавил endpoint в `AccountsController` (composition layer уже импортит
OrgsModule), всё связалось без forwardRef.

### 5. Параллельные сессии могут «зацепить» твои файлы в свой коммит
Между моими волнами другая сессия сделала коммит, который **захватил**
мою правку Agent C в `admin.module.ts` (потому что у них видимо
`git add` зашёл широко). Не моя проблема, но повод для аккуратности:
после Edit'а — проверять `git status`, и если файл уже committed без
твоего участия — не пытаться его коммитить ещё раз.

### 6. SMOKE.md был трогаем «извне» во время Write
При попытке Edit'ить SMOKE.md второй раз получил «File has been modified
since read». Re-read показал что моя первая правка осталась, но reminder
сигналит как conflict. Не critical — Write со свежим Read разрулил. Урок:
**на длительных Edit-цепочках одного файла лучше один Write, чем серия
Edit'ов**, особенно если есть параллельные процессы.

## Открытые вопросы для будущих итераций

1. **`POST /me/channels/telegram_bot/reset`** на backend не реализован
   (UI graceful-показывает «попросите руководителя»). Доделать в
   отдельном маленьком коммите.
2. **`GET /orgs/:id/members`** не возвращает `telegramBindingStatus` —
   карточка сотрудника без цветной индикации. Нужен JOIN по
   `ChannelBinding` в `OrgsService.listMembers`.
3. **QR-код через external CDN api.qrserver.com** — заменить на local
   `qrcode` lib при следующей итерации фронта.
4. **Меню «Telegram-бот» в admin sidebar пока скрыто** —
   `navigation.ts` редактирован параллельной сессией, не коммитил во
   избежание конфликта. Страница доступна по прямому URL
   `/admin/system/telegram-bot`. Восстановить пункт меню — отдельным
   коммитом после согласования с владельцем admin redesign.
