# Knowledge Clone (Specialist 3.2) — что человек знает

> Sub-TZ: [`plans/tz/2026-05-21-sba-beta-2-specialist-3-2-knowledge-clone.md`](../../plans/tz/2026-05-21-sba-beta-2-specialist-3-2-knowledge-clone.md). Зонтичный: [`plans/tz/2026-05-21-second-brain-agents-umbrella.md`](../../plans/tz/2026-05-21-second-brain-agents-umbrella.md) §3.4.

## Зачем

Чтобы AI-чат компании мог ответить на «кто разбирается в X», нужна структура «у каждого сотрудника есть профиль знаний». **3.2 ≠ 3.7** — это разные специалисты:

| | 3.2 (Knowledge Clone, β-2) | 3.7 (SkillProfile, γ-1) |
|---|---|---|
| Что моделируем | **Что человек знает** — факты, опыт, экспертиза | **Как человек думает** — поведенческие паттерны, стиль |
| Базовая модель | `Person.knowledgeProfile Json?` | `Person.skillProfile Json?` (γ-1) |
| Источник | `signalType` ∈ `fact`, `expertise`, `experience`, `knowledge_gap` | `signalType='reasoning'` |
| Эталонный вопрос | «Кто у нас разбирается в X?» | «Что бы Y сказал в этой ситуации?» |

3.2 — фундамент 3.7: SkillProfile надстраивается над knowledgeProfile в γ-1.

## Структура `Person.knowledgeProfile`

```jsonc
{
  "version": 3,                      // = Person.profileBuildVersion
  "builtAt": "2026-05-25T10:00:00Z",
  "categories": [
    {
      "name": "AI-pipeline в knowledge-core", // эмерджентное имя (НЕ enum)
      "confidence": "high",                   // low|medium|high
      "observationCount": 12,
      "sampleStatements": [                   // 1-3 цитаты-примера
        { "quote": "...", "blockId": "..." }
      ],
      "relatedEntityIds": ["...", "..."],
      "lastObservedAt": "2026-05-20T15:30:00Z"
    }
  ],
  "experienceHighlights": [
    { "summary": "Запустил миграцию X в Q1 2026", "blockIds": ["..."] }
  ]
}
```

Подробное описание полей — sub-TZ §4.

## Pipeline

```
RouterService (signalType='fact' с employee subject ИЛИ 'knowledge_gap')
   ↓ enqueueSpecialistRouting jobName='3-2-knowledge-clone'
Specialist32KnowledgeCloneWorker (consumer core.specialist-routing)
   ↓ для каждого Person с relationship='employee':
   ↓ enqueueRebuildKnowledgeProfile (debounce 60s)
KnowledgeCloneRebuildWorker (consumer core.knowledge-clone-rebuild)
   ↓ Specialist32Service.rebuildForPerson:
   ↓   1. Загрузить блоки за `lookbackMonths` (default 12 мес)
   ↓   2. Если блоков < `minBlocksForProfile` (default 10) → skip
   ↓   3. LLM `knowledge-clone-extract` → draft
   ↓   4. Если есть старый профиль → LLM `knowledge-clone-merge`
   ↓   5. Conflict detection (старый «не знает X» vs новый «знает X»)
   ↓   6. CurationService.triage (auto-canonical при confidence ≥ 0.85,
   ↓      knowledge_profile НЕ в critical-types)
   ↓   7. Update Person.knowledgeProfile + lastProfileBuildAt + profileBuildVersion++
   ↓   8. Specialist32ProbeService.checkAndEmitProbes
```

Дополнительно: `KnowledgeCloneRebuildCron` (раз в 6 ч, `cfg.knowledgeClone.rebuildCron`) проходит всех employee-Person'ов со свежей активностью за неделю и enqueue rebuild для тех, чей `lastProfileBuildAt > 6 ч назад`.

## Probe-events

| Reason | Trigger | Recipient |
|---|---|---|
| `knowledge.new_expertise_detected` | новая категория в профиле с confidence='high' | admin/manager Org |
| `knowledge.contradiction_detected` | в одной категории появилось противоположное высказывание | admin/manager Org |

Отправляются через `ConversationalService.sendNotification(eventType: 'specialist.probe', payload: { specialistName: '3-2-knowledge-clone', reason, message, suggestedActions, personId, actionUrl })`. Сейчас direct manager не реализован (нет `Department.headPersonId`), поэтому шлём только admin'ам Org.

## Curation

`resourceType = 'knowledge_profile'` НЕ в `CURATION_CRITICAL_TYPES_DEFAULT` → auto-canonical при `confidence ≥ 0.85`. На `conflictSignal='hard'` (mark wrong) или низком confidence — `deep review`.

## Chat-v2 integration

`Specialist32CardHandler` регистрируется в `CardSpecialistRegistry` под именем `3-2-knowledge-clone`. При запросе chat-v2 он возвращает Person'ов, у которых `knowledgeProfile.categories[].name` содержит токены query. На β-2 — простой substring-match; embedding-based search — γ+.

## API

| Method | URL | Описание |
|---|---|---|
| GET | `/api/v1/me/knowledge-profile` | Свой профиль (с цитатами). |
| GET | `/api/v1/persons/:id/knowledge-profile` | Профиль другого Person. owner/admin/self видят цитаты; manager видит сводку. |
| POST | `/api/v1/me/knowledge-profile/mark-wrong` | Пометить категорию своего профиля как неверную → CurationItem level='deep'. |

RBAC ресурс — `knowledge_profile`. Owner/admin — r/w/d, manager open — read всех, manager strict — read self.

## UI

- `/me/knowledge-profile` — read-only список категорий, цитаты, кнопка «помечу неверным», disabled-кнопка «попробовать клона» (γ-1).
- `/persons/[id]/knowledge-profile` — то же, но для другого Person; член Org без цитат, owner/admin — с цитатами.

## ENV

```
KNOWLEDGE_CLONE_REBUILD_CRON="0 */6 * * *"
KNOWLEDGE_CLONE_LOOKBACK_MONTHS=12
KNOWLEDGE_CLONE_DEBOUNCE_MS=60000
KNOWLEDGE_CLONE_MIN_BLOCKS_FOR_PROFILE=10
```

## Метрики

- `core_specialist_cards_total{type='knowledge_profile', status}` — gauge.
- `core_specialist_pipeline_duration_seconds{type='knowledge_profile'}` — histogram.
- `core_specialist_llm_tokens_total{type='knowledge_profile', model, tier}`.
- `core_specialist_probe_events_total{type='knowledge_profile', reason}`.
- `core_specialist_conflict_events_total{type='knowledge_profile'}`.
- `core_specialist_extraction_failures_total{type='knowledge_profile', reason}`.
- `knowledge_clone_categories_per_profile` (histogram).
- `knowledge_clone_profile_size_kb` (histogram).

## LLM

Два taskType: `knowledge-clone-extract`, `knowledge-clone-merge`. Цепочка primary/secondary/tertiary: DeepSeek V4 flash → OpenAI gpt-5.4-mini → Ollama qwen3:30b. `maxDataClass >= internal`.

Seed-script: `bun run seed:llm-task-routes-knowledge-clone` (idempotent, `--update-existing` для force-обновления НЕ помеченных admin'ом записей).

## Что отложено

- Dashboard widget «Топ-5 людей с богатыми профилями» (β-2.13) — отложен.
- Direct-manager как первый получатель probe — отложен до появления `Department.headPersonId` (или аналогичного «head of department» поля).
- Embedding-based search в `Specialist32CardHandler` — γ+.
- Кнопка «попробовать своего клона» — disabled до γ-1.
