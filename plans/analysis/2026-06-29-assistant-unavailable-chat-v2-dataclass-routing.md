---
type: analysis
status: ready-for-tz
feature: assistant-chat-v2-llm-routing-reliability
date: 2026-06-29
owner: Сергей (svmazur)
relates_to:
  - backend/src/modules/ai/services/llm-router.service.ts
  - backend/src/modules/ai/services/kie.service.ts
  - backend/src/modules/knowledge-core/services/chat-v2.service.ts
  - backend/src/modules/concierge/services/assistant-channel.bridge.ts
  - backend/scripts/seed-llm-task-routes-knowledge-core.ts
  - second-brain/02_architecture/knowledge-core.md
---

> Инцидент: 2026-06-29, владелец (svmazur@mail.ru) получил в Telegram «Помощник временно недоступен, попробуйте позже.» Расследование read-only: прод-логи (diag.ts), реестр LLM-вызовов (`/api/v1/admin/usage/calls`), конфиг маршрутов (`/api/v1/admin/ai-models/chat-v2`, `/api/v1/admin/llm-routes`, `/api/v1/admin/llm-model-experiments`), код роутера. Развилка по приватности — за владельцем (см. §6).

# Анализ — почему помощник ответил «временно недоступен» и как сделать так, чтобы это не повторялось

## 1. Симптом и где он рождается

«Помощник Кора» = модуль `concierge`; доставка владельцу — Telegram-бот (`assistant.inbound` job → `AssistantChannelBridge`). Текст `Помощник временно недоступен, попробуйте позже.` — это `TEXT_ERROR` в `assistant-channel.bridge.ts:71`, который показывается, когда `concierge.process()` отдаёт событие `error` (code `llm_error`). У дневной квоты — отдельный текст («Дневной лимит обращений исчерпан»), он тут НЕ при чём. То есть это всегда **техническая** ошибка LLM-вызова, а не «лимит обращений».

## 2. Хронология инцидента (traceId `job_assistant_inbound_cmpp6jfzb0000y1t1bfjjr844_684488091`, время UTC)

```
09:12:12  assistant.inbound: старт (канал telegram_bot)
09:12:46  ✓ LlmRouter dispatch success   ← препроцессинг (классификатор/ретрив/groundedness)
09:12:47  ✓ dispatch success
09:12:49  ✓ dispatch success
09:12:51  ✓ dispatch success
09:13:51  ⚠ KIE complete (no-status): The operation timed out.   ← ровно +60с
09:13:51  ⚠ LlmRouter dispatch failed: KIE: The operation timed out.
09:13:51  ✗ concierge clarify-resume askEphemeral failed (err: «все провайдеры упали для taskType=chat-v2: kie=KIE: The operation timed out.»)
09:13:51  → sendNotification eventType=chat.answer channels=[telegram_bot]  (ушёл текст «недоступен»)
09:13:51  assistant.inbound: успех (98946ms)
```

Препроцессинг прошёл; упал **финальный синтез ответа** (`taskType=chat-v2`, путь `concierge.service.ts → resumeClarify → chatV2.askEphemeral`).

## 3. Корневая причина (подтверждена кодом, НЕ гипотеза)

`chat-v2` зовётся стандартным `llm.call` (`knowledge-core/services/chat-v2.service.ts:1066`) и передаёт **`dataClass: effectiveDataClass`** — строжайший класс чувствительности извлечённых блоков памяти (`maxDataClass(contextBlocks)`, дефолт `internal`).

Роутер фильтрует провайдеров по dataClass (`llm-router.service.ts:1573`):
```ts
const filtered = providers.filter((entry) =>
  DATA_CLASS_RANK[PROVIDER_CAPABILITY[entry.provider].maxDataClass] >= DATA_CLASS_RANK[effectiveDataClass]);
```
`DATA_CLASS_RANK`: `public 0 < internal 1 < sensitive 2 < private 3` (`llm-router.service.ts:1023`).

`PROVIDER_CAPABILITY.maxDataClass` (`llm-router.service.ts:1006`):
| provider | maxDataClass | ранг |
|---|---|---|
| deepseek | internal | 1 |
| openai-via-proxy | internal | 1 |
| anthropic | sensitive | 2 |
| kie | **private** | 3 |
| ollama | private (localOnly) | 3 |

