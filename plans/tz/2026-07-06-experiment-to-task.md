---
type: tz
status: ready-to-implement
feature: experiment-to-task
date: 2026-07-06
owner: sergrv80
relates_to:
  - plans/architecture/2026-07-06-experiment-to-task.md
  - plans/architecture/2026-07-06-probe-signal-bridges-close-gaps.md
  - plans/tz/2026-06-27-task-decision-execution-unified-tz.md
  - plans/tz/2026-06-29-commitment-social-layer-cleanup.md
---
> Архитектура (одобрена владельцем): `plans/architecture/2026-07-06-experiment-to-task.md` (status: approved, 2026-07-06) · Прецеденты: `plans/tz/2026-06-27-task-decision-execution-unified-tz.md` (решение→задача), `plans/tz/2026-06-29-commitment-social-layer-cleanup.md` (обещание→задача) · Статус согласования: 2026-07-06

# ТЗ — Эксперимент → задача (действие из эксперимента доезжает до трекера)

## Цель + Зачем

Когда в разговоре звучит эксперимент с **конкретным действием** («давайте проверим гипотезу: настроим A/B-тест заголовка, замерим конверсию за неделю») — actionable-часть должна попасть в трекер как задача, а сам эксперимент — остаться фактом памяти как есть. Сегодня действие теряется: эксперимент уходит только в «журнал экспериментов» (специалист `3-9-experiments`), а агенты-извлекатели задач эксперимент задачей не считают.

Это третий случай уже решённого класса «знание + исполнение как два слоя»: решение→задача ([[2026-06-27-task-decision-execution-unified-tz]], В3 «actionable всегда → задача, авто, через дедуп») и обещание→задача ([[2026-06-29-commitment-social-layer-cleanup]]). Владелец зафиксировал решение делать это отдельным кодом ([[2026-07-06-probe-signal-bridges-close-gaps]], «Решения владельца», п.1). Болезненное состояние: сотрудник выходит из встречи с «договорились попробовать», но в трекере пусто — проверку гипотезы никто не запускает.

## REALITY-CHECK (по коду на 2026-07-06, сверено через Read)

**Уже работает (переиспользуем, НЕ трогаем):**
- **Сущность `Experiment` и её агент** — специалист `3-9-experiments` (`EXPERIMENT_TRACKER`), файлы `knowledge-core/services/specialist-3-9-experiments.service.ts`, `workers/experiment-detector.worker.ts`, промпт `prompts/experiment-extract.prompt.ts`. Роутер шлёт `signalType ∈ {hypothesis, result, lesson}` → `EXPERIMENT_TRACKER` (`router.service.ts:348-357`). **Остаётся как есть.**
- **Мост «извлечённое действие → карточка трекера»** уже готов и им пользуются решения/обещания: `IntakeIssue` → `IntakeAutoTriageWorker` (`tracker/workers/intake-auto-triage.worker.ts`) → `IssuesService.create` (`issues.service.ts:134`). Дедуп, резолв исполнителя/срока, провенанс — из коробки.
- **Провенанс «задача ← знание»** уже реализован для решений: модель `DecisionTaskLink` (`schema.prisma:7737`), утилита `linkDerivedDecisionsForIssue` (`tracker/services/decision-task-link.util.ts`), вызов в `intake-auto-triage.worker.ts:540`. Связь авто-деривится по пересечению `IntakeIssue.sourceBlockIds` с `Decision.sourceBlockIds`. **Эксперимент зеркалит этот механизм.**
- **Встречи — единый combined-экстрактор** `knowledge-core/prompts/specialists-combined.prompt.ts` за один проход извлекает `experiments[]` (`:578`) И `tasks[]` (`:620-624`, правило «твёрдое обещание-как-задача → tasks[]», само-назначение). Видит все блоки разговора сразу; per-block `signalType`-роутинг для встреч не применяется. **Это первичная поверхность (MVP meetings-first).**
- **Классификатор входа** `knowledge-core/prompts/block-ingest.prompt.ts` присваивает блоку `signalType`; уже умеет дуальную эмиссию «предложение + поручение → idea И commitment/action_item» (`:445, :472`). Реестр пар idea/decision/task — `prompts/task-decision-examples.ts`.

