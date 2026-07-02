# ТЗ — Унификация ключей admin-крутилок FE ↔ backend (устранение phantom-ключей)

- **relates_to:** `second-brain/02_architecture/code-pitfalls.md` TC6 («каждая `*SettingsClient.tsx` держит СВОЮ копию Zod-схемы; автоген из бэкового `/schema/:key` существует, но страницы им не пользуются»)
- **Владелец запросил:** 2026-07-02
- **Источник:** обнаружено при фиксе tracker-крутилок (Пакет C) — из группы Knowledge-Core чинился только `knowledge.distillMergeThreshold`; остальные крутилки той же страницы оказались phantom (FE правит ключ, который бэкенд не читает).
- **Приоритет:** тихий баг конфигурации — админ крутит крутилки в `/admin`, значения сохраняются, но поведение бэкенда не меняется. При 40–100 юзерах любые операционные пороги (кластеризация, дедуп, curation, embeddings) в реальности сидят на code-fallback / ENV, а не на том, что видит владелец в кабинете.
- **Тип изменений:** FE-only (переименование строк-ключей в `*SettingsClient.tsx`) + один guard-тест + опциональная чистка осиротевших строк `AdminSetting`. Миграций Prisma / ENV / новых флагов НЕТ.

## Контракт (инвариант)

«Каждый ключ SettingSpec на фронте существует в бэковом реестре `admin-setting-schema-registry.ts`; крутилка в `/admin` пишет ровно тот `AdminSetting.key`, который читает `getDynamic`/`resolveSync` на бэке. Guard-тест падает, если на фронте появился ключ вне реестра.»

## Что сейчас (as-is)

### Механика бага
1. Каждый `*SettingsClient.tsx` декларирует свой массив `SettingSpec { key, label, schema, defaultValue }` (либо через `DomainSettingsClient` со `specs`).
2. Хук `frontend/src/hooks/useAdminSettingEditor.ts` читает/пишет `GET|POST /api/v1/admin/settings/{key}` по этому `key` и валидирует значение СВОЕЙ FE-Zod-копией (`schema.safeParse` в теле `save`). Хук **не обращается** к `GET /api/v1/admin/settings/schema/:key`.
3. Бэк-реестр `backend/src/modules/admin/settings/admin-setting-schema-registry.ts` (единственный источник правды: ключи, которые бэк валидирует и которые читают `getDynamic`/`resolveSync`) использует **camelCase** (`knowledge.distillMergeThreshold`). Часть FE-страниц исторически написана в **dotted-snake** (`knowledge.distill.merge_threshold`).
4. `AdminSettingsService.set()` (`admin-settings.service.ts:138`) для незарегистрированного ключа лишь **логирует warn** (`set() для незарегистрированного ключа`) и **всё равно пишет строку** `AdminSetting`. То есть phantom-крутилка при клике «Сохранить» создаёт осиротевшую строку, которую бэк никогда не прочитает.

Итог: **FE правит `AdminSetting`-строки, которых бэк не читает → крутилка молча ничего не делает.**

### Доказательство (grep по `backend/src`)
Для каждого snake-ключа с FE — **0 файлов-читателей** в бэке; для его camelCase-эквивалента из реестра — **≥1 читатель**. Примеры:

| snake (FE, phantom) | читателей | camelCase (реестр, canonical) | читателей |
|---|---|---|---|
| `knowledge.distill.debounce_ms` | 0 | `knowledge.distillDebounceMs` | 1 |
| `knowledge.entity.merge_threshold` | 0 | `knowledge.entityMergeThreshold` | 1 |
| `knowledge.theme.cosine_threshold` | 0 | `knowledge.themeCosineThreshold` | 1 |
| `knowledge.idea.cluster_threshold` | 0 | `knowledge.ideaClusterThreshold` | 3 |
| `knowledge.block_ingest.window_segments` | 0 | `knowledge.blockIngestWindowSegments` | 4 |
| `knowledge.link.min_confidence` | 0 | `knowledge.linkMinConfidence` | 3 |
| `knowledge.curation.auto_threshold_default` | 0 | `knowledge.curationAutoThresholdDefault` | 2 |

