---
type: tz
status: ready-to-implement
date: 2026-06-02
owner: sergrv80@gmail.com
feature: Доделать 9 открытых хвостов зонтика `main-screen-umbrella` — то, что было осознанно отложено за scope-cut'ом первой выкатки (backend endpoints, privacy filters, DTO union, UX-полировка). После этого ТЗ зонтик `main-screen-umbrella` закрыт полностью.
parent_umbrella: plans/archive/2026-06-01-main-screen-umbrella.md
parent_children:
  - plans/archive/2026-06-01-demo-shared-org-model.md
  - plans/tz/2026-06-01-dashboard-main-tabs-restructure.md
relates_to:
  - docs/reference/dashboards-registry.md
  - second-brain/01_projects/frontend-pages.md
existing_critical_files:
  # хвост #2 — DTO currentOrgRole
  - frontend/src/api/types/accounts.ts                                       # union 'owner'|'admin'|'manager'|'coo' — расширить
  - frontend/src/domain/account.ts                                            # mapper ApiDto→DomainModel
  - frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx       # `(currentOrgRole as string | null) === 'demo_observer'` — убрать cast
  # хвост #3 — Probe filter
  - backend/src/modules/probe/probe.service.ts                                # suggest() — добавить early-return по Org.isReferenceDemo
  - backend/src/modules/probe/probe-dispatcher.worker.ts                      # process() — добавить guard перед dispatch
  # хвост #4 — Members privacy
  - backend/src/modules/orgs/orgs.service.ts                                  # listMembers() — фильтрация demo_observer для не-super-admin
  # хвост #7 — switch-org persistent
  - backend/prisma/schema.prisma                                              # User.preferredOrgId
  - backend/src/modules/auth/auth.controller.ts                               # POST /auth/switch-org — убрать TODO + персистировать
  - backend/src/modules/accounts/accounts.service.ts                          # getMe() — приоритет preferredOrgId
  # хвост #1 — PeopleAtRiskWidget endpoint
  - backend/src/modules/dashboard/dashboard.controller.ts                    # новый GET /dashboard/people-at-risk
  - backend/src/modules/dashboard/services/                                  # новый PeopleAtRiskService (или в существующий dashboard.service.ts)
  - backend/src/modules/persons/services/person-pulse.service.ts             # источник engagementScore per Person
  - frontend/src/api/dashboard.api.ts                                         # peopleAtRisk()
  - frontend/src/ui/components/dashboard/PeopleAtRiskWidget.tsx              # заменить заглушку на реальный fetch
  # хвост #8 — OrgSwitcher subscription badge
  - frontend/src/hooks/useMemberships.ts                                      # расширить Membership типом subscriptionStatus
  - frontend/src/ui/components/app-shell/OrgSwitcher.tsx                     # бейдж «Пусто, оплатите»
  - backend/src/modules/orgs/orgs.controller.ts                              # GET /orgs/mine (или /accounts/me) — добавить subscriptionStatus per membership
  # хвосты #5, #6, #9 — UX полировка
  - frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx       # ResizeObserver для --hero-h + TeamTab empty tracking
  - frontend/src/ui/components/dashboard/AssistantSidebar.tsx                # autoFocus при open-ask
  - frontend/src/ui/components/chat/OrgChatPanel.tsx                         # экспонировать autoFocus prop
  - frontend/src/ui/components/dashboard/TeamHealthGrid.tsx                  # либо lift fetch up, либо onEmpty callback
---

> **Статус:** ТЗ создано 2026-06-02. Зонтик `main-screen-umbrella` уже выкачен (22 коммита, backend 3017/3050, frontend 115/115). Это ТЗ — закрытие 9 явно зафиксированных открытых хвостов из финальной рефлексии. После него зонтик считается закрытым на 100%.
>
> Каждый хвост в этом ТЗ — это не «улучшение поверх», а **закрытие пункта, который был осознанно отложен** на этапе scope-cut волн А/Б/В. Все 9 имеют ссылки в реестре, JSDoc-комментариях кода, открытых вопросах ТЗ А/Б.

# ТЗ: финализация main-screen-umbrella — закрытие 9 хвостов

## 1. Контекст

Зонтик [main-screen-umbrella](2026-06-01-main-screen-umbrella.md) сведён из двух ТЗ:
- **Поток А** ([demo-shared-org-model](2026-06-01-demo-shared-org-model.md)) — backend-фундамент эталона.
- **Поток Б** ([dashboard-main-tabs-restructure](2026-06-01-dashboard-main-tabs-restructure.md)) — UI главной как «пульт компании».

В финальной рефлексии 2026-06-01 зафиксированы **9 хвостов**, которые были осознанно отложены:

| # | Хвост | Источник в умбрелле | Тип |
|---|---|---|---|
| 1 | `GET /api/v1/dashboard/people-at-risk` endpoint + per-Person Pulse score | ТЗ Б Фаза 7 + реестр §4.4 | Backend |
| 2 | `currentOrgRole` DTO на фронте — нет `demo_observer` в union | ТЗ А Фаза 5 — отложено как scope-cut | Frontend DTO |
| 3 | Probe-events для demo-Person'ов фильтр по `isReferenceDemo` | ТЗ А Фаза 4.6 — отложено как scope-cut | Backend |
| 4 | Privacy для `/settings/members` — фильтрация `demo_observer`'ов из списка | ТЗ А Фаза 4.12 — отложено как scope-cut | Backend |
| 5 | Динамический `--hero-h` CSS-var | ТЗ Б Фаза 2 — fallback 200/260px вместо ResizeObserver | Frontend UX |
| 6 | Auto-focus textarea при `open-ask` event | ТЗ Б Фаза 4 — `OrgChatPanel` не экспонирует autoFocus prop | Frontend UX |
| 7 | Backend endpoint `POST /api/v1/auth/switch-org` — реальное сохранение | ТЗ А Фаза 5.2 — STUB с `todo` в response | Backend |
| 8 | «Пусто, оплатите» бейдж в `OrgSwitcher` для своей пустой Org | ТЗ А Фаза 5.3 — нужен subscription per Org | Frontend |
| 9 | `TabEmptyState` в TeamTab — нет logic тракинга «всё пусто» | ТЗ Б Фаза 6 — `TeamHealthGrid` сам fetch'ит | Frontend |

**Принцип ТЗ:** каждый хвост закрывается **минимальным безопасным изменением**. Если у хвоста несколько решений — в фазе зафиксировано выбранное + почему. Ни одной «полировки сверху», ни одной новой фичи.

## 2. Принципы (читать перед началом)