**Сломано / дрейф (важно для нарезки):**
- **`specialist-3-15-tasks.service.ts` (блочный извлекатель задач через `task-extract.prompt.ts`) — `processBlock` НИКТО не вызывает.** Единственный живой вход — `runClarifySweep` (`:705`, follow-up на уже созданные `IntakeIssue` про недостающего исполнителя/срок, cron `task-clarify-sweep.cron.ts`). В диспетчере специалистов (`specialist-routing-dispatcher.worker.ts:87-99`) `3-15` НЕ зарегистрирован; в `router.service.ts` НЕТ ни `case 'action_item'`, ни `SPECIALIST.TASKS`. Вывод: **отдельного live-пути «блок → задача» вне встреч сейчас нет через 3-15.** `task-extract.prompt.ts` — де-факто спящий, но `taskType 'task-extract'` зарегистрирован в реестре (`llm-router.service.ts`). Ссылка в signal-bridges (п.1) на «чат через 3-15» — **устарела**, не полагаться.
- Значит для **не-встречных источников** робастный, путь-агностичный рычаг — **классификатор `block-ingest`**: если блок-эксперимент несёт action_item, любой будущий/текущий потребитель `action_item` его подхватит; а сегодня — как минимум блок корректно классифицируется.

**Вне scope (есть свой дом):** баг «эксперимент с результатом без урока навсегда застревает в `running`» (`experiment-status-resolver.cron.ts:126`, правило watcher `proactive-watcher.service.ts:220`) — закрывается в [[2026-07-06-probe-signal-bridges-close-gaps]] (п.3). Здесь НЕ трогаем.

## Принятые решения владельца (одобрено в архитектуре, не пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| В1 | `Experiment` и специалист 3-9 не трогаем; задача идёт ВДОБАВОК, не вместо | Прецедент decision/commitment: память = источник правды, задача = исполнение (два слоя) |
| В2 | Задачу заводим ТОЛЬКО при конкретном действии («сделать/запустить/замерить Y»), даже если исполнитель не назван (тогда без исполнителя). Абстрактное «надо больше экспериментировать» → задачи нет | Blueprint Р1, подтверждено владельцем в чате 2026-07-06; зеркало decision-В8 (стратегию/«не делать» в задачу не заводим) |
| В3 | Работаем на обеих поверхностях: встречи (`specialists-combined`) + не-встречный вход (`block-ingest` дуальная эмиссия) | Blueprint Р3; иначе половина каналов молчит |
| В4 | Провенанс задача↔эксперимент — зеркало `DecisionTaskLink` (новая тонкая link-таблица `ExperimentTaskLink`, `linkType='derived'`, авто-дерив по пересечению `sourceBlockIds`) | Blueprint Р5 «как у решений»; переиспользуем точный паттерн, а не новый подсистемный журнал |
| В5 | Баг «застревание в `running`» — вне этой фичи | Blueprint «Границы»; дом — signal-bridges п.3 |

## Доказательство выбора (два прохода + challenge-loop)

**Проход A (выбран) — на уровне промптов-извлекателей + зеркало провенанса.** Учим `specialists-combined` (встречи) и `block-ingest` (вход) видеть «эксперимент с действием» как ещё и задачу; провенанс — мирроринг `DecisionTaskLink`.

**Проход B (отвергнут) — отдельный worker** «читает созданный `Experiment` → порождает задачу из его действия». Ось различия: точка интеграции (пост-обработка сущности vs извлечение) + синхронность (новый async-проход vs inline).

| Критерий | A (промпты) | B (worker) |
|---|---|---|
| Консистентность с decision/commitment (оба — на уровне промптов) | ✓ | ✗ рассинхрон паттерна |
| Второй LLM-проход | ✗ не нужен | ✓ лишняя стоимость/задержка |
| Дедуп задач | ✓ бесплатно через `IntakeIssue`/`TaskDedupService` | ✗ риск дубля (worker + любой промпт, поймавший то же) |
| Покрытие обоих каналов | ✓ (встречи + вход) | △ только пост-фактум по сущности |
| Провенанс | ✓ общий `sourceBlockIds` → link | △ надо тянуть отдельно |

**Challenge-loop по A:** (1) корень, не симптом — да, учим КЛАСС «любой эксперимент-с-действием», оба канала; (2) эффективность — да, ноль новых LLM-проходов, переиспользуем intake+dedup+link; (3) код ради кода — нет, единственный новый артефакт (link-таблица) — мирроринг существующего, спящий `task-extract.prompt.ts` не оживляем.

## Scope

