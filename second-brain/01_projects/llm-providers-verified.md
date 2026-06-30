---
title: LLM-провайдеры и модели — verified
status: actual
verified_at: 2026-05-24
updated: 2026-06-05
---

# LLM-провайдеры Z — verified карта

> **Единственный источник правды о том, какие LLM-вызовы реально работают.**
> Любой новый AI-агент в Z должен использовать только провайдеры/модели из
> этой таблицы. Если задумываешься о новой модели — сначала добавь её сюда
> через прогон [backend/scripts/smoke-llm-providers.ts](../../backend/scripts/smoke-llm-providers.ts).
>
> Целевая политика дефолтов — в [llm-models-playbook.md §2.1](../../docs/reference/llm-models-playbook.md).
> Карта реализации в коде — в [llm-router.md](llm-router.md).

## Когда читать этот файл

- Создаёшь новый AI-агент / worker / `LlmTaskType`.
- Меняешь модель в `LlmTaskRoute` через Z-Admin или seed.
- Дописываешь fallback-цепочку.
- Сомневаешься, какой канал выбрать для конкретной задачи.

## Verified-таблица (последний прогон от 2026-05-24)

> Колонка **«В LlmRouter»** показывает, подключён ли канал к `LlmTaskRoute` /
> админке `/admin/ai-models`. Если ✗ — модель проверена smoke-вызовом, но
> переключить её на agent через админку **нельзя**, пока не реализовано ТЗ
> [2026-05-24-kie-grsai-llm-router-integration.md](../../plans/archive/2026-05-24-kie-grsai-llm-router-integration.md).

### A. Каналы в продакшен-роутере (доступны через админку)

> Колонка **«Кэш»** добавлена 2026-05-25 — фактическое состояние prompt caching по итогам контрольного эксперимента. Подробности и сырые цифры — [llm-cache-status.md](../02_architecture/llm-cache-status.md).

