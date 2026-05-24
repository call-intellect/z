---
type: tz
status: draft
feature: Supervised Prompt Optimization (SPO) — автооптимизация промптов AI-отчётов и knowledge-core
date: 2026-05-24
phase: план реализации (фазы внутри документа)
parent: —
related:
  - backend/src/modules/admin/prompt-templates/prompt-experiments.service.ts
  - backend/src/modules/admin/prompt-templates/ai-result-feedback.service.ts
  - backend/src/modules/ai/services/llm-router.service.ts
  - backend/src/modules/ai/services/prompt-resolver.service.ts
  - backend/src/modules/ai/services/prompts/index.ts
  - second-brain/01_projects/ai-analysis-by-type.md
external:
  - https://viven.ai/blog/supervised-prompt-optimization
revision: 2026-05-24 — НЕ начат, нужны 5 человеко-недель + 15ч разметки + бюджет LLM
---

# Supervised Prompt Optimization (SPO) — автооптимизация промптов

## TL;DR

Превращаем ручную правку промптов AI-отчётов в **измеримый итеративный цикл** по методу Supervised Prompt Optimization (SPO, статья viven.ai).

Для каждого `taskType + meetingType` (например, `type-sales` или `idea-extract`) ведём **эталонный набор кейсов** (eval set) с эталонным выводом и reasoning. На этом наборе работает **LLM-judge с rubric 0–5** (не бинарный 👍/👎), который генерирует **structured feedback**. Сильная модель (DeepSeek-R1 / GPT-5 через `proxy.agent-lia.ru`) по этому фидбеку **предлагает кандидатов** новой версии промпта. Кандидаты прогоняются на мини-батче, выжившие попадают в **Pareto-пул**, лучший повышается до `champion` и попадает в существующий механизм `PromptExperiment` для прод-валидации на живом трафике.

Главное: **никакого дублирования**. Используем уже готовые сущности (`PromptTemplate`, `PromptTemplateVersion`, `PromptExperiment`, `AiResultFeedback`) и добавляем 4 новых модели + 2 воркера + админ-страницу + LLM-judge.

**Цель:** прогнать промпт через 10–15 итераций SPO → достичь rubric-score 4.0+/5 → выкатить через A/B → отслеживать регрессии по `AiResultFeedback`.

**Срок:** 5 человеко-недель (3 фазы).

## Зависимости

- **PromptTemplate / PromptTemplateVersion** — готовы ([prompt-templates.service.ts](backend/src/modules/admin/prompt-templates/prompt-templates.service.ts)).
- **PromptExperiment** — готов, sticky-allocation работает ([prompt-experiments.service.ts](backend/src/modules/admin/prompt-templates/prompt-experiments.service.ts)).
- **AiResultFeedback** — готов, 👍/👎 от пользователей ([ai-result-feedback.service.ts](backend/src/modules/admin/prompt-templates/ai-result-feedback.service.ts)).
- **llm-router + protocol-adapter** — готовы. SPO регистрирует **2 новых `taskType`**: `prompt_judge` и `prompt_propose` ([llm-router.service.ts](backend/src/modules/ai/services/llm-router.service.ts)).
- **BullMQ-воркеры** — отдельный процесс `workers/main.ts`. SPO добавляет очередь `spo` с тремя job-типами.
- **Entitlements** — новая фича `feature.spo` (только для Pro/Business тарифов).

## Контекст из статьи (для будущих программистов)

Источник: https://viven.ai/blog/supervised-prompt-optimization

Метод SPO формализует цикл «написал → потестил → нашёл failure mode → переписал»:

1. **Init** — стартовый промпт оценивается на validation set.
2. **Sample** — выбирается кандидат из пула (Pareto-отбор по разным аспектам качества).
3. **Evaluate** — кандидат прогоняется на мини-батче из train set, LLM-judge выдаёт оценку + текстовый фидбек.
4. **Refine** — если фидбек указывает на улучшение, сильная модель генерирует N новых кандидатов.
5. **Validate** — новые кандидаты прогоняются на том же мини-батче; если лучше — на полном validation set.
6. **Pool update** — победители попадают в пул.
7. **Repeat** до исчерпания compute-бюджета.

**Ключевые находки статьи:**
- Bin (binary) 0/1 фидбек **не работает** — слишком грубо. Нужна **rubric 0–5 с описанием каждого уровня**.
- В eval-кейсе нужен не только эталонный output, но и **эталонный reasoning** (объяснение, почему правильный ответ такой).
- Pareto-отбор предпочитает «специалистов» (хорош в одних кейсах, средний в других) перед «универсалами» — это лечится отдельной метрикой «среднее по всем кейсам».
- Их результат: 75 размеченных кейсов, 15 итераций, минибатч 10, 5 кандидатов на итерацию → score 4.1/5.

## Что строим (impact list)

