---
type: analysis
feature: employee-stand
date: 2026-07-06
owner: Сергей (svmazur)
method: верификация 7 агентами по коду (404 обращения к репозиторию, 6 кластеров + синтез)
relates_to:
  - plans/analysis/2026-07-06-employee-stand-persona-research.md
  - plans/architecture/2026-07-06-employee-stand.md
  - second-brain/01_projects/director-dashboard.md
prototype: scratchpad/site/index.html · scratchpad/site/data-sources.html
---

> Аналитика: **откуда взять данные для стенда сотрудника и что достроить, чтобы он заработал.** Каждый виджет разобран по коду — подтверждённый `file:line`, входные данные, статус (готово / расширить / строить). В конце — единый план сборки (29 build-items с зависимостями) и вскрытые в ходе верификации ловушки, включая 2 подтверждённые уязвимости и приватностный блокер.

# Стенд сотрудника — источники данных и план подключения

## 0. Итог одним взглядом

- Дашборд **на ~85% стоит на уже существующих данных**. Разбивка ячеек: **≈50% готово** (переиспользуем), **≈35% расширить** (self-обёртка/фильтр поверх директорского сервиса), **≈15% строить** (новая модель/агент/эндпоинт).
- Всё в бэке: **29 build-items** (1 L, 13 M, 15 S), все — backend (self-обёртки `/me/*` + один новый агент). UI-слой поверх готовых эндпоинтов.
- **2 обязательные миграции:** `PersonalDayNarrative` (модель письма) + `Issue.methodCapturedAt` (флаг захвата метода).
- **1 новый AI-агент:** `personal-day-narrative` — вечернее письмо-отчёт per-person, зеркало директорского `operations-daily-digest`, но короче. Больше **никаких** новых извлекающих агентов.
- ⚠️ **Вне пакета, но приоритетно:** верификация вскрыла **2 RBAC-уязвимости** в существующем `pending-actions` (обход `canWrite` в confirm intake/conflict) — отдельный срочный хотфикс, не ждать дашборда.
- 🔒 **Блокер до прода:** ленты блокеров/идей компании для рядового сотрудника — это ослабление периметра приватности; выкатывать только с приватностным гейтом (или урезанием) — решение владельца.

## 1. Поправки, вскрытые верификацией (важно — прежние допущения были неточны)

| # | Было в черновике (data-sources.html) | Факт по коду | Следствие |
|---|---|---|---|
| 1 | Роль рядового = `member` | Роли `member` в enum НЕТ (`owner\|admin\|manager\|coo\|hr_partner\|demo_observer`). Базовая = **`manager`** | Везде читать «manager». Новых строк в `policy.csv` не надо — `manager` уже имеет `issue:read`/`block:read` |
| 2 | hint брифа ≤120 симв | Реально `.slice(0,200)` (`personal-daily-brief.service.ts:283`) | Не блокирует, но это hint, а не нарратив — письмо строим отдельным агентом |
| 3 | `daily-digest.prompt.ts` в `knowledge-core/prompts` | Фактически `operations/prompts/daily-digest.prompt.ts:232` | Новый промпт-модуль кладём в `operations/prompts/` |
| 4 | `ops-dashboard.service.ts` | Файл — `operations-dashboard.service.ts:455` | Путь в ТЗ поправлен |
| 5 | strict-орг `/ideas` отдаёт «только свои» | Для `manager` в strict-org это **403** (полный запрет); в open-org — видит **все** идеи тенанта | `/me/company-ideas` — первый способ для рядового увидеть топ вообще → **ослабление периметра, решение владельца** |
| 6 | `SprintHint kind='no_due_date'` как источник букета «без срока» | `SprintHint` привязан к `Cycle`, асинхронный AI-воркер, может устаревать | Букет «без срока» — прямой live-фильтр `Issue.dueDate IS NULL`, не SprintHint |
| 7 | Ось «Вклад» — «сегодня» | `PersonGoalContribution` пишется `GoalVectorTrackerCron` **по понедельникам** → 6/7 дней одинаков | В письме формулировать «на этой неделе», не «сегодня» |
| 8 | «решение без задачи» через `IntakeIssue` self-фильтр | `Decision→IntakeIssue` создаётся **без** `suggestedAssigneeId` → в self-фильтр не попадёт | Доставать напрямую из таблицы `Decision` через `decidedByPersonIds` (GIN-индекс) |

## 2. Источники по виджетам (подтверждено кодом)

