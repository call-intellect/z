---
type: tz
status: in_progress
feature: env-to-admin-setting-call-sites-migration
date: 2026-05-25
---

# ТЗ: Реальный переезд ENV → AdminSetting (миграция call-sites через sync-cache)

> Анализ: продолжение [plans/analysis/2026-05-25-admin-redesign.md](../analysis/2026-05-25-admin-redesign.md) и [plans/tz/2026-05-25-admin-redesign-tz.md](2026-05-25-admin-redesign-tz.md).
>
> Контекст: инфра `AdminSetting` (БД + сервис + UI) сделана в admin-redesign Фазы 0-9 (см. commits `e53bdeb..e125592`). Но реальная **миграция call-sites не выполнена**: `getDynamic` используется только в 2 местах (`dataclass-policy.service.ts`, `operations-daily-digest.cron.ts`). Остальные ~100 тюнинг-переменных всё ещё читаются геттерами `TypedConfigService` напрямую из ENV.

## Цель

Сделать так, чтобы все «крутилки», заявленные мигрированными в admin-redesign, **реально** читались из `AdminSetting`: правка в админке → следующий вызов через `cfg.workspace.maxChatRequestsPerDay` видит новое значение без рестарта.

## Ключевое решение: sync-cache внутри TypedConfigService

Не переделываем 100+ геттеров на `async`. Все существующие call-sites (`cfg.workspace.maxX`, `cfg.retention.shareViewDays`, `cfg.argon.memoryKb` и т.д.) остаются **синхронными**.

### Архитектура

```
process start
   ↓
AdminSettingsBootstrapService.onApplicationBootstrap()
   ├─ subscribes to Redis channel `admin:setting:invalidate` FIRST
   ├─ SELECT * FROM "AdminSetting"
   └─ typedConfig.hydrateSync(map)         ← заливает всё в TypedConfigService.cacheMap

runtime read
   cfg.workspace.maxX
     = this.resolveSync('limits.maxX', 'MAX_X', 100)
     = cacheMap.get('limits.maxX') ?? raw.get('MAX_X') ?? 100  (всё sync)

runtime write (super_admin сохраняет значение в UI)
   AdminSettingsService.set(key, value)
     ├─ UPSERT в БД + history + audit (как сейчас)
     ├─ typedConfig.applySync(key, value)   ← локальный процесс сразу видит
     └─ Redis publish { key, value }
         ↓
   Все процессы на subscribe → typedConfig.applySync(key, value)
   → max staleness ≈ Redis-RTT (≤ 100ms)
```

### Чем отличается от существующего `getDynamic`

| | `getDynamic` (есть) | `resolveSync` (новый) |
|---|---|---|
| Сигнатура | `async` | `sync` |
| Источник | AdminSettingsService.get → DB (LRU 30s) | cacheMap (eager-hydrated) |
| Подходит для | новых async-кодов, тестов, рискованных правок | всех существующих геттеров TypedConfigService |
| Max staleness | 30s (LRU TTL) | ≈ Redis-RTT (~100ms) |

`getDynamic` НЕ удаляется — остаётся для тех ~2 call-sites, что уже его используют, и для будущих сценариев чисто-БД настроек без ENV-аналога.

### Почему eager hydrate, а не lazy LRU

- Все ~100 ключей суммарно — единицы килобайт. Загрузить разом проще, чем плодить лениво.
- `cfg.workspace.maxX` вызывается в `@Cron`, `CanActivate.canActivate()`, конструкторах сервисов — везде, где async неприемлем.
- Один SELECT при старте дешевле, чем потенциальные сотни первичных промахов LRU под нагрузкой.

## Scope

