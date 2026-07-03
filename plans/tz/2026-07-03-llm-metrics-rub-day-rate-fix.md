---
type: tz
status: ready-to-implement
feature: llm-metrics-rub-day-rate-fix
date: 2026-07-03
owner: Tozix
relates_to:
  - plans/architecture/2026-07-03-llm-metrics-rub-day-rate-fix.md
  - plans/architecture/2026-07-03-llm-budget-cost-rub-hard-cap-fix.md
  - plans/tz/2026-07-03-llm-budget-cost-rub-hard-cap-fix.md
  - docs/operations/feature-flags.md
---

> Архитектура (одобрена владельцем): `plans/architecture/2026-07-03-llm-metrics-rub-day-rate-fix.md` · Статус согласования: 2026-07-03.
> Принцип: минимальный точечный багфикс. Никакой новой схемы БД, никакого нового экрана. Два независимых блока правок (могут идти в любом порядке / параллельно).

# ТЗ: «Метрики» считают рубли по сохранённой построчной цене, а не по курсу дня запроса

## Цель + Зачем

Экран «Метрики» (`/admin/ai/routing/[taskType]`, вкладка «Метрики») показывает расход задачи ИИ в рублях за период. Сегодня это число получается умножением суммы `costUsd` за ВЕСЬ период на курс USD→RUB, актуальный в момент открытия страницы (`usdRubRate`) — расчёт введён явно и намеренно на Ф6 фичи `llm-providers-models-routing-admin` (2026-07-02, комментарий `ai-models.service.ts:102` "Ф6 (2026-07-02): текущий курс USD→RUB"), это не случайная регрессия, а изначально неверный дизайн: курс USD/RUB меняется ежедневно, а к сумме за 7/30 дней применяется единственная точка курса — итоговая рублёвая цифра систематически расходится с реальным расходом.

В этой же БД уже есть корректный источник истины: `AiUsageLog.costRub` — рублёвая стоимость **каждого отдельного вызова**, посчитанная по курсу на момент этого вызова (`AiUsageLogService.record()`, `backend/src/modules/ai/services/ai-usage-log.service.ts:83-117`, поле пишется с недавней фичи `llm-budget-cost-rub-hard-cap-fix`). Готовый паттерн суммирования этого поля за период с подстраховкой на случай отсутствия значения уже реализован и работает в `BudgetGuardService.getMtdRub()` (`backend/src/modules/ai/services/budget-guard.service.ts:46-69`) — тот же класс задачи («сколько потрачено в рублях за период»), решённый правильно.

Зачем чинить: владелец компании смотрит на этот экран, чтобы понять, где именно расход по задаче ИИ высокий, и принимает решения об экономии (например, «поставить модель подешевле» для конкретной задачи) — недостоверная цифра ведёт к решениям вслепую.

## REALITY-CHECK

