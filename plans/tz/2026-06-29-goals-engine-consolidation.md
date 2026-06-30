---
type: tz
status: ready-to-implement
feature: goals-engine-consolidation
date: 2026-06-29
owner: Сергей (владелец продукта)
relates_to:
  - plans/architecture/2026-06-29-goals-engine-consolidation.md
  - plans/analysis/2026-06-29-goals-engine-consolidation.md
  - plans/architecture/2026-06-29-commitment-task-unification.md
  - plans/tz/2026-06-29-commitment-social-layer-cleanup.md
  - second-brain/01_projects/goals-and-strategic-alignment.md
---
> Архитектура (одобрена владельцем 2026-06-30): `plans/architecture/2026-06-29-goals-engine-consolidation.md` · Анализ: `plans/analysis/2026-06-29-goals-engine-consolidation.md` · Статус согласования: одобрено, 3 развилки закрыты.

# ТЗ — Движок целей: консолидация и оптимизация

**Принцип:** оптимизируем и наводим порядок, НЕ удаляем функциональность (решение владельца). Каждая фаза — самодостаточный слайс для одного суб-агента. **Время — `Europe/Moscow`. Крутилки — в `AdminSetting` (CLAUDE.md п.9). Ship-On (CLAUDE.md п.8).**

**Номера строк — на момент написания (картография 2026-06-30). Перед правкой перечитать файл и найти по символу-якорю.** При живом vexp Grep/Glob блокируются — для backend ищи `Bash ls/find + Read`.

---

## REALITY-CHECK (что уже есть/мертво/сломано — по коду)

| Факт | Следствие для ТЗ |
|---|---|
| **Задачное alignment УЖЕ не на компасе.** Компас (`daily-digest.service.ts:705-733`) и директорский DTO (`director-dashboard.service.ts:775-826`) читают графовый `cachedAlignment`/`GoalAlignmentSnapshot`. Задачный `StrategicAlignmentIssuesService` развязан, его эндпоинт `GET /goals/:id/alignment-snapshot` имеет **0 потребителей во фронте**. | O5 — НЕ «разъединить два потока», а **убрать осиротевшие виджеты** + по желанию вывести задачный показатель деталью карточки. Не «удалять то, чего нет». |
| **Вектор людей сломается на typecheck** после дропа `commitmentStatus`: `collectArtefacts` делает `select {commitmentStatus:true}` и фильтр `commitmentStatus:{in:['fulfilled','missed']}` (`goal-vector-tracker.cron.ts:301-331`), `resolveAttributionField:145` читает то же поле. | O6 — **жёсткий порядок**: правится ДО/вместе с дропом колонки в [commitment-social-layer-cleanup](2026-06-29-commitment-social-layer-cleanup.md). См. «Граничные контракты». |
| **Виджеты `StrategicAlignmentWidget.tsx`, `GoalVectorVerdictWidget.tsx`** — 0 импортов (осиротевшие). | O5 — удалить безопасно, проверив DashboardCanvas registry. |
| **`GoalCascadeService` мёртв** — `onChildCompleted`/`onParentMissed` вызываются только в `.spec`. Поля `cascadeMissed*` в схеме есть. | O4 — подключить через доменное событие, не дописывать сервис. |
| **Ручная цель никогда не получает темы** (3 отсечки: cron-фильтр `source:'ai'`, hard-return без `sourceBlockIds`, `no_themes`-skip в alignment). Но `Goal.embedding` у неё считается, HNSW-индексы Goal+Theme есть, KNN-паттерн канонизирован. | O2 — добавить embedding-ветку, не строить новый сервис. |
| **Промпт `goal-extract` — код-константа** (не admin-registry); `goals.minExtractConfidence=0.4` уже крутилка. Snapshot-тест пинит текст промпта. | O1 — правка текста + few-shot + обновить snapshot (`vitest -u`). |
| **Нет ночной пересборки иерархии.** Арбитр `goal-hierarchy-link` зовётся только при рождении AI-цели и в `suggestParentForGoal` (готов к переиспользованию). | O3 — новый cron поверх `suggestParentForGoal`. |
| **Продюсер движения бьёт `0 4 * * *` UTC = 07:00 МСК — ПОСЛЕ сборки компаса** (`0 3 * * *` UTC = 06:00 МСК). | O7+O10 — сдвинуть продюсер ДО 06:00 МСК, всё на `Europe/Moscow`. |
| **Часть крутилок уже вынесена** (`minExtractConfidence`, `autoPromoteConfidence`, `maxActiveGoalsPerHorizon`, `author_coverage_min`, `pulse.*`). ~14 ещё хардкод. | O9 — не дублировать уже вынесенные ключи. |
| **Схема БД не меняется** — `Goal.embedding`, `GoalTheme`, `cascadeMissed*`, HNSW-индексы уже существуют. | Миграций НЕТ. Только seed AdminSetting. |

---

## Принятые решения владельца (не пересматривать)

| # | Решение | Обоснование | Дата |
|---|---|---|---|
| В1 | Цели из разговоров оставляем, промпт ужесточаем | Ядро ценности; чистим качество, не функцию | 2026-06-30 |
| В2 | Ручная цель ведётся как AI (темы/иерархия/движение) | Сейчас дыра; чиним | 2026-06-30 |
| В3 | Спящие пересборку дерева + каскад — включаем | Готовый код, «запустить функцию» | 2026-06-30 |
| В4 | Два числа движения → одно (графовое на компас); задачное — деталь карточки | Одно честное число на компасе | 2026-06-30 |
| В5 | Вектор людей сохраняем, отвязываем от обещаний → задачи/идеи | Дифференциатор; обещания вычищаются | 2026-06-30 |
| В6 | Всё время — Москва; движение считается ДО сборки экрана | Чинит баг «компас показывает вчера» | 2026-06-30 |
| В7 | Один вердикт статуса в UI; «Предложено Корой» сохранить тонким бейджем | `movementVerdict` уже есть | 2026-06-30 |
| В8 | Получасовые линкеры — раз за ночь гарантированно (30-мин догонку днём оставить) | Для ~4 юзеров достаточно; не плодить очередь | 2026-06-30 |

---

## Scope

**Входит:** O1 (промпт строже), O2 (ручные цели как AI), O3 (ночная пересборка иерархии), O4 (подключить каскад), O5 (чистка осиротевшего задачного UI + деталь карточки), O6 (вектор людей без обещаний), O7+O10 (Москва + порядок ночи), O8 (один вердикт UI), O9 (крутилки в AdminSetting).

