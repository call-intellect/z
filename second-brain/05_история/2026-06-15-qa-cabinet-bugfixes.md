---
title: QA-багфиксы кабинета (Ф1–Ф6) + возврат «Ваши предложения» в меню
date: 2026-06-15
type: reflection
---

# QA-багфиксы кабинета — рефлексия 2026-06-15

## Что было поставлено
Два ТЗ через оркестратор:
1. `plans/tz/2026-06-15-cabinet-qa-bugfixes.md` — 7 фаз по итогам прод-QA
   (`plans/analysis/2026-06-15-qa-cabinet-full-test-bugs.md`). Порядок: тур →
   должность → задачи → Главная → чеклист → локализация → (интент отдельно).
2. `plans/tz/2026-06-15-restore-feedback-menu-item.md` — вернуть `/feedback` в меню.

Ветка `feature/cabinet-qa-bugfixes` от `feature/cabinet-master-fixes`.

## Как решал (по фазам, с файлами)
- **Ф1 (тур, QA B4/B5):** `TourBackdrop.tsx` — добавлен `pointer-events-none`
  (backdrop не блокирует клики), убран мёртвый `onClick`-проп. `welcome.ts` —
  «Пропустить» у шагов 1–5 `kind:'next'`→`'skip'` (закрывает тур + персист
  `skipped`). Тест степпинга в `TourProvider.spec.tsx` переведён на `tour.next()`.
- **Ф2 (должность в «Я», QA B3):** выровнял `MyProfileApi` по факту backend
  `MeProfileDto` (`primaryRole`/`primaryDepartment`/`person.{id,name,email}`),
  поправил читателей `MeClient.tsx`/`MyPositionCard.tsx`. Вскрыл доп. дефект:
  `/me/profile` не отдаёт `roleProfile.summaryCache` → «Моя карта должности»
  всегда заглушка → ТЗ `2026-06-15-me-role-map-card-contract.md`.
- **Ф3 (очередь «В задачи», QA B1/B8):** **смена дизайна по решению владельца** —
  вместо пикера проекта дефолт-проект «Входящие» (тот же per-tenant проект, что
  у авто-приёма входящих: `intake.service.ensureInboxProjectId`, find-or-create
  по имени, owner=Org owner, network 0). Ошибка `target_project_required` больше
  не возникает. Тост `ActionsClient` — реальная причина (`humanizeApiError`).
  Перенос задачи в другой проект (обещание владельца) отсутствует в коде → ТЗ
  `2026-06-15-issue-move-to-project.md`.
- **Ф4 (valueStrip 22023, QA B2):** раздельные guard-предикаты `jsonb_typeof AND
  jsonb_array_length` → единый `CASE WHEN ... THEN ... ELSE false` в ОБОИХ местах
  (`director-dashboard.service.ts`, `chat-v2-feedback.service.ts`). Тест-гарды
  на наличие CASE в SQL.
- **Ф5 (чеклист 0/6, QA B6):** backend `OnboardingService.getSetupProgress` —
  6 вех «timestamp ИЛИ факт существования сущности» + эндпоинт
  `GET /orgs/:orgId/setup-progress`; фронт берёт прогресс с бэка.
- **Ф6 (локализация, QA B10):** суб-агентом, frontend-рендер: team-templates
  (teamTemplateCategoryLabel), /week (IDEA_STATUS_LABEL/INSIGHT_KIND_LABEL),
  интеграции (TYPE_META + «Мастер за 4 шага»), меню темы (THEME_LABEL).
- **Ф7 (интент):** вынесено отдельным ТЗ — калибровка LLM, не строчный баг.
- **ТЗ2:** пункт «Ваши предложения» (`Lightbulb`) в `nav-config.ts` секция
  «Система» + гард в `nav-subset.spec.ts`.

## Что вышло (верификация)
- backend: typecheck + build зелёные; тесты intake/pending-actions/onboarding/
  dashboard/chat-v2 (95+ в ключевых модулях) зелёные; lint 0 errors.
- frontend: typecheck + lint (0 errors) + полный build + 492 unit-теста зелёные.
- Фактчек агента Ф6 грепом — сырые строки убраны.
- Не проверено вживую на проде (по расписанию/после выката): фактическое
  исчезновение 22023 и `target_project_required` из прод-логов — это прод-наблюдение.

## Чему научился
- **Реплику владельца «(интент отдельно)» нельзя выдавать за «указание оформить
  заглушку»** — это была моя интерпретация; владелец справедливо переспросил.
  Урок: формулировать «вынес отдельно по природе задачи + рекомендации ТЗ», не
  приписывать дословную инструкцию.
- **Дефолт-проект уже существовал** («Входящие», `intake-auto-triage.worker.ts`
  resolveInboxProjectId). Прежде чем строить «Общие задачи» по slug — нашёл
  существующий механизм и переиспользовал ИМЯ проекта (консистентность ручного и
  авто-триажа в одну папку). DRY-вынос в `ProjectsService.ensureInboxProject` —
  отложен, чтобы не трогать W4-воркер и его тесты (риск регресса автономки).
- **Выравнивание контракта вскрывает соседние ложь-типы:** `MyProfileApi`
  лгал не только про role/department, но и про `roleProfile` (summaryCache) —
  второй дефект того же эндпоинта.
- `ProjectsService.create(dto, tenantId, userId)` — порядок аргументов dto-первый.
