---
type: tz
status: ready-to-implement
feature: tracker-card-redesign-and-progress
date: 2026-06-20
owner: Сергей (владелец Z/Кора)
relates_to:
  - plans/analysis/2026-06-20-tracker-card-anatomy-and-board-ux.md
  - plans/analysis/2026-06-06-tracker-ux-audit-and-simplification.md
  - plans/tz/2026-06-20-assistant-assign-task-to-others-and-notify.md
  - plans/tz/2026-06-17-cabinet-breadcrumbs-and-mobile-back.md
  - second-brain/01_projects/tracker.md
---
> Анализ: `plans/analysis/2026-06-20-tracker-card-anatomy-and-board-ux.md` (status: research-complete) · Статус согласования развилок: 2026-06-20 (Р1, Р2, Р3 — владелец «согласен», делаем все три волны одним ТЗ).

# ТЗ: Редизайн карточки трекера + датированный прогресс + паритет (3 волны)

## Принцип
Лицо карточки на доске считывается за <2 сек (что/кто/когда/насколько готово/откуда), богатство — в детали; «датированный прогресс» — отдельная сущность, авто-черновик которой готовит Кора из графа знаний; затем добираем table-stakes-паритет. Делаем тремя волнами в одном ТЗ — чтобы Волна 3 не потерялась.

## Вне scope / отложено владельцем (каждый хвост — судьба)
- **Прогресс в Telegram-помощнике** — отдельным ТЗ, пересекается с [[../analysis/2026-06-11-telegram-agentic-interface]] / assistant-channels. Здесь только кабинет.
- **Критический путь / авто-сдвиг сроков на Ганте** — отдельный vNext-ТЗ; здесь Гант только включаем (Ф4), зависимости уже есть (`IssueRelation`).
- **Навигация/термины/«Принять» во Входящих** — закрыты прошлым аудитом [2026-06-06](../analysis/2026-06-06-tracker-ux-audit-and-simplification.md), не дублируем.
- **Привязка worklog к деньгам/биллингу** (Shtab-стиль) — vNext; здесь только учёт минут (Ф12).

---

## Цель + Зачем
**Болезненное состояние (из анализа §1):** на доске карточка узкая, тёмная, заголовок в одну строку с обрезкой — «не видно, что за задача и что внутри»; при этом богатые возможности (переписка, файлы, чек-листы, история) спрятаны и не обнаруживаются; нет first-class «датированного прогресса»; отсутствуют table-stakes (кастом-поля, автоматизации, повторяющиеся задачи, worklog).
**Метрика «решено»:**
- Волна 1: на лице карточки присутствуют и считываются ≥5 сигналов (приоритет-цвет, прогресс, дедлайн-срочность, исполнитель, провенанс), заголовок не режется на полуслове (2 строки), контраст текста ≥4.5:1.
- Волна 2: у задачи можно вести датированные обновления прогресса; ≥1 авто-черновик из графа доступен к подтверждению, если по задаче были сигналы; у обновления виден **кликабельный источник** (deep-link, Д1); черновик **всплывает в колокольчике** исполнителю (Д3); доступна **сводка изменений по задаче** (catch-up, Ф8b/Д5).
- Волна 3: задача поддерживает кастом-поля, повторение, шаблон, worklog (под флагом проекта); правила-автоматизации применяются к событиям задачи.

Доказательная база (research-цитаты с URL) — в анализе §5–§8: Linear/Trello/Kaiten (фасад), Asana/Linear Project Update (датированный прогресс как сущность), NN/g + Refactoring UI + WCAG (считываемость), EasyStandup/Steady (авто-журнал из активности).

---

## REALITY-CHECK (что уже есть / чего нет — проверено кодом 2026-06-20)

**Уже есть (НЕ переделывать, переиспользовать):**
- Модель `Issue` богатая ([verified] `backend/prisma/schema.prisma:9174`): `priority`, `startDate`/`dueDate`/`completedAt`, `descriptionStripped`, `sourceBlockIds`/`previewQuote`/`previewSourceRef`/`confidence` (провенанс), `checklistTotalCount`/`checklistDoneCount`, `linkedMeetingIds`, `externalSource`.
- Деталь задачи раскрывает всё ([verified] `frontend/app/(authenticated)/issues/[id]/IssueDetailClient.tsx:54-126`): описание, подзадачи, чек-листы, связи, похожие, **файлы** (`IssueAttachment`), AI-чат, **комментарии** (`IssueComment`: треды/голос/@/спасибо), **активность** (`IssueActivity`).
- Домен карточки уже несёт нужные поля ([verified] `frontend/src/domain/tracker/issue.ts:152-197`) — Волна 1 **без бэкенда/миграций**.
- `ActivityRecorderService.record()` ([verified] `backend/src/modules/tracker/services/activity-recorder.service.ts:26`) — точка записи `IssueActivity` (использовать в Волне 2).
- Образец воркера: `GoalAlignmentLowCron` ([verified] `backend/src/modules/tracker/workers/goal-alignment-low.cron.ts`) — `@Cron` + `cfg.getDynamic(flag)` + Redis-dedup `SETNX EX` + per-Org loop + metrics. **Копировать паттерн** для воркера авто-черновика.
- Образец API: `CommentsController` ([verified] `backend/src/modules/tracker/controllers/comments.controller.ts`) — `@Controller('api/v1')`, `CookieAuthGuard`+`TenantGuard`, `ZodValidationPipe`, `RequireSubscription`, RBAC `canRead/canWrite('issue')`, коды ошибок `tenant_required`/`forbidden`. **Копировать для прогресс-апдейтов и Волны 3.**
- Образец кастом-полей: `TableProperty`/`TablePropType` ([verified] `schema.prisma:11217`) — `config Json` + фракционный `order Decimal` + `isPrimary`. **Образец для `IssueFieldDef` (Ф9).**
- Зависимости задач — **есть** `IssueRelation` (blocks/blocked_by/duplicates/relates_to) + UI `IssueRelations`. Гант-вид — **есть** `gantt/page.tsx` + `Project.gantViewEnabled` (default false). Загрузка команды — **есть** `workload/`. (Red-team в анализе ошибочно счёл их отсутствующими — исправлено.)

**Чего НЕТ (проверено отсутствием модели в `schema.prisma`):** сущности «обновление прогресса», `IssueFieldDef/Value` (кастом-поля задачи), `IssueAutomationRule`, `IssueRecurrence`/`IssueTemplate`, `IssueWorklog` (флаг `timeTrackingEnabled` есть, модели нет).

**Прод-лаг:** деталь карточки чинилась в ветке (аудит 2026-06-06 §3.1) — перед Волной 1 убедиться, что `/issues/[id]` открывается (иначе бейджи «есть обсуждение» ведут в тупик).

---

## Принятые решения владельца (2026-06-20 — не пересматривать)

| # | Решение | Обоснование (почему) |
|---|---|---|
| Р1 | Карточка **компактная по умолчанию** + 3 сканируемых сигнала (приоритет-цвет с дублем иконка/текст, прогресс-бар, чип «из встречи/из решения»), 2-строчный заголовок, починка контраста. «Широкий вид» — переключатель, не дефолт. Тепло/палитру взять из прототипа `frontend/public/demo/index.html`. | Анализ §10: широкая-дефолт регрессит скан большого бэклога и мобильный (NN/g, IxDF); жалоба самого Kaiten на «тесноту» = лечить считываемость, не ширину. WCAG 1.4.1: цвет всегда с дублем. |
| Р2 | Датированный прогресс — **отдельная сущность** (дата + health 3 цвета + текст + опц. «сделано/дальше»), **авто-черновик из графа**, человек подтверждает (не авто-постинг). | Анализ §7: комментарии тонут; Asana/Linear вынесли в first-class; ручной ввод = busywork/слежка (Jira-worklog); авто-сбор из графа — обгон, ядро Коры. |
| Р3 | Три волны в одном ТЗ, порядок Волна1→Волна2→Волна3. | Анализ §11: Волна 1 дёшево чинит жалобу; Волна 2 даёт обгон; Волна 3 — догон-пол. |
| Р4 | Гант: включить `gantViewEnabled` по умолчанию (default true + backfill существующих), как `cycleViewEnabled`/`intakeViewEnabled`. | Ship-On (CLAUDE.md п.8): «спящий OFF» запрещён; Гант — table-stakes (Яндекс Трекер/Asana/Bitrix). |

