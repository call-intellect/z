# Orchestrator-prompt — knowledge-graph-ingestion-rebuild

Реализуй ТЗ `plans/tz/2026-06-23-knowledge-graph-ingestion-rebuild.md` как `tz-orchestrator`: фаза за фазой, силами суб-агентов, в отдельном git worktree, строго по графу зависимостей. Не пиши код сам — оркеструешь, принимаешь, коммитишь по фазам, push по подтверждению владельца.

## Порядок чтения на старте
1. `CLAUDE.md` + `.claude/CLAUDE.md` (инварианты, **Prisma = версионируемые миграции `prisma:migrate`, НЕ db push**).
2. `plans/analysis/2026-06-23-knowledge-graph-ingestion-audit/99-synthesis.md` (+ `07-redteam.md`) — почему гибрид и почему не GraphRAG-батч. Не пересматривать.
3. Само ТЗ — фазы, контракты, Acceptance, REALITY-CHECK, Принятые решения владельца Р1–Р7.
4. `second-brain/02_architecture/knowledge-core.md`.

## Инструменты
- vexp `run_pipeline` первым (если демон жив); иначе Explore + Read/Grep. `get_skeleton` для осмотра.
- Context7 для внешних либ (pgvector/Zod/BullMQ) при сомнении в API.
- Картография ПЕРЕД каждой фазой: перечитать якоря (`path:line` дрейфует — сверять по символу, не по номеру).

## Граф фаз (из ТЗ)
- Параллельно стартуют: **Ф1, Ф3, Ф5, Ф6** (независимы).
- **Ф2, Ф4** — после Ф1. **Ф8** — независима, нужна Ф7.
- **Ф7** — после Ф4 + Ф6 + Ф8. **Ф9** — после корректности Ф1–Ф8. **Ф10** — последняя (живой re-test на проде, qa-tester/diag).
- Между волнами без остановок: зелёная верификация → commit → следующая волна; push — с подтверждением.

## Факт-чек (не верь отчётам суб-агентов)
- После каждого агента: re-Read изменённых файлов + греп ключевых маркеров (имена guard-функций, `sourceTitle`, `EntityAlias`, крутилки в `admin-setting-schema-registry.ts`, `Theme.summary`) ДО коммита.
- Свой прогон `bun run typecheck` (вкл. `.spec`) · `lint` · `build` · `bunx vitest run <затронутый spec>` — независимо от «[x]» агента.
- Дизъюнктность волн по РЕАЛЬНЫМ файлам: Ф3 и Ф6 оба трогают `block-ingest.worker.ts`/`block-extraction.service.ts` — НЕ запускать в одной параллельной волне без разведения по функциям; смотреть весь `git status` перед коммитом.

## Определение «фаза закрыта»
Acceptance фазы (машинные предикаты + команды) зелёные на твоём прогоне + строка `Закрывает: Rn` трассируется + затронутые `*.spec.ts` зелёные + (для схемных фаз) миграция идемпотентна (`migrate deploy` повторно = no-op).

## Failure-modes (из Pre-mortem ТЗ)
- Ф6: проверить, что ложное `supersedes/contradicts` НЕ удаляет факт (только `validUntil`); композитный судья требует согласия ≥2.
- Ф5: alias-cache не склеивает cross-tenant (tenantId в `@@unique`); fail-closed на неоднозначном.
- Ф9: bi-temporal ON меняет выдачу (скрывает superseded) — это цель; убедиться, что kill-switch заведён в `feature-flags.md`.

## Прод
После push — блок «📋 Prod-инструкция»: diff команд по затронутым Шагам `prod-deploy-log.md` (миграции Ф1/Ф5/Ф8 → Шаг 4; крутилки/флаги → Шаг 1/7; theme-summarize → Шаг 12). Новые seed/patch — зарегистрировать в `apply-prod-deploy.ts` STEPS.

Старт — по явному «начни реализацию» владельца.
