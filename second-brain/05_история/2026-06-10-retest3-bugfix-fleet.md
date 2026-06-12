---
title: Реализация retest3 — фикс открытых багов (Ф1–Ф9)
date: 2026-06-10
type: история
---

# retest3 — фикс открытых багов прогона тестировщика (korateam.ru)

## Что было поставлено
Реализовать ТЗ `plans/tz/2026-06-10-bugfix-fleet-retest3.md` (9 фаз, backend+frontend)
как оркестратор: картография → код суб-агентами/руками → личная приёмка → коммит по
фазам → push. Питающий анализ диаризации — `plans/analysis/2026-06-10-diarization-timing-rootcause.md`.

## Как решал (фаза → корень → коммит)
- **Ф1 #70** `e696d831` — pulse-patterns 500: `select` ссылался на несуществующую
  реляцию `PersonGoalContribution.person` (есть только скаляр `personId`). Убрал
  select, имена/отделы — отдельным `person.findMany` → Map.
- **Ф2 #72/#71/#73/#56** `a442fc37` — json-режим LLM единым классом: общий
  `json-mode.util` (`ensureJsonWordInUser`/`appendJsonWordToUser` — слово «json» в
  ХВОСТ USER, НИКОГДА в SYSTEM, cache-safe), применён в openai-proxy/deepseek/ollama;
  quality-score: убрал tool-инструкцию из промпта + нормализация плоской структуры
  →`{categories}`; extract-actions: `tryParseJson` + router-`validate`; флаг
  forceToolChoice дефолт ON.
- **Ф5 #51** `5781b43f` — главный отчёт через DeepSeek: `LlmFallbackService` две
  ветки по `LLM_MAIN_REPORT_PRIMARY`; **D1** — сброс `model` перед minimax/openai
  (иначе берут имя deepseek-модели); **D3** — DeepSeekService в workers.module
  (был только @Global). per-agent `deepseek-v4-pro` для summary/report/follow-up.
- **Ф6 #85/#80** `1f035158` — structure DTO `building→forming` (статус в БД/на фронте
  = forming); новый роут `/ideas/[id]` (переиспользует вынесенный IdeaDetailPane) +
  `ideaHref`.
- **Ф7 #57/#58/#39б** `73af1791` — `stripContextMarkers` (все формы маркеров,
  сохраняет переводы строк) в 4 утечках + ChatV2Client; отступ FAB; «AI»→«Кора».
- **Ф4 #75** `9550d382` — gap материализации по canonical-срезу (Decision/Idea из
  canonical; draft/merged больше не дают ложный WARN).
- **Ф3 #74 + гард** `0652c365` — диагностика пустых дорожек + один ре-submit при
  битом аудио; frontend-гард `isDiarizationDegenerate` (UI «недоступно» вместо
  «130 мин речи»). **#26 НЕ написан** — блокер ШАГ-0 smoke (прод).
- **Ф8 #81/#82/#84/#78/#38/#77/#83** `a9289d54` — копирайт/локализация (русский 404,
  resourceTypeRu бэк+фронт, section-labels, ~47 «Org»→«компания», daily-digest,
  превью встречи, убрана строка модели, описание проекта). Делегировано кодеру,
  верифицировано грэпом+typecheck.
- **Ф9 #18/#15** `048be10e` — единый `PASSWORD_RULE_HINT`; роль Telegram-бота в
  инвайтах. **#20/#24** (Sidebar UX) и **#17** (прод-ретест) — вынесены в
  `plans/tz/2026-06-10-onboarding-nav-and-prod-retest-followup.md`.

## Что вышло (верификация)
- **typecheck** backend+frontend — зелёный; **build** backend (`tsc -p`) и frontend
  (`next build`, включая новый `/ideas/[id]`) — успешны.
- **Тесты:** все мои спеки зелёные одним прогоном — **backend 91** (11 файлов),
  **frontend 25** (4 файла). Новые гарды: json-mode cache-safety, quality-score
  нормализация (через реальный поток воркера), LlmFallbackService две ветки,
  graph gap canonical, transcribe ре-submit, stripContextMarkers, diarization
  degenerate, resource-type union, password rule.
- **Картография** одним Workflow (9 read-only Explore-агентов параллельно) сэкономила
  много чтения и поймала дрейф линий (напр. findMany 375 vs ТЗ 381) — но 1 агент не
  вернул структуру (F4), замаплено руками; ещё 1 агент дал НЕВЕРНОЕ направление по F1
  (предложил ДОБАВИТЬ реляцию = миграция, которую ТЗ отверг) — хорошо, что F1 сделан
  сам.

## Чему научился
- **Прод-зависимые фазы честно блокируются.** #26 (тайминги Vox) и #17 (ретест) без
  «можно в прод» не делаются — но рядом есть безопасная ценность (#74 диагностика +
  гард абсурдных метрик), которую можно выкатить и без прода. Вынес блокеры в реестр
  «не-сделано» + follow-up ТЗ, не выдал несделанное за сделанное.
- **Sidebar (1106 строк) — не место для спешки в конце.** #20/#24 — связная
  перестройка с role-gating; крамить её в хвост 9-фазного свода = риск регрессии на
  все 30 пользователей. Отдельный ТЗ + ревью честнее.
- **Гард без миграции возможен производным от уже сервящихся полей.** Вырожденную
  диаризацию определил по `totalSpeechMs > totalDurationMs*1.5` (а не новой колонкой)
  — ТЗ запрещало миграции в Ф3.
- **Делегирование кодеру окупается на механике (Ф8 ~62 файла), но требует грэп-фактчека:**
  агент корректно различил display vs value resourceType и нашёл доп. сайты, но
  верификация всех заявленных правок грэпом + typecheck обязательна (агенты врут про [x]).
- **Бэктики в `git commit -m` ломают bash heredoc** — сообщения с ```json/`код`
  коммитить через `-F file`.
