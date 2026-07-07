---
type: tz
status: draft
feature: company-about-into-extraction-agents
date: 2026-07-07
owner: sergrv80@gmail.com
depends_on:
  - plans/tz/2026-07-07-company-summary-incremental-fix.md
relates_to:
  - backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts
  - backend/src/modules/ai/services/prompts/tasks-unified.ts
  - backend/src/modules/knowledge-core/services/chat-v2.service.ts
---

# ТЗ: Прокинуть описание компании в извлекающие агенты (block-ingest + tasks)

> Готовое описание компании («чем занимается») сейчас видят только агенты-ответчики (chat-v2, concierge). Извлекающий конвейер — **деление на блоки + извлечение сущностей** (block-ingest) и **постановка задач** (tasks) — его НЕ получает. Задумка владельца: агент при извлечении должен понимать, в какой компании это происходит. Прокидываем короткую капсулу «## О компании» в оба извлекающих промпта единым переиспользуемым загрузчиком.

## Зависимость от ТЗ починки (порядок реализации)

**Сначала [2026-07-07-company-summary-incremental-fix.md](2026-07-07-company-summary-incremental-fix.md), потом это.** Капсула читает `CompanyProfile.summaryJson.contentMd`; пока это раздутый текст на 3–5 абзацев, прокидывать его в КАЖДЫЙ вызов извлечения — дорого по токенам и шумно. После починки там будет короткий паспорт (4–6 предложений) — его и инъектим.

## Контекст и диагноз (проверено чтением кода 2026-07-07)

