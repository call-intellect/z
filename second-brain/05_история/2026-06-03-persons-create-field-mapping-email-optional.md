---
type: reflection
date: 2026-06-03
distilled: false
---

# 2026-06-03 — Не создаётся сотрудник: рассинхрон имён полей + email обязателен

## Постановка

Форма «Новый сотрудник» (`/structure?tab=persons`) при заполненных полях
отдавала `validation_error`: `path: name, "Имя сотрудника обязательно"`. Это
ТРЕТИЙ баг подряд про сотрудников, но другой по природе (не `tenant_required`):
запрос доходил до бэка (X-Org-Id был), падал на валидации тела. Найти,
доделать (включая инлайн-флоу), запушить.

## Что сделал

**Корень 1 — имена полей.** Фронт слал `{fullName, email, roleId, departmentId}`,
а бэкенд `CreatePersonSchema` ждёт `{name, email, primaryDepartmentId, roleId}`.
`personsDomainApi.create/update` (`frontend/src/api/structure.api.ts`) слали
UI-модель как есть, без маппинга → `name` отсутствовал → 403. Фикс: маппинг имён
в api-слое (`fullName→name`, `departmentId→primaryDepartmentId`); `update` мапит
только переданные поля. Коммит `19907a2c`.

**Корень 2 — email обязателен (доделка).** Тот же маппинг затронул все вызовы
`personsDomainApi.create`. `SprintCreateWizard` создаёт сотрудника по одному
имени + роль, без email — а `CreatePersonSchema.email` был required → после
маппинга он бы падал уже на «Email обязателен». Сделал `email` опциональным,
сервис подставляет `''` (как `quickCreate`). Проверил, что это не плодит дублей:
unique `(tenantId, email, deletedAt)` с `deletedAt=NULL` в Postgres не
ограничивает (NULL ≠ NULL в unique-индексе), поэтому несколько email-less
активных персон легальны. `createBatch` — цикл по `create`, не ломается.
Коммит `a6650bf0`.

Рассматривал перевод `SprintCreateWizard` на `quick-create` — отверг: тот не
принимает `roleId` (визард требует роль) и гейтится RBAC `event_card.write`
(не тот контекст). Email-optional в основном `create` — правильнее и покрывает
все пути одним изменением, без правки компонента.

Граблю записал в `02_architecture/code-pitfalls.md`.

## Что вышло

- Frontend: `structure.persons.spec.ts` (3 кейса маппинга), 3/3 зелёные,
  lint/tsc чисты.
- Backend: persons-модуль 17 passed (DTO email-less + сервис пишет email=''),
  typecheck/lint чисты.
- Запушено в `dev` двумя коммитами.

## Чему научился

1. **api-слой обязан говорить на контракте бэкенда, а не на UI-модели.** Если
   `*.api.ts` принимает UI-имена полей (`fullName`), он ОБЯЗАН смапить их в
   ApiDto перед отправкой. Интерфейс запроса с «доменными» именами без маппинга —
   тихая бомба. Проверять имена полей в теле против zod-схемы бэка.
2. **Postgres unique с nullable-колонкой не ограничивает строки с NULL.**
   `@@unique([..., deletedAt])` при `deletedAt=NULL` допускает неогр. дубли —
   это и позволило безопасно дефолтить `email=''`. Знать про NULL-distinct до
   того, как бояться unique-violation.
3. **Один фикс вскрывает соседний путь.** Маппинг полей «оживил»
   `SprintCreateWizard`, и тут же вылез его email-less кейс. Когда чинишь
   общий api-метод — проверять ВСЕХ его вызывающих, а не только репортнутый
   экран.
4. **Серия багов «про сотрудников» — три разных корня** (tenant_required путь,
   tenant_required header, field-mapping+email). Не экстраполировать «уже
   чинил похожее» — каждый верифицировать отдельно по фактическому ответу.

## Что осталось

- Хвостов нет. Все пути создания персоны (форма с email, инлайн без email,
  batch) покрыты.

## Прод-команды

Не нужны — пересборка `backend` и `frontend` образов. Миграций/seed/ENV нет
(schema.prisma не менялся — `email` и так non-null в БД, опциональность только
на уровне Zod-DTO).
