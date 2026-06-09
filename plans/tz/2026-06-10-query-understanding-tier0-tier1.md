---
type: tz
status: ready-to-implement
feature: query-understanding-tier0-tier1
date: 2026-06-10
owner: sergrv80 (владелец)
relates_to:
  - plans/analysis/2026-06-09-query-understanding-and-temporal-retrieval/98-best-solution-agentic-orchestration.md
  - plans/analysis/2026-06-09-query-understanding-and-temporal-retrieval/99-synthesis.md
---

> Анализ: `plans/analysis/2026-06-09-query-understanding-and-temporal-retrieval/` (98 §7 — финальная рекомендация после red-team; 99 — синтез). · Статус согласования: 2026-06-10 (решения владельца делегированы автору ТЗ, см. раздел «Принятые решения»).

## Принцип
ТЗ — программный контракт. Реализатор не должен ни переспрашивать, ни угадывать, ни «оптимизировать по-своему». Все развилки закрыты ниже. Язык кода/комментариев — как в окружении; UI/ответы пользователю — русский.

Фича делает разговорный AI-чат Коры способным понимать **структуру** запроса (время, тип, сущность, отдел/тема, «я») и применять её как **recall-safe фильтр** поверх существующего графа — вместо чистого смыслового сходства. Это Волна 1 (Tier 0 + Tier 1). Оркестратор и grounded-аналитик — отдельные ТЗ (см. «Дальнейшие волны»).

---

## Цель + Зачем
**Болезненное состояние (по коду, `verified`):** chat-v2 retrieval ранжирует только по cosine (`chat-v2-retrieval.service.ts:419-429` — `ORDER BY b.embedding <=> qvec LIMIT`), а dialog-layer извлекает только `intent` как метрику (`query-classifier.service.ts:35-42,238`). Время/тип/отдел/сущность из текста не извлекаются и в retrieval не применяются. Поэтому «что мы решали по маркетингу на этой неделе?» молча деградирует: слова «решали / маркетинг / на этой неделе» уходят в эмбеддинг, фильтра нет — может вернуться решение трёхмесячной давности по другому отделу.

**Зачем чинить:** темпорально-структурный запрос — table-stakes (его уже делают зарубеж и РФ-конкуренты МТС Линк, Яндекс Алиса Про — см. 99-synthesis §3). Тихая ошибка для не-разработчика (CEO примет правдоподобное неверное число за правду) дороже, чем для dev-инструмента.

**Метрика «решено»:** на проверочном наборе бытовых запросов (раздел Acceptance Фазы 5) — ноль «тихих» темпоральных/типовых ошибок: запрос с периодом/типом возвращает только блоки, удовлетворяющие фильтру, либо честное «в памяти нет».

**Чем решение лучше (research-цитаты, 99-synthesis §4, §12):**
- Recall-safe фильтрация доказана: жёсткий pre-filter на HNSW роняет recall (`[verified` dev.to/franckpachot 2026]); полный скан с combined-score над WHERE-фильтрованным множеством — нет (`SearchService.runHybridQuery` уже так делает, `search.service.ts:245-246`).
- Понимание-запроса-в-структуру — паттерн SelfQuery/Instructor (`[verified` useinstructor 2026, LangChain self_query), с инъекцией текущей даты.

---