### Виджет 1 — Обложка-отчёт «Твой день» (вечернее письмо + 4 оси)
Новый per-person агент, зеркало `DAY_COMPANY_SYSTEM_PROMPT` (`operations/prompts/daily-digest.prompt.ts:232`), но короче (≤6 секций письма).

| Ячейка | Источник (подтверждён) | Статус |
|---|---|---|
| Текст письма (≤6 секций: intro/задачи/обещания/загрузка/вклад/действия) | новый `PersonalDayNarrativeService.generate` (LLM taskType `personal-day-narrative`) | 🔴 строить |
| «Что сделал» | `Issue` closed сегодня (`completedAt` в окне дня, `assignees.some.userId=self`) + `DailyCheckIn kind=evening` `donesJson` | 🟡 расширить |
| «Что зависло» | `getStuckCrossProject` алгоритм (`execution-dashboard.service.ts:388`), self-scope | 🟡 расширить |
| «Что обещал» | **новый** запрос: `IdeaBlock signalType='commitment'`, `commitmentAuthorPersonId=self`, `status!=archived`, `supersededById=null` | 🔴 строить (запроса нет ни в одном сервисе) |
| «Твой вклад» | `goalContributionNet` (`weekly-per-person.service.ts:386`) — уже self в `/me/weekly-per-person` | 🟢 готово |
| «Что мешает» | `collectMyBlockers` (`personal-daily-brief.service.ts:154`) | 🟢 готово |
| 4 оси (Задачи·Обещания·Загрузка·Вклад) | counts букетов · commitment overdue · `getLoadByPerson` (`:479`) · `goalContributionNet` | 🟡 расширить |

Голос сотрудника: `IdeaBlockEvidence.authorPersonId` (`schema:3592`, `collectEmployeeVoice` `daily-digest.service.ts:796` + фильтр personId). Хранение: **новая модель** `PersonalDayNarrative` (не поле в `PersonalDailyBrief` — семантически другой продукт: утренний фокус-лист vs вечернее письмо). Границы дня — по `Person.timezone`. **Запрет в промпте:** не упоминать mood/сентимент/конфликты — эти данные физически не кладутся в пакет.

### Виджет 2 — Мои задачи, борд по состояниям (ядро, ~70%)
Всё = `Issue`. Все якоря подтверждены точно: `Issue:9561`, `dueDate:9589`, `completedAt:9590`, `IssueState.category:9425`, `IssueProgressUpdate:9870`, `IssueActivity:10151`, `IssueAssignee:9746` (`@@index([userId]):9756`), `@@index([tenantId,dueDate]):9705`.

| Букет | Правило (детерминированное) | Статус |
|---|---|---|
| ПРОСРОЧЕНО / ЗАВИСЛИ | `dueDate<now` ИЛИ `lastActivityAt<now−staleDays` (порог `dashboard.stuck.staleDaysThreshold`=5, переиспользуем), category NOT IN completed/cancelled | 🟡 расширить |
| В РАБОТЕ | не (просрочено), `state.category='started'` | 🟡 расширить |
| БЕЗ СРОКА | не (просрочено/в работе), `dueDate IS NULL` | 🟡 расширить |
| СДЕЛАНО | `completedAt` в окне (крутилка `me.tasks.doneWindowDays`=14) | 🟢 готово |
| Клик → шаги | `GET /issues/:id/progress-updates` (`:51`) + `/activity` (`:371`) — уже `issue:read`, обёртка НЕ нужна | 🟢 готово |

**Главный пробел:** `GET /me/inbox` (`me-inbox.controller.ts:32`) отдаёт плоский список без букетов → нужен **новый** `GET /me/tasks/buckets` (сервис `IssuesService.findMyTaskBuckets`, переиспользует stale-алгоритм). Пятый неявный набор (backlog с будущей датой) в 4 букета не входит — решить, нужен ли букет «Запланировано».

### Виджет 3 — «Требует тебя» (единый inbox)
| Ячейка | Источник | Статус |
|---|---|---|
| «вопрос ждёт ответа» | `ProbePendingProvider` (`probe.provider.ts:20`), `Notification eventType=probe.question` | 🟢 готово |
| «решение без задачи» | `Decision.impliesAction=true AND linkedTaskCount=0` (`schema:6549`), новый провайдер по `decidedByPersonIds` | 🔴 строить провайдер |
| «ты обещал» | `IdeaBlock commitment`, `commitmentAuthorPersonId=self`, новый провайдер | 🔴 строить провайдер |
| «встреча сегодня» | `Participant.personId→Meeting` (`schema:1501`) | 🟡 расширить |

