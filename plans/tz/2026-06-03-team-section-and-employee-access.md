# ТЗ: Раздел «Команда» + персональные доступы сотрудников

**Дата:** 2026-06-03
**Тип:** ТЗ на реализацию (фазовое)
**Аналитика-источник:** [plans/analysis/2026-06-03-team-section-and-employee-access.md](../analysis/2026-06-03-team-section-and-employee-access.md)
**Затронутые слои:** Frontend (навигация, страницы, карточка) · Backend (orgs, persons, rbac, entitlements, users) · DB (новая модель `EmployeeCapabilityOverride`, без миграций — `db push`)

---

## 1. Цель

Собрать всё управление людьми и их доступами в один видимый раздел **«Команда»**:
1. Вынести управление структурой компании из свёрнутого «Справочника» на верхний уровень меню.
2. Объединить «сотрудников» (карточки `Person`) и «участников» (аккаунты `Membership`) в один список.
3. Перенести приглашения и управление участниками из «Настроек» в «Команду»; починить сломанную кнопку «Пригласить».
4. Дать владельцу **индивидуальную настройку доступов по каждому сотруднику** (роль, клоны, память, панели) — новый слой персональных override поверх роли-пресета.
5. Попутно закрыть два дефекта: 400 на турах и одноразовый guard мастера «Знакомства».

## 2. Не-цели (сознательно вне объёма)

- Не мигрируем рабочую модель `CloneAccessGrant` — обобщаем только новые оси.
- Не вводим персональные **квоты** и персональный **режим видимости** компании (политика компании, а не атрибут человека).
- Не трогаем зону супер-админа `(admin)/admin/clones` — она остаётся как есть.
- Не переписываем мастер «Знакомства» целиком — только guard и подпись прогресса.
- Персональный override для тарифных фич — только подмножество «что человек видит» (память, панели, граф, чат), не биллинговые фичи (адаптеры, публичное API, экспорт).

## 3. Явные предположения (проверены по коду)

