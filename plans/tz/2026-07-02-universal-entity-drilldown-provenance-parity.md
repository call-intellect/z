---
type: tz
status: ready-to-implement
feature: universal-entity-drilldown-provenance-parity
date: 2026-07-02
owner: sergrv80@gmail.com
relates_to:
  - plans/architecture/2026-07-02-universal-entity-drilldown-provenance-parity.md
  - plans/analysis/2026-07-02-universal-entity-drilldown-provenance-parity.md
  - plans/tz/2026-06-20-provenance-source-traceability-tz.md
  - plans/tz/2026-06-27-task-decision-execution-unified-tz.md
  - plans/tz/2026-06-25-meeting-tasks-widget-404-fix.md
---
> Архитектура (одобрена владельцем 2026-07-02): `plans/architecture/2026-07-02-universal-entity-drilldown-provenance-parity.md` · Анализ: `plans/analysis/2026-07-02-universal-entity-drilldown-provenance-parity.md` · Статус согласования: approved 2026-07-02.

# ТЗ — Единый drill-down + provenance parity

**Принцип (инвариант).** Элемент интерфейса несёт кликабельный аффорданс (переход/drill/«откуда») **тогда и только тогда**, когда за ним есть непустой резолвимый первоисточник, доступный этому зрителю. Нет источника или он закрыт правами → аффорданса нет (элемент не притворяется кнопкой). Кликабельность — по факту наличия provenance, а не по типу элемента. Это по построению исключает «мёртвый аффорданс» (декоративный кружок задачи, стрелка на блокере).

**Вне scope / отложено владельцем:** денормализация снимка provenance (`previewQuote`) на цель/трение — НЕ делаем (on-demand резолв, см. Р-реш). Возврат решений/обещаний в основную навигацию — НЕ трогаем (осознанно в «Памяти»). Редизайн/визуальная полировка дашборда — отдельный этап (`frontend-design`/`impeccable`) после этого ТЗ.

## Цель + Зачем

**Болезненное состояние (по коду ветки work/2026-06-29):** провенанс-хребет (ТЗ 2026-06-20) построен и работает для решений/регламентов/идей/журнала хода, но применён неравномерно. На части поверхностей сущность рендерится «мёртвой»: строка задачи в панели встречи не открывается, кружок «выполнено» декоративный (`MeetingsJournalReal.tsx:1221-1252`); у цели только бейдж «Предложено Корой»; свежий дашборд «День/Неделя/Месяц компании» показывает блокеры/риски/идеи/конфликты, но ни один элемент не проваливается (`DaySignalsGrid` `SignalRow` — презентационный `div`; `DayBlockers` рисует `ArrowUpRight aria-hidden` без обработчика). Пользователь не может проверить «откуда это» → не доверяет автоизвлечению → игнорирует карточки.

**Чем решение лучше:** один общий механизм вместо пяти точечных заплаток — новая сущность/поверхность наследует drill+«откуда» бесплатно; «мёртвых аффордансов» нет по построению. Конфликт между людьми с проваливанием к моменту разговора — **дифференциатор**: на рынке этого нет ни у кого (meeting-intelligence умеет drill-to-moment, но не про внутреннее трение; org-health умеет трение, но намеренно прячет источник ради приватности, «Rule of 5»). Доказательная база — анализ §3.

## REALITY-CHECK (факты по коду 2026-07-02 — перед правкой перечитать по символу-якорю)

