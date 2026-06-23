---
type: analysis
status: research-input
feature: knowledge-graph-ingestion-audit
date: 2026-06-23
snapshot_date: 2026-06-23
---
# 06 — OSS-код: getzep/graphiti + microsoft/graphrag (схема, доказано кодом)

## Graphiti (Apache-2.0, Python → порт в TS)
**Узлы (`graphiti_core/nodes.py`, verified):**
- `EpisodicNode`: `source(message|json|text|fact_triple), source_description, content, valid_at, entity_edges[], episode_metadata` — провенанс
- `EntityNode`: `name_embedding, summary, attributes`
- `CommunityNode`: `name_embedding, summary`

**Рёбра (`edges.py`, verified):**
- `EpisodicEdge`: эпизод→сущность
- `EntityEdge` (факт + bi-temporal): `name, fact, fact_embedding, episodes:list[str] (провенанс), created_at, expired_at, valid_at, invalid_at, reference_time, attributes`
- Bi-temporal: система (created/expired) + предмет (valid/invalid); valid/invalid извлекаются LLM при add_episode; относит. даты от reference_time → triangulated(2). **Факт не удаляется — invalid_at.**

**`add_episode` (graphiti.py, verified):** один вход 3 форм (message/text/json); пайплайн: retrieve→extract_nodes→resolve(dedup)→extract_edges+resolve(new/duplicate/invalidated)→attributes→persist→опц. community.
**Dedup (node_operations.py, verified):** (1) вектор-поиск кандидатов порог `NODE_DEDUP_COSINE_MIN_SCORE=0.6`, лимит 15; (2) детерминир. матч; неоднозначное → LLM `dedupe_nodes`. **Рецепт для Z:** pgvector HNSW (порог 0.6) → LLM только спорное (не «LLM на каждую пару»).
Backends Neo4j/FalkorDB/Neptune; LLM OpenAI/Anthropic/Gemini/совместимые (DeepSeek ок); embeddings — наш 1536 ложится в name/fact_embedding.

## GraphRAG (MIT, Python 3.10-3.12 → порт в TS или infra/* микросервис)
**Пайплайн (6 фаз, verified):** TextUnits (чанки **1200 ток** по умолчанию) → doc processing (провенанс-таблица) → graph extraction (сущности+связи+summary; claims опц., OFF) → Leiden-кластеризация → community summarization → embeddings.
**Leiden:** `graspologic.hierarchical_leiden`, `max_cluster_size=10`, seed → triangulated(2). Наш `Theme` = community-уровень.
**Community report (JSON, triangulated(2)):** `{title, summary, rating(0-10 float), rating_explanation, findings:[{summary,explanation}]}`. Известный баг: rating int вместо float → **для Z: Zod z.number()+coerce**.

## Различия (не усредняю)
- Graphiti — инкрементальная real-time память (эпизод→обновление, bi-temporal, без переиндексации). GraphRAG — батч-индексатор статики (rebuild офлайн, нет bi-temporal). **Для потока встреч/чатов ближе Graphiti**; community-summary берём из GraphRAG.

## Схема-кандидат для Коры (Postgres+pgvector+опц.AGE)
- `KnowledgeEpisode` (порт EpisodicNode): id, tenant_id, source, source_description, source_ref jsonb, content, valid_at, created_at, metadata.
- `KnowledgeEntity` (порт EntityNode): name, type, summary, name_embedding vector(1536), attributes; HNSW cosine, dedup порог 0.6.
- `KnowledgeFactEdge` (порт EntityEdge, ключевой): source/target_entity_id, relation_name, fact, fact_embedding, **episode_ids uuid[]**, reference_time, **valid_at/invalid_at (предмет), created_at/expired_at (система)**; факт не удаляем.
- `KnowledgeCommunity` (порт CommunityNode+report): report jsonb {title,summary,rating,findings}, name_embedding, level.
- Конвейер BullMQ (порт add_episode): episode.ingest → extract_entities (DeepSeek+Zod) → resolve (HNSW 0.6 → LLM спорное) → extract_facts (valid/invalid от reference_time) → опц. update_community (@Cron).
**Переносимо как схема:** bi-temporal ребро, эпизод-провенанс, 2-стадийный dedup, community-report JSON, Leiden-иерархия. **Порт в TS:** graphiti_core, graspologic Leiden (JS-Leiden или infra/* микросервис). **Не тащим:** Neo4j/FalkorDB, Covariates.

Источники: github getzep/graphiti (nodes.py/edges.py/graphiti.py/node_operations.py/LICENSE); arxiv 2501.13956; github microsoft/graphrag (LICENSE/dataflow/config/issues #604,#728,#683).