| Канал (provider) | Модель | Статус | В LlmRouter | Latency | Кэш | Где использовать |
|---|---|---|---|---|--:|---|
| **deepseek** | `deepseek-v4-flash` | ✓ verified | ✓ | ~1.3s | ✅ 99.9% (мин 64 ток, −99%) | Primary для большинства задач: block-ingest/distill/linker, chat-v2, card-rollup-v2, task-extract-v2, chapter-extract-v2, dashboard-summary |
| **deepseek** | `deepseek-v4-pro` | ✓ verified | ✓ | ~3.2s | ✅ 99.9% | Тяжёлый reasoning: summary-v2, goal-alignment |
| **deepseek** | `deepseek-chat` | ⚠ выведена | — | ~0.8s | — | **Не использовать.** 2026-06-03 все маршруты мигрированы на `deepseek-v4-flash` (`patch-deepseek-chat-to-flash.ts`). Остаётся только прайс-строка для истории расходов. |
| **openai-via-proxy** | `gpt-5.5` | ✓ verified | ✓ | ~3.0s | ✅ (gpt-5.4-family, порог ~2048) | Top-intelligence fallback для summary-v2 |
| **openai-via-proxy** | `gpt-5.4` | ✓ verified | ✓ | ~1.4s | ✅ (порог ~2048) | Универсальный fallback для chat-v2 (сложные запросы) |
| **openai-via-proxy** | `gpt-5.4-mini` | ✓ verified | ✓ | ~1.2s | ✅ 99.7% (порог ~2048) | Primary fallback общего потока |
| **openai-via-proxy** | `gpt-5.4-nano` | ✓ verified | ✓ | ~1.5s | ⚠ кэш только при ≥2048 ток (классификаторы могут не попадать) | Primary для коротких классификаторов: theme-classify, entity-resolver |
| **openai-via-proxy** | `gpt-5-mini` | ✓ verified | ✓ | ~0.9s | ✅ 99.8% (мин 1024 ток, −90%) | Лёгкий быстрый канал, legacy дефолт `OpenAiProxyService` |
| **openai-via-proxy** | `gpt-4.1-mini` | ✓ verified | ✓ | ~3.4s | ✅ (по аналогии с gpt-5*) | Не-reasoning fallback (нужен `temperature`) |
| **openai-via-proxy** | `gpt-4o-mini` | ✓ verified | ✓ | ~1.7s | ✅ (по аналогии) | Не-reasoning fallback (нужен `temperature`) |
| **openai-via-proxy** | `gpt-4o` | ⚠ выведена (2026-06-05) | — | ~2.5s | ✅ (по аналогии) | **Не использовать.** Выведена из проекта (устаревшая, дорогая, нет в `MODEL_PRICES`). 4 агента переназначены: concierge-respond→`gpt-5-mini`; brand-voice-extract/orchestrator-plan/orchestrator-synthesize→`deepseek-v4-pro`. См. секцию «Нормализация цепочек 2026-06-05» ниже. |
| **minimax** | `MiniMax-M2.5` | ✓ verified | ✗ (seed нет) | ~1.8s | ✅ 100% (требует явный `cache_control: 'ephemeral'`) | Anthropic-совместимый fallback, A/B-кандидат на summary-v2 |
| **minimax** | `MiniMax-M2.7` | ✓ verified | ✓ | ~2.9s | ✅ (по аналогии с M2.5) | Свежая M2.7, A/B-кандидат на summary-v2 |
| **ollama** (`ollama.agent-lia.ru`) | `qwen3.5:9b` | ⚠ выведена из боевых LLM-цепочек (2026-06-05) | — | ~8.0s | ❌ prompt cache на уровне API не предусмотрен | **Не использовать как chat-fallback.** На проде ключ даёт `401 Invalid API key format` → tertiary был мёртв везде. 2026-06-05 выведена из ВСЕХ боевых цепочек (primary/secondary/tertiary), tertiary везде → `kie:gemini-3.1-pro`. Остаётся только как технически-установленная модель; chat-задачи на неё не маршрутизировать. Эмбеддинги — отдельный pipeline (`bge-m3` физически нет, см. ниже). |
| **kie** | `claude-opus-4-7` | ✓ verified (2026-05-24) | ✓ (admin-UI с 2026-05-25; нужен seed-default-llm-providers-and-models.ts) | ~20s | ❌ `cache_read_input_tokens=0` даже с `cache_control` | A/B-кандидат на summary-v2 / goal-alignment. Цена $15/$75 в `MODEL_PRICES`. |
| **kie** | `gpt-5-4` | ✓ verified (2026-05-24) | ✓ (admin-UI с 2026-05-25; нужен seed) | ~3s | ⚠ нестабильно (S1=0%, S2 parallel=47%) | Через `/codex/v1/responses`. ⚠ цена TBD в `MODEL_PRICES` — пока 0. |
| **kie** | `gemini-3-pro` | ✓ verified (2026-05-24) | ✓ (admin-UI с 2026-05-25; нужен seed) | ~9s | ❌ 0% | A/B-кандидат на summary-v2. Цена $0.5/$3.5. |
| **kie** | `gemini-3.1-pro` | ✓ verified (2026-05-24) | ✓ (admin-UI с 2026-05-25; нужен seed) | TBD | ❌ (по аналогии) | Свежая 3.1, A/B-кандидат. Цена $0.5/$3.5. |
| **kie** | `gemini-3-flash` | ✓ verified (2026-05-24) | ✓ (admin-UI с 2026-05-25; нужен seed) | ~25s | ❌ 0% | A/B-кандидат на `dialog-multi-query` (заведён draft-эксперимент). ⚠ цена TBD. |
| **grsai** | `gemini-3-pro` | ✓ verified (2026-05-24) | ✓ (admin-UI с 2026-05-25; нужен seed) | ~10.5s | ❌ 0% (usage без `cached_tokens`) | Альт. канал к Gemini 3 Pro через прокси (SSE). |
| **grsai** | `gemini-3.1-pro` | ✓ verified (2026-05-24) | ✓ (admin-UI с 2026-05-25; нужен seed) | ~9.5s | ❌ (по аналогии) | Альт. канал к Gemini 3.1 Pro через прокси (SSE). |
| **embeddings** (openai-via-proxy) | `text-embedding-3-small` | ✓ verified | (отдельный pipeline) | ~1.4s | n/a | **Единственный verified канал embeddings.** dim=1536 |

### B. Подробности smoke-вызовов KIE / GRSAI (исторические, до 2026-05-25)

