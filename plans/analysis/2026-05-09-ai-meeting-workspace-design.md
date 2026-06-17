---
type: analysis
status: draft
feature: ai-meeting-workspace-design
date: 2026-05-09
---

# Дизайн-эталон: AI Meeting Workspace

> Связанные документы:
> - Анализ скоупа: [plans/analysis/2026-05-09-ai-meeting-workspace.md](plans/analysis/2026-05-09-ai-meeting-workspace.md)
> - ТЗ: [plans/archive/2026-05-09-ai-meeting-workspace.md](plans/archive/2026-05-09-ai-meeting-workspace.md)
> - Дизайн-система-база: [plans/archive/2026-05-09-standalone-product.md](plans/archive/2026-05-09-standalone-product.md) (Фаза 1 — shadcn/ui scaffolding)

## Что хотим сделать

Зафиксировать визуальную идентичность, типографику, цветовую палитру, motion-язык и кастомные дизайнерские паттерны AI Meeting Workspace **до** старта реализации страниц. Документ описывает «как должно выглядеть» одной эталонной страницей (страница встречи), под которую потом калибруется весь остальной кабинет.

## Зачем

shadcn/ui как библиотека даёт **нейтральную базу**. На ней можно построить и Linear, и Notion, и Microsoft Teams — внешний вид зависит от того, что мы поверх неё положим: токены, типографика, моушн, уникальные паттерны. Без явного дизайн-языка получится «дефолтный shadcn» — это читается как «MVP, ещё не доделали внешний вид». Заявка владельца продукта была явная: **«современный, хороший, секси дизайн интерфейса»**. Этот документ — попытка перевести её в конкретные числа и решения.

## Direction

**Dark-first minimalism + electric mint accent + Geist typography + glass-cards для AI-цитат.**

Одной фразой: «как Linear / Cursor / Vercel Dashboard, но со своим характером — mint-акцентом и AI-glass-cards как уникальной фишкой».

### Почему именно так

1. **Целевая аудитория.** Sales-менеджеры / тимлиды / custdev-исследователи / B2B-decision-makers — все уже работают в Linear, Cursor, Notion, Vercel, Arc. Это их визуальный язык. Когда продукт в нём — он сразу читается как «свой», как «я знаю, что это качественный инструмент».
2. **Тёмный режим — банально удобнее для meeting-tool.** Юзер смотрит часовые записи. Светлый фон выжигает глаза. Все профессиональные video-tools (Descript, Riverside, Frame.io) имеют dark-режим как default.
3. **Mint в качестве акцента — нишевый и узнаваемый.** Синий уже у Linear/Slack/Notion/Microsoft, фиолетовый — у Cursor, оранжевый — у Cron/Mux, красный — у Asana/Airbnb. Mint (`#5EEAD4`) встречается реже, читается как «свежий», «AI/biotech», даёт продукту узнаваемость в скриншотах. На дип-нейви даёт максимальный контраст и hi-tech-ощущение.
4. **Geist (от Vercel, MIT) — современный и не-выгоревший шрифт.** Inter уже везде и стал «дефолтом», Söhne платный, Helvetica устарел. Geist Sans + Geist Mono читается как «продукт 2025+», даёт «дизайнерское» ощущение без artsy-перебора.
5. **Glass-cards для AI-цитат — уникальный паттерн, который запомнится.** Когда AI отвечает в чате с цитатой из транскрипта, цитата рендерится не как обычный quote-блок, а как полупрозрачная карточка с blur-эффектом и mint-границей. Это «фирменный» элемент — никто не делает так в meeting-tools. В скриншотах сразу видно, что это «тот продукт со mint-цитатами».

## Brand Identity

### Logotype

На старте — текстовый логотип `Z` в Geist Sans Bold с mint-акцентом на букве. Размер в шапке sidebar — 28px, weight 700, letter-spacing -0.02em.

В V2 — заказать иконку у дизайнера (можно стилизованная Z с mint-вариацией).

### Typography