## REALITY-CHECK (фактическое состояние по коду)
| Что | Факт | Где |
|---|---|---|
| dialog-layer pipeline | Есть: contextualize → confidence → classify → multi-query. `DialogService.process` возвращает `{enabled, standaloneQuestion, intent, queries[], confidence, cachedAnswer, steps}` | `dialog-layer/services/dialog.service.ts:87-188` |
| Извлечение структуры из текста | ❌ Нет. classify даёт только `intent` (7 категорий) + confidence | `query-classifier.service.ts:97-107,238-245` |
| Резолвер относительного времени («эта неделя») | ❌ Нет нигде в пути запроса; зависимости chrono/dayjs/luxon в бэкенде нет | (греп пуст) |
| chat-v2 retrieval | Семантика top-K (HNSW) + 1-hop граф; темпоральный фильтр — только `validAt` (lte, point-in-time, из явного `asOf`) | `chat-v2-retrieval.service.ts:125-198,408-454` |
| Фасетный фильтр (signalType/entity/date) | ✅ Уже реализован в `/search` (SearchService), recall-safe полный скан; **чат его не зовёт** | `knowledge-core/api/search.service.ts:166-281` |
| Ось даты в `/search` | `IdeaBlockEvidence.sourceTimestamp` (EXISTS) | `search.service.ts:229-240` |
| bi-temporal «активные сейчас» | `b."validUntil" IS NULL` (готовый предикат в `/search`) | `search.service.ts:209-211` |
| Тема/отдел | `Theme.branch` (enum `ThemeBranch`, индекс `@@index([tenantId, branch])`); связь `ThemeIdeaBlock(themeId, blockId)` | `schema.prisma:793-806,4110-4158` |
| departmentId у IdeaBlock | ❌ Нет (привязка к отделу только косвенная через Theme.branch) | `schema.prisma` IdeaBlock |
| taskType регистрация | Два места: union `LlmTaskType` (`llm-router.service.ts:192-201`) И массив `ALL_LLM_TASK_TYPES` (`:647-651`). **Грабля:** добавить только в union → попадёт в DEFAULT-цепочку (потеряно 3 taskType, [[project_llm_tasktypes_missing_from_registry]]) | `llm-router.service.ts` |
| ENV/флаг dialog-layer | Паттерн: `DIALOG_LAYER_ENABLED: zBool(true)` (`env.schema.ts:1318`) + getter `typed-config.service.ts:1683` | — |

**Вывод REALITY-CHECK:** Tier 1 — это «подключить готовое»: фасетный фильтр уже написан и recall-safe в `/search`; нужно перенести его предикаты в chat-v2 retrieval-путь и кормить их структурой из нового Tier 0. departmentId не добавляем — фильтр отдела идёт через `Theme.branch`.

---

## Принятые решения владельца (НЕ пересматривать)
| # | Решение | Обоснование (Почему) |
|---|---|---|
| Р1 | Scope = Волна 1: Tier 0 (понимание→структура+роутер) + Tier 1 (recall-safe структурный фильтр). Оркестратор и grounded-аналитик — отдельные ТЗ. | red-team (98 §7): оркестратор в горячем чате = минуты латентности + переписка транспорта + флаг-сирота; не паковать в «всё-сразу». |
| Р2 | Понимание = **один** LLM-вызов (intent+слоты вместе), `taskType=dialog-extract-plan`. | Экономия токенов; меньше точек отказа. |
| Р3 | Recall-safe = **фильтрованный полный скан с combined-score** (перенести паттерн `SearchService.runHybridQuery`), а НЕ HNSW-проба и НЕ overfetch+post-filter. | `search.service.ts:245-246`: полный скан с точным фильтром НЕ роняет recall. Org-pool у Z ≤ тысяч блоков (`chat-v2-retrieval.service.ts:213` take:5000) → полный скан дёшев. Проще и надёжнее post-filter-гимнастики. **Уточняет «overfetch+post-filter» из устной договорённости — после чтения `/search` найден лучший, уже доказанный в нашем коде, путь.** |
| Р4 | Фильтр-измерения Волны 1: `dateRange` (по `IdeaBlockEvidence.sourceTimestamp`) + `signalTypes` + `entityIds` + `themeBranches` (через `ThemeIdeaBlock`+`Theme.branch`). departmentId на IdeaBlock НЕ добавлять. | Все оси уже хранятся и проиндексированы; departmentId потребовал бы миграцию+backfill без доказанной нужды. |
| Р5 | Ось даты для фильтра = `IdeaBlockEvidence.sourceTimestamp` (когда факт прозвучал), не `createdAt`. | Совпадает с `/search`; «на этой неделе» = когда событие произошло, а не когда внесли в граф. |
| Р6 | Низкий confidence / невалидный JSON / парс не удался → **fail-open** в текущий смысловой путь без фильтров. Пустой фильтрованный pool → честное «в памяти нет». | Никогда не хуже сегодняшнего; цена тихой ошибки для не-разработчика максимальна. |
| Р7 | «я/мой/мне» → `personId` спрашивающего **из сессии** (userId→Person), НЕ из текста. | top-K смешает обязательства всех; first-person требует user-scoped резолюции (99-synthesis критик). |
| Р8 | Флаг `QUERY_PLAN_EXTRACTION_ENABLED` — **kill-switch (ON по умолчанию)**, строка в `docs/operations/feature-flags.md`. Никаких «OFF→понаблюдаем». | Ship-On (CLAUDE.md §8, [[feedback_ship_on_flags]]). |
| Р9 | Промпт `dialog-extract-plan` — редактируемый из админки (prompt registry) с code-fallback; primary-модель `deepseek-v4-flash`. | [[feedback_admin_settings_not_env_or_code]]; дешёвая модель для служебного шага ([[feedback_ollama_tertiary_only_deepseek_flash_cheap]]). |

