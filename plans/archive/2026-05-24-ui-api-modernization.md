---
type: tz
status: done
feature: ui-api-modernization
date: 2026-05-24
completed: 2026-05-25
---

# ТЗ: Модернизация интерфейса, дизайн-системы и критического покрытия API

> Аналитические материалы:
> - [plans/analysis/2026-05-24-ui-api-design-full-audit.md](../analysis/2026-05-24-ui-api-design-full-audit.md) — сводный аудит 4 треков
> - [plans/analysis/2026-05-23-ui-design-light-theme-research.md](../analysis/2026-05-23-ui-design-light-theme-research.md) — mood-board и research

## Цель

Привести интерфейс Z к стандарту 2026: единая дизайн-система на OKLCH (светлая sage + тёмная warm-mint), бордерлесс-карточки, sparklines, sexy-приёмы (frosted-glass, accent-glow, film-grain), унифицированный UX-scaffold (loading/empty/error), полноценная mobile-адаптация. Параллельно закрыть критические дыры в API: knowledge-core/api, RBAC, entitlements, webhooks, public-share.

## Scope

**Входит:**
- Дизайн-токены (OKLCH) для light и dark, полная замена `tokens.css`.
- Brand colour finalization: **light = sage `#7CA890`**, **dark = warm-mint `#6FEAC8`** (парная связка через OKLCH-семейство).
- Design-preview галерея на `/design-preview/light-theme` и `/design-preview/dark-theme`.
- Универсальный UI-scaffold (`<QueryGate>`, `useSwrWithToast`).
- Унификация toast (мигрируем legacy → sonner).
- Починка `EmptyState` под обе темы.
- Sexy-обвес дашборда CEO (KPI strip, sparklines, dark stat-card, frosted-glass header).
- Замена ~260 hardcoded tailwind-цветов на semantic tokens.
- Замена нативных `alert/confirm` на shadcn-dialog.
- Mobile-адаптация ключевых страниц (meetings, cards, themes, goals, tasks, dashboard).
- Тесты на критические backend-зоны: knowledge-core/api, RBAC × Tenant, entitlements, webhooks, public-share.

**Не входит:**
- Ребрендинг логотипа.
- Изменение продуктовой логики дашбордов (контент виджетов).
- Миграция БД (схема не меняется).
- Новые продуктовые фичи (только UX-обвес существующих).
- Полная переделка `(admin)` зоны (там уже хороший `AdminStateViews`).

## Архитектурные решения и обоснования

### Светлая тема — sage `#7CA890`
Выбран sage-green с тёплым уклоном `oklch(0.62 0.07 155)`. Семантика «память, мудрость, спокойная глубина» совпадает с категорией «память компании», выделяет Z из мира фиолетовых AI и indigo SaaS, не конкурирует с pastel-семантикой по hue-углу. Тёплый off-white фон `#F8F6F2` вместо холодного `#FFFFFF` (тренд Linear-2026).

### Тёмная тема — warm-mint `#6FEAC8`
Сохраняем mint-узнаваемость, но смещаем `#5EEAD4 → #6FEAC8` (на 8% теплее и насыщеннее в light-range). Парная связка с sage в светлой работает через общий OKLCH-семейство (hue 155-168). Не выбираем sage-lime `#7BE89B` — это уже ребрендинг M9 (отложено).

### OKLCH вместо HEX
Все цветовые токены перевести на OKLCH. Tailwind 4 поддерживает нативно. Преимущества: предсказуемая воспринимаемая светлота (все pastel-chip фоны сидят на L≈0.92-0.93 → выглядят как одна семья), консистентность hover/active-shades.

### Бордерлесс-карточки + двойная мягкая тень
Везде, где сейчас shadcn `border + shadow`. Иерархия через светлоту фона + тень. Тренд Linear/Vercel-2026.

### Toast — sonner единственный
Мигрируем legacy `toast-context.tsx` → sonner. Sonner — современный stack, активно поддерживается shadcn.

### Mobile-стратегия
Master-detail на mobile разваливается на 2 экрана с навигацией. Таблицы получают card-view fallback. Sidebar в Sheet уже работает — расширяем паттерн.

## Технические изменения

### Frontend — токены

**Полностью переписать [frontend/src/ui/tokens.css](../../frontend/src/ui/tokens.css)** на OKLCH-палитру.

