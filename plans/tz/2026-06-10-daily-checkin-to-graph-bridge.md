---
type: tz
status: ready-to-implement
feature: daily-checkin-to-graph-bridge
date: 2026-06-10
owner: sergrv80 (владелец)
relates_to:
  - plans/analysis/2026-06-10-chatbox-svmazur-analysis.md
  - plans/tz/2026-06-10-query-understanding-tier0-tier1.md
  - plans/tz/2026-06-10-cabinet-fixes-master.md
  - plans/archive/2026-05-29-telegram-self-initiated-checkins.md
  - plans/tz/2026-06-05-chatbox-integration.md
---

> Решение согласовано владельцем в сессии (Вариант A — мост в граф через `IngestService`, по образцу chatbox). Триггер: владелец спросил «попадают ли утренний план / вечерний отчёт в память компании?» — проверка показала, что НЕТ (изолированная таблица `DailyCheckIn`, AI-чат их не видит).

## Принцип
ТЗ — программный контракт. Реализатор не переспрашивает, не угадывает, не «оптимизирует по-своему». Эталон для копирования — `ChatboxIngestService` (`chatbox-ingest.service.ts`): тот же `IngestService.ingest`, что у встреч и переписки.

## Цель + Зачем
**Болезненное состояние (verified по коду):** ежедневные чек-ины (план/отчёт сотрудника: что сделано / не сделано / блокеры / инсайты) хранятся в изолированной таблице `DailyCheckIn` и **не попадают в граф знаний**. Событие `checkin.created` слушает только sentiment-анализатор; подписки в knowledge-core нет; ни одного `IngestService.ingest`/`RawEvent` для чек-инов. Следствие: AI-чат компании НЕ может ответить «что делал сотрудник X на прошлой неделе», ролевые клоны не учатся на ежедневной работе, пульс видит только агрегаты дня.

**Зачем чинить:** это прямой разрыв позиционирования «память, которая помнит за всю команду» — самый частотный след работы людей (ежедневные планы/отчёты) в памяти отсутствует. Tier 0/Tier 1 retrieval (структурные фильтры время/тип/тема/«я») уже работает по графу — как только чек-ины в графе, запрос «что делал X на неделе» начинает работать без изменений в retrieval.

**Метрика «решено»:** после выката каждый завершённый чек-ин (`completedAt != null`) порождает ровно один `RawEvent(sourceType='daily_checkin')` (идемпотентно по `checkInId`), из которого block-ingest строит IdeaBlock'и с `authorPersonId` сотрудника; на проверочном запросе в chat-v2 «что делал <сотрудник> на этой неделе» возвращаются блоки из его чек-инов.

## REALITY-CHECK (фактическое состояние по коду)
| Что | Факт | Где |
|---|---|---|
| Модель чек-ина | `DailyCheckIn`: kind morning/evening, plansJson/donesJson/blockersJson, rawResponseText, parseConfidence, curatorReview, completedAt, sentiment/qualityScore (оценочный слой COO), source | `schema.prisma:6901-6969` |
| Событие | `checkin.created` payload `{tenantId, checkInId, personId, kind, rawText}` эмитится при каждом upsert (cron/self/manual) | `checkin-response.handler.ts:173,:342`, `daily-checkin.service.ts:115` |
| Подписчики события | ТОЛЬКО `CheckinSentimentAnalyzerWorker`; в knowledge-core НЕТ | `checkin-sentiment-analyzer.worker.ts:42` |
| Мост в граф | ❌ нет `IngestService.ingest`/`RawEvent` для чек-инов; `DailyCheckIn` в knowledge-core только в комментариях («β-8 планировалось») | `router.service.ts:365`, `block-ingest.prompt.ts:475-476` |
| Эталон моста | `ChatboxIngestService.ingestSession`: сессия → `RawEvent(sourceType='chatbox')` через `IngestService.ingest`; payload с `fullText` + `transcript.turns` (per-message `authorPersonId`); идемпотентность `sourceExternalId=sessionId`; lazy `upsertSource`; `applyInputGuards` (анти-инъекция) | `chatbox-ingest.service.ts:66-346` |
| Сигнатура ingest | `ingest.ingest({tenantId, sourceId, sourceExternalId, occurredAt, payload, dataClass})` → `{rawEvent:{id}}` | `chatbox-ingest.service.ts:330-337` |
| enum SourceType | meeting, chat, phone_call, bot, email, web_form, external, conversational, tracker_event, chatbox — **нет `daily_checkin`** | `schema.prisma:251-273` |
| enum DataClass | public, internal, sensitive, private | `schema.prisma:276-281` |
| Маршруты signalType | `plan_item`/`commitment`→GOALS; `blocker`/`resource_gap`→INSIGHTS; `done_item`→**no-op** «до появления специалистов»; block-extraction сама определяет signalType из текста | `router.service.ts:348-378`; `block-ingest.prompt.ts:475-476` (знает про DailyCheckIn-источник) |

