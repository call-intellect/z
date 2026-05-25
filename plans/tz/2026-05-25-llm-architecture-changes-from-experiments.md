---
status: draft
created: 2026-05-25
type: tz
purpose: Копилка архитектурных изменений LLM-агентов по итогам серии экспериментов мая 2026
---

# ТЗ-копилка: архитектурные изменения LLM по итогам экспериментов

> Этот документ — **единая точка сборки** изменений по результатам наших экспериментов на реальных вызовах DeepSeek-V4-Pro. Сюда складываются ВСЕ архитектурные решения с **точными параметрами вызовов**, чтобы потом за один проход программист применил их в коде без догадок.
>
> **Документ дополняется** по мере новых экспериментов (последним появится §6 operations).

---

## 0. Контекст и принципы

### 0.1 Откуда это всё

- Серия экспериментов 2026-05-22 — 2026-05-25 на реальных вызовах DeepSeek-V4-Pro с синтетическими фикстурами.
- Полный handoff: [2026-05-25-llm-experiments-session-handoff.md](../analysis/2026-05-25-llm-experiments-session-handoff.md).
- Артефакты: `backend/test/eval/sales-merge-experiment/`, `dialog-experiment/`, `specialists-experiment/`.

### 0.2 Базовые технические факты (важно для ВСЕХ вызовов ниже)

**Модель и доступ:**
- Основная модель: `deepseek-v4-pro` (Pro с thinking, скидка 75% постоянная).
- Цены (со скидкой): `input` $0.435 / 1M, `cached_input` $0.003625 / 1M, `output` $0.87 / 1M.
- Прокси: `https://api.deepseek.com/v1` напрямую ИЛИ через наш внутренний `proxy.agent-lia.ru` (см. `LlmRouterService`).
- SDK: `openai` npm-пакет — DeepSeek совместим с OpenAI Chat Completions API.

**Критические особенности DeepSeek-V4-Pro с thinking (это тот самый «вопрос с форматом», который у нас был):**

| Что | Поддерживается? | Что делать |
|---|---|---|
| `response_format: { type: 'json_schema', strict: true }` | ❌ возвращает 400 | НЕ ИСПОЛЬЗОВАТЬ |
| `tool_choice: 'required'` | ❌ возвращает 400 «Thinking mode does not support» | НЕ ИСПОЛЬЗОВАТЬ |
| `tool_choice: { type: 'function', function: { name: '...' } }` (forced) | ❌ возвращает 400 | НЕ ИСПОЛЬЗОВАТЬ |
| `tool_choice: 'auto'` + 1 tool в массиве | ✅ работает | **рабочий путь** |
| `response_format: { type: 'json_object' }` (мягкий) | ✅ работает | для простых JSON-выходов |
| `tools: [...]` с function-schema | ✅ работает | используем |

**Главный приём** для гарантированного вызова инструмента в Pro:
1. `tools: [<один tool>]` — массив из одного инструмента.
2. `tool_choice: 'auto'`.
3. **В user-сообщении явно написать**: «Верни результат через инструмент `submit_<name>`».
4. В system-промпте дополнительно: «ВАЖНО: верни результат строго через вызов инструмента. Не пиши ничего вне tool_use.»

Без явного указания в user-сообщении модель иногда возвращает свободный текст вместо tool-call.

**Кэширование промптов** (контрольный эксперимент 2026-05-25, отчёты в `backend/test/eval/cache-experiment/reports/`):

- **Потолка ~2700 токенов НЕТ.** Гипотеза из Variant Г опровергнута: на DeepSeek-V4-Pro проверено до 43k токенов префикса — `cache_hit_ratio = 99.9%`. На gpt-5-mini через `proxy.agent-lia.ru` — до 49k токенов, `cache_hit_ratio = 99.8%`. Прокси кэш не ломает.
- **Параллельные запросы тоже кэшируются** (опровержение второй гипотезы Variant Г): 8 параллельных идентичных запросов на 10k токенов — все 8 получили hit 98.8% (DeepSeek) и 96.8% средний (OpenAI).
- **Почему в Variant Г было 21%:** каждый из 8 параллельных вызовов имел **разный** `system`, **разный** `tools` массив в payload и **разный** `submit_<name>` в конце user. Кэш совпадал только в самой начальной части общих преамбул — ~2700 токенов. Это **артефакт того, что префикс не был общим**, а не потолок DeepSeek.
- **Гранулярность кэша:**
  - DeepSeek: chunk = **64 токена**, минимум для попадания = 64.
  - OpenAI (через прокси): chunk = **128 токенов**, минимум для попадания = **1024 токена** (prompts < 1024 не кэшируются).
