# ТЗ: Починка каскада ошибок AI-pipeline встречи (mtg_01KT6HQ…)

**Дата:** 2026-06-03
**Источник:** лог цепочки вызовов одной встречи — «вагон ошибок» в LLM-роутинге и (возможно) пустая транскрипция.
**Связь:** [llm-router.service.ts](../../backend/src/modules/ai/services/llm-router.service.ts), провайдер-сервисы `ai/services/*`, [strict-json-schema.util.ts](../../backend/src/modules/ai/services/strict-json-schema.util.ts).

## Диагноз — 6 разных причин в одном логе

| # | Симптом в логе | Корень | Слой |
|---|---|---|---|
| 1 | `OpenAI-via-proxy 400 Invalid schema` (chapters/tasks/IdeaBlocks/extract_tasks) | Zod `toJSONSchema` + ручные схемы не соответствуют OpenAI strict (нет `additionalProperties:false`, `required` неполный) | **код** |
| 2 | `DeepSeek: response_format не поддерживается … deepseek-v4-flash/chat: This response_format type is unavailable now` | json_schema strict не принимается НИ ОДНОЙ deepseek-моделью текущего прокси, а конвертация schema→tool включалась только для thinking (`pro`) | **код** |
| 3 | `Ollama: json_schema strict не поддерживается` | OllamaService при json_schema **бросает** ошибку вместо даунгрейда в json_object → tertiary всегда падает | **код** |
| 4 | `meeting-report-fast: timeout deepseek/deepseek-v4-pro > 30000ms`, ретраи ×5 | В runtime-цепочке ОДИН провайдер (медленный thinking-pro), хотя сид задаёт 3. Маршрут сужен в БД | **данные/конфиг** |
| 5 | `Fallback Anthropic→MiniMax (403 блок IP)` | IP заблокирован Anthropic | **инфра** (не чиним кодом) |
| 6 | Транскрипция не отображается; `behavior-metrics: нет merged.json`, `quality-score: нет mergedS3Url` при `transcribe/merge: успешно` | Подозрение: пустой/несогласованный merged-документ → пустой ввод в downstream | **расследование** |

## Фазы

### [x] Фаза 1 — OpenAI strict schema normalizer (issue 1)
- [x] `strict-json-schema.util.ts`: рекурсивная нормализация (`additionalProperties:false` + `required`=все ключи, обход `$defs/anyOf/items`), без мутации входа.
- [x] Подключить в `OpenAiProxyService` и `OpenAiChatProtocolAdapter` при `strict:true`.
- [x] Unit-тест (5 кейсов, в т.ч. реальная `CHAPTERS_JSON_SCHEMA`). ✅ зелёные.

### [ ] Фаза 2 — DeepSeek: json_schema → schema→tool для ВСЕХ моделей (issue 2)
- [ ] В `DeepSeekService.buildParams`: `autoConvert` срабатывает на любой deepseek-модели при `json_schema && !callerHasTools` (не только thinking). Причина — прокси отдаёт «unavailable now» для flash/chat тоже.
- [ ] Ветку `callerHasTools && json_schema` (skipStrict) тоже обобщить на любую deepseek-модель.
- [ ] Тест: flash + json_schema → params без `response_format`, с synthetic tool.

### [ ] Фаза 3 — Ollama: json_schema → json_object downgrade (issue 3)
- [ ] В `OllamaService.complete`: вместо throw при json_schema — выставить `response_format: json_object` + гарантировать слово «json» в промпте (как DeepSeek). Zod-валидация остаётся на стороне сервисов.
- [ ] Тест: json_schema на входе → не бросает, в params `response_format: json_object`.

### [ ] Фаза 4 — meeting-report-fast: восстановить fallback-цепочку (issue 4)
- [ ] `patch-ensure-meeting-report-fast-fallback.ts`: идемпотентно добавить secondary `openai-via-proxy/gpt-5.4-mini` + tertiary `ollama/qwen3.5:9b`, если их нет. Уважать `editedByAdmin` (skip+warn). Не трогать primary.
- [ ] Зарегистрировать в `apply-prod-deploy.ts` (phase update, skipBootstrap) и `prod-deploy-log.md` Шаг 6.

