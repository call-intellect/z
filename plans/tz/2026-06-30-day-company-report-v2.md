---
type: tz
status: ready-to-implement
feature: day-company-report-v2
date: 2026-06-30
owner: владелец
relates_to:
  - plans/architecture/2026-06-30-day-company-report-v2.md          # архитектура (approved 2026-06-30) — основание
  - plans/analysis/2026-06-28-day-company-prototype/input-sources.md # карта входа + все решения + проверка по коду
  - plans/analysis/2026-06-28-day-company-prototype/report-prompt-v2.md # эталонный текст промпта письма
  - plans/analysis/2026-06-28-day-company-prototype/index.html       # эталон вёрстки виджетов
  - plans/tz/2026-06-28-day-company-daily-brief.md                   # БАЗА (Ф1–Ф6 реализованы) — надстраиваем
---

> Архитектура (одобрена владельцем): `plans/architecture/2026-06-30-day-company-report-v2.md` (status: approved, 2026-06-30, обе развилки закрыты) · Анализ входа: `plans/analysis/2026-06-28-day-company-prototype/input-sources.md` · Эталон письма: `.../report-prompt-v2.md` · Эталон вёрстки: `.../index.html`.

# ТЗ — «День компании v2»: письмо от COO + полный вход с атрибуцией + виджеты

## Принцип

v2 — **надстройка над реализованным «День компании»** (ТЗ `2026-06-28-day-company-daily-brief`, Ф1–Ф6 в `dev`), а не новый пайплайн. Переиспользуем как есть: модель `DailyOperationsDigest` (+ поля `verdictJson`/`letterJson`/`goalAlignmentDayJson`), taskType `operations-daily-digest`, `DailyDigestService.generate/buildDayPackage`, крон `OperationsDailyDigestCron`, доставку, героя `DayCompanyHero`. **Новую модель и новый извлекающий агент не вводим.** Отчёт остаётся **агрегатором** поверх готового графа (block-ingest + специалисты уже размечают всё с автором).

Меняем ровно пять вещей: (1) переписываем **промпт письма** под эталон COO; (2) **наполняем вход** всеми каналами за сутки с подписью «кто сказал» + конфликты; (3) перегруппируем **виджеты**; (4) сдвигаем **тайминг** на 07:00 МСК; (5) усиливаем **ночную разметку конфликтов** (иначе ось «Команда» пуста).

## Вне scope / отложено владельцем

- **Probe (зондирование)** — атрибуция «кто ответил» ненадёжна (`recipientUserId` = получатель), вне первой версии → `04_не-сделано`.
- **Недельный/месячный дашборды** — не трогаем, только дневной (позже по образцу).
- **Движок целей** — внутренности не трогаем; компас читаем из готового `GoalAlignmentSnapshot`.
- **Сдвиг продюсера целей (`strategic-alignment.cron` 02:00 → позже сбора данных)** — отложенное улучшение (Развилка 2 закрыта: в v1 оставляем как есть, нюанс фиксируем). → `04_не-сделано`.
- **TTS «Озвучить»** — остаётся disabled-заглушкой из базы.
- **Ось «Деньги/финансы»** — нет источника (как в базовом ТЗ).

## Цель + Зачем

**Болезненное состояние (по факту прода, скрин `real-dashboard-day-full.png`):**
- Письма как в прототипе НЕТ — только короткий вердикт-блок + кнопка; промпт режет прозу без имён, без петли со вчера, без «взгляда COO», внутри ещё сущность «решения» (убрана из продукта).
- В отчёт доходят только встречи (`summaryFast`) + кусочек чек-инов. Битрикс, чатбокс, помощник, чат, free-note, план↔факт по людям, конфликты — **не подаются**, хотя лежат подписанные автором.
- Виджеты рассогласованы: идеи задублированы (плоский + «по темам»), блокеры утоплены в рисках, риски без группировки по причине, висит виджет «Решения», правая колонка перегружена, виджета конфликтов нет.
- Генерация в 06:00 МСК — раньше, чем собираются чек-ины (05:00).

**Что решение даёт:** утром на `/dashboard` — живое письмо COO с именами, петлёй со вчера, «взглядом директора»; в письмо и виджеты попадает всё сказанное за день по каналам с подписью; числа план↔факт верны; виджеты разложены (блокеры/риски-по-причине/идеи-кластерами/конфликты/компас); «Решения» убран, дубль идей схлопнут.

## REALITY-CHECK (факт кода на 2026-06-30 — номера строк верифицировать якорь-символом)

**База реализована и переиспользуется как есть (НЕ переписывать):**
- `DailyOperationsDigest` (`schema.prisma`, якорь `model DailyOperationsDigest {`) — поля `verdictJson`/`letterJson`/`goalAlignmentDayJson` уже есть.
- `DailyDigestService` (`operations/services/daily-digest.service.ts`) — `generate`/`getOrGenerate`/`buildDayPackage` (сбор пакета дня), `clampVerdict` (ограничители вердикта). Компас: `buildDayPackage` читает `Goal.isPrimary` → последний `GoalAlignmentSnapshot` → `compass={goalName,score,delta,explanation,pro,contra}` (якорь ~`:618-648`).
- Промпт `daily-digest.prompt.ts` — `DAY_COMPANY_SYSTEM_PROMPT` (якорь ~`:241-261`), выходная JSON-schema (~`:263-354`), `buildDayCompanyUserMessage` (~`:455-576`). taskType `operations-daily-digest`.
- Крон `operations-daily-digest.cron.ts` — `@Cron('0 3 * * *')` (03:00 UTC = 06:00 МСК, якорь `:26`), `yesterdayInMoscow`, kill-switch `operations.daily_digest.enabled`.
- Герой `frontend/src/ui/components/dashboard/day-company/*`: `DayCompanyHero`, `DayLetter`, `GoalCompassCard`, `StaleTasksLinked`, `RisksIdeas`, `PeriodValue`.

