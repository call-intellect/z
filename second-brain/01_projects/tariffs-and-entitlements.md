---
type: project
status: in_progress
phase: 12
---

# Тарифы и Entitlements

> Технический gating фич и квот по тарифам. Реальная оплата (Stripe/CloudPayments) — vNext.

## Сущность

`OrgEntitlement` ([backend/prisma/schema.prisma](../../backend/prisma/schema.prisma)):

```prisma
model OrgEntitlement {
  tenantId         String   @unique
  tier             String   @default("tier_pro")  // строка, не enum (бизнес меняет нарезку без миграций)
  featureOverrides Json?    // {"feature.theme": true, ...}
  quotaOverrides   Json?    // {"chat_requests_per_day_per_user": 500}
  notes            String?  @db.Text
}
```

Backfill: `backend/scripts/seed-entitlements.ts` — каждой Org `create({tier: 'tier_pro'})` (idempotent).

**На MVP `tier_pro` назначается всем по умолчанию** — до полноценного биллинга нет смысла лочить функции.

## Реестр тарифов (статический в коде)

`backend/src/modules/entitlements/tier-config.ts`:

```ts
type TierKey = 'tier_basic' | 'tier_pro' | 'tier_enterprise';
type FeatureKey =
  | 'feature.meeting' | 'feature.ai_report' | 'feature.card_rollup'
  | 'feature.chat_per_meeting' | 'feature.theme' | 'feature.graph'
  | 'feature.chat_org' | 'feature.dashboard_director'
  | 'feature.adapter_telegram' | 'feature.adapter_email' | 'feature.adapter_call' | 'feature.adapter_web_form'
  | 'feature.public_api' | 'feature.export_advanced'
  | 'feature.goals_strategy' | 'feature.strict_visibility';
type QuotaKey =
  | 'meetings_per_month' | 'blocks_per_org'
  | 'chat_requests_per_day_per_user' | 'sources_meeting' | 'sources_other'
  | 'ingest_bytes_per_month' | 'links_per_day';
```

| Tier | Что входит |
|---|---|
| `tier_basic` | meeting, ai_report, card_rollup, chat_per_meeting, adapter_web_form. Квоты: 50 встреч/мес, 5k блоков, 30 чат/день/юзер, 10 meeting-source. |
| `tier_pro` | + theme, graph, chat_org, dashboard_director, adapter_telegram/email/call, public_api, export_advanced. Квоты ×10. |
| `tier_enterprise` | + goals_strategy, strict_visibility. Квоты ×100. |

**Override**'ы хранятся в `OrgEntitlement.featureOverrides/quotaOverrides` (per-Org исключения, например «дать enterprise-фичу одной Org бесплатно»).

## `EntitlementService`

`backend/src/modules/entitlements/entitlement.service.ts`. Cache в Redis, TTL 300s, ключ `entitlement:<tenantId>`.

Методы: `getEntitlement(tenantId)`, `hasFeature(tenantId, featureKey)`, `getQuota(tenantId, quotaKey)`, `invalidate(tenantId)`, `setTier(tenantId, tier, byUserId, reason)`, `setOverride(tenantId, kind, key, value, byUserId)`.

Fail-safe: если `OrgEntitlement` не найден или tier неизвестен → `tier_basic` + log warn.

## `@RequireEntitlement` декоратор + `EntitlementGuard`

```ts
@Controller('themes')
@RequireEntitlement('feature.theme')
export class ThemesController { ... }
```

`EntitlementGuard` зарегистрирован глобально (`APP_GUARD` в `AppModule`). Без декоратора — guard прозрачен (`return true`).

При gate: `403 {ok: false, error: {code: 'entitlement_required', feature, currentTier, upgradeUrl: '/settings/billing'}}`.

Порядок guard'ов: `CookieAuthGuard → TenantGuard → EntitlementGuard → RbacGuard`.

### Покрытие контроллеров

