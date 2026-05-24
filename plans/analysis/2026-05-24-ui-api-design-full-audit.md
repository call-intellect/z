# Интерфейс / API / дизайн — полный аудит Z

**Дата:** 2026-05-24
**Раздел:** интерфейс / UI / API / тесты / дизайн / светлая тема / тёмная тема
**Теги для поиска:** интерфейс, UI, UX, API, тесты, покрытие, дизайн, design system, светлая тема, тёмная тема, токены, sidebar, dashboard, sexy, секси, frontend, backend, audit, аудит
**Статус:** consolidated research (по итогам 4 параллельных агентских аудитов)
**Связан с:** [plans/analysis/2026-05-23-ui-design-light-theme-research.md](2026-05-23-ui-design-light-theme-research.md)

> Этот файл — **сводный аудит** по 4 трекам: функциональный UI, backend API + тесты, концепт светлой темы (sage), аудит тёмной темы (sexy-приёмы). На его основе пишутся 3-4 ТЗ в `plans/tz/`.

---

## 1. Функциональный UI-аудит

### 1.1 Карта страниц (выборка ключевых)

| Route | Loading | Empty | Error | Качество |
|---|---|---|---|---|
| `(public)/m/[id]` | ✅ | n/a | ✅ | хорошо |
| `(authenticated)/dashboard` | ✅ Skeleton в виджетах | частично | inline | средне |
| `(authenticated)/meetings` | ✅ | ✅ | toast | хорошо |
| `(authenticated)/chat` | ❌ | n/a | ❌ | средне |
| `(authenticated)/chat-v2` | ✅ | ✅ | ✅ | хорошо |
| `(authenticated)/cards` | ❌ нет Skeleton | ❌ нет EmptyState | ❌ нет error-блока | **плохо** |
| `(authenticated)/themes` | spinner | ❌ | ❌ | **плохо** |
| `(authenticated)/tasks` | spinner | ❌ | toast | средне |
| `(authenticated)/goals` | spinner | ✅ | toast | хорошо |
| `(authenticated)/admin/*` (через `useAdminQuery + AdminStateViews`) | ✅ | частично | ✅ единый | **хорошо** |
| `(authenticated)/settings/*` (12 страниц) | разнобой | редко | toast | средне |

Всего ~110 page.tsx. Подробная карта — в отчёте Трека 1.

### 1.2 ТОП-10 функциональных проблем

