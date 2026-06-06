---
date: 2026-06-06
type: reflection
feature: bonus-access-and-paywall-sync + frontend-detail-pages-and-ui-honesty
---

# Рефлексия — бонусный доступ + честность фронтенда (два ТЗ через оркестрацию)

## Что было поставлено

Реализовать два готовых ТЗ из `plans/tz/` в ветке `sergdev`:
1. **ТЗ-1 [bonus-access-and-paywall-sync](../../plans/tz/2026-06-05-bonus-access-and-paywall-sync.md)** — биллинг/админка: UI выдачи бонусного/платного доступа в админ-табе Org + синхронизация пэйвола с реальными кодами 403.
2. **ТЗ-2 [frontend-detail-pages-and-ui-honesty](../../plans/tz/2026-06-05-frontend-detail-pages-and-ui-honesty.md)** — фронт: детальные страницы на async `params`, ребренд `— Z`→`— Кора`, объединение плавающих помощников, деанглицизмы, честные подтверждения действий.

## Как решал (фазы, коммиты)

**ТЗ-1 (2 фазы):**
- Ф1 (`5e87ffe1`) — в `BillingAdminClient.tsx` секция «Доступ к продукту»: показ `subscription.status` (`billingApi.adminGetOrgBilling`), предупреждение «компания всё ещё в демо» при DEMO, форма выдачи (бонус/платный, период, доп. места, причина) → `billingApi.adminActivate`. Первый UI для существующего эндпоинта активации.
- Ф2 (`8522ecfb`) — в `api-client.ts` interceptor 403 расширен на коды `subscription_demo`/`subscription_expired` (а не только легаси `subscription_required`) → эвент `subscription:required` → `SubscriptionContext` открывает `PaywallModal`. Устранён «молчаливый 403» на мутациях в DEMO.
- Ф0 (прод-активация бонуса tenant `cmpuz4gbs000201mvfbf3k2zk`) — НЕ выполнена, ждёт явного подтверждения прод-доступа владельцем.

**ТЗ-2 (5 фаз):**
- Ф1 (`521f7553`) 🔴 — 26 детальных `page.tsx` переведены на async `params` (Next 16): `params: Promise<{…}>` + `await params` по эталону `cards/[id]`. Делалась **fan-out workflow'ом** (отдельный агент на страницу). Чинило класс-баг «/tables/undefined», «Сотрудник не найден».
- Ф2 (`edbb9554`) — `— Z` → `— Кора` в 66 `metadata.title` (бренд-замена **скриптом**).
- Ф3 (`d9730afb`) — объединены два наложенных плавающих помощника: убран FAB Консьержа (`ConciergeFloatingButton` открывается только по `concierge:open`), единственная плавающая кнопка — «Помощник компании» (`AssistantSidebar`), на неё перенесена цель тура `welcome.concierge`.
- Ф4 (`dae2bb44`) — деанглицизмы в `i18n/ru.ts` (Follow-up→Письмо-резюме после встречи; CustDev→Глубинное интервью (CustDev); Customer Success→Работа с клиентом (Customer Success)); «technology»→«Технологии»; заголовок чата «AI-чат»→«Помощник компании».
- Ф5 (`b9312735`) — `/dump` показывает «куда попало» + ссылки после сохранения; «Вопрос Коры» в `/actions` ведёт на `/me/notifications?id=<id>` (backend `probe.provider.ts` actionUrl + `NotificationsClient.tsx` раскрывает конкретный вопрос).

Остальные фазы — точечными правками. Верификация: typecheck/lint/build + acceptance-греп маркеров + Playwright против живого dev-сервера.

## Что вышло

- ТЗ-1: Ф1/Ф2 готовы (Ф0 ждёт прод-подтверждения).
- ТЗ-2: все 5 фаз готовы.
- Все `typecheck`/`lint` — зелёные; backend probe-тесты 4/4 и service 13/13.

## Чему научился (грабли)

1. **Грепать «наземную правду», не доверять числам в ТЗ.** ТЗ называл 22 синхронных `params`-страницы, по факту их 26 (дрейф после merge `dev`). Чинил класс целиком и подтверждал acceptance-грепом синхронных сигнатур = 0. Если бы починил ровно «22 из списка ТЗ», 4 страницы остались бы битыми.
2. **Параллельная сессия делит рабочий каталог и ветку `sergdev`.** Чужие файлы (`MeetingPlayer.tsx`, `manual-qa-RESULTS.md`) появлялись staged/modified прямо в середине сессии. Спасал path-scoped `git commit <пути>` (никогда `git add .` / `-A`) и `git status` перед каждым коммитом — иначе утащил бы чужую работу в свой коммит. Подтверждает [[feedback_git_index_hygiene]] и [[feedback_parallel_sessions_git_check]].
3. **Дисциплина scope при глобальной замене.** Глобальный `Z-Admin`→`Кора-Админ` задел бы ~130 файлов комментариев — откатил, оставил только TZ-scoped `— Z'`. Минимальные безопасные изменения; ребренд панели вынесен в реестр «не сделано».
4. **Корень «молчаливого 403» — дрейф контракта.** Interceptor ловил только `subscription_required`, а `SubscriptionGuard` бросает `subscription_demo`/`subscription_expired`. Прочитал реальный гард, а не угадывал коды — нашёл все три и синхронизировал. Подтверждает [[feedback_verify_framework_behavior_empirically]].
5. **Запущенный `next dev` держит lock на `.next` → отдельный `next build` невозможен.** Гейт собрался из: `typecheck` (`tsc --noEmit` ловит `Promise<>.id` без `await`) + компиляция роутов самим dev-сервером + Playwright. Эмпирика «с данными» требует поднятого backend (локально не было → проверка на проде).