- **Что должно быть одинаково**, чтобы кэш сработал — **точно совпадающий префикс по байтам всего payload, включая:** `model`, `messages` (по содержимому и порядку), `tools` (если есть), `tool_choice`, `response_format` (если есть). Параметры на «хвосте» (`max_tokens`, `temperature`, `stream`) кэш не ломают.
- **Реальная экономия** при правильно построенном префиксе:
  - DeepSeek: cache miss $0.435/M → cache hit $0.003625/M = **скидка ~99%**.
  - OpenAI: $0.25/M → $0.025/M = **скидка 90%**.

**Все строки на русском.** Промпты, тексты, описания tool-параметров — на русском.

### 0.3 Главное архитектурное правило

> **Когда объединять вызовы в один:** если несколько шагов используют один и тот же тяжёлый контекст (транскрипт встречи, набор блоков). Тогда модель в одном thinking-проходе строит согласованную картину дешевле и качественнее.
>
> **Когда НЕ объединять:** если шаги работают на разных малых входах (диалог, чек-ин). Тогда объединение не даёт ни экономии (нет общего тяжёлого контекста), ни выгоды по качеству.

---

## §1. meeting-report — объединённый вызов вместо 5 шагов (от эксп.1)

### 1.1 Статус
🚧 **Параллельный агент уже частично реализует** через ТЗ [2026-05-25-meeting-report-split-from-block-ingest.md](2026-05-25-meeting-report-split-from-block-ingest.md). Нужно сверить с этим ТЗ в момент применения.

### 1.2 Эксперимент и результат

Папка: `backend/test/eval/sales-merge-experiment/`. Сравнивали:
- **Variant A** (текущая): 5 раздельных вызовов — `block-ingest` → `chapters-v2` → `tasks-v2` → `summary-v2` → `quality-score`.
- **Variant Б** (новая): 1 объединённый вызов на сыром транскрипте, возвращает `{ chapters, tasks, summary_markdown, quality_score }`.

**Победил Б** 2:1 по фикстурам, **в 3.5× быстрее, в 4.6× дешевле**, лучше глубина рекомендаций и summary. Полный отчёт: `sales-merge-experiment/reports/SUMMARY-ALL.md`.

### 1.3 Что меняется в коде

**Удаляем:**
- Промежуточный шаг `block-ingest` для типа отчёта «fast» (мы НЕ строим IdeaBlock для быстрого отчёта по встрече — это знание идёт в knowledge-core отдельно).
- 4 раздельных воркера/сервиса для chapters/tasks/summary/quality.

**Добавляем/меняем:**
- Новый taskType: `meeting-report-fast` (видны следы в `seed-llm-task-routes-knowledge-core.ts`).
- Один воркер делает один вызов и сохраняет 4 секции отчёта.

**Затронутые файлы:**
- `backend/src/modules/knowledge-core/workers/meeting-report-fast.worker.ts` — главный.
- `backend/src/modules/knowledge-core/services/chapters-extractor-v2.service.ts`, `summary-extractor-v2.service.ts`, `tasks-extractor-v2.service.ts` — упростить/удалить шаги, которые теперь делает объединённый вызов.
- `backend/src/modules/knowledge-core/prompts/chapters-v2.prompt.ts`, `summary-v2.prompt.ts`, `tasks-v2.prompt.ts` — объединить в один промпт.
- `backend/scripts/seed-llm-task-routes-knowledge-core.ts` — добавить маршрут `meeting-report-fast` → `deepseek-v4-pro`.

### 1.4 Точный LLM-вызов

**Модель и параметры:**
```ts
const resp = await client.chat.completions.create({
  model: 'deepseek-v4-pro',
  messages: [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ],
  max_tokens: 32000,
  tools: [COMBINED_TOOL],
  tool_choice: 'auto',
});
```

**System-промпт** (полностью на русском, объясняет 4 секции):
- Что такое chapters (5-12 шт, без префикса «Глава N:», startMs/endMs из таймкодов).
- Что такое tasks (только explicit задачи, не пожелания; assigneeRaw, dueDateIso, sourceQuote, confidence).
- Что такое summary_markdown (структура зависит от типа встречи — для sales: стадия, боли, возражения, договорённости, шаги).
- Что такое quality_score (5 категорий 0-100, recommendations с severity info/warning/critical, strengths).
- Финал: «ВАЖНО: верни результат строго через вызов инструмента submit_meeting_analysis. Не пиши ничего вне tool_use.»