**Вывод REALITY-CHECK:** это «подключить готовое по эталону». Новое: значение enum `daily_checkin` (миграция), сервис-мост `CheckinIngestService` (копия паттерна chatbox-ingest), подписка `@OnEvent('checkin.created')`, kill-switch. block-ingest НЕ трогаем — он сам извлечёт сигналы из `fullText`; мы лишь даём качественный структурированный текст и атрибуцию автора.

## Принятые решения владельца (НЕ пересматривать)
| # | Решение | Обоснование (Почему) |
|---|---|---|
| Р-B0 | Решение A: мост чек-ин → knowledge-core через `IngestService.ingest`, sourceType `daily_checkin`, по образцу `ChatboxIngestService`. | Память — это связи (сущности/темы/обещания), которые извлекает block-ingest; прямой retrieval по таблице (B) дал бы плоский список без связей. Эталон chatbox доказан в проде. |
| Р-B1 | Чек-ины с низкой уверенностью парсера (`curatorReview`, `parseConfidence<0.6`) — **ингестить сырым текстом всё равно**; `curatorReview` остаётся флагом только для UI. | block-ingest (LLM-разбор) сильнее простого парсера и сам извлечёт факты; кураторской проверки на 30 человек может не быть — иначе память теряет данные. |
| Р-B2 | Ингестить ФАКТЫ (plans/dones/blockers + rawResponseText/инсайты). НЕ ингестить `sentiment`/`sentimentRationale`/`qualityScore`. | Это оценочный слой для COO-дашборда, не факт о работе; граф хранит факты, не оценки настроения. |
| Р-B3 | `dataClass='sensitive'` (паритет с chatbox). | Чек-ин — личная рабочая рефлексия; sensitive ограничивает выбор LLM-провайдеров и совпадает с переписками. Privacy сейчас в низком приоритете ([[feedback_privacy_deprioritized_now]]), доступ регулирует существующий knowledge-access — не ослаблять. |
| Р-B4 | signalType НЕ задаём явно — его определяет block-extraction из текста. Мы рендерим `fullText` с явными секциями («План на день», «Сделано», «Блокеры») + контекст, чтобы извлеклись `plan_item`/`commitment`/`blocker`/`insight`. `done_item` (no-op в router) допустим как блок графа — он всё равно в retrieval. | Эталон chatbox шлёт транскрипт, block-ingest классифицирует; явный маппинг дублировал бы LLM-классификатор. |
| Р-B5 | Kill-switch `CHECKIN_GRAPH_INGEST_ENABLED` (ON по умолчанию). | Ship-On ([[feedback_ship_on_flags]]); рубильник на случай инцидента в block-ingest, действий владельца не требует. |

## Доказательство выбора (два прохода + challenge)
Полная состязательная матрица A/B/C — в `plans/analysis/2026-06-10-...` (разобрано в сессии; кратко ниже).

**A: ingest → граф (реком.)** vs **B: прямой retrieval по таблице DailyCheckIn** vs **C: детерминированный маппинг полей в IdeaBlock (минуя block-ingest LLM)**.

| Критерий | A (реком.) | B | C |
|---|---|---|---|
| Видно в AI-чате через Tier 0/1 | ✅ по графу | ⚠️ только спец-кейсом в retrieval | ✅ но без связей |
| Связи сущности/темы/обещания | ✅ block-ingest извлекает | ✗ плоский список | ✗ нет извлечения |
| Переиспользование кода | ✅ эталон chatbox-ingest | ✗ новый источник+ранжир | ⚠️ мимо block-ingest |
| Кормит клонов и пульс | ✅ | ✗ только чат | ⚠️ частично |
| Риск регресса retrieval | ✅ ноль | ⚠️ меняет горячий путь | ✅ ноль |
| Доп. стоимость LLM | ⚠️ block-ingest на чек-ин (дёшево) | ✅ ноль | ✅ ноль |