Сохраняем как контекст эксперимента, который привёл к подключению этих каналов в `LlmRouter`. После 2026-05-25 каналы доступны через админку (см. раздел A); этот раздел оставлен для трассировки URL-форматов и cache-поведения.

> **Внимание:** в cache-эксперименте 2026-05-25 ни один из этих каналов prompt caching не пробрасывает. **В расчётах экономики кэш не учитывать.**

| Канал | URL-формат | Модель | Статус smoke (2026-05-24) | Latency | Кэш |
|---|---|---|---|---|--:|
| **grsai-gemini** | `proxy.agent-lia.ru/grsai/v1/chat/completions` (SSE) | `gemini-3-pro` | ✓ verified | ~10.5s | ❌ 0% (usage без `cached_tokens`) |
| **grsai-gemini** | (то же) | `gemini-3.1-pro` | ✓ verified | ~9.5s | ❌ (по аналогии) |
| **kie-claude** | `api.kie.ai/claude/v1/messages` (Anthropic-compat) | `claude-opus-4-7` | ✓ verified | ~20s | ❌ `cache_read_input_tokens=0` даже с `cache_control` |
| **kie-gpt** | `api.kie.ai/codex/v1/responses` (OpenAI Responses) | `gpt-5-4` (через дефис) | ✓ verified | ~3s | ⚠ нестабильно (S1=0%, S2 parallel=47% — балансировка на разные backend) |
| **kie-gemini-direct** | `api.kie.ai/${model}/v1/chat/completions` (модель в URL) | `gemini-3-flash` | ✓ verified | ~25s | ❌ 0% |
| **kie-gemini** | `proxy.agent-lia.ru/kie/${model}/v1/chat/completions` | `gemini-3-pro` | ⚠ unstable (timeout 60s, раньше ~9s) | TBD | ❌ (по аналогии) |

Latency для KIE-каналов — TBD (зависит от прогона); внести после следующего полного smoke-запуска (`bun scripts/smoke-llm-providers.ts --only=kie-claude,kie-gpt,kie-gemini-direct,kie-gemini,grsai-gemini`).

## Нормализация цепочек и стандартный fallback (2026-06-05)

> Реализовано ТЗ `plans/tz/2026-06-05-llm-router-resilience-and-chain-normalization.md` (ветка `sergdev`). Аудит прод-маршрутов вскрыл, что у большинства агентов работал только PRIMARY: secondary `openai-via-proxy` падал `400 "messages must contain the word 'json'"` на JSON-задачах, tertiary `ollama` — `401 Invalid API key format`. Ниже — целевое состояние дефолтов после нормализации.

**Стандартная цепочка по умолчанию (инвариант):**

```
deepseek (primary) → openai-via-proxy/gpt (secondary) → kie:gemini-3.1-pro (tertiary)
```

- **`ollama` (`qwen3.5:9b`, `qwen3:30b`) выведен из ВСЕХ боевых LLM-цепочек** (primary/secondary/tertiary). На проде ключ давал `401` → нижний уровень обороны был мёртв у всех агентов. Остаётся только эмбеддинговый pipeline `bge-m3` — но он физически не установлен (см. таблицу «НЕ работают» ниже), эмбеддинги идут через `text-embedding-3-small`. То есть на практике ollama в боевых LLM-вызовах больше нет вообще.
- **`kie.maxDataClass`: `internal → private`** (`llm-router.service.ts`). Решение владельца: kie становится универсальным tertiary для всех задач, включая `private`; приватность сейчас в депри­оритете (отдельное политическое решение, при возврате приоритета — откатить и вернуть локальный провайдер на private-задачи). Точка отказа нижнего уровня смещается на kie/прокси `agent-lia.ru`, но primary deepseek + secondary openai остаются основными — tertiary лишь safety-net.
- **`gpt-4o` выведен полностью** (устаревшая, дорогая, нет в `MODEL_PRICES`). 4 агента переназначены:
  - `orchestrator-plan`, `orchestrator-synthesize`, `brand-voice-extract` (фоновые, async) → primary `deepseek-v4-pro` (сильнее и дешевле 4o, латентность неважна);
  - `concierge-respond` (интерактивный, цикл до 5 LLM-вызовов) → primary `gpt-5-mini` — нужна быстрая модель, не thinking-pro; mini надёжнее nano для выбора инструмента. Остаётся openai-primary как осознанное исключение.
