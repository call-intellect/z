---
type: tz
status: draft
feature: gepa-port-to-node
date: 2026-06-02
---

# ТЗ: GEPA prompt evolution — порт с Python на Node.js (single-stack)

> Контекст: единственная продакшен-точка Python в backend Z — модуль `prompt-evolution`,
> где `GepaRunnerService.spawnRunner` поднимает Python subprocess
> `backend/python/gepa/runner.py` поверх библиотек `gepa>=0.1` + `dspy-ai>=2.6`.
> Документация архитектуры: [second-brain/02_architecture/tech-stack.md](../../second-brain/02_architecture/tech-stack.md),
> ТЗ исходного внедрения GEPA: [plans/tz/2026-05-29-agents-v2-umbrella.md](2026-05-29-agents-v2-umbrella.md) §C2.

## Цель

Убрать единственное использование Python в продакшен-пути backend Z: перенести GEPA
optimization loop с Python subprocess на чистый TypeScript внутри NestJS, чтобы backend
жил на едином стеке **Bun + Node + TypeScript**.

## Бизнес-обоснование

1. **Один стек, одна головная боль.** Минус ветка `skipped_no_python`, минус ENOENT-обработка,
   минус timeout на subprocess, минус IPC через JSON в stdin/stdout, минус «не-JSON ответ»
   ветка. Один процесс, один debugger, один tracing.
2. **Prompt caching и observability возвращаются.** Сейчас вызовы из `dspy` через `litellm`
   ходят напрямую к DeepSeek и не попадают ни под нашу cache-friendly прокси-инфру
   (`proxy.agent-lia.ru`), ни под учёт в `AiUsageLog`. После порта — все LLM-вызовы GEPA идут
   через `LlmRouter`, получают prompt caching (экономия ≈99% по правилу
   [[feedback_llm_prompts_cache_friendly]]) и пишут стоимость в стандартную биллинг-таблицу.
3. **Тоньше Docker-образ.** Минус `python3 + py3-pip + ~150 МБ pip-зависимостей`
   (`gepa`, `dspy-ai`, `tiktoken`, `requests`) в prod-runner.
4. **Тесты в одной системе.** Сейчас `gepa-runner-real.spec.ts` гоняет реальный subprocess —
   после порта это обычный vitest с моком LlmRouter, как везде в backend'е.
5. **Эволюция стека.** Закрепляем общее правило: backend Z = единый стек Node/TS
   (см. новый принцип в `CLAUDE.md` + [[feedback_single_node_stack_no_python]]).

## Scope

**Входит:**
- Новый сервис `GepaOptimizerService` (TS), реализующий упрощённое ядро GEPA reflection-loop.
- Переключение `GepaRunnerService.runOptimization` на новый сервис (контракт сохраняется,
  потому что A/B-monitor и promote cron работают через `PromptCandidate` и Prisma, а не через
  Runner напрямую).
- Удаление `backend/python/` (runner.py, requirements.txt).
- Удаление секций `python3 + py3-pip + COPY python` из `backend/Dockerfile`
  (строки ~38–81; build-time `python3` для native-модулей в builder-стадии — НЕ трогаем,
  он нужен argon2/bcrypt).
- Удаление `GEPA_PYTHON_PATH` из `env.schema.ts`, `typed-config.service.ts`, `.env.example`.
- Удаление статуса `skipped_no_python` из метрики `incGepaOptimization` и связанных типов.
- Тесты: новые unit-spec'и для `GepaOptimizerService`; обновлённый `gepa-runner.service.spec.ts`;
  переименование/переработка `gepa-runner-real.spec.ts` под TS-only stack.
- Обновление документации: `second-brain/02_architecture/tech-stack.md`, новая заметка
  `second-brain/01_projects/prompt-evolution.md` (на текущий момент её нет).

**Не входит:**
- Document conversion (`infra/document-conversion/`) — это отдельный infra-микросервис за HTTP,
  не часть backend-process. Может остаться на Python (см. правило-исключение в
  [[feedback_single_node_stack_no_python]]).
- Изменение алгоритма A/B (composite = `1 - avg(editDistance)`) — он живёт в `gepa-ab-monitor.cron`
  и не зависит от Runner'а.
