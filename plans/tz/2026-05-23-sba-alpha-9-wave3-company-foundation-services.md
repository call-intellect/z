---
type: tz
status: ready-for-code
feature: α-9 wave 3 — Company Foundation services + crons + seed + 4 UI pages
phase: alpha-9
date: 2026-05-23
parent: plans/tz/2026-05-22-final-roadmap.md
predecessor: plans/tz/2026-05-23-roadmap-data-models-batch.md
related:
  - plans/analysis/2026-05-22-code-reality-deltas.md §α-9
  - plans/tz/2026-05-22-final-roadmap.md §α-9
---

# SBA α-9 wave 3 — Company Foundation services, crons, seed, UI

## 1. Цель и контекст

Wave 2 (data model) закрыт: модели `CompanyProfile`, `FunctionalDomain`, `DepartmentDomainLink` + расширение `Department` в schema. Wave 3 — service-layer, cron'ы (MaturityScorer + domain-expander), seed-script для базовых доменов, миграция Mission/Vision/Strategy → CompanyProfile, и 4 новых UI-страницы.

## 2. Scope

**Входит:**
- Сервисы:
  - `CompanyProfileService` — CRUD + миграция из legacy Mission/Vision/Strategy в JSON-поля.
  - `FunctionalDomainService` — CRUD + tree traversal (parent/children).
  - `DepartmentDomainLinkService` — m:n управление.
  - `MaturityScorerService` — расчёт maturityScore для Role/Department/CompanyProfile.
- Worker'ы / cron'ы:
  - `company-profile-builder.worker` — пересборка CompanyProfile.completeness при изменениях.
  - `department-detector.worker` — авто-извлечение Department из новых блоков.
  - `domain-expander.cron` — `@Cron('0 4 * * *')` авто-создание FunctionalDomain'ов из unmatched функциональных блоков (top-N per week).
  - `MaturityScorerCron` — `@Cron('0 5 * * *')` пересчёт maturityScore.
- Seed: `FunctionalDomainSeed.ts` (8 базовых + per-industry templates: SaaS, Девелопер, Ритейл, Производство, B2B-услуги).
- Patch-script: `patch-migrate-mvs-to-company-profile.ts` (Mission/Vision/Strategy → CompanyProfile.missionJson/visionJson/strategyJson). Mission/Vision/Strategy остаются deprecated.
- TypeScript-interface `IOrganizationalUnit` — реализуют Role, Department, CompanyProfile, FunctionalDomain.
- REST API `/api/v1/company/*`, `/api/v1/departments/*`, `/api/v1/domains/*`, `/api/v1/maturity/*`.
- 4 новые UI страницы: `/company`, `/departments`, `/domains`, `/maturity`.
- 3 новых LlmTaskType: `department-extract`, `domain-expand`, `maturity-rationale`.
- Метрики: `maturity_score_avg{tenant_top, scope}`, `domains_total{tenant_top}`, `departments_total{tenant_top}`.

**Не входит:**
- Виджет Maturity в Director Dashboard — отдельный sub-ТЗ внутри δ-1 / β-8 widgets.
- /structure редизайн — оставляем как есть, добавляем cross-links в navigation (см. §3.3).

## 3. Принятые решения

1. **/structure remains, новые страницы — рядом, не вместо.** /structure — это операционная карта Org/Department/Role/Person с JD. /company — про идентичность (Mission/Vision/Strategy). /domains — про функциональное дерево. /maturity — про метрики зрелости. Это разные концепции; объединение в tabs одной страницы перегружает UX. Добавляем cross-links в navigation: «Структура → Компания → Домены → Зрелость» как breadcrumb-trail в admin shell.
2. **Mission/Vision/Strategy модели → deprecated, не удаляем.** Patch-script мигрирует в CompanyProfile.JSON-поля. Сами модели помечены `// @deprecated, use CompanyProfile` в schema-комментариях. Удаление — отдельный sub-ТЗ через 1-2 месяца после миграции.
3. **domain-expander cron не создаёт >5 новых доменов за один прогон** (anti-spam). Threshold — кластеры из ≥10 unmatched блоков с близкими embedding'ами (cosine ≥ 0.75).
4. **MaturityScorer — формула v1**:
   - Role: `(completeness * 0.4) + (cardCount_capped/10 * 0.3) + (probeClosedRatio * 0.3)`.
   - Department: avg(roles.maturityScore).
   - CompanyProfile: weighted avg(departments.maturityScore).
   - Все capped 0..1.
