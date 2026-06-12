---
type: tz
status: ready-to-implement
feature: mobile-cora-exec-manager
date: 2026-06-11
owner: Сергей (владелец продукта)
relates_to:
  - plans/analysis/2026-06-11-mobile-cora-exec-manager-value.md
  - plans/analysis/2026-06-11-mobile-cora-mockup.html
  - plans/analysis/2026-06-08-value-stickiness-roadmap.md
  - plans/tz/2026-06-05-personal-cabinet-me.md
supersedes: plans/tz/2026-05-23-tracker-mobile-native.md
---

> Анализ: `plans/analysis/2026-06-11-mobile-cora-exec-manager-value.md` (research-complete) · Макет (утверждён владельцем): `plans/analysis/2026-06-11-mobile-cora-mockup.html` · Статус согласования: 2026-06-11.

# ТЗ: Мобильная версия Коры — экраны руководителя и менеджера

## Принцип (инвариант №1 — вынесен в начало по требованию владельца)

**Мобильная версия = ТО ЖЕ веб-приложение (Next.js App Router), которое определяет мобильный экран и рендерит мобильную раскладку поверх ТЕХ ЖЕ источников данных существующих дашбордов.**

- **НЕ переделывать существующие дашборды и НЕ менять десктоп.** Десктопные клиенты (`DirectorDashboardClient`, `OperationsDashboardClient`, кабинет «Я» и т.д.) остаются как есть — ни одной правки их рендера/верстки.
- Мобильные экраны — **тонкий презентационный слой**, который читает **существующие эндпоинты** (новых данных/расчётов почти не добавляем; добавляем только presentation + 2 недостающих фронт-страницы + включение готового push-движка).
- **Никакой нативки / второй команды.** RN-ТЗ `2026-05-23-tracker-mobile-native.md` — **отвергнуто** (см. анализ §7: для дашбордного приложения выигрыш не окупается; нарушает CLAUDE.md §7 «единый Bun+Node+TS-стек»). Это ТЗ его `supersedes`.
- Один код, одни эндпоинты, разная подача по размеру экрана.

## Вне scope / отложено владельцем

- Финансы/себестоимость на мобиле — **не показываем** (решение владельца).
- Свайп-карусель между дашбордами — **отвергнута** (анализ §8; bottom-tabs). Свайп — только внутри экрана (см. Ф3/Ф4, низкий приоритет).
- Telegram-доставка дайджеста — остаётся **OFF** (web-push основной канал; Telegram — отдельная развилка владельца, не здесь).
- Apple Watch, нативные home-виджеты, RuStore-обёртка — **vNext** (анализ §7, Вариант C «волна 2»); отдельным ТЗ после прод-замера web-push.
- Полный таск-трекер, доски проектов, конструктор дашбордов, админка — **только десктоп** (анализ §5).
- Изменения состава/логики самих дашбордных расчётов — **не входит** (переиспользуем как есть).

---

## Цель + Зачем

**Болезненное состояние (доказано в анализе §1, value-stickiness-roadmap):** продукт перекошен в сторону владельца и почти не имеет движка ежедневного использования; у руководителя и менеджера нет ежедневного мобильного ритуала, который за один взгляд доказывает пользу. Витрина без ежедневного использования на 2-й месяц показывает падающие цифры.

**Что делаем:** даём две минимальные мобильные поверхности (доказанный минимум, анализ §5):
- **Руководитель** (`owner`/`admin`): экран «Обзор» (картина компании за один взгляд) → проваливание в разделы → быстрый AI-вопрос по памяти.
- **Менеджер** (`manager`): экран «Моё» (мой день + мой ритм, позитивная рамка) + чек-ин голосом + быстрый AI-вопрос.

**Зачем именно так (research-цитаты, анализ §5–§6):** «один утренний экран = один вопрос» + контекстный push — сильнейший cross-сегментный паттерн возврата (Oura/Whoop, Microsoft «Plan My Day», RocketSales; «один push в первые 90 дней → +147% удержание» — Appbot/CleverTap, `claimed`). AI-ассистент на телефоне — незанятая ниша во всём BI и РФ (Битрикс24 CoPilot не отвечает «что мы решили»). «Где ты провалил» красным = слежка → демотивация (RT2, анализ §9) → позитивная рамка обязательна.

---

## REALITY-CHECK (verified по коду 2026-06-11; перед правкой каждого символа — re-Read, номера строк дрейфуют)

**Готово на 70–80% — пересчёт фаз под фактический ОСТАТОК, не под идею «с нуля».**

