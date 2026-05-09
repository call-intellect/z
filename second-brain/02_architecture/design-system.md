---
title: Дизайн-система Z
status: actual
updated: 2026-05-09
---

# Дизайн-система Z

Утверждена 2026-05-09. Источник: `plans/analysis/2026-05-09-ai-meeting-workspace-design.md`. Реализована в `frontend/src/ui/`.

## Direction

**Dark-first minimalism + mint accent + Geist typography + glass-cards для AI-цитат.**

## Цветовые токены

| Token | Dark | Light |
|---|---|---|
| `--bg-base` | `#0A0E14` | `#F8F9FA` |
| `--bg-elevated` | `#11161E` | `#FFFFFF` |
| `--bg-card` | `#161D26` | `#F1F3F5` |
| `--bg-overlay` | `#1B232E` | `#E9ECEF` |
| `--accent` | `#5EEAD4` (mint) | `#0D9488` (teal-darker) |
| `--text-primary` | `#E8EAED` | `#0A0E14` |
| `--text-secondary` | `#A0A6B0` | `#4A5260` |
| `--text-tertiary` | `#6B7280` | `#7C848F` |
| `--success` | `#4ADE80` | `#16A34A` |
| `--warning` | `#FBBF24` | `#D97706` |
| `--danger` | `#F87171` | `#DC2626` |

Файл: `frontend/src/ui/tokens.css`. Theme switcher persist в `localStorage.z-theme`, respect `prefers-color-scheme` при первом заходе.

## Typography

- **Geist Sans** через `next/font` — основной шрифт (UI, тексты, кнопки)
- **Geist Mono** — таймстампы, код, технические значения
- Базовая шкала: 12 / 14 / 16 / 20 / 24 / 32 / 48 px
- Line-height: 1.5 для body, 1.25 для headings

## Iconography

**Lucide Icons** — `lucide-react`. Базовый stroke 1.5px. Без кастомных иконок.

## Motion

`frontend/src/ui/motion.ts`:
- `SPRING_DEFAULT = { stiffness: 300, damping: 30 }` — основная анимация
- `SPRING_BOUNCY = { stiffness: 400, damping: 22 }` — для CTA, success-states
- `EASE_OUT_EXPO = [0.16, 1, 0.3, 1]` — выход элементов
- `DURATION_DEFAULT = 0.2` сек
- Variants: `fadeIn`, `slideUp`, `scaleIn`
- `usePrefersReducedMotion()` — instant fallback для критических, нулевой transform для остальных

Библиотека: `motion@11` (бывший framer-motion).

## AI-специфичные паттерны

- `<AiCitation>` — glass-цитата (`backdrop-filter: blur(12px)`, mint border, hover-glow `--accent-glow`). Используется в чате, smart chapters, action item source-quote.
- `<AiTypingDots>` — три точки с `motion`-pulse.
- `<Sparkle>` — иконка-индикатор AI-генерации (Sparkles из lucide с лёгкой mint-glow).

Файлы: `frontend/src/ui/components/ai/`.

## Primitives (shadcn-based)

`frontend/src/ui/shadcn/` — 22 компонента: `button`, `input`, `label`, `textarea`, `dialog`, `dropdown-menu`, `select`, `tabs` (с `motion.span` layoutId-индикатором), `tooltip`, `avatar`, `badge`, `card`, `separator`, `sheet`, `command` (cmdk), `scroll-area`, `popover`, `switch`, `checkbox`, `progress`, `skeleton` (с shimmer), `toast` (sonner-обёртка). + `lib/utils.ts` с `cn()`.

Все RSC-совместимые, типизированы, `forwardRef` где shadcn-конвенция.

## AppShell

`frontend/src/ui/components/app-shell/`:
- `Sidebar` — 248px desktop, лого Z (mint), CTA «Создать встречу», nav (Главная/Мои встречи/Задачи/Шаблоны/Интеграции/Настройки), снизу карточка юзера с dropdown (Профиль / Сменить пароль / Тема / Выйти).
- `Header` — на mobile burger для sidebar (через `<Sheet>`).
- `AppShell.tsx` — wrapper.
- Подключено в `frontend/app/(authenticated)/layout.tsx`.

## Эталонные страницы

Дизайн-эталоны живут в `frontend/app/(design-preview)/*/page.tsx` (без auth, для апрува):

- **`/journal-reference`** → `MeetingsJournalDesignReference.tsx` (master-detail + sticky-группировка + bulk + glass-карточки)
- **`/meeting-reference`** → `MeetingResultPage.reference.tsx` (3-колонки + 5 табов + AI-чат + custom-плеер)

Production-версии используют те же tokens и motion presets.
