# Orchestrator-prompt — chatbox-customer-vs-manager-split

Реализуй ТЗ [plans/tz/2026-06-23-chatbox-customer-vs-manager-split.md](2026-06-23-chatbox-customer-vs-manager-split.md) как `tz-orchestrator`: фаза за фазой, силами суб-агентов, в отдельном git worktree, строго последовательно по графу зависимостей.

## Порядок чтения на старте
1. `CLAUDE.md` + `.claude/CLAUDE.md` (vexp-first, версионируемые миграции `prisma:migrate` — НЕ `db push`, без комментариев в коде, knobs в AdminSetting, Ship-On).
2. `second-brain/index.md`, `02_architecture/knowledge-core.md`, `02_architecture/data-model.md`, `02_architecture/module-map.md`.
3. Само ТЗ целиком, затем код-якоря из него.

## Инструменты
- `run_pipeline` первым для картографии каждой фазы (не grep/glob при живом демоне). `get_skeleton` вместо `Read` для осмотра. `Read` — только для дословной правки.
- Context7 — если понадобится свежий API Prisma 7 / nestjs-zod / SWR. Не угадывать.

## Граф фаз (строго)
**Ф1 (схема) → {Ф2 резолв ∥ Ф3Б backend read API}; Ф2 → Ф3 (chatbox svc/controller/DTO) → {Ф4 ingest/analyze ∥ Ф5 FE chatbox-пикер}; Ф3Б → Ф5Б (FE раздел «Клиенты»); всё → Ф6 (backfill)**.
- Ф1 первая и блокирующая: без модели `Customer` и `prisma:generate` остальное не компилируется.
- Ф3Б (модуль `customers`, list+get, зеркало `vendors`) зависит только от Ф1 — гони параллельно Ф2/Ф3.
- Ф4/Ф5 параллельны ПОСЛЕ контракта DTO из Ф3; Ф5Б — ПОСЛЕ контракта `/api/v1/customers` из Ф3Б.
- Ф3+Ф5 мёржить согласованно (контракт `linkedPerson`→`linkedCustomer`, `personId`→`customerId`); Ф3Б+Ф5Б согласованно (контракт `customersApi`).
- Раздел «Клиенты» (Ф5Б) — пункт навигации в подгруппе «Справочник» рядом с «Поставщики», страница `/customers` зеркалит `/vendors`. НЕ класть в `/structure`.
- Ф6 последняя: backfill читает боевые `linkedPersonId`, поэтому DROP старых колонок здесь НЕ делаем (vNext).

## Факт-чек (не верь отчёту суб-агента)
Для каждой фазы — независимая приёмка по её блоку Acceptance из ТЗ: грепни маркеры (`model Customer`, `create-customer`, отсутствие `createPersonAndLink`/`relationship: 'external'`/`personsDomainApi` в затронутых файлах), перечитай изменённые файлы, прогони `bun run typecheck`/`lint`/`build` и точечные `bunx vitest run <spec>`. Номера строк в ТЗ дрейфуют — верифицируй по якорь-символам.

## Определение «фаза закрыта»
Acceptance-предикаты фазы выполнены машинно (греп/тесты/сборка зелёные) + статус `[ ]`→`[x]` в ТЗ + коммит `тип(chatbox): …` с перечислением путей (никаких `git add .`). Push — только по явному подтверждению владельца.

## Failure-modes, на которые смотреть
- Дедуп-коллапс в `findOrCreateCustomerEntity` (двое клиентов с одним именем без strong-id) — проверь приоритет email/externalCrmId.
- Backfill: гард «осиротевший Person» не должен задевать менеджеров (`relationship='employee'`) и клиентов с `userId`/`Membership`; soft-delete, не хард-делит; `--dry-run` перед реальным; повтор = no-op.
- `new PrismaClient()` в скрипте — запрещён, только `createPrismaClient()`; импорты из `../src`.
- Tenant-scope на всех `Customer`/`Entity`/`EntityLink` запросах.

## Завершение
DoD из ТЗ: typecheck/lint/build/vitest зелёные; second-brain (`data-model.md`, `module-map.md`, профильная chatbox, `04_не-сделано/README.md` — строки про отложенный DROP `linkedPersonId` и Bitrix-унификацию); `prod-deploy-log.md` Шаги 4 и 8 + backfill в `apply-prod-deploy.ts` STEPS; рефлексия в `05_история/`. Заполни «Итог» в ТЗ.
