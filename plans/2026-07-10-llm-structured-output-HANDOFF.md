# HANDOFF: фикс структурной выемки LLM (forced tool_choice / thinking) — 2026-07-10

**Кому:** следующему агенту-разработчику. **Ветка:** `fix/2026-07-10-llm-structured-output` (от `dev`).
**Статус:** Фазы 0+1 сделаны, верифицированы, закоммичены и запушены. Фазы 2-4 — на тебе. Плюс добить один честно-непойманный остаток.

**Источники (прочитай первыми):**
- [ТЗ верификации](tz/2026-07-10-llm-routing-full-agent-verification.md) — как проверяли все 166 агентов.
- [Фикс-ТЗ](tz/2026-07-10-llm-structured-output-fix.md) — контракт фикса (фазы 0-4).
- Ультра-оркестрация `ww943hm9y` (journal.jsonl в session subagents) — health-матрица 125 агентов + adversarial.
- Репро-скрипты: `<scratchpad>/repro-block-linker.ts`, `repro-entity-conformance.ts`, `repro-intake.ts`, `diag-content-vs-tool.ts`, `repro-guarded.ts`, `repro-nomax.ts` (в session scratchpad; шаблон — ниже §5).

---

## 1. Что за проблема (симптом владельца)
С ~29 июня **не создаётся ни одной задачи** после встреч/чатов и **не достраивается граф**. Отчёты встреч (свободный текст) работают (`ai_ready`), а всё структурное (задачи/рёбра/сущности на строгих JSON-схемах) молча падает.

