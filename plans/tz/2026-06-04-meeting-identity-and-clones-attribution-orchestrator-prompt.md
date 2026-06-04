# Orchestrator-prompt — Identity участника + атрибуция клонов

> Запусти `tz-orchestrator` с этим промптом в **новой сессии**. ТЗ написано и согласовано (владелец: «реши всё сам»). Это самодостаточный вход — тело ТЗ не дублируется, читай его по ссылке.

## Что реализуем
ТЗ: **`plans/tz/2026-06-04-meeting-identity-and-clones-attribution.md`** — сквозная identity участника встречи + детерминированная атрибуция `IdeaBlockEntity.role='subject'` (оживление клонов) + приглашение сотрудников из списка + доставка (email/Telegram) + `assigneeUserId` в активном fast-воркере + единый путь голос→задача в трекере (Ф5). Корневой документ-аудит: `plans/analysis/2026-06-04-meetings-invite-identity-and-clones-graph-audit.md`.

## ⚠️ Зависимость от параллельного МТЗ (важно перед стартом)
На той же ветке реализуется **`plans/tz/2026-06-04-razblokirovka-konveyera.md`** (разблокировка конвейера встреча→граф→специалисты). Наш Ф1 (атрибуция) оживляет клонов только при рабочей трубе — его Ф1–Ф4/Ф7. Его **Ф9 даёт `PersonsService.ensurePersonForUser`** — наша Ф1.1 ВЫЗЫВАЕТ его (User→Person), затем `ensurePersonEntity` (Person→Entity); НЕ дублировать. Обе правят `schema.prisma` и `persons.service.ts` — **`git pull`/rebase ПЕРЕД стартом**, добавлять, не перезатирать их `@@unique`/`ensurePersonForUser`. Полная карта пересечений — в разделе ТЗ «Зависимости и пересечения с МТЗ».

## Порядок чтения на старте
1. `CLAUDE.md` + `.claude/CLAUDE.md` (инварианты, vexp-правило, git-правила).
2. `second-brain/index.md` → `01_projects/skill-and-clone.md`, `02_architecture/knowledge-core.md`, `02_architecture/data-model.md`, `telegram-user-flows.md`.
3. Само ТЗ целиком (фазы, Acceptance, граф зависимостей, «Принятые решения» Р1–Р5 — НЕ пересматривать).
4. Якоря кода из ТЗ — **re-Read каждый перед правкой** (номера строк дрейфуют, ищи по символу).

## Инструменты
- vexp `run_pipeline` — если демон поднят (тогда Grep/Glob блокируются хуком — это норма). **Если vexp недоступен — Grep/Glob/Read напрямую** (в аудит-сессии vexp был недоступен, работало именно так).
- Context7 — перед правкой API внешних либ (Prisma upsert по композитному ключу, nestjs-zod, prom-client).

## Граф фаз (волны)
- **Волна 1:** Ф0 (Prisma + identity-backbone) — строго первой.
- **Волна 2:** Ф1 (атрибуция subject) ∥ Ф2 (приглашение) — после Ф0.
- **Волна 3:** Ф3 (доставка) ∥ Ф4 (голос→задача) → Ф5 (единый путь голос→задача в трекере: 5.1 identity-резолвер после Ф4; 5.2 консолидация/репойнт — отдельной под-волной, blast radius) — после Ф0/Ф2.
- Между волнами без остановки: зелёная верификация → commit по фазам → следующая волна в том же ответе (`feedback_orchestration_no_stop_between_waves`). **`git push` — только с явным подтверждением владельца.**

## Факт-чек (не верь отчёту суб-агента — `feedback_agents_can_lie_about_edits`)
После каждого кодера — **сам** грепни ключевые маркеры до приёмки фазы:
- Ф0: `grep "ParticipantInvitationStatus" schema.prisma`; `grep "isRegisteredUser && " participant-context.service.ts`; `grep "speakerParticipantId" common.ts merger.ts`.
- Ф1: `grep "role: 'subject'" block-ingest.worker.ts` (теперь ДОЛЖНО быть в write, не только read); `git diff --stat block-ingest.prompt.ts block-extraction.service.ts` = пусто; backfill зарегистрирован в `apply-prod-deploy.ts STEPS`.
- Ф2: `grep "ParticipantPicker" CreateMeetingFormV2.tsx`; `grep "invitees" create-meeting.dto.ts`.
- Ф3: `grep "'meeting.invite'" conversational.service.ts`; `grep "MEETING_INVITE_TEMPLATE" mail.templates.ts`.
- Ф4: `grep "assigneeResolver" meeting-report-fast.worker.ts`; `git diff --stat meeting-report-fast.prompt.ts` = пусто.
- Ф5: `grep "loadForMeeting\|TaskAssigneeResolver" meeting-extract-actions.service.ts` (identity-резолв вместо substring); для 5.2 — контракт-тест Public API `GET /meetings/:id/tasks` (форма ответа сохранена) + 6 потребителей репойнтнуты на Issue по `linkedMeetingId`.
- В промпт каждому кодеру: «re-Read после каждого Edit + `git status` в отчёт».

## Определение «фаза закрыта»
Все Acceptance-предикаты фазы зелёные (грепы/мини-e2e/команды) + `bun run typecheck && lint && build` (backend и/или frontend) зелёные + затронутые `bunx vitest run` зелёные. Только тогда commit `тип(область): …` и переход к следующей фазе.

## Инварианты-ловушки (специфика этого ТЗ)
- **Не трогать LLM-промпты** block-ingest и meeting-report-fast (Р2/Р5) — атрибуция и резолв детерминированные, иначе ломается prompt-cache.
- `prisma:push` only, никогда `migrate*`; после правки схемы — `prisma:generate`.
- Скрипты: `createPrismaClient()` из `scripts/_lib/prisma`, импорты из `../src`, регистрация в `apply-prod-deploy.ts STEPS`.
- Крутилка `subjectAttributionEnabled` — **AdminSetting**, не ENV/хардкод.
- UI приглашения — только русский, парные токены `bg-*`+`text-*-fg`, без `text-white`/hex/slate.
- `Task.assigneeUserId` и `enum IdeaBlockEntityRole.subject` **уже есть** — миграции для Ф1/Ф4 не нужны.
- Каждый knowledge-запрос — с `tenantId`.

## Failure-modes
- Если Ф1.1 (Person.entityId) не закрыт — backfill (1.3) запишет 0 subject (entityId=null). Порядок внутри Ф1 строгий: 1.1 → 1.2 → 1.3.
- Если Ф0.2 пропущен — Ф4 не зарезолвит приглашённых (userId обнулён). Ф0 строго до Ф4.
- Двойные Participant — проверить единый join (Ф0.4) на host-ветке.

## После реализации (триггеры завершения из CLAUDE.md)
- Обнови second-brain по таблице производных заметок (DoD ТЗ).
- Перенеси 2 строки из `second-brain/04_не-сделано/README.md` («Открыто» → «Закрытые (архив)») с коммитом.
- `docs/operations/prod-deploy-log.md` Шаги 4/7/8/12 + блок «📋 Prod-инструкция» в чат.
- Рефлексия в `second-brain/05_история/`.
