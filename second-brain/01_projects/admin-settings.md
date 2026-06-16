---
type: project
status: in_progress
phase: 0-9
---

# AdminSetting + AdminSettingsService (динамические настройки)

> Источник правды по «крутилкам» Z, мигрированным из `.env` в БД. Часть редизайна админки (Фазы 0–9). См. [admin-z-global.md](admin-z-global.md).

## Зачем

~140 ENV-переменных продукта (`THEME_COSINE_THRESHOLD`, `MAX_MEETINGS_PER_DAY`, `*_RETENTION_DAYS`, `ARGON2_TIME_COST`, …) раньше требовали редеплоя при каждой правке. После Фазы 0 редизайна они хранятся в БД и редактируются super_admin через UI с history, audit и live-инвалидацией кэшей во всех процессах за <1 секунду.

ENV не выкорчёвывались — `env.schema.ts` пометил мигрированные ключи как `@deprecated` и оставил как fallback для самого первого старта чистой БД.

## Модели Prisma

[backend/prisma/schema.prisma](backend/prisma/schema.prisma) — добавлены в Фазе 0:

```prisma
model AdminSetting {
  key         String   @id          // "knowledge.theme.cosine_threshold"
  value       Json
  category    String                // "ai" | "platform" | "content" | ...
  section     String                // "knowledge-core" | "crons" | ...
  severity    String   @default("low")    // "low" | "medium" | "high" | "destructive"
  schemaHash  String?               // ref на Zod-schema registry (для UI рендера)
  description String?               // hover-подсказка в UI
  updatedBy   String?
  updatedAt   DateTime @updatedAt
  comment     String?               // последняя причина изменения
  @@index([category, section])
}

model AdminSettingHistory {
  id          String   @id @default(cuid())
  key         String
  prevValue   Json
  newValue    Json
  changedBy   String
  reason      String?
  changedAt   DateTime @default(now())
  @@index([key, changedAt])
}
```

## Сервис

[backend/src/modules/admin/settings/admin-settings.service.ts](backend/src/modules/admin/settings/admin-settings.service.ts):

- `get<T>(key)` — `Promise<T | null>`, LRU-кэш TTL 30s (для категорий `security`/`retention` — 5s).
- `getMany(keys: string[])` — batch.
- `set(key, value, ctx: { userId, reason? })` — пишет AdminSetting + AdminSettingHistory + публикует в Redis канал `admin:setting:invalidate` payload `{ key }`.
- `list({ category?, section? })` — пагинированный список.
- `history(key, limit = 50)` — последние правки.

LRU-кэш — на каждый процесс (`HTTP` + `workers/main.ts`). При публикации в Redis pub/sub — все подписчики делают `cache.del(key)`. Подписка инициализируется в `RedisService` через bootstrap [workers/main.ts](backend/src/workers/main.ts) и в HTTP-процессе.

## Контроллер

[backend/src/modules/admin/settings/admin-settings.controller.ts](backend/src/modules/admin/settings/admin-settings.controller.ts):

```
GET    /api/v1/admin/settings              ?category=&section=
GET    /api/v1/admin/settings/:key
POST   /api/v1/admin/settings/:key         { value, reason? }
GET    /api/v1/admin/settings/:key/history last 50
```

Все эндпоинты под `SuperAdminGuard` + `SuperAdminAuditInterceptor`. Если severity `high`/`destructive` — `reason` обязателен на уровне Zod-DTO.

## TypedConfigService — два пути чтения AdminSetting

[backend/src/common/config/typed-config.service.ts](backend/src/common/config/typed-config.service.ts) предоставляет **два метода**, разделённых по сценарию использования:

### `getDynamic<T>(adminKey, envFallbackKey?, defaultValue?): Promise<T>` (async)

Ленивый async-путь — на каждый вызов идёт через `AdminSettingsService.get(adminKey)` (LRU TTL 30s, при miss — SELECT из БД), потом ENV-fallback, потом default. Используется в новых async-кодах, где нет sync-ограничения. Сейчас — в 2 местах: [dataclass-policy.service.ts](backend/src/modules/knowledge-core/services/dataclass-policy.service.ts), [operations-daily-digest.cron.ts](backend/src/modules/operations/workers/operations-daily-digest.cron.ts).

### `resolveSync<T>(adminKey, envFallbackKey?, defaultValue?): T` (sync)

Eager sync-путь — читает из `TypedConfigService.cacheMap`, заполненного на bootstrap через [AdminSettingsBootstrapService](backend/src/modules/admin/settings/admin-settings-bootstrap.service.ts). Поведение: cache → ENV → default. **Если `envFallbackKey` задан, но всё равно ничего нет — возвращает `undefined` вместо throws** (для optional ENV-ключей вроде `EMBEDDING_FALLBACK_LOCAL_URL`); throws — только если `envFallbackKey` не передан и default отсутствует.

Используется в типизированных геттерах `TypedConfigService` (`cfg.workspace.maxX`, `cfg.retention.shareViewDays`, …) — потому что они вызываются из `@Cron`-декораторов, guards, конструкторов сервисов, где async неприемлем.