- Баг подтверждён построчным чтением кода в этой же сессии (см. `plans/architecture/2026-07-03-llm-metrics-rub-day-rate-fix.md`, раздел 2). Свежая перепроверка (сейчас, при написании ТЗ) не изменила картину — `path:line` ниже сверены заново.
- `AdminAiModelsService.metrics_()` — `backend/src/modules/admin/ai-models/ai-models.service.ts:425-510`. Группирует `AiUsageLog` по `(tier, success)` через `this.prisma.aiUsageLog.groupBy(...)` (`:432-437`), суммируя только `costUsd`/`durationMs`. Курс запрашивается один раз в самом конце (`:495`) и уходит в ответ как `usdRubRate` (`:508`), сам метод RUB нигде не считает — умножение происходит на фронте.
- Умножение — `frontend/src/domain/admin-ai-model.ts:103-109`, функция `formatCostRub(usd, rubRate)`. Единственные два call site — оба в `frontend/app/(admin)/admin/ai/routing/[taskType]/RoutingDetailClient.tsx`: построчно на `:616` (`formatCostRub(row.costUsd, metrics.usdRubRate)`), итог на `:635` (`formatCostRub(metrics.totals.totalCostUsd, metrics.usdRubRate)`). Других мест использования `formatCostRub` в проекте нет (проверено грепом) — контракт функции можно менять полностью, без опасений сломать другой экран.
- Тип ответа — `TaskTypeMetricsView` (`ai-models.service.ts:82-104`) и зеркальный `TaskTypeMetricsApi` (`frontend/src/api/admin-ai-models.api.ts:42-63`) — оба без domain/UI-маппера, `RoutingDetailClient.tsx` использует Api-тип напрямую как `metrics`.
- Готовый корректный паттерн — `BudgetGuardService.getMtdRub()` (`budget-guard.service.ts:46-69`): один `$queryRaw` с `SUM(COALESCE("costRub", "costUsd" * ${fxRate}))`, `fxRate` — заранее полученный текущий курс (используется ТОЛЬКО как подстраховка для строк без сохранённого `costRub`, не как множитель всей суммы).
- Курс-фолбэк — `CurrencyRateService.getCurrentUsdRubRate()` (`backend/src/modules/admin/economics/currency-rate.service.ts:18-38`) уже сам инкапсулирует подстраховку: при отсутствии свежей строки в `currency_rates` берёт `this.cfg.budget.currencyFallbackUsdRub` (`:36`). Эта крутилка сегодня резолвится в обход правила проекта — `backend/src/common/config/typed-config.service.ts:1748`: `currencyFallbackUsdRub: Number(this.get('CURRENCY_RATE_FALLBACK_USD_RUB') ?? 90)` — читает ENV напрямую (`this.get`), а не через `resolveSync` (admin→ENV→код-дефолт). ENV-ключ `CURRENCY_RATE_FALLBACK_USD_RUB` при этом легитимно объявлен в `env.schema.ts:673` (`z.coerce.number().positive().default(90)`) — сам ENV не лишний, лишний только способ его читать в этом месте.
- Второй перенос — `llm.budget.enforce_enabled`, используется в `backend/src/modules/ai/services/llm-router.service.ts:1595-1597` через `this.cfg?.getDynamic<boolean>('llm.budget.enforce_enabled', undefined, false)`. `getDynamic()` (`typed-config.service.ts:2000-2025`) сам по себе НЕ требует регистрации ключа в `admin-setting-schema-registry.ts` для работы (просто читает сырое значение из `AdminSettingsService.get()`, без схемной валидации на чтении) — то есть рантайм-поведение уже полностью рабочее (наблюдение подтверждено ранее в этой сессии: флаг сейчас эффективно `false`, hard-cap не применяется). Регистрация нужна ИСКЛЮЧИТЕЛЬНО для того, чтобы ключ появился в общем списке настраиваемых параметров администратора (генерируется из `[...registry.keys()]`, `admin-setting-schema-registry.ts:556`) — сегодня владелец физически не может увидеть этот флаг в интерфейсе. Это чистая регистрация, поведение не меняется.
- Реестр — `backend/src/modules/admin/settings/admin-setting-schema-registry.ts`. Namespace `llm.budget.*` уже используется в коде (`llm.budget.mtd_cache_ttl_sec` в `budget-guard.service.ts:48`, `llm.budget.enforce_enabled` выше), но **ни один ключ этого namespace сегодня не зарегистрирован** (проверено грепом по файлу — 0 совпадений на `llm.budget`). `llm.budget.mtd_cache_ttl_sec` — та же болезнь, что и два ключа этого ТЗ, но он НЕ входит в одобренную архитектуру и в scope этого фикса (см. «Не входит» ниже) — не чини его здесь.
- Обобщённая admin-UI для любого зарегистрированного ключа уже существует (`frontend/src/ui/components/admin/AdminSettingField.tsx` + `useAdminSettingEditor.ts`) — новых фронтенд-компонентов для Фазы 2 не требуется.
- Побочно обнаружена (не входит в scope, зафиксировать отдельно) таблица `AiCostDaily` (`schema.prisma:3187-3211`) — ежедневная агрегация `(tenantId, date, taskType, provider, model)` с уже корректно посчитанным `costRub`, наполняется `DailyCostAggregatorCron` (`backend/src/modules/admin/economics/daily-cost-aggregator.cron.ts`), но **не читается вообще нигде в кодовой базе** (проверено грепом — единственное упоминание `aiCostDaily` вне cron/spec — сам cron). Готовая, но неиспользуемая инфраструктура для будущего многоуровневого дашборда — не трогать в этом ТЗ, но учесть в следующей архитектуре дашборда (не строить параллельную агрегацию с нуля).

## Принятые решения владельца

| # | Решение | Дата | Обоснование |
|---|---|---|---|
| Р1 | Чинить сейчас, маленьким ТЗ, не дожидаясь конкретного примера от владельца | 2026-07-03 | Владелец выбрал этот вариант явно в чате (AskUserQuestion) — баг математически неверен независимо от значения курса |
| Р2 | Считать RUB построчным суммированием сохранённой `costRub` (как в `BudgetGuardService.getMtdRub()`), а не пересчитывать агрегат текущим курсом | 2026-07-03 (архитектура) | См. `plans/architecture/2026-07-03-llm-metrics-rub-day-rate-fix.md` Р1 — переиспользуем уже доказанно верный паттерн проекта |
| Р3 | Переносим `currencyFallbackUsdRub` и `llm.budget.enforce_enabled` в `admin-setting-schema-registry.ts` БЕЗ изменения текущих значений/поведения | 2026-07-03 (архитектура) | См. Р2 архитектуры — попутная починка нарушения CLAUDE.md п.9, дёшево сделать заодно |
| Р4 | Не трогать `llm.budget.mtd_cache_ttl_sec` (тот же паттерн orphan-крутилки, найден при картографии этого ТЗ) | 2026-07-03 | Не входит в одобренную архитектуру — расширение scope владельцем не согласовано. Зафиксировать строкой в `second-brain/04_не-сделано/README.md` после реализации, не чинить молча заодно |

