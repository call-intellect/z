---
type: tz
status: ready
feature: employee-stand
date: 2026-07-06
owner: Сергей (svmazur)
architecture: plans/architecture/2026-07-06-employee-stand.md (status: approved)
analysis:
  - plans/analysis/2026-07-06-employee-stand-datasources.md
  - plans/analysis/2026-07-06-employee-stand-persona-research.md
source: верификация 7 агентами по коду (workflow whmo56jay, 404 обращения)
---

> ТЗ на реализацию универсального task-centric стенда сотрудника (`/me`). Контракт по фазам: срочный хотфикс → миграции+крутилки → агент письма → сервисы/провайдеры → эндпоинты `/me/*` → фронт. Все `file:line` подтверждены по коду; роль рядового сотрудника = **`manager`** (не `member`).

# ТЗ: Стенд сотрудника

## Границы

**В скоупе:** обложка-письмо (агент `personal-day-narrative`), борд задач по 4 букетам, единый inbox «требует тебя», «Кора за ночь», self-сигналы (`/me/load,stuck,plan-signal,clone-impact,expertise`), ленты блокеров/идей компании, захват метода при закрытии.

**Не в скоупе:** новые извлекающие LLM-агенты (кроме одного письма); ролевые блоки (сущностей «клиент/фича» нет — всё=`Issue`); строгий статус обещаний kept/broken (отдельное ТЗ); ежедневный пересчёт вклада (отдельное ТЗ); дефолт-OFF флаги (Ship-On).

**Инварианты:** self-обёртки идут `[CookieAuthGuard, TenantGuard]` **без ролевого гварда**, self-scope строго по `@CurrentUser().id`, клиентский `userId/personId` НЕ принимается. Person-резолв — через `SelfPersonResolverService.resolveSelfPerson({tenantId,userId})`; `no_person` → пустой ответ, не 403. Крутилки — только `AdminSetting` (`getDynamic` + registry + seed), не ENV/константа. `PrismaClient` в скриптах — `createPrismaClient()`. Никаких комментариев в коде.

---

## Фаза 0 — СРОЧНЫЙ ХОТФИКС (независимый PR, не ждать дашборда)

Верификация вскрыла 2 подтверждённые RBAC-уязвимости в существующем `pending-actions`. Чинить сразу.

**0.1 `hotfix-rbac-bypass-confirm`** (S) — `backend/src/modules/pending-actions/services/pending-actions.service.ts`
- В `confirmIntake()` перед `this.intakeService.triage(...)`: `const ok = await this.rbac.canWrite(input.userId, input.tenantId, 'intake_issue'); if (!ok) throw new ForbiddenException({ok:false,error:{code:'forbidden',message:'Недостаточно прав для триажа'}});` — зеркалит `intake.controller.ts:151-159`.
- В `confirmConflict()`: `rbac.canWrite(input.userId, input.tenantId, 'conflict_item')` — зеркалит `curation.controller.ts:154-160`.
- Инжектировать `RbacService` (уже `@Global`).

**0.2 `intake-self-visibility`** (S) — `backend/src/modules/pending-actions/providers/intake.provider.ts`
- В `buildWhere()`: для `!isPrivileged(a.role)` вместо возврата пустого — `where.suggestedAssigneeId = a.userId`. Привилегированные не трогаются.
- Ставить **одним PR** с 0.1 (расширяем READ — WRITE-дыра должна быть уже закрыта).

**Acceptance:** непривилегированный `manager` не может `confirm{intake|conflict}` чужой ресурс (403); видит в inbox только intake с `suggestedAssigneeId=self`. Юнит-тест на обход.

---

## Фаза 1 — Миграции