| Роль | Шрифт | Настройки |
|---|---|---|
| Display (hero, h1) | Geist Sans 600 | letter-spacing -0.02em, line-height 1.1 |
| Heading (h2/h3) | Geist Sans 600 | letter-spacing -0.01em, line-height 1.2 |
| Body | Geist Sans 400 | letter-spacing 0, line-height 1.5 |
| Body-emphasis | Geist Sans 500 | letter-spacing 0, line-height 1.5 |
| UI (button, label) | Geist Sans 500 | letter-spacing 0, line-height 1 |
| Caption / Hint | Geist Sans 400 | letter-spacing 0, line-height 1.4, opacity 0.7 |
| Mono (timestamps, API keys, JSON, code) | Geist Mono 400 | letter-spacing 0, line-height 1.5 |

**Размерная шкала** (rem от base 16px):
```
text-xs   12px
text-sm   13px
text-base 14px (default body)
text-md   15px
text-lg   17px
text-xl   20px
text-2xl  24px
text-3xl  32px (display)
text-4xl  48px (hero)
```

### Цветовая палитра

#### Dark mode (default)

| Token | Hex / RGBA | Использование |
|---|---|---|
| `--bg-base` | `#0A0E14` | основной фон страницы |
| `--bg-elevated` | `#11161E` | sidebar, header, sticky-панели |
| `--bg-card` | `#161D26` | карточки, диалоги |
| `--bg-overlay` | `#1B232E` | hover-state карточек |
| `--border-subtle` | `rgba(255,255,255,0.06)` | разделители, низкий контраст |
| `--border-default` | `rgba(255,255,255,0.10)` | стандартные границы |
| `--border-strong` | `rgba(255,255,255,0.18)` | input, button outline |
| `--text-primary` | `#E8EAED` | основной текст |
| `--text-secondary` | `#A0A6B0` | вторичный текст, captions |
| `--text-tertiary` | `#6B7280` | placeholder, disabled |
| `--accent` | `#5EEAD4` | mint — все CTA, акценты, ссылки |
| `--accent-hover` | `#7CF2DD` | hover-state mint |
| `--accent-muted` | `rgba(94,234,212,0.12)` | mint-фон карточек, glass |
| `--accent-border` | `rgba(94,234,212,0.28)` | mint-границы glass-cards |
| `--accent-glow` | `0 0 24px rgba(94,234,212,0.30)` | glow-эффект |
| `--success` | `#4ADE80` | успешные статусы |
| `--warning` | `#FBBF24` | предупреждения |
| `--danger` | `#F87171` | ошибки, удаление |
| `--info` | `#60A5FA` | информационные плашки |

#### Light mode

| Token | Hex |
|---|---|
| `--bg-base` | `#FFFFFF` |
| `--bg-elevated` | `#F8FAFB` |
| `--bg-card` | `#FFFFFF` |
| `--bg-overlay` | `#F3F4F6` |
| `--border-subtle` | `rgba(0,0,0,0.05)` |
| `--border-default` | `rgba(0,0,0,0.10)` |
| `--border-strong` | `rgba(0,0,0,0.18)` |
| `--text-primary` | `#0F172A` |
| `--text-secondary` | `#475569` |
| `--text-tertiary` | `#94A3B8` |
| `--accent` | `#14B8A6` (slightly darker mint для контраста на белом) |
| `--accent-hover` | `#0D9488` |
| `--accent-muted` | `rgba(20,184,166,0.10)` |

### Радиусы

```
--radius-xs  4px   (badges, pills, tags)
--radius-sm  6px   (inputs, small buttons)
--radius-md  10px  (default — cards, buttons)
--radius-lg  16px  (modals, large cards)
--radius-xl  24px  (video player, hero blocks)
```

### Тени (только в light-mode + selectively в dark)

```
--shadow-soft     0 1px 2px rgba(0,0,0,0.05)
--shadow-elevated 0 8px 24px rgba(0,0,0,0.12)
--shadow-modal    0 24px 48px rgba(0,0,0,0.24)
--shadow-glow-mint 0 0 24px rgba(94,234,212,0.30)
```

В dark-режиме **не используем box-shadow** для разделения слоёв (тени на тёмном выглядят грязно). Вместо них — изменение `bg-elevated` / `bg-card` / `bg-overlay`.

### Blur и glass

```
--blur-glass  blur(12px) saturate(1.4)
--blur-modal  blur(8px)
```

