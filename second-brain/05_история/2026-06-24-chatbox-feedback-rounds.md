---
date: 2026-06-24
feature: chatbox-feedback-rounds
branch: feature/chatbox-customer-vs-manager-split
---

# ChatBox — два раунда фидбэка после ручной проверки + диагностика «гонит в граф»

Продолжение после группового чатбокса ([chatbox-group-chats](2026-06-24-chatbox-group-chats.md)). Владелец проверил руками и дал фидбэк двумя волнами; параллельно — разбор жалобы на дедупликацию и аварийная очистка LLM-очередей.

## Что поставлено

**Раунд 1** (после проверки групп): (1) вход в диалоги не кнопкой «Чаты», а кликом по карточке «Забрано диалогов»; (2) журнал синхронизаций — отдельной страницей, не на странице интеграции; (3) «дедупликации нет, всё херачит в граф по новой»; (4) в логе синка показывать **новых** чатов/сообщений, а не только всего.

**Раунд 2** (9 пунктов): #1 тип канала плохо виден; #2 группа/не-группа плохо видно; #3 у групп/каналов есть имя в ChatBox (в UI — UUID); #4/#5 имя клиента и **менеджера** в переписке + пометка роли; #6 дубли чатов одного человека («Никита Емельянов» ×4) — должен быть 1 диалог с сессиями по дате; #7 ссылка «Карточки памяти» открывает пусто при ненулевом счётчике; #8 в логе синка — подробности «новых», а не «всего»; #9 в «Команде» убрать legacy-фильтр «Клиенты».

## Как решал

**Раунд 1** (коммиты `6fa3c5f6`, `466c648d`):
- Счётчики синка: `syncMessages→{total,created}`, `syncChats→{chats,newChats,messages,newMessages}` — `counts` во всех путях несут новые; журнал показывает «новых чатов/сообщений».
- Вход в диалоги: убрана кнопка «Чаты» из «Связи с людьми», карточка «Забрано диалогов» стала `Link` на список; журнал вынесен на `/chats/integrations/chatbox/sync-log` (новый `ChatboxSyncLogClient`), на интеграции — ссылка «Открыть журнал».
- **Дедуп (диагностика, фикс не потребовался):** по данным dev — 81 RawEvent = 81 уникальная сессия, дублей НЕТ. `ingest.ingest` идемпотентен по `idempotencyKey = sha256(sourceId:sessionId:occurredAt)`; на попадании возвращает существующий RawEvent и **НЕ** ставит job в knowledge-граф. «Шум» = первичный backlog (62 чата, ранее не подтягивались из-за бага обрезания) + локальный отказ LLM (22 RawEvent `failed` с «все окна LLM-извлечения провалились»). На проде с доступом к LLM обрабатывается.
- **Аварийно по запросу:** очистка всех BullMQ-очередей dev (`FLUSHALL`: chatbox.analyze 244, core.raw-events 108 и др.) + `ChatboxIntegration.analysisEnabled=false`, чтобы крон `ChatboxAnalyzeCron.sweep` (берёт только `analysisEnabled=true`) не залил заново.

