---
type: tz
status: ready-to-implement
feature: coo-orphan-agents-wire-to-operations-board
date: 2026-06-15
owner: Сергей (владелец)
relates_to:
  - plans/analysis/2026-06-15-coo-operational-director-module-agents-and-dashboards.md
  - plans/tz/2026-06-11-assistant-channels-telegram-max.md
  - plans/tz/2026-06-05-employee-pulse-and-people-at-risk.md
  - plans/tz/2026-06-08-dashboards-info-rework.md
---
> Анализ: `plans/analysis/2026-06-15-coo-operational-director-module-agents-and-dashboards.md` · Карта обвязки: workflow `wa358atv1` · Статус согласования: 2026-06-15 (Q1 решён владельцем; Q2 «доставка» — решение в §«Принятые решения» Р-5)

# Подключение готовых агентов «Операционного директора» к UI (доска Операции)

## Принцип
Бэкенд операционного директора (~40 агентов) почти весь **уже работает и пишет данные**, но часть результатов не выведена на экран («orphan»: код есть, потребителя нет). Это ТЗ **не строит новое, а подключает готовое** к доске Операции — слой за слоем `ApiDto → DomainModel → UiModel → mount`. Любая фича выкатывается **сразу включённой** (Ship-On, CLAUDE.md принцип 8): новых OFF-флагов не вводим, существующие kill-switch'и остаются ON.

**Вне scope / отложено владельцем:** серверная мультиканальная доставка дайджестов (Telegram/MAX/email policy, рендер eventType, синхронизация `actionUrl`) — это территория плана унификации Telegram-помощника (`plans/tz/2026-06-11-assistant-channels-telegram-max.md`), правится там системно. Здесь — только подключение аналитики к кабинету + дешёвое зеркалирование `customersAtRisk` в чтение дневного дайджеста. Обоснование — Р-5.

---

## Цель + Зачем
Дать операционному директору видеть на доске `/dashboard/operations` всё, что система уже считает, но прячет: радар клиентов под отток (деньги), доведение решений (% доведено / застряло), 6 паттернов пульса (необратимые решения, угрозы непрерывности/bus-factor, болтологию-встречи, узкие места, скорость ответа, темы по кругу), знание-под-риском, перегруз ответственностью, факторы здоровья команд, цели команды. Сейчас этот аналитический слой потерян при редизайне «ритмы» (главная переписана с вкладок на лёгкий экран «Сегодня», аналитика осиротела), а часть агентов крутится вхолостую (ежедневный LLM team-health пишет в БД, читателей нет).

**Болезненное состояние (по факту в коде):**
- 6 из 7 паттернов пульса считаются, но на экране используется только `goalVector` (CompassWidget) — остальные 6 полей лежат в `state` мёртвыми (`DirectorDashboardClient.tsx:138`).
- 4 готовых эндпоинта без единого фронт-потребителя (греп = 0): `customer-risk`, `decisions/throughput`, `decisions/stalled`, `knowledge-at-risk`.
- 2 мёртвых сигнала: `Department.healthSummaryJson` (ежедневный LLM, никто не читает) и `PromiseNetworkSnapshot` (weekly, читателей нет вообще).
- 2 заглушки данных: `team-health.decisions` всегда `neutral`, `team-detail.goals` всегда `[]` (хотя связь `Goal.ownerPersonId` уже есть).
- Доска `/dashboard/operations` недостижима из меню «ритмы».

---

## REALITY-CHECK (что есть/мертво/сломано по факту — проверено грепом/чтением)
| Область | Backend | Frontend api/domain/widget | Статус |
|---|---|---|---|
| pulse-patterns (6 виджетов) | ✅ 100% — `GET /dashboard/pulse-patterns` отдаёт все 7 (`pulse-patterns.service.ts:59`) | ✅ **всё есть**: `dashboardApi.getPulsePatterns` (`dashboard.api.ts:55`), `pulsePatternsFromApi` (`pulse-patterns.ts:176`), 6 компонентов в `frontend/src/ui/components/dashboard/` | **только монтаж** — 6 компонентов нигде не импортируются |
| DecisionThroughput + Stalled | ✅ сервис+cron+2 эндпоинта+DTO+gauge (`decision-implementation.service.ts`, controller `:451`/`:487`) | ❌ нет api/domain/widget (есть переиспользуемые подписи в `value-recap.ts:127-166`) | путь с нуля (фронт) |
| CustomerRiskRadar | ✅ эндпоинт `:398` + self `me/customer-risk` + cron + DTO, hint детерминирован (без LLM на чтении) | ❌ нет api/domain/widget; `customersAtRisk[]` уже в ответе daily-digest (`dto:212`/`service:1085`), но фронт-DTO не зеркалит | путь с нуля (фронт) + дешёвое зеркало |
| KnowledgeAtRisk | ✅ эндпоинт `:512` + cron + DTO; **но** DTO отдаёт `soleExpertPersonId` без имени | ❌ нет api/domain/widget (близнец-эталон — `TeamCapacityWidget`) | путь с нуля + минимальный join имени |
| team-detail.goals | ⚠️ заглушка `goalsDto=[]` (`team-detail.service.ts:242`); **TODO устарел — `Goal.ownerPersonId` ЕСТЬ** (`schema.prisma:4342`, индекс `:4404`) | ✅ DTO+api+domain+UI готовы и смонтированы на `/teams/[id]` | **backend-доводка** (1 findMany) |
| team-health.decisions | ⚠️ заглушка `{value:0,neutral}` (`team-health.service.ts:190-194`); `HangingDecisionsService` есть, но без per-dept scope | ✅ цепочка тянет `decisions` (orphan-компонент `TeamHealthGrid` + живые `/structure`,`/teams`) | **backend-доводка** (scoped count) |
| team-health.healthSummaryJson | ⚠️ cron пишет ежедневно LLM (`team-health-analyzer.cron.ts:165`), `getHealth` НЕ селектит (`:103-114`) | ✅ потребитель `StructureWidgets` живой; `TeamHealthGrid` — orphan | **backend select + рендер факторов** |
| promise-network | ⚠️ cron пишет `PromiseNetworkSnapshot` weekly, **читателей 0** | ❌ нет ничего (сервис/эндпоинт/api/domain/widget) | путь с нуля целиком |
| Навигация | — | `/dashboard/operations` НЕ в `nav-config.ts` (рудимент после «ритмов») | **вернуть пункт меню** |

**Вывод REALITY-CHECK:** scope — это в основном **монтаж и backend-доводки поверх готового**, миграций БД **не требуется** (`Goal.ownerPersonId`, `Person.primaryDepartmentId`, `Department.healthSummaryJson`, `PromiseNetworkSnapshot` уже в схеме). Только Фаза 7 (promise-network) — полный путь с нуля.

