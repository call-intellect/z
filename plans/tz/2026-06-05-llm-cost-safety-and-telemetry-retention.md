---
type: tz
status: ready-to-implement
feature: llm-cost-safety-and-telemetry-retention
date: 2026-06-05
owner: sergrv80
relates_to: [plans/analysis/2026-06-05-full-project-audit-technical.md, plans/tz/2026-06-05-llm-router-resilience-and-chain-normalization.md]
---
> Закрывает риски #4 и #5 топ-5 технического аудита (plans/analysis/2026-06-05-full-project-audit-technical.md §1). Ветка sergdev.

# ТЗ — Безопасность стоимости LLM + retention телеметрии

## Цель и зачем
**Болезненное состояние (из аудита):**
- **#4 (high):** бюджет LLM только наблюдается, не enforce-ится. `BudgetAlertCron` шлёт уведомление раз в 2ч ([budget-alert.cron.ts:45](../../backend/src/modules/admin/economics/budget-alert.cron.ts#L45)), но `LlmRouterService.call` НЕ проверяет бюджет перед вызовом → взбесившийся воркер/тенант выжигает месячный лимит за часы. Усугубляется молчаливым `costUsd=0` для моделей вне прайс-карты ([llm-router.service.ts:1708](../../backend/src/modules/ai/services/llm-router.service.ts#L1708) — лишь `logger.debug`, расход невидим).
- **#5 (high):** `AiUsageLog` (строка на каждый LLM-вызов + 2 TEXT-превью до 8 КБ каждое) растёт append-only без retention. `LogCleanupService` есть только для `SystemLog`.

**Чем решение лучше:** делает расход управляемым (enforce за флагом) и видимым (метрика unpriced), и ограничивает рост телеметрии, сохраняя историю стоимости для экономики.

