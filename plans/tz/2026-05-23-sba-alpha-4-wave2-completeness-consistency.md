---
type: tz
status: ready-for-code
feature: α-4 wave 2 — CompletenessSlot + ConsistencyCheckerCron + расширение CurationDecisionType
phase: alpha-4
date: 2026-05-23
parent: plans/tz/2026-05-22-final-roadmap.md
predecessor: plans/tz/2026-05-21-sba-alpha-4-layer4-curation-foundation.md
related:
  - plans/analysis/2026-05-22-code-reality-deltas.md §α-4
  - plans/tz/2026-05-22-final-roadmap.md §α-4
---

# SBA α-4 wave 2 — CompletenessSlot + ConsistencyCheckerCron + расширение CurationDecisionType

## 1. Цель и контекст

Curation foundation готов на 90%: triage + evolving + stale-detection + 5 моделей + API + UI работают. Wave 2 закрывает оставшиеся 10%:
1. **CompletenessSlot** — first-class «незаполненный слот» нормативной карточки (Regulation/Process/Role/CompanyProfile), чтобы UI/probe могли точечно дотягивать недостающие данные.
2. **ConsistencyCheckerCron** — структурные несостыковки графа (раз в 4 часа), эмитит probe-events.
3. **Расширение `CurationDecisionType`** — `merge_categories` (для γ-1 SkillTraitCategory) и `escalate` (передать другому куратору).

## 2. Scope

**Входит:**
- Модель `CompletenessSlot` + index'ы.
- Сервис `CompletenessScannerCron` (`@Cron('0 */6 * * *')` каждые 6 часов) — генерация слотов для new/updated карточек.
- Сервис `ConsistencyCheckerCron` (`@Cron('0 */4 * * *')` каждые 4 часа) — 6 структурных правил, эмит probe-events через `ProbeService.suggest()`.
- Расширение enum `CurationDecisionType` (`merge_categories`, `escalate`).
- Endpoint `GET /api/v1/curation/completeness-slots` с фильтрами `?cardType=&cardId=&status=open|filled`.
- UI-виджет «N открытых слотов» в `/curation` master-detail (расширение существующей страницы).
- Метрики `completeness_slots_open_total{tenant_top, card_type}`, `consistency_violations_total{tenant_top, rule}`.

**Не входит:**
- Полная UI-страница `/curation/completeness` — пока виджет в master-detail + filter, отдельная страница в γ-фазе если потребуется.
- Backfill слотов для всех существующих карточек — только новые/изменённые; добавить опц. patch-script для одного запуска admin'ом.

## 3. Принятые решения

1. **Slot scope** — только для 4 типов карточек: `regulation`, `process`, `role`, `company_profile`. Другие (Decision/Insight/Idea) — нет slots; их полнота описывается через `confidence`.
2. **Slot definitions — hardcoded** в `CompletenessScannerService.SLOT_DEFINITIONS` (Map<cardType, slot[]>). Не в БД — слоты редко меняются, версионируются через код-релиз.
3. **Slot kind** — `'required'` или `'optional'`. Optional не блокирует completeness=1.0, но участвует в weighted-score.
4. **Completeness формула** — `filledRequired / totalRequired` (0.0..1.0). Optional слоты добавляют bonus до 0.1 сверху, но capped at 1.0.
5. **6 правил ConsistencyChecker:**
   - **R1:** артефакт (Document) без процесса-источника (нет EntityLink `produced_by` → Process).
   - **R2:** ProcessStep без output artifact (нет EntityLink `produces` → Document).
   - **R3:** ProcessStep без owner Role (нет `assigneeRoleId`).
   - **R4:** Role с непривязанным ResponsibilityElement (нет EntityLink `responsible_for` → Process/Outcome).
   - **R5:** ResponsibilityElement без метрики (нет attached KPI/Metric).
   - **R6:** CompanyProfile без Mission/Vision/Strategy slot (когда `missionJson IS NULL` AND `visionJson IS NULL` AND `strategyJson IS NULL`).
