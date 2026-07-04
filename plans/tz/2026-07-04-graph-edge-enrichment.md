---
type: tz
status: ready-to-implement
feature: graph-edge-enrichment
date: 2026-07-04
owner: sergrv
relates_to:
  - plans/architecture/2026-07-04-graph-edge-enrichment.md
  - plans/analysis/2026-07-03-recall-to-99-MASTER-roadmap.md
  - plans/analysis/2026-06-09-meeting-prompts-strengthening.md
  - plans/analysis/2026-06-09-prompt-fleet-audit.md
---
> Архитектура (одобрена владельцем 2026-07-04): [plans/architecture/2026-07-04-graph-edge-enrichment.md](../architecture/2026-07-04-graph-edge-enrichment.md) · Методология промптов: [meeting-prompts-strengthening.md](../analysis/2026-06-09-meeting-prompts-strengthening.md) + [prompt-fleet-audit.md](../analysis/2026-06-09-prompt-fleet-audit.md)

# ТЗ — Обогащение смысловых рёбер графа знаний (entity-relation extraction)

## Принцип
Граф знаний — главная система памяти; чат «Мастер» ходит по его рёбрам. Сейчас LLM-судья связей
`judgeRelation` умеет присвоить паре сущностей лишь **6 общих типов**, из них 56% реальных рёбер —
слабейший `mentions_with`. Точные деловые связи (отвечает за / владеет / зависит / руководит) в его
словаре **отсутствуют**, хотя enum `EntityLinkType` их поддерживает (40+). Расширяем словарь судьи +
переписываем его промпт по методологии + пере-прогоняем на накопленных парах. **Чиним КЛАСС**
(любая пара получает шанс на точный тип), не единичный кейс.

## Цель + Зачем
Чтобы multistep-вопросы («кто отвечает за то, что блокирует X», «кто чинит то, что тормозит синк»)
собирались через граф точным именем, а не гадались из текста. Замер — линейка
`backend/scripts/_measure-recall.ts` (таблицы ON). Болезненное состояние доказано на «Стреле»
(org `cmr1qbvpx0001pwbwxbgmh1jl`): 98 рёбер, 55 `mentions_with`; топ со-упоминаний (Михаил↔Битрикс 24×,
Александр↔Telegram 6×, Сергей↔удержание 5×) — точные связи, сплющенные в `mentions_with`.

## REALITY-CHECK (что есть по факту, проверено по коду 2026-07-04)
- **Агент рёбер** `backend/src/modules/knowledge-core/workers/entity-graph-builder.cron.ts` (`@Cron('0 * * * *')`):
  `findCoMentionedPairs` (порог `minComentions`, кап `PAIRS_PER_ORG_LIMIT=50`) → `findRecentSharedBlocks` (5) →
  `judgeRelation` → `upsertRichEdge`. Уже есть Org-гейт (`WorkerOrgGate`), исключение свежих пар (30 дней), skip null/low-confidence.
- **Судья** `backend/src/modules/knowledge-core/services/entity-graph.service.ts`:
  - `ENTITY_LINK_TYPES` (`entity-graph.service.ts:27`) = `['works_at','belongs_to','part_of','opposes','depends_on','mentions_with']` — **словарь из 6**.
  - `ENTITY_LINK_JSON_SCHEMA` (`:36`) + `EntityLinkResponseSchema` (Zod, `:70`) — enum из тех же 6 + `'none'`.
  - `ENTITY_LINK_SYSTEM_PROMPT` (`:90`) — **инлайн в сервисе** (не в `.prompt.ts`, не в реестре), taskType `entity-graph-builder`, guard `withInjectionGuard`+`wrapUserData` уже применён (`:264`), 2 попытки.
  - `judgeRelation` (`:240`) собирает userPayload {entityA,entityB,recentBlocks{name,criticalQuestion,trustedAnswer}} и парсит вердикт (`:311` — `'none'`→relationType:null).
