---
title: Frontend Contexts & Hooks (реестр)
status: living
covers: React-контексты и кросс-компонентные паттерны фронтенда Z/Кора
---

# Frontend Contexts & Hooks — реестр

Точечный реестр кросс-компонентных механизмов фронтенда (`frontend/src/contexts`,
`frontend/src/hooks` и связанные событийные шины). Пополняется по факту.

## Единый плавающий помощник кабинета (2026-06-06)

В кабинете теперь **одна** плавающая кнопка-помощник — «Помощник компании»
(`frontend/src/ui/components/dashboard/AssistantSidebar.tsx`). Раньше на экране
накладывались две: собственный FAB Консьержа и кнопка помощника компании.

- У Консьержа (`frontend/src/ui/concierge/ConciergeFloatingButton.tsx`) убрана
  собственная плавающая кнопка — компонент открывается **только по событию**
  `concierge:open` (deep-link «Спросить Кору», напр. из Smart Tables).
- Цель тура `welcome.concierge` (`data-tour-target`) перенесена на кнопку
  «Помощник компании», чтобы онбординг-тур указывал на единственный видимый вход.
- Опечатка «Концьерж» → «Помощник компании» в nav-help / турах.
- Источник: [plans/tz/2026-06-05-frontend-detail-pages-and-ui-honesty.md](../../plans/tz/2026-06-05-frontend-detail-pages-and-ui-honesty.md) Ф3 (коммит `d9730afb`).

## Пэйвол на 403 — `api-client` interceptor → `subscription:required` (2026-06-06)

Перехватчик ответов в `frontend/src/api/api-client.ts` ловит 403 от мутаций
(встреча / чат / инвайт / проект) в DEMO и поднимает событие
`subscription:required`, которое `SubscriptionContext` слушает и открывает
`PaywallModal`. Раньше interceptor реагировал только на легаси-код
`subscription_required`, поэтому новые коды `SubscriptionGuard` — `subscription_demo`
и `subscription_expired` — давали «молчаливый 403» (мутация падала без всплытия
пэйвола).

- С 2026-06-06 interceptor реагирует на **все три** кода:
  `subscription_demo`, `subscription_expired`, `subscription_required`.
- Поток: backend `SubscriptionGuard` бросает 403 с кодом → `api-client`
  interceptor → событие `subscription:required` → `SubscriptionContext` →
  `PaywallModal`.
- Источник: [plans/tz/2026-06-05-bonus-access-and-paywall-sync.md](../../plans/tz/2026-06-05-bonus-access-and-paywall-sync.md) Ф2 (коммит `8522ecfb`).

## Хелперы и хуки сессии «Трекер + Встречи» (2026-06-06)

Общие переиспользуемые механизмы, выделенные в финальной сессии Трекер+Встречи
(ТЗ [`plans/tz/2026-06-06-FINAL-session-tracker-and-meetings.md`](../../plans/tz/2026-06-06-FINAL-session-tracker-and-meetings.md), ветка `sergdev`).

- **`src/lib/badge-polling.ts`** (A7 — консолидация поллинга бейджей навигации) —
  единые константы `BADGE_POLL_INTERVAL_MS = 60_000` и `BADGE_DEDUPE_MS = 30_000`:
  общий интервал + dedup для badge-хуков (`useIntakePendingCount` /
  `usePendingActionsCount` / `useMyInboxCount`). Навигация между страницами больше
  не плодит повторные запросы за бейджами.
- **`src/lib/copy-to-clipboard.ts`** — `copyToClipboard(text)` с fallback на
  `execCommand('copy')` (когда `navigator.clipboard` недоступен / отказал —
  напр. в небезопасном контексте). Используется в журнале встреч (B1/B3),
  комнате и лобби (B3/B4).
- **`src/domain/meeting.ts`** — `isJoinableStatus(status)` (`true` для
  `scheduled` | `active`) — единый критерий «к встрече можно присоединиться /
  допригласить» для UI журнала и комнаты, зеркалит бэк-gate `POST /meetings/:id/invitees`.
- **`src/ui/shared/InviteDialog.tsx`** — переиспользуемый диалог приглашения:
  `ParticipantPicker` с `showChannels` → `meetingsApi.addInvitees`. Один компонент
  для «Пригласить» в комнате и в журнале встреч (B3/B5).

---

[[../index|← index]] · [[frontend-pages]]
