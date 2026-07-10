# ТЗ: починка структурной выемки LLM (forced tool_choice + thinking-модели + фолбэк)

- **Дата:** 2026-07-10
- **Тип:** фикс-контракт (реализуется на отдельной ветке от `dev`).
- **Основание:** аудит [2026-07-10-llm-routing-full-agent-verification.md](2026-07-10-llm-routing-full-agent-verification.md) + ультра-оркестрация `ww943hm9y` (125 агентов, 72 adversarial-вызова) + прод-логи/каталог.
- **Симптом владельца:** с ~29 июня не создаётся ни одной задачи после встреч/чатов; граф не достраивается.

---

## 1. Что доказано (входные факты)

1. **forced tool_choice → HTTP 400 «Thinking mode does not support this tool_choice» на ВСЕХ моделях DeepSeek** (и pro, и flash) — endpoint `api.deepseek.com/v1` держит v4 в thinking-режиме. Работает только `tool_choice:'auto'`. Репро: `scratchpad/repro-block-linker.ts`, подтверждено 6 доменами оркестрации.
2. **`isThinkingModel()` ([llm-thinking-models.ts](../../backend/src/modules/ai/services/llm-thinking-models.ts)) мисклассифицирует `deepseek-v4-flash`** (эвристика `includes('pro')`) → `canForce=true` ([deepseek.service.ts:149-156](../../backend/src/modules/ai/services/deepseek.service.ts#L149)) → на flash шлётся forced → 400. pro спасён (имя матчит thinking).
3. **Само-лечение:** 400 → `LlmFormatNotSupportedError` → retry `auto` + memoize `forceUnsupportedModels` ([deepseek.service.ts:52-63](../../backend/src/modules/ai/services/deepseek.service.ts#L52)). Поэтому большинство flash-задач в проде «ok» (лишний 400-round-trip + тихая деградация).
4. **Реально падают в проде 4 задачи** (flash+json_schema поверх которых лежит `validate`-callback): `block-linker`, `entity-graph-builder`, `probe-quality-judge`, `probe-value-gate`. Каскад доходит до фолбэка `kie:gemini-3.1-pro` → тоже `validate`-fail → все провайдеры исчерпаны.
5. **flash → pro НЕ нужен** — adversarial 72 вызова, разрыв 0; flash в ~3–12× дешевле и ~6× быстрее. **Модель не меняем.**
6. **Фолбэк-слой деградировал независимо:** `openai-via-proxy` = 429 (квота), `kie:gemini-3.1-pro` = validate-fail/«пустой ответ» (каталог smoke). Gemini function-calling не переваривает nullable-union (`type:['string','null']`) и `null`-в-enum.
7. **Диагностический пробел:** на `validate`-fail код НЕ логирует фактический `out.text`/`finish_reason` → точный триггер для малых схем (intake) не пойман (локально не воспроизводится, прод падает).
8. **max_tokens:** thinking-модели тратят бюджет на `reasoning_content`; big-схемы (`block-ingest`, вывод 6-8KB) при тесном `max_tokens` (напр. 2000) → `finish=length` → обрезка → битый JSON → validate-fail.

---

## 2. Фазы фикса

### Фаза 0 — Диагностика (первой, обязательна)
Добавить структурный лог на границе `validate`-fail и на обрезке:
- В [llm-router.service.ts:1683-1690](../../backend/src/modules/ai/services/llm-router.service.ts#L1683) (ветка `params.validate && !params.validate(out.text)`): логировать `taskType`, `provider`, `model`, `finishReason` (пробросить из адаптера в `LlmCompleteOutput`), `out.text.slice(0,300)`, `toolCallPresent`, `textLen`. Уровень WARN, без PII (только голова).
- В `deepseek.service.ts mapResponse` — если `finish_reason==='length'` или args не распарсились: WARN с `finishReason`, `argsLen`, `model`, `taskType?`.
- **Цель:** следующий прод-прогон покажет ТОЧНУЮ причину провала малых схем (обрезка / `{raw}` / не-tool / отказ). Это добивает пункт 7.

### Фаза 1 — Корень: убрать forced tool_choice для DeepSeek (Fix A + B)
- **A:** дефолт `ai.deepseek.forceToolChoiceEnabled` → **false** ([typed-config.service.ts:244-248](../../backend/src/common/config/typed-config.service.ts#L244) + [env.schema.ts:112](../../backend/src/common/config/env.schema.ts#L112) `LLM_DEEPSEEK_FORCE_TOOL_CHOICE_ENABLED zBool(false)`). Раз прокси отвергает forced для ВСЕХ моделей DeepSeek — это не заплатка, а корректный дефолт. Реестр флагов — строка (kill-switch, ON=не форсить).
- **B:** `isThinkingModel()` — распознавать все `deepseek-v4*` (в т.ч. flash) как thinking → `canForce=false`, код перестаёт «врать». Юнит на классификатор. Оба — независимо достаточны; делаем оба.
- **Приёмка:** прогнать оркестрационные репро (`scratchpad/repro-*.ts`) — ни одного forced→400; `block-linker`/`entity-graph`/`probe-*` под auto дают валидный вывод.

### Фаза 2 — Фолбэк-резилиенс (gemini/kie)
- Санитизация схем под function-calling Gemini/kie: `type:['string','null']` → `type:'string'` + пометка nullable в description; убрать `null` из `enum`. Место — [kie-native.adapter.ts](../../backend/src/modules/ai/services/protocol-adapter/adapters/kie-native.adapter.ts) (или общий `toGeminiToolSchema`-util). Приёмка — gemini/kie возвращает валидный tool_call на схемах block-linker/intake.
- `openai-via-proxy` 429 — **ops** (пополнить квоту / временно исключить из цепочки); в код не входит, строка в prod-инструкцию.

### Фаза 3 — Бюджет токенов под thinking
- Для структурных экстракторов с большим выводом (`block-ingest` и подобные) — поднять `max_tokens`, чтобы reasoning+вывод влезали; ловить `finish_reason==='length'` → один retry с увеличенным бюджетом (крутилка). Значения — в AdminSetting (не хардкод). Приёмка — `block-ingest` на реальном окне не даёт `finish=length`.

### Фаза 4 — Смежное (отдельные строки, не блокеры корня)
- `chapters` — legacy `ollama:qwen3.5:9b` путь (заменён на `meeting-report-fast`): убрать/перерулить.
- `probe-formulate` — primary=pro, но фолбэк дал невалидный вывод: разобрать по диаг-логам Фазы 0.
- `MessageOutboxRelayWorker: re-enqueue упал` (каждые 30с), `AI_ANALYSIS ON CONFLICT` — разобрать отдельно.
- S3 `QuotaExceeded` — инцидент INC-2026-07-09-01 (ops).

---

## 3. Границы
- **Модель НЕ меняем** (flash остаётся; pro доказательно не нужен).
- Реестр провайдеров/адаптеров (`USE_PROTOCOL_ADAPTER_REGISTRY`) не трогаем в рамках хотфикса — корректная разводка legacy/adapter отдельным ТЗ.
- Всё под крутилки (AdminSetting/ENV), не хардкод; строки в реестр флагов + prod-deploy-log.

## 4. Приёмка (definition of done)
1. Фаза 1: 0 forced→400 в репро; 4 broken-forced задачи дают валидный вывод под auto (стенд).
2. Фаза 0 задеплоена → следующий прод-прогон показывает фактический вывод на любом остаточном validate-fail.
3. Фаза 2: gemini/kie возвращает валидный tool_call на санитизированных схемах.
4. typecheck/lint/build/тесты зелёные; юниты на isThinkingModel + schema-sanitize.
5. Реестр флагов + prod-deploy-log обновлены.

## 5. Статус
- [ ] Фаза 0 · [ ] Фаза 1 (A+B) · [ ] Фаза 2 · [ ] Фаза 3 · [ ] Фаза 4
