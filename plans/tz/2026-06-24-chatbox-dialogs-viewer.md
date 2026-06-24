---
type: tz
status: ready-to-implement
feature: chatbox-dialogs-viewer
date: 2026-06-24
owner: Tozix
relates_to:
  - plans/tz/2026-06-23-chatbox-customer-vs-manager-split.md
  - backend/src/modules/chatbox/chatbox-chats.controller.ts
---

# Просмотр забранных диалогов ChatBox (список по дате + чтение переписки)

## Принцип
В настройках источника ChatBox владелец/участник может **просматривать** забранные диалоги: список чатов с фильтром и сортировкой по дате (вчера / сегодня / любой период) → открыть чат → читать переписку (только чтение, без отправки) с указанием ролей (Клиент / Менеджер / Ассистент / Контроль качества) и временем. Точка входа — «Чаты» рядом с «Менеджеры»/«Клиенты».

## REALITY-CHECK (что уже есть)
- **BE готов на ~80%:** `ChatboxChatsController` ([chatbox-chats.controller.ts:49](backend/src/modules/chatbox/chatbox-chats.controller.ts#L49)) — `GET /api/v1/chatbox/chats` (фильтр status/channelType/customerExternalId + пагинация), `GET /:id` (детали: сессии + мессенджеры), `GET /:id/messages` (пагинация + `order` asc/desc). RBAC `chatbox:read` + `requireConversationAccess` (только участники Org). `listChats` уже сортирует `lastMessageAt desc nulls last` ([chatbox-chats.service.ts:86](backend/src/modules/chatbox/chatbox-chats.service.ts#L86)). DTO `ChatListItemDto`/`ChatDetailDto`/`ChatMessageDto` ([dto/chatbox-chats.dto.ts](backend/src/modules/chatbox/dto/chatbox-chats.dto.ts)) несут `senderType` (роль), `externalCreatedAt`, `lastMessageAt`, `customer`/`responsible`/`clientName`.
- **FE-api готов:** `chatboxApi.listChats/getChat/listMessages` ([chatbox.api.ts:226](frontend/src/api/chatbox.api.ts#L226)) + типы `ChatboxChatApi/ChatboxChatDetailApi/ChatboxMessageApi`.
- **GAP BE:** в `ChatboxChatsListQuerySchema` НЕТ фильтра по дате (`from`/`to`).
- **GAP FE:** нет страниц просмотра — под `frontend/app/(authenticated)/chats/integrations/chatbox/` есть только `managers/` и `customers/`, нет `chats/`. На странице интеграции ([ChatboxIntegrationClient.tsx:499](frontend/app/(authenticated)/chats/integrations/chatbox/ChatboxIntegrationClient.tsx#L499)) есть ссылки «Менеджеры»/«Клиенты», нет ссылки на просмотр чатов. (Существующая кнопка «Чаты» там — это СИНК, не просмотр.)
- Роли: `ChatboxSenderType` = `CLIENT | USER | ASSISTANT | QUALITY_CONTROL` ([schema.prisma:350](backend/prisma/schema.prisma#L350)). `ChatMessageDto.isOutboundFromKora` — ответ, отправленный из Коры.

## Принятые решения автора ТЗ
| # | Решение | Почему |
|---|---|---|
| Д1 | Фильтр по дате — на `lastMessageAt` (активность чата), `from`/`to` как ISO-инстанты. FE считает границы локального дня (МСК) и шлёт `toISOString()` | Совпадает с сортировкой списка (`lastMessageAt desc`); инстант однозначен, без TZ-головоломок на бэке |
| Д2 | Только чтение. Поле ввода/отправки на странице просмотра НЕ добавляем (эндпоинт `POST /:id/messages` существует, но UI не делаем) | Явное требование владельца «писать нельзя, только просмотр» |
| Д3 | Точка входа «Чаты» — ссылка-карточка рядом с «Менеджеры»/«Клиенты» → `/chats/integrations/chatbox/chats` (список) → `/chats/integrations/chatbox/chats/[id]` (переписка) | Зеркалит существующий паттерн managers/customers |
| Д4 | Транскрипт грузим через `listMessages(order:'asc')` постранично; роли подписываем: CLIENT→«Клиент», USER→«Менеджер», ASSISTANT→«Ассистент», QUALITY_CONTROL→«Контроль качества»; `isOutboundFromKora` помечаем «(из Коры)» | Роли явно требуются; маппинг согласован с `renderTranscript` бэка |

## Scope
**Входит:** BE date-filter (`from`/`to`) в list query+service; FE страница списка диалогов (фильтр по дате + быстрые «Сегодня»/«Вчера»/«Все», сортировка по дате) + FE страница чтения переписки (роли, время, медиа-плейсхолдеры, без ввода) + ссылка «Чаты» на странице интеграции + `domain/chatbox.ts` мапперы.
**Не входит:** отправка сообщений из UI (Д2); правка/удаление; экспорт; realtime-обновление; пагинация бесконечным скроллом (обычная «загрузить ещё»/страницы).

## Фазы

### Фаза A — BE: фильтр по дате в списке чатов `[ ]`
**Файлы:** [dto/chatbox-chats.dto.ts](backend/src/modules/chatbox/dto/chatbox-chats.dto.ts), [chatbox-chats.service.ts:66](backend/src/modules/chatbox/chatbox-chats.service.ts#L66), `chatbox-chats.service.spec.ts` (если есть — дополнить).
- В `ChatboxChatsListQuerySchema` добавить `from: z.coerce.date().optional()`, `to: z.coerce.date().optional()`.
- В `listChats` where: если `from`/`to` заданы — `lastMessageAt: { ...(from?{gte:from}:{}) , ...(to?{lte:to}:{}) }`. Сортировку/пагинацию не менять.
- **Acceptance:** `bun run typecheck`+`build`=0; `GET /api/v1/chatbox/chats?from=...&to=...` фильтрует по `lastMessageAt`; без `from`/`to` поведение прежнее; unit на where-builder если есть spec. `grep "from:" dto/chatbox-chats.dto.ts` → есть.

### Фаза B — FE: страницы просмотра диалогов + ссылка «Чаты» `[ ]`
**Файлы:** новые `frontend/app/(authenticated)/chats/integrations/chatbox/chats/page.tsx` + `ChatboxChatsListClient.tsx`; `frontend/app/(authenticated)/chats/integrations/chatbox/chats/[id]/page.tsx` + `ChatboxChatViewClient.tsx`; `frontend/src/api/chatbox.api.ts` (добавить `from`/`to` в `ListChatsQuery`); `frontend/src/domain/chatbox.ts` (мапперы чата/сообщения + лейблы ролей); `ChatboxIntegrationClient.tsx` (ссылка «Чаты» рядом с «Менеджеры»/«Клиенты», под `TierGate feature.chatbox`).
- **Список:** заголовок «Диалоги ChatBox»; фильтр по дате (два инпута `от`/`до` + быстрые кнопки «Сегодня»/«Вчера»/«Все»); список отсортирован по дате (бэк уже `lastMessageAt desc`); строка чата = собеседник (`customer?.name || clientName || externalId`) + канал + последнее сообщение (дата/время) + счётчик сообщений + статус; клик → детальная. Состояния loading/forbidden/error/empty (`AdminLoading/AdminForbidden/AdminError`+`EmptyState`). «Загрузить ещё»/пагинация через offset.
- **Чтение:** шапка (собеседник, ответственный менеджер, канал, статус, даты); транскрипт через `listMessages(id,{order:'asc',limit:200})` — пузыри с подписью роли (Д4) + время; не-TEXT контент — плейсхолдер `[Фото]/[Файл]/[Аудио]/[Видео]/[Голос]`; «(из Коры)» для `isOutboundFromKora`; **никакого поля ввода**. «Загрузить ещё» если сообщений больше лимита.
- **Acceptance:** `cd frontend && lint`=0, `build`=0; страница `/chats/integrations/chatbox/chats` рендерит список из `chatboxApi.listChats`, фильтр по дате шлёт `from`/`to`; `/chats/integrations/chatbox/chats/[id]` показывает переписку с ролями и БЕЗ инпута (`grep -i "textarea\|SendMessage\|sendMessage\|placeholder.*ответ" ChatboxChatViewClient.tsx` → 0); ссылка «Чаты» есть на странице интеграции; UI только русский; токены `bg-*`/`text-*-fg`.

## DoD
typecheck/lint/build зелёные (back+front); second-brain `01_projects/frontend-pages.md` (+страницы просмотра чатов) и `api-layer.md` (date-фильтр) обновить; prod-deploy-log — НОВЫХ миграций/ENV/скриптов нет (только код), отметить «prod-операций нет, обычный rebuild». Рефлексия.

## Итог
(заполнит оркестратор)
