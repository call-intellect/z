---
type: tz
feature: task-solution-real-defects
title: "TaskSolution — устранение реальных дефектов материализатора (детекция · атрибуция · повтор · текст · стенд)"
status: draft
date: 2026-07-08
owner: владелец (sergrv80@gmail.com)
handoff: да — самодостаточное ТЗ для отдельного агента реализации
baseline: docs/testing/regulation-stand-report.md (ось A5, итерация 1: PASS 11 · FAIL 0 · N/A 1)
analysis: plans/analysis/2026-07-08-task-solution-materializer-weakness-audit.md
excludes:
  - "R4 (тихая потеря на дополнении) — сделано в цикле 2 (эта сессия)"
  - "R5 (гейт по длине) — сделано в цикле 2"
  - "Y1/Y2/Y3 (честность стенда по субъектам + видимость skippedNoMethod) — сделано в цикле 2"
code:
  - backend/src/modules/knowledge-core/services/task-solution-build.service.ts
  - backend/src/modules/knowledge-core/services/task-solution-refiner.service.ts
  - backend/src/modules/knowledge-core/services/entity-resolution.service.ts
  - backend/src/modules/knowledge-core/prompts/structured-document-compiler.prompt.ts
  - backend/src/modules/knowledge-core/workers/block-distill.worker.ts
  - backend/src/modules/knowledge-core/workers/block-ingest.worker.ts
  - backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts
  - backend/src/modules/*/adapters/conversational-ingest.adapter.ts
  - backend/scripts/regulation-stand/*
---

# ТЗ — реальные дефекты материализатора «Решений задач»

## 0. Контекст и как читать

Это ТЗ — **прямое следствие аудита** [plans/analysis/2026-07-08-task-solution-materializer-weakness-audit.md](../analysis/2026-07-08-task-solution-materializer-weakness-audit.md).
Аудит поделил находки на зелёную/жёлтую/красную зоны. **Цикл 2 (в отдельной сессии) закрывает R4, R5 и
честность стенда по субъектам** — их здесь НЕ трогаем (см. `excludes`). Это ТЗ берёт **всё остальное реальное**:
красная зона R1/R2/R3/R6/R7 + средние дефекты жёлтой зоны + новый e2e-режим стенда, который разблокирует
доказуемость R1/R6/R7.

**Жёсткие правила проекта (соблюдать):**
- **Ship-On:** каждая фича выкатывается включённой. Флаг — только (а) аварийный рубильник (kill-switch, ON, действий владельца не требует) или (б) решение владельца (необратимо меняет доступ/деньги — выкат только с заданным параметром). Любой новый флаг → строка в `docs/operations/feature-flags.md`.
- **Крутилки — в `AdminSetting`**, не в ENV/коде: порог/лимит/вес/выбор модели → `getDynamic` (admin→ENV→code-fallback) + реестр `admin-setting-schema-registry.ts` + сид `seed-admin-setting-task-solution.ts` + UI-поле.
- **Без нарративных комментариев в коде.** Контракты/инварианты — в этом ТЗ и `docs/`, не в коде.
- **Prisma:** любое изменение БД = файл миграции (`prisma:migrate --name ...`); в скриптах `createPrismaClient()` из `scripts/_lib/prisma.ts`, не `new PrismaClient()`.
- **Prod-путь:** новые seed/patch/backfill/migrate-скрипты регистрировать в `backend/scripts/apply-prod-deploy.ts` (массив `STEPS`) + запись в `docs/operations/prod-deploy-log.md`.
- **Стенд не трогает прод:** throwaway-тенант, локальная dev-БД, `assertNotProd`.

**Порядок реализации (важен — есть зависимости):** Блок E (e2e-стенд) → Блок B (атрибуция) → Блок C (повтор) → Блок A (детекция) → Блок D (субъекты/текст). E первым, потому что он даёт harness, на котором доказуемы A/B/C/R7. Если объём велик — разбить на под-PR по блокам, но каждый блок должен идти в прод включённым и с доказательством на стенде.

---

## Блок A — Детекция и захват (R1 + R7) `[архитектурный — требует одобрения владельца ДО кода]`

> ⚠️ **Гейт процесса:** этот блок меняет приём встреч/чата (ingest-архитектуру). Перед реализацией —
> `plans/architecture/task-solution-capture-scope.md` (человеческим языком: что есть → что делаем → как
> будет) со `status: approved` от владельца. Остальные блоки (B–E) — contained-фиксы, architecture-гейт не нужен.

### A1. Захват решений из встреч/чата/заметок (R1)
- **Дефект:** детекция требует `re.payload->>'contextCardId' IS NOT NULL` (`task-solution-build.service.ts:70,78`). Единственный писатель `contextCardId` — ответ на probe `task.method_capture` (`conversational-ingest.adapter.ts:77`). `ingestFreeNote`/`ingest`/meetings его не пишут → решения из этих каналов не материализуются никогда.
- **Контракт решения:** детекция и `buildOne` находят how-solved блоки задачи **через связь блок↔Issue**, а не через `payload.contextCardId`:
  - использовать существующую связь блок→сущность/issue-resolution (проверить `IdeaBlockEntity` / issue-resolution на ingest встреч/чата: как how-solved блок из встречи привязывается к конкретной задаче);
  - если для канала связь блок↔Issue не устанавливается на ingest — реализовать её (issue-resolution по entity/ссылке в тексте), это и есть корень;
  - `contextCardId` оставить как один из источников привязки (обратная совместимость с probe), но НЕ единственный.
- **Acceptance:** how-solved блок, пришедший из встречи/чата БЕЗ `contextCardId`, но привязанный к Issue, материализуется в TaskSolution (доказать e2e-режимом стенда из Блока E — реальный RawEvent без `contextCardId`).
- **Ловушка:** не сломать текущий probe-путь (`a5-create-from-probe` обязан остаться PASS).

### A2. Расширить набор how-solved signalType (R7)
- **Дефект:** `HOW_SOLVED_SIGNAL_SQL = 'reasoning','rationale','decision_basis','methodology_step'` (`service.ts:13`). A1-промпт (`block-ingest.prompt.ts:353`) гонит past-tense результат («сделал», «закрыл») в `task_completed`/`done_item` — вне набора.
- **Контракт:** либо расширить набор (`task_completed`/`done_item`, но ТОЛЬКО когда блок привязан к Issue — иначе шум), либо ввести отдельный `signalType='how_solved'` и маршрутизировать в него ретро-описания решения из A1.
- **Крутилка:** набор how-solved signalType вынести в `AdminSetting` (`taskSolution.howSolvedSignalTypes`, массив строк, code-fallback = текущие 4) — чтобы правился без релиза.
- **Acceptance:** A1-сценарий (Блок E) с ответом «закрыл задачу так-то» (→ `task_completed`, привязан к Issue) доходит до материализатора.

---

## Блок B — Атрибуция владельца (R2 + R3 + Y6 + Y8 + Y9)

Ядро анти-cross-clone. Все правки — в `resolveOwnerPerson` / `buildOne` (`task-solution-build.service.ts`).

### B1. Null-owner → фолбэк на решателя из текста (R2)
- **Дефект:** `service.ts:155` `if (!ownerPersonId) return 'skippedNoOwner'` ДО refine (`:219`). Задача без assignee + «Иван починил X» → решение теряется.
- **Контракт:** при `ownerPersonId==null` — вызвать рефайнер; если вернул **ровно один** однозначный `solverName` → `resolvePersonByHint` → взять владельцем. ≥2 или неоднозначно → остаётся `skippedNoOwner` (не приписываем чужое). Порядок: перенести refine ВЫШЕ owner-гейта или продублировать вызов в null-ветке.
- **Acceptance:** adversarial-сценарий «Issue без assignee + один явный решатель» → created, owner=решатель. «Без assignee + двое» → skippedNoOwner.

### B2. Расхождение assignee vs решатель (R3)
- **Дефект:** владелец только из `resolveOwnerPerson(issue.assignees)`; `solverNames` в владельца не влияют. Переназначенный/координаторский тикет → владелец не тот.
- **Контракт:** если `assignee ∉ solverNames` И назван **ровно один** решатель → предпочесть решателя владельцем (или писать `confidence` пониже + аудит-запись расхождения, если полная замена рискованна — решить в architecture-заметке). Консервативно: не менять владельца молча, если решателей несколько или есть неоднозначность.
- **Крутилка:** `taskSolution.ownerInferenceEnabled` — **kill-switch** (ON): выкл → чистое `owner=assignee` (текущее). Строка в `feature-flags.md`.
- **Acceptance:** сценарий «assignee=Пётр (координатор), в тексте однозначно решал Иван» → owner=Иван; «assignee=Иван, решал Иван» → без изменений.

### B3. Несколько assignee — детерминированный выбор (Y9)
- **Дефект:** `resolveOwnerPerson:384-388` берёт первый userId в порядке массива; `issue.assignees` (`:150`) без `orderBy` → недетерминированно.
- **Контракт:** при нескольких assignee — дизамбигуировать через `solverNames` (кто фигурирует в решении); если не помогло — детерминированный tiebreak (по `id` алфавитно), не порядок БД. Добавить `orderBy` в выборку assignees.
- **Acceptance:** unit-тест: два assignee, один в solverNames → он владелец; никто → алфавитный tiebreak стабилен.

### B4. Заморозка владельца + union субъектов на апдейте (Y8)
- **Дефект:** `service.ts:338-350` на update перечитывает владельца из текущих assignees и `personSubjectIds:{set:...}` (замена). Переназначение задним числом переписывает историю; со-решатель из прошлого прогона выпадает.
- **Контракт:** после первичного create `ownerPersonId` **заморожен** (менять только при явном owner-inference из B2 с аудит-записью, не молча по смене assignee). `personSubjectIds` — **аккумулировать union** по версиям (`{ set: union(existing.personSubjectIds, newSubjectIds) }`), не replace. Owner всегда остаётся в union.
- **Acceptance:** сценарий «решение создано (owner=Иван, subjects=[Иван,Михаил]) → переназначили на Петра, новый блок без Михаила» → owner остаётся Иван, subjects остаётся ⊇{Иван,Михаил}.

### B5. Adversarial owner-сценарии в корпус (Y6)
- **Дефект:** `owner_is_solver=100%` тавтологичен — весь корпус `assignee=решавший`.
- **Контракт:** добавить в корпус/эталон стенда сценарии: (1) без assignee + один решатель; (2) без assignee + двое; (3) assignee≠решатель (один решатель); (4) несколько assignee. Ассертить корректный вывод владельца. Требует поля в `A5Ruler` и ассертов в `match.ts` (в паре с полем `mustNotSubject` из цикла 2).
- **Acceptance:** метрика владельца перестаёт быть read-through: минимум 4 сценария, где владельца надо ВЫВЕСТИ, все PASS.

---

## Блок C — Повтор и рецидив (R6 + Y4)

### C1. Окно детекции по свежести evidence, не по `createdAt` (R6)
- **Дефект:** детект фильтрует `ib.createdAt >= now-48ч` (`service.ts:64,74`), но `block-distill.worker.ts:308` мержит evidence нового блока в старый canonical, `createdAt` победителя не двигается → рецидив в старом canonical выпадает из окна.
- **Контракт:** фильтровать окно по `GREATEST` последней `IdeaBlockEvidence.sourceTimestamp` / `RawEvent.occurredAt`, а не по `IdeaBlock.createdAt`. Переписать `detectionSql` и `blocksSql` соответственно.
- **Acceptance:** стенд-сценарий с реальным мержем в предсуществующий canonical (неделю назад) + свежий evidence сегодня → задача попадает в окно, TaskSolution обновляется.

### C2. Стаб-эмбеддер в harness → доказуемость репит-оси (Y4)
- **Дефект:** `embeddingsWritten=0` локально (`embedder.embedQuery` пуст) → `assignRepeatGroup` не гоняется, A5.7 всегда N/A под маской PASS.
- **Контракт:** подать детерминированный стаб-эмбеддер (вектор по тексту) в стенд-harness → `embeddingsWritten>0`. Сделать `>0` обязательным для A5.7; `embeddings=0` при наличии репит-сценариев → жёсткий FAIL/блок прогона, не тихий N/A (`match.ts:94`).
- **Acceptance:** A5.7 (`a5-repeat-candidate-instruction` + 2 праймера 429) → `candidateInstruction=true`, `repeatGroupKey!=null`, вердикт PASS (не N/A).

### C3. `signalTypeHint` на все блоки ответа (Y12)
- **Дефект:** `applySignalTypeHint` (`block-ingest.worker.ts:955`) мутирует только `overridden[0]` → многошаговый ответ теряет шаги 2+.
- **Контракт:** применять хинт ко ВСЕМ блокам одного `notification_response`, либо помечать все блоки ответа как how-solved при наличии хинта.
- **Acceptance:** многоблочный ответ на method-capture → все блоки how-solved, сумма символов проходит гейт.

---

## Блок D — Субъекты и качество текста (Y10 + Y11 + Y13 + Y5)

### D1. Context в резолв со-решателя (Y10)
- **Дефект:** `resolveSubjects:406` зовёт `resolvePersonByHint(tenantId, name)` БЕЗ context → арбитр (`entity-resolution.service.ts:857`, требует `&&context`) не запускается, при тёзках со-исполнитель молча выпадает.
- **Контракт:** передавать дизамбигуирующий `context` (title задачи + текст блока) в `resolvePersonByHint`; отброшенного со-решателя логировать/аудитить.
- **Acceptance:** сценарий с двумя людьми-тёзками, где текст однозначно указывает на одного → правильный в subjects.

### D2. Отдельный компилятор-промпт для task_solution (Y11)
- **Дефект:** генерик `structured-document-compiler.prompt.ts` навязывает решению чужой жанр: принудительный §4 «Что важно на будущее» (`:176`) + роль-плейсхолдеры (`:166`, «Иван [требует уточнения: роль]»). ~21 плейсхолдер на 9 документов.
- **Контракт:** развести task_solution с генерик-компилятором — свой промпт БЕЗ правила роль-аннотации (solver=владелец, роль-плейсхолдер — шум) и с необязательным §4 (нет граблей — раздел опускать, не заполнять плейсхолдером). НЕ трогать общий компилятор (регресс осей регламентов A1–A3).
- **Acceptance:** T-метрика (D4) на решениях: доля строк-плейсхолдеров падает; §4 отсутствует, когда нет содержания.

### D3. Семантический гейт и на дополнении (Y13)
- **Дефект:** `service.ts:237` (`&& !existing`) — отписка поверх существующего решения проходит в extension (версия++, пустое дополнение).
- **Контракт:** применять `hasConcreteMethod` и на extension: блоки без метода не мержить/не потреблять (skip). Согласовать с R4-фиксом цикла 2 (defer при недоступном компиляторе) — не конфликтовать.
- **Acceptance:** сценарий «отписка поверх решения» → Δверсии=0, блоки не потреблены.

### D4. T-ось: метрика качества текста в стенде (Y5)
- **Дефект:** качество `solutionMd` не меряется; `gistCaptured=true` маскирует «[требует уточнения]».
- **Контракт:** детерминированная T-метрика в `report.md` отдельной осью — доля строк-плейсхолдеров «[требует уточнения]», доля пустых разделов. Порог — крутилка `taskSolution.maxPlaceholderRatio`. Пробросить `compiled.signals` в `ObservedTaskSolution` как дешёвый прокси тонкости (сейчас выбрасываются, `service.ts:277`).
- **Acceptance:** T-ось видна в скоркарте; регресс текста (рост плейсхолдеров) роняет метрику.

---

## Блок E — Судейская панель + e2e-режим стенда (Y7 + разблокировка провабельности)

### E1. Устойчивость судейской панели (Y7)
- **Дефект:** `judge.ts:80-107` parse-error → голос отброшен; ничья 2 голосов → 'good' первым по перебору; битый JSON тихо ужимает кворум.
- **Контракт:** retry/repair при parse-fail (1–2 повтора) или выше `maxTokens`; при ничье good/flawed — тянуть 3-й голос или возвращать `no-quorum` (не дефолт 'good'); в `report` помечать сценарии с потерянными голосами.
- **Acceptance:** искусственно битый ответ → голос восстановлен или сценарий явно помечен, не проглочен как good.

### E2. E2e-режим стенда: сырой текст → A1-классификация → привязка → A5
- **Зачем:** сейчас стенд доказывает билдер при ИДЕАЛЬНОМ входе (`seed-reg-feed.ts:249` проставляет `signalType` из корпуса; `:221` хардкодит `contextCardId`). A1 не гоняется, канал косметичен. Это блокирует доказуемость R1/R6/R7.
- **Контракт:** новый режим harness, который прогоняет `block-ingest` на СЫРЫХ репликах (без готового signalType и без хардкод-`contextCardId`), чтобы измерять реальный конвейер: классификация → issue-resolution → детекция → материализация.
- **Acceptance:** e2e-прогон воспроизводит захват из встречи/чата (доказательство A1), рецидив через мерж (доказательство C1), ретро-описание через `task_completed` (доказательство A2).

---

## Крутилки и флаги (сводка — все в реестр + сид + feature-flags)

| Ключ | Тип | Дефолт | Блок |
|---|---|---|---|
| `taskSolution.howSolvedSignalTypes` | крутилка (массив) | текущие 4 | A2 |
| `taskSolution.ownerInferenceEnabled` | kill-switch | ON | B2 |
| `taskSolution.maxPlaceholderRatio` | крутилка (0..1) | TBD | D4 |

Каждая: `admin-setting-schema-registry.ts` + `seed-admin-setting-task-solution.ts` + строка в `docs/operations/feature-flags.md` + UI-поле. Новый сид/миграция → `apply-prod-deploy.ts` STEPS + `prod-deploy-log.md`.

## Prod-операции (по итогам реализации)
- Миграция БД, если менялась схема (например, аудит-поле расхождения владельца в B2) → Шаг 4.
- Изменения `detectionSql`/`blocksSql` (C1) — прод-код, миграции не требуют; smoke: детекция ловит рецидив.
- Новые крутилки/флаги → Шаг 1 + `feature-flags.md`.
- Обновить `seed-admin-setting-task-solution.ts` STEPS-регистрацию.

## Acceptance (сводный)
- [ ] R1: решение из встречи/чата без `contextCardId`, привязанное к Issue, → материализуется (e2e).
- [ ] R2: задача без assignee + один решатель → owner=решатель; двое → skippedNoOwner.
- [ ] R3: assignee≠решатель (один) → owner=решатель (под kill-switch).
- [ ] R6: рецидив в старый canonical (мерж, свежий evidence) → попадает в окно.
- [ ] R7: ретро-описание (`task_completed`, привязано к Issue) → доходит до материализатора.
- [ ] Y8: переназначение задним числом не переписывает владельца; subjects — union.
- [ ] Y9: несколько assignee → детерминированный владелец.
- [ ] Y10: со-решатель-тёзка резолвится с context.
- [ ] Y11/Y5: T-ось — доля плейсхолдеров падает после отдельного промпта.
- [ ] Y13: отписка на дополнении → Δверсии=0.
- [ ] Y4: A5.7 доказуема (стаб-эмбеддер, не N/A).
- [ ] Y7: судейская панель не глотает потерянные голоса.
- [ ] Все A5-метрики не регрессируют; идемпотентность Δ=0; `typecheck/lint/build/unit` зелёные.

## Ловушки
- Общий `structured-document-compiler` — НЕ добавлять task_solution-поля в его схему (регресс осей A1–A3 регламентов). Развод — отдельным промптом (D2).
- Owner-inference (B2) меняет поведение атрибуции — за kill-switch, с доказательством на adversarial-сценариях (B5) ДО выката.
- Стенд с хардкод-входом (`contextCardId`, готовый signalType) даёт ложную зелень для R1/R7 — их доказывать ТОЛЬКО e2e-режимом (E2), иначе фикс «доказан» на фикстуре.
- Изменение окна детекции (C1) не должно расширить выборку так, чтобы тянуть старые уже-материализованные задачи (проверить `skippedNoNew`-путь).

## Итог
**Черновик.** Блок A требует `plans/architecture/task-solution-capture-scope.md` (approved владельцем) до кода.
Блоки B–E — contained, реализуемы по этому ТЗ. Рекомендуемый порядок: E → B → C → A → D. Каждый блок —
в прод включённым, с доказательством на стенде (для R1/R6/R7 — e2e-режим из E2).
