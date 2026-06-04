---
type: tz
status: draft
feature: Один тариф `tier_standard` в админке — убрать legacy-CRUD Plan, доп. сотрудники по 1 000 ₽ как единственная опция; цена редактируется через AdminSetting (не ENV, не константы в коде)
date: 2026-05-31
owner: sergrv80@gmail.com
relates_to:
  - plans/tz/2026-05-27-billing-tochka-referral-dadata-z.md          # источник цены 60 000 ₽ + 1 000 ₽/seat
  - backend/src/modules/billing/services/seat.service.ts             # сейчас цена константой — переводим на AdminSetting
  - backend/src/modules/entitlements/tier-config.ts                  # tier_standard / legacy tiers
  - backend/src/modules/admin/plans/                                 # CRUD-модуль, который нужно упразднить
  - backend/src/modules/admin/settings/                              # AdminSettingsService — куда уезжает прайс
  - backend/src/common/config/typed-config.service.ts                # TypedConfigService.getDynamic — путь чтения
  - backend/scripts/migrate-entitlements-to-standard.ts              # уже есть, проверить идемпотентность
  - frontend/app/(authenticated)/admin/orgs/plans/PlansClient.tsx    # страница с тремя legacy-карточками
  - second-brain/01_projects/admin-settings.md                       # инфраструктура AdminSetting
  - plans/tz/2026-05-31-z-admin-standalone-route-group.md            # параллельное ТЗ по layout админки
---

> 📦 **АРХИВ (аудит 2026-06-04): ✅ реализовано — 95%.**
> Реализовано целиком: registry-ключи billing.*, идемпотентный seed (зарегистрирован в apply-prod-deploy), SeatService и MeetingsBalanceService переведены на async+AdminSetting с code-fallback, CRUD admin/plans свёрнут в е
> Полный разбор: `plans/analysis/2026-06-04-tz-audit-reestr-i-prioritety.md`


# ТЗ: Z-Admin / Тариф — один `tier_standard` + доп. сотрудники по 1 000 ₽, цена редактируется в кабинете super_admin

## 0. Контекст

В коде Z уже принято решение «один тариф `tier_standard` + 60 000 ₽/мес за 31 место + 1 000 ₽/мес за каждое доп. место»:

