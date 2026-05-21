---
title: Wizard «Знакомство с компанией»
phase: 0c
status: in_progress
date: 2026-05-21
references:
  - plans/tz/2026-05-21-phase-0c-onboarding-wizard-frontend.md
  - plans/analysis/2026-05-21-user-cabinet-design.md §8, §13
---

# Wizard «Знакомство с компанией»

## Что это
5-шаговый wizard первого входа owner'а в новую Org. URL `/onboarding/company/step-{1..5}`.
AppShell скрыт (см. `AuthenticatedShell.tsx`).

## Шаги
1. **Отделы** — POST /api/v1/departments по одному или /batch.
2. **Должности** — POST /api/v1/roles (с departmentId).
3. **Сотрудники** — POST /api/v1/persons (с roleId, primaryDepartmentId). userId=null до accept'а приглашения.
4. **Должностные инструкции** — для каждой Role drag-drop файл → POST /api/v1/documents (attachedRoleId=roleId). Опционально.
5. **Готово** — GET /api/v1/structure/summary, переход на /dashboard.

## Состояния
- Гард: только owner. Если `Department.count > 0` — redirect /dashboard.
- Прерывание: кнопка в layout, возвращает на /dashboard с баннером «Незавершённое знакомство».
- Однократность: после прохождения wizard'а доступ к нему запрещён (Department.count > 0).

## Edge cases
- Wizard падает посреди step-3 (7 сотрудников создано из 10) → возвращается, видит 7 в форме, продолжает.
- Owner создал отделы, не дошёл до шага 4 → виджет «Незавершённое знакомство» на дашборде, ведёт на актуальный шаг.

## Не входит в Фазу 0
- CSV-импорт сотрудников (γ).
- Шаблоны индустрий.
- Прохождение admin'ом без owner'а.