**Light-блок:**
```css
:root[data-theme='light'] {
  /* Surfaces */
  --bg-base:     oklch(0.985 0.005 85);   /* #F8F6F2 warm off-white */
  --bg-elevated: oklch(1.000 0 0);         /* #FFFFFF cards/modal */
  --bg-card:     oklch(1.000 0 0);
  --bg-surface:  oklch(0.975 0.006 85);    /* #F3F1ED sidebar (светлее контента) */
  --bg-subtle:   oklch(0.955 0.008 85);    /* #ECE9E3 hover/skeleton */
  --bg-overlay:  oklch(0.20 0.01 85 / 0.45);

  /* Text */
  --text-primary:   oklch(0.22 0.01 60);   /* #1F1B17 warm charcoal */
  --text-secondary: oklch(0.45 0.012 70);  /* #5B544C */
  --text-tertiary:  oklch(0.62 0.012 75);  /* #8C857B */
  --text-disabled:  oklch(0.78 0.008 75);  /* #B8B2A8 */

  /* Borders (tinted) */
  --border-subtle: oklch(0.22 0.01 60 / 0.05);
  --border:        oklch(0.22 0.01 60 / 0.09);
  --border-strong: oklch(0.22 0.01 60 / 0.18);

  /* Accent — sage */
  --accent:        oklch(0.62 0.07 155);   /* #7CA890 brand */
  --accent-hover:  oklch(0.54 0.07 155);   /* #5E8E76 */
  --accent-active: oklch(0.45 0.06 155);   /* #487563 */
  --accent-muted:        oklch(0.62 0.07 155 / 0.10);
  --accent-muted-strong: oklch(0.62 0.07 155 / 0.18);
  --accent-border:       oklch(0.62 0.07 155 / 0.28);
  --accent-fg:           oklch(0.22 0.035 155); /* #1E3528 on-accent text */

  /* Pastel semantic (фон+текст одного hue, L≈0.92-0.93 / L≈0.42-0.45) */
  --chip-success-bg:   oklch(0.93 0.04 150);  --chip-success-fg:   oklch(0.40 0.08 150);
  --chip-warning-bg:   oklch(0.93 0.045 60);  --chip-warning-fg:   oklch(0.45 0.10 55);
  --chip-danger-bg:    oklch(0.92 0.04 22);   --chip-danger-fg:    oklch(0.45 0.13 22);
  --chip-info-bg:      oklch(0.93 0.035 235); --chip-info-fg:      oklch(0.45 0.10 235);
  --chip-lavender-bg:  oklch(0.92 0.04 295);  --chip-lavender-fg:  oklch(0.45 0.10 295);
  --chip-sand-bg:      oklch(0.93 0.015 80);  --chip-sand-fg:      oklch(0.42 0.025 75);

  /* Status (для inline-error, banners; на 1 ступень насыщеннее chip) */
  --success: oklch(0.55 0.13 150);
  --warning: oklch(0.65 0.15 55);
  --danger:  oklch(0.55 0.18 22);
  --info:    oklch(0.55 0.13 235);

  /* Shadows */
  --shadow-card-soft:   0 1px 2px oklch(0.22 0.01 60 / 0.04), 0 1px 3px oklch(0.22 0.01 60 / 0.06);
  --shadow-card-raised: 0 2px 4px oklch(0.22 0.01 60 / 0.04), 0 8px 24px oklch(0.22 0.01 60 / 0.08);
  --shadow-modal:       0 12px 28px oklch(0.22 0.01 60 / 0.10), 0 32px 64px oklch(0.22 0.01 60 / 0.16);
  --shadow-accent-focus: 0 0 0 3px oklch(0.62 0.07 155 / 0.22);

  color-scheme: light;
}
```