**Доказательство выбора** — состязательные таблицы и матрица вариантов в анализе §9–§11 (не дублируем; оркестратор читает анализ).

## Поправки 2026-06-21 — разотложено по свежему коду (делегировано владельцем: «сам принимай решения, максимально закрой ТЗ»)

> Состязательный аудит (7 направлений, investigate→verify по живому коду) сверил отложенное в этом ТЗ с кодом последних коммитов: Config-TZ1 крутилки + UI-каркас (`40ef424d`/`19c091f5`); провенанс-консолидация (`ad7cf8b8`/`da41dff9`/`20b7f38a`); единый центр уведомлений (`092f7851`). Что разблокировано/удешевлено и внесено в фазы ниже:

| # | Решение | Куда | Почему дёшево / разблокировано именно сейчас |
|---|---|---|---|
| Д1 | **Кликабельный провенанс-чип в ленте прогресса** (источник из встречи/решения/документа/чата, deep-link `?t=`/`?page=N`/`?m=`). | Ф5 (+2 колонки-снимка), Ф6 (DTO), Ф7 (R13a), Ф8 (R16a) | Весь конвейер `sourceBlockIds → computePreviewSnapshot → ProvenancePreviewRef → ProvenancePreviewSnippet` уже боевой на карточках задач/решений (`ad7cf8b8`). ⚠️ `computePreviewSnapshot` ([verified] `backend/src/modules/knowledge-core/services/provenance.service.ts:475`) пока БЕЗ вызывающих — воркер Ф7 станет первым; Acceptance Ф7 ОБЯЗАН протестировать непустой `previewSourceRef` с корректным `deepLink`. |
| Д2 | **Крутилки трекера — плагин в готовый каркас `DomainSettings`**, не форма с нуля и не ENV/хардкод. | Инварианты, Ф7 R15, Ф10, Ф11, Ф12 | `40ef424d`/`19c091f5` построили scaffold (reason-gate + история) + 7 эталонных разделов; домен `tracker` в реестре уже заведён. Эталон-плагин — `frontend/app/(admin)/admin/probe/ProbeSettingsClient.tsx`. ~6 механических вставок на фазу. |
| Д3 | **Черновик прогресса всплывает в колокольчике** (кабинет, БЕЗ Telegram) как pending-действие — исполнителю задачи. | Ф8 R17a | Провайдерный паттерн центра уведомлений готов (`task-closure.provider.ts`); confirm делегирует в эндпоинт Ф6 (pending→accepted). Закрывает дыру: иначе авто-черновик Ф7 никто не находит. Зависит от Ф5→Ф6→Ф7 (внутри ТЗ), поэтому строго в Ф8 (не «разблокировано свежим кодом», а достройка своей же Волны 2 на готовом паттерне). |
| Д4 | **Бейджи «есть обсуждение / есть файлы» — только в «широком виде»** (Ф3); компактное лицо держим ≤5 сигналов (гард Р1 соблюдён). Backend — opt-in relation `_count`, БЕЗ миграции и денорм-колонок. | Ф1 R5.2 (backend), Ф3 R8 | Идиома opt-in `_count`+флаг уже в `issues.service.ts` (`includeChildrenCount`); relations `Issue.comments/attachments` есть (`schema.prisma:9290-9291`). Данные разблокированы; **компактного лица не касаемся** — гард §Риски «не добавлять счётчики на лицо без явного решения» соблюдён (бейджи вне дефолтного скан-вида, в опциональном широком). |
| Д5 | **AI-сводка «что произошло по задаче» (catch-up)** — новая Ф8b (анализ §8 рекомендовал, в ТЗ не было). On-demand, эфемерно, без миграции. | Ф8b (после Ф8) | Переиспользует `SprintAnalystService.getDailyDigest` + `sprint-daily-digest.prompt.ts` (cache-friendly) — давно отлаженный паттерн (НЕ свежий код; recentCodeUnblocks=false, честно). +taskType `issue-activity-digest`. |
| Д6 | «Сворачивание групп меню + единый nav-конфиг» **снято из «Опционально» — уже реализовано** (`274c2554`/`3931de0e`: `nav-config.ts` единый конфиг + `Sidebar.tsx` SidebarSubgroup, localStorage-персист, гард `nav-subset.spec.ts`). | «Опционально» | Чтобы оркестратор не переделывал готовое и не отрегрессил рабочий SidebarSubgroup. |

**Остаётся отложенным (свежий код НЕ разблокировал — проверено отсутствием моделей/движков в коде):** worklog↔деньги/биллинг (Ф12 vNext), критпуть/авто-сдвиг Ганта (Ф4 vNext), кастом-поля на лице + formula/rollup/relation-типы (Ф9), межпроектные/расписанные автоматизации (Ф10), сложный RRULE (Ф11 — нет либы `rrule`), per-проектная плотность в БД (Ф3 — localStorage остаётся), дедуп DnD `Board↔OrgBoard` (намеренно разная семантика sortable vs draggable), прогресс/сводка в Telegram (отдельное ТЗ assistant-channels), богатый «Календарь» (отдельное ТЗ).

> Владелец может отклонить любое Д1–Д6 точечно. Самое «пограничное» — Д4 (бейджи на широком виде) и Д5 (catch-up в самой тяжёлой волне): внесены как чёткие самодостаточные пункты, легко снимаемые.

---

## Scope: Входит / Не входит (на уровне ТЗ)
**Входит:** Ф1–Ф12 ниже (Волна 1 фронт; Волна 2 сущность+воркер+UI; Волна 3 кастом-поля/автоматизации/повторение+шаблоны/worklog).
**Не входит:** см. «Вне scope» выше + любые правки навигации/терминов/Входящих.

## Граничные контракты с другими ТЗ
- Провенанс-резолв — через существующий `ProvenanceService`/`ProvenanceChip` (не реализовывать заново; `sourceBlockIds`→deepLink уже есть). **Для прогресса (Д1) — `ProvenanceService.computePreviewSnapshot(tenantId, sourceBlockIds)` (СНИМОК на момент сбора воркером), не живой per-viewer `resolve()`**; снимок кладётся в колонки `IssueProgressUpdate.previewQuote/previewSourceRef` (как у `Issue`), виден тому, кому видна задача (инвариант доступа — права на задачу). Воркер Ф7 — первый прод-вызывающий `computePreviewSnapshot`.
- Граф знаний (IdeaBlock, матч блок↔задача) — переиспользовать механику `TaskClosureCandidate` ([verified] `schema.prisma:9327`, матч `sourceBlockId`↔`issueId` + cosine), НЕ строить новый матчер.
- LLM — только через `LlmRouterService` (taskType), не прямые вызовы провайдера.