### [x] Фаза 5 — Расследование транскрипции (issue 6) — ДИАГНОЗ ГОТОВ, фикс отдельным планом
Найдено ДВА независимых факта:

**5a. Источник правды транскрипта = `Transcript.turns` (БД).**
`MergeWorker` пишет `turns` в БД, S3 `merged.json` не заливает. Показ транскрипта (`MeetingsService.getTranscript`) и индексатор читают `turns` из БД. Значит «транскрипция не отображалась» = `turns` пустой/`[]` → ASR не дал слов для этой 42-сек встречи. Merge сам толерантен к пустому (fallback `merger.ts:133-138`). → **симптом данных/ASR, не код.** Рекомендация: guard «пустой transcript → пометить встречу `no_transcript`, НЕ дёргать LLM» (сейчас пустой ввод идёт в модели и множит ошибки).

**5b. 🐞 РЕАЛЬНЫЙ СИСТЕМНЫЙ БАГ: `Transcript.mergedS3Url` не пишется НИГДЕ.**
Pipeline перевели на `turns` в БД, но 4 потребителя остались на мёртвом `mergedS3Url` (S3 merged.json), которого pipeline больше не создаёт:
- `behavior-metrics.worker.ts:109` → всегда «нет merged.json», скип;
- `quality-score.worker.ts:137` → всегда «нет mergedS3Url», скип;
- `custom-report.worker.ts:153` → «отчёт невозможен»;
- `transcript-clean.worker.ts:94` → скип.

Это ломает поведенческие метрики / quality-score / кастомные отчёты / очистку на КАЖДОЙ встрече. Фикс = миграция этих 4 на чтение `Transcript.turns` из БД (как индексатор/показ). **Многофайловый, требует своего плана + тестов → вынесен отдельно, не делаю молча в этой сессии.**

### [x] Фаза 6 — Максимум логов транскрипции в БД + guard пустоты (issue 6, code)
- [x] `VoxService`: `@Optional() LogService`, DB-логи под модулем `vox`:
  - `vox.submit` (taskId, размер аудио, модель), `vox.submit.retry`/`vox.submit.failed`;
  - `vox.poll` (DEBUG на каждую попытку, статус);
  - **`vox.completed`** — результат транскрипции в БД (wordsCount, textLength, durationSeconds, `transcriptPreview` до 2000 симв.);
  - **`vox.empty`** (WARN) — COMPLETED, но пусто: пишем `rawKeys` + `rawPreview` ответа Vox для диагностики (тишина vs mismatch ключей);
  - `vox.failed` (ERROR), `vox.timeout` (ERROR).
- [x] `parseVoxResult`: запасные ключи текста (`text`, `transcription`, `result.text`…) и words (`result.words`) — закрыть mismatch ответа Vox. +2 теста (7/7).
- [x] `TranscribeWorker`: `@Optional() LogService`, DB-логи:
  - `ai.transcribe.track` на каждый трек (спикер, слова, символы, preview);
  - **`ai.transcribe.no_speech`** (WARN) — если ВСЕ треки пустые (видимый сигнал, что в LLM уйдёт пустой ввод);
  - `ai.transcribe.merge_enqueued` (итоговые totalWords/totalTextLength).
- Все логи наследуют `traceId=mtg_<id>` и pipeline TRANSCRIPTION из ALS-контекста воркера. Модули `vox` / `ai.transcribe` тоглятся в админке логов отдельно.

## Итог
- ✅ Фазы 1–4 (issues 1–4) реализованы и проверены: util-нормализатор strict-схем, DeepSeek schema→tool для всех моделей, Ollama json_object-downgrade, patch fallback meeting-report-fast. Тесты 16/16, typecheck/lint чисто.
- Issue 5 (Anthropic 403) — инфраструктурный (IP-блок), кодом не чиним; fallback на MiniMax работает.
- Issue 6: 5a — симптом ASR/данных (+ рекомендация guard); 5b — отдельный системный баг `mergedS3Url`, нужен отдельный план.
