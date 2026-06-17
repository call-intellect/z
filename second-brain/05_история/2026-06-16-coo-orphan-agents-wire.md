---
title: Подключение «осиротевших» агентов операционного директора к доске «Аналитика» (Ф1–Ф8)
date: 2026-06-16
type: reflection
distilled: false
---

# COO orphan-agents wire → доска «Аналитика» — рефлексия 2026-06-16

## Что было поставлено

ТЗ `plans/tz/2026-06-15-coo-orphan-agents-wire-to-operations-board.md` — подключить уже
работающий бэкенд «операционного директора» (~40 агентов, часть результатов «orphan»:
код есть, потребителя на экране нет) к доске `/dashboard/operations`. Принцип ТЗ — **не
строить новое, а подключать готовое** слой за слоем `ApiDto → DomainModel → UiModel → mount`.
Любая фича сразу включена (Ship-On, без новых OFF-флагов). Доску переименовать «Операции» →
**«Аналитика»** (маршрут не трогать). 8 фаз, ветка `feature/coo-orphan-agents-wire`.

## Как решал (по фазам, с файлами и коммитами)

- **Ф1 `ac56ce2b` — меню «Аналитика» + каркас + 6 pulse-виджетов.** В
  `frontend/src/ui/components/app-shell/nav-config.ts` (RHYTHMS_SECTION, LEADERSHIP_ROLES)
  добавлен пункт на `/dashboard/operations` с меткой «Аналитика» сразу после «Сегодня».
  `OperationsDashboardClient.tsx` — секционный каркас («Риски и непрерывность» / «Аналитика
  пульса» / «Загрузка и распределение» / «Трения») + **один** общий `useSWR` к
  `getPulsePatterns` (не 6), монтаж 6 готовых компонентов по точным props (контракты props
  НЕ единообразны): `BusFactorWidget`/`RecurringTopicsWidget`/`BottleneckHeatmapWidget` —
  `data=`; `LowRoiMeetingsWidget` — `meetings=` (массив); `IrreversibleDecisionsAlert` —
  `decisions=`+`alertCount=` (самоскрывается при 0); `KnowledgeVelocityKpi` — только `data=`.
  Виджеты смонтированы ВНЕ ветки `reworkEnabled` (Р-4).
- **Ф2 `479e4f06` — реальные данные вместо заглушек.** `team-detail.service.ts` — заглушка
  `goalsDto=[]` заменена на `findMany` по `Goal.ownerPersonId` (связь уже была в схеме —
  TODO устарел). `team-health.service.ts` — заглушка decisions `{value:0,neutral}` заменена
  на scoped count висящих решений per-department через
  `HangingDecisionsService.listHangingWithAuthors`, атрибуция по `primaryDepartmentId`,
  ОДНА агрегатная выборка с раскладкой по отделам in-memory (запрет N+1, overlap отделов
  допускается). Новые поля DTO опциональны (обратная совместимость 3 потребителей).
- **Ф3 `97d09064` — виджет «Доведение решений».** Фронт-путь к готовым эндпоинтам
  `decisions/throughput` и `decisions/stalled` (`DecisionThroughputWidget`,
  переиспользованы подписи статусов из `value-recap.ts`, подпись периода «за 90 дней»,
  `kpiTone` НЕ inverted).
- **Ф4 `70fa22ba` — «Клиенты под риском оттока».** `CustomerRiskRadarWidget` (SWR `limit≤20`
  — защита от N+1) в секцию «Риски и непрерывность» + дешёвое зеркало `customersAtRisk` в
  чтение дневного дайджеста (`CustomersAtRiskSection` в `DailyDigestClient`, вход в
  `allRuntimeEmpty`).
- **Ф5 `9d71206f` — «Знания под риском».** `KnowledgeAtRiskWidget` + минимальный backend-join
  имени эксперта (relation `soleExpert`, опц. поле `soleExpertPersonName` в DTO — чтобы не
  рендерить сырой cuid).
