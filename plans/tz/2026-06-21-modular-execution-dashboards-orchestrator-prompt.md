# Orchestrator-prompt — Модульные дашборды исполнения

Запуск `tz-orchestrator` по ТЗ `plans/tz/2026-06-21-modular-execution-dashboards.md`. Это управляющий промпт, не дубль ТЗ — все контракты в ТЗ, здесь только как вести реализацию.

## Порядок чтения на старте
1. `CLAUDE.md` + `.claude/CLAUDE.md` (инварианты, vexp-правило, Ship-On, крутилки в AdminSetting).
2. `second-brain/index.md` → `02_architecture/module-map.md`, `01_projects/api-layer.md`.
3. **ТЗ** `plans/tz/2026-06-21-modular-execution-dashboards.md` целиком — особенно REALITY-CHECK, Решения Р1–Р6, Каталог модулей, Фазы.
4. Анализ `plans/analysis/2026-06-21-modular-dashboards-and-execution-focus.md` (зачем, карта переездов).
5. **Эталон вёрстки и поведения** — кликабельный прототип `plans/analysis/2026-06-21-execution-dashboards-prototype.html` (открыть в браузере: SVG-иконки, тёмное стекло, drill-down drawer, проваливание, переключатель Было/Стало). Вёрстку модулей делать в этом визуальном языке.
6. Код-якоря из REALITY-CHECK (перечитать перед правкой — номера строк могли сдвинуться, искать по символам).

## Инструменты
- **vexp `run_pipeline({task})` первым** для каждой фазы (при живом демоне Grep/Glob заблокированы). Fallback при отсутствии демона — Explore + Grep/Read.
- **Context7** перед правкой внешних либ (SWR, Radix, Recharts, nestjs-zod) — `resolve-library-id` → `query-docs`. Не угадывать API.
- **Playwright** (`browser_*`) — визуальная приёмка собранных экранов против прототипа.

## Граф фаз (строгий порядок)
```
Ф1 (модульный слой, FE) ─┐
                         ├─→ Ф3 (Сегодня) → Ф4 (Неделя) → Ф5 (Месяц)
Ф2 (бэкенд-достройки) ───┘
```
- Ф1 и Ф2 **параллельны** (разные слои) — можно две волны разом.
- Ф3 нужен Ф1+Ф2 (canvas + данные). Ф4 после Ф3, Ф5 после Ф4 (переиспользуют модули и пресеты — нарастание День⊂Неделя⊂Месяц, Решение Р2).
- Каждая фаза = одна волна суб-агентов с собственной мини-картографией из ТЗ.

## Факт-чек (не верь отчёту агента)
После каждого суб-агента — независимая приёмка, агент мог пометить `[x]` без реальных правок:
- Греп ключевых маркеров: `WIDGET_REGISTRY`, `DashboardCanvas`, `getDynamic('dashboard.preset`, `goal-vector/by-person`, `issue-chains`, `useSearchParams` (в чат-клиенте), отсутствие `sourceBlockId: null` в `fetchBlockers`.
- re-Read изменённых файлов; `git status` в отчёт.
- Свой прогон: `bun run typecheck` (вкл. `.spec`) · `lint` · `build` (backend и frontend); `bunx vitest run` по затронутым; Swagger smoke `/api/docs` для новых эндпоинтов.
- Прогон `strict-production-review-gate` на каждую фазу перед коммитом (tenantId-границы, провенанс без битых `href`, нет дубля расчёта вектора, тон копи «работа не люди» Р6).

## Фаза закрыта, когда
Все Acceptance фазы из ТЗ машинно подтверждены (греп/тест/команда), `Закрывает: …` сверено, typecheck-lint-build-тесты зелёные, ревью-гейт пройден, коммит по фазе. Push — только с явным подтверждением владельца.

## Failure-modes (на что смотреть)
- **Пустые карточки на старте** — проверить `visibleWhen` у каждого модуля; M10 (Польза) внизу, не вверху.
- **Битый deepLink** — если `relatedBlockIdsJson` пуст / `buildProvenanceDeepLink` вернул `null`, кнопка перехода скрыта, не `href={null}`.
- **Дубль расчёта вектора** — переиспользовать `PulsePatternsService`/`PersonGoalContribution`, не считать заново.
- **Перезапись `weekly-per-person`** — он РЕАЛИЗОВАН, только потреблять (Граничные контракты ТЗ).
- **Рейтинговый тон** — формулировки про помощь, не про оценку людей.
- **`prisma migrate`/`new PrismaClient()`/`process.env.*`** — запрещены (ТЗ «Границы», CLAUDE.md).

## После последней фазы
Заполнить «Итог» в ТЗ; обновить second-brain (`module-map` — registry-слой, `api-layer` — новые эндпоинты, профильные `01_projects`); `prod-deploy-log.md` Шаг 4/12; рефлексия в `05_история/`; прод-инструкция в чат (по факту — только `schema.prisma` JSON-поле + новые эндпоинты).
