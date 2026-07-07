---
type: orchestrator-prompt
pairs_with: plans/tz/2026-07-03-extraction-consolidation-fixes.md
created: 2026-07-03
status: ready-to-implement
---

# Хэндофф: реализация ТЗ «Консолидация извлечения» (Ф1→Ф4)

Скопируй этот файл целиком в первое сообщение новому агенту (или скажи «возьми в работу
`plans/tz/2026-07-03-extraction-consolidation-fixes.md` через скилл `tz-orchestrator`, инструкции в парном
orchestrator-prompt рядом»).

---

Ты — главный оркестратор-разработчик. Веди реализацию через скилл **`tz-orchestrator`**: картография кода →
точные промпты кодерам-суб-агентам → независимая приёмка (греп / re-Read / свой typecheck-lint-build-тесты) +
ревью → коммит по фазам → push по подтверждению владельца. Ф0 (диагностика) уже сделана — **не переделывай её**,
опирайся на готовый корень.

## Что прочитать первым (порядок)
1. **ТЗ (контракт):** `plans/tz/2026-07-03-extraction-consolidation-fixes.md` — фазы, приёмка, решения владельца вшиты.
2. **Ф0 диагностика + корень с `path:line`:** `plans/analysis/2026-07-03-extraction-consolidation-f0-diagnosis.md`.
3. **Данные фиделити (что и на сколько задвоено):** `plans/analysis/2026-07-03-strela-extraction-fidelity-results.md`.
4. **Метод пере-проверки:** `docs/methodology/synthetic-fidelity-eval-method.md`.
5. **Runbook стенда «Стрела»:** `docs/testing/synthetic-qa-baseline-strela.md`.
6. **Эталоны:** `backend/scripts/eval/gold/strela-manifest.batch{1,2,3-rest}.json`.
7. Проект: корневой `CLAUDE.md` + `.claude/CLAUDE.md` (vexp `run_pipeline` первым, Context7 для внешних либ).

## Корень (из Ф0 — не перепроверяй, бери как данность)
- **Д1 (сущности):** `type` — разделитель идентичности на 6 уровнях резолва/мёржа (exact-name, KNN, strong-ID,
  cache-key, `findCandidates` [entity-merge.service.ts:201], cron-пары [entity-resolver.cron.ts:150]) + hard-guard
  [entity-merge.service.ts:310] + правило арбитра [entity-merge-arbiter.prompt.ts:46]. Одноимённые разных типов не
  встречаются как кандидаты.
- **Д2 (блоки):** дедуп-вектор загрязнён контекст-хедером ([embedding.service.ts:14-23] печёт
  `${header}\n${criticalQuestion} ${trustedAnswer}`, header = источник+участники+тип+дата+LLM-предложение,
  [block-ingest.worker.ts:284-305,327]). Тот же `IdeaBlock.embedding` читает KNN → кросс-канальные близнецы < 0.85
  → авто-canonical, арбитр не зовётся.

## Решения владельца (ВШИТЫ — реализуй именно так, без повторного согласования)
- **Д1 → (B):** тип остаётся в идентичности; добавь **кросс-типовой merge-проход** (снять type-фильтр в выборке
  кандидатов) + арбитр решает «один объект под разными видами». + детерминированный маппинг `client`→`customer`.
- **Д1 → канонический тип:** матрица приоритетов (`customer>client`, domain-типы > generic `topic/metric`) для
  очевидных + арбитр возвращает `canonicalType` для спорных. **Типизированные сабрекорды (Vendor/Customer/Goal/…) —
  дописать миграцию между типами** (сейчас warn-only [entity-merge.service.ts:349-355]; hard-guard :310-312 заменить
  на политику выбора канонического типа, не throw).
- **Д2 → (A):** убери контекст-хедер из дедуп-вектора блока. **СНАЧАЛА проверь**, не критичен ли хедер для
  retrieval-качества блоков (где ещё читается `IdeaBlock.embedding` — чат/RAG/карточки). Если критичен → **эскалируй
  владельцу** переход на (C): два вектора (чистый дедуп + контекстный retrieval, +колонка/миграция/backfill). Порог
  0.85 не трогай как «фикс».

## Объём фаз
- **Ф1** — консолидация сущностей (Д1): кросс-типовой проход + матрица типа + миграция сабрекордов + консолидирующий
  backfill same-name для существующего графа. Идемпотентно, kill-switch, батч-крутилка.
- **Ф2** — кросс-канальный дедуп блоков (Д2): чистый дедуп-вектор + backfill re-dedup существующих canonical.
- **Ф3** — граница pain/blocker (Д3): правило в `block-ingest.prompt.ts`, cache-friendly.
- **Ф4** — верификация. **СТОП перед стендом (см. ниже).**

## Жёсткие правила проекта (не нарушать)
- **Без комментариев в коде** — самодокументируемо; знания — в `docs/`, не в прозе кода.
- **Крутилки → AdminSetting**, не ENV/код: порог/лимит/флаг/батч через `getDynamic`/`resolveSync` + строка в
  `admin-setting-schema-registry.ts` + сид + UI. Прямой `process.env.*` мимо `env.schema.ts` запрещён.
