---
type: tz
status: ready-for-code
feature: α-3 wave 3 — AxisClassifierService + LLM-fallback Router (полная версия)
phase: alpha-3
date: 2026-05-23
parent: plans/tz/2026-05-22-final-roadmap.md
predecessor: plans/tz/2026-05-23-sba-alpha-3-wave3-axis-classifier.md
related:
  - plans/analysis/2026-05-22-code-reality-deltas.md §α-3
  - plans/tz/2026-05-22-final-roadmap.md §α-3
  - docs/reference/llm-models-playbook.md
---

# SBA α-3 wave 3 — AxisClassifierService + LLM-fallback Router (расширенная версия)

## 1. Цель и контекст

Wave 1 (Vendor/Event) + Wave 2 (Market/OrgUnit + 19 signalType static routing) закрыты. Wave 3 закрывает оставшиеся 2 архитектурных компонента из плана α-3:

1. **AxisClassifierService** — fan-out IdeaBlock по 4 осям знания (WHO / FUNCTIONAL / CONTEXTUAL / TEMPORAL). Нужен для γ-2 Concierge cross-axis queries и δ-1 Orchestrator cross-axis joins.
2. **LLM-fallback Router** — если статический `matchSpecialists` не нашёл targets для signalType (≤2% потока), вызвать LLM. Иначе тонущие сигналы пропадают.

## 2. Scope

**Входит:**
- Модель `IdeaBlockAxisLabel` в schema.prisma + relation.
- Сервис `AxisClassifierService` (`backend/src/modules/knowledge-core/services/axis-classifier.service.ts`).
- Триггер `AxisClassifierService.classify(blockId)` в `block-ingest.worker` после `router.dispatch()`.
- LLM-fallback в `RouterService.matchSpecialists` (feature-флаг `ROUTER_LLM_FALLBACK_ENABLED`).
- Redis cache для LLM-fallback (per `signalType + content-hash`, TTL 24h).
- 2 LlmTaskType: `axis-classify` (primary qwen3.5:9b/Ollama, secondary deepseek-chat, tertiary gpt-4o-mini), `router-fallback` (тот же state).
- Метрики `axis_labels_total{axis}`, `router_fallback_calls_total{result}`, `router_fallback_cache_hit_total`.
- Unit-тесты + integration-test с замоканным LLM.

**Не входит:**
- UI для axis-меток (γ-2 Concierge сделает поверх).
- Backfill для существующих блоков (только новые блоки получают axis-метки).
- Изменения существующих специалистов.

## 3. Принятые решения

1. **AxisType — enum** (who/functional/contextual/temporal) вместо строки. Type-safety + автокомплит.
2. **AxisLabel.label String** — формат `'<entityId>'` или `'<domain-slug>'` или `'temporal:<period>'`. Не enum, т.к. значения генерируются динамически (domain slugs, entity ids).
3. **Источники меток — 3 типа** (`'static'` / `'llm'` / `'manual'`) для аудита и качества.
4. **AxisClassifier — гибрид** static (по уже разрешённым entities в IdeaBlockLink) + LLM. Static покрывает 60-70% WHO/CONTEXTUAL без LLM-вызова. LLM добивает FUNCTIONAL/TEMPORAL.
5. **LLM-fallback в RouterService — отдельный путь** не заменяет static. Если static дал ≥1 target — не вызываем LLM. Если 0 targets — вызываем LLM с whitelist'ом всех зарегистрированных специалистов.
6. **Cache TTL 24h** в Redis для router-fallback. Дешёвая модель + редкие unmatched сигналы = низкий cost, но cache защищает от спайков.
7. **Feature-флаг `ROUTER_LLM_FALLBACK_ENABLED`** (default `false` для prod, `true` для staging) — постепенный rollout.

## 4. Зависимости

- α-3 wave 1+2 (готово) — Vendor/Event/Market/OrgUnit модели, RouterService.matchSpecialists.
- α-2 wave 2 (готово) — 19 signalType.
- common/redis (готово) — для cache.
- ai/services/llm-router (готово).

## 5. Prisma-дельта

```prisma
enum AxisType {
  who
  functional
  contextual
  temporal
}

model IdeaBlockAxisLabel {
  id          String   @id @default(cuid())
  tenantId    String
  blockId     String
  axis        AxisType
  label       String                        // entityId | domainSlug | 'temporal:permanent'
  confidence  Decimal  @db.Decimal(4,3)
  source      String                        // 'static' | 'llm' | 'manual'
  createdAt   DateTime @default(now())

  block       IdeaBlock @relation(fields: [blockId], references: [id], onDelete: Cascade)
  tenant      Org       @relation(fields: [tenantId], references: [id])

  @@index([tenantId, blockId])
  @@index([tenantId, axis, label])
  @@index([axis, label])
}
```

В `model IdeaBlock` добавить обратную связь: `axisLabels IdeaBlockAxisLabel[]`.

## 6. Patch / миграция данных

Нет. Только новые блоки получают axis-метки.

## 7. REST API

