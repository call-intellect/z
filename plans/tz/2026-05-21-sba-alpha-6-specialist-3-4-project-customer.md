---
type: tz
status: draft
feature: SBA α-6 — Specialist 3.4 (Project/Customer Context) — эталонный референс контракта специалиста
date: 2026-05-21
parent_tz: tz/2026-05-21-second-brain-agents-umbrella.md
phase: alpha
depends_on:
  - tz/2026-05-21-sba-alpha-3-layer2-ontology-extension.md (Card.kind='vendor', Entity.type расширен)
  - tz/2026-05-21-sba-alpha-4-layer4-curation-foundation.md (CurationService.triage)
unblocks:
  - все остальные sub-TZ Слоя 3 (используют этот sub-TZ как референс-имплементацию контракта §5)
covers_matrix_rows: [A2, J1..J11 (как референс-имплементация), C1, K2, M1..M10 (как пример)]
---

# ТЗ α-6: Specialist 3.4 — Project/Customer Context (эталонный референс)

> **Это sub-TZ.** Зонтичный — [`plans/tz/2026-05-21-second-brain-agents-umbrella.md`](2026-05-21-second-brain-agents-umbrella.md). При расхождениях — приоритет у зонтичного.
>
> **Особый статус.** Этот sub-TZ — **эталонная имплементация контракта специалиста §5 зонтичного**. Все остальные специалисты Слоя 3 (α-7, β-2..β-5, γ-1) строятся по тому же паттерну. Если контракт §5 неясен — смотри как сделано здесь.
>
> **Контекст для исполнителя:**
> - Уже работающий [card-rollup-v2.worker](../../backend/src/modules/knowledge-core/workers/card-rollup-v2.worker.ts) — основа этого sub-TZ.
> - Существующие модели `Card`, `Theme` ([knowledge-core.md](../../second-brain/02_architecture/knowledge-core.md)).

---

## 1. Цель

После α-6 специалист 3.4 (Project/Customer Context) **полностью соответствует контракту специалиста §5 зонтичного**:
- Получает атомы через `RouterService` (а не самопальной cron-логикой как сейчас).
- Проходит через `CurationService.triage()` перед канонизацией.
- Эмиссит probe-events (через ConversationalService напрямую в α-6; через ProbeService после β-5).
- Эмиссит conflict-events через `ConflictService.report()`.
- Регистрируется в `CardSpecialistRegistry` для chat-v2.
- Метрики `core_specialist_*`.
- Использует трёхуровневую LLM-цепочку с tertiary=local через seed.

Это **рефакторинг + расширение** существующего card-rollup-v2 + добавление поддержки нового `Card.kind='vendor'`.

---

## 2. Зависимости

**Зависит от:** α-3 (Card.kind='vendor', Entity.type расширен), α-4 (CurationService), α-1 (ConversationalService для probe).

**Использует:** α-5 (регистрация в `CardSpecialistRegistry`).

**Разблокирует:** все остальные специалисты Слоя 3 как референс.

---

## 3. Scope

### Входит

- Рефакторинг `card-rollup-v2.worker.ts` под §5 контракт зонтичного.
- Подключение к `core.specialist-routing` очереди (вместо самопальной cron-логики или ручного enqueue).
- Подключение к `CurationService.triage()` для новых rollup'ов.
- Расширение `Card.kind='vendor'` (модель уже в α-3).
- Эмиссия probe-events (см. §5).
- Эмиссия conflict-events (см. §6).
- Регистрация в `CardSpecialistRegistry` (для chat-v2) — реализация `getCardsForQuery(query, blockIds)` + `getCitations(cardId)`.
- Обновление метрик: переход с самопальных на `core_specialist_*` (через `BusinessMetricsService`).
- Обновление seed `seed-llm-task-routes-knowledge-core.ts` для `card-rollup-v2` — три уровня provider'ов (сейчас могло быть 2).
- 5 промптов для разных `Card.kind` (client/deal/project/topic/vendor) — обновляются placeholder'ом с TODO согласовать.
- Smoke-тест на реальных данных.

### Не входит

- Создание новой таблицы Vendor — это в α-3.
- Card UI — уже работает, мелкие правки (отображение vendor) — да, full revamp — нет.
- Удаление старого `card-rollup.worker` — может остаться параллельно, deprecation отдельным sub-TZ.

---

## 4. Контракт специалиста — реализация

### 4.1. Чтение источника (§5.1 зонтичного)

