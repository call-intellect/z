---
title: Встреча→трекер + модели + системные баги — остаток unified-ТЗ (A2-корень, E, F1–F8, G, D5)
date: 2026-06-22
distilled: false
---

# Что было поставлено

Доделать остаток единого ТЗ `plans/tz/2026-06-22-meeting-to-tracker-and-models-unified-fix.md` СВЕРХ блоков A–D, которые параллельная сессия уже закрыла через поглощённое ТЗ `tasks-subsystem-unified-fix` (создать+спросить+запомнить, напоминания, единый триаж). На мою долю — корень и системный слой:

- **A2** — главный корень «задач нет»: авто-триаж промоутит задачу со встречи (`source=meeting`) в `Issue` ВСЕГДА (неназначенная, дефолт-проект «Из встреч», fallback «Входящие»), без требования исполнителя/проекта/порога confidence. Доказан детерминированным replay 0→7 PASS, не интуицией.
- **E** — 4 ИЗВЛЕКАЮЩИХ taskType (`meeting-extract-actions`, `decision-extract`, `idea-extract`, `insight-extract`) → primary `deepseek-v4-pro`; арбитры/триаж/линкеры остаются Flash; `defaultModel` не трогать.
- **F1–F8** — системные баги конвейера: идемпотентность combined-пути решений (F1), proxy-400 «json» (F2), полнота combined-пути идей/решений (F3), vox `no_words`-метрика + ре-сабмит (F4), сторож зависших дорожек / неотранскрибированная встреча (F5), `Goal:0`/no_owner (F6), ложная диагностика AGE vs LLM (F7), толерантная Zod quality-score (F8).
- **G** — diag-наблюдаемость: дефолт-домен `korateam.ru`, серверный фильтр LLM-вызовов по `meetingId`, лимит превью промпта (крутилка), harness `replay-task-chain.ts`/`ab-extract-model.ts` + how-to.
- **D5** — решения встречи в UI (секция в карточке встречи + фильтр `/decisions?meeting_id=`).

# Как решал

- **Картография 9 агентов** по зонам ТЗ (A2/E/F-серия/G/D5) — точные точки правки в коде до начала, чтобы развести кодеров по непересекающимся файлам.
- **3 волны кодеров** в одном git worktree со строгой **дизъюнктностью по реальным файлам** (не по «фича-зонам»): F1 и F3 оба трогают `specialists-combined` — отданы одному агенту, чтобы не словить конфликт конструктора/писателя; diag (G1/G3) — отдельная зона; recordings (F5) — отдельная.
- **Приёмка после join каждой волны:** backend `typecheck` + `lint` + целевые `.spec` зелёные; повтор replay 0→7 после кода A2; коммит по фазам (14 коммитов).
- **Модели (E):** правка маршрутов через сиды `seed-llm-task-routes-{tracker-phase3,decisions,insights,ideas-and-probe}.ts` (для чистого bootstrap) + `patch-task-extractor-route-pro.ts`, зарегистрированный в `apply-prod-deploy.ts` STEPS `phase:'patch'` `skipBootstrap` (для апгрейда прода). SYSTEM-промпты не тронуты — prompt-cache сохранён.
- **Крутилки/флаги** — всё в AdminSetting (registry + сид + строка в `feature-flags.md`), ни одной новой ENV; tracker.meetingTasksAlwaysPromote / chatbox.taskExtraction.enabled / recording.trackWatchdogEnabled — kill-switch ON; ai.usageLog.previewMaxBytes / goals.* / recording.trackWatchdogTimeoutMinutes — крутилки.

# Что вышло

- 14 коммитов, ветка → dev. **Миграций Prisma НЕТ, новых ENV НЕТ** — всё доезжает через `apply-prod-deploy.ts` (seed-base + phase=patch) + `docker compose up -d --build`.
- **replay 0→7 PASS** (детерминированный, на реальных данных эталонной встречи): текущая логика давала 0 `Issue` (совпало с продом — 5 в `/intake`), фикс A2/A6 → 7 `Issue`.
- Backend `typecheck`/`lint` зелёные; все целевые спеки зелёные.
- 2 новые метрики (`z_vox_outcome_total{outcome}`, `recording_track_watchdog_total{outcome}`), 1 новый cron (`track-egress-watchdog`), новых probe/eventType нет.
- Документация: `feature-flags.md` (3 kill-switch + 5 крутилок), `prod-deploy-log.md` (новый блок «Накоплено к выкату» + обновлена устаревшая строка про `patch-task-extractor-route-pro.ts`), профильные `01_projects/` (tracker A2, ai-jobs E+F2/F8/F4, workers-queues F5-cron, decisions F1/F3/D5, chatbox-integration B4, goals F6, admin-settings новый батч) + `02_architecture/knowledge-core.md` (F7), `04_не-сделано` (строка-покрытие в архив).

# Чему научился

- **`specialists-combined` был дефолт-прод-путём и при этом урезанным (F3).** Это серьёзнее модели (E): combined-решения/идеи шли БЕЗ триажа/веса/embedding/supporters — память тихо беднела. Вывод: при «двух ветках, делающих одно» проверять, какая ЖИВАЯ на проде, и выравнивать её полноту в первую очередь, а не оптимизировать другую.
- **Корень доказывают replay'ем, а не интуицией.** «Фильтр 4» (авто-триаж без owner-fallback) выглядел одним из пяти тихих фильтров; детерминированный replay 0→7 на реальных данных вычленил именно его как решающий — и тот же replay стал приёмкой фикса.
- **Параллельные кодеры в одном worktree безопасны при строгой дизъюнктности ПО ФАЙЛАМ + приёмке после join.** Делить по «фича-зонам» опасно: F1 и F3 жили в одном `specialists-combined` — их нельзя было отдать разным агентам.
- **«Схема корректна» по картографии vs прод-ошибка → defensive tolerance, а не спор (F8).** Картография уверяла, что Zod quality-score совпадает с ответом модели, но прод стабильно падал `categories: expected object, received undefined`. Решение — `z.preprocess` (плоское→вложенное, clamp, отбрасывание лишнего), а не доказательство «схема же правильная». Толерантность к дрейфу формата LLM дешевле, чем недельная ловля «почему иногда не парсится».
