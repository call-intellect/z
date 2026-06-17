# Модуль «Операционный директор»: каталог агентов, дашборды, разрыв план/факт

> Дата: 2026-06-15. Тип: анализ (не ТЗ, не код).
> Метод: read-only аудит реального кода (9 суб-агентов, ~300 чтений, состязательная перепроверка статусов).
> **Источник правды — код, а не комментарии/ТЗ.** Все статусы поставлены по факту в `backend/` и `frontend/`.
> Контекст-задача владельца: ввести понятия «смысл» и «модульность», собрать разрозненных агентов в логические модули. Этот документ закрывает первый модуль — **«Операционный директор» (COO, англ. Chief Operating Officer — директор по операциям)**: всё, что анализирует операционную деятельность и выводит выводы/риски/блокеры/дайджесты на дашборды.

---

## 0. TL;DR (главное за 30 секунд)

1. **Функция «операционного директора» в коде УЖЕ существует** — это ~**40 агентов**. Но физически она расколота на два модуля + чужие модули, единого «модуля COO» в коде нет. Это и есть проблема модульности, которую вы хотите решить:
   - `backend/src/modules/operations/` — **формальный модуль COO** (в `operations.module.ts` прямо «ежедневный отчёт COO», «push-first владельцу/COO»): ~**19 агентов**.
   - `backend/src/modules/dashboard/agents/` — **13 аналитических агентов** (скореры/детекторы), физически отдельно, но логически тоже COO.
   - **~9 feeder-агентов** (англ. feeder — питатель) в `knowledge-core`, `processes`, `tracker`, `goals`, `pending-actions` — первоисточники сигналов (решения, инсайты, цели, трения, просрочки).
2. **Все краны (cron — планировщик задач) РЕАЛЬНО тикают.** Проверено состязательно: отдельного worker-процесса нет, всё работает в едином HTTP-процессе (`app.module.ts:150` поднимает `ScheduleModule`, `:333` грузит `DashboardModule`). Миф «cron не запускается» — опровергнут.
3. **Главный долг — не «не написано», а ORPHAN (сирота): бэкенд считает, UI не показывает.** Причина системная — редизайн «rhythms» переписал главную с вкладок (Обзор/Команда/Знания/Цели) на единый экран «Сегодня» и осиротил часть готовых виджетов.
4. **2 мёртвых сигнала** — агент пишет в БД, не читает никто: `PromiseNetworkAnalyzerCron` и `TeamHealthAnalyzerCron`. Последний — **самый дорогой холостой расход**: LLM-вызов на каждый отдел ЕЖЕДНЕВНО, результат (`Department.healthSummaryJson`) не читает никто.
5. **4 дорогих готовых эндпоинта без экрана** + **6 из 7 pulse-паттернов** не выводятся. Самый болезненный — **Радар клиентов под риском** (выручка, «Агент 1 — деньги»).
6. **Доставка дайджеста выключена флагом по умолчанию** (`operations.daily_digest.deliver_to_telegram=false`) — нарушает принцип Ship-On.
7. **`/decisions/:id` 404 — ИСПРАВЛЕН** (страница `[id]/page.tsx` существует и работает). Снять из списка открытых багов.
8. **6 концептуальных пробелов анализа** (никогда не писались): совещательная нагрузка, время цикла решения, реальная ёмкость из сигналов, перегруз ответственностью, per-dept решения, связка цель↔отдел.

---

## 1. Что такое «модуль операционного директора» сейчас

**Смысл функции COO в Коре:** ответить владельцу/руководителю на три вопроса — *что случилось (день/неделя/месяц), что буксует и требует решения, куда движемся* — и сделать это «управлением по исключению» (молчит, когда норма; подсвечивает риски/блокеры).

**Где физически живёт код (проблема модульности):**

