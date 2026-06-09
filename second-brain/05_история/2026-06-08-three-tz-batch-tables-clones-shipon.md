---
date: 2026-06-08
title: Батч из трёх ТЗ — качество агента таблиц, качество клона сотрудника, включить готовые фичи дефолтом (ship-on)
tags: [smart-tables, skill-and-clone, knowledge-clone, chatbox, ai, llm-router, ship-on, оркестрация]
distilled: false
---

# Батч трёх ТЗ: таблицы + клоны + ship-on

## Что было поставлено

Реализовать оркестрацией три независимых ТЗ (код пишут суб-агенты, я веду как `tz-orchestrator`), ветка `feature/2026-06-08-tz-batch-tables-clones-shipon`:

1. **TZ#1 — качество агента умных таблиц** ([`plans/tz/2026-06-08-smart-tables-import-agent-quality.md`](../../plans/tz/2026-06-08-smart-tables-import-agent-quality.md)): 4 детерминированных пост-пасса R1–R4 поверх 3-pass LLM-pipeline, без новых LLM-вызовов/БД/ENV.
2. **TZ#2 — качество клона сотрудника** ([`plans/tz/2026-06-08-clone-quality-improvements.md`](../../plans/tz/2026-06-08-clone-quality-improvements.md)): 8 фаз — устранение системных искажений в построении профиля и persona + chatbox-атрибуция по говорящему.
3. **TZ#3 — включить готовые фичи дефолтом** ([`plans/tz/2026-06-08-enable-shipped-features-by-default.md`](../../plans/tz/2026-06-08-enable-shipped-features-by-default.md)): по правилу Ship-On готовые, но выключенные фичи перевести в ON.

Жёсткий инженерный гейт: `typecheck` + `build` зелёные; рискованное/data-affecting — за feature-flag с безопасным дефолтом.

## Как решал (по фазам, коммиты, файлы)

### TZ#1 — таблицы (коммит `e84d8ace`), всё в `backend/src/modules/tables/services/table-agent.service.ts`
- **R1** — retry первого pass'а (DRAFT) в `runThreePassPipeline`: `getDraftMaxAttempts` (AdminSetting, fallback 3), backoff 300мс. Закрыл hard-fail импортов ~10%→~1–2%.
- **R2** — `completeSelectOptions`: union опций select/status из данных (потолок 30 distinct, case-insensitive), цвет round-robin.
- **R3** — `colJaccard` + `getJaccardThreshold` (0.6) в `findSimilarTables`: dedup по пересечению имён колонок; cosine стал опциональным (работает без embeddings).
- **R4** — `reconcileTypesWithData`: type-guard по сэмплу (date/number/currency/percent → text при <50% валидных; text → longtext). `parseNumericLoose` вынесена в `services/_num.util.ts`.

