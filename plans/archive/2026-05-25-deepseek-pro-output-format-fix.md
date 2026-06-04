---
status: implemented
owner: Сергей
created: 2026-05-25
implemented: 2026-05-25
type: bugfix-and-adapter
priority: high (блокировало использование DeepSeek-V4-Pro в проде)
depends-on: 2026-05-25-ai-real-eval-harness.md (эксперимент-основание)
related-modules: ai/services (LlmRouter, DeepSeekService)
implementation-commits:
  - a8b2ab6 feat(ai/deepseek) — авто-конвертация json_schema → tool для V4-Pro
  - 8f8ad86 docs(second-brain) — рефлексия по фиксу
  - 137baa8 fix(ai) — динамическая сборка JSON Schema для assigneeUserId в strict-провайдерах (доп.)
used-by:
  - clone-reliability-hardening Фаза 6.1 — переключение skill-trait-detect на deepseek-v4-pro
---

> 📦 **АРХИВ (аудит 2026-06-04): ✅ реализовано — 100%.**
> Реализовано полностью (100%): автоконвертация в buildParams, восстановление text в mapResponse, метрика z_deepseek_schema_to_tool_conversion_total, логи, 8 unit-тестов, probe-скрипт — всё подтверждено в коде. Коммиты из 
> ⚠️ Хвосты (см. реестр приоритетов): §8.1 Переключить default-модель в seed-llm-task-routes*.ts на deepseek-v4-pro для приоритетных taskType — отдельное прод
> Полный разбор: `plans/analysis/2026-06-04-tz-audit-reestr-i-prioritety.md`


# Формат вывода для DeepSeek-V4-Pro: автоматическая конвертация json_schema → tools

## 0. Кратко

DeepSeek-V4-Pro с включённым режимом размышления (thinking) **не поддерживает** два механизма, которые сейчас массово используются в коде:

1. `response_format: { type: 'json_schema', strict: true }` — ответ **400 «This response_format type is unavailable now»**.
2. `tool_choice: 'required'` или `tool_choice: { type: 'function', function: { name: ... } }` (принудительный вызов конкретного инструмента) — ответ **400 «Thinking mode does not support this tool_choice»**.

Работает только `tools: [...]` + `tool_choice: 'auto'`.

Это эмпирически проверено в [backend/scripts/eval/probe-deepseek-formats.ts](../../backend/scripts/eval/probe-deepseek-formats.ts) — диагностический пробник 8 вариантов комбинаций форматов.

Сейчас в коде проекта есть 100+ файлов, использующих json_schema, и несколько мест с forced tool_choice. Все они **сломаются на DeepSeek-V4-Pro**, как только LlmRouter попробует к нему обратиться.

**Решение:** не переписывать 100+ caller-ов, а сделать **умную конвертацию в `DeepSeekService`** — она автоматически переключает с json_schema на tools+auto, когда модель — Pro.

## 1. Основание (зачем это нужно)

- Эксперимент по встречам и диалогу: [test/eval/sales-merge-experiment/reports/SUMMARY-ALL.md](../../backend/test/eval/sales-merge-experiment/reports/SUMMARY-ALL.md), [test/eval/dialog-experiment/reports/SUMMARY-ALL.md](../../backend/test/eval/dialog-experiment/reports/SUMMARY-ALL.md).
- Probe: [backend/scripts/eval/probe-deepseek-formats.ts](../../backend/scripts/eval/probe-deepseek-formats.ts) — 4 из 8 комбинаций упали с 400.
- Без этой задачи: миграция на `deepseek-v4-pro` (которая уже частично запланирована в [seed-llm-task-routes*.ts](../../backend/prisma/seed-llm-task-routes-ab-experiment.ts)) **немедленно сломает** все агенты, использующие strict JSON Schema.
- Деньги: Pro сейчас стоит со скидкой 75% — 4× дешевле, чем раньше. Имеет смысл переключать на него.

## 2. Цель

Сделать так, чтобы любой существующий промпт, который сейчас передаёт `responseFormat: { type: 'json_schema', ... }`, корректно работал и на DeepSeek-V4-Pro, **без правок в самом промпте или caller-е**.

## 3. Конкретные изменения в коде

### 3.1 `backend/src/modules/ai/services/deepseek.service.ts`

#### Что есть сейчас (метод `buildParams`)

```typescript
const fmt = input.responseFormat;
if (fmt) {
  if (fmt.type === 'json_object') {
    params['response_format'] = { type: 'json_object' };
  } else if (fmt.type === 'json_schema') {
    // ↓ ЭТО ЛОМАЕТСЯ НА PRO+THINKING
    params['response_format'] = {
      type: 'json_schema',
      json_schema: { name: fmt.name, strict: fmt.strict, schema: fmt.schema },
    };
  }
}
if (input.tools && input.tools.length > 0) {
  params['tools'] = input.tools.map((t) => ({ ... }));
  params['tool_choice'] = 'auto';  // ← уже правильно
}
```

