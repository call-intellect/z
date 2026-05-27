---
date: 2026-05-28
type: reflection
distilled: false
tags: [sprints, tracker, vendors, frontend, backend, orchestration]
---

# Спринты: master-detail список и расширенный мастер

## Что было поставлено

Два недоделанных пункта из родительского ТЗ
[2026-05-27-sprints.md](../../plans/tz/2026-05-27-sprints.md):

1. **Master-detail `/sprints`** — была заглушка-плейсхолдер «Список в разработке».
2. **Расширенный `SprintCreateWizard`** — работал только Вариант А (Cycle
   внутри существующего Project). Вариант Б (создать новый Project со scope
   = клиент/поставщик/отдел/сотрудник) не был реализован.

Владелец явно сказал «делаем без компромиссов» — мы сняли ограничение на
время и выбирали лучшее архитектурное решение каждый раз.

## Как решали

### Фаза 0. Семь архитектурных вопросов
Сформулировал 7 ключевых развилок текстом в чате с моими рекомендациями
и аргументами. Владелец согласился со всеми. Зафиксировано в
[plans/tz/2026-05-28-sprints-master-detail-and-wizard.md](../../plans/tz/2026-05-28-sprints-master-detail-and-wizard.md) §1.

Ключевые решения:
- `POST /api/v1/vendors` (полный паритет 4 scope-полей, а не «частичный
  скоуп с tooltip-обходом»).
- `POST /api/v1/sprints/quick-create` — атомарное создание Project+Cycle
  через `prisma.$transaction` с авто-генерацией slug/identifier и
  collision retry. Не два отдельных вызова с фронта.
- `GET /api/v1/sprints` — отдельный endpoint, не расширение
  `CyclesController`. Endpoint отражает продуктовый язык.
- Расширяем существующий `SprintCreateWizard`, не плодим V2.
- Person scope — двухступенчатый Role → Person через Appointment.

### Фаза 1. Параллельные агенты
Запустил два sub-агента в фоне через `Agent` tool:
- **Backend**: SprintsController/Service, VendorsService.create/update/softDelete,
  translit util, integration-тесты, smoke.
- **Frontend**: переписать SprintsListClient (master-detail), переписать
  SprintCreateWizard (6 scope с inline-create), api/domain/hooks/тесты.

Оба получили детальные промпты с явными требованиями:
- ветка `sergdev`;
- никаких миграций БД (schema уже содержит всё нужное);
- никаких новых seed-скриптов;
- ничего не коммитить и не пушить;
- финальный отчёт со списком файлов и выводом тестов.

### Фаза 2. Факт-чек
После завершения обоих агентов:
- Сверил DTO backend ↔ frontend 1:1 (`SprintListItemDto` ↔ `SprintListItemApi`,
  `QuickCreateSprintSchema` ↔ `QuickCreateSprintRequest`).
- Проверил URL: `/api/v1/sprints`, `/api/v1/sprints/quick-create`,
  `POST /api/v1/vendors` — совпадают.
- Проверил WebSocket event names: backend эмитит `sprint_hint.{created,
  updated, dismissed, resolved}`, frontend подписывается на те же —
  совпадают.
- Re-read ключевых файлов (`SprintsListClient.tsx`,
  `SprintCreateWizard.tsx`, `sprint-list-item.dto.ts`,
  `quick-create-sprint.dto.ts`, `sprints.api.ts`).

### Фаза 3. Свои проверки
- `bun run typecheck` backend + frontend — оба зелёные.
- `bun run lint` — 0 ошибок (2 pre-existing warnings в backend).
- `bun run test:unit` — 58 новых backend + 12 новых frontend, все 70/70 зелёные.
- `bun run test:integration` — 11/11 новых integration backend зелёные.
- `bun run build` frontend — зелёный, `/sprints` собран статикой.

## Что вышло

### Цифры
- **Создано:** 18 файлов (10 backend + 10 frontend, перекрытие — это
  утилиты/тесты).
