# Gap-анализ: knowledge-core (Z) ↔ онтология компании

> Зафиксировано 2026-05-20. Сопоставление реализованного в коде Z knowledge-core (Фазы 0-4) с базовой онтологией из [[../../second-brain/06_marketing/company-ontology]] (13 классов сущностей + ~40 типов рёбер). Цель — увидеть, где архитектура продукта расходится с заявленной онтологией, и какой минимальный набор изменений нужен, чтобы устранить главные пробелы.

## Источники

- [[../../second-brain/02_architecture/knowledge-core]] — фактическое описание реализации
- [[../../second-brain/02_architecture/data-model]] — модели Prisma
- [[../../second-brain/06_marketing/company-ontology]] — целевая онтология
- `backend/src/modules/knowledge-core/` (48 TS-файлов), Prisma schema
- [[../../delivery/README]] — полный ТЗ-пакет (40 модулей, 7 слоёв)

## 1. Архитектура сбора информации — что есть

**Pipeline (Фазы 0–4, всё в проде):**

```
RawEvent (Источник: meeting/telegram/email/mango/web-form)
   ↓  core.raw-events
block-ingest.worker      → сегментация ≤2000 токенов → LLM → IdeaBlock(draft) + Evidence + Entity + embedding 1536
   ↓  core.block-distill (дебаунс 30s)
block-distill.worker     → KNN cosine > 0.92 → LLM-арбитр merge|distinct → canonical
   ↓  core.block-linker
block-linker.worker      → KNN top-10 → LLM → IdeaBlockLink (7 типов), gate LINKER_MIN_BLOCKS=50
   ↓
entity-resolver.cron     каждые 5 мин → дедупликация Entity (KNN + LLM-арбитр)
entity-graph-builder.cron почасово → co-mention ≥3 + LLM → EntityLink (6 типов)
theme-clusterer.cron     каждый час :15 → KNN-greedy (0.78, minSize 3) + LLM theme-classify → Theme
reframing.cron           ежедневно 3:00 → архив слабых связей, decay dynamicScore (90 дней), reflectOnThemes
card-rollup-v2.worker    дебаунс 60s → Card.summaryCache по kind (client/deal/project/topic/custom)
```

**Prisma-модели (11 шт., все реализованы):** Source, RawEvent, IdeaBlock (14 signalType + 4 статуса), IdeaBlockEvidence, Entity (7 типов), IdeaBlockEntity, IdeaBlockLink (7 типов), EntityLink (6 типов), Theme, ThemeIdeaBlock, ThemeEntity.

**API (11 endpoints):** `/api/v1/knowledge/search` (гибрид pgvector 0.7 + BM25 0.3), `/blocks/:id[/links]`, `/entities[/:id/links]`, `/graph/neighbors` (BFS depth 1-3, max 100), `/themes[/:id/save-as-card]`, `/cards/:id/themes`.

## 2. AI-агенты / воркеры — что есть

**8 BullMQ воркеров + 6 cron-job'ов.** Все идемпотентные (jobId по сущности), с дебаунсами.

| Воркер / cron | Что делает | Статус |
|---|---|---|
| `block-ingest` | Извлечение IdeaBlock из RawEvent | ✅ |
| `block-distill` | Дедупликация блоков через LLM-арбитр | ✅ |
| `entity-resolver` (+cron) | Дедупликация Entity | ✅ |
| `block-linker` | Типизация связей между блоками | ✅ |
| `entity-graph-builder` (cron) | Граф связей между Entity | ✅ |
| `theme-clusterer` (cron) | Кластеризация блоков в темы | ✅ |
| `reframing` (cron) | Архив слабых связей, merge/split тем | ✅ |
| `card-rollup-v2` | Rollup саммари карточки | ✅ |
| `meeting-analyze-v2` | tasks-v2/chapters-v2/summary-v2 поверх блоков | 🔶 параллельно со старым |
| `strategic-alignment` (cron) | Goal alignment score (Фаза 9) | 🔶 partial |

**10 taskType в LlmRouter** (с JSON Schema strict где нужно): `block-ingest`, `block-distill`, `entity-merge-arbiter`, `block-linker`, `entity-graph-builder`, `theme-classify`, `reframing`, `card-rollup-v2`, `chat-v2` (partial), `goal-alignment` (Фаза 9).

## 3. Сопоставление с онтологией

### 3.1 Классы сущностей (13 в онтологии)