| Что | Факт | Якорь (символ) |
|---|---|---|
| PWA-манифест | ✅ есть | `frontend/app/manifest.ts` (`display:'standalone'`) |
| Service Worker, push-обработчик **корректен под iOS** | ✅ `event.waitUntil(self.registration.showNotification(...))` + try/catch на не-JSON | `frontend/public/sw.js` (`addEventListener('push'`, `addEventListener('notificationclick'`) |
| Web-push клиент (VAPID subscribe) | ✅ есть; **комментарий «404 TODO» в шапке файла УСТАРЕЛ** (backend есть) | `frontend/src/lib/pwa/push.ts` (`subscribeToPush`) |
| Backend web-push: подписки + отправка + worker + cleanup | ✅ реализован | `backend/src/modules/push/*` (`PushSubscriptionsController`, `WebPushSender`, `push-sender.worker`, `push-cleanup.cron`) |
| Очередь отправки push | ✅ `enqueuePushSend` | `backend/src/modules/core-queue/core-queue.service.ts` (`enqueuePushSend`) |
| **VAPID-ключи в prod** | ❌ **НЕ заданы** → `WebPushSender` no-op (подписки копятся, отправки нет) | `web-push-sender.service.ts` (`isSendEnabled`), `typed-config.service.ts` (`VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`/`PUSH_MAX_FAILURES`) |
| **Бриф «Твой день» (бэк менеджера)** | ✅ **полностью**: сервис + контроллер + DTO + cron + модель | сервис `personal-daily-brief.service.ts` (`buildFor`/`getForPerson`/`markOpened`/`upsert`); контроллер `operations/controllers/my-daily-brief.controller.ts`; cron `operations/workers/personal-daily-brief.cron.ts`; DTO `operations/dto/personal-daily-brief.dto.ts` (`DailyBriefDto`/`toDailyBriefDto`/`emptyDailyBriefDto`); модель `PersonalDailyBrief` (`openedAt`/`deliveredAt`) |
| **Фронт-страница `/me/daily-brief`** | ❌ **НЕ существует** (нет в `frontend/app/(authenticated)/me/**`; grep `daily-brief` по `frontend` пуст) → push-крон `actionUrl:'/me/daily-brief'` ведёт в никуда | — |
| Дашборд руководителя (данные «Обзора») | ✅ есть; зоны кладутся на DTO | `dashboard/services/director-dashboard.service.ts` `getDirectorView()→DirectorDashboardDto`: `valueStrip` (=«Кора за неделю»), `goalsPulse`/`strategicAlignment`/`goalTree` (=«Цель»), `requiresAction`/`signals`/`signalCounters` (=«Что мешает»/«Требует тебя») |
| Операционная панель (настроение/блокеры/люди под риском) | ✅ есть | `operations/controllers/operations-dashboard.controller.ts`, `operations-dashboard.service.ts` |
| «Кто держит слово» (self + по людям) | ✅ есть | `operations/controllers/my-weekly-per-person.controller.ts` + `weekly-per-person.service.ts` |
| Кабинет «Я» на вкладках + виджеты | ✅ есть | `frontend/app/(authenticated)/me/MeTabsClient.tsx`; виджеты `me/widgets/*` (`MemoryHelpedMeWidget`, `MyWeeklyPlanFactWidget`, `RecognitionInboxWidget`, `MyIdeasFateWidget`) |
| Ежедневные чек-ины | ✅ есть | `frontend/app/(authenticated)/me/check-ins/*`, `DailyCheckIn` |
| Concierge (плавающая кнопка) + AI-чат «Помощник компании» | ✅ есть | `AppShell.tsx` (`ConciergeFloatingButton`), `AssistantSidebar` |
| Адаптивный shell + mobile bottom-nav (заточен под **трекер**, 5 табов) | ✅ есть, но не по роли | `AppShell.tsx`, `frontend/src/ui/tracker/TrackerBottomNav.tsx` (`ITEMS`) |
| Роль текущего пользователя на фронте | ✅ `currentOrgRole` | `frontend/src/contexts/auth-context.tsx` (`currentOrgRole: CurrentOrgRole`) |
| `useMediaQuery`, recharts 3.8.1 | ✅ есть | `frontend/src/hooks/useMediaQuery.ts`, `package.json` |
| Свайп-библиотека (embla/swiper) | ❌ нет в зависимостях | `frontend/package.json` |

**Вывод REALITY-CHECK:** основная работа — **фронтовый презентационный слой** (мобильные экраны поверх готовых эндпоинтов) + **2 недостающие страницы** (`/me/daily-brief`, exec-«Обзор» мобильный) + **включение готового push-движка** (VAPID-ключи + UX установки PWA) + **перевод дайджеста владельца на web-push**. Бэкенд почти не трогаем.

---

## Принятые решения владельца (батч 2026-06-11, не пересматривать)