| Слой | Папка | Что там | Агентов |
|---|---|---|---|
| Формальный модуль COO | `backend/src/modules/operations/` | чек-ины, блокеры, обещания, доведение решений, клиентский риск, дайджесты, доставка, value-recap, портфель | ~19 |
| Аналитические скореры | `backend/src/modules/dashboard/agents/` | engagement/burnout/bus-factor/forecast/goal-vector/ROI/hygiene/silence/recurrence/velocity/promise-network/team-health | 13 (+producer) |
| Первоисточники (feeders) | `knowledge-core`, `processes`, `tracker`, `goals`, `pending-actions` | Decision, Insight, Goal, трения, просрочки, очередь подтверждений | ~9 |

**Вывод по модульности:** «операционный директор» — это уже цельная смысловая функция, но размазанная по трём адресам. Чтобы ввести «модуль», достаточно собрать их в один реестр/каталог (и/или физически переселить `dashboard/agents/` под `operations/`, т.к. они логически операционные). **Это организационный рефактор, не переписывание.**

---

## 2. Каталог агентов модуля «Операционный директор»

> 🟢 = реально работает и доходит до пользователя · 🟠 = работает, но output не показывается (orphan) · 🔴 = мёртвый сигнал (никто не читает) · ⚙️ = детерминированный (без LLM) · 🧠 = использует LLM.

### Группа A. Сбор сырья — чек-ины и настроение
| Агент | Расписание | Что делает | Куда | Статус |
|---|---|---|---|---|
| `DailyCheckInPromptCron` | ежечасно по timezone | рассылает утренний план / вечерний отчёт сотрудникам | `DailyCheckIn` | 🟢⚙️ |
| `CheckinSentimentBatchCron` (+`...Analyzer.worker`) | каждые 5 мин | размечает тональность ответа (зелёный/жёлтый/красный) | `DailyCheckIn.sentiment` | 🟢🧠 |
| `ReflectionQualityScorerCron` | ежечасно (15 мин) | LLM-оценка содержательности рефлексии | `DailyCheckIn.reflectionQuality` | 🟢🧠 |
| `CheckInConflictDetectorCron` (`personal-relation-builder.worker`) | ежедн. 04:00 | ищет парные конфликт-маркеры в чек-инах | `EntityLink('conflicted_with')` | 🟢⚙️ |

### Группа B. Блокеры и трения
| Агент | Расписание | Что делает | Куда | Статус |
|---|---|---|---|---|
| `BlockerSynthesisCron` | ежедн. 22:00 | синтез блокеров: новый/повторяется/закрыт + бизнес-удар → инсайт | `BlockerSynthesis`, `Insight(kind='blocker')` | 🟢⚙️ |
| `CrossFunctionalFrictionAggregatorCron` (модуль `processes`) | ежедн. 05:00 | межфункциональные трения процессов → heatmap | `CrossFunctionalFrictionReport` | 🟢⚙️ |
| `ThemeSilenceDetectorCron` (dashboard) | ежедн. 04:00 | темы, молчащие N недель → риск-инсайт «тема заглохла» | `Insight(kind='risk')` | 🟢⚙️ **единственный с kill-switch** |
| `TopicRecurrenceDetectorCron` (dashboard) | пн 05:00 | темы, что обсуждают по кругу без внедрённого решения | `RecurringTopic` | 🟠⚙️ |

### Группа C. Обещания и доведение решений
| Агент | Расписание | Что делает | Куда | Статус |
|---|---|---|---|---|
| `Specialist39PromiseKeeper` + `CommitmentFollowupCron` | ежечасно | хранитель обещаний: followup/эскалация, kept/broken | `IdeaBlock(commitment)` | 🟢 |
| `PromiseCascadeCron` | ежедн. 08:00 | срыв обещания каскадит в цель → алерт автору+руководителю | алерты | 🟢⚙️ |
| `DecisionImplementationCron` | ежедн. 06:00 | **контролёр доведения решений** (в работе/застряло/% доведено) | `Decision.implementationStatus` | 🟠⚙️ *(эндпоинт без UI)* |
| `DecisionHygieneScorerWorker` (dashboard) | событие (новое решение) | классифицирует обратимость по Безосу (type-1/type-2) | `Decision.reversibility` | 🟢🧠 |
| `PromiseNetworkAnalyzerCron` (dashboard) | пн 05:00 | граф обещаний автор→получатель (accumulator/donor) | `PromiseNetworkSnapshot` | 🔴⚙️ **мёртвый: никто не читает** |