## Доказательство выбора (Проход A/B)

**Проход A (выбран).** Backend сам считает и возвращает готовую сумму в рублях: один `$queryRaw`, группирующий `AiUsageLog` по `(tier, success)`, с `SUM(COALESCE("costRub", "costUsd" * $fxFallback))` в дополнение к существующим `COUNT`/`SUM(costUsd)`/`SUM(durationMs)`. Ответ получает новые поля `perTier[t].costRub` и `totals.totalCostRub` (уже готовые ₽). Фронт перестаёт умножать — просто форматирует пришедшее число.

**Проход B (отклонён).** Backend оставляет архитектуру как есть (агрегат в USD + отдельное поле курса), но вместо «курса на сейчас» отдаёт «средневзвешенный эффективный курс за период» = `Σ costRub_stored / Σ costUsd` по той же выборке. Фронт по-прежнему умножает `costUsd × rate`.

| Критерий | A | B |
|---|---|---|
| Использует уже доказанный в проекте паттерн (`BudgetGuardService`) без изменений | ✓ | ✗ (новый вид «синтетического курса», нигде в проекте так не считают) |
| Не вводит семантику, которая может ввести админа в заблуждение (поле `usdRubRate` уже используется в UI как «курс прямо сейчас», `:582-587`) | ✓ (оставляет `usdRubRate` = реальный текущий курс, как сегодня) | ✗ (пришлось бы либо завести второе поле «period-курс», либо подменить смысл существующего) |
| Количество мест расчёта конвертации | 1 (backend, там же, где уже есть `costRub` в БД) | 2 (backend считает синтетический курс + фронт всё равно умножает) |
| Изменение фронтенда | Убрать 1 функцию-множитель, форматировать готовое число | Оставить умножение, только источник курса иной |
| Единица работы одним SQL-проходом (не 2 запроса) | ✓ (тот же `$queryRaw`, что уже группирует `tier/success`, дополнительная колонка в `SELECT`) | ✓ (тоже возможно одним проходом) |

Проход A выигрывает по 4 из 5 критериев и не вводит новую, нигде не используемую концепцию «средневзвешенного курса за период», которая могла бы разойтись по смыслу с существующим полем `usdRubRate` (которое явно подписано на экране как «курс USD→RUB» — то есть текущий курс, не расчётный).

**Challenge-loop:**
- *Корень, не симптом:* да — чинит класс задачи «сумма в рублях за произвольный период по построчным данным», не один конкретный экран; тот же приём уже переиспользован из `BudgetGuardService`, и любой будущий period-агрегат в рублях должен брать этот же паттерн, а не «курс на сейчас × сумма usd».
- *Самое ли эффективное:* да — один SQL-проход, без новых таблиц/кэшей; количество запросов к БД не увеличивается (заменяем существующий `groupBy` на `$queryRaw` с той же группировкой + 1 доп. колонку).
- *Код ради кода:* нет — не создаём новых сервисов/абстракций, правим один метод + одну фронт-функцию + 2 строки реестра + 2 строки сида + 1 строку в `typed-config.service.ts`.

## Scope

**Входит:**
- Фаза 1: `metrics_()` считает и возвращает `perTier[t].costRub` / `totals.totalCostRub` построчным суммированием сохранённой `costRub`; фронт использует готовое число вместо умножения.
- Фаза 2: регистрация `llm.budget.currencyRateFallbackUsdRub` и `llm.budget.enforce_enabled` в `admin-setting-schema-registry.ts` + `seed-admin-settings.ts`; перевод чтения фолбэк-курса в `typed-config.service.ts` на `resolveSync`.