**Раунд 2** (коммиты `721b20f4` BE, `ba5f7142` FE, `d9f4a7db` Команда):
- #3 **title**: `ChatboxChat.title String?` ← `raw.client.name` (миграция `20260624170000_chatbox_chat_title` + бэкофилл UPDATE из raw). Отдаётся в `ChatListItemDto`/`ChatDetailDto`; FE показывает `title || customer?.name || clientName || externalId`.
- #6 **группировка**: один диалог = `(channelExternalId, COALESCE(customerExternalId, clientExternalId, externalId))`. `listChats` через `$queryRaw` + window-функции (представитель = последний по `lastMessageAt`, `SUM(messageCount)`, `BOOL_OR(isGroup)`, `MAX(lastMessageAt)`); `total` = число групп. `getChat`/`listMessages` склеивают сессии и сообщения всех sibling-чатов (`resolveSiblingChatIds`), сессии перенумеровываются по `startedAt`. На данных: 62 raw-чата → 47 диалогов, «Никита» ×4 → 1 (messageCount=13).
- #4/#5 имена: `resolveSenderNames` получил фолбэк на `ChatboxCustomer`; FE рендерит `{senderName} · Менеджер/Клиент` (имя берётся первым из `m.senderName`, который бэк резолвит из `ChatboxMember`/`ChatboxChannelClient`).
- #1/#2 FE: цветной бейдж канала (`chatboxChannelTypeBadgeClass` — Telegram `bg-info/10`, MAX `bg-accent-muted`) + бейдж «Группа»/«Личный».
- #7 **счётчик «Карточки памяти»**: считал `rawEvent.count(sourceType:chatbox)` (81) и вёл на `/cards` — но `/cards` это **CRM-карточки** (`Card`: client/deal/project/vendor), а не карточки знаний. Исправлено: счёт → `ideaBlock.count(status:canonical)`, ссылка → `/ideas` (реальный список IdeaBlock).
- #9: из «Команды» (`PersonsTab`) убран Select-фильтр отношения и бейдж «Клиент»; `relationship === 'external'` всегда исключается (клиенты живут в `/customers`).

## Что вышло (верификация)

- Backend typecheck/build = 0; спеки `chatbox/` = 120 passed (вкл. 21 в `chatbox-chats.service.spec.ts`). FE lint 0 errors, build = 0.
- Миграция `title` применена на dev (бэкофилл 62 строки; группа → «Gonka | Devs»). Группировка проверена SQL-запросом напрямую (Никита ×4 → 1).
- Все 4 пункта раунда-1 и 9 пунктов раунда-2 закрыты и закоммичены (5 коммитов: `6fa3c5f6`, `466c648d`, `721b20f4`, `ba5f7142`, `d9f4a7db`).

## Чему научился

- **`raw.client.name` — источник имени диалога** для ВСЕХ чатов: для группы это название группы («Gonka | Devs»), для лички — имя человека. Раньше показывали `chat.id` (UUID).
- **ChatBox-«чат» ≈ наша сессия, не диалог.** ChatBox плодит отдельную chat-запись на каждую беседу с тем же человеком/каналом (4 записи «Никита», все с одним `customerExternalId`+`channelExternalId`). Кора-диалог = `(клиент/контакт + канал)`; группировка делается на read-слое (без изменения данных/сессий), дата-сессии у нас уже были.
- **`ingest.ingest` строго идемпотентен** (idempotencyKey по sessionId+occurredAt; на повторе НЕ ре-enqueue'ит граф) — «дублей в граф» при ре-синке быть не может. Симптомы «гонит в граф» = первичный backlog + локальный отказ LLM, а не дедуп-баг. Сначала смотреть данные (81 RawEvent = 81 сессия), потом «чинить».
- **`/cards` ≠ карточки памяти.** `/cards` = CRM-карточки (`Card`, owner-scoped); карточки знаний (IdeaBlock) живут на `/ideas`. Счётчик в сводке должен совпадать с тем, что реально откроет ссылка — иначе «ненулевой счётчик → пустая страница».
- **Локальный dev: граф пуст** (LLM-провайдер недоступен → 0 IdeaBlock), поэтому проверить наполнение карточек/`/ideas` локально нельзя — только согласованность счётчиков. Реальное наполнение — на проде.
- **Крон анализа уважает `analysisEnabled`** (`ChatboxAnalyzeCron.sweep` → `findMany({where:{analysisEnabled:true}})`) — это рубильник, которым гасится залив очереди без правки кода.

## Prod

Аддитивная миграция `title` (авто через `migrate deploy`), бэкофилл вшит в SQL миграции. Прочее — код (read-слой/счётчики/FE) + FE. Обычный `docker compose up -d --build backend frontend`. Деталь — `docs/operations/prod-deploy-log.md` Шаг 4.
