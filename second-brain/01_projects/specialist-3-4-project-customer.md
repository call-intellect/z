---
title: Specialist 3.4 — Project / Customer Context (эталонный референс)
phase: SBA α-6
status: реализован 2026-05-22
parent: ../02_architecture/module-map.md#sba-α-6
tz: ../../plans/archive/2026-05-21-sba-alpha-6-specialist-3-4-project-customer.md
umbrella: ../../plans/archive/2026-05-21-second-brain-agents-umbrella.md
---

# Specialist 3.4 — Project / Customer Context

> Первая полная реализация единого §5-контракта специалиста Слоя 3 из зонтичного SBA. Все остальные специалисты Слоя 3 (3.1 регламенты, 3.2 knowledge-clone, 3.3 решения, 3.5 инсайты, 3.6 идеи, 3.7 skill) строятся по тому же паттерну. Это рефакторинг существующего `card-rollup-v2.worker` + расширение под `Card.kind='vendor'`.

## 1. Что делает

Превращает блоки знания (`IdeaBlock` с `signalType='fact'` и упомянутыми Customer / Vendor / Project / Product / Client сущностями) в актуальные карточки `Card`:
- Подхватывает блок из очереди `core.specialist-routing` (jobName `'3-4-project-customer'`, диспатчит RouterService после `block-distill.worker`).
- Находит затронутые карточки (по `Card.entityId` или `Card.relatedEntityIds`).
- Запускает rollup (`CardRollupV2Service.buildRollup`) для каждой — собирает блоки карточки → top-3 темы → LLM-summary с kind-промптом.
- Проходит triage `CurationService.triage()` перед канонизацией.
- Эмитит 4 типа probe-events для пробелов в карточке (см. §3).
- Эмитит conflict-events при противоречии статуса (см. §4).
- Регистрируется в `CardSpecialistRegistry` для chat-v2 — отдаёт релевантные карточки.

## 2. Контракт §5 — как реализован

| Пункт §5 зонтичного | Реализация |
|---|---|
| **5.1 Чтение источника** | Consumer `core.specialist-routing`, jobName `'3-4-project-customer'`. Никогда не читает RawEvent напрямую — только через IdeaBlock. |
| **5.2 Карточка специалиста** | `model Card` расширен: `sourceBlockIds[]`, `confidence Decimal(4,3)`, `currentVersionId → CardVersion`, `personSubjectIds[]`, `lastConfirmedAt`. Status хранится неявно: `summaryCache=null` → draft, `summaryCache!=null AND triage='auto'` → canonical, есть открытый CurationItem → pending, `archivedAt!=null` → archived. |
| **5.3 Triage** | `CurationService.triage({resourceType:'card', resourceId, proposedPayload, confidence})`. На `auto` создаёт `CardVersion(changeReason='auto-rollup')` и Card обновляется; на `light`/`deep` — создаётся `CurationItem`, Card не трогается до approve. |
| **5.4 Probe-events** | `Specialist34ProbeService.checkAndEmitProbes(card)` — 4 trigger'а (см. §3) через `ConversationalService.sendNotification` с `eventType='specialist.probe'`. |
| **5.5 Conflict-events** | Эвристика status contradiction («закрыт» ↔ «активен») → `ConflictService.report({relationType:'contradicts', detectedBy:'specialist'})`. |
| **5.6 Chat-v2 поддержка** | `Specialist34CardHandler.getCardsForQuery({tenantId, query, candidateBlockIds, limit})` — overlap по `sourceBlockIds` + boost по `entityId`/`relatedEntityIds`. Регистрируется в `CardSpecialistRegistry` в `onModuleInit`. |
| **5.7 Метрики** | `core_specialist_cards_total{type='card', status}`, `core_specialist_pipeline_duration_seconds{type='card'}`, `core_specialist_llm_tokens_total{type='card', model, tier}`, `core_specialist_probe_events_total{type='card', reason}`, `core_specialist_conflict_events_total{type='card'}`. |
| **5.8 RBAC** | `card` ResourceType уже работает (не меняли). |
| **5.9 Idempotency** | RouterService: jobId=`'3-4-project-customer_<blockId>'`. CoreQueueService.enqueueCardRollupV2: jobId=`'card_rollup_v2_<cardId>'` + 60s debounce. |
| **5.10 personSubjectIds** | `CardRollupV2Service.collectPersonSubjects()` собирает Person'ов, у которых `IdeaBlockEntity.role='subject'` в блоках-источниках. Пишется в Card.personSubjectIds[] при auto-canonical. |
| **5.11 LLM три уровня** | `card-rollup-v2`: primary deepseek-v4-flash, secondary openai-via-proxy/gpt-5.4-mini, tertiary ollama qwen3:30b. Seed: `seed-llm-task-routes-knowledge-core.ts`. |