- **Ф6 `ee76eb82` — оживление мёртвого LLM-сигнала team-health.** За факторы вовлечённости
  (`Department.healthSummaryJson`) уже платили LLM ежедневно, но `getHealth` их не селектил.
  Добавлен `select: { healthSummaryJson: true }` + защитный парс в опц. поле `healthSummary`;
  рендер раскрытия «Почему такая оценка» (5 факторов чипами + summary + `generatedAt`,
  fallback «не посчитана») в `StructureWidgets`.
- **Ф7 `99cf6b5c` — оживление мёртвого `PromiseNetworkSnapshot`.** Снапшот писался weekly,
  читателей было 0. НОВЫЙ сервис `PromiseNetworkService` (последний снапшот, защитный парс
  нетипизированного `graphJson`, accumulators sort по inDegree) + НОВЫЙ эндпоинт
  `GET /api/v1/dashboard/operations/promise-network` (requireAccess owner/admin/coo) + виджет
  «Перегруз ответственностью» в секцию «Загрузка и распределение».
- **Ф8 `b44229ae` — дневная сводка COO в каналы по умолчанию (Ship-On).** УДАЛЁН OFF-флаг
  `operations.daily_digest.deliver_to_telegram` / ENV `COO_DAILY_DIGEST_DELIVER_TO_TELEGRAM`
  (из `env.schema.ts`, typed-config getter, `seed-admin-setting-daily-digest.ts`,
  `docs/operations/feature-flags.md`) — он нарушал Ship-On. Cron шлёт безусловно
  (идемпотентно по `deliveredAt`), kill-switch `operations.daily_digest.enabled` остаётся.
  Добавлена policy `operations.daily_digest` в `EVENT_TYPE_CHANNEL_POLICY`
  (in_app+email+telegram+max) + payload-схема в registry + whitelist ботов. НОВЫЙ эндпоинт
  `GET /api/v1/me/notification-preferences`; персональная галочка «Ежедневная сводка
  компании» в Настройки → Уведомления через существующий `optOutEventTypes` (контроль
  перешёл от глобального флага к пользователю).

## Что вышло (верификация)

По всем 8 фазам `bun run typecheck && bun run lint && bun run build` (frontend + backend, где
затронуто) — зелёные. `bunx vitest run` затронутых spec — зелёные:
- **Ф2:** +4 теста decisions (scoped count / атрибуция).
- **Ф3:** 7 тестов (DecisionThroughput/Stalled маппинг + tone).
- **Ф4:** 5 тестов (CustomerRisk + зеркало в дайджест).
- **Ф5:** 3 теста (KnowledgeAtRisk + join имени).
- **Ф6:** +2 теста (парс/опциональность `healthSummary`, обратная совместимость).
- **Ф7:** backend 4 (PromiseNetworkService + защитный парс битого graphJson) + frontend 2.
- **Ф8:** cron 6 (безусловная доставка, идемпотентность по `deliveredAt`, opt-out не трогает кабинет).

Миграций БД нет (все поля/модели уже в схеме), seed/patch/backfill на запуск нет, новых
OFF-флагов нет. Прод = `docker compose up -d --build backend frontend`. Стелс-эффект после
выката: дневная сводка COO начнёт доставляться owner/coo во все привязанные каналы по
умолчанию (контроль — персональная галочка). Не проверено вживую на проде (по расписанию
после выката) — это прод-наблюдение.

Находки по ходу: **`TeamHealthGrid` оказался НЕ orphan** (живой потребитель на `/teams`) —
не удаляли. **Адаптеры ботов не трогали по существу** — generic-ветка title+body уже
рендерит `operations.daily_digest` (хватило добавить ключ в whitelist).

## Чему научился

