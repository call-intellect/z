# Дайджест: что в планах / что в работе (ANALYST-PLANS)

**Статус на 2026-05-20.** Продукт Z (AI-видеовстречи) находится в критической фазе трансформации из узкоспециализированной встречной платформы в **Company Brain** — второй мозг компании. Реализовано 4 из 12 плановых фаз Knowledge Core (блочная сегментация, дедупликация, линкование, темирование). Текущий фокус — Фазы 7-9, которые превратят разрозненные блоки информации в семантически согласованный граф, готовый для управления целями и стратегической аналитики.

## 1. Карта активных ТЗ (на май 2026)

1. **MVP-архитектура** (2026-05-08) — **статус: черновик**. Стек: NestJS + Next.js + LiveKit SFU + PostgreSQL + Redis + S3. 15 модулей backend, 8 принципов безопасности (HMAC на Crossmark API, JWT session, per-track audio обязателен). Доменная модель зафиксирована: Meeting FSM (8 состояний), Recording FSM (6 состояний), User/Participant/AiResult.

2. **Knowledge Core (главная ставка)** (2026-05-10) — **статус: в работе, 12 фаз**. Фазы 0-4 завершены (RawEvent → IdeaBlock → Entity → Theme). Фазы 5-6 в разработке (Card + стандартный чат). Фазы 7-9 в ТЗ (Админка/Дашборд/Цели). Фазы 10-12 спланированы. **Ключевой принцип:** все данные нормализуются в блоки, всё остальное — проекции блоков на граф Entity/Theme/Link.

3. **Фаза 7 — Админка Z + Org-Admin** — Z-Admin для владельца продукта: дашборд экономики, управление LLM-моделями, A/B-эксперименты, прайс-карта. Org-Admin для владельца компании: отладка ядра. **Продаваемая ценность:** видимость стоимости AI, контроль качества, безопасность data.

4. **Фаза 8 — Дашборд директора** — owner видит срез компании за неделю/месяц: новые темы, горячие сигналы (pain/feature_request/churn), активные темы, топ-сущности, открытые вопросы. Встроенный AI-чат. **Продаваемая ценность:** руководитель видит пульс компании за 30 секунд.

5. **Фаза 9 — Цели компании + стратегический согласователь** — Owner создаёт 1-10 целей, привязывает к темам. Суточный воркер оценивает alignment (0-100). Топ-индикатор на дашборде. **Продаваемая ценность:** отслеживание стратегии в реальном времени, алерты на падение движения к целям.

6. **Standalone Product** (2026-05-09) — отдельный логин, не через Crossmark.

7. **AI Meeting Workspace** (2026-05-09) — встроенное совместное редактирование во время встречи.

## 2. Knowledge Core: 12 фаз детально

**Реализованы (Фазы 0-4):**
- Фаза 0: LlmRouter, управление моделями, RBAC, схема данных.
- Фаза 1: RawEvent, блочная сегментация до 2k токенов, встраивания 1536-dim.
- Фаза 2: Entity (7 типов: person/client/project/product/custom/skill/topic), дедупликация KNN.
- Фаза 3: IdeaBlockLink (7 типов связей), IdeaBlockEntity, Entity Graph Builder.
- Фаза 4: Theme (кластеризация KNN-greedy 0.78), Theme.dynamic (growing/stable/declining).

**В работе (Фазы 5-6):**
- Фаза 5: Card (CRM-карточки: client/deal/project/topic/custom) с rollup-саммари.
- Фаза 6: Chat v2 (org-scope, RAG поверх Theme, streaming-ответы).

**В ТЗ (Фазы 7-9):**
- Фаза 7: Две админки (Z-Admin глобальная, Org-Admin локальная), 8 страниц.
- Фаза 8: Дашборд директора (5 виджетов + AI-чат).
- Фаза 9: Goal, GoalAlignmentSnapshot, топ-индикатор.

**Спланированы (Фазы 10-12):**
- Фаза 10: Интеграции (почта, мессенджеры, CRM, файлы). Адаптеры Airbyte.
- Фаза 11: Масштабирование (materialized views, GraphQL, RLS в БД).
- Фаза 12: Клон сотрудника (Employee Clone) — stylistic profile + voice + personal subgraph.

## 3. Второй мозг компании — архитектурный черновик (11 слоёв Event-Sourced)