**Не входит:**
- `aiFeatures.analyzeWorkerRouterEnabled` — не трогать (проверено, работает верно).
- Включение `llm.budget.enforce_enabled=true` — отдельное решение владельца (сумма лимита + поведение при превышении), см. `docs/operations/feature-flags.md` пункт 1. Этот фикс регистрирует ключ с текущим кодовым дефолтом `false`, поведение не меняет.
- «Переходный месяц» (недосчёт RUB при смеси старых `NULL` и новых заполненных `costRub` в `UnitEconomicsService`/`OrgEconomicsCron`) — покрыто `plans/tz/2026-07-03-llm-budget-cost-rub-hard-cap-fix.md`, не переоткрывать.
- `llm.budget.mtd_cache_ttl_sec` — тот же паттерн orphan-крутилки, найден в REALITY-CHECK, но не в одобренной архитектуре — судьба: строка в `second-brain/04_не-сделано/README.md` после реализации (см. DoD).
- Строка данных `openai/gpt-5-4` (дефис, нулевые цены) в `LlmModelPrice` — отдельная низкоприоритетная находка, не чинить здесь.
- `AiCostDaily`/`DailyCostAggregatorCron` — обнаруженная неиспользуемая инфраструктура, не подключать и не трогать в этом ТЗ; зафиксировать находку в second-brain для будущей архитектуры дашборда (см. DoD).

## Контракт

### Backend: новый агрегатный запрос (заменяет `ai-models.service.ts:432-437`)

Сигнатура строки результата и SQL (дословно, с плейсхолдерами Prisma tagged-template — параметры экранируются автоматически, `taskType` уже проверен `assertKnownTaskType()` до этого места):

```ts
interface MetricsRawRow {
  tier: LlmRouteTier | null;
  success: boolean;
  cnt: number;
  duration_sum: string | null;
  cost_usd_sum: string | null;
  cost_rub_sum: string | null;
}

// usdRubRate уже вычисляется в методе (переносится ВЫШЕ, до запроса — см. R2)
// Если usdRubRate === null (сервис недоступен/бросил) — costRub считать НЕ пытаемся,
// но плейсхолдер курса в SQL всё равно нужен синтаксически; передаём 0 — результат
// колонки cost_rub_sum в этом случае просто не читается ниже (R3).
const fxForCoalesce = usdRubRate ?? 0;

const grouped = await this.prisma.$queryRaw<MetricsRawRow[]>`
  SELECT
    tier,
    success,
    COUNT(*)::int AS cnt,
    SUM("durationMs")::text AS duration_sum,
    SUM("costUsd")::text AS cost_usd_sum,
    SUM(COALESCE("costRub", "costUsd" * ${fxForCoalesce}))::text AS cost_rub_sum
  FROM "AiUsageLog"
  WHERE "taskType" = ${taskType} AND "createdAt" >= ${since}
  GROUP BY tier, success
`;
```

Требования к разбору `grouped` (заменяет цикл `ai-models.service.ts:453-462`):
- `tierTotals[tier].cost` — как сегодня, суммировать `Number.parseFloat(row.cost_usd_sum ?? '0') || 0`.
- Добавить `tierTotals[tier].costRub` (новый аккумулятор, инициализировать `0` в объекте `tierTotals` наравне с `ok/fail/latency/cost`) — суммировать `usdRubRate !== null ? (Number.parseFloat(row.cost_rub_sum ?? '0') || 0) : 0` (значение не читаем, если курс недоступен — см. R3).
- `row.tier` из raw-запроса — `(row.tier ?? 'primary') as LlmRouteTier`, как и сегодня (`:454`).
- `row.success` — Postgres `boolean` возвращается как JS `boolean` напрямую, `if (row.success)`/`else` как сегодня (`:458-459`), без изменений.
- `row._count._all` (Prisma `groupBy`) заменить на `row.cnt` (raw, уже `int`).
- `row._sum.durationMs` заменить на `Number.parseFloat(row.duration_sum ?? '0') || 0`.

### Backend: изменения типов (контракт front↔back, единый источник правды)

`TaskTypeMetricsView` (`ai-models.service.ts:82-104`) — добавить поля, ничего не удалять:

```ts
export interface TaskTypeMetricsView {
  period: '24h' | '7d' | '30d';
  totals: {
    calls: number;
    successCalls: number;
    failedCalls: number;
    totalCostUsd: number;
    totalCostRub: number | null; // NEW — null только если usdRubRate === null
    fallbackCalls: number;
    fallbackRate: number;
  };
  perTier: Record<
    LlmRouteTier,
    {
      calls: number;
      successRate: number;
      avgLatencyMs: number;
      p95LatencyMs: number;
      costUsd: number;
      costRub: number | null; // NEW — null только если usdRubRate === null
    }
  >;
  usdRubRate: number | null;
}
```

`TaskTypeMetricsApi` (`frontend/src/api/admin-ai-models.api.ts:42-63`) — зеркально те же 2 новых поля (`totalCostRub: number | null` в `totals`, `costRub: number | null` в `perTier`).