### Группа D. Риски — люди, знания, клиенты
| Агент | Расписание | Что делает | Куда | Статус |
|---|---|---|---|---|
| `BurnoutRiskDetectorCron` (dashboard) | ежедн. 03:45 | риск-флаги выгорания относительно личной нормы (90 дней) | `Person.riskFlagsJson` | 🟢⚙️ |
| `EngagementScorerCron` (dashboard) | ежедн. 03:00 | сводный engagement-score (вовлечённость) | `Person.engagementScore` | 🟢⚙️ |
| `BusFactorAnalyzerCron` (dashboard) | пн 05:00 | bus-factor по **категориям знаний** (≤1 эксперт = critical) | `KnowledgeRiskSnapshot` | 🟠⚙️ |
| `KnowledgeAtRiskCron` (operations) | пн 05:00 | знание-под-риском × уход **человека** (носители) | `KnowledgeAtRiskSnapshot` | 🟠⚙️ *(эндпоинт без UI)* |
| `CustomerRiskRadarCron` (operations) | ежедн. 21:00 | **клиенты под риском оттока** (churn/objection/pain) | `CustomerRiskSnapshot` | 🟠🧠 *(до UI не доходит — «Агент 1: деньги»)* |
| `HrRecommenderCron` (dashboard) | пн 06:00 | 0–3 HR-рекомендации руководителю по человеку | `Person.hrSuggestionsJson` | 🟢🧠 |
| `OnboardingRampCron` (operations) | ежедн. 07:00 | буксующий онбординг новичка | риск-сигнал | 🟢⚙️ |

### Группа E. Цели и портфель (план-факт)
| Агент | Расписание | Что делает | Куда | Статус |
|---|---|---|---|---|
| `GoalVectorTrackerCron` (dashboard) | пн 05:00 | вклад каждого человека «за/против» цели (pro/contra/net) | `PersonGoalContribution` | 🟢🧠 → CompassWidget |
| `PortfolioHealthSnapshotCron` (operations) | пн 05:00 | здоровье портфеля целей одной цифрой + MoSCoW | `PortfolioHealthSnapshot` | 🟢⚙️ → доска `/portfolio` |
| `GoalKrProgressCron` (goals) | ежедн. 05:00 | прогресс KeyResult (встречи/задачи/упоминания) | `KeyResult` | 🟢⚙️ |
| `GoalsPulseCron` (goals) | пн 06:00 | недельный пульс целей → owner/coo | `GoalsPulse` | 🟢 |
| `StrategicAlignmentCron` (goals + knowledge-core) | ежедн. | выравнивание работы со стратегией (alignment score) | `Goal.cachedAlignment` | 🟢 |
| `ForecasterCron` (dashboard) | пн 04:00 | прогноз 4 метрик на неделю (тренд/риски/возможности) | `ForecastSnapshot` | 🟢🧠 → недельный дайджест |

### Группа F. Аналитические скореры дашборда (pulse-patterns)
| Агент | Что считает | Виджет | Статус |
|---|---|---|---|
| `MeetingRoiScorerWorker` (dashboard) | ROI встречи (выхлоп/время) | LowRoiMeetings | 🟠⚙️ |
| `KnowledgeVelocityTrackerCron` (dashboard) | медиана времени вопрос→ответ | KnowledgeVelocityKpi | 🟠⚙️ |
| `TeamHealthAnalyzerCron` (dashboard) | LLM-оценка 5 факторов вовлечённости отдела | — | 🔴🧠 **мёртвый + дорогой (ежедн. LLM на отдел, никто не читает)** |