5. **domain-expander LLM-call один раз в день** на тенант — экономия cost. Cache cluster-hashes в Redis 24h.
6. **IOrganizationalUnit интерфейс**:
   ```ts
   interface IOrganizationalUnit {
     id: string;
     tenantId: string;
     name: string;
     missionStatement?: string;
     entityId?: string;
     maturityScore?: number;
     completeness?: number;
     parentUnitId?: string;
     getChildren(): Promise<IOrganizationalUnit[]>;
   }
   ```
   Шире — see code. Имплементация на сервисах (CompanyProfile/Department/Role/FunctionalDomain).
7. **Seed industry templates** — admin может выбрать в onboarding wizard. После выбора создаются базовые домены + 1-уровень детей.

## 4. Зависимости

- α-9 wave 2 (готово) — модели в schema.
- α-3 wave 2 (готово) — Entity, EntityLink.
- α-1 (готово) — ProbeService для completeness probes.

## 5. Prisma-дельта

Изменений нет.

## 6. Patch / миграция данных

`backend/scripts/patch-migrate-mvs-to-company-profile.ts`:
- Для каждого Org с не-null Mission/Vision/Strategy → создать/обновить CompanyProfile.
- missionJson = { text: mission.text, sourceBlockIds: mission.sourceBlockIds }.
- visionJson, strategyJson — аналогично.
- Идемпотентно (upsert по `tenantId`).

`backend/scripts/seed-functional-domains.ts` — запуск через `bun run seed:functional-domains`. Использует SafeSeedRules (см. skill safe-seed-rules) — admin-edited записи не перезаписывает.

## 7. REST API

Все под `TenantGuard` + RBAC.

