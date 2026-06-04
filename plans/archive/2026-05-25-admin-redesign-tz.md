---
type: tz
status: draft
feature: admin-redesign
date: 2026-05-25
---

> 📦 **АРХИВ (аудит 2026-06-04): 🟢 почти реализовано — 92%.**
> Реализовано по факту почти целиком: все 10 моделей БД, getDynamic, AdminSettingsService + bootstrap + pub/sub, CronManagerService через SchedulerRegistry, все 9 фронт-компонентов и 4 хука, двухуровневый сайдбар и все ~36
> Полный разбор: `plans/analysis/2026-06-04-tz-audit-reestr-i-prioritety.md`


# ТЗ: Редизайн глобальной админки Z-Admin

> Анализ: [plans/analysis/2026-05-25-admin-redesign.md](plans/analysis/2026-05-25-admin-redesign.md)

## Цель

Перестроить глобальную админку (`frontend/app/(authenticated)/admin/*`) в **двухуровневый сайдбар на 8 категорий + 36 разделов с модульными вкладками**, вынести ~140 тюнинг-ENV-переменных в БД (`AdminSetting`) с UI-редактированием, добавить отсутствующие разделы (журнал super_admin, кроны, воркеры, инциденты, Knowledge-Core настройки, тарифы, email-шаблоны, feature flags), и дать оператору Z управлять продуктом без redeploy.

## Scope

**Входит:**
- Новый каркас навигации: двухуровневый сайдбар, компоненты `AdminSection` / `AdminTabs` / `AdminBreadcrumbs` / `AdminDangerZone` / `AdminSparkline`.
- Cmd+K-палитра (`cmdk`) с клиентским индексом + серверным `/admin/search`.
- Модели `AdminSetting`, `Plan`, `FeatureFlag`, `EmailTemplate`, `MeetingType`, `SystemMessage`, `RetentionPolicy`, `CronSchedule`.
- `AdminSettingsService` + LRU TTL 30s + Redis pub/sub `admin:setting:invalidate`.
- Расширение `TypedConfigService.getDynamic<T>(key)`.
- `CronManagerService` для runtime-управления `@nestjs/schedule`.
- Все 36 разделов админки (Пульс / Аналитика / AI / Тенанты / Контент / Каналы / Медиа / Платформа).
- Audit super_admin в UI на основе `SuperAdminAccessLog`.
- CSV/JSON-экспорт всех табличных представлений (один общий хук).
- Sparkline-графики на главном дашборде (recharts).
- Web-Push админу при alert'ах (Фаза 9, можно отложить).

**Не входит:**
- Org-Admin (`/settings/admin/*`) — отдельный шелл для owner Org, не предмет этого ТЗ.
- Server-side guard на NextJS-уровне (бэкенд защищён `SuperAdminGuard`, фронт — клиентский guard как сейчас).
- Полное удаление мигрированных ENV-переменных из `env.schema.ts` — они помечаются `@deprecated` и остаются как fallback на первый старт.
- Маркетинговая html-email-вёрстка (`htmlBody` опционален, MVP — plain text).
- Полное перенесение типов встреч из enum в `MeetingType` — отдельная фича, делается в Фазе 5 только UI; миграция сущностей встреч на FK — отдельным ТЗ.

## Технические изменения

### Backend

