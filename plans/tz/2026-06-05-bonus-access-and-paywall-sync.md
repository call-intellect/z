---
type: tz
status: ready-to-implement
feature: bonus-access-and-paywall-sync
date: 2026-06-05
owner: Сергей (sergrv80@gmail.com)
relates_to:
  - plans/analysis/2026-06-05-manual-qa-RESULTS.md
  - plans/archive/2026-05-28-paywall-no-trial.md
  - plans/archive/2026-05-27-billing-tochka-referral-dadata-z.md
---
> Анализ-источник: `plans/analysis/2026-06-05-manual-qa-RESULTS.md` (раздел «КОРНЕВОЙ КЛАСТЕР» + «КОРЕНЬ ПОДТВЕРЖДЁН ПО КОДУ»). Статус согласования: 2026-06-05.

# ТЗ-1. Бонусный доступ из админки реально снимает пэйвол + честные отказы 403

## Цель
Сделать так, чтобы (1) выдача компании **бонусного/платного доступа** из админки super_admin фактически открывала продукт (встречи, чат, приглашения, проекты), а не оставляла Org в `DEMO`; (2) любой отказ пэйвола показывался пользователю **понятным сообщением**, а не молча.

## Зачем (болезненное состояние — по факту прода 2026-06-05)
Владелец выдал компании «ооо ромашка» (tenant `cmpuz4gbs000201mvfbf3k2zk`) бонусный доступ, но на проде:
- `GET /api/v1/billing/subscription` → `status:"DEMO"`, `totalPaidKopecks:0`;
- `POST /api/v1/meetings` → **403** (ядро продукта недоступно), так же `POST /api/v1/chat/v2`, `POST .../invitations`, `POST /api/v1/projects/from-template`;
- на части экранов 403 **без сообщения** — пользователь видит «нажал, ничего не происходит».
Бизнес-эффект: бонусный аккаунт, выданный специально для пользования, продуктом пользоваться не может.

## REALITY-CHECK (что уже есть в коде — проверено чтением)
- **Пэйвол-механизм РАБОТАЕТ как задумано:** `backend/src/modules/billing/guards/subscription.guard.ts` — глобальный `SubscriptionGuard`, на не-GET ручках с `@RequireSubscription` при `subscription.status !== 'ACTIVE'` бросает 403 `subscription_demo`/`subscription_expired` (super_admin и GET — байпас). Якорь: `subscription.guard.ts:92` `if (sub?.status === 'ACTIVE') return true;`.
- **Активация бонуса УЖЕ реализована и корректна:** `ManualBillingService.activate({paymentMode:'paid'|'bonus'})` (`backend/src/modules/billing/services/manual-billing.service.ts:117`) переводит `status='ACTIVE'` через FSM `DEMO→ACTIVE`, создаёт Invoice (`bonus` для бонуса — не в выручку, без реф-комиссии), грантует баланс встреч. Эндпоинт уже есть: `POST /api/v1/admin/orgs/:tenantId/billing/activate` (`admin-billing.controller.ts:123`).
- **Корень бага — РАЗЪЕДИНЁННЫЕ потоки в админ-UI:** таб «Тариф и лимиты» (`frontend/app/(admin)/admin/orgs/[id]/billing/BillingAdminClient.tsx`) меняет ТОЛЬКО `OrgEntitlement` (tier/feature/quota/notes) через `entitlementsApi.patchAdminOrg`. **`Subscription.status` он не трогает.** Super_admin, выдавая «бонус» здесь (tier_standard + notes «бесплатно»), думает что открыл доступ — но подписка остаётся DEMO. Действие `activate` лежит в другом месте (`[id]/subscription/`-диалоги) и в этом табе не показано.
- **`entitlements.tier` НЕ равен «оплачено»:** `EntitlementService` (`entitlement.service.ts:96,353`) отдаёт `tier_standard` как fail-safe-дефолт ЛЮБОЙ Org. Поэтому `tier_standard` в ответе — не признак выданного доступа. Гейт смотреть на entitlements нельзя — только на статус доступа.
- Frontend-зеркало гейта: `frontend/src/hooks/useCanCreate.ts:53` `canCreate = status === 'ACTIVE'` (источник демо-баннера и read-only).
- Существующий 403-обработчик: в проекте есть событие, на которое завязан `useCanCreate.showPaywall()` («тот же event, что 403-interceptor» — комментарий useCanCreate.ts:16). **Перед Фазой 3 перечитать**, где ловится 403 (поиск по `subscription_demo` / `PaywallModal` / `api-client` interceptor), и переиспользовать его, а не плодить новый.