**User-сообщение:**
```
Заголовок встречи: <vendor> ↔ <client> (<тип>)

Транскрипт:
<полный транскрипт>

Верни полный анализ через инструмент submit_meeting_analysis.
```

**Tool-схема** `submit_meeting_analysis`:
- Имя функции: `submit_meeting_analysis`.
- Параметры: 4 обязательных поля:
  - `chapters: array<{ title, summary, startMs, endMs }>`
  - `tasks: array<{ title, assigneeRaw|null, dueDateIso|null, sourceQuote, confidence }>`
  - `summary_markdown: string`
  - `quality_score: { overallScore, categories: {5 шт по 0-100}, recommendations[], strengths[] }`
- Полная схема — см. `backend/scripts/eval/run-variant-b-single.ts` (300+ строк, использовать как референс).

### 1.5 Парсинг ответа

```ts
const call = resp.choices[0]?.message?.tool_calls?.[0];
if (!call) {
  // Fallback: модель вернула свободный текст — пишем в логи, помечаем report как failed.
  throw new Error('Модель не позвала tool');
}
const output = JSON.parse(call.function.arguments);
// output.chapters, output.tasks, output.summary_markdown, output.quality_score
```

### 1.6 Риски и тесты

- **Риск 1:** на длинных транскриптах (>50k знаков) модель может урезать вывод. Решение: на стороне воркера проверять `usage.completion_tokens` против `max_tokens=32000`; если близко к пределу — логировать и пробовать вторую попытку.
- **Риск 2:** thinking-токены входят в `output` cost. На длинных встречах thinking может быть 5-10k токенов. Учитывать в бюджете.
- **Тесты:** unit-тест на парсер ответа (валидный JSON, невалидный JSON, отсутствие tool_calls). Integration-тест на одной фикстуре из `sales-merge-experiment/fixtures/`.

---

## §2. chat-v2 — НЕ менять архитектуру (от эксп.2)

### 2.1 Статус
🟢 **Решение «не трогать» — финальное.** Закрепляем документально.

### 2.2 Эксперимент и результат

Папка: `backend/test/eval/dialog-experiment/`. Сравнивали:
- **Variant A** (текущая): 5 шагов — `contextualize` → `classify` → `multi-query` → `confidence` → `answer`.
- **Variant Б** (объединённый): 1 вызов делает всё.

**Победил A с минимальным перевесом.** Б НЕ дал выигрыша ни по экономике, ни по скорости (был **даже медленнее**). Полный отчёт: `dialog-experiment/reports/SUMMARY-ALL.md`.

### 2.3 Почему не объединяем

Главный мета-вывод: **объединение выигрывает только когда есть тяжёлый общий контекст**. У диалога нет такого контекста — каждый шаг работает на своём маленьком входе:
- `contextualize` — короткий вопрос + история диалога.
- `classify` — переформулированный вопрос.
- `multi-query` — классификация.
- `confidence` — выход RAG.
- `answer` — финальный шаг.

Поэтому объединять нечего — общий префикс крошечный, экономии нет.

### 2.4 Что сделать в коде

**Только применить патч на модель `chat-v2`** — перевести с текущей модели на `deepseek-v4-pro`. Скрипт уже готов:
- [backend/scripts/patch-chat-v2-to-pro.ts](../../backend/scripts/patch-chat-v2-to-pro.ts) — **готов, не применён**.
- Перед запуском: убедиться что в БД (dev и prod) есть запись `LlmTaskRoute` для `chat-v2`. Если нет — сначала `seed-llm-task-routes-knowledge-core.ts`.

**Никаких изменений в логике 5 шагов chat-v2 не делать.**

### 2.5 Документация
- Добавить в `second-brain/01_projects/ai-jobs.md` или `02_architecture/knowledge-core.md` краткую заметку: «Архитектура chat-v2 (5 шагов) подтверждена экспериментом 2026-05-25, объединение не даёт выигрыша».

---

## §3. specialists knowledge-core — Б+ паттерн (от эксп.3)

### 3.1 Статус
📋 **Готово к реализации.** Подтверждено судьёй (18:13).

### 3.2 Эксперимент и результат