Маршрут `chat-v2` (источник правды — `/api/v1/admin/ai-models/chat-v2`, проверено read-only):
- primary `deepseek/deepseek-v4-pro` (active)
- secondary `openai-via-proxy/gpt-5.4` (active)
- tertiary `kie/gemini-3.1-pro` (active)
- tertiary `ollama/qwen3.5:9b` — **isActive=false**
- Эксперимента у chat-v2 **нет** (`llm-model-experiments?taskType=chat-v2` → `items:[]`). Единственный experiment — `dialog-multi-query`, status=draft, не запущен.

**Механизм отказа:** когда вопрос вытягивает блоки класса `sensitive`/`private`, фильтр выкидывает deepseek (internal) и openai (internal). Из активного маршрута остаётся **только `kie`** (ollama-резерв выключен, anthropic в маршруте нет). Запрос уходит в KIE **без какого-либо резерва**; KIE зависает → `LlmRouterAllProvidersFailedError` со списком из одного `kie` → `concierge` отдаёт `llm_error` → пользователь видит «недоступен».

Доказательство «вперемешку = зависит от класса данных» (реестр `usage --task chat-v2`):
- 09:13 chat-v2 `kie:gemini-3.1-pro` FAIL 60006ms (инцидент, id `cmqz03iqk0gbn01qo549y1fdp`, `experimentGroup:null`)
- 11:25 chat-v2 `deepseek:deepseek-v4-pro` OK 34092ms (мой тест по конкретной встрече — блоки `internal`, фильтр никого не убрал, отработал primary)
- 27.06 05:00 chat-v2 `kie:gemini-3.1-pro` FAIL 60004ms (тот же сценарий ранее — значит повторяющийся, не разовый)

Логически строго: чтобы в цепочке остался ТОЛЬКО kie, фильтр обязан был убрать deepseek+openai (internal), а это происходит лишь при `effectiveDataClass ≥ sensitive`. Значит вопрос-инцидент извлёк блоки `sensitive`/`private`.

Комментарий в коде (`llm-router.service.ts:1013`): «kie поднят до private (2026-06-05), т.к. стал универсальным tertiary; приватность сейчас в деприоритете — решение владельца». Т.е. KIE намеренно сделан единственным «private-capable» облачным провайдером, и он же — самый ненадёжный.

## 4. Усугубляющие факторы

- **Таймаут KIE = 60с, захардкожен** (`kie.service.ts:14` `timeoutMs = 60_000`, `AbortSignal.timeout`). Бьёт раньше, чем `knowledge.chatV2SynthesisTimeoutMs` (крутилка, дефолт 90_000, `typed-config.service.ts:702`) и раньше глобального `dispatchTimeoutMs` (дефолт 300_000). Нормальный синтез chat-v2 идёт ~30–50с — у самого края 60с.
- **KIE нестабилен в целом (2026-06-29):** жёсткие таймауты (08:03, 09:13, 11:04) + ежечасный `kie/gemini-3.1-pro: ответ не прошёл validate caller'а`. Тот же KIE сегодня уронил `strategic-alignment` (07:00–07:04: «пустой ответ / невалидный JSON») и `block-ingest` (00:00–00:02: «все окна LLM-извлечения провалились»).
- **DeepSeek жив и первичен везде, кроме приватных запросов:** реестр последних 60 вызовов — сплошь deepseek (block-linker/ingest/summary/axis-classify/chunk-context), ForecasterCron на `deepseek-v4-pro`. Проблема не в DeepSeek.
- **Маршруты переписываются в течение дня:** записи chat-v2 (и десятки других) имеют `updatedAt=2026-06-29T11:41:09` — массовый ре-сид/синк. В момент инцидента конфиг мог отличаться (нужно учесть при фиксации целевого состояния — закрепить детерминированно).
- **UX:** в кабинете при том же сбое чат просто молчит (нет видимой ошибки); в Telegram есть текст. Диалог владельца «Я не понимаю откуда эти вопросы» (29.06) в кабинете обрывается без ответа на последнее сообщение — тот же отказ.

## 5. Качество ответов (QA-наблюдения, прод, под аккаунтом владельца)

- Точный запрос по имени встречи → grounded-ответ с цитатами и тайм-кодами ✅ (deepseek, internal).
- Расплывчатый/синоним («молочный завод» вместо «молочные реки») → «не нашёл» (промах ретрива).
- «покажи встречи за неделю» → ушло в инструмент `list_my_events` (календарь, пусто), а не в записанные встречи → ложное «не найдено».
- Агентная запись (`assign_task`) в кабинете отработала корректно (исполнитель + относительный срок), но исполняется СРАЗУ — метка «требуется подтверждение» есть, а шаг «да/нет» только в Telegram-мосте.

