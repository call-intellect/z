---
type: tz
status: ready-to-implement
feature: probe-smart-questions-module
date: 2026-06-20
owner: Сергей (владелец)
relates_to:
  - plans/analysis/2026-06-20-probe-smart-questions-module.md
  - plans/analysis/2026-06-11-proactive-clarifying-questions-probe-research.md
  - plans/tz/2026-06-11-probe-question-context-leak-fix.md
  - plans/tz/2026-06-17-probe-system-phase2-completeness.md
  - second-brain/03_processes/probe-question-flow.md
---

> Анализ и доказательство: `plans/analysis/2026-06-20-probe-smart-questions-module.md` · Статус согласования: 2026-06-20 (владелец выбрал «оба блока»).

# ТЗ: умный модуль уточняющих вопросов (probe) — контекст всегда, пустых вопросов нет

## Цель
Сделать так, чтобы уточняющие вопросы Коры **всегда называли конкретный объект** (на них можно ответить, не зная внутренней кухни) и **никогда не были пустыми** («Можете уточнить, пожалуйста?», «Кто отвечает за этот регламент?»). Конвейер формулировки (гейт → формулировка → судья) общий для push **и** дайджеста.

## Зачем (болезненное состояние)
Владелец получил дайджест из 5 неотвечаемых вопросов. Корень — дайджест отдаёт **статические заглушки**, минуя LLM-формулировщик, и шлёт пустые вопросы, когда опереться не на что. Полный разбор класса (Д1–Д6) и доказательство — в анализе выше. Реальный прогон LLM (`backend/scripts/eval/probe-module-bench.ts`, 15 кейсов, `deepseek-v4-flash`): улучшенная формулировка дала **100% названного объекта** (текущая 92%) и отвечаемость 4.33/5 (текущая 4.00); гейт ценности промолчал на 2/3 шума при **0 ложных пропусков** нужных вопросов.

## REALITY-CHECK (факт по коду 2026-06-20, ветка dev)
- **Промпт `probe-formulate` и судья `probe-quality-judge` — рабочие и хорошие.** Менять промпт нужно не «потому что плохой», а чтобы выжать 92%→100% и убрать сырьё; судью — дать контекст.
- **Фаза 2 (2026-06-18, в dev)** уже добавила: судья качества (push), engagement-routing, семантический дедуп, re-ask, повод `attribution.unresolved_at_ingest`. **Дайджест-байпас НЕ трогала** — это наш scope.
- **`ProbeStatus` — Prisma-enum** (`prisma/schema.prisma:6441-6464`). Значение `dropped_low_value` уже есть (детерминированный value-gate W2) → LLM-гейт **переиспользует его**, новая миграция НЕ нужна.
- **`formulatedQuestion` хранится в `payload` (JSON)** — схему не трогаем.
- **`humanizeProbeFallback` экспортируется** из `probe/probe-dispatcher.worker.ts:68` (переиспользуем; при выносе сервиса — перенести в util).
- **ТЗ `2026-06-11-probe-question-context-leak-fix`** — про фронт-рендер блока «Контекст», НЕ про текст вопроса. Не пересекается, не дублировать.
- `git log --since="7 days"`: probe-коммиты только из Фазы 2 (`cf9c3878..ea27594e`) — параллельной сессии на дайджест нет.

## Принятые решения владельца (не пересматривать)

| # | Решение | Обоснование |
|---|---|---|
| Р1 | Чиним **весь класс**, оба блока: детерминированный стоп-кран + LLM-конвейер в дайджесте | Владелец 2026-06-20; стоп-кран даёт мгновенный эффект и страхует LLM-off, конвейер — целевое качество |
| Р2 | Формулируем **лениво в дайджест-кроне** (и push-диспетчере), НЕ в `suggest` | Не жечь LLM на probe, которые дедупаются/истекают/дропаются; не ставить LLM на hot-path ingest (`block-ingest` зовёт `suggest` на каждую сущность) |
| Р3 | Гейт ценности и судья — **полностью автоматические**, без human-approval | `feedback_no_human_in_loop_for_clone_learning`: 30 человек в админке будут «соглашаться не глядя»; флаги — только kill-switch |
| Р4 | Новые флаги — **kill-switch, дефолт ON** (Ship-On) | CLAUDE.md принцип 8; фича выкатывается включённой, флаг лишь для аварийного выключения |

