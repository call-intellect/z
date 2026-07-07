---
type: tz
status: ready-to-implement
feature: embedding-providers-crud
date: 2026-07-02
owner: tozixwot@gmail.com
relates_to: []
---
> Анализ: встроен в этот файл (раздел «Доказательство выбора»). Статус согласования: 2026-07-02 (4 HIGH-развилки закрыты владельцем).

# ТЗ: CRUD провайдеров эмбеддингов в админке

## Цель
Дать супер-админу управлять провайдерами эмбеддингов как сущностями в БД (добавлять / редактировать / удалять / активировать), по образцу LLM-провайдеров: endpoint (baseUrl), тип протокола, API-ключ (шифрованный), модели с размерностью и справочной ценой, порядок fallback, smoke-тест. Убрать захардкоженную привязку к ровно двум ENV-провайдерам.

## Зачем (болезненное состояние → решение)
Сейчас провайдер эмбеддингов — это ENV-переключатель ровно двух захардкоженных сервисов (`local`, `openai-via-proxy`); чтобы сменить endpoint/ключ/модель нужен деплой и правка `.env`. Владелец: «в админке нет возможности задать провайдера (адрес API, ключи и т.д.) для эмбеддинга… нужна возможность удалять/добавлять/редактировать модели, цены, адрес API, токены». Решение переводит конфигурацию провайдеров эмбеддингов в управляемую из UI DB-сущность с шифрованием ключей — как уже сделано для LLM-провайдеров (`LlmProvider`/`admin-llm-providers`).

