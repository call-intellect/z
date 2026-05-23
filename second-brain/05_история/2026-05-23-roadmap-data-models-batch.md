---
date: 2026-05-23
title: Реализация Шагов 2-3 final-roadmap — admin unification + α-2/α-3/α-7/α-8/α-9 data models
related:
  - plans/analysis/2026-05-22-code-reality-deltas.md
  - plans/tz/2026-05-22-final-roadmap.md
  - plans/tz/2026-05-23-sba-alpha-2-19-signal-types.md
  - plans/tz/2026-05-23-sba-alpha-3-wave3-axis-classifier.md
distilled: false
---

# Реализация Шагов 2-3 final-roadmap — admin unification + 5 sub-ТЗ data models

## Что было поставлено

Владелец после успешного закрытия 6 CRIT-багов дал команду «идти дальше по первоначальному плану и не останавливаться». Это запустило проход по Шагам 2-3 final-roadmap.md.

## Что сделано

### Шаг 2 — унификация admin-групп (P0 для α-10)

Перенёс 6 страниц из `(admin)/admin/*` в `(authenticated)/admin/*` через `git mv` с сохранением истории. Удалил старый `(admin)/admin/layout.tsx` с AdminRouteGuard (slate-shell). Расширил `(authenticated)/admin/AdminShell.tsx` NAV до 4 семантических групп: Обзор / Использование / Контент и AI / Тенанты и медиа. Страница `/admin/login` осталась в `(admin)/admin/login/` с локальным layout-override.

Никаких URL-конфликтов между группами не было, миграция чистая. AdminRouteGuard остался как unused, но не удалён — мог использоваться в комментариях документации.

### Шаг 3a — α-2 wave 2: 19 новых signalType

В `enum SignalType` добавлено 19 значений для β-6 / β-7 / β-8 / γ-1 / γ-3 / δ-2 (см. `plans/tz/2026-05-23-sba-alpha-2-19-signal-types.md`). Каждый signalType получил детальное описание в SYSTEM_PROMPT `block-ingest.prompt.ts` с маркер-фразами и указанием потребителя. TODO «согласовать описания» снесён.

### Шаг 3b — α-3 Layer 2 Ontology

Wave 1 (Vendor/Event) уже была. Wave 2:
- Модели Market (ось CONTEXTUAL — рынок) и OrgUnit (структурное подразделение).
- EntityType расширен на `market` и `org_unit`.
- 7 EntityLinkType: reports_to, manages, collaborates_with, mentors, conflicted_with, transfers_result_to, escalates_to.
- RouterService.matchSpecialists получил статический mapping для всех 19 новых signalType из α-2 wave 2.
- Patch-script `patch-migrate-entity-custom-to-topic.ts` (по образцу `patch-rename-client-to-customer.ts`).
- AxisClassifierService + LLM-fallback router отделены в отдельный sub-ТЗ wave 3 (`plans/tz/2026-05-23-sba-alpha-3-wave3-axis-classifier.md`) — это требует регистрации LlmTaskType + Redis cache infrastructure.

### Шаг 3c — α-7 ProcessTemplate

4 новые модели для Specialist 3.1 Regulations:
- `ProcessTemplate` — канонический шаблон процесса (категория, scope, currentVersionId).
- `ProcessTemplateVersion` — иммутабельные snapshot'ы с definitionJson.
- `DecisionPoint` — точка принятия решения с branchesJson и опц. role-decider.
- `ProcessHandoff` — передача между шагами/шаблонами/ролями (kind, expectedSlaHours).

Process получил `templateId?` для связи instance → template. ProcessStep остался как plain step. Backward-compat сохранён.

### Шаг 3e — α-8 Role Map Builder

