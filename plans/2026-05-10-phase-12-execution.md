---
type: execution-plan
phase: 12
feature: knowledge-core — тарифы и entitlements (tier_basic / tier_pro / tier_enterprise), декоратор @RequireEntitlement, gating UI
status: planned
date: 2026-05-10
source-tz: plans/tz/2026-05-10-knowledge-core-tz.md (§ Фаза 12)
---

# Фаза 12 — execution-план.

## Что входит и что НЕ входит

**Входит:** сущность `OrgEntitlement`, статический реестр тарифов `TierConfigRegistry`, `EntitlementService` с per-Org кешем, NestJS-декоратор `@RequireEntitlement('feature.X')` + `EntitlementGuard`, замена жёстких лимитов в `QuotaService` на per-tier-quotas, UI `/settings/billing` для owner и заглушки `<TierGate>` на закрытых страницах, Z-Admin страница `/admin/orgs/:id/billing` (super_admin меняет tier любой Org).

**НЕ входит (vNext):** реальная биллинг-интеграция (CloudPayments/Stripe/инвойсы), пробный период с автоматическим даунгрейдом, prorate при смене тарифа, multi-currency, добавки (add-ons) поверх тарифа, скидки/промокоды, юр-документы оферты, dunning-flow при просрочке. Всё, что относится к деньгам и платежам — делает отдельная команда позже. Здесь только **технический gating по фичам и квотам**.

## Принципиальные решения

