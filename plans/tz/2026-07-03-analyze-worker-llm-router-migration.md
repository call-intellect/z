---
type: tz
status: ready-to-implement
feature: analyze-worker-llm-router-migration
date: 2026-07-03
owner: Tozix
relates_to:
  - plans/architecture/2026-07-03-analyze-worker-llm-router-migration.md
  - plans/tz/2026-07-02-llm-providers-models-routing-admin.md
  - second-brain/04_не-сделано/README.md
---

> Архитектура (одобрена владельцем 2026-07-03): `plans/architecture/2026-07-03-analyze-worker-llm-router-migration.md`. Статус согласования: одобрено — вариант А (Ship-On + временный аварийный рубильник); модельная развилка (см. Принятые решения В-модели) — решено 1:1-behavior-preserving на первом шаге.

# ТЗ: `analyze.worker` мигрирует с `LlmFallbackService` на `LlmRouterService`

## Принцип

Пять реальных вызовов ИИ в `AnalyzeWorker` (`summary`/`report-by-type`/`follow-up`/`custom`/`client_protocol`) переходят на `LlmRouterService.call()` за временным аварийным рубильником (default ON). Модельное поведение на первом шаге — **точная копия сегодняшнего** (`deepseek-v4-pro` → `minimax:MiniMax-M2.5` → `openai-via-proxy:gpt-5-mini`), экономия на более дешёвых моделях для менее критичных операций — отдельное решение владельца ПОСЛЕ стабилизации (не в этом ТЗ).

## Цель + Зачем

Самый частый и дорогой AI-путь продукта (главный отчёт о встрече) сегодня работает мимо единой системы маршрутизации моделей — не виден в панели «Роутинг моделей», не защищён бюджетом (Фича 2 этого пакета), расходы на него не привязаны к компании. Миграция подключает его к тому же механизму, что и весь остальной ИИ, без изменения содержания отчётов.

## REALITY-CHECK (проверено 2026-07-03, номера строк — на момент написания, перечитать перед правкой)

**Легаси-путь — 5 реальных вызовов, не 6 (важная поправка к исходной постановке):**
- `AnalyzeWorker.callLlm()` (`backend/src/modules/ai/workers/analyze.worker.ts:749-790`) — единственная точка вызова `this.llm.complete(args.input)` (`LlmFallbackService`, `:761`), инжектится в конструкторе (`:70`). Параметр `agentType` типизирован как `'summary' | 'report-by-type' | 'follow-up' | 'tasks' | 'custom' | 'client_protocol'` (`:752`), но **`'tasks'` НИКОГДА не передаётся** — грепом по файлу нет ни одного `agentType: 'tasks'`; соседний тест (`analyze.worker.spec.ts:254`, комментарий «tasks-блок снят 2026-06-10») подтверждает, что функционал удалён, а тип-литерал остался мёртвым. Реальные вызовы: `agentType: 'summary'` (`:434`), `'client_protocol'` (`:467`), `'custom'` (`:502, :532`), `'report-by-type'` (`:621`), `'follow-up'` (`:715`).
- `LlmFallbackService.complete()` (`backend/src/modules/ai/services/llm-fallback.service.ts:25-55`) — если `cfg.ai.mainReport.primary==='deepseek'` (код-дефолт в `typed-config.service.ts:262`, ENV `LLM_MAIN_REPORT_PRIMARY`) → `deepseek.complete()` (с `model` из `args.input.model`, всегда `MAIN_REPORT_MODEL='deepseek-v4-pro'`, `analyze.worker.ts:55`) → на ошибке → `minimax.complete()` (модель НЕ передаётся, берёт `this.defaultModel='MiniMax-M2.5'`, `minimax.service.ts:20,40`) → на ошибке → `openai.complete()` (модель НЕ передаётся, `this.defaultModel='gpt-5-mini'`, `openai-proxy.service.ts:21,42`). Иначе (не-deepseek ветка) — только 2 уровня: minimax→openai. **Дефолт кода — deepseek, миграция ориентируется на deepseek-ветку как основной наблюдаемый в проде путь.**
- `callLlm()` finally-блок (`:766-789`) **вручную** вызывает `this.usage.record()` (`AiUsageLogService`, инжектится `:71`) с `agentType` из аргумента, БЕЗ `tenantId` и БЕЗ `taskType` в передаваемом объекте — обе колонки `AiUsageLog.tenantId`/`AiUsageLog.taskType` остаются `NULL` для ВСЕХ вызовов главного отчёта сегодня. Это самостоятельная, ранее не описанная находка: расходы на самый большой AI-путь продукта не атрибутируются ни одной организации.