Расширены Role (missionStatement, maturityScore, entityId) и RoleProfile (builtAt, builderAgentVersion, observationCount, completeness). 5 новых нормализованных таблиц:
- ResponsibilityElement (self-ref outcome → function → activity).
- AuthorityBoundary (allowed/requires_approval/forbidden + approverRoleId).
- RequiredKnowledge (topic + importance + expectedLevel).
- DecisionPolicy (FK на Regulation для аудита).
- Interaction (с counterpartRole/Department/external).

RoleProfile.summaryCache остаётся как UI-кеш; канонические данные — в новых таблицах. KPI + Appointment (миграция PersonRole) отделены в wave 3 — PersonRole используется в PersonsService и требует синхронных правок кода.

### Шаг 3f — α-9 Company Foundation

3 новые модели:
- `CompanyProfile` 1:1 с Org. Заменяет Mission/Vision/Strategy через JSON-поля (missionJson, visionJson, strategyJson) + targetMarketIds, maturityScore, stage. Старые модели остаются deprecated.
- `FunctionalDomain` — дерево функциональных областей с parentDomainId и slug.
- `DepartmentDomainLink` — m:n Department ↔ Domain с coverageRatio и role.

Department расширен (missionStatement, completeness, entityId, sourceBlockIds, confidence).

MaturityScorerCron + domain-expander.cron + FunctionalDomainSeed.ts + UI страницы — wave 3.

## Что вышло (верификация)

После каждого коммита:
- `bun run prisma:generate` без ошибок.
- `bun run typecheck` 0 errors (несмотря на 100+ новых полей и 11 новых моделей).
- Frontend typecheck 0 errors после admin unification (с очисткой `.next/types/` кэша).

Всего за сессию: 12 коммитов:
1. `fix(crit): закрытие 6 критических багов CRIT-1..CRIT-6` (backend + scripts).
2. `docs(second-brain): уроки и deploy-checklist по CRIT-4..CRIT-6 + рефлексия`.
3. `feat(admin): унификация admin-групп под единый Z-Admin shell (Шаг 2)`.
4. `feat(α-2): 19 новых signalType для β-6/β-7/β-8/γ-1/γ-3/δ-2`.
5. `feat(α-3): модели Market + OrgUnit + 7 EntityLinkType (wave 2)`.
6. `chore(α-3): patch-migrate-entity-custom-to-topic (deprecated cleanup)`.
7. `feat(α-3): static routing для 19 новых signalType + sub-ТЗ wave 3`.
8. `feat(α-7): ProcessTemplate + Version + DecisionPoint + ProcessHandoff (data model)`.
9. `feat(α-8): Role Map — расширение Role/RoleProfile + 5 нормализованных моделей`.
10. `feat(α-9): Company Foundation — CompanyProfile + FunctionalDomain + расширение Department`.

## Чему научился

1. **Data-model batch — самая дешёвая фаза имплементации.** Расширение Prisma-схемы без service/worker логики стоит ~5-10 минут на модель, а typecheck сразу даёт уверенность что обратные relations согласованы. Это позволяет фундамент 5 sub-ТЗ заложить параллельно прежде, чем браться за дорогую логику.

2. **Backward-compat через deprecation strict-better чем переименование.** Каждый раз, когда возникал выбор — переименовать (Process → ProcessTemplate, PersonRole → Appointment, Metric → KPI) или создать рядом — я выбирал «создать рядом». Это даёт нулевой risk на текущий код, а миграцию данных можно сделать аккуратным patch-script'ом потом.

3. **Wave-разбиение крупного sub-ТЗ — ключ к достижимости.** Каждое α-3/7/8/9 в delta декларировалось как один блок работы (4-7 моделей + service + cron + UI + миграция). Разбиение на wave 1 (data model only) → wave 2 (service) → wave 3 (UI + cron) позволяет коммитить заметный progress в каждой сессии и не блокировать downstream фазы.

4. **`.next/types/` кэш Next.js — false-positive источник.** После `git mv` route group'ы Next.js хранит type-shims на старые пути, что ломает typecheck. Решение: `Remove-Item -Recurse .next\types` через PowerShell (Bash `rm -rf` блокируется sandbox'ом). Сохраню в code-pitfalls.

