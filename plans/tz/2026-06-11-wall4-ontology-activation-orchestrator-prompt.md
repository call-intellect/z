# Orchestrator-prompt — Wall4 Ontology Activation

Реализуй ТЗ `plans/tz/2026-06-11-wall4-ontology-activation.md` как `tz-orchestrator`: фаза за фазой, силами суб-агентов, в отдельном git worktree, с независимой приёмкой.

## Порядок чтения на старте
1. `CLAUDE.md` + `.claude/CLAUDE.md` (Ship-On §8, Prisma `prisma:migrate` НЕ db push, prod через `docker compose exec`).
2. `second-brain/index.md`, `02_architecture/knowledge-core.md`, `02_architecture/company-memory-overview.md`, `01_projects/decisions.md`, `01_projects/skill-and-clone.md`.
3. ТЗ целиком, особенно **REALITY-CHECK** и **Принятые решения владельца Р1–Р3** (не пересматривать).
4. Анализ-вход: `plans/analysis/2026-06-11-kora-moat-and-competitive-defensibility.md` (Стена 4).

## Инструменты
- Код — `vexp run_pipeline` первым (не grep/glob при живом демоне); `get_skeleton` для осмотра; `Read` для дословных правок. Fallback (демон недоступен): Grep/Read.
- Внешние либы — Context7. В этом ТЗ внешних новых зависимостей нет.

## Граф фаз (три параллельные волны)
- **A‑волна:** A1 (backend stalled-эндпоинт) → A2 (frontend страница + виджет).
- **B‑волна:** B1 (backfill) → B2 (recovery-surface) → B3 (включить 3 флага bitemporal ON).
- **C‑волна:** C1 (docs-фикс claim) ∥ C2 (модель+эндпоинт+UI фидбека) → C3 (активация CLONE_V2 на всех тенантах + матрица).
- Блоки A/B/C независимы между собой — можно вести как 3 волны параллельно; внутри блока — строго последовательно.

## Факт-чек (не верь отчёту суб-агента — «агенты могут лгать про [x]»)
После каждой фазы сам: re-Read изменённые файлы + `git status`; грепни ключевые маркеры:
- A: роут `decisions/stalled` в `operations.controller.ts`; страница `app/(authenticated)/dashboard/operations/decisions/stalled/page.tsx` рендерится не 404.
- B: backfill-скрипты в `apply-prod-deploy.ts` `STEPS`; 3 флага в `feature-flags.md` как kill-switch ON; recovery `restore` идемпотентен.
- C: таблица `clone_answer_feedback` в миграции; эндпоинт фидбека upsert (`@@unique`); грепы `stylistic|стиль работы|стиль письма` по `second-brain/06_marketing/` = 0; `CLONE_V2_ENABLED` строка owner-decision в `feature-flags.md`.
- Свой `bun run typecheck && lint && build` (back и front) + `bunx vitest run` новых spec — зелёные ДО коммита фазы.

## «Фаза закрыта» =
Все Acceptance фазы машинно подтверждены тобой (не агентом), `Закрывает: Rx` трассируется, typecheck/lint/build/тесты зелёные, second-brain/feature-flags/prod-deploy-log обновлены по DoD. Коммит по фазам (Conventional Commits). Push — только по явному подтверждению владельца.

## Failure-modes (на что смотреть)
- Ship-On: ни один флаг не остаётся OFF «понаблюдаем» — либо kill-switch ON, либо owner-decision ON с матрицей.
- Bitemporal: edge-закрытие уже работало без флага — при включении retrieval-фильтра следить за `temporal_edges_invalidated_total`; recovery (B2) готов ДО включения (B3).
- Prisma: `prisma:migrate` (НЕ db push); скрипты — `createPrismaClient()` из `scripts/_lib/prisma.ts`, импорты `../src`, никаких `new PrismaClient(`/`process.env.*`.
- Клоны: smoke на ХОЛОДНОМ тенанте (анти-фальшивка → отказ, не галлюцинация) и БЕЗ матрицы (доступ запрещён).
- Прод-команды — только `docker compose exec backend …` (см. runbook в ТЗ).