`/api/v1/company`:
- `GET /` (current org's profile).
- `PATCH /` (admin only).
- `POST /rebuild-completeness` (manual trigger).

`/api/v1/departments`:
- `GET /` (list with filters status/parent/domain).
- `POST /`, `GET /:id`, `PATCH /:id`, `DELETE /:id` (soft archive).
- `POST /:id/link-domain`, `DELETE /:id/domains/:domainId`.

`/api/v1/domains`:
- `GET /` (tree-view, `?includeChildren=true`).
- `POST /`, `PATCH /:id`, `DELETE /:id` (soft archive).
- `POST /seed-template` body `{ industry: string }`.

`/api/v1/maturity`:
- `GET /overview` (org-level metrics).
- `GET /scope/:scope/:id` (scope ∈ {role|department|company}).
- `POST /rebuild` (admin trigger).

## 8. BullMQ worker'ы и cron'ы

- `company-profile-builder.worker` — очередь `core.company-profile`, дебаунс 30 секунд per tenant.
- `department-detector.worker` — очередь `core.specialist-routing` фильтр signalType=`org_unit` или mentionedEntities с `EntityType=org_unit`.
- `domain-expander.cron` — `@Cron('0 4 * * *')`, per-tenant LLM-call.
- `MaturityScorerCron` — `@Cron('0 5 * * *')` пересчёт всех Role/Department/CompanyProfile.
- Idempotency: company-profile-builder upsert; department-detector dedup по name similarity; domain-expander Redis SETNX TTL 24h на cluster-hash.

## 9. LlmTaskType регистрация

`backend/scripts/seed-llm-task-routes-company-foundation.ts`:
```ts
// department-extract: средняя точность, нужен JSON-mode
{ taskType: 'department-extract',  priority: 'primary',   provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'department-extract',  priority: 'secondary', provider: 'openai',   model: 'gpt-4o-mini' }
{ taskType: 'department-extract',  priority: 'tertiary',  provider: 'ollama',   model: 'qwen3.5:9b' }

// domain-expand: высокая точность нужна (создаём верхнеуровневые домены)
{ taskType: 'domain-expand',       priority: 'primary',   provider: 'openai',   model: 'gpt-4o' }
{ taskType: 'domain-expand',       priority: 'secondary', provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'domain-expand',       priority: 'tertiary',  provider: 'ollama',   model: 'qwen3.5:9b' }

// maturity-rationale: коротко объясняет почему такой score (для tooltip в UI)
{ taskType: 'maturity-rationale',  priority: 'primary',   provider: 'ollama',   model: 'qwen3.5:9b' }
{ taskType: 'maturity-rationale',  priority: 'secondary', provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'maturity-rationale',  priority: 'tertiary',  provider: 'openai',   model: 'gpt-4o-mini' }
```

## 10. RBAC ResourceType

`backend/policies/policy.csv`:
- `company.read`, `company.write` (employee read; admin/super_admin write).
- `department.read`, `department.write`.
- `domain.read`, `domain.write`, `domain.admin` (seed-template только super_admin).
- `maturity.read` (employee/admin/coo); `maturity.rebuild` (admin).

## 11. Метрики Prometheus

- `maturity_score_avg{tenant_top, scope}` gauge — scope ∈ {role|department|company}.
- `domains_total{tenant_top}` gauge.
- `departments_total{tenant_top}` gauge.
- `company_profile_completeness{tenant_top}` gauge.
- `domain_expander_created_total{tenant_top}` counter.
- `maturity_scorer_duration_seconds{scope}` histogram.

## 12. Frontend

- `frontend/app/(authenticated)/company/page.tsx` — full profile editor (Mission/Vision/Strategy/Values/Stage), AI-fill действий.
- `frontend/app/(authenticated)/departments/page.tsx` — master-detail список + детальный вид (linked domains, roles, members).
- `frontend/app/(authenticated)/domains/page.tsx` — древовидный view + seed-template wizard.
- `frontend/app/(authenticated)/maturity/page.tsx` — overview виджеты (org-level) + drill-down per scope.
- API-клиенты: `company.api.ts`, `departments.api.ts`, `domains.api.ts`, `maturity.api.ts`.
- Domain mappers: `company-profile.ts`, `department.ts`, `functional-domain.ts`, `maturity.ts`.
- UI компоненты в `frontend/src/ui/company-foundation/`.
- NAV — добавить ссылки в admin sidebar (после «Регламенты», перед «Процессы»).
- `<ConciergeSlot>` на каждой странице.

## 13. ENV переменные

- `DOMAIN_EXPANDER_ENABLED: boolean (default true)`.
- `DOMAIN_EXPANDER_MIN_CLUSTER_SIZE: number (default 10)`.
- `DOMAIN_EXPANDER_MAX_NEW_PER_RUN: number (default 5)`.
- `MATURITY_SCORER_ENABLED: boolean (default true)`.

## 14. Связь с существующим кодом

- `backend/src/modules/structure/structure.service.ts` (existing) — для re-use Department traversal.
- `backend/src/modules/knowledge-core/services/entity-resolution.service.ts` — для дедупа.
- `backend/src/modules/knowledge-core/specialists/` (паттерн) — для company-profile-builder/department-detector контракт.
- `backend/src/modules/probe/` — для completeness probes.
- frontend `(authenticated)/structure/` (existing) — для cross-links.
- schema.prisma: CompanyProfile, FunctionalDomain, DepartmentDomainLink, Department, Mission/Vision/Strategy.

## 15. DoD

- [ ] 4 сервиса реализованы + IOrganizationalUnit interface.
- [ ] 4 cron/worker'а работают + idempotency.
- [ ] Seed-script запущен (8 базовых доменов в test-tenant).
- [ ] Patch-script мигрировал данные Mission/Vision/Strategy в CompanyProfile (idempotent).
- [ ] 4 REST endpoints отрисованы в Swagger.
- [ ] 4 UI страницы работают, читают данные через API-клиент.
- [ ] LlmTaskType зарегистрированы.
- [ ] RBAC policies в csv.
- [ ] Метрики экспортируются.
- [ ] `bun run typecheck` + `bun run lint` + `bun run test:unit` зелёные.
- [ ] `Remove-Item -Recurse -Force .next\types` после правок frontend (PowerShell).

## 16. Тесты

- **unit:** `maturity-scorer.service.spec.ts` — формула для Role/Department/CompanyProfile.
- **unit:** `functional-domain.service.spec.ts` — tree traversal, prevent циклы.
- **unit:** `domain-expander.cron.spec.ts` — anti-spam threshold.
- **integration:** `company-foundation.api.integration.spec.ts` — все 4 endpoint-группы с TenantGuard.
- **integration:** `patch-migrate-mvs.integration.spec.ts` — миграция MVS на тестовых данных + идемпотентность.

## 17. Риски и mitigation

- **Patch-script на больших Org'ах** — добавить `LIMIT 100` per iteration + продолжение через cursor.
- **domain-expander spam** — Redis SETNX dedup + max-new-per-run cap.
- **Циклы FunctionalDomain.parentDomainId** — service validates depth ≤ 5, отказывает в insertion с циклом.
- **Schema merge** — нет (не модифицируем schema).
- **`.next/types/` кэш** — Remove-Item.
- **Conflict с existing /structure** — не трогать /structure UI, только добавлять cross-link в navigation.