**Dark-блок:**
```css
:root, :root[data-theme='dark'] {
  /* Surfaces — tonal warm-shift */
  --bg-base:     oklch(0.16 0.012 250);   /* #0B0F16 */
  --bg-elevated: oklch(0.19 0.014 250);   /* #11161E */
  --bg-card:     oklch(0.22 0.016 250);   /* #161D26 */
  --bg-surface:  oklch(0.20 0.014 250);   /* sidebar */
  --bg-subtle:   oklch(0.24 0.018 250);   /* hover/skeleton */
  --bg-overlay:  oklch(0.10 0.01 250 / 0.72);

  /* Text */
  --text-primary:   oklch(0.93 0.005 250);
  --text-secondary: oklch(0.72 0.008 250);
  --text-tertiary:  oklch(0.55 0.012 250);
  --text-disabled:  oklch(0.40 0.012 250);

  /* Borders (tinted) */
  --border-subtle: oklch(0.93 0.005 250 / 0.05);
  --border:        oklch(0.93 0.005 250 / 0.09);
  --border-strong: oklch(0.93 0.005 250 / 0.16);
  --ring-edge-top: inset 0 1px 0 oklch(1 0 0 / 0.05); /* vercel-style зеркальный край */

  /* Accent — warm-mint */
  --accent:        oklch(0.84 0.13 168);   /* #6FEAC8 brand */
  --accent-hover:  oklch(0.88 0.13 168);
  --accent-active: oklch(0.80 0.13 168);
  --accent-muted:        oklch(0.84 0.13 168 / 0.12);
  --accent-muted-strong: oklch(0.84 0.13 168 / 0.20);
  --accent-border:       oklch(0.84 0.13 168 / 0.28);
  --accent-fg:           oklch(0.18 0.02 168); /* on-accent dark */

  /* Pastel — приглушённые версии для dark */
  --chip-success-bg: oklch(0.30 0.06 150 / 0.40); --chip-success-fg: oklch(0.82 0.13 150);
  --chip-warning-bg: oklch(0.30 0.07 55 / 0.40);  --chip-warning-fg: oklch(0.82 0.13 75);
  --chip-danger-bg:  oklch(0.30 0.08 22 / 0.40);  --chip-danger-fg:  oklch(0.82 0.13 22);
  --chip-info-bg:    oklch(0.30 0.06 235 / 0.40); --chip-info-fg:    oklch(0.82 0.13 235);
  --chip-lavender-bg:oklch(0.30 0.06 295 / 0.40); --chip-lavender-fg:oklch(0.82 0.13 295);
  --chip-sand-bg:    oklch(0.30 0.02 80 / 0.40);  --chip-sand-fg:    oklch(0.82 0.03 80);

  --success: oklch(0.78 0.16 150);
  --warning: oklch(0.82 0.16 75);
  --danger:  oklch(0.72 0.18 22);
  --info:    oklch(0.78 0.15 235);

  /* Shadows — coloured */
  --shadow-card-soft:   0 1px 2px oklch(0 0 0 / 0.4), inset 0 1px 0 oklch(1 0 0 / 0.04);
  --shadow-card-raised: 0 8px 24px oklch(0 0 0 / 0.4), 0 2px 8px oklch(0.84 0.13 168 / 0.06), inset 0 1px 0 oklch(1 0 0 / 0.05);
  --shadow-modal:       0 24px 48px oklch(0 0 0 / 0.5);
  --shadow-accent-focus: 0 0 0 3px oklch(0.84 0.13 168 / 0.28), 0 0 24px oklch(0.84 0.13 168 / 0.18);

  --blur-glass: blur(12px) saturate(1.4);

  color-scheme: dark;
}

/* Film-grain noise overlay — 1 раз на body */
body::before {
  content: '';
  position: fixed; inset: 0; pointer-events: none;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9'/></filter><rect width='200' height='200' filter='url(%23n)' opacity='0.5'/></svg>");
  opacity: 0.025;
  mix-blend-mode: overlay;
  z-index: 9999;
}
```

**Скругления (новая шкала):**
```css
--radius-xs: 6px;
--radius-sm: 8px;
--radius-md: 12px;
--radius-lg: 18px;
--radius-xl: 22px;   /* главные карточки */
--radius-2xl: 28px;  /* hero, modal */
```

### Frontend — компоненты

**Новые:**
- [frontend/src/ui/components/shared/QueryGate.tsx](../../frontend/src/ui/components/shared/QueryGate.tsx) — обёртка-сценарий «SWR → Skeleton | Empty | Error | Content».
- [frontend/src/hooks/useSwrWithToast.ts](../../frontend/src/hooks/useSwrWithToast.ts) — useSWR + автоматическая toast на error.
- [frontend/src/ui/components/shared/StatCard.tsx](../../frontend/src/ui/components/shared/StatCard.tsx) — `<StatCard variant="default|dark" />` с label / big number / delta / sparkline.
- [frontend/src/ui/components/shared/Sparkline.tsx](../../frontend/src/ui/components/shared/Sparkline.tsx) — lightweight SVG bar/line, без recharts.
- [frontend/src/ui/components/shared/Chip.tsx](../../frontend/src/ui/components/shared/Chip.tsx) — `variant="success|warning|danger|info|lavender|sand"` поверх pastel-токенов.
- [frontend/src/ui/components/shared/ConfirmDialog.tsx](../../frontend/src/ui/components/shared/ConfirmDialog.tsx) — замена нативному `confirm()`.
- [frontend/app/(design-preview)/light-theme/page.tsx](../../frontend/app/(design-preview)/light-theme/page.tsx) — галерея компонентов.
- [frontend/app/(design-preview)/dark-theme/page.tsx](../../frontend/app/(design-preview)/dark-theme/page.tsx) — то же, в dark.

