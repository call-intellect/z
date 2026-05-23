---
type: tz
phase: alpha-3
status: planned
related:
  - plans/analysis/2026-05-22-code-reality-deltas.md §α-3 п.2,3
  - plans/analysis/2026-05-22-unified-product-architecture.md (4 оси знания)
  - backend/src/modules/knowledge-core/services/router.service.ts
date: 2026-05-23
---

# SBA α-3 wave 3 — AxisClassifierService + LLM-fallback Router

> **Wave 1** закрыта (модели Vendor, Event и базовый RouterService).
> **Wave 2** закрыта 2026-05-23 (модели Market, OrgUnit + 7 EntityLinkType + 19 signalType + статический mapping для них в RouterService).
> **Wave 3** — оставшаяся архитектурная работа: классификатор по 4 осям + LLM-fallback для unmatched signalType.

## Scope (wave 3)

### Часть A — AxisClassifierService

Новый сервис, fan-out IdeaBlock по 4 осям онтологии Кора v2:

1. **WHO** — кто говорит/о ком (Person × Role × OrgUnit × Department).
2. **FUNCTIONAL** — функциональная область (Sales × Engineering × Marketing × …).
3. **CONTEXTUAL** — контекст ситуации (Customer × Vendor × Project × Market × Product).
4. **TEMPORAL** — временной горизонт (одноразовый комментарий / повторяющийся паттерн / стратегический).

На каждой оси блок может получить 0..N меток. Хранение — `IdeaBlockAxisLabel` (new model):
```prisma
model IdeaBlockAxisLabel {
  id          String   @id @default(cuid())
  blockId     String
  axis        AxisType         // who | functional | contextual | temporal
  label       String           // e.g. 'sales', 'project:proj_id', 'market:retail-ru'
  confidence  Decimal @db.Decimal(4,3)
  source      String           // 'static' | 'llm' | 'manual'
  createdAt   DateTime @default(now())
  @@index([blockId, axis])
  @@index([axis, label])
}
```

Использование — для cross-axis queries в γ-2 Concierge, δ-1 Orchestrator, агрегации в Director Dashboard.

### Часть B — LLM-fallback в RouterService

После статического switch'а в `matchSpecialists`:
- Если `targets.size === 0` для signalType не из whitelist'а (commitment/mood/drift/metric_change + 5 β-6/β-7/β-8 future-типов).
- LLM-вызов `LlmTaskType.router-fallback`: на вход name + criticalQuestion + trustedAnswer блока, на выход — массив specialist names или пустой массив.
- Промпт: «Какие специалисты из [список] могут найти ценность в этом блоке? Верни массив или пустой массив, если ни один».
- Confidence ≥ 0.7 для принятия. Иначе no-op.
- Cache в Redis per (signalType + content-hash) на 24 часа — дублирующие запросы стоят 1¢, не нужно платить дважды.

## DoD (wave 3)

- [ ] AxisClassifierService реализован + IdeaBlockAxisLabel + миграция данных.
- [ ] AxisClassifier triggered в block-ingest.worker после router.dispatch.
- [ ] RouterService.LLM-fallback включён feature-флагом `ROUTER_LLM_FALLBACK_ENABLED`.
- [ ] LlmTaskType: `axis-classify`, `router-fallback` зарегистрированы.
- [ ] Тесты: 80% покрытие AxisClassifierService; интеграционный тест RouterService LLM-fallback.

## Почему отдельный sub-ТЗ

Wave 1+2 — это «backward-compat и фундамент». Существующие специалисты работают без axis-меток. LLM-fallback требует:
- Регистрация нового LlmTaskRoute в БД (тройная цепочка primary/secondary/tertiary).
- Промпт + JSON-schema + Zod-валидация.
- Cache infrastructure поверх Redis.
- Тесты с замоканным LLM.

Это полноценный sub-ТЗ ~3-5 файлов кода, отдельная PR с собственным review.

## Что НЕ блокирует

α-3 wave 1 и wave 2 закрыты. Все 19 новых signalType маршрутизируются статикой (см. router.service.ts §matchSpecialists). LLM-fallback нужен только когда появится «много» unmatched сигналов — на текущем объёме это <2% от потока.

## Связь с другими ТЗ

- γ-2 Concierge — требует AxisClassifier для query «найди всё про X на оси Y».
- δ-1 Orchestrator — требует AxisClassifier для cross-axis joins.
- Любая фаза, добавляющая >5 новых signalType без статического mapping — должна включить LLM-fallback feature-флагом.