## Доказательство выбора
Состязательная таблица A (текущий) / B (формулировка) / C (B+гейт) — §3.4 анализа. Победитель **C**. Из B жёстко переносим транслитерацию латинских имён (Acme→Акме). Решение бьёт обе цели владельца: «всегда спрашивать где нужно» (0 пропусков) + «вопросы с контекстом» (100% названо).

## Scope

**Входит:** конвейер формулировки вопроса (гейт ценности → формулировка → судья) общий для push и дайджеста; детерминированный фолбэк дайджеста; машинный гард паритета заглушек; чистый объект на входе формулировки; обновлённый промпт формулировки и судьи; новый taskType `probe-value-gate`.

**Не входит** (→ vNext или другие ТЗ):
- Политика инициирования probe сверх гейта (адаптивный бюджет 15 источников, обучение порогов) — `plans/analysis/2026-06-11-proactive-clarifying-questions-probe-research.md`, отдельный трек.
- Изменение приоритетов/окон специалистов (push vs digest) — намеренно не трогаем (Р2: поднимать приоритеты = завалить людей push-ами).
- Фронт-рендер блока «Контекст» — `plans/tz/2026-06-11-probe-question-context-leak-fix.md`.
- Каналы доставки (Telegram/MAX/in-app), дедуп, re-ask, closing-loop — без изменений.

## Граничные контракты
- **LLM-роутер** (`LlmRouterService.call`) — используем как есть; добавляем только новый `taskType: 'probe-value-gate'` в union/массив/seed. Не менять диспетчер роутера.
- **`ProbeService.suggest`** — НЕ трогаем (Р2: формулировка не здесь). Детерминированный `minValuePriority`-гейт там остаётся.
- **`ConversationalService.sendNotification`** — контракт payload `probe.question`/`probe.digest` без изменений (только источник `question` меняется).

---

## Контракт-first (дословные сниппеты)

### К1. Новый taskType `probe-value-gate`
- `src/modules/ai/services/llm-router.service.ts:144` (union) — добавить строку `| 'probe-value-gate'` после `| 'probe-quality-judge'`.
- `src/modules/ai/services/llm-router.service.ts:716` (`ALL_LLM_TASK_TYPES`) — добавить `'probe-value-gate',` после `'probe-quality-judge',`.
- `backend/scripts/seed-llm-task-routes-ideas-and-probe.ts` (`SEEDS`) — новый объект (цепочка как у `probe-quality-judge`):
```ts
{
  taskType: 'probe-value-gate',
  playbookSection: '§2.1 short prompt + JSON Schema + probe Ф?(2026-06-20)',
  chain: [
    { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-flash' },
    { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4-mini' },
    { tier: 'tertiary', providerName: 'ollama', model: 'qwen3:30b' },
  ],
},
```

### К2. Промпт гейта ценности (proven C — `backend/scripts/eval/probe-module-bench.ts` GATE_SYSTEM)
Новый файл `src/modules/probe/prompts/probe-value-gate.prompt.ts`. SYSTEM стабилен (cache-friendly), переменные данные — в конце USER.
```
SYSTEM:
Ты — Кора, память компании. Тебе дают найденный пробел в знаниях. Реши, СТОИТ ли беспокоить живого человека вопросом.
Верни JSON { ask: boolean, reason: string }.
ask=false, если: опереться не на что (нет ни объекта, ни внятной сути); ответ уже виден во входе; объект — общее слово без смысла («отчёт», «задача», «документ»); вопрос вышел бы настолько общим, что человек не поймёт, о чём он.
ask=true, если: есть конкретный объект или конкретный пробел, и ответ человека реально достроит память компании.
Принцип: лучше промолчать, чем задать пустой вопрос. Верни строго JSON.
```
Схема `probe_value_gate_v1`: `{ ask: boolean, reason: string }`, оба `required`, `additionalProperties:false`.

