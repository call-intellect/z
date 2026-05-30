---
type: tz
status: draft
created: 2026-05-30
author: Claude (после серии итераций видения с владельцем)
analysis:
  - plans/analysis/2026-05-29-видение-для-владельца.md (главный документ — на простом языке)
  - plans/analysis/2026-05-29-dashboards-deep-analysis.md (research base, метрики)
  - plans/analysis/2026-05-29-dashboards-proof.md (адверсариальный обзор, что НЕ делаем)
  - plans/analysis/2026-05-29-dashboards-v3-expanded.md (расширенная архитектура — 9 экранов, 20 паттернов)
related:
  - backend/src/modules/dashboard/services/director-dashboard.service.ts
  - backend/src/modules/operations/services/operations-dashboard.service.ts
  - backend/src/modules/entitlements/entitlement.guard.ts
  - backend/src/modules/knowledge-core/workers/sprint-helper.cron.ts
  - backend/src/modules/specialist-3-8-helpfulness/
  - backend/src/modules/recognition/
  - frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx
  - frontend/src/ui/components/shared/StatCard.tsx
---

# ТЗ: Пульс компании — полная реализация всех 6 волн

## 0. Карта документа

Это **полный** ТЗ на новую архитектуру дашбордов Z. Шесть волн, ~15 недель работы. Owner потребовал «всё в одном документе, не дробить».

**Структура**:
- §1 — общие цели и принципы (применяются ко всем волнам).
- §2 — обзор всех 9 экранов с их ролями.
- §3 — каталог AI-агентов-аналитиков (используем существующие + добавляем 11 новых).
- §4 — изменения схемы данных (одним списком).
- §5–§10 — Волны 1-6 (каждая со своими фазами, DoD, чекпоинтом перед следующей).
- §11 — общие риски и митигации.
- §12 — итог реализации (заполняется по мере).

**Stop-conditions между волнами** обязательны. Если метрики Волны N не достигнуты — Волну N+1 не начинаем, идём чинить Волну N или меняем подход.

---

## 1. Общие цели и принципы

### 1.1. Главная цель

Превратить Z из набора несвязанных дашбордов в **единую память компании**, где владелец / директор видит **всё что происходит** через осмысленные экраны и инсайты от AI-агентов, которые молча наполняют дашборды.

После полной реализации:
- 9 экранов (Главная / Операции / Ежедневный / Недельный / Команды список / Команды детально / Карточка сотрудника / Спринт дневной / Спринт недельный / Архив гипотез).
- Восемь новых показателей-патернов (Bus Factor, Topic Recurrence, Meeting ROI, Cross-functional Heatmap, Goal Vector, Promise Network, Knowledge Velocity, Decision Hygiene).
- Telegram weekly digest + расширенный Concierge chat + In-app sidebar.
- 11 новых AI-агентов-аналитиков сверх существующих ~90.
- 152-ФЗ opt-in flow + audit log + region flag.

### 1.2. Принципы (применяются везде)

1. **Каждый показатель — с baseline-сравнением** (с собой раньше, не с другими).
2. **Каждое утверждение AI — со ссылкой на источник** (Transparent Sourcing). Любой narrative рендерится с кликабельными цитатами на Meeting / IdeaBlock / Goal / Decision.
3. **Sparkline-данные — реальные**, не захардкоженные.
4. **На пустом tenant'е** — sample story с watermark «образец».
5. **Каждый KPI и каждая ячейка карты — кликабельны** (drill-down).
6. **Min cohort size = 3** в Волне 1-3 (для совсем маленьких команд агрегаты пропускаются), **min 5** в Волне 4+ (после 152-ФЗ flow).
7. **Прозрачность переименования**: «Индекс настроения недели» **не называется eNPS** — это другие метрики (см. proof.md §6.1).
8. **AI не двигает задачи / не принимает решения сам** — только показывает, подсказывает.
9. **Developmental framing** во всех текстах: «помочь команде расти», «обсудить нагрузку», «похвалить», **не** «уровень риска ухода», «ранжирование».
10. **Никаких индивидуальных turnover scores** для руководителя (Microsoft Productivity Score 2020 precedent).

### 1.3. Что НЕ делаем вообще (в любой волне)

| ❌ | Причина |
|---|---|
| Spotify-style Health Monitor Grid (ручные квартальные опросы 5-8 атрибутов) | Spotify сами признали провал (Jeremiah Lee 2020) |
| Hill Charts на главных экранах | Basecamp Appendix 4.1 — для 1+1-2 чел; не для SMB 8+ |
| Manual weekly Goal Confidence (1-10 от owner-а) | Sitzmann-Yeo 2013 — within-person ρ=0.06 + 30% → 18% response rate за 6 мес. Заменяем на AI auto-detect |
| Individual flight-risk / turnover score руководителю | Microsoft Productivity Score 2020 backlash; Cornell 2024: 4× жалоб vs human monitoring |
| Emotion-recognition по голосу / видео | EU AI Act Art.5 с 02.02.2025 запрещает, штраф до €35M |
| Ranking сотрудников «лучший — худший» | Токсично, разрушает культуру |
| Чат-бот «спроси AI про сотрудника X» (только для руководителя) | Поощряет surveillance-стиль |

---

## 2. Все 9 экранов — обзор ролей

Подробное описание — в [видение-для-владельца.md](../analysis/2026-05-29-видение-для-владельца.md). Здесь — карта маршрутов:

| # | Маршрут | Имя | Главный вопрос | Волна |
|---|---|---|---|---|
| 1 | `/dashboard` | Пульс компании (Главная) | «Куда движемся стратегически?» | 1 (KPI hero + Team Health Grid + AI narrative) |
| 2 | `/dashboard/operations` | Панель операций (real-time) | «Что горит сейчас?» | 2 (добавить heatmap по людям + кто не отчитался + трекер) |
| 3 | `/dashboard/operations/daily` | Ежедневный отчёт | «Что произошло вчера?» | 2 (расширить narrative + срочные вопросы + кто выделился/просел) |
| 4 | `/dashboard/operations/weekly` | Недельная сводка | «Что обсудить на ретро?» | 2 (дельты, тренды, прогнозы) |
| 5 | `/teams` + `/teams/[id]` | Дашборд команд | «Какая команда просела?» | 2 (список + детальная страница) |
| 6 | `/persons/[id]/pulse` | Карточка сотрудника (центральная) | «Что с конкретным человеком?» | 3 (12 секций в три подфазы) |
| 7 | `/projects/[slug]/sprint-daily` | Дневник спринта | «Идём ли к цели спринта?» | 5 |
| 8 | `/projects/[slug]/sprint-weekly` | Итоги недели спринта | «Гипотеза подтвердилась?» | 5 |
| 9 | `/sprints/archive` | Архив гипотез | «Что мы вообще проверяли как компания?» | 5 |

