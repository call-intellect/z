---
title: RoleProfileAgent (карта должности)
phase: 0d
status: implemented
date: 2026-05-21
references:
  - plans/tz/2026-05-21-phase-0d-role-profile-agent.md
---

# RoleProfileAgent

## Что это
BullMQ-воркер, который собирает «карту должности» (`RoleProfile.summaryCache`) автоматически: cron `@Cron('0 */4 * * *')` (раз в 4 часа) + on-demand через `POST /api/v1/role-profiles/:roleId/rebuild`.

## Структура summaryCache
```json
{
  "responsibilities": [{ "title", "details", "evidence": ["uuid"] }],
  "skills":           [{ "name", "level", "evidence": ["uuid"] }],
  "decision_patterns":[{ "pattern", "examples": ["uuid"] }],
  "common_pitfalls":  [{ "description", "frequency_observation" }],
  "style_profile":    "1-3 предложения"
}
```

## Поток
1. Cron / on-demand → `role-profile.queue` enqueue.
2. Worker (`backend/src/modules/knowledge-core/workers/role-profile.worker.ts` или отдельный модуль) подхватывает.
3. Проверяет порог: `count(IdeaBlock WHERE roleRelevant=true AND roleId=?) >= 5`. Если меньше — `status='forming'`, skip.
4. `ContextBuilder.buildContext(...)` через `GraphService.traverse(...)`: Role → Person → Meeting → IdeaBlock → Theme + Decision + Process (4-5 хопов).
5. LLM `LlmRouterService.run({ taskType: 'role-profile-build', promptKey: 'role-profile-build-v1' })`.
6. zod-parse + сохранение в `RoleProfile.summaryCache`, `status='ready'`, `buildVersion++`.

## On-demand 409
Если в очереди уже есть waiting/active job для этого roleId → `409 Conflict` с `{ status, since }`. Идемпотентность через `jobId: 'role-profile:${roleId}:${buildVersion}'`.

## Stale-detection cron
`@Cron('0 * * * *')` — раз в час. Маркирует `RoleProfile.status='stale'` если есть новые IdeaBlock после `lastBuildAt`.

## Метрики
- `z_role_profile_built_total{trigger}`
- `z_role_profile_skipped_total{reason='below_threshold'}`
- `z_role_profile_failed_total`
- `z_role_profile_llm_cost_usd`

## Промпт
`role-profile-build-v1` в prompt registry + code fallback. Источник — `plans/tz/2026-05-21-phase-0d-role-profile-agent.md` §6.1.