**R1.** Когда `usdRubRate !== null` (курс доступен), `metrics_()` shall возвращать `perTier[t].costRub` и `totals.totalCostRub` как построчную сумму сохранённой `AiUsageLog.costRub` (с фолбэком `costUsd * usdRubRate` для строк без сохранённого значения) за выбранный период.
**R2.** Вычисление `usdRubRate` shall происходить ДО SQL-запроса метрик (не после, как сегодня на `:495`), чтобы то же значение использовалось и как поле ответа, и как параметр `COALESCE`-фолбэка в одном и том же вызове — без второго обращения к `CurrencyRateService`.
**R3.** Когда `usdRubRate === null` (сервис недоступен или бросил), `metrics_()` shall возвращать `perTier[t].costRub = null` и `totals.totalCostRub = null` — не подставлять код-литерал курса молча (чтобы не расходиться с текстом UI «курс недоступен — показываем в USD», `RoutingDetailClient.tsx:586`).
**R4.** `totals.totalCostRub` shall быть суммой трёх `perTier[t].costRub` (аналогично тому, как уже считается `totals.totalCostUsd` из `perTier[t].costUsd`, `ai-models.service.ts:491-492`) — не отдельным SQL-агрегатом (одно число, один источник правды).

### Frontend: убрать умножение, форматировать готовое число

`frontend/src/domain/admin-ai-model.ts:103-109` — заменить `formatCostRub(usd, rubRate)` на функцию, принимающую УЖЕ посчитанное значение в рублях:

```ts
export function formatRub(rub: number | null): string {
  if (rub === null) return '—';
  if (rub < 1) return `${(rub * 100).toFixed(2)} коп`;
  return `${rub.toFixed(2)} ₽`;
}
```

`[ASSUMPTION: удаляю formatCostRub целиком, а не оставляю рядом — единственные 2 call site оба переписываются в этом же ТЗ, второй функции с похожим именем в проекте нет (проверено грепом), оставлять неиспользуемую функцию — мёртвый код]`.

`RoutingDetailClient.tsx`:
- `:616` `{formatCostRub(row.costUsd, metrics.usdRubRate)}` → `{formatRub(row.costRub)}`.
- `:635` `{formatCostRub(metrics.totals.totalCostUsd, metrics.usdRubRate)}` → `{formatRub(metrics.totals.totalCostRub)}`.
- Импорт `formatCostRub` (`:36`) → `formatRub`.
- Строка `:581-588` (курс USD→RUB) — не менять, она уже корректно показывает "текущий курс" как есть, это не результат конвертации.

**R5.** Когда `row.costRub`/`metrics.totals.totalCostRub` равны `null`, интерфейс shall показывать `—` вместо рублёвого значения (не `NaN`, не пустую строку).

### Phase 2: регистрация двух крутилок

`backend/src/modules/admin/settings/admin-setting-schema-registry.ts` — вставить после строки 148 (`['aiFeatures.analyzeWorkerRouterEnabled', z.boolean()]`), перед блоком `llm.cacheSmokeEnabled` (`:150`):

```ts
  ['llm.budget.enforce_enabled', z.boolean()],
  ['llm.budget.currencyRateFallbackUsdRub', z.number().positive()],
```

`backend/scripts/seed-admin-settings.ts` — добавить в существующий массив `llm` (после блока `llm.router.defaultChain`, `:925-934`, перед закрывающей `];` на `:935`):

```ts
    [
      'llm.budget.enforce_enabled',
      envBool('LLM_BUDGET_ENFORCE_ENABLED', false),
      'high',
      'Жёсткий лимит месячного бюджета на ИИ: false = только наблюдение (превышение логируется, вызовы не блокируются), true = новые вызовы ИИ отклоняются при превышении лимита компании. Включение — отдельное решение владельца (см. docs/operations/feature-flags.md, пункт 1).',
    ],
    [
      'llm.budget.currencyRateFallbackUsdRub',
      envFloat('CURRENCY_RATE_FALLBACK_USD_RUB', 90),
      'low',
      'Запасной курс USD→RUB на случай, если свежих данных о курсе ЦБ нет (таблица currency_rates пуста или синк не сработал). Используется CurrencyRateService и при построчной подстраховке расчёта costRub.',
    ],
```

`[ASSUMPTION: envBool('LLM_BUDGET_ENFORCE_ENABLED', false) — вспомогательный ENV-ключ ТОЛЬКО для сида начального значения (как и у остальных строк в этом же массиве, например ANALYZE_WORKER_ROUTER_ENABLED, :903) — сам рантайм-путь (llm-router.service.ts:1595-1597) этот ENV не читает и не должен: getDynamic() там вызывается с envFallbackKey=undefined намеренно (пере-подтверждено REALITY-CHECK), это НЕ регрессия, а осознанный дизайн — ENV этой крутилки не существовало и не должно появиться в реальном пути. Если ENV-переменная LLM_BUDGET_ENFORCE_ENABLED не задана в .env — envBool() вернёт дефолт false, что и требуется.]`

