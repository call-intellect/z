---
type: reflection
date: 2026-07-01
feature: day-company-report-v2
tz: plans/tz/2026-06-30-day-company-report-v2.md
---

# Рефлексия — «День компании v2» (письмо COO + вход с атрибуцией + виджеты)

## Что было поставлено
Реализовать ТЗ `2026-06-30-day-company-report-v2` целиком (Ф1–Ф8) как оркестратор через суб-агентов: письмо от «личного операционного директора» (12 секций, имена, петля со вчера, взгляд COO, без сущности «решения»), наполнить вход отчёта всеми каналами за сутки с атрибуцией «кто сказал» + конфликты + план↔факт, перегруппировать виджеты дашборда под прототип, сдвинуть крон на 07:00, усилить ночную разметку трений, настроить маршрут модели. Отдельное жёсткое требование владельца — **визуально финальный дашборд должен совпасть с прототипом** (`prototype-day-v2-full.png`), проверить Playwright-скрином, и прогнать **реальный LLM-вызов** на синтетике.

## Как решал (файлы/коммиты)
Оркестрация: картография кода (Read/Bash, т.к. vexp-демон блокирует Grep/Glob и free-cap не покрывает backend) → самодостаточные промпты кодерам → независимая приёмка (свой typecheck/lint/тесты + re-Read) → коммит по фазам.

- **Ф1** `df237ab2` — индекс `IdeaBlockEvidence(tenantId,authorPersonId,sourceTimestamp)` + `PersonRefResolverService`.
- **Ф2** `59a40f1e` — `buildDayPackage` 6 слоёв (employeeVoice/rawConversations/signals/conflicts/reporting/yesterdayOpenSignals), крутилка `raw_char_budget`, `getTeamFrictions(since)`.
- **Ф3** `38436828` — усилен `team_friction` в block-ingest (определение + 3 few-shot).
- **Ф4** `4dce283b` — промпт `day-company-v2` (SYSTEM из `report-prompt-v2.md`, но выход = строгий JSON), 12 ключей letter, Zod `z.enum` (отклоняет `decisions`).
- **Ф5** `68f6b58b` — маршрут DeepSeek Pro→GPT→KIE (патч-скрипт в STEPS), снят `maxTokens`, нагрузочный скрипт.
- **Ф6** `7e6adcfb` — крон 07:00 МСК.
- **Ф7** `f78e42bc` + добивка `0d23551d` — `DayBlockers` + `DaySignalsGrid`.
- **Ф8** `91308001` (метрики+e2e) + `b8d0f2e6` (доки).

## Что вышло (верификация)
- typecheck/lint/build (backend+frontend) зелёные; затронутый daily-digest модуль — 55 тестов зелёные.
- **Реальный DeepSeek** (Демо-org, bootstrap Nest-контекста + `generate()`): v2-письмо с именами («Сергей», «Молочные реки», поимённая отчётность), 11/12 секций (delta пропущена — вчера нет), `decisions` отсутствует, числа дисциплины из системы. Маршрут `day-company-v2+deepseek:deepseek-v4-pro`.
- **Playwright /dashboard** (Тест-org, реальный логин): структура совпала с прототипом — обложка+4 оси → компас → задачи+кто просрочил → блокеры → риски-по-причине + идеи-кластеры → польза. Письмо разворачивается v2-секциями без «Решений».

## Чему научился (грабли и факты проекта)
1. **REALITY-CHECK ТЗ устаревает — верить только коду.** Крон был уже на `@Cron('0 6 * * *', {timeZone:'Europe/Moscow'})` (не UTC `0 3`, как в ТЗ) → правка тривиальна `0 6`→`0 7`. `LETTER_KEYS` уже без `decisions`. `ChatboxSenderType` = `CLIENT|USER|ASSISTANT|QUALITY_CONTROL` (не `MANAGER/CLIENT`).
2. **Prisma 7 + локальные миграции при AGE-расширении.** `prisma migrate dev` падает на shadow-БД (`0_init`: `type "UserRole" already exists` из-за `ag_catalog` Apache AGE в dev-контейнере). Обход без shadow: `migrate diff --from-schema <baseline-без-правки> --to-schema <текущая> --script` (изолирует ровно новый индекс) → файл миграции вручную → `migrate deploy` (применяет на живую БД без shadow, тот же путь что и прод). `migrate diff --from-config-datasource` даёт шумный diff (хочет дропнуть все GIN/HNSW из `postgres-init.sql`) — не использовать для генерации.
3. **Локальная авторизация:** пароли — argon2 (`accounts/login` через `PasswordService`), НЕ bcrypt (bcrypt только в `admin-login` для супер-админа). `email` не одиночный `@unique` на User (составной `email_signupSource`) → обновлять по `id`. Гейт кабинета — `profileCompletedAt` (null → онбординг). Текущая org — в сессии (switch-org).
4. **Общий компонент → форк, а не смена контракта.** `RisksIdeas` в `day-company/` импортировался Week/Month heroes; смена props ломала их сборку. Правильно: форкнуть в `DaySignalsGrid` (день-only), Week/Month откатить к HEAD (ТЗ «не трогаем недельный/месячный»).
5. **Визуальная сверка вскрывает то, что тесты не ловят:** старый `DashboardCanvas` рендерился под геройем и дублировал его («Идеи по темам» ↔ «Идеи по кластерам») — прототип этого не показывает. Скрыл canvas для owner+день. `getBlockers` отдаёт один блокер за N дней чек-инов → дубли в виджете, дедуп по тексту.
6. **DeepSeek через прокси из локали — флейки:** первые вызовы таймаутили ~72с, затем успех. В проде прокси доступен; локально — ретраить.

## Prod-операции
Полная инструкция — `docs/operations/prod-deploy-log.md` (блок 2026-07-01). Кратко: миграция индекса (авто через `migrate deploy`), агрегатор `apply-prod-deploy.ts` прогонит патч маршрута + seed `raw_char_budget`. Крон 07:00 и маршрут — smoke Шаг 12.

## Открытые пробелы
Зафиксированы в `04_не-сделано`: Probe (зондирование), сдвиг продюсера целей (Развилка 2), снос `CheckInConflictDetectorCron`. Плюс продуктовое решение владельцу: скрытие `DashboardCanvas` для owner+день (обратимо).