- [`backend/src/modules/entitlements/tier-config.ts:19-24`](backend/src/modules/entitlements/tier-config.ts#L19-L24) — legacy-тиры оставлены только как нерушительная совместимость.
- [`backend/src/modules/billing/services/seat.service.ts`](backend/src/modules/billing/services/seat.service.ts) — формула цены и pro-rata добавления мест.
- [`backend/scripts/migrate-entitlements-to-standard.ts`](backend/scripts/migrate-entitlements-to-standard.ts) — переводит legacy-Org в `tier_standard`.

**Две проблемы:**

1. **UI**: на `/admin/orgs/plans` ([`PlansClient.tsx`](frontend/app/(authenticated)/admin/orgs/plans/PlansClient.tsx)) до сих пор три legacy-карточки и CRUD над таблицей `Plan`.
2. **Прайс зашит в коде**: `SeatService` хранит `BASE_MONTHLY_PRICE_KOPECKS = 6_000_000`, `PER_EXTRA_SEAT_KOPECKS = 100_000`, `YEARLY_DISCOUNT_RATE = 0.8` как константы. Любая правка прайса — релиз. Это **нарушение договорённости** из [`second-brain/01_projects/admin-z-global.md:25`](second-brain/01_projects/admin-z-global.md#L25):

   > Большая часть «крутилок», которые раньше лежали в `.env` (~140 переменных), мигрирована в БД (`AdminSetting`) и редактируется через UI с history и audit.

В Z есть готовая инфраструктура [`AdminSettingsService`](backend/src/modules/admin/settings/admin-settings.service.ts) (LRU-кэш TTL 30s, Redis pub/sub инвалидация во всех процессах за <1s, история, audit, severity, reason обязателен для `high`/`destructive`) и `TypedConfigService.getDynamic<T>(adminKey, envFallbackKey?, defaultValue?)` для async-чтения с code-fallback. Аналог уже работает для ~40 порогов knowledge-core на `/admin/ai/knowledge-core`.

**Решение владельца (2026-05-31):**
- Тариф **один** — `tier_standard`.
- Единственная опция — **доп. сотрудники по 1 000 ₽/мес** (формула уже в `SeatService`).
- **Никаких других аддонов / пакетов / опций**.
- Цена и параметры пакета **редактируются super_admin через UI** (AdminSetting), а не через ENV и не релизом. С audit, history и обязательным `reason`.

## 1. Цель

После реализации:
1. Цена тарифа и стоимость доп. места живут в `AdminSetting` с category=`billing`, section=`tariff-standard`, severity=`high` (правка требует `reason`). Дефолты — code-fallback в `SeatService`.
2. `SeatService` читает значения через `TypedConfigService.getDynamic(...)` (или напрямую через `AdminSettingsService.get(...)` если внутри билинг-сервисов уже есть инжект). LRU-кэш 30s + Redis pub/sub-инвалидация гарантируют, что после правки прайса все процессы (HTTP + workers) видят новое значение за <1 секунду.
3. На `/admin/orgs/plans` показывается **одна карточка** «Стандартный тариф Z» с:
   - редактируемыми полями (через `AdminSettingField` или эквивалент) — базовая цена, цена доп. места, скидка годовой, мест включено, встреч включено, встреч за доп. место;
   - живым калькулятором — слайдер «доп. сотрудники», моментальный пересчёт месяц/год;
   - бейджем «Org на этом тарифе: N» и «Org на legacy: M ✓/⚠».
4. Никаких трёх legacy-карточек, никаких кнопок «Создать тариф», «Удалить».
5. CRUD-эндпоинты `/api/v1/admin/plans/*` упразднены. На бэке остаётся `GET /api/v1/admin/plans/current` — снимок текущего тарифа, собранный из AdminSetting + TIER_CONFIG.
6. Активные подписки (`Subscription.monthlyPriceKopecks`) **не пересчитываются** при правке прайса — там зафиксирована цена на момент покупки. Новый прайс применяется только при следующем расчёте Invoice (продление подписки / добавление мест).
7. Модель `Plan` в Prisma остаётся (фаза удаления — отдельная задача, см. §6).

## 2. Scope

**Входит:**

| Слой | Что меняется | Файлы |
|---|---|---|
| Backend / AdminSetting registry | Добавить 6 ключей `billing.*` в `admin-setting-schema-registry.ts` (Zod-схемы) | `backend/src/modules/admin/settings/admin-setting-schema-registry.ts` |
| Backend / seed | Новый `seed-admin-settings-billing.ts` — записывает дефолты в AdminSetting (идемпотентно, не перетирает админ-правки) | `backend/scripts/seed-admin-settings-billing.ts` |
| Backend / SeatService | Перевести 6 числовых констант на чтение через `TypedConfigService.getDynamic(...)`. Code-fallback = текущие константы | `backend/src/modules/billing/services/seat.service.ts` |
| Backend / SeatService API | Все методы расчёта цены становятся `async` (`calculatePricing`, `calculateMonthlyPriceKopecks`, `calculateYearlyPriceKopecks`, `calculateAddSeatsMonthlyProrata`, `calculateAddSeatsYearlyProrata`, `calculateMeetingsGrant`). Все call-site'ы — `await` | `backend/src/modules/billing/services/*`, `backend/src/modules/meetings-balance/*` |
| Backend / контроллер plans | `/api/v1/admin/plans` (CRUD) → один `GET /api/v1/admin/plans/current` (читает AdminSetting + COUNT'ы) | `backend/src/modules/admin/plans/plans.controller.ts` |
| Backend / сервис plans | Удалить CRUD-методы, оставить `getCurrentSnapshot()` | `backend/src/modules/admin/plans/plans.service.ts` |
| Backend / DTO plans | Удалить create/update DTO. Оставить `PlanSnapshotDto` (response) | `backend/src/modules/admin/plans/dto/` |
| Backend / тесты | Подправить `seat.service.spec.ts` (теперь async + мок AdminSettings), `plans.service.spec.ts` (новый API), `manual-billing.service.spec.ts` / `seat.service.spec.ts` если они дергают sync-методы | `*.spec.ts` |
| Frontend / страница | Переписать `PlansClient.tsx`: одна карточка с **редактируемыми** AdminSetting-полями + калькулятор + счётчики Org | `frontend/app/(authenticated)/admin/orgs/plans/PlansClient.tsx` (или в группе `(admin)` если параллельное layout-ТЗ уже выехало) |
| Frontend / API-слой | `admin-plans.api.ts` — оставить `getCurrent()`. Дополнительно дернуть существующий `admin-settings.api.ts` (GET/POST настроек) | `frontend/src/api/admin-plans.api.ts` |
| Frontend / domain | `admin-plan.ts` — тип `PlanSnapshotDomain` | `frontend/src/domain/admin-plan.ts` |
| Frontend / dialog | Удалить `PlanEditDialog` | `frontend/app/(authenticated)/admin/orgs/plans/PlanEditDialog.tsx` |
| Скрипты / миграция | Проверить, что `migrate-entitlements-to-standard.ts` есть в `apply-prod-deploy.ts STEPS` (phase=`migrate`, `skipBootstrap: true`). Зарегистрировать `seed-admin-settings-billing.ts` в `STEPS` (phase=`seed`) | `backend/scripts/apply-prod-deploy.ts` |
| БД / `Plan`-таблица | НЕ удаляем сейчас, помечаем комментарием `// LEGACY` в `schema.prisma` | `backend/prisma/schema.prisma` |
| ENV | Нет новых. Существующие константы остаются default'ами в `SeatService` (code-fallback) | — |

**Не входит:**
- Каталог аддонов / пакетов фич. По решению владельца — **никаких** опций кроме мест.
- Удаление модели `Plan` из Prisma — отдельным ТЗ через 2 недели prod-наблюдений.
- Перенос `/admin/*` в свою route-группу — это [параллельное ТЗ](2026-05-31-z-admin-standalone-route-group.md).
- Биллинг-флоу покупки мест (Tochka recurring) — описан в [ТЗ 2026-05-27](2026-05-27-billing-tochka-referral-dadata-z.md).
- Ретроактивный пересчёт активных Subscription — намеренно не делаем (см. §1 п.6).

## 3. Решения

### 3.1. Источник правды — AdminSetting + code-fallback

Цена тарифа выезжает из кода в БД. Это совпадает с подходом для ~40 порогов knowledge-core. Конкретно:

| Ключ AdminSetting | Тип | Default (code-fallback) | Описание |
|---|---|---|---|
| `billing.baseMonthlyKopecks` | `z.number().int().nonnegative()` | `6_000_000` | Базовая цена в копейках (60 000 ₽) |
| `billing.perExtraSeatKopecks` | `z.number().int().nonnegative()` | `100_000` | Цена доп. места в копейках (1 000 ₽) |
| `billing.yearlyDiscountRate` | `z.number().min(0).max(1)` | `0.8` | Скидка годовой подписки (0.80 = -20%) |
| `billing.baseSeatsIncluded` | `z.number().int().positive()` | `31` | Мест в базе (1 владелец + 30) |
| `billing.baseMeetingsGrant` | `z.number().int().nonnegative()` | `150` | Встреч в базе/мес |
| `billing.perExtraSeatMeetingsGrant` | `z.number().int().nonnegative()` | `5` | Встреч за каждое доп. место/мес |

Все ключи — category=`billing`, section=`tariff-standard`, severity=`high` (нужен `reason` при правке — это деньги).

`prorataDaysInMonth = 30` (стандарт SaaS-биллинга) — **остаётся константой** в `SeatService`. Это бизнес-правило формата биллинга, не цена. Не редактируется.

### 3.2. SeatService — async + getDynamic

Текущие константы становятся default'ами (code-fallback):

```ts
// seat.service.ts (новый skeleton)
import { TypedConfigService } from '@/common/config/typed-config.service';

const DEFAULT_BASE_MONTHLY_KOPECKS = 6_000_000;
const DEFAULT_PER_EXTRA_SEAT_KOPECKS = 100_000;
const DEFAULT_YEARLY_DISCOUNT_RATE = 0.8;
const DEFAULT_BASE_SEATS_INCLUDED = 31;
const DEFAULT_BASE_MEETINGS_GRANT = 150;
const DEFAULT_PER_EXTRA_SEAT_MEETINGS_GRANT = 5;
const PRORATA_DAYS_IN_MONTH = 30; // НЕ редактируется, это правило формата.

@Injectable()
export class SeatService {
  constructor(private readonly cfg: TypedConfigService) {}

  private async readPricing() {
    const [base, perSeat, yearly, seats, meet, perSeatMeet] = await Promise.all([
      this.cfg.getDynamic<number>('billing.baseMonthlyKopecks', null, DEFAULT_BASE_MONTHLY_KOPECKS),
      this.cfg.getDynamic<number>('billing.perExtraSeatKopecks', null, DEFAULT_PER_EXTRA_SEAT_KOPECKS),
      this.cfg.getDynamic<number>('billing.yearlyDiscountRate', null, DEFAULT_YEARLY_DISCOUNT_RATE),
      this.cfg.getDynamic<number>('billing.baseSeatsIncluded', null, DEFAULT_BASE_SEATS_INCLUDED),
      this.cfg.getDynamic<number>('billing.baseMeetingsGrant', null, DEFAULT_BASE_MEETINGS_GRANT),
      this.cfg.getDynamic<number>('billing.perExtraSeatMeetingsGrant', null, DEFAULT_PER_EXTRA_SEAT_MEETINGS_GRANT),
    ]);
    return { base, perSeat, yearly, seats, meet, perSeatMeet };
  }

  async calculateMonthlyPriceKopecks(seatsExtra: number): Promise<number> { ... }
  async calculateYearlyPriceKopecks(seatsExtra: number): Promise<number> { ... }
  async calculatePricing(period, seatsExtra): Promise<SubscriptionPricing> { ... }
  // и т.д.
}
```

Кэш `AdminSettingsService` (LRU TTL 30s) обеспечивает, что 6 чтений на один расчёт стоят ≈0 после первого вызова. Redis pub/sub `admin:setting:invalidate` инвалидирует кэш сразу во всех процессах (HTTP + workers/main.ts) — новый прайс видно за <1 секунду.

**Что делать с константами `BASE_MEETINGS_GRANT` / `PER_EXTRA_SEAT_MEETINGS_GRANT`** из [`meetings-balance.service.ts`](backend/src/modules/meetings-balance/meetings-balance.service.ts)? Они дублируются в `SeatService`. Решение: единый источник — AdminSetting. `MeetingsBalanceService.calculateMeetingsGrant(seatsExtra)` тоже становится async + читает через `TypedConfigService`. Re-export в `SeatService` остаётся (передаёт вызов в MeetingsBalanceService).

### 3.3. Все call-site'ы становятся async

Список мест где сейчас вызывается sync-`SeatService`:

- `backend/src/modules/billing/services/subscription.service.ts`
- `backend/src/modules/billing/services/manual-billing.service.ts`
- `backend/src/modules/billing/services/billing.service.ts`
- `backend/src/modules/billing/services/seat.service.spec.ts` (тесты)
- `backend/src/modules/meetings-balance/meetings-balance.service.ts` (re-export)
- любые другие из `grep "seatService\.\|SeatService\."` в Фазе 0.

Все становятся `await`. Если место — внутри cron'а / BullMQ worker — там async уже разрешён. Если internal pure-function — придётся протащить async вверх.

### 3.4. AdminSetting → PlanSnapshot DTO

`GET /api/v1/admin/plans/current` собирает снимок из текущих значений AdminSetting + COUNT'ы:

```ts
// PlanSnapshotDto
{
  tier: 'tier_standard',
  displayName: 'Стандартный',
  description: 'Единый тариф Z. Все фичи Z.',
  base: {
    monthlyPriceRub: 60000,        // из AdminSetting / 100
    monthlyPriceKopecks: 6000000,  // из AdminSetting
    seatsIncluded: 31,
    meetingsIncludedPerMonth: 150,
  },
  extraSeat: {
    monthlyPriceRubPerSeat: 1000,
    monthlyPriceKopecksPerSeat: 100000,
    meetingsPerSeat: 5,
  },
  yearly: {
    discountPercent: 20,           // (1 - yearlyDiscountRate) * 100
    monthlyEquivalentRub: 48000,
    fullYearRub: 576000,
  },
  features: TIER_CONFIG['tier_standard'].features,   // ВСЁ ещё в коде — это набор фич, не цена
  quotas:   TIER_CONFIG['tier_standard'].quotas,
  orgsUsingCount: 42,
  legacyOrgsRemainingCount: 0,
  // Метаданные настроек — чтобы UI знал что показывать как редактируемые поля
  editableSettings: [
    { key: 'billing.baseMonthlyKopecks', currentValue: 6000000, severity: 'high' },
    { key: 'billing.perExtraSeatKopecks', currentValue: 100000, severity: 'high' },
    { key: 'billing.yearlyDiscountRate', currentValue: 0.8, severity: 'high' },
    { key: 'billing.baseSeatsIncluded', currentValue: 31, severity: 'high' },
    { key: 'billing.baseMeetingsGrant', currentValue: 150, severity: 'high' },
    { key: 'billing.perExtraSeatMeetingsGrant', currentValue: 5, severity: 'high' },
  ],
}
```

Набор фич (`TIER_CONFIG['tier_standard'].features`) — это **отдельное** решение архитектора (все true), не «цена», поэтому остаётся в коде. Можно вынести и его в AdminSetting позже, отдельным ТЗ — но не в этой волне.

### 3.5. UI «Тариф» — одна карточка с редактируемыми полями

Грубо вёрстка (Tailwind + paired tokens из feedback memory `feedback_paired_color_tokens.md`):

```
┌─────────────────────────────────────────────────────────────────────┐
│ Стандартный тариф Z                                                 │
│ Единый тариф. Цена редактируется здесь. История — кнопка снизу.     │
│                                                                     │
│ ── Параметры пакета (редактируется super_admin) ──────────────────  │
│  Базовая цена за месяц       [ 60 000 ] ₽                           │
│  Цена доп. сотрудника        [  1 000 ] ₽                           │
│  Скидка годовой подписки     [    20  ] %                           │
│  Мест включено               [    31  ]                             │
│  Встреч включено в месяц     [   150  ]                             │
│  Встреч за доп. сотрудника   [     5  ] /мес                        │
│                                                                     │
│  При сохранении любого поля — диалог «Причина изменения» (reason)   │
│  обязателен, severity=high. История изменений — кнопка ниже.        │
│                                                                     │
│ ── Калькулятор ─────────────────────────────────────────────────────│
│  Доп. сотрудников: [   5   ]   (slider 0..1000)                     │
│  → Месяц:  65 000 ₽    ·    Год (−20%): 52 000 ₽/мес (624 000 ₽/год)│
│                                                                     │
│ ── Что включено в Z (фичи) ─────────────────────────────────────────│
│  ✓ AI-отчёт по типу встречи                                         │
│  ✓ Карточки / темы / граф                                           │
│  ✓ Дашборд CEO, Concierge                                           │
│  …                                                                  │
│  (набор фич зашит в коде — TIER_CONFIG, изменение требует релиза)   │
│                                                                     │
│ ── Org ─────────────────────────────────────────────────────────────│
│  На текущем тарифе: 42                                              │
│  На legacy-тарифах: 0  ✓                                            │
│                                                                     │
│ [ История правок прайса (50 последних) ]                            │
└─────────────────────────────────────────────────────────────────────┘
```

Поля используют существующий `AdminSettingField` (тот, что работает на `/admin/ai/knowledge-core`). Калькулятор пересчитывается на клиенте по текущему снимку (не по «зеркалу констант»). После save AdminSetting — рефреш карточки.

### 3.6. Активные подписки — НЕ пересчитываем

`Subscription.monthlyPriceKopecks` фиксируется на момент покупки/продления. При правке `billing.baseMonthlyKopecks` в AdminSetting — активные подписки **не** трогаем. Новая цена применится при следующем `BillingCycleCron` для продления.

В UI карточки явно напишем:

> Правка прайса применяется к новым счетам и продлениям. Активные подписки сохраняют цену на момент покупки. Чтобы применить новую цену к конкретной Org — пересоздать подписку через `/admin/orgs/[id]/billing`.

Это важно зафиксировать в DoD, чтобы случайно не повесить ретро-пересчёт на backfill-скрипт.

### 3.7. Что делать со старыми Plan-записями в БД

Решение из предыдущей версии ТЗ — без изменений: модель `Plan` остаётся в schema.prisma с комментарием `// LEGACY`, физическое удаление — отдельным ТЗ через 2 недели.

## 4. Фазы

### Фаза 0. Аудит зависимостей. `[ ]`
1. `grep -RIn "prisma\.plan\.\|PlanCreateInput\|PlanUpdateInput" backend/src` — убедиться, что `Plan` не используется вне `admin/plans/`.
2. `grep -RIn "model Plan\|planId\|@relation.*Plan" backend/prisma/schema.prisma` — нет FK.
3. `grep -RIn "seatService\.\|new SeatService\|SeatService\." backend/src` — собрать полный список call-site'ов.
4. `grep -RIn "BASE_MONTHLY_PRICE_KOPECKS\|PER_EXTRA_SEAT_KOPECKS\|YEARLY_DISCOUNT_RATE\|BASE_MEETINGS_GRANT\|PER_EXTRA_SEAT_MEETINGS_GRANT" backend/src` — найти все прямые импорты констант. Они **должны** уйти.
5. Зафиксировать вывод в комментарии к коммиту.

### Фаза 1. AdminSetting registry + seed. `[ ]`
1. В `backend/src/modules/admin/settings/admin-setting-schema-registry.ts` добавить 6 ключей `billing.*` с Zod-схемами по таблице §3.1.
2. Создать `backend/scripts/seed-admin-settings-billing.ts` — идемпотентно пишет дефолты только если ключа нет (НЕ перетирает админ-правки). Использует `createPrismaClient` из `_lib/prisma.ts`.
3. Зарегистрировать seed в `apply-prod-deploy.ts STEPS` с `phase: 'seed'`.
4. Локально: `bun run scripts/seed-admin-settings-billing.ts` — заводит 6 записей в AdminSetting (category=`billing`, section=`tariff-standard`, severity=`high`).

### Фаза 2. SeatService → async + AdminSetting. `[ ]`
1. Инжект `TypedConfigService` в `SeatService`.
2. Переписать все методы расчёта цены и гранта встреч на async + `getDynamic(...)`. Code-fallback = текущие константы.
3. Удалить экспорт `export const BASE_MONTHLY_PRICE_KOPECKS = …` (он не должен быть импортируем за пределами SeatService — единственный путь чтения это сервис).
4. `MeetingsBalanceService.calculateMeetingsGrant` тоже становится async + читает из AdminSetting.
5. Тесты `seat.service.spec.ts` — переписать на async + мок `TypedConfigService.getDynamic` возвращает фейк-значения.

### Фаза 3. Все call-site'ы — await. `[ ]`
По списку из Фазы 0 шаг 3:
1. `subscription.service.ts`, `manual-billing.service.ts`, `billing.service.ts` — заменить sync-вызовы на `await`.
2. Все cron'ы / workers — async уже разрешён.
3. Если в каком-то месте sync-контекст (например, синхронный builder) — поднять async вверх. Глобально это всё контроллер-уровня (HTTP/BullMQ), там async есть.
4. Тесты `manual-billing.service.spec.ts`, `subscription.service.spec.ts` — поправить моки.

### Фаза 4. Backend — упразднение CRUD `admin/plans`. `[ ]`
1. `plans.controller.ts` — оставить **один** `GET /api/v1/admin/plans/current`. Удалить POST/PATCH/DELETE.
2. `plans.service.ts` — `getCurrentSnapshot()` собирает DTO по §3.4 (читает значения через `AdminSettingsService.getMany([...])`, считает 2 COUNT'а по `OrgEntitlement`, дёргает `SeatService.calculatePricing(0)` для базовой строки).
3. `plans.module.ts` — импортирует `BillingModule` + `AdminSettingsModule`.
4. `dto/plan-snapshot.dto.ts` — Zod-схема по §3.4. Удалить create/update DTO.
5. Тесты `plans.service.spec.ts` — переписать.

### Фаза 5. Frontend — переписать страницу. `[ ]`
1. `admin-plans.api.ts` — оставить `getCurrent(): Promise<PlanSnapshotDto>`. Удалить `create/update/remove/list`.
2. `admin-plan.ts` (domain) — `PlanSnapshotDomain` + маппер.
3. `PlansClient.tsx` — переписать по макету §3.5:
   - Грузит снимок через `useAdminQuery`.
   - 6 редактируемых полей через **существующий** `AdminSettingField` (или эквивалент, такой же как на `/admin/ai/knowledge-core`).
   - Калькулятор — state `seatsExtra: number`, считает цену на клиенте по значениям из снимка (НЕ зеркальные константы).
   - После каждого save AdminSetting — refetch снимка (или live-update через WebSocket если он уже есть; иначе refetch).
   - Кнопка «История правок прайса» открывает модалку, дёргающую `GET /api/v1/admin/settings/billing.baseMonthlyKopecks/history` (и так далее для каждого ключа, или агрегированную ручку, если она есть).
4. Удалить `PlanEditDialog.tsx`.
5. Заголовок в навигации — «Тариф» (единственное число).

### Фаза 6. Документация и комментарии. `[ ]`
1. В `schema.prisma` над `model Plan` добавить комментарий LEGACY (см. §3.7).
2. В `second-brain/01_projects/admin-settings.md` добавить section про `billing.*` ключи.
3. В `second-brain/01_projects/admin-z-global.md` обновить запись про раздел «Тарифы».
4. В `seat.service.ts` — заголовочный JSDoc обновить: «значения читаются из AdminSetting, дефолты — константы DEFAULT_*».

### Фаза 7. Сборка и верификация. `[ ]`
1. Backend: `bun run typecheck && bun run lint && bun run test:unit && bun run test:integration`.
2. Frontend: `bun run typecheck && bun run lint && bun run build && bun run test:unit`.
3. В dev:
   - Открыть `/admin/orgs/plans` — одна карточка, 6 редактируемых полей.
   - Поменять `billing.baseMonthlyKopecks` на 70 000 ₽, ввести reason — сохранилось, history показывает запись.
   - В калькуляторе при seatsExtra=0 — теперь 70 000 ₽/мес.
   - `Subscription` существующих Org — `monthlyPriceKopecks` не изменилось (ретро-пересчёта нет).
   - `GET /api/v1/admin/plans/current` — JSON по §3.4.
4. Старые CRUD — `POST /api/v1/admin/plans` отвечает 404.

## 5. Файлы

```
backend/
  src/modules/admin/settings/
    admin-setting-schema-registry.ts     UPDATED — +6 ключей billing.*
  src/modules/admin/plans/
    plans.controller.ts                  UPDATED — CRUD → один GET /current
    plans.service.ts                     UPDATED — getCurrentSnapshot()
    plans.service.spec.ts                UPDATED
    plans.module.ts                      UPDATED — импорт AdminSettingsModule
    dto/
      plan-snapshot.dto.ts               NEW
      plan-list.dto.ts                   DELETED
      plan-create.dto.ts                 DELETED
      plan-update.dto.ts                 DELETED
  src/modules/billing/services/
    seat.service.ts                      UPDATED — async + getDynamic
    seat.service.spec.ts                 UPDATED — async + мок cfg
    subscription.service.ts              UPDATED — await SeatService
    manual-billing.service.ts            UPDATED — await SeatService
    billing.service.ts                   UPDATED — await SeatService
    manual-billing.service.spec.ts       UPDATED
  src/modules/meetings-balance/
    meetings-balance.service.ts          UPDATED — async + getDynamic
    meetings-balance.service.spec.ts     UPDATED
  prisma/schema.prisma                   UPDATED — // LEGACY над `model Plan`
  scripts/
    seed-admin-settings-billing.ts       NEW — idempotent seed дефолтов
    apply-prod-deploy.ts                 UPDATED — +STEP seed-admin-settings-billing, проверить migrate-entitlements

frontend/
  app/(authenticated)/admin/orgs/plans/  (или (admin)/admin/... после layout-ТЗ)
    page.tsx                             UNCHANGED — рендерит <PlansClient />
    PlansClient.tsx                      REWRITTEN — одна карточка + AdminSettingField + калькулятор
    PlanEditDialog.tsx                   DELETED
  src/
    api/admin-plans.api.ts               UPDATED — оставить getCurrent()
    domain/admin-plan.ts                 UPDATED — PlanSnapshotDomain
```

## 6. Риски и mitigations

| Риск | Mitigation |
|---|---|
| В таблице `Plan` есть FK от какой-то модели, и удаление CRUD сломает что-то | Фаза 0 — explicit grep + проверка schema.prisma; модель не удаляем, только UI/CRUD-эндпоинты |
| Где-то в коде `import { BASE_MONTHLY_PRICE_KOPECKS } from 'seat.service'` — после удаления экспорта tsc упадёт | Фаза 0 шаг 4 — собрать список заранее, поправить в Фазе 2 |
| SeatService становится async — sync-call-site не компилируется | tsc найдёт всё. Если где-то sync обязательно (например, builder без async) — поднять async вверх. По текущему grep — все вызовы либо в HTTP-хендлере, либо в cron, async везде доступен |
| Кэш AdminSetting (TTL 30s) даёт лаг между правкой и применением для новых Invoice | Redis pub/sub `admin:setting:invalidate` инвалидирует кэш во всех процессах за <1s — это уже работает для knowledge-core. Лаг 30s проявится только если Redis pub/sub отвалился; это уже мониторится по `/admin/health` |
| Случайный ретро-пересчёт активных Subscription (баг) | DoD §8 явный пункт; e2e-тест: после правки прайса проверить что Subscription.monthlyPriceKopecks существующих не поменялся |
| Прод-Org остались на legacy-tier | Бейдж в карточке + CLI-скрипт `migrate-entitlements-to-standard.ts`. EntitlementService уже fail-safe деградирует к tier_basic, ничего критичного не сломается |
| Кто-то в frontend дергает `adminPlansApi.list/create/update/remove` после удаления | Фаза 5 шаг 1 — grep `adminPlansApi\.` перед удалением методов |
| Прайс случайно введён неправильно (опечатка super_admin) | severity=`high` → обязательный `reason` + history. Откат — кнопка «Откатить к предыдущему» в history или повторная правка |

## 7. Prod-deploy-log — что обновить

Запись в [`docs/operations/prod-deploy-log.md`](../../docs/operations/prod-deploy-log.md):

```
### 🌊 2026-05-31 — Z-Admin / Тариф → один tier_standard + цена в AdminSetting

План: plans/tz/2026-05-31-admin-plans-collapse-to-standard.md.

**Изменения:**
- Backend: `/api/v1/admin/plans` CRUD → один GET /current.
- Backend: `SeatService` и `MeetingsBalanceService` стали async, читают цену
  из AdminSetting через `TypedConfigService.getDynamic(...)` с code-fallback.
- AdminSetting: 6 новых ключей `billing.*` (severity=high).
- Frontend: страница `/admin/orgs/plans` переписана — одна карточка
  «Стандартный» с редактируемыми полями + калькулятор «доп. сотрудники по 1 000 ₽».
- Prisma: `model Plan` остаётся, помечен `// LEGACY`. Физическое удаление —
  отдельным ТЗ через 2 недели.

**Шаги прод-инструкции:**

- **Шаг 1 — ENV** — без новых.
- **Шаг 4 — Prisma** — комментарий в schema.prisma → no-op для Postgres.
  ```bash
  docker compose exec backend bun run prisma:generate
  ```
- **Шаг 7 — Seed AdminSetting billing.*** — обязательно:
  ```bash
  docker compose exec backend bun run scripts/seed-admin-settings-billing.ts
  ```
  Идемпотентен. Заводит 6 ключей `billing.*` с дефолтами 60 000 ₽ / 1 000 ₽ /
  20% / 31 / 150 / 5. Если ключ уже есть — пропускает (защищает админ-правки).
  Уже зарегистрирован в `apply-prod-deploy.ts STEPS` (phase=seed).

- **Шаг 9 — Migrate legacy tiers** — если в прод остались Org на
  `tier_basic`/`tier_pro`/`tier_enterprise`:
  ```bash
  docker compose exec backend bun run scripts/migrate-entitlements-to-standard.ts --dry-run
  docker compose exec backend bun run scripts/migrate-entitlements-to-standard.ts
  ```
  Идемпотентно. Если legacy-Org нет — скажет «Нет legacy-tier записей».

- **Шаг 11 — Docker image rebuild** — обязательно:
  ```bash
  docker compose up -d --build backend frontend
  ```

- **Шаг 12 — Smoke**:
  ```bash
  # 1. GET снимка тарифа
  curl -i -H 'Cookie: <super_admin_session>' -H 'X-Org-Id: <orgId>' \
       https://prod.host/api/v1/admin/plans/current
  # Ожидаемо: 200 { tier:'tier_standard', base:{ monthlyPriceRub:60000 }, … }

  # 2. AdminSetting инвалидация через POST + GET
  curl -i -X POST -H 'Cookie: <super_admin_session>' \
       -H 'Content-Type: application/json' \
       -d '{"value":7000000,"reason":"тест: подняли цену на 16%"}' \
       https://prod.host/api/v1/admin/settings/billing.baseMonthlyKopecks
  # затем
  curl -i -H 'Cookie: <super_admin_session>' \
       https://prod.host/api/v1/admin/plans/current
  # Ожидаемо: base.monthlyPriceRub = 70000

  # 3. Активные Subscription не пересчитались
  docker compose exec backend bun run -e '
    import { PrismaClient } from "@prisma/client";
    const p = new PrismaClient();
    p.subscription.findMany({ where: { status: "active" }, select: { id:true, monthlyPriceKopecks:true } })
      .then(r => { console.log(r); return p.$disconnect(); });
  '
  # Ожидаемо: monthlyPriceKopecks у уже активных не изменился.

  # 4. Старые CRUD-эндпоинты отвечают 404
  curl -i -H 'Cookie: <super_admin_session>' -X POST https://prod.host/api/v1/admin/plans
  # Ожидаемо: 404 (или 405)

  # 5. UI /admin/orgs/plans: одна карточка, 6 редактируемых полей,
  #    калькулятор работает, history открывается.
  ```

- **Откат:**
  ```bash
  git revert <hash>
  docker compose up -d --build backend frontend
  ```
  Записи AdminSetting `billing.*` остаются — это не ломает старый код
  (он на них не смотрел). Миграция OrgEntitlement (если запускалась) необратима
  без бэкапа, но безопасна (legacy tiers были подмножеством tier_standard).
```

## 8. Definition of Done

- [ ] Фаза 0: `grep` подтвердил отсутствие FK на `Plan`, собран полный список call-site'ов `SeatService` и прямых импортов констант.
- [ ] 6 ключей `billing.*` зарегистрированы в `admin-setting-schema-registry.ts`.
- [ ] `seed-admin-settings-billing.ts` создан, идемпотентен, зарегистрирован в `apply-prod-deploy.ts STEPS`.
- [ ] `SeatService` и `MeetingsBalanceService` — async, читают через `TypedConfigService.getDynamic`. Прямой экспорт констант удалён.
- [ ] Все call-site'ы используют `await`. `bun run typecheck` зелёный.
- [ ] `/api/v1/admin/plans/*` свёрнут в один `GET /current`. Старые CRUD-эндпоинты возвращают 404.
- [ ] Frontend: `/admin/orgs/plans` показывает одну карточку «Стандартный», 6 редактируемых полей через `AdminSettingField`, калькулятор работает, история открывается.
- [ ] **E2E-тест на ретро-пересчёт:** после правки `billing.baseMonthlyKopecks` существующие `Subscription.monthlyPriceKopecks` не изменились (новая цена применяется только при следующем продлении / создании Invoice).
- [ ] Live-инвалидация: правка прайса через POST `/api/v1/admin/settings/...` — на HTTP-инстансе и workers/main.ts новый прайс виден за <1 секунду (LRU + Redis pub/sub).
- [ ] `bun run typecheck && bun run lint && bun run test:unit && bun run test:integration` зелёные на обоих сторонах.
- [ ] Запись в `docs/operations/prod-deploy-log.md` добавлена (§7).
- [ ] Затронутые заметки `second-brain/`: `01_projects/admin-z-global.md`, `01_projects/admin-settings.md`, при необходимости `02_architecture/module-map.md` — обновлены.

## Итог

Реализовано: нет. ТЗ создано, ожидает реализации.
