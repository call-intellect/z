# ТЗ (единое) — Кабинет Коры: доводка редизайна + рефералка (вход/баннер/кабинет) + хаб «Оцифровано»

**Дата:** 2026-06-14
**Статус:** ready-to-implement (Часть A — A1–A11 · Часть B — B1–B12 · Часть C — C1–C5)
**Основание:** перепроверка реализации редизайна Ф0–Ф10 ([2026-06-13-cabinet-redesign-rhythms-and-decision-queue.md](2026-06-13-cabinet-redesign-rhythms-and-decision-queue.md), 17-агентная верификация) + запросы владельца в этой сессии. Все факты — с `file:line`.
**Что это:** ЕДИНЫЙ план, объединяющий три проработки сессии — (A) доводка редизайна (баги/долги светлой темы + делаемые-сейчас пункты), (B) рефералка (вернуть вход + role-баннер + редизайн кабинета под modern/), (C) видимый хаб оцифрованных регламентов/процессов. Заменяет три отдельных ТЗ.

> **Базовая реализация Ф0–Ф10 — настоящая и протестирована** (backend `tsc`+frontend `tsc` чисты; **frontend 464/464**, **backend 5053/0**). Это ТЗ — доводка до «максимально» + две новые витрины, спрятанные редизайном.
> **Корень B и C:** Ф0 сжал меню и **выкинул из навигации** реферальный кабинет `/referrals` (остался только промо-полосой в шапке) и витрину регламентов `/regulations` (достижима лишь через `/memory → Реестры → «Правила»`). Оба экрана целы — задача про витрину/доверие.

---

## 0. Инварианты (глобально, не нарушать)

Только русский UI · парные/семантические цветовые токены, **тема-зависимо (light/dark)** · Ship-On (ON + kill-switch) · никаких рейтингов людей · мобилка = быстрый взгляд по роли · Б-2/Б-3/Б-6 (один источник правды / полные сущности / 3 состояния виджета).

**🔴 Глобальный урок светлой темы (корень дефекта приёмки — не повторять нигде):** **НЕ использовать `CHART.{mint|amber|cyan|teal|lime}` как ЦВЕТ ТЕКСТА/числа** (L≈0.85 → светлое-на-светлом на белой карте). Цвет текста/акцент-чисел — только парные `--chip-*-fg` / `text-fg-*` / `var(--text-primary)`. `CHART.x` — **только** заливка/штрих графика (recharts `fill`/`stroke`/градиент-стопы). Белые оверлеи `oklch(1 0 0 / 0.0X)` как фон плашек → тема-зависимый `--surface-inset`. Машинный гард (A1.1) распространить на весь новый код этого ТЗ.

**💰 Деньги:** в дашбордах-метриках компании ₽ запрещены, НО **реферальная программа — разрешённый денежный домен** (заработок партнёра ≠ финансовый KPI работы) — ₽ показывать можно. **Авто-зачёт реф-выплат в подписку (биллинг) — вне scope** (владелец: «пока автоматических не надо, доработаем дальше»).

---

## Ключевые решения (развилки — решены)