| # | Что по факту | Следствие |
|---|---|---|
| RC-1 | `ProvenanceEntityType` (`provenance.service.ts:16-24`) = `decision\|issue\|regulation\|instruction\|block\|notification\|entity\|idea`. **`goal`, `insight`, `friction` — ОТСУТСТВУЮТ.** `collectSourceBlockIds` (`:682-731`) — switch по типам; `resolve` (`:251`) уже фильтрует через `partitionProjectionsByAccess` и маскирует закрытые блоки (`PROVENANCE_ACCESS_MASK`, `:341-359`). | Ф1 добавляет 3 case + 3 значения enum + в `VALID` (`resolveQuotesForJudge:552-560`). Резолвер, фильтр прав, deepLink, нода — переиспользуются as-is. |
| RC-2 | **Блокер уже резолвим:** `OperationsBlockerApi.sourceBlockId` (единичный blockId), а тип `block` в enum есть (`:710-711` `case 'block': return [entityId]`). | Блокер (C) НЕ требует нового case — фронт зовёт `/provenance/block/:sourceBlockId`. |
| RC-3 | **Идея уже резолвима:** `case 'idea'` (`:721-727`) читает `Idea.sourceBlockIds`; есть роут `/ideas/:id`. | Идея-кластер (C) — фронт-only: строка кластера → `/ideas` (или отфильтрованный список). |
| RC-4 | **Конфликт = `EntityLink`** (`schema.prisma:4284`, `relationType='conflicted_with'`, `TEAM_FRICTION_RELATION_TYPES` `operations-dashboard.service.ts:32`); несёт `sourceBlockIds` (`schema:4331`). `fetchTeamFrictions` (`:543-604`) select (`:560-569`) НЕ включает `sourceBlockIds`; DTO `OperationsTeamFrictionApi` отдаёт только имена/причину/%. | Ф1 добавляет `case 'friction'` (читает `EntityLink.sourceBlockIds`). Список дашборда НЕ отдаёт `sourceBlockIds` наружу (анти-утечка) — drill идёт отдельным on-demand вызовом `/provenance/friction/:entityLinkId`. |
| RC-5 | **`CrossFunctionalFrictionReport`** (`schema:5983`, `process_friction`) — ДРУГАЯ сущность (межотдельческое трение), у неё `sourceBlockIds` уже есть. НЕ путать с межличностным `EntityLink`. | В scope этого ТЗ — только межличностное трение (`EntityLink conflicted_with`). |
| RC-6 | **Задача из встречи fast-путём без источника:** `meeting-report-fast.worker.ts:387` `evidenceBlockIds: []` хардкод; IdeaBlock в fast-воркере не создаётся. → у задач и их `IssueProgressUpdate`, рождённых на встрече, `deepLink=null` даже там, где `ProvenancePreviewSnippet` рисуется. Это RC-5 провенанс-ТЗ 2026-06-20 (в `04_не-сделано`). | Ф5 (E) оживляет: матчинг IdeaBlock по цитате/окну. Сквозной корень «взяли непонятно откуда». |
| RC-7 | **Эталон кликабельного кружка уже есть:** `MeetingResultPageReal.tsx` `onToggleDone` (`:1631-1645`) → `issuesApi.transitionToCategory(orgId,id,done?'unstarted':'completed')`; рендер `:1665-1677`. Строка вкладки «Задачи» (`:1657` `<article>`) НЕ ведёт в `/issues/:id`. `StaleTasksLinked` — эталон перехода (`<Link href="/issues/:id">`). | A переиспускает `onToggleDone` дословно; переход — паттерн `IssueCard:40-41`. |
| RC-8 | **Миграций не требуется.** B/C/D резолвятся on-demand по существующим `sourceBlockIds` (`Goal:4504`, `Insight:6519`, `EntityLink:4331`). E не добавляет колонок (заполняет существующее поле). | Единственный прод-артефакт — новая AdminSetting (роли дословного конфликта) + промпт-совместимость E. |

## Принятые решения владельца (не пересматривать)

| # | Решение | Обоснование | Дата |
|---|---|---|---|
| В1 | Конфликт раскрывается ДВУМЯ уровнями: тема+встреча — всем, кто вправе видеть встречу; дословные реплики «кто-что-сказал» + прыжок к точному моменту — только owner+admin. | Трение n=2 ниже отраслевого «Rule of 5»; полная цитата рядовому = риск эскалации. Сохраняет дифференциатор без приватностного провала (анализ §5). | 2026-07-02 |
| В2 | Дословный источник конфликта — роли `owner`+`admin` (НЕ `coo`). Список ролей — крутилка `AdminSetting` (шип с этим дефолтом). | Разграничение доступа = «решение владельца», выкатывается с заданным параметром (CLAUDE.md принцип 8/9). | 2026-07-02 |
| В3 | Блок E (оживление deepLink задач из встреч) входит в этот же заход. | Иначе у большинства meeting-рождённого «откуда» есть, а прыжок мёртв — фича полу-готова. | 2026-07-02 |
| В4 | Единый механизм (обобщённый резолвер), не 5 заплаток. Источник цели/конфликта — on-demand, БЕЗ денорм-снимка `previewQuote` и БЕЗ backfill. Денорм Decision/Issue/Regulation НЕ трогаем. | Снимок на derived/короткой сущности протухает без выигрыша в масштабе (red-team, анализ §5 D-1/B-1). | 2026-07-02 |
| В5 | Инвариант прав зрителя (deny-by-default по группам, `partitionProjectionsByAccess`) обязателен на всех новых путях. Задача (A) — первым приоритетом. | Без фильтра drill = деагрегация/утечка (эталон Glean «citations never grant new access»). A — прямая жалоба клиента. | 2026-07-02 |

## Доказательство выбора

Матрицы вариантов (D-1 источник конфликта: on-demand vs денорм vs новая модель; B-1 цель: on-demand vs снимок; G-1 обобщённый резолвер vs N case) со состязательным red-team — в анализе §5. Кратко: on-demand резолв через существующий `ProvenanceService` снимает staleness и переиспользует готовый `sourceBlockIds`; обобщённый резолвер делает инвариант свойством «есть `sourceBlockIds`». Не переоткрывать.

## Scope

**Входит:** A (задача из встречи, фронт) · Ф1 (обобщение резолвера: goal/insight/friction + двухуровневый конфликт) · B (цель «откуда») · C (дашборд блокер/риск/идея) · D (конфликт два уровня) · E (deepLink задач из встреч).

