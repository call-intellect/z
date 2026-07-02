---
type: analysis
status: research-complete
feature: conflict-detection-through-graph-hub
date: 2026-06-29
snapshot_date: 2026-06-29
owner: Сергей (владелец продукта Кора)
related:
  - plans/analysis/2026-06-29-conflict-detector-vs-graph-report.md
  - plans/analysis/2026-06-29-extraction-agents-inventory-and-modular-standardization.md
  - second-brain/02_architecture/knowledge-core.md
method: всё [verified] прямым Read/grep живого кода (vexp маскирует grep-тул, использован bash grep); file:line — снимок 2026-06-29
next: solution-blueprint → tz-author
---

> Вопрос владельца: «обнаружение конфликтов должно идти через нарезчик / общую систему, как все сигналы. Но находит ли нарезчик конфликты вообще? И ты же говорил, что агенты берут всё из общего хаба.»
>
> **Прямой ответ на «ты говорил, что берут из хаба»:** детекторов конфликтов ДВА. Один (`PersonalRelationBuilder`) действительно на хабе — он ждёт блок с меткой трения от нарезчика. Второй (`CheckInConflictDetectorCron`) — **в обход хаба**, regex по сырому тексту чек-ина. Так что я был прав про хаб, но не договорил: на хабе детектор есть, но он **голодает**, потому что — и это главная находка — **сам нарезчик трение почти не размечает**. Из-за этого и прикрутили regex-костыль. То есть «работает неправильно» — это не один баг, а цепочка из 4 звеньев (см. §2).

# Детектор конфликтов: довести до графового хаба

## 1. Как устроено сейчас

### 1.1. Хаб и то, что чек-ины уже в нём

Хаб = граф знаний: `RawEvent → block-ingest (нарезчик, LLM) → IdeaBlock + signalType + entities(люди) → block-distill (canonical) → RouterService.dispatch → специалист`. Чек-ины **уже подключены к хабу** мостом: событие `checkin.created` → `CheckinGraphIngestListener` (`backend/src/modules/operations/workers/checkin-graph-ingest.listener.ts`) → `CheckinIngestService.ingestCheckin` создаёт `RawEvent`. Значит, чтобы ловить конфликты «как все сигналы», отдельный путь по чек-инам **не нужен** — они и так проходят нарезку.

На friction-сигнал роутер ставит **двух** адресатов (`router.service.ts:375-379`): `INSIGHTS` (3-5) и `PERSONAL_RELATION` (3-12). **НО** (важно, см. §2) воркер инсайтов friction **отбрасывает** → реальный потребитель остаётся один: `PersonalRelation`.

### 1.2. Детектор A — `PersonalRelationBuilderWorker` (НА хабе) ✅, но голодает

- Файл: `backend/src/modules/operations/workers/personal-relation-builder.worker.ts:14`.
- Триггер: **router-dispatch по `signalType`** (реактивно, на canonical-блок; не cron). Регистрация хендлера: `backend/src/modules/knowledge-core/workers/specialist-routing-dispatcher.worker.ts:99` (inject `:68-69`, import `:19`). `SPECIALIST_NAME='3-12-personal-relation'` (`router.service.ts:71`, приоритет `:123`).
- Что читает: `IdeaBlock` `status='canonical'` + `entities` (`worker.ts:43-52, 75`), фильтр `entity.type==='person'` (`:83`).
- Условие: **≥2 person-сущности в ОДНОМ блоке** (`:84`) И `signalType ∈ {team_friction, process_friction}` (`:96`).
- Пишет: `EntityLink relationType='conflicted_with'` (`:109`), `confidence=0.65` (хардкод `:110`, порог `MIN_CONFIDENCE=0.6` `:18`), `createdBy='linker'`, `properties.sourceBlockId/sourceSignalType` (`upsertLink :160-205`), ребро на каждую пару person×person (`:124-141`).

### 1.3. Детектор B — `CheckInConflictDetectorCron` (В ОБХОД хаба) ❌

