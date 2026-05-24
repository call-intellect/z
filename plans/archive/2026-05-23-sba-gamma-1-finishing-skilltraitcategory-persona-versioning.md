---
type: tz
status: ready-for-code
feature: γ-1 доделки — SkillTraitCategory модель + гибрид-версионирование ExecutablePersona
phase: gamma-1
date: 2026-05-23
parent: plans/tz/2026-05-22-final-roadmap.md
predecessor: plans/tz/2026-05-21-sba-gamma-1-specialist-3-7-skill-and-clone.md
related:
  - plans/analysis/2026-05-22-code-reality-deltas.md §γ-1
  - plans/tz/2026-05-22-final-roadmap.md §γ-1
---

# SBA γ-1 доделки — SkillTraitCategory + гибрид-версионирование ExecutablePersona

## 1. Цель и контекст

γ-1 готов на 95%: SkillProfile, SkillTrait, ExecutablePersona, worker'ы, cron'ы, ClonesService, clone-respond API — всё работает. Оставшиеся 5%:
1. **SkillTraitCategory** — отдельная модель для эмерджентных категорий traits (вместо free-string `trait.category`). Куратор может смержить две category в одну через `merge_categories` (см. α-4 wave 2).
2. **Гибрид-версионирование ExecutablePersona** — еженедельный snapshot + внеочередной при триггерах (≥3 новых traits ИЛИ ≥1 mark_as_misleading critical).

## 2. Scope

**Входит:**
- Модель `SkillTraitCategory` в schema (tenantId, name, slug, description, parentCategoryId?).
- `SkillTrait.categoryId` (FK на SkillTraitCategory) + backward-compat: legacy free-string category → миграция.
- Patch-script `patch-skill-trait-categories-from-strings.ts` — извлекает unique categories из существующих SkillTrait.category → создаёт SkillTraitCategory + проставляет FK.
- Сервис `SkillTraitCategoryService` — CRUD + merge (вызывается через CurationDecision merge_categories).
- `ExecutablePersonaVersioningService`:
  - Еженедельный snapshot (cron `@Cron('0 6 * * 1')` — каждый понедельник 06:00).
  - Trigger-based: при добавлении SkillTrait считаем; при ≥3 новых от прошлого snapshot → trigger build. При mark_as_misleading critical (severity='critical') → trigger immediately.
  - Old snapshots не удаляются — query «latest» через `currentVersionId`.
- Cron `executable-persona-trigger-watcher.cron` — `@Cron('*/15 * * * *')` каждые 15 минут проверяет триггеры.
- API расширение `GET /api/v1/skills/categories` + `POST /merge` (внутреннее, вызывается из CurationService).
- Метрики: `skill_categories_total{tenant_top}`, `executable_persona_snapshots_total{tenant_top, trigger}`.

**Не входит:**
- UI для SkillTraitCategory management — пока admin-only через REST.
- Backfill старых ExecutablePersona snapshots — только новые версионируются.

## 3. Принятые решения

1. **SkillTraitCategory — first-class модель** вместо enum/string. Эмерджентные категории = их количество растёт, enum не подходит. Slug для URL-safe references.
2. **Backward-compat миграция category String → categoryId FK**: оставить `SkillTrait.category String?` deprecated на 1 месяц параллельно с `categoryId`. После прода — patch-script + dropping legacy column.
3. **Merge categories** — операция: для всех SkillTrait с `categoryId = source.id` → `categoryId = target.id`, затем `source.deletedAt = now()` (soft delete для аудита). Undoable через CurationDecision rollback.
4. **Гибрид-версионирование 2 типа триггеров:**
   - Time-based (weekly): фиксированный snapshot для baseline тренда.
   - Event-based: ≥3 новых traits SINCE last snapshot ИЛИ ≥1 critical mark_as_misleading.
5. **Не дубль-snapshot:** если уже создан snapshot за последний час — skip.
6. **`currentVersionId` указывает на latest snapshot.** Старые snapshots остаются для аудита (track-trend).
7. **`mark_as_misleading.severity`** — добавить поле `severity ∈ {minor|major|critical}` в CurationDecision metaJson. Только critical триггерит rebuild.
8. **ExecutablePersona snapshot — async через очередь.** Не блокирует request на CurationDecision.

## 4. Зависимости

- γ-1 базис (готово) — все модели, worker'ы, cron'ы.
- α-4 wave 2 (параллельно) — `merge_categories` CurationDecisionType (нужен enum-value перед merge endpoint). Если ещё не закрыто — fallback на string-comparison.

## 5. Prisma-дельта

```prisma
model SkillTraitCategory {
  id              String   @id @default(cuid())
  tenantId        String
  name            String
  slug            String
  description     String?
  parentCategoryId String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  deletedAt       DateTime?

  tenant          Org      @relation(fields: [tenantId], references: [id])
  parent          SkillTraitCategory?  @relation("CategoryToParent", fields: [parentCategoryId], references: [id])
  children        SkillTraitCategory[] @relation("CategoryToParent")
  traits          SkillTrait[]

  @@unique([tenantId, slug])
  @@index([tenantId, deletedAt])
}

model SkillTrait {
  // ... existing fields
  category        String?              // @deprecated, use categoryId
  categoryId      String?

  categoryFk      SkillTraitCategory?  @relation(fields: [categoryId], references: [id])

  @@index([tenantId, categoryId])
}
```

## 6. Patch / миграция данных

