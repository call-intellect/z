# Orchestrator-prompt — employee-clone-binding-resolution

Запусти `tz-orchestrator` по ТЗ `plans/tz/2026-06-30-employee-clone-binding-resolution.md`. Это ПЕРВЫЙ ТЗ серии `employee-clone-build-hardening` (кластер C1).

## Порядок чтения на старте
1. `CLAUDE.md` + `.claude/CLAUDE.md` (vexp-правила, конвенции Z).
2. `plans/architecture/2026-06-30-employee-clone-build-hardening.md` (одобрено, замысел) — кластер C1, Р9–Р11.
3. `plans/tz/2026-06-30-employee-clone-binding-resolution.md` — контракт (REALITY-CHECK, фазы, R1–R11, сниппеты).
4. `plans/analysis/2026-06-30-employee-clone-build-audit-and-risk-solutions.md` §C1 — обоснование (для «почему так», не оптимизировать).
5. Якоря кода (перед правкой ПЕРЕЧИТАТЬ — номера строк дрейфуют, искать по символу):
   - `backend/src/modules/knowledge-core/services/entity-resolution.service.ts` — `resolveRoleByHint` (~:700), `resolvePersonByHint` (~:750), `resolveSubjectEntityId` (~:1403).
   - `backend/src/modules/knowledge-core/services/specialist-3-1-regulations.service.ts` — entry-points `resolveOwnerPersonHint` (~:333,592,854,1114), `deriveForRole` (~:1293), `resolveOwnerPersonHint` def (~:1755).
   - `backend/src/modules/knowledge-core/services/specialist-3-2-knowledge-clone.service.ts` — `loadBlocksForPerson` (~:380).
   - `backend/src/modules/knowledge-core/workers/block-ingest.worker.ts` — `attributeSubject` (~:1482), образец вызова `resolveRoleByHint` (~:318).
   - `backend/src/modules/knowledge-core/services/role-scope.util.ts`, `backend/prisma/schema.prisma:2361-2365` (композитный FK Person↔Entity).

## Инструменты
- vexp `run_pipeline` первым (лимит сбрасывается в полночь UTC); демон жив → Grep/Glob заблокированы хуком → fallback Bash `find`/`ls` + `Read`. Bash `grep -n` рабочий для точечной локализации.
- Context7 не нужен (внешних API не вводим).

## Граф фаз
- **Ф1 → Ф2** (backfill scope переиспользует helper Ф1 — строго последовательно).
- **Ф3, Ф4, Ф5 — независимы** (можно параллельными волнами после/рядом с Ф1).
- Порядок коммитов: Ф1, Ф2, Ф3, Ф4, Ф5 (каждая — отдельный коммит по acceptance).

## Факт-чек (не верь отчёту суб-агента)
- После Ф1: `grep -n "resolveScope" specialist-3-1` → helper + 4 вызова `draft.scope = await this.resolveScope`; нет второй копии поиска роли (единый `EntityResolutionService`/`resolveRoleIdByName`).
- После Ф4: `grep -n "entityTenantId" specialist-3-2-knowledge-clone.service.ts` → присутствует в `person.update` (оба поля FK).
- Запреты (грепнуть дифф): нет `process.env.`, `new PrismaClient(`, `prisma migrate`, нарративных комментариев.
- Идемпотентность backfill — повторный `--apply` = 0 изменений (прогнать дважды).
- Свой прогон: `bun run typecheck` (вкл. `.spec`) · `bun run lint` · `bun run build` · `bunx vitest run <spec фазы>`.

## Определение «фаза закрыта»
Все Acceptance-предикаты фазы выполнены машинно (грепы/unit/сборка зелёные), строка `Закрывает: Rn` подтверждена, дифф без запретов. Только тогда коммит и следующая фаза.

## Failure-modes
- Нет инжекта `EntityResolutionService` в `specialist-3-1` → добавить в конструктор (оба в `KnowledgeCoreModule`, циклов нет).
- Backfill не бутстрапит Nest → переиспользовать чистый `resolveRoleIdByName(prisma, tenantId, hint)` (экстракция из Ф1), не копировать логику.
- Запись `entityId` без `entityTenantId` → битый композитный FK (обязательны оба).

## DoD/прод
ТЗ §DoD + §Idempotency. Diff прода: **Шаг 8** — 2 backfill в `STEPS`. Миграции схемы/ENV/postgres-init нет. Рефлексия + prod-deploy-log при закрытии.