- **Изменено:** 17 файлов.
- **Покрытие:** 58 backend unit + 11 backend integration + 12 frontend
  unit = 81 новый тест, все зелёные.
- **API:** +5 endpoint'ов (`GET /sprints`, `POST /sprints/quick-create`,
  `POST /vendors`, `PATCH /vendors/:id`, `DELETE /vendors/:id`).

### Архитектурные находки
1. **Атомарность quick-create.** Slug-collision retry с проверкой
   уникальности ВНУТРИ transaction (`tx.project.findUnique`) исключает
   race condition «два параллельных запроса застолбили один slug». Это
   важнее, чем экономия 30 минут на «два отдельных POST с фронта».
2. **`detectProjectScopeKind` вынесен в общий util.** Backend-агент
   аккуратно вынес функцию из `cycles.service.ts` в
   `tracker/utils/scope-detection.ts`, переиспользовал в SprintsService.
   Дублирование удалено.
3. **Combobox с inline-create.** Универсальный компонент поверх Popover
   + cmdk Command — переиспользуется для Vendor / Card / Department /
   Person. Кнопка «+ Создать «<query>»» появляется только если query не
   пустой и нет точного совпадения. Хороший паттерн для будущих форм.

### UX-решения
- **Master-detail на mobile** — список 100% + `Sheet` для detail. Не tabs,
  не вертикальный стек — Sheet современнее и используется по проекту.
- **Топ-3 SprintHint в preview** — главная ценность: можно скимить список
  и видеть проблемные спринты не открывая.
- **Парные цветовые токены** — `bg-chip-{kind}-bg` + `text-chip-{kind}-fg`,
  никаких hardcoded hex, никаких `text-white` на цветных фонах.

## Чему научился

1. **Стопроцентная факт-проверка после агента.** Frontend-агент честно
   сказал, что писал под контракт ТЗ, пока backend ещё работал. После
   завершения обоих я re-read'ом сверил DTO и URL — всё совпало 1:1
   потому что оба следовали ТЗ как single source of truth.
2. **Параллельные агенты не должны зависеть друг от друга.** Backend и
   frontend работали изолированно — общий контракт = ТЗ. Это сильно
   ускорило (оба ~25 минут параллельно вместо 50 последовательно).
3. **Без time-pressure решения качественнее.** Когда владелец снял «час
   серии», я переоценил Q1 (vendor) и Q5 (person) — стал A в обоих
   случаях. Архитектурный паритет важнее, чем сокращение пары часов.
4. **Pre-existing тестовые fail'ы — нормально, надо явно их верифицировать.**
   Оба агента честно отметили: «эти тесты ломались до моих изменений»,
   проверили через `git stash`. Я после факт-чека согласился — это не их.
5. **Документация second-brain важна сразу.** Когда я обновил
   `sprints.md` / `api-layer.md` / `frontend-pages.md` / `prod-deploy-log.md`
   параллельно с кодом — отсутствие конфликтов и понятные diff'ы.

## Открытые риски

- **Vendor `softDelete` без `delete` для manager** — manager может
  создавать поставщиков (write), но не удалять. Правильно для inline-create
  flow, но если manager создал по ошибке — не сможет удалить, нужен
  admin. Проверим на user-feedback после prod.
- **Person inline-create требует выбранной роли** — если у компании
  есть сотрудник без роли, его невозможно создать из мастера. UX-подсказка
  «Сначала выберите должность» снижает риск, но edge-case остаётся.
- **Slug-collision лимит 5 попыток** — если в компании 100+ одинаковых
  «ООО Альфа», часть упадёт с `slug_collision`. Маловероятно, но видно
  в логах.

## Источники

- ТЗ: [plans/tz/2026-05-28-sprints-master-detail-and-wizard.md](../../plans/tz/2026-05-28-sprints-master-detail-and-wizard.md)
- Родительское ТЗ: [plans/tz/2026-05-27-sprints.md](../../plans/tz/2026-05-27-sprints.md)
- Профильная заметка: [01_projects/sprints.md](../01_projects/sprints.md)
