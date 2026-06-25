# Итеративный многошаговый поиск (route → plan → step-retrieval → sufficiency) — ЗАКОНСЕРВИРОВАНО

**Статус:** изъято из chat-v2 при упрощении (2026-06-25). НЕ выбрасываем — консервируем как готовый метод для будущей фичи **«Большой анализ / отчёт»**.

**Зачем сохраняем:** для гигантских агрегаций, где данные физически не влезают в один контекст ответа («пройди ВСЕ 40 встреч с клиентом X и собери каждую боль / каждое возражение», «свод по всем сделкам за квартал»). Это не чат-ответ — это **отчёт**, и там staged-поиск с проверкой достаточности оправдан. В обычном чате он был лишней второй петлёй и дублировал «понимание вопроса» + флаг `aggregation` + честность синтеза — поэтому убран из chat-v2.

> Решение об удалении и обоснование — [2026-06-25-telegram-concierge-classifier-arch.md](2026-06-25-telegram-concierge-classifier-arch.md) §14 (группа поиска).

---

## Метод (как работал)

Ветка `retrieveWithOptionalPlan` в [chat-v2.service.ts:903](../../backend/src/modules/knowledge-core/services/chat-v2.service.ts#L903):

1. **Cold-start guard** — если у тенанта < `rag.cold_start_min_blocks` (дефолт 20) canonical-блоков → метод пропускается, обычный одношаговый поиск.
2. **`rag-route` (routeComplexity, [:977](../../backend/src/modules/knowledge-core/services/chat-v2.service.ts#L977))** — LLM классифицирует сложность: `none` / `single` / `iterative`. Только `iterative` идёт дальше; иначе обычный поиск.
3. **`rag-plan` (planSteps, [:1009](../../backend/src/modules/knowledge-core/services/chat-v2.service.ts#L1009))** — LLM разбивает вопрос на 2–4 последовательных шага `{goal, query}` (первый — «найти все релевантные эпизоды», дальше — извлечь нужное).
4. **Пошаговый поиск** — каждый шаг = отдельный `runRetrieval`; найденные blockId копятся в `Set` (дедуп по нормализованной фразе).
5. **`rag-sufficiency` (judgeSufficiency, [:1042](../../backend/src/modules/knowledge-core/services/chat-v2.service.ts#L1042))** — LLM судит «хватает ли собранного». Не хватает + есть новая `nextQuery` (не виденная) → **ещё один проход**. Затем стоп.

Петля: plan → (retrieve)×N → sufficiency → опц. +1 retrieve.

## Промпты (сохранить дословно)

`rag-pipeline.prompts.ts`:
- **RAG_ROUTE_SYSTEM_PROMPT** ([:3](../../backend/src/modules/knowledge-core/prompts/rag-pipeline.prompts.ts#L3)) — диспетчер сложности; возвращает `needsSearch/complexity/clarifyNeeded/clarifyQuestion/assumedDefault`. (В chat-v2 использовался только `complexity`; поля переспроса парсились и игнорировались.)
- **RAG_PLAN_SYSTEM_PROMPT** ([:28](../../backend/src/modules/knowledge-core/prompts/rag-pipeline.prompts.ts#L28)) — планировщик: `{steps:[{goal,query}]}`, 2–4 шага.
- **RAG_SUFFICIENCY_SYSTEM_PROMPT** ([:55](../../backend/src/modules/knowledge-core/prompts/rag-pipeline.prompts.ts#L55)) — судья достаточности: `{sufficient,gaps[],nextQuery}`.

## Крутилки (AdminSetting / `getDynamic`)

- `rag.iterative_enabled` (дефолт true) — включатель ветки.
- `rag.cold_start_min_blocks` (дефолт 20) — порог холодного старта.
- `rag.rrf_k` (60), `rag.rerank_min_pool` (12) — общие, остаются в основном поиске.

## Что заменило метод в обычном чате (после упрощения)

- Сложность «агрегат/не агрегат» берётся из флага `aggregation` слитого шага «понимание вопроса» — без отдельного LLM-вызова.
- «Все встречи с X» покрыто точным фильтром по сущности + табличной веткой (COUNT/агрегат) + 1-hop графом + цепочками рассуждений (BFS depth=2 на синтезе).
- Честность «не нашёл» — в системном промпте синтеза, отдельный судья достаточности не нужен.

## Когда воскрешать

Когда появится явная фича-отчёт «Большой анализ»: пользователь осознанно запускает тяжёлый проход по многим эпизодам, результат — структурированный свод (не реплика в чате). Тогда:
- взять метод как отдельный сервис/воркер (не в горячем пути chat-v2),
- staged-retrieval + sufficiency как ядро,
- бюджет шагов и стоимость — явные, видимые пользователю (это дорогая операция).