⚠️ **Риск утечки:** `IntakePendingProvider` (`intake.provider.ts:27`) для непривилегированной роли возвращает 0 — но общий агрегатор `pending-actions` отдаёт intake-триаж по всей орге. Фикс: `where.suggestedAssigneeId=self` (см. хотфикс §4).

### Виджет 4 — «Кора за ночь» (реципрокность)
Весь контент уже генерится, нужна только сборка `GET /me/night-ledger` (read-time, без новой таблицы/крона):
- авто-черновики: `ProgressAutoDraftCron` (`progress-auto-draft.cron.ts:56`) → `IssueProgressUpdate draftState='pending'` 🟢
- задачи из встреч: `IntakeIssue source='meeting' suggestedAssigneeId=self` 🟡
- клон ответил: `CloneQueryLog cloneScope='person' cloneTargetId=self.personId` 🟡 (счётчик — виджет 6)

### Виджет 5 — «Кора на твоей стороне» + «Ты двигаешь» (директорские сигналы про тебя, отданные первым)
| Ячейка | Источник | Обёртка |
|---|---|---|
| «перегруз N задач» | `getLoadByPerson` (`execution-dashboard.service.ts:479`) | `/me/load` (фильтр `userId=self`) 🟡 |
| «зависло N» | `getStuckCrossProject` (`:388`, есть `assigneeUserId` в ответе) | `/me/stuck` 🟡 |
| «план не закрывается 3 дня» | `DailyCheckIn` evening `notDoneJson` за N дней (поведенческий, **не mood**) | `/me/check-ins/plan-signal` 🔴 строить |
| «+N к цели за неделю» | `goalContributionNet` (уже self) | `/me/weekly-per-person` 🟢 |
| «клон ответил N раз» | `CloneQueryLog` groupBy `answeredGrounded` | `/me/clone-impact` 🔴 строить |
| «эксперт по X» | агрегат `IdeaBlock authorPersonId → ThemeIdeaBlock/IdeaBlockEntity` | `/me/expertise` 🔴 строить (агрегата в коде нет) |

Гварды: директорское закрыто **двумя** разными правами — `canViewDirectorDashboard` (owner/admin: load/stuck) и `canViewOperationsDashboard` (owner/admin/coo: digest/weekly/ideas). Self-обёртки идут **без ролевого гварда** (`CookieAuthGuard+TenantGuard`, self-scope по `CurrentUser`). `people-at-risk` («ты выгораешь») сотруднику **не показываем** — он by design прячет самого зрителя; `stripSentimentForRole` не нарушаем.

### Виджеты 7–8 — Ленты блокеров и идей в конце (свои выделены)
| Ячейка | Источник | Статус |
|---|---|---|
| Твоя идея + судьба | `GET /me/ideas` (`ideas.controller.ts:93`, listMine, без гейта) | 🟢 готово |
| «ты молодец — N идей/мес» | `IdeasService.countMineSince` (`@@index([tenantId,createdByUserId])` есть) | 🟢 готово (лёгкий метод) |
| Идеи компании | `getTop` (`ideas.service.ts:131`) + `gateProjections` (dept/closed фильтруются) → `/me/company-ideas` | 🔴 строить (ослабление периметра) |
| Блокер «твой» | `IdeaBlock blocker commitmentAuthorPersonId=self` + `DailyCheckIn.blockersJson` + `BlockerSynthesis.responsiblePersonId` | 🟡 расширить |
| Блокеры компании | `BlockerSynthesis.listChronicForTenant` (`blocker-synthesis.service.ts:251`) → `/me/company-blockers` | 🔴 строить + 🔒 гейт приватности |

## 3. Единый план сборки (29 build-items, порядок по зависимостям)

**Слой 0 — срочный хотфикс (вне пакета дашборда, независимый PR):**
1. `hotfix-rbac-bypass-confirm` (S) — `canWrite` перед triage/resolve в `PendingActionsService.confirm{intake,conflict}`.
2. `intake-self-visibility` (S) — `IntakePendingProvider`: рядовой видит СВОИ intake (`suggestedAssigneeId=self`), одним PR с хотфиксом.

**Слой 1 — миграции:**
3. `P2-1` (M) — модель `PersonalDayNarrative` (зеркало `DailyOperationsDigest`).
4. `C3-1` (S) — `Issue.methodCapturedAt DateTime?`.
5. *(опц., решение владельца)* `decisions.actionDismissedAt` — только если нужен явный «Не нужно».

