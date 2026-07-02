---
type: tz
status: ready-to-implement
feature: llm-providers-models-routing-admin
date: 2026-07-02
owner: tozixwot@gmail.com
relates_to:
  [
    plans/tz/2026-07-02-embedding-providers-crud.md,
    plans/tz/2026-06-20-config-knobs-to-admin-settings.md,
    plans/analysis/2026-06-20-config-env-vs-admin-settings-audit.md,
  ]
---
> Анализ: встроен (разделы REALITY-CHECK и «Доказательство выбора»; полный аудит — workflow-отчёт 5 картографов + критик от 2026-07-02). Статус согласования: 2026-07-02 — 4 HIGH-развилки закрыты владельцем (Б1–Б4).

# ТЗ: Управление LLM-провайдерами, моделями и маршрутизацией в супер-админке

## Цель
Сделать DB-реестр `LlmProvider`/`LlmModel` боевым источником правды о подключениях LLM: супер-админ добавляет/редактирует/удаляет провайдера (baseUrl, ключ — шифрованный, протокол, прокси-тумблер, модель по умолчанию, цены), автополучает список моделей через OpenAI-совместимый `GET /models`, и назначает «сервис → провайдер → модель» на едином экране маршрутизации. UI консолидируется в 2 экрана по образцу `/admin/ai/embeddings` и референс-скринов владельца.

## Зачем (болезненное состояние → решение)
Сейчас созданный в админке провайдер **никак не влияет на вызовы**: боевой dispatch — захардкоженный switch на 7 ENV-сервисов, DB-реестр спит за `USE_PROTOCOL_ADAPTER_REGISTRY=false`, enum провайдеров задублирован в 3 местах, модель в маршруте — свободная строка, автополучения `/models` нет нигде, прокси — россыпь ENV-спецслучаев, ключ `LlmProvider` хранится и отдаётся наружу открытым текстом, а UI размазан по 3 пересекающимся разделам с мёртвым кодом и битыми ссылками. Владелец: «нет возможности добавить/удалить провайдера, добавить модель, выбрать модель для операции, редактировать креды и стоимость; нет выбора напрямую/через proxy.agent-lia.ru; управление разрозненно».

