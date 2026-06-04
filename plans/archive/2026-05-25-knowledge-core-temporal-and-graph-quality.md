---
type: tz
feature: knowledge-core-temporal-and-graph-quality
codename: Кора v3 / KC-Temporal
status: approved
created: 2026-05-25
updated: 2026-05-25
owner: @sergrv80
phases_total: 20 # 5 в волне 1 + 4 в волне 2 + 5 в волне 3 + 3 в волне 4 + 3 governance
depends_on:
  - second-brain/02_architecture/knowledge-core.md
  - plans/tz/2026-05-10-knowledge-core-tz.md (фундамент Фаз 0-4)
  - plans/tz/2026-05-22-final-roadmap.md (зонтичная Кора v2)
  - plans/tz/2026-05-25-clones-role-based-rebrand.md (ребрендинг клонов после решения владельца)
parent_analysis:
  - plans/analysis/2026-05-25-knowledge-core-ideal-target.md (тезисы, см. §0.1)
---

> 📦 **АРХИВ (аудит 2026-06-04): ✅ реализовано — 95%.**
> Зонтичное ТЗ реализовано фактически целиком: все 20 фаз (волны 1-4 + governance) подтверждены кодом — Prisma-поля, сервисы, воркеры/cron, скрипты backfill, ENV, промпты, golden-set, ADR-шаблон, policy-docs и 5 frontend-с
> ⚠️ Хвосты (см. реестр приоритетов): Поэтапное включение feature-флагов на проде (1 Org → 10 → все; shadow→enforce для W4) — операционный шаг деплоя, флаги п
> Полный разбор: `plans/analysis/2026-06-04-tz-audit-reestr-i-prioritety.md`


# ТЗ: knowledge-core — temporal model + graph quality (Кора v3)

> **Кодовое имя:** KC-Temporal.
> **Главная идея:** перевести knowledge-core из «снимка состояния» в **bitemporal timeline графа знаний** + закрыть техдолг резолвинга, доверия и обучения + закрыть compliance-дыру централизованным DataClassPolicy.
>
> **Что НЕ ломаем:** все существующие API, очереди и специалисты Слоя 3 продолжают работать. Все изменения — аддитивные (новые поля nullable, новые типы рёбер, новые ENV с safe-defaults).

---

## 0. Контекст

### 0.1 Источник тезисов

Это исполнительное ТЗ под 20 тезисов из обсуждения 2026-05-25 (пункты A-Е в чате). Тезисы 1-20 → сопоставление с фазами в §0.3.

### 0.2 Принципы

1. **Аддитивно, не разрушительно.** Старые блоки/связи не переписываются — получают backfill значения через one-off patch-script.
2. **Bitemporal с самого начала, не «потом добавим».** `validFrom`/`validUntil` + `recordedAt`/`supersededAt` — обе оси сразу. Иначе через 6 месяцев перепиливать в 10× больнее.
3. **Минимум новых LLM-задач.** Каждый новый `LlmTaskType` — это новая цепочка provider'ов, прайс, наблюдаемость. Не плодим.
4. **Каждая фаза кончается DoD + откатным флагом.** Любая фаза включается через ENV-флаг (default OFF в Волне 1, default ON только после регрессионного зелёного).
5. **prisma:push, не migrate.** Все изменения схемы через `bun run prisma:push` + opt patch-script под backfill. Правило `prisma-db-push-rules`.
6. **ENV — только через `TypedConfigService`.** Никаких `process.env.*` в коде.
7. **Тесты — обязательны.** vitest unit для сервисов, integration для воркеров, golden-set regression для промптов, property-based для DataClass policy.
8. **Shadow-mode для compliance-чувствительных изменений.** Сначала эмитим diff-метрику, неделя на сверку, потом enforce.
9. **Клоны в Z — ролевые, не персональные.** ExecutablePersona делается по должности («Клон Маркетолога v2»), не по сотруднику. Это влияет на DataClass-правила в W4 и на отдельный ТЗ ребрендинга. См. `plans/tz/2026-05-25-clones-role-based-rebrand.md`.

### 0.3 Матрица прослеживаемости (тезис → фаза)

| # | Тезис | Фаза |
|---|---|---|
| 1 | Bitemporal у каждого факта | **W1.1** Bitemporal fields |
| 2 | Generic supersede-арбитр | **W1.2** fact-supersede |
| 3 | Темпоральные рёбра в EntityLink | **W3.1** Rich edges (включает temporal на рёбрах) |
| 4 | Snapshot-запросы first-class | **W1.3** Snapshot API |
| 5 | Reified rich edges | **W3.1** Rich edges |
| 6 | Span-level provenance | **W1.4** Span evidence |
| 7 | Reasoning chains first-class | **W3.2** Reasoning chains |
| 8 | Counter-evidence в retrieval | **W3.3** Counter-evidence в Chat-v2 |
| 9 | KNN-резолвер на ingest'е | **W1.5** Ingest-time KNN resolver |
| 10 | Сильные идентификаторы | **W3.4** Strong IDs |
| 11 | Внешний реестр РФ | **ОТЛОЖЕНО** (решение владельца 2026-05-25 — справочник не нужен; «как услышали, так и записали»; вернёмся если возникнет реальная проблема) |
| 12 | Калиброванный confidence | **W2.2** Calibrated confidence |
| 13 | Preference dataset из mark_wrong | **W2.3** Preference dataset |
| 14 | Темпоральный probe | **W2.4** Temporal probe-trigger |
| 15 | ADR для новых signalType | **G.1** SignalType ADR |
| 16 | Markov-матрица переходов | **G.2** Transition matrix monitor |
| 17 | Golden-set + regression | **W2.1** Golden-set |
| 18 | UI «что система знает про X» | **G.3** Entity graph UI |
| 19 | Materialized projections с rebuild | **W3.5** Projection rebuild |
| 20 | Централизованный DataClass propagator | **W4.1** DataClassPolicyService + shadow → **W4.2** Enforce + audit-trail + backfill → **W4.3** Outbound gating (только каналы; LLM-провайдеры отложены) |

### 0.4 Волны

- **Волна 1 — фундамент темпоральности.** 5 фаз. Без них остальное косметика. **2-3 спринта.**
- **Волна 2 — доверие и обучение.** 4 фазы. Делает систему улучшающейся без героя. **1-2 спринта.**
- **Волна 3 — зрелость графа.** 5 фаз (без compliance, без внешнего реестра). **2 спринта.**
- **Волна 4 — compliance (DataClass).** 3 фазы. **Compliance-критика — приоритет выше большинства фаз Волны 3.** **2-3 спринта.**
- **Governance — параллельно с волнами.** 3 фазы.

---

## 1. Волна 1 — фундамент темпоральности

### W1.1 — Bitemporal fields на IdeaBlock и EntityLink

**Цель:** добавить две оси времени, без поломки существующих запросов.

**Prisma (`backend/prisma/schema.prisma`):**

```prisma
model IdeaBlock {
  // ... существующие поля
  validFrom      DateTime?       // когда факт был верен (default = evidence.sourceTimestamp ?? createdAt)
  validUntil     DateTime?       // когда факт перестал быть верен (null = до сих пор)
  recordedAt     DateTime        @default(now())  // когда система узнала
  supersededAt   DateTime?       // когда система пометила устаревшим
  supersededById String?         // → IdeaBlock.id (новый блок, который заменил)
  supersedes     IdeaBlock?      @relation("IdeaBlockSupersedes", fields: [supersededById], references: [id])
  supersedeChain IdeaBlock[]     @relation("IdeaBlockSupersedes")

  @@index([tenantId, validUntil])   // частые запросы «активные сейчас»
  @@index([tenantId, signalType, validUntil])
}

model EntityLink {
  // ... существующие поля
  validFrom    DateTime?
  validUntil   DateTime?
  recordedAt   DateTime @default(now())

  @@index([tenantId, validUntil])
}
```