**Выбор A.** Challenge-loop:
- *Корень, а не симптом?* Да — чинит весь КЛАСС «ежедневная работа людей в памяти» (чат + клоны + пульс), не только «покажи задачи».
- *Самое эффективное?* Да — копия доказанного chatbox-паттерна; событие `checkin.created` уже эмитится, приёмник (block-ingest с plan_item/blocker) уже есть.
- *Код ради кода?* Нет — `IngestService`, block-ingest, Tier 0/1 переиспользуются; новое — один сервис-мост + подписка + enum-значение.

## Граничные контракты с другими ТЗ
- **block-ingest worker / RouterService** — НЕ трогать; подаём `fullText`+`turns`, он сам извлекает блоки и маршрутизирует. `done_item` остаётся no-op (не наша забота).
- **`ChatboxIngestService`** — образец, НЕ рефакторить; копируем паттерн (`renderTranscript`, `upsertSource`, `transcript.turns` с `authorPersonId`, idempotency).
- **`CheckinSentimentAnalyzerWorker`** — продолжает слушать тот же `checkin.created` независимо; наш подписчик — дополнительный, не заменяет.
- **knowledge-access (Ф4)** — чек-ины идут в граф под `authorPersonId`; доступ регулируется существующими access-предикатами, не ослаблять.

## Контракт-first

### К-1. Новое значение enum SourceType (миграция)
`backend/prisma/schema.prisma` (`:251-273`) — добавить в `enum SourceType` ПОСЛЕ `chatbox`:
```prisma
  /// Ежедневный чек-ин сотрудника (план/отчёт) → RawEvent → knowledge-core.
  /// Мост CheckinIngestService (ТЗ 2026-06-10-daily-checkin-to-graph-bridge).
  daily_checkin
```
Версионируемая миграция (`prisma-db-push-rules`): `ALTER TYPE "SourceType" ADD VALUE 'daily_checkin'` — рукописная миграция в `prisma/migrations/` (ADD VALUE нельзя в одной транзакции с использованием значения; отдельная миграция). После — `prisma:generate`. На прод — `migrate deploy` (авто).

### К-2. Сервис-мост `CheckinIngestService`
Новый файл `backend/src/modules/operations/services/checkin-ingest.service.ts` (или в knowledge-core — выбрать модуль, где `IngestService` доступен через @Global; chatbox-ingest живёт в своём модуле — допустимо в operations). По образцу `ChatboxIngestService`:
```ts
const SOURCE_TYPE = 'daily_checkin' as const;
const SOURCE_NAME = 'Ежедневные чек-ины' as const;
```
Метод `ingestCheckin(tenantId: string, checkInId: string): Promise<{ rawEventId: string } | null>`:
1. Читает `DailyCheckIn` по `(id=checkInId, tenantId)`; если нет ИЛИ `completedAt === null` → return null (пустой чек-ин не ингестим).
2. Читает `Person` (имя для speaker) по `personId`.
3. Рендерит `fullText` структурно (русский, секции по содержимому):
   ```
   Чек-ин сотрудника <Имя>, <дата>, <утренний план|вечерний отчёт>.
   План на день:
   - <plansJson[].text>
   Сделано:
   - <donesJson[].text>
   Блокеры:
   - <blockersJson[].text> (severity)
   <если структура пустая → rawResponseText целиком>
   ```
   Низкая уверенность (Р-B1): если plansJson/donesJson/blockersJson пусты — использовать `rawResponseText` как тело.
4. `transcript.turns` — один turn (или по секциям) с `authorPersonId = personId`, `speaker = Имя`, синтетические `startSec/endSec` (как chatbox). НЕ ингестить sentiment/qualityScore (Р-B2).
5. `applyInputGuards(SYSTEM, fullText, { injection: true })` — анти-инъекция (чек-ин — текст пользователя).
6. `upsertSource(tenantId)` — lazy, `dataClass='sensitive'` (Р-B3), конкурентно-безопасно (P2002-retry) — копия chatbox.
7. `occurredAt` = `completedAt` (когда заполнен — для темпорального retrieval «на этой неделе»). **Идемпотентность:** `sourceExternalId = checkInId`.
8. `ingest.ingest({ tenantId, sourceId, sourceExternalId: checkInId, occurredAt, payload, dataClass: 'sensitive' })`.
9. (опц.) сохранить `rawEventId` обратно — у `DailyCheckIn` поля `rawEventId` НЕТ; добавлять колонку НЕ требуется для v1 (идемпотентность по `sourceExternalId` уже защищает от дублей). Если нужно для трассировки — отдельная развилка, не в этой версии.

