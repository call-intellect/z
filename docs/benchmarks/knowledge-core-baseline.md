# Knowledge-core Phase 2 — baseline benchmark

Status: **TODO**. Golden-set встреч и метрики ещё не подготовлены — это блокер
релиза Фазы 2 в прод.

> **2026-05-25 (W2.1 scaffolding):** создан каркас golden-set'а в
> `backend/tests/golden/knowledge-core/`. Реальная разметка 50 встреч ещё не
> сделана — это **ручная работа owner'а**, см. раздел «Golden-set W2.1» ниже
> и инструкцию в `backend/tests/golden/knowledge-core/README.md`.

---

## Golden-set W2.1 (новая регресс-инфраструктура)

Источник: ТЗ `plans/tz/2026-05-25-knowledge-core-temporal-and-graph-quality.md`,
§W2.1.

### Текущий baseline

| Метрика                       | Порог | Текущее значение |
| ----------------------------- | ----- | ---------------- |
| `signalTypeMacroF1`           | 0.7   | _не измерено_    |
| `entityRecallAt10`            | 0.85  | _не измерено_    |
| `blockNameCosineSimilarity`   | 0.8   | _не измерено_    |
| `top3SearchHitRate`           | 0.8   | _не измерено_    |

Цель: 50 размеченных встреч к **TODO (owner: проставить дату)**. Дальше — рост
до 200-300 встреч.

### Как пополнять

Подробная инструкция со схемами JSON-фикстур и примерами —
`backend/tests/golden/knowledge-core/README.md`.

Кратко:
1. Положить транскрипт (анонимизированный!) в
   `backend/tests/golden/knowledge-core/meetings/NNN-name.json`.
2. Разметить ожидаемые блоки/entities/queries в
   `backend/tests/golden/knowledge-core/expected/NNN-name.expected.json`.
3. Прогнать `cd backend && bun run golden:knowledge-core`.
4. Когда встреч ≥ 50 — снять `it.skip` для блокирующего CI gate.

### Команды

```
bun run golden:knowledge-core           # запустить suite
bun run golden:knowledge-core:update    # обновить expected после намеренного изменения промптов
```

### Связанные файлы

- Suite: `backend/tests/golden/knowledge-core/golden.spec.ts`
- Конфиг и типы: `backend/tests/golden/knowledge-core/fixtures/golden.config.ts`
- Инструкция: `backend/tests/golden/knowledge-core/README.md`

---

## Исторический контекст (до W2.1)

### Цель (из ТЗ строки 599 и 944-951)

- top-3 hit rate ≥ +50% относительно старого chunk-RAG (baseline — `chat.service`
  поверх `MeetingTranscriptChunk`).
- сжатие ≥ 5× на старте: `canonical_blocks_count / segments_count` ≤ 0.2.
- покрытие сущностей по списку: для каждой встречи golden-set'а указан
  ожидаемый набор Entity (по типам person / project / client / product) —
  считается % найденных.

### Источники истины

- ТЗ: `plans/tz/2026-05-10-knowledge-core-tz.md`, раздел «Фаза 2 → Шаг 6».
- Архитектура: `second-brain/02_architecture/knowledge-core.md`.
- Скелет: `backend/scripts/benchmark-knowledge-core.ts` — печатает структурные
  метрики Org. Реальный harness golden-set'а нужно писать поверх него.

### TODO

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

### Текущий статус по структурным метрикам

Команда: `bun run scripts/benchmark-knowledge-core.ts <orgId>` — печатает
JSON со счётчиками IdeaBlock / Entity / Evidence / IdeaBlockEntity / RawEvent
для конкретного Org. Не предоставляет hit rate, только compression и
покрытие.

### Заметки

- pgvector cosine `<=>` против text-embedding-3-small (1536-dim) на нашей
  HNSW-индексной таблице даёт стабильный latency ~10-30мс для top-5.
- ts_vector index — GIN на сгенерированной колонке `search_tsv` (см.
  `backend/scripts/postgres-init.sql`). Веса `name=A, criticalQuestion=B,
  trustedAnswer=C`.
- Веса гибридного скоринга: `cosine=0.7, bm25=0.3` (ENV `SEARCH_COSINE_WEIGHT`,
  `SEARCH_BM25_WEIGHT`). Подбор оптимальных значений — часть бенчмарка
  vNext.
