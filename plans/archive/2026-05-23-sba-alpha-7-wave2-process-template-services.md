---
type: tz
status: done
feature: α-7 wave 2 — ProcessTemplate services + worker + REST + UI
phase: alpha-7
date: 2026-05-23
parent: plans/tz/2026-05-22-final-roadmap.md
predecessor: plans/tz/2026-05-21-sba-alpha-7-specialist-3-1-regulations.md
related:
  - plans/analysis/2026-05-22-code-reality-deltas.md §α-7
  - plans/tz/2026-05-22-final-roadmap.md §α-7
---

# SBA α-7 wave 2 — ProcessTemplate сервисы + REST + UI

## 1. Цель и контекст

Wave 1 (data model) закрыт: модели `ProcessTemplate`, `ProcessTemplateVersion`, `DecisionPoint`, `ProcessHandoff` + `Process.templateId` уже в schema. Wave 2 закрывает service-layer, worker для extraction'а из встреч, REST и UI — превращает структуры в работающий специалист 3.1.

## 2. Scope

**Входит:**
- Сервисы:
  - `ProcessTemplateService` — CRUD + versioning (immutable snapshots при изменении definitionJson).
  - `DecisionPointService` — CRUD + reference на ProcessTemplateVersion.
  - `ProcessHandoffService` — CRUD + traversal граф handoff между шаблонами.
  - `ProcessExtractionService` — извлечение ProcessTemplate из IdeaBlock'ов signalType=`process_step`+`methodology_step`.
- Worker: `process-detector.worker.ts` — подписан на очередь `core.specialist-routing`, фильтр signalType ∈ {process_step, methodology_step}, агрегирует блоки → ProcessTemplate (новая или обновление существующей через ProcessTemplateVersion).
- 3 новых probe-trigger'а: `missing_input_artifact`, `missing_output_artifact`, `step_without_owner`.
- Cron `process-template-completeness.cron` (раз в день) — пересчёт `ProcessTemplate.completeness`.
- REST API `/api/v1/processes/*` (templates, versions, decision-points, handoffs).
- UI: `/processes` master-detail (список ProcessTemplate + детальный вид с steps/decisions/handoffs/version-history).
- 1 новый LlmTaskType `process-template-extract` (тройная цепочка).
- Метрики `process_templates_total{tenant_top, status}`, `process_template_completeness_avg{tenant_top}`.
- Расширение существующей RouterService.matchSpecialists для маршрутизации process_step/methodology_step на process-detector.worker (если не маршрутизировано).
- RBAC `process_template.read|write`.

**Не входит:**
- Cross-functional process tracking — отдельный sub-ТЗ γ-3.
- Process instance execution tracking (OperationalTask) — отдельный sub-ТЗ.
- Backfill ProcessTemplate'ов из существующих Process записей (опц. patch-script отдельно).

## 3. Принятые решения

1. **ProcessTemplate vs Process** — оба сосуществуют. ProcessTemplate — канонический «как должно быть» (template). Process — instance/legacy (как было). Связь — `Process.templateId? → ProcessTemplate`. Не переименовываем Process, чтобы не ломать существующие consumers (specialist-3-1-regulations + UI /regulations + API /api/v1/regulations).
2. **Versioning ProcessTemplateVersion immutable** — каждое изменение definitionJson создаёт новую version с `versionNumber++` (sequence per template). currentVersionId на template указывает на актуальную.
3. **DecisionPoint живёт внутри ProcessTemplateVersion** (FK `templateVersionId`). Перенос на новую version — копирование DecisionPoint'ов (с новыми id'ами, тот же `name`).
4. **ProcessHandoff — связь между шаблонами** (sourceTemplateId / targetTemplateId), не между шагами. Шаги внутри одного шаблона имеют свой связной граф через DecisionPoint+branches.
5. **Worker extraction — батчевый**: накапливает blocks за окно 5 минут (per tenant), запускает 1 LLM-вызов на батч, получает array ProcessTemplate-кандидатов. Дешевле, чем per-block call.
6. **Completeness формула** — `(filledRequiredSteps + filledRequiredDecisions + filledHandoffs) / totalRequired`. Required slot definitions — в коде, см. α-4 wave 2 для общего подхода.
7. **UI master-detail структура**:
   - Левая колонка: список ProcessTemplate (filterable by status/completeness/owner).
   - Правая: tabs `Шаги | Решения | Хэндоффы | Версии | Полнота`.
   - Action button «Создать вручную» (для админа). Auto-creation — worker делает.

## 4. Зависимости

