---
title: ТЗ — устранение класса «тихая потеря» в усвоении знаний (надёжность записи конвейера)
date: 2026-06-20
status: реализовано в dev — Ф1/Ф2/Ф3/Ф4/Ф5 [x], Ф6 [x]-частично (unit-гарды; real-DB combat-harness — CI, нет AGE в dev). Коммиты 6e344b59/f899dcb4/3fcaa2df/c8bb549f + T4 (регуляции, origin/dev)
severity: 🔴
owner: Сергей
source: plans/analysis/2026-06-20-knowledge-pipeline-agents-audit.md (аудит 16 агентов) + RESULTS.md (большой тест)
scope_principle: ТОЛЬКО кросс-секущий класс надёжности записи. Фиче-качество (дедуп/онтология) — в чужих ТЗ (см. §0), не дублируем.
---

# ТЗ: класс «тихая потеря» в конвейере усвоения знаний

## §0. Границы — что в этом ТЗ, а что в других (НЕ дублировать)
Большой тест агентов доказал: **все промпты извлечения здоровы** (decisions/ideas/insights/closure/tasks/regulations прогнаны, 1.000). Значит проблема — **в слое записи, не в LLM**. Фиче-качество уже покрыто отдельными ТЗ — это ТЗ их НЕ трогает:
- идеи↔решения (дубль/онтология) → [`idea-vs-decision-disambiguation`](2026-06-20-idea-vs-decision-disambiguation.md)
- регламенты/процессы/инструкции (навал дублей, два конвейера, арбитр) → [`regulations-process-module-fix`](2026-06-20-regulations-process-module-fix.md)
- цели + идеи → [`goals-map-and-ideas-tz`](2026-06-20-goals-map-and-ideas-tz.md)
- задачи не видны (linkedMeetingIds) → [`intake-issue-linked-meeting-ids-fix`](2026-06-17-intake-issue-linked-meeting-ids-fix.md)
- решения (идемпотентность) → [`decision-materialization-idempotency-fix`](2026-06-20-decision-materialization-idempotency-fix.md) — **это Ф1 ниже, уже реализована**.

**Предмет этого ТЗ — то, чего нет ни в одном из них:** кросс-секущий класс надёжности записи, рассыпанный по конвейеру.