| # | Решение | Обоснование (Почему) |
|---|---|---|
| Р1 | Мобайл = тот же web-app, презентационный слой по `currentOrgRole`+viewport; десктоп не меняем | Явное требование владельца; анализ §7 (PWA-first, единый стек, CLAUDE.md §7) |
| Р2 | Первый экран руководителя = «Обзор» (приборная панель): строка «Требует тебя: N» + 4 зоны (Команда/Дела/Главная цель/Что мешает) + полоса «Кора за неделю» + «Спросить»; финансы НЕ показываем | Владелец выбрал Вариант A; анализ §5.1; глянцевый канон |
| Р3 | Навигация — bottom-tabs по роли; 3 уровня (обзор→раздел→деталь, назад стрелкой); свайп только внутри экрана | Анализ §8 (NN/g/Baymard/Runyon: 84% не листают карусель; +30% discovery у tab-bar) |
| Р4 | Менеджер — позитивная рамка «держишь слово N из M + что дальше»; провалы видны ТОЛЬКО самому; руководителю — агрегат «кому помочь», без публичного «кто провалил» | RT2 (анализ §9): красная метрика провалов = слежка → отток (+18 п.п. job-hunting) |
| Р5 | Возврат pull-first (при открытии сразу «что требует»); push — контекстное усиление, не единственный крючок | RT1 (анализ §9): iOS-web-push хрупок; generic-daily-push = худший opt-out |
| Р6 | Cold-start: индикатор наполнения графа + демо-снимок вместо пустых графиков | RT2 (анализ §9): 40–60% B2B отваливаются на пустом экране |
| Р7 | Чек-ин и системные диалоги — без inline-кнопок-вариантов, только текст/голос (ASR на вход) | `feedback_probe_no_buttons_text_voice_only` |
| Р8 | «Спросить»/Помощник — ответ ТОЛЬКО текстом; голос только на ВВОД | `feedback_concierge_text_only_output` |

## Доказательство выбора

Полная состязательная база — в анализе `2026-06-11-mobile-cora-exec-manager-value.md` (§5 критично/не критично по ролям, §7 матрица платформы, §8 матрица навигации, §9 два независимых red-team — оба «weakened», правки встроены в Р4/Р5/Р6). Здесь — только архитектурные Б-решения реализации:

| # | Решение реализации | Альтернатива | На чём ломается альтернатива (Почему выбрано) |
|---|---|---|---|
| Б1 | Мобильная раскладка через **клиентский viewport-gate** (`useIsMobile()` поверх `useMediaQuery`) в shell: ниже `md` рендерим мобильное дерево, иначе — существующий десктоп; **один fetch** | Двойной рендер обоих деревьев через CSS `hidden md:block`/`md:hidden` | CSS-вариант рендерит ОБА дерева → двойной fetch тех же эндпоинтов + лишний DOM; gate рендерит ОДНО дерево. SSR-дефолт — нейтральный skeleton до mount (authenticated-зона, SEO не важен) → нет flicker-уродства |
| Б2 | Новый **role-aware `MobileTabBar`** (exec-табы / manager-табы), `TrackerBottomNav` не трогаем (остаётся для трекер-маршрутов) | Переписать `TrackerBottomNav` под роли | TrackerBottomNav заточен под трекер (Мои задачи/Проекты/Лента); смешивать роли в нём = регресс трекера. Отдельный компонент изолирует |
| Б3 | Мобильные экраны **читают существующие эндпоинты** (`/dashboard/director`, `/me/daily-brief`, `/operations/*`, `/me/weekly-per-person`, ChatV2) через слой `ApiDto→DomainModel→UiModel` + SWR; новых backend-расчётов нет | Новые «mobile-aggregate» эндпоинты | Дублирование расчётов = рассинхрон с десктопом; презентационный слой обязан жить на тех же данных (инвариант №1) |
| Б4 | Exec-«Обзор» — **новый клиент-компонент** `MobileOverviewClient`, монтируется на существующем `/dashboard` при мобильном viewport; десктопный `DirectorDashboardClient` не трогаем | Новый роут `/m/overview` | Лишний роут + дубль навигации; владелец просил «зашёл с телефона на ту же версию — показывает мобильную». Gate на том же роуте проще |
| Б5 | Свайп внутри экрана (листание недель, смахнуть карточку) — `embla-carousel-react` (7 КБ, SSR/App Router-совместим), **низкий приоритет, отдельная под-фаза**; API сверить через Context7 при реализации | Swiper.js | Swiper тяжёлый; свайп вторичен (Р3). Отложен в конец, не блокирует ядро |

---

## Контракт-first (единый источник правды для фронт↔бэк)

### Существующие эндпоинты, которые читают мобильные экраны (НЕ создаём заново)