6. **Probe-events от Consistency** — `kind = 'consistency_violation'`, severity = `'medium'` (не блокирует, но в очередь куратора).
7. **`merge_categories` — для γ-1.** Куратор может смержить 2 SkillTraitCategory в одну. Implements: новая запись CurationDecision со ссылкой на source+target categories через `metaJson`.
8. **`escalate`** — передать item следующему куратору в `CuratorAssignment` (round-robin или next-in-list). Реализация: `CurationDecision` с `metaJson.escalateToUserId`.
9. **Slot filling — реактивно**: при изменении карточки сервис re-evaluates слоты (фильтрует filled). Триггер — `card.updated` событие через EventEmitter (если нет — fallback на cron каждые 6 часов).

## 4. Зависимости

- α-4 базис (готово) — CurationItem, CurationDecision, ProbeService.
- α-1 (готово) — Notification channels для probe.
- α-3 wave 1+2 (готово) — EntityLink для consistency-проверок R1-R5.
- α-9 wave 2 (готово) — CompanyProfile для R6.
- α-7 wave 1 (готово) — ProcessTemplate/Step для R1-R3.

## 5. Prisma-дельта

```prisma
model CompletenessSlot {
  id            String   @id @default(cuid())
  tenantId      String
  parentCardType String                       // 'regulation' | 'process' | 'role' | 'company_profile'
  parentCardId  String
  slotName      String
  slotKind      String                       // 'required' | 'optional'
  filledAt      DateTime?
  filledByUserId String?
  lastProbedAt  DateTime?
  probeAttempts Int      @default(0)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  tenant        Org      @relation(fields: [tenantId], references: [id])

  @@unique([tenantId, parentCardType, parentCardId, slotName])
  @@index([tenantId, parentCardType, parentCardId])
  @@index([tenantId, filledAt])
}

enum CurationDecisionType {
  approved
  rejected
  merge_duplicates
  evolving                  // существующий
  mark_as_misleading        // существующий
  merge_categories          // НОВЫЙ
  escalate                  // НОВЫЙ
}
```

(Если `CurationDecisionType` уже содержит `merge_categories`/`escalate` — пропустить. Проверить через `grep enum CurationDecisionType` в schema.prisma.)

## 6. Patch / миграция данных

`backend/scripts/patch-backfill-completeness-slots.ts` (опционально, не блокирует DoD):
- Для каждой Regulation/Process/Role/CompanyProfile с `currentVersionId IS NOT NULL`:
  - Запустить `CompletenessScannerService.evaluate(card)` через injectable.
- Идемпотентно по `@@unique`.

## 7. REST API

`GET /api/v1/curation/completeness-slots` (TenantGuard + `curation.read`):
- Query: `cardType?`, `cardId?`, `status? ∈ {'open','filled'}` (open = `filledAt IS NULL`).
- Response: `{ items: CompletenessSlotDto[], totalCount }`.
- Pagination через `take/skip`.

`POST /api/v1/curation/completeness-slots/:id/mark-filled` (manual override, `curation.write`):
- Body: `{ filledByUserId: string }`.
- Эффект: `filledAt = now()`, `filledByUserId = body.filledByUserId`.

Расширение existing `POST /api/v1/curation/items/:id/decide`:
- Принимать `decisionType ∈ {'merge_categories', 'escalate'}` + `metaJson`.

Swagger: документация через `@ApiOperation` + Zod DTO через `nestjs-zod`.

## 8. BullMQ worker'ы и cron'ы

- `CompletenessScannerCron` — `@Cron('0 */6 * * *')` каждые 6 часов, обходит all carded с `updatedAt > now() - 7d`, эвалюирует слоты, upsert'ит CompletenessSlot.
- `ConsistencyCheckerCron` — `@Cron('0 */4 * * *')` каждые 4 часа, запускает 6 правил через `pg` + `EntityLink` join'ы, на каждое нарушение — `ProbeService.suggest({ kind:'consistency_violation', ... })`.
- Идемпотентность — слот upsert по `@@unique`; probe-event дедуп по `(tenantId, entityId, rule)` через Redis SETNX TTL 4ч.

## 9. LlmTaskType регистрация

Нет (это структурные правила, без LLM).

## 10. RBAC ResourceType

