---
date: 2026-07-03
type: reflection
feature: extraction-consolidation — реализация Ф1-Ф3 (кросс-типовая консолидация сущностей + чистый дедуп-вектор + граница pain/blocker)
branch: work/2026-07-02
commits: [931b3ae6, b132d8ab, d556f11a, 5e0fc5c5]
relates_to:
  - plans/tz/2026-07-03-extraction-consolidation-fixes.md
  - plans/analysis/2026-07-03-extraction-consolidation-f0-diagnosis.md
distilled: false
---

# Консолидация извлечения — реализация Ф1-Ф3

## Что было поставлено
Реализовать фикс консолидации извлечения по ТЗ (`2026-07-03-extraction-consolidation-fixes.md`): Д1 задвоение
сущностей, Д2 дубли блоков, Д3 граница pain/blocker. Решения владельца по 3 развилкам уже приняты (①B кросс-
типовой проход + ②матрица/арбитр/миграция сабрекордов + ③A чистый дедуп-вектор). Стенд занят → только код +
unit + read-only; живой замер (пере-извлечение + recall-линейка) отложить как owner-gate. Прод-мёрж/backfill —
owner-gate. Тенант-ловушка: канон «Стрелы» пинить явно, НЕ читать `STRELA_ORG`.

## Как решал
Оркестрация через скилл `tz-orchestrator` (код руками не писал — вёл фазами через суб-агентов, приёмку делал сам):

1. **Ф0-recon + картография** — 3 параллельных Explore-агента: резолв/мёрж сущностей (9 точек type-фильтра),
   типизированные сабрекорды (формы FK), паттерны крутилок/backfill/cron. Свёл + сам сверил риск-места по схеме.
2. **Ф1** — два кодера: Ф1a движок (`entity-type-priority.ts` матрица; `entity-merge.service` снят type-guard +
   `canonicalType` + миграция сабрекордов + `findCrossTypeSameNameCandidates`; арбитр-промпт под кросс-тип;
   `client→customer` в резолве), Ф1b обвязка (`entity-consolidate-same-name.cron` + backfill'ы + крутилки +
   регистрация в `workers.module` + apply-prod-deploy). Затем **strict-review** (адверсариальный агент) → фиксер
   по находкам.
3. **Ф2** — кодер: `embedBlocks` без хедера, удаление мёртвого header-building из `block-ingest.worker`,
   `backfill-reembed-blocks-no-header`, нейтрализация старого header-re-embed.
4. **Ф3** — кодер: правило pain/blocker + golden-пример D3 в `block-ingest.prompt` (cache-friendly).
5. Приёмка КАЖДОЙ фазы — своими руками: `git status` → грепы маркеров → re-Read рисковой логики (миграция
   сабрекордов, cron consolidateGroup) → typecheck(8GB) → lint → build(DI) → vitest модуля. Коммит по фазам.

## Что вышло
- **Ф1-Ф3 закоммичены**, приёмка зелёная: typecheck+lint+build(DI) + unit (Ф1 71 тест, Ф2 42, Ф3 15).
- **strict-review Ф1 окупился:** нашёл 1 HIGH (backfill консолидировал только 1 захардкоженный тестовый org
  на проде → починено на `runForAllOrgs`/`--org`), 2 MEDIUM (неограниченные LLM-вызовы внутри группы → cap;
  ложное отравление negative-cache) и **2 пропущенные Entity-FK таблицы** (`CustomerRiskSnapshot`,
  `ThemeExclusion`) — мигрируются теперь все 17.
- **Ф4 (живой замер) отложен под стенд** (owner-gate): backfill + fidelity-пере-замер (23→≤3, 429→1) +
  recall-атрибуция + решение A-vs-C по дедуп-вектору. Строка в реестре не-сделанного обновлена.

## Чему научился
- **Тип был разделителем идентичности на 6 уровнях**, не в одном месте: exact-name, KNN, strong-ID, cache-ключ,
  merge-кандидаты, cron-пары + hard-guard + правило арбитра. Фикс одной точки бесполезен — снимать барьер надо
  системно. Гипотеза «ключ = имя+тип» подтвердилась «с запасом».
- **Package-A класс багов при soft-merge:** мёрж ставит tombstone (`mergedIntoId`), НЕ удаляет строку → `onDelete:
  Cascade` НЕ срабатывает → типизированные сабрекорды осиротеют, если их явно не перецепить. Надо мигрировать
  ВСЕ таблицы с FK на Entity (формы разные: `[entityId, tenantId]` Cascade vs `[entityId, entityTenantId]`
  SetNull). strict-review поймал 2, которые кодер пропустил.
- **Дедуп-вектор блока был загрязнён контекст-хедером** (источник/участники/тип/ДАТА) — один факт из разных
  каналов/дней давал разные векторы. Плюс асимметрия: запросы (`embedQuery`) эмбеддятся БЕЗ хедера → block-space
  и query-space рассинхронены. Снятие хедера чинит И дедуп, И retrieval. Побочно: header-building был лишним
  LLM-вызовом (мёртвая работа) — убран.
- **Ф2 mixed-space:** смена содержимого эмбеддинга требует re-embed backfill ВМЕСТЕ с выкатом кода — иначе новые
  блоки header-less, старые header-ful, KNN в смешанном пространстве хуже равномерного.
- **Тенант-ловушка подтвердилась:** `STRELA_ORG=cmr4ztnfj…` в `.env` — это клон-стенд, НЕ канон
  `cmr1qbvpx0001pwbwxbgmh1jl`. Backfill'ы пинят канон явно / `--org`, не читают `STRELA_ORG`.
- **build/typecheck OOM на дефолтной куче** этого монорепо — гонять с `NODE_OPTIONS=--max-old-space-size=8192`
  (typecheck иногда проходит на дефолте, build — почти всегда OOM).
- **Суб-агент честно отметил пропуск интеграционных DB-тестов** (в его env БД недоступна) — у меня dev-БД
  реальна, перепрогнал сам, 0 skip. Приёмка своими руками ловит «зелёный отчёт» с невыполненными тестами.
