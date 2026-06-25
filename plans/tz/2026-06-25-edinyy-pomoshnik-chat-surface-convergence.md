# ТЗ: Единый помощник — схлопывание поверхностей чата на один движок Мастера

**Статус:** готово к реализации, НЕ начато. Отколото из [`2026-06-25-edinyy-pomoshnik-arhitektura.md`](2026-06-25-edinyy-pomoshnik-arhitektura.md) Ф1 как самостоятельный крупный кусок (нужна визуальная приёмка через Playwright/прод-кабинет).
**Дата:** 2026-06-25.
**Зачем отдельно:** бэкенд «единого мозга» уже сделан (Мастер single-pass → chat-v2 `askEphemeral` в процессе, петля уточнения замкнута, цепочка chat-v2 упрощена — коммиты f51e5a0e…8dac5210 на ветке `feature/edinyy-pomoshnik-arhitektura`). Осталась **фронт-консолидация трёх движков ответа в один**, которая трогает 4 живые поверхности, ломает цитаты/scope/клонов/голос/TTS при ошибке и без живого UI её нельзя принять. Поэтому — отдельным ТЗ с визуальной приёмкой, а не вслепую.

## 1. Что уже сделано (не переделывать)
- **FAB → чат напрямую**, вкладки «Помощник компании | Клоны ролей», пузырь Поддержки разведён — уже на ветке (`ConciergeFloatingButton.tsx`).
- **Единый колокольчик** `PendingActionsBell` уже агрегирует pending + proactive + signals, кликабелен через `actionUrl` (`router.push`). Лишь латин-нейминг в инбоксе поправлен (`eventTypeLabel` фолбэк).
- **`/chat-v2` и `/assistant`** уже redirect → `/chat`.
- **«Память»** уже дверь к реестрам (кусочный `MemorySearch` удалён).
- Бэкенд: `concierge.process` single-pass; `chatV2.askEphemeral({history,summary,intent})` без своей `ChatV2Conversation`; `dialog.process({intent})` пропускает classify.

## 2. Проблема, которую закрывает это ТЗ
Сейчас в кабинете **три разных движка ответа** на один смысл «спросить у памяти», пользователь видит разную логику:
1. **chat-v2** (`chatV2Api`, `/api/v1/chat-v2`): десктоп `/chat` (`ChatV2Client`), Cmd+K Ask, `IssueChat` (scope:issue), орфан `chat-v2/ChatPanel`.
2. **concierge** (`/api/v1/concierge/*`): FAB `ConciergeChat`, орфан `AssistantClient`, Cmd+K command-mode.
3. **legacy chat** (`chatApi`, `/api/v1/chat`, `/meetings/:id/chat`): мобильный `OrgChatPanel` (тело `/chat` на мобиле), `MeetingChatPanel` (чат результата встречи).

Цель ТЗ: **единственное лицо — Мастер (concierge-движок)**; chat-v2 — внутренний ответчик, его фронт-сёрфейсов не остаётся; legacy chat в Q&A-роли уходит.

## 3. Предусловие (бэкенд) — scope в Мастере
`concierge.process` / `askEphemeral` сейчас отвечают только по org. Для scoped-чатов (встреча/задача) нужно:
- Прокинуть `scope` + `scopeRefId` через `ProcessInput` → `dispatchAskChatV2`/`resumeClarify` → `askEphemeral({scope,scopeRefId})` (он их уже принимает).
- Источник scope в кабинете: фронт передаёт `pageContext`/новый параметр; Мастер кладёт в askEphemeral. На каналах scope=org (как сейчас).
- Приёмка: вопрос в чате задачи находит только её контекст (scope:issue), как сегодня `IssueChat`.

## 4. Фазы
### КФ1 — scope в Мастере (бэкенд) `[ ]`
`ProcessInput += scope?/scopeRefId?`; протащить в askEphemeral; тесты (scope доходит до askEphemeral). Ship-On.

### КФ2 — единый «дом чата» (большая страница) `[ ]`
- `/chat` (пункт «Спросить») = большая страница Мастера: левая колонка бесед (`conciergeApi.listConversations`) + «Новый чат», справа `ConciergeChat`. Прообраз раскладки — `ChatV2Client` (богаче: цитаты, asOf, архив/пин, выбор клона), движок — `ConciergeChat` (действия+undo+превью инструментов, уже «✨ Мастер»).
- Сохранить из `ChatV2Client`: рендер цитат/диплинков `[BLOCK:id]`, выбор адресата (Помощник/Клон), архив/пин, временной asOf — НЕ потерять при свопе движка.
- Ретолл `chat-v2/ChatV2Client` как Q&A-сёрфейс снимается (логику цитат/листинга переносим в дом Мастера).
- Приёмка (визуальная, Playwright/прод): один дом, левая колонка бесед, цитаты кликабельны, переспрос-уточнение видно, клон-вкладка работает.

### КФ3 — scoped-чаты через Мастер `[ ]`
- `IssueChat` (scope:issue) и `MeetingChatPanel` (сейчас на legacy `chatApi.sendMeeting`!) — перевести на Мастер со scope (через орфан-примитив `chat-v2/ChatPanel`, у него уже props scope/scopeRefId/mode, либо новый `MasterScopedChat`).
- Мобильный `OrgChatPanel`/`MobileAskClient` (legacy `chatApi.askV2`) — на Мастер.
- Приёмка: задача/встреча/мобайл отвечают тем же Мастером, scoped-поиск цел.

### КФ4 — Cmd+K на один движок `[ ]`
Палитра: Ask (сейчас `chatV2Api.ask`) и command-mode (`conciergeApi.askOnce`) сходятся на Мастер (askOnce), «Открыть полный чат» → дом Мастера. Приёмка: одна логика.

### КФ5 — чистка legacy `[ ]`
После КФ2–КФ4: убрать неиспользуемые `ChatV2Client`/`OrgChatPanel`/legacy chat Q&A-эндпоинты из фронта (бэкенд chat-v2 остаётся как внутренний движок; legacy `/api/v1/chat` — отдельный аудит на удаление). Грепом подтвердить ноль фронт-импортеров.

## 5. Риски
- Потеря фич `ChatV2Client` (цитаты-диплинки, asOf, архив/пин, выбор клона) при свопе движка — каждую перенести и провизуально проверить.
- `MeetingChatPanel`/`OrgChatPanel` на legacy backend — миграция меняет endpoint и формат истории.
- Голос+TTS в `IssueChat`/`MeetingChatPanel` — сохранить.
- Только под визуальную приёмку (нет локального запуска UI у агента-реализатора) — гонять `qa-tester` на проде korateam.ru.

## 6. DoD
- [ ] Все Q&A/действия идут через Мастер (concierge), прямых вызовов `chatV2Api.ask`/`chatApi.*` из UI не осталось.
- [ ] scoped-чаты (встреча/задача/мобайл) — Мастер со scope, контекст не размывается.
- [ ] Визуальная приёмка пройдена (Playwright/прод): цитаты, переспрос, клоны, голос целы.
- [ ] second-brain (`frontend-pages`, `api-layer`) обновлён; реестр не-сделанного — строка снята.