## 2. Доказанный корень
- Endpoint DeepSeek (`api.deepseek.com/v1`, протокол OpenAI Chat — см. `/admin/ai/catalog`) держит **ВСЕ v4-модели** (и flash, и pro) в **thinking-режиме**. `forced tool_choice` → **HTTP 400 «Thinking mode does not support this tool_choice»**. Работает только `tool_choice:'auto'`.
- `isThinkingModel()` ([llm-thinking-models.ts](../backend/src/modules/ai/services/llm-thinking-models.ts)) определял thinking по имени (`includes('pro')`) → **`deepseek-v4-flash` мисклассифицирован** как non-thinking → `canForce=true` ([deepseek.service.ts:149-156](../backend/src/modules/ai/services/deepseek.service.ts#L149)) → форс → 400.
- Само-лечение ([deepseek.service.ts:52-63](../backend/src/modules/ai/services/deepseek.service.ts#L52)): 400 → `LlmFormatNotSupportedError` → retry `auto` + memoize. Поэтому большинство flash-задач в проде «ok» (с лишним 400-кругом). **Падают 4**, где поверх лежит `validate`-callback: `block-linker`, `entity-graph-builder`, `probe-quality-judge`, `probe-value-gate` → каскад до исчерпанного фолбэка `kie:gemini-3.1-pro` (тоже validate-fail) → «все провайдеры упали».
- Совпадение по времени: конец июня — `feat(llm): реестр провайдеров боевой по умолчанию (Ship-On)` (`921df594`) + переход на thinking-модели.

## 3. ВЕРДИКТ flash→pro: pro НЕ нужен (доказано)
Adversarial (72 вызова, равные условия `auto`): flash valid JSON = pro, семантика совпала **до десятой**; flash ~3-12× дешевле, ~6× быстрее. **Модель НЕ меняем.** Кандидатов на pro — нет. (Оговорка: входы были короткие/чистые, не 30-мин шумный ASR — там теоретически возможен разрыв, текущими прогонами НЕ обнаружен.)

## 4. Что УЖЕ СДЕЛАНО (Фазы 0+1, верифицировано)
**Файлы (diff +53/−12):**
1. [llm-thinking-models.ts](../backend/src/modules/ai/services/llm-thinking-models.ts) — `+ if (lower.includes('deepseek-v4')) return true;` → все `deepseek-v4*` thinking → `canForce=false`. + тест.
2. [env.schema.ts:112](../backend/src/common/config/env.schema.ts#L112) + [typed-config.service.ts:244-248](../backend/src/common/config/typed-config.service.ts#L244) — `LLM_DEEPSEEK_FORCE_TOOL_CHOICE_ENABLED` дефолт `true`→`false`.
3. [llm-router.service.ts](../backend/src/modules/ai/services/llm-router.service.ts) (validate-fail ветка) — WARN `LlmRouter: validate-fail — фактический вывод провайдера` с `textHead`/`textLen` (диагностика).
4. [deepseek.service.ts](../backend/src/modules/ai/services/deepseek.service.ts) `mapResponse` — WARN на `finish_reason==='length'` или битом tool-call JSON.
5. `deepseek.service.spec.ts` — тесты форса приведены к non-thinking `deepseek-chat`; добавлен guard-тест `flash+флаг ON → 'auto'`.

**Верификация (всё зелёное):** `bun run typecheck` · `bunx vitest run` по `llm-thinking-models.spec` (3) · `deepseek.service.spec` (12) · `llm-router.service.spec`+`tier-fallback`+`registry-parity` (66) · `openai-chat.adapter.spec` (6).
**Доки:** `docs/operations/feature-flags.md` (строка флага), `docs/operations/prod-deploy-log.md` (блок выката).

## 5. Что ОСТАЛОСЬ (твои задачи)

### Фаза 2 — фолбэк-резилиенс (gemini/kie)
Gemini function-calling через kie не переваривает **nullable-union** (`type:['string','null']`) и **`null`-в-enum** → «пустой ответ» (видно в `/admin/ai/catalog` → KIE smoke). Санитизировать схему под Gemini в [kie-native.adapter.ts](../backend/src/modules/ai/services/protocol-adapter/adapters/kie-native.adapter.ts) (или общий `toGeminiToolSchema`-util): `type:['string','null']`→`type:'string'`+nullable в description; убрать `null` из `enum`. Приёмка — gemini/kie отдаёт валидный tool_call на схемах `block-linker`/`intake`. **Примечание:** после Фазы 1 цепочка почти не доходит до фолбэка (primary deepseek снова отвечает), поэтому приоритет средний.
> ⚠️ Замечание: смотри провайдер-реестр — `USE_PROTOCOL_ADAPTER_REGISTRY` (env.schema `zBool(true)`, но комментарий в [llm-router.service.ts:1994](../backend/src/modules/ai/services/llm-router.service.ts#L1994) говорит «default false»). Проверь РАНТАЙМ-значение в проде: от него зависит, идёт ли kie через `kie-native.adapter` (реестр) или `this.kie.complete()` (legacy `kie.service.ts`). Санитайз клади в реально-живой путь.

### Фаза 3 — бюджет токенов под thinking
Thinking-модели тратят бюджет на `reasoning_content`. Big-схемы (`block-ingest`, вывод 6-8KB) при тесном `max_tokens` (напр. `BLOCK_INGEST_MAX_TOKENS_PER_SEGMENT`=2000) → `finish=length` → обрезка → битый JSON → validate-fail (репро агента `kc-extract` в journal). Поднять бюджеты структурных экстракторов (крутилки AdminSetting, НЕ хардкод); ловить `finish==='length'` → 1 retry с бóльшим бюджетом. Приёмка — `block-ingest` на реальном окне без `finish=length`.

### Фаза 4 — смежное (отдельными строками)
- `chapters` — legacy `ollama:qwen3.5:9b` (заменён на `meeting-report-fast`): перерулить/убрать.
- `probe-formulate` — primary=pro, но фолбэк дал невалидный вывод (broken-other) — разобрать по диаг-логам.
- `MessageOutboxRelayWorker: re-enqueue упал` (каждые 30с), `AI_ANALYSIS ON CONFLICT` — отдельно.
- Ops: `openai-via-proxy` 429 (квота), S3 `QuotaExceeded` (инцидент INC-2026-07-09-01).

### ⚠️ Честно-непойманный остаток (добить через диаг-логи Фазы 0)
`entity-graph-builder`/`intake-auto-triage` падают в проде на `validate`, но **локально не воспроизводятся**: против того же `api.deepseek.com` тем же кодом/схемой/валидатором/guard/без-max — всё проходит 4/4–5/5 (см. репро). Значит остаётся прод-рантайм-фактор (реальные крупные входы / AdminSetting reasoningEffort / точная задеплоенная ревизия). **Фаза 0 (диаг-логи) уже в фиксе** — после выката следующий прогон покажет фактический `out.text`/`finishReason`. Первым делом: `diag.ts logs --search "validate-fail" --json` → смотри `textHead` (обрезка? `{raw}`? отказ? не-tool?). Опционально: SSH read-only (см. `docs/operations/prod-ssh-access.md`) снять задеплоенную ревизию + рантайм-флаги (`USE_PROTOCOL_ADAPTER_REGISTRY`, `LLM_DEEPSEEK_FORCE_TOOL_CHOICE_ENABLED`, `reasoningEffort`).

## 6. Как проверить, что всё работает (чеклист приёмки)
1. **Стенд (offline, реальные ключи в `.env`):** прогнать репро-шаблон на 4 broken-задачах — `flash+auto` должен давать валидный tool_call (0 forced→400). Шаблон:
   ```
   const c = new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: process.env.DEEPSEEK_BASE_URL });
   // взять РЕАЛЬНУЮ json_schema из caller'а, tools:[{type:function,function:{name:'submit_x',parameters:SCHEMA}}], tool_choice:'auto'
   // прогнать deepseek-v4-flash и deepseek-v4-pro; проверить, что arguments парсятся в нужную форму
   ```
2. **Юниты:** `cd backend && bunx vitest run src/modules/ai/services/` — deepseek/llm-router/thinking/adapter зелёные.
3. **typecheck/lint/build:** `bun run typecheck && bun run lint && bun run build`.
4. **Прод (после выката, read-only):** `diag.ts usage --task entity-graph-builder --limit 20` → `ok` на deepseek-v4-flash; `diag.ts logs --at-least WARN --search "Thinking mode"` → пусто (форс ушёл); свежая встреча → `intake-auto-triage` без FAIL, задачи создаются; `diag.ts meetings` → новая встреча даёт задачи.
5. **Прод-хаб:** обновить `docs/testing/README.md` (карта: `entity-graph-builder`/`block-linker` ❌→✅ после выката) + журнал лог-прогонов.

## 7. Границы
- Модель НЕ меняем (flash остаётся). Реестр адаптеров (`USE_PROTOCOL_ADAPTER_REGISTRY`) не трогаем в хотфиксе. Всё под крутилки, не хардкод. Push — по явному подтверждению владельца.