1. **Каждый хвост — отдельная фаза с собственным DoD.** Можно стопать после любой фазы и коммитить как самодостаточный шаг.
2. **Никаких рефакторингов вне scope хвоста.** Если по пути встретили грязный код — фиксируем как issue, не правим.
3. **Парные токены, русский, без hex/slate** (стандарт DS Z, без изменений).
4. **Все backend-эндпоинты — Zod-DTO + Swagger + `@PublicDemo()` если read-only** (см. [nestjs-rules](skill)).
5. **Prisma — только `bun run prisma:push`**, никаких миграций (см. [prisma-db-push-rules](skill)).
6. **ENV — только через `TypedConfigService` / `env.schema.ts`** (нет новых ENV в этом ТЗ, но если появятся — через схему).
7. **Тесты:** unit-тесты для новых сервисов/guard-сценариев. Integration-тест для switch-org persistence. Smoke вручную для UI-хвостов.
8. **Подсчёт coverage:** после Фазы 8 верификация даёт зелёные `backend 3017+/3050+` и `frontend 115+/115+` (количество тестов не уменьшается).

## 3. Архитектурные решения по каждому хвосту

Для каждого хвоста — выбранное решение + альтернатива + почему первое лучше. Это раздел-арбитраж, чтобы не возникало вопросов на этапе фаз.

### 3.1. Хвост #1 — endpoint `/dashboard/people-at-risk`

**Что нужно:** ranked top-N сотрудников с самым низким Pulse score за неделю.

**Источник данных (выбран):** `Person.engagementScore` (0..1, заполняется `EngagementScorerCron` per `person-pulse.service.ts:11-12`). Это **уже существующее поле**, которое читает `/persons/:id/pulse`. Никаких новых cron'ов, никаких новых таблиц.

**Альтернатива:** агрегировать «на лету» из `DailyCheckIn.sentiment` за 7 дней. Хуже, потому что:
- cron `EngagementScorerCron` уже это делает с правильными весами (sentiment + qualityScore + activity);
- на лету — дополнительная нагрузка на каждый dashboard-fetch;
- результат разойдётся с числом на `/persons/:id/pulse` → пользователь увидит несогласованность.

**Endpoint:**
```
GET /api/v1/dashboard/people-at-risk?limit=3
→ {
    items: Array<{
      personId: string,
      name: string,
      roleLabel: string | null,
      pulseScore: number,             // 0..100 (engagementScore * 100, округление вниз)
      engagementScoreAt: string | null,
    }>
  }
```