## Инварианты Z (ссылки, не дублируем — проверить соблюдение)
Стек Bun+Node+TS; **миграции версионируемые** `bun run prisma:migrate -- --name <...>` (CLAUDE.md, skill `prisma-db-push-rules` — НЕ `db push`); `prisma:generate` после правок; скрипты — `createPrismaClient()` из `scripts/_lib/prisma.ts`, импорты `../src`; новые seed/patch/migrate → `apply-prod-deploy.ts` `STEPS` + `prod-deploy-log.md`; ENV только через `TypedConfigService`; **крутилки (пороги/кадэнс/округление) → AdminSetting** через `getDynamic`+registry+seed+UI, не ENV/хардкод (UI — **плагин в готовый каркас `DomainSettings`**, НЕ форма с нуля: ключ в `backend/src/modules/admin/settings/admin-setting-schema-registry.ts` (домен `tracker` уже есть) + `seed-admin-setting-tracker.ts` по образцу `seed-admin-setting-worker-knobs.ts` + строка в `apply-prod-deploy.ts` `STEPS` (phase `seed-base`) + доменная страница `TrackerSettingsClient.tsx` = `const GROUPS: SettingsGroup[]` + `<DomainSettingsClient/>` дословно по `frontend/app/(admin)/admin/probe/ProbeSettingsClient.tsx` + пункт в `frontend/app/(admin)/admin/navigation.ts` секция `ai`; kill-switch boolean → `severity 'high'` (даёт reason-gate автоматически); каркас построен в `40ef424d`/`19c091f5`); multi-tenancy `@@index([tenantId,…])`+`TenantGuard`; LLM primary DeepSeek/OpenAI-proxy, embeddings `text-embedding-3-small`, раздел «prompt caching» обязателен; флаги — Ship-On (только kill-switch или решение-владельца); **UI только русский**, парные токены `bg-{color}`+`text-{color}-fg`; **без нарративных комментариев в TS** (Prisma `///`-доки контракта разрешены — как в текущей схеме).

---

# ВОЛНА 0 — Функциональные/гигиенические хвосты трекера (быстрые, идут первыми)

> Подобраны из реестра «не-сделано» по запросу владельца 2026-06-20 («внести все важные хвосты трекера»).
>
> **Назначение задачи на другого + уведомление исполнителю — УЖЕ реализовано на dev**, переделывать не нужно. Сделано в ТЗ [`assistant-assign-task-to-others-and-notify`](2026-06-20-assistant-assign-task-to-others-and-notify.md), Фазы 1–5, коммиты `642d52cf`→`a1d616b4`→`939d7165`→`240e388c`: эндпоинт `POST /me/tasks/assign` + `AssigneeResolverService` (резолв имени→user, коды `assignee_not_found`/`assignee_ambiguous`) + инструмент помощника `assign_task` + единое уведомление `issue.assigned` (listener `issue-assignment-notifier.service.ts`, рендер Telegram+MAX) + человекочитаемый текст подтверждения (`CONFIRM_TOOL_RU_NAMES`). **Действие здесь: ровно выкатить на прод этим же релизом** (`docker compose up -d --build backend`; миграций нет — `IssueAssignee` уже есть). Реестр «не-сделано» был устаревшим — исправлен.

## Фаза 0.1 — Хлебная крошка `/issues/[id]` ведёт назад на доску проекта
**Цель:** убрать «тупиковую» крошку — со страницы задачи можно вернуться на доску её проекта.
**Картография:** `frontend/app/(authenticated)/issues/[id]/IssueDetailClient.tsx:25` (`useRegisterBreadcrumb`), `frontend/src/ui/components/breadcrumbs/BreadcrumbContext`, backend-сборка ответа задачи (`backend/src/modules/tracker/services/issues.service.ts` findOne/DTO), домен `frontend/src/domain/tracker/issue.ts:152` (нет `projectSlug`). Прежняя причина отсрочки («домен не несёт slug, доп-fetch дорог») снимается: проект уже в join'е задачи — отдаём `projectSlug` в ответе, без отдельного запроса.
**Что входит (R22):**
- **R22.** `GET /api/v1/issues/:id` (и list, если дёшево) возвращает `projectSlug` (из `project.slug`); домен `Issue` получает `projectSlug: string | null`; крошка сегмента `issues` получает `parentHref = /projects/${projectSlug}/board` (для пустого — без перехода, как было). `[ASSUMPTION: дефолтная доска проекта открывается по slug; если маршрут досок иной — оркестратор сверяет по boards-роуту]`.
**Что НЕ входит:** полный объект проекта в ответе задачи; крошки для списков; мобильная «назад» (закрыта своим ТЗ).
**Acceptance:** открыть задачу → крошка «Проекты / <название проекта> / <задача>», клик по проекту ведёт на доску; `grep projectSlug backend/.../issues` есть; `cd frontend && bun run typecheck && bun run lint` зелёные; Playwright: переход с задачи на доску проекта работает.
**Closes:** R22.

## Фаза 0.2 — Чистка легаси `/tasks` (осиротевшая страница)
**Цель:** убрать «серую» страницу-сироту: меню «Задачи» ведёт на рабочий стол `/projects`, на `/tasks` ничего не ссылается.
**Картография:** `frontend/app/(authenticated)/tasks/{page.tsx,TasksClient.tsx}`, `frontend/src/api/.../tasks*` (`tasksApi`, «задачи из встреч»), `frontend/src/ui/components/app-shell/nav-config.ts` (пункт «Задачи»→`/projects`).
**Что входит (R23):**
- **R23.** `/tasks` → серверный `redirect('/projects')` (Next.js App Router) как безопасный дефолт; перед удалением `TasksClient`/`tasksApi` — грепнуть входящие импорты (`from .*tasks/TasksClient`, `tasksApi`), удалять только при нуле ссылок; убедиться, что ни один пункт меню/ссылка не ведёт на `/tasks`.
**Что НЕ входит:** удаление бэкенд-модели `Task` (action items из встреч — данные используются в другом месте, НЕ трогать); только осиротевшая фронт-страница/клиент.
**Acceptance:** заход на `/tasks` редиректит на `/projects`; `grep -r "/tasks\"" frontend/src/ui/components/app-shell` → нет пунктов меню на `/tasks`; нет осиротевших импортов `TasksClient`; `bun run build` зелёный.
**Closes:** R23.

---

# ВОЛНА 1 — Лицо карточки (фронт, без миграций кроме Р4)