---

## Принятые решения владельца (не пересматривать без явного запроса)
| # | Решение | Обоснование (Почему) |
|---|---|---|
| Р-1 | Вся переподключаемая аналитика → доска **`/dashboard/operations`**, не на главную «Сегодня» | Ответ владельца 2026-06-15. Главная намеренно облегчена редизайном «ритмы» до 7 блоков; аналитический слой COO живёт отдельно (как `ChronicBlockers`/`TeamCapacity` уже там). |
| Р-2 | Подключаем **всё** перечисленное; каждый виджет — **сразу включён** (Ship-On), без новых OFF-флагов | «доделать всё, что не включено… сразу всё включаем» (владелец 2026-06-15) + CLAUDE.md принцип 8. Существующие kill-switch'и (`customer_risk_radar.enabled`, `knowledge_at_risk.enabled`) остаются ON. |
| Р-3 | Доску переименовать в **«Аналитика»** и вернуть пункт в меню (раздел «Ритмы», LEADERSHIP_ROLES, сразу после «Сегодня»). Маршрут остаётся `/dashboard/operations` (меняется только метка) | Владелец 2026-06-16: «название точно нужно поменять, реши лучшее». Доказательство — ниже («Доказательство имени доски»). Маршрут не трогаем, чтобы не плодить редиректы и не ломать `actionUrl` в нотификациях. |
| Р-4 | Новые виджеты монтировать **ВНЕ** ветки `reworkEnabled` (всегда ON) | `reworkEnabled` (`OperationsDashboardClient.tsx:140`, дефолт ON) — чужой kill-switch про перекомпоновку легаси-блоков; завязывать новые фичи на инцидент-рубильник соседней задачи нельзя. |
| Р-5 | Доставка дневного дайджеста в каналы (Telegram/email/MAX) — **в scope**, управляется **персональной галочкой в кабинете** каждого пользователя «Получать ежедневную сводку» (вкл/выкл). По умолчанию **ВКЛ** (Ship-On); пользователь сам отключает. Реализуется через **существующий** механизм `optOutEventTypes` (`PATCH /me/notification-preferences`) — не строим новое (Фаза 8) | Владелец 2026-06-16: «доставку в Telegram сделаем; в каждом кабинете человек решает галочкой — настраиваемая величина». Инфраструктура per-user opt-out уже есть (`me.controller.ts:55`, `NotificationBudgetService`) → переиспользуем. OFF-флаг `deliver_to_telegram` **убираем** (нарушал Ship-On); контроль переходит к пользователю, а не к глобальному флагу. **Координация:** правки `EVENT_TYPE_CHANNEL_POLICY` + рендер-whitelist ботов пересекаются с `plans/tz/2026-06-11-assistant-channels-telegram-max.md` Ф1/Ф2 — см. «Граничные контракты» и `feedback_parallel_sessions_git_check`. |

---

## Доказательство имени доски (Р-3)
Соседние пункты «Ритмов» — **временные срезы** (Сегодня / Неделя / Итоги месяца). Новая доска — **тематический разбор** (риски, исполнение, нагрузка, трения), не привязанный к периоду. Имя должно сигналить «здесь копают данные», быть понятным не-техническому владельцу, без английского, без коллизий.

| Критерий | **Аналитика** (выбрано) | Пульс | Операции (тек.) | Разбор |
|---|---|---|---|---|
| Понятно владельцу сразу | ✓ | ✓ | ~ технично | ✓ |
| Отличается от временных Сегодня/Неделя/Месяц | ✓ тематич. | ✓ | ✓ | ✓ |
| Нет коллизии терминов | ✓ | ✗ «пульс компании за 30с» = это **главная**; + team-pulse | ✓ | ✓ |
| Тон (не «унылый Excel») | ~ суховато | ✓ тёплый | ✗ | ✓ тёплый |
| Масштаб (дом для рисков+нагрузки+исполнения, не только «пульса») | ✓ | ~ узко | ✓ | ~ |

**Вывод:** «Пульс» отпадает — коллизия с позиционированием главной («пульс компании за 30 секунд») и с team-pulse. «Аналитика» — единственное без коллизий, однозначное, масштабируемое (дом для всего аналитического слоя). Выбрано **«Аналитика»**. Тёплая альтернатива — **«Разбор»** (совпадает с метафорой «две скорости: витрина vs разбор»); смена тривиальна (одна строка-метка в `nav-config.ts`), владелец может заменить.

## Доказательство выбора (два прохода + challenge-loop)

**Проход A (выбран): инкрементальное подключение готовых слоёв к доске Операции.** Реюз существующих `api/domain/widget`, монтаж + точечные backend-доводки.

**Проход B (отвергнут): единый новый агрегатор-эндпоинт `GET /dashboard/operations/analytics` + новая страница `/dashboard/analytics`,** который собирает все сигналы одним ответом.

| Критерий | A (подключить готовое) | B (новый агрегатор+страница) |
|---|---|---|
| Реюз существующего кода | ✅ 6 компонентов + api + domain pulse уже есть | ✗ дублирует pulse-эндпоинт и компоненты |
| Объём backend | ✅ только Фаза 7 нов., остальное — доводки | ✗ новый агрегатор поверх 5 источников |
| Риск рассинхрона DTO | ✅ один контракт на источник | ✗ третий слой DTO поверх существующих |
| Скорость до ценности | ✅ Фаза 1 — почти бесплатно | ✗ недели на агрегатор |
| Совместимость с «ритмами» | ✅ садится на существующую доску | ✗ ещё один экран в навигации |
| Код ради кода | ✅ нет нового задела | ✗ агрегатор дублирует `pulse-patterns.service` |

Сошлись все критерии → **A, высокая уверенность.** B рассматривался честно (единый payload снизил бы число запросов), но проигрывает: pulse-эндпоинт **уже** отдаёт 7 паттернов одним ответом — отдельный агрегатор был бы дублем.

**Challenge-loop по A:**
1. *Корень, не симптом?* Корень — «редизайн осиротил готовые виджеты + доска недостижима». Чиним **класс**: единый паттерн монтажа в секции + возврат пункта меню (Фаза 1), а не по одному виджету вслепую.
2. *Самое эффективное?* Да: не пишем новый api/domain/dto там, где они есть (pulse — только монтаж). Backend-кэш pulse **не добавляем превентивно** — числовой триггер: измерить латентность `getPulsePatterns` на проде через `diag`; добавить Redis TTL 300с **только если** >300мс (`feedback_verify_framework_behavior_empirically`).
3. *Код ради кода?* Убираем дубли: `IrreversibleDecisionsAlert` vs `TopRiskCard` — выбрать один; orphan `TeamHealthGrid` — удалить или оживить, не плодить третий потребитель. Подписи статусов решений переиспользуем из `value-recap.ts`, не дублируем.

