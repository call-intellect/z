---
type: reflection
date: 2026-07-02
distilled: false
---

# 2026-07-02 — Фиксы функтеста work/2026-06-29: Пакеты A–E (5 пакетов, 14 коммитов, оркестрацией)

## Постановка

Реализовать фиксы A–E по функциональному тесту ветки `work/2026-06-29` через `tz-orchestrator` — не писать код руками, вести суб-агентами фаза за фазой с собственной независимой приёмкой каждой фазы. Пакеты (по ТЗ функтеста):

- **Пакет A — целостность Person↔Entity (PROD-BLOCKER):** NULL-компаньоны составного FK партиции (`Entity.mergedIntoTenantId`/`Person.entityTenantId`/`IdeaBlock.mergedIntoTenantId`) не проставлялись писателями → Prisma-relation рвался (тихая потеря родословной); слияние двух person-Entity схлопывало клоны (авто-мерж не исключал `type='person'`, ссылки не репойнтились).
- **Пакет C — чистота трекера:** F-2 anchor даты по `sourceOccurredAtIso` вместо `now()`; F-3 SELF_ASSIGNMENT_RULE в промпте; F-4 порог склейки IdeaBlock → крутилка 0.92→0.85 + семантический дедуп задач при материализации (новая колонка `IntakeIssue.embedding`).
- **Пакет B — H3 ассистент:** structural fallback для `fact`/`topic`, честное «ничего не нашлось».
- **Пакет D — надёжность:** F-9 gauge застрявших RawEvent, F-8 repair-retry combined-специалистов, Ф3 наблюдение merge-accuracy.
- **Пакет E — покрытие клонов F-7:** материализация профиля на мягком пороге.

Все зелёные (typecheck 0, lint 0, build DI PASS, тесты) — предусловие приёмки каждого пакета.

## Что сделал

Оркестрация скиллом `tz-orchestrator` — код руками не писал, вёл через суб-агентов фаза за фазой с собственной приёмкой каждого (typecheck/lint/build/тесты/re-Read по каждой фазе).