### TZ#2 — клоны (8 фаз, коммиты `dbf9b0d4`, `8446e89a`, `fc8901fe`, `3376fae1`, `2b59c8da`, `4c28bea1`)
- **Ф1 (A)** chatbox-атрибуция по говорящему: `Segment`/`MeetingTurn` += `authorPersonId` (`segment-builder.service.ts`); `chatbox-ingest.service.ts` шлёт `transcript.turns` (1 turn = 1 сообщение, синтетические таймкоды, `authorPersonId=null` клиенту / `responsible.personId` менеджеру); `block-ingest.worker`: `tryGetActorIdentity` не отдаёт session-level менеджера при per-message сегментации, subject резолвится по говорящему сегмента (клиентская реплика → subject НЕ пишется).
- **Ф6 (G)** clone-respond: `judgmental` больше не понижает анти-дипфейк-порог (оба режима `cloneTopicMinBlocks=2`, cosine≥0.70); `parseCitations` понимает `[DECISION:id]` наравне с `[BLOCK:id]`. SYSTEM не тронут.
- **Ф7 (H)** `executable-persona-build.service.ts buildForRole`: `dedupeTraitsByConcept` схлопывает черты одного `conceptId` от N сотрудников в одного представителя (max `observationCount`, при равенстве — выше confidence).
- **Ф3 (D)** verify-гейт: enum-член `SkillTraitStatus.pending_verification` (рукописная миграция `20260608120000_add_skill_trait_pending_verification`); `createNewTraitRaw` создаёт черту в `pending_verification` (persona берёт только `active`); новый taskType `skill-trait-verify` (primary `deepseek-v4-flash`, промпт `skill_trait_verify_v1`); `Specialist37Service.verifyPendingTraits()` (grounded→active, иначе held, FAIL-OPEN→active); cron `SkillTraitVerifyCron @Cron('30 3 * * *')`; seed-route в `seed-llm-task-routes-skill-and-clone.ts`.
- **Ф2 (B+C)** `mergeIntoExisting` пересчитывает confidence из числа **разных дат** блоков (`createdAt`; ≥4 high, ≥2 medium), MAX с текущим (не понижает); `statement`+`embedding` обновляются вместе в транзакции; `runDecay` — одна ступень за проход (medium→low ДО high→medium). **Класс-фикс**: тот же двойной-шаг decay исправлен и в `skill-profile-recalibrate.cron.ts`.
- **Ф4 (E)** split-floor — `knowledge.skillProfileMinObservations` (fallback текущий) + `knowledge.skillClusterMinObservations` (fallback 3) через `getDynamic`; клон формируется на разрежённых данных.
- **Ф5 (F)** арбитраж мёртвой зоны merge — `ARBITRATION_FLOOR=0.78`, кандидаты в `[0.78,0.85)` судятся LLM-арбитром (не форс-new), бакет передаётся в USER-шаблон `skill-trait-merge`.

### TZ#3 — ship-on (коммит `bb7701dc`)
- concierge dialog-layer: code-default ON; seed-дефолты `true` (`meetingTasksToTrackerOnly`, `tables_text_to_schema`), code-fallback `curationAutotuneEnabled` true; `patch-enable-shipped-flags.ts` (уважает `updatedBy` — не перебивает ручную правку); `backfill-chatbox-subject-cleanup.ts` (очистка ранее накопленной неверной chatbox-атрибуции).

## Что вышло
- `typecheck` + `build` зелёные.
- Тесты: **tables — 109**, **knowledge-core + clones + chatbox — 530**.
- Документация second-brain обновлена: `smart-tables.md` (R1–R4 + флаг дефолтом), `skill-and-clone.md` (8 фаз), `knowledge-clone.md` (chatbox-атрибуция + backfill), `ai-jobs.md` (taskType `skill-trait-verify`), `workers-queues.md` (`SkillTraitVerifyCron`), `data-model.md` (enum `pending_verification`), `code-pitfalls.md` (3 грабли).

## Чему научился
- **chatbox-identity несётся как `Person.id` в сегменте, а НЕ через `speakerParticipantId`** — у chatbox нет записей `Participant` (в отличие от встреч). Любой код атрибуции, завязанный на `Participant`, для chatbox молча даёт null/неверный subject. Per-segment `authorPersonId` + fail-closed для клиента (`null` → subject не пишется) — единственный надёжный путь.
- **Decay двойной шаг — класс-баг в двух местах сразу** (`runDecay` и `SkillProfileRecalibrateCron`). Порядок двух `updateMany` (high→medium, потом medium→low) роняет свежий high сразу в low. Чинить надо оба — повторное подтверждение `feedback_fix_the_whole_class_not_the_case`.
- **Рукописная Prisma-миграция enum при отсутствии dev-БД** — добавление значения в enum (`pending_verification`) оформлено файлом миграции вручную (`migrate dev` недоступен без живой dev-Postgres). На прод поедет через `migrate deploy`.
- **confidence черты — производная числа разных ДАТ блоков, не последнего draft.confidence** — иначе свежее одиночное наблюдение понижает устоявшуюся high-черту. И `statement`+`embedding` правятся только в одной транзакции (рассинхрон текста и вектора ломает поиск).
- **Ship-On на практике** — патч включения уважает `updatedBy`/`editedByAdmin`, чтобы не перебить ручную настройку владельца; флаг `tables_text_to_schema` перешёл из «default off до Eval» в ON, Eval остаётся инструментом регрессий, а не блокером.
