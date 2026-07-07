---
type: reflection
date: 2026-07-05
feature: clone-regulations-tool-rework
branch: work/2026-07-02
distilled: false
---

# Рефлексия — бейк-офф подбора регламентов клоном: чем кормить flash-роутер

## Что было поставлено

Изолированная задача (ТЗ `plans/tz/2026-07-05-clone-regulations-tool-rework.md`): построить мини-стенд и
ЭКСПЕРИМЕНТОМ доказать числом, как AI-клон должен подбирать правила своей роли. Ядро — бейк-офф трёх уровней
контекста для дешёвого flash-LLM-роутера: (A) только имена, (B) саммари, (C) полный текст — плюс ≥1 не-LLM база,
с замером ТОЧНОСТИ и ЦЕНЫ (токены/латентность/$). Плюс убрать источник выдумки имён у клона (`regulationsIndex`).

## Как решал (файлы)

- Изолированный стенд `backend/scripts/clone-regulations-stand/` (не трогал основной `clone-stand/`):
  `_shared.ts` (prod-guard по хосту DATABASE_URL, `withApp` через `NestFactory.createApplicationContext(AppModule)`,
  cost-калькулятор), `explore.ts` (read-only разбор владения), `summarize.ts` (предвычисление саммари + кэш),
  `bakeoff.ts` (5 стратегий), `gold.ts` (15 вопросов), `stand.ts` (одна команда `all`).
- **Владение на «Стреле»** (`explore.ts` → `artifacts/ownership.json`): роли резолвятся (role+person OK), но данные
  грязные — regulations 41/53 scope пустой, policies 9/9 пустой, processes 126/126 пустой; instructions
  владеются через `forRole` (16/16) + scope. Ретрив в проде фильтрует ТОЛЬКО `scope=role:<cuid>` → игнорит
  `forRole`/`ownerPersonId`. Сделал **read-time резолвер владения** (ownerRoleId|scope-cuid|scope-name|forRole|
  ownerPersonId) → owned-наборы **малые: CEO 5, Интегратор 5, Маркетолог 9, Поддержка 7**; бесхозных **169**
  (procs 118, regs 42, pols 8). Гипотеза владельца «правил у роли немного» — подтверждена.
- **LLM через `LlmRouterService.call`**: `clone-respond`-route = `deepseek/deepseek-v4-flash` (роутер),
  override `model` для саммари. `call()` возвращает `inputTokens/outputTokens/modelUsed/durationMs` — прямой захват
  usage; $ считаю через `calcCostUsd`/`MODEL_PRICES`.
- **Пункт 6:** удалил блок `<regulations_index>` (полный список имён правил без текста) из
  `clone-respond.prompt.ts` + call-site `clones.service.ts` + мёртвый `toRegulationsIndex` + тип + переписал spec.
- Крутилки в `admin-setting-schema-registry.ts`: `clone.regulations.summary.refresh_cron`,
  `.router.bm25_min`, `.router.semantic_threshold`, `.router.context_level`.

## Что вышло (числом)

Два режима — и это ключ:

| режим | A/имена | B/саммари | C/полный текст | kw_bm25 | semantic |
|---|---|---|---|---|---|
| owned-only (пул 5–9) | **100% · $0.000138** | 100% · $0.000174 | 100% · $0.000182 | 92.9% (2 fi) | 64.3% |
| scale ~30 (maxTok 2500) | 92.9% (1 fab) | **100% · 0 fab** | 78.6% (5 fab) | 64.3% (2 fi) | 64.3% |

- **Малый чистый пул → побеждает A/только-имена** (100%, дешевле всех). Лишний контекст = деньги на ветер.
- **Большой шумный пул → побеждает B/саммари** (100%, fabrication=0). A деградирует, **C/полный текст ХУДШИЙ среди
  LLM** (78.6%, 5 фабрикаций) — «сваливать всё скопом» реально вредит (шум + выдумка id) и дороже всех.
- **LLM оправдан:** не-LLM базы упираются в 64–93% + false-invoke на absent; только flash-роутер даёт 100%/0-fab/
  0-false-invoke. Все стратегии держат false-invoke=0 на rule_absent (кроме keyword).

## Чему научился

- **Грабля-1 (дорогая, ~30 мин):** `deepseek-v4-flash` НЕ помечен thinking (`isThinkingModel` ловит только `pro`),
  но всё равно генерит reasoning_content, не попадающий в `message.content`. При низком `maxTokens` (220/900) reasoning
  съедает бюджет → **пустой текст/пустой JSON** ровно на cap. Это и есть «пустой ответ LLM» из findings клон-стенда.
  Лечение: щедрый `maxTokens` (саммари 700, роутер 2500) ИЛИ короткий контекст. На 900-cap B/C на scale ложно рухнули
  до 28/43% — чистая обрезка, не качество; на 2500 восстановились до 100/79%. **Урок: у reasoning-моделей длина
  контекста роутера умножается на reasoning-бюджет — короткий контекст (имена/саммари) не только дешевле, но и
  устойчивее к обрезке.**
- **Вывод для продукта:** правильный рычаг — не «дать роутеру больше», а **держать owned-пул малым и чистым**
  (нормализация scope + дедуп) → хватает имён; при неизбежном росте — саммари, НЕ полный текст. Полный текст —
  антипаттерн (шум+фабрикация+цена+обрезка).
- **Данные «Стрелы» грязные и дублированные** (near-дубли SLA-эскалаций, юнит-экономики, стейдж-перед-прод) — это
  делает бейк-офф честным, но требует дедупа перед проводкой в прод.
- typecheck/lint зелёные; стенд гоняется одной командой; артефакты в `artifacts/`. Проводка победителя в реальный
  путь клона (`retrieveRoleRegulations`) — оставлена как вторичное (реестр не-сделанного, строка L5b).