## 3. Probe-events — детально

`Specialist34ProbeService` вызывается из `CardRollupV2Service` после успешного auto-rollup'а (best-effort, ошибки не валят rollup).

| Reason | Trigger | Получатель | Suggested actions |
|---|---|---|---|
| `card.missing_owner` | `card.kind ∈ {client, vendor, project}` И Membership owner-creator не активен в Org | Admin'ы Org (owner + admin role) | «Назначить ответственного», «Архивировать карточку» |
| `card.missing_deadline` | `card.kind='project'` И в `summaryCache` нет regex /дедлайн\|deadline\|milestone\|вех[ау]\|срок до/ И age > 7d | `card.ownerId` | «Указать дедлайн», «Добавить milestone» |
| `card.merge_suggestion` | Найдены ≥1 другая Card с тем же `entityId` в той же Org | Admin'ы Org | «Слить карточки», «Оставить отдельно» |
| `card.outdated_summary` | `lastConfirmedAt` старше 183 дней И за последние 7 дней появились canonical IdeaBlock'и с entityId/relatedEntityIds карточки | `card.ownerId` | «Запустить rollup», «Подтвердить вручную» |

Payload: `{specialistName: '3-4-project-customer', reason, message (русский), cardId, suggestedActions[], actionUrl: '/cards/<id>'}`.

Channel policy: `['in_app', 'email_smtp']`.

## 4. Conflict-events — эвристика

После rollup'а, если был `card.summaryCache` (старый текст) — сравнение с новым по regex:
- closedRe: `/закрыт|завершён|остановлен|приостановлен|отменён/i`
- activeRe: `/активен|идёт|развивается|продолжается|открыт/i`

Контрадикция = `(oldClosed && newActive) || (oldActive && newClosed)`.

При срабатывании:
```ts
conflictService.report({
  tenantId, resourceType: 'card',
  existingId: card.id, newId: `${card.id}:next`,
  relationType: 'contradicts', detectedBy: 'specialist',
  evidence: { specialistName, heuristic: 'status-keyword-flip',
              oldSummary, newSummary, sourceBlockIds }
});
```

Простая эвристика, в β- появится LLM-арбитр (см. зонтичный §10 и `ConflictService` TODO).

## 5. Pipeline

```
block-distill.worker → RouterService.dispatch (signal=fact + Customer/Vendor/Project)
  ↓ core.specialist-routing (jobName='3-4-project-customer')
Specialist34ProjectCustomerWorker
  ↓ найти затронутые Card → enqueueCardRollupV2(cardId, 60s debounce)
  ↓ core.card-rollup-v2
CardRollupV2Worker → CardRollupV2Service.buildRollup
  ↓ загрузить блоки + темы + цитаты + personSubjectIds
  ↓ LLM-вызов (kind-промпт из card-rollup-v2.prompts.ts)
  ↓ CurationService.triage(card, proposedPayload, confidence)
    ↓ auto → CardVersion + Card update + Specialist34ProbeService.checkAndEmitProbes
    ↓ light/deep → CurationItem (Card не обновляется до approve)
  ↓ detectStatusContradiction → ConflictService.report (если сработало)
```

## 6. Что НЕ делает специалист 3.4

- Не создаёт Card (это делает пользователь через UI или прежний код cards.service).
- Не удаляет Card (это manual + retention).
- Не пишет в Card.summaryCache напрямую из воркера specialist-routing — это работа CardRollupV2Service после triage.
- Не вызывает LLM в specialist-routing-воркере — только в card-rollup-v2-воркере (он один цикл LLM на один rollup).

## 7. Карта файлов