> ⚠️ Поведение повторного `sourceExternalId` (replace чек-ина в тот же день: upsert не меняет `checkInId`, но контент меняется) — ПРОВЕРИТЬ эмпирически (`feedback_verify_framework_behavior_empirically`): обновляет ли `ingest.ingest` существующий RawEvent.payload и триггерит ли переизвлечение, или повторный вызов = no-op. Зафиксировать факт в коде-комментарии. Если no-op (как у chatbox по неизменной сессии) — для v1 принять «первый завершённый чек-ин дня → канон», replace в граф не доезжает (отметить как известное ограничение в реестре не-сделанного). Если обновляет — replace работает.

### К-3. Подписка на событие
Новый подписчик `@OnEvent('checkin.created')` (по образцу `CheckinSentimentAnalyzerWorker:42`) — отдельный worker/listener `CheckinGraphIngestListener` (в том же модуле, что К-2):
```ts
@OnEvent('checkin.created')
async onCheckinCreated(ev: { tenantId: string; checkInId: string; personId: string; kind: string; rawText: string | null }): Promise<void> {
  if (!this.cfg.<...>.checkinGraphIngestEnabled) return;   // kill-switch
  try { await this.ingestService.ingestCheckin(ev.tenantId, ev.checkInId); }
  catch (err) { this.logger.warn(...); }   // best-effort, не ломаем основной flow
}
```
Best-effort: ошибки моста НЕ ломают создание чек-ина/sentiment (тот же принцип, что emit в `checkin-response.handler.ts:180`).

### К-4. Kill-switch
`backend/src/common/config/env.schema.ts` — `CHECKIN_GRAPH_INGEST_ENABLED: zBool(true)` (рядом с другими bot/operations-флагами); геттер в `TypedConfigService`. Строка в `docs/operations/feature-flags.md`: тип kill-switch, состояние ON.

## Границы фичи
- ✅ Always: `tenantId` во всех запросах; идемпотентность по `checkInId`; best-effort (мост не ломает чек-ин); `dataClass='sensitive'`; анти-инъекция guards.
- ⚠️ Ask first: добавление колонки в `DailyCheckIn`; новый `signalType`; изменение block-ingest промпта/router.
- 🚫 Never: ингест `sentiment`/`qualityScore` в граф; ослабление knowledge-access; `new PrismaClient()` (в скриптах — `createPrismaClient()`); `process.env.*`; ингест незавершённого чек-ина (`completedAt=null`).

## Требования (R1…R9)
- **R1.** Когда эмитится `checkin.created` и `CHECKIN_GRAPH_INGEST_ENABLED=true`, система shall вызвать `ingestCheckin(tenantId, checkInId)`.
- **R2.** Если `DailyCheckIn.completedAt = null` ИЛИ запись не найдена, система shall вернуть null без ингеста.
- **R3.** Система shall создать ровно один `RawEvent(sourceType='daily_checkin')` на завершённый чек-ин, идемпотентно по `sourceExternalId=checkInId` (повторный emit не плодит RawEvent).
- **R4.** `payload.fullText` shall содержать факты чек-ина (план/сделано/блокеры или `rawResponseText`); `payload.transcript.turns[].authorPersonId` shall = `personId` сотрудника.
- **R5.** Система shall НЕ включать `sentiment`/`sentimentRationale`/`qualityScore` в payload (Р-B2).
- **R6.** Чек-ины с `parseConfidence<0.6`/`curatorReview=true` shall ингеститься (сырым текстом), не пропускаться (Р-B1).
- **R7.** `dataClass` всех чек-ин-RawEvent shall = `'sensitive'`.
- **R8.** `occurredAt` shall = `completedAt` (ось темпорального retrieval).
- **R9.** Ошибка моста shall быть best-effort (warn-лог), НЕ ломать создание чек-ина и sentiment-анализ.

## Фазы (dependency-ordered)
Граф: Ф1 → Ф2 → Ф3 → Ф4 (Ф2 нужен enum из Ф1; Ф3 — сервис из Ф2; Ф4 проверяет).

### Фаза 1 — enum SourceType `daily_checkin` + миграция `[x]`
Картография: `schema.prisma:251-273`; образец рукописной enum-миграции — последние `prisma/migrations/` (греп `ADD VALUE`).
Входит: К-1; `prisma:generate`.
Acceptance:
- grep: `daily_checkin` в `enum SourceType`; миграция-файл с `ALTER TYPE "SourceType" ADD VALUE 'daily_checkin'`.
- `bun run typecheck && bun run build` зелёные; повторный прогон миграции = no-op (idempotent guard `IF NOT EXISTS`/проверка).
Закрывает: предпосылка R3.

