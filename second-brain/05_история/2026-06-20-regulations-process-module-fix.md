---
date: 2026-06-20
feature: regulations-process-module-fix
distilled: false
---

# Починка модуля регламентов / процессов / инструкций (Ф1–Ф5)

## Что было поставлено
Две корневые болезни модуля регламентов knowledge-core:
1. **Чужое стало нашим** — нормы клиента/гостя (и даже демо-кнопки самой Коры, разовые/тривиальные реплики) материализовались как наши орг-регламенты.
2. **Навал дублей** — у «Ооо луа» накопилось ~121 карточка при ~15-20 реально различных норм: дедуп-арбитр обрезался по токенам и при сбое шёл в очередь к человеку, инструкции вообще не дедуплицировались, а процессы плодились двумя сущностями (`Process` от поблочного специалиста + `ProcessTemplate` от детектора).

ТЗ `plans/tz/2026-06-20-regulations-process-module-fix.md` — 5 фаз в 3 волны: Ф1 гейт «чья норма» + существенность + стабилизация `kind`; Ф2 надёжность арбитра (fail-open без человека); Ф3 recall+дедуп инструкций; Ф4 единый конвейер процесса (`ProcessTemplate` каноничен); Ф5 крон-консолидатор + backfill.

## Как решал
Оркестрация суб-агентами фаза-за-фазой, приёмку (греп ключевых маркеров + re-Read + свой typecheck/lint/build/vitest) делал сам.
- **Ф1** (`2b8b4e1f`): в `Specialist31Service.extractDraft` добавлены гейты — гибридный приор «чья сторона» (`resolveOwnerCompanyPrior` по `Person.relationship='external'` без employee-субъекта) → skip `not_our_org`; `isKeepableOrgNorm=false` → skip `not_keepable`; экстракторы несут `ownerCompany`/`isKeepableOrgNorm`/`notabilityReason` + явное дерево выбора `kind`. Порог материализации → дин. ключ `aiFeatures.regulationMinMaterializeConfidence` (0.6).
- **Ф2** (`e0c1dcf0`): `dedupeArbiter` — явный `maxTokens=2500` против обрезки JSON + один ретрай + fail-open (`decision:'new'` + метрика `incCoreSpecialistExtractionFailure(reason:'dedupe_fallback_new')`, БЕЗ очереди к человеку с гарантом-консолидатором как сеткой). `extractDraft maxTokens=4096`.
- **Ф3** (`d55d7cb6`): `KNN_TOP_K` → дин. ключ `knowledgeCore.regulationDedupeTopK` (fallback 12); `upsertInstruction` проходит дедуп через арбитр (`knnCandidates({table:'instruction'})→dedupeArbiter→new/merge/extension`), как регламенты.
- **Ф4** (`680bb366`): `processProcessStepBlock` при `kind='process'` больше не создаёт `Process`-карточку (skip-метрика `process_canonical_template`) — каноничен `ProcessTemplate` от ProcessDetector; ветки переклассификации и router не тронуты; `regulations.getSummary` отдаёт `processTemplates`, хаб `/regulations` вход «Процессы» → `ProcessTemplatesClient`.
- **Ф5a** (`49f151f2`): `RegulationConsolidatorService` + `RegulationConsolidatorCronService` (`@Cron('*/30 * * * *')`, per-Org × 4 типа, TICK_LIMIT=50, окно 7д) + `RegulationConsolidatorWorker` (очередь `core.regulation-consolidator`, concurrency=1). Обёртка `judgeDuplicate` над арбитром схлопывает дубли внутри типа → `CardVersion(changeReason:'consolidate')` + deprecate проигравшей; защита `trustTier='human'` + negative-cache (Redis + `CurationDecision` reject/split). Кран зеркалирует логику entity-resolver'а (тот же приём top-1 HNSW + арбитр).
- **Ф5b** (`08558fb5`): `backfill-regulation-consolidate.ts` (app-context, `--org`/`--dry-run`) — разовая консолидация по org + миграция legacy `Process→ProcessTemplate` по cosine>0.85 (union `sourceBlockIds` в шаблон, `Process status='deprecated'`, не удаляет). Зарегистрирован в STEPS `apply-prod-deploy.ts` (`phase:'backfill'`, `skipBootstrap`).

## Что вышло
typecheck / lint / build / vitest — зелёные на каждой фазе. Verified фактами по коду перед написанием SQL:
- schema-поля под raw SQL (имена колонок embedding/version/status сверены по `schema.prisma`, не угаданы);
- связь `CurationDecision → curationItem` (relation) — чтобы negative-cache читал human-решения корректно;
- `ProcessTemplate` имеет `embedding` (иначе LATERAL top-1 HNSW в кране не на чем считать).

## Чему научился
1. **`tsc` проекта упирается в дефолтные 4ГБ heap** — на полном typecheck падает OOM; нужен `NODE_OPTIONS=--max-old-space-size=8192` перед прогоном. Без этого приёмка фазы ложно «краснеет» не по сути изменения.
2. **Свежий git worktree без `node_modules`** — зависимости не менялись, поэтому вместо долгого `bun install` сделал junction на `node_modules` основного checkout'а. Быстро и не плодит второй слепок зависимостей; работает только пока версии в `package.json` идентичны.
3. **`vitest -u` без скоупа переписывает EOL чужих снапшотов** под `autocrlf` (CRLF↔LF) и грязнит diff не своими файлами. Снапшоты обновлять только точечно — `vitest run -u <конкретный.spec>`, никогда глобально.
4. **Version-колонка есть не у всех 4 моделей регламентов** — `nextVersion` для `CardVersion` нельзя брать из несуществующего поля карточки; считать из самого `CardVersion` (max+1 по карточке). Иначе консолидатор падал бы на типах без `version`.

## Что осталось
- Прод-прогон `backfill-regulation-consolidate.ts` + наблюдение тиков крона — данные «Ооо луа» (`cmpndk2tw000101mwmixvacuj`) трогаются только с подтверждения владельца; смоук «число `Process`(active) сократилось» возможен лишь на проде. Строка добавлена в `04_не-сделано/README.md` (needs-deploy).
- Наблюдать метрики `not_our_org` / `not_keepable` / `dedupe_fallback_new` после выката — если `dedupe_fallback_new` шумит, арбитр часто падает (повод поднять `maxTokens` или сменить модель).

## Прод-команды
Полная актуальная инструкция — `docs/operations/prod-deploy-log.md` (блок «🛠️ 2026-06-20 — починка модуля регламентов»). Кратко: `docker compose up -d --build backend` (новый воркер/cron, миграций нет) → patch `regulation-dedupe`→pro и backfill доезжают агрегатором `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`; backfill сначала `--dry-run`, прод-данные org — только с подтверждения владельца.