| Слой | Что добавляем |
|---|---|
| **БД** | 4 модели: `PromptEvalCase`, `PromptEvalRun`, `PromptEvalResult`, `PromptOptimizationRun` |
| **Backend** | модуль `prompt-spo/` под `modules/admin/`, сервис LLM-judge, сервис генератора кандидатов, очередь `spo` с 3 job-типами |
| **LLM** | 2 новых `taskType` в [llm-router](backend/src/modules/ai/services/llm-router.service.ts): `prompt_judge` (judge), `prompt_propose` (генератор кандидатов) |
| **Воркеры** | `spo-eval-batch.worker`, `spo-optimize-iteration.worker`, `spo-judge.worker` (изолирован, чтобы оценка не блокировала генерацию) |
| **Cron** | nightly прогон champion на свежих eval-кейсах для детекции regression |
| **Admin UI** | `(admin)/prompts/[id]/spo/` — запуск оптимизации, просмотр итераций, diff кандидатов, promote → champion → A/B |
| **Метрики** | `z_spo_iteration_total`, `z_spo_judge_score`, `z_spo_candidate_kept_total`, `z_spo_optimization_duration_seconds` |
| **Entitlements** | `feature.spo` для Pro/Business; квота `spo_runs_per_month` |
| **ENV** | модели для `prompt_judge` и `prompt_propose` (через `TypedConfigService`) |

## Модели Prisma

> Все модели с `tenantId` (`null` = system-уровень для super_admin), `createdAt`, `updatedAt`. Удаление — каскадом от `PromptTemplate`.

### PromptEvalCase — эталонный кейс

Один кейс = один входной контекст + эталонный output + rubric-критерии.

```prisma
model PromptEvalCase {
  id              String   @id @default(cuid())
  tenantId        String?                              // null = system-eval (общий для всех Org)
  templateId      String                               // к какому PromptTemplate относится
  template        PromptTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)

  // Входные данные (то, что прилетает в промпт в проде)
  inputPayload    Json                                 // структура зависит от taskType (transcript, meta, …)

  // Эталон
  goldOutput      Json                                 // эталонный output (JSON-структура отчёта или extracted entities)
  goldReasoning   String   @db.Text                    // почему именно такой output (критично для качества judge)

  // Rubric выносится в отдельную versionable-модель PromptRubric.
  // Конкретная rubric-версия фиксируется на PromptEvalRun (а не на кейсе),
  // потому что один и тот же кейс может прогоняться с разными rubric'ами.

  // Метаданные
  label           String?                              // короткая метка для UI ("сложный кейс с молчанием")
  tags            String[]                             // ["regression", "long-meeting", "low-engagement"]
  source          String                               // 'manual' | 'imported-from-meeting' | 'synthetic'
  sourceMeetingId String?                              // если импортирован из реальной встречи

  createdById     String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  archivedAt      DateTime?

  @@index([templateId, archivedAt])
  @@index([tenantId])
}
```

**Rubric — отдельная versionable-сущность** (см. модель `PromptRubric` ниже). Хранит массив критериев с описанием уровней 0–5. Версионируется независимо от промпта: rubric меняется раз в квартал, промпт — десятки раз за один SPO-run. Каждый `PromptEvalRun` фиксирует `rubricId`, чтобы прогоны на разных rubric'ах нельзя было невзначай сравнить как сопоставимые. Пример rubric:

```json
{
  "criteria": [
    {
      "key": "completeness",
      "title": "Полнота",
      "levels": {
        "0": "Отчёт пустой или нерелевантный",
        "1": "Покрыто <30% важных моментов",
        "3": "Покрыто 60-80%, упущены 1-2 важных",
        "5": "Все важные моменты покрыты"
      }
    },
    {
      "key": "structure",
      "title": "Структура",
      "levels": { ... }
    }
  ]
}
```

### PromptRubric — версионированные критерии оценки

```prisma
model PromptRubric {
  id              String   @id @default(cuid())
  templateId      String
  template        PromptTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)

  versionNumber   Int                                  // монотонный, начинается с 1 per template
  criteria        Json                                 // структура из примера выше
  notes           String?  @db.Text                    // changelog: «v3 — добавили criterion 'actionable'»

  createdById     String
  createdAt       DateTime @default(now())

  evalRuns        PromptEvalRun[]

  @@unique([templateId, versionNumber])
  @@index([templateId])
}
```

**Активная rubric для template** = `MAX(versionNumber)`. Старые версии **никогда не удаляются** — иначе ломаются `PromptEvalRun.rubricId` исторических прогонов. В UI сравнение runs на разных версиях rubric маркируется явной звёздочкой «сопоставление условное».

### PromptEvalRun — один прогон промпта по набору кейсов