1. **Ingestion** (коннекторы к Exchange, Slack, Notion, Bitrix24, Zoom, Git, 1С).
2. **Event Log** (Kafka/Redpanda, append-only, партиции по tenant).
3. **Raw Object Storage** (MinIO).
4. **Extraction Pipeline** (6 стадий: preprocessing, entity, relation, event, decision, quality).
5. **LLM Gateway** (LiteLLM, tier-маршрутизация локальные → Russian API → Claude).
6. **Storage Layer** (6 проекций: Knowledge Graph Neo4j, Vector Qdrant, Temporal, Episodic TimescaleDB, Document Postgres, Audit ClickHouse).
7. **Ontology & Entity Resolution** (YAML-версионируемая, fuzzy+LLM+доменные правила).
8. **Memory Consolidation** (daily/weekly/monthly воркеры, поиск противоречий, PAGE-RANK).
9. **Permissions** (OPA + ABAC, post-query filtering).
10. **Query Layer** (Graph-RAG+ с hybrid retrieval).
11. **Agent Layer** (Employee Clone, Process Narrator, Decision Archaeologist, Compliance Agent).

## 4. Зазор между текущим состоянием и целевой архитектурой

Gap-анализ показал: **реализовано ~45% онтологии**. Сильные стороны — pipeline сбора идеален. Слабые:
- **Decision не первоклассная сущность** (нет альтернатив, rationale, последствий).
- **Нет временного слоя графа** (valid_from/valid_to) — клон сотрудника технически невозможен.
- **Полнота типов рёбер** (13 из 40 реализованы).
- **Stylistic profile человека** отсутствует.

Минимальный план закрытия (1.5-2 недели): valid_from/valid_to, Decision как модель, расширение Entity.type.

## 5. Бизнес-объекты, спроектированные

**Ядро (в продакшене):** User, Org, Membership (RBAC), LlmRouter/LlmTaskRoute, LlmModelPrice, AiUsageLog, Card (CRM), Source/RawEvent, IdeaBlock/IdeaBlockEntity, Theme, Entity (7 типов), IdeaBlockLink/EntityLink, Quota.

**В ТЗ:** Goal, GoalTheme, GoalAlignmentSnapshot, SuperAdminAccessLog, Org.workersEnabled.

## 6. Целевая архитектура MVP

**Принципы:** LiveKit только для медиа, per-track audio обязателен, stateless frontend, 4-стадийный AI-pipeline через BullMQ (transcribe → merge → analyze → notify), все публичные URL неугадываемы (ULID).

## 7. Дорога к Company Brain (700M ₽/мес)

1. **Фазы 7-9 в коде** — ETA: 6-8 недель.
2. **Фаза 10 — Интеграции** — ETA: 8-10 недель. Разблокирует network effect.
3. **Фаза 11 — Масштабирование** — ETA: 4-6 недель.
4. **Фаза 12 — Employee Clone** — ETA: 8-12 недель.
5. **Second Brain слои 5-6+** — отдельный проект (3-5 месяцев).

**Критический путь:** 7-9 → 10 → 12. Фазы 5-6 параллельны.

## 8. Топ-10 «больших ставок» в планах

1. Event-sourced ядро — все хранилища это проекции Event Log.
2. Knowledge Core как ядро всех будущих продуктов.
3. Decision как первоклассная сущность (главный инструмент против knowledge loss).
4. Employee Clone (4 компонента: stylistic + subgraph + voice + permissions).
5. 152-ФЗ архитектурно встроена.
6. LlmRouter с tier-маршрутизацией.
7. Per-Org граф знаний (network effect внутри клиента).
8. Дашборд директора как «pulse компании за 30 сек».
9. Strategic Alignment (alignment 0-100 между целями и реальностью).
10. Three-tier админ (Z-Admin / Org-Admin / Manager UI).

## 9. Зоны риска

- Decision-сущность отсутствует, что блокирует Employee Clone.
- Нет временного слоя — историю знаний не восстановить.
- Frontend фаз 7-12 — несколько месяцев работы.
- Параллельные версии (transcript-index v1+v2, card-rollup v1+v2) — техдолг.

## 10. 5 неочевидных инсайтов

1. **Event-sourced даёт правильную стратегию масштабирования.** Вместо миграции «в большое» все хранилища — проекции Event Log. При изменении онтологии достаточно перепроцессировать события.

2. **Decision как первоклассная сущность — главный инструмент против knowledge loss.** Сейчас Decision это метка. Минимум 2 недели работы разблокирует Employee Clone как реальный продукт.

3. **Три слоя админ создают правильный разлом ответственности.** Z-Admin видит $cost, Org-Admin видит свежесть данных, manager видит результаты.

4. **Дашборд директора — это validation engine для Knowledge Core.** Если совпадает с восприятием owner — граф работает. Это критерий качества, не фича.

5. **Employee Clone требует 4 независимых компонента, не монолит.** Stylistic profile + personal subgraph + voice profile + permissions. Это даёт гибкость: можно включить только stylistic на MVP.
