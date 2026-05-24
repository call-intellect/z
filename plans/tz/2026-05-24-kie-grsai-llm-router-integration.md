---
title: Интеграция KIE и GRSAI в LlmRouter — все модели через админку
status: partial
created: 2026-05-24
owner: backend
priority: high
estimate: 1.5–2 дня
depends_on:
  - second-brain/01_projects/llm-providers-verified.md
  - backend/scripts/smoke-llm-providers.ts
relates_to:
  - second-brain/01_projects/llm-router.md
  - docs/reference/llm-models-playbook.md
---

# ТЗ: KIE и GRSAI как полноценные провайдеры LlmRouter

## Цель

Подключить **KIE** (`api.kie.ai`) и **GRSAI** (через `proxy.agent-lia.ru/grsai/…`) как
провайдеры в `LlmRouter` так, чтобы любую посаженную в них модель (Gemini, Claude, GPT)
можно было назначить любому `LlmTaskType` через **админку `/admin/ai-models/[taskType]`**
без коммита кода и без деплоя.

После выполнения ТЗ владелец проекта может:
1. Зайти в `/admin/ai-models/dialog-multi-query`.
2. Поставить `kie/gemini-3-flash` на primary вместо `deepseek-v4-flash`.
3. Сохранить с reason — через ≤60 секунд (или мгновенно после `refreshCache`) новые
   вызовы `dialog-multi-query` уходят на Gemini через KIE.
4. По `AiUsageLog` сравнить качество/цену/latency с прежним вариантом и откатить
   одним кликом по истории `LlmTaskRouteChange`.

## Контекст / Почему сейчас

- 13 моделей уже посажены в маршруты через 5 провайдеров (`deepseek`,
  `openai-via-proxy`, `ollama`, `minimax`, `anthropic`).
- Через smoke-скрипт [smoke-llm-providers.ts](../../backend/scripts/smoke-llm-providers.ts)
  **дополнительно проверены работающими ещё 4 канала** KIE и 1 канал GRSAI
  (`gemini-3-pro`, `gemini-3.1-pro`, `claude-opus-4-7` через KIE, `gpt-5-4` через KIE,
  `gemini-3-flash` через KIE). Они отвечают, ключи валидны.
- Но провайдер-сервисов нет → через админку не выбираются → если хочется A/B Gemini
  против DeepSeek на каком-то агенте, нужно править код.
- Это противоречит принципу switchable endpoints, зафиксированному в
  [second-brain/01_projects/llm-providers-verified.md §«Обязательные правила вызова»](../../second-brain/01_projects/llm-providers-verified.md).

## Скоуп

В скоупе:
- Новые провайдеры `kie`, `grsai` в `LlmRouter`.
- 3 формата запроса для KIE: Claude (`/claude/v1/messages`), GPT
  (`/codex/v1/responses`), Gemini (`/${model}/v1/chat/completions`).
- 1 формат для GRSAI: OpenAI chat/completions SSE через прокси.
- Цены в [`MODEL_PRICES`](../../backend/src/modules/ai/services/model-prices.ts) для
  всех новых моделей.
- Реестр `LlmProvider` и `LlmModel` (БД) — добавить записи.
- Пример seed-маршрута: A/B на `dialog-multi-query` (deepseek primary,
  kie/gemini-3-flash secondary) — чтобы можно было сразу включить и поверить, что
  переключатель работает.
- Проверка в админке: новые провайдеры видны в `/admin/llm/providers`, модели — в
  `/admin/llm/models`, дроп-даун `/admin/ai-models/[taskType]` показывает выбор.
- DataClass-policy для новых провайдеров (см. `PROVIDER_CAPABILITY`).

Вне скоупа (отдельные ТЗ):
- Массовый перевод существующих taskType на Gemini/Claude — это решение про
  качество/цену, не про инфру.
- Retry-policy под нестабильность KIE (есть отдельная заметка в playbook §9).
- Multimodal (изображения/файлы через KIE) — пока только текст.
- Production-ready реализация всех KIE-форматов с edge-кейсами (vision, JSON-схема и
  т.д.) — пока минимально нужное для chat/completion.

## Архитектурное решение

### Где добавить код

```
backend/src/modules/ai/
├── services/
│   ├── kie.service.ts                ← НОВЫЙ. 3 метода под 3 формата KIE
│   ├── grsai.service.ts              ← НОВЫЙ. SSE-поток через прокси
│   ├── llm-router.service.ts         ← правки: enum, switch, capability
│   ├── model-prices.ts               ← правки: цены KIE/GRSAI моделей
│   └── ai.module.ts                  ← регистрация двух новых сервисов
└── ...

backend/scripts/
├── seed-llm-providers.ts             ← правки: +kie, +grsai
├── seed-llm-models.ts                ← правки: +новые модели
└── seed-llm-task-routes-kie-grsai-ab.ts  ← НОВЫЙ. Пример A/B на dialog-multi-query

backend/src/common/config/
└── env.schema.ts                     ← KIE_API_KEY, KIE_BASE_URL уже есть;
                                       проверить GRSAI_API_KEY, PROXY_BASE_URL
```