| Контроллер | Feature | Способ |
|---|---|---|
| `ThemesController` | `feature.theme` | декоратор на класс |
| `IdeaBlockLinksController` (graph) | `feature.graph` | декоратор |
| `DirectorDashboardController` | `feature.dashboard_director` | декоратор |
| `ChatController` POST `/chat/v2` (scope=org) | `feature.chat_org` | runtime check внутри метода |
| `WebFormDumpController` | `feature.adapter_web_form` | декоратор |
| `GoalsController` | `feature.goals_strategy` | декоратор |
| `PublicApiController` | `feature.public_api` | декоратор + BearerAuthGuard прокидывает tenantId |
| `ExportsController.bulk` | `feature.export_advanced` | декоратор на advanced методах |
| `SourcesController.create` | `feature.adapter_<type>` | runtime check по `body.type` |
| `EmailFetchCron` | `feature.adapter_email` | skip Org внутри cron |

Webhook controllers (Telegram, Mango) НЕ гейтятся — внешние URLы должны работать. Gating только на создание Source.

**SubscriptionGuard (DEMO/ACTIVE, отдельно от entitlements) — гейтит СОЗДАНИЕ, не управление in-flight встречей.** `@RequireSubscription` требует `tenantId` из `X-Org-Id`; комната встречи вызывает host-контролы без org-контекста → без снятия гейта гвард кидал `tenant_required` (403) и встреча зависала active (finish не доходил до `deleteRoom`, вебхуки не приходили, цепочка запись→транскрипт→отчёт не стартовала). Инвариант: закончить/управлять уже идущей встречей нужно уметь всегда (даже если подписка истекла в процессе). Поэтому под гейтом остаётся `POST /meetings` (создание), но НЕ `finish` / `mute` / `unmute` / `kick` / `lower-hand` / `recording start|stop`. Инцидент 2026-07-09, фикс — коммит `254186aa`.

## Quotas через Entitlements

`QuotaService.checkAndIncrement({max})` теперь получает `max` через `EntitlementService.getQuota(tenantId, quotaKey)`. Покрыты:
- `chat_requests_per_day_per_user` (chat-v2.service).
- `meetings_per_month` (org-scope, `checkAndIncrementOrg`).
- `ingest_bytes_per_month` (org-scope).

**НЕ покрыты** (намеренно — anti-abuse, не tier-feature): `dump_per_day_per_user`, `render_jobs_per_hour`, `goal_recompute_per_day`. Остаются на ENV. См. `decisions-log.md` 2026-05-10.

`QuotaService.checkAndIncrementOrg({tenantId, quotaName, max, windowMs})` — новый метод для месячных/orgs-wide квот. Ключ `quota:org:<tenantId>:<quotaName>:<windowStart>`.

## API

```
GET   /api/v1/me/entitlements                              [auth+tenant]      → EntitlementResponseDto без notes
GET   /api/v1/settings/billing                             [owner-only]       → EntitlementResponseDto с notes
GET   /api/v1/admin/orgs/:tenantId/entitlement             [super_admin]      → с notes
PATCH /api/v1/admin/orgs/:tenantId/entitlement             [super_admin]
   body: {tier?, featureOverrides?, quotaOverrides?, notes?, reason: string (>=3)}   // reason обязателен для аудита
```

AuditLog: `TIER_CHANGED`, `ENTITLEMENT_OVERRIDE_SET`.

## Frontend

- `EntitlementContext` ([frontend/src/contexts/entitlement-context.tsx](../../frontend/src/contexts/entitlement-context.tsx)) — провайдер тянет `getMe()` при mount, refetch при focus, сброс при `auth:expired`. Подключён в `AuthenticatedShell`.
- `useEntitlement(feature)` / `useQuota(quota)` — хуки.
- `<TierGate feature="...">` — обёртка с замком + CTA «Подробнее о тарифах» → `/settings/billing`. Применён на `/themes`, `/goals`, dashboard director-view, chat (scope=org).
- Sidebar показывает замки на закрытых пунктах (а не скрывает) — для upgrade-funnel.
- `/settings/billing` — owner-only: текущий tier, фичи (✓/✗), квоты, notes, CTA «Связаться с нами».
- `/admin/orgs/[id]/billing` — super_admin: tier-select, feature/quota overrides, notes, обязательный reason.

## Связанные документы

- [admin-z-global.md](admin-z-global.md) — управление tier через Z-Admin.
- [llm-router.md](llm-router.md) — A/B-эксперименты, не зависят от entitlements.
- [security-and-152fz.md](../02_architecture/security-and-152fz.md) — retention НЕ зависит от tier (отдельная политика).