### Полная phantom-таблица (аудит Ф1)
Прогон: собрать все `key:`-строки из `frontend/app/**/*SettingsClient.tsx`, сверить с ключами реестра. Итог: **39 phantom / 152 OK** (192 FE-ключа всего; `tracker.morningDigest.channels` — не phantom, ключ в реестре на многострочной записи `[\n 'tracker.morningDigest.channels', …]`, не путать).

**Группа A — есть canonical camelCase в реестре (простое переименование FE-ключа):**

| FE key (phantom) | canonical (реестр) | файл |
|---|---|---|
| `knowledge.distill.debounce_ms` | `knowledge.distillDebounceMs` | `(admin)/admin/ai/knowledge-core/KnowledgeCoreSettingsClient.tsx` |
| `knowledge.distill.knn_top_k` | `knowledge.distillKnnTopK` | KnowledgeCore |
| `knowledge.entity.merge_threshold` | `knowledge.entityMergeThreshold` | KnowledgeCore |
| `knowledge.theme.cosine_threshold` | `knowledge.themeCosineThreshold` | KnowledgeCore |
| `knowledge.theme.cluster_min_size` | `knowledge.themeClusterMinSize` | KnowledgeCore |
| `knowledge.theme.clustering_min_blocks` | `knowledge.themeClusteringMinBlocks` | KnowledgeCore |
| `knowledge.idea.cluster_threshold` | `knowledge.ideaClusterThreshold` | KnowledgeCore |
| `knowledge.idea.min_supporters_for_cluster` | `knowledge.ideaMinSupportersForCluster` | KnowledgeCore |
| `knowledge.insight.cluster_threshold` | `knowledge.insightClusterThreshold` | KnowledgeCore |
| `knowledge.insight.frequency_window_days` | `knowledge.insightFrequencyWindowDays` | KnowledgeCore |
| `knowledge.insight.spike_ratio` | `knowledge.insightSpikeRatio` | KnowledgeCore |
| `knowledge.skill.min_observations` | `knowledge.skillMinObservations` | KnowledgeCore |
| `knowledge.skill.trait_similarity_threshold` | `knowledge.skillTraitSimilarityThreshold` | KnowledgeCore |
| `knowledge.skill.lookback_months` | `knowledge.skillLookbackMonths` | KnowledgeCore |
| `knowledge.skill.decay_months` | `knowledge.skillDecayMonths` | KnowledgeCore |
| `knowledge.skill.archive_months` | `knowledge.skillArchiveMonths` | KnowledgeCore |
| `knowledge.persona.min_traits` | `knowledge.personaMinTraits` | KnowledgeCore |
| `knowledge.persona.role_agg_min_persons` | `knowledge.personaRoleAggMinPersons` | KnowledgeCore |
| `knowledge.persona.executable_threshold_traits_count` | `knowledge.executablePersonaThresholdTraitsCount` | KnowledgeCore |
| `knowledge.block_ingest.window_segments` | `knowledge.blockIngestWindowSegments` | KnowledgeCore |
| `knowledge.block_ingest.max_tokens_per_segment` | `knowledge.blockIngestMaxTokensPerSegment` | KnowledgeCore |
| `knowledge.block.dynamic_score_decay_days` | `knowledge.blockDynamicScoreDecayDays` | KnowledgeCore |
| `knowledge.link.min_confidence` | `knowledge.linkMinConfidence` | KnowledgeCore |
| `knowledge.link.knn_top_k` | `knowledge.linkKnnTopK` | KnowledgeCore |
| `knowledge.linker.min_blocks` | `knowledge.linkerMinBlocks` | KnowledgeCore |
| `knowledge.curation.auto_threshold_default` | `knowledge.curationAutoThresholdDefault` | KnowledgeCore |
| `knowledge.curation.deep_review_threshold_default` | `knowledge.curationDeepReviewThresholdDefault` | KnowledgeCore |
| `knowledge.curation.item_expiry_days` | `knowledge.curationItemExpiryDays` | KnowledgeCore |
| `embeddings.chunk_target_tokens` | `embeddings.chunkTargetTokens` | `(admin)/admin/ai/embeddings/EmbeddingsSettingsClient.tsx` |
| `embeddings.chunk_overlap_tokens` | `embeddings.chunkOverlapTokens` | Embeddings |
| `embeddings.batch_size` | `embeddings.batchSize` | Embeddings |

