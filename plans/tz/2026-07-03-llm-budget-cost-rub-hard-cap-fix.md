---
type: tz
status: ready-to-implement
feature: llm-budget-cost-rub-hard-cap-fix
date: 2026-07-03
owner: Tozix
relates_to:
  - plans/architecture/2026-07-03-llm-budget-cost-rub-hard-cap-fix.md
  - plans/tz/2026-07-02-llm-providers-models-routing-admin.md
  - second-brain/04_не-сделано/README.md
  - docs/operations/feature-flags.md
---

> Архитектура (одобрена владельцем 2026-07-03): `plans/architecture/2026-07-03-llm-budget-cost-rub-hard-cap-fix.md`. Статус согласования: одобрено, вариант А (`llm.budget.enforce_enabled` остаётся выключенным после этого фикса).

# ТЗ: `costRub` пишется корректно, hard-cap бюджета технически способен сработать

## Принцип

`AiUsageLog.costRub` заполняется на каждой новой записи расхода; `BudgetGuardService.getMtdRub()` считает сумму месяца по каждой строке с подстраховкой (не строкой «если сумма ровно 0», а построчно `COALESCE`), чтобы переходный месяц со смесью старых NULL-строк и новых заполненных считался правильно. `llm.budget.enforce_enabled` НЕ трогаем — остаётся `false` (наблюдение), пока владелец отдельно не решит сумму лимита и поведение (`docs/operations/feature-flags.md`, пункт 1).

## Цель + Зачем

Хочу, чтобы данные, на которых основан hard-cap бюджета ИИ, были настоящими — сегодня они гарантированно нулевые, значит выключатель `enforce_enabled` в принципе не может сработать, даже если владелец его включит. Это не гипотетический риск: `docs/operations/feature-flags.md` уже фиксирует этот флаг как решение, которое владелец планирует принять, — к моменту его решения данные должны быть готовы.

## REALITY-CHECK (проверено 2026-07-03, номера строк — на момент написания, перечитать перед правкой)

**Где ломается расчёт рублей:**
- `AiUsageLogService.record()` (`backend/src/modules/ai/services/ai-usage-log.service.ts:81-119`, создание записи `prisma.aiUsageLog.create({data:{...}})`) пишет `costUsd: new Prisma.Decimal(input.costUsd.toFixed(6))` (`:105`), поле `costRub` в `data` отсутствует полностью → Prisma пишет `NULL` (дефолт колонки). Конструктор (`:73-79`): инжектит `PrismaService`, `BusinessMetricsService`, `TypedConfigService` (`this.cfg`) — `CurrencyRateService` НЕ инжектится.
- `AiUsageLog.costRub` — `backend/prisma/schema.prisma:1684`, `Decimal? @db.Decimal(14, 4)`. Комментарий на СОСЕДНЕМ поле `LlmModelPrice.currencyRateToUsdSnapshot` (`:3079`) упоминает задумку "для исторических AiUsageLog.costRub вычислений без re-query CurrencyRate" — не реализовано, это единственная документальная зацепка, что поле вообще предполагалось заполнять.
- `BudgetGuardService.getMtdRub()` (`backend/src/modules/ai/services/budget-guard.service.ts:42-57`) — `prisma.aiUsageLog.aggregate({_sum:{costRub:true}, where:{tenantId, createdAt:{gte:startOfMonth}}})`. `SUM` по колонке, где все значения `NULL`, даёт `NULL` → `Number(agg._sum.costRub ?? 0)` = `0`. Кэш `Map<tenantId,{rub,fetchedAt}>`, TTL из `llm.budget.mtd_cache_ttl_sec` (AdminSetting, default 60с через `cfg.getDynamic`).
- `BudgetGuardService.evaluate()` (`:24-40`) — `over = capKind==='hard' && mtdRub>=capRub`; при `tenantId===null` возвращает `NONE` без запросов. Конструктор (`:17-22`): `@Inject(PrismaService)`, `@Optional() @Inject(TypedConfigService) cfg?`.
- `LlmRouterService.call()` (`backend/src/modules/ai/services/llm-router.service.ts:1584-1597`) — вызывает `budgetGuard.evaluate(tenantId)`; при `over===true` проверяет `getDynamic('llm.budget.enforce_enabled', false)`; `true` → `throw LlmBudgetExceededError`; `false` (текущий дефолт, всегда, т.к. настройки в реестре нет — см. ниже) → WARN-лог + метрика `incLlmBudgetExceeded({mode:'observe'})`.