**Новые сервисы / модули:**
- `backend/src/modules/admin/settings/admin-settings.service.ts` — get / set / list / history / pub-sub invalidation.
- `backend/src/modules/admin/settings/admin-settings.controller.ts` — `GET/POST /admin/settings`, `GET /admin/settings/:key/history`.
- `backend/src/modules/admin/crons/cron-manager.service.ts` — runtime-управление `SchedulerRegistry`.
- `backend/src/modules/admin/crons/admin-crons.controller.ts` — list / update schedule / toggle enabled / trigger now.
- `backend/src/modules/admin/workers/admin-workers.controller.ts` — BullMQ inspector (queues / active / failed / retry / pause).
- `backend/src/modules/admin/audit/admin-audit.controller.ts` — list `SuperAdminAccessLog` с фильтрами.
- `backend/src/modules/admin/incidents/admin-incidents.controller.ts` — DLQ + failed jobs + alerts.
- `backend/src/modules/admin/search/admin-search.controller.ts` — fuzzy search для Cmd+K (Org / users / meetings).
- `backend/src/modules/admin/content/meeting-types.controller.ts`
- `backend/src/modules/admin/content/email-templates.controller.ts`
- `backend/src/modules/admin/content/system-messages.controller.ts`
- `backend/src/modules/admin/content/global-channels.controller.ts`
- `backend/src/modules/admin/content/copy-strings.controller.ts`
- `backend/src/modules/admin/orgs/plans.controller.ts` — CRUD планов продукта.
- `backend/src/modules/admin/platform/feature-flags.controller.ts` — глобальный default + org overrides + rollout%.
- `backend/src/modules/admin/platform/limits.controller.ts` — глобальные `MAX_*`.
- `backend/src/modules/admin/platform/security.controller.ts` — Argon / JWT TTL / IP-salt / rotation.
- `backend/src/modules/admin/platform/maintenance.controller.ts`.
- `backend/src/modules/admin/media/retention.controller.ts` — `*_RETENTION_DAYS`.
- `backend/src/modules/admin/media/storage.controller.ts` — S3 stats + provider switch.

**Изменения в существующих:**
- [backend/src/common/config/typed-config.service.ts](backend/src/common/config/typed-config.service.ts) — добавить `getDynamic<T>(key, fallbackEnvKey?, defaultValue?): Promise<T>`. Не ломать `get()` (статичный, ENV).
- [backend/src/common/config/env.schema.ts](backend/src/common/config/env.schema.ts) — пометить ~140 переменных как `@deprecated` в JSDoc после миграции; не удалять.
- Все 25+ `@Cron(...)`-декораторов остаются, но `CronManagerService.onModuleInit()` перевешивает их при наличии БД-override.
- Все вызовы `config.get('THEME_COSINE_THRESHOLD')` → `await config.getDynamic('knowledge.theme.cosine_threshold', 'THEME_COSINE_THRESHOLD', 0.78)`.
- `SuperAdminAuditInterceptor` — добавить опциональное поле `reason` в `SuperAdminAccessLog` (для severity high/destructive).

**Новые эндпоинты (REST, префикс `/api/v1/admin`):**
```
GET    /admin/settings                  ?category=&section=
GET    /admin/settings/:key
POST   /admin/settings/:key             { value, reason? }
GET    /admin/settings/:key/history     last 50

GET    /admin/crons                     список всех + статус
PATCH  /admin/crons/:name               { expression?, enabled? }
POST   /admin/crons/:name/run           ручной запуск

GET    /admin/workers/queues
GET    /admin/workers/queues/:name      active / waiting / failed / delayed
POST   /admin/workers/queues/:name/retry-failed
POST   /admin/workers/queues/:name/pause
POST   /admin/workers/queues/:name/resume

GET    /admin/audit                     ?adminId=&entity=&from=&to=
GET    /admin/incidents
GET    /admin/incidents/rules           алерт-правила
POST   /admin/incidents/rules           CRUD

GET    /admin/search                    ?type=org|user|meeting&q=&limit=
GET    /admin/orgs/plans
POST   /admin/orgs/plans
PATCH  /admin/orgs/plans/:id
GET    /admin/orgs/entitlements         глобальный обзор всех override
PATCH  /admin/orgs/:id/entitlements

GET    /admin/content/meeting-types
POST   /admin/content/meeting-types
PATCH  /admin/content/meeting-types/:id
GET    /admin/content/email-templates
POST   /admin/content/email-templates
POST   /admin/content/email-templates/:key/test-send  { to }
GET    /admin/content/system-messages
POST   /admin/content/system-messages   баннеры / maintenance
GET    /admin/content/global-channels
POST   /admin/content/global-channels
GET    /admin/content/copy-strings
PATCH  /admin/content/copy-strings/:key

GET    /admin/platform/feature-flags
PATCH  /admin/platform/feature-flags/:key
GET    /admin/platform/feature-flags/:key/resolve?tenantId=  для отладки
GET    /admin/platform/limits
PATCH  /admin/platform/limits/:key
GET    /admin/platform/security
PATCH  /admin/platform/security
GET    /admin/platform/maintenance
POST   /admin/platform/maintenance/backup-now
POST   /admin/platform/maintenance/reindex-now

GET    /admin/media/retention
PATCH  /admin/media/retention/:type     { days }
GET    /admin/media/storage             S3 buckets stats
POST   /admin/media/storage/switch      { provider }
```