**Не входит (vNext, строкой в `second-brain/04_не-сделано/README.md`):**
- Реальная связь `Issue↔Goal` для «работы по цели» (O6 оставляет LLM-фильтрацию по тексту) → отдельная фича.
- Вынос cron-**расписаний** в AdminSetting (требует динамики через `SchedulerRegistry`) → отдельное ТЗ; здесь только `timeZone` + сдвиг.
- Немедленный producer тем при создании цели (O2 полагается на cron) → vNext.
- Голосовая постановка цели → отдельный канал ввода.
- Сведение 3 боковых входов создания блоков (commitment-response/poll/support) к нарезщику → отдельное решение владельца.

---

## Граничные контракты с другими ТЗ

- **O6 ↔ [commitment-social-layer-cleanup](2026-06-29-commitment-social-layer-cleanup.md):** та ТЗ дропает колонку `commitmentStatus` (`schema.prisma:3459`). **Ф2 этого ТЗ ОБЯЗАНА быть смержена ДО (или в том же выкате, что и) дроп колонки** — иначе `goal-vector-tracker.cron.ts` не соберётся (`select {commitmentStatus:true}` упадёт). Ф2 безопасно делать заранее: она лишь перестаёт читать поле. **Инвариант: дроп `commitmentStatus` не выкатывается, пока Ф2 не в проде.** Остающиеся поля (`commitmentDueDate/AuthorPersonId/RecipientPersonId`) Ф2 не трогает.
- **Ф2 также гасит крутилку `goals.author_coverage_min`** (становится мёртвой после удаления `resolveAttributionField`) — удалить её строку из реестра/сида (согласовать с config-аудитом).

- **↔ [extraction-layer-rewrite](2026-06-30-extraction-layer-rewrite.md): НЕ конфликтует, извлечение целей архитектурно защищено.** Специалист `3-14-goals` **НЕ входит в `COMBINED_COVERED`** (`router.service.ts:84-98`: «три multi-step специалиста — project-customer, personal-relation, **goals** — резолюция/иерархию делают сверх извлечения, в combined не сворачиваются»); combo извлекает 8 сущностей + tasks, **целей среди них нет**; маршрут `commitment/plan_item → GOALS` (`router.service.ts:426-428`) extraction-ТЗ явно не трогает (его §граничные контракты). Enum `signalType` не меняется (их Б1) → наши O6/триггер целей в силе. Промпт `goal-extract.prompt.ts` (наш O1) ≠ `block-ingest.prompt.ts` (их Ф4) — разные слои, без коллизии файлов.
  - **Синергия:** few-shot реестр типов (их Ф4) и канало-агностичный combo (их Ф2) → чище разметка `commitment/plan_item/idea` → лучше вход goal-extract (O1) и богаче артефакты goal-vector из чата (O6). Их Ф7 (обещание→задача в combo) усиливает O6: сдержанные обещания текут через `issue_closed`.
  - **Координация общих файлов:** наш Ф9 и их Ф1 оба правят `admin-setting-schema-registry.ts` / `typed-config.service.ts` / seed — ключи разные (`goals.*` vs `knowledge.*`), файлы общие → **не редактировать в параллельных ветках одновременно** (последовательно). Наш Ф4 и их регистрации — оба в `ai/workers.module.ts`, разные строки. `router.service.ts` мы **не трогаем** (он делится между extraction-ТЗ и ТЗ задач, не нами).
  - **Форвард-риск (в `04_не-сделано`):** extraction перенёс ЗАДАЧИ внутрь combo (их ВР7). Если позже так же перенесут ЦЕЛИ в combo — наши O1/O2/O3 (отдельный `3-14-goals`) потребуют переноса в combo. Сейчас цели на специалисте — ТЗ в силе.

---

## Требования (R1…R9, трассировка)

- **R1.** Все goal/operations-кроны исполняются в `Europe/Moscow`; продюсер движения цели (`knowledge-core/strategic-alignment.cron`) отрабатывает ДО 06:00 МСК сборки компаса.
- **R2.** `goal-vector-tracker` не обращается к `commitmentStatus`; артефакты — `idea` + `issue_closed` + `goal_work`; backend собирается после дропа `commitmentStatus`.
- **R3.** Цель `source='manual'` получает темы по семантическому KNN (Goal.embedding → Theme.embedding) и расчёт движения (компас её видит).
- **R4.** Раз в сутки иерархия целей пересобирается арбитром; цель с `manualOverride.parentGoalId===true` не трогается; циклы не создаются.
- **R5.** Переход цели в `achieved` → родитель закрывается каскадом (если все siblings achieved); переход в `abandoned` → дети помечаются `cascadeMissed`.
- **R6.** Промпт извлечения отбраковывает рутинные задачи/мусор как `isGoal=false`, сохраняя маленькие настоящие цели-ступеньки.
- **R7.** Осиротевшие alignment-виджеты удалены; задачный показатель доступен деталью карточки цели, не на компасе/дашборде директора.
- **R8.** В UI (список и дерево) показывается один вердикт движения; `GoalStatus`-badge и голый `progressStatus`-чип убраны; «Предложено Корой» — тонкий бейдж.
- **R9.** ~14 захардкоженных порогов/лимитов целей вынесены в AdminSetting (`getDynamic` + реестр + сид); code-fallback = текущее значение; уже вынесенные ключи не дублируются.

---

## Границы фичи (автономия суб-агента)
- ✅ **Always:** `Europe/Moscow` для всех @Cron; `getDynamic` с code-fallback для порогов; `createPrismaClient()` в скриптах; тенант-проверка в каждом запросе; UI только русский, парные токены.
- ⚠️ **Ask first:** любое изменение `schema.prisma` (по REALITY-CHECK не требуется — если возникло, это ошибка scope); удаление публичного эндпоинта/DTO.
- 🚫 **Never:** `process.env.*` мимо `env.schema.ts`; `new PrismaClient()`; `prisma migrate` вручную (миграций тут нет); правка `GoalsService.update` для авто-reparent (затрёт `manualOverride`); OFF-флаги кроме kill-switch.

---

## Граф зависимостей фаз

