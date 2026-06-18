---
title: Демо-кабинет «Демо: ТехноСтрим» (shared эталон)
status: in_progress
date: 2026-06-01
references:
  - plans/archive/2026-06-01-demo-shared-org-model.md
  - plans/analysis/2026-06-01-demo-shared-org-architecture.md
  - plans/archive/2026-05-28-demo-workspace.md  # source seedDemoWorkspace
---

# Демо-кабинет «Демо: ТехноСтрим» (shared эталон)

## Что это

**Одна** эталонная Org в БД (`isReferenceDemo=true`), наполненная реальными демо-данными «ТехноСтрим» через CLI один раз при выкатке. Все новые пользователи становятся её наблюдателями (роль `demo_observer`) автоматически при регистрации — никаких копий per-Org, никакого ожидания, никакого тоста «Готовим…».

Подход назван «демо как состояние, а не как операция»: пользователю не нужно ждать seed — нужно иметь membership к уже залитой Org.

## Сущности

```
БД (постоянно):
  Org "Демо: ТехноСтрим" (id из ENV ZDEMO_ORG_ID)
    isReferenceDemo = true
    Subscription { status: ACTIVE, paymentMode: 'reference' }
    + 23 модуля демо-данных (Person, Meeting, Theme, Goal, Pulse, …)

  Org "ООО Ромашка" (своя Org пользователя)
    isReferenceDemo = false
    Subscription { status: DEMO, paymentMode: null }

  User Иван
    Memberships:
      ├─ (Иван, "ТехноСтрим", role='demo_observer', invitedBy=null)
      └─ (Иван, "ООО Ромашка", role='owner', invitedBy=null)
```

## Жизненный цикл

1. **Регистрация:** `AccountsService.register` создаёт `Membership(demo_observer)` к эталону внутри той же `$transaction`, что и `Membership(owner)` для своей Org. Идемпотентно через UNIQUE `(orgId, userId)`. Если `ZDEMO_ORG_ID` не задана — fallback skip + warning.
2. **`/accounts/me`:** `getMe` явно предпочитает demo_observer-membership → пользователь по умолчанию открывается в эталоне.
3. **Mutations в эталоне:** `DemoObserverGuard` (APP_GUARD) режет POST/PUT/PATCH/DELETE с 403 `demo_observer_readonly`. super_admin bypass + GET/HEAD/OPTIONS + `/billing`/`/auth`/`/me/*`/`/accounts/me` + `@PublicDemo()` decorator — пропускаются.
4. **Оплата своей Org (DEMO→ACTIVE):** `SubscriptionActivatedListener` удаляет `Membership(demo_observer)` владельца. Эталон не тронут. OrgSwitcher после refetch /accounts/me показывает только свою Org.

## Ключевые файлы

### Backend

- `backend/prisma/schema.prisma` — `MembershipRole +demo_observer`, `Org.isReferenceDemo Boolean`, `PaymentMode +reference`.
- `backend/src/modules/rbac/rbac.service.ts` — `canMutate(role): boolean` (false только для demo_observer).
- `backend/src/modules/rbac/policies/policy.csv` — read-only правила для demo_observer + read/write self на concierge.
- `backend/src/common/guards/demo-observer.guard.ts` — APP_GUARD, self-load roli через `rbac.loadContext`.
- `backend/src/common/guards/public-demo.decorator.ts` — `@PublicDemo()` для исключений.
- `backend/src/modules/rbac/guards/tenant.guard.ts` — кэширует `req.rbacContext` после loadContext.
- `backend/src/modules/accounts/accounts.service.ts` — `register` создаёт demo_observer membership, `getMe` предпочитает его.
- `backend/src/common/config/env.schema.ts` — `ZDEMO_ORG_ID: z.string().min(1).optional()`.
- `backend/src/common/config/typed-config.service.ts` — `get demo(): { referenceOrgId }`.
- `backend/src/modules/onboarding/listeners/subscription-activated.listener.ts` — detach demo_observer при оплате.
- `backend/src/modules/billing/services/billing-overview.service.ts` — исключает `reference` из metrics.
- `backend/scripts/patch-create-reference-demo-org.ts` — создаёт эталон + заливает данные.
- `backend/scripts/patch-migrate-old-demo-orgs.ts` — мигрирует старые «копии ТехноСтрим».
- `backend/scripts/seed-demo-workspace.ts` — остаётся как CLI для эталона (форс-обновление через `/admin/demo`).

