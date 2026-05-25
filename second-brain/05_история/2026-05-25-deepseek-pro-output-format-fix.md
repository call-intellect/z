---
date: 2026-05-25
distilled: false
---

# 2026-05-25 — DeepSeek-V4-Pro output format fix (json_schema → tool)

## Что было поставлено

ТЗ [plans/tz/2026-05-25-deepseek-pro-output-format-fix.md](../../plans/tz/2026-05-25-deepseek-pro-output-format-fix.md):
DeepSeek-V4-Pro в thinking-режиме отвечает 400 на `response_format: json_schema strict` и
forced `tool_choice`. Работает только `tools + tool_choice='auto'`.
Каскад из ~100 caller-ов, использующих json_schema, сломается на первом же
запросе к Pro. Просили автоконвертацию в одном месте (`DeepSeekService`),
без правки caller-ов.

Источник эмпирики — пробник на 8 комбинаций
[backend/scripts/eval/probe-deepseek-formats.ts](../../backend/scripts/eval/probe-deepseek-formats.ts) (4 из 8 падают с 400).

## Как решал

**1. [backend/src/modules/ai/services/deepseek.service.ts](../../backend/src/modules/ai/services/deepseek.service.ts).**

- `buildParams` теперь возвращает `{ params, autoConvertedToolName? }`. Если
  `model.includes('pro')` И `responseFormat.type === 'json_schema'` И caller
  НЕ передал свои `tools` — собираю виртуальный tool
  `submit_<schemaName>` с `parameters = fmt.schema`, ставлю
  `tool_choice: 'auto'`, подмешиваю в user-сообщение фразу
  «Важно: верни результат через вызов инструмента submit_<name>.»
  `response_format` при этом НЕ выставляется.
- `mapResponse` принимает `autoConvertedToolName`: если `text` пуст и в
  `tool_calls` есть автоконвертированный — стрингифицирую его `input` обратно
  в `text`. Caller, ожидавший JSON-строку, получает её прозрачно.
- В конструктор — `@Optional() @Inject(BusinessMetricsService)` (паттерн от
  `LlmRouter`), `metrics?.incDeepseekSchemaToToolConversion({ model })` +
  `logger.debug` при срабатывании.

**2. [backend/src/common/metrics/business-metrics.service.ts](../../backend/src/common/metrics/business-metrics.service.ts).**

Новый counter `z_deepseek_schema_to_tool_conversion_total{model}` + метод
`incDeepseekSchemaToToolConversion({ model })`.

**3. [backend/src/modules/ai/services/deepseek.service.spec.ts](../../backend/src/modules/ai/services/deepseek.service.spec.ts) (новый).**

4 unit-теста по пункту 4 ТЗ:
- flash + json_schema → старый путь (`response_format: json_schema`).
- pro + json_schema без tools → автоконверт в tool, hint в user-сообщении,
  метрика инкрементируется, `text` восстановлен из `tool_calls[0].input`
  стрингификацией.
- pro + caller передал tools → автоконверта нет, метрика не растёт.
- pro + json_object → старый путь (`response_format: json_object`).

Mock SDK — `vi.mock('openai', ...)` с FakeOpenAI-классом, который сохраняет
ссылку на инстанс в `lastSdkInstance` (паттерн от `anthropic.service.spec.ts`).

**4. [second-brain/01_projects/llm-providers-verified.md](../01_projects/llm-providers-verified.md).**

Добавлен пункт 9 в раздел «Обязательные правила вызова» с описанием квирка
Pro+thinking, ссылкой на ТЗ и пробник, именем метрики.

## Что вышло

Проверки:
- `bunx vitest run src/modules/ai/services/deepseek.service.spec.ts` — 4/4 passed.
- `bunx tsc --noEmit` — мои файлы чисты. Существующая ошибка в
  `specialist-3-2-probe.service.ts:240` — pre-existing в modified-файле
  параллельной сессии, к этой задаче отношения не имеет.
- `bunx eslint` по моим файлам — 0 errors (warnings — глобальные про
  `import-x/order` resolver).

Коммит `a8b2ab6 feat(ai/deepseek): авто-конвертация json_schema → tool для V4-Pro`,
push `4f3c718..a8b2ab6 dev -> dev`.

## Чему научился

**1. Параллельные сессии могут забрать мои изменения в чужой коммит.**
Пока я работал, `Сергей мазур` параллельной сессией закоммитил
`ab687da feat(admin): Фаза 3 — AI и модели` и ВКЛЮЧИЛ туда мои hunks в
`business-metrics.service.ts` (но не deepseek.service.ts). Поэтому мой
selective-add patch на 3 хунка не применился — они уже были в HEAD.
Подтверждает существующий feedback-memory `feedback_parallel_sessions_git_check.md`:
перед commit-ом всегда `git fetch && git log --since=1h`. В этот раз сэкономило
бы 2 минуты — но не было критично, так как `git diff --cached --stat` поймал
проблему до commit-а.

**2. Индекс может быть «заминирован» параллельной сессией.**
После того, как я только начал staging, `git diff --cached --stat` показал
33 файла, которых я не трогал (admin/ai/, frontend/admin/ai/*, settings/) —
их пред-стейджила другая сессия. `git reset` (без `--hard`) безопасно
очистил индекс, working tree не пострадал. Правило: **всегда `git diff --cached --stat`
перед commit, даже если только что сделал `git add` своих файлов**. Это укрепляет
существующий `feedback_git_index_hygiene.md`.

**3. `git apply --cached --recount` для selective stage из multi-hunk patch — работает.**
Собрал mini-patch из 3 моих hunks (`sed -n` по строкам) поверх заголовка
исходного diff, применил с `--recount --whitespace=nowarn`. Идеально, когда
файл уже modified чужими правками и нужно частичное стеджирование без
интерактива (`git add -p` через Bash не работает).

**4. Подход «адаптер в одном месте» сэкономил 100+ файлов правок.**
Альтернатива — массовый рефакторинг caller-ов с `json_schema` на tools —
заняла бы день и потенциально что-то сломала бы. Конвертация в
`buildParams + mapResponse` — ~30 строк кода, прозрачно для всех caller-ов,
обратно совместимо для flash.