`backend/src/common/config/typed-config.service.ts:1748` — заменить:
```ts
currencyFallbackUsdRub: Number(this.get('CURRENCY_RATE_FALLBACK_USD_RUB') ?? 90),
```
на:
```ts
currencyFallbackUsdRub: this.resolveSync<number>(
  'llm.budget.currencyRateFallbackUsdRub',
  'CURRENCY_RATE_FALLBACK_USD_RUB',
  90,
),
```
Имя свойства (`currencyFallbackUsdRub`) не менять — `CurrencyRateService.getCurrentUsdRubRate()` (`currency-rate.service.ts:36`) читает именно его, без изменений на стороне вызывающего кода.

**R6.** Когда в `AdminSetting` нет строки `llm.budget.enforce_enabled`, `llm-router.service.ts` shall продолжать резолвить `false` (текущее поведение) — регистрация в реестре не создаёт требование задать значение.
**R7.** Когда в `AdminSetting` нет строки `llm.budget.currencyRateFallbackUsdRub`, `CurrencyRateService` shall продолжать резолвить `90` через ENV-фолбэк (текущее поведение) — `resolveSync` цепочка admin→ENV→код-дефолт не меняет итоговое значение при пустой БД.

## Границы фичи

- ✅ Always: менять только перечисленные файлы; переиспользовать `formatRub`/паттерн `COALESCE` без новых абстракций; сохранять текущее поведение при отсутствующих admin-настройках (R6/R7).
- ⚠️ Ask first: если при реализации окажется, что `$queryRaw` с `GROUP BY tier, success` даёt другой порядок/типы данных, чем описано здесь (например, `success` приходит не как `boolean`, а как `string`) — не угадывать маппинг, свериться с реальным поведением через мини-тест (`bunx vitest run`), не молчаливо приводить типом.
- 🚫 Never: не трогать `UnitEconomicsService`/`OrgEconomicsCron`/`AiCostDaily`/`DailyCostAggregatorCron`; не включать `llm.budget.enforce_enabled=true`; не чинить `llm.budget.mtd_cache_ttl_sec` или `gpt-5-4` в этом ТЗ.

## Фазы

Обе фазы независимы (нет общих файлов, Фаза 1 не зависит от того, зарегистрирован ли фолбэк-курс — `CurrencyRateService.getCurrentUsdRubRate()` работает одинаково до и после Фазы 2) — можно реализовывать в любом порядке или параллельно.

### Фаза 1 — `metrics_()` считает RUB построчно, фронт форматирует готовое число

**Ценность.** Как владелец компании, я вижу в «Метриках» рублёвую сумму, которая совпадает с реально потраченным за период, а не с суммой, искажённой курсом дня открытия страницы.

**Что входит:** правки `ai-models.service.ts` (метод `metrics_()`, тип `TaskTypeMetricsView`), `admin-ai-models.api.ts` (тип `TaskTypeMetricsApi`), `admin-ai-model.ts` (замена `formatCostRub` → `formatRub`), `RoutingDetailClient.tsx` (2 call site + импорт).

**Что НЕ входит:** изменение `usdRubRate`, изменение верхней строки «Курс USD→RUB» в UI, изменение `latencyRows`-запроса (`:464-469`, не относится к деньгам).

**Файлы:**
- `backend/src/modules/admin/ai-models/ai-models.service.ts:82-104` (тип), `:425-510` (метод) — якорь-символ: `async metrics_(taskType: string, query: MetricsQueryDto)`.
- `frontend/src/api/admin-ai-models.api.ts:42-63` — якорь: `export type TaskTypeMetricsApi = {`.
- `frontend/src/domain/admin-ai-model.ts:103-109` — якорь: `export function formatCostRub(`.
- `frontend/app/(admin)/admin/ai/routing/[taskType]/RoutingDetailClient.tsx:36,616,635` — якорь: `formatCostRub`.

**Зависимости:** нет (первая фаза, либо параллельно с Фазой 2).

