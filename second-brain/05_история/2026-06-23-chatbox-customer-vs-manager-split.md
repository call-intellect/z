---
date: 2026-06-23
feature: chatbox-customer-vs-manager-split
branch: feature/chatbox-customer-vs-manager-split
---

# Разделение клиентов и менеджеров ChatBox → сущности Коры

## Что было поставлено
Владелец: клиенты из ChatBox создаются как менеджеры с флагом `Person{relationship=external}` — это в корне неверно, клиент не сотрудник. Куда отнести клиентов? Плюс отдельно: сделать **отображение клиентов на фронте** (как «Команда», но клиенты).

Решение (через `feature-analyst`-разбор → `AskUserQuestion`): клиент = новая доменная модель **`Customer`** 1:1 над `Entity{type=customer}` (зеркало `Vendor`); два уровня account+контакты; раздел «Клиенты» как справочник рядом с «Поставщики». Оформлено ТЗ `plans/tz/2026-06-23-chatbox-customer-vs-manager-split.md` (+ orchestrator-prompt), реализовано через `tz-orchestrator` по 8 фазам.

## Как решал (фазы → коммиты)
- **Ф1** `feat(db)` — модель `Customer` + enum `CustomerStatus` + `ChatboxCustomer.linkedCustomerId`/`ChatboxChannelClient.linkedContactEntityId` + миграция `20260623071903_chatbox_customer_model`.
- **Ф2** `feat(knowledge)` — `EntityResolutionService.findOrCreateCustomerEntity` (дедуп externalCrmId→strong-id→name) + 4 unit-теста.
- **Ф3Б** `feat(customers)` — модуль `customers` (read API list+get, зеркало vendors) + 7 тестов.
- **Ф3** `feat(chatbox)` — `ChatboxCustomersService` Person→Customer (`createCustomerAndLink`, `linkCustomer{customerId}`, DTO `linkedCustomer`), эндпоинт `create-customer` + 9 тестов.
- **Ф4** `feat(chatbox)` — ingest авто-резолвит клиента в `Customer/Entity{customer}` (try/catch, не роняет ингест), менеджер остаётся `Person` + 11 тестов.
- **Ф5Б** `feat(customers)` — FE раздел «Клиенты»: `/customers` (зеркало `/vendors`) + `customers.api.ts` + пункт навигации в «Справочник».
- **Ф5** `feat(chatbox)` — FE пикер привязки на `customersApi` (путь менеджеров не тронут).
- **Ф6** `feat(chatbox)` — backfill `Person{external}→Customer` (этап A account, B контакты+`EntityLink(works_at)`, C консервативный soft-delete осиротевших Person), идемпотентный, в `apply-prod-deploy` STEPS.
- Инфра-коммит `chore(infra)`: dev-compose postgres → composite PG16+pgvector+AGE (как в prod).

## Что вышло (верификация)
- backend `typecheck` + `build` = 0; frontend `build` = 0, `lint` 0 errors.
- Unit-тесты по фазам зелёные (entity-resolution customer-блок, customers.service, chatbox-customers, chatbox-ingest).
- **Backfill проверен на реальной фикстуре** (User→Org→Person→ChatboxCustomer→ChatboxChannelClient): run1 создал Customer (source=chatbox) + linkedCustomerId + контакт-`Entity{person}` + `works_at`-связь к аккаунту + soft-delete Person; run2 — идемпотентный no-op. Фикстура убрана.
- DB-проверка: `Customer`/`CustomerStatus` в `public` (не `ag_catalog`), FK/индексы на месте.

## Чему научился (граблями, с ценой времени)
1. **dev-Postgres был на pg17, а volume и prod — pg16.** Образ в `docker-compose.dev.yml` ошибочно бампнули; composite-образ `infra/postgres/Dockerfile` (PG16+pgvector+AGE) и так был «для dev». Починка = сборка того же образа (volume сохранён). Прод — Yandex Managed PG16 (managed extensions).
2. **dev-БД жила через `db push`, ledger миграций пуст (1 из 76).** Пришлось baseline'ить (bulk-insert в `_prisma_migrations` с sha256-checksum). НО baseline ≠ реальная схема: дев-БД **не имела** колонок миграции `20260611` (`linkedPersonId`/`linkMode`) — `migrate status` «up to date» врал. Фикс для теста backfill — `prisma db push` (синк дев-БД к схеме). `migrate dev` в этом репо вообще не реигрывается на пустом shadow (цепочка не самосогласована — нужен AGE + порядок; прод живёт через baseline + `migrate deploy`). Миграции авторим через `migrate diff --from-schema --to-schema`, не `migrate dev`.
3. **AGE search_path trap (подтверждение памяти):** сырой `CREATE TABLE` на AGE-базе уходит в `ag_catalog`. Лечение — `SET search_path = public;` первой строкой migration.sql (5 миграций проекта уже так делают). Prisma-client операции (не raw) пишут в `public` корректно.
4. **`Person` НЕ имеет поля `phone`** (только name/email/company). Backfill ошибочно селектил `person.phone` — `typecheck` пропустил (устаревший сгенерённый клиент на момент проверки кодером), поймал **реальный прогон на фикстуре** (runtime P2022). Урок: для миграционных скриптов прогон на реальных данных ловит то, что unit-моки и typecheck не видят.
5. **vitest под Bun в этом окружении** падает нативным крашем `msgpackr-extract` на тяжёлых спеках (импортирующих граф) — лёгкие (моки) идут. Обход: временно убрать `node_modules/msgpackr-extract/build/Release/extract.node` → JS-fallback → прогнать → вернуть. Интеграционные `beforeAll` спеков валятся на немигрированной тестовой БД.

## Не доделано (см. 04_не-сделано)
DROP `linkedPersonId` (vNext после прод-backfill), go-forward авто-создание контактов при sync, унификация Bitrix→Customer, карточка `/customers/:id` + write API. Все — vNext с причинами.