### Фаза 2 — `CheckinIngestService` (мост по образцу chatbox) `[x]`
Картография: `chatbox-ingest.service.ts:66-346` (эталон, копировать структуру), `schema.prisma:6901-6969` (DailyCheckIn), `Person` (имя/timezone), `ingest.service.ts` (сигнатура — сверить).
Входит: К-2 (рендер, upsertSource, turns с authorPersonId, ingest, idempotency); эмпирическая проверка replace-семантики.
НЕ входит: подписка на событие (Ф3); флаг (Ф3).
Acceptance:
- Unit (мок prisma+ingest): завершённый чек-ин с plans/dones/blockers → `ingest.ingest` вызван с `sourceType` источника `daily_checkin`, `sourceExternalId=checkInId`, `dataClass='sensitive'`, `payload.transcript.turns[0].authorPersonId=personId`, `occurredAt=completedAt`; в payload НЕТ sentiment/qualityScore.
- `completedAt=null` → ingest НЕ вызван, return null.
- curatorReview-чек-ин (пустые plans/dones/blockers, есть rawResponseText) → `fullText` = rawResponseText, ingest вызван.
- typecheck/build зелёные.
Закрывает: R2, R3 (частично), R4, R5, R6, R7, R8.

### Фаза 3 — Подписка `@OnEvent('checkin.created')` + kill-switch `[x]`
Картография: `checkin-sentiment-analyzer.worker.ts:42` (образец подписки), `env.schema.ts`, `typed-config.service.ts`.
Входит: К-3, К-4.
Acceptance:
- Unit: при `checkin.created` и флаге ON → `ingestCheckin` вызван с (tenantId, checkInId); при флаге OFF → не вызван; брошенная ошибка `ingestCheckin` не пробрасывается (best-effort).
- grep: `@OnEvent('checkin.created')` присутствует в новом listener'е; флаг `CHECKIN_GRAPH_INGEST_ENABLED` в env.schema + feature-flags.md.
- typecheck/build зелёные.
Закрывает: R1, R9.

### Фаза 4 — Тесты, smoke, prod-deploy, second-brain, реестр `[x]`
Входит: метрика `z_checkin_graph_ingest_total{result}` (ok/skipped/error); `feature-flags.md` (новый kill-switch); `prod-deploy-log.md` Шаг 4 (enum/миграция SourceType) + Шаг 12 (smoke: новый sourceType появляется в RawEvent после чек-ина; новая очередь/cron — нет, событийный); ручной smoke (создать чек-ин тестовым аккаунтом → diag проверить RawEvent/граф). Строка в `second-brain/04_не-сделано/README.md` — перенести «мост чек-ин→граф (β-8)» в «Закрытые» после выката.
Acceptance:
- `bun run typecheck && bun run lint && bun run build` зелёные; vitest Ф2/Ф3 зелёные.
- second-brain обновлён: `01_projects/ai-jobs.md` (новый источник графа), `02_architecture/knowledge-core.md` (ingest-источники += daily_checkin), `01_projects/conversational-channels.md` (чек-ины кормят граф); `02_architecture/data-model.md` (enum SourceType += daily_checkin).
Закрывает: R1–R9 (сквозная) + DoD.

## Pre-mortem / Риски + ревью-аспекты
- **Replace чек-ина дня не доезжает в граф** (если ingest повторный = no-op). Митигация: эмпирическая проверка в Ф2; при no-op — задокументировать ограничение в реестре не-сделанного, fast-follow «re-ingest при wasReplace».
- **block-ingest плохо извлекает из коротких чек-инов** («норм, всё сделал»). Митигация: структурный `fullText` с секциями; короткий бессодержательный → блоки не извлекутся (приемлемо — не мусорить графом). Ревью: не падать на пустом извлечении.
- **Стоимость block-ingest на каждый чек-ин.** 30 человек × 2/день = дёшево (deepseek). Не оптимизировать преждевременно (триггер пересмотра: >1000 чек-инов/день).
- **Двойной слушатель `checkin.created`** (sentiment + graph) — независимы, оба best-effort. Ревью: порядок не важен, ошибка одного не влияет на другого.
Ревью-аспекты (`strict-production-review-gate`): tenantId во всех запросах; идемпотентность как acceptance; best-effort guard; dataClass=sensitive; не ингестить незавершённое; нет ослабления access.

