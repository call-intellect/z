---
date: 2026-06-24
feature: chatbox-dialogs-viewer
branch: feature/chatbox-customer-vs-manager-split
---

# Просмотр забранных диалогов ChatBox (список по дате + чтение переписки)

## Что было поставлено
Владелец: в настройках источника ChatBox нужно видеть забранные диалоги с сортировкой/фильтром по дате (вчера/сегодня/любая), открывать чат и читать переписку (только чтение, без отправки) с указанием ролей. Точка входа — «Чаты» рядом с «Менеджеры»/«Клиенты». «Больше информации по тому, что собрали».

## Как решал
REALITY-CHECK показал: **бэк уже на ~80%** — `ChatboxChatsController` отдаёт list/detail/messages с ролями и пагинацией, сортировка по `lastMessageAt desc` есть. Не хватало только date-фильтра и всего FE.
- **Фаза A (BE):** в `ChatboxChatsListQuerySchema` добавлены `from`/`to` (`z.coerce.date`), в `listChats` — диапазон по `lastMessageAt` (gte/lte). +тесты (21 passed).
- **Фаза B (FE):** страницы `/chats/integrations/chatbox/chats` (`ChatboxChatsListClient` — фильтр по дате + «Сегодня»/«Вчера»/«Все», пагинация) и `/chats/.../chats/[id]` (`ChatboxChatViewClient` — транскрипт пузырями с ролями `chatboxSenderRoleLabel`, разделители по дням, плейсхолдеры медиа, «(из Коры)», **без поля ввода**). Хелперы ролей/медиа в `domain/chatbox.ts`, `from`/`to` в `chatbox.api.ts`. Ссылка «Чаты» на странице интеграции.

## Что вышло
- BE typecheck/build=0, спек 21 passed; FE lint 0 errors, build=0; read-only подтверждён грепом (0 input/send).
- Коммиты: `feat(chatbox)` Фаза A, Фаза B, `docs(second-brain,tz)`.

## Чему научился
- **Next-конвенция params в этом репо — `params: Promise<{id}>` + `await params`** (Next 15-style). Первый билд упал: `Type '{ params: {id} }' does not satisfy PageProps`. Старая плоская типизация (`{ params: { id } }`) не проходит. Сверяться с соседним `[id]/page.tsx` (`chats/[id]`, `persons/[id]`) перед созданием динамической страницы.
- Бэк уже умел почти всё — REALITY-CHECK сэкономил половину работы: не дублировал готовые list/detail/messages-эндпоинты, добавил только date-фильтр.

## Prod-операций нет
Только код (FE-страницы + BE date-фильтр). Новых миграций/ENV/скриптов/очередей нет — обычный `docker compose up -d --build backend frontend`.
