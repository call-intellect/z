---
type: reflection
date: 2026-06-08
distilled: false
---

# 2026-06-08 — Ретест №2: оверхол цепочки агентов (4 ТЗ + зонтичные 8 фаз)

## Постановка

По итогам ретеста №2 на проде (живой логин владельца) и каталога конвейера агентов
(`plans/analysis/2026-06-07-agent-pipeline-trace-and-catalog.md`) собран большой батч на ветке
`feature/retest2-agent-chain-overhaul`. Состав:

- **4 точечных ТЗ** ретеста:
  - **ТЗ A** — P0-починка детальных страниц «Таблицы» (`/tables/[id]`) — рендер-петля Zustand + 404 на pending-patches.
  - **ТЗ B** — шум smoke-теста провайдеров + недоставка алертинга.
  - **ТЗ C** — копирайт/брендинг UI (русские типы встреч, `<title>`, убрать «AI», канонизация `/chat`).
  - **ТЗ D** — поведение/длительность участников при пустых пословных таймингах ASR.
- **Зонтичное ТЗ** `plans/tz/2026-06-07-agent-chain-overhaul.md` — 8 фаз оверхола цепочки агентов
  (наблюдаемость графа · trace специалистов · recall Решений/Идей · ASR-нота · авто-привязка целей↔тем ·
  консолидация summary · кэш-маршруты · порог авто-Issue).

Ограничение из Принципа 4 (CLAUDE.md): любая правка, меняющая поведение классификации/извлечения,
требует golden ДО/ПОСЛЕ на живом LLM. Живого backend+LLM в сессии не было → такие правки занести
честно как отложенные, а не применять вслепую.

## Что сделал

Оркестрация суб-агентами: по коммиту на фазу/ТЗ, после каждого суб-агента — независимая приёмка
(греп ключевых маркеров в файлах, re-Read, свой прогон `typecheck` + `build` + `test` + `lint`).
12 зелёных коммитов:

1. `26219233` — **ТЗ A (P0 таблицы):** `useShallow` на `selectVisibleProperties`/`selectVisibleRows`
   (React #185 «Maximum update depth» из-за нестабильного селектора Zustand v5); `PendingPatchesController`
   зарегистрирован **первым** в `TablesModule` (был 404 на `GET /api/v1/tables/pending-patches`). Регресс-тесты.
2. `b31c311f` — **Ф0a наблюдаемость графа:** `GraphMaterializationService` + эндпоинт
   `GET /api/v1/platform/graph/materialization?meetingId=` (SuperAdmin) + `diag graph --meeting <id>` +
   cron `GraphMaterializationVerifyCron` (`@Cron` 30 мин, per-Org) + метрика `kc_materialization_gap_total{type}`.
   Новый `GraphDiagnosticsController`.
3. `7c9d6a21` — **Ф0b trace специалистов:** диспетчер `core.specialist-routing` оборачивает специалистов
   в pipeline-контекст `KNOWLEDGE_GRAPH` с `traceId=mtg_<id>` (видны в `diag chain`) + логи
   created/skipped/merged у decisions/ideas/goals.
4. `c8cf2602` — **Ф7 + ТЗ D поведение/длительность:** `merge.worker` при пустых `words` даёт псевдо-слову
   длительность дорожки (`track.durationSeconds*1000`) → длительность/поведение ненулевые;
   `behavior-metrics.worker` определяет `wordTimingsAvailable` → `lowConfidence`; контракт в `vox.types`.
5. `4ef90bde` — **Ф3 порог авто-Issue:** `tracker.autoAcceptConfidenceThreshold` (AdminSetting, дефолт 0.75;
   был мёртвый hardcoded 0.92).
6. `3a2d0ce4` — **ТЗ B smoke/алертинг:** `SMOKE_MAX_TOKENS=64` + кламп `max_output_tokens>=16` в openai-proxy;
   payload алертов приведён к схеме `system.message`; `runOnce` пропускает провайдеров без `baseUrl`.
7. `f1ca83f6` — **ТЗ C копирайт+чат:** `MEETING_TYPE_LABEL_RU` (русские типы встреч), `title.template '%s — Кора'`,
   убран «AI» из кабинета; `/chat` теперь рендерит `ChatV2` (`ChatClient` удалён), `/chat-v2` → redirect.
8. `0c066468` — **Ф1 recall Решений/Идей:** `block-ingest.prompt` — русские маркеры decision/idea +
   дизамбигуация (защита commitment/plan_item). Golden-фикстуры `growth-funnel` закоммичены.
9. `c9339992` — **Ф2 C1 ASR-нота:** `withAsrNote` на 10 извлекающих промптах.
10. `5f55ee35` — **Ф4.2 goal-theme-linker:** авто-привязка Goal↔Theme (провенанс + co-mention),
    `GoalTheme(source='ai')`, cron `GoalThemeLinkerCron` (`@Cron` 30 мин), on-event в specialist-3-14,
    метрика `goal_theme_autolink_total{method}`, AdminSettings `goals.themeAutolinkMinWeight` /
    `goals.themeAutolinkLlmEnabled`.
11. `ac3fa181` — **Ф5 summary-консолидация:** `pickPrimarySummary` (`summaryFast ?? summaryV2 ?? summary`)
    у всех потребителей; флаг `aiFeatures.summaryAgentEnabled` (ENV `SUMMARY_AGENT_ENABLED` + AdminSetting,
    дефолт TRUE).
12. `c381e7c8` — **Ф6 кэш:** patch `patch-llm-routes-report-chain-deepseek.ts` (summary / report-by-type /
    tasks → DeepSeek; зарегистрирован в `apply-prod-deploy` STEPS).

## Что вышло

- **12 коммитов, все зелёные** (typecheck + build + tests + lint прогонял сам оркестратор после каждого суб-агента).
- **Миграций БД нет** — `GoalTheme` и все затронутые таблицы уже существовали; фронт — пересборка.
- **Прод-операции** (полностью — `docs/operations/prod-deploy-log.md`, новый блок «🚨 2026-06-08»):
  новая ENV `SUMMARY_AGENT_ENABLED` (дефолт true); patch `patch-llm-routes-report-chain-deepseek.ts`;
  `seed-admin-settings.ts` пополнен 4 ключами; smoke — 2 новых cron + новый REST + 2 новые метрики.
- **Часть пунктов отложена осознанно** (см. ниже «Что осталось» и реестр «не-сделано») — это правильный исход:
  предусловие golden/живой LLM не было выполнено, и слепо применять промпт-правки/арбитры нельзя.

## Чему научился

1. **Golden + живой LLM — жёсткое предусловие, а не «потом».** Правки C2–C8 (классификация/извлечение) и
   все LLM-арбитры (goal-task-link, task-dedupe, idea direct-path) меняют поведение → Принцип 4 требует
   golden ДО/ПОСЛЕ. Живого backend+LLM в сессии не было → их **отложили честно**, а не применили вслепую.
   В следующий раз: при батче с промпт-правками сразу проверять, доступен ли стенд с LLM, и планировать
   golden-прогон до коммита поведения.
2. **Проект на Next.js 16 — `searchParams` это Promise.** В серверных компонентах `searchParams`/`params`
   асинхронны (`await searchParams`), иначе тип/рантайм-ошибка. Не интуичить — проверять версию Next.
3. **Zustand v5 — нестабильный селектор = рендер-петля.** Селектор, возвращающий новый массив/объект
   на каждый вызов (`selectVisibleRows`/`selectVisibleProperties`), ломает `useSyncExternalStore` →
   React #185 «Maximum update depth exceeded». Лечится `useShallow`. Это и был корень «белого экрана»
   `/tables/[id]`, который маскировался ChunkLoadError.
4. **Специалисты слоя 3 были невидимы в trace.** Диспетчер `core.specialist-routing` оборачивал их
   в контекст с `traceId=block_<id>` вместо `mtg_<id>` → в `diag chain` встречи их не видно. Теперь
   `traceId=mtg_<id>` — специалисты появляются в цепочке встречи. Урок: trace-id должен наследоваться
   от корневой сущности пайплайна (встреча), а не от промежуточной (блок).
5. **Суб-агент соврал «нет spec».** Один суб-агент заявил, что у `behavior-metrics.worker` нет теста —
   реально существовал `behavior-metrics.worker.spec`. Фактчек грепом обязателен после каждого суб-агента
   (memory `feedback_agents_can_lie_about_edits`) — подтверждено ещё раз.

## Что осталось

Отложено осознанно (занесено в `second-brain/04_не-сделано/README.md` «Открыто»):

- **ТЗ D исход б/в** (Vox word-timings submit-флаг / смена модели) — нужен прод-чтение `vox.no_words`
  (явное «можно в прод») или спека Vox API; риск 400 на угаданном параметре. Диагностика уже на месте.
- **Ф2 C2–C8 + 6 переписанных промптов** — меняют поведение классификации/извлечения → golden ДО/ПОСЛЕ
  на живом LLM. Харнесс + фикстуры готовы для dev-прогона.
- **Ф1 idea direct-path** (`upsertEntity` не создаёт Idea-строку) — параллельный create против Specialist 3.6
  рискует дублями; golden нужен.
- **Ф1 golden before/after прогон** — нужен живой backend + LLM (не прод).
- **Ф4.1 goal-task-link** (LLM-арбитр) — новый агент; качество требует golden + живого LLM.
- **Ф5 Р2 семантический дедуп задач** (LLM-арбитр task-dedupe) — golden + живой LLM.
- **Ф6 Решение Б** (shared-prefix транскрипта) — отдельное ТЗ cache-prefix-everywhere (router-wide, замер).
  **Ф6 Часть 3** (smoke cache-hit WARN) — метрика есть, калибровка отдельно.
- **ТЗ B Фаза 4 хвост:** ollama-401 (прод-конфиг), Express 5 route `/api/v1/*`, JSON-резилиенс
  speaker-analyzer & intake-auto-triage, форс `tool_choice` (нужен замер).

## Прод-команды

Полная инструкция — `docs/operations/prod-deploy-log.md` § «🚨 2026-06-08 — Ретест №2: оверхол цепочки агентов».
Кратко: миграций БД нет; пересборка backend + frontend; новая ENV `SUMMARY_AGENT_ENABLED` (опц., дефолт true);
агрегатор `apply-prod-deploy.ts --mode update` (подхватит patch `patch-llm-routes-report-chain-deepseek.ts`
+ `seed-admin-settings.ts` с 4 новыми ключами); через ≥30 мин — smoke двух новых cron + REST + метрик.