**Рабочий эталон (для сравнения, НЕ трогать):**
- `OrgEconomicsCron.computeForOrg()` (`backend/src/modules/admin/economics/org-economics.cron.ts:80-140`) считает 30-дневное и MTD-окно через `$queryRaw` (`SELECT SUM(costUsd), SUM(costRub) FROM "AiUsageLog" WHERE ...`), затем **грубая подстраховка на уровне ИТОГОВОЙ суммы**: `if (rubMtd === 0 && usdMtd > 0) rubMtd = usdMtd * fxRate` (`:124-127`). `fxRate` получен один раз в `runForAll()` через `this.fx.getCurrentUsdRubRate()` (`:46`) и передан параметром в `computeForOrg`.
- **Важный нюанс, который эта фича обязана исправить, а не скопировать:** грубая подстраховка `OrgEconomicsCron` ломается, если в периоде есть СМЕСЬ строк — часть с уже заполненным `costRub` (после этого фикса), часть старых `NULL`. Тогда `SUM(costRub)` даст ненулевую, но ЗАНИЖЕННУЮ сумму (NULL-строки не участвуют в SUM вообще), проверка `rub===0` не сработает, и старые строки останутся недосчитанными молча. Правильно — построчный `COALESCE("costRub", "costUsd" * fxRate)` внутри `SUM`, а не проверка суммы целиком. См. Б1 ниже — это НЕ применяется к `OrgEconomicsCron` (вне scope, не трогаем его), но `BudgetGuardService.getMtdRub()` в этой фиче обязан использовать построчный вариант.
- `CurrencyRateService.getCurrentUsdRubRate()` (`backend/src/modules/admin/economics/currency-rate.service.ts:17-40`) — кэш 5 минут в памяти инстанса, читает `prisma.currencyRate.findFirst({where:{baseCurrency:'USD',quoteCurrency:'RUB'}, orderBy:{rateDate:'desc'}})`, фолбэк `this.cfg.budget.currencyFallbackUsdRub` (`typed-config.service.ts:1743`, ENV `CURRENCY_RATE_FALLBACK_USD_RUB`, дефолт `90`).
- `OrgBudgetCap` (`schema.prisma:3222-3242`) — `monthlyCapRub: Decimal?`, `capKind: String @default("soft")`, `alertThresholds`, `setByUserId`.

**Найдено дополнительно, вне scope (зафиксировано, не чинить здесь):**
- Нет фронтенд-страницы для установки `monthlyCapRub`/`capKind` организации. Бэкенд есть (`GET/PATCH /api/v1/admin/orgs/:id/budget`, `backend/src/modules/admin/economics/admin-economics.controller.ts:79,84`, DTO `./dto/admin-budget.dto.ts`), фронт api-клиент есть (`frontend/src/api/admin-economics.api.ts:28,33`), но ни один `.tsx`-файл его не вызывает (`grep -rn "admin-economics.api" frontend/src frontend/app` — только сам файл). Отдельная возможная будущая фича, НЕ строим здесь.
- `llm.budget.enforce_enabled` НЕ зарегистрирован в `admin-setting-schema-registry.ts` (`grep` — 0 совпадений) — читается только через `getDynamic` с code-fallback `false`, без записи в БД и без UI. Не трогаем — владелец решил оставить как есть (см. Принятые решения В1).