Все эндпоинты под `SuperAdminGuard` + `SuperAdminAuditInterceptor`. Zod-DTO + Swagger обязательны (см. skill `nestjs-rules`).

### База данных

**Новые таблицы** ([backend/prisma/schema.prisma](backend/prisma/schema.prisma)):

```prisma
model AdminSetting {
  key         String   @id          // "knowledge.theme.cosine_threshold"
  value       Json
  category    String                // "ai" | "platform" | "content" | ...
  section     String                // "knowledge-core" | "crons" | ...
  severity    String   @default("low")  // "low" | "medium" | "high" | "destructive"
  schemaHash  String?               // ref на Zod-schema registry
  description String?               // для UI hover-подсказки
  updatedBy   String?
  updatedAt   DateTime @updatedAt
  comment     String?               // последняя причина
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

model Plan {
  id          String   @id          // "tier_basic", "tier_pro", "tier_enterprise"
  displayName String
  description String?
  features    Json                  // { "ai_chat": true, ... }
  quotas      Json                  // { "max_meetings_per_day": 100, ... }
  monthlyPriceRub Int?
  isActive    Boolean  @default(true)
  sortOrder   Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model FeatureFlag {
  key            String   @id
  description    String
  defaultValue   Boolean
  orgOverrides   Json     @default("{}")    // { "tenant_xxx": true }
  rolloutPercent Int?                       // 0-100
  category       String                     // "ai" | "ui" | "experimental"
  updatedBy      String?
  updatedAt      DateTime @updatedAt
}

model EmailTemplate {
  key         String   @id           // "invite_github_style"
  subject     String
  body        String   @db.Text      // Handlebars plain text
  htmlBody    String?  @db.Text
  variables   Json                   // { "name": "имя получателя", ... }
  category    String                 // "transactional" | "marketing" | "system"
  updatedBy   String?
  updatedAt   DateTime @updatedAt
}

model MeetingType {
  id              String   @id        // "interview", "discovery", ...
  displayName     String
  description     String?
  icon            String?
  reportPromptKey String?             // FK на PromptTemplate
  isActive        Boolean  @default(true)
  sortOrder       Int      @default(0)
  updatedBy       String?
  updatedAt       DateTime @updatedAt
}

model SystemMessage {
  id          String   @id @default(cuid())
  type        String                 // "banner" | "maintenance" | "alert"
  severity    String                 // "info" | "warning" | "critical"
  body        String   @db.Text
  startsAt    DateTime?
  endsAt      DateTime?
  isActive    Boolean  @default(true)
  targetOrgs  String[]               // empty = все
  createdBy   String
  createdAt   DateTime @default(now())
  @@index([isActive, startsAt])
}

model RetentionPolicy {
  type        String   @id           // "meeting_recording" | "share_view" | "api_access_log" | ...
  days        Int
  description String?
  updatedBy   String?
  updatedAt   DateTime @updatedAt
}

model CronSchedule {
  name           String   @id        // "email-fetch", "theme-clusterer", ...
  expression     String              // "*/5 * * * *"
  defaultExpression String           // bootstrap-дефолт из @Cron(...)
  enabled        Boolean  @default(true)
  description    String?
  lastRunAt      DateTime?
  lastRunDurationMs Int?
  lastRunError   String?
  updatedBy      String?
  updatedAt      DateTime @updatedAt
}

model CronRunHistory {
  id          String   @id @default(cuid())
  cronName    String
  startedAt   DateTime @default(now())
  durationMs  Int?
  status      String                 // "success" | "failed" | "running"
  error       String?
  triggeredBy String?                // null = scheduled, userId = manual
  @@index([cronName, startedAt])
}
```