Плюс каналы (не экраны):
- Telegram weekly digest (Волна 5).
- Расширенный Concierge chat «спроси Кору про команду / сотрудника / спринт» (Волна 5).
- In-app sidebar «Помощник компании» (Волна 5).
- `/me/pulse` — личная care-страница сотрудника (Волна 3, passive-only режим).
- `/me/privacy` — audit log доступа к своей карточке (Волна 4).

---

## 3. Каталог AI-агентов-аналитиков

### 3.1. Существующие — что используем без изменений (~90 агентов)

Полный список в [v3-expanded.md §5.1](../analysis/2026-05-29-dashboards-v3-expanded.md). Ключевые, которые кормят наши новые виджеты:

| Агент | Куда даёт данные |
|---|---|
| `checkin-sentiment-analyzer.worker` | Sentiment Index, Person Pulse, Team Health |
| `operations-daily-digest.cron` | Ежедневный отчёт |
| `operations-weekly-digest.cron` | Недельная сводка |
| `commitment-followup.cron` | Commitment Reliability, Promise Network |
| `personal-relation-builder.worker` | Conflicts на Team Health, граф в карточке |
| `strategic-alignment.cron` | Goal Vector |
| `sprint-helper.cron` + `sprint-helper.worker` | Sprint Daily, Sprint Weekly, подсказки |
| `cross-functional-friction-aggregator.cron` | Bottleneck Heatmap |
| `specialist-3-8-helpfulness.worker` | Helper-Score в карточке сотрудника |
| `recognition-formulate.worker` + recognition module | Похвала, badges, streaks в карточке |
| `process-detector.worker` | Анализ процессов 80/20 (опц., Волна 6) |
| `specialist-3-2-knowledge-clone.worker` | Bus Factor analyzer |
| `specialist-3-5-insights.worker` | Insights radar |
| `specialist-3-3-decisions.worker` | Decision Hygiene, Hanging Decisions |
| `behavior-metrics.worker` | Meeting ROI, активность во встречах |
| `quality-score.worker` | Meeting ROI |
| `tasks-extract.worker` | Meeting ROI (количество извлечённых задач) |

### 3.2. Новые — добавляем 11 агентов по волнам

| # | Агент | Что вычисляет | Куда пишет | Волна |
|---|---|---|---|---|
| N1 | `Reflection-Quality-Scorer` | Глубина чек-ина (слов, конкретность action items, разнообразие тем) | `DailyCheckIn.qualityScore` | 3 |
| N2 | `Engagement-Scorer` | Сводный engagement score per person из всех сигналов | `Person.engagementScore` + history | 3 |
| N3 | `HR-Recommender` | Похвалить / поднять ЗП / обсудить / развитие / срочно поговорить | `Person.hrSuggestions` JSON | 3 |
| N4 | `Team-Health-Analyzer` | Аналитика команды + детект 5 Gallup factors | `Department.healthSummary` JSON | 2-3 |
| N5 | `Burnout-Risk-Detector` | Топ-10 сигналов выгорания с порогами (личные baseline) | `Person.riskFlags` JSON | 4 |
| N6 | `Forecaster` | Прогноз «что произойдёт в следующую неделю» | `ForecastSnapshot` | 4 |
| N7 | `Bus-Factor-Analyzer` | Для каждой knowledge-area: сколько экспертов | `KnowledgeRiskSnapshot` | 6 |
| N8 | `Topic-Recurrence-Detector` | Темы поднимавшиеся ≥5 раз без Decision | `RecurringTopic` table | 6 |
| N9 | `Meeting-ROI-Scorer` | Score встречи: (decisions×10 + commitments×5 + tasks×3) / (participants × duration) | `Meeting.roiScore` | 6 |
| N10 | `Promise-Network-Analyzer` | Граф обещаний, паттерны «накопитель / донор / изолированный» | `PromiseNetworkSnapshot` | 6 |
| N11 | `Goal-Vector-Tracker` | Pro/contra/net score per (person, goal) — % действий «в цель» | `PersonGoalContribution` | 6 |

(Опционально, если успеем): `Decision-Hygiene-Scorer`, `Knowledge-Velocity-Tracker`, `Chat-Helper` (когда подключим чаты) — в Волне 6 или позже.

### 3.3. Общие требования к новым агентам

- Через единый `LlmRouterService` с регистрацией в admin (как существующие).
- Каждый агент пишет с `provenance` (какие источники использовал) — для Transparent Sourcing.
- Идемпотентность.
- `tenantId`-scoped.
- Cron через BullMQ, не on-demand.
- Метрики в Prometheus: `ai_agent_runs_total{agent}`, `ai_agent_duration_seconds{agent}`, `ai_agent_failures_total{agent, reason}`.

---

## 4. Изменения схемы данных (одним списком)

Все изменения через `bun run prisma:push`, не `migrate`. После каждой правки — `bun run prisma:generate`.

**Опасные изменения** (новые модели / удаления / опасные миграции) → шаг в `prod-deploy-log.md` Шаг 4.

### 4.1. Расширения существующих моделей

| Модель | Поле | Тип | Волна | Зачем |
|---|---|---|---|---|
| `Decision` | `raisedCount` | `Int @default(1)` | 1 | Hanging Decisions: счётчик «поднималось ≥N раз» |
| `Decision` | `lastRaisedAt` | `DateTime?` | 1 | Когда последний раз упоминалось |
| `Decision` | `reversibility` | `String?` | 6 | type-1 / type-2 (Bezos) для Decision Hygiene |
| `DailyCheckIn` | `qualityScore` | `Decimal? @db.Decimal(4,3)` | 3 | Глубина рефлексии от Reflection-Quality-Scorer |
| `Person` | `engagementScore` | `Decimal? @db.Decimal(4,3)` | 3 | Сводный engagement от Engagement-Scorer |
| `Person` | `engagementScoreAt` | `DateTime?` | 3 | Когда последний раз пересчитали |
| `Person` | `hrSuggestionsJson` | `Json?` | 3 | Рекомендации от HR-Recommender |
| `Person` | `riskFlagsJson` | `Json?` | 4 | Активные risk-сигналы от Burnout-Risk-Detector |
| `Person` | `analyticsOptIn` | `Boolean @default(false)` | 4 | 152-ФЗ согласие на расширенную аналитику |
| `Person` | `analyticsOptInAt` | `DateTime?` | 4 | Когда дано согласие |
| `Org` | `region` | `String? @default("ru")` | 4 | `ru` / `eu` / `other` — региональный режим |
| `Meeting` | `roiScore` | `Decimal? @db.Decimal(4,3)` | 6 | Meeting ROI |
| `Goal` | `aiDetectedConfidence` | `Int?` | 6 | 1-10 от AI на основе текстов команды цели |
| `Goal` | `aiDetectedConfidenceAt` | `DateTime?` | 6 | Когда пересчитали |

### 4.2. Новые модели

