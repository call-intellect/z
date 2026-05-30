---
name: Z / Кора
description: Память вашей компании. То, что было сказано, решено и сделано — теперь не теряется.
colors:
  # Primary accent
  accent: "oklch(0.84 0.13 168)"       # Сигнальный минт (dark)
  accent-hover: "oklch(0.88 0.13 168)"
  accent-active: "oklch(0.80 0.13 168)"
  accent-muted: "oklch(0.84 0.13 168 / 0.12)"
  accent-fg: "oklch(0.18 0.02 168)"
  # Secondary (light mode)
  accent-light: "oklch(0.62 0.07 155)" # Шалфей
  # Neutral surfaces (dark)
  bg-base: "oklch(0.16 0.012 250)"     # Ночной сланец
  bg-elevated: "oklch(0.19 0.014 250)"
  bg-card: "oklch(0.22 0.016 250)"
  bg-surface: "oklch(0.20 0.014 250)"
  bg-subtle: "oklch(0.24 0.018 250)"
  # Text
  text-primary: "oklch(0.93 0.005 250)"
  text-secondary: "oklch(0.72 0.008 250)"
  text-tertiary: "oklch(0.55 0.012 250)"
  text-disabled: "oklch(0.40 0.012 250)"
  # Status
  success: "oklch(0.78 0.16 150)"
  warning: "oklch(0.82 0.16 75)"
  danger: "oklch(0.72 0.18 22)"
  info: "oklch(0.78 0.15 235)"
typography:
  display:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "48px"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist Sans, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
  mono:
    fontFamily: "Geist Mono, JetBrains Mono, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.45
rounded:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "18px"
  xl: "22px"
  2xl: "28px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  6: "24px"
  8: "32px"
  12: "48px"
  16: "64px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-fg}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.accent-fg}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.bg-subtle}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "36px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.accent}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "36px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "36px"
  input-default:
    backgroundColor: "{colors.bg-card}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    height: "36px"
  card-default:
    backgroundColor: "{colors.bg-card}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "24px"
---

# Design System: Z / Кора

## 1. Overview

**Creative North Star: "Нервный центр"**

Кора — не помощник, который предлагает. Это инструмент, который помнит: тихий, точный, постоянно работающий. Интерфейс выглядит как командный пункт компании: тёмная нейтральная основа («Ночной сланец») с редкими вспышками «Сигнального минта» в тех местах, где происходит что-то важное. Ничего лишнего не горит.

Плотность информации высокая, но не агрессивная. Каждый экран — это набор ответов, а не вопросов. Пространство говорит само за себя: широкий отступ означает важную секцию, плотный — операционную деталь. Иерархия видна с первого взгляда.

Система реагирует, но не шумит. Hover и focus — тактильные, мгновенные. Переходы — короткие, без хореографии. Акцент появляется как сигнал на мониторе диспетчера, а не как украшение на витрине.

**Key Characteristics:**
- Тёмная многослойная основа: «Ночной сланец» разбивается на четыре тональных уровня без декоративных теней
- Один акцент — «Сигнальный минт» — занимает ≤10% любого экрана; его редкость и есть его вес
- Единая humanist sans-serif гарнитура (Geist) с резкой шкалой масштабов от 12px до 48px
- Компоненты живые и отзывчивые: hover и focus мгновенны, без анимационной хореографии
- Пустое пространство — редкость и акцент, а не норма

## 2. Colors: Палитра «Нервного центра»

Два полюса с единственным сигнальным голосом между ними.

### Primary
- **Сигнальный минт** (`oklch(0.84 0.13 168)`): Главный акцент в тёмной теме. Первичные кнопки, активные состояния, focus-кольцо, онлайн-индикаторы. Появляется только там, где нужно действие или внимание. Никогда как фоновый паттерн.