**Что уже частично подготовлено (снижает объём миграции — REALITY-CHECK по правилу «60-70% готово, не задваивай scope»):**
- `LlmTaskType` (union, `llm-router.service.ts:42-...`) и `ALL_LLM_TASK_TYPES` (массив, `:686-...`) уже содержат `'summary'` (`:43,687`), `'follow-up'` (`:49,693`), `'custom-prompt'` (`:48,692`), `'client-meeting-split'` (`:662,942`). **`'report-by-type'` НЕ входит ни в union, ни в массив** — существует только как «осиротевший» литерал в возвращаемом типе приватного метода `taskTypeToAgentType()` (`:2099`), который явно предвосхищал эту миграцию, но не был завершён.
- `backend/scripts/patch-llm-routes-report-chain-deepseek.ts` (в проде, зарегистрирован в `apply-prod-deploy.ts:516`) уже создал `LlmTaskRoute`-строки для `taskType='summary'`, `taskType='report-by-type'` (строкой в обход тайп-чека — Prisma хранит `taskType` как `String`, не enum) и `taskType='tasks'` (тот, что НЕ используется в analyze.worker — путать не с чем, это другой потребитель). Цепочки: `summary`/`tasks` → `deepseek-v4-flash` (ДЕШЕВЛЕ легаси-`deepseek-v4-pro`); `report-by-type` → `deepseek-v4-pro` (СОВПАДАЕТ с легаси по primary, но fallback другой — `gpt-5.4-mini`→`qwen3:30b`, не `minimax`→`gpt-5-mini`).
- `backend/scripts/seed-llm-task-routes-default.ts:71-90` уже сеет `custom-prompt` и `follow-up` с цепочкой `deepseek-v4-flash`→`gpt-5.4-mini`→`gemini-3.1-pro` — тоже ДЕШЕВЛЕ легаси.
- `client-meeting-split` НЕ имеет НИ ОДНОЙ сидированной `LlmTaskRoute`-строки — без явного сида после миграции пошёл бы по `resolveDefaultChain()` (`llm-router.service.ts:1894-1910`, код-дефолт `DEFAULT_FALLBACK_CHAIN` = `deepseek`(без модели, т.е. DeepSeek-клиента дефолт)→`openai-via-proxy`(без модели)→`kie:gemini-3.1-pro`, `:1036-1040`) — это протокол ДЛЯ КЛИЕНТА (внешне видимый документ), менять его модель непреднамеренно недопустимо.
- **`taskTypeToAgentType()` (`llm-router.service.ts:2097-2110`) — единственное место, которое присваивает `AiUsageLog.agentType` при вызове через `LlmRouterService.call()` (используется на `:1685,1782`, внутри `usage.record()`; `LlmCallParams` НЕ имеет поля `agentType` — caller не может его передать явно).** Текущий `switch` обрабатывает только `'summary'`/`'tasks'`/`'follow-up'`, для ВСЕГО остального (включая `'report-by-type'`, `'custom-prompt'`, `'client-meeting-split'`) возвращает `'custom'` по `default`. Это баг, который эта миграция ОБЯЗАНА исправить — иначе после миграции все report-by-type/client-protocol вызовы будут закладываться в аналитику под неправильной меткой `agentType='custom'`, теряя сегодняшнюю гранулярность дашбордов.
- **Характеризующие тесты уже существуют и достаточны** — `backend/src/modules/ai/workers/analyze.worker.spec.ts` (594 строки, 12 тестов) мокает ИМЕННО границу `LlmFallbackService.complete` (`:120`, `const llm = { complete: args.llmComplete } as unknown as LlmFallbackService`) и покрывает: основной sales-флоу (summary+structured+follow-up, `:202`), customPrompt (`:254`), prompt-injection guard on/off (`:284,326`), summary-агент за флагом (`:360,387`), провал `ingestMeeting` (`:407,447`), `client-meeting-split` за флагом on/off (`:473,529`), `onJobFailed` (`:572`). **Отдельная фаза «написать характеризующие тесты» НЕ нужна** — существующий набор уже фиксирует бизнес-поведение на нужной границе; Фаза 4 этого ТЗ адаптирует моки под новую границу (`LlmRouterService.call`), не переписывая проверяемую логику.
- `LlmRouterService.call()` (`:1522-...`) уже сам пишет в `AiUsageLog` (`:1680-1704`, включая точный `costUsd` через `computeCostUsd()` с БД-прайскартой — точнее сегодняшнего статического `calcCostUsd()`), сам ставит `cacheControl:'ephemeral'` (`dispatch()`, `:1992` — идентично легаси-дефолту), сам пробрасывает `tools` (`:2001` — идентично легаси). Это означает: после миграции ручной вызов `this.usage.record()` внутри `callLlm()` finally-блока станет ДУБЛЕМ (двойная запись каждого вызова) — обязателен к удалению для router-пути (Фаза 4).