## 6. Целевое состояние и развилка (нужно решение владельца)

Желание владельца: `chat-v2` — детерминированная цепочка **DeepSeek (всегда первый) → KIE (резерв) → ChatGPT (третий)**, без «сплита». Но детерминированный порядок сам по себе НЕ закрывает инцидент: для `sensitive`/`private`-вопросов deepseek/openai отфильтрует по dataClass независимо от порядка. Поэтому развилка:

- **Вариант A (приватность в деприоритете — согласуется с уже принятым по KIE):** поднять `deepseek` (и при желании `openai-via-proxy`) `maxDataClass` до `private` в `PROVIDER_CAPABILITY`. Тогда DeepSeek становится eligible+primary для ВСЕХ классов, цепочка работает как задумано, KIE — настоящий последний резерв. Это **решение владельца**: означает отправку `private`-данных компании в DeepSeek/OpenAI (облако). Просто и закрывает корень.
- **Вариант B (приватность важна):** оставить фильтр, но дать `private`-классу реальный резерв: включить `ollama/qwen3.5:9b` (локальный, private) как активный fallback в chat-v2 и/или добавить anthropic; параллельно — чинить/убирать KIE как «универсальный private tertiary». Сложнее, качество локального синтеза ниже.

Ортогонально к A/B (нужно в любом случае):
- **Таймаут:** вынести таймаут KIE (`kie.service.ts:14`, 60_000) в крутилку (AdminSetting, `getDynamic` + code-fallback, по правилу 9) и поднять до **180с**; согласовать `knowledge.chatV2SynthesisTimeoutMs` (≥180с). Решение владельца по значению — 180с (зафиксировано 2026-06-29).
- **Детерминизм маршрута:** убедиться, что ре-сид/синк в 11:41 не «плавает» — закрепить целевую цепочку как источник правды (seed + apply-prod-deploy STEPS).
- **KIE как риск:** оценить демоут/замену KIE (таймауты + битый JSON бьют и по strategic-alignment, block-ingest).

## 7. Поверхность правки (для ТЗ)

- `backend/src/modules/ai/services/llm-router.service.ts:1006` — `PROVIDER_CAPABILITY.maxDataClass` (Вариант A).
- `backend/src/modules/ai/services/kie.service.ts:14` — таймаут → крутилка, 180с.
- `backend/src/common/config/typed-config.service.ts:702` — `knowledge.chatV2SynthesisTimeoutMs` (≥180с).
- `LlmTaskRoute` chat-v2 — порядок цепочки (deepseek→openai/kie), активность ollama-резерва (Вариант B); правка через seed/patch, зарегистрировать в `backend/scripts/apply-prod-deploy.ts` STEPS (safe-seed: admin-editable данные — точечный патч, не mass overwrite).
- Реестр крутилок `backend/src/modules/admin/settings/admin-setting-schema-registry.ts` + сид + UI — для нового knob таймаута KIE.
- UX (опц.): видимая ошибка в кабинетном чате при `llm_error`.

## 8. Решения владельца (зафиксировано 2026-06-29)

1. **Приватность → Вариант A.** Поднять `deepseek` (и `openai-via-proxy`) `maxDataClass` до `private` в `PROVIDER_CAPABILITY`. DeepSeek становится eligible+primary для всех классов данных, включая приватные; цепочка резерва работает для любого вопроса. Осознанное решение владельца: `private`-данные компании допускаются в DeepSeek/OpenAI (согласуется с уже принятым деприоритетом приватности, ради которого KIE подняли до private).
2. **Порядок цепочки chat-v2 → DeepSeek → OpenAI → KIE** (KIE крайним резервом, т.к. самый нестабильный). Совпадает с текущим конфигом — менять порядок не нужно, нужно закрепить.
3. **Таймаут → 180с**, вынести таймаут KIE (`kie.service.ts:14`) из захардкоженной константы в крутилку AdminSetting (`getDynamic` + code-fallback, правило 9); согласовать `knowledge.chatV2SynthesisTimeoutMs ≥ 180_000`.
4. **KIE** остаётся тёртичным резервом (после Варианта A он почти не задействуется — только если DeepSeek И OpenAI оба упали). Стабилизация/замена KIE — отдельная задача ниже по приоритету (он также бьёт по `strategic-alignment`, `block-ingest`).

Статус: развилок нет → готово к написанию ТЗ.