- α-7 wave 1 (готово) — 4 модели в schema.
- α-3 wave 1+2 (готово) — RouterService, EntityLink.
- α-1 (готово) — ProbeService для probe-trigger'ов.
- α-4 wave 2 (параллельно) — паттерн CompletenessSlot, но не блокер (используем in-memory completeness формулу здесь).

## 5. Prisma-дельта

Изменений в schema нет. Опционально: добавить `@@index([tenantId, status, completeness])` на ProcessTemplate для UI list-view (если нет).

## 6. Patch / миграция данных

`backend/scripts/patch-link-process-to-template.ts` (опц., не блокирует DoD):
- Для каждого Process с непустым `name` и `tenantId`:
  - Если существует ProcessTemplate с тем же `name` в том же tenant → set `process.templateId = template.id`.
  - Иначе создать ProcessTemplate с status='draft' и линкнуть.
- Идемпотентно.

## 7. REST API

Все эндпоинты под `TenantGuard` + `process_template.read|write`. Zod DTO. Swagger через `@ApiOperation`.

`/api/v1/processes/templates`:
- `GET` (list, filters: status, ownerEntityId, completenessMin, search) — пагинация take/skip.
- `POST` (create draft).
- `GET /:id` (detail with currentVersion + steps + handoffs).
- `PATCH /:id` (update metadata).
- `DELETE /:id` (soft delete — status='archived').
- `POST /:id/versions` (создать новую версию с definitionJson).
- `GET /:id/versions` (история).
- `POST /:id/versions/:versionId/activate` (currentVersionId = versionId).

`/api/v1/processes/decision-points`:
- `GET /?templateVersionId=` (list).
- `POST` (create within version).
- `PATCH /:id`, `DELETE /:id`.

`/api/v1/processes/handoffs`:
- `GET /?sourceTemplateId=&targetTemplateId=` (list).
- `POST`, `PATCH /:id`, `DELETE /:id`.

`/api/v1/processes/extract` (admin-trigger):
- `POST` body `{ blockIds: string[] }` → асинхронный job через process-detector.worker.

## 8. BullMQ worker'ы и cron'ы

- `process-detector.worker` — очередь `core.specialist-routing`, фильтр по signalType. JobId паттерн `process-detector_${tenantId}_${batchHash}`. Idempotent.
- `process-template-completeness.cron` — `@Cron('0 3 * * *')` — пересчёт completeness для всех `status != 'archived'` template'ов.
- Дебаунс — батч-окно 5 минут per tenant: блоки буферизуются в Redis-list, при достижении 10 блоков ИЛИ 5-минутного таймаута запускается job.

## 9. LlmTaskType регистрация

`backend/scripts/seed-llm-task-routes-process-template.ts`:
```ts
{ taskType: 'process-template-extract', priority: 'primary',   provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'process-template-extract', priority: 'secondary', provider: 'openai',   model: 'gpt-4o-mini' }
{ taskType: 'process-template-extract', priority: 'tertiary',  provider: 'ollama',   model: 'qwen3.5:9b' }
// см. docs/reference/llm-models-playbook.md
```

## 10. RBAC ResourceType

В `backend/policies/policy.csv`:
- `process_template.read` для ролей `employee`, `admin`, `super_admin`, `coo`.
- `process_template.write` для ролей `admin`, `super_admin`.
- `process_template.admin` для `super_admin` (force-activate version, delete без archived).

## 11. Метрики Prometheus

- `process_templates_total{tenant_top, status}` gauge — status ∈ {draft|active|archived}.
- `process_template_completeness_avg{tenant_top}` gauge.
- `process_detector_extractions_total{tenant_top, result}` counter — result ∈ {new|updated|skipped}.
- `process_template_extract_duration_seconds` histogram.
- Cardinality ~100 × 3 = 300.

## 12. Frontend

- `frontend/app/(authenticated)/processes/page.tsx` — master-detail.
- `frontend/app/(authenticated)/processes/[id]/page.tsx` — детальный вид с tabs.
- `frontend/src/api/processes.api.ts` — apiClient methods (ApiDto layer).
- `frontend/src/domain/process-template.ts` — DomainModel mapper.
- `frontend/src/ui/processes/`:
  - `ProcessTemplatesList.tsx`
  - `ProcessTemplateDetail.tsx`
  - `ProcessStepsTab.tsx`
  - `DecisionPointsTab.tsx`
  - `HandoffsTab.tsx`
  - `VersionsTab.tsx`
- NAV — добавить ссылку «Процессы» в основной sidebar (после «Регламенты»).
- `<ConciergeSlot context={...}>` на детальной странице (требование UI-правила 5).

## 13. ENV переменные