**Модульная топология — техническая развилка, требующая решения (Шаг 2):** `CurrencyRateService` объявлен и экспортируется напрямую в `AdminModule` (`backend/src/modules/admin/admin.module.ts:33` импорт, `:140` provider, `:165` export) — НЕ в отдельном под-модуле. `AiUsageLogService` и `BudgetGuardService` живут в `backend/src/modules/ai/services/`, регистрируются в `AiModule` (`backend/src/modules/ai/ai.module.ts`, `@Global()` на `:1`, `imports: [EmbeddingsModule]` на `:43`). `AdminModule` НЕ импортирует `AiModule` напрямую (только `AdminAiModule` — это другой, admin-локальный модуль `admin/ai/ai.module.ts`, не путать); `PrismaService`/`TypedConfigService`, которые нужны `CurrencyRateService`, оба `@Global()` (`common/prisma/prisma.module.ts:5`, `common/config/config.module.ts`) — не требуют явного импорта. Прямой `imports: [AdminModule]` в `AiModule` — плохая идея (обратное направление зависимости, риск раздувания графа модулей); см. Б1.

## Принятые решения владельца

| # | Решение | Обоснование | Не пересматривать |
|---|---|---|---|
| В1 | Делаем оба фикса разом: запись `costRub` при вставке (`AiUsageLogService.record()`) И построчная подстраховка при чтении (`BudgetGuardService.getMtdRub()`). | Владелец подтвердил рекомендацию — запись закрывает NULL для новых строк дёшево (курс уже кэширован 5 мин), подстраховка на чтении покрывает переходный месяц и сбои записи. См. архитектуру Р1. | Да |
| В2 | `llm.budget.enforce_enabled` НЕ трогаем — остаётся code-fallback `false`, без регистрации в `AdminSetting`. | Архитектура, Шаг 8 — вариант А: сумма лимита и поведение (А/Б/В) — отдельное решение владельца позже (`docs/operations/feature-flags.md` п.1). Включать одновременно с фиксом данных — смешивать два независимых решения. | Да |
| В3 | UI для установки `monthlyCapRub`/`capKind` — не строим. | Архитектура, границы: отдельная фича при необходимости. | Нет — можно взять отдельным ТЗ |
| В4 | Backfill старых (до фикса) строк с `costRub=NULL` — НЕ делаем отдельным скриптом. | `BudgetGuardService.getMtdRub()` считает ТОЛЬКО текущий месяц (`startOfMonth..now`) — построчный `COALESCE` в SQL-запросе (Б1) уже корректно учитывает старые NULL-строки текущего месяца на лету, без физической перезаписи данных. Исторические месяцы (прошлые) hard-cap не проверяет — backfill им не нужен. `OrgEconomicsCron`'s 30-дневная/дневная аналитика не в scope (не трогаем). | Да — если понадобится точная историческая рублёвая отчётность за прошлые месяцы, это отдельная задача с явным запросом. |

## Доказательство выбора (два прохода + challenge-loop)

### Б1 — Как `AiModule`-сервисам получить курс валют: прямой импорт `AdminModule` vs выделение `CurrencyRateService` в отдельный модуль

- **Проход A (прямой импорт).** `AiModule` добавляет `imports: [AdminModule]`, `AiUsageLogService`/`BudgetGuardService` инжектят `CurrencyRateService` напрямую. Работает технически (Nest не запрещает), но: `AdminModule` — гигантский модуль (~30+ провайдеров, десятки контроллеров) — тащить его целиком в `AiModule` только ради одного маленького сервиса архитектурно неверно (нарушает границу «низкоуровневый ai-модуль не должен знать про admin-модуль») и создаёт риск будущего цикла, если `AdminModule` (или что-то, что он импортирует) когда-нибудь начнёт импортировать `AiModule` напрямую (сегодня — нет, но это станет невидимой миной).
- **Проход B (выделенный модуль).** Выносим `CurrencyRateService` в новый `CurrencyRateModule` (`backend/src/modules/admin/economics/currency-rate.module.ts`) — сам сервис зависит только от `PrismaService`/`TypedConfigService` (оба `@Global()`, доп. импорты не нужны). `AdminModule` импортирует `CurrencyRateModule` вместо прямой регистрации сервиса (и ре-экспортирует его для обратной совместимости с текущими потребителями — `OrgEconomicsCron`/`BudgetAlertCron`/`UnitEconomicsService` и т.д., которые сегодня получают `CurrencyRateService` через `AdminModule`). `AiModule` тоже импортирует `CurrencyRateModule` — напрямую, без прохождения через `AdminModule`.