- **Ship-On + реестр флагов:** новый kill-switch (ON по умолчанию, аварийный) → строка в
  `docs/operations/feature-flags.md`. «Выкатить выключенным» запрещено.
- **Миграции Prisma версионируемые:** любое изменение БД (миграция сабрекордов, возможная новая колонка вектора) =
  файл миграции `prisma:migrate -- --name ...`, ревью SQL. `db push` только для черновых непроталкиваемых проб.
- **Backfill/патч-скрипты:** используй `createPrismaClient()` из `scripts/_lib/prisma.ts` (не голый `new PrismaClient()`);
  импорты из `../src`; зарегистрируй новый `backfill-*`/`patch-*` в `apply-prod-deploy.ts` STEPS (phase `backfill`,
  `skipBootstrap`) + строка в `docs/operations/prod-deploy-log.md` (Шаг 8) + Ф0-чек-лист производных заметок.
- **Переиспользуй готовое** (из Ф0-механики): `mergeEntities` + `migrateEntityRefs` (транзакционный мёрж), `judgeMerge`
  + арбитр-промпт, negative-cache `markEntityPairDistinct`, `entity-resolver.worker`, `graph-reconcile.cron` (сам
  вычистит merged-away узлы). Строить новое — только выборку same-name кандидатов (GROUP BY LOWER(canonicalName)
  без окна updatedAt) + миграцию сабрекордов + чистый дедуп-вектор.
- **Приёмка каждой фазы:** typecheck (вкл. `.spec`) + lint + build + юниты/интеграционные зелёные; коммит `тип(область): …`;
  push — только по явному подтверждению владельца (Conventional Commits, коммить только своё, без `git add .`).
- **second-brain/prod-deploy-log/рефлексия** по триггеру после push (см. корневой CLAUDE.md).

## СТОП-ГЕЙТ СТЕНДА (главное для этого хэндоффа)
Стенд = **единственная** локальная dev-БД (`z_main` :55435) + dev-backend + реальный LLM, где живёт эталонная
«Стрела» (`cmr1qbvpx0001pwbwxbgmh1jl`). Backfill Ф1/Ф2 **необратим** (мёрж не разъединить).

- **НЕ гоняй** backfill/fidelity/recall против реальной «Стрелы». Смоук консолидатора — **только на отдельном
  throwaway-тенанте** (`cd backend && bun run scripts/seed-synthetic-company.ts` → печатает новый org id), не на baseline.
- Юниты/интеграционные — на prefixed/safe данных `z_main`, не трогая «Стрелу».
- Доведя код + зелёную приёмку Ф1-Ф3 + throwaway-смоук → **ОСТАНОВИСЬ и рапортуй владельцу: «готов к прогону стенда»**,
  приложив точный список команд из «Последовательности» ниже. Прогон запускает **владелец** (он проверяет, что стенд
  свободен, и делает snapshot). Не запускай стенд сам, даже если кажется, что всё готово.

### Последовательность прогона стенда (это делает ВЛАДЕЛЕЦ после «готов»)
1. Стенд свободен: `docker compose -f docker-compose.dev.yml up -d`; `cd backend && bun run dev`; нет другого
   seed/backfill/eval по «Стреле».
2. Snapshot-откат: `pg_dump z_main > strela-before-backfill.sql` (мёрж необратим — это точка возврата).
3. Backfill: `cd backend && STRELA_ORG=cmr1qbvpx0001pwbwxbgmh1jl bun run scripts/<Ф1-консолидатор>.ts` затем
   `… scripts/<Ф2-re-dedup>.ts` (точные имена агент впишет сюда при реализации).
4. Устояться (block-distill debounce 30с, cron).
5. Прямой гейт: имён-с-несколькими-типами 23→≤3; «Битрикс 429» 4→1; webhook-риск 3→1; «Моя история» 2→1.
6. Слой-0 fidelity: пере-прогон `strela-manifest.batch{1,2,3-rest}.json` (слепые разметчики + матчер, read-only).
7. Recall-атрибуция: `cd backend && bun run scripts/eval/run-recall-eval.ts` — поднялось ли ведро ④.
8. Полнота 44/44 не упала. After-числа → обновить Ф0-записку + fidelity-results + рефлексия.

> «Переключение между стендами» как рантайм-фичи НЕТ. «Два стенда» = throwaway-тенант агента (смоук) vs эталонная
> «Стрела» (официальный замер владельца со snapshot). Один физический стенд — последовательно, не параллельно.

## Что вернуть владельцу на СТОП-гейте
- Список сделанного по Ф1-Ф3 (файлы, миграции, новые backfill-скрипты + их точные имена команд для шага 3).
- Результат throwaway-смоука (консолидатор реально слил одноимённых разных типов и re-dedup схлопнул кросс-канальные).
- Итог retrieval-проверки по Д2 (пошли по (A) или эскалация на (C)).
- Готовый чек-лист команд прогона стенда (шаги 2-7 выше с подставленными именами скриптов).