**Готово в графе, но НЕ доходит до отчёта (это и подключаем):**
- **Голос сотрудника** — подпись на `IdeaBlockEvidence.authorPersonId` (+ `sourceTimestamp`); резолв автора `block-ingest.worker.ts` `resolveEvidenceAuthor` (~`:1847-1901`). Идеи — `Idea.createdByUserId` (это **User**, не Person). Риски/боли — `Insight` косвенно через `sourceBlockIds`. **Нет индекса** под выборку по автору+дате.
- **Сигналы с трендом** — `Insight.dynamicLabel ∈ {growing,spike,stable,declining}`, `sourceBlockIds` (кол-во наблюдений), `frequencyScore`, `causeCategory` (`schema.prisma` Insight ~`:6540-6622`); `Idea.supporterCount/weight/status/clusterId` (~`:6702-6757`). Пересчёт синхронный `Specialist35Service.recalcMetrics` — новый детектор НЕ нужен.
- **План↔факт по людям** — `DailyCheckIn` (`plansJson`/`donesJson`/`notDoneJson`/`ideasJson` + `reportCompleteness`), сборка `DayReportCollectorService.collectForDay` (крон 05:00 МСК). Числа считает система, не LLM.
- **Сырьё Битрикс/чатбокс** — `BitrixMessage.text` (`authorName`, резолв `BitrixUser.linkedPersonId`→Person), `ChatboxMessage.text` (`senderType` MANAGER/CLIENT, `senderName`, резолв `ChatboxMember.linkedPersonId`); ingest `bitrix-ingest.service.ts:258-298`, `chatbox-ingest.service.ts:310-363`. Менеджер→Person, клиент→null (верно).
- **Конфликты** — `EntityLink relationType='conflicted_with'` (`schema.prisma:4283`): `fromEntityId`=автор/инициатор, `toEntityId`=сторона, `confidence`, `properties.sourceSignalType`, `status`, `createdAt`. Детектор `PersonalRelationBuilderWorker` (Фаза 9 `ef1e2f50`, «автор↔стороны»). Пороги-крутилки `knowledge.conflict_min_confidence`(0.6)/`knowledge.conflict_graph_confidence`(0.65). Забор — `operations-dashboard.service.ts` `fetchTeamFrictions` (~`:527-585`), DTO `OperationsDashboardTeamFrictionDto` — **без фильтра по дню**.

**Готово на бэке, но не подключено в виджеты дашборда:**
- Причина риска — `Insight.causeCategory` (process_gap/tooling/communication/role_skill/priority/resource_constraint/external), фильтр в API есть.
- Кластеры идей — `IdeaCluster`/`Idea.clusterId` + эндпоинты `/idea-clusters` (в проде «Идеи команды по темам» уже кластеризованы, но отдельным виджетом — дубль с плоским списком).

**Слабое место (закрывается в scope):**
- `block-ingest` размечает `signalType=team_friction` **плохо** — метка в enum есть, но БЕЗ примеров в промпте → конфликтных блоков мало → `EntityLink conflicted_with` создаётся редко → виджет «Команда» и секция «что помешало» пусты.
- `CheckInConflictDetectorCron` фактически МЁРТВ (после перестройки `DayReportCollectorService` `rawResponseText` не содержит трение-фраз) — к сносу в отдельной уборке, здесь не оживляем.