```
Ф1 (время/порядок) ───┐ независима, headline
Ф2 (вектор/обещания) ─┤ ПЕРЕД дропом commitmentStatus (граничный контракт)
Ф3 (ручные цели) ─────┤
Ф4 (иерархия cron) ───┤ после Ф1 (вписывается в ночное окно)
Ф5 (каскад) ──────────┤
Ф6 (промпт) ──────────┤
Ф7 (чистка UI O5) ────┤ frontend
Ф8 (вердикт UI O8) ───┤ frontend
Ф9 (крутилки O9) ─────┘ ПОСЛЕ Ф2/Ф3/Ф4 (правит те же файлы — избегаем merge-конфликта)
```
Оркестратор идёт последовательно; реальная связность — только Ф9 после Ф2/Ф3/Ф4 и Ф2 перед внешним дропом колонки.

---

## Ф1 — Время по Москве + порядок ночи (O7+O10) `[ ]`

**Ценность:** как руководитель, утром вижу компас, отражающий СЕГОДНЯШНЮЮ ночь (а не вчера), потому что движение цели считается до сборки экрана.

**Цель:** все goal/operations-кроны на `Europe/Moscow`; продюсер движения цели — ДО 06:00 МСК.

**Предусловие (проверить ПЕРВЫМ, acceptance-критерий):** TZ процесса backend в проде. Проверка: `docker compose exec backend printenv TZ` (или `date`). Допущение ТЗ — **процесс в UTC**. Если процесс уже `Europe/Moscow` — текущие `0 6` уже означают МСК; тогда добавление `{ timeZone:'Europe/Moscow' }` ничего не сдвигает (безопасно), но перенос продюсера трактовать как МСК-в-МСК. **Зафиксировать факт TZ в комментарии PR и в `prod-deploy-log`.**

**Что входит:** добавить `{ timeZone: 'Europe/Moscow' }` вторым аргументом к каждому @Cron ниже (эталон — `day-report-collector.cron.ts:25`); перенести продюсер движения.

**Файлы и якоря (было → стало):**
| Файл:строка | Якорь | Было → Стало |
|---|---|---|
| `knowledge-core/workers/strategic-alignment.cron.ts:18` | `@Cron('0 4 * * *')` метод `sweep` | `@Cron('0 2 * * *', { timeZone: 'Europe/Moscow' })` — 02:00 МСК, продюсер ДО компаса |
| `operations/workers/operations-daily-digest.cron.ts:26` | `@Cron('0 3 * * *')` метод `run` | `@Cron('0 6 * * *', { timeZone: 'Europe/Moscow' })` — 06:00 МСК (якорь сборки) |
| `knowledge-core/workers/goal-theme-linker.cron.ts:21` | `EVERY_30_MINUTES` `sweep` | `@Cron(CronExpression.EVERY_30_MINUTES, { timeZone: 'Europe/Moscow' })` (оставить 30-мин, В8) |
| `knowledge-core/workers/goal-task-linker.cron.ts:22` | `EVERY_30_MINUTES` `sweep` | то же |
| `goals/cron/goal-kr-progress.cron.ts:15` | `@Cron('0 5 * * *')` | `@Cron('0 5 * * *', { timeZone: 'Europe/Moscow' })` |
| `goals/cron/strategic-alignment.cron.ts:26` | `@Cron('0 6 * * *')` | `@Cron('0 6 * * *', { timeZone: 'Europe/Moscow' })` |
| `goals/cron/goals-pulse.cron.ts:26` | `@Cron('0 6 * * 1')` | `@Cron('0 6 * * 1', { timeZone: 'Europe/Moscow' })` |
| `dashboard/agents/goal-vector-tracker.cron.ts:35` | `@Cron('0 5 * * 1')` | `@Cron('0 5 * * 1', { timeZone: 'Europe/Moscow' })` |
| `tracker/workers/goal-alignment-low.cron.ts:42` | `@Cron('0 6 * * 1')` | `@Cron('0 6 * * 1', { timeZone: 'Europe/Moscow' })` |

Эталон-синтаксис (`day-report-collector.cron.ts:25`): `@Cron('0 5 * * *', { timeZone: 'Europe/Moscow' })`. Импорт `import { Cron } from '@nestjs/schedule';` уже во всех файлах.

**Решение технической развилки (Б1):** децентрализованный пиннинг + сдвиг продюсера (вариант B картографии), НЕ новый оркестрирующий cron. **Почему:** минимальная правка чинит корневой баг порядка (07:00→02:00 МСК), без кода ожидания дренажа очереди; буфер ~4ч на отработку очереди при ~4 юзерах с запасом; оркестратор оправдан позже, если буфер окажется ненадёжным (строка в не-сделанном).

**Что НЕ входит:** вынос cron-выражений в AdminSetting (нужен `SchedulerRegistry`-динамизм → vNext); смена 30-мин линкеров на ночные (В8 — оставляем догонку днём); реальная синхронная цепочка-оркестратор.

**Acceptance:**
- `grep -rn "timeZone: 'Europe/Moscow'"` по 9 файлам выше → 9 совпадений; `grep -rn "@Cron('0 4 \* \* \*')" backend/src/modules/knowledge-core/workers/strategic-alignment.cron.ts` → 0 (продюсер сдвинут).
- `bun run typecheck && bun run build` зелёные.
- В `prod-deploy-log` Шаг 12 — запись о смене расписаний (наблюдаемое поведение прода меняется).
- Ручная проверка инварианта (документально): продюсер `0 2` < сборка `0 6` в одной TZ.

**Закрывает:** R1.

---

## Ф2 — Вектор людей: отвязать от обещаний (O6) `[ ]`

**Ценность:** как руководитель, продолжаю видеть «кто двигает к цели, а кто мимо» даже после чистки обещаний — сигнал считается по закрытым задачам и идеям, а не по статусам обещаний.

**Цель:** `goal-vector-tracker` не читает `commitmentStatus`; артефакты — `idea` + `issue_closed` + `goal_work`.

**⚠️ Порядок:** мержить ДО дропа `commitmentStatus` (см. «Граничные контракты»).

