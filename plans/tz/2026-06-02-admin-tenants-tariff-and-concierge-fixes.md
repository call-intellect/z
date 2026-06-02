---
type: tz
status: ready-to-implement
date: 2026-06-02
owner: sergrv80@gmail.com
feature: Три фикса в Z-Admin → «Тенанты» и «Аналитика». (1) Убрать мёртвый дропдаун тарифа Basic/Pro/Enterprise из списка Org (legacy после collapse-to-standard), заменив колонку «Тариф» на read-only статус подписки со ссылкой в карточку. (2) Тем самым вывести пользователя к уже существующему выбору paid/bonus на странице подписки. (3) Починить краш вкладок «Аналитика → Concierge и AI-чат» — рассинхрон контракта фронт↔бэк по всем трём sub-эндпоинтам.
relates_to:
  - plans/tz/2026-05-31-collapse-tiers-to-standard.md
  - second-brain/01_projects/frontend-pages.md
  - second-brain/01_projects/api-layer.md
existing_critical_files:
  # ─── Фикс 1: краш Concierge analytics (рассинхрон контракта) ───
  - frontend/src/domain/admin-concierge-analytics.ts                                  # ApiDto-типы + мапперы — привести к ФАКТИЧЕСКОМУ плоскому ответу бэка
  - frontend/app/(admin)/admin/analytics/concierge/ConciergeAnalyticsClient.tsx       # OverviewTab/TopQueriesTab/NoAnswerTab — guard + рендер по новой форме
  - frontend/src/api/admin-concierge-analytics.api.ts                                 # типы generic'ов get<...> синхронизировать
  - backend/src/modules/admin/analytics/concierge-analytics.service.ts               # (опц.) вернуть noAnswerCount — он уже вычисляется, но отбрасывается
  # ─── Фикс 2+3: мёртвый дропдаун тарифа → статус подписки ───
  - frontend/app/(admin)/admin/orgs/OrgsClient.tsx                                    # убрать Select tier + updateTier; колонка «Тариф» = бейдж статуса + ссылка
  - frontend/src/domain/admin-org.ts                                                  # AdminOrgRowDomain: убрать tier-как-управление, добавить subscriptionStatus/paymentMode
  - backend/src/modules/admin/services/admin-orgs.service.ts                          # listOrgs(): join Subscription → вернуть status + paymentMode в AdminOrgRow
  - backend/src/modules/admin/dto/admin-orgs.dto.ts                                   # UpdateOrgSchema — убрать/deprecate `tier` + поправить .refine на freeze. (Ответ строки Org — это TS-интерфейс AdminOrgRow в service, отдельной Zod-response-DTO НЕТ)
  - backend/src/modules/admin/controllers/admin-orgs.controller.ts                    # (проверить) update(tier) — пометить deprecated/убрать ветку tier
---

> **Статус:** ТЗ создано 2026-06-02 по итогам разбора трёх вопросов из super_admin-админки (раздел «Тенанты» и «Аналитика»). Все три — не «как задумано», а **недоделки/мёртвый код**, а не новые фичи. Источник реальной механики paid/bonus уже существует — ТЗ ничего не «изобретает», только сводит контракты и убирает обманчивый контрол.

# ТЗ: фиксы Z-Admin «Тенанты» — тариф/подписка + краш Concierge-аналитики

## 1. Контекст и корневые причины

Три независимые проблемы, обнаруженные при ручной проверке super_admin-админки на `meet.crossmark.ru`.