- **Запись ребра** `backend/src/modules/knowledge-core/services/entity-link.service.ts:19` `upsertRichEdge` — пишет НАПРАВЛЕННО `from=entityA(меньший id)→to=entityB`; направление НЕ передаётся судьёй (сейчас все 6 типов трактуются как «A rel B»). **Для асимметричных типов (responsible_for/reports_to/manages/owned_by/measured_by) нужен явный `direction`** (см. Р1).
- **Аналог-образец** `backend/src/modules/knowledge-core/prompts/block-linker.prompt.ts` — арбитр связи block↔block, уже вынесен в `.prompt.ts`: экспорт `BLOCK_LINK_TYPES` + JSON schema + Zod из ОДНОГО источника, `withConfidenceCalibration` из `../../ai/services/prompts/common`. **Зеркалим этот паттерн.**
- **Крутилки:** `knowledge.linkMinConfidence` (0.5) и `knowledge.entityGraphMinComentions` (2) — УЖЕ в `admin-setting-schema-registry.ts:25/89` (resolveSync admin→ENV→code). `PAIRS_PER_ORG_LIMIT=50` — **хардкод-константа**, крутилки нет (Ф2).
- **Ретривал графа** `chat-v2-retrieval.service.ts` (`expandViaGraphCypher`/`expandViaGraph`/`expandViaEntityLinks`) — работает, `graphCypherRecall=true`+`graphHops>=2` по умолчанию; менять НЕ нужно (потребляет любые типы рёбер).
- **Линейка** `backend/scripts/_measure-recall.ts` (мой инструмент, таблицы ON, chained с историей, атрибуция «в ctx / не поднят»); gold `backend/scripts/eval/gold/recall-gold.json`; `mustMentionCoverage` поддерживает any-of через `|`.

## Принятые решения владельца
| # | Решение | Обоснование | Дата |
|---|---|---|---|
| 1 | Вариант 1 «прицельно по рёбрам» (расширение словаря судьи), не глубокая переработка слоя сущностей | Минимально, переиспользует конвейер, десятки целей доказаны | 2026-07-04 |
| 2 | Порог `minComentions` в первом заходе оставить 2 (117 пар — уже богато); снижать — вторым шагом | Снижение до 1 утраивает LLM-стоимость (371 пара) ради неясной добавки | 2026-07-04 |
| 3 | Промпт судьи переписать ПО МЕТОДОЛОГИИ; удачный — эталон в `docs/methodology/prompts/examples/` | Требование владельца | 2026-07-04 |
| 4 | Извлечение связей из одиночных упоминаний и дедуп фрагментов сущностей — НЕ в этом ТЗ | Отдельные шаги; сначала дешёвый доказанный рычаг | 2026-07-04 |

## Доказательство выбора (кратко; полное — в архитектуре)
Проход A (расширить словарь судьи, переиспользовать конвейер пар) vs Проход B (новый экстрактор
триплетов subject-rel-object из текста блока при ингесте).

| Критерий | A (словарь судьи) | B (триплеты при ингесте) |
|---|---|---|
| Бьёт в дыру (точные типы на реальных парах) | ✓ 117 пар-кандидатов уже есть | ✓ но и одиночные |
| Объём/риск | ✓ 1 сервис+промпт, конвейер цел | ✗ новый агент, риск шумных/выдуманных рёбер |
| Стоимость LLM | ✓ те же вызовы | ✗ +вызов на каждый блок |
| Ship-On за один заход | ✓ | ✗ больше фаз |
| Ловит связь БЕЗ со-упоминания (q064-класс) | ✗ (вынесено, Решение 4) | ✓ |
**Вывод:** A выигрывает 4:1 на текущей дыре; B — vNext, если A упрётся. Challenge: A чинит класс
(любая пара→шанс на точный тип), не кейс; не плодит код (переиспользует `upsertRichEdge`/конвейер);
не преждевременно (порог оставлен). Отвергнутая альтернатива B → ломается на «объём/риск/стоимость»
при недоказанной нужде в одиночных связях.

