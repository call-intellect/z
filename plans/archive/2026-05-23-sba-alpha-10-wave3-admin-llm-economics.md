---
type: tz
status: ready-for-code
feature: α-10 wave 3 — 5 cron'ов + LlmProtocolAdapterRegistry + REST + 5 admin UI страниц
phase: alpha-10
date: 2026-05-23
parent: plans/tz/2026-05-22-final-roadmap.md
predecessor: plans/tz/2026-05-23-roadmap-data-models-batch.md
related:
  - plans/analysis/2026-05-22-code-reality-deltas.md §α-10
  - plans/tz/2026-05-22-final-roadmap.md §α-10
  - docs/reference/llm-models-playbook.md
---

# SBA α-10 wave 3 — Admin LLM + Unit Economics: cron'ы, adapter registry, REST, UI

## 1. Цель и контекст

Wave 2 закрыт: модели LlmProvider, LlmModel, AiCostDaily, OrgBudgetCap, CurrencyRate + snapshot полей в AiUsageLog/LlmModelPrice/LlmTaskRoute. Admin-группы унифицированы (Шаг 2). Wave 3 — превратить data model в работающую админку:
1. **5 cron'ов**: DailyCostAggregator, OrgEconomics, BudgetAlert, CurrencyRateSync (ЦБ РФ), ProviderSmokeTest.
2. **LlmProtocolAdapterRegistry** — refactor hardcoded `switch(provider)` в LlmRouterService → 5 адаптеров (OpenAI-chat / OpenAI-Responses / Anthropic-messages / Ollama-native / Custom-http).
3. **REST API** для admin.
4. **5 admin UI страниц**: `/admin/llm/providers`, `/admin/llm/models`, `/admin/economics`, `/admin/economics/orgs/[id]`, `/admin/org/economics`. + расширение `/admin/llm-prices` history.

## 2. Scope

**Входит:**
- 5 cron'ов:
  - `DailyCostAggregatorCron` (`@Cron('0 1 * * *')`) — агрегирует AiUsageLog за вчера в AiCostDaily.
  - `OrgEconomicsCron` (`@Cron('0 2 * * *')`) — пересчёт unit-economics per org (avg cost/user, P&L per agent-feature).
  - `BudgetAlertCron` (`@Cron('0 */2 * * *')`) — каждые 2 часа: проверка OrgBudgetCap.utilization, эмит Notification если ≥80% / ≥100%.
  - `CurrencyRateSyncCron` (`@Cron('0 7 * * *')`) — daily fetch от ЦБ РФ (USD/RUB rate), upsert CurrencyRate.
  - `ProviderSmokeTestCron` (`@Cron('*/30 * * * *')`) — каждые 30 минут: smoke-test каждого LlmProvider (короткий «ping» запрос), запись результата в metrics + alert если 3+ подряд провалов.
- LlmProtocolAdapterRegistry: интерфейс `ILlmProtocolAdapter` + 5 реализаций. Refactor LlmRouterService.call() для использования registry вместо `switch(provider)`.
- REST API admin (TenantGuard опц.; для llm-providers/economics глобальные — без TenantGuard, только SuperAdminGuard).
- 5 UI страниц + extend существующей `/admin/llm-prices` history.
- Метрики: `ai_cost_usd_total{tenant_top, task_type, provider, model}`, `ai_cost_rub_total{...}`, `ai_calls_total{tenant_top, task_type, provider, model, success}`, `org_budget_utilization_percent{tenant_top}`, `provider_smoke_test_success{provider}`.

**Не входит:**
- Реал-тайм биллинг — пока daily aggregation.
- Расширение существующих admin/usage страниц — оставить как есть (после унификации в Шаге 2 они уже в edinый shell).

## 3. Принятые решения

1. **OrgEconomicsCron — daily, не real-time.** Real-time slow для большого числа orgs. Daily — достаточная гранулярность для billing-dashboards.
2. **BudgetAlertCron каждые 2 часа** — баланс между «оперативно среагировать» (orgs не упрутся в hard-cap) и не-spam'ить.
3. **CurrencyRateSyncCron — ЦБ РФ API** через https://www.cbr-xml-daily.ru/daily_json.js (или эквивалент). Cache result 24h. Fallback rate 90 RUB/USD если API недоступен.
4. **ProviderSmokeTestCron каждые 30 минут** — частая enough для on-call alerts, но не cost-heavy (1 token per provider per call).
5. **LlmProtocolAdapterRegistry — DI-driven.** Каждый адаптер — `@Injectable()` с `@ProtocolAdapter('openai-chat')` декоратором. Registry собирает их при startup. Adding new adapter — не правит LlmRouterService.
6. **Backward-compat:** legacy `LlmTaskRoute.providerName/model` остаются параллельно с `providerId/modelId`. Новый код пишет в новые поля; legacy reads — оба.
7. **UI structure:**
   - `/admin/llm/providers` — list + CRUD LlmProvider.
   - `/admin/llm/models` — list + CRUD LlmModel + price-card link.
   - `/admin/economics` — global dashboard (cost charts, top orgs by cost).
   - `/admin/economics/orgs/[id]` — per-org drill-down.
   - `/admin/org/economics` — per-current-org (для org admins, не super_admin).