```prisma
model PromptEvalRun {
  id              String   @id @default(cuid())
  tenantId        String?
  templateId      String
  versionId       String                               // какая версия промпта тестировалась
  version         PromptTemplateVersion @relation(fields: [versionId], references: [id])

  // Зафиксированная rubric-версия (обязательно — без неё score несопоставимы между runs).
  rubricId        String
  rubric          PromptRubric @relation(fields: [rubricId], references: [id])

  // К какой optimization-run принадлежит (null = ручной прогон через UI)
  optimizationRunId String?
  optimizationRun PromptOptimizationRun? @relation(fields: [optimizationRunId], references: [id], onDelete: Cascade)

  // Скоуп прогона: минибатч (10 кейсов) или полный validation set
  scope           String                               // 'minibatch' | 'full'
  caseIds         String[]                             // какие именно PromptEvalCase в этом прогоне

  // Агрегаты (после завершения всех PromptEvalResult)
  status          String   @default("pending")        // pending | running | succeeded | failed
  avgScore        Float?                               // среднее по всем критериям и кейсам (0-5)
  perCriterion    Json?                                // {completeness: 4.2, structure: 3.8, ...}
  failedCases     Int      @default(0)                // кейсы со score < 3

  // Стоимость и время
  llmCostUsd      Float    @default(0)
  durationMs      Int?

  // Использованные модели
  judgeModel      String?                              // 'deepseek-r1' | 'gpt-5-medium'
  candidateModel  String?

  startedAt       DateTime @default(now())
  finishedAt      DateTime?
  error           String?  @db.Text

  results         PromptEvalResult[]

  @@index([templateId, status])
  @@index([versionId])
  @@index([rubricId])
  @@index([optimizationRunId])
}
```

### PromptEvalResult — результат на одном кейсе

```prisma
model PromptEvalResult {
  id              String   @id @default(cuid())
  runId           String
  run             PromptEvalRun @relation(fields: [runId], references: [id], onDelete: Cascade)
  caseId          String
  case            PromptEvalCase @relation(fields: [caseId], references: [id], onDelete: Cascade)

  // Вывод модели на этом кейсе
  output          Json                                 // что вернул промпт
  outputRaw       String?  @db.Text                    // raw-текст до JSON-парсинга (для дебага)

  // Оценка judge'ом
  perCriterion    Json                                 // {completeness: 4, structure: 5, ...}
  avgScore        Float                                // среднее по criteria
  judgeFeedback   String   @db.Text                    // структурированный текст: «что хорошо», «что плохо», «что улучшить»
  judgeRaw        String?  @db.Text                    // raw-ответ judge для аудита

  // Costs
  generationCostUsd Float  @default(0)
  judgeCostUsd      Float  @default(0)
  durationMs        Int

  createdAt       DateTime @default(now())

  @@index([runId])
  @@index([caseId])
}
```

### PromptOptimizationRun — один цикл SPO (10–15 итераций)

```prisma
model PromptOptimizationRun {
  id              String   @id @default(cuid())
  tenantId        String?
  templateId      String
  template        PromptTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)

  // Стартовая версия (champion на момент запуска)
  seedVersionId   String

  // Параметры
  maxIterations   Int      @default(15)
  candidatesPerIteration Int @default(5)
  minibatchSize   Int      @default(10)
  judgeModel      String                               // ENV-default, можно override
  proposerModel   String                               // ENV-default, можно override

  // Бюджеты (hard-stop при превышении)
  maxCostUsd      Float    @default(50)
  maxDurationMin  Int      @default(180)

  // Прогресс
  status          String   @default("pending")        // pending | running | succeeded | failed | stopped
  currentIteration Int     @default(0)
  totalCostUsd    Float    @default(0)

  // Pareto-пул (массив versionId, перевычисляется на каждой итерации)
  paretoPool      String[]

  // Best — лучшая по avgScore версия из всех испытанных
  bestVersionId   String?
  bestAvgScore    Float?

  // Аудит
  createdById     String
  startedAt       DateTime?
  finishedAt      DateTime?
  error           String?  @db.Text
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  runs            PromptEvalRun[]

  @@index([templateId, status])
}
```

### Дополнения к существующим моделям

```prisma
// PromptTemplate — добавляем relations (rubric — отдельная модель, см. выше):
model PromptTemplate {
  // ... существующие поля ...
  rubrics         PromptRubric[]                       // versionable, активная = MAX(versionNumber)
  evalCases       PromptEvalCase[]
  optimizationRuns PromptOptimizationRun[]
}

// PromptTemplateVersion — добавляем поля:
model PromptTemplateVersion {
  // ... существующие поля ...

  // Если версия создана автоматически SPO — ссылка на родителя и итерацию
  spoOptimizationRunId String?
  spoIteration         Int?
  spoParentVersionId   String?                         // из какого кандидата произошла (для tree-view)

  evalRuns        PromptEvalRun[]
}
```

> Применяем через `bun run prisma:push`. Никаких migrate (см. skill `prisma-db-push-rules`).

## LLM-judge — детали

### Системный промпт judge'а (zero-shot, hardcoded в код)

Хранится в `backend/src/modules/admin/prompt-spo/prompts/judge.prompt.ts`. Не admin-editable (это инфраструктурный промпт; иначе judge можно сломать админ-правкой и сломать всю оптимизацию).

Структура judge-промпта:

```
Ты — строгий и справедливый эксперт по AI-отчётам встреч.

Тебе дан:
1. ВХОД промпта (transcript, meta встречи)
2. ЭТАЛОННЫЙ output и эталонный reasoning (что должно было получиться и почему)
3. ФАКТИЧЕСКИЙ output модели

Оцени фактический output по rubric (см. ниже), каждый критерий — целое число 0-5.
Для каждого критерия дай 1-2 предложения: ЧТО конкретно не так и КАК улучшить промпт.

ВАЖНО:
- Не оценивай стиль, если он не указан в rubric.
- Не штрафуй за лишние правильные детали (только за пропуски и ошибки).
- Если output невалиден (не парсится в JSON / нарушает контракт) — все критерии 0.

Формат ответа — строгий JSON:
{
  "perCriterion": { "completeness": 4, "structure": 5, ... },
  "feedback": {
    "completeness": "Упущено решение про дедлайн на 23-е. Добавь явный пункт ‘зафиксированные сроки’.",
    "structure": "OK",
    ...
  },
  "overallNote": "Главная проблема — игнорирует моменты молчания. Промпт должен явно требовать отметку пауз >5 сек."
}

RUBRIC:
{{rubric_json}}

ВХОД:
{{input_payload}}

ЭТАЛОН:
output: {{gold_output}}
reasoning: {{gold_reasoning}}

ФАКТИЧЕСКИЙ ОТВЕТ:
{{actual_output}}
```

### Модель judge'а

- Default: **DeepSeek-R1** через `proxy.agent-lia.ru` (хорош в reasoning, дешевле GPT-5).
- Override: GPT-5/4o через тот же proxy (для критичных шаблонов).
- **НЕ Anthropic** (нет ключа, см. memory: `project_z_infra_and_ai.md`).
- НЕ `qwen3.5:9b` через Ollama — слабоват для надёжного judging.

### Anti-pattern protection

- Judge может «дрейфовать» — раз в неделю прогоняем **judge calibration**: один и тот же кейс с известным эталонным score, проверяем что judge выдаёт ±0.3 от ожидаемого. При расхождении — алерт в админку.
- Все judge-ответы хранятся в `judgeRaw` для пост-аудита.

## Генератор кандидатов

### Промпт generator'а

Хранится в `backend/src/modules/admin/prompt-spo/prompts/proposer.prompt.ts`.

Получает:
1. Текущий champion (текст промпта).
2. Аггрегированный фидбек judge'а по последнему прогону (по всем критериям, по всем failed-кейсам).
3. История последних 3 кандидатов и их scores (чтобы не повторяться).

Выдаёт N кандидатов (default 5) — каждый с пометкой «какой проблеме адресован».

### Модель proposer'а

- Default: **DeepSeek-R1** (длинный context, хороший reasoning).
- Альтернатива: GPT-5 medium reasoning через proxy (как в статье viven).

## Источник gold для эталонов

**Гибридный процесс с обязательным human reasoning.**

1. **Источник transcript'ов:** для каждого `taskType + meetingType` берём 30 встреч с положительным `AiResultFeedback` (👍). Их `transcript + meta` идут в `inputPayload`.
2. **Synthetic draft эталона:** через `llm-router` (модель уровня GPT-5/4o через `proxy.agent-lia.ru`) генерируем «идеальный» вариант output'а.
3. **Human edit:** тимлид/продакт редактирует draft до уровня «вот так должно было выглядеть». Это **не** копия того, что выдала продакшен-модель, — это эталон, к которому стремимся.
4. **Human reasoning (обязательно вручную):** тимлид пишет 3–5 предложений «почему этот эталон именно такой» в `goldReasoning`. Без reasoning judge оценивает поверхностно (см. статью viven).

**Почему не чистые реальные отчёты с 👍:** они задают потолок оптимизации = текущий champion. SPO упрётся в потолок и нарисует ложный прогресс.

**Почему не чистая синтетика без human edit:** judge и proposer работают на одном семействе моделей через proxy. Если gold тоже сгенерирован моделью — получаем эхо-камеру, где модель ставит 5/5 за собственный стиль.

**Бюджет разметки:** ~30 минут на кейс × 30 кейсов = ~15 часов на тип. Для 9 типов встреч — 135 часов разовой инвестиции. Дальше eval-set пополняется по 1–2 кейса в месяц из жалоб пользователей.

**Bootstrap-порядок:** начинаем с `type-sales` (самый высокий чек, самая жёсткая обратная связь). Полный цикл SPO → promotion → научились управлять процессом → размечаем оставшиеся 8 типов уже зная, где можно срезать углы.

## API (admin-only)

Базовый префикс `/api/v1/admin/prompt-spo/`. RBAC: `super_admin` или `owner/admin` своей Org. Все эндпоинты под `TenantGuard` для Org-scoped.