**Не входит (vNext / другой дом):**
- Денорм-снимок provenance на цель/трение (В4 — не делаем; если замер покажет N+1 на списке целей — отдельным ТЗ).
- Межотдельческое трение `CrossFunctionalFrictionReport` (RC-5 — своя сущность, не в scope).
- Вторая волна провенанс-хребта (chat deep-link / документ-страница / аудио S3) — `plans/tz/2026-06-20-provenance-source-traceability-tz.md` «Осталось (vNext)».
- Отдельная HR-роль для дословного конфликта — крутилка позволит добавить без кода.

**Граничные контракты:** `ProvenanceService.resolve`/`buildDeepLink`/`partitionProjectionsByAccess`, `ProvenancePreviewSnippet`/`ProvenanceDrawer`/`useProvenance`, `issuesApi.transitionToCategory`, `MeetingVisibilityService.assertCanView` — берём as-is, логику не меняем (только расширяем enum/switch резолвера и добавляем ролевую маскировку в friction-путь).

## Контракт-first (единый источник правды для копипасты)

> Номера строк — на 2026-07-02; перед правкой перечитать по символу-якорю.

### К-1. Обобщение резолвера (backend, `provenance.service.ts`)

Enum `ProvenanceEntityType` (`:16-24`) — добавить `| 'goal' | 'insight' | 'friction'`. Массив `VALID` в `resolveQuotesForJudge` (`:552-560`) — добавить те же три (чтобы judge-путь тоже видел). В `collectSourceBlockIds` (`switch`, `:687`) добавить case-ы:

```ts
      case 'goal': {
        const g = await this.prisma.goal.findFirst({
          where: { id: entityId, tenantId },
          select: { sourceBlockIds: true },
        });
        return g?.sourceBlockIds ?? [];
      }
      case 'insight': {
        const s = await this.prisma.insight.findFirst({
          where: { id: entityId, tenantId },
          select: { sourceBlockIds: true },
        });
        return s?.sourceBlockIds ?? [];
      }
      case 'friction': {
        const l = await this.prisma.entityLink.findFirst({
          where: { id: entityId, tenantId, relationType: { in: TEAM_FRICTION_RELATION_TYPES } },
          select: { sourceBlockIds: true },
        });
        return l?.sourceBlockIds ?? [];
      }
```

`TEAM_FRICTION_RELATION_TYPES` (`['conflicted_with']`) вынести в общий экспорт (сейчас в `operations-dashboard.service.ts:32`) или продублировать константу локально в knowledge-core (решение исполнителя; НЕ импортировать operations-модуль в knowledge-core, если это создаёт цикл — тогда локальная константа).

### К-2. Двухуровневый конфликт (backend, ролевая маскировка)

`ViewerContext` (`provenance.service.ts`) расширить опц. полем `viewerRole?: string`. Новый метод-обёртка или ветка в `resolve`: если `entityType==='friction'` И `viewerRole` не входит в набор «дословных» ролей → каждая нода маскируется до **агрегата**: `quote` заменяется на тему/лейбл встречи (из `source.label`), `deepLink` ведёт на встречу без таймкода (`/meetings/:id`, без `?t=`), `startMs/endMs=null`. Owner/admin (роль в наборе) → полная нода (дословная цитата + `?t=<sec>`). Набор ролей — из AdminSetting К-5 (`resolveSync`/`getDynamic`, code-fallback `['owner','admin']`).

Инвариант доступа (В5) сохраняется: маскировка агрегата применяется ПОВЕРХ уже существующего `partitionProjectionsByAccess` (блок, недоступный по группам, остаётся `PROVENANCE_ACCESS_MASK` независимо от роли).

### К-3. Эндпоинт (расширение существующего)

`GET /api/v1/provenance/:entityType/:entityId` (`provenance.controller.ts`) — `entityType` теперь принимает `goal|insight|friction` (Zod-enum расширить). Viewer (`tenantId`,`userId`) и **роль** брать из `CookieAuthGuard`/`TenantGuard` (роль зрителя в org), НЕ из тела. `entityType` вне enum → 400 `{code:'invalid_entity_type'}`; сущность не найдена/пустой источник → `{nodes:[]}` (не 404 — честная деградация «источника нет»).

### К-4. Список конфликтов дашборда — БЕЗ источника наружу (анти-утечка)

`fetchTeamFrictions` (`operations-dashboard.service.ts:543-604`) и DTO `OperationsTeamFrictionApi` — `sourceBlockIds` наружу НЕ отдавать. В ответе достаточно существующего `id` (= `EntityLink.id`) — фронт по нему зовёт `/provenance/friction/:id`. (select `:560-569` не расширять полем `sourceBlockIds`; drill идёт отдельным гейт-путём К-2/К-3.)

### К-5. AdminSetting — роли дословного конфликта (крутилка)

Ключ `provenance.frictionVerbatimRoles` (тип: список ролей), code-fallback `['owner','admin']`. Регистрация: `admin-setting-schema-registry.ts` + сид (`seed-admin-setting-*` или существующий агрегатный сид) + UI-поле. Читать через `getDynamic`/`resolveSync` (admin→ENV→code-fallback), НЕ хардкодом. Строка в `docs/operations/feature-flags.md` (тип: решение владельца — матрица доступа; ON с дефолтом).

