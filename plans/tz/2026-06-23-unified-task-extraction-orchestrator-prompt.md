# Orchestrator-prompt: Унификация извлечения задач на общий спайн

Запуск скилла `tz-orchestrator` по ТЗ `plans/tz/2026-06-23-unified-task-extraction.md`. Это самодостаточный стартовый промпт; **тело ТЗ не дублируется — читай ТЗ как источник правды.**

## Порядок чтения на старте
1. `CLAUDE.md` + `.claude/CLAUDE.md` (инварианты, vexp-first, Ship-On, §9 крутилки).
2. `plans/tz/2026-06-23-unified-task-extraction.md` — **полный текст** (фазы, контракты, Acceptance, решения владельца Р-1…Р-5, Б-1).
3. Анализ-вход: `plans/analysis/2026-06-22-unified-extraction-spine-and-modular-extractors.md` (матрица, ADR, red-team) — для «почему так».
4. Код-якоря (перечитать перед правкой — номера строк дрейфуют, ищи по символу): `router.service.ts` (SPECIALIST/PRIORITY/matchSpecialists/COMBINED_COVERED), `specialist-routing-dispatcher.worker.ts` (Map+register), `specialist-3-14-goals.{worker,service}.ts` (образец контракта), `assignee-resolver.service.ts` (AssigneeResolution), `task-dedup.service.ts` + `meeting-task-dedupe.service.ts` + `cross-source-task-dedupe.service.ts`, `intake-auto-triage.worker.ts`, `intake.service.ts`, `migrate-task-to-issue.ts`, `schema.prisma` (SignalType enum :463-470, Task :1779-1800, TaskSource).
5. `second-brain/02_architecture/knowledge-core.md` — конвейер спайна.

## Инструменты
- vexp `run_pipeline` первым (при живом демоне Grep/Glob заблокированы хуком); `get_skeleton` для осмотра. Context7 — если трогаешь API внешних либ (Prisma миграция enum, BullMQ guard). Fallback при мёртвом демоне — Explore+Grep/Read.

## Граф фаз (строго последовательно)
**Ф1 (спайн-специалист) → Ф2 (единый резолвер) → Ф3 (единый дедуп) → Ф4 (Task пред-слой+промоут).** Параллелить нельзя: Ф2 нужна Ф1-специалисту, Ф3 — после единого резолвера, Ф4 — после единого дедупа. Каждая фаза — один кодер-суб-агент за сессию; back+front в одной фазе → 2 последовательных кодера.

## Факт-чек (не верь отчёту агента)
После каждого кодера — лестница «Проверка» сам: `git status` (изменены ровно нужные файлы) → греп ключевых маркеров (`action_item` в enum; `TASKS: '3-15-tasks'` в router; `register(Specialist315Tasks...)` в диспетчере; удалён `TaskAssigneeResolverService`-импорт в Ф2; общий dedup-util в Ф3; промоут в Ф4) → re-Read критичной логики → typecheck(вкл .spec)/lint/build → vitest затронутого модуля целиком → Acceptance построчно из ТЗ. Суб-агенты иногда врут про `[x]` — грепай факт.

## Определение «фаза закрыта»
Все Acceptance-предикаты фазы зелёные сам-прогоном + `strict-production-review-gate` по diff (гонка дедупа Ф3, guard, kill-switch ON/Ship-On, идемпотентность, multi-tenancy, потеря данных) + коммит `feat(tracker): Ф<N> — …` явными путями. Ни одного «отложу» — хвост либо в scope, либо vNext-ТЗ (см. §5 ТЗ).

## Ключевые предостережения (из ТЗ/анализа)
- **Б-1:** meeting-extract-actions НЕ переписывать на IdeaBlock — спайн-специалист только для НЕ-meeting каналов. Не трогать работающий meeting-экстрактор.
- **Р-3:** `3-15-tasks` НЕ добавлять в `COMBINED_COVERED`.
- **Р-1:** `Task` НЕ дропать, читателей НЕ переписывать — только пред-слой + промоут.
- **Р-2:** дедуп — link через `TaskSource`, не delete (delete только within-meeting).
- **Ship-On:** kill-switch `tracker.taskExtractionMode`/`taskDedupLinkSemantics` дефолт ON, только аварийный откат; строки в `feature-flags.md`.
- **Гонка дедупа (Ф3):** BullMQ сам не идемпотентен — обязателен конкурентный guard (`@@unique`/advisory-lock).
- Миграция enum только `prisma:migrate` + STEPS + prod-deploy-log Шаг 4; крутилки в AdminSetting через getDynamic (НЕ ENV/хардкод).

## Failure-modes
- Тег `action_item` не проставляется → спайн-специалист молчит: проверь покрытие тегирования метрикой ДО приёмки Ф1.
- Удаление дубль-резолвера ломает импорты: греп всех потребителей ДО удаления (Ф2).
- Параллельная сессия в общем каталоге: работай в отдельном git worktree (`git worktree add ../z-task-extract -b feature/2026-06-23-unified-task-extraction`), `git fetch`+`git log` перед стартом.

Push — только по явному подтверждению владельца.