- **Картография 6 агентами на старте** — до кода запустил параллельный fan-out суб-агентов на реальный код всех 5 пакетов. Это вскрыло **дрейф line-refs в ТЗ**: `business-metrics` строки ~490/~2490 неверны; F-1 оказался только 1 строкой (`FROM "Person"`→`persons`), а не разбросом; `IntakeIssue` не имел embedding **вовсе** (не «зеркало отстало» — колонки нет). Промпты кодерам строились от факта кода, не от line-refs ТЗ.
- **Пакет A (Ф1–Ф7, коммиты `770fcba6`/`0cd6877e`/`99eabd15`/`d2cee062`/`c752569f`/`c96692ec` + docs `937bf7b8`):** companion-инвариант через хелперы `setPersonEntity`/`markEntityMerged`/`markBlockMerged` (id составного FK всегда пишется с tenant-компаньоном); единый `EntityMergeService.mergeEntities` для ручного+авто путей (мигрирует ВСЕ ссылки IdeaBlockEntity/EntityLink/SourceEntity/ThemeEntity/Card/Person + flatten цепочки + `markEntityMerged`); `findCandidatePairs` исключает `type='person'`; read-side транзитивный `canonicalizeEntityId`/`Ids` + follow в `loadBlocksForPerson`/`knowledge-clone-rebuild.cron`; `migrateEntityRefs` извлечён + `reconcileEntityRefs` + 2 идемпотентных backfill (`backfill-entity-tenant-companions`, `backfill-reconcile-merged-entity-refs`) для лечения прода. Типизированные сабрекорды vendor/customer — warn, вне scope.
- **Пакет C (`f56ff262`/`f625002b`/`9aece6d5`/`b7b3fda3`):** F-2 probe несёт `sourceOccurredAtIso` → `parseRussianDueDate` anchor вместо `now()`; F-3 SELF_ASSIGNMENT_RULE в `task-extract` промпте; F-4 block — порог склейки крутилка `knowledge.distillMergeThreshold` 0.92→0.85 через `getDynamic` + унификация FE-ключа; F-4 mat-A — **новая колонка** `IntakeIssue.embedding vector(1536)` + `embeddingHash` (миграция `intake_issue_embedding`), HNSW-индекс `IntakeIssue_embedding_hnsw_cosine_idx`, `IntakeIssueSimilarService` KNN, крутилка `tracker.intakeDedupThreshold`=0.15; F-4 mat-B — specialist-3-15 инлайн-embed черновика → KNN pending IntakeIssue → skip дубля / create+store.
- **Пакет B (`2913f1cf`):** structural-агрегация теперь для `fact`/`topic` (не только `list`); `query-plan-extractor` резолвит `personIds` для `fact`/`topic`; chat-v2 `forceStructuralFallback` в `bothWays` (не `isStructuralClass`); честный фолбэк «По {Михаил/компании X} ничего не нашлось»; метрика `z_structural_fallback_used_total`.
- **Пакет D (`36e8634b`):** F-9 gauge `raw_event_stuck_gauge{tenant,source_type}` (время-based, в `core-metrics-snapshot.cron` с `.reset()`); F-8 specialists-combined `repairJsonAndRetry` (bounded 1 repair, крутилка `knowledge.specialistsCombinedRepairTimeoutMs`) + `combined_parse_failed_total`; Ф3 histogram `entity_merge_confidence_gap`.
- **Пакет E (`bd951e1b`):** гейт сохранения профиля ослаблен — материализация при `auto` ИЛИ (`non-deep && profileConfidence >= knowledgeClone.profileMinConfidence`=0.55); `loadBlocksForPerson` `orderBy` предпочитает высокосигнальные; `computeProfileConfidence` obs-boost; сид `seed-admin-setting-clone-coverage.ts`.
- **Приёмка каждой фазы сам** (не по отчёту агента): грепы маркеров → re-Read критичной логики → targeted `tsc` → vitest затронутого модуля.

## Что вышло

- **Реализовано целиком, все 5 пакетов, 14 коммитов, все зелёные** (typecheck 0, lint 0, build DI PASS, тесты).
- **Прод-блокер Пакет A закрыт** — companion-инвариант + единый мерж + person вне авто-мержа + read-side canonicalize + backfill/reconciler лечения прода (на проде было `Person.entityTenantId` = 11/11 NULL и уже-схлопнутые клоны).
- **H3 (Пакет B) закрыт** — structural fallback покрывает `fact`/`topic`, тихое молчание заменено честным сообщением.
- Docs синхронизированы: `data-model.md` (§IntakeIssue += embedding), `prod-deploy-log.md` (блоки A/B/C/D/E), реестр не-сделанного (строка «Целостность сохранения» → архив).

## Чему научился