## Границы фичи

- ✅ **Always:** фильтровать каждый новый provenance-путь через `partitionProjectionsByAccess` ДО возврата quote; таймкод в `buildDeepLink` — в мс; аффорданс рендерить по факту наличия/резолвимости источника; агрегаты/счётчики/средние — оставлять статикой.
- ⚠️ **Ask first:** менять логику `KnowledgeAccessResolver`/`MeetingVisibilityService`; вводить денорм-снимок provenance на новую сущность; вводить новый `signalType`/`relationType`; менять формат уже сохранённых `sourceBlockIds`.
- 🚫 **Never:** отдавать `sourceBlockIds` конфликта в списочный DTO дашборда (утечка); дословную цитату конфликта роли вне `frictionVerbatimRoles`; quote мимо фильтра прав; вести кнопку «к моменту» в пустоту (нет якоря → нет кнопки); числовой % уверенности на meeting-фактах; `process.env.*` мимо `env.schema.ts`; роли/пороги хардкодом мимо `AdminSetting`; комментарии-проза.

## Фазы (dependency-ordered)

Граф: **Ф0 (A)** независима, выкатывается первой. **Ф1** — load-bearing бэк (обобщение резолвера), от неё зависят **Ф2 (B) · Ф3 (C) · Ф4 (D)** (можно параллельно после Ф1). **Ф5 (E)** независима от Ф1 (другие файлы), можно параллельно; усиливает всё meeting-рождённое.

---

### Ф0 — A: задача из встречи проваливается + кружок отмечает выполнение `[x]`

**Ценность:** Как руководитель, из панели «Задачи» встречи открываю задачу (её ход и «откуда») и отмечаю выполненной на месте, чтобы не терять контекст встречи.

**Картография:**
- `frontend/src/ui/components/meetings-journal/MeetingsJournalReal.tsx:1214-1258` — секция «Задачи»; `<li key={t.id}>` (`:1221`); `<Circle>` (`:1225`) декоративный. Хук `useMeetingIssues(currentOrgId, meetingId)` (`:1036`).
- `frontend/src/ui/components/meeting-result-v2/MeetingResultPageReal.tsx` — эталон `onToggleDone` (`:1631-1645`), рендер кружка (`:1665-1677`); вкладка «Задачи» `<article key={issue.id}>` (`:1657-1713`) — строка НЕ ведёт в `/issues/:id`.
- Эталон перехода `src/ui/tracker/IssueCard.tsx:40-41`. API `issuesApi.transitionToCategory` (`src/api/tracker/issues.api.ts:200`).

**Что входит:**
- R1. Виджет журнала: строку задачи обернуть переходом на `/issues/${t.id}` (паттерн `IssueCard` `<Link>`; вся строка кликабельна, `hover` уже есть).
- R2. Виджет журнала: `<Circle>` заменить на кликабельный кружок-«выполнено» (копия `onToggleDone`: `transitionToCategory(orgId, t.id, done?'unstarted':'completed')`, оптимистично + `mutate` через `useMeetingIssues`); `stopPropagation` на кружке, чтобы клик по нему не проваливал в задачу; при `done` — `CheckCircle2` + зачёркивание, эталон `MeetingResultPageReal:1665-1685`.
- R3. Вкладка «Задачи» страницы результата: строку `<article>` (`:1657`) сделать переходом на `/issues/${issue.id}` (кружок `onToggleDone` уже есть — `stopPropagation` на нём).

**Что НЕ входит:** изменения детальной `/issues/:id` (готова); бэкенд.

**Acceptance:**
- Грепом: в `MeetingsJournalReal.tsx` секции «Задачи» присутствует `href={\`/issues/${...}\`}` и вызов `transitionToCategory`; `<Circle` без обработчика — 0 (заменён).
- Грепом: в `MeetingResultPageReal.tsx` строка задачи (`:1657`) обёрнута переходом на `/issues/`.
- `cd frontend && bun run typecheck && bun run lint && bun run build` — зелёные.
- Ручная (qa-tester, прод korateam.ru): в панели встречи клик по кружку → задача зачёркивается; клик по строке → `/issues/:id`.

Закрывает: R1, R2, R3.

---

### Ф1 — Обобщение резолвера провенанса (goal/insight/friction + два уровня) `[x]`

**Ценность:** Как компонент «резолвер провенанса», понимаю любую сущность с `sourceBlockIds` (цель, риск, конфликт), чтобы drill+«откуда» стал свойством данных, а не типа; конфликт отдаю двухуровнево по праву зрителя.

**Картография:** `backend/src/modules/knowledge-core/services/provenance.service.ts` — enum `:16-24`, `resolve` `:251`, `collectSourceBlockIds` `:682-731`, `VALID` `:552-560`, маскировка `:341-359`. `provenance.controller.ts` (Zod-enum entityType). `EntityLink` `schema.prisma:4284/4331`; `Goal:4504`; `Insight:6519`. `TEAM_FRICTION_RELATION_TYPES` `operations-dashboard.service.ts:32`. AdminSetting: `admin-setting-schema-registry.ts`.

