---
type: tz
status: ready-to-implement
feature: clone-quality-improvements
date: 2026-06-08
owner: Сергей (владелец продукта)
relates_to:
  - plans/analysis/2026-06-07-clone-quality-and-knowledge-access-verification.md
  - plans/tz/2026-06-06-knowledge-access-groups-and-provenance.md
  - second-brain/01_projects/skill-and-clone.md
  - second-brain/01_projects/knowledge-clone.md
  - backend/src/modules/clones/SMOKE.md
---
> Анализ-источник: `plans/analysis/2026-06-07-clone-quality-and-knowledge-access-verification.md` (полная карта по коду + реальный golden-прогон DeepSeek-V4-Pro + состязательная проверка 23 предложений). · Согласование с владельцем: 2026-06-08.

# ТЗ: Улучшения качества «Клона сотрудника» (skill-trait → persona → clone-respond) + фикс chatbox-атрибуции

## Цель

Поднять качество и **частоту формирования** клона сотрудника и закрыть один HIGH-баг неверной атрибуции, попавший из изменения knowledge-access. Восемь точечных фиксов (A–H) в подсистеме Specialist 3.7 (SkillProfile/ExecutablePersona), 3.2 (knowledge-clone) и block-ingest. **Все — сразу в активный путь, без feature-flag/режимов/прогонов.**

## Зачем (болезненное состояние, по факту кода и реального golden-прогона)

