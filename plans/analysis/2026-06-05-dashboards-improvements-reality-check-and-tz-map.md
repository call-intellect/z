---
type: analysis
status: research-complete
date: 2026-06-05
owner: Сергей (владелец продукта)
relates_to:
  - plans/analysis/2026-06-05-dashboards-prostym-yazykom.md
  - plans/analysis/2026-06-04-dashboards-audit-old-vs-new-and-plan-fact.md
  - plans/tz/2026-06-02-main-screen-umbrella-tails-finalization.md
tags: [дашборды, reality-check, tz-map, вектор-цели, план-факт]
---

# REALITY-CHECK дашбордов + карта ТЗ (вход для tz-author/tz-orchestrator)

Опорный документ для набора ТЗ на улучшения дашбордов. Собран по СВЕЖЕМУ dev (после волн `meeting-identity` Ф0–Ф5 и `pipeline-unblock` Ф1–Ф11) — проверено 6 агентами + git. **Все ссылки `путь:строка` — на момент 2026-06-05, перед правкой перечитать символ.**

## Решения владельца (батч 2026-06-05, не пересматривать)
| # | Развилка | Решение | Применяется в |
|---|---|---|---|
| Р1 | Якорь «главной цели» для Вектора | **Новый флаг `Goal.isPrimary`** (одна главная цель на tenant), не агрегат по weight (weight занят расчётом alignment) | ТЗ-B |
| Р2 | Приватность настроения на «Пульсе сотрудника» | **Владелец/админ видят настроение ВСЕГДА** (gate по `analyticsOptIn` для owner/admin НЕ вводим). Требование: выровнять текст-обещание приватности, чтобы UI не обещал лишнего | ТЗ-G |
| Р3 | Личный кабинет | **Объединить 5 пунктов `/me/*` в кабинет «Я» с вкладками + редиректы старых URL** | ТЗ-E |
| Р4 | Привязка к людям | **Добавить `Goal.ownerPersonId` + `commitmentAuthorPersonId`** (prisma db push, без migrate) | ТЗ-F, ТЗ-D |

## Уже сделано на dev (ТЗ НЕ писать — только при необходимости прод-выкат)
- **Person владельца** — `createForOwner`→`ensurePersonForUser` + `backfill-owner-person.ts` (коммит `7cffb1e3`). Остаток: прогон backfill на проде (Шаг 8 prod-deploy-log).
- **Кнопка «Спросите Кору»** — РАБОТАЕТ (`DirectorDashboardClient.tsx:405-418` → `AssistantSidebar.tsx:113-125`); устарел лишь комментарий «TODO Б.4».
- **«Структура компании»** — уже под Hero (sticky-полоса), не наверху.
- **Identity участника + `IdeaBlockEntity.role='subject'` (reasoning-семейство) + `Task.assigneeUserId` по участникам встречи** — фундамент готов (`meeting-identity` Ф0–Ф5).
- **Новая архитектура главной** (KpiHero, DashboardTabs, MainEmptyState, requiresAction-блок), **раздел «Команда»/доступы** (EmployeeCapabilityOverride), **dashboards-wow-polish** — влиты в dev.

## Координация (не дублировать)
- **`/dashboard/people-at-risk`** имеет незакрытое ТЗ `plans/tz/2026-06-02-main-screen-umbrella-tails-finalization.md` (Фаза 5, все `[ ]`, в dev нет). **ТЗ-G канонизирует этот эндпоинт** (supersedes Фаза 5 tails) — не плодить две реализации.
- Схему `schema.prisma` трогают **ТЗ-B (isPrimary), ТЗ-D (commitmentAuthorPersonId), ТЗ-F (ownerPersonId)** — выполнять последовательно, каждый re-Read схемы перед правкой, добавлять своё поле не перезатирая чужое.
- `PersonPulseClient.tsx` трогают **ТЗ-G (manager-улучшения)** и **ТЗ-E (self-режим)** — ТЗ-G раньше ТЗ-E.

---

## Карта ТЗ (7 штук) и порядок реализации

Рекомендуемый порядок: **A → F → B → D → C → G → E** (быстрые UI-фиксы → схема целей → вектор → план-факт → операции → пульс/риск → кабинет Я). Схему трогают F, B, D — строго последовательно.