## Принятые решения владельца (не пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| Р1 | Формат выхода — **структурный (гибрид)**, «как в прототипе»: `verdictJson` (4 оси) + `letterJson[]` (секции проза+cites) + `goalAlignmentDayJson`. Не сплошной Markdown | Иначе фронт не нарисует бары/чипы/карточки/светофор осей |
| Р2 | **Имена людей и клиентов** в письме — прямо | Отчёт приватный, читатель один — владелец |
| Р3 | Сущность **«решения» удалена** везде (промпт/схема/letterJson key `decisions`) | Убрана из продукта; остаются «задача» и «выполнение задачи» |
| Р4 | Время генерации — **07:00 МСК** (`0 4 * * *` UTC) | После сбора чек-инов 05:00, чтобы видеть полный день |
| Р5 | Битрикс/чатбокс — **переписка целиком** за день, приоритизацию не вводим (только страховочная обрезка при переполнении) | Точнее саммари; подпись «кто говорил» + сотрудник/клиент |
| Р6 | Голос сотрудника — **из графа по авторству, без нового агента** | Ночной разбор уже разметил с автором |
| Р7 | Модель — **DeepSeek Pro** основная → резерв **GPT** (`openai-via-proxy`) → резерв **KIE** (gemini); жёсткий `maxTokens` снять; нагрузочный тест на объём — до выката | Большой контекст под полный объём |
| Р8 | **Единый резолв** `userId`/`externalId` → `Person` — свести в одну точку | Иначе «подписано сотрудником» не гарантировано по всем каналам |
| Р9 | **Новый индекс** `IdeaBlockEvidence(tenantId, authorPersonId, sourceTimestamp)` | Иначе полный скан на каждую выборку голоса |
| Р10 | Конфликты — **и в промпт** (ось «Команда» + «что помешало») **и в виджет** «Команда: трения» | Данные готовы (`EntityLink`), нужен забор с фильтром по дню |
| Р11 | Компас — **отдельный виджет**, источник не меняем; нюанс тайминга 02:00 зафиксировать | Снапшот готов, отчёт уже читает |
| Р12 | UI: убрать «Решения», **схлопнуть дубль идей** в кластеры, разгрузить правую колонку | Виджеты рассогласованы на проде |
| Р13 | **Развилка 1 закрыта:** усилить разметку `team_friction` примерами | Иначе конфликты не доходят; шум лечится порогом (крутилка) |
| Р14 | **Развилка 2 закрыта:** компас как есть (v1), сдвиг продюсера целей — отложенное улучшение | Для окна 30д день погоды не делает |
| Р15 | «Что сделано»/«Что не сделано» — **обобщённая проза** без ссылок/сроков/поштучных списков; детали — в виджетах | Решение владельца 2026-06-29 |
| Р16 | «Что помешало» — **суммирует несколько причин** (узкие места + повторяющиеся боли + конфликты), не списком и не сводя к одному корню силой | Решение владельца 2026-06-29 |
| Р17 | Финальный свободный блок **«Взгляд операционного директора»** — 5-6 предложений интерпретации, без новых фактов/чисел | Решение владельца 2026-06-29 |
| Р18 | Числа дисциплины (план/факт, %, дни просрочки, поставлено/выполнено задач) **считает СИСТЕМА**, LLM только вставляет | Решение владельца 2026-06-29 |

## Принятые технические решения (Б — мои, с обоснованием)

| # | Решение | Почему |
|---|---|---|
| Б1 | Расширяем `buildDayPackage`, а не заводим новый сборщик | Уже точка сбора пакета дня; один путь идемпотентности `(tenantId,dateLocal)` |
| Б2 | Голос сотрудника: 3 пути в одной выборке — блоки/мысли через `IdeaBlockEvidence(authorPersonId, sourceTimestamp)`+JOIN `IdeaBlock` (группировка по `signalType`); идеи через `Idea.createdByUserId`; риски/боли через `Insight.sourceBlockIds` | По коду подпись лежит в 3 местах (REALITY-CHECK); одна колонка не покрывает |
| Б3 | Единый резолв — helper `resolvePersonRef({userId?|externalId?|personId?, source})` в operations; кэш на проход | Р8; без него каждый канал резолвит по-своему |
| Б4 | Забор конфликтов — переиспользуем `fetchTeamFrictions` + параметр `since: <начало локального дня>`, не новый запрос | Готовый паттерн + DTO; минимум кода |
| Б5 | Сырьё Битрикс/чатбокс — turns-текст с подписью автора и меткой роли (сотрудник/клиент), страховочная обрезка по символьному бюджету (крутилка `operations.daily_digest.raw_char_budget`) | Р5; защита от переполнения без «умного» отбора |
| Б6 | Промпт v2 — SYSTEM из `report-prompt-v2.md`, но **ФОРМАТ ВЫХОДА = строгий JSON** (verdict+letter[]+goalAlignmentDay+risksSummary+ideasSummary), не Markdown | Р1; база уже персистит в JSON-поля |
| Б7 | `letterJson` keys v2: `intro,main,done,not_done,reporting,blocked,clients,ideas,attention,actions,delta,reflection`; key `decisions` **удалён** | Р3, Р17; 12 секций эталона |
| Б8 | Усиление `team_friction` — только добавить примеры/определение в SYSTEM разметки block-ingest, схему/enum не трогать | Р13; минимально, кэш промпта не ломаем |
| Б9 | Маршрут модели — правим `LlmTaskRoute` для `operations-daily-digest` через сид/патч (admin-editable), `maxTokens` снимаем там же | Р7; крутилка, не код |

## Scope

**Входит:** индекс `IdeaBlockEvidence`; единый резолв в `Person`; наполнение `buildDayPackage` (4 слоя с атрибуцией + конфликты + вчерашние открытые сигналы + план↔факт по людям); переписанный промпт v2 (12 секций, имена, петля, взгляд COO, без «решений», обобщённые сделано/не-сделано, конфликты в «Команда»/«что помешало») + строгая JSON-схема; маршрут модели DeepSeek Pro→GPT→KIE + снятие `maxTokens` + нагрузочный тест; тайминг крона 07:00; усиление `team_friction` в block-ingest; виджеты (блокеры отдельно / риски по причине / идеи кластерами / конфликты «Команда» / компас отдельно / удалить «Решения» / схлопнуть дубль идей); DTO; метрики/тесты/прод-шаги/second-brain.

**Не входит (с судьбой):** Probe → `04_не-сделано`; сдвиг продюсера целей → `04_не-сделано` (Развилка 2); снос `CheckInConflictDetectorCron` → отдельная уборка; недельный/месячный дашборд → позже; TTS → vNext; ось «Деньги» → нет источника.

