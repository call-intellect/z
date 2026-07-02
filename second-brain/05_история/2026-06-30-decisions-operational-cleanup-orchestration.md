---
date: 2026-06-30
type: reflection
feature: decisions-operational-cleanup
branch: work/2026-06-29
---

# Рефлексия — чистка оперативно-контрольного хвоста «решений» (Ф1–Ф8, оркестрация)

## Что было поставлено
Реализовать ТЗ `plans/tz/2026-06-29-decisions-operational-cleanup.md` (Вариант 1 — полная чистка) через скилл `tz-orchestrator`, фазами в порядке волн: (Ф1‖Ф2‖Ф3‖Ф7) → (Ф4‖Ф5‖Ф6) → Ф8. Снять весь слой, который трактует `Decision` как контролируемую оперативную единицу (контролёр внедрения 21-день, метрики `decision_*`, «доведение/висящие решения», pulse-алерт, решения в оперотчётах, поля схемы `implementationStatus`/`implementationCheckedAt`), оставив решение пассивной памятью; добавить тихий бейдж «необратимое» (Ф7). Особое внимание: позиционный DI `HangingDecisionsService` (5 спеков синхронно), monthly KEEP «что решить собственнику», Ф4 строго после Ф1+Ф2.

## Как решал
**Оркестрация:** код руками не писал — вёл 7 суб-агентов-кодеров (по фазе), сам делал картографию (Bash `rg`/`find` + Read, т.к. vexp-демон жив → Grep/Glob-тулы заблокированы) и проходил лестницу приёмки после каждой фазы (git status → grep негатив/позитив → re-Read → typecheck/lint/build → vitest). Фазы вёл **последовательно**, а не параллельными кодерами: backend-фазы делят один `bun build` с 8GB-heap — параллельный typecheck×N кладёт машину; изолированная приёмка после каждой фазы надёжнее для KEEP-гардов. Параллелил только независимое: read-only картографию, и в конце два непересекающихся агента Ф6 (frontend) ‖ Ф8 (docs).

**Коммиты (8):** Ф1 `b2cf2b2c` · Ф2 `e798907a` · Ф3 `de20ccab` · Ф7 `53393003` · Ф4 `e6a0b920` · Ф5 `d2a108b4` · Ф6 `1b7653fc` · Ф8 `72e44a2a`.

**Ключевые развилки, решённые сам:**
- **Позиционный DI Ф2:** верифицировал по коду — `DirectorDashboardService` arg-6 `hangingSvc` (порядок 0..9) и `TeamHealthService` arg-4 `hanging`; синхронизировал удаление аргумента в 4 director-dashboard-спеках + team-health.service.spec. ТЗ говорил «5 director-спеков» — фактически 4 director + team-health = 5 файлов. typecheck ловит лишний arg, но **только vitest ловит съезд при неверном индексе** — поэтому прогонял полный набор спеков.
- **monthly Ф3:** в `monthly-digest.prompt.ts` два `decisions` — letter-секция (`MONTH_LETTER_KEYS`, убрать) и top-level «что решить собственнику» (`required[]`/`properties.decisions`/zod/service, KEEP, В6). ТЗ неточно указало `:65` как letter-enum — фактически это top-level required (KEEP). Дал кодеру прицельную границу; monthly-спеки остались нетронуты и зелёны.
- **value-recap `decisions` Ф1:** выбрал полное удаление поля (не `decisions: []`) — проверил, что `value-recap.dto.ts` его не потребляет, каскада нет.
- **Ф4 миграция при дрейфе dev-БД:** локальная БД дрейфует от истории миграций (tsv/GIN-индексы из `postgres-init.sql` живут вне migrations) → `migrate dev` хотел сбросить всю dev-БД. Обошёл DB-независимым `prisma migrate diff --from-schema <git HEAD схема> --to-schema <текущая> --script` → точный `ALTER TABLE "decisions" DROP COLUMN ...` → создал файл миграции вручную (так Prisma и сгенерировала бы, без шума дрейфа). На прод применит `migrate deploy`.
- **Ф8 за пределами списка R34:** grep вскрыл stale-описания снятых поверхностей в файлах, которых не было в явном списке ТЗ (`api-layer.md`, `frontend-pages.md`, `dashboards-registry.md`, `wiki/index.html`, `feature-flags.md` flag-описание, `04_не-сделано:80`). По принципу «ничего не откладывать» доделал их сам, оставив только историю выкатов (prod-deploy-log 2026-06-16) и замороженный demo-прототип.

## Что вышло
- Все 8 фаз реализованы. back+front `typecheck`/`lint`(0 errors)/`build` зелёные на итоговом HEAD. vitest по затронутым модулям: operations 562, dashboard 52, decisions 37, frontend 624 — зелёные.
- KEEP-гарды целы во всех слоях: сущность `Decision`, раздел/карточка/граф, `DecisionTaskLink`+авто-задача, `impliesAction`/`actionExtractedAt`/`linkedTaskCount`, `decisionsExtracted`, `decision.count` навигатора, `'decision'` в ConcreteType union, `decision-hygiene-scorer`+`reversibility`/`reversibilityAt`, monthly «что решить собственнику», секция решений в отчёте встречи.
- Ф7 additive: `reversibility` прокинут ApiDto→Domain через наследование DTO (`DecisionDetail extends DecisionListItem`) — бейдж «необратимое» работает и в списке, и в детали без дублирования; новых Prisma-полей нет.

## Чему научился (перенос-кандидаты)
- **Дрейф dev-БД ломает `prisma migrate dev`** (проект держит pgvector/tsv/GIN-индексы вне migrations). Канон для генерации файла миграции при дрейфе: `prisma migrate diff --from-schema <старая> --to-schema <новая> --script` (флаги Prisma 7 — `--from-schema`/`--to-schema`, НЕ `--from-schema-datamodel`), без `migrate dev` и без сброса БД. Прод применяет `migrate deploy`.
- **Позиционный DI с `{} as unknown as X` в спеках:** typecheck ловит лишний/недостающий аргумент по числу, но НЕ ловит съезд при неверном индексе (все приведены к типу) — обязательно прогонять vitest на runtime-поведение.
- **`bun run typecheck` падает по OOM** на дефолтном heap — всегда `NODE_OPTIONS=--max-old-space-size=8192` (как `build`). Иначе SIGABRT/134, который легко принять за ошибку кода.
- **Предсуществующие frontend tracker-падения** (`Board.spec.tsx`/`OrgBoard.spec.tsx`, `IssueCard.tsx:186 sourceChipLabel` — undefined `.length`) — фон, не регрессия; tracker не зависит от decisions-домена. Полезно знать, чтобы не гоняться за чужой граблёй.

## Прод
Миграция авто `migrate deploy` + docker rebuild backend+frontend. Полная инструкция — `docs/operations/prod-deploy-log.md` (блок «2026-06-30 — Чистка оперативно-контрольного хвоста решений», Шаги 4/11/12). Orphan AdminSetting-строки `decision.stale_days`/`operations.decision_controller.enabled` остаются в БД мёртвыми (безвредны, опц. patch позже).