**Группа B — canonical В РЕЕСТРЕ НЕТ и читателя НЕТ (не просто переименовать — нужно решение):**

| FE key (phantom) | статус | файл |
|---|---|---|
| `knowledge.theme.clusterer_cron` | cron-крутилка; бэк читает cron из **ENV** (`THEME_CLUSTERER_CRON` через `typed-config`), в реестре AdminSetting нет | KnowledgeCore |
| `knowledge.idea.clusterer_cron` | то же (`IDEA_CLUSTERER_CRON`) | KnowledgeCore |
| `knowledge.insight.cluster_cron` | то же (cron из ENV, не AdminSetting) | KnowledgeCore |
| `knowledge.persona.build_cron` | то же (cron из ENV, не AdminSetting) | KnowledgeCore |
| `betaOps.commitmentFollowupLocalHour` | 0 читателей, нет в реестре; нет очевидного camelCase-эквивалента | `(admin)/admin/ai/models/ModelsSettingsClient.tsx` |
| `daySignals.enabled` | 0 читателей в бэке, нет в реестре; реестр знает `daily-checkin.*` / `dayReport.*`, но НЕ `daySignals.*` | `(admin)/admin/checkin-signals/DaySignalsSettingsClient.tsx` |
| `daySignals.detectThreshold` | то же (вся страница «Фиксатор чек-инов» пишет ключи без читателя) | DaySignals |
| `daySignals.processLocalHour` | то же | DaySignals |

> Группа B — **сюрприз аудита**: mismatch не только «snake vs camelCase», но и «крутилка без читателя вовсе». Cron-крутилки (4 шт.) отражают ENV-значение, которое AdminSetting не переопределяет (нарушение принципа 9 CLAUDE.md — крутилка должна быть в AdminSetting, а не в ENV; но это отдельная задача переноса cron в реестр). `daySignals.*` — целая admin-страница, которую бэкенд не читает; нужно выяснить у профильного модуля, какой ключ на самом деле должен читаться (возможно фича переведена на `daily-checkin.*` / `dayReport.*`, а страница не обновлена).

### Затронутые файлы FE (только эти держат phantom-ключи)
- `frontend/app/(admin)/admin/ai/knowledge-core/KnowledgeCoreSettingsClient.tsx` — **основной очаг** (28 phantom: вся страница кроме `distillMergeThreshold` и `clone.regulations.*`).
- `frontend/app/(admin)/admin/ai/embeddings/EmbeddingsSettingsClient.tsx` — 3 phantom.
- `frontend/app/(admin)/admin/ai/models/ModelsSettingsClient.tsx` — 1 phantom (`betaOps.commitmentFollowupLocalHour`).
- `frontend/app/(admin)/admin/checkin-signals/DaySignalsSettingsClient.tsx` — 3 phantom (вся страница).
- Остальные 10 `*SettingsClient.tsx` (tracker, quotas, worker-knobs, retention-logging, concierge, orchestrator, probe, …) — **чисты** (все ключи в реестре).

## Что делаем (to-be)

**Источник правды = бэк-реестр `admin-setting-schema-registry.ts`.** FE подгоняется под него.

### Долговременная защита (чтобы баг не вернулся) — две опции

**Опция 1 (МИНИМУМ, рекомендую): guard-тест «FE-ключи ⊆ реестр».**
Тест собирает все `key:`-литералы из `frontend/app/**/*SettingsClient.tsx` (regex по исходникам) и сверяет с экспортом ключей реестра. Падает, если FE-ключ отсутствует в реестре. Дёшево, детерминированно, ловит рецидив на CI до выката. Реестр — приватная `Map`, поэтому нужен экспорт ключей (`export function registeredKeys(): string[]` рядом с `getSchemaForKey`) — единственная правка бэка, безопасная.

