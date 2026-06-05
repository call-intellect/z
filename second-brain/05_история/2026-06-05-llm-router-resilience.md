---
date: 2026-06-05
type: история-сессии
distilled: false
---

# Надёжность LLM-роутера + нормализация цепочек (deepseek → openai → kie)

## Что было поставлено

Аудит реальных прод-маршрутов (`GET /api/v1/admin/ai-models`, 124 записи) и логов
последних встреч вскрыл системные дыры в надёжности LLM-цепочки: фактически у
**большинства агентов работал только PRIMARY**.

- **SECONDARY мёртв на JSON-задачах:** `openai-via-proxy` → `400 "messages must
  contain the word 'json'"` (Responses API требует слово «json» в instructions при
  `json_object`/`json_schema`; промпты Коры его не содержали). Вторая линия обороны
  падала у каждой задачи со строгим JSON.
- **TERTIARY мёртв везде:** `ollama:qwen3.5:9b` (кое-где `qwen3:30b`) → `401 Invalid
  API key format`. Нижний уровень обороны не работал ни у одного агента.
- **5 агентов на `deepseek-v4-pro` вообще без fallback** (один таймаут = полный провал).
- **Дыра реестра:** часть taskType объявлена в типе `LlmTaskType`, но отсутствует в
  `ALL_LLM_TASK_TYPES` → нет в админке, едут по аварийному `DEFAULT_FALLBACK_CHAIN`.
- **Граф молча терял связи:** `block-linker` делал сырой `JSON.parse` без retry/repair
  → `fallback на none` → пары блоков теряли связь, downstream неотличимо от «связи нет».
- **Таймаут 30с** убивал thinking-модели (`deepseek-v4-pro` на объёмном входе).

Цель ТЗ (4 фазы): стандартная цепочка везде `deepseek → openai-via-proxy(gpt) →
kie:gemini-3.1-pro`, ollama выведен из всех боевых LLM-цепочек, `gpt-4o` выведен полностью,
таймаут 300с, дыра реестра закрыта, граф перестаёт молча деградировать. Решения владельца
Р1–Р6 + развилки Р-A/Р-B/Р-C закрыты внутри ТЗ. Реализация — оркестрация суб-агентами с
независимой приёмкой на ветке `sergdev`.

## Как решал

6 коммитов, по фазам:

- **`025714d3` (Ф1):** `LLM_ROUTER_DISPATCH_TIMEOUT_MS` дефолт `30_000 → 300_000`
  (`backend/src/common/config/env.schema.ts` + code-fallback в `llm-router.service.ts`).
  Прод-действие: выставить ENV.
- **`caf69f13` (Ф3):** `OpenAiProxyService.ensureJsonHint` — добавляет слово «json» в
  instructions при `json_object`/`json_schema` (чинит 400, ломавший secondary у всех
  JSON-задач). Cache-friendly: стабильный константный суффикс, SYSTEM-префикс не ломается.
  Только код.
- **`b68554fb` (Ф4):** `block-linker` — retry (2 попытки, зеркало `block-ingest`) + общий
  lenient-парсер `tryParseJson`/`stripCodeFence`, вынесенный в
  `backend/src/modules/ai/services/json-extract.util.ts` (реэкспорт из старого места) +
  новая метрика `kc_block_linker_fallback_none_total{reason}` (убивает молчаливую
  деградацию графа). Только код.
- **`c21c9e15` (Ф2a):** `kie.maxDataClass` `internal → private` (универсальный tertiary);
  `DEFAULT_FALLBACK_CHAIN` и `seed-llm-task-routes-default.ts` tertiary
  `ollama:qwen3.5:9b → kie:gemini-3.1-pro`; в `ALL_LLM_TASK_TYPES` зарегистрированы 5
  потерянных taskType (`knowledge-specialists-combined`, `dialog-multi-query-clone`,
  `checkin-sentiment-batch`, `experiment-extract`, `experiment-summarize-lessons`) — дыра
  реестра закрыта (строгий дифф union ↔ массив пуст).