**Файлы и якоря:**
- `dashboard/agents/goal-vector-tracker.cron.ts`:
  - **Удалить** блок сбора commitment (`:301-331`) — `ideaBlock.findMany` по `signalType:'commitment'` + `commitmentStatus:{in:['fulfilled','missed']}` и цикл `for (const c of commits)` с `kind: 'commitment_kept'|'commitment_broken'`.
  - **Удалить** `resolveAttributionField` (`:135-168`) + его вызов в `runOnce` (`:79-84`) + проброс `attributionField` через `processGoal`/`collectArtefacts` (`:178,257,105,256`) + экспорт `chooseAttributionField` (`:409-411`) + чтение `authorCoverageMin` (`:70-74`) + метрику `setCommitmentAuthorCoverageRatio` (`:157`) + константу `DEFAULT_AUTHOR_COVERAGE_MIN` (`:25`).
  - **Оставить** `idea`-блок (`:261-299`) и `pickAuthor` (`:413-427`) без изменений.
  - **`issue_closed` → `goal_work`:** блок (`:333-379`) оставить логику (Issue по tenant за неделю, исполнители через assignees), но переименовать `kind` на `goal_work` (см. Б2).
- `dashboard/prompts/goal-vector-tracker.prompt.ts`: сузить enum `kind` с 4 значений до **`{idea, issue_closed, goal_work}`** (убрать `commitment_kept`/`commitment_broken`) в: system-prompt (`:4-9,15`), пример (`:26`), JSON-схема enum (`:58`), тип `GoalVectorArtefact.kind` (`:77`), user-message (`:97-98`), тип `GoalVectorPerson.signals[].kind` (`:111`), парсер `parseGoalVectorTrackerResponse` (`:151-154`).
- `goal-vector-tracker.cron.spec.ts` — переписать/удалить тесты `resolveAttributionField`/`chooseAttributionField`/commitment-сбор.

**Решение развилки (Б2):** enum `kind = {idea, issue_closed, goal_work}` (вариант B), НЕ оставлять мёртвые `commitment_*`. **Почему:** CLAUDE.md «без мёртвого кода»; strict json_schema с лишним enum провоцирует LLM галлюцинировать `kind`, которого нет в данных. `issue_closed` (факт закрытия) и `goal_work` (намеренная работа по цели) держим раздельно для честного провенанса.

**Решение развилки (Б3):** «работа по цели» — оставить текущую модель «LLM решает релевантность по тексту цели» (вариант A), без фильтра `Issue↔Goal`. **Почему:** idea тоже не фильтруется по цели — регресса нет; реальная связь `Issue↔Goal` = расширение схемы → vNext.

**Что НЕ входит:** реальная привязка `Issue↔Goal`; правка остающихся полей обещаний; UI-пустое-состояние вектора (тот же риск, что в commitment-cleanup — там и решается).

**Acceptance:**
- `grep -rn "commitmentStatus\|commitment_kept\|commitment_broken\|resolveAttributionField\|author_coverage" backend/src/modules/dashboard/` → 0.
- `bun run typecheck` зелёный при **отсутствующей** колонке `commitmentStatus` (симулировать: убрать select — тест, что не читается). 
- enum схемы промпта = ровно `["idea","issue_closed","goal_work"]` (`grep -n "issue_closed" ...prompt.ts`).
- `bunx vitest run src/modules/dashboard/agents/goal-vector-tracker.cron.spec.ts` зелёный.

**Закрывает:** R2.

---

## Ф3 — Ручные цели ведутся как AI (O2) `[ ]`

**Ценность:** как владелец, проговариваю/завожу цель словами — и к утру Кора подобрала ей темы и считает движение; цель на компасе живая.

**Цель:** ручная цель (`source='manual'`, без `sourceBlockIds`) получает темы по KNN Goal.embedding → Theme.embedding, затем расчёт движения.

**Файлы и якоря:**
- `knowledge-core/services/goal-theme-linker.service.ts`:
  - `:34-35` hard-return при пустом `sourceBlockIds` — **добавить ветку embedding-fallback**: если провенанс/co-mention дали 0 (или `sourceBlockIds` пуст), но у цели есть `embedding` → raw KNN:
    ```sql
    SELECT id FROM "Theme"
    WHERE "tenantId" = $1 AND status = 'active' AND embedding IS NOT NULL
    ORDER BY embedding <=> $2::vector ASC LIMIT $3
    ```
    Вектор цели — `SELECT embedding FROM "Goal" WHERE id=$goalId AND "tenantId"=$1` (CTE-паттерн `issue-goal-suggest.service.ts:99-117`). Дистанция cosine → `weight = clamp(1 - distance, 0, 1)`, отсечь по `minWeight` (`resolveMinWeight:139`) и по порогу `goals.themeAutolinkKnnMaxDistance`. Запись `GoalTheme{source:'ai', weight}`. После `createMany>0` — тот же `enqueueStrategicAlignment` (`:114-118`).
  - Переиспользовать `filterActiveThemes:148`.
- `knowledge-core/workers/goal-theme-linker.cron.ts:61-70`: убрать `source:'ai'` + `sourceBlockIds:{isEmpty:false}`, оставить `themes:{none:{}}`. Отбор пути (provenance vs embedding) — внутри сервиса.
- `common/config/typed-config.service.ts:1149-1163` (`get goals()`): добавить `themeAutolinkKnnMaxDistance` (cosine, fallback `0.45`) и `themeAutolinkKnnTopK` (fallback `5`) через `resolveSync` (паттерн `themeAutolinkMinWeight`).
- **НЕ трогать** `strategic-alignment.worker.ts` — сам отработает при появлении тем (`no_themes`-skip `:148-158` перестанет срабатывать).

**Решение развилки (Б4):** темы ручной цели — KNN по эмбеддингу (вариант A). **Почему:** вектор цели уже считается (`GoalEmbedWorker`), у тем есть `embedding`+HNSW, KNN канонизирован → минимум кода, буквально «вести как AI». ILIKE по 2 словам признан слабым. Ручная привязка (`addThemes`) остаётся вторым путём, не единственным.

**Решение развилки (Б5):** постановка в очередь — полагаться на 30-мин cron (вариант A), не немедленный producer. **Почему:** вектор успеет посчитаться, нет гонки `create→embed→link`, не плодим очередь; немедленность → vNext.

**Новые крутилки (в реестр, Ф9 или здесь):** `goals.themeAutolinkKnnMaxDistance` (UNIT_INTERVAL-подобный, fallback 0.45), `goals.themeAutolinkKnnTopK` (POSITIVE_INT, fallback 5).