### Frontend

- `frontend/src/api/orgs.api.ts`, `frontend/src/hooks/useMemberships.ts` — `OrgApi.isReferenceDemo` пробрасывается.
- `frontend/src/ui/components/app-shell/OrgSwitcher.tsx` — бейдж «Демо» для эталона.
- `frontend/src/ui/components/dashboard/MainEmptyState.tsx` — полно-страничный empty-state для своей пустой Org в DEMO (подключается в DirectorDashboardClient через шаг В.1 зонтика main-screen-umbrella).
- `frontend/app/(admin)/admin/demo/DemoClient.tsx` — бейдж «🌟 Эталон», force-update кнопки только для эталонной строки.
- `frontend/src/api/admin-demo.api.ts` — `AdminDemoOrgApi.isReferenceDemo`.

## ENV

- `ZDEMO_ORG_ID` — CUID эталонной Org. Optional. Если пуст — авто-привязка наблюдателей отключена (новые пользователи видят только свою Org). Выставляется на проде после первого запуска `patch-create-reference-demo-org.ts`.

## Что НЕ работает в эталоне для demo_observer

- Любые POST/PUT/PATCH/DELETE доменных данных → 403 `demo_observer_readonly`.
- `/settings/billing`, `/settings/subscription` — режутся policy.csv (не дано `billing.read`).
- `/admin/*` — `SuperAdminGuard` (не для demo_observer).
- `/settings/members` — фильтрация demo_observer'ов из списка (TODO в Фазе 4.6, отложено как открытый хвост).
- Probe-вопросы для demo-Person — НЕ должны рассылаться наблюдателям (TODO в `probe-formulate.worker.ts`, отложено).

## Что работает в эталоне для demo_observer

- Чтение всех доменных данных (meeting, theme, goal, pulse, idea, knowledge_profile, skill_profile…).
- LLM-чат `concierge` — `@PublicDemo()` на endpoint'е (read-only по природе, не мутирует доменные данные). Rate-limit через существующую `ai-chat-quota`.
- Tour progress, прочитанные уведомления — per-user, работают без правок.
- Switcher между эталоном и своей Org.

## Force-update эталона

Через `/admin/demo` super-admin или CLI:
```bash
docker compose exec backend bun run scripts/seed-demo-workspace.ts --tenant $ZDEMO_ORG_ID --owner <demo-system-user-id> --reset
docker compose exec backend bun run scripts/seed-demo-workspace.ts --tenant $ZDEMO_ORG_ID --owner <demo-system-user-id>
```

`DemoCleanupWorker.process` имеет guard `isReferenceDemo=true` — для не-эталонных Org возвращает error (защита от случайного wipe чужой Org).

## Открытые хвосты

См. `plans/archive/2026-06-01-demo-shared-org-model.md` §4.6, §4.12:
- Probe-events для demo-Person'ов — фильтр в воркере (не задевать demo_observer наблюдателей).
- Notifications для demo-Person'ов — фильтрация в `/me/notifications` (показать только до joinedAt).
- `/settings/members` фильтрация demo_observer'ов из списка.
- TG-бот для demo_observer — не доступен (не привязывать).

## Связи

- [[onboarding-wizard]] — где описан поток регистрации.
- [[workers-queues]] — `demo-cleanup` queue (только для эталона).
- [[admin]] — `/admin/demo` страница.