## REALITY-CHECK (факт по коду на 2026-07-02)
- **Резолв провайдера сейчас:** `EmbeddingFallbackService.buildChain()` ([backend/src/modules/embeddings/services/embedding-fallback.service.ts:43-49](backend/src/modules/embeddings/services/embedding-fallback.service.ts#L43-L49)) выбирает цепочку по `cfg.ai.embeddings.provider` (`'local'` → `[local, proxy]`, иначе `[proxy, local]`). Ровно 2 провайдера-сервиса: `LocalEmbeddingService`, `OpenAiProxyEmbeddingService`. Оба — `implements EmbeddingProvider` (интерфейс `embed(texts): Promise<number[][]>`, поле `name`), см. [embeddings.types.ts](backend/src/modules/embeddings/embeddings.types.ts).
- **Конфиг эмбеддингов** — `cfg.ai.embeddings` ([typed-config.service.ts:277-314](backend/src/common/config/typed-config.service.ts#L277-L314)): `provider/model/dimensions/proxyApiKey/proxyEmbeddingsUrl/fallbackLocalUrl/localApiKey/batchSize/chunk*`. **Часть endpoint/ключей УЖЕ admin-editable** через `resolveSync` (ключи `embeddings.proxyEmbeddingsUrl`, `embeddings.localApiKey`, `embeddings.fallbackLocalUrl`), но не как первоклассная CRUD-сущность. Endpoint читается провайдер-сервисами оттуда: `local-embedding.service.ts:28` (`model`), `openai-proxy-embedding.service.ts:38` (`model`).
- **AdminSetting-крутилки эмбеддингов** (`embeddings.provider|model|dimensions|...`) зарегистрированы в [admin-setting-schema-registry.ts:139-141](backend/src/modules/admin/settings/admin-setting-schema-registry.ts#L139) и редактируются на странице [EmbeddingsSettingsClient.tsx](frontend/app/(admin)/admin/ai/embeddings/EmbeddingsSettingsClient.tsx) (вкладка «Модель»). `embeddings.provider/model` — `severity=high`, `embeddings.dimensions` — `severity=destructive` (требуют «причину изменения» ≥10 симв.; поле уже добавлено 2026-07-02).
- **Реиндексация** — вкладка `ReindexTab` в EmbeddingsSettingsClient сейчас **заглушка** («появится в Фазе 8»), реального reindex-воркера нет.
- **Эталон для зеркалирования** — LLM-провайдеры: модель `LlmProvider` (name/displayName/baseUrl/protocolKind/capability/apiKeyEncrypted/defaultHeaders/globalRps/isActive/lastSmoke*), `LlmModel` (providerId/modelKey/displayName/contextWindow/capabilitiesJson/**category (уже включает 'embedding')**/isActive/verifiedAt), `LlmModelPrice`. CRUD: [admin-llm-providers.controller.ts / .service.ts / dto/admin-llm-providers.dto.ts](backend/src/modules/admin/economics/). **`LlmModel.category='embedding'` существует, но embedding-пайплайн его НЕ читает** — это каталог цен, не рантайм-резолв.
- **Шифрование:** `CryptoService.encrypt(plaintext): string` → формат `gcm:v1:<iv>:<tag>:<b64>`, `decrypt(encoded): string`, `isEncrypted(v): boolean` ([common/crypto/crypto.service.ts](backend/src/common/crypto/crypto.service.ts)), модуль `CryptoModule`.
- **Текущая размерность pgvector-колонок = 768** (embeddinggemma; миграция 1536→768 уже выполнена). `embeddings.dimensions=768`.
- **Прод-инвариант БД:** файловые миграции Prisma (`prisma:migrate`), **НЕ** `db push` (с 2026-06-05, скилл `prisma-db-push-rules`). Воркеры — in-process (`WorkersModule` в `AppModule`), отдельного worker-процесса НЕТ (правка устаревшего представления).
- Параллельных веток/PR на эту фичу нет (проверено `git log`).

## Принятые решения владельца (2026-07-02 — не пересматривать)
| # | Решение | Обоснование (Почему) |
|---|---|---|
| Б1 | **Новые модели `EmbeddingProvider` + `EmbeddingModel`** (не переиспользовать `LlmProvider`) | Чистый bounded-context: embeddings-модуль уже отделён от ai/llm; нет риска, что chat-роутер (`llm-router.service`) подхватит embedding-провайдера; dimensions/reindex/fallback — embedding-специфичны. Дублирование CRUD ограничено одним модулем и безопаснее регрессий в критичном chat-пути. |
| Б2 | **Смена активного провайдера/модели/dimensions: разрешить + баннер `needsReindex` + гард по dimensions** | Смена dimensions молча ломает pgvector-поиск. Гард блокирует активацию при несовпадении с текущей размерностью колонки, не давая «битый» поиск. Автозапуск реиндексации не делаем — reindex-воркера нет (отдельное vNext-ТЗ). |
| Б3 | **Активность/порядок: `isActive` + `priority (int)`**; fallback-цепочка = активные по возрастанию `priority` | Масштабируется на N провайдеров, явный порядок, совпадает с UX «добавляй/редактируй». Старый knob `embeddings.provider` депрекейтится (мигрируется в priority). |
| Б4 | **Цены — только справочно/учёт** (`pricePerMillionInputTokensKopecks`), НЕ в биллинг клиентов | Покрывает запрос «цены» минимальным scope; интеграция в billing/квоты — отдельный большой scope, вне рамок. |
| Б5 | **Endpoint + ключи переносятся в DB-сущность `EmbeddingProvider`** (ключ — `apiKeyEncrypted`, AES-256-GCM) | Явный запрос владельца («адрес API, токены в админке»). Это осознанное отступление от «креды в ENV» (правило #9): endpoint/креды внешней инфры допустимы в ENV, но владелец выбрал управляемую сущность — как у `LlmProvider`. ENV остаётся источником при первичной миграции (seed) и code-fallback, если активных DB-строк нет. |

## Доказательство выбора (Проход A vs B, свод)
Развилка Б1 (модель данных). Ось различия: **модель данных / связность**.

| Критерий | A: новые `EmbeddingProvider/Model` (выбран) | B: переиспользовать `LlmProvider/Model` |
|---|---|---|
| Риск регрессий в chat-роутинге | ✓ нулевой (отдельные таблицы) | ✗ надо жёстко фильтровать embedding из `LlmTaskRoute`/router |
| dimensions/reindex-семантика | ✓ нативные поля | ✗ прикручивать `dimensions` к `LlmModel`, чужеродно |
| Объём нового кода | ✗ дублируется CRUD (модель+сервис+контроллер+фронт) | ✓ минимум (готовый CRUD/smoke/шифрование) |
| Изоляция bounded-context | ✓ embeddings-модуль остаётся автономным | ✗ связывает embeddings с ai/economics |
| Цена/учёт | ✓ своя простая модель цены (input-only) | ~ `LlmModelPrice` (input+output, лишнее) |
Итог: 4/5 за A. Дублирование CRUD — приемлемая цена за изоляцию критичного chat-пути. **Выбран A** (решение Б1).

Challenge-loop по выбранному A: (1) *корень, не симптом* — да, устраняем весь класс «captive-конфиг эмбеддингов», а не один endpoint; (2) *эффективность* — не переоптимизировано: одна пара таблиц + резолвер, без лишних абстракций; (3) *код ради кода* — резолвер заменяет `buildChain()`, старые провайдер-сервисы переиспользуются как HTTP-клиенты по `protocolKind`, не удаляются вслепую.

## Scope
### Входит
- Модели `EmbeddingProvider`, `EmbeddingModel` + миграция + `prisma:generate`.
- Backend: репозиторий/сервис CRUD, резолвер рантайма (заменяет `buildChain()` по DB, priority-цепочка, decrypt ключей), smoke-тест провайдера, гард dimensions при активации.
- Admin REST CRUD (Zod-DTO + Swagger) + smoke-эндпоинт, под `SuperAdminGuard`.
- Frontend: раздел управления провайдерами эмбеддингов (список/создать/редактировать/удалить/активировать, модели, кнопка smoke, баннер needsReindex) в `(admin)`.
- Idempotent seed: перенос текущих 2 провайдеров (`local`/embeddinggemma:768 через `llm.korateam.ru`; `openai-via-proxy`/text-embedding-3-small:1536 через `proxy.agent-lia.ru`) в DB-строки с шифрованием ключей; регистрация в `apply-prod-deploy.ts` STEPS.
- Депрекейт knob `embeddings.provider` (резолв через DB; knob → code-fallback).

### Не входит (vNext)
- **Reindex-воркер** (полный пересчёт эмбеддингов при смене модели/dimensions) — отдельное ТЗ; здесь только флаг `needsReindex` + гард + баннер. → заглушка `ReindexTab` остаётся.
- **Интеграция цен в billing/квоты Org** (решение Б4) — цены только справочные.
- **Смена размерности pgvector-колонок** (ALTER vector(N)) — вне scope; гард просто блокирует активацию несовместимого provider.
- **CRUD LLM-провайдеров** — не трогаем, только образец.

## Граничные контракты с другими частями
- `EmbeddingFallbackService.embed()` (публичный контракт `EmbeddingProvider.embed(texts)`) — **сигнатура не меняется**; внутри `buildChain()` заменяется на резолв из DB. Все потребители (`knowledge-core/services/embedding.service.ts`, `TranscriptIndexerService`, goal/issue-embed воркеры) не трогаются.
- Текущая размерность колонок pgvector фиксирована миграциями (768) — резолвер НЕ меняет колонки; при несовпадении `dimensions` активируемого провайдера с `embeddings.dimensions` бросает ошибку (см. R7).
- `CryptoService` — использовать как есть; НЕ хранить ключ в открытом виде ни в БД, ни в логах, ни в ответах API (в DTO ключ маскируется).

---

## Контракт-first

### Prisma-модели (дословно; вставить в `backend/prisma/schema.prisma`)
```prisma
/// Провайдер эмбеддингов (управляется из Z-Admin). Аналог LlmProvider, но
/// отдельный bounded-context: рантайм-резолв эмбеддингов НЕ идёт через llm-router.
model EmbeddingProvider {
  id               String    @id @default(cuid())
  /// Уникальный slug: 'local', 'openai-via-proxy', 'custom-...'. Стабилен (использовался как cfg.embeddings.provider).
  name             String    @unique @db.VarChar(60)
  /// Человекочитаемое имя для UI.
  displayName      String    @db.VarChar(120)
  /// Базовый endpoint API эмбеддингов (полный URL до /embeddings или базовый — зависит от protocolKind).
  baseUrl          String    @db.VarChar(500)
  /// Протокол запроса: 'openai-embeddings' | 'ollama-embeddings'.
  protocolKind     String    @db.VarChar(40)
  /// Зашифрованный AES-256-GCM API-ключ (формат gcm:v1:...). NULL для self-hosted без ключа.
  apiKeyEncrypted  String?   @db.Text
  /// Дополнительные HTTP-headers. JSON.
  defaultHeaders   Json?
  /// Активен ли для рантайм-цепочки эмбеддингов.
  isActive         Boolean   @default(true)
  /// Порядок в fallback-цепочке: меньше = раньше (primary = min среди активных).
  priority         Int       @default(100)
  /// Требуется реиндексация (модель/размерность менялись после последнего пересчёта). UI-баннер.
  needsReindex     Boolean   @default(false)
  lastSmokeAt      DateTime?
  lastSmokeSuccess Boolean?
  lastSmokeError   String?   @db.Text
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
  deletedAt        DateTime?

  models EmbeddingModel[]

  @@index([isActive, priority])
  @@map("embedding_providers")
}

/// Модель эмбеддингов конкретного провайдера.
model EmbeddingModel {
  id            String   @id @default(cuid())
  providerId    String
  /// Идентификатор модели в API (передаётся в запросе): 'embeddinggemma:latest', 'text-embedding-3-small'.
  modelKey      String   @db.VarChar(120)
  displayName   String   @db.VarChar(200)
  /// Размерность вектора. Должна совпадать с текущей размерностью pgvector-колонок для активации.
  dimensions    Int
  /// Справочная цена за 1M входных токенов, в копейках. NULL = неизвестна. НЕ влияет на биллинг (решение Б4).
  pricePerMillionInputTokensKopecks Int?
  /// Активна ли модель.
  isActive      Boolean  @default(true)
  /// Прошла smoke-тест. NULL = не проверялась.
  verifiedAt    DateTime?
  notes         String?  @db.Text
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  deletedAt     DateTime?

  provider EmbeddingProvider @relation(fields: [providerId], references: [id], onDelete: Cascade)

  @@unique([providerId, modelKey])
  @@index([providerId, isActive])
  @@map("embedding_models")
}
```
> Миграция: `bun run prisma:migrate -- --name embedding_providers` (создаёт файл в `prisma/migrations/`, применяет локально), затем `bun run prisma:generate`. НЕ `db push`. HNSW/GIN не требуются (эти таблицы без vector-колонок).

### Резолв рантайма (Ф2)
Новый `EmbeddingProviderResolverService` (в `embeddings` модуле):
- `resolveChain(): Promise<ResolvedEmbeddingProvider[]>` — читает `embeddingProvider.findMany({ where: { isActive: true, deletedAt: null }, orderBy: { priority: 'asc' }, include: { models: { where: { isActive: true, deletedAt: null } } } })`, для каждого decrypt ключа через `CryptoService`, возвращает готовые к вызову дескрипторы (baseUrl, protocolKind, apiKey, modelKey, dimensions).
- `EmbeddingFallbackService.buildChain()` переписывается: строит цепочку из `resolveChain()`; каждый элемент — обёртка, вызывающая существующий HTTP-клиент по `protocolKind` (`openai-embeddings` → логика `OpenAiProxyEmbeddingService`; `ollama-embeddings` → `LocalEmbeddingService`). **Fallback (code-fallback):** если активных DB-строк нет — использовать прежний путь `cfg.ai.embeddings` (обратная совместимость на время миграции).
- Ключ и endpoint провайдера берутся из DB-строки, НЕ из `cfg.ai.embeddings.*`.

### Zod-DTO + Swagger (Ф3) — образец `dto/admin-llm-providers.dto.ts`
- `CreateEmbeddingProviderDto`: `name` (slug, `z.string().regex(/^[a-z0-9-]+$/).min(1).max(60)`), `displayName`, `baseUrl` (`z.string().url()`), `protocolKind` (`z.enum(['openai-embeddings','ollama-embeddings'])`), `apiKey?` (plaintext на вход, шифруется на бэке, в ответах маскируется), `defaultHeaders?`, `isActive?`, `priority?`.
- `UpdateEmbeddingProviderDto`: partial; `apiKey` — если прислан пустой строкой → не менять; если `null` → очистить.
- `CreateEmbeddingModelDto`: `modelKey`, `displayName`, `dimensions` (`z.number().int().min(64).max(4096)`), `pricePerMillionInputTokensKopecks?` (`z.number().int().min(0)`), `isActive?`, `notes?`.
- Ответы: ключ отдаётся как `apiKeyMasked` (`"gcm:v1:••••"` или `null`), НИКОГДА plaintext/шифртекст целиком.
- Все эндпоинты под `SuperAdminGuard`, префикс `/api/v1/admin/embedding-providers` (мэппинг под общий `/api/v1`).

### Коды ошибок (machine-readable)
- `embedding_provider_name_conflict` (409) — дубль `name`.
- `embedding_dimension_mismatch_requires_reindex` (409) — попытка активировать провайдера/модель с `dimensions != embeddings.dimensions` текущей колонки (R7).
- `embedding_provider_not_found` (404).
- `embedding_provider_smoke_failed` (200 с `{ok:false, error}` — smoke возвращает результат, не throw).

### REST-поверхность (Ф3)
```
GET    /api/v1/admin/embedding-providers                 → список (+ модели, apiKeyMasked)
POST   /api/v1/admin/embedding-providers                 → создать
PATCH  /api/v1/admin/embedding-providers/:id             → редактировать
DELETE /api/v1/admin/embedding-providers/:id             → soft-delete (deletedAt)
POST   /api/v1/admin/embedding-providers/:id/activate    → isActive=true (с гардом R7)
POST   /api/v1/admin/embedding-providers/:id/smoke       → smoke-тест (embed(["ping"]) → пишет lastSmoke*)
POST   /api/v1/admin/embedding-providers/:id/models      → добавить модель
PATCH  /api/v1/admin/embedding-providers/:id/models/:mid → редактировать модель
DELETE /api/v1/admin/embedding-providers/:id/models/:mid → soft-delete модель
```

## Границы фичи
- ✅ Always: CRUD провайдеров/моделей эмбеддингов; шифрование ключей; резолв цепочки из DB; smoke; гард dimensions.
- ⚠️ Ask first: любое изменение размерности pgvector-колонок; удаление последнего активного провайдера (оставить систему без эмбеддингов); трогать `LlmProvider`/`llm-router`.
- 🚫 Never: хранить/логировать/возвращать ключ в открытом виде; `db push`; `new PrismaClient()` в скриптах (только `createPrismaClient()`); менять сигнатуру `EmbeddingProvider.embed`.

---

## Фазы (dependency-ordered)

Граф: Ф1 → Ф2 → {Ф3 → Ф4}; Ф5 после Ф2; Ф6 после Ф4/Ф5.

### Ф1 — Prisma-модели + миграция `[ ]`
**Ценность:** как система эмбеддингов, получаю таблицы для управляемых провайдеров, чтобы конфиг не был захардкожен в ENV.
- Что входит: модели `EmbeddingProvider`+`EmbeddingModel` (сниппет выше) в `schema.prisma`; `prisma:migrate -- --name embedding_providers`; `prisma:generate`.
- Что НЕ входит: любой код резолва/CRUD.
- Файлы: `backend/prisma/schema.prisma`, `backend/prisma/migrations/*_embedding_providers/`.
- Acceptance: `bunx prisma validate` ок; миграция применяется на чистой БД; `grep -q "embedding_providers" backend/prisma/migrations/*/migration.sql`; `bun run prisma:generate` без ошибок; `PrismaService` типизирует `embeddingProvider`/`embeddingModel`.
- Closes: R1.

### Ф2 — Резолвер рантайма из DB + рефактор fallback `[ ]`
**Ценность:** как knowledge-пайплайн, получаю провайдера эмбеддингов из БД по priority, чтобы админ мог менять endpoint/ключ/модель без деплоя.
- Что входит: `EmbeddingProviderResolverService` (`resolveChain()` + decrypt); переписать `EmbeddingFallbackService.buildChain()` на DB-цепочку с code-fallback на `cfg.ai.embeddings` при пустой выборке; обёртки по `protocolKind` поверх существующих HTTP-клиентов.
- Что НЕ входит: CRUD-эндпоинты, фронт, seed.
- Файлы: `backend/src/modules/embeddings/services/embedding-provider-resolver.service.ts` (новый), `embedding-fallback.service.ts`, `embeddings.module.ts` (+ `CryptoModule`, `PrismaModule` уже есть).
- Acceptance: unit-тест `embedding-provider-resolver.service.spec.ts` — (a) 2 активных провайдера с priority 10/20 → цепочка в порядке; (b) пустая выборка → code-fallback на cfg; (c) ключ дешифруется. `embedding-fallback.service.spec.ts` обновлён и зелёный. `bun run typecheck` (NODE_OPTIONS=--max-old-space-size=8192) без ошибок.
- Closes: R2, R3, R6.

### Ф3 — Admin REST CRUD + smoke + гард dimensions `[ ]`
**Ценность:** как супер-админ, получаю API для добавления/редактирования/удаления/активации провайдеров и моделей, чтобы управлять эмбеддингами из кабинета.
- Что входит: контроллер + сервис + Zod-DTO (образец `admin-llm-providers.*`), под `SuperAdminGuard`; шифрование ключа при create/update через `CryptoService`; маскирование в ответах; smoke-эндпоинт; гард R7 в `activate`.
- Что НЕ входит: фронт, seed.
- Файлы: `backend/src/modules/admin/economics/admin-embedding-providers.{controller,service}.ts`, `dto/admin-embedding-providers.dto.ts`, регистрация в модуле экономики/админки.
- Acceptance: Swagger `/api/docs` показывает 9 маршрутов; создание с `apiKey` → в БД `apiKeyEncrypted` начинается с `gcm:v1:`, в ответе `apiKeyMasked`; дубль `name` → 409 `embedding_provider_name_conflict`; активация модели с `dimensions=1536` при текущих 768 → 409 `embedding_dimension_mismatch_requires_reindex`; smoke пишет `lastSmoke*`. Тесты контроллера зелёные.
- Closes: R4, R5, R7, R8.

### Ф4 — Frontend: раздел провайдеров эмбеддингов `[ ]`
**Ценность:** как супер-админ, вижу и редактирую провайдеров эмбеддингов в UI (адрес API, ключ, модели, цены, порядок, smoke, баннер реиндексации).
- Что входит: страница/вкладка в `(admin)` (рядом с существующей `admin/ai/embeddings` или новая `admin/ai/embedding-providers`); слои `ApiDto→DomainModel→UiModel`; `api-client`; SWR; формы create/edit; кнопка smoke с индикацией `lastSmoke*`; баннер `needsReindex`; ключ вводится, отображается замаскированным.
- Что НЕ входит: реальная реиндексация (ReindexTab остаётся заглушкой).
- Файлы: `frontend/src/api/embedding-providers.api.ts`, `frontend/src/domain/embedding-provider.ts`, `frontend/app/(admin)/admin/ai/embedding-providers/*`, при необходимости пункт меню.
- Acceptance: `bun run typecheck` (frontend) чистый; UI на русском; парные токены `bg-*`/`text-*-fg` (без `text-white`/hex); create→list→edit→smoke→delete проходят против бэка; ключ нигде не показывается в открытом виде.
- Closes: R4, R9.

### Ф5 — Seed миграции текущих провайдеров + депрекейт knob `[ ]`
**Ценность:** как оператор прода, получаю перенос двух текущих ENV-провайдеров в БД одной командой, чтобы после выката эмбеддинги работали без правки `.env`.
- Что входит: `backend/scripts/seed-embedding-providers.ts` (idempotent, `createPrismaClient()` из `_lib/prisma`): создаёт (upsert по `name`) `local` (embeddinggemma:latest, dims 768, baseUrl из `EMBEDDING_FALLBACK_LOCAL_URL`, ключ из `EMBEDDING_LOCAL_API_KEY` → encrypt, priority 10) и `openai-via-proxy` (text-embedding-3-small, dims 1536, baseUrl `OPENAI_PROXY_EMBEDDINGS_URL`, ключ `OPENAI_PROXY_API_KEY` → encrypt, priority 20, `isActive=false` — 1536≠768); регистрация в `apply-prod-deploy.ts` STEPS (`phase: 'seed-base'`). Депрекейт: knob `embeddings.provider` больше не читается резолвером (остаётся как code-fallback).
- Что НЕ входит: удаление ENV-ключей из `.env`/`env.schema` (оставить как источник для seed + fallback).
- Файлы: `backend/scripts/seed-embedding-providers.ts`, `backend/scripts/apply-prod-deploy.ts` (STEPS).
- Acceptance: повторный прогон seed = no-op (upsert, 0 дублей) — проверить двойным запуском; после seed `SELECT count(*) FROM embedding_providers` = 2; `local` active priority 10, `openai-via-proxy` inactive; ключи зашифрованы (`apiKeyEncrypted LIKE 'gcm:v1:%'`); шаг присутствует в `STEPS`.
- Closes: R10, R11.

### Ф6 — e2e + прод-заметки `[ ]`
**Ценность:** как команда, получаю гарантию, что резолв из DB реально отдаёт векторы и smoke работает end-to-end.
- Что входит: интеграционный тест — активный DB-провайдер → `EmbeddingFallbackService.embed(['x'])` идёт по DB-цепочке (мок HTTP); smoke-эндпоинт e2e; обновление `docs/operations/prod-deploy-log.md` (Шаг 4 — новые модели; Шаг 7 — seed).
- Файлы: `backend/src/modules/embeddings/*.e2e.spec.ts` (или integration), `docs/operations/prod-deploy-log.md`.
- Acceptance: e2e зелёный; prod-deploy-log содержит запись про миграцию `embedding_providers` (Шаг 4) и `seed-embedding-providers.ts` (Шаг 7).
- Closes: R12.

---

## Требования (трассируемость)
- R1: Когда применяется миграция, система shall создать таблицы `embedding_providers`/`embedding_models` с указанными полями/индексами/`@@unique`.
- R2: Когда есть ≥1 активный `EmbeddingProvider`, система shall строить fallback-цепочку из DB по возрастанию `priority`.
- R3: Если активных DB-провайдеров нет, then система shall использовать прежний путь `cfg.ai.embeddings` (обратная совместимость).
- R4: Супер-админ shall создавать/редактировать/удалять/активировать провайдеров и модели через REST/UI.
- R5: Когда сохраняется `apiKey`, система shall хранить только `gcm:v1:`-шифртекст и никогда не возвращать/логировать plaintext.
- R6: Резолвер shall дешифровать ключ через `CryptoService` перед вызовом провайдера.
- R7: Если `dimensions` активируемого провайдера/модели ≠ текущей размерности колонки (`embeddings.dimensions`), then activate shall вернуть 409 `embedding_dimension_mismatch_requires_reindex` и НЕ активировать.
- R8: Smoke-эндпоинт shall выполнить пробный `embed` и записать `lastSmokeAt/Success/Error`.
- R9: UI shall показывать баннер при `needsReindex=true` и маскировать ключ.
- R10: Seed shall быть идемпотентным (повторный прогон = no-op) и зарегистрирован в `apply-prod-deploy.ts` STEPS.
- R11: Seed shall перенести текущие 2 провайдера с шифрованием ключей; `openai-via-proxy` (1536) — `isActive=false` (несовместим с 768).
- R12: e2e shall доказать резолв из DB и работу smoke.

## Риски / ревью-аспекты (для strict-production-review-gate)
- **Утечка ключа**: проверить, что ни один путь (DTO-ответ, лог pino, ошибка) не отдаёт plaintext/полный шифртекст. Тест на маскирование.
- **Регрессия эмбеддингов**: контракт `embed()` неизменен; code-fallback при пустой DB-выборке; e2e на реальную цепочку.
- **Битый pgvector-поиск**: гард R7 — единственная защита; тест на 409 при mismatch.
- **Multi-tenancy**: провайдеры — глобальные (super-admin), НЕ per-tenant; эндпоинты под `SuperAdminGuard`; таблицы без `tenantId` (осознанно — инфраструктурная настройка).
- **Observability**: резолвер логирует выбранного провайдера (без ключа); smoke пишет результат.
- **Идемпотентность**: seed upsert по `name` — acceptance-критерий (двойной прогон).
- **Ship-On / флаги**: фича выкатывается включённой (seed активирует `local`); отдельного флага НЕ вводим (не требуется — поведение по умолчанию сохраняется через fallback). Нет строки в feature-flags.md.

## Idempotency / prod-deploy
- Новые модели → `prod-deploy-log.md` **Шаг 4** (миграция `embedding_providers`).
- `seed-embedding-providers.ts` → **Шаг 7** + регистрация в `apply-prod-deploy.ts` STEPS (`phase: 'seed-base'`, без `skipBootstrap`).
- Новых ENV нет (переиспользуются существующие `EMBEDDING_*`/`OPENAI_PROXY_*`).
- Применение на прод: `docker compose exec backend bun run scripts/apply-prod-deploy.ts` (миграции — авто через `migrate deploy`).

## DoD (общий чек качества)
- `bun run typecheck` (backend с `NODE_OPTIONS=--max-old-space-size=8192`, frontend), `lint`, `build` — зелёные, включая `.spec`.
- `bunx vitest run` по новым/затронутым spec — зелёные.
- second-brain обновлён по таблице производных заметок: новый модуль/эндпоинт → `02_architecture/module-map.md` + `01_projects/api-layer.md` + `01_projects/admin.md`; новая модель → `02_architecture/data-model.md`; профильная заметка эмбеддингов.
- `prod-deploy-log.md` Шаг 4 + Шаг 7 обновлены; seed в STEPS.
- Рефлексия в `second-brain/05_история/`.
- Ключи нигде не в открытом виде.

## Итог
**Реализовано целиком (2026-07-02, 6 фаз, коммиты cefd31ff→docs).** Ф1 модели+миграция · Ф2 резолвер из БД + async fallback · Ф3 admin CRUD + smoke + гард dimensions · Ф4 фронт-вкладка «Провайдеры» · Ф5 idempotent seed 2 провайдеров + STEPS · Ф6 верификация (boot 0 DI-сбоев, 40/40 тестов) + доки. Осталось вне scope (как и планировалось): reindex-воркер (vNext), интеграция цен в биллинг. Прод: миграция аддитивная + seed в apply-prod-deploy, новых ENV нет. Рефлексия — `second-brain/05_история/2026-07-02-embedding-providers-crud-impl.md`.
