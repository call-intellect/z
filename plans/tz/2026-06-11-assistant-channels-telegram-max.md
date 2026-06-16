---
type: tz
status: ready-to-implement
feature: assistant-channels-telegram-max
date: 2026-06-11
owner: Сергей (sergrv80)
relates_to:
  - plans/analysis/2026-06-11-telegram-agentic-interface.md
  - plans/analysis/2026-06-11-telegram-pomoshnik-tochka-A-tochka-B.md
  - plans/tz/2026-06-11-autonomy-remove-manual-confirmations.md
---
> Анализ: `plans/analysis/2026-06-11-telegram-agentic-interface.md` (+ PLAIN `…-tochka-A-tochka-B.md`) · Статус согласования: 2026-06-11 (Точка Б одобрена, все вопросы Q1-Q8 закрыты владельцем).

## Принцип

**Один помощник — много окон.** Усиливаем существующего AI-помощника (`concierge`) и делаем Telegram (и скоро MAX) **каналами-окнами**, которые ходят в ТОТ ЖЕ помощник с инструментами, что и кабинет. Новая возможность добавляется в помощника один раз → работает во всех окнах. Каналы **не получают свою бизнес-логику** (никаких дублирующих интентов = второй мозг). Все 4 шага (фазы Ф1-Ф6) выкатываются в прод **одним готовым релизом** (Ship-On). Доступ инструментов по роли пишущего обеспечивается существующим RBAC (помощник его не обходит).

## Цель + Зачем

**Болезненное состояние (подтверждено кодом + боевыми логами прода 2026-06-11):**
1. Вопрос из Telegram **не доходит вообще никуда** — chat-ответ помечается `sensitive`, режется потолком `internal` и на `telegram_bot`, и на `in_app` → `0 каналов → status=failed` (трейс по webhook Telegram: `payload=sensitive > sink.maxDataClass=internal`, channel=`telegram_bot#c1h847` И `in_app#pw8rdn`). Пользователь видит полную тишину.
2. Свободная заметка уходит в граф **без ответа** пользователю.
3. Из 14 проактивных типов в канал рендерятся **7** — остальные (вкл. сам вопрос утреннего чек-ина `checkin.prompt`, недельные сводки) приходят как «Уведомление: <eventType>».
4. Помощник с 19 инструментами **заперт в кабинете** (SSE); Telegram ходит в read-only chat-v2 → не умеет действовать.

**Чем решение лучше:** см. доказательство выбора в анализе (8 research-агентов + 3 red-team с независимым retrieval, факты по коду + прод-логам). Кратко: «латать Telegram отдельными интентами» = второй мозг (текущая болезнь); «большой движок разом» = нарушает Ship-On + горячая зона; выбрано «открыть единого помощника в каналы, инкрементально».

## REALITY-CHECK (что уже есть / сломано / мертво — по факту кода)

| Область | Факт | Вывод для ТЗ |
|---|---|---|
| Помощник с инструментами | `ConciergeService.process` (SSE) + `ToolRouterService` + `ServiceMapGeneratorService` (19 статических инструментов). RBAC проверяется (`tool-router.service.ts:99-122`, «concierge НЕ bypass»). | Переиспользуем как единый мозг. НЕ переписываем с нуля. |
| Native function-calling | Транспорт **УЖЕ готов**: `llm-router.service.ts:1006-1013,1774-1777` (`params.tools`→провайдер→`tool_calls`); `deepseek.service.ts:186-224`, `openai-proxy.service.ts:89-97` реально мапят `tools`+`tool_choice`. | Ф3 опирается на готовый транспорт; concierge просто его не использует (regex-эмуляция, `concierge.service.ts:807-833`). |
| Исполнение инструментов | `tool-router.service.ts:153-163` — loopback-HTTP на `${baseUrl}${path}` с `Cookie: authCookie`. У канала cookie/`baseUrl`/`req` НЕТ. | Ф4: добавить **service-auth путь РЯДОМ** с cookie-loopback, не ломая web-чат. |
| Доставка ответа | `sendChatReply` (`conversational.service.ts:424`) дефолтит `dataClass:'sensitive'`; gating ON на проде (verified). `critical` байпасит quiet+budget; `canEmit` — независимо от critical. | Ф1: понизить класс до `internal` + `critical:true` для solicited-reply. |
| free_note | `ConversationalFreeNoteBridge.handleFreeNote` (`conversational.module.ts:65-86`) пишет в граф, **ни одного ответа**. | Ф1: добавить ack. Заметка НЕ теряется — добавляем только подтверждение. |
| Рендер каналов | `telegram-bot.adapter.ts:1251-1322` renderText — 7 case + `default`. У MAX (`max-bot.adapter.ts`) **свой** renderText (та же дыра). | Ф2: чинить ОБА адаптера. |
| Узкий роутер | `telegram-bot.adapter.ts:538-592` classifyIntent → task/show_tasks/chat_query/free_note/checkin. `task`/`show_tasks` уже работают (вчерашний §2). | Ф5: free-text (кроме чек-ина) → помощник; задачи/чек-ин НЕ ломать. |
| Роли | `policy.csv`: owner/admin = `*` (все), manager в `open` = read `*`/write `self`, рядовой — про себя. Org-режим `visibilityMode:'open'|'strict'` (`rbac.service.ts:470,760`). | R7 «про себя/про всех» работает через RBAC автоматически. |
| Пакетное подтверждение «32» | `pending-actions` (4 провайдера) — отдельная тема. | **Вне scope** (владелец: «это про другое»; см. relates_to autonomy-ТЗ). |

