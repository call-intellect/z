# ТЗ — Надёжность LLM-роутера + нормализация цепочек (deepseek → gpt → kie)

> Статус: **ФИНАЛ, готов к реализации.** Все развилки закрыты (Р-A/Р-B/Р-C — решения внутри). Ждёт команды «начинай реализацию».
> Дата: 2026-06-05. Автор-постановщик: владелец (sergrv80). Контекст найден аудитом LLM-агентов 2026-06-05.
> Источник правды по моделям — таблица БД `LlmTaskRoute` (не код). Код = сид + аварийный `DEFAULT_FALLBACK_CHAIN`.

## 1. Контекст и доказательства (прод meet.crossmark.ru, диаг 2026-06-05)

Аудит реальных прод-маршрутов (`GET /api/v1/admin/ai-models`, 124 записи) и логов 2 последних встреч выявил системные дыры в надёжности LLM-цепочки:

1. **Единый таймаут 30с убивает медленные thinking-модели.** `LLM_ROUTER_DISPATCH_TIMEOUT_MS=30000` ([env.schema.ts:115](../../backend/src/common/config/env.schema.ts#L115)) применяется per-attempt ко всем 124 агентам через `Promise.race` ([llm-router.service.ts:1325](../../backend/src/modules/ai/services/llm-router.service.ts#L1325)). `deepseek-v4-pro` (capable thinking) на объёмном входе не укладывается → `LLM dispatch timeout > 30000ms`.
2. **Дыра в реестре:** 3 агента объявлены в типе `LlmTaskType`, но отсутствуют в `ALL_LLM_TASK_TYPES` ([llm-router.service.ts:523](../../backend/src/modules/ai/services/llm-router.service.ts#L523)) → нет в админке, нет дефолтных маршрутов, едут по аварийному `DEFAULT_FALLBACK_CHAIN`: `knowledge-specialists-combined`, `dialog-multi-query-clone`, `checkin-sentiment-batch`.
3. **Tertiary мёртв везде:** `ollama:qwen3.5:9b` (а кое-где `qwen3:30b`) → `401 Invalid API key format`. Нижний уровень обороны не работает ни у одного агента.
4. **Secondary мёртв на JSON-задачах:** `openai-via-proxy` → `400 "messages must contain the word 'json' ... to use 'text.format' of type 'json_object'"`. Вторая линия обороны падает у каждой задачи со строгим JSON.
5. **5 агентов на `deepseek-v4-pro` вообще без fallback** (один таймаут = полный провал): `decision-hygiene`, `forecast-weekly`, `goal-vector-tracker`, `sprint-daily-digest`, `sprint-weekly-digest`.
6. **6 агентов с `ollama` в PRIMARY** бьют в мёртвый ключ на каждом вызове: `concierge-toolcall-validate`, `orchestrator-verify`, `proactive-message-craft`, `role-completeness-rationale`, `router-fallback`, `telegram-reply-classify`.
7. **Граф деградирует:** `block-ingest` / `block-linker` — `invalid JSON по схеме`, `block-linker: fallback на none` (связи между блоками не создаются).

Итог: фактически у большинства агентов работает только PRIMARY; secondary (openai JSON-баг) и tertiary (ollama 401) — мертвы. Любой сбой primary = провал задачи.

## 2. Решения владельца (зафиксировано в сессии 2026-06-05)

- **Р1.** Таймаут диспетчера `30 000 → 300 000 мс` (per-attempt).
- **Р2.** Закрыть дыру: зарегистрировать 3 потерянных taskType в `ALL_LLM_TASK_TYPES` + засидить им маршруты.
- **Р3.** Tertiary у ВСЕХ агентов → `kie:gemini-3.1-pro` (вместо мёртвого ollama).
- **Р4.** `kie.maxDataClass`: `internal → private` (чтобы kie мог быть универсальным tertiary; приватность сейчас в депри­оритете — отдельное решение владельца).
- **Р5.** Убрать `ollama` (`qwen3.5:9b` и `qwen3:30b`) из **primary и secondary** везде. `ollama`-primary → `deepseek-v4-flash`. `ollama`-secondary → `openai-via-proxy:gpt-5.4-mini`.
- **Р6 (целевая инвариант­ная цепочка).** Стандарт по умолчанию: **`deepseek (primary) → openai-via-proxy/gpt (secondary) → kie:gemini-3.1-pro (tertiary)`**. ollama выводится из всех боевых LLM-цепочек (остаётся только для эмбеддингов `bge-m3` — вне scope).

### Решения по развилкам (все закрыты)

- **Р-A. `editedByAdmin`-маршруты. ✅ РЕШЕНО (2026-06-05): `--force` с обязательным предварительным `--dry-run`.** Нормализация перетирает в т.ч. ручные правки админки (явная воля «везде»). Перед боевым прогоном — обязательно `--dry-run`, глазами просмотреть список строк с `editedByAdmin=true` (что именно перетираем), затем `--force`.
- **Р-B. openai-primary задачи. ✅ РЕШЕНО (2026-06-05):**
  - **Вывести `gpt-4o` из проекта полностью** (устаревший, дорогой) — 4 агента переназначены (см. Фаза 2.5).
  - Классификаторы на nano (`clip-title`, `theme-classify`, `meeting-quality-score`) и **debate-supporter** (diversity критика↔саппортер) — **остаются openai-primary как осознанные исключения** (дёшево/нужна провайдер-диверсификация). Под стандарт приводим только их tier-2/3.
- **Р-C. `meeting-report-fast` модель. ✅ РЕШЕНО (2026-06-05): оставляем `deepseek-v4-pro`** — с таймаутом 300с pro доедет, secondary(openai после Фазы 3)+tertiary(kie) дают подстраховку. Модель не меняем.

---

## Фаза 1 — Таймаут диспетчера 300с `[ ]`

**Что:** `LLM_ROUTER_DISPATCH_TIMEOUT_MS` дефолт `30_000 → 300_000`.

**Где:**
- [env.schema.ts:115](../../backend/src/common/config/env.schema.ts#L115) — `.default(30_000)` → `.default(300_000)`.
- Прод: выставить `LLM_ROUTER_DISPATCH_TIMEOUT_MS=300000` в `.env` (прод-деплой Шаг 1).
- Код читает значение динамически через `cfg.llmRouter.dispatchTimeoutMs` ([llm-router.service.ts:999](../../backend/src/modules/ai/services/llm-router.service.ts#L999)) — правок логики не нужно.

**Верификация локов воркеров (обязательно):** BullMQ-очереди в [ai-queue.service.ts](../../backend/src/modules/ai/ai-queue.service.ts) НЕ задают `lockDuration`/`timeout` (только `attempts`) → дефолт 30с с авто-продлением. Async LLM-вызов (await fetch) не блокирует event loop, лок продлевается таймером → 300с-вызов выживет. **Проверить empirically:** запустить агента с искусственной задержкой 60-90с и убедиться, что job не помечается `stalled` и не дублируется. Если где-то есть явный `lockDuration<300000` — поднять до ≥ `300000 + запас`.

**Тонкость:** 300с per-attempt × 3 tier = до 900с worst-case на агента. Приемлемо для оффлайн-воркеров (анализ встречи, граф, кроны). Для онлайн-путей (Concierge, chat-v2) 900с недопустимо — **проверить, что у синхронных вызовов есть свой более короткий потолок на уровне контроллера** (напр. `CONCIERGE_PRE_RETRIEVAL_TIMEOUT_MS=3000` уже есть). Если нет — vNext (не в этом ТЗ).

---

## Фаза 2 — Нормализация цепочек + kie private + закрытие дыры `[ ]`

### 2.1. kie → private `[ ]`
[llm-router.service.ts:743](../../backend/src/modules/ai/services/llm-router.service.ts#L743): `kie: { maxDataClass: 'internal', localOnly: false }` → `maxDataClass: 'private'`. (Опционально симметрично `grsai`, если планируем его в цепочки — сейчас не нужно.)

### 2.2. Регистрация 3 потерянных taskType `[ ]`
В `ALL_LLM_TASK_TYPES` ([llm-router.service.ts:523](../../backend/src/modules/ai/services/llm-router.service.ts#L523)) добавить (в типе они уже есть):
- `knowledge-specialists-combined`
- `dialog-multi-query-clone`
- `checkin-sentiment-batch`

Unit-тест `seed-llm-task-routes-default.spec.ts` и любые `satisfies`-проверки числа taskType — обновить (ожидаемое количество 124 → 127).

### 2.3. Новый патч-скрипт нормализации `[ ]`
Создать `backend/scripts/patch-normalize-llm-chains-deepseek-openai-kie.ts` (по образцу `patch-rollback-to-deepseek-flash.ts`, через `createPrismaClient()` из `_lib/prisma`). Алгоритм для каждого `taskType ∈ ALL_LLM_TASK_TYPES` (tenantId=null), идемпотентно:

1. **primary:** если `providerName='ollama'` → `deepseek` / `deepseek-v4-flash`. Иначе НЕ трогать модель (сохраняем тюнинг pro/flash и openai-primary исключения по Р-B).
2. **secondary:** если `providerName='ollama'` → `openai-via-proxy` / `gpt-5.4-mini`. Если secondary отсутствует → создать `openai-via-proxy:gpt-5.4-mini`. Если после шага 1 primary стал `deepseek`, а secondary тоже `deepseek` (дубль провайдера) → secondary поднять на `openai-via-proxy:gpt-5.4-mini`.
3. **tertiary:** всегда `kie:gemini-3.1-pro` (заменить существующий / создать).
4. **dedup:** в одной цепочке не должно быть двух одинаковых провайдеров; при коллизии разнести по стандарту deepseek→openai→kie.
5. `editedByAdmin`: по умолчанию `--force` перетирает (Р-A). Без `--force` — щадяще пропускать.
6. `--dry-run` — печатать план без записи (обязательно прогнать первым).

**Засидить 3 новых taskType** (capable, по их дизайну — thinking pro primary): тем же или соседним скриптом создать маршруты:
- `knowledge-specialists-combined`: `deepseek:deepseek-v4-pro → openai-via-proxy:gpt-5.4 → kie:gemini-3.1-pro`
- `dialog-multi-query-clone`: `deepseek:deepseek-v4-pro → openai-via-proxy:gpt-5.4-mini → kie:gemini-3.1-pro`
- `checkin-sentiment-batch`: `deepseek:deepseek-v4-pro → openai-via-proxy:gpt-5.4-mini → kie:gemini-3.1-pro`

### 2.4. Обновить код-сиды (источник истины для bootstrap) `[ ]`
Чтобы новая прод-инсталляция получала верные дефолты:
- `seed-llm-task-routes-default.ts` и профильные сиды: tertiary `ollama:qwen3.5:9b` → `kie:gemini-3.1-pro`; в `DEFAULT_FALLBACK_CHAIN` ([llm-router.service.ts:785](../../backend/src/modules/ai/services/llm-router.service.ts#L785)) tertiary `ollama` → `kie:gemini-3.1-pro`.
- Зарегистрировать новый патч в `backend/scripts/apply-prod-deploy.ts` (`STEPS`, `phase` = update, `skipBootstrap=true`).

### 2.5. Вывод `gpt-4o` из проекта (4 агента) `[ ]`
`gpt-4o` — устаревший и дорогой; убираем полностью. Переназначение primary (в том же патче нормализации или соседней строкой):

| Агент | Было | Стало (primary) | Полная цепочка | Почему |
|---|---|---|---|---|
| `orchestrator-plan` | gpt-4o | **deepseek-v4-pro** | deepseek-v4-pro → openai:gpt-5.4 → kie:gemini-3.1-pro | reasoning-декомпозиция, async, pro сильнее и дешевле 4o |
| `orchestrator-synthesize` | gpt-4o | **deepseek-v4-pro** | deepseek-v4-pro → openai:gpt-5.4 → kie:gemini-3.1-pro | синтез текста, async, латентность неважна |
| `brand-voice-extract` | gpt-4o | **deepseek-v4-pro** | deepseek-v4-pro → openai:gpt-5.4 → kie:gemini-3.1-pro | daily cron, точность важна, латентность неважна |
| `concierge-respond` | gpt-4o | **gpt-5-mini** | gpt-5-mini → deepseek-v4-flash → kie:gemini-3.1-pro | интерактивный + цикл до 5 LLM-вызовов → нужна **быстрая** модель, не thinking-pro; mini надёжнее nano для выбора инструмента (tool-use эмулируется JSON, см. [concierge.service.ts:47](../../backend/src/modules/concierge/services/concierge.service.ts#L47)) |

`concierge-respond` остаётся openai-primary (исключение Р-B), но на `gpt-5-mini` (≈5× дешевле 4o на входе: $0.25/$2.0). 3 фоновых — на `deepseek-v4-pro`.
**Проверка:** после прогона `bun run scripts/diag-routes.ts | grep gpt-4o` (без `-mini`) → пусто.

### 2.6. Эффект (проверяется после прогона)
- 5 «no-fallback» pro-агентов получают secondary(openai)+tertiary(kie). ✅
- 6 ollama-primary агентов → deepseek-flash primary. ✅
- ollama исчезает из всех LLM-цепочек → 401 больше не на боевом пути. ✅
- `gpt-4o` выведен полностью (4 агента переназначены). ✅

---

## Фаза 3 — Фикс JSON-mode в OpenAiProxyService (P0) `[ ]`

**Проблема:** при `responseFormat.type='json_object'` ([openai-proxy.service.ts:81-82](../../backend/src/modules/ai/services/openai-proxy.service.ts#L81)) OpenAI Responses API требует слово «json» в `instructions`/`input`, иначе `400`. Промпты Коры его не содержат → secondary падает у каждой JSON-задачи.

**Фикс (cache-friendly, см. [[feedback_llm_prompts_cache_friendly]]):** когда `fmt.type==='json_object'` и в `instructions` (system) нет подстроки `json` (case-insensitive) — добавить **стабильный константный суффикс** к `instructions`, например: `\n\nОтветь строго валидным JSON.`. Константа одинакова на всех вызовах → префикс-кэш не ломается. НЕ вставлять переменные данные.

**Проверить json_schema-ветку** ([:83](../../backend/src/modules/ai/services/openai-proxy.service.ts#L83)): эмпирически (мини-e2e на прокси) убедиться, нужно ли «json» и для `json_schema`; если да — применить тот же приём. Подтвердить поведение API, не угадывать ([[feedback_verify_framework_behavior_empirically]]).

**Тест:** unit на `buildParams` (json_object без «json» в system → суффикс добавлен; с «json» → не дублируется) + один интеграционный против прокси.

---

## Фаза 4 — Граф: устойчивый парсинг JSON от LLM (P1, корень найден) `[ ]`

**Исследование (проведено 2026-06-05, код + прод-логи):**

Сравнили два воркера графа:
- **block-ingest** ([block-extraction.service.ts:407,422,449](../../backend/src/modules/knowledge-core/services/block-extraction.service.ts#L407)) — `responseFormat: json_schema strict`; на invalid JSON делает **1 retry**; в проде retry прошёл → «извлечение завершено». Деградация = лишний вызов, но данные не теряются.
- **block-linker** ([block-link.service.ts:158-195](../../backend/src/modules/knowledge-core/services/block-link.service.ts#L158)) — тот же `json_schema strict`, но `parseVerdict` ([:200-206](../../backend/src/modules/knowledge-core/services/block-link.service.ts#L200)) делает **сырой `JSON.parse(text)` без ретрая и без репэйра**. На любой невалидный JSON → `return null` → `fallback на none` → `relationType=null`. В проде сработало **дважды** → 2 пары блоков **молча потеряли связь**.

**Корневая причина:** primary `deepseek-v4-flash` под `json_schema strict` иногда возвращает текст, который не проходит `JSON.parse`/Zod (обёртка ` ```json `, преамбла, reasoning-префикс). Вызов при этом УСПЕШЕН (200) → роутер не идёт в secondary (это не «все провайдеры упали»), значит фикс Фазы 3 (openai JSON-mode) здесь **не помогает** — проблема в парсинге ответа, а не в провайдере. `fallback на none` неотличим downstream от легитимного «связи нет» → молчаливая порча графа.

**Класс проблемы (не один кейс — [[feedback_fix_the_whole_class_not_the_case]]):** `JSON.parse(out.text)` по LLM-ответу встречается в **~51 файле**; при этом в **~18** уже есть какая-то починка → код непоследователен. Готовый helper уже существует: `tryParseJson` + `stripCodeFence` ([custom-report.worker.ts:399-423](../../backend/src/modules/ai/workers/custom-report.worker.ts#L399)) — снимает ` ```json `-обёртку и вытаскивает первый `{…}`.

**Фикс:**
1. **Вынести `tryParseJson`/`stripCodeFence` в общий util** (напр. `backend/src/modules/ai/services/json-extract.util.ts`), реэкспорт из старого места для back-compat.
2. **block-linker `parseVerdict`** — заменить сырой `JSON.parse(text)` ([:203](../../backend/src/modules/knowledge-core/services/block-link.service.ts#L203)) на общий lenient-парсер, затем Zod.
3. **Добавить block-linker 1 retry** — паритет с block-ingest (потерянное ребро молчаливо и навсегда; один ретрай дёшев).
4. **Метрика** `kc_block_linker_fallback_none_total` (и аналог для block-ingest skip) — убить молчаливую деградацию, повесить алерт ([[feedback_processes_catalog_verify_with_code]]).
5. **Class-sweep (поэтапно):** пройти ~51 сырой site, минимум — graph-critical (`block-link`, `entity-graph`, `entity-merge`, специалисты 3.x) перевести на общий парсер. Полный охват — отдельной волной, не блокирует.

**Не входит в этот ТЗ:** перевод структурированного вывода на `tool_use` вместо `json_schema` (надёжнее, но крупная переделка) — vNext.

---

## Верификация (после Фаз 1-3)

1. `cd backend && bun run typecheck && bun run lint && bun run build` — зелёные.
2. `bunx vitest run` по затронутым: `llm-router.service.spec.ts`, `llm-router.tier-fallback.spec.ts`, `openai-proxy*.spec.ts`, `seed-llm-task-routes-default.spec.ts`.
3. `--dry-run` патча нормализации — глазами проверить, что план = deepseek→openai→kie везде, ollama исчез, 3 новых появились.
4. После прогона на проде — `bun run scripts/diag-routes.ts` (read-only дамп): убедиться, что (а) ollama нет ни в одной строке, (б) tertiary везде `kie:gemini-3.1-pro`, (в) 127 строк.
5. Боевой smoke: провести тестовую встречу → `diag.ts trace --meeting <id>` → `reportFast` НЕ failed, secondary openai не 400, tertiary kie доступен.

## Прод-деплой (diff к [docs/operations/prod-deploy-log.md](../../docs/operations/prod-deploy-log.md))

- **Шаг 1 (ENV):** `LLM_ROUTER_DISPATCH_TIMEOUT_MS=300000`.
- **Шаг 6/7 (patch/seed):** `docker compose exec backend bun run scripts/patch-normalize-llm-chains-deepseek-openai-kie.ts --dry-run` → проверить → без `--dry-run` (+ `--force` по Р-A). Скрипт зарегистрировать в `apply-prod-deploy.ts`.
- Полный прогон агрегатором: `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`.
- Деплой кода (Фазы 1-3): `docker compose up -d --build backend` (+ worker-процесс).

## Риски

- **900с worst-case** на оффлайн-агента при тройном таймауте — приемлемо для воркеров, опасно для онлайн; см. Фаза 1 тонкость.
- **kie=private** — формально kie внешний прокси; решение политическое (приватность в депри­оритете). Если приватность вернётся в приоритет — откатить и вернуть локальный провайдер на private-задачи.
- **kie как единственный tertiary** — точка отказа нижнего уровня смещается на kie/прокси agent-lia.ru. Primary deepseek + secondary openai остаются основными; tertiary — лишь safety-net.
- **`--force` перетрёт ручные правки** владельца в админке — согласовано (Р-A).

## Итог
Реализовано: ☐ целиком ☐ частично. Что осталось: _(заполнить после реализации)_.

Связано: [[project_llm_tasktypes_missing_from_registry]], [[project_meeting_report_fast_broken_chain]].