- `backend/prisma/schema.prisma` — `model Card` (поля §5.2), `model CardVersion.cardsAsCurrent`.
- `backend/src/modules/knowledge-core/workers/specialist-3-4-project-customer.worker.ts` — consumer specialist-routing.
- `backend/src/modules/knowledge-core/workers/card-rollup-v2.worker.ts` — consumer card-rollup-v2 (рефакторинг под §5).
- `backend/src/modules/knowledge-core/services/card-rollup-v2.service.ts` — главный сервис rollup'а + triage + conflict-detection.
- `backend/src/modules/knowledge-core/services/specialist-3-4-probe.service.ts` — 4 probe-trigger'а.
- `backend/src/modules/knowledge-core/services/specialist-3-4-card-handler.service.ts` — handler для CardSpecialistRegistry.
- `backend/src/modules/knowledge-core/prompts/card-rollup-v2.prompts.ts` — 6 system-промптов (client/deal/project/topic/vendor/custom).
- `backend/src/modules/knowledge-core/knowledge-core.module.ts` — провайдеры + импорт CurationModule.
- `backend/src/modules/knowledge-core/specialist-3-4.module.ts` — модуль регистрации в CardSpecialistRegistry (импортирует ChatV2Module).
- `backend/src/modules/ai/workers.module.ts` — регистрация `Specialist34ProjectCustomerWorker`.
- `backend/src/modules/conversational/types/event-payload.registry.ts` — `specialist.probe` payload schema.
- `backend/src/modules/conversational/conversational.service.ts` — `EVENT_TYPE_CHANNEL_POLICY['specialist.probe']`.
- `backend/src/common/metrics/business-metrics.service.ts` — 5 метрик `core_specialist_*`.
- `backend/scripts/seed-llm-task-routes-knowledge-core.ts` — card-rollup-v2 с 3 уровнями.
- `backend/scripts/patch-backfill-card-versions.ts` — backfill `CardVersion(v1)` для старых Card.
- `backend/src/app.module.ts` — подключение `Specialist34Module`.
- `frontend/app/(authenticated)/cards/[id]/CardDetailClient.tsx` — `<CurationBanner resourceType="card" />`.

## 8. ENV (без изменений)

`CARD_ROLLUP_V2_DEBOUNCE_MS=60000` — уже было; новых ENV не добавили (триажные пороги — в `CurationService` settings per Org).

## 9. DoD — статус

- [x] Card расширен полями §5.2 (sourceBlockIds, confidence, currentVersionId, personSubjectIds, lastConfirmedAt).
- [x] `Specialist34ProjectCustomerWorker` потребляет из `core.specialist-routing` (jobName `'3-4-project-customer'`).
- [x] `CardRollupV2Service.buildRollup` вызывает `CurationService.triage()` перед канонизацией.
- [x] `ConflictService.report()` интегрирован — эвристика status contradiction.
- [x] 4 probe-trigger'а эмитятся через `ConversationalService.sendNotification` (`eventType='specialist.probe'`).
- [x] `CardSpecialistRegistry.register('3-4-project-customer', ...)` вызывается на init.
- [x] Метрики `core_specialist_*{type='card'}` экспортируются.
- [x] Seed `card-rollup-v2` — 3 provider'а (deepseek/openai-via-proxy/ollama).
- [x] Промпт `card-rollup-v2-vendor` добавлен (placeholder с TODO).
- [x] Patch-script `patch-backfill-card-versions.ts` создан.
- [x] `<CurationBanner>` на странице карточки.
- [x] Glossary + second-brain обновлены.
- [x] Старый `card-rollup.worker` помечен `@deprecated` (JSDoc).
- [ ] Smoke-тест на реальной встрече — отложен на ручную проверку (требует поднятой БД и Redis).

## 10. Что отложено (не входит в α-6)

- LLM confidence от промпта (требует переход к JSON Schema output) — пока хардкод `CARD_ROLLUP_V2_DEFAULT_CONFIDENCE=0.9`.
- LLM-арбитр конфликтов (по §11 sub-TZ зонтичного — задача β-).
- Embedding-search в `Specialist34CardHandler` (β-2).
- `Card.metadata.ownerUserId` для назначенного ответственного (β-/γ-).
- Удаление legacy `ai/workers/card-rollup.worker.ts` — отдельный sub-TZ.
- Полноценная migration `core_card_rollup_*` старых метрик → `core_specialist_*` (пока сосуществуют).