**Граничные контракты (читаем выход, логику НЕ трогаем):** `Specialist35Service`/`Specialist36Service` (insights/ideas + метрики), `strategic-alignment.worker` (снапшот компаса), `PersonalRelationBuilderWorker` (детект конфликтов), `DayReportCollectorService` (чек-ины план↔факт), `bitrix-ingest`/`chatbox-ingest` (сырьё + резолв). block-ingest трогаем ТОЛЬКО в части текста SYSTEM для `team_friction` (Б8).

## Контракт-first (канон для копипасты)

### К1 — Индекс `IdeaBlockEvidence` (Prisma)
```prisma
// model IdeaBlockEvidence — добавить составной индекс:
@@index([tenantId, authorPersonId, sourceTimestamp])
```
Миграция `prisma:migrate -- --name idx_evidence_author_day` (файловая, не push). Аддитивная, безопасна. Триггер prod-deploy-log Шаг 4.

### К2 — Единый резолв в `Person`
Helper `resolvePersonRef(input: { personId?: string; userId?: string; externalId?: string; source: 'checkin'|'assistant'|'chat'|'free_note'|'bitrix'|'chatbox' }): { personId: string | null; isClient: boolean }`.
Правила: `personId` — как есть; `userId` → `Person.userId`; bitrix `externalId` → `BitrixUser.linkedPersonId`; chatbox `externalId` + `senderType` → `ChatboxMember.linkedPersonId` (CLIENT → `{personId:null, isClient:true}`). Не найден сотрудник → `{personId:null, isClient:false}` (метим «без автора»). Кэш `Map` на проход `buildDayPackage`.

### К3 — Расширение `DayCompanyPackage` (вход промпта)
`buildDayPackage` дополнительно собирает (всё за локальные сутки `dateLocal`, все выборки — с `tenantId`):
```
employeeVoice: [{ personId, personName, ideas:[{text, source, ts}], risks:[{text, dynamicLabel, source}], other:[{text, signalType, source}] }]   // К2 + Б2
rawConversations: {
  bitrix:  [{ session, turns:[{ author, personId|null, isClient, ts, text }] }],
  chatbox: [{ session, turns:[{ author, personId|null, isClient, ts, text }] }]
}                                                                                   // Б5, обрезка по raw_char_budget
signals: {
  blockers: [{ text, confidence, source }],
  risks:    [{ text, causeCategory, dynamicLabel, observations, frequencyScore, status, severity, source }],   // slice для «повторяется/растёт/новое/горит»
  ideas:    [{ text, supporterCount, weight, status, clusterId, source }]
}
conflicts: [{ fromPersonName, toPersonName, confidence, sourceSignalType, since }]   // Б4: fetchTeamFrictions(since=начало дня)
reporting: {                                                                          // Р18: числа готовы, из DailyCheckIn
  planSubmitted:{done,total}, reportSubmitted:{done,total},
  perPerson:[{ personName, planSubmitted, reportSubmitted, planned, done, mismatchReason? }],
  noReport:[personName], tasksSet, tasksDone, dayPlan:{done,total}
}
yesterdayOpenSignals: [{ text, axis, state }]    // для петли (секция 9) и динамики (секция 11) — из вчерашнего getStored (verdict.axes + risksSummary)
```
Всё, что не нашлось за день, — пустой массив (промпт пропускает секцию, «нет данных» не пишет).

### К4 — Промпт v2 (замена `DAY_COMPANY_SYSTEM_PROMPT`)
SYSTEM берём дословно из `report-prompt-v2.md` (РОЛЬ/ВХОД/ТОН/СОСТАВ 12 секций/ПРАВИЛА ПЕТЛИ), **кроме** блока «ФОРМАТ ВЫХОДА»: вместо Markdown — выдача строгим JSON (К5). Few-shot ЭТАЛОН из `report-prompt-v2.md` вшить как пример, но привести к JSON-форме К5 (проза каждой секции → `letter[].prose`). Prompt-caching: стабильный SYSTEM+few-shot, переменные данные пакета — в конце USER (`buildDayCompanyUserMessage`).

### К5 — Строгая JSON-схема выхода (Zod + json_schema strict) — правки к базовой
```jsonc
{
  "verdict": { "overall": {state,emoji,title,oneLiner},
    "axes": [ {"key":"team","state","label","why"},        // team.why ВКЛючает конфликты/трения (Р10)
              {"key":"clients",...}, {"key":"execution",...}, {"key":"overall",...} ] },
  "letter": [ {"key":"intro","title","prose","cites":[]},   // keys Б7: intro,main,done,not_done,reporting,
              ... ],                                         //           blocked,clients,ideas,attention,actions,delta,reflection
  "goalAlignmentDay": {direction,score,todayDelta,why,pro:[],contra:[]},
  "risksSummary": "…", "ideasSummary": "…"
}
```
Изменения против базы: **удалить** допустимый key `decisions` из enum `letter[].key`; **добавить** `intro`, `attention`; `reflection` = свободный «взгляд COO» (Р17, без новых фактов); `done`/`not_done` — обобщённая проза, `cites` пустой (Р15). Схема `.strict()` — синхронно в Zod и в json_schema `responseFormat`. `clampVerdict` (ограничители из базы) сохранить.