### Сравнение

| | `getDynamic` | `resolveSync` |
|---|---|---|
| Сигнатура | `async` | `sync` |
| Источник | LRU TTL 30s + SELECT | eager cacheMap |
| Bootstrap-зависимость | нет | да (без bootstrap'а — fallback на ENV) |
| Max staleness | 30s | ≈ Redis-RTT (≤ 100ms) |
| Для чего | редкие случаи без ENV-аналога, async-контексты | существующие синхронные геттеры |

### Eager hydrate + invalidate

[AdminSettingsBootstrapService](backend/src/modules/admin/settings/admin-settings-bootstrap.service.ts) на `onApplicationBootstrap` делает один SELECT `AdminSetting` и вызывает `cfg.hydrateSync(entries)`. При недоступной БД — лог WARN, кэш остаётся пустым, `resolveSync` падает на ENV/default.

[AdminSettingsService.set()](backend/src/modules/admin/settings/admin-settings.service.ts) после транзакции UPSERT вызывает локально `cfg.applySync(key, value)` и публикует в Redis `{ key, value }` (а не только `{ key }`, как было до Фазы 1 миграции). Все процессы на подписке `admin:setting:invalidate` парсят payload и тоже зовут `cfg.applySync(key, value)`. Так max staleness между процессами — Redis-RTT, без повторного DB-roundtrip.

`get(key)` остаётся синхронным и читает только ENV — для bootstrap-критичных значений (`PORT`, `DATABASE_URL`, `REDIS_URL`, JWT secrets, S3 ключи).

## Какие геттеры уже на resolveSync

По состоянию на 2026-05-25 (миграция env→AdminSetting Фазы 1-5):

- [x] `cfg.workspace.*` — 22 поля (`limits.*`).
- [x] `cfg.retention.*` — 11 полей (`retention.*`).
- [x] `cfg.argon.*` — 3 поля (`security.argon*`).
- [x] `cfg.auth.sessionTtlSeconds` и `cfg.auth.deepLinkTtlSeconds` — 2 поля (`security.*TtlSeconds`). Прочие поля `auth` (sessionSecret, deepLinkSecret, cookieDomain) остаются ENV — секреты/инфра.
- [x] `cfg.ai.embeddings.*` — 8 полей (`embeddings.*`); `proxyApiKey` остаётся ENV.
- [x] `cfg.aiFeatures.*` — 4 поля (`aiFeatures.*`).
- [x] `cfg.crossmark.*` — 1 поле (`crossmark.*`).
- [x] `cfg.webhooksOut.*` — 3 поля (`webhook.*`); `encryptionKey` остаётся ENV — секрет.
- [x] `cfg.share.*` — 3 поля (`share.*`). `allowedExpirationDays` хранится как `number[]` в AdminSetting (не CSV).
- [x] `cfg.emailFetch.*` — 3 поля (`emailFetch.*`).
- [x] `cfg.idle.*` — 2 поля (`idle.*`).
- [x] `cfg.quotas.*` — 2 поля (`limits.maxParticipantsPerMeeting`, `limits.maxMeetingDurationHours`).

**Итого ~64 поля мигрировано в 12 геттерах через `resolveSync` + 6 полей `billing.*` через `getDynamic` (см. ниже).**

### `billing.*` — единый тариф `tier_standard` (2026-05-31)

ТЗ [admin-plans-collapse-to-standard](plans/tz/2026-05-31-admin-plans-collapse-to-standard.md) перевёл цену тарифа и грант встреч в AdminSetting (`category=billing`, `section=tariff-standard`, `severity=high` — `reason` обязателен). Читается через **async** `getDynamic` (а не sync `resolveSync`) — `SeatService` и `MeetingsBalanceService` стали async, все call-site'ы используют `await`.

| Ключ | Тип | Default (code-fallback) |
|---|---|---|
| `billing.baseMonthlyKopecks` | `int >= 0` | `6_000_000` (60 000 ₽) |
| `billing.perExtraSeatKopecks` | `int >= 0` | `100_000` (1 000 ₽) |
| `billing.yearlyDiscountRate` | `0..1` | `0.8` (-20%) |
| `billing.baseSeatsIncluded` | `int > 0` | `31` (1 владелец + 30) |
| `billing.baseMeetingsGrant` | `int >= 0` | `150` (встреч/мес) |
| `billing.perExtraSeatMeetingsGrant` | `int >= 0` | `5` |

Seed — `backend/scripts/seed-admin-settings-billing.ts` (идемпотентный, защищает админ-правки). Активные `Subscription.monthlyPriceKopecks` при правке прайса **не** пересчитываются (зафиксированы на момент покупки/продления).

UI — `/admin/orgs/plans` (одна карточка «Стандартный тариф Z», калькулятор seats, история через `AdminSettingHistoryDrawer`). Остальные ~40 геттеров (`knowledgeCore`, `chatV2`, `curation`, `insights`, `ideas`, `skill`, `persona`, `conversational`, `telegramBot`, `maxBot`, `bot`, `mailInbox`, `bitemporal`, `extraction`, `document`, `brandVoice`, `roleMap`, `betaOps`, `proactive`, `concierge`, `budget`, `tracker`, `companyFoundation`, `processTemplate`, `experiments`, `dataClassPolicy`, `confidenceCalibration`, `temporalProbe`, `signalTypeStats`, `voice`, `invites`, `push`, `router`, `entityIngest`, `projectionRebuild`, `admin`, и пр.) — пока ENV-only, мигрировать по мере необходимости отдельными ТЗ.

ТЗ миграции: [plans/tz/2026-05-25-env-to-admin-setting-call-sites-migration.md](plans/tz/2026-05-25-env-to-admin-setting-call-sites-migration.md).

## Schema-registry для UI

UI-форма для каждой `AdminSetting` рендерится из Zod-схемы — единый источник правды для бэкенда (валидация на save) и фронтенда (рендер поля). Реестр схем — `backend/src/modules/admin/settings/admin-setting-schema-registry.ts`, по `key` отдаёт Zod-схему, severity и человекочитаемое описание. Поле в UI рендерится через [AdminSettingField](frontend/ui/components/admin/AdminSettingField.tsx):

| Zod-тип | UI |
|---|---|
| `z.number()` | Input type=number |
| `z.enum([...])` | Select |
| `z.boolean()` | Switch |
| `z.string()` | Input |
| `z.object({...})` | вложенная форма |

## Bootstrap-сидинг

[backend/scripts/seed-admin-settings.ts](backend/scripts/seed-admin-settings.ts):

- Идемпотент (`upsert` по `key`, см. skill `safe-seed-rules`).
- Заполняет ~140 ключей из текущих ENV.
- Защищает admin-edited данные: если `updatedBy != null` — не перезаписывает.

Запуск: `cd backend && bun run scripts/seed-admin-settings.ts`.

**Батч 5 (2026-06-09, дашборды + загрузка/импорт):** новые ключи зарегистрированы в `admin-setting-schema-registry.ts` и засеиваются **отдельными** идемпотентными сидерами (все в `apply-prod-deploy.ts` STEPS): `seed-admin-setting-dashboard-main.ts` (`dashboard.main_rework.enabled`), `seed-admin-setting-operations-dashboard.ts` (`operations.dashboard_rework.enabled`), `seed-admin-setting-operations-per-person.ts` (`operations.per_person_self_view.enabled`), `seed-admin-setting-me-widgets.ts` (`me.daily_value_widgets.enabled`), `seed-admin-setting-portfolio-health.ts` (`operations.portfolio_health.enabled` + `portfolio.health.{threshold_healthy,threshold_warning,weight_achieved,weight_on_track,weight_at_risk,weight_stalled,weight_dropped}`), `seed-admin-setting-document-attribution.ts` (`documents.ai_attribution.enabled`). Ключи документов `documents.{maxSizeMb,maxFilesPerUpload,acceptedFormats,maxZipSizeMb}` — в `seed-admin-settings.ts`; квота `billing.meetingUploadsPerMonth` — в `seed-admin-settings-billing.ts`. Рубильник загрузки встречи — ENV `MEETING_UPLOAD_ENABLED` (+ AdminSetting `meeting_upload.enabled`). См. [[../02_architecture/module-map]] §«Батч 5».

## Риски и митигации

1. **Crash во время правки → out-of-sync процессы.** HTTP записал в БД, но Redis pub/sub упал — воркер не получил invalidation. **Митигация:** LRU TTL 30s гарантирует max staleness 30 секунд. Для security/retention — 5s.
2. **БД упала → нет настроек.** `getDynamic` падает на ENV-fallback (текущая прод-конфигурация). Логируется `ERROR admin-settings unavailable, falling back to ENV`.
3. **Race при одновременной правке.** Optimistic concurrency через `updatedAt`: если значение в БД новее, чем `updatedAt` из формы — `409 conflict`, UI предложит перечитать.
4. **Перегрузка SELECT'ами.** Knowledge-Core воркер читает порог тысячи раз — LRU отрезает 99.9% этих SELECT'ов.

## UI

- Список — `/admin/ai/knowledge-core` (knowledge-core пороги), `/admin/platform/limits` (MAX_*), `/admin/platform/security` (Argon/JWT TTL), `/admin/media/retention` (RetentionPolicy — отдельная модель), `/admin/platform/flags` (FeatureFlag).
- Хук `useAdminSettingValue<T>(key, fallback?)` — read-only с SWR-revalidate 30s.
- Хук `useAdminSettingEditor(key, opts)` — `{ value, setValue, save, reset, isDirty, isLoading, history, error }`.

## Связанные

- [admin-z-global.md](admin-z-global.md) — общий каркас админки.
- [admin-crons.md](admin-crons.md) — отдельная история со своим override через `CronSchedule`.
- [admin-workers.md](admin-workers.md) — BullMQ-инспектор.
- [admin-content.md](admin-content.md) — контент (типы встреч, email-шаблоны).