```
# Руководитель «Обзор» и разделы (owner/admin; RBAC как у десктопа):
GET /api/v1/dashboard/director            → DirectorDashboardDto
  .valueStrip          → полоса «Кора за неделю» (снятая рутина)
  .goalsPulse / .strategicAlignment / .goalTree → зона «Главная цель»
  .requiresAction / .signals / .signalCounters → «Требует тебя: N» + «Что мешает»
GET /api/v1/operations/dashboard          → блокеры, температура/настроение, люди под риском → зоны «Команда»/«Что мешает»
GET /api/v1/operations/weekly-per-person  → «Дела»: держат слово, просрочено/сегодня/неделя по людям
  (точные пути/имена методов — re-Read контроллеров operations-dashboard.controller.ts,
   my-weekly-per-person.controller.ts перед интеграцией; не угадывать query-параметры)

# Менеджер «Моё»/«Чек-ин» (self-scope, готово целиком на бэке):
GET  /api/v1/me/daily-brief?date=YYYY-MM-DD   → DailyBriefDto (см. ниже)
POST /api/v1/me/daily-brief/:id/opened        → {ok:true}  (engagement: openedAt)
GET  /api/v1/me/knows-who?blockId=&q=&limit=  → KnowsWhoListDto
# чек-ины — существующие эндпоинты раздела /me/check-ins (re-Read MyCheckInsClient/контроллер)

# «Спросить» (оба) — существующий ChatV2 / «Помощник компании» (re-Read AssistantSidebar + chat-v2 контроллер)

# Память (менеджер) — существующие decisions/knowledge эндпоинты (re-Read /decisions, /ideas, поиск)
```

### `DailyBriefDto` — форма, которую рендерит мобильный «Моё» (verified из `personal-daily-brief.service.ts` payload + DTO)

```ts
// Источник правды — backend/src/modules/operations/dto/personal-daily-brief.dto.ts
// (re-Read перед маппингом; ниже — состав payload из buildFor)
type DailyBriefDto = {
  id: string | null;
  dateLocal: string;
  myTasks:      BriefItem[];   // Issue+Task, назначенные мне, due today/overdue
  myPromises:   BriefItem[];   // мои обещания (commitmentAuthorPersonId=я), срок≤сегодня
  myBlockers:   BriefItem[];   // открытые блокеры-автора
  promisedToMe: BriefItem[];   // обещано мне
  hint: string;                // 1 подсказка дня (LLM + fallback)
  knowsWho: { expertName: string; blockerText: string; ... } | null;
  insightCoOccurrence: { statement: string; colleaguesCount: number; escalated: boolean } | null; // «ты не один»
  counts: { tasks: number; promises: number; blockers: number; promisedToMe: number };
  deliveredAt: string | null; openedAt: string | null;
};
// BriefItem: { kind, title, dueDateIso, overdue, counterpartyName? , ... }
```

**Маппинг на макет «Моё» (Р4 — позитивная рамка):**
- «Держишь слово N из M» = считается на фронте из `myPromises` (всего vs `overdue===false`); **запрещено** выводить «проваленные обещания» как красный список — overdue показываем как «под угрозой / перенести», не как вину.
- «Под рукой сегодня» = `myTasks` + `myPromises` (due today), просроченные — отдельным мягким блоком вверху с действием «перенести/готово».
- «Ты не один» = `insightCoOccurrence` (если есть). «Кто поможет» = `knowsWho`.
- Подсказка дня = `hint`.

### Новый фронт: контракт мобильных компонентов (создаём)

```
frontend/src/ui/mobile/
  MobileShell.tsx           # viewport-gate (Б1) + MobileTabBar + рендер активного экрана
  MobileTabBar.tsx          # role-aware (Б2): exec[Обзор,Команда,Дела,Цели,Спросить] | manager[Моё,Чек-ин,Спросить,Память]
  exec/MobileOverviewClient.tsx   # Ф2 — зоны из DirectorDashboardDto + operations
  exec/MobileTeamClient.tsx       # Ф3 — операционные люди/настроение
  exec/MobileDealsClient.tsx      # Ф3 — weekly-per-person
  exec/MobileGoalsClient.tsx      # Ф3 — goalsPulse/goalTree
  manager/MobileMyDayClient.tsx   # Ф4 — DailyBriefDto (читает GET /me/daily-brief)
  manager/MobileCheckinClient.tsx # Ф4 — чек-ин голосом
  manager/MobileMemoryClient.tsx  # Ф6 — лента решений/договорённостей + поиск
  shared/MobileAskClient.tsx      # Ф5 — Concierge/ChatV2 first-class + промпт-кнопки
  shared/ZoneTile.tsx, StatusDot.tsx, GlanceGauge.tsx, DrillList.tsx  # presentation primitives
```
Слои: `*.api.ts` (ApiDto) → `domain/*` (DomainModel) → компонент (UiModel); единый `api-client.ts`; data-fetching — SWR (frontend-rules). Только русский UI; парные токены `bg-{color}`+`text-{color}-fg`, светофор через токены, без `text-white` на цветном/без hex.

### Фронт-страница `/me/daily-brief` (Ф0)

