---
date: 2026-06-20
title: Надёжность усвоения знаний — идемпотентные писатели, partial-loss, бэкофилл решений (3 ТЗ)
tags: [knowledge-core, reliability, idempotency, decisions, silent-loss]
distilled: false
---

# Рефлексия: класс «тихая потеря» в слое записи графа

## Что было поставлено

Реализовать 3 ТЗ по надёжности усвоения знаний (слой записи, не LLM — большой тест агентов доказал, что промпты здоровы):

1. [`decision-materialization-idempotency-fix`](../../plans/tz/2026-06-20-decision-materialization-idempotency-fix.md) — реестр решений молча пуст у активного тенанта (Decision=0 при decision-сигналах); прод-подтверждённый 4× `P2002 sourceIdeaBlockId`.
2. [`knowledge-core-silent-loss-reliability`](../../plans/tz/2026-06-20-knowledge-core-silent-loss-reliability.md) — кросс-секущий класс «тихая потеря» в ~6 местах конвейера (зонтик слоя записи).
3. [`intake-issue-linked-meeting-ids-fix`](../../plans/tz/2026-06-17-intake-issue-linked-meeting-ids-fix.md) — задачи из встречи не видны на карточке встречи (`linkedMeetingIds` не прокидывался).

## Как решал

### Decision-идемпотентность (ТЗ#3/ТЗ#2 Ф1) — коммит `6e344b59`
Идемпотентный `createNewDecision` в specialist-3-3 (cherry-pick прежнего worktree-фикса 08305286): `create` + `catch(P2002)` → re-find по `{tenantId, sourceIdeaBlockId}` → merge; supersede-`$transaction` не трогаем (P2002 внутри tx абортит её — анти-паттерн Б1); внешний catch отделяет `db_conflict` от `db_error`. 8/8 тестов.

### Писатели rethrow (ТЗ#2 Ф3) — коммит `f899dcb4`
specialist-3-5/3-6/3-14 во внешнем `catch processBlock` теперь **пробрасывают** реальную ошибку записи (`throw err`) → BullMQ retry; повтор идемпотентен по guard `findFirst(sourceBlockIds)`. +3 теста.

### graph.service + combined P2002-safe (ТЗ#3 Ф2/Ф3) — коммит `3fcaa2df`
`graph.service.upsertDecision` стал P2002-safe: ловит P2002 вне `$transaction` → re-find → возврат существующего; cross-tenant → `ConflictException` (не тихий P2002). `specialists-combined.persistDecisions`: P2002 = дедуп (метрика `db_conflict` + `continue`), не `errors.push`. +тесты.

### block-ingest partial-loss (ТЗ#2 Ф4) — коммит `c8bb549f`
block-extraction отдаёт `failedWindows`; worker считает `persistFailures`. Обе ситуации → метрика `core_partial_loss_total{reason}`, событие не помечается полностью `ingested`. Тотальная потеря (failedWindows>0 и 0 блоков) → `RawEvent failed` (видимо, reconcile-cron добирает). +тест.

### Бэкофилл решений (ТЗ#3 Ф6) — коммит `5657f5b2`
`backend/scripts/backfill-decisions-from-signals.ts` — переэкстракция canonical decision-блоков без Decision через `router.dispatch`→3-3, идемпотентно; `--dry-run`/`--org`/`--limit`. Зарегистрирован в `apply-prod-deploy.ts` STEPS (`phase: backfill`, `skipBootstrap`).

### Уже было в dev (перепроверено по коду, не переделывалось)
- **ТЗ#1** (intake `linkedMeetingIds`) — полностью в dev, коммит `73836b7c` (миграция `add_intake_issue_meeting_id` + backfill + DTO/сервисы/воркер/тесты).
- **ТЗ#2 Ф2** (block-distill reconcile-cron) — в dev в рамках аудит-багов Б4/Б36 (`block-distill-reconcile.cron.ts`, kill-switch ON, spec).
- **ТЗ#2 Ф5** (регуляции nextCardVersion/upsertInstruction) — делегировано регуляционному ТЗ T4 (влито в `origin/dev`: regulation-consolidator + переработка specialist-3-1).

### Ключевое инженерное решение — @unique оставить (ТЗ#3 Ф4)
Решено **НЕ снимать** `@unique sourceIdeaBlockId`. Посылка исходного Р-1 «@unique превращает гонку в потерю» снята фиксом Ф1: после `create+catch(P2002)→merge` уникальность стала **точкой сериализации** трёх писателей Decision (graph.service / 3-3 / combined) — кто проиграл гонку, обогащает существующий Decision. Снятие вернуло бы кросс-писательские дубли. Само ТЗ это санкционирует. Миграции Prisma нет.

## Что вышло

- typecheck зелёный.
- Unit-гарды по затронутым spec зелёные: `specialist-3-3-decisions.dedup.spec.ts` (8/8), `specialist-3-5-insights.dedup.spec.ts`, `specialist-3-6-ideas.service.spec.ts`, `specialist-3-14-goals.service.spec.ts`, `graph.service.spec.ts`, `specialists-combined.service.spec.ts`.
- Класс «тихая потеря» в колонке 3 матрицы тестов поднят с ❌ на 🟡 у всех писателей.
- Документация синхронизирована: 3 ТЗ (статусы фаз + Итог), `docs/testing/test-inventory.md`, `second-brain/04_не-сделано/README.md`, `docs/operations/prod-deploy-log.md` (Шаг 8 backfill), `02_architecture/knowledge-core.md` (новый §«Инвариант надёжной записи»).
- **Ограничение:** real-DB e2e гонки (2 параллельных dispatch на живой БД) НЕ прогнан — dev-postgres без Apache AGE, полный конвейер требует AGE + LLM; CI-гейт (строка в реестре не-сделанного).

## Чему научился

1. **Перепроверять статус «не начато» по коду — половина уже была в dev.** ТЗ#1 целиком, ТЗ#2 Ф2 (reconcile-cron) и Ф5 (регуляции) оказались реализованы раньше другими сессиями/ветками. Без грепа фактического кода легко переделать готовое или поставить ложный `[ ]`.
2. **`@unique` + `create+catch(P2002)→merge` лучше снятия `@unique`.** Уникальность из «капкана, превращающего гонку в потерю» становится дешёвой точкой сериализации писателей, как только сам `create` идемпотентен к constraint. Гонку лечит не проверка (TOCTOU), а constraint-as-serialization.
3. **dev без Apache AGE → real-DB e2e гонки только в CI.** Логику гонки/идемпотентности можно и нужно доказывать детерминированными unit-моками (P2002/сбой записи), но «гонку на настоящей БД сквозняком» локально не прогнать без полного стека (AGE + LLM). Это честный CI-гейт, а не «верим на слово».