---

## Доказательство выбора (два прохода + challenge)

**Проход A (под текущий код):** новый extract-plan агент в dialog-layer + перенос фасетных предикатов `/search` в chat-v2 retrieval; фильтрованный путь = полный скан combined-score, нефильтрованный = текущий HNSW.

**Проход B (альтернатива — overfetch+post-filter в TS):** оставить HNSW top-K, но взять `limit*5` и резать по дате/типу в TS-коде после выборки.

| Критерий | A: фильтрованный полный скан (реком.) | B: overfetch + post-filter в TS |
|---|---|---|
| Recall на узком окне | ✅ полный скан — фильтр не режет recall (`search.service.ts:245`) | ⚠️ при узком окне в overfetch может не хватить попаданий → добор/повтор |
| Переиспользование кода | ✅ донор `runHybridQuery` готов | ✗ новая логика порога/добора |
| Цена | ✅ скан ≤тысяч строк дёшев (org-pool capped) | ⚠️ overfetch ×5 эмбеддингов в память + ранжирование в TS |
| Сложность | средняя (1 ветка SQL) | средняя+ (порог, добор, edge-cases пустого) |
| Корректность дат | ✅ как `/search`, sourceTimestamp в SQL | ⚠️ дата-парс блоков в TS, разнобой осей |

**Выбор A.** Challenge-loop:
- *Корень, не симптом?* Да — чинит весь КЛАСС структурных запросов (время/тип/сущность/тема), не только дату.
- *Самое эффективное?* Да — переиспользует доказанный recall-safe путь; не плодит post-filter-инфраструктуру. Преждевременной оптимизации нет: iterative scan/partition (pgvector ≥0.8.0) отложены с числовым триггером «при org-pool > 50k блоков».
- *Код ради кода?* Нет — extract-plan новый (нужен), retrieval-ветка переиспользует `runHybridQuery`-предикаты.

**Развилка «как достаётся отдел из вопроса»:** LLM в extract-plan возвращает `themeBranches[]` из фиксированного enum `ThemeBranch` (маппинг «маркетинг»→`marketing` и т.д. в промпте) — не свободный текст. Фильтр join'ит `ThemeIdeaBlock`→`Theme.branch IN (...)`. Доказано: enum мал (12 значений), индекс `@@index([tenantId, branch])` есть.

---

## Scope

### Входит
1. **Tier 0** — агент `dialog-extract-plan`: один LLM-вызов извлекает `QueryPlan`; детерминированный резолвер периода; person-резолюция «я»→personId; fail-open; интеграция в `DialogService.process`.
2. **Проброс** `QueryPlan.filters` через `DialogProcessResult → SynthesisInput → ChatV2Input → RetrievalInput`.
3. **Tier 1** — фильтрованный recall-safe ретрив в `ChatV2RetrievalService` (полный скан combined-score с предикатами date/signalType/entity/themeBranch + bitemporalActiveOnly), при наличии хотя бы одного фильтра; без фильтров — текущий путь без регрессии.
4. **«В памяти нет»** — честный ответ при пустом фильтрованном pool.
5. **Флаг** `QUERY_PLAN_EXTRACTION_ENABLED` (kill-switch) + регистрация taskType + admin-prompt.