### К6 — Забор конфликтов за день
`fetchTeamFrictions` расширить необяз. параметром `since?: Date`; при передаче — `where.createdAt = { gte: since }`. `buildDayPackage` зовёт с `since = localDayWindowUtc(dateLocal).from`. Виджет-эндпоинт (Ф7) отдаёт тот же `OperationsDashboardTeamFrictionDto` (пары + confidence + since).

### К7 — Усиление `team_friction` (block-ingest SYSTEM)
В SYSTEM-промпт разметки, где перечислены `signalType`, к `team_friction` добавить определение + 2-3 примера: «трение/конфликт между сотрудниками или отделами: спор, кто ведёт клиента; претензия одного отдела к другому; перекладывание ответственности; открытое несогласие на встрече». Схему/enum НЕ менять. Порог шума — крутилка `knowledge.conflict_min_confidence` (уже есть).

### К8 — Маршрут модели + тайминг
- `LlmTaskRoute` для `operations-daily-digest`: primary DeepSeek Pro → fallback `openai-via-proxy` → fallback KIE (gemini); снять жёсткий `maxTokens` (сид/патч-скрипт, admin-editable). Если фильтр `dataClass` отсекает — проверить, что дневной пакет не помечен выше `private` (иначе резервы недоступны).
- Крон `operations-daily-digest.cron.ts:26`: `@Cron('0 3 * * *')` → `@Cron('0 4 * * *')` (07:00 МСК). `yesterdayInMoscow`/kill-switch не трогать.

### К9 — Виджеты (frontend, по `index.html`)
- **Блокеры** — отдельная секция (фильтр `Insight.kind=blocker` / `signals.blockers`), красный блок «что прямо мешает», owner+дни.
- **Риски** — сгруппированы по `causeCategory` (Коммуникация и люди / Инструменты / Процессы), бейджи `dynamicLabel`.
- **Идеи** — один виджет кластерами (`IdeaCluster`); плоский виджет-дубль удалить.
- **Команда: трения** — новый блок из `conflicts` (пары + confidence + источник).
- **Компас** — `GoalCompassCard` отдельным виджетом (`goalAlignmentDay`, движение к `isPrimary`).
- **Удалить** виджет «Решения». Разгрузить правую колонку.
Слои `ApiDto→DomainModel→UiModel`; UI только русский; парные токены, без `text-white`/hex на цветном.

## Границы фичи

- ✅ **Always:** переиспользовать `DailyOperationsDigest`/`DailyDigestService`/герой; все выборки с `tenantId`; идемпотентность `(tenantId,dateLocal)`; крутилки в AdminSetting (`raw_char_budget`, пороги конфликтов); персист только LLM-нарратив, числа считает система; метрики prom-client + логи pino.
- ⚠️ **Ask first:** менять контракт `Specialist35/36`/`strategic-alignment`/`DayReportCollector`/`bitrix-ingest`/`chatbox-ingest`; трогать детект конфликтов; менять RBAC; новый ENV вместо AdminSetting.
- 🚫 **Never:** новый извлекающий LLM-агент; новая модель снапшота; `process.env.*` мимо `TypedConfigService`; `prisma migrate`-обход/`new PrismaClient()` в скриптах; Anthropic/Opus в маршруте; авто-merge; дефолт-OFF флаг; числа считать в LLM; оживлять `CheckInConflictDetectorCron`.

## Фазы

Граф зависимостей: **Ф1 → Ф2**; **Ф2 → Ф4**; **Ф4 → Ф5**; **Ф3 ∥** (независима); **Ф6 ∥** (независима); **Ф2 → Ф7** (данные конфликтов/сигналов); всё → **Ф8**. Параллелятся: Ф3 и Ф6 с Ф1/Ф2.

### [x] Ф1 — Индекс `IdeaBlockEvidence` + единый резолв в `Person`
**Ценность:** как система, быстро достаю «что сотрудник X сказал за день» и всегда знаю, кто автор, потому что есть индекс и одна точка резолва.
Картография: миграция К1; helper К2 в `operations` (резолв `userId`→`Person.userId`, bitrix/chatbox `linkedPersonId`, client-различение).
Что входит: составной индекс + `prisma:generate`; `resolvePersonRef` с кэшем; юнит на резолв (сотрудник/клиент/не найден).
Что НЕ входит: сам забор (Ф2).
Acceptance: миграция аддитивна, `migrate deploy` идемпотентен; `grep` индекса в schema; юнит резолва зелёный (bitrix manager→personId, chatbox CLIENT→`{null,isClient:true}`, unknown→`{null,false}`); `typecheck/lint/build` зелёные.
Закрывает: R1, R2.