## Scope
**Входит:** расширение словаря типов судьи + `direction`; переписанный по методологии промпт в
`.prompt.ts` (зеркало block-linker) с эталоном в methodology/examples; вынос `PAIRS_PER_ORG_LIMIT` в
AdminSetting; backfill-пере-классификация существующих пар (idempotent, в `apply-prod-deploy` STEPS);
фикс дефектного gold-вопроса q064; замер до/после на «Стреле» с доказательством лифта.
**Не входит:** извлечение триплетов из текста без со-упоминания (vNext); дедуп фрагментов сущностей
(Шаг 1 консолидации, отдельное ТЗ); изменение ретривала графа; новые типы в enum `EntityLinkType`
(используем существующие).

## Открытая техническая развилка (закрыта рекомендацией)
**Р1 — как судья выражает направление асимметричной связи.** upsertRichEdge пишет from→to; для
асимметричных типов важно, кто на позиции `from`. **Решение:** поле `direction: 'a_to_b' | 'b_to_a'`
(default `'a_to_b'`) в схеме/Zod; в кроне и backfill при `'b_to_a'` и НЕ-симметричном типе менять
местами from/to. **Направление задаётся ПО-ТИПОВЫМ КАНОНОМ FROM** (не по «субъект=актор» — это
инвертировало owned_by/reports_to): from = грамматическое начало «from <тип> to» —
owned_by: from=метрика/сущность (владелец в конце); reports_to: from=подчинённый;
responsible_for: from=человек; measured_by: from=цель. Симметричные типы
(`mentions_with`,`collaborates_with`,`opposes`) — `direction` игнорируется. **`part_of` — асимметричен**
(from=часть), НЕ в симметричном наборе. `[РЕШЕНО: direction-поле + канон FROM]`

## Контракты

### Словарь типов судьи (Ф1) — только существующие значения enum `EntityLinkType`
Добавляем к 6 текущим (`works_at,belongs_to,part_of,opposes,depends_on,mentions_with`) точные:
```
responsible_for   // Person → Process/Entity/тема: «отвечает за / взял на себя / чинит»
owned_by          // Entity/Process → Person/Role: «владелец/ответственный владелец» (напр. метрика→человек)
manages           // Person → Person/Department: «руководит»
reports_to        // Person → Person: «подчиняется»
collaborates_with // Person ↔ Person/Department: «совместно работают» (симметрично)
measured_by       // Goal/Process → Metric: «измеряется метрикой»
```
Все шесть присутствуют в `prisma/schema.prisma` enum `EntityLinkType` (проверено). НЕ добавляем
несуществующих (`requests`/`blocks`): «нужна интеграция» → `depends_on`; блокер → `opposes` или
`depends_on` по смыслу. Единый источник — массив `ENTITY_LINK_TYPES` в новом `.prompt.ts`,
на него ссылаются JSON Schema + Zod + сервис (как `BLOCK_LINK_TYPES`).

### Схема вердикта судьи (Ф1) — добавить `direction`
```
relationType: enum([...12 типов, 'none'])
direction: enum(['a_to_b','b_to_a'])          // НОВОЕ; default 'a_to_b'
confidence: number [0,1]
explanation: string (<=500)
validFromHint / validUntilHint: string|null (<=40)
attributes: object|null (примитивы; напр. {role:'...'} )
```

### AdminSetting (Ф2)
`knowledge.entityGraphPairsPerOrg` (POSITIVE_INT, default 50) — заменяет хардкод `PAIRS_PER_ORG_LIMIT`.
Читать через `getDynamic`/resolveSync (как `entityGraphMinComentions`). Строка в
`admin-setting-schema-registry.ts` + сид + UI-поле (по образцу `entityGraphMinComentions`).

## Совместимость с prompt caching
SYSTEM = словарь+правила+дискриминатор+few-shot (стабильно per-версия промпта); переменное
(пара A/B + `recentBlocks`) — в конце user (уже так, `judgeRelation:255`). Сохранить.

## Фазы