## Фаза 1 — Редизайн `IssueCard.tsx` (3 сигнала + 2 строки + провенанс + контраст)
**Цель:** карточка считывается за <2 сек; добавить недостающие сигналы из уже имеющихся полей домена.
**Картография:** `frontend/src/ui/tracker/IssueCard.tsx` (текущий рендер :31-92), `IssuePriorityIcon.tsx`, `frontend/src/domain/tracker/{issue.ts,enums.ts}`, палитра-референс `frontend/public/demo/index.html` (секция «Доска задач», классы `chip info/warn/risk`, `progress`, `led`), токены `frontend/tailwind.config.ts`.
**Что входит (R1–R5):**
- **R1.** Заголовок — **2 строки** (`line-clamp-2`, line-height ~1.35), без жёсткого `truncate` одной строкой.
- **R2.** **Чип приоритета** цветом с дублем «иконка + текст» (`ISSUE_PRIORITY_LABELS`): urgent→danger, high→warning, medium→нейтральный, low/none→приглушённый. Парные токены `bg-*`+`text-*-fg`, контраст индикатора ≥3:1 (WCAG 1.4.11), текст ≥4.5:1. Не `text-white` на цветном.
- **R3.** **Прогресс-бар** (визуальный, не только «3/7»): доля = `checklistDoneCount/checklistTotalCount`, если чек-листов нет — скрыт. Цвет: норма→accent, при просрочке задачи→warning.
- **R4.** **Чип «из встречи / из решения»**: если `sourceBlockIds.length>0` или `externalSource∈{meeting,...}` — показать чип источника (встреча/решение/письмо/чат/помощник по `externalSource`+маппинг). Это дифференциатор Коры — на лице обязателен. **Снимок цитаты-источника брать из уже отдаваемых list-DTO полей `previewQuote`/`previewSourceRef`** (добавлены `ad7cf8b8`; домен `issueFromApi` уже маппит их в `provenancePreview` через `mapPreviewToProvenanceRef`, а `IssueCard` уже встраивает `<ProvenancePreviewSnippet preview={issue.provenancePreview}/>` под `!compact`) — **НЕ резолвить провенанс на фронте заново**.
- **R5.** **Дедлайн-чип с цветом срочности** (использовать `dueDateLabel`, `isOverdue`→danger, «сегодня/завтра»→warning); рядом **дата начала** `startDate` если задана («с 18 июня»). Бейджи-намёки «есть обсуждение/файлы» **НЕ на компактном лице** (гард Р1: ≤5 сигналов, §Риски) — вынесены в «широкий вид» (Ф3 R8); данные для них — opt-in `_count` (R5.2 ниже).
- **R5.2 (backend, лёгкий — Д4).** Источник данных для бейджей обсуждения/файлов **без миграции и денорм-колонок**: в `IssueResponseDto` добавить `commentCount: number | null` + `attachmentCount: number | null` (null = не запрошено). В `issues.service.ts` (`findAll` ~:443 и `findAllAcrossProjects` ~:541) при `query.includeEngagementCount===true` добавить в `include`: `_count: { select: { comments: { where: { deletedAt: null } }, attachments: true } }`; в маппинг отдать `(i as { _count?: {...} })._count?.comments ?? null` (через spread `{...base, commentCount}`, как `childrenCount` — НЕ внутрь строго-типизированного `toResponseFromInclude`). Новый флаг `includeEngagementCount: z.coerce.boolean().default(false)` в `list-issues-query.dto.ts` + `list-org-issues-query.dto.ts` (зеркало `includeChildrenCount`) **и в оба фронт-Request** (`issues.api.ts`). Доска передаёт `includeEngagementCount=true` ТОЛЬКО когда активен широкий вид. `IssueComment` имеет soft-delete (фильтр `deletedAt:null` обязателен); `IssueAttachment` — hard-delete (фильтр не нужен).
- Группировка whitespace: суть-блок (приоритет+заголовок) визуально отделён от мета-блока (исполнитель/дедлайн/прогресс/источник) — Refactoring UI.
**Что НЕ входит:** счётчики/бейджи комментариев и вложений **на компактном лице** (гард Р1 ≤5 сигналов) — рендер бейджей вынесен в «широкий вид» Ф3 (R8); денорм-колонки `commentCount`/`attachmentCount` на `Issue` НЕ вводим (relation `_count` достаточно — R5.2); полноразмерные чипы/превью комментариев на лице; «широкий вид» как режим (Ф3); прочие изменения API кроме лёгкого opt-in `_count` (R5.2).
**Acceptance:**
- `grep -E "line-clamp-2|sourceBlockIds|externalSource" frontend/src/ui/tracker/IssueCard.tsx` → совпадения есть.
- Нет `truncate` на заголовке (есть `line-clamp-2`); нет `text-white`.
- `grep -E "includeEngagementCount|_count" backend/src/modules/tracker/services/issues.service.ts` → совпадения (R5.2); ответ list-DTO с `includeEngagementCount=true` несёт `commentCount`/`attachmentCount`, без флага — `null`.
- `cd frontend && bun run typecheck && bun run lint` + `cd backend && bun run typecheck` — зелёные.
- Визуально (Playwright, `qa-tester`): на доске у задачи с чек-листом виден прогресс-бар; у задачи из встречи — чип «из встречи»; длинный заголовок переносится на 2 строки, не режется.
**Closes:** R1, R2, R3, R4, R5.

## Фаза 2 — Фикс `IssueSidebar.tsx` (даты + резолв названий)
**Цель:** убрать сырой cuid, показать недостающие даты.
**Картография:** `frontend/src/ui/tracker/IssueSidebar.tsx:63-89` (сейчас `Срок`/`Создана`; `Спринт`={cycleId}, `Цель`={goalId} сырьём), хуки `frontend/src/hooks/tracker/useCycles`/`useGoals` (если есть; иначе include в `IssueApi`).
**Что входит (R6–R7):**
- **R6.** Добавить строки **«Срок начала»** (`startDate`) и **«Выполнена»** (`completedAt`) — формат `ru-RU`, «—» если пусто.
- **R7.** «Спринт» и «Цель» — резолвить в **название** (`Cycle.name`/`Goal.title`), не cuid. Если хук недоступен — добрать названия через include в ответе `GET /issues/:id` `[ASSUMPTION: проще обогатить ответ issue полями cycleName/goalName, чем тянуть отдельные запросы — оркестратор выбирает по факту наличия хуков]`.
**Что НЕ входит:** редактирование дат из sidebar (есть отдельные контролы); смена спринта/цели.
**Acceptance:** в sidebar нет отображения «голого» cuid для спринта/цели; видны «Срок начала»/«Выполнена»; `typecheck`/`lint` зелёные; Playwright: открыть задачу со спринтом → видно название спринта.
**Closes:** R6, R7.

## Фаза 3 — Переключатель плотности «Компактно / Широко»
**Цель:** дать «широкий вид» опцией, дефолт — компактный (Р1).
**Картография:** board-клиенты `frontend/app/(authenticated)/projects/[slug]/board/BoardClient.tsx` и `.../boards/[boardId]/board/BoardClient.tsx`, `frontend/app/(authenticated)/projects/TasksWorkspaceClient.tsx` (агрегированная доска «Задачи»), `IssueCard` проп `compact`.
**Что входит (R8):**
- **R8.** Тумблер «Компактно/Широко» в шапке доски; состояние персистится (localStorage ключ `tracker.cardDensity`, дефолт `compact`). «Широко» = расширенный режим `IssueCard` (превью `descriptionStripped` 1–2 строки, крупнее аватар/чипы; уже видимый под `!compact` сниппет цитаты-источника); «Компактно» = Ф1-режим. Дефолт компактный.
- **R8.1 (Д4 — бейджи обсуждения/файлов в широком виде).** В широком виде показать тихие hint-бейджи `💬 {commentCount}` при `commentCount>0` и `📎 {attachmentCount}` при `attachmentCount>0` (намёк на глубину детали; скрыты при 0/null). Данные — поля `commentCount`/`attachmentCount` (R5.2): доска передаёт `includeEngagementCount=true` в list-запрос **только когда активен широкий вид** (в компактном — не запрашивать, чтобы не грузить `_count` зря). На компактном лице бейджей нет (гард Р1).
**Что НЕ входит:** per-проектное хранение в БД (localStorage достаточно для MVP — `[ASSUMPTION]`); разные плотности на разных досках одновременно.
**Acceptance:** дефолт-рендер = компактный; переключение меняет вид и сохраняется после reload; `typecheck`/`lint` зелёные.
**Closes:** R8.

## Фаза 4 — Гант по умолчанию (Ship-On)
**Цель:** убрать «спящий OFF» (`gantViewEnabled` default false).
**Картография:** `Project.gantViewEnabled` (`schema.prisma:8865`), место чтения флага во вкладках проекта (`ProjectViewShell.tsx`/nav), backfill-паттерн `backend/scripts/backfill-*.ts`.
**Что входит (R9):**
- **R9.** Сменить default `gantViewEnabled` → `true` (миграция); backfill `gantViewEnabled=true` существующим проектам, у кого `false` и не выставлен явно владельцем `[ASSUMPTION: явного «владелец выключил» не отслеживаем — считаем все false дефолтными, ставим true; если позже нужна память выбора — отдельная колонка]`. Убедиться, что вкладка Гант рендерится при флаге true.
**Что НЕ входит:** критический путь/авто-сдвиг (vNext); удаление флага (оставляем как per-проектный view-тумблер, как `cycleViewEnabled`).
**Acceptance:**
- Миграция в `prisma/migrations/*` меняет default на true; `backfill-gant-view.ts` идемпотентен (повторный прогон = no-op), зарегистрирован в `apply-prod-deploy.ts` `STEPS` (phase backfill, skipBootstrap) и в `prod-deploy-log.md` Шаг 8.
- Новый проект создаётся с Гант-вкладкой видимой; `bun run prisma:generate` + `typecheck` зелёные.
**Closes:** R9.

