---
type: tz
status: ready-to-implement
feature: chat-v2-dataclass-routing-fallback
date: 2026-06-29
owner: Сергей (svmazur)
relates_to:
  - plans/analysis/2026-06-29-assistant-unavailable-chat-v2-dataclass-routing.md
---
> Анализ: `plans/analysis/2026-06-29-assistant-unavailable-chat-v2-dataclass-routing.md` · Решения владельца согласованы 2026-06-29.

# ТЗ — Помощник «временно недоступен»: DeepSeek-first для всех классов данных + крутилка таймаута KIE

## Цель
Устранить отказ помощника «Помощник временно недоступен» на синтезе ответа (`taskType=chat-v2`), когда вопрос вытягивает приватные/чувствительные блоки памяти. Сделать DeepSeek первым провайдером для **всех** классов данных (включая `private`), вернуть рабочую цепочку резерва `DeepSeek → OpenAI → KIE`, и вынести захардкоженный 60-сек таймаут KIE в admin-крутилку со значением 180 c.

## Зачем (болезненное состояние)
2026-06-29 владелец получил в Telegram «Помощник временно недоступен». Корень (подтверждён кодом и прод-логами, см. анализ §3): `chat-v2` передаёт в роутер `dataClass` извлечённых блоков; роутер фильтрует провайдеров по `PROVIDER_CAPABILITY.maxDataClass` ([llm-router.service.ts:1573](backend/src/modules/ai/services/llm-router.service.ts#L1573)). У `deepseek` и `openai-via-proxy` `maxDataClass='internal'`, у `kie` — `'private'`. Для `private`/`sensitive`-вопросов DeepSeek и OpenAI **отфильтровываются**, в активной цепочке `chat-v2` остаётся единственный `kie` (ollama-резерв inactive, anthropic в маршруте нет). KIE завис на 60 c ([kie.service.ts:14](backend/src/modules/ai/services/kie.service.ts#L14)) → резерва нет → `llm_error` → текст «недоступен» ([assistant-channel.bridge.ts:71](backend/src/modules/concierge/services/assistant-channel.bridge.ts#L71)).

## REALITY-CHECK (факт на 2026-06-29, проверено read-only через супер-админ API + код)
- `PROVIDER_CAPABILITY` читается **ровно в одном месте** — [llm-router.service.ts:1575](backend/src/modules/ai/services/llm-router.service.ts#L1575) (фильтр eligibility). Поле `localOnly` в коде backend **не читается нигде** (только объявлено). → правка значений `maxDataClass` изолирована по потребителю, но влияет на eligibility во **всех** taskType (это и есть желаемое «DeepSeek первый везде»).
- `DataClassPolicyService` ([dataclass-policy.service.ts:220](backend/src/modules/knowledge-core/services/dataclass-policy.service.ts#L220)) — **отдельная** система (egress-каналы/синки, поле `sink.maxDataClass` в БД), на `PROVIDER_CAPABILITY` не завязана. Подъём провайдеров до `private` её НЕ трогает.
- Маршрут `chat-v2` в проде уже `DeepSeek(primary,deepseek-v4-pro) → OpenAI(secondary,gpt-5.4) → KIE(tertiary,gemini-3.1-pro)`; `ollama` tertiary — `isActive=false`; эксперимента нет. Т.е. **порядок цепочки менять не нужно** — нужно зафиксировать и не дать ре-сиду его сломать.
- ⚠️ **Расхождение сид↔прод:** [seed-llm-task-routes-knowledge-core.ts:134](backend/scripts/seed-llm-task-routes-knowledge-core.ts#L134) для `chat-v2` задаёт primary `deepseek-v4-**flash**`, а в проде primary = `deepseek-v4-**pro**`. Источник правды по решению владельца — `deepseek-v4-pro`. Реконсилировать сид, иначе повторный прогон может понизить модель.
- `knowledge.chatV2SynthesisTimeoutMs` — **уже** крутилка: registry-валидатор [admin-setting-schema-registry.ts:77](backend/src/modules/admin/settings/admin-setting-schema-registry.ts#L77) (`POSITIVE_INT`), резолв [typed-config.service.ts:702](backend/src/common/config/typed-config.service.ts#L702) `resolveSync('knowledge.chatV2SynthesisTimeoutMs', undefined, 90_000)`, чтение [chat-v2.service.ts:1078](backend/src/modules/knowledge-core/services/chat-v2.service.ts#L1078). Дефолт 90 c режется таймаутом KIE 60 c.
- Таймаут KIE — захардкожен: [kie.service.ts:14](backend/src/modules/ai/services/kie.service.ts#L14) `private readonly timeoutMs = 60_000;`, применяется [kie.service.ts:186](backend/src/modules/ai/services/kie.service.ts#L186) `AbortSignal.timeout(this.timeoutMs)`. `KieService` уже инжектит `TypedConfigService` (читает `this.cfg.ai.kie.apiKey/baseUrl`, [typed-config.service.ts:269](backend/src/common/config/typed-config.service.ts#L269)).
- Шаблон сида admin-настроек с идемпотентностью + защитой admin-edited: [seed-admin-setting-router-fallback.ts](backend/scripts/seed-admin-setting-router-fallback.ts) (`category:'ai', section:'router'`).

## Принятые решения владельца (2026-06-29 — не пересматривать)
| # | Решение | Обоснование |
|---|---|---|
| Б1 | `deepseek` и `openai-via-proxy` → `maxDataClass:'private'` в `PROVIDER_CAPABILITY` | Делает DeepSeek eligible+primary для всех классов, цепочка резерва работает для любого вопроса. Приватность в деприоритете — то же основание, по которому KIE подняли до `private` ([llm-router.service.ts:1013](backend/src/modules/ai/services/llm-router.service.ts#L1013)). |
| Б2 | Цепочка `chat-v2`: DeepSeek → OpenAI → KIE (KIE крайним) | KIE самый нестабильный (таймауты + битый JSON, бил сегодня и `strategic-alignment`, и `block-ingest`) → последним резервом. Совпадает с текущим прод-конфигом. |
| Б3 | Таймаут KIE = 180 c, через крутилку AdminSetting (`getDynamic`/`resolveSync` + code-fallback) | Правило 9 CLAUDE.md (крутилка, не константа). 180 c покрывает медленные-но-живые ответы; короче 300 c, чтобы не держать пользователя 5 минут. |
| Б4 | KIE остаётся тёртичным резервом | После Б1 KIE почти не задействуется (только если DeepSeek И OpenAI оба упали). Стабилизация/замена KIE — отдельная задача (см. «Не входит»). |

## Доказательство выбора
Продуктовая развилка (Вариант A: поднять DeepSeek/OpenAI до private; Вариант B: оставить фильтр + локальный резерв ollama/anthropic) разобрана в анализе §6; владелец выбрал A. Реализационные альтернативы:
- **Где менять eligibility:** (A) код-константа `PROVIDER_CAPABILITY` vs (B) перенести в БД/AdminSetting. Выбор — A: константа имеет единственного потребителя, БД-перенос — отдельный крупный рефактор без запроса. `[ASSUMPTION: оставляем константой; вынос в БД — vNext, если понадобится per-tenant data-residency]`.
- **Как читать таймаут KIE:** (A) `resolveSync` на старте (как `chatV2SynthesisTimeoutMs`) vs (B) `getDynamic` пер-вызов (live-edit без рестарта). Выбор — A: единообразно с существующей крутилкой таймаута chat-v2, проще; цена — admin-изменение применяется после рестарта (приемлемо для таймаута). `[ASSUMPTION: resolveSync; если нужна live-правка — заменить на getDynamic в complete()]`.

## Scope
**Входит:** Б1 (PROVIDER_CAPABILITY), Б3 (крутилка таймаута KIE + согласование chatV2SynthesisTimeoutMs), реконсиляция сида маршрута chat-v2 (flash→pro, фиксация цепочки), регистрация нового сида в `apply-prod-deploy.ts`.
**Не входит (vNext / отдельные ТЗ):**
- Видимая ошибка в кабинетном чате при `llm_error` (сейчас чат молчит; в Telegram текст есть) — UX-задача, отдельным ТЗ.
- Стабилизация/замена провайдера KIE (таймауты + ежечасный битый JSON; бьёт `strategic-alignment`, `block-ingest`) — отдельным ТЗ.
- Качество recall (промах ретрива по синонимам; «встречи»→`list_my_events`) — отдельным анализом.
- Шаг подтверждения «да/нет» для write-действий в кабинетном concierge — отдельный вопрос.

## Требования (EARS)
- **R1** — Когда роутер фильтрует провайдеров по dataClass для запроса класса `private` или `sensitive`, система shall оставлять `deepseek` и `openai-via-proxy` в списке eligible.
- **R2** — Если в цепочке `chat-v2` для запроса любого класса данных доступен `deepseek`, then первым диспатчится `deepseek` (primary), и только при его падении — `openai-via-proxy`, затем `kie`.
- **R3** — Таймаут вызова KIE shall браться из admin-крутилки `ai.kie.timeoutMs` с code-fallback 180000 мс; захардкоженной константы `60_000` в `kie.service.ts` быть не должно.
- **R4** — `knowledge.chatV2SynthesisTimeoutMs` code-fallback shall быть ≥ 180000 мс (не меньше таймаута KIE).
- **R5** — Сид маршрута `chat-v2` shall задавать primary `deepseek/deepseek-v4-pro` (не `deepseek-v4-flash`); повторный прогон сида = no-op для уже применённых значений и не трогает admin-edited записи.
- **R6** — Новый seed admin-настройки shall быть зарегистрирован в `apply-prod-deploy.ts` `STEPS`; повторный прогон идемпотентен.

## Фаза 1 — PROVIDER_CAPABILITY: DeepSeek/OpenAI до `private`
**Ценность:** как сотрудник, задающий помощнику вопрос по чувствительным данным компании, получаю ответ от стабильного DeepSeek (а не отказ от зависшего KIE), потому что DeepSeek теперь eligible для приватного класса.
**Картография:** [llm-router.service.ts:1006-1016](backend/src/modules/ai/services/llm-router.service.ts#L1006) (`PROVIDER_CAPABILITY`), единственный потребитель — [:1575](backend/src/modules/ai/services/llm-router.service.ts#L1575).
**Что входит:** изменить две строки —
```ts
'openai-via-proxy': { maxDataClass: 'private', localOnly: false },
deepseek: { maxDataClass: 'private', localOnly: false },
```
(было `'internal'`). Обновить пояснительный комментарий рядом (как у `kie`: «поднят до private — решение владельца 2026-06-29, приватность в деприоритете»).
**Что НЕ входит:** изменение `minimax`/`grsai`/`anthropic`/`ollama`; вынос capability в БД.
**Зависимости:** нет (первая фаза).
**Acceptance (машинные):**
- `grep -n "deepseek: { maxDataClass: 'private'" backend/src/modules/ai/services/llm-router.service.ts` → 1 совпадение; то же для `'openai-via-proxy': { maxDataClass: 'private'`.
- Юнит-тест (vitest) на `llm-router`: для `effectiveDataClass='private'` и списка `[deepseek, openai-via-proxy, kie]` функция фильтра возвращает все три (deepseek первым). Негативный кейс прежнего поведения (deepseek отфильтрован при private) должен быть удалён/инвертирован — обновить существующий `llm-router*.spec.ts`, проверить что нет красных тестов на старое поведение.
- `cd backend && bun run typecheck && bun run lint` зелёные.
**Закрывает:** R1, R2.

## Фаза 2 — Крутилка таймаута KIE (180 c) + согласование chatV2 timeout
**Ценность:** как компонент LLM-роутинга, получаю таймаут KIE из admin-настройки, чтобы менять его без релиза и чтобы синтез не обрывался раньше времени.
**Картография:** [kie.service.ts:14](backend/src/modules/ai/services/kie.service.ts#L14), [:186](backend/src/modules/ai/services/kie.service.ts#L186); [typed-config.service.ts:269](backend/src/common/config/typed-config.service.ts#L269) (`ai.kie`), [:702](backend/src/common/config/typed-config.service.ts#L702) (`chatV2SynthesisTimeoutMs`, образец `resolveSync`); registry [admin-setting-schema-registry.ts:77](backend/src/modules/admin/settings/admin-setting-schema-registry.ts#L77); сид-образец [seed-admin-setting-router-fallback.ts](backend/scripts/seed-admin-setting-router-fallback.ts).
**Что входит (5 точек правила 9):**
1. **typed-config:** в блоке `ai.kie` ([:269](backend/src/common/config/typed-config.service.ts#L269)) добавить
   ```ts
   timeoutMs: this.resolveSync<number>('ai.kie.timeoutMs', undefined, 180_000),
   ```
   (тип `ai.kie` расширить полем `timeoutMs: number`).
2. **kie.service:** убрать константу `private readonly timeoutMs = 60_000;` ([:14](backend/src/modules/ai/services/kie.service.ts#L14)); в [:186](backend/src/modules/ai/services/kie.service.ts#L186) использовать `this.cfg.ai.kie.timeoutMs`.
3. **registry:** добавить `['ai.kie.timeoutMs', POSITIVE_INT],` в `admin-setting-schema-registry.ts`.
4. **seed:** новый `backend/scripts/seed-admin-setting-kie-timeout.ts` по образцу router-fallback: `{ key:'ai.kie.timeoutMs', value:180000, category:'ai', section:'router', severity:'low', description:'Таймаут (мс) вызова провайдера KIE. По умолчанию 180000 (180 c).' }`. Использовать `createPrismaClient()` из `scripts/_lib/prisma.ts`. Защита admin-edited — как в образце.
5. **UI:** добавить поле для `ai.kie.timeoutMs` в admin-страницу AI-настроек (раздел роутера/провайдеров). Найти существующий клиент admin-настроек категории `ai` (например под `frontend/app/(admin)/admin/ai/*` или страница, где уже редактируются `router.*`/провайдерские крутилки) и добавить числовое поле; UI — только русский, без английских слов.
**Также:** поднять code-fallback `chatV2SynthesisTimeoutMs` с `90_000` до `180_000` ([typed-config.service.ts:705](backend/src/common/config/typed-config.service.ts#L705)).
**Что НЕ входит:** изменение глобального `LLM_ROUTER_DISPATCH_TIMEOUT_MS` (дефолт 300 c — уже ≥180); перевод на `getDynamic` (см. ASSUMPTION).
**Зависимости:** нет (независима от Фазы 1, но логически в одном выкате).
**Acceptance (машинные):**
- `grep -n "60_000" backend/src/modules/ai/services/kie.service.ts` → 0 совпадений.
- `grep -n "ai.kie.timeoutMs" backend/src/modules/admin/settings/admin-setting-schema-registry.ts backend/src/common/config/typed-config.service.ts backend/scripts/seed-admin-setting-kie-timeout.ts` → совпадения во всех трёх.
- `grep -n "180_000" backend/src/common/config/typed-config.service.ts` → ≥2 (kie.timeoutMs + chatV2SynthesisTimeoutMs fallback).
- Повторный прогон `bun run scripts/seed-admin-setting-kie-timeout.ts` → второй раз `created=0` (идемпотентность).
- `cd backend && bun run typecheck && bun run lint && bun run build` зелёные; `cd frontend && bun run typecheck && bun run lint` зелёные.
**Закрывает:** R3, R4.

## Фаза 3 — Реконсиляция сида маршрута chat-v2 + регистрация в прод-агрегаторе
**Ценность:** как компонент маршрутизации, гарантирую, что повторный сид не понизит primary `chat-v2` с pro на flash и не сломает порядок DeepSeek→OpenAI→KIE.
**Картография:** [seed-llm-task-routes-knowledge-core.ts:134-140](backend/scripts/seed-llm-task-routes-knowledge-core.ts#L134); `STEPS` в [apply-prod-deploy.ts](backend/scripts/apply-prod-deploy.ts) (фаза `seed-llm-routes`/`seed-llm-core`).
**Что входит:**
- В сид-маршруте `chat-v2` primary-модель `deepseek-v4-flash` → `deepseek-v4-pro`; secondary `openai-via-proxy/gpt-5.4`, добавить tertiary `kie/gemini-3.1-pro` (чтобы сид отражал реальную целевую цепочку, а не только 2 провайдера). Проверить логику апсерта сида: не перетирать `editedByAdmin`-записи (safe-seed).
- Зарегистрировать `seed-admin-setting-kie-timeout.ts` (Фаза 2) в `apply-prod-deploy.ts` `STEPS` с верной `phase` и `skipBootstrap` по образцу соседних `seed-admin-setting-*`.
**Что НЕ входит:** массовая перезапись всех маршрутов; изменение других taskType.
**Зависимости:** Фаза 2 (нужен файл сида для регистрации).
**Acceptance:**
- `grep -n "deepseek-v4-pro" backend/scripts/seed-llm-task-routes-knowledge-core.ts` в блоке `chat-v2`; `grep -n "deepseek-v4-flash" …` в блоке `chat-v2` → 0.
- `grep -n "seed-admin-setting-kie-timeout" backend/scripts/apply-prod-deploy.ts` → 1.
- Повторный прогон сида маршрутов = no-op для существующих (проверить вывод `inserted/updated/skipped`).
**Закрывает:** R5, R6.

## Границы фичи
- **✅ Always:** менять только перечисленные `path:line`; держать UI на русском; сиды идемпотентны и не трогают `editedByAdmin`.
- **⚠️ Ask first:** любое изменение `maxDataClass` у провайдеров, кроме `deepseek`/`openai-via-proxy`; любое расширение scope на другие taskType.
- **🚫 Never:** `new PrismaClient()` в сидах (только `createPrismaClient()`); `prisma migrate*`; `process.env.*` мимо `env.schema.ts`; mass overwrite маршрутов; вынос приватности/data-residency как темы (деприоритет).

## Pre-mortem / Риски и ревью-аспекты (для strict-production-review-gate)
- **Б1 — глобальный blast-radius:** подъём deepseek/openai до `private` влияет на eligibility во ВСЕХ taskType, не только chat-v2. Это намеренно (DeepSeek-first везде), но ревью обязано подтвердить, что нет taskType, где `internal`-ограничение использовалось как защита (искать использование `PROVIDER_CAPABILITY`/`maxDataClass` — подтверждено: единственный потребитель — фильтр роутера).
- **DataClassPolicyService:** отдельная egress-система — убедиться, что не путается с `PROVIDER_CAPABILITY` (разные источники: `sink.maxDataClass` из БД vs константа провайдера).
- **Таймаут 180 c и UX:** при зависшем KIE без резерва пользователь ждал бы до 180 c — но после Б1 KIE почти не первичен; ревью проверяет, что цепочка реально пробует deepseek первым (R2).
- **Idempotency:** повторный прогон обоих сидов = no-op (acceptance Фаз 2–3).
- **Observability `[N/A]`:** новых воркеров/очередей нет; метрики роутера (`llm_router_dispatch_total`) уже покрывают фолбэк — отдельная метрика не требуется.
- **RBAC/tenant `[N/A]`:** правки глобальные (tenantId=null маршруты, код-константа) — tenant-границы не затрагиваются.
- **Тесты:** обновить `llm-router*.spec.ts` (Фаза 1); таймаут-крутилку покрыть проверкой чтения значения из cfg.

## Idempotency / prod-deploy
- Прод-операции после выката (детали — в `docs/operations/prod-deploy-log.md`, обновить Шаг 7 «seed-*»):
  - `docker compose exec backend bun run scripts/seed-admin-setting-kie-timeout.ts` (или через агрегатор `apply-prod-deploy.ts --mode update`).
  - `docker compose exec backend bun run scripts/seed-llm-task-routes-knowledge-core.ts` (реконсиляция chat-v2 primary).
- Флагов нет (правка значений/крутилка — не feature-flag). Ship-On: выкатывается включённым.

## DoD
- typecheck (вкл. `.spec`)/lint/build зелёные на backend и frontend; обновлённые `llm-router*.spec.ts` проходят.
- second-brain: обновить `02_architecture/` по LLM-роутингу/dataClass, если описан (свериться с таблицей производных заметок); `docs/operations/prod-deploy-log.md` Шаг 7 — новые сиды.
- Рефлексия в `second-brain/05_история/` после выката; запись в реестр `04_не-сделано` для вынесенных vNext (UX-ошибка в чате, стабилизация KIE, recall).
- Прод-инструкция в чат: diff команд (2 сида) со ссылкой на prod-deploy-log.

## Итог
_(заполнит tz-orchestrator по завершении: реализовано целиком/частично, что осталось.)_

## Follow-up (вне scope — зафиксировать в `04_не-сделано`)
1. Стабилизация/замена KIE (таймауты + ежечасный `validate caller'а`; бил `strategic-alignment`, `block-ingest`).
2. Видимая ошибка в кабинетном чате при `llm_error` (паритет с Telegram).
3. Recall-качество chat-v2 (синонимы; «встречи»→`list_my_events`).