- **`cb820a69` (Ф2b):** новый патч
  `backend/scripts/patch-normalize-llm-chains-deepseek-openai-kie.ts` (нормализация всех
  цепочек к `deepseek → openai(gpt) → kie:gemini-3.1-pro`; вывод `gpt-4o`:
  `orchestrator-plan`/`orchestrator-synthesize`/`brand-voice-extract` → `deepseek-v4-pro`,
  `concierge-respond` → `gpt-5-mini`; openai-исключения классификаторов и `debate`-diversity
  сохранены) + новый сид `backend/scripts/seed-llm-task-routes-missing-registry.ts`
  (цепочки для 5 потерянных taskType). Оба зарегистрированы в
  `backend/scripts/apply-prod-deploy.ts` (фазы `seed-llm-routes` и `seed-llm-default`,
  **без `--force`** = steady-state).

**Итог политики:** стандартная цепочка везде `deepseek → openai-via-proxy(gpt) →
kie:gemini-3.1-pro`. ollama выведен из ВСЕХ боевых LLM-цепочек (остаётся только для
эмбеддингов `bge-m3`). kie поднят до `private`. `gpt-4o` выведен полностью. Таймаут одного
dispatch 30с → 300с.

## Что вышло

- На каждой фазе зелёные: `typecheck` / `lint` (0 errors) / `build` / тесты.
- Добавлены тесты: `ensureJsonHint`, `json-extract`, `block-linker` retry,
  `computeDesiredChain` (8 кейсов нормализации).
- Прод-скрипты проверены статикой + юнит-тестами; **БД-прогон не делался** — нужен
  `--dry-run` на проде перед `--force` (Р-A: нормализация перетирает в т.ч. `editedByAdmin`).
- Документация: запись-блок в `docs/operations/prod-deploy-log.md` (Шаги 1/6/7/11/12),
  датированная секция «Нормализация цепочек 2026-06-05» в
  `second-brain/01_projects/llm-providers-verified.md` (+ строки `gpt-4o`/`ollama` помечены
  ⚠ «выведена»).
- НЕ закоммичено на момент написания (документация и код на ветке `sergdev`).

## Чему научился

1. **Дыра реестра оказалась шире заявленной (3 → 5).** Нашли строгим диффом
   union `LlmTaskType` ↔ массив `ALL_LLM_TASK_TYPES`, не доверяя оценке аудита. Урок:
   количественную оценку из аудита перепроверять машинным диффом, а не принимать на веру
   [[feedback_fix_the_whole_class_not_the_case]].
2. **Фикс secondary (openai JSON-mode) и устойчивый парсинг графа — РАЗНЫЕ корни.** Первый —
   провайдер падает 400 до ответа; второй — провайдер ответил 200, но текст не проходит
   `JSON.parse`/Zod (обёртка ` ```json `, преамбла). Роутер не идёт в secondary (это не
   «все упали»), поэтому фикс Ф3 здесь не помогает — лечить надо парсинг ответа. Один
   симптом ≠ один корень.
3. **Нормализацию регистрируем БЕЗ `--force` (steady-state), разовый `--force` — вручную.**
   Иначе клобберим админ-правки `editedByAdmin` на КАЖДОМ деплое. `--force` нужен ровно один
   раз — выбить легаси ollama/gpt-4o; дальше агрегатор уважает ручные правки.
4. **`concierge-respond` — единственный интерактивный из gpt-4o-четвёрки, ему нельзя
   thinking-pro.** Латентность × до 5 итераций цикла = неприемлемо. Поэтому он на `gpt-5-mini`
   (быстрый, mini надёжнее nano для выбора инструмента), а 3 фоновых async-агента — на
   `deepseek-v4-pro`. Назначение модели зависит от интерактивности пути, не только от
   «силы» задачи.

Связано: [[project_z_infra_and_ai]], [[feedback_llm_prompts_cache_friendly]],
[[feedback_verify_framework_behavior_empirically]].