Glass применяется **только** к: AI-цитатам, sticky-headers с прозрачным фоном, command-palette overlay.

### Spacing scale

```
--space-1   4px
--space-2   8px
--space-3   12px
--space-4   16px
--space-5   20px
--space-6   24px
--space-8   32px
--space-10  40px
--space-12  48px
--space-16  64px
```

### Layout grid

- 12-column grid с gutter 24px.
- Page padding: 24px (mobile), 40px (tablet 768+), 64px (desktop wide 1280+).
- Three-column layout (страница встречи):
  - Левая колонка: 280px фиксированная.
  - Центральная: flex.
  - Правая (AI-чат): 380px, collapsible через toggle.
- Sidebar AppShell: 240px expanded / 64px collapsed.
- Max content width: 1440px (centered).

## Motion language

### Library

**Framer Motion** (`motion/react`, MIT). Не Motion One, не GSAP — именно Framer Motion, потому что:
- Native React API.
- Поддержка shared layout transitions (нужно для tabs).
- spring presets из коробки.
- AnimatePresence для unmount-анимаций.

### Базовые presets

```ts
const SPRING_DEFAULT = { type: 'spring', stiffness: 300, damping: 30 };
const SPRING_BOUNCY  = { type: 'spring', stiffness: 400, damping: 22 };
const EASE_OUT_EXPO  = [0.16, 1, 0.3, 1];
const DURATION_DEFAULT = 0.24;
const DURATION_FAST    = 0.12;
const DURATION_SLOW    = 0.4;
```

### Каталог микро-интеракций

| # | Где | Как |
|---|---|---|
| 1 | Page transition | fade + translateY -8px → 0, 240ms ease-out-expo |
| 2 | Tab switch | shared `<motion.div>` indicator с `layoutId`, smooth slide |
| 3 | Modal / dialog open | scale 0.95 → 1 + opacity 0 → 1, spring default |
| 4 | Sidebar collapse | width spring (240ms) + content opacity step |
| 5 | AI-chat message in (assistant) | typing effect 30 chars/sec + soft fade per char |
| 6 | AI-chat message in (user) | scale 0.96 → 1 + fade, 160ms |
| 7 | AI-citation card appear | scale 0.98 → 1, opacity 0 → 1, плюс subtle mint glow pulse 600ms |
| 8 | AI-citation hover | scale 1.02, mint glow opacity 0.3 → 0.6, 200ms |
| 9 | Timeline marker hover | scale 1.5, tooltip fade-in delay 200ms |
| 10 | Timeline marker click | pulse expand-fade ring (200ms) + scrubber jump |
| 11 | Task complete | strikethrough draws 280ms left-to-right + checkbox ring expand (mint) |
| 12 | Task added | fade-in + height auto + slide from -8px |
| 13 | Toast | slide-in from top-right + spring default |
| 14 | Skeleton | linear gradient sweep 1.5s loop, opacity 0.05 → 0.12 |
| 15 | Button hover | bg-color transition 120ms, **без scale** (clean enterprise) |
| 16 | Button press | scale 0.98 на 80ms (tactile feedback) |
| 17 | Card hover (журнал) | bg-overlay transition 160ms + border-strong appearance |
| 18 | Chapter expand (accordion) | height auto transition 240ms ease-out-expo |
| 19 | Search command palette | scale 0.96 → 1 + opacity, spring default |
| 20 | Drawer (mobile) | slide-in from right + dimmer fade, spring |
| 21 | Tooltip | fade + scale 0.92 → 1, 120ms |
| 22 | Loading spinner | mint thin ring rotation 1s linear |
| 23 | Number counter (stats виджет) | tween 0 → value 600ms ease-out-expo |
| 24 | Progress bar (export) | width transition 240ms, mint fill |

### Reduced motion

Уважаем `prefers-reduced-motion`: все spring и tween-анимации заменяются на instant transitions, кроме критических feedback (button press, toast).

## Дизайн-эталон страница (страница встречи)

Эта страница — эталон, по которой калибруется весь остальной кабинет. Её делаем **первой** и **до ума**, остальные страницы повторяют её визуальный язык.

### Шапка

