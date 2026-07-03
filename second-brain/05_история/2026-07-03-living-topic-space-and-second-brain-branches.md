---
date: 2026-07-03
title: Реализация двух парных фич — «Живое пространство темы» + «Второй мозг по 12 веткам»
type: reflection
feature: living-topic-space, second-brain-by-branches
distilled: false
---

# Рефлексия — living-topic-space + second-brain-by-branches (11 фаз, tz-orchestrator)

## Что было поставлено
Реализовать два готовых парных ТЗ через `tz-orchestrator` в автономном режиме (развилки решаю сам с доказательством, возврат к владельцу — только по завершении всего кода):
- `plans/tz/2026-07-02-living-topic-space.md` — пользователь заводит тему, Кора **сама** наполняет её ≥ порога 0.72 (opt-out), лишнее убирается в исключения; живой вид; мост «обязательство → задача».
- `plans/tz/2026-07-02-second-brain-by-branches.md` — карта 12 областей компании (read-only надстройка), деривация ветки из связей.

## Как решал (11 фаз, суб-агенты + приёмка мной)
Оркестрация: я делал картографию (Bash/Read, vexp free-capped не докрывает backend), писал самодостаточные промпты кодерам (`general-purpose`), каждую фазу **сам** прогонял по лестнице (grep-маркеры → re-Read логики → typecheck 8GB-хип → vitest → eslint → build для DI → поведение). Порядок:
- **LTS**: Ф1 модель (`229c108e`) → Ф2 сервисы+rbac (`41ae5351`) → Ф3 воркер+крутилки (`3d58ff80`) → Ф4 HTTP-API (`599fba33`) → Ф5 мост (`128e844a`) → Ф6 фронтенд (`cbdb8471`).
- **SBB**: Ф1 branch-derivation (`6f8ff03d`) → Ф2 branches-API (`a4c6763e`) → Ф3+Ф4 фронтенд карта/область (`7cdc0120`).
Параллелил кодеров **только на непересекающихся файлах** (SBB Ф1 ∥ LTS Ф3; LTS Ф6 ∥ SBB Ф2), последовательно — где общий файл (`themes.controller.ts`, `business-metrics.service.ts`, `knowledge-core-api.module.ts`).

## Ключевые автономные решения (с обоснованием)
1. **Миграция hand-write + `migrate deploy`, а не `migrate dev`.** В репо был out-of-order pending `20260624170000_chatbox_chat_title` (timestamp раньше применённых `20260702`); `migrate dev` в Prisma 7 при этом склонен предложить reset (риск потери локальной БД) + в non-TTY падает. `migrate deploy` детерминирован, применяет pending по порядку, без shadow-DB/reset, = прод-путь.
2. **Идемпотентность `ThemeExclusion` — app-level `findFirst`-guard, а не `@@unique` с NULL.** PG16 в unique-индексе трактует NULL как различные (NULLS DISTINCT) → `@@unique([themeId,kind,blockId,entityId])` не ловит дубли block-исключений (entityId всегда NULL). `NULLS NOT DISTINCT` не эмитится Prisma → расхождение schema↔DB. Решение: контракт `@@unique` оставлен + реальная идемпотентность в коде unpin (findFirst→conditional create).
3. **`canCreateTeamTheme` = owner/admin/manager/coo/super.** «Менеджер+» = управленческие роли; hr_partner (HR-специфична) и demo_observer (read-only) исключены. Метод добавлен in-place в RbacService.
4. **Авторизация — на контроллере, сервисы чистые.** `knowledge-core.module` не импортирует `RbacModule`; чтобы не плодить связывание — весь authz (canCreateTeamTheme, owner-гард) в контроллере (Ф4), сервисы Ф2 — доменная логика без прав. Стандартное слоение NestJS.
5. **Чистая `selectAutofillCandidates` + `cosineSim`** вынесены из IO — детерминированный юнит-тест на фикстурах; крутилки — параметром в `fillTheme(opts)`, резолвит вызывающий.
6. **`TypedConfigService.themeAutofillOpts()` — async `getDynamic`** (по образцу `documentLimits()`), не resolveSync: свежие значения → kill-switch срабатывает на следующем проходе крона; единый источник для крона и fill-on-create.
7. **5-я крутилка `theme.autofill.dedupeSimilarity`** (0.97) — чтобы честно закрыть R3 «near-дубль не кладётся» тестируемой функцией, без магической константы (принцип №9). Первичный дедуп — фильтр `status='canonical'` (block-merge уже схлопнул near-identical).
8. **Мост Ф5 переиспользует `ProjectsService.ensureInboxProjectId` + `IssuesService.create`** (`CreateIssueDto` принимает `sourceBlockIds`/`externalId`/`skipDedup`). Идемпотентность — `externalId='theme-commitment:themeId:blockId'` + `findFirst`. Задача↔тема — транзитивно через `sourceBlockIds` (та же связь, что читает секция tasks живого вида).
9. **Сигнал области SBB — чистая функция от `Theme.dynamic`** (declining→red, all-growing/пусто→green, иначе yellow) — детерминизм на enum-значениях, крутилка-порог не нужна.
10. **SBB — read-time деривация + in-memory бакетизация** (один запрос на деривацию, не N+1), SMB-масштаб; reversibility у Decision не смоделирован → в DTO `null` (честно).

## Что вышло (верификация — своими руками)
- Все 11 фаз: typecheck (8GB) 0 ошибок, vitest зелёный (10+10+4+6/20+3/23+4+9+4 новых тестов по фазам), eslint 0 errors.
- **Финальный backend `bun run build`** (`tsc -p tsconfig.build.json && copy-assets`) — `BUILD_EXIT=0`: весь DI (новые контроллеры/сервисы/крон/мост/TrackerModule) собирается вместе.
- **Frontend `bun run build`** — Compiled successfully, роуты `/themes/[id]`, `/memory`, `/memory/[branch]` собраны.
- Миграция применена локально (`migrate deploy`), колонки/таблица/enum/FK на партиции (p0–p63) проверены в БД; сид крутилок прогнан **дважды** (created=5 → updated=5, идемпотентно), значения в БД верны (0.72/true/50/14/0.97).

## Чему научился / грабли
- **`bunx prisma format` разносит `schema.prisma`** (файл не в каноническом формате — 210 строк diff). Не запускать; новые поля выравнивать вручную (Prisma парсит независимо от пробелов).
- **`bun run build`/`tsc` на дефолтной куче → `Abort trap: 6`/OOM** на этой машине; всегда `NODE_OPTIONS=--max-old-space-size=8192`.
- **FK на партиционированную таблицу** создаёт per-partition констрейнты (ThemeExclusion→IdeaBlock_p0..p63) — это норма, подтверждает работу составного tenantId-компаньона.
- **lucide-иконки нельзя сериализовать server→client props** — REGISTRIES пришлось держать внутри client-компонента карты «Памяти».
- **Приёмка ловит то, чего отчёт агента не показывает**: агенты честно рапортовали «зелёно», но `@Optional()`-инъекции сервисов (Ф4) требовали ручной проверки null-гардов; build-echo в фоновом subshell иногда не флашится при exit 0 — снял неоднозначность финальным синхронным build.

## Осталось / на ручную приёмку
- **Playwright-скриншоты** живой страницы темы и карты областей (ТЗ Ф6/SBB Ф3-4) — требуют живого стенда; сделать через `qa-tester` после прод-выката (код собран, готов).
- **Метрика длительности агрегации карты** `z_branches_map_ms` — при росте >~5000 сущностей на Org триггерит vNext-материализацию `branch` колонкой (зафиксировано в ТЗ SBB, «Вне scope»).