---

## Scope

### Входит
1. Навигация: пункт меню для `/dashboard/operations` + секционный каркас доски (Фаза 1).
2. pulse-patterns: монтаж 6 готовых виджетов + 1 общий SWR (Фаза 1).
3. Заглушки данных: `team-detail.goals` (findMany) + `team-health.decisions` (scoped count) (Фаза 2).
4. DecisionThroughput + Stalled: фронт-путь + виджет (Фаза 3).
5. CustomerRiskRadar: фронт-путь + виджет + зеркало `customersAtRisk` в чтение дайджеста (Фаза 4).
6. KnowledgeAtRisk: фронт-путь + виджет + минимальный join `soleExpertPersonName` (Фаза 5).
7. team-health.healthSummaryJson: select + рендер 5 факторов в `StructureWidgets` (Фаза 6).
8. promise-network «Перегруз ответственностью»: полный путь сервис→эндпоинт→виджет (Фаза 7).
9. Доставка дневной сводки в каналы (Telegram/email/MAX) + **персональная галочка** «Получать ежедневную сводку» в кабинете (Фаза 8).
10. Переименование доски «Операции» → «Аналитика» + возврат пункта меню (Фаза 1, Р-3).

### Не входит (с судьбой)
- Синхронизация `actionUrl` нотификаций дайджестов со старых роутов `/dashboard/operations/*` на новые `/dashboard`/`/week` — пересекается с планом унификации Telegram → оставить там; здесь не трогаем (`actionUrl` ведёт на рабочий старый экран).
- Страница `/me/customer-risk` для менеджера (self-эндпоинт готов, но это отдельный экран рядового) → vNext-заметка.
- Текст «держится на N людях» в KnowledgeAtRisk (числа экспертов категории нет в `KnowledgeAtRiskSnapshot`) → пишем «на одном человеке»; vNext.
- onboarding-ramp виджет (тоже orphan, только редирект `next.config.mjs:107`) → vNext.

### Граничные контракты
- Фаза 6/Фаза 2 меняют форму ответа `GET /dashboard/team-health` и `GET /dashboard/teams/:id` — новые поля делать **опциональными** (3 потребителя у team-health: orphan `TeamHealthGrid`, `/structure`, `/teams`). Обратная совместимость обязательна.
- `getPulsePatterns` уже грузится на главной (`DirectorDashboardClient.tsx:138`) — на Операции это **второй** потребитель того же эндпоинта; backend не трогаем, только новый клиентский SWR.
- **Фаза 8 ↔ план унификации Telegram** (`plans/tz/2026-06-11-assistant-channels-telegram-max.md` Ф1/Ф2): обе правят `EVENT_TYPE_CHANNEL_POLICY` (`conversational.service.ts:90`) и рендер-whitelist ботов (`telegram-bot.adapter.ts:1507`, `max-bot.adapter.ts:924`). Перед началом Фазы 8 — `git fetch` + проверить, не идёт ли тот план параллельно (`feedback_parallel_sessions_git_check`). Добавление ключа `operations.daily_digest` в policy — **аддитивное** (новая строка), конфликта быть не должно, но координировать по тем же файлам.

---

## Контракт-first (канон для копипасты)

### Точные контракты props pulse-виджетов (ГЛАВНАЯ ловушка — props НЕ единообразны)
```
// pulse = pulsePatternsFromApi(swrData)  // PulsePatternsDomain | null
<BusFactorWidget          data={pulse?.busFactor ?? null}            loading={isLoading} error={errBool} />   // prop: data (объект|null)
<RecurringTopicsWidget    data={pulse?.recurringTopics ?? null}      loading={isLoading} error={errBool} />   // prop: data (объект|null)
<BottleneckHeatmapWidget  data={pulse?.bottlenecks ?? null}          loading={isLoading} error={errBool} />   // prop: data (объект|null)
<LowRoiMeetingsWidget     meetings={pulse?.lowRoiMeetings.meetings ?? []}  loading={isLoading} error={errBool} /> // prop: meetings (МАССИВ, не data)
<IrreversibleDecisionsAlert decisions={pulse?.irreversibleDecisions.decisions ?? []} alertCount={pulse?.irreversibleDecisions.alertCount ?? 0} /> // два prop'а, НЕ data; сам скрывается при alertCount=0
<KnowledgeVelocityKpi     data={pulse?.knowledgeVelocity ?? null} />   // только data; props loading/error НЕТ — не передавать
```
ASCII-поток pulse:
```
GET /dashboard/pulse-patterns?period=week  ──(один общий useSWR)──►  pulsePatternsFromApi  ──►  6 виджетов (см. props выше)
```

### team-detail.goals (Фаза 2) — backend, без миграции
```ts
// backend/src/modules/dashboard/services/team-detail.service.ts:242  — заменить goalsDto=[] на:
const goals = await this.prisma.goal.findMany({
  where: { tenantId: args.tenantId, ownerPersonId: { in: personIds }, promotionState: 'active', archivedAt: null },
  select: { id: true, name: true, status: true, ownerPersonId: true, ownerPerson: { select: { name: true } } },
});
// смаппить в TeamDetailGoalDto {goalId,name,status,ownerPersonId,ownerPersonName}; удалить устаревший TODO :236-241; сбросить Redis-кэш team_detail (TTL 300с)
```
Связь существует: `Goal.ownerPersonId` (`schema.prisma:4342`, `@@index([tenantId, ownerPersonId])` `:4404`). `personIds` уже собран на `team-detail.service.ts:139`.

### team-health.decisions (Фаза 2) — backend, scoped count
- Расширить `HangingDecisionsService.count` (`hanging-decisions.service.ts:40`) опц. scope per-department через `Decision.decidedByPersonIds[]` (`schema.prisma:6147`) → `Person.primaryDepartmentId` (`schema.prisma:4800`).
- **Правило атрибуции (зафиксировано):** решение считается «висящим» для отдела, если хотя бы один автор из `decidedByPersonIds` имеет `primaryDepartmentId == dept.id`. Overlap между отделами допускается и документируется (одно решение может попасть в 2 отдела).
- **Запрет N+1:** НЕ вызывать count per-dept в цикле — одна агрегатная выборка `Decision` по tenant + раскладка по отделам in-memory (как `conflictLinks` `team-health.service.ts:134`). Добавить DI `HangingDecisionsService` в `TeamHealthService` (`:83-90`).