```ts
// card-rollup-v2.worker.ts
@Processor(CORE_QUEUE_NAMES.SPECIALIST_ROUTING)  // вместо собственной очереди
export class CardRollupV2Worker {
  @Process('3-4-project-customer')  // jobName из RouterService
  async handle(job: Job<RoutedBlock>) {
    // 1. Получить block по id
    // 2. Найти все Card'ы, которые потенциально затронуты:
    //    - через Card.entityId === block.entityIds (Entity.type IN ['customer','vendor','project','product'])
    //    - через Card.relatedEntityIds
    //    - через RawEvent.sourceExternalId если block.evidence.meetingId связан с Card
    // 3. Для каждой такой карточки → enqueueCardRollupV2 с дебаунсом 60s
  }
}

// Сам rollup-job (если уже отдельный воркер — оставить, иначе общий)
@Process('rollup-card')
async rollupCard(job: Job<{ cardId: string }>) {
  // 1. Загрузить блоки карточки (по той же логике что в текущем worker)
  // 2. Top-3 темы через ThemeIdeaBlock
  // 3. LLM-вызов card-rollup-v2 с правильным kind-промптом
  // 4. Сформировать proposedPayload
  // 5. CurationService.triage(card=updated, ...) → решение
  // 6. Если auto-canonical → создать CardVersion + update Card.summaryCache
  //    Если pending → CurationItem (без обновления карточки до approve)
  // 7. Метрики
}
```

### 4.2. Карточка (§5.2)

`Card` — уже имеет `tenantId`, `entityId`, `updatedAt`. Добавить:
- `sourceBlockIds[]` — массив блоков-источников последнего rollup'а (для chat-v2 citations).
- `confidence Decimal(4,3)` — от LLM-вызова.
- `currentVersionId String?` → `CardVersion` (на α-4 модель появилась).
- `personSubjectIds[]` — для skill (§5.10).

### 4.3. Triage (§5.3)

`CurationService.triage(card)` — обязательный вызов до канонизации. Card является critical-type? Нет (Card — не Regulation/Decision). Значит, по умолчанию auto-canonical при confidence ≥ 0.85.

### 4.4. Probe-events (§5.4)

Через `ConversationalService.sendNotification` (пока ProbeService не появится в β-5):

Примеры probe для 3.4:
- «У карточки Customer X нет account_manager — кто-то из команды?»
- «У карточки Project Y нет дедлайна или milestone — добавить?»
- «Найдены 2 похожие карточки (Customer X, Customer Y) — merge?»

### 4.5. Conflict-events (§5.5)

Через `ConflictService.report()`:
- «Card.summaryCache говорит «проект закрыт», но свежие блоки говорят «активный»» → ConflictItem(resolution=`evolving` — был закрыт до X, переоткрыт с X).

### 4.6. Поддержка chat-v2 (§5.6)

Регистрация в `CardSpecialistRegistry`:
```ts
@OnModuleInit
register() {
  this.cardSpecialistRegistry.register({
    name: '3-4-project-customer',
    resourceType: 'card',
    getCardsForQuery: async (query, blockIds) => { /* embedding-search + overlap */ },
    getCitations: async (cardId) => { /* sourceBlockIds → IdeaBlockEvidence */ },
  });
}
```

### 4.7. Метрики (§5.7)

```
core_specialist_cards_total{type='card', status='canonical'} (gauge)
core_specialist_pipeline_duration_seconds{type='card'} (histogram)
core_specialist_llm_tokens_total{type='card', model, tier} (counter)
core_specialist_probe_events_total{type='card', reason} (counter)
core_specialist_conflict_events_total{type='card'} (counter)
```

### 4.8. RBAC (§5.8)

`card` ResourceType — уже работает.

### 4.9. Idempotency (§5.9)

JobId: `card-rollup-v2_<cardId>` — уже работает с дебаунсом 60s.

### 4.10. `personSubjectIds[]` (§5.10)

Из блоков-источников собрать Person, у которых `IdeaBlockEntity.role='subject'` → сохранить в `Card.personSubjectIds[]`. Для будущей сборки SkillProfile (γ-1).

### 4.11. LLM три уровня (§5.11)

`seed-llm-task-routes-knowledge-core.ts` — обновить routes для taskType `card-rollup-v2`:
- Primary: (placeholder, согласовать с playbook)
- Secondary: альтернативный provider
- Tertiary: Ollama qwen3:30b (local)
- Все три фильтруются по `maxDataClass >= 'restricted'` (Card может содержать чувствительные клиентские данные).

---

## 5. Probe-events — конкретный список

| Reason | Trigger | Payload | Recipient |
|---|---|---|---|
| `card.missing_owner` | Card.kind ∈ ['client','vendor','project'] AND Card.metadata.ownerUserId IS NULL | { cardId, kind, suggestedCandidates } | owner/admin |
| `card.missing_deadline` | Card.kind='project' AND Card.metadata.deadline IS NULL AND age > 7d | { cardId } | project owner если есть |
| `card.merge_suggestion` | EntityResolutionService нашёл 2 Card с похожими entityId | { cardIds, similarity } | owner/admin |
| `card.outdated_summary` | lastConfirmedAt > 6 мес AND есть свежие блоки | { cardId } | card owner |