1. **Companion-инвариант составного FK — только через хелперы.** Партиционированные таблицы Z завязаны на составной FK `(id, tenantId)`: писать `mergedIntoId`/`entityId` **без** его tenant-компаньона нельзя — Prisma-relation рвётся тихо (SQL-by-id продолжает работать, родословная теряется без ошибки). В следующий раз любую запись такого id гнать через `setPersonEntity`/`markEntityMerged`/`markBlockMerged`, никогда голым `update({ data: { mergedIntoId } })`.
2. **`migrate dev` спотыкается о baseline-drift ветки → миграцию писать вручную + `migrate deploy`.** Локально `prisma migrate dev` хотел reset из-за исторического дрейфа (unique-индексы в schema мимо файлов миграций). Решение для новой колонки `IntakeIssue.embedding` — файл миграции написан руками (2 `ADD COLUMN`), на прод доедет `migrate deploy` (идёт по файлам, не падает). `migrate dev` на этой ветке использовать нельзя.
3. **Скрипт с exported-функцией обязан иметь `if (require.main === module)`-guard.** Backfill/reconcile-скрипты экспортируют функцию для вызова из спеки — но если внизу файла безусловный `main().then(...process.exit)`, то импорт в spec запускает `main` → `process.exit` рушит тест-раннер. Каждый такой скрипт: тело в exported-функции + запуск под guard.
4. **Широкий прогон модуля ловит кросс-регрессии unit-тестов от намеренного изменения shape/mock.** Когда меняешь форму (напр. `TaskItemSchema` += поле, сигнатуру резолвера, mock-возврат), targeted-тест правленого файла зелёный, а соседние спеки того же модуля падают на устаревшем моке. Приёмка — vitest **всего модуля** затронутого сервиса, не одного файла.
5. **Картография до кода = дешёвая проверка ТЗ на дрейф.** 6 агентов на реальный код вскрыли, что line-refs ТЗ устарели (`business-metrics` ~490/~2490 неверны, F-1 = 1 строка, `IntakeIssue` без embedding вовсе). Промпты кодерам строить от факта кода, а не от координат ТЗ — иначе кодер правит не то место.
6. **Embedding IntakeIssue считается инлайн (не воркером) для немедленной доступности при дедупе.** Дедуп задач срабатывает в момент материализации черновика — если вектор считать асинхронным воркером, на момент проверки его ещё нет и дубль проскочит. Поэтому specialist-3-15 embed'ит черновик синхронно перед KNN. (В отличие от `Goal.embedding`, где дедуп терпит задержку и вектор считает `GoalEmbedWorker`.)

## Что осталось

- **Системный FE↔backend key-spelling рассинхрон admin-крутилок** (dotted vs camelCase) — вскрыт при F-4 (FE писал фантомный `knowledge.distill.merge_threshold` вместо канонического `knowledge.distillMergeThreshold`). Унифицирован только для этого ключа; общий аудит несоответствий FE-ключей крутилок каноническому registry — отдельный follow-up.
- **Типизированные сабрекорды vendor/customer при мерже сущностей** — сейчас warn, полный перенос вне scope Пакета A.
- **Все 5 пакетов ждут прод-выката** — миграция `intake_issue_embedding` (авто `migrate deploy`), 1 новый HNSW-индекс, сиды крутилок (`seed-admin-setting-clone-coverage.ts` новый + существующие), backfill Пакета A. Пост-выкат верификация Пакета E — триггер `knowledge-clone-rebuild.cron` на «Стреле» + счёт `Person.knowledgeProfile`.

## Прод-команды

Полная актуальная инструкция — `docs/operations/prod-deploy-log.md` (блоки «📄 2026-07-02 — Пакет A/B/C/D/E»). Кратко diff:

- **Миграция** (авто на `up -d`): `20260702000000_intake_issue_embedding` (Пакет C, 2 ADD COLUMN).
- **Postgres-init** (идемпотентно): HNSW `IntakeIssue_embedding_hnsw_cosine_idx`.
- **Backfill** (Пакет A, `--mode update`, порядок — companions первым): `backfill-entity-tenant-companions --apply` → `backfill-reconcile-merged-entity-refs --apply`.
- **Seed** (`--mode update`): `seed-admin-setting-clone-coverage.ts` (новый, `knowledgeClone.profileMinConfidence`=0.55) + существующие (`seed-admin-settings` — `knowledge.distillMergeThreshold`/`tracker.intakeDedupThreshold`; `seed-admin-setting-worker-knobs` — `knowledge.specialistsCombinedRepairTimeoutMs`).
- **Smoke:** `/metrics` содержит `z_structural_fallback_used_total`, `raw_event_stuck_gauge`, `combined_parse_failed_total`, `entity_merge_confidence_gap`.
- **Rebuild:** `docker compose up -d --build backend frontend`.