Минимальный read-only endpoint для γ-2 (опционально, может быть отложен):
- `GET /api/v1/knowledge/blocks/:id/axes` → `{ who: [...], functional: [...], contextual: [...], temporal: [...] }`.

DTO через Zod. Защита `TenantGuard` + RBAC `knowledge.read`.

## 8. BullMQ worker'ы и cron'ы

- НЕ создаём новую очередь. Триггер AxisClassifier — синхронный вызов внутри `block-ingest.worker` после `router.dispatch()`. Idempotent по `blockId` (upsert по `tenantId+blockId+axis+label`).
- При ошибке classify — лог + продолжение worker'а (не блокирует ingest).

## 9. LlmTaskType регистрация

`backend/scripts/seed-llm-task-routes-axis-classify.ts`:
```ts
// axis-classify: дешёвый, частый
{ taskType: 'axis-classify', priority: 'primary',   provider: 'ollama',   model: 'qwen3.5:9b' }
{ taskType: 'axis-classify', priority: 'secondary', provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'axis-classify', priority: 'tertiary',  provider: 'openai',   model: 'gpt-4o-mini' }

// router-fallback: тот же профиль
{ taskType: 'router-fallback', priority: 'primary',   provider: 'ollama',   model: 'qwen3.5:9b' }
{ taskType: 'router-fallback', priority: 'secondary', provider: 'deepseek', model: 'deepseek-chat' }
{ taskType: 'router-fallback', priority: 'tertiary',  provider: 'openai',   model: 'gpt-4o-mini' }
```
Сослаться комментарием на `docs/reference/llm-models-playbook.md`.

## 10. RBAC ResourceType

- `knowledge.read` (существует) — для read-only axes endpoint'а.
- Запись AxisLabel — internal-only (worker). RBAC не требуется.

## 11. Метрики Prometheus

- `axis_labels_total{tenant_top, axis, source}` counter — top-100 tenant + other; axis ∈ {who|functional|contextual|temporal}; source ∈ {static|llm|manual}. Cardinality ~ 100×4×3 = 1200.
- `router_fallback_calls_total{tenant_top, result}` counter — result ∈ {matched|no_match|llm_error}.
- `router_fallback_cache_hit_total{tenant_top}` counter.
- `axis_classify_duration_seconds{axis}` histogram (для latency-наблюдения LLM-вызовов).

## 12. Frontend

Изменений нет.

## 13. ENV переменные

`backend/src/common/config/env.schema.ts`:
- `ROUTER_LLM_FALLBACK_ENABLED: boolean (default false)`.
- `AXIS_CLASSIFY_ENABLED: boolean (default true)`.
- `ROUTER_FALLBACK_CACHE_TTL_SECONDS: number (default 86400)`.

## 14. Связь с существующим кодом

- `backend/src/modules/knowledge-core/services/router.service.ts` — `matchSpecialists` (расширить LLM-fallback).
- `backend/src/modules/knowledge-core/workers/block-ingest.worker.ts` (найти через vexp) — точка вызова AxisClassifier.
- `backend/src/common/redis` — для cache.
- `backend/src/modules/ai/services/llm-router.service.ts` — для call.
- `schema.prisma` `model IdeaBlock` — добавить обратную relation.

## 15. DoD

- [ ] Модель `IdeaBlockAxisLabel` создана, `bun run prisma:generate` + `bun run prisma:push` ОК.
- [ ] AxisClassifierService реализован, triggered после router.dispatch.
- [ ] LLM-fallback в RouterService включён через ENV-флаг, тестируется.
- [ ] 2 LlmTaskType зарегистрированы через seed-script.
- [ ] Метрики экспортируются в /metrics.
- [ ] Unit-тесты 80%+ покрытие AxisClassifierService.
- [ ] Integration-test: блок с unmatched signalType → LLM-fallback → специалисты найдены.
- [ ] `bun run typecheck` + `bun run lint` зелёные.

## 16. Тесты

- **unit:** `axis-classifier.service.spec.ts` — static + LLM комбинации, идемпотентность upsert.
- **unit:** `router.service.fallback.spec.ts` — static found → no LLM call; static empty + flag off → no call; static empty + flag on → LLM called, cached.
- **integration:** `axis-classify-ingest.integration.spec.ts` — реальный block-ingest.worker запуск с тестовым блоком, проверка наличия axis-меток в БД.

## 17. Риски и mitigation

- **Cost-spike LLM** при unmatched-всплеске — cache TTL + Ollama primary + feature-флаг на prod.
- **Cardinality метрик** — top-N tenant.
- **Race в upsert AxisLabel** — `@@unique([tenantId, blockId, axis, label])` constraint + ON CONFLICT DO NOTHING.
- **Schema-merge conflict с другими wave 3 sub-ТЗ** — кодер ОБЯЗАН сначала `git pull` (если pushed) и проверить schema.prisma на конфликты. CompletenessSlot (α-4 wave 2) — отдельная модель, не пересекается.
- **`.next/types/` кэш** — не применимо (backend only).