**Слой 2 — крутилки (AdminSetting):**
6. `me.tasks.doneWindowDays` (14) · `operations.personal_day_narrative.enabled`+`evening_hour` · `operations.self_signals.plan_not_closing_streak_days` (3) · `knowledge.expertise.self_max_blocks_scanned` (2000)/`self_top_k` (10). Method-capture крутилки **переиспользуем** (`tracker.methodCaptureMinComplexity` уже есть).

**Слой 3 — агент письма:**
7. `P2-4` taskType в `LlmRouter` (в `LlmTaskType` И `ALL_LLM_TASK_TYPES` одновременно) · `P2-2` промпт-модуль · `P2-3` (L) `PersonalDayNarrativeService.buildPersonDayPackage`(6 источников)+`generate` · `P2-5` (M) `PersonalDayNarrativeCron` (почасовой, `evening_hour` по timezone) · `P2-7` DTO + `GET /me/day-letter` + `POST /me/day-letter/:id/opened`.

**Слой 4 — сервисы/провайдеры:**
8. `me-tasks-buckets-service` (M) · `C3-2` (S) probe→`methodCapturedAt` · `decision-action-self-provider` (M) · `commitment-action-self-provider` (M) · `me-plan-not-closing` (M) · `me-expertise` (M).

**Слой 5 — эндпоинты `/me/*`:**
9. `GET /me/tasks/buckets` · `/me/tasks/method-capture-pending` · `/me/night-ledger` · `/me/load` · `/me/stuck` · `/me/clone-impact` · `/me/company-blockers` · `/me/company-ideas` (+`myIdeasThisMonth`) · 2 новых `source` в `pending-actions`.

Полный список с `file:line`, сигнатурами и where-условиями — в ТЗ `plans/tz/2026-07-06-employee-stand.md`.

## 4. Риски и открытые вопросы (вскрыто верификацией)

**Уязвимости (CONFIRMED, чинить сразу, независимо от дашборда):**
- `POST /pending-actions/confirm{source:'intake'}` обходит `canWrite('intake_issue')` → любой участник тенанта триажит ЛЮБОЙ intake орги.
- То же в `confirm{source:'conflict'}` → любой резолвит чужие конфликты фактов.

**Приватностный блокер до прода:**
- `BlockerSynthesis.listChronicForTenant` **не** фильтрует по dept/closed-группам (в отличие от `IdeasService.gateProjections`) → `/me/company-blockers` = утечка мимо access-групп. До выката: фильтр по `relatedBlockIds` через `KnowledgeAccessResolver.partitionProjectionsByAccess` **или** не отдавать `relatedBlockIds`+усечь текст.
- `/me/company-ideas` — первый доступ рядового к топу идей (сейчас только owner/admin/coo). `gateProjections` приватность держит, но сам факт открытия ленты — решение владельца.

**Открытые вопросы владельцу (в блюпринте — развилки):**
1. Букет «Запланировано» (5-й) — показывать backlog с будущей датой или нет.
2. `methodCapturedAt` при реоткрытии задачи — переспрашивать «как делал» заново или «спросили раз за жизнь».
3. Ось «Обещания»: строгого статуса kept/broken нет → в v1 нейтрально «дано X, Y просрочено», без «нарушил».
4. Тайминг «Кора за ночь»: `ProgressAutoDraftCron` в 10:00 МСК — позже начала дня; сдвинуть UTC или перейти на per-person timezone.
5. Ось «Вклад» обновляется раз в неделю → «на этой неделе», либо заказать ежедневный пересчёт (отдельное ТЗ).

**Технические ловушки:**
- Незарегистрированные крутилки (`dashboard.load.*`, `operations.daily_digest.enabled`) работают только через code-fallback — новые регистрировать правильно (registry+seed).
- `ClonesModule`/`PersonsModule` не импортируют `OperationsModule` → для `/me/clone-impact` добавить import (циклов нет). `DashboardModule` уже импортирует — `/me/load,stuck,expertise` получают резолвер бесплатно.
- `isMine` на company-blockers достоверен только для блокеров из чек-инов; для встречных `commitmentAuthorPersonId` не проставляется → «своё» работает частично (полный fix — доработка `block-ingest.worker`, отдельный тикет).

## 5. Что дальше
Блюпринт (`plans/architecture/2026-07-06-employee-stand.md`) — человеческим языком, владелец одобряет. Затем ТЗ (`plans/tz/2026-07-06-employee-stand.md`) — контракт по фазам.