| Часть | Р | Решение | Почему |
|---|---|---|---|
| A | свет-токены | Статус-цвета-как-текст → парные `--chip-*-fg` (есть в обеих темах, `tokens.css:45-55/168-179`); белые оверлеи → новый `--surface-inset`; `hover:bg-white/5` → `--surface-hover` | один источник токенов, flip автоматом; не заводить отдельный «chart-text» набор |
| A | sourceBlockIds | Петля next-step **НЕ откладывать** под «нужна миграция» — миграцию в этой ветке уже делали; добавить `IntakeIssue.sourceBlockIds String[]` сейчас | «миграция» — не блокер; размыкает «% доведённых решений» |
| A | env.schema | Мёртвый `DASHBOARD_THEME_SILENCE_ENABLED` + raw `process.env.USE_APPOINTMENT_FOR_PERSON_ROLES` → завести в `env.schema.ts` (оживить kill-switch, убрать класс raw-env) | документированный рубильник обязан работать |
| B | баннер-аудитория | «Окупается N/3» — `LEADERSHIP_ROLES` (owner/admin/coo + super); рядовой `manager`/`null` → баннер-«заработок» | граница «руководитель vs простой менеджер»; `useEffectiveOrgRole` НЕ годится (схлопывает admin/coo) |
| B | баннер-механика | Заменить `ReferralPromoStrip` единым persistent `<ReferralRewardBanner>` с живым прогрессом, морфит по состоянию (нет профиля → «0/3, создай ссылку»; N<target → шкала; N≥target → «окуплено, дальше заработок») | старая полоса прячется при наличии профиля и статична |
| B | прогресс N/3 | `N = stats.activePaying`; `target = ceil(60 000/20 000)=3` (из `DEFAULT_BASE_MONTHLY_PRICE_KOPECKS`/`REFERRAL_COMMISSION_KOPECKS`, не хардкод) | эндпоинт готов, формула самонастроится |
| B | авто-биллинг | Авто-окупаемость подписки при N≥3 — **НЕ делаем** (информационный баннер) | деньги → отдельное решение владельца (отложено) |
| B | кабинет-визуал | Кабинет `/referrals` — **только визуал** на modern/ (glass/StatCard/BarTrend/ModernTable/gauge); API/состояния/логика вывода/ИНН-гейт не трогать | минимальный безопасный diff, кабинет функционально готов |
| C | хаб-модель | Хаб на `/regulations`-API (уже единый: regulation/process/policy/instruction); `ProcessTemplate` (`/processes`) — отдельной вкладкой, модели не сливать | `/regulations` отдаёт ровно нужные 4 типа |
| C | провенанс | «Откуда собралось» (дословные цитаты-источники) — **в scope** (новый `:id/sources`) | «красота и доверие», дифференциатор; данные есть (`IdeaBlockEvidence.quote`) |
| C | /policies | Заглушку ComingSoon заменить живыми данными в хабе (API живой) | заглушка в проде подрывает доверие |

---

# ЧАСТЬ A — Доводка редизайна (баги/долги приёмки)

> Из 17-агентной верификации: базовые фазы реальны и зелёные, но есть системный дефект светлой темы и ~8 пунктов, помеченных `[x]`/отложенными, которые делаются сейчас без блокеров.