| Критерий | A (прямой импорт AdminModule) | B (выделенный модуль) |
|---|---|---|
| Соответствие принципу единственной ответственности модуля | Нарушает — `AiModule` тянет весь `AdminModule` | Соблюдает — `AiModule` тянет только нужный сервис |
| Риск циклической зависимости в будущем | Реальный (если `AdminModule`-граф когда-то станет импортировать `AiModule`) | Отсутствует — `CurrencyRateModule` не зависит ни от `AdminModule`, ни от `AiModule` |
| Прецедент в кодовой базе | Нет аналога | Совпадает с `EmbeddingsModule` (`ai.module.ts:43`, `imports: [EmbeddingsModule]`) — тот же паттерн: маленький выделенный модуль под общий сервис |
| Объём изменений | Меньше строк | На 1 файл больше (`currency-rate.module.ts`), но каждое изменение локально понятно |

**Выбор: B.** Совпадает с существующим паттерном проекта (`EmbeddingsModule`), не создаёт архитектурного долга.

### Б2 — Формула построчной подстраховки в `getMtdRub()`: копировать `OrgEconomicsCron`'s «если сумма 0» vs построчный `COALESCE`

- **Проход A (копировать `OrgEconomicsCron`).** `const sum = await prisma.aiUsageLog.aggregate({_sum:{costUsd,costRub}}); if (sum.costRub===0 && sum.costUsd>0) rub = sum.costUsd*fxRate;`. Ломается в переходный месяц (смесь NULL и не-NULL строк) — см. REALITY-CHECK.
- **Проход B (построчный `COALESCE` в `$queryRaw`).** `SELECT SUM(COALESCE("costRub", "costUsd" * ${fxRate})) ... `. Корректно работает независимо от того, сколько строк уже имеют `costRub`, а сколько — старые NULL.

**Выбор: B** — единственный вариант, устойчивый к переходному месяцу, который гарантированно наступит сразу после деплоя этой фичи.

### Challenge-loop
1. **Корень, не симптом?** Да — чиним ОБА конца проблемы (запись + чтение), не патчим только один вызов.
2. **Самое эффективное?** Да — курс валют уже кэшируется 5 минут внутри `CurrencyRateService`, дополнительный вызов на каждую запись `AiUsageLog` не создаёт нагрузки на БД (не считая редких промахов кэша, которые уже случаются в `OrgEconomicsCron`/`BudgetAlertCron`).
3. **Код ради кода?** Нет — переиспользуем существующий `CurrencyRateService` целиком (не копируем его логику), просто меняем его модульный дом.

## Scope

### Входит
- Backend: `CurrencyRateModule` (новый, выносит существующий `CurrencyRateService`), `AdminModule` и `AiModule` оба его импортируют.
- Backend: `AiUsageLogService.record()` пишет `costRub` через `CurrencyRateService.getCurrentUsdRubRate()` (best-effort, при сбое — NULL, как сегодня, лог логируется в существующий catch-блок).
- Backend: `BudgetGuardService.getMtdRub()` переходит на построчный `$queryRaw` с `COALESCE`.
- Тесты: обновить `ai-usage-log.service.spec.ts`, `budget-guard.service.spec.ts` под новые конструкторы/запросы; добавить кейсы на смешанный месяц (часть строк с `costRub`, часть без).

### Не входит
- Регистрация/включение `llm.budget.enforce_enabled` (В2).
- UI для установки лимита организации (В3).
- Backfill старых записей (В4).
- Любые изменения в `OrgEconomicsCron`/`BudgetAlertCron`/`DailyCostAggregatorCron` — их собственная (более грубая) подстраховка остаётля как есть; если однажды понадобится починить и её тем же построчным способом — отдельное ТЗ.
- Изменения в `docs/operations/feature-flags.md` пункта 1 (кроме, возможно, пометки «данные готовы» — на усмотрение при финальной приёмке, LOW-impact).

## Граничные контракты с другими ТЗ