- **openai-primary исключения сохранены** (под стандарт приводим только их tier-2/3): классификаторы на nano (`clip-title`, `theme-classify`, `meeting-quality-score`) и `debate`-diversity (саппортер↔критик) — дёшево / нужна провайдер-диверсификация.
- **Таймаут одного dispatch: `30с → 300с`** (`LLM_ROUTER_DISPATCH_TIMEOUT_MS`, per-attempt). Старый 30с убивал thinking-модели (`deepseek-v4-pro`) на объёмном входе (`LLM dispatch timeout > 30000ms`). До 900с worst-case на тройном таймауте — приемлемо для оффлайн-воркеров; для онлайн-путей свои короткие потолки на уровне контроллера.
- **Дыра реестра закрыта.** 5 ранее не зарегистрированных taskType добавлены в `ALL_LLM_TASK_TYPES` (раньше ехали по аварийному `DEFAULT_FALLBACK_CHAIN`, отсутствовали в админке): `knowledge-specialists-combined`, `dialog-multi-query-clone`, `checkin-sentiment-batch`, `experiment-extract`, `experiment-summarize-lessons`. Им засеяны дефолтные цепочки (`seed-llm-task-routes-missing-registry.ts`). Дыра нашлась строгим диффом union ↔ массива (оценка аудита была 3, факт — 5).
- **Граф: устойчивый парсинг.** `block-linker` получил retry (паритет с `block-ingest`) + общий lenient-парсер `tryParseJson`/`stripCodeFence` (вынесен в `backend/src/modules/ai/services/json-extract.util.ts`) + метрику `kc_block_linker_fallback_none_total{reason}` (раньше связи между блоками молча терялись). Это отдельный корень от фикса secondary: проблема в парсинге успешного (200) ответа, а не в провайдере.

**Источники правды:**
- Реальная карта прод-маршрутов (read-only дамп): `bun run scripts/diag-routes.ts` (или `docker compose exec backend bun run scripts/diag-routes.ts` на проде).
- Прод применяет нормализацию через `apply-prod-deploy.ts --mode update` + **разовый ручной `--force`** для `patch-normalize-llm-chains-deepseek-openai-kie.ts` (перетереть легаси ollama/gpt-4o, в т.ч. `editedByAdmin`-правки; в агрегаторе он зарегистрирован БЕЗ `--force` — steady-state уважает админ-правки). Подробности — `docs/operations/prod-deploy-log.md`.

> **Примечание к verified-таблице выше:** строки `gpt-4o` и `ollama:qwen3.5:9b` помечены ⚠ «выведена» по итогам этой нормализации. Сами каналы технически живы (smoke проходит), но в дефолтные `LlmTaskRoute.providers` их закладывать нельзя.

## Стоимость и телеметрия LLM (2026-06-05)

> Реализовано ТЗ `plans/tz/2026-06-05-llm-cost-safety-and-telemetry-retention.md` (ветка `sergdev`). Закрывает риски #4 и #5 техаудита: расход стал управляемым (enforce за флагом) и видимым (метрика unpriced), рост телеметрии ограничен с сохранением истории стоимости. Схему БД не трогали (`OrgBudgetCap.capKind` уже был, превью уже nullable).