### Не входит (→ Дальнейшие волны)
- Подключение оркестратора SBA δ-1 к чату → отдельное ТЗ (кнопка «Глубокий разбор», де-сиротизация флага, тесты латентность/падения/стоимость, Ship-On).
- grounded-специалист-аналитик («агент-маркетолог анализирует+действие») → отдельное ТЗ (факты+цитаты+анти-выдумка; НЕ ExecutablePersona).
- salience-scorer «что важного пропустил» + проактивный recap → отдельная волна.
- text-to-SQL агрегации «сколько/самый» → отдельная волна (каталог Postgres-агрегатов).
- iterative scan / partial index / партиции pgvector → fast-follow, триггер «org-pool > 50k canonical блоков».

---

## Граничные контракты с другими ТЗ / системами
- **Не трогать** `OrchestratorService` и его флаг — Волна 1 его не касается.
- **Переиспользовать как донор, не рефакторить** `SearchService.runHybridQuery` (`search.service.ts:166-281`) — копируем паттерн предикатов в retrieval-метод; сам `/search` не меняем.
- **knowledge-access (Ф4)** — фильтры компонуются с существующим `accessWhere`; не ослаблять access-предикаты.

---

## Контракт-first (дословные сниппеты)

### К-1. Новый taskType (ДВА места регистрации)
`backend/src/modules/ai/services/llm-router.service.ts` — в union `LlmTaskType` рядом с `'dialog-multi-query'` (~:195):
```ts
  | 'dialog-extract-plan'
```
И в массив `ALL_LLM_TASK_TYPES` рядом с `'dialog-multi-query'` (~:650):
```ts
  'dialog-extract-plan',
```
> ⚠️ Обе точки обязательны (грабля [[project_llm_tasktypes_missing_from_registry]]: union без массива → DEFAULT-цепочка). Номера строк — на момент написания; перед правкой перечитать, якорь — соседняя строка `'dialog-multi-query'`.

Route на `deepseek-v4-flash` — через prompt/route registry (как у прочих `dialog-*`); если seed нужен — `backend/scripts/seed-*` зарегистрировать в `apply-prod-deploy.ts STEPS`.

### К-2. QueryPlan (выход Tier 0)
Новый файл `backend/src/modules/dialog-layer/services/query-plan-extractor.service.ts`:
```ts
export interface QueryPlanFilters {
  dateFrom: Date | null;
  dateTo: Date | null;
  signalTypes: string[];          // подмножество enum SignalType
  themeBranches: string[];        // подмножество enum ThemeBranch
  entityHints: string[];          // canonicalName-подсказки (резолв в entityIds на Фазе 3)
  personScope: boolean;           // true = «я/мой» → personId спрашивающего
  aggregation: boolean;           // true = «сколько/сумма» (в Волне 1 НЕ обрабатывается, только метрика)
  needsAction: boolean;           // true = «предложи действие» (Волна 1 НЕ обрабатывает)
}
export interface QueryPlanResult {
  filters: QueryPlanFilters;
  confidence: number;             // 0..1 от LLM
  applied: boolean;               // false = fail-open (нет фильтров / низкий confidence)
  durationSeconds: number;
}
```

### К-3. Промпт extract-plan (cache-friendly)
Новый файл `backend/src/modules/dialog-layer/prompts/extract-plan.prompt.ts` — по образцу `classify.prompt.ts`:
- `EXTRACT_PLAN_SYSTEM_PROMPT` — **стабильный** (правила границ периода «эта неделя = пн–вс», «вчера», «прошлый месяц»; enum signalTypes с маппингом «решали→decision», «дела/задачи→task_created,task_completed,commitment,plan_item», «риски→risk,churn_risk», «блокеры→blocker»; enum ThemeBranch с «маркетинг→marketing» и т.д.; правило «если оси нет — верни пусто/null»).
- `EXTRACT_PLAN_JSON_SCHEMA` — strict JSON, поля как в `QueryPlanFilters` + `confidence`.
- `buildExtractPlanUserPrompt({ question, todayIso, orgTimezone })` → **переменная часть**:
```ts
return `Сегодня: ${todayIso}. Таймзона компании: ${orgTimezone}.\nВопрос: ${question}\n\nПлан:`;
```
> Дата — в user-части (меняется ежедневно), не в SYSTEM → SYSTEM кэшируется (hit ≈99% внутридневно). Раздел «Совместимость с prompt caching» ниже.

