---
type: tz
status: implemented
feature: company-summary-incremental-fix
date: 2026-07-07
owner: sergrv80@gmail.com
relates_to:
  - backend/src/modules/company-foundation/workers/company-summary-compiler.cron.ts
  - backend/src/modules/company-foundation/prompts/company-summary-compile.prompt.ts
  - backend/src/modules/company-foundation/services/company-profile.service.ts
  - second-brain/01_projects (company-foundation)
---

# ТЗ: Описание компании — короткий паспорт + инкрементальное обновление (починка агента)

> Чиним `CompanySummaryCompilerCron` — авто-описание «чем занимается компания». Сейчас он каждый цикл **пишет с нуля** длинный текст (3–5 абзацев) из **50 последних блоков одной встречи**, полностью **затирая** прошлое описание. Делаем: короткий паспорт (4–6 предложений), **инкрементальное обновление** (в промпт подаётся текущее описание + только новые факты → «обнови/дополни, не раздувай»), пересчёт **раз в неделю**.

## Контекст и доказанный диагноз (прод, read-only, 2026-07-07)

Проверено на рабочей орге «Ооо луа» (`cmpndk2tw000101mwmixvacuj`, svmazur@mail.ru): 32 встречи с 27.05, но `CompanyProfile.summaryJson` собран из **50 блоков, все созданы 06.07** (одна вчерашняя встреча). 31 предыдущая встреча в описание не попала. По типам входных блоков: 13 `idea`, 8 `reasoning`, 8 `fact`, 5 `process_step`, 4 `suggestion` — то есть мозговой штурм «как строить продукт», а не устоявшиеся факты о компании. Итог: описание = многословный пересказ последней встречи, а не стабильный портрет.

Три корневые причины (проверено чтением кода):

