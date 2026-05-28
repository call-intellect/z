---
date: 2026-05-29
task: Онбординг v2 — реализация ТЗ (7 фаз, 6 экранов + 2 тура + hover-подсказки)
status: done
commits:
  - 6ce15db
  - 527c2e3
  - 1c46b82
  - 5c51c62
  - 6628644
  - fba29c1
  - 2cd68b8
---

# Онбординг v2 — реализация

## Что было поставлено

Реализовать ТЗ `plans/tz/2026-05-29-onboarding-v2.md`:
- Backend: Prisma schema (enum + 14 полей), OnboardingModule (4 эндпоинта), side-effect'ы в 5 сервисах, backfill
- Frontend: 6 экранов знакомства, action-тур (6 шагов с kind:'navigate'), overview-тур (18 шагов), hover-подсказки, шаблоны по индустрии, IncompleteSetupBanner, кнопки перезапуска туров в /settings

## Как решал

### Фаза 1 — Backend (до меня)
- Prisma schema: enum `UserCompanyRole`, 2 поля User, 12 полей Org
- `OnboardingModule`: 4 эндпоинта + `onboarding-labels.ts`
- Side-effect'ы в 5 сервисах (departments, roles, invitations, sprints, meetings)
- Backfill-скрипт + регистрация в `apply-prod-deploy.ts`

### Фаза 2 — Словарь (я)
- `nav-help.ts`: 43 записи (было 23)
- Hover-tooltip в `Sidebar.tsx` (уже был)
- Commit: `6ce15db`

### Фаза 3 — Шаблоны (до меня)
- `department-templates.ts`: 8 индустрий
- `role-templates.ts`: 18 отделов + `_default`
- Интеграция в `DepartmentsClient` и `RolesListClient`

### Фаза 4 — Block A (я)
- 6 page.tsx: step-1 (роль), step-2 (размер), step-3 (индустрия), step-4 (боли), step-5 (стек), step-6 (модули)
- `OnboardingShell`: прогресс-бар, кнопка «Назад»
- `onboarding.api.ts`: patchWelcome, completeWelcome, patchUserRole, completeSetup
- Redirect-guard в `AuthenticatedShell`: `profileCompletedAt=null → /onboarding/welcome/step-1`
- Commit: `5c51c62`

### Фаза 5 — Block B (я)
- `welcome.ts`: 6 шагов с `kind:'navigate'` (company → departments → roles → team → sprint → meeting)
- `TourOverlay`: поддержка `kind:'navigate'` (router.push + next)
- `WelcomeTourAutoStart`: проверка `Org.setupCompletedAt` через `useOrgSetup`
- `TourCompletionModal`: финальный pop-up между турами
- `IncompleteSetupBanner`: N из 6 на дашборде
- Sidebar: `data-tour-target` + `data-overview-target`
- Commit: `fba29c1`

### Фаза 6 — Block C (я)
- `overview.ts`: 18 шагов (intro + 17), тексты из NAV_HELP
- Автозапуск через `TourCompletionModal` (1 сек → `startIfNotCompleted('overview')`)
- `/settings?tab=tours`: кнопки запуска туров + сброс
- Commit: `2cd68b8`

### API types (я)
- `OrgApi`: 12 новых полей онбординга
- `AccountUser`: `profileCompletedAt`
- `useOrgSetup`: SWR-хук для setupCompletedAt
- Commit: `1c46b82`

## Что вышло

### Верификация
- `bun run typecheck` (frontend + backend): ✅ 0 ошибок
- `bun run lint` (frontend + backend): ✅ 0 ошибок, 2 pre-existing warnings

### Коммиты (7 штук)
1. `6ce15db` — nav-help.ts (43 записи)
2. `527c2e3` — Backend Фаза 1
3. `1c46b82` — Frontend API types
4. `5c51c62` — Block A (6 экранов)
5. `6628644` — Шаблоны
6. `fba29c1` — Block B (action-тур)
7. `2cd68b8` — Block C (overview-тур)

Все запушены в `origin/sergdev`.

## Чему научился

1. **TourProvider + TourOverlay** — контекст туров с поддержкой `kind:'navigate'` (router.push + next) и `TourCompletionModal` (pop-up между турами).

2. **Redirect-guard** — `AuthenticatedShell` проверяет `profileCompletedAt` и редиректит на `/onboarding/welcome/step-1` для новых пользователей.

3. **Side-effect'ы в сервисах** — обновление полей прогресса Org при создании сущностей (departments, roles, invitations, sprints, meetings) через `updateMany` с условием `{ поле: null }`.

4. **Backfill-скрипт** — идемпотентный, обрабатывает батчами по 100, использует `createPrismaClient()` из `_lib/prisma`.

5. **data-tour-target vs data-overview-target** — для разных туров нужны разные атрибуты, чтобы не конфликтовали.

6. **IncompleteSetupBanner** — считает N из 6 по полям `*CompletedAt`, показывает оставшиеся шаги, кнопка «Продолжить» вызывает `forceStart('welcome')`.
