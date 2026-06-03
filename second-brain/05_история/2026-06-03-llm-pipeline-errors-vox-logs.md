---
date: 2026-06-03
tags: [llm-router, ai-pipeline, vox, asr, logging, deepseek, openai, ollama]
---

# Каскад ошибок LLM-pipeline встречи + максимум логов транскрипции

## Что было поставлено
Пользователь принёс лог цепочки вызовов одной встречи (`mtg_01KT6HQTXWZ107ECNY3C8HPYPJ`, 136 записей) — «вагон ошибок». Затем добавил: транскрипция не отображалась + «давай максимум логов в БД, и результат транскрипции тоже».

## Диагноз — 6 разных причин в одном логе
1. `OpenAI-via-proxy 400 Invalid schema` (chapters/tasks/IdeaBlocks/extract_tasks) — наши схемы не strict-совместимы.
2. `DeepSeek: response_format unavailable` (flash/chat) — прокси отвергает json_schema на всех моделях.
3. `Ollama: json_schema strict не поддерживается` — бросал ошибку вместо downgrade.
4. `meeting-report-fast timeout` без fallback — single-provider цепочка.
5. `Anthropic 403` — IP-блок (инфра).
6. Пустая транскрипция + `нет merged.json` — отдельная история.

## Как решал (ветка `fix/llm-pipeline-errors-vox-logs`, коммит fix(ai))
- **strict-схема (issue 1):** новый `backend/src/modules/ai/services/strict-json-schema.util.ts` — рекурсивно проставляет `additionalProperties:false` + `required`=все ключи (обход `$defs/anyOf/items`). Подключён в `OpenAiProxyService` и `OpenAiChatProtocolAdapter` ТОЛЬКО при `strict:true`. Это канон OpenAI (как `zodResponseFormat` в их SDK).
- **DeepSeek (issue 2):** в `DeepSeekService.buildParams` убрал условие `isThinking` у `autoConvert` — теперь json_schema → synthetic tool для ВСЕХ deepseek-моделей. Обновил 2 теста, которые кодировали старое «flash сохраняет strict».
- **Ollama (issue 3):** вместо `throw LlmFormatNotSupportedError` — тихий downgrade json_schema → json_object + слово «json» в промпт.
- **meeting-report-fast (issue 4):** корень — `seed-llm-default-primary-deepseek-pro.ts` создал нормализованную `tier=primary` строку, и routing перестал использовать legacy `providers` JSON (3 провайдера) → остался один. Идемпотентный `patch-ensure-meeting-report-fast-fallback.ts` дописывает secondary/tertiary. Зарегистрирован в `apply-prod-deploy.ts` + prod-deploy-log Шаг 6.12.
- **Логи транскрипции (issue 6):** `VoxService` + `TranscribeWorker` получили `@Optional() LogService`, пишут в БД-логи submit/poll/**completed (с превью текста)**/**empty (с rawKeys ответа)**/failed/timeout + по треку + `ai.transcribe.no_speech`. `parseVoxResult` теперь читает запасные ключи (`text`, `result.text/words`) — закрыть mismatch ответа Vox.

## Что вышло (верификация)
- Тесты: strict-json-schema 5/5, deepseek 7/7, vox 7/7. typecheck/lint чисто.
- `transcribe.worker.spec` падает с «Worker exited unexpectedly» — **проверено: падает и на оригинале до правок** (прекзистующий краш vitest-форка в WSL, не мой).
- Запушено в отдельную ветку (параллельная работа в dev).

## Чему научился (граблилища)
- **`z.toJSONSchema` (Zod v4) НЕ strict-совместим с OpenAI:** `.optional()/.nullable()` поля не попадают в `required`, а free-form объекты (`metadata: {type:'object'}`) запрещены strict-режимом. Централизованный нормализатор в адаптере >> правка десятков prompt-файлов.
- **DeepSeek json_schema через наш прокси не работает НИ на одной модели** (не только thinking-pro), хотя комменты в коде утверждали, что flash поддерживает. Лог — источник правды, не комменты.
- **Нормализованные `tier`-строки `LlmTaskRoute` ЗАТЕНЯЮТ legacy `providers` JSON.** Если у taskType появилась хоть одна tier-строка (primary), а secondary/tertiary не засеяли — цепочка схлопывается в один провайдер. `seed-llm-default-primary-*` мог так схлопнуть МНОГО taskType'ов — стоит провести аудит (не только meeting-report-fast).
- **🐞 `Transcript.mergedS3Url` не пишется НИГДЕ во всём backend**, но его читают `behavior-metrics`/`quality-score`/`custom-report`/`transcript-clean` → молча скипаются на каждой встрече. Pipeline перевели на `Transcript.turns` (БД), а этих 4 потребителей забыли мигрировать. Источник правды транскрипта = `Transcript.turns`, не S3. Требует отдельного плана.
- **Источник «транскрипция не отображалась»:** пустой `turns` (ASR не дал слов) → пустой показ + холостой прогон LLM по пустому вводу. Теперь это видно в логах (`vox.empty`, `ai.transcribe.no_speech`).

## Открытые хвосты
- [ ] Отдельный план: миграция 4 потребителей `mergedS3Url` → `Transcript.turns` (issue 5b).
- [ ] Аудит: какие ещё taskType схлопнулись в single-provider из-за нормализованного primary.
- [ ] Возможно — guard «пустой transcript → не ставить AI-jobs» (сейчас только логируем).