- **Метрика «цена не заполнена» (видимость `costUsd=0`).** `computeCostUsd` ([llm-router.service.ts](../../backend/src/modules/ai/services/llm-router.service.ts)) для модели вне прайс-карты (нет ни в БД `LlmModelPrice`, ни в `MODEL_PRICES`) теперь пишет `logger.warn` + инкрементит `llm_cost_unpriced_total{provider,model}` (раньше — тихий `logger.debug` + `costUsd=0`, расход был невидим). Это наблюдаемость, а не «фикс цен» — цены редактирует админ.
- **Budget guard (pre-dispatch).** Новый `BudgetGuardService` ([ai/services/budget-guard.service.ts](../../backend/src/modules/ai/services/budget-guard.service.ts)) вызывается из `LlmRouter.call` ПЕРЕД dispatch (после dataClass-фильтра). Оценивает MTD-расход тенанта: сумма `AiUsageLog.costRub` за UTC-месяц (один источник-колонка — согласованность с алертом), in-memory-кэш TTL `llm.budget.mtd_cache_ttl_sec` (code-fallback 60с). Блокирует (`LlmBudgetExceededError`) **только** при флаге `llm.budget.enforce_enabled` (AdminSetting, **дефолт OFF**) И `OrgBudgetCap.capKind='hard'` И MTD≥cap; иначе **observe** — метрика `llm_budget_exceeded_total{mode}` (`observe`|`enforce`) + WARN «would block», dispatch продолжается. **Best-effort fail-open**: любая ошибка в guard (включая недоступность FX) НЕ роняет LLM-вызов — ложная блокировка хуже редкого пропуска. `tenantId=null` (system-jobs) не лимитируется. **Дефолт OFF = ноль изменений поведения** до явного включения владельцем (развилка Р-1 ТЗ: block/degrade/alert — путь A построен за флагом, решение перед включением).
- **Retention `AiUsageLog` (two-tier).** Новый `AiUsageLogCleanupService` ([ai/services/ai-usage-log-cleanup.service.ts](../../backend/src/modules/ai/services/ai-usage-log-cleanup.service.ts)), self-scheduling раз в час (паттерн `LogCleanupService`: `setInterval`+`unref`, `pg_try_advisory_lock` single-flight, батчи по 5000). **Tier-1** гасит превью (`requestPreview`/`responsePreview` → NULL) для строк старше `llm.usage_log.scrub_previews_after_days` (code-fallback 30д) — убирает основной объём (2×8КБ/строка), сохраняя тонкую cost-строку для экономики. **Tier-2** удаляет строки старше `llm.usage_log.delete_after_days` (code-fallback 365д, > самого длинного окна `computeForOrg`). Идемпотентно (повторный прогон = 0 изменений).
- **Прод-деплой.** AdminSetting-ключи через `getDynamic` с code-fallback → выкат БЕЗ сидов безопасен. Детали — `docs/operations/prod-deploy-log.md` (блок «Безопасность стоимости LLM + retention телеметрии»).

## Каналы, которые НЕ работают / не используем

| Канал | Причина | Что делать |
|---|---|---|
| **anthropic** (claude-sonnet-4-6, claude-haiku-4-5-20251001, claude-opus-4-7) | `ANTHROPIC_API_KEY` в `.env` невалиден (32 символа, формат KIE-ключа вместо `sk-ant-…`). По решению владельца — **Claude в Z не используем**, ключ не закупаем. | Не предлагать как primary и не закладывать в fallback. Сервис `AnthropicService` остаётся в коде на случай, если когда-нибудь решат подключить — но в дефолтных `LlmTaskRoute.providers` его быть не должно. |
| **embeddings via Ollama** (`bge-m3` на `ollama.agent-lia.ru`) | На `ollama.agent-lia.ru` модели `bge-m3` физически нет — только `qwen3.5:9b` и `kwangsuklee/Nanbeige4.1-3B.Q4_K_M:latest`. | С **2026-06-30** embeddings идут через `embeddinggemma:latest` (768 dim) на собственном шлюзе `https://llm.korateam.ru/v1` (`LocalEmbeddingService`, primary). `bge-m3` нигде не закладываем. Если потребуется `bge-m3` — DevOps делает `ollama pull bge-m3` на нужном инстансе и повторный smoke. |
| **ollama** (`qwen3:30b-a3b-instruct-2507`) | На нашем инстансе не установлена. Везде, где плейбук упоминает «qwen3:30b-a3b-instruct-2507» — читать как «qwen3.5:9b». | Использовать `qwen3.5:9b`. |
| **ollama** (`kwangsuklee/Nanbeige4.1-3B.Q4_K_M:latest`) | Установлена, но отвечает пустой строкой при выходе 256 токенов (формат-несовместимость с OpenAI-compat chat). | Не использовать. |

## Обязательные правила вызова

