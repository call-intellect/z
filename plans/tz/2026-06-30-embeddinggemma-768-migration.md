# TZ 2026-06-30 — миграция эмбеддингов на embeddinggemma (768 dim, локальный Ollama)

## Контекст

**Что делаем.** Переключаем embedding-стек Z с `text-embedding-3-small` (OpenAI через proxy.agent-lia.ru, 1536 dim) на локальную Ollama-модель `embeddinggemma:latest` (768 dim) через собственный шлюз `https://llm.korateam.ru/v1`.

**Почему.**
- Снижение расходов на embeddings (локальная модель vs OpenAI proxy).
- Снижение размерности: 1536 → 768 → экономия pgvector-storage ≈ 50%, быстрее ANN-поиск.
- Независимость от внешнего провайдера для retrieval-слоя (RAG, KNN-дедуп, semantic search).

**Источник правды.** ENV-конфиг уже настроен в `.env` (строки 123–127):
```
EMBEDDING_PROVIDER=local
EMBEDDING_MODEL=embeddinggemma:latest
EMBEDDING_DIMENSIONS=768
EMBEDDING_FALLBACK_LOCAL_URL=https://llm.korateam.ru/v1
EMBEDDING_LOCAL_API_KEY=<берётся из .env: sk-emb-...>  # секрет, НЕ коммитить
```

Чего не хватает (новые задачи этого ТЗ):
- Zod-схема `env.schema.ts` не знает про `EMBEDDING_LOCAL_API_KEY` (валидация ENV упадёт).
- Дефолты `EMBEDDING_MODEL` и `EMBEDDING_DIMENSIONS` ещё `text-embedding-3-small` и `1536`.
- `LocalEmbeddingService` не передаёт `Authorization: Bearer` в запросе → 401 на llm.korateam.ru.
- Схема БД: 26 колонок `vector(1536)` в 26 моделях + 30+ HNSW-индексов — нужно мигрировать на `vector(768)`.
- Все существующие эмбеддинги (≈N, узнаем через count-скрипт) станут NULL после миграции размерности → нужен backfill через новую модель.
- Документация (second-brain, playbook, prod-deploy-log) упоминает устаревшие 1536/text-embedding-3-small.

## Стратегия

Одна операция, без поэтапного rollout:
1. Code changes (ENV schema, LocalEmbeddingService auth, vector-literal).
2. Prisma-миграция: `vector(1536) → vector(768)` (Prisma сгенерит SQL через `bun run prisma:migrate -- --name embeddings-vector-768`).
3. Backfill-скрипт: переэмбеддинг ВСЕХ непустых текстов по всем 26 таблицам через нового провайдера.
4. Зарегистрировать оба шага в `apply-prod-deploy.ts` (`migrate` + `backfill`).
5. Документация и рефлексия.

Риск: на время backfill (≈минуты при малом объёме, часы при большом) retrieval-сематический поиск по затронутым таблицам работает в degraded-режиме (vector = NULL → KNN по cosine не сработает, fallback на BM25/tsvector/GIN). Допустимо: гибридный retrieval Z уже поддерживает text-only-путь, бизнес-критичные встречи получают BM25-результаты.

## Фазы

### Фаза 0 — оценка объёма (до кода)
- [ ] Создать `backend/scripts/count-embeddings.ts` (читает `pg_attribute`, считает `embedding IS NOT NULL` по каждой таблице).
- [ ] Запустить на локальной/прод-БД, получить таблицу `таблица × колонка × count`.
- [ ] Зафиксировать объём в этом ТЗ (после запуска).

