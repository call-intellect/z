---
type: reflection
date: 2026-06-03
distilled: false
---

# 2026-06-03 — Баг активации подписки в админке: @UsePipes валидировал @Param → 400

## Постановка

В Z-Admin супер-админ не мог назначить подписку Org:
`POST /api/v1/admin/orgs/:tenantId/billing/activate` → **400 Bad Request**
(«Ошибка валидации входных данных»), при этом форма заполнена корректно
(period=monthly, seatsExtra=0, mode=bonus, reason=«111»). Задача: найти, починить,
протестировать, и заодно проверить весь админский контур биллинга/подписок/тарифов.

## Что сделал

**Диагностика.** Тело фронта валидно (проверил `safeParse` руками). 400 шёл из
`ZodValidationPipe` (`common/pipes/zod-validation.pipe.ts`). Контроллер использовал
`@UsePipes(new ZodValidationPipe(AdminActivateBodySchema))` на **уровне метода**.
NestJS прогоняет такой пайп через ВСЕ параметры хендлера; пайп не смотрит на
`metatype` и слепо делает `schema.safeParse(value)`. Первым параметром шёл
`@Param('tenantId')` — строка → объектная схема падала `expected object, received
string` → 400 до бизнес-логики. Доказал минимальным e2e (`@UsePipes`+`@Param` → 400,
`@Body(pipe)`+`@Param` → 201).

**Масштаб.** Тот же паттерн в 6 контролерах. Сломаны все методы, где кроме `@Body`
есть ещё параметр: admin-billing (activate/adjust-seats/force-status/mark-paid/void),
billing-кабинет (pay/card, pay/bank-invoice — `@CurrentOrg`), admin-referrals
(mark-paid/void/close-period), referrals (create/update), public-referrals
(attribution — `@Ip`/`@Headers`).

**Фикс.** Перевёл все на канон проекта — пайп на уровне параметра
`@Body(new ZodValidationPipe(schema))` / `@Query(...)`. Удалил неиспользуемые импорты
`UsePipes`. Фронт не трогал — он шлёт валидное тело.

**Защита от регресса:**
- ESLint `no-restricted-syntax` в `backend/eslint.config.mjs` запрещает
  `@UsePipes(new ZodValidationPipe(...))` (добавил селектор в существующий блок
  с cypher-запретом, чтобы не перетереть его правило — в flat-config два блока с
  одним ключом `no-restricted-syntax` => побеждает последний).
- e2e на реальный `AdminBillingController` (`admin-billing.controller.e2e.spec.ts`):
  activate → 201, byUserId/tenantId доходят до сервиса, reason<3 → 400.
- Регрессионный e2e `zod-validation-pipe-param.e2e.spec.ts` фиксирует разницу.

Коммит `4c97ac53` (fix), запушен в `dev`. Записал граблю в
`02_architecture/code-pitfalls.md` (раздел «NestJS — валидация DTO»).

## Что вышло

- 5/5 новых тестов зелёные; существующие billing/referrals/inn-lookup — 189 passed.
- `eslint` затронутых файлов — 0 ошибок; правило проверено на временном файле-нарушителе
  (срабатывает) и на исправленном коде (чисто).
- `typecheck` затронутых файлов — без ошибок. Фоновые ошибки typecheck в
  knowledge-core/tables/tracker — нерегенерированный Prisma-клиент + отсутствующий
  `exceljs`, к правке не относятся.
- Прод-операций нет (только код backend, без миграций/seed/ENV).

## Чему научился

1. **`@UsePipes(pipe)` на методе ≠ валидация только тела.** NestJS применяет
   method/class-scoped пайпы ко ВСЕМ аргументам. Кастомный пайп, игнорирующий
   `metatype`, обязан жить на уровне параметра (`@Body(pipe)`/`@Query(pipe)`).
   В следующий раз — никогда не ставить объектную zod-схему через `@UsePipes`.
2. **Латентный баг прятался за «рабочим» прецедентом.** `payCard` с `@UsePipes` тоже
   был сломан, но «вроде работал» — потому что pay-flow просто не дёргали. Нельзя
   считать «эндпоинт рядом использует тот же паттерн» доказательством корректности —
   надо воспроизводить.
3. **Эмпирика вместо теории.** Сначала казалось «пайп ломает всё», но `payCard`
   с `@CurrentOrg` опроверг гипотезу на вид. Решил минимальным e2e за минуту, а не
   спорил с интуицией.
4. **Flat-config ESLint: правила с одним ключом не мёржатся.** Два блока, оба с
   `no-restricted-syntax`, → для общего файла побеждает последний. Селектор добавил
   в существующий массив, а не отдельным блоком.

## Что осталось

- Хвостов по задаче нет. Опционально: тот же param-level аудит для других кастомных
  пайпов, если появятся (сейчас `ZodValidationPipe` — единственный объектный).
- Фоновый typecheck-долг (Prisma client drift в tables/tracker/knowledge-core,
  отсутствующий `exceljs`) — не моё, но стоит отдельной задачи.

## Прод-команды

Не нужны — только пересборка backend-образа (`docker compose up -d --build backend`).
Миграций/seed/ENV нет.
