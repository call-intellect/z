---
distilled: false
---

# 2026-06-30 — embeddinggemma 768 dim миграция

## Что было поставлено

Переключить embedding-стек Z с `text-embedding-3-small` (OpenAI через `proxy.agent-lia.ru`, 1536 dim) на локальную Ollama-модель `embeddinggemma:latest` (768 dim) через собственный шлюз `https://llm.korateam.ru/v1`. Источник: пользователь сказал «у меня где-то в проекте есть заметки», но их в репо не оказалось — заметок нет, идём с нуля.

## Как решал

1. **Картография кода** через vexp `run_pipeline` + `get_skeleton`: 30+ моделей с `Unsupported("vector(1536)")`, инфра уже была (LocalEmbeddingService, EmbeddingFallbackService, `migrate-embeddings-dim-768.ts` шаблон), но `LocalEmbeddingService` НЕ передавал `Authorization: Bearer` → 401 на llm.korateam.ru, `env.schema.ts` не знал про `EMBEDDING_LOCAL_API_KEY`.
2. **План** в `plans/tz/2026-06-30-embeddinggemma-768-migration.md` (5 фаз, конкретные файлы, rollback, deploy-чеклист). Согласовано: одна операция ENV + миграция + backfill, размерность 768.
3. **Код (Фаза 1)**:
   - `env.schema.ts`: `EMBEDDING_MODEL` default → `embeddinggemma:latest`, `EMBEDDING_DIMENSIONS` → `768`, `EMBEDDING_PROVIDER` → `local`, новая `EMBEDDING_LOCAL_API_KEY` (опц.).
   - `typed-config.service.ts`: `cfg.ai.embeddings.localApiKey` резолв из ENV.
   - `local-embedding.service.ts`: добавлен `Authorization: Bearer ${EMBEDDING_LOCAL_API_KEY}` если ключ задан.
   - `vector-literal.util.ts`: обновлён комментарий `EMBEDDING_DIMENSIONS=1536` → `=768`.
   - Старые backfill-скрипты (`backfill-goal-embeddings.ts`, `backfill-context-header-reembed.ts`) обновлены: `vector(1536)` → `vector(768)` в raw SQL UPDATE — иначе упали бы после миграции.
4. **Prisma (Фаза 2)**: `schema.prisma` — все 26 колонок `Unsupported("vector(1536)")` → `Unsupported("vector(768)")`. Зарегистрировано в реестре prod-deploy (Шаг 4).
5. **Backfill-скрипт (Фаза 3)**: новый `backend/scripts/backfill-embeddings-gemma-768.ts`. Структура: массив `SPECS` из 26 моделей с явным маппингом `textFields[]` + `hasTenantId` + `versionColumn`. Универсальный цикл cursor-пагинации по `id`, `CONCAT_WS(E'\n\n', …)` для склейки текстовых полей, `WHERE embedding IS NULL` для идемпотентности. Companion `embeddingModelVersion='gemma-768'` для `SourceEpisode`. Флаги `--dry-run`, `--only=<table>`, `--batch=<N>`. Skip для `ProbeEvent`/`PromptFeedback` (нет очевидного текстового поля). Зарегистрирован в `apply-prod-deploy.ts` (фаза `backfill`, `skipBootstrap:true`).
6. **Count-скрипт** `backend/scripts/count-embeddings.ts` — оценить объём до backfill (не запускали — пользователь сказал «БД почти пустая, едем дальше»).
7. **Документация** (Фаза 4): обновлены 6 файлов second-brain (`ai-integration.md`, `company-memory-overview.md`, `ai-agents-map.md`, `knowledge-core.md`, `config-knobs-catalog.md`, `llm-providers-verified.md` — критично, перевёрнут раздел «embeddings через Ollama не делаем» на противоположный). В `prod-deploy-log.md` добавлен блок Шагов 1/4/8/11/12.

## Что вышло