**Что НЕ входит:** немедленный producer; ILIKE-путь; правка alignment-воркера.

**Acceptance:**
- Raw KNN использует `embedding <=> $2::vector` и `Number()`-валидацию `LIMIT` (нет интерполяции сырой строки).
- Линкер идемпотентен и no-op при `embedding IS NULL` (тест: ручная цель без вектора → 0 тем, без ошибки).
- Интеграционный тест: ручная цель с `embedding` + активные темы с `embedding` → `GoalTheme` создаётся `source:'ai'`; затем `enqueueStrategicAlignment` вызван (мок `coreQueue`).
- `grep -n "source: 'ai'" backend/src/modules/knowledge-core/workers/goal-theme-linker.cron.ts` в where-выборке → 0 (фильтр снят).

**Закрывает:** R3.

---

## Ф4 — Суточная пересборка иерархии (O3) `[ ]`

**Ценность:** как компонент «ночной мозг целей», раз в сутки выправляю дерево — новые цели встают на место, кривые связи чинятся, ручной родитель неприкосновенен.

**Цель:** новый `GoalHierarchyRebuildCron`, переиспользующий арбитр.

**Файлы:**
- **Новый** `knowledge-core/workers/goal-hierarchy-rebuild.cron.ts` по образцу `goal-task-linker.cron.ts`: inject `PrismaService`, `WorkerOrgGate`, `Specialist314GoalsService`, `RedisService` (lock-паттерн `RolePrincipleSynthesisCron`), `TypedConfigService`. `@Cron('0 3 * * *', { timeZone: 'Europe/Moscow' })` — 03:00 МСК (между линкерами 01:00 и компасом 06:00, после продюсера движения 02:00... **проверить коллизии ночного окна**; свободный слот — 03:00 МСК). `scanAllOrgs`: org `deletedAt:null` + `memberships.some.role∈[owner,admin]`; per-org `gate.checkOrThrow(org.id, WORKER_NAME)`.
- **Новый публичный метод** `Specialist314GoalsService.rebuildParentForGoal({tenantId, goalId})`: обёртка над `suggestParentForGoal` (`:848-906`, уже исключает self+потомков через `collectGoalAndDescendants` и гоняет `hierarchyArbiter`); если `verdict==='child_of'`, предложенный parent ≠ текущему, confidence ≥ порога, и `manualOverride.parentGoalId !== true` → применить reparent **прямым** `prisma.goal.update({where:{id}, data:{parentGoalId}})` (НЕ через `GoalsService.update` — затрёт `manualOverride`), с повтором анти-цикл гарда (`assertNoCycle`-логика из `goals.service.ts:598-631`, вынести в общий хелпер `goal-cycle-guard.util.ts` или продублировать).
- Регистрация: провайдер в `modules/ai/workers.module.ts` рядом с `GoalThemeLinkerCron:162`/`GoalTaskLinkerCron:163` + импорт.
- Kill-switch + knobs: `goals.hierarchyRebuild.enabled` (kill-switch, default true), `goals.hierarchyRebuildMinConfidence` (fallback 0.7), `goals.hierarchyRebuildPerOrgLimit` (fallback 50) — через `getDynamic`.

**Решение развилки (Б6):** отдельный cron (вариант A), не встраивать в линкеры. **Почему:** тяжёлый LLM-проход по дереву — своё расписание/лок/cap/kill-switch; изоляция инцидентов; совпадает с эталонами.

**Решение развилки (Б7):** пересобирать ВСЕ активные цели (`promotionState≠dismissed`, `validUntil IS NULL`), но (1) пропускать `manualOverride.parentGoalId===true`; (2) менять только при `child_of` + confidence ≥ порога + parent ≠ текущему (анти-флаппинг); (3) per-org cap. **Почему:** чинит и осиротевшие, и устаревшие связи, не перебивая человека и без осцилляции.

**Что НЕ входит:** правка арбитра/промпта `goal-hierarchy-link`; немедленная пересборка при создании; reparent через `GoalsService.update`.

**Acceptance:**
- `manualOverride.parentGoalId===true` → цель пропущена (unit-тест).
- reparent идёт через `prisma.goal.update`, НЕ `GoalsService.update` (`grep` в новом методе).
- `assertNoCycle` вызывается перед каждым применением (тест: предложенный родитель-потомок → reparent отклонён).
- Redis-lock NX (два инстанса → один проход).
- cron зарегистрирован: `grep -n "GoalHierarchyRebuildCron" backend/src/modules/ai/workers.module.ts` → ≥2 (импорт+провайдер).
- `prod-deploy-log` Шаг 12 (новый @Cron) + Шаг 7 (сид knobs).

**Закрывает:** R4.

---

## Ф5 — Каскад статуса по дереву (O4) `[ ]`

**Ценность:** как руководитель, закрыл все подцели — большая цель закрывается сама; забросил большую — подцели помечаются «попали под каскад».

**Цель:** подключить мёртвый `GoalCascadeService` через доменное событие `goal.status_changed`.

**Файлы:**
- `goals/services/goals.service.ts`:
  - Конструктор (`:34-44`) — добавить `@Inject(EventEmitter2) private readonly events: EventEmitter2` (образец `specialist-3-6-ideas.service.ts:414`; `EventEmitterModule.forRoot` уже в `app.module.ts:146`).
  - `update()` после `prisma.goal.update` (`:264-271`): если `updated.status !== existing.status` → `this.events.emit('goal.status_changed', { tenantId, goalId, oldStatus: existing.status, newStatus: updated.status })` в try/catch.
  - `archive()` после `prisma.goal.update` (`:413-417`): emit `goal.status_changed` с `newStatus:'abandoned'`.
- **Новый** `operations/services/goal-cascade.handler.ts` с `@OnEvent('goal.status_changed')` (образец `goals-checkpoint-probe.handler.ts`): `achieved` → `cascade.onChildCompleted({tenantId, goalId})`; `abandoned` → `cascade.onParentMissed({tenantId, parentGoalId: goalId})`. Inject уже экспортируемый `GoalCascadeService`.
- Регистрация хендлера в `OperationsModule` providers (рядом с `GoalCascadeService:105`).
- **НЕ трогать** `GoalCascadeService` (готов), `event-payload.registry.ts` (только для conversational outbound).

