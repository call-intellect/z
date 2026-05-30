# Дизайн-спецификация: Reg.ru → клон для КОРА

**Дата анализа:** 2026-05-26  
**Источник:** https://www.reg.ru/ (анализ через Playwright + JS introspection)  
**Результат:** `second-brain/06_marketing/landings/2026-05-26-regru-style-landing.html`

---

## Стек reg.ru

- **Фреймворк:** React/Next.js (видны CSS Modules с хэшами `_header_thegq_43`)
- **Шрифт:** Geologica (Google Fonts) — переменный, русскоязычный, geometric  
  Стек: `Geologica, Inter, Arial, "Helvetica Neue", Helvetica, FreeSans, sans-serif`
- **Анимации:** CSS transitions + собственные CSS custom properties
- **Иконки:** кастомные SVG
- **Хостинг изображений:** S3 (s3.reg.ru) с подписанными URL (Amz-Expires=3600)

---

## Цветовая система

### Основной бренд
| Название | HEX | Назначение |
|---|---|---|
| primary-main | `#1ede7b` | Кнопки CTA, активные состояния, announce-bar |
| primary-hover | `#1ac16b` | Hover CTA |
| primary-dark | `#149955` | Текстовые ссылки, акценты |
| primary-light | `#d2f8e5` | Outline focus, светлый фон |
| primary-lighter | `#e8fcf2` | Hover-фон карточек, тонкие подложки |

### Нейтральные
| Название | HEX | Назначение |
|---|---|---|
| black | `#2b2f33` | Основной текст, кнопки secondary |
| black-dark | `#191b1e` | Заголовки, hover кнопок dark |
| gray-25 | `#f9fafc` | Фон карточек, product-tile |
| gray-50 | `#f2f4f7` | Disabled-состояния, chips |
| gray-100 | `#dfe3e8` | Разделители, border-divider |
| gray-200 | `#cbcdd6` | Border controls (input, etc.) |
| gray-600 | `#707a8a` | Вторичный текст, placeholder |
| white | `#ffffff` | Основной фон |

### Семантические
| Название | HEX | Назначение |
|---|---|---|
| danger | `#ff2d50` | Ошибки |
| attention | `#ffd11a` | Предупреждения, рейтинг-звёзды |
| fluorescent | `#dcffa0` | Акцентный yellow-green |
| footer | `#181818` | Фон футера |

---

## Типографика

**Семейство:** `Geologica, Inter, Arial, "Helvetica Neue", Helvetica, FreeSans, sans-serif`

### Размеры заголовков (desktop-m, 1280+)
| Уровень | Размер | Line-height | Letter-spacing | Вес |
|---|---|---|---|---|
| H1 | 72px | 80px | -0.03em | 500 |
| H2 | 50px | 55px | -0.03em | 500 |
| H3 | 48px | 53px | -0.03em | 500 |
| H4 | 32px | 36px | -0.02em | 500 |
| H5 | 24px | 32px | -0.03em | 500 |
| H6 | 20px | 24px | -0.02em | 500 |
| H7 | 16px | 20px | -0.02em | 500 |

> На реальной странице H1 рендерится 50px/55px (desktop-s ширина viewport в момент снятия).

### Основной текст
| Размер | Font-size | Line-height | Вес normal/bold |
|---|---|---|---|
| xxs | 12px | 15px | 300 / 500 |
| xs | 14px | 17px | 300 / 500 |
| s/m | 16px | 20px | 300 / 500 |
| m (desktop) | 18px | 22px | 300 / 500 |
| l | 20px | 24px | 300 / 500 |
| l (desktop-l) | 24px | 29px | 300 / 500 |

**Ключевое:** normal weight = **300 (light)**, bold = **500 (medium)** — не 400/700.  
Letter-spacing на текст: `-0.02em` (тихий, не зажатый).

---

## Border Radius

| Токен | Значение | Применение |
|---|---|---|
| --radius-xxs | 4px | Мелкие метки, badges |
| --radius-xs | 8px | Кнопки, поля ввода, иконки |
| --radius-s | 12px | Карточки, промо-блоки |
| --radius-m | 24px | Средние блоки |
| --radius-l | 40px | Крупные rounded блоки |
| --radius-xl | 60px | Pill-теги, hero-tags |

---

## Тени (синеватые, не серые!)

```css
--shadow-1: 0px 4px 16px rgba(0,51,153,.04), 0px 2px 2px rgba(0,51,153,.08);
--shadow-2: 0px 8px 20px rgba(0,51,153,.08), 0px 4px 8px rgba(0,51,153,.08);
--shadow-4: 0px 12px 32px rgba(0,51,153,.12), 0px 8px 20px rgba(0,51,153,.08);
```