| Класс онтологии | В коде | Как реализовано | Зазор |
|---|---|---|---|
| **Person** | ✅ прямо | `Entity.type='person'` | Нет stylistic_profile / voice_profile — клон сотрудника не собрать |
| **Customer** | ✅ прямо | `Entity.type='client'` | Без сегмента, без LTV, без AM-связи |
| **Project** | ✅ прямо | `Entity.type='project'` | Без срока, статуса, бюджета |
| **Product** | ✅ прямо | `Entity.type='product'` | Без версии, тарифа |
| **Goal** | ✅ прямо | Отдельная модель (Фаза 9) | Реализация partial |
| **Decision** | ⚠️ косвенно | `IdeaBlock.signalType='decision'` | Нет авторов, альтернатив, rationale, последствий — главная боль knowledge loss |
| **Risk** | ⚠️ косвенно | `IdeaBlock.signalType='risk'` | Нет owner, mitigation plan, статуса |
| **Metric** | ⚠️ косвенно | `IdeaBlock.signalType='metric_change'` | Нет формулы, target, time series |
| **Process** | 🔶 в Custom | `Entity.type='custom'` или Theme | Нет стадий, владельца, метрик |
| **Technology** | 🔶 в Custom | `Entity.type='custom'` | Нет вендора, версии, статуса |
| **Vendor** | 🔶 в Custom | `Entity.type='custom'` | Нет контракта, обратного денежного потока |
| **Document** | ⚠️ как Evidence | `RawEvent.payload` + `IdeaBlockEvidence.quote` | Нет узла с версиями, авторами, `supersedes` |
| **Event** | 🔶 partial | `RawEvent` без типизации | Нет EventType enum (meeting/incident/release/transition) |

**Итог:** 5 классов прямо, 3 косвенно через signalType, 3 в custom, 2 partial/как Evidence.

### 3.2 Типы рёбер

**Онтология (~40 типов в 9 группах):**
- Авторство (6): `authored_by`, `owned_by`, `responsible_for`, `created`, `modified`, `approved`
- Участие (5): `participated_in`, `attended`, `assigned_to`, `member_of`, `team_includes`
- Решение (5): `decided`, `proposed`, `approved`, `rejected`, `vetoed`
- Структура (5): `reports_to`, `belongs_to`, `composed_of`, `subset_of`, `instance_of`
- Зависимость (6): `depends_on`, `blocked_by`, `requires`, `enables`, `caused`, `triggered`
- Замена (4): `supersedes`, `replaces`, `succeeds`, `derived_from`
- Коммуникация (4): `mentions`, `references`, `discussed`, `addressed_to`
- Использование (4): `uses`, `consumes`, `produces`, `provides`
- Целеполагание (3): `contributes_to`, `measured_by`, `affects`

**Knowledge-core (13 типов):**
- IdeaBlockLink (7): `develops`, `contradicts`, `causes`, `consequences_of`, `shares_topic`, `shares_entity`, `question_answered_by`
- EntityLink (6): `works_at`, `belongs_to`, `part_of`, `opposes`, `depends_on`, `mentions_with`

**Покрытие ≈ 13/40 (33%).** Прямые совпадения: `depends_on`, `belongs_to`, `part_of`, `causes`, `consequences_of` (≈ `triggered`), `mentions_with` (≈ `mentions`). Полностью отсутствуют целые группы: **авторство/владение, участие, принятие решений, замена/эволюция, целеполагание**.

### 3.3 Provenance рёбер

**Онтология требует на каждом ребре:** `valid_from`, `valid_to`, `source_event_id`, `confidence`, `weight`.

**В коде:**
- `confidence` — ✅ есть на IdeaBlockLink, EntityLink
- `source_event_id` — ⚠️ неявно (через эвиденс блока, не на самом ребре)
- `valid_from` / `valid_to` — ❌ отсутствует
- `weight` — ⚠️ есть только на ThemeIdeaBlock

**Следствие:** временной срез графа невозможно построить. «На момент 2026-05-01 Маша знала X» — нечем ответить, кроме фильтра по `IdeaBlock.createdAt`. Сами связи живут вне времени.

## 4. Главные структурные пробелы

### Пробел 1: Decision как класс
Самая ценная сущность из онтологии (большая часть knowledge loss = потеря логики прошлых решений) — в коде это просто метка на блоке. Нет полей `alternatives`, `rationale`, `expected_consequences`, `actual_consequences`, нет связи `supersedes → Decision`.

**Стоимость:** при росте графа невозможно ответить «почему мы тогда выбрали X, а не Y» — нет структуры альтернатив.

### Пробел 2: Document как класс
Документы (договоры, презентации, RFC, спецификации) — это в онтологии артефакт с авторами, версиями, статусом, ссылками на другие документы. В коде они растворены в `RawEvent.payload` и цитатах Evidence. Нельзя сделать `Document.supersedes`, нельзя версионировать.

**Стоимость:** при подключении адаптеров email/Drive (Фаза 10) документы будут оседать как сырые события, не как граф артефактов.

### Пробел 3: Временной слой графа
Все рёбра — вне времени. Это ломает ключевой use case онтологии: «клон отвечает как срез знаний на момент ухода». Нет способа отфильтровать граф «по состоянию на дату».

**Стоимость:** клон сотрудника технически не достижим без правки схемы связей.