---

# ВОЛНА 2 — Датированный прогресс (сущность + авто-черновик из графа)

## Фаза 5 — Prisma-модель `IssueProgressUpdate` + миграция
**Цель:** first-class «обновление прогресса».
**Контракт (дословный сниппет, добавить в `schema.prisma` рядом с `IssueComment`):**
```prisma
/// Датированное обновление прогресса задачи (Asana/Linear Project Update-стиль).
/// health — строкой (расширяемо, не enum). authorType=ai_agent + draftState=pending —
/// авто-черновик из графа, ждёт подтверждения человеком (НЕ авто-постинг).
model IssueProgressUpdate {
  id             String    @id @default(cuid())
  tenantId       String
  issueId        String
  authorId       String?   /// null пока авто-черновик не подтверждён
  authorType     String    @default("human") /// human | ai_agent
  health         String    /// on_track | at_risk | off_track (в норме/риск/буксует)
  body           String    @db.Text
  doneText       String?   @db.Text /// «что сделано»
  nextText       String?   @db.Text /// «что дальше»
  draftState     String?   /// null=опубликовано | pending | accepted | edited | rejected (для ai_agent)
  sourceBlockIds String[]  @default([]) /// провенанс: блоки графа авто-черновика
  evidenceQuote  String?   @db.Text
  confidence     Decimal?  @db.Decimal(4, 3)
  previewQuote     String? @db.Text /// Д1: снимок цитаты-источника (чип без живого резолва), контракт как Issue.previewQuote
  previewSourceRef Json?           /// Д1: снимок ProvenancePreviewRef (deepLink ?t=/?page=N/?m=, sourceType, attribution, label)
  periodStart    DateTime?
  periodEnd      DateTime?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
  deletedAt      DateTime?

  issue Issue @relation(fields: [issueId], references: [id], onDelete: Cascade)

  @@index([tenantId, issueId, createdAt])
  @@index([issueId, createdAt])
  @@index([tenantId, draftState])
}
```
+ в `model Issue` добавить `progressUpdates IssueProgressUpdate[]`.
**Acceptance:** `bun run prisma:migrate -- --name issue_progress_update` создаёт файл миграции; `prisma:generate` ок; `grep "model IssueProgressUpdate" schema.prisma` есть; миграция зарегистрирована (migrate deploy авто на проде). `prod-deploy-log.md` Шаг 4 обновлён.
**Что НЕ входит:** API/UI (Ф6/Ф8).
**Closes:** R10.

## Фаза 6 — Backend: сервис + контроллер + DTO (по образцу comments)
**Цель:** CRUD обновлений прогресса + запись в `IssueActivity`.
**Картография:** копия паттерна `CommentsController`/`CommentsService` (RBAC `canRead/canWrite('issue')`, `ZodValidationPipe`, `RequireSubscription`, коды `tenant_required`/`forbidden`), `ActivityRecorderService.record()`.
**Что входит (R11–R12):**
- **R11.** Эндпоинты: `GET /api/v1/issues/:id/progress-updates`, `POST /api/v1/issues/:id/progress-updates` (создать вручную), `PATCH /api/v1/progress-updates/:id` (автор/редактирование черновика), `POST /api/v1/progress-updates/:id/confirm` (для draft: pending→accepted|edited, проставить authorId/authorType), `DELETE /api/v1/progress-updates/:id`. Zod-DTO: `health∈{on_track,at_risk,off_track}`, `body` (1..2000), `doneText?`/`nextText?`. **Ответ обновления отдаёт `previewQuote: string|null` + `previewSourceRef: ProvenancePreviewRef|null`** (Д1, тип из `knowledge-core/services/provenance.service`, как `issue-response.dto.ts:27-28`; `previewSourceRef` типизировать на чтении `as ProvenancePreviewRef|null`). Swagger-теги `tracker / progress`.
- **R12.** При публикации/подтверждении — `ActivityRecorderService.record({verb:'progress_updated', actorType, metadata:{health}})`.
**Что НЕ входит:** воркер авто-черновика (Ф7); UI (Ф8).
**Acceptance:** Swagger `/api/docs` показывает 5 эндпоинтов; негативные: чужой tenant→`tenant_required`/403; невалидный `health`→400; `bunx vitest run` на новый spec сервиса зелёный; `bun run typecheck` (вкл. `.spec`) + `build` зелёные.
**Closes:** R11, R12.

## Фаза 7 — Воркер авто-черновика из графа + LLM taskType
**Цель:** Кора сама готовит черновик прогресса из сигналов, человек подтверждает.
**Картография:** образец `GoalAlignmentLowCron` (Cron+getDynamic+Redis-dedup+per-Org), матч блок↔задача — механика `TaskClosureCandidate`, `LlmRouterService` (taskType), prompt registry (`z-ai-agent-rules`), `ALL_LLM_TASK_TYPES`.
**Что входит (R13–R15):**
- **R13.** Воркер/cron `progress-auto-draft`: для активных задач (status=started) собрать **дельту-сигналы** с последнего обновления: закрытые `IssueChecklistItem` (по `completedAt`), смены статуса (`IssueActivity verb=status_changed`), упоминания задачи в графе (`sourceBlockIds`/блоки, ссылающиеся на issue — как `TaskClosureCandidate`). Если сигналов ≥ порога — создать `IssueProgressUpdate(authorType='ai_agent', draftState='pending')` с `sourceBlockIds`+`evidenceQuote`+`confidence`. Идемпотентность: Redis-dedup ключ `progress_auto_draft:<issueId>:<dayKey>` + не плодить второй pending на ту же задачу.
- **R13a (Д1 — провенанс черновика).** Из собранных `sourceBlockIds` вызвать `ProvenanceService.computePreviewSnapshot(tenantId, sourceBlockIds)` ([verified] `backend/src/modules/knowledge-core/services/provenance.service.ts:475`) и записать результат в `previewQuote`/`previewSourceRef` черновика. Источник проходит тот же deep-link-билдер (`?t=` встреча / `?page=N` документ / `?m=` сообщение чата), что и карточки задач — НЕ строить резолв заново. **⚠️ Воркер — первый прод-вызывающий `computePreviewSnapshot` (у метода 0 вызовов сейчас): Acceptance ОБЯЗАН проверить, что на сид-блоках возвращается непустой `previewSourceRef` с корректным `deepLink`.**
- **R14.** LLM taskType **`issue-progress-draft`**: SYSTEM стабильный (инструкция «сформулируй health+краткий прогресс из сигналов, человеческим языком, без воды»), переменные данные (задача + дельта-сигналы) — в конце user (**prompt caching**: см. раздел ниже). Провайдер — DeepSeek/OpenAI-proxy. Зарегистрировать в `ALL_LLM_TASK_TYPES` + admin-registry + seed + промпт-файл.
- **R15.** Крутилки → **AdminSetting** (getDynamic): `tracker.progressAutoDraftEnabled` (kill-switch, дефолт ON — Ship-On), `tracker.progressAutoDraftMinSignals` (порог, дефолт 2), кадэнс cron. Ни одной в ENV/хардкоде. **UI — плагин в каркас `DomainSettings` (Д2), НЕ форма с нуля:** доменная страница `TrackerSettingsClient.tsx` = `const GROUPS: SettingsGroup[]` (группа «Авто-черновик прогресса»: `progressAutoDraftEnabled` boolean `severity 'high'`→reason-gate, `progressAutoDraftMinSignals` `POSITIVE_INT min 1`, кадэнс cron) + `page.tsx` (~11 строк) + пункт в `navigation.ts` секция `ai` — дословно по `ProbeSettingsClient.tsx`; ключи в `admin-setting-schema-registry.ts` (домен `tracker` уже есть) + `seed-admin-setting-tracker.ts` (образец `seed-admin-setting-worker-knobs.ts`) + строка в `apply-prod-deploy.ts STEPS`.
**Совместимость с prompt caching:** SYSTEM не содержит данных задачи; меняется только хвост user (issue title/desc + список сигналов). Кэш DeepSeek/proxy сохраняется между задачами.
**Что НЕ входит:** авто-постинг без подтверждения (запрещено Р2); обучение/A-B качества черновика (vNext).
**Acceptance:** прогон воркера на сид-данных с закрытыми чек-пунктами создаёт `IssueProgressUpdate draftState=pending` с непустыми `sourceBlockIds`; повторный прогон в тот же день — no-op (dedup); `issue-progress-draft` присутствует в `ALL_LLM_TASK_TYPES` (grep); kill-switch OFF → воркер пропускает (лог); spec воркера зелёный. Регистрация в `prod-deploy-log.md` Шаг 12 (smoke) + `feature-flags.md` (kill-switch).
**Closes:** R13, R14, R15.