## Принятые решения владельца
| # | Решение | Обоснование | Дата |
|---|---|---|---|
| Р1 | Бонус имеет **два режима**: «бонус» (НЕ идёт в выручку/аналитику) и «с оплатой» (идёт). | Слова владельца 2026-06-05; в коде уже `paymentMode:'bonus'\|'paid'` (bonus → Invoice.status='bonus', без реф-комиссии). Маппинг 1:1. | 2026-06-05 |
| Р2 | Чинить и **причину** (админ-поток выдачи), и **симптом** (молчаливые 403). | Один симптом ≠ один корень; продукт должен и открываться, и честно объяснять отказ. | 2026-06-05 |
| Р3 | НЕ снимать пэйвол через `entitlements.tier`. | tier_standard — дефолт всех Org, это дыра в биллинге (любой DEMO «оплачен»). Источник истины — `Subscription.status`/активация. | 2026-06-05 |

## Доказательство выбора (challenge-loop, кратко; полное — в analysis)
| Критерий | A. Подсветить/добавить `activate(bonus)` в админ-табе | B. Снимать гейт по entitlements/notes | Выбор |
|---|---|---|---|
| Чинит причину (админ выдаёт доступ и он работает) | ✓ | ✗ (entitlements ≠ оплата, Р3) | **A** |
| Не ломает учёт выручки/аналитику | ✓ (bonus vs paid уже разведены) | ✗ (нет режима/учёта) | **A** |
| Единый источник истины «можно работать» | ✓ (`Subscription.status`) | ✗ (второй источник) | **A** |
| Переиспользует существующий код | ✓ (`ManualBillingService.activate` готов) | ✗ (надо менять guard-логику рискованно) | **A** |
Вывод: **A** (подключить готовую активацию к админ-UI) + честные 403 (симптом). Вариант B (трогать guard) отвергнут — Р3 и риск открыть пэйвол всем DEMO.

## Scope
**Входит:**
- Немедленное операционное лечение текущего аккаунта (Фаза 0).
- Админ-UI: явное действие «Выдать бонусный/платный доступ» в карточке Org, вызывающее существующий `activate`; гард-предупреждение «tier поднят, но подписка DEMO» (Фаза 1).
- Честный пользовательский ответ на 403 пэйвола на ВСЕХ мутирующих действиях (Фаза 2).
**Не входит:**
- Изменение логики `SubscriptionGuard` / порога `ACTIVE` (Р3) — кроме, при необходимости, добавления `@RequireSubscription` на не покрытые ручки (см. «Вне scope / vNext»).
- Реальная платёжная интеграция (Точка/рекуррент) — уже в `2026-05-27-billing-*`.
- Next.js-`params`-баг и копирайт/бренд — это **ТЗ-2** (`relates_to`).

## Вне scope / отложено (vNext)
- Аудит «какие мутирующие ручки ДОЛЖНЫ быть под `@RequireSubscription`, но не помечены» (наблюдение: `ingest/dump`, `POST /roles` прошли при DEMO — это либо намеренно бесплатно, либо пропуск гейта). → отдельная ревизия, **решение владельца нужно** (что бесплатно в DEMO). Здесь НЕ трогаем.

## Граничные контракты
- `ManualBillingService.activate` и эндпоинт `POST /admin/orgs/:tenantId/billing/activate` — **уже существуют**, использовать как есть, НЕ переписывать. Контракт тела — `AdminActivateBodySchema` (`billing/dto/billing.dto.ts`): `{ billingPeriod, seatsBase?, seatsExtra, startedAt, paymentMode:'paid'|'bonus', reason(≥3), externalRef? }`.
- 403-форма пэйвола (контракт, который ловит фронт) — дословно из `subscription.guard.ts:108`:
  ```json
  { "ok": false, "error": { "code": "subscription_demo", "message": "Оплатите подписку, чтобы начать работу", "currentStatus": "DEMO", "price": 60000, "currency": "RUB", "paymentUrl": "/settings/subscription" } }
  ```
  (или `code: "subscription_expired"` для EXPIRED/PAST_DUE/SUSPENDED/CANCELED). Фронт обязан реагировать на оба кода.

---