| # | Симптом (что видит super_admin) | Корневая причина | Тип |
|---|---|---|---|
| 1 | В списке Org дропдаун тарифа показывает **Basic / Pro / Enterprise**, хотя тариф в системе **один**. Выбор «Pro» ничего не меняет. | После рефакторинга **collapse-to-standard** (ТЗ 2026-05-31) единый тариф = `OrgEntitlement.tier = tier_standard`. Дропдаун — legacy: пишет в мёртвую колонку `Org.tier` (enum `basic/pro/enterprise`), которая больше не влияет на биллинг/фичи. | Frontend + Backend (мёртвый код) |
| 2 | Нет выбора «платный vs бонус (бесплатно) / идёт в аналитику или нет». | Выбор **уже есть** — `PaymentMode (paid/bonus/reference)` на странице `/admin/orgs/[id]/subscription` («Ручная активация»). Просто не выведен в список Org; пользователь крутил не тот контрол (дропдаун из #1). | UX/навигация |
| 3 | Вкладки «Аналитика → Concierge и AI-чат» падают: «This page couldn't load», в консоли `Cannot read properties of undefined (reading 'totalQuestions')`. | Рассинхрон контракта: бэк отдаёт **плоский** объект, фронт-маппер ждёт **вложенный** `{period:{}, totals:{}}`. `api.totals = undefined` → `t.totalQuestions` кидает в рендере. Расхождение есть во всех трёх sub-эндпоинтах (overview/top-queries/no-answer). | Frontend (баг контракта) |

### 1.1. Подтверждение из кода

**#1 — мёртвый tier:**
- `OrgsClient.tsx:43` — `const TIERS: OrgTier[] = ['basic','pro','enterprise']`; дропдаун в `OrgRow` (строки ~244-261) вызывает `adminOrgsApi.update(org.id, { tier })`.
- `admin-orgs.service.ts:167` — `if (args.tier !== undefined) data.tier = args.tier` пишет в `Org.tier`.
- `schema.prisma:173` — `enum OrgTier { basic pro enterprise }` (legacy).
- Реальный тариф: `schema.prisma:3927` — `OrgEntitlement.tier String @default("tier_pro")`, единый `tier_standard`. Страница `PlansClient.tsx:534-585` сама напоминает про «перевод с legacy-тиров».

**#2 — paid/bonus уже существует:**
- `schema.prisma:8996-9003` — `enum PaymentMode { paid bonus reference }`; JSDoc прямо: «`paid` идёт в выручку + реф-выплата, `bonus` — нет, `reference` — не в выручке и не в метриках».
- `schema.prisma:8985-8992` — `enum SubscriptionStatus { DEMO ACTIVE PAST_DUE SUSPENDED CANCELED EXPIRED }`.
- `AdminSubscriptionClient.tsx:364-369` — рабочий `<select>`: «paid — в выручке, идёт реф 20 000 ₽» / «bonus — НЕ в выручке».

**#3 — рассинхрон контракта Concierge:**
- Бэк `concierge-analytics.service.ts:186-198` отдаёт `{ period:'week', from, to, totalQuestions, noAnswerRate(nullable), avgLatencyMs(null), activeUsers, notes }` — **плоско**.
- Фронт `admin-concierge-analytics.ts:14-41` ждёт `{ period:{from,to,kind}, totals:{totalQuestions, noAnswerCount, noAnswerRate, avgLatencyMs, activeUsers} }` — **вложенно**.
- `ConciergeAnalyticsClient.tsx:128,134` — `const t = q.data.totals; t.totalQuestions.toLocaleString()` → краш.
- Аналогично рассинхрон у `top-queries` (бэк `{query,count}`, фронт ждёт ещё `avgLatencyMs/successRate` → NaN) и `no-answer` (бэк `messageId`, фронт ждёт `id` + `tenantName`/`reason` → битый React key).

## 2. Что НЕ входит (осознанный scope-cut)

- **Не делаем** отдельную «быструю кнопку активировать paid/bonus» в списке Org. Активация — это FSM (`SubscriptionService`) с обязательным `reason` и событиями `activated_paid/activated_bonus`; она уже корректно живёт на `/admin/orgs/[id]/subscription`. Дублирование = два пути к одному FSM и риск рассинхрона. Вместо этого — read-only бейдж + ссылка в карточку.
- **Не трогаем** саму страницу подписки `/admin/orgs/[id]/subscription` — она рабочая.
- **Не мигрируем** данные `Org.tier` и не дропаем колонку/enum в этом ТЗ (отдельная зачистка legacy — см. §6). Здесь только убираем UI-управление и перестаём показывать мёртвое поле.
- **Не расширяем** бэкенд Concierge-аналитики latency/successRate-метриками (это TODO γ+, в схеме `ConciergeMessage` нет поля latency). Фронт показывает «нет данных» там, где бэк отдаёт `null`.

## 3. Фазы

### Фаза 1 — фикс краша «Аналитика → Concierge и AI-чат» (must, frontend-приоритет)

Цель: страница перестаёт падать; KPI и таблицы рендерятся по фактическому ответу бэка; `null`-метрики показываются как «нет данных», а не NaN/краш.

- [x] **1.1.** В `admin-concierge-analytics.ts` переписать `AdminConciergeOverviewApi` под **плоский** ответ бэка: `{ period: 'day'|'week'|'month'; from: string; to: string; totalQuestions: number; noAnswerRate: number | null; avgLatencyMs: number | null; activeUsers: number; notes: { noAnswerRateIsHeuristic: boolean; avgLatencyAvailable: boolean } }`. Опционально добавить `noAnswerCount?: number` (см. 1.5).
- [x] **1.2.** Переписать `adminConciergeOverviewFromApi` → доменная модель без вложенного `totals` (или с `totals`, собранным маппером из плоских полей — на усмотрение, главное чтобы компонент и маппер совпадали). `from/to` → `Date`.
- [x] **1.3.** В `ConciergeAnalyticsClient.tsx` `OverviewTab`: рендер `totalQuestions`, `activeUsers` напрямую; `noAnswerRate === null` → «нет данных» (без `*100`); `avgLatencyMs === null` → «нет данных»; hint по `noAnswerCount` показывать только если поле пришло.
- [x] **1.4.** Привести `TopQueriesTab`/`NoAnswerTab` к фактическим полям бэка: top — `{query,count}` (убрать колонки avgLatency/successRate ИЛИ показывать «—»); no-answer — `messageId` как key, убрать `tenantName`/`reason` (бэк их не отдаёт) либо рендерить условно. Цель — ни одного обращения к недоставленному полю.
- [x] **1.5.** (Опц., 1 строка бэка) В `concierge-analytics.service.ts` поднять `noAnswerCount` из локальной переменной (строки ~174-178) в возвращаемый объект `getOverview`, чтобы hint «X запросов» был честным. Без доп. запросов.
- [x] **1.6.** Defensive guard: если `q.data` есть, но ключевое поле `undefined` — показывать `AdminEmpty`, а не падать (страница не должна ронять сегмент из-за формы API).

**Верификация:** `cd frontend && bun run typecheck && bun run lint && bun run build`; ручной заход на `/admin/analytics/concierge` — все 4 вкладки открываются без краша; при пустой БД чата — `AdminEmpty`, не падение.

### Фаза 2 — убрать мёртвый дропдаун тарифа из списка Org (backend + frontend)

Цель: колонка «Тариф» показывает реальное состояние оплаты (read-only), без обманчивого редактируемого контрола.

- [ ] **2.1.** `admin-orgs.service.ts → listOrgs()`: добавить в выборку `Subscription` (по `tenantId` — у `Subscription.tenantId` есть `@unique`, так что `findMany({where:{tenantId:{in:orgIds}}})` или `include`/отдельный `groupBy`) — `status` + `paymentMode`. Расширить TS-интерфейс `AdminOrgRow` (в этом же файле) полями `subscriptionStatus: SubscriptionStatus | null` и `paymentMode: PaymentMode | null`. (Org без подписки → оба `null`, трактуем как DEMO.) **NB:** контроллер возвращает `AdminOrgRow` напрямую, отдельной Zod-response-DTO нет — Swagger-тип идёт от интерфейса.
- [ ] **2.2.** `admin-orgs.dto.ts → UpdateOrgSchema`: убрать `tier` (или пометить `.optional()` + JSDoc «deprecated, не используется») и поправить `.refine` так, чтобы он требовал только `freeze !== undefined`. Не сломать ветку `freeze`.
- [ ] **2.3.** `admin-org.ts` (frontend domain): добавить `subscriptionStatus`/`paymentMode` в `AdminOrgRowApi` + `AdminOrgRowDomain` + маппер. Человекочитаемые лейблы (DEMO/нет подписки → «Демо», ACTIVE+paid → «Платный», ACTIVE+bonus → «Бонус», ACTIVE+reference → «Эталон», PAST_DUE → «Просрочена», SUSPENDED → «Заморожена оплата», и т.д.). **Убрать** ставший мёртвым `ORG_TIER_LABELS`/`OrgTier`/`UpdateOrgRequest.tier`, если после правок они больше не используются (проверить grep по проекту). Парные цветовые токены через бейдж-варианты (никаких хардкод-hex / slate).
- [ ] **2.4.** `OrgsClient.tsx`: удалить `TIERS`, `Select`/`updateTier` в `OrgRow`. Колонку «Тариф» заменить на бейдж статуса+режима. Сделать бейдж (или соседнюю иконку) ссылкой на **вкладку подписки**: `/admin/orgs/${id}?tab=subscription` (это и есть «Подписка и счета»; standalone `/subscription` редиректит туда же). Иконку «Кошелёк» (сейчас `?tab=billing`) оставить или свести — на усмотрение, главное чтобы был явный путь к paid/bonus.
- [ ] **2.5.** Полное удаление `Org.tier`/enum `OrgTier` + перевод `getOrgOverview` (читает `org.tier`, `admin-orgs.service.ts:233`) на `Subscription`/`OrgEntitlement` — **вне этого ТЗ** (требует миграции, см. §6). Здесь только перестаём писать/показывать `Org.tier` из UI.

**Верификация:** `cd backend && bun run typecheck && bun run lint && bun run build` + `cd frontend && bun run typecheck && bun run lint && bun run build`. Ручной заход в `/admin/orgs`: колонка «Тариф» показывает корректные статусы; клик ведёт на страницу подписки; дропдауна больше нет.

### Фаза 3 — навигация к paid/bonus (закрывает вопрос №2; почти полностью покрыта Фазой 2)

- [ ] **3.1.** Убедиться, что из списка Org за ≤1 клик пользователь попадает в «Ручную активацию» (paid/bonus) на `/admin/orgs/[id]/subscription`. Если нужен якорь/таб — добавить.
- [ ] **3.2.** (Опц.) Под бейджем «Бонус»/«Демо» дать подсказку-tooltip: «бонус не идёт в выручку и аналитику» — чтобы смысл был очевиден без захода в карточку.

**Верификация:** ручной сценарий «выдать компании бесплатный (бонус) доступ» проходится из списка Org за 2 шага: бейдж → карточка → активация bonus.

## 4. Затронутые слои (impact)

| Слой | Затронуто |
|---|---|
| Frontend | `admin-concierge-analytics.ts`, `ConciergeAnalyticsClient.tsx`, `admin-concierge-analytics.api.ts`, `OrgsClient.tsx`, `admin-org.ts` |
| Backend | `admin-orgs.service.ts` (listOrgs join), `admin-orgs.dto.ts`, `admin-orgs.controller.ts` (deprecate tier-ветки), `concierge-analytics.service.ts` (опц. noAnswerCount) |
| DB / Prisma | **Нет миграций.** Только чтение `Subscription.status/paymentMode` в `listOrgs`. `Org.tier`/enum пока не трогаем. |
| LiveKit / S3 / AI | Не затронуты. |

## 5. Прод-операции

- Миграций БД, новых ENV, seed/patch/backfill — **нет**. После мержа достаточно `docker compose up -d --build backend` (+ пересборка frontend).
- Этот ТЗ НЕ требует записи в `docs/operations/prod-deploy-log.md` (нет schema/script/ENV-изменений).

## 6. Хвост на будущее (вне этого ТЗ)

- Полная legacy-зачистка `Org.tier` + `enum OrgTier`: дроп колонки/enum после подтверждения, что ни один consumer не читает `Org.tier` (есть чтение в `getOrgOverview` — там тоже надо перевести на `OrgEntitlement.tier`/`Subscription`). Оформить отдельным ТЗ с миграцией (Шаг 4 prod-deploy-log).
- γ+ метрики Concierge (latency/successRate) — расширение `ConciergeMessage` полем latency; отдельный ТЗ.

## 7. Итог

_(заполняется по завершении)_ Реализовано: Фаза 1 [ ] · Фаза 2 [ ] · Фаза 3 [ ]. Осталось: —.