## Фаза 8 — Frontend: прогресс на лице карточки + лента в детали
**Цель:** показать прогресс-обновления и дать подтверждать черновик.
**Картография:** `IssueDetailClient.tsx` (добавить секцию), `frontend/src/domain/tracker/`, `frontend/src/api/tracker/`, `frontend/src/hooks/tracker/`, `IssueCard.tsx` (бейдж).
**Что входит (R16–R17):**
- **R16.** Деталь: секция **«Прогресс»** — лента обновлений по датам (health-цвет «в норме/риск/буксует», текст, «сделано/дальше»), форма создания, и карточка **черновика Коры** с кнопками «Подтвердить / Поправить / Отклонить» (draftState). Подача — «Кора собрала черновик прогресса», тон «помощь», не «отчёт начальству».
- **R16a (Д1 — кликабельный источник в ленте).** У каждого обновления и в карточке черновика — чип источника: `mapPreviewToProvenanceRef(update.previewQuote, update.previewSourceRef)` ([verified] `frontend/src/domain/provenance.ts:85`) → `<ProvenancePreviewSnippet/>` ([verified] кликабелен, deep-link `?t=`/`?page=N`/`?m=`, `stopPropagation`), ровно как в `IssueCard.tsx:95-100`. Новый компонент/маппер НЕ создавать.
- **R17.** Лицо карточки: маленький **health-индикатор последнего обновления** (точка/полоска цветом) — если обновления есть. (Опц. бейдж «есть черновик Коры» владельцу задачи.)
- **R17a (Д3 — черновик в колокольчике).** Черновик прогресса (`draftState=pending`, `authorType=ai_agent`) регистрируется как pending-действие в едином центре уведомлений (колокольчик) — в КАБИНЕТЕ; **Telegram-доставка вне scope (НЕ трогать)**. Новый source `progress_draft` по образцу `backend/src/modules/pending-actions/providers/task-closure.provider.ts` (`where { tenantId, draftState:'pending', authorType:'ai_agent', deletedAt:null }`, batch `Issue.title`, **видимость ИСПОЛНИТЕЛЮ задачи** + owner/admin — не всем; `title` «Кора собрала черновик прогресса: …»; `actionUrl` = деталь задачи, секция «Прогресс»; `canQuickConfirm=true` только для «Подтвердить как есть»). Точки расширения: `pending-actions.service.ts` (`providers[]`, `bySource` init+sum, `loadSnoozedBySource`, ветка `confirm` switch → **делегат на эндпоинт Ф6** `POST /progress-updates/:id/confirm`, НЕ дублировать бизнес-логику) + `pending-actions.module.ts` + union в `pending-actions-provider.types.ts`/DTO + FE `PENDING_SOURCE_LABEL`/`CHIP`/`mapPendingActionDetail`. ⚠️ Зависит от Ф5→Ф6→Ф7 (делегат-цель Ф6 на момент Ф8 уже реализована) — потому строго в Ф8. Авто-постинг запрещён (Р2): только «Подтвердить / Поправить (→деталь) / Отклонить», пути публикации без человека нет.
**Что НЕ входит:** прогресс/черновик в Telegram (вне scope — Telegram-доставка pending-действий = отдельный bounded context assistant-channels, НЕ трогать); графики/метрики (текст+health достаточно для MVP).
**Acceptance:** в детали видна лента + форма; черновик подтверждается (pending→accepted), после чего исчезает из «ждёт подтверждения»; на лице карточки с обновлением виден health-цвет; **(Д1)** у обновления с источником-встречей клик по чипу ведёт на `/meetings/<id>?t=<sec>`, документ → `?page=N`, чат → `?m=<msg>`; **(Д3)** черновик виден в колокольчике в группе «Подтверждения», «Подтвердить»→accepted (исчезает), «Открыть»→деталь задачи, count включает черновик, виден ИСПОЛНИТЕЛЮ (не всем owner/admin); `grep "progress_draft"` по 6 точкам (types/dto/provider/service×3/module) — все есть; spec провайдера (count/list/видимость) зелёный; `typecheck`/`lint` зелёные; Playwright-приёмка. Обновить `prod-deploy-log.md` Шаг 12 (новый pending-source — smoke `/api/v1/pending-actions`).
**Closes:** R16, R16a, R17, R17a.

## Фаза 8b — AI-сводка изменений по задаче (catch-up) [Д5]
**Цель:** одной кнопкой «Что произошло по задаче» получить датированную сводку изменений с прошлого захода (анализ §8 ветка D — «самая зрелая, дешёвая, проверяемая AI-категория»; в исходном ТЗ отсутствовала). НЕ путать с `IssueChat` (интерактивный Q&A по графу) — здесь one-click дайджест дельты, без формулирования вопроса. Эфемерно — БЕЗ Prisma-модели и миграции.
**Картография (переиспользовать, НЕ строить заново):** образец — `SprintAnalystService.getDailyDigest`/`computeDailyDigest` ([verified] `backend/src/modules/tracker/services/sprint-analyst.service.ts:411-452,1004`) + промпт-эталон `sprint-daily-digest.prompt.ts` (стабильный SYSTEM + JSON-агрегаты в конце user — cache-friendly). Источник дельты — `IssueActivity` (`ActivityRecorderService`: verb/field/oldValue/newValue/epoch) + `checklistDoneCount` + опц. `IssueComment`/`IssueProgressUpdate`. LLM — `LlmRouterService` taskType. Эндпоинт — образец `CommentsController`.
**Что входит (R17b):**
- **R17b.** Эндпоинт `GET /api/v1/issues/:id/activity-digest` (CookieAuth+TenantGuard+RBAC `canRead('issue')`, `RequireSubscription`, коды `tenant_required`/`forbidden`). Сервис собирает `IssueActivity` по issueId за окно (или с `?since=`), агрегирует (смены статуса/исполнителя/срока, закрытые чек-пункты, новые комментарии, опубликованные progress-updates), кладёт агрегаты JSON-ом в **хвост** user-сообщения. LLM taskType **`issue-activity-digest`**: стабильный SYSTEM «человеческим языком 3–5 пунктов что изменилось, без воды, без оценки людей/слежки» (тон как sprint-daily-digest). Provider DeepSeek/OpenAI-proxy, dataClass internal. Redis-кэш ключ `issue:activity-digest:<issueId>:<sinceKey>` (короткий TTL). Пустая история → дружелюбное «изменений нет» БЕЗ вызова LLM. Регистрация: +строка в union `LlmTaskType` + `ALL_LLM_TASK_TYPES` + admin-registry + seed + промпт-файл `issue-activity-digest.prompt.ts`. Kill-switch `tracker.activityDigestEnabled` (getDynamic, ON, через каркас DomainSettings — Д2).
- UI: кнопка «Что произошло по задаче» в `IssueDetailClient.tsx` рядом с секцией «Прогресс»/«Активность», показ сводки в свёртке; русский UI; парные токены. **Разместить отдельно от поля вопроса `IssueChat`** (чтобы не спутать Q&A и дайджест).
**Что НЕ входит:** хранение сводок (эфемерны); авто-push/Telegram (вне scope); периодический воркер (только on-demand по кнопке — дешевле и без surveillance-риска).
**Совместимость с prompt caching:** SYSTEM стабильный, переменные агрегаты только в хвосте user (как sprint-daily-digest).
**Acceptance:** Swagger показывает `GET .../activity-digest`; на задаче с историей (смена статуса + закрытый чек-пункт) кнопка возвращает осмысленную русскую сводку с датами; `issue-activity-digest` в `ALL_LLM_TASK_TYPES` (grep); пустая история → «изменений нет» без LLM; spec сервиса зелёный; `typecheck`(вкл .spec)/`lint`/`build` зелёные; `prod-deploy-log.md` Шаг 12 (новый taskType/эндпоинт) + `feature-flags.md` (kill-switch).
**Closes:** R17b.

