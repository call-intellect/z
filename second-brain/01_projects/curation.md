# Curation (Слой 4) — Layer 4 Curation Foundation

> Sub-TZ: [`plans/archive/2026-05-21-sba-alpha-4-layer4-curation-foundation.md`](../../plans/archive/2026-05-21-sba-alpha-4-layer4-curation-foundation.md). Зонтичный: [`plans/archive/2026-05-21-second-brain-agents-umbrella.md`](../../plans/archive/2026-05-21-second-brain-agents-umbrella.md) §3.6, §5.

## Зачем

Любая карточка специалиста Слоя 3 (Regulation, Decision, Process, Insight, Idea, KnowledgeProfile, Skill, ...) обязана пройти через **triage** перед тем как стать canonical. Это защищает от LLM-галлюцинаций и даёт компании право корректировать AI-выводы в естественном потоке работы. Без Слоя 4 любая попытка автоматизации Слоя 3 разваливается: либо мы канонизируем мусор, либо превращаем продукт в очередь модерации для одного админа.

## Контракт для специалиста (`CurationService.triage`)

```ts
const res = await curation.triage({
  tenantId,
  resourceType: 'regulation',   // тип карточки специалиста
  resourceId,                   // id карточки в его собственной таблице
  confidence: 0.72,             // [0..1] (raw, сырое значение LLM)
  calibratedConfidence: 0.81,   // опц. [0..1] — калиброванная через Platt scaling;
                                // если задана, triage сравнивает с порогами ИМЕННО её
  proposedPayload: {...},       // что предлагаем канонизировать
  conflictSignal: 'none' | 'soft' | 'hard',
  conflictIds: ['cf_...'],      // опц. ConflictItem'ы, созданные через ConflictService
  criteria: { tag: 'enterprise' }, // опц. — для CuratorRouting
  createdByUserId,              // опц. — автор; идёт в CardVersion.createdByUserId
  dataClass: 'internal',        // опц. — dataClass для нотификаций
});

// res.decision: 'auto' | 'provisional' | 'light' | 'deep'
// если 'auto' | 'provisional' — res.cardVersionId создан (специалист помечает
// свою карточку как canonical). Иначе — карточка остаётся draft до завершения
// triage'а; после `decide`'а — CardVersion создаётся через CurationService.
```

## Четыре уровня triage

Сравнение с порогами идёт по `effectiveConfidence` = `calibratedConfidence` (Platt scaling, clamped в [0..1]), если она задана; иначе fallback на raw `confidence`. `TriageDecision = 'auto' | 'provisional' | 'light' | 'deep'`.

| Уровень | Условие | Что делается |
|---|---|---|
| **auto-canonical** | `effectiveConfidence >= autoThreshold` И `conflictSignal='none'` И тип не в `criticalTypes` | сразу `CardVersion(version=N+1, changeReason='initial', trustTier='auto')`. Метрика `curation_auto_canonical_total`. |
| **provisional** (A1 «лестница доверия») | тип в `criticalTypes` И `conflictSignal!='hard'` И `aiVerifierEnabled` И `effectiveConfidence >= provisionalThreshold` И AI-судья (3-голосовый debate) дал accept-консенсус | `CardVersion(version=N+1, trustTier='provisional')` минуя человека. Метрика `curation_provisional_total`. Если AI-судья не дал accept / недоступен — безопасный fallback в deep review. |
| **light review** | `autoThreshold > effectiveConfidence >= deepReviewThreshold` ИЛИ `conflictSignal='soft'` | `CurationItem(level='light')` + probe через `curation.pending`. Куратор одной кнопкой approve/reject/approve_with_edits. |
| **deep review** | `effectiveConfidence < deepReviewThreshold` ИЛИ `conflictSignal='hard'` ИЛИ тип в `criticalTypes` (если провизорный путь не сработал) | `CurationItem(level='deep')` + probe + дополнительная эскалация через `system.message` severity='warning'. Reasoning обязателен. |

Пороги настраиваются per-org через `/settings/curation`. Дефолты — из ENV (`CURATION_*`).

## Multi-touch UI

1. **`/curation`** — центральная очередь (master-detail). Фильтры: level, status, resourceType, assignedToMe. В детальной — payload, provenance, связанные ConflictItem'ы, кнопки decision.
2. **Inline `<CurationBanner>`** — заготовка на странице любой карточки специалиста. Если есть открытый CurationItem и текущий пользователь в `candidateCuratorIds` — баннер с кнопками. Интеграция в страницы — в sub-TZ Слоя 3 (α-6/α-7/γ-1).
3. **Conversational probe** — `ConversationalService.sendNotification({eventType: 'curation.pending', ...})`. Для deep — дополнительная `system.message` со severity='warning'.
4. **Dashboard-виджет** `CurationPendingWidget` — «N на проверке у меня» на `/dashboard`.

## Conflict как first-class