```
frontend/app/(authenticated)/me/daily-brief/page.tsx  + MyDailyBriefClient.tsx
# Читает GET /api/v1/me/daily-brief; при открытии шлёт POST /me/daily-brief/:id/opened (если id!==null).
# На мобиле = тот же контент, что MobileMyDayClient (переиспользовать). На десктопе — простая страница.
```

---

## Границы фичи (локальные)

- ✅ **Always:** читать существующие эндпоинты; добавлять presentation-компоненты под `src/ui/mobile/*`; гейтить по viewport+роли; русский UI + парные токены; SWR.
- ⚠️ **Ask first:** любая правка backend-расчёта дашборда/брифа (инвариант: не меняем); новые поля в `DirectorDashboardDto`/`DailyBriefDto`; любое изменение десктопных клиентов.
- 🚫 **Never:** менять рендер существующих дашбордов; дублировать backend-агрегаты; нативка/RN; inline-кнопки в чек-ине/диалогах; голосовой вывод ассистента; финансы на мобиле; `text-white` на цветном; `process.env.*` напрямую; `prisma db push`/`new PrismaClient()`.

---

## Фазы (dependency-ordered, статус `[ ]`)

Граф зависимостей:
```
Ф0 ─► Ф1 ─┬─► Ф2 ─► Ф3
          ├─► Ф4
          ├─► Ф5
          └─► Ф6
Ф2 + Ф0(push) ─► Ф7
```
Строго последовательны: Ф0→Ф1 (всё опирается на shell), Ф2→Ф3 (разделы — drill из «Обзора»). Параллельны после Ф1: Ф4, Ф5, Ф6. Ф7 — после Ф2 и push-движка Ф0.

### Ф0 — Включить движок брифа + страница `/me/daily-brief` (фундамент)
**Цель:** push-крон перестаёт вести в никуда; web-push реально отправляется.
**Что входит:**
- Создать `frontend/app/(authenticated)/me/daily-brief/page.tsx` + клиент, читающий `GET /api/v1/me/daily-brief`, и при открытии вызывающий `POST /me/daily-brief/:id/opened` (если `id!==null`). Пустой бриф → cold-start empty-state (Р6), не белый экран.
- UX подписки/установки PWA: на мобиле — кнопка «Включить утренние напоминания» (вызывает `subscribeToPush` из `push.ts`); на iOS — инструкция «Поделиться → На экран Домой» (нет `beforeinstallprompt`), на Android — `beforeinstallprompt`-плашка. Размещение — в `/me/daily-brief` и/или shell.
- **VAPID-ключи в prod** — это prod-deploy-операция (ENV `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT`; ключи — секрет → ENV, НЕ AdminSetting). Доставка брифа уже гейтится kill-switch `operations.personal_daily_brief.enabled` (ON по умолчанию — Ship-On ок).
**Что НЕ входит:** новый backend брифа (готов); мобильный shell (Ф1).
**Точки интеграции:** `me/daily-brief.api.ts` (новый) → `my-daily-brief.controller.ts`.
**Acceptance:**
- `GET /me/daily-brief` отрисован страницей; маршрут `/me/daily-brief` не 404 (grep страницы; ручной переход).
- При `payload.id!==null` после монтирования уходит `POST /me/daily-brief/:id/opened` (network-проверка); метрика `personal_daily_brief_opened_total` инкрементится.
- Пустой бриф (нет Person / пустой день) → видимый empty-state с текстом наполнения, не падение.
- `bun run typecheck && bun run lint && bun run build` (frontend) зелёные.
- Prod: после задания VAPID — `WebPushSender.isSendEnabled===true` (лог «WebPushSender готов к отправке»), тестовый push доставлен на подписанное устройство.
**Закрывает:** R1, R2.

### Ф1 — Мобильный shell + role-aware bottom-nav + viewport-gate (Б1, Б2)
**Цель:** при заходе с телефона показывается мобильная раскладка по роли; десктоп не изменён.
**Что входит:** `useIsMobile()` (поверх `useMediaQuery`); `MobileShell` (SSR-skeleton до mount, затем mobile|desktop — один fetch); `MobileTabBar` (exec/manager наборы из Р2/Р3); приземление по роли (`currentOrgRole` owner/admin → exec-таб «Обзор»; manager → «Моё»). Десктопные клиенты рендерятся без изменений при `md+`.
**Что НЕ входит:** содержимое экранов (Ф2–Ф6).
**Точки интеграции:** `AppShell.tsx` (вставить gate, не ломать desktop sidebar/`TrackerBottomNav` для трекер-маршрутов); `auth-context` (`currentOrgRole`).
**Acceptance:**
- На ширине < `md` авторизованный экран показывает `MobileTabBar` с табами по роли; десктоп (`md+`) — без изменений (визуальный диф desktop = 0).
- owner/admin приземляется на «Обзор», manager — на «Моё» (проверка по роли тестового аккаунта).
- Нет двойного fetch одних и тех же эндпоинтов (network-проверка: один запрос на эндпоинт).
- typecheck/lint/build зелёные.
**Закрывает:** R3, R4.

