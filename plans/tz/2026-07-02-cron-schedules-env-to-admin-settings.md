# ТЗ — Перенос cron/час-расписаний из ENV/хардкода в AdminSetting (динамическое перепланирование)

- **relates_to:** `plans/tz/2026-07-02-admin-knob-fe-backend-key-unification.md` (Группа B — cron-крутилки и `daySignals.processLocalHour`)
- **Владелец запросил:** производная находка при реализации унификации phantom-ключей (2026-07-02)
- **Статус:** ⏸ ЖДЁТ GREENLIGHT ВЛАДЕЛЬЦА — меняет расписание прод-cron'ов (внешне-наблюдаемое поведение), не выкатывать в составе «FE key rename» фикса. Оформлено по правилу «Ничего не откладывать» (записано полноценным ТЗ, а не «в следующий раз»).
- **Тип изменений:** backend — новые ключи в реестре + сид + перевод 4–5 cron-воркеров с литерала `@Cron` на динамическое расписание через `SchedulerRegistry`. Миграций Prisma нет. ENV-дефолты сохраняются как code-fallback.

## Проблема (as-is)

Нарушение принципа 9 CLAUDE.md («крутилки — в AdminSetting, не в ENV и не в коде») + вскрытый phantom при унификации ключей:

1. **4 clusterer-cron'а knowledge-core** объявлены **литералом** в декораторе `@Cron('...')` и НЕ управляются ничем:
   - `theme-clusterer.cron.ts` — `@Cron('...')` литерал; `cfg.knowledge.themeClustererCron` (из ENV `THEME_CLUSTERER_CRON`) читается, но расписание задаёт литерал.
   - `idea-clusterer.cron.ts` — то же (`IDEA_CLUSTERER_CRON`).
   - `insight-clusterer.cron.ts` — `@Cron('0 */6 * * *')` литерал; `cfg.insights.clusterCron` уходит только в debug-лог (`insight-clusterer.cron.ts:66`).
   - персона-билдер (`PERSONA_BUILD_CRON`) — то же.
   FE-страница KnowledgeCore держала крутилки `knowledge.*.clusterer_cron` / `*.cluster_cron` / `persona.build_cron` — они писали `AdminSetting`-строки, которые никто не читает **и** которые не влияют на расписание даже если прочитать. Крутилки удалены из FE в родительском ТЗ (Ф2), сюда вынесена настоящая проводка.

2. **`day-report-collector.cron.ts`** — `@Cron('0 5 * * *', { timeZone: 'Europe/Moscow' })` литерал. Час запуска захардкожен. FE-крутилка `daySignals.processLocalHour` (удалена в родительском ТЗ) пыталась им управлять — читателя нет.

## Что делаем (to-be)

Каждое расписание — крутилка `AdminSetting` с code-fallback (`getDynamic(adminKey, ENV_KEY, default)`), применяется без рестарта через динамическую регистрацию cron в `SchedulerRegistry` и переподписку на `admin:setting:invalidate`.

### Новые ключи реестра (`admin-setting-schema-registry.ts`)
- `knowledge.themeClustererCron` — `z.string().min(9).max(64)` (валидная cron-строка), default `'15 * * * *'` (текущий ENV-дефолт).
- `knowledge.ideaClustererCron` — то же, default `'30 */4 * * *'`.
- `knowledge.insightClusterCron` — то же, default `'0 */6 * * *'`.
- `knowledge.personaBuildCron` — то же, default `'0 6 * * SUN'`.
- `dayReport.collectorHourMsk` — `z.number().int().min(0).max(23)`, default `5` (или `dayReport.collectorCron` cron-строкой — решить на этапе проектирования; час проще и достаточно).

### Механизм динамического cron (паттерн)
`@nestjs/schedule` `SchedulerRegistry.addCronJob(name, new CronJob(expr, cb, null, false, tz))`. Верифицировать API через Context7 (`@nestjs/schedule` актуальной версии — стек пинит свежие) перед реализацией: сигнатуру `CronJob`, `setTime`/`stop`/`start`, наличие `deleteCronJob`.
- В `onModuleInit`: прочитать cron из `getDynamic`, создать `CronJob`, зарегистрировать, `start()`.
- Подписка на `admin:setting:invalidate` (как в `AdminSettingsService`): при изменении своего ключа — `stop()` старый, пересоздать `CronJob` с новым выражением, `start()`. Либо reuse существующего pub/sub — вынести общий helper `DynamicCronService`, чтобы не плодить 5 подписчиков.
- Невалидное выражение → лог + сохранить прежнее расписание (fail-safe, не падать).

## Фазы

### [ ] Ф1. `DynamicCronService` (общий helper)
- Сервис в `common/` (или `modules/admin`), инкапсулирует: регистрацию именованного cron из `(adminKey, envKey, default)`, ре-регистрацию по pub/sub-инвалидации, валидацию cron-строки.
- Тесты: валидная строка → job создан; невалидная → прежнее сохранено; инвалидация → job пересоздан (мок `SchedulerRegistry`, без реального времени).

### [ ] Ф2. Реестр + сид
- Добавить 5 ключей в `admin-setting-schema-registry.ts`.
- Сид значений (дефолты = текущие ENV/литералы) в `seed-*.ts` (safe-seed: не перетирать admin-edited).
- Регистрация сида в `apply-prod-deploy.ts` STEPS + `prod-deploy-log.md` Шаг 7.

### [ ] Ф3. Перевод 4 clusterer-cron'ов
- Убрать литерал `@Cron`, зарегистрировать job через `DynamicCronService` в `onModuleInit`.
- Сохранить существующую бизнес-логику tick без изменений (поведение-сохраняющий рефактор — тесты воркеров зелёные до/после).

### [ ] Ф4. day-report-collector час
- `dayReport.collectorHourMsk` (или cron-строка) через `DynamicCronService`, tz Europe/Moscow.
- Вернуть на FE-страницу «Фиксатор чек-инов» (`DaySignalsSettingsClient.tsx`) крутилку часа коллектора (реальный читатель теперь есть).

### [ ] Ф5. FE — вернуть cron-крутилки
- На KnowledgeCore-странице вернуть 4 cron-крутилки с НОВЫМИ camelCase-ключами (`knowledge.themeClustererCron` и т.д.) — теперь у них реальный читатель.
- Guard-тест родительского ТЗ остаётся зелёным (ключи в реестре).

### [ ] Ф6. Верификация
- typecheck/lint/build; тесты воркеров; ручная проверка: сменить cron в `/admin` → job перерегистрирован (лог `DynamicCronService: rescheduled <name> <expr>`), без рестарта.

## Критерии приёмки (DoD)
- Смена cron-крутилки в `/admin` реально меняет расписание job без рестарта процесса.
- Невалидный cron не роняет процесс, сохраняет прежнее расписание.
- ENV-дефолты работают как code-fallback (нет строки AdminSetting → берётся ENV/литерал).
- Guard-тест FE⊆реестр зелёный (новые ключи в реестре).

## Риски
- Меняется механизм планирования 5 прод-cron'ов → регресс расписания. Митигация: дефолты = текущие значения; поведение-сохраняющие тесты; выкат отдельным деплоем с наблюдением (Ship-On, но осознанный отдельный cut).

## Итог
_(заполняется при реализации)_