**Что входит:**
- R4. Enum + VALID + 3 case (К-1): `goal`→`Goal.sourceBlockIds`, `insight`→`Insight.sourceBlockIds`, `friction`→`EntityLink.sourceBlockIds` (relationType ∈ TEAM_FRICTION).
- R5. `ViewerContext.viewerRole?` + двухуровневая маскировка friction (К-2): роль вне `frictionVerbatimRoles` → агрегат (лейбл встречи, `deepLink` без `?t=`, `quote` = тема/лейбл, `startMs=null`); в наборе → полная нода. Поверх `partitionProjectionsByAccess` (В5).
- R6. Эндпоинт (К-3): `entityType` принимает `goal|insight|friction`; роль зрителя из guard, не из тела; невалидный тип → 400 `invalid_entity_type`; пустой источник → `{nodes:[]}`.
- R7. AdminSetting `provenance.frictionVerbatimRoles` (К-5): реестр + сид + `getDynamic`, code-fallback `['owner','admin']`; строка в `feature-flags.md`.
- R8. Тесты (vitest): (а) `resolve('goal',…)`/`resolve('insight',…)` возвращают ноды с deepLink к моменту; (б) friction роль `manager` → агрегат (quote=лейбл, deepLink без `?t=`), роль `owner` → дословная цитата + `?t=`; (в) блок в closed-группе → `accessFiltered` независимо от роли (инвариант В5); (г) friction `entityType` невалидной сущности → `{nodes:[]}`.

**Что НЕ входит:** фронт (Ф2-Ф4); денорм-снимок (В4).

**Acceptance:**
- Грепом: `'goal'`,`'insight'`,`'friction'` присутствуют в `ProvenanceEntityType` и `VALID`; `case 'goal'`/`case 'insight'`/`case 'friction'` в `collectSourceBlockIds`.
- `bunx vitest run backend/src/modules/knowledge-core/services/provenance.service.spec.ts` — R8 (а-г) зелёные; регресс decision/issue/regulation/idea без деградации.
- Грепом: `provenance.frictionVerbatimRoles` в `admin-setting-schema-registry.ts`; чтение через `getDynamic`/`resolveSync` (не ENV/хардкод).
- `cd backend && bun run typecheck && bun run lint && bun run build` — зелёные.

Закрывает: R4, R5, R6, R7, R8.

---

### Ф2 — B: цель показывает «откуда→момент» `[x]`

**Ценность:** Как сотрудник, на странице цели вижу, из какого разговора она родилась, и проваливаюсь к моменту встречи, чтобы доверять автопредложенной цели.

**Картография:** `frontend/app/(authenticated)/goals/[id]/GoalDetailClient.tsx` (сейчас `SuggestedByKoraBadge`, нет provenance). `useProvenance(entityType, entityId)` (`src/hooks/...`), `ProvenancePreviewSnippet`/`ProvenanceDrawer` (`src/ui/components/provenance/`), domain `ProvenanceRef` (`src/domain/provenance.ts`).

**Что входит:**
- R9. На `/goals/:id` добавить ленивый `useProvenance('goal', goal.id)` (грузит по открытию) + рендер блока «Откуда» (`ProvenancePreviewSnippet` для первой ноды или `ProvenanceDrawer` для полного списка) рядом с `SuggestedByKoraBadge`.
- R10. При пустом источнике (`nodes:[]`) — блок «Откуда» НЕ рендерится (честная деградация, инвариант: нет источника → нет аффорданса).

**Что НЕ входит:** список целей `/goals` (только детальная в этом ТЗ; список — vNext, если понадобится); бэкенд (Ф1).

**Acceptance:**
- Грепом: `useProvenance('goal'` и `ProvenancePreviewSnippet`/`ProvenanceDrawer` в `GoalDetailClient.tsx`.
- `cd frontend && bun run typecheck && bun run build` — зелёные.
- Ручная (qa-tester): AI-цель показывает «Откуда», клик → `/meetings/:id?t=<sec>`; ручная цель без источника — блока «Откуда» нет.

Закрывает: R9, R10.

---

### Ф3 — C: дашборд — блокер/риск/идея кликабельны по факту источника `[x]`

**Ценность:** Как владелец, на дашборде проваливаюсь от блокера/риска/идеи к моменту-первоисточнику, чтобы проверить, а не гадать; мёртвых стрелок больше нет.

**Картография:** `frontend/src/ui/components/dashboard/day-company/DayBlockers.tsx` (`ArrowUpRight aria-hidden` `:86-91`, `it.sourceBlockId`), `DaySignalsGrid.tsx` (`SignalRow` `:106-143` — `div`; риски `InsightListItemApi`, идеи-кластеры). Зеркала: `week-company/WeekBlockers.tsx`,`MonthBlockers.tsx`,`WeekSignalsGrid.tsx`,`MonthSignalsGrid.tsx`. Эталон drawer: `registry/widgets/BlockersByThemeWidget.tsx` (`ProvenanceDrawer`). Эталон перехода: `StaleTasksLinked.tsx` (`<Link href="/issues/:id">`).

