# Knowledge Clone (Specialist 3.2) — что человек знает

> Sub-TZ: [`plans/archive/2026-05-21-sba-beta-2-specialist-3-2-knowledge-clone.md`](../../plans/archive/2026-05-21-sba-beta-2-specialist-3-2-knowledge-clone.md). Зонтичный: [`plans/archive/2026-05-21-second-brain-agents-umbrella.md`](../../plans/archive/2026-05-21-second-brain-agents-umbrella.md) §3.4.

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

> **Пакет E (F-7 покрытие клонов, 2026-07-02, коммит `bd951e1b`):** гейт сохранения профиля ослаблен — профиль материализуется при `auto`-триггере ИЛИ (`non-deep` && `profileConfidence >= knowledgeClone.profileMinConfidence`, крутилка = 0.55). Раньше «слабые» профили молча не сохранялись и покрытие клонов проседало. `loadBlocksForPerson` `orderBy` предпочитает высокосигнальные блоки; `computeProfileConfidence` += obs-boost.

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

Два taskType: `knowledge-clone-extract`, `knowledge-clone-merge`.
- `knowledge-clone-extract`: DeepSeek V4 flash → OpenAI gpt-5.4-mini → kie:gemini-3.1-pro.
- `knowledge-clone-merge`: DeepSeek V4 **pro** → OpenAI gpt-5.4-mini → kie:gemini-3.1-pro (merge переведён на pro патчем `patch-mass-migrate-to-deepseek-pro`).

Нижний уровень нормализован на kie:gemini-3.1-pro (ollama выведён из всех боевых цепочек 2026-06-05). `maxDataClass >= internal`. Единый источник правды по провайдерам/цепочкам — [[llm-providers-verified]] (свериться перед фиксацией любой цепочки в этой заметке).

Seed-script: `bun run seed:llm-task-routes-knowledge-clone` (idempotent, `--update-existing` для force-обновления НЕ помеченных admin'ом записей).

## Атрибуция по говорящему — chatbox (Ф1/B1–B2, 2026-06-08)

**Источник:** ТЗ [`plans/tz/2026-06-08-clone-quality-improvements.md`](../../plans/tz/2026-06-08-clone-quality-improvements.md) Ф1 (A). Ветка `feature/2026-06-08-tz-batch-tables-clones-shipon`. Профильная заметка по chatbox — [[chatbox-integration]]; механизм subject-атрибуции встреч — [[../02_architecture/knowledge-core]] §«Детерминированная subject-атрибуция».

**Проблема (до фикса):** при ingest'е сессии клиентского чата (chatbox) все блоки сессии атрибутировались **session-level ответственному менеджеру** — клиентские реплики ошибочно записывались как высказывания/обязательства/знания менеджера (cross-attribution клиент → менеджер), искажая и knowledge-, и skill-профиль.

**Решение — атрибуция по автору сегмента:**
- `Segment` / `MeetingTurn` получили поле **`authorPersonId`** (`segment-builder.service.ts`). Для chatbox `chatbox-ingest.service.ts` шлёт `transcript.turns` посегментно (**1 turn = 1 сообщение**, синтетические таймкоды): `authorPersonId = null` для реплики клиента, `responsible.personId` — для реплики менеджера.
- `block-ingest.worker`: `tryGetActorIdentity` **не отдаёт session-level менеджера** при per-message сегментации; `attributeSubject` / `attributeCommitmentAuthor` резолвят subject по говорящему конкретного сегмента → клиентская реплика **subject НЕ пишется** (fail-closed для клиента).
- **Встречи и одно-авторные источники не изменены** — там автор и так известен по `speakerParticipantId`.
- **Важная разница носителя identity:** у chatbox **нет записей `Participant`**, поэтому identity несётся как **`Person.id` прямо в сегменте** (поле `authorPersonId`), а НЕ как `speakerParticipantId` (как у встреч). Ловушка — см. [[../02_architecture/code-pitfalls]] §«chatbox: атрибуция всех блоков сессии».

**Backfill истории:** `backend/scripts/backfill-chatbox-subject-cleanup.ts` (коммит `bb7701dc`) — разовая очистка ранее накопленной неверной атрибуции chatbox-блоков.

## Что отложено

- Dashboard widget «Топ-5 людей с богатыми профилями» (β-2.13) — отложен.
- Direct-manager как первый получатель probe — отложен до появления `Department.headPersonId` (или аналогичного «head of department» поля).
- Embedding-based search в `Specialist32CardHandler` — γ+.
- Кнопка «попробовать своего клона» — disabled до γ-1.