- Файл: тот же — `personal-relation-builder.worker.ts:210` (другой класс ниже).
- Триггер: `@Cron('0 4 * * *')` (`:232`) — **без `timeZone`** → UTC (= 07:00 МСК).  Провайдер: `backend/src/modules/operations/operations.module.ts:137`.
- Что читает: `dailyCheckIn` где `createdAt >= now−24ч` (`:250-263`), поля `rawResponseText/plansJson/donesJson/blockersJson` (`assembleTextBlob :333-355`). **НЕ читает `notDoneJson` (`schema.prisma:7368`) и `ideasJson` (`schema.prisma:7370`)**.
- Как ищет: **7 кириллических regex'ов** «конфликт/спор/спорю/недовольство/трения/ругаюсь/ссор + с + Имя» (`CONFLICT_PATTERNS :216-224`) → имена (`extractCandidateNames :357-373`) → матч `Person` по **3-буквенному корню** (`matchPersonsByRoot :375-414`, `ROOT_LEN=3` `:379`).
- Пишет: то же ребро `conflicted_with` (`:435`), но `confidence=0.55` (хардкод `:213`), `properties.source='checkin-conflict-detector'/sourceCheckInId/sourceText` (`upsertConflictLink :424-475`); `SNIPPET_LIMIT=200` `:214`.

### 1.4. Кто что читает — сводка

