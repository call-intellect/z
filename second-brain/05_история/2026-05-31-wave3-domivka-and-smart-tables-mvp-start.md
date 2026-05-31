---
date: 2026-05-31
session_id: wave3-domivka-smart-tables
distilled: false
commits:
  - bea971c
  - acfd5dc
---

# Волна 3: добивка Волны 2 + smart-tables MVP-старт

## Что было поставлено

Оркестратор передал волну из 3 блоков:

- **Блок A** — добивка Волны 2: блокеры выката, которые мешали поднимать прод. 6 пунктов: SQL pre-check Referral.contractAcceptedAt, страница оферты /legal/partner-offer (раньше 404), computed `hasPayoutDetails` в backend/frontend (вместо ложного прокси по inn+legalForm), `text-white` → парный токен в `ReferralPromoStrip`, новая second-brain-карточка `01_projects/referrals.md`, переписать раздел 3 и §5-таблицу в `03_processes/referral-program.md` под one-click создание.
- **Блок B** — document-ingest Фаза 0: smoke-test Docling+RapidOCR на 5 реальных фикстурах (текст-PDF, скан-PDF, DOCX, XLSX, HTML).
- **Блок C** — smart-tables Фазы 0+1: 5 Prisma-моделей + backend модуль CRUD + RBAC + integration-spec + frontend Grid с Glide Data Grid и 14+3 типами колонок.

## Как решал

### Блок A (1 час)

Параллелил агрессивно. После чтения структуры (terms-страница как образец `(public)`, CreateLinkCard для understanding ссылки, tailwind config для парных токенов, referrals service/controller для backend-точек) — запустил **4 параллельных агента** в одном сообщении: A2 (страница оферты), A4 (text-white → text-emerald-50), A5 (новая referrals.md), A6 (переписать referral-program.md разделы). Все 4 закончили зелёным.

A3 (`hasPayoutDetails` end-to-end) — последовательный single-agent: backend DTO+service+controller+spec → frontend types+domain+`payoutDetailsAreFilled`. Агент сам нашёл правильный паттерн: экспортируемая функция `hasPayoutDetails(ref)` рядом с private `isNonEmptyObject` чтобы не плодить utils-файлов, плюс рефактор `computeWithdrawalEligibility` на новую функцию для DRY.

A1 (SQL pre-check) — оказалось, dev-Postgres офлайн (только Redis+MinIO в `docker-compose.dev.yml ps`). Перенёс check в pre-flight блок prod-deploy-log.md как обязательный шаг перед раскаткой.

Commit `bea971c`: 11 файлов, +283/-20.

### Блок B (скип)

Орк-промпт явно сказал: «Если в фикстурах не найдёшь хороших образцов без PII — остановись и спроси пользователя». 5 реальных корпоративных PDF/DOCX/XLSX без PII у меня нет, выдумывать опасно (могут оказаться нерепрезентативные). Спросил пользователя — он подтвердил «скип Блока B сейчас». Сэкономили ~30 минут агент-времени на бесполезный smoke-test.

### Блок C (1.5 часа)

Самая большая часть волны. Орк-промпт указал внутреннюю последовательность: C1.a (schema/ENV/GIN) → C1.b/c параллель (backend+RBAC+тесты) → C2 (frontend Grid). Я **сжал** C1.b и C1.c в одного агента — integration-test без backend-модуля бессмыслен, а 1-строчная RBAC-правка не стоит отдельного агента. Получилось 3 последовательных агента, каждый верифицирован грепами и тестами перед запуском следующего.

**C1.a-агент** (Prisma+ENV+GIN): хорошо отработал, нашёл реальную развилку — `TableAutomation` в ТЗ написан «без relation на Table», но Prisma 7 жёстко требует обратной связи при наличии `Table.automations[]`. Сам решил добавить inverse relation с `onDelete: Cascade` — единственный технически возможный путь. Это правильное решение, но важно что агент **зафиксировал развилку** в отчёте.

**C1.b+c-агент** (backend tables module): сделал 19 эндпоинтов, добавил TypedConfigService.smartTables getter (по образцу `cfg.document`/`cfg.workspace`), 9 RBAC-строк с manager-self-scope. 19 unit-тестов pass. Развилка: integration-test через testcontainers требует dev Postgres — пометил `it.skip` с TODO.

**C2-агент** (frontend Glide Data Grid): самая сложная часть. SSR с Canvas-grid'ом обычно проблематичен — агент решил через `next/dynamic({ssr:false})` + `'use client'` в каждом client-файле + import CSS внутри client-only модуля + portal `<div id="portal" />` для overlay. Build прошёл без warning'ов. 14 типов работают, 3 computed read-only, 7 «не поддерживается в Фазе 1» — корректно показывают placeholder без runtime-crash'а.

Известное ограничение, которое **обнаружил агент сам**: Glide Data Grid Bubble cells (status/selectSingle/selectMulti) не входят в `EditableGridCell` — overlay-edit не поддержан. Фаза 1 — display-only с явным комментарием в коде. Доработка popover-редактором в Фазе 2. Это честное признание ограничения — лучше, чем тихо выкатить «работает» и ловить баги в проде.

Commit `acfd5dc`: 37 файлов, +6267/-1467.

## Что вышло

### Метрики

- Backend typecheck: OK (0 ошибок).
- Backend lint: 1 pre-existing error в `billing/services/billing.service.ts:56` (YEARLY_MONTHS unused, не моя правка, скорее всего от Волны 2 refactor). Frontend lint: OK (0 ошибок).
- Backend tests: 19/19 для `tables/`, 45/45 для `referrals/`. Существующий failure в `tenant.guard.spec.ts` (4 fail) — pre-existing, не связан.
- Frontend tests: 115/115 passed (включая существующие).
- Frontend build: OK, `/tables/[id]` помечен `ƒ (Dynamic)`.