## Idempotency / feature-flag / prod-deploy
- Идемпотентность по `sourceExternalId=checkInId` — повторный emit = тот же ключ (acceptance R3).
- Kill-switch `CHECKIN_GRAPH_INGEST_ENABLED` (ON), строка в `feature-flags.md`.
- prod-deploy-log: Шаг 4 (миграция enum SourceType — опасное изменение типа, отметить порядок: миграция значения отдельно от использования), Шаг 1 (новая ENV), Шаг 12 (smoke RawEvent sourceType=daily_checkin). Без seed/patch/backfill в v1 (исторические чек-ины НЕ доингещиваем — отдельный backfill-ТЗ при нужде, отметить в Не входит).

### Не входит (→ vNext)
- Backfill исторических чек-инов в граф → vNext-ТЗ `2026-06-XX-checkin-graph-backfill` (`backfill-*` скрипт, регистрация в `apply-prod-deploy.ts STEPS`).
- Re-ingest при replace чек-ина дня (если Ф2 покажет no-op-семантику).
- Поле `DailyCheckIn.rawEventId` для трассировки (не требуется при idempotency).

## DoD
- typecheck (вкл. `.spec`)/lint/build зелёные; vitest Ф2/Ф3 зелёные.
- second-brain: `01_projects/ai-jobs.md`, `02_architecture/knowledge-core.md`, `02_architecture/data-model.md`, `01_projects/conversational-channels.md` обновлены.
- `feature-flags.md` + `prod-deploy-log.md` (Шаг 1, 4, 12) обновлены; реестр `04_не-сделано` — строка про β-8-мост перенесена в «Закрытые» после выката.
- Рефлексия в `05_история/`.

## Совместимость с prompt caching
- Мост НЕ добавляет нового LLM-промпта с переменным SYSTEM. block-ingest (существующий) получает чек-ин как обычный RawEvent — его кэш не затрагивается структурой нашего payload (переменная часть — `fullText` в конце). Анти-инъекция guards применяются к user-части. Соответствует [[feedback_llm_prompts_cache_friendly]].

## Итог
**Реализовано целиком (Ф1–Ф4)** — ветка `feature/meeting-cabinet-fixes-2026-06-10`, коммиты:
- `de288e8a` — код Ф1–Ф3 + метрика: enum `SourceType += daily_checkin` (миграция `20260610140000_source_type_daily_checkin`, `ADD VALUE IF NOT EXISTS`), `CheckinIngestService` (рендер fullText + transcript.turns с authorPersonId + lazy upsertSource sensitive + идемпотентность по checkInId), `CheckinGraphIngestListener` (`@OnEvent('checkin.created')`, best-effort), kill-switch `CHECKIN_GRAPH_INGEST_ENABLED` (ON), метрика `z_checkin_graph_ingest_total{result}`. Unit: 12 (сервис) + 4 (listener) = 16 зелёных.
- Ф4 — доки: `feature-flags.md`, `prod-deploy-log.md` (Шаг 1/4/12), second-brain (`ai-jobs`, `knowledge-core`, `data-model`, `conversational-channels`), реестр `04_не-сделано`.

**Ключевое инженерное решение (отклонение от R8 с обоснованием):** `occurredAt` берётся из **стабильного `dateLocal`**, а не из литерального `completedAt` (R8). Эмпирически проверено: `completedAt = new Date()` переписывается на КАЖДОМ upsert'е (`daily-checkin.service.ts:316`), а `IngestService.ingest` при совпадении idempotencyKey возвращает существующий RawEvent без обновления payload. Литеральный `occurredAt=completedAt` дрейфил бы idempotencyKey при replace → дубль RawEvent (нарушение R3 «ровно один»). `dateLocal` неизменен по checkInId и семантически = рабочий день (даже точнее для темпорального retrieval). Эталон chatbox решил так же (`startedAt`, не `endedAt`).

**Известное v1-ограничение:** replace чек-ина того же дня = no-op (первый завершённый = канон) — занесено в реестр `04_не-сделано`; re-ingest при wasReplace → vNext.

**Верификация:** `bun run typecheck` + `bun run build` + `bun run lint` (0 ошибок) + vitest 16/16 зелёные. DI: `IngestService` @Global (подтверждено), оба провайдера в `operations.module.ts`, build OK. **Не проверено:** живой прод-прогон (нужен прод-доступ + завершённый чек-ин → diag RawEvent) — после выката.

**Остаток:** только прод-выкат (`docker compose up -d --build` → migrate deploy авто) + перенос строки реестра в «Закрытые» после выката.