| Модель | Назначение | Волна |
|---|---|---|
| `ConsentLog` | Записи согласий 152-ФЗ (per person × per data type × date) | 4 |
| `KnowledgeAccessLog` | Кто открывал чью карточку (для audit log на /me/privacy) | 4 |
| `KnowledgeRiskSnapshot` | Bus Factor: per knowledge-area количество экспертов | 6 |
| `RecurringTopic` | Топ-N тем поднимавшихся без Decision | 6 |
| `PromiseNetworkSnapshot` | Снапшот графа обещаний (для динамики) | 6 |
| `PersonGoalContribution` | Pro/contra/net score per (person, goal, period) | 6 |
| `ForecastSnapshot` | Прогноз на следующую неделю по тенденциям | 4 |
| `ProcessEffectivenessSnapshot` | 80/20 процессов (опц., Волна 6) | 6 |

### 4.3. Новая роль RBAC

| Роль | Полномочия | Волна |
|---|---|---|
| `hr_partner` | Видит карточку сотрудника при opt-in; видит agg по командам | 4 |

Добавить в `policies/policy.csv` соответствующие правила.

---

## 5. Волна 1 — Фундамент (3 недели)

### 5.1. Цели

После релиза Волны 1 пользователь видит на `/dashboard`:
1. Нет красной плашки EntitlementGuard.
2. Три KPI hero (Настроение / Обещания / Висящие решения) с реальным sparkline 12 недель + drill-down.
3. AI-резюме с кликабельными цитатами на источники.
4. Цветная Team Health Grid (Department × 4 атрибута).
5. На пустом tenant — sample story с watermark.

### 5.2. Фазы

#### Фаза 1.0. Хотфиксы (3 дня)

- [ ] **1.0.1** TenantMiddleware вместо TenantGuard order:
  - Создать `backend/src/modules/rbac/middleware/tenant.middleware.ts` (резолв `X-Org-Id`/`:orgId` → `req.tenantId`).
  - Подключить в `AppModule.configure(consumer)`: `consumer.apply(TenantMiddleware).forRoutes('api/v1/*')`.
  - `TenantGuard` теперь только проверяет `req.tenantId !== undefined`, не резолвит.
  - e2e тест: `/api/v1/dashboard/director` без `X-Org-Id` → `tenant_required` через TenantGuard.
- [ ] **1.0.2** Удалить fake sparkline из DirectorDashboardClient (на 2-3 дня уходит до фазы 1.5).
- [ ] **1.0.3** Sample Story компонент:
  - Frontend `<SampleStoryBanner>` + watermark «образец» на каждой карточке.
  - Backend: флаг `metadata.isEmpty` в DTO + synthetic dataset при `isEmpty=true`.

#### Фаза 1.1. Commitment Reliability сервис (2 дня)

- [ ] Создать `backend/src/modules/dashboard/services/commitment-reliability.service.ts`:
  - Метод `getReliability({tenantId, scope: 'company'|'team'|'person', scopeId?, windowDays=14})`.
  - Returns `{ kept, broken, overdue, pendingActive, reliabilityPercent, delta14d, sparkline12w }`.
- [ ] Redis-кэш 5 мин по ключу `commit_reliability:${tenantId}:${scope}:${scopeId}:${windowDays}`.
- [ ] Тесты unit + integration.

#### Фаза 1.2. Hanging Decisions counter (1 день)

- [ ] Расширить `Decision`: `raisedCount Int @default(1)` + `lastRaisedAt DateTime?` (если ещё нет).
- [ ] `specialist-3-3-decisions.worker` — на каждом detect упоминания decision на новой встрече инкрементить `raisedCount` + обновлять `lastRaisedAt`.
- [ ] `HangingDecisionsService.count({tenantId, minAgeDays=7, minRaisedCount=2})` + sparkline 12w.
- [ ] Redis-кэш 5 мин.

#### Фаза 1.3. Sentiment Index (1 день)

- [ ] Создать `backend/src/modules/dashboard/services/sentiment-index.service.ts`.
- [ ] Формула: `(greenShare - redShare) * 100`. Диапазон -100..+100.
- [ ] Возвращает `{value, trend: 'up'|'flat'|'down', sparkline12w, totalCheckIns}`.
- [ ] **В UI называется «Индекс настроения недели», не «eNPS»**.

#### Фаза 1.4. AI Narrative с Transparent Sourcing (2 дня)

- [ ] Расширить `DASHBOARD_SUMMARY_SYSTEM_PROMPT` в `dashboard-summary.prompt.ts`:
  - Требовать inline-цитаты `[mtg:UUID]`, `[ib:UUID]`, `[goal:UUID]`, `[dec:UUID]`.
  - Передавать список доступных источников в промпт.
- [ ] Создать `NarrativeCitationsParserService`: парсит вывод LLM, заменяет markers на `[1]`, `[2]`..., фильтрует галлюцинированные ID.
- [ ] DTO: `narrativeSummary: { text, citations: Citation[] }`.
- [ ] Frontend `<AiNarrativeWithSources>`: рендер с superscript + список источников с deep-link.

#### Фаза 1.5. Три KPI Hero на Главной (2 дня)

- [ ] Создать `frontend/src/ui/components/shared/KpiHero.tsx`:
  - Props: `label, value, delta?, sparkline (number[]), threshold?, onClick?, tooltip?`.
  - Цвет value по threshold.
- [ ] В `DirectorDashboardClient.tsx`: удалить 5 vanity StatCards, поставить 3 KpiHero:
  - «Индекс настроения недели» (threshold green ≥30, yellow ≥0, red <0) → drill-down /dashboard/operations sentiment filter.
  - «Обещания» (green ≥80%, yellow ≥60%) → drill-down /me/commitments.
  - «Висящие решения» (inverted: green ≤2, yellow ≤5) → drill-down /decisions?status=hanging.
- [ ] Backend: расширить `DirectorDashboardDto` — `kpiSentimentIndex`, `kpiCommitmentReliability`, `kpiHangingDecisions`.
- [ ] Domain mapper в `frontend/src/domain/director-dashboard.ts`.

#### Фаза 1.6. Team Health Grid (3 дня)

- [ ] Создать `backend/src/modules/dashboard/services/team-health.service.ts`:
  - `getHealth({tenantId})` → `{teams: TeamHealthRow[]}`.
  - Для каждого Department (cohort ≥3): sentiment / promises / decisions / conflicts — каждое с цветом + trend.
  - Расчёт цветов и трендов в одном проходе.
  - Redis-кэш 5 мин.
- [ ] Endpoint `GET /api/v1/dashboard/team-health`.
- [ ] Frontend `<TeamHealthGrid>`: таблица teams × 4 attrs + click handlers (заглушка → `/teams/[id]` будет в Волне 2).
- [ ] Empty state «создайте отделы».

#### Фаза 1.7. QA (2 дня)

