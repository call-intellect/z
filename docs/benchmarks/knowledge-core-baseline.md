# Knowledge-core Phase 2 — baseline benchmark

Status: **TODO**. Golden-set встреч и метрики ещё не подготовлены — это блокер
релиза Фазы 2 в прод.

## Цель (из ТЗ строки 599 и 944-951)

- top-3 hit rate ≥ +50% относительно старого chunk-RAG (baseline — `chat.service`
  поверх `MeetingTranscriptChunk`).
- сжатие ≥ 5× на старте: `canonical_blocks_count / segments_count` ≤ 0.2.
- покрытие сущностей по списку: для каждой встречи golden-set'а указан
  ожидаемый набор Entity (по типам person / project / client / product) —
  считается % найденных.

## Источники истины

- ТЗ: `plans/tz/2026-05-10-knowledge-core-tz.md`, раздел «Фаза 2 → Шаг 6».
- Архитектура: `second-brain/02_architecture/knowledge-core.md`.
- Скелет: `backend/scripts/benchmark-knowledge-core.ts` — печатает структурные
  метрики Org. Реальный harness golden-set'а нужно писать поверх него.

## TODO

- [ ] Подготовить golden-set 5-10 встреч из dev-БД с ручными «ожидаемыми
      ответами» на 3-5 вопросов каждой.
  - Формат: `docs/benchmarks/golden-set/<meeting-id>.json` со схемой
    `{ meetingId, questions: [{ q, expectedBlockId? | expectedKeywords[] }] }`.
- [ ] Дополнить `benchmark-knowledge-core.ts` режимом `--golden-set <dir>` —
      загружает встречи, для каждого вопроса дёргает SearchService и считает
      hit rate.
- [ ] Дёрнуть на тех же вопросах старый `chat.service` (chunk-RAG) и записать
      его top-3 hit rate. Сравнить.
- [ ] Зафиксировать baseline в этом файле + создать дашборд в Grafana
      (panel «KC top-3 hit rate», `panel «KC compression ratio»).

## Текущий статус по структурным метрикам

Команда: `bun run scripts/benchmark-knowledge-core.ts <orgId>` — печатает
JSON со счётчиками IdeaBlock / Entity / Evidence / IdeaBlockEntity / RawEvent
для конкретного Org. Не предоставляет hit rate, только compression и
покрытие.

## Заметки

- pgvector cosine `<=>` против text-embedding-3-small (1536-dim) на нашей
  HNSW-индексной таблице даёт стабильный latency ~10-30мс для top-5.
- ts_vector index — GIN на сгенерированной колонке `search_tsv` (см.
  `backend/scripts/postgres-init.sql`). Веса `name=A, criticalQuestion=B,
  trustedAnswer=C`.
- Веса гибридного скоринга: `cosine=0.7, bm25=0.3` (ENV `SEARCH_COSINE_WEIGHT`,
  `SEARCH_BM25_WEIGHT`). Подбор оптимальных значений — часть бенчмарка
  vNext.
