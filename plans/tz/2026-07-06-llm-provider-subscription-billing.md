---
feature: llm-provider-subscription-billing
architecture: plans/architecture/2026-07-06-llm-provider-subscription-billing.md
status: done
date: 2026-07-06
---

# ТЗ — провайдер по подписке (учёт стоимости, без rate-limit)

## REALITY-CHECK

- `LlmProvider` — уже есть `defaultModelKey`, `isDefaultProvider` и т.д. Добавляем 3 поля: `billingMode String @default("per_token")`, `subscriptionMonthlyCostUsd Decimal? @db.Decimal(10,2)`, `subscriptionStartedAt DateTime?`.
- `LlmRouterService.computeCostUsd(provider, model, ...)` (`llm-router.service.ts:2064`) — берёт цену из `LlmModelPrice`/`MODEL_PRICES`, при отсутствии — WARN + `metrics.incLlmCostUnpriced`. Добавляем ранний выход: если `billingMode==='subscription'` у провайдера — `return 0` без похода в `LlmModelPrice`, без unpriced-метрики.
- `ProviderInfoResolver.resolveByName` (`provider-info.resolver.ts:28`) — кэширует `ProtocolAdapterProviderInfo` (60с TTL). Добавляем `billingMode` в `select` + `info`. Тип `ProtocolAdapterProviderInfo.billingMode?: string` в `protocol-adapter.types.ts`.
- `AiCostDaily` — per-`tenantId` (Org), НЕ трогаем. Новая модель `LlmProviderSubscriptionCharge` — platform-level, без `tenantId`.
- `LlmCostDashboardService.overview()` (`llm-cost-dashboard.service.ts:169`) — читает `AiCostDaily` без фильтра по tenant (уже платформенный вид). Добавляем подписочные платежи периода как отдельный merge в `trend`+`totals`.
- Нет существующего daily-cron для подписок — новый `ProviderSubscriptionChargeCron` (`@Cron` раз в день), по паттерну других крон-сервисов модуля (`provider-smoke-test.cron.ts`, `daily-cost-aggregator.cron.ts`).
- Нужна Prisma-миграция (3 новых поля + новая модель) — генерировать через `prisma migrate diff` (см. известный local shadow-DB баг — [[project-tsc-oom-false-clean]] память, там же паттерн для `isDefaultProvider`), применять точечным SQL.

## Фаза 1 — схема + отсутствие «безценового» списания

**`backend/prisma/schema.prisma`** — в `model LlmProvider` после `defaultModelKey`:
```prisma
/// Ф-фича 2026-07-06 llm-provider-subscription-billing: 'per_token' (обычная оплата за
/// токен, дефолт) | 'subscription' — фиксированная ежемесячная подписка вместо оплаты
/// за токен. При 'subscription' computeCostUsd() всегда возвращает 0 без похода
/// в LlmModelPrice — токены по-прежнему считаются (AiUsageLog), просто бесплатны.
billingMode                String    @default("per_token") @db.VarChar(20)
/// Сумма подписки в месяц, USD. NULL, если billingMode != 'subscription'.
subscriptionMonthlyCostUsd Decimal?  @db.Decimal(10, 2)
/// Дата начала подписки — определяет день месяца списания (см. LlmProviderSubscriptionCharge).
subscriptionStartedAt      DateTime?
```

Новая модель (рядом с `LlmTaskRouteChange`):
```prisma
/// Ф-фича 2026-07-06 llm-provider-subscription-billing: ledger списаний подписки.
/// Platform-level расход (НЕ per-org) — не путать с AiCostDaily.
model LlmProviderSubscriptionCharge {
  id           String   @id @default(cuid())
  providerId   String
  providerName String   @db.VarChar(60)
  /// День фактического списания (годовщина subscriptionStartedAt, с клампом на конец месяца).
  chargeDate   DateTime @db.Date
  amountUsd    Decimal  @db.Decimal(10, 2)
  createdAt    DateTime @default(now())

  provider LlmProvider @relation(fields: [providerId], references: [id], onDelete: Cascade)

  @@unique([providerId, chargeDate])
  @@index([chargeDate])
  @@map("llm_provider_subscription_charges")
}
```
(+ obratная ссылка `subscriptionCharges LlmProviderSubscriptionCharge[]` в `LlmProvider`, если Prisma требует — проверить по generate.)

Миграция: `bun run prisma:migrate -- --name add_llm_provider_subscription_billing` штатно; при локальном shadow-DB сбое — `prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datasource prisma/schema.prisma ...` (как в прошлой фиче) и точечный SQL к локальной БД.