Папка: `backend/test/eval/specialists-experiment/`. Сравнивали ПЯТЬ вариантов:
- **A** (текущая): 5 раздельных специалистов (3-1, 3-3, 3-5, 3-6, 3-9). $0.013, 30 сущностей, 5 типов.
- **Б**: 1 объединённый на 5 типов. $0.014, 28 сущностей.
- **В**: 2 группы. $0.007, 30 сущностей.
- **Г**: 8 раздельных специалистов с общим кэш-префиксом. $0.053, 42 сущности, 8 типов.
- **Б+** (победитель): 1 объединённый вызов на ВСЕ 8 типов. **$0.014, 41 сущность.**

**Б+ в 3.68× дешевле Г, при равном числе сущностей, и побеждает Г по качеству 18:13** (отчёт судьи: `specialists-experiment/reports/SUMMARY-BPLUS-VS-G.md`).

### 3.3 Что меняется в коде

**Удаляем (или существенно упрощаем):**
- Специалист 3-1 Regulations (`backend/src/modules/knowledge-core/services/specialist-3-1-regulations.service.ts` и подобные).
- 3-2 Knowledge Clone.
- 3-3 Decisions Registry.
- 3-5 Insights Radar.
- 3-6 Ideas Collector.
- 3-7 SkillProfile (см. `specialist-3-7-skill.service.ts` — он в git diff).
- 3-8 Helpfulness Agent.
- 3-9 Experiment Tracker.

**Добавляем:**
- Новый объединённый сервис: `SpecialistsCombinedService` (или единый `KnowledgeExtractionService`).
- Один LLM-вызов на встречу, извлекающий ВСЕ 8 типов сущностей за один проход.
- Новый taskType в `LlmRouterService`: `knowledge-specialists-combined` → `deepseek-v4-pro`.

**Затронутые файлы:**
- `backend/src/modules/knowledge-core/services/specialist-3-*.service.ts` — удалить / объединить.
- `backend/src/modules/knowledge-core/workers/meeting-analyze-v2.worker.ts` — перейти на один вызов.
- `backend/src/modules/knowledge-core/services/` — создать `specialists-combined.service.ts`.
- `backend/scripts/seed-llm-task-routes-knowledge-core.ts` — добавить маршрут.

### 3.4 Точный LLM-вызов

**Референс-реализация:** [backend/scripts/eval/run-specialists-b-plus.ts](../../backend/scripts/eval/run-specialists-b-plus.ts) — победивший прогон, копировать схему оттуда.

**Модель и параметры:**
```ts
const resp = await client.chat.completions.create({
  model: 'deepseek-v4-pro',
  messages: [
    { role: 'system', content: SYS_PROMPT },
    { role: 'user', content: `Все блоки встречи «${meetingTitle}» (${blocks.length} шт):\n\n${blocksToContext(blocks)}\n\nВажно: верни через submit_all_8_entities.` },
  ],
  max_tokens: 32000,
  tools: [SUBMIT_ALL_8_ENTITIES_TOOL],
  tool_choice: 'auto',
});
```

**Маршрутизация по signalType** (это самое важное в system-промпте):
```
- decision/rationale → decisions[] (объединять decision + соседний rationale в одну запись)
- idea/feature_request → ideas[] (kind=internal или client_request)
- pain/risk/blocker → insights[] (с severity, causeCategory, mitigationSuggestion)
- hypothesis/result/lesson → experiments[] (объединять блоки одного эксперимента)
- regulation/process_step → regulations[]
- expertise/experience/competence/reasoning → knowledge_categories[] (per person, 1-3 эмерджентные)
- reasoning/methodology_step (≥3 на одного человека) → skill_traits[] (гипотезные)
- help_provided/proactive_hint/mentoring/emotional_support → helpfulness_traits[]
- fact и прочие → пропускать
```