## Принятые решения владельца (2026-06-11 — не пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| В1 | Точка Б = **единый помощник, каналы — окна к нему**. Усиливаем помощника, вход через Telegram/MAX/любой канал. | «Вносим изменение → в помощника → работает везде». Отдельные интенты = второй мозг (отвергнуто). |
| В2 | **Все 4 шага (Ф1-Ф6) — один прод-релиз** одновременно. | «Выкатываем сразу весь функционал полностью, чтобы всё работало», не по кускам. |
| В3 | Доступ по роли: рядовой — **только про себя**; руководитель/админ — **про всех**. По базе знаний спросить может каждый (в рамках прав). | Обеспечивается существующим RBAC через помощника (не обходим права). |
| В4 | Набор инструментов в канале (Q3): self — мои задачи/день/неделя, создать событие/встречу, найти слот, поставить задачу, поиск/вопрос к памяти; manager+ — чужой календарь, задачи/обещания других, карточка человека, здоровье команд. | Узкий безопасный набор; «дать всё» рассыпается (рынок). |
| В5 | Каналы: сейчас **Telegram**, **MAX — скоро**; делать **независимым от канала** (channel-agnostic). | MAX-адаптер уже есть; окно подключается дёшево. |
| В6 | Подтверждение действий — **текстом/голосом, без кнопок** (zero-button). | Продуктовый принцип Z. |
| В7 | **«Подтвердить 32 пачкой» — НЕ делаем** (вне scope). | Невозможно по природе 3/4 источников; «это про другое». |
| В8 | Память разговора — **у помощника** (раз Telegram его канал — память есть). | Единый мозг = единая память диалога. |
| В9 `[ASSUMPTION]` | Ф3 (native-tools) выкатывается с **аварийным рубильником** отката на прежний механизм. | Затрагивает живой web-чат; kill-switch разрешён (Ship-On принцип 8а). Если владелец против рубильника — сказать. |

## Доказательство выбора

Полная состязательная матрица (A заплатки / B headless-адаптер / C единый движок) с критериями (Ship-On, риск web-чата, горячая зона, покрытие боли, RBAC, объём) + ADR + red-team — в [анализе §6](plans/analysis/2026-06-11-telegram-agentic-interface.md). Вывод закреплён решением В1: цель — унификация на помощнике, способ — инкрементально (НЕ big-bang, НЕ дублирование интентов). Challenge-loop:
- **Корень, не симптом?** Да — устраняем структурный раскол «два мозга» (chat-v2 ≠ concierge), а не каждый кейс молчания отдельно.
- **Эффективнее некуда?** Ф1/Ф2 — конфиг+рендер (дни); Ф3 опирается на готовый транспорт tools; Ф4 — добавка рядом, не переписывание. Не вводим параллельную логику.
- **Нет кода ради кода?** Telegram/MAX не получают свой tool-набор — переиспользуют `ServiceMapGeneratorService`/`ToolRouter`/`ConciergeService`.

## Совместимость с prompt caching (обязательно для LLM-фич)

