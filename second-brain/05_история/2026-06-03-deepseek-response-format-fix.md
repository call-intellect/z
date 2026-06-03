---
distilled: false
---

# 2026-06-03 — DeepSeek response_format fix + унификация дешёвой модели (deepseek-chat → flash)

## Что было поставлено
Владелец прогнал боевую встречу на проде и прислал лог. Задача: посмотреть лог,
резюмировать, потом по шагам чинить. Начали с двух его пунктов:
1. Дешёвые DeepSeek-задачи должны использовать только `deepseek-v4-flash`, не легаси `deepseek-chat`.
2. Разобраться с `400 «This response_format type is unavailable now»` на flash/chat.

## Как решал
**Диагностика по логу.** Весь AI-слой деградировал. Два РАЗНЫХ провала DeepSeek:
- `json_schema` (chapters/tasks/block-ingest/meeting-extract-actions) → «unavailable now».
- `json_object` (meeting-report-fast, v4-pro) → «Prompt must contain the word 'json'».

**Боевой probe** (`scripts/eval/probe-deepseek-formats.ts`, параметризовал по `PROBE_MODEL`,
прогон на `deepseek-v4-flash`) + офиц. дока DeepSeek подтвердили эмпирически:
- работают только `json_object` (со словом «json» в промпте) и `tools + tool_choice='auto'`;
- `json_schema` (strict и нет) — мёртв на ВСЕХ моделях V4, включая flash;
- forced/required `tool_choice` — мёртв («Thinking mode does not support this tool_choice»),
  даже на flash → у V4 thinking-ограничения на всех моделях.

**Фикс — провайдер-уровневый в `deepseek.service.ts`** (коммит `85e5cd8e`):
- `json_schema` для ЛЮБОЙ модели → авто-конверт в tool-путь (раньше gate `isThinking`,
  из-за чего flash/chat падали). `tool_choice` уже всегда `'auto'` — единственное, что было верно.
- `json_object` → `ensureJsonWord()`: гарантирует «json», дописывая в хвост user
  (SYSTEM не трогаем ради prompt-cache, memory `feedback_llm_prompts_cache_friendly`).
- `llm.types.ts`: исправлен неверный комментарий («json_schema поддерживается DeepSeek V4»).
- тесты `deepseek.service.spec.ts`: два теста фиксировали сломанное поведение flash — переписаны.

**Унификация модели** (коммит `2680dc7a`): `patch-deepseek-chat-to-flash.ts` (generic-свип
всех LlmTaskRoute, идемпотентный, `editedByAdmin` не трогает) + 14 сидов `seed-llm-task-routes-*`
+ запись в `apply-prod-deploy.ts` STEPS + блок в `prod-deploy-log.md`.

## Что вышло
- typecheck чистый (×2), deepseek unit-тесты 7/7, ESLint чистый, patch dry-run валиден,
  snapshot-рассинхрона нет.
- `deepseek-chat` как боевая модель не осталась нигде (только прайс-строка + комментарий патча).
- Запушено в `feature/goals-okr-v2` (`ca4d5ed8..2680dc7a`). Прод-операции: rebuild backend +
  `patch-deepseek-chat-to-flash.ts --apply` (Prisma/ENV/очереди не трогаются).

## Чему научился
1. **DeepSeek-V4 НЕ поддерживает `response_format: json_schema` — ни на одной модели, включая
   flash.** Рабочих пути структурированного вывода ровно два: `json_object` + слово «json` в
   промпте, ИЛИ `tools + tool_choice='auto'`. `tool_choice` forced/required тоже не работает
   (thinking-ограничение на всех V4). Это провайдерская инвариантность — лечить на уровне
   `deepseek.service.ts`, а не в каждом caller'е.
2. **`deepseek-v4-flash`/`deepseek-v4-pro` — реальные публичные имена DeepSeek-V4** (не алиасы
   прокси). Старые публичные имена были `deepseek-chat`/`deepseek-reasoner` — отсюда мой ложный
   первый вывод про шлюз. Урок: проверять гипотезу про эндпоинт через Context7/доку до утверждений.
3. **Probe-скрипты окупаются.** Один боевой прогон 8 вариантов (~$0.001) превратил «вероятно,
   со стороны DeepSeek» в точную карту «что работает / что мёртво» — и снял риск с фикса.
4. **Ветка переключилась в течение сессии** (`dev` → `feature/goals-okr-v2`, параллельная
   работа в репо). Перед коммитом обязателен `git status` + `branch --show-current`. Эта ветка
   на 2 коммита позади `dev`, где лежат хотфиксы `52b9ba82` (json-word) и `b9ff5a24` (jobId) —
   мой провайдер-гард перекрывает json-word по сути, но при мерже с dev это надо свести.

## Открытые хвосты из того же лога (ждут решения владельца)
- `EmbeddingFallback: openai-proxy certificate has expired` + `local URL не задан` →
  `TranscriptIndexerService` падает, транскрипт не индексируется в pgvector.
- BullMQ jobId с `:`: `enqueueQualityScore` / `enqueueMeetingRoi` → «Custom Id cannot contain :»
  (хотфикс `b9ff5a24` на dev не покрыл эти 2 места / не в этой ветке).
- `column "dataClassAudit" does not exist` (42703) → `prisma db push` не применён на проде.
- `behavior-metrics: нет merged.json` → метрики поведения не считаются.
- Ollama 401 (Invalid API key format) — третичный fallback нерабочий.