### К-4. Расширение RetrievalInput
`backend/src/modules/knowledge-core/services/chat-v2-retrieval.service.ts` — в `interface RetrievalInput` (:25-45) добавить опциональные:
```ts
  dateFrom?: Date | null;
  dateTo?: Date | null;
  signalTypes?: string[];
  entityIds?: string[];
  themeBranches?: string[];
  bitemporalActiveOnly?: boolean;
```

### К-5. Фильтрованный ретрив (перенос предикатов `/search`)
В `ChatV2RetrievalService`: если задан хотя бы один из {dateFrom,dateTo,signalTypes,entityIds,themeBranches} → ранжировать **полным сканом combined-score** (не HNSW LIMIT). Предикаты — как `search.service.ts:203-240` + новый themeBranch:
```sql
-- date (Р5):
EXISTS (SELECT 1 FROM "IdeaBlockEvidence" ev WHERE ev."blockId" = b.id
        AND ev."sourceTimestamp" >= $dateFrom AND ev."sourceTimestamp" <= $dateTo)
-- signalType:
b."signalType"::text IN ($s1,$s2,...)
-- entity:
EXISTS (SELECT 1 FROM "IdeaBlockEntity" be WHERE be."blockId" = b.id AND be."entityId" IN (...))
-- themeBranch (НОВОЕ):
EXISTS (SELECT 1 FROM "ThemeIdeaBlock" tib JOIN "Theme" t ON t.id = tib."themeId"
        WHERE tib."blockId" = b.id AND t."tenantId" = $tenant AND t.branch::text IN (...))
-- bitemporalActiveOnly (опц.):
b."validUntil" IS NULL
ORDER BY combined_score DESC LIMIT $limit
```
Параметры — только через массив (`$queryRawUnsafe` + `pushParam`), как в `runHybridQuery`. Без фильтров → ветка `rankByCosineOrRecency` (:398-454) без изменений (R9).

### К-6. ENV-флаг (kill-switch)
`backend/src/common/config/env.schema.ts` рядом с `DIALOG_LAYER_ENABLED` (:1318):
```ts
  QUERY_PLAN_EXTRACTION_ENABLED: zBool(true),
```
Геттер в `typed-config.service.ts` (в `get dialogLayer()`, :1683):
```ts
      queryPlanExtractionEnabled: this.get('QUERY_PLAN_EXTRACTION_ENABLED'),
```
Строка в `docs/operations/feature-flags.md`: тип «kill-switch», состояние ON.

---

## Границы фичи
- ✅ Always: fail-open в смысловой путь при любой ошибке/низком confidence; tenantId во всех запросах; ответы пользователю на русском.
- ⚠️ Ask first: добавление нового `signalType`/`ThemeBranch`; любая миграция Prisma; изменение `/search` или оркестратора.
- 🚫 Never: жёсткий `WHERE ... ORDER BY embedding <=> qvec LIMIT` (HNSW-проба) с фильтром (роняет recall); `process.env.*` в коде; `new PrismaClient()`; дата в стабильном SYSTEM-промпте (ломает кэш).

---