Цвет теней — `rgba(0,51,153,...)` (синий #003399), а не нейтральный серый.  
Это создаёт «воздушность» без грязи.

---

## Анимации

```css
--anim-change: .1s cubic-bezier(.45,0,.55,1);    /* hover transitions */
--anim-in:     .3s cubic-bezier(.81,0,.04,1);    /* появление — агрессивный ease-out */
--anim-out:    .2s cubic-bezier(.25,.01,.47,.99); /* исчезновение */
```

---

## Брейкпоинты

| Имя | Диапазон |
|---|---|
| mobile-s | < 360px |
| mobile-m | 360–719px |
| mobile-l | 720–1023px |
| desktop-s | 1024–1279px |
| desktop-m | 1280–1599px |
| desktop-l | 1600px+ |

**Контейнеры:** 996px / 1200px / 1328px.

---

## Структура страницы (порядок блоков)

```
1. Announce bar        — зелёный (#1ede7b) топ-бар, полная ширина, иконка + текст + ссылка
2. Header              — 56px, белый, sticky, logo + nav + login-кнопка
3. Hero                — тёмный (фото/градиент), H1 белый, search bar, pill-теги
4. Quick services      — 2 колонки: «сделаем за вас» | «сделайте сами», 2×4 карточки
5. Promo banner        — зелёный (#1ede7b) full-width card, radius 12px, logo + H2 + CTA
6. Популярное          — 3-col cards grid: изображение + chips + title + desc + price
7. Отраслевые решения  — 3-col cards, заголовок + «Все решения →»
8. Все инструменты     — 4-col product tiles (иконка + название + описание + цена)
9. Блог                — 4-col blog cards (изображение + категория + заголовок)
10. Облако/ИТ          — тёмный (#191b1e), 2-col: текст + visual, features grid
11. Footer             — #181818, 4-col links + brand + phones + socials + legal
```

---

## Компоненты

### Кнопки
```
btn-primary:  bg=#1ede7b, color=#2b2f33, radius=8px, padding=12px 24px, weight=300
btn-dark:     bg=#2b2f33, color=#fff,    radius=8px, padding=12px 24px, weight=300
btn-outline:  bg=transparent, border=#cbcdd6, radius=8px
btn-lg:       padding=16px 32px, font-size=18px
btn-sm:       padding=8px 16px, font-size=14px
```

### Input
```
bg=#fff, border=1px solid #cbcdd6, radius=8px, padding=10px 18px, font-size=16px
focus-outline: 0 0 0 2px #d2f8e5
error-border: #ff2d50
```

### Карточки продукта
```
bg=#fff, border=1px solid #dfe3e8, radius=12px, no box-shadow default
hover: box-shadow=shadow-2, border-color=#cbcdd6
image: aspect-ratio 16/9, radius-top=12px
body: padding=20px
chips: bg=#f2f4f7, color=#707a8a, font-size=12px, radius=60px (pill)
title: font-size=18px, weight=500, letter-spacing=-0.02em
desc: font-size=14px, color=#707a8a
```

### Chips / теги
```
default: bg=#f2f4f7, color=#707a8a, font-size=12px, padding=3px 10px, radius=60px
primary: bg=#e8fcf2, color=#149955
```

### Announce bar (верхняя полоска)
```
bg=#1ede7b, padding=10px 20px, font-size=14px, color=#2b2f33
```

### Footer
```
bg=#181818, color=rgba(255,255,255,0.75)
links hover: color=#1ede7b
phone-primary: font-size=20px, weight=500
social icons: 40x40px, bg=rgba(255,255,255,0.08), radius=8px
legal: font-size=12px, color=rgba(255,255,255,0.3)
```

---

## Ключевые особенности дизайна

1. **Яркий зелёный** `#1ede7b` — единственный яркий цвет. Всё остальное нейтрально.  
   Это создаёт мощный контраст без пестроты.

2. **Geologica** — переменный шрифт с хорошей поддержкой кириллицы, geometric.  
   Аналог: Gilroy, Manrope. Но именно Geologica даёт фирменный вид reg.ru.

3. **font-weight: 300** для body — нетипично, создаёт «лёгкость».  
   Заголовки weight=500 (не 700!) — элегантность, не грубость.

4. **Синеватые тени** `rgba(0,51,153,...)` — воспринимаются как «воздух», не «грязь».

5. **Letter-spacing: -0.02em** на весь текст — тесный, современный вид.  
   На заголовках: -0.03em.

6. **Промо-баннер полностью зелёный** с border-radius 12px внутри белого контейнера —  
   даёт ощущение «бренд говорит с тобой», выделяется без агрессии.

7. **Product tiles** на светло-сером `#f9fafc` с hover на `#e8fcf2` (mint tint) —  
   мягкий интерактив.

---

## Файлы

- **HTML-клон:** `second-brain/06_marketing/landings/2026-05-26-regru-style-landing.html`
- **Сырые токены:** `regru-tokens.json` (в корне, временный)
- **Скриншоты:** `regru-*.png`, `kora-regru-style-*.png` (в корне, временные)
