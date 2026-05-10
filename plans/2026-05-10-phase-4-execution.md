---
type: execution-plan
phase: 4
feature: knowledge-core — Card на новой базе + Theme + clusterer + Card-rollup-v2
status: backend-completed-frontend-pending
date: 2026-05-10
---

# Фаза 4 — backend ✅ закрыт (4 коммита). Frontend ⏳ в следующую сессию.

## Backend (закрыто)

- [x] **Шаг 1.** Prisma: `Theme`, `ThemeIdeaBlock`, `ThemeEntity`, расширения `Card.entityId/relatedEntityIds/bornFromThemeId/cachedTopThemeIds`. Enum'ы `ThemeStatus`, `ThemeDynamic`, `ThemeBranch` (12 веток). Коммит `19559e0`.
- [x] **Шаг 2.** `ClusteringService` (KNN-greedy union-find), `ThemeClassificationService` (LLM `theme-classify`), `ThemeClustererCron` (`@Cron('15 * * * *')`). Порог `THEME_CLUSTERING_MIN_BLOCKS=100`. Коммит `9fa2ebc`.
- [x] **Шаг 3.** `CardRollupV2Service` (5 промптов по `Card.kind`), `CardRollupV2Worker` (consumer `core.card-rollup-v2`, debounce 60s). Старый `card-rollup.worker` не трогаем. Коммит `d256f04`.
- [x] **Шаги 4+5+6.** Themes API (`GET .../themes`, `:id`, `POST :id/save-as-card`), `GET /api/v1/cards/:id/themes`, `ReframingCron` расширен под split/merge/archive тем (split — только лог). `policy.csv` для resource `theme`. Документация. Коммит `0fac6e1`.

## Frontend (в следующую сессию)

- [ ] `frontend/app/(authenticated)/themes/page.tsx` — список AI-тем с фильтром по branch.
- [ ] `frontend/app/(authenticated)/themes/[id]/page.tsx` — страница темы (description + блоки + кнопка «Сохранить как карточку»).
- [ ] На странице Card — секция «AI обнаружил эти темы» (через `GET /api/v1/cards/:id/themes`).
- [ ] ApiDto/DomainModel/UiModel слои по правилам frontend-rules.
