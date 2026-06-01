---
type: tz
status: draft
date: 2026-05-31
version: 2  # rewrite после аудита кода (schema.prisma, pulse-patterns.service.ts, demo-data/*)
feature: Расширение контента демо-кабинета «ТехноСтрим» под Pulse v2 — заполнить каждую вкладку сайдбара реалистичными данными за 3 месяца работы компании. Включает 8 Pulse snapshot-моделей, регламенты, идеи, документы, календарь, реф-программу, обратную связь, расширенные карточки сотрудников.
parent_flow:
  - plans/tz/2026-05-31-demo-auto-seed-and-cleanup.md  # авто-сидинг и авто-cleanup; этот ТЗ — про КОНТЕНТ
primary_source:
  - plans/tz/2026-05-30-pulse-full.md  # ТЗ Pulse v2 — 9 экранов, 7 виджетов главной, 11 cron-агентов
existing_seed:
  - backend/src/modules/onboarding/demo-data/  # 8 файлов + mark-demo + types
existing_critical_files:
  - backend/src/modules/dashboard/services/pulse-patterns.service.ts  # ⭐ источник правды: какие именно snapshot'ы и за какое окно читает фронт
  - backend/src/modules/dashboard/dto/pulse-patterns.dto.ts           # ⭐ точные поля DTO для 7 виджетов
  - backend/prisma/schema.prisma                                       # Pulse-модели §6.1-§6.8 на строках 4909, 6158-6386, 8439-8619
recent_pulse_commits:
  - 1491d7f  feat(dashboard): Pulse Волна 6.1+6.2+6.5+6.6+6.7 — 5 паттернов + 5 новых snapshot-моделей
  - dda094e  feat(dashboard,ai): Pulse Волна 6.3+6.8 — Meeting-ROI-Scorer + Decision-Hygiene-Scorer
  - 050d094  feat(dashboard): Pulse Волна 6.4+UI — pulse-patterns endpoint + 7 виджетов на главной
  - e4477ca  docs: рефлексия Pulse Этапы A+A2+B+C + prod-deploy-log Wave 5+6
related_uncommitted:
  - backend/src/modules/dashboard/agents/decision-hygiene-scorer.worker.ts
  - backend/src/modules/dashboard/agents/meeting-roi-scorer.worker.ts
  - backend/src/modules/dashboard/prompts/decision-hygiene.prompt.ts
  - backend/src/modules/dashboard/queues.ts
  - backend/src/modules/dashboard/services/dashboard-queue.service.ts
---

# ТЗ: расширение контента демо-кабинета под Pulse v2

> Pulse v2 ([`2026-05-30-pulse-full.md`](./2026-05-30-pulse-full.md)) переписал главную: теперь она читает данные из **snapshot-таблиц**, которые наполняют 11 cron-AI-агентов. Текущий seed «ТехноСтрим» был сделан **до** Pulse v2 и эти таблицы НЕ наполняет → первое, что видит новый пользователь — **семь пустых Pulse-виджетов на главной**.
>
> Этот ТЗ — про **контент**. Поток (авто-сидинг + авто-cleanup) описан в [`2026-05-31-demo-auto-seed-and-cleanup.md`](./2026-05-31-demo-auto-seed-and-cleanup.md) и не дублируется.

---

## 1. Цель

После заливки демо-данных пользователь видит кабинет, в котором:

1. **Главная (`/dashboard`) полностью наполнена** — все 7 Pulse-виджетов + 3 KPI Hero + Team Health Grid + AI Narrative показывают живые цифры, графики, тренды.
2. **Каждая вкладка сайдбара** при заходе содержит ≥3 элемента (а не EmptyState «добавьте первый»).
3. **Кабинет выглядит как компания, работающая 3 месяца** — встречи распределены по 12 неделям, есть тренды (engagement Козлова падает к выгоранию), повторяющиеся темы реально повторяются ≥5 раз.
4. **Все данные статичны и детерминированы** — никаких LLM-вызовов на seed, один и тот же запуск seed даёт один и тот же кабинет, время seed ≤12 секунд.

---

## 2. Решения владельца (зафиксированы 2026-05-31)

| # | Решение | Импликация |
|---|---|---|
| 1 | **Snapshot'ы запекаем статично в seed** (не дёргаем cron-агентов) | Новый модуль `demo-data/pulse-snapshots.ts` с рукописными snapshot'ами. 0 LLM-вызовов. |
| 2 | **История симулируется на 3 месяца** (12 недель назад) | Расширяем с ~3 недель до 12. PersonEngagementSnapshot и PersonGoalContribution — единственные модели с настоящей историей; остальные snapshot'ы — только **последний** (так читает `pulse-patterns.service.ts`). |
| 3 | **Новый пользователь = НАБЛЮДАТЕЛЬ** в ТехноСтрим | User подключён `owner` к Org, но в Person/Appointment/CheckIn его нет. На `/me/*` видит EmptyState «вы новый — посмотрите примеры в кабинете». |
| 4 | **Включить:** `/referrals` (баланс + 3-5 рефералов), `/feedback` (3-5 обращений + AI-кластеры), `/documents` (3-5 загруженных). **Не включать:** `/settings/{integrations, api, webhooks, sources, exports}`. | См. §8. |

---

## 3. Важные находки из аудита кода (execution-критично)

### 3.1. Pulse-patterns читает snapshot'ы за КОРОТКИЕ окна