**Решение развилки (Б8):** доменное событие (вариант A), не синхронный inject. **Почему:** в проекте УЖЕ есть паттерн `idea.status_changed`→`@OnEvent`; исключает циклическую зависимость `goals↔operations`; `GoalsService` не тащит знание про каскад. Каскадный `onChildCompleted` пишет parent напрямую через prisma (минуя `GoalsService.update`) → нового события не генерит → шторма нет.

**[ASSUMPTION — владелец может уточнить позже]:** `archive()` (любое мягкое удаление цели → `status='abandoned'`) считается «провалом» и помечает детей `cascadeMissed`. **Почему так:** контракт `onParentMissed` жёстко завязан на `status==='abandoned'` — минимальное работающее изменение. `cascadeMissed` обратим; различить «удалил» vs «провалил» — vNext (строка в не-сделанном).

**Что НЕ входит:** различение delete/fail; аудит/embedding для каскадно-достигнутых родителей (как в текущей спецификации каскада).

**Acceptance:**
- `goal.status_changed` эмитится только при реальной смене (`updated.status !== existing.status`) — нет emit при no-op (unit-тест).
- `achieved` цели со всеми siblings achieved → parent → `achieved` (интеграционный тест с деревом).
- `abandoned` родителя → дети `cascadeMissed=true` + `cascadeMissedFromGoalId` (тест).
- Нет циклической зависимости модулей (`bun run build` зелёный; `GoalsModule` НЕ импортирует `OperationsModule`).

**Закрывает:** R5.

---

## Ф6 — Ужесточить промпт извлечения целей (O1) `[ ]`

**Ценность:** как владелец, не получаю мусорных целей из рутинных задач/болтовни, но маленькие настоящие цели-ступеньки («50 кастдев-встреч») по-прежнему ловятся.

**Цель:** поднять планку «это реальная цель компании», не зарубив мелкие настоящие.

**Файлы:**
- `knowledge-core/prompts/goal-extract.prompt.ts`:
  - Главное правило (`:35-38`) — усилить тест «есть ли наблюдаемое ИЗМЕНЕНИЕ состояния (а не просто выполненная работа)? нет → не цель».
  - `:46` перечень «не цель» — добавить «рутинная операционная задача без изменения метрики/состояния, разовое поручение».
  - Few-shot (`:51-62`) — добавить (а) good-пример МАЛЕНЬКОЙ цели-ступеньки с числом, горизонт sprint/monthly, confidence ~0.6; (б) bad-пример output-замаскированного-под-цель («запустить кампанию» без результата) → `isGoal=false`.
  - Самопроверка (`:64-71`) — пункт «есть ли наблюдаемое изменение состояния?».
  - `description` полей `isGoal`/`confidence` в JSON-схеме (`:105-119`) — синхронно ужесточить (схема видна модели).
- `__snapshots__/goal-extract.snapshot.spec.ts.snap` — обновить (`bunx vitest run -u src/modules/knowledge-core/prompts/goal-extract.snapshot.spec.ts`), т.к. тест пинит текст и `toContain('outcome, а не output')`.

**Решение развилки (Б9):** ужесточаем ТЕКСТ промпта + few-shot; порог `goals.minExtractConfidence` оставляем 0.4 (НЕ поднимаем дефолт). **Почему:** текст+примеры бьют точно по «ступенька OK / мусор нет», а подъём порога глобально зарубил бы и мелкие настоящие цели (низкий confidence). Порог остаётся крутилкой — владелец поднимет при необходимости.

**Что НЕ входит:** перенос промпта в admin-registry (его нет для этого таска); смена модели (`deepseek-v4-pro` остаётся).

**Совместимость с prompt caching:** SYSTEM-промпт остаётся стабильной константой (few-shot в SYSTEM — стабильны); переменные данные блока — в USER. Не ломать порядок (правка только текста SYSTEM, без интерполяции переменных в него).

**Acceptance:**
- Snapshot обновлён, `bunx vitest run src/modules/knowledge-core/prompts/goal-extract.snapshot.spec.ts` зелёный.
- Промпт содержит good-пример с горизонтом sprint/monthly (`grep -n "sprint\|monthly" ...prompt.ts` в few-shot).
- Промпт содержит критерий «изменение состояния» (`grep`).

**Закрывает:** R6.

---

## Ф7 — Чистка осиротевшего задачного UI + деталь карточки (O5) `[ ]`

**Ценность:** как руководитель, на дашборде вижу один компас (без дублирующих мёртвых плашек), а «прогресс по задачам цели» — деталь внутри карточки цели.

**Цель:** убрать осиротевшие виджеты; вывести задачный показатель деталью карточки.

**Файлы:**
- **Удалить** (проверив 0 импортов и отсутствие в DashboardCanvas registry/presets):
  - `frontend/app/(authenticated)/dashboard/widgets/StrategicAlignmentWidget.tsx`
  - `frontend/app/(authenticated)/dashboard/widgets/GoalVectorVerdictWidget.tsx`
- **Деталь карточки** (вариант A): в `frontend/app/(authenticated)/goals/[id]/GoalDetailClient.tsx` добавить секцию «Прогресс по задачам» отдельным блоком (визуально отделена от графового движения), дёргающую существующий `GET /goals/:id/alignment-snapshot` (`goals.controller.ts:309`, DTO `GoalIssueProgressSnapshotDto` `goals.dto.ts:183`): `totalLinked/completed/blocked/timeProgress/alignmentScore`. Бэк не трогать — эндпоинт готов.
- **Оставить** `StrategicAlignmentCron` (`goals/cron/strategic-alignment.cron.ts`) — греет Redis-кэш snapshot + probe «задачи не привязаны к целям» (полезный сигнал).
- **НЕ трогать** `daily-digest.service.ts:705-733` и `director-dashboard.service.ts:775-826` (графовый компас — источник правды).
- Ложный след: `frontend/src/domain/tracker/overview.ts alignmentScore` — это прогресс цикла, НЕ issue-snapshot. Не трогать.

**Решение развилки (Б10):** задачный показатель — оставить деталью карточки (вариант A), не выпиливать. **Почему:** эндпоинт+сервис+cron уже работают, у показателя есть смысл (делается ли реальная работа в задачах); стоимость A ≈ 1 фронт-блок, B = каскадное удаление + потеря probe.

**Решение развилки:** поле `strategicAlignment` в director-DTO — оставить на первой итерации (бэк-контракт не ломаем), удалить только виджеты-сироты.