1. **Tier — это просто строковое значение** (`'tier_basic' | 'tier_pro' | 'tier_enterprise'`), а не enum в Prisma. Причина: бизнес может ввести четвёртый/пятый тариф без миграции; валидация — на уровне Zod в DTO. Если в `OrgEntitlement.tier` окажется неизвестная строка → fail-safe деградация до `tier_basic` + log warning.
2. **Реестр тарифов — статический в коде**, не в БД. Смена features/quotas tier'а — релиз. Это намеренно: «бизнес-config в БД» приводит к рассинхрону кода и данных. Per-Org **overrides** через `featureOverrides`/`quotaOverrides` — да, в БД (для исключений типа «дать enterprise-фичу одной конкретной Org бесплатно»).
3. **`EntitlementService` имеет кеш в Redis**, TTL 5 минут. Изменение `OrgEntitlement` (через UI) явно дёргает `cache.invalidate(tenantId)`. Для горячего пути (каждый запрос → guard) — это критично.
4. **Декоратор + guard, а не middleware.** Способ Nest-нативный, поддерживает `Reflector.getAllAndOverride`, можно ставить и на класс, и на метод. На уровне controller'а guard регистрируется через `APP_GUARD` (глобально) — он просто пропускает запросы без `@RequireEntitlement(...)`.
5. **Frontend graceful degradation.** Закрытые фичи не скрываются из навигации (sidebar). Они показываются с замком + tooltip «доступно на Pro/Enterprise». Это лучше для конверсии, чем «пустой sidebar».
6. **Per-Org квоты для `QuotaService`**: текущий `checkAndIncrement({max})` принимает `max` параметром (см. [backend/src/modules/quotas/quota.service.ts:53](backend/src/modules/quotas/quota.service.ts#L53)). Все call-sites должны брать `max` через `EntitlementService.getQuota(tenantId, 'chat_requests_per_day_per_user')`, а не из ENV/хардкода.
7. **На MVP `tier_pro` назначается всем Org по умолчанию.** Причина: до полноценной биллинг-интеграции нет смысла лочить функции у существующих юзеров. Бэкап-план если что — сменить дефолт в коде.

## Backend

### Шаг 1 — Prisma schema: `OrgEntitlement`

- [ ] Добавить:
  ```prisma
  model OrgEntitlement {
    id               String   @id @default(cuid())
    tenantId         String   @unique
    org              Org      @relation(fields: [tenantId], references: [id], onDelete: Cascade)
    tier             String   @default("tier_pro")    // см. п.7 Принципиальных решений
    featureOverrides Json?    // {"feature.theme": true, "feature.dashboard_director": false}
    quotaOverrides   Json?    // {"chat_requests_per_day_per_user": 500}
    notes            String?  @db.Text                // ручной комментарий super_admin'а
    createdAt        DateTime @default(now())
    updatedAt        DateTime @updatedAt
  }
  ```
- [ ] **db push**: `bun run prisma:push --accept-data-loss`.
- [ ] **Backfill**: [backend/scripts/seed-entitlements.ts](backend/scripts/seed-entitlements.ts) — для каждой `Org` без `OrgEntitlement` → `create({tier: 'tier_pro'})`. Идемпотентно (см. `safe-seed-rules`).

### Шаг 2 — `TierConfigRegistry`

Новый файл [backend/src/modules/entitlements/tier-config.ts](backend/src/modules/entitlements/tier-config.ts):

- [ ] Тип `TierConfig`:
  ```ts
  type TierKey = 'tier_basic' | 'tier_pro' | 'tier_enterprise';
  type FeatureKey =
    | 'feature.meeting'
    | 'feature.ai_report'
    | 'feature.card_rollup'
    | 'feature.chat_per_meeting'
    | 'feature.theme'
    | 'feature.graph'
    | 'feature.chat_org'
    | 'feature.dashboard_director'
    | 'feature.adapter_telegram'
    | 'feature.adapter_email'
    | 'feature.adapter_call'
    | 'feature.adapter_web_form'
    | 'feature.public_api'
    | 'feature.export_advanced'
    | 'feature.goals_strategy'
    | 'feature.strict_visibility';
  type QuotaKey =
    | 'meetings_per_month'
    | 'blocks_per_org'
    | 'chat_requests_per_day_per_user'
    | 'sources_meeting'
    | 'sources_other'
    | 'ingest_bytes_per_month'
    | 'links_per_day';
  interface TierConfig {
    features: Record<FeatureKey, boolean>;
    quotas: Record<QuotaKey, number>;
  }
  ```
- [ ] Реестр (стартовая нарезка, бизнес правит позже):
  - `tier_basic`: meeting+ai_report+card_rollup+chat_per_meeting+adapter_web_form. Всё остальное — `false`. Квоты низкие: 50 meeting/месяц, 5_000 блоков, 30 чат-запросов/день/юзер, 10 meeting-source'ов.
  - `tier_pro`: + theme, graph, chat_org, dashboard_director, adapter_telegram, adapter_email, adapter_call, public_api, export_advanced. Квоты в 10×.
  - `tier_enterprise`: + goals_strategy, strict_visibility. Квоты в 100× (фактически без лимита для большинства).
- [ ] **Защита от опечаток**: `TIER_CONFIG: Record<TierKey, TierConfig>` — TS-проверка, что все features перечислены в каждом tier.

### Шаг 3 — `EntitlementService`

Новый файл [backend/src/modules/entitlements/entitlement.service.ts](backend/src/modules/entitlements/entitlement.service.ts):

- [ ] Конструктор: `PrismaService`, `RedisService`.
- [ ] `getEntitlement(tenantId): Promise<{tier: TierKey, features: Record<FeatureKey, boolean>, quotas: Record<QuotaKey, number>}>`:
  - cache lookup `entitlement:<tenantId>`,
  - miss → `prisma.orgEntitlement.findUnique({tenantId})`,
  - если нет → fail-safe: `{tier: 'tier_basic', ...TIER_CONFIG.tier_basic}` + log warn,
  - merge: `features = {...TIER_CONFIG[tier].features, ...featureOverrides}`, `quotas = {...TIER_CONFIG[tier].quotas, ...quotaOverrides}`,
  - cache write TTL 300 сек,
  - return.
- [ ] `hasFeature(tenantId, featureKey): Promise<boolean>` — обёртка над `getEntitlement`.
- [ ] `getQuota(tenantId, quotaKey): Promise<number>` — обёртка.
- [ ] `invalidate(tenantId): Promise<void>` — `redis.del(...)`.
- [ ] `setTier(tenantId, tier, byUserId, reason): Promise<void>` — upsert `OrgEntitlement`, invalidate cache, AuditLog `TIER_CHANGED`.
- [ ] `setOverride(tenantId, kind: 'feature'|'quota', key, value, byUserId): Promise<void>` — upsert + invalidate + AuditLog `ENTITLEMENT_OVERRIDE_SET`.

### Шаг 4 — `@RequireEntitlement` декоратор + `EntitlementGuard`

- [ ] [backend/src/modules/entitlements/require-entitlement.decorator.ts](backend/src/modules/entitlements/require-entitlement.decorator.ts):
  ```ts
  export const REQUIRE_ENTITLEMENT_KEY = 'requireEntitlement';
  export const RequireEntitlement = (feature: FeatureKey) =>
    SetMetadata(REQUIRE_ENTITLEMENT_KEY, feature);
  ```
- [ ] [backend/src/modules/entitlements/entitlement.guard.ts](backend/src/modules/entitlements/entitlement.guard.ts):
  - `canActivate`:
    - `feature = reflector.getAllAndOverride<FeatureKey>(REQUIRE_ENTITLEMENT_KEY, [handler, class])`,
    - если нет — `return true` (guard прозрачен),
    - `tenantId = req.tenantId` (ставит `TenantGuard`); если нет — `403 tenant_required`,
    - `enabled = await entitlements.hasFeature(tenantId, feature)`,
    - `if (!enabled) throw new ForbiddenException({ok:false, error:{code:'entitlement_required', feature, currentTier, upgradeUrl:'/settings/billing'}})`.
- [ ] **Регистрация глобально** в `AppModule.providers`: `{provide: APP_GUARD, useClass: EntitlementGuard}`. Порядок guard'ов: `CookieAuthGuard → TenantGuard → EntitlementGuard → RbacGuard` (важно: tenant сначала, потом entitlement).
- [ ] **Module**: `EntitlementsModule` — `@Global()`, экспортит `EntitlementService` и `EntitlementGuard`.

### Шаг 5 — Применение `@RequireEntitlement` на контроллерах

Список контроллеров и фичей. Для каждого — добавить декоратор на класс или на эндпоинты.

| Контроллер | Feature | Где |
|---|---|---|
| `ThemesController` | `feature.theme` | весь класс |
| `IdeaBlockLinksController` (graph) | `feature.graph` | весь класс |
| `ChatController` `POST /api/v1/chat/v2` со scope='org' | `feature.chat_org` | через runtime check: `if (scope==='org' && !hasFeature) → 403` |
| `DashboardDirectorController` (Фаза 8) | `feature.dashboard_director` | весь класс |
| `TelegramWebhookController` (Фаза 10) — НЕТ (внешний webhook должен работать) | — | gating на `POST /api/v1/sources` при создании Source(type=bot) |
| `MangoCallWebhookController` (Фаза 10) | аналогично | gating на создании Source(type=phone_call) |
| `EmailFetchCron` (Фаза 10) | `feature.adapter_email` | проверка внутри cron'а: skip Source'ов чьи Org не имеет фичи |
| `WebFormDumpController` (Фаза 10) | `feature.adapter_web_form` | весь класс (basic+) |
| `GoalsController` (Фаза 9) | `feature.goals_strategy` | весь класс |
| `PublicApiController` | `feature.public_api` | весь класс |
| `ExportsController` (advanced exports) | `feature.export_advanced` | на advanced методах |
| `SourcesController.create` | gate по `type` → `feature.adapter_<type>` | runtime check внутри method'а |

- [ ] Перебор всех контроллеров, добавить декораторы. Для chat-v2 и sources — runtime-check (нельзя на классе, потому что зависит от body).

### Шаг 6 — Перевод `QuotaService`-call-sites на entitlement-quotas

- [ ] Найти все вызовы `quotaService.checkAndIncrement({max: ...})` в коде. Для каждого — заменить хардкод/ENV на:
  ```ts
  const max = await entitlements.getQuota(tenantId, 'chat_requests_per_day_per_user');
  await quotaService.checkAndIncrement({userId, quotaName: 'chat_requests_per_day_per_user', max, windowMs: 24*3600*1000});
  ```
- [ ] Известные call-sites (проверить grep'ом, не считать полным):
  - `chat.service.ts` — chat per day per user.
  - `exports.service.ts` — exports per day.
  - `dump.controller.ts` (Фаза 10) — dump per day per user.
  - `regenerate.service.ts` — regenerate per day.
- [ ] **Месячные/orgs-wide квоты** (`meetings_per_month`, `blocks_per_org`, `ingest_bytes_per_month`):
  - Они per-tenant, не per-user. `QuotaService` сейчас per-user. Расширить на `org-scope`:
    - метод `checkAndIncrementOrg({tenantId, quotaName, max, windowMs})` — ключ `quota:org:<tenantId>:<quotaName>:<windowStart>`.
    - используется в `MeetingService.create` (cap meetings per month), `IngestService.ingest` (cap bytes / blocks).

### Шаг 7 — Контроллеры управления

- [ ] [backend/src/modules/entitlements/entitlements.controller.ts](backend/src/modules/entitlements/entitlements.controller.ts):
  - `GET /api/v1/me/entitlements` — current user → tenantId → `EntitlementService.getEntitlement(tenantId)`. Используется фронтом.
  - `GET /api/v1/settings/billing` (owner-only) — ровно то же + `notes`.
  - `GET /api/v1/admin/orgs/:tenantId/entitlement` (super_admin only) — для Z-Admin.
  - `PATCH /api/v1/admin/orgs/:tenantId/entitlement` (super_admin) — body: `{tier?, featureOverrides?, quotaOverrides?, notes?, reason: string}` — обязательно `reason` для аудита.
- [ ] **AuditLog**: `TIER_CHANGED`, `ENTITLEMENT_OVERRIDE_SET`. Добавить в [backend/src/modules/audit/audit.types.ts](backend/src/modules/audit/audit.types.ts).

## Frontend

### Шаг 8 — Хук `useEntitlement` + контекст

- [ ] [frontend/src/contexts/EntitlementContext.tsx](frontend/src/contexts/EntitlementContext.tsx):
  - провайдер тянет `GET /api/v1/me/entitlements` при mount,
  - кеш в `react-query` (или существующем стейт-менеджере),
  - инвалидация по событию `entitlement.changed` (опционально через ws/poll; на MVP — refresh при смене tab/focus).
- [ ] [frontend/src/hooks/useEntitlement.ts](frontend/src/hooks/useEntitlement.ts):
  ```ts
  function useEntitlement(feature: FeatureKey): {enabled: boolean, tier: TierKey, loading: boolean};
  function useQuota(quota: QuotaKey): {max: number, loading: boolean};
  ```

### Шаг 9 — Компонент `<TierGate>`

- [ ] [frontend/src/ui/components/TierGate.tsx](frontend/src/ui/components/TierGate.tsx):
  ```tsx
  <TierGate feature="feature.theme">
    <ThemesList />
  </TierGate>
  ```
  - если `enabled=true` → рендерит children,
  - иначе → fallback-блок: иконка-замок, текст «Доступно на тарифе Pro» + CTA «Подробнее о тарифах» (ссылка на `/settings/billing`).
- [ ] Применить на:
  - `/themes` (внутри page.tsx обернуть основной контент),
  - `/dashboard-director` (Фаза 8 — пометить TODO там),
  - `/goals` (Фаза 9 — TODO),
  - `/chat` (только при scope='org' — UI должен показать заглушку для basic-Org).

### Шаг 10 — Sidebar c замками

- [ ] [frontend/src/ui/components/app-shell/Sidebar.tsx](frontend/src/ui/components/app-shell/Sidebar.tsx):
  - для каждого пункта, который требует фичи — обернуть в `useEntitlement`,
  - если `enabled=false` → пункт остаётся видимым, но грейед-аут, иконка `Lock` справа, tooltip «Доступно на Pro», клик ведёт на `/settings/billing`.

### Шаг 11 — Страница `/settings/billing`

- [ ] [frontend/app/(authenticated)/settings/billing/page.tsx](frontend/app/(authenticated)/settings/billing/page.tsx) + `BillingClient.tsx`.
- [ ] Owner-only (если не owner — redirect на `/`).
- [ ] Секции:
  - **Текущий тариф** — крупно, бейдж tier'а + дата активации.
  - **Что входит** — таблица `feature → ✓/✗`, рассортированная по группам (knowledge / chat / dashboards / adapters / api / exports).
  - **Лимиты** — таблица `quota → текущее / лимит / прогресс-бар` (текущее значение из `/api/v1/me/quotas` если есть, иначе только лимиты).
  - **Сменить тариф** — кнопка «Связаться с нами» (mailto: или открывает Crisp/Intercom). На MVP без онлайн-апгрейда.
  - **Заметка от super_admin** (`notes`, если есть) — для прозрачности override'ов.

### Шаг 12 — Z-Admin страница `/admin/orgs/:id/billing`

- [ ] super_admin only.
- [ ] Та же таблица + редактируемые поля: `tier` (select), `featureOverrides` (key→bool checkboxes), `quotaOverrides` (numeric inputs), `notes` (textarea), обязательное `reason`.
- [ ] Кнопка «Применить» → `PATCH /api/v1/admin/orgs/:tenantId/entitlement`.
- [ ] Show audit-log entries `TIER_CHANGED` / `ENTITLEMENT_OVERRIDE_SET` для этой Org (lazy load).

## Verification

- [ ] `bun run typecheck` (backend) — зелёный.
- [ ] `bun run typecheck` (frontend) — зелёный.
- [ ] `bun run prisma:push` — успешно.
- [ ] **Smoke-кейсы**:
  - **basic-Org → /themes**: 403 в API (`entitlement_required`), фронт показывает `<TierGate>` заглушку.
  - **basic-Org → /chat scope='org'**: 403, фронт fallback на legacy chat (без org-scope) или показ заглушки.
  - **pro-Org → /themes**: всё работает.
  - **basic-Org с override `feature.theme=true`**: работает (override из `featureOverrides`).
  - **`POST /api/v1/sources` type='bot' для basic**: 403 `entitlement_required(feature.adapter_telegram)`.
  - **Smoke квот**: pro-Org с `chat_requests_per_day_per_user=500`, sequence 501 запрос → 501-й даёт 429.
  - **Смена tier через Z-Admin**: super_admin меняет tier_basic → tier_pro → cache инвалидируется → пользователь сразу видит расширенные фичи (без relogin'а в течение TTL ≤ 5 мин; идеально — сразу за счёт invalidate).
- [ ] **Cache check**: после `setTier` — `redis-cli GET entitlement:<tenantId>` возвращает nil или новое значение.

## Что НЕ сделано (вне Фазы 12)

- Реальная оплата (CloudPayments / Stripe / счёта). Кнопка «Связаться с нами» — заглушка.
- Триал, прорейт, скидки, промокоды, multi-currency.
- Юр-документы оферты.
- Dunning-flow при просрочке оплаты.
- A/B экспериментирование с тарифной нарезкой (ввод фичи в tier_basic «на пробу»). Для этого нужен реестр в БД, не в коде — отложено.
- Per-user (не per-org) тарифы — концептуально не нужны (оплата идёт за Org).
- Add-ons (например: «+1 адаптер Telegram сверх базового»). Сейчас всё через override руками super_admin'а.

## Затронутые файлы

### Schema / config
- `backend/prisma/schema.prisma` — `OrgEntitlement` (новая модель).
- `backend/scripts/seed-entitlements.ts` — backfill.

### Entitlements module (новый)
- `backend/src/modules/entitlements/tier-config.ts`
- `backend/src/modules/entitlements/entitlement.service.ts`
- `backend/src/modules/entitlements/entitlement.guard.ts`
- `backend/src/modules/entitlements/require-entitlement.decorator.ts`
- `backend/src/modules/entitlements/entitlements.controller.ts`
- `backend/src/modules/entitlements/dto/entitlement.dto.ts`
- `backend/src/modules/entitlements/entitlements.module.ts`

### Quota
- `backend/src/modules/quotas/quota.service.ts` — добавить `checkAndIncrementOrg`.
- Все call-sites quota — переключить `max` на `EntitlementService.getQuota`.

### Контроллеры с gating'ом
- `backend/src/modules/themes/themes.controller.ts` — `@RequireEntitlement('feature.theme')`.
- `backend/src/modules/knowledge-core/api/...links.controller.ts` — `feature.graph`.
- `backend/src/modules/chat/chat.controller.ts` — runtime check для scope='org'.
- `backend/src/modules/dashboards/dashboard-director.controller.ts` — `feature.dashboard_director` (после Фазы 8).
- `backend/src/modules/sources/sources.controller.ts` — runtime check `feature.adapter_<type>`.
- `backend/src/modules/ingest/adapters/email/email-fetch.cron.ts` — skip Org без `feature.adapter_email`.
- `backend/src/modules/ingest/adapters/web-form/dump.controller.ts` — `feature.adapter_web_form`.
- `backend/src/modules/goals/goals.controller.ts` — `feature.goals_strategy` (после Фазы 9).
- `backend/src/modules/public-api/public-api.controller.ts` — `feature.public_api`.
- `backend/src/modules/exports/exports.controller.ts` — `feature.export_advanced` на advanced методах.

### App
- `backend/src/app.module.ts` — регистрация `APP_GUARD` = `EntitlementGuard`.

### Audit
- `backend/src/modules/audit/audit.types.ts` — `TIER_CHANGED`, `ENTITLEMENT_OVERRIDE_SET`.

### Frontend
- `frontend/src/contexts/EntitlementContext.tsx` — новый.
- `frontend/src/hooks/useEntitlement.ts` — новый.
- `frontend/src/ui/components/TierGate.tsx` — новый.
- `frontend/src/api/entitlements.api.ts` — новый.
- `frontend/src/ui/components/app-shell/Sidebar.tsx` — замки на закрытых пунктах.
- `frontend/app/(authenticated)/settings/billing/page.tsx` — новый.
- `frontend/app/(authenticated)/settings/billing/BillingClient.tsx` — новый.
- `frontend/app/(authenticated)/themes/page.tsx` — обернуть `<TierGate>`.
- `frontend/app/(authenticated)/chat/ChatClient.tsx` — `<TierGate>` для org-scope.
- (после Фаз 8/9) `dashboard-director/page.tsx`, `goals/page.tsx` — `<TierGate>`.
- `frontend/app/(authenticated)/admin/orgs/[id]/billing/page.tsx` — Z-Admin (новый, super_admin only).
- `frontend/app/(authenticated)/admin/orgs/[id]/billing/BillingAdminClient.tsx` — новый.

## DoD

- [ ] Каждая `Org` имеет `OrgEntitlement` (через seed или lazy upsert).
- [ ] `EntitlementGuard` зарегистрирован глобально, не ломает existing endpoints (без декоратора пропускает).
- [ ] Защищённые контроллеры возвращают `403 entitlement_required` с понятным телом ошибки для неподходящего tier'а.
- [ ] Override `featureOverrides`/`quotaOverrides` работает: tier_basic + override `feature.theme=true` → тема доступна.
- [ ] Cache в Redis инвалидируется при `setTier` / `setOverride`.
- [ ] `/settings/billing` отображает текущий tier, фичи (✓/✗), квоты с прогресс-барами.
- [ ] `<TierGate>` показывает заглушку «доступно на Pro» вместо страницы темы для basic-Org.
- [ ] Sidebar показывает замки на недоступных пунктах, не скрывает их.
- [ ] super_admin может сменить tier из `/admin/orgs/:id/billing`, изменения применяются мгновенно.
- [ ] AuditLog пишет `TIER_CHANGED` и `ENTITLEMENT_OVERRIDE_SET` с обязательным `reason`.
- [ ] Все per-user и per-org квоты получают `max` через `EntitlementService.getQuota`, а не из ENV/хардкода.
- [ ] Обновлён `second-brain/02_architecture/data-model.md` — `OrgEntitlement`.
- [ ] Обновлён `second-brain/01_projects/admin.md` — `/settings/billing`, `/admin/orgs/:id/billing`.
- [ ] Обновлён `second-brain/01_projects/api-layer.md` — endpoints `/me/entitlements`, `/settings/billing`, `/admin/orgs/:id/entitlement`.
- [ ] Создан `second-brain/01_projects/tariffs-and-entitlements.md` — описание тарифной нарезки, реестра, override-семантики, что НЕ покрыто.
- [ ] Чек-лист «Фаза 12» в `plans/tz/2026-05-10-knowledge-core-tz.md` помечен `[x]`.