## Требования (R1…R14)
- **R1.** Когда пользователь задаёт вопрос в chat-v2 и `QUERY_PLAN_EXTRACTION_ENABLED=true`, система shall за один вызов `dialog-extract-plan` извлечь `QueryPlanFilters`+`confidence`.
- **R2.** SYSTEM extract-plan shall быть стабильным (правила периода/enum-маппинги); сегодняшняя дата и таймзона Org shall передаваться в user-части.
- **R3.** Если JSON невалиден ИЛИ `confidence < QUERY_PLAN_MIN_CONFIDENCE` (const, default 0.6, code-fallback), система shall вернуть `applied=false` и идти текущим смысловым путём без фильтров.
- **R4.** Резолвер периода shall детерминированно переводить «эта неделя»(пн–вс), «прошлая неделя», «вчера», «сегодня», «прошлый месяц», «за месяц», «N дней» в `[from,to]` в таймзоне Org.
- **R5.** Если `personScope=true`, система shall резолвить спрашивающего `userId → Person.id` и применять как фильтр участия (через существующий путь person-scope; если резолв не удался — fail-open).
- **R6.** `QueryPlanFilters` shall пробрасываться без потерь: `DialogProcessResult.queryPlan` → `SynthesisInput` → `ChatV2Input` → `RetrievalInput`.
- **R7.** Когда задан ≥1 структурный фильтр, retrieval shall ранжировать полным сканом combined-score (recall-safe), НЕ HNSW-LIMIT.
- **R8.** Фильтры shall применяться: дата по `IdeaBlockEvidence.sourceTimestamp`; тип по `b.signalType::text IN`; сущность по `IdeaBlockEntity EXISTS`; тема/отдел по `ThemeIdeaBlock`+`Theme.branch IN`.
- **R9.** Когда фильтров нет, retrieval shall работать байт-в-байт как до фичи (regression-guard).
- **R10.** Если фильтрованный pool пуст, система shall ответить честным «в памяти по этим условиям ничего нет», не синтезируя по нерелевантным блокам.
- **R11.** Маппинг намерений в `signalTypes`/`themeBranches` shall задаваться в промпте extract-plan из фиксированных enum (LLM не выдумывает значения вне enum).
- **R12.** Если запрошена актуальность «сейчас», retrieval shall добавлять `b.validUntil IS NULL`.
- **R13.** `dialog-extract-plan` shall быть зарегистрирован И в union `LlmTaskType`, И в `ALL_LLM_TASK_TYPES`.
- **R14.** `QUERY_PLAN_EXTRACTION_ENABLED` — kill-switch (ON), строка в `feature-flags.md`.

---

## Фазы (dependency-ordered)

Граф: Ф1 → Ф2 → Ф3 → Ф4 → Ф5. Строго последовательно (Ф2 нужен тип из Ф1; Ф3 нужен проброс из Ф2; Ф4 поверх Ф3; Ф5 проверяет всё).

### Фаза 1 — Tier 0: extract-plan агент + резолвер периода + флаг + регистрация taskType `[x]`
Картография: `dialog-layer/services/{dialog.service.ts,query-classifier.service.ts}`, `dialog-layer/prompts/classify.prompt.ts` (образец), `ai/services/llm-router.service.ts:192-201,647-651`, `env.schema.ts:1318`, `typed-config.service.ts:1683`.
Входит: К-1, К-2, К-3, К-6; `QueryPlanExtractorService.extract()` (вызов LLM strict-JSON, как `query-classifier.classify` :210-229); чистый `resolvePeriod(expr, todayIso, tz)` (отдельный модуль, без LLM); person-резолюция «я»→personId helper.
НЕ входит: проброс в retrieval (Ф2), сам фильтр (Ф3).
Acceptance:
- `bunx vitest run` нового spec резолвера: «эта неделя» при `today=2026-06-10(ср)` → `from=2026-06-08T00:00 МСК, to=2026-06-14T23:59:59`; «вчера» → сутки 06-09; «прошлый месяц» → 05-01..05-31. Негатив: «план на квартал» → null.
- `extract()` при моке LLM с валидным JSON → `applied=true` + заполненные filters; при невалидном JSON → `applied=false` (fail-open).
- grep: `'dialog-extract-plan'` присутствует И в union, И в `ALL_LLM_TASK_TYPES`.
- `bun run typecheck && bun run build` зелёные.
Закрывает: R1, R2, R3, R4, R5 (helper), R11, R13, R14.

