# Orchestrator-prompt — Универсальный фиксатор дневных чек-инов

Ты — `tz-orchestrator`. Реализуешь ТЗ `plans/tz/2026-06-21-universal-daily-checkin-fixator-tz.md` фаза за фазой силами суб-агентов в отдельном git worktree. Это самодостаточный промпт запуска.

## Порядок чтения на старте
1. `CLAUDE.md` + `.claude/CLAUDE.md` (стек, принципы 8/9 Ship-On и крутилки, запрет комментариев в коде).
2. ТЗ `plans/tz/2026-06-21-universal-daily-checkin-fixator-tz.md` — контракт. Раздел «Принятые решения владельца» (Р-1…Р-7) — НЕ пересматривать, вопросов владельцу по ним не задавать.
3. Анализ `plans/analysis/2026-06-21-universal-daily-checkin-fixator/99-synthesis.md` (+ per-source 07 по chatbox/Bitrix) — «почему так».
4. Код-якоря (перепроверь номера строк перед правкой — могли сдвинуться, ищи по символу):
   - `backend/prisma/schema.prisma` — `model DailyCheckIn` (`@@map("daily_check_ins")`), `enum DailyCheckInSource`, `enum SourceType`.
   - `backend/src/modules/operations/services/daily-checkin.service.ts` — `upsertFromParser`, `createOrUpsertManual`, `upsertInternal`, `MIN_CONFIDENCE`.
   - `backend/src/modules/operations/services/operations-dashboard.service.ts` — `getMissingCheckIns`, `getCheckinDiscipline`, `fetchTeamTemperature` (НЕ фильтруют по source).
   - `backend/src/modules/ingest/ingest.service.ts` — `enqueueRawReceived`; `backend/src/modules/core-queue/queues.ts` — `CORE_QUEUE_NAMES.RAW_EVENTS='core.raw-events'`.
   - `backend/src/modules/knowledge-core/services/entity-resolution.service.ts` — `resolveSubjectPersonId`.
   - `backend/src/modules/conversational/adapters/telegram-bot/telegram-digest.cron.ts` — образец дневного cron (Redis NX, per-person TZ).
   - `backend/src/modules/operations/services/checkin-parser.service.ts` — образец LLM-сервиса (`taskType`, json_object).
   - `backend/src/modules/ai/services/llm-router.service.ts` — `LlmTaskType` union + `ALL_LLM_TASK_TYPES`; `backend/scripts/seed-llm-routing.ts` — маршрут.
   - `backend/src/modules/admin/settings/admin-setting-schema-registry.ts` + `backend/scripts/seed-admin-settings.ts` (`SettingSeed`).

## Инструменты
- vexp `run_pipeline` первым (если демон жив); иначе Explore + Grep/Read.
- Context7 для BullMQ/Prisma/Nest при сомнении в API. Не угадывать.

## Граф фаз (строгий порядок)
`Ф1 → {Ф2, Ф4} → Ф3 → {Ф5, Ф6} → Ф7 → Ф8`. Ф2 и Ф4 — параллельны после Ф1; Ф5 и Ф6 — параллельны после Ф3+Ф4. Между волнами: зелёная верификация → commit по фазе → следующая волна в том же ходе ([[feedback_orchestration_no_stop_between_waves]]). Push — только по подтверждению владельца.

## Ключевые архитектурные инварианты (не «оптимизировать»)
- **НЕ вешать второй BullMQ Worker на `core.raw-events`** — украдёт job у block-ingest. Детектор читает БД напрямую (cron) + реактивный листенер встречи. Это доказано (ТЗ §Доказательство).
- `upsertFromParser` и telegram-путь **не трогать** — добавляется отдельный `upsertFromDaySignal` с merge.
- Дашборд НЕ фильтрует по source — детектированные чек-ины засчитываются автоматически; Ф7 — только проброс `source` в DTO + русские бейджи.
- Фильтр `personId≠null` — единственный фильтр входа; авто-связь не достраивать (Р-3). Метрика отброшенного обязательна.
- Промпт `day-signal-detect` — cache-friendly (стабильный SYSTEM, `dayText` в конец user). Модель `deepseek-v4-flash`.
- Крутилки `daySignals.detectThreshold/processLocalHour/enabled` — только AdminSetting (getDynamic, code-fallback), не ENV/хардкод. `daySignals.enabled` — kill-switch ON (Ship-On), строка в feature-flags.md.

## Факт-чек суб-агентов (не верь отчёту [x])
После каждого агента до commit ([[feedback_agents_can_lie_about_edits]]):
- grep ключевых маркеров: `enum DailyCheckInSource` содержит `bitrix/chatbox/email/meeting/phone_call`; `'day-signal-detect'` в `ALL_LLM_TASK_TYPES`; `upsertFromDaySignal` существует; `daysignal:agg:` и `@Cron` в cron-файле; `daySignals.` в admin-registry.
- re-Read изменённых участков; свой `bun run typecheck && bun run lint && bun run build`; целевые `bunx vitest run <spec>`.
- Весь `git status` перед commit (не только последний add) — чужие/пропущенные spec ломают typecheck.

## Определение «фаза закрыта»
Все Acceptance-предикаты фазы машинно подтверждены (grep/тест/команда), «Что НЕ входит» не нарушено, строка `Закрывает: Rn` трассируется. Prisma-фаза: `prisma:migrate --name ...` + `prisma:generate` зелёные; в скриптах `createPrismaClient()` из `scripts/_lib/prisma.ts`, импорты из `../src`.

## Failure-modes
- Событие готовности анализа встречи (Ф6): имя могло измениться — найди актуальное рядом с `meeting-extract-actions.service.ts` (`ai_ready`), не выдумывай.
- `Participant.personId` для гостей = null → пропускать, не падать.
- Если seed/маршрут LLM добавлен — зарегистрировать в `apply-prod-deploy.ts` STEPS.

## DoD (общий)
typecheck+lint+build (back+front) зелёные; все vitest; second-brain (operations/ai-jobs/workers-queues/data-model) + prod-deploy-log (Шаги 4/7/12) + feature-flags.md обновлены; реестр «не сделано» — строку 2026-06-21 закрыть; рефлексия в `05_история/`. Прод-инструкция блоком в чат после реализации.