- Изменение метрики продвижения / порогов / cron-расписаний — все защиты остаются как есть.
- Поддержка legacy Python-кандидатов в `PromptCandidate` — формат `paretoMetric`/`reflectionTraces`
  совместим (JSON), новые кандидаты пишутся в той же форме.

## Технические изменения

### Backend

#### Новый сервис `GepaOptimizerService`

- Файл: `backend/src/modules/prompt-evolution/services/gepa-optimizer.service.ts`.
- Зависимости: `LlmRouter` (из `ai` модуля), `TypedConfigService`, `BusinessMetricsService`,
  `Logger`.
- Публичный метод:
  ```ts
  optimize(args: {
    promptKey: string;
    seedPrompt: string;
    reflectiveDataset: ReflectiveExample[]; // input, original, edited, editDistance, downstream
    taskLm: string;        // default cfg.gepa.taskLm (deepseek-v4-pro)
    reflectionLm: string;  // default cfg.gepa.reflectionLm (deepseek-v4-pro)
    maxMetricCalls: number;
    abortSignal?: AbortSignal;
  }): Promise<{
    paretoFrontier: Array<{ text: string; metrics: Record<string, number>; traces: unknown[] }>;
    costUsd: number;
  }>
  ```
- Алгоритм (упрощённое ядро GEPA reflective evolution):
  1. **Init:** `population = [{ text: seedPrompt, metrics: null }]`, `metricCalls = 0`,
     `costUsd = 0`.
  2. Цикл, пока `metricCalls < maxMetricCalls` и не сработал `abortSignal`:
     - **Sample:** взять `K = cfg.gepa.batchSize` (default 8) случайных примеров из датасета.
       Семплинг детерминированный через `seededRandom` (seed = `promptKey + iteration`),
       чтобы спецификации воспроизводились.
     - **Evaluate:** для каждого ещё-не-оценённого кандидата прогнать его promptText
       как SYSTEM, пример (`input` / `original`) как USER через `LlmRouter.invoke({
       taskType: '__gepa_eval__', systemPrompt: cand.text, ... })`. Стабильный SYSTEM —
       cache-friendly. Параллельность ограничена `cfg.gepa.concurrency` (default 4) через
       `p-limit`-аналог. `metricCalls += K`. `costUsd += sum(usage)`.
     - **Score:** для кандидата вычислить:
       - `accuracy` — доля примеров с `normEditDistance(generated, edited) ≤ 0.1`.
       - `editScore` — `1 - avg(normEditDistance(generated, edited))`.
       - `cost` — суммарная стоимость LLM-вызовов на этого кандидата.
       - `latency` — средняя задержка task LM.
       - `composite = accuracy - 0.5*cost_norm - 0.2*latency_norm` (как в `compositeOf` в
         `gepa-promote.cron.ts`).
     - **Pareto filter:** оставить недоминируемых кандидатов по тройке
       (`accuracy↑`, `cost↓`, `latency↓`).
     - **Reflect:** для top-`cfg.gepa.reflectTopK` (default 3) кандидатов вызвать
       reflection LM с фиксированным SYSTEM (cache-friendly) — см. ниже.
     - **Mutate:** распарсить JSON-ответ рефлектора, добавить `mutations[].newPrompt` в
       population. Дедуп по нормализованному тексту.
     - Лог итерации + проверка budget'а.
  3. **Return:** Pareto-set финальной population. Каждому кандидату прикрепляем
     `traces` — последние N (input, original, generated, edited) для admin-UI.
- **Reflection prompt** (стабильный SYSTEM, deepseek-v4-pro):
  > Ты — критик-улучшатель промптов. Получаешь текущий промпт и список (вход, ответ AI,
  > как поправил человек). Сформулируй 1–3 точечных улучшения промпта, объясни рассуждение
  > одной строкой. Верни строгий JSON:
  > `{ "mutations": [{ "rationale": "...", "newPrompt": "..." }, ...] }`.
- **Edit-distance:** использовать существующую утилиту, если есть; иначе — `js-levenshtein`
  (уже подключён в `prompt-feedback-collector.service`, проверить и переиспользовать).
- **AbortSignal:** общий timeout cfg.gepa.timeoutMs (default 1ч) реализуется через
  `AbortController` на верхнем уровне; при превышении — возврат текущей Pareto-frontier
  (best-effort), не throw.