**1.1 `P2-1` модель `PersonalDayNarrative`** (M) — `backend/prisma/schema.prisma`
Новая модель (НЕ расширение `PersonalDailyBrief` — другой продукт: утренний фокус-лист vs вечернее письмо). Зеркало `DailyOperationsDigest` (`schema:8007`). Поля:
```
id String @id @default(cuid())
tenantId String
personId String
dateLocal String @db.VarChar(10)         // день, за который письмо
bodyMarkdown String? @db.Text            // fallback при падении LLM
metricsJson Json                          // tasksDone/Planned/NotDone, commitmentsGiven/Overdue, activeTasks/loadLevel, goalNetScore/weekStart
sourcesJson Json                          // id встреч/блокеров/commitment/issue, использованных
llmTaskRouteId String?
shortSummary String? @db.Text            // 1 фраза для push
verdictJson Json?                         // {overall:{state,emoji,title,oneLiner}, axes:[{key,stat,...}]}
letterJson Json?                          // {sections:[{key,title,body,cites}]}
deliveredAt DateTime?
openedAt DateTime?
createdAt DateTime @default(now())
@@unique([tenantId, personId, dateLocal])
@@index([tenantId, personId, dateLocal])
```
FK: `tenantId→orgs ON DELETE CASCADE`, `personId→persons ON DELETE CASCADE`. Прогон: `bun run prisma:migrate -- --name add-personal-day-narrative` + `prisma:generate`. НЕ `db push`.

**1.2 `C3-1` `Issue.methodCapturedAt`** (S) — `backend/prisma/schema.prisma` (model `Issue`, рядом с `completedAt`/`lastOverdueDetectedAt` ~9590)
`methodCapturedAt DateTime?` (nullable, без default; null = метод текущего закрытия ещё не записан). Индекс `@@index([tenantId, methodCapturedAt])` — отложить до реальной нагрузки от 3.3 (по аналогии с `lastOverdueDetectedAt` без индекса). Прогон: `--name issue_method_captured_at` + `generate`.

**1.3 (опц., решение владельца)** `decisions.actionDismissedAt TIMESTAMP(3) NULL` — только если утверждаем «Не нужно» как отдельное действие от «Завести задачу» (см. 4.3). Без неё провайдер работает на одном действии.

---

## Фаза 2 — Крутилки (AdminSetting)

Все — `admin-setting-schema-registry.ts` + сид + `getDynamic` code-fallback. Регистрировать ПРАВИЛЬНО (в отличие от pre-existing пробелов `dashboard.load.*`, `operations.daily_digest.enabled`).

| Ключ | Тип | Default | Назначение |
|---|---|---|---|
| `me.tasks.doneWindowDays` | int | 14 | окно букета СДЕЛАНО |
| `operations.personal_day_narrative.enabled` | bool | true | kill-switch агента письма (Ship-On) |
| `operations.personal_day_narrative.evening_hour` | int 0-23 | 20 | час рассылки письма (по timezone) |
| `operations.self_signals.plan_not_closing_streak_days` | int | 3 | триггер «план не закрывается» |
| `knowledge.expertise.self_max_blocks_scanned` | int | 2000 | cap блоков при `/me/expertise` |
| `knowledge.expertise.self_top_k` | int | 10 | топ-N тем/сущностей |

**Переиспользуем (не заводить дубли):** `dashboard.stuck.staleDaysThreshold` (5), `tracker.methodCaptureMinComplexity` (0.5), `tracker.methodCaptureEnabled` (true), `tracker.methodCapturePriorityHint` (0.7) — уже в registry+seed.

---

## Фаза 3 — Агент письма `personal-day-narrative` (единственный новый AI-агент)

**3.1 `P2-4` регистрация taskType** (S) — `backend/src/modules/ai/services/llm-router.service.ts`
Добавить `'personal-day-narrative'` **ОДНОВРЕМЕННО** в union `LlmTaskType` (~370, после `personal-brief-hint`) И массив `ALL_LLM_TASK_TYPES` (~844). Иначе уход в `DEFAULT_FALLBACK_CHAIN`. Без явного `dataClass` override — наследует `internal` (DeepSeek-v4 → gpt-5.x → kie/gemini, **без Anthropic**). Опц. seed-запись `LlmTaskRoute` с чейном как у `operations-daily-digest`.

