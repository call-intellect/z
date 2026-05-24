# Интерфейс / UI / дизайн-система — светлая тема Z (исследование)

**Дата:** 2026-05-23
**Раздел:** интерфейс / frontend / UI / дизайн-система / светлая тема
**Теги для поиска:** интерфейс, UI, дизайн, design system, светлая тема, тёмная тема, токены, палитра, цвета, sidebar, дашборд, карточки, типографика, frontend
**Статус:** research / discovery (до ТЗ)
**Триггер:** пользователь прислал 7 скриншотов прототипа UGC Creator OS как референс желаемого визуального языка светлой темы.

> Это **research-файл**, не план реализации. Когда определимся с brand hue и пилотной страницей — на его основе пишется отдельный `plans/tz/YYYY-MM-DD-light-theme-design-language.md`.

---

## 1. Источник вдохновения (mood-board)

### 1.1 Референс — UGC Creator OS (7 скриншотов от пользователя)

Прототип мобильного приложения для контент-мейкера (iPhone 375×812), показанный в десктопном HTML-виде с боковой навигацией. Скриншоты не приложены в репо — хранятся в чате.

**Семь экранов:**
1. Grid приложений (Brain, Carousel, Life Design, Prompt Vault, BugSnap, UGC Creator OS, Brief, Network OS, PopUpPlayer, Колесо баланса, MLM, Carousel Studio, Car, Money, Plate).
2. Список задач с группировкой (КОНТЕНТ / БРЕНДЫ / ЛИЧНОЕ / БУХГАЛТЕРИЯ) и pastel-статусами «Тревога / ОК / Кошмар».
3. CRM «Бренды» — pipeline (Новый лид / Переговоры / Бриф / В работе) + список брендов с pastel-монограммой и pastel-статусом.
4. «Идеи» — pill-табы (Все / Идея / В работе / Опубликовано / Архив) + INBOX-поле с голосовым вводом + список идей с хэштегами.
5. Bottom sheet «Создать что-то» с pastel-иконками.
6-7. Desktop-вид того же прототипа — sidebar слева с группами (ГЛАВНЫЕ / БИЗНЕС / КОНТЕНТ / СОЗДАНИЕ), главный экран с stat-cards (Instagram pastel, **TikTok dark — контрастный якорь**), «Активные сделки» (горизонтальная карусель), «Финансы» с sparkline, «Свежие новости».

### 1.2 Что объединяет — visual language

- **Warm off-white фон** (`~#F8F6F3`), не cold white. Тёплый peach/cream undertone.
- **Бордерлесс-карточки** — иерархия через светлоту + двухслойная мягкая тень, не через рамки.
- **Pastel-семантика** — каждый статус = пара «фон + текст одного hue, разнесённые по lightness». Никакого «цветной фон + чёрный текст».
- **Один dark stat-card** на странице как визуальный якорь (TikTok-карточка). Правило: не больше 1 на ~5 светлых.
- **Skругления крупные** — 20-22px на карточках, pill для табов, 8-10px на чипах.
- **Типографика** — SF Pro / Inter, минимум весов, текст charcoal `~#1A1A1A` (не чёрный).
- **Sidebar светлее основного контента** (контр-интуитивно, но даёт ощущение «бумаги поверх стола»).
- **Sparklines** в каждой metric-карточке (без осей, без сетки).
- **Inline-чипы внутри карточки** для самого важного (срок + сумма) — максимум 2 на карточку.
- **Brand hue приглушён, monochromatic** — все «выделения» оттенки одного цвета, а pastel-семантика — отдельный слой.

### 1.3 Подтверждение из индустрии 2026

Тот же тренд — переход с холодного blue-grey на тёплый серый, LCH/OKLCH вместо HSL, бордерлесс-карточки. Источники:

- [Behind the latest design refresh — Linear](https://linear.app/now/behind-the-latest-design-refresh) — мартовский UI refresh 2026: тёплый серый, LCH, sidebar светлее контента, иконки уменьшены, бордеры смягчены.
- [UI refresh changelog 12 мар 2026 — Linear](https://linear.app/changelog/2026-03-12-ui-refresh)
- [How we redesigned the Linear UI (part II) — Linear](https://linear.app/now/how-we-redesigned-the-linear-ui)
- [A Linear spin on Liquid Glass — Linear](https://linear.app/now/linear-liquid-glass) — вектор эволюции (пока не для Z).
- [Dashboard Design Visual Guide (Vercel)](https://how-to-dashboard.vercel.app/) — три типа дашбордов (Operational / Analytical / Strategic), 12-col grid, base-8 spacing, KPI = label + big number + delta + sparkline.
- [Dashboard Design Patterns for Modern Web Apps 2026 — Art of Styleframe](https://artofstyleframe.com/blog/dashboard-design-patterns-web-apps/) — sidebar 256/64px, item 36px, KPI 200-280px, главное число 28-32px. **«Shipping without dark mode in 2026 is a real usability gap».**
- [Vercel dashboard navigation redesign rollout](https://vercel.com/changelog/dashboard-navigation-redesign-rollout) — фев 2026.
- [Mobile App Design Trends 2026 — Muzli](https://muz.li/blog/whats-changing-in-mobile-app-design-ui-patterns-that-matter-in-2026/).
- [Linear Design System (Figma, 2024)](https://www.figma.com/community/file/1222872653732371433/linear-design-system) — устарел, но структура полезна.
- [Geist Theme Switcher — Vercel](https://vercel.com/geist/theme-switcher) — реальные публичные токены для подсматривания структуры.

---

## 2. Аудит текущего UI Z (по состоянию на 2026-05-23)

### 2.1 Сильные стороны (переиспользуем)

- **Токенная архитектура чистая.** [frontend/src/ui/tokens.css](../../frontend/src/ui/tokens.css) → [frontend/tailwind.config.ts](../../frontend/tailwind.config.ts) → utility-классы через `var(--*)`. Переключение темы — атрибут `data-theme` на `<html>` без перерендера.
- **Семантические токены правильно названы:** `bg-{base/elevated/card/overlay}`, `fg-{primary/secondary/tertiary}`, `accent-{muted/border/...}`, `success/warning/danger/info`.
- **[ThemeProvider.tsx](../../frontend/src/ui/components/theme/ThemeProvider.tsx)** — стандартный паттерн, persist в `localStorage['z-theme']`, `system` через `matchMedia`. `defaultTheme = 'dark'`.
- **[Sidebar.tsx](../../frontend/src/ui/components/app-shell/Sidebar.tsx) — 248px**, очень близко к индустриальному 256. Структура (Logo → OrgSwitcher → CTA → 3 группы + admin-подгруппа → UserCard) совпадает с референсом UGC Creator OS концептуально.
- **Uppercase tracking-wider labels** для групп — точно как в референсе.
- **⌘K command palette** уже глобально подмонтирован в [AppShell.tsx](../../frontend/src/ui/components/app-shell/AppShell.tsx).

### 2.2 Что не сделано для светлой темы

**Текущий light-блок [tokens.css:88-121](../../frontend/src/ui/tokens.css#L88-L121):**

```css
--bg-base:     #ffffff;   /* cold pure white */
--bg-elevated: #f8fafb;   /* tailwind slate-50 */
--bg-card:     #ffffff;   /* = bg-base → нет иерархии */
--bg-overlay:  #f3f4f6;
--text-primary:   #0f172a;  /* slate-900, холодный */
--text-secondary: #475569;  /* slate-600 */
--accent:      #14b8a6;     /* teal-500, холодный mint */
--success: #16a34a; --warning: #d97706; --danger: #dc2626;  /* saturated */
```

**Различия с референсом / индустрией:**

| Параметр | Сейчас в Z | Референс 2026 |
|---|---|---|
| `bg-base` | `#ffffff` cold | `~#F8F6F3` warm off-white |
| `bg-card` vs `bg-base` | равны → нет иерархии | На 2-4% светлее/темнее + soft shadow |
| Текст | Холодный slate | Тёплый charcoal `~#1A1A1A` |
| Brand accent | `#14B8A6` mint, холодный | Тёплый hue (TBD) |
| Статусы | Saturated 1-color | Pastel-пары фон+текст одного hue |
| Карточки | shadcn `border + shadow` | Бордерлесс, двухслойная мягкая тень |
| Радиусы | `lg=16 / xl=24 / 2xl=32` | Карточки 20-22, кнопки 12-14, чипы 8-10 |
| Цветовое пространство | HEX | OKLCH (для равной воспринимаемой светлоты pastel) |

**Sidebar в light:**
- Логотип Z `bg-accent text-accent-fg shadow-glow-mint` ([Sidebar.tsx:267](../../frontend/src/ui/components/app-shell/Sidebar.tsx#L267)) — glow нелеп в светлой теме.
- Active state `bg-accent-muted` = mint-rgba-0.1 на белом → почти невидимая бледная подсветка.
- Нет цветных dot-маркеров слева от пунктов (есть в референсе).

**Дашборд [DirectorDashboardClient.tsx](../../frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx):**
- `max-w-6xl` (1152px) — узко для 2026 (норма 1280-1440).
- Нет верхней KPI-strip с 4-6 числами крупно. Сразу grid 2-col виджетов.
- Нет sparklines.
- Нет dark stat-card как визуального якоря.
- AI-сводка через mint-tint → в light почти невидимая.
- Ошибки используют `border-red-200 bg-red-50 dark:...` напрямую — **обход semantic tokens**.

### 2.3 Главная грабля миграции

**261 hardcoded tailwind-цвет в 30+ файлах** (поиск `(bg|text|border)-(red|green|blue|amber|...)-\d{2,3}`).

Топ по плотности:
- [admin/ai-models/*](../../frontend/app/(admin)/admin/ai-models/) — ~80 случаев
- [admin/prompts/*](../../frontend/app/(admin)/admin/prompts/) — ~50 (свежий код 2026-05-21)
- [DirectorDashboardClient.tsx](../../frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx) и виджеты — 10+
- [m/[id]/MeetingPageShell.tsx](../../frontend/app/(public)/m/%5Bid%5D/MeetingPageShell.tsx), lobby, meeting-room — точечно

→ переписать только [tokens.css](../../frontend/src/ui/tokens.css) недостаточно. Отдельная фаза вычистки.

---

## 3. Открытые вопросы (нужны ответы пользователя до старта ТЗ)

1. **Brand hue для светлой темы:**
   - фиолетовый (как референс UGC, ассоциация с AI/интеллектом),
   - sage / тёмно-зелёный (память, мудрость, редкий — выделит из стартап-моря),
   - тёплый терракот (записные книжки, «человеческий»),
   - оставить mint, но потеплее (минимальное изменение, ломает меньше всего).
2. **Где пилотим тему:** новая страница `(design-preview)/light-theme` (галерея компонентов) или сразу [DirectorDashboardClient.tsx](../../frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx) (он сейчас в работе).
3. **Темп миграции:** сначала закончить light до конца → потом dark в OKLCH, или сразу делать оба в один проход.

---

## 4. Предполагаемые фазы реализации (до утверждения hue)

- **Фаза 1 — токенный слой (2-3 ч).** Переписать light-блок [tokens.css](../../frontend/src/ui/tokens.css): warm off-white, тёплый charcoal, новый brand hue, pastel-семантика 8 статусов в OKLCH. Добавить `bg-subtle`, `chip-{success/warning/danger/info/lavender/peach/sky/sage}-{bg/fg}`, `shadow-card-soft`.
- **Фаза 2 — компоненты-обёртки (4-6 ч).** `<StatCard variant="default|dark" />` со sparkline, `<Chip variant />` поверх shadcn-badge, бордерлесс-вариант shadcn-card, адаптация [Sidebar.tsx](../../frontend/src/ui/components/app-shell/Sidebar.tsx) (убрать glow в light, добавить dot-маркеры).
- **Фаза 3 — пилот на одной странице (1 день).** KPI strip + sparklines + новые компоненты на [DirectorDashboardClient.tsx](../../frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx).
- **Фаза 4 — вычистка hardcoded цветов (1-2 дня, параллельно).** 30 файлов из аудита.

---

## 5. Связанные файлы

- [frontend/src/ui/tokens.css](../../frontend/src/ui/tokens.css) — токены
- [frontend/tailwind.config.ts](../../frontend/tailwind.config.ts) — маппинг
- [frontend/src/ui/components/theme/ThemeProvider.tsx](../../frontend/src/ui/components/theme/ThemeProvider.tsx)
- [frontend/src/ui/components/app-shell/AppShell.tsx](../../frontend/src/ui/components/app-shell/AppShell.tsx)
- [frontend/src/ui/components/app-shell/Sidebar.tsx](../../frontend/src/ui/components/app-shell/Sidebar.tsx)
- [frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx](../../frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx)
- Предыдущий дизайн-документ (источник текущей темы): `plans/analysis/2026-05-09-ai-meeting-workspace-design.md`
