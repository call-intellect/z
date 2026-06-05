---
date: 2026-06-05
type: история-сессии
distilled: false
---

# Безопасность стоимости LLM + retention телеметрии

## Что было поставлено

Закрыть риски #4 и #5 из топ-5 технического аудита
(`plans/analysis/2026-06-05-full-project-audit-technical.md`):

- **#4 (high):** бюджет LLM только наблюдается, не enforce-ится. `BudgetAlertCron`
  шлёт уведомление раз в 2ч, но `LlmRouter.call` НЕ проверяет бюджет перед вызовом
  → взбесившийся воркер/тенант выжигает месячный лимит за часы. Усугубляется
  молчаливым `costUsd=0` для моделей вне прайс-карты (`computeCostUsd` писал лишь
  `logger.debug` — расход невидим).
- **#5 (high):** `AiUsageLog` (строка на каждый LLM-вызов + 2 TEXT-превью до 8 КБ)
  растёт append-only без retention. `LogCleanupService` был только для `SystemLog`.

Контракт — `plans/tz/2026-06-05-llm-cost-safety-and-telemetry-retention.md`
(поверх ТЗ надёжности LLM-роутера, та же ветка `sergdev`).

## Как решал

Три фазы, три коммита; оркестрация суб-агентами с независимой приёмкой
(греп ключевых маркеров + re-Read после Edit + свой typecheck/lint/build/тесты
по каждой фазе — суб-агент мог отметить `[x]` без реального Edit).

- **Ф1 — метрика unpriced.** В `computeCostUsd` ветка «нет цены ни в БД, ни в
  `MODEL_PRICES`»: `logger.debug` → `logger.warn` + новый счётчик
  `llm_cost_unpriced_total{provider,model}` (зеркало `incCoreLlmNoProvider`).
  Файлы: `llm-router.service.ts`, `business-metrics.service.ts`.
- **Ф2 — budget guard.** Новый `BudgetGuardService` (`ai/services`), вызов из
  `LlmRouter.call` pre-dispatch (после dataClass-фильтра). MTD-расход = сумма
  `AiUsageLog.costRub` за UTC-месяц, in-memory-кэш TTL
  `llm.budget.mtd_cache_ttl_sec` (60). Блокирует (`LlmBudgetExceededError`) только
  при `llm.budget.enforce_enabled`=true И `OrgBudgetCap.capKind='hard'` И MTD≥cap;
  иначе observe (метрика `llm_budget_exceeded_total{mode}` + WARN). `@Optional()`
  в DI, best-effort fail-open.
- **Ф3 — two-tier retention.** Новый `AiUsageLogCleanupService` (self-scheduling
  раз в час по образцу `LogCleanupService`): Tier-1 гасит превью → NULL старше
  `llm.usage_log.scrub_previews_after_days` (30); Tier-2 удаляет строки старше
  `llm.usage_log.delete_after_days` (365). Advisory-lock single-flight, батчи 5000.

**REALITY-CHECK дал бонус:** `OrgBudgetCap.capKind ('soft'|'hard')` уже был в
схеме — hard-cap полузаложен, но enforcement-путь к `LlmRouter` не подключён.
Это «дострой полуготового», новая колонка НЕ нужна — схему БД не трогали вовсе.

**Упрощение:** `BudgetGuard` сам суммирует `AiUsageLog.costRub` вместо
cross-module вызова `OrgEconomicsCron.computeForOrg` — ноль coupling, и та же
колонка-источник, что у алерта (согласованность gate и алерта).

Все AdminSetting-ключи — через `getDynamic` с code-fallback → выкат БЕЗ сидов
безопасен (дефолты применяются лениво).

## Что вышло

- typecheck (вкл `.spec`) / lint (0 err) / build / vitest по затронутым — зелёные
  на каждой фазе.
- Новые метрики `llm_cost_unpriced_total{provider,model}`,
  `llm_budget_exceeded_total{mode}`.
- **Observe-only по умолчанию (`enforce_enabled`=false) = ноль изменений
  поведения** прода: бюджет считается, метрится, логируется «would block», но не
  блокирует. Включение enforcement — отдельное решение владельца (Р-1).
- Схему БД не меняли; прод-операций по схеме/сидам нет — достаточно
  `docker compose up -d --build backend` (+ worker-процесс).

## Чему научился

1. **Хард-кап был полузаложен (`capKind`), но не подключён к роутеру.** Находка
   аудита «бюджет не enforce-ится» = фича на 50%: данные в схеме есть, логики
   gate нет. REALITY-CHECK по факту кода до ТЗ экономит колонку и время.
2. **Для согласованности gate и алерта — одна колонка-источник** (`costRub`).
   Если бы guard считал по другому пути (computeForOrg+FX), блокировка и алерт
   могли бы расходиться в цифрах. Один источник = предсказуемость.
3. **Поведение enforcement (block/degrade/alert) — продуктовая развилка, не
   техническая.** Строим путь A (block) за флагом-OFF, решение владельца перед
   включением. Не закрывать развилку молча «как удобнее кодеру».
4. **Hot-path gate обязан быть fail-open.** Ошибка в budget-guard (или
   недоступность FX) НЕ должна ронять LLM-вызов — ложная блокировка хуже редкого
   пропуска. try/catch → fail-open + WARN, в т.ч. в enforce-режиме.