**Входит:** усиление `specialists-combined.prompt.ts` (встречи) и `block-ingest.prompt.ts` (вход) под «эксперимент-с-действием → задача»; новая модель `ExperimentTaskLink` + утилита авто-линковки + её вызов в `intake-auto-triage`; golden-фикстуры обоих промптов (позитив + негатив); метрика извлечённых задач-из-эксперимента; синхронизация методологии промптов в `docs/`.

**Не входит:** правки `Experiment`/специалиста 3-9 (В1); баг «running-застревание» (В5, дом — signal-bridges); оживление `specialist-3-15-tasks`/`task-extract.prompt.ts` (спящий путь не в scope — если позже понадобится блочный live-извлекатель, отдельное ТЗ); UI-рендер чипа «🔬 из эксперимента» на фронте (бэкенд отдаёт связь; отрисовка — vNext, отдельный FE-тикет при необходимости).

## Границы контракта с другими ТЗ
- **signal-bridges** ([[2026-07-06-probe-signal-bridges-close-gaps]]) владеет статус-резолвером эксперимента и watcher-уведомлениями — здесь их НЕ реализуем и НЕ мокаем, просто не касаемся.
- Механизм `IntakeIssue → auto-triage → IssuesService.create` и `TaskDedupService` — используем как есть, реализован в tracker; не переписываем.

## Границы фичи
- ✅ **Always:** менять только перечисленные промпты + добавлять link-модель/утилиту/вызов + фикстуры/метрику; system-часть промптов держать стабильной (prompt caching, ниже).
- ⚠️ **Ask first:** любое изменение полей `Experiment`, `IntakeIssue`, `Issue`; любой новый `signalType`; изменение порога В2 (что считаем «действием»).
- 🚫 **Never:** трогать специалист 3-9 / `experiment-extract.prompt.ts`; чинить здесь «running-застревание»; оживлять `specialist-3-15-tasks`; вводить feature-flag «на всякий случай».

## Совместимость с prompt caching
Все правки — в **статическую SYSTEM-часть** промптов (`specialists-combined.prompt.ts`, `block-ingest.prompt.ts`): добавляемые правила/примеры идут в неизменяемый префикс, переменные данные разговора остаются в конце user-сообщения. Кэш-префикс не ломается. Новых per-request вставок в system нет.

---

## Фазы

> Порядок: Ф1 и Ф2 независимы (разные файлы-промпты) — можно параллелить. Ф3 (схема+провенанс) независим от промптов, но по смыслу «показывает» результат — идёт после. Ф4 (фикстуры/метрика/приёмка) — последней, проверяет Ф1–Ф3. После КАЖДОЙ фазы `bun run typecheck && bun run lint && bun run build` зелёные. **`path:line` — на момент написания; перед правкой перечитать по якорю-символу.**

### Ф1 — Мост на встречах: `specialists-combined` учит «эксперимент-с-действием → tasks[]»
**Ценность:** как руководитель, после планёрки вижу в трекере задачу по запущенному эксперименту (а не только запись в памяти), поэтому проверка гипотезы не теряется.
**Цель:** combined-экстрактор встреч при разборе эксперимента, содержащего конкретное действие к исполнению, кладёт это действие ещё и в `tasks[]` (эксперимент в `experiments[]` — как раньше).
**Файлы:** `backend/src/modules/knowledge-core/prompts/specialists-combined.prompt.ts` (якорь: строка правила `- поручение, задача с исполнителем / твёрдое обещание-как-задача … → tasks[]`, ~`:620`; блок `tasks[] — поручения и обещания, ставшие задачами:`, ~`:620-624`; строка про `experiments[]`, ~`:578`).
**Что входит:**
- В строку-роутер сущностей (рядом с «твёрдое обещание-как-задача → tasks[]») добавить: `эксперимент с конкретным действием к исполнению («проведём эксперимент: сделаем/настроим/запустим/замерим Y») → И experiments[] (гипотеза/результат/урок), И tasks[] (само действие Y)`.
- В блок `tasks[] …` добавить правило В2: конкретное действие внутри эксперимента = задача; **абстрактное** «надо больше экспериментировать / давайте поэкспериментируем с ценами» без действия — НЕ задача (эксперимент как гипотеза при этом может остаться). Исполнитель не назван → `assignee=null`.
- Один позитивный пример (эксперимент+действие → одна запись `experiments[]` + одна `tasks[]`) и один негативный (абстрактный эксперимент → только `experiments[]`, `tasks[]` пуст) — в стиле существующих «ПЛОХО → ХОРОШО».
**Что НЕ входит:** правки схемы `experiments[]`/`tasks[]` JSON (структура полей не меняется); блочный вход (Ф2).
**Acceptance:**
- `grep -n "эксперимент с конкретным действием" specialists-combined.prompt.ts` → есть строка-роутер.
- `grep -n "поэкспериментировать\|больше экспериментировать" specialists-combined.prompt.ts` → есть негативная граница.
- Snapshot-тест промпта (соседний `specialists-combined.prompt.spec.ts`) обновлён и зелёный: `bunx vitest run src/modules/knowledge-core/prompts/specialists-combined.prompt.spec.ts`.
- Golden-фикстура (Ф4) на встречу «A/B-тест заголовка, Пётр настроит, неделя» → в разборе присутствуют и `experiments[].name`, и `tasks[].title` с `assignee='Пётр'`.
**Закрывает:** R1, R2, R6.