### Ф2 — Экран руководителя «Обзор» (зоны из существующих данных)
**Цель:** картина компании за один взгляд (Р2).
**Что входит:** `MobileOverviewClient` на `/dashboard` (Б4) при мобильном viewport: строка «Требует тебя: N» (`requiresAction`/`signalCounters`), 4 зоны-плитки (Команда — operations настроение/в строю; Дела — `weekly-per-person`/`valueStrip` слово%; Главная цель — `goalsPulse`/`strategicAlignment` полукруг+%; Что мешает — блокеры из operations/`signals`), полоса «Кора за неделю» (`valueStrip`), кнопка «Спросить» (→ Ф5). Светофор — парные токены. Cold-start (Р6): если данных нет — индикатор наполнения, не пустые плитки.
**Что НЕ входит:** разделы-drill (Ф3); финансы (никогда).
**Точки интеграции:** `dashboard/director.api.ts` (существующий или re-use), `operations` api.
**Acceptance:**
- На мобиле `/dashboard` рендерит «Обзор» с 4 зонами + строкой «Требует тебя» + «Кора за неделю»; десктоп `/dashboard` не изменён.
- Каждая зона — крупное число + статус-дот (парный токен, не `text-white`); тап по зоне ведёт в раздел (Ф3) или заглушку-маршрут.
- Пустой граф → cold-start индикатор (Р6), grep маркера empty-state.
- typecheck/lint/build зелёные.
**Закрывает:** R5.

### Ф3 — Разделы руководителя: Команда / Дела / Цели + drill
**Цель:** проваливание из «Обзора» в раздел и в деталь (Р3).
**Что входит:** `MobileTeamClient` (люди + светофор настроения + «кому помочь» вверху — operations), `MobileDealsClient` (держат слово %, сегменты Просрочено/Сегодня/Неделя — `weekly-per-person`), `MobileGoalsClient` (главная цель + ключевые результаты — `goalsPulse`/`goalTree`). Drill: тап строки → деталь (переиспользовать существующие detail-страницы/эндпоинты, где есть; иначе минимальная мобильная деталь). **Никакого публичного «кто провалил» в негативной рамке** — фокус «кому помочь» (Р4).
**Что НЕ входит:** правки расчётов; свайп недель (Б5, отдельная под-фаза в конце).
**Acceptance:** три раздела открываются с таб-бара и из зон «Обзора»; данные совпадают с десктопом (один эндпоинт); «назад» работает; typecheck/lint/build зелёные. **Закрывает:** R6.

### Ф4 — Экраны менеджера: «Моё» + «Чек-ин»
**Цель:** мой день (позитивная рамка) + ритуал чек-ина голосом.
**Что входит:**
- `MobileMyDayClient` — читает `GET /me/daily-brief` (Ф0): «держишь слово N из M + что дальше» (Р4, считать на фронте, overdue = «под угрозой/перенести», не вина); «под рукой сегодня» (`myTasks`+`myPromises`); «ты не один» (`insightCoOccurrence`); признание (переиспользовать `RecognitionInboxWidget`); кнопка «Спросить». Свайп карточки (готово/перенести) — Б5 (низкий приоритет).
- `MobileCheckinClient` — переиспользует существующий поток `/me/check-ins`: утро «Что в фокусе сегодня?» поле текст **+ микрофон (ASR на вход)**, вечер «Как прошёл день?»; **без inline-кнопок-вариантов** (Р7); недавние дни без давления-стрика.
**Что НЕ входит:** общекомпанийные дашборды (десктоп); голосовой вывод (Р8).
**Acceptance:**
- «Моё» рендерит данные `/me/daily-brief`; нет ни одной формулировки «проваленные обещания/где ты просрочил» (grep запрещённых строк = 0); overdue подан как действие.
- Чек-ин: поле свободного ввода + микрофон; **ноль `inline_keyboard`/кнопок-вариантов** в системном вопросе (grep); ответ ассистента/подсказки — только текст.
- typecheck/lint/build зелёные.
**Закрывает:** R7, R8.

### Ф5 — Таб «Спросить» (Concierge/ChatV2 first-class) — оба
**Цель:** быстрый AI-вопрос по памяти компании с телефона (незанятая ниша, анализ §5.3).
**Что входит:** `MobileAskClient` — first-class экран (не только оверлей): переиспользовать существующий ChatV2/«Помощник компании»; промпт-кнопки в один тап (руководитель: «Сводка за неделю», «Риски по проекту», «Кто не сдал слово»; менеджер: «Как у нас оформляют X», «Что решили по Y», «Спросить клон должности»); голос-ВВОД (ASR), ответ ТОЛЬКО текстом (Р8); ответ с привязкой к источнику (citation), как на десктопе.
**Что НЕ входит:** новый LLM-роутинг (переиспользуем); голосовой вывод.
**Acceptance:** таб «Спросить» открывает чат; промпт-кнопка подставляет запрос; ответ только текст, с citation; нет ни одного «🔊/Слушать» (grep). typecheck/lint/build зелёные. **Закрывает:** R9.