#### Изменения в `GepaRunnerService`

- Файл: `backend/src/modules/prompt-evolution/services/gepa-runner.service.ts`.
- Удалить: `spawn`, `pythonAvailable`, метод `spawnRunner`, обе ветки `primaryScript`/`altScript`,
  обработку ENOENT/timeout subprocess'а, импорт `node:child_process`.
- Метод `runOptimization` становится тонким адаптером:
  - валидирует входы (как сейчас);
  - дёргает `GepaOptimizerService.optimize(...)`;
  - мапит результат в существующий тип `PromptCandidateResult`;
  - ведёт метрику `incGepaOptimization({status: 'success' | 'failed' | 'timeout'})`
    (статус `skipped_no_python` удалён).
- `gepa-optimize.cron.ts` и `gepa-promote.cron.ts` не меняются.

#### Конфиг

- `backend/src/common/config/env.schema.ts`:
  - **Удалить:** `GEPA_PYTHON_PATH`.
  - **Добавить:** `GEPA_BATCH_SIZE` (z.coerce.number().int().min(1).default(8)),
    `GEPA_REFLECT_TOP_K` (default 3), `GEPA_CONCURRENCY` (default 4).
- `backend/src/common/config/typed-config.service.ts`:
  - Убрать `pythonPath` из группы `gepa`.
  - Добавить `batchSize`, `reflectTopK`, `concurrency`.
- `.env.example` (если содержит `GEPA_PYTHON_PATH`) — удалить строку.

#### Метрика

- `backend/src/common/metrics/business-metrics.service.ts`:
  - Тип `GepaOptimizeStatus = 'success' | 'failed' | 'timeout'`.
  - Удалить упоминание `skipped_no_python`.
- Grafana dashboard — фиксируем в prod-deploy-log как «метка устарела, можно убрать из панели».

### База данных

- Изменений в схеме нет. Модели `PromptCandidate`, `PromptFeedback`, `LlmTaskRoute` не трогаем.
- Проверить: если `PromptCandidate.rejectedReason` enum содержит `skipped_no_python` — не убирать
  (исторические записи могут остаться). Если это плоская string-колонка — ничего делать не надо.

### Frontend

- Без изменений. Админ-страница prompt-evolution использует `PromptCandidate` через REST,
  формат сохраняется.

### Интеграции

