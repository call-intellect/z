---
type: execution-plan
phase: 11
feature: knowledge-core — retention, право на удаление личных данных (152-ФЗ), routing по dataClass, observability ядра (метрики core_*, Grafana dashboard)
status: in_progress
date: 2026-05-10
source-tz: plans/tz/2026-05-10-knowledge-core-tz.md (§ Фаза 11)
---

# Фаза 11 — execution-план.

## Что входит и что НЕ входит

**Входит:** per-Org конфигурируемая retention policy для `RawEvent / IdeaBlock(archived) / MeetingChatMessage / AuditLog`, расширение `RetentionService` с новыми sweep'ами, эндпоинт «право на удаление личных данных» (`DELETE /api/v1/persons/:entityId/data`), маршрутизация LLM по `dataClass` (sensitive/private не уходит во внешний провайдер), метрики `core_*` + cron-снапшоты gauge'ов, Grafana dashboard `Knowledge Core`.

**НЕ входит (vNext):** автоматический шифр-at-rest на уровне колонок Postgres (sensitive поля в зашифрованном виде в БД), сертификация ИСПДн / 152-ФЗ под ключ (это операционный процесс, не фича), self-service экспорт всех данных пользователя по GDPR-style request, аудит-цепочка с цифровой подписью.

## Принципиальные решения

1. **Retention policy — отдельная модель `OrgRetentionPolicy`**, а не поле в `OrgEntitlement` (Фаза 12). Причины: (a) ретеншн нужен раньше, чем коммерческие тарифы; (b) дефолты задаются в коде, Org может переопределить; (c) изменение тарифа не должно автоматически менять ретеншн (это операционное решение, не коммерческое).
2. **Расширяем `RetentionService`** ([backend/src/modules/retention/retention.service.ts](backend/src/modules/retention/retention.service.ts)), а не создаём новый. Метод `processExpired()` остаётся (recordings), добавляются `processExpiredRawEvents/Blocks/Chat/Audit`. Cron перепишется в `processAll()` со счётчиками по типу.
3. **Удаление личных данных — каскадное по `Entity(type=person)`.** Не пытаемся переписывать содержимое `IdeaBlock` (LLM-rewrite по запросу — медленно, дорого, риск утечь по embeddings). Вместо этого:
   - удаляем `RawEvent`-источники, где упомянута персона → cascade удаляет `IdeaBlockEvidence` → блоки без evidence переходят в `archived` (или удаляются — конфигурируется),
   - блоки, где persona только одна из многих сущностей, остаются, но `IdeaBlockEntity(personEntityId)` удаляется → персона больше не «связана».
   - Это **прагматичный** подход: 100%-удаление текста из исторических LLM-сводок невозможно без ручного review; то, что удаляется — реально удаляется (источники, links, embeddings).
4. **`dataClass` routing в `LlmRouter`** — новый минимальный класс данных, который провайдер согласен обрабатывать. Дефолтная карта:
   - `public` / `internal` → любой провайдер (`anthropic`, `openai-via-proxy`, `minimax`),
   - `sensitive` → только `anthropic` через прямой Anthropic API (без сторонних прокси) или локальная LLM (если подключена),
   - `private` → только локальная LLM. Если `localOnly`-провайдеров нет — `LlmRouter.invoke` бросает `NoEligibleProviderError('no_local_provider_for_data_class')`.
5. **Метрики `core_*` — gauge через snapshot-cron**, не realtime. Real-time event-driven gauge на 100k+ блоков делает много writes; раз в 5 минут `SELECT COUNT(*) GROUP BY status` — дешевле и достаточно.
6. **Grafana dashboard — провизионируется как код** (JSON в `infra/grafana/dashboards/`), не редактируется руками в UI на проде.

## Backend

### Шаг 1 — Prisma schema: `OrgRetentionPolicy`

- [x] Добавить модель:
  ```prisma
  model OrgRetentionPolicy {
    id                  String   @id @default(cuid())
    tenantId            String   @unique
    org                 Org      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
    rawEventDays        Int      @default(2555)  // 7 лет — дефолт под 152-ФЗ
    archivedBlockDays   Int      @default(365)
    chatMessageDays     Int      @default(90)
    auditLogDays        Int      @default(730)
    archivedBlockAction String   @default("archive_then_delete")  // или "keep_forever"
    lastSweepAt         DateTime?
    createdAt           DateTime @default(now())
    updatedAt           DateTime @updatedAt
  }
  ```