---

## 6. Conflict-events — конкретный список

| Type | Trigger | Suggested resolution |
|---|---|---|
| `card.contradicting_status` | summaryCache говорит «закрыт», свежие блоки — «активный» | `evolving` |
| `card.contradicting_owner` | разные источники → разные owner'ы | manual |

---

## 7. Промпты `card-rollup-v2`

5 промптов по `Card.kind` — placeholder с TODO согласовать:

```ts
// backend/src/modules/knowledge-core/prompts/card-rollup-v2-{client,deal,project,topic,vendor}.prompt.ts
// TODO(owner-product): согласовать тексты промптов
```

`vendor` — новый, добавляется в α-6.

---

## 8. ENV

```
CARD_ROLLUP_V2_DEBOUNCE_MS=60000   # уже есть
# Новых нет (триажные пороги — в CurationService)
```

---

## 9. RBAC

`card` уже работает. `Card.personSubjectIds[]` — нет отдельных прав.

---

## 10. Метрики

См. §4.7.

Дополнительно:
- Старые `core_card_rollup_*` метрики → переименовать в `core_specialist_*{type='card'}` (мигрировать алертинг, если есть).

---

## 11. Фазы реализации

- [ ] **α-6.0** Ревью существующего `card-rollup-v2.worker.ts` — понять, что переиспользуется, что меняется.
- [ ] **α-6.1** Подключение к `core.specialist-routing` очереди (jobName '3-4-project-customer').
- [ ] **α-6.2** Расширение `Card` моделей полями: `sourceBlockIds[]`, `confidence`, `currentVersionId?`, `personSubjectIds[]` + `bun run prisma:push`.
- [ ] **α-6.3** Интеграция с `CurationService.triage()` перед канонизацией.
- [ ] **α-6.4** Интеграция с `ConflictService.report()` для card-level conflicts.
- [ ] **α-6.5** Probe-events: реализация 4 trigger'ов из §5.
- [ ] **α-6.6** Регистрация в `CardSpecialistRegistry` (для chat-v2).
- [ ] **α-6.7** Обновление промптов `card-rollup-v2-*.prompt.ts` (5 файлов, placeholder + TODO).
- [ ] **α-6.8** Добавление нового промпта `card-rollup-v2-vendor.prompt.ts`.
- [ ] **α-6.9** Обновление seed `seed-llm-task-routes-knowledge-core.ts` — три уровня provider'ов для `card-rollup-v2`.
- [ ] **α-6.10** Переименование метрик `core_card_rollup_*` → `core_specialist_*{type='card'}`.
- [ ] **α-6.11** UI: на странице `/cards/:id` интегрировать `<CurationBanner>` для pending state.
- [ ] **α-6.12** Smoke на реальной встрече: блок → роутер → 3.4 → rollup → CardVersion (если auto) или CurationItem (если pending).
- [ ] **α-6.13** Глоссарий + second-brain (обновить [knowledge-core.md](../../second-brain/02_architecture/knowledge-core.md) — описать что 3.4 теперь специалист по §5).

---

## 12. Открытые вопросы

1. **Старый `card-rollup.worker` (не v2)** — оставить параллельно или сразу удалить? Рекомендация — оставить ещё на цикл (deprecation отдельным sub-TZ).
2. **Personality migration:** существующие Card.summaryCache без CardVersion — backfill в `CardVersion(version=1)` или просто оставить как «v0»? Рекомендация — backfill.
3. **Card.kind='custom'** — поглощается в `vendor` или остаётся? Решение — оставить, не ломать существующие.

---

## 13. DoD

- `card-rollup-v2.worker` потребляет из `core.specialist-routing` очереди (jobName '3-4-project-customer').
- Card обновлён полями §4.2.
- `CurationService.triage()` вызывается, для confidence < 0.85 создаётся CurationItem.
- `ConflictService.report()` интегрирован, smoke-кейс «contradicting_status» работает.
- 4 probe-trigger'а из §5 эмитят notifications через ConversationalService.
- `CardSpecialistRegistry.register()` вызывается на init.
- chat-v2 (α-5) находит Card в выдаче при релевантном вопросе (smoke).
- Метрики `core_specialist_*{type='card'}` экспортируются.
- Seed `seed-llm-task-routes-knowledge-core.ts` обновлён с 3 provider'ами + ссылка на playbook.
- Промпты-placeholders обновлены с TODO.
- Smoke на реальной встрече зелёный.
- Глоссарий + second-brain.

---

## 14. Итог

**Реализовано целиком:** нет (draft).

**Что осталось:** вся реализация.

**Что меняет в продукте:** существующий механизм card-rollup приведён к единому контракту, становится reference-имплементацией для остальных 6 специалистов Слоя 3.