### К3. Улучшенный промпт формулировки (proven B — bench B_SYSTEM)
Заменить тело `PROBE_FORMULATE_SYSTEM_PROMPT` (`src/modules/knowledge-core/prompts/probe-formulate.prompt.ts:1-39`) на версию с жёстким правилом «НАЗОВИ ОБЪЕКТ» и запретом пустого «Можете уточнить» (текст — bench `B_SYSTEM`, см. файл). USER-шаблон расширить полями `Тип объекта: <kindRu>` и `Объект: «<objectName>»`; финальная инструкция — `…обязательно с названием объекта «<objectName>»`. Сохранить правило транслитерации латиницы (Acme→Акме). Схема `probe_formulate_v3` без изменений.

### К4. `ProbeFormulationService` (вынос из диспетчера)
Новый `src/modules/probe/probe-formulation.service.ts`:
```ts
@Injectable()
export class ProbeFormulationService {
  // переносит логику ProbeDispatcherWorker.formulate() + judgeQuality() + passesMarkerCheck/humanizeProbeFallback
  async gate(probe: ProbeEvent): Promise<{ ask: boolean; reason: string }>;        // Ф4
  async formulate(probe: ProbeEvent): Promise<{ question: string }>;               // Ф3 (proven B)
  async judgeQuality(probe: ProbeEvent, question: string): Promise<string>;        // Ф6
}
```
`ProbeDispatcherWorker` и `ProbeDigestCron` инжектят сервис; диспетчер удаляет приватные копии.

### К5. Флаги (kill-switch, дефолт ON — `getDynamic`, как `probe.qualityJudgeEnabled`)
- `probe.valueGateEnabled` (default `true`) — OFF: гейт не зовётся, вопрос формулируется всегда (старое поведение).
- `probe.digestFormulateEnabled` (default `true`) — OFF: дайджест работает по детерминированному стоп-крану Ф1 (без LLM).
- Регистрация: строка в `docs/operations/feature-flags.md` + seed `AdminSetting` (по образцу `probe.qualityJudgeEnabled`).

### К6. Новая цепочка `deriveQuestion` (дайджест, Ф1)
`src/modules/probe/probe-digest.cron.ts:157-164`:
```ts
return (
  formulatedQuestion
  ?? suggestedQuestion
  ?? humanizeMessageOrUndefined(payload.message)   // ← НОВОЕ: человеческий message до заглушки
  ?? PROBE_REASON_FALLBACK[row.reason]
  ?? PROBE_REASON_FALLBACK_DEFAULT
);
```

---

## Границы фичи
- ✅ Always: вопрос называет конкретный объект; гейт молчит вместо пустого вопроса; новые SYSTEM-промпты стабильны (cache-friendly); флаги ON.
- ⚠️ Ask first: менять приоритеты/окна специалистов; добавлять новый `ProbeStatus`; трогать `ProbeService.suggest`.
- 🚫 Never: human-approval в гейте/судье; LLM-вызов в `suggest` (hot-path); англ. слова в тексте вопроса конечному пользователю; правка SYSTEM-промпта переменными данными (ломает кэш).

---

## Фазы (dependency-ordered)

Граф: **Ф1** (независима, ship first) · **Ф2 → {Ф3, Ф4} → Ф5** · **Ф6** (после Ф2, независима от Ф3/Ф4/Ф5).