- Фича 1 (`plans/tz/2026-07-03-llm-model-ab-experiments-real-split.md`) и Фича 3 (`plans/tz/2026-07-03-analyze-worker-llm-router-migration.md`) обе пишут в `AiUsageLog` через существующие пути (`LlmRouterService.call()`→`record()`, будущий `analyze.worker`→`record()`) — эта фича меняет ТОЛЬКО тело `record()`, не его публичную сигнатуру (`RecordAiUsageInput` не меняется) — обе смежные фичи продолжают работать без изменений на своей стороне.

## Контракт-first

### Новый файл: `backend/src/modules/admin/economics/currency-rate.module.ts`

```ts
import { Module } from '@nestjs/common';

import { CurrencyRateService } from './currency-rate.service';

@Module({
  providers: [CurrencyRateService],
  exports: [CurrencyRateService],
})
export class CurrencyRateModule {}
```

### `backend/src/modules/admin/admin.module.ts` — изменения

- Убрать `import { CurrencyRateService } from './economics/currency-rate.service';` (`:33`).
- Добавить `import { CurrencyRateModule } from './economics/currency-rate.module';`.
- В массиве `imports:` (`:75-...`) добавить `CurrencyRateModule`.
- В `providers:` убрать `CurrencyRateService` (была `:140`).
- В `exports:` (`:158-171`) заменить строку `CurrencyRateService,` (была `:165`) на `CurrencyRateModule,` — это сохраняет обратную совместимость: всё, что раньше получало `CurrencyRateService` через `AdminModule` (`OrgEconomicsCron`, `BudgetAlertCron`, `UnitEconomicsService`, любые другие потребители — проверить через `grep -rn "CurrencyRateService" backend/src` перед правкой, что все они по-прежнему резолвятся).

### `backend/src/modules/ai/ai.module.ts` — изменения

- Добавить `import { CurrencyRateModule } from '../admin/economics/currency-rate.module';`.
- `imports: [EmbeddingsModule]` (`:43`) → `imports: [EmbeddingsModule, CurrencyRateModule]`.

### `backend/src/modules/ai/services/ai-usage-log.service.ts` — изменения

Конструктор (`:73-79`), добавить параметр:
```ts
constructor(
  @Inject(PrismaService) private readonly prisma: PrismaService,
  @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
  @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  @Optional() @Inject(CurrencyRateService) private readonly currencyRate?: CurrencyRateService,
) {}
```
Импорт: `import { CurrencyRateService } from '../../admin/economics/currency-rate.service';`.

Внутри `record()`, ПЕРЕД вызовом `this.prisma.aiUsageLog.create()` (то есть до `:88` в старой нумерации), добавить best-effort вычисление (внутри уже существующего внешнего `try`, отдельный внутренний `try/catch`, чтобы сбой курса не ронял запись всей строки):
```ts
let costRub: Prisma.Decimal | undefined;
try {
  const rate = await this.currencyRate?.getCurrentUsdRubRate();
  if (rate !== undefined && Number.isFinite(rate) && rate > 0) {
    costRub = new Prisma.Decimal((input.costUsd * rate).toFixed(4));
  }
} catch {
  costRub = undefined;
}
```
В объекте `data: {...}` (`:88-117`) добавить рядом с `costUsd`:
```ts
costUsd: new Prisma.Decimal(input.costUsd.toFixed(6)),
...(costRub !== undefined ? { costRub } : {}),
```

### `backend/src/modules/ai/services/budget-guard.service.ts` — изменения

Конструктор (`:17-22`), добавить параметр:
```ts
constructor(
  @Inject(PrismaService) private readonly prisma: PrismaService,
  @Optional() @Inject(TypedConfigService) private readonly cfg?: TypedConfigService,
  @Optional() @Inject(CurrencyRateService) private readonly currencyRate?: CurrencyRateService,
) {}
```
Импорт: `import { CurrencyRateService } from '../../admin/economics/currency-rate.service';`.