---

# ВОЛНА 3 — Table-stakes-паритет

> Волна 3 — крупная; каждая фаза самодостаточна. Если объём фазы превысит одну сессию суб-агента, оркестратор вправе разбить фазу на под-фазы (модель → API → UI), сохранив контракты ниже.

## Фаза 9 — Кастомные поля задачи
**Цель:** произвольные поля на задаче (паритет Jira/Kaiten/Bitrix).
**Контракт (по образцу `TableProperty`):**
```prisma
/// Определение кастом-поля задач (per-project или глобально по Org).
model IssueFieldDef {
  id         String    @id @default(cuid())
  tenantId   String
  projectId  String?   /// null = поле на всю Org
  name       String    @db.VarChar(100)
  type       String    /// text|number|date|checkbox|status|selectSingle|selectMulti|person|url (подмн. TablePropType)
  config     Json      /// { options:[{id,name,color}] } и т.п.
  order      Decimal   @db.Decimal(20, 10)
  archivedAt DateTime?
  createdAt  DateTime  @default(now())
  @@index([tenantId, projectId, order])
}
/// Значение кастом-поля для конкретной задачи.
model IssueFieldValue {
  id       String @id @default(cuid())
  tenantId String
  issueId  String
  fieldId  String
  value    Json
  issue    Issue  @relation(fields: [issueId], references: [id], onDelete: Cascade)
  @@unique([issueId, fieldId])
  @@index([tenantId, fieldId])
}
```
+ `Issue.fieldValues IssueFieldValue[]`.
**Что входит (R18):** миграция; CRUD дефиниций (admin/настройки проекта) + чтение/запись значений; рендер в sidebar детали; опц. отображение выбранных полей на лице (через настройку, по умолчанию НЕ на лице — плотность). Валидация значения по `type`/`config`.
**Что НЕ входит:** formula/rollup/relation-типы (подмножество, как в скоупе выше); кастом-поля на лице по умолчанию.
**Acceptance:** создать поле type=selectSingle с опциями → задать значение задаче → видно в детали; миграция+generate ок; spec на валидацию значения зелёный; `prod-deploy-log.md` Шаг 4.
**Closes:** R18.

## Фаза 10 — Пользовательские автоматизации (правила)
**Цель:** if-this-then-that по задаче (паритет Jira Automation/Asana Rules).
**Контракт:**
```prisma
/// Пользовательское правило-автоматизация. trigger→conditions→actions как JSON.
model IssueAutomationRule {
  id          String   @id @default(cuid())
  tenantId    String
  projectId   String?  /// null = на всю Org
  name        String
  enabled     Boolean  @default(true)
  trigger     Json     /// { type: 'status_changed'|'assigned'|'created'|'due_approaching'|'label_added', ... }
  conditions  Json     /// [{ field, op, value }]
  actions     Json     /// [{ type:'set_status'|'assign'|'add_label'|'set_priority'|'notify'|'create_subtask', ... }]
  createdById String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([tenantId, projectId, enabled])
}
```
**Что входит (R19):** миграция; движок-обработчик, подписанный на события трекера (переиспользовать `TrackerEventsService`/`tracker.gateway` события `issue.created/updated`, см. `second-brain/01_projects/tracker.md`); вычисление conditions; применение actions (в т.ч. запись `IssueActivity actorType='system'`); CRUD правил в настройках проекта; защита от циклов (правило не триггерит само себя — guard по depth/origin). Kill-switch глобальный `tracker.automationsEnabled` (getDynamic, ON) — в UI группа «Автоматизации» страницы `TrackerSettingsClient` на каркасе `DomainSettings` (Д2), `severity 'high'`, не отдельная форма. `enabled` правила — решение владельца (создаётся ON).
**Что НЕ входит:** межпроектные/расписанные правила (только событийные в MVP); сложные ветвления/циклы.
**Acceptance:** правило «при status=started → assign владельцу» применяется на смене статуса (создаётся `IssueAssignee` + `IssueActivity system`); рекурсия не возникает (тест: action, совпадающий с триггером, не зацикливается); spec движка зелёный; `feature-flags.md` + `prod-deploy-log.md` Шаг 12.
**Closes:** R19.

## Фаза 11 — Повторяющиеся задачи + шаблоны задач
**Цель:** регулярные задачи и шаблоны (паритет Bitrix24/Asana).
**Контракт:**
```prisma
/// Повторение: материализует новую задачу по расписанию из снимка config.
model IssueRecurrence {
  id              String    @id @default(cuid())
  tenantId        String
  projectId       String
  templateIssueId String?
  rrule           String    /// { freq:'daily'|'weekly'|'monthly', interval, byweekday? } сериализованный
  config          Json      /// снимок: title, description, checklist[], assignees[], labels[], priority, estimate
  nextRunAt       DateTime
  lastRunAt       DateTime?
  enabled         Boolean   @default(true)
  createdById     String
  createdAt       DateTime  @default(now())
  @@index([tenantId, enabled, nextRunAt])
}
/// Шаблон задачи (ручное создание из шаблона).
model IssueTemplate {
  id          String   @id @default(cuid())
  tenantId    String
  projectId   String?
  name        String
  config      Json     /// { title, description, checklist[], labels[], priority, estimate, assigneeRole? }
  createdById String
  createdAt   DateTime @default(now())
  @@index([tenantId, projectId])
}
```
**Что входит (R20):** миграции; cron материализации (`nextRunAt<=now` → создать `Issue` из `config` → сдвинуть `nextRunAt`, идемпотентность по `lastRunAt`-дате); создание задачи из шаблона (кнопка в проекте); CRUD повторений/шаблонов. Кадэнс cron → AdminSetting (`tracker.recurrenceCronCadence`) — в `TrackerSettingsClient` группа «Повторения» на каркасе `DomainSettings` (Д2), не отдельная форма.
**Что НЕ входит:** сложный RRULE (только daily/weekly/monthly+interval в MVP); перенос вложений в копию.
**Acceptance:** повторение с `nextRunAt` в прошлом материализует ровно одну задачу, повторный прогон в тот же день — no-op; «создать из шаблона» создаёт задачу с чек-листом из `config`; spec cron зелёный; `prod-deploy-log.md` Шаг 12.
**Closes:** R20. — [x] **Реализовано 2026-06-21** (миграция `20260621073857_issue_recurrence_templates`; модели `IssueRecurrence`/`IssueTemplate`; `RecurrenceMaterializeCron` идемпотентен по `lastRunAt`-дате + Redis-dedup; rrule свой минимальный `{freq,interval,byweekday?}` без либы; контроллеры `IssueTemplatesController` (+`/instantiate`) и `IssueRecurrencesController`; `IssueMaterializeService`; крутилки `tracker.recurrenceEnabled`/`tracker.recurrenceCronCadence` в registry+seed+TrackerSettingsClient; FE api→domain→hook→секции в настройках проекта + кнопка «Создать из шаблона»; спеки cron+materialize зелёные; typecheck/lint/build обеих сторон зелёные).