### team-health.healthSummaryJson (Фаза 6) — опц. поле в DTO
```ts
// TeamHealthRowDto (team-health.service.ts) — добавить опционально:
healthSummary?: {
  factors: { manager_support: 'low'|'medium'|'high'; workload_fairness: 'low'|'medium'|'high'; communication: 'low'|'medium'|'high'; time_pressure: 'low'|'medium'|'high'; role_clarity: 'low'|'medium'|'high' };
  summary: string;
  generatedAt: string;   // показывать, чтобы не путать с live-метриками
} | null;
// getHealth (:103-114): добавить healthSummaryJson:true в select; распарсить в row.healthSummary (belowCohort → null)
```
Колонка уже есть: `Department.healthSummaryJson Json?` (`schema.prisma:4686`). Рендер — в `frontend/app/(authenticated)/structure/StructureWidgets.tsx` (`TeamHealthTable`, после строки отдела ~173): 5 факторов чипами по парным токенам `bg-chip-*-bg`/`text-chip-*-fg` (low→danger, medium→warning, high→success) + summary; fallback «оценка ещё не посчитана» при null.

### promise-network (Фаза 7) — новый путь
```ts
// graphJson из promise-network-analyzer.cron.ts:184-189 (типизировать защитно — Json нетипизирован):
type PromiseGraph = {
  nodes: { personId: string; name: string; role: 'accumulator'|'donor'|'isolated'|'balanced'; inDegree: number; outDegree: number; balance: number }[];
  edges: { fromPersonId: string; toPersonId: string; count: number }[];
  periodStart: string; periodEnd: string;
};
// Сервис (operations/services/promise-network.service.ts): последний PromiseNetworkSnapshot (orderBy snapshotAt desc, take 1) → {snapshotAt, totalCommitments, accumulators: nodes.filter(role==='accumulator').sort(inDegree desc)}
// Эндпоинт: @Get('promise-network') в operations-dashboard.controller.ts (образец team-capacity :534, requireAccess owner/admin/coo) → GET /api/v1/dashboard/operations/promise-network
// Виджет: frontend/.../operations/widgets/PromiseOverloadWidget.tsx (образец TeamCapacityWidget.tsx)
```
Модель: `PromiseNetworkSnapshot` (`schema.prisma:7476-7487`).

### CustomerRisk — зеркало в дайджест (Фаза 4, дешёвый бонус)
Бэк уже кладёт `customersAtRisk[]` в ответ daily-digest (`daily-digest.dto.ts:212`, `daily-digest.service.ts:1085`). Дописать фронт: интерфейс `DailyDigestCustomerAtRiskApi {customerName; riskLevel:'critical'|'warning'; badge}` + поле в `DailyDigestApi` (`operations-daily-digest.api.ts:146`); поле в `DailyDigestDomain` + `?? []` в `fromDailyDigestApi`; секция `CustomersAtRiskSection` в `DailyDigestClient` (между `WhoStruggledSection:301` и `ChronicBlockersSection:302`) + включить в `allRuntimeEmpty:258`.

---

## Границы фичи
- ✅ **Always:** реюз существующих `api/domain/widget`; русский UI; парные токены `bg-*`/`text-*-fg`; новые виджеты вне `reworkEnabled`; опциональные новые поля DTO (обратная совместимость); один SWR-ключ на pulse.
- ⚠️ **Ask first:** любое изменение схемы Prisma (в этом ТЗ НЕ требуется — если возникло, остановиться); метка/позиция пункта меню (Р-3); возврат доставки дайджеста в scope (Р-5).
- 🚫 **Never:** новый OFF-флаг «на всякий случай»; новый агрегатор-эндпоинт (дубль pulse); вывод аналитики на главную «Сегодня»; имена людей под риском в публичные surface; `process.env.*` / `prisma migrate` / `new PrismaClient(`. Правку `EVENT_TYPE_CHANNEL_POLICY`/адаптеров ботов делаем **только в Фазе 8 и только аддитивно** (новый ключ `operations.daily_digest`), сверившись с Telegram-планом — ничего из его scope не переписываем.

---

## Фазы (dependency-ordered) и граф зависимостей

```
Ф1 (нав+переим.+каркас+pulse) ─┬──► Ф3 (DecisionThroughput)
                               ├──► Ф4 (CustomerRisk)
                               ├──► Ф5 (KnowledgeAtRisk)
                               └──► Ф7 (PromiseOverload)
Ф2 (заглушки goals/decisions) — независима (фронт на /teams,/structure)
Ф6 (team-health факторы)      — независима (StructureWidgets)
Ф8 (доставка+галочка)         — независима (conversational backend + settings/notifications)
```
Порядок по «ценность × дешевизна» (ревью): **Ф1 → Ф2 → Ф3 → Ф4 → Ф5 → Ф6 → Ф7 → Ф8.** Ф1 — пререквизит секционного каркаса для Ф3/Ф4/Ф5/Ф7. Ф2, Ф6, Ф8 независимы и могут идти параллельно (не трогают доску Аналитика).

---

