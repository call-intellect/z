---
type: tz
status: done
feature: α-8 wave 4 — role-map-builder.worker + 5 services + REST + UI for Role Map (Specialist 3.8)
phase: alpha-8
date: 2026-05-23
parent: plans/tz/2026-05-22-final-roadmap.md
predecessor: plans/tz/2026-05-23-sba-alpha-8-wave3-appointment-kpi.md
related:
  - plans/analysis/2026-05-22-code-reality-deltas.md §α-8
  - plans/tz/2026-05-22-final-roadmap.md §α-8
---

# SBA α-8 wave 4 — Role Map service-layer + worker + REST + UI

## 1. Цель и контекст

Wave 2 (нормализованные модели) + wave 3 (Appointment + KPI) — закрыты. Wave 4 — превратить в работающий specialist 3.8: worker для построения Role Map из встреч, 5 сервисов для CRUD over нормализованных моделей, REST API, UI Role Map page.

## 2. Scope

**Входит:**
- 5 сервисов для wave-2 моделей: ResponsibilityElementService, AuthorityBoundaryService, RequiredKnowledgeService, DecisionPolicyService, InteractionService.
- `RoleMapBuilderService` — высокоуровневый агрегатор (`getMap(roleId)` → IRoleMap).
- Worker `role-map-builder.worker.ts` — подписан на core.specialist-routing, signalType={expertise, competence, methodology_step} + EntityLink updates на Role.
- Перенастройка промпта `role-profile-build.prompt.ts` под 9 нормализованных слотов вместо 5-полевой схемы (см. wave 2).
- REST `/api/v1/roles/:id/map`, `/api/v1/roles/:id/maturity`.
- UI `/roles/[id]/map` (графический вид Role Map: 5 нормализованных категорий visualised) и `/persons/[id]/appointments` (timeline назначений из α-8 wave 3).
- 2 LlmTaskType: `role-map-extract`, `role-completeness-rationale`.
- Метрики `role_map_completeness_avg{tenant_top}`, `role_map_builder_runs_total{tenant_top, result}`.
- RBAC.

## 3. Принятые решения

1. **5 сервисов — тонкие CRUD wrapper'ы.** Бизнес-логика агрегации — в `RoleMapBuilderService.getMap()`.
2. **Worker batchовый, как process-detector** — окно 5 минут per role, накапливает blocks, 1 LLM-вызов на батч.
3. **Перенастройка `role-profile-build.prompt.ts`** — расширить JSON-схему под 9 слотов (responsibilities, authority, knowledge, decisions, interactions, метрики, ownership, KPI links, completeness). Old `summaryCache Json` остаётся для backward-compat UI rendering — пока новый UI не готов.
4. **UI Role Map** — графика через cytoscape.js или nivo (D3-like). Узлы — категории (ResponsibilityElement / AuthorityBoundary / ...). Связи — KPI links, DecisionPolicy targets.
5. **Maturity endpoint** — отдельный для drill-down (uses MaturityScorerService from α-9 wave 3).
6. **Auto-extract triggers — confidence ≥ 0.7.** Ниже — куратор review.

## 4. Зависимости

- α-8 wave 2+3 (готово/в работе) — нормализованные модели, Appointment, KPI fields.
- α-3 wave 2 (готово) — EntityLink relationTypes.
- α-9 wave 3 (параллельно) — MaturityScorerService (можно встать в очередь, но не блокер).

## 5. Prisma-дельта

Нет (data model в wave 2+3 уже закрыт). Может потребоваться добавить `@@index([tenantId, roleId])` на ResponsibilityElement если не было.

## 6. Patch / миграция данных

`backend/scripts/patch-rebuild-role-profile-from-summary-cache.ts` — опц., для existing RoleProfile с заполненным `summaryCache` → попытаться извлечь responsibility/authority/knowledge через LLM (`role-map-extract`) → создать нормализованные записи. Idempotent.

## 7. REST API

`/api/v1/roles/:id/map` (TenantGuard + `role.map.read`):
- `GET /` → `{ role, responsibilities[], authority[], knowledge[], decisions[], interactions[], completeness, maturityScore }`.

`/api/v1/roles/:id/maturity`:
- `GET /` → maturity breakdown + rationale (LLM-explained).

`/api/v1/roles/:id/responsibilities` etc — стандартные CRUD per category.

## 8. BullMQ worker'ы и cron'ы

- `role-map-builder.worker` — очередь core.specialist-routing, фильтр signalType.
- `role-map-completeness.cron` — `@Cron('0 4 * * *')` пересчёт completeness для всех Role.
- Дебаунс батч 5 минут per role.

## 9. LlmTaskType регистрация