**`backend/src/modules/ai/services/protocol-adapter/protocol-adapter.types.ts`** — добавить в `ProtocolAdapterProviderInfo`:
```ts
/** 'per_token' (дефолт) | 'subscription' — из LlmProvider.billingMode (DB). */
billingMode?: string;
```

**`backend/src/modules/ai/services/protocol-adapter/provider-info.resolver.ts`** — в `select` добавить `billingMode: true`, в `info` — `billingMode: row.billingMode`.

**`backend/src/modules/ai/services/llm-router.service.ts`** — в `computeCostUsd`, в самом начале метода:
```ts
if (this.providerInfo) {
  const resolved = await this.providerInfo.resolveByName(provider);
  if (resolved?.info.billingMode === 'subscription') return 0;
}
```
(до текущей логики поиска цены — полностью её обходит, никакого unpriced-WARN).

**Приёмка Фазы 1:** unit-тест на `computeCostUsd`/аналог: провайдер `billingMode='subscription'` без единой строки в `LlmModelPrice` и без записи в `MODEL_PRICES` → `costUsd=0`, `metrics.incLlmCostUnpriced` НЕ вызван. `bun run typecheck`/`lint`/`vitest`.

## Фаза 2 — cron списания + admin CRUD

**`backend/src/modules/admin/economics/provider-subscription-charge.cron.ts`** (новый файл):
```ts
@Injectable()
export class ProviderSubscriptionChargeCron {
  private readonly logger = new Logger(ProviderSubscriptionChargeCron.name);
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Cron('0 5 * * *', { name: 'provider-subscription-charge' }) // раз в день, 05:00
  async runScheduled(): Promise<void> {
    try {
      const result = await this.runOnce();
      this.logger.debug(result, 'provider-subscription-charge: проход завершён');
    } catch (err) {
      this.logger.error({ err: err instanceof Error ? err.message : String(err) }, 'provider-subscription-charge: непойманная ошибка');
    }
  }

  async runOnce(): Promise<{ charged: number }> {
    const providers = await this.prisma.llmProvider.findMany({
      where: { billingMode: 'subscription', subscriptionStartedAt: { not: null }, subscriptionMonthlyCostUsd: { not: null }, deletedAt: null },
    });
    let charged = 0;
    const today = new Date(); // UTC-дата без времени
    const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    for (const p of providers) {
      if (!p.subscriptionStartedAt || !p.subscriptionMonthlyCostUsd) continue;
      const startDay = p.subscriptionStartedAt.getUTCDate();
      const lastDayOfMonth = new Date(Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth() + 1, 0)).getUTCDate();
      const billingDay = Math.min(startDay, lastDayOfMonth); // клампим на конец короткого месяца
      if (todayDate.getUTCDate() !== billingDay) continue;
      if (todayDate <= p.subscriptionStartedAt) continue; // не списываем в сам день старта (старт — не первое списание)

      const exists = await this.prisma.llmProviderSubscriptionCharge.findUnique({
        where: { providerId_chargeDate: { providerId: p.id, chargeDate: todayDate } },
      });
      if (exists) continue;

      await this.prisma.llmProviderSubscriptionCharge.create({
        data: { providerId: p.id, providerName: p.name, chargeDate: todayDate, amountUsd: p.subscriptionMonthlyCostUsd },
      });
      charged++;
    }
    return { charged };
  }
}
```
Регистрация в модуле рядом с `ProviderSmokeTestCron`.

**`AdminLlmProvidersService`** — `create`/`update`/`present` расширить полями `billingMode`/`subscriptionMonthlyCostUsd`/`subscriptionStartedAt` (аналогично `defaultModelKey` — обычные optional-поля в DTO). Валидация: если `billingMode==='subscription'`, `subscriptionMonthlyCostUsd` и `subscriptionStartedAt` обязательны (иначе `UnprocessableEntityException`).

**DTO** (`admin-llm-providers.dto.ts`) — в `CreateLlmProviderSchema`:
```ts
billingMode: z.enum(['per_token', 'subscription']).default('per_token'),
subscriptionMonthlyCostUsd: z.number().positive().optional(),
subscriptionStartedAt: z.string().datetime().optional(), // ISO
```
+ superRefine: `subscription` ⇒ оба поля заданы.

**Приёмка Фазы 2:** cron-тесты (billingDay match/no-match, month-end clamp 31→28/29, идемпотентность повторного прогона в тот же день, `subscriptionStartedAt` в будущем — не списывать), service-тесты валидации. `typecheck`/`lint`/`vitest`.