- Высота 72px, `bg-elevated` с `backdrop-filter: var(--blur-glass)`, position sticky top-0.
- Слева: breadcrumbs `Встречи / Демо для Acme Corp` (text-secondary).
- Центр: title `Демо для Acme Corp` в Display 24px (h1), inline-edit при клике; рядом — type badge mint-muted ("Sales") и Mono длительность `42:18`.
- Справа: кнопка `Поделиться` (mint outline), кнопка `…` (popover c Регенерировать / Экспорт / Удалить), avatar юзера.

### Левая колонка (280px sticky)

Три блока с отступом между ними 32px:

**Блок 1 — Smart chapters timeline:**
- Vertical список с тонкой mint вертикальной линией слева (1px).
- На текущей главе линия становится толще (2px) и заполнена mint, у соседних — `accent-muted`.
- Каждая глава: rounded pill 8x8px маркер на линии + title (text-base) + время в Mono ниже (text-xs text-secondary).
- Hover на главу — `bg-overlay`, текст становится primary.
- Click — плеер перематывается + центральная колонка скроллит к Chapters tab.
- На текущей главе — subtle pulse animation на маркере (600ms loop).

**Блок 2 — TOC секций отчёта:**
- Простой список ссылок (text-sm text-secondary).
- Активная — text-primary + mint left-border 2px.

**Блок 3 — Участники:**
- Аватарки (32px circle, на default — Geist Sans initial на mint-muted background) + имя + длительность речи в Mono (text-xs).
- Сортировка по времени речи desc.

### Центральная колонка

#### Видео-плеер (Vidstack кастомный)

- `border-radius: var(--radius-xl)` (24px).
- В dark — без явной рамки, край через `bg-card`.
- Высота — 9:16 ratio, max-height 480px desktop, full-width on mobile.
- Scrubber: 2px тонкая линия `border-default`, заполненная часть — mint. На hover скрабера — увеличивается до 4px, появляется time-tooltip над курсором с текущим тайм-кодом в Mono.
- Маркеры глав: rounded pills 6x18px, mint @ 40% opacity, при hover — увеличиваются до 8x22 и показывают title в floating-tooltip (Geist Sans 500 text-sm).
- Маркеры клипов: 8x8 точки с mint glow `var(--shadow-glow-mint)`.
- Controls: появляются по hover на video или auto при паузе. Минималистичный ряд: play/pause / volume / time `12:34 / 42:18` в Mono / speed (1x dropdown) / PIP / fullscreen. Все кнопки — 32x32 ghost, mint hover.
- Subtitles: Geist Sans 500 text-md, `bg-overlay` с `backdrop-filter: var(--blur-modal)`, padding 6x12, radius-sm.

#### Tabs

- 5 табов: Overview / Chapters / Transcript / Action Items / Notes.
- Underline-индикатор: 2px mint, smooth slide через `layoutId="tab-indicator"`.
- Текст таба: text-base text-secondary; активный — text-primary.
- Padding 12x16, gap между табами 4px.
- Под счётчиком таба — небольшая mint-pill с цифрой (`Action Items 7`, `Chapters 5`).

#### Tab content

**Overview:**
- Summary как первый блок, `bg-card` rounded-lg, padding 24px.
- Над Summary — мини-statistics row: `5 chapters • 7 tasks • 12 highlights • 42 min`.
- Отчёт по типу — карточки с заголовком секции в Geist Sans 500 text-md и контентом text-base.
- Follow-up email — отдельная карточка с monospace-preview и кнопкой `Скопировать` (правый top-corner).
- Каждая карточка — кнопка `…` в углу: Регенерировать / Скопировать / Отправить в...

**Chapters tab:**
- Hierarchical recap (DR2 из академического исследования).
- Каждая глава — collapse-able карточка `bg-card`. Header: Mono start-time + title + длительность.
- Раскрытая глава: rolling summary (text-base) + чекбоксы `key point` / `action item` slыcm для каждого пункта.
- Hover на пункт — кнопка «играть от этого момента» появляется справа.

**Transcript:**
- Список utterance: avatar + speaker + Mono timestamp + text.
- Текущая utterance во время воспроизведения — `bg-overlay` + mint left-border 2px.
- Click на utterance — перемотка плеера.
- Поиск над списком (`/` shortcut) — фильтрация по тексту, подсветка matches mint @ 40%.
- Возможность выделить интервал → появляется floating button `Создать клип`.