1. **Всегда через `LlmRouterService.call({ ... })`** — не дёргать `DeepSeekService.complete()`/`OpenAiProxyService.complete()` напрямую. Router добавляет fallback-chain, `AiUsageLog`, метрики, `dataClass`-фильтр.
2. **`tenantId` обязателен** для любого LLM-вызова (см. [llm-router.md](llm-router.md)).
3. **Модель НЕ хардкодить в коде воркера**. Дефолт берётся из `LlmTaskRoute.providers` (БД). Override через `params.model` — только для бенчмарков.
4. **`max_tokens` ≥ 256** для reasoning-моделей (`deepseek-v4-pro`, `gpt-5*`) — бюджет на скрытое рассуждение. Иначе ответ приходит пустым. См. урок в [plans/analysis/2026-05-21-llm-smoke-test.md](../../plans/analysis/2026-05-21-llm-smoke-test.md).
5. **reasoning effort:**
   - `gpt-5`, `gpt-5-mini`, `gpt-5-nano` — допускают `'minimal'|'low'|'medium'|'high'`.
   - `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5.5` — **только** `'none'|'low'|'medium'|'high'` (без `'minimal'` — `OpenAiProxyService` сейчас шлёт `'medium'` по умолчанию, для smoke было поправлено).
6. **Anthropic-провайдеры (`anthropic`) не добавлять в дефолты.** В коде сервис есть, но любой `LlmTaskRoute.providers` со строкой `'anthropic'` будет ронять задачу с 401.
7. **Embeddings → `embeddinggemma:latest` (768 dim) через `llm.korateam.ru/v1`** (primary, `LocalEmbeddingService`). Fallback на `text-embedding-3-small` (1536 dim) через `proxy.agent-lia.ru`. `bge-m3` не используется.
8. **KIE / GRSAI через `LlmRouter` доступны c 2026-05-25.** Подключены как полноценные провайдеры (`KieService`/`GrsaiService` в `LlmRouter`), управление маршрутами — через `/admin/llm-routes` и `/admin/ai-models/[taskType]`. Перед использованием — прогнать `bun scripts/seed-default-llm-providers-and-models.ts`, чтобы записи `LlmProvider{name:'kie'/'grsai'}` и связанные `LlmModel` появились в БД. **Кэш не пробрасывается** (см. раздел B) — экономику считать по полной цене ввода.
9. **DeepSeek-V4 (ВСЕ модели, включая `deepseek-v4-flash`) НЕ поддерживают `response_format: json_schema`** — ни strict, ни нестрогий: `400 «This response_format type is unavailable now»`. Forced/required `tool_choice` тоже не работает («Thinking mode does not support this tool_choice»), даже на flash (у V4 thinking-ограничения на всех моделях). Рабочих пути ровно два: `json_object` + слово «json» в промпте, ИЛИ `tools + tool_choice='auto'`. Для caller-кода прозрачно: `DeepSeekService.buildParams` для ЛЮБОЙ модели конвертирует `responseFormat: json_schema` в виртуальный `tool` + hint, а для `json_object` гарантирует слово «json» (`ensureJsonWord`). Метрика — `z_deepseek_schema_to_tool_conversion_total{model}`. Эмпирика (probe 2026-06-03, 8 комбинаций) — `backend/scripts/eval/probe-deepseek-formats.ts` (param `PROBE_MODEL`). Ранее заметка касалась только `deepseek-v4-pro`; probe на flash показал, что ограничение общее для V4.

## Готовые образцы вызова (для копи-пейста)

Минимальные snippet'ы для каждого канала. Полные обёртки уже реализованы в `backend/src/modules/ai/services/*.ts` — здесь только для случая, когда нужен прямой вызов вне Nest (smoke, эксперимент, скрипт).

### 1. OpenAI via proxy (Responses API)

```ts
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: process.env.PROXY_BASE_URL ?? 'https://proxy.agent-lia.ru/v1',
  apiKey: `${process.env.PROXY_PREFIX ?? 'myFeedproxy3128'}:${process.env.OPENAI_API_KEY}`,
});

const response = await (client as any).responses.create({
  model: 'gpt-5.4-mini',
  stream: false,
  instructions: 'Ты ассистент. Отвечай кратко.',
  input: [{ role: 'user', content: 'Москва — столица РФ?' }],
  max_output_tokens: 1024,
  reasoning: { effort: 'low' }, // 'low' для gpt-5.4*, 'minimal' можно только для gpt-5/5-mini/5-nano
});

const text = response.output_text ?? '';
```

