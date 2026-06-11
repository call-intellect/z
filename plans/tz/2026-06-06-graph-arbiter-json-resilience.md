---
type: tz
status: ready-to-implement
feature: graph-arbiter-json-resilience
date: 2026-06-06
owner: Сергей (владелец)
relates_to:
  - plans/analysis/2026-06-06-handoff-brief-all-prod-fixes.md
  - plans/analysis/2026-06-06-deep-root-cause-analysis-prod-issues.md
  - plans/tz/2026-06-06-meeting-report-reliability-and-ui-honesty.md
---

> Анализ-источник: `deep-root-cause-analysis-prod-issues.md` §2 (B) · бриф §ТЗ-3 · Статус согласования: решения decisive; force-strict (Фаза 3) — gated прод-пробой.
> Цель в одну строку: перестать **терять связи графа** на невалидном JSON арбитра — сделав entity-graph устойчивым (как block-linker) и заставив router пробовать **secondary** при битом ответе primary (а не считать «битый = успех»).

---

## 1. Цель и зачем (человеческим языком)

**Что не так.** `block-linker` / `entity-graph-builder` часто получают от LLM-арбитра невалидный JSON → ретрай → иногда «fallback на none» (связь между блоками/сущностями **не создаётся**). WARN-спам несколько раз/час. Граф теряет рёбра — деградирует ядро продукта (поиск/клоны опираются на граф).