```ts
{ taskType: 'role-map-extract',           priority: 'primary', provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'role-map-extract',           priority: 'secondary', provider: 'openai', model: 'gpt-4o-mini' }
{ taskType: 'role-map-extract',           priority: 'tertiary', provider: 'ollama', model: 'qwen3.5:9b' }
{ taskType: 'role-completeness-rationale', priority: 'primary', provider: 'ollama', model: 'qwen3.5:9b' }
{ taskType: 'role-completeness-rationale', priority: 'secondary', provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'role-completeness-rationale', priority: 'tertiary', provider: 'openai', model: 'gpt-4o-mini' }
```

## 10. RBAC ResourceType

- `role.map.read` (employee).
- `role.map.write` (admin, hr).
- `role.responsibility.write|read`, `role.authority.*`, `role.knowledge.*`, `role.decision_policy.*`, `role.interaction.*`.

## 11. Метрики Prometheus

- `role_map_completeness_avg{tenant_top}` gauge.
- `role_map_builder_runs_total{tenant_top, result}` counter.
- `role_map_extract_duration_seconds` histogram.
- `roles_with_normalized_data_ratio{tenant_top}` gauge — % ролей с заполненными нормализованными слотами.

## 12. Frontend

- `frontend/app/(authenticated)/roles/[id]/map/page.tsx` — графический вид.
- `frontend/app/(authenticated)/persons/[id]/appointments/page.tsx` — timeline (из α-8 wave 3).
- API клиенты + Domain mappers.
- UI components в `frontend/src/ui/role-map/`.
- NAV (link из существующей /roles/[id] страницы).
- `<ConciergeSlot>`.
- `Remove-Item -Recurse -Force .next\types`.

## 13. ENV переменные

- `ROLE_MAP_BUILDER_ENABLED: boolean (default true)`.
- `ROLE_MAP_BATCH_TIMEOUT_SECONDS: number (default 300)`.

## 14. Связь с существующим кодом

- `backend/src/modules/knowledge-core/prompts/role-profile-build.prompt.ts` (через vexp).
- `backend/src/modules/knowledge-core/specialists/` (паттерн).
- schema.prisma: Role, RoleProfile, ResponsibilityElement, AuthorityBoundary, RequiredKnowledge, DecisionPolicy, Interaction, Appointment.

## 15. DoD

- [x] 5 сервисов + RoleMapBuilderService реализованы.
- [x] Worker работает (батчевый, идемпотентный).
- [x] cron completeness.
- [x] role-profile-build.prompt.ts перенастроен под 9 слотов.
- [x] REST endpoints.
- [x] 2 UI страницы рендерятся.
- [x] LlmTaskType + RBAC + Метрики.
- [x] typecheck/lint/tests зелёные.
- [x] Remove `.next\types`.

## 16. Тесты

- **unit:** для каждого 5 сервисов CRUD + связности.
- **unit:** `role-map-builder.worker.spec.ts` — батчинг, идемпотентность.
- **integration:** REST endpoints с TenantGuard.

## 17. Риски и mitigation

- **role-profile-build.prompt.ts регрессия** — изменения только в JSON-схеме output; existing summaryCache rendering остаётся.
- **Worker schedule conflict с phase-0d role-profile cron** — координируй через @Cron expression: phase-0d на 4 утра, role-map на 5 утра.
- **Schema merge** — нет.
- **`.next/types/`** — Remove-Item.

## Ревизия от 2026-05-24

**Статус:** done
**Реализовано:**
- Модуль `backend/src/modules/role-map/`: 5 сервисов (`responsibility-element.service.ts`, `authority-boundary.service.ts`, `required-knowledge.service.ts`, `decision-policy.service.ts`, `interaction.service.ts`) + `role-map-builder.service.ts` + .spec.
- Worker `role-map/workers/role-map-builder.worker.ts` + cron `role-map-completeness.cron.ts` (батч-окно через ENV).
- Промпт `role-map/prompts/role-map-extract.prompt.ts` (новый, 9 слотов). Старый `knowledge-core/prompts/role-profile-build.prompt.ts` тоже обновлён под 9 слотов.
- REST `role-map.controller.ts` + DTO `dto/role-map.dto.ts` + module `role-map.module.ts`.
- Frontend: `app/(authenticated)/roles/[id]/map/page.tsx` + `RoleMapClient.tsx`; `persons/[id]/appointments/` (timeline из wave 3).
- Seed `backend/scripts/seed-llm-task-routes-role-map.ts` (2 LlmTaskType: `role-map-extract`, `role-completeness-rationale`).
- ENV `ROLE_MAP_BUILDER_ENABLED`, `ROLE_MAP_BATCH_TIMEOUT_SECONDS`.