Ф3 меняет SYSTEM-промпт concierge: инструкция «верни строку `{tool_call}`» + JSON-список инструментов **уезжают из SYSTEM-текста** в API-поле `tools` (native). Это **улучшает** кэш (SYSTEM короче и стабильнее). Правила: SYSTEM стабильный (контекст пользователя + принципы), `tools` — стабильный массив схем (меняется редко), переменные данные (preHits, история) — в конце user. Не вставлять per-request данные в SYSTEM. См. [[feedback_llm_prompts_cache_friendly]].

## Scope

**Входит (Ф1-Ф6, один релиз):**
- Ф1 chat-ответ доходит в канал-источник; ack на free_note.
- Ф2 читаемый рендер всех проактивных типов в Telegram И MAX.
- Ф3 native function-calling в помощнике (kill-switch).
- Ф4 сервисный путь исполнения инструментов (без cookie), RBAC сохранён.
- Ф5 Telegram/MAX free-text → помощник; память диалога per-binding; ответ в одно сообщение; голос→Vox→помощник.
- Ф6 канальный whitelist инструментов self/all по роли; текстовое подтверждение мутаций.

**НЕ входит (с судьбой):**
- ❌ Пакетное подтверждение pending («32») → autonomy-ТЗ `plans/tz/2026-06-11-autonomy-remove-manual-confirmations.md` (В7).
- ❌ Полная замена `dialog-layer`/классификатора на помощника для чек-ина (план/отчёт) — чек-ин остаётся отдельной веткой (Ф5 не ломает).
- ❌ Потоковый стрим в Telegram (`sendMessageDraft`/typing) — vNext (ответ собираем в одно сообщение; стрим — отдельное улучшение).
- ❌ Новые руководительские инструменты сверх существующих (people-at-risk, pulse-patterns как tools) — vNext; в Ф6 только то, что уже есть в реестре + правка бага `list_overdue_promises` (см. Ф6).
- ❌ Парсинг присланных в Telegram фото — как сейчас (не поддерживаем).

## Граничные контракты

- **RBAC** (`rbac.service.ts`) — используем как есть; самостоятельно роли не меняем. Если окажется, что рядовой `member` имеет лишний cross-person `read` — фиксируем как риск, НЕ правим policy.csv в этом ТЗ (отдельная задача).
- **autonomy-ТЗ** — pending/probe-обработку не трогаем; существующий reply-match на probe (`telegram-bot.adapter.ts:1231`) остаётся.
- **chat-v2** — `ChatV2OrchestrationService.ask` остаётся доступным как **инструмент помощника** (`ask_chat_v2`), не как параллельный путь Telegram.

---

## Контракты (единый источник правды)

### Новые флаги (оба — kill-switch, default ON; реестр `docs/operations/feature-flags.md` + `env.schema.ts` + prod-deploy Шаг 1)

```ts
// env.schema.ts — оба через z.coerce.boolean().default(true), доступ только через TypedConfigService
CONCIERGE_NATIVE_TOOLS_ENABLED   // Ф3: ON=native function-calling; OFF=прежняя regex-эмуляция (аварийный откат)
ASSISTANT_CHANNEL_ROUTING_ENABLED // Ф5: ON=free-text канала → помощник; OFF=прежний узкий роутер (аварийный откат)
```
Тип обоих — **аварийный рубильник** (фича ON, действий владельца не требует). Строки в `feature-flags.md`.

### Ф1 — контракт доставки solicited-ответа

В `ChatV2OmnichannelBridge.handleChatQuery` (`chat-v2.module.ts:74-84`) вызов `sendChatReply` дополнить:
```ts
await this.conversational.sendChatReply({
  …existing,
  dataClass: 'internal',   // было: undefined → 'sensitive' (резалось потолком канала)
  // solicited reply на заданный вопрос — должен дойти в канал-источник
  // даже в тихие часы / при исчерпанном бюджете push:
  // см. ниже расширение sendChatReply.
});
```
Расширить `sendChatReply` (`conversational.service.ts:370`) опц. флагом `solicited?: boolean` → при `solicited && originChannelBindingId` пробрасывать `critical: true` в `sendNotification` (байпас quiet+budget). Дефолт `solicited=false` (обратная совместимость). **Не** трогать другие вызовы `sendChatReply`.

Acceptance-пример: вопрос из Telegram в 23:00 (тихие часы) → ответ доставлен в Telegram (delivery.status `queued→sent`), НЕ только in_app.

### Ф5/Ф6 — канальный whitelist (self/all) поверх существующего реестра