**Acceptance:**
- `bunx vitest run backend/src/modules/admin/ai-models/ai-models.service.spec.ts` — зелёный. Существующие 3 теста блока `describe('metrics_ usdRubRate (Ф6)'...)` (`:427-444`) продолжают проходить без изменений логики теста (только мок-харнесс, см. ниже) — `usdRubRate` не меняет своего поведения (null при недоступном сервисе, значение при доступном).
- Новый тест (добавить в тот же `describe`): при `usdRubRate = 90.5` и мок-строке `AiUsageLog` с `costUsd=1, costRub=null` (эмулирует старую запись до фичи costRub) — `perTier[<её tier>].costRub` shall равняться `1 * 90.5 = 90.5` (фолбэк сработал).
- Новый тест: при мок-строке с `costUsd=1, costRub=100` (несовпадающее с текущим курсом намеренно, эмулирует реальный дневной курс отличный от «сегодняшнего») — `perTier[<её tier>].costRub` shall равняться `100` (сохранённое значение использовано, НЕ `costUsd * usdRubRate`) — это ключевой негативный тест, доказывающий что баг исправлен, а не переехал.
- Новый тест: при `usdRubRate = null` (сервис бросил) — `totals.totalCostRub` и все `perTier[t].costRub` shall быть `null`, независимо от значений `costUsd`/`costRub` в БД.
- Мок-харнесс (`build()` в спеке, `:150-165` область) — добавить `$queryRaw: vi.fn(async () => [...])` в объект `prisma` (сегодня группировка идёт через `aiUsageLog.groupBy`, которая тоже замокана рядом, `:158`; после Фазы 1 `metrics_()` вызывает `$queryRaw`, не `groupBy` — мок `groupBy` для метрик можно оставить нетронутым для остальных тестов, если они его используют, проверить перед удалением).
- `bun run typecheck` (backend и frontend) — 0 ошибок.
- `bun run lint` (backend и frontend) — 0 ошибок.
- Ручная проверка (опц., если поднят dev): открыть `/admin/ai/routing/summary` (или любой существующий taskType), вкладка «Метрики» — колонка «Стоимость» показывает `₽`/`—`, не `NaN`, не падает.

**Закрывает:** R1, R2, R3, R4, R5.

### Фаза 2 — регистрация `llm.budget.enforce_enabled` и `llm.budget.currencyRateFallbackUsdRub`

**Ценность.** Как владелец компании, я вижу оба переключателя (жёсткий лимит бюджета, запасной курс валюты) в общем списке настраиваемых параметров администратора — и могу при необходимости их поменять сам, без правки кода разработчиком.

**Что входит:** 2 строки в `admin-setting-schema-registry.ts`, 2 строки (объекта) в `seed-admin-settings.ts`, 1 замена строки в `typed-config.service.ts`.

**Что НЕ входит:** изменение значений (`false`/`90` остаются как есть), новый UI-компонент (используется существующий `AdminSettingField.tsx`), `llm.budget.mtd_cache_ttl_sec`.

**Файлы:**
- `backend/src/modules/admin/settings/admin-setting-schema-registry.ts:148-150` — якорь: `['aiFeatures.analyzeWorkerRouterEnabled', z.boolean()],` (вставка сразу после).
- `backend/scripts/seed-admin-settings.ts:925-935` — якорь: `'llm.router.defaultChain',` (вставка в тот же массив `llm`, перед закрывающей `];`).
- `backend/src/common/config/typed-config.service.ts:1748` — якорь: `currencyFallbackUsdRub: Number(this.get('CURRENCY_RATE_FALLBACK_USD_RUB')`.

**Зависимости:** нет (может идти параллельно с Фазой 1).

**Acceptance:**
- Прогон сида: `docker compose exec backend bun run scripts/seed-admin-settings.ts` (или локальный эквивалент из `backend/`) — завершается без ошибок; повторный прогон — идемпотентен (не создаёт дублей, не меняет `updatedBy` у уже существующих строк — стандартное поведение `upsert`-паттерна этого скрипта, не специфично для этого ТЗ).
- `bun run typecheck` — 0 ошибок (в частности, `resolveSync<number>` с 3 аргументами компилируется — сверить сигнатуру `resolveSync` перед правкой, она уже используется тем же образом в соседних строках того же файла, например `:1703-1707`).
- Grep-проверка: `grep -n "llm.budget.enforce_enabled" backend/src/modules/admin/settings/admin-setting-schema-registry.ts` и `grep -n "llm.budget.currencyRateFallbackUsdRub" backend/src/modules/admin/settings/admin-setting-schema-registry.ts` — оба находят ровно одну строку.
- `bunx vitest run backend/src/common/config` (если есть спек-файл на `typed-config.service.ts` / `no-direct-process-env.guard.spec.ts`) — зелёный; убедиться, что `no-direct-process-env.guard.spec.ts` (упомянут в REALITY-CHECK) не начинает флагать новую строку `resolveSync` как нарушение (она таковым не является — `resolveSync` это и есть разрешённый путь).
- Ручная проверка (опц.): в существующем общем экране настроек администратора (куда бы он ни вёл сегодня для остальных `llm.*`/`aiFeatures.*` ключей) появляются обе новые строки с описаниями из сида.