`ConflictItem` создаётся:
- автоматически из `block-linker.worker` (relationType='contradicts', confidence ≥ 0.85) → `detectedBy='block-linker'`, `resourceType='idea_block'`;
- специалистом Слоя 3 через `ConflictService.report({detectedBy: 'specialist', ...})`;
- вручную (UI / админская команда) — `detectedBy='manual'`.

`report()` идемпотентен: повторный вызов на ту же открытую пару (existingId, newId) возвращает существующий ConflictItem.

**Resolution-типы:**
- `accept_new` — старая версия архивируется в metadata (специалист сам трогает свою таблицу).
- `keep_old` — новая версия отклоняется.
- `merge` — объединение (правка контента происходит в UI карточки специалиста, в Layer 4 — только запись факта).
- `evolving` — обязательная категория. Старое было правдой до `existingValidUntil`, новое — с `newValidFrom`. `evolvingMeta` обязателен. UI с двумя date-pickers.

После резолюции — нотификация всем кандидатам связанных CurationItem'ов.

## Версионность (`CardVersion`)

Общая таблица для всех типов карточек (решение sub-TZ §13.1). Каждая правка → новая запись:
- `auto-canonical` → `version=1, changeReason='initial', createdByUserId=null` (если null — это auto).
- `decide(approve)` → `version=N+1, changeReason='approve' | 'approve_with_edits' | 'split' | 'merge' | 'supersede'`.
- `evolving conflict resolution` — теоретически порождает новую версию у обеих карточек; на α-4 — только запись ConflictItem.

`CardStaleDetectorCron` читает последнюю версию через `DISTINCT ON (resourceType, resourceId) ORDER BY createdAt DESC`. Если последняя версия старше N мес. (по умолчанию 6) — создаёт CurationItem(level='light', triageReason.reason='stale') и шлёт probe владельцу. Решение sub-TZ §13.2 — отдельный cron, не интегрирован в reframing.

## Curator routing (`CuratorRoutingService`)

Алгоритм выбора кандидатов:
1. Точное `(tenantId, resourceType, level)`.
2. `(tenantId, resourceType, level=null)` — универсальные ассайнменты.
3. Wildcard `(tenantId, '*')`.
4. Fallback — owner/admin Org через Membership.

`criteria` сужает (если ключи assignment.criteria ⊆ input.criteria по значениям, либо value='*' в assignment).

`CuratorAssignment` управляется через `/settings/curation` (API контракт для CRUD появится в sub-TZ Слоя 3 при первой реальной необходимости — пока на α-4 кураторы по умолчанию = owner/admin).

## RBAC

5 ResourceType: `curation_item`, `curation_decision`, `conflict_item`, `card_version`, `curator_assignment`. См. `backend/src/modules/rbac/policies/policy.csv` секция «SBA α-4».

- owner/admin — полный доступ.
- manager — read/write self для curation_item и curation_decision (когда он в candidateCuratorIds или assignedToUserId). Декларация через self в policy + проверка в `CurationService.decide` (членство в candidateCuratorIds).
- card_version — read для всех member'ов; write только через сервис.
- curator_assignment — owner/admin only.

## Метрики

- `curation_items_total{resource_type, level, status}` — counter.
- `curation_decision_total{decision_type, level}` — counter.
- `curation_time_to_decide_seconds{level}` — histogram (10мин..7дней).
- `curation_auto_canonical_total{resource_type}` — counter.
- `curation_conflicts_total{relation_type, resolution}` — counter (resolution='created' при report, иначе тип резолюции).
- `curation_stale_detected_total{resource_type}` — counter.

## Открытые вопросы / TODO

- **LLM-арбитр** `curation-conflict-suggest-resolution` — пропущен на α-4 (sub-TZ §11). TODO-комментарий оставлен в `ConflictService.resolve`. Цепочка из 3 provider'ов через seed-script появится в γ+.
- **Реальная пометка карточек как stale** — на α-4 cron только создаёт CurationItem. Действительная пометка `status='stale'` в моделях карточек специалистов — задача sub-TZ Слоя 3 (δ+), когда у них появится поле `lastConfirmedAt`.
- **Лимит на CardVersion.payload** (sub-TZ §13.4) — на α-4 без ограничений, мониторим размер таблицы; ограничение «храним последние N версий» — в δ+ если будет проблема.
- **Skill-карточки** (sub-TZ §3.6 «Skill — особый case») — без pre-approval, mark_as_misleading. Будет реализовано в γ-1 SkillProfile.

## Связанные документы

- [[../02_architecture/module-map|module-map.md]] §SBA α-4.
- [[../02_architecture/knowledge-core|knowledge-core.md]] — конфликт-сигнал из block-linker.
- [[conversational-channels|conversational-channels.md]] — probe-каналы (Слой 4 использует `eventType: 'curation.pending'` и `'system.message'`).