### Фаза 1 — Меню «Аналитика» + секционный каркас доски + pulse-patterns (6 виджетов)
**Цель:** доска `/dashboard/operations` переименована в «Аналитика», достижима из меню и наполнена 6 паттернами пульса.
**Картография:** `frontend/src/ui/components/app-shell/nav-config.ts` (RHYTHMS_SECTION `:138`); `frontend/app/(authenticated)/dashboard/operations/OperationsDashboardClient.tsx`; `frontend/src/api/dashboard.api.ts:55`; `frontend/src/domain/pulse-patterns.ts:176`; компоненты `frontend/src/ui/components/dashboard/{BusFactorWidget,RecurringTopicsWidget,LowRoiMeetingsWidget,BottleneckHeatmapWidget,KnowledgeVelocityKpi,IrreversibleDecisionsAlert}.tsx`.
**Что входит:**
1. В `nav-config.ts` (RHYTHMS_SECTION, `roles=LEADERSHIP_ROLES`) добавить пункт на `/dashboard/operations` с меткой **«Аналитика»** сразу после «Сегодня» — Р-3. Маршрут не менять. Заголовок самого экрана (`OperationsDashboardClient` / page) тоже привести к «Аналитика» (грепнуть «Операции»/«пульс компании» в заголовке доски и заменить).
2. В `OperationsDashboardClient.tsx` ввести именованные секции с заголовками: «Риски и непрерывность», «Аналитика пульса», «Загрузка и распределение», «Трения». Каркас (пустые секции с заголовками), куда Ф3/Ф4/Ф5/Ф7 домонтируют виджеты.
3. Добавить импорт `dashboardApi` (`@/api/dashboard.api`) + `pulsePatternsFromApi` (`@/domain/pulse-patterns`); **один** `useSWR(['operations-pulse-patterns', orgId, 'week'], () => dashboardApi.getPulsePatterns(orgId, 'week'))` (`revalidateOnFocus:false`, `shouldRetryOnError:false`, `.catch`-safe — не валит доску). `[ASSUMPTION: orgId брать из того же источника, что прочие fetch этого клиента — проверить при реализации]`.
4. Смонтировать 6 виджетов по точным props (см. Контракт-first): `IrreversibleDecisionsAlert` — flagship-баннер над KPI-рядом (самоскрывается при `alertCount=0`); `KnowledgeVelocityKpi` — в/над KPI-рядом; `BusFactorWidget` — секция «Риски и непрерывность»; `RecurringTopicsWidget`,`LowRoiMeetingsWidget` — «Аналитика пульса»; `BottleneckHeatmapWidget` — «Трения», последним, во всю ширину.
5. Решить судьбу дубля `TopRiskCard.tsx` (тот же источник `irreversibleDecisions`): если не смонтирован — оставить, если смонтирован — выбрать один с `IrreversibleDecisionsAlert`.
**Что НЕ входит:** новые api/domain/dto (всё есть); backend; кэш pulse.
**Acceptance:**
- `grep "dashboard/operations" frontend/src/ui/components/app-shell/nav-config.ts` → ≥1 (пункт меню есть).
- `grep -E "<(BusFactorWidget|RecurringTopicsWidget|LowRoiMeetingsWidget|BottleneckHeatmapWidget|KnowledgeVelocityKpi|IrreversibleDecisionsAlert)" OperationsDashboardClient.tsx` → 6 совпадений.
- `grep "getPulsePatterns" OperationsDashboardClient.tsx` → ровно 1 SWR-вызов (не 6).
- `LowRoiMeetingsWidget` получает `meetings=`, `IrreversibleDecisionsAlert` — `decisions=`+`alertCount=`, `KnowledgeVelocityKpi` — только `data=` (грепом проверить отсутствие лишних props).
- Новые виджеты НЕ обёрнуты в `reworkEnabled` (Р-4).
- `bun run typecheck && bun run lint && bun run build` (frontend) — зелёные.
**Закрывает:** R1, R2, R-3, R-4.

### Фаза 2 — Заглушки данных: team-detail.goals + team-health.decisions
**Цель:** убрать две заглушки, фронт уже готов и смонтирован.
**Что входит:** (а) `team-detail.service.ts:242` — `findMany` по `Goal.ownerPersonId` (см. Контракт-first), удалить TODO `:236-241`, обновить doc-блок `:30-34`, сбросить кэш `team_detail`; (б) `team-health.service.ts:190-194` — заменить neutral-plug на scoped-count через расширенный `HangingDecisionsService` (правило атрибуции + запрет N+1, см. Контракт-first), решить belowCohort-ветку `:284`.
**Что НЕ входит:** фронт (цепочка готова); миграции; pulse.
**Acceptance:**
- `grep "goalsDto: TeamDetailGoalDto\[\] = \[\]" team-detail.service.ts` → 0 (заглушка убрана); `grep "goal.findMany" team-detail.service.ts` → ≥1.
- `grep "value: 0, tone: 'neutral'" team-health.service.ts` для колонки decisions → 0 в основной ветке.
- Негативный пример: отдел без целей с `ownerPersonId` → `goals: []` (корректный empty, не ошибка).
- `HangingDecisionsService` вызывается НЕ в цикле по отделам (одна агрегатная выборка) — проверить чтением.
- `bun run typecheck && bun run lint && bun run build` + `bunx vitest run` затронутых spec — зелёные.
**Закрывает:** R5, R6.

### Фаза 3 — Контролёр доведения решений (DecisionThroughput + Stalled)
**Цель:** виджет «Доведение решений: N% доведено · M застряло» на доске Операции.
**Картография:** бэк готов — `operations-dashboard.controller.ts:451` (`decisions/throughput`), `:487` (`decisions/stalled`), DTO `execution-agents.dto.ts:57-77`. Реюз подписей — `frontend/src/domain/value-recap.ts:127-166`.
**Что входит:** ApiDto (`DecisionThroughputApi`,`StalledDecisionApi`/`StalledDecisionsApi` в `operations-dashboard.api.ts` + методы `getDecisionThroughput`/`getStalledDecisions`); domain (`frontend/src/domain/decision-throughput.ts`, переиспользовать `decisionProgressTone`/`VALUE_RECAP_DECISION_STATUS_LABELS`); виджет `operations/widgets/DecisionThroughputWidget.tsx` (2 SWR `.catch`-safe, `kpiTone(throughputPercent,{green:80,yellow:50})` НЕ inverted, период «за 90 дней» подписать явно); монтаж в секцию (StatCard в KPI-ряд ИЛИ отдельный блок — не ломать сетку 4-в-ряд).
**Что НЕ входит:** backend (готов); главная.
**Acceptance:**
- `grep -E "getDecisionThroughput|getStalledDecisions" frontend/src/api/operations-dashboard.api.ts` → 2.
- `grep "DecisionThroughputWidget" OperationsDashboardClient.tsx` → ≥1.
- Подпись периода присутствует (грепом «90 дн» / «за 90»).
- Негативный пример: `total=0` → «решений за период нет».
- typecheck/lint/build зелёные.
**Закрывает:** R3.

### Фаза 4 — CustomerRiskRadar + зеркало customersAtRisk
**Цель:** виджет «Клиенты под риском оттока» на доске Операции (секция «Риски и непрерывность») + клиенты под риском в чтении дневного дайджеста.
**Картография:** бэк `operations-dashboard.controller.ts:398`, сервис `customer-risk-radar.service.ts:350`, DTO `customer-risk.dto.ts:24/45`. Эталон виджета — `ChronicBlockersWidget.tsx`.
**Что входит:** ApiDto (`CustomerRiskTopBlockApi`,`CustomerRiskSnapshotApi`,`CustomerRiskListApi` + метод `getCustomerRisk({level?,limit?})`); domain (`fromCustomerRiskListApi`, RU-лейблы уровней/сигналов); виджет `operations/widgets/CustomerRiskRadarWidget.tsx` (SWR `limit:20`, топ-N + «показать всех», плашка `riskLevel`, badge `signalCounts`, `hint`, drill-down); монтаж в «Риски и непрерывность»; **зеркало** `customersAtRisk` в daily-digest (см. Контракт-first).
**Что НЕ входит:** `/me/customer-risk` страница (vNext); доставка в каналы (Р-5); backend (готов).
**Acceptance:**
- `grep "getCustomerRisk" frontend/src/api/operations-dashboard.api.ts` → ≥1; `grep "CustomerRiskRadarWidget" OperationsDashboardClient.tsx` → ≥1.
- `grep "customersAtRisk" frontend/` → ≥3 (api + domain + DailyDigestClient секция).
- `limit ≤ 20` в SWR (защита от N+1 ~40 запросов); empty-state «клиентов под риском нет».
- `customersAtRisk` входит в `allRuntimeEmpty` проверку `DailyDigestClient:258`.
- typecheck/lint/build зелёные.
**Закрывает:** R4.