1. **Параллельная сессия в общем рабочем каталоге может переключить HEAD под ногами.**
   Что произошло: при коммите Ф7 другая сессия (`fix/qa-cabinet-bugfix-2026-06-16`) уже
   переключила ветку в общем `c:\work\z` — мой коммит Ф7 (`99cf6b5c`) лёг на ЧУЖУЮ ветку, а
   не на `feature/coo-orphan-agents-wire`. Почему: один рабочий каталог = один HEAD на двоих;
   `git branch --show-current` я не проверил перед коммитом. Как исправил — БЕЗ `reset --hard`
   (чтобы не убить чужие незакоммиченные изменения): `git branch -f feature/coo-orphan-agents-wire 99cf6b5c`
   (перенёс свой коммит на свою ветку) + `git branch -f fix/qa-cabinet-bugfix-2026-06-16 <её-база>`
   (восстановил чужую ветку на её исходную базу), затем вернул HEAD на свою. Чужие
   незакоммиченные изменения остались целы. **Вывод: при активной параллельной сессии
   проверять `git branch --show-current` ПЕРЕД каждым коммитом** (усиливает
   `feedback_parallel_sessions_git_check` — мало `git fetch`+`log`, нужен ещё контроль HEAD
   в общем worktree). Идеально — изоляция через отдельный git worktree, если сессии живут в
   одном каталоге.
2. **Props pulse-виджетов невыводимы по интуиции** — `data` vs `meetings` (массив) vs
   `decisions`+`alertCount` vs только-`data`. Спасло, что ТЗ выписал их дословно в
   «Контракт-first»; проверял грепом каждый props перед typecheck. Урок: для монтажа готовых
   чужих компонентов props сверять с исходником/контрактом, не угадывать.
3. **«Orphan» по грепу ≠ orphan по факту** — `TeamHealthGrid` числился кандидатом на удаление,
   но имел живого потребителя на `/teams`. Перед удалением «мёртвого» компонента —
   перепроверить импорты во всех route-группах, не только там, где смотрел.
4. **Оживить мёртвый сигнал часто дешевле, чем кажется** — `healthSummaryJson` уже считался
   и платился LLM ежедневно; чтобы вывести на экран, хватило одной строки `select` + рендера.
   `PromiseNetworkSnapshot` писался weekly вхолостую — нужен был только сервис-читатель +
   эндпоинт + виджет, без нового cron. Перед тем как «строить с нуля» — проверить, не пишет
   ли уже какой-то cron нужные данные в БД.
5. **Удаление OFF-флага по Ship-On даёт «стелс-эффект»** — снятие `deliver_to_telegram`
   молча включило доставку дневной сводки во все каналы. Такой эффект обязателен в
   prod-deploy-log явной строкой «⚠️ Стелс-эффект», иначе владелец удивится письмам/Telegram.

## Что осталось

- Закрытие строки про orphan-слой COO в `second-brain/04_не-сделано/README.md` — **отложено**:
  файл занят незакоммиченными изменениями параллельной сессии, обновит владелец в своей ветке.
- `second-brain/index.md` и `02_architecture/agent-modules.md` — тоже заняты параллельной
  сессией; при необходимости отметит владелец.
- Прод-наблюдение после выката: фактическая доставка дневной сводки в каналы + что персональная
  галочка реально отключает push, но не убирает сводку из кабинета.
- vNext-хвосты из ТЗ (вне scope): страница `/me/customer-risk` для менеджера; текст «держится
  на N людях» в KnowledgeAtRisk; onboarding-ramp виджет; синхронизация `actionUrl` дайджестов.

## Прод-команды

Полная актуальная инструкция — `docs/operations/prod-deploy-log.md`, блок
«📊 2026-06-16 — Подключение агентов «Операционного директора» к UI». Кратко:
`docker compose up -d --build backend frontend`. Миграций/seed/patch/backfill нет. ENV
`COO_DAILY_DIGEST_DELIVER_TO_TELEGRAM` удалена (если задана в прод-`.env` — можно удалить
строку). Smoke — Swagger содержит `GET /dashboard/operations/promise-network` и
`GET /me/notification-preferences`.
