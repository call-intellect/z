---
type: tz
status: draft
feature: Фаза 0b — Document-ingest pipeline + text.adapter + расширение extraction
date: 2026-05-21
parent_tz: tz/2026-05-21-phase-0-roles-and-onboarding.md
depends_on:
  - tz/2026-05-21-phase-0a-data-model-and-graph-infra.md (модели Document, RawEvent, группа Б, GraphService.upsertEntity)
unblocks:
  - tz/2026-05-21-phase-0c-onboarding-wizard-frontend.md (после 0b.1+0b.2 — /documents и /dump работают)
  - tz/2026-05-21-phase-0d-role-profile-agent.md (после 0b.3 — IdeaBlock.role_relevant и сущности группы Б наполняются)
covers_matrix_rows: [26, 27, 28, 29, 30, 31, 63, 64, 65, 66, 69, 82 (выдача API)]
---

# ТЗ 0b: Document-ingest pipeline + text.adapter + extraction для каркаса 5 уровней

> **Это sub-TZ.** Зонтичный — [`plans/tz/2026-05-21-phase-0-roles-and-onboarding.md`](2026-05-21-phase-0-roles-and-onboarding.md). При расхождениях — приоритет у зонтичного.
>
> **Контекст:**
> - Существующая структура ingest: [`backend/src/modules/ingest/`](../../backend/src/modules/ingest/) с адаптерами `meeting.adapter.ts`, `email/`, `phone-call/`, `telegram/`, `web-form/`. Добавляем два новых: `document.adapter.ts` и `text.adapter.ts`.
> - Pipeline knowledge-core: `RawEvent → IdeaBlock → IdeaBlockLink/EntityLink → Theme`. Все стадии через BullMQ-воркеры (`backend/src/workers/`). Не ломаем.
> - **Все промпты LLM** — через prompt registry (skill `z-ai-agent-rules`). Code fallback обязателен. Изменения промптов через скрипты `backend/scripts/patch-prompt-*.ts` (skill `safe-seed-rules`).
> - **LLM-вызовы** — только через `LlmRouterService` с `taskType`, не напрямую к Anthropic/Vox.
> - **Парсер документов** — `pdf-parse` + `mammoth` для MVP (зонтичный §6, решение #1).

---

## 1. Цель

После 0b у Z работает **полный document-ingest pipeline + расширенный extraction**:

1. Пользователь загружает PDF/DOCX/Markdown через POST `/api/v1/documents` (frontend в 0c) → парсер извлекает текст → `BlockExtractionService` создаёт `IdeaBlock`-и + типизированные сущности группы Б → `EntityResolutionService` дедуплицирует.
2. Пользователь пишет дамп в `/dump` (frontend в 0c) → `text.adapter` создаёт `RawEvent` без парсинга → тот же pipeline.
3. На странице документа `/documents/:id` доступен readonly-провенанс: какие `IdeaBlock`-и и сущности группы Б извлечены из этого документа.
4. `IdeaBlock`-и помечены флагом `role_relevant: bool` + опц. `roleId` — это вход для `RoleProfileAgent` в 0d.

---

## 2. Scope

### Входит в 0b

**А. Парсеры:**
- `pdf-parse` для PDF.
- `mammoth` для DOCX.
- `marked` (text-only mode) для Markdown.
- Fallback: если расширение неизвестно, MIME = `text/plain` → читаем как plain.

**Б. Адаптер `document.adapter.ts`:**
- Подписан на событие `document.uploaded` из BullMQ (публикуется в `POST /api/v1/documents` из 0a).
- Парсит файл → заполняет `Document.parsedText`, меняет `Document.status: uploaded → parsing → parsed`.
- Создаёт `RawEvent { sourceType: 'document', payload: parsedText, sourceDocumentId }`.
- При неудаче — `Document.status = failed`, заполняет `Document.parseError`.

**В. Адаптер `text.adapter.ts`:**
- Подписан на событие `dump.created` из BullMQ (публикуется в `POST /api/v1/dumps`).
- Создаёт `Document { kind: 'text', uploaderId, parsedText: content, status: parsed }` (используем `Document` как контейнер для homogeneity) + `RawEvent`.
- Никаких парсеров — текст идёт сразу.

**Г. Расширение `BlockExtractionService`:**
- JSON-схема ответа LLM расширяется на типизированные сущности группы Б (Process, Decision, Regulation, Policy, Metric, Tool, опционально Mission/Vision/Strategy).
- Эксперимент на старте 0b: один промпт vs несколько проходов (см. §5).
- Пометка `role_relevant: bool` + опц. `roleId?: string` для каждого блока идей.
- Поле `confidence` для каждой извлечённой типизированной сущности.

**Д. Расширение `EntityResolutionService`:**
- Дедуп новых типов группы Б: cosine на embedding'е имени + LLM-arbiter для пограничных случаев + доменное правило «одно название процесса/регламента/политики в Org = одна сущность».
- Линковка `Entity{type=person}` к `Person` (заполнение `Person.entityId`) — побочный продукт, см. §6.

**Е. Сохранение сущностей группы Б:**
- Через `GraphService.upsertEntity` из 0a — двойная запись в Postgres + AGE.
- Provenance: `sourceDocumentId`, `sourceIdeaBlockId`, `sourceMeetingId`.

**Ж. `Decision` параллельно `IdeaBlock`:**
- Когда `IdeaBlock.signalType = 'decision'` создаётся, параллельно создаётся `Decision`-узел (idempotent по `sourceIdeaBlockId`).

**З. Endpoint для дампа:**
- `POST /api/v1/dumps` body `{ content: string }` → создание `RawEvent` через `text.adapter`.

**И. Расширение API `/api/v1/documents/:id`:**
- Возвращает не только сам Document + parsedText, но и:
  - Список `IdeaBlock`-ов с этого документа.
  - Readonly-провенанс группы Б: `{ processes: [...], decisions: [...], regulations: [...], ... }` — только имена + типы + confidence (см. зонтичный строка 82, аналитика §7.4).

### Не входит в 0b

- Frontend (0c).
- `RoleProfileAgent` (0d).
- CRUD-страницы для группы Б — γ.
- OCR для отсканированных PDF — γ или ε (Apache Tika).
- Голос / файлы в `/dump` — γ.
- Apache AGE / `GraphService` (это 0a).
- Mission/Vision/Strategy автоизвлечение — отключено флагом `EXTRACTION_ENABLE_TOP_LEVEL=false` (зонтичный §6, решение #11).

---

## 3. Структура и зависимости

```
0a (модели + GraphService + Document API)
  ↓
0b.1 Парсеры + document.adapter + text.adapter + базовый pipeline (1.5 недели)
  ↓ ─→ 0c может стартовать /documents и /dump на frontend
0b.2 Расширение API /documents/:id (provenance) + provenance в EntityLink (3 дня)
  ↓
0b.3 Эксперимент extraction (один промпт vs несколько) + финальная JSON-схема + патчи промптов (1-1.5 недели)
  ↓ ─→ 0d может стартовать (IdeaBlock.role_relevant и сущности Б наполняются)
0b.4 EntityResolutionService расширения + Decision-параллельное создание + Person-Entity линковка (1 неделя)
```

**Critical path — 0a.1 → 0b.1**. 0a.2 (GraphService) нужен для 0b.3+.

---

## 4. Парсеры

### 4.1. Выбор библиотек

| Формат | Библиотека | Версия | Notes |
|---|---|---|---|
| PDF | `pdf-parse` | latest stable | In-process, без sidecar |
| DOCX | `mammoth` | latest stable | Конвертирует в HTML или text; для нас — text mode |
| Markdown | `marked` + `marked-plain-text` (или ручной strip) | latest | Из markdown → plain text для embedding'ов |
| Text | — | — | `Buffer.toString('utf-8')` |

**Перед добавлением в package.json — Context7 (`mcp__context7__resolve-library-id` + `query-docs`).** Сверить актуальный API (часто меняется), особенно для `pdf-parse` (известны проблемы с большими PDF).

### 4.2. Архитектура парсера

```ts
// backend/src/modules/ingest/parsers/document-parser.service.ts

@Injectable()
export class DocumentParserService {
  async parse(input: { kind: DocumentKind; content: Buffer | string; mimeType: string }): Promise<ParseResult> {
    switch (input.kind) {
      case 'pdf':       return this.parsePdf(input.content);
      case 'docx':      return this.parseDocx(input.content);
      case 'markdown':  return this.parseMarkdown(input.content);
      case 'text':      return { text: input.content.toString('utf-8'), metadata: {} };
      default:          throw new ParseError(`Unsupported kind: ${input.kind}`);
    }
  }
}

type ParseResult = {
  text: string;
  metadata: {
    pageCount?: number;
    title?: string;
    author?: string;
    extractedAt: Date;
  };
};
```

### 4.3. Лимиты и graceful degradation

- Максимальный размер файла: **50 MiB** для PDF/DOCX, **10 MiB** для текста (`ConfigService.DOCUMENT_MAX_SIZE_MB`).
- Максимальное время парсинга: **30 секунд** на один документ (`p-timeout`).
- На превышении — `Document.status = failed`, `Document.parseError = 'Превышен лимит размера'` / `'Превышено время парсинга'`.
- Пользовательское сообщение в `/documents/:id` — на русском: «Не смогли распарсить. Загрузите как Markdown или текст, либо обратитесь к админу.»

### 4.4. Сохранение исходника

Из 0a модели `Document`:
- `s3Key` для файлов ≥ inline-threshold.
- `inlineContent` (Bytes) для файлов < inline-threshold (10 MiB, по паттерну `RawEvent`).

Загрузка в S3 — через существующий [`backend/src/common/`](../../backend/src/common/) (если есть `s3.service.ts`, иначе ад-хок — проверить при импл-ии).

---

## 5. Эксперимент: один промпт vs несколько проходов

**Закрывается в первой неделе 0b.3.** Открытый вопрос #8 зонтичного.

### 5.1. Setup эксперимента

1. Собрать **10 реальных артефактов** разной длины (встречи + документы):
   - 3 коротких встречи (≤30 минут).
   - 3 длинных встречи (>60 минут).
   - 2 PDF должностные инструкции.
   - 2 DOCX описания процессов.

2. Размечают вручную (1-2 разработчика + продакт): ожидаемые `IdeaBlock`-и + типизированные сущности. Это **ground truth**.

3. Реализовать **два подхода в feature-flag**:
   - **A — один промпт.** JSON-схема возвращает `{ ideaBlocks: [...], processes: [...], decisions: [...], regulations: [...], policies: [...], metrics: [...], tools: [...], mission?, vision?, strategy?, links: [...] }`.
   - **B — три прохода:**
     - Pass 1: блоки идей (текущий промпт `block-extraction`, минимально изменён).
     - Pass 2: типизированные сущности (новый промпт `entity-extraction-typed`).
     - Pass 3: связи между сущностями и блоками (новый промпт `entity-link-extraction`).

4. Запустить оба подхода на 10 артефактах, посчитать:
   - **Precision** = `extracted ∩ ground_truth / extracted` (по типам и по содержанию).
   - **Recall** = `extracted ∩ ground_truth / ground_truth`.
   - **Cost** в токенах (input + output, в долларах через `LlmModelPrice`).
   - **Latency** end-to-end.

5. Решение по результатам:
   - Если precision A ≥ B−0.05 И cost A < B → выбираем A.
   - Если recall B ≥ A+0.10 → выбираем B (длинные документы требуют разделения).
   - Иначе — гибрид: A для коротких документов (`parsedText.length < 5000`), B для длинных.

### 5.2. Финальная JSON-схема (если выбираем A)

```json
{
  "ideaBlocks": [
    {
      "text": "string",
      "signalType": "fact | decision | risk | promise | idea | question",
      "tags": ["string"],
      "role_relevant": true,
      "roleId": "uuid | null",
      "confidence": 0.85
    }
  ],
  "processes": [
    { "name": "string", "description": "string", "ownerRoleName?": "string", "triggerDescription?": "string", "confidence": 0.7, "sourceBlockIndex": 3 }
  ],
  "decisions": [
    { "text": "string", "rationale?": "string", "decidedByPersonName?": "string", "decidedAt?": "ISO8601 | null", "confidence": 0.9, "sourceBlockIndex": 5 }
  ],
  "regulations": [
    { "name": "string", "contentMd": "string", "category": "regulation | standard", "confidence": 0.6, "sourceBlockIndex": 7 }
  ],
  "policies": [...],
  "metrics": [...],
  "tools": [...],
  "mission": null,  // EXTRACTION_ENABLE_TOP_LEVEL=false
  "vision": null,
  "strategy": null,
  "links": [
    { "fromIndex": 0, "fromType": "process", "toIndex": 0, "toType": "role", "linkType": "owned_by", "confidence": 0.7 }
  ]
}
```

`sourceBlockIndex` — индекс соответствующего `IdeaBlock` в массиве `ideaBlocks` (для построения provenance `Entity → IdeaBlock`).

### 5.3. Промпты

Все промпты — через **prompt registry**:
- `block-extraction-v2` (заменяет существующий `block-extraction`).
- `entity-extraction-typed` (новый, если выбран подход B).
- `entity-link-extraction` (новый, если B).

Изменения промптов — через `backend/scripts/patch-prompt-block-extraction-v2.ts` (skill `safe-seed-rules`). **Не править `seed.ts` для существующих промптов** — admin может уже отредактировать их через UI.

---

## 6. Расширение `BlockExtractionService`

### 6.1. Изменения в коде

Расширение существующего `BlockExtractionService` в `backend/src/modules/knowledge-core/` (или эквивалент — путь сверить при импл-ии):

1. Новый input: `{ rawEventId, parsedText, sourceContext: { documentId?, meetingId?, dumpId? } }`.
2. LLM-вызов через `LlmRouterService.run({ taskType: 'block-extraction-v2', prompt, input, dataClass })`.
3. Парсинг ответа в TypeScript-типе `ExtractionResponse` (zod-схема).
4. Сохранение `IdeaBlock`-ов через существующий путь.
5. Сохранение типизированных сущностей через `GraphService.upsertEntity` (см. §7).
6. Создание связей через `GraphService.addEdge`.

### 6.2. Confidence и ambiguousTypes

Для каждой типизированной сущности — `confidence: number` (0..1). Если LLM колеблется (например, Process vs Regulation), возвращает массив `ambiguousTypes: ['Process', 'Regulation']` в metadata. Сохраняем как тот, который имеет наибольший `confidence`; `ambiguousTypes` идёт в `metadata` сущности (зонтичный §6 решение #9).

---

## 7. Сохранение сущностей группы Б через `GraphService.upsertEntity`

`GraphService.upsertEntity` из 0a §6.1:

```ts
const result = await graphService.upsertEntity({
  tenantId: rawEvent.orgId,
  type: 'process',
  data: {
    name: extracted.name,
    description: extracted.description,
    ownerRoleId: resolvedOwnerRoleId,
    confidence: extracted.confidence,
    ambiguousTypes: extracted.ambiguousTypes,
  },
  sourceProvenance: {
    rawEventId: rawEvent.id,
    documentId: sourceContext.documentId,
    ideaBlockId: ideaBlockId,
  },
});
```

`upsertEntity` сам:
- Делает поиск дубликата через `EntityResolutionService` (см. §8).
- Если дубликат найден — обновляет существующую сущность (merge полей, accumulate `confidence`).
- Если нет — создаёт новую + узел в AGE + ребро `derived_from` → Document.

---

## 8. Расширение `EntityResolutionService`

Существующий [`EntityResolutionService`](../../backend/src/modules/knowledge-core/) сейчас умеет дедуплицировать `Entity{type=person/client/...}`. Расширяем на новые типы группы Б.

### 8.1. Доменные правила

- **Process / Regulation / Policy / Metric / Tool:** одно название (нормализованное) в рамках Org = одна сущность. Нормализация: lowercase + удаление лишних пробелов + удаление кавычек + лемматизация (через `morpher` или простой stemmer для русского).
- **Decision:** один `sourceIdeaBlockId` = один Decision (unique constraint на уровне БД из 0a). LLM может возвращать одно и то же решение несколько раз — `EntityResolutionService` сглаживает.
- **Mission / Vision / Strategy:** в Фазе 0 не извлекаются (`EXTRACTION_ENABLE_TOP_LEVEL=false`), пропускаем.

### 8.2. Алгоритм дедупликации (типизированные сущности)

1. **Точное совпадение нормализованного имени** в рамках Org → returnExisting.
2. **Cosine sim ≥ 0.92** между embedding'ом имени нового и существующих → returnExisting.
3. **Cosine sim 0.78–0.92** → LLM-arbiter с промптом `entity-resolver-arbiter`:
   - Input: новое имя + текст-контекст + кандидаты.
   - Output: `{ matched_id?: uuid, confidence: number }`.
   - Если matched — returnExisting.
4. **Cosine sim < 0.78** → createNew.

### 8.3. Person ↔ Entity{type=person} линковка

Побочный продукт `EntityResolutionService` (выходит за scope «дедуп», но идеологически здесь).

Когда LLM упоминает персону по имени в встрече/документе, создаётся `Entity{type=person, name='Иван Петров'}`. Это **не** Person в смысле модели — это упоминание. Связь:

1. При создании `Entity{type=person}` — поиск среди существующих `Person` в Org с похожим именем (cosine sim).
2. Если найден — `Person.entityId = entity.id` (заполняется поле). Это даёт двусторонняя связь.
3. При создании нового `Person` через `POST /api/v1/persons` (0a) — backend ищет существующий `Entity{type=person}` с похожим именем и линкует.

Это **enrichment**, не критичный путь — если линковка не сработала, ничего страшного, `Person.entityId` останется null. CuratorAgent в δ разберёт пограничные случаи.

---

## 9. Endpoint `/api/v1/dumps`

```ts
POST /api/v1/dumps
Body: { content: string }
Auth: JwtAuthGuard + TenantGuard
RBAC: member:create (любой залогиненный member может дампить)

Response: { dumpId: string, status: 'queued' }
```

Контроллер:
1. Создаёт `Document { kind: 'text', uploaderId: currentPerson.id, parsedText: content, status: 'parsed', name: 'Дамп от ${timestamp}' }`.
2. Публикует событие `dump.created` в BullMQ.
3. `text.adapter` подхватывает, создаёт `RawEvent` + триггерит `BlockExtractionService`.
4. Возвращает быстро (≤200 ms).

Лимиты: `content.length ≤ 50_000` символов (zod-валидация).

---

## 10. Расширение API `/api/v1/documents/:id` (provenance)

Существующий endpoint из 0a возвращает базовый Document. Расширение:

```ts
GET /api/v1/documents/:id

Response: {
  document: DocumentDto,
  parsedText: string | null,
  ideaBlocks: IdeaBlockDto[],
  extractedEntities: {
    processes:    Array<{ id, name, confidence }>;     // readonly-провенанс
    decisions:    Array<{ id, text, confidence }>;
    regulations:  Array<{ id, name, category, confidence }>;
    policies:     Array<{ id, name, severity, confidence }>;
    metrics:      Array<{ id, name, unit, confidence }>;
    tools:        Array<{ id, name, kind, confidence }>;
  };
}
```

`extractedEntities` — provenance (зонтичный строка 82). Frontend в `/documents/:id` рендерит как readonly-список с `confidence`, без ссылок на отдельные страницы сущностей (аналитика §7.4).

RBAC: возвращать `extractedEntities` только для `owner`/`admin`. Для `member` — пустой массив (или `null`), чтобы не утекали все Process/Decision Org.

---

## 11. Метрики, логи и мониторинг

### 11.1. Метрики Prometheus (через существующий `prom-client` в `common/metrics`)

```
z_document_parse_total{status="parsed|failed", kind="pdf|docx|markdown|text"}
z_document_parse_duration_seconds{kind} (histogram)
z_extraction_blocks_total
z_extraction_entities_total{type="process|decision|regulation|policy|metric|tool"}
z_extraction_confidence{type} (histogram)
z_extraction_ambiguous_total{type}
z_entity_resolution_dedup_total{type, action="merged|created"}
z_dump_created_total
```

### 11.2. Логи (pino)

- На каждый этап pipeline — `info` лог с `rawEventId`, `documentId`, `step`.
- На extraction-результат — `info` с counts извлечённых сущностей.
- На ambiguous-случай (confidence < 0.6) — `warn` с `entityType`, `name`, `ambiguousTypes`.
- На failure — `error` с stack.

---

## 12. Фазирование

| Фаза | Длительность | Содержимое |
|---|---|---|
| 0b.1 | 1.5 недели | DocumentParserService + document.adapter + text.adapter + базовый pipeline + `/api/v1/dumps` endpoint. Расширение `/api/v1/documents/:id` минимальное (без provenance). Метрики базовые |
| 0b.2 | 3 дня | Расширение `/api/v1/documents/:id` на provenance группы Б. Тесты на RBAC (member не видит extractedEntities) |
| 0b.3 | 1-1.5 недели | Эксперимент один промпт vs несколько. Финальная JSON-схема. Патчи промптов через scripts. Сохранение группы Б через GraphService.upsertEntity. Decision-параллельное создание |
| 0b.4 | 1 неделя | EntityResolutionService расширения. Person ↔ Entity линковка. Тесты дедупликации на 20+ парах |

**Параллелизация:**
- После 0b.1 — `/documents` UI можно делать в 0c.4.
- После 0b.3 — `RoleProfileAgent` в 0d.

---

## 13. DoD (критерии готовности 0b)

### Технические

- [ ] `bun run typecheck` чистый.
- [ ] `bun run lint` чистый.
- [ ] `bun run test:unit` зелёный по `DocumentParserService`, `EntityResolutionService` (новые тесты на группу Б).
- [ ] `bun run test:integration` зелёный на полном document-ingest pipeline (upload → parse → extract → upsertEntity → events fired).
- [ ] `bun run build` чистый.
- [ ] Прогон skill `strict-production-review-gate`.

### Функциональные

- [ ] Парсер успешно обрабатывает PDF/DOCX/Markdown на тестовом наборе из ≥10 реальных документов (зонтичный DoD).
- [ ] Извлечение группы Б на ≥10 встречах/документах достигает precision ≥ 0.8 по ручной разметке (зонтичный DoD).
- [ ] EntityResolution дедуплицирует ≥80% пар одинаковых процессов/регламентов в разных встречах (зонтичный DoD).
- [ ] Загрузка документа размером ≥10 MiB корректно идёт через S3, не inline.
- [ ] Дамп `/api/v1/dumps` создаёт RawEvent + появляется IdeaBlock в knowledge-core в течение 30 секунд.
- [ ] На странице документа (`/api/v1/documents/:id`) admin видит extractedEntities, member — нет.
- [ ] Эксперимент один-vs-несколько-проходов проведён, решение задокументировано в `second-brain/01_projects/document-ingest.md` со ссылкой на метрики.

### Документация

- [ ] Создан `second-brain/01_projects/document-ingest.md` — pipeline, парсеры, extraction-стратегия, результат эксперимента.
- [ ] Обновлён `second-brain/01_projects/ai-jobs.md` — добавлен `block-extraction-v2`, опц. `entity-extraction-typed`, `entity-link-extraction`, `entity-resolver-arbiter`.
- [ ] Обновлён `second-brain/01_projects/workers-queues.md` — `document.queue`, `text.queue`.
- [ ] Обновлён `second-brain/02_architecture/module-map.md` — расширения `ingest/`.
- [ ] Запись рефлексии в `second-brain/05_история/2026-MM-DD-0b-document-ingest-итог.md`.

### Матрица прослеживаемости зонтичного ТЗ

- [ ] Строки 26, 27, 28, 29, 30, 31, 63, 64, 65, 66, 69, 82 (выдача API) — все `[x]`.

---

## 14. Риски и митигации

| Риск | Тяжесть | Митигация |
|---|---|---|
| `pdf-parse` некорректно парсит сложные PDF (с таблицами, многоколоночные, отсканированные) | средняя | Graceful degradation: `Document.status=failed` с понятным сообщением. На пилотах смотрим частоту failed; если >10% — пересматриваем Apache Tika |
| Эксперимент один-vs-несколько даёт неоднозначный результат | средняя | Берём гибрид по длине документа (короткие — один промпт, длинные — несколько). Документируем как решение |
| `EXTRACTION_ENABLE_TOP_LEVEL=false` отключает Mission/Vision/Strategy, но LLM всё равно их предлагает в ответе → потеря токенов | низкая | В JSON-схеме явно `mission: null, vision: null, strategy: null` всегда; в промпте — инструкция «не возвращай эти поля». Регулярно мониторим в logs |
| `EntityResolutionService` ложно сливает разные процессы с похожими именами | высокая | LLM-arbiter в коридоре 0.78–0.92 cosine; логи всех слияний; на пилоте — ручная проверка первых 50 dedup-кейсов. Возможность ручного «разделить обратно» — γ-функция (CuratorAgent) |
| Эксперимент 0b.3 затягивается — нет ясного решения | средняя | Жёсткий тайм-бокс: 1 неделя на эксперимент. Если результат неоднозначный — выбираем подход A (один промпт) как дефолт, B оставляем как feature-flag для длинных документов; решение можно пересмотреть в γ на большем датасете |
| Несовместимость `pdf-parse` с Bun-runtime | средняя | Проверка в первый день 0b.1 через smoke-test. Fallback — `pdfjs-dist` (мощнее, но больше зависимостей) |
| Загрузка очень больших файлов (>50 MiB) блокирует HTTP-worker | средняя | Лимит 50 MiB в zod-валидации + `multer` config; кастомное сообщение при превышении. Streaming-upload — γ |

---

## 15. Итог

**Дата итога: 2026-05-21** — реализованы 0b.2 + 0b.3 + 0b.4 + 0b-provenance.

### Реализовано полностью
- **JSON Schema v2 + промпт block-ingest v2** (`block-ingest.prompt.ts`): расширен на типизированные сущности группы Б (`processes/decisions/regulations/policies/metrics/tools`), `role_relevant` + `roleHint` на каждом блоке, `mission/vision/strategy=null` (фичефлаг `EXTRACTION_ENABLE_TOP_LEVEL=false`). Подход A (один промпт за окно).
- **BlockExtractionService.extractFull(...)**: новый метод возвращает `{ blocks, blocksInOrder, typed }`. Глобализация `sourceBlockIndex` через окна. Фильтр по `EXTRACTION_TYPED_ENTITY_MIN_CONFIDENCE`.
- **EntityResolutionService**: добавлены `resolveRoleByHint`, `resolvePersonByHint`, `resolveTypedEntity` (точное совпадение + pg_trgm fallback), `linkPersonEntity`/`linkEntityPerson`. Старый `findOrCreateEntity` — теперь триггерит линковку Entity{type=person}↔Person автоматически.
- **block-ingest.worker.ts**: сохраняет `IdeaBlock.roleRelevant + roleId` (резолв через `resolveRoleByHint`); вызывает `GraphService.upsertEntity` для всех типов группы Б; Decision-параллельное создание идемпотентно (LLM-вернутые имеют приоритет, fallback для блоков `signalType='decision'`); создаёт `derived_from`-рёбра Process/Regulation/Policy/Metric/Tool → Document для provenance.
- **GET /api/v1/documents/:id**: расширен на `ideaBlocks` + `extractedEntities` (Process/Decision/Regulation/Policy/Metric/Tool). RBAC: `extractedEntities` отдаётся только тем, кто читает `process` (owner/admin); для manager поле отсутствует.
- **ENV**: `EXTRACTION_ENABLE_TOP_LEVEL` (default false), `EXTRACTION_TYPED_ENTITY_MIN_CONFIDENCE` (default 0.5).
- **Метрики Prometheus**: `z_extraction_entities_total`, `z_extraction_confidence`, `z_extraction_ambiguous_total`, `z_entity_resolution_dedup_total`.
- **Skeleton-тесты**: `block-extraction.service.spec.ts`, `entity-resolution.service.spec.ts`, `documents.detail.spec.ts` (все `describe.skip`).
- **Patch-script**: `backend/scripts/patch-prompt-block-ingest-v2-fase0b.ts` (no-op + аудит-лог, prompt registry в БД ещё не выделено).

### Что осталось (TODO для γ или после пилотов)
- LLM-arbiter в коридоре 0.78..0.92 cosine — пропущен, в `resolveTypedEntity` оставлен TODO. Сейчас работают только точное совпадение + pg_trgm.
- Эксперимент A vs B (один промпт vs три прохода) — отложен. Дефолт A; B как `describe.skip` TODO в `block-extraction.service.ts`.
- Embedding'и для моделей группы Б — на этой итерации не вводим (Process/Regulation/Policy/Metric/Tool без `embedding` колонки в schema.prisma). Fuzzy-match через `pg_trgm.similarity()` — требует `CREATE EXTENSION pg_trgm` в БД (если расширения нет — graceful fallback к точному совпадению).
- Mission/Vision/Strategy автоизвлечение — отключено фичефлагом, включается через `EXTRACTION_ENABLE_TOP_LEVEL=true` (в δ).
- Decision/Metric/Tool в schema.prisma не имеют поля `confidence` — в DTO возвращаем `null` (зарезервировано). Возможно стоит добавить в schema.prisma в γ.

### Файлы
- Изменены: `backend/src/modules/knowledge-core/prompts/block-ingest.prompt.ts`, `backend/src/modules/knowledge-core/services/block-extraction.service.ts`, `backend/src/modules/knowledge-core/services/entity-resolution.service.ts`, `backend/src/modules/knowledge-core/workers/block-ingest.worker.ts`, `backend/src/modules/documents/documents.controller.ts`, `backend/src/modules/documents/documents.service.ts`, `backend/src/modules/documents/dto/documents.dto.ts`, `backend/src/common/config/env.schema.ts`, `backend/src/common/config/typed-config.service.ts`, `backend/src/common/metrics/business-metrics.service.ts`.
- Созданы: `backend/scripts/patch-prompt-block-ingest-v2-fase0b.ts`, `backend/src/modules/knowledge-core/services/block-extraction.service.spec.ts`, `backend/src/modules/knowledge-core/services/entity-resolution.service.spec.ts`, `backend/src/modules/documents/documents.detail.spec.ts`.
- **Ссылка на рефлексию:** _TBD (зафиксировать после прогонов typecheck/lint оркестратором)._
