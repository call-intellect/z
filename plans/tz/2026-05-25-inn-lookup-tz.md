---
type: tz
status: draft
feature: Интеграция с API по ИНН (Dadata / Контур.Фокус) для автозаполнения реквизитов компании и верификации реферала
date: 2026-05-25
owner: sergrv80@gmail.com
relates_to:
  - plans/analysis/2026-05-25-billing-and-referrals.md
  - plans/tz/2026-05-25-billing-and-referrals-tz.md
  - plans/tz/2026-05-25-demo-mode-tz.md
  - backend/src/common/config/env.schema.ts
  - backend/src/common/config/typed-config.service.ts
  - backend/prisma/schema.prisma
---

# ТЗ: Интеграция с API по ИНН (inn-lookup)

> Анализ: `plans/analysis/2026-05-25-billing-and-referrals.md` (части 2.1, 3.2, 8.7).
>
> Это **ТЗ #3** из списка реализации (часть 10 анализа). Зависимостей по порядку нет — может идти параллельно с ТЗ #1 (billing-and-referrals) и ТЗ #2 (demo-mode). ТЗ #1 потребляет этот сервис через интерфейс `InnLookupService.lookup(inn)`.

## Цель

После реализации backend по ИНН подтягивает реквизиты юрлица/ИП/самозанятого через единый сервис `InnLookupService` с переключаемым провайдером (Dadata / Контур.Фокус / Mock), кэшем в Redis на 30 дней и fallback'ом на ручной ввод; этот сервис используется в форме регистрации компании (онбординг) и в форме «Стать рефералом».

## Scope

**Входит:**
- Новый модуль `backend/src/modules/inn-lookup/` со структурой:
  - `InnLookupModule` (NestJS, регистрируется в `app.module.ts`).
  - `InnLookupService` (фасад с DI-инъекцией адаптера, кэшем и метриками).
  - Адаптеры: `DadataAdapter`, `KonturFocusAdapter`, `MockAdapter` (по интерфейсу `InnLookupAdapter`).
  - `InnLookupController` (`POST /api/v1/inn-lookup`, `CookieAuthGuard`, rate-limit).
  - DTO через `nestjs-zod`: `InnLookupRequestDto`, `InnLookupResponseDto`.
- Унифицированный TypeScript-контракт `InnLookupResult` (см. ниже §4).
- Кэш в Redis с ключом `inn-lookup:<inn>` и TTL 30 дней (через `IORedis`, который уже инжектируется глобально).
- Метрики через `prom-client`: `inn_lookup_requests_total{provider, status, cache}`, `inn_lookup_latency_seconds{provider}`.
- Логи через pino: только статус и длительность, **без** токенов провайдера и **без** полного `raw`-ответа в обычных логах (только debug-level и только в dev).
- Rate-limiting на `POST /api/v1/inn-lookup`: 30 запросов в минуту на пользователя (через существующий механизм throttling).
- ENV-переменные в `env.schema.ts` и геттер `cfg.innLookup` в `TypedConfigService`.
- Frontend:
  - Хук `useInnLookup(inn: string)` (с debounce 500 ms, отменой устаревших запросов через `AbortController`).
  - Компонент `<InnInput>` с валидацией формата (10 цифр — юрлицо, 12 цифр — физлицо/ИП/самозанятый) и автозаполнением соседних полей формы.
  - Интеграция компонента в форму регистрации Org (онбординг) и в форму «Стать рефералом» в `/referrals`.
- DoD для каждой фазы.

**Не входит:**
- Сама форма регистрации Org и FSM подписки — это ТЗ #1 (`2026-05-25-billing-and-referrals-tz.md`). В этом ТЗ — только сервис и UI-компонент; ТЗ #1 их подключает.
- Сама модель `Referral`, `Subscription`, `Org.inn/ogrn/kpp/...` — это ТЗ #1. В этом ТЗ только описан контракт, что они вызывают `innLookupService.lookup(...)`.
- Демо-режим — ТЗ #2.
- Платёжный провайдер — отдельное ТЗ #4.
- Реальная коммерческая интеграция с конкретным провайдером (закупка ключа, договор) — операционная задача владельца, ТЗ описывает только техническую обвязку.

## Выбор провайдера

Сравнительная таблица (числа взяты по публичным тарифам на 2026-05; перед закупкой — уточнить у владельца, цифры быстро устаревают).

