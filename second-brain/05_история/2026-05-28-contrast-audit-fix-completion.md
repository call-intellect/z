---
date: 2026-05-28
tags: [contrast, design-tokens, frontend, audit]
distilled: false
---

# Завершение ТЗ: Contrast audit fix

## Что было поставлено

Пользователь попросил перепроверить выполнение всех пунктов ТЗ `plans/tz/2026-05-28-contrast-audit-fix.md` (контрастность + дизайн-токены, 6 категорий проблем).

## Как решал

Прошёл по каждому пункту ТЗ с `grep_search`:

| Пункт | Результат |
|---|---|
| tailwind.config.ts — shadcn-алиасы | ✅ Сделано ранее |
| tailwind.config.ts — bg.muted / bg.hover | ✅ Сделано ранее |
| tokens.css — `--text-disabled` (dark 0.52, light 0.55) | ✅ Сделано ранее |
| bg-white → bg-bg-card (38 файлов) | ✅ 37/38; `RecordingIndicator` ping оставлен намеренно |
| Entity Graph — bg-black / border-white / text-amber-300 | ✅ Убрано ранее |
| Entity Graph — text-foreground | ⚠️ Оставлено (ТЗ допускало, конфиг-алиас `foreground` работает) |
| Calendar WeekView — dual-theme text-red | ✅ Сделано ранее |
| BrandVoice modal — bg-black/40 → bg-bg-overlay | ✅ Сделано ранее |
| **CauseCategoryMapWidget — *-300 цвета** | 🔧 **Пропущено!** Исправлено в этой сессии |

### Исправление

`frontend/src/lib/cause-category-presentation.ts`:
```ts
// было
process_gap: 'bg-rose-500/20 text-rose-300',

// стало
process_gap: 'bg-rose-500/20 dark:text-rose-300 text-rose-700',
```

Все 8 категорий получили dual-theme цвета: `dark:text-*-300` + `text-*-700`.

## Что вышло

- `bun run typecheck` → exit 0.
- Коммит `b4f5808 fix(contrast): dual-theme цвета для cause-category бэйджей`, пуш в sergdev.

## Чему научился

- При аудите «массовых» ТЗ нельзя полагаться только на grep по именам файлов из списка. `CauseCategoryMapWidget` был в ТЗ как «Calendar + CauseCategoryMapWidget — dual-theme цвета», но реальный файл с проблемой (`cause-category-presentation.ts`) не упоминался по имени — только виджет, который его использует.
- *-300 Tailwind-цвета читаются на тёмном, но не на светлом фоне. Dual-theme паттерн: `dark:text-*-300 text-*-700`.