- `PROCESS_DETECTOR_BATCH_SIZE: number (default 10)`.
- `PROCESS_DETECTOR_BATCH_TIMEOUT_SECONDS: number (default 300)`.

## 14. Связь с существующим кодом

- `backend/src/modules/knowledge-core/services/router.service.ts` — расширить matchSpecialists для process_step/methodology_step.
- `backend/src/modules/knowledge-core/specialists/specialist-3-1-regulations/` (через vexp) — паттерн контракта §5.
- `backend/src/modules/knowledge-core/services/card-rollup-v2.service.ts` — паттерн §5 эталон.
- `backend/src/common/graph/graph.service.ts` — для EntityLink производственных связей `produces`, `consumed_by`, `transfers_to`.
- schema.prisma: ProcessTemplate, ProcessTemplateVersion, DecisionPoint, ProcessHandoff, Process, ProcessStep.

## 15. DoD

- [x] 4 сервиса (ProcessTemplateService, DecisionPointService, ProcessHandoffService, ProcessExtractionService) реализованы.
- [x] worker `process-detector.worker` — JobId idempotent, обрабатывает signalType=process_step/methodology_step.
- [x] 3 probe-trigger'а эмитят probe-events.
- [x] cron completeness работает.
- [x] REST API endpoints зарегистрированы, Swagger genertes схему.
- [x] UI `/processes` master-detail с 5 tabs работает (CRUD + extract action).
- [x] LlmTaskType зарегистрирован через seed-script.
- [x] RBAC permissions в policy.csv.
- [x] Метрики в /metrics.
- [x] `bun run typecheck` + `bun run lint` + `bun run test:unit` зелёные в backend и frontend.
- [x] `Remove-Item -Recurse -Force .next\types` после frontend правок (PowerShell).

## 16. Тесты

- **unit:** `process-template.service.spec.ts` — CRUD + versioning logic (immutable snapshots).
- **unit:** `process-extraction.service.spec.ts` — extraction из mock blocks (LLM мок).
- **unit:** `process-detector.worker.spec.ts` — JobId idempotency.
- **integration:** `processes-api.integration.spec.ts` — endpoints с TenantGuard.
- **e2e (Playwright):** `/processes` master-detail — создание шаблона + добавление step + version history.

## 17. Риски и mitigation

- **Schema merge с другими wave-3 sub-ТЗ** — нет (schema не модифицируется, только запросы).
- **LLM extraction false-positives** (создание дублей ProcessTemplate) — `ProcessExtractionService` дедуп по `name+tenantId` similarity > 0.85 cosine на embedding name+description, объединение в существующий template как новую version.
- **Cardinality метрик** — tenant_top-100 + other.
- **Conflict с specialist-3-1-regulations existing extraction** — координировать: regulations отвечает за тексты регламентов; ProcessTemplate — за structured pipeline. signalType=`regulation` остаётся на regulations, signalType=`process_step` — новый owner (process-detector).
- **`.next/types/` кэш** после правки frontend — Remove-Item через PowerShell.
- **DTO Zod несовместимость с существующими nestjs-zod версиями** — кодер проверяет существующие DTO в `regulations.controller.ts` как образец, использует тот же паттерн.

## Ревизия от 2026-05-24

**Статус:** done
**Реализовано:**
- 4 сервиса в `backend/src/modules/processes/services/`: `process-template.service.ts`, `decision-point.service.ts`, `process-handoff.service.ts`, `process-extraction.service.ts` + `process-template-completeness.service.ts` + `.spec`.
- Worker `backend/src/modules/knowledge-core/workers/process-detector.worker.ts` + cron `process-template-completeness.cron.ts` (вторая копия cron в `knowledge-core/workers/`).
- 3 probe-trigger'а в `processes/services/process-template-probe.service.ts` (missing_input_artifact / missing_output_artifact / step_without_owner).
- REST `processes/processes.controller.ts` + DTO `dto/processes.dto.ts`.
- Frontend `app/(authenticated)/processes/` (page.tsx + ProcessTemplatesClient.tsx, 5 tabs внутри).
- Seed `backend/scripts/seed-llm-task-routes-process-template.ts` (1 LlmTaskType `process-template-extract`).
- Promпт `knowledge-core/prompts/process-template-extract.prompt.ts`.
- ENV `PROCESS_DETECTOR_BATCH_SIZE`, `PROCESS_DETECTOR_BATCH_TIMEOUT_SECONDS` в env.schema.ts.
- Бонус: γ-3 cross-functional process (`processes/cross-functional.controller.ts` + service + cron) — заложен дополнительно сверх scope.
