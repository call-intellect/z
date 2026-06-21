---
date: 2026-06-22
feature: subject-memory-program
distilled: false
---

# Память субъекта + самообучение — реализация 3 ТЗ (3 слоя, 11 фаз)

## Что было поставлено

Реализовать программу «Память субъекта + самообучение» — три независимых ТЗ, объединённых одной идеей «Кора помнит про субъекта и учится на уточнениях»:

- **Слой 3 — выученная память уточнений** (`plans/tz/2026-06-21-learned-clarifications-memory.md`): probe самообучается — из ответов на уточняющие вопросы выводятся правила (термин/дизамбигуация/предпочтение), активное правило подавляет повтор вопроса (retrieve-before-ask).
- **Слой 1 — авто-профиль компании в промпты** (`plans/tz/2026-06-21-company-profile-autobuild-and-prompt-context.md`): «Чем занимается компания» собирается из графа и подмешивается в SYSTEM chat-v2/concierge, чтобы помощник отвечал «от лица сотрудника компании». Закрывает давний пробел реестра «не-сделано» (профиль компании в промпт, строка 2026-06-14).
- **Слой 2 — маршрутизация задач по скиллам** (`plans/tz/2026-06-21-skill-based-task-routing.md`): подсказка «кому назначить» по скиллам (НИКОГДА не присваивает сама — Р1, 152-ФЗ).

## Как решал

Оркестрация фаза-за-фазой силами суб-агентов (картография реального кода → точный промпт кодеру → независимая приёмка грепом/re-Read + свой typecheck/lint/build/тесты → ревью → коммит по фазам). Три ТЗ велись как единая ветка `feature/2026-06-21-subject-memory-program`.

Ключевые развилки реализации:

- **BullMQ vs fire-and-forget для вывода правила.** Вывод правила из ответа на probe вынесен в очередь `core.subject-memory-derive` (`SubjectMemoryDeriveWorker`), а не в синхронный fire-and-forget хук. Причина: вывод переживает рестарт, ретраит при сбое LLM и не блокирует обработку ответа пользователя.
- **Cosine-порог вместо LLM для «то же правило».** Дедуп/supersede правил решается по `embedding` (`subjectMemory.matchMinSimilarity` 0.82), без отдельного LLM-вызова на «это то же самое правило?» — дёшево и детерминированно. LLM зовётся только на вывод правила и на judge-активацию.
- **Поле `canaryAt`.** Отдельной миграцией (`20260621164903_subject_memory_canary_at`) добавлено `canaryAt` — точка отсчёта окна авто-rollback canary (`subjectMemory.canaryRollbackWindowHours`). Без неё нельзя было отличить «давно в canary, опровержений нет → можно в active» от «только что в canary».
- **Вариант A для FE назначения исполнителя.** Присвоение предложенного исполнителя идёт существующим путём `addAssignee` (`POST /issues/:id/assignees`, `viaRouting:true`), а НЕ через новый `me/tasks/assign`. Причина: `me/tasks/assign` создаёт задачу во «Входящих», а тут задача уже есть — отдельный путь плодил бы дубли. `viaRouting:true` лишь инкрементит `routing_suggestion_accepted_total` и переиспользует то же уведомление `issue.assigned`.
- **Judge-ансамбль разными моделями.** Активацию правила (shadow→canary→active) решает не один судья, а кворум `subjectMemory.judgeQuorum` (2) из разных моделей (`subjectMemory.judgeModels` = `['deepseek-v4-flash','gpt-5.4-mini']`) — устойчивее к причудам одной модели, согласуется с правилом «self-improving агенты без human-in-loop» (composite judge вместо «админ нажми одобрить»).

## Что вышло

12 коммитов на ветке `feature/2026-06-21-subject-memory-program`:

- Слой 3: `7173d78d`, `6129c4f0`, `16fbc151`, `bfa7becb`.
- Слой 1: `c5fd6d49`, `7cde8e6e`, `4896a7ed`, `00798a4e`.
- Слой 2: `a183755e`, `fcddeccb`, `9b761a32`, `02ff3b66`.

typecheck/build/тесты зелёные по всем затронутым модулям (probe, company-foundation, tracker, knowledge-core). Новых seed/patch/backfill/migrate-скриптов НЕ создавалось — всё едет существующими STEPS `apply-prod-deploy.ts`: 3 миграции через `migrate deploy`; новый HNSW `subject_memory_embedding_hnsw_cosine_idx` через `apply-postgres-init` (`--with-schema`); 15 крутилок через уже зарегистрированный `seed-admin-settings.ts`; 4 LLM-маршрута через `seed-llm-task-routes-ideas-and-probe.ts` (паттерн `seed-llm-task-routes-${sub}` уже в STEPS). Все три фичи — Ship-On (выкатываются ON, kill-switch на случай инцидента): `subjectMemory.enabled` / `companyProfile.autoSummaryEnabled` / `taskRouting.enabled`.

Новые наблюдаемые точки: 2 @Cron (`SubjectMemoryActivationCron '35 * * * *'`, `CompanySummaryCompilerCron '45 * * * *'`), очередь `core.subject-memory-derive`, эндпоинт `POST /me/tasks/suggest-assignee` + concierge-tool `suggest_assignee`, метрики `subject_memory_*` / `company_summary_compile_total` / `company_capsule_injected_total` / `routing_*`.

## Чему научился

- **`Person.userId` связь.** Маршрутизация исполнителя стыкует skill-профиль (`SkillProfile.personId`) с назначаемым пользователем через `Person.userId` — путь `SkillTrait → SkillProfile.personId → Person → Person.userId → User`. Без этой связки нельзя превратить «у этого Person сильный навык X» в «назначить этому userId».
- **`SkillTrait → SkillProfile.personId` путь.** Семантический поиск идёт по `skill_traits.embedding`, но `SkillTrait` сам по себе не tenant/person-scoped напрямую — он висит на `SkillProfile`, и именно `SkillProfile.personId` даёт привязку к человеку. Запрос pgvector джойнит через `skill_profiles`.
- **`useAppointment`-флаг резолва роли.** Реальная роль человека для промпта берётся по `cfg.persons.useAppointment` (флаг миграции данных `USE_APPOINTMENT_FOR_PERSON_ROLES`): при `false` — старая модель `PersonRole`, при `true` — `Appointment`. `OrgContextService` должен уважать этот флаг, иначе `formatOrgContextForPrompt` отдаёт `role:null` (что и было багом до Слоя 2).
- **`CoreQueueService` авто-создаёт очереди из `CORE_QUEUE_NAMES`.** Чтобы завести новую BullMQ-очередь, достаточно добавить имя в `CORE_QUEUE_NAMES` (`SUBJECT_MEMORY_DERIVE = 'core.subject-memory-derive'`) — `CoreQueueService` поднимет очередь сам, ручной регистрации Queue/Worker-бойлерплейта меньше.
- **HNSW partial-index только на «живых» статусах.** retrieve-before-ask ищет правила только в `active`/`canary`, поэтому индекс `subject_memory_embedding_hnsw_cosine_idx` сделан partial (`WHERE status IN ('active','canary')`) — меньше и быстрее, чем индекс на всю таблицу с superseded/rolled_back/disabled.