**Action Items:**
- Список карточек `bg-card` с soft padding.
- Каждая карточка: чекбокс (circular 18px, mint when checked) + title + меню `…`.
- Под title — chips: assignee (Mono name), due date (text-xs text-secondary), confidence indicator (3 mini-dots, mint filled).
- Раскрытая карточка: source quote + jump-to-time button + description-edit textarea.
- Snowy strikethrough animation при complete (28ms).
- Кнопка `+ Добавить вручную` внизу.
- Кнопка `Отправить все в...` (mint outline) — открывает destinations dialog.

**Notes:**
- Простая markdown-textarea (V1).
- Сохранение autosave каждые 2 сек, индикатор `сохранено` text-xs text-secondary.

### Правая колонка — AI-чат (380px collapsible)

- Toggle button в шапке `Скрыть чат` / `AI-помощник`.
- Header панели: `AI-помощник` (Geist Sans 500) + reset-кнопка (clear history).
- Список сообщений (auto-scroll в bottom):
  - User message: aligned right, max-width 80%, `bg-overlay`, padding 10x14, radius-md.
  - AI message: aligned left, transparent bg, padding 10x14.
  - AI typing indicator: 3 mint dots с staggered bounce (16ms gap).
- AI-цитаты:
  - Под AI-сообщением, если есть citations.
  - **Glass-card**: `background: var(--accent-muted)`, `backdrop-filter: var(--blur-glass)`, `border: 1px solid var(--accent-border)`, radius-md, padding 12.
  - Содержимое: Mono timestamp + speaker + cite text (text-sm).
  - Hover: scale 1.02, mint glow.
  - Click: плеер перематывается + ring pulse на цитате.
- Suggested prompts:
  - При пустой истории — список 3-5 кнопок-чипсов с типичными вопросами по типу встречи (`Какие были возражения?`, `Что мы решили?`).
  - Кнопки: `bg-overlay`, hover — `bg-card` + mint border.
- Input area:
  - Position fixed bottom внутри панели.
  - Multi-line textarea с auto-grow, max 6 строк.
  - Кнопка отправки — mint round, 32x32, иконка ➝ (Lucide arrow-up).
  - Enter — отправить, Shift+Enter — newline.

## Кастомные дизайнерские паттерны для AI

### AI-цитата (glass-card)

Главная фишка идентичности. Глобально применяется везде, где AI цитирует что-то из транскрипта (в чате, в Smart chapters, в action items source-quote).

```
┌──────────────────────────────────────┐
│  🕒 14:23  Иван                      │
│                                       │
│  «Мы готовы рассмотреть бюджет        │
│   до 500 тысяч в месяц, если          │
│   увидим ROI за 3 месяца.»            │
│                                       │
│         [▶ Перейти к моменту]        │
└──────────────────────────────────────┘
   bg: rgba(94,234,212,0.08)
   blur: 12px
   border: 1px solid rgba(94,234,212,0.28)
   hover-glow: 0 0 24px rgba(94,234,212,0.30)
```

### AI-typing indicator

Три mint-точки 6x6, staggered bounce анимация (каждая отстаёт на 80ms, амплитуда 4px вверх, 600ms loop).

### AI-chat error-state

Когда LLM упал, таймаут, все провайдеры в каскаде вернулись с ошибкой:

```
┌──────────────────────────────────────┐
│  ⚠  (warning-icon в text-secondary)  │
│                                       │
│  Не получилось сгенерировать ответ.   │
│  Попробуйте ещё раз через минуту.     │
│                                       │
│       [ Повторить ]  (mint outline)   │
└──────────────────────────────────────┘
```

- Сообщение остаётся в истории чата (`MeetingChatMessage` с `role=assistant`, `content="<error_marker>"`, отдельное поле `error: string?`).
- Click `Повторить` — пере-вызывает endpoint с тем же `message`. Не плодит юзерских сообщений.
- Если квота превышена — отдельный текст «Лимит запросов на сегодня исчерпан. Будет сброшен через X часов.» (без кнопки повторить).

### Confidence indicator на task

