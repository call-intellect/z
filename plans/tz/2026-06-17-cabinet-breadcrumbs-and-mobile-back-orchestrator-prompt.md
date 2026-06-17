# Orchestrator-prompt — Сквозные крошки + мобильная кнопка «назад»

Запусти этот промпт скиллом `tz-orchestrator`, когда владелец скажет «начни реализацию». Промпт самодостаточен; тело ТЗ не дублирует — ссылается.

## Контракт (читать в этом порядке)
1. `CLAUDE.md` + `.claude/CLAUDE.md` — инварианты, Ship-On, git-правила.
2. `plans/tz/2026-06-17-cabinet-breadcrumbs-and-mobile-back.md` — **источник правды**. Особенно: REALITY-CHECK (якоря `path:line`), «Контракт-first» (дословные сниппеты файлов/API), Фазы, граф зависимостей, Допущения.
3. Код-якоря перед каждой фазой перечитать (номера строк дрейфуют — искать по символу-якорю из REALITY-CHECK).

## Инструменты
- vexp `run_pipeline` если демон жив; иначе **fallback** Explore + Grep/Read (в этой сессии vexp был недоступен — fallback штатный).
- Внешних библиотек новых нет (Radix `DropdownMenu`, `lucide-react`, SWR — уже в проекте), Context7 не нужен.

## Граф фаз
- **Ф1 (ядро: конфиг + хук + контекст)** — строго первая, всё зависит от неё.
- **Ф2 (десктоп `<Breadcrumbs>`) ∥ Ф3 (мобильная стрелка) ∥ Ф4 (регистрация имён)** — одна волна после зелёной Ф1, между собой независимы.
- **Ф5 (приёмка `qa-tester`)** — после Ф2+Ф3+Ф4.

Между волнами не останавливайся ради подтверждения ([[feedback_orchestration_no_stop_between_waves]]): зелёная верификация → commit фазы → следующая волна. Push — только с явным подтверждением владельца.

## Факт-чек (не верь отчёту суб-агента — [[feedback_agents_can_lie_about_edits]])
После каждой фазы сам, без агента:
- Грепни ключевые символы: `buildBreadcrumbTrail`, `useBreadcrumbTrail`, `BreadcrumbProvider`, `useRegisterBreadcrumb`, `SEGMENT_LABELS`, `<Breadcrumbs`, `aria-label="Назад"`.
- Ф4: грепни, что в КАЖДОМ перечисленном файле-детали реально есть вызов `useRegisterBreadcrumb(` (агенты любят отметить `[x]` без правки).
- Re-Read изменённых участков `AppShell.tsx` (слот `justify-between`) и `Header.tsx` (условный рендер).
- Прогон во `frontend/`: `bun run typecheck && bun run lint && bun run build`; юнит — `bunx vitest run frontend/src/ui/components/breadcrumbs/useBreadcrumbTrail.spec.ts`.
- `git status` в отчёт каждой фазы.

## «Фаза закрыта» =
Все Acceptance-предикаты фазы выполнены машинно (греп/тест/сборка), `Закрывает: R…` подтверждено, second-brain по DoD обновлён, `[x]` проставлен в ТЗ ПОСЛЕ верификации.

## Failure-modes (на что смотреть)
- Сырой id/slug просочился в метку (R2) — проверить fallback-ветку алгоритма.
- Мобильная стрелка на `history.back()` вместо parentHref (нарушение Р4).
- Утечка override между маршрутами (нет cleanup в `useRegisterBreadcrumb`).
- Крошки протекли в `(admin)` или сломали `IssueBreadcrumb` (должны быть нетронуты).
- Прыжок вёрстки вместо скелетона на динамическом листе (R9).
- Английские слова / жёсткие hex / `slate` в новом UI.

## Прод
Фронт-онли: нет schema/scripts/ENV/очередей/эндпоинтов. Прод-инструкция = обычная сборка+выкат фронтенда, отдельных шагов нет (блок «Prod-инструкция (B)» в чат после push). Ship-On, без флага.