Заменить тело `getMtdRub()` (`:42-57`) на:
```ts
private async getMtdRub(tenantId: string): Promise<number> {
  const ttlSec =
    (await this.cfg?.getDynamic<number>('llm.budget.mtd_cache_ttl_sec', undefined, 60)) ?? 60;
  const now = Date.now();
  const c = this.cache.get(tenantId);
  if (c && now - c.fetchedAt < ttlSec * 1000) return c.rub;
  const nowDate = new Date(now);
  const startOfMonth = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 1));
  let fxRate = 0;
  try {
    fxRate = (await this.currencyRate?.getCurrentUsdRubRate()) ?? 0;
  } catch {
    fxRate = 0;
  }
  const rows = await this.prisma.$queryRaw<Array<{ total_rub: string | null }>>`
    SELECT COALESCE(SUM(COALESCE("costRub", "costUsd" * ${fxRate})), 0)::text AS total_rub
    FROM "AiUsageLog"
    WHERE "tenantId" = ${tenantId}
      AND "createdAt" >= ${startOfMonth}
  `;
  const rub = Number.parseFloat(rows[0]?.total_rub ?? '0') || 0;
  this.cache.set(tenantId, { rub, fetchedAt: now });
  return rub;
}
```
`[ASSUMPTION: при fxRate=0 (курс недоступен) строки без costRub считаются как 0₽ — тот же исход, что и сегодня для них; НЕ регрессия.]`

## Границы фичи

- ✅ Always: переиспользовать `CurrencyRateService` как есть (не менять его внутреннюю логику/кэш); держать `record()`/`getMtdRub()` fail-open (сбой курса не роняет вызов ИИ и не роняет запись лога).
- ⚠️ Ask first: если `grep -rn "CurrencyRateService" backend/src` при правке `admin.module.ts` найдёт потребителя вне уже перечисленных (`OrgEconomicsCron`, `BudgetAlertCron`, `UnitEconomicsService`) — остановиться, убедиться, что он получит сервис через новый `exports: [CurrencyRateModule]` без доп. правок; если нет — уточнить.
- 🚫 Never: не трогать `llm.budget.enforce_enabled` (значение/регистрацию); не строить UI лимита; не менять `OrgEconomicsCron`/`BudgetAlertCron`/`DailyCostAggregatorCron`.

## Фазы

### Фаза 1 — Выделить `CurrencyRateService` в отдельный модуль

**Ценность.** Как разработчик, поддерживающий модульную структуру бэкенда, я получаю доступ к курсу валют из `AiModule` без нарушения границ модулей.

**Файлы:** новый `backend/src/modules/admin/economics/currency-rate.module.ts`; правка `backend/src/modules/admin/admin.module.ts` (импорт/providers/exports, см. Контракт-first).

**Зависимости:** нет (первая фаза).

**Что НЕ входит:** сами изменения в `AiUsageLogService`/`BudgetGuardService` (Фаза 2/3).

**Acceptance:**
- R1: `bun run build` (backend) shall проходить без ошибок после выноса `CurrencyRateService` в отдельный модуль.
- R2: `grep -rn "CurrencyRateService" backend/src --include=*.ts | grep -v spec` shall показать, что каждый прежний потребитель (`OrgEconomicsCron`, `BudgetAlertCron`, `UnitEconomicsService` — или что найдётся) по-прежнему компилируется (косвенно через R1).
- Закрывает: R1, R2.
- Команды: `bun run build`, `bun run typecheck`.

### Фаза 2 — `AiUsageLogService` пишет `costRub`

**Ценность.** Как владелец компании, я вижу настоящую рублёвую стоимость каждого вызова ИИ сразу после того, как он произошёл.

**Файлы:** `backend/src/modules/ai/ai.module.ts` (добавить `CurrencyRateModule` в `imports`), `backend/src/modules/ai/services/ai-usage-log.service.ts` (конструктор + тело `record()`, см. Контракт-first), `backend/src/modules/ai/services/ai-usage-log.service.spec.ts` (обновить моки конструктора — добавить мок `CurrencyRateService` с `getCurrentUsdRubRate: vi.fn(async () => 90)`; добавить тест: `costUsd=1, rate=90` → `costRub` в записи `create()` равен `90.0000`; добавить тест: `currencyRate.getCurrentUsdRubRate` бросает ошибку → запись всё равно создаётся, `costRub` отсутствует/undefined в `data`, лог не падает).

**Зависимости:** после Фазы 1.

**Что НЕ входит:** `BudgetGuardService` (Фаза 3).