Под title задачи — три mini-dots 4x4. Заполнены mint в зависимости от confidence:
- 0.0–0.4: 1 dot
- 0.4–0.7: 2 dots
- 0.7–1.0: 3 dots
Незаполненные — `border-default` outline.

### Smart chapter — current pulse

Маркер текущей главы в левой колонке pulse-анимация (600ms loop, opacity 0.6 → 1.0 → 0.6 в mint).

### Public share — hero landing

Для `/share/<token>` страница — без AppShell, отдельный лёгкий layout:
- Centered max-width 1080px.
- Subtle gradient mesh на фоне: `radial-gradient(circle at 30% 20%, rgba(94,234,212,0.08), transparent 60%), radial-gradient(circle at 80% 80%, rgba(94,234,212,0.04), transparent 60%)`.
- Шапка: лого Z mint + ссылка `Создать аккаунт` (mint outline) → `/signup`.
- Body: тот же layout что и authenticated страница, но без правого AI-чата (для публики).
- Footer: тонкая линия + `Доступно до 16 мая 2026 • Z`.

### Expired share landing

```
┌────────────────────────────────┐
│                                 │
│         🔒  (mint)              │
│                                 │
│  Эта ссылка больше недоступна   │
│                                 │
│  Создайте бесплатный аккаунт Z  │
│  чтобы хранить и анализировать  │
│  свои встречи так же.           │
│                                 │
│   [ Создать аккаунт →  ]        │
│        (mint button)            │
│                                 │
└────────────────────────────────┘
```

Centered, max-width 480px, mint accent на иконке и CTA. Background — ровный `bg-base` без gradient mesh (более sober для negative state).

### Empty states

- Используем простой стиль "minimal line illustration", монохром в `text-tertiary`, с одним mint-акцентом на ключевом элементе.
- Краткий текст в tone of voice (см. ниже) + CTA-кнопка (если применимо).

Например, пустой `My Tasks`:
```
       [иконка чек-листа в text-tertiary, mint галка]

       У вас пока нет задач.
       Они появятся здесь после обработки встреч.

       [ Создать встречу →  ]   (mint outline)
```

## Кастомизация Vidstack

Vidstack даёт основу плеера, но дефолтный UI не подходит. Кастомизируем через slots и tokens:

- Scrubber: тонкая 2px линия `border-default`, mint progress, hover увеличивает до 4px.
- Маркеры глав: rounded pills 6x18 (наш компонент `<ChapterMarker>` поверх Vidstack `<TimeSlider.Marker>`).
- Маркеры клипов: 8x8 точки с mint glow.
- Controls: minimal, монохром, mint hover.
- Volume slider: тонкий, mint.
- Speed selector: dropdown в стиле shadcn.
- Subtitles: position bottom, Geist Sans 500 text-md, `bg-overlay` с blur.
- Поведение при просмотре в публичной странице (без AppShell) — то же самое.

## Tone of voice (микрокопирайт)

**Принцип:** прямой, профессиональный, без cute и без излишней официальности.

| Не пишем | Пишем |
|---|---|
| "Oops!" | "Что-то пошло не так." |
| "Beep-boop, AI is thinking..." | "AI обрабатывает запись..." |
| "Уважаемый пользователь!" | (без обращения, сразу к делу) |
| "Wow! Great job!" | (без поздравлений, минимум) |
| "We couldn't find anything" | "Ничего не найдено." |

**Buttons** — короткие, императив, без многословия:
- ✓ `Создать встречу`
- ✓ `Поделиться`
- ✓ `Отозвать ссылку`
- ✗ `Нажмите здесь, чтобы создать новую встречу`

**Errors** — что случилось + что делать:
- ✓ `Ссылка больше недоступна. Запросите новую у владельца встречи.`
- ✗ `Error: 410 Gone`

**Empty states** — почему пусто + что можно сделать:
- ✓ `У вас пока нет задач. Они появятся здесь после обработки встреч.`
- ✗ `No items.`

## Theme switching

- Default: dark (без флага в localStorage — всегда стартует тёмный).
- Toggle в шапке sidebar (рядом с avatar): иконка Sun/Moon.
- Persists в localStorage `z-theme: dark | light | system`.
- При первом заходе — респектируем `prefers-color-scheme` если выставлено `system`.
- Переключение — instant, без transition fade (это раздражает).