### Ф6 — Экран менеджера «Память» (лента решений/договорённостей + поиск)
**Цель:** сотрудник быстро находит «что важного решили» (cabinet-roles §3).
**Что входит:** `MobileMemoryClient` — лента свежих решений/договорённостей (переиспользовать существующие `/decisions`/`/ideas`/knowledge-эндпоинты, self-видимость по доступу) + строка поиска (переиспользовать существующий поиск памяти). Карточки с тегом «Решение»/«Договорённость» + дата/источник.
**Что НЕ входит:** новые модели/расчёты.
**Acceptance:** лента рендерит реальные решения/договорённости из существующих эндпоинтов с учётом доступа; поиск возвращает результаты; typecheck/lint/build зелёные. **Закрывает:** R10.

### Ф7 — Утренний push руководителю + cold-start + установка PWA
**Цель:** «один контекстный push с утра» как усиление (Р5), pull-first сохранён.
**Что входит:**
- Перевести дайджест владельца/COO на тот же web-push-канал: `operations-daily-digest.cron.ts` — добавить доставку через `enqueuePushSend` (текст «Требует тебя сегодня: N» из `requiresAction`/`signalCounters`, `actionUrl` → мобильный «Обзор»), под общим дневным бюджетом+тихими часами (как `personal-daily-brief.cron`). Гейт доставки = kill-switch (Ship-On ON); **не** Telegram.
- Cold-start (Р6) на «Обзоре»/«Моё»: индикатор наполнения графа («ещё N встреч — появится вектор цели») + демо-снимок.
- Финализировать UX установки/permission (из Ф0) и единый дневной бюджет уведомлений (push не чаще лимита; тихие часы 22–8 локально).
**Что НЕ входит:** RuStore-обёртка (vNext); Telegram-доставка.
**Acceptance:**
- Владелец с подпиской на push получает утренний контекстный push «Требует тебя: N» (smoke на тестовом тенанте), тап → мобильный «Обзор».
- Нет generic-ежедневного спама: соблюдён дневной бюджет + тихие часы (проверка в коде кронов).
- Cold-start индикатор виден на пустом графе (grep маркера).
- typecheck/lint/build + smoke крона зелёные.
**Закрывает:** R11, R12.

### Ф8 (низкий приоритет, опц.) — Свайп внутри экрана (Б5)
Листание недель в «Делах», смахивание карточки «готово/перенести» в «Моё». `embla-carousel-react` (сверить API через Context7 перед добавлением в `package.json`). **Acceptance:** свайп работает, есть видимая альтернатива (стрелки/кнопки), не конфликтует с вертикальным скроллом и системным edge-swipe iOS. **Закрывает:** R13.

---

## Требования (трассировка)
- R1: Когда пользователь открывает `/me/daily-brief`, система shall отрисовать его бриф или cold-start empty-state (не 404, не белый экран).
- R2: Когда бриф с `id!==null` смонтирован, система shall отправить `POST /me/daily-brief/:id/opened` один раз.
- R3: Если viewport < `md`, система shall показать `MobileTabBar` с табами по роли; иначе десктоп без изменений.
- R4: Система shall приземлять owner/admin на «Обзор», manager на «Моё».
- R5: «Обзор» shall показать строку «Требует тебя: N» + 4 зоны + «Кора за неделю», все из существующих эндпоинтов.
- R6: Команда/Дела/Цели shall открываться из таб-бара и из зон, данные = десктопные эндпоинты.
- R7: Чек-ин shall принимать свободный текст и голос (ASR), без inline-кнопок-вариантов.
- R8: «Моё» shall выражать прогресс позитивно; система shall NOT показывать публичный список «кто провалил»; ответы ассистента — только текст.
- R9: «Спросить» shall отвечать текстом с привязкой к источнику; промпт-кнопки подставляют запрос.
- R10: «Память» shall показывать решения/договорённости из существующих эндпоинтов с учётом доступа + поиск.
- R11: Система shall доставлять руководителю утренний контекстный web-push «Требует тебя: N» под дневным бюджетом+тихими часами (kill-switch ON), не Telegram.
- R12: На пустом графе система shall показать индикатор наполнения, не пустые графики.
- R13 (опц.): свайп внутри экрана shall иметь видимую альтернативу и не конфликтовать с системными жестами.

---