- [x] **db push**: `bun run prisma:push --accept-data-loss`.
- [x] **Backfill через `safe-seed-rules`-совместимый patch-script** [backend/scripts/seed-retention-policies.ts](backend/scripts/seed-retention-policies.ts): для каждой `Org` без `OrgRetentionPolicy` — `create` с дефолтами. Идемпотентен.
- [x] Default getter `RetentionPolicyService.getOrInit(tenantId)` — lazy upsert при первом обращении (на случай если seed не пробежал).

### Шаг 2 — ENV

- [x] `RETENTION_SWEEP_BATCH_SIZE` (default `500`) — сколько строк за один проход на каждый kind.
- [x] `RETENTION_RAW_EVENTS_ENABLED` (default `false` на Фазе 11; включается операционно после полного бэкапа).
- [x] `RETENTION_AUDIT_ENABLED` (default `false`).
- [x] `RETENTION_CHAT_ENABLED` (default `true`).
- [x] `RETENTION_BLOCKS_ENABLED` (default `false`).
- [x] Геттеры `cfg.retention.{rawEventsEnabled, auditEnabled, chatEnabled, blocksEnabled, sweepBatchSize}`.

### Шаг 3 — Расширение `RetentionService`

[backend/src/modules/retention/retention.service.ts](backend/src/modules/retention/retention.service.ts):

- [x] `private async processExpiredRawEvents(): Promise<{deleted, failed}>`:
  - per-tenant loop: `OrgRetentionPolicy.findMany`,
  - `RawEvent.findMany({where: {tenantId, receivedAt: {lt: now - rawEventDays * 24h}}, take: BATCH})`,
  - для каждого: если `payloadStorage='s3'` → `S3Service.delete([payloadS3Key])`, потом `prisma.rawEvent.delete` (cascade удаляет `IdeaBlockEvidence`),
  - после удаления — найти блоки с `evidenceCount=0` и `archivedBlockAction='archive_then_delete'` → `status='archived'`,
  - метрика `core_retention_deleted_total{kind='raw_event'}` += deleted.
- [x] `private async processExpiredArchivedBlocks()`:
  - `IdeaBlock.findMany({where: {status: 'archived', updatedAt: {lt: now - archivedBlockDays * 24h}}, take: BATCH})`,
  - hard delete (cascade на `IdeaBlockEvidence`, `IdeaBlockEntity`, `IdeaBlockLink`, `ThemeIdeaBlock`),
  - `AuditLog(action='block.deleted_by_retention', resourceId=blockId, metadata={tenantId, name, archivedAt})`.
- [x] `private async processExpiredChatMessages()`:
  - `MeetingChatMessage.deleteMany({where: {createdAt: {lt: now - chatMessageDays * 24h}}})` per tenant.
- [x] `private async processExpiredAuditLogs()`:
  - `AuditLog.deleteMany({where: {createdAt: {lt: now - auditLogDays * 24h}}})` per tenant.
- [x] **`processAll()`** — оркестратор, объединяющий `processExpired()` (recordings) + новые методы. ENV-флаги управляют каждым sweep-ом независимо. После — `OrgRetentionPolicy.update({lastSweepAt: now})`.
- [x] Возвращает агрегированную статистику `{recordings, rawEvents, blocks, chat, audit}` для логов.

### Шаг 4 — Расширение `RetentionCron`

[backend/src/modules/retention/retention.cron.ts](backend/src/modules/retention/retention.cron.ts):

- [x] Заменить `sweep()` на вызов `svc.processAll()`. Логи — структурированные, по kind.
- [x] Cron expression остаётся `'0 * * * *'`.

### Шаг 5 — `PersonalDataDeletionService`

Новый файл [backend/src/modules/security/personal-data-deletion.service.ts](backend/src/modules/security/personal-data-deletion.service.ts) (или внутри существующего `security` модуля).