```ts
// Псевдоконтракт telegram/max → assistant. Имена инструментов — из ServiceMapGeneratorService.
// Доступность определяется RBAC (ToolRouter.execute уже проверяет), но В КАНАЛ отдаём СУЖЕННЫЙ список:
const CHANNEL_TOOL_WHITELIST_SELF = [
  'list_tasks', 'list_my_events', 'list_meetings',
  'create_event', 'create_meeting', 'find_free_slot',
  'create_task', 'search_tasks', 'ingest_note', 'ask_chat_v2',
  // СИНХРОНИЗАЦИЯ 2026-06-15 (ТЗ помощника 2026-06-14): search_knowledge УДАЛЁН
  // (к памяти — только ask_chat_v2); create_task ставит задачу; search_tasks —
  // поиск задач; ingest_note заносит заметку/идею в граф. search_tables НЕ нужен
  // (поиск таблиц внутри chat_v2 — ТЗ 2026-06-15 §7).
];
const CHANNEL_TOOL_WHITELIST_MANAGER = [
  ...CHANNEL_TOOL_WHITELIST_SELF,
  'list_user_events', 'get_person_pulse', 'get_team_health', 'list_overdue_promises', 'get_sprint_status',
];
// Роль определяется по RBAC пользователя из ChannelBinding. RBAC всё равно гейтит каждый вызов —
// whitelist лишь сужает то, что помощник ВИДИТ в канале (меньше attack surface).
```

> **Синхронизация с ТЗ помощника (2026-06-14) и chat-v2 (2026-06-15), добавлено 2026-06-15.**
> Две координации к Ф5, чтобы не было дублей:
> 1. **free_note.** Когда Ф5 ON, свободная заметка идёт в помощника → инструмент
>    `ingest_note` (он и подтверждает «записал в память»). Bridge-ack из Ф1 —
>    это путь Ф5-OFF (fallback). Не слать ack дважды: при ON отвечает помощник.
> 2. **task/show_tasks.** Удаление этих интентов из канального классификатора
>    (решение ТЗ помощника §5: задачи делает инструмент `create_task`/`list_tasks`)
>    кладётся ЭТИМ ЖЕ релизом вместе с Ф5 — раньше нельзя (сломается постановка
>    задач из Telegram).

---

## Фазы (dependency-ordered; релиз — когда ВСЕ зелёные)

Граф: Ф1 ⟂ Ф2 ⟂ Ф3 ⟂ Ф4 (независимы, параллелятся) → Ф5 (нужны Ф3+Ф4) → Ф6 (нужен Ф5).

### Ф1 — Стоп-молчание (chat-ответ доходит в канал + ack на заметку)
**Цель:** вопрос из канала получает ответ В ЭТОМ ЖЕ канале; заметка получает подтверждение.
**Файлы:** `backend/src/modules/chat-v2/chat-v2.module.ts` (handleChatQuery, ~:74); `backend/src/modules/conversational/conversational.service.ts` (sendChatReply ~:370, добавить `solicited`); `backend/src/modules/conversational/conversational.module.ts` (handleFreeNote ~:65, добавить ack через адаптерный reply). *(номера строк — на момент написания, перед правкой перечитать по якорю-символу `sendChatReply`/`handleFreeNote`.)*
**Что входит:** (1) `dataClass:'internal'` + `solicited:true` в bridge-вызове; (2) расширение `sendChatReply` флагом `solicited`; (3) ack пользователю на free_note («Записал в память Коры 🧠») — отправляется тем же каналом (через `ConversationalService.sendNotification` eventType `system.message` ИЛИ прямой best-effort reply адаптера; реюз механизма ack как у task).
**Что НЕ входит:** изменение dataClass других уведомлений; новая логика retrieval.
**Acceptance (R1, R2):**
- Греп `dataClass: 'internal'` и `solicited` в `chat-v2.module.ts`/`conversational.service.ts`.
- Юнит: `sendChatReply({solicited:true, originChannelBindingId})` → в `sendNotification` ушло `critical:true`; без флага — `critical:false` (негативный кейс).
- Юнит на рендер ack: `handleFreeNote` → вызван reply пользователю с непустым текстом.
- `bun run typecheck && bun run test:unit` зелёные.
**Закрывает: R1, R2.**