### Фаза 1 — Code changes
- [ ] `backend/src/common/config/env.schema.ts:144-148` — добавить `EMBEDDING_LOCAL_API_KEY: z.string().optional()`.
- [ ] `backend/src/common/config/env.schema.ts:144` — сменить дефолт `EMBEDDING_MODEL` на `'embeddinggemma:latest'`.
- [ ] `backend/src/common/config/env.schema.ts:145` — сменить дефолт `EMBEDDING_DIMENSIONS` на `768`.
- [ ] `backend/src/modules/embeddings/services/local-embedding.service.ts` — добавить чтение API-ключа из cfg + `Authorization: Bearer` header, если ключ задан. Текущая логика (строки 32–43) не передаёт auth — фикс.
- [ ] `backend/src/modules/embeddings/services/vector-literal.util.ts:26` — убрать жёсткую проверку `expectedDim=1536`, использовать `cfg.ai.embeddings.dimensions`.
- [ ] Проверить `LocalEmbeddingService` — если есть batch-limit (как у OpenAiProxy `BATCH_LIMIT=100`), применить то же самое.

### Фаза 2 — Prisma migration
- [ ] `bun run prisma:migrate -- --name embeddings-vector-768` — Prisma сгенерит SQL для всех 26 `Unsupported("vector(1536)") → vector(768)` колонок.
- [ ] Review сгенерированной миграции. Если Prisma не пересоздаёт HNSW-индексы — добавить руками: `DROP INDEX …_embedding_hnsw_cosine_idx; CREATE INDEX … ON … USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL;` (см. `backend/scripts/postgres-init.sql` как референс).
- [ ] Запустить миграцию локально (`bun run prisma:migrate`).

### Фаза 3 — Backfill скрипт
- [ ] Создать `backend/scripts/backfill-embeddings-gemma-768.ts` — единый скрипт для всех 26 таблиц. Шаблон — `backfill-goal-embeddings.ts` (читается через NestFactory + EmbeddingFallbackService, raw SQL UPDATE).
- [ ] Структура скрипта: маппинг `{table, text-builder}` + единый цикл cursor-пагинации по `id`, батч `EMBEDDING_BATCH_SIZE=100`, идемпотентно через `WHERE embedding IS NULL` (после миграции размерности — все записи NULL).
- [ ] Companion `embeddingModelVersion = 'gemma-768'` для `SourceEpisode` и `IdeaBlock` (у остальных колонок этого поля нет — оставляем NULL).
- [ ] Флаги: `--dry-run` (как у существующих backfill-скриптов), `--only=<table>` для точечного прогона.
- [ ] Зарегистрировать в `backend/scripts/apply-prod-deploy.ts` (фаза `backfill`, `skipBootstrap: true`).
- [ ] Прогнать на локальной БД → замерить время, верифицировать `SELECT COUNT(*) WHERE embedding IS NOT NULL` по каждой таблице.

### Фаза 4 — Документация
- [ ] `second-brain/02_architecture/ai-integration.md` — заменить `text-embedding-3-small`/`1536`/`proxy.agent-lia.ru` на `embeddinggemma:latest`/`768`/`llm.korateam.ru/v1`. Указать, что `EMBEDDING_PROVIDER=local` — primary, OpenAI — fallback.
- [ ] `second-brain/02_architecture/tech-stack.md` — то же в сводной таблице стека.
- [ ] `second-brain/02_architecture/knowledge-core.md` — все `vector(1536)` → `vector(768)`, обновить упоминания HNSW-индексов.
- [ ] `second-brain/02_architecture/data-model.md` — отметить миграцию (если файла нет — создать запись в `02_architecture/`).
- [ ] `second-brain/02_architecture/company-memory-overview.md` — обновить retrieval-формулу (1536 → 768).
- [ ] `docs/reference/llm-models-playbook.md` — добавить `embeddinggemma` как primary local embeddings, оставить `bge-m3` как fallback.
- [ ] `docs/operations/prod-deploy-log.md`:
  - Шаг 1 (ENV): новая `EMBEDDING_LOCAL_API_KEY`.
  - Шаг 4 (Prisma schema): все vector(1536) → vector(768) на 26 моделях.
  - Шаг 5 (postgres-init.sql): не трогаем (HNSW параметры одинаковые).
  - Шаг 8 (backfill): `backfill-embeddings-gemma-768.ts`.
  - Шаг 9 (migrate): запись в STEPS, если нужно ручное пересоздание индексов.
- [ ] Рефлексия в `second-brain/05_история/2026-06-30-embeddinggemma-migration.md` (по триггеру после push).