| Параметр | Dadata | Контур.Фокус |
|---|---|---|
| Стоимость подсказок по ИНН (suggest) | от 0 ₽ / 10 000 запросов в день на бесплатном плане, далее ~3 000 ₽ / 100 000 запросов | от ~25 000 ₽ / месяц за пакет (минимум) |
| Стоимость глубокой проверки (findById + полные реквизиты) | входит в подсказки, тот же тариф | оплачивается отдельно по тарифу «Фокус.API» |
| Лимиты бесплатного плана | 10 000 запросов/сутки на тест-ключ | бесплатного нет, только триал по запросу |
| Полнота данных для юрлица | название, ОГРН, КПП, юр.адрес, директор, статус (active/liquidated/reorganized), ОКВЭДы, учредители | то же + расширенные финансовые данные, арбитражные дела, госконтракты, риски |
| Полнота данных для ИП | ФИО, ОГРНИП, статус, ОКВЭДы | то же + риски, контракты |
| Полнота данных для самозанятого / физлица | только ИНН-валидация (физлица в подсказках нет), отдельный endpoint «проверка статуса самозанятого» через ФНС-партнёрский шлюз | проверка статуса самозанятого через ФНС, частично платно |
| Качество и стабильность API | стандарт де-факто рынка РФ, обширная документация, JSON, HTTP, ключи в header, sandbox-токен | устаревший SOAP в части эндпойнтов, новый REST в Фокус.API, документация менее удобна |
| Поддержка SDK | официальных нет, но десятки community-обёрток | официальные библиотеки только для 1С |
| Vendor lock-in | средний (API стабильный, формат ответа меняется редко) | средний/высокий (часть данных доступна только у них — финансы, аресты) |

**Рекомендация — Dadata** для MVP по трём причинам:
1. Бесплатный тест-ключ на 10 000 запросов/сутки позволяет начать разработку и пилот без бюджета и договора.
2. Это стандарт де-факто среди российских SaaS, риск vendor lock-in ниже, чем у Контур.Фокус, — кто угодно из конкурентов писал интеграцию.
3. Для наших задач (автозаполнение реквизитов при регистрации + базовая верификация реферала) хватает «suggest by INN». Глубокая аналитика рисков, арбитражные дела, финансы — не нужны (если когда-нибудь понадобятся — переключим адаптер).

Контур.Фокус оправдан, если бизнес позже захочет автоматический скоринг клиентов/контрагентов (банкротства, аресты, госконтракты). Это **не входит** в MVP биллинга и рефералов.

**Honest disclaimer.** Точные текущие тарифы и лимиты нужно подтвердить у владельца перед закупкой ключа — публичные оферты у обоих провайдеров пересматриваются 1–2 раза в год. ТЗ нейтрально к выбору: переключение делается через `INN_LOOKUP_PROVIDER` без изменений в бизнес-коде.

## Унифицированный контракт

Все адаптеры обязаны возвращать значение типа `InnLookupResult`. Это контракт между сервисом и его потребителями — переключение провайдера не должно ломать бизнес-логику в `billing` и `referrals`.

```typescript
/** Тип субъекта по ИНН. */
export type InnLookupKind =
  | 'individual'        // физлицо без статуса (10 + 2 контрольных = 12 цифр), редко
  | 'self_employed'     // самозанятый (ИНН 12 цифр, плательщик НПД)
  | 'sole_proprietor'   // индивидуальный предприниматель (12 цифр, ОГРНИП)
  | 'legal_entity';     // юрлицо (10 цифр, ОГРН, КПП)

/** Статус организации в реестре. */
export type InnLookupStatus = 'active' | 'liquidated' | 'reorganized' | 'unknown';

/** Идентификатор провайдера для контроля cache hit. */
export type InnLookupProvider = 'dadata' | 'kontur_focus' | 'mock';

/** Унифицированный ответ. */
export interface InnLookupResult {
  /** Исходный ИНН (нормализован: только цифры). */
  inn: string;
  /** Категория субъекта. */
  kind: InnLookupKind;
  /** ФИО для физ./ИП/самозанятого, полное название для юрлица. */
  fullName: string;
  /** Краткое название (только для юрлица, например «ООО Ромашка»). */
  shortName?: string;
  /** ОГРН (для юрлица) или ОГРНИП (для ИП). */
  ogrn?: string;
  /** КПП — только для юрлица. */
  kpp?: string;
  /** Юридический адрес одной строкой (как пришло от провайдера). */
  legalAddress?: string;
  /** ФИО директора — только для юрлица. */
  directorName?: string;
  /** Статус в реестре. */
  status: InnLookupStatus;
  /** Полный ответ провайдера (для audit и отладки, в кэш не пишется в открытом виде логов). */
  raw: Record<string, unknown>;
  /** Время фактического запроса к провайдеру (не cache hit), ISO-8601. */
  fetchedAt: string;
  /** Идентификатор провайдера, ответившего на запрос. */
  provider: InnLookupProvider;
}
```