### Группа G. Сборка и доставка отчётов
| Агент | Расписание | Что делает | Статус |
|---|---|---|---|
| `OperationsDailyDigestCron` | ежедн. 22:00 (01:00 МСК) | **ежедневный отчёт COO** (LLM-нарратив + метрики) | 🟢🧠 *(но доставка OFF, см. §5c)* |
| `OperationsWeeklyDigestCron` (+`WeeklyPerPersonService`) | ежечасный тик по окну | **недельная сводка COO** + план-факт по людям («Кто держит слово») | 🟢🧠 |
| `ValueRecapCron` | 1-е число 07:00 | месячная витрина «что Кора сняла» + экспорт PPTX | 🟢🧠 |
| `ExecMorningPushCron` | ежечасно | утренний web-push руководителю «Требует тебя сегодня» | 🟢 |
| `PersonalDailyBriefCron` (+`KnowsWhoService`) | ежечасно по timezone | личный бриф «Твой день» + подсказка «кто поможет» | 🟢 *(self-scope)* |

### Группа H. Очередь решений
| Агент | Расписание | Что делает | Статус |
|---|---|---|---|
| `PendingActionsReminderCron` (+`PendingActionsService`) | ежечасно | очередь «Ждёт подтверждения N» (4 источника: курация/конфликт/intake/probe) | 🟢 → VerdictBar, exec-push, баннер операций |

### Feeders — первоисточники (без них модуль COO пуст)
| Агент | Модуль | Производит | Почему критичен |
|---|---|---|---|
| `Specialist35InsightsWorker` | knowledge-core | `Insight` (risk/problem/blocker/inefficiency/opportunity) | **главный генератор рисков/проблем** — ядро радара сигналов |
| `Specialist33DecisionsWorker` | knowledge-core | `Decision` | без него нет ни доведения решений, ни hygiene |
| `Specialist314GoalsWorker` | knowledge-core | `Goal`, `KeyResult` | вход goal-vector, portfolio-health |
| `IssueOverdueDetectorCron` | tracker | `signalType=task_overdue` | просрочки задач = операционный риск |
| `GoalAlignmentLowCron` | tracker | probe `goal_alignment_low` | работа без привязки к целям |
| `ProactiveWatcherCron` | proactive | 8 проактивных правил | пересекается с операц. рисками (частично) |

**Итого по каталогу:** 13 (dashboard) + ~19 (operations) + ~9 (feeders) ≈ **40 агентов** в смысловом модуле COO. LLM используют ~10, остальные — детерминированные агрегаты.

---

## 3. Дашборды: что выводится, что анализируется, что нет

6 досок относятся к операционному директору. Везде применён паттерн «три состояния» (данные / честный empty-state с причиной+CTA / «чиним» при сбое) — заглушек-«скоро» не найдено.

### 3.1. Главная директора — экран «Сегодня» (`/dashboard`)
**Доступ:** owner/admin/super_admin (manager → `/me`). Источник: `GET /dashboard/director` + `/dashboard/pulse-patterns` + `daily-digest/latest`.

| Виджет | Что показывает | Анализирует | Статус |
|---|---|---|---|
| VerdictBar | «Компания в норме / N требуют решения» либо «сбор данных не работает» | `DirectorDashboardService` (`requiresAction`+`degraded`) | 🟢 |
| Что было вчера | shortSummary дайджеста + «доставлено в Telegram» | `DailyDigestService` (LLM) | 🟢 |
| Требует вас | число решений в очереди + по источникам | `PendingActionsService` | 🟢 |
| Польза за период | 5 счётчиков (встречи/задачи/решения/ответы/обещания) | твёрдые счётчики БД | 🟢⚙️ |
| Вектор к цели (Compass) | движение к цели pro/contra | `GoalVectorTrackerCron` | 🟢🧠 |
| Сводка Коры + источники | AI-нарратив «Главное за период» | LLM `dashboard-summary` | 🟢🧠 |
| Радар сигналов (топ-3) | свежие риски/боли с уверенностью % | `Specialist35Insights` | 🟢 |
| Оцифровано / Активность / Лента дня / Чек-ин-дисциплина / Вопросы Коры | счётчики и ленты | knowledge-core, операции | 🟢 |