### 2. DeepSeek (direct, OpenAI-compat chat/completions)

```ts
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1',
  apiKey: process.env.DEEPSEEK_API_KEY,
});

const response = await client.chat.completions.create({
  model: 'deepseek-v4-flash',
  stream: false,
  max_tokens: 256,
  messages: [
    { role: 'system', content: 'Ты ассистент. Отвечай кратко.' },
    { role: 'user', content: 'Москва — столица РФ?' },
  ],
});

const text = response.choices?.[0]?.message?.content ?? '';
```

### 3. MiniMax (Anthropic-compat)

```ts
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.MINIMAX_API_KEY,
  baseURL: process.env.MINIMAX_BASE_URL ?? 'https://api.minimax.io/anthropic',
});

const message = await client.messages.create({
  model: 'MiniMax-M2.5',
  max_tokens: 256,
  system: 'Ты ассистент. Отвечай кратко.',
  messages: [{ role: 'user', content: 'Москва — столица РФ?' }],
});

const text = message.content
  .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
  .map((b) => b.text)
  .join('');
```

### 4. Ollama self-hosted (OpenAI-compat)

```ts
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: process.env.OLLAMA_BASE_URL ?? 'https://ollama.agent-lia.ru/v1',
  apiKey: process.env.OLLAMA_API_KEY || 'sk-local-test-20260319',
});

const response = await client.chat.completions.create({
  model: 'qwen3.5:9b', // единственная установленная chat-модель
  stream: false,
  max_tokens: 256,
  messages: [
    { role: 'system', content: 'Ты ассистент. Отвечай кратко.' },
    { role: 'user', content: 'Москва — столица РФ?' },
  ],
});
```

### 5. Gemini через grsai (через прокси, SSE-стрим)

```ts
const url = `${process.env.PROXY_BASE_URL?.replace(/\/v1$/, '') ?? 'https://proxy.agent-lia.ru'}/grsai/v1/chat/completions`;
const resp = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.PROXY_PREFIX ?? 'myFeedproxy3128'}:${process.env.GRSAI_API_KEY}`,
  },
  body: JSON.stringify({
    model: 'gemini-3-pro',
    stream: true,
    max_tokens: 256,
    messages: [
      { role: 'system', content: 'Ты ассистент. Отвечай кратко.' },
      { role: 'user', content: 'Москва — столица РФ?' },
    ],
  }),
});
// Парсинг SSE — см. collectSse() в backend/scripts/smoke-llm-providers.ts
```

### 6. Embeddings (OpenAI через прокси)

```ts
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: process.env.PROXY_BASE_URL ?? 'https://proxy.agent-lia.ru/v1',
  apiKey: `${process.env.PROXY_PREFIX ?? 'myFeedproxy3128'}:${process.env.OPENAI_API_KEY}`,
});

const response = await client.embeddings.create({
  model: 'text-embedding-3-small',
  input: ['строка 1', 'строка 2'], // батч до 100
});

const vectors = response.data.map((d) => d.embedding); // dim=1536
```

## Как переверифицировать карту

```bash
cd backend && bun scripts/smoke-llm-providers.ts
```

Опционально ограничить:
```bash
bun scripts/smoke-llm-providers.ts --only=deepseek,openai-via-proxy
bun scripts/smoke-llm-providers.ts --skip=kie-gemini
```

После прогона:
- JSON-отчёт → `backend/tmp/llm-smoke-<timestamp>.json`.
- Если статус модели изменился (✓ ↔ ✗) — обнови этот файл + дату `verified_at` в frontmatter.
- Если появилась новая работающая модель — добавь строку в Verified-таблицу + образец вызова.

## Связанные документы

- [llm-models-playbook.md](../../docs/reference/llm-models-playbook.md) — целевая политика дефолтов, цены, fallback chains
- [llm-router.md](llm-router.md) — реализация маршрутизации в коде
- [02_architecture/ai-integration.md](../02_architecture/ai-integration.md) — общая карта AI-интеграций
- [plans/analysis/2026-05-21-llm-smoke-test.md](../../plans/analysis/2026-05-21-llm-smoke-test.md) — методология и результаты прогона
- [backend/scripts/smoke-llm-providers.ts](../../backend/scripts/smoke-llm-providers.ts) — сам smoke-test