### Ф2 — Видимые планы и отчёты (рендер всех проактивных типов в Telegram И MAX)
**Цель:** ни одно проактивное уведомление не приходит как «Уведомление: <eventType>».
**Файлы:** `telegram-bot.adapter.ts` renderText (~:1251-1322); `max-bot.adapter.ts` renderText (свой, найти по `renderText`/`switch (notification.eventType)`).
**Что входит:** ДО `default` добавить универсальную ветку: если в payload есть `title`+`body` → `<b>{title}</b>\n\n{body}` + (если `actionUrl`) строка-ссылка; отдельный аккуратный case `checkin.prompt` (рендер `payload.question` + подсказка «Ответьте текстом или голосом»). Покрыть типы: `checkin.prompt`, `operations.weekly_digest`, `goals.pulse`, `operations.monthly_recap`, `proactive.notification`, `event.reminder`, `issue.mention`, `idea.status_changed`, `support.ticket_created`, `support.ticket_reply`. HTML-escape сохранить, лимит 4000.
**Что НЕ входит:** потоковый стрим; чанкинг >4096 (ответы коротки); новые eventType.
**Acceptance (R3):**
- Юнит-таблица: для каждого из 10 eventType с payload `{title,body,actionUrl}` (или `{question}` для checkin.prompt) renderText возвращает текст, содержащий title/body (или question), и НЕ начинается с «Уведомление:».
- Негатив: неизвестный eventType без title/body → по-прежнему `default`.
- Симметрично проверить max-bot.adapter.
- `bun run test:unit` зелёный (оба адаптера).
**Закрывает: R3.**

### Ф3 — Native function-calling в помощнике (kill-switch)
**Цель:** помощник вызывает инструменты через провайдерский `tools`/`tool_calls`, а не regex-парсинг текста.
**Файлы:** `concierge.service.ts` (tool-loop ~:496-652, buildSystemPrompt ~:110-137, tryParseToolCall ~:807-833); `service-map-generator.service.ts` (добавить экспорт схем в формате провайдера — `name/description/parameters` уже есть, нужен маппинг в `LlmTool[]`); `llm-router.service.ts` (тип `LlmTool`, уже есть).
**Что входит:** за флагом `CONCIERGE_NATIVE_TOOLS_ENABLED` (ON): передавать `tools: serviceMap.toLlmTools()` в `llm.call(...)`, читать `out.toolCalls` (структурно), исполнять, возвращать результат сообщением роли `tool`. Из SYSTEM убрать инструкцию про `{tool_call}` JSON и текстовый список (он уходит в `tools`). Сохранить: лимит итераций, RBAC, undo-log, requiresConfirm, квоты, PRM-shadow. OFF → прежняя regex-ветка (без изменений поведения). RU-провайдеры: **sequential** tool-loop + `tool_choice='auto'` (parallel/forced не предполагать — verified GigaChat/YandexGPT).
**Что НЕ входит:** изменение набора инструментов; единый `handleTurn` (это Ф5 на уровне канала, не переписывание concierge).
**Acceptance (R4):**
- Греп `CONCIERGE_NATIVE_TOOLS_ENABLED` в `concierge.service.ts` + строка в `feature-flags.md`.
- Юнит: при ON и моке провайдера, вернувшего `tool_calls:[{name:'list_tasks',…}]`, — `ToolRouter.execute` вызван с `list_tasks`; при OFF — работает прежний regex-путь (оба теста зелёные).
- Юнит cache: SYSTEM-промпт при ON НЕ содержит `tool_call` инструкции и JSON-списка инструментов (греп по сгенерированному SYSTEM).
- `bun run typecheck && bun run test:unit`.
**Закрывает: R4.**

### Ф4 — Сервисный путь исполнения инструментов (без cookie)
**Цель:** инструменты исполняются по `userId+tenantId` без HTTP-cookie/`baseUrl`, RBAC сохранён.
**Файлы:** `tool-router.service.ts` (execute ~:69-198).
**Что входит:** добавить режим `auth: { mode: 'service', userId, tenantId }` РЯДОМ с текущим cookie-loopback (`mode:'cookie'` по умолчанию — web-чат не меняется). В service-режиме: RBAC-проверка как сейчас (`rbac.check`), но исполнение — **внутренний путь** (либо loopback с внутренним service-заголовком, который guard принимает как доверенный intra-process, либо прямой вызов сервиса — выбрать по факту минимального риска; см. примечание). `X-Concierge-Origin` сохранить.
**Примечание реализатору:** не переписывать существующий cookie-путь. Если внутренний service-заголовок проще и безопаснее прямого вызова сервисов — использовать его (один новый заголовок, принимаемый только для loopback на localhost). Решение — по REALITY-CHECK кода guard'ов перед фазой (эмпирически проверить, как `CookieAuthGuard`/`TenantGuard` пропускают intra-process).
**Что НЕ входит:** удаление cookie-пути; изменение RBAC-семантики.
**Acceptance (R5):**
- Юнит: `execute({auth:{mode:'service',userId,tenantId}})` — `rbac.check` вызван с тем же userId; при запрете → `{ok:false,status:403}` (как cookie-путь).
- Юнит: web-чат путь (`mode:'cookie'`) не изменился (существующие тесты ToolRouter зелёные).
- Мини-e2e: исполнение `list_tasks` в service-режиме возвращает задачи пользователя (не чужие).
**Закрывает: R5.**