**Tool-схема** `submit_all_8_entities` — большая, 8 массивов:
- `decisions: array<{ sourceBlockId, statement, rationale|null, alternatives[], decidedBy[], status, confidence }>`
- `ideas: array<{ sourceBlockId, kind('internal'|'client_request'), statement, rationale|null, confidence }>`
- `insights: array<{ sourceBlockId, kind('problem'|'risk'|'blocker'|'inefficiency'), statement, severity('low'|'medium'|'high'|'critical'), causeCategory(enum 8 значений), mitigationSuggestion|null, confidence }>`
- `experiments: array<{ sourceBlockId, name, hypothesisText, currentResult|null, lessons[{text, type('what_worked'|'what_failed'|'next_time')}], status(enum 5 значений), confidence }>`
- `regulations: array<{ sourceBlockId, kind('regulation'|'process'|'policy'|'standard'), name, statement, severity('advisory'|'mandatory'|'blocking'), confidence }>`
- `knowledge_categories: array<{ personName, category(эмерджентная фраза), confidence('low'|'medium'|'high'), sampleStatements[], sourceBlockIds[] }>`
- `skill_traits: array<{ personName, category, statement(гипотезная формулировка), confidence('low'|'medium'|'high'), sourceBlockIds[] }>`
- `helpfulness_traits: array<{ sourceBlockId, traitType(enum 5 значений), helperUserHint, recipientUserHint|null, topicHint, intensity(0-1), evidenceQuote, confidence }>`

**Полная схема — копировать из [run-specialists-b-plus.ts](../../backend/scripts/eval/run-specialists-b-plus.ts) строки 29-50** (там вся схема развёрнута).

**Жёсткие требования к глубине** в system-промпте:
- decisions: ОБЯЗАТЕЛЬНО rationale (искать в соседних блоках), alternatives (если упоминались).
- insights: ОБЯЗАТЕЛЬНО mitigationSuggestion (или null если действительно нет).
- experiments: lessons[] должны быть многослойные (что сработало / не сработало / next_time).
- knowledge_categories: эмерджентные имена, не enum.
- skill_traits: формулировки ГИПОТЕЗНЫЕ («Похоже, склонен...»), не приговорные.

### 3.5 Сериализация блоков (на вход модели)

Из эксперимента — формат блока, который дал лучший результат:
```
[BLOCK:blk_006] (signalType=decision, persons=Иван Соколов,Анна Мехова)
  <name>
  В: <criticalQuestion>
  О: <trustedAnswer>
  Цитата (<speaker>): «<quote>»
```

55 блоков ~ 22k токенов вход. Влезает в контекст с запасом.

### 3.6 Риски и тесты
- **Риск:** на встречах с >100 блоками может не уместиться в 32k output. Решение: ограничить `maxBlocksPerCall`, если больше — батчить (но это редкий случай для MVP до 10 участников).
- **Регрессия:** перед миграцией сделать прогон на 3 разных типах встреч (sales, internal, 1-on-1) и сравнить с текущими специалистами по числу сущностей и заполненности полей.
- **Тесты:** unit на парсер, integration на одной фикстуре `specialists-experiment/`.

### 3.7 Бенефит
- В 3.7× дешевле текущих 8 специалистов (если бы переходили на Г).
- В 1× дешевле текущих 5 специалистов (А), но получаем 8 типов сущностей вместо 5.
- Лучше качество за счёт когерентности (нет дубликатов между специалистами).
- Меньше кода (8 файлов → 1 файл).

---

## §4. deepseek-pro формат вывода — критический фикс перед миграцией (от 3.2 handoff)

### 4.1 Статус
📋 **Высокий приоритет — блокирует §1, §3 в проде.**

ТЗ-вариант: [2026-05-25-deepseek-pro-output-format-fix.md](2026-05-25-deepseek-pro-output-format-fix.md).

### 4.2 Проблема

DeepSeek-V4-Pro с thinking **НЕ поддерживает** ряд параметров, которые сейчас используются в нашем коде. При переключении на Pro эти вызовы будут возвращать 400:

| Параметр | Поведение Pro | Где у нас в коде |
|---|---|---|
| `response_format: { type: 'json_schema', strict: true }` | 400 «Thinking mode does not support strict json schema» | `LlmRouterService` шаблоны структурного вывода |
| `tool_choice: 'required'` | 400 «Thinking mode does not support tool_choice=required» | возможно в воркерах knowledge-core |
| `tool_choice: { type: 'function', function: { name: '...' } }` | 400 (тот же текст) | возможно в воркерах |

### 4.3 Решение

**Везде в коде, где модель — Pro:**

Заменить:
```ts
// ❌ так НЕ работает с Pro
response_format: { type: 'json_schema', json_schema: { strict: true, schema: {...} } }
```

На:
```ts
// ✅ так работает с Pro
tools: [{
  type: 'function',
  function: { name: 'submit_X', parameters: {...} }
}],
tool_choice: 'auto',  // не 'required'!
// + в user-сообщении: «Верни результат через инструмент submit_X»
// + в system-промпте: «ВАЖНО: верни строго через вызов инструмента, не пиши ничего вне tool_use»
```