### Secondary
- **Шалфей** (`oklch(0.62 0.07 155)`): Акцент светлой темы. Более приглушённый и «земляной» аналог Сигнального минта для окружений с высокой освещённостью. Та же роль, другая контрастность.

### Neutral
- **Ночной сланец** (`oklch(0.16 0.012 250)`): Базовый фон. Все экраны начинаются отсюда. Тинтован в сторону синего (hue 250) — не чёрный, а ночное небо.
- **Приподнятый сланец** (`oklch(0.19 0.014 250)`): Подложки, приподнятые панели, header и sidebar.
- **Карточный сланец** (`oklch(0.22 0.016 250)`): Карточки, поля ввода, контейнеры данных.
- **Тонированный сланец** (`oklch(0.24 0.018 250)`): Hover-состояния фона, subtle-секции, группировка без границ.
- **Основной текст** (`oklch(0.93 0.005 250)`): Заголовки, основной контент. Не чисто белый — тинт в сторону фона.
- **Вторичный текст** (`oklch(0.72 0.008 250)`): Подписи, описания, вторичные метки.
- **Третичный текст** (`oklch(0.55 0.012 250)`): Временны́е метки, вспомогательный текст.
- **Disabled-текст** (`oklch(0.40 0.012 250)`): Деактивированные элементы.

### Named Rules
**Правило «Сигнального минта».** Акцент занимает ≤10% любого экрана. Если Сигнальный минт мелькает везде — он уже не сигнал. Запрещено использовать его как фоновый паттерн, градиент или декоративный элемент.

**Правило тинта.** Каждый нейтральный оттенок имеет лёгкий тинт в направлении hue 250 (сине-стальной). Чистый серый (`oklch(X 0 0)`) запрещён. Чистый чёрный и чистый белый — запрещены.

## 3. Typography

**Display Font:** Geist Sans (fallback: system-ui, sans-serif)
**Body Font:** Geist Sans
**Mono Font:** Geist Mono (fallback: JetBrains Mono, monospace)

**Character:** Единая гуманистическая гротескная гарнитура без декоративных начертаний. Иерархия строится на масштабе и плотности, а не на смене гарнитуры. Отрицательный кернинг на крупных размерах добавляет весомость без громоздкости.

### Hierarchy
- **Display** (700, 48px, lh 1.05, –0.025em): Hero-заголовки, главная страница, splash-экраны. Используется редко.
- **Headline** (600, 32px, lh 1.15, –0.02em): Заголовки крупных секций, пустые состояния, подтверждающие экраны.
- **Title** (600, 20px, lh 1.3, –0.01em): Заголовки карточек, модальных окон, боковых панелей.
- **Body** (400, 14px, lh 1.5): Основной текст интерфейса. Максимальная длина строки — 65-75ch.
- **Label** (500, 12px, lh 1.4): Навигационные пункты, метки фильтров, статусы, подписи.
- **Mono** (400, 13px, lh 1.45): Транскрипты встреч, временны́е метки, технические идентификаторы.

### Named Rules
**Правило весового контраста.** Между соседними уровнями иерархии — минимум 1.25× разницы в размере или переход в font-weight. Плоские шкалы (все элементы в body-size) запрещены.

**Правило моноширинного контекста.** Mono-шрифт используется только для машинно-генерированного контента: транскрипты, ID встреч, временны́е метки. Никогда как декоративный или акцентный элемент.

## 4. Elevation

Система строит глубину через тональные слои, а не через атмосферные тени. Четыре поверхности (base → elevated → card → subtle) отличаются lightness на 0.03-0.04 единицы OKLCH — один шаг вверх = один шаг подъёма. Это читается мгновенно без каких-либо box-shadow.

Тени — структурные, появляются только при интерактивном изменении состояния (hover, focus, modal). В покое — плоско.