- **block-ingest** ([block-ingest.prompt.ts](../../backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts), `BuildArgs` :482, `buildBlockIngestPrompt` :503) — в аргументах есть `meetingTitle/meetingType/participants/skeleton`, профиля компании **нет вообще**. Единственный вызов — [block-extraction.service.ts:569](../../backend/src/modules/knowledge-core/services/block-extraction.service.ts#L569).
- **tasks** — `companyAbout` нет; более того, прод-путь `TaskExtractionService.extractTasks` ([task-extraction.service.ts:43](../../backend/src/modules/ai/services/task-extraction.service.ts#L43)) через `buildTasksStructuredPrompt` ([tasks-structured.ts:62](../../backend/src/modules/ai/services/prompts/tasks-structured.ts#L62)) не передаёт даже `orgContext` (проекты/цели/люди) — `TASKS_STRUCTURED_OPTIONS` его не содержит. `opts.orgContext` рендерится в `buildUserUnified` ([tasks-unified.ts:260](../../backend/src/modules/ai/services/prompts/tasks-unified.ts#L260)), но структурированный путь его не наполняет.
- **Эталон капсулы** уже есть: `chat-v2.buildCompanyAbout` ([chat-v2.service.ts:2283](../../backend/src/modules/knowledge-core/services/chat-v2.service.ts#L2283)) — читает `displayName/stage/summaryJson/missionJson`, собирает блок «## О компании / Чем занимается: …», инкрементит метрику `company_capsule_injected{surface}`. Логику переиспользуем, не дублируем.

## Цель и не-цель

**Цель:** и block-ingest, и tasks получают короткую капсулу «## О компании» (чем занимается, продукт, стадия) через один общий загрузчик; **плюс** структурированный путь задач начинает получать `orgContext` (проекты/цели/люди), который сейчас до него не доезжает. Извлечение сущностей и задач становится контекстно-привязанным к бизнесу компании.

**Не-цель:** не менять состав/схему извлечения (типы сигналов, поля задач); не раздувать промпты (капсула короткая, из паспорта ТЗ#1); не трогать summary-компилятор (это ТЗ#1); не менять сам `OrgContextService.load` (переиспользуем как есть).

## Целевое решение

### Общий загрузчик капсулы

Новый `CompanyCapsuleService` в **ai-модуле** (там же, где `OrgContextService`; ai уже зависимость и knowledge-core, и task-extraction):
- `constructor(@Inject(PrismaService) prisma, @Optional() @Inject(BusinessMetricsService) metrics?)`.
- `async load(tenantId: string | null, surface: string): Promise<string>` — при `!tenantId` → `''`; иначе `prisma.companyProfile.findUnique({ where: { tenantId }, select: { displayName, stage, summaryJson, missionJson } })`; собрать блок ровно как `chat-v2.buildCompanyAbout` («## О компании», строки «Название/Чем занимается/Стадия/Миссия»); при непустом — `metrics?.incCompanyCapsuleInjected({ surface })`; fail-open (ошибка → `''` + warn).
- Зарегистрировать в `AiModule` providers **и** exports.
- **Рефактор-дедуп (рекомендуется):** `chat-v2` начинает использовать `CompanyCapsuleService.load(tenantId, 'chat_v2')`, приватный `buildCompanyAbout` удаляется. (Если модульная развязка усложняет — оставить chat-v2 как есть, но новый сервис обязателен для extraction.)

### Инъекция в промпты — только в USER-сообщение

Капсула идёт в **user-часть**, НЕ в system — чтобы не ломать общий (межтенантный) prefix-cache system-промптов. Внутри тенанта капсула стабильна между окнами → кэш тенанта цел.

**block-ingest** ([block-ingest.prompt.ts]):
- `BuildArgs` += `companyAbout?: string`.
- В `buildBlockIngestPrompt` вставить капсулу отдельной секцией в начало `user` (перед `header`/`mapSection`): если непусто — `${companyAbout}\n\n`.

**tasks-unified** ([tasks-unified.ts]):
- `TasksPromptOptions` += `companyAbout?: string`.
- В `buildUserUnified` рендерить секцию «## О компании» рядом с блоком `orgContext` (до «Диалог:»), если непусто.

### Проводка во все вызовы билдеров

- **block-extraction.service.ts** ([:569](../../backend/src/modules/knowledge-core/services/block-extraction.service.ts#L569)): инжектировать `CompanyCapsuleService`, `const companyAbout = await this.capsule.load(args.tenantId, 'block_ingest')`, передать `companyAbout` в `buildBlockIngestPrompt({ ... })`. (Грузить один раз на извлечение, не на каждое окно — если билд промпта в цикле по окнам, поднять загрузку выше цикла.)
- **tasks-structured.ts** `TasksStructuredPromptInput` += `companyAbout?: string` **и** `orgContext?: TasksOrgContext`; `buildTasksStructuredPrompt` форвардит оба в `opts.companyAbout` / `opts.orgContext` (плюс `meetingDateIso` из `orgContext`, если пришёл).
- **task-extraction.service.ts** ([:41](../../backend/src/modules/ai/services/task-extraction.service.ts#L41)): инжектировать `CompanyCapsuleService` **и** `OrgContextService` (оба в ai-модуле, обёрнуть `@Optional()` как `metrics`, чтобы не ломать существующие места создания сервиса). Загрузить `companyAbout` (surface `'tasks'`) и `orgContext = await this.orgContext?.load(input.tenantId, null)` по `input.tenantId`; передать `{ ..., companyAbout, orgContext }` в `buildTasksStructuredPrompt`. При `tenantId=null` — оба пустые, поведение как сейчас.
- **Проверить и покрыть остальные вызовы** `buildTasksPromptUnified` / `buildBlockIngestPrompt`: путь `analyze.worker` (если он строит задачи с `orgContext` — добавить туда `companyAbout` тем же загрузчиком), `tasks.ts:buildTasksPrompt`. `code-fallback.adapter.ts:76` (dummy для прогрева) — не трогать. Критерий: каждый реальный (не dummy) вызов билдера форвардит `companyAbout`.

## Критерии приёмки

1. `bun run typecheck && lint && build` — зелёные.
2. Unit:
   - `CompanyCapsuleService`: непустой профиль → блок «## О компании» + метрика; `tenantId=null` → `''`; ошибка prisma → `''` (fail-open).
   - block-ingest: при переданном `companyAbout` user содержит «## О компании»; без — прежний вывод (обратная совместимость).
   - tasks-unified: `opts.companyAbout` рендерится секцией; snapshot обновлён.
   - task-extraction / block-extraction: капсула грузится и прокидывается (мок сервиса вызван с нужным surface).
   - task-extraction: `OrgContextService.load` вызван, `orgContext` (проекты/цели/люди) доехал до `buildTasksStructuredPrompt` → в user есть секции «Проекты организации / Активные цели / Сотрудники организации».
3. Снапшоты промптов (`tasks-unified.snapshot`, `block-ingest.snapshot`) обновлены и показывают секцию.
4. Ручная проверка (после выката, на «Ооо луа»): в логе LLM-вызовов извлечения (block-ingest и tasks) user-сообщение содержит «## О компании / Чем занимается: …»; метрика `company_capsule_injected{surface="block_ingest"}` и `{surface="tasks"}` растут.

## Прод-операции (для prod-deploy-log)

- Новый LLM-инпут (секция капсулы) в промптах block-ingest/tasks — сверить с `docs/methodology/prompts/`.
- Новый сервис/метрика-лейблы — код внутри backend, отдельных prod-действий нет (выкат образа). ENV/миграций/сидов не добавляется.

## Открытые развилки

Нет — развилка про `orgContext` для задач решена и включена в scope (см. Цель + проводка `task-extraction.service`).