Интерфейс адаптера:

```typescript
export interface InnLookupAdapter {
  readonly provider: InnLookupProvider;
  lookup(inn: string): Promise<InnLookupResult>;
}
```

Сервис-фасад `InnLookupService`:

```typescript
export interface InnLookupService {
  /** Основная точка входа. Сначала кэш, потом активный адаптер. */
  lookup(inn: string): Promise<InnLookupResult>;
  /** Принудительный инвалидейт ключа (по запросу из админки). */
  invalidate(inn: string): Promise<void>;
}
```

## Безопасность

1. **Токены провайдеров** — только через ENV (`INN_LOOKUP_DADATA_TOKEN`, `INN_LOOKUP_KONTUR_TOKEN`). Никогда не коммитятся в репозиторий. В тестах и dev используется `MockAdapter` (`INN_LOOKUP_PROVIDER=mock`). В логах токены **никогда не появляются**, даже в debug-level.
2. **Rate-limit на эндпоинт.** `POST /api/v1/inn-lookup` — не более **30 запросов в минуту на пользователя** (ключ throttler — `userId` из cookie-сессии, fallback — IP). При превышении — `429 Too Many Requests`. Лимит регулируется ENV `INN_LOOKUP_RATE_LIMIT_PER_MIN`.
3. **Логи.** Через `pino`. На уровне `info`: `provider`, `cache_hit|cache_miss`, `status_code`, `duration_ms`, последние 4 цифры ИНН (`****1234`). На уровне `debug`: дополнительно нормализованный ответ `InnLookupResult` без поля `raw`. **Поле `raw` не логируется никогда** — оно хранится только в кэше и БД (см. ТЗ #1, `Referral.payoutDetails`).
4. **Кэш-инвалидация по запросу.** `InnLookupService.invalidate(inn)` доступен (а) программно — из `referrals`/`billing`, если бизнес-логика требует, и (б) через админский эндпоинт `DELETE /api/v1/admin/inn-lookup/cache/:inn` (`owner`/`admin`, через существующий `RolesGuard`). Действие пишется в `AuditLog` с типом `INN_LOOKUP_CACHE_INVALIDATED`.
5. **Валидация формата ИНН** — до запроса к провайдеру:
   - только цифры, длина 10 (юрлицо) или 12 (физ./ИП/самозанятый);
   - проверка **контрольной суммы** ИНН (стандартный алгоритм ФНС) — на бэке и на фронте.
   - Невалидный формат → `400 Bad Request` без вызова провайдера и без записи в кэш.
6. **SSRF и timeouts.** HTTP-вызовы к провайдеру через общий `undici`-клиент с явным таймаутом `INN_LOOKUP_TIMEOUT_MS` (default 5000) и максимум 1 retry с экспоненциальным backoff (только на сетевые ошибки и 5xx). 4xx — не retry.
7. **Audit.** Все вызовы `lookup` в контексте регистрации Org или верификации реферала пишутся в `AuditLog` (по требованию ТЗ #1) с пометкой `INN_LOOKUP_PERFORMED { inn_last4, provider, cache_hit, status }`. Сам полный ИНН в audit не пишется (PII-минимизация).

## Кэширование

1. **Ключ Redis:** `inn-lookup:<inn>` (`inn` уже нормализован — только цифры).
2. **TTL:** 30 дней через ENV `INN_LOOKUP_CACHE_TTL_DAYS` (default 30). В Redis выставляется как `EX <ttl_seconds>`.
3. **Cache hit / miss** считаются в метриках:
   - `inn_lookup_requests_total{provider, status, cache="hit"}`
   - `inn_lookup_requests_total{provider, status, cache="miss"}`
4. **Сериализация:** `JSON.stringify(InnLookupResult)`. Десериализация через zod-схему `InnLookupResultSchema` — если форма в кэше устарела (миграция полей), запись считается невалидной, удаляется, идёт fresh-запрос к провайдеру.
5. **Контроль провайдера в кэше.** Поле `provider` в `InnLookupResult` сравнивается с активным `cfg.innLookup.provider`. Если **не совпадает** — cache hit не засчитывается, идёт fresh-запрос, новый ответ перезаписывает запись. Это даёт корректное поведение при смене провайдера в ENV (например, миграция с Dadata на Контур.Фокус) — данные постепенно подменятся естественным обновлением, без массовой инвалидации.
6. **Защита от двойного запроса (cache stampede)** — при cache miss параллельные запросы по одному ИНН проходят через `Redlock`-замок `inn-lookup:lock:<inn>` (TTL 5 секунд). Второй и далее ждут результат первого через `BLPOP` на канале результата или просто `setTimeout(50ms) + retry GET`. Решение — простой Redlock + retry GET (без pub/sub), реализуется в ~30 строках.

## ENV-переменные

Добавить новую zod-схему в `backend/src/common/config/env.schema.ts`:

```typescript
const InnLookupSchema = z.object({
  /** Активный адаптер. На dev и в тестах — 'mock'. */
  INN_LOOKUP_PROVIDER: z.enum(['dadata', 'kontur_focus', 'mock']).default('mock'),
  /** Токен Dadata (https://dadata.ru/). Обязателен при INN_LOOKUP_PROVIDER=dadata. */
  INN_LOOKUP_DADATA_TOKEN: z.string().optional(),
  /** Secret для глубоких запросов в Dadata — пока не используем, поле зарезервировано. */
  INN_LOOKUP_DADATA_SECRET: z.string().optional(),
  /** Базовый URL Dadata (sandbox для тестов: https://suggestions.dadata.ru/suggestions/api/4_1/rs). */
  INN_LOOKUP_DADATA_BASE_URL: z.string().url().default('https://suggestions.dadata.ru/suggestions/api/4_1/rs'),
  /** Токен Контур.Фокус — Фокус.API. Обязателен при INN_LOOKUP_PROVIDER=kontur_focus. */
  INN_LOOKUP_KONTUR_TOKEN: z.string().optional(),
  INN_LOOKUP_KONTUR_BASE_URL: z.string().url().default('https://focus-api.kontur.ru/api3'),
  /** Таймаут одного HTTP-запроса к провайдеру. */
  INN_LOOKUP_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  /** Срок жизни записи в кэше (дни). */
  INN_LOOKUP_CACHE_TTL_DAYS: z.coerce.number().int().positive().default(30),
  /** Rate-limit на пользователя на эндпоинт POST /api/v1/inn-lookup. */
  INN_LOOKUP_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(30),
});
```

Подмержить в общую схему через `.merge(InnLookupSchema)` (по образцу остальных групп).

Геттер `cfg.innLookup` в `TypedConfigService` (по образцу `cfg.ai`, `cfg.knowledgeCore`):

```typescript
get innLookup() {
  return {
    provider: this.get('INN_LOOKUP_PROVIDER'),
    dadataToken: this.get('INN_LOOKUP_DADATA_TOKEN'),
    dadataBaseUrl: this.get('INN_LOOKUP_DADATA_BASE_URL'),
    konturToken: this.get('INN_LOOKUP_KONTUR_TOKEN'),
    konturBaseUrl: this.get('INN_LOOKUP_KONTUR_BASE_URL'),
    timeoutMs: this.get('INN_LOOKUP_TIMEOUT_MS'),
    cacheTtlDays: this.get('INN_LOOKUP_CACHE_TTL_DAYS'),
    rateLimitPerMin: this.get('INN_LOOKUP_RATE_LIMIT_PER_MIN'),
  } as const;
}
```

Дополнительная валидация runtime: если `provider === 'dadata'`, токен `INN_LOOKUP_DADATA_TOKEN` обязателен — проверка в конструкторе `InnLookupModule` через `OnModuleInit`. Аналогично для Контур.Фокус. Падаем при старте с понятной ошибкой, а не на первом запросе.

## Фазы реализации

### Фаза 1 — ENV-конфиг, скелет модуля, интерфейс адаптера

Цель: безопасно влить структуру модуля без активной интеграции с провайдерами.

- Добавить `InnLookupSchema` в `env.schema.ts`, подмерж в общую схему.
- Добавить геттер `cfg.innLookup` в `TypedConfigService` + соответствующий тест в `typed-config.service.spec.ts` (проверка дефолтов).
- Создать модуль `backend/src/modules/inn-lookup/`:
  - `inn-lookup.module.ts` (NestJS), `OnModuleInit` для валидации обязательных токенов под выбранный provider.
  - `interfaces/inn-lookup-adapter.interface.ts` — `InnLookupAdapter`, `InnLookupResult`, `InnLookupKind`, `InnLookupStatus`, `InnLookupProvider`.
  - `inn-lookup.service.ts` — фасад с DI-инъекцией активного адаптера (через factory provider, выбирающий по `cfg.innLookup.provider`).
  - `adapters/` — пустые stub'ы для `DadataAdapter` и `KonturFocusAdapter` (выбрасывают `NotImplementedException`), реальный `MockAdapter` (см. фазу 2).
  - `utils/inn-validator.ts` — `validateInnFormat(inn): { valid: boolean; kind: 'legal_entity' | 'individual' | null }` + checksum по алгоритму ФНС.
  - Юнит-тест на checksum (3 валидных, 3 невалидных ИНН).
- В `app.module.ts` — зарегистрировать `InnLookupModule`.

**DoD фазы 1:**
- [ ] `bun run typecheck` зелёный.
- [ ] `bun run test:unit src/common/config/typed-config.service.spec.ts` зелёный, дефолты `cfg.innLookup` соответствуют схеме.
- [ ] `bun run test:unit src/modules/inn-lookup/utils/inn-validator.spec.ts` зелёный (6 кейсов).
- [ ] При запуске с `INN_LOOKUP_PROVIDER=dadata` и пустым `INN_LOOKUP_DADATA_TOKEN` приложение падает на старте с осмысленной ошибкой.

---

### Фаза 2 — MockAdapter + unit-тесты сервиса

Цель: иметь работающую end-to-end цепочку в dev и CI без сетевых вызовов.

- `MockAdapter` (`backend/src/modules/inn-lookup/adapters/mock.adapter.ts`):
  - Зашитый словарь из 6 ИНН: 2 юрлица (active, liquidated), 1 ИП, 1 самозанятый, 1 «не найден» (бросает `NotFoundException`), 1 «провайдер недоступен» (бросает `ServiceUnavailableException`).
  - Для любого ИНН, не входящего в словарь, — детерминированный синтетический ответ на основе hash-а ИНН (для интеграции с frontend).
  - Не делает сетевых запросов, отвечает мгновенно.
- Unit-тесты сервиса (`inn-lookup.service.spec.ts`):
  - lookup проходит через MockAdapter — возвращает корректный `InnLookupResult`.
  - lookup на «не найден» прокидывает `NotFoundException` наверх.
  - lookup на «провайдер недоступен» прокидывает `ServiceUnavailableException` наверх.
  - Невалидный формат ИНН — `BadRequestException` до вызова адаптера.

**DoD фазы 2:**
- [ ] `MockAdapter` отвечает на все 6 фикстурных ИНН + синтетика для остальных.
- [ ] Unit-тесты `inn-lookup.service.spec.ts` зелёные.
- [ ] При `INN_LOOKUP_PROVIDER=mock` сервис не делает сетевых вызовов (проверено отсутствием `fetch`-моков).

---

### Фаза 3 — DadataAdapter + интеграционный тест с sandbox

Цель: реальный путь к продакшен-провайдеру и проверка форматов.

- `DadataAdapter` (`backend/src/modules/inn-lookup/adapters/dadata.adapter.ts`):
  - Эндпоинт `POST {baseUrl}/findById/party` с body `{ query: inn, count: 1 }` и заголовком `Authorization: Token <DADATA_TOKEN>`.
  - Маппинг `data.suggestions[0]` → `InnLookupResult`:
    - `kind`: `data.type === 'INDIVIDUAL' && data.opf?.code === '50102'` → `sole_proprietor`; иначе `INDIVIDUAL` → `self_employed` (если `data.opf?.code` соответствует НПД-категории) или `individual`; `LEGAL` → `legal_entity`.
    - `fullName`: для юрлица `data.name.full_with_opf`; для ИП — `data.name.full`; для самозанятого — `data.fio.surname + ' ' + ...`.
    - `shortName`: только для юрлица — `data.name.short_with_opf`.
    - `ogrn`: для юрлица `data.ogrn`; для ИП `data.ogrn` (ОГРНИП).
    - `kpp`: только для юрлица.
    - `legalAddress`: `data.address.unrestricted_value`.
    - `directorName`: `data.management.name` (только для юрлица).
    - `status`: `data.state.status` → `ACTIVE` → `active`, `LIQUIDATED` → `liquidated`, `REORGANIZING` → `reorganized`, прочее → `unknown`.
  - Тайм-ауты, retry (1 раз, только на сетевые ошибки и 5xx), без retry на 4xx.
  - Если `suggestions[]` пустой → `NotFoundException('inn_not_found')`.
- Интеграционный тест `backend/test/integration/inn-lookup-dadata.spec.ts`:
  - Запускается только если переменная `INN_LOOKUP_DADATA_TOKEN` задана (skip-если-нет, не падает на CI).
  - Запрос на известный публичный ИНН (например, ИНН ФНС России `7707083893` — Сбербанк, всегда доступен) — проверка маппинга всех полей юрлица.
  - Запрос на гарантированно несуществующий ИНН (`0000000000`) → `NotFoundException`.
- Контур.Фокус-адаптер на этой фазе **не делаем** — оставляем stub. Делаем его только если владелец после рекомендации в этом ТЗ выберет Контур. Архитектура такова, что добавление 200 строк адаптера не требует правок где-либо ещё.

**DoD фазы 3:**
- [ ] `DadataAdapter` собирается и тайпчекается.
- [ ] Интеграционный тест зелёный при наличии токена в локальном `.env.test` (на CI — skip).
- [ ] При `INN_LOOKUP_PROVIDER=dadata` и `lookup('7707083893')` возвращается `InnLookupResult` с `kind='legal_entity'`, `status='active'`, заполненным `directorName`.

---

### Фаза 4 — Redis-кэш + метрики + защита от cache stampede

Цель: кэшировать дорогие внешние вызовы, дать наблюдаемость.

- `InnLookupCacheService` (`backend/src/modules/inn-lookup/services/inn-lookup-cache.service.ts`):
  - `get(inn): Promise<InnLookupResult | null>` — читает Redis, парсит через zod, возвращает `null` при невалидной форме или при несовпадении `provider`.
  - `set(inn, result): Promise<void>` — пишет с TTL.
  - `delete(inn): Promise<void>` — для `invalidate`.
- Доработать `InnLookupService.lookup`:
  - проверка валидности формата (раннее 400);
  - `cache.get` → если есть — вернуть, инкрементить `cache="hit"`;
  - попытка взять Redlock `inn-lookup:lock:<inn>` (TTL 5 с) → при неудаче — `sleep(50ms)` и повторная попытка `cache.get` (до 3 попыток);
  - при успехе lock — вызвать адаптер, замерить latency, `cache.set`, инкрементить `cache="miss"`;
  - метрики `inn_lookup_requests_total{provider,status,cache}` и `inn_lookup_latency_seconds{provider}` через существующий `MetricsService` / `prom-client`.
- `InnLookupService.invalidate(inn)` — `cache.delete` + audit.
- Юнит-тесты: cache hit, cache miss, race-condition (два параллельных вызова — только один пробивает к адаптеру).

**DoD фазы 4:**
- [ ] Cache hit/miss отражаются в `/metrics` (проверить вручную через curl).
- [ ] Два параллельных вызова `lookup` за один ИНН в течение 1 секунды — провайдер вызывается ровно один раз (юнит-тест с моком адаптера и реальным Redis из dev-compose).
- [ ] `invalidate(inn)` удаляет запись и пишет в `AuditLog`.
- [ ] Запись в кэше с `provider='dadata'` не отдаётся, если активный provider в ENV сменился на `kontur_focus` — фиксируется отдельным тестом.

---

### Фаза 5 — HTTP-эндпоинт + DTO + Swagger + rate-limit + admin-invalidate

Цель: дать фронту единую точку доступа.

- DTO через `nestjs-zod`:
  - `InnLookupRequestDto`: `{ inn: string }` с zod-валидацией (10 или 12 цифр, checksum).
  - `InnLookupResponseDto`: shape соответствует `InnLookupResult` (без `raw` — `raw` не отдаётся в HTTP-ответ, он только для серверной audit).
- Контроллер `InnLookupController`:
  - `POST /api/v1/inn-lookup` — `CookieAuthGuard` (любая авторизованная сессия), `ThrottlerGuard` с лимитом из `cfg.innLookup.rateLimitPerMin`.
  - Тело: `InnLookupRequestDto`. Ответ: `InnLookupResponseDto` или 4xx/5xx ошибки (см. edge-cases).
- Admin-эндпоинт `DELETE /api/v1/admin/inn-lookup/cache/:inn` — `owner`/`admin` через `RolesGuard`. Audit-запись.
- Swagger-описание обоих эндпоинтов, примеры ответов для каждого `kind`.
- Интеграционный e2e-тест: POST с валидным ИНН → 200 + правильный shape; невалидный → 400; ненайденный → 404; rate-limit overflow → 429.

**DoD фазы 5:**
- [ ] `POST /api/v1/inn-lookup` отвечает 200 для валидного ИНН (mock-provider в тесте).
- [ ] 400 для невалидного формата, 404 для не найденного, 429 при превышении rate-limit, 503 при недоступности провайдера.
- [ ] Swagger показывает эндпоинт под тегом `inn-lookup`, schema response заполнена.
- [ ] Admin-эндпоинт инвалидации работает, audit пишется.

---

### Фаза 6 — Frontend: компонент `<InnInput>`, хук `useInnLookup`, интеграция в формы

Цель: пользователь видит автозаполнение в реальном времени.

- Слой `src/api/inn-lookup.api.ts`:
  - `InnLookupApiDto` (ровно как `InnLookupResponseDto`).
  - `lookupInn(inn: string, signal?: AbortSignal): Promise<InnLookupApiDto>` через единый `apiClient`.
- Слой `src/domain/inn-lookup.ts`:
  - `InnLookupModel` (domain). Маппер `mapApiToDomain`. UI-перевод `kind` в русский: «Юридическое лицо», «Индивидуальный предприниматель», «Самозанятый», «Физическое лицо»; `status` — «Действует», «Ликвидировано», «Реорганизовано», «Неизвестно».
- Хук `src/hooks/useInnLookup.ts`:
  - Принимает `inn: string`.
  - Debounce 500 ms.
  - При смене `inn` — `AbortController.abort()` предыдущего запроса.
  - Возвращает `{ data: InnLookupModel | null, isLoading: boolean, error: 'invalid_format' | 'not_found' | 'unavailable' | null }`.
  - Локальная валидация формата (10/12 цифр + checksum) до запроса — не дёргает сеть при заведомо невалидном ИНН.
- Компонент `src/ui/forms/InnInput.tsx`:
  - Текстовое поле + маска (только цифры, максимум 12).
  - Под полем — статус-строка: «Поиск…», «Найдено: ООО Ромашка, ИНН 7707…», «Не найдено — проверьте ИНН», «Сервис временно недоступен. Введите данные вручную».
  - Чекбокс «Ввести данные вручную» — раскрывает форму ручного ввода `fullName`, `legalAddress`, `directorName`, `ogrn`, `kpp` (последние два по `kind`).
  - Прокидывает наружу `onChange(model | manualPayload | null)` через единый колбэк.
- Интеграция:
  - В форме регистрации Org (онбординг, `frontend/app/(public)/onboarding/...`) — `<InnInput>` подтягивает реквизиты, остальные поля формы автозаполняются.
  - В странице `/referrals` (форма «Стать рефералом») — `<InnInput>` верифицирует ИНН реферала.
- Тесты:
  - `useInnLookup.spec.ts` (vitest + jsdom) — debounce, abort, локальная валидация.
  - Snapshot-тест `InnInput.spec.tsx` для трёх состояний (loading, found, not-found).

**DoD фазы 6:**
- [ ] `bun run typecheck && bun run lint && bun run build` зелёные во frontend.
- [ ] `bun run test:unit` зелёный в frontend для нового хука и компонента.
- [ ] При вводе ИНН Сбербанка `7707083893` в любую из форм поля автозаполняются за <1 с (с MockAdapter — мгновенно).
- [ ] При вводе несуществующего ИНН (`0000000000`) — статус «Не найдено», чекбокс «Ввести вручную» доступен.
- [ ] При обрыве сети (mock 503 от бэка) — статус «Сервис временно недоступен», чекбокс «Ввести вручную» доступен.

## Edge-cases

| Кейс | Ожидаемое поведение |
|---|---|
| ИНН неверного формата (8 цифр, буквы, чек-сумма не сходится) | `400 Bad Request` с кодом `invalid_format`. Провайдер не дёргается, кэш не пишется. На фронте — подсказка «ИНН должен быть 10 цифр для юрлица или 12 для физлица». |
| ИНН формально валиден, но не найден в реестре | `404 Not Found` с кодом `inn_not_found`. В кэш **не пишется** (чтобы при появлении компании в реестре мы быстро увидели её). На фронте — подсказка «Не найдено — проверьте ИНН» + опция «Ввести вручную». |
| Провайдер недоступен (таймаут, 5xx, сетевая ошибка после 1 retry) | `503 Service Unavailable` с кодом `provider_unavailable`. В кэш не пишется. На фронте — fallback «ввести вручную с пометкой не верифицировано». Поле `Org.innVerifiedAt` / `Referral.innVerifiedAt` (см. ТЗ #1) остаётся `null`. |
| Провайдер вернул `status='liquidated'` | Возвращаем 200 с полем `status='liquidated'`. На фронте — yellow-предупреждение «Компания ликвидирована». Для **регистрации Org** разрешаем сохранить (для исторических нужд), но в `Subscription` ставим запрет на оплату до выяснения. Для **реферала** — блокируем создание `Referral` с пояснением «По данному ИНН субъект ликвидирован, реферальная программа доступна только активным субъектам». |
| Провайдер вернул `status='reorganized'` | Возвращаем 200, на фронте — warning, поведение как у `active` (запрет не выставляем — реорганизация ≠ ликвидация). |
| Двойной запрос за тот же ИНН в течение 1 секунды | Через Redlock первый запрос блокирует второй; второй получает результат из кэша после первого. Провайдер вызывается один раз. |
| Смена `INN_LOOKUP_PROVIDER` в ENV при наличии записей в кэше | Cache hit не засчитывается, идёт fresh-запрос к новому провайдеру, ответ перезаписывает запись. Без массовой инвалидации — данные обновятся естественно при первом обращении. |
| ИНН-самозанятого, который снят с НПД | Провайдер вернёт `kind='individual'` и `status='active'` (как обычное физлицо без статуса). На фронте — пояснение «По этому ИНН не зарегистрирован статус самозанятого или ИП. Реферальная программа доступна только самозанятым/ИП/юрлицам». ТЗ #1 ставит этот гейт в `referrals.service.ts`. |
| Rate-limit на пользователя превышен (30 запросов в минуту) | `429 Too Many Requests` с заголовком `Retry-After`. На фронте — отключаем поле на N секунд, показываем «Слишком много запросов, попробуйте через минуту». |
| Запись в кэше повреждена / устарела форма | При невозможности распарсить через zod — удаляем запись, идём в провайдер заново. Метрика `inn_lookup_cache_invalid_total{reason}`. |
| Гость без авторизации пытается дёрнуть `POST /api/v1/inn-lookup` | `401 Unauthorized` (эндпоинт под `CookieAuthGuard`). Регистрация Org делается отдельным public-эндпоинтом, который **внутри** уже вызывает `InnLookupService` напрямую — этот контракт описан в ТЗ #1. |

## Связь с другими ТЗ

- **ТЗ #1 (`2026-05-25-billing-and-referrals-tz.md`):**
  - Использует `InnLookupService.lookup(inn)` при регистрации Org (внутри public-эндпоинта `POST /api/v1/orgs/register-by-inn` или эквивалент).
  - Использует `InnLookupService.lookup(inn)` при создании `Referral` (внутри `referrals.service.ts.becomeReferral`).
  - Добавляет поля `Org.inn`, `Org.ogrn`, `Org.kpp`, `Org.directorName`, `Org.legalAddress`, `Org.innVerifiedAt` в Prisma-схему — заполняются результатом `lookup`.
  - Добавляет поля `Referral.inn`, `Referral.innVerifiedAt`, `Referral.payoutDetails` — заполняются результатом `lookup`.
- **ТЗ #2 (`2026-05-25-demo-mode-tz.md`):** Регистрация в демо-режиме идёт через тот же путь, что и в ТЗ #1, — `InnLookupService` нужен с самого первого шага онбординга.
- **ТЗ #4 (платёжный провайдер, будущее):** Реквизиты, подтянутые через `InnLookupService` и сохранённые в `Org`, понадобятся для генерации счёта и для KYC-проверки на стороне платёжного провайдера.

## Риски и ограничения

- **Vendor lock-in.** Формат `raw` зависит от провайдера. Бизнес-логика на `raw` опираться не должна — только на унифицированный контракт `InnLookupResult`. Контракт зафиксирован в этом ТЗ и в zod-схеме `InnLookupResultSchema`.
- **Затраты на запросы.** При высоком объёме регистраций и переходов «стать рефералом» бесплатный план Dadata (10 000 запросов/сутки) может быстро исчерпаться. Кэш 30 дней снимает основную нагрузку, но повторные регистрации на одних и тех же ИНН будут редки. Алёрт в Grafana на `rate(inn_lookup_requests_total{cache="miss"}[1h]) > 100/час` — операционная задача, не входит в это ТЗ.
- **Юр.формы вне РФ.** ИНН — только Россия. Для иностранных компаний/самозанятых нужно отдельное решение (KYC через паспорт/EIN/VAT — отдельное ТЗ).
- **Изменения формата у провайдера.** Если Dadata поменяет shape `data.suggestions[0]` — упадёт маппинг. Решение: снапшот-тест на маппер с зафиксированным JSON-ответом из реального запроса (хранится в `backend/test/fixtures/inn-lookup/dadata-sber.json`).
- **Безопасность токенов.** Токен Dadata, попавший в публичный фронт-бандл, мгновенно сожжёт лимиты. Эндпоинт `POST /api/v1/inn-lookup` намеренно проксирует запрос через backend; **никакие токены провайдера не уходят в browser**.

## Итог

_Заполняется по факту: реализовано целиком или нет, что осталось._
