---
title: Пакет улучшений дашбордов (ТЗ B/D/C/G/E)
date: 2026-06-05
type: reflection
distilled: false
---

# Пакет улучшений дашбордов (ТЗ B/D/C/G/E)

## Что было поставлено

Пакет из 5 ТЗ улучшений дашбордов (ветка `feature/dashboards-improvements`), реализованных силами суб-агентов через `tz-orchestrator`, без push:

- **ТЗ-B** — [`plans/tz/2026-06-05-goal-vector-compass.md`](../../plans/tz/2026-06-05-goal-vector-compass.md): «компас целей» на главной директора — главная цель компании (`Goal.isPrimary`) + вектор «что двигает к ней / от неё».
- **ТЗ-D** — [`plans/tz/2026-06-05-weekly-per-person-plan-fact.md`](../../plans/tz/2026-06-05-weekly-per-person-plan-fact.md): недельный план-факт по людям (обещано/закрыто/просрочено per Person) — потребовал атрибуции автора обещания.
- **ТЗ-C** — [`plans/tz/2026-06-05-operations-dashboards-redesign.md`](../../plans/tz/2026-06-05-operations-dashboards-redesign.md): редизайн операционных панелей (KpiHero + зоны + SWR, `whoShined` в ежедневном, русификация единиц).
- **ТЗ-G** — [`plans/tz/2026-06-05-employee-pulse-and-people-at-risk.md`](../../plans/tz/2026-06-05-employee-pulse-and-people-at-risk.md): «люди под риском» (pulseScore на лету + topReason, пороги в AdminSetting).
- **ТЗ-E** — [`plans/tz/2026-06-05-personal-cabinet-me.md`](../../plans/tz/2026-06-05-personal-cabinet-me.md): личный кабинет «Я» с вкладками (self-режим Pulse, перенос срока обещания, отписка от соцвклада).

## Как решал

Фаза за фазой, с **независимой приёмкой каждой**: греп ключевых маркеров в файлах → re-Read изменённых мест → собственный прогон `typecheck` / `lint` / `build` / `vitest` (не доверяясь отметкам `[x]` суб-агента). Локальные коммиты по фазам — итого **23 коммита**, ни одного push (по договорённости — пакет уходит на ревью целиком).

Порядок шёл по зависимостям: сначала схема (B: `Goal.isPrimary` + partial unique `goal_primary_unique`; D: `IdeaBlock.commitmentAuthorPersonId` + relation `CommitmentAuthor` + 2 индекса), затем backend-атрибуция автора обещания (`block-ingest.worker.attributeCommitmentAuthor` под флагом `knowledge.commitmentAuthorAttributionEnabled`, backfill истории), потом read-сервисы/эндпоинты и фронт.

## Что вышло

Все 5 ТЗ завершены, верификация зелёная (typecheck/lint/build/vitest). Ключевые артефакты:

- **2 новые колонки БД:** `Goal.isPrimary` (+ `@@index`, + partial unique вне schema.prisma), `IdeaBlock.commitmentAuthorPersonId` (+ relation `CommitmentAuthor` / обратка `Person.commitmentsAuthored`, + 2 индекса).
- **4 новых эндпоинта:** `GET /api/v1/dashboard/operations/weekly-per-person`, `GET /api/v1/dashboard/people-at-risk`, `PATCH /api/v1/me/promises/:blockId/reschedule`, `GET|POST /api/v1/me/social-contribution/opt-out`. Плюс расширение `GET /dashboard/pulse-patterns` (`goalVector.primaryGoalId/proScore/contraScore/byDepartment`) и `GET /me/social-contribution` (`constructiveFeedbackCount`).
- **3 новых сервиса:** `WeeklyPerPersonService` (operations), `PeopleAtRiskService` (dashboard), `SocialContributionPreferenceService` (helpfulness, Redis-preference).
- **Фронт:** `CompassWidget` (SVG-компас) вместо списка целей; виджеты план-факта по людям и «людей под риском»; кабинет «Я» с вкладками + редиректы старых `/me/*` URL, удалена мёртвая `/me/dashboard`.
- **1 backfill:** `backend/scripts/backfill-commitment-author.ts` (зарегистрирован в `apply-prod-deploy.ts` STEPS, phase backfill, skipBootstrap).
- **5 порогов AdminSetting** `peopleAtRisk.*` (code-fallback, сид не обязателен на первом этапе).

C и E схему не трогают (опираются на derive из evidence и Redis-preference). Прод-инструкция выписана в [`docs/operations/prod-deploy-log.md`](../../docs/operations/prod-deploy-log.md) (Шаги 4/5/8/1/12).

## Чему научился (грабли сессии)

- **Параллельные суб-агенты в общем git working tree видят правки друг друга.** Когда несколько кодеров работают в одном дереве, незакоммиченные изменения соседа попадают в их сборку — нужен **финальный консистентный прогон** typecheck/build/тестов на собранном дереве после всех фаз, а не только пофазная приёмка.
- **`Glob` иногда даёт ложное «No files found»** на путях, которые реально существуют. Факт-чек — через `git ls-files <glob>` (он не врёт); на нём же нашёлся реальный список профильных заметок.
- **Кодер-суб-агент может оборваться до проверок** (отметить фазу готовой, не прогнав typecheck/build). Оркестратор обязан **сам** прогонять верификацию — отметки `[x]` от агента не доказательство (подтверждает feedback «агенты могут лгать про [x]»).
- **Скобки `()` / `[]` в путях ломают bash-грепы** без правильного `cwd` (route-группы `(authenticated)`, `[id]`). Грепать с явным `cwd` в корень репо и экранированием, либо через dedicated-инструмент Grep, а не сырой `rg` в Bash.