1. **HIGH-баг: chatbox втекает в клон менеджера.** Chatbox грузит весь диалог клиент+менеджер ОДНИМ событием с единым `responsible.personId = менеджер` ([chatbox-ingest.service.ts:51-63,243-311](../../backend/src/modules/chatbox/chatbox-ingest.service.ts)); `tryGetActorIdentity` отдаёт его как единственного `authorPersonId` ([block-ingest.worker.ts:822-829](../../backend/src/modules/knowledge-core/workers/block-ingest.worker.ts#L822)), а `resolveSubjectEntityId` ставит `authorPersonId` высшим приоритетом ([entity-resolution.service.ts:925-995](../../backend/src/modules/knowledge-core/services/entity-resolution.service.ts#L925)). С `subjectAttributionAllTypes=true` (дефолт, [seed-admin-settings.ts:275](../../backend/scripts/seed-admin-settings.ts#L275)) КАЖДЫЙ блок — в т.ч. факт КЛИЕНТА — получает `role=subject=менеджер` ([block-ingest.worker.ts:1089-1093,1203-1214](../../backend/src/modules/knowledge-core/workers/block-ingest.worker.ts#L1089)) и втекает в knowledge-клон менеджера (3-2 тянет `role IN (subject,mentioned)` без фильтра signalType, [specialist-3-2-knowledge-clone.service.ts:504-517](../../backend/src/modules/knowledge-core/services/specialist-3-2-knowledge-clone.service.ts#L504)).
2. **Merge выбрасывает накопленную уверенность.** `mergeIntoExisting` пишет `confidence: args.draft.confidence` (последний `medium`), не пересчитывая по накопленным наблюдениям ([specialist-3-7-skill.service.ts:931](../../backend/src/modules/knowledge-core/services/specialist-3-7-skill.service.ts#L931)) → черта на 30 наблюдений навсегда `medium`.
3. **Merge не обновляет якорь.** `mergeIntoExisting` обновляет только sourceBlockIds/observationCount/confidence/lastConfirmedAt — НЕ statement и НЕ эмбеддинг ([specialist-3-7-skill.service.ts:912-944](../../backend/src/modules/knowledge-core/services/specialist-3-7-skill.service.ts#L912)) → KNN-якорь застывает на первой формулировке → будущие близнецы падают ниже порога. `runDecay` роняет `high→low` за один проход (две последовательные `updateMany`, [:969-986](../../backend/src/modules/knowledge-core/services/specialist-3-7-skill.service.ts#L969)).
4. **Нет верификации черты перед персоной.** Черта `status='active'` сразу после одного detect-вызова ([:856](../../backend/src/modules/knowledge-core/services/specialist-3-7-skill.service.ts#L856)); персона тянет все active. На golden-прогоне это дало фабрикацию: фикстура 24 (3 уточняющих тех-вопроса) → выдуманная черта. Контраст: practice-skills имеют верификационный гейт, skill-traits — нет.
5. **«Голод» формирования.** Двойной гейт: `blocks.length < minObservations` (профиль, [:204](../../backend/src/modules/knowledge-core/services/specialist-3-7-skill.service.ts#L204)) И тот же `minObservations` на КАЖДЫЙ 0.78-кластер ([:215-216](../../backend/src/modules/knowledge-core/services/specialist-3-7-skill.service.ts#L215)). На разрежённых встречах (прод-встреча «111» = 72 слова) 10 reasoning-блоков → обычно 0 черт → клон не формируется (SMOKE сценарии 2-3).
6. **Мёртвая зона merge 0.78–0.85.** Драфт, чей ближайший active-trait в [0.78,0.85), отфильтровывается из кандидатов арбитра (`1 - r.distance >= threshold`, threshold=0.85, [:646](../../backend/src/modules/knowledge-core/services/specialist-3-7-skill.service.ts#L646)) и форс-создаётся как `new` без арбитража ([:667](../../backend/src/modules/knowledge-core/services/specialist-3-7-skill.service.ts#L667)) → фрагментация профиля на near-dupes.
7. **clone-respond.** judgmental-режим (t=0.7, ответ «по аналогии» без прецедента, цитаты спрятаны) ослабляет анти-дипфейк; нет post-generation проверки грунтованности; `[DECISION:id]`-цитаты не парсятся.
8. **Role-клон без dedup.** `buildForRole` агрегирует топ-5 черт каждого сотрудника без cross-person dedup → одна черта от 3 людей повторяется в персоне роли.

## REALITY-CHECK

- Подсистема **жива и работает** (golden детектора 24/25 = 96%); фиксы — точечные правки существующих методов, НЕ новая подсистема.
- **`subjectAttributionAllTypes` уже включён в проде** (code-fallback true + сид true) — Ф1 пишет subject на все типы СЕЙЧАС. Фикс A корректирует поведение, не вводит его.
- **Миграции в Z — версионируемые** (с 2026-06-05, см. skill `prisma-db-push-rules`): новый enum-член (фаза D) = файл миграции через `prisma:migrate`, НЕ `db push`. (Текст скилла tz-author про «только prisma:push» — устарел; приоритет у CLAUDE.md.)
- `minObservations` сейчас читается статически `this.cfg.skill.minObservations` (ENV, рестарт), не `getDynamic` — фаза E добавляет динамическую крутилку.
- Practice-skills evaluator ([practice-skill-evaluator.service.ts](../../backend/src/modules/practice-skills/services/practice-skill-evaluator.service.ts)) — рабочий образец composite-judge/adversarial-verify для фазы D (заимствуем паттерн вызова, не A/B на outcome).
- Snapshot-тесты: detect/concept-name/clone-respond промпты залочены snapshot'ами ([skill-trait-detect.snapshot.spec.ts](../../backend/src/modules/knowledge-core/prompts/skill-trait-detect.snapshot.spec.ts) и т.п.). Правка SYSTEM любого из них (фаза G) ОБЯЗАНА обновить соответствующий snapshot.

## Принятые решения владельца (не пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| Р1 | **Без feature-flag / kill-switch / shadow-режимов / on-off крутилок.** Все фиксы — сразу в активный («боевой») путь. | Прямое требование владельца (2026-06-08). В проде пользователей ещё нет; контролируемая среда. |
| Р2 | **Страховка — только fail-open на ошибке**, не toggle. Где новый шаг может упасть (LLM-verify в D, эмбеддинг в C) — на ошибке поведение откатывается к «пропустить шаг / промоутить как раньше», БЕЗ runtime-флага. | Совместимо с Р1: надёжность без управляющего флага. |
| Р3 | **Без прогонов/доказательства ≥20%.** Включаем предложенные улучшения как данность. | Прямое требование владельца. |
| Р4 | Пороги-числа (cluster-floor, decay) остаются **AdminSetting-крутилками** (`getDynamic`, code-fallback = активное значение). Это значение-настройка, НЕ on-off флаг. | Инвариант Z «крутилки в AdminSetting»; не противоречит Р1 (нет включения/выключения фичи). |
| Р5 | Фикс A: чинить **корень** (per-author атрибуция в chatbox-ingest + не передавать session-level `authorPersonId` для смешанных диалогов), не симптом (фильтр в 3-2). | Битые subject-строки иначе текут через /search, /chat, дашборды; правило «чини класс, не кейс». |
| Р6 | Confidence в merge пересчитывать из **разброса РАЗНЫХ ДАТ** (distinct `lastObservedAt`-дни), НЕ из числа блоков. | Поправка верификатора: `observationCount`=число блоков; одна болтливая встреча дала бы false-`high` и нарушила правило ladder’а («high = 6+ за разные даты»). |
| Р7 | Фикс C: эмбеддинг и statement обновлять **вместе** (никогда порознь). | Иначе вектор кодирует один текст, а `statement` показывает другой → рассинхрон KNN. |

## Доказательство выбора

Полная состязательная матрица 23 предложений (проход A «под текущий код» vs проход B «индустриальный паттерн» + challenge-loop + независимая верификация каждого) — в анализе-источнике §4–5. Краткий ADR по ключевым развилкам:

- **Фикс A — корень vs симптом.** Проход A: фильтр signalType в 3-2-консьюмере (симптом). Проход B: per-author атрибуция на ingest (корень). B выбран: симптом-фикс оставляет битые `IdeaBlockEntity{role=subject}` в графе → утечка через все остальные поверхности retrieval; B чинит весь класс (Р5).
- **Фикс D — фильтр уверенностью vs grounding-проверка.** Confidence не различает валид/фабрикацию (на golden и валид, и фикстура-24-фабрикация → `medium`), поэтому фильтр по confidence бесполезен; нужен отдельный дешёвый grounding-проход (deepseek-v4-flash). Human-in-loop запрещён правилом проекта.
- **Фикс E — глобально снизить порог vs split-floor + verify.** Глобальное снижение `minObservations` до 3 множит фабрикации (единственная 3-блочная улика на golden — фабрикация). Split (cluster-floor 3, profile-floor 5) + предварительный гейт D даёт recall без падения precision.

## Scope

**Входит:** 8 фиксов A–H в указанных файлах; один новый enum-член `SkillTraitStatus.pending_verification` (+ миграция); один новый LLM-taskType `skill-trait-verify` (+ маршрут в сиде); один новый `@Cron` верификатора черт; обновление snapshot’ов промптов, затронутых правкой SYSTEM; юнит-тесты per-фаза; обновление second-brain + prod-deploy-log.

**Не входит (с судьбой):**
- Enforce-GA пункты knowledge-access (RetrievalCache-отпечаток, total пагинации, fail-open проекций) — отдельный трек, болят только при `KNOWLEDGE_ACCESS_ENFORCEMENT≠off` (дефолт off). → остаются в анализе-источнике §2, vNext-ТЗ при включении enforce.
- A/B-промоция черт по реальному outcome (как у practice-skills) — фаза D делает только grounding-срез на момент создания. → vNext, если потребуется.
- Реальный per-span LLM-маппинг автора в chatbox — фаза A использует детерминированную per-message сегментацию, не LLM. → vNext при необходимости.

## Граничные контракты

- **chatbox-сессия (Tozix/Nikita) могла трогать `chatbox-ingest.service.ts`** — перед фазой A `git fetch` + проверить, нет ли параллельной правки сегментации; согласовать diff renderTranscript/segment-builder.
- **`block-ingest.worker.ts` и `entity-resolution.service.ts` — общие для всех источников** (meeting/free_note/dump/email/tracker/chatbox). Любая правка авторезолва (фаза A) ОБЯЗАНА менять поведение ТОЛЬКО для chatbox-смешанных событий; одно-авторные источники — байт-в-байт прежние (regression-guard в Acceptance).

## Контракт-first

> Все `path:line` — на момент написания (2026-06-08). Перед правкой каждой фазы перечитать файл по якорю-символу (номера дрейфуют).

### Фаза D — новый статус и LLM-контракт

**Prisma (миграция `prisma:migrate -- --name add-skill-trait-pending-verification`):**
```prisma
enum SkillTraitStatus {
  active
  superseded_by
  archived
  misleading
  pending_verification   // ← новый: черта создана, ждёт grounding-проверки; в персону НЕ попадает
}
```
Якорь: `enum SkillTraitStatus {` в [schema.prisma:7298](../../backend/prisma/schema.prisma#L7298).

**Новый LLM-taskType `skill-trait-verify`** (primary `deepseek-v4-flash` — дешёвый, по правилу проекта; SYSTEM стабильный, переменные — statement + цитаты блоков — в конце USER):
- Вход: `statement` черты + дословные цитаты её `sourceBlockIds` (reasoning-блоки).
- Выход (strict JSON, схема `skill_trait_verify_v1`): `{ "grounded": boolean, "reason": string }`.
- `grounded=true` ⇔ черта прямо подтверждается ≥2 цитируемыми reasoning-блоками И это рассуждение о СОБСТВЕННОМ подходе (не уточняющие вопросы / не общие фразы).
- Маршрут добавить в `backend/scripts/seed-llm-task-routes-skill-and-clone.ts` (рядом с существующими 4 route клона).

**Новый cron `skill-trait-verify.cron`** (образец — `practice-skill-evaluate.cron.ts`): батч `status='pending_verification'`, для каждой — `skill-trait-verify`; `grounded=true` → `status='active'`; иначе оставить `pending_verification` (decay уберёт). **Fail-open (Р2):** ошибка LLM/таймаут на черте → промоут в `active` (как было до D), не блокировать.

### Коды ошибок / ENV / крутилки

- Новых machine-readable кодов ошибок нет (внутренние шаги, не HTTP).
- Новые AdminSetting-крутилки (getDynamic, code-fallback = активное значение, НЕ on-off):
  - `knowledge.skillClusterMinObservations` (fallback **3**) — порог на КЛАСТЕР (фаза E).
  - `knowledge.skillProfileMinObservations` (fallback **5**) — порог на ПРОФИЛЬ (фаза E; вынос текущего `minObservations` в getDynamic).
- НЕ вводить: никаких `*_ENABLED` / off-shadow-enforce для фиксов (Р1).

## Границы фичи
- ✅ Always: одно-авторные источники (meeting/free_note/dump/email/tracker) после фазы A — байт-в-байт прежние; SYSTEM-промпты cache-friendly (правки — разово + обновить snapshot); fail-open на ошибке нового шага.
- ⚠️ Ask first: трогать chatbox-ingest без сверки с параллельной сессией; менять приоритет резолва автора для НЕ-chatbox источников.
- 🚫 Never: новый on-off feature-flag/kill-switch/shadow-режим (Р1); `process.env.*` (только `TypedConfigService`); `new PrismaClient()` в скриптах (только `createPrismaClient()`); confidence из числа блоков вместо разброса дат (Р6); обновлять эмбеддинг без statement (Р7); человек-in-loop для апрува черт.

---

## Фазы

Граф зависимостей: **Ф1(A) ∥ Ф2(B+C) ∥ Ф6(G) ∥ Ф7(H)** независимы; **Ф3(D) → Ф4(E)** (E безопасна только после verify-гейта); **Ф5(F) после Ф2** (тот же файл, тот же merge-путь). Порядок волн: волна-1 {Ф1, Ф2, Ф3, Ф6, Ф7} → волна-2 {Ф4, Ф5}.

### Фаза 1 (A) — chatbox: per-author атрибуция, не «всё на менеджера» `[x]`
**Цель:** факт, сказанный клиентом, НЕ становится `role=subject=менеджер`.
**Что входит:**
- `chatbox-ingest.service.ts` (renderTranscript/segment-build, ~`:51-63,243-311`): для диалога с участниками И client, И manager — эмитить **per-message сегменты** с синтетическими монотонными `startMs/endMs (>0)` и `speakerParticipantId` по автору: manager-сообщения → participant менеджера; client-сообщения → отдельный participant БЕЗ Person (`speakerParticipantId` клиента, который не резолвится в Person). Для смешанного диалога **НЕ передавать session-level `responsible.personId`** в payload (иначе он станет `authorPersonId` для всех блоков). Чисто-manager / чисто-internal событие — оставить текущий быстрый путь (`responsible.personId=менеджер`).
- `block-ingest.worker.ts` `tryGetActorIdentity` (`:822-829`): для chatbox — НЕ возвращать единый `authorPersonId`, если в payload есть per-message сегментация со смешанными авторами (тогда `attributeSubject` пойдёт по сегментному пути `seg`, [:1162-1181](../../backend/src/modules/knowledge-core/workers/block-ingest.worker.ts#L1162), и привяжет блок к спикеру его evidence-спана; client-спан → `resolveSubjectEntityId` вернёт null → subject не пишется = открытый факт).
**Что НЕ входит:** изменение резолва автора для НЕ-chatbox; фильтр в 3-2-консьюмере (отвергнут Р5); LLM-маппинг спанов.
**Файлы:** `chatbox-ingest.service.ts`, `block-ingest.worker.ts` (`:801-847`, `:1143-1214`), при необходимости `entity-resolution.service.ts` (только чтение приоритетов).
**Acceptance:**
- Юнит (chatbox-ingest.spec): смешанный диалог (1 реплика client-факт + 1 reasoning менеджера) → сегменты с разными `speakerParticipantId`, client-сегмент без Person; payload смешанного события БЕЗ `responsible.personId`.
- Юнит (block-ingest): блок из client-реплики → НЕ создаётся `IdeaBlockEntity{role=subject}` на Person менеджера; блок из manager-reasoning → создаётся subject=менеджер.
- Regression: чисто-manager chatbox-событие → subject=менеджер (как раньше); meeting/free_note/dump — поведение subject-атрибуции не изменилось (существующие spec зелёные).
- `bun run typecheck/lint`; `bunx vitest run` затронутых spec — зелёные.
**Закрывает:** R1.

### Фаза 2 (B+C) — merge: уверенность из дат + якорь вместе + decay без двойного шага `[x]`
**Цель:** накопительная черта корректно растит уверенность, якорь не застывает, decay не роняет на 2 ступени.
**Что входит (всё в `specialist-3-7-skill.service.ts`):**
- **B (`:931`, `mergeIntoExisting`):** заменить `confidence: args.draft.confidence` на пересчёт из **разброса дат** (Р6): загрузить `lastObservedAt` (или `createdAt`) блоков объединённого `sourceBlockIds`, посчитать число различных дней; `confidence = distinctDays>=4 ? 'high' : distinctDays>=2 ? 'medium' : 'low'`; писать `MAX(текущая_existing, evidence-floor)` (не понижать уже достигнутую). Дни считать из блоков (не из draft.confidence).
- **C-якорь (`:912-944`, `mergeIntoExisting`):** добавить обновление `statement` и эмбеддинга ВМЕСТЕ (Р7). Эмбеддинг переиспользовать из уже посчитанного в `mergeOrCreate` (`embedding` в scope на [:608-615,:692](../../backend/src/modules/knowledge-core/services/specialist-3-7-skill.service.ts#L692)) — прокинуть третьим аргументом в `mergeIntoExisting`; писать через тот же `$executeRawUnsafe ... ::vector` паттерн, что в `createNewTraitRaw` (`:862-866`). `statement` обновлять на draft.statement только при verdict='merge' и непустом draft.statement; эмбеддинг считать от пары `{category, обновлённый statement}`. Best-effort: ошибка эмбеддинга → НЕ обновлять ни вектор, ни текст (откат к старому, Р2).
- **C-decay (`:969-986`, `runDecay`):** убрать каскад `high→medium` + `medium→low` за один проход. Сделать переход на ОДНУ ступень за проход: если `lastConfirmedAt < decayCutoff` — `high→medium` ИЛИ `medium→low`, но не оба в одном `runDecay` (например, исключить из второго `updateMany` те, что только что понижены: добавить условие на `updatedAt`/отдельный возрастной порог, либо выполнять только один из двух переходов по возрасту: `>2*decayMonths → medium→low`, `>decayMonths → high→medium`).
**Что НЕ входит:** изменение detect-промпта (confidence detect остаётся как есть); merge dead-band (фаза F).
**Файлы:** `specialist-3-7-skill.service.ts` (`:608-727`, `:837-944`, `:949-996`).
**Acceptance:**
- Юнит: merge черты с блоками за 4 разных дня → `confidence='high'`; за 1 день → не выше `low`; повторный merge не ПОНИЖАЕТ уже `high`.
- Юнит: после merge с непустым draft.statement (verdict=merge) — `statement` обновлён И `embedding` колонка изменилась (raw-select `embedding IS NOT NULL` + отличается); при симуляции падения эмбеддера — ни statement, ни embedding не изменились.
- Юнит: trait `high`, `lastConfirmedAt` старше `decayMonths` но младше `2*decayMonths` → после `runDecay` стал `medium` (НЕ `low`).
- `bun run typecheck/lint`; `bunx vitest run` затронутых spec — зелёные.
**Закрывает:** R2, R3.

### Фаза 3 (D) — verify-гейт черты перед персоной `[x]`
**Цель:** фабрикованная/негрунтованная черта не попадает в персону.
**Что входит:**
- Миграция + enum `SkillTraitStatus.pending_verification` (контракт выше).
- `createNewTraitRaw` (`:856`): новые черты создавать со `status='pending_verification'` (не `active`). `mergeIntoExisting` и `supersedes`-путь не меняют статус целевой active-черты.
- Новый промпт-файл `skill-trait-verify.prompt.ts` (SYSTEM стабильный; USER: statement + цитаты блоков в конце) + схема `skill_trait_verify_v1`.
- Новый taskType `skill-trait-verify` + маршрут в `seed-llm-task-routes-skill-and-clone.ts` (primary `deepseek-v4-flash`).
- Новый `@Cron` (образец `practice-skill-evaluate.cron.ts`): батч `pending_verification` → `skill-trait-verify` → `grounded` ? `active` : оставить. **Fail-open (Р2):** ошибка LLM → промоут в `active`.
- `executable-persona-build.service.ts` (`:102-107`, выборка `status:'active'`) — не трогать (она уже берёт только active; pending_verification сам не попадёт).
**Что НЕ входит:** A/B на outcome (vNext); фильтр по confidence (бесполезен).
**Файлы:** `schema.prisma`, `specialist-3-7-skill.service.ts` (`:843-857`), новый `prompts/skill-trait-verify.prompt.ts`, новый `workers/skill-trait-verify.cron.ts`, `seed-llm-task-routes-skill-and-clone.ts`.
**Acceptance:**
- Юнит: `createNewTraitRaw` → черта `status='pending_verification'`.
- Юнит (cron, мок LLM): `grounded=true` → `active`; `grounded=false` → остаётся `pending_verification`; ошибка LLM → `active` (fail-open).
- Греп: `pending_verification` присутствует в enum schema.prisma и в `createNewTraitRaw`.
- Миграция повторно (`migrate deploy`) = no-op; `prisma:generate` ок.
- `bun run typecheck/lint/build`; `bunx vitest run` затронутых — зелёные.
**Закрывает:** R4.

### Фаза 4 (E) — split cluster-floor + динамические пороги (ПОСЛЕ D) `[x]`
**Цель:** клон формируется на разрежённых данных без роста фабрикаций (предохранитель — D).
**Что входит (в `specialist-3-7-skill.service.ts`):**
- Развести два порога: профиль (`:204`) и кластер (`:215-216`). Профиль остаётся `skillProfileMinObservations` (getDynamic, fallback 5). Фильтр кластеров (`:216`) — по новому `skillClusterMinObservations` (getDynamic, fallback **3**).
- Вынести оба значения в `TypedConfigService.getDynamic` (Р4); сейчас `this.cfg.skill.minObservations` статичен — добавить геттеры/чтение AdminSetting (образец — `getDynamic` в block-ingest `:1152`).
**Что НЕ входит:** новый on-off флаг (Р1); изменение 0.78-порога группировки (это фаза не трогает).
**Файлы:** `specialist-3-7-skill.service.ts` (`:196-217`), `typed-config.service.ts` (геттеры), `env.schema.ts` (если нужны ENV-дефолты code-fallback).
**Acceptance:**
- Юнит: профиль с 6 reasoning-блоками, образующими 2 кластера по 3 → формируются ≥1 черта (раньше при floor=5 на кластер — 0). Профиль с 2 блоками всего → 0 (профиль-floor 5 держит).
- Греп: `skillClusterMinObservations` и `skillProfileMinObservations` читаются через `getDynamic`, не статичный `this.cfg.skill.minObservations`.
- `bun run typecheck/lint`; `bunx vitest run` затронутых — зелёные.
**Закрывает:** R5.

### Фаза 5 (F) — арбитраж мёртвой зоны merge 0.78–0.85 (ПОСЛЕ Ф2) `[x]`
**Цель:** драфт-близнец в [0.78,0.85) не форс-создаётся как `new`, а судится арбитром.
**Что входит:**
- `mergeOrCreate` (`:644-673`): ввести `ARBITRATION_FLOOR=0.78`. KNN-кандидаты фильтровать по `1 - distance >= ARBITRATION_FLOOR` (0.78), но помечать каждого бакетом: `hard` (≥0.85) / `band` ([0.78,0.85)). Если ВСЕ кандидаты — `band`, всё равно звать `callMergeArbiter` (не форс-`new`). Cap кандидатов: топ-3.
- `skill-trait-merge.prompt.ts` (`SKILL_TRAIT_MERGE_USER_TEMPLATE`, переменные в КОНЦЕ user — cache-safe): добавить бакет к каждому кандидату; правило: для `band`-кандидата арбитр выбирает `merge`/`supersedes` ТОЛЬКО при совпадении смысловой категории, иначе `new`. SYSTEM НЕ трогать (cache + нет snapshot на merge-промпт — проверить).
**Что НЕ входит:** снижение 0.85 до 0.78 «вслепую» (отвергнуто — форс-merge различных черт).
**Файлы:** `specialist-3-7-skill.service.ts` (`:595-727`), `prompts/skill-trait-merge.prompt.ts`.
**Acceptance:**
- Юнит: драфт с ближайшим кандидатом на cosine 0.80 → вызывается `callMergeArbiter` (не сразу `createNewTrait`); при verdict='new' — создаётся новая; при 'merge' — мерджится.
- Греп: `0.78` фигурирует как arbitration-floor в `mergeOrCreate`; бакет передаётся в USER-шаблон merge.
- `bun run typecheck/lint`; `bunx vitest run` затронутых — зелёные.
**Закрывает:** R6.

### Фаза 6 (G) — clone-respond hardening `[x]`
**Цель:** меньше дипфейк-риска в judgmental-режиме; цитаты полезнее.
**Что входит:**
- `clones.service.ts` `assertTopicDensity` / judgmental-путь: убрать понижение порога до 1 блока в judgmental — держать **2-блочный пол** (как factual) с `cosine ≥ cloneTopicSimilarityThreshold` (0.70); анти-дипфейк-гейт един для обоих режимов. Якорь: `cloneTopicMinBlocks` / `assertTopicDensity` в `clones.service.ts` (~`:2363`, `:2562-2567` — перечитать).
- `clone-respond.prompt.ts`: в judgmental-секции усилить запрет приписывать носителю конкретные слова/решения без прецедента (формулировки уже есть — не ослаблять); парсить `[DECISION:id]` наравне с `[BLOCK:id]` и сохранять в `metadata.citations`. Правка SYSTEM → **обновить `clone-respond` snapshot** ([__snapshots__](../../backend/src/modules/knowledge-core/prompts/__snapshots__/)).
**Что НЕ входит:** удаление judgmental-режима (остаётся, только пол не понижается); post-generation NLI-self-check (отложено — отдельная фаза, не в этом ТЗ; vNext).
**Файлы:** `clones.service.ts`, `prompts/clone-respond.prompt.ts`, его snapshot-spec.
**Acceptance:**
- Юнит: judgmental-вопрос при <2 reasoning-блоках (cosine≥0.70) → `refused='topic_starved'` (как factual), а не ответ по 1 блоку.
- Юнит: ответ с `[DECISION:id]` → id попадает в `metadata.citations`.
- Snapshot clone-respond обновлён и зелёный.
- `bun run typecheck/lint`; `bunx vitest run` затронутых — зелёные.
**Закрывает:** R7.

### Фаза 7 (H) — dedup ролевой персоны по conceptId `[x]`
**Цель:** одна и та же черта от N сотрудников не повторяется в персоне роли.
**Что входит:**
- `executable-persona-build.service.ts` `buildForRole` (`:243-280`, агрегация топ-5 черт на сотрудника): перед компиляцией схлопывать черты по `conceptId` (если задан) в один представитель-кластер, выбирая лучшую формулировку (max observationCount; при равенстве — выше confidence) и суммируя «вес»/число носителей; для черт без `conceptId` — оставить как есть. Передавать в `executable-persona-compile` уже дедуплицированный список.
**Что НЕ входит:** изменение person-scope build (там одна персона на сотрудника, dedup не нужен); правка compile-промпта (вход уже дедуплицирован).
**Файлы:** `executable-persona-build.service.ts` (`:243-354`).
**Acceptance:**
- Юнит: роль с 3 сотрудниками, у каждого черта одного `conceptId` → в `includedTraitIds`/входе компиляции эта черта представлена ОДИН раз; разные conceptId — все остаются.
- `bun run typecheck/lint`; `bunx vitest run` затронутых — зелёные.
**Закрывает:** R8.

---

## Требования (EARS, трассируемые)

- **R1.** Когда block-ingest обрабатывает chatbox-событие со смешанными авторами (client+manager), система shall НЕ записывать `IdeaBlockEntity{role='subject'}` на Person менеджера для блоков, извлечённых из реплик клиента.
- **R2.** Когда `mergeIntoExisting` объединяет драфт в существующую черту, система shall пересчитать `confidence` из числа различных дат наблюдений (не из числа блоков) и не понижать уже достигнутый уровень.
- **R3.** Когда `mergeIntoExisting` обновляет черту, система shall обновить `statement` и `embedding` атомарно-вместе (или оба не трогать при ошибке); `runDecay` shall понижать confidence не более чем на одну ступень за проход.
- **R4.** Когда создаётся новая черта, система shall ставить `status='pending_verification'`; черта shall стать `active` только после `grounded=true` от `skill-trait-verify` (или fail-open при ошибке LLM); персона shall собираться только из `active`-черт.
- **R5.** Когда reasoning-блоки сотрудника образуют кластеры размером ≥ `skillClusterMinObservations` (fallback 3), система shall детектить черты, при профиль-пороге `skillProfileMinObservations` (fallback 5); оба порога shall читаться через `getDynamic`.
- **R6.** Когда ближайший active-trait драфта по cosine лежит в [0.78, 0.85), система shall передать его арбитру `skill-trait-merge` (не форс-создавать `new`).
- **R7.** Если интент диалога — judgmental, система shall применять тот же анти-дипфейк-порог (≥2 reasoning-блока, cosine≥0.70), что и factual; система shall парсить `[DECISION:id]` в `metadata.citations`.
- **R8.** Когда строится персона роли, система shall схлопывать черты с одинаковым `conceptId` в одну.

## Pre-mortem / Риски (ревью-аспекты для `strict-production-review-gate`)
- **Фаза A регрессирует не-chatbox источники** — проверить грепом, что правка резолва автора условна по признаку chatbox/смешанности; regression-spec на meeting/free_note обязателен.
- **Фаза D без флага может застрять (черты в pending)** — проверить fail-open на ошибке LLM + что cron реально зарегистрирован и батчит; иначе клоны перестанут формироваться (нет флага-отката — критично).
- **Фаза E + отсутствие D** — порядок волн строгий: E ТОЛЬКО после D (иначе рост фабрикаций). Оркестратору — не параллелить Ф3 и Ф4.
- **Фаза C — рассинхрон вектор/текст** — ревью: эмбеддинг и statement пишутся в одном `update`/транзакции, на ошибке оба откатываются.
- **Фаза G — snapshot** — правка SYSTEM clone-respond без обновления snapshot уронит тест; убедиться, что snapshot обновлён осознанно (diff в ревью).
- **prompt-cache** — все правки промптов (D новый, F — USER-конец, G — SYSTEM разово): SYSTEM стабилен, переменные в конце user; раздел «Совместимость с prompt caching» соблюдён.

## Совместимость с prompt caching
- D: новый `skill-trait-verify` — SYSTEM-константа, statement+цитаты в конце USER → кэш-дружелюбно.
- F: `skill-trait-merge` — добавляем бакет в КОНЕЦ USER-шаблона, SYSTEM не трогаем → кэш сохранён, snapshot merge-промпта (если есть) обновить.
- G: `clone-respond` SYSTEM правится РАЗОВО (одноразовый cache-bust) + обновляется snapshot; дальше стабилен.
- B/C/E/H — без правок промптов (чистый сервис/код).

## Idempotency / prod-deploy
- Миграция D — `prisma migrate deploy` идемпотентен (повторно no-op) — acceptance.
- Новый route `skill-trait-verify` — добавить в `seed-llm-task-routes-skill-and-clone.ts` (идемпотентный upsert); сид зарегистрирован в `apply-prod-deploy.ts STEPS`.
- Новый `@Cron` `skill-trait-verify.cron` — Шаг 12 prod-deploy-log (smoke: cron виден).
- `prod-deploy-log.md`: Шаг 4 (enum/миграция), Шаг 7 (route-сид), Шаг 12 (новый cron + grep). ENV-дефолты code-fallback (E) — Шаг 1, если добавляются.
- В скриптах — `createPrismaClient()`, импорты из `../src`.

## DoD
- `bun run typecheck` (вкл. `.spec`) / `lint` / `build` зелёные (backend); vitest unit по затронутым фазам.
- Все snapshot’ы затронутых промптов обновлены и зелёные.
- Миграция применяется и повторно no-op; `prisma:generate` ок.
- second-brain обновлён: `01_projects/skill-and-clone.md` (merge/decay/verify-гейт/пороги), `01_projects/knowledge-clone.md` (chatbox-атрибуция), `01_projects/ai-jobs.md` + `workers-queues.md` (новый cron + taskType), `02_architecture/code-pitfalls.md` (merge-confidence-overwrite, decay double-step как грабли).
- `prod-deploy-log.md` обновлён (Шаги 4/7/12, опц. 1); рефлексия в `05_история/`.
- Реестр `04_не-сделано`: строка про chatbox-атрибуцию (HIGH) — закрыть после Ф1; enforce-GA пункты — добавить vNext-строкой.

## Итог
**Статус: реализовано целиком (2026-06-08).** Все 8 фаз (A–H) внедрены без feature-flag (Р1, fail-open вместо toggle), ветка `feature/2026-06-08-tz-batch-tables-clones-shipon`, коммиты `dbf9b0d4`(Ф1) · `8446e89a`(Ф6) · `fc8901fe`(Ф7) · `3376fae1`(Ф3) · `2b59c8da`(Ф2+Ф4) · `4c28bea1`(Ф5). Доп. находка реализована: тот же двойной-шаг decay исправлен и в `SkillProfileRecalibrateCron` (класс-фикс). Верификация: typecheck/build зелёные, `vitest run` по knowledge-core+clones+chatbox — 89 файлов / 530 тестов зелёные. Прод: миграция enum + cron `skill-trait-verify` + seed-route + backfill — см. `docs/operations/prod-deploy-log.md`. **Ничего не отложено** (chatbox B1/B2 — это и есть Ф1; B3 backfill — в ТЗ enable-shipped).