**3.2 `P2-2` промпт-модуль** (M) — новый `backend/src/modules/operations/prompts/personal-day-narrative.prompt.ts`
Зеркало `daily-digest.prompt.ts:103-410`, но per-person и короче:
- `PERSONAL_DAY_NARRATIVE_TASK_TYPE='personal-day-narrative'`, `..._PROMPT_VERSION='personal-day-v1'`.
- `AXIS_KEYS=['tasks','commitments','load','contribution']` (ровно 4, порядок фиксирован).
- `LETTER_KEYS=['intro','tasks','commitments','load','contribution','actions']` (≤6 секций).
- Правила 1:1 с `DAY_COMPANY` (ничего не выдумывать; `cites{label,ref}` только из входных данных; русский; на «ты»; без markdown-таблиц).
- **ЖЁСТКИЙ запрет:** не упоминать настроение/сентимент/эмоц. состояние коллег; не упоминать конфликты/трения с людьми (эти данные физически не кладутся в пакет — см. 3.3).
- **КЭШ (обязательно):** `PERSONAL_DAY_NARRATIVE_SYSTEM_PROMPT` — **статическая константа, байт-в-байт одинаковая для всех сотрудников**. Никакой персональной подстановки (имя, дата, числа) в `systemPrompt` — иначе префикс перестаёт быть идентичным и DeepSeek prompt-cache не сработает. Все переменные данные — только в `userMessage` (см. 3.3). Плюс `userMessage` строится **общий стабильный префикс сверху** (легенда полей/формат пакета) → **изменчивая часть человека снизу** — по образцу `buildDayCompanyUserMessage` (`daily-digest.service.ts:297`).

**3.3 `P2-3` `PersonalDayNarrativeService`** (L) — новый `backend/src/modules/operations/services/personal-day-narrative.service.ts`
`buildPersonDayPackage({tenantId, personId, dateLocal})` собирает 6 источников:
1. **Задачи** — `Issue`: `doneToday` (`assignees.some.userId=self`, `completedAt` в `[dayStart,dayEnd)`), `openOverdue` (паттерн `collectMyTasks` `personal-daily-brief.service.ts:110-152`), `plan/факт` — свои `DailyCheckIn kind=morning/evening` за `dateLocal` (НЕ кросс-персональный `collectReporting`).
2. **Обещания** — НОВЫЙ запрос: `IdeaBlock signalType='commitment'`, `commitmentAuthorPersonId=personId`, `status!=archived`, `supersededById=null` → `commitmentsGivenToday`, `commitmentsOverdue` (`commitmentDueDate<now`); опц. `commitmentRecipientPersonId=personId` — «что обещали тебе».
3. **Загрузка** — `getLoadByPerson` (`execution-dashboard.service.ts:479`), строка self.
4. **Вклад** — `goalContributionNet` (`weekly-per-person.service.ts:386`), формулировать «на этой неделе».
5. **Голос** — `IdeaBlockEvidence.authorPersonId` (`collectEmployeeVoice` `daily-digest.service.ts:796` + фильтр personId).
6. **Блокеры** — `collectMyBlockers` (`personal-daily-brief.service.ts:154`).

`generate(...)`: `this.llm.call({ taskType: PERSONAL_DAY_NARRATIVE_TASK_TYPE, tenantId, systemPrompt: PERSONAL_DAY_NARRATIVE_SYSTEM_PROMPT, userMessage: buildPersonDayUserMessage(pkg, metrics, dateLocal), responseFormat: {type:'json_schema', name:'PersonalDay', schema, strict:true}, reasoningEffort:'medium', sourceRef:{type:'personal-day-narrative', id:`${tenantId}:${personId}:${dateLocal}`} })` — 1:1 с `daily-digest.service.ts:301`. try/catch → сухой `bodyMarkdown` fallback. Upsert в `PersonalDayNarrative` по `@@unique`. **Запрещено** класть в пакет: mood/sentiment, `PersonPulse`, конфликты (`EntityLink conflicted_with`), кросс-персональные данные.

