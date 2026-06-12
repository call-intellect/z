---
type: tz
status: ready-to-implement
feature: main-report-deepseek-routing
date: 2026-06-06
owner: Сергей (владелец)
relates_to:
  - plans/analysis/2026-06-06-deep-root-cause-analysis-prod-issues.md
  - plans/analysis/2026-06-06-retest-RESULTS-technical.md
---

> Анализ-источник: `plans/analysis/2026-06-06-deep-root-cause-analysis-prod-issues.md` §9 · Статус согласования: ожидает ревью владельца.
> Цель в одну строку: перевести главный AI-отчёт встречи (`analyze.worker`) с MiniMax на **DeepSeek primary**, чтобы работал prompt-кэш DeepSeek и (на дешёвой flash-модели) падала цена — **минимальной правкой одного сервиса, без новых систем**.

---

## 1. Цель и зачем (человеческим языком)

**Что не так сейчас.** Главный отчёт встречи (краткое содержание, отчёт по типу, follow-up письмо, задачи, custom) генерируется **мимо** общего БД-роутера моделей. `analyze.worker` зовёт отдельный `LlmFallbackService`, у которого **primary = MiniMax** (исторически: Anthropic дал РФ-403 → заменили на MiniMax, коммит `bb11babf`). Поэтому:
- кэш DeepSeek на главном отчёте **не работает** (MiniMax — другой провайдер);
- в системе **две независимые системы маршрутизации** моделей (БД-роутер `LlmRouterService` для новых агентов + хардкод-каскад `LlmFallbackService` для отчёта) — источник путаницы «в БД стоит deepseek, а реально едет minimax».

**Доказательство (факт прода).** На обеих свежих встречах `diag llm-calls`: `summary/-`, `report-by-type/-`, `tasks/-` → `minimax:MiniMax-M2.5`, хотя в прод-БД для `summary` стоит `deepseek-v4-pro`, а MiniMax в маршрутах вообще нет.

**Чем решение лучше.** После правки главный отчёт идёт на DeepSeek → (а) работает кэш DeepSeek; (б) на `deepseek-v4-flash` цена ниже текущей MiniMax (факт прода: flash-агенты ~$0.0003/вызов против MiniMax ~$0.0005–0.001/вызов); (в) одна логика провайдеров вместо двух.

> **Честно про кэш и «длинные встречи» (важно, не приукрашиваю).** DeepSeek кэширует **входной префикс** запроса. У отчёта стабилен только SYSTEM-промпт (он закэшируется между встречами — небольшая экономия), а сам транскрипт сидит в переменной USER-части и при текущей структуре промптов **между агентами одной встречи не шарится** (у каждого агента свой SYSTEM → префикс расходится). Большая экономия «длинная встреча = дешевле» включается только если транскрипт вынести в общий ведущий префикс всех 4–5 агентов — это **отдельная оптимизация (vNext, §9)**, не входит в это минимальное ТЗ. Владелец выбрал pro на отчёт (Р2) ради качества — это per-call дороже текущего MiniMax, но в обмен на надёжный формат и кэш DeepSeek; дешёвые `tasks`/`custom` на flash экономят. Главную цену длинной встречи (транскрипт) срежет именно префикс-оптимизация vNext.

---

## 2. REALITY-CHECK (что по факту в коде)