### [x] Ф2 — Наполнение `buildDayPackage` (4 слоя + конфликты + вчера + план↔факт)
**Ценность:** как отчёт, вижу весь день по каналам с подписью «кто сказал» + конфликты + петлю со вчера, потому что пакет собирает всё готовое из графа.
Картография: `daily-digest.service.ts buildDayPackage`; К3 (структура пакета); Б2 (3 пути голоса); Б5 (сырьё + `raw_char_budget`); К6 (конфликты `since`); `DayReportCollectorService`/`DailyCheckIn` (план↔факт, К3.reporting); вчерашние сигналы из `getStored` (verdict.axes + risksSummary).
Что входит: собрать `employeeVoice`/`rawConversations`/`signals`/`conflicts`/`reporting`/`yesterdayOpenSignals`; крутилка `operations.daily_digest.raw_char_budget` (AdminSetting + реестр + сид); все выборки по `tenantId`+день.
Что НЕ входит: промпт (Ф4), виджеты (Ф7).
Acceptance: юнит `buildDayPackage` — на синтетике день с Битрикс-перепиской, чек-инами (план 5/6, отчёт 3/6), 2 идеями, риском `growing`, 1 конфликтом → пакет содержит все ветки заполненными, числа reporting совпадают с чек-инами, конфликт с именами пар; сырьё превышает `raw_char_budget` → обрезано, не падает; клиентские реплики помечены `isClient:true`; `typecheck/lint/build` + затронутые спеки зелёные.
Закрывает: R3, R4, R5, R6, R7, R8.

### [x] Ф3 — Усиление разметки `team_friction` (block-ingest SYSTEM)
**Ценность:** как ось «Команда», реально наполняюсь конфликтами, потому что ночной разбор их теперь помечает.
Картография: К7 (SYSTEM-текст разметки block-ingest, где перечислены `signalType`); порог `knowledge.conflict_min_confidence`.
Что входит: определение + 2-3 примера для `team_friction` в SYSTEM; схему/enum не трогать; кэш промпта не ломать (правка в стабильном SYSTEM).
Что НЕ входит: детектор конфликтов (не трогаем), схема.
Acceptance: golden-фикстуры — реплики «спор, кто ведёт клиента» / «претензия отдела к отделу» размечаются `team_friction` (раньше — нет); нейтральная рабочая переписка НЕ помечается (нет ложных); `bunx vitest run` по block-ingest prompt-спекам зелёный.
Закрывает: R13.

### [x] Ф4 — Промпт v2 письма + строгая JSON-схема (без «решений»)
**Ценность:** как владелец, получаю письмо COO с именами, петлёй и «взглядом директора», потому что промпт переписан под эталон.
Картография: `daily-digest.prompt.ts` `DAY_COMPANY_SYSTEM_PROMPT` (К4), выходная схема (К5), `buildDayCompanyUserMessage` (подать новые ветки пакета Ф2); `report-prompt-v2.md` — источник SYSTEM/few-shot; `clampVerdict` сохранить.
Что входит: заменить SYSTEM на v2 (12 секций, ФОРМАТ ВЫХОДА=JSON К5); few-shot ЭТАЛОН в JSON-форме; удалить key `decisions`, добавить `intro`/`attention`; `done`/`not_done` — обобщённая проза без cites (Р15); «что помешало» — суммирование причин + конфликты (Р16); «взгляд COO» = `reflection` (Р17); USER подаёт `employeeVoice`/`rawConversations`/`signals`/`conflicts`/`reporting`/`yesterdayOpenSignals`; Zod+json_schema strict синхронно.
Что НЕ входит: маршрут/лимиты (Ф5), тайминг (Ф5→нет, Ф5 отдельная).
Acceptance: юнит — ответ LLM v2 с 12 секциями и без `decisions` проходит `.strict()`; ответ с key `decisions` — отклоняется; `verdict.axes[team].why` умеет содержать конфликт; e2e на реальном DeepSeek (синтетика дня) → JSON валиден, письмо называет имена, есть петля (при поданном `yesterdayOpenSignals`) и `reflection` 5-6 предложений; `grep` — key `decisions` отсутствует в промпте/схеме; `typecheck/lint/build` зелёные.
Закрывает: R9, R10.

### [x] Ф5 — Маршрут модели (DeepSeek Pro→GPT→KIE) + снять `maxTokens` + нагрузочный тест
**Ценность:** как отчёт, влезаю в модель на реальном объёме и деградирую на резерв, потому что маршрут и лимиты настроены.
Картография: К8 (правка `LlmTaskRoute` для `operations-daily-digest` через сид/патч-скрипт `backend/scripts/`); проверка фильтра `dataClass`; нагрузочный прогон на «жирном» пакете (сырьё Битрикс/чатбокс целиком + голос + сигналы).
Что входит: patch/seed-скрипт маршрута (primary DeepSeek Pro → openai-via-proxy → KIE, `maxTokens` снят); регистрация в `apply-prod-deploy.ts STEPS`; нагрузочный тест-скрипт (реальный/синтетический максимальный объём) с замером токенов и cache-hit; при переполнении — проверка страховочной обрезки (Б5).
Что НЕ входит: сам промпт (Ф4).
Acceptance: маршрут применяется, `operations-daily-digest` резолвится в DeepSeek Pro, при форсе ошибки primary — уходит на GPT, затем KIE (лог/метрика fallback); нагрузочный прогон на максимальном пакете укладывается в контекст (или обрезка срабатывает без падения); `dataClass` дневного пакета не отсекает резервы; `typecheck/lint/build` зелёные; скрипт в `STEPS`.
Закрывает: R11.