8. **Alerting** — through ConversationalService.sendNotification (in_app + email) when budget ≥80% / ≥100% to org admin role.
9. **Snapshot fields** в AiUsageLog (inputCostPerMillionTokensSnapshot etc.) — populated by LlmRouterService at call time (read current price + currency rate, snapshot).

## 4. Зависимости

- α-10 wave 2 (готово) — 5 моделей + snapshot fields.
- α-1 (готово) — ConversationalService для alerts.
- Admin унификация (готово) — единый Z-Admin shell.

## 5. Prisma-дельта

Изменений нет.

## 6. Patch / миграция данных

`backend/scripts/patch-backfill-snapshot-fields-aiusagelog.ts` (опц., только для аналитики history): для AiUsageLog без snapshot fields → проставить из исторической LlmModelPrice по дате + CurrencyRate (если есть в history).

`backend/scripts/seed-default-llm-providers-and-models.ts`:
- Создаёт LlmProvider записи для: openai, deepseek, anthropic, ollama, custom.
- Создаёт LlmModel записи для популярных: gpt-4o, gpt-4o-mini, deepseek-chat, qwen3.5:9b, claude-sonnet-4-6, claude-opus-4-7.
- Использует safe-seed-rules — не перезаписывает admin-edited.

## 7. REST API

`/api/v1/admin/llm-providers` (SuperAdminGuard):
- `GET/POST/PATCH/DELETE` стандартный CRUD.
- `POST /:id/smoke-test` — manual trigger.

`/api/v1/admin/llm-models` (SuperAdminGuard):
- `GET/POST/PATCH/DELETE`.
- `GET /:id/price-history` — список LlmModelPrice по модели в timeline.

`/api/v1/admin/llm-prices` (existing) — extend `GET /history?modelId=...&providerId=...`.

`/api/v1/admin/orgs/:id/budget` (SuperAdminGuard):
- `GET/PATCH` OrgBudgetCap (monthly limit, alert thresholds).

`/api/v1/admin/unit-economics`:
- `GET /global` — последние 30 дней, top-N orgs by cost, per task_type breakdown.
- `GET /orgs/:id` — детально для org.

`/api/v1/org/economics` (TenantGuard, org admin role):
- `GET /current` — текущий месяц cost + budget + alerts.

## 8. BullMQ worker'ы и cron'ы

Все cron'ы через `@Cron` (NestJS Schedule).

- `DailyCostAggregatorCron` — `@Cron('0 1 * * *')`. SQL aggregation AiUsageLog → AiCostDaily.
- `OrgEconomicsCron` — `@Cron('0 2 * * *')`. Per-org metrics (avg cost/user, top-features).
- `BudgetAlertCron` — `@Cron('0 */2 * * *')`. Notification via ConversationalService.
- `CurrencyRateSyncCron` — `@Cron('0 7 * * *')`. Fetch ЦБ РФ.
- `ProviderSmokeTestCron` — `@Cron('*/30 * * * *')`. Ping per provider, write metric.

JobId паттерны:
- `cost-aggregate_${yyyy-mm-dd}` (idempotent — не дубль-агрегация одного дня).
- `budget-alert_${tenantId}_${currentHour}` (anti-spam — 1 alert per 2h).
- `smoke-test_${providerId}_${minute-bucket}`.

## 9. LlmTaskType регистрация

Нет новых LlmTaskType. ProviderSmokeTest использует special `taskType='_smoke_test'` (короткий статический промпт), не идёт через LlmRouter (direct call).

## 10. RBAC ResourceType

`policy.csv`:
- `llm_provider.read/write/admin` (super_admin only).
- `llm_model.read/write/admin` (super_admin only).
- `unit_economics.global.read` (super_admin).
- `unit_economics.org.read` (org_admin, super_admin) — для своего tenant.
- `org_budget.read/write` (super_admin write; org_admin read).

## 11. Метрики Prometheus

- `ai_cost_usd_total{tenant_top, task_type, provider, model}` counter.
- `ai_cost_rub_total{tenant_top, task_type, provider, model}` counter.
- `ai_calls_total{tenant_top, task_type, provider, model, success}` counter.
- `org_budget_utilization_percent{tenant_top}` gauge.
- `provider_smoke_test_success{provider}` gauge (1.0=success, 0.0=fail).
- `provider_smoke_test_duration_seconds{provider}` histogram.
- `currency_rate_usd_rub` gauge.
- Cardinality protection: tenant top-100 + other; task_type top-50; provider/model — ограничены registered set (small).

