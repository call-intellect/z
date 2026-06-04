---
type: tz
status: draft
feature: admin-operations-log
date: 2026-05-25
---

> 📦 **АРХИВ (аудит 2026-06-04): ⬜ не делалось (заменено/отменено) — 0%.**
> Функциональная цель (UI super_admin для просмотра сбоев фоновых процессов с фильтрами/поиском/экспортом) полностью закрыта более новым и более чистым ТЗ 2026-06-01-logging-module (модель SystemLog, LoggingModule, /admin/
> ⚠️ Хвосты (см. реестр приоритетов): Открытые вопросы 1-7 (sampling, retention, Org-доступ, export-лимит, алерты, info HTTP success, WORKER_INSTANCE) так и н
> Полный разбор: `plans/analysis/2026-06-04-tz-audit-reestr-i-prioritety.md`


# ТЗ: Журнал операций (Operations Log) в Z-Admin

> Анализ: см. раздел «Контекст и обоснование» ниже — отдельного analysis-файла не делаем, фича прикладная и базируется на существующих фактах.
> Связанные ТЗ: `2026-05-23-admin-redesign-phase-1.md` (где появились `/admin/audit` и `/admin/incidents`).

## Цель

Дать super_admin **одну вкладку в админке**, через которую видно «что сейчас работает / что упало» по всем фоновым процессам Z (cron, BullMQ-воркеры, AI-агенты, webhooks, HTTP-ошибки), c фильтрами, поиском, drill-down и копированием логов за период — без захода на сервер.

## Контекст и обоснование

В Z уже есть **частичные** источники логов:

| Что | Хранение | UI | Покрывает |
|---|---|---|---|
| `AiUsageLog` | Postgres (~100k/мес) | `/admin/ai-usage`, `/admin/analytics/functions` | Все LLM-вызовы (success/errorText, costUsd, durationMs, model, taskType) |
| `WebhookDelivery` | Postgres | `/admin/webhooks` | Исходящие tracker-webhooks (attempts, status, lastResponse) |
| `MailInboundLog` | Postgres | — (пока нет) | Входящие email (T5) |
| `SuperAdminAccessLog` | Postgres | `/admin/audit` | Действия super_admin (через `SuperAdminAuditInterceptor`) |
| `AuditLog` | Postgres | — | User-actions внутри Org (action + resource) |
| `ApiAccessLog` | Postgres | — | Публичные API-вызовы по API-ключу |
| Failed BullMQ jobs | **Redis (TTL)** | `/admin/incidents` | Live-выборка через `Queue.getFailed()`; **исчезает** по TTL |
| Cron tick'и (start/finish/error) | **stdout** | — | Не персистится |
| Внутренние warn/error в сервисах | **stdout (`Logger`)** | — | Не персистится |
| HTTP 4xx/5xx | **stdout** (`AllExceptionsFilter`) | — | Не персистится |

**Проблемы:**
1. Половина «живого» — только в stdout/Redis; на проде уйдёт в `docker logs` и **исчезнет** после рестарта/TTL.
2. Нет единого места «посмотреть, что ломалось за сутки».
3. Невозможно скопировать ошибку → принести в чат-обсуждение без `kubectl logs` / SSH.
4. Failed jobs из Redis могут пропасть, если BullMQ их удалит до того, как админ заметил.

**Решение:** добавить универсальный системный журнал `OperationLog` для **не-доменных** событий (cron / BullMQ / HTTP-ошибки / internal events) + UI-витрину `/admin/logs`, которая агрегирует ВСЕ источники (включая существующие доменные таблицы) с единым набором фильтров.

**Принципиально не дублируем** доменные таблицы — `/admin/logs/ai`, `/admin/logs/webhooks`, `/admin/logs/audit` читают из `AiUsageLog`, `WebhookDelivery`, `SuperAdminAccessLog`. `OperationLog` хранит только то, для чего нет специализированной таблицы.

## Scope

**Входит:**
- Prisma-модель `OperationLog` + индексы.
- `OperationLogService` (in-process буфер + batch INSERT + redaction + sampling).
- 3 «production listeners» пишут в `OperationLog`:
  - `BullMQOperationLogListener` — глобальный `QueueEvents` на все известные очереди (источник — `AdminIncidentsService.getKnownQueueNames()`).
  - `CronOperationLogger` — декоратор/обёртка для `@Cron` методов: фиксирует start/finish/error/durationMs.
  - `AllExceptionsFilter` дополнительно пишет 5xx и выбранные 4xx (`429`, `503`, доменные `unauthorized` админ-ручек).
- `OperationLogService.record({...})` — публичное API для **явных** записей из сервисов (anomaly detection, fallback triggered, важные business-события).
- Cron `operation-log-purge.cron.ts` — retention.
- Backend API `/api/v1/admin/logs/*`:
  - `GET /api/v1/admin/logs` — единая выборка с фильтром `source` (один из: `operation`, `ai_usage`, `webhook`, `mail_inbound`, `audit_admin`, `audit_user`, `api_access`).
  - `GET /api/v1/admin/logs/:source/:id` — детали записи (полный payload + stack).
  - `GET /api/v1/admin/logs/stats` — сводка за период (count по severity и source).
  - `GET /api/v1/admin/logs/export` — NDJSON для копирования.
- Frontend `/admin/logs` — таблица + сайдбар фильтров + drill-down + copy/export.
- Prometheus-метрики (`z_operation_log_*`).
- Documentation в `second-brain/01_projects/operations-log.md`.

**Не входит (MVP):**
- Алерты по правилам (email/push при N ошибок) — отдельное ТЗ, опираться на существующий MVP-stub в `AdminIncidentsService.rules`.
- Внешние destinations (Loki, Elasticsearch, Sentry) — добавим, когда поток превысит ~1M событий/день.
- Per-Org доступ — журнал смотрит только `super_admin` в MVP. Org-admin виджет «мои инциденты» — следующая фаза.
- Полнотекстовый поиск через `tsvector` — в MVP `ILIKE` по `message` (если поток вырастет, перейдём на `pg_trgm` + GIN).
- Streaming WebSocket / Server-Sent Events — в MVP polling раз в 5 сек с авто-обновлением (опц. toggle в UI).
- Перенос исторических данных из stdout / `docker logs` — пишем только новое.

## Архитектурный обзор

```
┌────────────────────────────────────────────────────────────────┐
│                          HTTP-app (NestJS)                      │
│  ┌────────────────┐  ┌──────────────────┐  ┌──────────────┐    │
│  │AllExceptionsF. │  │ Cron @Cron methods│  │ Сервисы (явно)│   │
│  └────────┬───────┘  └─────────┬────────┘  └──────┬────────┘   │
│           │                    │                  │            │
│           └──────────►  OperationLogService  ◄────┘            │
│                                │                               │
│                         in-memory buffer (≤1000)               │
│                         flush: 2s OR 100 items                 │
│                                │                               │
└────────────────────────────────┼───────────────────────────────┘
                                 ▼
┌────────────────────────────────────────────────────────────────┐
│                       worker-app (NestJS)                       │
│  ┌─────────────────────────────────────────┐                   │
│  │ BullMQOperationLogListener              │                   │
│  │ — один QueueEvents на каждую очередь   │                   │
│  │   из getKnownQueueNames()              │──► OperationLog   │
│  │ — completed (sampled) / failed (all)   │     Service       │
│  └─────────────────────────────────────────┘                   │
│  ┌─────────────────────────────────────────┐                   │
│  │ Cron @Cron методы в worker-app тоже    │──► OperationLog   │
│  │ пишут через тот же сервис              │     Service       │
│  └─────────────────────────────────────────┘                   │
└────────────────────────────────┼───────────────────────────────┘
                                 ▼
                         Postgres: operation_log
                                 │
              ┌──────────────────┴──────────────────┐
              ▼                                     ▼
      AdminLogsController                    operation-log-purge.cron
      (читает + агрегирует                   (retention 30/90/180 d)
       из 7 источников)
              │
              ▼
        /admin/logs (UI)
```

**Ключевые решения:**
1. **HTTP-app и worker-app пишут в одну таблицу** через тот же сервис — DI одинаковый, схема общая.
2. **Не блокируем критический путь.** Запись в БД — асинхронная batch (через буфер). При фейле INSERT'а — пишем в `Logger.error` (stdout) и дропаем буфер (без бесконечного retry).
3. **Sampling info-уровня.** ENV `OPERATION_LOG_INFO_SAMPLING=10` (1/10) — для completed-jobs и cron-finish без ошибок. Warn/Error/Fatal — пишем всегда.
4. **Redaction секретов.** В `record()` прогон через `redactSecrets(payload)` — рекурсивно ищем ключи из списка (`password`, `token`, `apiKey`, `cookie`, `authorization`, `secret`, `*_key`) → `'[REDACTED]'`. Список — константа `OPERATION_LOG_REDACT_KEYS`.
5. **Payload truncation.** `JSON.stringify(payload).slice(0, 8192)` + флаг `payloadTruncated:true`.
6. **Корреляция через `correlationId`.** Источники:
   - HTTP: `req.id` (уже выставляется `RequestIdMiddleware`).
   - BullMQ: `job.id`.
   - Cron: `<cronName>:<runId-uuid>`.
   - Internal: caller передаёт.

## Технические изменения

### База данных

#### Новая модель `OperationLog`

```prisma
model OperationLog {
  id              String              @id @default(cuid())

  /// Время события.
  occurredAt      DateTime            @default(now())

  /// Уровень — info/warn/error/fatal. По severity рассчитывается retention.
  severity        OperationLogSeverity

  /// Источник события — что породило запись.
  /// Перечень: см. enum OperationLogSource.
  source          OperationLogSource

  /// Тип операции в рамках источника.
  /// Примеры: BullMQ — `block-ingest.completed` / `block-ingest.failed`;
  /// Cron — `theme-clusterer.start` / `theme-clusterer.finish`;
  /// HTTP — `POST /api/v1/meetings.error`;
  /// Internal — `llm-router.fallback-triggered`.
  operation       String

  /// `success` | `failure` | `partial` — короткий маркер для фильтра.
  status          OperationLogStatus

  /// Человекочитаемое сообщение (для table view).
  message         String              @db.Text

  /// Длительность операции в мс (NULL если событие точечное).
  durationMs      Int?

  /// Корреляция: HTTP requestId / BullMQ jobId / cron runId / другой.
  correlationId   String?

  /// Привязка к Org. NULL = глобальное / системное событие.
  tenantId        String?
  tenant          Org?                @relation(fields: [tenantId], references: [id], onDelete: SetNull)

  /// Привязка к user, если действие пользовательское (4xx).
  userId          String?
  user            User?               @relation(fields: [userId], references: [id], onDelete: SetNull)

  /// Структурированные детали — payload, params, error context.
  /// Проходит через redaction и truncation (≤8 KB).
  payload         Json?

  /// Stack trace для error/fatal — отдельным TEXT, чтобы фильтр по message
  /// не ловил stack-строки.
  errorStack      String?             @db.Text

  /// Имя процесса/host'а — для разделения http-app vs worker-app.
  processName     String

  /// Маркер «payload был обрезан». UI рисует ⚠ «обрезано».
  payloadTruncated Boolean            @default(false)

  @@index([occurredAt(sort: Desc), id(sort: Desc)])
  @@index([severity, occurredAt])
  @@index([source, occurredAt])
  @@index([tenantId, occurredAt])
  @@index([correlationId])
  @@index([operation, occurredAt])
}

enum OperationLogSeverity {
  info
  warn
  error
  fatal
}

enum OperationLogSource {
  bullmq          // BullMQ QueueEvents
  cron            // @Cron-методы
  http            // AllExceptionsFilter (4xx/5xx)
  worker          // воркер бросил ошибку до того, как BullMQ её ловит
  internal        // явный вызов OperationLogService.record(...)
  startup         // приложение стартовало / упало при bootstrap
}

enum OperationLogStatus {
  success
  failure
  partial
}
```

**Объём.** Грубая оценка: ~50k записей/день на текущем dev-трафике (90% completed-jobs из BullMQ, после sampling 1/10 → ~5k+ ~500 error). За 30 дней — 150k записей × ~3 KB = ~450 MB. Жить можно без партиционирования. Если поток вырастет до >5M/мес — добавим pg_partman по `occurredAt`.

**Миграция.** Только `bun run prisma:push` (см. skill `prisma-db-push-rules`).

### Backend

#### Новый модуль `common/operation-log/`

```
backend/src/common/operation-log/
├── operation-log.module.ts
├── operation-log.service.ts        ← buffer + flush + redact + truncate
├── operation-log.constants.ts      ← REDACT_KEYS, sampling rates
├── redact-secrets.ts               ← рекурсивный walker
├── truncate-payload.ts             ← stable JSON-stringify + slice
└── operation-log.service.spec.ts
```

`OperationLogService` API:

```typescript
interface RecordInput {
  severity: 'info' | 'warn' | 'error' | 'fatal';
  source: OperationLogSource;
  operation: string;
  status?: 'success' | 'failure' | 'partial';   // default: success для info, failure для error/fatal
  message: string;
  durationMs?: number;
  correlationId?: string;
  tenantId?: string;
  userId?: string;
  payload?: Record<string, unknown>;
  error?: unknown;                              // Error → stack автоматически
}

class OperationLogService implements OnModuleDestroy {
  record(input: RecordInput): void;             // sync API, кладёт в буфер
  async flush(): Promise<void>;                 // принудительный flush
  async onModuleDestroy(): Promise<void>;       // graceful flush
}
```

Внутри:
- `record()` применяет sampling для `info`, redaction для payload, truncate.
- Буфер `OperationLog[]` ≤ 1000. При переполнении — drop info, оставить warn/error.
- `setInterval(flush, 2000)` + flush при `buffer.length >= 100`.
- `flush()` — `prisma.operationLog.createMany({ data, skipDuplicates: true })`. При ошибке — `nest Logger.error('OperationLog flush failed', err)` + дроп (НЕ retry, иначе в инциденте затопим Redis-очередь).
- prom-метрики: `z_operation_log_records_total{severity, source}`, `z_operation_log_buffer_size` (gauge), `z_operation_log_flush_duration_seconds` (histogram), `z_operation_log_dropped_total{reason}`.

#### Listeners / интеграция

1. **`BullMQOperationLogListener`** — `common/operation-log/bullmq-listener.ts`:
   - Регистрируется ТОЛЬКО в worker-process (через ENV `WORKER_INSTANCE=true`).
   - Создаёт `QueueEvents` для каждого имени из `AdminIncidentsService.getKnownQueueNames()`.
   - На `completed` → `record({severity:'info', source:'bullmq', operation:'<queue>.completed', status:'success', durationMs, payload:{returnvalue}})`. Sampling по `OPERATION_LOG_INFO_SAMPLING`.
   - На `failed` → `record({severity:'error', source:'bullmq', operation:'<queue>.failed', status:'failure', payload:{failedReason, attemptsMade}, error: stacktrace[0]})` — **всегда**.
   - На `stalled` → `severity:'warn'`.
   - Lifecycle: `onModuleInit` создать, `onModuleDestroy` закрыть.

2. **`@LogCron(name)` декоратор** — оборачивает `@Cron`-метод:
   - До: `record({severity:'info', source:'cron', operation:'<name>.start', correlationId:<uuid>})` (sampled).
   - После success: `record({severity:'info', ..., operation:'<name>.finish', durationMs})` (sampled).
   - После throw: `record({severity:'error', ..., operation:'<name>.error', durationMs, error, payload:{thrownAfter:msFromStart}})`.
   - В первой версии: применить к `~30` критическим cron'ам (operations-daily-digest, theme-clusterer, imap-poll, ...). Полный список — в Фазе 4.

3. **`AllExceptionsFilter`** дополнить:
   - После своего `this.logger.error/warn(...)` — `operationLogService.record(...)`.
   - Severity: 5xx → `error`, 401/403 → `warn` для админ-ручек (route startsWith `/api/v1/admin/`), остальное 4xx → не пишем (шум).
   - `source:'http'`, `correlationId: requestId`.
   - **Не блокирующее.** Если `OperationLogService` сломается — фильтр не должен крашить response.

#### Новый модуль `admin/logs/`

```
backend/src/modules/admin/logs/
├── admin-logs.module.ts
├── admin-logs.controller.ts        ← /api/v1/admin/logs/*
├── admin-logs.service.ts           ← агрегирует 7 источников
├── source-readers/
│   ├── operation-log.reader.ts
│   ├── ai-usage.reader.ts
│   ├── webhook-delivery.reader.ts
│   ├── mail-inbound.reader.ts
│   ├── super-admin-access.reader.ts
│   ├── audit-log.reader.ts
│   └── api-access-log.reader.ts
├── dto/
│   ├── admin-logs-list.dto.ts      ← FiltersDto через nestjs-zod
│   ├── admin-logs-detail.dto.ts
│   └── admin-logs-stats.dto.ts
└── admin-logs.service.spec.ts
```

**Каждый Reader** возвращает унифицированный `LogItem`:
```typescript
interface LogItem {
  id: string;
  source: LogSource;                // 'operation' | 'ai_usage' | 'webhook' | ...
  occurredAt: Date;
  severity: LogSeverity;            // вычисляется per source
  status: 'success' | 'failure' | 'partial';
  operation: string;                // 'block-distill.completed' | 'POST /api/v1/meetings' | 'llm:block-distill@deepseek' | ...
  message: string;
  durationMs: number | null;
  tenantId: string | null;
  userId: string | null;
  correlationId: string | null;
  payloadPreview: Record<string, unknown>;  // первые 256B полезного
  hasPayload: boolean;
}
```

**Severity-маппинг для существующих источников:**
- `AiUsageLog.success=false` → `error`; иначе `info`.
- `WebhookDelivery.status='failed'` → `error`; `pending` после ретраев → `warn`; `delivered` → `info`.
- `MailInboundLog.status='bounced'|'failed'` → `error|warn`.
- `SuperAdminAccessLog` всегда → `info` (это history действий, не ошибок).
- `AuditLog` — severity по `action` (mapping list, default `info`).

#### Эндпоинты

| Метод | Route | Описание |
|---|---|---|
| GET | `/api/v1/admin/logs` | Лента с фильтрами + cursor pagination (lim≤200). |
| GET | `/api/v1/admin/logs/:source/:id` | Детали (full payload + stack). |
| GET | `/api/v1/admin/logs/stats` | За период: count по severity × source. |
| GET | `/api/v1/admin/logs/export` | NDJSON, фильтры те же, лимит 10000. `Content-Disposition: attachment`. |
| GET | `/api/v1/admin/logs/sources` | Список доступных источников + total count за 24h (для сайдбара UI). |
| DELETE | `/api/v1/admin/logs/operation-log/:id` | Удалить запись (только source=`operation`). Только для super_admin. |
| POST | `/api/v1/admin/logs/operation-log/purge` | Принудительный prune (фильтр: severity+age). Audit-записывается. |

**Защита:** `CookieAuthGuard + SuperAdminGuard + SuperAdminAuditInterceptor` (как `/admin/audit`).

#### FiltersDto (через nestjs-zod, см. skill `nestjs-rules`)

```typescript
const ListLogsFiltersSchema = z.object({
  source: z.array(z.enum(LOG_SOURCES)).optional(),       // default: все
  severity: z.array(z.enum(['info','warn','error','fatal'])).optional(),
  status: z.array(z.enum(['success','failure','partial'])).optional(),
  tenantId: z.string().cuid().optional(),
  userId: z.string().cuid().optional(),
  operation: z.string().optional(),                       // ILIKE
  q: z.string().optional(),                               // ILIKE по message
  correlationId: z.string().optional(),
  from: z.coerce.date().optional(),                       // default: now-24h
  to: z.coerce.date().optional(),                         // default: now
  cursor: z.string().optional(),                          // base64(occurredAt+id+source)
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
```

Cursor multi-source — base64(JSON `[{source, occurredAt, id}, ...]`). Сервис делает `Promise.all` по readers с фильтром-окном и **merge-сортирует** локально (k-way). Лимит на reader = `limit + 1` (для hasMore).

#### Retention cron

`operation-log-purge.cron.ts` — `0 4 * * *` (раз в сутки, 04:00 UTC):
- delete `severity='info'` AND `occurredAt < now - OPERATION_LOG_RETENTION_INFO_DAYS` (default 30).
- delete `severity='warn'` AND `occurredAt < now - OPERATION_LOG_RETENTION_WARN_DAYS` (default 90).
- delete `severity IN ('error','fatal')` AND `occurredAt < now - OPERATION_LOG_RETENTION_ERROR_DAYS` (default 180).
- WorkerOrgGate **не применяется** (это глобальный системный cron).
- Метрика: `z_operation_log_purged_total{severity}`.

#### ENV (через `env.schema.ts`)

```
OPERATION_LOG_ENABLED=true
OPERATION_LOG_INFO_SAMPLING=10                # 1 из N info-событий записывается
OPERATION_LOG_FLUSH_INTERVAL_MS=2000
OPERATION_LOG_FLUSH_BATCH_SIZE=100
OPERATION_LOG_BUFFER_LIMIT=1000
OPERATION_LOG_PAYLOAD_MAX_BYTES=8192
OPERATION_LOG_RETENTION_INFO_DAYS=30
OPERATION_LOG_RETENTION_WARN_DAYS=90
OPERATION_LOG_RETENTION_ERROR_DAYS=180
OPERATION_LOG_PURGE_CRON=0 4 * * *
```

Все читаются ТОЛЬКО через `TypedConfigService`, никаких `process.env.*` в коде (skill `nestjs-rules`).

### Frontend

#### Новая страница `/admin/logs`

Файлы:
```
frontend/app/(authenticated)/admin/logs/
├── page.tsx                        ← server-render оболочка
├── AdminLogsClient.tsx             ← основной UI (SWR + state)
├── LogsTable.tsx                   ← виртуализированная таблица (TanStack Table)
├── LogsFilters.tsx                 ← сайдбар фильтров
├── LogDetailDrawer.tsx             ← drawer с full payload + stack + copy
├── LogsToolbar.tsx                 ← период, refresh-toggle, export
└── useLogs.ts                      ← SWR hook (infinite)

frontend/src/api/admin-logs.api.ts
frontend/src/domain/admin-log.ts
frontend/src/hooks/useAdminLogsExport.ts
```

**Слои:** ApiDto → DomainModel → UiModel (см. skill `frontend-rules`). API через единый `apiClient`.

**Раскладка (mobile-first, см. `feedback_concierge_entry_visible_button.md`):**
- **Шапка**: переключатель периода (1ч / 24ч / 7д / Custom), бейдж счётчиков ошибок за период, тумблер «Авто-обновление 5с», кнопка «Экспорт NDJSON».
- **Левая колонка (фильтры)**:
  - Источник (мультиселект, дефолт: все, показывает count'ы из `/sources`).
  - Уровень: info / warn / error / fatal (мультиселект; дефолт: warn+error+fatal).
  - Статус: success / failure / partial.
  - Org (селектор tenant'а).
  - Operation (текст, ILIKE).
  - Поиск по сообщению `q`.
  - CorrelationId (точное совпадение).
- **Центр**: виртуализированная таблица.
  - Колонки: время (HH:MM:SS, тултип ISO), уровень (цветной чип), источник, операция, статус, длительность, org, краткое сообщение.
  - Цветовая разметка: error — красный фон бейджа, warn — оранжевый, info — серый.
  - Клик → открывает drawer.
  - Подгрузка по скроллу (cursor pagination).
- **Drawer (детали)**:
  - Шапка: severity, source, operation, время, correlationId.
  - Кнопки: «Копировать запись (JSON)», «Копировать stack», «Открыть связанные» (если есть `correlationId` — отдельная страница `/admin/logs?correlationId=...`).
  - Tab «Payload» — JSON-prettyprint с syntax highlight.
  - Tab «Stack» — preformatted text (если есть).
  - Tab «Контекст» — для http — request body/headers (после redact); для bullmq — jobId + ссылка на `/admin/incidents`; для cron — runId + предыдущий и следующий запуски.

**Все строки UI — только русский** (см. `feedback_admin_ui_russian_only.md`). Глоссарий копи добавить в `frontend/src/copy/admin-logs.copy.ts`.

#### Навигация

В `frontend/app/(authenticated)/admin/navigation.ts` добавить раздел «Пульс → Журнал логов» рядом с «Пульс → Инциденты» и «Пульс → Безопасность → Журнал super_admin».

### Интеграции

- **BullMQ** — глобальный `QueueEvents` listener (worker-process only).
- **`@nestjs/schedule`** — оборачивание `@Cron`-методов через декоратор `@LogCron(name)`.
- **Prometheus** — новые counter/gauge/histogram (через `business-metrics.service.ts`).
- **`SuperAdminAuditInterceptor`** — все обращения к `/admin/logs/*` логируются в `SuperAdminAccessLog` (рекурсия безопасна: чтение журнала логов записывается в SuperAdminAccessLog, не в operation_log).

## Критерии готовности (DoD)

- [ ] `prisma:push` применён, `prisma:generate` выполнен.
- [ ] `OperationLogService` юнит-тесты: redaction (≥10 кейсов), truncation, sampling, flush-on-destroy, buffer overflow drop.
- [ ] `BullMQOperationLogListener` интеграционный тест: фейл одной job → запись в БД с правильным severity/operation/correlationId.
- [ ] `@LogCron` декоратор: тест что start/finish/error всегда записывается, durationMs ≥ 0.
- [ ] `AllExceptionsFilter` тест: 500 → запись `error`, 401 на админ-ручке → запись `warn`, 404 на user-ручке → НЕТ записи.
- [ ] `AdminLogsService.list` тест: merge 3+ readers, корректность cursor pagination, фильтр работает.
- [ ] `AdminLogsService.export` тест: NDJSON-формат, без trailing newline, `Content-Disposition` заголовок.
- [ ] E2E: super_admin заходит на `/admin/logs`, фильтрует «error за 24ч», копирует ошибку — текст копии валиден.
- [ ] Non-super_admin получает 403 → UI показывает `AdminForbidden`.
- [ ] Метрики `z_operation_log_*` появляются в `/metrics`.
- [ ] `operation-log-purge.cron` тест: записи старше retention удаляются, метрика инкрементируется.
- [ ] `bun run typecheck`, `bun run lint`, `bun run build`, `bun run test:unit`, `bun run test:integration` — зелёные.
- [ ] `second-brain/01_projects/operations-log.md` создан и проиндексирован в `second-brain/index.md`.
- [ ] `second-brain/01_projects/admin.md` — добавлен пункт `/admin/logs`.
- [ ] `second-brain/02_architecture/module-map.md` — добавлен `common/operation-log/` и `admin/logs/`.
- [ ] `second-brain/01_projects/api-layer.md` — добавлены новые эндпоинты.
- [ ] Рефлексия `second-brain/05_история/2026-MM-DD-admin-operations-log.md`.

## Риски и ограничения

| Риск | Mitigation |
|---|---|
| Заваливаем Postgres write-IOPS из-за info-логов | sampling 1/10 + buffer batching + monitoring `z_operation_log_buffer_size`. Триггер увеличения sampling → ENV. |
| Логирование вызывает saw собственную ошибку → рекурсия | `OperationLogService.flush` catch'ит ошибку и пишет в `nest Logger.error` (stdout), НЕ через `record()`. Любая ошибка внутри `record()` — `try/catch` молча. |
| Утечка секретов в payload | Жёсткий redact-list + тест на типовые секреты (Telegram bot token, OpenAI sk-, JWT-cookie, db connection string). Юнит-тест с фикстурами. |
| BullMQ `QueueEvents` подписка теряется при reconnect Redis | `QueueEvents` автоматически переподключается; добавить лог `worker.queue-events.reconnected`. |
| Cron в HTTP-app и worker-app дублирует запись | Worker-app помечается `WORKER_INSTANCE=true`; cron'ы фильтруют по этому флагу (уже стандарт, см. `imap-poll`). Гарантия — тест что один и тот же cron-run даёт ровно 1 запись. |
| Большой payload (например, AI-prompt) переполнит БД | Truncate до 8 KB + флаг `payloadTruncated`. Для AI-вызовов **не пишем** prompt в `OperationLog` — он уже в `AiUsageLog`. |
| Чтение из 7 источников медленное | Каждый reader использует индексы. Merge — k-way в памяти на ≤200×7=1400 записей, миллисекунды. Если станет проблемой — материализованный view `unified_logs` (отдельная итерация). |
| Поток errors столь велик, что UI не справляется | Виртуализация таблицы (TanStack Virtual). Пагинация по cursor — не загружаем всё разом. |

## Фазы реализации

- [ ] **Фаза 1 — Схема и базовый сервис** (1д)
  - Добавить `OperationLog` + 3 enum'а в `schema.prisma`. `prisma:push`, `prisma:generate`.
  - `OperationLogModule` + `OperationLogService` (buffer, flush, redact, truncate, sampling).
  - ENV в `env.schema.ts` + `TypedConfigService`.
  - Юнит-тесты.

- [ ] **Фаза 2 — Listeners** (1д)
  - `BullMQOperationLogListener` в worker-process.
  - `@LogCron` декоратор + применить к `~30` критическим cron'ам.
  - Дополнить `AllExceptionsFilter`.
  - Интеграционные тесты (фейк-cron, фейк-job, фейк-exception).

- [ ] **Фаза 3 — Admin API + readers** (2д)
  - `AdminLogsModule`, `AdminLogsController`, `AdminLogsService`.
  - 7 source readers с унификацией в `LogItem`.
  - DTO + Swagger.
  - Юнит + integration тесты.

- [ ] **Фаза 4 — Retention + метрики** (0.5д)
  - `operation-log-purge.cron`.
  - Prometheus-метрики.
  - Тест retention.

- [ ] **Фаза 5 — Frontend `/admin/logs`** (2д)
  - api-layer + domain + hook.
  - LogsTable (виртуализация) + LogsFilters + LogDetailDrawer + LogsToolbar.
  - Навигация.
  - Copy / Export.
  - Локализация (RU only).

- [ ] **Фаза 6 — Документация** (0.5д)
  - `second-brain/01_projects/operations-log.md`.
  - Апдейты `admin.md`, `module-map.md`, `api-layer.md`, `frontend-pages.md`.
  - `second-brain/index.md`.

- [ ] **Фаза 7 — Боевой прогон + калибровка sampling** (0.5д)
  - Включить на dev на сутки.
  - Снять метрики объёма / процент error.
  - Подкрутить `OPERATION_LOG_INFO_SAMPLING` если буфер пухнет.
  - Прорефлексировать в `second-brain/05_история/`.

**Итого: ~7.5 человеко-дней.**

## Открытые вопросы (согласовать ДО Фазы 1)

1. **Sampling success-логов.** По умолчанию 1/10 (90% completed-jobs не пишем). Готов оставить так, или хочешь 1/1 в начале для калибровки?
2. **Retention.** 30 / 90 / 180 дней для info / warn / error. Норм или хочется дольше / короче?
3. **Org-доступ.** В MVP журнал видит ТОЛЬКО `super_admin`. Org-admin не получит «свои» логи — нужно?
4. **Export-лимит.** 10000 записей за раз через NDJSON. Если ошибок реально больше — стримить chunked. Поднимать дефолт?
5. **Алерты.** Сделать MVP-«если N error за окно — webhook в Telegram-бот» в рамках этого ТЗ или отдельной фазой?
6. **Включать ли запись `info`-уровня для HTTP success'ов.** Сейчас нет (это уже есть в Prometheus). Подтверди.
7. **Где брать `process.env.WORKER_INSTANCE`** — есть ли уже стандарт, или ввести в этом ТЗ?

## Итог

_Заполняется по факту реализации._