### 4.4 Затронутые файлы

- `backend/src/modules/ai/services/llm-router.service.ts` — если есть generic-обёртка вокруг response_format, добавить переключение «если model=pro → tools+auto, иначе → json_schema».
- Воркеры knowledge-core, использующие `tool_choice: 'required'` (поиск по коду перед применением).

### 4.5 Тесты
- Probe-скрипт уже есть: [backend/scripts/eval/probe-deepseek-formats.ts](../../backend/scripts/eval/probe-deepseek-formats.ts). Запустить до и после изменений.
- Unit: проверить, что для модели `deepseek-v4-pro` маршрутизатор НЕ ставит `tool_choice: 'required'`.

### 4.6 Fallback на не-Pro модели
Старый формат `json_schema strict` остаётся доступным для `deepseek-v3-chat` и других моделей. Решение принимать в `LlmRouterService` по флагу модели (например, новое поле `LlmTaskRoute.supportsStrictJsonSchema: boolean`).

---

## §5. Кэш-префикс — реалистичные 90-99% при правильной структуре payload (от 2026-05-25)

### 5.1 Статус
📋 **ТЗ скорректировано на основе контрольного эксперимента.** Базовое ТЗ: [2026-05-25-llm-cache-prefix-everywhere.md](2026-05-25-llm-cache-prefix-everywhere.md) (обновлено 2026-05-25).

Гипотеза «потолок 2700 токенов» — **опровергнута**. См. отчёты в `backend/test/eval/cache-experiment/reports/`.

### 5.2 Контрольный эксперимент (что замерили)

Скрипты: [probe-deepseek-cache.ts](../../backend/scripts/eval/probe-deepseek-cache.ts) и [probe-openai-proxy-cache.ts](../../backend/scripts/eval/probe-openai-proxy-cache.ts).

3 сценария на каждом провайдере:
- **S1 sequential identical** — 2 идентичных запроса подряд на размерах 256/1024/2048/2700/3500/5000/10000/20000/50000 токенов.
- **S2 8 parallel identical** — 8 одинаковых параллельных запросов на 10k токенов.
- **S3 общий префикс + переменный 41-символьный хвост** — для имитации прода.

Результаты:

| Сценарий | DeepSeek-V4-Pro (api.deepseek.com) | gpt-5-mini (через proxy.agent-lia.ru) |
|---|---|---|
| S1 max cached_tokens (на 2-м запросе) | 43264 из 43308 (**99.9%**) | 49152 из 49268 (**99.8%**) |
| S1 hit_ratio при N=2700 | 97.3% | 99.4% |
| S2 средний hit (8 параллельных одинаковых) | **98.8%** | 96.8% |
| S3 hit при 20k префикса + переменный хвост | 99.6% | 97.2% |
| Гранулярность кэша | **64 токена** | **128 токенов** |
| Минимум для попадания в кэш | 64 токена | **1024 токена** |
| Стоимость cache miss | $0.435/M | $0.25/M |
| Стоимость cache hit | $0.003625/M (**−99%**) | $0.025/M (**−90%**) |

### 5.3 Почему в Variant Г было 21% (объяснение)