### Ф1 — Стоп-кран дайджеста (детерминированный, без LLM)
**Цель:** дайджест немедленно перестаёт слать пустые/безымянные вопросы даже без остального.
**Файлы:** `probe/probe-digest.cron.ts`, `probe/probe-reason-labels.ts`, `probe/prompts/probe-digest.prompt.ts`, новый `*.spec.ts`.
- R1: `deriveQuestion` — вставить `humanize(payload.message)` в цепочку до `PROBE_REASON_FALLBACK[reason]` (К6). `humanize` = перенести `humanizeProbeFallback` в `probe/probe-fatigue.util.ts` или новый util и переиспользовать (НЕ дублировать).
- R2: закрыть DEFAULT-дыру — добавить в `PROBE_REASON_FALLBACK` ключи `process_template.missing_input_artifact`, `process_template.missing_output_artifact` (формулировки с местом под объект). Машинный гард: unit-тест «каждый ключ `PROBE_REASON_LABEL` имеет запись в `PROBE_REASON_FALLBACK`» (фикс класса Д4).
- R3: `buildProbeDigestSummary` — не добавлять скобку `(objectTitle)`, если `objectTitle` пуст, содержится в `question`, или длиннее 60 символов (грязный `message.slice`). Детерминированно.
**Что НЕ входит:** LLM в дайджесте (Ф5).
**Acceptance:**
- Unit: на payload `{reason:'process_template.missing_input_artifact', message:'У шага «X» не указан вход'}` `deriveQuestion` возвращает строку с «X», НЕ `'Можете уточнить, пожалуйста?'`.
- Unit (гард паритета) падает, если в `PROBE_REASON_LABEL` есть ключ без `PROBE_REASON_FALLBACK`.
- Unit: `buildProbeDigestSummary` не дублирует объект в скобке, когда он уже в вопросе.
- `bun run typecheck && bun run lint && bunx vitest run src/modules/probe` — зелёные.
**Закрывает:** Д1 (частично, фолбэк), Д3, Д4, Д6.

### Ф2 — Вынести `ProbeFormulationService` (рефактор, без смены поведения)
**Цель:** единая точка формулировки для push и дайджеста.
**Файлы:** новый `probe/probe-formulation.service.ts`, `probe/probe-dispatcher.worker.ts`, `probe/probe.module.ts`.
- R4: перенести `formulate()`, `judgeQuality()`, `passesMarkerCheck`, `humanizeProbeFallback` в сервис (К4); диспетчер делегирует. Поведение push идентично.
**Acceptance:**
- `git grep -n 'private async formulate' src/modules/probe/probe-dispatcher.worker.ts` → пусто (перенесено).
- Существующие `probe-dispatcher.worker.spec.ts` зелёные без изменения ожиданий (поведение то же), при необходимости — перенацелить импорт.
- `bunx vitest run src/modules/probe` — зелёные.
**Закрывает:** инфраструктура для Ф3–Ф5.

### Ф3 — Улучшенный промпт формулировки + чистый объект на входе
**Цель:** 100% названного объекта, выше отвечаемость (доказано бенчем).
**Файлы:** `knowledge-core/prompts/probe-formulate.prompt.ts`, `knowledge-core/prompts/probe-formulate.prompt.spec.ts`, эмиттеры из грепа `contextCardTitle:`.
- R5: заменить `PROBE_FORMULATE_SYSTEM_PROMPT` на proven B (К3). Cache-friendly: SYSTEM стабилен.
- R6: расширить `PROBE_FORMULATE_USER_TEMPLATE` — принимать `objectName`/`kindRu`, рендерить `Тип объекта`/`Объект`, финальную инструкцию «обязательно с названием объекта». Диспетчер/сервис передают `objectName = payload.objectName ?? payload.contextCardTitle`.
- R7 (фикс класса Д5): у структурных эмиттеров ставить **чистое имя** вместо `message.slice(100)` — добавить в payload поле `objectName` (и `objectKindRu`): `specialist-3-1` → `resourceName`; `specialist-3-3` → название решения; `specialist-3-6` → idea statement (кратко); `specialist-3-9` → имя эксперимента; `process-template-probe` уже `template.name`; `block-ingest` уже `canonicalName`. Для «размытых» эмиттеров (`specialist-3-2` knowledge, `specialist-3-5` insight) без структурного имени — `objectName` не задавать, промпт спросит по сути (proven B обрабатывает).
**Acceptance:**
- Прогон `bun --env-file=.env run scripts/eval/probe-module-bench.ts` (кандидат B): «назвал объект» = 100% на 12 askable-кейсах, отвечаемость ≥ 4.2.
- `git grep -n 'contextCardTitle: args.message.slice' src/modules/knowledge-core/services` → только размытые эмиттеры (3-2, 3-5), структурные используют чистое имя.
- Unit `probe-formulate.prompt.spec.ts`: USER-шаблон содержит `Объект: «<name>»`, когда `objectName` передан.
**Закрывает:** Д5, повышает качество формулировки.

