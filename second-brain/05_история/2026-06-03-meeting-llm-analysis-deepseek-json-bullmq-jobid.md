---
type: reflection
date: 2026-06-03
distilled: false
---

# 2026-06-03 — После встречи не прошёл LLM-анализ: DeepSeek json + BullMQ jobId

## Постановка

Прошла видеоконференция, должен был сгенерироваться LLM-отчёт встречи — не
сгенерировался. Дан длинный лог backend. Разобрать, что в нашем коде, починить,
протестировать.

## Что сделал

**Триаж лога — разделил на код vs инфра.** Пайплайн дошёл: запись → S3 →
транскрипция (Vox) → merge. Дальше отчёт упал. Корни:

1. **DeepSeek json_object (КОД, главный блокер).** `meeting-report-fast` →
   Anthropic 403 (IP-блок) → DeepSeek → `400 «Prompt must contain the word
   'json'...»`. DeepSeek (OpenAI-compat) требует слово «json» в сообщениях при
   `response_format: json_object`, а промпт его не содержал → дисптач падал
   целиком (DeepSeek был isLast). Фикс: в `deepseek.service.ts buildParams` при
   json_object без слова «json» подмешиваю подсказку в system. Коммит `52b9ba82`.

2. **BullMQ jobId с ':' (КОД).** `enqueueQualityScore/MeetingRoi упал: Custom Id
   cannot contain :`. Залез в `node_modules/bullmq` — правило: ':' допустим
   только если `split(':').length === 3`. `quality:<meetingId>` (1 ':') падал,
   `<meetingId>:analyze:<attempt>` (2 ':') — работал (поэтому analyze шёл, а
   quality/roi нет). Прошёлся по всему кодбейзу: ещё ~7 сломанных jobId (export,
   invoice-выплаты, webhook delivery, intake-triage, demo-cleanup, import-tracker,
   tbackfill). Перевёл все на '_'. Коммит `b9ff5a24`.

**Инфра/env/прод-схема (НЕ код, зафиксировал в отчёте, не чинил):**
- Anthropic 403 «вероятно блок IP», openai-proxy `certificate has expired`,
  Ollama `401 Invalid API key format`, EmbeddingFallback все провайдеры упали —
  инфра/секреты.
- `column "dataClassAudit" does not exist` (DataClassAuditSnapshotCron) — дрейф
  прод-схемы: колонка есть в `schema.prisma`, но не применена на проде
  `db push`. Cron best-effort, анализ не блокирует.

Обе кодовые грабли — в `code-pitfalls.md`.

## Что вышло

- DeepSeek spec: 7/7 (вкл. 2 новых на инъекцию слова json).
- `bullmq-jobid-rule.spec.ts`: 4/4 (правило + исправленные форматы).
- Обновил ассерт `import.service.spec` (`import-tracker:` → `import-tracker_`).
- typecheck/lint всех 12 затронутых файлов — чисто.
- После DeepSeek-фикса отчёт встречи генерируется через DeepSeek даже при
  IP-блоке Anthropic.

## Чему научился

1. **Триаж лога: сначала раздели код vs инфра.** Половина WARN/ERROR (Anthropic
   403, cert expired, Ollama 401, dataClassAudit) — не код. Не чинить то, что
   чинится секретом/деплоем; чётко сказать пользователю, что вне кода.
2. **Провайдер-специфичные кварки LLM API.** DeepSeek json_object ⇒ обязательно
   слово «json» в промпте. Подобные требования (как и thinking-модели без strict
   json_schema) держать в провайдер-адаптере, а не у вызывающих.
3. **Читать исходник зависимости при странной ошибке.** «Custom Id cannot contain
   :» звучит как «никаких ':'», но в bullmq код — `split(':').length !== 3`.
   Точное правило нашлось только в node_modules. Не угадывать — смотреть.
4. **Один симптом → весь класс.** Нашёл `quality:` — прогрепал весь кодбейз и
   нашёл ещё 7 латентных. Чинить класс, а не один кейс.

## Что осталось

- **Прод-операции (не код):** обновить секреты/инфра (Anthropic IP, openai-proxy
  cert, Ollama key) и применить `dataClassAudit` на прод-БД (`db push`).
- `BehaviorMetricsWorker: нет merged.json` — WARN, возможна гонка; не
  воспроизведено, отдельная задача если повторится.

## Прод-команды

Код: пересборка `backend` образа (DeepSeek + jobId). Миграций/seed/ENV в коде нет.
Отдельно (инфра, вне этого пуша): починить ключи/cert провайдеров LLM/embeddings
и применить схему с колонкой `dataClassAudit` на прод-БД.