## Фаза 12 — Worklog (учёт времени под флагом проекта)
**Цель:** датированный учёт минут под существующим `Project.timeTrackingEnabled`.
**Контракт:**
```prisma
/// Запись учёта времени по задаче (датированная). Под Project.timeTrackingEnabled.
model IssueWorklog {
  id          String   @id @default(cuid())
  tenantId    String
  issueId     String
  userId      String
  minutes     Int
  description String?  @db.Text
  startedAt   DateTime /// дата работы (датированность)
  createdAt   DateTime @default(now())
  issue       Issue    @relation(fields: [issueId], references: [id], onDelete: Cascade)
  @@index([tenantId, issueId, startedAt])
  @@index([userId, startedAt])
}
```
**Что входит (R21):** миграция; CRUD логов (показывать/разрешать только если `project.timeTrackingEnabled`); сумма по задаче в детали; запись `IssueActivity verb='time_logged'`. Округление/правила → AdminSetting если понадобится — тем же каркасом `DomainSettings` (`TrackerSettingsClient`, Д2), не отдельной формой.
**Что НЕ входит:** деньги/ставки/payroll (vNext); таймер/Pomodoro (vNext).
**Acceptance:** при `timeTrackingEnabled=false` эндпоинт лога недоступен (403/скрыт в UI); при true — лог пишется, сумма видна; spec зелёный; `prod-deploy-log.md` Шаг 4.
**Closes:** R21.

---

## Граф зависимостей фаз
```
Волна 0:  Ф0.1, Ф0.2 — независимы, быстрые (фронт+узкий бэк); идут первыми
          (+ выкат уже готового assign+notify тем же релизом)
Волна 1:  Ф1 → (Ф2, Ф3 параллельны после Ф1) ;  Ф4 независима (БД)
Волна 2:  Ф5 → Ф6 → Ф7 → Ф8 → Ф8b   (строго последовательно: модель→API→воркер→UI→catch-up; Ф8b on-demand, без миграции)
Волна 3:  Ф9, Ф10, Ф11, Ф12 — независимы между собой (каждая своя модель), но ПОСЛЕ Волны 2
```
Строгий порядок волн: 0 → 1 → 2 → 3 (Р3). Внутри Волны 0 и Волны 3 фазы можно параллелить.

**Опционально (low-prio, по желанию владельца — НЕ в основном scope):** дедуп DnD-каркаса `Board`↔`OrgBoard` (рефактор, риск-vs-польза) — отдельным мелким ТЗ, если решим делать (учесть: `Board` на `SortableContext`/`useSortable` reorder, `OrgBoard` только `useDraggable` move — семантика намеренно разная, наивное слияние сломает reorder). **ПРИМЕЧАНИЕ (Д6, проверено кодом 2026-06-21):** «сворачивание групп меню + единый nav-конфиг» УЖЕ реализовано независимо (`274c2554`/`3931de0e`) — `nav-config.ts` это единый декларативный конфиг (`DESKTOP_NAV`+`resolveDesktopNav`, ролевая фильтрация), `Sidebar.tsx` `SidebarSubgroup` уже рендерит сворачиваемые подгруппы с localStorage-персистом + гард `nav-subset.spec.ts`; перестройка `Sidebar.tsx` НЕ требуется, пункт снят.
**Отдельным ТЗ (крупное, зависит от встреч):** богатый «Календарь» в рабочем столе задач — [`2026-06-18-tasks-workspace-calendar.md`](2026-06-18-tasks-workspace-calendar.md) (draft).

## Границы автономии суб-агента (локальные)
- ✅ Always: переиспользовать существующие сервисы/паттерны (comments/activity/worker-образцы); русский UI; парные токены; миграции через `prisma:migrate`.
- ⚠️ Ask first: менять контракт существующих эндпоинтов задач; трогать FSM встречи/billing; добавлять `signalType`/новый LLM-провайдер.
- 🚫 Never: `db push` вместо миграции; `new PrismaClient()` в скриптах; `process.env.*` мимо `env.schema.ts`; крутилки в ENV/хардкод; авто-постинг прогресса без подтверждения; «спящий OFF»-флаг.

## Pre-mortem / Риски (+ аспекты для `strict-production-review-gate`)
- **Перегруз лица карточки** (Р1-риск): держать ≤5 сигналов; ревью — не добавлять счётчики на лицо без явного решения.
- **Ложный авто-черновик прогресса** (Ф7): порог сигналов + человек подтверждает; ревью — нет пути авто-публикации.
- **Восприятие «слежка»** (Ф7/Ф12): тон «помощь исполнителю»; worklog только под флагом проекта.
- **Рекурсия автоматизаций** (Ф10): guard по origin/depth — обязательный тест.
- **Миграция Гант-дефолта** (Ф4): backfill идемпотентен; не перетереть явный выбор владельца (assumption задокументирован).
- **Провенанс-снимок прогресса первый прод-вызов (Д1):** `computePreviewSnapshot` ещё ни разу не вызывался — Acceptance Ф7 обязан проверить непустой `previewSourceRef`+`deepLink`; снимок может устареть при правке evidence-блока (принятый компромисс, как у `Issue`); per-viewer маски нет — виден тому, кому видна задача (зафиксировано в граничном контракте, чтобы `strict-gate` не счёл утечкой).
- **Спам колокольчика черновиками прогресса (Д3):** показывать ТОЛЬКО исполнителю задачи (не всем owner/admin — иначе 30 человек тонут), snooze работает, порог сигналов Ф7 ограничивает частоту; не плодить второй pending.
- **Surveillance-восприятие catch-up/прогресса (Д5, Ф7, Ф12):** тон «помощь/ввод в курс», on-demand, без оценки людей, без авто-push; кнопку catch-up разместить отдельно от поля вопроса `IssueChat`.
- **Дрейф `path:line`:** номера строк — на 2026-06-20 (правки 2026-06-21); перед правкой перечитать по якорю-символу.

## DoD (общий)
`typecheck` (вкл. `.spec`)/`lint`/`build` зелёные на обеих сторонах; новые spec проходят; `second-brain/01_projects/tracker.md` + `02_architecture/data-model.md` обновлены по таблице производных заметок; `prod-deploy-log.md` (Шаги 4/8/12) + `feature-flags.md` обновлены для затронутых фаз; новые миграции применяются `migrate deploy`; рефлексия после push.

## Итог
_(заполнит tz-orchestrator по факту реализации: что сделано целиком, что осталось, на каких фазах остановились.)_

---
_ТЗ — контракт под `tz-orchestrator`. Реализацию начинать по явному «начни реализацию / погнали Волну 1». Источник правды о коде — репозиторий; `path:line` верифицировать перед правкой._