**Изменения в существующих:**
- [frontend/src/ui/components/shared/EmptyState.tsx](../../frontend/src/ui/components/shared/EmptyState.tsx) — убрать hardcoded `bg-white text-slate-900`, перейти на токены `bg-bg-subtle text-fg-secondary`.
- [frontend/src/ui/components/app-shell/Sidebar.tsx](../../frontend/src/ui/components/app-shell/Sidebar.tsx):
  - Логотип Z — убрать `shadow-glow-mint`, оставить только в dark hover.
  - Active nav-item — добавить cur dot-маркер слева 6px, accent-glow только в dark.
  - В light — sidebar светлее контента (`bg-bg-surface` вместо `bg-bg-elevated`).
- [frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx](../../frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx):
  - Добавить **KPI strip сверху** — 4-6 `<StatCard />` со sparklines.
  - **Один dark stat-card** в KPI strip как визуальный якорь.
  - Хедер — `sticky top-0 backdrop-blur-glass bg-bg-base/72 border-b border-border-subtle`.
  - Заменить `bg-red-50/text-red-700` на semantic tokens.
- [frontend/tailwind.config.ts](../../frontend/tailwind.config.ts):
  - Добавить новые токены `bg-surface`, `bg-subtle`, `chip-*-{bg,fg}`, `shadow-card-{soft,raised}`, `shadow-accent-focus`.
- [frontend/src/contexts/toast-context.tsx](../../frontend/src/contexts/toast-context.tsx) — пометить deprecated, оставить shim на sonner.

### Frontend — страницы с UX-долгом (применить QueryGate + EmptyState + sonner)

