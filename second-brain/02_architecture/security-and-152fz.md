---
type: architecture
status: in_progress
phase: 11
---

# Безопасность и 152-ФЗ (Knowledge Core)

> Реализовано в Фазе 11: per-Org retention policy, право на удаление личных данных, маршрутизация LLM по `dataClass`, observability `core_*`.

## 1. Retention (per-Org политика хранения)

Сущность `OrgRetentionPolicy` ([backend/prisma/schema.prisma](../../backend/prisma/schema.prisma)):

```prisma
model OrgRetentionPolicy {
  tenantId            String   @unique
  rawEventDays        Int      @default(2555)  // 7 лет (под 152-ФЗ)
  archivedBlockDays   Int      @default(365)
  chatMessageDays     Int      @default(90)
  auditLogDays        Int      @default(730)
  archivedBlockAction String   @default("archive_then_delete")  // или "keep_forever"
  lastSweepAt         DateTime?
}
```

Backfill: `backend/scripts/seed-retention-policies.ts` (idempotent).
Lazy upsert: `RetentionPolicyService.getOrInit(tenantId)` — при первом обращении.

### Sweep Cron

`RetentionCron @Cron('0 * * * *')` → `RetentionService.processAll()`:
1. **`processExpiredRawEvents`** — per-tenant, RawEvent < (now - rawEventDays). Удаляет S3-payload, потом prisma.delete (cascade evidence). Блоки без evidence + `archivedBlockAction='archive_then_delete'` → `status='archived'`.
2. **`processExpiredArchivedBlocks`** — `IdeaBlock(status='archived', updatedAt < now-archivedBlockDays)` hard delete.
3. **`processExpiredChatMessages`** — `MeetingChatMessage` старше `chatMessageDays`.
4. **`processExpiredAuditLogs`** — `AuditLog` старше `auditLogDays`.

### ENV-флаги (по умолчанию **выключено** — операционно включается после полного бэкапа)

```
RETENTION_RAW_EVENTS_ENABLED=false
RETENTION_AUDIT_ENABLED=false
RETENTION_CHAT_ENABLED=true
RETENTION_BLOCKS_ENABLED=false
RETENTION_SWEEP_BATCH_SIZE=500
```

### API

```
GET   /api/v1/settings/retention   [owner-only]
PATCH /api/v1/settings/retention   [owner-only]
   body: {rawEventDays?, archivedBlockDays?, chatMessageDays?, auditLogDays?, archivedBlockAction?}
   валидация: rawEventDays >= 30, chatMessageDays >= 7
```

UI: `/settings/retention` (под `currentOrgRole === 'owner'`).

## 2. Право на удаление личных данных (152-ФЗ)

`PersonalDataDeletionService.eraseEntity({entityId, tenantId, requestedBy, reason})` ([backend/src/modules/security/personal-data-deletion.service.ts](../../backend/src/modules/security/personal-data-deletion.service.ts)) — каскадное удаление:

1. `Entity` lookup, проверка `type='person'` и tenantId match.
2. Если уже обезличена (`canonicalName='[удалено по запросу]'`) → return `{alreadyErased: true}`.
3. Найти все `IdeaBlockEntity({entityId})` → `blockIds[]` → `IdeaBlockEvidence` → `rawEventIds[]`.
4. Транзакция:
   - Удалить `RawEvent` (cascade evidence) → S3 delete (fire-and-forget с retry log).
   - `IdeaBlockEntity.deleteMany({entityId})`.
   - Блоки с `evidenceCount=0` → `status='archived'`.
   - `EntityLink.deleteMany OR clauses`.
   - Обезличить Entity: `canonicalName='[удалено по запросу]'`, `aliases=[]`, `metadata={erasedAt, requestedBy, reason}`.
   - AuditLog `person.data_erased`.

### API

```
DELETE /api/v1/persons/:entityId/data   [owner-only, RBAC person.erase]
   body: {reason: string (3..2000)}
   → EraseReport {erasedRawEvents, deletedEvidences, archivedBlocks, deletedEntityLinks, alreadyErased?}
```

UI: `/persons/:id` — двухстадийный диалог (введи ФИО для подтверждения → введи причину → удалить навсегда).

### Намеренные ограничения

- **НЕ** переписываем содержимое `IdeaBlock` (LLM-rewrite — медленно, дорого, риск утечки через embeddings).
- Что удаляется — реально удаляется (источники, links, embeddings через cascade на Evidence).
- Если persona только одна из многих сущностей блока — блок остаётся, удаляется только `IdeaBlockEntity(personEntityId)`.

## 3. `dataClass` routing в LlmRouter

> **Важно — две РАЗНЫЕ оси (не путать).** `dataClass` управляет **маршрутизацией LLM и egress** (какому провайдеру можно отдать данные, см. ниже). Группы доступа к знаниям (`KnowledgeGroup`, knowledge-access, 2026-06-06) управляют **видимостью знания конкретным пользователем** внутри Org (см. §6). Это параллельные измерения: `dataClass` — про «куда уходят данные на обработку», группы — про «кто из сотрудников видит блок в выдаче».

Поле `LlmTaskRoute.requiredDataClass: DataClass?` (null = `internal`).