### Фаза 2 — Проброс QueryPlan через оркестрацию `[ ]`
Картография: `chat-v2/chat-v2.service.ts:79-127` (orchestration ask), `chat-v2/services/synthesis.service.ts:35-64,194-207`, `knowledge-core/services/chat-v2.service.ts:44-88,247-311` (ChatV2Input + fetchCandidates вызов :288), `chat-v2-retrieval.service.ts:25-45` (RetrievalInput, К-4), `dialog-layer/services/dialog.service.ts:48-65,173-188` (DialogProcessResult).
Входит: добавить `queryPlan?: QueryPlanResult` в `DialogProcessResult`; вызвать `QueryPlanExtractorService` внутри `DialogService.process` (после classify, под флагом, fail-open); протащить `filters` в `SynthesisInput` → `ChatV2Input` → `RetrievalInput` (К-4). Резолв `entityHints[] → entityIds[]` (по `Entity.canonicalName` в tenant) — здесь.
НЕ входит: применение фильтра в SQL (Ф3).
Acceptance:
- typecheck/build зелёные; новые поля видны end-to-end (grep `dateFrom` в RetrievalInput + ChatV2Input + SynthesisInput).
- Unit: `DialogService.process` при флаге OFF → `queryPlan` undefined (no-op); при ON+мок-extract → проброшен.
Закрывает: R6.

### Фаза 3 — Tier 1: фильтрованный recall-safe ретрив `[ ]`
Картография: `chat-v2-retrieval.service.ts:125-198` (fetchCandidates/collectPool/filterByValidAt), `:398-454` (rankByCosineOrRecency — текущий HNSW), донор `search.service.ts:166-281`. Схема: `schema.prisma:373-440` (SignalType), `:793-806` (ThemeBranch), `:4147-4158` (ThemeIdeaBlock), `:3358-3379` (axisLabel — опц.).
Входит: ветка ранжирования по К-5 (полный скан combined-score с предикатами date/signalType/entity/themeBranch/bitemporal), активируется при `hasAnyFilter`. Без фильтров — текущая ветка без изменений.
НЕ входит: «в памяти нет» (Ф4); агрегации.
Acceptance:
- Интеграц.-тест (мок-данные): блок с `sourceTimestamp` вне окна НЕ возвращается при `dateFrom/dateTo`; блок др. `signalType` НЕ возвращается при `signalTypes=['decision']`; блок без темы `marketing` НЕ возвращается при `themeBranches=['marketing']`.
- Regression: при пустых фильтрах SQL/результат идентичны текущему пути (snapshot или сравнение план-запроса).
- typecheck/build зелёные.
Закрывает: R7, R8, R9, R12.

### Фаза 4 — «В памяти нет» как первоклассный ответ `[ ]`
Картография: `knowledge-core/services/chat-v2.service.ts:323-334` (текущий «Недостаточно данных» при пустом pool).
Входит: если фильтры были применены (`applied=true`) и pool после фильтра пуст — вернуть честный текст «По заданным условиям (период/тип/...) в памяти ничего не нашлось», не вызывая LLM-синтез по нерелевантному.
НЕ входит: переформулировка под другие фильтры (vNext).
Acceptance: запрос с заведомо пустым окном → ответ содержит «не нашлось»/«в памяти нет», `citations=[]`, LLM-вызов не сделан (метрика/лог).
Закрывает: R10.

### Фаза 5 — Тесты, observability, smoke, prod-deploy `[ ]`
Входит: метрики (router decision applied/fail-open; filtered vs unfiltered retrieval; misroute-proxy — доля `applied=true` с пустым pool); строка в `feature-flags.md`; обновление `prod-deploy-log.md` (Шаг 1 — новая ENV; Шаг 12 — smoke нового taskType + Swagger/route); ручной smoke флагманских запросов.
Acceptance (флагманский набор, ручной + e2e где возможно):
- «Что мы решали по маркетингу на этой неделе?» → фильтр `{decision; marketing; [пн..вс]}`, в ответе только блоки этой недели по теме marketing с типом decision, либо «в памяти нет».
- «Какие дела по продажам вчера?» → `{task*/commitment; sales; вчера}`.
- «Что обсуждали на этой неделе?» → только `dateRange`, без типа.
- Простой факт «Какой бюджет на маркетинг?» (без периода) → fail-open в текущий путь, регрессии нет.
- `bun run typecheck && bun run lint && bun run build` зелёные; vitest Ф1/Ф3 зелёные.
Закрывает: R1–R14 (сквозная проверка) + DoD.

---

