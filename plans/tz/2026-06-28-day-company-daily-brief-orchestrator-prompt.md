# Orchestrator-prompt — «День компании» (ежедневный брифинг владельца)

Запусти `tz-orchestrator` для реализации ТЗ `plans/tz/2026-06-28-day-company-daily-brief.md`. Это контракт; ниже — как стартовать, не дублируя тело ТЗ.

## Порядок чтения (перед кодом)
1. `CLAUDE.md` + `.claude/CLAUDE.md` (инварианты, vexp-first, без комментариев в коде).
2. ТЗ `plans/tz/2026-06-28-day-company-daily-brief.md` целиком — особенно REALITY-CHECK, «Принятые решения владельца» (Р1–Р7), Контракты, Фазы, Требования R1–R7.
3. Анализ-основание `plans/analysis/2026-06-28-day-company-daily-brief-blueprint.md` (§6 архитектура «откуда что берётся», §4а состав экрана).
4. Эталон вёрстки — открой `plans/analysis/2026-06-28-day-company-prototype/index.html` в браузере (Playwright): обложка-вердикт, одно «Читать полный отчёт», компас «Почему так?», связка «сотрудник → фильтр задач», бейджи повторяемости, 5 счётчиков пользы.
5. Код-якоря (перечитать, верифицировать номера строк символом): `daily-digest.service.ts`, `operations-daily-digest.cron.ts`, `daily-digest.controller.ts`, `daily-digest.dto.ts`, `daily-digest.prompt.ts`, модели `DailyOperationsDigest`/`GoalAlignmentSnapshot` в `schema.prisma`.

## Инструменты
- Картография — `run_pipeline` (vexp) первым; backend недокрыт free-капом → добирай Bash `find`/`grep` + `Read` (Grep/Glob-тулы блокируются хуком при живом демоне). Внешние либы — Context7 (здесь не требуется — фича внутренняя).
- Проверка фронта — Playwright против прототипа-эталона.

## Граф фаз (строго по зависимостям)
**Ф1 → Ф2 → {Ф3 ∥ Ф4} → Ф5 → Ф6.** Одна фаза = одна волна одного суб-агента. Ф3 (крон) и Ф4 (DTO+доступ) параллельны после Ф2. Каждая фаза самодостаточна — бери её мини-картографию и Acceptance из ТЗ.

## Факт-чек (не верь отчёту суб-агента)
По каждой фазе проверь сам: грепни маркеры из Acceptance, перечитай изменённые файлы, прогони `bun run typecheck/lint/build` + затронутые `bunx vitest run …`. Фаза «закрыта» только когда её Acceptance машинно подтверждён и строка `Закрывает: R…` выполнена.

## Ключевые ловушки (failure-modes)
- НЕ вводить новый извлекающий LLM-агент/taskType и новую модель снапшота (Р1/Р2/Р6) — только расширение существующего.
- Prisma: файловая миграция (`prisma:migrate -- --name add_day_company_fields_to_digest`), `prisma:generate` после; не `migrate dev` на проде, не `new PrismaClient()`.
- Вердикт: детерминированный clamp поверх LLM (R4) — красный клиент ⇒ ось «Клиенты» не зелёная; покрыть negative-тестом.
- Крон: ровно `@Cron('0 3 * * *')` (R3); `yesterdayInMoscow` и kill-switch не трогать.
- Обратная совместимость: новые поля DTO/модели опциональны — старый `DailyDigestClient`/`/dashboard/operations/daily` не падают и НЕ удаляются (владелец: «по шагам»).
- UI: только русский, парные токены, без `text-white` на цветном; одно разворачивание письма (без вложенных тогглов).
- Prompt-caching: стабильный SYSTEM, переменные данные дня в конце USER.

## Коммиты/push
Коммит по фазам (`feat(...)`/`fix(...)`), перечисляя пути; push — только по явному подтверждению владельца. По завершении — обновить second-brain (director-dashboard/ai-jobs/data-model/api-layer), `prod-deploy-log.md` Шаг 4, рефлексию.