### Фаза 5 — KnowledgeAtRisk
**Цель:** виджет «Знания под риском» (top-3 critical) в секции «Риски и непрерывность».
**Картография:** бэк `operations-dashboard.controller.ts:512`, сервис `knowledge-at-risk.service.ts:143`, DTO `knowledge-improvement.dto.ts:11/20`. Эталон — `TeamCapacityWidget.tsx`.
**Что входит:** минимальный backend-join — в `listForTenant` (`:153`) добавить `soleExpert{name}` (связь `KnowledgeAtRiskSoleExpert`, `schema.prisma:7291`) + поле `soleExpertPersonName` в DTO; ApiDto (`KnowledgeAtRiskItemApi`/`ListApi` + `getKnowledgeAtRisk`); domain (`fromKnowledgeAtRiskApi`, RU severity); виджет `operations/widgets/KnowledgeAtRiskWidget.tsx`; монтаж. Текст строки: «Зона „{categoryName}“ держится на одном человеке ({soleExpertPersonName}), он под риском ухода».
**Что НЕ входит:** «на N людях» (числа экспертов нет — vNext); главная; вынос в Telegram/публичное (этика — только owner/admin/coo).
**Acceptance:**
- `grep "soleExpertPersonName" backend/src/modules/operations` → ≥1 (join сделан).
- `grep "getKnowledgeAtRisk" frontend/src/api/operations-dashboard.api.ts` → ≥1; `grep "KnowledgeAtRiskWidget" OperationsDashboardClient.tsx` → ≥1.
- Виджет НЕ рендерит сырой cuid (имя есть); empty-state «появится, когда соберётся достаточно данных» (cron пн 05:00).
- typecheck/lint/build зелёные.
**Закрывает:** R7.

### Фаза 6 — Мёртвый сигнал: team-health факторы вовлечённости
**Цель:** показать `healthSummaryJson` (5 факторов + summary), за который уже платим LLM ежедневно.
**Картография:** `team-health.service.ts:103-114` (select), потребитель `frontend/app/(authenticated)/structure/StructureWidgets.tsx` (`TeamHealthTable` ~`:156`).
**Что входит:** опц. поле `healthSummary` в `TeamHealthRowDto` (см. Контракт-first); select `healthSummaryJson:true` + парс в `getHealth`; опц. поле в `frontend/src/domain/team-health.ts`; рендер раскрытия «Почему такая оценка» (5 факторов чипами + summary + `generatedAt`, fallback «не посчитана») в `StructureWidgets`; сбросить кэш `team_health` (TTL 300с); решить судьбу orphan `TeamHealthGrid.tsx` (оживить тем же раскрытием ИЛИ удалить).
**Что НЕ входит:** новый виджет на Операции; миграция (колонка есть); имена людей (анти-доксинг — промпт уже без имён).
**Acceptance:**
- `grep "healthSummaryJson" team-health.service.ts` → ≥1 (в select).
- `grep "healthSummary" frontend/app/(authenticated)/structure/StructureWidgets.tsx` → ≥1 (рендер).
- Опциональность: 3 потребителя `/team-health` компилируются (обратная совместимость).
- belowCohort/отсутствие cron → «оценка ещё не посчитана».
- typecheck/lint/build зелёные.
**Закрывает:** R8.

### Фаза 7 — Мёртвый сигнал: promise-network «Перегруз ответственностью»
**Цель:** виджет «Кто перегружен ответственностью» (accumulators) в секции «Загрузка и распределение».
**Картография:** cron `promise-network-analyzer.cron.ts:38/184-189`, модель `schema.prisma:7476-7487`. Читателей нет — путь с нуля. Эталон виджета — `TeamCapacityWidget.tsx`.
**Что входит:** сервис `operations/services/promise-network.service.ts` (последний снапшот, защитный парс `graphJson`, accumulators sort по inDegree); DTO `PromiseNetworkDto` (типизировать граф); эндпоинт `@Get('promise-network')` (`operations-dashboard.controller.ts`, requireAccess owner/admin/coo) + регистрация сервиса в `operations.module` providers; ApiDto `getPromiseNetwork`; domain `fromPromiseNetworkApi`; виджет `operations/widgets/PromiseOverloadWidget.tsx`; монтаж рядом с `TeamCapacityWidget`.
**Что НЕ входит:** новый cron (снапшот пишется); миграция; имена в публичное.
**Acceptance:**
- `grep "promise-network" backend/src/modules/operations/controllers/operations-dashboard.controller.ts` → ≥1 (эндпоинт).
- `grep "PromiseOverloadWidget" OperationsDashboardClient.tsx` → ≥1.
- Защитный парс: битый `graphJson` → empty-state, не падение (негативный тест).
- Малая Org / нет accumulator (порог inDegree≥3) → «накопится за неделю».
- typecheck/lint/build + `bunx vitest run` нового сервиса — зелёные.
**Закрывает:** R9.