**Что входит:**
- R11. Блокер (`DayBlockers` + Week/Month): если `it.sourceBlockId` есть → строка кликабельна, открывает `ProvenanceDrawer` через `/provenance/block/${it.sourceBlockId}` (RC-2); стрелка `ArrowUpRight` рендерится ТОЛЬКО при наличии источника (иначе строка без стрелки, статична).
- R12. Риск (`DaySignalsGrid` `SignalRow` для insight + Week/Month): если у insight есть резолвимый источник → кликабельно, drill через `/provenance/insight/${it.id}` (drawer) ИЛИ переход `/insights/:id` (решение исполнителя по существующему роуту); иначе статика.
- R13. Идея-кластер (`DaySignalsGrid`): строка кластера → переход на `/ideas` (кластер — агрегат нескольких идей; конкретная идея резолвима на `/ideas/:id`, RC-3). Отдельная идея внутри — `/ideas/:id`.
- R14. Агрегаты/счётчики/средние («N активных», «×N», «средний прогресс») — НЕ делать кликабельными (инвариант: у суммы нет единого первоисточника). `SignalRow` разделить на кликабельный (есть источник) и статичный (агрегат) варианты — кликабельность по данным, не по типу.

**Что НЕ входит:** редизайн виджетов; конфликт (Ф4).

**Acceptance:**
- Грепом: в `DayBlockers.tsx` `ArrowUpRight` рендерится под условием наличия `sourceBlockId`; появился обработчик клика/`ProvenanceDrawer`.
- Грепом: `SignalRow` (или его кликабельный вариант) в `DaySignalsGrid` несёт переход/drawer для риска и идеи; счётчики/агрегаты — без обработчика.
- Week/Month — те же правки (грепом на `WeekBlockers/MonthBlockers/WeekSignalsGrid/MonthSignalsGrid`).
- `cd frontend && bun run typecheck && bun run build` — зелёные.
- Ручная: блокер с источником проваливается к моменту; блокер без источника — без стрелки; клик по «7 рисков»/счётчику — ничего (статика).

Закрывает: R11, R12, R13, R14.

---

### Ф4 — D: конфликт/трение — двухуровневый drill `[x]`

**Ценность:** Как владелец, проваливаюсь от трения «Аня ↔ Миша» к дословным репликам и моменту разговора; как руководитель — вижу тему и встречу без дословностей (приватность n=2).

**Картография:** backend `operations-dashboard.service.ts` `fetchTeamFrictions:543-604`, DTO `OperationsTeamFrictionApi`. Фронт `DaySignalsGrid.tsx` `frictionMeta:176-183` + `SignalRow` (person↔person, `:269-285`). Гейт видимости встречи: `MeetingVisibilityService.assertCanView` (паттерн из `plans/tz/2026-06-25-meeting-tasks-widget-404-fix.md`). Резолвер friction + маскировка — Ф1 (К-2).

**Что входит:**
- R15. Backend: список конфликтов дашборда `sourceBlockIds` наружу НЕ отдаёт (К-4); ответ несёт `id` (=`EntityLink.id`). Drill — только через `/provenance/friction/:id`.
- R16. Фронт: строка конфликта (`SignalRow` person↔person) — кликабельна, открывает `ProvenanceDrawer` через `useProvenance('friction', friction.id)`.
- R17. Двухуровневость (визуально): owner/admin видит дословные реплики + прыжок к моменту; прочие вправе — тему+встречу с переходом на встречу без таймкода (данные приходят уже промаскированными из Ф1/К-2 — фронт просто рендерит что пришло). При недоступности источника правами — drawer показывает «Источник скрыт правами доступа» (существующая маска).
- R18. Тест (vitest, backend): список дашборда конфликтов не содержит `sourceBlockIds` в ответе; `/provenance/friction/:id` под ролью `manager` → агрегат, под `owner` → дословно (перекрывается R8, но проверить именно через эндпоинт-контроллер-спеку).

**Что НЕ входит:** `CrossFunctionalFrictionReport` (RC-5); ось «Команда» в вердикте (агрегат — статика).

**Acceptance:**
- Грепом: `OperationsTeamFrictionApi`/`fetchTeamFrictions` select НЕ содержит `sourceBlockIds`.
- Грепом: `useProvenance('friction'` в `DaySignalsGrid.tsx`.
- `bunx vitest run` контроллер-спеки provenance: friction под `manager` → нет дословной цитаты (агрегат); под `owner` → цитата + `?t=`.
- `cd frontend && bun run typecheck && bun run build` + `cd backend && bun run typecheck && bun run build` — зелёные.
- Ручная (qa-tester, два аккаунта): владелец видит реплики+момент; руководитель — тему+встречу без реплик.

Закрывает: R15, R16, R17, R18.