- [x] Метод `eraseEntity(input: {entityId, tenantId, requestedBy: userId, reason: string}): Promise<EraseReport>`:
  - `Entity` lookup, проверка `type='person'` и `tenantId` совпадает,
  - `IdeaBlockEntity.findMany({entityId})` → `blockIds[]`,
  - для каждого `blockId`: `IdeaBlockEvidence.findMany` → `rawEventIds[]`,
  - **транзакция**:
    - удалить найденные `RawEvent` (cascade evidence),
    - удалить S3-payload'ы по `payloadS3Key` (вне транзакции, fire-and-forget с retry log),
    - удалить `IdeaBlockEntity` для этой персоны,
    - найти блоки с `evidenceCount=0` после удаления → `status='archived'`,
    - удалить `EntityLink` (откуда и куда),
    - обезличить `Entity`: `canonicalName='[удалено по запросу]'`, `aliases=[]`, `metadata={erasedAt: now, requestedBy, reason}`,
    - `AuditLog(action='person.data_erased', userId=requestedBy, resourceId=entityId, metadata={erasedRawEvents, archivedBlocks, deletedEvidences})`.
  - Возвращает `EraseReport = {erasedRawEvents, archivedBlocks, deletedEvidences, deletedEntityLinks}`.
- [x] **Идемпотентность**: повторный вызов на уже-обезличенной персоне (`canonicalName='[удалено по запросу]'`) — возвращает `{...все нули, alreadyErased: true}`.

### Шаг 6 — `PersonalDataController`

- [x] `DELETE /api/v1/persons/:entityId/data` под `CookieAuthGuard + TenantGuard + Rbac('person', 'erase')`.
- [x] Body (опционально): `{reason: string}` — для аудита и compliance.
- [x] Response: `EraseReport`.
- [x] **Только owner Org** имеет право `person.erase` (RBAC). super_admin может — через Z-Admin (Фаза 7).
- [x] **Метрика**: `core_personal_data_erasures_total` += 1.

### Шаг 7 — Расширение `LlmRouter` под `dataClass`

[backend/src/modules/ai/services/llm-router.service.ts](backend/src/modules/ai/services/llm-router.service.ts):