В [run-specialists.ts:138-156](../../backend/scripts/eval/run-specialists.ts#L138-L156) каждый из 8 параллельных специалистов имел:

1. **Разный** `system` (SYS_DECISIONS, SYS_IDEAS, SYS_INSIGHTS, …) — system входит в `messages[0]`, кэш miss с 1-го байта.
2. **Разный** массив `tools` в payload (своя tool-схема под каждый тип сущности).
3. **Разный** хвост user (`'…верни через submit_decisions'` vs `submit_ideas'`).

Кэш сработал только на той начальной части, которая случайно совпала — несколько килотокенов служебных преамбул. Это **не потолок DeepSeek**, это **сломанный префикс**.

### 5.4 Правила построения кэшируемого префикса (КАК ПРАВИЛЬНО)

> **Главное правило: всё, что должно кэшироваться — должно быть БАЙТ-В-БАЙТ ИДЕНТИЧНО между вызовами цепочки.** Любое расхождение в payload до этой точки → кэш miss.

**Что должно совпадать (полный чек-лист для cache hit):**

| Поле | Должно совпадать? | Почему |
|---|---|---|
| `model` | ✅ да | Разные модели — разный кэш-namespace. |
| `messages[]` (содержимое и порядок) | ✅ да, целиком до точки расхождения | Главный носитель префикса. |
| `tools[]` | ✅ да (если используются) | OpenAI/DeepSeek хэшируют tools вместе с messages. |
| `tool_choice` | ✅ да (если задан) | То же. |
| `response_format` | ✅ да (если задан) | То же. |
| `reasoning` (для Pro/gpt-5*) | ✅ да | Часть payload-префикса. |
| `max_tokens` / `max_output_tokens` | ❌ можно менять | На кэш не влияет. |
| `temperature` | ❌ можно менять | На кэш не влияет. |
| `stream` | ❌ можно менять | На кэш не влияет. |

**Правильный паттерн «общий префикс + переменный хвост»:**

```ts
// Стабильная часть (одинаковая для всей цепочки) — в начале messages:
const STABLE_SYSTEM = 'Ты — knowledge-инженер компании Z. …'; // одинаковое
const STABLE_USER_PREFIX = 'Канонические блоки встречи:\n\n' + blocksToContext(allBlocks);
                                                              // одинаковое для всей цепочки

// Переменная часть (отличается между вызовами) — в КОНЦЕ user:
const variableTask =
  '\n\n=== ЗАДАЧА ШАГА ===\nСейчас извлекаешь decisions[]. Верни через submit_decisions.';

const userText = STABLE_USER_PREFIX + variableTask;
```

**Анти-паттерны, ломающие кэш (не делать):**

1. ❌ **Разный `system` на каждый шаг цепочки.** Должен быть один общий system на всю цепочку.
2. ❌ **Разные `tools[]` между вызовами.** Если шаги нужны разным схемам — собрать **один tool с полной схемой** (как Variant Б+) ИЛИ **один единый набор tools одинаковый для всех шагов**, а в user-prompt объяснить какой именно tool вызвать на этом шаге.
3. ❌ **Переменное поле в начале user.** `Date.now()`, `requestId`, имя пользователя, ID встречи в первой строке → весь префикс уйдёт в miss. Переменное → в самый конец.
4. ❌ **Изменение порядка элементов в `tools[]`** (даже того же набора) — сериализуется иначе → кэш miss.
5. ❌ **Изменение `response_format` между вызовами** (на одном — json_object, на другом — json_schema) → miss.
6. ❌ **Использование разных моделей** (`deepseek-v4-pro` vs `deepseek-v4-flash`) для одной цепочки — разные кэш-namespace.

### 5.5 Размерные пороги

- DeepSeek: кэш есть при ≥64 токенов префикса. Чанк 64 → последний неполный chunk (≤64 ток) **не кэшируется** (нормально). На очень коротких prompts (<256 ток) эффект кэша слабый.
- OpenAI/gpt-5-mini через прокси: кэш есть только при **≥1024 токенов префикса**. На прод-промптах <1024 токенов кэш не работает.
- Anthropic Claude через прокси — НЕ тестировался в этом эксперименте, см. отдельный TZ на проверку. У Claude другой механизм: явный `cache_control: {type:'ephemeral'}` (тестировалось ранее в [prompt-caching.spec.ts](../../backend/src/modules/ai/services/prompt-caching.spec.ts)).

### 5.6 Когда применять кэш-префикс

- ✅ **Применяем** в любой цепочке ≥2 вызовов на одних и тех же данных (специалисты knowledge-core, dialog-layer, любой агентный цикл).
- ✅ **Применяем** в одиночных вызовах с **повторяющимся system** между разными встречами/запросами (если system сам по себе ≥1024 токенов на OpenAI или ≥64 на DeepSeek).
- ❌ **Не нужен** там, где архитектура свёрнута в **один объединённый вызов** (§1 meeting-report, §3 specialists Б+) — нечего кэшировать.
- ❌ **Не выгоден** в чек-инах и других малых одиночных вызовах (<1024 токенов суммарно).

### 5.7 Стратегический вывод

§3 (Specialists Б+ — 1 объединённый вызов) и §5 (8 раздельных с кэш-префиксом) — это **две конкурирующие** оптимизации, обе работают:

- **Б+** (1 вызов) — выигрывает по экономике (3.7× дешевле Variant Г), по качеству (когерентность), по простоте кода. **Это наш дефолт.**
- **Cache-prefix** (N вызовов с общим префиксом) — нужен там, где **разделение на шаги принципиально** (например, один шаг даёт RAG-ответ, второй валидирует, третий форматирует — это разные ответственности). Тогда общий префикс делает каскад дешёвым.

**Правило выбора:** если шаги можно описать как «один LLM-проход с структурированным ответом» — выбираем Б+. Если шаги делают **разные операции с разной структурой результата** и зависят друг от друга — каскад с cache-prefix.

### 5.8 Артефакты

- [probe-deepseek-cache.ts](../../backend/scripts/eval/probe-deepseek-cache.ts) — DeepSeek-V4-Pro, прямой канал.
- [probe-openai-proxy-cache.ts](../../backend/scripts/eval/probe-openai-proxy-cache.ts) — OpenAI gpt-5-mini через proxy.agent-lia.ru.
- Отчёты JSON+CSV: `backend/test/eval/cache-experiment/reports/`.

---

## §6. operations (от эксп.4 — заполняется)

### 6.1 Статус
🔬 **Эксперимент в работе.** Тестируем три гипотезы:

1. **weekly-digest** — «LLM-агрегация vs код-агрегация»: сейчас агрегат строится в коде, LLM описывает. Дать ли LLM сырые чек-ины + блокеры + цели, чтобы он сам нашёл паттерны?
2. **checkin-sentiment** — «batch vs single»: батч из 10 чек-инов за вызов vs один-за-вызов.
3. **На малых источниках кэш-префикс бесполезен** — быстрая проверка (1500-знаковый чек-ин < 2700 токенов кэшируемого префикса).

### 6.2 Затронутые модули (для контекста)
- `backend/src/modules/operations/workers/checkin-sentiment-analyzer.worker.ts`
- `backend/src/modules/operations/workers/operations-weekly-digest.cron.ts`
- `backend/src/modules/operations/workers/commitment-followup.cron.ts`
- `backend/src/modules/operations/services/weekly-digest.service.ts`
- `backend/src/modules/operations/prompts/checkin-sentiment.prompt.ts`
- `backend/src/modules/operations/prompts/weekly-digest.prompt.ts`

### 6.3 Результаты
_(будут заполнены после прогона эксперимента 4)_

---

## §7. План применения в коде (финальный этап)

После закрытия эксперимента 4 — один большой проход по коду. Порядок важен:

1. **§4 deepseek-pro формат** (фундамент) — без этого §1 и §3 в проде не заработают.
2. **§1 meeting-report** — упростить пять шагов в один.
3. **§3 specialists knowledge-core** — упростить восемь специалистов в один.
4. **§2 chat-v2** — применить готовый патч на модель.
5. **§5 кэш-префикс** — решить, применять ли вообще; вероятно, отложить.
6. **§6 operations** — применить выводы эксперимента 4.

### 7.1 Чек-лист для каждого изменения
- [ ] Промпт переведён в полном объёме (без потери deтаdетализации).
- [ ] Tool-схема воспроизводит структуру эксперимента.
- [ ] `tool_choice: 'auto'`, в user-сообщении явное «верни через инструмент».
- [ ] Парсер ответа защищён от отсутствия tool_calls.
- [ ] `seed-llm-task-routes-*.ts` обновлён.
- [ ] Unit-тест парсера.
- [ ] Integration-тест на одной фикстуре из соответствующей `eval/`-папки.
- [ ] Метрика стоимости (`usage.prompt_tokens`, `usage.completion_tokens`) пишется в БД для каждого вызова.

### 7.2 Риски миграции в прод
- **Risk 1:** thinking-токены входят в `output cost`. На длинных контекстах output может быть в 2-3 раза больше, чем мы ожидаем по содержимому. Решение: мониторить `business-metrics.service` после раскатки.
- **Risk 2:** регрессия качества по сравнению с текущими промптами. Решение: A/B-прогон на 10 реальных встречах перед полным переключением.
- **Risk 3:** rate limit DeepSeek (особенно на Pro). Решение: смотреть `429`-ошибки, при необходимости добавить retry с backoff.

---

## Финальный итог

Документ заполняется по мере экспериментов. Когда закроем §6 — программисту останется один большой проход по коду по плану из §7.

**Главный архитектурный вывод всей серии:** объединённый вызов выигрывает там, где есть тяжёлый общий контекст; раздельные вызовы остаются там, где входы маленькие и не связаны. Кэш-префикс DeepSeek работает не так, как пишут в маркетинге, — для нашей архитектуры он становится ненужным.
