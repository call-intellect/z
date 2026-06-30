---
date: 2026-06-28
feature: unified-chat-kora
phase: Ф4a (backend агрегатор «Сообщения»)
branch: feat/unified-chat-kora
distilled: false
---

# Ф4a — бэкенд единого экрана «Сообщения»: /message-threads + /message-search

## Что было поставлено
ТЗ `plans/tz/2026-06-21-unified-chat-kora-tz.md` Ф4 (INV-A1/A3): единый контроллер ленты `/message-threads` (агрегатор по `Conversation` члена с фильтром/сортировкой/поиском по веткам + составной курсор), единый бейдж непрочитанного, полнотекст по телам `/message-search` (GIN), заполнение `Message.contentStripped` плейнтекстом для поиска. НЕ коммитить.

## Как решал
- **stripToPlain** — `backend/src/modules/messaging/services/strip-to-plain.ts` (вынес отдельным файлом → unit-тестируется). Подключён в `MessageService.insertMessageRow`: `contentStripped = stripToPlain(args.contentStripped ?? content)`, пишется на каждой записи (через `insertMessageRow` идут sendMessage/appendTicketMessage/insertHistorical). `content` остаётся зашифрованным — компромисс контракта (поиск требует плейнтекст-индекс).
- **GIN** — `backend/scripts/postgres-init.sql` (НЕ в schema): `Message_contentStripped_gin` на `to_tsvector('russian', coalesce(contentStripped,''))`. Русский словарь — прецедент проекта (`IdeaBlock.search_tsv`/`decisions`/`insights`). Обёрнут в `DO $$ IF table exists`.
- **InboxService** (`services/inbox.service.ts`) + **InboxController** (`inbox.controller.ts`, тег `messaging / inbox`, гарды `CookieAuthGuard,TenantGuard`). Зарегистрированы в `MessagingModule`.
  - `listThreads`: грузит `Conversation` члена (`members.some.userId`), батч-агрегаты (maxSeq groupBy, count groupBy, last-snippet `$queryRaw DISTINCT ON`, имена `user.findMany`, linkedIssue `issue.findMany`), сортирует и пагинирует в памяти. Масштаб раннего пилота это позволяет.
  - `unreadCount`: сумма unread по всем kind, Redis-кэш TTL 15с (`messaging:unread:<tenant>:<user>`).
  - `searchMessages`: `$queryRaw` GIN `@@ plainto_tsquery('russian', q)`, scope члена через JOIN `ConversationMember`+`Conversation`, исключает `deletedAt`.
- **Курсор**: base64url(JSON `{k,id}`), `k` = сорт-ключ (recent=ISO lastMessageAt; active/unread=число, zero-pad 18). After-cursor фильтр `k<cursor.k OR (k==cursor.k AND id<cursor.id)`, вторичная стабильная по id desc. Encode/decode — экспортируемые чистые функции → unit (round-trip + битый курсор → null).
- **backfill** `scripts/backfill-message-contentstripped.ts` (decrypt→strip→update, фильтр `contentStripped:null`, идемпотентно, `--dry-run`/`--limit`) + строка в `apply-prod-deploy.ts STEPS` (`phase:'backfill'`, `skipBootstrap`).

## Что вышло (верификация)
- `typecheck` exit=0; `eslint` моих файлов 0; `build` зелёный.
- `vitest src/modules/messaging` — 125/125 (было 106, +19 новых: strip-to-plain 6, inbox-service 13).
- Acceptance-греп: GIN в postgres-init ✓; InboxController/Service в module ✓; INV-A1 (`status/slaBreachedAt` только ticket, `linkedIssue` только work_chat, иначе null) ✓; `markRead` НЕ дублирован (остался в conversation.controller Ф2).
- prod-deploy-log Шаг 5 (GIN) + Шаг 8 (backfill) + Шаг 12 (smoke) обновлены; TZ Ф4 row → «Ф4a backend DONE».

## Ловушки / чему научился
- **`Issue.conversationId` — скаляр БЕЗ relation** (комментарий в схеме: «связь односторонняя, Issue владеет ссылкой»). У `Conversation` НЕТ reverse `linkedIssue` → нельзя `select linkedIssue`; linkedIssue тяну отдельным `issue.findMany({where:{conversationId:{in:[...]}}})`.
- **`ConversationMember.userId` — тоже скаляр без relation** на User → имена участников отдельным `user.findMany`. Нельзя `members.select.user`.
- `RedisService`/`PrismaService` — `@Global()`, в `MessagingModule` импортов не нужно.
- `Prisma.join(ids)` для `IN (...)` в `$queryRaw`-литерале; tagged-template `$queryRaw` в тестах мокается осмотром склеенного SQL (ветка `plainto_tsquery` vs last-message).

## Не сделал / под вопросом
- **Курсор/сортировка — in-memory** (грузим ВСЕ разговоры члена, потом slice). Для раннего пилота (≈4 юзера) корректно и просто; при росте числа разговоров на пользователя (сотни+) — переписать на SQL-keyset. Зафиксировать в `04_не-сделано` при выходе из пилота.
- Backfill `contentStripped` для старых сообщений — добавлен, но опционален (новые индексируются на записи). На live-БД не прогонял (нет локальной БД в среде агента).
- FE экран «Сообщения» + `<MessageBubble>` (INV-A2) — это Ф4b, вне scope этой задачи.
- НЕ коммитил (по заданию).