### Eval cases

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/templates/:templateId/eval-cases` | Список кейсов с фильтром по tags, source, archived |
| `POST` | `/templates/:templateId/eval-cases` | Создать кейс вручную (manual) |
| `POST` | `/templates/:templateId/eval-cases/import-from-meeting` | Импорт из реальной встречи (берём transcript+meta, gold заполняем вручную) |
| `PATCH` | `/eval-cases/:id` | Редактировать gold, reasoning, tags |
| `DELETE` | `/eval-cases/:id` | Soft-delete (archivedAt) |

### Rubric (versionable)

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/templates/:templateId/rubrics` | Список всех версий с changelog (`notes`) |
| `GET` | `/templates/:templateId/rubrics/active` | Текущая активная (MAX `versionNumber`) |
| `POST` | `/templates/:templateId/rubrics` | Создать новую версию (предыдущая сохраняется; новые runs автоматически идут на новую) |

Удаление недопустимо — только создание новой версии. Иначе ломаются `PromptEvalRun.rubricId` исторических прогонов.

### Eval runs (одноразовый прогон)

| Метод | Путь | Назначение |
|---|---|---|
| `POST` | `/templates/:templateId/eval-runs` | Прогнать конкретную версию по N кейсам. Body: `{ versionId, scope: 'minibatch'\|'full', caseIds? }` |
| `GET` | `/eval-runs/:id` | Статус + результаты (с пагинацией результатов) |

### Optimization runs (SPO loop)

| Метод | Путь | Назначение |
|---|---|---|
| `POST` | `/templates/:templateId/optimization-runs` | Запустить SPO. Body: `{ seedVersionId, maxIterations, candidatesPerIteration, minibatchSize, judgeModel?, proposerModel?, maxCostUsd?, maxDurationMin? }` |
| `GET` | `/optimization-runs/:id` | Прогресс: текущая итерация, pool, best version |
| `POST` | `/optimization-runs/:id/stop` | Ручной стоп (graceful: дотягивает текущую итерацию) |
| `POST` | `/optimization-runs/:id/promote` | Создать новую `PromptTemplateVersion` из `bestVersionId` и запустить `PromptExperiment` против текущего champion |

### Все DTO через `nestjs-zod` и Swagger (см. [nestjs-rules](.claude/skills/nestjs-rules)).

## Воркеры (BullMQ, очередь `spo`)

> Все воркеры регистрируются в `backend/src/workers/main.ts`. Concurrency настраивается через ENV `SPO_WORKER_CONCURRENCY` (default 2).

### 1. `spo-eval-batch.worker`

Job payload: `{ runId, caseIds[] }`.

Алгоритм:
1. Берёт `PromptEvalRun.versionId`, материализует промпт через `prompt-resolver`.
2. Для каждого `caseId`:
   - Запускает промпт через `llm-router` (`taskType = template.taskType`, модель = production-model для этого taskType).
   - Создаёт job `spo-judge` с output.
3. Когда все judges завершились — агрегирует в `PromptEvalRun.avgScore` + `perCriterion`.
4. Если `optimizationRunId !== null` — триггерит `spo-optimize-iteration` для следующей итерации.

### 2. `spo-judge.worker`

Job payload: `{ runId, caseId, output, outputRaw }`.

Алгоритм:
1. Загружает rubric и эталон из `PromptEvalCase`.
2. Вызывает judge через `llm-router` (`taskType = 'prompt_judge'`).
3. Парсит JSON-ответ, валидирует структуру.
4. Создаёт `PromptEvalResult`.

### 3. `spo-optimize-iteration.worker`

Job payload: `{ optimizationRunId, iterationNumber }`.

Алгоритм:
1. Загружает текущий `PromptOptimizationRun` + последние результаты.
2. **Pareto-отбор по 3 осям:** `avgScore` × `worstCaseScore` × `worstCriterionScore`. Кандидат остаётся в пуле, если не доминируется ни одним другим **сразу по всем трём** осям. Для refine выбирает 1 кандидата round-robin'ом, чтобы не зацикливаться на одной ветке.
   - **Почему 3 оси:** одна (`avgScore`) — даёт «специалистов» с катастрофическими провалами на отдельных кейсах; 5+ (per-criterion) — Pareto-frontier вырождается, почти все кандидаты non-dominated, прогресса нет. `worstCaseScore` лечит первое, `worstCriterionScore` — перекос между критериями.
3. Вызывает proposer через `llm-router` (`taskType = 'prompt_propose'`) → получает N новых кандидатов.
4. Для каждого кандидата создаёт новую `PromptTemplateVersion` (status = `experimental`, не активна для прода) + `PromptEvalRun(scope='minibatch')`.
5. Когда минибатчи завершились (через `await Promise.all` watch на runId) — для выживших (score выше champion) создаёт `PromptEvalRun(scope='full')`.
6. Обновляет `bestVersionId`, `paretoPool`, `currentIteration++`.
7. Если `currentIteration < maxIterations` и бюджеты не исчерпаны — рекурсивно ставит следующий job через delay.
8. Если все условия выхода соблюдены — `status='succeeded'`, метрики, лог.