### Ф1 — Словарь + промпт судьи по методологии (ядро) [ ]
**Ценность:** как компонент графостроения, судья `judgeRelation` получает богатый словарь и точные
правила, чтобы ставить смысловые рёбра вместо `mentions_with`.
**Что входит:**
1. Создать `backend/src/modules/knowledge-core/prompts/entity-graph-builder.prompt.ts` (зеркало
   `block-linker.prompt.ts`): экспорт `ENTITY_LINK_TYPES` (12 типов), `ENTITY_LINK_JSON_SCHEMA`,
   `EntityLinkResponseSchema` (Zod, +`direction`), `ENTITY_LINK_SYSTEM_PROMPT`. Импорт
   `withConfidenceCalibration` + при необходимости хелперов из `../../ai/services/prompts/common`.
2. Переписать `ENTITY_LINK_SYSTEM_PROMPT` ПО МЕТОДОЛОГИИ (рубрика fleet-audit):
   - **E2** injection: сохранить (guard применяется в сервисе, `withInjectionGuard`).
   - **A2** анти-выдумка: «со-упоминание САМО ПО СЕБЕ ≠ ответственность/владение; ставь точный тип,
     только если он ПРЯМО следует из текста фактов; иначе `mentions_with` или `none`».
   - **C1** калибровка: 0.9+ только если связь прямо названа; применить `withConfidenceCalibration`.
   - **D1** темпоральность: сохранить `validFromHint/validUntilHint`.
   - **Дискриминатор точного типа (аналог R2):** явное дерево выбора с негативными гвардами
     (responsible_for vs owned_by vs depends_on vs manages vs mentions_with) + правило direction +
     few-shot на РЕАЛЬНЫХ парах: «„Александр обещал настроить Telegram-интеграцию“ →
     responsible_for, a_to_b (A=Александр)»; «„Логистик Плюс требует Telegram“ → depends_on»;
     «„Сергей определяет метрику удержания“ → owned_by, b_to_a (владелец=Сергей)».
3. В `entity-graph.service.ts`: удалить инлайновые `ENTITY_LINK_TYPES`/schema/Zod/prompt, импортировать
   из `.prompt.ts`; в `judgeRelation` пробросить `direction` в вердикт (тип `EntityRelationVerdict` +
   `parseVerdict`).
4. В `entity-graph-builder.cron.ts`: при `verdict.direction==='b_to_a'` поменять местами
   from/to перед `upsertRichEdge` (единственная точка разворота).
5. Скопировать финальный промпт как эталон в `docs/methodology/prompts/examples/entity-graph-builder.md`
   (создать директорию, если нет).
**Что НЕ входит:** backfill (Ф3), крутилка кап (Ф2), изменение ретривала.
**Файлы:** `prompts/entity-graph-builder.prompt.ts` (new), `services/entity-graph.service.ts`,
`workers/entity-graph-builder.cron.ts`, `docs/methodology/prompts/examples/entity-graph-builder.md` (new).
**Acceptance:**
- `bun run typecheck` · `bun run lint` · `bun run build` зелёные.
- `grep -c "responsible_for\|owned_by\|manages\|reports_to\|measured_by\|collaborates_with" src/modules/knowledge-core/prompts/entity-graph-builder.prompt.ts` ≥ 6.
- `grep "direction" src/modules/knowledge-core/prompts/entity-graph-builder.prompt.ts` присутствует; Zod-схема содержит `direction`.
- `grep -n "ENTITY_LINK_SYSTEM_PROMPT" src/modules/knowledge-core/services/entity-graph.service.ts` → только импорт, не определение.
- Snapshot-spec `entity-graph-builder.prompt.spec.ts` (по образцу `block-linker`/`block-ingest` snapshot) зелёный; `bunx vitest run src/modules/knowledge-core/prompts/entity-graph-builder.prompt.spec.ts`.
- Юнит: пара, где текст явно «X отвечает за Y», парсится в `responsible_for` (замокать llm.call → фикс. JSON).
Закрывает: R1, R2, R5.