**Заглушки/хардкод на главной:** для ПУСТОГО tenant весь ответ подменяется синтетическим `SAMPLE_STORY_DATASET` с хардкодными KPI (sentiment 42, обещания 82, висящие 2) + watermark «образец» (by design). Дельты `kpiSentimentIndex` и `kpiHangingDecisions` всегда `null` (хардкод `:280`/`:291`) — реальна только дельта надёжности обещаний.

### 3.2. Операции — пульс компании (`/dashboard/operations`)
**Доступ:** owner/admin/**coo**/super_admin. Источник: `GET /dashboard/operations/overview` + точечные эндпоинты.

Живые виджеты: KPI-ряд (конфликты/блокеры/провал.цели/обещания), hero-график операц. нагрузки (12 недель), температура команды (общая+по людям), не отчитались сегодня, зависли задачи, **загрузка команд** (почти всегда пусто — см. ниже), вопросы Коры, зрелость, карта причин (8 категорий), топ-5 повторяющихся проблем, открытые обещания, **хронические блокеры**, свежие конфликты.

**Проблемы доски операций:**
- «Загрузка команд» (TeamCapacity) — рендерится, но в проде почти всегда `empty:true`: считается только по ручному `Appointment.loadPercent`, который никто не заполняет.
- «Свежие блокеры» — dead-path: kill-switch `operations.dashboard_rework.enabled` по умолчанию ON, поэтому всегда показываются «Хронические блокеры».

### 3.3. За день (`/dashboard/operations/daily`) и 3.4. За неделю (`/dashboard/operations/weekly`)
**Доступ:** coo/owner/admin/super_admin. Дневной и недельный отчёты COO (LLM-нарратив + метрики). Все секции живые, скрываются при пустых данных. Недельный содержит виджет **«Кто держит слово» (WeeklyPerPersonWidget)** — топ-5 «держат слово»/«зоны риска», drill-down план-факта, экспорт CSV для планёрки. Прогноз недели — из `ForecastSnapshot` (LLM), fallback — линейная экстраполяция.

### 3.5. Портфель целей (`/dashboard/portfolio`)
Спидометр health-score + donut статусов + MoSCoW + таблица целей с inline-приоритетом. Полностью живой.

### 3.6. Итоги месяца / ценность (`/dashboard/value-recap` → `/month`)
Месячная витрина «снятой рутины» (твёрдые счётчики) + soft-слой «команда лучше» (помечен «оценка») + дисциплина решений + **реальный экспорт PPTX** (через `pptxgenjs`) + печать/PDF. Честность: «часы×ставка→₽» и «до Коры» запрещены кодом (`assertNoForbiddenMetricKeys`).

---

## 4. Поток данных (как анализ доходит до экрана)

```
Встречи/чаты/чек-ины/задачи
      │  (ingest → knowledge-core)
      ▼
Specialist 3.3/3.5/3.14 ──► Decision / Insight / Goal      (первоисточники)
      │
      ├──► operations/ агенты ──► BlockerSynthesis, CustomerRisk, DecisionImpl,
      │                          PromiseKeeper, дайджесты, value-recap, portfolio
      │
      ├──► dashboard/agents/ ──► snapshot-таблицы (KnowledgeRisk, RecurringTopic,
      │                          PersonGoalContribution, ForecastSnapshot, roiScore…)
      ▼
Сервисы-агрегаторы (DirectorDashboardService, PulsePatternsService,
                    OperationsDashboardService, WeeklyDigestService…)
      ▼
REST /api/v1/dashboard/* ──► фронт-доски (виджеты)
```