- [ ] Smoke-тесты всех новых endpoints.
- [ ] Manual QA на tenant с данными + пустом tenant + tenant без отделов.
- [ ] Регрессия существующих виджетов.
- [ ] Backend `bun run typecheck && bun run lint && bun run build` — green.
- [ ] Frontend то же — green.

### 5.3. DoD Волны 1

1. Бага EntitlementGuard нет.
2. Все sparkline — реальные.
3. 3 KPI hero видны, кликабельны, дают drill-down.
4. AI narrative с ≥1 цитатой на каждое утверждение, ссылки работают.
5. Team Health Grid показывает все отделы (cohort ≥3).
6. На пустом tenant — sample story.
7. Все тесты зелёные.
8. `second-brain/01_projects/admin.md` обновлён.
9. `prod-deploy-log.md` — Шаг 4 (новые поля Decision), Шаг 1 (если новые ENV).

### 5.4. 🛑 Чекпоинт 1 — обязательная проверка перед Волной 2

После релиза Волны 1 — пилот на 3-5 founder'ов **минимум 2 недели**. Замеряем:

| Метрика | Минимум для перехода в Волну 2 | Что делать если не достигнуто |
|---|---|---|
| Open rate `/dashboard` у COO/Founder | ≥2 раза/неделю | Пересмотр визуала / копи / времени уведомлений |
| Click rate на KPI hero | ≥20% сессий | Плохо подобраны метрики — заменяем |
| Click на цитаты в AI narrative | ≥30% когда narrative показан | Не доверяют → улучшаем промпт / источники |
| Bug reports на новые компоненты | < 3 на клиента | ≥5 — паузим, чиним |
| Subjective feedback «понятно что происходит» | ≥7/10 | < 5 — переделываем подход |

**Stop**: если хотя бы 2 из 5 метрик красные → пауза, разбор, **не переходим к Волне 2 «по инерции»**.

---

## 6. Волна 2 — Усиление операционных дашбордов (3 недели)

### 6.1. Цели

После Волны 2:
1. Ежедневный отчёт — narrative «история дня» + срочные вопросы + кто выделился/просел.
2. Недельная сводка — дельты к прошлой неделе + командная динамика + прогнозы.
3. Панель операций — heatmap по людям + «кто не отчитался» + трекер-виджет.
4. `/teams` — список команд + `/teams/[id]` — детальная страница.

### 6.2. Фазы

#### Фаза 2.1. Daily-Reporter — расширение narrative (3 дня)

- [ ] Расширить `operations-daily-digest.cron` и `daily-digest.service.ts`:
  - Промпт `daily-digest.prompt.ts` — добавить структуру «история дня» в 3-5 абзацев.
  - Inline-цитаты на встречи / чек-ины (как в Волне 1.4 — переиспользуем парсер).
  - Секция «срочные вопросы» отдельно (просрочки + поднимавшиеся ≥2 раз decisions).
- [ ] DTO `DailyDigestDto` — секции `eventsToday`, `urgentItems`, `whoShined`, `whoStruggled`.
- [ ] Frontend `DailyDigestClient` — рендер новой структуры с deep-links.

#### Фаза 2.2. Weekly-Strategist — расширение (2 дня)

- [ ] `operations-weekly-digest.cron` + `weekly-digest.service.ts`:
  - Промпт `weekly-digest.prompt.ts` — добавить секцию «командная динамика» и «прогнозы».
  - Дельты vs прошлая неделя для всех 4 KPI.
  - Использовать Team Health Grid (из 1.6) для «какая команда улучшилась».
- [ ] Forecaster (заглушка пока — Волна 4 даст полноценный агент).

#### Фаза 2.3. Панель операций — расширение (3 дня)

- [ ] **Heatmap по людям**: в `OperationsDashboardService` уже есть `byPerson` в `team-temperature` DTO — вывести в UI как heatmap 7 дней × N людей.
- [ ] **Виджет «Кто не отчитался»**: cron-prompt уже есть → endpoint `GET /api/v1/dashboard/operations/missing-checkins?date=today` → frontend список с кнопкой «отправить напоминание».
- [ ] **Трекер-виджет**: `Issue` без активности >5 дней + просроченные + топ-5 авторов комментариев (helpfulness). Использовать `issue-overdue-detector.cron` (уже работает).

#### Фаза 2.4. `/teams` — список команд (3 дня)

- [ ] Создать `frontend/app/(authenticated)/teams/page.tsx` + `TeamsListClient.tsx`.
- [ ] Таблица: Department + size + 4 health-чипа (из Team Health Grid из 1.6) + общий тренд.
- [ ] Сортировка по любому столбцу.
- [ ] Click → `/teams/[id]`.
- [ ] Backend: уже есть endpoint `/api/v1/dashboard/team-health` из 1.6 — переиспользуем.

#### Фаза 2.5. `/teams/[id]` — детальная страница (4 дня)

- [ ] `frontend/app/(authenticated)/teams/[id]/page.tsx` + `TeamDetailClient.tsx`.
- [ ] Секции (см. v3-expanded §3.5):
  - Шапка команды (имя, руководитель, число участников, кто новый/ушёл).
  - Состав (аватары + sentiment-чип + commitment-чип, click → `/persons/[id]/pulse` заглушка пока).
  - Health-метрики команды (sentiment trend 30 дней, commitment reliability, capacity heatmap без имён).
  - Цели команды (хост Goal или teammember = owner).
  - Активность (встречи / трекер / чаты — последнее заглушка).
  - Темы команды (top weights).
  - Конфликты внутри команды (EntityLink между members).
- [ ] Backend: новый `TeamDetailService.getDetail({tenantId, departmentId})` + endpoint `GET /api/v1/dashboard/teams/:id`.

#### Фаза 2.6. QA (2 дня)

- [ ] Аналогично 1.7.

### 6.3. DoD Волны 2

1. Ежедневный отчёт с narrative + цитатами + 4 секциями.
2. Недельная сводка с дельтами и командной динамикой.
3. Heatmap по людям виден в Операциях.
4. «Кто не отчитался» виджет работает.
5. Трекер-виджет в Операциях.
6. `/teams` список + `/teams/[id]` детально работают.
7. Все тесты зелёные.

### 6.4. 🛑 Чекпоинт 2

Те же KPI что в 1.4, плюс:
- Click rate на «срочные вопросы» в ежедневном отчёте ≥40%.
- `/teams` open rate ≥1 раз/неделю у руководителей.

Если < 50% от целевого — пересмотр, не двигаемся дальше.

---

## 7. Волна 3 — Карточка сотрудника + команды + первые AI-агенты (4 недели)

### 7.1. Цели

Главный экран Z — карточка сотрудника. Плюс новые AI-агенты-аналитики которые её наполняют.

### 7.2. Фазы

#### Фаза 3.1. Team-Health-Analyzer агент (2 дня)

