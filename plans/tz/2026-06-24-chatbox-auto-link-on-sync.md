---
type: tz
status: ready-to-implement
feature: chatbox-auto-link-on-sync
date: 2026-06-24
owner: Tozix
relates_to:
  - plans/tz/2026-06-23-chatbox-customer-vs-manager-split.md
  - backend/src/modules/chatbox/chatbox-sync.service.ts
---

# Авто-создание клиентов и менеджеров при синке ChatBox

## Принцип
Когда синк ChatBox подтягивает клиентов (`ChatboxCustomer`) и менеджеров (`ChatboxMember`), система **автоматически** заводит и привязывает соответствующие сущности Коры, если их ещё нет:
- клиент → `Customer` (+`Entity{type=customer}`) через `EntityResolutionService.findOrCreateCustomerEntity` (дедуп externalCrmId→strong-id→name);
- менеджер → `Person` (`relationship='employee'`), дедуп по email.
`linkMode='auto'`. Ручные связки (`manual`) **никогда не перезатираются**. Ship-On (без нового флага — работает в рамках уже существующего `chatbox.enabled`).

## REALITY-CHECK
- Сейчас auto-link нет: синк (`syncCustomers`/`syncMembers` в [chatbox-sync.service.ts](backend/src/modules/chatbox/chatbox-sync.service.ts)) только upsert-ит сырые зеркала. Привязка к `Customer`/`Person` — ручная (страницы Клиенты/Менеджеры) либо частично авто при анализе сессии (Ф4 ingest резолвит только `Entity{customer}`, не ставит `linkedCustomerId`, менеджеров не трогает).
- Готово к переиспользованию: `EntityResolutionService.findOrCreateCustomerEntity` (глобальный @Global); `ChatboxMembersService.linkMember` уже поднимает `relationship external→employee` ([chatbox-members.service.ts:149](backend/src/modules/chatbox/chatbox-members.service.ts#L149)); enum `ChatboxMemberLinkMode = auto|manual|none` ([schema.prisma:378](backend/prisma/schema.prisma#L378)).
- DI: `ChatboxCustomersService`/`ChatboxMembersService` — провайдеры того же `ChatboxModule`; зависимостей на `ChatboxSyncService` у них нет → цикла не будет.
- **Без миграций/ENV.** Только код.

## Принятые решения автора ТЗ
| # | Решение | Почему |
|---|---|---|
| A1 | Триггер — внутри `syncCustomers`/`syncMembers` (в конце, после upsert-цикла), чтобы любой путь синка (`fullSync`/`incrementalSync`/`syncByScope`) авто-линковал | один источник правды, не дублировать вызовы по местам |
| A2 | Линкуем только строки с `linkedCustomerId IS NULL` / `linkedPersonId IS NULL` → ручные `manual` не трогаем (у них id заполнен) | не перезатереть ручной выбор владельца |
| A3 | Менеджер → `Person` напрямую через prisma (дедуп по email, `relationship='employee'`), без `persons.create`/audit/userId — синк системный, актора-человека нет | у синка нет userId; избегаем фейкового аудита; дедуп по email сохранён |
| A4 | Идемпотентность: повторный синк по уже привязанным = no-op (фильтр по NULL); `findOrCreateCustomerEntity` дедупит | синк гоняется по cron многократно |
| A5 | Контакты канала (`ChatboxChannelClient` → `Entity{person}`) — вне scope (это отдельная go-forward задача из реестра не-сделанного); здесь только account-клиент + менеджер | явный запрос владельца — «клиентов и менеджеров» |

## Scope
**Входит:** методы `autoLinkUnlinked` в `ChatboxCustomersService` и `ChatboxMembersService`; вызовы из `syncCustomers`/`syncMembers`; DI-проводка в `ChatboxSyncService`; unit-тесты; логи-счётчики.
**Не входит:** новый флаг; channel-client контакты; FE-изменения; миграции.

## Фаза 1 — авто-линк клиентов и менеджеров в синке `[ ]`
**Файлы:** `chatbox-customers.service.ts`, `chatbox-members.service.ts`, `chatbox-sync.service.ts`, `chatbox.module.ts` (если нужно), их `.spec.ts`.

1. `ChatboxCustomersService.autoLinkUnlinked(tenantId): Promise<{ created: number; linked: number }>`:
   - `findMany ChatboxCustomer where { tenantId, linkedCustomerId: null }` select id/name/email/phone/externalCrmId.
   - для каждого: `findOrCreateCustomerEntity({ tenantId, name: name?.trim() || email?.trim() || 'Без имени', email: email?.trim()||null, phone: phone?.trim()||null, externalCrmId: externalCrmId??null, source: 'chatbox' })` → `update { linkedCustomerId: customerId, linkMode: 'auto' }`; `created`/`linked` по полю `created` резолвера.

2. `ChatboxMembersService.autoLinkUnlinked(tenantId): Promise<{ created: number; linked: number }>`:
   - `findMany ChatboxMember where { tenantId, linkedPersonId: null }` select id/name/email.
   - email = `m.email?.trim() || null`; если email → `person.findFirst({ tenantId, email, deletedAt: null })`.
   - если не найден → `person.create({ tenantId, name: m.name?.trim()||email||'Без имени', email: email ?? '', relationship: 'employee' })` (обернуть в try/catch `P2002` — при гонке/коллизии пустого email повторно найти по email и переиспользовать; если всё равно нет — `continue` с логом).
   - `update ChatboxMember { linkedPersonId, linkMode: 'auto' }`; для уже существующего Person — `updateMany where { id, tenantId, relationship: 'external', deletedAt: null } data { relationship: 'employee' }` (поднять до сотрудника).

3. `ChatboxSyncService`: добавить в конструктор `@Inject(ChatboxCustomersService)` и `@Inject(ChatboxMembersService)`. В конце `syncCustomers` (перед `return customers.length`) — `const r = await this.customers.autoLinkUnlinked(tenantId); this.logger.log(...создано/привязано...)`. Аналогично в `syncMembers` — `this.members.autoLinkUnlinked(tenantId)`. Не менять возвращаемые counts.

**Acceptance:**
- `bun run typecheck` + `bun run build` = 0 (build проверит DI: sync резолвит оба сервиса, нет цикла).
- unit: customers.autoLinkUnlinked — для unlinked зовёт findOrCreateCustomerEntity и ставит linkMode='auto'; уже привязанные (linkedCustomerId!=null) не выбираются. members.autoLinkUnlinked — дедуп по email (existing → не create), новый → create с relationship='employee'; ставит linkMode='auto'; повторный прогон = no-op.
- `grep "autoLinkUnlinked" chatbox-sync.service.ts` → 2 (customers+members).
- идемпотентность: второй вызов на тех же данных ничего не создаёт (фильтр NULL + дедуп).

## DoD
typecheck/lint/build зелёные; spec'и зелёные (изолированно при msgpackr-краше); second-brain `01_projects/<chatbox>.md` отметить авто-линк при синке; prod-операций нет (только код, обычный rebuild). Рефлексия.

## Итог
(заполнит оркестратор)