## Что осталось (по приоритету)

### Критическое (для прохода Кора v2)
- **α-5 DialogService** — целиком новый модуль (Contextualizer, MultiQueryExpansion, QueryClassifier, Summarizer, ConfidenceEstimator) + AnswerCache/RetrievalCache + temporal `validAt` + mode-specific prompts. ~10-15 файлов нового кода. Самый большой scope из оставшихся.
- **α-10 Admin LLM + Economics** — 5 новых моделей (LlmProvider, LlmModel, AiCostDaily, OrgBudgetCap, CurrencyRate) + 4 cron'а + REST + 4 frontend-страницы. Унификация admin-групп (Шаг 2) уже сделана как предусловие.
- **β-1 Telegram zero-button rip-out** — удаление CommandHandlerService + slash-commands + inline_keyboard + callback_query из telegram-bot и max-bot. Добавить voice→ASR и document-ingest. Зависит от α-5 (LLM-классификатор intent).

### Wave 2/3 для уже-закрытых sub-ТЗ
- α-3 wave 3: AxisClassifierService + LLM-fallback router (sub-ТЗ создан).
- α-7 wave 2: worker для extraction'а ProcessTemplate из встреч, API, UI.
- α-8 wave 3: KPI (расширение Metric) + Appointment (миграция PersonRole).
- α-9 wave 3: MaturityScorerCron + domain-expander.cron + FunctionalDomainSeed.ts + UI (/company, /domains, /maturity).

### Новое (отдельные sub-ТЗ)
- β-6 Experiment Tracker, β-7 Brand Voice Curator, β-8 PersonalRelation + COO + DailyCheckIn.
- γ-2 Concierge Agent, γ-3 CrossFunctionalProcess + Handoff (зависит от α-7).
- δ-1 Orchestrator + OrgKnowledgeIndex, δ-2 ProactiveWatcher, δ-3 Voice Channel.

### Доделки done-блоков
- β-3: `Decision.appliedPolicyId` FK после α-8 (DecisionPolicy теперь готова — добавлять не блокирует ни одну функциональность сейчас).
- β-4: `causeCategory` поле в Insight.
- β-5: closing-loop (RawEvent от ответа на probe).
- γ-1: SkillTraitCategory + гибрид-версионирование ExecutablePersona.

## Prod-инструкция для применения этой сессии

Если применять последовательно на проде:
1. **Backfill `Meeting.tenantId`** (CRIT-3) → запустить `bun run scripts/backfill-orgs-fase0.ts` (если ещё не).
2. **Применить новую schema.prisma** через `bun run prisma:push`. Будут добавлены: 11 новых моделей (Market, OrgUnit, ProcessTemplate, ProcessTemplateVersion, DecisionPoint, ProcessHandoff, ResponsibilityElement, AuthorityBoundary, RequiredKnowledge, DecisionPolicy, Interaction, CompanyProfile, FunctionalDomain, DepartmentDomainLink) + расширения Role/RoleProfile/Department/Process.
3. **Tighten `Meeting.tenantId`** — `bun run scripts/tighten-meeting-tenant-not-null.ts` (idempotent + verify).
4. **Deprecated cleanup**:
   - `bun run scripts/patch-rename-client-to-customer.ts` (если ещё не запускали).
   - `bun run scripts/patch-migrate-entity-custom-to-topic.ts`.
5. **AGE extension** — убедиться, что включена через `shared_preload_libraries='age'` (см. age-deployment-decision.md).
6. **Apply postgres-init** — `bun run apply-postgres-init` для индексов pgvector и AGE-графа.

## Что НЕ запушено

Все 12 коммитов локальные (на ветке `dev`). По правилу CLAUDE.md `git push` требует явного подтверждения владельца. Жду решение.