**Ключевой нюанс:** виджет Bottleneck Heatmap (тепловая карта узких мест) кормится из `CrossFunctionalFrictionReport` (модуль `processes`), а НЕ из `PromiseNetworkSnapshot` — поэтому promise-network оказался мёртвым (см. §5d).

---

## 5. Разрыв «запланировано vs реализовано»

### 5a. ✅ Реализовано и доходит до пользователя
goal-vector компас · персональный «Твой день» + «кто поможет» (knows-who) · хронические блокеры · портфель-здоровье + MoSCoW · план-факт по людям («Кто держит слово», `commitmentAuthorPersonId`) · недельный прогноз · value-recap + **реальный PPTX-экспорт** · редизайн в стеклянный язык · устойчивость главной (`safe()` + `degraded`) · **`/decisions/:id` (404 исправлен)**.

### 5b. 🟠 ORPHAN — бэкенд работает, UI не показывает (ГЛАВНЫЙ ДОЛГ)
> Корень системный: редизайн «rhythms» переписал главную с вкладок на единый экран «Сегодня» и осиротил готовые виджеты; `frontend/src/api/operations-dashboard.api.ts` вызывает только `team-capacity` и `blockers/chronic`.

| Что | Готовый бэкенд | Почему orphan | Цена |
|---|---|---|---|
| **Радар клиентов под риском** (Агент 1, «деньги») | `customer-risk-radar.cron` + эндпоинт `/operations/customer-risk` | фронт не вызывает; в дайджест попадает (`customersAtRisk[]`), но и он не рендерится + доставка OFF | 🔴 самый дорогой по бизнесу — выручка |
| **Контролёр доведения решений** | `/operations/decisions/throughput` + `/stalled` | 0 вызовов на фронте | руководитель не видит «5 решений приняли, ни одно не двигается» и «% доведено» |
| **Знание-под-риском × уход** | `/operations/knowledge-at-risk` | 0 вызовов на фронте | не видно «зона держится на одном человеке под риском ухода» |
| **6 из 7 pulse-паттернов** | `pulse-patterns.service` считает всё | на главной из pulse используется только goalVector (Compass) | ROI встреч, bus-factor, повторяющиеся темы, узкие места, скорость ответа, необратимые решения — целый аналитический слой не виден |
| **Виджеты ТЗ-2** (GoalVectorVerdict, WhatWeLearned, ChatUsage, IdeasTop) + **PeopleAtRiskWidget** | компоненты существуют | редизайн не разместил; people-at-risk переехал на `/structure` | мёртвый фронт-код, риск рассинхрона |

### 5c. ⚠️ Выключено флагом по умолчанию (нарушает Ship-On)
**Доставка дневного дайджеста** — `operations.daily_digest.deliver_to_telegram` / `COO_DAILY_DIGEST_DELIVER_TO_TELEGRAM` default **false** (`operations-daily-digest.cron.ts:71-75`). При этом за флагом весь блок `notifyRecipients` (`:166`) — выключена НЕ только Telegram, а **вся** доставка по всем каналам. Дайджест генерируется и сохраняется, но руководителю не приходит. «Сводка, которая не приходит, фактически не существует».

### 5d. 🔴 Мёртвые сигналы и заглушки
- **`PromiseNetworkAnalyzerCron`** → `PromiseNetworkSnapshot`: в `backend/src` читает только сам крон, на фронте 0. Bottleneck строится из friction-отчёта. Чистый мёртвый writer (+ функция «кто держит слово» уже закрыта живым `WeeklyPerPersonService`).
- **`TeamHealthAnalyzerCron`** → `Department.healthSummaryJson`: **ежедневный LLM-вызов на каждый отдел, результат не читает никто.** Самый дорогой холостой расход модуля.
- **`TeamHealthService.decisions`** — всегда `{value:0, neutral}` (заглушка, per-dept hanging отложен).
- **`TeamDetailService.goals`** — всегда `[]` (нет связи `Goal→Person`, отложено до Wave 6.5).