**Опция 2 (ИДЕАЛ, отдельная задача): FE потребляет `GET /api/v1/admin/settings/schema/:key` (TC6).**
Эндпоинт уже есть (`admin-settings.controller.ts:55`) и отдаёт `{ hasTypedSchema, jsonSchema, currentValue, severity, description }`. `useAdminSettingEditor` мог бы тянуть схему оттуда вместо FE-копии Zod — тогда `label`/`defaultValue` остаются на FE, а тип/пределы/enum приходят с бэка, и невозможен дрейф схемы. Это устраняет и вторую половину TC6 (дублирование Zod), но это заметный рефактор хука + всех страниц (JSON-схема → рендер поля) и его правильнее делать отдельным ТЗ.

**Рекомендация:** в этом ТЗ — **Опция 1** (переименование + guard-тест). Опция 2 — записать указателем в `second-brain/04_не-сделано` как «идеал (автоген `/schema`)», не тащить в этот фикс.

## Фазы

### [x] Ф1. Аудит-подтверждение (таблица)
- Собрать все `key:`-литералы из `frontend/app/**/*SettingsClient.tsx` (учесть и `SettingSpec.settings`, и `DomainSettingsClient.specs` — оба используют `key:`).
- Сверить с ключами реестра; воспроизвести phantom-таблицу выше (Группа A + Группа B).
- **Приёмка:** список phantom-ключей совпадает с таблицей ТЗ (39 шт.); каждый Группы A имеет доказанный canonical (`grep` camelCase в реестре = найдено); каждый Группы A phantom имеет 0 читателей в `backend/src`, а его canonical — ≥1.

### [x] Ф2. Унификация FE-ключей (Группа A)
- В `KnowledgeCoreSettingsClient.tsx` и `EmbeddingsSettingsClient.tsx` заменить каждую строку `key:` из Группы A на canonical camelCase (значения `label`/`description`/`defaultValue`/`schema` не трогать — только `key`). FE-Zod-схема каждой крутилки должна оставаться совместимой с бэковой из реестра (сверить тип/пределы: напр. `knowledge.insightSpikeRatio` в реестре `min(0).max(100)`, на FE было `min(1).max(20)` — привести FE к бэку или к общему безопасному диапазону; аналогично проверить `linkKnnTopK`, `distillKnnTopK` — `POSITIVE_INT` без верхней границы в реестре).
- Группа B (cron × 4, `betaOps.commitmentFollowupLocalHour`, `daySignals.*`): **НЕ переименовывать вслепую.** Для каждого — реализатор решает сам (правило автономности): найти реального читателя фичи → если фича читает другой ключ, подставить его; если читателя нет вовсе (крутилка мертва) — либо добавить ключ+читатель в бэк, либо убрать крутилку с FE. Для cron-крутилок каноничный путь по принципу 9 CLAUDE.md — завести ключ в реестре и перевести читатель с ENV на `getDynamic` (можно вынести это в отдельный мини-план, если объём растёт). Крайняя граница: НЕ оставлять phantom (guard-тест Ф3 всё равно упадёт).
- **Приёмка:** после Ф2 запуск сборщика ключей даёт 0 phantom; `typecheck`/`lint` FE зелёные.

### [x] Ф3. Guard-тест (FE-ключи ⊆ реестр)
- Экспортировать ключи реестра: добавить `export function registeredSettingKeys(): string[]` в `admin-setting-schema-registry.ts` (возврат `[...registry.keys()]`).
- Тест (FE vitest или backend-side чтение FE-файлов — реализатор выбирает по расположению; проще backend-тест, читающий `frontend/app/**/*SettingsClient.tsx` через fs + regex): собрать FE-ключи, проверить `feKeys ⊆ registeredSettingKeys()`, при нарушении — упасть с перечнем phantom-ключей и файлов.
- Негативная проверка: тест умеет ронять на заведомо-ложном ключе (в тесте — временно подмешать фейковый ключ в вход и убедиться, что assert падает; либо отдельный юнит на функцию сравнения).
- **Приёмка:** тест зелёный на текущем дереве; при внесении заведомо-ложного FE-ключа — красный с понятным сообщением.