**Изменения в существующих:**
- `SuperAdminAccessLog` — добавить колонку `reason String?` для high/destructive операций.
- `OrgEntitlement.tier` — оставить как String (без FK на `Plan.id`, чтобы можно было soft-deactivate план).

**Миграции:**
- `bun run prisma:push` (см. skill `prisma-db-push-rules` — **никогда** `prisma migrate*`).
- После каждой правки моделей — `bun run prisma:generate`.
- Bootstrap-сидинг (one-off скрипт `backend/scripts/seed-admin-settings.ts`):
  - Заполнить `AdminSetting` дефолтами из ENV для ~140 ключей.
  - Заполнить `Plan` тремя планами (basic/pro/enterprise) на основе текущих ENV-лимитов.
  - Заполнить `CronSchedule` всеми `@Cron`-джобами с их текущими expression'ами.
  - Заполнить `EmailTemplate` из текущего [mail.templates.ts](backend/src/modules/mail/mail.templates.ts).
  - Заполнить `RetentionPolicy` из `*_RETENTION_DAYS` ENV.
  - Idempotent (`upsert` по key).
  - См. skill `safe-seed-rules` — admin-edited данные защищаются от перезаписи.

### Frontend

**Новые компоненты** (`frontend/ui/components/admin/`):
- `AdminSection.tsx` — обёртка с хлебными крошками + заголовком + слот для вкладок.
- `AdminTabs.tsx` — `radix-ui/tabs` + URL-driven через `useSearchParams` (`?tab=settings`), lazy-render.
- `AdminBreadcrumbs.tsx`.
- `AdminDangerZone.tsx` — стандартный блок с двойным подтверждением + textarea «причина» для severity high/destructive.
- `AdminSparkline.tsx` — `recharts`, минимальный line chart.
- `AdminCommandPalette.tsx` — `cmdk`, секции (Разделы / Действия / Орги / Юзеры / Встречи), debounce 200ms на server-side секции.
- `AdminSettingField.tsx` — универсальное поле, генерируется из Zod-схемы: `z.number()`→Input, `z.enum()`→Select, `z.boolean()`→Switch, `z.string()`→Input.
- `AdminSettingHistoryDrawer.tsx` — выезжающая панель со списком предыдущих значений.
- `AdminCsvDownloadButton.tsx`.

**Новые хуки** (`frontend/hooks/`):
- `useAdminSettingValue<T>(key, fallback?): T` — read-only, SWR под капотом, revalidate каждые 30s.
- `useAdminSettingEditor(key, opts): { value, setValue, save, reset, isDirty, isLoading, history, error }` — для форм.
- `useAdminCsvExport(rows, columns, filename)` — экспорт текущей таблицы.
- `useAdminCommandPalette()` — открыть/закрыть, регистрация actions.

