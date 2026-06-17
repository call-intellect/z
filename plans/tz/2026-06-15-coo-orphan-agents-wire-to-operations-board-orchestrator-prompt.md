# Orchestrator-prompt — Подключение агентов «Операционного директора» к UI (доска «Аналитика»)

Ты — ведущий разработчик-оркестратор. Реализуй ТЗ **`plans/tz/2026-06-15-coo-orphan-agents-wire-to-operations-board.md`** фаза за фазой силами суб-агентов, с независимой приёмкой. Это не «новое строим», а «подключаем уже готовый бэкенд к фронту» + 2 backend-доводки + доставка дайджеста с персональной галочкой.

## Порядок чтения на старте (обязательно)
1. `CLAUDE.md` и `.claude/CLAUDE.md` (корень) — инварианты, стек, правила git/Prisma/флагов.
2. `second-brain/index.md` → `01_projects/` (дашборды/operations) — фактическое состояние.
3. **ТЗ целиком:** `plans/tz/2026-06-15-coo-orphan-agents-wire-to-operations-board.md` — единственный источник scope/контрактов/acceptance.
4. Анализ-обоснование: `plans/analysis/2026-06-15-coo-operational-director-module-agents-and-dashboards.md` (откуда взялся orphan-слой) + визуальный прототип `plans/analysis/2026-06-16-coo-dashboards-prototype.html` (раскладка «Аналитики»).
5. Код-якоря — перед каждой фазой перечитывай файлы из её «Картографии» (номера строк в ТЗ — на момент написания, **верифицируй грепом по символу**, они дрейфуют).

## Инструменты
- Контекст по нашему коду: `run_pipeline({task})` первым (если vexp-демон жив — Grep/Glob заблокированы хуком). Если демон недоступен — Grep/Read/Explore.
- Внешние либы (SWR, Zod/nestjs-zod, Radix, Tailwind) — Context7 (`resolve-library-id` → `query-docs`), не угадывай API.
- vexp — про наш код, Context7 — про внешние либы. Не путать.

## Граф фаз и порядок
Порядок: **Ф1 → Ф2 → Ф3 → Ф4 → Ф5 → Ф6 → Ф7 → Ф8.**
- **Ф1** (меню «Аналитика» + секционный каркас доски + 6 pulse-виджетов) — **пререквизит** для Ф3/Ф4/Ф5/Ф7 (они монтируются в секции, созданные в Ф1). Делать первой.
- **Ф2** (заглушки goals/decisions), **Ф6** (team-health факторы), **Ф8** (доставка+галочка) — независимы, можно параллелить, но соблюдай общий порядок ценности.
- Каждая фаза самодостаточна для одного суб-агента за сессию (своя картография, «Что НЕ входит», acceptance).

## Ключевые ловушки (вынесены из ТЗ — не наступи)
- **Props pulse-виджетов НЕ единообразны** (раздел «Контракт-first»): `data` (объект) у BusFactor/RecurringTopics/Bottleneck; `meetings` (массив) у LowRoiMeetings; `decisions`+`alertCount` у IrreversibleDecisionsAlert; только `data` (без loading/error) у KnowledgeVelocityKpi. Передать не тот shape = TS-ошибка/пустой виджет.
- **Один общий SWR** на `getPulsePatterns` (не 6 запросов одного тяжёлого эндпоинта).
- **Новые виджеты — ВНЕ ветки `reworkEnabled`** (Р-4): это чужой kill-switch, не оборачивать.
- **Аналитика — на доску `/dashboard/operations` (метка «Аналитика»), НЕ на главную «Сегодня»** (Р-1). Главную не трогаем.
- **Новые поля DTO team-health/team-detail — опциональные** (3 потребителя, обратная совместимость).
- **N+1:** CustomerRisk `limit≤20`; team-health.decisions — агрегатная выборка, не цикл per-dept.
- **Ф8 ↔ Telegram-план** (`plans/tz/2026-06-11-assistant-channels-telegram-max.md`): перед стартом `git fetch` + `git log --since="1 day"` — не идёт ли тот план параллельно по тем же файлам (`EVENT_TYPE_CHANNEL_POLICY`, адаптеры ботов). Правки только аддитивные (ключ `operations.daily_digest`).
- **Миграций БД НЕТ** во всём ТЗ. Если фаза «требует» миграцию — стоп, перечитай (поля уже в схеме). `prisma migrate` запрещён; в скриптах `createPrismaClient()`.
- **Ship-On:** ни одного нового OFF-флага. Ф8 **убирает** флаг `deliver_to_telegram` (был OFF-дефолт).
- Дубли: `IrreversibleDecisionsAlert` vs `TopRiskCard`; orphan `TeamHealthGrid` — выбрать один, не плодить.
- Drill-down `/decisions/[id]` (по аудиту 2026-06-15 страница есть) — перепроверь перед кликабельной ссылкой; `/meetings/[id]` для LowRoi — тоже.

## Факт-чек суб-агентов (не верь отчёту)
После каждого суб-агента — **сам** проверь, не по его словам:
- Грепни acceptance-маркеры фазы (имена компонентов/методов/ключей в файлах) — суб-агент мог пометить «[x]» без реального Edit (`feedback_agents_can_lie_about_edits`).
- Сам прогони `bun run typecheck && bun run lint && bun run build` (frontend и/или backend по фазе) + `bunx vitest run` затронутых spec. Зелёное — условие закрытия фазы.
- `git status` перед коммитом — фильтруй чужие staged-файлы (`feedback_git_index_hygiene`); коммить только пути своей фазы, явным перечислением (никаких `git add -A`).

## Определение «фаза закрыта»
Все acceptance-предикаты фазы выполнены (грепом/командами) И typecheck/lint/build/vitest зелёные И сделан фазовый коммит `тип(область): описание` с явным перечнем путей.

## Коммиты и push
- Коммит **по фазам** (Conventional Commits). Между волнами не останавливайся: зелёная приёмка → commit → следующая фаза в том же ответе (`feedback_orchestration_no_stop_between_waves`).
- **Push — только с явным подтверждением владельца**, отдельно на каждый push. Разрешение на коммит ≠ разрешение на push.

## По завершении (триггеры CLAUDE.md)
- Обнови `second-brain/`: профильная `01_projects/` (дашборды/operations) + `02_architecture/module-map.md` (новый эндпоинт `promise-network`, опц. `GET /me/notification-preferences`).
- Закрой строку 2026-06-15 «orphan-слой COO» в `second-brain/04_не-сделано/README.md` (перенеси в «Закрытые») по мере подключения.
- `docs/operations/prod-deploy-log.md`: Шаг 12 (Swagger smoke новых эндпоинтов), Шаг 1 (удаление ENV `COO_DAILY_DIGEST_DELIVER_TO_TELEGRAM`) + строка в `docs/operations/feature-flags.md`; миграций/скриптов-на-запуск нет → прод = `docker compose up -d --build`.
- Рефлексия в `second-brain/05_история/`.
- Сформируй prod-инструкцию в чат (diff команд или «prod-операций нет, достаточно `docker compose up -d --build`»).

## Failure-modes (стоп и переспроси владельца)
- Понадобилась миграция БД / новая модель Prisma → стоп (ТЗ это исключает).
- Telegram-план реально идёт параллельно и трогает те же файлы → согласуй порядок, не мерджи вслепую.
- `getPulsePatterns` на проде >300мс при выводе всех виджетов → добавь Redis-кэш TTL 300с (числовой триггер из ТЗ), не раньше.