### Ф5 — Подключить Telegram/MAX к помощнику (единый мозг, память, голос)
**Цель:** свободное сообщение из канала обрабатывается помощником (concierge) с инструментами; ответ — одним сообщением; память диалога — per-binding; голос → Vox → помощник.
**Файлы:** `telegram-bot.adapter.ts` (ingestUpdate ~:240, classifyIntent ~:538-592, handleVoice ~:767); `max-bot.adapter.ts` (симметрично); новый мост `assistant-channel.bridge.ts` (или метод в ConversationalModule) `ConversationalService.subscribeInbound('assistant_turn', …)`; `concierge.service.ts` (использовать service-auth путь Ф4); связь `ConciergeConversation` ↔ `ChannelBinding`.
**Что входит (за флагом `ASSISTANT_CHANNEL_ROUTING_ENABLED`):**
- В адаптере: сохранить `/start`,`/login`, link-code, document→граф, voice→ASR, reply-match probe, **чек-ин (daily_plan/report) — как сейчас**. Всё остальное свободное (раньше chat_query/task/show_tasks/free_note/note) → новый inbound-тип `assistant_turn` → помощник.
- Мост `assistant_turn`: резолв `userId+tenantId` из binding → `ConciergeService.process({userMessage, userId, tenantId, auth:'service', conversationId: <по binding>})` → **собрать поток событий в один финальный текст** (как `messages/once`) → отправить в канал (best-effort reply). Промежуточные `thinking`/`tool_call` НЕ слать (text-only, без шума).
- Память: `ConciergeConversation` привязывается к `ChannelBinding` (короткая память диалога per-канал-пользователь); долгая память — граф (как сейчас).
- Голос: транскрипт Vox → тот же `assistant_turn`.
**Что НЕ входит:** стрим; замена чек-ина; смена web-SSE-пути (кабинет не трогаем).
**Acceptance (R6, R9, R10):**
- Греп `assistant_turn` + `ASSISTANT_CHANNEL_ROUTING_ENABLED`.
- Интеграция: текст «покажи мои задачи на этой неделе» из Telegram → `ConciergeService.process` вызван (мок), ответ собран в один текст, отправлен в чат; задачи/чек-ин-ветки НЕ задеты (негатив: «План на день: А,Б,В» → по-прежнему daily-checkin).
- Память: два сообщения подряд в одном binding → второй `process` получил `conversationId` первого (помнит контекст).
- Голос: voice → Vox-транскрипт → `assistant_turn` (мок Vox).
- OFF флага → прежний узкий роутер (существующие тесты адаптера зелёные).
**Закрывает: R6, R9, R10.**