## A1. Светлая тема — читаемость 🔴 (owner #1)
**Корень:** `b07aabe3` перевёл поверхности и нейтральный текст на CSS-переменные, но статус/чарт-цвета остались захардкоженными светлыми (`tokens.ts:35-39`) и применяются как цвет текста → нечитаемо на белых картах.
- **A1.1 — статус-цвета как текст → `--chip-*-fg`:** 47× `color: CHART.{mint|amber|cyan|teal|lime}` в ~18 файлах + общие примитивы [StatCard.tsx:54](frontend/src/ui/components/dashboard/modern/StatCard.tsx#L54), [AreaTrend.tsx:52](frontend/src/ui/components/dashboard/modern/AreaTrend.tsx#L52), `GaugeCard`, [ModernTable.tsx:30](frontend/src/ui/components/dashboard/modern/ModernTable.tsx#L30), `BarTrend`. Маппинг mint→success, amber→warning, cyan/teal→info, lime→success, danger→danger, lavender→lavender. **НЕ трогать** `CHART.x` как `fill`/`stroke` в recharts. + машинный гард (ESLint/тест-греп) против `color: CHART.{...}`.
- **A1.2 — белые оверлеи → `--surface-inset`:** ~70× `background:'oklch(1 0 0 / 0.0X)'` (плитки/строки/треки), общие `ModernTable:30,119`, `GaugeCard:60,78`, `BarTrend:51`. Завести `--surface-inset`/`--surface-inset-strong`/`--border-inset` (обе темы) → заменить литералы.
- **A1.3 — hover:** 9× `hover:bg-white/5` → `--surface-hover` (flip).
- **A1.4 (опц, low)** — anti-FOUC inline-скрипт темы в `app/layout.tsx` до гидрации.

**Статус:** [ ]

## A2. merge отделов — полный перенос FK
**Корень:** [departments.service.ts:432-523](backend/src/modules/departments/services/departments.service.ts#L432) пропускает FK; источник soft-deleted → `SetNull` не срабатывает → висячие ссылки. Дополнить переносом: `Metric.attachedToDepartmentId` (`schema:6089`), `Interaction.counterpartDepartmentId` (`:5420`), `Project.departmentId` (`:8797`), `Person.primaryDepartmentId`, `DepartmentHead`, `Entity`(DepartmentEntity), `PersonRole`, дочерние `parentDepartmentId` (`:4693`). + регресс-тест «после merge 0 ссылок на источник».
**Статус:** [ ]

## A3. env.schema — оживить рубильник + убрать raw process.env
- `DASHBOARD_THEME_SILENCE_ENABLED` отсутствует в `env.schema.ts` → ENV-kill-switch мёртв (живёт только AdminSetting). Добавить.
- [persons.service.ts:55](backend/src/modules/persons/services/persons.service.ts#L55) raw `process.env.USE_APPOINTMENT_FOR_PERSON_ROLES` → завести в `env.schema.ts` + `cfg`. Грепнуть весь класс `process.env\.` по `backend/src` (вне env.schema/тестов), починить разом.
**Статус:** [x] — `DASHBOARD_THEME_SILENCE_ENABLED`+`_WEEKS`+`USE_APPOINTMENT_FOR_PERSON_ROLES` в `KnowledgeCoreSchema` (без нового `.merge`); `persons.service` читает через `cfg.persons.useAppointment`. Широкий класс raw-env (Concierge-блок typed-config, orchestrator.config, `@Cron(process.env…)`-декораторы) оставлен вне scope (декораторы непереводимы на DI) — строка в реестр не-сделано.

## A4. intake — снять двойной учёт (Входящие ↔ Подтверждения)
**Корень:** Ф4 обещал «`/intake` = вкладка-зеркало», но [pending-actions.service.ts:83-99](backend/src/modules/pending-actions/services/pending-actions.service.ts#L83) считает intake в очереди И жив самостоятельный `/intake` — двойной счёт (потерян, нет в не-сделано). Сделать `/intake` зеркалом провайдера, учитывать intake один раз.
**Статус:** [ ]

## A5. ack «✓ записано в память» на чек-ине (и заметке)
**Корень:** ТЗ Ф5б требовал dump+чек-ин+заметку; сделан только dump ([DumpClient.tsx:52](frontend/app/(authenticated)/dump/DumpClient.tsx#L52)). [MyCheckInsClient.tsx:91](frontend/app/(authenticated)/me/check-ins/MyCheckInsClient.tsx#L91): «Чек-ин сохранён» → «✓ записано в память».
**Статус:** [x] — inline-плашка + `toast.success('✓ Записано в память компании')` по образцу dump; ветки ошибок не тронуты.

## A6. R9 — подсветка «спросил руководитель» на open_question
**Корень:** Р9 базового ТЗ — детектор ловит любой вопрос ✅, но `askedByManager` только в комментарии DTO, не вычисляется. [cora-feed.service.ts:419](backend/src/modules/activity-feed/services/cora-feed.service.ts#L419): в `select` добавить автора (`commitmentAuthorPersonId`/subject), резолв роли (глава отдела/менеджер), `askedByManager` в payload+DTO; FE-бейдж в `FeedClient`. Без миграции.
**Статус:** [x] — 🔴 ловушка: `commitmentAuthorPersonId` для вопросов всегда NULL (commitment-only). Авторство резолвится через `IdeaBlockEntity(role='subject')→Entity→Person` (батч, 4 запроса, без N+1); «руководитель» = глава отдела ИЛИ owner/admin/coo; payload.askedByManager → domain → бейдж «Спросил руководитель» в FeedCard (парные токены). Нет резолва → false. Тест: 3 кейса.

## A7. Б-2 автотест-инвариант + valueStrip кликабельность
- **A7.1** — автотест «число Требует вас на Сегодня == счётчик `/actions`» (cross-surface; сейчас [director-dashboard.requires-action.test.ts](frontend/src/domain/__tests__/director-dashboard.requires-action.test.ts) — только маппинг).
- **A7.2** — [ValueStripWidget.tsx:94](frontend/app/(authenticated)/dashboard/widgets/ValueStripWidget.tsx#L94): 5 счётчиков обычные `<div>` → обернуть в `Link` (встречи/задачи/решения/память/обещания), §90 «кликабельны до источника».
**Статус:** [ ]

## A8. /week — блок «Висят без ответа ≥3 дней»
**Корень:** Ф2 п.1bis обещал, перенесён в Ф8.6, на `/week` не появился (на Сегодня плашка есть). В [WeekDesktopClient.tsx](frontend/app/(authenticated)/week/WeekDesktopClient.tsx) добавить блок поверх `GET /probe/control` + лента `open_question`. Тема-зависимо.
**Статус:** [ ]

## A9. F8.5 — экспорт построчной таблицы для планёрки
**Корень:** коммит `10bd217e` заявил «+ export», кода нет. [WeeklyPerPersonWidget.tsx](frontend/app/(authenticated)/dashboard/operations/weekly/WeeklyPerPersonWidget.tsx): кнопка «Скачать для планёрки» → CSV (Человек·Что·План·Факт·Что мешало), клиентский blob.
**Статус:** [ ]

## A10. Петля next-step → `sourceBlockIds` + `DecisionTaskLink` (миграция)
- Миграция `IntakeIssue.sourceBlockIds String[]` (аддитивно, nullable). При next-step→intake писать `sourceBlockIds`; при создании Issue из IntakeIssue линковать `DecisionTaskLink` (`linkType='derived'`) → `getDecisionThroughput` засчитает встречные решения. Снять строку из `04_не-сделано`.
**Статус:** [ ]

## A11. Доводка (med/low)
- **A11.1** — `weekly-per-person.service` PLAN: добавить «задача в активном Cycle недели» ([weekly-per-person.service.ts:176](backend/src/modules/operations/services/weekly-per-person.service.ts#L176)).
- **A11.2** — mobile subset-guard для `MOBILE_EXEC_TABS`/`MOBILE_MANAGER_TABS` в [nav-subset.spec.ts](frontend/src/ui/components/app-shell/nav-subset.spec.ts) (+ паритет EXEC «Память»→/chat vs десктоп /memory).
- **A11.3** — `/month` мобайл-клиент или явный «откройте на компьютере».
- **A11.4** — «Активность команды» (7bis) на Сегодня (`recognition`/`task`/`decision`, топ-5) в [DirectorDashboardClient.tsx](frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx).
- **A11.5** — VerdictBar degraded-state: пробросить backend `degraded` ([director-dashboard.dto.ts:284](backend/src/modules/dashboard/dto/director-dashboard.dto.ts#L284)) в domain → не только `collectorDown`.
- **A11.6** — свести `primary-nav.ts` + `nav-config.ts` к одному источнику мобайл-нав (low).
**Статус:** [ ]

---

# ЧАСТЬ B — Рефералка: вход + баннер + редизайн кабинета

> Кабинет `/referrals` цел (3 состояния, полный API, выплаты, воронка, recharts-график), любой юзер создаёт ссылку без ИНН (`referrals.controller.ts:94`). Экономика в коде: подписка `6_000_000` коп. (60k, `seat.service.ts:43`), реф `2_000_000` коп. (20k, `referrals.service.ts:50`) → 60/20=3. `stats.activePaying` = «N платящих» (готово).

## B1. Вернуть `/referrals` в меню
В [nav-config.ts](frontend/src/ui/components/app-shell/nav-config.ts) пункт **«Партнёрка»** `/referrals` (icon Gift/HandCoins), секция СИСТЕМА, все роли. `nav-subset.spec` зелёный.
**Статус:** [ ]

## B2. Backend: данные для шкалы прогресса
`GET /api/v1/referrals/me/reward-progress` → `{ hasProfile, activePaying, targetClients, monthlyEarnedKopecks }` (target из `seat.service.ts:43`/`referrals.service.ts:50`). Покрывает pre-profile-кейс (сейчас `stats` отдаёт `null` без профиля, `referrals.controller.ts:201`). Zod-DTO+Swagger, без миграций.
**Статус:** [ ]

## B3. Баннер `<ReferralRewardBanner>` (морфит по роли+состоянию)
**Файлы:** новый `frontend/src/ui/components/app-shell/ReferralRewardBanner.tsx` + хук `useReferralBannerVisibility.ts` (по образцу `useReferralPromoVisibility.ts`, но БЕЗ «прятать при наличии профиля»).
- Роль: `useAuth().currentOrgRole` + `normalizeRole` + `LEADERSHIP_ROLES`/`isSuperAdmin` → `isLeader`. Гейт по РОЛИ первичен (coo на «Сегодня» приземляется на `/me`, `DashboardRouter.tsx:34`). Path-фильтр: prefix `/dashboard` + `/week` + `/month` (руководитель), `/me` prefix (рядовой); прятать `/settings`/`/admin`/`/referrals`.
- **Руководитель:** нет профиля → «Начни пользоваться Корой бесплатно — приведи 3 компании (×20 000 ₽/мес), подписка окупится. Осталось привести: **3 из 3**»; N<target → живая шкала «осталось {target−N} из {target}»; N≥target → «Подписка окуплена 🎉, дальше чистый заработок».
- **Рядовой:** «Дополнительный заработок — сделай ссылку, отправь знакомым руководителям, 20 000 ₽/мес с компании».
- Дизайн: небольшой, заметный, тема-зависимый — парные классы как [IncompleteSetupBanner.tsx:56](frontend/src/ui/components/IncompleteSetupBanner.tsx#L56) или `glass()`; шкала на `--chip-success-bg/fg`. **НЕ** копировать `emerald-*` из старой полосы. Трекинг — `referralsApi.trackPromoEvent`.
**Статус:** [ ]

## B4. Монтирование + ретайр старой полосы
Смонтировать `<ReferralRewardBanner/>` в [AppShell.tsx:57](frontend/src/ui/components/app-shell/AppShell.tsx#L57) (слот `ReferralPromoStrip`, рендер один раз для всех дашбордов). **Убрать** `ReferralPromoStrip` (нет двойного промо), перенести whitelist в новый хук. Мобильный компакт-вид.
**Статус:** [ ]

## B5. Кабинет — каркас на modern/
[ReferralsClient.tsx](frontend/app/(authenticated)/referrals/ReferralsClient.tsx): фон → `MODERN_PAGE_BG`, блоки-обёртки → `glass()`. Сохранить 3 состояния A/B/C (`:36-54`). _(Сейчас кабинет на семантических токенах, но плоский — 0 импортов modern/.)_
**Статус:** [ ]

## B6. Денежные плитки → `StatCard`
[WithdrawalStrip.tsx](frontend/app/(authenticated)/referrals/components/WithdrawalStrip.tsx): Активных клиентов · Доход в этом месяце (sparkline по месяцам) · **Всего заработано** (новая, `totalEarnedKopecks`) · К выводу + `WithdrawButton` (гейт `canWithdraw` не трогать). Градиент-иконки `GRAD`+glow; числа — крупные hero, валюта парными `text-fg-*`.
**Статус:** [ ]

## B7. График дохода → modern `BarTrend`
[IncomeChart.tsx](frontend/app/(authenticated)/referrals/components/IncomeChart.tsx): `LineChart` → `BarTrend` (доход по месяцам, столбцы с градиентом, ряд готов `:33`) + крупное hero-число «заработано всего» + дельта. Опц. переключатель «по месяцам/накопительно» (→ `AreaTrend`). Тултип `ChartTip` тема-зависимый.
**Статус:** [ ]

## B8. Воронка → modern
[FunnelCard.tsx](frontend/app/(authenticated)/referrals/components/FunnelCard.tsx): 4 ступени (Клики→Регистрации→Первые оплаты→Активны, с %) → горизонтальные градиент-бары/`DonutCard`-конверсия на `glass()`, иконки `GRAD`, % парными токенами.
**Статус:** [ ]

## B9. Мотивационный герой → градиент-герой
[MarketingHero.tsx](frontend/app/(authenticated)/referrals/components/MarketingHero.tsx): сохранить копи («20 000 ₽/мес с каждого», «5→100 000 ₽», «20→400 000 ₽», «без потолка и срока», `:31-66`), оформить градиент-героем с «плавающими плашками»-примерами + заметный призыв. `compact`-режим в том же языке.
**Статус:** [ ]

## B10. Ссылка/QR + выплаты + таблицы → modern
`CreateLinkCard`/`ReferralLinkCard` (ссылка+QR на `glass()`, читаемый QR в обеих темах), `PayoutsTable`/`ClientsTableMasked` → `ModernTable` (тема-зависимые разделители, НЕ белые оверлеи — A1.2; маскирование сохранить), `PayoutDetailsCard` — modern-форма (ИНН-гейт вывода не трогать).
**Статус:** [ ]

## B11. Гейдж «окупаемость» в кабинете
Новый блок в `ReferralsClient`: руководителю — `GaugeCard` «Окупаемость подписки: {activePaying} из {target}» (данные те же, что баннер B2/B3); рядовому — gauge «Активных клиентов»/«к выплате». Визуально согласован с баннером.
**Статус:** [ ]

## B12. Обе темы + мобилка (кабинет)
Прогон `/light-theme`: дата-виз читаема на белом (текст/числа парными fg, не `CHART.x`). Мобильный кабинет: плитки/график/воронка в колонку, hero-компакт, таблицы — скролл/карточки.
**Статус:** [ ]

---

# ЧАСТЬ C — Видимый хаб «Оцифровано» (регламенты/процессы/инструкции/политики)

> Движок оцифровки (specialist 3.1 + компилятор `compile-org-document`, флаг ON) собирает `Regulation/Process/Policy/Instruction` из встреч с шаблонами/дедупом/версиями (`CardVersion`)/provenance (`sourceBlockIds`). Просмотрщик [RegulationsListClient.tsx](frontend/app/(authenticated)/regulations/RegulationsListClient.tsx) (859 строк) готов и богат, но **спрятан** (только через `/memory → Реестры → «Правила»`).

## C1. Поднять `/regulations` в видимый пункт «Оцифровано»
[nav-config.ts:307](frontend/src/ui/components/app-shell/nav-config.ts#L307): пункт **«Оцифровано»** → `/regulations`, секция РАБОТА, роли LEADERSHIP+manager (read), icon BookText. «Правила» в [memory/page.tsx:43](frontend/app/(authenticated)/memory/page.tsx#L43) → алиас на хаб. `nav-subset.spec` зелёный.
**Статус:** [ ]

## C2. Хаб: 4 типа + вкладка «Шаблоны процессов» + живой /policies
- Верх хаба — счётчики-чипы (из C4); переключатель типа есть.
- Вкладка «Шаблоны процессов» = существующий [ProcessTemplatesClient.tsx](frontend/app/(authenticated)/processes/ProcessTemplatesClient.tsx) (модель `ProcessTemplate`), модели не сливать.
- `/policies` — убрать `ComingSoonPage` ([ComingSoonPage.tsx:76](frontend/src/ui/components/ComingSoonPage.tsx#L76)), политики живьём (API живой) → `/policies` redirect `/regulations?kind=policy`.
**Статус:** [ ]

## C3. Провенанс «откуда собралось» (дифференциатор)
- 🔴 Бэк: `GET /api/v1/regulations/:id/sources?kind=` → `sourceBlockIds[] → IdeaBlock → IdeaBlockEvidence.quote` + `{встреча(название/дата/ссылка), дата}`. Zod-DTO+Swagger, тот же гейт доступа, что `:id`.
- 🟡 Фронт: в detail-панели `RegulationsListClient` аккордеон «Источники» с дословными цитатами + ссылкой на встречу (сейчас только число «Источников: N», `RegulationsListClient.tsx:499`).
**Статус:** [ ]

## C4. Счётчик «Оцифровано» на Сегодня + «Недавно оцифровано»
- 🟡 Бэк: агрегат `GET /api/v1/regulations/summary` → `{regulations, processes, instructions, policies, weekDelta}` (свести 4 раздельных `structure/.../count`, [structure.controller.ts:63](backend/src/modules/structure/structure.controller.ts#L63), + instruction + дельта).
- 🟡 Фронт: на Сегодня — компактный виджет «Оцифровано: N регламентов · M процессов · K инструкций» (тема-зависимый, без денег) → клик в хаб. В хабе — блок «Недавно оцифровано» (`list(sort=updatedAt)` + бейдж черновиков `extractionStatus`).
**Статус:** [ ]

## C5. Долг Instruction — строка в реестре
Добавить в `second-brain/04_не-сделано/README.md`: «Instruction — версии/триаж/CardVersion + цитаты не дотянуты (упрощённый `upsertInstruction`, `specialist-3-1-regulations.service.ts:1103`)». Сверить устаревшую строку 34 (A7-компилятор).
**Статус:** [ ]

---

## Порядок реализации

1. **A1** (светлая тема — owner #1, заметно) → быстрые доводки **A3 · A5 · A6** (env, ack, R9).
2. **B1–B4** (вернуть рефералку + баннер — быстрая видимая ценность) → **B5–B12** (редизайн кабинета).
3. **A4 · A7 · A8 · A9** (intake, Б-2+valueStrip, /week-блок, экспорт).
4. **A2 · A10** (merge-FK, петля sourceBlockIds+миграция).
5. **C1–C4** (хаб «Оцифровано») → **C3** (провенанс).
6. **A11 · C5** (доводка + долг Instruction).

Каждая фаза — Ship-On, зелёная верификация перед коммитом.

## Прод-операции при выкате

- **Единственная миграция:** `IntakeIssue.sourceBlockIds String[]` (A10) → `prod-deploy-log.md` Шаг 4 (авто `migrate deploy`).
- **Новые ENV** (A3): `DASHBOARD_THEME_SILENCE_ENABLED`, `USE_APPOINTMENT_FOR_PERSON_ROLES` (рабочие дефолты, действий владельца не требуют) → Шаг 1.
- **Новые эндпоинты** (B2 `referrals/me/reward-progress`, C3 `regulations/:id/sources`, C4 `regulations/summary`) → Swagger smoke Шаг 12.
- **Флаги:** опц. kill-switch `referral.reward_banner.enabled` (ON) → строка в `feature-flags.md`. Прочее без флагов.
- Остальное (вся Часть B-визуал, A1/A4/A7–A9/A11, C1/C2/C4-фронт) — без прод-операций, `docker compose up -d --build`.

## Верификация (gate каждой фазы)

`bun run typecheck` + `lint` + `build` (оба пакета) + профильные тесты зелёные. Доп.: машинный гард A1.1 (запрет `color: CHART.{...}`, распространить на `referrals/`); регресс-тест A2 (перенос FK); cross-surface тест A7.1; тест морфинга баннера B3; `:id/sources` уважает доступ C3; `nav-subset.spec` зелёный (B1/C1); визуальная сверка обеих тем (light/dark) + мобилки; лингвопрогон (только русский).

## Итог

**Не реализовано (единый ТЗ-контракт, реализация не начата).** Объединяет три проработки сессии. **A** — доводка редизайна до «максимально»: системный контраст светлой темы (47× `CHART.x`-как-текст + общие примитивы → парные `--chip-*-fg`; белые оверлеи → `--surface-inset`) + 8 делаемых-сейчас пунктов (intake-двойной-учёт, ack чек-ина, R9-подсветка, Б-2-автотест+valueStrip, /week-блок, F8.5-экспорт, петля sourceBlockIds) + тех-огрехи (merge-FK, env.schema). **B** — рефералка: вернуть в меню + persistent role-баннер с живым «N из 3» (данные/экономика готовы) + редизайн кабинета под modern/ (glass/StatCard/BarTrend/ModernTable/gauge, мотивационный герой сохранён) — авто-биллинг вне scope. **C** — хаб «Оцифровано»: поднять спрятанный `/regulations` в видимый пункт, единый экран 4 типов + вкладка шаблонов, провенанс «откуда собралось» (цитаты), счётчик на Сегодня, убрать заглушку `/policies`. **Заменяет** отдельные ТЗ: `2026-06-13-cabinet-redesign-fixes-and-finishables.md`, `2026-06-14-cabinet-referral-banner-and-digitized-knowledge-hub.md`, `2026-06-14-referral-cabinet-modern-redesign.md`.