- [ ] Создать `backend/src/modules/dashboard/agents/team-health-analyzer.worker.ts` (BullMQ cron, daily).
- [ ] Для каждого Department: LLM анализ → 5 Gallup factors (manager support / workload fairness / communication / time pressure / role clarity) low/medium/high.
- [ ] Кладёт в `Department.healthSummaryJson`.

#### Фаза 3.2. Расширение Conflict-Detector (3 дня)

- [ ] `personal-relation-builder.worker` уже есть. Расширить:
  - Добавить анализ текстов чек-инов и встреч на парные конфликт-маркеры.
  - Confidence threshold для записи в `EntityLink.relationType='conflicted_with'`.

#### Фаза 3.3. Engagement-Scorer агент (3 дня)

- [ ] Новый `engagement-scorer.cron` (daily).
- [ ] Для каждого Person: сводит сигналы — sentiment baseline-relative, meeting активность, commitment reliability, helpfulness, response latency.
- [ ] Формула — weighted sum нормированных к личному baseline.
- [ ] Кладёт в `Person.engagementScore` + история snapshot в новой таблице `PersonEngagementSnapshot`.

#### Фаза 3.4. Карточка сотрудника v1 — секции 1-7 (5 дней)

- [ ] `frontend/app/(authenticated)/persons/[id]/pulse/page.tsx` + `PersonPulseClient.tsx`.
- [ ] Секции:
  1. Шапка профиля + последний 1:1.
  2. **AI Resume** (заглушка — Phase 3.8 даст полноценный HR-Recommender).
  3. Mood trend 30/90 дней + baseline-relative.
  4. Energy budget / нагрузка (workload heatmap своего времени).
  5. Утренние/вечерние чек-ины (регулярность; quality — заглушка до 3.5).
  6. Обещания (взято / закрыто / просрочено / тренд).
  7. Цели и вклад в стратегию.
- [ ] Backend: новый `PersonPulseService` + endpoint `GET /api/v1/persons/:id/pulse`.
- [ ] RBAC: пока только owner/admin/COO + сам сотрудник. HR-партнёр + opt-in — Волна 4.

#### Фаза 3.5. Reflection-Quality-Scorer агент (2 дня)

- [ ] Новый агент `reflection-quality-scorer.worker.ts` (запускается на каждый чек-ин или batch).
- [ ] LLM оценивает чек-ин по 3 осям: глубина (слов), конкретность (есть ли action items с метриками), разнообразие тем.
- [ ] Кладёт в `DailyCheckIn.qualityScore` (0..1).
- [ ] В карточке сотрудника секция 5 — обновляется с реальным quality score.

#### Фаза 3.6. Карточка сотрудника v2 — секции 8-11 (4 дня)

- [ ] 8. Активность в трекере: создал/закрыл Issue, время закрытия, комментарии (length, helpful %) — из `specialist-3-8-helpfulness.worker` (уже есть).
- [ ] 9. Активность в чатах: пока заглушка с «когда подключим чаты» — placeholder UI.
- [ ] 10. Граф связей: топ-5 с кем работает, конфликты (EntityLink), изоляция.
- [ ] 11. Темы и знания: топ-темы по которым высказывается, knowledgeProfile.categories.

#### Фаза 3.7. HR-Recommender агент (3 дня)

- [ ] Новый `hr-recommender.cron` (weekly).
- [ ] Для каждого Person: LLM сводит сигналы из карточки + recognition + engagement → рекомендации.
- [ ] 5 типов рекомендаций: ПОХВАЛИТЬ / ЗП-РЕВЬЮ / ОБСУДИТЬ НАГРУЗКУ / РАЗВИТИЕ / СРОЧНО ПОГОВОРИТЬ.
- [ ] Кладёт в `Person.hrSuggestionsJson` с provenance (на основе каких сигналов).
- [ ] Транспарентность: каждая рекомендация имеет «почему» с ссылками.

#### Фаза 3.8. Карточка сотрудника v3 — секция 12 (3 дня)

- [ ] Секция 12: Risk-сигналы (Burnout-Risk-Detector — заглушка до Волны 4) + HR-флаги (от 3.7).
- [ ] Timeline событий (опц. под спойлером).
- [ ] AI Resume в секции 2 обновляется реальным выводом HR-Recommender.

#### Фаза 3.9. QA (2 дня)

### 7.3. DoD Волны 3

1. Карточка сотрудника v3 со всеми 12 секциями.
2. Team Health агрегаты реальные (от Team-Health-Analyzer).
3. Engagement Score per person считается.
4. HR-рекомендации генерируются и отображаются.
5. Reflection quality считается.
6. Все тесты + регрессия.

### 7.4. 🛑 Чекпоинт 3

- Open rate карточки сотрудника у руководителей ≥2 раза/неделю на одного сотрудника.
- ≥30% сессий — клик на HR-рекомендацию (действие).
- Precision HR-рекомендаций ≥60% (по user feedback «релевантно/нет»).
- ≥1 customer case study «помогло заметить выгорание / найти кого похвалить».

Если precision <50% — пауза агентов, тюнинг промптов до перехода к Волне 4.

---

## 8. Волна 4 — Compliance + углубление (3 недели)

### 8.1. Цели

1. 152-ФЗ opt-in flow при найме / первом входе.
2. Audit log: сотрудник видит кто открывал его карточку (`/me/privacy`).
3. Region flag (`ru` / `eu` / `other`) — разные правила.
4. Новые агенты: Meeting-Speaker-Analyzer, Burnout-Risk-Detector, Forecaster.
5. Роль `hr_partner` в RBAC.

### 8.2. Фазы

#### Фаза 4.1. 152-ФЗ opt-in flow (3 дня)

- [ ] Новая модель `ConsentLog`: per (personId, dataType, consentedAt, revokedAt?).
- [ ] Onboarding flow для нового сотрудника: 3 шага галочек:
  - Согласие на обработку чек-инов и sentiment.
  - Согласие на анализ Risk-сигналов.
  - Согласие на показ карточки руководителю (default: да, можно отказать).
- [ ] Каждая галочка → запись в `ConsentLog`.
- [ ] Опция «отозвать согласие» в `/me/privacy/consents`.

#### Фаза 4.2. Audit Log `/me/privacy/access-log` (2 дня)

- [ ] Новая модель `KnowledgeAccessLog`: per (viewerUserId, viewedPersonId, sectionAccessed, accessedAt).
- [ ] Middleware на endpoint `/api/v1/persons/:id/pulse` — пишет access log (кроме когда сам себе).
- [ ] Frontend `/me/privacy/access-log` — таблица «кто и когда открывал твою карточку».

#### Фаза 4.3. Region flag (2 дня)

- [ ] `Org.region: String? @default("ru")`.
- [ ] В UI conditional rendering — для `region='eu'` определённые фичи (например, voice-anything) скрыты.
- [ ] Для `region='ru'` — приоритет 152-ФЗ flow.