### Фаза 8 — Доставка дневной сводки в каналы + персональная галочка в кабинете
**Цель:** дневная сводка COO доставляется в каналы (Telegram/email/MAX/in_app), а каждый пользователь сам управляет этим галочкой «Получать ежедневную сводку» в `Настройки → Уведомления`. Ship-On: по умолчанию доставляется, пользователь отключает.
**Картография:** `backend/src/modules/operations/workers/operations-daily-digest.cron.ts:57/71-75/166/214` (cron + флаг + `notifyRecipients`); `backend/src/modules/conversational/conversational.service.ts:90-163` (`EVENT_TYPE_CHANNEL_POLICY`, weekly-образец `:118`); `backend/src/modules/conversational/types/event-payload.registry.ts:227/445` (weekly payload-схема — образец); `backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts:1507` + `adapters/max-bot/max-bot.adapter.ts:924` (рендер-whitelist); `backend/src/modules/me/me.controller.ts:55/206` (`PATCH /me/notification-preferences`, `optOutEventTypes`); `backend/src/modules/conversational/notification-budget.service.ts` (читает `optOutEventTypes`); `frontend/app/(authenticated)/settings/notifications/page.tsx`.
**Что входит (backend):**
1. В `EVENT_TYPE_CHANNEL_POLICY` (`conversational.service.ts:90`) добавить строку `'operations.daily_digest': ['in_app','email_smtp','telegram_bot','max_bot']` (зеркало weekly `:118`).
2. В `event-payload.registry.ts` зарегистрировать `OperationsDailyDigestPayloadSchema` (по образцу `OperationsWeeklyDigestPayloadSchema:227`) + строку в registry-map (рядом с `:445`).
3. В рендер-whitelist ботов добавить `'operations.daily_digest'`: `telegram-bot.adapter.ts:1507`, `max-bot.adapter.ts:924`.
4. **Убрать OFF-флаг** `operations.daily_digest.deliver_to_telegram` (нарушал Ship-On): в `operations-daily-digest.cron.ts` вызывать `notifyRecipients` **безусловно** (как weekly), удалить чтение флага `:71-75` и гейт `:166`; удалить ключ из `env.schema.ts` и из `seed-admin-setting-daily-digest.ts`; удалить строку флага из `docs/operations/feature-flags.md:78`.
**Что входит (персональная галочка — переиспользуем `optOutEventTypes`):**
5. **Семантика (по существующему механизму):** отключение = добавить `'operations.daily_digest'` в `optOutEventTypes` пользователя → push/Telegram не приходит; копия сводки **остаётся в кабинете** (`in_app`). Включено (по умолчанию) = типа нет в `optOutEventTypes`.
6. Прочитать текущее состояние: если GET персональных префов нет — добавить `GET /me/notification-preferences` → `{ optOutEventTypes, quietHoursStart, quietHoursEnd }` (рядом с PATCH `me.controller.ts:206`).
7. Frontend `settings/notifications/page.tsx`: добавить тумблер **«Получать ежедневную сводку компании»** (подпись-уточнение «при отключении сводка всё равно доступна в кабинете»). Checked = не в `optOutEventTypes`; снятие → `PATCH /me/notification-preferences { optOutEventTypes: [...,'operations.daily_digest'] }`, установка → убрать из массива. Api-функция + (при необходимости) GET-загрузка текущего состояния; оптимистичное обновление с откатом при ошибке.
**Что НЕ входит:** недельная сводка (она уже доставляется мультиканально, флага OFF нет); `actionUrl`-синхронизация (Telegram-план); новые каналы доставки сверх существующих.
**Acceptance:**
- `grep "operations.daily_digest" conversational.service.ts` → присутствует в `EVENT_TYPE_CHANNEL_POLICY` со списком каналов (не DEFAULT).
- `grep -r "deliver_to_telegram" backend/src` → 0 (флаг убран); `grep "deliver_to_telegram" docs/operations/feature-flags.md` → 0.
- `grep "operations.daily_digest" telegram-bot.adapter.ts max-bot.adapter.ts` → присутствует в whitelist.
- Тумблер «Получать ежедневную сводку…» рендерится в `settings/notifications/page.tsx`; снятие шлёт `PATCH /me/notification-preferences` с `operations.daily_digest` в `optOutEventTypes`.
- Негативный пример: пользователь снял галочку → push не приходит, но `GET /dashboard/operations/daily-digest/latest` всё ещё отдаёт сводку (кабинет не зависит от opt-out).
- `bun run typecheck && bun run lint && bun run build` (backend+frontend) зелёные; `bunx vitest run` затронутых spec зелёные.
- Перед стартом фазы: `git fetch` + проверка параллельной работы по Telegram-плану (граничный контракт).
**Закрывает:** R10.

---

## Требования (трассировка)
- **R1.** Когда лидер открывает меню, система shall показывать пункт на `/dashboard/operations`.
- **R2.** Когда открыта доска Операции, система shall рендерить 6 паттернов пульса одним запросом `getPulsePatterns`, каждый с корректным контрактом props.
- **R3.** Когда есть доведённые/застрявшие решения, система shall показывать «% доведено за 90 дней» и число застрявших.
- **R4.** Когда есть клиенты под риском, система shall показывать их на доске Операции (топ-N) и в чтении дневного дайджеста.
- **R5.** Если у команды есть цели с `ownerPersonId` из её отдела, then система shall показывать их на `/teams/[id]` (иначе пустое состояние).
- **R6.** Когда у отдела есть висящие решения (по правилу атрибуции), система shall показывать ненулевую колонку «Решения» в здоровье команд.
- **R7.** Когда зона знаний держится на одном эксперте под риском ухода, система shall показывать её с именем эксперта (не cuid).
- **R8.** Когда cron посчитал факторы вовлечённости отдела, система shall показывать их с `generatedAt` (иначе «не посчитана»).
- **R9.** Когда есть accumulator-узлы в последнем `PromiseNetworkSnapshot`, система shall показывать их на доске Аналитика.
- **R10.** По умолчанию система shall доставлять дневную сводку owner/coo в их каналы (in_app + Telegram/email/MAX по привязкам); Если пользователь снял галочку «Получать ежедневную сводку», then система shall не слать ему push/Telegram, но сводка остаётся доступна в кабинете.

---

## Pre-mortem / Риски + ревью-аспекты (для strict-production-review-gate)
- **Перегруз экрана** (главный нефункциональный риск): доска Операции уже плотная → секции с заголовками + flagship-баннер сверху + тяжёлый heatmap последним; компактные риск-карточки (top-5/top-3), аккордеоны для полных таблиц. Ревью: проверить, что доска читаема, не «скролл-самосвал».
- **Контракты props pulse** — невыводимы по интуиции (data/meetings/decisions+alertCount/data-only) → дословно в Контракт-first; ревью: грепнуть каждый props.
- **N+1:** CustomerRisk `limit≤20` (~40 запросов); team-health.decisions — агрегатная выборка, не цикл. Ревью: убедиться, что нет per-item/per-dept циклов.
- **Дубли:** `IrreversibleDecisionsAlert` vs `TopRiskCard`; orphan `TeamHealthGrid` — выбрать один, не плодить.
- **Обратная совместимость DTO:** новые поля team-health/team-detail — опциональные (3 потребителя).
- **Мобайл (пробел постановки — проверить грепом):** рендерятся ли `/dashboard/operations`, `/teams/[id]`, `/structure` через мобильные клиенты (`MobileShell`/`MobileTeamClient`)? Если да — виджеты приедут, проверить вёрстку heatmap/таблиц; если отдельный мобильный клиент — обновить и его.
- **Drill-down 404:** ссылки виджетов на `/decisions/[id]` — в реестре был прод-баг 404 (product-audit 2026-06-12), по аудиту 2026-06-15 страница `decisions/[id]/page.tsx` существует; перепроверить перед кликабельным drill-down. `/meetings/[id]` для LowRoi — проверить роут.
- **pulse backend-кэш:** не добавлять превентивно; измерить латентность `getPulsePatterns` на проде (`diag`), Redis TTL 300с — только при >300мс.