**Новые страницы** (новые поддеревья):
```
frontend/app/(authenticated)/admin/
├── audit/                              # журнал super_admin
├── incidents/                          # инциденты
├── analytics/
│   ├── orgs/
│   ├── functions/
│   ├── economics/
│   ├── meetings/
│   ├── knowledge/
│   └── concierge/
├── ai/
│   ├── routing/                        # был ai-models, переразложить
│   ├── catalog/                        # объединить prices/providers/models
│   ├── prompts/                        # был, добавить вкладки
│   ├── knowledge-core/                 # настройки порогов
│   └── embeddings/
├── orgs/
│   ├── plans/                          # NEW — глобальные планы продукта
│   └── entitlements/                   # NEW — overrides по Org
├── content/
│   ├── meeting-types/
│   ├── emails/
│   ├── system-messages/
│   ├── global-channels/
│   └── copy/
├── integrations/
│   ├── bots/
│   ├── webhooks/                       # был, добавить вкладки
│   ├── keys/                           # был
│   └── livekit/
├── media/
│   ├── meetings/                       # был
│   ├── expiring/                       # был
│   ├── retention/
│   └── storage/
└── platform/
    ├── crons/
    ├── workers/
    ├── limits/
    ├── flags/
    ├── security/
    └── maintenance/
```

**Изменения в существующих:**
- [AdminShell.tsx](frontend/app/(authenticated)/admin/AdminShell.tsx) — двухуровневая навигация с collapsible-группами, единый accent для всех 8 категорий.
- Все существующие `*Client.tsx` — постепенный переход на `AdminSection`+`AdminTabs`.
- Унифицировать `useAdminQuery` (заменить оставшиеся `useEffect + useState` дубликаты в `PromptsListClient.tsx`, `AiModelsClient.tsx`).
- Унифицировать period-селекторы (везде `day/week/month`, убрать `24h/7d/30d`).
- Удалить раздел `/admin/ai-usage` (помечен `(legacy)`).

### Интеграции

**Внешние сервисы:**
- Redis pub/sub канал `admin:setting:invalidate` — payload `{ key: string }`. Подписываются HTTP-процесс и `workers/main.ts`.
- BullMQ Queue API — `Queue.getJobCounts()`, `Queue.getFailed()`, `Job.retry()`, `Queue.pause()/resume()` (`@bullmq/api`).

**Очереди / воркеры:**
- `workers/main.ts` — добавить bootstrap-подписку на `admin:setting:invalidate` через `RedisService`.
- `CronManagerService` — `onModuleInit` подписывается на `cron.schedule.updated`, через `SchedulerRegistry` переподписывает Cron-job'ы.

## Критерии готовности (DoD)

- [ ] Двухуровневый сайдбар работает на всех 36 разделах, все URL открываются без 404.
- [ ] `AdminSection`+`AdminTabs` используется минимум на 30 из 36 разделов; URL-driven `?tab=...` работает.
- [ ] Cmd+K-палитра открывается на любой странице админки, ищет по разделам/действиям/Org/юзерам/встречам.
- [ ] `AdminSetting` БД-таблица + сервис + LRU-кэш + Redis pub/sub работают: правка значения через `/admin/settings/:key` инвалидируется во всех процессах за <1s.
- [ ] `TypedConfigService.getDynamic()` возвращает БД-override; при отсутствии записи — ENV-fallback; при отсутствии ENV — default-аргумент.
- [ ] Bootstrap-сидинг (`bun run seed-admin-settings`) идемпотентен и заполняет ~140 ключей.
- [ ] `CronManagerService` корректно переподписывает `SchedulerRegistry` при изменении расписания через UI — проверено на 2+ кронах.
- [ ] Audit super_admin показывает все правки, `reason` обязателен для `severity: high|destructive`.
- [ ] CSV-экспорт работает на 5+ таблицах.
- [ ] Sparkline-графики на `/admin` показывают расход за 30 дней.
- [ ] `bun run typecheck` (backend и frontend) — зелёный.
- [ ] `bun run lint` (backend и frontend) — зелёный.
- [ ] `bun run test:unit` — все существующие тесты проходят.
- [ ] Новые сервисы (`AdminSettingsService`, `CronManagerService`, resolution `FeatureFlag`) покрыты unit-тестами.
- [ ] `bun run build` (backend и frontend) — без ошибок.
- [ ] Ручная проверка: оператор может изменить `THEME_COSINE_THRESHOLD` через UI, и воркер `theme-clusterer` в следующем запуске использует новое значение (через лог).
- [ ] Ручная проверка: оператор может отключить крон `email-fetch` через UI, следующий tick не выполняется.
- [ ] Ручная проверка: оператор может изменить email-шаблон `invite_github_style` через UI и отправить тестовое письмо себе.
- [ ] Second Brain обновлён: [admin-z-global.md](second-brain/01_projects/admin-z-global.md) полностью переписан, добавлены [admin-settings.md](second-brain/01_projects/admin-settings.md), [admin-crons.md](second-brain/01_projects/admin-crons.md), [admin-workers.md](second-brain/01_projects/admin-workers.md), [admin-content.md](second-brain/01_projects/admin-content.md). [module-map.md](second-brain/02_architecture/module-map.md) и [api-layer.md](second-brain/01_projects/api-layer.md) обновлены под новые модули и эндпоинты.