### Shadow Vocabulary
- **card-soft** (`0 1px 2px oklch(0 0 0 / 0.4), inset 0 1px 0 oklch(1 0 0 / 0.04)`): Базовое состояние карточки. Едва видимая — структурное разделение обеспечивает фоновый тинт.
- **card-raised** (`0 8px 24px oklch(0 0 0 / 0.4), 0 2px 8px oklch(0.84 0.13 168 / 0.06), inset 0 1px 0 oklch(1 0 0 / 0.05)`): Hover-состояние карточки. Минтовый подсвет (6%) намекает на системный акцент.
- **accent-focus** (`0 0 0 3px oklch(0.84 0.13 168 / 0.28), 0 0 24px oklch(0.84 0.13 168 / 0.18)`): Исключительно для клавиатурной навигации (`:focus-visible`). Никогда при hover.
- **modal** (`0 24px 48px oklch(0 0 0 / 0.5)`): Только диалоги. Тяжёлая тень создаёт контекстный разрыв с основным контентом.

### Named Rules
**Правило «Плоско по умолчанию».** Поверхности без интерактивности — плоские. Тень появляется только как ответ на состояние. Декоративные тени — запрещены.

## 5. Components

### Buttons

Тактильные и мгновенные. Каждый вариант несёт чёткую ролевую нагрузку; смешивать роли запрещено.

- **Shape:** Слегка скруглённые (8px, `rounded-sm`)
- **Primary:** `bg-accent` (Сигнальный минт) + `text-accent-fg` (тёмный минт). Padding 0 16px, height 36px. Hover: lightness +4 единицы. Нажатие: `scale(0.98)` за 75ms.
- **Secondary:** `bg-bg-overlay` (полупрозрачный тёмный) + тонкая граница `border-border-subtle`. Hover: `bg-bg-card`.
- **Outline:** `border-accent-border` + `text-accent`, прозрачный фон. Hover: `bg-accent-muted`.
- **Ghost:** `text-fg-secondary`, без фона и границы. Hover: `bg-bg-overlay` + `text-fg-primary`.
- **Destructive:** `bg-danger/15` + `border-danger/30` + `text-danger`. Hover: `bg-danger/25`.
- **Focus:** `ring-2 ring-accent ring-offset-2` с тенью `accent-focus`. Всегда через `:focus-visible`.

### Chips / Badges

Семантические пары тон-на-тон. Смысл несёт только цвет; форма нейтральна.

- **Style:** `rounded-md` (12px), пастельный фон + fg того же hue. 6 семантических ролей: success (hue 150), warning (75), danger (22), info (235), lavender (295), sand (80).
- **Dark theme:** фон через overlay opacity (~40%), fg — насыщенный вариант того же hue (`oklch(0.82 0.13 X)`).
- **Light theme:** фон светлый (`oklch(0.93 0.04 X)`), fg тёмный (`oklch(0.42 0.08 X)`).
- **Запрещено:** использовать акцентный «Сигнальный минт» как чип-цвет статуса — он зарезервирован для первичных действий.

### Cards / Containers

Контейнеры данных, а не декоративные рамки.

- **Corner Style:** Умеренно скруглённые (18px, `rounded-lg`)
- **Background:** `bg-bg-card` (`oklch(0.22 0.016 250)`)
- **Shadow:** `shadow-card-soft` в покое; `shadow-card-raised` при hover (с минтовым подсветом на 6%)
- **Border:** `border-border-subtle` — структурная граница, почти невидимая
- **Internal Padding:** 24px (`p-6`), content-зона `p-6 pt-0`

### Inputs / Fields

Строгие и ясные. Никаких декораций в покое.

- **Style:** `border border-border` + `bg-bg-card` + `rounded-md` (12px). Текст `text-fg-primary`, placeholder — `text-fg-secondary`.
- **Focus:** `ring-2 ring-accent ring-offset-2` + граница смещается в `border-accent`. Строго через `:focus-visible`.
- **Error:** `border-danger` + hint-текст `text-danger` под полем.
- **Disabled:** `opacity-50 cursor-not-allowed`. Никаких дополнительных стилей.

