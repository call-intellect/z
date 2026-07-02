---
distilled: false
---

# 2026-07-02 — Унификация phantom-ключей admin-крутилок FE↔backend

## Что было поставлено

ТЗ `plans/tz/2026-07-02-admin-knob-fe-backend-key-unification.md` (tz-orchestrator). Тихий баг конфигурации: каждая `*SettingsClient.tsx` держит свой массив `SettingSpec { key, ... }` и пишет `AdminSetting` по этому ключу, а бэк-реестр `admin-setting-schema-registry.ts` (единственный источник правды, читаемый `getDynamic`/`resolveSync`) использует другие ключи. **39 phantom-ключей** — админ крутит крутилку, значение сохраняется, поведение бэка не меняется. Задача: подогнать FE под реестр + guard-тест против рецидива + чистка осиротевших строк.

## Как решал (фазы, файлы, коммиты)

Оркестрация суб-агентами, приёмка каждого шага руками.

- **Ф1 (аудит).** Написал throwaway-скрипт (scratchpad) — fs-скан `frontend/app/**/*SettingsClient.tsx` + regex `key:` + сверка с ключами реестра. Подтвердил ровно **39 phantom / 152 OK** (192 FE-ключа, 15 файлов) — совпало с таблицей ТЗ до ключа.
- **Ф2 (унификация, коммит `17ab941f`).** Workflow с 4 параллельными кодерами (независимые файлы):
  - KnowledgeCore: 28 rename snake→camelCase; `insightSpikeRatio` FE-схема выровнена на диапазон реестра `z.number().min(0).max(100)`; удалены 4 cron-крутилки + неиспользуемый `cronExpr`.
  - Embeddings: 3 rename. Models: удалена `betaOps.commitmentFollowupLocalHour`. DaySignals: rebuild GROUPS.
  Приёмка: audit 39→0 phantom, FE typecheck/lint/build зелёные.
- **Группа B (8 phantom без читателя) — расследование дало сюрприз.** Не «snake vs camelCase», а «крутилка без читателя вовсе»:
  - **4 cron-крутилки нефункциональны дважды:** расписание задаётся ЛИТЕРАЛОМ `@Cron('0 */6 * * *')`, а `cfg.insights.clusterCron` (из ENV) уходит только в debug-лог (`insight-clusterer.cron.ts:66`). Даже если прочитать AdminSetting — расписание не сменится. → удалил с FE, настоящую проводку (ENV/литерал → AdminSetting + `SchedulerRegistry`) вынес в суб-ТЗ.
  - **`betaOps.commitmentFollowupLocalHour` — 0 упоминаний во всём репозитории** (не только 0 читателей — фичи нет). Удалил.
  - **`daySignals.*` — целая страница-фантом.** Фича «фиксатор чек-инов» с самого начала жила на `dayReport.*`/`daily-checkin.*` (day-report-collector.cron читает `dayReport.enabled`; daily-checkin.service — `dayReport.completenessQualityThreshold`; telegram-digest — `daily-checkin.staleDaysThreshold`). Перевёл страницу на реальные читаемые ключи (5 шт., ранее без UI вообще) — консолидация, не удаление.
- **Ф3 (guard, коммит `bba52379`).** `export registeredSettingKeys()` + backend-spec `admin-setting-fe-keys.guard.spec.ts` (fs-скан → `feKeys ⊆ registeredSettingKeys()`, phantom=0) + негативный юнит. Приёмка: 3/3 + весь модуль admin/settings 38/38 + backend typecheck.
- **Ф4 (чистка, коммит `d5e3b2b8`).** `patch-remove-phantom-admin-settings.ts` (idempotent, dry-run/`--apply`, known-phantom ∩ unregistered) + юнит 4/4 + шаг в `apply-prod-deploy.ts`. Приёмка: dry-run нашёл 4 реальные осиротевшие строки на dev-БД (`daySignals.*` + `betaOps.commitmentFollowupLocalHour`, `updatedBy=system`); `--apply` дважды → 4, затем 0 (идемпотентность доказана).
- **Суб-ТЗ** `plans/tz/2026-07-02-cron-schedules-env-to-admin-settings.md` — перенос cron/час-расписаний в AdminSetting через динамический `SchedulerRegistry`; помечен «ждёт greenlight владельца» (меняет прод-расписание, не бандлить в FE key-rename фикс).

## Что вышло (верификация)

- FE typecheck/lint/build зелёные; backend typecheck зелёный.
- Guard 3/3; patch-spec 4/4; модуль admin/settings 38/38.
- audit phantom 39→0; idempotency чистки доказана (--apply дважды).
- **НЕ сделан** ручной прод-spot-check (qa-tester на korateam.ru) — доказано кодом (переименованные ключи ∈ читатели `getDynamic`/`resolveSync`, подтверждено grep'ом) + guard-тестом; живая приёмка глазами — при следующем заходе в кабинет.

## Чему научился

1. **«Крутилка сохраняется» ≠ «крутилка работает».** `AdminSettingsService.set()` для незарегистрированного ключа лишь `warn` и ВСЁ РАВНО пишет строку — phantom-крутилка выглядит рабочей (UI зелёный, история пишется), но бэк её не читает. Единственная защита — guard `feKeys ⊆ реестр` на CI.
2. **Cron из ENV может быть двойным обманом.** `@Cron('литерал')` + `cfg.x.cron` в debug-логе создаёт иллюзию, что ENV/крутилка управляет расписанием. Управляет литерал. Для реального динамизма нужен `SchedulerRegistry.addCronJob`, не декоратор.
3. **Phantom-аудит дал точную цифру дёшево.** Throwaway fs+regex скрипт за минуту подтвердил 39/152 и стал основой guard-теста и списка чистки. Сначала ground-truth скриптом — потом код.
4. **«Крутилка без читателя вовсе» — отдельный класс бага**, не только рассинхрон формата. Требует расследования профильного модуля (куда фича переехала), а не слепого переименования. Правило автономности сработало: найти реального читателя → доказать → перевести/удалить/вынести в план.