#### Фаза 4.4. Meeting-Speaker-Analyzer (3 дня)

- [ ] Новый `meeting-speaker-analyzer.worker.ts` (запускается после `transcribe.worker`).
- [ ] Анализ транскрипта: per speaker — кол-во минут речи, число фраз, какие темы поднимал, sentiment по тексту (не по голосу).
- [ ] Кладёт в `MeetingAttendee.speakingStatsJson`.
- [ ] Используется в карточке сотрудника секция 4 (активность во встречах).

#### Фаза 4.5. Burnout-Risk-Detector (3 дня)

- [ ] Новый `burnout-risk-detector.cron` (daily).
- [ ] Топ-10 сигналов с порогами **относительно личного baseline**:
  - Sentiment dip ≥1σ от 90-day baseline.
  - Reply latency rise ≥2× от baseline за 14 дней.
  - Missed check-ins ≥2 подряд.
  - Promise hygiene (≥3 broken promises за 4 недели).
  - Workload overload (≥7 дней >100% capacity).
  - Meeting no-shows ≥3 за 7 дней.
  - Conflict mentions (new EntityLink за 14 дней).
  - Disappearing from chats (опц., когда подключим чаты).
- [ ] Кладёт в `Person.riskFlagsJson` со списком активных сигналов + explanation.
- [ ] **НЕ** агрегирует в одну цифру. Только список сигналов.
- [ ] Эскалационный guardrail: маркеры суицидальной идеации → blocking UI на /me/pulse + ссылка на горячую линию + опц. notify HR (с opt-in).

#### Фаза 4.6. Forecaster агент (2 дня)

- [ ] Новый `forecaster.cron` (weekly).
- [ ] LLM анализирует трендов за 4 недели → прогноз на следующую неделю по командам и компании.
- [ ] Кладёт в `ForecastSnapshot`.
- [ ] Используется в Weekly digest и на Главной.

#### Фаза 4.7. Роль `hr_partner` в RBAC (2 дня)

- [ ] Добавить роль `hr_partner` в `policies/policy.csv`.
- [ ] Расширить `RbacService` — методы `canViewEmployeeFullCard(userId, employeeId)`, etc.
- [ ] HR-партнёр видит карточку при `Person.analyticsOptIn=true`.

#### Фаза 4.8. QA + Compliance audit (2 дня)

- [ ] Manual проверка: все pulse-метрики требуют opt-in.
- [ ] Юридическое review opt-in текстов (рекомендуется до релиза).

### 8.3. DoD Волны 4

1. 152-ФЗ opt-in flow работает для новых сотрудников.
2. Audit log виден сотруднику.
3. Region flag разделяет EU и RU.
4. Burnout-Risk-Detector выводит сигналы.
5. Forecaster даёт прогнозы.
6. Meeting-Speaker-Analyzer работает.
7. Роль hr_partner добавлена.

### 8.4. 🛑 Чекпоинт 4

- Adoption opt-in flow ≥80% сотрудников новых tenant'ов.
- 0 жалоб типа «отслеживает меня».
- Burnout-Risk-Detector — ≤20% false positives.

Если жалобы есть — пауза, разбор UX и framing.

---

## 9. Волна 5 — Спринты + каналы push/pull (3 недели)

### 9.1. Цели

1. Sprint Daily экран — гипотеза + что вчера + подсказки помощника + цвета задач.
2. Sprint Weekly экран — статус гипотезы + чему научились + retro draft.
3. Архив гипотез — хроника всех спринтов.
4. Telegram weekly digest — push для founder.
5. Расширенный Concierge chat — «спроси Кору про команду / сотрудника / спринт».
6. In-app sidebar «Помощник компании» — badge с 3-5 actionable сигналов.

### 9.2. Фазы

#### Фаза 5.1. Sprint Daily экран (4 дня)

- [ ] `frontend/app/(authenticated)/projects/[slug]/sprint-daily/page.tsx` + клиент.
- [ ] Секции (v3-expanded §3.7):
  - Гипотеза + текущая метрика + confidence team.
  - AI Daily Standup (расширить `sprint-helper.service.ts`).
  - Подсказки помощника (уже есть `SprintHint` со всеми 10 типами — выводим).
  - Список задач с цветным светофором (по `Issue` + last activity).
  - Кто двигает спринт (top-3 closed + top-3 helpful).
  - Alarm-bar (если ≥1 критическая подсказка).
- [ ] Backend: расширить `SprintAnalystService` для daily-агрегата.

#### Фаза 5.2. Sprint Weekly экран (3 дня)

- [ ] `frontend/app/(authenticated)/projects/[slug]/sprint-weekly/page.tsx`.
- [ ] Секции (v3-expanded §3.8):
  - Recap гипотезы + статус (подтверждается / нет).
  - AI Weekly Sprint Summary (новый агент `sprint-strategist.worker`).
  - Velocity + throughput trend.
  - Health команды спринта (mini-Health Grid для членов спринта).
  - Outcome метрика недели.
  - Что узнали за неделю.
  - Action items для retro.
  - Прогноз закрытия (через Forecaster из 4.6).
  - Retro-template (автогенерация).
- [ ] Sprint-Strategist агент — новый worker, ranger подобно operations-weekly-digest.

#### Фаза 5.3. Архив гипотез (3 дня)

- [ ] `frontend/app/(authenticated)/sprints/archive/page.tsx` + клиент.
- [ ] Список всех `Cycle` за период с (гипотеза, результат, чему научились, решение).
- [ ] Фильтры: подтвердились / не подтвердились / в процессе.
- [ ] Сводка квартала.
- [ ] Backend endpoint `GET /api/v1/sprints/archive?period=quarter`.
- [ ] Поиск по тексту гипотезы (использовать существующие embedding на `Cycle.description` если есть).

#### Фаза 5.4. Telegram weekly digest (3 дня)

- [ ] Новый сервис `WeeklyDigestPushService` в `conversational` модуле.
- [ ] Cron понедельник 09:00 локального времени Org → LLM генерит 1-страничное narrative (3 сигнала + 1 победа + 1 действие) → шлёт в Telegram.
- [ ] Inline-кнопки «Открыть источник» (deep-link).
- [ ] User-настройка: какой день/время + on/off.

#### Фаза 5.5. Расширенный Concierge chat (4 дня)

- [ ] Расширить существующий Concierge (`/assistant`) — добавить graph-queries:
  - «Что у нас с Аней?» → ответ с цитатами из карточки сотрудника.
  - «Покажи просроченные обещания» → список.
  - «Что нового по спринту X?» → текущий статус.
  - «Какая команда сейчас просела?» → top из Team Health.
- [ ] Использовать существующий `LlmRouterService` + tool calling.
- [ ] Concierge **никогда не пишет первым** (правило из `feedback_concierge_text_only_output.md`).