### Navigation

App Shell: sidebar (248px, collapsed до 64px) + header (64px).

- **Typography:** Label (12px, 500) для пунктов меню
- **Active state:** `text-accent` + фоновый тинт `bg-accent-muted`. Запрещён `border-left` как акцентная полоса — это нарушает принцип «Нервного центра».
- **Hover:** `bg-bg-subtle` + `text-fg-primary`
- **Collapsed:** только иконки, tooltip при hover показывает название
- **Mobile:** Sheet (Radix) снизу или слева; transition `ease-out-quart` 200ms

### Граф знаний (Signature Component)

Ключевой UI продукта. Узлы — компактные карточки с entity-title (Title weight, 20px, 600) связанные линиями-рёбрами.

- **Node в покое:** `bg-bg-card` + `border-border-subtle`, `rounded-lg`
- **Node hover:** `shadow-card-raised` + минтовое свечение на рёбрах связи (stroke `accent/30`)
- **Node active:** `bg-accent-muted-strong` как фон, `border-accent-border`
- **Edges (рёбра):** `stroke oklch(0.93 0.005 250 / 0.15)` в покое; при hover узла — `stroke oklch(0.84 0.13 168 / 0.30)`

## 6. Do's and Don'ts

### Do:
- **Do** использовать «Сигнальный минт» только для первичных действий, активных состояний и focus-ring. Его редкость — его смысл.
- **Do** строить глубину через тональные слои `bg-base → bg-elevated → bg-card → bg-subtle`, а не через декоративные тени.
- **Do** ограничивать длину строки тела текста диапазоном 65-75ch.
- **Do** анимировать только `color`, `opacity`, `transform`, `box-shadow`. Анимация layout-свойств (`width`, `height`, `padding`, `margin`) запрещена.
- **Do** использовать `cubic-bezier(0.25, 1, 0.5, 1)` (ease-out-quart) для переходов состояний. Длительность: 100-200ms для hover, 200-300ms для появления панелей.
- **Do** писать весь текст интерфейса по-русски. Кора — инструмент для российского рынка.
- **Do** соблюдать touch-target ≥40px для всех интерактивных элементов на мобильных (`min-h-10`).
- **Do** тинтовать все нейтральные оттенки в сторону hue 250 (хотя бы `chroma 0.005`). Чистый серый — не в системе.

### Don't:
- **Don't** использовать `border-left > 1px` как цветную акцентную полосу на карточках, навигационных элементах или плашках. Это нарушает визуальный язык. Замена: фоновый тинт или ведущая иконка.
- **Don't** применять gradient text (`background-clip: text` + gradient). Акцент через `font-weight` или `font-size`.
- **Don't** использовать glassmorphism как декорацию. `backdrop-filter: blur()` только в overlay и modal-контекстах.
- **Don't** строить hero-метрики: большое число + маленький лейбл + градиентный акцент. Прямой визуальный антипаттерн «дженерик SaaS-дашборда».
- **Don't** выстраивать одинаковые сетки карточек: иконка + заголовок + текст, повторённые без вариации. Каждый тип контента требует своей формы.
- **Don't** открывать модальное окно первым делом. Исчерпай inline- и прогрессивные варианты.
- **Don't** делать белый или нейтрально-серый фон. Кора — не Notion, не Obsidian. Даже в светлой теме: тёплый тонированный cream (`oklch(0.985 0.005 85)`), не чистый белый.
- **Don't** использовать фиолетово-синие градиенты или «AI-ощущение из коробки» (стиль mymeet, Granola). «Сигнальный минт» — hue 168, это не фиолет и не индиго.
- **Don't** копировать корпоративный синий с кнопками везде (Bitrix24 / amoCRM-стиль). Система — лаконичная, не агрессивная.
- **Don't** использовать чистый `#000` или `#fff`. Никогда. Любой цвет — с тинтом.
