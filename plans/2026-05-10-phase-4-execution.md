---
type: execution-plan
phase: 4
feature: knowledge-core — Card на новой базе + Theme + clusterer + Card-rollup-v2
status: completed
date: 2026-05-10
---

# Фаза 4 — backend ✅ + frontend ✅ закрыты.

## Backend (закрыто)

- [x] **Шаг 1.** Prisma: `Theme`, `ThemeIdeaBlock`, `ThemeEntity`, расширения `Card.entityId/relatedEntityIds/bornFromThemeId/cachedTopThemeIds`. Enum'ы `ThemeStatus`, `ThemeDynamic`, `ThemeBranch` (12 веток). Коммит `19559e0`.
- [x] **Шаг 2.** `ClusteringService` (KNN-greedy union-find), `ThemeClassificationService` (LLM `theme-classify`), `ThemeClustererCron` (`@Cron('15 * * * *')`). Порог `THEME_CLUSTERING_MIN_BLOCKS=100`. Коммит `9fa2ebc`.
- [x] **Шаг 3.** `CardRollupV2Service` (5 промптов по `Card.kind`), `CardRollupV2Worker` (consumer `core.card-rollup-v2`, debounce 60s). Старый `card-rollup.worker` не трогаем. Коммит `d256f04`.
- [x] **Шаги 4+5+6.** Themes API (`GET .../themes`, `:id`, `POST :id/save-as-card`), `GET /api/v1/cards/:id/themes`, `ReframingCron` расширен под split/merge/archive тем (split — только лог). `policy.csv` для resource `theme`. Документация. Коммит `0fac6e1`.

## Frontend (закрыто)

- [x] `frontend/src/domain/theme.ts` — `ThemeDomain/ThemeApi`, mapper'ы, лейблы веток/dynamic/status (12 веток + null), типы `ThemeDetail*`, `CardThemeMini*`.
- [x] `frontend/src/api/themes.api.ts` — `themesApi.list/get/saveAsCard` на `apiClient`.
- [x] `frontend/src/api/cards.api.ts` — добавлен `cardsApi.listThemes(cardId)`.
- [x] `frontend/app/(authenticated)/themes/page.tsx` + `ThemesClient.tsx` — список AI-тем, фильтр по 12 веткам, поиск, тумблер активные/архивные, empty state «AI ещё не обнаружил темы».
- [x] `frontend/app/(authenticated)/themes/[id]/page.tsx` + `ThemeDetailClient.tsx` — деталка с блоками + сущностями + кнопкой «Сохранить как карточку», обработкой 409 `card_name_taken`, баннером для `merged_into`.
- [x] `frontend/src/ui/components/cards/CardThemesSection.tsx` — мини-секция «AI обнаружил эти темы» в sidebar overview карточки (top-3, скрыта если items пуст).
- [x] `frontend/src/ui/components/app-shell/Sidebar.tsx` — пункт навигации «AI-темы» (Sparkles) между «Карточки» и «Мои встречи».
- [x] ApiDto → DomainModel слои по правилам frontend-rules. `bun run typecheck` зелёный.
