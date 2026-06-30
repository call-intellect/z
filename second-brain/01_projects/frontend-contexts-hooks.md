---
title: Frontend Contexts & Hooks (реестр)
status: living
covers: React-контексты и кросс-компонентные паттерны фронтенда Z/Кора
---

# Frontend Contexts & Hooks — реестр

Точечный реестр кросс-компонентных механизмов фронтенда (`frontend/src/contexts`,
`frontend/src/hooks` и связанные событийные шины). Пополняется по факту.

## Диалоги Мастера — data-слой дома `/chat` (2026-06-28)

Хуки и маппер для дома Мастера (`MasterChatHome`, см. [[frontend-pages]] §`/chat`) — список
диалогов слева + история по выбору, на движке concierge (SWR).

- **`src/hooks/useConciergeConversations.ts`** — SWR-список диалогов пользователя
  (`conciergeApi.listConversations`); каждый несёт `titlePreview` (первое user-сообщение,
  ≤80 симв., с бэка) — название диалога вместо «Новый диалог», фолбэк на `summary`.
- **`src/hooks/useConciergeConversation.ts`** — SWR-загрузка истории одного диалога по `id`
  (`conciergeApi.getConversation`) при выборе в списке.
- **`src/domain/concierge-conversation.ts`** — маппер ApiDto→DomainModel (`titlePreview`/`summary`
  → отображаемое название, нормализация сообщений). `concierge.api.ts`: `ConciergeStreamEvent.message`
  += `citations`/`needsClarification`, добавлен эвент `confirm_required`; body += `scope`/`scopeRefId`/`asOf`;
  `ConciergeConversationApi` += `titlePreview`.
- Редьюсер потока сообщений — `src/ui/chat/master-chat-events.ts` (SSE+fallback → состояние нити).
- Источник: ТЗ [`2026-06-25-edinyy-pomoshnik-chat-surface-convergence.md`](../../plans/tz/2026-06-25-edinyy-pomoshnik-chat-surface-convergence.md)
  (КФ1–КФ5, коммиты `7d111a94`..`c5b7ec10`). См. [[concierge-agent]] · [[api-layer]].

## Единый плавающий помощник кабинета (2026-06-06 → пересмотрено 2026-06-20)

> ⚠️ **Пересмотрено 2026-06-20** (см. §«Яркий FAB-помощник + сигналы колокольчика» ниже): теперь единственный плавающий вход — `ConciergeFloatingButton` (вернулась видимая кнопка, чат в 1 клик), а `AssistantSidebar` **удалён**. Запись ниже — исторический контекст промежуточного состояния 2026-06-06.

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

## Яркий FAB-помощник + сигналы колокольчика (2026-06-20)

Развёрнут промежуточный шаг 2026-06-06: вернулась **видимая** яркая кнопка
`ConciergeFloatingButton` (чат-помощник в 1 клик), `AssistantSidebar` **удалён**,
цель тура `welcome.concierge` перенесена на FAB. Колокольчик `PendingActionsBell`
стал единственным кликабельным центром уведомлений.

- **`frontend/src/hooks/useAssistantSignals.ts`** — хук сигналов колокольчика:
  тянет `proactiveApi.list` + срочный `activityFeedApi.list` (insight,
  `severity ∈ {critical, high}`) и сводит в единый ряд `BellRow[]` вместе с
  pending-actions (один счётчик `pendingTotal + signalsCount`). Каждый ряд несёт
  обязательный `actionUrl` (иначе скрывается — без сырых слагов).
- **`frontend/src/domain/assistant-signals.ts`** — чистые мапперы:
  `PROACTIVE_RULE_LABEL` (человекочитаемые метки 8 правил proactive),
  `PROACTIVE_RULE_ROUTE` (фронт-зеркало маршрутов watcher как fallback к
  `payload.actionUrl`), `FEED_TYPE_ROUTE` (маршрут по типу feed-сигнала).
  Вынесены отдельно для тестируемости (гард-тест паритета: каждый `ruleType` →
  метка определена).
- Источник: [plans/tz/2026-06-20-assistant-fab-notifications-and-clone-picker.md](../../plans/tz/2026-06-20-assistant-fab-notifications-and-clone-picker.md)
  (Ф1). См. также [[frontend-pages]].

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

## Сквозные хлебные крошки + мобильная «назад» (2026-06-18)

Сквозная навигация-крошки кабинета. **Источник:** ТЗ
[`plans/tz/2026-06-17-cabinet-breadcrumbs-and-mobile-back.md`](../../plans/tz/2026-06-17-cabinet-breadcrumbs-and-mobile-back.md),
ветка `feature/knowledge-base-redesign-formatter`, коммиты `8ef49108`+`eb0f7dee`.
Все файлы — в `frontend/src/ui/components/breadcrumbs/`.