### Что меняется в `LlmRouter`

1. **Enum провайдеров.** В `LlmProviderName` ([llm-router.service.ts:349-354](../../backend/src/modules/ai/services/llm-router.service.ts#L349-L354)) добавить `'kie'`, `'grsai'`. В массив `ALL_PROVIDERS` — то же.

2. **Capability map.** В `PROVIDER_CAPABILITY` ([llm-router.service.ts:378-387](../../backend/src/modules/ai/services/llm-router.service.ts#L378-L387)):
   ```ts
   kie:   { maxDataClass: 'internal', localOnly: false },
   grsai: { maxDataClass: 'internal', localOnly: false },
   ```
   (Обе — внешние, до `internal`; `sensitive`/`private` через них не пускаем.)

3. **Конструктор `LlmRouterService`.** Инжектировать `KieService` и `GrsaiService` так же, как уже инжектятся `AnthropicService`/`DeepSeekService`/и т.д.

4. **Диспатч в `dispatchByProvider()`.** Добавить две ветки case для `'kie'` и `'grsai'`. Внутри `kie` — sub-диспатч по `modelName`: если начинается с `claude-` → claude-API, `gpt-` → codex-API, `gemini-` → direct-API.

### Что должен делать `KieService`

Три метода-обёртки, каждый принимает универсальный `LlmCallParams` (как у `DeepSeekService`) и возвращает `{ text, inputTokens, outputTokens, cachedTokens }`:

- `completeClaudeFormat(params)` → POST `${KIE_BASE_URL}/claude/v1/messages`, Anthropic-формат запроса (system + messages), Bearer-авторизация. Модели: `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-haiku-*` (если KIE их поддерживает — сверить в smoke).
- `completeGptFormat(params)` → POST `${KIE_BASE_URL}/codex/v1/responses`, OpenAI Responses-формат (`input` массив с `input_text`). Модели: `gpt-5-4`, `gpt-5-mini`, и др. (сверить смокой).
- `completeGeminiFormat(params)` → POST `${KIE_BASE_URL}/${modelSlug}/v1/chat/completions`, OpenAI chat/completions, модель в URL. Модели: `gemini-3-pro`, `gemini-3-flash`, `gemini-3.1-pro`.

Внутри сервиса — диспатчер `complete(params)`, который по `params.model` решает, какой из трёх форматов использовать. Прозрачно для роутера: тот вызывает `kie.complete(params)` и не знает про внутренние форматы.

### Что должен делать `GrsaiService`

Один метод `complete(params)`. SSE-поток через прокси, парсинг по образцу `collectSse()` из smoke-скрипта ([smoke-llm-providers.ts:464-504](../../backend/scripts/smoke-llm-providers.ts#L464-L504)). Модели: `gemini-3-pro`, `gemini-3.1-pro`.

### Цены (для `AiUsageLog`)

В `MODEL_PRICES` добавить (сверить с актуальными тарифами `kie.ai` — пока заглушки из публичных цен Gemini/Claude):

```ts
// KIE Claude
'claude-opus-4-7':         (уже есть, $15/$75 — считается ок)
// KIE GPT
'gpt-5-4':                 { inputPer1M: ?, outputPer1M: ? }   // сверить с kie.ai
// KIE/GRSAI Gemini
'gemini-3-pro':            (уже есть в коде, $0.5/$3.5)
'gemini-3.1-pro':          (уже есть в коде, $0.5/$3.5)
'gemini-3-flash':          { inputPer1M: ?, outputPer1M: ? }   // сверить
```

Если цена 0/неизвестна — оставляем 0 (роутер не упадёт, см. fallback в `calcCostUsd`), но в `AiUsageLog` будут нули → дашборд экономики недостоверен. Идеально — закрыть до merge.

## Фазы

### Фаза 1 — `KieService` + регистрация в роутере (8–10 ч)

- [x] Создать `backend/src/modules/ai/services/kie.service.ts` с тремя методами под 3 формата + универсальный `complete(params)` с диспатчем по модели.
- [x] Добавить `'kie'` в `LlmProviderName`, `ALL_PROVIDERS`, `PROVIDER_CAPABILITY`.
- [x] Инжектировать `KieService` в `LlmRouterService` (конструктор + `dispatchByProvider`).
- [ ] Покрыть unit-тестом 3 happy-path (Claude-format, GPT-format, Gemini-format) с моком `fetch` — по образцу `deep-seek.service.spec.ts`, если такой есть; иначе по vitest-паттерну `ai/services/*.spec.ts`.
- [x] `bun run typecheck` + `bun run lint` в `backend/` — без ошибок.
- [ ] Smoke: `bun scripts/smoke-llm-providers.ts --only=kie-claude,kie-gpt,kie-gemini-direct,kie-gemini` — все ✓.

DoD фазы: код собирается, тесты зелёные, smoke проходит, но провайдер ещё не в админке.

### Фаза 2 — `GrsaiService` (3–4 ч)

- [x] Создать `backend/src/modules/ai/services/grsai.service.ts` с одним методом `complete(params)` (SSE-парсинг).
- [x] Добавить `'grsai'` в `LlmProviderName`, `ALL_PROVIDERS`, `PROVIDER_CAPABILITY`.
- [x] Инжектировать в `LlmRouter`, добавить ветку диспатча.
- [ ] Unit-тест happy-path с моком SSE.
- [ ] Smoke: `bun scripts/smoke-llm-providers.ts --only=grsai-gemini` — ✓.

DoD фазы: то же, что у фазы 1, плюс GRSAI.

### Фаза 3 — Реестр провайдеров/моделей и цены (3–4 ч)

- [ ] Дополнить `seed-llm-providers.ts`: запись `LlmProvider` для `kie`, `grsai` с `displayName`, описанием, capability.
- [ ] Дополнить `seed-llm-models.ts`: записи `LlmModel` для всех verified-моделей в B-разделе verified-карты (см. таблицу). Привязка к соответствующим провайдерам.
- [ ] Цены в `MODEL_PRICES` для новых SKU (`gemini-3-flash`, `gpt-5-4` через KIE, и т.п.). Где тариф неясен — пометить `// TBD — сверить с kie.ai` и оставить 0.
- [ ] Прогнать seed: `bun scripts/seed-llm-providers.ts && bun scripts/seed-llm-models.ts`.
- [ ] Проверить в админке вручную:
  - [ ] `/admin/llm/providers` показывает `kie` и `grsai`.
  - [ ] `/admin/llm/models` показывает модели KIE/GRSAI с правильной привязкой.
  - [ ] `/admin/llm-prices` — цены подхватились (где TBD — нули, это ок до сверки).

DoD фазы: админка показывает новые провайдеры и модели, можно их выбирать в маршрутах.

### Фаза 4 — Пример A/B-маршрута + ручная проверка (2–3 ч)

- [ ] Создать `backend/scripts/seed-llm-task-routes-kie-grsai-ab.ts`:
  - taskType `dialog-multi-query`: primary `deepseek/deepseek-v4-flash` (как сейчас), secondary `kie/gemini-3-flash`, tertiary `ollama/qwen3.5:9b`.
- [ ] Прогнать seed.
- [ ] В админке `/admin/ai-models/dialog-multi-query` визуально проверить, что цепочка отображается, можно переключить primary на Gemini одним кликом, виден `LlmTaskRouteChange`.
- [ ] **Ручной end-to-end тест:** через `/admin/ai-models/dialog-multi-query` → primary = `kie/gemini-3-flash` → отправить вопрос в chat-v2 («Какие у нас были решения по найму за месяц?») → убедиться, что в `AiUsageLog` появилась запись с `provider='kie'`, `model='gemini-3-flash'`, `tier='primary'`, токены > 0.
- [ ] Откатить primary обратно на `deepseek`, проверить, что новый маршрут активен ≤60 сек (или мгновенно после `refreshCache`).

DoD фазы: переключатель в админке реально работает, viewer (=владелец) убеждается своими глазами на одном агенте.

### Фаза 5 — Документация и закрытие (1–2 ч)

- [ ] Обновить `second-brain/01_projects/llm-providers-verified.md`:
  - Перенести верифицированные строки из раздела B в раздел A (с `В LlmRouter = ✓`).
  - Удалить правило №8 («KIE/GRSAI через LlmRouter не ходят») — больше не актуально.
- [ ] Обновить `second-brain/01_projects/llm-router.md` (если есть) — добавить описание новых веток диспатча.
- [ ] Обновить `docs/reference/llm-models-playbook.md` §2.1 — добавить KIE и GRSAI в политику дефолтов как опциональные A/B-каналы.
- [ ] В этом ТЗ итог `Реализовано целиком: да`, статус `done`.
- [ ] Рефлексия в `second-brain/05_история/2026-MM-DD-kie-grsai-llm-router.md`.

DoD фазы: документация синхронна с кодом, ТЗ закрыто.

## Риски и митигации

| Риск | Митигация |
|---|---|
| KIE-каналы нестабильны (`kie-gemini` уже был timeout 60s) | Не делать KIE primary без retry-лестницы; в фазе 4 ставим secondary, primary остаётся `deepseek`. Длинная retry-лестница `[3000, 6000, 10000, 15000]ms` — отдельная задача (см. playbook §9), не блокирует это ТЗ. |
| Цены kie.ai неизвестны → `AiUsageLog` пишет 0 | Помечаем явно `TBD` в `MODEL_PRICES`. До production-A/B на больших объёмах — сверить тарифы и обновить. |
| KIE-форматы отличаются между моделями (claude vs codex vs gemini) | `KieService` инкапсулирует диспатч по `model`. Роутер не знает про внутренние URL — только зовёт `kie.complete(params)`. |
| Утечка ключа KIE в логах | Никогда не логировать `Authorization: Bearer …`. Использовать paтtern `pino`-логгера, как в существующих сервисах (см. `DeepSeekService`). |
| `dataClass='sensitive'` или `'private'` уйдёт на KIE | `PROVIDER_CAPABILITY.kie.maxDataClass = 'internal'` → роутер автоматически скипнет провайдер для sensitive/private. Это уже встроенная защита. |
| Существующий `kwangsuklee/Nanbeige4.1-3B…` ломает smoke | Не в скоупе — отдельно. |

## Зависимости

- ENV: `KIE_API_KEY`, `KIE_BASE_URL` (есть в `env.schema.ts`); `GRSAI_API_KEY`, `PROXY_BASE_URL` (есть).
- БД: миграция не нужна — `LlmProvider`/`LlmModel`/`LlmTaskRoute` уже в схеме.
- Без миграций Prisma. Только seed-скрипты (см. правила [prisma-db-push-rules](../../.claude/skills/prisma-db-push-rules/) — db push не требуется).

## Итог реализации

_(заполнить после выполнения)_

- Реализовано целиком: **TBD**
- Что осталось: **TBD**
- Ссылка на коммиты: **TBD**
- Ссылка на рефлексию: **TBD**

## Ревизия от 2026-05-24

**Статус:** partial
**Реализовано:**
- Фаза 1: `backend/src/modules/ai/services/kie.service.ts` с диспатчем по префиксу модели (claude-/gpt-/gemini-) и retry [500/1000/2000] на 429/5xx; зарегистрирован в `ai.module.ts` как provider.
- Фаза 2: `backend/src/modules/ai/services/grsai.service.ts` (SSE-парсер через прокси с fallback на direct grsaiapi.com).
- Enum + capability в `llm-router.service.ts`: `'kie'`/`'grsai'` добавлены в `LlmProviderName` (стр. 406-407), `ALL_PROVIDERS` (стр. 415-416), `PROVIDER_CAPABILITY` (`maxDataClass='internal'`), dispatch ветки case (стр. 1123-1125).
- Цены частично: `claude-opus-4-7` ($15/$75), `gemini-3-pro` ($0.5/$3.5), `gemini-3.1-pro` ($0.5/$3.5) в `model-prices.ts`.
- ENV ключи KIE_API_KEY/KIE_BASE_URL/GRSAI_API_KEY/PROXY_BASE_URL в `env.schema.ts`.
- Коммит pre-session (унаследован): `73a0fa0 chore(ai): inherited pre-session — KIE + GRSAI`.

**Осталось:**
- Фаза 1: unit-тесты `kie.service.spec.ts` (3 happy-path: claude/gpt/gemini форматы) и smoke-прогон `--only=kie-*` после ENV-конфига.
- Фаза 2: unit-тест `grsai.service.spec.ts` (SSE mock) и smoke `--only=grsai-gemini`.
- Фаза 3: seed-скрипты `seed-llm-providers.ts` / `seed-llm-models.ts` не дополнены записями `LlmProvider{name:'kie'}` и `LlmProvider{name:'grsai'}` + связанными `LlmModel` (поиск по slug 'kie'/'grsai' в backend/scripts/ ничего не нашёл). Без них админка `/admin/llm/providers` не покажет новые провайдеры.
- Фаза 3: цены `gemini-3-flash`, `gpt-5-4` в `MODEL_PRICES` отсутствуют — `AiUsageLog` будет писать $0 для этих SKU.
- Фаза 4: `backend/scripts/seed-llm-task-routes-kie-grsai-ab.ts` не создан — нет примера A/B для `dialog-multi-query`. Без него ручной end-to-end через админку не проверить.
- Фаза 5: документация `second-brain/01_projects/llm-providers-verified.md` не обновлена (раздел B → A), правило №8 не удалено; рефлексия не написана.