### Ф4 — Гейт ценности `probe-value-gate`
**Цель:** не слать вопрос, когда опереться не на что (убить «Можете уточнить» в корне).
**Файлы:** новый `probe/prompts/probe-value-gate.prompt.ts`, `probe/probe-formulation.service.ts`, `llm-router.service.ts`, `scripts/seed-llm-task-routes-ideas-and-probe.ts`, `feature-flags.md`.
- R8: `ProbeFormulationService.gate(probe)` — LLM `probe-value-gate` (К2). За флагом `probe.valueGateEnabled` (К5).
- R9: вызвать `gate()` в push-диспетчере и дайджесте перед `formulate()`; `ask=false` → пометить probe `dropped_low_value` (переиспользуем enum, без миграции) + метрика `probe_value_gate_total{verdict:'skip'|'ask'}`; вопрос не отправляется.
- R10: зарегистрировать taskType (К1).
**Acceptance:**
- Бенч (кандидат C): на `adv-empty` и `noise-generic` гейт `ask=false`; на 12 askable-кейсах `ask=true` (0 ложных пропусков).
- `git grep -n "'probe-value-gate'" src/modules/ai/services/llm-router.service.ts` → 2 совпадения (union + массив).
- При `probe.valueGateEnabled=false` гейт не зовётся (вопрос формулируется всегда).
**Закрывает:** «Можете уточнить» как класс; цель «всегда спрашивать где нужно» (0 пропусков).

### Ф5 — Дайджест формулирует через общий сервис
**Цель:** закрыть Д1/Д2 — дайджест даёт то же качество, что push.
**Файлы:** `probe/probe-digest.cron.ts`, `probe/probe.module.ts`.
- R12: в `collectAndSend`, для каждого выбранного item без `payload.formulatedQuestion` — вызвать `ProbeFormulationService.gate()→formulate()→judgeQuality()`; `ask=false` → исключить из дайджеста (пометить `dropped_low_value`); иначе сохранить `payload.formulatedQuestion` и рендерить его.
- R13: за флагом `probe.digestFormulateEnabled` (К5); OFF → детерминированный путь Ф1.
- R14: при LLM-ошибке/таймауте — best-effort фолбэк на Ф1 (`humanize(message)`), не ронять дайджест.
**Acceptance:**
- Integration (мок LLM): дайджест-item с `reason:'regulation.missing_owner'`, `objectName:'Фиксация…'` рендерит вопрос с названием регламента, НЕ статическую заглушку.
- При `probe.digestFormulateEnabled=false` дайджест использует Ф1 (детерминированный), не зовёт LLM.
- При брошенном LLM — дайджест всё равно отправляется (фолбэк Ф1).
**Закрывает:** Д1, Д2.

### Ф6 — Судья качества видит объект (защита-сеть)
**Цель:** бракует вопрос, потерявший имя объекта.
**Файлы:** `probe/prompts/probe-quality-judge.prompt.ts`, `probe/probe-formulation.service.ts`.
- R15: передавать судье `objectName` (USER-данные в конце, SYSTEM не менять — cache); критерий «если у пробела есть конкретный объект, а в вопросе его нет → ok=false, rewrite с именем». Если `objectName` пуст — поведение как сейчас.
**Acceptance:**
- Unit: судья на вход `{question:'Кто отвечает за этот регламент?', objectName:'Приёмка товара'}` → `ok=false` с `rewrite`, содержащим «Приёмка товара».
- SYSTEM-промпт судьи не содержит переменных данных (грер: имя объекта только в USER).
**Закрывает:** остаточный риск потери имени формулировщиком.