**Enum расширение** `IdeaBlockLinkRelationType`: добавить `'supersedes'` (новый, 8-е значение). Это для пары «новый блок supersedes старый блок».

**ENV** (`backend/src/common/config/env.schema.ts`):
```
BITEMPORAL_FACT_SIGNAL_TYPES = "fact,commitment,commitment_status,plan_item,done_item,client_request"
BITEMPORAL_ENABLED = "false"   # глобальный kill-switch для всей Волны 1
```

Список из 6 типов зафиксирован решением 2026-05-25 (решение №1). Не включаем: `metric_change` (events, не state), `decision`/`regulation`/`process_step` (свои supersede-арбитры), `pain`/`risk`/`idea` (своя кластеризация), `reasoning`/`rationale` (обоснования), `task_*` (events tracker'а), `mood`/`drift` (субъективные состояния).

**Backfill script** `backend/scripts/patch-bitemporal-backfill.ts`:
- Идемпотентный (проверяет `validFrom IS NULL`).
- Batch 1000, для каждого блока:
  - `validFrom = COALESCE(min(IdeaBlockEvidence.sourceTimestamp), createdAt)`
  - `validUntil = null`
  - `recordedAt = createdAt`
- Прогресс-лог + dry-run флаг.

**Изменения в коде:**
- `block-ingest.worker.ts:persist()`: проставлять `validFrom` из evidence.
- `KnowledgeBlockResolver.getActive(tenantId, at?)` — новый хелпер: фильтр `validUntil IS NULL OR validUntil > $at`.
- Все search/graph эндпоинты по умолчанию фильтруют `validUntil IS NULL` если не передан `at`.

**DoD W1.1:**
- [ ] `bun run typecheck` зелёный.
- [ ] `prisma:push` применён локально + scratch DB.
- [ ] `patch-bitemporal-backfill.ts` выполняется на снапшоте prod-данных без ошибок.
- [ ] Unit-тест: `block-ingest.worker.spec.ts` проверяет проставление `validFrom`.
- [ ] Integration: search возвращает только `validUntil IS NULL` блоки при `BITEMPORAL_ENABLED=true`.
- [ ] Метрика `kc_facts_open_gauge{signal_type}` появилась в `/metrics`.

---

### W1.2 — Generic fact-supersede арбитр

**Цель:** при появлении нового factual-блока — найти существующий блок, который он закрывает, и пометить старый `validUntil=now`.

**Новый LLM-taskType** `fact-supersede-detect`:
- Provider chain: DeepSeek-flash → gpt-5.4-mini → Ollama qwen3:30b.
- JSON Schema strict: `{ verdict: 'unrelated'|'extends'|'contradicts'|'supersedes', targetBlockId?: string, reason: string, confidence: number }`.
- Контекст: новый блок + top-5 KNN candidates с цитатами.
- Промпт: `backend/src/modules/knowledge-core/prompts/fact-supersede-detect.prompt.ts`.

**Сервис** `FactSupersedeService` (`backend/src/modules/knowledge-core/services/fact-supersede.service.ts`):
```ts
async processNewBlock(blockId: string): Promise<{ verdict, targetId?, applied: boolean }>
```
Логика:
1. Загрузить блок. Если `signalType ∉ BITEMPORAL_FACT_SIGNAL_TYPES` → skip.
2. KNN top-5 cosine по `IdeaBlock.embedding`, фильтр: same tenant + same signalType + `validUntil IS NULL` + `id ≠ self`. Threshold `FACT_SUPERSEDE_COSINE_THRESHOLD=0.85`.
3. Если кандидатов 0 → skip.
4. LLM `fact-supersede-detect` с этими 5.
5. Применение:
   - `unrelated` / `extends` → ничего.
   - `contradicts` → создать `IdeaBlockLink(relationType='contradicts')`, не закрывать.
   - `supersedes` → транзакция:
     - `old.validUntil = now()`, `old.supersededAt = now()`, `old.supersededById = new.id`.
     - `IdeaBlockLink(relationType='supersedes', from=new, to=old)`.
     - `ConflictService.report({resourceType:'idea_block', relationType:'supersedes', evidence:{suggestedResolution:'evolving'}})`.

**Hook:** `block-distill.worker.ts` — после `apply()` canonical-блока, если `BITEMPORAL_ENABLED && BITEMPORAL_SUPERSEDE_ENABLED`, вызвать `FactSupersedeService.processNewBlock(blockId)` (best-effort).

**ENV:**
```
BITEMPORAL_SUPERSEDE_ENABLED = "false"
FACT_SUPERSEDE_COSINE_THRESHOLD = "0.85"
FACT_SUPERSEDE_KNN_TOP_K = "5"
FACT_SUPERSEDE_COST_ALERT_PCT = "5"   # alert при росте AiUsageLog.totalCostUsd для taskType=fact-supersede-detect > 5% за неделю
```

**Метрики:**
- `kc_fact_supersede_verdicts_total{verdict}` (counter).
- `kc_fact_supersede_latency_ms` (histogram).

**Алерт (решение №2):** прирост AI-биллинга по `fact-supersede-detect` > 5% за неделю → page on-call. Прогноз: ~$0.07/Org/мес на компании со 100 встречами — это меньше 1% типичного бюджета. 5% — запас.

**DoD W1.2:**
- [ ] Промпт + JSON Schema валидируется на 10 ручных примерах (раздел `services/fact-supersede.service.spec.ts`).
- [ ] При `supersedes` — старый блок закрыт, новый связан, `ConflictItem` создан.
- [ ] Race-condition тест: два параллельных processNewBlock на один и тот же target — только один applied.
- [ ] Метрики снимаются в Grafana.
- [ ] Prometheus alert rule `fact_supersede_cost_spike` настроен.

---

### W1.3 — Snapshot API

**Цель:** ответ на «что мы знали про X на дату T».

**Endpoint** `GET /api/v1/knowledge/snapshot`:
- Query: `at: ISO8601, entityId?: string, signalTypes?: SignalType[], limit?: number (default 100, max 500)`.
- Auth: тот же RBAC что у `/knowledge/search` (member of Org).
- Response:
  ```ts
  {
    asOf: ISO,
    blocks: Array<{ block, evidence[], entities[] }>,
    entityLinks: Array<{ from, to, type, validFrom, validUntil }>,
    truncated: boolean,
    tookMs: number
  }
  ```
- SQL: `WHERE validFrom <= $at AND (validUntil IS NULL OR validUntil > $at)`.

**Сервис:** `SnapshotService` в `api/snapshot.controller.ts` + `api/snapshot.service.ts`.

**DoD W1.3:**
- [ ] Контрактный тест: `snapshot(at=now)` ≡ `search` без temporal-фильтра.
- [ ] `snapshot(at=block.createdAt - 1s)` НЕ возвращает блок.
- [ ] OpenAPI/Swagger обновлён.

---

### W1.4 — Span-level evidence

**Цель:** знать, какое именно слово в цитате дало конкретное property блока.

**Prisma** — IdeaBlock получает `propertySpans Json?`:
```ts
type PropertySpan = {
  field: 'name' | 'criticalQuestion' | 'trustedAnswer' | 'mentionedEntity';
  refId?: string;          // entityId если field='mentionedEntity'
  evidenceId: string;      // → IdeaBlockEvidence.id
  startMs: number;
  endMs: number;
};
type PropertySpans = PropertySpan[];
```

**LLM-промпт block-ingest** — расширить JSON Schema опциональным полем `mentionedEntities[].sourceSpan: { startMs, endMs }`. Если LLM не вернул — skip (best-effort).

**block-ingest.worker.ts** — при persist маппит LLM-output в `propertySpans`.

**Frontend hook:** при клике на entity-чип в карточке блока — прыжок плеера на `propertySpan.startMs`. Это в `frontend/src/ui/knowledge/BlockCard.tsx`.

**DoD W1.4:**
- [ ] LLM-промпт возвращает `propertySpans` хотя бы у 60% блоков на golden-set.
- [ ] UI: клик на чип сущности → плеер прыгает на нужную секунду.
- [ ] Отсутствие `propertySpans` не ломает рендер.

---

### W1.5 — Ingest-time KNN resolver

**Цель:** не плодить дубликаты сущностей, не дожидаясь `entity-resolver.cron` (5 мин окно).

**Изменения в `EntityResolutionService.findOrCreateEntity`:**

```
1. Exact match: SELECT по (tenantId, type, lower(canonicalName))  — raw SQL вместо findMany+filter
2. Если не найден:
   2.1. Embed name → vec
   2.2. KNN cosine top-3 по Entity.embedding, фильтр tenantId+type+mergedIntoId IS NULL
        threshold ENTITY_INGEST_RESOLVE_THRESHOLD=0.95 (выше чем 0.88 у асинхронного worker'а)
   2.3. Если best > 0.95 → merge без LLM (короткое замыкание)
   2.4. Иначе → create + enqueue entity-resolver для глубокого LLM-арбитра
3. Cache (Redis): key=`entity-resolve:${tenantId}:${type}:${sha1(lowerName)}`, TTL 1h
```

**Замена `findMany + filter in memory`** — pgvector raw SQL:
```sql
SELECT id, embedding <=> $1 AS distance
FROM "Entity"
WHERE "tenantId" = $2 AND "type" = $3 AND "mergedIntoId" IS NULL
ORDER BY distance ASC
LIMIT 3
```

**ENV:**
```
ENTITY_INGEST_RESOLVE_THRESHOLD = "0.95"
ENTITY_INGEST_RESOLVE_CACHE_TTL_S = "3600"
```

**Метрики:**
- `kc_entity_resolve_path_total{path}` — exact / knn / create.
- `kc_entity_resolve_latency_ms` — histogram.

**DoD W1.5:**
- [ ] На golden-set дубликаты сущностей за 24ч после ingest'а упали на ≥ 50%.
- [ ] p95 `findOrCreateEntity` ≤ 80ms (сейчас, по докладу из knowledge-core.md, деградирует на больших тенантах).
- [ ] Cache hit rate ≥ 60% на горячих сущностях.

---

## 2. Волна 2 — доверие и обучение

### W2.1 — Golden-set + regression

**Цель:** ни одно изменение промпта в knowledge-core не уходит без автоматической проверки качества.

**Структура:**
```
backend/tests/golden/knowledge-core/
  meetings/
    001-sales-call.json        # RawEvent + segments
    002-team-standup.json
    ...
  expected/
    001-sales-call.expected.json   # ожидаемые блоки, сущности, signalType, key fields
    ...
  fixtures/
    golden.config.ts             # пороги, версия, метаданные
```

**Минимум:** 50 размеченных встреч (далее накапливать до 200-300).

**Метрики качества:**
- `signalType F1` — макро-F1 по 55 значениям, минимум 0.7.
- `entity recall@10` — какая доля ожидаемых entities извлеклась, минимум 0.85.
- `block name similarity` — cosine между предсказанным и ожидаемым `name` (embedding), минимум 0.8.
- `top-3 search hit rate` — на 30 эталонных запросах, минимум 0.8.

**vitest suite:** `backend/tests/golden/knowledge-core/golden.spec.ts`.
- Запускает `BlockExtractionService.extract(segment)` на каждом example.
- Сравнивает с expected.
- Печатает метрики + fail если ниже порога.

**Команды:**
```
bun run golden:knowledge-core         # запуск
bun run golden:knowledge-core:update  # перегенерировать expected (после ручной проверки)
```

**CI hook:** запуск на PR при изменении `backend/src/modules/knowledge-core/prompts/**` или `backend/src/modules/knowledge-core/services/block-extraction.service.ts`.

**DoD W2.1:**
- [ ] 50 эталонных встреч размечены.
- [ ] Suite зелёная на текущей версии промптов (baseline).
- [ ] CI блокирует merge при падении F1 ниже порога.
- [ ] Документ `docs/benchmarks/knowledge-core-baseline.md` с цифрами.

---

### W2.2 — Calibrated confidence

**Цель:** перейти с сырых LLM-confidence на калиброванные через golden-set.

**Prisma:** добавить nullable поля в `IdeaBlock`, `Decision`, `Insight`, `SkillTrait`, `Idea`, `Regulation`, `Process`, `Policy`:
```prisma
calibratedConfidence Decimal? @db.Decimal(4, 3)
```

**Сервис** `ConfidenceCalibrationService`:
- Параметры калибровки хранятся в `AdminSetting` `confidence_calibration:<taskType>` — Platt scaling `{ a: number, b: number }`.
- `calibrate(rawConfidence: number, taskType: string): number` → `sigmoid(a * raw + b)`.
- Cron `weekly` (`0 4 * * 0`):
  - На golden-set + curated_correct/curated_wrong считает оптимальные `a, b` для каждого taskType.
  - Сохраняет.
  - Метрика `kc_confidence_calibration_loss{task_type}` — Brier score.

**Переключение в triage:**
- `CurationService.triage()` использует `calibratedConfidence ?? confidence`.
- Все пороги (0.75, 0.85) — описаны в ENV, изначально без изменений.

**ENV:**
```
CONFIDENCE_CALIBRATION_ENABLED = "false"   # default OFF, включаем когда есть >100 curated примеров
CONFIDENCE_CALIBRATION_CRON = "0 4 * * 0"
```

**DoD W2.2:**
- [ ] Поля добавлены, prisma:push применён.
- [ ] Cron отрабатывает на dev-данных, метрика снимается.
- [ ] При `_ENABLED=false` — поведение неотличимо от текущего (regression).

---

### W2.3 — Preference dataset

**Цель:** каждое исправление пользователя (mark wrong) → датасет для улучшения промптов.

**Prisma — новая модель:**
```prisma
model LlmPreferenceSample {
  id            String   @id @default(cuid())
  tenantId      String
  taskType      String   // 'block-ingest' | 'decision-extract' | 'skill-trait-detect' | ...
  inputContext  Json     // segment / block / kandidates — то что было на входе LLM
  modelOutput   Json     // что LLM вернул
  label         String   // 'correct' | 'wrong' | 'misleading' | 'partially_correct'
  reason        String?  @db.Text
  recordedBy    String   // userId
  decisionId    String?  // → CurationDecision.id
  createdAt     DateTime @default(now())

  @@index([tenantId, taskType, createdAt])
}
```

**Сервис** `PreferenceDatasetService`:
- `@OnEvent('curation.decision_recorded')` listener.
- Если `decisionType IN ('mark_as_misleading', 'rejected', 'rolled_back', 'approved')` — сохраняет sample.
- Для `approved` — label `'correct'` (positive examples тоже нужны).

**Admin endpoint** `GET /api/v1/admin/llm/preference-dataset?taskType=...&label=...&from=...&to=...`:
- Owner/super_admin only.
- Возвращает JSONL для скачивания.

**UI:** `/admin/llm/preference-dataset` — таблица + фильтры + кнопка «Export JSONL».

**Метрики:**
- `kc_preference_samples_total{task_type, label}` (counter).

**DoD W2.3:**
- [ ] Event listener подключён, сэмплы появляются.
- [ ] Export JSONL валидный (по 1 строке на сэмпл).
- [ ] Документ `docs/llm/preference-loop.md` — как retraining'ить few-shot из этих данных.

---

### W2.4 — Темпоральный probe-trigger

**Цель:** активно дочищать факты, которые давно никто не подтверждал.

**Probe-trigger** `temporal.fact_stale_contradiction`:
- Cron `0 7 * * 1` (понедельник 7:00).
- Для каждой Org:
  - Найти блоки с `signalType ∈ BITEMPORAL_FACT_SIGNAL_TYPES`, `validUntil IS NULL`, `validFrom < now - 90д`, **и** найти другой блок с `validFrom > now - 30д` про ту же entity (через IdeaBlockEntity overlap ≥ 1 entity с role='subject').
  - Если расхождение — `ProbeService.suggest({eventType: 'specialist.probe', reason: 'temporal.fact_stale_contradiction', suggestedQuestion: '<X> — раньше было A, сейчас B, что верно?'})`.
- Лимит `TEMPORAL_PROBE_LIMIT_PER_ORG=50` probe на Org за проход (решение №4).
- Эскалация: если probe не отвечен `TEMPORAL_PROBE_ESCALATE_AFTER_WEEKS=2` — escalate owner'у через in_app (отдельный канал).

**Сервис:** `TemporalProbeService.runDailyChecks()`.

**ENV:**
```
TEMPORAL_PROBE_CRON = "0 7 * * 1"
TEMPORAL_PROBE_LIMIT_PER_ORG = "50"
TEMPORAL_PROBE_ESCALATE_AFTER_WEEKS = "2"
```

**DoD W2.4:**
- [ ] Probe запускается, сэмплы из dev-данных проходят дедуп.
- [ ] Ответ пользователя через ConversationalService → создаёт новый RawEvent → новый блок → петля замыкается (integration test).
- [ ] Эскалация через 2 недели — integration test.

---

## 3. Волна 3 — зрелость графа

### W3.1 — Rich edges на EntityLink

**Цель:** ребро как сущность с атрибутами, а не голый `(from, to, type)`.

**Prisma — расширение `EntityLink`:**
```prisma
model EntityLink {
  // ... существующие
  validFrom    DateTime?
  validUntil   DateTime?
  attributes   Json?       // { role?, share?, intensity?, otherTypedFields }
  sourceBlockIds String[]  // если ещё не было — добавить, GIN-индекс
  confidence   Decimal     @db.Decimal(4, 3)  // уже есть
}
```

**LLM `entity-graph-builder`** — расширить JSON Schema:
- Опциональные `validFromHint`, `validUntilHint` (как ISO-даты или null).
- Опциональный `attributes: Record<string, string | number>`.

**Сервис `EntityLinkService.upsertRichEdge(...)`** — заменяет прямые `prisma.entityLink.create/update`.

**DoD W3.1:**
- [ ] `works_at` рёбра с `since` извлекаются на golden-set хотя бы в 30% случаев.
- [ ] Старые рёбра (без attributes) рендерятся без ошибок.

---

### W3.2 — Reasoning chains first-class

**Цель:** при ответе Chat-v2 видеть цепочку `decision ← rationale ← факты`.

**Сервис** `ReasoningChainService`:
```ts
buildChain(blockId: string, maxDepth=3): { nodes: BlockSummary[], edges: LinkSummary[] }
```
BFS по `IdeaBlockLink.relationType ∈ ['consequences_of', 'causes', 'develops', 'question_answered_by']`.

**API:** `GET /api/v1/knowledge/blocks/:id/reasoning-chain?depth=1..3`.

**Hook в Chat-v2:** в `chat-v2-retrieval.service.ts:assembleContext()` — для top-3 source-блоков вызвать `buildChain(depth=2)`, прикрепить в контекст с тегом `[REASONING CHAIN]`.

**UI:** для визуализации цепочек обоснований использовать **React Flow** (блок-схема со стрелками — это её сильная сторона).

**DoD W3.2:**
- [ ] На вопрос «почему мы выбрали X» citations включают цепочку.
- [ ] p95 latency Chat-v2 не вырос > 100ms.

---

### W3.3 — Counter-evidence в Chat-v2

**Цель:** не выдавать уверенный ответ при наличии противоречий.

**Изменения `chat-v2-retrieval.service.ts`:**
- После hybrid search получаем top-N блоков.
- Для каждого: `IdeaBlockLink WHERE relationType='contradicts' AND (fromBlockId=X OR toBlockId=X) AND status='active'`.
- Подмешать contradicting блоки в контекст с тегом `[CONTRADICTING]`.

**Промпт chat-v2-respond:** добавить инструкцию:
> Если в контексте есть блоки с тегом [CONTRADICTING] — обязательно скажи про конфликт, не игнорируй; предложи пользователю уточнить.

**Метрика:**
- `chat_v2_contradicting_blocks_in_context{tenant}` (histogram).

**DoD W3.3:**
- [ ] На 5 эталонных «противоречивых» вопросах ответы Chat-v2 содержат явное указание на конфликт.

---

### W3.4 — Strong IDs (выделенные идентификаторы)

**Цель:** дедуп через ИНН / email / домен — без LLM. **Только внутри Org** (без внешнего справочника — решение №3).

**Prisma — расширение `Entity`:**
```prisma
model Entity {
  // ... существующие
  inn       String?   // для customer, vendor
  ogrn      String?   // для customer, vendor
  email     String?   // для person
  phone     String?   // для person
  domain    String?   // для customer, vendor, product

  @@unique([tenantId, type, inn], map: "Entity_strong_inn_uniq")
  @@unique([tenantId, type, email], map: "Entity_strong_email_uniq")
  @@unique([tenantId, type, domain], map: "Entity_strong_domain_uniq")
}
```
Все unique — partial (`WHERE field IS NOT NULL`) через raw SQL в `postgres-init.sql`:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS "Entity_strong_inn_uniq"
  ON "Entity" ("tenantId", "type", "inn") WHERE "inn" IS NOT NULL;
-- аналогично email, domain, ogrn, phone
```

**EntityResolutionService.findOrCreateEntity:** перед exact-name match — попытка по `inn / ogrn / email / domain` если переданы.

**Backfill** `backend/scripts/patch-extract-strong-ids.ts`:
- Идёт по существующим `Entity.metadata` JSON, выдёргивает `inn`/`email`/etc → в выделенные поля.

**DoD W3.4:**
- [ ] При создании сущности с тем же `inn` — старая возвращается, mergeMetadata + mentionsCount++.
- [ ] Patch отработал на снапшоте prod-данных.

> **Что НЕ делаем здесь:** внешний справочник публичных компаний (ЕГРЮЛ/Dadata) — отложено по решению владельца 2026-05-25. Если в будущем возникнет проблема кросс-Org дедупа — вернёмся отдельным ТЗ.

---

### W3.5 — Materialized projections с rebuild

**Цель:** при изменении IdeaBlock — Decision/Insight/Card, которые на нём построены, пересобираются.

**Event:** `idea_block.updated` / `idea_block.merged` — emit из `block-distill.worker` и `entity-resolver.worker`.

**Сервис `ProjectionRebuilderService`:**
- `@OnEvent('idea_block.updated')` — найти все Decision/Insight/Idea/Card/Regulation/Process/Policy с `blockId ∈ sourceBlockIds`.
- Для каждого — re-enqueue соответствующий специалист (`core.specialist-routing` job).
- Debounce 5 минут (BullMQ jobId).

**Метрики:**
- `kc_projection_rebuild_total{type}`.
- `kc_projection_rebuild_lag_ms` — от события до завершения.

**DoD W3.5:**
- [ ] Изменение блока (через admin UI или patch) → Decision пересобирается в течение 6 минут.
- [ ] Нет infinite-loop (rebuild → block-update → rebuild).

---

## 4. Волна 4 — compliance (DataClassPolicy)

> **Compliance-критика.** Сейчас правила «max(block.dataClass, 'internal')» раскиданы по 9 специалистам, два разных хелпера (`elevateDataClass`, `maxDataClass`) и десяток мест с голым `block.dataClass`. Защиты от утечки `sensitive` через outbound-каналы — нет. Единственный слой, который проверяется глазами.

### Глобальные определения волны

**4 уровня DataClass (документированная семантика):**

| Уровень | Кто видит | Примеры |
|---|---|---|
| `public` | любой (вне Org тоже) | публичный лендинг, согласованные кейсы клиентов |
| `internal` | любой member Org | большая часть встреч, регламенты, общие метрики, **клоны ролей** |
| `sensitive` | определённые роли (owner/admin/+roles по теме) | стратегия, финансы, увольнения, переговорные позиции |
| `private` | только subject-Person + owner/super_admin | персональные данные о конкретном человеке (медицинское, переписки 1:1) |

**Lattice:** `public < internal < sensitive < private` по уровню ограничения. `private` несёт дополнительный атрибут `subjectPersonId`. Два `private` про разных людей не сливаются (результат `private` с `subjectPersonId=null`).

**Floor per `kind` (default правила v1):**

| kind результата | floor | особое правило |
|---|---|---|
| `idea_block` | как у источника | специальный путь — это сам источник |
| `insight` | `internal` | ≥1 источник `private` → `sensitive` (агрегация анонимизирует) |
| `decision` | `internal` | то же |
| `card_rollup` | `internal` | `kind='deal'`/`vendor'` с финансовыми источниками → `sensitive` |
| `executable_persona` (Клон Роли) | **`internal`** | клон ролевой = рабочий артефакт, как должностная инструкция (решение №6) |
| `skill_profile` (служебный, не на UI) | `internal` | per-Person profile — внутренняя структура; на UI не показывается |
| `skill_trait` | `internal` | при `mark_as_misleading` — Curation event получает `sensitive` |
| `chat_context` | max от source pool | mode `clone_style` → минимум `internal` (т.к. клон ролевой) |
| `ai_usage_log` | max от input + output | важно: log пишется ПОСЛЕ derive, не до |
| `conflict_item` | max от участников | evolving + решение admin'а → `sensitive` |

> **Изменение vs предыдущая версия ТЗ:** `knowledge_profile` (раньше floor=`sensitive`/`private` для не-сотрудников) переименован в `executable_persona` + `skill_profile`. Floor у обоих = `internal`, потому что клон делается на роль, не на человека (решение №6 от 2026-05-25). Подробности в `plans/tz/2026-05-25-clones-role-based-rebrand.md`.

**LLM-провайдеры по DataClass:** в этой версии ТЗ — **без ограничений** (решение №8: «пока всё можно отправлять, отдельно решу»). Поле `LlmProvider.maxDataClass` не добавляем. Когда будет принято решение — отдельной фазой.

---

### W4.1 — DataClassPolicyService + shadow mode

**Цель:** ввести один сервис с явными правилами, развернуть в shadow-режиме без изменения текущего поведения.

**Файлы:**
- `backend/src/modules/knowledge-core/services/dataclass-policy.service.ts` (новый).
- `backend/src/modules/knowledge-core/services/dataclass-policy.service.spec.ts` (новый, через `fast-check`).
- `backend/src/modules/knowledge-core/services/dataclass-policy.types.ts` — `DerivedKind`, `DataClassAudit`, `DataClassSource`.
- Регистрация в `knowledge-core.module.ts`.
- `docs/policies/dataclass-policy-v1.md` — все правила, lattice, floors, examples.

**API сервиса:**

```ts
type DerivedKind =
  | 'idea_block' | 'insight' | 'decision' | 'card_rollup'
  | 'executable_persona' | 'skill_profile' | 'skill_trait'
  | 'idea' | 'regulation' | 'process' | 'policy'
  | 'chat_context' | 'ai_usage_log' | 'conflict_item' | 'probe_event';

type DataClassSource = {
  dataClass: DataClass;
  subjectPersonId?: string | null;
  sourceId: string;
  sourceKind: 'idea_block' | 'decision' | 'insight' | 'card' | ...;
};

type DataClassAudit = {
  sourceIds: string[];
  sourceKind: string;
  inputClasses: DataClass[];
  floorApplied: DataClass;
  rule: string;          // 'max-and-floor' | 'private-aggregation-to-sensitive' | ...
  result: DataClass;
  resultSubjectPersonId: string | null;
  derivedAt: string;     // ISO
  policyVersion: string; // 'v1'
};

@Injectable()
export class DataClassPolicyService {
  derive(args: {
    sources: DataClassSource[];
    context: { kind: DerivedKind; explicitFloor?: DataClass };
  }): { dataClass: DataClass; subjectPersonId: string | null; audit: DataClassAudit };

  canEmit(args: {
    payloadDataClass: DataClass;
    payloadSubjectPersonId?: string | null;
    sink: SinkConfig;
  }): { allowed: boolean; reason?: string };

  getFloor(kind: DerivedKind): Promise<DataClass>;

  /** Shadow comparison — для миграции. */
  compareWithLegacy(args: {
    legacyResult: DataClass;
    proposedResult: DataClass;
    kind: DerivedKind;
    sourceIds: string[];
  }): void;  // эмитит kc_dataclass_shadow_diff_total и пишет в log при расхождении
}
```

**Shadow integration в 9 специалистах:** рядом с существующим расчётом — вызов сервиса и эмит метрики, **без изменения реального поведения**.

**ENV:**
```
DATACLASS_POLICY_ENFORCEMENT = "shadow"    # off | shadow | enforce
DATACLASS_POLICY_VERSION = "v1"
```

**Метрики:**
- `kc_dataclass_shadow_diff_total{kind, legacy, proposed}` (counter).
- `kc_dataclass_derived_total{kind, level}` (counter).
- `kc_dataclass_floor_lifted_total{kind, source_level, result_level}` (counter).

**Property-based тесты** (минимум 6):
- Идемпотентность: `derive([s], k).dataClass >= s.dataClass`.
- Монотонность: `derive([a, b], k) >= max(derive([a], k), derive([b], k))`.
- Sensitive не утекает: ≥1 sensitive в sources → result ∈ {sensitive, private}.
- Private aggregation: ≥1 private + kind ∈ {insight, decision} → result = sensitive, subjectPersonId=null.
- Floor executable_persona/skill_profile: всегда ≥ internal.
- canEmit reject: sink.maxDataClass=internal + payload=sensitive → allowed=false.

**DoD W4.1:**
- [ ] Сервис + типы созданы, зарегистрированы в module.
- [ ] Property-based spec зелёный (минимум 6 инвариантов выше).
- [ ] Все 9 специалистов + chat-v2 вызывают `compareWithLegacy` в shadow.
- [ ] Метрика `kc_dataclass_shadow_diff_total` собирается ≥ 1 неделя на dev/staging.
- [ ] Документ `docs/policies/dataclass-policy-v1.md` опубликован.
- [ ] Реальное поведение НЕ изменилось (regression test).

---

### W4.2 — Enforce + audit-trail + backfill

**Цель:** переключить на `derive` как источник истины + записать audit-trail на каждой проекции.

**Предусловие:** W4.1 в shadow ≥ 1 неделя, расхождения проанализированы. Если расхождение > 1% — корректировка правил v1 → v1.1 ДО переключения.

**Prisma — audit-trail поля:**
```prisma
model Insight           { dataClassAudit Json? }
model Decision          { dataClassAudit Json? }
model Card              { dataClassAudit Json? }
model SkillTrait        { dataClassAudit Json? }
model SkillProfile      { dataClassAudit Json? }
model ExecutablePersona { dataClassAudit Json? }
model Idea              { dataClassAudit Json? }
model Regulation        { dataClassAudit Json? }
model Process           { dataClassAudit Json? }
model Policy            { dataClassAudit Json? }
model ConflictItem      { dataClassAudit Json? }
model AiUsageLog        { dataClassAudit Json? }
model ProbeEvent        { dataClassAudit Json? }
```

**Refactor:** заменить **все** вхождения:
- `block.dataClass` (как назначение результата) → `this.policy.derive([block], {kind: '...'}).dataClass`.
- `this.elevateDataClass(block.dataClass, 'internal')` → `this.policy.derive([block], {kind: 'insight'}).dataClass`.
- `maxDataClass(blocks.map(b => b.dataClass))` → `this.policy.derive(blocks, {kind: 'chat_context'}).dataClass`.

И **обязательно записывать** `dataClassAudit` рядом с `dataClass` на persist'е.

**Backfill** `backend/scripts/patch-backfill-dataclass-audit.ts`:
- Идемпотентный (skip если `dataClassAudit IS NOT NULL`).
- Для каждой проекции: восстановить `sourceBlockIds[]` → загрузить блоки → `policy.derive(blocks, {kind})` → сохранить `dataClass` (если расходится — пометить в логе, не менять реальное значение) + `dataClassAudit` с `policyVersion='backfill_v1'`.
- Batch 500, dry-run флаг.

**ENV:**
```
DATACLASS_POLICY_ENFORCEMENT = "enforce"     # после shadow ≥ 1 неделя
DATACLASS_AUDIT_REQUIRED = "true"            # фейлить persist если audit отсутствует
```

**Метрики:**
- `kc_dataclass_audit_present_ratio{kind}` (gauge) — % проекций с заполненным audit. Цель 1.0.
- `kc_dataclass_policy_version_drift{orgId}` (gauge) — сколько проекций живёт с `policyVersion` старее текущего.

**DoD W4.2:**
- [ ] Prisma поля добавлены, `prisma:push` применён.
- [ ] Все вхождения refactor'ены (поиск `dataClass` в knowledge-core не находит legacy паттернов).
- [ ] `elevateDataClass` и `maxDataClass` удалены.
- [ ] Patch отработал на снапшоте prod-данных.
- [ ] `kc_dataclass_audit_present_ratio = 1.0` для новых записей.
- [ ] Property-based тесты + integration тесты зелёные.
- [ ] Документ `docs/policies/dataclass-policy-v1.md` обновлён: «enforced since YYYY-MM-DD».

---

### W4.3 — Outbound gating каналов + ChannelBinding.maxDataClass + UI

**Цель:** запретить отправку `sensitive` / `private` через каналы, которые их видеть не должны. **Только каналы доставки**; LLM-провайдеры в этой версии ТЗ не gating'уются.

**Prisma:**
```prisma
model ChannelBinding {
  // existing
  maxDataClass DataClass @default(internal)
}

model IssueWebhook {
  // existing
  allowedDataClasses DataClass[]   // если пусто — defaults к ['public', 'internal']
}
```

**Sinks с обязательным `canEmit`:**

| Sink | Точка вызова | Конфиг |
|---|---|---|
| In-app / Telegram DM / Email | `ConversationalService.sendNotification` | `ChannelBinding.maxDataClass` (recipient) |
| Webhook outbound (tracker, AI workspace) | `IssueWebhookDispatcher.send` | `IssueWebhook.allowedDataClasses` |
| Export endpoints | `/admin/llm/preference-dataset?...` и аналогичные | роль (owner only) + всегда reject `private` |
| Public API / public share | `/api/public/*` | только `public` |

**Поведение при reject:**
- Не отправлять.
- `kc_dataclass_violation_blocked_total{sink, requested, max_allowed}` инкремент.
- Лог-запись `ChannelEmitDenied` с `payloadId`, `sink`, `requested`, `recipientUserId`.
- Fallback на `in_app` при reject (если sink Conversational): in_app всегда `private`-tolerant по default.
- Если fallback тоже невозможен → log в `ProbeEvent.status='dropped_dataclass_gate'`.

**UI:**

- `/me/channels` — у каждого пользовательского канала «макс. чувствительность» (radio). Default `internal`.
  - Подсказка: «Канал может получать сообщения только этого уровня и ниже».
  - Чек-бокс «Разрешить sensitive (стратегия, финансы)» с предупреждением (решение №7).
  - `private` — никогда (выбор недоступен).

- `/admin/policy/dataclass` — owner/super_admin only.
  - Таблица floors per `kind` (read-only с возможностью override через AdminSetting).
  - Таблица каналов: какой `channelKind` какой `maxDataClass` допускает по умолчанию.
  - История нарушений (`kc_dataclass_violation_blocked_total` за 7 дней) — для аудита.

**AdminSetting tunables:**
```yaml
# AdminSetting key='dataclass_policy:floors'
insight: internal
decision: internal
executable_persona: internal
skill_profile: internal
skill_trait: internal
card_rollup: internal

# AdminSetting key='dataclass_policy:channel_defaults'
in_app: private
telegram_dm: internal          # default; пользователь может opt-in до sensitive (решение №7)
telegram_group: public         # group — никогда не sensitive
email: sensitive               # СМТП внутри РФ-провайдеров — норм
public_link: public
```

**Backfill** `backend/scripts/patch-channel-binding-defaults.ts`:
- Для всех existing `ChannelBinding` — выставить `maxDataClass='internal'`.
- Для `IssueWebhook` — `allowedDataClasses=['public', 'internal']`.

**Метрики:**
- `kc_dataclass_violation_blocked_total{sink, requested, max_allowed}` (counter) — **алерт > 0 за 5 мин**.
- `kc_dataclass_canEmit_latency_ms` (histogram).

**Документ:** `docs/policies/outbound-gating-runbook.md` — как разбирать violation-инцидент.

**DoD W4.3:**
- [ ] `ChannelBinding.maxDataClass` поле добавлено, backfill применён.
- [ ] `canEmit` интегрирован в 4 sink'а (см. таблицу).
- [ ] UI `/me/channels` и `/admin/policy/dataclass` работают на dev.
- [ ] Integration test: попытка отправить `sensitive` через канал с `maxDataClass='internal'` → блокировка + метрика + лог.
- [ ] Алерт `kc_dataclass_violation_blocked_total > 0` настроен в Grafana, page on-call.
- [ ] Runbook опубликован.

---

## 5. Governance (параллельно с волнами)

### G.1 — ADR для signalType / EntityType / relationType

**Цель:** перестать плодить enum-значения без процесса.

**Template** `docs/adr/template-signal-type.md`:
```
# ADR-NNN: SignalType <name>

Status: proposed | accepted | rejected | superseded

## Контекст
Зачем нужен этот signalType?

## Решение
Имя, семантика, разделение с похожими.

## Примеры (5 минимум)
| Текст | Это [name]? | Если нет — какой signalType |
|---|---|---|

## Снапшот-тест
`tests/snapshot/signal-type-discrimination.spec.ts` обновлён.
```

**CI hook:** `.github/workflows/signal-type-adr-check.yml` (или pre-commit):
- При изменении `SIGNAL_TYPE_VALUES` в `block-ingest.prompt.ts` — проверить, что в PR есть файл `docs/adr/NNN-signal-type-*.md`.

**DoD G.1:**
- [ ] Template создан.
- [ ] Один существующий signalType описан как «эталон» (`reasoning` или `task_status_changed`).
- [ ] CI блокирует PR без ADR при изменении enum.

---

### G.2 — Markov-матрица переходов signalType

**Цель:** sanity-check classifier'а через распределение пар.

**Cron** `signal-type-stats.cron` (`0 2 * * *`):
- Для каждой Org за последние 30д:
  - Группировка canonical IdeaBlock по `rawEventId`, сортировка по `createdAt`.
  - Подсчёт пар `(signalType_i, signalType_{i+1})` → матрица.
  - Сохранение в `AdminSetting` key `signal_type_transition_matrix:<orgId>`.
- Gauge `kc_signal_type_distribution{signal_type, org_id}` — за 7д.

**Alert** (Prometheus rule):
- `abs(today_share - 30d_avg_share) > 3 * stddev` для любого signalType → warn.

**UI:** `/admin/llm/signal-type-monitor` — heatmap матрицы + распределение по org'ам.

**DoD G.2:**
- [ ] Cron отрабатывает на dev-данных.
- [ ] Heatmap рендерится.
- [ ] Alert триггерится при искусственно сломанном распределении (integration test).

---

### G.3 — UI «что система знает про X» с правкой

**Цель:** доверие масштабируется только когда видна причина.

**Frontend:** новая страница `/entities/[id]/graph`:
- **Библиотека: `react-force-graph` в 2D-режиме** (решение №5; та же библиотека, что использована для главной «Карты мозга» — см. `plans/archive/2026-05-22-second-brain-visualization.md`). Один движок графов в продукте.
- Центр — текущая entity. Соседи на depth 1-2.
- Rich edges: тип, период (если есть), confidence (цвет), hover — quote из evidence.
- Клик на ребро → панель «как мы это узнали» (top-3 source blocks + цитаты).
- Кнопка «Это неверно» на каждом ребре и узле → `CurationService.recordDecision({decisionType:'mark_as_misleading'})` → попадает в Preference dataset (W2.3).

**Зависимости:**
```json
"react-force-graph-2d": "^1.x"
"d3-force": "^3.x"
```

**Backend API:**
- `GET /api/v1/knowledge/entities/:id/graph?depth=1..3` — расширение существующего `/graph/neighbors`:
  - Включает rich-edge metadata (validFrom/Until, attributes, confidence).
  - Включает top-3 evidence per edge.
- `POST /api/v1/knowledge/entities/:id/mark-wrong` (proxy в Curation).

**DoD G.3:**
- [ ] Страница открывается для existing entity.
- [ ] Mark-wrong записывается, сэмпл попадает в `LlmPreferenceSample`.
- [ ] p95 рендера для entity со 100 соседями ≤ 2с.

---

## 6. Что НЕ делаем

- **Не заводим Neo4j / Apache AGE.** pgvector + явные таблицы рёбер хватает.
- **Не плодим новых специалистов Слоя 3.** Прирост ценности — в глубине существующих 9 (3-1..3-9).
- **Не делаем «umbrella LLM-агент» поверх RouterService.** Статический mapping signalType → specialist остаётся.
- **Не переписываем существующие специалисты под Decision-style supersede.** Generic `fact-supersede` работает отдельно, специалист-specific остаются.
- **Не делаем 2-way OAuth-синк календаря / Crossmark в рамках этого ТЗ** — это другой план.
- **Не вводим 5-й уровень DataClass.** 4 хватает.
- **Не делаем Postgres RLS** (Row-Level Security). `dataClass` — это policy layer, RBAC + `visibilityMode` — это access layer.
- **Не делаем PII detection как часть DataClassPolicy.** Это отдельный модуль; DataClassPolicy — это **propagation**, не **classification**.
- **Не делаем cross-org анонимизированную агрегацию** — отдельная политика в другом плане.

### Решения 2026-05-25 владельца, которые ОТЛОЖЕНЫ:

- **Внешний справочник публичных компаний (ЕГРЮЛ / Dadata)** — отложено (решение №3). Если в будущем будет реальная проблема — вернёмся.
- **LLM-провайдеры с фильтром по DataClass** (`LlmProvider.maxDataClass`) — отложено (решение №8). Сейчас все провайдеры могут получать все уровни данных. Владелец решит отдельно.
- **Self-view собственного клона** (`/me/clone`) — отменено (решение №6). Клоны теперь ролевые. См. `plans/tz/2026-05-25-clones-role-based-rebrand.md`.
- **DSAR-флоу для клонов** — не нужен (клоны не персональные данные). Для исходных IdeaBlock с PII — отдельная задача в будущем.

---

## 7. Глобальные ENV (сводка)

```
# Волна 1
BITEMPORAL_ENABLED = "false"
BITEMPORAL_SUPERSEDE_ENABLED = "false"
BITEMPORAL_FACT_SIGNAL_TYPES = "fact,commitment,commitment_status,plan_item,done_item,client_request"
FACT_SUPERSEDE_COSINE_THRESHOLD = "0.85"
FACT_SUPERSEDE_KNN_TOP_K = "5"
FACT_SUPERSEDE_COST_ALERT_PCT = "5"
ENTITY_INGEST_RESOLVE_THRESHOLD = "0.95"
ENTITY_INGEST_RESOLVE_CACHE_TTL_S = "3600"

# Волна 2
CONFIDENCE_CALIBRATION_ENABLED = "false"
CONFIDENCE_CALIBRATION_CRON = "0 4 * * 0"
TEMPORAL_PROBE_CRON = "0 7 * * 1"
TEMPORAL_PROBE_LIMIT_PER_ORG = "50"
TEMPORAL_PROBE_ESCALATE_AFTER_WEEKS = "2"

# Волна 3
PROJECTION_REBUILD_DEBOUNCE_MS = "300000"

# Волна 4 (compliance)
DATACLASS_POLICY_ENFORCEMENT = "shadow"   # off | shadow | enforce
DATACLASS_POLICY_VERSION = "v1"
DATACLASS_AUDIT_REQUIRED = "true"         # фейлить persist если audit отсутствует (после enforce)

# Governance
SIGNAL_TYPE_STATS_CRON = "0 2 * * *"
SIGNAL_TYPE_DRIFT_SIGMA_THRESHOLD = "3.0"
```

Все читаются через `cfg.knowledgeCore.*` и `cfg.dataClassPolicy.*` в `TypedConfigService`. Дефолты в `env.schema.ts`.

---

## 8. Глобальные метрики (сводка)

| Метрика | Тип | Где |
|---|---|---|
| `kc_facts_open_gauge{signal_type}` | gauge | block-ingest |
| `kc_fact_supersede_verdicts_total{verdict}` | counter | fact-supersede |
| `kc_fact_supersede_latency_ms` | histogram | fact-supersede |
| `kc_snapshot_request_latency_ms` | histogram | snapshot API |
| `kc_entity_resolve_path_total{path}` | counter | entity-resolution |
| `kc_entity_resolve_latency_ms` | histogram | entity-resolution |
| `kc_confidence_calibration_loss{task_type}` | gauge | calibration cron |
| `kc_preference_samples_total{task_type, label}` | counter | preference |
| `kc_projection_rebuild_total{type}` | counter | projection rebuilder |
| `kc_projection_rebuild_lag_ms` | histogram | projection rebuilder |
| `kc_signal_type_distribution{signal_type, org_id}` | gauge | signal-type-stats |
| `chat_v2_contradicting_blocks_in_context` | histogram | chat-v2 retrieval |
| `kc_dataclass_shadow_diff_total{kind, legacy, proposed}` | counter | W4.1 shadow |
| `kc_dataclass_derived_total{kind, level}` | counter | W4.1/4.2 derive |
| `kc_dataclass_floor_lifted_total{kind, source_level, result_level}` | counter | W4.1/4.2 derive |
| `kc_dataclass_audit_present_ratio{kind}` | gauge | W4.2 audit |
| `kc_dataclass_policy_version_drift{orgId}` | gauge | W4.2 audit |
| `kc_dataclass_violation_blocked_total{sink, requested, max_allowed}` | counter | **W4.3 — alert > 0 / 5 min** |
| `kc_dataclass_canEmit_latency_ms` | histogram | W4.3 |

---

## 9. Риски и rollback

| Риск | Митигация |
|---|---|
| Bitemporal-fields ломают существующие запросы | Все запросы по умолчанию фильтруют `validUntil IS NULL` — поведение **идентично** старому. Флаг `BITEMPORAL_ENABLED=false` отключает supersede. |
| `fact-supersede-detect` слишком агрессивно закрывает живые факты | Threshold 0.85 + LLM-арбитр с 4 verdicts. Audit-log + UI «откатить supersede». |
| Strong-ID unique constraints упадут на грязных данных | Partial unique `WHERE field IS NOT NULL`. Patch-script проверяет дубликаты до создания constraint'а. |
| KNN-резолвер на ingest'е добавит latency | KNN-cache (Redis, TTL 1ч). Кэп p95 ≤ 80ms. |
| LLM `fact-supersede-detect` — новая цена | Цепочка 3 provider'ов. Метрика `ai_usage_log.totalCostUsd` — алерт при росте > 5% от baseline. |
| **W4.1 shadow меняет реальное поведение** | По дизайну shadow ничего не пишет — только сравнивает и эмитит метрику. Регрессионный тест проверяет идентичность. |
| **W4.2 enforce понижает `dataClass` где-то** | Property-based `sensitive не утекает` гарантирует невозможность. Plus shadow-неделя обязана показать ноль таких расхождений. |
| **W4.3 ломает существующие notifications** | `ChannelBinding.maxDataClass` default `internal` (current behavior). Fallback на in_app при reject. Алерт на любой blocked > 0. |

**Rollback каждой волны:** через ENV-флаг (default OFF / shadow). Backfill-скрипты идемпотентные.

**Rollback W4 особо:**
- W4.1 → откат: `DATACLASS_POLICY_ENFORCEMENT=off`. Сервис не дёргается.
- W4.2 → откат: `DATACLASS_POLICY_ENFORCEMENT=shadow`. Legacy-логика возвращается через feature-flag в каждом специалисте (оставить в коде до конца W4.3 + 2 недели prod-наблюдения).
- W4.3 → откат: `canEmit` всегда возвращает `allowed=true` (через ENV `DATACLASS_OUTBOUND_GATING_ENABLED=false`).

---

## 10. Зависимости между фазами

```
W1.1 (bitemporal fields) ─┬─ W1.2 (fact-supersede)
                          ├─ W1.3 (snapshot API)
                          └─ W2.4 (temporal probe)

W1.5 (KNN resolver) ─── W3.4 (strong IDs)

W2.1 (golden-set) ─┬─ W2.2 (calibrated confidence)
                   └─ G.1 (signal-type ADR snapshot tests)

W2.3 (preference) ─── G.3 (entity graph UI mark-wrong)

W3.5 (projection rebuild) — независима

W4.1 (DataClass shadow) ─── W4.2 (enforce + audit) ─── W4.3 (outbound gating)
   ↑ зависит только от property-based test infra — может стартовать сразу

G.2 (markov matrix) — независима
```

**Можно параллелить:** W1.1+W1.4 (модель данных), W2.1 (golden-set готовится фоном), G.1 (документация), **W4.1 (DataClass shadow — на ранних спринтах)**.

**Нельзя параллелить:** W1.2 не запускается без W1.1, W2.2 без W2.1, W4.2 без W4.1 + неделя shadow, W4.3 без W4.2.

---

## 11. Фазовый roadmap (черновая оценка)

| Спринт | Фазы |
|---|---|
| **S1 (2 нед)** | W1.1 + W1.4 + старт W2.1 (разметка golden-set) + G.1 template + **W4.1 (DataClassPolicy shadow)** |
| **S2 (2 нед)** | W1.2 + W1.3 + W1.5 + завершение W2.1 + **анализ W4.1 shadow-diff** |
| **S3 (2 нед)** | W2.2 + W2.3 + W2.4 + G.2 + **W4.2 (enforce + audit-trail + backfill)** |
| **S4 (2 нед)** | W3.1 + W3.2 + W3.3 + **W4.3 (outbound gating + ChannelBinding + UI)** |
| **S5 (2 нед)** | W3.4 + W3.5 + G.3 + buffer |

Итого: **~10 недель / 5 спринтов** до полной раскатки (вместо 6 — один спринт сэкономлен убранными W3.5 и W3.7 предыдущей версии).

После S2 — система уже bitemporal, можно демонстрировать «снимок графа на дату».
После S3 — система начинает себя улучшать без героя **+ compliance enforce включён**.
После S4 — outbound gating защищает от утечек.

**W4 идёт «волной впереди» по приоритету:** compliance-критика важнее части Волны 3.

---

## 12. Definition of Done (зонтичный)

- [ ] Все 20 фаз закрыты по своим DoD.
- [ ] `bun run typecheck` + `bun run lint` + `bun run test:unit` + `bun run test:integration` зелёные.
- [ ] `bun run golden:knowledge-core` зелёный на baseline-порогах.
- [ ] Property-based suite `dataclass-policy.service.spec.ts` зелёный (≥ 6 инвариантов).
- [ ] `kc_dataclass_audit_present_ratio = 1.0` на новых записях ≥ 30 дней.
- [ ] `kc_dataclass_violation_blocked_total` мониторится, ни одного unexplained инцидента за 30 дней.
- [ ] `second-brain/02_architecture/knowledge-core.md` обновлён (раздел «Bitemporal model»).
- [ ] `second-brain/02_architecture/data-model.md` обновлён (новые поля + LlmPreferenceSample + dataClassAudit).
- [ ] `docs/policies/dataclass-policy-v1.md` + `docs/policies/outbound-gating-runbook.md` опубликованы.
- [ ] Прод-инструкция в чате при финальном push.

---

## 13. Прод-операции (сводка для деплоя)

После каждого спринта:
```
# 1. БД-схема
cd backend && bun run prisma:push && bun run prisma:generate

# 2. Backfill (одноразово, после prisma:push на каждой соотв. фазе)
bun run scripts/patch-bitemporal-backfill.ts              # после W1.1
bun run scripts/patch-extract-strong-ids.ts               # после W3.4
bun run scripts/patch-backfill-dataclass-audit.ts         # после W4.2
bun run scripts/patch-channel-binding-defaults.ts         # после W4.3

# 3. Postgres extras (после W3.4 — strong-id partial unique индексы)
bun run apply-postgres-init

# 4. Bootstrap LLM-routes для новых taskType
bun run scripts/seed-llm-task-routes-temporal.ts          # после W1.2

# 5. ENV обновить в .env, проверить через TypedConfigService
# 6. Перезапустить backend + workers
docker compose up -d --build backend
docker compose up -d --build worker

# 7. Включить feature-флаги поэтапно
# Сначала на 1 тестовом Org, потом 10, потом всех.
# Для W4: shadow → анализ метрики kc_dataclass_shadow_diff_total ≥ 1 неделя → enforce.
```

---

## 14. Решения по 8 открытым вопросам (зафиксированы 2026-05-25)

| № | Вопрос | Решение |
|---|---|---|
| 1 | Список `BITEMPORAL_FACT_SIGNAL_TYPES` | 6 типов: `fact`, `commitment`, `commitment_status`, `plan_item`, `done_item`, `client_request`. Остальные не включаем (см. W1.1). |
| 2 | Допустимый прирост AI-биллинга от `fact-supersede-detect` | Лимит **5%**. Прогноз: ~0.07$/Org/мес (<1% baseline). Алерт при превышении (см. W1.2). |
| 3 | Внешний справочник компаний | **Отложено.** Не делаем. Если возникнет проблема — вернёмся. Strong IDs (W3.4) остаются — для дедупа внутри Org. |
| 4 | Темпоральный probe — частота | **Раз в неделю**, понедельник 7:00. Лимит 50 probe на Org. Эскалация owner'у через 2 недели без ответа (см. W2.4). |
| 5 | Библиотека графа для G.3 | **react-force-graph (2D)**. Та же библиотека, что для «Карты мозга» из `plans/archive/2026-05-22-second-brain-visualization.md`. React Flow — только для блок-схем процессов / reasoning chains (W3.2). |
| 6 | Floor для профиля знаний | **`internal`.** Клоны ролевые (не персональные) — рабочий артефакт компании. UI отдельным ТЗ: `plans/tz/2026-05-25-clones-role-based-rebrand.md`. |
| 7 | `telegram_dm.maxDataClass` | **Default `internal`**, opt-in до `sensitive` с предупреждением, `private` — никогда (см. W4.3). |
| 8 | LLM-провайдеры — фильтр по DataClass | **Отложено.** В этой версии ТЗ — без ограничений. Решит владелец отдельно. |

---

_Это исполнительное ТЗ. Для каждой фазы при старте — отдельный sub-ТЗ файл `plans/tz/2026-05-25-kc-temporal-W{N}.{M}-{slug}.md` с детализацией до уровня файлов и тестов. Зонтик остаётся источником истины по составу и зависимостям._