### Ф2 — Классификатор входа: `block-ingest` дуальная эмиссия «эксперимент → hypothesis + action_item»
**Ценность:** как сотрудник, пишущий в чат «предлагаю эксперимент — обзвоним 50 клиентов», получаю задачу в трекере (не только запись в памяти), поэтому договорённость не растворяется вне встреч.
**Цель:** на входе блок-эксперимент с конкретным действием классифицируется дуально — `hypothesis` (для памяти/специалиста 3-9) И `action_item` (для конвейера задач), по образцу уже существующего «idea + поручение».
**Файлы:** `backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts` (якорь: `ПРЕДЛОЖЕНИЕ + ПОРУЧЕНИЕ ≠ ОДНО РЕШЕНИЕ`, ~`:445`; пункт 7 про `action_item`, ~`:354`; п.8, ~`:472`). Реестр примеров — `prompts/task-decision-examples.ts` (при необходимости добавить пару-иллюстрацию, функция `renderRuleForBlockIngest`, `:87`).
**Что входит:**
- Добавить правило-близнец к «предложение+поручение»: `ЭКСПЕРИМЕНТ + ДЕЙСТВИЕ: «давайте проведём эксперимент — сделаем/замерим Y» → извлеки И hypothesis (гипотеза для памяти), И action_item (действие Y для трекера). Абстрактный призыв экспериментировать без действия → hypothesis низкой уверенности или пропуск, action_item НЕ заводить.` (В2).
- Убедиться, что дуальная эмиссия допустима существующей схемой block-ingest (несколько блоков/сигналов из одного окна уже поддержаны — как idea+commitment).
**Что НЕ входит:** изменение `router.service.ts` (маршрут `hypothesis→EXPERIMENT_TRACKER` и `action_item` остаётся как есть; никакого нового `SPECIALIST.TASKS`); оживление `specialist-3-15-tasks`.
**Acceptance:**
- `grep -n "ЭКСПЕРИМЕНТ + ДЕЙСТВИЕ\|проведём эксперимент" block-ingest.prompt.ts` → правило есть.
- Snapshot/спека block-ingest (если есть) зелёная; typecheck/lint/build зелёные.
- Golden-фикстура (Ф4): чат-реплика «предлагаю эксперимент — обзвоним 50 клиентов» → извлекаются два блока: `signalType=hypothesis` И `signalType=action_item` с текстом действия; реплика «надо больше экспериментировать» → `action_item` НЕ появляется.
**Закрывает:** R3, R4, R6.

### Ф3 — Провенанс: `ExperimentTaskLink` (зеркало `DecisionTaskLink`) + авто-линковка
**Ценность:** как руководитель, вижу у задачи пометку «🔬 из эксперимента …» (бэкенд отдаёт связь), поэтому понимаю, что задача — проверка гипотезы, а не разовое поручение.
**Цель:** при авто-приёме задачи из блоков, пересекающихся с `Experiment.sourceBlockIds`, создаётся `ExperimentTaskLink(linkType='derived')` — точный аналог `DecisionTaskLink`.
**Файлы:**
- `backend/prisma/schema.prisma` — новая модель (мирроринг `:7737`):
```prisma
model ExperimentTaskLink {
  id           String   @id @default(cuid())
  experimentId String
  issueId      String
  linkType     String   @default("derived") @db.VarChar(24)
  createdAt    DateTime @default(now())

  experiment Experiment @relation("ExperimentTaskLinkExperiment", fields: [experimentId], references: [id], onDelete: Cascade)
  issue      Issue      @relation("ExperimentTaskLinkIssue", fields: [issueId], references: [id], onDelete: Cascade)

  @@unique([experimentId, issueId])
  @@index([issueId])
  @@map("experiment_task_link")
}
```
  + back-relations: в `model Experiment` — `taskLinks ExperimentTaskLink[] @relation("ExperimentTaskLinkExperiment")`; в `model Issue` — `experimentLinks ExperimentTaskLink[] @relation("ExperimentTaskLinkIssue")`.
