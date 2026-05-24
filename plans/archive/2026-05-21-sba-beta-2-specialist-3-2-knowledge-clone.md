---
type: tz
status: draft
feature: SBA β-2 — Specialist 3.2 Knowledge Clone (что человек знает — facts, expertise, experience)
date: 2026-05-21
parent_tz: tz/2026-05-21-second-brain-agents-umbrella.md
phase: beta
depends_on:
  - tz/2026-05-21-sba-alpha-2-layer1-marking-extension.md (signalType)
  - tz/2026-05-21-sba-alpha-3-layer2-ontology-extension.md (Person.entityId, Person.relationship)
  - tz/2026-05-21-sba-alpha-4-layer4-curation-foundation.md (triage)
  - tz/2026-05-21-sba-alpha-6-specialist-3-4-project-customer.md (как референс контракта)
unblocks:
  - tz/2026-05-21-sba-gamma-1-specialist-3-7-skill-and-clone.md (Skill надстраивается поверх knowledgeProfile)
covers_matrix_rows: [C2, J1..J11]
---

# ТЗ β-2: Specialist 3.2 — Knowledge Clone

> **Это sub-TZ.** Зонтичный — [`plans/tz/2026-05-21-second-brain-agents-umbrella.md`](2026-05-21-second-brain-agents-umbrella.md). При расхождениях — приоритет у зонтичного.
>
> **Контракт специалиста §5 контракт — реализация по образцу α-6.**
>
> **Важно: 3.2 ≠ 3.7.** 3.2 — это «что человек знает» (факты, опыт, экспертиза). 3.7 — «как человек думает» (поведенческие паттерны). 3.2 — фундамент для 3.7.

---

## 1. Цель