**КЭШ — измеряемое требование:** `systemPrompt` — константа (см. 3.2), поэтому при веере DeepSeek кэширует префикс автоматически (`cacheControl:'ephemeral'` ставит `LlmFallbackService` сам). `result.cachedTokens` пробрасывается в `AiUsageLogService` и учитывается в стоимости (`model-prices.ts` `cachedPer1M`≈1/10). Сервис логирует `cachedTokens` в свой лог-объект (как `daily-digest` логирует `packageChars`), чтобы эксперимент видел hit-rate.

**3.4 `P2-5` `PersonalDayNarrativeCron`** (M) — новый `backend/src/modules/operations/workers/personal-day-narrative.cron.ts`
Структура 1:1 с `personal-daily-brief.cron.ts`: `@Cron('0 * * * *')` почасовой; kill-switch `operations.personal_day_narrative.enabled`; `person.findMany({where:{deletedAt:null, relationship:'employee', userId:{not:null}}, take:5000})`; per-person `localHour=getLocalHour(now,p.timezone)` == `evening_hour` → `dateLocal=getLocalDate(now,p.timezone)` (СЕГОДНЯ, письмо про завершающийся день) → `service.getOrGenerate`.
- **КЭШ — веер подряд, тёплый префикс:** сотрудники одной таймзоны срабатывают в один и тот же час → идут **друг за другом в рамках одного прогона крона** (последовательно или малой ограниченной конкуренцией, БЕЗ длинных пауз между людьми), чтобы DeepSeek prompt-cache префикса не протух между вызовами. Первый человек прогревает кэш, остальные бьют в него. Не размазывать людей одной таймзоны по разным часам.

**3.5 `P2-7` DTO + эндпоинты** (S)
DTO `backend/src/modules/operations/dto/personal-day-narrative.dto.ts` (зеркало `daily-digest.dto.ts`, + `toPersonalDayNarrativeDto()`/`emptyPersonalDayNarrativeDto(dateLocal)`).
- `GET /api/v1/me/day-letter?date=` — в `my-daily-brief.controller.ts` (тот же `@Controller('api/v1/me')`, `@UseGuards(CookieAuthGuard,TenantGuard)`) или новый `my-day-narrative.controller.ts`. Резолв self-person → `narrativeService.getForPerson(...)` → DTO или empty.
- `POST /api/v1/me/day-letter/:id/opened` — отметка прочтения; **404 при чужом personId** (не палить чужие id).

**Acceptance:** письмо генерится вечером по timezone, per-person; при падении LLM — fallback-текст; в письме нет mood/конфликтов; `metricsJson` совпадает с бордом. **Кэш:** при веере из ≥2 сотрудников `result.cachedTokens` у 2-го и далее > 0 (первый прогревает); измерить hit-rate и стоимость на «Стреле» (эксперимент ниже).

---

## Фаза 4 — Сервисы и провайдеры