## Фаза 0 — Немедленное операционное лечение текущего аккаунта `[ ]` ⏸ ЖДЁТ ПОДТВЕРЖДЕНИЯ ПРОД-ДОСТУПА
**Цель:** разблокировать «ооо ромашка» прямо сейчас, не дожидаясь кода.
**Что входит:** super_admin вызывает существующий эндпоинт активации бонуса для tenant `cmpuz4gbs000201mvfbf3k2zk`.
**Как:** `POST /api/v1/admin/orgs/cmpuz4gbs000201mvfbf3k2zk/billing/activate` body `{ "billingPeriod":"monthly", "seatsExtra":0, "startedAt":"<now ISO>", "paymentMode":"bonus", "reason":"Бонусный доступ для пилота/тестирования" }` (через Z-Admin или curl с куками super_admin).
**Что НЕ входит:** код-изменения.
**Acceptance:**
- После вызова `GET /api/v1/billing/subscription` для этого tenant → `status:"ACTIVE"`, `paymentMode:"bonus"`.
- Повторная ручная проверка в браузере: `POST /api/v1/meetings` создаёт встречу (201), демо-баннер исчезает.
**Закрывает:** разблокировку прод-аккаунта (немедленно).

## Фаза 1 — Админ-UI: «бонусный/платный доступ» подключён к активации `[x]`
**Мини-картография:** `frontend/app/(admin)/admin/orgs/[id]/billing/BillingAdminClient.tsx` (таб «Тариф и лимиты»); существующий API-клиент `frontend/src/api/billing.api.ts` (есть `adminAdjustSeats`, проверить наличие `adminActivate`; если нет — добавить вызов `POST /admin/orgs/:id/billing/activate`); диалог-образец `[id]/subscription/AdjustSeatsDialog.tsx`. Перед правкой перечитать — номера строк дрейфуют.
**Цель:** super_admin из карточки Org может в один шаг «выдать доступ» (paid/bonus), и это ставит `Subscription.status=ACTIVE`.
**Что входит:**
- В табе биллинга Org добавить секцию **«Доступ к продукту»** с текущим `subscription.status` (из `GET /admin/orgs/:id/billing`) и действием **«Выдать бонусный доступ»** / **«Выдать платный доступ»** (выбор режима = `paymentMode`), полями `billingPeriod`, `seatsExtra`, обязательным `reason`, → вызывает `billingApi.adminActivate(tenantId, body)`.
- **Гард-предупреждение (R3):** если `entitlement.tier !== 'demo-подобного'` НО `subscription.status==='DEMO'` — показать заметный warning: «Тариф задан, но доступ не активирован — компания всё ещё в демо. Выдайте бонусный/платный доступ.» (текст на русском, парные токены).
- Тосты успеха/ошибки (русские).
**Что НЕ входит:** изменение секций tier/feature/quota (остаются как есть); реальная оплата.
**Acceptance (R1, R2):**
- Греп: в `BillingAdminClient.tsx` есть вызов `adminActivate` и строка-предупреждение про «всё ещё в демо».
- e2e/ручной: на тестовой DEMO-Org нажатие «Выдать бонусный доступ» → `subscription.status` становится `ACTIVE`, `paymentMode='bonus'`; в выручке/аналитике bonus не учитывается (Invoice.status='bonus' — проверить, что overview MRR не вырос).
- `bun run typecheck && bun run lint && bun run build` (frontend) зелёные.
**Закрывает:** R-ADMIN (причина бага бонуса).