## Иконки

- **Lucide Icons** (open source, MIT, идёт в комплекте с shadcn) — base.
- Stroke 1.5px, rounded caps, 16x16 / 20x20 / 24x24.
- Цвет — `currentColor`, наследуется от текста.
- Custom-icons для специфичных элементов (LiveKit-индикатор, AI-pipeline шаги, типы destinations) — рисуем на месте в Geist-стиле (1.5px stroke, rounded caps), сохраняем как React-компоненты в `frontend/src/ui/icons/`.

## Что НЕ делаем (анти-паттерны)

- Glassmorphism везде (только AI-цитаты и sticky-headers).
- Цветные градиентные кнопки (есть mint accent — этого хватит).
- Сложные иллюстрации в стиле Notion AI / Slack.
- Animations в каждой кнопке (clean enterprise — не Disney).
- Confetti / celebration animations при complete (cringe).
- Dark mode через `filter: invert()` (это всегда плохо выглядит).
- Шрифты Comic Sans, Inter, Roboto, Open Sans (overused).
- Эмодзи в UI-копирайте (только функциональные иконки).
- Звуковые эффекты по умолчанию (audio в meeting-tool — раздражает).
- 3D-элементы, glassmorphism layered, neumorphism.

## Референсы (для калибровки восприятия)

Качественные продукты, чей визуальный язык близок к нашему направлению:

- **Linear** ([linear.app](https://linear.app)) — точный референс по структуре, типографике, плотности.
- **Cursor** ([cursor.com](https://cursor.com)) — dark-first, фиолетовый акцент (у нас mint, но логика та же).
- **Vercel Dashboard** — Geist шрифт, минимализм, subtle gradient в hero.
- **Arc Browser** — мягкие тени, organic motion, glass-эффекты сдержанно.
- **Cron / Notion Calendar** — чистая структура, минимум цветов, акцент на типографике.
- **Raycast** — command-palette паттерн, чистая dark-эстетика.

## Процесс утверждения

1. Утверждение этого design-документа (текущий шаг).
2. Запуск скилла `frontend-design` или работа с дизайнером — генерация эталонной страницы (страница встречи) с реальным кодом.
3. Calibration loop с владельцем продукта на эталонной странице (1–3 итерации).
4. Утверждение эталона — запись в этом документе как `status: approved`.
5. **До утверждения эталона остальные страницы не реализуются.** Иначе придётся переделывать.
6. После утверждения эталона — все страницы калибруются по нему.

Это блокирующее условие для основной разработки — Фаза 0.5 в основном ТЗ.

## Открытые вопросы

- [ ] Иллюстрации для empty states — нанять иллюстратора (стоимость / срок) или взять premium-набор (какой)? Решается на этапе реализации эталонной страницы.
- [ ] Логотип — оставить текстовый "Z" Geist Bold mint navalа V2, или сразу заказать иконку? Я бы оставил текст в V1.
- [ ] Sound design — тонкие звуки на complete, на новое сообщение чата, на webhook delivered? V2.
- [ ] Mobile-first или desktop-first calibration? Я бы делал desktop как приоритет (B2B-инструмент), мобила как secondary.
- [ ] OG images для публичных share-страниц (Open Graph при шеринге в Slack/email) — генерируем на лету через `@vercel/og` или статические? V2.

## Решения принятые в ходе обсуждения

- Direction: dark-first minimalism + electric mint accent + Geist typography + glass-cards.
- Light mode поддерживается, но default — dark.
- Motion library — Framer Motion.
- Кастомизация Vidstack — не используем дефолтный UI.
- Shadow в dark-режиме — не используем (через `bg-elevated/card/overlay` различаем слои).
- Mint accent зафиксирован на `#5EEAD4` (dark) / `#14B8A6` (light).

## Следующий шаг

→ Обновление основного ТЗ ([plans/archive/2026-05-09-ai-meeting-workspace.md](plans/archive/2026-05-09-ai-meeting-workspace.md)) — добавление ссылки на этот документ и Фазы 0.5 «Design Foundations» с реализацией эталонной страницы.
