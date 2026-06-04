---
type: tz
status: draft
date: 2026-06-01
feature: Замена «копии демо-кабинета на каждую Org» на единую shared demo Org «ТехноСтрим» с доступом read-only через новую роль `demo_observer`. Демо-данные засеваются один раз и живут постоянно; новые пользователи становятся наблюдателями без копирования.
parent_analysis:
  - plans/analysis/2026-06-01-demo-shared-org-architecture.md
supersedes:
  - plans/tz/2026-05-31-demo-auto-seed-and-cleanup.md  # авто-сидинг + cleanup КОПИЙ — больше не нужны
relates_to:
  - plans/tz/2026-05-28-demo-workspace.md             # seedDemoWorkspace / resetDemoWorkspace остаются для эталона
  - plans/tz/2026-05-28-demo-cabinet.md
  - plans/tz/2026-05-31-demo-content-expansion-pulse.md  # контент остаётся, сидится один раз в эталон
  - plans/tz/2026-05-29-admin-demo-workspace-creation.md # /admin/demo сохраняется с изменённой семантикой
  - plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md # событие SUBSCRIPTION_ACTIVATED_PAID/BONUS
existing_critical_files:
  - backend/prisma/schema.prisma                                            # enum MembershipRole, model Org, model Membership, model Subscription, enum PaymentMode
  - backend/src/modules/rbac/rbac.service.ts                                # loadContext, isMembershipRole, canViewEmployeeFullCard
  - backend/src/modules/rbac/policies/policy.csv                            # Casbin-style правила
  - backend/src/modules/rbac/guards/tenant.guard.ts                         # X-Org-Id → loadContext → ctx
  - backend/src/modules/accounts/accounts.service.ts                        # register (создаёт свою Org), getMe (возвращает currentOrgId)
  - backend/src/modules/onboarding/onboarding.service.ts                    # completeWelcome (сейчас enqueue'ит demo-seed → удалить)
  - backend/src/modules/onboarding/onboarding.controller.ts                 # POST /orgs/:orgId/demo-workspace, POST /orgs/:orgId/reset-demo (изменить семантику)
  - backend/src/modules/onboarding/workers/demo-seed.queue.ts               # удалить
  - backend/src/modules/onboarding/workers/demo-seed.worker.ts              # удалить
  - backend/src/modules/onboarding/workers/demo-cleanup.queue.ts            # оставить, переключить на эталон
  - backend/src/modules/onboarding/workers/demo-cleanup.worker.ts           # оставить, переключить на эталон
  - backend/src/modules/onboarding/listeners/subscription-activated.listener.ts  # изменить: вместо cleanup данных — удалить OrgMember(demo_observer)
  - backend/src/modules/billing/guards/subscription.guard.ts                # проверить: пропускает ли ACTIVE-Org с paymentMode='reference' на чтение/запись
  - backend/scripts/seed-demo-workspace.ts                                  # CLI-скрипт, остаётся для эталона
  - backend/scripts/apply-prod-deploy.ts                                    # реестр прод-скриптов
  - frontend/src/contexts/auth-context.tsx                                  # currentOrgId
  - frontend/src/contexts/subscription-context.tsx                          # реакция на смену статуса
  - frontend/app/(authenticated)/onboarding/demo-choice/page.tsx            # удалить
  - frontend/app/(authenticated)/onboarding/welcome/complete/page.tsx       # упростить (polling больше не нужен)
  - frontend/app/(authenticated)/onboarding/welcome/step-6/page.tsx         # редирект после completeWelcome
  - frontend/src/ui/components/app-shell/Sidebar.tsx                        # Org-switcher (если есть тут)
  - frontend/app/(admin)/admin/demo/DemoClient.tsx                          # /admin/demo: изменить семантику кнопок
---