### Архитектурно

- 5 новых Prisma-моделей (+24 enum-значения TablePropType) добавлено корректно с обратными relations и индексами (`@@index(tenantId, archivedAt)`, `@@index(tableId, order)`, `@@index(tableId, archivedAt)`, `@@index(entityId)`).
- GIN-индекс `table_row_cells_gin` — обёрнут в `DO $$ ... END $$` с `IF EXISTS` гардом (так сделаны соседние блоки в `postgres-init.sql`).
- Новый `TypedConfigService.smartTables` getter — соответствует проекту-паттерну (cfg.document/cfg.workspace).
- 19 CRUD-эндпоинтов под `CookieAuthGuard+TenantGuard` + Swagger + Zod-валидация.
- Frontend разделение слоёв ApiDto → DomainModel → UiModel — соблюдено.
- Glide Data Grid через `next/dynamic` — Canvas-grid не падает на SSR.

### Сделано в добивке Волны 2

- 404 на `/legal/partner-offer` устранена (placeholder-страница).
- Ложная активация кнопки «Вывести» (когда есть ИНН, но нет банковских реквизитов) устранена через computed `hasPayoutDetails: boolean` в backend response + честная проверка на фронте.
- `text-white` на цветном фоне в `ReferralPromoStrip` заменён парным токеном `text-emerald-50`.
- second-brain `03_processes/referral-program.md` синхронизирован с реальным кодом (one-click flow вместо обязательного ИНН).
- Новая `01_projects/referrals.md` — карточка проекта по фактам кода (не из ТЗ).

## Чему научился

### 1. Делегация ≠ абдикация

Орк-промпт жёстко сказал «сам код не пишешь — оркестрируешь». Соблюл строго. Но **верификация после каждого агента — за мной**: greps, typecheck, tests. Память `feedback_agents_can_lie_about_edits` — это правда. C1.a-агент сам признал, что вынес Decimal-формат `Decimal(20,10)` (а не `@db.Decimal(20,10)` как в моих инструкциях) — это маленький факт, но если бы я не проверил schema.prisma грепом, мог бы пропустить.

### 2. Glide Data Grid SSR — известный паттерн

Canvas-grid в Next.js 14 server components — это `next/dynamic({ssr:false})` + `'use client'`. Тот же паттерн работает для любой Canvas-библиотеки (Konva, Fabric, PixiJS). Зафиксировать в `code-pitfalls.md` если ещё нет.

### 3. Prisma 7 строже Prisma 5 на inverse relations

Если в `Table` написать `views TableView[]`, Prisma 7 требует `table Table @relation(...)` в `TableView` — без этого `prisma:generate` падает с `P1012 missing opposite relation field`. Раньше можно было хоть как-то жульничать. В ТЗ smart-tables был неправильно описан TableAutomation без inverse — агент C1.a поймал и поправил. Этот факт стоит **записать в `02_architecture/code-pitfalls.md`** при следующей дистилляции.

### 4. Bubble Cells в Glide Data Grid не редактируются inline

Это документированное ограничение Glide. Status/selectSingle/selectMulti отображаются как красивые цветные пузырьки, но overlay-edit не открывается. Для Фазы 1 это норма (display-only), для Фазы 2 нужен кастомный popover поверх Bubble. Этот факт стоит запомнить если будут другие фичи с tag/multi-select.

### 5. Pre-existing tech debt — фиксируй, но не лечи в чужой волне

Орк-промпт прямо предупредил: «не чини legacy parseInt в typed-config.service.ts, не удаляй deprecated CLONE_ASK_PER_USER_PER_DAY, не трогай billing.service.ts YEARLY_MONTHS». Соблюл. Это правильный scope-discipline: одна волна = одна цель, технический долг — отдельные задачи. Иначе диффы становятся неуправляемыми и code review невозможен.

### 6. Орк-промпты должны явно говорить, на каком языке писать UI/копи

В прошлых сессиях были случаи, когда агент писал «Type» / «Name» / «Actions» — я **прицельно** в промпте C2 потребовал «Тип»/«Название»/«Действия» с примерами. Результат: 0 английских слов в UI. Память `feedback_admin_ui_russian_only` работает только если её **явно повторять** в каждом промпте под-агенту.

### 7. Когда орк-промпт явно противоречит факту — фиксируй развилку, не «чини сам»

Пример: Орк-промпт описал TableAutomation без inverse relation в Prisma — это неправильно для Prisma 7. C1.a-агент зафиксировал развилку в отчёте + сам поправил с разумной семантикой (`onDelete: Cascade`). Это правильное поведение — лучше один раз пометить и оптимально решить, чем падать на `prisma:generate`. Memory `feedback_propose_best_solution_with_reasoning`.

## Открытое перед финалом

- **Push не сделан** — жду явного «push» от пользователя.
- **Блок B** (document-ingest Фаза 0 smoke-test) перенесён в отдельную сессию — нужны 5 реальных корпоративных фикстур без PII.
- **Smart-tables Фазы 2-14** — каждая отдельной сессией. Самая важная для конкуренции с Teamly — Фаза 5 (Excel-импорт со schema-инференсом), но она зависит от document-ingest Фазы 1 (DCS sidecar), которая в свою очередь требует прохождения гейтов Фазы 0 (Блок B).
- **Прод-выкат** Волн 1+2+3 — общий cut'ом. Инструкция накапливается в `docs/operations/prod-deploy-log.md` раздел «🚨 Накоплено к выкату».