| | A — PersonalRelation (на хабе) | B — CheckInConflict (мимо хаба) |
|---|---|---|
| На хабе? | **Да** (`IdeaBlock` по `signalType`) | **Нет** (сырой текст чек-ина regex'ом) |
| Триггер | router-dispatch, реактивно | `@Cron 0 4 * * *` (UTC) |
| Источник | `team_friction`/`process_friction` блоки | `dailyCheckIn.rawResponseText`+plans+dones+blockers |
| Условие | ≥2 person в одном блоке | regex «X с Y» + матч по корню 3 буквы |
| Выход | `EntityLink conflicted_with` conf **0.65** | то же ребро conf **0.55** |
| ИИ | да (раньше, на нарезке метки) | нет вообще |

Оба `upsert`-ят в **одно ребро** по общему unique-ключу (`fromEntityId_fromType_toEntityId_toType_relationType`; enum `conflicted_with` — `schema.prisma:779`) → **last-write-wins**, confidence скачет 0.55↔0.65.

### 1.5. Потребители ребра `conflicted_with`

`personal-relation.service.ts` → дашборд «трение в команде» (`operations-dashboard.service.ts:32`), `team-health.service.ts:110`, `burnout-risk-detector.cron.ts:211`. `[последние три — из параллельного исследования; точные строки подтвердить картографией при ТЗ]`. Формат ребра при переходе на единый детектор **не меняется** → читатели не трогаем.

## 2. Корневая причина — цепочка из 4 звеньев

Не один баг, а каскад: **сигнал не рождается → единственный потребитель голодает → запасной канал мёртв.**

1. **Нарезчик не обучен размечать трение (корень).** Метки `team_friction`/`process_friction` есть **только в словаре** `SIGNAL_TYPE_VALUES` (`block-ingest.prompt.ts:44-45`). В **теле промпта** (правила + few-shot разбора спорных случаев) про трение/конфликт — **ноль**: все правила и примеры про `decision`/`commitment`/`task_completed`/`done_item`/`churn_risk`/`idea`/`question`. `[verified: grep по prompts/block-ingest*.ts — friction/трение/конфликт встречаются только в строках-словаре :44-45]`. Без определения «что считать трением» и примеров LLM эту метку почти не выбирает.
2. **Единственный потребитель голодает + узкое условие.** Раз метка редко ставится — `PersonalRelationBuilder` редко получает работу; и даже получив, требует **≥2 person в одном блоке** (`worker.ts:84`), т.е. трение, где назван один человек, ребра не даёт.
3. **Путь в инсайты — тупик.** Роутер шлёт friction в `INSIGHTS` (`router.service.ts:377`), но воркер инсайтов принимает только `pain|risk|churn_risk|objection` и friction **явно отбрасывает** (`specialist-3-5-insights.worker.ts:62-63`). `[verified]`. Значит трение НЕ становится Insight'ом — у friction фактически один реальный консьюмер (personal-relation), и тот голодает.
4. **Запасной regex-канал тоже пересох.** `CheckInConflictDetectorCron` (звено B) возник, когда конфликт-фразы лежали сырым текстом в `rawResponseText`. После перестройки дневного отчёта из графа (`DayReportCollectorService`, `day-report-collector.cron.ts:25` — `@Cron('0 5', Europe/Moscow)`) `rawResponseText` стал **синтезом из 4 вёдер** (plan/done/blocker/idea), а трение — вне этих вёдер (оно `team_friction`) → его текста в чек-ине больше нет → regex его не видит ([детали — conflict-detector-vs-graph-report.md](2026-06-29-conflict-detector-vs-graph-report.md)).

**Одной фразой:** конфликты надо деривить из графа по `signalType` — но сперва **научить нарезчик ставить эту метку** (без этого «на хабе» нечего ловить), затем усилить специалиста на одиночное упоминание, и только тогда снять regex-костыль.

## 3. Сопутствующие проблемы (с file:line)

1. **Дубль + рассинхрон уверенностей:** два пути к одному ребру, `confidence` 0.55 (`:213`) vs 0.65 (`:110`), перезапись по общему ключу.
2. **Хрупкий regex** (`:216-224`): только кириллица, «X с Y», именительный падеж, матч по 3-буквенному корню (`:404-406`) → ложные пары («спор с Заказчиком» = не человек; «Сер» → Сергей/Серёжа/Сергеева).
3. **`team_friction` vs `process_friction` не различаются** — оба → `conflicted_with` (`:109`, `:435`); `process_friction` часто «человек↔процесс», не «человек↔человек».
4. **Хардкод-крутилки** (нарушение принципа 9): `0.6` (`:18`), `0.65` (`:110`), `0.55` (`:213`), окно 24ч (`:212`), `200` (`:214`), `ROOT_LEN=3` (`:379`) — в коде, не в AdminSetting.
5. **Игнор полей чек-ина:** `notDoneJson`/`ideasJson` (`schema.prisma:7368,7370`) детектор B не читает (`assembleTextBlob :343`).
6. **Рассинхрон таймзон:** B — `@Cron 0 4` UTC; сборщик — `Europe/Moscow` (`day-report-collector.cron.ts:25`).
7. **Смешанные метрики:** B пишет в счётчик A (`incPersonalRelationBuilderRun` с `result:'checkin_*'`, `:276,313`).
8. **Не путать с `TemporalConflictService`** (`knowledge-core/services/temporal-conflict.service.ts`) — это противоречие фактов во времени (актуализация графа), НЕ межличностный конфликт. Вне scope.

## 4. Целевое решение (порядок для blueprint → ТЗ)

1. **Научить нарезчик трению (корневой фикс).** В промпт `block-ingest` — блок правил + few-shot для `team_friction`/`process_friction`: что считать трением, по каким формулировкам, как разметить **обоих** участников как `entity type=person`. Правка — через prompt registry с code-fallback (skill `z-ai-agent-rules`), + обновить snapshot-тест (`block-ingest.snapshot.spec.ts`). Без этого «на хабе» ловить нечего.
2. **Усилить детектор A на одиночное упоминание.** Сторону конфликта брать не только из «≥2 person в блоке», а из person-сущностей блока **+ автора/субъекта блока** (трение, где назван один человек: вторая сторона = автор реплики через `IdeaBlockEvidence.authorPersonId`/subject-Person).
3. **Снести regex-костыль B** (`CheckInConflictDetectorCron :210-476` + провайдер `operations.module.ts:137`). После п.1–2 чек-ины и чаты покрываются через хаб семантически (трение размечено нарезчиком независимо от канала). Отдельный суточный крон не нужен — специалист реактивный.
4. **Различать `team_friction` vs `process_friction`** — отдельным `relationType` либо `properties.frictionKind` (OQ-2).
5. **Крутилки в AdminSetting:** порог/минимум уверенности, окно decay — `getDynamic` + реестр (убрать хардкоды §3.4).

**Blast-radius:** малый — промпт нарезчика + один файл-воркер + чистка cron/провайдера. Читатели ребра (§1.5) не меняются.

## 5. Открытые вопросы для ТЗ (с рекомендацией)

- **OQ-1. Автор чек-ина/реплики как сторона.** Попадает ли автор в блок как `person`-сущность? Специалисту нужно ≥2 person. Чек-ин пишет один человек («у меня трение с Айназ») → нужно, чтобы ingest/нарезка клали в блок и автора, и упомянутого. → **Рекомендую** резолвить вторую сторону из `IdeaBlockEvidence.authorPersonId`; проверить путь `CheckinIngestService.ingestCheckin` (как формируются entities блока).
- **OQ-2. `team_friction` vs `process_friction`.** Один тип ребра или различать? `process_friction` бывает «человек↔процесс». → **Рекомендую** `conflicted_with` для team (человек↔человек), а process — `properties.frictionKind='process'` (или не строить person-ребро, если вторая сторона — процесс).
- **OQ-3. Порог/модель уверенности.** Единый порог для friction из встреч и чек-инов? → **Рекомендую** базу из `block.confidence`, порог — AdminSetting-крутилка.
- **OQ-4. Накопление vs перезапись.** Одно ребро на пару (upsert last-wins) или копить частоту/силу трения во времени? → **Рекомендую** копить (частота трений = сигнал руководителю).
- **OQ-5. Decay.** Участвует ли `conflicted_with` в ночной архивации слабых рёбер (`reframing.cron`, `confidence<0.5` старше 7 дней)? → подтвердить, что старые конфликты затухают.
- **OQ-6. Backfill.** Рёбра от B (`properties.source='checkin-conflict-detector'`) — оставить/передерайвить/удалить? → **Рекомендую** оставить (прод ~4 юзера), новые строить графом.
- **OQ-7. Симметрия.** `conflicted_with` симметрично (сортировка id `:129`, `:431-434`) — оставить, или нужна семантика «инициатор»? → **Рекомендую** оставить симметричным.

## 6. Источники (file:line, [verified] 2026-06-29)

- Детектор A: `backend/src/modules/operations/workers/personal-relation-builder.worker.ts:14,17,18,43-52,75,83-84,96,109-110,124-141,160-205`.
- Детектор B: тот же файл `:210,212-214,216-224,232,250-263,333-355,357-373,375-414(ROOT_LEN:379),424-475`.
- Роутер (хаб): `backend/src/modules/knowledge-core/services/router.service.ts:71,123,375-379`.
- Инсайты отбрасывают friction: `backend/src/modules/knowledge-core/workers/specialist-3-5-insights.worker.ts:62-63`.
- Нарезчик не учит трению: `backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts:44-45` (только словарь; в теле правил/примеров нет).
- Регистрация: `specialist-routing-dispatcher.worker.ts:19,68-69,99`; `operations/operations.module.ts:68,137`.
- Мост чек-ин→граф: `operations/workers/checkin-graph-ingest.listener.ts` → `CheckinIngestService.ingestCheckin`.
- Причина пересыхания B: `operations/workers/day-report-collector.cron.ts:25,36`.
- Схема: `prisma/schema.prisma:779` (enum `conflicted_with`), `:7368` (`notDoneJson`), `:7370` (`ideasJson`).
- Потребители ребра: `operations/services/personal-relation.service.ts`, `operations/services/operations-dashboard.service.ts:32`, `dashboard/services/team-health.service.ts:110`, `dashboard/agents/burnout-risk-detector.cron.ts:211` `[последние из параллельного исследования — подтвердить при ТЗ]`.
- Тайминг/регрессия (не дублируем): [[2026-06-29-conflict-detector-vs-graph-report]].