### [x] Ф6 — Тайминг крона 07:00 МСК
**Ценность:** как отчёт, вижу полный вчерашний день (чек-ины собраны 05:00), потому что генерация сдвинута на 07:00.
Картография: `operations-daily-digest.cron.ts:26` (К8).
Что входит: `@Cron('0 3 * * *')` → `@Cron('0 4 * * *')`. Без комментария-нарратива. `yesterdayInMoscow`/kill-switch не трогать.
Что НЕ входит: событийная цепочка на завершение синков (vNext).
Acceptance: `grep` `@Cron('0 4 * * *')` = 1; `operations-daily-digest.cron.spec.ts` адаптирован и зелёный; на 04:00 UTC `yesterdayInMoscow` даёт завершённый МСК-день (включая чек-ины 05:00 МСК прошедшего дня — они за ВЧЕРА, собраны в 05:00 сегодня); `typecheck` зелёный.
Закрывает: R12.

### [ ] Ф7 — Виджеты: блокеры/риски-по-причине/идеи-кластеры + конфликты + компас; удалить «Решения», дубль идей
**Ценность:** как владелец, вижу виджеты разложенными по полкам и трения в команде, потому что группировки подключены и «Решения» убраны.
Картография: К9; `RisksIdeas.tsx` (блокеры/риски-причина/идеи-кластеры), новый компонент «Команда: трения» (из `conflicts`, DTO К6), `GoalCompassCard` (отдельный виджет), удаление виджета «Решения», удаление плоского дубля идей; DTO-расширение (`verdict.axes[team]`, `conflicts`); `api/*.api.ts`+`domain/*.ts`+SWR.
Что входит: блокеры отдельной секцией; риски по `causeCategory`; идеи одним виджетом кластерами; блок конфликтов; компас отдельно; снять «Решения» и дубль идей; разгрузка правой колонки.
Что НЕ входит: недельный/месячный; мобилка/светлая тема.
Acceptance: на `/dashboard` (owner, Playwright по `index.html`) — блокеры отдельно, риски сгруппированы по причине, идеи одним виджетом кластерами, виден блок «Команда: трения» с парой имён, компас отдельным виджетом показывает движение к главной цели; виджета «Решения» и второго (плоского) виджета идей НЕТ; `grep text-white` в `day-company/*` = 0; английских строк = 0; `typecheck/lint/build` (frontend) зелёные.
Закрывает: R8 (виджет), R11 (виджет), R14.

### [ ] Ф8 — Observability, e2e, прод-шаги, second-brain
**Ценность:** как оператор, вижу метрики нового пакета/маршрута и уверен в выкате.
Что входит: метрики prom-client (размер пакета/токены/cache-hit/fallback модели/конфликтов подано) + логи pino; e2e синтетики дня; second-brain: `01_projects/director-dashboard.md`, `insights.md`, `ideas.md`, `02_architecture/module-map.md` (если новый helper/эндпоинт), `01_projects/ai-jobs.md` (промпт v2); `docs/methodology/prompts/` (сверить промпт v2 с чек-листом, эталон в `examples/`); `docs/operations/prod-deploy-log.md` (Шаг 4 индекс, Шаг 6/7 patch/seed маршрута, Шаг 12 smoke крон 07:00); `docs/operations/feature-flags.md` (kill-switch дайджеста — строка; `raw_char_budget` — крутилка); `04_не-сделано` (Probe, сдвиг продюсера целей, снос `CheckInConflictDetectorCron`).
Acceptance: метрики на `/metrics`; e2e зелёные; second-brain/prod-deploy-log/feature-flags/04-не-сделано обновлены.
Закрывает: R15 (трассировка/выкат).

## Требования (трассировка)

- **R1.** Индекс `IdeaBlockEvidence(tenantId, authorPersonId, sourceTimestamp)` существует; выборка голоса сотрудника за день не делает полный скан.
- **R2.** Единый резолв `userId`/`externalId`→`Person`; клиент отличён от сотрудника; не найден → «без автора».
- **R3.** `DayCompanyPackage` содержит 4 слоя (числа/сигналы/сырьё/вчера) + конфликты, всё за `(tenantId, dateLocal)`.
- **R4.** Битрикс/чатбокс поданы перепиской целиком за день, подписаны автором, сотрудник/клиент различены; при переполнении — страховочная обрезка по `raw_char_budget`, без падения.
- **R5.** Голос сотрудника собран из графа по авторству (3 пути), без нового агента.
- **R6.** План↔факт по людям взят из `DailyCheckIn`; числа посчитаны системой, LLM их не пересчитывает.
- **R7.** Сигналы поданы с `dynamicLabel`/наблюдениями/`causeCategory`; вчерашние открытые сигналы поданы для петли и динамики.
- **R8.** Конфликты за день (`EntityLink conflicted_with`, фильтр по дню) поданы и в промпт (ось «Команда» + «что помешало»), и в виджет «Команда: трения».
- **R9.** Промпт v2 пишет письмо из 12 секций с именами, петлёй со вчера, «взглядом COO»; «что сделано»/«не сделано» — обобщённая проза; «что помешало» суммирует причины + конфликты.
- **R10.** Сущность «решения» отсутствует в промпте, схеме и `letterJson` keys.
- **R11.** Маршрут `operations-daily-digest` = DeepSeek Pro → GPT → KIE; жёсткий `maxTokens` снят; нагрузочный тест на объём пройден.
- **R12.** Крон генерации = `0 4 * * *` UTC (07:00 МСК), после сбора чек-инов.
- **R13.** Разметка `team_friction` в block-ingest усилена примерами; конфликтные реплики размечаются, нейтральные — нет.
- **R14.** Виджеты: блокеры отдельно, риски по причине, идеи кластерами, конфликты «Команда», компас отдельно; «Решения» и дубль идей удалены.
- **R15.** Метрики/логи нового пакета и маршрута; second-brain/prod-deploy-log/feature-flags/04-не-сделано обновлены.