#### Что должно стать

Добавить логику: «если модель Pro И caller передал json_schema И НЕ передал tools — автоматически конвертировать schema в tool и переключить на tools+auto».

```typescript
const isProModel = model.includes('pro');
const fmt = input.responseFormat;

// Автоконвертация json_schema → tool для Pro (thinking не поддерживает strict json_schema).
const autoConvertSchemaToTool =
  isProModel &&
  fmt?.type === 'json_schema' &&
  (!input.tools || input.tools.length === 0);

if (autoConvertSchemaToTool && fmt) {
  // Создаём виртуальный tool из json_schema. Имя — из fmt.name.
  params['tools'] = [{
    type: 'function',
    function: {
      name: `submit_${fmt.name}`,
      description: `Отдать структурированный результат по схеме ${fmt.name}.`,
      parameters: fmt.schema,
    },
  }];
  params['tool_choice'] = 'auto';
  // Подмешиваем в user-сообщение явный hint, иначе модель может не позвать tool.
  const lastMsg = params['messages'][params['messages'].length - 1];
  if (lastMsg.role === 'user') {
    lastMsg.content += `\n\nВажно: верни результат через вызов инструмента submit_${fmt.name}.`;
  }
  // НЕ выставляем response_format — модель сама ответит через tool_calls.
} else if (fmt) {
  // Старая логика для всех остальных случаев (flash и т.д.).
  if (fmt.type === 'json_object') { ... }
  else if (fmt.type === 'json_schema') { ... }
}
```

#### Что должно стать в `mapResponse`

Если был автоконвертированный tool, нужно **читать результат из `tool_calls[0].input`** и положить его в `text` как JSON-стрингифицированный. Это нужно потому, что caller ожидает результат в поле `text` (он сам делает `JSON.parse(text)`).

```typescript
// Если был autoConvertSchemaToTool — стрингифицируем tool args обратно в text,
// чтобы caller, который ждал json_schema-ответ, его получил.
if (toolCalls.length > 0 && toolCalls[0]?.input && !text) {
  text = JSON.stringify(toolCalls[0].input);
}
```

⚠ Это работает потому, что caller передавал json_schema (значит ждал JSON в `text`), а не tools (значит не читает `toolCalls`).

#### Защита от forced tool_choice

Если caller передал `input.tools` с намерением forced — сейчас в коде стоит `tool_choice: 'auto'` (это уже правильно). Дополнительной защиты не нужно. Но **если в коде где-то появится прямой `tool_choice: 'required'`** (грепом проверить — на момент написания ТЗ нет) — заменить на `'auto'` и добавить hint в user-сообщение.

### 3.2 Метрики Prometheus

В [llm-router.service.ts](../../backend/src/modules/ai/services/llm-router.service.ts) или прямо в `DeepSeekService` добавить:

```typescript
// Метрика z_deepseek_schema_to_tool_conversion_total{model}
// — счётчик автоконвертаций.
```

Это нужно чтобы видеть, **сколько раз сработала автоконвертация**. Если число большое — значит много caller-ов всё ещё передают json_schema, имеет смысл задуматься о массовом переводе на tools.

### 3.3 Логирование

При автоконвертации — `logger.debug` (не warn, потому что это штатный путь):

```typescript
this.logger.debug(
  { model, schemaName: fmt.name, taskType: input.taskType },
  'DeepSeek-Pro: автоконвертация json_schema → tool',
);
```

## 4. Тесты

В [backend/src/modules/ai/services/deepseek.service.spec.ts](../../backend/src/modules/ai/services/deepseek.service.spec.ts) (если файл не существует — создать):

1. **Тест 1.** `flash` + `responseFormat: json_schema` → params содержит `response_format: { type: 'json_schema', strict: true }`, НЕТ tools.
2. **Тест 2.** `pro` + `responseFormat: json_schema` (без tools) → params содержит `tools: [{ function: { name: 'submit_<...>', parameters: <schema> } }]`, `tool_choice: 'auto'`, НЕТ response_format. User-сообщение содержит hint.
3. **Тест 3.** `pro` + `tools: [...]` (caller сам передал) → как сейчас, без автоконвертации, tool_choice='auto'.
4. **Тест 4.** `pro` + `responseFormat: json_object` → как сейчас, response_format: json_object, без конвертации.
5. **Тест 5 (интеграционный, опционально).** Реальный вызов на api.deepseek.com с моделью `deepseek-v4-pro` и json_schema → получаем валидный JSON через `text`. Помечен `it.skipIf(!process.env.DEEPSEEK_API_KEY)`.

Запуск: `cd backend && bun run test:unit src/modules/ai/services/deepseek.service.spec.ts`.

