---
title: Батч из 5 ТЗ — probe-система Ф2 + хлебные крошки + Лента в дашборды + задачи встречи в трекере + баннер онбординга
date: 2026-06-18
type: reflection
distilled: false
---

# Батч из 5 ТЗ (A→B→D→C→E) — рефлексия 2026-06-18

## Что было поставлено

Реализовать батчем 5 ТЗ по зонтичному плану в порядке A→B→D→C→E
(ветка `feature/knowledge-base-redesign-formatter`):

- **A** — `plans/tz/2026-06-17-fix-incomplete-setup-banner-progress.md`: баннер «N из 6»
  берёт прогресс из `onboardingApi.getSetupProgress` (устаревший источник давал неверное число). Фронт-only.
- **B** — `plans/tz/2026-06-16-intake-issue-linked-meeting-ids-fix.md`: задачи встречи видны
  в карточке встречи — `IntakeIssue.meetingId` протянут в `Issue.linkedMeetingIds`. Миграция + backfill.
- **D** — `plans/tz/2026-06-17-cabinet-breadcrumbs-and-mobile-back.md`: сквозные хлебные крошки
  + мобильная «назад». Фронт-only.
- **C** — `plans/tz/2026-06-17-cora-feed-into-dashboards.md`: «Лента Коры» вынесена в виджет
  `CoraFeedWidget` на `/dashboard` и `/me`; страница `/feed` удалена. Фронт-only.
- **E** — `plans/tz/2026-06-17-probe-system-phase2.md` (Ф1–Ф6): доведение probe-системы (Layer 6) —
  свободный ответ `probe_reply`, LLM-судья качества `probe-quality-judge`, выбор получателя по
  отзывчивости, семантический дедуп через pgvector, re-ask, ingest-повод
  `attribution.unresolved_at_ingest`.

## Как решал

- Оркестрация суб-агентами **фаза-за-фазой**: для каждой фазы — точный промпт кодеру,
  затем независимая приёмка (греп ключевых маркеров + re-Read изменённых файлов +
  свой `typecheck`/`build`/целевые тесты), затем коммит по фазам.
- Многоволновая работа без остановок между волнами: зелёная верификация → commit →
  следующая фаза в том же проходе.
- Probe Ф2–Ф4 потребовали БД-изменений: 2 миграции
  (`add_intake_issue_meeting_id`, `add_probe_event_question_embedding`), HNSW-индекс
  `idx_probeevent_qembed_hnsw` в `postgres-init.sql`, новый taskType `probe-quality-judge`
  (seed-route `seed-llm-task-routes-ideas-and-probe.ts`), пачка probe.*-крутилок в
  `seed-admin-settings.ts`, backfill `backfill-meeting-linked-ids.ts` (все seed/backfill уже в
  `apply-prod-deploy.ts` STEPS).

## Что вышло

- 16 коммитов (A `2d7fd244`; B `73836b7c`; D `8ef49108`+`eb0f7dee`; C `9aa3945e`+`10dbbe35`;
  E `9430383f`/`cf9c3878`/`b7b32e64`/`855197a4`/`553c93e9`/`ea27594e`).
- Всё зелёное: `build` exit 0, 384 теста probe/dialog/adapter.
- Запушено.
- Прод-операции: 2 авто-миграции (`migrate deploy`), 1 HNSW в postgres-init, seed/backfill —
  штатно агрегатором `--mode update`, docker rebuild backend+frontend. Полный diff —
  в `docs/operations/prod-deploy-log.md` §«Накоплено к выкату» блок 2026-06-18.
- НЕ выполнено (ручной шаг): Ф5 визуальная qa-приёмка крошек (D) и Ленты (C) — занесено в
  реестр «не-сделано».

## Чему научился

- **(а) Общая dev-БД загрязнена миграциями параллельной ветки → `migrate dev` хотел сделать
  reset.** Обошёл БЕЗ `db push` и БЕЗ reset: `prisma migrate diff --from-schema-datamodel HEAD
  --to-schema-datamodel` → ручной `migrate/migration.sql` → `prisma db execute` применил его на
  dev-БД → `prisma migrate resolve --applied <dir>` пометил применённым. Это даёт корректный
  файл миграции (источник правды) без сноса чужих данных. `db push` тут запрещён правилом
  (версионируемые миграции), reset снёс бы работу параллельной сессии.
- **(б) Параллельная сессия Claude Code коммитит в ТУ ЖЕ ветку (общий HEAD).** Все мои коммиты
  целы, но в `git log` ветки чередуются с чужими. Перед каждой волной — `git fetch` + `git log`,
  чтобы не принять чужой коммит за свой и не сломать чужой `[x]`.
- **(в) Картография может дать неверный путь файла — всегда верить грепу / re-Read, не отчёту
  агента.** Конкретно: `probe-formulate.prompt.ts` реально лежит в
  `backend/src/modules/knowledge-core/prompts/`, а НЕ в `probe/prompts/` (промпты probe
  разнесены между двумя модулями: формулировка в knowledge-core, судья качества в
  `probe/prompts/`). И: модель `Card` НЕ имеет скалярных `department`/`client`/`project` —
  привязка идёт через `entityId` / граф. Слепо доверившись отчёту, можно отредактировать не тот
  файл / сослаться на несуществующее поле.
- **(г) `bun run typecheck` на backend падает OOM без `NODE_OPTIONS=--max-old-space-size=8192`.**
  Большой проект (~1.7к строк schema, ~45 модулей) — node по умолчанию не хватает кучи. Запускать
  typecheck бэка с поднятым лимитом.