> 📦 **АРХИВ (аудит 2026-06-04): ✅ реализовано — 98%.**
> Реализовано целиком: все обещанные артефакты (schema-изменения, DemoObserverGuard, RBAC canMutate + policy.csv, ENV ZDEMO_ORG_ID, register/getMe, listener-detach, удаление авто-сидинга, оба patch-скрипта в apply-prod-dep
> Полный разбор: `plans/analysis/2026-06-04-tz-audit-reestr-i-prioritety.md`


# ТЗ: единая эталонная демо-Org «ТехноСтрим»

> Архитектурный обзор и доказательство выбора — в [`plans/analysis/2026-06-01-demo-shared-org-architecture.md`](../analysis/2026-06-01-demo-shared-org-architecture.md). Этот ТЗ — execution-ready план реализации.
>
> Старый подход (копия демо-данных в каждую новую Org через `seedDemoWorkspace` + cleanup при оплате через `resetDemoWorkspace`) полностью заменяется: одна shared Org с реальными данными, новые пользователи получают `OrgMember(demo_observer)` к ней, при оплате — отвязываются.

---

## 1. Цель

После реализации:

1. В БД есть **одна** Org с `isReferenceDemo=true` — эталонная «ТехноСтрим», засеянная один раз CLI-скриптом. Данные живут постоянно, никогда не удаляются, частично обновляются cron-AI-агентами Pulse.
2. Новый пользователь после welcome-онбординга **мгновенно** (без ожидания, без тоста «Готовим…») видит работающий демо-кабинет. Никакого сидинга в фоне.
3. Демо открывается «из коробки»: Pulse-виджеты главной с цифрами, граф знаний, регламенты, документы, рефералка, фидбек, календарь — всё уже залито.
4. Пользователь видит в org-switcher'е две Org: **«Демо: ТехноСтрим»** (текущая, наблюдатель) и **«<имя своей компании>»** (пустая, после оплаты).
5. Любая попытка мутации в эталоне (POST/PUT/PATCH/DELETE) — 403 от нового `DemoObserverGuard` с понятным сообщением «Это демо. Создайте задачу в своей компании или оплатите подписку».
6. После первой оплаты (FSM `Subscription DEMO→ACTIVE` на собственной Org пользователя) — listener удаляет `OrgMember(demo_observer)`, `currentOrgId` пользователя переключается на свою Org. Эталонная Org **остаётся нетронутой**.
7. На проде: existing Org с `demoWorkspaceSeededAt != null` (старые копии) — patch-скриптом очищены и подключены наблюдателями к эталону.
8. Worker'ы `onboarding.demo-seed`, `DemoSeedQueue` и связанная инфраструктура auto-seed (из ТЗ `2026-05-31-demo-auto-seed-and-cleanup.md`) удалены: они больше не нужны. Worker'ы `onboarding.demo-cleanup` переориентированы — на форс-обновление эталона из CLI.

---

## 2. Решения архитектуры (фиксация из анализа)

| # | Решение | Источник в анализе |
|---|---|---|
| 1 | Демо живёт как **одна реальная Org** в БД с флагом `isReferenceDemo=true` | §3.Развилка 1 |
| 2 | Доступ — через **OrgMember с новой ролью `demo_observer`** | §3.Развилка 2 |
| 3 | Своя Org создаётся **на signup как сейчас** (пустая) | §3.Развилка 3 |
| 4 | Welcome-ответы пишутся в свою Org как сейчас | §3.Развилка 4 |
| 5 | Read-only enforcing — новый **`DemoObserverGuard` + `RbacService.canMutate(role)`** | §3.Развилка 5 |
| 6 | Subscription эталона — **ACTIVE + paymentMode='reference'** (новое значение enum) | §3.Развилка 6 |
| 7 | По умолчанию новый user видит **эталон**, своя Org — вторая в switcher'е | §3.Развилка 7 |
| 8 | При оплате — listener **удаляет `OrgMember(demo_observer)`** + переключает `currentOrgId` | §3.Развилка 8 |
| 9 | Подписка остаётся на Org-уровне | §3.Развилка 9 |
| 10 | Cron-агенты работают на эталоне как обычно (snapshot'ы дрейфуют) | §3.Развилка 10 |
| 11 | Privacy: список членов Org, billing, audit, settings — режутся RBAC'ом для `demo_observer` | §3.Развилка 11 |
| 12 | Per-user state (concierge, tour, notifications): аудит таблиц в отдельной фазе | §3.Развилка 12 |
| 13 | Доставка контента — CLI-скрипт `seed-demo-workspace.ts` с `--force-update` для эталона | §3.Развилка 13 |
| 14 | Existing копии на проде — patch-скрипт чистит + подключает наблюдателями | §3.Развилка 14 |
| 15 | Альтернативных «эталонов под отрасль» не делаем (отложено) | §3.Развилка 15 |

---

## 3. Архитектура

### 3.1. Доменные сущности после реализации

```
БД (постоянно):
  Org "Демо: ТехноСтрим"
    id          = (получен из ENV ZDEMO_ORG_ID)
    isReferenceDemo = true
    Subscription { status: ACTIVE, paymentMode: 'reference' }
    + все демо-данные (Person, Meeting, IdeaBlock, Goal, PulseSnapshot, …)

  Org "ООО Ромашка" (пользователя)
    isReferenceDemo = false
    Subscription { status: DEMO, paymentMode: null }
    демо-данных нет

  User Иван
    currentOrgId = derived
    Membership:
      ├─ (Ivan, "ТехноСтрим", role='demo_observer', invitedBy='system')
      └─ (Ivan, "ООО Ромашка", role='owner', invitedBy=Ivan)
```

### 3.2. Поток регистрации (новый)

```
Регистрация (email/password)
  → /onboarding/change-password
  → Welcome 6 шагов
  → POST /api/v1/orgs/:orgId/welcome/complete
       ├─ Org.welcomeCompletedAt = now()
       ├─ Document «Знакомство» создан
       ├─ ⛔ enqueue DemoSeedQueue — УДАЛЕНО
       └─ ✅ создать Membership(userId, DEMO_ORG_ID, role='demo_observer', invitedBy='system') — НОВОЕ
            (идемпотентно через UNIQUE (userId, orgId))
  → Redirect /dashboard (по умолчанию открывает X-Org-Id=DEMO_ORG_ID)
  → Дашборд показывает PaywallBanner («Демо. Чтобы начать работу в своей компании — оплатите»)
```

Без BullMQ, без polling, без ожидания, без тоста «Готовим…».

### 3.3. Поток оплаты (изменённый)

```
DEMO → ACTIVE (через Точку или manual bonus от super-admin)
  → ManualBillingService.activate / TochkaWebhookHandler
       → SubscriptionService.transition(to: 'ACTIVE')
       → emit BillingEvent.SUBSCRIPTION_ACTIVATED_PAID | _BONUS
  
  @OnEvent в SubscriptionActivatedListener (СУЩЕСТВУЕТ, ИЗМЕНЯЕМ):
    ⛔ старая логика: enqueue DemoCleanupQueue → resetDemoWorkspace по 35 таблицам
    ✅ новая логика:
       1. Найти Membership(userId=Org.ownerId, orgId=DEMO_ORG_ID, role='demo_observer')
       2. Если есть — delete (одна запись).
       3. Log.
  
  Фронт по SWR-refetch /accounts/me → видит обновлённый список memberships → org-switcher без эталона
```

«Если оплатил не owner, а member» — на текущей модели биллинга это невозможно (подписка ⇔ Org, owner — единственный кто платит). Если изменится — обновим listener отдельно.

### 3.4. Org-switcher (фронт)

В шапке/сайдбаре показывается **только если у user ≥ 2 memberships**:

```
┌─ Демо: ТехноСтрим      ✓ ← текущая
│  Пример работающей компании. Все действия отключены.
│
└─ ООО Ромашка
   Ваша компания. Чтобы создавать данные — оплатите подписку.
```

Переключение в свою Org → пустые страницы с EmptyState и CTA «Оплатить подписку» (ведёт в `/settings/subscription`).

---

## 4. Backend изменения

### 4.1. Prisma schema

#### 4.1.1. `enum MembershipRole` — добавить `demo_observer`

[backend/prisma/schema.prisma:179-193](backend/prisma/schema.prisma#L179-L193):

```prisma
enum MembershipRole {
  owner
  admin
  manager
  coo
  hr_partner
  /// 2026-06-01 (ТЗ shared-demo-org-model) — пользователь до оплаты:
  /// членство в эталонной демо-Org с read-only доступом. Все мутации режутся
  /// `DemoObserverGuard` + `RbacService.canMutate`. Снимается listener'ом
  /// `SubscriptionActivatedListener` при первой оплате (DEMO→ACTIVE) на
  /// собственной Org пользователя.
  demo_observer
}
```

#### 4.1.2. `model Org` — добавить `isReferenceDemo`

```prisma
model Org {
  // ... existing
  /// 2026-06-01 — флаг эталонной демо-Org «Демо: ТехноСтрим». Единственная Org
  /// с этим флагом в БД. Используется:
  ///   - admin-страницей /admin/demo (нельзя удалять, нельзя сидить второй раз);
  ///   - `seed-demo-workspace.ts --force-update` (разрешает re-seed ТОЛЬКО для
  ///     помеченной этим флагом);
  ///   - аналитикой (исключается из счёта paying/bonus orgs).
  isReferenceDemo  Boolean  @default(false)
  // ... existing
}
```

#### 4.1.3. `enum PaymentMode` — добавить `reference`

[backend/prisma/schema.prisma:8983-8986](backend/prisma/schema.prisma#L8983-L8986):

```prisma
enum PaymentMode {
  paid
  bonus
  /// 2026-06-01 — режим эталонной демо-Org. НЕ идёт в выручку, НЕ порождает
  /// реф-выплат, НЕ считается в `paid`/`bonus` метриках в billing-overview.
  /// Используется только на Org с `isReferenceDemo=true`.
  reference
}
```

#### 4.1.4. Применение

`bun run prisma:push` + `bun run prisma:generate`. Никаких миграций (см. правило `prisma-db-push-rules`).

### 4.2. RBAC

#### 4.2.1. `isMembershipRole` — добавить `demo_observer`

[backend/src/modules/rbac/rbac.service.ts:709-718](backend/src/modules/rbac/rbac.service.ts#L709-L718):

```ts
function isMembershipRole(s: string): s is MembershipRole {
  return (
    s === 'owner' ||
    s === 'admin' ||
    s === 'manager' ||
    s === 'coo' ||
    s === 'hr_partner' ||
    s === 'demo_observer'
  );
}
```

#### 4.2.2. `RbacService.canMutate(role)`

Добавить новый метод:

```ts
/**
 * Может ли роль выполнять write-операции (POST/PUT/PATCH/DELETE) в Org.
 * `demo_observer` — единственная роль, которая возвращает false. Используется
 * глобальным `DemoObserverGuard`. super_admin bypass обрабатывается в guard'е.
 */
canMutate(role: MembershipRole): boolean {
  return role !== 'demo_observer';
}
```

#### 4.2.3. `policies/policy.csv` — добавить демо-наблюдателя

В конец файла:

```csv
# 2026-06-01 — demo_observer: read-only во всех ресурсах Org.
# Запись блокируется на уровне DemoObserverGuard перед попаданием в эти правила,
# но для полноты и для будущих read-эндпоинтов фиксируем явно: только read.
p, demo_observer, *, *, org, read
p, demo_observer, *, *, meeting, read
p, demo_observer, *, *, card, read
p, demo_observer, *, *, task, read
p, demo_observer, *, *, chapter, read
p, demo_observer, *, *, highlight, read
p, demo_observer, *, *, chat-message, read
p, demo_observer, *, *, tag, read
# audit-log, ai-usage, billing — НЕ даём. Privacy в shared Org.
```

#### 4.2.4. `RbacService.allowedActions(role)` — приватный helper

Опционально (для UI-гейтинга на фронте — может пригодиться). Если не нужно сейчас — отложить.

### 4.3. `DemoObserverGuard` — новый глобальный guard

Файл: `backend/src/common/guards/demo-observer.guard.ts`.

```ts
/**
 * DemoObserverGuard — глобальный guard, режет любые mutating-эндпоинты
 * (POST/PUT/PATCH/DELETE) для пользователей с ролью `demo_observer` в текущей
 * Org. Срабатывает ПОСЛЕ `CookieAuthGuard` и `TenantGuard` (роль уже
 * вычислена). super_admin bypass.
 *
 * Исключение через `@PublicDemo()` декоратор — для редких read-через-POST
 * случаев (например, поиск через POST body). Сейчас таких нет, декоратор
 * вводим зарезервированным.
 *
 * Источник: ТЗ 2026-06-01 §4.3.
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RbacService } from '../../modules/rbac/rbac.service';

export const PUBLIC_DEMO_KEY = 'public_demo';
export const PublicDemo = () => Reflect.metadata(PUBLIC_DEMO_KEY, true);

const READ_ONLY_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class DemoObserverGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    if (READ_ONLY_METHODS.has(req.method)) return true;

    const isPublicDemo = this.reflector.get<boolean>(
      PUBLIC_DEMO_KEY,
      ctx.getHandler(),
    );
    if (isPublicDemo) return true;

    const rbacCtx = req.rbacContext as
      | { role: 'owner' | 'admin' | 'manager' | 'coo' | 'hr_partner' | 'demo_observer'; isSuperAdmin: boolean }
      | undefined;
    if (!rbacCtx) return true;          // не authenticated / нет Org-контекста — пропускаем, дальше сами гарды
    if (rbacCtx.isSuperAdmin) return true;
    if (this.rbac.canMutate(rbacCtx.role)) return true;

    throw new ForbiddenException({
      ok: false,
      error: {
        code: 'demo_observer_readonly',
        message:
          'Это демо-кабинет «ТехноСтрим» — здесь доступен только просмотр. Чтобы создавать данные, переключитесь в свою компанию и оплатите подписку.',
      },
    });
  }
}
```

**Регистрация:** в `AppModule.providers`:

```ts
{ provide: APP_GUARD, useClass: DemoObserverGuard }
```

**Важно:** `TenantGuard` должен в `req.rbacContext` положить `ctx` (роль + isSuperAdmin). Если этого ещё нет — добавляем (один `req.rbacContext = rbacCtx` в [tenant.guard.ts](backend/src/modules/rbac/guards/tenant.guard.ts) после `loadContext`).

### 4.4. `AccountsService.register` — создать membership к эталону

[backend/src/modules/accounts/accounts.service.ts:138-215](backend/src/modules/accounts/accounts.service.ts#L138-L215). В существующей `$transaction` после `createForOwner` добавить:

```ts
// 2026-06-01 — подключить новичка наблюдателем в эталонную демо-Org. См. ТЗ
// shared-demo-org-model §4.4. ID эталона — из ENV ZDEMO_ORG_ID, валидируется
// в TypedConfigService на старте. Membership идемпотентен через UNIQUE
// (userId, orgId).
const demoOrgId = this.cfg.demo.referenceOrgId;
if (demoOrgId) {
  const exists = await tx.membership.findFirst({
    where: { userId: user.id, orgId: demoOrgId },
    select: { id: true },
  });
  if (!exists) {
    await tx.membership.create({
      data: {
        userId: user.id,
        orgId: demoOrgId,
        role: 'demo_observer',
        invitedById: null,
        joinedAt: new Date(),
      },
    });
  }
}
```

**Обоснование idempotency:** повторная регистрация на тот же email (`signupSource='standalone'`) сейчас идёт через `upsertStandalone` без re-create Org. Демо-membership должен также не дублироваться.

### 4.5. `AccountsService.getMe` — currentOrgId предпочитает эталон

[backend/src/modules/accounts/accounts.service.ts:665-682](backend/src/modules/accounts/accounts.service.ts#L665-L682). Текущая логика: `firstMembership = first by joinedAt asc`. Логически: если у user есть `demo_observer` к эталону + `owner` к собственной — `joinedAt asc` вернёт эталон (он создан раньше при welcome или одновременно).

Нужно явно **предпочитать demo_observer** к эталону, если он есть. Иначе после login пользователь попадёт в свою пустую Org и не поймёт, где демо.

```ts
async getMe(userId: string): Promise<PublicUserDto & { ... }> {
  // ... existing
  const [fresh, demoMembership, firstOwnedMembership] = await Promise.all([
    this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperAdmin: true },
    }),
    // НОВОЕ: ищем активное demo-membership
    this.prisma.membership.findFirst({
      where: { userId, role: 'demo_observer', org: { deletedAt: null } },
      select: { orgId: true, role: true },
    }),
    this.prisma.membership.findFirst({
      where: { userId, role: { not: 'demo_observer' }, org: { deletedAt: null } },
      orderBy: { joinedAt: 'asc' },
      select: { orgId: true, role: true },
    }),
  ]);
  // Если есть demo-membership — по умолчанию открываем эталон.
  // Если демо снято (после оплаты) — открываем свою.
  const defaultMembership = demoMembership ?? firstOwnedMembership;
  return {
    ...this.toPublicUser(user),
    isSuperAdmin: fresh?.isSuperAdmin === true,
    currentOrgRole: defaultMembership?.role ?? null,
    currentOrgId: defaultMembership?.orgId ?? null,
  };
}
```

**Альтернатива:** возвращать **обе** memberships в `/accounts/me` (или дополнительный эндпоинт `/orgs/mine`), а на фронте уже логически выбирать default — это уже делается через `SidebarOrgSwitcher`. Но для минимальной правки — оставляем `currentOrgId` для дефолта.

### 4.6. ENV — `ZDEMO_ORG_ID`

[backend/src/common/config/env.schema.ts](backend/src/common/config/env.schema.ts) — добавить:

```ts
ZDEMO_ORG_ID: z.string().min(1).optional(),  // CUID эталонной демо-Org. Если не задана — авто-привязка наблюдателей отключена.
```

И в `TypedConfigService` геттер:

```ts
get demo(): { referenceOrgId: string | null } {
  return { referenceOrgId: this.env.ZDEMO_ORG_ID ?? null };
}
```

**Источник правды:** значение ENV выставляется один раз при выкатке, на основе CUID, который вернёт patch-скрипт `patch-create-reference-demo-org.ts` (§6.1).

**prod-deploy-log Шаг 1:** новая ENV `ZDEMO_ORG_ID=cm_xxxx`.

### 4.7. Удалить авто-сидинг (workers + welcome-complete enqueue)

#### 4.7.1. Удалить файлы

- `backend/src/modules/onboarding/workers/demo-seed.queue.ts`
- `backend/src/modules/onboarding/workers/demo-seed.worker.ts`

#### 4.7.2. `OnboardingService.completeWelcome` — убрать enqueue

В [onboarding.service.ts](backend/src/modules/onboarding/onboarding.service.ts) найти место, где добавился вызов `this.demoSeedQueue.enqueue(...)`, удалить. Тело метода должно вернуться к простому `welcomeCompletedAt = now()` + создание Document + `return { ok: true, redirectTo: '/dashboard' }`.

#### 4.7.3. Удалить эндпоинт `GET /api/v1/orgs/:orgId/demo-seed-status`

Если он есть отдельным контроллер-методом. Также из `frontend/src/api/onboarding.api.ts` убрать `getDemoSeedStatus`.

#### 4.7.4. Удалить регистрацию в `OnboardingModule`

`imports: [BullModule.registerQueue({ name: DEMO_SEED_QUEUE_NAME })]` — убрать.
`providers: [DemoSeedQueue, DemoSeedWorker]` — убрать.

#### 4.7.5. Удалить регистрацию в `backend/src/workers/main.ts`

Если воркер регистрировался отдельно — убрать.

### 4.8. Переориентировать cleanup-worker на эталон

#### 4.8.1. `SubscriptionActivatedListener` — НОВАЯ логика

[backend/src/modules/onboarding/listeners/subscription-activated.listener.ts](backend/src/modules/onboarding/listeners/subscription-activated.listener.ts). Заменить тело `onActivated`:

```ts
@OnEvent(BillingEvent.SUBSCRIPTION_ACTIVATED_PAID)
@OnEvent(BillingEvent.SUBSCRIPTION_ACTIVATED_BONUS)
async onActivated(payload: SubscriptionActivatedPayload): Promise<void> {
  // ВАЖНО: payload.tenantId — это активируемая Org пользователя, НЕ эталонная.
  // Нам нужно найти владельца этой Org и снять с него demo_observer membership.

  const demoOrgId = this.cfg.demo.referenceOrgId;
  if (!demoOrgId) {
    this.logger.warn({ orgId: payload.tenantId }, 'ZDEMO_ORG_ID не задана; пропускаем demo-detach');
    return;
  }

  // Не отвязываем от эталона самого же эталона (защита).
  if (payload.tenantId === demoOrgId) return;

  const activatedOrg = await this.prisma.org.findUnique({
    where: { id: payload.tenantId },
    select: { ownerId: true },
  });
  if (!activatedOrg) return;

  const deleted = await this.prisma.membership.deleteMany({
    where: {
      userId: activatedOrg.ownerId,
      orgId: demoOrgId,
      role: 'demo_observer',
    },
  });

  this.logger.log(
    { orgId: payload.tenantId, ownerId: activatedOrg.ownerId, deleted: deleted.count, mode: payload.paymentMode },
    'subscription activated → demo_observer membership snapped from reference org',
  );
}
```

Зависимости: добавить `TypedConfigService` в конструктор.

#### 4.8.2. `DemoCleanupQueue` / `DemoCleanupWorker` — оставить, переориентировать

Семантика меняется: теперь это «принудительное обновление эталона» (только super-admin'ом из CLI / `/admin/demo` для эталонной Org). Текущая логика (вызывает `resetDemoWorkspace`) сохраняется. Изменения:

- В `DemoCleanupWorker.process` добавить guard:
  ```ts
  const org = await this.prisma.org.findUnique({
    where: { id: data.orgId },
    select: { isReferenceDemo: true },
  });
  if (!org?.isReferenceDemo) {
    this.logger.error({ orgId: data.orgId }, 'cleanup отменён: org не эталонная');
    return;
  }
  ```
- Эндпоинт `POST /api/v1/admin/demo/orgs/:id/reset` и `POST /api/v1/orgs/:orgId/reset-demo` теперь принимают **только** эталонную Org (`isReferenceDemo=true`), иначе 400.

### 4.9. `OnboardingController` — изменить семантику демо-эндпоинтов

[backend/src/modules/onboarding/onboarding.controller.ts:96-126](backend/src/modules/onboarding/onboarding.controller.ts#L96-L126):

#### 4.9.1. `POST /orgs/:orgId/demo-workspace` — оставить, но ограничить эталоном

В `OnboardingService.seedDemoWorkspace` добавить precondition:

```ts
const org = await this.prisma.org.findUnique({
  where: { id: orgId },
  select: { id: true, isReferenceDemo: true, demoWorkspaceSeededAt: true },
});
if (!org?.isReferenceDemo) {
  throw new BadRequestException({
    ok: false,
    error: {
      code: 'not_reference_org',
      message: 'Seed разрешён только для эталонной демо-Org (isReferenceDemo=true).',
    },
  });
}
```

#### 4.9.2. `POST /orgs/:orgId/reset-demo` — то же

Только для эталонной (`isReferenceDemo=true`). Это становится «обновлением эталона» — не пользовательской фичей.

### 4.10. `SubscriptionGuard` — проверка ACTIVE-Org с paymentMode='reference'

[backend/src/modules/billing/guards/subscription.guard.ts:93](backend/src/modules/billing/guards/subscription.guard.ts#L93). Сейчас:

```ts
if (sub?.status === 'ACTIVE') return true;
```

Этого достаточно — эталон будет иметь `status=ACTIVE`, мутации пропускаются `SubscriptionGuard`'ом, но **режутся `DemoObserverGuard`'ом** (раньше в цепочке guard'ов). Проверить порядок:

```
CookieAuthGuard → TenantGuard → SubscriptionGuard → DemoObserverGuard → handler
```

(`DemoObserverGuard` глобальный через `APP_GUARD`, выполняется ПОСЛЕ method-guard'ов в NestJS? — проверить и зафиксировать. Если глобальные APP_GUARD'ы запускаются ПЕРЕД method-guard'ами, тогда наоборот — нужно сделать его method-guard'ом и подключить точечно. Тестом это проверяется тривиально.)

### 4.11. `BillingOverviewService` — исключить эталон из метрик

[backend/src/modules/billing/services/billing-overview.service.ts:98-110](backend/src/modules/billing/services/billing-overview.service.ts#L98-L110). Везде, где `status: 'ACTIVE'` + `paymentMode: 'paid'/'bonus'` — добавить `org: { isReferenceDemo: false }` в where (или фильтр по `paymentMode != 'reference'`).

Пример:

```ts
this.prisma.subscription.count({
  where: {
    status: 'ACTIVE',
    paymentMode: { in: ['paid', 'bonus'] },  // исключает 'reference'
  },
}),
```

### 4.12. Privacy: режем дополнительные эндпоинты для `demo_observer`

| Эндпоинт | Что делаем |
|---|---|
| `GET /settings/billing`, `/settings/subscription` | В контроллерах добавить `if (role === 'demo_observer') throw new ForbiddenException(...)` или сделать через `policy.csv` (не дано `billing.read`) |
| `GET /orgs/:orgId/members` | Фильтровать: для `demo_observer` возвращать только Person-карточки демо-сотрудников, не реальных пользователей с `role='demo_observer'`. См. [orgs.service.ts] — точку правок найти grep'ом |
| `GET /audit-log/*` | Уже не дано в `policy.csv` для `demo_observer` — ok |
| `GET /settings/integrations`, `/settings/api`, `/settings/webhooks`, `/settings/exports` | Те же эндпоинты — режем явно или политикой |
| `GET /admin/*` | Уже под `SuperAdminGuard`, не для `demo_observer` — ok |

Точечный список — Фаза 4 этого ТЗ.

### 4.13. Аудит per-user state (Развилка 12)

| Сущность | Где scoped | Действие |
|---|---|---|
| `ConciergeConversation` | `userId` + `tenantId` | Per-user работает. Проверить, что для `tenantId=DEMO_ORG_ID` концерж отвечает (LLM-вызов разрешён) |
| `tour-progress` | `userId` | Per-user, без правок |
| `Notification` | `userId` или `personId` | Если notification создаётся для demo-Person'а с `tenantId=DEMO_ORG_ID` — наблюдатель в эталоне может увидеть. Решение: фильтр в endpoint `/notifications`: для `demo_observer` показывать только notifications с `tenantId=DEMO_ORG_ID AND createdAt < user.joinedAt` (только «прошлые» наблюдательные), не текущие probe |
| Probe-events / probe-formulate | `tenantId` + `personId` | НЕ создавать probe-event'ы для пользователей с `demo_observer`. Проверить worker `probe-formulate.worker.ts` |
| `draft` (черновики) | `userId` | Перехватываются `DemoObserverGuard`'ом (write) — не доходят до сохранения. Если фронту нужны черновики — храним в localStorage |
| `OrgMember.list` (settings/members) | См. §4.12 | Фильтрация demo_observer'ов |

Список — фаза аудита (Фаза 4.5). Конкретные точки правок выписываются по результатам grep'а.

---

## 5. Frontend изменения

### 5.1. `auth-context.tsx` — поддержка двух Org

`accountsApi.me()` сейчас возвращает один `currentOrgId`. Добавить:

- Если в дальнейшем потребуется выбор между эталоном и своей Org — добавить `availableOrgs: Array<{id, name, role}>` в DTO `/accounts/me`.
- На первом этапе достаточно того, что `getMe()` сам возвращает эталон как default (см. §4.5).

### 5.2. Org-switcher

Найти существующий компонент (вероятно в [Sidebar.tsx](frontend/src/ui/components/app-shell/Sidebar.tsx) или в шапке) и убедиться, что:
- Если у user ≥2 memberships — он виден.
- Для эталона — подпись «Демо: ТехноСтрим» + значок 🔒 или badge «Просмотр».
- Для своей Org — подпись «Ваша компания (имя)» + при пустом состоянии badge «После оплаты».
- При клике — меняется `X-Org-Id` header (через context / route-param) и происходит SWR refresh.

Если org-switcher не существует — создать компактный (это XS-задача, 1 файл).

### 5.3. Удалить `/onboarding/demo-choice`

- `frontend/app/(authenticated)/onboarding/demo-choice/page.tsx` — удалить.
- Grep `demo-choice` — почистить упоминания.

### 5.4. Упростить `/onboarding/welcome/complete`

Сейчас это polling-страница по `demo-seed-status`. После реализации этого ТЗ — seed мгновенный (нечего ждать), страница не нужна. Варианты:

- **Удалить**: после `completeWelcome` фронт сразу `router.push('/dashboard')` (как сейчас и есть в [step-6/page.tsx:43](frontend/app/(authenticated)/onboarding/welcome/step-6/page.tsx#L43)).
- **Оставить как заглушку**: показать на 500ms приветственный экран «Добро пожаловать!» — это про UX, не про техническую необходимость.

**Рекомендация:** удалить. Меньше точек отказа.

### 5.5. `/admin/demo` — изменить семантику

[frontend/app/(admin)/admin/demo/DemoClient.tsx](frontend/app/(admin)/admin/demo/DemoClient.tsx):

- Список Org показывает все, как сейчас.
- Колонка «Действие» меняется в зависимости от `isReferenceDemo`:
  - **Эталонная** (одна на всю БД): кнопки «Залить с нуля» (для свежего проседа), «Перезалить (сбросить + залить)» — то есть `force-update`. Бейдж «🌟 Эталон».
  - **Не эталонная**: только индикатор «нет демо-данных» — копий больше не делаем. Можно опционально кнопку «Сделать эталоном» (но только если эталон ещё не существует — иначе show «Уже есть эталон, см. строку выше»).

Обработка: новый эндпоинт `POST /api/v1/admin/demo/orgs/:id/mark-reference` (только для одной Org за раз; если уже есть `isReferenceDemo=true` где-то ещё — 400). Этот эндпоинт нужен только для миграции на первом разе; после patch-скрипта (§6.1) — фактически unused, но оставим как safety.

### 5.6. Pустая своя Org — EmptyState с CTA

Когда пользователь переключился в свою пустую Org — на дашборде вместо пустых таблиц показывать:

```
┌────────────────────────────────────────┐
│  Ваша компания пока пустая             │
│                                        │
│  Демо «ТехноСтрим» показал, как        │
│  работает Кора. Чтобы создавать        │
│  встречи, задачи, регламенты в своей   │
│  компании — оплатите подписку.         │
│                                        │
│  [Оплатить → /settings/subscription]   │
│  [Вернуться в демо]                    │
└────────────────────────────────────────┘
```

Это **отдельный EmptyState** компонент для `/dashboard` (и опц. для `/entities`, `/meetings`, `/regulations`, `/documents`). Если `Org.isReferenceDemo === false && Subscription.status === 'DEMO' && нет данных` — показываем.

---

## 6. Prod-операции и patch-скрипты

### 6.1. `patch-create-reference-demo-org.ts` — создать эталон

Новый файл: `backend/scripts/patch-create-reference-demo-org.ts`.

**Что делает:**

1. Проверяет: нет ли уже Org с `isReferenceDemo=true`. Если есть — выводит её id, exit.
2. Создаёт новую Org «Демо: ТехноСтрим» с `isReferenceDemo=true`.
3. Создаёт «системного» User-владельца (`email: 'demo@kora.system'`, `passwordHash: null`).
4. Создаёт `Subscription { tenantId, status: 'ACTIVE', paymentMode: 'reference', startedAt: now, currentPeriodStart: now, currentPeriodEnd: now+100лет }`.
5. Вызывает `OnboardingService.seedDemoWorkspace({ orgId, userId })` — заливает все 23 модуля.
6. Печатает в stdout id Org: `ZDEMO_ORG_ID=<cuid>`.

**Запуск:**
```bash
docker compose exec backend bun run scripts/patch-create-reference-demo-org.ts
```

**Идемпотентность:** через шаг 1.

**После запуска:** записать `ZDEMO_ORG_ID` в `.env.prod` и `docker compose restart backend`.

### 6.2. `patch-migrate-old-demo-orgs.ts` — мигрировать копии

Новый файл: `backend/scripts/patch-migrate-old-demo-orgs.ts`.

**Что делает:**

1. Находит все Org, где `demoWorkspaceSeededAt != null AND isReferenceDemo = false`.
2. Для каждой:
   - Проверяет, есть ли в ней **реальные** записи (Meeting, IdeaBlock, …) с `externalSource IS NULL OR externalSource <> 'demo'`. Если есть — **пропускает** (это уже «обжитая» Org, в которой пользователь начал работать).
   - Иначе вызывает `OnboardingService.resetDemoWorkspace({ orgId, actorUserId: 'system:migration' })` — чистит всё с `externalSource='demo'`.
   - Создаёт `Membership(userId=ownerId, orgId=DEMO_ORG_ID, role='demo_observer', joinedAt=now)`.
   - Логирует.
3. В конце — статистика: «N очищены, M пропущены».

**Запуск:**
```bash
docker compose exec backend bun run scripts/patch-migrate-old-demo-orgs.ts
```

**Идемпотентность:** повторный запуск — найдёт уже сброшенные (нечего чистить), увидит существующие membership'ы (skip create).

### 6.3. `apply-prod-deploy.ts` — реестр

Добавить оба patch'а в массив `STEPS` с `phase: 'update'`, `skipBootstrap: true`. Порядок: сначала `patch-create-reference-demo-org`, потом `patch-migrate-old-demo-orgs`.

### 6.4. `docs/operations/prod-deploy-log.md` — обновить

- **Шаг 1 (ENV):** новая `ZDEMO_ORG_ID=cm_xxx` — выставляется ПОСЛЕ Шаг 6 (patch-create-reference-demo-org).
- **Шаг 4 (schema):** новое поле `Org.isReferenceDemo`, новое значение в `PaymentMode` enum, новое значение в `MembershipRole` enum.
- **Шаг 6 (patch):** `patch-create-reference-demo-org.ts` — запустить ОДИН раз, записать id в ENV.
- **Шаг 6 (patch):** `patch-migrate-old-demo-orgs.ts` — запустить после Шаг 6 предыдущего.
- **Шаг 12 (smoke):** проверить:
  - `curl https://app/api/v1/accounts/me -H 'Cookie: ...'` для нового user — возвращает `currentOrgId === ZDEMO_ORG_ID`.
  - Зайти в любой mutation endpoint с `X-Org-Id: ZDEMO_ORG_ID` — 403 `demo_observer_readonly`.
  - Activate subscription для своей Org → проверить, что `Membership` к эталону снят.

---

## 7. Edge-cases

| Кейс | Решение |
|---|---|
| `ZDEMO_ORG_ID` не задана (свежий dev без patch) | `AccountsService.register` не создаёт membership к эталону. Пользователь видит только свою пустую Org. UI gracefully показывает EmptyState. Логируется warning. Не блокер для dev |
| Эталонная Org удалена через `/admin/orgs/:id/delete` | TenantGuard вернёт 404 для membership'а к удалённой Org, но membership останется orphan'ом. Митигация: добавить guard в `/admin/orgs/:id/delete`: «если Org isReferenceDemo=true — 400 'cannot_delete_reference'» |
| User зарегистрирован ДО выкатки этого ТЗ (нет membership к эталону) | `patch-migrate-old-demo-orgs` для них создаёт membership (см. §6.2). Если не было `demoWorkspaceSeededAt` — пропускается. Для них на следующем login предложим «Посмотреть демо» через дополнительный CTA на `/dashboard` (опц.) |
| Membership к эталону существует, но эталон удалён | Membership возвращает orphan, getMe вернёт `currentOrgId=null` (или fallback на свою). Защита через guard выше |
| User оплатил, но listener'ом упало (БД timeout) | Membership к эталону остаётся → user видит эталон в switcher'е после оплаты. Не блокер: следующий refetch /me исправит после повторной активации, либо вручную super-admin через `/admin/demo` (новый эндпоинт «Снять demo с user» — опционально, не в MVP) |
| Параллельные регистрации | Membership create идемпотентен через UNIQUE (userId, orgId). Если коллизия — поймать `P2002`, считать ok |
| User зашёл повторно через год, эталонная Org обновилась контентом | Membership остался — user видит свежее содержимое. Никаких действий не нужно |
| super_admin зашёл в эталон | `isSuperAdmin` bypass'ит `DemoObserverGuard` → может мутировать. Это полезно для оперативных правок (исправил опечатку в демо-документе) |
| Cron-агенты (probe-event для demo-Person) | Не должны слать probe реальным `demo_observer`-наблюдателям. Фильтрация в воркере `probe-formulate.worker.ts` — Фаза 4.5 |
| Концерж-чат на эталоне | LLM-вызов разрешён, rate-limit per-user. См. open question Q3 в анализе |
| Пользователь хочет «отписаться от демо» вручную | Не нужно на MVP. Membership живёт пока user не платит. Можно добавить позже как «Скрыть демо» в org-switcher'е |

---

## 8. Фазы

### Фаза 0 — Pre-flight аудит (1ч)

- [x] **0.1** `git log --since="2026-05-25"` — список existing-файлов в frontmatter актуален. Последние правки: `f585ffe fix(demo): починить демо-сидинг`, `deca505 fix(onboarding): устойчивый демо-сидинг`, `748fb71 feat(onboarding): авто-сидинг при регистрации + cleanup при оплате` — всё в `onboarding`, ничего не сломано.
- [x] **0.2** **Порядок guard'ов:** глобальные `APP_GUARD` (SubscriptionGuard, EntitlementGuard, MustChangePasswordGuard) выполняются **РАНЬШЕ** method-level `TenantGuard`. К моменту `APP_GUARD` `req.rbacContext` ещё не выставлен (TenantGuard грузит `loadContext`, но НЕ кладёт в req). **Решение:** `DemoObserverGuard` ставим как `APP_GUARD`, который **сам** вызывает `rbac.loadContext(req.user.id, req.tenantId)`. `req.tenantId` уже выставлен `TenantMiddleware` (до guards). Дополнительно в `TenantGuard` всё равно добавляем `req.rbacContext = rbacCtx` для downstream-кода (как в §4.3). Дублирующий БД-запрос приемлем (membership.findFirst — дешёвый, мог бы быть кэширован, но без этого ок). Альтернатива «method-guard» отклонена — пришлось бы менять 100+ контроллеров.
- [x] **0.3** **OrgSwitcher уже существует**: `frontend/src/ui/components/app-shell/OrgSwitcher.tsx` + `useMemberships` хук в `frontend/src/hooks/useMemberships.ts`. Фаза 5.3 — адаптация (бейджи «Демо»/«Пусто»), не «создать с нуля».
- [x] **0.4** **`onboarding/demo-choice/page.tsx` уже удалён** в прошлой волне. Фаза 5.1 — no-op (фиксируем как «уже выполнено»).

### Фаза 1 — Schema + RBAC

- [ ] **1.1** В `schema.prisma`: добавить `demo_observer` в `MembershipRole`, `reference` в `PaymentMode`, поле `Org.isReferenceDemo Boolean @default(false)`.
- [ ] **1.2** `bun run prisma:push` (dev) + `bun run prisma:generate`.
- [ ] **1.3** В `RbacService.ts`: `isMembershipRole` — добавить `demo_observer`, метод `canMutate(role)`.
- [ ] **1.4** В `policy.csv`: блок правил для `demo_observer` (только `read`).
- [ ] **1.5** Unit-тесты: `canMutate('demo_observer') === false`, `canMutate('owner') === true`. Загрузка policy.csv валидируется.

### Фаза 2 — DemoObserverGuard

- [ ] **2.1** Создать `backend/src/common/guards/demo-observer.guard.ts` (см. §4.3).
- [ ] **2.2** В `TenantGuard` — гарантировать, что `req.rbacContext = rbacCtx` устанавливается ПОСЛЕ `loadContext` (если ещё не делается).
- [ ] **2.3** Подключить `DemoObserverGuard` глобально через `APP_GUARD` в `AppModule.providers` (если порядок ok из Фазы 0.2) ИЛИ как method-guard на mutating-эндпоинтах (массовое подключение через декоратор-обёртку).
- [ ] **2.4** Создать декоратор `@PublicDemo()`.
- [ ] **2.5** Integration-тест: запрос с ролью `demo_observer` + POST → 403 `demo_observer_readonly`. С ролью `owner` → ok. super_admin → ok.

### Фаза 3 — ENV + AccountsService

- [ ] **3.1** Добавить `ZDEMO_ORG_ID` в `env.schema.ts` + `TypedConfigService.demo.referenceOrgId`.
- [ ] **3.2** В `AccountsService.register` — добавить создание `Membership(demo_observer)` к эталону, идемпотентно. Поведение при `referenceOrgId=null` — пропуск + warning.
- [ ] **3.3** В `AccountsService.getMe` — приоритет `demo_observer`-membership как `currentOrgId/Role`.
- [ ] **3.4** Unit-тесты: register с/без ENV; getMe возвращает эталон если есть demo_membership; getMe возвращает свою если только owner.

### Фаза 4 — Listener + удаление авто-сидинга

- [ ] **4.1** В `SubscriptionActivatedListener.onActivated` — заменить тело: удалить `Membership(demo_observer)` владельца активированной Org. Подтянуть `TypedConfigService`.
- [ ] **4.2** Удалить `OnboardingService.completeWelcome` enqueue `demo-seed`.
- [ ] **4.3** Удалить `backend/src/modules/onboarding/workers/demo-seed.queue.ts` и `demo-seed.worker.ts`.
- [ ] **4.4** Из `OnboardingModule` убрать регистрацию `DemoSeedQueue / DemoSeedWorker` и BullMQ-queue.
- [ ] **4.5** Удалить эндпоинт `GET /demo-seed-status` (если был) и его frontend-API метод.
- [ ] **4.6** Аудит per-user state (Развилка 12): grep по `probe-formulate`, `notifications`, `concierge`. Для каждой точки — решить, нужны ли правки. Если да — отдельным под-tickets'ом.
- [ ] **4.7** В `OnboardingService.seedDemoWorkspace` — добавить precondition `isReferenceDemo=true`, иначе 400. То же для `resetDemoWorkspace`.
- [ ] **4.8** `BillingOverviewService` — исключить эталон из метрик `paid/bonus/active`.
- [ ] **4.9** Integration-тест: emit `SUBSCRIPTION_ACTIVATED_PAID` → membership к эталону снят. Эталонная Org не тронута.

### Фаза 5 — Frontend

- [ ] **5.1** Удалить `frontend/app/(authenticated)/onboarding/demo-choice/page.tsx`.
- [ ] **5.2** Удалить (или упростить до thin transition) `frontend/app/(authenticated)/onboarding/welcome/complete/page.tsx`. `step-6` сразу редиректит на `/dashboard`.
- [ ] **5.3** Org-switcher: показать все memberships user'а с пометками. Если эталон — badge «Демо», bg-muted; если своя пустая — badge «Пусто, оплатите».
- [ ] **5.4** EmptyState для своей пустой Org на `/dashboard` (и опц. `/entities`, `/meetings`, `/regulations`, `/documents`) с CTA «Оплатить» + «Вернуться в демо».
- [ ] **5.5** `/admin/demo`: бейдж «Эталон» рядом с Org, где `isReferenceDemo=true`. Кнопки «Залить» / «Перезалить (force-update)» — только для эталонной строки. Для остальных — индикатор «нет демо-копии».
- [ ] **5.6** Frontend `typecheck`, `lint`, `test:unit` зелёные.

### Фаза 6 — Patch-скрипты + prod-deploy-log

- [ ] **6.1** Написать `backend/scripts/patch-create-reference-demo-org.ts`.
- [ ] **6.2** Написать `backend/scripts/patch-migrate-old-demo-orgs.ts`.
- [ ] **6.3** Добавить оба в `apply-prod-deploy.ts` (mode=update, skipBootstrap=true).
- [ ] **6.4** Обновить `docs/operations/prod-deploy-log.md`: новые Шаги 1, 4, 6, 12.

### Фаза 7 — Dev smoke + второй мозг

- [ ] **7.1** Локально: применить `prisma:push`, прогнать `patch-create-reference-demo-org` → получить ID → выставить ENV → перезапустить → зарегистрировать нового user → проверить, что:
  - после welcome дашборд сразу заполнен (никакого «Готовим…»);
  - все 7 Pulse-виджетов на главной;
  - попытка создать встречу → 403 demo_observer_readonly;
  - переключение org-switcher'ом в свою Org → EmptyState с CTA.
- [ ] **7.2** Локально: emulate оплату (`/admin/orgs/:tenantId/billing/force-status` → ACTIVE bonus) → проверить, что membership к эталону снят, org-switcher без эталона.
- [ ] **7.3** Обновить `second-brain/01_projects/demo-workspace.md` (или создать новый).
- [ ] **7.4** Обновить `second-brain/01_projects/onboarding-wizard.md` (убрать demo-choice и welcome/complete polling).
- [ ] **7.5** Обновить `second-brain/02_architecture/module-map.md` если структура onboarding меняется.
- [ ] **7.6** `bun run typecheck`, `lint`, `build` зелёные (backend + frontend).

---

## 9. Что НЕ делаем

- ❌ Не реализуем `2026-05-31-demo-auto-seed-and-cleanup.md` — он становится не нужным (демо не копируется, нечего сидить и нечего чистить per-user).
- ❌ Не делаем «вторичные эталоны под отрасль» (отложено, не блокер).
- ❌ Не делаем `User.currentOrgId` отдельным полем в БД (остаётся derived из memberships, как сейчас).
- ❌ Не делаем отдельный `Subscription per User` — подписка остаётся per Org.
- ❌ Не трогаем `SubscriptionGuard`, `PaywallBanner`, `PaywallModal`, `SubscriptionContext` — они работают со статусом подписки своей Org, поведение там не меняется.
- ❌ Не удаляем `seedDemoWorkspace` / `resetDemoWorkspace` / `markAllDemoEntitiesForTenant` — они нужны для эталона (CLI / `/admin/demo` force-update).
- ❌ Не делаем «Скрыть демо» / «Отписаться от демо» для пользователя — membership живёт до оплаты.
- ❌ Не пересчитываем `Subscription.monthlyPriceKopecks` снапшоты у активных Org (см. feedback memory `admin_settings_not_env_or_code`).

---

## 10. Связь с другими ТЗ

| Документ | Роль |
|---|---|
| [`2026-06-01-demo-shared-org-architecture.md`](../analysis/2026-06-01-demo-shared-org-architecture.md) | Анализ-источник: 15 архитектурных развилок с доказательствами |
| [`2026-05-28-demo-workspace.md`](./2026-05-28-demo-workspace.md) ✅ реализован | Источник `seedDemoWorkspace` / `resetDemoWorkspace`. Остаётся как **инструмент для эталона**, применение per-user удаляется |
| [`2026-05-31-demo-content-expansion-pulse.md`](./2026-05-31-demo-content-expansion-pulse.md) ✅ частично | Контент демо. Применяется к эталону ОДИН раз через CLI |
| [`2026-05-31-demo-auto-seed-and-cleanup.md`](./2026-05-31-demo-auto-seed-and-cleanup.md) ✅ реализован | **Полностью superseded**: BullMQ-очереди и polling-страница удаляются (см. Фаза 4) |
| [`2026-05-29-admin-demo-workspace-creation.md`](./2026-05-29-admin-demo-workspace-creation.md) ✅ реализован | `/admin/demo` остаётся; меняется семантика (см. §5.5) |
| [`2026-05-27-billing-tochka-referral-dadata-z.md`](./2026-05-27-billing-tochka-referral-dadata-z.md) ✅ реализован | Источник `BillingEvent.SUBSCRIPTION_ACTIVATED_PAID/BONUS`. Не трогаем — только меняем поведение listener'а |

---

## 11. DoD

- [ ] Новый пользователь после welcome сразу попадает в эталон, без «Готовим…».
- [ ] Дашборд эталона полностью заполнен (7 Pulse-виджетов + KPI + Team Health + AI Narrative).
- [ ] Все вкладки сайдбара эталона содержат данные (регламенты, идеи, документы, календарь, фидбек, рефералка, граф знаний).
- [ ] Попытка любой мутации в эталоне → 403 `demo_observer_readonly`.
- [ ] В шапке/сайдбаре виден org-switcher с двумя Org.
- [ ] При переключении в свою Org → дашборд показывает EmptyState с CTA «Оплатить».
- [ ] После manual bonus / реальной оплаты → membership к эталону снят, org-switcher без эталона.
- [ ] Эталонная Org НЕ изменилась после оплаты (нет «случайного» удаления данных).
- [ ] На проде (после patch'ей §6) все existing Org с пустыми копиями → подключены к эталону.
- [ ] Удалены файлы: `demo-choice/page.tsx`, `welcome/complete/page.tsx` (или упрощена), `demo-seed.queue.ts`, `demo-seed.worker.ts`, эндпоинт `demo-seed-status`.
- [ ] `bun run typecheck`, `bun run lint`, `bun run build`, `bun run worker:dev` — все зелёные.
- [ ] `docs/operations/prod-deploy-log.md` обновлён с новыми Шаг 1 / 4 / 6 / 12.
- [ ] `second-brain/01_projects/demo-workspace.md` (новый) + `onboarding-wizard.md` (обновлён).
- [ ] Рефлексия записана в `second-brain/05_история/`.

---

## 12. Open questions (вынесены из анализа §5)

Эти вопросы не блокируют старт работы, но желательно ответить до Фазы 5/4.5:

| # | Вопрос | Default в реализации |
|---|---|---|
| Q1 | Имя эталонной Org в UI: «ТехноСтрим» или «Демо: ТехноСтрим»? | «Демо: ТехноСтрим» |
| Q2 | Переключение в свою Org → EmptyState или сразу `/settings/subscription`? | EmptyState с CTA |
| Q3 | Концерж-чат в эталоне — реальный LLM или мок? | Реальный с rate-limit 5/день per user |
| Q4 | Probe-вопросы для demo-сотрудников — продолжают создаваться cron'ом? | Не назначаются `demo_observer`-наблюдателям (Фаза 4.6) |
| Q5 | TG-бот доступен для `demo_observer`? | Нет, привязка не работает |
| Q6 | Membership к эталону живёт пока не оплачено — или TTL? | Без TTL, навсегда |

---

## 13. Итог

_Заполняется по факту реализации._

---

## 14. Аргумент в одну строку

Демо — это не операция (seed), это состояние (membership). Превращаем «как засеять каждому» в «как подключить к одной готовой» — и весь стек tooling'а вокруг seed-копий (BullMQ, polling, cleanup, частичные сбои) исчезает за ненадобностью.