| Проверено | Факт | Источник |
|---|---|---|
| Кто зовёт `LlmFallbackService` | **Ровно один потребитель** — `analyze.worker` | греп `Inject(LlmFallbackService)` = [analyze.worker.ts:94](../../backend/src/modules/ai/workers/analyze.worker.ts#L94), больше нигде |
| Интерфейс DeepSeek | `DeepSeekService.complete(input: LlmCompleteInput)` существует, тот же контракт, что у `MinimaxService.complete`; модель = `input.model ?? defaultModel` (default `deepseek-v4-flash`) | [deepseek.service.ts:56-57](../../backend/src/modules/ai/services/deepseek.service.ts#L56-L57) |
| Как отчёт зовёт LLM | `callLlm` → `LlmFallbackService.complete(input)`; пишет `AiUsageLog` сам (fallback-сервис лог НЕ пишет) | [analyze.worker.ts:846-894](../../backend/src/modules/ai/workers/analyze.worker.ts#L846-L894) |
| Структурный отчёт (`report-by-type`) | использует **нативные Anthropic-`tools:[tool]`** + 3 ретрая с Zod-валидацией, НЕ `responseFormat json_schema` | [analyze.worker.ts:694-730](../../backend/src/modules/ai/workers/analyze.worker.ts#L694-L730) |
| `summary`/`custom` | свободный текст (без tools/schema) | [analyze.worker.ts:538-547](../../backend/src/modules/ai/workers/analyze.worker.ts#L538-L547) |
| cacheControl | `callLlm` уже шлёт `cacheControl:'ephemeral'`; `LlmFallbackService` тоже доставляет; для DeepSeek авто-кэш не зависит от этого флага | [analyze.worker.ts:544](../../backend/src/modules/ai/workers/analyze.worker.ts#L544), [llm-fallback.service.ts:53-57](../../backend/src/modules/ai/services/llm-fallback.service.ts#L53-L57) |
| §2-риск (DeepSeek tool_choice:'auto') | **НЕ применяется** к отчёту: авто-конверсия `json_schema→tool` срабатывает только при `responseFormat json_schema && !callerHasTools` ([deepseek.service.ts:139](../../backend/src/modules/ai/services/deepseek.service.ts#L139)); отчёт передаёт `tools` → `callerHasTools=true` → DeepSeek берёт tools нативно (OpenAI tool-calling) | вывод из кода |

**Следствие для дизайна:** правка контейнерна (1 потребитель), DeepSeek-интерфейс готов, нативные tools обходят §2. Это и делает «swap primary» минимальным и низкорисковым.

---

## 3. Доказательство выбора (два прохода)

**Проход A — swap primary в `LlmFallbackService`** (MiniMax→DeepSeek, MiniMax оставить вторым).
**Проход B — мигрировать `analyze.worker` на `LlmRouterService`** (по taskType, БД-роуты).

| Критерий (= ограничение фичи) | A: swap primary | B: migrate to router |
|---|---|---|
| Объём изменений | ✅ S (1 сервис + per-agent модель + флаг) | ✗ M–L (5 call-sites, taskType-маппинг, двойной лог, нет route `report-by-type`) |
| DeepSeek primary + кэш | ✅ | ✅ |
| §2 (tool_choice:'auto' рушит структурный отчёт) | ✅ обходится (нативные tools) | ✗ задевает: router шлёт `responseFormat json_schema` → DeepSeek авто-конверт → 'auto' → ненадёжно (нужен сперва фикс §2) |
| Затрагивает других потребителей | ✅ нет (1 консьюмер) | ✅ нет (точечно) |
| Качество отчёта (сохранить как у MiniMax) | ✅ модель задаётся per-agent (`input.model`) | ✅ по БД-route (summary→pro) |
| Админ-тюнинг модели без кода | ✗ (модель в worker) | ✅ (БД-route/админка) |
| Архитектурный долг «2 системы роутинга» | ✗ остаётся | ✅ убирается |
| Риск регрессии | ✅ низкий | ⚠️ средний (tools↔responseFormat, §2, двойной лог) |

**Вывод.** Для текущей цели («минимально, без раздувания» + DeepSeek-кэш + не уронить качество) выигрывает **A**: меньше кода, обходит §2 за счёт нативных tools, контейнерно. Минус A (модель в коде, 2 системы) — терпимый и выносится в vNext.

**Challenge-loop по A:**
- *Корень, не симптом?* Да — лечится КЛАСС «отчёт мимо DeepSeek»: один свитч переводит все 5 agentType отчёта. Не точечный костыль на один агент.
- *Самое эффективное?* Да для «минимально». Полная унификация на роутер (B) — правильнее архитектурно, но дороже и упирается в §2; выносим в **vNext ТЗ-7** (migrate-to-router) с предусловием «сначала фикс §2».
- *Код ради кода?* Нет — переиспользуем готовый `DeepSeekService`; новых систем не добавляем; наоборот, готовим почву убрать `LlmFallbackService` в vNext.

---

## 4. Принятые решения (с обоснованием «почему»)

| # | Решение | Почему (человеческим языком) |
|---|---|---|
| Р1 | **Каскад `LlmFallbackService`: DeepSeek (primary) → MiniMax (secondary) → OpenAI-via-proxy (tertiary).** MiniMax НЕ выкидываем, опускаем на второй. | DeepSeek — цель владельца (кэш+цена). MiniMax оставляем страховкой: если DeepSeek отвалится/деградирует — отчёт упадёт на проверенный MiniMax, без регрессии качества. Минимальная правка: переставить порядок + подключить уже существующий `DeepSeekService`. |
| Р2 | **Решено владельцем (2026-06-06): `deepseek-v4-pro` для отчётных агентов** — `summary`, `report-by-type`, `follow-up` (через `input.model='deepseek-v4-pro'`). `tasks`, `custom` остаются на flash (default). | Владелец выбрал качество отчёта приоритетом над экономией на нём. Pro надёжнее держит формат и нюанс на сыром ASR-транскрипте (не хуже текущего MiniMax, обычно лучше); цена pro (~$0.012–0.016/вызов) приемлема для 30-местной компании, а DeepSeek-кэш частично компенсирует. `tasks`/`custom` — механические/структурные, им хватает дешёвой flash (качество задач отдельно лечит ТЗ-4). |
| Р3 | **Kill-switch — ENV-флаг `LLM_MAIN_REPORT_PRIMARY` ∈ {`minimax`,`deepseek`}, default `minimax`.** | Смена модели отчёта — внешне-наблюдаемое поведение → правило Z «за флагом, дефолт = текущее поведение, есть откат». Дефолт `minimax` = сегодняшнее поведение (безопасный выкат): код едет на прод нейтрально, владелец флипает `deepseek` на проде, смотрит 1 встречу, при беде флипает обратно. Без передеплоя. Один ENV — это «минимальная настройка», не раздувание. |
| Р4 | **Структурный отчёт оставляем на нативных `tools:[tool]`** (не переводим на `responseFormat`). | Именно нативные tools обходят §2 (DeepSeek tool_choice:'auto'). Перевод на `responseFormat` сейчас = риск ненадёжного JSON. Ничего не меняем в формате — только провайдера. |

> **Р2 закрыто владельцем: pro на отчёт** (`summary`/`report-by-type`/`follow-up` → `deepseek-v4-pro`; `tasks`/`custom` → flash). Развилки нет.

---

## 5. Scope

**Входит:**
1. Перестановка каскада в `LlmFallbackService` на DeepSeek-primary (Р1) за ENV-флагом (Р3).
2. ENV-флаг `LLM_MAIN_REPORT_PRIMARY` в `env.schema.ts` + `TypedConfigService` (Р3).
3. (Р2, обязательно) per-agent `input.model='deepseek-v4-pro'` в `analyze.worker` для `summary`/`report-by-type`/`follow-up`; `tasks`/`custom` остаются flash.
4. Метрика/лог: в `AiUsageLog` по отчёту виден `provider=deepseek` (уже пишется из `result.provider`).

**Не входит (vNext, с судьбой):**
- **ТЗ-7 — миграция `analyze.worker` на `LlmRouterService`** (унификация на один роутер, убрать `LlmFallbackService`). Предусловие: фикс §2. Ссылка: `plans/analysis/2026-06-06-deep-root-cause-analysis-prod-issues.md` §2,§9.
- **Оптимизация транскрипт-префикса** (шаринг транскрипта между 4–5 агентами для кэша) — §9 анализа, отдельным ТЗ с числовой моделью экономии.
- **Унификация источников задач** — см. §8 ниже, выносится отдельным **ТЗ-4**.
- 11 не-DeepSeek-primary taskType (ollama/gpt классификаторы) — отдельной точечной правкой сидов, не здесь.

---

## 6. Контракт (что именно поменять)

### 6.1 ENV-флаг (Фаза 1)
В `backend/src/common/config/env.schema.ts` добавить (рядом с прочими `LLM_*`):
```
LLM_MAIN_REPORT_PRIMARY: z.enum(['minimax', 'deepseek']).default('minimax')
```
Прокинуть в `TypedConfigService` геттером (напр. `ai.mainReport.primary`). **Никаких `process.env.*` в коде** — только через `TypedConfigService` (правило Z).

### 6.2 `LlmFallbackService` (Фаза 1)
Внедрить `DeepSeekService`, выбрать primary по флагу. Каскад (Р1) при `deepseek`: DeepSeek → MiniMax → OpenAI; при `minimax` (default): текущее поведение (MiniMax → OpenAI). Идея (псевдо-сниппет, точные строки перечитать перед правкой — якорь `async complete(`):
```ts
async complete(input: LlmCompleteInput): Promise<LlmCompleteOutput> {
  const withCache = input.system.cacheControl === undefined
    ? { ...input, system: { ...input.system, cacheControl: 'ephemeral' } }
    : input;
  const primary = this.cfg.<...>.mainReport.primary; // 'minimax' | 'deepseek'
  if (primary === 'deepseek') {
    try { return await this.deepseek.complete(withCache); }
    catch (err) { this.logger.warn(`Fallback DeepSeek→MiniMax: ${errMsg(err)}`); this.metrics?.incLlmFallback('minimax'); }
    try { return await this.minimax.complete(withCache); }
    catch (err) { this.logger.warn(`Fallback MiniMax→OpenAI: ${errMsg(err)}`); this.metrics?.incLlmFallback('openai-via-proxy'); }
    return this.openai.complete(withCache);
  }
  // primary === 'minimax' — текущее поведение без изменений (rollback-путь)
  try { return await this.minimax.complete(withCache); }
  catch (err) { this.logger.warn(`Fallback MiniMax→OpenAI: ${errMsg(err)}`); this.metrics?.incLlmFallback('openai-via-proxy'); }
  return this.openai.complete(withCache);
}
```
> Не «оптимизировать» в один тернарный каскад — две явные ветки нужны, чтобы путь `minimax` был дословно равен текущему (безопасный rollback по флагу).

### 6.3 (обязательно, Р2) `analyze.worker` per-agent модель
В `runSummary`/`runStructuredReport`/`runFollowUp` добавить в `input` поле `model: 'deepseek-v4-pro'` (для `tasks`/`custom` — НЕ задавать, остаётся flash). `DeepSeekService.complete` уважает `input.model` ([:57](../../backend/src/modules/ai/services/deepseek.service.ts#L57)). MiniMax свой `input.model` игнорирует → на rollback-пути (`primary=minimax`) безопасно, поведение не меняется.

---

## 7. Фазы и Acceptance (машинно-проверяемо)

### Фаза 1 — ENV-флаг + каскад DeepSeek-primary
Файлы: `env.schema.ts`, `TypedConfigService`, `llm-fallback.service.ts` (+ его `.spec.ts`).
**Что НЕ входит:** per-agent модель (Фаза 2), миграция на router.
**Acceptance:**
- `bun run typecheck` (вкл. `.spec`), `bun run lint`, `bun run build` — зелёные.
- греп: в `llm-fallback.service.ts` есть ветка `primary === 'deepseek'` с `this.deepseek.complete`; ветка `minimax` дословно повторяет старый каскад.
- Юнит-тест `llm-fallback.service.spec.ts`: (a) при флаге `deepseek` и успехе DeepSeek — вызван `deepseek.complete`, `minimax.complete` НЕ вызван; (b) при `deepseek` и throw DeepSeek — вызван `minimax.complete` (fallback); (c) при флаге `minimax` (default) — поведение 1:1 со старым (вызван `minimax.complete`, `deepseek` не вызван).
- грепа `process.env.` в новом коде — 0; флаг только через `TypedConfigService`.
Закрывает: R1, R3.

### Фаза 2 — pro для отчётных агентов (Р2, обязательно)
Файлы: `analyze.worker.ts` (+ `.spec`).
**Acceptance:** в `runSummary`/`runStructuredReport`/`runFollowUp` в `input` присутствует `model: 'deepseek-v4-pro'`; в `runTasks`/`runCustomPrompt` — НЕ задаётся (остаётся flash). Тест: при флаге `deepseek` вызовы `summary`/`report-by-type`/`follow-up` уходят с `model='deepseek-v4-pro'`, `tasks`/`custom` — без `model`.
Закрывает: R2.

### Фаза 3 — Прод-верификация (ручная, владелец, после выката + флипа флага)
**Acceptance (через diag, read-only):**
- Провести 1 встречу при `LLM_MAIN_REPORT_PRIMARY=deepseek`.
- `diag llm-calls --meeting <id>`: `summary/-`, `report-by-type/-`, `follow-up` → `deepseek:deepseek-v4-pro`; `tasks/-`, `custom` → `deepseek:deepseek-v4-flash`; НИ ОДНОГО `minimax`.
- `diag report --meeting <id>`: отчёт валиден (summary непустой, structuredData с задачами/решениями) — нет регрессии vs MiniMax-эталон.
- Флип флага обратно на `minimax` → следующая встреча снова на MiniMax (kill-switch работает).
Закрывает: R1, R2, R3 (приёмка на проде).

**Требования (EARS):**
- R1: Когда `LLM_MAIN_REPORT_PRIMARY=deepseek`, система shall слать вызовы главного отчёта (`summary/report-by-type/follow-up/tasks/custom`) в DeepSeek primary, с откатом на MiniMax→OpenAI при сбое.
- R2: Когда выбран pro-режим (Р2), система shall использовать `deepseek-v4-pro` для `summary` и `report-by-type`, и flash для остальных.
- R3: Если `LLM_MAIN_REPORT_PRIMARY=minimax` (default), система shall вести себя дословно как до правки (MiniMax primary).

---

## 8. Источники задач — почему их несколько и можно ли свести к одному (ответ владельцу)

**Сейчас задачи извлекаются ТРЕМЯ независимыми путями (факт по коду):**
| Источник | Откуда | Зачем существует | Куда показывается |
|---|---|---|---|
| `aiResult.structuredData.tasks` | `analyze.runStructuredReport` (агент `report-by-type`) | список задач **внутри отчёта** (для чтения) | «Обзор»/диалог отчёта |
| Таблица `Task` (fast + main) | `meeting-report-fast.worker` (`extractorVersion='fast'`) **И** `analyze.runTasks` (агент `tasks`, main) | редактируемые **сущности-задачи** | вкладка «Задачи» |
| `IntakeIssue` | `meeting-extract-actions.service` (трекер) → [meeting-extract-actions.service.ts:304](../../backend/src/modules/tracker/services/meeting-extract-actions.service.ts#L304) | кандидаты на **триаж в проект** | «Входящие» |

**Почему так вышло (человеческим языком):** три потребителя строились в разное время и под разные цели — отчёту нужен инлайн-список «о чём договорились», вкладке «Задачи» нужны редактируемые сущности, трекеру нужны заявки для разбора по проектам. Плюс «быстрый» отчёт (fast) и «полный» (main) **оба** пишут в `Task`, чтобы сначала показать что-то за секунды, потом уточнить. Итог — 3–4 пересекающихся извлечения, а дедуп слабый (`pickPrimaryTasks` сравнивает только `trim+lowercase` → «2000»/«2 000» и «Набрать команду»/«Набрать команду (…)» не схлопывает — отсюда дубли, что владелец и видел).

**Можно ли свести к одному — да, и нужно. Рекомендация (минимально-разумная):**
1. **Один канонический экстрактор задач → таблица `Task`.** Не давать `fast` И `main` оба писать `Task`-строки: `fast` — только для мгновенного предпросмотра (не персистить как `Task`), канон — один (main/structured).
2. **Отчёт и трекер ЧИТАЮТ из `Task`**, а не извлекают своё: `structuredData.tasks` и `IntakeIssue` деривят из той же канонической выборки.
3. **Усилить дедуп** перед сравнением: нормализовать числа (убрать пробелы-разделители), срезать скобочные уточнения; опц. семантический дедуп близких заголовков.

**Почему это лучший вариант:** убирает корень дублей и рассинхрона (один источник правды о задачах встречи), а не лечит симптом в каждой поверхности отдельно. Это **отдельная задача** (рефактор трекера/отчёта), НЕ входит в это ТЗ про модели — выносится в **ТЗ-4 «единый источник задач + дедуп»** (`relates_to` анализа §5/§11), чтобы не раздувать текущее минимальное ТЗ. Готов написать ТЗ-4 отдельно по твоему слову.

---

## 9. Совместимость с prompt caching
- DeepSeek кэширует входной префикс автоматически (флаг `cacheControl` для него no-op, для MiniMax — работает). Стабильный SYSTEM-промпт отчёта закэшируется между встречами (малая экономия); 3 ретрая структурного отчёта на одной встрече дадут кэш-хит на повторе.
- Большая экономия (транскрипт, общий для 4–5 агентов одной встречи) требует выноса транскрипта в общий ведущий префикс — **vNext (§5 «Не входит»)**, здесь не делаем.
- Цена: отчётные агенты на pro (~$0.012–0.016/вызов) дороже MiniMax per-call — осознанный выбор владельца ради качества; `tasks`/`custom` на flash ($0.0003) дешевле MiniMax. Замерить cachedTokens после выката (`AiUsageLog`), оценить эффект кэша pro.

## 10. Риски / pre-mortem
| Риск | Митигация |
|---|---|
| pro дороже MiniMax per-call | осознанный выбор (Р2, качество); `tasks`/`custom` на flash компенсируют; кэш DeepSeek снижает; замер cachedTokens в Фазе 3 |
| качество отчёта на DeepSeek-pro vs MiniMax | Фаза 3 — сравнить с MiniMax-эталоном на 1 встрече; pro обычно не хуже, при сомнении флип флага назад (Р3) |
| DeepSeek tool-calling менее надёжен на структурном отчёте | уже есть 3 ретрая + Zod ([analyze.worker.ts:694-730](../../backend/src/modules/ai/workers/analyze.worker.ts#L694-L730)); при провале — fallback на MiniMax (Р1) |
| DeepSeek недоступен/РФ-блок | вторичный канал MiniMax (Р1) ловит; kill-switch на `minimax` (Р3) |
| Регрессия rollback-пути | Фаза 1 acceptance (c) проверяет дословное совпадение ветки `minimax` со старым поведением |

## 11. Prod-deploy
- Новая ENV `LLM_MAIN_REPORT_PRIMARY` → `docs/operations/prod-deploy-log.md` **Шаг 1** (ENV; default `minimax` = безопасно, флип на `deepseek` вручную после теста). Kill-switch — этот же флаг.
- Схема БД / сиды / очереди — **не меняются** (миграций/seed-скриптов нет).

## 12. DoD
- typecheck (вкл. `.spec`) / lint / build зелёные; новые юнит-тесты `llm-fallback.service.spec.ts` зелёные.
- `second-brain/01_projects/llm-providers-verified.md` + `ai-jobs.md` — отметить, что главный отчёт переключаем на DeepSeek за флагом.
- `docs/operations/prod-deploy-log.md` Шаг 1 — новая ENV.
- Рефлексия в `second-brain/05_история/`.
- В коде: 0 `process.env.*`, 0 `prisma migrate`, 0 `new PrismaClient(`.

## Итог
_(заполнит tz-orchestrator после реализации: что сделано, результаты Фазы 3 на проде, выбранная модель flash/pro.)_