## Pre-mortem / Риски + ревью-аспекты (для strict-production-review-gate)
- **Перенос десктопа «как есть» → «ужатый десктоп»** (боль №1 рынка). Ревью: мобильные экраны — отдельная раскладка (один столбец, glance), не порт `DirectorDashboardClient`.
- **Surveillance-рамка у менеджера** → отток. Ревью: grep «провалил/просрочил/не сдал» в менеджерских строках = 0; overdue = действие.
- **Двойной fetch при viewport-gate** (Б1). Ревью: один запрос на эндпоинт; SSR-skeleton без второго дерева.
- **iOS-push молча отписывает** (анализ §13). Ревью: `sw.js` уже корректен (не регрессировать `waitUntil`/`showNotification`/try-catch); push — усиление, pull-first основной (Р5).
- **VAPID-ключи как секрет** — только ENV (не AdminSetting, не код, не коммит).
- **RBAC мобильных экранов** = как у десктопных эндпоинтов (operations — owner/admin/coo; `/me/*` — self-scope). Не ослаблять. Ревью: tenantId на каждом запросе; self-scope брифа не пробивается чужим personId (контроллер уже это держит).
- **Hydration flicker** от viewport-gate. Ревью: нейтральный skeleton до mount, без скачка десктоп→мобайл.

---

## Feature-flags (реестр — `docs/operations/feature-flags.md`, строка на каждый)
- `operations.personal_daily_brief.enabled` — **существует**, kill-switch ON (доставка брифа сотруднику). Не новый.
- Доставка exec-дайджеста в web-push (Ф7) — оформить как **kill-switch ON** (Ship-On): включён сразу, рубильник лишь для инцидента; AdminSetting `operations.daily_digest.deliver_to_webpush` (по образцу существующего гейта дайджеста). Строка в реестр.
- VAPID — **не флаг**, а ENV-секрет (наличие ключа = включённая отправка); зафиксировать в prod-deploy Шаг 1.

## Prod-deploy (диф к `docs/operations/prod-deploy-log.md`)
- **Шаг 1 (ENV):** задать `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` (сгенерировать пару `web-push`); `NEXT_PUBLIC_VAPID_PUBLIC_KEY` на фронте = публичный ключ. Без них push no-op.
- **Шаг 1 (AdminSetting/флаг):** `operations.daily_digest.deliver_to_webpush=true` (Ф7), строка в `feature-flags.md`.
- **Шаг 12 (smoke):** после выката — подписать тестовое устройство, прогнать `personal-daily-brief.cron` (или дождаться окна) → проверить доставку push и переход в `/me/daily-brief`; exec-дайджест → push «Требует тебя».
- Миграции/seed/patch/backfill — **не требуются** (модель `PersonalDailyBrief` уже в схеме; новых таблиц нет). Если по ходу всплывёт новое поле — версионируемая миграция (`prisma:migrate`), не db push.

---

## DoD (общий чек качества)
- `bun run typecheck` (вкл. `.spec`) · `bun run lint` · `bun run build` зелёные на frontend (и backend, если тронут).
- Юнит/интеграционные тесты на новые компоненты-мапперы (ApiDto→Domain) и на ветку доставки exec-push (Ф7).
- Только русский UI; парные токены; ноль `text-white` на цветном; ноль `process.env.*`/`prisma db push`/`new PrismaClient(` в новом коде.
- second-brain обновлён по таблице производных заметок: `01_projects/frontend-pages.md` (новые мобильные экраны + `/me/daily-brief`), `01_projects/frontend-contexts-hooks.md` (`useIsMobile`), `02_architecture/module-map.md` (если новый api-слой), `01_projects/workers-queues.md` (Ф7 exec-push доставка).
- `docs/operations/prod-deploy-log.md` обновлён (Шаги 1/12 выше); `feature-flags.md` — строка по Ф7.
- Рефлексия в `second-brain/05_история/` после push.

## Итог
_(заполнит tz-orchestrator по завершении: что реализовано целиком/частично, что осталось, ссылки на коммиты.)_

---

## Открытые вопросы владельцу (с рекомендацией — задать перед/в начале реализации, не блокируют написание ТЗ)
1. **Приоритет волн:** рекомендую сначала менеджерский путь (Ф0→Ф1→Ф4→Ф5) — он почти готов на бэке и даёт drive-of-usage рядового (roadmap), затем руководителя (Ф2→Ф3→Ф7). *Почему:* липкость рождает рядовой; бэк брифа готов → быстрый результат. Можно переопределить на «руководитель первым».
2. **Exec-«Обзор» зона «Команда»:** источник настроения/«в строю» — `operations-dashboard` (настроение/люди под риском). Рекомендую переиспользовать как есть; если владелец хочет иную метрику «в строю» — уточнить (LOW, можно `[ASSUMPTION]`: «18/20 в строю» = активные за период из operations).