#### Фаза 5.6. In-app sidebar «Помощник компании» (3 дня)

- [ ] Frontend компонент `<AssistantSidebar>` в layout authenticated:
  - Badge-counter справа сверху.
  - Sidebar выезжает справа.
  - Список 3-5 actionable сигналов (anomalies, hanging items, alerts).
  - Каждый сигнал → action button («запланировать 1:1», «открыть»).
  - Auto-decay через 7 дней (`assistant_signals.expiresAt`).
- [ ] Backend: новая модель `AssistantSignal` + Service который агрегирует сигналы из всех источников.
- [ ] Notification budget: ≤3 push/неделю (не сам digest, а критические события).

#### Фаза 5.7. QA (2 дня)

### 9.3. DoD Волны 5

1. Sprint Daily / Sprint Weekly / Архив гипотез работают.
2. Telegram weekly digest приходит.
3. Concierge отвечает на graph-queries.
4. Sidebar работает с дедупликацией.
5. Все тесты + регрессия.

### 9.4. 🛑 Чекпоинт 5

- Telegram digest open rate ≥40%.
- Sprint Daily — открывается ≥1 раз/день sprint owner'ом во время спринта.
- Sidebar action click ≥30%.
- ≥1 customer case study «архив гипотез помог не повторить ошибку».

---

## 10. Волна 6 — Чаты + 8 показателей-патернов (4 недели)

### 10.1. Цели

Глубинная аналитика — 8 паттернов которые я как операционный директор сам предложил (v3-expanded §12-bis). Плюс подключение чатов как источника данных.

### 10.2. Фазы

#### Фаза 6.1. Bus Factor Analyzer (3 дня)

- [ ] Новый `bus-factor-analyzer.cron` (weekly).
- [ ] Для каждой knowledge-area из `PersonKnowledgeCategoryEmbedding` считает `COUNT(person WHERE confidence='high')`.
- [ ] Кладёт в `KnowledgeRiskSnapshot`.
- [ ] Виджет «Угрозы непрерывности» на Главной — топ-5 critical (≤1 эксперт).
- [ ] В карточке сотрудника — «Без этого человека пропадёт» (knowledge areas где он единственный high).

#### Фаза 6.2. Topic Recurrence Detector (2 дня)

- [ ] Новый `topic-recurrence-detector.cron` (weekly).
- [ ] Для каждого Theme: упоминаний за период, число встреч, есть ли implemented Decision.
- [ ] Кладёт в `RecurringTopic` table.
- [ ] Виджет «Что мы обсуждаем по кругу» на Главной (top-5).
- [ ] Виджет в Operations Daily (новые «зацикленные»).

#### Фаза 6.3. Meeting ROI Scorer (3 дня)

- [ ] Новый `meeting-roi-scorer.worker` (на каждое Meeting после tasks-extract + quality-score).
- [ ] Формула: `(decisions×10 + commitments×5 + closedTasks×3) / (avgParticipants × durationMinutes / 60)`.
- [ ] Кладёт в `Meeting.roiScore`.
- [ ] Виджет «Топ-3 встречи-болтологии» на Главной (низкий ROI).
- [ ] В Operations Daily: вчерашние low-ROI встречи.
- [ ] В карточке сотрудника: % его времени на low-ROI встречи.

#### Фаза 6.4. Cross-functional Bottleneck Heatmap UI (2 дня)

- [ ] Используем существующий `cross-functional-friction-aggregator.cron`.
- [ ] Виджет на Главной: heatmap 5×5 / 6×6 отделов × отделов.
- [ ] В Operations Daily: «новые трения вчера».
- [ ] В Teams dashboard: с кем больше всего трений у команды.

#### Фаза 6.5. Promise Network Analyzer (3 дня)

- [ ] Новый `promise-network-analyzer.cron` (weekly).
- [ ] Строит граф `Commitment` (from author → to recipient) + считает paradoxы (in-degree, out-degree, balance).
- [ ] Помечает узлы: накопитель / донор / изолированный.
- [ ] Кладёт в `PromiseNetworkSnapshot`.
- [ ] Виджет в Teams dashboard: карта обещаний внутри команды.
- [ ] В карточке сотрудника: «кому ты обещаешь / кто тебе».

#### Фаза 6.6. Goal Vector Tracker (3 дня)

- [ ] Новый `goal-vector-tracker.cron` (weekly).
- [ ] Для каждого человека: LLM анализирует артефакты (IdeaBlock, Commitment, Issue closed, MeetingAttendee, чек-ины) → pro/contra per active Goal.
- [ ] Кладёт в `PersonGoalContribution` (newly created model).
- [ ] Виджет на Главной: «Вектор компании» — % всех действий работающих на стратегические цели.
- [ ] В карточке сотрудника: «Куда направлены усилия» — pie chart или bar.
- [ ] В Teams: aggregate команды.
- [ ] В Sprint Pulse: % action team спринта на спринт-цель.

#### Фаза 6.7. Knowledge Velocity Tracker (2 дня)

- [ ] Новый `knowledge-velocity-tracker.cron` (weekly).
- [ ] Для `IdeaBlock signalType='knowledge_gap'`: median time от создания до появления trustedAnswer или связанного canonical block.
- [ ] Кладёт в `KnowledgeVelocitySnapshot` (новая таблица).
- [ ] KPI «Скорость накопления знаний» на Главной (отдельная карточка или в виджете патернов).
- [ ] В карточке сотрудника: «твои вопросы без ответа».

#### Фаза 6.8. Decision Hygiene Scorer (3 дня)

- [ ] Расширить `Decision` модель: `reversibility String?` (type-1 / type-2).
- [ ] Новый `decision-hygiene-scorer.worker` (на каждое новое Decision).
- [ ] LLM классифицирует type-1/type-2 на основе текста.
- [ ] Для type-1: проверяет наличие IdeaBlock signalType='decision_basis' вокруг → есть ли альтернативы.
- [ ] Алерт на Главной: «3 необратимых решения без альтернатив за неделю».
- [ ] На странице Decision: «Это type-1, рассмотрены ли альтернативы?»

#### Фаза 6.9. Чат-интеграция (опц., если успеем; ~5 дней)

- [ ] Telegram-bot read-only access на канал команды (opt-in каждого участника).
- [ ] Сохранение messages в новой таблице `ChatMessage`.
- [ ] Новый `chat-helper.cron`: анализ переписки — кто помогает, кто молчит, sentiment per pair.
- [ ] Виджет «Чат-активность» в карточке сотрудника секция 9 (раньше заглушка).
- [ ] Slack / Discord интеграции — по мере спроса (не в Волне 6 — это отдельный трек).

#### Фаза 6.10. QA (3 дня)

### 10.3. DoD Волны 6