## Инварианты Z (проверить, не нарушено)

- Prisma — файловая миграция (`prisma:migrate -- --name idx_evidence_author_day`), `prisma:generate` после; в скриптах `createPrismaClient()`, импорты `../src`.
- ENV/крутилки — `raw_char_budget`, пороги конфликтов, маршрут/лимиты модели — через AdminSetting/`LlmTaskRoute`; никаких `process.env.*`.
- LLM — DeepSeek Pro primary, резервы GPT/KIE; Anthropic/Opus нет; на `private`-данных Opus и так отсекается — проверить, что резервы дневного пакета не отсечены `dataClass`. Раздел «Совместимость с prompt caching»: стабильный SYSTEM+few-shot, переменные данные в конце USER.
- Ship-On — выкат включённым; новый флаг не вводим (kill-switch дайджеста есть); `raw_char_budget` — крутилка, не флаг.
- Multi-tenancy — все выборки по `tenantId`; снапшот `@@unique([tenantId,dateLocal])`.
- Контракты — Zod-DTO + Swagger; фронт `ApiDto→DomainModel→UiModel`, единый `api-client.ts`, SWR.
- UI — только русский; парные токены, без `text-white`/hex на цветном.
- Без комментариев в коде — знания в этом ТЗ и `docs/`, не в коде.

## Pre-mortem / Риски

- **Переполнение контекста сырьём Битрикс/чатбокс.** Митигейт: `raw_char_budget` (крутилка) + страховочная обрезка (Б5) + нагрузочный тест до выката (Ф5).
- **`dataClass` отсекает резервы (GPT/KIE).** Митигейт: явная проверка Ф5 — дневной пакет не помечен выше `private`; иначе поднять допустимый класс маршрута.
- **Конфликтов всё равно мало** даже после усиления. Митигейт: Ф3 golden-фикстуры подтверждают разметку; порог — крутилка; если пусто — виджет/секция просто отсутствуют (промпт не пишет «нет данных»).
- **Атрибуция теряется** (`authorPersonId=null` у внешних). Митигейт: резолв К2 + метка «без автора»; голос без автора не приписываем чужому.
- **Нюанс тайминга компаса** (02:00 vs данные позже). Принято (Р14): v1 как есть, зафиксировать в `04_не-сделано`.
- **`.strict()` рассинхрон** схемы (удаление `decisions`, добавление `intro`/`attention`). Митигейт: Ф4 меняет Zod и json_schema разом; acceptance грепает отсутствие `decisions`.
- **Регресс базового `DailyDigestClient`** (старый экран). Митигейт: поля DTO опциональны; удаление `decisions` из letter — проверить, что старый рендер не падает на отсутствии key.
- **Ревью-гейт (`strict-production-review-gate`):** tenant-изоляция всех выборок; идемпотентность `(tenantId,dateLocal)`; отсутствие нового извлекающего агента/модели; числа не считаются в LLM; нет Anthropic/`process.env`/`migrate`-обхода/`new PrismaClient`.

## Idempotency / feature-flag / prod-deploy

- **Idempotency:** снапшот `(tenantId,dateLocal)` через `getStored`/`getOrGenerate` (как в базе); повтор дня = no-op.
- **Флаг:** переиспускаем kill-switch `operations.daily_digest.enabled`; новый не вводим. `raw_char_budget` + пороги конфликтов — крутилки AdminSetting (строки в реестре + `feature-flags.md` при необходимости).
- **prod-deploy-log:** Шаг 4 (индекс `idx_evidence_author_day` + миграция), Шаг 6/7 (patch/seed маршрута модели через `apply-prod-deploy.ts STEPS`), Шаг 12 (smoke: крон `operations-daily-digest` в 07:00 + новый виджет-эндпоинт конфликтов). Миграция авто через `migrate deploy`.

## DoD

- `bun run typecheck` (вкл. `.spec`) / `lint` / `build` зелёные (backend + frontend); `bunx vitest run` затронутых — зелёные.
- e2e на реальном DeepSeek: синтетика дня (Битрикс-переписка + чек-ины + идеи + риск-тренд + 1 конфликт) → JSON-письмо v2 с именами, петлёй, «взглядом COO», без «решений»; виджеты отрисованы по прототипу (Playwright).
- second-brain обновлён по таблице производных заметок (director-dashboard/insights/ideas/module-map/ai-jobs); `docs/methodology/prompts/` сверен; prod-deploy-log (Шаги 4/6-7/12) + feature-flags + `04_не-сделано` (Probe, сдвиг продюсера целей, снос `CheckInConflictDetectorCron`) обновлены.
- Рефлексия в `05_история/` после push.

## Итог

_(заполнит tz-orchestrator по завершении: что реализовано целиком, что осталось.)_