**Что НЕ входит:** выпил `StrategicAlignmentIssuesService`/cron; удаление поля DTO `strategicAlignment`; правка графового контура.

**Acceptance:**
- Удалённые файлы отсутствуют; `grep -rn "StrategicAlignmentWidget\|GoalVectorVerdictWidget" frontend/` → 0.
- Карточка цели рендерит блок «Прогресс по задачам» из `GET /goals/:id/alignment-snapshot` (через `goalsApi`).
- `bun run typecheck && bun run build` (frontend) зелёные.
- UI только русский, парные токены.

**Закрывает:** R7.

---

## Ф8 — Один вердикт статуса в UI (O8) `[ ]`

**Ценность:** как руководитель, на карточке и в дереве вижу один понятный вердикт «куда движется цель», без трёх служебных статусов-дублей.

**Цель:** `movementVerdict` — единственный визуальный статус; служебные оси убраны с карточки/дерева.

**Файлы:**
- `frontend/app/(authenticated)/goals/GoalsClient.tsx` (GoalCard):
  - Убрать `Badge(status)` + `GOAL_STATUS_LABELS` с тела карточки (`:394-396`) — статус остаётся в `STATUS_TABS`-фильтре (`:86-92`) и `EditGoalDialog`.
  - Оставить `movementVerdict`-чип (`:411-421`) как главный.
  - `SuggestedByKoraBadge` (`:399-401`) — оставить тонким (Б12).
  - Блок «Согласованность N + дельта + Достоверность» (`:423-482`) — **скрыть с карточки списка** (Б11); точные числа — на детальной странице.
- `frontend/app/(authenticated)/goals/GoalsTreeView.tsx`: заменить голый `progressStatus`-чип (`:51-59`) на `movementVerdict`. Для этого протащить `cachedAlignment` в `GoalTreeRenderNode` (`buildTree` `goal.ts:573-596` сейчас кладёт только id/name/progressStatus) → звать `movementVerdict(alignment, progressStatus)` + `movementVerdictChipClasses`.
- **НЕ трогать** `movementVerdict`/`movementVerdictChipClasses` (`goal.ts:480-517`) — готовы; `progressStatus` как поле API/домена остаётся (убираем только прямой показ).

**Решение развилки (Б11):** скрыть alignment-число с карточки списка (вариант A). **Почему:** O8 = «один вердикт»; alignment-число — служебная ось, которую вердикт уже свернул; держать и вердикт, и число — тот самый дубль. Точные числа — на детали.

**Решение развилки (Б12):** убрать `GoalStatus`-badge, оставить «Предложено Корой» тонким (вариант B). **Почему:** статус дублируется фильтром (для активных всегда `active`); «Предложено Корой» — маркетингово важный сигнал агентности (Кора сама ставит цели), не служебная ось.

**Что НЕ входит:** удаление поля `progressStatus`/`status` из API/домена; правка фильтра `STATUS_TABS`; правка `EditGoalDialog`.

**Acceptance:**
- `GoalsTreeView` показывает `movementVerdict` (не голый `progressStatus`) — `grep -n "movementVerdict" GoalsTreeView.tsx` → ≥1; `cachedAlignment` в `GoalTreeRenderNode` (`grep` в `goal.ts buildTree`).
- На GoalCard нет `GOAL_STATUS_LABELS`-Badge; `SuggestedByKoraBadge` присутствует.
- alignment-число отсутствует на карточке списка, присутствует на `GoalDetailClient`.
- `bun run typecheck && bun run lint && bun run build` (frontend) зелёные; UI русский.

**Закрывает:** R8.

---

## Ф9 — Крутилки целей в AdminSetting (O9) `[ ]`

**Ценность:** как админ компании, кручу пороги/лимиты целей из админки без релиза (CLAUDE.md п.9).

**Цель:** вынести ~14 захардкоженных констант через `getDynamic` + реестр + сид.

**Идёт ПОСЛЕ Ф2/Ф3/Ф4** (правит те же файлы).

**Паттерн на каждую константу:** (a) строка `['goals.<ключ>', <zodSchema>]` в `admin/settings/admin-setting-schema-registry.ts` (хелперы `POSITIVE_INT:5`, `UNIT_INTERVAL:7`, `z.coerce.number()`, `z.boolean()`); (b) `this.cfg.getDynamic<T>('goals.<ключ>', undefined|'ENV', CODE_FALLBACK)` — где нет cfg, добавить `@Inject(TypedConfigService) private readonly cfg`; const оставить `static readonly` (code-fallback); (c) seed-строка (расширить `scripts/seed-admin-setting-goals-pulse.ts` SEEDS или новый `scripts/seed-admin-setting-goals-knobs.ts`) + регистрация в `apply-prod-deploy.ts` STEPS (phase `update`); (d) UI-поле появляется из реестра.

**Константы к выносу (path:line → ключ):**
| Файл:строка | Константа | Ключ | cfg есть? |
|---|---|---|---|
| `goal-kr-progress.service.ts:11` | `TREND_WINDOW_DAYS=14` | `goals.krTrendWindowDays` | нет — добавить |
| `goal-kr-progress.service.ts:13` | `AT_RISK_MARGIN=25` | `goals.krAtRiskMargin` | нет |
| `strategic-alignment-issues.service.ts:10` | `CACHE_TTL_SEC=26ч` | `goals.issueSnapshotCacheTtlSec` | нет |
| `:12` | `RECENT_ACTIVITY_WINDOW_DAYS=7` | `goals.recentActivityWindowDays` | нет |
| `:14/:16/:18` | `MISALIGNMENT_WINDOW_DAYS=30`/`MIN_ISSUES=5`/`RATIO=0.8` | `goals.misalignment{WindowDays,MinIssues,RatioThreshold}` | нет |
| `specialist-3-14-goals.service.ts:89` | `KNN_TOP_K=5` | `goals.knnTopK` | есть (`:142-168`) |
| `strategic-alignment.worker.ts:33/36/37` | `MAX_BLOCKS=200`/`ALERT_DELTA=-15`/`ALERT_SCORE=60` | `goals.alignment{MaxBlocks,AlertDelta,AlertScore}` | есть (`:55-56`) |
| `goal-alignment-low.cron.ts:11-14` | `PERIOD_DAYS=14`/`MIN_ISSUES=5`/`LOW_RATIO=0.8`/`DEDUP_TTL=86400` | `tracker.goalAlignmentLow{PeriodDays,MinIssues,LowRatio,DedupTtlSec}` | есть (`:44`) |
| `goal-vector-tracker.cron.ts:22/23` | `MAX_ORGS_PER_RUN=5000`/`MAX_ARTEFACTS_PER_GOAL=100` | `goals.vector{MaxOrgsPerRun,MaxArtefactsPerGoal}` | есть (`:70`) |
| `goal-theme-linker.cron.ts:12` / `goal-task-linker.cron.ts:12-13` | `GOALS_PER_ORG_LIMIT=50` / `LOOKBACK_DAYS=7` | `goals.linkerPerOrgLimit` / `goals.taskLinkerLookbackDays` | нет |