Конфиг провайдеров (см. `llm-router.service.ts`):
- `anthropic-direct`: `maxDataClass='sensitive', localOnly=false`.
- `openai-via-proxy`: `maxDataClass='internal', localOnly=false`.
- `minimax`: `maxDataClass='internal', localOnly=false`.
- `local-llm` (если подключён): `maxDataClass='private', localOnly=true`.

Порядок: `public < internal < sensitive < private`.

### Логика

`LlmRouter.call({taskType, dataClass, ...})`:
- Получить `LlmTaskRoute`.
- Отфильтровать кандидаты: `provider.maxDataClass >= dataClass`.
- Пусто → `throw NoEligibleProviderError({code: 'no_provider_for_data_class', taskType, dataClass})` + инкремент `core_data_class_violations_total`.

### Покрытие call-sites

**Покрыто Phase 11**: `block-extraction.service`, `block-merge.service`, `block-link.service`, `block-fetch.service`, `entity-graph.service`, `theme-classification.service`, `tasks-extractor-v2`, `chapters-extractor-v2`, `summary-extractor-v2`, `chat-v2.service`, `card-rollup-v2.service`, `block-ingest.worker`, `theme-clusterer.cron`.

**НЕ покрыто (vNext)**: `chat.service` (legacy v1), `regenerate.service`, `card-rollup-v1`, `task/chapter-extraction-v1`, `dashboard-summary`, `goal-alignment`, `strategic-alignment`, `entity-merge`, `reframing.cron`. Дефолт `internal` через LlmRouter.

## 4. Observability — метрики `core_*`

`BusinessMetricsService` ([backend/src/common/metrics/business-metrics.service.ts](../../backend/src/common/metrics/business-metrics.service.ts)):

| Метрика | Тип | Labels |
|---|---|---|
| `core_blocks_total` | gauge | `tenant, status` |
| `core_entities_total` | gauge | `tenant, type` |
| `core_links_total` | gauge | `tenant, relation_type` |
| `core_raw_events_total` | gauge | `tenant, processing_status` |
| `core_pipeline_duration_seconds` | histogram | `worker` (buckets 0.5..300) |
| `core_llm_tokens_total` | counter | `tenant, task_type` |
| `core_personal_data_erasures_total` | counter | — |
| `core_retention_deleted_total` | counter | `kind` (raw_event/block/chat/audit/recording) |
| `core_data_class_violations_total` | counter | `task_type, attempted_class` |

Gauges обновляются `CoreMetricsSnapshotCron @Cron('*/5 * * * *')` — per-tenant `groupBy` запросы.

**Cardinality TODO**: `tenant`-label потенциально большой. На MVP допустимо (несколько сотен Org). При росте — заменить на `tenant_bucket = hash % 64`.

## 6. Группы доступа к знаниям (видимость знания пользователем) — knowledge-access (2026-06-06)

Отдельная от `dataClass` ось: ограничивает, **какие блоки знаний попадут в выдачу** AI-чата/поиска/клона/проекций конкретному сотруднику. Полное описание модели, резолвера и флага выката — [rbac-access-control.md §«Группы доступа к знаниям»](../01_projects/rbac-access-control.md). ТЗ: [plans/tz/2026-06-06-knowledge-access-groups-and-provenance.md](../../plans/tz/2026-06-06-knowledge-access-groups-and-provenance.md).

Кратко для безопасности:
- Группы (`KnowledgeGroup`: department/leadership/council/personal) + связь блок↔группа (`IdeaBlockAccess`) + направленная матрица (`GroupVisibilityPolicy`) — отдельные модели, смысл `dataClass` НЕ трогают.
- Гейт за флагом `KNOWLEDGE_ACCESS_ENFORCEMENT` (off→shadow→enforce, дефолт off); owner/admin/super — bypass.
- Дефолт — знание открыто всей Org; закрытость только из явного флага встречи / `interview`→personal.

### Новые метрики `kc_access_*` / `kc_subject_attribution_*`

`BusinessMetricsService` ([backend/src/common/metrics/business-metrics.service.ts](../../backend/src/common/metrics/business-metrics.service.ts)):

| Метрика | Тип | Labels | Назначение |
|---|---|---|---|
| `kc_subject_attribution_total` | counter | `via` (participant/userId/personId/email/name/none) | Ф1 — детерминированная subject-атрибуция автора знания по источнику identity |
| `kc_access_shadow_diff_total` | counter | `surface` | shadow-режим: сколько блоков было бы отфильтровано гейтом (сверка перед enforce) |
| `kc_access_denied_total` | counter | `surface` | enforce-режим: сколько блоков исключено гейтом доступа |

## 5. Не реализовано (vNext)

- Шифрование at-rest для sensitive-полей (PII в `Entity.metadata`, payload sensitive RawEvent) — отдельная фаза.
- Self-service GDPR-style export всех данных пользователя.
- Подпись audit-цепочки (hash chain).
- Сертификация ИСПДн — операционный процесс, не кодовая фаза.
- Grafana dashboard `Knowledge Core` — JSON-заготовка не сделана (см. `plans/2026-05-10-phase-11-execution.md` шаг 14).

## Связанные документы

- [data-model.md](data-model.md) — `OrgRetentionPolicy`, `LlmTaskRoute.requiredDataClass`.
- [llm-router.md](../01_projects/llm-router.md) — провайдеры и dataClass-фильтр.
- [admin-org-knowledge-core.md](../01_projects/admin-org-knowledge-core.md) — `/settings/retention`.