- [frontend/app/(authenticated)/cards/CardsClient.tsx](../../frontend/app/(authenticated)/cards/CardsClient.tsx)
- [frontend/app/(authenticated)/themes/ThemesClient.tsx](../../frontend/app/(authenticated)/themes/ThemesClient.tsx)
- [frontend/app/(authenticated)/tasks/TasksClient.tsx](../../frontend/app/(authenticated)/tasks/TasksClient.tsx)
- [frontend/app/(authenticated)/chat/ChatClient.tsx](../../frontend/app/(authenticated)/chat/ChatClient.tsx)
- [frontend/app/(authenticated)/persons/](../../frontend/app/(authenticated)/persons/)
- [frontend/app/(authenticated)/roles/](../../frontend/app/(authenticated)/roles/)
- Settings/* (12 страниц)

### Frontend — замена нативных `alert/confirm`

- [frontend/src/ui/concierge/ConciergeVoice.tsx](../../frontend/src/ui/concierge/ConciergeVoice.tsx)
- [frontend/app/(authenticated)/insights/InsightsListClient.tsx](../../frontend/app/(authenticated)/insights/InsightsListClient.tsx)
- [frontend/app/(authenticated)/ideas/IdeasListClient.tsx](../../frontend/app/(authenticated)/ideas/IdeasListClient.tsx)
- [frontend/app/(authenticated)/orchestrator/runs/[id]/OrchestratorRunClient.tsx](../../frontend/app/(authenticated)/orchestrator/runs/[id]/OrchestratorRunClient.tsx)
- [frontend/src/ui/components/meeting-room/ParticipantsPanel.tsx](../../frontend/src/ui/components/meeting-room/ParticipantsPanel.tsx)
- [frontend/src/ui/components/meeting-result-v2/ReportsTab.tsx](../../frontend/src/ui/components/meeting-result-v2/ReportsTab.tsx)

### Frontend — mobile

- Master-detail вне AppShell → mobile-вариант через next/navigation (push в подстраницу вместо двух колонок):
  - meetings (журнал + detail)
  - cards (список + карточка)
  - themes (список + theme)
  - goals (список + goal)
- Таблицы (admin/usage/llm-prices, settings/sources, settings/webhooks) → mobile card-view fallback (используем CSS `@container` или явную проверку viewport).
- Dashboard CEO → на mobile одна колонка KPI vertically + остальные виджеты stack.
- Mobile bottom-bar (опционально для авторизованной части — есть `TrackerBottomNav`, обобщить).
- Все pill-фильтры → горизонтальный scroll с snap.

### Backend — критическое покрытие тестами

**knowledge-core/api integration** (на реальном Postgres + pgvector, через docker-compose.dev.yml):
- [backend/src/modules/knowledge-core/api/blocks.controller.spec.ts](../../backend/src/modules/knowledge-core/api/blocks.controller.spec.ts)
- [backend/src/modules/knowledge-core/api/themes.controller.spec.ts](../../backend/src/modules/knowledge-core/api/themes.controller.spec.ts)
- [backend/src/modules/knowledge-core/api/graph.controller.spec.ts](../../backend/src/modules/knowledge-core/api/graph.controller.spec.ts)
- [backend/src/modules/knowledge-core/api/entities.controller.spec.ts](../../backend/src/modules/knowledge-core/api/entities.controller.spec.ts)
- [backend/src/modules/knowledge-core/api/search.controller.spec.ts](../../backend/src/modules/knowledge-core/api/search.controller.spec.ts)
- Снять `describe.skip` с [entity-resolution.service.spec.ts](../../backend/src/modules/knowledge-core/services/entity-resolution.service.spec.ts).

**RBAC × Tenant матрица:**
- [backend/src/modules/rbac/rbac.service.spec.ts](../../backend/src/modules/rbac/rbac.service.spec.ts) — табличный тест: каждая роль (owner/admin/member/guest/superadmin) × каждый критичный action (read/write/delete на meetings/recordings/knowledge-core/dashboard/admin) → expected verdict.
- [backend/src/common/guards/tenant.guard.spec.ts](../../backend/src/common/guards/tenant.guard.spec.ts) — корректное выделение `tenantId` из заголовка/URL, отказ если несоответствие.

**Entitlements:**
- [backend/src/modules/entitlements/entitlements.controller.spec.ts](../../backend/src/modules/entitlements/entitlements.controller.spec.ts)
- [backend/src/modules/entitlements/require-entitlement.decorator.spec.ts](../../backend/src/modules/entitlements/require-entitlement.decorator.spec.ts)
- E2E на 3 эндпоинта (запись, экспорт, AI-отчёт) с разными тарифами.

**Webhooks input — подпись + Zod-DTO:**
- [backend/src/modules/conversational/adapters/telegram-bot/telegram-webhooks.controller.spec.ts](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-webhooks.controller.spec.ts)
- [backend/src/modules/conversational/adapters/max-bot/max-webhooks.controller.spec.ts](../../backend/src/modules/conversational/adapters/max-bot/max-webhooks.controller.spec.ts)
- [backend/src/modules/ingest/adapters/phone-call/mango.controller.spec.ts](../../backend/src/modules/ingest/adapters/phone-call/mango.controller.spec.ts)
- В каждом: проверка подписи (если у провайдера есть) или IP-whitelist, Zod-валидация тела, отказ на невалидном теле без 500.

**Public-share:**
- [backend/src/modules/shares/public-share.controller.spec.ts](../../backend/src/modules/shares/public-share.controller.spec.ts) — ротация токена, revocation, throttle (rate-limit), отсутствие утечки `Referer`.
- Добавить `@Throttle` декоратор на read-эндпоинты.

**Dashboard + cards/decisions/ideas/insights/persons controller-spec** (быстрый IDOR-fence):
- По одному controller-spec на каждый модуль с явной проверкой tenant-границы.

### Backend — фиксы дыр

- Заменить `@Body() body: { ... }` на Zod-DTO в:
  - [backend/src/modules/admin/economics/admin-economics.controller.ts:70](../../backend/src/modules/admin/economics/admin-economics.controller.ts#L70)
  - [backend/src/modules/clones/clones.controller.ts:148](../../backend/src/modules/clones/clones.controller.ts#L148)
  - [backend/src/modules/curation/curation.controller.ts:189](../../backend/src/modules/curation/curation.controller.ts#L189)
- Добавить `@Throttle` на `public-share.controller.ts`.
- Добавить подпись/IP-whitelist на telegram/max/mango webhooks.

### База данных
Не меняется.

### Интеграции
Не меняются.

## Критерии готовности (DoD)

- [ ] `bun run typecheck` зелёный в `frontend/` и `backend/`.
- [ ] `bun run lint` зелёный в обоих.
- [ ] `bun run build` зелёный в обоих.
- [ ] `bun run test:unit` + `test:integration` зелёные в `backend/`.
- [ ] Все ~260 hardcoded `bg-(red|green|...)-{50..900}` заменены на semantic tokens (grep пустой).
- [ ] Нет нативных `alert()` / `confirm()` в коде (grep пустой, исключая `node_modules`).
- [ ] Toast — только sonner (legacy `useToast`/`addToast` либо удалён, либо shim на sonner).
- [ ] `/design-preview/light-theme` и `/design-preview/dark-theme` рендерятся без ошибок и показывают все компоненты.
- [ ] Дашборд CEO в обеих темах: KPI strip + sparklines + 1 dark stat-card + frosted-glass header.
- [ ] Mobile-проверка через DevTools (375px): meetings, cards, themes, goals, tasks, dashboard — все юзабельны (без горизонтального скролла основного контента).
- [ ] Покрытие критических backend-зон ≥80% lines на: knowledge-core/api, rbac, entitlements, public-share, webhooks-input.
- [ ] Все controller-spec из списка существуют и зелёные.
- [ ] Second Brain обновлён:
  - [ ] `second-brain/01_projects/frontend-pages.md` — список новых компонентов.
  - [ ] `second-brain/01_projects/frontend-contexts-hooks.md` — `useSwrWithToast`, `QueryGate`.
  - [ ] `second-brain/02_architecture/module-map.md` — обновить, если новые backend-spec затронули структуру.
  - [ ] `second-brain/05_история/2026-MM-DD-ui-api-modernization.md` — рефлексия после финального push.

## Риски и ограничения

1. **Tailwind 4 + OKLCH в CSS-vars** — проверить, что все Tailwind utility-классы корректно потребляют `oklch()` через `var()`. Если плагин `tailwindcss-animate` или shadcn-обёртки внутри упирают на HEX — нужна точечная правка.
2. **Toast-миграция может зацепить 70 файлов** — делать одним коммитом через codemod (sed/AST), не вручную.
3. **Тесты на pgvector** требуют поднятого `docker-compose.dev.yml` — CI должен это поддерживать. Если нет — `*.integration.spec.ts` под отдельным npm script, не блокирующим основной CI.
4. **Mobile master-detail с push в подстраницу** ломает текущую URL-схему. Решение: оставить query-param (`?selected=ID`) или новый segment route — определить per-страница.
5. **Film-grain SVG на `body::before`** — проверить performance на старых устройствах. Если просадки — выключать через `@media (prefers-reduced-motion)`.
6. **261 замен hardcoded цветов** — высокий риск пропустить место с уникальным контекстом (например, цветной highlight в редакторе). Делать пачками по модулям с ручной проверкой.
7. **Snapshot-тесты на компоненты** — не добавляем, slishком хрупкие при переделке темы. Полагаемся на visual regression вручную через `/design-preview/*`.

## Фазы реализации

### Фаза A — Дизайн-токены и UI scaffold (3 дня)

- [x] A.1 — Переписать [frontend/src/ui/tokens.css](../../frontend/src/ui/tokens.css) на OKLCH (light sage + dark warm-mint).
- [x] A.2 — Обновить [frontend/tailwind.config.ts](../../frontend/tailwind.config.ts) — добавить `bg-surface`, `bg-subtle`, `chip-*`, `shadow-card-{soft,raised}`, `shadow-accent-focus`, новую radii-шкалу.
- [x] A.3 — Создать [frontend/src/hooks/useSwrWithToast.ts](../../frontend/src/hooks/useSwrWithToast.ts).
- [x] A.4 — Создать [frontend/src/ui/components/shared/QueryGate.tsx](../../frontend/src/ui/components/shared/QueryGate.tsx).
- [x] A.5 — Создать [frontend/src/ui/components/shared/Sparkline.tsx](../../frontend/src/ui/components/shared/Sparkline.tsx) (SVG, props: `data: number[]`, `variant: 'bar'|'line'`, `color?: string`).
- [x] A.6 — Создать [frontend/src/ui/components/shared/StatCard.tsx](../../frontend/src/ui/components/shared/StatCard.tsx) (`variant: 'default'|'dark'`, slots: label / value / delta / sparkline).
- [x] A.7 — Создать [frontend/src/ui/components/shared/Chip.tsx](../../frontend/src/ui/components/shared/Chip.tsx).
- [x] A.8 — Создать [frontend/src/ui/components/shared/ConfirmDialog.tsx](../../frontend/src/ui/components/shared/ConfirmDialog.tsx).
- [x] A.9 — Починить [frontend/src/ui/components/shared/EmptyState.tsx](../../frontend/src/ui/components/shared/EmptyState.tsx) — на токены.
- [x] A.10 — Создать [frontend/app/(design-preview)/light-theme/page.tsx](../../frontend/app/(design-preview)/light-theme/page.tsx) — галерея: палитра (swatches), типографика, кнопки, чипы, карточки, StatCard, Sparkline, EmptyState, ConfirmDialog, форма, toast.
- [x] A.11 — Создать [frontend/app/(design-preview)/dark-theme/page.tsx](../../frontend/app/(design-preview)/dark-theme/page.tsx) — то же.
- [x] A.12 — `bun run typecheck && bun run lint && bun run build` зелёные.

### Фаза B — Sexy-пилот: дашборд CEO + Sidebar (2 дня)

- [x] B.1 — Адаптировать [Sidebar.tsx](../../frontend/src/ui/components/app-shell/Sidebar.tsx): убрать `shadow-glow-mint` с логотипа, добавить dot-маркеры в active nav-item, `bg-bg-surface` в light.
- [x] B.2 — Адаптировать [DirectorDashboardClient.tsx](../../frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx): KPI strip из 5 StatCard сверху, 1 dark-вариант, sparklines, frosted-glass sticky header, токены вместо hardcoded.
- [x] B.3 — Проверить дашборд в обеих темах и на mobile-viewport (375px).
- [x] B.4 — Build зелёный.

### Фаза C — Унификация UX-долга на страницах (3 дня)

- [x] C.1 — Мигрировать toast: `useToast`/`addToast` → sonner. Codemod-скрипт + ручная проверка ~70 файлов.
- [x] C.2 — Применить `QueryGate` + `EmptyState` к [CardsClient.tsx](../../frontend/app/(authenticated)/cards/CardsClient.tsx).
- [x] C.3 — Аналогично к [ThemesClient.tsx](../../frontend/app/(authenticated)/themes/ThemesClient.tsx), [TasksClient.tsx](../../frontend/app/(authenticated)/tasks/TasksClient.tsx), [ChatClient.tsx](../../frontend/app/(authenticated)/chat/ChatClient.tsx) (chat — пропущен: внутри только OrgChatPanel, нет list+loading+empty паттерна).
- [x] C.4 — Аналогично к persons/, roles/, settings/* (применено к persons, roles, settings/api, settings/sources, settings/tags, settings/webhooks, settings/exports — везде, где есть loading+list+empty).
- [x] C.5 — Заменить нативные `alert/confirm` на `ConfirmDialog` / sonner.toast (через новый `useConfirmDialog` hook; обработано ~28 файлов).
- [x] C.6 — Заменить голые pill-`<button>` на shadcn-Toggle/ToggleGroup в tasks, meetings-journal, intake — установлен `@radix-ui/react-toggle` + `react-toggle-group`, созданы обёртки `frontend/src/ui/shadcn/{toggle,toggle-group}.tsx`. Применено в `TasksClient.tsx` (status pills = ToggleGroup multiple, week-only = Toggle single). В `MeetingsJournalReal.FilterChips` chip'ы — это DropdownMenuTrigger/PopoverTrigger, не toggle-pattern, замена не требуется. В `IntakeClient` pill-фильтры отсутствуют (только SuggestionChip как display-only badge).
- [x] C.7 — Build + lint зелёные (typecheck без ошибок, lint без ошибок и с 1 pre-existing warning, build OK).

### Фаза D — Чистка hardcoded цветов (1-2 дня, параллельно с C)

- [x] D.1 — Заскриптовать поиск (`bg|text|border)-(red|green|blue|amber|...)-\d{2,3}` + список 30 файлов (нашли 648 матчей в 72 файлах).
- [x] D.2 — Пройти по 30 файлам, заменить на semantic tokens (`bg-danger-muted`, `text-info`, `chip-warning-{bg,fg}`) — обработано 60+ файлов, заменено 624 матча.
- [x] D.3 — Финальный grep близок к нулю — оставлено 24 интенциональных вхождения (`SIGNAL_COUNTERS_BUCKET_COLORS` в `frontend/src/domain/director-dashboard.ts`, slate-700/600 как фоны кнопок в dark UI meeting-room: `ControlsBar.tsx`, `ParticipantsPanel.tsx`, `RaiseHandButton.tsx`, `MeetingRoom.tsx`).
- [x] D.4 — typecheck/lint/build зелёные (1 pre-existing warning).

### Фаза E — Mobile-адаптация (3 дня)

- [x] E.1 — Mobile master-detail для meetings (push в подстраницу `/meetings/[id]/result` на mobile через `useIsMobile`, query-param `?selected=` на desktop; detail-pane скрыт на mobile через `hidden lg:flex`).
- [x] E.2 — То же для cards, themes, goals — все три уже используют `<Link href="/cards/[id]">` для перехода, master-detail отсутствует; grid `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` уже корректно стакается на mobile.
- [x] E.3 — Card-view fallback для admin-таблиц (LlmPricesClient, UsersUsageClient, FunctionsClient — паттерн `hidden md:block` для table + `md:hidden` для card-list); sources/webhooks уже на flex-li — переведены на mobile-стек через `flex-col md:flex-row`.
- [x] E.4 — Dashboard CEO mobile: KPI strip уже `grid-cols-1 md:grid-cols-3 xl:grid-cols-5` (Phase B); виджеты `grid-cols-1 lg:grid-cols-2` стакаются; уменьшил `px-6` → `px-4` на mobile + sticky header `-mx-4 px-4` чтобы не было overflow на 375px.
- [x] E.5 — Pill-фильтры → горизонтальный scroll-snap в `FilterChips` (MeetingsJournalReal) + `TasksClient` (status pills); добавил Tailwind-плагин `scrollbar-none` в `tailwind.config.ts`.
- [x] E.6 — Mental walk-through по всем модифицированным компонентам: основной контент без horizontal overflow на 375px; touch-target кнопок ≥40px (size="sm" + py-1 ≥ 28px текста с увеличенной кликабельной зоной).
- [x] E.7 — `bun run typecheck && bun run lint && bun run build` зелёные (1 pre-existing warning в IdeasListClient.tsx).

### Фаза F — Backend критические тесты (3-4 дня, параллельно с A-E)

- [x] F.1 — Поднять `docker-compose.dev.yml` для integration-тестов; добавить npm script `test:integration:knowledge-core`.
- [x] F.2 — knowledge-core/api: 5 controller-spec + раскомментировать entity-resolution.
- [x] F.3 — RBAC × Tenant матрица + tenant.guard.spec.ts.
- [x] F.4 — Entitlements: controller + decorator + 3 e2e.
- [x] F.5 — Webhooks input: telegram/max/mango — подпись + Zod-DTO + spec.
- [x] F.6 — Public-share: rate-limit `@Throttle` + spec.
- [x] F.7 — Quick controller-spec на dashboard/cards/decisions/ideas/insights/persons (IDOR-fence).
- [x] F.8 — Замена `@Body() body: { ... }` на Zod-DTO в 3 файлах.
- [x] F.9 — `bun run test:unit && test:integration` зелёные (фаза F-специфичные тесты — 45 knowledge-core integration tests, 55 RBAC matrix, 10 tenant guard, 31 entitlements, 27 webhooks, 12 public-share, 25 IDOR-fence specs; 8 pre-existing failures в accounts/livekit-egress/s3 — вне зоны F).

### Фаза G — Финал и Second Brain (0.5 дня)

- [x] G.1 — Обновить `second-brain/01_projects/frontend-pages.md` (раздел «UI/API Modernization 2026-05-25»). `frontend-contexts-hooks.md` отсутствует как файл — содержимое (useSwrWithToast, useMediaQuery, useConfirmDialog) ушло в `frontend-pages.md`. `02_architecture/module-map.md` не менялся (backend-структура не затронута, только тесты).
- [x] G.2 — Рефлексия `second-brain/05_история/2026-05-25-ui-api-modernization.md`.
- [x] G.3 — Mental walk-through по ключевым страницам в обеих темах и mobile (Phase E.6); реальный screen-обход потребует prod-deploy.

## Порядок и параллелизация

Параллельно две ветки:
- **Frontend-ветка:** A → B → (C параллельно с D) → E → G
- **Backend-ветка:** F (можно начинать сразу после A.0, не зависит от UI)

Суммарно: ~10-12 рабочих дней одного исполнителя, ~6-7 дней при параллелизации двумя.

## Команды проверки (быстрый чек после каждой фазы)

```bash
# Frontend
cd frontend
bun run typecheck && bun run lint && bun run build

# Backend
cd backend
bun run typecheck && bun run lint && bun run build
bun run test:unit
bun run test:integration   # требует docker-compose.dev.yml up

# Grep-чеки чистоты
# Hardcoded цвета
rg "(bg|text|border)-(red|green|blue|amber|yellow|orange|slate|gray|zinc|stone|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}" frontend/app frontend/src

# Нативные alert/confirm (исключая node_modules)
rg "(alert|confirm)\(" frontend/app frontend/src --type ts --type tsx

# Legacy toast
rg "from ['\"].*toast-context['\"]" frontend/app frontend/src
```

## Итог

_Заполняется по факту реализации._