---

### Ф5 — E: оживить deepLink задач/хода из встреч (сквозной корень) `[x]`

**Ценность:** Как компонент «извлечение задач fast-путём», привязываю задачу к реальному блоку-доказательству, чтобы «откуда→момент» работал у всего, что родилось на встрече.

**Картография:** `backend/src/modules/knowledge-core/workers/meeting-report-fast.worker.ts:387` (`evidenceBlockIds: []`); `MeetingReportFastTaskSchema` (`meeting-report-fast.prompt.ts` — несёт `title/assigneeRaw/dueDateIso/sourceQuote/confidence`). Провенанс-ТЗ 2026-06-20 RC-5.

**Что входит:**
- R19. Заменить `evidenceBlockIds: []` (`:387`): для задачи из fast-отчёта найти соответствующий `IdeaBlock` (матчинг по `sourceQuote`/временнóму окну реплики в транскрипте встречи) и положить его id в `evidenceBlockIds`. Если валидный блок не найден — оставить пусто (честная деградация, НЕ выдумывать).
- R20. Идемпотентность: повторный прогон fast-воркера по тому же блоку не плодит дублей evidence-связей; матчинг детерминирован.
- R21. Совместимость с prompt caching: если для матчинга требуется правка `MeetingReportFastTaskSchema`/промпта — правила/схема в стабильном SYSTEM, переменные данные в конце user (иначе раздел «Не релевантно», если матчинг чисто пост-обработочный без правки промпта).

**Что НЕ входит:** переработка fast-классификатора; block-линк для не-задачных сущностей fast-пути.

**Acceptance:**
- `bunx vitest run` спеки fast-воркера: задача с `sourceQuote`, совпадающим с репликой транскрипта → `evidenceBlockIds` непусто; нет совпадения → пусто (не падает).
- Грепом: `evidenceBlockIds: []` хардкод в `:387` заменён на матчинг.
- Интеграционно/ручная: задача, рождённая на встрече, на `/issues/:id` показывает «Откуда» с рабочим прыжком к моменту (`?t=<sec>`), а не мёртвым сниппетом.
- `cd backend && bun run typecheck && bun run lint && bun run build` — зелёные.

Закрывает: R19, R20, R21.

---

## Требования (трассировка)

R1 строка задачи→/issues/:id (виджет)·R2 кликабельный кружок (виджет)·R3 строка→/issues/:id (вкладка результата)·R4 enum+3 case резолвера·R5 двухуровневая маскировка friction·R6 эндпоинт принимает goal/insight/friction·R7 AdminSetting frictionVerbatimRoles·R8 тесты резолвера·R9 цель useProvenance+сниппет·R10 пустой источник→нет блока·R11 блокер кликабелен по факту источника·R12 риск drill·R13 идея-кластер→/ideas·R14 агрегаты статичны·R15 список конфликтов без sourceBlockIds наружу·R16 конфликт useProvenance('friction')·R17 два уровня визуально·R18 тест эндпоинта friction по ролям·R19 fast-воркер матчит IdeaBlock·R20 идемпотентность матчинга·R21 prompt caching.

## Pre-mortem / Риски + ревью-аспекты (для strict-production-review-gate)

- **Деагрегация конфликта мимо прав — главный риск.** Ревью: путь `/provenance/friction/:id` берёт роль из guard, не из тела? Роль вне `frictionVerbatimRoles` НЕ получает дословной цитаты И `?t=`? Список дашборда НЕ отдаёт `sourceBlockIds`? Блок в closed-группе маскируется независимо от роли (R8в)?
- **N+1 на дашборде.** Списки блокеров/рисков/конфликтов НЕ резолвят провенанс по каждому элементу — резолв только on-demand по клику (ленивый `useProvenance`). Ревью: нет цикла `resolve` внутри рендера списка.
- **Staleness** — снят on-demand (В4): снимок не вводим. Ревью: нет нового `previewQuote` на goal/friction.
- **Единица времени** (RC провенанс-ТЗ): friction/goal deepLink через `buildDeepLink` (мс→сек). Ревью: агрегатный deepLink конфликта — без `?t=` (на встречу целиком).
- **RBAC/tenant:** все новые запросы резолвера с `tenantId`; `EntityLink`/`Goal`/`Insight` findFirst с `tenantId`.
- **Observability:** N/A (нет новых воркеров/очередей; A/B/C/D — переиспользование). E — существующий воркер, метрики уже есть.
- **Тесты:** R8 (резолвер, 4 кейса), R18 (эндпоинт friction по ролям), R19 (fast-воркер матчинг). LLM-извлечение E — golden-фикстура «цитата совпадает/не совпадает».

## Идемпотентность / feature-flag / prod-deploy