### Ф6 — Канальный whitelist self/all + текстовое подтверждение мутаций
**Цель:** в канале помощник видит сужённый набор инструментов по роли; необратимые действия подтверждаются текстом.
**Файлы:** мост/сервис Ф5 (передать `toolWhitelist` в `process`); `concierge.service.ts`/`service-map-generator.service.ts` (поддержать опц. сужение видимых инструментов на вызов); `tool-router.service.ts` (баг `list_overdue_promises` путь, см. ниже); текст-confirm в мосте.
**Что входит:**
- Сужение: `process({…, toolWhitelist})` — помощник видит только whitelisted-инструменты; роль (self vs manager) определяется по RBAC пользователя binding (manager+ → расширенный список). RBAC всё равно гейтит каждый вызов (двойная защита).
- **Текстовое подтверждение (R8, В6):** если выбранный инструмент мутирующий и `requiresConfirm` (нет `undoableVia`) — помощник НЕ исполняет сразу, а возвращает в канал вопрос «Подтвердите: <человеко-понятное превью>. Ответьте «да»/«нет»». Следующее сообщение пользователя классифицируется дешёвым judge (`deepseek-v4-flash`) `confirm|reject|unclear`; `confirm`→исполнить, `reject`→отменить, `unclear`→переспросить. Состояние ожидания подтверждения — в Redis (TTL), ключ `binding+toolCallId`. Без inline-кнопок. Отменяемые (есть `undoableVia`, напр. `create_event`) — исполняются сразу + «можно отменить».
- **Фикс бага:** `list_overdue_promises` указывает на несуществующий `GET /api/v1/dashboard/commitment-reliability` (404) — переназначить на реальный `GET /api/v1/dashboard/operations/open-commitments` ИЛИ исключить из whitelist до фикса роута. (REALITY-CHECK перед фазой: подтвердить актуальный путь.)
**Что НЕ входит:** новые руководительские инструменты; inline-кнопки; изменение RBAC-ролей.
**Acceptance (R7, R8):**
- Юнит: для пользователя-`member` `process` получил `CHANNEL_TOOL_WHITELIST_SELF` (нет `get_person_pulse`/`get_team_health`); для `manager`/`owner` — расширенный.
- Юнит: попытка `get_person_pulse` от рядового через канал → инструмент не виден ИЛИ RBAC 403 (двойная защита; проверить оба).
- Интеграция confirm: мутирующий-без-undo инструмент → в канал ушёл вопрос подтверждения, инструмент НЕ исполнен; ответ «да» (judge=confirm) → исполнен; «нет» → отменён; «может быть» (unclear) → переспрос.
- Грепом: `list_overdue_promises` НЕ ссылается на `commitment-reliability` (баг закрыт).
- `bun run typecheck && bun run lint && bun run build && bun run test:unit` зелёные.
**Закрывает: R7, R8.**

---

## Границы автономии суб-агента
- ✅ Always: переиспользовать `ConciergeService`/`ToolRouter`/`ServiceMapGenerator`; RBAC не обходить; text-only; русский UI; парные цвет-токены (если UI); cache-friendly SYSTEM.
- ⚠️ Ask first: менять `policy.csv` (роли); менять dataClass других уведомлений; трогать web-SSE-путь concierge; вводить новый инструмент сверх реестра.
- 🚫 Never: дублировать tool-логику в адаптере (второй мозг); inline-кнопки в системных/probe-диалогах; голосовой вывод/TTS; `process.env.*` вместо `TypedConfigService`; `new PrismaClient()`; `prisma migrate`; пакетное подтверждение «32».

## Pre-mortem / Риски (вход для strict-production-review-gate)
- **Утечка чувствительного chat-ответа в канал (Ф1):** понижение до `internal` может пропустить факт, который раньше резался. Митигейт: контент chat-v2 уже отфильтрован retrieval'ом по правам пользователя; `private`-факты о конкретном человеке гейтятся subject-ACL (`canEmit`) — проверить, что понижение до `internal` НЕ затрагивает `private`. Ревью: где ещё `sendChatReply` без `dataClass`.
- **Дестабилизация web-чата (Ф3):** новый tool-механизм. Митигейт: kill-switch `CONCIERGE_NATIVE_TOOLS_ENABLED`; OFF-ветка = прежний код без изменений; тесты обоих путей.
- **RBAC-эскалация из публичного канала (Ф6):** инъекция в свободный текст. Митигейт: RBAC гейтит каждый вызов (не доверяем выбору LLM); whitelist сужает видимое; manager-инструменты — только role manager+. Ревью: `get_person_pulse` недоступен рядовому (двойная проверка).
- **Идемпотентность confirm (Ф6):** двойной «да». Митигейт: состояние подтверждения в Redis с TTL, одноразовое (consume).
- **Сборка потока в одно сообщение (Ф5):** длинный ответ >4096. Митигейт: усечение/короткий ответ (чанкинг — vNext, отмечено).

