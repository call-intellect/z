---
type: tz
status: done
feature: δ-1 — Orchestrator + OrgKnowledgeIndex (multi-agent research для сложных запросов)
phase: delta-1
date: 2026-05-23
parent: plans/tz/2026-05-22-final-roadmap.md
related:
  - plans/analysis/2026-05-22-code-reality-deltas.md §δ-1
  - plans/tz/2026-05-22-final-roadmap.md §δ-1
---

# SBA δ-1 — Orchestrator + OrgKnowledgeIndex

## 1. Цель и контекст

Для сложных запросов «составь отчёт по X», «сравни Y и Z» — нужен deep multi-step research. Простой chat-v2 не справляется. Pattern Anthropic multi-agent research: оркестратор делает plan → spawn'ит субагентов с изолированным context → синтезирует результаты → верифицирует.

OrgKnowledgeIndex — высокоуровневый индекс «что вообще есть в графе компании» для subagent'ов (быстрый lookup без full scan).

## 2. Scope

**Входит:**
- Backend модуль `orchestrator/`:
  - `OrchestratorService.run({ task, tenantId, userId, depth?: number }) → AsyncIterable<Event>`.
  - 4 шага: `PlanningService.plan(task)` → `SubagentSpawner.spawn(steps[])` → `SynthesisService.synthesize(results[])` → `VerificationService.verify(synthesis, task)`.
  - Depth=1 hard limit (не subagent'ы внутри subagent'ов).
- Модели:
  - `OrchestratorRun` (id, tenantId, userId, task, status, planJson?, synthesisJson?, verificationJson?, startedAt, completedAt).
  - `OrchestratorSubagentJob` (id, runId, stepIndex, agentType, contextJson, resultJson?, status).
- `OrgKnowledgeIndexService` — `getSummary(tenantId)` → high-level summary (entities counts per type, top topics, recent activity). Daily cache.
- Cron `org-knowledge-index-builder.cron` (`@Cron('0 3 * * *')`).
- REST `/api/v1/orchestrator/*` + SSE.
- UI `/orchestrator` (новая страница) + `/orchestrator/runs/[id]`.
- 4 LlmTaskType: `orchestrator-plan`, `orchestrator-subagent` (универсальный для всех subagent calls), `orchestrator-synthesize`, `orchestrator-verify`.

**Не входит:**
- Subagent'ы — отдельные классы по доменам (research, comparison, summary). Базовая 3-4 готовых стратегии; расширение — отдельный backlog.

## 3. Принятые решения

1. **Depth=1 hard limit** — anti-cost-runaway. Subagent не может spawn'ить.
2. **OrgKnowledgeIndex — daily cache** в Redis (TTL 24h). Не real-time — слишком cost.
3. **SSE events для UX** — `{ type: 'plan' | 'subagent_started' | 'subagent_completed' | 'synthesis' | 'verification' | 'done' | 'error' }`.
4. **Verification — отдельный LLM-call** с критериями «соответствует ли synthesis вопросу task» — confidence 0..1. Если <0.6 — retry max 1 раз.
5. **Subagent context isolation** — каждый получает только relevant slice (плейн context, не full history оркестратора).
6. **3-4 готовых стратегии subagent'ов:** `entity_research`, `comparison`, `topic_summary`, `timeline_construction`. Planning step указывает какой strategy использовать.

## 4. Зависимости

- γ-2 (БЛОКЕР) — orchestrator вызывается из ConciergeAgent (а не напрямую). Sub-ТЗ запускать после γ-2.
- chat-v2 (готово).
- knowledge-core graph (готово).

## 5. Prisma-дельта

```prisma
model OrchestratorRun {
  id                String   @id @default(cuid())
  tenantId          String
  userId            String
  task              String   @db.Text
  status            String   @default("planning")    // planning|subagents_running|synthesizing|verifying|done|failed
  planJson          Json?
  synthesisJson     Json?
  verificationJson  Json?
  startedAt         DateTime @default(now())
  completedAt       DateTime?

  user              User     @relation(fields: [userId], references: [id])
  tenant            Org      @relation(fields: [tenantId], references: [id])
  jobs              OrchestratorSubagentJob[]

  @@index([tenantId, userId, startedAt])
}

model OrchestratorSubagentJob {
  id              String   @id @default(cuid())
  runId           String
  stepIndex       Int
  agentType       String              // 'entity_research'|'comparison'|'topic_summary'|'timeline_construction'
  contextJson     Json
  resultJson      Json?
  status          String   @default("pending")    // pending|running|done|failed
  startedAt       DateTime?
  completedAt     DateTime?

  run             OrchestratorRun @relation(fields: [runId], references: [id])

  @@index([runId, stepIndex])
}
```

## 6. Patch / миграция данных

Нет.

## 7. REST API