**Hard-stop условия:**
- `totalCostUsd > maxCostUsd`
- `now - startedAt > maxDurationMin`
- `currentIteration >= maxIterations`
- `bestAvgScore >= 4.5` (early-stop, настраивается через ENV `SPO_EARLY_STOP_SCORE`)
- Подряд 3 итерации без улучшения `bestAvgScore` (`avgScore_plateau`)
- Подряд 3 итерации без улучшения `bestAvgScore` **И** без сокращения Pareto-пула (`pareto_plateau` — защита от бесконечного крутения в эквивалентных кандидатах)

### Cron — nightly regression check

`@Cron('0 3 * * *')` в `backend/src/modules/admin/prompt-spo/spo.cron.ts`:

Для каждого `PromptTemplate` с непустым `evalCases`:
1. Запустить `PromptEvalRun(scope='full')` на текущей champion-версии.
2. Сравнить avgScore с предыдущим nightly-прогоном.
3. Если падение > 0.3 — алерт в админку (новая сущность `PromptSpoAlert` или через существующую систему уведомлений).

Защита: cron работает только если включён ENV `SPO_NIGHTLY_REGRESSION_ENABLED=true` (default false — не палить лишние деньги в раннем dev).

## llm-router — расширения

Добавить 2 новых `taskType` в [llm-router.service.ts](backend/src/modules/ai/services/llm-router.service.ts):

```ts
'prompt_judge': {
  dataClass: 'internal',          // judge видит prod-данные, требуем internal-proxy
  preferredProvider: 'deepseek',
  fallbackProviders: ['openai-proxy'],
  temperature: 0.1,               // максимальная детерминированность
  maxTokens: 4000,
},
'prompt_propose': {
  dataClass: 'internal',
  preferredProvider: 'deepseek',
  fallbackProviders: ['openai-proxy'],
  temperature: 0.7,               // больше разнообразия
  maxTokens: 8000,
},
```

ENV:
- `SPO_JUDGE_MODEL` (default `deepseek-r1`)
- `SPO_JUDGE_FALLBACK_MODEL` (default `gpt-4o`)
- `SPO_PROPOSER_MODEL` (default `deepseek-r1`)
- `SPO_PROPOSER_FALLBACK_MODEL` (default `gpt-4o`)
- `SPO_WORKER_CONCURRENCY` (default `2`) — параллельных job'ов внутри одного worker-процесса
- `SPO_GLOBAL_CONCURRENT_LIMIT` (default `5`) — одновременных `PromptOptimizationRun` на инстанс
- `SPO_EARLY_STOP_SCORE` (default `4.5`) — порог раннего успеха
- `SPO_NIGHTLY_REGRESSION_ENABLED` (default `false`) — включить ли nightly cron
- `SPO_DEFAULT_MAX_COST_USD` (default `50`) — cost-cap по умолчанию

Все ENV — через `TypedConfigService` ([env.schema.ts](backend/src/common/config/env.schema.ts)).

## Admin UI

Маршрут `(admin)/prompts/[templateId]/spo/`. Слой ApiDto → DomainModel → UiModel (см. [frontend-rules](.claude/skills/frontend-rules)).

### Tabs:

1. **Эталонные кейсы** (`PromptEvalCase` CRUD) — таблица, фильтры, импорт из встречи, редактор gold с side-by-side preview.
2. **Критерии оценки (rubric)** — редактор JSON с валидацией структуры + превью «как judge будет оценивать».
3. **Прогоны оценки** — список `PromptEvalRun` с фильтром по version. Detail-view: per-case breakdown + judge feedback по каждому критерию.
4. **Оптимизация (SPO)** — список `PromptOptimizationRun`. Detail-view:
   - Прогресс bar (итерация N/M)
   - График avgScore по итерациям
   - Tree-view кандидатов (родитель → потомки)
   - Diff promptов (champion vs best candidate, с highlight)
   - Кнопка "Promote → создать A/B эксперимент"
5. **Регрессии** — список `PromptSpoAlert` (nightly cron findings).

## RBAC и multi-tenancy

- `super_admin` — полный доступ к system-уровневым шаблонам и Org-уровневым.
- `owner/admin` Org — только свои Org-уровневые шаблоны и eval-cases.
- `member` — read-only доступ к результатам своих оптимизаций (опционально, можно отложить).
- Все запросы под `TenantGuard`; `tenantId=null` означает system-scope, доступен только `super_admin`.
- Eval-кейсы с `source='imported-from-meeting'` наследуют tenantId встречи; запрет импорта чужих встреч.

## Метрики (prom-client, через [BusinessMetricsService](backend/src/common/metrics/business-metrics.service.ts))

```
z_spo_optimization_started_total{tenant,template}       counter
z_spo_optimization_completed_total{tenant,template,reason}  counter (reason=succeeded|failed|stopped|hard_stop)
z_spo_iteration_total{tenant,template}                  counter
z_spo_judge_score{tenant,template,version}              histogram (0-5)
z_spo_candidate_kept_total{tenant,template}             counter
z_spo_candidate_rejected_total{tenant,template,reason}  counter (reason=lower_score|invalid_output|cost_exceeded)
z_spo_optimization_duration_seconds{tenant,template}    histogram
z_spo_optimization_cost_usd{tenant,template}            histogram
z_spo_nightly_regression_detected_total{tenant,template}  counter
```