## Idempotency / флаги / prod-deploy
- **Миграций БД нет** (все поля/модели в схеме — `Goal.ownerPersonId`, `Person.primaryDepartmentId`, `Department.healthSummaryJson`, `PromiseNetworkSnapshot`, `ChannelBinding.preferences`). Новых seed/patch/backfill **на запуск** нет.
- **Новых OFF-флагов нет** (Ship-On). Существующие kill-switch'и `operations.customer_risk_radar.enabled` / `operations.knowledge_at_risk.enabled` остаются ON. **Фаза 8 УБИРАЕТ** флаг `operations.daily_digest.deliver_to_telegram` (был OFF-дефолт = нарушение Ship-On): удалить из `env.schema.ts`, из `seed-admin-setting-daily-digest.ts` и **строку из `docs/operations/feature-flags.md:78`**. Стелс-эффект: после выката дневная сводка начнёт доставляться owner/coo во все привязанные каналы по умолчанию (контроль — персональная галочка).
- **Prod-deploy:** `docker compose up -d --build backend` (+ фронт-сборка). Прод-операций (запуск seed/patch/migrate) — **нет**; оставшаяся в проде неиспользуемая AdminSetting-строка флага безвредна (можно удалить вручную позднее).
- Кэши Redis `team_health`/`team_detail` (TTL 300с) самопротухнут за ≤5 мин после деплоя — отдельного сброса не требуется.

## DoD
- typecheck (вкл. `.spec`) / lint / build зелёные (frontend + backend).
- `bunx vitest run` затронутых spec зелёные.
- Все Acceptance-предикаты фаз выполнены (грепом/командами).
- second-brain обновлён: `01_projects/` профильная (дашборды/operations) + `02_architecture/module-map.md` если менялись эндпоинты (Фаза 7 — новый `promise-network`); реестр `04_не-сделано/README.md` — закрыть строку 2026-06-15 про orphan-слой (перенести в «Закрытые») по мере подключения.
- prod-deploy-log: новый эндпоинт `promise-network` (+ опц. `GET /me/notification-preferences`) → Шаг 12 (Swagger smoke); Фаза 8 убирает ENV `COO_DAILY_DIGEST_DELIVER_TO_TELEGRAM` → Шаг 1 (отметить удаление) и строку в `docs/operations/feature-flags.md`; миграций/скриптов-на-запуск нет.
- Рефлексия в `05_история/`.

## Итог

**Реализовано целиком — все 8 фаз** (ветка `feature/coo-orphan-agents-wire`, коммиты `ac56ce2b..b44229ae`):

- **Ф1 `ac56ce2b`** — пункт меню «Аналитика» (RHYTHMS_SECTION, после «Сегодня») + секционный каркас доски `/dashboard/operations` + монтаж 6 готовых pulse-виджетов одним общим SWR (`getPulsePatterns`), props по точным контрактам, вне ветки `reworkEnabled`. Доска переименована «Операции» → «Аналитика» (маршрут не тронут). Закрывает R1/R2/R-3/R-4.
- **Ф2 `479e4f06`** — backend-доводки: `team-detail.goals` (`findMany` по `Goal.ownerPersonId` вместо заглушки `[]`), `team-health.decisions` (scoped count висящих решений per-dept через `HangingDecisionsService.listHangingWithAuthors`, атрибуция по `primaryDepartmentId`, одна агрегатная выборка in-memory — запрет N+1). Новые поля DTO опциональны. Закрывает R5/R6.
- **Ф3 `97d09064`** — виджет «Доведение решений» (`DecisionThroughputWidget`): фронт-путь к готовым `decisions/throughput` + `decisions/stalled`. Закрывает R3.
- **Ф4 `70fa22ba`** — виджет «Клиенты под риском оттока» (`CustomerRiskRadarWidget`, `limit≤20`) + зеркало `customersAtRisk` в чтение дневного дайджеста (`CustomersAtRiskSection`). Закрывает R4.
- **Ф5 `9d71206f`** — виджет «Знания под риском» (`KnowledgeAtRiskWidget`) + минимальный backend-join имени эксперта (relation `soleExpert`, опц. `soleExpertPersonName`). Закрывает R7.
- **Ф6 `ee76eb82`** — оживление мёртвого LLM-сигнала: `select healthSummaryJson` + защитный парс в опц. поле `healthSummary`; рендер раскрытия «Почему такая оценка» (5 факторов + summary) в `StructureWidgets`. Закрывает R8.
- **Ф7 `99cf6b5c`** — оживление мёртвого `PromiseNetworkSnapshot`: НОВЫЙ `PromiseNetworkService` + НОВЫЙ эндпоинт `GET /api/v1/dashboard/operations/promise-network` (owner/admin/coo) + виджет «Перегруз ответственностью». Закрывает R9.
- **Ф8 `b44229ae`** — дневная сводка COO в каналы по умолчанию (Ship-On): УДАЛЁН OFF-флаг `operations.daily_digest.deliver_to_telegram` / ENV `COO_DAILY_DIGEST_DELIVER_TO_TELEGRAM`; cron шлёт безусловно (идемпотентно по `deliveredAt`); policy `operations.daily_digest` в `EVENT_TYPE_CHANNEL_POLICY` + payload-схема + whitelist ботов; НОВЫЙ эндпоинт `GET /api/v1/me/notification-preferences`; персональная галочка «Ежедневная сводка компании» через существующий `optOutEventTypes`. Закрывает R10.

**Все Acceptance зелёные** (typecheck / lint / build + `bunx vitest run` затронутых spec по всем фазам). **Миграций БД нет** (все поля/модели уже в схеме), seed/patch/backfill на запуск нет, новых OFF-флагов нет.

**Находки по ходу:**
- `TeamHealthGrid` оказался **НЕ orphan** (живой потребитель на `/teams`) — не удалён.
- Адаптеры ботов по существу не трогали: generic-ветка `title`+`body` уже рендерит `operations.daily_digest` (хватило добавить ключ в whitelist).
- **Инцидент с веткой:** параллельная сессия в общем рабочем каталоге переключила HEAD под ногами — коммит Ф7 лёг на чужую ветку `fix/qa-cabinet-bugfix-2026-06-16`; исправлено через `git branch -f` (перенёс свой коммит на свою ветку, восстановил чужую на её базу, без `reset --hard` — чужие незакоммиченные изменения целы). Урок — проверять `git branch --show-current` перед каждым коммитом при активной параллельной сессии.

**Осталось:** закрытие строки про orphan-слой COO в `second-brain/04_не-сделано/README.md` — **отложено** (файл занят незакоммиченными изменениями параллельной сессии, обновит владелец в своей ветке). Прод — `docker compose up -d --build backend frontend` (диф-инструкция в `docs/operations/prod-deploy-log.md`, блок «📊 2026-06-16»).