- **`BreadcrumbContext.tsx`** — контекст `BreadcrumbProvider` + хук
  `useRegisterBreadcrumb(segment, name)`: детальная страница регистрирует
  человеко-читаемое имя для своего динамического сегмента (`[id]`/`[slug]`),
  чтобы в крошке отображалось «Иван Петров», а не сырой cuid. Имена
  зарегистрированы на ~16 страницах-деталях.
- **`useBreadcrumbTrail.ts`** — хук `useBreadcrumbTrail` поверх чистой функции
  `buildBreadcrumbTrail(pathname, config, registeredNames)`: собирает цепочку
  крошек из текущего `pathname` по конфигу + зарегистрированных имён. Чистая
  функция вынесена для тестируемости.
- **`Breadcrumbs.tsx`** — компонент рендера цепочки (desktop) + кнопка «назад»
  (mobile).
- **`breadcrumb-config.ts`** — карта сегментов → label/parentHref/navigable.
  Сегмент `issues` помечен non-navigable (домен Issue не несёт slug проекта —
  крошка `/issues/[id]` без parentHref на доску, см. реестр «не-сделано»).
- Встроены в `AppShell` / `Header` / `AuthenticatedShell`.

⚠️ Ф5 (визуальная qa-приёмка крошек) — НЕ выполнена (ручной шаг, см. реестр
[[../04_не-сделано/README|не-сделано]]).

## Виджет «Лента Коры» вместо страницы `/feed` (2026-06-18)

«Лента Коры» вынесена в переиспользуемый виджет
`frontend/src/ui/components/feed/CoraFeedWidget.tsx` (`variant: 'full' | 'compact'`)
и встроена на `/dashboard` и `/me`. Отдельная страница `/feed` (page.tsx +
FeedClient.tsx) **удалена** (сиблинги `/feed/insights`, `/feed/probe-questions`,
`/feed/spotlights` остались). **Источник:** ТЗ
[`plans/tz/2026-06-17-cora-feed-into-dashboards.md`](../../plans/tz/2026-06-17-cora-feed-into-dashboards.md),
коммиты `9aa3945e`+`10dbbe35`. См. также [[frontend-pages]]. Ф5 (визуальная qa) —
НЕ выполнена.

## «Месяц компании» + навигация по датам/архив (2026-06-30)

Хуки героев-брифингов и общий навигатор периодов (ветка
`feature/month-company-and-report-navigation`):

- **`useMonthCompany`** (`src/hooks/useMonthCompany.ts`) — SWR к
  `GET /dashboard/operations/monthly-digest/latest|?period=`; слои
  `src/api/monthly-digest.api.ts` → `src/domain/operations-monthly-digest.ts`.
  Питает героя `MonthCompanyHero` на `/month`.
- **`useDayAvailablePeriods` / `useWeekAvailablePeriods` / `useMonthAvailablePeriods`**
  — SWR к `…/{daily,weekly,monthly}-digest/available-periods?limit=` → список
  доступных периодов с `stateHint` + `latest` для навигатора/архива.
- **`PeriodNavigator`** (`src/ui/components/dashboard/shared/PeriodNavigator.tsx`)
  — общий stepper по ритму («вперёд» disabled на latest), клик-подпись → попап
  «Недавние отчёты» (архив с цветной точкой `stateHint`) + «Выбрать дату…»
  (нативный picker). Подключён к 3 героям (день/неделя/месяц); `value-recap`
  переведён с локального `PeriodSelector` на него.
- **`PeriodEmptyState`** — нет данных за период → CTA на ближайший/«К последнему»;
  первый запуск → обучающий пустой-стейт.
- **`src/domain/period.ts`** — чистые хелперы дат:
  `shiftDate/mondayOf/shiftWeek/shiftPeriodYm/shiftPeriod/formatPeriodLabel/currentPeriod/comparePeriods/nearestAvailablePeriod`.
- **`GoalCompass3D`** (`src/ui/components/dashboard/shared/GoalCompass3D.tsx`,
  введён 2026-06-29) переиспользован в месячном компасе (`MonthGoalCompass`).

**Источники:** `plans/tz/2026-06-29-month-company-monthly-brief.md`,
`plans/tz/2026-06-30-report-date-navigation-archive.md`. См.
[[director-dashboard]] §«Месяц компании», [[frontend-pages]], [[api-layer]].

---

[[../index|← index]] · [[frontend-pages]]