## Entitlements и лимиты concurrency

**Три независимых ограничения работают каскадом:**

1. **Per-Org одновременных runs = 1** (hardcoded, не настраивается). Org оптимизирует templates **последовательно**. Параллельность внутри одной Org бесполезна — SPO идёт 2–3 часа, реалистичного сценария «нужны две оптимизации одновременно» не существует.
2. **Глобальный лимит = 5** (ENV `SPO_GLOBAL_CONCURRENT_LIMIT`). Защита `proxy.agent-lia.ru` от перегрева. ~5 runs × 2 RPS = 10 RPS, proxy выдержит. Превышение → новый run встаёт в очередь BullMQ.
3. **Cost-cap на run** = 50 USD default, до 200 USD override от super_admin. Hard-stop в воркере (см. условия выше).

**Tier-фичи через entitlements:**
- `feature.spo` — только Pro/Business тариф. Free Org вообще не видит UI SPO.
- Квота `spo_runs_per_month`: free=0, Pro=5, Business=20, Enterprise=∞. Сбрасывается 1-го числа месяца.
- При исчерпании месячной квоты — UI блокирует «Запустить» с сообщением «Использовано N/M в этом месяце, новые с 1-го числа».

## Безопасность и стоимость

- **Никаких persisted prompt inputs** за пределы proxy.agent-lia.ru (см. memory: `project_z_infra_and_ai.md` — `dataClass='internal'`).
- **Cost cap на уровне run** — `maxCostUsd` обязателен, default 50 USD.
- **Audit log** — каждый запуск SPO с userId, timestamp, бюджет, итог. Хранить минимум 1 год.
- **Идемпотентность** — повторный POST на `/optimization-runs/:id/stop` не падает.

## Принятые решения (зафиксированы 2026-05-24)

Все 5 архитектурных вопросов закрыты — блокеров для старта нет:

1. **Источник gold:** гибрид (реальные transcript'ы с 👍 → synthetic draft через GPT-5/4o → human edit + human reasoning **обязательно**). См. раздел «Источник gold для эталонов». ~15 часов разметки на тип, 135 часов разово на все 9 типов. Bootstrap — `type-sales`.
2. **Версионирование rubric:** отдельная модель `PromptRubric` с `versionNumber`. Старые версии не удаляются никогда, `PromptEvalRun.rubricId` фиксирует использованную версию. Сравнение runs на разных rubric — со звёздочкой в UI.
3. **Лимиты concurrency:** per-Org=1 (hardcoded), глобально=5 (ENV), cost-cap 50 USD/run, месячная квота через entitlements (free=0, Pro=5, Business=20). См. «Entitlements и лимиты concurrency».
4. **knowledge-core:** поддерживаем технически с Фазы 1 (никакого `meetingType`-фильтра в коде SPO), оптимизируем после `type-sales`. Приоритет — `idea-extract`, `decision-extract`, `insight-extract`.
5. **Pareto-оси:** 3 оси — `avgScore` × `worstCaseScore` × `worstCriterionScore`. Plateau-guard на оси Pareto-пула добавлен в hard-stop условия воркера (`pareto_plateau`).

## Фазы реализации

### Фаза 1: Foundation (2 недели) — `[ ]`

Цель: можно вручную создавать eval-кейсы и прогонять одну версию промпта по ним с LLM-judge, видеть score.

- `[ ]` Prisma-модели `PromptRubric`, `PromptEvalCase`, `PromptEvalRun`, `PromptEvalResult` + дополнения к `PromptTemplate/Version`. `bun run prisma:push`.
- `[ ]` Регистрация `prompt_judge` taskType в llm-router + ENV в env.schema.
- `[ ]` Сервис `prompt-eval.service.ts` — CRUD кейсов, rubric.
- `[ ]` Worker `spo-eval-batch.worker.ts` + `spo-judge.worker.ts`.
- `[ ]` Promised system-prompt для judge'а.
- `[ ]` Admin API: `/eval-cases/*`, `/rubric/*`, `/eval-runs/*`.
- `[ ]` Admin UI: tabs «Эталонные кейсы», «Критерии оценки», «Прогоны оценки» (без оптимизации).
- `[ ]` Импорт-from-meeting + гибридная разметка gold для `type-sales` — 30 кейсов (см. раздел «Источник gold для эталонов»): synthetic draft через GPT-5/4o → human edit + обязательный human reasoning тимлида.
- `[ ]` Стартовая `PromptRubric v1` для `type-sales` с 4-6 критериями.
- `[ ]` Метрики `z_spo_judge_score`, `z_spo_iteration_total`.
- `[ ]` Тесты: unit на judge-parser, integration на eval-run flow.
- `[ ]` Документация в `second-brain/01_projects/spo-foundation.md`.

**Выход фазы:** ручной workflow «выбрал версию → прогнал на 30 кейсах → увидел score 3.4/5» работает end-to-end.

### Фаза 2: Optimization loop (2 недели) — `[ ]`

Цель: автоматический SPO-цикл за 15 итераций даёт лучшую версию.

- `[ ]` Prisma: модель `PromptOptimizationRun` + поля `spoOptimizationRunId/spoIteration/spoParentVersionId` в `PromptTemplateVersion`.
- `[ ]` Регистрация `prompt_propose` taskType в llm-router.
- `[ ]` Сервис `spo-optimization.service.ts`.
- `[ ]` Worker `spo-optimize-iteration.worker.ts` с Pareto-отбором, hard-stop, plateau detection.
- `[ ]` Promised system-prompt для proposer'а.
- `[ ]` Admin API: `/optimization-runs/*` (POST/GET/stop/promote).
- `[ ]` Admin UI: tab «Оптимизация» с прогрессом, графиком, tree-view, diff-view.
- `[ ]` `promote` интегрирован с существующим `PromptExperiment` (создаёт A/B автоматически).
- `[ ]` Entitlements: `feature.spo` + квота.
- `[ ]` Метрики: все `z_spo_*` (кроме nightly).
- `[ ]` Тесты: интеграционный «прогон mini-SPO на 5 кейсах с 3 итерациями».
- `[ ]` Документация: `second-brain/01_projects/spo-optimization.md`.

**Выход фазы:** super_admin запускает SPO для `type-sales`, ждёт 2 часа, получает кандидат с score 4.1+ и кнопку «Запустить A/B 50/50».

### Фаза 3: Regression detection + polishing (1 неделя) — `[ ]`

Цель: продакшен-grade — nightly regressions, calibration, алерты.

- `[ ]` Prisma: модель `PromptSpoAlert`.
- `[ ]` Cron `@Cron('0 3 * * *')` — nightly regression check (за флагом).
- `[ ]` Judge calibration: 1 раз в неделю прогон контрольных кейсов с известным score, алерт при дрейфе.
- `[ ]` Admin UI: tab «Регрессии» + email-нотификация owner/admin.
- `[ ]` Метрика `z_spo_nightly_regression_detected_total`.
- `[ ]` Документация: `second-brain/01_projects/spo-regression.md`.
- `[ ]` Чек-лист обновления `second-brain/index.md` + затронутых заметок (см. CLAUDE.md).

**Выход фазы:** ночью прогнался champion на 30 кейсах, score не упал — тишина. Упал на 0.5 — owner получил алерт «type-sales деградировал, версия v12 → v11».

## Связи с другими модулями

- **prompt-experiments** — SPO не заменяет, а питает. SPO даёт «лучшего кандидата по offline-rubric», A/B даёт «проверка на live-traffic с реальным фидбеком пользователей».
- **ai-result-feedback** — будет использован в Фазе 2.5 (опционально): пользовательский 👍/👎 — дополнительный сигнал для пополнения eval-сета («встречи с 👎 → кандидаты в новые eval-кейсы»).
- **knowledge-core промпты** — **технически поддерживаются с Фазы 1**: SPO не различает шаблоны по `meetingType`, `inputPayload Json` универсален. Фактически оптимизируем после стабилизации на одном типе встречи. Приоритет: (1) `idea-extract` — ядро графа, ошибка извлечения = пропавшая идея навсегда; (2) `decision-extract` — критично для аудита; (3) `insight-extract`. `clone-respond` (генеративный, субъективная оценка стиля) — позже.
- **dashboard / chat-v2** — позже, после стабилизации SPO на отчётах встреч.

## Итог (на момент составления ТЗ)

Реализовано: **0%**. Все 3 фазы — `[ ]`.

**Открытых архитектурных блокеров нет** — все 5 решений зафиксированы (см. «Принятые решения»).

ТЗ готово к реализации после: (а) приоритезации в roadmap, (б) выделения **5 человеко-недель** разработки + **~15 часов разметки** силами тимлида/продакта на `type-sales`, (в) подтверждения бюджета LLM-инференса (~200–500 USD на полный SPO-run одного типа встречи).

## Ревизия от 2026-05-24

**Статус:** draft
**Реализовано:** Ничего. Поиск по коду не нашёл ни одной из новых моделей (`PromptEvalCase`, `PromptOptimizationRun`, `PromptRubric`, `PromptEvalResult`) в `schema.prisma`, ни новых taskType (`prompt_judge`, `prompt_propose`) в `llm-router.service.ts`, ни модуля `prompt-spo/` в `backend/src/modules/admin/`.

**Осталось:** Весь scope всех трёх фаз. Блокеры не технические — нужны 5 человеко-недель разработки + ~15 часов human-разметки эталонов (тимлид/продакт) для bootstrap-типа `type-sales` + бюджет $200–500/полный SPO-run.