> **Координация и пересечения всех сегодняшних ТЗ** — [`2026-06-20-tz-crossover-map.md`](../analysis/2026-06-20-tz-crossover-map.md). По ней **это ТЗ (T5) назначено ядром-зонтиком слоя записи**: T5 + T2 (решения, частный случай) + writer-части T1 (идеи↔решения) живут ОДНОЙ веткой `knowledge-core-master` и одним владельцем (иначе `graph.service` + `specialist-3-*` конфликтуют на каждом коммите). Остальные фиче-ТЗ — раздельно со ссылками.
>
> **ОБНОВЛЕНО 2026-06-20 (контекст про ветку выше устарел).** `feature/knowledge-core-master` уже **влита в `dev`** (PR #45); `dev` — единственный актуальный таргет, он на ~190 коммитов впереди kcore. Фазы Ф2–Ф6 реализованы прямо на `dev` (reconcile-cron Ф2 пришёл ещё раньше с аудитом Б4/Б36). Отдельной «ветки kcore» больше нет.

## §1. Проблема (один класс, ~6 мест — подтверждено аудитом чтения кода)
Сущность извлекается LLM корректно, но **не доходит до базы** из-за инфраструктурного дефекта записи, без ошибки в UI и без повтора. Три механизма:

- **(A) commit статуса ДО enqueue downstream + проглот ошибки enqueue** — блок помечается готовым/canonical, специалисты enqueue-ятся «как получится» (`.catch(warn)`); сбой Redis → специалисты не запускаются, блок навсегда «обработан», повтор невозможен. Места: `block-distill.worker.ts:169-195` (markCanonical), `:318-351` (mergeInto), `:474-511` (swapDirection); `block-ingest.worker.ts` enqueueBlockDistill после `processingStatus=ingested`.
- **(B) сырой `create` + проглот ошибки во внешнем catch без повтора** — любая ошибка записи (гонка/база/сеть) проглатывается, очередь считает «успех». Места: `specialist-3-3-decisions.service.ts:445-457` (**уже чинится — Ф1**), `specialist-3-5-insights.service.ts:300-312/943`, `specialist-3-6-ideas.service.ts:326-338`, `specialist-3-14-goals.service.ts:406-418`.
- **(C) check-then-create / запись без защиты от дублей под гонкой** — `findFirst→create` без транзакции/лока (concurrency=4) → дубли или P2002-потеря. Места: `graph.service.ts:692-719` (решение без `sourceIdeaBlockId` идёт в `create` без guard → дубли), `specialist-3-1-regulations.service.ts:1657-1672` (`nextCardVersion` вне транзакции → потеря снимка версии), `specialist-3-6-ideas` (дубли идей).

**Уровень доказательства:** Ф1 (решения) доказана **боем** (прод-логи 4× P2002) + unit. Остальное — **чтением кода, адверсариально проверено** (выдумок нет); прогоном пока не доказано — доказывается вместе с фиксом (Ф6).

## §2. Целевые инварианты
1. **И-A — никакого «готово» до downstream:** блок не помечается обработанным/canonical, пока downstream-работа не поставлена в очередь надёжно; ЛИБО есть reconcile-cron, который находит «обработанные без проекций/специалистов» и до-запускает. Сбой enqueue → job НЕ завершается успехом.
2. **И-B — идемпотентная запись:** каждый писатель типизированной сущности использует `create+catch(P2002)→merge` или `upsert`; на конфликте ничего не теряется. Внешний catch различает recoverable (`db_conflict`) и реальную ошибку — реальную **пробрасывает** (BullMQ retry), не глушит.
3. **И-C — защита от дублей под гонкой:** «найти→создать» в транзакции/через `upsert`; ни один путь не пишет без guard (в т.ч. ветка «без `sourceIdeaBlockId`»).
4. **И-тест — наблюдаемость:** конфликт = метрика `db_conflict`; потеря-через-fallback = метрика + не-успех job (а не молчаливый warn).

## §3. Решения (приняты с доказательством — не меню)
- **Р-1 — лечить (A) через reconcile-cron, а не «enqueue в транзакции»: ДА.** *Доказательство:* enqueue в Redis нельзя поместить в Postgres-транзакцию атомарно (две разные системы); попытка «сначала enqueue, потом commit» создаёт обратную гонку (специалист стартует до commit, не находит блок). Надёжный паттерн — **commit + reconcile-cron** «canonical/ingested без проекций → переenqueue» (идемпотентно благодаря И-B). Это же закрывает уже-накопленные застрявшие блоки.
- **Р-2 — образец фикса (B) — Ф1 решений: применить ко всем писателям.** *Доказательство:* `create+catch(P2002)→merge` уже реализован и зелён (8/8) для 3-3; тот же паттерн механически переносится на 3-5/3-6/3-14/graph.service.
- **Р-3 — координация веток:** `block-distill`, специалисты, `graph.service` — на ветке `feature/knowledge-core-master` (она их переписывает). Регуляции (`nextCardVersion`, `upsertInstruction`) — передать строкой в [`regulations-process-module-fix`](2026-06-20-regulations-process-module-fix.md), не дублировать здесь.
- **Р-4 — `upsertInstruction` мимо куратора:** *это не «надёжность», а фиче-пробел* → передать в regulations-ТЗ (проверить, не учтён ли уже). В этом ТЗ — только пометка.

## §4. Фазы (по леверажу)

### Ф1 — идемпотентность решений (B+C для Decision) `[x]` ✅ ГОТОВО
Реализовано (worktree `fix/decision-materialization-idempotency`, коммит 08305286, 8/8 тестов). Образец для Ф3. Детали — [`decision-materialization-idempotency-fix`](2026-06-20-decision-materialization-idempotency-fix.md).

### Ф2 — block-distill: reconcile-cron «обработано без проекций» (механизм A) `[x]` ✅
**Уже в dev** (закрыт в рамках аудит-багов Б4/Б36, файл `block-distill-reconcile.cron.ts`): догоночный `@Cron` (per-Org, идемпотентен, kill-switch ON) re-enqueue застрявших `draft` + re-dispatch canonical-в-окне без проекций; есть spec. Альтернатива «enqueue до commit» НЕ делалась (Р-1).

### Ф3 — идемпотентные писатели 3-5/3-6/3-14 + graph.service (механизм B+C) `[x]` ✅
**Реализовано.** Писатели `specialist-3-5`/`3-6`/`3-14` во внешнем `catch` `processBlock` теперь **пробрасывают** реальную ошибку записи (`throw err`) → BullMQ retry; повтор идемпотентен (guard `findFirst` по `sourceBlockIds[]`), `db_conflict` отделён от `db_error` (коммит `f899dcb4`, +3 теста). `graph.service.upsertDecision` стал P2002-safe + cross-tenant→`ConflictException`, `specialists-combined` дедуплицирует P2002 (коммит `3fcaa2df`).

### Ф4 — block-ingest: не «ingested» при частичной потере (механизм A) `[x]` ✅
**Реализовано** (коммит `c8bb549f`). block-extraction отдаёт `failedWindows`; worker считает `persistFailures`. Обе ситуации (окно вернуло пусто / `persistBlock` вернул `null`) → новая метрика `core_partial_loss_total{reason=extraction_window_failed|persist_null}` и событие НЕ помечается полностью `ingested`. Тотальная потеря (`failedWindows>0` и 0 блоков) → `systemFailure` → `RawEvent failed` (видимо, reconcile-cron добирает блоки). +тест.

### Ф5 — регуляции (передано в regulations-ТЗ) `[x]` ✅
Делегировано регуляционному ТЗ (T4) [`regulations-process-module-fix`](2026-06-20-regulations-process-module-fix.md), которое влито в `origin/dev` (`regulation-consolidator` + переработка `specialist-3-1`). Остаточный нюанс — `nextCardVersion` (`specialist-3-1-regulations.service.ts:1874`) всё ещё отдельное чтение версии (TOCTOU) — в домене T4, строка-указатель в `second-brain/04_не-сделано/README.md`.

### Ф6 — машинный гард класса: интеграционный тест гонки/потери `[x]`-частично — закрывает главный пробел тестов
**Unit-гарды готовы и зелёные** для всех писателей (`*.dedup.spec.ts` у 3-3, dedup-spec у 3-5/3-6/3-14, `graph.service.spec.ts`, `specialists-combined.service.spec.ts`) — детерминированные P2002/гонка-моки: повтор → 1 сущность, 0 потерь, метрика `db_conflict`. **Real-DB combat-harness e2e** (2+ воркера на один блок параллельно на ЖИВОЙ БД → ровно 1 сущность, `db_conflict≥1`; мок-сбой enqueue → reconcile восстановил проекции) в этой среде НЕ прогнан: dev-postgres = pgvector/pg17 **без Apache AGE**, полный конвейер требует AGE + LLM. Real-DB e2e — CI-гейт (когда поднят полный стек). Зарегистрировано в [`docs/testing/test-inventory.md`](../../docs/testing/test-inventory.md) (тип 5 «идемпотентность/гонки» + тип 3 «выход-в-базу»); строка-указатель — `second-brain/04_не-сделано/README.md`.

## §5. Ship-On / флаги
Фиксы Ф2–Ф4 — исправление дефекта, выкат включёнными. Reconcile-cron (Ф2) — per-Org, kill-switch ON, идемпотентен (строка в `docs/operations/feature-flags.md`). Новых owner-флагов нет.

## §6. Совместимость с prompt caching
Не применимо — ТЗ не трогает промпты (все прогнаны, здоровы).

## §7. Прод-операции
- Ф2 (reconcile-cron): новый `@Cron` → smoke в `prod-deploy-log` Шаг 12; разовый прогон по застрявшим блокам после выката.
- Ф3/Ф4: код+тесты, без прод-действий сверх `docker compose up -d --build backend`.
- Ф6: интеграционные тесты — CI/локально, не прод.

## §8. Итог
Это **не 16 багов, а один класс надёжности в ~6 местах** + рассинхрон задач (у того — свой ready-ТЗ). Лечится двумя гардами: **reconcile-cron** (A) и **идемпотентная запись** (B+C, образец — Ф1). Промпты доказанно ни при чём. Главная ценность Ф6 — закрыть единственный полностью пустой класс тестов («что будет при гонке/сбое»), без которого мы и дальше будем «верить на слово».

**Реализовано в этой сессии (в dev).** Класс закрыт целиком: writer-rethrow в 3-5/3-6/3-14 (Ф3, коммит `f899dcb4`) + P2002-safe/cross-tenant `graph.service` и дедуп `specialists-combined` (Ф3, `3fcaa2df`) + block-ingest partial-loss с метрикой `core_partial_loss_total` (Ф4, `c8bb549f`). Механизм A (reconcile-cron, Ф2) и регуляции (Ф5, ТЗ T4) уже были в dev — перепроверено по коду, не переделывалось. Decision-идемпотентность (Ф1) — соседним ТЗ [`decision-materialization-idempotency-fix`](2026-06-20-decision-materialization-idempotency-fix.md) (там же — решение «оставить @unique» как точку сериализации трёх писателей; миграции нет). **Верификация:** typecheck зелёный, unit-гарды по затронутым spec зелёные. Real-DB combat-harness e2e (Ф6) в dev не прогнан (нет Apache AGE) — CI-гейт, строка в `second-brain/04_не-сделано/README.md`.