## 12. Frontend

- `frontend/app/(authenticated)/admin/llm/providers/page.tsx` — CRUD list + actions (test connectivity).
- `frontend/app/(authenticated)/admin/llm/providers/[id]/page.tsx` — detail.
- `frontend/app/(authenticated)/admin/llm/models/page.tsx` — list + CRUD + price-link.
- `frontend/app/(authenticated)/admin/llm/models/[id]/page.tsx` — detail + price history chart.
- `frontend/app/(authenticated)/admin/economics/page.tsx` — global dashboard (Recharts/Vidstack для charts).
- `frontend/app/(authenticated)/admin/economics/orgs/[id]/page.tsx` — per-org drill-down.
- `frontend/app/(authenticated)/admin/org/economics/page.tsx` — org admin view of own org.
- Расширение `frontend/app/(authenticated)/admin/llm-prices/page.tsx` — добавить history view с filter по modelId/providerId.
- API клиенты: `admin-llm-providers.api.ts`, `admin-llm-models.api.ts`, `admin-economics.api.ts`, `org-economics.api.ts`.
- Domain mappers.
- NAV в AdminShell: NAV-группа «Контент и AI» уже включает llm-prices; добавить LLM providers/models под подгруппу. Создать NAV-группу «Юнит-экономика».
- `Remove-Item -Recurse -Force .next\types` после правок.

## 13. ENV переменные

- `BUDGET_ALERT_ENABLED: boolean (default true)`.
- `BUDGET_ALERT_THRESHOLD_PERCENTS: string (default '80,100')`.
- `CURRENCY_RATE_API_URL: string (default 'https://www.cbr-xml-daily.ru/daily_json.js')`.
- `CURRENCY_RATE_FALLBACK_USD_RUB: number (default 90)`.
- `PROVIDER_SMOKE_TEST_ENABLED: boolean (default true)`.
- `PROVIDER_SMOKE_TEST_INTERVAL_MINUTES: number (default 30)`.
- `PROVIDER_SMOKE_TEST_FAIL_THRESHOLD: number (default 3)` — fail count before alert.

## 14. Связь с существующим кодом

- `backend/src/modules/ai/services/llm-router.service.ts` — refactor switch(provider).
- `backend/src/modules/ai/services/anthropic.service.ts`, `openai.service.ts`, `deepseek.service.ts`, `ollama.service.ts` — преобразовать в адаптеры через @ProtocolAdapter decorator.
- `backend/src/modules/conversational/services/conversational.service.ts` — для alert sendNotification.
- `frontend/app/(authenticated)/admin/AdminShell.tsx` — расширить NAV.
- schema.prisma — все 5 моделей + snapshot fields.

## 15. DoD

- [ ] 5 cron'ов работают на schedule, idempotency через JobId pattern.
- [ ] LlmProtocolAdapterRegistry refactor завершён — `switch(provider)` удалён.
- [ ] REST endpoints зарегистрированы, Swagger.
- [ ] 5 + 1 UI страниц рендерятся, читают данные.
- [ ] BudgetAlert приходит через Notification (in_app + email) при пересечении 80%/100%.
- [ ] CurrencyRate sync работает (тест на mock'е API).
- [ ] ProviderSmokeTest пишет метрики + alert на 3+ подряд провалов.
- [ ] Seed-script запущен (5 providers + 6 models в test).
- [ ] `bun run typecheck` + `bun run lint` + unit/integration зелёные.

## 16. Тесты

- **unit:** для каждого cron'а spec (mock now, mock data).
- **unit:** `llm-protocol-adapter-registry.spec.ts` — резолв адаптера по provider.
- **unit:** для каждого адаптера — успех + retry + timeout.
- **integration:** `cost-aggregator-cron.spec.ts` — AiUsageLog → AiCostDaily с фиксированной выборкой.
- **integration:** `budget-alert-flow.spec.ts` — превышение → Notification.
- **integration:** `currency-rate-sync.spec.ts` — fetch + upsert.
- **e2e:** `/admin/economics` — рендер dashboard с тестовыми данными.

## 17. Риски и mitigation

- **Adapter refactor — большой scope.** Mitigation: keep legacy switch как fallback за feature-flag `USE_PROTOCOL_ADAPTER_REGISTRY=false`. При прод-проблеме — flip off.
- **Cron-storm при первом запуске на большой БД** — DailyCostAggregator: один день = manageable; OrgEconomics: per-org с `LIMIT 100` + cursor.
- **ЦБ РФ API down** — fallback rate из env; alert если 3+ дня нет sync'а.
- **Schema merge** — wave 3 не модифицирует schema. Безопасно.
- **`.next/types/` кэш** — Remove-Item после правок.
- **Cardinality метрик** — top-N tenant, top-N task_type, hard limits на enum-like labels.