### Ф2 — Кап пар в AdminSetting [ ]
**Ценность:** как админ Org, могу регулировать охват графостроения без релиза.
**Что входит:** заменить `EntityGraphBuilderCron.PAIRS_PER_ORG_LIMIT` (хардкод `:13`) на чтение
`knowledge.entityGraphPairsPerOrg` (default 50) через тот же путь, что `entityGraphMinComentions`;
строка в `admin-setting-schema-registry.ts` (POSITIVE_INT); сид дефолта; UI-поле по образцу.
**Что НЕ входит:** менять сам конвейер, дефолт остаётся 50.
**Файлы:** `entity-graph-builder.cron.ts`, `admin-setting-schema-registry.ts`, сид AdminSetting, admin UI.
**Acceptance:** `grep "entityGraphPairsPerOrg" src/modules/admin/settings/admin-setting-schema-registry.ts`;
`grep -c "PAIRS_PER_ORG_LIMIT = 50" src/modules/knowledge-core/workers/entity-graph-builder.cron.ts` = 0;
typecheck/lint/build зелёные; строка добавлена в `docs/operations/feature-flags.md` (kill-switch/крутилка).
Закрывает: R3.

### Ф3 — Backfill пере-классификации пар [ ]
**Ценность:** как владелец графа, получаю точные рёбра на УЖЕ накопленных данных, не дожидаясь
естественного крон-цикла.
**Что входит:** `backend/scripts/backfill-reclassify-entity-links.ts` — по `--org=<id>` (по умолчанию
DRY-RUN; запись только с явным `--apply`): для всех пар со-упоминаний ≥ порога заново вызвать
`judgeRelation` новым промптом; при точном типе (`!= mentions_with`, confidence≥порог) — `upsertRichEdge`
(direction-aware свап) + деактивировать старые `mentions_with` рёбра пары (обе стороны, `status=archived`+
`deletedAt`). Skip-логика идемпотентности: пара пропускается, если уже есть активное НЕ-`mentions_with`
ребро в ЛЮБОМ направлении → повторный прогон = 0 обогащений. `createPrismaClient`/AppModule, импорт `../src`.
**НЕ в auto-STEPS** `apply-prod-deploy.ts` (решение реализации): скрипт LLM-дорогой и мутирует живые рёбра —
гонять на каждом `docker compose up` расточительно и против owner-gate; на проде крон сам до-обогатит за
≤30 дней, немедленно — owner-gated ручной прогон со snapshot. Документируется в `prod-deploy-log.md` Шаг 8
как ручной шаг.
**Что НЕ входит:** авто-запуск на прод-тенантах (owner-gated со snapshot); чистка фрагментов сущностей.
**Файлы:** `backend/scripts/backfill-reclassify-entity-links.ts` (new), `backend/scripts/apply-prod-deploy.ts`.
**Acceptance:** без `--apply` печатает план без записи в граф (EntityLink не меняется); `--apply` пишет;
повторный `--apply` после боевого = 0 обогащений («Обогащено: 0», всё «Пропущено (уже обогащено)»);
прогон на «Стреле» повышает долю не-`mentions_with` рёбер (замер Ф4). Строка в `prod-deploy-log.md` Шаг 8.
Закрывает: R4.

### Ф4 — Замер лифта + фикс gold q064 (верификация) [ ]
**Ценность:** как владелец, вижу доказанный лифт над шумом, не «на глаз».
**Что входит:**
1. Фикс дефектного gold-вопроса q064 в `recall-gold.json`: предпосылка «Ромашка просит Telegram»
   не соответствует данным (Telegram просит Логистик Плюс) — переформулировать под корректную
   multistep-цепочку (напр. «кому писать по Telegram-интеграции пилота» → Александр) ИЛИ пометить и
   заменить эквивалентным multistep-вопросом; сохранить назначение угла `multistep`.
2. Диагностика графа `backend/scripts/_diag-graph.ts` (уже есть) — снять долю типов рёбер и плотность
   ДО/ПОСЛЕ backfill на «Стреле».
3. `_measure-recall.ts 3 on` ДО (baseline уже снят) и ПОСЛЕ backfill; сравнить multistep-угол +
   общий CORRECT/+PARTIAL, проверить honest_empty = 0 галлюцинаций.