### ТЗ-A — Главная: честность данных + полировка Hero
Файл: `plans/tz/2026-06-05-dashboard-main-polish-and-honesty.md`
Остаток (всё not-started, кроме obsolete-«структуры»):
- **`undefined формируется`** (контракт): backend `structure.service.ts:75` отдаёт `roleProfiles.building`, фронт `StructureSummaryWidget.tsx:86` + тип `structure.api.ts:163` ждут `forming`. Решение: backend `building→forming` (фронт-нейминг честнее). Без db push.
- **Sample-story честность**: `SampleStoryBanner.tsx:17` существует, нигде не рендерится; при `isEmpty=true` KPI рисуются нулями без пометки. Подключить баннер «образец» + watermark на KPI, либо честные нули с пометкой.
- **Обрезка KPI «82%»**: `KpiHero.tsx:136` (overflow-hidden) + `:154-161` (text-6xl) + 3 KPI в `lg:col-span-1` (`DirectorDashboardClient.tsx:336-367`). Снять обрезку/адаптивный шрифт/переразложить зону.
- **Двойной заголовок AI-сводки**: `DirectorDashboardClient.tsx:369-380` (заголовок «AI-сводка») + `AiNarrativeWithSources.tsx:30-39` (свой заголовок+рамка). Дать компоненту проп `bare`/`hideChrome`.
- **Дата/свежесть на главной**: `generatedAt` есть в operations (`OperationsDashboardClient.tsx:142`), на главной нет — вывести в шапке (проверить, отдаёт ли `/dashboard/director` generatedAt в DTO).
- **Мёртвый код**: удалить `DashboardClient.tsx:70` и `CurationPendingWidget.tsx:17` (нигде не импортируются); убрать устаревшие комментарии «TODO Б.4» (`DirectorDashboardClient.tsx:100,408`).
- **TopRiskCard** при `risk=null` — пересмотреть `h-full` (`TopRiskCard.tsx:46-60`), низкий приоритет.

### ТЗ-B — Вектор цели (компас движения)
Файл: `plans/tz/2026-06-05-goal-vector-compass.md` · Решение Р1.
- Фундамент есть: `PersonGoalContribution` (pro/contra/net per person×goal×week, `schema.prisma:6616-6638`), cron `goal-vector-tracker.cron.ts:54`, `Person.primaryDepartmentId` (`:4350`).
- Не хватает: отдавать `proScore/contraScore` наружу (DTO сейчас только `netScore` — `pulse-patterns.dto.ts:105-120`, service `pulse-patterns.service.ts:333-417`); **`Goal.isPrimary`** (новый Boolean, partial-unique 1 на tenant — `Goal.weight:3913`, `horizon:3916`, `isPrimary` НЕТ); разрез по отделам (JOIN `Person.primaryDepartmentId`); **компас-виджет** (угол `focus=net/(pro+contra)` → `angle=(1−focus)·90°` полукруг, длина=объём активности) вместо текущего списка `GoalVectorWidget.tsx:78-152`; размещение наверху главной.
- Многоуровневость (уточнение владельца): по компании (главная цель), по каждой цели (данные уже per-goal), по недельным спринтам (данные per-week). Уровни — переключатель.
- Владелец явно хочет именно СТРЕЛКУ/КОМПАС (не оставлять список).

### ТЗ-C — Операционные дашборды: содержательный редизайн
Файл: `plans/tz/2026-06-05-operations-dashboards-redesign.md`
- Панель: заменить плоский локальный Card (`OperationsDashboardClient.tsx:293-326`) на общий `KpiHero`; сгруппировать 11 блоков в 3 зоны (Люди/Исполнение/Сигналы); кликабельные карты; заменить мёртвую «Среднюю загрузку» (`operations-dashboard.service.ts:702-736`, ≈0) на живой показатель из разговоров; свернуть 2 блока температуры (`:193,195`); overview на SWR (`:86-115` useEffect).
- Ежедневный: убрать дубль `YesterdayDigestCard` из Обзора (`:154-157`) — НЕ сливать экраны (оставить 3 таба); реализовать `whoShined` (`daily-digest.service.ts:785` захардкожен `[]`); права «Перегенерировать» (coo видит, бэк не пускает — `DailyDigestClient.tsx:79-80,100`); жаргон `conf`/`high` (`:320,777`).
- Недельный: `<pre>`→ReactMarkdown (`WeeklyDigestClient.tsx:237`); на SWR (`:36-71`); русификация `pts`/`pp` (`:338`, `weekly-digest.service.ts:973`); кнопки действия к проблемам; светофор срочности.
- **Разрез по людям в недельной — НЕ здесь** (см. ТЗ-D), чтобы не дублировать.
- Recharts 3.8.1 уже в зависимостях — графики только при реальных временных рядах, не ради красоты.

### ТЗ-D — Персональный план-факт по людям за неделю (запрос клиента)
Файл: `plans/tz/2026-06-05-weekly-per-person-plan-fact.md` · Решение Р4.
- Добавить `commitmentAuthorPersonId` в `IdeaBlock` (рядом с `commitmentRecipientPersonId:2984`); заполнять через тот же резолвер subject (identity участника). Доп.: расширить subject-атрибуцию на `commitment` (`block-ingest.worker.ts:53-60` REASONING_SUBJECT_SIGNAL_TYPES).
- `commitment-reliability.service.ts:179-182,250-251` — добавить scope-режим **по автору/исполнителю** (сейчас scope=person по получателю).
- Новый эндпоинт+сервис недельной агрегации **по `personId`**: kept/broken/overdue (по автору) + выполненные задачи (по `Task.assigneeUserId` — фундамент готов) + чек-ины; дозированная выдача топ-5 «держат слово» / топ-5 «зоны риска».
- Фронт: виджет недельного план-факта по людям + drill-down; интеграция в «Недельную сводку».
- Фундамент готов: identity + role:subject + assigneeUserId (Ф0–Ф5).