1. **Две toast-системы параллельно** — legacy [toast-context.tsx](../../frontend/src/contexts/toast-context.tsx) (~70 файлов) и `sonner` через [shadcn/toast.tsx](../../frontend/src/ui/shadcn/toast.tsx) (~16 файлов). Разные позиция/стили/API. Миграция M5 не доделана.
2. **`EmptyState` почти не используется** — компонент [есть](../../frontend/src/ui/components/shared/EmptyState.tsx), но импортируется в 5 файлах. На `/cards`, `/themes`, `/tasks`, `/persons`, `/roles` — пустота вместо empty state.
3. **`EmptyState` хардкодит светлую палитру** (`border-slate-300 bg-white text-slate-900`) — на dark (default) сломан.
4. **`/chat`** ([ChatClient.tsx](../../frontend/app/(authenticated)/chat/ChatClient.tsx)) — нет своих UX-состояний, всё спущено в `OrgChatPanel`.
5. **`/cards`** ([CardsClient.tsx](../../frontend/app/(authenticated)/cards/CardsClient.tsx)) — `swr.error` игнорируется, `isLoading` не отрисовывается.
6. **`/themes`** ([ThemesClient.tsx](../../frontend/app/(authenticated)/themes/ThemesClient.tsx)) — нет error/empty/skeleton.
7. **Голые `<button>` pill-фильтры** мимо shadcn-Toggle в [tasks](../../frontend/app/(authenticated)/tasks/TasksClient.tsx), [meetings-journal](../../frontend/src/ui/components/meetings-journal/MeetingsJournalReal.tsx) — нет `aria-pressed`, разный focus-ring.
8. **DirectorDashboard error: хардкод `bg-red-50/text-red-700`** ([DirectorDashboardClient.tsx:136](../../frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx#L136)) вместо `bg-danger/10 text-danger`.
9. **Mobile-responsive закончился на AppShell.** `md:hidden`/`hidden md:` всего в 4 файлах. Master-detail и таблицы — `overflow-x-auto`. На phone юзабельно: лобби, онбординг, гостевой `/m/[id]`.
10. **Нативные `alert()`/`confirm()`** в [ConciergeVoice.tsx](../../frontend/src/ui/concierge/ConciergeVoice.tsx), [InsightsListClient.tsx](../../frontend/app/(authenticated)/insights/InsightsListClient.tsx), [IdeasListClient.tsx](../../frontend/app/(authenticated)/ideas/IdeasListClient.tsx), [OrchestratorRunClient.tsx](../../frontend/app/(authenticated)/orchestrator/runs/[id]/OrchestratorRunClient.tsx), [meeting-room/ParticipantsPanel.tsx](../../frontend/src/ui/components/meeting-room/ParticipantsPanel.tsx), [meeting-result-v2/ReportsTab.tsx](../../frontend/src/ui/components/meeting-result-v2/ReportsTab.tsx).

### 1.3 Системные паттерны

- **A.** Нет стандартного scaffold для страницы. В admin-зоне есть `useAdminQuery + AdminStateViews` — образец; за её пределами ~50 страниц повторяют разные loading/empty/error руками.
- **B.** SWR error-канал не дисциплинирован. Из 99 файлов с `useSWR` многие молча показывают пустоту. Нужен общий `useSwrWithToast` / `<QueryGate>`.
- **C.** Параллельно живут semantic tokens (`bg-bg-card`, `text-fg-primary`) и сырые tailwind-цвета (`bg-red-50`, `text-slate-900`) — ~260 совпадений в 30+ файлах.
- **D.** Кнопки и pill-фильтры в обход shadcn-button — рассинхрон focus-ring, hover, disabled, a11y.
- **E.** Mobile-стратегия не дошла до страниц.

---

## 2. Backend API + покрытие тестами

### 2.1 Сводка

**137 контроллеров. ~630 эндпоинтов. 173 spec-файла (из них 16 `.skip` со «скелетами»).**

| Группа модулей | Эндп. | Spec | Покрытие |
|---|---:|---:|---|
| meetings / livekit / recordings / host-controls | ~50 | ~10 | норм |
| AI / pipeline / knowledge-core services | ~40 | ~40 | хорошо в сервисах |
| **knowledge-core/api (blocks/themes/graph/entities/search)** | ~10 | **0** | **НЕТ** |
| rbac / orgs / auth / api-keys | ~40 | 9 | норм для auth, **0 для rbac** |
| admin/* (15 контроллеров) | ~70 | ~8 | частичное |
| tracker (issues/projects/cycles/...) | ~75 | 22 | частичное |
| **dashboard (director-dashboard)** | ~1 | **0** | **НЕТ** |
| cards / decisions / ideas / insights / persons / sources | ~90 | 10 | **дыры в cards/decisions/ideas/insights/persons** |
| company-foundation / structure / kpi / goals / tasks | ~80 | ~12 | частичное |
| **entitlements / quotas / billing** | ~40 | 5 | **entitlements без тестов** |
| webhooks (livekit/telegram/max/mango) | ~20 | 3 | **telegram/max/mango без подписи и тестов** |

### 2.2 Критические дыры (TOP-7)

1. **knowledge-core/api — ядро продукта без тестов.** [blocks](../../backend/src/modules/knowledge-core/api/blocks.controller.ts), [themes](../../backend/src/modules/knowledge-core/api/themes.controller.ts), [graph](../../backend/src/modules/knowledge-core/api/graph.controller.ts), [entities](../../backend/src/modules/knowledge-core/api/entities.controller.ts), [search](../../backend/src/modules/knowledge-core/api/search.controller.ts) — 0 spec; единственный [entity-resolution.service.spec.ts](../../backend/src/modules/knowledge-core/services/entity-resolution.service.spec.ts) — `describe.skip` со заглушками.
2. **RBAC-сервис без юнит-тестов.** [rbac.service.ts](../../backend/src/modules/rbac/rbac.service.ts) + [policy.csv](../../backend/src/modules/rbac/policies/policy.csv) — оба сейчас в M-changed-state. Любая регрессия политик уезжает незамеченной.
3. **Entitlements / biling-feature-gates без тестов.** [entitlements.controller.ts](../../backend/src/modules/entitlements/entitlements.controller.ts) + `require-entitlement.decorator.ts` — нет spec. Ошибка → клиент получает не-оплаченные фичи.
4. **Webhooks input без подписи / валидации.** [telegram-webhooks.controller.ts](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-webhooks.controller.ts), [max-webhooks.controller.ts](../../backend/src/modules/conversational/adapters/max-bot/max-webhooks.controller.ts), [mango.controller.ts](../../backend/src/modules/ingest/adapters/phone-call/mango.controller.ts) — нет Zod, нет `@UseGuards`, нет проверки подписи. Сравнить с [livekit-signature.verifier.ts](../../backend/src/modules/webhooks/livekit-signature.verifier.ts) (есть и протестировано).
5. **`@Body() body: { ... }`** вместо Zod-DTO в [admin-economics.controller.ts:70](../../backend/src/modules/admin/economics/admin-economics.controller.ts#L70), [clones.controller.ts:148](../../backend/src/modules/clones/clones.controller.ts#L148), [curation.controller.ts:189](../../backend/src/modules/curation/curation.controller.ts#L189).
6. **Public share без rate-limit и без spec.** [public-share.controller.ts](../../backend/src/modules/shares/public-share.controller.ts) — токен из URL, нет throttle, нет тестов ротации/revocation. Риск брутфорса и утечки через `Referer`.
7. **director-dashboard, cards, decisions, ideas, insights, persons — нет controller-spec.** Типовая зона IDOR при чтении с `tenantId`. [director-dashboard.controller.ts](../../backend/src/modules/dashboard/director-dashboard.controller.ts), [cards.controller.ts](../../backend/src/modules/cards/cards.controller.ts) — оба M-changed.

### 2.3 Качество существующих тестов

Преимущественно **mock-only**: Prisma и внешние клиенты (Livekit, S3, Anthropic, Vox) — `vi.fn()`. Быстрое CI, но не ловит проблемы Prisma-схемы, transactional-границ, pgvector-запросов, FSM-инвариантов. Controller-spec проверяют делегирование, не Zod-валидацию, не RBAC, не TenantGuard. E2E с поднятым Nest-приложением **нет**; есть единичные `*.integration.spec.ts` в probe/dialog-layer/knowledge-core. Типовые пропуски: пустой tenant, гость без user-id, конкурентные апдейты, transactional rollback, тайм-зоны, 4xx/5xx/timeout внешних API. **13 `describe.skip` создают ложное ощущение покрытия.**

### 2.4 Приоритеты покрытия (TOP-5)

1. **knowledge-core/api** — controller + service integration на реальной БД с pgvector.
2. **RBAC + TenantGuard матрица** — табличный тест: каждая роль × каждый критичный эндпоинт.
3. **Entitlements/quotas-gating** — юнит на декоратор + e2e на 3-4 эндпоинта с разными тарифами.
4. **Подпись и валидация webhooks** — telegram/max/mango: Zod-DTO, подпись / IP-whitelist, spec.
5. **FSM встречи end-to-end** — интеграция от create → start → join → record → end → AI-job на реальном Postgres.

---

## 3. Дизайн светлой темы — финальный концепт

### 3.1 Brand hue — **sage-green с тёплым уклоном**

`oklch(0.62 0.07 155)` ≈ `#7CA890`. Семантика «память, мудрость, спокойная глубина» совпадает с категорией «память компании», выделяет Z из стартап-моря (где доминируют фиолетовый AI и indigo SaaS), не конкурирует с pastel-семантикой по hue-углу. Фиолетовый — «как у всех AI», терракот плохо читается на диаграммах, mint — текущий и «уже не звучит».

Base accent `#7CA890`, hover `#5E8E76`, on-accent text `#0F1A14`.

### 3.2 Палитра OKLCH

| Token | OKLCH | HEX | Роль |
|---|---|---|---|
| bg-canvas | `0.985 0.005 85` | #F8F6F2 | warm off-white фон |
| bg-surface | `0.975 0.006 85` | #F3F1ED | sidebar (светлее контента) |
| bg-elevated | `1.000 0 0` | #FFFFFF | карточки, modal |
| bg-subtle | `0.955 0.008 85` | #ECE9E3 | hover, skeleton |
| text-primary | `0.22 0.01 60` | #1F1B17 | warm charcoal |
| text-secondary | `0.45 0.012 70` | #5B544C | |
| text-tertiary | `0.62 0.012 75` | #8C857B | |
| text-disabled | `0.78 0.008 75` | #B8B2A8 | |
| border-subtle | `rgba(31,27,23,.05)` | | |
| border | `rgba(31,27,23,.09)` | | |
| border-strong | `rgba(31,27,23,.18)` | | |
| accent-500 | `0.62 0.07 155` | #7CA890 | **brand** |
| accent-600 | `0.54 0.07 155` | #5E8E76 | hover |
| accent-100 | `0.93 0.022 155` | #DCE7DF | chip-bg |

Полная шкала accent-50…900 — в отчёте Трека 3.

**Pastel-семантика (фон / текст одного hue, все на L≈0.92-0.93):**

| Token | bg | fg |
|---|---|---|
| chip-success (sage) | #D6E8D8 | #3E6A4A |
| chip-warning (peach) | #F2E0C9 | #8A5A1F |
| chip-danger (rose) | #F4D8D2 | #8E3528 |
| chip-info (sky) | #D5E1EF | #2A567E |
| chip-lavender | #E3D8EE | #5E3F86 |
| chip-sand (нейтральный) | #E8E2D6 | #6B5E48 |

**Тени:**
- `shadow-card-soft: 0 1px 2px rgba(31,27,23,.04), 0 1px 3px rgba(31,27,23,.06)`
- `shadow-card-raised: 0 2px 4px rgba(31,27,23,.04), 0 8px 24px rgba(31,27,23,.08)`
- `shadow-modal: 0 12px 28px rgba(31,27,23,.10), 0 32px 64px rgba(31,27,23,.16)`

### 3.3 Скругления — рекомендация 2026

| Сейчас | Новое | Применение |
|---|---|---|
| xs 4 | **6** | input-помощники |
| sm 6 | **8** | chips, badges |
| md 10 | **12** | кнопки, inputs |
| lg 16 | **18** | вторичные карточки |
| xl 24 | **22** | главные карточки, KPI |
| 2xl 32 | **28** | hero, modal |
| pill | 999 | таб-навигация, фильтры |

### 3.4 Sexy-приёмы (light, 2026)

1. **OKLCH-палитра с равной воспринимаемой светлотой pastel** — все chip-bg на `L≈0.92-0.93` выглядят как одна семья.
2. **Бордерлесс-карточки с двойной мягкой тенью** — hover поднимает до `shadow-card-raised` за 120 мс.
3. **Один dark stat-card как якорь** на странице с 4-6 KPI (приём UGC Creator OS, Stripe Sigma).
4. **Sidebar светлее канвы + цветные dot-маркеры 6px** слева от активного пункта.
5. **Micro-glow на focus вместо ring-2** — `box-shadow: 0 0 0 3px oklch(0.62 0.07 155 / .22)`.
6. **Sparklines без осей в каждом KPI** — h=28px, stroke 1.5, accent-400 @ 65% opacity + linear-gradient area-fill.
7. **Soft-grain noise overlay 1%** SVG turbulence на canvas — «бумажная» текстура.
8. **Один easing `cubic-bezier(0.16, 1, 0.3, 1)` 240 мс на весь продукт** — почерк.

### 3.5 Пилот

**Отдельная страница `frontend/app/(design-preview)/light-theme/page.tsx`** — галерея компонентов в новой теме. Причины: (1) дашборд CEO сейчас активно меняется по контенту; (2) preview-страница — один URL для согласования; (3) после утверждения галереи миграция дашборда становится механической.

Срок: 1 день галерея + 0.5 дня токены, потом дашборд CEO — 0.5 дня.

---

## 4. Дизайн тёмной темы — аудит и sexy-предложения

### 4.1 Что сильно сейчас

Слои `#0a0e14 → #11161e → #161d26 → #1b232e` ([tokens.css:12-15](../../frontend/src/ui/tokens.css#L12-L15)) — 4 чётких уровня глубины, как у Linear/Vercel. Mint `#5EEAD4` нейтральный, не утомляет. CSS-vars + `darkMode: ['class', '[data-theme="dark"]']` — образцовая основа.

### 4.2 Что слабо

1. **Bg плоский, нет depth-cue.** Слои чисто сине-серые, нет tonal warm/cool сдвига.
2. **Glass-эффект объявлен, но не применён.** [tailwind.config.ts:78-81](../../frontend/tailwind.config.ts#L78-L81) — `--blur-glass` существует, но Sidebar / Dashboard header его не используют ([DirectorDashboardClient.tsx:107](../../frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx#L107) без `backdrop-blur`).
3. **Borders — чисто-белые `rgba(255,255,255,0.06/0.1/0.18)`** — в 2026 читается как Bootstrap. Тренд — tinted borders (ловят цвет accent).
4. **`shadow-glow-mint` навешен где попало** — на бейдж логотипа ([Sidebar.tsx](../../frontend/src/ui/components/app-shell/Sidebar.tsx)) выглядит как игровой UI; на active nav-item glow отсутствует.
5. **Mint `#5EEAD4` — `healthcare/Notion-AI` оттенок**, уже носят Tailwind Labs, Resend, десяток AI-стартапов.
6. **Accent-states однотонные** — `--accent-muted: rgba(94,234,212,0.12)` плоский, без gradient/inner-ring.
7. **Status-цвета (`#4ade80/#fbbf24/#f87171/#60a5fa`)** — сырые Tailwind 400-shades, ярче основной палитры → визуальные пятна.
8. **Skeleton-shimmer линейный 1.5s** ([tokens.css:178](../../frontend/src/ui/tokens.css#L178)) — архаизм; современный dark идёт на subtle pulse / ghost-skeleton.
9. **Scrollbar 10px серый и плотный.** Linear/Arc — overlay 6px на hover.

### 4.3 Brand accent в dark — рекомендация

**Менять mint мягко, не на violet.** Категория «память» не должна быть «AI-токсично-неоновой».

- **Базовый вариант:** `--accent: oklch(0.84 0.13 168)` ≈ `#6FEAC8` — тот же mint-семантический, на 8% теплее и насыщеннее.
- **Sexy-вариант (если готовы на ребрендинг M9):** `oklch(0.82 0.16 152)` ≈ `#7BE89B` sage-lime — выделяется от всех конкурентов, отлично в dark glow.
- **Парность со светлой:** light-accent остаётся `oklch(0.58 0.13 168)` ≈ `#14B8A6` deeper — связка читается.

### 4.4 Sexy-приёмы (dark, 2026)

1. **Tonal warm-shift по слоям.** `--bg-base: oklch(0.16 0.012 250)` ≈ `#0B0F16`, `--bg-elevated: oklch(0.19 0.014 250)`, `--bg-card: oklch(0.22 0.016 250)`.
2. **Inset top-highlight на cards** — токен `--ring-edge-top: inset 0 1px 0 rgba(255,255,255,0.05)` на shadcn-card. Vercel-style «зеркальный край».
3. **Coloured shadow вместо чёрной** — `--shadow-elevated: 0 12px 32px -8px rgba(94,234,212,0.08), 0 4px 12px rgba(0,0,0,0.4)`. Едва уловимый mint-aura.
4. **Frosted-glass sticky header** на дашборде: `sticky top-0 backdrop-blur-glass bg-bg-base/72 border-b border-border-subtle`. Использует уже объявленный `--blur-glass`.
5. **Accent-glow на active nav-item** — gradient `bg-gradient-to-r from-accent-muted-strong to-accent-muted` + `shadow-[inset_2px_0_0_var(--accent),0_0_20px_-4px_rgba(94,234,212,0.25)]`.
6. **Gradient-border на CTA «Создать встречу»** — `border-image: linear-gradient(135deg, var(--accent), oklch(0.74 0.17 200)) 1`.
7. **Film-grain overlay 2-3%** SVG-noise через `body::before`, `mix-blend-mode: overlay`. ~2KB inline. Убирает «пластиковость».
8. **`--shadow-glow-mint` → `--shadow-accent-focus`** и применять только на `focus-visible` + hover CTA. С логотипа убрать. Glow должен быть редкостью, иначе обесценивается.

---

## 5. Roadmap (предложение)

Не запускаем всё сразу. Жирно расставляю приоритеты — заказчик решает порядок.

### Фаза A — UI scaffold + дизайн-токены (3-4 дня)
- Универсальный `<QueryGate>` / `useSwrWithToast` — закрыть проблемы A/B из §1.3.
- Унифицировать toast (выбрать sonner или legacy, мигрировать остальное).
- Починить `EmptyState` под тёмную тему.
- Переписать [tokens.css](../../frontend/src/ui/tokens.css) на OKLCH с warm-сдвигом в dark, sage в light.
- Сделать `(design-preview)/light-theme` галерею.

### Фаза B — критическое покрытие API (3-4 дня)
- knowledge-core/api integration spec на реальном Postgres + pgvector.
- RBAC × TenantGuard матрица.
- Подпись и Zod-DTO для telegram/max/mango webhooks.
- Rate-limit + spec на public-share.

### Фаза C — Пилот sexy-стиля (2 дня)
- Дашборд CEO: KPI strip + sparklines + dark stat-card как якорь + frosted-glass sticky header + sage в светлой / mint+glow в тёмной.

### Фаза D — Чистка hardcoded цветов (1-2 дня, параллельно)
- ~260 совпадений `bg-(red|green|...)-{50..900}` → semantic tokens.
- Заменить нативные `alert/confirm` на shadcn-dialog.

### Фаза E — Mobile + a11y (2-3 дня, можно отложить)
- Mobile-варианты master-detail в meetings/cards/themes.
- Aria-label на все icon-кнопки.

---

## 6. Открытые вопросы для пользователя

1. **Брать sage в светлую тему?** Альтернатива — оставить mint и в светлой (тогда минимальное изменение, но «не звучит»).
2. **Менять ли mint в тёмной?** Безопасный warm-mint `#6FEAC8` (минимальный ребрендинг) или sage-lime `#7BE89B` (выделение, но ребрендинг M9).
3. **Какие фазы Roadmap делаем первыми?** Предлагаю A+B параллельно (две независимые ветки), потом C.
4. **Делаем ли responsive (Фаза E)?** Если Z в основном desktop B2B — можно отложить.

---

## 7. Полные исходные отчёты агентов

Полные отчёты Трека 1 (UI), Трека 2 (API), Трека 3 (light), Трека 4 (dark) — в истории чата сессии 2026-05-24. Они избыточно подробны для постоянного хранения; в этом файле — конденсированная выжимка.