`backend/scripts/patch-skill-trait-categories-from-strings.ts`:
```
1. SELECT DISTINCT category FROM SkillTrait WHERE category IS NOT NULL AND categoryId IS NULL.
2. Для каждого:
   - slug = slugify(category).
   - UPSERT SkillTraitCategory(tenantId, name=category, slug).
   - UPDATE SkillTrait SET categoryId = newCategory.id WHERE category = X AND categoryId IS NULL.
3. Лог: N categories created, M traits linked.
```
Идемпотентно. Запускается раз per tenant.

## 7. REST API

`/api/v1/skills/categories`:
- `GET /` (list, filter `?parentCategoryId=`).
- `POST /` (create — admin).
- `PATCH /:id` (rename/description).
- `POST /merge` body `{ sourceId, targetId }` — admin/curator.

`/api/v1/clones/:cloneId/persona/snapshot` (admin/owner) — manual trigger snapshot rebuild.

## 8. BullMQ worker'ы и cron'ы

- `ExecutablePersonaSnapshotCron` — `@Cron('0 6 * * 1')` weekly Monday 06:00.
- `executable-persona-trigger-watcher.cron` — `@Cron('*/15 * * * *')` каждые 15 минут.
  - Для всех ExecutablePersona: проверка traits-count since lastSnapshotAt; если ≥3 → enqueue rebuild.
  - Проверка mark_as_misleading critical events с lastSnapshotAt: если ≥1 → enqueue rebuild.
- `executable-persona-build.worker` (существует) — добавить `triggerReason ∈ {scheduled|threshold|critical-rebuild}` поле для метрики.
- Idempotency: skip если snapshot создан за последний 1 час (Redis SETNX TTL 1h на personaId).

## 9. LlmTaskType регистрация

Существующие LlmTaskType для persona-build не меняются. Нет новых.

## 10. RBAC ResourceType

- `skill_category.read` (employee).
- `skill_category.write` (admin, curator).
- `skill_category.merge` (admin, curator).
- `clone.persona.snapshot` (owner, admin).

## 11. Метрики Prometheus

- `skill_categories_total{tenant_top}` gauge.
- `skill_trait_categorized_ratio{tenant_top}` gauge — % traits с categoryId IS NOT NULL.
- `executable_persona_snapshots_total{tenant_top, trigger}` counter — trigger ∈ {scheduled|threshold|critical}.
- `executable_persona_snapshot_lag_seconds{tenant_top}` gauge — макс. лаг от триггерного события до snapshot.
- Cardinality ~100 × 3 = 300.

## 12. Frontend

- Existing `/me/clone` (если есть) — добавить виджет «Версии моей persona» с историей snapshot'ов + триггер manual rebuild.
- API клиент: `frontend/src/api/skills.api.ts` — extend with categories endpoints.
- UI для merge categories — admin-only, в `/admin/curation` (extend существующую страницу).
- `Remove-Item -Recurse -Force .next\types` после правок.

## 13. ENV переменные

- `EXECUTABLE_PERSONA_SCHEDULED_REBUILD_ENABLED: boolean (default true)`.
- `EXECUTABLE_PERSONA_THRESHOLD_TRAITS_COUNT: number (default 3)`.
- `EXECUTABLE_PERSONA_MIN_REBUILD_INTERVAL_MINUTES: number (default 60)`.

## 14. Связь с существующим кодом

- `backend/src/modules/clones/services/executable-persona-build.worker.ts` (через vexp).
- `backend/src/modules/clones/services/skill-manager-digest.cron.ts` (паттерн для нового cron).
- `backend/src/modules/curation/services/curation.service.ts` — расширение `decide()` для merge_categories handling.
- schema.prisma `SkillTrait`, `ExecutablePersona`, `CurationDecision`.

## 15. DoD

- [ ] SkillTraitCategory модель + миграция legacy category строк.
- [ ] Merge endpoint + integration с CurationService.decide(merge_categories).
- [ ] Triggered build для ExecutablePersona при threshold/critical.
- [ ] Weekly cron работает.
- [ ] Метрики в /metrics.
- [ ] `bun run typecheck` + `bun run lint` + `bunx vitest run` зелёные.
- [ ] Patch-script запущен на test-data, идемпотентен.

## 16. Тесты

- **unit:** `skill-trait-category.service.spec.ts` — CRUD + merge.
- **unit:** `executable-persona-trigger-watcher.cron.spec.ts` — threshold/critical/idempotency.
- **integration:** `merge-categories-curation.spec.ts` — CurationService.decide(merge_categories) → traits migrated + source soft-deleted.
- **integration:** `patch-skill-trait-categories.spec.ts` — миграция с проверкой idempotency.

## 17. Риски и mitigation

- **`merge_categories` enum-value не существует** (если α-4 wave 2 ещё не закрыта) — кодер проверяет: если нет, добавляет (через свой schema-patch, минимально); если есть — использует. Координация через комментарий в этом sub-ТЗ.
- **Trigger watcher infinite-rebuild loop** — Redis SETNX TTL 1h гарантирует min 1h между rebuilds; max 24/day per persona.
- **Patch-script на больших tenant'ах** — обработка батчами по 100 traits.
- **Schema merge с другими wave-3 sub-ТЗ** — изменяем только SkillTrait+новый SkillTraitCategory, не пересекаются с другими.
- **`.next/types/` кэш** — Remove-Item после frontend правок.