## Idempotency / флаги / prod-deploy
- Новые ENV `CONCIERGE_NATIVE_TOOLS_ENABLED`, `ASSISTANT_CHANNEL_ROUTING_ENABLED` → `env.schema.ts` + `docs/operations/feature-flags.md` (тип: аварийный рубильник, состояние ON) + **prod-deploy-log Шаг 1**.
- Миграций БД нет (память диалога — существующие `ConciergeConversation`/`ConciergeMessage`; связь с binding — поле/маппинг без новой таблицы; если потребуется колонка `ConciergeConversation.channelBindingId` — **это HIGH: добавить как Prisma-миграцию + data-model.md + prod-deploy Шаг 4**, согласовать).
- Seed/patch/backfill — не предполагаются.
- Prod-инструкция: после мержа — `docker compose up -d --build backend` + проставить (или оставить дефолт ON) оба флага; smoke: вопрос из Telegram получает ответ в Telegram; проактивное уведомление приходит текстом.

## DoD
- `bun run typecheck` (вкл. `.spec`) · `bun run lint` · `bun run build` · `bun run test:unit`/`test:integration` зелёные.
- second-brain обновлён: `01_projects/conversational-channels.md` (помощник как мозг каналов), `02_architecture/module-map.md` (мост assistant-channel), `01_projects/ai-jobs.md`/`workers-queues.md` (если новый воркер), `docs/operations/feature-flags.md`, prod-deploy-log (Шаг 1; Шаг 4 если добавлена колонка).
- Реестр «не сделано» `second-brain/04_не-сделано/README.md`: внести vNext-хвосты (стрим в Telegram; новые руководительские инструменты; чек-ин через помощника).
- Рефлексия в `05_история/`.

## Итог

**Реализовано ЦЕЛИКОМ (Ф1–Ф6), 2026-06-12, ветка `feature/assistant-channels-and-autonomy`** (вперемешку с фазами autonomy-ТЗ):

- **Ф1** — `cb285350` — стоп-молчание: solicited chat-ответ в канал-источник (`dataClass:'internal'` + `critical` при валидном binding, включая глобальный Telegram-канал) + ack на free_note (новый eventType `note.ack`).
- **Ф2** — `8bdd5f12` — рендер 10+ проактивных eventType в Telegram И MAX: универсальная ветка `title`+`body` до `default` + спец-case'ы (`checkin.prompt` рендерит текст вопроса).
- **Ф3 + Ф4** — `93bce9cc` — native function-calling concierge за kill-switch `CONCIERGE_NATIVE_TOOLS_ENABLED` (ON; SYSTEM без JSON-инструкции `{tool_call}` — кэш улучшен) + ToolRouter `authMode:'service'` (self-signed session JWT 60с без jti, loopback `CONCIERGE_LOOPBACK_BASE_URL` default `http://127.0.0.1:3000`).
- **Ф5** — `1a7cdbea` — Telegram/MAX free-text/голос → `ConciergeService` за `ASSISTANT_CHANNEL_ROUTING_ENABLED` (ON): inbound-тип `assistant_turn`, мост `AssistantChannelBridge` (модуль concierge), память диалога Redis `concierge:channel-conv:<bindingId>` TTL 24ч, голос→Vox→помощник; чек-ин и task-intent остались прежними ветками.
- **Ф6** — `973a8c0f` — канальный whitelist SELF/MANAGER по RBAC-роли + текстовое подтверждение мутаций (`confirm_required`, Redis TTL 300с, атомарный consume, эвристика «да/нет» + LLM-judge `assistant-confirm-classify`); фикс `list_overdue_promises` → `/api/v1/dashboard/operations/open-commitments`; маркер `ToolSchema.readOnly` (`find_free_slot`, `ask_chat_v2`).
- **Фиксы production-ревью** (поверх фаз): схема `chat.answer` ослаблена (пустые id), derived dataClass из chat-v2 (`sensitive`/`private` → вместо текста указатель «откройте в кабинете», не молчание), метрика `z_assistant_turn_total`.

**Вынесено в ТЗ-заглушки / vNext (зафиксировано в `second-brain/04_не-сделано/README.md`):**
- `create_task` в канале — `plans/tz/2026-06-12-assistant-create-task-tool.md` (blocked-on-owner: policy `intake_issue`/write);
- стрим в Telegram; новые руководительские инструменты сверх реестра; чек-ин через помощника — vNext (по ТЗ §«НЕ входит»);
- риск M-4 принят: service-JWT обходит revoke сессий (offboarding обязан снимать Membership).

Документация: `feature-flags.md` (2 рубильника), `prod-deploy-log.md` (блок 2026-06-12), `conversational-channels.md` §«Единый мозг помощника», `module-map.md`, `ai-jobs.md`.
