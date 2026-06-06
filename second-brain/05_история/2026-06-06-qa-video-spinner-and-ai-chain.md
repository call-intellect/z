---
title: "QA-прогон 2 — видео-крутилка (Vidstack load) + разбор AI-цепочки встречи"
date: 2026-06-06
tags: [qa, recording, video, vidstack, knowledge-core, ai-pipeline, diagnosis]
---

# QA-прогон 2: почему не играло видео + что реально происходит с AI-цепочкой

## Что было поставлено
Владелец перевёл тест-аккаунт «ооо ромашка» на **платный** тариф (пэйвол снят, ядро разблокировано) и вручную провёл видеовстречу `01KTDHPTHS9T5YGXFANKES765J` («рассказ коллективу о проекте», team, ~47с, 45 слов транскрипта). Задача — разобрать ЭТУ встречу под капотом: (1) **почему видео не проигрывается** (крутилка) и починить; (2) запустилась ли AI-цепочка агентов и где проблемы; (3) что попало во «второй мозг»; (4) создаётся ли руководителю клон.

## Как решал
Связка «живой пользователь + под капотом», послойно:
- `diag trace/report/chain --meeting <id>` — FSM, отчёт, AI-вызовы, технический след (101 запись).
- Прямой HTTP-probe S3 (`curl` HEAD + Range) — доступность и тип файла.
- Playwright на `/meetings/<id>/result` — реальный плеер; инспекция `<video>` через `browser_evaluate` (src/readyState/networkState/error), сетевые запросы, консоль.
- Context7 — дефолт пропа `load` у Vidstack `<MediaPlayer>`.

## Что вышло
**Видео (🔴 главное, ПОЧИНЕНО):** корень — **чисто фронтовый**. Доказательная цепочка:
- Файл цел: egress `EGRESS_COMPLETE`, `composite.mp4` 17.6 МБ на S3.
- `GET /recording/download` → валидный presigned-URL → файл = **206 Partial Content**, `video/mp4`, `Accept-Ranges: bytes`.
- Ручная подстановка presigned-URL прямо в `<video>` + `.load()` в том же браузере → `loadedmetadata`, **`readyState=4`, 1280×720, 48.7с, error=null** → видео полностью играбельно.
- Штатный плеер: `<video src="">`, `networkState=0`, запрос к файлу не делается, обёртка `aria-busy=true` навсегда.
- Причина: Vidstack `<MediaPlayer>` (@vidstack/react ^1.12.12) с **дефолтным `load="visible"`** (Context7) грузит медиа только по входу в зону видимости через IntersectionObserver — на странице результата он не срабатывает. `MeetingPlayer.tsx` не передавал `load`.
- **Фикс (1 строка):** `load="eager"` на `<MediaPlayer>` ([frontend/src/ui/components/meeting-result-v2/MeetingPlayer.tsx](../../frontend/src/ui/components/meeting-result-v2/MeetingPlayer.tsx)). Typecheck/lint/build зелёные. Запушен в `sergdev` (commit `8fab2fc2`). Ждёт прод-деплоя фронта для проверки вживую.

**AI-цепочка (отработала, 2 бага):** FSM прошёл чисто (room→active→egress→recording_ready→transcription→ai_processing→ai_ready). ASR (vox), summary/report-by-type/tasks (MiniMax), главы/extract-actions (DeepSeek), meeting-report-fast (DeepSeek v4-pro) — все LLM **ok**. Но:
- 🟠 **meeting-report-fast потерял результат при записи:** `aiResult.create()` → `Unique constraint failed (meetingId)` (основная analyze-цепочка уже создала запись). `reportStatuses.reportFast="partial"`, `summaryFast/customOutputMd/followUpEmail=null`. Должен быть **upsert**. Это ДРУГОЙ корень того же симптома, чем прежняя память (там падали провайдеры — здесь падает только ЗАПИСЬ).
- 🟡 block-linker один раз получил невалидный JSON арбитра → ретрай → ок.

**Память компании (✅ наполняется):** RawEvent → IdeaBlocks (3 канонических) → Entities (резолвер ×6) → 2 связи графа; +6 задач, 7 глав, summary+решения, qualityScore, meeting-ROI, behavior-metrics, transcript-index. Темы не сформированы — порог (canonicalCount 2 < 3), для 45-словной встречи ожидаемо.

**Клон (ℹ️ by design):** `/clones` → «Всего: 0… появятся автоматически по накоплению обсуждений ДЛЯ КАЖДОЙ ДОЛЖНОСТИ». Клоны **ролевые, не персональные** — руководителю клон от одной встречи не создаётся. В конвейере встречи шага создания персоны нет. Не баг.

**Побочно:** S6-03 — «Задач не найдено» при 6 извлечённых (разные экраны считают из разных источников: 0/1/5/6); S5-02 — «0м / 100% тишина» (тайминги транскрипта = 0, ASR без пословных таймкодов → поведенческая аналитика нулевая); S6-04 — сырые англо-ключи `tasks/decisions` в Обзоре.

Все находки — [plans/analysis/2026-06-05-manual-qa-RESULTS.md](../../plans/analysis/2026-06-05-manual-qa-RESULTS.md), раздел «ПРОГОН 2».

## Чему научился
- **Послойная локализация «крутилки» решает спор «бэк или фронт».** Приём-победитель: вручную подставить рабочий presigned-URL прямо в `<video>` и вызвать `.load()` — если `readyState=4`, файл/кодек/сертификат/S3 исправны, и проблема ровно в том, что приложение не присвоило `src`. Это сразу отмело faststart/moov и увело в стратегию загрузки Vidstack.
- **Прежняя гипотеза «видео не играет = faststart/moov-в-конце» — неверна** при наличии Range на S3 (206): браузер дочитывает moov из хвоста и играет. Память `project_recording_tracks_participants_unresolved` исправлена.
- **`<video src="">` + `networkState=0` + чистая консоль = приложение не инициировало загрузку**, а не сетевая/cert-ошибка (та дала бы `networkState=3`/`error`). Дёшево различать по состоянию элемента.
- **`create()` vs `upsert()` на уникальном `meetingId`** — повторяемый класс в пост-обработке встречи (один симптом «нет fast-отчёта» = разные корни: провайдеры ИЛИ запись). Проверять по `diag chain` ERROR PrismaService, а не только по статусу провайдеров.
- **Параллельные сессии:** рабочее дерево держало незакоммиченные правки ТЗ-2 (22 `[id]/page.tsx`, async params) и 2 незапушенных билинговых коммита ТЗ-1 на `sergdev`. `git add` строго по путям + проверка `git diff --cached --stat` спасли от захвата чужого.