- Все LLM-вызовы GEPA идут через `LlmRouter` → `proxy.agent-lia.ru` → DeepSeek.
- `AiUsageLog` получает записи с `taskType='__gepa_eval__'` и `__gepa_reflect__`
  (новые внутренние taskType'ы; добавить в LLM-роутер enum если он типизирован).
- BullMQ/cron — не затрагиваются.

## Docker / инфра

- `backend/Dockerfile`: удалить строки установки `python3 + py3-pip` для runtime
  (раздел «Agents v2 Фаза C2 — Python runner»), удалить `COPY python ./python` и
  `pip install -r python/gepa/requirements.txt`.
- **Не трогать** builder-секцию с `python3 make g++` — она нужна для нативных модулей.
- Удалить директорию `backend/python/` целиком (runner.py, requirements.txt, README.md).

## Критерии готовности (DoD)

- [ ] `GepaOptimizerService` реализован; unit-тесты покрывают: Pareto-filter,
      mutation parser, budget/abort, edit-distance scoring, дедуп кандидатов.
- [ ] `GepaRunnerService` не содержит `spawn`/`child_process`; метрики дают
      `'success'|'failed'|'timeout'`.
- [ ] `gepa-runner.service.spec.ts` обновлён, mock'и subprocess удалены.
- [ ] `gepa-runner-real.spec.ts` переписан под integration-test с реальным `LlmRouter`
      за фичефлагом (по аналогии с `gepa-ab-distribution.spec.ts`).
- [ ] `bun run typecheck && bun run lint && bun run test:unit` — зелёные.
- [ ] `backend/python/` удалён (`git status` чист), Dockerfile не содержит python3-runtime секций.
- [ ] `GEPA_PYTHON_PATH` отсутствует в `env.schema.ts`, `typed-config.service.ts`,
      `.env.example`, `prod-deploy-log.md`.
- [ ] `incGepaOptimization` не принимает `skipped_no_python` (тип сужен).
- [ ] `second-brain/02_architecture/tech-stack.md` обновлён — нет упоминания Python в backend.
- [ ] Создана `second-brain/01_projects/prompt-evolution.md` с описанием TS-реализации,
      алгоритма и ссылок на сервисы.
- [ ] `docs/operations/prod-deploy-log.md`: добавлен diff в Шаг 1 (удалён `GEPA_PYTHON_PATH`)
      и Шаг 12 (smoke: `incGepaOptimization{status=success}` после первого weekly cron).
- [ ] Рефлексия записана в `second-brain/05_история/2026-06-02-gepa-port-to-node.md`.

## Риски и ограничения

1. **Упрощённое ядро ≠ полный GEPA из paper.** Полный алгоритм (arxiv 2507.19457, ICLR 2026
   Oral) — multi-population с crossover и семантической дедупликацией. Берём single-population
   reflection-based mutation + Pareto-filter — достаточно для нашей задачи (выровнять промпт
   под усреднённую правку человека). Если A/B-метрика после порта систематически даёт
   `compositeB < compositeA` (rollback) — расширяем алгоритм отдельным ТЗ.
2. **Кэш промптов критичен.** SYSTEM для reflection LM и task LM должен быть стабильным,
   переменные данные — только в USER, в конце. См. [[feedback_llm_prompts_cache_friendly]].
   Иначе бюджет на одну оптимизацию вырастет в N раз.
3. **Rate-limit прокси.** GEPA может за одну оптимизацию делать сотни вызовов task LM.
   Ограничиваем concurrency `cfg.gepa.concurrency` (default 4) и хорошо логируем `costUsd`.
4. **Сравнимость качества с Python-версией.** Прямого A/B (Python-GEPA vs TS-GEPA) делать не
   будем — это удвоит стоимость одной weekly-оптимизации. Полагаемся на существующий
   gepa-ab-monitor: плохие кандидаты будут отброшены автоматически.
5. **Pareto-frontier совместимость.** Формат `paretoMetric` JSON сохраняем (`accuracy`,
   `cost`, `latency`, `composite`) — `compositeOf` в `gepa-promote.cron.ts` продолжит работать.

## Фазы реализации

- [ ] **Фаза 1 — research и дизайн.** Прочитать arxiv 2507.19457 (через Context7/WebSearch),
      выписать упрощённый псевдокод в `plans/analysis/2026-06-02-gepa-algorithm-notes.md`.
      Согласовать с пользователем формулу `composite` и параметры `batchSize/reflectTopK/concurrency`.
- [ ] **Фаза 2 — TS-сервис GepaOptimizerService + unit-тесты.** Реализация ядра, mock LlmRouter.
      Тесты: Pareto-filter, mutation parsing (включая поломанные JSON-ответы рефлектора),
      budget+abort, дедуп, edit-distance scoring.
- [ ] **Фаза 3 — интеграция в GepaRunnerService.** Удалить spawn, переключить контракт.
      Обновить `gepa-runner.service.spec.ts`, переписать `gepa-runner-real.spec.ts` под
      LlmRouter-mock + флаг `GEPA_REAL_LLM=1`.
- [ ] **Фаза 4 — миграция метрики и конфига.** Убрать `skipped_no_python`, `GEPA_PYTHON_PATH`,
      добавить новые ENV. Обновить `.env.example`.
- [ ] **Фаза 5 — удаление Python из инфры.** `backend/python/` → корзина. Dockerfile —
      удалены runtime-секции python3. `apply-prod-deploy.ts` — убрать ссылку (если есть).
- [ ] **Фаза 6 — документация и second-brain.** `tech-stack.md`, новая
      `01_projects/prompt-evolution.md`, обновление `prod-deploy-log.md` (Шаг 1 + Шаг 12).
- [ ] **Фаза 7 — staging-прогон (если есть staging).** Запустить `gepa-optimize` cron вручную
      через admin-endpoint с тестовым датасетом (≥30 PromptFeedback), убедиться что
      `PromptCandidate.status='pareto_pool'` появились. Проверить метрики Prometheus.
- [ ] **Фаза 8 — рефлексия и push.** `05_история/2026-06-02-gepa-port-to-node.md`, push c
      подтверждением.

## Итог

_Заполняется по факту реализации._