| # | Где | Что не так |
|---|---|---|
| A | [company-summary-compiler.cron.ts:97-102](../../backend/src/modules/company-foundation/workers/company-summary-compiler.cron.ts#L97) | Вход = `ideaBlock.findMany({ orderBy: [dynamicScore desc, createdAt desc], take: 50 })`. `dynamicScore` у блоков не проставлен (null) → Postgres при DESC ставит NULL первыми → сортировка вырождается в чистую свежесть → всегда «последняя встреча». Прошлое описание в выборке не участвует. |
| B | [company-profile.service.ts:110-142](../../backend/src/modules/company-foundation/services/company-profile.service.ts#L110) (`applyAutoSummary`) | `summaryJson` перезаписывается целиком новым текстом. Предыдущее описание в LLM **не подаётся** → нет накопления, каждый прогон пишет с нуля. |
| C | [company-summary-compile.prompt.ts](../../backend/src/modules/company-foundation/prompts/company-summary-compile.prompt.ts) | Промпт просит «3–5 абзацев», схема `contentMd` `maxLength: 4000`. Раздувание заложено в контракт. Нет секции «текущее описание». Нет фильтра высоты (штурм ≠ идентичность компании). |

Периодичность: cron `45 * * * *` ежечасно, но конкретная орг пересобирается только если summary старше `companyProfile.summaryRebuildHours` (сейчас дефолт **24ч**). Хотим — раз в неделю.

## Цель и не-цель

**Цель:** описание компании — короткий стабильный паспорт (4–6 предложений), который **дополняется/уточняется** новыми фактами раз в неделю, а не переписывается с нуля и не раздувается; на вход LLM всегда идёт текущее описание + только новые значимые факты.

**Не-цель:** не трогаем ручную правку (`summaryPinned` по-прежнему замораживает авто-обновление); не трогаем probe-заполнение mission/vision/strategy (отдельный механизм); не вводим новую таблицу — работаем в существующем `CompanyProfile.summaryJson`; не чиним сам `dynamicScore` (обходим его сменой стратегии выборки — см. ниже).

## Целевое поведение (согласовано с владельцем)

1. **Формат — паспорт, 4–6 предложений.** Шаблон содержания: чем занимается · продукт/услуги · клиенты/рынок · позиционирование · стадия · (опционально) маркетинг/каналы. Жёсткий лимит `contentMd` — 1000 символов.
2. **Инкремент, а не перезапись.** Если описание уже есть — подаём его в промпт первым блоком: «вот текущее описание, посмотри, есть ли что обновить или добавить». LLM возвращает обновлённый цельный паспорт (прежнее + дельта), сохраняя суть и НЕ раздувая. Если нового по сути нет — возвращает прежний текст без изменений.
3. **Периодичность — раз в неделю.** `summaryRebuildHours` дефолт `24 → 168`. Cron-скан остаётся ежечасным (дёшево, гейт по свежести).
4. **Правильная высота входа.** На вход идут только «долговечные» факты о компании, а не одноразовый штурм: фильтр по `signalType ∈ {fact, decision, process_step, regulation, metric, commitment, lesson, result}`; исключаются `idea, suggestion, reasoning, mood, question, drift` и т.п. При первом построении (описания ещё нет) — те же типы, новейшие сверху.
5. **«Нет изменений» дёшево.** LLM возвращает флаг `changed`. `changed=false` → contentMd не трогаем, только сдвигаем `generatedAt` на now (чтобы следующий пересчёт был через неделю), инкремент метрики `skipped_no_change`.

## Реализационный контракт

### Фаза 1 — Промпт [company-summary-compile.prompt.ts]

Переписать `COMPANY_SUMMARY_COMPILE_SYSTEM_PROMPT`:
- Роль: «аналитик Коры, ведёшь краткий паспорт компании».
- Формат: **4–6 предложений**, один абзац, без списков. Шаблон содержания (перечислить: чем занимается, продукт/услуги, клиенты/рынок, позиционирование, стадия, опц. маркетинг/каналы) — включать пункт только если по нему есть факт.
- Инкремент: «Если дано ТЕКУЩЕЕ описание — прими его за основу, внеси только реально новые/изменившиеся факты, сохрани суть и стиль, НЕ раздувай, НЕ переписывай ради переписывания. Если нового по существу нет — верни текущее описание дословно и `changed=false`.»
- Анти-штурм: «Описывай, чем компания ЕСТЬ (устойчивые факты), а не что обсуждали на последней встрече. Идеи, гипотезы, предложения и рассуждения в паспорт не тащи.»
- Чистый русский, без латиницы/идентификаторов. Строго JSON.

Переписать `COMPANY_SUMMARY_COMPILE_USER_TEMPLATE(args: { currentSummary?: string | null; facts: readonly string[] })`:
```
Текущее описание компании (может быть пустым):
<currentSummary или «(пока нет)»>

Новые факты из графа знаний (учитывай только значимое для паспорта):
1. ...
2. ...

Верни JSON по схеме company_summary_compile_v1.
```

`COMPANY_SUMMARY_COMPILE_JSON_SCHEMA`:
- `contentMd`: `maxLength: 4000 → 1000`, описание «4–6 предложений, один абзац».
- добавить `changed: { type: 'boolean' }`, в `required`.

Обновить snapshot-тесты промпта, если есть.

### Фаза 2 — Компилятор [company-summary-compiler.cron.ts]

`compileForOrg`:
1. Достать `profile.summaryJson.contentMd` (текущее описание) + `generatedAt` как сейчас.
2. Выборку блentов заменить: `where: { tenantId, status: canonical, signalType: { in: DURABLE_SIGNAL_TYPES } }`, `orderBy: [{ createdAt: 'desc' }]`, `take: 40`. (Убрать зависимость от `dynamicScore` — обход бага A. Константу `DURABLE_SIGNAL_TYPES` объявить в файле компилятора.)
3. Cold-start (`blocks.length < summaryMinSourceBlocks`) — как сейчас, `skipped_cold_start`.
4. `facts` = как сейчас (`name: trustedAnswer`, обрезка 300).
5. В `llm.call` передать `COMPANY_SUMMARY_COMPILE_USER_TEMPLATE({ currentSummary, facts })`.
6. Разобрать `{ contentMd, changed }`:
   - `changed === false` → `companyProfile.touchSummaryGeneratedAt(tenantId)` (Фаза 3), метрика `incCompanySummaryCompile({ result: 'skipped_no_change' })`, вернуть `skipped_no_change`.
   - иначе → `applyAutoSummary` как сейчас (contentMd уже цельный паспорт прежнее+дельта), метрика `compiled`.
7. Периодичность обеспечивается гейтом `summaryRebuildHours` (Фаза 4) — код цикла не меняется.

### Фаза 3 — Сервис [company-profile.service.ts]

Добавить метод `touchSummaryGeneratedAt(tenantId: string): Promise<void>` — обновляет только `summaryJson.generatedAt` на `new Date().toISOString()`, сохраняя `contentMd`/`sourceBlockIds` (читает текущий summaryJson, перекладывает generatedAt, пишет обратно; если summaryJson пуст — no-op). `applyAutoSummary` не меняем.

### Фаза 4 — Настройка периодичности (крутилка)

- [typed-config.service.ts:1335-1339](../../backend/src/common/config/typed-config.service.ts#L1335) — code-fallback `summaryRebuildHours` `24 → 168`.
- [seed-admin-settings.ts:1804](../../backend/scripts/seed-admin-settings.ts#L1804) — `envInt('COMPANY_PROFILE_SUMMARY_REBUILD_HOURS', 24 → 168)`.
- Реестр [admin-setting-schema-registry.ts:164](../../backend/src/modules/admin/settings/admin-setting-schema-registry.ts#L164) — тип не меняется (`POSITIVE_INT`), только дефолт в сиде/коде.
- **Прод:** существующая строка настройки уже = 24 (засижена ранее) — смена дефолта в сиде её НЕ перепишет. Нужен разовый патч. Добавить `backend/scripts/patch-company-summary-weekly.ts`: если `AdminSetting['companyProfile.summaryRebuildHours']` всё ещё `24` → выставить `168` (не трогать, если владелец уже поменял вручную). Зарегистрировать в `apply-prod-deploy.ts` `STEPS` (phase update, `skipBootstrap: true`). Использовать `createPrismaClient()` из `scripts/_lib/prisma.ts`.

### Фаза 5 — Метрики

`company_summary_compile_total` — добавить в допустимые `result`-лейблы `skipped_no_change` (метрика уже принимает `result: string`, менять `business-metrics.service.ts` не требуется; проверить, что граф/алерты не завязаны на закрытый список).

## Критерии приёмки

1. `bun run typecheck && bun run lint && bun run build` — зелёные.
2. Unit: `company-summary-compiler.cron.spec.ts` дополнен —
   - при наличии `currentSummary` в `llm.call` уходит user-сообщение с блоком «Текущее описание компании»;
   - `changed=false` → `applyAutoSummary` НЕ вызван, `touchSummaryGeneratedAt` вызван, результат `skipped_no_change`;
   - выборка блоков не содержит `idea/suggestion/reasoning` (фильтр `DURABLE_SIGNAL_TYPES`);
   - cold-start и `summaryPinned` — прежнее поведение сохранено.
3. Snapshot промпта обновлён и отражает 4–6 предложений + секцию текущего описания + `changed`.
4. Ручная проверка на «Ооо луа» (после выката, форс cron): новый `summaryJson.contentMd` — 4–6 предложений ≤1000 символов, читается как паспорт (чем занимается/продукт/клиент/стадия), без пересказа штурма; повторный форс без новых встреч → `skipped_no_change`, текст не меняется, `generatedAt` сдвинулся.

## Прод-операции (для prod-deploy-log)

- Новый `backend/scripts/patch-company-summary-weekly.ts` → **Шаг 6** (patch) + запись в `apply-prod-deploy.ts STEPS`.
- Смена дефолта настройки `companyProfile.summaryRebuildHours` → **Шаг 1** (упоминание) + патч выше.
- Переписанный LLM-промпт `company-summary-compile` → сверить с `docs/methodology/prompts/` (чек-лист методологии).
- Прочее (промпт/крон/сервис) — код внутри backend, отдельных prod-действий не требует (выкат образа).

## Открытые развилки (решение владельца — по желанию)

- **Одна секция или две?** Обсуждали «Чем занимается (стабильно)» + «Сейчас в фокусе (обновляется чаще)». Данное ТЗ реализует **одну** секцию-паспорт (проще, честнее к «короткому описанию»). Если нужна вторая секция «в фокусе» — это +1 поле в схеме и +1 блок промпта, добавляется поверх без переделки.

## Итог реализации (2026-07-07, ветка work/2026-07-07)

Реализовано **целиком** (Ф1–Ф5). Коммиты `d75d3907` (промпт/компилятор/сервис/метрика + тесты) и `490e64a3` (периодичность 24→168 + `patch-company-summary-weekly.ts` + STEPS).

- **Расхождение ТЗ↔код, исправлено:** `DURABLE_SIGNAL_TYPES` — в enum `SignalType` (schema.prisma) нет голого `metric`; заменён на фактический член `metric_change`. Остальные 7 значений — дословно из ТЗ.
- **Защитная доработка:** ветка `skipped_no_change` срабатывает только при `changed===false && есть текущее описание` — при первом (cold) построении, когда описания ещё нет, LLM-паспорт применяется даже при `changed=false` (защита от «застрявшего пустого summary»).
- **Версия схемы:** имя `company_summary_compile_v1` сохранено по контракту ТЗ (методология рекомендует бамп при смене USER-контракта, но схема strict и передаётся inline на каждый вызов — stale-cache-риска нет).
- Верификация: typecheck/lint/build зелёные; `company-summary-compiler.cron.spec.ts` — 8 кейсов (инкремент/`changed=false`/durable-фильтр/cold-start/pinned/fresh/kill-switch); патч прогнан дважды на dev-БД (24→168 / `[skip]`).
- Открытый остаток: `dynamicScore=null` обойдён, не починен — строка в `second-brain/04_не-сделано/README.md`.