**Входит:**
- Фаза 1: каркас (cache + resolveSync + bootstrap + расширение publish'а value).
- Фазы 2-5: миграция геттеров `TypedConfigService` по группам.
- Сидер `seed-admin-settings.ts` обновляется на каждой фазе (добавляются ключи новой группы).
- Юнит-тесты для каркаса и for каждой группы (smoke-test: ENV-only → BD-override → invalidate).
- Обновление [admin-settings.md](../../second-brain/01_projects/admin-settings.md) и [code-pitfalls.md](../../second-brain/02_architecture/code-pitfalls.md).

**Не входит:**
- Per-tier и per-org override (`Plan.quotas`, `OrgEntitlement.quotaOverrides`) — это другой резолвер (`EntitlementsService`), отдельным ТЗ.
- Миграция секретов и инфра-адресов (`*_API_KEY`, `DATABASE_URL`, `LIVEKIT_*`, `JWT_*_SECRET`, `S3_*`, `MAIL_USERNAME/PASSWORD`) — остаются ENV-only по плану редизайна.
- Реальное AES-шифрование `LlmProvider.apiKeyEncrypted` (сейчас raw, TODO в коде) — отдельным ТЗ.
- Пул ключей на провайдер (`LlmProviderKey` для round-robin/failover) — отдельным ТЗ.

## Соглашения по именованию AdminSetting-ключей

Префикс по группе + camelCase:
- `limits.*` — для `MAX_*` (лимиты пользователя/Org).
- `retention.*` — для `*_RETENTION_DAYS`.
- `security.*` — для `ARGON_*`, `*_TTL_*`.
- `embeddings.*` — для `EMBEDDING_*` (уже сидится).
- `knowledge.*` — для Knowledge-Core порогов (уже сидится).
- `aiFeatures.*` — для feature flags AI-пайплайна.
- `webhooks.*` — для `WEBHOOK_*`.
- `conversational.*` — для conversational-настроек.
- `idle.*` — для idle-meeting / participant.

ENV-имя (snake-case) приходит вторым аргументом `resolveSync` для fallback.

## Фазы

### Фаза 1 — Каркас (cacheMap + resolveSync + bootstrap)

**Backend:**
- [backend/src/common/config/typed-config.service.ts](backend/src/common/config/typed-config.service.ts):
  - Добавить приватное поле `cacheMap: Map<string, unknown> = new Map()`.
  - Метод `hydrateSync(entries: Map<string, unknown> | Iterable<[string, unknown]>)` — заменяет всё содержимое cacheMap. Должен быть идемпотентным.
  - Метод `applySync(key: string, value: unknown | undefined)` — при `value === undefined` удаляет ключ; иначе пишет в cacheMap. Используется как pub/sub callback и из `AdminSettingsService.set()`.
  - Метод `resolveSync<T>(adminKey: string, envFallbackKey?: string, defaultValue?: T): T` — поведение: cacheMap.get(adminKey) → raw.get(envFallbackKey) → defaultValue → throw. **Sync**, никаких await. Логирует на debug-уровне «source: cache|env|default» один раз на ключ за процесс (через локальный Set), чтобы не спамить.

- Новый файл [backend/src/modules/admin/settings/admin-settings-bootstrap.service.ts](backend/src/modules/admin/settings/admin-settings-bootstrap.service.ts):
  - `@Injectable() implements OnApplicationBootstrap`.
  - Зависимости: `PrismaService`, `TypedConfigService`.
  - `onApplicationBootstrap()`:
    1. `const rows = await prisma.adminSetting.findMany({ select: { key: true, value: true } })`.
    2. `typedConfig.hydrateSync(new Map(rows.map(r => [r.key, r.value])))`.
    3. Логируем `AdminSettings: hydrated N keys into TypedConfigService cache`.
  - Если БД недоступна — `try/catch`, лог WARN, продолжаем с пустым кэшем (resolveSync падёт на ENV/default).

- [backend/src/modules/admin/settings/admin-settings.service.ts](backend/src/modules/admin/settings/admin-settings.service.ts):
  - Расширить payload pub/sub: `{ key, value }` (сейчас `{ key }`).
  - В subscriber-callback при получении сообщения вызвать `typedConfig.applySync(key, value)`. **И продолжать делать** `this.cache.delete(key)` для существующего LRU (`getDynamic`-путь).
  - В `set()` после `this.cache.delete(key)`, до `publishInvalidate`, добавить `typedConfig.applySync(key, value)` — чтобы локальный процесс мгновенно увидел новое значение, не дожидаясь Redis-roundtrip.

- [backend/src/modules/admin/settings/admin-settings.module.ts](backend/src/modules/admin/settings/admin-settings.module.ts):
  - Зарегистрировать `AdminSettingsBootstrapService` в providers.

**Тесты:**
- Новый [backend/src/common/config/typed-config.service.spec.ts](backend/src/common/config/typed-config.service.spec.ts) (если уже есть — добавить describe-блоки):
  - `resolveSync`: cache hit → возвращает; cache miss + ENV → возвращает ENV; cache miss + no ENV + default → возвращает default; всё пусто → throws.
  - `applySync(key, undefined)` → удаляет ключ из cache; `resolveSync` после этого падает на ENV.
  - `hydrateSync` идемпотентен (повторный вызов с другим map'ом заменяет содержимое).
- Новый [backend/src/modules/admin/settings/admin-settings-bootstrap.service.spec.ts](backend/src/modules/admin/settings/admin-settings-bootstrap.service.spec.ts):
  - На bootstrap читает строки из mock'а Prisma и вызывает hydrateSync с правильным набором.
  - При ошибке Prisma не падает (логирует и продолжает).
- Обновить [admin-settings.service.spec.ts](backend/src/modules/admin/settings/admin-settings.service.spec.ts):
  - Проверить, что `set()` вызывает `typedConfig.applySync(key, value)`.
  - Проверить, что pub/sub payload теперь содержит `value`.

**Verification (DoD Фазы 1):**
- [ ] `bun run typecheck` зелёный.
- [ ] `bun run lint` зелёный.
- [ ] `bun run test:unit` зелёный (старые + новые).
- [ ] `bun run build` зелёный.
- [ ] Никакие существующие call-sites не тронуты — только новый сервис + новые методы TypedConfigService + расширение payload pub/sub.

---

### Фаза 2 — Лимиты (`cfg.workspace.*`)

Геттер `workspace` в [typed-config.service.ts](backend/src/common/config/typed-config.service.ts) — переключить ~17 полей с `this.get('MAX_X')` на `this.resolveSync('limits.x', 'MAX_X', defaultValue)`.

Полный список (с дефолтами для resolveSync):

| AdminSetting key | ENV key | defaultValue |
|---|---|---|
| `limits.maxApiKeysPerUser` | `MAX_API_KEYS_PER_USER` | 10 |
| `limits.maxWebhookSubscriptionsPerUser` | `MAX_WEBHOOK_SUBSCRIPTIONS_PER_USER` | 10 |
| `limits.maxDestinationsPerUser` | `MAX_DESTINATIONS_PER_USER` | 20 |
| `limits.maxTagsPerUser` | `MAX_TAGS_PER_USER` | 50 |
| `limits.maxUserTemplatesPerUser` | `MAX_USER_TEMPLATES_PER_USER` | 20 |
| `limits.maxChatRequestsPerDay` | `MAX_CHAT_REQUESTS_PER_DAY` | 200 |
| `limits.maxChatTokensPerDay` | `MAX_CHAT_TOKENS_PER_DAY` | 200000 |
| `limits.maxRenderJobsPerHour` | `MAX_RENDER_JOBS_PER_HOUR` | 50 |
| `limits.maxBulkExportsPerDay` | `MAX_BULK_EXPORTS_PER_DAY` | 10 |
| `limits.maxRegeneratePerMeetingPerDay` | `MAX_REGENERATE_PER_MEETING_PER_DAY` | 5 |
| `limits.maxMeetingsCreatedPerDayViaApi` | `MAX_MEETINGS_CREATED_PER_DAY_VIA_API` | 100 |
| `limits.maxEmbeddingTokensPerMonthPerUser` | `MAX_EMBEDDING_TOKENS_PER_MONTH_PER_USER` | 10000000 |
| `limits.maxHighlightsPerMeeting` | `MAX_HIGHLIGHTS_PER_MEETING` | 50 |
| `limits.maxBulkOperationIds` | `MAX_BULK_OPERATION_IDS` | 100 |
| `limits.maxChatMessageChars` | `MAX_CHAT_MESSAGE_CHARS` | 4000 |
| `limits.maxRoomMessageChars` | `MAX_ROOM_MESSAGE_CHARS` | 500 |
| `limits.maxCardsPerUser` | `MAX_CARDS_PER_USER` | 200 |
| `limits.maxCardRollupsPerDay` | `MAX_CARD_ROLLUPS_PER_DAY` | 20 |
| `limits.maxGoalRecomputePerDay` | `MAX_GOAL_RECOMPUTE_PER_DAY` | 10 |
| `limits.clipMaxDurationSeconds` | `CLIP_MAX_DURATION_SECONDS` | 300 |
| `limits.exportZipMaxMeetings` | `EXPORT_ZIP_MAX_MEETINGS` | 50 |
| `limits.exportZipMaxBytes` | `EXPORT_ZIP_MAX_SIZE_BYTES` | 1073741824 |

(Реальные значения по умолчанию подтягиваем из текущего `env.schema.ts`.)

**Прочее:**
- Обновить [backend/scripts/seed-admin-settings.ts](backend/scripts/seed-admin-settings.ts) — добавить группу `limits.*` (category `platform`, section `limits`, severity `low`).
- Обновить [admin-setting-schema-registry.ts](backend/src/modules/admin/settings/admin-setting-schema-registry.ts) — все ключи `POSITIVE_INT` (для `limits.clipMaxDurationSeconds` — `POSITIVE_INT`; `limits.exportZipMaxBytes` — `POSITIVE_INT`).
- Юнит-тест: смок-проверка нескольких лимитов через TypedConfigService — ENV-only сценарий, cacheMap-override сценарий.

**DoD Фазы 2:** typecheck + lint + test:unit + build зелёные; ручная: записать в админке `MAX_CHAT_REQUESTS_PER_DAY = 999`, прочитать `cfg.workspace.maxChatRequestsPerDay` в REPL — = 999.

---

### Фаза 3 — Retention + Security TTL (`cfg.retention.*`, `cfg.argon.*`, `cfg.auth.sessionTtl/deepLinkTtl`)

Геттеры:
- `cfg.retention` — 10 ключей (`DEFAULT_RETENTION_DAYS`, `RETENTION_CRON`, `SOFT_DELETE_GRACE_DAYS`, `WEBHOOK_DELIVERY_RETENTION_DAYS`, `SHARE_VIEW_RETENTION_DAYS`, `API_ACCESS_LOG_RETENTION_DAYS`, `RETENTION_SWEEP_BATCH_SIZE`, `RETENTION_RAW_EVENTS_ENABLED`, `RETENTION_AUDIT_ENABLED`, `RETENTION_CHAT_ENABLED`, `RETENTION_BLOCKS_ENABLED`).
- `cfg.argon` — 3 ключа (`ARGON_MEMORY_KB`, `ARGON_ITERATIONS`, `ARGON_PARALLELISM`).
- `cfg.auth` — два ключа (`SESSION_TTL_SECONDS`, `DEEP_LINK_TTL_SECONDS`). **Остальные поля `auth` (`sessionSecret`, `deepLinkSecret`, `cookieDomain`, `publicFrontendUrl`) — секреты / инфра, остаются ENV-only.**

Префиксы: `retention.*`, `security.argonMemoryKb`, `security.sessionTtlSeconds`, `security.deepLinkTtlSeconds`.

**Внимание:** TTL сессий читается на каждый запрос в guard'ах — критично, что resolveSync остался **sync**. Проверить, что guards не сломались (отдельным тестом).

**DoD Фазы 3:** аналогично Фазе 2 + ручная: смена `SESSION_TTL_SECONDS` в админке → следующая авторизация выписывает cookie с новым TTL.

---

### Фаза 4 — Embeddings + AI feature flags (`cfg.ai.embeddings.*`, `cfg.aiFeatures.*`)

- `cfg.ai.embeddings` — 7 ключей (`EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `OPENAI_PROXY_API_KEY` — **остаётся ENV (это секрет)**, `OPENAI_PROXY_EMBEDDINGS_URL`, `EMBEDDING_FALLBACK_LOCAL_URL`, `EMBEDDING_BATCH_SIZE`, `EMBEDDING_CHUNK_TARGET_TOKENS`, `EMBEDDING_CHUNK_OVERLAP_TOKENS`).
- `cfg.aiFeatures` — ~10 ключей (включая `INCLUDE_ROOM_CHAT_IN_AI`, флаги Фаз A-D пайплайна). Полный список собирается на старте Фазы 4 при чтении геттера в коде.

Префиксы: `embeddings.*` (уже частично есть в сидере), `aiFeatures.*`.

**DoD Фазы 4:** typecheck + lint + test:unit + build + ручная проверка одного из флагов.

---

### Фаза 5 — Прочее (webhooks-out, conversational, idle, crossmark)

- `cfg.webhooksOut` — 4 ключа (исключая `WEBHOOK_SECRETS_ENCRYPTION_KEY` — секрет).
- `cfg.crossmark` — 1 ключ.
- `cfg.idle` (если есть отдельный геттер) — TBD по факту.
- conversational-настройки — TBD, после прохода по геттеру.

**DoD Фазы 5:** аналогично.

---

### Фаза 6 — End-to-end smoke + документация

- Тест: `bun run scripts/smoke-admin-setting-resolves.ts` (новый) — запускает Nest-приложение в test-режиме, проверяет, что для каждой группы хотя бы одно значение читается через cacheMap (override) и через ENV (fallback).
- Ручная проверка: правка одного значения в /admin/platform/limits → лог в воркере «source: cache» вместо «source: env».
- Обновить [second-brain/01_projects/admin-settings.md](../../second-brain/01_projects/admin-settings.md) — описать sync-cache механизм, отличие от `getDynamic`.
- Обновить [second-brain/02_architecture/code-pitfalls.md](../../second-brain/02_architecture/code-pitfalls.md) — урок «AdminSetting синхронно через `resolveSync`; `getDynamic` оставлен для специальных случаев; никогда не делать async в `@Cron`/guards».
- Зафиксировать остаточные ENV-only переменные в самом сидере как комментарий «остаётся ENV: секрет / инфра-адрес».

## Риски и митигации

1. **Race на bootstrap** — pub/sub-сообщение может прийти раньше hydrateSync. **Митигация:** subscribe → SELECT → hydrateSync. Сообщения, пришедшие между subscribe и hydrateSync, лишь перезапишут отдельные ключи поверх hydrate — лучше, чем потерять. Если ключ перезаписан до hydrate, hydrate его перезапишет на старое (1 сек staleness — приемлемо).

2. **Десинхронизация cacheMap и AdminSettingsService.cache (LRU)** — теперь два кэша, могут разойтись. **Митигация:** `set()` чистит оба. Pub/sub-receive чистит оба. LRU остаётся живым для `getDynamic`-кода, но это редкий путь.

3. **Большой payload pub/sub** — `value` может быть JSON-объектом до сотен байт. **Митигация:** Redis pub/sub держит мегабайты на сообщение; наш максимум — единицы килобайт. Не блокер.

4. **resolveSync вызывается до bootstrap'а** — если кто-то дёрнет `cfg.workspace.maxX` в `onModuleInit` сервиса, который грузится раньше `AdminSettingsBootstrapService`. **Митигация:** в этом случае resolveSync вернёт ENV-fallback — точное поведение как сейчас (до миграции). Не регрессия.

5. **Тесты без Nest-приложения** — `cfg.workspace.maxX` без bootstrap'а вернёт ENV. Существующие unit-тесты не сломаются. **Митигация:** в тестах TypedConfigService инстанцируется руками; пустой cacheMap = всё через ENV.

## Связанные

- [admin-z-global.md](../../second-brain/01_projects/admin-z-global.md) — общая карта админки.
- [admin-settings.md](../../second-brain/01_projects/admin-settings.md) — описание AdminSetting инфры.
- [admin-redesign-tz.md](2026-05-25-admin-redesign-tz.md) — родительское ТЗ.

## Итог

_Заполняется по факту реализации._