1. Все 8 паттернов (Bus Factor / Topic Recurrence / Meeting ROI / Bottleneck Heatmap / Promise Network / Goal Vector / Knowledge Velocity / Decision Hygiene) считаются и видны.
2. Chat-integration (опционально) даёт первые сигналы.
3. Все агенты в Prometheus метриках.
4. Тесты + регрессия.

### 10.4. 🛑 Финальный чекпоинт

- ≥3 customer case studies «помог увидеть X за месяцы до того как взорвалось».
- Daily active на Главной ≥80% от signed-up tenant'ов.
- Net Promoter Score продукта ≥+30.
- Churn rate < 5% за квартал.

---

## 11. Общие риски и митигации

| Риск | Митигация |
|---|---|
| 15 недель — пользователь устаёт ждать value, продукт под вопросом | Чекпоинты после каждой волны — реальная польза должна быть видна через 3 недели (Волна 1), 6 недель (Волна 2), 10 недель (Волна 3) |
| Один разработчик не справится за 15 недель | Roadmap рассчитан на 1-2 fullstack, реально 12-20 недель в зависимости от темпа. Не сжимать жёстко по дням |
| LLM-агенты галлюцинируют, теряем доверие | Transparent Sourcing на каждом утверждении; precision threshold ≥70% на чекпоинтах; кнопка «нерелевантно» с обратной связью |
| 152-ФЗ не соблюдён, юридический риск | Волна 4 — opt-in flow обязателен до релиза любых pulse-фич для бизнеса; рекомендуется юр.consult |
| Hawthorne effect: сотрудники подстраиваются под трекинг | Документ «что система знает» обязателен на /me/pulse; opt-out возможен |
| `Decision.raisedCount` или другие новые поля конфликтуют с существующими | Перед каждой фазой — `Grep` существующих полей; не дублировать |
| Sprint Hypothesis как структурированное поле — пока нет в схеме (V2 в ТЗ спринтов) | Используем `Cycle.description` (text) с конвенцией; полное structured-поле — отдельный ТЗ |
| Trade-off между MIN cohort 3 и MIN cohort 5 | Волны 1-3 — minimum 3 (демо-режим), Волна 4 строго min 5 после opt-in flow |
| Производительность с >10k records | Redis-кэш на всех агрегатах; если медленно — materialized views в Волне 2 |
| EU AI Act — для будущих ЕС-клиентов | Region flag в Волне 4 — для region='eu' определённые фичи (voice-anything) скрыты |

---

## 12. Итог реализации

Заполняется по мере выполнения. Формат: дата завершения / коммиты / выпустили на пилот / результаты.

### Волна 1 — Фундамент
- Фаза 1.0 Хотфиксы: [ ]
- Фаза 1.1 Commitment Reliability: [ ]
- Фаза 1.2 Hanging Decisions: [ ]
- Фаза 1.3 Sentiment Index: [ ]
- Фаза 1.4 AI Narrative + Citations: [ ]
- Фаза 1.5 3 KPI Hero: [ ]
- Фаза 1.6 Team Health Grid: [ ]
- Фаза 1.7 QA: [ ]
- **Релиз Волны 1**: дата, коммиты, пилот на N клиентов.
- **Чекпоинт 1**: результаты замеров метрик через 2 недели.

### Волна 2 — Усиление операционных
- Фаза 2.1 Daily-Reporter: [ ]
- Фаза 2.2 Weekly-Strategist: [ ]
- Фаза 2.3 Операции — расширение: [ ]
- Фаза 2.4 /teams список: [ ]
- Фаза 2.5 /teams/[id] детально: [ ]
- Фаза 2.6 QA: [ ]
- **Релиз Волны 2**: дата.
- **Чекпоинт 2**: метрики.

### Волна 3 — Команды и сотрудники
- Фаза 3.1 Team-Health-Analyzer: [ ]
- Фаза 3.2 Conflict-Detector расширение: [ ]
- Фаза 3.3 Engagement-Scorer: [ ]
- Фаза 3.4 Карточка сотрудника v1: [ ]
- Фаза 3.5 Reflection-Quality-Scorer: [ ]
- Фаза 3.6 Карточка сотрудника v2: [ ]
- Фаза 3.7 HR-Recommender: [ ]
- Фаза 3.8 Карточка сотрудника v3: [ ]
- Фаза 3.9 QA: [ ]
- **Релиз Волны 3**: дата.
- **Чекпоинт 3**: метрики.

### Волна 4 — Compliance + углубление
- Фаза 4.1 152-ФЗ opt-in: [ ]
- Фаза 4.2 Audit log: [ ]
- Фаза 4.3 Region flag: [ ]
- Фаза 4.4 Meeting-Speaker-Analyzer: [ ]
- Фаза 4.5 Burnout-Risk-Detector: [ ]
- Фаза 4.6 Forecaster: [ ]
- Фаза 4.7 hr_partner роль: [ ]
- Фаза 4.8 QA + audit: [ ]
- **Релиз Волны 4**: дата.
- **Чекпоинт 4**: метрики.

### Волна 5 — Спринты + каналы
- Фаза 5.1 Sprint Daily: [ ]
- Фаза 5.2 Sprint Weekly: [ ]
- Фаза 5.3 Архив гипотез: [ ]
- Фаза 5.4 Telegram digest: [ ]
- Фаза 5.5 Concierge graph-queries: [ ]
- Фаза 5.6 Sidebar помощник: [ ]
- Фаза 5.7 QA: [ ]
- **Релиз Волны 5**: дата.
- **Чекпоинт 5**: метрики.

### Волна 6 — Чаты + 8 показателей
- Фаза 6.1 Bus Factor: [ ]
- Фаза 6.2 Topic Recurrence: [ ]
- Фаза 6.3 Meeting ROI: [ ]
- Фаза 6.4 Bottleneck Heatmap UI: [ ]
- Фаза 6.5 Promise Network: [ ]
- Фаза 6.6 Goal Vector: [ ]
- Фаза 6.7 Knowledge Velocity: [ ]
- Фаза 6.8 Decision Hygiene: [ ]
- Фаза 6.9 Чаты (опц.): [ ]
- Фаза 6.10 QA: [ ]
- **Релиз Волны 6**: дата.
- **Финальный чекпоинт**: результаты по итогам полной реализации.

---

## 13. Команды разработки (напоминание)

- Все команды — через `bun`, не `npm`.
- Backend: `cd backend && bun run dev` + `bun run worker:dev` (отдельный процесс воркеров).
- Frontend: `cd frontend && bun run dev`.
- Prisma: только `bun run prisma:push`, **никогда** `migrate`. После правок схемы — `bun run prisma:generate`.
- Тесты: `bun run test:unit` / `test:integration` / `test:e2e`.
- Проверка перед commit: `bun run typecheck && bun run lint`.
- Patch-скрипты в `backend/scripts/` → регистрировать в `apply-prod-deploy.ts` (массив STEPS).
- `prod-deploy-log.md` — после каждой фазы с миграциями.