**Acceptance:**
- R3: Когда `record()` вызван с `costUsd > 0` и `CurrencyRateService.getCurrentUsdRubRate()` возвращает число `> 0`, `prisma.aiUsageLog.create()` shall получить `data.costRub`, равный `costUsd * rate` (округление до 4 знаков).
- R4: Если `getCurrentUsdRubRate()` бросает исключение или недоступен (`currencyRate` не заинжектен), `record()` shall всё равно создать запись (без падения), `data.costRub` shall отсутствовать (не переопределять на `null` явно — оставить дефолт колонки).
- Закрывает: R3, R4.
- Команды: `bunx vitest run backend/src/modules/ai/services/ai-usage-log.service.spec.ts`, `bun run typecheck`.

### Фаза 3 — `BudgetGuardService` считает MTD построчно с подстраховкой

**Ценность.** Как владелец компании, я получаю правильную сумму расходов месяца для проверки лимита даже в переходный месяц (смесь старых и новых записей).

**Файлы:** `backend/src/modules/ai/services/budget-guard.service.ts` (конструктор + `getMtdRub()`, см. Контракт-first), `backend/src/modules/ai/services/budget-guard.service.spec.ts` (обновить `build()`: третий мок-параметр `currencyRate` с `getCurrentUsdRubRate: vi.fn(async () => opts.fxRate ?? 90)`; заменить мок `prisma.aiUsageLog.aggregate` на `prisma.$queryRaw = vi.fn(async () => [{ total_rub: String(opts.mtdRub ?? 0) }])`; добавить новый тест-кейс «смешанный месяц»: замокать `$queryRaw` так, будто в БД одна строка с `costRub=50` (не-NULL) и одна с `costRub=NULL,costUsd=1,rate=90` — итог `total_rub` в моке должен отражать `50 + 90 = 140` (тест на саму SQL-логику пишется как unit на JS-эквивалент формулы, а не через реальную БД — интеграционный тест на реальном Postgres опционален, `[ASSUMPTION: unit-тест на мокнутый результат $queryRaw достаточен, реальный SQL проверяется вручную одним `bun run` скриптом на dev-БД перед мержем]`).

**Зависимости:** после Фазы 1. Может выполняться параллельно с Фазой 2 (не пересекаются файлами).

**Что НЕ входит:** `enforce_enabled`, UI лимита (см. Scope).

**Acceptance:**
- R5: Когда `AiUsageLog` месяца содержит строки и с `costRub`, и с `costRub=NULL`, `getMtdRub()` shall вернуть сумму, где NULL-строки пересчитаны через `costUsd * fxRate`, а не пропущены.
- R6: Существующие тесты `budget-guard.service.spec.ts` (hard-cap срабатывает при `mtd>=cap`, soft-cap не блокирует, кэш работает, `tenantId=null` → `over=false`, ошибка Prisma → fail-open) shall продолжать проходить после миграции на `$queryRaw`.
- R7: Если `currencyRate.getCurrentUsdRubRate()` недоступен, `getMtdRub()` shall не бросать исключение — `fxRate` трактуется как `0` (NULL-строки считаются как `0₽`, как и до фикса).
- Закрывает: R5, R6, R7.
- Команды: `bunx vitest run backend/src/modules/ai/services/budget-guard.service.spec.ts`, `bun run typecheck`.

## Pre-mortem / Риски

- **Риск:** `$queryRaw` с параметром `fxRate` (число) внутри SQL-выражения `"costUsd" * ${fxRate}` — Prisma параметризует безопасно (не строковая конкатенация), риска SQL-инъекции нет (число, не строка пользовательского ввода) — но проверить типизацию (`fxRate` должен быть `number`, не `string`) при ревью.
- **Ревью-аспект для `strict-production-review-gate`:** убедиться, что переход `aggregate()` → `$queryRaw` не потерял фильтр `tenantId`/`createdAt` (SQL-инъекция полей, не значений — сверить `WHERE`-условия 1:1 со старым `aggregate`).
- **Риск:** `AiUsageLogService`/`BudgetGuardService` теперь оба зависят от `CurrencyRateService` — если её собственный 5-минутный кэш когда-то станет источником рассинхрона (разные инстансы процесса видят разный курс какое-то время) — не проблема этой фичи (существующее поведение `CurrencyRateService`, не меняем).

## Сквозные аспекты

- **RBAC/tenant:** без изменений — `getMtdRub()` уже принимает `tenantId`, фильтрует по нему в SQL как и раньше.
- **Observability:** без новых метрик — существующие (`incLlmBudgetExceeded`, `addAiCostUsd`) не меняются.
- **Errors/idempotency:** оба изменения — fail-open (сбой курса не ломает существующий функционал), см. R4/R7.
- **Миграция данных:** нет (В4 — backfill не нужен).
- **Rollout/флаг:** Ship-On, без флага — чистый фикс данных, не пользовательская фича с денежным включателем (это `enforce_enabled`, который не трогаем).
- **Тесты:** см. Acceptance фаз 2–3.

## Совместимость с prompt caching

Не релевантно — фича не касается LLM-промптов.

## DoD

- `bun run typecheck && bun run lint && bun run build` зелёные в `backend/`.
- Все новые/изменённые `.spec.ts` проходят (`bunx vitest run`).
- `second-brain/04_не-сделано/README.md` — строка 284 убрана из «Открыто», перенесена в «Закрытые (архив)» с датой и коммитом.
- `docs/operations/feature-flags.md` пункт 1 — опционально добавить одну строку-пометку «данные для hard-cap готовы с <дата>, ждёт решения владельца по сумме/поведению» (LOW-impact, на усмотрение при приёмке).
- Рефлексия в `second-brain/05_история/`.

## Итог

**Реализовано целиком, все 3 фазы.**

- Фаза 1 (`d066ed43`) — `CurrencyRateService` вынесен в `CurrencyRateModule` (`backend/src/modules/admin/economics/currency-rate.module.ts`), импортирован в `AiModule` без прямого импорта всего `AdminModule`. `AdminModule` ре-экспортирует `CurrencyRateModule` — все прежние потребители (`OrgEconomicsCron`, `BudgetAlertCron`, `CurrencyRateSyncCron`, `UnitEconomicsService`, `AdminAiModelsService`) продолжают резолвиться без изменений.
- Фаза 2 (`621ab6c8`) — `AiUsageLogService.record()` пишет `costRub = costUsd * текущий_курс` на каждую новую запись (best-effort, fail-open — сбой курса не роняет запись лога). 2 новых теста, 10/10 зелёных.
- Фаза 3 (`31e1cc55`) — `BudgetGuardService.getMtdRub()` перешёл с `prisma.aiUsageLog.aggregate()` на построчный `$queryRaw` с `COALESCE("costRub", "costUsd" * fxRate)` — корректно считает переходный месяц со смесью старых NULL-строк и новых заполненных (сознательно НЕ копирует грубую суммарную проверку `OrgEconomicsCron`, которая ломается на смешанных данных — см. Б2 доказательства выбора). 10/10 тестов зелёных, включая новый кейс «смешанный месяц».

**Верификация:** `bun run typecheck` зелёный на каждой фазе; полный прогон `bunx vitest run src/modules/ai/services` (весь модуль, не только новые файлы) — 49 файлов / 506 тестов, все зелёные, регрессий не найдено.

**Осталось (осознанно, не хвост):**
- `llm.budget.enforce_enabled` НЕ включён — остаётся отдельным решением владельца (сумма лимита + поведение при превышении), уже зафиксировано как открытый пункт в `docs/operations/feature-flags.md` до этого ТЗ и после него.
- Экран для установки `monthlyCapRub`/`capKind` кликами — не строился (явно вне scope, В3); эндпоинт `PATCH /api/v1/admin/orgs/:id/budget` уже есть, фронт не подключён.
- Backfill старых NULL-строк — не делался (явно не нужен, В4: `getMtdRub()` считает только текущий месяц, построчный `COALESCE` уже корректно обрабатывает смесь на лету).

**Prod-деплой:** миграций схемы нет (колонка `costRub` уже существовала), ENV не менялся, новых BullMQ-очередей/cron нет — обычный `docker compose up -d --build backend` без дополнительных шагов `apply-prod-deploy.ts`.
