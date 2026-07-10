# ТЗ: полная доказательная проверка всех LLM-агентов после выноса роутинга в БД

- **Дата:** 2026-07-10
- **Тип:** аудит/верификация (не фича). Выход — вердикты + доказанный фикс, код правится отдельным ТЗ после одобрения.
- **Триггер:** владелец — «раньше модели были в коде, вынесли в БД, после этого сломалось; проверить ВСЕ агенты (166), доказательно, разными стендами и через прод; про flash→pro — доказать, что только pro помогает, иначе не трогать (дорого)».
- **Связано:** [хаб тестирования](../../docs/testing/README.md) · [прогон 2026-07-10](../../docs/testing/README.md#-журнал-лог-прогонов) · инцидент (завести).

---

## 1. Контекст (последние 12 часов)

Вчера вечером программист (а) выкатил роутинг моделей из кода в БД (`LlmTaskRoute`, экран `/admin/ai/routing`), (б) завёл ключи DeepSeek. До этого ключа DeepSeek не было → все deepseek-вызовы падали `требует apiKey` → роутер докатывался до `kie/gemini-3.1-pro`, который справлялся (07-09: entity-graph 172× ok). После активации ключа `deepseek-v4-flash` **впервые реально стал primary** для структурных задач — и сразу вскрылся баг.

## 2. Доказанный корень (репро уже сделан, `scratchpad/repro-block-linker.ts`)

Адаптер [deepseek.service.ts](../../backend/src/modules/ai/services/deepseek.service.ts) при `responseFormat.type==='json_schema'` авто-конвертит схему в tool-call и выбирает `tool_choice`:
`canForce = forceToolChoiceEnabled && !isThinkingModel(model) && !alreadyKnownUnsupported`.

[llm-thinking-models.ts](../../backend/src/modules/ai/services/llm-thinking-models.ts): `isThinkingModel` = «в имени есть `pro` или `thinking`». Отсюда:
- `deepseek-v4-pro` → thinking=TRUE → `tool_choice:auto` → **работает**;
- `deepseek-v4-flash` → в имени нет `pro` → thinking=FALSE → `forceToolChoiceEnabled` дефолт **true** ([typed-config:247](../../backend/src/common/config/typed-config.service.ts#L247)) → `tool_choice:forced` → DeepSeek API (flash — тоже thinking) → **400 «Thinking mode does not support this tool_choice»**.

Репро (реальная схема block-linker, DeepSeek прямой вызов):

| Модель × tool_choice | Итог |
|---|---|
| pro + auto (текущий путь pro) | ✓ валидный вердикт, 18.2с |
| pro + forced | ✗ 400, 0.31с |
| **flash + forced (текущий путь flash)** | ✗ 400, 0.30с ← прод-фейл ~350мс |
| **flash + auto (путь после фикса)** | ✓ валидный вердикт, 2.9с |

Проба форматов ([probe-deepseek-formats.ts](../../backend/scripts/eval/probe-deepseek-formats.ts), flash vs pro — идентичны): `json_object`/plain/`tools:auto` — ✓; `json_schema` (strict и нет) — 400 «unavailable»; `tool_choice: required/forced` — 400.

**Вывод:** проблема не в силе модели. flash по JSON = pro. flash→pro НЕ является фиксом (pro тоже 400 под forced; оба ок под auto; flash в 6× быстрее). pro «работает» лишь потому, что его имя случайно матчит эвристику.

## 3. Объём (что проверяем)

- **166 taskType** в роутинге: 88 primary `deepseek-v4-pro`, **78 primary `deepseek-v4-flash`**, ~8 иные.
- **69 файлов-вызовов** используют `responseFormat.type:'json_schema'` → все они на deepseek идут через конвертацию в tool. Пересечение {flash-primary ∧ json_schema} = основная зона отказа.
- Смежные (вне корня, зафиксировать, не чинить здесь): `kie/gemini-3.1-pro` сегодня отдаёт `validate`-fail (деградация фолбэка), `openai-via-proxy 429` (квота), `MessageOutboxRelayWorker` re-enqueue каждые 30с, `AI_ANALYSIS ON CONFLICT`, S3 `QuotaExceeded` (инцидент INC-2026-07-09-01).

## 4. Гипотезы фикса и дерево решения (что доказать)

| # | Фикс | Стоимость | Как доказываем |
|---|---|---|---|
| A | `ai.deepseek.forceToolChoiceEnabled=false` (крутилка) → всё на `auto` | 0 кода, мгновенно | все flash+json_schema задачи проходят под auto на стенде |
| B | Починить `isThinkingModel`: все `deepseek-v4-*` → thinking | 1 файл | то же + юнит на классификатор |
| C | Сменить `json_schema`→`json_object` у callers | 69 файлов | избыточно, если A/B закрывают |
| D | flash→pro в роутинге | дорого + медленнее | **применять только если доказан агент, где flash-auto стабильно хуже pro-auto** |

Критерий выбора: **A или B**, если ни один агент не проваливает п.5.3 (нет доказанного превосходства pro под равным auto). D — точечно и только по доказанному списку.

## 5. Методология проверки (две поверхности)

### 5.1 Static-аудит (бесплатно, исчерпывающе)
Для каждого из 166 taskType: `group` · primary/secondary/tertiary · использует ли `json_schema` · факт прод-usage за 24ч (`diag.ts usage --task <t>`: доля ok/FAIL) → матрица «агент × здоровье × причина». Ловит ЛЮБОГО сломанного агента, в т.ч. по иной причине.

### 5.2 Dynamic-репро на стенде (offline, реальные ключи, дёшево)
По одному представителю на домен (knowledge-core, chat, probe, tracker, dashboard, operations, support, dialog, clone, orchestrator, concierge): реальный промпт+схема, матрица {flash,pro}×{forced,auto} → parse-success. Подтверждает единый механизм и что фикс (auto) чинит домен. Инструменты: `backend/scripts/eval/*` + самодостаточные репро.

### 5.3 Adversarial «нужен ли pro» (ключевой для владельца)
На выборке сложных схем (большие enum, вложенность, длинный вход): flash-auto vs pro-auto, N прогонов, сравнить parse-success и семантическую корректность (judge). **Гипотеза по умолчанию: pro НЕ лучше.** Опровергнуть или подтвердить с числами. Любой агент, где flash-auto < pro-auto стабильно → в список кандидатов на D.

### 5.4 Прод read-only
После (гипотетического) фикса — по `diag.ts usage` убедиться, что доля FAIL на flash-задачах падает; до фикса — зафиксировать текущую долю как базлайн.

## 6. Оркестрация (ультра, владелец включил)

- **Фаза S (static):** агенты по доменным группам строят матрицу 5.1 (карта + прод-usage). Барьер → сводная health-матрица.
- **Фаза R (repro):** по представителю на домен — матрица 5.2 (self-contained репро через DeepSeek). Идёт конвейером.
- **Фаза A (adversarial):** 5.3 на сложных схемах + независимая перепроверка любого «flash хуже pro».
- **Фаза Z (synthesis):** свод вердиктов: список сломанных агентов + причина; доказан ли единый корень; рекомендация фикса (A/B), список кандидатов на D (если есть) с числами.

## 7. Критерии приёмки вердикта

1. Здоровье всех 166 агентов классифицировано (ok / broken-forced-toolchoice / broken-иное) с пруфом.
2. Доказано, что фикс A/B восстанавливает весь класс flash+json_schema (стенд).
3. Явно перечислены агенты (если есть), которым доказательно нужен pro; иначе — «нет, flash достаточно».
4. Смежные деградации (gemini/openai/outbox/onconflict/s3) зафиксированы отдельными строками, не смешаны с корнем.

## 8. Статус

- [x] Корень найден и воспроизведён (block-linker, probe-formats).
- [x] flash→pro отвергнут доказательно на архетипе.
- [ ] Фаза S/R/A/Z — ультра-оркестрация (запущена отдельно).
- [ ] Вердикты владельцу.
