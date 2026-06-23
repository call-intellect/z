---
type: analysis
status: research-input
feature: knowledge-graph-ingestion-audit
date: 2026-06-23
snapshot_date: 2026-06-23
---
# 04 — Мульти-источник: провенанс, метаданные, склейка идентичности

## 0. Вывод
Зрелые системы приводят ВСЁ (встреча/чат/CRM) к одной абстракции **«эпизод»** (raw, non-lossy), смысл извлекают отдельным слоем. Провенанс **двунаправленный** (факт хранит `episodes:list[str]`, эпизод — свои рёбра). Идентичность — каскад **сильный ID → эмбеддинг имени → LLM-арбитр** + alias-cache. У Z это уже ~70% есть.

## 1. Единая схема «эпизод»
- Graphiti `EpisodicNode`: `uuid, group_id, source(message|text|json), source_description, content, valid_at, created_at, entity_edges[], episode_metadata` → github getzep/graphiti nodes.py → verified
- Zep: эпизод = `{type, content, tref, actor}`, non-lossy, двунаправленные индексы → arxiv 2501.13956 → verified
- Enterprise (UnifyApps): один ETL приводит структуру и не-структуру к единому формату → claimed
**Маппинг Z (есть):** `RawEvent.sourceType` богаче `EpisodeType`; `occurredAt`=valid_at; `receivedAt`=created_at; `payload/payloadS3Key`=content; `tenantId`=group_id. **GAP: нет `sourceTitle`** (= `source_description`).

## 2. Провенанс факт→источник
- `EntityEdge.episodes: list[str]` — факт несёт список эпизодов-источников → github edges.py → verified
- RAG-канон метаданных чанка: source attribution + структура + temporal + классификация → apxml → triangulated(2)
- стабильный chunk ID `doc_id+version+hash`, цитирование +10-15% хранения → airbyte → claimed
**Маппинг Z:** `IdeaBlockEvidence` (blockId, rawEventId, sourceType, quote, startMs/endMs) **богаче Graphiti** (цитата+таймкод). **ДЫРА:** отчёт-блоки теряют `rawEventId` → факт «висит». Лечение: инвариант «блок без evidence запрещён»; отчёт = свой `RawEvent(sourceType='report')`, не null.

## 3. Cross-source identity (каскад)
1. сильный ID (email/аккаунт/ИНН) → 2. эмбеддинг имени + BM25 → кандидаты → 3. LLM-арбитр с контекстом эпизода → 4. **alias-cache** (алиас→каноника+роль).
- Zep: эмбеддинг сущности 1024-d, cosine+полнотекст → LLM-резолв; дубль → обновл. name+summary → arxiv 2501.13956 → verified
- LINK-KG: alias-cache (RESOLVED_ENTITIES + AUXILIARY_DESCRIPTIONS); множеств. упоминание резолвится только если все поимённо, иначе null. **−45.21% дублей, −32.22% шума** → arxiv 2510.26486 → verified
- Glean: канонический ID человека = **email** (обязателен); аккаунты с разными email НЕ сливаются авто → docs.glean.com → verified
**Конфликт:** Zep 1024-d vs Z 1536-d — разные модели; берём метод, размерность 1536.
**Маппинг Z:** `Entity` несёт aliases/mergedIntoId/embedding(1536)/strong-IDs (inn/ogrn/email/phone) — слои 1+2 есть; `resolveSubjectPersonId` (`entity-resolution.service.ts:1114`) детерминир. резолвит автора. **ДЫРА (корень «Настя↔chydo_002»):** имя в тексте идёт fuzzy-LLM без alias-cache и без кросс-источникового кластера; слой 4 отсутствует.

## 4. Диагностика дыры → лечение
| Симптом | Корень (код Z) | Лечение (метод 2026) |
|---|---|---|
| отчёт `sourceMeetingId=null` | блок без `IdeaBlockEvidence.rawEventId`; отчёт не оформлен как RawEvent | инвариант evidence; отчёт=эпизод (verified Graphiti) |
| «Настя»≠`chydo_002` | резолвер бьёт по сильному ID; имя — fuzzy без alias-cache | per-Org alias-cache (LINK-KG −45%) + эмбеддинг + LLM-арбитр |
| нет заголовка источника | RawEvent без `sourceTitle` | добавить `sourceTitle` (verified Graphiti) |

## 5. Канон для Коры (всё через существующие модели Z)
1. Один вход `RawEvent` (адаптеры Meeting/Bitrix/Chatbox) + поле `sourceTitle`.
2. Провенанс на каждом блоке через `IdeaBlockEvidence` (≥1, инвариант + machine-guard) → клик из факта в эпизод с цитатой/таймкодом.
3. Идентичность каскадом в `EntityResolutionService`: сильный ID → эмбеддинг(1536)+полнотекст → LLM-арбитр(DeepSeek) → **per-Org alias-cache (Redis+таблица)**. Cache-friendly (стабильный SYSTEM, алиасы в хвост user).

Источники: github getzep/graphiti nodes.py/edges.py; arxiv 2501.13956; deepwiki getzep/graphiti; arxiv 2510.26486 (LINK-KG); docs.glean.com; apxml chunk-metadata; airbyte; unifyapps. Файлы Z: schema.prisma (RawEvent/IdeaBlock/IdeaBlockEvidence/Entity/SourceType), entity-resolution.service.ts:1114.