## Фаза 2 — Честный ответ на 403 пэйвола на всех мутациях `[x]`
**Мини-картография:** глобальный обработчик ответов в `frontend/src/api/api-client.ts` (искать перехват ошибок/`ApiError`); событие paywall, на которое подписан `useCanCreate.showPaywall()` (useCanCreate.ts:16 — «тот же event, что 403-interceptor»); компонент `PaywallBanner.tsx`/`PaywallModal` (найти). **Перед правкой перечитать**, что уже ловится — переиспользовать, не дублировать.
**Цель:** на любой 403 с `error.code ∈ {subscription_demo, subscription_expired}` пользователь видит понятное объяснение и CTA, а не молчание.
**Что входит:**
- В перехватчике `api-client` при таком 403 — поднимать существующий paywall-эвент/модалку (с текстом из `error.message` и `paymentUrl`).
- Гарантировать срабатывание на местах, где сейчас тихо: создание встречи (`/meetings/create`), AI-чат (`/chat`), приглашение (`/structure` диалог), создание проекта (`/projects/new` — там сообщение уже есть, привести к общему виду).
**Что НЕ входит:** изменение текста/кодов на бэкенде (контракт уже задан guard'ом).
**Acceptance (R2):**
- Ручной: на DEMO-Org каждое из 4 действий (встреча/чат/инвайт/проект) при 403 показывает заметное сообщение «Оплатите подписку…» (или paywall-модалку) — НИ одного «молча».
- Греп: единая точка обработки `subscription_demo` в `api-client` (а не 4 разных).
- `typecheck/lint/build` зелёные.
**Закрывает:** S2-01, S3-01, S4-01 (симптом «молчаливый 403»), S10-02 (несогласованность).

## Граф зависимостей
- Фаза 0 — независима, делается сразу (ops).
- Фаза 1 и Фаза 2 — независимы друг от друга, можно параллельно (разные файлы: админ-таб vs api-client). Обе после прочтения REALITY-CHECK.

## Риски / ревью-аспекты (для strict-production-review-gate)
- Не открыть пэйвол всем DEMO (Р3): убедиться, что Фаза 2 только ПОКАЗЫВАЕТ сообщение, не меняет `canCreate`.
- `activate` идемпотентность: повторная активация уже-ACTIVE того же режима бросает `ConflictException` (manual-billing.service.ts:133) — UI должен показать это как понятную ошибку, не падать.
- Учёт выручки: bonus НЕ должен попадать в MRR/overview (проверить на ревью).
- AuditLog: activate уже пишет `AdminAuditLog` — не дублировать.

## Idempotency / feature-flag / prod-deploy
- Код-изменения только frontend (Фазы 1–2) + ops-вызов (Фаза 0). Миграций БД нет, новых ENV нет, новых скриптов нет → **prod-deploy: достаточно обычного билда фронта**; отдельных шагов в `prod-deploy-log.md` не требуется (зафиксировать явно при сдаче).
- Feature-flag не нужен (UI-улучшение + использование готового эндпоинта).

## DoD
- typecheck (вкл. `.spec`)/lint/build зелёные (frontend).
- second-brain: обновить `01_projects/` по биллингу/админке (как выдаётся доступ) + `admin.md` (новая секция «Доступ к продукту»).
- Рефлексия в `05_история/`.
- Acceptance всех фаз выполнены, факт-чек грепом.

## Итог
**Реализовано (sergdev, 2026-06-06):**
- **Фаза 1 `[x]`** — в админ-таб `BillingAdminClient.tsx` добавлена первая секция «Доступ к продукту»: показ текущего `subscription.status` (через `billingApi.adminGetOrgBilling`), заметное предупреждение «Тариф задан, но доступ не активирован — компания всё ещё в демо» при DEMO/нет подписки, и форма выдачи доступа (режим бонус/платный, период, доп. места, обязательная причина, опц. референс) → `billingApi.adminActivate`. Конфликт повторной активации показывается тостом, не падает. typecheck/lint/build зелёные.
- **Фаза 2 `[x]`** — найден и устранён корень «молчаливого 403»: interceptor в `api-client.ts` реагировал только на легаси-код `subscription_required`, тогда как `SubscriptionGuard` бросает `subscription_demo`/`subscription_expired`. Условие расширено на все три кода → существующий эвент `subscription:required` поднимает PaywallModal на ЛЮБОЙ мутации (встреча/чат/инвайт/проект) в DEMO/EXPIRED. `canCreate` не менялся (Р3 соблюдён — только показ сообщения). Единая точка обработки.

**Не сделано / осталось:**
- **Фаза 0 `[ ]`** — операционная активация бонуса для прод-tenant `cmpuz4gbs000201mvfbf3k2zk` НЕ выполнена: это запись в прод-БД, требует явного подтверждения прод-доступа владельцем в текущей сессии (правило сессии). После подтверждения — либо новой UI-кнопкой из Фазы 1 (после выката фронта), либо `POST /api/v1/admin/orgs/.../billing/activate` (тело в Фазе 0).
- vNext-аудит «какие мутирующие ручки должны быть под `@RequireSubscription`» — оставлен вне scope (нужно решение владельца, что бесплатно в DEMO).

**Prod-deploy:** только билд фронта; миграций/ENV/скриптов нет.