### [x] Ф4. (опц.) Чистка осиротевших строк AdminSetting
- `set()` пишет строку даже для незарегистрированного ключа, поэтому на проде могли осесть строки под phantom-ключами (если владелец кликал «Сохранить» на phantom-крутилке).
- Скрипт `backend/scripts/patch-remove-phantom-admin-settings.ts` (idempotent, `createPrismaClient()` из `_lib/prisma`): удалить строки `AdminSetting`, ключ которых НЕ в `registeredSettingKeys()` И совпадает со списком известных phantom (не трогать чужое). Сухой прогон (лог что удалит) по умолчанию, `--apply` для записи.
- Зарегистрировать в `backend/scripts/apply-prod-deploy.ts` (`STEPS`, `phase: 'patch'`, `skipBootstrap: true`) и в `docs/operations/prod-deploy-log.md` Шаг 6.
- **Приёмка:** dry-run на проде показывает список; после `--apply` строк под phantom-ключами = 0. (Данные не теряются — это мёртвые строки без читателя.)

### [x] Ф5. Тесты / верификация
- FE: `bun run typecheck` · `bun run lint` · `bun run build` (frontend).
- Backend: `bunx vitest run` по guard-тесту (Ф3) + затронутым spec (если правился реестр/скрипт).
- Ручная приёмка (spot-check 1–2 крутилки через qa-tester на korateam.ru): изменить, напр., `knowledge.themeCosineThreshold` в `/admin` → подтвердить, что `GET /api/v1/admin/settings/knowledge.themeCosineThreshold` вернул новое значение и `getDynamic` в кластеризаторе тем его читает (лог/поведение).
- **Приёмка:** все проверки зелёные; spot-check показывает, что крутилка теперь реально влияет на бэкенд.

## Критерии приёмки (DoD)
- Каждый ключ FE-крутилки ∈ бэк-реестр (`registeredSettingKeys()`); phantom = 0.
- Guard-тест зелёный на текущем дереве и **падает** на заведомо-ложном FE-ключе.
- Изменение крутилки в `/admin` реально меняет поведение бэкенда (spot-check ≥1 knob: значение доезжает до `getDynamic`/`resolveSync`).
- (Если делали Ф4) осиротевших строк `AdminSetting` под phantom-ключами нет.
- Группа B закрыта осознанно: либо ключ подвязан к реальному читателю, либо крутилка убрана, либо перенесена в отдельный план (никаких оставшихся phantom).

## Prod-deploy
- **FE:** только пересборка фронта (`docker compose up -d --build` фронта / штатный FE-деплой) — новые ключи начинают писать/читать корректные `AdminSetting`-строки.
- **Backend:** правка реестра — только добавление `export registeredSettingKeys()` (без миграций/ENV/флагов). Если в Ф2 для Группы B заведён новый ключ+сид — обновить сид и `prod-deploy-log.md` Шаг 7, реестр `admin-setting-schema-registry.ts` (Шаг не требует миграции БД).
- **Чистка (Ф4, если делали):** `docker compose exec backend bun run scripts/patch-remove-phantom-admin-settings.ts` (dry-run) → `--apply`; строка в `apply-prod-deploy.ts` `STEPS` + `prod-deploy-log.md` Шаг 6.
- **Миграций Prisma / ENV / новых флагов — НЕТ.**