**Решение развилки (Б13):** выносить ВСЕ (вариант A), включая cap-лимиты. **Почему:** правило 9 прямо называет «порог, лимит, TTL, rate-limit» крутилками без исключений; половинчатый вынос плодит склад магических констант; паттерн дёшев, один сид goals-knobs + один STEP; риск низкий (fallback = текущее значение).

**Критичные риски (заложить):**
- `KNN_TOP_K` интерполируется в `$queryRaw LIMIT` (`specialist:670`) — после выноса **обязательна `Number()`/целочисленная валидация** перед интерполяцией (иначе SQL-инъекция).
- `goal-kr-progress` `TREND_WINDOW_DAYS`/`AT_RISK_MARGIN` — в **статических** `computeStatus`/`expectedProgress` (`:297-336`); `getDynamic` async/инстансный → **прокидывать значения параметром** в static-методы (не делать static async).
- `getDynamic` async — читать **один раз в начале** метода (как `goal-vector-tracker:70`), НЕ в цикле по orgs/goals.
- 4 файла без cfg — добавление инъекции может потребовать правки тестовых моков.

**Что НЕ входит:** повторный вынос уже сделанных ключей (`minExtractConfidence`/`autoPromoteConfidence`/`maxActiveGoalsPerHorizon`/`pulse.*`); cron-расписания (vNext).

**Acceptance:**
- Каждый ключ: строка в реестре + `getDynamic` + seed-строка; code-fallback = текущее число (`grep` пар «ключ ↔ fallback»).
- `KNN_TOP_K` через `getDynamic` проходит `Number.isInteger`-проверку перед `LIMIT`.
- Сид идемпотентен (повторный прогон = no-op), зарегистрирован в `apply-prod-deploy.ts` STEPS.
- `bun run typecheck` (вкл. `.spec`) + затронутые `bunx vitest run` зелёные.
- `prod-deploy-log` Шаг 1 (новые ключи) + Шаг 7 (новый/расширенный seed).

**Закрывает:** R9.

---

## Pre-mortem / Риски (общие)
- **TZ процесса не UTC** (Ф1) — если backend уже `Europe/Moscow`, сдвиг продюсера сломает порядок. → проверить `printenv TZ` ПЕРВЫМ, зафиксировать.
- **Порядок Ф2 ↔ дроп `commitmentStatus`** — backend не соберётся, если дроп раньше Ф2. → граничный контракт, инвариант выката.
- **Семантический KNN тем** (Ф3) — слабые темы при низком пороге → консервативный `themeAutolinkKnnMaxDistance` + `minWeight` + `source:'ai'` (владелец удалит).
- **Флаппинг родителя** (Ф4) — арбитр осциллирует A→B→A → гистерезис (confidence-порог + parent≠текущему) + `assertNoCycle`.
- **Обеднение топлива вектора** (Ф2) — нет закрытых задач → пустой вектор → проверить пустое состояние UI.
- **Дубли ключей AdminSetting** (Ф9) — не выносить уже вынесенные.

## Ревью-аспекты (`strict-production-review-gate`)
Тенант-изоляция во всех новых запросах (KNN тем, пересборка иерархии); идемпотентность сидов и линкеров; SQL-инъекция в `LIMIT` (KNN_TOP_K); отсутствие циклической зависимости модулей (Ф5); метрики/логи на новом cron (Ф4); отсутствие OFF-флагов кроме kill-switch.

## Сквозные аспекты (чек)
- **RBAC/tenant:** ✅ все новые запросы с `tenantId`/`@@index([tenantId,…])`; reparent и KNN — per-tenant.
- **Observability:** ✅ новый `GoalHierarchyRebuildCron` — метрика + лог сводки (как линкеры); существующие метрики не ломать.
- **Errors+идемпотентность:** ✅ линкер no-op при пустом векторе; cron per-org try/catch; сиды идемпотентны.
- **Миграции:** `[N/A: схема БД не меняется — embedding/themes/cascadeMissed/HNSW уже есть]`.
- **Rollout/флаг:** ✅ Ship-On; единственный новый флаг — kill-switch `goals.hierarchyRebuild.enabled` (строка в `docs/operations/feature-flags.md`).
- **Тесты:** ✅ per-фаза unit/integration; snapshot Ф6.

## Idempotency / feature-flag / prod-deploy
- Сиды knobs (Ф3, Ф9) — идемпотентны, в `apply-prod-deploy.ts` STEPS (phase `update`).
- Kill-switch `goals.hierarchyRebuild.enabled` (Ф4) — default ON, строка в `docs/operations/feature-flags.md`.
- `prod-deploy-log`: Шаг 1 (новые ENV/ключи), Шаг 7 (сиды), Шаг 12 (новый @Cron Ф4 + смена расписаний Ф1).

## DoD (на каждом коммите фазы)
`bun run typecheck` (вкл. `.spec`) + `bun run lint` + `bun run build` зелёные (backend и/или frontend); затронутые `bunx vitest run` зелёные; `second-brain/01_projects/goals-and-strategic-alignment.md` обновлён по факту (особенно: компас=граф, карточка=задачи; вектор без обещаний; ночной порядок МСК); `02_architecture/module-map.md` (+новый cron Ф4); `prod-deploy-log` по затронутым шагам; реестр `04_не-сделано` (vNext-хвосты: Issue↔Goal, cron→AdminSetting, немедленный producer тем, delete-vs-fail); рефлексия в `05_история/`.

## Итог
Реализовано: ⬜ (заполнит `tz-orchestrator` пофазно). Остаток/отложенное — в `04_не-сделано` и Scope «не входит».
