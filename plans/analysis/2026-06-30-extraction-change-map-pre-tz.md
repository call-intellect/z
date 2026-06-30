# Извлекающий слой — карта изменений по коду (финальный анализ перед blueprint/ТЗ)

> Дата: 2026-06-30 · Тип: analysis (TZ-ready, нырок в живой код) · Статус: к одобрению владельцем перед blueprint
> Парные файлы: [FINAL-plain](2026-06-30-extraction-best-architecture-FINAL-plain.md) (доказанная рекомендация человеческим языком) · [FINAL-technical](2026-06-30-extraction-best-architecture-FINAL-technical.md) (доказательство + регрессии R1–R13)
> Приоритет владельца (жёстко): **точность/достоверность → надёжность → стоимость**. Инвариант: **не сломать и не ухудшить работающее.** Решение владельца: **строить всё сразу; старое выключаем когда новое на месте (build-then-delete); проверка — разовая (глазами+метрики), НЕ параллельное A/B (владелец не может сравнивать — ВР8); откат — рубильник.**

## 0. Что это за документ и как он проверен

FINAL-файлы отвечают на «что строим и **почему** это лучшая архитектура». Этот файл отвечает на «**что именно меняем в коде, где режем, чем рискуем, как проверим**» — из него ТЗ-автор пишет ТЗ почти механически, а blueprint берёт сценарии «было→стало».

Метод проверки: многоагентная разведка по 9 подсистемам (по агенту-«ныряльщику» на каждую) + 9 адверсариальных верификаторов, каждый **перечитывал процитированные `файл:строка` по живому коду** (18 агентов, 375 чтений, 1.5M токенов). Все ссылки ниже — после этой перепроверки. Где разведка **поправила** ранее зафиксированный факт — это помечено 🔧 и вынесено в §0.1.

### 0.1 Поправки к FINAL-доку (всплыли при нырянии — учитываем в ТЗ)