## Фаза 3 — дашборд + frontend

**`LlmCostDashboardService.overview()`** — добавить запрос `llmProviderSubscriptionCharge.findMany({ where: { chargeDate: { gte, lt } } })` за тот же период, смёрджить суммы В `trend` (по совпадающей дате, ADD к `costUsd`; для дат без строки в `AiCostDaily` — создать точку) и добавить в `totals.costUsd` (единый общий расход, как договорились — «разовая строка в графике»). Добавить `totals.subscriptionCostUsd` (сумма подписок за период) — для прозрачности, чтобы не терялось, откуда скачок.

**`frontend/src/domain/admin-llm-cost.ts`**, **`admin-llm-cost.api.ts`** — если типы `totals` жёстко типизированы, добавить `subscriptionCostUsd?: number`.

**`frontend/app/(admin)/admin/ai/catalog/LlmProvidersClient.tsx`**:
- `ProviderFormDialog` — переключатель «Тип тарификации» (по токенам/по подписке), при подписке — поля «Сумма в месяц (USD)» + «Дата начала подписки».
- `ProviderCard` — бейдж `по подписке: $X/мес` рядом с `isDefaultProvider`.

**`frontend/app/(admin)/admin/ai/catalog/LlmModelsClient.tsx`** — в `ModelFormDialog`, если провайдер модели `billingMode==='subscription'`, подсказка под полем цены (если она вообще есть на этом экране — если нет отдельного поля цены в форме модели, пропустить; цена живёт в `LlmPricesClient`).

**`frontend/app/(admin)/admin/llm-prices/LlmPricesClient.tsx`** — в `AddPriceDialog`/`PriceFormDialog`, если выбранный `provider` — подписочный, показать подсказку «этот провайдер по подписке — цена не нужна, стоимость токенов всегда $0» (не блокировать сохранение — админ всё равно может явно занулить, просто это уже не обязательно).

**Приёмка Фазы 3:** `typecheck`/`lint`/`build` фронта и бэка, ручная проверка (создать подписочного провайдера, назначить дату старта в прошлом на billingDay=сегодня, прогнать cron вручную — появляется строка в графике).

## Итог
- [x] Фаза 1 — схема (`billingMode`/`subscriptionMonthlyCostUsd`/`subscriptionStartedAt` + `LlmProviderSubscriptionCharge`) + `computeCostUsd` bypass. Побочный найденный и исправленный баг: `openai-chat`/`custom-http` адаптеры читали `provider.defaultModel` (ENV-only легаси поле) вместо `provider.defaultModelKey` (DB, admin-редактируемое) — из-за этого smoke-тест и вызовы без явной модели у ЛЮБОГО DB-провайдера с openai-chat падали на хардкоде `gpt-4o-mini`. Живьём подтверждено на реальном провайдере `minimaxio2` (500→200 после фикса).
- [x] Фаза 2 — cron списания (`ProviderSubscriptionChargeCron`, day-of-month с клампом на конец месяца, идемпотентность через `@@unique([providerId, chargeDate])`) + admin CRUD (валидация обязательности суммы/даты при `billingMode='subscription'`)
- [x] Фаза 3 — дашборд (`LlmCostDashboardService.overview` мёржит подписочные платежи периода в `trend`+`totals.costUsd`, отдельно светит `totals.subscriptionCostUsd`) + frontend (переключатель типа тарификации в форме провайдера, бейдж на карточке, подсказка в форме цены)

Тесты: 13 новых (computeCostUsd bypass ×2, cron ×6, providers-service subscription-валидация ×4, dashboard-merge ×1) + полный backend-прогон 7878/7948 (16 сбоев — все предсуществующие, не связаны с фичей). Живая browser-QA (Playwright, реальная локальная БД): назначил `minimaxio2` подпиской $50/мес, бейдж появился, cron вручную создал charge, дашборд показал `subscriptionCostUsd:50` и спайк в `trend` на дату списания — после проверки тестовые данные удалены, провайдер возвращён в `per_token`.

**Найдена и исправлена реальная grabля окружения (не фичи):** миграция, применённая напрямую через `psql < migration.sql` на локальной AGE-базе, создала новую таблицу в схеме `ag_catalog` вместо `public` (тот же класс ошибки, что задокументирован в памяти проекта — AGE-расширение переопределяет `search_path` на сырых DDL-соединениях). Обнаружено сразу при первом обращении к таблице («table does not exist»), исправлено `ALTER TABLE ... SET SCHEMA public` — PK/индексы/FK не пострадали (проверено `\d`).