## Риски и ограничения

1. **Crash во время правки настройки → out-of-sync процессы.** Если HTTP-процесс записал в БД, но не успел опубликовать в Redis — воркеры пропустят invalidation. **Митигация:** LRU TTL 30s гарантирует, что max staleness = 30 секунд. Для критичных настроек (security, retention) — TTL 5s.

2. **БД упала → кроны не работают.** Если `CronManagerService.onModuleInit()` не сможет прочитать `CronSchedule`, кроны не зарегистрируются. **Митигация:** при ошибке БД → fallback на `@Cron(...)`-дефолты, написать ERROR-лог, продолжить. Дефолты всегда работают.

3. **Race condition при одновременной правке.** Два super_admin'а одновременно правят одну настройку. **Митигация:** optimistic concurrency через `updatedAt` (если изменилось — отказ + предложить пересмотреть).

4. **Перегрузка `AdminSetting` SELECT'ами.** Knowledge-Core воркер читает порог тысячи раз в час. **Митигация:** LRU-кэш с TTL 30s гарантирует, что в БД пойдёт ≤2 SELECT'а в минуту на ключ на процесс.

5. **Миграция ~140 ENV — большой blast radius.** Если что-то сломается — может затронуть все воркеры одновременно. **Митигация:** мигрируем поэтапно (Фаза 0 — только инфра, без переключения; в каждой следующей фазе — миграция одной группы ENV с отдельным тестированием на стейдже).

6. **Email-шаблоны в БД vs handlebars-source.** Если оператор сломает синтаксис `{{...}}` — письма перестанут отправляться. **Митигация:** валидация handlebars-AST на save + обязательное «тестовое отправление» перед сохранением.

7. **`bullmq` API не во всех версиях стабилен** для `getFailed()/retry()`. **Митигация:** перед стартом Фазы 8 — `mcp__context7__query-docs` по BullMQ.

8. **Параллельные сессии Claude Code** (memory `feedback_parallel_sessions_git_check`). До запуска агента на каждую фазу — `git fetch + git log --since=1h`.

## Фазы реализации

### Фаза 0 — Фундамент (каркас + БД)
- [ ] Добавить модели `AdminSetting`, `AdminSettingHistory`, `Plan`, `FeatureFlag`, `EmailTemplate`, `MeetingType`, `SystemMessage`, `RetentionPolicy`, `CronSchedule`, `CronRunHistory` в [schema.prisma](backend/prisma/schema.prisma).
- [ ] `bun run prisma:push && bun run prisma:generate`.
- [ ] `AdminSettingsService` + LRU-кэш + Redis pub/sub.
- [ ] `TypedConfigService.getDynamic()`.
- [ ] `CronManagerService` (без UI пока, только инфра).
- [ ] Bootstrap-сидинг `backend/scripts/seed-admin-settings.ts`.
- [ ] Компоненты `AdminSection`, `AdminTabs`, `AdminBreadcrumbs`, `AdminDangerZone`, `AdminSparkline`, `AdminSettingField`, `AdminSettingHistoryDrawer`, `AdminCsvDownloadButton`.
- [ ] Хуки `useAdminSettingValue`, `useAdminSettingEditor`, `useAdminCsvExport`.
- [ ] `AdminCommandPalette` (`cmdk`).
- [ ] Двухуровневый сайдбар в `AdminShell`.
- [ ] Unit-тесты для `AdminSettingsService`, `CronManagerService`.