### ТЗ-E — Личный кабинет «Я»
Файл: `plans/tz/2026-06-05-personal-cabinet-me.md` · Решение Р3.
- Объединить 5 страниц `/me/*` (`Sidebar.tsx:270-288`) в кабинет «Я» с вкладками (Обзор/Пульс/Вклад/Помощь коллегам/Обещания) + редиректы старых URL (есть ссылки из тура/хуков).
- Self-режим Pulse: проп `mode:'self'` в `PersonPulseClient` (`MyPulseClient.tsx:49`) — скрыть «AI-резюме для HR»/«Ревью ЗП»/«Поговорить срочно» (`PersonPulseClient.tsx:434,532,553`), тон от первого лица, убрать ссылки в `/persons/:id`. Бэк при self не отдаёт HR-suggestions.
- Обещания: источник (sourceMeetingId/meetingTitle в `CommitmentDto:64-79` + `promises.api.ts:21-34`); подсветка просрочки (`MyPromisesClient.tsx:210-214`); кнопка «Перенести срок» (новый эндпоинт reschedule: PATCH dueDate, статус остаётся open; НЕ расширять mark); мобильная таблица.
- Backend opt-out social-contribution (заменить фейковый тумблер `MySocialContributionClient.tsx:94-102`); счётчик «Фидбек» (`helpfulness.ts:250-252` захардкожен 0) — протянуть или скрыть.
- Удалить мёртвую `/me/dashboard`.
- Координация: ТЗ-E после ТЗ-G (оба трогают `PersonPulseClient`).

### ТЗ-F — Цели и стратегия: улучшения
Файл: `plans/tz/2026-06-05-goals-improvements.md` · Решение Р4 (ownerPersonId).
- **`Goal.ownerPersonId`** (новая nullable-колонка + relation + `@@index([tenantId, ownerPersonId])`, паттерн как у Process/Regulation/Policy.ownerPersonId; `Goal` сейчас только `createdById:3931`). UI выбора ответственного + опц. авто-резолв из участников.
- **Светофор уверенности**: `GoalAlignmentSnapshot` имеет `themesCount/blocksCount` (`:4007-4040`), но не `confidence`; в UI не выведен. Либо вычислять confidence в `strategic-alignment.worker.ts`, либо derive светофор на лету из themesCount/blocksCount и показать в `GoalsClient/GoalDetailClient`.
- **Объединить два индикатора движения** (cachedAlignment 0-100 `:3938` + progressStatus `:3960`) в один понятный UI-вид (склейка на domain/UI, поля оставить).
- Русификация жаргона: `GoalDetailClient.tsx:440,461-496,834(₽),1201` (cron/snapshot/₽).
- Голосовая постановка цели (опц., вне атрибуции): сказал словами → предложить формулировку + темы + ключевой результат.

### ТЗ-G — Пульс сотрудника + «Сотрудники под риском»
Файл: `plans/tz/2026-06-05-employee-pulse-and-people-at-risk.md` · Решение Р2 (без gate для owner/admin).
- **`/dashboard/people-at-risk`** (канонизирует Фазу 5 tails-finalization, supersedes): сервис ранжирования по риску (источник `Person.engagementScore` `:4375` + commitment reliability + активные riskFlags), вернуть топ-N с `pulseScore 0-100`.
- **`pulseScore 0-100`**: считать на лету в сервисе people-at-risk поверх `engagementScore`×100 + штрафы (просрочки/red-mood), кэш Redis (паттерн PersonPulseService TTL 5 мин); колонку не вводить на первом этапе.
- Подключить `PeopleAtRiskWidget` к реальному fetch (убрать `items={null}` — `DirectorDashboardClient.tsx:582-586`).
- Вход в «Пульс» из «Обзора» сотрудника; фокус «чем помочь» (фраза-действие вместо голого числа); убрать/пометить `lastOneOnOneAt` placeholder.
- **Р2:** настроение/чек-ины для owner/admin НЕ гейтить; выровнять текст-обещание приватности (EthicsBanner), чтобы не обещать того, чего нет. hr_partner — оставить существующий gate по `analyticsOptIn`.
- Координация: ТЗ-G раньше ТЗ-E (общий `PersonPulseClient`).

## Инварианты (проверить в каждом ТЗ — ссылка, не дубль CLAUDE.md)
Только русский UI; парные токены; Prisma db push (не migrate), `createPrismaClient()` в скриптах; ENV через TypedConfigService, крутилки в AdminSetting; идемпотентность seed/patch/backfill + регистрация в `apply-prod-deploy.ts`; multi-tenancy `@@index([tenantId,…])`; prompt-cache (не трогать SYSTEM LLM без нужды); БЕЗ финансов; SPO/privacy-residency не поднимать.