- ORDER BY `engagementScore ASC NULLS LAST` (низший score первым), LIMIT.
- WHERE `tenantId = ctx.tenantId AND engagementScore IS NOT NULL AND engagementScore < 0.7` (порог «риск» — соответствует жёлто-красной зоне, фиксируем константой `PEOPLE_AT_RISK_THRESHOLD = 0.7`).
- `roleLabel` — `Person.primaryDepartment.name + ' · ' + Person.primaryRole` (если есть), иначе `null`.
- Защита по RBAC: read-доступ — `owner`/`admin`/`hr_partner`. Для `manager`/`coo` — TBD на этапе фазы (по умолчанию: тот же `dashboard:read` policy, что у других CEO-endpoint'ов).
- Кэш Redis 60 секунд (как у `/dashboard/pulse-patterns`).

**Виджет на фронте:** убрать `items === null` заглушку, подключить SWR-fetch. Если `items.length === 0` — рендерится зелёный success-state «Все сотрудники в норме» (уже есть в коде).

### 3.2. Хвост #2 — `currentOrgRole` union

**Что нужно:** в DTO `AccountUserApi.currentOrgRole` сейчас union `'owner' | 'admin' | 'manager' | 'coo'`. Нужно добавить `'hr_partner'` (SBA добавляла позже, в DTO не попала) + `'demo_observer'`.

**Решение:** расширить union в одном месте — `frontend/src/api/types/accounts.ts:25`. Все consumers — TypeScript автоматически подсветит `never`-сужения, чинятся правкой условий (≤10 точек).

**Также убрать:** в `DirectorDashboardClient.tsx:382` — cast `(currentOrgRole as string | null) === 'demo_observer'`. После расширения union — cast не нужен.

**Альтернатива:** ввести отдельный enum `MembershipRoleUi`. Хуже: дублирование backend-enum'а, расхождения; единственный плюс — централизованное место, но `AccountUserApi.currentOrgRole` и есть оно.

**Источник правды:** backend `prisma.MembershipRole` enum (`owner|admin|manager|coo|hr_partner|demo_observer`). Frontend union должен совпадать. Добавляем коммент в `accounts.ts`: «Источник правды — `backend/prisma/schema.prisma` enum MembershipRole».

### 3.3. Хвост #3 — Probe filter по эталону

**Что нужно:** Probe-events (вопросы AI команде) не должны рассылаться `demo_observer`-наблюдателям эталона. ТЗ А §4.6 — отложено.

**Решение:** добавить **early-return в `ProbeService.suggest`**: если `tenantId` принадлежит Org с `isReferenceDemo=true` → drop с reason `'reference_demo'` (новый дроп-код, добавить в `ProbeSuggestResult.dropped` union).

```ts
// в начале ProbeService.suggest, после null-проверок:
const org = await this.prisma.org.findUnique({
  where: { id: input.tenantId },
  select: { isReferenceDemo: true },
});
if (org?.isReferenceDemo) {
  this.metrics.incProbeEvent({ ..., status: 'dropped_reference_demo' });
  return { dropped: 'reference_demo' };
}
```

**Почему early-return в `suggest()`, а не filter в `dispatcher.worker.process()`:**
- `suggest()` — единственная точка входа всех специалистов Слоя 3 (Decisions, Promise-Keeper и т.п.). Один guard режет на корне.
- `dispatcher.worker` срабатывает позже, после persist'а в БД. Если фильтровать только там — будем накапливать «мёртвые» ProbeEvent'ы в БД (`status='dispatched'` к никому). Грязный shadow-state.

**Дополнительно (safety-net):** в `ProbeDispatcherWorker.process()` — defensive guard, такой же check + skip с логом. На случай legacy-job'ов в очереди и для unit-тестов.

**Альтернатива:** фильтровать `recipientCandidates` per-user (выкидывать тех, у кого `role='demo_observer'`). Хуже:
- эталонная Org имеет `User-владельца` (см. patch-create-reference-demo-org), который не `demo_observer`, но всё равно не должен получать probe'ы (он системный, без TG-привязки);
- проще резать на корне по `Org.isReferenceDemo`, чем перебирать candidates.

**Метрика:** в Prometheus добавить `probe_events_total{status="dropped_reference_demo"}`.

### 3.4. Хвост #4 — Members privacy

**Что нужно:** `GET /api/v1/orgs/:id/members` сейчас отдаёт все membership'ы, включая `demo_observer`'ов. В эталоне это **обнажает persona-data** наблюдателей-незнакомцев (через 1000 регистраций — список из 1000 чужих email). ТЗ А §4.12 — отложено.

**Решение:** в `OrgsService.listMembers(orgId, userId)` — после load membership'ов, **отфильтровать `role='demo_observer'`** для всех viewer'ов **кроме super_admin**.

```ts
// после members.map((m) => ({...}))
const isSuperAdmin = await this.prisma.user.findUnique({
  where: { id: userId },
  select: { isSuperAdmin: true },
}).then(u => u?.isSuperAdmin === true);
return isSuperAdmin ? mapped : mapped.filter(m => m.role !== 'demo_observer');
```

**Почему фильтр на сервере, а не на фронте:** privacy-фильтр всегда на сервере (защита от `curl /api/v1/orgs/:id/members`). На фронте — никаких правок не нужно.

**Защита для super_admin:** видит всё, чтобы суперадмин мог найти конкретного demo_observer'а для саппорта/расследования.

**Альтернатива:** RBAC policy.csv добавить `p, demo_observer, *, *, member-list, deny` — но это про то, кто **читает** список, а не про то, кого **показывать в** списке. Не подходит.

**Smoke:** owner эталонной Org делает `GET /orgs/:id/members` → видит только себя (системного владельца). super_admin → видит всех + наблюдателей.

### 3.5. Хвост #7 — switch-org persistent state

**Что нужно:** сейчас `POST /api/v1/auth/switch-org` — STUB ([auth.controller.ts:177-245](backend/src/modules/auth/auth.controller.ts#L177)), возвращает `{success: true, ..., todo: 'session update — Фаза 0a.3 шаг 2'}`. Фронт делает retry с localStorage fallback. Текущий механизм «X-Org-Id header» работает, но **выбор пользователя не сохраняется между устройствами**.

**Решение:** добавить поле **`User.preferredOrgId String? @db.VarChar(40)`**. POST `/auth/switch-org` — persistит. `AccountsService.getMe` — приоритет:
1. `User.preferredOrgId` если активный membership к этой Org существует;
2. иначе `demo_observer`-membership к эталону (текущая логика);
3. иначе первый `owner/admin/manager/coo/hr_partner` membership (текущий fallback).

```ts
// AccountsService.getMe — добавить query preferredOrgMembership
const [fresh, demoMembership, firstOwnedMembership, preferredMembership] = await Promise.all([
  this.prisma.user.findUnique({ where: { id: userId }, select: { isSuperAdmin: true, preferredOrgId: true } }),
  this.prisma.membership.findFirst({ where: { userId, role: 'demo_observer', org: { deletedAt: null } }, select: { orgId: true, role: true } }),
  this.prisma.membership.findFirst({ where: { userId, role: { not: 'demo_observer' }, org: { deletedAt: null } }, orderBy: { joinedAt: 'asc' }, select: { orgId: true, role: true } }),
  fresh?.preferredOrgId
    ? this.prisma.membership.findFirst({ where: { userId, orgId: fresh.preferredOrgId, org: { deletedAt: null } }, select: { orgId: true, role: true } })
    : Promise.resolve(null),
]);
const defaultMembership = preferredMembership ?? demoMembership ?? firstOwnedMembership;
```

(Структурно: одну query можно сэкономить — но это полировка, не блокер.)

**`switchOrg` controller:**
```ts
// После проверки membership/superadmin:
await this.prisma.user.update({
  where: { id: user.id },
  data: { preferredOrgId: body.orgId },
});
// Убрать поле `todo` из response.
return { success: true, user: {...}, currentOrgId: body.orgId, currentOrgRole: membership?.role ?? 'admin' };
```

**Почему `User.preferredOrgId`, а не Session/Redis:**
- **Persistence across devices**: пользователь зашёл с phone → переключился в свою Org → зашёл с laptop → видит свою Org. Redis-session живёт только в текущем браузере.
- **Один источник правды**: `getMe()` уже грузит User row. Добавляем одно поле, не отдельный сторадж.
- **Не нужен invalidation**: при `Membership.delete` (например, после оплаты — `SubscriptionActivatedListener` снимает demo_observer) — `getMe()` fallback'нется на demo→first, потому что `preferredMembership` найдёт `null` (если preferredOrgId указывал на demo).
- **Поле сериализуемое**: 40 chars (cuid), пишется один раз при switch.

**Альтернатива:** signed-cookie с `currentOrgId`. Хуже — теряется при logout/clear cookies, не работает между устройствами.

**Schema patch:**
```prisma
model User {
  // ... existing
  /// 2026-06-02 — выбранная пользователем активная Org. Если null или указывает
  /// на удалённый membership — getMe() fallback'нется на demo_observer-membership,
  /// затем на первый owner/admin/etc. Обновляется через POST /auth/switch-org.
  preferredOrgId  String?  @db.VarChar(40)
}
```

`bun run prisma:push` + `bun run prisma:generate`. Никакого индекса — поле используется только в комбинации с `Membership(userId, orgId)`, для которой уже есть `@@unique`.

### 3.6. Хвост #8 — OrgSwitcher subscription badge

**Что нужно:** в `OrgSwitcher` показать бейдж «Пусто, оплатите» рядом со своей Org, если её Subscription = `DEMO`. Бейдж «Демо» для эталона — уже есть.

**Решение:** расширить **API ответ membership** полем `subscriptionStatus`. Точка правки — endpoint, из которого frontend `useMemberships` грузит данные. Найти grep'ом: вероятно `GET /api/v1/orgs/mine` или `GET /api/v1/accounts/me/memberships`. Если такого нет — расширить `useMemberships`-источник любым из существующих.

```ts
// useMemberships возвращает:
type Membership = {
  id: string;
  name: string;
  role: MembershipRole;
  isReferenceDemo: boolean;
  /** 2026-06-02 (хвост #8) — статус подписки для бейджа в OrgSwitcher. */
  subscriptionStatus: 'DEMO' | 'ACTIVE' | 'TRIAL' | 'EXPIRED' | 'CANCELLED' | null;
};
```

**В OrgSwitcher:** условие бейджа — `!m.isReferenceDemo && m.subscriptionStatus === 'DEMO'`. Текст «Пусто, оплатите», стиль `bg-chip-warning-bg text-chip-warning-fg`, ml-auto (как существующий бейдж «Демо»). На обоих местах: trigger-row + dropdown items.

**Почему расширение `useMemberships`, а не отдельный fetch per Org:**
- Один запрос вместо N (если у user 2 Org — 2 запроса; если 10 — 10);
- Subscription уже грузится для `SubscriptionContext` для current Org — но он не знает про другие.

**Альтернатива (отклонена):** добавить per-org fetch в OrgSwitcher на mount. Хуже — water-fall, дополнительные API hits.

**Smoke:** новый пользователь видит в switcher'е: «Демо: ТехноСтрим» с бейджем «Демо» + «Ваша компания» с бейджем «Пусто, оплатите».

### 3.7. Хвост #5 — динамический `--hero-h`

**Что нужно:** sticky-полоса под Hero фиксируется на `top-[var(--hero-h,200px)]` ([DirectorDashboardClient.tsx:389](frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx#L389)). Fallback 200px работает для типичного Hero, но при изменении контента Hero (длинная AI-сводка, разный набор KPI) — высота скачет. Sticky-полоса перекрывает Hero или висит с зазором.

**Решение:** `ResizeObserver` на ref Hero-блока. При изменении высоты — `document.documentElement.style.setProperty('--hero-h', `${height}px`)`. Cleanup при unmount.

```ts
const heroRef = useRef<HTMLDivElement>(null);
useEffect(() => {
  const el = heroRef.current;
  if (!el || typeof ResizeObserver === 'undefined') return;
  const ro = new ResizeObserver(([entry]) => {
    if (!entry) return;
    document.documentElement.style.setProperty('--hero-h', `${Math.round(entry.contentRect.height)}px`);
  });
  ro.observe(el);
  return () => ro.disconnect();
}, []);
```

`ResizeObserver` есть во всех браузерах поддерживаемых Z (SSR-safe через typeof). Если нет — остаётся fallback 200px.

**Альтернатива:** `getBoundingClientRect()` в useEffect. Хуже — не реагирует на runtime-resize (например, AI-сводка дозагрузилась).

**Smoke:** на dev — Hero с короткой сводкой → sticky прижата вверху без зазора; expand AI-сводки до 3 строк → sticky не перекрывает.

### 3.8. Хвост #6 — autoFocus в OrgChatPanel при open-ask

**Что нужно:** при клике pill «💬 Спросите Кору» под Hero — AssistantSidebar открывается на табе «Спросить», но **textarea не получает фокус**. Пользователь должен ткнуть в инпут вручную.

**Решение:** двухсторонняя правка.

1. **`OrgChatPanel`** — добавить prop `autoFocus?: boolean`. Если true — `useEffect` на mount фокусит textarea ref.
2. **`AssistantSidebar`** — при `activeTab === 'ask'` AND `prevTab !== 'ask'` (переключение в момент сейчас) — рендерит `<OrgChatPanel autoFocus />`. Trigger: useRef previous tab.

```ts
// AssistantSidebar
const prevTabRef = useRef<SidebarTab | null>(null);
const justSwitchedToAsk = activeTab === 'ask' && prevTabRef.current !== 'ask';
useEffect(() => { prevTabRef.current = activeTab; }, [activeTab]);
// ...
<OrgChatPanel autoFocus={justSwitchedToAsk} />
```

**Почему prop + ref, а не imperative `inputRef.current?.focus()` через event-bus:**
- React-way — состояние, а не imperative API;
- prop `autoFocus` понятен любому будущему consumer'у `OrgChatPanel`.

**Альтернатива:** focus через `setTimeout(...)` после open. Работает, но flaky (animation completion может затянуться).

### 3.9. Хвост #9 — TabEmptyState в TeamTab

**Что нужно:** в табах «Знания» и «Цели и встречи» — родитель собирает «непустые виджеты» через знание данных (виджеты рендерят `null` если пусто). В табе «Команда» — `TeamHealthGrid` сам fetch'ит данные (SWR-hook внутри), родитель не знает empty это или нет. Поэтому общий `TabEmptyState` не показывается.

**Решение:** **lift up fetch** из `TeamHealthGrid` в `DirectorDashboardClient`. Передаём данные как prop, как у других виджетов. Empty-tracking родителем становится единым правилом (тот же подсчёт `widgetsWithData`).

```ts
// DirectorDashboardClient
const { data: teamHealth, isLoading } = useSWR('/api/v1/dashboard/team-health', fetcher);
const teamWidgetsWithData = [
  teamHealth && teamHealth.departments.length > 0 ? 'health' : null,
  busFactor && busFactor.items.length > 0 ? 'bus' : null,
  activityFeed && activityFeed.items.length > 0 ? 'feed' : null,
  peopleAtRisk && peopleAtRisk.items.length > 0 ? 'risk' : null,
].filter(Boolean);
const teamTabIsEmpty = !isLoading && teamWidgetsWithData.length === 0;
```

При `teamTabIsEmpty` — рендерится `<TabEmptyState tabLabel="Команда" />` вместо набора виджетов.

**Альтернатива:** оставить fetch в `TeamHealthGrid`, добавить React Context `TabEmptyTracker` (каждый виджет регистрирует loaded-state). Хуже:
- лишний context, лишняя сложность;
- порядок регистрации/unregister'а — гонки;
- остальные табы уже работают по lift-up паттерну — единообразие важнее.

**Smoke:** в своей ACTIVE Org без встреч — переключаемся в таб «Команда» → один общий `TabEmptyState`, не 4 пустых виджета.

## 4. Матрица «хвост × модуль × фаза»

Чтобы видно было overlap и порядок:

| # | Хвост | Backend модули | Frontend | Schema | Фаза |
|---|---|---|---|---|---|
| 1 | people-at-risk endpoint | dashboard, persons | dashboard.api, PeopleAtRiskWidget | — | 5 |
| 2 | currentOrgRole union | — | api/types/accounts, domain/account, DirectorDashboardClient | — | 1 |
| 3 | Probe filter | probe.service, probe-dispatcher.worker, ai/services/llm-router (метрика) | — | — | 2 |
| 4 | Members privacy | orgs.service | — | — | 3 |
| 5 | --hero-h dynamic | — | DirectorDashboardClient | — | 7 |
| 6 | autoFocus | — | AssistantSidebar, OrgChatPanel | — | 7 |
| 7 | switch-org persist | auth.controller, accounts.service | — | User.preferredOrgId | 4 |
| 8 | OrgSwitcher badge | orgs.controller / accounts.controller (membership endpoint) | useMemberships, OrgSwitcher | — | 6 |
| 9 | TeamTab empty | — | DirectorDashboardClient, TeamHealthGrid | — | 7 |

Параллелизация невозможна между фазами 1-7 (frontend и backend в разных коммитах могут конфликтовать в `DirectorDashboardClient.tsx`). Делаем последовательно.

---

## 5. Фазы

### Фаза 0 — Pre-flight аудит (~30 мин)

- [ ] **0.1** `git log --since="2 hours ago" --all` — убедиться, что нет параллельной сессии (см. feedback `parallel_sessions_git_check`).
- [ ] **0.2** Прочитать [docs/operations/prod-deploy-log.md](../../docs/operations/prod-deploy-log.md) раздел «Накоплено к выкату» — понять, что уже накоплено и куда добавлять записи.
- [ ] **0.3** Прочитать [backend/src/modules/dashboard/dashboard.controller.ts](backend/src/modules/dashboard/dashboard.controller.ts) (~30 строк) — паттерн декораторов, кэширования, `@PublicDemo()`.
- [ ] **0.4** `bun run typecheck` (backend и frontend) — baseline должен быть зелёный. Если уже красный — стоп, чинить отдельным коммитом.

### Фаза 1 — Frontend DTO: `currentOrgRole` union (хвост #2, ~30 мин)

- [ ] **1.1** В [frontend/src/api/types/accounts.ts:25](../../frontend/src/api/types/accounts.ts#L25) расширить union: `'owner' | 'admin' | 'manager' | 'coo' | 'hr_partner' | 'demo_observer' | null`. Добавить коммент: «Источник правды — `backend/prisma/schema.prisma` enum MembershipRole».
- [ ] **1.2** В [frontend/src/domain/account.ts](../../frontend/src/domain/account.ts) (mapper) — если есть exhaustive switch по role — расширить. Если просто as-is — без правок.
- [ ] **1.3** `cd frontend && bun run typecheck` — TS подсветит точки сужения типа. Пройти по каждому warning'у и расширить условия (если есть `role === 'owner' || role === 'admin'` — оценить, должен ли `demo_observer` попасть; обычно нет, у demo_observer не должно быть write-привилегий).
- [ ] **1.4** [DirectorDashboardClient.tsx:382](../../frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx#L382) — убрать cast `(currentOrgRole as string | null) === 'demo_observer'`. Стать `currentOrgRole === 'demo_observer'`.
- [ ] **1.5** Grep `currentOrgRole as ` по `frontend/` — если есть ещё такие cast'ы, убрать.
- [ ] **1.6** `cd frontend && bun run typecheck && bun run lint && bun run test:unit` — зелёные.

**DoD:** `currentOrgRole` имеет правильный union, ни одного `as string` cast'а в проекте.

### Фаза 2 — Backend probe filter по эталону (хвост #3, ~1 ч)

- [ ] **2.1** Расширить `ProbeSuggestResult.dropped` union в [probe.types.ts](../../backend/src/modules/probe/probe.types.ts) — добавить `'reference_demo'`.
- [ ] **2.2** В [probe.service.ts](../../backend/src/modules/probe/probe.service.ts) метод `suggest` — после null-проверок (line ~57), перед dedup — добавить query `Org.findUnique({select: {isReferenceDemo}})`. Если `true` → drop, метрика `dropped_reference_demo`, return.
- [ ] **2.3** В [probe-dispatcher.worker.ts](../../backend/src/modules/probe/probe-dispatcher.worker.ts) метод `process` — defensive guard (на случай legacy-job'ов): тот же check, skip с `this.logger.warn`. Не throw — graceful skip.
- [ ] **2.4** В `BusinessMetricsService` — расширить enum значений метрики `incProbeEvent({status})`. Если строго-типизированно — добавить `'dropped_reference_demo'`.
- [ ] **2.5** Unit-тест в `probe.service.spec.ts`: «`suggest({tenantId: referenceOrgId})` → `{dropped: 'reference_demo'}` + counter инкрементнут». Mock `prisma.org.findUnique` returns `{isReferenceDemo: true}`.
- [ ] **2.6** Integration-тест: создать эталонную Org с `isReferenceDemo=true`, вызвать любой specialist Слоя 3 на её tenantId → проверить, что ProbeEvent не создаётся.
- [ ] **2.7** `cd backend && bun run typecheck && bun run lint && bun run test:unit` — зелёные. Воркеры — `bun run worker:dev` поднимается без ошибок.

**DoD:** в эталонной Org probe-events не создаются и не диспатчатся. Метрика `probe_events_total{status="dropped_reference_demo"}` есть.

### Фаза 3 — Backend privacy: members list filter (хвост #4, ~30 мин)

- [ ] **3.1** В [orgs.service.ts:163](../../backend/src/modules/orgs/orgs.service.ts#L163) `listMembers` — после `members.map(...)`:
  - Query `prisma.user.findUnique({where: {id: userId}, select: {isSuperAdmin: true}})`.
  - Если `isSuperAdmin === true` — return mapped (видит всё).
  - Иначе — return `mapped.filter(m => m.role !== 'demo_observer')`.
- [ ] **3.2** Unit-тест: создать Org с членами (owner + 2 demo_observer), вызвать `listMembers` от owner'а → возвращает только owner. От super_admin → возвращает всех.
- [ ] **3.3** `cd backend && bun run typecheck && bun run lint && bun run test:unit` — зелёные.

**DoD:** в `/settings/members` эталона — не видны другие demo_observer'ы.

### Фаза 4 — Backend session: switch-org persistent (хвост #7, ~1.5 ч)

- [ ] **4.1** Schema: добавить поле `User.preferredOrgId String? @db.VarChar(40)` с JSDoc-комментом (см. §3.5).
- [ ] **4.2** `cd backend && bun run prisma:push && bun run prisma:generate`.
- [ ] **4.3** В [auth.controller.ts:177-245](../../backend/src/modules/auth/auth.controller.ts#L177) `switchOrg`:
  - После проверки membership/superadmin — `await this.prisma.user.update({where: {id: user.id}, data: {preferredOrgId: body.orgId}})`.
  - Убрать поле `todo` из return type **и** из обоих return-веток. Реальное использование `preferredOrgId` идёт через `getMe()`.
- [ ] **4.4** В [accounts.service.ts](../../backend/src/modules/accounts/accounts.service.ts) `getMe`:
  - Добавить параллельную query `preferredMembership` (см. snippet §3.5).
  - Приоритет: `preferred → demo → first-owned`.
  - Возвращать `currentOrgId` и `currentOrgRole` соответственно.
- [ ] **4.5** Unit-тесты:
  - `getMe` с `preferredOrgId=X` и активным membership → возвращает X.
  - `getMe` с `preferredOrgId=X` и удалённым membership → fallback на demo.
  - `getMe` без `preferredOrgId` → demo → first-owned (текущая логика, regression-проверка).
- [ ] **4.6** Integration-тест: POST `/auth/switch-org {orgId}` → DB строка `User.preferredOrgId=orgId` → GET `/accounts/me` → `currentOrgId=orgId`.
- [ ] **4.7** Frontend: в `OrgSwitcher.tsx` убрать комментарий «TODO Фаза 0a» и localStorage fallback. Теперь endpoint работает реально — fallback не нужен. **НО**: оставить `catch` блок, чтобы при offline не падать (просто toast.error).
- [ ] **4.8** `cd backend && bun run typecheck && bun run lint && bun run test:unit && bun run test:integration` — зелёные. `cd frontend && bun run typecheck && bun run lint && bun run test:unit` — зелёные.

**DoD:** POST `/auth/switch-org` персистит выбор в `User.preferredOrgId`, `/accounts/me` возвращает persisted Org, выбор сохраняется между sessions.

**Prod-deploy-log:** Шаг 4 (schema) — новое поле `User.preferredOrgId`. Шаг 1 (ENV) — без изменений.

### Фаза 5 — Backend: `GET /dashboard/people-at-risk` endpoint (хвост #1, ~2 ч)

- [ ] **5.1** Spec endpoint'а:
  - Route: `GET /api/v1/dashboard/people-at-risk`
  - Query: `limit?: number` (default 3, max 10), `threshold?: number` (default 0.7, range [0..1]).
  - Response: `{ items: Array<{personId, name, roleLabel, pulseScore, engagementScoreAt}>, totalAtRisk: number }`.
  - `totalAtRisk` — общее число Person с `engagementScore < threshold` (для подсказки «+ ещё N» в виджете).
- [ ] **5.2** DTO (Zod): `PeopleAtRiskQuerySchema` + `PeopleAtRiskResponseSchema`. Декораторы Swagger через `nestjs-zod`.
- [ ] **5.3** Сервис: `backend/src/modules/dashboard/services/people-at-risk.service.ts`:
  - Метод `getAtRisk(tenantId, limit, threshold): Promise<{...}>`.
  - Query: `prisma.person.findMany({where: {tenantId, deletedAt: null, engagementScore: {lt: threshold, not: null}}, orderBy: {engagementScore: 'asc'}, take: limit, include: {primaryDepartment: true}})`.
  - Mapping: `pulseScore = Math.floor((p.engagementScore ?? 0) * 100)`, `roleLabel` собрать из `primaryDepartment.name + ' · ' + primaryRole`.
  - `totalAtRisk` — отдельный `count` запрос.
  - Кэш Redis 60 секунд (key `dashboard:people-at-risk:${tenantId}:${limit}:${threshold}`).
- [ ] **5.4** Controller-метод в `dashboard.controller.ts`:
  - `@Get('people-at-risk')`, `@RequireSubscription()`, `@PublicDemo()` (read-only, разрешён demo_observer'у в эталоне).
  - RBAC: дефолтная policy `dashboard:read` (уже есть для других dashboard endpoint'ов).
- [ ] **5.5** Регистрация в module: `PeopleAtRiskService` в providers.
- [ ] **5.6** Frontend API: в [frontend/src/api/dashboard.api.ts] (или ближайший подходящий) добавить `peopleAtRisk(limit?)` → `apiClient.get`.
- [ ] **5.7** Frontend домен: ApiDto `PeopleAtRiskApi` → DomainModel `PeopleAtRisk` (в `frontend/src/domain/`) — пройти стандартную цепочку (см. [frontend-rules](skill)).
- [ ] **5.8** [PeopleAtRiskWidget.tsx](../../frontend/src/ui/components/dashboard/PeopleAtRiskWidget.tsx):
  - Убрать prop `items?: ReadonlyArray<PeopleAtRiskItem> | null` (по умолчанию `null`).
  - Сделать виджет self-fetching через SWR (как `TeamHealthGrid`) — это упрощает подключение в TeamTab.
  - Если `data === null && !loading` (например, эндпоинт не возвращает данных) — render `null`.
  - Если `items.length === 0` — текущий success-state.
  - Если `items.length > 0` — render 3 строк.
- [ ] **5.9** [DirectorDashboardClient.tsx](../../frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx) — убрать передачу `items={null}` в `<PeopleAtRiskWidget />` (теперь сам fetch'ит).
- [ ] **5.10** Unit-тесты:
  - `PeopleAtRiskService.getAtRisk` — фильтрует по threshold, сортирует ASC, respect `limit`.
  - С 0 риск-Person — возвращает `items: [], totalAtRisk: 0`.
  - Кэш Redis hit/miss.
- [ ] **5.11** Integration-тест: создать 5 Person с engagement [0.3, 0.5, 0.8, null, 0.6] → GET endpoint с limit=3, threshold=0.7 → возвращает 3 (0.3, 0.5, 0.6), totalAtRisk=3.
- [ ] **5.12** Обновить [docs/reference/dashboards-registry.md](../../docs/reference/dashboards-registry.md) §4.4: хвост «Ranked Pulse score per Person» — пометить как ✅ закрыт, указать endpoint.
- [ ] **5.13** Smoke-тест на dev: эталонная Org → таб «Команда» → виджет показывает 3 demo-сотрудника. Своя пустая Org → виджет либо пустой success-state, либо скрыт.
- [ ] **5.14** `cd backend && bun run typecheck && bun run lint && bun run test:unit && bun run test:integration` и `cd frontend && bun run typecheck && bun run lint && bun run test:unit && bun run build` — зелёные.

**DoD:** виджет `PeopleAtRiskWidget` показывает реальные данные в эталоне и в наполненной своей Org. Реестр обновлён.

**Prod-deploy-log:** Шаг 12 (smoke) — добавить проверку нового endpoint'а в Swagger smoke.

### Фаза 6 — Frontend: OrgSwitcher subscription badge (хвост #8, ~1.5 ч)

- [ ] **6.1** Найти, через какой API frontend `useMemberships` грузит данные. Grep `useMemberships`, `memberships:` в `frontend/src/api/`. Вероятные кандидаты: `GET /api/v1/accounts/me/memberships`, `GET /api/v1/orgs/mine`, или derived из `GET /accounts/me`.
- [ ] **6.2** Backend: расширить ответ найденного endpoint'а полем `subscriptionStatus` per membership. Query JOIN с `Subscription` (`tenantId = org.id`, ORDER BY `createdAt DESC LIMIT 1` — последняя активная).
- [ ] **6.3** Backend DTO: добавить поле в response Zod schema + Swagger.
- [ ] **6.4** Frontend: `Membership` тип в [useMemberships.ts](../../frontend/src/hooks/useMemberships.ts) — расширить полем `subscriptionStatus: 'DEMO' | 'ACTIVE' | 'TRIAL' | 'EXPIRED' | 'CANCELLED' | null`.
- [ ] **6.5** [OrgSwitcher.tsx](../../frontend/src/ui/components/app-shell/OrgSwitcher.tsx) — добавить второй бейдж:
  - Условие: `!m.isReferenceDemo && m.subscriptionStatus === 'DEMO'`.
  - Текст: «Пусто, оплатите».
  - Стиль: `bg-chip-warning-bg text-chip-warning-fg rounded-full px-2 py-0.5 text-[10px] font-medium ml-auto`.
  - Положение: рядом с бейджем «Демо» (для эталона) — взаимоисключающие.
  - Подключить в обоих местах: 2-плюс membership trigger-row + dropdown items.
- [ ] **6.6** Если на trigger'е (активный Org) уже виден бейдж «Демо» — не дублируем «Пусто, оплатите». Бейдж только для НЕ-активных Org в dropdown'е.
- [ ] **6.7** Unit-тест компонента (RTL): рендер с 2 membership'ами (эталон + своя DEMO) → дропдаун содержит оба бейджа.
- [ ] **6.8** Smoke: эталонная Org активна → dropdown показывает «Ваша компания (Пусто, оплатите)». После switch в свою → trigger «Ваша компания», dropdown «Демо: ТехноСтрим (Демо)».
- [ ] **6.9** `cd backend && bun run typecheck && bun run lint && bun run test:unit` и `cd frontend && bun run typecheck && bun run lint && bun run test:unit` — зелёные.

**DoD:** в OrgSwitcher видны корректные бейджи для обеих Org.

### Фаза 7 — Frontend UX полировка: hero-h + autoFocus + TeamTab empty (хвосты #5, #6, #9, ~2 ч)

- [ ] **7.1 (#5 hero-h)** В [DirectorDashboardClient.tsx](../../frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx) — добавить `heroRef` + `ResizeObserver` (см. snippet §3.7). Убрать или оставить fallback `200px` в CSS-var.
- [ ] **7.2 (#5)** Smoke: dev-сервер, открыть `/dashboard`, изменить размер окна / контента Hero → проверить `getComputedStyle(document.documentElement).getPropertyValue('--hero-h')` в DevTools — обновляется live. Sticky-полоса не перекрывает Hero, не висит с зазором.
- [ ] **7.3 (#6 autoFocus)** В [OrgChatPanel.tsx](../../frontend/src/ui/components/chat/OrgChatPanel.tsx) — добавить prop `autoFocus?: boolean`. `useRef<HTMLTextAreaElement>` + `useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus])`.
- [ ] **7.4 (#6)** В [AssistantSidebar.tsx](../../frontend/src/ui/components/dashboard/AssistantSidebar.tsx) — `prevTabRef`, `justSwitchedToAsk` (см. snippet §3.8). Передать `autoFocus={justSwitchedToAsk}` в `OrgChatPanel`.
- [ ] **7.5 (#6)** Smoke: на дашборде — клик pill «💬 Спросите Кору» под Hero → sidebar открывается на табе «Спросить» → cursor сразу в textarea, можно печатать без клика.
- [ ] **7.6 (#9 TeamTab empty)** В [TeamHealthGrid.tsx](../../frontend/src/ui/components/dashboard/TeamHealthGrid.tsx):
  - Удалить SWR-fetch внутри. Принимать `data` и `isLoading` props.
  - Loading/empty/error states — render условно по props.
- [ ] **7.7 (#9)** В `DirectorDashboardClient.tsx`:
  - Поднять fetch `team-health` на уровень компонента (как `pulse` и `pulsePatterns`).
  - Подсчитать `teamWidgetsWithData` (см. snippet §3.9) — 4 виджета: TeamHealthGrid, BusFactorWidget, ActivityFeedWidget, PeopleAtRiskWidget.
  - При `teamTabIsEmpty` (все 4 пусты) — render `<TabEmptyState tabLabel="Команда" ... />` вместо рендера виджетов.
- [ ] **7.8 (#9)** Smoke: своя ACTIVE Org без встреч → таб «Команда» → один общий TabEmptyState. Эталон → таб «Команда» → 4 виджета с данными.
- [ ] **7.9** Перепроверить mobile (375px) — Hero+sticky+autoFocus+TabEmpty корректны.
- [ ] **7.10** `cd frontend && bun run typecheck && bun run lint && bun run test:unit && bun run build` — зелёные.

**DoD:** все три UX-хвоста закрыты. Sticky-полоса под Hero реагирует на размер, ask-таб автофокусит, TeamTab показывает общий empty.

### Фаза 8 — Финальная верификация + рефлексия + prod-deploy-log (~1 ч)

- [ ] **8.1** Полный прогон тестов:
  - `cd backend && bun run typecheck && bun run lint && bun run build && bun run test:unit && bun run test:integration && bun run test:e2e`
  - `cd frontend && bun run typecheck && bun run lint && bun run build && bun run test:unit`
  - Сравнить количество тестов с baseline (`backend 3017+/3050+`, `frontend 115+/115+`). **Не уменьшилось.**
- [ ] **8.2** Ручной smoke по всем 6 строкам матрицы зонтика ([umbrella §6 В.6](2026-06-01-main-screen-umbrella.md)):
  - №1 эталон + demo_observer → виджет «Сотрудники под риском» с данными, CTA в Hero disabled, ask-таб автофокусит.
  - №2 эталон + super_admin → видит всех members (включая demo_observer'ов).
  - №3 своя + owner + DEMO + 0 данных → MainEmptyState + OrgSwitcher показывает свою Org с бейджем «Пусто, оплатите» в dropdown'е.
  - №4 своя + owner + ACTIVE + 0 встреч → таб «Команда» показывает общий TabEmptyState.
  - №5 своя + member + ACTIVE → онбординг скрыт (regression).
  - №6 своя + owner + ACTIVE без demo_observer → как №4.
- [ ] **8.3** Probe filter: вызвать любого specialist Слоя 3 на tenantId эталона → проверить, что в БД нет нового ProbeEvent для этого tenantId, и в Prometheus есть `probe_events_total{status="dropped_reference_demo"} = 1+`.
- [ ] **8.4** Switch-org persist: POST `/auth/switch-org {orgId: ownOrgId}` → reload браузера → GET `/accounts/me` возвращает `currentOrgId=ownOrgId`. Logout/login → всё ещё `ownOrgId`.
- [ ] **8.5** Обновить [docs/reference/dashboards-registry.md](../../docs/reference/dashboards-registry.md):
  - §4.4 «Открытые хвосты» — хвост «Ranked Pulse score per Person» пометить ✅ ЗАКРЫТО + endpoint `/dashboard/people-at-risk`.
  - §4.6 — добавить запись «2026-06-02: финализация хвостов — добавлены endpoints/filters/UX-полировка».
- [ ] **8.6** Обновить [second-brain/01_projects/frontend-pages.md](../../second-brain/01_projects/frontend-pages.md):
  - Запись `/dashboard` — дополнить «autoFocus при open-ask, динамический --hero-h, TabEmptyState в Team».
  - Запись `OrgSwitcher` — упомянуть «бейдж "Пусто, оплатите" для своей DEMO Org».
- [ ] **8.7** Обновить [second-brain/02_architecture/module-map.md](../../second-brain/02_architecture/module-map.md):
  - dashboard module — упомянуть `PeopleAtRiskService` + endpoint.
  - probe module — упомянуть фильтр по `Org.isReferenceDemo`.
- [ ] **8.8** Обновить [second-brain/01_projects/demo-workspace.md] (если есть, иначе создать) — privacy фильтр members + probe фильтр.
- [ ] **8.9** Обновить [docs/operations/prod-deploy-log.md](../../docs/operations/prod-deploy-log.md):
  - **Шаг 4 (schema):** новое поле `User.preferredOrgId`.
  - **Шаг 12 (smoke):**
    - `curl /api/v1/dashboard/people-at-risk?limit=3` — 200 + items array.
    - `curl /api/v1/auth/switch-org -d '{orgId}'` — 200 + persist в `User.preferredOrgId`.
    - проверить, что в эталоне `/orgs/:id/members` НЕ показывает demo_observer'ов (для не-super-admin).
- [ ] **8.10** Рефлексия в `second-brain/05_история/2026-06-02-main-screen-umbrella-tails-finalization.md`:
  - что было поставлено (закрытие 9 хвостов умбреллы);
  - как решал (8 фаз с конкретными файлами);
  - что вышло (зелёные тесты, smoke по матрице);
  - чему научился (по 1-2 урока на интересный хвост, особенно #1 endpoint и #7 persistent state).
- [ ] **8.11** Git commit + push (с явным подтверждением пользователя). Рефлексия — отдельным коммитом сразу после.
- [ ] **8.12** Сформировать prod-инструкцию в чате (см. CLAUDE.md «Триггер 1: после git push»):
  - Сошлись на `docs/operations/prod-deploy-log.md`.
  - В чат — diff: Шаг 4 (новое поле `User.preferredOrgId`, `bun run prisma:push`), Шаг 12 (3 новых smoke-curl'а).

**DoD:** все 9 хвостов закрыты, все тесты зелёные, рефлексия записана, prod-инструкция выдана.

---

## 6. Acceptance criteria (общий DoD)

После Фазы 8:

1. ✅ **Хвост #1:** endpoint `GET /api/v1/dashboard/people-at-risk` работает, виджет показывает реальные данные.
2. ✅ **Хвост #2:** `currentOrgRole` имеет правильный union `'owner'|'admin'|'manager'|'coo'|'hr_partner'|'demo_observer'|null`, cast'ов `as string` нет.
3. ✅ **Хвост #3:** в эталонной Org probe-events не создаются, метрика `dropped_reference_demo` инкрементируется.
4. ✅ **Хвост #4:** `GET /orgs/:id/members` фильтрует `demo_observer`'ов для не-super-admin viewer'ов.
5. ✅ **Хвост #5:** sticky-полоса под Hero реагирует на размер контента через `ResizeObserver`.
6. ✅ **Хвост #6:** клик «💬 Спросите Кору» → cursor сразу в textarea.
7. ✅ **Хвост #7:** `POST /auth/switch-org` персистит выбор в `User.preferredOrgId`, `/accounts/me` возвращает persisted Org между sessions.
8. ✅ **Хвост #8:** OrgSwitcher показывает бейдж «Пусто, оплатите» для своей DEMO Org.
9. ✅ **Хвост #9:** TeamTab без данных показывает общий `TabEmptyState`, не 4 пустых виджета.
10. ✅ Все backend-тесты + frontend-тесты + lint + build + typecheck — зелёные.
11. ✅ Реестр `dashboards-registry.md` обновлён (хвост `Ranked Pulse score per Person` пометен ✅ закрыт).
12. ✅ Second-brain (`frontend-pages.md`, `module-map.md`, `demo-workspace.md`) обновлён.
13. ✅ `docs/operations/prod-deploy-log.md` Шаг 4 + Шаг 12 обновлены.
14. ✅ Рефлексия `2026-06-02-main-screen-umbrella-tails-finalization.md` написана и закоммичена.
15. ✅ Матрица 6 состояний главной из umbrella §6 — все строки smoke-проверены вручную.

## 7. Out of scope (явно НЕ делаем)

- ❌ **Новые виджеты** на главной (всё, что было в зонтике — уже есть).
- ❌ **Refactor `Membership` или `User` модели глубже хвоста #7** (только добавляем `preferredOrgId`).
- ❌ **Per-user state аудит для notifications/drafts/concierge** (был отложен ТЗ А Развилка 12 как «отдельный спринт» — переносим в следующий ТЗ, не в этот).
- ❌ **«Скрыть демо» стрелка в OrgSwitcher** (post-MVP, оставлен в umbrella «Открытые хвосты»).
- ❌ **История диалога AssistantSidebar.Спросить между sessions** (post-MVP, требует backend storage).
- ❌ **Альтернативные эталоны под отрасли** (отложено в demo-shared-org-model §15).
- ❌ **Pulse score в реальном времени** (`engagementScore` обновляется cron'ом — это OK для виджета).
- ❌ **Темизация (dark/light)** — отдельная задача, не зонтик.

## 8. Связь с другими ТЗ

| Документ | Роль |
|---|---|
| [umbrella main-screen](2026-06-01-main-screen-umbrella.md) | Родительский зонтик. После этого ТЗ закрывается на 100%. |
| [demo-shared-org-model](2026-06-01-demo-shared-org-model.md) | Источник хвостов #2, #3, #4, #7 (Фазы 4.6, 4.12, 5.3 — scope-cut). |
| [dashboard-main-tabs-restructure](2026-06-01-dashboard-main-tabs-restructure.md) | Источник хвостов #1, #5, #6, #9. |
| [pulse-full](2026-05-30-pulse-full.md) | Источник `Person.engagementScore` через `EngagementScorerCron` — основа endpoint'а хвоста #1. |
| [dashboards-registry](../../docs/reference/dashboards-registry.md) | Реестр виджетов — обновляется §4.4 и §4.6. |

## 9. Открытые вопросы (отвечены до старта, не блокируют)

| # | Вопрос | Решение |
|---|---|---|
| Q1 | Порог «риск» в people-at-risk endpoint | `0.7` (engagement < 0.7 → yellow/red зона). Константа `PEOPLE_AT_RISK_THRESHOLD` в `people-at-risk.service.ts`, не ENV (не часто меняется; см. feedback `admin_settings_not_env_or_code` — поле для будущей перевозки в AdminSetting если станет настраиваемой). |
| Q2 | Кэш Redis 60 секунд для people-at-risk — не слишком ли долго? | `engagementScore` обновляется раз в день cron'ом → 60s более чем достаточно. Совпадает с TTL других dashboard-endpoint'ов. |
| Q3 | RBAC: кому показывать people-at-risk? | По умолчанию `dashboard:read` (как остальные CEO-endpoint'ы). manager/coo тоже видят (полезно для HR-партнёра отдела). Если бизнес скажет «только owner/admin» — добавим policy позже. |
| Q4 | preferredOrgId — миграция existing users | НЕТ миграции. `null` по умолчанию → `getMe` fallback'нется на demo/first (текущая логика). При первом switch-org — persist'нется. |
| Q5 | Members privacy: что если super_admin не существует и нет admin'а? | `isSuperAdmin` query всегда работает. Если возвращает null/undefined → trait как `false` → фильтрует demo_observer'ов. Безопасный default. |
| Q6 | Сколько `demo_observer`'ов реально в production сейчас? | На момент написания ТЗ — 0 (zonтик А только выкатан, ZDEMO_ORG_ID ещё не указывает на эталон). Фильтр будет работать «с запасом» к моменту накопления наблюдателей. |
| Q7 | Probe filter — что с уже накопленными ProbeEvent для эталона? | Их быть не должно (умбрелла свежая, эталон ещё не накопил probe'ов). Если есть — `dispatcher.worker` defensive guard их пропустит. Удалять не нужно — это история. |
| Q8 | Hero-h ResizeObserver — что с SSR? | `typeof ResizeObserver === 'undefined'` check → SSR-safe. Browser-only мутация CSS-var. |

## 10. Итог

Этот ТЗ — **финальный аккорд зонтика main-screen-umbrella**. После 8 фаз все 9 хвостов закрыты, не остаётся «частично-сделанных» пунктов. Зонтик закроется на 100% — что и было поставлено владельцем 2026-06-01.

Никаких новых фич, никаких архитектурных решений: только доделать то, что было осознанно отложено за scope-cut. Каждый хвост — минимальное безопасное изменение в одной (максимум двух) точках кода.

После Фазы 8 рефлексия зонтика `main-screen-umbrella-final.md` (от 2026-06-01) дополняется записью о финализации, и тема закрывается.

## 11. Готовность

- [ ] Фаза 0 — pre-flight аудит.
- [ ] Фаза 1 — хвост #2 (`currentOrgRole` union).
- [ ] Фаза 2 — хвост #3 (probe filter).
- [ ] Фаза 3 — хвост #4 (members privacy).
- [ ] Фаза 4 — хвост #7 (switch-org persistent).
- [ ] Фаза 5 — хвост #1 (people-at-risk endpoint).
- [ ] Фаза 6 — хвост #8 (OrgSwitcher subscription badge).
- [ ] Фаза 7 — хвосты #5, #6, #9 (UX полировка).
- [ ] Фаза 8 — финальная верификация + рефлексия + prod-deploy-log.
- [ ] Рефлексия `2026-06-02-main-screen-umbrella-tails-finalization.md` написана.
- [ ] Зонтик `main-screen-umbrella` закрыт на 100%.