### 5e. 🧩 Концептуально отсутствует как анализ (греп = 0)
1. **Совещательная нагрузка** — «сколько % времени команда тонет в созвонах», «у кого календарь забит на 80%». Есть ROI одной встречи, нет агрегата нагрузки.
2. **Время цикла решения (cycle time / decision latency)** — от подъёма вопроса до решения и до внедрения. Есть «висит ≥7 дней», нет средней скорости.
3. **Реальная ёмкость из сигналов** — `TeamCapacity` считает только ручной `loadPercent`; нет ёмкости из числа задач/обещаний/часов встреч.
4. **Перегруз ответственностью (accumulator)** — bus-factor только по знаниям; нет «на одном человеке N критичных обещаний/owner-решений» (должен был дать promise-network, но он мёртв).
5. **Per-department доведение решений** — какой отдел копит нерешённое (заглушка `neutral`).
6. **Связка цель↔отдел** на карточке отдела (`goals=[]`).

---

## 6. Рекомендации (введение «смысла» и «модульности»)

**Приоритет 1 — собрать модуль (организационно, дёшево):**
- Завести единый **реестр агентов COO** (один источник правды: имя · смысл · вход · выход · доска · статус) — этот документ можно взять за основу.
- Рассмотреть физическое переселение `dashboard/agents/` → `operations/agents/` (они логически операционные), либо хотя бы переименовать в осмысленный bounded-context.

**Приоритет 2 — подключить уже построенное (главная ценность лежит на полу):**
- **Радар клиентов** (деньги) — вывести на доску операций + в дайджест. Бэкенд готов, тратит LLM вхолостую.
- **Контролёр доведения решений** (`throughput`+`stalled`) — виджет «% доведено / застряло».
- **6 pulse-паттернов** — вернуть на главную/операции (ROI встреч, bus-factor, узкие места, необратимые решения, скорость ответа).

**Приоритет 3 — гигиена:**
- **`TeamHealthAnalyzerCron`** — либо подключить `healthSummaryJson` к Team Health Grid, либо отключить ежедневный холостой LLM.
- **`PromiseNetworkAnalyzerCron`** — подключить (перегруз ответственностью) или удалить (дубль с WeeklyPerPerson).
- Включить **доставку дайджеста** (Ship-On) — kill-switch на «выключить при инциденте», а не «по умолчанию молчим».
- Закрыть заглушки `team-health.decisions` и `team-detail.goals`.
- Снять `/decisions/:id` 404 из открытых багов (исправлено).

**Приоритет 4 — новый анализ (после подключения существующего):** совещательная нагрузка и cycle time решений — две метрики, которых рынок (НаВстрече/Таймлист/Otter) обычно не даёт, а для COO они базовые.

---

## Приложение. Проверка фактов (состязательная)
- **Краны тикают:** `ScheduleModule.forRoot()` `app.module.ts:150`; `DashboardModule` `app.module.ts:333`; отдельного worker-процесса нет (`backend/src/workers` не существует, `package.json` без `worker:dev`); все 11 расписаний сверены построчно. ✅
- **BullMQ-воркеры подписаны** в `onModuleInit`, producer'ы (`AnalyzeWorker`, `Specialist33DecisionsWorker`) в `WorkersModule` (in-process), `DashboardQueueService` инжектится через `@Optional`. ✅
- **Опровергнуто состязательной проверкой:** knows-who НЕ orphan (рендерится в `/me/daily-brief`); value-recap PPTX НЕ заглушка (`pptxgenjs`); `/decisions/:id` НЕ 404 (страница есть).
- **Усилено:** доставка дайджеста OFF гасит ВСЕ каналы, не только Telegram.