## 5. Что НЕ делать

- **НЕ трогать промпты** — 100+ файлов, использующих JSON_SCHEMA. Они остаются как есть.
- **НЕ трогать LlmRouter** (кроме добавления метрики). Маршрутизация — отдельная задача.
- **НЕ менять `protocol-adapter`** — он используется не для DeepSeek (там OpenAI-chat-adapter общий, но конвертация в `DeepSeekService` ближе к источнику проблемы).
- **НЕ переключать defaultModel** с flash на pro в этой задаче — это отдельное решение продакта.
- **НЕ удалять `response_format: json_schema`-путь** в `DeepSeekService` — на flash он работает.

## 6. Acceptance criteria

- [ ] На моделях `deepseek-v4-flash` / `deepseek-chat` — поведение **не изменилось** (json_schema остаётся).
- [ ] На модели `deepseek-v4-pro` — caller с `responseFormat: json_schema` получает валидный JSON в `text` без ручных правок.
- [ ] На модели `deepseek-v4-pro` — caller с `tools` (явно переданными) — поведение не изменилось.
- [ ] Метрика `z_deepseek_schema_to_tool_conversion_total{model}` появляется в `/metrics` и считается.
- [ ] Логи `DeepSeek-Pro: автоконвертация json_schema → tool` появляются при срабатывании.
- [ ] Unit-тесты `deepseek.service.spec.ts` зелёные.
- [ ] Интеграционный smoke на реальном api.deepseek.com (если ключ есть) проходит для обоих сценариев.

## 7. Риски

| Риск | Митигация |
|---|---|
| Pro иногда не позовёт `tool_choice='auto'` (выдаст свободный текст) | Hint в user-сообщении («Важно: верни результат через вызов инструмента submit_…») — эмпирически снижает риск до нуля на длинных промптах. Дополнительно: если `tool_calls[]` пуст, а ждали json — выдать `LlmError('tool not called')` и дать caller-у решить (retry / fallback). |
| Имя tool'а `submit_<schemaName>` может конфликтовать с caller-передаваемыми tools | Конвертация делается **только** когда `input.tools` пуст. Конфликта нет. |
| Длина схемы JSON Schema превышает лимиты `function.parameters` | На DeepSeek таких ограничений в документации нет (1M context). Защита не нужна, в крайнем случае — `LlmError`. |
| Caller где-то полагается на пустоту `text` (когда был json_schema, content приходит с JSON-стрингом) | Мы **сохраняем** text — кладём туда стрингифицированный tool_calls[0].input. То есть совместимо. |

## 8. Связанные задачи (для последующей работы)

После этой задачи можно:

1. **Переключить default-модель** в `seed-llm-task-routes*.ts` на `deepseek-v4-pro` для приоритетных taskType (knowledge-core, chat-v2). Это даст +качество за +30% цены или -50% цены при стабильном кэше.
2. **Удалить `response_format: json_schema`-путь** в `DeepSeekService` через 1-2 месяца, если переход прошёл без регрессий — упростит код.
3. **Применить аналогичный паттерн** к `KieService` (`/claude/v1/messages`) для поддержки tools — сейчас KIE-Claude используется только в свободно-текстовом режиме (см. [judge-kie-claude.ts](../../backend/scripts/eval/judge-kie-claude.ts)).

## 9. Артефакты эксперимента (что использовать как референс)

- [probe-deepseek-formats.ts](../../backend/scripts/eval/probe-deepseek-formats.ts) — диагностический пробник, эмпирически подтверждающий что работает и что нет.
- [run-variant-a-single.ts](../../backend/scripts/eval/run-variant-a-single.ts) — пример реального вызова DeepSeek-Pro через tools+auto. Логика конвертации json_schema → tool — там в `callDeepseek()`.
- [run-dialog-variant-a.ts](../../backend/scripts/eval/run-dialog-variant-a.ts) — то же самое для диалоговой цепочки.

## 10. Передача агенту

Этот файл — самодостаточное ТЗ. Агент-исполнитель должен:

1. Прочитать этот файл целиком.
2. Прочитать `probe-deepseek-formats.ts` — особенно его финальный вывод про 4 работающие комбинации из 8.
3. Прочитать текущий код [deepseek.service.ts](../../backend/src/modules/ai/services/deepseek.service.ts) — методы `buildParams` и `mapResponse`.
4. Вызвать скилы `nestjs-rules`, `core-engineering-standards` для свежей сверки правил проекта.
5. Реализовать пункт 3.1 (одно место — `DeepSeekService`), потом тесты (п. 4), потом метрики (п. 3.2).
6. Запустить `bun run typecheck && bun run lint && bun run test:unit src/modules/ai/services/deepseek.service.spec.ts`.
7. На развилке «удалять ли json_schema путь полностью» — НЕ удалять (см. п. 5 «Что НЕ делать»).