**Закрывает:** R6, R7.

## Pre-mortem / Риски

- **Тип `success` из `$queryRaw` может прийти не `boolean`.** Postgres `boolean` через `pg`/Prisma обычно маппится в JS `boolean` напрямую, но если драйвер вернёт `'t'/'f'` строкой (замечено в некоторых сырых JS-клиентах Postgres) — тест Фазы 1 это поймает (см. «Ask first» в границах). Митигация: сравнивать явным `=== true` вместо `if (row.success)`, если тест покажет расхождение.
- **`$queryRaw` не проходит через тот же слой типобезопасности, что `groupBy`.** Митигация — акцент на негативном тесте (costUsd=1, costRub=100 → ожидаем 100, не 90.5) в Acceptance Фазы 1, он ловит и опечатку в SQL, и неверный порядок аргументов COALESCE.
- **`no-direct-process-env.guard.spec.ts` может считать любое использование `this.get(...)` подозрительным паттерном шире, чем ожидается** — если тест специфично таргетит СТРОКУ 1748, после правки он должен автоматически перестать её видеть (строка исчезает); если тест ищет по всему файлу общий паттерн — прогнать и убедиться, что он всё ещё зелёный, ничего специфично под эту строку чинить не нужно.
- **Ревью-аспекты для `strict-production-review-gate`:** нет новых эндпоинтов/новых прав доступа — `TenantGuard`/RBAC не затронуты (метод `metrics_()` уже был доступен только через существующий admin-контроллер, права не меняются); нет новых миграций; нет новых очередей/BullMQ; наблюдаемость (prom-metrics/логи) не требует изменений — `metrics_()` не логирует и не шлёт метрики сегодня, это не меняется.

## Idempotency / feature-flag / prod-deploy

- Это НЕ Ship-On флаг ни в каком виде — обе фазы либо чистый багфикс (Фаза 1, поведение видимо для всех сразу после деплоя), либо регистрация уже работающей крутилки с тем же дефолтом (Фаза 2, поведение не меняется).
- Прод-деплой: если Фаза 2 трогает `seed-admin-settings.ts` — по правилам проекта это шаг 7 в `docs/operations/prod-deploy-log.md` («Накоплено к выкату»), добавить/обновить строку `bun run scripts/seed-admin-settings.ts` (уже там значится, если предыдущие фичи его туда добавляли — сверить перед добавлением дубля). Никаких новых BullMQ/cron/эндпоинтов — шаг 12 не затрагивается.
- Нет новой Prisma-миграции, `backend/scripts/apply-prod-deploy.ts` `STEPS` не меняются (сид уже там зарегистрирован предыдущими фичами — проверить на месте, не дублировать запись).

## DoD

- `bun run typecheck` / `bun run lint` / `bun run build` — backend и frontend, зелёные.
- `bunx vitest run backend/src/modules/admin/ai-models/ai-models.service.spec.ts` — зелёный, включая 3 новых теста.
- `second-brain/01_projects/` — обновить профильную заметку про экономику/дашборды ИИ, если она существует (упомянуть исправление RUB-расчёта в «Метриках»).
- `second-brain/04_не-сделано/README.md` — добавить строку «Открыто»: `llm.budget.mtd_cache_ttl_sec` не зарегистрирован в `admin-setting-schema-registry.ts` (тот же паттерн, что чинили здесь) + строку про `AiCostDaily`/`DailyCostAggregatorCron` — готовая, но неиспользуемая дневная агрегация, учесть при следующей архитектуре многоуровневого дашборда расходов (не строить агрегацию с нуля).
- `docs/operations/feature-flags.md` — реестр флагов не меняется по существу (оба ключа существовали и работали и до этого фикса), но если файл перечисляет `llm.budget.enforce_enabled` (пункт 1) — сверить, что описание там соответствует новому статусу «зарегистрирован в admin-setting-schema-registry, видим в UI, поведение не изменилось».
- Рефлексия в `second-brain/05_история/2026-07-03-...md` — что нашли (RUB-баг в «Метриках»), как чинили (построчный COALESCE по образцу BudgetGuardService), что вышло (тесты/typecheck), чему научились (Ф6 намеренно ввёл неверный дизайн — реордер вычисления курса до запроса устранил лишний вызов сервиса).
- Коммит и push — по отдельному подтверждению владельца (правило проекта), не самостоятельно.

## Итог

_Заполнит `tz-orchestrator` по завершении реализации: что сделано по факту, что осталось, ссылки на коммиты._