## Pre-mortem / Риски + ревью-аспекты
- **Recall на фильтре** — снять полным сканом (Р3); ревью: убедиться, что фильтрованная ветка НЕ использует `ORDER BY embedding <=> qvec LIMIT`.
- **Кривой диапазон от LLM** — детерминированный `resolvePeriod` поверх LLM-намёка (не доверять сырым датам LLM); валидация `from <= to`, иначе fail-open.
- **Cache-break** — дата в user, не в SYSTEM (ревью: grep, что `todayIso` не попал в `EXTRACT_PLAN_SYSTEM_PROMPT`).
- **Регрессия нефильтрованного пути** — Ф3 regression-тест обязателен (strict-production-review-gate: путь без фильтров байт-в-байт).
- **Таймзона Org** — если у Org нет таймзоны, дефолт МСК (Europe/Moscow); зафиксировать `[ASSUMPTION: дефолт таймзоны = Europe/Moscow, если Org.timezone не задан]`.
- **entityHints→entityIds мисс** — если имя не резолвится в Entity, опустить entity-фильтр (не ронять весь запрос).

Ревью-аспекты для `strict-production-review-gate`: tenantId во всех новых SQL; fail-open во всех ветках ошибок; нет HNSW-pre-filter; нет `process.env`/`new PrismaClient`; промпт стабилен для кэша.

## Idempotency / feature-flag / prod-deploy
- Флаг `QUERY_PLAN_EXTRACTION_ENABLED` — kill-switch ON (Р8); строка в `feature-flags.md`.
- Если нужен seed route для `dialog-extract-plan` (deepseek-v4-flash) — скрипт `seed-*`, идемпотентный (upsert), зарегистрирован в `apply-prod-deploy.ts STEPS` (phase update).
- prod-deploy-log: Шаг 1 (ENV `QUERY_PLAN_EXTRACTION_ENABLED`), Шаг 7 (seed route, если есть), Шаг 12 (smoke: новый taskType отвечает, флагманский запрос фильтрует). Без миграций Prisma (Р4).

## DoD
- typecheck (вкл. `.spec`) / lint / build зелёные; vitest Ф1+Ф3 зелёные.
- second-brain обновлён: `01_projects/` (chat/dialog-layer — добавлен слой понимания запроса), `02_architecture/knowledge-core.md` (retrieval — структурные фильтры); `01_projects/ai-jobs.md` (новый taskType).
- `feature-flags.md` + `prod-deploy-log.md` обновлены; реестр `04_не-сделано` — закрыть строку «чат глух ко времени/структуре», если есть.
- Рефлексия в `05_история/`.

## Итог
_(заполнит tz-orchestrator по завершении: реализовано целиком / остаток.)_

---

## Совместимость с prompt caching
- `EXTRACT_PLAN_SYSTEM_PROMPT` — **стабилен** (правила периода, enum-маппинги, JSON-схема). Не содержит сегодняшней даты.
- Переменная часть — только user: `Сегодня: <ISO>. Таймзона: <tz>. Вопрос: <q>`. Дата меняется ежедневно → SYSTEM-префикс кэшируется (deepseek-v4-flash hit ≈99% внутри дня); вопрос — хвост user. Соответствует [[feedback_llm_prompts_cache_friendly]] и `second-brain/02_architecture/llm-cache-status.md`.
- Один вызов на запрос (Р2); intent уже извлекается отдельно — рассмотреть на ревью слияние classify+extract-plan в один вызов как fast-follow (не в Волне 1, чтобы не ломать существующий classify-кэш).

## Дальнейшие волны (отдельные ТЗ)
1. `2026-06-XX-orchestrator-deep-dive-button` — оркестратор SBA δ-1 в UI за кнопкой «Глубокий разбор» (SSE-поверхность `/orchestrator`); де-сиротизация `ORCHESTRATOR_ENABLED`, тесты латентность/падения/стоимость, Ship-On.
2. `2026-06-XX-grounded-specialist-analyst` — grounded-аналитик (факты графа + цитаты + анти-выдумка), НЕ ExecutablePersona.
3. `2026-06-XX-salience-and-proactive-recap` — скоринг важности «что пропустил» + проактивный recap-экран.
4. `2026-06-XX-aggregation-catalog` — каталог параметризованных Postgres-агрегатов для «сколько/самый».