- `curation.completeness.read` — для GET endpoint'а.
- `curation.completeness.fill` — для POST mark-filled.
- (Если `curation.*` базовый уже есть и достаточен — использовать его; не плодить.)

## 11. Метрики Prometheus

- `completeness_slots_open_total{tenant_top, card_type}` gauge.
- `completeness_slots_filled_total{tenant_top, card_type}` counter.
- `consistency_violations_total{tenant_top, rule}` counter — rule ∈ {R1..R6}.
- `consistency_checker_duration_seconds` histogram.
- Cardinality: 100 tenant × 4 cardType × 6 rule ~= 2400.

## 12. Frontend

В существующей странице `/curation`:
- Master-detail: добавить колонку «Открытые слоты» (cnt) в строке карточки (если ≥1).
- Detail view: новая вкладка «Полнота» — список CompletenessSlot с status + actions «Заполнить».
- Хедер dashboard-виджета: «N открытых слотов».
- API-клиент: `frontend/src/api/curation.api.ts` extension — `listCompletenessSlots(filters)`.
- Domain-mapper: `frontend/src/domain/completeness-slot.ts`.

## 13. ENV переменные

`backend/src/common/config/env.schema.ts`:
- `COMPLETENESS_SCANNER_ENABLED: boolean (default true)`.
- `CONSISTENCY_CHECKER_ENABLED: boolean (default true)`.
- `CONSISTENCY_CHECKER_DEDUP_TTL_SECONDS: number (default 14400)` (4h).

## 14. Связь с существующим кодом

- `backend/src/modules/curation/services/curation.service.ts` — расширить `decide()` для `merge_categories`/`escalate`.
- `backend/src/modules/curation/workers/card-stale-detector.cron.ts` — паттерн для ConsistencyCheckerCron (тот же @Cron, тот же injectable).
- `backend/src/modules/probe/probe.service.ts` (или эквивалент) — `suggest()` для эмита.
- `backend/src/modules/knowledge-core/services/` — где живут специалисты (для evaluate slots).
- schema.prisma: модели Regulation, Process, Role, CompanyProfile (поля currentVersionId).
- frontend `app/(authenticated)/curation/page.tsx` (через vexp найти точный путь) — добавить вкладку.

## 15. DoD

- [ ] `CompletenessSlot` модель в schema.prisma, `bun run prisma:generate` + `bun run prisma:push` ОК.
- [ ] `CompletenessScannerCron` работает, заполняет slot'ы для тестовой Regulation/Process.
- [ ] `ConsistencyCheckerCron` детектит 6 правил, эмитит probe-events.
- [ ] Endpoint `GET /api/v1/curation/completeness-slots` возвращает данные с фильтрами.
- [ ] `merge_categories` и `escalate` decision-type работают через POST decide.
- [ ] UI в `/curation`: колонка/вкладка отображает CompletenessSlot.
- [ ] `bun run typecheck` + `bun run lint` + `bun run test:unit` зелёные.

## 16. Тесты

- **unit:** `completeness-scanner.service.spec.ts` — slot definitions, evaluate Regulation/Process.
- **unit:** `consistency-checker.service.spec.ts` — каждое из 6 правил.
- **integration:** `curation-completeness.integration.spec.ts` — endpoint + RBAC + filters.
- **unit:** `curation.service.decide.spec.ts` — расширить, тестировать `merge_categories` + `escalate`.

## 17. Риски и mitigation

- **Cron-storm** при первом запуске на проде с большой базой — добавить `LIMIT 500` на одну итерацию + продолжение через `lastScannedAt` cursor в Redis.
- **Probe-spam** при первом запуске ConsistencyChecker — Redis SETNX dedup TTL 4ч уже описан; дополнительно — soft-cap «не более 50 probe в час на тенант».
- **Schema-конфликт** с другими wave-3 sub-ТЗ — кодер сначала проверяет, что enum `CurationDecisionType` ещё не содержит новых значений.
- **Frontend `.next/types/` кэш** — после правки страницы `/curation` запустить `Remove-Item -Recurse -Force .next\types` (PowerShell, Windows).