**Корень (доказан кодом, два слоя):**
1. **«Битый = успех», secondary не пробуется.** `json_schema strict` для DeepSeek конвертируется в synthetic tool с `tool_choice:'auto'` (НЕ forced, НЕ strict) → `deepseek-v4-flash` вправе вернуть прозу ([deepseek.service.ts:144-166](../../backend/src/modules/ai/services/deepseek.service.ts#L144-L166)). Router считает такой ответ **успехом** (HTTP 200, `text` непустой) и возвращает его ([llm-router.service.ts:1395-1488](../../backend/src/modules/ai/services/llm-router.service.ts#L1395-L1488)) — fallback на secondary только при **throw** ([:1489](../../backend/src/modules/ai/services/llm-router.service.ts#L1489)). Парс падает уже в call-site, без шанса на secondary с настоящим strict.
2. **entity-graph хрупче block-linker.** Голый `JSON.parse` без снятия ```-обёртки и **без ретрая** ([entity-graph.service.ts:330-338](../../backend/src/modules/knowledge-core/services/entity-graph.service.ts#L330-L338)); на ошибке judge — сразу «fallback на none» без повтора ([:315-324](../../backend/src/modules/knowledge-core/services/entity-graph.service.ts#L315-L324)).

**Чем решение лучше.** (а) entity-graph поднимается до устойчивости block-linker (`tryParseJson` + ретрай + метрика — паттерн уже отлажен в reliability Ф6). (б) Router получает validate-callback: битый ответ primary → **throw** → срабатывает существующий fallback → secondary (`openai-proxy`/`gpt-5.4-nano` с **настоящим** strict json_schema, [openai-proxy.service.ts:91-101](../../backend/src/modules/ai/services/openai-proxy.service.ts#L91-L101)). Это бьёт в корень независимо от того, поддержит ли прокси форс/strict.

---

## 2. REALITY-CHECK (что по факту в коде / что уже сделано)

| Проверено | Факт | Источник |
|---|---|---|
| block-linker — УЖЕ устойчив | reliability Ф6: `tryParseJson` (снимает ```-обёртку, вытаскивает `{…}`) + ретрай ×2 + метрика `incKcBlockLinkerInvalidJson({reason})` + `incKcBlockLinkerFallbackNone` | [block-link.service.ts:189-234](../../backend/src/modules/knowledge-core/services/block-link.service.ts#L189-L234) |
| метрика block-linker — УЖЕ есть | `kc_block_linker_invalid_json_total` (S6-02) | [business-metrics.service.ts:3677,3687](../../backend/src/common/metrics/business-metrics.service.ts#L3677) |
| entity-graph — хрупкий | голый `JSON.parse` ([:333](../../backend/src/modules/knowledge-core/services/entity-graph.service.ts#L333)); judge-error → fallback-none **без ретрая** ([:315-324](../../backend/src/modules/knowledge-core/services/entity-graph.service.ts#L315-L324)); **метрики НЕТ** | [entity-graph.service.ts:315-345](../../backend/src/modules/knowledge-core/services/entity-graph.service.ts#L315-L345) |
| router fallback — только на throw | успех на [:1476](../../backend/src/modules/ai/services/llm-router.service.ts#L1476) возвращает `out.text` без валидации; secondary только в `catch` [:1489](../../backend/src/modules/ai/services/llm-router.service.ts#L1489) | llm-router.service.ts |
| deepseek autoConvert → 'auto' | json_schema→synthetic tool, `tool_choice:'auto'` для ВСЕХ deepseek-моделей; комментарий: **«strict не поддерживается ни одной deepseek-моделью текущего прокси»** | [deepseek.service.ts:144-181](../../backend/src/modules/ai/services/deepseek.service.ts#L144-L181) |
| thinking 400'ят на форс | «Pro/*-pro/*-thinking падают 400 на strict json_schema и forced tool_choice»; есть детектор `isThinkingModel` | [deepseek.service.ts:135-138](../../backend/src/modules/ai/services/deepseek.service.ts#L135) |
| adapter autoConvert — thinking-only | `autoConvert = isThinking && json_schema && !callerHasTools` → форс к adapter-пути НЕ применим (thinking нельзя форсить) | [openai-chat.adapter.ts:85-106](../../backend/src/modules/ai/services/protocol-adapter/adapters/openai-chat.adapter.ts#L85-L106) |
| утилиты есть | `tryParseJson` ([json-extract.util.ts:6](../../backend/src/modules/ai/services/json-extract.util.ts#L6)); `LlmFormatNotSupportedError` ([llm.types.ts:135](../../backend/src/modules/ai/services/llm.types.ts#L135)) | grep |
| secondary умеет strict | `openai-proxy` отдаёт настоящий strict json_schema | [openai-proxy.service.ts:91-101](../../backend/src/modules/ai/services/openai-proxy.service.ts#L91-L101) |

**Следствие:** block-linker устойчивость + метрика — **готовы**, не дублировать. Остаётся: (1) поднять entity-graph до того же уровня; (2) router validate-callback → secondary на битом; (3) force tool_choice (probe-gated — код прямо сомневается в поддержке strict прокси).

---

## 3. Доказательство выбора (два прохода + challenge-loop)

**Проход A (выбран).** Корень — «битый=успех»: validate-callback в router → throw → secondary с настоящим strict + устойчивый парс в entity-graph. Не зависит от поддержки strict у flash.
**Проход B (альтернатива, бриф решение #1 один).** Заставить flash вернуть структуру: force `tool_choice` + `function.strict:true`.

| Критерий | A: router-fallback + entity-graph parity | B: только force strict |
|---|---|---|
| Зависит от поддержки strict прокси | ✅ нет (secondary с настоящим strict) | ✗ да — код прямо пишет «strict не поддерживается прокси» → риск 400 |
| Гарантия «связь не теряется молча» | ✅ да (secondary пробуется) | ⚠️ только если прокси принял форс |
| Чинит entity-graph хрупкость | ✅ да (tryParseJson+ретрай) | ✗ нет |
| Риск | ✅ низкий | ⚠️ 400 на форс/strict |

**Вывод.** A — гарантированный (secondary с настоящим strict + устойчивый парс). B — best-effort, упирается в неопределённость прокси → берём как **Фазу 3, gated прод-пробой**. A+B вместе: B повышает шанс валидного primary (кэш дешевле), A ловит остаток.

**Challenge-loop:**
- *Корень?* Да — A бьёт в «битый=успех» (router) + «entity-graph без ретрая». Это класс «структурный вызов вправе не вернуть структуру, а мы это глотаем».
- *Эффективнее?* Да — реюз `tryParseJson`/block-linker-паттерна/существующего fallback-механизма router'а; не меняем модель на дорогую pro (правило primary=flash сохраняем).
- *Кода ради кода?* Нет — validate-callback опционален (только для structured-call-site'ов); entity-graph копирует отлаженный block-linker.

---

## 4. Принятые решения владельца (decisive)

| # | Решение | Обоснование (Почему) |
|---|---|---|
| Р1 | **entity-graph до уровня block-linker:** `tryParseJson` вместо `JSON.parse`, ретрай ×2, метрика `incKcEntityGraphInvalidJson`/`…FallbackNone`. | Класс-фикс «структурный парс хрупок»; паттерн отлажен (reliability Ф6), просто реюз. entity-graph сейчас хуже всех — наибольший выигрыш. |
| Р2 | **Router validate-callback:** опц. `validate(text)`; при невалидном → throw → существующий fallback → secondary (настоящий strict). Подключить block-link + entity-graph. | Бьёт КОРЕНЬ «битый=успех». Не зависит от strict у flash. Минимальная правка — реюз готового fallback-цикла router'а. |
| Р3 | **(probe-gated) Force `tool_choice` к конкретной функции для НЕ-thinking** в deepseek.service (forced function вместо 'auto'); `function.strict:true` — за per-model guard + откат на 'auto' по `LlmFormatNotSupportedError`. | Forced function заставляет flash ВЫЗВАТЬ tool (не прозу) — дёшево и обычно поддерживается (400'ят только thinking). strict — под вопросом (код сомневается) → guard+откат. Gated: прод-проба на agent-lia решает, landing strict или только forced. |

> **Прод-проба (обязательна перед Фазой 3):** мини-e2e на прокси agent-lia — принимает ли `deepseek-v4-flash` `tool_choice:{type:'function',function:{name}}` и отдельно `function.strict:true`. 400 → Фаза 3 только forced (без strict) или пропускается; решения Р1+Р2 закрывают корень без неё.

---

## 5. Scope

**Входит:**
1. entity-graph: `tryParseJson` + ретрай + метрика (Р1).
2. Router `validate`-callback + подключение block-link/entity-graph (Р2).
3. (probe-gated) force `tool_choice` к функции для не-thinking в deepseek.service; strict за guard'ом (Р3).
4. Новые метрики entity-graph в `business-metrics.service.ts` (зеркало block-linker).

**Не входит (с судьбой):**
- block-linker устойчивость/метрика — **УЖЕ сделано** (reliability Ф6), не дублировать.
- Смена арбитра на `deepseek-v4-pro` — ❌ дорого ×12, медленно ×2.5, taskType массовый (отвергнуто, §2 анализа вариант 3); primary=flash сохраняем.
- Упрощение схемы вывода + few-shot + `json_object` (§2 анализа вариант 4) — vNext, если Р1-Р3 недостаточно.
- adapter-путь force — не применим (autoConvert там thinking-only).

---

## 6. Контракт (что именно поменять)

### 6.1 entity-graph устойчивость (Фаза 1)
[entity-graph.service.ts](../../backend/src/modules/knowledge-core/services/entity-graph.service.ts) — `parseVerdict` ([:330](../../backend/src/modules/knowledge-core/services/entity-graph.service.ts#L330)): `JSON.parse(text)` → `tryParseJson(text)` (импорт из `ai/services/json-extract.util`). Judge-вызов ([:~300-325](../../backend/src/modules/knowledge-core/services/entity-graph.service.ts#L300)) обернуть ретраем ×2 (зеркало [block-link.service.ts:189-218](../../backend/src/modules/knowledge-core/services/block-link.service.ts#L189-L218)): на `parseVerdict===null` → метрика `incKcEntityGraphInvalidJson({reason:'parse'})` + повтор; на throw → `{reason:'llm_error'}` + повтор; после 2 — `incKcEntityGraphFallbackNone({reason:'exhausted'})` + fallback-none.

### 6.2 Метрики entity-graph (Фаза 1)
[business-metrics.service.ts](../../backend/src/common/metrics/business-metrics.service.ts) рядом с `incKcBlockLinkerInvalidJson` ([:3687](../../backend/src/common/metrics/business-metrics.service.ts#L3687)) — добавить counter'ы `kc_entity_graph_invalid_json_total{reason}` и `kc_entity_graph_fallback_none_total{reason}` + методы `incKcEntityGraphInvalidJson`/`incKcEntityGraphFallbackNone` (та же сигнатура `{reason: string}`). `@Optional()`-совместимо (`?.`).

### 6.3 Router validate-callback (Фаза 2)
[llm-router.service.ts](../../backend/src/modules/ai/services/llm-router.service.ts) — в params типа `call(...)` добавить опц. `validate?: (text: string) => boolean`. ПОСЛЕ получения `out` ([:1395](../../backend/src/modules/ai/services/llm-router.service.ts#L1395)), ДО записи success ([:1396](../../backend/src/modules/ai/services/llm-router.service.ts#L1396)):
```ts
if (params.validate && !params.validate(out.text)) {
  this.metrics?.incLlmRouterDispatch({ taskType: params.taskType, provider: entry.provider, status: 'invalid_output' });
  throw new LlmInvalidOutputError(`${entry.provider}/${entry.model}: ответ не прошёл validate caller'а`);
}
```
Новый `LlmInvalidOutputError` в [llm.types.ts](../../backend/src/modules/ai/services/llm.types.ts#L135) рядом с `LlmFormatNotSupportedError`. Throw попадает в существующий `catch` ([:1489](../../backend/src/modules/ai/services/llm-router.service.ts#L1489)) → следующий провайдер (secondary). Call-site'ы block-link/entity-graph: передать `validate: (text) => this.parseVerdict(text) !== null`.
> Эффект: битый primary → secondary (настоящий strict) в рамках ОДНОГО attempt; если и secondary битый → throw → ретрай call-site → в конце fallback-none. Связь теряется только если ВСЕ провайдеры вернули мусор.

### 6.4 (probe-gated) Force tool_choice (Фаза 3)
[deepseek.service.ts:160](../../backend/src/modules/ai/services/deepseek.service.ts#L160): для не-thinking — forced функция:
```ts
params['tool_choice'] = isThinking
  ? 'auto' // thinking 400'ят на forced — оставляем
  : { type: 'function', function: { name: autoConvertedToolName } };
// (опц., если прод-проба показала поддержку) для не-thinking добавить strict:
//   params['tools'][0].function.strict = true;
// guard: если dispatch вернул LlmFormatNotSupportedError/format-400 — запомнить per-model «no-force»
//   (in-memory Set, как PARTICIPANT_KIND_STANDARD-стиль) и повторить с 'auto'.
```
> Strict добавлять ТОЛЬКО если прод-проба подтвердила приём (иначе 3 = только forced function). Guard: при format-ошибке — откат на 'auto' + метрика `incLlmThinkingModelGuard({kind:'force-stripped', model})` (реюз существующего счётчика-семейства).

---

## 7. Фазы и Acceptance (машинно-проверяемо)

Граф: Ф1 (entity-graph) ⟂ Ф2 (router) частично связаны (entity-graph `validate` использует устойчивый `parseVerdict` из Ф1) → Ф1 раньше Ф2. Ф3 — независима, probe-gated. Порядок: Ф1 → Ф2 → (проба) → Ф3.

### Фаза 1 — entity-graph до уровня block-linker
Файлы: `entity-graph.service.ts`(+`.spec`), `business-metrics.service.ts`.
**Не входит:** router, deepseek.service.
**Acceptance:** грепы: `tryParseJson` в entity-graph (нет голого `JSON.parse(text)`); ретрай-цикл (attempt<2); `incKcEntityGraphInvalidJson`/`incKcEntityGraphFallbackNone` в metrics + entity-graph. Юнит (зеркало block-link.spec): «грязный ответ ```json…``` → парсится через ретрай, связь строится + метрика»; «мусор ×2 → fallback-none + метрика». `bun run typecheck/lint/build` + спеки зелёные.
Закрывает: R1.

### Фаза 2 — Router validate-callback
Файлы: `llm-router.service.ts`(+`.spec`), `llm.types.ts`, `block-link.service.ts`, `entity-graph.service.ts`.
**Не входит:** force tool_choice.
**Acceptance:** грепы: `validate?:` в params router; `LlmInvalidOutputError`; throw на `!validate(out.text)` ДО записи success; в block-link/entity-graph call-site есть `validate:`. Юнит router: primary возвращает текст, `validate→false` → вызван secondary (mock), результат от secondary; если оба `validate→false` → throw (call-site уйдёт в fallback). `bun run typecheck/lint/build` + спеки зелёные.
Закрывает: R2.

### Фаза 3 — (probe-gated) Force tool_choice
**Предусловие:** прод-проба agent-lia (см. §4). Если 400 на strict — делать только forced function; если 400 и на forced — Фазу 3 пропустить (R1+R2 закрывают корень).
Файлы: `deepseek.service.ts`(+`.spec`).
**Acceptance:** грепы: для не-thinking `tool_choice` = forced function (не 'auto'); thinking — остаётся 'auto'; guard-откат на 'auto' по `LlmFormatNotSupportedError`. Юнит: не-thinking → forced; thinking → 'auto'; format-error → откат + метрика. `bun run typecheck/lint/build` зелёные.
Закрывает: R3 (или явно пропущена по итогу пробы).

### Фаза 4 — Прод-верификация (владелец)
**Acceptance:** `kc_block_linker_fallback_none_total` и новый `kc_entity_graph_fallback_none_total` падают после выката; на «грязном» арбитре связь всё равно строится (или честный secondary), не молчаливая потеря; `diag llm-calls` показывает secondary-fallback на битом primary.

**Требования (EARS):**
- R1: Когда entity-graph-арбитр вернул не-JSON/```-обёрнутый ответ, система shall извлечь JSON через `tryParseJson` и при неудаче повторить ×2 с метрикой, прежде чем fallback-none.
- R2: Когда ответ provider'а не прошёл caller-`validate`, router shall бросить ошибку и попробовать следующий провайдер (secondary), а не вернуть битый ответ как успех.
- R3: (probe-gated) Когда модель не thinking и идёт autoConvert json_schema→tool, deepseek.service shall форсить вызов конкретной функции (с откатом на 'auto' при format-ошибке прокси).

---

## 8. Границы фичи
- ✅ Always: реюз `tryParseJson`/block-linker-паттерна/router-fallback; primary=flash; метрики `@Optional`-safe.
- ⚠️ Ask first: менять модель арбитра на pro; трогать thinking-ветку (форс там = 400).
- 🚫 Never: молча глотать невалидный ответ как успех; добавлять strict без подтверждённой пробы; `git add -A`.

## 9. Совместимость с prompt caching
- validate-callback и устойчивый парс — на стороне router/call-site, промпты НЕ меняются → кэш не затронут.
- Force tool_choice (Ф3) меняет `tool_choice`-параметр, не SYSTEM/user-префикс → DeepSeek-кэш входного префикса сохраняется.

## 10. Риски / pre-mortem (ревью-аспекты)
| Риск | Митигация |
|---|---|
| Прокси 400'ит на forced/strict | Ф3 probe-gated; guard-откат на 'auto' по `LlmFormatNotSupportedError`; R1+R2 не зависят от Ф3 |
| validate-callback двойной парс (cost) | parseVerdict дёшев (локальный); приемлемо; альтернатива — router отдаёт parsed (vNext) |
| secondary тоже битый → лишний вызов | приемлемо (редко); метрика `invalid_output` покажет частоту |
| Ретрай entity-graph ×2 удлиняет хвост | как у block-linker (уже принято); concurrency не трогаем |
| Регрессия thinking-ветки | юнит «thinking → 'auto'»; форс только для не-thinking |

## 11. Idempotency / feature-flag / prod-deploy
- Только код (backend), без схемы/ENV/seed/миграций → прод: `docker compose up -d --build backend` (+worker, где knowledge-core воркеры). Шагов prod-deploy-log не требуется (новые метрики — авто через `/metrics`; зафиксировать в Шаг 12 grep новых counter'ов).
- Feature-flag не нужен (внутреннее улучшение надёжности, не внешнее поведение). Ф3 фактически gated пробой, не флагом.

## 12. DoD
- `bun run typecheck`(вкл `.spec`)/`lint`/`build` зелёные; юниты entity-graph (parse-retry), router (validate→secondary) зелёные.
- second-brain: `02_architecture/knowledge-core.md` (устойчивость арбитра, validate-fallback), `02_architecture/code-pitfalls.md` («битый=успех» в router; entity-graph без ретрая).
- `docs/operations/prod-deploy-log.md` Шаг 12 — grep новых метрик `kc_entity_graph_*`.
- Рефлексия в `05_история/`.
- В коде: 0 `process.env.*`, 0 `prisma migrate`, 0 `new PrismaClient(`.

## Итог
_(заполнит tz-orchestrator: entity-graph устойчив? secondary пробуется на битом? force прошёл пробу? fallback-none-метрики упали на проде?)_