**4.1 `me-tasks-buckets-service`** (M) — `backend/src/modules/tracker/services/issues.service.ts` (новый public-метод рядом с `findMyInbox` ~747)
`async findMyTaskBuckets(tenantId, userId, opts:{projectId?, limitPerBucket, now}): Promise<TaskBucketsResponseDto>`:
- Кандидат-сет: `where={tenantId, assignees:{some:{userId}}, deletedAt:null, archivedAt:null, OR:[{state:{category:{notIn:['completed','cancelled']}}},{stateId:null}], ...(projectId&&{projectId})}`; `include state.category, project.name`; `take:300`.
- `lastActivityAt`: `issueActivity.groupBy({by:['issueId'], where:{issueId:{in:ids}}, _max:{createdAt}})` (как `getStuckCrossProject:428`).
- `staleDays = cfg.getDynamic('dashboard.stuck.staleDaysThreshold', undefined, 5)`; `cutoff = now − staleDays`.
- Партиция (каждая задача ровно в один из первых трёх): `overdueStuck` (`dueDate<now` ИЛИ `lastActivityAt<cutoff`, reason overdue/stuck/both) → `inProgress` (`category='started'`) → `noDueDate` (`dueDate===null`). Остаток (backlog с будущей датой) — не показываем (развилка 1). Плюс `done`: отдельный запрос `completedAt` в окне `me.tasks.doneWindowDays`.
- Ответ: `{overdueStuck[], inProgress[], noDueDate[], done[], counts:{...}}`.

**4.2 `C3-2` probe→`methodCapturedAt`** (S) — `backend/src/modules/probe/probe-response.handler.ts`
В `dispatchApply()` (~307) ветка `if (probe.reason === 'task.method_capture') { applyResult = await this.maybeApplyMethodCaptureAnswer(...) }`. Новый private-метод по образцу `maybeApplyCompletionDetailAnswer`: `issueId=toStringOrUndef(probePayload.contextCardId)`; `rawAnswer` из classification/response; проставить `Issue.methodCapturedAt=now()`; передать ответ в клон через существующий мостик `skill-signal-types.ts`. Развилка 2: при reopen не сбрасывать.

**4.3 `decision-action-self-provider`** (M) — новый `backend/src/modules/pending-actions/providers/decision-action.provider.ts` (+ типы + service + ветка confirm)
`buildWhere`: `{tenantId, deletedAt:null, impliesAction:true, linkedTaskCount:0, decidedByPersonIds:{has:selfPersonId}}` (GIN-индекс). ВСЕГДА self-scope (личный дневник, `isPrivileged` не применяется). `order decidedAt??createdAt asc`. `confirm(accept)` → `IntakeIssue(source='decision', suggestedAssigneeId=self)` + `decision.actionExtractedAt=now()`; `dismiss` → требует 1.3.

**4.4 `commitment-action-self-provider`** (M) — новый `backend/src/modules/pending-actions/providers/commitment-action.provider.ts`
`buildWhere`: `{tenantId, signalType:'commitment', commitmentAuthorPersonId:selfPersonId, status:{not:'archived'}, supersededById:null, mergedIntoId:null, linksTo:{none:{relationType:'resolves'}}}`. `order commitmentDueDate asc nulls last`. `severity='urgent'` если просрочено. `confirm(accept)` → `Issue` через `TaskDraftMaterializer` (sourceBlockId, assignee=self).

**4.5 `me-plan-not-closing`** (M) — `backend/src/modules/operations/services/daily-checkin.service.ts` (новый метод)
`getPlanNotClosingStreak({tenantId, personId, now})`: последние ~14 `DailyCheckIn kind='evening', completedAt not null, personId=self`, select `{dateLocal, notDoneJson}`, order desc; считать `streakDays` подряд идущих дней с непустым `notDoneJson`; порог `operations.self_signals.plan_not_closing_streak_days` (3). Ответ `{streakDays, triggered, lastNotDoneItems:string[] cap 5}`. **Не трогает sentiment** — только факт «план не закрылся».

**4.6 `me-expertise`** (M) — новый `backend/src/modules/dashboard/services/person-expertise.service.ts` (в `dashboard/`, т.к. `DashboardModule` уже импортит `OperationsModule`)
`getMyExpertise({tenantId, personId})`: `ideaBlock.findMany({where:{tenantId, authorPersonId}, orderBy:{sourceTimestamp:desc}, take:max_blocks_scanned, select:{id}})` (индекс `[tenantId,authorPersonId,sourceTimestamp]`); `themeIdeaBlock.groupBy({by:['themeId'], where:{blockId:{in:ids}}, _count})` + join `Theme.name` (topK); аналогично `ideaBlockEntity.groupBy` + `Entity.canonicalName`. Ответ: топ тем/сущностей = «носитель знания по X».

