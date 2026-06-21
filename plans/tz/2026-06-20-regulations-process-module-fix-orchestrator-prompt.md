# Orchestrator-prompt — починка модуля регламентов/процессов/инструкций

Ты — `tz-orchestrator`. Реализуй ТЗ **`plans/tz/2026-06-20-regulations-process-module-fix.md`** фаза за фазой силами суб-агентов в отдельном git worktree, строго последовательно. Это твой контракт — всё нужное там; ниже только как стартовать и где факт-чекать.

## Порядок чтения на старте
1. `CLAUDE.md` + `.claude/CLAUDE.md` (инварианты, vexp-правило, без комментариев в коде, русский UI).
2. ТЗ `plans/tz/2026-06-20-regulations-process-module-fix.md` целиком — фазы, контракты, acceptance.
3. Доказательная база (зачем) — `plans/analysis/2026-06-20-regulations-process-module-audit.md`.
4. Код-якоря из ТЗ: `specialist-3-1-regulations.service.ts`, `prompts/regulation-extract.prompt.ts`, `prompts/process-template-extract.prompt.ts`, `services/router.service.ts`, `workers/entity-resolver.cron.ts` (образец крона), `curation/services/curation.service.ts` (механизм pending).

## Инструменты
- Поиск/осмотр кода: vexp `run_pipeline` первым; если демон жив — Grep/Glob заблокированы хуком. **Fallback:** vexp не подключён (как в сессии-авторе ТЗ) → Grep/Read.
- Внешние либы — Context7 (здесь не нужно: правок внешних API нет).
- **Номера строк в ТЗ дрейфуют** — перед каждой правкой re-Read по якорю-символу (в ТЗ якоря даны), не доверяй номеру вслепую.

## Граф фаз (строго последовательно)
**Ф1 → Ф2 → Ф3 → Ф4 → Ф5.** Каждая — отдельный суб-агент за сессию, со своей мини-картографией из ТЗ. После каждой фазы — независимая приёмка (греп-маркеры + re-Read + свой `bun run typecheck && lint && build` + `bunx vitest run <затронутый spec>`), затем коммит фазы. Push — только по явному подтверждению владельца.

## Факт-чек (НЕ верь отчёту суб-агента — `feedback_agents_can_lie_about_edits`)
После каждой фазы сам грепни ключевые маркеры из Acceptance ТЗ:
- Ф1: `ownerCompany`, `isKeepableOrgNorm`, `resolveOwnerCompanyPrior`, `reason:'not_our_org'`, `reason:'not_keepable'` в коде/схемах; дерево выбора `kind` в SYSTEM; снапшоты промптов обновлены; прогон `scripts/eval/run-regulations-audit.ts` даёт `ownerCompany=клиент` на клиентском кейсе и `isKeepableOrgNorm=false` на «как добавить ярлык».
- Ф2: `maxTokens` в вызове `dedupeArbiter`; метрика `dedupe_fallback_new`; при двойном сбое арбитра — `decision:'new'` + метрика, БЕЗ `curation.triage`/pending (человеко-НЕ-зависимый режим отказа); гарант от дублей — Ф5 (тот же релиз).
- Ф3: `regulationDedupeTopK` применён в обоих knn; `'instruction'` в union таблиц knn/арбитре.
- Ф4: в `processProcessStepBlock` при `draft.kind==='process'` НЕТ вызова `upsertProcess`, ветки переклассификации (regulation/policy/instruction) сохранены; `processTemplates` в `getSummary`; процессы видны на хабе из `ProcessTemplate`.
- Ф5: новый крон/воркер в `knowledge-core.module` + `WorkersModule`; консолидатор НЕ трогает `trustTier='human'` и пары с `CurationDecision` reject; kill-switch `regulationConsolidatorEnabled` в typed-config + строка в `feature-flags.md`; шаг в `apply-prod-deploy.ts`; идемпотентность разового прогона; миграция legacy `Process` (пометка `deprecated`, не удаление).

## Определение «фаза закрыта»
Все Acceptance-предикаты фазы выполнены машинно (греп/тест/команда), `Закрывает: R…` подтверждён, typecheck(.spec)/lint/build зелёные, изменения отражены в second-brain по таблице производных заметок. Только тогда — следующая фаза.

## Инварианты-стоп (нарушение = откат фазы)
- Никаких `prisma migrate` / `new PrismaClient()` / `process.env.*` (в скриптах — `createPrismaClient()` из `scripts/_lib/prisma.ts`, импорт `../src`).
- Новые флаги — Ship-On (kill-switch ON по умолчанию); строка в `feature-flags.md`.
- Промпты — cache-friendly (переменное только в USER).
- Без нарративных комментариев в коде; весь текст/вопросы — на русском.
- Развилка В-3 закрыта владельцем: ProcessTemplate каноничен. Ф4 НЕ убирает маршрут, а гасит `upsertProcess` в специалисте (сохраняя переклассификацию) — не «оптимизировать» в удаление route.

## Failure-modes
- Суб-агент отметил `[x]` без правок → факт-чек грепом выявит; вернуть на доделку.
- Гипер-фильтрация Ф1 (режет свои нормы) → контрольный кейс «наш код-ревью = наша/true» в acceptance обязателен.
- Раннавей LLM в Ф5 → проверить наличие TICK_LIMIT + lookback + negative-cache до выката.
