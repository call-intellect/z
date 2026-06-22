# Orchestrator-prompt — clone-signaltype-methodology-step

Ты — главный оркестратор-разработчик (скилл `tz-orchestrator`). Реализуй ТЗ `plans/tz/2026-06-22-clone-signaltype-methodology-step.md` фаза за фазой силами суб-агентов, с независимой приёмкой.

## Порядок чтения на старте
1. `CLAUDE.md` + `.claude/CLAUDE.md` (инварианты, vexp-правило).
2. ТЗ `plans/tz/2026-06-22-clone-signaltype-methodology-step.md` — целиком.
3. Доказательная база: `plans/analysis/2026-06-22-clone-module-prod-test/RESULTS.md` (Находки №1/№2 + корень).
4. Код-якоря (перечитать перед правкой — номера строк дрейфуют, искать по тексту литерала `['reasoning', 'rationale', 'decision_basis']` и якорям из ТЗ).

## Инструменты
- vexp `run_pipeline` первым для картографии; при живом демоне Grep/Glob заблокированы — fallback Explore+Read, если демон недоступен.
- Context7 не нужен (внешних библиотек правка не вводит).

## Граф фаз (строгий порядок)
- **Ф1** (константа + рубежи 1-3) и **Ф2** (рубеж 4) — параллельны (разные файлы), обе обязательны.
- **Ф3** (backfill) — только после Ф1.
- **Ф4** (тесты + прод-acceptance) — после Ф1+Ф2+Ф3.
Коммит по фазам; push — только по явному подтверждению владельца.

## Факт-чек (не верь отчёту суб-агента)
После каждой фазы — сам:
- `grep` маркеров из Acceptance фазы (`methodology_step`, `SKILL_SUBJECT_SIGNAL_TYPE*`, отсутствие старого литерала);
- re-Read изменённых строк (агент мог отметить [x] без правки — `feedback_agents_can_lie_about_edits`);
- свой прогон `cd backend && bun run typecheck && bun run lint && bun run build`; для Ф4 — `bunx vitest run <файл>`;
- `git status` целиком (не сломан ли соседний spec).

## Критичные ловушки (из ТЗ)
- **Скрытый второй гейт:** правка `specialist-3-7-skill.service.ts:530` без `specialist-3-7-skill.worker.ts:69-83` = «молчит на новых встречах». Оба обязательны в Ф1.
- **Не сужать subject-набор:** в `block-ingest.worker.ts:43-50` только ДОБАВИТЬ `methodology_step` (там 6 типов, включая expertise/experience/competence — их не терять).
- **`motivation` — не signalType** (это layer); в `signalType:{in:[...]}` не вписывать.
- enum `SignalType` не менять (methodology_step уже есть) → миграции/`prisma:generate` НЕ нужны.
- Скрипт: `createPrismaClient()` из `_lib/prisma`, импорты из `../src`, регистрация в `apply-prod-deploy.ts` STEPS (`phase:'backfill'`).

## Определение «фаза закрыта»
Все Acceptance-предикаты фазы выполнены и подтверждены твоим грепом/re-Read/сборкой; second-brain и prod-deploy-log обновлены по DoD; коммит сделан.

## Прод-выкат (после реализации, делает владелец)
diff-инструкция в ТЗ §«prod-deploy»: `up -d --build` → backfill-скрипт → форс `SkillTraitVerifyCron.tick`. Прод-acceptance Ф4 верифицируется на Org `cmpuz4gbs000201mvfbf3k2zk`, носитель `cmpzl0mee00065gnq9vm3ajv1`.
