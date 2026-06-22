---
date: 2026-06-22
feature: clone-signaltype-methodology-step
tags: [клон-должности, signalType, knowledge-core, tz-orchestrator]
---

# Клон должности кормится блоками «Шаг методологии» (methodology_step)

## Что было поставлено
Реализовать ТЗ `plans/tz/2026-06-22-clone-signaltype-methodology-step.md` через скилл `tz-orchestrator`: расширить набор `signalType`, питающий клон должности, на `methodology_step`. Корень (из боевого прод-теста, `RESULTS.md`): канал «Мысль/Память» почти не порождает `reasoning`-блоки — рассуждения про подход уходят в `methodology_step`, а клон кормился узким `{reasoning,rationale,decision_basis}` → у активных Org **0 клонов**. Владелец: «пиши код полностью, вопросы решай сам, доказывай».

## Как решал
Картография (Read + грэп, без grep — vexp-демон не поднят): подтвердил 5 целевых точек ТЗ + вскрыл **3 точки сверх ТЗ** с тем же литералом (`feedback_fix_the_whole_class_not_the_case`):
- `specialist-3-7-skill-probe.service.ts` ×2 (probe «профиль голодает» + CDM-интервью) — с узким набором слали бы ложный probe и черпали кейсы не из того пула;
- `practice-skill-extractor.service.ts` — **ре-фильтрует** `sourceBlockIds` черт; после расширения rebuild черты строятся из `methodology_step`, а узкий ре-фильтр их молча выкидывал бы (`blocks.length===0` → skip).
Дописал ТЗ (Рубеж 4-расширенный + R4), потом грэп всего класса нашёл 4-ю точку — `clone-build-harness.ts` (диагностика разошлась бы с продом).

Фазы силами суб-агентов, приёмка — сам:
- **Ф1** (`ff1d09db`): новая константа `skill-signal-types.ts` (массив + Set из него = один источник, физически не разъедутся); рубежи 1–3.
- **Ф2** (`d6ce7e17`): рубеж 4 + 3 находки.
- **Ф3** (`ff30b03d`): backfill-скрипт (эталон — `backfill-knowledge-clone-after-router-fix.ts`: NestFactory + `createPrismaClient` для pre-check) + регистрация в `apply-prod-deploy.ts` STEPS.
- **Ф4** (`ab2c1537`): рефактор backfill в экспортируемую `runBackfillSkillProfilesRebuild(prisma, coreQueue, opts)` (образец тестируемости — `backfill-goal-v2-defaults`) + 11 юнит-тестов.
- **review-driven** (`890fd7c5`): independent strict-review нашёл footgun — `--tenant <id>` через пробел молча игнорировался → backfill по ВСЕМ Org. Поддержал обе формы + 4 теста.

## Что вышло (верификация — моя, не отчёт агента)
- typecheck EXIT=0 (вкл. .spec), lint 0 errors (194 warning — ровно как до правок, ни одного нового), build зелёный.
- 15 новых тестов + 41 существующий `service.spec` (R8) + 75 регресс-тестов изменённых файлов — все зелёные.
- Грэп: литерал `['reasoning','rationale','decision_basis']` в коде клона вычищен полностью; единственный остаток `!==`-гейта — `specialist-3-3-decisions` (специалист решений, корректно вне scope).
- Прод-acceptance (backfill + verify-cron + ответ клона) — за владельцем после выката (нужен dev-стек/прод).

## Чему научился
1. **«Чини весь класс» — буквально: грэпай литерал по всему репо, не по списку из ТЗ.** ТЗ перечислило 5 точек; грэп нашёл 8 (+harness). Если бы доверился списку ТЗ — probe слал бы ложные «голодает», а practice-skill молча ломался бы на methodology-клонах. ТЗ — карта, грэп — территория.
2. **Скрытый второй гейт реален.** Правка `service:loadSubjectReasoningBlocks` без `worker:69` = «работает на backfill, молчит на новых встречах». Воркер-гейт и выборка теперь из одной константы.
3. **Два набора рядом легко перепутать.** `REASONING_SUBJECT_SIGNAL_TYPES` (block-ingest, 6→7, шире, с expertise/experience/competence) ≠ `SKILL_SUBJECT_SIGNAL_TYPES` (клон, 4). Первый — только ДОБАВить methodology_step, не заменять.
4. **Идемпотентность backfill = «no-op в окне ~24ч».** jobId-дедуп BullMQ держится, пока completed-job в Redis (`removeOnComplete age 86400`). Вне окна — повторный rebuild (безопасно). Документировать честно, а не «повтор = no-op» без оговорки.
5. **Параллельная сессия и общий git HEAD.** Коммит `387bc325` (docs(tracker)) чужой сессии упал на мою ветку через общий HEAD (`feedback_parallel_sessions_git_check`). Владелец разрешил включить в dev. Урок: перед merge всегда `git log dev..HEAD` — что реально на ветке.
6. **Independent review окупается даже на хирургической правке** — нашёл footgun `--tenant` (молчаливый all-Org), который не ловится typecheck/тестами.

## Связи
- [[../01_projects/skill-and-clone]] · [[../03_processes/specialist-gamma-1-skill-clone]]
- ТЗ `plans/tz/2026-06-22-clone-signaltype-methodology-step.md` · анализ `plans/analysis/2026-06-22-clone-module-prod-test/RESULTS.md`