---

## Фаза 5 — Эндпоинты `/me/*`

Все: `[CookieAuthGuard, TenantGuard]`, self-scope по `@CurrentUser().id`, Zod-DTO + Swagger.

| Эндпоинт | Контроллер | Тело | Статус |
|---|---|---|---|
| `GET /me/tasks/buckets` | новый `me-tasks.controller.ts` (tracker) | `findMyTaskBuckets(uid)` | 4.1 |
| `GET /me/tasks/method-capture-pending?limit=20` | `me-tasks.controller.ts` | `completedAt not null, methodCapturedAt null, assignees.some(self)`, фильтр `computeMethodCaptureComplexity ≥ tracker.methodCaptureMinComplexity` (`issues.service.ts:1347`, переиспользовать) | 3.3-зависит |
| `GET /me/night-ledger` | новый `my-night-ledger.controller.ts` (operations) | 3 источника Promise.all: авто-черновики (`issueProgressUpdate authorType=ai_agent, draftState=pending, issue.assignees.some(self)`), `intakeIssue source=meeting suggestedAssigneeId=self status=pending`, `cloneQueryLog cloneScope=person cloneTargetId=self.personId createdAt≥window`. Окно 24ч (MVP). | сборка |
| `GET /me/load` | новый `my-execution-dashboard.controller.ts` (dashboard) | `getLoadByPerson({tenantId}).rows.find(userId===uid)` | reuse |
| `GET /me/stuck` | тот же контроллер | `getStuckCrossProject({tenantId,now}).items.filter(assigneeUserId===uid)` | reuse |
| `GET /me/check-ins/plan-signal` | `my-check-ins.controller.ts` (сущ.) | `getPlanNotClosingStreak(...)` | 4.5 |
| `GET /me/clone-impact` | `MeCloneAccessController` (`clones.controller.ts:367`) | `getCloneImpactSummary`: `cloneQueryLog.groupBy(answeredGrounded, where cloneScope=person, cloneTargetId=self.personId)` + last 5. **`ClonesModule.imports += OperationsModule`** (циклов нет) | 🆕 |
| `GET /me/expertise` | `my-execution-dashboard.controller.ts` | `getMyExpertise(...)` | 4.6 |
| `GET /me/company-blockers` | `me.controller.ts` (сущ., `MeModule.imports += OperationsModule`) | `blockerSynthesis.listChronicForTenant(...)` map `isMine = responsiblePersonId===self`. 🔒 **до прода — гейт приватности** (см. ниже) | 🆕 + блокер |
| `GET /me/company-ideas` | `me.controller.ts` (`MeModule.imports += IdeasModule`) | `ideas.getTop({tenantId,userId,query})` (тот же метод, `gateProjections` держит приватность) + поле `myIdeasThisMonth = countMineSince(начало месяца)` | 🆕 (решение владельца) |
| pending-actions `source='decision_action'`, `'commitment_action'` | расширение существующего роута | 4.3, 4.4 | 🆕 |

**🔒 Гейт приватности `/me/company-blockers` (блокер до прода):** `listChronicForTenant` не фильтрует dept/closed-группы. До выката: фильтр `relatedBlockIds` через `KnowledgeAccessResolver.partitionProjectionsByAccess` ИЛИ не отдавать `relatedBlockIds` + усечь `representativeText`. Без этого — утечка мимо access-групп.

**`isMine` частичен:** достоверен для блокеров из чек-инов; для встречных (`IdeaBlock blocker`) `commitmentAuthorPersonId` не проставляется → «своё» работает частично. Полный fix — доработка `block-ingest.worker` (отдельный тикет, не блокирует MVP).

---

## Фаза 6 — Фронт (`frontend/`)