### Фаза 1 — Пульс компании
- [ ] Новый `/admin` с KPI + sparkline (recharts).
- [ ] `/admin/health` → вкладки (Очереди / БД / Эмбеддинги / Воркеры / S3 / LiveKit).
- [ ] `/admin/audit` — журнал super_admin.
- [ ] `/admin/incidents` — DLQ + failed jobs + правила алертов.

### Фаза 2 — Аналитика (read-only)
- [ ] Перенести `/admin/usage/*` под `/admin/analytics/*`, очистить от управления.
- [ ] `/admin/analytics/knowledge` (новый).
- [ ] `/admin/analytics/concierge` (новый).
- [ ] CSV-экспорт всех таблиц.

### Фаза 3 — AI и модели
- [ ] `/admin/ai/routing` — переразложить ai-models на вкладки.
- [ ] `/admin/ai/catalog` — слить prices/providers/models.
- [ ] `/admin/ai/prompts` — добавить вкладки.
- [ ] **`/admin/ai/knowledge-core`** — UI ~40 порогов через `AdminSettingField`.
- [ ] `/admin/ai/embeddings`.
- [ ] Smoke-test провайдеров с кнопкой «Запустить».

### Фаза 4 — Тенанты и тарифы
- [ ] `/admin/orgs/[id]` — переразложить на 7 вкладок.
- [ ] `/admin/orgs/plans` — CRUD планов.
- [ ] `/admin/orgs/entitlements` — глобальный обзор overrides.
- [ ] Мигрировать `MAX_*` ENV в `AdminSetting`.

### Фаза 5 — Контент продукта
- [ ] `/admin/content/meeting-types`.
- [ ] `/admin/content/emails` — мигрировать `mail.templates.ts` → БД, тестовое отправление.
- [ ] `/admin/content/system-messages`.
- [ ] `/admin/content/global-channels` — заменить seed.
- [ ] `/admin/content/copy`.

### Фаза 6 — Каналы и интеграции
- [ ] `/admin/integrations/bots` — Telegram/Max/Email-inbox.
- [ ] `/admin/integrations/webhooks` — вкладки.
- [ ] `/admin/integrations/livekit`.

### Фаза 7 — Записи и медиа
- [ ] `/admin/media/retention` — `RetentionPolicy` UI.
- [ ] `/admin/media/storage`.
- [ ] `/admin/media/meetings` + `/admin/media/expiring` — переразложить.

### Фаза 8 — Платформа
- [ ] **`/admin/platform/crons`** — UI `CronSchedule`.
- [ ] **`/admin/platform/workers`** — BullMQ inspector.
- [ ] `/admin/platform/limits`.
- [ ] `/admin/platform/flags` — глобальные + Org overrides (без rollout%).
- [ ] `/admin/platform/security`.
- [ ] `/admin/platform/maintenance`.

### Фаза 9 — Полировка
- [ ] Rollout-percent для feature flags.
- [ ] Web-Push админу при alert'ах.
- [ ] Удалить `/admin/ai-usage` (legacy).
- [ ] Унификация period-селекторов.
- [ ] Заменить оставшиеся `useEffect + useState` на `useAdminQuery`.
- [ ] Финальный проход по всем разделам, унификация UX.
- [ ] Обновить [admin-z-global.md](second-brain/01_projects/admin-z-global.md), создать сопутствующие заметки в `second-brain/01_projects/`.

## Итог

_Заполняется по факту реализации._