**Контрактное несоответствие типов, требующее адаптера:** `LlmCompleteInput`/`LlmCompleteOutput` (`llm.types.ts`, использует `LlmFallbackService`) vs `LlmCallParams`/`LlmCallResult` (`llm-router.service.ts:1098-1179`, использует `LlmRouterService.call()`). Ключевые отличия: `system:{text,cacheControl}` + `user` → `systemPrompt: string` + `userMessage: string` (плоские строки, cache control не настраивается caller'ом — уже всегда `ephemeral`); обязательный `tenantId: string|null`; вывод `model`+`provider` раздельно → `modelUsed: string` (формат `provider:model`, распарсить через `:`) вместо `model`; `pickToolInput()` (`analyze.worker.ts:851-860`) типизирован под `LlmCompleteOutput | null | undefined`, читает только `.toolCalls` — поле идентичной формы (`LlmToolCall[]`) есть и в `LlmCallResult`, адаптер — расширение типа параметра, не переписывание тела функции.

**Третья, независимая система (НЕ трогать):** `PromptResolverService`/`resolved.experimentGroup` (`analyze.worker.ts:603`, промпт-шаблонное A/B, из совсем другого механизма, не из `LlmModelExperiment`/`route.experiment` Фичи 1) — управляет ТЕКСТОМ промпта, а не выбором модели; продолжает работать без изменений, эта миграция меняет только КАК отправляется запрос, не ЧТО в нём.

## Принятые решения владельца

| # | Решение | Обоснование | Не пересматривать |
|---|---|---|---|
| В-flag | Ship-On с временным аварийным рубильником `aiFeatures.analyzeWorkerRouterEnabled` (default `true` = новый путь). При `false` — откат на `LlmFallbackService` без нового релиза. | Архитектура, Шаг 8, вариант А — единственное узаконенное исключение из Ship-On (временная страховка на критичном пути). | Да, до отдельного решения владельца о снятии рубильника |
| В-модели | На первом шаге ВСЕ пять `taskType` получают идентичную легаси цепочку (`deepseek-v4-pro`→`minimax:MiniMax-M2.5`→`openai-via-proxy:gpt-5-mini`), включая перезапись уже подготовленных более дешёвых сидов (`summary`/`follow-up`/`custom-prompt`/`tasks`-чужой). Экономия на дешёвых моделях — отдельное будущее решение через панель «Роутинг моделей» (Фича 1). | Владелец подтвердил: нельзя одновременно менять способ доставки И реальное качество/стоимость результата на самом рискованном пути продукта — сначала стабилизация, потом осознанная экономия. | Да — до отдельного явного решения владельца об экономии |
| В-usage | Ручной `this.usage.record()` в `callLlm()` убирается для router-пути (дубль); для legacy-пути (рубильник OFF) — остаётся как есть. | `LlmRouterService.call()` уже пишет `AiUsageLog` сам, с более точной ценой (БД-прайскарта) и правильной атрибуцией `tenantId`/`taskType` — то, чего сегодня как раз не хватает (см. REALITY-CHECK). | Да |
| В-tasks | Литерал `'tasks'` в типе `agentType` параметра `callLlm()` удаляется как мёртвый код. | Функционал снят 2026-06-10 (см. тест `analyze.worker.spec.ts:254`), литерал не соответствует ни одному реальному вызову. | Да |

## Доказательство выбора (два прохода + challenge-loop)

### Б1 — Судьба существующих «дешёвых» сидов при миграции: перезаписать vs слить с приоритетом дешёвых

- **Проход A (перезаписать всё под легаси, 1:1).** Новый патч-скрипт форсирует ВСЕ пять `taskType` на цепочку `deepseek-v4-pro→minimax→openai-proxy`, включая уже существующие более дешёвые записи для `summary`/`follow-up`/`custom-prompt`.
- **Проход B (сохранить дешёвые там, где они уже есть, легаси — только там, где пусто).** `summary`/`follow-up`/`custom-prompt` остаются на подготовленных `deepseek-v4-flash`-цепочках (экономия с первого дня); только `report-by-type` (fallback другой) и `client-meeting-split` (пусто) получают легаси-цепочку.

| Критерий | A (форсировать 1:1) | B (сохранить дешёвые) |
|---|---|---|
| Соответствует решению владельца (В-модели) | Да — явно выбран этот вариант | Нет — владелец явно попросил «сначала 1:1» |
| Изолирует риск (один фактор риска на переход) | Да | Нет — 3 из 5 задач меняют модель ОДНОВременно со сменой пути доставки |
| Экономия с первого дня | Нет | Да, но ценой смешанного риска |

**Выбор: A** — прямое следствие решения владельца (В-модели), задан явно батч-вопросом в этой сессии.

### Б2 — Рубильник: где хранить и как читать

- **Проход A (AdminSetting boolean, по образцу `clientProtocolEnabled`).** `resolveSync<boolean>('aiFeatures.analyzeWorkerRouterEnabled', 'ANALYZE_WORKER_ROUTER_ENABLED', true)` в `TypedConfigService` (`typed-config.service.ts`, рядом с `:543-547`), регистрация в `admin-setting-schema-registry.ts` (`['aiFeatures.analyzeWorkerRouterEnabled', z.boolean()]`, по образцу `:147`), проверка в `analyze.worker.ts` через `this.cfg.aiFeatures.analyzeWorkerRouterEnabled !== false` (по образцу `:562`).
- **Проход B (процент трафика через `getDynamic` число 0-100).** Постепенный rollout — например, 10% встреч идут через новый путь, остальные — через старый, наращивая процент вручную.

| Критерий | A (boolean kill-switch) | B (процент трафика) |
|---|---|---|
| Соответствует принятому владельцем решению | Да — «временный аварийный рубильник», не «поэтапный rollout» (архитектура, Шаг 8, вариант А выбран явно, не вариант «поэтапный rollout через %») | Нет — это другой из двух предложенных архитектурой вариантов, владелец не выбрал его |
| Прецедент в кодовой базе | Да — `clientProtocolEnabled`/`docCompilerEnabled`, тот же паттерн | Нет прямого прецедента именно для boolean fallback между ДВУМЯ РЕАЛИЗАЦИЯМИ (GEPA-процент — для промптов, другая задача) |
| Простота отладки при инциденте | Высокая — либо всё на новом пути, либо всё на старом | Ниже — часть встреч на одном пути, часть на другом, сложнее локализовать проблему |

**Выбор: A** — соответствует явному выбору владельца и существующему паттерну проекта.

### Challenge-loop
1. **Корень, не симптом?** Да — мигрируем ВЕСЬ класс вызовов (все 5), не один.
2. **Самое эффективное?** Да — `LlmRouterService.call()` уже существует и уже интегрирован с ценами/бюджетом/A-B/tenant-атрибуцией; строить параллельную инфраструктуру было бы кодом ради кода.
3. **Код ради кода?** Нет — переиспользуем `pickToolInput` (расширяем тип, не переписываем), существующие тесты (адаптируем моки, не переписываем логику), существующий kill-switch паттерн.

## Scope

### Входит
- Backend: `'report-by-type'` добавлен в `LlmTaskType`/`ALL_LLM_TASK_TYPES`; `taskTypeToAgentType()` корректно мапит все 5 задействованных taskType.
- Backend: новый патч-скрипт, форсирующий легаси-совместимую цепочку для всех 5 `taskType` (перезаписывает существующие дешёвые сиды, см. Б1=A), зарегистрирован в `apply-prod-deploy.ts`.
- Backend: kill-switch `aiFeatures.analyzeWorkerRouterEnabled` (registry + seed + `TypedConfigService` + `docs/operations/feature-flags.md`).
- Backend: `AnalyzeWorker.callLlm()` — новая реализация, вызывающая `LlmRouterService.call()` при рубильнике ON (default), с адаптером `LlmCallParams`↔legacy-input и `LlmCallResult`↔`LlmCompleteOutput`; при OFF — старый путь через `LlmFallbackService` (код НЕ удаляется в этом ТЗ).
- Backend: удаление мёртвого литерала `'tasks'` из типа `agentType` в `callLlm()`.
- Тесты: адаптация моков `analyze.worker.spec.ts` под новую границу (`LlmRouterService.call`), сохраняя проверяемое поведение; новые тесты на `taskTypeToAgentType()` (все 5 задействованных + существующие 3 + `default`); тест на кэш-независимость (kill-switch OFF → используется `LlmFallbackService`, ON → `LlmRouterService`).

### Не входит
- Удаление `LlmFallbackService` и снятие кill-switch — отдельное явное решение владельца ПОСЛЕ периода стабилизации (см. vNext-заглушка ниже).
- Экономия на дешёвых моделях для summary/follow-up/custom-prompt (В-модели) — отдельное будущее решение владельца, вне этого ТЗ. **vNext:** после стабилизации — через панель «Роутинг моделей» (Фича 1) переключить эти 3 задачи на уже существующие в БД дешёвые конфигурации (они не удаляются физически патчем — патч просто перезаписывает `providers`/`chain`, история переключений сохраняется в `LlmTaskRouteChange`).
- Фазовый/процентный rollout (Б2 вариант B) — не выбран.
- Любые изменения в `PromptResolverService`/шаблонах промптов по типу встречи.
- Правки `client-meeting-split`'s бизнес-флага `clientProtocolEnabled` (решает, генерировать ли протокол вообще — не трогаем, ортогонально маршрутизации).

## Граничные контракты с другими ТЗ

- Фича 2 (`plans/tz/2026-07-03-llm-budget-cost-rub-hard-cap-fix.md`): после этой миграции звонки главного отчёта впервые начнут корректно попадать в `AiUsageLog.tenantId`/`costRub` (через починенный `record()` внутри `LlmRouterService.call()`) — это ПОБОЧНЫЙ положительный эффект, не требует координации фаз (Фича 2 может катиться независимо, до или после).
- Фича 1 (`plans/tz/2026-07-03-llm-model-ab-experiments-real-split.md`): после обеих миграций все 5 `taskType` этого ТЗ становятся доступны для A/B-тестов через панель «Роутинг моделей» — не требует координации, чисто аддитивно.

## Контракт-first

### 1. `llm-router.service.ts` — добавить `'report-by-type'` в реестр (правка `:42-...` и `:686-...`)

В `LlmTaskType` union, рядом с `'summary'` (`:43`):
```ts
  | 'summary'
  | 'report-by-type'
```
В `ALL_LLM_TASK_TYPES`, рядом с `'summary'` (`:687`):
```ts
  'summary',
  'report-by-type',
```

### 2. `llm-router.service.ts` — исправить `taskTypeToAgentType()` (замена `:2097-2110`)

```ts
private taskTypeToAgentType(
  taskType: LlmTaskType,
): 'summary' | 'report-by-type' | 'follow-up' | 'tasks' | 'custom' | 'client_protocol' {
  switch (taskType) {
    case 'summary':
      return 'summary';
    case 'report-by-type':
      return 'report-by-type';
    case 'tasks':
      return 'tasks';
    case 'follow-up':
      return 'follow-up';
    case 'custom-prompt':
      return 'custom';
    case 'client-meeting-split':
      return 'client_protocol';
    default:
      return 'custom';
  }
}
```
`AiAgentType` (`ai-usage-log.service.ts`) уже включает `'client_protocol'` (см. `RecordAiUsageInput`/`AiAgentType` union — проверить на старте фазы, что `'report-by-type'` тоже в этом union, добавить при отсутствии).

### 3. Новый файл: `backend/scripts/patch-llm-routes-analyze-worker-1to1.ts`

Идемпотентный патч (по образцу `patch-llm-routes-report-chain-deepseek.ts`), форсирует легаси-совместимую цепочку:
```ts
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

interface ProviderEntry {
  provider: string;
  model: string;
}

const LEGACY_CHAIN: ProviderEntry[] = [
  { provider: 'deepseek', model: 'deepseek-v4-pro' },
  { provider: 'minimax', model: 'MiniMax-M2.5' },
  { provider: 'openai-via-proxy', model: 'gpt-5-mini' },
];

const TASK_TYPES = ['summary', 'report-by-type', 'follow-up', 'custom-prompt', 'client-meeting-split'];

async function main(): Promise<void> {
  console.log('=== patch-llm-routes-analyze-worker-1to1 START ===');
  let created = 0;
  let updated = 0;
  for (const taskType of TASK_TYPES) {
    const existing = await prisma.llmTaskRoute.findFirst({ where: { taskType, tenantId: null } });
    if (!existing) {
      await prisma.llmTaskRoute.create({
        data: { taskType, tenantId: null, providers: LEGACY_CHAIN as unknown as object, isActive: true },
      });
      created++;
      console.log(`[created] ${taskType} → ${LEGACY_CHAIN[0]?.model}`);
    } else {
      await prisma.llmTaskRoute.update({
        where: { id: existing.id },
        data: { providers: LEGACY_CHAIN as unknown as object, isActive: true },
      });
      updated++;
      console.log(`[updated] ${taskType} → ${LEGACY_CHAIN[0]?.model} (был ${JSON.stringify(existing.providers)})`);
    }
  }
  console.log(`created: ${created}, updated: ${updated}`);
  console.log('=== patch-llm-routes-analyze-worker-1to1 DONE ===');
}

main()
  .catch((err) => {
    console.error('patch-llm-routes-analyze-worker-1to1 FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```
`[ASSUMPTION: точный boilerplate `.finally`/`process.exit` — свериться с реальным концом `patch-llm-routes-report-chain-deepseek.ts` перед копированием, взять 1:1 хвостовую часть оттуда.]` Регистрация в `backend/scripts/apply-prod-deploy.ts` `STEPS` — рядом с существующей записью `patch-llm-routes-report-chain-deepseek.ts` (`:516`), `phase` та же, `skipBootstrap: true` (нужен только на апгрейде существующей БД).

### 4. Kill-switch — `typed-config.service.ts`, рядом с `:543-547`

```ts
analyzeWorkerRouterEnabled: this.resolveSync<boolean>(
  'aiFeatures.analyzeWorkerRouterEnabled',
  'ANALYZE_WORKER_ROUTER_ENABLED',
  true,
),
```
`admin-setting-schema-registry.ts`, рядом с `:147`:
```ts
['aiFeatures.analyzeWorkerRouterEnabled', z.boolean()],
```
Seed дефолтного значения `true` — найти seed-файл, где сидится `aiFeatures.clientProtocolEnabled` (тот же паттерн массово сидируемых `aiFeatures.*`), добавить рядом. `docs/operations/feature-flags.md` — новая строка в реестре флагов: тип «аварийный рубильник», состояние ON, что ждёт — «ничего, снимается владельцем после периода стабилизации».

### 5. `analyze.worker.ts` — новый `callLlm()` (замена `:749-790`)

```ts
private async callLlm(args: {
  meeting: Meeting;
  jobId: string | null;
  agentType: 'summary' | 'report-by-type' | 'follow-up' | 'custom' | 'client_protocol';
  promptName: string;
  input: Parameters<LlmFallbackService['complete']>[0];
}): Promise<LlmCompleteOutput> {
  const routerEnabled = this.cfg.aiFeatures.analyzeWorkerRouterEnabled !== false;
  if (!routerEnabled) {
    return this.callLlmLegacy(args);
  }
  const taskType = AGENT_TYPE_TO_TASK_TYPE[args.agentType];
  const tenantId = (args.meeting as unknown as { tenantId?: string | null }).tenantId ?? null;
  const result = await this.router.call({
    taskType,
    tenantId,
    meetingId: args.meeting.id,
    jobId: args.jobId ?? undefined,
    systemPrompt: args.input.system.text,
    userMessage: typeof args.input.user === 'string' ? args.input.user : args.input.user.text,
    ...(args.input.tools && args.input.tools.length > 0 ? { tools: args.input.tools } : {}),
    sourceRef: { type: 'meeting', id: args.meeting.id },
  });
  const [provider, ...modelParts] = result.modelUsed.split(':');
  return {
    text: result.text,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    cachedTokens: result.cachedTokens,
    model: modelParts.join(':'),
    provider: provider as LlmCompleteOutput['provider'],
    toolCalls: result.toolCalls,
  };
}

private async callLlmLegacy(args: {
  meeting: Meeting;
  jobId: string | null;
  agentType: 'summary' | 'report-by-type' | 'follow-up' | 'custom' | 'client_protocol';
  promptName: string;
  input: Parameters<LlmFallbackService['complete']>[0];
}): Promise<LlmCompleteOutput> {
  const startedAt = Date.now();
  let success = false;
  let errorText: string | null = null;
  let result: LlmCompleteOutput | null = null;
  try {
    result = await this.llm.complete(args.input);
    success = true;
    return result;
  } catch (err) {
    errorText = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    const inputTokens = result?.inputTokens ?? 0;
    const outputTokens = result?.outputTokens ?? 0;
    const cachedTokens = result?.cachedTokens ?? 0;
    const cacheCreationTokens = result?.cacheCreationTokens ?? 0;
    const model = result?.model ?? 'unknown';
    const provider = result?.provider ?? 'anthropic';
    await this.usage.record({
      meetingId: args.meeting.id,
      agentType: args.agentType,
      jobId: args.jobId,
      model,
      provider,
      inputTokens,
      outputTokens,
      cachedTokens,
      cacheCreationTokens,
      costUsd: success ? calcCostUsd(model, inputTokens, outputTokens, cachedTokens) : 0,
      durationMs: Date.now() - startedAt,
      success,
      errorText,
    });
  }
}

const AGENT_TYPE_TO_TASK_TYPE: Record<
  'summary' | 'report-by-type' | 'follow-up' | 'custom' | 'client_protocol',
  LlmTaskType
> = {
  summary: 'summary',
  'report-by-type': 'report-by-type',
  'follow-up': 'follow-up',
  custom: 'custom-prompt',
  client_protocol: 'client-meeting-split',
};
```
Требуется: инжектировать `LlmRouterService` в конструктор `AnalyzeWorker` (рядом с `:70`, `@Inject(LlmRouterService) private readonly router: LlmRouterService`), импортировать `LlmTaskType` из `llm-router.service.ts`. Удалить старый параметр-тип `'tasks'` из сигнатуры `callLlm` (уже отражено выше — новый union без `'tasks'`), обновить ВСЕ 5 мест вызова `callLlm` в файле, чтобы их inline-типы `agentType` совпадали (проверить `callStructured` `:709-716`, где `agentType: 'follow-up'` жёстко зашит пятым параметром — тип должен сузиться синхронно, без `'tasks'`).

### 6. `pickToolInput` — расширить тип параметра (замена сигнатуры `:851-854`)

```ts
function pickToolInput(
  out: { toolCalls?: LlmToolCall[] } | null | undefined,
  toolName: string,
): unknown | null {
```
Тело функции (`:855-860`) не меняется — уже работает через структурную типизацию `LlmCompleteOutput`/`LlmCallResult`.

### 7. Импорт `LlmRouterService`/`LlmTaskType` в `analyze.worker.ts`

```ts
import { LlmRouterService, type LlmTaskType } from '../services/llm-router.service';
```

## Границы фичи

- ✅ Always: сохранять `LlmFallbackService`/legacy-путь нетронутым и рабочим (кill-switch должен реально переключать, не быть декоративным); переиспользовать `LlmRouterService.call()` как единственную точку входа для router-пути; сохранять существующий retry-цикл (`for (attempt<3)`) вокруг `callLlm()` без изменений — он не входит в scope.
- ⚠️ Ask first: если при обновлении `analyze.worker.spec.ts` какой-то существующий тест перестаёт проходить не из-за смены моков, а из-за реального изменения бизнес-поведения — остановиться, это сигнал ошибки миграции, не адаптировать тест «чтобы прошёл».
- 🚫 Never: не удалять `LlmFallbackService`/`callLlmLegacy` в этом ТЗ; не менять модель для 3 задач с уже подготовленными дешёвыми сидами способом «оставить как есть» (В-модели требует форсировать легаси-цепочку); не трогать `PromptResolverService`/шаблоны отчётов по типу встречи; не поднимать data-residency/приватность LLM в документации фичи.

## Фазы

### Фаза 1 — Backend: регистрация `report-by-type`, починка `taskTypeToAgentType()`

**Ценность.** Как воркер главного отчёта, я получаю корректный `taskType` в реестре роутера и правильную метку `agentType` в журнале расходов, чтобы аналитика не путала report-by-type/client_protocol с generic `custom`.

**Файлы:** `backend/src/modules/ai/services/llm-router.service.ts` (union `:42-...`, `ALL_LLM_TASK_TYPES` `:686-...`, `taskTypeToAgentType` `:2097-2110`), `backend/src/modules/ai/services/ai-usage-log.service.ts` (`AiAgentType` union — добавить `'report-by-type'`, если отсутствует).

**Зависимости:** нет (первая фаза).

**Что НЕ входит:** сами вызовы из `analyze.worker.ts` (Фаза 4).

**Acceptance:**
- R1: `(ALL_LLM_TASK_TYPES as readonly string[]).includes('report-by-type')` shall быть `true`.
- R2: `taskTypeToAgentType('report-by-type')` shall вернуть `'report-by-type'`, `taskTypeToAgentType('custom-prompt')` shall вернуть `'custom'`, `taskTypeToAgentType('client-meeting-split')` shall вернуть `'client_protocol'`; существующие 3 кейса (`summary`/`tasks`/`follow-up`) shall остаться без изменений (regression).
- Закрывает: R1, R2.
- Команды: `bunx vitest run backend/src/modules/ai/services/llm-router.service.spec.ts` (новый describe-блок на `taskTypeToAgentType`, метод приватный — тестировать через `(service as any).taskTypeToAgentType(...)` по образцу существующих приватных-метод тестов в этом файле, если такой паттерн уже есть, иначе — через наблюдаемый эффект в `AiUsageLog.agentType` в интеграционном тесте `call()`), `bun run typecheck`.

### Фаза 2 — Backend: сид легаси-совместимой цепочки для всех 5 `taskType`

**Ценность.** Как владелец компании, я получаю гарантию, что переход на новую систему маршрутизации не меняет качество/стоимость главного отчёта в момент включения.

**Файлы:** новый `backend/scripts/patch-llm-routes-analyze-worker-1to1.ts` (см. Контракт-first п.3), правка `backend/scripts/apply-prod-deploy.ts` (`STEPS`, рядом с `:516`).

**Зависимости:** после Фазы 1 (нужен зарегистрированный `report-by-type`, иначе патч пишет в БД taskType, невидимый панели «Роутинг моделей»).

**Что НЕ входит:** сама миграция вызовов (Фаза 4) — эта фаза только готовит данные.

**Acceptance:**
- R3: После прогона скрипта `LlmTaskRoute` для каждого из 5 `taskType` (`summary`, `report-by-type`, `follow-up`, `custom-prompt`, `client-meeting-split`) shall иметь `providers[0] = {provider:'deepseek', model:'deepseek-v4-pro'}`.
- R4: Повторный прогон скрипта shall быть no-op по эффекту (обновляет те же значения теми же значениями — идемпотентность).
- Закрывает: R3, R4.
- Команды: `bun run typecheck`, ручной прогон на dev-БД: `docker compose exec backend bun run scripts/patch-llm-routes-analyze-worker-1to1.ts` дважды подряд, сверить вывод (второй прогон — `updated`, не `created`).

### Фаза 3 — Backend: аварийный рубильник

**Ценность.** Как владелец компании, я получаю мгновенный путь отката на старое поведение, если после включения нового пути на реальном потоке встреч что-то пойдёт не так.

**Файлы:** `backend/src/common/config/typed-config.service.ts` (рядом с `:543-547`), `backend/src/modules/admin/settings/admin-setting-schema-registry.ts` (рядом с `:147`), seed-файл для `aiFeatures.*` (найти через `grep -rn "clientProtocolEnabled" backend/scripts`), `docs/operations/feature-flags.md`.

**Зависимости:** независима от Фаз 1-2 (можно параллельно), но должна быть готова ДО Фазы 4.

**Что НЕ входит:** сама точка чтения флага внутри `analyze.worker.ts` (это уже Фаза 4 — флаг должен существовать раньше, чтобы Фаза 4 могла его читать).

**Acceptance:**
- R5: `grep -n "analyzeWorkerRouterEnabled" backend/src/common/config/typed-config.service.ts backend/src/modules/admin/settings/admin-setting-schema-registry.ts` shall найти обе строки.
- R6: `docs/operations/feature-flags.md` shall содержать новую запись с типом «аварийный рубильник» и текущим состоянием ON.
- Закрывает: R5, R6.
- Команды: `bun run typecheck`, `bun run build`.

### Фаза 4 — Backend: миграция вызовов `AnalyzeWorker`

**Ценность.** Как воркер главного отчёта о встрече, я вызываю ИИ через единую систему маршрутизации (с бюджетной защитой, атрибуцией по компании и видимостью в админке) вместо отдельной устаревшей цепочки, оставаясь способным мгновенно откатиться при инциденте.

**Файлы:** `backend/src/modules/ai/workers/analyze.worker.ts` (конструктор `:67-89` — добавить `LlmRouterService`; `callLlm` `:749-790` — заменить на `callLlm`+`callLlmLegacy`+`AGENT_TYPE_TO_TASK_TYPE`, см. Контракт-first п.5; `pickToolInput` `:851-860` — расширить тип параметра, см. п.6; импорт `LlmRouterService`/`LlmTaskType`, см. п.7; все места вызова `callLlm`/`callStructured` с явным `agentType` — сверить типы после удаления `'tasks'` из union), `backend/src/modules/ai/workers/analyze.worker.spec.ts` (адаптировать мок `:120` с `LlmFallbackService` на дополнительный мок `LlmRouterService.call` — для тестов, ожидающих router-путь по умолчанию (`analyzeWorkerRouterEnabled` не задан → `true`), заменить `args.llmComplete`-based мок на мок `router.call`, возвращающий эквивалентный `LlmCallResult`; добавить 1 новый тест: `analyzeWorkerRouterEnabled=false` → используется `llm.complete` (legacy), не `router.call`).

**Зависимости:** после Фаз 1, 2, 3 (нужен рабочий `taskType`-реестр, сид данных и флаг одновременно).

**Что НЕ входит:** удаление `LlmFallbackService` (vNext, отдельное решение владельца).

**Acceptance:**
- R7: Когда `aiFeatures.analyzeWorkerRouterEnabled !== false` (default), вызов `callLlm()` для любого из 5 `agentType` shall вызывать `this.router.call()` с `taskType`, соответствующим таблице `AGENT_TYPE_TO_TASK_TYPE`, и `tenantId`, равным `meeting.tenantId` (не `null`, если у встречи есть организация).
- R8: Когда `aiFeatures.analyzeWorkerRouterEnabled === false`, вызов `callLlm()` shall вызывать `this.llm.complete()` (legacy), точно как до миграции, включая ручную запись `usage.record()`.
- R9: При router-пути (R7) `this.usage.record()` НЕ shall вызываться напрямую из `AnalyzeWorker` — запись производит исключительно `LlmRouterService.call()` внутри себя (проверяется через мок: `usage.record` spy не вызван, `router.call` spy вызван).
- R10: Все 12 существующих тестов `analyze.worker.spec.ts` (за вычетом адаптации моков) shall проходить без изменения проверяемых бизнес-исходов (тот же `structuredData`, тот же `client_protocol_md`, то же поведение флагов).
- R11: `grep -n "agentType: 'tasks'\|'tasks' \|" backend/src/modules/ai/workers/analyze.worker.ts` (после правки) shall не находить литерал `'tasks'` в типе `agentType` функции `callLlm`.
- Закрывает: R7, R8, R9, R10, R11.
- Команды: `bunx vitest run backend/src/modules/ai/workers/analyze.worker.spec.ts`, `bun run typecheck`, `bun run lint`, `bun run build`.

## Pre-mortem / Риски

- **Риск (самый серьёзный в этом пакете фич):** ошибка в адаптере `LlmCallParams`↔legacy может тихо сломать структурированный вывод (tool_calls) для report-by-type/follow-up — отчёты о встречах начнут приходить пустыми или с ошибкой парсинга. **Митигация:** R10 (полный набор существующих тестов должен пройти без изменения бизнес-исходов) + ручная проверка на dev через `qa-tester`-скилл (реальная встреча → реальный отчёт до и после переключения флага) ПЕРЕД мержем в `dev`.
- **Риск:** `result.modelUsed.split(':')` (парсинг `provider:model` в п.5 Контракта) сломается, если имя провайдера или модели само содержит `:` (маловероятно для текущих провайдеров, но проверить на `openai-via-proxy` — там нет двоеточия в имени, ок). **Митигация:** `[provider, ...modelParts] = split(':')` — `modelParts.join(':')` восстанавливает всё после первого `:`, устойчиво даже если модель содержит `:`.
- **Ревью-аспект для `strict-production-review-gate`:** убедиться, что `tenantId` резолвится ДО вызова `router.call()` и что `null` (система без организации) — валидный, не крашащий случай (см. `LlmCallParams.tenantId: string | null` — уже допускает `null` по контракту).
- **Ревью-аспект:** проверить, что кill-switch реально читается КАЖДЫЙ раз (не закэширован при старте процесса) — `this.cfg.aiFeatures.analyzeWorkerRouterEnabled` читает `resolveSync`, которое per правилам `AdminSetting` инвалидируется на `admin:setting:invalidate` — подтвердить, что `TypedConfigService` действительно живой (не снапшот на старте), сверяясь с тем, как уже работает `clientProtocolEnabled` (тот же паттерн, уже проверенный в проде).

## Сквозные аспекты

- **RBAC/tenant:** router-путь ВПЕРВЫЕ передаёт реальный `tenantId` — прямое улучшение (см. REALITY-CHECK); никаких новых прав не требуется, `AnalyzeWorker` — системный воркер.
- **Observability:** `LlmRouterService.call()` уже эмитит все нужные метрики (cost, latency, fallback rate) — ничего дополнительно не нужно; kill-switch OFF-события стоит видеть в логах (существующий паттерн `clientProtocolEnabled` не логирует явно переключение — этого и не требуем, `[N/A: соответствует существующему паттерну]`).
- **Errors/idempotency:** Фаза 2 скрипт — идемпотентен (R4). Runtime-код не идемпотентен по своей природе (обычные LLM-вызовы), не применимо.
- **Миграция данных:** нет (Фаза 2 — это конфигурация роутинга, не миграция пользовательских данных).
- **Rollout/флаг:** Ship-On + временный kill-switch (В-flag) — единственное узаконенное исключение, снимается отдельным решением владельца после стабилизации.
- **Тесты:** см. Acceptance Фазы 1 и 4.

## Совместимость с prompt caching

`dispatch()` внутри `LlmRouterService` всегда ставит `cacheControl:'ephemeral'` (`llm-router.service.ts:1992`) — идентично сегодняшнему дефолту `LlmFallbackService` (`llm-fallback.service.ts:27-28`). Изменений не требуется — SYSTEM-промпт (шаблон отчёта) остаётся стабильным per вызов, USER (транскрипт/диалог) — переменный, в конце — это уже так устроено в существующих `buildSummaryPrompt`/`buildClientProtocolPrompt`/`getPromptForType`, миграция их не трогает.

## DoD

- `bun run typecheck && bun run lint && bun run build` зелёные в `backend/`.
- Все новые/изменённые `.spec.ts` проходят (`bunx vitest run`), включая полный `analyze.worker.spec.ts` без регрессий.
- Ручная проверка через `qa-tester`: реальная встреча → отчёт при `analyzeWorkerRouterEnabled=true` (default) визуально не хуже сегодняшнего.
- `second-brain/04_не-сделано/README.md` — строка 285 убрана из «Открыто», перенесена в «Закрытые (архив)» с датой и коммитом; **новая строка добавлена** — «вывод из эксплуатации `LlmFallbackService` + снятие kill-switch `analyzeWorkerRouterEnabled` — ждёт решения владельца о периоде стабилизации» (это осознанная отсрочка, не забытый хвост).
- `docs/operations/feature-flags.md` обновлён (новая строка флага).
- `second-brain/01_projects/ai-jobs.md` (или профильный файл) — упомянуть, что главный отчёт теперь маршрутизируется через `LlmRouterService`.
- Рефлексия в `second-brain/05_история/`.

## Итог

**Реализовано целиком, все 4 фазы.**

- Фаза 1 (`ed1993b3`) — `'report-by-type'` добавлен в `LlmTaskType`/`ALL_LLM_TASK_TYPES` (раньше существовал только осиротевшим литералом); `taskTypeToAgentType()` теперь корректно мапит все 5 нужных `taskType` (было: `report-by-type`/`custom-prompt`/`client-meeting-split` тихо схлопывались в generic `'custom'`).
- Фаза 2 (`57a42cfe`) — **критическая находка при приёмке, исправлена немедленно**: первая версия патч-скрипта писала легаси-совместимую цепочку в JSON-поле `LlmTaskRoute.providers`, но `refreshCache()` полностью игнорирует это поле, если для `taskType` уже есть tier-строки (Фаза A.4) — а они УЖЕ существовали для 4 из 5 задействованных `taskType` (из `seed-llm-task-routes-default.ts`, дешёвые модели прошлой сессии). Первая версия патча реально переключила бы маршрутизацию только для `report-by-type` — для остальных 4 задач владелец получил бы тихий регресс модели вопреки явному решению «1:1 везде». Скрипт переписан на запись tier-строк (тот же паттерн, что `AdminAiModelsService.putChain()`), `editedByAdmin=true` защищает от отката дефолтным сидом. Эффект подтверждён и через прямое чтение БД, и через реальный вызов `refreshCache()`.
- Фаза 3 (`692b4955`) — аварийный рубильник `aiFeatures.analyzeWorkerRouterEnabled` (default ON), registry+seed+feature-flags.md, по образцу `clientProtocolEnabled`.
- Фаза 4 (`debb1b59`) — `AnalyzeWorker.callLlm()` маршрутизирует через `LlmRouterService.call()` по умолчанию; `callLlmLegacy()` (старое тело, байт-в-байт) — путь отката при рубильнике OFF. Мёртвый литерал `'tasks'` убран из типа `agentType`. Тесты: `buildWorker()`-хелпер адаптирован так, что `router.call` делегирует в тот же мок `llm.complete` — все 11 исходных тестов проверяют прежнее бизнес-поведение БЕЗ изменения тел тестов (доказательство поведение-сохраняющей миграции); +3 новых теста на taskType-маппинг/tenantId-атрибуцию/рубильник OFF.

**Верификация:** `bun run typecheck`/`build` зелёные на каждой фазе; `bunx vitest run src/modules/ai/` (весь модуль, 59 файлов/587 тестов) без регрессий после каждой фазы; `analyze.worker.spec.ts` 11→14 тестов (не потеряно ни одного, добавлено 3); интеграционный спек `analyze-worker-with-resolver.integration.spec.ts` адаптирован под новую сигнатуру конструктора — 2 предсуществующих провала (не связанных с миграцией, причина «нет transcript.turns в БД») подтверждены идентичными на коде ДО этой фичи через `git stash`.

**Осталось (осознанно, не хвост):**
- Ручная QA-проверка через скилл `qa-tester` (реальная встреча → реальный отчёт до/после переключения флага на проде) — НЕ выполнялась в этой сессии: код ещё не запушен/не задеплоен, прод-QA имеет смысл после мержа, не раньше. Зафиксировано как явный пункт для проверки перед/сразу после выката.
- Вывод из эксплуатации `LlmFallbackService` + снятие рубильника `analyzeWorkerRouterEnabled` — намеренно НЕ делается в этом ТЗ (В-flag, архитектура Шаг 8): отдельное решение владельца о периоде стабилизации. Зафиксировано новой строкой в `second-brain/04_не-сделано/README.md`.
- Экономия на уже подготовленных дешёвых моделях для `summary`/`follow-up`/`custom-prompt` — намеренно НЕ включена (В-модели): отдельное будущее решение через панель «Роутинг моделей».

**Prod-деплой:** новый шаг `patch-llm-routes-analyze-worker-1to1.ts` в `apply-prod-deploy.ts` (`everyDeploy: true`, `skipBootstrap: true`) — применит 1:1-цепочку автоматически при следующем деплое. Новый AdminSetting `aiFeatures.analyzeWorkerRouterEnabled` — засеян локально на dev, на проде появится через `apply-prod-deploy.ts` (сид уже зарегистрирован в общем цикле `seed-admin-settings.ts`). Миграций схемы нет.