- Стартовый роут сотрудника: `/meetings` → `/me` (единый экран).
- Экран `/me` в директорском стекле: обложка-письмо (`GET /me/day-letter`) + 4 оси → борд задач (`GET /me/tasks/buckets`, клик → трекер) → «требует тебя» (pending-actions) → «Кора за ночь» → «на твоей стороне»/«ты двигаешь» → ленты блокеров/идей → трастовый футер.
- Слои `ApiDto → DomainModel → UiModel`; SWR; визуальная опора — `scratchpad/site/index.html`.
- Значок «🎤 расскажи как делал» на закрытых из `/me/tasks/method-capture-pending` → probe-ответ.

---

## Кросс-каттинг

**prod-deploy-log (`docs/operations/prod-deploy-log.md`):**
- Шаг 4: `PersonalDayNarrative` (новая таблица), `Issue.methodCapturedAt` (новая колонка), опц. `decisions.actionDismissedAt`.
- Шаг 1 / feature-flags.md: `operations.personal_day_narrative.enabled` (kill-switch) + `evening_hour` + 4 крутилки self-сигналов + `me.tasks.doneWindowDays`.
- Шаг 12 (smoke): новый cron `PersonalDayNarrativeCron`; новые REST `/me/day-letter`, `/me/tasks/buckets`, `/me/night-ledger`, `/me/load`, `/me/stuck`, `/me/clone-impact`, `/me/expertise`, `/me/company-blockers`, `/me/company-ideas`.
- Все seed AdminSetting — через `apply-prod-deploy.ts STEPS`.

**second-brain по завершении:** `01_projects/` профильная заметка стенда; `02_architecture/module-map.md` (новые контроллеры); `01_projects/ai-jobs.md` + `workers-queues.md` (`PersonalDayNarrativeCron`); `01_projects/api-layer.md` (`/me/*`); `data-model.md` (`PersonalDayNarrative`, `Issue.methodCapturedAt`); `docs/methodology/prompts/` (новый промпт письма).

**Тесты:** юнит на RBAC-обход (Фаза 0); юнит на партицию 4 букетов (граничные: `dueDate=now`, `stateId=null`, `completedAt` на границе окна); интеграционный на self-scope (чужой `userId` не протекает); тест агента письма на отсутствие sentiment/конфликтов в пакете.
**Кэш-тесты** (в дополнение к существующим `prompt-caching.spec.ts` / `llm-fallback.service.spec.ts`): юнит — `PERSONAL_DAY_NARRATIVE_SYSTEM_PROMPT` не содержит персональных подстановок (стабилен между двумя разными `personId`); юнит — `generate` передаёт данные человека в `userMessage`, а не в `systemPrompt`; эксперимент на «Стреле» — веер ≥5 писем, проверить `cachedTokens>0` со 2-го, залогировать hit-rate и стоимость с кэшем vs без.

## Порядок и оценка
29 build-items: 1 L (`P2-3`), 13 M, 15 S. Порядок фаз: **0 (хотфикс, параллельно) → 1 (миграции) → 2 (крутилки) → 3 (агент) → 4 (сервисы) → 5 (эндпоинты) → 6 (фронт)**. Внутри фаз 4–5 items независимы, можно параллелить. Backend целиком; UI — поверх готовых эндпоинтов.

## Решения владельца перед стартом (из блюпринта §6)
1. Букет «Запланировано» — по умолчанию НЕ показываем (4 колонки).
2. `methodCapturedAt` при reopen — не сбрасываем (спрашиваем раз).
3. Ось «Обещания» — нейтрально, без «нарушил».
4. **Ленты блокеров/идей компании — ослабление периметра, нужна явная санкция** (включить с гейтом / только свои / отложить).
5. Тайминг «за ночь» — MVP как есть, timezone второй итерацией.
6. Вклад — «на этой неделе» (ежедневный пересчёт — отдельное ТЗ).