## REALITY-CHECK (факт по коду на 2026-07-02; номера строк на момент написания — перед правкой перечитать)
- **Боевой dispatch** — legacy switch по `entry.provider` на 7 инжектированных сервисов; новый путь через `LlmProtocolAdapterRegistry`+`ProviderInfoResolver` включается только при `cfg.budget.useProtocolAdapterRegistry===true` (`USE_PROTOCOL_ADAPTER_REGISTRY`, default false) — [llm-router.service.ts:1914-1973](backend/src/modules/ai/services/llm-router.service.ts#L1914) (`dispatch`), [env.schema.ts:682](backend/src/common/config/env.schema.ts#L682).
- **DB-реестр уже существует**: `LlmProvider` ([schema.prisma:3106](backend/prisma/schema.prisma#L3106), name/baseUrl/protocolKind/capability/apiKeyEncrypted/defaultHeaders/globalRps/isActive/lastSmoke*/deletedAt), `LlmModel` (:3148, providerId+modelKey/category/contextWindow/verifiedAt), `LlmModelPrice` (:3066, Decimal-цены с effectiveFrom/To). CRUD: `admin-llm-providers.{controller,service}.ts`, `admin-llm-models.{controller,service}.ts`, `admin-prices.controller.ts` в `backend/src/modules/admin/economics/` и `admin/controllers/`.
- **Ключ НЕ шифруется и утекает**: `create`/`update` кладут `dto.apiKey` в `apiKeyEncrypted` как есть (без `CryptoService`) — [admin-llm-providers.service.ts:79,100](backend/src/modules/admin/economics/admin-llm-providers.service.ts#L79); `list()` маскирует (`hasApiKey`), но `getById()`/`create()`/`update()` возвращают сырую Prisma-строку с ключом в ответ API (:47-57,71-88,90-108). Эмбеддинг-аналог шифрует и маскирует всегда (`present()` в `admin-embedding-providers.service.ts:298`).
- **3 из 5 адаптеров игнорируют ProviderInfo**: `AnthropicMessagesProtocolAdapter`/`OllamaNativeProtocolAdapter` делегируют в `AnthropicService`/`MinimaxService`/`OllamaService`, читающие ENV — admin-правка baseUrl/ключа не действует ([anthropic-messages.adapter.ts:23-44](backend/src/modules/ai/services/protocol-adapter/adapters/anthropic-messages.adapter.ts#L23)). `CustomHttpProtocolAdapter` шлёт выдуманный JSON `{system,user,model,maxTokens}` на голый baseUrl ([custom-http.adapter.ts:34-42](backend/src/modules/ai/services/protocol-adapter/adapters/custom-http.adapter.ts#L34)); kie/grsai сеются именно с `custom-http` → их smoke **всегда фейлит** с ложными алертами.
- **`ProviderSmokeTestCron` УЖЕ боевой потребитель реестра**: каждые 30 мин обходит активных `llmProvider` через адаптеры БЕЗ проверки флага, пишет `lastSmoke*`, алертит супер-админов при failStreak≥3 ([provider-smoke-test.cron.ts:33,97-143](backend/src/modules/admin/economics/provider-smoke-test.cron.ts#L33)).
- **`buildFromEnv` резолвера знает только 5 провайдеров** (без kie/grsai) — [provider-info.resolver.ts:99-159](backend/src/modules/ai/services/protocol-adapter/provider-info.resolver.ts#L99).
- **Маршрутизация**: Prisma `LlmTaskRoute` ([schema.prisma:2109](backend/prisma/schema.prisma#L2109)) — tier-строки (`tier`+`providerName`+`model`+`priority`, `editedByAdmin`) приоритетнее legacy JSON `providers`; кэш в памяти, `@Cron(EVERY_MINUTE)` + немедленная инвалидация при setRoute ([llm-router.service.ts:1362-1457](backend/src/modules/ai/services/llm-router.service.ts#L1362)). Нет маршрута → хардкод `DEFAULT_FALLBACK_CHAIN` deepseek→openai-via-proxy→kie:gemini-3.1-pro (:1057). Org-overrides (`tenantId!=null`) не имеют ни одного writer'а и пропускаются кэшем — мёртвая колонка.
- **Enum 7 провайдеров захардкожен в 3 местах** ([llm-router.service.ts:978](backend/src/modules/ai/services/llm-router.service.ts#L978), [llm-routes/dto:5](backend/src/modules/admin/llm-routes/dto/llm-routes.dto.ts#L5), [ai-models/dto:5](backend/src/modules/admin/ai-models/dto/ai-models.dto.ts#L5)); модель в роутинге — свободная строка без валидации по каталогу; `KNOWN_MODELS` хардкодится на фронте ([admin-llm-route.ts:121](frontend/src/domain/admin-llm-route.ts#L121)).
- **Реестр taskType дырявый**: union 176 уникальных (+дубль `process-template-extract` в :112 и :278), массив `ALL_LLM_TASK_TYPES` = 175; `chat-summary` есть в union и в бою ([chat-summary.service.ts:103](backend/src/modules/messaging/services/chat-summary.service.ts#L103)), но отсутствует в массиве → невидим в админке.
- **Прокси**: `OpenAiProxyService` — OpenAI SDK на `PROXY_BASE_URL` (default `https://proxy.agent-lia.ru/v1`), ключ `${PROXY_PREFIX}:${OPENAI_API_KEY}` ([openai-proxy.service.ts:24-25](backend/src/modules/ai/services/openai-proxy.service.ts#L24)); `ANTHROPIC_USE_PROXY`→`ANTHROPIC_PROXY_URL`; grsai через прокси идёт на `${proxyRoot}/grsai/v1/chat/completions` ([grsai.service.ts:62-81](backend/src/modules/ai/services/grsai.service.ts#L62)). Единого переключателя нет.
- **UI**: `/admin/ai/routing` (обёртка legacy `AiModelsClient`) и `/admin/llm-routes` редактируют **одну таблицу** разными API/форматами; `/admin/ai/catalog` — 4 таба, CRUD-методы в api-слое есть, но UI **read-only** ([admin-llm-models.api.ts:40](frontend/src/api/admin-llm-models.api.ts#L40) не вызывается); мёртвый `ExperimentsClient`; кнопки «A/B-эксперименты» ведут в redirect-петлю; `SmokeTestClient` зовёт несуществующий `GET /api/v1/admin/ai/smoke-test/status` (тихий 404) и кнопки `openai`/`vox` из захардкоженного списка получают 404 от DB-driven бэка; `formatCostRub` хардкодит 90 ₽/$ при живом `CurrencyRateSyncCron` (ЦБ РФ).
- **Попутно сломано (НЕ чинится здесь, решение Б2)**: `LlmModelExperiment` рантаймом не читается — A/B из switch-primary не сплитует трафик ([ai-models.service.ts:143-161](backend/src/modules/admin/ai-models/ai-models.service.ts#L143)); `AiUsageLog.costRub` никогда не пишется → hard-cap бюджета (`llm.budget.enforce_enabled`) мёртв ([budget-guard.service.ts:50-56](backend/src/modules/ai/services/budget-guard.service.ts#L50)); `LlmFallbackService` — параллельный legacy-роутинг только для analyze.worker.
- **Сид протух**: `seed-default-llm-providers-and-models.ts` сеет 7 провайдеров (kie/grsai с фейковым `custom-http`) и мёртвые модели (gpt-4o, deepseek-chat, qwen3.5:9b, опечатка `gpt-5-4` с нулевыми ценами — она же в `MODEL_PRICES:44` рядом с настоящим `gpt-5.4`).
- **ASR (Vox)** — вне LLM-реестра: жёстко в transcribe.worker, costUsd=0. Эталон UI/паттерна — свежий `EmbeddingProvidersClient` + `admin-embedding-providers.*` (ТЗ 2026-07-02, реализовано целиком).
- Параллельных веток/PR на эту фичу нет (`git log --all --since="2 days"` — только embeddings/invite).

## Принятые решения владельца (2026-07-02 — не пересматривать)
| # | Решение | Обоснование (Почему) |
|---|---|---|
| Б1 | **DB-реестр — боевой источник**: чиним адаптеры и включаем `USE_PROTOCOL_ADAPTER_REGISTRY` по умолчанию (Ship-On); флаг остаётся kill-switch'ем отката на legacy-switch | Иначе «добавить провайдера» не работает end-to-end, реестр остаётся витриной, конфиг живёт в 3 местах. Smoke-cron уже гоняет адаптеры в бою — путь частично обкатан. CLAUDE.md принцип 8 (Ship-On). |
| Б2 | **A/B-рантайм (`LlmModelExperiment`) и экономика (`costRub`/hard-cap) — отдельные vNext-ТЗ**; здесь только скрыть вводящий в заблуждение A/B-UI | Держим ТЗ сфокусированным: роутинг+реестр+UI. Экономика тянет курс ЦБ и снапшоты цен — свой клубок. |
| Б3 | **UI = 2 экрана, legacy убить**: «Провайдеры и модели» (CRUD+discovery+smoke+цены) и «Маршрутизация» (единая таблица сервис→провайдер→модель); `/admin/llm-routes` и мёртвый код удаляются | Одно место правды, UX как на референс-скринах владельца; «переходный период» с дублями запрещён — он и есть текущая боль. |
| Б4 | **Прокси — тумблер у провайдера**: `useProxy Boolean` + `proxyPath String?`; эффективный baseUrl из `PROXY_BASE_URL`(ENV)+путь, ключ префиксуется `PROXY_PREFIX` | Ровно запрос владельца («выбор напрямую или через прокси»); endpoint прокси остаётся в ENV (правило «инфра-endpoint — ENV», CLAUDE.md принцип 9); одна строка на провайдера, без дублей моделей/цен. |

Производные решения автора ТЗ (следуют из Б1–Б4 и кода):
| # | Решение | Обоснование (Почему) |
|---|---|---|
| Б5 | Ключи `LlmProvider` шифруются `CryptoService` (AES-256-GCM) + маскирование `hasApiKey` во ВСЕХ ответах + idempotent patch шифрования существующих строк | Security-фикс: сейчас plaintext в БД и в ответах `getById/create/update`. Выравнивание с embedding-паттерном (`present()`). |
| Б6 | Дискавери моделей: `POST /api/v1/admin/llm-providers/:id/models/discover` → `GET {effectiveBaseUrl}/models`; импорт выбранных существующим `POST /api/v1/admin/llm-models` | Большинство провайдеров OpenAI-совместимы (запрос владельца). Один новый endpoint, импорт — существующим CRUD. Для `anthropic-messages` дискавери недоступен (нет `/models`). |
| Б7 | Валидация маршрутов по реестру: `providerName` в write-DTO проверяется против union(DB-реестр, legacy-7) на уровне сервиса; модель — мягкая валидация (warning, не блок) | Убирает тройной хардкод enum; новый DB-провайдер сразу доступен в роутинге. Мягкость по модели — модели может не быть в каталоге (свежая у провайдера). |
| Б8 | kie/grsai получают честные протоколы `kie-native`/`grsai-native` (адаптеры-обёртки над существующими сервисами с connection-override); фейковый `custom-http` больше не сеется | Убирает вечно-красный smoke и ложные алерты; при включении реестра kie/grsai работоспособны. `custom-http` остаётся для будущих простых OpenAI-совместимых нестандартных случаев. |
| Б9 | Все 5 делегирующих сервисов (`Anthropic/Minimax/Ollama/Kie/Grsai`) принимают опциональный connection-override `{baseUrl, apiKey, defaultHeaders, timeoutMs}`; адаптеры передают его из ProviderInfo | Единственный способ сделать admin-правку baseUrl/ключа действующей без переписывания сервисов с нуля; ENV остаётся фолбэком. |
| Б10 | `LlmProvider.defaultModelKey` — модель по умолчанию провайдера (когда её не задали ни вызов, ни маршрут); `timeoutMs` — переопределение hard-timeout dispatch | Закрывает «выбор модели для провайдера» из запроса; сейчас дефолты зарыты в ENV/код сервисов. [ASSUMPTION: per-provider temperature/maxTokens из референс-UI НЕ переносим — в Z это per-call семантика вызывающих сервисов.] |
| Б11 | Дефолт-цепочка становится крутилкой `llm.router.defaultChain` (AdminSetting, JSON) с code-fallback на `DEFAULT_FALLBACK_CHAIN` | CLAUDE.md принцип 9: выбор модели — крутилка, не хардкод. Редактируется на экране «Маршрутизация». |
| Б12 | dataClass-фильтр читает `capability` из ProviderInfo (DB) с фолбэком на хардкод-карту `PROVIDER_CAPABILITY`; `localOnly` у ollama остаётся в карте | Иначе новый DB-провайдер не проходит фильтр вообще. [ASSUMPTION: колонку `localOnly` не вводим — единственный случай.] |

## Доказательство выбора (Проход A vs B, свод)
Ось различия: **точка интеграции + модель данных**.

| Критерий | A: включить существующий реестр + честные адаптеры (выбран) | B: нормализация маршрутов на FK (providerId/modelId) + новый dispatch |
|---|---|---|
| Blast-radius на критичный chat-путь | ✓ dispatch-ветка уже существует, legacy-switch остаётся kill-switch-фолбэком | ✗ переписывание chooseProviders/refreshCache/61 seed-файла маршрутов |
| «Добавить провайдера из админки работает» | ✓ да (после фикса адаптеров) | ✓ да |
| Объём миграций данных | ✓ аддитивные поля + patch шифрования | ✗ backfill providerId/modelId во все LlmTaskRoute + смена контрактов DTO |
| Валидация модели по каталогу | ~ мягкая (warning) | ✓ жёсткая (FK) |
| Совместимость с seed-механикой маршрутов (editedByAdmin) | ✓ не трогаем | ✗ все сиды переписывать |
Итог: 4/5 за A. Жёсткость FK не окупает переписывание критичного пути и 61 сида. **Выбран A**; из B заимствована валидация provider-имени по реестру на записи (Б7) и опциональные FK (`providerId`/`modelId` в LlmTaskRoute уже есть — заполняются best-effort при записи маршрута, не используются рантаймом).

Challenge-loop по A: (1) *корень, не симптом* — да: корень = двойственность источников правды (ENV-сервисы vs DB-реестр), лечим классом (реестр становится единственным боевым, ENV — фолбэк), а не отдельные жалобы UI; (2) *эффективность* — не переоптимизировано: ни одна таблица не переписывается, адаптеры дорабатываются, UI собирается из готового embedding-паттерна; отклонено «переписать всё на FK» как преждевременное; (3) *код ради кода* — наоборот, минус код: удаляются LlmRoutesController+страница, ExperimentsClient, хардкод-списки фронта, фейковый протокол kie/grsai из сида; `custom-http` адаптер остаётся (используется как generic-эскейп).

## Scope
### Входит
- Миграция: 4 новых поля `LlmProvider` (`useProxy`, `proxyPath`, `timeoutMs`, `defaultModelKey`).
- Шифрование ключей (create/update/patch существующих) + маскирование во всех ответах + decrypt в резолвере.
- Честные адаптеры (connection-override, kie/grsai-адаптеры, buildFromEnv+2, effective proxy-URL, capability из DB, фикс атрибуции provider в usage-логе).
- Включение реестра по умолчанию (Ship-On) + parity-тесты + kill-switch в реестре флагов.
- Дискавери `GET /models` + импорт в каталог.
- Единый write-API цепочки маршрута + валидация по реестру + крутилка `llm.router.defaultChain` + фикс реестра taskType (`chat-summary`, дубль) + guard-тест двунаправленной полноты.
- Фронт: экран «Провайдеры и модели» (CRUD/ключи/цены/модели/discovery/smoke/прокси-тумблер), экран «Маршрутизация» (дропдауны из реестра, дефолт-цепочка); удаление `/admin/llm-routes`, `ExperimentsClient`, битых ссылок, хардкод-списков; smoke-список из реестра; курс ₽ из бэка.
- Обновление сидов (актуальные провайдеры/модели/протоколы), чистка `gpt-5-4`, регистрация patch/seed в `apply-prod-deploy.ts` STEPS; prod-deploy-log; second-brain.

### Не входит (vNext)
- **Фикс A/B-рантайма** (`LlmModelExperiment` → сплит трафика) — vNext-ТЗ «llm-model-experiments-runtime»; здесь A/B-контролы скрываются.
- **Экономика**: запись `costRub`, оживление hard-cap бюджета, интеграция цен в биллинг — vNext-ТЗ «llm-budget-costrub-fix».
- **Миграция analyze.worker с `LlmFallbackService` на роутер** — vNext-ТЗ (критичный путь основного отчёта, отдельная приёмка).
- **Org-overrides маршрутов** (`tenantId!=null`) — колонка остаётся мёртвой, не трогаем.
- **ASR (Vox)/TTS в реестре** — вне LLM-реестра [ASSUMPTION: владелец не просил; из smoke-списка фронта vox/openai просто убираются].
- **Удаление legacy provider-сервисов и switch** — остаются как kill-switch путь; вынос — после стабилизации реестра.
- Пагинация каталога, rate-limit по `globalRps` (колонка есть, рантайм-enforcement не входит).

## Граничные контракты с другими частями
- Сигнатуры `LlmRouterService.call()` / `LlmCompleteInput/Output` — **не меняются**; все ~176 taskType-потребителей не трогаются.
- `ProviderSmokeTestCron`/`AdminSmokeTestService` — продолжают работать поверх реестра; выигрывают от честных kie/grsai-адаптеров автоматически.
- `EmbeddingProvider`-контур — не трогается (отдельный bounded-context, решение Б1 ТЗ эмбеддингов).
- `CryptoService` — как есть; `isEncrypted()` — критерий идемпотентности patch'а.
- Таблицы `LlmTaskRoute`/сиды `seed-llm-task-routes-*` (61 шт.) — формат не меняется; новый chain-endpoint пишет те же tier-строки с `editedByAdmin=true`.
- `GET /api/v1/admin/ai-models/:taskType/metrics` расширяется полем `usdRubRate` (из `CurrencyRateService`) — аддитивно, старые потребители не ломаются.

---

## Контракт-first

### Prisma-diff (дословно; добавить в `model LlmProvider`, остальные поля без изменений)
```prisma
  /// Ходить через прокси: эффективный baseUrl строится из PROXY_BASE_URL(+proxyPath), ключ префиксуется PROXY_PREFIX.
  useProxy        Boolean @default(false)
  /// Слаг пути на прокси (например 'grsai' → {proxyRoot}/grsai/v1). NULL = корневой upstream прокси (openai).
  proxyPath       String? @db.VarChar(120)
  /// Переопределение hard-timeout dispatch, мс. NULL = LLM_ROUTER_DISPATCH_TIMEOUT_MS.
  timeoutMs       Int?
  /// Модель по умолчанию, когда её не задали ни вызов, ни маршрут. NULL = defaultModel legacy-сервиса.
  defaultModelKey String? @db.VarChar(120)
```
> Миграция: `bun run prisma:migrate -- --name llm_provider_proxy_defaults`, затем `bun run prisma:generate`. НЕ `db push`.

### Резолв эффективного подключения (единственная реализация — в `ProviderInfoResolver`, используется и dispatch'ем, и smoke, и discovery)
```ts
const proxyRoot = cfg.ai.proxy.baseUrl.replace(/\/v1\/?$/, '');
const effectiveBaseUrl = !p.useProxy
  ? p.baseUrl
  : p.proxyPath
    ? `${proxyRoot}/${p.proxyPath}/v1`
    : cfg.ai.proxy.baseUrl;
const decrypted = p.apiKeyEncrypted && crypto.isEncrypted(p.apiKeyEncrypted)
  ? crypto.decrypt(p.apiKeyEncrypted)
  : p.apiKeyEncrypted;
const effectiveApiKey = p.useProxy && decrypted ? `${cfg.ai.proxy.prefix}:${decrypted}` : decrypted;
```
`ProtocolAdapterProviderInfo` расширяется полями `timeoutMs?: number | null` и `defaultModelKey?: string | null`; `capability` уже есть — dispatch-фильтр dataClass читает его (Б12).

### protocolKind (итоговый enum DTO)
`'openai-chat' | 'openai-responses' | 'anthropic-messages' | 'ollama-native' | 'kie-native' | 'grsai-native' | 'custom-http'`
- `kie-native` → `KieProtocolAdapter` (обёртка `KieService` с connection-override; мультипротокол по префиксу модели сохраняется).
- `grsai-native` → `GrsaiProtocolAdapter` (обёртка `GrsaiService` с connection-override).
- `anthropic-messages`/`ollama-native` — существующие адаптеры дорабатываются: ProviderInfo передаётся в сервис (Б9), не игнорируется.

### Connection-override (единый тип, `protocol-adapter.types.ts`)
```ts
export interface LlmConnectionOverride {
  baseUrl: string;
  apiKey: string | null;
  defaultHeaders?: Record<string, string> | null;
  timeoutMs?: number | null;
}
```
Сервисы `AnthropicService`, `MinimaxService`, `OllamaService`, `KieService`, `GrsaiService` получают опциональный параметр `override?: LlmConnectionOverride` в `complete(...)`; при `undefined` поведение прежнее (ENV) — обратная совместимость legacy-switch гарантирована.

### Новые/изменённые REST (все под `CookieAuthGuard`+`SuperAdminGuard`+audit, как существующие)
```
POST /api/v1/admin/llm-providers/:id/models/discover → { ok, models: [{ id, alreadyInCatalog }] } | { ok:false, error }
PUT  /api/v1/admin/ai-models/:taskType/chain          → установить полную цепочку tier-строками
GET  /api/v1/admin/ai-models/:taskType/metrics        → + поле usdRubRate: number
DELETE LlmRoutesController целиком (GET/PUT /api/v1/admin/llm-routes) — вместе со страницей
```
`PutChainDto` (Zod):
```ts
export const PutChainSchema = z.object({
  entries: z.array(z.object({
    tier: z.enum(['primary', 'secondary', 'tertiary']),
    providerName: z.string().regex(/^[a-z0-9-]+$/).max(60),
    model: z.string().max(120).nullable().optional(),
    priority: z.number().int().min(0).default(0),
  })).min(1).max(10),
  isActive: z.boolean().default(true),
  pinnedVersionNote: z.string().max(2000).nullable().optional(),
  reason: z.string().min(3),
});
```
Сервис: валидация `providerName` против union(активные `llmProvider.name`, legacy-7) → 422 `route_provider_unknown`; модель не в каталоге провайдера → в ответе `warnings: ['model_not_in_catalog: …']` (не блок); запись — транзакция: delete tier-строк taskType (tenantId=null) + createMany + `LlmTaskRouteChange` + инвалидация кэша роутера; `editedByAdmin=true`.

### Дискавери (Б6)
- Только для `protocolKind` из `['openai-chat','openai-responses','ollama-native','kie-native','grsai-native','custom-http']`; для `anthropic-messages` → 400 `discovery_not_supported`.
- Вызов: `GET {effectiveBaseUrl}/models` с `Authorization: Bearer {effectiveApiKey}` + `defaultHeaders`, timeout 15s; ответ парсится как OpenAI-формат `{ data: [{ id }] }`.
- Сетевая/HTTP-ошибка → 200 `{ ok:false, error: 'discovery_failed: <детали>' }` (как smoke — не throw).
- Импорт выбранных — фронт вызывает существующий `POST /api/v1/admin/llm-models` per модель.

### AdminSetting-крутилка (Б11)
- Ключ `llm.router.defaultChain`, группа llm, severity high, Zod: `z.array(z.object({ provider: z.string(), model: z.string().nullable().optional() })).min(1).max(5)`.
- Регистрация в [admin-setting-schema-registry.ts](backend/src/modules/admin/settings/admin-setting-schema-registry.ts) + сид в `seed-admin-settings.ts` значением текущего хардкода + чтение в `chooseProviders` через `getDynamic` с code-fallback `DEFAULT_FALLBACK_CHAIN`.

### Коды ошибок (machine-readable, формат существующий `{ ok:false, error:{ code, message } }`)
- `provider_exists` (409) — существующий, не менять.
- `provider_not_found` (404) — существующий.
- `provider_in_use_by_routes` (409) — DELETE/деактивация провайдера, у которого есть активные tier-строки `LlmTaskRoute` или он входит в `llm.router.defaultChain`.
- `route_provider_unknown` (422) — providerName вне union(реестр, legacy-7).
- `discovery_not_supported` (400), `discovery_failed` (200 `{ok:false}`).
- `unknown_task_type` (404) — существующий `assertKnownTaskType`.

### Маскирование (Б5)
Единый `present()` в `AdminLlmProvidersService` (по образцу embedding-сервиса): наружу — `hasApiKey: boolean`, НИКОГДА `apiKeyEncrypted`/plaintext; `getById()` разделяется на внутренний `getRow()` (для сервиса) и публичный `get()` (present). Update-семантика ключа: `apiKey` отсутствует/пустая строка → не менять; `null` → очистить (выравнивание с embeddings; сейчас `dto.apiKey ?` теряет очистку).

## Границы фичи
- ✅ Always: CRUD/шифрование/маскирование; discovery; smoke; chain-endpoint + валидация; включение реестра с parity-тестами; консолидация UI и удаление перечисленного в ТЗ мёртвого кода; фикс реестра taskType; сиды/patch + STEPS.
- ⚠️ Ask first: деактивация/удаление провайдера, входящего в боевые маршруты или дефолт-цепочку (гард 409 — но если понадобится force-режим); любые правки `LlmFallbackService`/analyze.worker; изменение семантики dataClass-фильтра сверх Б12; правки биллинга/бюджета; удаление legacy provider-сервисов.
- 🚫 Never: plaintext/шифртекст ключа в ответах API и логах; `db push`; `new PrismaClient()` в скриптах (только `createPrismaClient()` из `scripts/_lib/prisma.ts`); менять сигнатуру `LlmRouterService.call()`; удалять legacy-switch (это kill-switch путь); трогать `EmbeddingProvider`-контур.

---

## Фазы (dependency-ordered)

Граф: Ф1 → Ф2 → Ф3 → Ф4; Ф5 после Ф2 (нужен decrypt/effective-URL); Ф6 после Ф4 (валидация по боевому реестру); Ф7 после Ф5 (discovery-UI); Ф8 после Ф6; Ф9 после Ф3 (протоколы для сида); Ф10 последняя. Реально параллелимы: {Ф5, Ф6} и {Ф7, Ф8} внутри пар после своих зависимостей; Ф9 параллельна Ф6–Ф8.

### Ф1 — Миграция схемы `[x]`
**Ценность:** как реестр провайдеров, получаю поля прокси/таймаута/модели по умолчанию, чтобы подключение описывалось одной DB-строкой.
- Входит: Prisma-diff (сниппет выше); `bun run prisma:migrate -- --name llm_provider_proxy_defaults`; `bun run prisma:generate`.
- НЕ входит: любой код.
- Файлы: `backend/prisma/schema.prisma` (model LlmProvider, якорь `@@map("llm_providers")`), `backend/prisma/migrations/*_llm_provider_proxy_defaults/`.
- Acceptance: `bunx prisma validate` ок; `grep -q "useProxy" backend/prisma/migrations/*_llm_provider_proxy_defaults/migration.sql`; `bun run prisma:generate` без ошибок; typecheck видит `llmProvider.useProxy`.
- Закрывает: R1.

### Ф2 — Шифрование и маскирование ключей `[x]`
**Ценность:** как супер-админ, храню ключи провайдеров только шифрованными и не могу случайно утечь их через API.
- Входит: `CryptoService` в `AdminLlmProvidersService` (encrypt на create/update, семантика пусто/null из Контракта); `present()`-маскирование для list/get/create/update (утечка `getById` закрыта); decrypt в `ProviderInfoResolver` (через `isEncrypted`, plaintext-строки читаются как есть до патча); `backend/scripts/patch-encrypt-llm-provider-keys.ts` — idempotent (шифрует только строки, где `!isEncrypted(apiKeyEncrypted)`), `createPrismaClient()`, регистрация в `apply-prod-deploy.ts` STEPS (`phase` patch, `skipBootstrap: true`).
- НЕ входит: адаптеры, UI.
- Файлы: `backend/src/modules/admin/economics/admin-llm-providers.service.ts`, `admin-llm-providers.controller.ts`, `backend/src/modules/ai/services/protocol-adapter/provider-info.resolver.ts`, `backend/scripts/patch-encrypt-llm-provider-keys.ts`, `backend/scripts/apply-prod-deploy.ts`.
- Acceptance: unit-тесты — (a) create с apiKey → в БД `gcm:v1:`-префикс; (b) ответы list/get/create/update не содержат подстроки ключа (негативный тест) и содержат `hasApiKey`; (c) patch дважды → второй прогон 0 изменений; (d) резолвер отдаёт расшифрованный ключ. `bunx vitest run src/modules/admin/economics/admin-llm-providers.service.spec.ts` зелёный.
- Закрывает: R2, R3.

### Ф3 — Честные адаптеры + прокси + capability `[x]`
**Ценность:** как LLM-роутер, вызываю любого провайдера по данным из БД (endpoint/ключ/headers/таймаут/прокси), а не по ENV.
- Входит: `LlmConnectionOverride` + опциональный параметр в `AnthropicService/MinimaxService/OllamaService/KieService/GrsaiService.complete()`; адаптеры `anthropic-messages`/`ollama-native` передают override из ProviderInfo; новые `KieProtocolAdapter`/`GrsaiProtocolAdapter` (`kie-native`/`grsai-native`) + регистрация в `LlmProtocolAdapterRegistry`; enum protocolKind в DTO расширен; effective-URL/ключ по формуле Контракта в `ProviderInfoResolver`; `buildFromEnv` учит kie/grsai (+ поля useProxy из текущих ENV-эвристик grsai); dataClass-фильтр читает `capability` из ProviderInfo с фолбэком на `PROVIDER_CAPABILITY` (Б12); фикс `normalizeProviderName` — usage-атрибуция сохраняет фактический slug провайдера (не 'deepseek'); `timeoutMs` провайдера участвует в `Promise.race` dispatch.
- НЕ входит: включение флага (Ф4), сиды (Ф9).
- Файлы: `backend/src/modules/ai/services/protocol-adapter/*` (types, resolver, registry, adapters/), `anthropic.service.ts`, `minimax.service.ts`, `ollama.service.ts`, `kie.service.ts`, `grsai.service.ts`, `llm-router.service.ts` (dataClass-фильтр, dispatch timeout), `admin-llm-providers.dto.ts`.
- Acceptance: unit-тесты адаптеров — override.baseUrl/apiKey реально попадают в HTTP-клиент (мок); `useProxy=true, proxyPath='grsai'` → baseUrl `https://proxy.agent-lia.ru/grsai/v1`, ключ с префиксом; `useProxy=true, proxyPath=null` → `PROXY_BASE_URL`; провайдер с capability='sensitive' проходит фильтр для dataClass sensitive (и негативный кейс); smoke kie/grsai через новые адаптеры зелёный (мок). `bun run typecheck` (NODE_OPTIONS=--max-old-space-size=8192) чистый.
- Закрывает: R4, R5, R6, R7.

### Ф4 — Включение реестра по умолчанию (Ship-On) `[x]`
**Ценность:** как супер-админ, создаю провайдера в админке — и он реально участвует в вызовах без деплоя.
- Входит: `USE_PROTOCOL_ADAPTER_REGISTRY: zBool(false)` → `zBool(true)` ([env.schema.ts:682](backend/src/common/config/env.schema.ts#L682)); parity-тесты: для каждого из 7 легаси-провайдеров dispatch через адаптер формирует эквивалентный вызов (модель/URL/ключ/headers — мок HTTP, сравнение с legacy-веткой); сохранение существующего warn-фолбэка на legacy-switch при сбое резолва; строка в `docs/operations/feature-flags.md` (тип (а) kill-switch: фича ON, флаг только для инцидента).
- НЕ входит: удаление legacy-switch.
- Файлы: `backend/src/common/config/env.schema.ts`, `backend/src/modules/ai/services/llm-router.service.spec.ts` (или новый `llm-router.registry-parity.spec.ts`), `docs/operations/feature-flags.md`.
- Acceptance: `grep -q "USE_PROTOCOL_ADAPTER_REGISTRY: zBool(true)" backend/src/common/config/env.schema.ts`; parity-spec зелёный на всех 7; `bunx vitest run src/modules/ai/services` зелёный целиком; строка флага в feature-flags.md.
- Закрывает: R8.

### Ф5 — Дискавери моделей + defaultModelKey в dispatch `[x]`
**Ценность:** как супер-админ, получаю список моделей провайдера кнопкой, а не ручным вводом вслепую.
- Входит: `POST /api/v1/admin/llm-providers/:id/models/discover` (контракт выше, Zod-DTO, Swagger); `dispatch` использует `providerInfo.defaultModelKey` перед фолбэком на defaultModel legacy-сервиса (`params.model ?? entry.model ?? info.defaultModelKey ?? legacy`).
- НЕ входит: UI (Ф7); авто-импорт без выбора админа.
- Файлы: `backend/src/modules/admin/economics/admin-llm-providers.{controller,service}.ts`, `dto/admin-llm-providers.dto.ts`, `backend/src/modules/ai/services/llm-router.service.ts` (:1919, якорь `params.model ?? entry.model`).
- Acceptance: unit — discover при моке `{data:[{id:'m1'},{id:'m2'}]}`, где `m1` уже есть в LlmModel, возвращает `m1.alreadyInCatalog=true` и `m2.alreadyInCatalog=false`; `anthropic-messages` → 400 `discovery_not_supported`; сетевой сбой → `{ok:false}`; dispatch-тест: маршрут без модели у провайдера с `defaultModelKey='x'` вызывает адаптер с model='x'.
- Закрывает: R9, R10.

### Ф6 — Единый write-API маршрутов + чистка реестра taskType + дефолт-цепочка `[x]`
**Ценность:** как супер-админ, назначаю цепочку «сервис → провайдер → модель» одним запросом с валидацией по реестру.
- Входит: `PUT /api/v1/admin/ai-models/:taskType/chain` (контракт выше) в `AdminAiModelsController/Service`; валидация providerName по реестру (Б7) + `provider_in_use_by_routes`-гард в DELETE/deactivate провайдера; удаление `LlmRoutesController`+`llm-routes.service.ts`+DTO+модуля из `admin.module.ts`; фикс `ALL_LLM_TASK_TYPES` (+`chat-summary`, −дубль `process-template-extract` в union) + guard-тест двунаправленной полноты (union ⊆ массив и массив ⊆ union — по образцу `bullmq-jobid-rule.spec.ts`-стиля проверок); `llm.router.defaultChain` (registry+seed+чтение в `chooseProviders` через `getDynamic`, code-fallback `DEFAULT_FALLBACK_CHAIN`); `metrics` + `usdRubRate` из `CurrencyRateService`.
- НЕ входит: фронт; org-overrides.
- Файлы: `backend/src/modules/admin/ai-models/*`, `backend/src/modules/admin/llm-routes/*` (удаление), `backend/src/modules/admin/admin.module.ts`, `backend/src/modules/ai/services/llm-router.service.ts` (union/массив/chooseProviders), `backend/src/modules/admin/settings/admin-setting-schema-registry.ts`, `backend/scripts/seed-admin-settings.ts`.
- Acceptance: PUT chain с неизвестным провайдером → 422 `route_provider_unknown`; с моделью вне каталога → 200 + `warnings`; после PUT `getRoutes` отдаёт tier-строки в заданном порядке и кэш инвалидирован (existing spec-паттерн); guard-тест taskType зелёный и падает при рассинхроне (негативная проверка в тесте через локальный массив); `grep -rn "llm-routes" backend/src/modules/admin --include=*.ts` → 0 совпадений; ключ `llm.router.defaultChain` в registry и в сиде; metrics-ответ содержит `usdRubRate`.
- Закрывает: R11, R12, R13, R14.

### Ф7 — Фронт «Провайдеры и модели» `[x]`
**Ценность:** как супер-админ, управляю провайдерами/моделями/ключами/ценами в одном разделе — как на референс-скринах.
- Входит: переработка `/admin/ai/catalog`: таб «Провайдеры» становится CRUD (паттерн `EmbeddingProvidersClient`: карточки, `ProviderFormDialog` с полями name/displayName/baseUrl/protocolKind/apiKey(password, пусто=не менять)/тумблер «Напрямую/Через прокси» (disabled + подсказка, если `proxyPath` пуст и провайдер без поддержки — свободный ввод proxyPath в форме)/timeoutMs/defaultModelKey с кнопкой «Получить» (discover→чекбоксы→импорт через `adminLlmModelsApi.create`)/isActive; smoke-кнопка с `lastSmoke*`); таб «Модели» — CRUD (create/update/remove уже есть в api-слое) + цены модели inline (reuse `adminPricesApi`); `SmokeTestClient` — список провайдеров из `adminLlmProvidersApi.list` (удалить `ADMIN_SMOKE_TEST_PROVIDERS` и вызов несуществующего `GET /status` — заменить на `history`); слои ApiDto→Domain→Ui (новые поля в `admin-llm-provider` домене; убрать инверсию импортов ApiDto из domain — типы Api живут в api-слое).
- НЕ входит: маршрутизация (Ф8); vox/openai кнопки smoke (удаляются без замены).
- Файлы: `frontend/app/(admin)/admin/ai/catalog/*`, `frontend/app/(admin)/admin/llm/providers/LlmProvidersClient.tsx` (перенос в catalog/ и переработка), `frontend/app/(admin)/admin/llm/models/LlmModelsClient.tsx` (аналогично), `frontend/src/api/admin-llm-providers.api.ts`, `admin-llm-models.api.ts`, `admin-smoke-test.api.ts`, `frontend/src/domain/admin-llm-provider.ts`, `admin-llm-model.ts`.
- Acceptance: `bun run typecheck` (frontend) чистый; `grep -rn "ADMIN_SMOKE_TEST_PROVIDERS" frontend/src` → 0; `grep -rn "smoke-test/status" frontend/src` → 0; UI на русском; парные токены `bg-*`/`text-*-fg`, без `text-white`/hex; ключ нигде не отображается; create→discover→импорт→smoke→edit→delete проходят против локального бэка.
- Закрывает: R15.

### Ф8 — Фронт «Маршрутизация» единым экраном `[x]`
**Ценность:** как супер-админ, вижу и правлю все маршруты «сервис → провайдер → модель» в одном месте с дропдаунами из реестра.
- Входит: `/admin/ai/routing` — таблица по группам taskType (существующая группировка), в строке: провайдер-дропдаун (из `adminLlmProvidersApi.list`), модель-дропдаун (модели выбранного провайдера из каталога + пункт «Ввести вручную»), колонка «Эффективно», сохранение через новый `PUT .../chain`; блок «Цепочка по умолчанию» (крутилка `llm.router.defaultChain` через admin-settings API); детальная `[taskType]` — оставить табы Метрики/История, вкладку «Цепочка» перевести на chain-endpoint, показ `pinnedVersionNote`; удалить: страницу+пункт меню `/admin/llm-routes`, `ExperimentsClient` и redirect-страницу `experiments`, битые ссылки «A/B-эксперименты»/«Все эксперименты»/«Назад к списку» (вести на `/admin/ai/routing`), redirect-папки `/admin/ai-models/*`, `/admin/llm/*`, `/admin/llm-prices` (клиенты переносятся в новые пути); скрыть A/B-контролы switch-primary (`abSplitPercent`) — vNext (Б2); `formatCostRub` — курс из `metrics.usdRubRate` (хардкод 90 удалить); `KNOWN_MODELS` удалить (модели из каталога).
- НЕ входит: фикс A/B-рантайма; org-overrides.
- Файлы: `frontend/app/(admin)/admin/ai/routing/*`, `frontend/app/(admin)/admin/ai-models/*` (удаление/перенос), `frontend/app/(admin)/admin/llm-routes/*` (удаление), `frontend/app/(admin)/admin/navigation.ts`, `frontend/src/api/admin-ai-models.api.ts` (+putChain), `admin-llm-routes.api.ts` (удаление), `frontend/src/domain/admin-llm-route.ts`, `admin-ai-model.ts`.
- Acceptance: `bun run typecheck && bun run build` (frontend) чистые; `grep -rn "llm-routes" frontend/src frontend/app` → 0; `grep -rn "KNOWN_MODELS\|usd \* 90\|\* 90" frontend/src/domain/admin-ai-model.ts` → 0 (курс — параметр); в меню нет `/admin/llm-routes`; страницы `/admin/ai-models*`, `/admin/llm/*`, `/admin/llm-prices` отсутствуют (404 или удалены вместе с redirect); ручная проверка: смена провайдера+модели у одного taskType сохраняется и видна в «Эффективно».
- Закрывает: R16, R17.

### Ф9 — Сиды и чистка каталога `[x]`
**Ценность:** как оператор прода, получаю актуальный каталог провайдеров/моделей одной командой без ручного ввода.
- Входит: `seed-default-llm-providers-and-models.ts` — обновить: kie→`kie-native`, grsai→`grsai-native`; openai-via-proxy: `useProxy=true, proxyPath=null`; grsai: `useProxy` по текущей ENV-логике (если `GRSAI_BASE_URL` указывает на прокси → true, `proxyPath='grsai'`); `defaultModelKey` каждому (deepseek→`deepseek-v4-flash`, openai-via-proxy→`gpt-5-mini`, anthropic→`claude-sonnet-4-6`, ollama→`qwen3:30b-a3b-instruct-2507`, minimax→`MiniMax-M2.5`, kie→`gemini-3.1-pro`); модели: добавить `deepseek-v4-pro`, `gpt-5.4`, `gemini-3.1-pro`, `MiniMax-M2.5`, `qwen3:30b-a3b-instruct-2507`, `claude-sonnet-4-6`; протухшие (`gpt-4o`, `gpt-4o-mini`, `deepseek-chat`, `qwen3.5:9b`, `gpt-5-4`, `gemini-3-pro`) — деактивировать (isActive=false), НЕ удалять (история цен/usage); опечатку `'gpt-5-4'` удалить из `MODEL_PRICES` ([model-prices.ts:44](backend/src/modules/ai/services/model-prices.ts#L44)); сид остаётся create-if-missing по name/modelKey (admin-правки не перезаписывает); patch protocolKind для существующих kie/grsai строк — в том же idempotent-патче Ф2 или отдельным `patch-llm-provider-protocols.ts` + STEPS.
- НЕ входит: сид маршрутов (61 файл — не трогаются).
- Файлы: `backend/scripts/seed-default-llm-providers-and-models.ts`, `backend/scripts/patch-llm-provider-protocols.ts` (если отдельный), `backend/scripts/apply-prod-deploy.ts`, `backend/src/modules/ai/services/model-prices.ts`.
- Acceptance: двойной прогон сида = no-op (0 created второй раз, лог подтверждает); после сида `kie.protocolKind='kie-native'`; `grep -n "gpt-5-4" backend/src/modules/ai/services/model-prices.ts` → 0; STEPS содержит новые скрипты с верной phase.
- Закрывает: R18.

### Ф10 — e2e, prod-deploy-log, second-brain `[ ]`
**Ценность:** как команда, получаю доказательство, что вызов через DB-провайдера работает end-to-end, и актуальные доки.
- Входит: интеграционный тест — DB-провайдер (openai-chat, мок HTTP) в маршруте taskType → `LlmRouterService.call()` уходит на baseUrl/ключ из БД (encrypt→decrypt в цикле); e2e discovery+smoke; `docs/operations/prod-deploy-log.md`: Шаг 1 (смена дефолта `USE_PROTOCOL_ADAPTER_REGISTRY` — поведенческое изменение, .env-правка не нужна), Шаг 4 (миграция `llm_provider_proxy_defaults`), Шаг 6 (patch-encrypt + patch-protocols), Шаг 7 (обновлённый сид), Шаг 12 (Swagger smoke: discover/chain; smoke-прогон всех провайдеров); second-brain: `02_architecture/ai-integration.md` (реестр — боевой источник, схема резолва, прокси-формула), `data-model.md` (новые поля), `01_projects/admin.md` (2 экрана, удалённые страницы), `01_projects/api-layer.md` (chain/discover, минус llm-routes); `04_не-сделано/README.md` — строки vNext (A/B-рантайм, costRub/hard-cap, LlmFallbackService, reindex уже там).
- Файлы: `backend/src/modules/ai/services/*.integration.spec.ts` (или e2e), `docs/operations/prod-deploy-log.md`, `second-brain/*`, `docs/operations/feature-flags.md` (перепроверка строки из Ф4).
- Acceptance: e2e зелёный; `bun run typecheck && bun run lint && bun run build` (оба пакета) зелёные; prod-deploy-log содержит все 5 шагов; в `04_не-сделано` есть 3 vNext-строки.
- Закрывает: R19, R20.

---

## Требования (трассируемость, EARS)
- R1: Когда применяется миграция, система shall добавить в `llm_providers` колонки `useProxy`(bool, default false), `proxyPath`(varchar 120, null), `timeoutMs`(int, null), `defaultModelKey`(varchar 120, null).
- R2: Когда сохраняется `apiKey`, система shall хранить только `gcm:v1:`-шифртекст; ни один ответ API/лог shall не содержать plaintext или полный шифртекст (наружу — только `hasApiKey`).
- R3: Patch шифрования shall быть идемпотентным (критерий — `isEncrypted`; повторный прогон = 0 изменений) и зарегистрирован в STEPS.
- R4: Когда адаптер вызывает провайдера, он shall использовать baseUrl/apiKey/defaultHeaders/timeoutMs из ProviderInfo (DB), а не ENV; при отсутствии DB-строки — `buildFromEnv` (включая kie/grsai).
- R5: Если `useProxy=true`, then эффективный baseUrl shall строиться по формуле Контракта и ключ shall получать префикс `PROXY_PREFIX`.
- R6: kie/grsai shall вызываться через адаптеры `kie-native`/`grsai-native`; когда креды валидны (мок HTTP 200), smoke этих провайдеров shall завершаться `lastSmokeSuccess=true`.
- R7: dataClass-фильтр shall читать `capability` провайдера из реестра с фолбэком на `PROVIDER_CAPABILITY`; usage-лог shall сохранять фактический slug провайдера.
- R8: `USE_PROTOCOL_ADAPTER_REGISTRY` shall иметь default `true`; при `false` (kill-switch) система shall работать по legacy-switch как до изменения; флаг shall быть в `feature-flags.md`.
- R9: Discover shall вернуть список моделей OpenAI-совместимого `GET /models` с флагом `alreadyInCatalog`; для `anthropic-messages` — 400 `discovery_not_supported`; сбой — `{ok:false}` без throw.
- R10: Когда ни вызов, ни маршрут не задали модель, dispatch shall использовать `defaultModelKey` провайдера, затем — legacy-default сервиса.
- R11: `PUT /api/v1/admin/ai-models/:taskType/chain` shall атомарно заменить tier-строки маршрута с `editedByAdmin=true`, записью в `LlmTaskRouteChange` и немедленной инвалидацией кэша.
- R12: Если `providerName` не входит в union(активный реестр, legacy-7), then запись маршрута shall вернуть 422 `route_provider_unknown`; модель вне каталога shall давать warning, не блок.
- R13: `ALL_LLM_TASK_TYPES` и union `LlmTaskType` shall совпадать двунаправленно (guard-тест); `chat-summary` shall присутствовать в обоих.
- R14: Дефолт-цепочка shall резолвиться из `llm.router.defaultChain` (AdminSetting) с code-fallback на `DEFAULT_FALLBACK_CHAIN`.
- R15: Экран «Провайдеры и модели» shall давать create/edit/delete/activate провайдера, ввод ключа (пусто=не менять), прокси-тумблер, discover-импорт моделей, CRUD моделей и цен, smoke; smoke-список shall строиться из реестра.
- R16: Экран «Маршрутизация» shall быть единственной точкой правки маршрутов: `/admin/llm-routes` (страница+контроллер) удалены, дропдауны провайдера/модели читают реестр.
- R17: Мёртвый код shall быть удалён: `ExperimentsClient`, redirect-папки `/admin/ai-models|/admin/llm|/admin/llm-prices`, `KNOWN_MODELS`, `ADMIN_SMOKE_TEST_PROVIDERS`, вызов `GET /smoke-test/status`, хардкод курса 90.
- R18: Сиды shall быть идемпотентными create-if-missing, с актуальными протоколами/моделями; протухшие модели shall деактивироваться, не удаляться.
- R19: e2e shall доказать: DB-провайдер с шифрованным ключом → `call()` уходит на его baseUrl с расшифрованным ключом.
- R20: Если DELETE/деактивация провайдера оставит боевой маршрут или дефолт-цепочку без провайдера, then система shall вернуть 409 `provider_in_use_by_routes`.

## Риски / ревью-аспекты (для strict-production-review-gate)
- **Регрессия критичного chat-пути** при включении реестра: parity-тесты Ф4 на всех 7 + сохранённый warn-фолбэк на legacy + kill-switch. Ревью: сверить каждую ветку legacy-switch с адаптерным эквивалентом (модель, json-mode, thinking-модели, streaming anthropic).
- **Утечка ключа**: негативные тесты на все 4 ответа CRUD + smoke/discovery error-пути (ошибка HTTP не должна включать Authorization-заголовок в текст `lastSmokeError`).
- **Прокси-формула**: строится единожды в резолвере; ревью — grep, что ни один адаптер не собирает URL сам.
- **Двойной прогон патчей/сидов** — acceptance Ф2/Ф9 (идемпотентность).
- **Гонка кэша маршрутов**: chain-endpoint должен инвалидировать кэш немедленно (существующий механизм setRoute) — иначе до 60с расхождение.
- **Multi-tenancy**: реестр и маршруты — глобальные (super-admin), `tenantId` в маршрутах не пишем [N/A: org-overrides — vNext]. Все новые endpoints под `SuperAdminGuard`+audit.
- **Observability**: резолвер логирует выбранного провайдера/effective-URL без ключа; существующие метрики (`incCoreLlmNoProvider`, `incLlmCostUnpriced`) не трогаются; usage-атрибуция чинится (R7) — иначе новые провайдеры пишутся как 'deepseek'.
- **Rollout/флаг**: Ship-On — реестр включается сразу; kill-switch `USE_PROTOCOL_ADAPTER_REGISTRY` (тип (а)) в feature-flags.md. Никаких «выкатить OFF».
- **Тесты**: unit (Ф2/Ф3/Ф5/Ф6) + parity (Ф4) + guard taskType (Ф6) + e2e (Ф10); FE — typecheck/build + ручной сценарий Ф7/Ф8.
- **Prompt caching**: [N/A: промпты и порядок system/user не меняются — меняется только транспорт подключения.]

## Idempotency / prod-deploy
- Миграция `llm_provider_proxy_defaults` → prod-deploy-log **Шаг 4** (аддитивная, безопасна).
- `patch-encrypt-llm-provider-keys.ts` (+`patch-llm-provider-protocols.ts`) → **Шаг 6** + STEPS (`skipBootstrap: true`).
- Обновлённый `seed-default-llm-providers-and-models.ts` + сид ключа `llm.router.defaultChain` → **Шаг 7** (уже в STEPS — проверить phase).
- Смена дефолта `USE_PROTOCOL_ADAPTER_REGISTRY` → **Шаг 1** (поведенческое изменение; для отката добавить `USE_PROTOCOL_ADAPTER_REGISTRY=false` в `.env`).
- Новые REST (`discover`, `chain`) + удалённый `llm-routes` → **Шаг 12** (Swagger/smoke-грепы).
- Применение: `docker compose exec backend bun run scripts/apply-prod-deploy.ts` (миграции — авто).

## DoD
- `bun run typecheck` (backend с `NODE_OPTIONS=--max-old-space-size=8192`, frontend), `lint`, `build` — зелёные, включая `.spec`.
- `bunx vitest run` по новым/затронутым spec — зелёные; parity- и guard-тесты в CI-наборе unit.
- Ключи нигде не в открытом виде (grep-проверка ответов/логов из тестов).
- second-brain обновлён (ai-integration, data-model, module-map — минус llm-routes-модуль, admin, api-layer); `04_не-сделано` — 3 vNext-строки; prod-deploy-log Шаги 1/4/6/7/12; feature-flags.md — kill-switch.
- Рефлексия в `second-brain/05_история/`.

## Итог
_Заполняется оркестратором по завершении: реализовано целиком или нет, что осталось._
