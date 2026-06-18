# Orchestrator-prompt — Слой метода клона

Реализуй ТЗ `plans/archive/2026-06-11-clone-persona-method-layer.md` как `tz-orchestrator`: фаза за фазой, суб-агентами, в отдельном git worktree, с независимой приёмкой.

## Порядок чтения
1. `CLAUDE.md` + `.claude/CLAUDE.md` (Ship-On §8; Prisma `prisma:migrate` НЕ db push; prod через `docker compose exec`; LLM — DeepSeek/proxy, embeddings text-embedding-3-small).
2. `second-brain/01_projects/skill-and-clone.md`, `02_architecture/company-memory-overview.md`.
3. ТЗ целиком: **REALITY-CHECK** (90% конвейера готово), **Принятые решения Б1–Б7** (не пересматривать), **анти-scope** (не психотип/оценочные оси).
4. Анализ-вход: `plans/analysis/2026-06-11-clone-depth-and-persona-method.md`.

## Инструменты
- Код — `vexp run_pipeline` первым; `get_skeleton` для осмотра; `Read` для дословных правок. Fallback: Grep/Read.
- Внешних новых зависимостей нет — Context7 не нужен.

## Граф фаз
- **Э0.1** (clone-respond grounding+журнал) ∥ **Э1** (Э1.1 миграция RolePrinciple+layer → Э1.2 Reflection-cron, Э1.3 value-detector) ∥ **Э2.1** (активация PracticeSkill + process-marker) ∥ **Э3.1** (CDM-probe).
- **ИНТ.1** (persona-compile v2) — KEYSTONE, зависит от Э1.2+Э1.3+Э2.1.
- **ВАЛ.1** (валидация по поведению) — зависит от ИНТ.1.

## Ключевые «не сломай / не дублируй»
- **RPD = PracticeSkill (Б3): НЕ строить новую RPD-модель.** Активировать + скомпилировать в persona. Греп-проверка: новых моделей под «методологию» нет, кроме `RolePrinciple`.
- **Reflection синтезирует ПРОЦЕСС роли, не черту человека** (Б2/R4): промпт `role-principle-synthesize` запрещает диагностическую лексику; composite-judge отклоняет character-суждения.
- **process-marker — только конструктивные оси** (R7): никаких avoidant/dependent/«избегает/не решает сам».
- **persona-compile v2 — правила процесса с якорями, не ярлыки** (Personality Illusion, Б4); пустые секции опускаются (деградация к текущему поведению).
- **CDM через probe — только текст/голос, без inline-кнопок** (`feedback_probe_no_buttons_text_voice_only`).
- **Самообучение без human-approval-гейта** (Б6, `feedback_no_human_in_loop`); валидация по ПОВЕДЕНИЮ, не самоотчёту.
- Prisma — `prisma:migrate --name clone_method_layer` (НЕ db push); скрипты — `createPrismaClient()`, импорты `../src`; стабильный SYSTEM (cache); все флаги kill-switch ON в `feature-flags.md`.

## Факт-чек (не верь отчёту суб-агента)
После каждой фазы: re-Read + `git status` + грепы маркеров (`RolePrinciple`, `SkillTraitLayer`, секции persona-v2, отсутствие новой RPD-модели, отсутствие оценочных осей) + свой `bun run typecheck && lint && build` + `bunx vitest run` новых spec — зелёные ДО коммита фазы. Коммит по фазам; push по подтверждению владельца.

## «Фаза закрыта»
Все Acceptance машинно подтверждены тобой, `Закрывает: Rx` трассируется, second-brain/feature-flags/prod-deploy-log обновлены (DoD).