## REALITY-CHECK (по факту кода 2026-06-05)
- **`OrgBudgetCap.capKind` ('soft'|'hard') УЖЕ есть в схеме** ([schema.prisma:2838](../../backend/prisma/schema.prisma#L2838)) — hard-cap полузаложен, но enforcement-путь к `LlmRouter` НЕ подключён. Это «дострой полуготового», **новая колонка НЕ нужна**.
- MTD-стоимость считается `OrgEconomicsCron.computeForOrg(tenantId, fxRate)` → `{ costRubMonthToDate }` ([budget-alert.cron.ts:80](../../backend/src/modules/admin/economics/budget-alert.cron.ts#L80)); FX через `CurrencyRateService.getCurrentUsdRubRate()`. Кап — в RUB, стоимость LLM — в USD → enforcement требует FX-конверсии.
- `computeCostUsd` ([llm-router.service.ts:1655](../../backend/src/modules/ai/services/llm-router.service.ts#L1655)) сначала смотрит БД `LlmModelPrice` (кэш TTL 60с), затем `MODEL_PRICES`; на отсутствие обоих — `logger.debug` + `calcCostUsd`→0.
- Образец retention — `LogCleanupService` ([log-cleanup.service.ts](../../backend/src/modules/logging/log-cleanup.service.ts)): `setInterval`+`unref`, `pg_try_advisory_lock` (single-flight на флот), батчи по 5000 в одной транзакции с таймаутом 120с. **Переиспользуем паттерн один-в-один.**
- Точка pre-dispatch gate в `call()` — после фильтра по dataClass (~[:1286](../../backend/src/modules/ai/services/llm-router.service.ts#L1286)), перед циклом по провайдерам (~:1305).
- **Конфликт-зон не задето:** схему не меняем, dataClassAudit/me-channels/db-migrations не трогаем.

## Принятые решения владельца (по правилам проекта + констрейнтам)
| # | Решение | Обоснование |
|---|---|---|
| R-D1 | Enforcement — **за master-флагом `llm.budget.enforce_enabled` (AdminSetting, дефолт OFF)**; реально блокирует только при `enforce_enabled=true` И `OrgBudgetCap.capKind='hard'` И MTD≥cap | `feedback_admin_settings_not_env_or_code` + «рискованное под флаг, дефолт OFF + kill-switch». Дефолт OFF = ноль изменений поведения до явного включения |
| R-D2 | Пороги/окна retention/TTL кэша — **AdminSetting с code-fallback**, не ENV/хардкод | то же правило крутилок |
| R-D3 | `costUsd=0` — **не «фиксить цены»** (правит админ), а сделать видимым: метрика `llm_cost_unpriced_total{model}` + WARN | цены — admin-editable; задача — наблюдаемость |
| R-D4 | Схему БД **не трогаем** (`capKind` уже есть; MTD-кэш — in-memory/Redis; флаги — AdminSetting) | зона параллельной сессии (dm-01 миграции) |

### Открытая развилка для владельца (НЕ блокирует v1 observe-only)
**Р-1. Поведение при включённом hard-cap (когда `enforce_enabled` станет true):** что делать на превышении?
- **(A, рекомендую) Блокировать вызов** — `LlmRouter.call` бросает `LlmBudgetExceededError`, воркер логирует и дропает job (или ретраит позже). Просто, предсказуемо, останавливает кровотечение.
- (B) Деградировать на самую дешёвую модель/tertiary вместо блокировки — мягче для UX, но сложнее и всё равно тратит деньги.
- (C) Только усилить алерты (ничего не блокировать) — фактически текущее поведение.
**Рекомендация: A.** v1 реализует путь A за флагом (дефолт OFF), но владелец подтверждает A/B/C **перед включением флага в проде**. До включения — observe-only (считаем, метрим, логируем «would block», НЕ блокируем).

## Доказательство выбора (2 прохода + challenge)

**Бюджет: как дёшево проверять MTD pre-dispatch.**
| Критерий | A: кэш MTD (computeForOrg+FX, TTL из AdminSetting ~60с) | B: Redis-инкремент счётчика per org/месяц |
|---|---|---|
| Сложность | низкая (переиспользует economics) | средняя (init/reconcile + FX на запись) |
| Точность | staleness ≤TTL | точная O(1) |
| Стоимость на вызов | 1 computeForOrg / TTL / org (cache-miss) | O(1) Redis GET |
| Уместность | алерт и так 2ч-гранулярный; для месячного бюджета ≤60с staleness ничтожен | избыточно для текущей нагрузки |
**Выбор — A** (Б1). Триггер пересмотра на B: если cache-miss `computeForOrg` станет горячим (напр. >50 активных орг с высоким QPS LLM) — мигрировать на Redis-инкремент. *Challenge: решает корень (нет gate) минимальными средствами; не преждевременная оптимизация.*

**Retention: что удалять.**
| Критерий | A: DELETE строк < cutoff | B: two-tier (NULL превью после N1, DELETE строки после N2) |
|---|---|---|
| Экономия места | да, но теряет историю стоимости | да (превью — основной объём, 2×8КБ/строка) |
| Сохранение экономики | нет (MTD/дашборды теряют старое) | да (тонкая cost-строка живёт до N2) |
**Выбор — B** (Б2): превью (bulk) гасим рано (N1), тонкую cost-строку держим до N2. *Challenge: эффективнее A — убирает 95% объёма, не ломая экономику.*

## Scope
**Входит:** метрика unpriced (#4a); MTD-кэш + pre-dispatch budget-evaluate с observe/enforce за флагом (#4b); two-tier retention `AiUsageLog` (#5). Всё — без изменения `schema.prisma`.
**Не входит (vNext):** деградация-на-дешёвую-модель (Р-1 вариант B) — отдельным ТЗ если владелец выберет B; миграция MTD на Redis-инкремент (триггер выше); партиционирование телеметрии (dm-03 — отдельно); enforcement других провайдеров вне LlmRouter (ASR/embeddings) — отдельно.

## Фазы (dependency-ordered)

### Фаза 1 — Метрика «цена не заполнена» (#4a) `[ ]`
**Цель:** сделать `costUsd=0`-из-за-отсутствия-цены видимым.
**Файлы:** [llm-router.service.ts:1655-1714](../../backend/src/modules/ai/services/llm-router.service.ts#L1655) (`computeCostUsd`); [business-metrics.service.ts](../../backend/src/common/metrics/business-metrics.service.ts) (счётчик).
**Что входит:** в `computeCostUsd`, в ветке «нет ни в БД, ни в `MODEL_PRICES`» (стр. 1708, `!(model in MODEL_PRICES)`): заменить `logger.debug` на `logger.warn` + `this.metrics?.incLlmCostUnpriced({ provider, model })`. Добавить счётчик `llm_cost_unpriced_total{provider, model}` зеркально `incCoreLlmNoProvider` ([business-metrics.service.ts:3604](../../backend/src/common/metrics/business-metrics.service.ts#L3604)).
**Что НЕ входит:** не менять `MODEL_PRICES`, не блокировать вызов.
**Acceptance:** греп `incLlmCostUnpriced` в computeCostUsd и `kc... ` нет — есть `llm_cost_unpriced_total` в metrics; unit: `computeCostUsd('x','unknown-model',...)` (мок prisma=null) → метрика инкрементнута, WARN; известная модель → НЕ инкрементнута. `bunx vitest run` зелёный.
**Закрывает:** R-D3.

### Фаза 2 — MTD-кэш + budget-evaluate pre-dispatch (#4b) `[ ]`
**Цель:** перед dispatch оценивать бюджет; в observe-режиме — мерить/логировать, в enforce — блокировать (за флагом, дефолт OFF).
**Файлы:** новый `backend/src/modules/ai/services/budget-guard.service.ts`; [llm-router.service.ts](../../backend/src/modules/ai/services/llm-router.service.ts) (вызов pre-dispatch ~стр.1290, после dataClass-фильтра, перед циклом); `business-metrics.service.ts`; AdminSetting-ключи.
**Что входит:**
1. `BudgetGuardService.evaluate(tenantId): Promise<{ over: boolean; mtdRub: number; capRub: number|null; capKind: string }>` — читает `OrgBudgetCap` (по tenantId) + кэш MTD (in-memory Map<tenantId,{rub,fetchedAt}>, TTL из AdminSetting `llm.budget.mtd_cache_ttl_sec`, code-fallback 60). На cache-miss — `OrgEconomicsCron.computeForOrg` + FX. `over = capRub!=null && capKind==='hard' && mtdRub >= capRub`. `tenantId=null` → `{over:false}` (system-jobs не лимитируем).
2. В `LlmRouter.call` после dataClass-фильтра: `const ev = await this.budgetGuard?.evaluate(params.tenantId)`. Если `ev?.over`:
   - метрика `llm_budget_exceeded_total{mode}` (mode=`observe`|`enforce`);
   - если AdminSetting `llm.budget.enforce_enabled` (code-fallback false) === true → `throw new LlmBudgetExceededError(tenantId, mtdRub, capRub)` (новый класс ошибки рядом с `LlmRouterAllProvidersFailedError`);
   - иначе (observe) → `logger.warn('budget would block', {...})`, продолжить dispatch.
   `BudgetGuardService` инжектить `@Optional()` в LlmRouter (тесты без него не падают), как `metrics`.
3. AdminSetting-ключи (через существующий механизм `getDynamic`/`AdminSettingsService`, code-fallback): `llm.budget.enforce_enabled`(bool,false), `llm.budget.mtd_cache_ttl_sec`(int,60).
**Что НЕ входит:** деградация на дешёвую модель (Р-1 B); Redis-инкремент; UI крутилок (AdminSetting инфраструктура уже есть — только регистрация ключей при необходимости).
**Acceptance:** unit `BudgetGuardService`: cap=null → over=false; capKind='soft' над лимитом → over=false; capKind='hard' mtd≥cap → over=true; кэш — второй вызов в пределах TTL НЕ зовёт computeForOrg (мок вызван 1 раз). unit LlmRouter: ev.over + enforce_enabled=false → НЕ бросает, метрика mode=observe, dispatch продолжен; ev.over + enforce_enabled=true → бросает `LlmBudgetExceededError`, dispatch НЕ начат. `tenantId=null` → evaluate не зовётся/over=false. typecheck+build зелёные (DI).
**Закрывает:** R-D1, R-D2, Р-1(путь A за флагом).

### Фаза 3 — Two-tier retention AiUsageLog (#5) `[ ]`
**Цель:** ограничить рост `AiUsageLog`, сохранив историю стоимости.
**Файлы:** новый `backend/src/modules/ai/services/ai-usage-log-cleanup.service.ts` (образец — [log-cleanup.service.ts](../../backend/src/modules/logging/log-cleanup.service.ts)); регистрация в `ai.module.ts`; новый advisory-lock-ключ (рядом с `LOG_CLEANUP_LOCK_KEY`); AdminSetting-окна.
**Что входит:** сервис `OnModuleInit` с `setInterval(unref)` раз в час; в одной транзакции `pg_try_advisory_lock(<новый ключ>)`:
1. **Tier-1 (гашение превью):** для строк `createdAt < now - N1` и (`requestPreview IS NOT NULL` OR `responsePreview IS NOT NULL`) — батчами по 5000 `UPDATE` ставит превью в NULL (если поля nullable; **верифицировать в schema** — если NOT NULL, ставить `''`).
2. **Tier-2 (удаление):** для строк `createdAt < now - N2` — батчами по 5000 `deleteMany` (как SystemLog).
Окна из AdminSetting: `llm.usage_log.scrub_previews_after_days`(int, code-fallback 30), `llm.usage_log.delete_after_days`(int, code-fallback 365). N2 должен быть > самого длинного окна экономики (computeForOrg — текущий месяц, так что 365 безопасно).
**Что НЕ входит:** партиционирование (dm-03 vNext); ретеншен `SystemLog` (уже есть).
**Acceptance:** **идемпотентность — повторный прогон = 0 изменений** (acceptance-критерий): второй `runCleanup()` подряд → `{scrubbed:0, deleted:0}`. unit (мок prisma/время через аргумент): строки старше N1 но младше N2 → превью обнулены, строка жива; старше N2 → удалена; свежие → не тронуты. advisory-lock single-flight: при занятом локе → `{skipped:true}`. typecheck+build зелёные.
**Закрывает:** #5.

## Совместимость с prompt caching
Не релевантно — LLM-промптов фича не содержит.

## Риски / ревью-аспекты (для strict-production-review-gate)
- **Бюджет-gate в горячем пути LlmRouter** — `evaluate` обязан быть дёшев (кэш) и `@Optional`/best-effort: ошибка в budget-guard НЕ должна ронять LLM-вызов (try/catch → fail-open в observe; в enforce — решить: fail-open безопаснее для UX, fail-closed безопаснее для денег → **fail-open + WARN**, т.к. ложная блокировка хуже редкого пропуска).
- **FX-конверсия:** `getCurrentUsdRubRate` может быть недоступен → fail-open (не блокировать).
- **Retention nullable-превью:** проверить реальную nullability полей в `schema.prisma` до Tier-1.
- **Idempotency:** retention повторно = no-op; budget evaluate без побочных эффектов.
- **Observability:** новые метрики `llm_cost_unpriced_total`, `llm_budget_exceeded_total{mode}`.

## Idempotency / feature-flag / prod-deploy
- **Флаги/окна — AdminSetting** (не ENV). Если ключи регистрируются сидом — добавить в `seed-admin-settings*.ts` и `apply-prod-deploy.ts STEPS` (идемпотентно). Если `getDynamic` поднимает дефолты лениво — сид не нужен (проверить механизм AdminSettingsService).
- **prod-deploy-log.md:** Шаг 12 (smoke новых метрик `llm_cost_unpriced_total`/`llm_budget_exceeded_total` в `/metrics`); если добавлен seed-admin-setting — Шаг 7/«admin-settings».
- Дефолт OFF → выкат без изменения поведения; включение enforcement — отдельным решением владельца (Р-1).

## DoD
typecheck (вкл `.spec`)/lint(0 err)/build зелёные; vitest по затронутым; second-brain (`01_projects/llm-providers-verified.md` или профильная economics-заметка + `workers-queues` для нового retention-сервиса); prod-deploy-log при новых метриках/AdminSetting; рефлексия.

## Итог
**Реализовано ЦЕЛИКОМ (2026-06-05, ветка sergdev).** Ф1 метрика `llm_cost_unpriced_total` + WARN · Ф2 `BudgetGuardService` + pre-dispatch gate (observe/enforce за флагом `llm.budget.enforce_enabled` дефолт-OFF, fail-open) · Ф3 two-tier retention `AiUsageLog` (scrub превью 30д / delete 365д). Схему БД не трогали (`capKind` уже был; превью уже nullable). typecheck/lint(0)/build/тесты зелёные на каждой фазе.
**Осталось:** деплой кода; опц. настройка AdminSetting-ключей (`llm.budget.*`, `llm.usage_log.*`) — есть code-fallback, выкат без них безопасен. **Р-1 (поведение enforcement A/B/C) — подтвердить владельцу ПЕРЕД включением `enforce_enabled` в проде.** Push по подтверждению.
