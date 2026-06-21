# Orchestrator-prompt — Карта целей + идеи

Ты — `tz-orchestrator`. Реализуй ТЗ `plans/tz/2026-06-20-goals-map-and-ideas-tz.md` фаза за фазой силами суб-агентов, с независимой приёмкой. Не доверяй отчёту агента — верифицируй грепом/re-Read/сборкой.

## Порядок чтения на старте
1. `CLAUDE.md` + `.claude/CLAUDE.md` (vexp-first, инварианты, Ship-On, парные токены, русский UI).
2. ТЗ `plans/tz/2026-06-20-goals-map-and-ideas-tz.md` — целиком (контракт).
3. Анализ-основание (по необходимости): `plans/analysis/2026-06-20-goals-map-and-ideas/99-synthesis.md`.
4. Код-якоря (re-Read перед правкой, номера строк могли сдвинуться — ищи по символу):
   - `backend/prisma/schema.prisma` `model Goal` (`isPrimary`, `parentGoalId`, `horizon`, `embedding`) и `model Idea` (`goalId`).
   - `backend/src/modules/goals/dto/goals.dto.ts` `GoalListItemDto`; `…/goals/services/goals.service.ts` `list`.
   - `backend/src/modules/ideas/services/ideas.service.ts` `linkGoal` (образец для `promoteToGoal`).
   - `backend/src/modules/knowledge-core/services/specialist-3-14-goals.service.ts` `hierarchyArbiter` + KNN (переиспользовать в `suggest-parent`).
   - `frontend/app/(authenticated)/entities/[id]/graph/ForceGraphCanvas.tsx` (паттерн карты, НЕ копировать hex — токены).
   - `frontend/src/domain/goal.ts` `GoalDomain`, `buildTree`; `frontend/app/(authenticated)/goals/GoalsClient.tsx` `viewMode`.

## Инструменты
- vexp `run_pipeline` — первым, если демон жив. Если недоступен (как в сессии написания ТЗ) — Grep/Glob/Read напрямую (хук Grep тогда не блокирует).
- Context7 — только если усомнишься в API `react-force-graph-2d` (dagMode/dagNodeFilter/onDagError уже проверены в `node_modules/react-force-graph-2d/dist/*.d.ts` — поддерживаются в 1.29.1).
- НЕ вводить новые зависимости (React Flow/dagre/cytoscape запрещены ТЗ, Б1).

## Граф фаз
`Ф1 → Ф2 → Ф3`, затем `Ф4` и `Ф5` параллельно (обе зависят от Ф3, между собой независимы). Коммит по фазам, push — по подтверждению владельца.

## Факт-чек после каждого суб-агента (не верь [x] в отчёте)
- Грепни маркеры из Acceptance соответствующей фазы (напр. `radialout`, `promote-to-goal`, `suggestParent`, `computeGoalAlignment`).
- Грепни инвариант-гарды: в `GoalsMapView.tsx` — `grep -n "text-white\|#[0-9a-fA-F]\{3,6\}\|slate-"` должно быть ПУСТО; есть `getComputedStyle`/`--chip-`.
- `suggest-parent` — read-only: в методе нет `goal.update/create`.
- Прогоняй сам: `cd backend && bun run typecheck && bun run lint && bun run build`; `cd frontend && …`; нужные `bunx vitest run …`.
- re-Read изменённые файлы — агенты иногда метят [x] без реальных правок.

## «Фаза закрыта» =
Все Acceptance-предикаты фазы зелены машинно + `Закрывает: Rn` требования выполнены + typecheck/lint/build зелёные + (где есть) vitest зелёный.

## Failure-modes (на что смотреть)
- canvas не берёт Tailwind → агент может захардкодить hex. Заворачивать: только резолв `--chip-*-fg` через `getComputedStyle` (Б5).
- Агент может ввести React Flow «для удобства» — ЗАПРЕЩЕНО (Б1), вернуть на `react-force-graph-2d` radialout.
- orphan по семантике вместо структуры — ЗАПРЕЩЕНО (Д2); orphan = структурный обход, AI только подсказка с подтверждением.
- `promote-to-goal` без `409`-защиты → дубль целей (R11).
- Забыть `top_level` для стратегических вершин → ложные orphan (R3).
- Слой идей включён по умолчанию → нарушение Д3 (дефолт выкл).

## Прод-операций
Минимум: схема не меняется, миграций/seed нет. После выката — smoke новых эндпоинтов (`promote-to-goal`, `suggest-parent`) и расширенного `GET /goals` (Шаг 12 prod-deploy-log). Полная инструкция — в ТЗ §«Idempotency / prod-deploy».