### Фаза 5 — Verify
- [ ] `bun run typecheck` — без ошибок.
- [ ] `bun run lint` — без warning.
- [ ] `bun run build` — успешно.
- [ ] `bun run prisma:generate` после миграции.
- [ ] Прогон `bun run scripts/backfill-embeddings-gemma-768.ts --dry-run` — sanity check.
- [ ] Прогон без `--dry-run` на локальной пустой БД → все эмбеддинги заполнены (или no-op, если таблицы пустые).

## Список файлов, которые меняются

| Файл | Фаза | Что |
|---|---|---|
| `backend/src/common/config/env.schema.ts` | 1 | + `EMBEDDING_LOCAL_API_KEY`, дефолты `EMBEDDING_MODEL`/`EMBEDDING_DIMENSIONS` |
| `backend/src/modules/embeddings/services/local-embedding.service.ts` | 1 | + `Authorization` header из cfg |
| `backend/src/modules/embeddings/services/vector-literal.util.ts` | 1 | убрать хардкод 1536 |
| `backend/prisma/schema.prisma` | 2 | все 26 `Unsupported("vector(1536)")` → `Unsupported("vector(768)")` |
| `backend/prisma/migrations/<ts>_embeddings_vector_768/migration.sql` | 2 | новый файл миграции (генерится автоматически) |
| `backend/scripts/backfill-embeddings-gemma-768.ts` | 3 | новый скрипт |
| `backend/scripts/count-embeddings.ts` | 0 | новый скрипт |
| `backend/scripts/apply-prod-deploy.ts` | 3 | +2 шага (migrate/backfill) |
| `second-brain/02_architecture/ai-integration.md` | 4 | обновить стек |
| `second-brain/02_architecture/tech-stack.md` | 4 | обновить стек |
| `second-brain/02_architecture/knowledge-core.md` | 4 | vector(1536)→vector(768) |
| `second-brain/02_architecture/company-memory-overview.md` | 4 | обновить retrieval |
| `docs/reference/llm-models-playbook.md` | 4 | + embeddinggemma |
| `docs/operations/prod-deploy-log.md` | 4 | Шаги 1, 4, 8, 9 |
| `second-brain/05_история/2026-06-30-embeddinggemma-migration.md` | 4 | рефлексия |

## Открытые вопросы

- Сколько всего записей с `embedding IS NOT NULL` в проде? (Решит count-скрипт на Фазе 0.)
- Допустимо ли кратковременное отключение семантического поиска на время backfill? (Да — гибридный retrieval fallback'нет на BM25; текстовые результаты останутся.)

## Чек-листы

### Production deploy (после мержа)
1. Применить Prisma-миграцию (`bun run prisma:migrate deploy` в compose).
2. Запустить `bun run scripts/backfill-embeddings-gemma-768.ts` в фоне через `apply-prod-deploy.ts --with-schema --mode update` (авто-регистрация).
3. Sanity: `SELECT COUNT(*) FROM "IdeaBlock" WHERE embedding IS NULL` → 0.
4. Smoke: открыть встречу → semantic search в `/me/insights` или RAG в чате v2 → результаты появляются (значит vector retrieval работает).

### Rollback
- ENV `EMBEDDING_PROVIDER=openai-via-proxy` + `EMBEDDING_MODEL=text-embedding-3-small` + `EMBEDDING_DIMENSIONS=1536` — старый стек вернётся, но НЕ совместим с vector(768) в БД. → Перед rollback нужно `ALTER TABLE … ALTER COLUMN embedding TYPE vector(1536)` (потеря новых векторов).
- Реальный rollback без потерь: мигрировать обратно на 1536 + backfill через OpenAI. Не делать без крайней необходимости.

## Итог

Полностью переключаем embedding-стек на локальную Ollama-модель (768 dim) с одной операцией (миграция + backfill). Улучшение: cost ↓, ANN-скорость ↑, independence от внешнего провайдера. Риск — кратковременный degraded retrieval во время backfill, митигируется BM25-fallback'ом.