`/api/v1/orchestrator`:
- `POST /runs` body `{ task, depth?: 1 }` → returns runId + SSE URL.
- `GET /runs/:id` (status + results).
- `GET /runs/:id/events` (SSE stream).
- `POST /runs/:id/cancel`.

## 8. BullMQ worker'ы и cron'ы

- `org-knowledge-index-builder.cron` — daily 03:00.
- `orchestrator-subagent.worker` — отдельная очередь `orchestrator.subagents` для async parallelism.

## 9. LlmTaskType регистрация

```ts
{ taskType: 'orchestrator-plan',       priority: 'primary', provider: 'openai', model: 'gpt-4o' }
{ taskType: 'orchestrator-plan',       priority: 'secondary', provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'orchestrator-plan',       priority: 'tertiary', provider: 'ollama', model: 'qwen3.5:9b' }
{ taskType: 'orchestrator-subagent',   priority: 'primary', provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'orchestrator-subagent',   priority: 'secondary', provider: 'openai', model: 'gpt-4o-mini' }
{ taskType: 'orchestrator-subagent',   priority: 'tertiary', provider: 'ollama', model: 'qwen3.5:9b' }
{ taskType: 'orchestrator-synthesize', priority: 'primary', provider: 'openai', model: 'gpt-4o' }
{ taskType: 'orchestrator-synthesize', priority: 'secondary', provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'orchestrator-synthesize', priority: 'tertiary', provider: 'ollama', model: 'qwen3.5:9b' }
{ taskType: 'orchestrator-verify',     priority: 'primary', provider: 'ollama', model: 'qwen3.5:9b' }
{ taskType: 'orchestrator-verify',     priority: 'secondary', provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'orchestrator-verify',     priority: 'tertiary', provider: 'openai', model: 'gpt-4o-mini' }
```

## 10. RBAC ResourceType

- `orchestrator.run` (employee with feature-flag).
- `orchestrator.admin` (admin — view all runs in org).

## 11. Метрики Prometheus

- `orchestrator_runs_total{tenant_top, status}` counter.
- `orchestrator_subagents_total{tenant_top, agent_type, result}` counter.
- `orchestrator_run_duration_seconds{tenant_top}` histogram.
- `orchestrator_verification_low_confidence_total{tenant_top}` counter.

## 12. Frontend

- `frontend/app/(authenticated)/orchestrator/page.tsx` — request page.
- `frontend/app/(authenticated)/orchestrator/runs/[id]/page.tsx` — live run view.
- API client + SSE.
- NAV link.
- `Remove-Item -Recurse -Force .next\types`.

## 13. ENV переменные

- `ORCHESTRATOR_ENABLED: boolean (default false)` — feature-flag.
- `ORCHESTRATOR_MAX_SUBAGENTS_PER_RUN: number (default 5)`.
- `ORCHESTRATOR_RUN_TIMEOUT_MINUTES: number (default 15)`.

## 14. Связь с существующим кодом

- `backend/src/modules/concierge/` (γ-2) — точка входа.
- `backend/src/modules/knowledge-core/services/chat-v2-retrieval.service.ts` — для subagent retrieval.
- `backend/src/common/graph/` — для subagent graph queries.

## 15. DoD

- [x] 2 модели + service-layer.
- [x] 4 этапа run работают.
- [x] OrgKnowledgeIndex cache + cron.
- [x] REST + SSE + UI.
- [x] LlmTaskType + RBAC + Metrics.
- [x] typecheck/lint/tests.

## 16. Тесты

- **unit:** `orchestrator.service.spec.ts`, `planning.service.spec.ts`, `verification.service.spec.ts`.
- **integration:** complete run flow with mocked LLM.

## 17. Риски и mitigation

- **Cost-runaway** — depth=1, max 5 subagents per run, 15-min timeout, feature-flag default off.
- **Schema merge** — 2 модели; кодер аккуратно.
- **`.next/types/`** — Remove-Item.

## Ревизия от 2026-05-24

**Статус:** done
**Реализовано:**
- 2 модели: `OrchestratorRun` (schema.prisma:5994) + `OrchestratorSubagentJob`.
- `OrchestratorModule` (`backend/src/modules/orchestrator/`): 6 сервисов (planning, subagent-spawner, synthesis, verification, orchestrator, org-knowledge-index) + 4 стратегии (EntityResearch, Comparison, TopicSummary, TimelineConstruction).
- Worker `orchestrator-subagent.worker.ts` + cron `org-knowledge-index-builder.cron.ts` (daily 03:00).
- REST + SSE через `orchestrator.controller.ts` + DTO.
- Hard limits: depth=1, max 5 subagents, 15-min timeout, ORCHESTRATOR_ENABLED default false.
- Frontend: `/orchestrator` request page + `/orchestrator/runs/[id]` live view с SSE; API client `orchestrator.api.ts`.
- LlmTaskType seed: `backend/scripts/seed-llm-task-routes-orchestrator.ts`.
- RBAC `orchestrator` ResourceType (policy.csv:588-595).
