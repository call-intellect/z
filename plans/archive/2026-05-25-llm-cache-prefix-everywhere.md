---
status: draft
owner: TBA (передаём агенту)
created: 2026-05-25
type: architecture-optimization
priority: high (экономия 50-90% на LLM-вызовах в цепочках)
related-modules: ai (LlmRouter, DeepSeekService), knowledge-core, dialog-layer
---

> 📦 **АРХИВ (аудит 2026-06-04): ⬜ не делалось (заменено/отменено) — 10%.**
> Production-код по ТЗ не написан (нет cache-prefix-builder.ts, нет orchestrator, специалисты не отрефакторены, нет метрики ratio). Сделана только экспериментально-документная часть (llm-cache-status.md + раздел в code-pit
> Полный разбор: `plans/analysis/2026-06-04-tz-audit-reestr-i-prioritety.md`


# Применить принцип «общего кэшируемого префикса» ко всем LLM-цепочкам в проекте

## 0. Кратко

DeepSeek (и большинство современных провайдеров) кэширует **начало промпта**. Если N разных вызовов к LLM начинаются с одинаковых ~5000 токенов (общий контекст), система засчитывает их как **cache hit** по цене **в 120 раз дешевле** на DeepSeek ($0.003625/M против $0.435/M) и **в 10 раз дешевле** на OpenAI ($0.025/M против $0.25/M на gpt-5-mini).

В проекте Z десятки мест, где несколько LLM-вызовов работают на **одних и тех же данных** (одна встреча, один набор блоков, один диалог). Сейчас каждый вызов имеет свой системный промпт — кэш не срабатывает. Если переформировать промпты так, чтобы **общая часть была в начале**, экономия будет **50-90%** на цепочках.

**Контрольный эксперимент 2026-05-25 (обязательно прочитать перед началом работы):**
- [probe-deepseek-cache.ts](../../backend/scripts/eval/probe-deepseek-cache.ts) → отчёт `backend/test/eval/cache-experiment/reports/probe-2026-05-25T11-21-55-679Z.json`.
- [probe-openai-proxy-cache.ts](../../backend/scripts/eval/probe-openai-proxy-cache.ts) → отчёт `openai-proxy-probe-2026-05-25T11-30-31-049Z.json`.

Результаты (на идентичных payload):
- DeepSeek-V4-Pro: до **43k токенов префикса — hit 99.9%**.
- gpt-5-mini через `proxy.agent-lia.ru`: до **49k токенов префикса — hit 99.8%**. Прокси кэш НЕ ломает.
- 8 параллельных одинаковых запросов: hit 98.8% (DeepSeek) / 96.8% средний (OpenAI). Параллельность не мешает.

**Прежняя оценка «21% реалистично» из Variant Г эксп.3 — артефакт сломанного префикса** (каждый из 8 специалистов имел разные `system`/`tools`/`submit_<name>` в payload). При правильно построенном payload кэш покрывает префикс до байта расхождения.

Эксперимент-основание для архитектуры цепочек: [test/eval/specialists-experiment/reports/SUMMARY.md](../../backend/test/eval/specialists-experiment/reports/SUMMARY.md) и [sales-merge-experiment SUMMARY-ALL](../../backend/test/eval/sales-merge-experiment/reports/SUMMARY-ALL.md).

## 1. Цель

Применить принцип «общий кэшируемый префикс → разный хвост» к **всем** местам в коде, где идёт **цепочка из нескольких LLM-вызовов на одних данных**.

## 2. Принцип архитектуры

### Что сейчас (плохо для кэша)

```
Вызов 1 (специалист 3-3):
  system: «Ты — knowledge-инженер, извлекаешь решения...»
  user: «Блок blk_001: [...] Извлеки решение.»

Вызов 2 (специалист 3-5):
  system: «Ты — knowledge-инженер, извлекаешь проблемы...»
  user: «Блок blk_001: [...] Извлеки проблему.»
```

Cache miss — system отличается с 1-го символа. Платим полную цену.

### Как должно быть (cache hit 95%+)

```
Вызов 1 (специалист 3-3):
  system: «Ты — knowledge-инженер. Тебе дают блоки встречи: [55 блоков на 5000 токенов].»
  user: «Сейчас ты специалист 3-3 (Решения). Правила: [...]. Верни через submit_decisions.»

Вызов 2 (специалист 3-5):
  system: «Ты — knowledge-инженер. Тебе дают блоки встречи: [55 блоков на 5000 токенов].»  ← одинаково
  user: «Сейчас ты специалист 3-5 (Проблемы). Правила: [...]. Верни через submit_insights.»
```

Cache hit ~95% на втором и последующих вызовах. Платим только за выход и за разный хвост user-сообщения.

### Ключевое правило

> **Общая для цепочки часть промпта → в самое начало system. Специфика конкретного шага → в user в самый конец.**

Это требует **переструктурирования** промптов в коде. НЕ переделки архитектуры — просто перестановка частей.

### Hard-check: что ДОЛЖНО быть идентично между вызовами цепочки (обязательный чек-лист)

Кэш работает только если ВСЁ нижеперечисленное совпадает между вызовами **байт-в-байт** до точки расхождения:

| Поле | Должно совпадать? | Что будет, если нарушить |
|---|---|---|
| `model` | ✅ да | Разные модели — разные кэш-namespace, hit = 0% |
| `messages[]` (содержимое и порядок) | ✅ да, целиком до расхождения | Главный носитель префикса. Любое расхождение = miss с этого места |
| `tools[]` (если используются) | ✅ да (та же сериализация) | DeepSeek/OpenAI хэшируют tools вместе с messages |
| `tool_choice` | ✅ да | То же |
| `response_format` | ✅ да | То же |
| `reasoning` (gpt-5*, deepseek-v4-pro) | ✅ да | Часть payload-префикса |
| `instructions` (OpenAI Responses) | ✅ да | Аналог system message |
| `max_tokens` / `max_output_tokens` | ❌ можно менять | На кэш не влияет |
| `temperature` | ❌ можно менять | На кэш не влияет |
| `stream` | ❌ можно менять | На кэш не влияет |

**6 анти-паттернов, которые ломают кэш** (это **главная** причина потери экономии в проде):

1. ❌ **Разный `system` на каждый шаг** — должен быть один общий system на всю цепочку. Это была главная ошибка в Variant Г.
2. ❌ **Разные `tools[]` между вызовами** — даже если их содержимое разное, **массив tools должен быть одинаковый** для всех вызовов цепочки. Если шагам нужны разные выходные структуры — либо собрать **один tool с union-схемой**, либо **держать общий набор tools** и в user-prompt указывать, какой именно вызвать.
3. ❌ **Переменное поле в начале user** — `Date.now()`, `requestId`, имя пользователя, meeting.id в первой строке user → весь префикс идёт в miss. Любое переменное → в самый конец.
4. ❌ **Изменение порядка элементов** в `tools[]` (даже того же набора) — сериализация JSON чувствительна к порядку, кэш miss.
5. ❌ **Разный `response_format`** между вызовами (на одном json_object, на другом json_schema) → miss.
6. ❌ **Разные модели** для одной цепочки — разные кэш-namespace.

### Минимальные размеры для попадания в кэш (по каналам)

**Источник правды:** [`second-brain/02_architecture/llm-cache-status.md`](../../second-brain/02_architecture/llm-cache-status.md). Здесь — сводка по производственным каналам Z (verified 2026-05-25).

| Канал | Модель | Кэш | Минимум для попадания | Chunk | Скидка cached |
|---|---|:--:|---|---|--:|
| `deepseek` (прямой) | `deepseek-v4-pro`, `v4-flash`, `deepseek-chat` | ✅ | **64 токена** | 64 | −99% |
| `openai-via-proxy` (proxy.agent-lia.ru) | `gpt-5-mini` | ✅ | **1024 токена** | 128 | −90% |
| `openai-via-proxy` (proxy.agent-lia.ru) | `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5.4` | ✅ | **~2048 токенов** | 128 | −90% |
| `minimax` (прямой Anthropic-формат) | `MiniMax-M2.5`, `MiniMax-M2.7` | ✅ | требует **явный** `cache_control: 'ephemeral'`, минимум ≈1024 | ≈1024 (Anthropic-style) | ~−50% |
| `ollama` (self-hosted) | `qwen3.5:9b` | ❌ | prompt cache на уровне API не предусмотрен |
| `kie` (любой формат) | `claude-opus-4-7`, `gpt-5-4`, `gemini-3-flash` | ❌ | кэш не пробрасывается через KIE |
| `grsai` (Gemini SSE) | `gemini-3-pro`, `gemini-3.1-pro` | ❌ | `cached_tokens` отсутствует в usage |
| `anthropic` (прямой) | claude-* | n/a | в Z не используется (решение владельца) |

**Практические следствия:**
- **Чек-ины** (≈500 токенов суммарно): кэш не выгоден ни на одном канале — слишком короткие.
- **gpt-5.4-nano для классификаторов** (theme-classify, entity-resolver): кэш может не сработать, если промпт <2k токенов.
- **MiniMax-M2.5**: для использования cache нужен **явный** `cache_control: 'ephemeral'`. Сейчас в `LlmRouter` он ставится только на system, но не на user — см. ТЗ [`2026-05-25-minimax-cache-control-on-user.md`](2026-05-25-minimax-cache-control-on-user.md).
- **KIE / GRSAI**: не закладывать скидку cached в расчёты экономики.

## 3. Где применять (список цепочек по приоритету)

### Фаза 1 — Специалисты knowledge-core (наибольший эффект)

**Файлы:**
- [backend/src/modules/knowledge-core/services/specialist-3-1-regulations.service.ts](../../backend/src/modules/knowledge-core/services/specialist-3-1-regulations.service.ts)
- [backend/src/modules/knowledge-core/services/specialist-3-2-knowledge-clone.service.ts](../../backend/src/modules/knowledge-core/services/specialist-3-2-knowledge-clone.service.ts)
- [backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts](../../backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts)
- [backend/src/modules/knowledge-core/services/specialist-3-5-insights.service.ts](../../backend/src/modules/knowledge-core/services/specialist-3-5-insights.service.ts)
- [backend/src/modules/knowledge-core/services/specialist-3-6-ideas.service.ts](../../backend/src/modules/knowledge-core/services/specialist-3-6-ideas.service.ts)
- [backend/src/modules/knowledge-core/services/specialist-3-7-skill.service.ts](../../backend/src/modules/knowledge-core/services/specialist-3-7-skill.service.ts)
- [backend/src/modules/specialist-3-8-helpfulness/services/specialist-3-8-helpfulness.service.ts](../../backend/src/modules/specialist-3-8-helpfulness/services/specialist-3-8-helpfulness.service.ts)
- [backend/src/modules/knowledge-core/services/specialist-3-9-experiments.service.ts](../../backend/src/modules/knowledge-core/services/specialist-3-9-experiments.service.ts)

**Что менять:** в каждом specialist-сервисе вызов LLM сейчас формирует свой системный промпт из соответствующего `*.prompt.ts`. Нужно:

1. Создать **общий «контекстный пролог»** — функция в `knowledge-core/services/cache-prefix-builder.ts` (новый файл), которая принимает массив всех блоков встречи и возвращает текст вида:
   ```
   «Ты — knowledge-инженер компании Z. Тебе дают канонические блоки одной встречи.
   Каждый блок — атомарное смысловое утверждение с типом сигнала.

   Блоки встречи:
   [BLOCK:blk_001] (signalType=decision) ...
   [BLOCK:blk_002] (signalType=idea) ...
   ...»
   ```

2. В каждом specialist-сервисе:
   - В system promp**: общий пролог (одинаковый для всех 8 специалистов на этой встрече).
   - В user prompt: специфика — «сейчас ты извлекаешь X», правила, tool name, и идентификаторы тех блоков из общего пролога, на которых работаешь.

**Ожидаемый эффект:** на встрече с 55 блоками — было ~$0.013, станет ~$0.005 (в 2.5× дешевле). Качество извлечения улучшится за счёт того, что каждый специалист видит **соседние блоки** в общем контексте (доказано экспериментом — Б побеждает по глубине именно поэтому).

### Фаза 2 — Цепочка отчёта по встрече (если не свернута)

Если ТЗ [2026-05-25-meeting-report-split-from-block-ingest.md](2026-05-25-meeting-report-split-from-block-ingest.md) ещё не перевело отчёт на `meeting-report-fast` (один объединённый вызов), то текущие 4 v2-агента (chapters-v2, tasks-v2, summary-v2, meeting-quality-score) тоже выиграют от общего префикса.

**Файлы:**
- [knowledge-core/services/chapters-extractor-v2.service.ts](../../backend/src/modules/knowledge-core/services/chapters-extractor-v2.service.ts)
- [knowledge-core/services/tasks-extractor-v2.service.ts](../../backend/src/modules/knowledge-core/services/tasks-extractor-v2.service.ts)
- [knowledge-core/services/summary-extractor-v2.service.ts](../../backend/src/modules/knowledge-core/services/summary-extractor-v2.service.ts)
- [ai/workers/quality-score.worker.ts](../../backend/src/modules/ai/workers/quality-score.worker.ts)

Если `meeting-report-fast` уже работает в проде — эту фазу пропускаем (там и так 1 вызов).

### Фаза 3 — Dialog-layer (минорный эффект)

**Файлы:**
- [dialog-layer/services/query-classifier.service.ts](../../backend/src/modules/dialog-layer/services/query-classifier.service.ts)
- [dialog-layer/services/multi-query-expansion.service.ts](../../backend/src/modules/dialog-layer/services/multi-query-expansion.service.ts)
- [dialog-layer/services/confidence-estimator.service.ts](../../backend/src/modules/dialog-layer/services/confidence-estimator.service.ts)
- (`contextualize` — отдельный вызов, обычно не в цепочке)

В диалоге малый контекст (вопрос + история ≈ 500 токенов), кэш сэкономит мало в абсолютном выражении. Но 50-70% экономии всё равно полезно. Делаем после Фаз 1-2.

### Фаза 4 — Прочие цепочки

Грепом по проекту `LlmRouterService.complete` или `LlmFallbackService.complete` найти все места, где **в одном сервисе несколько LLM-вызовов на одних и тех же данных**. Кандидаты для проверки:
- [orchestrator/services/planning.service.ts](../../backend/src/modules/orchestrator/services/planning.service.ts)
- [orchestrator/services/verification.service.ts](../../backend/src/modules/orchestrator/services/verification.service.ts)
- [orchestrator/strategies/base-retrieval-strategy.ts](../../backend/src/modules/orchestrator/strategies/base-retrieval-strategy.ts)
- [brand-voice/services/brand-voice-extractor.service.ts](../../backend/src/modules/brand-voice/services/brand-voice-extractor.service.ts) (если несколько проходов на одном корпусе)

## 4. Изменения в инфраструктуре

### 4.1 Новый хелпер: `cache-prefix-builder.ts`

Файл: `backend/src/common/ai/cache-prefix-builder.ts` (новый, common для всех модулей).

```typescript
/**
 * Формирует общий кэшируемый префикс для цепочки LLM-вызовов на одних данных.
 *
 * Использование: в начале цепочки строим один префикс, переиспользуем его как
 * system prompt в каждом вызове цепочки. Тело каждого вызова (специфика
 * задачи) идёт в user prompt.
 *
 * DeepSeek и большинство провайдеров кэшируют префикс автоматически — общая
 * часть в начале означает cache hit на 2-м и последующих вызовах.
 */
export interface CachePrefixOptions {
  /** Роль агента, общая для цепочки. */
  role: string;
  /** Общий контекст: данные, на которых работают все вызовы цепочки. */
  commonContext: string;
  /** Опц. общие правила для всей цепочки (стиль, язык, запреты). */
  commonRules?: string[];
}

export function buildCachePrefix(opts: CachePrefixOptions): string {
  const parts: string[] = [opts.role.trim()];
  if (opts.commonRules && opts.commonRules.length > 0) {
    parts.push('', 'Общие правила:', ...opts.commonRules.map((r) => `- ${r}`));
  }
  parts.push('', 'Общий контекст:', opts.commonContext.trim());
  return parts.join('\n');
}
```

Это **utility** — не меняет архитектуру `LlmRouter`, не требует изменений в `DeepSeekService`. Просто помогает caller-ам правильно формировать промпт.

### 4.2 Метрика cache hit ratio в LlmRouter

В [llm-router.service.ts](../../backend/src/modules/ai/services/llm-router.service.ts) — добавить per-taskType метрику:

```typescript
// Новая метрика Prometheus:
// z_llm_cache_hit_ratio_avg{taskType, model} — среднее за окно 5 минут
```

Эта метрика покажет: **какие taskType реально получают кэш-хит**. Если для специалистов 3-X средний cache_hit_ratio < 80% — значит, в коде где-то промпт формируется неправильно (cache prefix нарушен).

### 4.3 Алерт «кэш сломался»

В Grafana / Prometheus alert: если `z_llm_cache_hit_ratio_avg < 0.5` для taskType, для которого ожидается >0.9 (например, специалистов knowledge-core) — алертить разработчиков. Это значит кто-то случайно сломал префикс.

## 5. Конкретные изменения в специалистах (Фаза 1, пример)

### Сейчас (specialist-3-3-decisions.service.ts):

```typescript
const { system, user } = buildDecisionExtractPrompt({ block, contextQuotes });
// system = «Ты извлекаешь решения...» (свой для специалиста)
// user = «Блок blk_001: ...»
const result = await this.llmRouter.complete({ system, user, ... });
```

### Должно стать:

```typescript
// На вызывающей стороне (где запускается цепочка специалистов на одной встрече)
const cachePrefix = buildCachePrefix({
  role: 'Ты — knowledge-инженер компании Z. Тебе дают канонические блоки одной встречи.',
  commonContext: blocksToContext(allMeetingBlocks),  // все 55 блоков
  commonRules: [
    'Не выдумывай факты вне блоков.',
    'Все строки — на русском.',
    'Возвращай результат через указанный инструмент.',
  ],
});

// В каждом специалисте:
const taskInstruction = buildDecisionTaskInstruction({ targetBlockIds: [...] });
// taskInstruction = «Сейчас ты — Specialist 3-3 (Decisions). Извлеки решения из
// блоков с id [blk_001, blk_006]. Правила: ... Верни через submit_decisions.»

const result = await this.llmRouter.complete({
  system: cachePrefix,        // одинаковый для всех специалистов в цепочке
  user: taskInstruction,      // разный — специфика задачи
  tools: [...],
  ...
});
```

### Где формируется `cachePrefix`

Не в каждом специалисте отдельно — а **в общем координаторе** (например, в `meeting-analyze-v2.worker.ts` или в новом `specialists-orchestrator.service.ts`), который запускает всех специалистов на встрече. Координатор:
1. Загружает все блоки встречи **один раз**.
2. Формирует `cachePrefix` **один раз**.
3. Передаёт его каждому специалисту через DI или параметр.

## 6. Фазы реализации

### Фаза 0 — Подготовка (1 час)
- [ ] Создать `backend/src/common/ai/cache-prefix-builder.ts`.
- [ ] Добавить unit-тест: pre-сформированный prefix имеет ожидаемую структуру.
- [ ] Документировать паттерн в [second-brain/02_architecture/code-pitfalls.md](../../second-brain/02_architecture/code-pitfalls.md) — раздел «LLM cache prefix discipline».

### Фаза 1 — Специалисты (3-5 часов)
- [ ] Создать `specialists-orchestrator.service.ts` (или расширить существующий координатор) — формирует cache prefix и запускает 8 специалистов параллельно.
- [ ] Переписать вход каждого из 8 специалистов: принимать `cachePrefix` как параметр, формировать только `taskInstruction`.
- [ ] Регрессионный тест: на одной dev-встрече — должно работать как раньше, но `cache_hit_ratio > 0.9` на 2-м и далее специалистах.

### Фаза 2 — Цепочка отчёта (2 часа)
- [ ] То же для chapters-v2, tasks-v2, summary-v2, meeting-quality-score — если они ещё работают (после ТЗ [2026-05-25-meeting-report-split-from-block-ingest.md](2026-05-25-meeting-report-split-from-block-ingest.md) могут быть свёрнуты в meeting-report-fast).

### Фаза 3 — Dialog-layer (1-2 часа)
- [ ] То же для classify, multi-query, confidence (общий префикс = standalone-вопрос + история).
- [ ] Ожидаемый эффект — небольшой (диалоги короткие), но дисциплина одинаковая.

### Фаза 4 — Метрики и алерты (1 час)
- [ ] Метрика `z_llm_cache_hit_ratio_avg{taskType, model}`.
- [ ] Альерт в `infra/grafana/` или эквивалент.

### Фаза 5 — Прочие цепочки (по мере обнаружения)
- [ ] Греп по `LlmRouterService.complete` и `LlmFallbackService.complete` — все места с ≥2 вызовами на одних данных.
- [ ] По каждому — оценить применимость паттерна.

## 7. Acceptance criteria

- [ ] `cache-prefix-builder.ts` создан и покрыт unit-тестом.
- [ ] На regression-встрече специалисты дают тот же выход, что и раньше (по структурам — допустимы стилистические различия).
- [ ] `z_llm_cache_hit_ratio_avg` для taskType специалистов > 0.85 (наблюдается в `/metrics` после прогона на 5+ встречах).
- [ ] Бенчмарк до/после: средняя стоимость встречи в part «специалисты» снижена ≥ 50%.
- [ ] Обновлены `second-brain/02_architecture/code-pitfalls.md` и `01_projects/ai-jobs.md` — добавлен раздел «Cache prefix discipline».

## 8. Что НЕ делать

- **НЕ менять промпты по содержанию** — паттерн касается только **расположения частей промпта**, не их сути.
- **НЕ удалять старые `*.prompt.ts` файлы** — они продолжают экспортировать инструкции, но теперь caller разделяет их на prefix-часть и user-часть.
- **НЕ ломать обратную совместимость** для caller-ов, которые ещё не мигрировали — `LlmRouter.complete` принимает любые system/user, работает по-старому.
- **НЕ применять паттерн к одиночным вызовам** — если в сервисе только один вызов LLM, кэшировать нечего, делать ничего не нужно.

## 9. Риски и митигация

| Риск | Митигация |
|---|---|
| Качество извлечения может пострадать, если общий контекст слишком большой (>50k токенов) | Pro поддерживает 1M контекста. В наших цепочках максимум ~30k блоков. Достаточно. |
| Кэш-провайдер изменит политику и cache_hit перестанет давать скидку | Метрика `z_llm_cache_hit_ratio_avg` это сразу покажет — переключаемся на secondary провайдера. |
| Перестановка system/user может повлиять на качество ответа модели | Регрессионный тест на 5 dev-встречах — сравниваем выход с эталоном. |
| Длинный общий префикс заставит модель «затеряться» в нём | Структурировать префикс с маркерами `[BLOCK:id]`, чтобы модель могла адресоваться. |

## 10. Связанные ТЗ

- [2026-05-25-deepseek-pro-output-format-fix.md](2026-05-25-deepseek-pro-output-format-fix.md) — нужно сделать ДО этого ТЗ (иначе при cache hit на Pro могут быть проблемы со strict json_schema).
- [2026-05-25-meeting-report-split-from-block-ingest.md](2026-05-25-meeting-report-split-from-block-ingest.md) — параллельная задача, влияет на Фазу 2 этого ТЗ.
- [2026-05-25-admin-llm-routes-frontend.md](2026-05-25-admin-llm-routes-frontend.md) — независимая задача.

## 11. Артефакты эксперимента (референсы)

- [Эксперимент специалистов](../../backend/test/eval/specialists-experiment/reports/SUMMARY.md) — доказательство, что без кэша на специалистах стоимость ~$0.013 на встречу.
- [Эксперимент встреч — Variant A](../../backend/test/eval/sales-merge-experiment/reports/fixture-01-pilot-variant-a.json) — там 99% кэш-хит наблюдался на повторных вызовах block-ingest. Это доказательство, что паттерн работает на DeepSeek.
- [run-variant-a-single.ts](../../backend/scripts/eval/run-variant-a-single.ts) — пример каскадных вызовов с общим контекстом.

## 12. Передача агенту

Этот файл — самодостаточное ТЗ. Агент-исполнитель должен:

1. Прочитать этот файл целиком.
2. Прочитать SUMMARY.md специалистов и понять цифры до/после (стоимость, кэш-хит).
3. Прочитать текущий код одного специалиста, например [specialist-3-3-decisions.service.ts](../../backend/src/modules/knowledge-core/services/specialist-3-3-decisions.service.ts) и его промпт [decision-extract.prompt.ts](../../backend/src/modules/knowledge-core/prompts/decision-extract.prompt.ts), чтобы понять текущую форму.
4. Вызвать скилы `nestjs-rules`, `z-ai-agent-rules`, `core-engineering-standards`.
5. Идти по фазам строго в порядке. После каждой — `bun run typecheck && bun run lint && bun run test:unit`.
6. На развилках — спрашивать у пользователя (особенно по перекомпоновке промптов: важно не нарушить семантику).
7. Регрессионный тест после Фазы 1 — обязателен.

## 13. Главный мета-вывод

Этот паттерн **сильнее любой оптимизации модели**. Цена кэш-хита в 120 раз ниже cache miss — это другая категория экономии, чем «переключить на Flash» или «уменьшить max_tokens». При правильном применении в проекте Z экономия на LLM-расходах может составить **30-60% от текущих месячных счетов**.