- `OrgInvitation.personId` существует ([schema:2580](../../backend/prisma/schema.prisma#L2580)) — фикс приглашения не требует миграции.
- `OrgAdminGuard` = super_admin ∨ owner ∨ admin Org ([guard:47-49](../../backend/src/modules/auth/guards/org-admin.guard.ts#L47-L49)) — clone-grants API доступен владельцу.
- `tourProgress` — Json-поле `User`, расширение enum не требует миграции.
- `Org.setupCompletedAt` уже есть (читается в [IntroWizardWidget](../../frontend/app/(authenticated)/dashboard/widgets/IntroWizardWidget.tsx#L112)) — используем для однократности мастера вместо «есть отделы».
- Управление участниками — те же эндпоинты `orgsApi.{listMembers,updateMember,removeMember,resetMemberTelegramBinding}`; переезжает только точка вызова.

---

## 4. Фаза 0 — Быстрые фиксы (низкий риск, независимы от редизайна)

### 0.1 Починка кнопки «Пригласить» (приглашение по `personId`)

**Backend.**
- [invite-member.dto.ts](../../backend/src/modules/orgs/dto/invite-member.dto.ts): добавить в `InviteMemberSchema` поле `personId: z.string().min(1).optional()`.
- [orgs.controller.ts:158-164](../../backend/src/modules/orgs/orgs.controller.ts#L158-L164): передать `personId: body.personId ?? null` в `createInvitation`.
- [org-invitations.service.ts createInvitation](../../backend/src/modules/orgs/org-invitations.service.ts#L103): добавить вход `personId?: string | null`. Логика:
  1. Если `personId` задан — `prisma.person.findUnique` (select `tenantId, deletedAt, userId, email, name`). Проверки: `tenantId === orgId`, `!deletedAt`. Иначе — `BadRequestException` с русским сообщением.
  2. `email = input.email ?? person.email`; `name = input.name ?? person.name`.
  3. Доп. проверка дубля: если уже есть `pending` приглашение с этим `personId` — `ConflictException('invitation_already_exists')` (чтобы повторные клики не плодили пустышки).
  4. Проставить `personId` в `orgInvitation.create({ data })` ([строка 191](../../backend/src/modules/orgs/org-invitations.service.ts#L191)).
- `resendInvitation` — убедиться, что `personId` сохраняется (запись обновляется, поле уже на ней).

**Frontend.** Менять не нужно — [structure.api.ts:280-285](../../frontend/src/api/structure.api.ts#L280-L285) уже шлёт `{ personId }`. После фикса: письмо уходит на email сотрудника, `invitationStatus` обновляется, при принятии `Person.userId` линкуется (уже реализовано — [org-invitations.service.ts:740-772](../../backend/src/modules/orgs/org-invitations.service.ts#L740-L772)).

**Проверка:** `cd backend && bunx tsc --noEmit && bun run build`; ручной smoke — пригласить из Структуры → статус «приглашение отправлено».

- [x] 0.1 готово

### 0.2 Ошибка 400 на турах

- [tour-progress.dto.ts:21](../../backend/src/modules/users/dto/tour-progress.dto.ts#L21): `TourIdSchema = z.enum(['welcome','project','meeting','overview','demo'])`.
- [TourProgressResponseSchema:51-55](../../backend/src/modules/users/dto/tour-progress.dto.ts#L51-L55): добавить `overview: TourEntrySchema.optional()`, `demo: TourEntrySchema.optional()`.
- Проверить [tour-progress.service.ts](../../backend/src/modules/users/tour-progress.service.ts) на хардкод ключей `welcome|project|meeting` в merge — расширить, если есть.

**Проверка:** backend typecheck/build; PATCH `{tourId:'overview'}` → 200.

- [x] 0.2 готово

### 0.3 Guard мастера «Знакомства» (переоткрываемость)

- [WizardShell.tsx:66-102](../../frontend/app/(authenticated)/onboarding/company/WizardShell.tsx#L66-L102): убрать редирект «есть отделы → /dashboard». Оставить только owner-gate. Однократность не форсируем — owner может вернуться и дозаполнить.
- [IntroWizardWidget](../../frontend/app/(authenticated)/dashboard/widgets/IntroWizardWidget.tsx): подпись «Настройка N/6» — оставить как «прогресс настройки компании» (6 вех по полям Org), но в шапке мастера убрать жёсткое «Шаг X из 5», чтобы не путать вехи и экраны. (Косметика, низкий приоритет.)

**Проверка:** frontend typecheck/build; повторный вход в мастер не выкидывает.

- [x] 0.3 готово

---

## 5. Фаза 1 — Навигация «Команда»

- [Sidebar.tsx](../../frontend/src/ui/components/app-shell/Sidebar.tsx): добавить новый верхнеуровневый пункт **«Команда»** (иконка `Users`, href `/structure`, `matchPrefix '/structure'`) в видимую часть меню — логично сразу после «Памяти компании» или в начале, как «daily driver» для владельца. Видим всем; действия гейтятся ролью (как сейчас).
- Из группы «Справочник» убрать дубли, переехавшие в «Команду»: `/structure`. Пункты `/departments`, `/roles`, `/company` — оставить в «Справочнике» (это отдельные витрины; вкладки внутри «Команды» их не отменяют), либо во второй итерации свести. **Рекомендация:** на этой фазе только добавить «Команда», `/structure` из «Справочника» убрать, остальное не трогать.
- [StructureClient.tsx](../../frontend/app/(authenticated)/structure/StructureClient.tsx): заголовок «Структура» → «**Команда**»; порядок вкладок — **Сотрудники** (дефолт), Отделы, Должности (`TAB_KEYS` и `readTab` дефолт → `persons`).

**Проверка:** frontend typecheck/build; активная подсветка пункта (winnerHref) на `/structure*` корректна.

- [x] Фаза 1 готова

---

## 6. Фаза 2 — Объединённый список (сотрудники + участники)

**Решение (с обоснованием):** ввести один backend-эндпоинт «ростер команды», а не мержить два списка на фронте — «участник без карточки» и системная роль требуют join `Person ↔ Membership`, мерж на клиенте хрупкий. Один эндпоинт = одна точка истины.

**Backend.**
- Новый `GET /api/v1/orgs/:id/team-roster` (модуль `orgs` или `persons`; `CookieAuthGuard + TenantGuard`). Возвращает массив:
  ```
  {
    personId: string | null,
    userId: string | null,
    fullName: string,
    email: string | null,
    roleName: string | null,        // должность (RoleDomain)
    departmentName: string | null,
    invitationStatus: 'none'|'pending'|'accepted'|'revoked'|'expired',
    systemRole: MembershipRole | null,   // для вошедших
    telegramLinked: boolean,
    hasPersonCard: boolean               // false → участник без Person
  }
  ```
- Источник: все `Person` (как в [persons.service list](../../backend/src/modules/persons/services/persons.service.ts#L107)) ⊕ все `Membership`, не имеющие связанного `Person` (`Person.userId`), — добавляем строками `hasPersonCard:false`.
- DTO — Zod + Swagger (nestjs-rules).

**Frontend.**
- `src/api` + `src/domain` — добавить `teamRoster` (ApiDto → DomainModel, frontend-rules).
- [PersonsTab.tsx](../../frontend/app/(authenticated)/structure/PersonsTab.tsx) → переработать в «Сотрудники» на базе ростера: колонки имя/email/должность/отдел/**статус приглашения**/**системная роль**; строки без карточки — с пометкой «нет карточки сотрудника» + действие «создать карточку».

**Проверка:** оба typecheck/build; список показывает и сотрудников, и владельца (участник без Person).

- [ ] Фаза 2 готова

---

## 7. Фаза 3 — Перенос управления участниками в «Команду»

**Frontend.**
- На строке сотрудника/участника (вошедшего) — действия: **сменить системную роль** (`orgsApi.updateMember`), **удалить из компании** (`orgsApi.removeMember`), **сброс Telegram** (`orgsApi.resetMemberTelegramBinding`), **пригласить/перевыпустить/отозвать** (`orgsApi.invite/resend/revoke` + починенный invite по personId из Фазы 0.1).
- Переиспользовать существующие диалоги [InviteEmployeeDialog](../../frontend/app/(authenticated)/settings/organization/InviteEmployeeDialog.tsx) / [InviteCreatedDialog](../../frontend/app/(authenticated)/settings/organization/InviteCreatedDialog.tsx) (перенести в `src/ui` как переиспользуемые).
- [OrganizationClient.tsx](../../frontend/app/(authenticated)/settings/organization/OrganizationClient.tsx): убрать секции «Участники» и «Приглашения». Оставить только «Информация» (название + `visibilityMode`).

**RBAC-проверка:** не-owner/admin на «Команде» видят список, но действия скрыты/выдают 403-empty-state (как сейчас `canEdit`).

**Проверка:** frontend typecheck/build; ручной smoke — пригласить, сменить роль, удалить из «Команды»; Настройки → Организация больше не содержат участников.

- [ ] Фаза 3 готова

---

## 8. Фаза 4 — Карточка сотрудника + вкладка «Доступы» (роль + клоны)

**Frontend.**
- Клик по человеку → карточка сотрудника (страница `/structure/persons/[id]` или модал; рекомендация — отдельная страница, удобнее для будущих вкладок).
- Вкладки карточки: **Профиль** (имя/почта/должность/отдел — существующий PersonEditDialog как контент), **Доступы**.
- Вкладка «Доступы», часть 1:
  - **Системная роль** — Select (owner/admin/manager/coo/hr_partner) → `orgsApi.updateMember`.
  - **Клоны** — список грантов сотрудника + «выдать / отозвать / продлить», через существующий [admin-clones.api.ts](../../frontend/src/api/admin-clones.api.ts) (фильтр `grantedToUserId`). Это выводит владельцу функционал, который был только у супер-админа (API уже разрешает — `OrgAdminGuard`).

**Backend.** Изменений не требуется (эндпоинты участников и clone-grants уже есть и owner-доступны).

**Проверка:** frontend typecheck/build; владелец выдаёт/отзывает доступ к клону конкретному сотруднику со своей страницы.

- [ ] Фаза 4 готова

---

## 9. Фаза 5 — Слой персональных доступов (память, панели)

**DB (db push, без migrate — см. skill `prisma-db-push-rules`).**
- Новая модель в [schema.prisma](../../backend/prisma/schema.prisma):
  ```prisma
  model EmployeeCapabilityOverride {
    id              String    @id @default(cuid())
    tenantId        String
    grantedToUserId String
    capability      String    // 'memory:regulations' | 'memory:entities' | 'feature:graph' | 'panel:operations' | ...
    effect          String    // 'allow' | 'deny'
    expiresAt       DateTime?
    grantedById     String
    grantedAt       DateTime  @default(now())
    revokedAt       DateTime?
    revokedBy       String?
    org             Org   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
    grantedTo       User  @relation("ECO_grantedTo", fields: [grantedToUserId], references: [id], onDelete: Cascade)
    grantedBy       User  @relation("ECO_grantedBy", fields: [grantedById], references: [id])
    @@unique([tenantId, grantedToUserId, capability])
    @@index([tenantId, grantedToUserId])
  }
  ```
- После правки — `bun run prisma:push && bun run prisma:generate`.

**Backend.**
- `RbacService`: метод `resolveCapability(userId, tenantId, capability)` → 1) активный override (`revokedAt=null`, `expiresAt` пуст/в будущем): `allow`/`deny`; 2) иначе дефолт от роли/компании (текущая логика — роль manager+ или per-Org флаг памяти). Подключить в существующие проверки доступа к памяти (где сейчас читается `feature.memory_*_for_members`).
- Эндпоинты (модуль `persons`/`orgs`, `OrgAdminGuard`):
  - `GET /api/v1/orgs/:id/members/:userId/capabilities` — список override + эффективные значения.
  - `PUT /api/v1/orgs/:id/members/:userId/capabilities/:capability` — upsert `{effect, expiresAt?}`.
  - `DELETE …/:capability` — снять override (вернуть к дефолту роли).
- `GET /api/v1/users/me/effective-access` — resolved-доступы текущего юзера (для фронта, чтобы скрывать/показывать). Альтернатива — расширить ответ существующего entitlement-эндпоинта.

**Frontend.**
- Вкладка «Доступы», часть 2: **память** (Правила/Сущности) и **панели** (операции) — переключатели на сотрудника (allow/deny/по умолчанию), через новые эндпоинты.
- [useMemoryAccess.ts](../../frontend/src/hooks/useMemoryAccess.ts): учитывать персональный resolved-доступ (из `effective-access`), а не только роль + per-Org флаг.

**Доменные решения (зафиксированы):** ключ — `userId`; память по умолчанию остаётся компанийной, override уточняет; тарифные фичи — индивидуально только «что видит» (память/панели/граф/чат), не биллинговые; режим видимости индивидуально не делаем.

**Проверка:** оба typecheck/build; персональный `deny` памяти у сотрудника с ролью manager реально скрывает раздел; `allow` рядовому — открывает.

- [ ] Фаза 5 готова

---

## 10. Фаза 6 — QA, документация, prod-операции

- Полный прогон: `cd backend && bunx tsc --noEmit && bun run build`; `cd frontend && bun run typecheck && bun run build`. Юнит-тесты затронутых сервисов (`org-invitations`, `rbac`, `tour-progress`).
- **second-brain:**
  - `02_architecture/data-model.md` — модель `EmployeeCapabilityOverride`.
  - `02_architecture/module-map.md` — новые эндпоинты (team-roster, capabilities).
  - `01_projects/api-layer.md` — новые REST-разделы.
  - `01_projects/frontend-pages.md` — раздел «Команда» + карточка сотрудника.
  - `01_projects/admin.md` — перенос участников из Настроек.
- **prod-deploy-log.md:** Шаг 4 (новая модель → `prisma db push`), Шаг 12 (smoke новых эндпоинтов/Swagger). ENV — нет. Seed/patch — нет.

- [ ] Фаза 6 готова

---

## 11. Definition of Done

- ✅ «Команда» — видимый верхнеуровневый пункт; вкладка «Сотрудники» открывается первой.
- ✅ Один список объединяет сотрудников и участников; участник без карточки виден и помечен.
- ✅ Кнопка «Пригласить» реально отправляет приглашение на email сотрудника; статус обновляется.
- ✅ Управление участниками (роль/удаление/Telegram/приглашения) — в «Команде»; в Настройках их больше нет.
- ✅ Карточка сотрудника: владелец настраивает роль, клоны, память, панели **индивидуально**.
- ✅ 400 на турах устранён; мастер «Знакомства» переоткрывается.
- ✅ TypeScript + build (front/back) зелёные; документация и prod-deploy-log обновлены.

## 12. Риски

- **Override поверх тарифа/биллинга** → персональный `allow` биллинговой фичи мог бы дать неоплаченный доступ. Решение: override применять только к небиллинговым «что видит» осям; биллинговые гейтить верхним лимитом тарифа.
- **RBAC-видимость перенесённых экранов** → проверить empty-state для не-owner/admin в «Команде».
- **Дубли приглашений** → проверка дубля по `personId` в Фазе 0.1.
- **Производительность team-roster** на больших Org — добавить пагинацию/индексы при необходимости (MVP-границы: ≤10 участников, не критично).

## 13. Порядок и зависимости

Фаза 0 (независима, даёт ценность сразу) → 1 → 2 → 3 → 4 → 5 → 6. Каждая фаза оставляет систему в рабочем состоянии и завершается зелёной сборкой + коммитом по фазе. Push — по отдельному подтверждению.

## 14. Статус

```
[ ] Не начиналось
[x] В процессе
[ ] Готово
```