- [x] **Prisma schema**: в `LlmTaskRoute` добавить поле `requiredDataClass DataClass?` (минимальный класс данных, который маршрут поддерживает; null = `internal`).
- [x] **`LlmProvider`-конфиг** (есть в коде где-то рядом с router'ом — проверить) расширить флагом `localOnly: boolean` и `maxDataClass: DataClass`. Дефолты:
  - `anthropic-direct` → `maxDataClass='sensitive'`, `localOnly=false`.
  - `openai-via-proxy` → `maxDataClass='internal'`, `localOnly=false`.
  - `minimax` → `maxDataClass='internal'`, `localOnly=false`.
  - `local-llm` (если подключён) → `maxDataClass='private'`, `localOnly=true`. (Реализовано через `ollama` — он `localOnly=true, maxDataClass='private'`).
- [x] Изменить сигнатуру: `LlmRouter.call({taskType, dataClass, ...})` (метод именуется `call`, не `invoke`; см. decisions-log). Если `dataClass` не передан — берётся `internal`.
- [x] Логика выбора:
  - получить `LlmTaskRoute` для `taskType`,
  - отфильтровать кандидаты-провайдеры по `provider.maxDataClass >= dataClass` (порядок: `public < internal < sensitive < private`),
  - если после фильтра пусто → `throw NoEligibleProviderError({code: 'no_provider_for_data_class', taskType, dataClass})`.
- [x] **Все вызовы LLM** должны передать `dataClass` — обновить call-site'ы. Сделано для всех knowledge-core call-sites (block-extraction, block-merge, block-link, entity-graph, theme-classification, tasks-extractor-v2, chapters-extractor-v2, summary-extractor-v2, chat-v2, card-rollup-v2). Legacy (chat, regenerate, card-rollup, task-extraction, chapter-extraction) и `reframing.cron`/`strategic-alignment.worker`/`entity-merge.service`/`dashboard-summary` остаются с дефолтом `'internal'` — см. decisions-log.

### Шаг 8 — Метрики `core_*`

[backend/src/common/metrics/business-metrics.service.ts](backend/src/common/metrics/business-metrics.service.ts):

- [x] Зарегистрировать новые **gauges** (через `prom-client.Gauge`):
  - `core_blocks_total{tenant,status}`,
  - `core_entities_total{tenant,type}`,
  - `core_links_total{tenant,relation_type}`,
  - `core_raw_events_total{tenant,processing_status}`.
- [x] Зарегистрировать **histograms / counters**:
  - `core_pipeline_duration_seconds{worker}` (histogram, buckets `[0.5, 1, 2, 5, 10, 30, 60, 120, 300]`).
  - `core_llm_tokens_total{tenant,task_type}` (counter; пишется из `AiUsageLogService` после каждого вызова).
  - `core_personal_data_erasures_total` (counter).
  - `core_retention_deleted_total{kind}` (counter; kind='raw_event'|'block'|'chat'|'audit'|'recording').
  - `core_data_class_violations_total{task_type,attempted_class}` (counter; инкремент при `NoEligibleProviderError` в LlmRouter).
- [x] Обёртки-методы (`setCoreBlocks`, `setCoreEntities`, `setCoreLinks`, `setCoreRawEvents`, `observeCorePipelineDuration`, `addCoreLlmTokens`, `incCorePersonalDataErasure`, `incCoreRetentionDeleted`, `incCoreDataClassViolation`).
- [x] **Cardinality guard**: `tenant`-label потенциально большой. TODO-комментарий проставлен в business-metrics.service.ts (на Фазе 11 допустимо, при росте → tenant_bucket).

### Шаг 9 — `CoreMetricsSnapshotCron`

Новый файл [backend/src/modules/knowledge-core/workers/core-metrics-snapshot.cron.ts](backend/src/modules/knowledge-core/workers/core-metrics-snapshot.cron.ts):

- [ ] `@Cron('*/5 * * * *')`.
- [ ] Per-tenant loop:
  - `SELECT status, COUNT(*) FROM IdeaBlock WHERE tenantId=? GROUP BY status` → `setCoreBlocks(tenant, status, count)`.
  - аналогично для `Entity` (по type), `IdeaBlockLink` (по relationType), `RawEvent` (по processingStatus).
- [ ] Reset gauge при отсутствии записей (`set(0)`), иначе старые значения «зависают».

### Шаг 10 — `AUDIT` константы

[backend/src/modules/audit/audit.types.ts](backend/src/modules/audit/audit.types.ts) — добавить:

- [ ] `BLOCK_CREATED`, `BLOCK_MERGED`, `BLOCK_ARCHIVED`, `BLOCK_DELETED_BY_RETENTION`.
- [ ] `ENTITY_CREATED`, `ENTITY_MERGED`.
- [ ] `LINK_CREATED`, `LINK_REMOVED`.
- [ ] `THEME_CREATED`, `THEME_ARCHIVED`.
- [ ] `WORKER_FAILED` (с metadata.workerName).
- [ ] `ORG_CREATED`, `ORG_UPDATED`.
- [ ] `MEMBERSHIP_INVITED`, `MEMBERSHIP_REMOVED`, `MEMBERSHIP_ROLE_CHANGED`.
- [ ] `PERSON_DATA_ERASED`.
- [ ] `RETENTION_POLICY_UPDATED`.
- [ ] `DATA_CLASS_VIOLATION` (попытка отправить sensitive в неподходящий провайдер).

### Шаг 11 — `RetentionPolicyController`

- [ ] `GET /api/v1/settings/retention` (owner-only) → текущая `OrgRetentionPolicy`.
- [ ] `PATCH /api/v1/settings/retention` body: `{rawEventDays?, archivedBlockDays?, chatMessageDays?, auditLogDays?, archivedBlockAction?}`. Валидация: `rawEventDays >= 30` (нельзя стереть всё за день), `chatMessageDays >= 7`. AuditLog: `RETENTION_POLICY_UPDATED`.
- [ ] **Не разрешать `< 30 дней` для rawEventDays** — защита от случайного wipe.

## Frontend

### Шаг 12 — Страница `/settings/retention`

- [ ] [frontend/app/(authenticated)/settings/retention/page.tsx](frontend/app/(authenticated)/settings/retention/page.tsx) + `RetentionClient.tsx`.
- [ ] Форма с 4 inputs (rawEventDays, archivedBlockDays, chatMessageDays, auditLogDays) + radio для `archivedBlockAction`. Заметные подсказки про минимумы и про 152-ФЗ.
- [ ] Show `lastSweepAt`.
- [ ] Сохранение через `PATCH /api/v1/settings/retention`.

### Шаг 13 — Страница `/settings/persons/:entityId`

- [ ] Существующая страница персоны (если её нет — создать минимальную) + кнопка «Удалить все данные о персоне» (owner-only).
- [ ] Подтверждение в две стадии: сначала ввод текста (например, ФИО персоны) для подтверждения, потом обязательный input «Причина удаления» → `DELETE /api/v1/persons/:entityId/data`.
- [ ] После успеха — toast с EraseReport, редирект на `/persons` с фильтром «обезличенные».

## Infra (Grafana dashboard)

### Шаг 14 — Dashboard `Knowledge Core`

- [ ] Файл `infra/grafana/dashboards/knowledge-core.json` (если каталога нет — создать).
- [ ] Панели:
  - **Blocks state** — stacked bar by `status` (sum `core_blocks_total{tenant=~"$tenant"}`).
  - **Entities by type** — pie / table.
  - **Pipeline durations** — heatmap по worker'у (p50/p95/p99 from histogram).
  - **LLM tokens by task_type** — `rate(core_llm_tokens_total[5m])`.
  - **Retention sweeps** — `rate(core_retention_deleted_total[1h])` by kind.
  - **Personal data erasures** — counter, должен быть редким (алерт если > 5 в день — это похоже на инцидент).
  - **Data class violations** — must be 0; алерт > 0.
- [ ] **Алерты**:
  - `histogram_quantile(0.95, core_pipeline_duration_seconds{worker="block-distill"}[10m]) > 60` → warn.
  - `rate(core_data_class_violations_total[5m]) > 0` → critical.
  - `RawEvent processingStatus=failed > 5%` за час → warn.
- [ ] Provisioning через `infra/grafana/provisioning/dashboards/knowledge-core.yaml` (если есть стандартный путь — переиспользовать).

## Verification

- [ ] `bun run typecheck` (backend) — зелёный.
- [ ] `bun run typecheck` (frontend) — зелёный.
- [ ] `bun run prisma:push` — успешно.
- [ ] **Smoke**:
  - Создать тестовую `Org`, RawEvent с `receivedAt = now - 8 лет`. Включить `RETENTION_RAW_EVENTS_ENABLED=true`. Дождаться cron'а / вызвать `processAll()` вручную через debug-endpoint. RawEvent + связанный IdeaBlockEvidence удалён. Блок без evidence — `status='archived'`.
  - Создать тестовую `Entity(type='person')` с упоминаниями в 3 RawEvent. Вызвать `DELETE /api/v1/persons/:id/data`. Проверить: 3 RawEvent удалены, 3 IdeaBlockEvidence удалены, блоки без evidence — archived, Entity обезличена. Повторный вызов — `alreadyErased: true`.
  - Послать `LlmRouter.invoke({taskType: 'block-distill', dataClass: 'sensitive'})` без локального провайдера → `NoEligibleProviderError`. Метрика `core_data_class_violations_total` += 1.
- [ ] **Метрики**: `curl http://localhost:3000/metrics | grep core_` — все метрики экспортируются.
- [ ] **Grafana**: импорт dashboard, открытие — все панели рисуются (на dev — пустые, но без ошибок схемы).

## Что НЕ сделано (вне Фазы 11)

- Шифрование at-rest для sensitive-полей (PII в `Entity.metadata`, payload sensitive RawEvent) — vNext, отдельная фаза.
- Self-service GDPR-style export всех данных пользователя — vNext (есть рудимент в `/exports`, но не персонализированный).
- Подпись audit-цепочки (hash chain) — vNext.
- Сертификация ИСПДн — операционный процесс, не кодовая фаза.
- Per-Org SLA-дашборды — частично пересекается с Фазой 8 (дашборд директора), здесь не дублируем.

## Затронутые файлы

### Schema / config
- `backend/prisma/schema.prisma` — `OrgRetentionPolicy` (новая модель), `LlmTaskRoute.requiredDataClass`.
- `backend/src/common/config/env.schema.ts` — `RETENTION_*_ENABLED`, `RETENTION_SWEEP_BATCH_SIZE`.
- `backend/src/common/config/typed-config.service.ts` — соответствующие геттеры.

### Retention
- `backend/src/modules/retention/retention.service.ts` — добавлены `processExpiredRawEvents/Blocks/Chat/Audit`, `processAll`.
- `backend/src/modules/retention/retention.cron.ts` — переключение на `processAll`.
- `backend/src/modules/retention/retention-policy.service.ts` — новый.
- `backend/src/modules/retention/retention-policy.controller.ts` — новый.
- `backend/src/modules/retention/retention.module.ts` — регистрация.
- `backend/scripts/seed-retention-policies.ts` — backfill.

### Security
- `backend/src/modules/security/personal-data-deletion.service.ts` — новый.
- `backend/src/modules/security/personal-data.controller.ts` — новый.
- `backend/src/modules/security/security.module.ts` — обновить (или создать).

### LLM router
- `backend/src/modules/ai/services/llm-router.service.ts` — `invoke({dataClass})`, фильтр провайдеров.
- `backend/src/modules/ai/services/llm-router.service.spec.ts` — кейсы фильтра.
- Все воркеры/сервисы, вызывающие `LlmRouter.invoke` — добавить `dataClass`.

### Metrics
- `backend/src/common/metrics/business-metrics.service.ts` — gauges `core_*` + counters/histograms.
- `backend/src/modules/knowledge-core/workers/core-metrics-snapshot.cron.ts` — новый.
- `backend/src/modules/knowledge-core/knowledge-core.module.ts` — регистрация cron'а.

### Audit
- `backend/src/modules/audit/audit.types.ts` — новые константы.

### Frontend
- `frontend/app/(authenticated)/settings/retention/page.tsx` — новый.
- `frontend/app/(authenticated)/settings/retention/RetentionClient.tsx` — новый.
- `frontend/app/(authenticated)/persons/[id]/page.tsx` — добавить кнопку «Удалить все данные».
- `frontend/src/api/retention.api.ts` — новый.
- `frontend/src/api/persons.api.ts` — добавить `eraseData`.
- `frontend/src/ui/components/app-shell/Sidebar.tsx` — пункт «Хранение и 152-ФЗ» в группе «Настройки».

### Infra
- `infra/grafana/dashboards/knowledge-core.json` — новый.
- `infra/grafana/provisioning/dashboards/knowledge-core.yaml` — новый (если стандартный путь иной — подстроиться).

## DoD

- [ ] `OrgRetentionPolicy` существует у каждой Org (через seed или lazy upsert).
- [ ] Cron `RetentionCron.sweep()` вызывает `processAll()`, удаляет просроченные `RawEvent`, `IdeaBlock(archived)`, `MeetingChatMessage`, `AuditLog` согласно политике, лог по kind.
- [ ] `DELETE /api/v1/persons/:entityId/data` каскадно стирает источники, обезличивает Entity, архивирует блоки без evidence, пишет AuditLog. Идемпотентен.
- [ ] `LlmRouter` отказывает в обработке `sensitive`-данных, если нет подходящего провайдера; метрика `core_data_class_violations_total` инкрементится.
- [ ] Все новые метрики `core_*` экспортируются на `/metrics`.
- [ ] Grafana dashboard `Knowledge Core` показывает счётчики (на dev — пустые, без ошибок).
- [ ] Алерты на `data_class_violations` и `pipeline_duration p95` настроены (можно через JSON Grafana, или отдельный alertmanager rule).
- [ ] Обновлён `second-brain/02_architecture/data-model.md` — `OrgRetentionPolicy`, `LlmTaskRoute.requiredDataClass`.
- [ ] Обновлён `second-brain/01_projects/admin.md` — `/settings/retention`.
- [ ] Обновлён `second-brain/01_projects/api-layer.md` — новые endpoints retention/persons.
- [ ] Обновлён `second-brain/01_projects/workers-queues.md` — `core-metrics-snapshot.cron`, расширение `RetentionCron`.
- [ ] Создан `second-brain/02_architecture/security-and-152fz.md` — описание модели данных, политики, эндпоинтов, что НЕ покрыто.
- [ ] Чек-лист «Фаза 11» в `plans/tz/2026-05-10-knowledge-core-tz.md` помечен `[x]`.
