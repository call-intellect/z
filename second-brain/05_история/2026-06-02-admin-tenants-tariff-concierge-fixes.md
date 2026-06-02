---
date: 2026-06-02
type: история
feature: Фиксы Z-Admin «Тенанты» — мёртвый дропдаун тарифа + краш Concierge-аналитики
branch: feature/demo-shared-org-gaps-fix
tz: plans/tz/2026-06-02-admin-tenants-tariff-and-concierge-fixes.md
commits:
  - d46536c  # docs(plans): ТЗ
  - 1ae46fd  # fix(admin-analytics): краш Concierge
  - 025a3ef  # fix(admin-orgs): дропдаун→статус подписки
---

# Фиксы Z-Admin тенанты: тариф/подписка + краш Concierge-аналитики

## Что было поставлено

Три вопроса super_admin при ручной проверке админки (`meet.crossmark.ru`):
1. В списке Org дропдаун тарифа Basic/Pro/Enterprise, хотя тариф один; смена «Pro» ничего не меняет.
2. Нет видимого выбора «платный / бонус (бесплатно, не в аналитику)».
3. Вкладки «Аналитика → Concierge и AI-чат» падают («This page couldn't load»).

Роль: я выступал агентом-оркестратором по своему же ТЗ, делегируя код суб-агентам и факт-чекая.

## Как решал

**Диагностика (главное — корневые причины, а не симптомы):**
- #1 — дропдаун это **мёртвый legacy** после рефакторинга collapse-to-standard (ТЗ 2026-05-31). Пишет в `Org.tier` (enum basic/pro/enterprise), который больше не влияет на биллинг/фичи — реальный тариф в `OrgEntitlement.tier = tier_standard`.
- #2 — выбор paid/bonus **уже существует**: `enum PaymentMode {paid bonus reference}`, активация на `/admin/orgs/[id]/subscription` («Ручная активация»). Просто не выведен в список Org. Ничего нового строить не нужно — вывести пользователя ссылкой.
- #3 — **рассинхрон контракта**: бэк `concierge-analytics.service.ts` отдаёт плоский объект, фронт-маппер ждёт вложенный `{period:{}, totals:{}}` → `totals` undefined → `t.totalQuestions` кидает в рендере → Next error boundary. Расхождение во всех трёх sub-эндпоинтах (overview/top-queries/no-answer), а не только overview.

**Реализация (3 фазы, 3 коммита):**
- Фаза 1 (`1ae46fd`): переписал доменный слой `admin-concierge-analytics.ts` под фактический плоский ответ; defensive guard в `OverviewTab` (нет ключевого поля → AdminEmpty, не краш); null-метрики → «нет данных»; поднял `noAnswerCount` в return сервиса для честного hint.
- Фаза 2+3 (`025a3ef`): убрал `TIERS`/`updateTier`/`<Select>` из `OrgsClient.tsx`, колонка «Тариф»→«Подписка» = бейдж статуса (`orgSubscriptionLabel`/`orgSubscriptionBadgeVariant`) в `<Link href=?tab=subscription>`. Backend `listOrgs()` отдаёт `subscriptionStatus`+`paymentMode` (join Subscription, у неё `tenantId @unique`). `UpdateOrgSchema.tier` → `@deprecated`, `.refine` теперь требует `freeze`.

## Что вышло

- Верификация независимая: frontend+backend `typecheck`/`lint`/`build` — зелёные (прогонял сам после каждого агента, не доверяя отчёту [x]).
- Факт-чек поймал бы ложь, но агенты не соврали: суб-агент Фазы 2 сам нашёл, что `ORG_TIER_LABELS`/`OrgTier` используются в `OrgsAnalyticsClient.tsx`, и корректно НЕ удалил их (совпало с §2.5 ТЗ про отдельную миграцию).
- Прод-операций нет: миграций БД / ENV / seed не требуется (поля Subscription уже в схеме). Достаточно `docker compose up -d --build`.

## Чему научился

- **«Один тариф» в продукте ≠ один источник правды в коде.** После collapse-to-standard остались ДВА параллельных поля тарифа: мёртвый `Org.tier` (enum) и живой `OrgEntitlement.tier` (tier_standard). Редактируемый UI-контрол, пишущий в мёртвое поле, — источник прямой дезориентации пользователя. При рефакторинге-сворачивании надо чистить и UI-управление, не только модель.
- **Контракты, написанные «вперёд бэка» («бэкенд готовится параллельно»), почти гарантированно расходятся.** Здесь и фронт, и бэк имели JSDoc «готовится параллельно» — и так и не свелись. Урок: после появления реального бэка обязательно сверять форму, особенно вложенность и nullability. Графа `code-pitfalls` кандидат.
- **Грейсфул-заглушка vs краш:** соседняя страница «Встречи» не падала (явный not-implemented guard), а Concierge падала (200 с неверной формой + жёсткое `.toLocaleString` на undefined). Любой рендер по данным API должен иметь guard на форму, иначе один кривой ответ роняет весь сегмент.