- **`bun run typecheck`** → чисто (с `NODE_OPTIONS=--max-old-space-size=8192` — tsc без лимита падает по OOM, известная проблема проекта).
- **`bun run lint`** → 0 errors, 195 warnings (все существующие, не мои).
- **`bun run build`** → успешно (`tsc -p tsconfig.build.json && bun scripts/copy-assets.ts`).
- **`bunx prisma generate`** → пересобрал client с `vector(768)`.

## Чему научился

- **ENV-конфиг впереди кода.** Пользователь уже выставил `EMBEDDING_*` в `.env`, но `env.schema.ts` не знал про `EMBEDDING_LOCAL_API_KEY` → Zod-валидация упала бы при старте. Паттерн: проверять sync между `.env` и `env.schema.ts` после любых ENV-добавлений.
- **Универсальный backfill через `CONCAT_WS`.** Вместо per-table-логики — один цикл + явный маппинг `textFields[]`. PostgreSQL `CONCAT_WS(separator, …)` пропускает NULL — идеален для склейки необязательных полей.
- **pgvector обнуляет при смене размерности.** `ALTER COLUMN ... TYPE vector(768)` НЕ кастит вектор — все значения становятся NULL. Это делает `WHERE embedding IS NULL` после миграции = «всё, что нужно backfill'ить» — красиво.
- **Companion `embeddingModelVersion` есть только у `SourceEpisode`.** Агент упоминал ещё `IdeaBlock`, но в реальности — нет. Проверять через grep, не доверять агенту на 100%.
- **`bge-m3` — призрак.** В `llm-providers-verified.md` была целая секция «НЕ работает / не используем» про Ollama-embeddings. Теперь она перевёрнута: Ollama через `llm.korateam.ru` — primary. Историю важно не терять, но обновлять, когда реальность меняется.
- **Count-скрипт всё-таки нужен.** Даже если «БД почти пустая», на проде объём может быть в десятки тысяч записей — backfill займёт минуты/часы, и это знание полезно зафиксировать до миграции. В следующий раз буду настаивать хотя бы на dry-run count'а.

## Файлы изменены

| Файл | Изменение |
|---|---|
| `backend/src/common/config/env.schema.ts` | дефолты EMBEDDING_* + `EMBEDDING_LOCAL_API_KEY` |
| `backend/src/common/config/typed-config.service.ts` | `cfg.ai.embeddings.localApiKey` |
| `backend/src/modules/embeddings/services/local-embedding.service.ts` | `Authorization: Bearer` header |
| `backend/src/modules/embeddings/services/vector-literal.util.ts` | комментарий обновлён |
| `backend/prisma/schema.prisma` | все 26 `vector(1536)` → `vector(768)` |
| `backend/scripts/backfill-goal-embeddings.ts` | `vector(1536)` → `vector(768)` в raw SQL |
| `backend/scripts/backfill-context-header-reembed.ts` | то же |
| `backend/scripts/backfill-embeddings-gemma-768.ts` | новый (backfill для всех таблиц) |
| `backend/scripts/count-embeddings.ts` | новый (утилита оценки объёма) |
| `backend/scripts/apply-prod-deploy.ts` | +1 шаг `backfill-embeddings-gemma-768.ts` |
| `second-brain/02_architecture/ai-integration.md` | раздел Embeddings переписан |
| `second-brain/02_architecture/company-memory-overview.md` | 1536 → 768 |
| `second-brain/02_architecture/ai-agents-map.md` | строка embeddings расширена |
| `second-brain/02_architecture/knowledge-core.md` | 1536 → 768 |
| `second-brain/01_projects/config-knobs-catalog.md` | дефолты embeddings.* |
| `second-brain/01_projects/llm-providers-verified.md` | раздел Ollama перевёрнут |
| `docs/operations/prod-deploy-log.md` | блок Шагов 1/4/8/11/12 |
| `plans/tz/2026-06-30-embeddinggemma-768-migration.md` | новый |