После β-2:
- `Person.knowledgeProfile Json?` — структурированный кеш «что знает / опыт / типовые ответы по областям».
- Воркер `knowledge-clone.worker` строит и обновляет профиль из блоков `signalType='expertise'/'fact'/'experience'`.
- Cron `knowledge-clone-rebuild.cron` — раз в N часов перестраивает профиль при достижении threshold изменений.
- UI «мой клон» на `/me` (preview-режим, без редактирования смысловой части).
- Расширение `/persons/:id` разделом «Профиль знаний» (read для member'ов Org).
- 3.2 — фундамент для 3.7 (γ-1).

---

## 2. Зависимости

**Зависит от:** α-2 (signalType), α-3 (Person.entityId), α-4 (CurationService), α-6 (референс).

**Разблокирует:** γ-1 (SkillProfile надстраивается над knowledgeProfile).

---

## 3. Scope

### Входит

- Расширение `Person` модели полями: `knowledgeProfile Json?`, `lastProfileBuildAt`, `profileBuildVersion`.
- Воркер `knowledge-clone.worker` — consumer `core.specialist-routing` для jobName '3-2-knowledge-clone'.
- Cron `knowledge-clone-rebuild.cron` — раз в 6 часов (ENV-конфигурируемо).
- LLM-extraction промпт `knowledge-clone-extract` (placeholder).
- LLM-merge промпт `knowledge-clone-merge` (placeholder).
- 2 новых `LlmTaskType` с 3 provider'ами.
- Probe-events: «обнаружен новый опыт Person X в области Y — подтвердить?».
- Conflict-events: «факт «X знает Y» противоречит фактам «X не знает Y» из другого источника».
- API: `GET /api/v1/persons/:id/knowledge-profile`, `GET /api/v1/me/knowledge-profile`.
- UI: расширение `/persons/:id` + виджет «мой клон» на `/me`.
- Регистрация в `CardSpecialistRegistry`.
- Метрики `core_specialist_*{type='knowledge_profile'}`.

### Не входит

- Skill/Persona (γ-1).
- Внешние участники (только `Person.relationship='employee'`).
- Редактирование Profile владельцем (read-only в UI; владельцу можно «помечать неверным» — отдельная очередь для curation review).

---

## 4. Структура `knowledgeProfile`

```jsonc
{
  "version": 3,                          // profileBuildVersion
  "builtAt": "2026-05-25T10:00:00Z",
  "categories": [                        // эмерджентные категории
    {
      "name": "AI-pipeline в knowledge-core",   // что человек знает
      "confidence": "high",                     // low|medium|high
      "observationCount": 12,
      "sampleStatements": [                     // 1-3 цитаты-примера
        { "quote": "...", "blockId": "...", "sourceUrl": "..." }
      ],
      "relatedEntityIds": ["...", "..."],       // на чём проявляется (Project, Tech, Customer)
      "lastObservedAt": "2026-05-20T15:30:00Z"
    },
    {
      "name": "Onboarding процесс для новых сотрудников",
      "confidence": "medium",
      "observationCount": 5,
      "sampleStatements": [...],
      "relatedEntityIds": [...],
      "lastObservedAt": "..."
    }
  ],
  "experienceHighlights": [             // отдельные значимые опыты
    { "summary": "Запустил миграцию X в Q1 2026", "blockIds": [...] }
  ]
}
```

**Категории — эмерджентные**, LLM сам формирует. Не enum.

---

## 5. Воркер `knowledge-clone.worker`

```ts
@Processor(CORE_QUEUE_NAMES.SPECIALIST_ROUTING)
export class KnowledgeCloneWorker {
  @Process('3-2-knowledge-clone')
  async handle(job: Job<RoutedBlock>) {
    // 1. Получить block
    // 2. Найти Person через IdeaBlockEntity.role IN ('subject', 'mentioned') + Entity.type='person'
    //    (для каждого упомянутого Person, который relationship='employee')
    // 3. Для каждого такого Person — enqueue rebuild с дебаунсом 60s
  }

  @Process('rebuild-knowledge-profile')
  async rebuildKnowledgeProfile(job: Job<{ personId: string }>) {
    // 1. Загрузить все блоки этого Person за последние N мес (configurable)
    // 2. LLM-вызов knowledge-clone-extract: блоки → черновик профиля
    // 3. Если уже есть profile — LLM knowledge-clone-merge: старый + новый → объединённый
    // 4. Triage через CurationService (knowledgeProfile — НЕ critical-type, auto-canonical при high confidence)
    // 5. Update Person.knowledgeProfile + lastProfileBuildAt + profileBuildVersion++
    // 6. Метрики
  }
}
```

Cron `knowledge-clone-rebuild.cron` — раз в 6 часов для всех employee-Person'ов с непустыми `lastProfileBuildAt < N часов назад` И новыми блоками.

---

## 6. Probe-events

| Reason | Trigger | Recipient |
|---|---|---|
| `knowledge.new_expertise_detected` | новая категория в профиле, confidence='high' | direct manager (для review) |
| `knowledge.contradiction_detected` | свежий блок противоречит существующему факту | direct manager |
| `knowledge.profile_stale` | lastProfileBuildAt > 3 мес AND нет свежих блоков | (нет — не нужно) |

---

## 7. ENV

```
KNOWLEDGE_CLONE_REBUILD_CRON="0 */6 * * *"
KNOWLEDGE_CLONE_LOOKBACK_MONTHS=12
KNOWLEDGE_CLONE_DEBOUNCE_MS=60000
KNOWLEDGE_CLONE_MIN_BLOCKS_FOR_PROFILE=10
```

---

## 8. RBAC

- `knowledge_profile` ResourceType:
  - read: все member'ы Org (это shared knowledge — внутри Org нет смысла скрывать «кто что знает», в отличие от Skill).
  - write/delete: только через worker (нет ручного API write).
  - Носитель — read свой через `/me/knowledge-profile`.
- Дополнительно: на странице `/persons/:id/knowledge-profile` Owner/admin видит исходные блоки-цитаты (provenance), member видит только сводку без цитат.

---

## 9. Метрики

```
core_specialist_cards_total{type='knowledge_profile', status} (gauge)
core_specialist_pipeline_duration_seconds{type='knowledge_profile'} (histogram)
core_specialist_llm_tokens_total{type='knowledge_profile', model, tier} (counter)
core_specialist_probe_events_total{type='knowledge_profile', reason} (counter)
core_specialist_conflict_events_total{type='knowledge_profile'} (counter)
knowledge_clone_categories_per_profile (histogram)
knowledge_clone_profile_size_kb (histogram)
```

---

## 10. LLM (3 уровня обязательны)

**2 новых `LlmTaskType`:**

1. `knowledge-clone-extract` — из блоков → черновик профиля. JSON Schema strict.
2. `knowledge-clone-merge` — старый + новый профиль → объединённый, с decay старых категорий без подтверждений.

Цепочки — primary/secondary/tertiary, placeholder, согласовать с playbook. `maxDataClass >= 'restricted'` (профили могут содержать чувствительную инфу о компетенциях).

Seed-script `seed-llm-task-routes-knowledge-clone.ts` с playbook-комментарием.

---

## 11. UI

### 11.1. `/me/knowledge-profile`

Простая страница (read-only):
- Заголовок «Что Кора знает обо мне»
- Список категорий с уровнем уверенности и количеством наблюдений
- На каждой категории — кнопка «помечу как неверное» → создаёт `CurationItem` с уровнем `deep` для admin/manager review (не удаляет — для тренировки промпта).
- Кнопка «попробовать своего клона» — задел для γ-1 (в β-2 — disabled с tooltip «доступно в γ»).

### 11.2. Расширение `/persons/:id`

Новая вкладка «Профиль знаний»:
- Те же категории, но без кнопки «помечу неверным» (для других пользователей).
- Для owner/admin/direct manager — клик на категорию → раскрывается список цитат.

### 11.3. Виджет на `/dashboard`

Для owner/admin — «Топ-5 людей с самыми богатыми профилями знаний» (proxy на «кто больше всех говорит и приносит ценность»).

---

## 12. Фазы реализации

- [ ] **β-2.0** Решить порог `MIN_BLOCKS_FOR_PROFILE` (10 — стартово).
- [ ] **β-2.1** Расширение `Person` полями `knowledgeProfile Json?`, `lastProfileBuildAt`, `profileBuildVersion` + `bun run prisma:push`.
- [ ] **β-2.2** Воркер `knowledge-clone.worker` + подключение к `core.specialist-routing` + второй процесс для rebuild.
- [ ] **β-2.3** Cron `knowledge-clone-rebuild.cron`.
- [ ] **β-2.4** Промпты `knowledge-clone-extract.prompt.ts`, `knowledge-clone-merge.prompt.ts` (placeholder + TODO).
- [ ] **β-2.5** Seed-script `seed-llm-task-routes-knowledge-clone.ts` с 3 provider'ами + playbook-ссылка.
- [ ] **β-2.6** Интеграция с `CurationService.triage()` (НЕ critical-type, auto-canonical при high).
- [ ] **β-2.7** Probe-events (2 trigger'а из §6).
- [ ] **β-2.8** Conflict-events интеграция.
- [ ] **β-2.9** Регистрация в `CardSpecialistRegistry` (для chat-v2).
- [ ] **β-2.10** API `GET /me/knowledge-profile`, `GET /persons/:id/knowledge-profile`.
- [ ] **β-2.11** UI `/me/knowledge-profile` (preview, кнопка «помечу неверным» → CurationItem).
- [ ] **β-2.12** UI расширение `/persons/:id` вкладкой.
- [ ] **β-2.13** (опц.) Dashboard-виджет.
- [ ] **β-2.14** RBAC: `knowledge_profile`.
- [ ] **β-2.15** Метрики `core_specialist_*{type='knowledge_profile'}` + два специфичных.
- [ ] **β-2.16** Глоссарий + second-brain (новый файл `01_projects/knowledge-clone.md`).

---

## 13. Открытые вопросы

1. **knowledgeProfile в Json vs отдельная таблица KnowledgeCategory?** Рекомендация — Json пока (один профиль читается целиком). Если в γ потребуется query «найди людей со знанием X» — мигрируем в отдельную таблицу.
2. **Кнопка «попробовать своего клона» в β-2 vs γ-1?** Рекомендация — в β-2 disabled (preview), в γ-1 активна.
3. **Применять профиль в chat-v2 ответах?** В β-2 — да, факты из профиля попадают в retrieval (если spam — пересмотрим). В γ-1 — clone-style mode уже полностью использует.

---

## 14. DoD

- `Person.knowledgeProfile` + `lastProfileBuildAt` + `profileBuildVersion` в схеме.
- `knowledge-clone.worker` обрабатывает блоки.
- `knowledge-clone-rebuild.cron` работает.
- Промпты placeholder + seed-script с 3 provider'ами + playbook.
- 2 probe trigger'а работают.
- CurationService интегрирован.
- API + UI работают.
- chat-v2 находит facts из профиля в выдаче.
- `CardSpecialistRegistry.register()` вызывается.
- Метрики, RBAC, glossary, second-brain.

---

## 15. Итог

**Реализовано целиком:** нет (draft).

**Что осталось:** вся реализация.

**Что меняет в продукте:** AI-чат начинает корректно отвечать «кто знает Y», у каждого сотрудника есть профиль знаний, фундамент для skill-профиля (γ).