- `backend/src/modules/tracker/services/experiment-task-link.util.ts` — новый файл, зеркало `decision-task-link.util.ts:1-45`: `linkDerivedExperimentsForIssue(prisma, {tenantId, issueId, sourceBlockIds})` — `prisma.experiment.findMany({where:{tenantId, sourceBlockIds:{hasSome:blockIds}}})` → `prisma.experimentTaskLink.createMany({..., skipDuplicates:true})`. **Без** обновления счётчика `linkedTaskCount` (у `Experiment` его нет — не добавлять, вне scope).
- `backend/src/modules/tracker/workers/intake-auto-triage.worker.ts` (~`:540`) — рядом с вызовом `linkDerivedDecisionsForIssue` добавить best-effort `linkDerivedExperimentsForIssue` с тем же `try/catch` и debug-логом.
**Что входит:** миграция, утилита, вызов. **Что НЕ входит:** FE-рендер чипа; счётчик задач на `Experiment`; ручное линкование (`linkType` оставляем расширяемым строкой, как у решений).
**Acceptance:**
- Миграция создана и применяется локально: файл в `prisma/migrations/*_add_experiment_task_link/migration.sql`, **первой строкой** `SET search_path TO public;` (грабля AGE search_path — [[project_prisma-migration-age-searchpath]]); применить `bun run prisma:migrate deploy` (не `migrate dev` — shadow `0_init`); `bun run prisma:generate`.
- `bunx vitest run` на новой спеке `experiment-task-link.util.spec.ts`: два `Experiment` с общим `sourceBlockId` + `IntakeIssue` с тем же блоком → после триажа есть `ExperimentTaskLink(derived)`; повторный прогон — no-op (`skipDuplicates`, идемпотентность).
- `grep -n "linkDerivedExperimentsForIssue" intake-auto-triage.worker.ts` → вызов есть.
- typecheck/lint/build зелёные.
**Закрывает:** R5, R7.

### Ф4 — Golden-фикстуры (позитив+негатив) + метрика + приёмка
**Ценность:** как инженер конвейера извлечения, получаю защиту от регрессии «эксперимент-с-действием перестал давать задачу» и наблюдаемость объёма, поэтому фича не деградирует молча.
**Цель:** закрепить поведение обоих промптов golden-тестами и считать метрику.
**Файлы:** golden-фикстуры рядом с существующими snapshot-спеками (`specialists-combined.prompt.spec.ts`, block-ingest спека); метрика — `common/metrics/business-metrics.service.ts` (новый счётчик, напр. `incExperimentTaskExtracted({tenantTop, surface: 'meeting'|'ingest'})`), инкремент — в местах, где действие эксперимента уходит в `tasks[]`/`action_item` (или на создании `ExperimentTaskLink`).
**Что входит:** позитивные и **негативные** фикстуры (абстрактный эксперимент → нет задачи) для встреч и входа; prom-счётчик; регистрация метрики в `/metrics`.
**Что НЕ входит:** нагрузочные/eval-прогоны; изменение порогов confidence.
**Acceptance:**
- `bunx vitest run` по обеим спекам зелёный; негативные кейсы дают пустой `tasks[]`/отсутствие `action_item`.
- `grep -n "ExperimentTaskExtracted\|experiment_task" business-metrics.service.ts` → метрика есть; `bun run build` зелёный.
- Ручная проверка (dev, реальный LLM — [[project_local-toolchain]]): прогнать разбор двух реплик (эксперимент-с-действием и абстрактный) через существующую точку разбора → в первом задача создаётся, во втором нет.
**Закрывает:** R6, R8.