Из [`pulse-patterns.service.ts:57-96`](backend/src/modules/dashboard/services/pulse-patterns.service.ts#L57-L96):

| Виджет | Источник | Окно выборки | Что берёт |
|---|---|---|---|
| BusFactor | `KnowledgeRiskSnapshot` | **30 дней** | latest snapshot per `categoryName`, top 5 critical |
| RecurringTopic | `RecurringTopic` | **14 дней** | top 5 по `mentionCount DESC` |
| LowRoiMeetings | `Meeting.roiScore IS NOT NULL` | period (7d/30d) | top 3 ASC |
| Bottleneck | `CrossFunctionalFrictionReport` | **30 дней** | агрегация по `involvedDepartmentIds[]` в heatmap |
| GoalVector | `PersonGoalContribution` | **4 недели** (week) / **12 недель** (month) | group by `goalId`, top 5 по `_sum.netScore DESC` |
| KnowledgeVelocity | `KnowledgeVelocitySnapshot` | **без окна** | `findFirst orderBy snapshotAt DESC` (latest 1 шт) |
| IrreversibleDecisions | `Decision.reversibility = 'type-1'` | period (7d/30d) | top 10 DESC |

**Импликация для объёма seed:**
- KnowledgeRiskSnapshot: **1 snapshot per категория** (5 категорий → 5 записей), `snapshotAt = now() - 1 день`
- RecurringTopic: **1 snapshot per тема** (4 темы → 4 записи), `snapshotAt = now() - 2 дня`
- KnowledgeVelocitySnapshot: **1 запись** (не 12)
- CrossFunctionalFrictionReport: **3-5 актуальных** (createdAt в последние 14 дней)
- PersonGoalContribution: **80 записей** (5 person × 4 goals × 4 недели — покрывает оба view)
- PromiseNetworkSnapshot: **1 snapshot**

**Это в 4-6 раз меньше**, чем «12 weekly snapshot'ов на каждую модель» из v1 этого ТЗ.

### 3.2. Точные enum-значения и JSON-структуры

**`KnowledgeRiskSnapshot`** ([schema.prisma:6231](backend/prisma/schema.prisma#L6231)):
- `riskLevel`: `'critical'` (0-1 эксперт) | `'warning'` (2-3) | **`'ok'`** (≥4) — НЕ `'healthy'`
- `topExpertsJson` структура (читает [pulse-patterns.service.ts:502-514](backend/src/modules/dashboard/services/pulse-patterns.service.ts#L502-L514)):
  ```json
  {"experts": [{"personId": "demo-person-001", "name": "Дмитрий Козлов", "confidence": "high"}]}
  ```
  ⚠ Обёрнуто в `{experts: [...]}`, не голый массив.

**`RecurringTopic`** ([schema.prisma:6261](backend/prisma/schema.prisma#L6261)):
- Условие записи в cron'е: `mentionCount >= 5 AND hasImplementedDecision = false`. Если в seed создать тему с `mentionCount=4` — фронт всё равно её отрисует (фильтра в SELECT нет), но это будет противоречить логике агента. Делаем все ≥5.
- `blockIdsJson`: `string[]` — массив IdeaBlock.id (max 50), для drill-down.

**`PromiseNetworkSnapshot`** ([schema.prisma:6306](backend/prisma/schema.prisma#L6306)):
- ⚠ Узлы графа — **persons**, не отделы. `graphJson` структура:
  ```json
  {
    "nodes": [
      {"personId": "demo-person-001", "name": "Алексей Морозов",
       "role": "donor", "inDegree": 1, "outDegree": 4, "balance": -3}
    ],
    "edges": [
      {"fromPersonId": "...", "toPersonId": "...", "count": 2}
    ],
    "periodStart": "2026-05-01T00:00:00Z",
    "periodEnd": "2026-05-31T00:00:00Z"
  }
  ```
- Роли узлов: `'accumulator'` (in≥3×out) | `'donor'` (out≥3×in) | `'isolated'` (in+out≤1) | `'balanced'`.

**`PersonGoalContribution`** ([schema.prisma:6332](backend/prisma/schema.prisma#L6332)):
- `proScore`, `contraScore`, `netScore` — все `Decimal(8,3)`. В seed подаём **строкой** (Prisma Decimal: `'5.2'`, не `5.2`).
- `signalsJson` структура:
  ```json
  [{"kind": "idea", "refId": "demo-ib-001", "direction": "pro"},
   {"kind": "commitment_kept", "refId": "demo-ib-006", "direction": "pro"},
   {"kind": "commitment_broken", "refId": "demo-ib-011", "direction": "contra"}]
  ```
  `kind ∈ {'idea','commitment_kept','commitment_broken','issue_closed'}`.
- UNIQUE `(tenantId, personId, goalId, weekStart)` — повторный seed не подавится, но даст конфликт при повторном вызове без cleanup.

**`KnowledgeVelocitySnapshot`** ([schema.prisma:6367](backend/prisma/schema.prisma#L6367)):
- `medianHoursToAnswer: Decimal(10,2)?` — может быть NULL если данных не хватает.
- `topRespondersJson`: голый массив (parseTopResponders поддерживает оба формата, но cron пишет голый):
  ```json
  [{"personId": "demo-person-003", "name": "Дмитрий Козлов", "resolvedCount": 8},
   {"personId": "demo-person-004", "name": "Игорь Новиков", "resolvedCount": 5}]
  ```

**`PersonEngagementSnapshot`** ([schema.prisma:6158](backend/prisma/schema.prisma#L6158)):
- `score: Decimal(4,3)` — нормировано **0..1** (НЕ 0..100!). 0.75 → строкой `'0.750'`.
- `signalsJson` структура:
  ```json
  {"signals": {"checkin_sentiment": 0.7, "checkin_regularity": 0.9,
               "commitment_kept_ratio": 0.65, "meeting_activity": 0.5},
   "baseline": 0.7}
  ```

**`ForecastSnapshot`** ([schema.prisma:6201](backend/prisma/schema.prisma#L6201)):
- `scope ∈ {'company','team'}`, на MVP — только `'company'` с `scopeId=null`.
- `payloadJson` структура:
  ```json
  {
    "trend": "stable",
    "risks": ["Bus factor по auth = 1", "Engagement Козлова падает"],
    "opportunities": ["Пилот Ростелеком потенциал 2M ARR"],
    "expectedShifts": [
      {"metric": "sentiment_index", "direction": "flat", "confidence": 0.7},
      {"metric": "engagement_avg", "direction": "down", "confidence": 0.6}
    ],
    "modelName": "demo-deterministic-v1",
    "provenance": {"weeks": 4}
  }
  ```

**`CrossFunctionalFrictionReport`** ([schema.prisma:4909](backend/prisma/schema.prisma#L4909)):
- ⚠ Требует FK `processTemplateId String` — НЕ `?`. **Без `ProcessTemplate` в seed виджет Bottleneck не заработает.** См. §6.2 ниже.
- `severity ∈ {'low','medium','high'}` — числовое представление в `pulse-patterns.service.ts:severityToNumber`: low=1, medium=2, high=3.
- `involvedDepartmentIds: String[]` — массив `Department.id`. Heatmap: 0-1 dept → диагональ; ≥2 → все пары.
- `sourceBlockIds: String[]` — массив IdeaBlock.id (для drill-down).

**`Decision.reversibility`** (поле на `Decision`):
- `'type-1'` (irreversible) → попадает в `IrreversibleDecisionsAlert`. `'type-2'` (reversible) → нет.
- `alertCount` = число type-1 БЕЗ непустого `alternatives` (через `hasNonEmptyAlternatives`).
- Distribute: из 8 Decision → 2 type-1 (один с альтернативами, один без — даёт alertCount=1), остальные 6 type-2.

**`Meeting.roiScore`** (поле на `Meeting`):
- `Decimal(8,3)`, формула Pulse §6.3: `(decisions*10 + commitments*5 + tasks*3) / (avgParticipants * durationMinutes/60)`.
- В seed применить ко всем 20+ встречам детерминистически. Делать варианты: 2-3 встречи с `roiScore < 0.5` (low, попадают в виджет), остальные средние/высокие.

### 3.3. Семейство `Helpfulness*` / `Contribution*` требует РЕАЛЬНЫХ User-записей

Эти модели ссылаются на **`User.id`**, не `Person.id`:
- `HelpfulnessTrait.helperUserId / recipientUserId`
- `HelpfulnessSpotlight.helperUserId / approvedByUserId`
- `SocialContributionProfile.userId` (UNIQUE per userId)
- `ContributionSnapshot.userId` (UNIQUE per userId, **БЕЗ `tenantId`** — глобально)

Сейчас `seedOrgStructure` создаёт Person'ов **без User.id** (`userId: null`). Это значит:
- Никакие записи семейства Helpfulness/Contribution создать нельзя — нет userId.
- Существующие HelpfulnessSpotlight (полировка) — могут не работать из-за этого; проверить в Фазе 0.

**Решение:** добавить новый seed-модуль `users.ts`, который создаёт **5 демо-User'ов** для ключевых сотрудников и привязывает к `Person.userId`. Параметры:
- `email`: `morozov@technostream.io`, `volkova@technostream.io`, `kozlov@technostream.io`, `sokolova@technostream.io`, `petrova@technostream.io`
- `name`: «Алексей Морозов» и т.д.
- `passwordHash: null` — нельзя залогиниться
- `emailVerifiedAt: null`
- `companyRole`: `'founder' | 'coo' | 'team_lead' | 'specialist'` (по роли)
- `currentOrgId: ids.tenantId` (если поле есть в User)
- Дополнить `org-structure.ts` Фаза 4 — установить `Person.userId` после создания User'ов.

⚠ **Безопасность:** в `AuthService.login` уже должна быть проверка `passwordHash != null`, иначе любой может залогиниться под Козловым с пустым паролем. Проверить в Фазе 0; если такой проверки нет — **СНАЧАЛА** добавить её, потом сидить.

### 3.4. Существующий технический долг в `operations.ts`

[`operations.ts`](backend/src/modules/onboarding/demo-data/operations.ts) использует **хардкодные даты** (`'2026-05-15'..'2026-05-28'`), хотя в [`types.ts`](backend/src/modules/onboarding/demo-data/types.ts#L70) уже есть хелпер `daysAgo()`. Через 3-6 месяцев check-in'ы будут «висеть в прошлом» — UI это покажет как «выгоревшая» компания.

**Решение в рамках этого ТЗ:** переписать `operations.ts` на `daysAgo(N)`:
- Workdays: последние 30 рабочих дней (исключая суббота/воскресенье через `d.getDay()`)
- Использовать `at(daysAgo(N), 9)` для morning и `at(daysAgo(N), 19)` для evening (поле `submittedAt`)
- Все 5 ключевых сотрудников × 30 рабочих дней × 2 = 300 DailyCheckIn (вместо текущих 100)

### 3.5. Чего НЕТ в схеме (страницы, которые остаются пустыми)

Поиск через `Grep ^model X` показал, что нет:

| Не существует | Альтернатива / решение |
|---|---|
| `Promise` | Реализован через `IdeaBlock.signalType='commitment'` + `IdeaBlock.commitmentRecipientPersonId` ([schema.prisma:2855](backend/prisma/schema.prisma#L2855)). Страницу `/me/promises` (если она вообще есть) фронт собирает SELECT'ом по этому полю. Seed: создать 15-20 IdeaBlock'ов с `signalType='commitment'` и `commitmentRecipientPersonId` ≠ null. |
| `SprintReview` | Реализован через `Cycle.progressSnapshot Json?` ([schema.prisma:7686](backend/prisma/schema.prisma#L7686)) + `SprintAnalystService`. Seed: заполнить `progressSnapshot` для 2 завершённых Cycle'ов JSON-объектом `{total, completed, inProgress, ...}`. |
| `HrRecommendation` | Не существует. Фронт-виджет с HR-рекомендациями (если есть) либо вычисляет на лету, либо это будущая модель. **Пока не сидим.** Проверить страницу `/me/dashboard` в Фазе 8.6 — если EmptyState страшный — открыть отдельную задачу. |
| `Maturity` / `MaturitySnapshot` | Не существует. `MaturityWidget` в `/dashboard/operations/` (Pulse W2.3) использует `FunctionalDomain` агрегацию (?). Проверить в Фазе 8.6, не сидим как отдельную модель. |
| `TeamHealth` / `TeamHealthSnapshot` | Не существует. Team Health Grid использует `PersonEngagementSnapshot` per Department. Уже покрываем. |

### 3.6. `ProcessTemplate` нужен для CrossFunctionalFrictionReport

[`ProcessTemplate`](backend/prisma/schema.prisma#L4856) — есть. Это **шаблон процесса** (с версиями `ProcessTemplateVersion`), отличается от `Process`/`ProcessStep` которые сейчас в seed.

Чтобы `CrossFunctionalFrictionReport` создать — нужен FK `processTemplateId`. Решение: создать **3-5 ProcessTemplate** в новом seed-модуле:
- «Sales-to-Engineering Handoff» (cross-functional, scope='org', category='handoff')
- «Customer Onboarding» (cross-functional, scope='org', category='customer')
- «Bug Triage Process» (scope='engineering', category='quality')

Минимальные поля (см. [schema.prisma:4856-4904](backend/prisma/schema.prisma#L4856-L4904)) — name, scope, category, isCrossFunctional, и т.д.

---

## 4. Расширение `SeedContext` и `IdMap`

[`types.ts`](backend/src/modules/onboarding/demo-data/types.ts) дополнить:

```ts
export interface IdMap {
  // Existing
  departments: Record<string, string>;
  roles: Record<string, string>;
  persons: Record<string, string>;
  projects: Record<string, string>;
  boards: Record<string, string>;
  states: Record<string, string>;
  cycles: Record<string, string>;
  labels: Record<string, string>;
  issues: Record<string, string>;
  meetings: Record<string, string>;
  ideaBlocks: Record<string, string>;
  entities: Record<string, string>;
  themes: Record<string, string>;
  goals: Record<string, string>;
  skillProfiles: Record<string, string>;
  cards: Record<string, string>;
  processes: Record<string, string>;

  // ── NEW (этот ТЗ) ──
  users: Record<string, string>;              // 5 демо-User'ов
  processTemplates: Record<string, string>;   // 3-5 шаблонов процессов (для CrossFunctionalFrictionReport)
  regulations: Record<string, string>;        // 5 регламентов
  ideas: Record<string, string>;              // 10 идей
  ideaClusters: Record<string, string>;       // 3 кластера
  events: Record<string, string>;             // 18 календарных событий
  documents: Record<string, string>;          // 5 документов
  referralLinkId: string | null;              // 1 ref-link владельца Org
  referrals: Record<string, string>;          // 5 атрибутированных Org
  feedbackMessages: Record<string, string>;   // 8 обратной связи
  feedbackTopics: Record<string, string>;     // 3 AI-кластера
  experiments: Record<string, string>;        // 3 эксперимента
  vendors: Record<string, string>;            // 4 вендора
  probeEvents: Record<string, string>;        // 10 probe-вопросов

  // Pulse-snapshot'ы — обычно не нужны для других модулей, но для consistency:
  pulseSnapshotIds: {
    knowledgeRisks: string[];
    recurringTopics: string[];
    personGoalContributions: string[];
    promiseNetwork: string | null;
    knowledgeVelocity: string | null;
    personEngagements: string[];
    forecasts: string[];
    frictionReports: string[];
    helpfulnessTraits: string[];
    helpfulnessSpotlights: string[];
    socialContributions: string[];
    contributions: string[];
  };
}

export function createEmptyIdMap(): IdMap {
  return {
    departments: {},
    roles: {},
    persons: {},
    projects: {},
    boards: {},
    states: {},
    cycles: {},
    labels: {},
    issues: {},
    meetings: {},
    ideaBlocks: {},
    entities: {},
    themes: {},
    goals: {},
    skillProfiles: {},
    cards: {},
    processes: {},
    users: {},
    processTemplates: {},
    regulations: {},
    ideas: {},
    ideaClusters: {},
    events: {},
    documents: {},
    referralLinkId: null,
    referrals: {},
    feedbackMessages: {},
    feedbackTopics: {},
    experiments: {},
    vendors: {},
    probeEvents: {},
    pulseSnapshotIds: {
      knowledgeRisks: [],
      recurringTopics: [],
      personGoalContributions: [],
      promiseNetwork: null,
      knowledgeVelocity: null,
      personEngagements: [],
      forecasts: [],
      frictionReports: [],
      helpfulnessTraits: [],
      helpfulnessSpotlights: [],
      socialContributions: [],
      contributions: [],
    },
  };
}
```

`SeedContext` остаётся `{prisma, tenantId, ownerUserId}` — менять не нужно.

---

## 5. Порядок вызовов в `OnboardingService.seedDemoWorkspace`

Полный новый порядок (15 модулей, было 8):

```ts
await seedUsers(ctx, ids);              // 🆕 ПЕРВЫМ — 5 демо-User'ов
await seedOrgStructure(ctx, ids);       // 📝 Расширить: установить Person.userId после создания
await seedProcessTemplates(ctx, ids);   // 🆕 3-5 ProcessTemplate (для FrictionReport)
await seedVendors(ctx, ids);            // 🆕 4 vendor (AWS, Cloudflare, Stripe, 1С-Битрикс)
await seedTracker(ctx, ids);            // 📝 +заполнить Cycle.progressSnapshot для 2 завершённых
await seedMeetings(ctx, ids);           // 📝 7→20 встреч за 12 недель + Meeting.roiScore
await seedKnowledgeGraph(ctx, ids);     // 📝 IdeaBlock 20→40, +commitmentRecipientPersonId для 15-20 шт
await seedGoalsClones(ctx, ids);        // 📝 +Decision.reversibility для 8 решений
await seedRegulations(ctx, ids);        // 🆕 5 регламентов
await seedIdeas(ctx, ids);              // 🆕 10 идей + 3 кластера
await seedDocuments(ctx, ids);          // 🆕 5 документов
await seedCalendar(ctx, ids);           // 🆕 18 событий + 5 напоминаний
await seedExperiments(ctx, ids);        // 🆕 3 эксперимента
await seedBrandVoice(ctx, ids);         // 🆕 1 BrandVoiceProfile
await seedProbeEvents(ctx, ids);        // 🆕 10 probe-вопросов
await seedOperations(ctx, ids);         // 📝 ПЕРЕПИСАТЬ на daysAgo() + DailyCheckIn 100→300, Weekly 3→12, Daily 5→15
await seedPulseSnapshots(ctx, ids);     // 🆕 8 Pulse-моделей (см. §6)
await seedHelpfulness(ctx, ids);        // 🆕 HelpfulnessTrait/Spotlight/SocialContribution/Contribution
await seedReferrals(ctx, ids);          // 🆕 1 ref-link + 5 Referral + 2 Payout
await seedFeedback(ctx, ids);           // 🆕 8 FeedbackMessage + 3 FeedbackTopic + FeedbackItem
await seedChatNotifications(ctx, ids);  // 📝 Notification 10→25
await seedPolish(ctx, ids);             // (оставить как есть)

// Markers and final
await markAllDemoEntitiesForTenant(prisma, orgId);  // ⚠ перед этим — синхронизировать список таблиц (см. §6.3)
await prisma.org.update({where: {id: orgId}, data: {demoWorkspaceSeededAt: new Date()}});
```

Зависимости (что от чего):
- `seedUsers` → нужен ДО `seedOrgStructure` (чтобы привязать Person.userId)
- `seedOrgStructure` → нужен ДО `seedTracker`/`seedMeetings`/etc.
- `seedProcessTemplates` → нужен ДО `seedPulseSnapshots` (для CrossFunctionalFrictionReport.processTemplateId)
- `seedKnowledgeGraph` → нужен ДО `seedPulseSnapshots` (для blockIdsJson в RecurringTopic, sourceBlockIds в FrictionReport)
- `seedHelpfulness` → нужен ПОСЛЕ `seedUsers` (userId)

---

## 6. Каталог новых seed-модулей

### 6.1. `seedUsers` — 5 демо-User'ов (приоритет 0)

**Файл:** `backend/src/modules/onboarding/demo-data/users.ts`

**Создаёт:**
```ts
const USER_DEFS = [
  {key: 'morozov',  email: 'morozov@technostream.io',  name: 'Алексей Морозов',    companyRole: 'founder'},
  {key: 'volkova',  email: 'volkova@technostream.io',  name: 'Марина Волкова',     companyRole: 'coo'},
  {key: 'kozlov',   email: 'kozlov@technostream.io',   name: 'Дмитрий Козлов',     companyRole: 'team_lead'},
  {key: 'sokolova', email: 'sokolova@technostream.io', name: 'Екатерина Соколова', companyRole: 'specialist'},
  {key: 'petrova',  email: 'petrova@technostream.io',  name: 'Анна Петрова',       companyRole: 'specialist'},
] as const;

for (const u of USER_DEFS) {
  const user = await prisma.user.create({
    data: {
      email: u.email,
      name: u.name,
      passwordHash: null,           // ⚠ нельзя залогиниться
      emailVerifiedAt: null,
      companyRole: u.companyRole as any,
      // currentOrgId — поставим в seedOrgStructure после создания Org? (если поле есть)
    },
  });
  ids.users[u.key] = user.id;
}
```

**Дополнить `seedOrgStructure`:** после создания Person'ов — UPDATE `userId`:
```ts
for (const p of personDefs) {
  if (USER_KEYS.has(p.key)) {
    await prisma.person.update({
      where: {id: ids.persons[p.key]},
      data: {userId: ids.users[p.key]},
    });
  }
}
```

**Безопасность:** проверить [`AuthService.login`](backend/src/modules/auth/) что отказывает при `passwordHash === null`. Если нет — добавить ДО выкатки этого ТЗ.

### 6.2. `seedProcessTemplates` — 3-5 шаблонов (приоритет 0 — блокер для Bottleneck виджета)

**Файл:** `backend/src/modules/onboarding/demo-data/process-templates.ts`

```ts
const TEMPLATE_DEFS = [
  {
    key: 'sales_to_eng',
    name: 'Передача из Sales в Engineering',
    scope: 'org',
    category: 'handoff',
    isCrossFunctional: true,
  },
  {
    key: 'customer_onboarding',
    name: 'Онбординг клиента',
    scope: 'org',
    category: 'customer',
    isCrossFunctional: true,
  },
  {
    key: 'bug_triage',
    name: 'Триаж багов',
    scope: 'engineering',
    category: 'quality',
    isCrossFunctional: false,
  },
];
```

Использовать только минимальные поля — фронту для Bottleneck heatmap нужны только `id` и существование. Минимальная версия `ProcessTemplateVersion` опц.

### 6.3. `seedPulseSnapshots` — 8 Pulse-моделей (приоритет 0 — главная морда)

**Файл:** `backend/src/modules/onboarding/demo-data/pulse-snapshots.ts` (~700 строк)

**Полное содержание моделей — execution-ready:**

#### 6.3.1. `KnowledgeRiskSnapshot` × 5

```ts
const KNOWLEDGE_RISKS = [
  {
    categoryName: 'Авторизация / OAuth2',
    highConfidenceCount: 1,
    totalExpertsCount: 1,
    riskLevel: 'critical',
    topExpertsJson: {experts: [
      {personId: ids.persons.kozlov, name: 'Дмитрий Козлов', confidence: 'high'},
    ]},
  },
  {
    categoryName: 'Дизайн-система',
    highConfidenceCount: 1,
    totalExpertsCount: 1,
    riskLevel: 'critical',
    topExpertsJson: {experts: [
      {personId: ids.persons.petrova, name: 'Анна Петрова', confidence: 'high'},
    ]},
  },
  {
    categoryName: 'Kubernetes / DevOps',
    highConfidenceCount: 2,
    totalExpertsCount: 3,
    riskLevel: 'warning',
    topExpertsJson: {experts: [
      {personId: ids.persons.novikov, name: 'Игорь Новиков', confidence: 'high'},
      {personId: ids.persons.kozlov,  name: 'Дмитрий Козлов', confidence: 'high'},
      {personId: ids.persons.sidorov, name: 'Павел Сидоров',  confidence: 'medium'},
    ]},
  },
  {
    categoryName: 'Stripe / платежи',
    highConfidenceCount: 2,
    totalExpertsCount: 2,
    riskLevel: 'warning',
    topExpertsJson: {experts: [
      {personId: ids.persons.novikov, name: 'Игорь Новиков',  confidence: 'high'},
      {personId: ids.persons.morozov, name: 'Алексей Морозов', confidence: 'high'},
    ]},
  },
  {
    categoryName: 'CustDev / B2B-продажи',
    highConfidenceCount: 4,
    totalExpertsCount: 4,
    riskLevel: 'ok',
    topExpertsJson: {experts: [
      {personId: ids.persons.sokolova, name: 'Екатерина Соколова', confidence: 'high'},
      {personId: ids.persons.volkova,  name: 'Марина Волкова',     confidence: 'high'},
      {personId: ids.persons.morozov,  name: 'Алексей Морозов',    confidence: 'high'},
      {personId: ids.persons.lebedev,  name: 'Виктор Лебедев',     confidence: 'high'},
    ]},
  },
];

for (const r of KNOWLEDGE_RISKS) {
  const snap = await prisma.knowledgeRiskSnapshot.create({
    data: {
      tenantId,
      categoryName: r.categoryName,
      highConfidenceCount: r.highConfidenceCount,
      totalExpertsCount: r.totalExpertsCount,
      riskLevel: r.riskLevel,
      topExpertsJson: r.topExpertsJson as any,
      snapshotAt: daysAgo(1),
    },
  });
  ids.pulseSnapshotIds.knowledgeRisks.push(snap.id);
}
```

#### 6.3.2. `RecurringTopic` × 4

```ts
const RECURRING = [
  {
    themeKey: 'storage_capacity',   // или null если темы нет
    themeName: 'Storage capacity у клиентов',
    mentionCount: 7,
    meetingCount: 5,
    hasImplementedDecision: false,
    windowStart: daysAgo(30),
    windowEnd: daysAgo(0),
    blockKeys: ['ib1', 'ib16', 'ib19'],  // → blockIdsJson
  },
  {
    themeName: 'Code review SLA',
    mentionCount: 6,
    meetingCount: 4,
    hasImplementedDecision: false,
    windowStart: daysAgo(30),
    windowEnd: daysAgo(0),
    blockKeys: ['ib8', 'ib11'],
  },
  {
    themeName: 'Onboarding новичков медленный',
    mentionCount: 5,
    meetingCount: 3,
    hasImplementedDecision: false,
    windowStart: daysAgo(30),
    windowEnd: daysAgo(0),
    blockKeys: ['ib14'],
  },
  {
    themeName: 'Stripe sandbox нестабилен',
    mentionCount: 5,
    meetingCount: 2,
    hasImplementedDecision: false,
    windowStart: daysAgo(21),
    windowEnd: daysAgo(0),
    blockKeys: [],
  },
];

for (const t of RECURRING) {
  const snap = await prisma.recurringTopic.create({
    data: {
      tenantId,
      themeId: t.themeKey ? ids.themes[t.themeKey] ?? null : null,
      themeName: t.themeName,
      mentionCount: t.mentionCount,
      meetingCount: t.meetingCount,
      hasImplementedDecision: t.hasImplementedDecision,
      blockIdsJson: t.blockKeys.map(k => ids.ideaBlocks[k]).filter(Boolean) as any,
      windowStart: t.windowStart,
      windowEnd: t.windowEnd,
      snapshotAt: daysAgo(2),
    },
  });
  ids.pulseSnapshotIds.recurringTopics.push(snap.id);
}
```

#### 6.3.3. `PromiseNetworkSnapshot` × 1

```ts
const graphNodes = [
  {personId: ids.persons.morozov,  name: 'Алексей Морозов',    role: 'donor',       inDegree: 1, outDegree: 4, balance: -3},
  {personId: ids.persons.volkova,  name: 'Марина Волкова',     role: 'accumulator', inDegree: 5, outDegree: 1, balance: 4},
  {personId: ids.persons.kozlov,   name: 'Дмитрий Козлов',     role: 'accumulator', inDegree: 6, outDegree: 2, balance: 4},
  {personId: ids.persons.sokolova, name: 'Екатерина Соколова', role: 'balanced',    inDegree: 3, outDegree: 3, balance: 0},
  {personId: ids.persons.petrova,  name: 'Анна Петрова',       role: 'balanced',    inDegree: 2, outDegree: 2, balance: 0},
];
const graphEdges = [
  {fromPersonId: ids.persons.morozov,  toPersonId: ids.persons.kozlov,   count: 2},
  {fromPersonId: ids.persons.morozov,  toPersonId: ids.persons.volkova,  count: 1},
  {fromPersonId: ids.persons.sokolova, toPersonId: ids.persons.volkova,  count: 2},
  // ... ещё 5-7
];
const snap = await prisma.promiseNetworkSnapshot.create({
  data: {
    tenantId,
    graphJson: {
      nodes: graphNodes,
      edges: graphEdges,
      periodStart: daysAgo(30).toISOString(),
      periodEnd: daysAgo(0).toISOString(),
    } as any,
    totalCommitments: 17,
    snapshotAt: daysAgo(1),
  },
});
ids.pulseSnapshotIds.promiseNetwork = snap.id;
```

#### 6.3.4. `PersonGoalContribution` × 80 (5 × 4 × 4 недели)

```ts
const personKeys = ['morozov', 'volkova', 'kozlov', 'sokolova', 'petrova'] as const;
const goalKeys   = ['arr_10m', 'release_v2', 'mobile_appstore', 'nps_50'] as const;
const weekOffsets = [21, 14, 7, 0] as const;  // 4 недели назад → текущая

// distribution table (personKey, goalKey) → [pro, contra, signals]
const CONTRIB_TABLE = {
  morozov: {
    arr_10m:        {pro: '6.5', contra: '0.5', signalsKinds: ['idea','idea']},
    release_v2:     {pro: '2.0', contra: '1.0', signalsKinds: ['idea']},
    mobile_appstore:{pro: '1.5', contra: '0.5', signalsKinds: ['idea']},
    nps_50:         {pro: '3.0', contra: '0.5', signalsKinds: ['idea','commitment_kept']},
  },
  kozlov: {
    arr_10m:        {pro: '0.5', contra: '0.0', signalsKinds: []},
    release_v2:    {pro: '8.0', contra: '0.5', signalsKinds: ['issue_closed','issue_closed','commitment_kept']},
    mobile_appstore:{pro: '1.0', contra: '2.5', signalsKinds: ['commitment_broken']},
    nps_50:         {pro: '0.5', contra: '0.0', signalsKinds: []},
  },
  // ... и так для volkova, sokolova, petrova
};

for (const personKey of personKeys) {
  for (const goalKey of goalKeys) {
    const base = CONTRIB_TABLE[personKey][goalKey];
    for (const offset of weekOffsets) {
      const weekStart = daysAgo(offset);
      weekStart.setHours(0, 0, 0, 0);
      const weekDayOffset = (weekStart.getDay() + 6) % 7;  // Monday=0
      weekStart.setDate(weekStart.getDate() - weekDayOffset);

      // Мини-вариация ±20% от base за разные недели
      const variance = 0.8 + (offset / 21) * 0.4;
      const pro    = (parseFloat(base.pro)    * variance).toFixed(3);
      const contra = (parseFloat(base.contra) * variance).toFixed(3);
      const net    = (parseFloat(pro) - parseFloat(contra)).toFixed(3);

      const c = await prisma.personGoalContribution.create({
        data: {
          tenantId,
          personId: ids.persons[personKey]!,
          goalId:   ids.goals[goalKey]!,
          proScore: pro,
          contraScore: contra,
          netScore: net,
          signalsJson: base.signalsKinds.map((kind, i) => ({
            kind,
            refId: ids.ideaBlocks[`ib${(i + 1)}`] ?? 'demo-ref',  // подвязать к реальным IdeaBlock
            direction: kind === 'commitment_broken' ? 'contra' : 'pro',
          })) as any,
          weekStart,
          snapshotAt: daysAgo(1),
        },
      });
      ids.pulseSnapshotIds.personGoalContributions.push(c.id);
    }
  }
}
```

#### 6.3.5. `KnowledgeVelocitySnapshot` × 1

```ts
await prisma.knowledgeVelocitySnapshot.create({
  data: {
    tenantId,
    medianHoursToAnswer: '6.50',
    resolvedGapsCount: 12,
    openGapsCount: 4,
    topRespondersJson: [
      {personId: ids.persons.kozlov,   name: 'Дмитрий Козлов',  resolvedCount: 6},
      {personId: ids.persons.novikov,  name: 'Игорь Новиков',   resolvedCount: 4},
      {personId: ids.persons.morozov,  name: 'Алексей Морозов', resolvedCount: 3},
    ] as any,
    windowStart: daysAgo(30),
    windowEnd: daysAgo(0),
    snapshotAt: daysAgo(1),
  },
});
```

#### 6.3.6. `PersonEngagementSnapshot` × 60 (5 × 12 недель)

```ts
const ENGAGEMENT_TRAJECTORIES = {
  // Возвращает score 0..1 для отступа N недель назад (0 = текущая)
  morozov:  (w: number) => [0.60,0.65,0.62,0.68,0.70,0.72,0.68,0.75,0.78,0.72,0.70,0.68][w] ?? 0.7,
  volkova:  (w: number) => [0.88,0.85,0.90,0.92,0.88,0.85,0.82,0.80,0.78,0.75,0.78,0.80][w] ?? 0.83,
  kozlov:   (w: number) => [0.75,0.78,0.82,0.80,0.78,0.72,0.68,0.65,0.62,0.58,0.55,0.52][w] ?? 0.68,  // ⬇ выгорание
  sokolova: (w: number) => [0.75,0.80,0.85,0.88,0.90,0.88,0.92,0.90,0.88,0.85,0.82,0.80][w] ?? 0.85,
  petrova:  (w: number) => [0.90,0.88,0.85,0.82,0.80,0.78,0.75,0.72,0.70,0.68,0.65,0.62][w] ?? 0.76,  // ⬇ выгорание
};

for (const personKey of personKeys) {
  for (let w = 0; w < 12; w++) {
    const score = ENGAGEMENT_TRAJECTORIES[personKey](w);
    const snap = await prisma.personEngagementSnapshot.create({
      data: {
        tenantId,
        personId: ids.persons[personKey]!,
        score: score.toFixed(3),
        signalsJson: {
          signals: {
            checkin_sentiment: (score + 0.05).toFixed(3),
            checkin_regularity: '0.900',
            commitment_kept_ratio: score > 0.7 ? '0.800' : '0.500',
            meeting_activity: '0.700',
          },
          baseline: '0.700',
        } as any,
        snapshotAt: daysAgo(w * 7),
      },
    });
    ids.pulseSnapshotIds.personEngagements.push(snap.id);
  }
}
```

#### 6.3.7. `ForecastSnapshot` × 4 (последние 4 недели — для тренда на дашборде)

```ts
const FORECAST_VARIANTS = [
  // 4 weeks back: tone matched
  {trend: 'improving', risks: ['Bus factor по auth=1'], opportunities: ['Custdev Ростелеком положителен']},
  {trend: 'stable',    risks: ['Bus factor по auth=1', 'Engagement Козлова -5%'], opportunities: ['Партнёрство с 1С']},
  {trend: 'stable',    risks: ['Engagement Козлова -12% за 4 недели'], opportunities: ['Пилот Ростелеком потенциал 2M ARR']},
  {trend: 'declining', risks: ['Engagement Козлова -28% за 12 недель', 'NPS прогноз 48', 'Storage capacity повторяется 7 раз'], opportunities: []},
];

for (let i = 0; i < FORECAST_VARIANTS.length; i++) {
  const v = FORECAST_VARIANTS[i]!;
  const snap = await prisma.forecastSnapshot.create({
    data: {
      tenantId,
      scope: 'company',
      scopeId: null,
      payloadJson: {
        trend: v.trend,
        risks: v.risks,
        opportunities: v.opportunities,
        expectedShifts: [
          {metric: 'sentiment_index',    direction: 'flat', confidence: 0.7},
          {metric: 'engagement_avg',     direction: 'down', confidence: 0.6},
          {metric: 'commitment_kept_ratio', direction: 'flat', confidence: 0.65},
        ],
        modelName: 'demo-deterministic-v1',
        provenance: {weeks: 4},
      } as any,
      snapshotAt: daysAgo((FORECAST_VARIANTS.length - 1 - i) * 7),
    },
  });
  ids.pulseSnapshotIds.forecasts.push(snap.id);
}
```

#### 6.3.8. `CrossFunctionalFrictionReport` × 3

```ts
const FRICTIONS = [
  {
    processTemplateKey: 'sales_to_eng',
    severity: 'high',
    description: 'Sales обещают клиентам функции до согласования с разработкой. 6 случаев за месяц — Engineering догоняет.',
    sourceBlockKeys: ['ib2', 'ib18'],
    involvedDepartmentKeys: ['sales', 'engineering'],
    recommendedAction: 'Внедрить sync-чек до commitment\'а с клиентом.',
  },
  {
    processTemplateKey: 'bug_triage',
    severity: 'high',
    description: 'Нет процесса QA-валидации, баги обнаруживаются в проде. 4 инцидента за 30 дней.',
    sourceBlockKeys: ['ib8', 'ib15'],
    involvedDepartmentKeys: ['engineering'],  // 1 dept → диагональ heatmap
    recommendedAction: 'Найм QA-инженера или ротация разработчиков на тестирование.',
  },
  {
    processTemplateKey: 'customer_onboarding',
    severity: 'medium',
    description: 'Маркетинговые материалы не соответствуют возможностям продукта; Customer Success объясняет постоянно.',
    sourceBlockKeys: ['ib10'],
    involvedDepartmentKeys: ['marketing', 'support'],
    recommendedAction: 'Согласование лендингов с CS до публикации.',
  },
];

for (const f of FRICTIONS) {
  const report = await prisma.crossFunctionalFrictionReport.create({
    data: {
      tenantId,
      processTemplateId: ids.processTemplates[f.processTemplateKey]!,
      severity: f.severity,
      description: f.description,
      sourceBlockIds: f.sourceBlockKeys.map(k => ids.ideaBlocks[k]!).filter(Boolean),
      involvedDepartmentIds: f.involvedDepartmentKeys.map(k => ids.departments[k]!),
      recommendedAction: f.recommendedAction,
      resolvedAt: null,
      createdAt: daysAgo(5 + Math.floor(Math.random() * 10)),  // ⚠ нельзя Random — заменить на детерминизм
    },
  });
  ids.pulseSnapshotIds.frictionReports.push(report.id);
}
```

⚠ Заменить `Math.random()` на детерминизм (например, `daysAgo(7 + i*2)`).

### 6.4. `seedHelpfulness` — Helpfulness/Contribution/Spotlight (приоритет 1)

**Файл:** `backend/src/modules/onboarding/demo-data/helpfulness.ts`

Требует `ids.users` (создан в `seedUsers`).

**Создаёт:**
- `HelpfulnessTrait` × 25 (по 5 на user, разные traitType'ы)
- `HelpfulnessSpotlight` × 5 (status='published', `externalSource='demo'`)
- `SocialContributionProfile` × 5 (UNIQUE per userId)
- `ContributionSnapshot` × 5 (UNIQUE per userId, **без tenantId!**)

Пример HelpfulnessTrait:
```ts
const TRAITS = [
  {helperKey: 'kozlov', recipientKey: 'novikov', traitType: 'mentoring',
   intensity: '0.850', topicHint: 'OAuth2 архитектура', confidence: '0.900',
   visibility: 'public_team', evidenceQuote: 'Проводил парное программирование 3 дня — Игорь освоил рефакторинг.'},
  {helperKey: 'kozlov', recipientKey: 'sidorov', traitType: 'help_provided',
   intensity: '0.700', topicHint: 'Code review', confidence: '0.850',
   visibility: 'public_team', evidenceQuote: 'Каждый PR — детальный review.'},
  // ...
];
```

`SocialContributionProfile`:
```ts
{
  tenantId, userId: ids.users.kozlov,
  helpProvidedCount: 12, proactiveHintCount: 5, mentoringCount: 4, emotionalSupportCount: 1,
  expertiseTopics: ['OAuth2', 'security', 'PostgreSQL', 'NestJS'],
  socialRoles: ['mentor', 'problem_solver'],
  lastWeekHelpCount: 3, lastMonthHelpCount: 11,
  contributionScoreCached: '0.850',
  buildVersion: 1, lastBuiltAt: daysAgo(1),
}
```

`ContributionSnapshot`:
```ts
{
  userId: ids.users.kozlov,
  ideasInDevelopment: 3, ideasShipped: 7,
  thanksReceived: 14, thanksReceivedWeek: 2,
  currentCheckinStreak: 8, longestCheckinStreak: 14,
  helpfulComments: 11, probeQuestionsAnswered: 5,
}
```

### 6.5. `seedRegulations` — 5 регламентов

```ts
const REGULATIONS = [
  {
    name: 'Регламент code review',
    kind: 'regulation',  // или 'process' / 'policy' — выяснить в Фазе 0 какое поле и enum
    text: 'Каждый PR проходит обязательное review минимум одним инженером...',
    ownerPersonKey: 'kozlov',
    sourceBlockKeys: ['ib8', 'ib11'],
    // прочие поля — проверить schema.prisma:5071
  },
  {name: 'Регламент релиза hotfix', ownerPersonKey: 'kozlov', /*...*/},
  {name: 'Регламент онбординга нового сотрудника', ownerPersonKey: 'volkova', /*...*/},
  {name: 'Регламент CustDev-интервью', ownerPersonKey: 'sokolova', /*...*/},
  {name: 'Регламент эскалации инцидента', ownerPersonKey: 'morozov', /*...*/},
];
```

### 6.6. `seedIdeas` — 10 идей + 3 кластера

```ts
const IDEA_CLUSTERS = [
  {key: 'ui_improvements', name: 'UI улучшения'},
  {key: 'integrations',    name: 'Интеграции с внешними системами'},
  {key: 'performance',     name: 'Производительность'},
];

const IDEAS = [
  {clusterKey: 'ui_improvements', kind: 'internal',       authorKey: 'petrova',
   text: 'Добавить тёмную тему', supporterCount: 5},
  {clusterKey: 'ui_improvements', kind: 'internal',       authorKey: 'petrova',
   text: 'Кастомизируемые шорткаты', supporterCount: 3},
  {clusterKey: 'integrations',    kind: 'client_request', authorKey: 'sokolova',
   text: 'Slack-интеграция (запрос от Ростелеком)', supporterCount: 7},
  {clusterKey: 'integrations',    kind: 'client_request', authorKey: 'sokolova',
   text: 'Webhooks для CRM (Сбербанк)', supporterCount: 4},
  // ... ещё 6
];
```

Поля `Idea` и `IdeaCluster` — посмотреть [schema.prisma:5487, 5536].

### 6.7. `seedDocuments` — 5 документов

```ts
const DOCUMENTS = [
  {name: 'Должностная инструкция Tech Lead', kind: 'text', mimeType: 'text/plain',
   inlineContent: '...многострочный текст...', uploaderPersonKey: 'morozov'},
  {name: 'Брендбук ТехноСтрим v2', kind: 'text', mimeType: 'text/markdown',
   inlineContent: '# Брендбук\n...', uploaderPersonKey: 'volkova'},
  {name: 'Шаблон NDA для клиентов', /*...*/},
  {name: 'Положение об оплате труда', /*...*/},
  {name: 'Roadmap Q2-Q3', /*...*/},
];
```

Без S3 — `inlineContent` как Buffer.

### 6.8. `seedCalendar` — 18 событий + 5 напоминаний

```ts
// Прошедшие: за последние 30 дней
const PAST_EVENTS = [
  {title: 'CustDev: Ростелеком',           daysFromNow: -28, durationMin: 60, kind: 'meeting',
   organizerKey: 'sokolova', participantKeys: ['sokolova', 'volkova', 'morozov']},
  // ... ещё 12 (используя существующие meetings + дополнительные)
];

// Будущие: на следующие 7 дней
const UPCOMING_EVENTS = [
  {title: 'Sprint 14 planning',  daysFromNow: 1, durationMin: 60, kind: 'meeting'},
  {title: 'CustDev: Сбербанк',   daysFromNow: 2, durationMin: 90, kind: 'meeting'},
  {title: 'Дизайн-ревью CallScreen v4', daysFromNow: 3, durationMin: 45, kind: 'meeting'},
  {title: 'Демо-день',           daysFromNow: 5, durationMin: 30, kind: 'meeting'},
  {title: 'Ретроспектива Q2',    daysFromNow: 7, durationMin: 90, kind: 'meeting'},
];

// EventReminder для 5 будущих
```

### 6.9. `seedReferrals` — 1 ссылка + 5 рефералов + 2 выплаты

```ts
// 1 ref-link владельца Org
const link = await prisma.clientReferralLink.create({
  data: {
    tenantId, ownerUserId,
    slug: `demo-${tenantId.slice(-6)}`,
    isActive: true,
  },
});
ids.referralLinkId = link.id;

// 5 атрибутированных Org (синтетические, kind='referred_demo')
const REFERRALS = [
  {orgName: 'ООО ВидеоПрофи',   status: 'paid',    paidKopecks: 6_000_000, daysAgo: 25},
  {orgName: 'ИП Иванов А.А.',  status: 'paid',    paidKopecks: 6_000_000, daysAgo: 10},
  {orgName: 'ТД Северный',     status: 'demo',    paidKopecks: 0,         daysAgo: 5},
  {orgName: 'Артель Соль',     status: 'demo',    paidKopecks: 0,         daysAgo: 3},
  {orgName: 'СтройКомплекс',   status: 'bonus',   paidKopecks: 0,         daysAgo: 1},
];

// 2 ReferralPayout (за две paid Org × 20 000 ₽)
```

### 6.10. `seedFeedback` — 8 сообщений + 3 темы

```ts
const FEEDBACK_TOPICS = [
  {key: 'ui_polish',      name: 'UI/UX полировка',                summary: 'Запросы на улучшение интерфейса'},
  {key: 'speed',          name: 'Скорость работы',                summary: 'Жалобы на тормоза в больших проектах'},
  {key: 'export_integration', name: 'Экспорт и интеграции',       summary: 'Запросы на CSV/Excel экспорт'},
];

const FEEDBACK_MSGS = [
  {topicKey: 'ui_polish',   authorPersonKey: 'petrova', text: 'Тёмная тема для длинных встреч'},
  {topicKey: 'ui_polish',   authorPersonKey: 'volkova', text: 'Дашборд можно компактнее'},
  {topicKey: 'speed',       authorPersonKey: 'kozlov',  text: 'Открытие большого проекта 5+ секунд'},
  // ... ещё 5
];

// FeedbackItem связывает messages с topics
```

### 6.11. `seedExperiments` — 3 эксперимента, `seedBrandVoice`, `seedVendors`, `seedProbeEvents`

Минимальные seed'ы. Поля — посмотреть [schema.prisma:7229, 4383, 3043, 5564].

---

## 7. Расширения существующих модулей

### 7.1. `meetings.ts` — 7 → 20 встреч за 12 недель + Meeting.roiScore

Каждой встрече добавить:
```ts
const roiScore = (decisions * 10 + commitments * 5 + tasks * 3) /
                 (participantCount * (durationMs / 60_000) / 60);
// Округлить до 3 знаков, подать строкой: roiScore.toFixed(3)
```

Распределение:
- 3-4 встречи с roiScore < 0.5 (low — попадут в LowRoiMeetings виджет)
- 10-12 средних (0.5..1.5)
- 4-6 высоких (>1.5)

Daty распределить через `daysAgo()`:
- Последняя встреча: `daysAgo(0)` (сегодня)
- Самая старая: `daysAgo(82)` (~12 недель)
- Равномерно между ними (использовать массив offset'ов)

### 7.2. `knowledge-graph.ts` — IdeaBlock 20 → 40

Дополнительные блоки:
- 15-20 с `signalType='commitment'` и **заполненным `commitmentRecipientPersonId`** (для Promise Network + `/me/promises`)
- 5-10 с `signalType='knowledge_gap'` (для KnowledgeVelocity)
- Распределить createdAt равномерно по 90 дням

### 7.3. `goals-clones.ts` — Decision.reversibility

```ts
const REVERSIBILITY_MAP = {
  'dec1_oauth2': 'type-2',       // can roll back
  'dec2_design_callscreen': 'type-2',
  'dec3_pilot_rostelecom_500': 'type-1',  // ⚠ irreversible, contract signed
  'dec4_postpone_zoom_integration': 'type-2',
  'dec5_code_review_sla': 'type-2',
  'dec6_arr_target_10m': 'type-1',   // ⚠ irreversible, board approved, no alternatives → alertCount++
  'dec7_partnership_1c': 'type-2',
  'dec8_freeze_features_q3': 'type-2',
};
```

Для dec6 — `alternatives: []` (пустой массив) → попадает в alertCount.

### 7.4. `tracker.ts` — Cycle.progressSnapshot

Для 2 завершённых Cycle добавить:
```ts
progressSnapshot: {
  total: 18,
  completed: 14,
  inProgress: 2,
  cancelled: 2,
  blocked: 0,
  storyPointsCompleted: 42,
  storyPointsTotal: 51,
  topAchievements: ['OAuth2 миграция завершена', 'Дизайн CallScreen утверждён'],
  topMisses: ['Mobile pricing не доделан'],
  aiSummary: 'Спринт закрыт успешно — 14 из 18 задач, основные цели достигнуты...',
} as any,
completedAt: daysAgo(7),  // или 14
```

### 7.5. `operations.ts` — ПЕРЕПИСАТЬ на daysAgo()

Текущая структура с хардкодными `'2026-05-15'` устареет через несколько месяцев. Переписать:

```ts
// Workdays: последние 30 рабочих дней (исключая выходные)
function generateWorkdays(count: number): Date[] {
  const dates: Date[] = [];
  let offset = 0;
  while (dates.length < count) {
    const d = daysAgo(offset++);
    const day = d.getDay();
    if (day !== 0 && day !== 6) dates.push(d);
  }
  return dates.reverse();  // от старых к новым
}

const WORKDAYS = generateWorkdays(30);

// Per person: 30 дней × morning + evening = 60 check-in на person × 5 = 300
```

Содержимое check-in'ов можно оставить близкое к существующему (готовые тексты), но привязка `date` — через `WORKDAYS[i]`.

WeeklyOperationsDigest: 3 → 12 (по неделе каждый):
```ts
for (let w = 0; w < 12; w++) {
  await prisma.weeklyOperationsDigest.create({
    data: {
      tenantId,
      weekStart: ymd(getMondayOfWeek(daysAgo(w * 7))),
      // metricsJson, bodyMarkdown, sourcesJson — фикстуры на каждую неделю с трендом
    },
  });
}
```

DailyOperationsDigest: 5 → 15 (последние 15 рабочих дней).

### 7.6. `chat-notifications.ts` — Notification 10 → 25

Добавить разнообразных типов (mention, system, helpful, sprint_alert, etc.) за последние 5 дней.

### 7.7. `mark-demo.ts` — СИНХРОНИЗАЦИЯ списка

Текущий список (31 таблица) не покрывает 25+ моделей, которые реально создаются в seed. Расширить `DEMO_TENANT_TABLES`:

```ts
const DEMO_TENANT_TABLES = [
  // existing 31
  'cloneAccessGrant', 'ideaBlock', 'entity', 'theme', 'goal', 'goalAlignmentSnapshot',
  'department', 'role', 'person', 'appointment', 'companyProfile', 'functionalDomain',
  'process', 'processStep', 'decision', 'insight', 'notification', 'dailyCheckIn',
  'weeklyOperationsDigest', 'dailyOperationsDigest', 'chatV2Conversation',
  'skillProfile', 'executablePersona', 'project', 'projectDocument', 'issueState',
  'cycle', 'sprintHint', 'helpfulnessSpotlight', 'recognition', 'card',

  // ── ADD: missing existing seed ──
  'meeting', 'aiResult', 'transcript', 'meetingChapter', 'meetingQualityScore',
  'meetingBehaviorMetrics', 'meetingParticipantBehavior', 'participant',
  'board', 'label', 'issue', 'issueAssignee', 'issueLabel', 'issueChecklist',
  'issueChecklistItem', 'issueComment', 'issueRelation', 'issueActivity',
  'ideaBlockLink', 'entityLink', 'themeIdeaBlock', 'themeEntity',
  'goalTheme', 'skillTrait', 'chatV2Message',

  // ── ADD: new from this TZ ──
  'processTemplate', 'regulation', 'idea', 'ideaCluster', 'document',
  'event', 'eventReminder', 'eventParticipant',
  'experiment', 'brandVoiceProfile', 'vendor', 'probeEvent',
  'feedbackMessage', 'feedbackTopic', 'feedbackItem',
  'clientReferralLink', 'referral', 'referralPayout',
  'helpfulnessTrait', 'socialContributionProfile', 'contributionSnapshot',

  // ── Pulse snapshot tables (без externalSource поля — фильтр только по tenantId, см. §7.8) ──
  // НЕ кладём в этот список, ибо у этих таблиц нет externalSource. Удаляются в resetDemoWorkspace вручную.
] as const;
```

### 7.8. `OnboardingService.resetDemoWorkspace` — добавить cleanup новых таблиц

Pulse-snapshot таблицы НЕ имеют `externalSource` поля. Удалять только по `tenantId`. В `resetDemoWorkspace` добавить блок:

```ts
// Pulse snapshots (no externalSource — clean by tenantId only, in any tenant only demo data exists)
remember('knowledgeRiskSnapshot', await tx.knowledgeRiskSnapshot.deleteMany({where: {tenantId}}));
remember('recurringTopic', await tx.recurringTopic.deleteMany({where: {tenantId}}));
remember('promiseNetworkSnapshot', await tx.promiseNetworkSnapshot.deleteMany({where: {tenantId}}));
remember('personGoalContribution', await tx.personGoalContribution.deleteMany({where: {tenantId}}));
remember('knowledgeVelocitySnapshot', await tx.knowledgeVelocitySnapshot.deleteMany({where: {tenantId}}));
remember('personEngagementSnapshot', await tx.personEngagementSnapshot.deleteMany({where: {tenantId}}));
remember('forecastSnapshot', await tx.forecastSnapshot.deleteMany({where: {tenantId}}));
remember('crossFunctionalFrictionReport', await tx.crossFunctionalFrictionReport.deleteMany({where: {tenantId}}));

// Helpfulness (через FK helperUserId → User → tenantId — но User не tenant-scoped!)
// Решение: фильтровать по userId IN (SELECT id FROM users WHERE id IN ids.users)
// Проще — удалить по списку userId, известных как demo
remember('helpfulnessTrait', await tx.helpfulnessTrait.deleteMany({
  where: {tenantId},  // ✅ tenant-scoped есть
}));
remember('socialContributionProfile', await tx.socialContributionProfile.deleteMany({
  where: {tenantId},
}));
remember('contributionSnapshot', await tx.contributionSnapshot.deleteMany({
  where: {userId: {in: demoUserIdsFromSomewhere}},  // ⚠ нет tenantId на этой модели
}));

// New domain
remember('regulation', await tx.regulation.deleteMany({where: {tenantId, externalSource: DEMO}}));
remember('ideaCluster', await tx.ideaCluster.deleteMany({where: {tenantId, externalSource: DEMO}}));
remember('idea', await tx.idea.deleteMany({where: {tenantId, externalSource: DEMO}}));
remember('document', await tx.document.deleteMany({where: {tenantId, externalSource: DEMO}}));
remember('event', await tx.event.deleteMany({where: {tenantId, externalSource: DEMO}}));
// и т.д.

// Referrals
remember('referralPayout', await tx.referralPayout.deleteMany({where: {tenantId, externalSource: DEMO}}));
remember('referral', await tx.referral.deleteMany({where: {tenantId, externalSource: DEMO}}));
remember('clientReferralLink', await tx.clientReferralLink.deleteMany({where: {tenantId, externalSource: DEMO}}));

// Feedback
remember('feedbackItem', await tx.feedbackItem.deleteMany({where: {tenantId, externalSource: DEMO}}));
remember('feedbackMessage', await tx.feedbackMessage.deleteMany({where: {tenantId, externalSource: DEMO}}));
remember('feedbackTopic', await tx.feedbackTopic.deleteMany({where: {tenantId, externalSource: DEMO}}));

// Process templates
remember('processTemplateVersion', await tx.processTemplateVersion.deleteMany({where: {tenantId}}));
remember('processTemplate', await tx.processTemplate.deleteMany({where: {tenantId, externalSource: DEMO}}));

// ── Users (последними, после удаления всего что на них ссылается) ──
// User не tenant-scoped — удалять только по списку демо-User'ов
// Сначала отвязать Person.userId (FK SetNull)
await tx.person.updateMany({
  where: {tenantId, userId: {in: demoUserIds}},
  data: {userId: null},
});
remember('user', await tx.user.deleteMany({where: {id: {in: demoUserIds}}}));
```

⚠ Источник `demoUserIds` — нужен механизм запоминания. Варианты:
1. Хранить в `Org.demoUserIds: String[]` (расширить модель)
2. Идентифицировать по `User.email LIKE '%@technostream.io'` (хрупко если домен изменится)
3. Идентифицировать через `Person` (но FK уже отвязан к моменту удаления User)

**Рекомендация:** добавить поле `Org.demoUserIds String[] @default([])` (миграция в Фазе 0), при seed — записать туда ids.users, при reset — прочитать. Это надёжно.

---

## 8. Сверка по сайдбару — что должна показать каждая страница

Используя инвентарь, собранный исследованием 2026-05-31 (122 страницы). Группировка по разделам.

### 8.1. Главная / Pulse (priority 0)

| Страница | Виджеты | Источник | Покрыто? |
|---|---|---|---|
| `/dashboard` | 7 Pulse-виджетов | §6.3 PulseSnapshots | ✅ |
| `/dashboard` | 3 KPI Hero (Pulse W1) | live из IdeaBlock/DailyCheckIn | ⚠ зависит от плотности данных — проверить в Фазе 9 |
| `/dashboard` | Team Health Grid | `PersonEngagementSnapshot` | ✅ §6.3.6 |
| `/dashboard` | AI Narrative | runtime LLM-вызов из live signals | ⚠ возможно пустой если LLM не доступен — рассмотреть запекание (см. §10) |
| `/dashboard/operations/daily` | DailyOperationsDigest | существующая | ✅ §7.5 (15 шт) |
| `/dashboard/operations/weekly` | WeeklyOperationsDigest + ForecastSnapshot | существующая + §6.3.7 | ✅ |

### 8.2. Карточка сотрудника (priority 1)

`/persons/[id]` — 12 секций по Pulse W3:
| Секция | Источник | Покрыто? |
|---|---|---|
| Профиль | Person + Role + Department | ✅ existing |
| Engagement chart | PersonEngagementSnapshot × 12 | ✅ §6.3.6 |
| Contributions | Contribution + ContributionSnapshot | ✅ §6.4 |
| Skills | SkillProfile + SkillTrait | ✅ existing |
| Helpfulness | HelpfulnessTrait × 5 | ✅ §6.4 |
| Goals contribution | PersonGoalContribution | ✅ §6.3.4 |
| Check-ins history | DailyCheckIn × 30 | ✅ §7.5 |
| Spotlights | HelpfulnessSpotlight | ✅ §6.4 |
| HR-рекомендации | НЕТ модели | ❌ оставить пустой EmptyState (см. §3.5) |
| AI Resume | НЕТ поля | ❌ оставить пустой EmptyState |

### 8.3. Критические разделы (priority 1)

| Страница | Что показывает | Покрыто? |
|---|---|---|
| `/regulations` | Regulation × 5 | ✅ §6.5 |
| `/ideas` | Idea × 10 + 3 кластера | ✅ §6.6 |
| `/me/calendar` | Event × 18 + EventReminder | ✅ §6.8 |
| `/sprints/[id]/review` | Cycle.progressSnapshot | ✅ §7.4 |
| `/me/promises` | IdeaBlock где commitmentRecipientPersonId IS NOT NULL | ✅ §7.2 (15-20 шт) |
| `/decisions` | Decision × 8 (с reversibility) | ✅ §7.3 |
| `/insights` | Insight × 7 (existing) + tagged Insight.dynamic | ⚠ проверить поля |

### 8.4. Опциональные (priority 2)

| Страница | Покрыто? |
|---|---|
| `/documents` | ✅ §6.7 (5 шт) |
| `/referrals` | ✅ §6.9 |
| `/feedback` | ✅ §6.10 |
| `/experiments` | ✅ §6.11 |
| `/brand-voice` | ✅ §6.11 |
| `/vendors` | ✅ §6.11 |
| `/me/inbox` | ✅ §7.6 (Notification 25 шт) |
| `/feed/spotlights` | ✅ §6.4 (HelpfulnessSpotlight 5 шт) |
| `/feed/probe-questions` | ✅ §6.11 (ProbeEvent 10 шт) |
| `/maturity` | ❌ нет модели — EmptyState (см. §3.5) |
| `/persons/[id]/pulse` | ✅ через PersonEngagementSnapshot |
| `/chat` | ✅ existing (ChatV2Conversation 3 шт) |
| `/intake` | ⚠ требует Card (intake) — пересмотреть в Фазе 9 |
| `/curation` | ⚠ требует CurationItem — добавить в фазу? |
| `/orchestrator` | ⚠ внутреннее, может быть admin-only — проверить |

### 8.5. Сознательно НЕ покрываем

- `/settings/{integrations, api, webhooks, sources, exports}` (решение 4 владельца)
- `/admin/*` (Z-Admin, не пользовательский)
- `/me/privacy/*` (личные настройки)

---

## 9. Фазы реализации

### Фаза 0 — Подготовка, проверки безопасности и расширение types

- [ ] **0.1** Проверить `AuthService.login` — отказывает ли при `passwordHash === null`? Если нет — добавить guard ДО продолжения.
- [ ] **0.2** Расширить `IdMap` и `createEmptyIdMap()` в [`types.ts`](backend/src/modules/onboarding/demo-data/types.ts) (см. §4).
- [ ] **0.3** Добавить миграцию: `Org.demoUserIds String[] @default([])` — для надёжного cleanup. `bun run prisma:push` + `bun run prisma:generate`.
- [ ] **0.4** Прогнать: `bun run typecheck` зелёный.

### Фаза 1 — `seedUsers` + интеграция в `seedOrgStructure`

- [ ] **1.1** Создать `demo-data/users.ts` — 5 User'ов с null-пароль.
- [ ] **1.2** Сохранить `ids.users.<key>` + записать в `Org.demoUserIds`.
- [ ] **1.3** Дополнить `seedOrgStructure` — после `Person.create`, для 5 ключевых установить `userId`.
- [ ] **1.4** Unit-тест: проверить что `prisma.user.count({where: {email: {endsWith: '@technostream.io'}}})` === 5 после seed.

### Фаза 2 — `seedProcessTemplates` (блокер для Bottleneck)

- [ ] **2.1** Создать `demo-data/process-templates.ts` — 3 шаблона.
- [ ] **2.2** Сохранить `ids.processTemplates`.

### Фаза 3 — `mark-demo.ts` + `resetDemoWorkspace` синхронизация (КРИТИЧЕСКИЙ БАГ)

- [ ] **3.1** Расширить `DEMO_TENANT_TABLES` в `mark-demo.ts` (см. §7.7).
- [ ] **3.2** Дополнить `resetDemoWorkspace` для всех новых моделей + Pulse-snapshot'ов + User'ов через `Org.demoUserIds` (см. §7.8).
- [ ] **3.3** Unit-тест: создать Org → seed → reset → `prisma.<любая>.count({where: {tenantId}}) === 0`.

### Фаза 4 — `seedPulseSnapshots` (приоритет 0 — главная морда)

- [ ] **4.1** Создать `demo-data/pulse-snapshots.ts`.
- [ ] **4.2** §6.3.1 KnowledgeRiskSnapshot × 5.
- [ ] **4.3** §6.3.2 RecurringTopic × 4.
- [ ] **4.4** §6.3.3 PromiseNetworkSnapshot × 1.
- [ ] **4.5** §6.3.4 PersonGoalContribution × 80.
- [ ] **4.6** §6.3.5 KnowledgeVelocitySnapshot × 1.
- [ ] **4.7** §6.3.6 PersonEngagementSnapshot × 60.
- [ ] **4.8** §6.3.7 ForecastSnapshot × 4.
- [ ] **4.9** §6.3.8 CrossFunctionalFrictionReport × 3 (требует ids.processTemplates из Фазы 2).
- [ ] **4.10** Open `/dashboard` после seed — все 7 виджетов + Team Health Grid не пустые.

### Фаза 5 — `seedHelpfulness`

- [ ] **5.1** Создать `demo-data/helpfulness.ts`.
- [ ] **5.2** HelpfulnessTrait × 25.
- [ ] **5.3** HelpfulnessSpotlight × 5 (status='published').
- [ ] **5.4** SocialContributionProfile × 5.
- [ ] **5.5** ContributionSnapshot × 5.
- [ ] **5.6** Open `/feed/spotlights`, `/persons/[id]` — спотлайты и helpfulness видны.

### Фаза 6 — Расширения existing модулей

- [ ] **6.1** `meetings.ts`: 7 → 20 встреч, `roiScore` всем.
- [ ] **6.2** `knowledge-graph.ts`: 20 → 40 IdeaBlock, `commitmentRecipientPersonId` для 15-20.
- [ ] **6.3** `goals-clones.ts`: `Decision.reversibility` для 8 решений.
- [ ] **6.4** `tracker.ts`: `Cycle.progressSnapshot` для 2 завершённых.
- [ ] **6.5** `operations.ts`: ПЕРЕПИСАТЬ на `daysAgo()`, DailyCheckIn 100 → 300, WeeklyDigest 3 → 12, DailyDigest 5 → 15.
- [ ] **6.6** `chat-notifications.ts`: Notification 10 → 25.

### Фаза 7 — Новые контентные модули

- [ ] **7.1** `seedRegulations` — 5 регламентов.
- [ ] **7.2** `seedIdeas` — 10 идей + 3 кластера.
- [ ] **7.3** `seedDocuments` — 5 документов.
- [ ] **7.4** `seedCalendar` — 18 событий + 5 напоминаний.
- [ ] **7.5** `seedReferrals` — 1 link + 5 Referral + 2 Payout.
- [ ] **7.6** `seedFeedback` — 8 messages + 3 topics + items.
- [ ] **7.7** `seedExperiments`, `seedBrandVoice`, `seedVendors`, `seedProbeEvents` — каждый 3-10 шт.

### Фаза 8 — Интеграция в `OnboardingService.seedDemoWorkspace`

- [ ] **8.1** Добавить вызовы новых seed-модулей в правильном порядке (см. §5).
- [ ] **8.2** Сохранить `ids.users` в `Org.demoUserIds` ПОСЛЕ Фазы 1.
- [ ] **8.3** Markup'нуть `externalSource` через `markAllDemoEntitiesForTenant` (после расширения списка в Фазе 3).

### Фаза 9 — Acceptance: 122 страницы

Открыть каждую страницу `(authenticated)/` из карты исследования 2026-05-31:
- [ ] **9.1** Все главные страницы (`/dashboard`, `/dashboard/operations/*`, `/dump`, `/meetings`, `/projects`, `/sprints`, `/cards`, `/chat`, `/intake`) — нет EmptyState.
- [ ] **9.2** Все «Моё пространство» (`/me/*`) — на каждой либо данные ТехноСтрим (для observer-режима с пометкой «вы новый»), либо EmptyState с инструкцией.
- [ ] **9.3** Все «Память компании» (`/ideas`, `/regulations`, `/decisions`, `/insights`, `/themes`, `/entities`) — данные есть.
- [ ] **9.4** Все «Управление» (`/dashboard/operations`, `/goals`) — данные есть.
- [ ] **9.5** Справочник (`/structure`, `/company`, `/departments`, `/persons`, `/roles`, `/vendors`, `/events`, `/experiments`, `/brand-voice`, `/documents`) — данные есть.
- [ ] **9.6** Особо отметить страницы которые остаются пустыми (`/maturity`, `/me/dashboard` AI Resume и т.д.) — открыть отдельный backlog-item.

### Фаза 10 — Verification

- [ ] **10.1** `bun run typecheck` (backend) — зелёный.
- [ ] **10.2** `bun run lint` (backend) — зелёный.
- [ ] **10.3** `bun run test:unit` — все тесты проходят.
- [ ] **10.4** Smoke на dev: `seedDemoWorkspace` ≤ 12 секунд (можно засечь через `console.time`).
- [ ] **10.5** Reset + reseed — идемпотентность.

### Фаза 11 — Сверка с второй мозг + Prod-deploy-log

- [ ] **11.1** Обновить `second-brain/01_projects/onboarding-wizard.md`.
- [ ] **11.2** Обновить `second-brain/01_projects/workers-queues.md` — упомянуть что Pulse snapshot'ы в демо запекаются статично.
- [ ] **11.3** Обновить `docs/operations/prod-deploy-log.md` Шаг 4 (если есть миграция `Org.demoUserIds`) и Шаг 7 (новые seed-файлы).
- [ ] **11.4** Рефлексия в `second-brain/05_история/`.

---

## 10. Открытые вопросы

| Вопрос | Дефолт |
|---|---|
| **AI Narrative** на главной — runtime LLM ($0.02 + 2 сек) или запекание `Org.demoNarrativeMd`? | **Runtime** — простой кешируется на 1 час; запекание тащит миграцию на `Org`. |
| **Backfill ImpProcessTemplate** — какие именно поля минимально нужны для CrossFunctionalFrictionReport? | Минимум: `id`, `name`, `scope`, `category`, `isCrossFunctional`. Версия (`ProcessTemplateVersion`) не нужна для FrictionReport. |
| **`Org.demoUserIds`** — добавление поля или магия через email-домен? | **Поле** — надёжно и явно. Миграция в Фазе 0.3. |
| **`/me/promises`** — страница вообще существует? | Проверить в Фазе 9.2. Если нет — отложить commitmentRecipientPersonId-заполнение, не блокирующий пункт. |
| **`/maturity`** — куда подвязать модель если она нужна? | Если в Фазе 9.6 виджет страшный — открыть отдельную задачу «реализовать MaturitySnapshot модель», вне этого ТЗ. |
| **Pulse W3 секции карточки сотрудника** — все ли 12 закрыты? | Проверить в Фазе 9 — секции HR-рекомендаций и AI Resume останутся пустыми (нет моделей). Это известный gap. |

---

## 11. Edge-cases

| Кейс | Решение |
|---|---|
| Pulse-patterns добавил новую snapshot-модель уже после деплоя этого ТЗ | Виджет покажет EmptyState. Добавить в `pulse-snapshots.ts` в следующей итерации. |
| `User.email` коллизия — реальный пользователь зарегистрировался с `@technostream.io` | Маловероятно, но миграция: префикс `demo-user-<orgId>-<key>@technostream.io` если коллизия. Прокинуть `tenantId` в email. |
| Параллельный seed для 2 Org одновременно | `User.email` UNIQUE — упадёт. Решение: префикс с `tenantId.slice(-8)` для уникальности per-Org. |
| `seedDemoWorkspace` упал на середине | Текущая реализация — без транзакции, частично залитые данные с `externalSource=null` пометкой не получают. При retry — конфликт по PersonGoalContribution UNIQUE и т.д. **Решение в этом ТЗ:** обернуть весь `seedDemoWorkspace` в `prisma.$transaction({timeout: 60_000})` или хотя бы каждый seed-модуль с try/catch. Решение TBD — открытый вопрос. |
| `Decimal(8,3)` поля через `prisma.create` | Prisma принимает число или строку. Для надёжности — **строкой** (`'5.250'`). |
| `signalsJson` / `topExpertsJson` — TypeScript type | Используем `as any` каст при `create` (Prisma типы для JSON-полей не структурируют). |
| `Math.random()` в seed | ❌ запрещено — недетерминированно. Использовать стабильные функции от ключа (например, hash на key + offset). |
| ContributionSnapshot UNIQUE([userId]) | При seed только 5 demo-User'ов, не пересекаются с реальными. Если реальный User тоже залогинен — нет дублирования. |
| CrossFunctionalFrictionReport требует ProcessTemplate | Фаза 2 перед Фазой 4 — обязательно. |

---

## 12. DoD

- [ ] **Главная морда:** все 7 виджетов Pulse Wave 6 + 3 KPI Hero + Team Health Grid показывают данные (Фаза 4.10 ✅).
- [ ] **Карточка сотрудника** `/persons/[id]` — 10 из 12 секций не пусты (HR Recs + AI Resume — известный gap, см. §3.5).
- [ ] **Operations dashboards** показывают 12 weekly + 15 daily digest'ов + 4 forecast'а (Фаза 6.5 + 4.8).
- [ ] **Критические разделы** (`/regulations`, `/ideas`, `/me/calendar`, `/sprints/[id]/review`, `/me/promises`, `/decisions`) — не пусты.
- [ ] **Опциональные** (`/documents`, `/referrals`, `/feedback`, `/experiments`, `/brand-voice`, `/vendors`) — не пусты.
- [ ] **mark-demo.ts синхронизирован** — все ~80 таблиц.
- [ ] **resetDemoWorkspace** полный — после оплаты `prisma.<любая>.count({where: {tenantId}}) === 0`.
- [ ] **Время seed** ≤ 12 секунд.
- [ ] **122 страницы** прошли acceptance Фазы 9: ≥110 ✅, остальные документированы.
- [ ] `bun run typecheck` зелёный.
- [ ] `bun run lint` зелёный.
- [ ] Unit-тесты пройдены.
- [ ] Второй мозг + prod-deploy-log обновлены.
- [ ] Рефлексия записана.

---

## 13. Что НЕ делаем

- ❌ **Не дёргаем cron-агенты** (решение 1 владельца) — snapshot'ы статичны.
- ❌ **Не создаём User'ы для всех 12 сотрудников** — только для 5 ключевых (которые нужны для Helpfulness/Contribution).
- ❌ **Не сидим `/settings/{integrations, api, webhooks, sources, exports}`** (решение 4).
- ❌ **Не делаем S3-файлы** для документов/вложений — inline content или placeholder URL.
- ❌ **Не делаем backfill для старых DEMO-Org** (унаследовано из родительского ТЗ).
- ❌ **Не создаём модели `Promise`/`SprintReview`/`HrRecommendation`/`Maturity`** — их нет в схеме; использовать существующие альтернативы (см. §3.5).
- ❌ **Не блокируем выкат ожиданием параллельных ТЗ 2026-05-31** — `smart-tables`/`document-ingest-universal`/etc. катятся независимо.
- ❌ **Не пишем LLM-генератор демо** — текущий hardcoded TypeScript проще поддерживать.

---

## 14. Контрольные грепы и smoke перед PR

```bash
# 1. Все Pulse-модели наполняются seed'ом
bun -e "
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  (async () => {
    const tenantId = 'YOUR_TEST_ORG_ID';
    console.log('KnowledgeRisk:', await p.knowledgeRiskSnapshot.count({where:{tenantId}}));
    console.log('RecurringTopic:', await p.recurringTopic.count({where:{tenantId}}));
    console.log('PromiseNetwork:', await p.promiseNetworkSnapshot.count({where:{tenantId}}));
    console.log('PersonGoalContrib:', await p.personGoalContribution.count({where:{tenantId}}));
    console.log('KnowledgeVelocity:', await p.knowledgeVelocitySnapshot.count({where:{tenantId}}));
    console.log('PersonEngagement:', await p.personEngagementSnapshot.count({where:{tenantId}}));
    console.log('Forecast:', await p.forecastSnapshot.count({where:{tenantId}}));
    console.log('FrictionReport:', await p.crossFunctionalFrictionReport.count({where:{tenantId}}));
  })();
"

# 2. Reset чистит ВСЁ
bun -e "
  // ... после reset проверить что все count === 0
"

# 3. mark-demo синхронизирован
bun -e "
  const tables = require('./backend/src/modules/onboarding/demo-data/mark-demo').DEMO_TENANT_TABLES;
  console.log('Tables in mark-demo:', tables.length);
  // должно быть ≥80
"
```

---

## 15. Связь с родительским ТЗ

| Что | ТЗ |
|---|---|
| **Flow:** авто-сидинг + авто-cleanup | [`2026-05-31-demo-auto-seed-and-cleanup.md`](./2026-05-31-demo-auto-seed-and-cleanup.md) |
| **Контент:** что и сколько сидим | **этот ТЗ** |

Рекомендация: **сначала этот** (контент, ~5-7 дней), затем flow (родительский, ~2 дня). Старый seed-выбор `/onboarding/demo-choice` пока остаётся и переключится после flow-ТЗ.

---

## 16. Итог

_Заполняется по факту реализации._
