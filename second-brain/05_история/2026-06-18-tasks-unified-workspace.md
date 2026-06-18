---
date: 2026-06-18
feature: tasks-unified-workspace
branch: feature/tasks-unified-workspace
distilled: false
---

# Единый рабочий стол «Задачи» (проект = фильтр) + rebase на актуальный dev

## Что было поставлено
Реализовать ТЗ `plans/tz/2026-06-18-tasks-unified-workspace-phase1.md` (расширенный объём) силами tz-orchestrator: пункт меню «Задачи» (`/projects`) должен открывать единый рабочий стол с видами Доска/Список/Спринты/Входящие/Архив и фильтрами (проект/команда/спринт/поиск), где проект — фильтр, а не отдельный экран. Backend: сквозной `GET /api/v1/issues` + переход-по-категории. Видимость рядового — через существующий `Org.visibilityMode`.

## Как решал
8 фаз, каждая — картография (read-only Explore/Grep/Read) → самодостаточный промпт кодеру (`general-purpose`) → независимая приёмка (грепы + re-Read + свой typecheck/lint/build/vitest) → ревью → пофазный коммит.

- **Ф1** (`71a4aeb4`): `OrgIssuesController` (клон `me-inbox.controller`), `IssuesService.findAllAcrossProjects` (where как `findAll`; self-scope в `where.AND`, чтобы не затереть `q`-`OR`); видимость через **уже публичный** `RbacService.loadContext` (отдельный `getAccessContext` не понадобился). 8 тестов видимости (manager+strict не видит чужое).
- **Ф2** (`eba9aad3`): `transition-to-category` — резолв статуса по категории (паттерн из `moveToProject`) + **делегирование в `transitionState`** (не дублируя activity/ingest/webhooks). 5 unit-тестов.
- **Ф3** (`6040e2b4`): api `listOrg`/`transitionToCategory`, домен `stateCategory`, хук `useOrgIssues`.
- **Ф4** (`f38e8969`): `OrgBoard` (отдельный от `Board`, R6); группировка через `orgBoardColumnFor` (гарантирует 1 из 5 колонок, защита от null/`blocked`); оптимистика локальным override-map.
- **Ф5** (`cea9ae08`): `TasksWorkspaceClient` + смена маршрута, `ProjectsListClient` удалён. Правило хуков — `useIssues` вынесен в подкомпонент `ProjectListView`.
- **Ф6** (`4f3c1830`): виды «Спринты» (`useSprints`) + «Входящие» (`IntakeBoard`, гейт руководителю) + фильтр спринта.
- **Ф7** (`cee31300`): тумблер `visibilityMode` уже был в `OrganizationClient` — добавлена только подсказка-ссылка со стола.
- **Ф8**: second-brain (`frontend-pages`, `module-map`, `04_не-сделано`), эта рефлексия, `prod-deploy-log` Шаг 12, Итог в ТЗ.

## Что вышло
Backend: typecheck/lint/build = 0, tracker-тесты **248 passed** (29 файлов). Frontend: typecheck/lint = 0, `next build` = 0 (дважды), OrgBoard **8 passed**. 7 пофазных коммитов.

## Чему научился (грабли и уроки)
1. **Главная грабля сессии — неправильная база ветки.** Worktree был отпочкован от HEAD соседней фичи-ветки (`d2403217`), которая оказалась `dev~5`: между ней и `dev` влили merge `#47` (переформатирование трекера, 294 файла, −11745 строк комментариев + кавычки `'`→`"`). Код лёг на устаревшие версии. Владелец вовремя поймал. **Урок: перед `git worktree add` сверять выбранную базу с актуальным `dev` (`git merge-base`, `git log dev`), а не брать HEAD текущей ветки вслепую.** Особенно в репо с 8 параллельными worktree.
2. **Rebase на reformatted-dev = почти сплошь косметические конфликты.** Авто-merge вытянул бо́льшую часть; конфликтовали только места моих вставок. Разрешал по принципу «структура dev + мои добавления», выкидывая вычищенные dev-ом комментарии и матча двойные кавычки. Все 4 коммита переехали чисто, верификация против dev зелёная — дрейфа API не было (проверил `loadContext`/`transitionState`/`IssueCard`-пропсы в dev ДО rebase).
3. **`useTrackerLiveRefresh` матчит SWR-ключ по ТОЧНОМУ `key[0] === 'tracker.issues'`** (не `startsWith`). Поэтому `useOrgIssues` обязан иметь `key[0]==='tracker.issues'` (+ дискриминатор `'org'`), иначе доска не обновляется на live-события. Доказал чтением предиката, не угадал.
4. **Источник org-wide спринтов — `@/hooks/useSprints` + `@/api/sprints.api`** (root), а НЕ `@/api/tracker/sprints.api.ts` (там только archive + cycle-методы). Сначала ошибочно решил «источника нет» — помогла проверка по существующему `/sprints` (`SprintsListClient`).
5. **`Org.visibilityMode`-тумблер уже существовал** и уже упоминал «задачи коллег» — переиспользование (Р4) сэкономило фазу; не плодить второй рубильник.