**Что НЕ входит:** прод-выкат (owner-gate).
**Acceptance (машинно + числа):**
- Доля не-`mentions_with` рёбер на «Стреле» ПОСЛЕ > ДО (из `_diag-graph.ts`), заметно (цель: `mentions_with`
  с 56% вниз, ≥3 новых типа появились с ненулевым числом).
- `_measure-recall.ts` ×3 ПОСЛЕ: multistep-угол не ниже baseline И общий CORRECT+PARTIAL не ниже; лифт над
  шумом (Δ ≥ 2 вопроса усреднённо) хотя бы на структурном/multistep-подмножестве.
- Галлюцинации honest_empty = 0 (не выросли).
- Отчёт-рефлексия с числами ДО/ПОСЛЕ.
Закрывает: R6.

## Требования (EARS)
- **R1** Когда судья видит пару с прямо названной в фактах деловой связью, система shall присвоить
  точный тип из расширенного словаря (не `mentions_with`).
- **R2** Если точный тип асимметричен, система shall корректно определить субъект через `direction` и
  записать ребро в верном направлении.
- **R3** Кап пар на Org shall читаться из AdminSetting `knowledge.entityGraphPairsPerOrg` (default 50).
- **R4** Backfill shall пере-классифицировать существующие пары новым промптом идемпотентно.
- **R5** Промпт судьи shall соответствовать методологии (E2/A2/C1/D1/дискриминатор/cache-friendly) и
  жить в `.prompt.ts` + эталон в methodology/examples.
- **R6** Система shall показать на «Стреле» рост доли точных рёбер И не-регресс recall при 0 галлюцинаций.
- **R7** Если связь не следует явно из текста, система shall ставить `mentions_with`/`none` (анти-выдумка).

## Границы фичи
- ✅ Always: менять словарь/промпт судьи, схему вердикта, кап-крутилку, backfill; фикс gold.
- ⚠️ Ask first: запуск backfill на ПРОД-тенантах (owner-gate + snapshot); снижение порога `minComentions`.
- 🚫 Never: новые значения в enum `EntityLinkType`; менять ретривал графа; трогать дедуп сущностей;
  авто-выкат backfill на прод без «да».

## Сквозные аспекты
- **RBAC/tenant:** backfill строго по `--org`; `judgeRelation`/`upsertRichEdge` уже tenant-scoped. `[OK]`
- **Observability:** судья уже инкрементит `incKcEntityGraphInvalidJson`; добавить не требуется сверх
  существующего логирования cron. `[N/A: метрики достаточно]`
- **Errors/idempotency:** backfill повторно = no-op (acceptance Ф3); судья fail-open (2 попытки, есть).
- **Миграции:** нет изменений схемы Prisma (используем существующий enum). `[N/A]`
- **Rollout/флаг:** Ship-On — расширенный словарь включён сразу (kill-switch не нужен: поведение улучшает,
  не тратит деньги/доступ; крон уже за Org-гейтом). Кап-крутилка = строка в feature-flags.md.
- **Тесты:** snapshot-spec промпта + юнит на парсинг responsible_for/direction + `--dry-run` backfill.

## Прод-деплой
- Ф2 → AdminSetting: `prod-deploy-log.md` (сид/UI) — крутилка.
- Ф3 → backfill: `apply-prod-deploy.ts` STEPS (phase backfill, skipBootstrap); на прод — **owner-gated со
  snapshot** (необратимая пере-запись рёбер на живых данных). Строка в `prod-deploy-log.md` Шаг 8.
- Промпт (Ф1) — code-fallback, деплоится с кодом; при admin-редактируемости — patch-скрипт по образцу.

## DoD
typecheck (вкл. `.spec`)/lint/build зелёные; vitest новых spec зелёный; second-brain обновлён
(`01_projects/knowledge-core` / `ai-jobs` — судья связей усилен; `02_architecture/knowledge-core.md`
— словарь рёбер); `docs/operations/feature-flags.md` (кап-крутилка); `prod-deploy-log.md` (Ф2/Ф3);
рефлексия с числами ДО/ПОСЛЕ; методология-эталон добавлен.

## Итог
Реализовано: __ / __. Осталось: __ (заполнит оркестратор).