## Смежные отложенные пункты (для этого же агента; реальные API-ключи в `.env` доступны → реальные LLM-вызовы можно)
Короткие указатели, детали — в `second-brain/04_не-сделано/README.md` (не дублировать):
- **(a) Пакет E / Ф3 — прогон клонов на «Стреле» с РЕАЛЬНЫМ LLM.** Запустить `knowledge-clone-rebuild.cron` на синтетической «Стреле» и подтвердить покрытие клонов ≥ прежних 3/7 (цель 7/7 для Анны/Дарьи). См. ТЗ Пакета E (`plans/tz/2026-07-01-package-e-clone-coverage.md`).
- **(b) Пакет D — метрика точности author-attribution.** Требует пробросить числовой `confidence` в пайплайне: сейчас `provenance.service.ts` пишет `confidence: null`, чистого emit-пойнта нет. См. `04_не-сделано` строка 2026-07-02 «дашборды merge-accuracy / author-attribution».
- **(c) EXPLAIN нового intake KNN на реальных данных.** Новый LATERAL по `IdeaBlockEvidence` в `fact-supersede.service.ts` (Ф8 extraction-rewrite) на боевых объёмах планом не проверен. См. `04_не-сделано` строка 2026-06-30 «EXPLAIN/прогон fact-supersede LATERAL».

## Итог

**Реализовано целиком (ветка work/2026-06-29, коммиты 17ab941f · bba52379 · d5e3b2b8).**

- **Ф1.** Аудит-скрипт подтвердил ровно **39 phantom / 152 OK** (15 `*SettingsClient.tsx`, 192 FE-ключа) — совпало с таблицей ТЗ.
- **Ф2.** Группа A — 31 rename в camelCase (KnowledgeCore 28 + Embeddings 3); `insightSpikeRatio` FE-схема выровнена на диапазон реестра `z.number().min(0).max(100)`. Группа B (8) закрыта осознанно:
  - 4 cron-крутилки удалены с FE — оказались phantom **и** нефункциональны (расписание задаётся литералом `@Cron`, а `cfg.*.clusterCron` из ENV уходит только в debug-лог). Настоящая проводка (ENV/литерал → AdminSetting + динамический `SchedulerRegistry`) вынесена в `plans/tz/2026-07-02-cron-schedules-env-to-admin-settings.md` (ждёт greenlight — меняет прод-расписание).
  - `betaOps.commitmentFollowupLocalHour` — удалена (0 читателей во всём репозитории, фичи нет).
  - Страница «Фиксатор чек-инов» переведена с фантомных `daySignals.*` на реальные читаемые ключи: `dayReport.enabled`, `dayReport.completenessQualityThreshold`, `daily-checkin.staleDaysThreshold`, `daily-checkin.skipNonWorkingDays`, `daily-checkin.skipHolidays`. `daySignals.processLocalHour` (без читателя, коллектор на хардкод-cron MSK 05:00) вынесен в тот же суб-ТЗ.
- **Ф3.** `export registeredSettingKeys()` + backend guard-spec `admin-setting-fe-keys.guard.spec.ts` (fs-скан `frontend/**/*SettingsClient.tsx` → `feKeys ⊆ registeredSettingKeys()`, phantom=0) + негативный юнит. 3/3 зелёные; весь модуль admin/settings 38/38.
- **Ф4.** `patch-remove-phantom-admin-settings.ts` (idempotent, dry-run/`--apply`, known-phantom ∩ unregistered) + юнит-spec 4/4 + шаг `phase:'patch' args:['--apply']` в `apply-prod-deploy.ts`. На dev-БД нашлись и вычищены 4 реальные осиротевшие строки (`daySignals.*` ×3 + `betaOps.commitmentFollowupLocalHour`, `updatedBy=system` — следы кликов по phantom-крутилкам); `--apply` дважды → 4, затем 0 (идемпотентность доказана).
- **Ф5.** FE typecheck/lint/build зелёные; backend typecheck зелёный; guard + patch spec зелёные. Ручной spot-check в проде (qa-tester на korateam.ru) — **НЕ выполнен в этой сессии** (см. «Что не сделано» в отчёте): доказано кодом (переименованные ключи ∈ читатели `getDynamic`/`resolveSync`, подтверждено grep'ом) + guard-тестом.

**DoD:** phantom=0 (guard зелёный, падает на ложном ключе); Группа B закрыта (подвязано к реальному читателю / удалено / вынесено в суб-ТЗ); осиротевшие строки чистятся идемпотентным скриптом. **Осталось (не в scope этого ТЗ):** суб-ТЗ cron→AdminSetting (greenlight владельца); TC6-Опция 2 (FE потребляет `/schema/:key`) — указатель в `04_не-сделано`.
