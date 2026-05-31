---
name: referrals
title: Партнёрский кабинет (реферальная программа)
status_overall: implemented
last_audited: 2026-05-31
related_processes:
  - 03_processes/referral-program.md
related_plans:
  - plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md
  - plans/tz/2026-05-31-referrals-cabinet-revamp.md
---

# Партнёрский кабинет (реферальная программа)

## Что есть

Одна страница `/referrals` (`frontend/app/(authenticated)/referrals/ReferralsClient.tsx`) с тремя состояниями:
- **A** — профиля нет: `MarketingHero` + `CreateLinkCard` с чекбоксом оферты (`contractAccepted=true` — единственное обязательное поле для создания ссылки).
- **B** — профиль есть, `stats.clicks30d === 0`: `WithdrawalStrip` с нулевыми плитками, `ReferralLinkCard` (URL + QR через `qrcode.react`), `PayoutDetailsCard`, `PayoutsTable`. Воронка/график/клиенты не запрашиваются (SWR-ключ `null`).
- **C** — `stats.clicks30d > 0`: всё из B + `FunnelCard` (30d/90d/all), `IncomeChart` (12 месяцев), `ClientsTableMasked`.

ИНН и реквизиты опциональны при создании; обязателен только чекбокс оферты (`CreateLinkCard.tsx`).

## API-эндпоинты партнёра (`/api/v1/referrals/*`)

Из `ReferralsController` (auth: `CookieAuthGuard`):
- `GET /me` — профиль или `null`.
- `POST /me` — создать (требует `contractAccepted: true`, опц. `inn` + `legalForm` парой).
- `PATCH /me` — обновить `inn` / `legalForm` / `payoutDetails`. Смена `inn` сбрасывает `innVerifiedAt`.
- `POST /me/verify-inn` — `InnLookupService.lookup`; для `legal_entity` сверяет фамилию директора с `User.name`.
- `POST /me/accept-contract` — legacy (в новом флоу оферта принимается в `create`).
- `GET /me/clients` — маскированный список (см. ниже).
- `GET /me/payouts` — начисления (top 200, desc).
- `GET /me/stats` — 10 полей (legacy 5 + clicks30d / signups30d / firstPayments30d + 2 конверсии).
- `GET /me/income-chart` — ровно 12 точек по месяцам (UTC).
- `GET /me/funnel?period=30d|90d|all` — клики → регистрации → первые оплаты → активные сейчас.
- `POST /me/promo-event` — трекинг промо-стрипа, 204 No Content, throttle 30/min/IP.
- `POST /attribute-current-org` — привязка по cookie `X-Z-Ref` + `X-Z-Fingerprint`; защищён `TenantGuard` (audit Б14).

## Админ-эндпоинты (`/api/v1/admin/referrals/*`)

Из `AdminReferralsController` (`CookieAuthGuard` + `SuperAdminGuard`):
- `GET /` — список всех рефералов.
- `GET /:id` — карточка + клиенты (НЕ маскированные, через `listClientsForAdmin`) + payouts.
- `GET /payouts` — все payouts с фильтрами `status` / `period`.
- `POST /payouts/:id/mark-paid`, `POST /payouts/:id/void`.
- `POST /close-period` — ручное закрытие периода (для отладки крона).

## Модели БД (`backend/prisma/schema.prisma`)

- **Referral** — `ownerUserId @unique`, `slug @unique` (8 символов, custom-alphabet без `0/o/l/1`), nullable `inn` / `legalForm` / `payoutDetails` / `innVerifiedAt` / `contractAcceptedAt`.
- **ReferralAttribution** — сырое касание (cookie `z_ref` TTL 90 дней). Composite unique `(referralId, fingerprint, dateBucket)` — audit Б8, защита от flood'а.
- **ClientReferralLink** — first-touch привязка Org→Referral. Создаётся ТОЛЬКО при первой реальной paid-оплате. `tenantId @unique` (одна Org = один линк).
- **ReferralPayout** — начисление 20 000 ₽ × 100 копеек по умолчанию. `triggerInvoiceId @unique` (audit Б7, защита от двойной выплаты), `periodMonth` 'YYYY-MM', `status` pending/paid/void.
- **Org.pendingAttributionSlug** + **pendingAttributionAt** — pending-атрибуция до первой оплаты (используется в `getStats` / `getFunnel` как источник «signups»).

## Промо-стрип

`frontend/src/ui/components/app-shell/ReferralPromoStrip.tsx`. Видимость — `useReferralPromoVisibility` (`frontend/src/hooks/`):
- Whitelist: `/`, `/dashboard/*`, `/activity-feed/*`, `/goals/*`, `/insights/*`, `/tracker/*`, `/clones`, `/persons`, `/entities`, `/themes`, `/meetings` (exact).
- Blacklist (перекрывает whitelist): `/referrals`, `/admin`, `/onboarding`, `/settings`, `/chat`, `/login`, `/signup`.
- Скрывается если `Subscription.status === 'DEMO'`, если есть профиль (кэш 24 ч в localStorage), или dismissed (30 дней).
- Трекинг через `POST /me/promo-event` (impression / click / dismissed × role owner/member).

## Маскировка клиентов

`/me/clients` отдаёт только `clientCode` + `attachedAt` + `firstPaidAt` + `status` + `monthlyEarningsKopecks` + `totalEarnedKopecks`. Никаких `org.id` / `org.name` / `tenantId`. Код генерируется как `'C' + base36(crc32(linkId))` (`clientCodeFromLinkId` в `referrals.service.ts`) — детерминированный, ~7 символов, без хранения. Это юридический приоритет — чтобы партнёр не мог увести клиента мимо нас. `listClientsForAdmin` (для super_admin) возвращает реальные `org.name` / `id` — это явный side door для аудита.

## Withdraw-поток

Кнопка «Вывести» (`WithdrawButton.tsx`) НЕ создаёт сущность `WithdrawalRequest`. Диалог объясняет, что выплаты идут автоматически 10-го числа (cron `ReferralPayoutCron`), для досрочного вывода — обращение в поддержку. Кнопка disabled с тултипом если нет реквизитов / ИНН не подтверждён / `totalPendingKopecks <= 0` (см. `ReferralsService.computeWithdrawalEligibility`).

## Где НЕ работает / placeholder

- `/legal/partner-offer` — текст оферты пока заглушка.
- Уведомления партнёру о начислениях (email/push) — НЕ реализованы.
- На MVP в `getIncomeChart` нет колонки `churnedAt` — churn по историческим месяцам не учитывается, только live `subscription.status='ACTIVE'` для текущего месяца.

## Связи

- Триггерится событием `billing.invoice.paid` → создание `ReferralPayout` (`triggerInvoiceId @unique`).
- Self-referral блокируется в `AttributionService.attributeOrg` — throw `ConflictException('self_referral_denied')` + метрика `referral_self_referral_denied_total`.
- Cron `ReferralPayoutCron` переводит payout в `paid` 10-го числа только если есть `innVerifiedAt && contractAcceptedAt && payoutDetails`.
- См. [[03_processes/referral-program]] для end-to-end сценария атрибуция → линк → начисление → выплата.