| 🔧 | В FINAL было | По живому коду | Последствие для работ |
|---|---|---|---|
| 1 | «ProcessTemplate (шаг→шаг) комбо не строит — потеря» (R6) | Строитель шагов **существует и работает**: [process-extraction.service.ts:181-308](../../backend/src/modules/processes/services/process-extraction.service.ts#L181-L308) строит `steps[]` (order/artifacts/sla). НО `handoffs` и `decisionPoints` **жёстко пусты** (`[]` на :212-213), `ownerRoleId` всегда `undefined` (:207) — авто-пайплайн их не строит. В combo-режиме `PROCESS_DETECTOR` подавлен роутером → даже `steps[]` не строятся для встреч | Работа меньше: не «построить процедурный слой с нуля», а (а) вернуть запуск step-строителя в combo-режиме; (б) отдельно решить, нужны ли авто-handoffs/decision-points |
| 2 | «derive-from-graph-by-signalType — добавить» | Примитив **уже написан**: `KnowledgeBlockResolver.getActive` ([block-fetch.service.ts:146-164](../../backend/src/modules/knowledge-core/services/block-fetch.service.ts#L146-L164)) ровно с нужной сигнатурой `{tenantId, at?, signalTypes?, take?}`, зарегистрирован/экспортирован в модуле, но **никто его не инжектит** (`Inject(KnowledgeBlockResolver)` = 0 совпадений) — мёртвый/неподключённый | Работа меньше: не «строить pull по типу», а **подключить** существующий примитив к потребителю + инвертировать switch роутера в таблицу `signalType↔specialist` |
| 3 | «42 из 57 типов без определения, объяснено 15» | Ровно **57** типов; прозой/словом-кодом объяснены **14**, без единого правила — **43** ([block-ingest.prompt.ts:328-452](../../backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts#L328-L452)) | Цифры в few-shot-реестре: 43 немых типа |
| 4 | (общее) | Рубильник `SPECIALISTS_COMBINED_ENABLED` объявлен через `z.coerce.boolean()` ([env.schema.ts:404](../../backend/src/common/config/env.schema.ts#L404)) → off-строки `'0'/'false'/'no'/'off'` коэрсятся в **true**: **флаг нельзя выключить через ENV**. Плюс он ENV-only (нет AdminSetting). ✅ В `.env`/`backend/.env` стоит `=false` — то есть комбо **фактически ВКЛ вопреки конфигу** | **Критично для отката build-then-delete**: текущий «kill-switch» фактически не выключается. Решение: в админку, дефолт ON, чинить в первую очередь (WP-I) |
| 5 | «комбо не строит profile rebuild» (R1) | Подтверждено точно: [specialists-combined.service.ts:793-903](../../backend/src/modules/knowledge-core/services/specialists-combined.service.ts#L793-L903) пишет `SkillTrait`/`PersonKnowledgeCategoryEmbedding`, но **не** зовёт `enqueueRebuild*` и **не** бампит `profileBuildVersion` (пишет в `resolved.version`, текущую — строки затрутся следующим rebuild). В DI нет `CoreQueueService` | R1 в силе, фикс уточнён (WP-B) |
| 6 | «entityGraphMinComentions = 3» | code-default = **2** ([typed-config.service.ts:676-680](../../backend/src/common/config/typed-config.service.ts#L676-L680), тест `.spec:271`) | Мелочь, поправить в описаниях |
| 7 | «маршрут block-ingest: 2 провайдера» | Фактический прод-маршрут — **3 тира**: primary `deepseek/deepseek-v4-pro`, secondary `openai-via-proxy/gpt-5.4`, tertiary `kie/gemini-3.1-pro` ([seed-llm-task-routes-default.ts:122-131](../../backend/scripts/seed-llm-task-routes-default.ts#L122-L131)). Прямого Opus-маршрута нет; провайдер `anthropic` зарегистрирован `maxDataClass='sensitive'` ([llm-router.service.ts:1003](../../backend/src/modules/ai/services/llm-router.service.ts#L1003)) — Opus проходит dataClass-фильтр | Постановка Opus — правка маршрута (seed + UI), не кода |

## 1. Карта подсистемы как она есть (одним взглядом)

Извлечение — это **два разных слоя в разных файлах**, которые часто путают:

1. **Сегменты** строит `SegmentBuilderService` ([segment-builder.service.ts](../../backend/src/modules/knowledge-core/services/segment-builder.service.ts)): группирует подряд идущие реплики одного спикера → режет группу на сегменты по `min(segmentMaxTokens=600, ceiling=2000)`. **Overlap (нахлёст) есть, но только внутри группы одного спикера** ([:325-356](../../backend/src/modules/knowledge-core/services/segment-builder.service.ts#L325-L356)).
2. **Окна** из сегментов нарезает `BlockExtractionService.extractFull` ([block-extraction.service.ts:407-447](../../backend/src/modules/knowledge-core/services/block-extraction.service.ts#L407-L447)): скользящее окно по `windowSize=5` сегментов, **шаг = размеру окна, БЕЗ overlap между окнами** (`slice(i, i+windowSize); i += windowSize`; комментарий «Без overlap (overlap появится позже…)» на [:340](../../backend/src/modules/knowledge-core/services/block-extraction.service.ts#L340)). Каждое окно — независимый stateless LLM-вызов `taskType:'block-ingest'`.

Дальше: блоки → дедуп/канонизация (`block-distill`) → граф (`IdeaBlockLink` через `block-linker`, `EntityLink` через `entity-graph-builder` ежечасно, `Theme` каждый час :15) → специалисты Слоя 3. При `specialistsCombined.enabled` (по умолчанию ON) **9 специалистов** объединены в один проход `SpecialistsCombinedService` (только для встреч), а роутер вырезает их из per-block dispatch ([router.service.ts:88-98,190-192](../../backend/src/modules/knowledge-core/services/router.service.ts#L88-L98)).

**Сырой текст** (`RawEvent.payload`/S3) читается **только на ingest** ([block-ingest.worker.ts:849-857](../../backend/src/modules/knowledge-core/workers/block-ingest.worker.ts#L849-L857)); в ретрив/ответ он **не попадает** — там только извлечённые `IdeaBlock` + дословные цитаты `IdeaBlockEvidence.quote`. Провенанс-инвариант: блок без непустой цитаты не пишется. **Это не трогаем** (см. WP-H, риск R-mem).

---

## 2. Карта изменений (work-packages)

Каждый пакет: **Сейчас → Станет → Трогаем файлы → Что вырезаем и КОГДА → Крутилки → Риск/откат → Приёмка.** Зависимости между пакетами — в §3.

Целевая архитектура — C4 из FINAL: тонкий спайн + когерентный комбо + few-shot реестр типов + сшивка нити (3 слоя) + хроносверка + процедурный слой + подключение derive-by-signalType. Половина «базы» уже в проде (комбо ON с 2026-06-20).

---

### WP-A · Комбо канало-агностичен (работает на чатах, не только встречах) 🔴 R2

**Сейчас.** Комбо — meeting-only, двойная привязка к `sourceType='meeting'`: producer `resolveMeetingIdForBlock` фильтрует rawEvent по `sourceType:'meeting'` ([block-distill.worker.ts:242-256](../../backend/src/modules/knowledge-core/workers/block-distill.worker.ts#L242-L256)); сборщик блоков `getCanonicalBlocksForMeeting` — тот же фильтр ([block-fetch.service.ts:31-39](../../backend/src/modules/knowledge-core/services/block-fetch.service.ts#L31-L39)). Чат/Telegram/chatbox/daily_checkin до комбо **не доходят вообще** (enum `SourceType` — [schema.prisma:244-275](../../backend/prisma/schema.prisma)). А главный канал владельца — короткий чат.

**Станет.** Комбо принимает source-дескриптор `{sourceType, externalId}`, а не голый `meetingId`; собирает блоки любого источника; ставит job с ключом источника. Промпт получает `channelKind` (встреча/чат/документ).

**Трогаем файлы.**
- modify [block-distill.worker.ts:197-256](../../backend/src/modules/knowledge-core/workers/block-distill.worker.ts#L197-L256) — резолвинг источника без хардкода `meeting`; либо ветка `enqueueSpecialistsCombinedForChat`.
- modify [block-fetch.service.ts:31-72](../../backend/src/modules/knowledge-core/services/block-fetch.service.ts#L31-L72) — `getCanonicalBlocksForSource(sourceType, externalId)` (или парный метод для chat/conversational).
- modify [specialists-combined.worker.ts:80-161](../../backend/src/modules/knowledge-core/workers/specialists-combined.worker.ts#L80-L161) — принимать source-дескриптор; читать meeting ИЛИ чат-сессию; прокидывать `dataClass`. Расширить `SpecialistsCombinedJobData` полем `sourceType`.
- modify промпт [specialists-combined.prompt.ts](../../backend/src/modules/knowledge-core/prompts/specialists-combined.prompt.ts) — добавить `channelKind`-подсказку (промпт писан под транскрипт встречи: `evidence.speaker` и т.п.).

**Что вырезаем и когда.** Ничего не удаляем здесь. Per-block специалисты остаются живы как откат.

**Крутилки.** Ключ группировки чата (sessionId/conversationId/окно времени) и отдельный `delayMs` для чатов — в AdminSetting (чат идёт потоком, не пачкой как встреча).

**Риск/откат.** Чат короче/шумнее → ложные decisions/regulations/skill_traits. Опора: KNN-merge в `block-distill` уже сводит чат+встречу в один canonical-блок ДО комбо; `gateStrict` фильтрует не-нормы ([:678-691](../../backend/src/modules/knowledge-core/services/specialists-combined.service.ts#L678-L691)). Откат — рубильник комбо (после WP-I он реально выключается).

**Приёмка.** На реальном telegram/чат-корпусе: число и качество извлечённых сущностей на чат-RawEvent; отсутствие дублей чат×встреча; `dataClass` чат-источников проставлен верно (не дефолтный `internal` для chatbox).

---

### WP-B · Комбо восстанавливает 4 побочки (профиль клона · ProcessTemplate · гигиена решений) 🔴 R1 / 🟠 R6

**Сейчас.** При ON роутер вырезает 9 `COMBINED_COVERED`-специалистов, и вместе с ними — их side-effects, которых комбо **не воспроизводит**:
- **Профиль клона не пересобирается** 🔴: комбо пишет `SkillTrait` (:846-903) и `PersonKnowledgeCategoryEmbedding` (:828-836, с `profileBuildVersion=resolved.version` — текущей!), но не зовёт `enqueueRebuildKnowledgeProfile`/`enqueueRebuildSkillProfile` и не бампит версию; в DI нет `CoreQueueService`. Эти строки read-path не показывает — он читает версионированный JSON, который пересобирает только `rebuildForPerson`. До 6-часового cron ([knowledge-clone-rebuild.cron.ts:21](../../backend/src/modules/knowledge-core/workers/knowledge-clone-rebuild.cron.ts#L21)) клон отвечает **старым профилем**, а если cron не зацепил (нет свежего mention) — дольше. Раздельные воркеры дёргали rebuild: [3-2:109](../../backend/src/modules/knowledge-core/workers/specialist-3-2-knowledge-clone.worker.ts#L109), [3-7:126](../../backend/src/modules/knowledge-core/workers/specialist-3-7-skill.worker.ts#L126).
- **ProcessTemplate не строится** 🟠: `PROCESS_DETECTOR` в `COMBINED_COVERED` → step-строитель ([process-detector.worker.ts](../../backend/src/modules/knowledge-core/workers/process-detector.worker.ts), `RELEVANT_SIGNALS={process_step,methodology_step}`) подавлен; комбо кладёт `process_step` только плоской текстовой `Regulation` ([:668-731](../../backend/src/modules/knowledge-core/services/specialists-combined.service.ts#L668-L731)), без `steps[]`.
- **Гигиена решений не гоняется** 🟠: `persistDecisions` ([:264-369](../../backend/src/modules/knowledge-core/services/specialists-combined.service.ts#L264-L369)) не зовёт `enqueueDecisionHygiene`; раздельный 3-3 дёргал её per-decision ([specialist-3-3-decisions.worker.ts:108-126](../../backend/src/modules/knowledge-core/workers/specialist-3-3-decisions.worker.ts#L108-L126)).

**Станет.** Комбо после persist собирает затронутые `personId` и сам ставит `enqueueRebuildKnowledgeProfile`/`enqueueRebuildSkillProfile` (один раз на person через `Set`); запускает `DecisionHygiene` per-decision; ProcessTemplate — по развилке ниже.

**Трогаем файлы.**
- modify [specialists-combined.service.ts:155-189,793-903](../../backend/src/modules/knowledge-core/services/specialists-combined.service.ts#L793-L903) — инжект `CoreQueueService`; enqueue rebuild по `Set<personId>`. Образец — раздельные 3-2:109/3-7:126.
- modify [specialists-combined.service.ts:264-369](../../backend/src/modules/knowledge-core/services/specialists-combined.service.ts#L264-L369) — после upsert Decision (только `reversibility=null`) `DashboardQueueService.enqueueDecisionHygiene` ([dashboard-queue.service.ts:71](../../backend/src/modules/dashboard/services/dashboard-queue.service.ts#L71)); инжект `@Optional()` (прецедент — 3-3 уже зависит от dashboardQueue).
- **ProcessTemplate → Вариант A (решение владельца):** убрать `PROCESS_DETECTOR` из `COMBINED_COVERED` ([router.service.ts:95](../../backend/src/modules/knowledge-core/services/router.service.ts#L95)) — step-детектор продолжает батчить параллельно. Дёшево, не трогает горячий путь комбо, сохраняет батч-семантику. Авто-`handoffs`/`decisionPoints` не строим (осознанно ручной слой).
- modify [specialists-combined.service.ts:793-844](../../backend/src/modules/knowledge-core/services/specialists-combined.service.ts#L793-L844) — либо не писать `PersonKnowledgeCategoryEmbedding` напрямую (положиться на `rebuildForPerson`, который переизвлекает из блоков), либо писать с `version=current+1` синхронно с rebuild. Сейчас это мёртвый груз.

**Что вырезаем и когда.** Ничего. Это условие, ПОСЛЕ которого станет безопасно сносить раздельные 3-2/3-7/3-3.

**Крутилки.** Нет новых (используем существующий debounce `enqueueRebuild*`).

**Риск/откат.** Всплеск rebuild-jobs при многих встречах одного сотрудника → дедуп по `personId`+reason, тот же `delayMs`. Инвариант на будущее (зафиксировать в docs + тест `specialists-combined.service.spec.ts`): **специалист попадает в `COMBINED_COVERED` только если он чисто извлекающий** (persist без enqueue/emit/rebuild); любой деривер с side-effect — либо вне комбо, либо комбо обязан воспроизвести эффект.

**Приёмка.** После combo-extract у Person инкрементнулся `profileBuildVersion` и обновился `lastProfileBuildAt`; `DecisionHygiene.reversibility` заполняется для решений со встреч; ProcessTemplate `steps[]` пополняется при ON.

---

### WP-C · Few-shot реестр типов: объяснить 43 немых типа (без смены БД) 🟠 R10/R11

**Сейчас.** 57 значений `SIGNAL_TYPE_VALUES` ([block-ingest.prompt.ts:10-68](../../backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts#L10-L68)) идут в strict JSON-схему (`signalType enum` на :160). Прозой объяснены **14** (fact, feature_request, churn_risk, idea, commitment, decision, process_step, plan_item, action_item, done_item, suggestion, question, task_created, task_completed). Остальные **43** (pain, objection, risk, mood, drift, team_friction, process_friction, blocker, …, help_*, mentoring, …) — только в enum, без правила/примера → модель ставит их «на угад». Единственный программный few-shot — `renderRuleForBlockIngest()` ([task-decision-examples.ts:79-89](../../backend/src/modules/knowledge-core/prompts/task-decision-examples.ts#L79-L89)), покрывает 3 типа (idea/decision/action_item).

**Станет.** Новый генератор `renderSignalTypeRegistry()`: для каждого типа — короткое определение (5-7 слов) + 1-2 примера реплика→разбор + анти-паттерн (с чем путают). Гарантия синхронности: новый тип в `SIGNAL_TYPE_VALUES` без строки реестра ловится тестом. **Enum БД НЕ трогаем** — расширяемость лечится текстом.

**Трогаем файлы.**
- add `backend/src/modules/knowledge-core/prompts/signal-type-registry.ts` — единый массив определений + `renderSignalTypeRegistry()`; для тройки idea/decision/action_item **переиспользует** `TASK_VS_DECISION_PAIRS`, не дублируя.
- modify [block-ingest.prompt.ts:433-434](../../backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts#L433-L434) — заменить/дополнить вставку `renderRuleForBlockIngest()` вызовом `renderSignalTypeRegistry()` (точка вставки уже есть; реестр — в `system`, т.к. инвариантен между окнами и кэшируется).
- keep [task-decision-examples.ts:8-89](../../backend/src/modules/knowledge-core/prompts/task-decision-examples.ts#L8-L89) — рендереры `renderExamplesFor*` (:45-77) зовут другие специалисты, не удалять.

**Что вырезаем и когда.** Перенести (не выкинуть!) 7 правил различий классов (:345-352) и 9 worked-примеров (:382-431) в реестр как примеры соответствующих типов — осознанно, иначе теряются тонкие правила (граница идея↔решение, многосторонние обязательства, бытовое не-действие).

**Крутилки.** Нет. (Опц. — формат реестра «полный 57 vs только спорные кластеры + краткие определения для редких».)

**Риск/откат.** (а) Раздувание промпта 57-ю определениями → держать компактно; реестр в `system` кэшируется prompt caching между окнами. (б) Few-shot **сдвинет распределение типов** на истории (тип, что «угадывался» fact, станет objection/friction) → снять **baseline частот signalType ДО** и diff ПОСЛЕ, следить за роутингом. (в) Падут снапшоты — обновить осознанно (`block-ingest.snapshot.spec.ts`, `card-rollup-v2.snapshot.spec.ts`).

**Приёмка.** Все 57 типов имеют определение (тест-страж enum↔реестр); распределение типов не «съехало» катастрофически (сравнение baseline); снапшоты обновлены и зелёные.

---

### WP-D · Слой 0 нити: нахлёст между окнами (#1) + позиция окна (#2) + дозабор (#6)

**Сейчас.** Окна режутся встык без overlap (см. §1); `windowIndex=Math.floor(i/windowSize)` ([block-extraction.service.ts:416](../../backend/src/modules/knowledge-core/services/block-extraction.service.ts#L416)) **вычисляется, передаётся в `processWindow`, но в промпт не доходит** — только в логи; `totalWindows` нигде не считается; `BuildArgs` ([block-ingest.prompt.ts:454-460](../../backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts#L454-L460)) не содержит позиции окна. Gleaning **отсутствует** — `for(attempt<2)` ([:482-517](../../backend/src/modules/knowledge-core/services/block-extraction.service.ts#L482-L517)) это retry на невалидный JSON, не дозабор.

**Станет.**
- **#1 нахлёст между окнами:** шаг цикла `i += max(1, windowSize - windowOverlap)` (slice прежний `i, i+windowSize`) — хвост окна N попадает в голову N+1. ⚠️ `windowIndex` сделать **монотонным счётчиком** (`let windowIdx=0; windowIdx++`), НЕ `Math.floor(i/windowSize)` — формула ломается при overlap-шаге.
- **#2 позиция «ты здесь»:** `BuildArgs += {windowIndex?, totalWindows?}`; в header строка «фрагмент N из M подряд идущих кусков одного разговора» (только при `totalWindows>1`); пометка overlap-хвоста «контекст, не извлекать заново».
- **#6 дозабор:** опц. gleaning-проход в `processWindow` — после первого извлечения доп. вызов «найди ТОЛЬКО пропущенное, не повторяй [список name/signalType]», merge с дедупом по `(signalType+evidenceQuote/name)`. Число раундов — крутилка, code-fallback 0–1.

**Трогаем файлы.**
- modify [block-extraction.service.ts:407-447](../../backend/src/modules/knowledge-core/services/block-extraction.service.ts#L407-L447) — overlap-шаг + монотонный `windowIdx` + `totalWindows`.
- modify [block-extraction.service.ts:467-473](../../backend/src/modules/knowledge-core/services/block-extraction.service.ts#L467-L473) — пробросить `windowIndex`+`totalWindows` в `buildBlockIngestPrompt`.
- modify [block-ingest.prompt.ts:454-496](../../backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts#L454-L496) — `BuildArgs` + строка позиции в header (опц. поля с дефолтом `0/1`, чтобы не ломать тесты).
- add gleaning-цикл [block-extraction.service.ts:482-523](../../backend/src/modules/knowledge-core/services/block-extraction.service.ts#L482-L523) + дедуп-merge.

**Что вырезаем.** Ничего. **НЕ трогаем** внутригрупповой overlap сегментов ([segment-builder.service.ts:301-356](../../backend/src/modules/knowledge-core/services/segment-builder.service.ts#L301-L356)) — это другой рабочий слой.

**Крутилки (AdminSetting, §9).** `knowledge.blockIngestWindowOverlapSegments` (NON_NEGATIVE_INT, валидатор `< windowSize`); `knowledge.blockIngestGleaningRounds` (int, code-fallback 0/1) + порог min-длины сегмента (короткие чат-реплики → лёгкий путь без gleaning, R13).

**Риск/откат.** (а) Overlap **плодит дубли** (один сегмент в хвосте N и голове N+1) → дедуп после `extractFull` по `(evidenceQuote/startMs+signalType)` ИЛИ пометка overlap-хвоста «не извлекать»; проверить идемпотентность persist в `block-ingest.worker.ts`. (б) `overlap >= windowSize` → нулевой/беск. шаг → кламп `max(1, windowSize-overlap)` + валидатор. (в) Рост числа окон/вызовов → дефолт overlap=1 (~+25% при window=5), крутилка позволяет 0. (г) gleaning на коротких репликах = пустые повторы → порог min-длины.

**Приёмка.** needle-in-the-middle на реальных транскриптах (позиции 1/5/10/15/20): факт на стыке окон ловится; число дублей блоков не выросло; gleaning даёт прирост сигналов, оправдывающий стоимость.

---

### WP-E · Слой 1 (главный рычаг): скелет встречи → шапка-карта (#3+#4)

**Сейчас.** Каждое окно видит **только** свои 5 сегментов + статичную мету эпизода (заголовок/тип/дата/участники, одинаковую для всех окон) ([block-ingest.prompt.ts:483-494](../../backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts#L483-L494)). Окно №7 не знает, что было в окне №2, кто «он», какой «проект». `ChunkContextService` ([chunk-context.service.ts:46-65,90-120](../../backend/src/modules/knowledge-core/services/chunk-context.service.ts#L46-L120)) строит контекст-фразу, но она идёт **только в эмбеддинги после извлечения** ([block-ingest.worker.ts:282-303](../../backend/src/modules/knowledge-core/workers/block-ingest.worker.ts#L282-L303)) — не в окно экстрактора. **Первого прохода-скелета в pipeline нет вообще** (поиск `skeleton/outline/first-pass` — пусто).

**Станет.** Один дешёвый LLM-проход по всему RawEvent ДО окон → компактное оглавление (тема; 5-12 вех с примерными index-диапазонами; ключевые имена/компании/проекты). Релевантный срез + позиция окна вкладываются в **шапку каждого окна** («о чём разговор и что обсудили до этого куска»). Это разрешает кореференции и не даёт дублировать разобранное в других окнах. (Anthropic Contextual Retrieval: −до 49% провалов извлечения.)

**Трогаем файлы.**
- add `backend/src/modules/knowledge-core/services/meeting-skeleton.service.ts` — `buildSkeleton({segments,...})`, один вызов `taskType:'meeting-skeleton'`, сжатый вход (index + ~80 символов text), `maxTokens ~800`, json_schema strict, **fail-open** (при падении `null` → окна работают как сейчас). Инжект как `LlmRouterService`.
- modify [block-extraction.service.ts:387-473](../../backend/src/modules/knowledge-core/services/block-extraction.service.ts#L387-L473) — ПЕРЕД циклом окон (до :407) один вызов `buildSkeleton`, результат in-memory на время `extractFull`; пробросить в `processWindow`→`buildBlockIngestPrompt`. Инжект `MeetingSkeletonService` (паттерн конструктора :360-363).
- modify [block-ingest.prompt.ts:454-496](../../backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts#L454-L496) — `BuildArgs += {skeleton?, segmentIndexRange?}`; секция «Карта встречи» после «Контекст эпизода»; скелет как **user-data** (`wrapUserData`, источник истины — сегменты ниже).
- add маршрут `'meeting-skeleton'` в [llm-router.service.ts](../../backend/src/modules/ai/services/llm-router.service.ts) (union `LlmTaskType` + `ALL_LLM_TASK_TYPES` + seed маршрута) — **обязательно до выката**, иначе вызов упадёт. Модель — дешёвая/быстрая (задача суммаризационная).

**Что вырезаем.** Ничего.

**Крутилки.** `knowledge.skeleton_enabled` (kill-switch, default ON); порог min-числа сегментов (на встрече ≤ windowSize — одно окно, скелет не нужен); `knowledge.header_map_enabled`; опц. `maxTokens` скелета.

**Риск/откат.** (а) +1 LLM-вызов на RawEvent (на короткой встрече +100% вызовов) → дешёвая модель + порог отсечения коротких + kill-switch. (б) Раздувание промпта окна оглавлением → держать 5-12 вех, на фоне сегментов (тысячи токенов) дёшево. (в) Галлюцинация/инъекция из речи в каждое окно → `wrapUserData`, явная пометка «справочный контекст», fail-open. (г) Новый `taskType` без маршрута падает на проде → регистрация маршрута в том же выкате.

**Приёмка.** На длинной встрече кореференции («он»/«этот клиент») разрешаются; падение «обрывается на полуслове» (ложные `transcriptTruncated`); разовая проверка полноты/точности с включённым скелетом (без параллельного A/B — ВР8).

---

### WP-F · Слой 2: хроносверка разворота (решения И факты) — поставщик вердикта, не писатель 🔴 R7

**Сейчас (инвариант «один писатель на ось» — подтверждён перекрёстно).**
- Ось **факта** `IdeaBlock.validUntil`: единственный авто-писатель `FactSupersedeService.applySupersedes` ([fact-supersede.service.ts:404-449](../../backend/src/modules/knowledge-core/services/fact-supersede.service.ts#L404-L449)) — `updateMany WHERE validUntil IS NULL` (идемпотентно, проигравший в гонке `count=0`), Redis-лок + скептик; вход только из `block-distill.worker:229` под флагами bitemporal.
- Ось **решения** `Decision`: авто-писатель `Specialist33Service` ([specialist-3-3-decisions.service.ts:368-393](../../backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts#L368-L393), `status='superseded'+validUntil`, всё в одной `$transaction`) **плюс** ручной owner-писатель `decisions.service.ts:261-298` (`detectedBy:'manual'`, та же семантика, ручной триггер — не пересекается во времени).
- Ось **рёбер** `*Link.validUntil`: единственный — `TemporalConflictService` ([temporal-conflict.service.ts:50-200](../../backend/src/modules/knowledge-core/services/temporal-conflict.service.ts#L50-L200)), закрывает по **семантике** пар (develops↔contradicts, works_at↔opposes, mentors↔conflicted_with), не по времени.
- Якорь хронологии — `IdeaBlockEvidence.sourceTimestamp` (= `event.occurredAt`, [block-ingest.worker.ts:1362-1376](../../backend/src/modules/knowledge-core/workers/block-ingest.worker.ts#L1362-L1376), **nullable**). Канал доставки вердикта конфликта — `ConflictService.report` ([conflict.service.ts:81-174](../../backend/src/modules/curation/services/conflict.service.ts#L81-L174), идемпотентен по `(tenant,resourceType,existingId,newId)`).

**Станет.** Хроносверка по порядку `sourceTimestamp` (для решений первичен `decidedAt`) ловит «вначале X — в конце Y, Y побеждает» — для **обеих осей** (решение владельца). Она **НЕ пишет** `validUntil`/`status` сама, а:
- влияет на **вердикт** существующего писателя: для фактов — доп. сигнал хронологии в `FactSupersedeService.callLlm` (или пред-фильтр KNN-кандидатов); для решений — в `SupersedeVerdict` внутри `supersedeDetect` ([:740-931](../../backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts#L740-L931));
- и/или отдаёт вердикт в `ConflictService.report` (как уже делают `fact-supersede.reportEvolvingConflict` и `specialist-3-3.reportEvolvingConflict`). ⚠️ `suggestedResolution`/`evolvingMeta` кладутся **внутрь поля `evidence`** report-а, не как его параметры (🔧 уточнение к R7).

**Трогаем файлы.** modify (как ВХОД, не писатель): [fact-supersede.service.ts](../../backend/src/modules/knowledge-core/services/fact-supersede.service.ts) (сигнал хронологии в `callLlm`/пред-фильтр), [specialist-3-3-decisions.service.ts:740-931](../../backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts#L740-L931) (порядок в арбитр). keep всех трёх писателей и `ConflictService.report`.

**Что вырезаем.** Ничего.

**Крутилки.** Порог/окно хроносверки — AdminSetting.

**Риск/откат.** 🔴 Любой второй писатель `validUntil` = гонка `updateMany(validUntil:null)`: победитель ставит свой `supersededById`, проигравший молча `count=0` теряет вердикт → **строго: только вердикт-провайдер**. `sourceTimestamp=null` → брать ранний evidence (`orderBy asc`, как `fact-supersede include take:1`) с fallback на `createdAt`; для решений `decidedAt` первичен. Рёбра графа закрываются по семантике — добавление времени меняет контракт `onNew*Link`, делать только при явной необходимости (открытый вопрос, см. §4).

**Приёмка.** Сценарий «договорились X → в конце передумали на Y»: активна Y, X помечена superseded ровно одним писателем; `decision_supersede_chain_length`/`kc_fact_supersede_verdict` без аномалий; нет дублей `ConflictItem`.

---

### WP-G · Научить нарезчик метить трения → усилить граф-детектор → снести regex (жёсткий порядок-гейт) 🟠 R5

**Сейчас.** Два детектора конфликтов в одном файле ([personal-relation-builder.worker.ts](../../backend/src/modules/operations/workers/personal-relation-builder.worker.ts)):
- **Граф-детектор** `PersonalRelationBuilderWorker` (:43-206) — на canonical-блоке с `signalType ∈ {team_friction, process_friction}` (:96-107) строит попарно `conflicted_with` (confidence 0.65). **Полностью зависит от того, что модель проставит friction.**
- **Regex-детектор в обход графа** `CheckInConflictDetectorCron` (:209-476, `@Cron('0 4 * * *')`) — сканирует **сырой текст** `DailyCheckIn` 7 паттернами («конфликт с X», «спор с X», …), матч по 3 символам имени (confidence 0.55, `properties.source='checkin-conflict-detector'`). Единственный путь конфликтов из чек-инов в граф.

Оба пишут в один `EntityLinkType.conflicted_with` (дедуп на уровне ребра). **Пробел:** в `block-ingest` промпте **friction не обучен** — ни правила, ни примера (только enum :44-45; одна строка-инструкция есть в downstream `specialists-combined.prompt.ts:515`, но это не место рождения signalType и не few-shot).

**Станет → порядок жёсткий:**
1. **Научить** (часть WP-C, но критично здесь): few-shot для `team_friction` (межличностное, конкретная пара) и `process_friction` (handoff между функциями), контраст между собой и с pain/objection/blocker. Узкое определение, чтобы friction-блок на 5 человек не порождал полный клик ложных рёбер.
2. **Усилить** граф-детектор (вторая сторона = `IdeaBlockEvidence.authorPersonId`; при необходимости ограничить клик только явно названными сторонами).
3. **Снести** regex **сразу после обучения** (шаги 1-2), без A/B (владелец не может сравнивать — ВР8). Метрика `incPersonalRelationBuilderRun(link_created)` остаётся для наблюдения в проде, что граф рождает `conflicted_with`. Порядок-гейт (friction обучен → граф-детектор работает → снос) — это корректность, не тест.

**Трогаем файлы.**
- add few-shot friction [block-ingest.prompt.ts:382-419 + 421-434](../../backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts#L382-L434) (через реестр WP-C).
- keep [personal-relation-builder.worker.ts:209-476](../../backend/src/modules/operations/workers/personal-relation-builder.worker.ts#L209-L476) — regex-крон **до обучения friction** (шаги 1-2); затем снос.
- cut (ШАГ 3, после обучения) `CheckInConflictDetectorCron` целиком + `@Cron` + регистрация в operations-модуле/тестах.

**Что вырезаем и когда.** Regex-крон — **только** после обучения friction (шаги 1-2). Иначе обнуляется детекция конфликтов из чек-инов. Без A/B — гарантия в порядке: сначала научили модель, потом снесли костыль.

**Крутилки.** Вынести магические `MIN_CONFIDENCE=0.6` (:18), граф `0.65` (:110), regex `0.55` (:213) в AdminSetting `getDynamic` (сейчас §9-нарушение).

**Риск/откат.** Снос regex до обучения = провал дашбордов конфликтов (`PersonalRelationBuilder` голодает, burnout/operations/team-health). Многолюдный friction-блок → клик ложных рёбер. `process_friction` влияет ещё и на `CrossFunctionalFrictionReport` ([schema.prisma:5995-6022](../../backend/prisma/schema.prisma)) — проверить, что рост process_friction-блоков его не зашумит.

**Приёмка.** После обучения friction граф рождает `conflicted_with` из чек-инов (метрика `link_created`); precision на многолюдных блоках приемлем; конфликты по-прежнему создаются и **попадают в списки/дашборды** (PersonalRelation, burnout, team-health, CrossFunctionalFrictionReport).

---

### WP-H · derive-from-graph-by-signalType: подключить существующий примитив 🔧 ⏸️ ОТЛОЖЕНО (решение владельца)

> **В первую итерацию не входит.** Кросс-карточный анализ по типу — отдельная аналитическая способность, не про точность извлечения. Записано в [реестр «не-сделано»](../../second-brain/04_не-сделано/README.md): примитив `KnowledgeBlockResolver.getActive` написан, но не подключён. Фильтр chat-v2 по типу уже работает — для текущих ответов достаточно. Раздел ниже сохранён как контекст для будущего захода.


**Сейчас.** Деривация по типу есть только на **записи** (push): `RouterService.matchSpecialists` ([router.service.ts:253-501](../../backend/src/modules/knowledge-core/services/router.service.ts#L253-L501)) — статический `switch(signalType)`→набор специалистов; специалисты работают **по одному блоку** (`processBlock`), не pull-запросом «дай все блоки типа X». **Pull-примитив `KnowledgeBlockResolver.getActive` уже написан** ([block-fetch.service.ts:146-164](../../backend/src/modules/knowledge-core/services/block-fetch.service.ts#L146-L164), сигнатура `{tenantId, at?, signalTypes?, take?}`, bi-temporal окно), зарегистрирован в модуле — **но никто его не инжектит** (мёртвый). На чтении фильтр по `signalType` тоже уже есть и recall-safe: `buildStructuralPredicates`+`rankByStructuralFilter` ([chat-v2-retrieval.service.ts:100-318](../../backend/src/modules/knowledge-core/services/chat-v2-retrieval.service.ts#L100-L318), полный скан фильтрованного пула с cosine-score, не HNSW LIMIT).

**Станет.** Подключить `KnowledgeBlockResolver.getActive` к потребителю деривации по типу (специалист/чат); инвертировать `switch` роутера в переиспользуемую таблицу `signalType↔specialist`, чтобы pull и push не разъезжались по списку типов.

**Трогаем файлы.** modify [router.service.ts:52-133](../../backend/src/modules/knowledge-core/services/router.service.ts#L52-L133) (обратная таблица как единый источник истины); wire `KnowledgeBlockResolver` в нужный сервис; keep `chat-v2-retrieval` (читающий фильтр — эталон).

**Что вырезаем.** Ничего.

**Риск/откат.** Pull-агрегация по типу пройдёт по уже обработанным блокам → дубли. Обязательно через те же дедуп-гарды (`sourceBlockIds:{has}`, `sourceIdeaBlockId` unique, метрика `incCoreSpecialistSkipped('source_block_dedup')`). Жёсткий pre-filter по signalType на HNSW роняет recall → только паттерн `rankByStructuralFilter` (полный скан фильтрованного пула).

**Приёмка.** Кросс-блочный вывод по типу не плодит дубли сущностей; recall на узком фильтре не просел. ⚠️ Сначала **уточнить у владельца цель** (§4, вопрос 2): pull-обход для специалистов, усиление push, или фильтр для chat-v2? От этого зависит, нужен ли WP-H в первой итерации вообще.

---

### WP-I · Конфиг-гигиена и движок: рубильник, крутилки нарезки, Opus 🔴 (блокер отката)

**Сейчас.**
- 🔴 `SPECIALISTS_COMBINED_ENABLED` через `z.coerce.boolean()` ([env.schema.ts:404](../../backend/src/common/config/env.schema.ts#L404)) → off-строки `'0'/'false'/'no'/'off'` → **true**: **рубильник не выключается через ENV**; и он ENV-only (нет AdminSetting). А именно на нём держится откат build-then-delete.
- `blockIngestWindowSegments`/`blockIngestMaxTokensPerSegment` читаются `this.get(ENV)` без `resolveSync` ([typed-config.service.ts:652-653](../../backend/src/common/config/typed-config.service.ts#L652-L653)) — admin-строки сидятся ([seed-admin-settings.ts:424-435](../../backend/scripts/seed-admin-settings.ts#L424-L435)), но reader их игнорирует → редактирование в админке **не влияет на рантайм**. Плюс расхождение дефолта max-tokens: сид `1500` vs env.schema `2000`.
- Движок экстрактора — из БД `LlmTaskRoute` (3 тира, см. §0.1 п.7), прямого Opus-маршрута нет.
- Эталон правильной крутилки-рубильника: `contextual_header_enabled` через `getDynamic('…', undefined, true)` ([chunk-context.service.ts:94-99](../../backend/src/modules/knowledge-core/services/chunk-context.service.ts#L94-L99)).

**Станет.**
- `SPECIALISTS_COMBINED_ENABLED` (решение владельца): починить парсер `z.coerce.boolean()` → `zBool(true)`; **перенести из ENV в AdminSetting** как настоящий kill-switch (`resolveSync<boolean>` + сид + registry, по образцу `contextual_header_enabled`); **дефолт = ON** (комбо включено, Ship-On). ✅ Подтверждено: `.env`/`backend/.env` = `false`, но баг даёт ВКЛ — это легаси, перебиваем на ON. ⚠️ Программисту: подтвердить прод-значение и что выключение было легаси, а не реакцией на инцидент с комбо (если инцидент — сначала разобрать причину).
- `blockIngest*` → `resolveSync('knowledge.blockIngest…','BLOCK_INGEST_…', <дефолт>)` (admin→ENV→code-fallback), выровнять дефолт max-tokens (1500 vs 2000 — подтвердить целевое).
- Opus на `block-ingest`: добавить `LlmTaskRoute` `anthropic/claude-opus-*` как primary/tier (seed + UI), старый маршрут **не удалять** (откат = вернуть deepseek). `anthropic.maxDataClass='sensitive'` проходит фильтр.
- Новые крутилки плана (registry + seed + UI): `knowledge.skeleton_enabled`, `knowledge.header_map_enabled`, `knowledge.blockIngestGleaningRounds`, `knowledge.blockIngestWindowOverlapSegments`.

**Трогаем файлы.** modify [env.schema.ts:404](../../backend/src/common/config/env.schema.ts#L404), [typed-config.service.ts:652-653,1012-1017](../../backend/src/common/config/typed-config.service.ts#L652-L653); add строки в [admin-setting-schema-registry.ts:44-50](../../backend/src/modules/admin/settings/admin-setting-schema-registry.ts#L44-L50), [seed-admin-settings.ts](../../backend/scripts/seed-admin-settings.ts) / [seed-admin-setting-knowledge-graph.ts](../../backend/scripts/seed-admin-setting-knowledge-graph.ts); modify маршрут [seed-llm-task-routes-knowledge-core.ts:34-41](../../backend/scripts/seed-llm-task-routes-knowledge-core.ts#L34-L41) + дубль [seed-llm-task-routes-default.ts:122-131](../../backend/scripts/seed-llm-task-routes-default.ts#L122-L131). Все новые seed/registry-строки — в `apply-prod-deploy STEPS` (Шаг 1/7).

**Что вырезаем.** Старый Opus-альтернативный маршрут не вырезаем до проверки стоимости.

**Риск/откат.** Перевод `blockIngest*` на `resolveSync` без `envFallbackKey` сменит поведение в проде, где стоял кастомный ENV → обязательно передать `envFallbackKey` + code-default = текущему. Opus дорог/медленнее на КАЖДОЕ окно → ставить как tier с замером cost (`calcCostUsd`), держать fallback, откат = вернуть маршрут.

**Приёмка.** Рубильник реально выключается (тест на off-строку); правка крутилок нарезки в админке меняет рантайм; Opus-маршрут активен, fallback жив, cost в бюджете.

---

### WP-J · me-tasks — гибрид (решение владельца) 🟠 R8

**Сейчас.** Три контура создания задач с разным дедупом: meeting-extract (vector 0.85+sha1), telegram-parser, и `me-tasks.service.ts:100,157` — `Issue.create` **напрямую, без дедупа**.

**Станет.** Прямое создание остаётся (быстро), но через единый дедуп-guard по `sourceBlockId`/контенту + provenance-ссылка в граф (решение владельца — гибрид).

**Трогаем файлы.** modify `me-tasks.service.ts` (обернуть в общий guard). keep прямой путь.

**Риск/откат.** Дубли задач при унификации → единый guard ДО сноса любого контура.

**Приёмка.** Нет дублей Issue из одного источника; provenance в граф проставлен.

---

## 3. Порядок и зависимости (strangler-fig, build-then-delete)

Владелец: «строю всё сразу». Это значит — **параллельно строим все WP**, но физический снос старого подчиняется причинным гейтам:

```
СТРОИМ СРАЗУ:  WP-I (рубильник!) · WP-A (чат) · WP-B (4 побочки) · WP-C (реестр) ·
               WP-D (слой 0) · WP-E (скелет) · WP-F (хроносверка) · WP-G шаги 1-2 (учим friction) ·
               WP-tasks (combo эмитит tasks[]) · WP-J (me-tasks guard)   [WP-H derive — ОТЛОЖЕН]
                         │
                         ▼  разовая проверка глазами + метрики (A/B-сравнение недоступно — ВР8)
                         │
СНОСИМ СРАЗУ ПО ГОТОВНОСТИ ЗАМЕНЫ (каждый — отдельным коммитом, не бандлить; без A/B):
   • раздельные 3-2/3-7/3-3 и пр. COMBINED_COVERED — после WP-B (профиль/гигиена/ProcessTemplate воспроизведены)
   • per-block спайн 3-15 + meeting-extract-actions — сразу после WP-tasks (combo — единственный движок задач)
   • regex-детектор конфликтов — сразу после WP-G шаги 1-2 (модель размечает friction → граф строит conflicted_with)
```

**Жёсткие гейты (нарушать нельзя):**
1. **WP-I раньше всех** — без рабочего рубильника нет отката, остальное выкатывать опасно.
2. Снос раздельных специалистов — **только после WP-B** (иначе застынет клон, не построится ProcessTemplate, не пойдёт гигиена).
3. Снос regex-конфликтов — **только после WP-G шаги 1-2** (модель обучена friction); без A/B — порядок-гейт = корректность (иначе провал дашбордов).
4. WP-F (хроносверка) — поверх существующих писателей, **только вердикт-провайдер**.
5. **Откат — рубильник combined.** Снос каждого — только по готовности замены (порядок-гейты выше); A/B-сравнения нет (ВР8). После сноса meeting-extract+спайна рубильник combo — единственный откат задач.

**Из FINAL перенесены** (учесть в blueprint/ТЗ): R8 (три контура задач — единый дедуп-guard), R9 (осиротевшие воркеры — чистить router+register+воркер атомарно одним коммитом), R12 (`ALTER TYPE ADD VALUE` отдельной миграцией, без same-tx backfill). **R4** (потеря задач из встреч) — закрыт вариантом А: combo покрывает задачи из встреч до сноса meeting-extract (Ф11г).

## 4. Решения владельца (зафиксировано 2026-06-30)

1. **ProcessTemplate в combo (WP-B) → Вариант A.** Вернуть `process-detector` в раздельный dispatch (убрать `PROCESS_DETECTOR` из `COMBINED_COVERED`) — дёшево, сохраняет батч, не трогает горячий путь комбо. Авто-`handoffs`/`decisionPoints` пока **не строим** — осознанно ручной слой (заполняются вне авто-пайплайна).
2. **derive-by-signalType (WP-H) → отложено.** Кросс-карточный анализ по типу в первую итерацию **не входит**. Зафиксировано в реестре «не-сделано» (`second-brain/04_не-сделано/README.md`): примитив `KnowledgeBlockResolver.getActive` написан, но не подключён — закрыть позже, не потерять. Фильтр chat-v2 по типу уже работает — этого достаточно для текущих ответов.
3. **Хроносверка (WP-F) → только факты+решения.** Рёбра графа `*Link` продолжают закрываться по **семантике пар** (контракт `TemporalConflictService` не трогаем). Сверка по времени покрывает обе оси: Decision и IdeaBlock-факт.
4. **Рубильник комбо (WP-I) → в админку, дефолт ВСЁ ВКЛючено.** ✅ Подтверждено по конфигу: в `.env` и `backend/.env` стоит `SPECIALISTS_COMBINED_ENABLED=false`, но из-за бага `z.coerce.boolean('false')→true` комбо **фактически работает ВКЛ**. Решение (Ship-On §8): вынести флаг из ENV в `AdminSetting` как настоящий kill-switch, починить парсер (`zBool`), **дефолт = ON** (комбо включено), `.env=false` — легаси, перебиваем. ⚠️ Программисту подтвердить, что на **проде** то же значение, и что выключение было легаси, а не реакцией на инцидент с комбо.
5. **Размер окна (WP-I) → оставляем мелко.** Потолок `segment_max_tokens` не поднимаем под Opus; нить сшиваем оглавлением/графом (WP-D/WP-E), не размером куска. Любое умеренное укрупнение — только если разовая проверка покажет, что точность не падает.

## 5. Граница с ТЗ «извлечение задач из переписки» (соседний поток, не дублировать)

Параллельно одобрено ТЗ [task-extraction-pipeline-unification](../tz/2026-06-29-task-extraction-pipeline-unification.md) (`status: ready-to-implement`). Оно про **задачи/трекер** (`IntakeIssue`), это переписывание — про **граф знаний/память**. Разные артефакты, разные стадии → **не дублировать работу**. Точки стыковки:

1. **Задачи достаёт общий агент (вариант А); `specialist-3-15-tasks` И `meeting-extract-actions` выводятся.** Per-block спайн выводит ТЗ задач (Ф7) — координировать с WP-B/Ф11в на общем `router.service.ts`. `meeting-extract-actions` выводится **здесь, Ф11(г), сразу после Ф7** (combo как движок задач), **без A/B** (владелец не может сравнивать — ВР8; страховка — рубильник + метрики + разовая проверка глазами). combo — единственный экстрактор задач всех каналов; «meeting-extract остаётся тонким caller'ом» из старого ТЗ задач **отменено** вариантом А. **R8** (дубли) — единый `TaskDedupService` + дедуп-guard (Ф10/WP-J). **R4** — закрывается Ф11(г): combo покрывает задачи из встреч.
2. **`router.service.ts` — общий файл двух потоков.** ТЗ задач убирает `action_item→TASKS` (Ф7); это переписывание убирает `PROCESS_DETECTOR` из `COMBINED_COVERED` (WP-B). Согласовать порядок коммитов (R9: чистка роут+регистрация+воркер атомарно).
3. **Чат читают оба.** WP-A делает **комбо** канало-агностичным (граф из чатов: решения/идеи/навыки); ТЗ задач отдельным движком читает суточный чат для **задач**. Комбо задачи не делает → дублирования путей нет; следить лишь, чтобы один текст не гонялся двумя тяжёлыми проходами без нужды.

**Натяжение снято вариантом А:** combo достаёт задачи из **уже разобранного** полного разговора (canonical-блоки), не из сырого whole-doc → находка «нарезка > whole-doc ×3.5» не бьёт по задачам. A/B-сравнения нет (недоступно владельцу — ВР8): перед сносом meeting-extract — разовая проверка combo на встречах + наблюдение метрик.

## 6. Что НЕ делаем (подтверждено кодом)

- **Не вводим чтение `RawEvent.payload` в read-path** — сырой текст сознательно не в ретриве; ломает провенанс-инвариант «нет цитаты — нет факта» и приватность (`payload` без dataClass-фильтра на чтении). Дословный фрагмент брать из `IdeaBlockEvidence.quote`, контекст расширять графом (`IdeaBlockLink`), не payload-ом. (R-mem)
- **Не меняем enum `SignalType` в БД** ради расширяемости — 43 немых типа лечатся few-shot-текстом (WP-C); смена enum→строку ломает `Record<SignalType,…>` и снапшоты (R10).
- **Не сносим раздельных мастеров (до восстановления побочек, WP-B) и regex-крон (до обучения friction, WP-G шаги 1-2).** Без A/B — снос строго по порядку-гейту, откат рубильником.
- **Не раздуваем окно «всей встречей»** — для нашей задачи (latent-association) точность падает с 2-8K токенов; нить сшиваем графом/оглавлением (§4 FINAL).

## 7. Следующий шаг

Этот файл — основа для **blueprint** (`plans/architecture/`, человеческим языком, со сценариями «было→стало» по каждому WP) и затем **ТЗ** (`plans/tz/`). Перед blueprint владелец закрывает 5 развилок §4. Источники фактов — §0.1 + verified `файл:строка` по тексту; первичная разведка — `scratchpad/archaeology-digest.txt` (18 агентов, перепроверено по живому коду).
