# Векторные индексы

## Стек

- Embedding модель: **bge-m3** (BAAI), 1024 dim, мультиязычный.
- Cross-encoder reranker: **bge-reranker-v2-m3** (BAAI).
- Storage: **pgvector** (HNSW индексы).

## Модель эмбеддера

```
Model: BAAI/bge-m3
Dim: 1024
Max sequence: 8192 tokens
Pooling: CLS
Normalization: L2
```

Запуск через FastAPI обёртку (`embedding-service`), которая публикует `/embed` endpoint.

При смене модели — миграция всех эмбеддингов через batch-job:
1. Создать новую колонку `embedding_v2 vector(...)`.
2. Заполнить через cron в течение нескольких дней.
3. Переключить запросы на v2.
4. Удалить старую колонку.

## Индексы pgvector

### `signal_embeddings.embedding`

```sql
CREATE INDEX signal_embeddings_hnsw
    ON signal_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
```

- `m = 16` — баланс памяти и точности.
- `ef_construction = 64` — баланс времени построения и качества.

### `themes.embedding`

```sql
CREATE INDEX themes_embedding_hnsw
    ON themes USING hnsw (embedding vector_cosine_ops);
```

### `knowledge_articles.embedding`

```sql
CREATE INDEX knowledge_articles_embedding_hnsw
    ON knowledge_articles USING hnsw (embedding vector_cosine_ops);
```

## Параметры запросов

```sql
SET hnsw.ef_search = 100;  -- баланс точности/латентности при чтении
SELECT id, embedding <=> $1 AS distance
FROM signal_embeddings
ORDER BY embedding <=> $1
LIMIT 50;
```

`ef_search = 100` — рабочий компромисс. При деградации recall — увеличиваем до 200.

## Гибридный поиск (M-23)

```python
async def hybrid_search(query: str, filters: SearchFilters, top_k: int = 10):
    embedding = await embedding_service.embed(query)

    # 1. Vector KNN
    vector_candidates = await pg.fetch("""
        SELECT id, embedding <=> $1 AS distance
        FROM signal_embeddings
        WHERE ...
        ORDER BY embedding <=> $1
        LIMIT 50
    """, embedding)

    # 2. Full-text (Meilisearch)
    fulltext_candidates = await meili.search(query, filters)

    # 3. Graph traversal (M-12)
    if filters.seed_node_id:
        graph_candidates = await falkor.find_neighbors(
            filters.seed_node_id, depth=2
        )
    else:
        graph_candidates = []

    # 4. Reciprocal Rank Fusion
    fused = rrf([vector_candidates, fulltext_candidates, graph_candidates], k=60)

    # 5. Cross-encoder rerank
    reranked = await rerank_service.rerank(query, fused[:30])

    # 6. Apply M-20 access filter
    accessible = await access_filter(reranked, user)

    return accessible[:top_k]
```

## Reranking

Cross-encoder вызывается через `rerank-service`:

```python
POST /rerank
{
    "query": "...",
    "documents": ["text1", "text2", ...]
}
→
{
    "scores": [0.93, 0.87, 0.45, ...]
}
```

Top-N после reranking — те, что идут в LLM как контекст.

## Перформанс targets

- Embedding 1 текст до 1k символов: ≤ 30 ms.
- KNN top-50 на 1М векторов: ≤ 100 ms.
- Cross-encoder rerank 30 текстов: ≤ 200 ms.
- Hybrid search end-to-end p95: ≤ 500 ms.

При деградации — добавить replicas `embedding-service` и `rerank-service` (stateless, легко масштабировать).

## Декей и cleanup

Эмбеддинги удалённых сигналов / тем — каскадно через `ON DELETE CASCADE`.

Раз в неделю — `VACUUM ANALYZE` на таблицах с эмбеддингами.

При major-rebuild индексов:
```sql
CREATE INDEX CONCURRENTLY signal_embeddings_hnsw_new ...;
DROP INDEX signal_embeddings_hnsw;
ALTER INDEX signal_embeddings_hnsw_new RENAME TO signal_embeddings_hnsw;
```