- **Миграций нет** (RC-8) — B/C/D on-demand, E заполняет существующее поле.
- **Ship-On:** всё выкатывается включённым. `provenance.frictionVerbatimRoles` — тип «решение владельца» (матрица доступа), ON с дефолтом `['owner','admin']` → строка в `docs/operations/feature-flags.md`.
- **prod-deploy-log:** Шаг 1 (новая AdminSetting — сид через `apply-prod-deploy.ts` `STEPS`, идемпотентно, no-op при повторе), Шаг 12 (эндпоинт `/provenance` принимает новые типы — Swagger smoke + grep `friction`). Прямой diff-блок в чате после push.
- **E (Ф5):** если тронут `meeting-report-fast.prompt.ts` — раздел prompt caching (К-2 R21); прод-смоук: новая загрузка встречи → задача показывает рабочий deepLink.

## DoD

- `bun run typecheck` (вкл. `.spec`)/`lint`/`build` зелёные (backend+frontend); vitest по затронутым (provenance.service.spec, provenance-controller.spec, fast-worker.spec).
- second-brain обновлён: `02_architecture/module-map.md` (обобщённый резолвер), `01_projects/api-layer.md` (эндпоинт принимает goal/insight/friction), `01_projects/director-dashboard.md` (drill блокер/риск/идея/конфликт), `01_projects/admin.md` (frictionVerbatimRoles), `04_не-сделано/README.md` (закрыть строку RC-5/E при выкате).
- `docs/operations/feature-flags.md` (frictionVerbatimRoles); `prod-deploy-log.md` Шаги 1/12; рефлексия в `05_история/`.
- Все 21 R закрыты фазами; инвариант В5 (права зрителя) соблюдён на каждом новом пути; ни одного «мёртвого аффорданса» (грепом: `ArrowUpRight`/`Circle` без обработчика в затронутых виджетах — 0).

## Итог

**Реализовано целиком (все 6 фаз, ветка work/2026-07-02).**

| Фаза | Коммит | Что вышло |
|---|---|---|
| Ф0 (A) | `55c3f8a9` | Задача из встречи в виджете журнала и на вкладке результата → `/issues/:id` (stretched-link) + кликабельный кружок «выполнено» (оптимистично). |
| Ф1 | `ebf1fc2c` | `ProvenanceEntityType` +goal/insight/friction; `collectSourceBlockIds` читает Goal/Insight/EntityLink; `maskFrictionByRole` (агрегат/дословно по роли, поверх `partitionProjectionsByAccess`); роль из `RbacService.getMembershipRole`; AdminSetting `provenance.frictionVerbatimRoles` (реестр+сид+STEPS); тесты R8 (6). |
| Ф2 (B) | `282b5fc1` | Цель: ленивый `useProvenance('goal')` + блок «Откуда» (сниппет + дровер); пустой источник → блок скрыт. |
| Ф3 (C) | `6019ba22` | Дашборд День/Неделя/Месяц: блокер/риск/идея кликабельны по факту источника; `SignalRow` `onClick`/`href`; агрегаты статичны; мёртвая `ArrowUpRight` убрана. |
| Ф4 (D) | `5472462a` | Конфликт person↔person кликабелен → дровер `friction` (двухуровнево по роли из Ф1); `getTeamFrictions` без `sourceBlockIds` (anti-leak); тесты R18 (контроллер role-from-guard + leak). |
| Ф5 (E) | `54f35999` | `classify` резолвит `meeting_report`→встреча (снятие `report_`) → задачи/решения/идеи отчётного пути получают рабочий `/meetings/:id/result?t=<sec>` вместо сломанного `/chats/report_<id>`. Тесты Ф5 (3). |

**Верификация:** vitest `provenance.service.spec.ts` (47) + `provenance.controller.spec.ts` (6) + `operations-dashboard.friction-leak.spec.ts` (1) — зелёные; backend `typecheck`/`build` (heap 8GB), frontend `typecheck`/`build` — зелёные; DoD-грепы (нет мёртвых аффордансов) — 0. Миграций нет.

**Отклонение от буквы ТЗ (обосновано):** Ф5-якорь `meeting-report-fast.worker.ts:387 evidenceBlockIds:[]` устарел (это `evidenceBlockIds` **глав**, а fast-воркер задачи не персистит — task-pipeline унифицирован). Реальный корень «мёртвого deepLink meeting-рождённого» — `classify` трактовал RawEvent `meeting_report` как `chat`. Фикс в `classify` — единый корень: чинит deepLink для ВСЕГО report-производного (задачи+решения+идеи), а не только задач fast-пути. Философия ТЗ («единый механизм, не заплатка») соблюдена; матчинг sourceQuote→транскрипт (для суб-секундного `?t=` у report-блоков без transcript-таймингов) не потребовался — deepLink уже несёт `?t=<startMs/1000>` из evidence блока (или `?t=0` — рабочая ссылка на встречу).

**Что осталось / вне scope (как в ТЗ):** денорм-снимок provenance на цель/трение (В4 — не делаем); список целей `/goals` (только детальная); вторая волна провенанс-хребта (chat/документ/аудио — `04_не-сделано` строка 2026-06-20); отдельная HR-роль дословного конфликта (крутилка позволяет без кода). Закрытие строки RC-5 в `04_не-сделано` — на prod-cut (после выката).