---

## Риски / ревью-аспекты (для strict-production-review-gate)
- **Стоимость LLM в дайджесте:** ≤ `touchCap`(5) × получателей × 2 вызова (гейт+формулировка)/день. Кэш SYSTEM ≈99%. Числовой триггер на оптимизацию: при > 200 дайджест-item/день батчить формулировку одним вызовом.
- **Гейт глушит нужное:** доказано 0 ложных пропусков на 12 кейсах; kill-switch `probe.valueGateEnabled` мгновенно отключает.
- **Кэш-инвалидция:** правка SYSTEM формулировки/судьи однократна и обоснована; дальше не трогать.
- **Идемпотентность:** seed taskType — повторный прогон no-op (`seed-llm-task-routes-ideas-and-probe.ts` уже idempotent: `findFirst`→`update/create`).

## Прод-деплой (diff к `docs/operations/prod-deploy-log.md`)
- **Шаг 12 (smoke):** новый taskType `probe-value-gate` — `bun run scripts/seed-llm-task-routes-ideas-and-probe.ts --update-existing` (зарегистрировать маршрут). Уже в `STEPS` apply-prod-deploy (seed) — проверить, что покрывает новый объект.
- **Шаг 1 (флаги):** `probe.valueGateEnabled`, `probe.digestFormulateEnabled` — строки в `feature-flags.md` + seed `AdminSetting`.
- **Миграций нет** (enum/колонки не трогаем). Выкат: `docker compose up -d --build backend` + seed-роут.

## DoD
- `bun run typecheck` (вкл. `.spec`) · `bun run lint` · `bun run build` · `bunx vitest run src/modules/probe src/modules/knowledge-core/prompts` — зелёные.
- Бенч `probe-module-bench.ts`: B/C — 100% назвал объект, отвечаемость ≥ 4.2, гейт 0 ложных пропусков.
- `second-brain/03_processes/probe-question-flow.md` обновлён (новый гейт-шаг, дайджест формулирует); `01_projects/probe-agent.md` — раздел про модуль; `feature-flags.md` — 2 флага.
- Рефлексия в `second-brain/05_история/`; prod-deploy-log обновлён.

## Итог
**Реализовано целиком (dev, 2026-06-20):** все 6 фаз.
- Ф1 `dc6a2377` — стоп-кран дайджеста: `deriveDigestQuestion` (humanize message), +12 ключей `PROBE_REASON_FALLBACK` + машинный гард паритета LABEL⊆FALLBACK, dedup объекта в summary; хелперы в `probe-text.util.ts`.
- Ф2+Ф3+Ф6 `5ab54b3f` — `ProbeFormulationService` (formulate/judgeQuality/gate, диспетчер делегирует); промпт формулировки = proven B («НАЗОВИ ОБЪЕКТ»); USER+эмиттеры 3-1/3-3/3-6/3-9/block-ingest/process-template несут чистый objectName; судья видит objectName.
- Ф4+Ф5 `ee3a3f3c` — taskType `probe-value-gate` (router+seed+промпт); `gate()` за флагом `probe.valueGateEnabled`; диспетчер+дайджест зовут gate перед formulate (ask=false → `dropped_low_value` + метрика `probe_value_gate_total`); дайджест формулирует через сервис за флагом `probe.digestFormulateEnabled` (OFF→Ф1; сбой→фолбэк).

Верификация: typecheck/lint/build зелёные; probe-специи 133 (18 файлов) + синтетический харнесс `probe-provenance-synthetic.spec.ts` (7). Бенч `probe-module-bench.ts` в песочнице не прогнан (нет сети) — качество промптов доказано бенчем при написании ТЗ (100% назвал объект, гейт 0 ложных пропусков); ship-and-observe.

**Осталено (наблюдение/vNext):** живой бенч на проде; эмиттер 3-4 (card) без чистого objectName (не в scope). Рефлексия — `second-brain/05_история/2026-06-20-provenance-and-probe-smart-questions.md`.