### Пробел 4: Stylistic profile человека
Person есть, но `tone`, `lexicon`, `phraseology`, `decision-making manner` — нет. Voice profile тоже нет.

**Стоимость:** без этого «поговорить с клоном Маши» = просто RAG по её блокам, не клон.

### Пробел 5: Полнота графа рёбер
27 из 40 типов отсутствуют. Особенно ощутимо: вся группа «авторство» (`authored_by`, `owned_by`, `responsible_for`) — есть только косвенно через `IdeaBlock.organizationId` и `Entity.canonicalName`. Группа «принятие решений» (`decided`, `proposed`, `vetoed`) полностью отсутствует, потому что Decision не первоклассная сущность (пробел 1).

## 5. Минимальный план закрытия пробелов

В порядке окупаемости:

1. **valid_from / valid_to на link-таблицах** (1-2 дня)
   - Миграция Prisma: `IdeaBlockLink`, `EntityLink`, `IdeaBlockEntity`, `ThemeIdeaBlock`, `ThemeEntity` + `validFrom`, `validTo` (nullable, default null = «всегда»).
   - Воркеры выставляют `validFrom = createdAt`, `validTo` ставится при archive вместо удаления.
   - API: `/graph/neighbors?at=2026-05-01T00:00:00Z` — фильтр по интервалу.
   - Разблокирует временной срез графа.

2. **Decision как сущность** (3-5 дней)
   - Новая модель `Decision { id, statement, status, rationale, alternatives Jsonb, expectedConsequences, actualConsequences, decidedAt, supersedesId, ... }`.
   - LLM-таск `decision-extractor` поверх блоков `signalType='decision'` — поднимает их в Decision.
   - Связи: `DecisionParticipant` (decided_by/proposed/vetoed), `DecisionConcerns` (на Entity/Project), `Decision.supersedes`.
   - Закрывает главную ценность knowledge loss.

3. **Расширение Entity.type** (2-3 дня)
   - Добавить enum-значения: `process`, `vendor`, `technology`, `document`, `event`.
   - Под каждое — метаданные в `Entity.metadata` Jsonb (для process: стадии, владелец; для document: версия, авторы, supersededById; для event: type, duration, attendees).
   - LLM `block-ingest` промпт расширить enum'ом типов.
   - Закрывает пробелы 2 и часть 5.

4. **Stylistic profile для Person** (3-5 дней)
   - Новая модель `PersonStyleProfile { personEntityId, tone, lexicon Jsonb, samplePhrases[], decisionMakingManner, complexityLevel, lastUpdatedAt }`.
   - Воркер `style-profile-builder.cron` (раз в сутки) — собирает по всем `RawEvent.payload` где упомянут человек как автор.
   - Используется в chat-v2 при answer-as-person.
   - Закрывает пробел 4 (без voice — отложить до достаточного аудио).

5. **Дозаполнение типов рёбер** (постепенно, по мере спроса)
   - Авторство: `authored`, `owned`, `responsible_for` — добавить как `EntityLink.relationType` enum-расширение.
   - Участие: `participated_in`, `member_of` — то же самое.
   - Замена: `supersedes` уже есть в Decision (см. п. 2), добавить для Document и Project.
   - Целеполагание: `contributes_to`, `measured_by` — связи Goal ↔ Metric ↔ Project уже частично есть, доформализовать.

Полный backlog (стиль ТЗ) — отдельным планом в `plans/tz/`, когда основатель решит, что приоритет онтологии выше Фаз 5-6.

## 6. Что не делать

- **Не переписывать knowledge-core с нуля.** Текущая абстракция IdeaBlock + signalType + Entity достаточно гибкая: пробелы закрываются миграциями, не рефакторингом.
- **Не реализовывать сразу все 40 рёбер.** Большинство понадобятся только при подключении конкретных адаптеров (email → `addressed_to`, Jira → `assigned_to`). Делать по мере появления источника.
- **Не пытаться вытащить Process / Vendor / Document из Theme retrospectively.** Подключить новые типы Entity и переразметить с новой версии промпта — дешевле, чем мигрировать темы.

## 7. Итог

**Реализовано ≈ 45% онтологии** по совокупности классов и рёбер. Сильная сторона — pipeline сбора и кластеризации (RawEvent → Theme полностью работает, идемпотентность и provenance на уровне блоков есть). Слабая — структура графа: классы сжаты в 7 типов Entity + 14 signalType вместо 13 классов, рёбра без времени, главная сущность (Decision) не выделена.

**Минимальная инвестиция для подъёма до ~70%:** п. 1 (временной слой) + п. 2 (Decision) + п. 3 (расширение Entity.type) ≈ 1.5-2 недели работы одного бэкенд-разработчика. Это разблокирует временной срез графа, делает клон сотрудника технически достижимым и закрывает главный риск knowledge loss.