## Требования (EARS, трассируемые)
- **R1** — Когда разбирается встреча, содержащая эксперимент с конкретным действием к исполнению, система shall извлечь И запись в `experiments[]`, И задачу в `tasks[]` за один проход.
- **R2** — Если исполнитель действия не назван, then задача создаётся с `assignee=null` (не угадывать).
- **R3** — Когда не-встречный вход содержит эксперимент с действием, система shall классифицировать блок дуально: `hypothesis` И `action_item`.
- **R4** — Если реплика про эксперимент не содержит конкретного действия («надо больше экспериментировать»), then `action_item`/`tasks[]` НЕ создаётся (В2).
- **R5** — Когда задача авто-принимается из блоков, пересекающихся с `Experiment.sourceBlockIds`, система shall создать `ExperimentTaskLink(linkType='derived')`, идемпотентно.
- **R6** — Система shall сохранить неизменным поведение специалиста 3-9 и структуру `experiments[]` (эксперимент как факт памяти — В1).
- **R7** — Если тот же блок уже породил линк, then повторная авто-линковка — no-op (`skipDuplicates`).
- **R8** — Система shall инкрементировать метрику извлечённых задач-из-эксперимента с разбивкой по поверхности.

## Pre-mortem / Риски
- **Дубль задач** (встреча дала `tasks[]` И вход дал `action_item` по тому же событию): снимается существующим `TaskDedupService`/`IntakeIssue`-дедупом (тот же механизм у решений/обещаний) — не переизобретать; в приёмке Ф4 проверить, что близнец не плодит вторую задачу.
- **Ложные срабатывания** (абстрактный эксперимент → лишняя задача): негативные golden-фикстуры Ф4 + правило В2 в обоих промптах; порог confidence существующего конвейера не трогаем.
- **Prompt caching**: правки только в статический префикс (см. раздел) — проверить, что переменная часть не сдвинулась.
- **AGE search_path** при миграции новой таблицы: `SET search_path TO public;` первой строкой, `migrate deploy` вместо `migrate dev` ([[project_prisma-migration-age-searchpath]]).
- **Ревью-аспекты для `strict-production-review-gate`:** tenant-изоляция линковки (`Experiment.findMany` строго по `tenantId`); best-effort провенанс не роняет триаж (try/catch как у решений); идемпотентность миграции и утилиты.

## Сквозные аспекты
- **RBAC/tenant:** `linkDerivedExperimentsForIssue` фильтрует `Experiment` по `tenantId` (зеркало решения) — обязательно. `@@index([issueId])` есть; запросы эксперимента уже tenant-scoped.
- **Observability:** новый prom-счётчик (Ф4) + debug-лог линковки (как у `DecisionTaskLink`).
- **Errors/идемпотентность:** провенанс best-effort (try/catch); `createMany({skipDuplicates:true})` + `@@unique` → повторный прогон no-op.
- **Миграция данных:** backfill исторических эксперимент↔задача связей **не требуется** — фича работает вперёд по потоку; `[N/A: ретро-линковка старых задач вне scope, при желании — отдельный backfill-скрипт vNext]`.
- **Rollout/флаг:** Ship-On, **без нового флага** — это улучшение уже включённого конвейера извлечения (kill-switch не нужен: фича не необратима и не тратит деньги владельца). `[N/A: флаг]`.
- **Тесты:** golden-фикстуры обоих промптов (позитив+негатив) + unit на утилиту линковки (Ф3/Ф4).

## Idempotency / prod-deploy
- **Миграция** `*_add_experiment_task_link` → **`docs/operations/prod-deploy-log.md` Шаг 4** (новая модель). Применяется авто на `docker compose up` через `prisma migrate deploy`.
- Новых `seed-*/patch-*/backfill-*/migrate-*` скриптов НЕТ → регистрация в `apply-prod-deploy.ts STEPS` не требуется.
- Промпты — code-fallback в реестре; admin-editable копии при наличии не перетирать ([[safe-seed-rules]]); методологию промптов синхронизировать в `docs/methodology/prompts/` (DoD).
- Новая метрика → smoke `/metrics` (Шаг 12).

## DoD
- `bun run typecheck` (вкл. `.spec`) · `bun run lint` · `bun run build` — зелёные.
- `bunx vitest run` по затронутым спекам зелёный (позитив+негатив).
- `second-brain/` обновлён по таблице производных заметок: `01_projects/ai-jobs.md` (эксперимент→задача как поведение извлечения), `02_architecture/data-model.md` (модель `ExperimentTaskLink`), при необходимости `01_projects/tracker*`/`knowledge-core.md`.
- `docs/operations/prod-deploy-log.md` Шаг 4 обновлён; `docs/methodology/prompts/` синхронизирован.
- Рефлексия в `second-brain/05_история/`.

## Итог
_(заполняет tz-orchestrator по завершении: что реализовано целиком, что осталось.)_
